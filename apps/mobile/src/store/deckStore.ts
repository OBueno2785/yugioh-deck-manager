import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Card, DeckZone, CardRole, LabeledDeckCard, GameFormat } from "@yugioh/core";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SavedDeck {
  id: string;
  name: string;
  format: GameFormat;
  main: LabeledDeckCard[];
  extra: LabeledDeckCard[];
  side: LabeledDeckCard[];
  savedAt: string; // ISO date string
}

interface DeckState {
  // Active deck
  name: string;
  format: GameFormat;
  main: LabeledDeckCard[];
  extra: LabeledDeckCard[];
  side: LabeledDeckCard[];

  // Deck library
  savedDecks: SavedDeck[];

  // Active deck actions
  setName: (name: string) => void;
  setFormat: (format: GameFormat) => void;
  addCard: (card: Card, zone?: DeckZone, imageIndex?: number) => void;
  removeCard: (cardId: number, zone: DeckZone) => void;
  setCardRole: (cardId: number, zone: DeckZone, role: CardRole | undefined) => void;
  setCardImageIndex: (cardId: number, zone: DeckZone, imageIndex: number) => void;
  clearDeck: () => void;

  // Library actions
  saveDeck: () => void;                     // Save current deck to library
  loadDeck: (id: string) => void;           // Load a saved deck as active
  deleteSavedDeck: (id: string) => void;    // Remove from library
  renameSavedDeck: (id: string, name: string) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function defaultZone(card: Card): DeckZone {
  const t = card.type.toLowerCase();
  if (t.includes("fusion") || t.includes("synchro") || t.includes("xyz") || t.includes("link"))
    return "extra";
  return "main";
}

function addToZone(arr: LabeledDeckCard[], card: Card, zoneKey: DeckZone, imageIndex: number): LabeledDeckCard[] {
  const existing = arr.find((dc) => dc.card.id === card.id);
  if (existing) {
    if (existing.quantity >= 3) return arr;
    return arr.map((dc) => dc.card.id === card.id ? { ...dc, quantity: dc.quantity + 1 } : dc);
  }
  return [...arr, { card, quantity: 1, zone: zoneKey, selectedImageIndex: imageIndex }];
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useDeckStore = create<DeckState>()(
  persist(
    (set, get) => ({
      name: "Mi Mazo",
      format: "tcg",
      main: [],
      extra: [],
      side: [],
      savedDecks: [],

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

      saveDeck: () => {
        const { name, format, main, extra, side, savedDecks } = get();
        const id = Date.now().toString();
        const snapshot: SavedDeck = {
          id,
          name,
          format,
          main,
          extra,
          side,
          savedAt: new Date().toISOString(),
        };
        // If a deck with this name already exists, update it; otherwise add new
        const existing = savedDecks.findIndex((d) => d.name === name);
        if (existing >= 0) {
          set({ savedDecks: savedDecks.map((d, i) => i === existing ? { ...snapshot, id: d.id } : d) });
        } else {
          set({ savedDecks: [snapshot, ...savedDecks] });
        }
      },

      loadDeck: (id) => {
        const { savedDecks } = get();
        const deck = savedDecks.find((d) => d.id === id);
        if (deck) {
          set({ name: deck.name, format: deck.format, main: deck.main, extra: deck.extra, side: deck.side });
        }
      },

      deleteSavedDeck: (id) => {
        set((state) => ({ savedDecks: state.savedDecks.filter((d) => d.id !== id) }));
      },

      renameSavedDeck: (id, name) => {
        set((state) => ({
          savedDecks: state.savedDecks.map((d) => d.id === id ? { ...d, name } : d),
        }));
      },
    }),
    {
      name: "yugioh-deck-storage",
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
