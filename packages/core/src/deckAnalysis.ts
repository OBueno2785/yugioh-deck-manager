/**
 * Deck consistency analysis.
 *
 * Computes metrics, validates deck legality, and generates a
 * ConsistencyReport from a Deck object.
 */

import type {
  Deck,
  DeckValidationResult,
  ConsistencyReport,
  LabeledDeckCard,
  GameFormat,
  BanStatus,
} from "./types.js";
import {
  computeAllCardProbabilities,
  groupProbability,
} from "./probability.js";

// ─── Deck Validation ─────────────────────────────────────────────────────────

const FORMAT_LIMITS: Record<GameFormat, { mainMin: number; mainMax: number; extraMax: number; sideMax: number }> = {
  tcg:    { mainMin: 40, mainMax: 60, extraMax: 15, sideMax: 15 },
  ocg:    { mainMin: 40, mainMax: 60, extraMax: 15, sideMax: 15 },
  goat:   { mainMin: 40, mainMax: 60, extraMax: 15, sideMax: 15 },
  edison: { mainMin: 40, mainMax: 60, extraMax: 15, sideMax: 15 },
};

function banStatusForFormat(card: LabeledDeckCard, format: GameFormat): BanStatus {
  const info = card.card.banlist_info;
  if (!info) return "Unlimited";
  switch (format) {
    case "tcg": return info.ban_tcg ?? "Unlimited";
    case "ocg": return info.ban_ocg ?? "Unlimited";
    case "goat": return info.ban_goat ?? "Unlimited";
    case "edison": return "Unlimited"; // Edison uses its own ruleset
    default: return "Unlimited";
  }
}

function maxCopiesAllowed(status: BanStatus): number {
  switch (status) {
    case "Banned": return 0;
    case "Limited": return 1;
    case "Semi-Limited": return 2;
    case "Unlimited": return 3;
  }
}

export function validateDeck(deck: Deck): DeckValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const limits = FORMAT_LIMITS[deck.format];

  const mainCount = deck.main.reduce((s, c) => s + c.quantity, 0);
  const extraCount = deck.extra.reduce((s, c) => s + c.quantity, 0);
  const sideCount = deck.side.reduce((s, c) => s + c.quantity, 0);

  // Zone size checks
  if (mainCount < limits.mainMin) errors.push(`Main deck has ${mainCount} cards (minimum ${limits.mainMin}).`);
  if (mainCount > limits.mainMax) errors.push(`Main deck has ${mainCount} cards (maximum ${limits.mainMax}).`);
  if (extraCount > limits.extraMax) errors.push(`Extra deck has ${extraCount} cards (maximum ${limits.extraMax}).`);
  if (sideCount > limits.sideMax) errors.push(`Side deck has ${sideCount} cards (maximum ${limits.sideMax}).`);

  // Per-card copy limits (max 3 regardless of ban list, then further restricted)
  const allCards = [...deck.main, ...deck.extra, ...deck.side];
  const copyCounts = new Map<number, number>();
  for (const dc of allCards) {
    copyCounts.set(dc.card.id, (copyCounts.get(dc.card.id) ?? 0) + dc.quantity);
  }

  for (const dc of deck.main) {
    const total = copyCounts.get(dc.card.id) ?? 0;
    const status = banStatusForFormat(dc, deck.format);
    const allowed = maxCopiesAllowed(status);
    if (total > 3) errors.push(`"${dc.card.name}" exceeds the 3-copy limit (${total} copies).`);
    if (total > allowed && allowed < 3) {
      errors.push(`"${dc.card.name}" is ${status} — only ${allowed} cop${allowed === 1 ? "y" : "ies"} allowed, found ${total}.`);
    }
  }

  // Consistency warnings
  const monsterCount = deck.main.filter((c) =>
    c.card.type.toLowerCase().includes("monster")
  ).reduce((s, c) => s + c.quantity, 0);

  if (mainCount >= 40 && monsterCount < 10) {
    warnings.push("Very few monsters (< 10). Deck may struggle to make plays.");
  }

  const starterCount = deck.main
    .filter((c) => c.role === "starter")
    .reduce((s, c) => s + c.quantity, 0);
  if (starterCount === 0) {
    warnings.push("No cards labeled as 'starter'. Consider labeling your combo starters for consistency analysis.");
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ─── Consistency Report ───────────────────────────────────────────────────────

export function generateConsistencyReport(deck: Deck): ConsistencyReport {
  const mainCards = deck.main;
  const deckSize = mainCards.reduce((s, c) => s + c.quantity, 0);

  // Type counts
  const monsterCount = mainCards
    .filter((c) => c.card.type.toLowerCase().includes("monster"))
    .reduce((s, c) => s + c.quantity, 0);
  const spellCount = mainCards
    .filter((c) => c.card.type === "Spell Card")
    .reduce((s, c) => s + c.quantity, 0);
  const trapCount = mainCards
    .filter((c) => c.card.type === "Trap Card")
    .reduce((s, c) => s + c.quantity, 0);

  // Role counts
  const starterCount = mainCards.filter((c) => c.role === "starter").reduce((s, c) => s + c.quantity, 0);
  const extenderCount = mainCards.filter((c) => c.role === "extender").reduce((s, c) => s + c.quantity, 0);
  const handtrapCount = mainCards.filter((c) => c.role === "handtrap").reduce((s, c) => s + c.quantity, 0);
  const brickCount = mainCards.filter((c) => c.role === "garnets").reduce((s, c) => s + c.quantity, 0);

  // Per-card probabilities
  const cardStats = computeAllCardProbabilities(
    mainCards.map((dc) => ({
      cardId: dc.card.id,
      cardName: dc.card.name,
      quantity: dc.quantity,
    })),
    deckSize
  );

  const cardProbabilities = cardStats.map((stat) => ({
    cardId: stat.cardId,
    cardName: stat.cardName,
    copies: stat.copies,
    probabilityInOpeningHand: stat.goingFirst,
    probabilityGoingFirst: stat.goingFirst,
    probabilityGoingSecond: stat.goingSecond,
  }));

  // Estimated combo rate: P(see at least one starter in 5-card hand)
  const comboRate =
    starterCount > 0
      ? groupProbability(deckSize, starterCount, 5)
      : 0;

  // Overall score (0–100): weighted combination of metrics
  const comboScore = comboRate * 40; // 40 pts max
  const brickPenalty = deckSize > 0 ? (brickCount / deckSize) * 20 : 0; // -20 pts max
  const handtrapScore = Math.min(handtrapCount / 9, 1) * 20; // 20 pts max, caps at 9
  const sizeScore = deckSize === 40 ? 20 : deckSize <= 44 ? 15 : deckSize <= 50 ? 10 : 5; // 20 pts max

  const overallScore = Math.round(
    Math.max(0, Math.min(100, comboScore - brickPenalty + handtrapScore + sizeScore))
  );

  return {
    deckSize,
    mainDeckCount: deckSize,
    cardProbabilities,
    monsterCount,
    spellCount,
    trapCount,
    starterCount,
    extenderCount,
    handtrapCount,
    brickCount,
    comboRate,
    overallScore,
  };
}

// ─── YDK Import / Export ──────────────────────────────────────────────────────

/**
 * Export a deck to YDK format (compatible with Dueling Nexus, YGO Omega).
 * YDK is the community standard for deck sharing.
 */
export function exportToYdk(deck: Deck): string {
  const mainIds = deck.main.flatMap((dc) =>
    Array.from({ length: dc.quantity }, () => String(dc.card.id))
  );
  const extraIds = deck.extra.flatMap((dc) =>
    Array.from({ length: dc.quantity }, () => String(dc.card.id))
  );
  const sideIds = deck.side.flatMap((dc) =>
    Array.from({ length: dc.quantity }, () => String(dc.card.id))
  );

  return [
    "#main",
    ...mainIds,
    "#extra",
    ...extraIds,
    "!side",
    ...sideIds,
  ].join("\n");
}

/**
 * Parse YDK format and return card ID arrays per zone.
 * The caller is responsible for fetching card data by ID.
 */
export function parseYdk(ydk: string): {
  main: number[];
  extra: number[];
  side: number[];
} {
  const lines = ydk.split(/\r?\n/).map((l) => l.trim());
  const main: number[] = [];
  const extra: number[] = [];
  const side: number[] = [];

  let zone: "main" | "extra" | "side" = "main";

  for (const line of lines) {
    if (line === "#main") { zone = "main"; continue; }
    if (line === "#extra") { zone = "extra"; continue; }
    if (line === "!side") { zone = "side"; continue; }
    if (line.startsWith("#") || line === "") continue;

    const id = parseInt(line, 10);
    if (!isNaN(id)) {
      if (zone === "main") main.push(id);
      else if (zone === "extra") extra.push(id);
      else side.push(id);
    }
  }

  return { main, extra, side };
}
