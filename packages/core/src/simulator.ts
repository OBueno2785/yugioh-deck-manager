/**
 * Monte Carlo hand simulator.
 *
 * Runs N iterations of drawing an opening hand and evaluating
 * user-defined conditions. Pure computation — no I/O, safe to run
 * in a Web Worker.
 */

import type { Card, SimulationConfig, SimulationResult, SimulationCondition } from "./types.js";

// ─── Fisher-Yates Shuffle ─────────────────────────────────────────────────────

/** In-place shuffle. Returns the same array (mutated). */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = arr[i] as T;
    arr[i] = arr[j] as T;
    arr[j] = temp;
  }
  return arr;
}

// ─── Hand Drawing ─────────────────────────────────────────────────────────────

/** Draw `size` cards from a deck. Returns a new array (deck is not mutated). */
function drawHand(deck: Card[], size: number): Card[] {
  const copy = [...deck];
  shuffle(copy);
  return copy.slice(0, size);
}

// ─── Condition Evaluation ─────────────────────────────────────────────────────

function evaluateCondition(hand: Card[], condition: SimulationCondition): boolean {
  const { type, cardIds, minCount } = condition;

  switch (type) {
    case "has_card": {
      // Has at least minCount copies of a specific card (by ID)
      const targetId = cardIds[0];
      if (targetId === undefined) return false;
      const count = hand.filter((c) => c.id === targetId).length;
      return count >= minCount;
    }

    case "has_any": {
      // Has at least minCount total cards from the given set of IDs
      const idSet = new Set(cardIds);
      const count = hand.filter((c) => idSet.has(c.id)).length;
      return count >= minCount;
    }

    case "has_all": {
      // Has at least one copy of each card in the set
      const idSet = new Set(cardIds);
      const foundIds = new Set(hand.map((c) => c.id));
      for (const id of idSet) {
        if (!foundIds.has(id)) return false;
      }
      return true;
    }

    case "has_count": {
      // Has at least minCount cards total matching any of the given IDs
      const idSet = new Set(cardIds);
      const count = hand.filter((c) => idSet.has(c.id)).length;
      return count >= minCount;
    }

    default:
      return false;
  }
}

// ─── Main Simulation Function ─────────────────────────────────────────────────

/**
 * Run a Monte Carlo simulation against a deck.
 *
 * @param config  Simulation configuration
 * @returns       Probability results per condition + combined
 *
 * Performance: ~10,000 iterations on a 40-card deck takes < 50ms in V8.
 */
export function runSimulation(config: SimulationConfig): SimulationResult {
  const { deck, handSize, iterations, conditions } = config;
  const start = Date.now();

  // Counters
  const conditionCounts = new Array<number>(conditions.length).fill(0);
  let allMetCount = 0;

  for (let i = 0; i < iterations; i++) {
    const hand = drawHand(deck, handSize);
    let allMet = true;

    for (let c = 0; c < conditions.length; c++) {
      const condition = conditions[c];
      if (condition === undefined) continue;
      if (evaluateCondition(hand, condition)) {
        conditionCounts[c] = (conditionCounts[c] ?? 0) + 1;
      } else {
        allMet = false;
      }
    }

    if (allMet && conditions.length > 0) allMetCount++;
  }

  const durationMs = Date.now() - start;

  const conditionResults = conditions.map((condition, idx) => {
    const successCount = conditionCounts[idx] ?? 0;
    const probability = successCount / iterations;
    return {
      condition,
      successCount,
      probability,
      percentage: `${(probability * 100).toFixed(2)}%`,
    };
  });

  const allProbability = conditions.length > 0 ? allMetCount / iterations : 1;

  return {
    iterations,
    handSize,
    conditionResults,
    allConditionsMet: {
      successCount: allMetCount,
      probability: allProbability,
      percentage: `${(allProbability * 100).toFixed(2)}%`,
    },
    durationMs,
  };
}

// ─── Deck Expansion ───────────────────────────────────────────────────────────

/**
 * Expand a deck from quantity-based format to a flat array with
 * one entry per copy (required by the simulator).
 */
export function expandDeck(
  cards: Array<{ card: Card; quantity: number }>
): Card[] {
  return cards.flatMap(({ card, quantity }) =>
    Array.from({ length: quantity }, () => card)
  );
}
