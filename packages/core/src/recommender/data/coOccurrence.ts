import type { MetaDeck, CoOccurrenceMatrix, CoOccurrenceStats } from "../types.js";

/**
 * Builds a co-occurrence matrix from a set of meta decks using lift as the
 * association score.
 *
 * Lift(A,B) = P(A∩B) / (P(A) × P(B))
 *   > 1 → cards appear together more than chance (true synergy signal)
 *   = 1 → independent
 *   < 1 → avoided together
 *
 * Using lift instead of raw count corrects for ubiquitous staples like
 * Ash Blossom appearing in every deck — their pairwise lift with unrelated
 * cards will be close to 1, not artificially high.
 */
export function buildCoOccurrenceMatrix(
  decks: MetaDeck[]
): { matrix: CoOccurrenceMatrix; stats: CoOccurrenceStats } {
  const N = decks.length;
  if (N === 0) {
    return {
      matrix: new Map(),
      stats: { totalDecks: 0, uniqueCards: 0, matrixSize: 0, builtAt: new Date() },
    };
  }

  // Raw co-occurrence counts (symmetric)
  const rawCounts = new Map<number, Map<number, number>>();
  // How many decks contain each card
  const cardFreq = new Map<number, number>();

  for (const deck of decks) {
    // Deduplicate within this deck (we care about presence, not quantity)
    const cardSet = new Set([...deck.main, ...deck.extra]);

    for (const id of cardSet) {
      cardFreq.set(id, (cardFreq.get(id) ?? 0) + 1);
    }

    const cardArr = Array.from(cardSet);
    for (let i = 0; i < cardArr.length; i++) {
      const a = cardArr[i]!;
      for (let j = i + 1; j < cardArr.length; j++) {
        const b = cardArr[j]!;

        if (!rawCounts.has(a)) rawCounts.set(a, new Map());
        if (!rawCounts.has(b)) rawCounts.set(b, new Map());

        const aMap = rawCounts.get(a)!;
        aMap.set(b, (aMap.get(b) ?? 0) + 1);

        const bMap = rawCounts.get(b)!;
        bMap.set(a, (bMap.get(a) ?? 0) + 1);
      }
    }
  }

  // Convert raw counts → lift scores
  const matrix: CoOccurrenceMatrix = new Map();
  let matrixSize = 0;

  for (const [a, neighbors] of rawCounts) {
    const freqA = cardFreq.get(a) ?? 1;
    const pA = freqA / N;
    const liftMap = new Map<number, number>();

    for (const [b, coCount] of neighbors) {
      const freqB = cardFreq.get(b) ?? 1;
      const pB = freqB / N;
      const pAB = coCount / N;
      const lift = pAB / (pA * pB);
      liftMap.set(b, lift);
      matrixSize++;
    }

    matrix.set(a, liftMap);
  }

  return {
    matrix,
    stats: {
      totalDecks: N,
      uniqueCards: cardFreq.size,
      matrixSize: matrixSize / 2, // symmetric pairs
      builtAt: new Date(),
    },
  };
}

/**
 * Return the top-N neighbors of a card sorted by lift score (descending).
 * Cards already present in `excludeIds` are omitted.
 */
export function getTopNeighbors(
  cardId: number,
  matrix: CoOccurrenceMatrix,
  excludeIds: Set<number>,
  topN = 30
): Array<{ cardId: number; lift: number }> {
  const neighbors = matrix.get(cardId);
  if (!neighbors) return [];

  return Array.from(neighbors.entries())
    .filter(([id]) => !excludeIds.has(id))
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([id, lift]) => ({ cardId: id, lift }));
}
