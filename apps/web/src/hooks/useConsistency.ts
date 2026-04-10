/**
 * Wraps the core consistency engine with React state.
 * Recomputes only when deck cards change.
 */

import { useMemo } from "react";
import {
  generateConsistencyReport,
  validateDeck,
  probabilityAtLeast,
  formatPercent,
  type ConsistencyReport,
  type DeckValidationResult,
  type LabeledDeckCard,
  type GameFormat,
  type CardRole,
} from "@yugioh/core";

export interface CardProbRow {
  cardId: number;
  cardName: string;
  copies: number;
  role: CardRole | undefined;
  goingFirst: number;
  goingSecond: number;
  pctFirst: string;
  pctSecond: string;
}

export interface GroupProbRow {
  role: CardRole;
  label: string;
  totalCopies: number;
  goingFirst: number;
  goingSecond: number;
  pctFirst: string;
  pctSecond: string;
}

export interface ConsistencyData {
  report: ConsistencyReport;
  validation: DeckValidationResult;
  cardRows: CardProbRow[];
  groupRows: GroupProbRow[];
  deckSize: number;
  isEmpty: boolean;
}

const ROLE_LABELS: Record<CardRole, string> = {
  starter:    "Starters",
  extender:   "Extenders",
  handtrap:   "Handtraps",
  boardbreak: "Board Breakers",
  garnets:    "Garnets / Bricks",
  engine:     "Engine Pieces",
  tech:       "Tech Cards",
};

export function useConsistency(
  main: LabeledDeckCard[],
  extra: LabeledDeckCard[],
  side: LabeledDeckCard[],
  format: GameFormat
): ConsistencyData {
  return useMemo(() => {
    const deckSize = main.reduce((s, c) => s + c.quantity, 0);
    const isEmpty = deckSize === 0;

    const fakeDeck = {
      id: "analysis",
      name: "Analysis",
      format,
      main,
      extra,
      side,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const report = generateConsistencyReport(fakeDeck);
    const validation = validateDeck(fakeDeck);

    // Per-card rows sorted by going-first probability descending
    const cardRows: CardProbRow[] = main
      .map((dc) => {
        const g1 = probabilityAtLeast(deckSize, dc.quantity, 5);
        const g2 = probabilityAtLeast(deckSize, dc.quantity, 6);
        return {
          cardId: dc.card.id,
          cardName: dc.card.name,
          copies: dc.quantity,
          role: dc.role,
          goingFirst: g1,
          goingSecond: g2,
          pctFirst: formatPercent(g1),
          pctSecond: formatPercent(g2),
        };
      })
      .sort((a, b) => b.goingFirst - a.goingFirst);

    // Group rows: aggregate copies per role, compute group probability
    const roleMap = new Map<CardRole, number>();
    for (const dc of main) {
      if (dc.role) {
        roleMap.set(dc.role, (roleMap.get(dc.role) ?? 0) + dc.quantity);
      }
    }

    const groupRows: GroupProbRow[] = Array.from(roleMap.entries())
      .map(([role, totalCopies]) => {
        const g1 = probabilityAtLeast(deckSize, totalCopies, 5);
        const g2 = probabilityAtLeast(deckSize, totalCopies, 6);
        return {
          role,
          label: ROLE_LABELS[role],
          totalCopies,
          goingFirst: g1,
          goingSecond: g2,
          pctFirst: formatPercent(g1),
          pctSecond: formatPercent(g2),
        };
      })
      .sort((a, b) => b.goingFirst - a.goingFirst);

    return { report, validation, cardRows, groupRows, deckSize, isEmpty };
  }, [main, extra, side, format]);
}
