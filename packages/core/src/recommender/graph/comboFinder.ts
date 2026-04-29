/**
 * BFS-based combo path finder over the Effect Graph.
 *
 * Starting from a set of "starter" cards (cards in the opening hand), finds
 * all reachable paths that culminate in a meaningful board state:
 *   - Boss monster on field
 *   - Multiple monsters for a Link/Synchro/Xyz/Fusion summon
 *   - Disruption setup (negate + monster)
 *
 * A "path" is a sequence of (card, action, target) triples capped at
 * MAX_DEPTH steps to keep search tractable.
 */

import type {
  EffectGraph,
  EffectNode,
  EffectEdge,
  ComboPath,
  ComboStep,
  ZoneRef,
} from "./effectTypes.js";
import { matchesCard } from "./graphBuilder.js";

const MAX_DEPTH = 7;

// ─── Board state during BFS ───────────────────────────────────────────────────

interface BoardState {
  hand: Set<number>;
  field: Set<number>;
  gy: Set<number>;
  banished: Set<number>;
  deck: Set<number>; // subset: cards known to be in deck
}

interface BfsNode {
  board: BoardState;
  steps: ComboStep[];
  /** Cards that have already activated their effect this chain/turn. */
  used: Set<number>;
}

function cloneBoard(b: BoardState): BoardState {
  return {
    hand: new Set(b.hand),
    field: new Set(b.field),
    gy: new Set(b.gy),
    banished: new Set(b.banished),
    deck: new Set(b.deck),
  };
}

function getZoneSet(board: BoardState, zone: ZoneRef): Set<number> {
  switch (zone) {
    case "hand": return board.hand;
    case "field": return board.field;
    case "gy": return board.gy;
    case "banished": return board.banished;
    case "deck": return board.deck;
    default: return board.field;
  }
}

function cardIsInZone(cardId: number, board: BoardState, zone: ZoneRef): boolean {
  if (zone === "any") {
    return (
      board.hand.has(cardId) ||
      board.field.has(cardId) ||
      board.gy.has(cardId) ||
      board.banished.has(cardId)
    );
  }
  return getZoneSet(board, zone).has(cardId);
}

// ─── Edge applicability check ─────────────────────────────────────────────────

/**
 * Returns the best target card ID satisfying the edge's matcher
 * given the current board, or null if the edge can't fire.
 */
function findEdgeTarget(
  edge: EffectEdge,
  board: BoardState,
  graph: EffectGraph
): number | null {
  // If the matcher resolves to a specific card ID, check that card's zone
  if (edge.matcher.cardId !== undefined) {
    const id = edge.matcher.cardId;
    const zone = edge.source === "any" ? ("field" as ZoneRef) : edge.source;
    if (edge.source === "any" || cardIsInZone(id, board, zone)) return id;
    // For searches/summons from deck, the card just needs to exist in the deck
    if (edge.source === "deck" && board.deck.has(id)) return id;
    return null;
  }

  // Broad matcher: scan all cards in the source zone
  const zone = edge.source === "any" ? "field" : edge.source;
  const zoneSet = getZoneSet(board, zone as ZoneRef);
  for (const id of zoneSet) {
    const node = graph.get(id);
    if (node && matchesCard(node, edge.matcher)) return id;
  }

  // For deck searches: scan deck
  if (edge.source === "deck" || edge.source === "any") {
    for (const id of board.deck) {
      const node = graph.get(id);
      if (node && matchesCard(node, edge.matcher)) return id;
    }
  }

  return null;
}

// ─── Path evaluation ──────────────────────────────────────────────────────────

/** A path is "interesting" if it puts at least 2 bodies on field or sets up GY. */
function isInterestingResult(board: BoardState): boolean {
  return board.field.size >= 2 || board.gy.size >= 2;
}

function pathDifficulty(starters: number[]): ComboPath["difficulty"] {
  if (starters.length <= 1) return "1-card";
  if (starters.length <= 2) return "2-card";
  return "3-card";
}

// ─── BFS search ───────────────────────────────────────────────────────────────

export interface ComboSearchOptions {
  /** Cards available in opening hand. */
  handCardIds: number[];
  /** Cards known to be in the deck (for search effects). */
  deckCardIds: number[];
  graph: EffectGraph;
  /** Stop after finding this many paths. Default: 20. */
  maxPaths?: number;
  maxDepth?: number;
}

export function findComboPaths(options: ComboSearchOptions): ComboPath[] {
  const {
    handCardIds,
    deckCardIds,
    graph,
    maxPaths = 20,
    maxDepth = MAX_DEPTH,
  } = options;

  const initialBoard: BoardState = {
    hand: new Set(handCardIds),
    field: new Set(),
    gy: new Set(),
    banished: new Set(),
    deck: new Set(deckCardIds),
  };

  const queue: BfsNode[] = [
    { board: initialBoard, steps: [], used: new Set() },
  ];
  const found: ComboPath[] = [];
  const seenStates = new Set<string>();

  while (queue.length > 0 && found.length < maxPaths) {
    const current = queue.shift()!;
    if (current.steps.length >= maxDepth) continue;

    // Try each card currently in hand or on field
    const activatable = [
      ...Array.from(current.board.hand),
      ...Array.from(current.board.field),
    ];

    for (const cardId of activatable) {
      if (current.used.has(cardId)) continue;
      const node = graph.get(cardId);
      if (!node) continue;

      for (const edge of node.outEdges) {
        const targetId = findEdgeTarget(edge, current.board, graph);
        if (targetId === null) continue;

        const targetNode = graph.get(targetId);
        if (!targetNode) continue;

        // Apply the edge to produce a new board state
        const newBoard = cloneBoard(current.board);
        const newUsed = new Set(current.used);
        newUsed.add(cardId);

        // Remove target from source zone, add to destination zone
        getZoneSet(newBoard, edge.source).delete(targetId);
        getZoneSet(newBoard, edge.target).add(targetId);

        // The acting card stays on field after using its effect (simplification)
        newBoard.hand.delete(cardId);
        newBoard.field.add(cardId);

        const stateKey = [
          [...newBoard.hand].sort().join(","),
          [...newBoard.field].sort().join(","),
          [...newBoard.gy].sort().join(","),
        ].join("|");

        if (seenStates.has(stateKey)) continue;
        seenStates.add(stateKey);

        const step: ComboStep = {
          cardId,
          cardName: node.cardName,
          action: describeAction(edge.type, edge.source),
          edgeType: edge.type,
          targetCardId: targetId,
          targetCardName: targetNode.cardName,
          rawClause: edge.rawClause,
          zoneAfter: edge.target,
        };

        const newSteps = [...current.steps, step];

        if (isInterestingResult(newBoard)) {
          found.push(buildComboPath(handCardIds, newSteps, newBoard));
        }

        queue.push({ board: newBoard, steps: newSteps, used: newUsed });
      }
    }
  }

  return found;
}

function describeAction(type: string, source: ZoneRef): string {
  const from = source === "deck" ? " from Deck"
    : source === "gy" ? " from GY"
    : source === "hand" ? " from Hand"
    : source === "banished" ? " from Banished"
    : "";
  switch (type) {
    case "searches": return `Search${from}`;
    case "special_summons": return `Special Summon${from}`;
    case "mills": return `Send to GY${from}`;
    case "banishes": return `Banish${from}`;
    case "fuses_with": return "Fusion Summon";
    case "gy_trigger": return "Activate GY effect";
    case "summon_trigger": return "Trigger on summon";
    case "returns_to_hand": return `Return to hand${from}`;
    default: return type;
  }
}

function buildComboPath(
  originalHand: number[],
  steps: ComboStep[],
  finalBoard: BoardState
): ComboPath {
  const usedFromHand = steps
    .filter((s) => originalHand.includes(s.cardId))
    .map((s) => s.cardId);
  const starters = [...new Set(usedFromHand)];

  return {
    starters,
    steps,
    result: {
      fieldMonsters: [...finalBoard.field],
      fieldSpells: [],
      gyCards: [...finalBoard.gy],
      banishedCards: [...finalBoard.banished],
    },
    handRequirement: starters.length,
    difficulty: pathDifficulty(starters),
  };
}
