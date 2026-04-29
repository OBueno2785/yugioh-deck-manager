import type { Card } from "../types.js";

// ─── Card Index ───────────────────────────────────────────────────────────────

export interface CardIndex {
  byId: Map<number, Card>;
  byName: Map<string, Card>; // lowercase name → card
  byArchetype: Map<string, Card[]>;
  byType: Map<string, Card[]>;
  all: Card[];
}

// ─── Meta Decks ───────────────────────────────────────────────────────────────

export type MetaTier = 1 | 2 | 3;

export interface MetaDeck {
  id: string;
  name: string;
  tier: MetaTier;
  format: "tcg" | "ocg";
  date: string; // "YYYY-MM"
  /** Card IDs repeated by quantity (e.g. 3 copies of card X → ID appears 3 times) */
  main: number[];
  extra: number[];
  archetypes: string[];
}

/** Raw seed entry — uses card names instead of IDs for human maintainability */
export interface MetaDeckTemplate {
  id: string;
  name: string;
  tier: MetaTier;
  format: "tcg" | "ocg";
  date: string;
  archetypes: string[];
  /** Each entry: "3x Card Name" or "1x Card Name" or just "Card Name" (defaults to 1) */
  main: string[];
  extra: string[];
}

// ─── Co-occurrence Matrix ─────────────────────────────────────────────────────

/** Sparse adjacency map: cardId → { neighborId → lift score } */
export type CoOccurrenceMatrix = Map<number, Map<number, number>>;

export interface CoOccurrenceStats {
  totalDecks: number;
  uniqueCards: number;
  matrixSize: number;
  builtAt: Date;
}

// ─── Recommender Store ────────────────────────────────────────────────────────

export interface RecommenderDataStore {
  cardIndex: CardIndex;
  metaDecks: MetaDeck[];
  coOccurrence: CoOccurrenceMatrix;
  stats: CoOccurrenceStats;
}
