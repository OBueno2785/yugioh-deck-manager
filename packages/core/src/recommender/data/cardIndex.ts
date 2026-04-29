import type { Card } from "../../types.js";
import type { CardIndex } from "../types.js";

export function buildCardIndex(rawCards: Card[]): CardIndex {
  const byId = new Map<number, Card>();
  const byName = new Map<string, Card>();
  const byArchetype = new Map<string, Card[]>();
  const byType = new Map<string, Card[]>();

  for (const card of rawCards) {
    byId.set(card.id, card);
    byName.set(card.name.toLowerCase(), card);

    if (card.archetype) {
      const bucket = byArchetype.get(card.archetype) ?? [];
      bucket.push(card);
      byArchetype.set(card.archetype, bucket);
    }

    const typeBucket = byType.get(card.type) ?? [];
    typeBucket.push(card);
    byType.set(card.type, typeBucket);
  }

  return { byId, byName, byArchetype, byType, all: rawCards };
}

/**
 * Resolve a list of "Nx Card Name" strings to [cardId, ...] arrays (with copies).
 * Entries that don't match any card in the index are silently skipped.
 */
export function resolveCardEntries(entries: string[], index: CardIndex): number[] {
  const ids: number[] = [];
  for (const entry of entries) {
    const match = entry.match(/^(\d+)x\s+(.+)$/i);
    const copies = match ? parseInt(match[1]!, 10) : 1;
    const name = (match ? match[2]! : entry).trim().toLowerCase();
    const card = index.byName.get(name);
    if (card) {
      for (let i = 0; i < copies; i++) ids.push(card.id);
    }
  }
  return ids;
}
