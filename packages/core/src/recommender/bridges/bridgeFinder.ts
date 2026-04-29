/**
 * Finds "bridge" cards that connect two archetypes by filling the resource gap
 * between what archetype A provides and what archetype B needs.
 *
 * A bridge card satisfies: provides(bridge) ∩ needs(B) ≠ ∅
 * and optionally: needs(bridge) ⊆ provides(A)
 */

import type { Card } from "../../types.js";
import type { EffectGraph } from "../graph/effectTypes.js";
import type { ArchetypeProfile, ResourceKind } from "./archetypeProfile.js";
import { buildArchetypeProfile } from "./archetypeProfile.js";

// ─── Bridge result types ───────────────────────────────────────────────────────

export type BridgeRole =
  | "shared_engine"     // the card belongs to neither archetype but enables both
  | "extender"          // adds extra bodies/resources both archetypes use
  | "boss_enabler"      // enables the boss monster of archetype B
  | "material_bridge"   // serves as material for extra deck monsters in both
  | "gy_connector"      // connects through GY interactions
  | "search_bridge";    // searches for cards in both archetypes

export interface BridgeCard {
  card: Card;
  role: BridgeRole;
  filledNeeds: ResourceKind[];   // needs of B that this card fills
  synergyScore: number;          // 0-100
  recommendedCopies: 1 | 2 | 3;
  explanation: string;
}

export interface BridgeResult {
  archetypeA: string;
  archetypeB: string;
  profileA: ArchetypeProfile;
  profileB: ArchetypeProfile;
  /** Needs of B that A does not naturally provide. */
  gap: ResourceKind[];
  bridgeCards: BridgeCard[];
  /** How naturally the two archetypes connect (0-100). */
  naturalSynergyScore: number;
  /** A narrative tag for the combination. */
  verdict: "Natural Splash" | "Engineered Bridge" | "Forced" | "Incompatible";
}

// ─── Bridge card scoring ──────────────────────────────────────────────────────

function inferCardProvides(card: Card, graph: EffectGraph): ResourceKind[] {
  const provides: ResourceKind[] = [];
  const node = graph.get(card.id);
  const desc = card.desc?.toLowerCase() ?? "";

  if (node) {
    for (const edge of node.outEdges) {
      if (edge.type === "searches") provides.push("search");
      if (edge.type === "special_summons") provides.push("special_summon");
      if (edge.type === "mills") provides.push("gy_setup");
      if (edge.type === "banishes") provides.push("banish");
    }
  }

  if (desc.includes("send") && desc.includes("gy")) provides.push("gy_setup");
  if (desc.includes("special summon")) provides.push("special_summon");
  if (desc.includes("add") && desc.includes("hand")) provides.push("search");
  if (card.level === 2) provides.push("level2");
  if (card.attribute === "LIGHT") provides.push("light_monsters");
  if (card.attribute === "DARK") provides.push("dark_monsters");
  if (card.race === "Dragon") provides.push("dragon_monsters");
  if (desc.includes("fusion summon")) provides.push("fusion_material");
  if (desc.includes("synchro summon")) provides.push("synchro_material");
  if (desc.includes("link summon")) provides.push("link_material");

  return [...new Set(provides)];
}

function inferBridgeRole(card: Card, filledNeeds: ResourceKind[]): BridgeRole {
  if (filledNeeds.includes("gy_setup") || filledNeeds.includes("banish")) return "gy_connector";
  if (filledNeeds.includes("search")) return "search_bridge";
  if (
    filledNeeds.includes("fusion_material") ||
    filledNeeds.includes("synchro_material") ||
    filledNeeds.includes("link_material")
  ) return "material_bridge";
  if (filledNeeds.includes("special_summon")) return "extender";
  return "shared_engine";
}

function scoreCard(
  filledNeeds: ResourceKind[],
  gap: ResourceKind[],
  profileA: ArchetypeProfile
): number {
  // Base: proportion of the gap filled
  const gapFilled = gap.length > 0 ? filledNeeds.length / gap.length : 0;
  let score = gapFilled * 60;

  // Bonus: card uses resources A already provides (easy to enable)
  const easyToEnable = filledNeeds.filter((n) => profileA.provides.includes(n));
  score += easyToEnable.length * 10;

  // Cap at 100
  return Math.min(100, Math.round(score));
}

// ─── Main bridge finder ───────────────────────────────────────────────────────

export function findBridges(
  archetypeA: string,
  archetypeB: string,
  allCards: Card[],
  graph: EffectGraph,
  options: { topN?: number } = {}
): BridgeResult {
  const { topN = 10 } = options;

  const profileA = buildArchetypeProfile(archetypeA, allCards, graph);
  const profileB = buildArchetypeProfile(archetypeB, allCards, graph);

  // Gap: what B needs that A doesn't provide
  const gap = profileB.needs.filter((need) => !profileA.provides.includes(need));

  // If no gap → natural splash
  const naturalSynergyScore = gap.length === 0
    ? 90
    : Math.max(0, 100 - gap.length * 20);

  // Search for bridge cards outside both archetypes
  const candidates: BridgeCard[] = [];

  for (const card of allCards) {
    // Skip cards belonging to either archetype
    if (card.archetype === archetypeA || card.archetype === archetypeB) continue;
    // Skip tokens, skills
    if (card.type === "Token" || card.type === "Skill Card") continue;

    const cardProvides = inferCardProvides(card, graph);
    const filledNeeds = gap.filter((need) => cardProvides.includes(need));

    if (filledNeeds.length === 0) continue;

    const synergyScore = scoreCard(filledNeeds, gap, profileA);
    if (synergyScore < 10) continue;

    candidates.push({
      card,
      role: inferBridgeRole(card, filledNeeds),
      filledNeeds,
      synergyScore,
      recommendedCopies: synergyScore > 70 ? 3 : synergyScore > 40 ? 2 : 1,
      explanation: buildExplanation(card, archetypeA, archetypeB, filledNeeds),
    });
  }

  // Sort by score, deduplicate by role (keep best per role)
  const sorted = candidates
    .sort((a, b) => b.synergyScore - a.synergyScore)
    .slice(0, topN);

  const verdict = naturalSynergyScore >= 80
    ? "Natural Splash"
    : naturalSynergyScore >= 50
    ? "Engineered Bridge"
    : naturalSynergyScore >= 20
    ? "Forced"
    : "Incompatible";

  return {
    archetypeA,
    archetypeB,
    profileA,
    profileB,
    gap,
    bridgeCards: sorted,
    naturalSynergyScore,
    verdict,
  };
}

const RESOURCE_READABLE: Record<string, string> = {
  gy_setup:        "Graveyard setup",
  hand_advantage:  "hand advantage",
  special_summon:  "free Special Summons",
  search:          "search effects",
  banish:          "banish effects",
  level2:          "Level 2 body",
  light_monsters:  "LIGHT attribute body",
  dark_monsters:   "DARK attribute body",
  dragon_monsters: "Dragon-type body",
  synchro_material:"Synchro material",
  link_material:   "Link material",
  fusion_material: "Fusion material",
  xyz_material:    "Xyz material",
  non_destruction: "non-destruction removal",
  omni_negate:     "omni-negate",
  grind:           "grind-game value",
  turbo:           "turbo consistency",
  combo:           "combo extension",
};

function extractKeyEffect(desc: string | undefined): string {
  if (!desc) return "";
  // Find the first sentence that contains an actionable verb
  const keywords = ["send", "add", "special summon", "search", "draw", "banish", "negate", "destroy"];
  const sentences = desc.split(/[.;]/);
  for (const s of sentences) {
    const lower = s.toLowerCase();
    if (keywords.some((k) => lower.includes(k))) {
      const clean = s.trim();
      if (clean.length > 10 && clean.length < 200) return clean + ".";
    }
  }
  const first = sentences[0]?.trim() ?? "";
  return first.length > 10 ? first.slice(0, 180) + "." : "";
}

function buildExplanation(
  card: Card,
  archetypeA: string,
  archetypeB: string,
  filledNeeds: ResourceKind[]
): string {
  const needLabels = filledNeeds
    .map((n) => RESOURCE_READABLE[n] ?? n)
    .join(" and ");
  const effect = extractKeyEffect(card.desc);
  return `Bridges ${archetypeA} → ${archetypeB} by providing ${needLabels} that ${archetypeB} requires. ${effect}`;
}
