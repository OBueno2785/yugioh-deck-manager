import { buildCardIndex, resolveCardEntries } from "@yugioh/core";
import type { CardIndex, MetaDeck, MetaDeckTemplate } from "@yugioh/core";
import { META_DECKS_SEED } from "../data/metaDecksSeed.js";
import { getFullCatalog } from "../ygoproClient.js";

/**
 * Resolves a MetaDeckTemplate (card names) into a MetaDeck (card IDs) using
 * the provided card index. Cards whose names don't match are skipped.
 */
function resolveTemplate(template: MetaDeckTemplate, index: CardIndex): MetaDeck {
  return {
    id: template.id,
    name: template.name,
    tier: template.tier,
    format: template.format,
    date: template.date,
    archetypes: template.archetypes,
    main: resolveCardEntries(template.main, index),
    extra: resolveCardEntries(template.extra, index),
  };
}

/** Returns resolved MetaDeck[] from the seed, using the full card catalog. */
export async function fetchMetaDecks(): Promise<{
  decks: MetaDeck[];
  cardIndex: CardIndex;
  unresolvedNames: string[];
}> {
  const rawCards = await getFullCatalog();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cardIndex = buildCardIndex(rawCards as any);

  const unresolvedNames: string[] = [];
  const decks: MetaDeck[] = [];

  for (const template of META_DECKS_SEED) {
    const allEntries = [...template.main, ...template.extra];
    for (const entry of allEntries) {
      const match = entry.match(/^(\d+)x\s+(.+)$/i);
      const name = (match ? match[2]! : entry).trim().toLowerCase();
      if (!cardIndex.byName.get(name)) {
        unresolvedNames.push(`[${template.name}] ${entry}`);
      }
    }
    decks.push(resolveTemplate(template, cardIndex));
  }

  // Filter out decks that resolved to fewer than 20 main cards (too sparse to be useful)
  const validDecks = decks.filter((d) => d.main.length >= 20);

  return { decks: validDecks, cardIndex, unresolvedNames };
}
