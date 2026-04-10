/**
 * Computes price metrics from the cards already in the deck store.
 * No extra API calls needed — YGOPRODeck embeds prices in every card object.
 */

import { useMemo } from "react";
import type { LabeledDeckCard } from "@yugioh/core";

export type PriceSrc = "tcgplayer" | "cardmarket";

export interface CardPriceRow {
  cardId: number;
  cardName: string;
  quantity: number;
  zone: "main" | "extra" | "side";
  unitTcg: number;
  unitCm: number;
  totalTcg: number;
  totalCm: number;
}

export interface ZonePriceSummary {
  label: string;
  totalTcg: number;
  totalCm: number;
  cardCount: number;
}

export interface DeckPriceResult {
  rows: CardPriceRow[];
  zones: ZonePriceSummary[];
  grandTotalTcg: number;
  grandTotalCm: number;
  mostExpensive: CardPriceRow | null;  // single most expensive card (unit price)
  cheapestAlternatives: CardPriceRow[]; // cards > $10 with cm < tcg (potential savings)
}

function parsePrice(raw: string | undefined): number {
  const n = parseFloat(raw ?? "0");
  return isNaN(n) ? 0 : n;
}

function buildRows(cards: LabeledDeckCard[], zone: "main" | "extra" | "side"): CardPriceRow[] {
  return cards.map((dc) => {
    const p = dc.card.card_prices?.[0];
    const unitTcg = parsePrice(p?.tcgplayer_price);
    const unitCm  = parsePrice(p?.cardmarket_price);
    return {
      cardId:   dc.card.id,
      cardName: dc.card.name,
      quantity: dc.quantity,
      zone,
      unitTcg,
      unitCm,
      totalTcg: unitTcg * dc.quantity,
      totalCm:  unitCm  * dc.quantity,
    };
  });
}

export function useDeckPrices(
  main: LabeledDeckCard[],
  extra: LabeledDeckCard[],
  side: LabeledDeckCard[]
): DeckPriceResult {
  return useMemo(() => {
    const mainRows  = buildRows(main,  "main");
    const extraRows = buildRows(extra, "extra");
    const sideRows  = buildRows(side,  "side");
    const rows = [...mainRows, ...extraRows, ...sideRows];

    const sum = (arr: CardPriceRow[], key: "totalTcg" | "totalCm") =>
      arr.reduce((s, r) => s + r[key], 0);

    const zones: ZonePriceSummary[] = [
      { label: "Main Deck",  totalTcg: sum(mainRows,  "totalTcg"), totalCm: sum(mainRows,  "totalCm"), cardCount: main.reduce((s, c) => s + c.quantity, 0)  },
      { label: "Extra Deck", totalTcg: sum(extraRows, "totalTcg"), totalCm: sum(extraRows, "totalCm"), cardCount: extra.reduce((s, c) => s + c.quantity, 0) },
      { label: "Side Deck",  totalTcg: sum(sideRows,  "totalTcg"), totalCm: sum(sideRows,  "totalCm"), cardCount: side.reduce((s, c) => s + c.quantity, 0)  },
    ];

    const grandTotalTcg = sum(rows, "totalTcg");
    const grandTotalCm  = sum(rows, "totalCm");

    const sortedByUnit = [...rows].sort((a, b) => b.unitTcg - a.unitTcg);
    const mostExpensive = sortedByUnit[0] ?? null;

    // Cards worth more than $10 where Cardmarket is meaningfully cheaper (>15% savings)
    const cheapestAlternatives = rows.filter(
      (r) => r.unitTcg > 10 && r.unitCm > 0 && r.unitCm < r.unitTcg * 0.85
    );

    return { rows, zones, grandTotalTcg, grandTotalCm, mostExpensive, cheapestAlternatives };
  }, [main, extra, side]);
}
