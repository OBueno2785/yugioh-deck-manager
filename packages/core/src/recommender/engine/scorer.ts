/**
 * Scores candidate cards for addition to a reference deck.
 *
 * Three signals, combined with configurable weights:
 *   1. Co-occurrence lift     — how often the card appears with deck cards in meta decks
 *   2. Archetype affinity     — whether the card shares or supports the deck's archetypes
 *   3. Role gap bonus         — whether the card fills a missing role in the deck
 */

import type { CoOccurrenceMatrix, CardIndex } from "../types.js";
import type { Card } from "../../types.js";

export interface ScorerWeights {
  coOccurrence: number;   // default 0.50
  archetypeAffinity: number; // default 0.30
  roleGap: number;        // default 0.20
}

export const DEFAULT_WEIGHTS: ScorerWeights = {
  coOccurrence: 0.50,
  archetypeAffinity: 0.30,
  roleGap: 0.20,
};

export interface CandidateScore {
  card: Card;
  totalScore: number;       // 0-100 composite
  coOccurrenceScore: number;
  archetypeScore: number;
  roleGapScore: number;
  topLiftPartner?: { cardId: number; cardName: string; lift: number };
  reason: string;
}

// ─── Co-occurrence signal ─────────────────────────────────────────────────────

function coOccurrenceScore(
  candidateId: number,
  deckIds: Set<number>,
  matrix: CoOccurrenceMatrix
): { score: number; topPartner?: { cardId: number; lift: number } } {
  const neighbors = matrix.get(candidateId);
  if (!neighbors) return { score: 0 };

  let totalLift = 0;
  let count = 0;
  let topLift = 0;
  let topPartnerId: number | undefined;

  for (const deckId of deckIds) {
    const lift = neighbors.get(deckId) ?? 0;
    if (lift > 0) {
      totalLift += lift;
      count++;
      if (lift > topLift) { topLift = lift; topPartnerId = deckId; }
    }
  }

  if (count === 0) return { score: 0 };

  const avgLift = totalLift / count;
  // Lift of 1 = random, 2 = twice as likely, 5+ = very strong signal
  // Map to 0-100: lift 1→0, lift 2→40, lift 4→70, lift 8+→100
  const normalised = Math.min(100, Math.round(((Math.log2(avgLift + 1)) / Math.log2(9)) * 100));

  return topPartnerId !== undefined
    ? { score: normalised, topPartner: { cardId: topPartnerId, lift: topLift } }
    : { score: normalised };
}

// ─── Archetype affinity signal ────────────────────────────────────────────────

function archetypeScore(
  candidate: Card,
  deckArchetypes: Set<string>,
  cardIndex: CardIndex
): number {
  // Exact archetype match
  if (candidate.archetype && deckArchetypes.has(candidate.archetype)) return 100;

  // The card is referenced by an archetype spell/trap
  for (const arch of deckArchetypes) {
    const archCards = cardIndex.byArchetype.get(arch) ?? [];
    for (const ac of archCards) {
      if (ac.desc?.includes(`"${candidate.name}"`)) return 80;
    }
  }

  // Shared support type (e.g. Dragon support for Dragon-heavy deck)
  for (const arch of deckArchetypes) {
    const archCards = cardIndex.byArchetype.get(arch) ?? [];
    const dominantRace = topValue(
      archCards.map((c) => c.race as string | undefined).filter((r): r is string => r !== undefined)
    );
    if (dominantRace && candidate.race === dominantRace) return 40;

    const dominantAttr = topValue(
      archCards.map((c) => c.attribute as string | undefined).filter((a): a is string => a !== undefined)
    );
    if (dominantAttr && candidate.attribute === dominantAttr) return 30;
  }

  return 0;
}

function topValue(arr: string[]): string | undefined {
  const freq = new Map<string, number>();
  for (const v of arr) freq.set(v, (freq.get(v) ?? 0) + 1);
  let top: string | undefined;
  let max = 0;
  for (const [v, c] of freq) { if (c > max) { max = c; top = v; } }
  return top;
}

// ─── Role gap signal ──────────────────────────────────────────────────────────

type SimpleRole = "starter" | "extender" | "handtrap" | "boardbreak" | "garnets";

function inferRole(card: Card): SimpleRole {
  const desc = (card.desc ?? "").toLowerCase();
  if (/\b(negate|cannot be (activated|used))\b/.test(desc)) return "handtrap";
  if (/\bdestroy.+(spell|trap|card)\b/.test(desc)) return "boardbreak";
  if (/\badd\b.+\bto your hand\b.+from (your|the) deck\b/.test(desc)) return "starter";
  if (/\bspecial summon\b.+\bfrom (your|the) deck\b/.test(desc)) return "extender";
  return "extender";
}

function roleGapScore(
  candidate: Card,
  deckRoleCounts: Map<SimpleRole, number>,
  deckSize: number
): number {
  const cardRole = inferRole(candidate);
  const currentCount = deckRoleCounts.get(cardRole) ?? 0;
  const ratio = currentCount / Math.max(deckSize, 1);

  // If the deck has < 20% of this role type, filling it gets a bonus
  if (ratio < 0.1) return 90;
  if (ratio < 0.2) return 60;
  if (ratio < 0.3) return 30;
  return 0;
}

// ─── Main scorer ──────────────────────────────────────────────────────────────

export function scoreCandidate(
  candidate: Card,
  deckCardIds: number[],
  deckCards: Card[],
  matrix: CoOccurrenceMatrix,
  cardIndex: CardIndex,
  weights: ScorerWeights = DEFAULT_WEIGHTS
): CandidateScore {
  const deckIdSet = new Set(deckCardIds);
  const deckArchetypes = new Set(
    deckCards.map((c) => c.archetype).filter((a): a is string => !!a)
  );

  // Role distribution in current deck
  const roleCounts = new Map<SimpleRole, number>();
  for (const dc of deckCards) {
    const r = inferRole(dc);
    roleCounts.set(r, (roleCounts.get(r) ?? 0) + 1);
  }

  const { score: coScore, topPartner } = coOccurrenceScore(candidate.id, deckIdSet, matrix);
  const archScore = archetypeScore(candidate, deckArchetypes, cardIndex);
  const rgScore = roleGapScore(candidate, roleCounts, deckCards.length);

  const total = Math.round(
    coScore * weights.coOccurrence +
    archScore * weights.archetypeAffinity +
    rgScore * weights.roleGap
  );

  const topPartnerCard = topPartner ? cardIndex.byId.get(topPartner.cardId) : undefined;
  const reason = buildReason(candidate, coScore, archScore, rgScore, topPartnerCard);

  const base: CandidateScore = {
    card: candidate,
    totalScore: total,
    coOccurrenceScore: coScore,
    archetypeScore: archScore,
    roleGapScore: rgScore,
    reason,
  };

  if (topPartnerCard && topPartner) {
    base.topLiftPartner = {
      cardId: topPartner.cardId,
      cardName: topPartnerCard.name,
      lift: topPartner.lift,
    };
  }

  return base;
}

function buildReason(
  card: Card,
  coScore: number,
  archScore: number,
  rgScore: number,
  topPartner: Card | undefined
): string {
  const parts: string[] = [];
  if (coScore > 60 && topPartner) parts.push(`High co-occurrence with ${topPartner.name}`);
  else if (coScore > 30) parts.push("Appears frequently in similar meta decks");
  if (archScore === 100) parts.push(`Core ${card.archetype} card`);
  else if (archScore >= 80) parts.push("Referenced by archetype support");
  else if (archScore >= 30) parts.push("Shares type/attribute with deck strategy");
  if (rgScore > 60) parts.push("Fills an underrepresented role in the deck");
  return parts.length > 0 ? parts.join(". ") : "General meta staple";
}
