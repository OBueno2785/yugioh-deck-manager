/**
 * Analyzes which Extra Deck monsters from archetype B can be summoned
 * using archetype A's cards as materials, and what additional cards are needed.
 */

import type { Card, CardRace, CardAttribute } from "../../types.js";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface MaterialReq {
  index: number;
  raw: string;
  quantity: number;
  namedCard?: string;      // exact name, e.g. "Fallen of Albaz"
  archetype?: string;      // archetype tag, e.g. "Branded"
  attribute?: CardAttribute;
  race?: CardRace;
  level?: number;          // for Xyz rank / Synchro level math
  isTuner?: boolean;
  isNonEffect?: boolean;
  isGeneric: boolean;      // any monster
}

export interface MaterialMatch {
  req: MaterialReq;
  matchedCards: { id: number; name: string }[];
  isFullyMet: boolean;
  missingDescription: string;
}

export interface SummonPathResult {
  target: {
    id: number;
    name: string;
    type: string;
    level?: number;
    linkval?: number;
  };
  summonMethod: "Fusion" | "Synchro" | "Xyz" | "Link";
  materialMatches: MaterialMatch[];
  additionalNeeded: {
    description: string;
    suggestedCards: { id: number; name: string }[];
  }[];
  achievabilityScore: number;  // 0-100
  summary: string;
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const ATTRIBUTES: CardAttribute[] = ["DARK", "LIGHT", "FIRE", "WATER", "WIND", "EARTH", "DIVINE"];
const RACES: string[] = [
  "Dragon", "Warrior", "Spellcaster", "Beast", "Fiend", "Machine", "Aqua",
  "Pyro", "Rock", "Winged Beast", "Plant", "Insect", "Thunder", "Zombie",
  "Dinosaur", "Sea Serpent", "Reptile", "Psychic", "Fairy", "Fish",
  "Cyberse", "Wyrm", "Beast-Warrior",
];

// ─── Material parsers ──────────────────────────────────────────────────────────

function parseFusionMaterials(card: Card): MaterialReq[] {
  const desc = card.desc ?? "";
  // Fusion material line: first paragraph before the effect text (separated by \n\n or the first line)
  const firstPara = (desc.split(/\n\n/)[0] ?? desc.split("\n")[0] ?? "").trim();
  if (!firstPara.includes("+")) return [];

  return firstPara.split(/\s*\+\s*/).map((raw, i) => parseOneMaterial(raw.trim(), i));
}

function parseSynchroMaterials(card: Card): MaterialReq[] {
  const desc = (card.desc ?? "").toLowerCase();
  const targetLevel = card.level;

  // Tuner requirement
  const tunerReq: MaterialReq = { index: 0, raw: "1 Tuner", quantity: 1, isTuner: true, isGeneric: false };

  // Check for attribute/race restriction on the Tuner
  for (const attr of ATTRIBUTES) {
    if (desc.includes(`${attr.toLowerCase()} tuner`)) { tunerReq.attribute = attr; break; }
  }

  // Non-Tuner requirement
  const nonTunerQtyMatch = desc.match(/(\d+)\+?\s+non-tuner/);
  const nonTunerQty = nonTunerQtyMatch?.[1] !== undefined ? parseInt(nonTunerQtyMatch[1]) : 1;
  const nonTunerReq: MaterialReq = {
    index: 1, raw: `${nonTunerQty}+ non-Tuner monster(s)`,
    quantity: nonTunerQty, isTuner: false, isGeneric: true,
    ...(targetLevel !== undefined ? { level: targetLevel } : {}),
  };

  // Check attribute restriction on non-Tuner
  for (const attr of ATTRIBUTES) {
    if (desc.includes(`${attr.toLowerCase()} non-tuner`) || (desc.includes(attr.toLowerCase()) && desc.includes("non-tuner"))) {
      nonTunerReq.attribute = attr; nonTunerReq.isGeneric = false; break;
    }
  }

  return [tunerReq, nonTunerReq];
}

function parseXyzMaterials(card: Card): MaterialReq[] {
  const desc = card.desc ?? "";
  const rank = card.level; // Xyz rank is stored as level

  // "2 Level 4 monsters", "3 Level 3 DARK monsters"
  const match = desc.match(/(\d+)\+?\s+Level\s+(\d+)\s*([\w\s-]+?)\s*monsters?/i);
  if (match && match[1] !== undefined && match[2] !== undefined) {
    const qty  = parseInt(match[1]);
    const lvl  = parseInt(match[2]);
    const qualifier = (match[3] ?? "").trim();
    const req: MaterialReq = { index: 0, raw: match[0], quantity: qty, level: lvl, isGeneric: true };
    for (const attr of ATTRIBUTES) if (qualifier.includes(attr)) { req.attribute = attr; req.isGeneric = false; break; }
    for (const race of RACES)      if (qualifier.includes(race)) { req.race = race as CardRace; req.isGeneric = false; break; }
    return [req];
  }

  if (rank !== undefined) {
    return [{ index: 0, raw: `2 Level ${rank} monsters`, quantity: 2, level: rank, isGeneric: true }];
  }
  return [];
}

function parseLinkMaterials(card: Card): MaterialReq[] {
  const desc = card.desc ?? "";
  const rating = card.linkval ?? 2;

  // "2+ Effect Monsters", "2 FIRE monsters"
  const match = desc.match(/(\d+)\+?\s+([\w\s-]+?)\s*monsters?/i);
  if (match && match[1] !== undefined) {
    const qty = parseInt(match[1]);
    const qualifier = (match[2] ?? "").trim();
    const req: MaterialReq = { index: 0, raw: match[0], quantity: qty, isGeneric: true };
    for (const attr of ATTRIBUTES) if (qualifier.includes(attr)) { req.attribute = attr; req.isGeneric = false; break; }
    for (const race of RACES)      if (qualifier.includes(race)) { req.race = race as CardRace; req.isGeneric = false; break; }
    return [req];
  }

  return [{ index: 0, raw: `${rating} monsters`, quantity: rating, isGeneric: true }];
}

function parseOneMaterial(raw: string, index: number): MaterialReq {
  const req: MaterialReq = { index, raw, quantity: 1, isGeneric: false };

  // Quantity prefix: "1 ", "2 "
  const qtyMatch = raw.match(/^(\d+)\+?\s*/);
  if (qtyMatch?.[1] !== undefined) req.quantity = parseInt(qtyMatch[1]);

  // Quoted name → named card or archetype tag
  const quoted = raw.match(/"([^"]+)"/);
  if (quoted?.[1] !== undefined) {
    const inner = quoted[1];
    if (raw.toLowerCase().includes(`"${inner.toLowerCase()}" monster`) ||
        raw.toLowerCase().includes(`"${inner.toLowerCase()}" card`)) {
      req.archetype = inner;
    } else {
      req.namedCard = inner;
    }
    return req;
  }

  // Non-Effect Monster
  if (raw.match(/non-effect/i)) { req.isNonEffect = true; req.isGeneric = true; return req; }

  // Attribute
  for (const attr of ATTRIBUTES) {
    if (raw.includes(attr)) { req.attribute = attr; break; }
  }
  // Race
  for (const race of RACES) {
    if (raw.includes(race)) { (req as MaterialReq).race = race as CardRace; break; }
  }
  // Generic fallback
  if (!req.attribute && !req.race && !req.namedCard && !req.archetype) req.isGeneric = true;

  return req;
}

// ─── Card matching ─────────────────────────────────────────────────────────────

function cardMatchesReq(card: Card, req: MaterialReq): boolean {
  // Skip non-monsters for material purposes
  if (card.type === "Spell Card" || card.type === "Trap Card") return false;

  if (req.namedCard) {
    return card.name.toLowerCase().includes(req.namedCard.toLowerCase()) ||
           req.namedCard.toLowerCase().includes(card.name.toLowerCase());
  }

  if (req.archetype) {
    return (card.archetype ?? "").toLowerCase().includes(req.archetype.toLowerCase()) ||
           card.name.toLowerCase().includes(req.archetype.toLowerCase());
  }

  if (req.isTuner) {
    return (card.type as string).toLowerCase().includes("tuner");
  }

  const attrOk  = !req.attribute || card.attribute === req.attribute;
  const raceOk  = !req.race || (card.race as string) === (req.race as string);
  const levelOk = !req.level || card.level === req.level;

  if (req.isNonEffect) return !(card.type as string).toLowerCase().includes("effect");

  return req.isGeneric || (attrOk && raceOk && levelOk);
}

// ─── Missing description builder ───────────────────────────────────────────────

function describeMissing(req: MaterialReq): string {
  if (req.namedCard) return `"${req.namedCard}" (named card not in this archetype)`;
  if (req.archetype) return `a "${req.archetype}" archetype monster`;
  if (req.isTuner)   return req.attribute ? `a ${req.attribute} Tuner monster` : "a Tuner monster";
  const parts: string[] = [];
  if (req.quantity > 1) parts.push(`${req.quantity}×`);
  if (req.attribute) parts.push(req.attribute);
  if (req.race)      parts.push(String(req.race));
  if (req.level)     parts.push(`Level ${req.level}`);
  parts.push("monster");
  return parts.join(" ");
}

// ─── Main analyzer ─────────────────────────────────────────────────────────────

export function analyzeSummonPaths(
  archetypeA: string,
  archetypeB: string,
  allCards: Card[]
): SummonPathResult[] {
  const aCards = allCards.filter((c) => c.archetype === archetypeA);

  // Get Extra Deck monsters from archetype B
  const bExtraCards = allCards.filter((c) => {
    if (c.archetype !== archetypeB) return false;
    const t = c.type as string;
    return t.includes("Fusion") || t.includes("Synchro") || t.includes("Xyz") || t.includes("XYZ") || t.includes("Link");
  }).slice(0, 10);

  if (aCards.length === 0 || bExtraCards.length === 0) return [];

  const results: SummonPathResult[] = [];

  for (const target of bExtraCards) {
    const t = target.type as string;
    let method: SummonPathResult["summonMethod"];
    let reqs: MaterialReq[];

    if (t.includes("Fusion"))          { method = "Fusion";   reqs = parseFusionMaterials(target); }
    else if (t.includes("Synchro"))    { method = "Synchro";  reqs = parseSynchroMaterials(target); }
    else if (t.includes("Xyz") || t.includes("XYZ")) { method = "Xyz"; reqs = parseXyzMaterials(target); }
    else if (t.includes("Link"))       { method = "Link";     reqs = parseLinkMaterials(target); }
    else continue;

    if (reqs.length === 0) continue;

    // Match each requirement against A's cards
    const materialMatches: MaterialMatch[] = reqs.map((req) => {
      const matched = aCards.filter((c) => cardMatchesReq(c, req));
      return {
        req,
        matchedCards: matched.slice(0, 3).map((c) => ({ id: c.id, name: c.name })),
        isFullyMet: matched.length >= req.quantity,
        missingDescription: matched.length >= req.quantity ? "" : describeMissing(req),
      };
    });

    const metCount = materialMatches.filter((m) => m.isFullyMet).length;
    let achievabilityScore = Math.round((metCount / reqs.length) * 80);

    // Find what's still needed (materials + enablers)
    const additionalNeeded: SummonPathResult["additionalNeeded"] = [];

    for (const mm of materialMatches.filter((m) => !m.isFullyMet)) {
      const candidates = allCards.filter((c) =>
        c.archetype !== archetypeA &&
        c.archetype !== archetypeB &&
        cardMatchesReq(c, mm.req)
      ).slice(0, 4);

      additionalNeeded.push({
        description: mm.missingDescription,
        suggestedCards: candidates.map((c) => ({ id: c.id, name: c.name })),
      });
    }

    // Fusion: check for Fusion spell/effect among A cards
    if (method === "Fusion") {
      const hasFusionEnabler = aCards.some((c) => {
        const d = (c.desc ?? "").toLowerCase();
        return d.includes("fusion summon") || d.includes("fuse") || d.includes("polymerization");
      });
      if (hasFusionEnabler) {
        achievabilityScore = Math.min(100, achievabilityScore + 15);
      } else {
        // Suggest a Fusion spell
        const fusionSpells = allCards.filter((c) => {
          const d = (c.desc ?? "").toLowerCase();
          return (c.type === "Spell Card") && d.includes("fusion summon") &&
                 c.archetype !== archetypeA && c.archetype !== archetypeB;
        }).slice(0, 3);

        additionalNeeded.push({
          description: "A Fusion spell or effect to perform the Fusion Summon",
          suggestedCards: fusionSpells.map((c) => ({ id: c.id, name: c.name })),
        });
      }
    }

    // Synchro: if A has no Tuners at all, penalize hard
    if (method === "Synchro") {
      const hasAnyTuner = aCards.some((c) => (c.type as string).toLowerCase().includes("tuner"));
      if (!hasAnyTuner) achievabilityScore = Math.min(achievabilityScore, 20);
    }

    // Build human-readable summary
    const metMaterials = materialMatches
      .filter((m) => m.isFullyMet)
      .flatMap((m) => m.matchedCards.slice(0, 1).map((c) => c.name));
    const unmetDescs = materialMatches
      .filter((m) => !m.isFullyMet)
      .map((m) => m.missingDescription);

    let summary = `Summon ${target.name} (${method}`;
    if (target.level) summary += ` Lv.${target.level}`;
    summary += ")";

    if (metMaterials.length > 0) {
      summary += ` — use ${metMaterials.slice(0, 2).join(" + ")} from your ${archetypeA} engine`;
    }
    if (unmetDescs.length > 0) {
      summary += `. Still need: ${unmetDescs.join(", ")}`;
    }
    if (unmetDescs.length === 0 && additionalNeeded.length === 0) {
      summary += ". Fully achievable with your engine alone!";
    }

    results.push({
      target: {
        id: target.id,
        name: target.name,
        type: target.type,
        ...(target.level !== undefined ? { level: target.level } : {}),
        ...(target.linkval !== undefined ? { linkval: target.linkval } : {}),
      },
      summonMethod: method,
      materialMatches,
      additionalNeeded,
      achievabilityScore,
      summary,
    });
  }

  return results.sort((a, b) => b.achievabilityScore - a.achievabilityScore);
}
