/**
 * YGOPRODeck API client for the backend.
 * Results are cached in-memory (NodeCache) and persisted to disk (gzip JSON).
 * On startup the disk cache is used if fresh (<7 days), avoiding a network fetch.
 */

import axios from "axios";
import { getCachedCards, setCachedCards } from "./cache.js";
import {
  CARDS_FILE,
  isFileFresh,
  writeGzipJson,
  readGzipJson,
} from "./recommender/diskCache.js";

const BASE_URL = "https://db.ygoprodeck.com/api/v7";

const CATALOG_KEY = "full_catalog";
const CARD_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RawCard = Record<string, any>;

interface YgoApiResponse {
  data: RawCard[];
}

/** Fetch and cache the full card catalog (~15K cards). */
export async function getFullCatalog(): Promise<RawCard[]> {
  // 1. In-memory cache (fastest, survives for process lifetime)
  const cached = getCachedCards<RawCard[]>(CATALOG_KEY);
  if (cached) return cached;

  // 2. Disk cache (survives restarts, 7-day TTL)
  if (await isFileFresh(CARDS_FILE, CARD_TTL_MS)) {
    try {
      const cards = await readGzipJson<RawCard[]>(CARDS_FILE);
      setCachedCards(CATALOG_KEY, cards);
      console.log(`[catalog] Loaded ${cards.length} cards from disk cache`);
      return cards;
    } catch {
      // corrupted file — fall through to network fetch
    }
  }

  // 3. Network fetch
  console.log("[catalog] Fetching full card catalog from YGOPRODeck...");
  const { data } = await axios.get<YgoApiResponse>(
    `${BASE_URL}/cardinfo.php?misc=yes`
  );
  const cards = data.data;
  setCachedCards(CATALOG_KEY, cards);

  // Persist to disk asynchronously (don't block the response)
  writeGzipJson(CARDS_FILE, cards)
    .then(() => console.log(`[catalog] Saved ${cards.length} cards to disk`))
    .catch((err) => console.error("[catalog] Disk save failed:", err));

  return cards;
}

/** Search cards with query params, caching individual results. */
export async function searchCards(query: Record<string, string>): Promise<RawCard[]> {
  const cacheKey = `search:${JSON.stringify(query)}`;
  const cached = getCachedCards<RawCard[]>(cacheKey);
  if (cached) return cached;

  const params = new URLSearchParams(query).toString();
  const { data } = await axios.get<YgoApiResponse>(
    `${BASE_URL}/cardinfo.php?${params}`
  );
  setCachedCards(cacheKey, data.data);
  return data.data;
}

/** Fetch one card by ID. */
export async function getCardById(id: number): Promise<RawCard | null> {
  const cacheKey = `card:${id}`;
  const cached = getCachedCards<RawCard>(cacheKey);
  if (cached) return cached;

  try {
    const { data } = await axios.get<YgoApiResponse>(
      `${BASE_URL}/cardinfo.php?id=${id}`
    );
    const card = data.data[0] ?? null;
    if (card) setCachedCards(cacheKey, card);
    return card;
  } catch {
    return null;
  }
}
