import { buildCoOccurrenceMatrix } from "@yugioh/core";
import type { RecommenderDataStore } from "@yugioh/core";
import { fetchMetaDecks } from "./metaDeckFetcher.js";
import { readAllDecks } from "./diskCache.js";
import { loadStoredDecksAsMetaDecks } from "./deckScraper.js";

let store: RecommenderDataStore | null = null;
let buildPromise: Promise<RecommenderDataStore> | null = null;

/** Unresolved card name entries from the last build (for diagnostics). */
export let lastUnresolvedNames: string[] = [];

async function build(): Promise<RecommenderDataStore> {
  // Always resolve the card index from the seed (guarantees types/archetypes)
  const { cardIndex, unresolvedNames } = await fetchMetaDecks();
  lastUnresolvedNames = unresolvedNames;

  // Prefer disk-stored decks (scraped from YGOPRODeck) when available
  const storedDecks = await readAllDecks();
  let metaDecks;

  if (storedDecks.length > 0) {
    console.log(`[recommender] Using ${storedDecks.length} scraped decks from disk`);
    metaDecks = await loadStoredDecksAsMetaDecks();
  } else {
    // Fall back to seed decks (built-in meta deck templates)
    const seed = await fetchMetaDecks();
    metaDecks = seed.decks;
    console.log(`[recommender] Using ${metaDecks.length} seed decks (no scraped data yet)`);
  }

  const { matrix, stats } = buildCoOccurrenceMatrix(metaDecks);

  return { cardIndex, metaDecks, coOccurrence: matrix, stats };
}

/**
 * Returns the recommender store, initializing it on first call.
 * Concurrent callers share the same build promise — the catalog is fetched once.
 */
export async function getRecommenderStore(): Promise<RecommenderDataStore> {
  if (store) return store;
  if (!buildPromise) buildPromise = build().then((s) => { store = s; return s; });
  return buildPromise;
}

/** Force a full rebuild (called after import completes). */
export async function rebuildRecommenderStore(): Promise<RecommenderDataStore> {
  store = null;
  buildPromise = null;
  return getRecommenderStore();
}
