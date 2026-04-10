/**
 * Deck store for React Native — identical logic to the web version.
 * Zustand works in RN without changes.
 */

import { create } from "zustand";
import type { Card, DeckZone, CardRole, LabeledDeckCard, GameFormat } from "@yugioh/core";

interface DeckState {
  name: string;
  format: GameFormat;
  main: LabeledDeckCard[];
  extra: LabeledDeckCard[];
  side: LabeledDeckCard[];

  setName: (name: string) => void;
  setFormat: (format: GameFormat) => void;
  addCard: (card: Card, zone?: DeckZone, imageIndex?: number) => void;
  removeCard: (cardId: number, zone: DeckZone) => void;
  setCardRole: (cardId: number, zone: DeckZone, role: CardRole | undefined) => void;
  setCardImageIndex: (cardId: number, zone: DeckZone, imageIndex: number) => void;
  clearDeck: () => void;
}

function defaultZone(card: Card): DeckZone {
  const t = card.type.toLowerCase();
  if (t.includes("fusion") || t.includes("synchro") || t.includes("xyz") || t.includes("link"))
    return "extra";
  return "main";
}

function addToZone(
  arr: LabeledDeckCard[], card: Card, zoneKey: DeckZone, imageIndex: number
): LabeledDeckCard[] {
  const existing = arr.find((dc) => dc.card.id === card.id);
  if (existing) {
    if (existing.quantity >= 3) return arr;
    return arr.map((dc) =>
      dc.card.id === card.id ? { ...dc, quantity: dc.quantity + 1 } : dc
    );
  }
  return [...arr, { card, quantity: 1, zone: zoneKey, selectedImageIndex: imageIndex }];
}

export const useDeckStore = create<DeckState>()((set) => ({
  name: "My Deck",
  format: "tcg",
  main: [],
  extra: [],
  side: [],

  setName: (name) => set({ name }),
  setFormat: (format) => set({ format }),

  addCard: (card, zone, imageIndex = 0) => {
    const target = zone ?? defaultZone(card);
    set((state) => {
      const total =
        (state.main.find((dc) => dc.card.id === card.id)?.quantity ?? 0) +
        (state.extra.find((dc) => dc.card.id === card.id)?.quantity ?? 0) +
        (state.side.find((dc) => dc.card.id === card.id)?.quantity ?? 0);
      if (total >= 3) return state;
      if (target === "main")  return { main:  addToZone(state.main,  card, "main",  imageIndex) };
      if (target === "extra") return { extra: addToZone(state.extra, card, "extra", imageIndex) };
      return                         { side:  addToZone(state.side,  card, "side",  imageIndex) };
    });
  },

  removeCard: (cardId, zone) => {
    set((state) => {
      const remove = (arr: LabeledDeckCard[]) =>
        arr.map((dc) => dc.card.id === cardId ? { ...dc, quantity: dc.quantity - 1 } : dc)
           .filter((dc) => dc.quantity > 0);
      if (zone === "main")  return { main:  remove(state.main) };
      if (zone === "extra") return { extra: remove(state.extra) };
      return                       { side:  remove(state.side) };
    });
  },

  setCardRole: (cardId, zone, role) => {
    set((state) => {
      const update = (arr: LabeledDeckCard[]) =>
        arr.map((dc) => dc.card.id === cardId ? { ...dc, role } : dc);
      if (zone === "main")  return { main:  update(state.main) };
      if (zone === "extra") return { extra: update(state.extra) };
      return                       { side:  update(state.side) };
    });
  },

  setCardImageIndex: (cardId, zone, imageIndex) => {
    set((state) => {
      const update = (arr: LabeledDeckCard[]) =>
        arr.map((dc) => dc.card.id === cardId ? { ...dc, selectedImageIndex: imageIndex } : dc);
      if (zone === "main")  return { main:  update(state.main) };
      if (zone === "extra") return { extra: update(state.extra) };
      return                       { side:  update(state.side) };
    });
  },

  clearDeck: () => set({ main: [], extra: [], side: [] }),
}));
