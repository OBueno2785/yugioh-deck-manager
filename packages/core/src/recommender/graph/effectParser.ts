/**
 * Parses Yu-Gi-Oh card effect text into structured EffectEdge objects.
 *
 * Yu-Gi-Oh card text follows consistent patterns documented by Konami.
 * Referenced card names always appear in quotes ("Card Name").
 * Archetype references appear as: '"Despia" monster', 'a "Snake-Eye" card'.
 * Type references appear as: 'Dragon monster', 'Spell/Trap Card'.
 */

import type { EffectEdge, CardMatcher, ZoneRef } from "./effectTypes.js";

// ─── Named card capture (always in quotes in official text) ──────────────────

const QUOTED_NAME = /"([^"]+)"/g;

// ─── Zone vocabulary ─────────────────────────────────────────────────────────

function sourceZone(clause: string): ZoneRef {
  if (/\bfrom your (?:Main )?Deck\b/i.test(clause)) return "deck";
  if (/\bfrom your Extra Deck\b/i.test(clause)) return "extra_deck";
  if (/\bfrom (?:your hand|the hand)\b/i.test(clause)) return "hand";
  if (/\bfrom (?:your|the) (?:GY|Graveyard)\b/i.test(clause)) return "gy";
  if (/\bfrom (?:your )?(?:Banished|banishment)\b/i.test(clause)) return "banished";
  return "any";
}

function destZone(clause: string): ZoneRef {
  if (/\bto your hand\b/i.test(clause)) return "hand";
  if (/\bto (?:the|your) (?:GY|Graveyard)\b/i.test(clause)) return "gy";
  if (/\bto (?:the|your) field\b/i.test(clause)) return "field";
  if (/\bto (?:the|your) (?:banish(?:ed)?|Banishment)\b/i.test(clause)) return "banished";
  if (/\bShuffle.+?into (?:your|the) (?:Main )?Deck\b/i.test(clause)) return "deck";
  return "field"; // summon effects default to field
}

// ─── Archetype / type matchers ───────────────────────────────────────────────

const RACE_LIST = [
  "Dragon","Spellcaster","Warrior","Beast-Warrior","Beast","Fiend","Fairy",
  "Aqua","Reptile","Rock","Insect","Machine","Dinosaur","Zombie","Plant",
  "Thunder","Pyro","Fish","Sea Serpent","Winged Beast","Psychic","Cyberse",
  "Wyrm","Divine-Beast","Creator-God",
];

const ATTR_LIST = ["DARK","LIGHT","EARTH","WATER","FIRE","WIND","DIVINE"];

function buildMatcher(clause: string, quotedNames: string[]): CardMatcher {
  const matcher: CardMatcher = {};

  // Named card (first quoted name that isn't an archetype qualifier)
  const firstName = quotedNames[0];
  if (firstName !== undefined) {
    matcher.cardName = firstName;
  }

  // Archetype: 'a "Branded" monster', '"Despia" card'
  const archetypeMatch = clause.match(/"([^"]+)"\s+(?:monster|card|spell|trap)/i);
  const archetypeCandidate = archetypeMatch?.[1];
  if (archetypeCandidate !== undefined && quotedNames.includes(archetypeCandidate)) {
    if (archetypeCandidate.length < 20) {
      matcher.archetype = archetypeCandidate;
      delete matcher.cardName;
    }
  }

  // Race
  for (const race of RACE_LIST) {
    if (new RegExp(`\\b${race}\\b`, "i").test(clause)) {
      matcher.race = race;
      break;
    }
  }

  // Attribute
  for (const attr of ATTR_LIST) {
    if (new RegExp(`\\b${attr}\\b`).test(clause)) {
      matcher.attribute = attr;
      break;
    }
  }

  // Level
  const lvlMatch = clause.match(/Level\s+(\d+)/i);
  if (lvlMatch) matcher.level = parseInt(lvlMatch[1]!, 10);

  return matcher;
}

// ─── Clause-level pattern detection ─────────────────────────────────────────

interface ParsedClause {
  edge: Omit<EffectEdge, "matcher"> & { matcher: CardMatcher };
}

/** Split the card text into individual effect sentences. */
function splitClauses(desc: string): string[] {
  // Remove activation conditions ("If...", "When...", "Once per turn...")
  // Split on semicolons and periods that end a game action sentence
  return desc
    .split(/[;。]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 10);
}

function parseClause(clause: string): ParsedClause[] {
  const results: ParsedClause[] = [];
  const quoted = [...clause.matchAll(QUOTED_NAME)].map((m) => m[1]!);

  // ── Search effects ────────────────────────────────────────────────────────
  if (/add\b.+?\bto your hand/i.test(clause) && sourceZone(clause) !== "hand") {
    results.push({
      edge: {
        type: "searches",
        source: sourceZone(clause),
        target: "hand",
        matcher: buildMatcher(clause, quoted),
        maxUses: 1,
        rawClause: clause,
      },
    });
  }

  // ── Special Summon effects ────────────────────────────────────────────────
  if (/[Ss]pecial [Ss]ummon\b/i.test(clause)) {
    results.push({
      edge: {
        type: "special_summons",
        source: sourceZone(clause),
        target: "field",
        matcher: buildMatcher(clause, quoted),
        maxUses: 1,
        rawClause: clause,
      },
    });
  }

  // ── Mill effects (send to GY from Deck/Hand) ──────────────────────────────
  if (
    /\bsend\b.+?\bto (?:the|your) (?:GY|Graveyard)\b/i.test(clause) &&
    /\bfrom (?:your|the) (?:Deck|hand)\b/i.test(clause)
  ) {
    results.push({
      edge: {
        type: "mills",
        source: sourceZone(clause),
        target: "gy",
        matcher: buildMatcher(clause, quoted),
        maxUses: 1,
        rawClause: clause,
      },
    });
  }

  // ── Banish effects ────────────────────────────────────────────────────────
  if (/\bbanish\b/i.test(clause)) {
    results.push({
      edge: {
        type: "banishes",
        source: sourceZone(clause),
        target: "banished",
        matcher: buildMatcher(clause, quoted),
        maxUses: 1,
        rawClause: clause,
      },
    });
  }

  // ── GY trigger (this card's effects fire from the GY) ─────────────────────
  if (/(?:while|when|if) this card is in (?:the|your) (?:GY|Graveyard)/i.test(clause)) {
    results.push({
      edge: {
        type: "gy_trigger",
        source: "gy",
        target: "any",
        matcher: buildMatcher(clause, quoted),
        maxUses: 1,
        rawClause: clause,
      },
    });
  }

  // ── Summon trigger ────────────────────────────────────────────────────────
  if (
    /when this card is (?:Normal|Special|Synchro|Fusion|Xyz|Link) Summon(?:ed)?/i.test(clause)
  ) {
    results.push({
      edge: {
        type: "summon_trigger",
        source: "any",
        target: "any",
        matcher: buildMatcher(clause, quoted),
        maxUses: 1,
        rawClause: clause,
      },
    });
  }

  // ── Fusion material ───────────────────────────────────────────────────────
  if (/Fusion Summon/i.test(clause) && quoted.length > 0) {
    results.push({
      edge: {
        type: "fuses_with",
        source: "field",
        target: "extra_deck",
        matcher: buildMatcher(clause, quoted),
        maxUses: 1,
        rawClause: clause,
      },
    });
  }

  // ── Return to hand ────────────────────────────────────────────────────────
  if (/return.+?to (?:the|your) hand/i.test(clause)) {
    results.push({
      edge: {
        type: "returns_to_hand",
        source: sourceZone(clause),
        target: "hand",
        matcher: buildMatcher(clause, quoted),
        maxUses: 1,
        rawClause: clause,
      },
    });
  }

  return results;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Parse all effect edges from a card's description text. */
export function parseCardEffects(desc: string): EffectEdge[] {
  if (!desc) return [];
  const edges: EffectEdge[] = [];
  for (const clause of splitClauses(desc)) {
    for (const { edge } of parseClause(clause)) {
      edges.push(edge as EffectEdge);
    }
  }
  return edges;
}
