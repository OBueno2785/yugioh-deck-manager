/**
 * Builds an ArchetypeProfile from all cards belonging to that archetype.
 *
 * A profile captures what resources the archetype consumes (needs) and
 * what it produces (provides), enabling gap analysis for bridge finding.
 */

import type { Card } from "../../types.js";
import type { EffectGraph } from "../graph/effectTypes.js";

// ─── Profile types ────────────────────────────────────────────────────────────

export type ResourceKind =
  | "gy_setup"          // puts cards in GY
  | "hand_advantage"    // generates card advantage
  | "special_summon"    // can Special Summon freely
  | "search"            // has search effects
  | "banish"            // uses banish zone
  | "level2"            // has Level 2 monsters (Spright requirement)
  | "light_monsters"    // produces LIGHT monsters (Dogmatika/Herald)
  | "dark_monsters"     // produces DARK monsters
  | "dragon_monsters"   // produces Dragon monsters
  | "synchro_material"  // can be used as Synchro material
  | "link_material"     // can be used as Link material
  | "fusion_material"   // can be used as Fusion material
  | "xyz_material"      // can be used as Xyz material
  | "non_destruction"   // non-destruction removal
  | "omni_negate"       // can negate anything
  | "grind"             // grinds out advantage over time
  | "turbo"             // aims to end on turn 1
  | "combo";            // multi-card combo enabler

export interface ArchetypeProfile {
  archetype: string;
  /** Conditions / zones the archetype relies on being available. */
  needs: ResourceKind[];
  /** Resources the archetype can generate or provide. */
  provides: ResourceKind[];
  /** Dominant summon mechanics used. */
  summonTypes: Array<"Normal" | "Special" | "Fusion" | "Synchro" | "Xyz" | "Link" | "Ritual">;
  /** Attribute(s) most common in the archetype. */
  dominantAttributes: string[];
  /** Race(s) most common in the archetype. */
  dominantRaces: string[];
  /** [min, max] levels of main deck monsters. */
  levelRange: [number, number];
  cardCount: number;
}

// ─── Profile builder ──────────────────────────────────────────────────────────

export function buildArchetypeProfile(
  archetype: string,
  cards: Card[],
  graph: EffectGraph
): ArchetypeProfile {
  const archetypeCards = cards.filter((c) => c.archetype === archetype);
  if (archetypeCards.length === 0) {
    return emptyProfile(archetype);
  }

  const needs = new Set<ResourceKind>();
  const provides = new Set<ResourceKind>();
  const summonTypes = new Set<ArchetypeProfile["summonTypes"][number]>();
  const attrCounts = new Map<string, number>();
  const raceCounts = new Map<string, number>();
  const levels: number[] = [];

  for (const card of archetypeCards) {
    const desc = card.desc?.toLowerCase() ?? "";
    const node = graph.get(card.id);

    // Attribute / race tallies
    if (card.attribute) attrCounts.set(card.attribute, (attrCounts.get(card.attribute) ?? 0) + 1);
    if (card.race) raceCounts.set(card.race, (raceCounts.get(card.race) ?? 0) + 1);
    if (card.level) levels.push(card.level);

    // Summon types from card type string
    if (card.type.includes("Fusion")) summonTypes.add("Fusion");
    if (card.type.includes("Synchro")) summonTypes.add("Synchro");
    if (card.type.includes("Xyz")) summonTypes.add("Xyz");
    if (card.type.includes("Link")) summonTypes.add("Link");
    if (card.type.includes("Ritual")) summonTypes.add("Ritual");

    // Provides: infer from outEdges
    if (node) {
      for (const edge of node.outEdges) {
        if (edge.type === "searches") provides.add("search");
        if (edge.type === "special_summons") provides.add("special_summon");
        if (edge.type === "mills") provides.add("gy_setup");
        if (edge.type === "banishes") provides.add("banish");
        if (edge.type === "fuses_with") provides.add("fusion_material");
      }
    }

    // Provides: text-based signals
    if (desc.includes("add") && desc.includes("hand")) provides.add("search");
    if (desc.includes("send") && desc.includes("gy")) provides.add("gy_setup");
    if (desc.includes("special summon")) provides.add("special_summon");
    if (desc.includes("negate") && (desc.includes("any") || desc.includes("either"))) {
      provides.add("omni_negate");
    }

    // Level 2 check (Spright compatibility)
    if (card.level === 2) provides.add("level2");

    // Attribute-based provides
    if (card.attribute === "LIGHT") provides.add("light_monsters");
    if (card.attribute === "DARK") provides.add("dark_monsters");
    if (card.race === "Dragon") provides.add("dragon_monsters");

    // Needs: text-based signals
    if (desc.includes("from your gy") || desc.includes("is in the gy")) needs.add("gy_setup");
    if (desc.includes("banished")) needs.add("banish");
    if (desc.includes("level 2") || desc.includes("rank 2")) needs.add("level2");
  }

  // Default summon types
  if (summonTypes.size === 0) {
    summonTypes.add("Normal");
    summonTypes.add("Special");
  }

  const sortedAttrs = [...attrCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([attr]) => attr);

  const sortedRaces = [...raceCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([race]) => race);

  const levelRange: [number, number] = levels.length
    ? [Math.min(...levels), Math.max(...levels)]
    : [1, 12];

  return {
    archetype,
    needs: [...needs],
    provides: [...provides],
    summonTypes: [...summonTypes],
    dominantAttributes: sortedAttrs,
    dominantRaces: sortedRaces,
    levelRange,
    cardCount: archetypeCards.length,
  };
}

function emptyProfile(archetype: string): ArchetypeProfile {
  return {
    archetype,
    needs: [],
    provides: [],
    summonTypes: ["Special"],
    dominantAttributes: [],
    dominantRaces: [],
    levelRange: [1, 12],
    cardCount: 0,
  };
}
