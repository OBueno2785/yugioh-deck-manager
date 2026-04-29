/**
 * Builds the Effect Graph from the full card catalog.
 *
 * Two-pass process:
 *   Pass 1 — create a node for every card and resolve cardName → cardId.
 *   Pass 2 — parse each card's effect text, create edges, and wire inEdges.
 */

import type { Card } from "../../types.js";
import { parseCardEffects } from "./effectParser.js";
import type { EffectGraph, EffectNode, EffectEdge, CardMatcher } from "./effectTypes.js";

// ─── Matcher resolution ───────────────────────────────────────────────────────

/**
 * Given a CardMatcher (which may have a cardName string) resolve it to a
 * concrete cardId using the name index.
 */
function resolveMatcherCardId(
  matcher: CardMatcher,
  nameIndex: Map<string, number>
): CardMatcher {
  if (matcher.cardName) {
    const id = nameIndex.get(matcher.cardName.toLowerCase());
    if (id !== undefined) {
      return { ...matcher, cardId: id };
    }
  }
  return matcher;
}

/** Returns true if a card node satisfies the given matcher. */
export function matchesCard(node: EffectNode, matcher: CardMatcher): boolean {
  if (matcher.cardId !== undefined) return node.cardId === matcher.cardId;
  if (matcher.cardName) {
    return node.cardName.toLowerCase() === matcher.cardName.toLowerCase();
  }
  if (matcher.archetype && node.archetype !== matcher.archetype) return false;
  if (matcher.race && node.race !== matcher.race) return false;
  if (matcher.attribute && node.attribute !== matcher.attribute) return false;
  if (matcher.type && !node.type.includes(matcher.type)) return false;
  if (matcher.level !== undefined && node.level !== matcher.level) return false;
  if (matcher.linkval !== undefined && node.linkval !== matcher.linkval) return false;
  return true;
}

// ─── Graph construction ───────────────────────────────────────────────────────

export interface GraphBuildStats {
  nodes: number;
  edges: number;
  resolvedByName: number;
  resolvedByMatcher: number;
  durationMs: number;
}

export function buildEffectGraph(cards: Card[]): {
  graph: EffectGraph;
  stats: GraphBuildStats;
} {
  const t0 = Date.now();

  // Pass 1: create nodes + build name index
  const graph: EffectGraph = new Map();
  const nameIndex = new Map<string, number>(); // lowercase name → id

  for (const card of cards) {
    nameIndex.set(card.name.toLowerCase(), card.id);
    const node: EffectNode = {
      cardId: card.id,
      cardName: card.name,
      ...(card.archetype !== undefined ? { archetype: card.archetype } : {}),
      type: card.type,
      ...(card.race !== undefined ? { race: card.race as string } : {}),
      ...(card.attribute !== undefined ? { attribute: card.attribute as string } : {}),
      ...(card.level !== undefined ? { level: card.level } : {}),
      ...(card.linkval !== undefined ? { linkval: card.linkval } : {}),
      outEdges: [],
      inEdges: [],
    };
    graph.set(card.id, node);
  }

  // Pass 2: parse effects and wire edges
  let totalEdges = 0;
  let resolvedByName = 0;
  let resolvedByMatcher = 0;

  for (const card of cards) {
    if (!card.desc) continue;
    const node = graph.get(card.id)!;
    const rawEdges = parseCardEffects(card.desc);

    for (const edge of rawEdges) {
      // Try to resolve the matcher's cardName → cardId
      const resolvedMatcher = resolveMatcherCardId(edge.matcher, nameIndex);
      const resolvedEdge: EffectEdge = { ...edge, matcher: resolvedMatcher };

      node.outEdges.push(resolvedEdge);
      totalEdges++;

      // Wire inEdges to the specific target if resolved by ID
      if (resolvedMatcher.cardId !== undefined) {
        const targetNode = graph.get(resolvedMatcher.cardId);
        if (targetNode) {
          targetNode.inEdges.push(resolvedEdge);
          resolvedByName++;
        }
      } else if (
        resolvedMatcher.archetype ||
        resolvedMatcher.race ||
        resolvedMatcher.attribute
      ) {
        // Broad matcher: wire inEdges to all matching cards
        for (const [, candidate] of graph) {
          if (matchesCard(candidate, resolvedMatcher)) {
            candidate.inEdges.push(resolvedEdge);
            resolvedByMatcher++;
          }
        }
      }
    }
  }

  return {
    graph,
    stats: {
      nodes: graph.size,
      edges: totalEdges,
      resolvedByName,
      resolvedByMatcher,
      durationMs: Date.now() - t0,
    },
  };
}
