import { create } from "zustand";
import { persist } from "zustand/middleware";
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
  importYdk: (main: number[], extra: number[], side: number[], cards: Card[]) => void;
}

function defaultZone(card: Card): DeckZone {
  const type = card.type.toLowerCase();
  if (
    type.includes("fusion") ||
    type.includes("synchro") ||
    type.includes("xyz") ||
    type.includes("link")
  ) return "extra";
  return "main";
}

function addToZone(
  zone: LabeledDeckCard[],
  card: Card,
  zoneKey: DeckZone,
  imageIndex: number,
  maxCopies = 3
): LabeledDeckCard[] {
  const existing = zone.find((dc) => dc.card.id === card.id);
  if (existing) {
    if (existing.quantity >= maxCopies) return zone;
    // Preserve existing imageIndex unless a new one is explicitly set
    const newImageIndex = imageIndex > 0 ? imageIndex : existing.selectedImageIndex ?? 0;
    return zone.map((dc) =>
      dc.card.id === card.id
        ? { ...dc, quantity: dc.quantity + 1, selectedImageIndex: newImageIndex }
        : dc
    );
  }
  return [...zone, { card, quantity: 1, zone: zoneKey, selectedImageIndex: imageIndex }];
}

function removeFromZone(zone: LabeledDeckCard[], cardId: number): LabeledDeckCard[] {
  return zone
    .map((dc) => dc.card.id === cardId ? { ...dc, quantity: dc.quantity - 1 } : dc)
    .filter((dc) => dc.quantity > 0);
}

export const useDeckStore = create<DeckState>()(
  persist(
    (set) => ({
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
          const mainQty  = state.main.find((dc) => dc.card.id === card.id)?.quantity ?? 0;
          const extraQty = state.extra.find((dc) => dc.card.id === card.id)?.quantity ?? 0;
          const sideQty  = state.side.find((dc) => dc.card.id === card.id)?.quantity ?? 0;
          if (mainQty + extraQty + sideQty >= 3) return state;

          if (target === "main")  return { main:  addToZone(state.main,  card, "main",  imageIndex) };
          if (target === "extra") return { extra: addToZone(state.extra, card, "extra", imageIndex) };
          return                         { side:  addToZone(state.side,  card, "side",  imageIndex) };
        });
      },

      removeCard: (cardId, zone) => {
        set((state) => {
          if (zone === "main")  return { main:  removeFromZone(state.main,  cardId) };
          if (zone === "extra") return { extra: removeFromZone(state.extra, cardId) };
          return                       { side:  removeFromZone(state.side,  cardId) };
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

      importYdk: (mainIds, extraIds, sideIds, cards) => {
        const byId = new Map(cards.map((c) => [c.id, c]));

        function buildZone(ids: number[], zone: DeckZone): LabeledDeckCard[] {
          const counts = new Map<number, number>();
          for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
          return Array.from(counts.entries())
            .map(([id, quantity]) => {
              const card = byId.get(id);
              if (!card) return null;
              return { card, quantity, zone, selectedImageIndex: 0 } as LabeledDeckCard;
            })
            .filter((dc): dc is LabeledDeckCard => dc !== null);
        }

        set({
          main:  buildZone(mainIds,  "main"),
          extra: buildZone(extraIds, "extra"),
          side:  buildZone(sideIds,  "side"),
        });
      },
    }),
    {
      name: "ygo-deck",
      partialize: (state) => ({ name: state.name, format: state.format }),
    }
  )
);
