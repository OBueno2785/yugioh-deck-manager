/**
 * Hypergeometric distribution engine.
 *
 * Models the probability of drawing a specific number of "successes"
 * from a finite population without replacement — exactly what describes
 * drawing cards from a Yu-Gi-Oh deck.
 *
 * Notation:
 *   D = deck size
 *   c = copies of the target card in the deck
 *   n = hand size (number of cards drawn)
 *   k = desired number of successes
 */

// ─── Core Math ────────────────────────────────────────────────────────────────

/**
 * Natural log of the binomial coefficient C(n, k) using log-gamma for
 * numerical stability with large values.
 */
function logBinomial(n: number, k: number): number {
  if (k < 0 || k > n) return -Infinity;
  if (k === 0 || k === n) return 0;
  return logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);
}

/**
 * Stirling / Lanczos approximation of the log-gamma function.
 * Accurate enough for deck sizes up to 60 cards.
 */
function logGamma(x: number): number {
  if (x <= 0) return Infinity;
  // Lanczos coefficients (g=7)
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }
  x -= 1;
  let a = c[0] ?? 0;
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) {
    a += (c[i] ?? 0) / (x + i);
  }
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/**
 * P(X = k): probability of drawing exactly k copies of a card.
 *
 * @param deckSize    Total cards in deck (D)
 * @param copies      Copies of the target card (c)
 * @param handSize    Cards drawn (n)
 * @param k           Exact number of successes desired
 */
export function hypergeometricExact(
  deckSize: number,
  copies: number,
  handSize: number,
  k: number
): number {
  if (copies > deckSize || handSize > deckSize) return 0;
  if (k > copies || k > handSize) return 0;
  if (k < 0) return 0;

  const logP =
    logBinomial(copies, k) +
    logBinomial(deckSize - copies, handSize - k) -
    logBinomial(deckSize, handSize);

  return Math.exp(logP);
}

/**
 * P(X >= minCopies): probability of drawing at least `minCopies` of a card.
 * This is the most useful function for deck analysis.
 *
 * @param deckSize    Total cards in deck
 * @param copies      Copies of the target card
 * @param handSize    Cards drawn (hand size)
 * @param minCopies   Minimum copies desired (default 1)
 */
export function probabilityAtLeast(
  deckSize: number,
  copies: number,
  handSize: number,
  minCopies = 1
): number {
  let probLessThan = 0;
  for (let k = 0; k < minCopies; k++) {
    probLessThan += hypergeometricExact(deckSize, copies, handSize, k);
  }
  return Math.max(0, Math.min(1, 1 - probLessThan));
}

/**
 * P(draw at least a1 copies of card A AND at least a2 copies of card B).
 * Uses the multivariate hypergeometric distribution.
 *
 * @param deckSize   Total deck size
 * @param copiesA    Copies of card A
 * @param copiesB    Copies of card B
 * @param handSize   Hand size
 * @param minA       Min copies of A desired
 * @param minB       Min copies of B desired
 */
export function comboProbability(
  deckSize: number,
  copiesA: number,
  copiesB: number,
  handSize: number,
  minA = 1,
  minB = 1
): number {
  let probability = 0;

  for (let a = minA; a <= copiesA; a++) {
    for (let b = minB; b <= copiesB; b++) {
      const remaining = deckSize - copiesA - copiesB;
      const remainingDrawn = handSize - a - b;
      if (remainingDrawn < 0 || remainingDrawn > remaining) continue;

      const logP =
        logBinomial(copiesA, a) +
        logBinomial(copiesB, b) +
        logBinomial(remaining, remainingDrawn) -
        logBinomial(deckSize, handSize);

      probability += Math.exp(logP);
    }
  }

  return Math.max(0, Math.min(1, probability));
}

// ─── Deck Analysis Helpers ────────────────────────────────────────────────────

export interface SingleCardStats {
  cardId: number;
  cardName: string;
  copies: number;
  goingFirst: number;  // P(>=1) with 5-card hand
  goingSecond: number; // P(>=1) with 6-card hand
}

/**
 * Compute opening-hand probability for every unique card in a deck.
 *
 * @param deckCards  Array of {cardId, cardName, quantity} for main deck only
 * @param deckSize   Total main deck size
 */
export function computeAllCardProbabilities(
  deckCards: Array<{ cardId: number; cardName: string; quantity: number }>,
  deckSize: number
): SingleCardStats[] {
  return deckCards.map(({ cardId, cardName, quantity }) => ({
    cardId,
    cardName,
    copies: quantity,
    goingFirst: probabilityAtLeast(deckSize, quantity, 5),
    goingSecond: probabilityAtLeast(deckSize, quantity, 6),
  }));
}

/**
 * Probability of drawing at least one card from a set of cards with
 * combined total copies in the deck (e.g., "see at least one starter").
 * Assumes the cards are distinct (no overlap).
 *
 * Uses complement: P(see 0 from the group) = C(D-total, n) / C(D, n)
 */
export function groupProbability(
  deckSize: number,
  totalCopies: number,
  handSize: number
): number {
  return probabilityAtLeast(deckSize, totalCopies, handSize, 1);
}

/**
 * Format a probability (0–1) as a percentage string with 2 decimal places.
 */
export function formatPercent(probability: number): string {
  return `${(probability * 100).toFixed(2)}%`;
}
