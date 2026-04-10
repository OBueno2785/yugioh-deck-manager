/**
 * YGOPRODeck API client for the backend.
 * Results are cached to protect rate limits and improve resilience.
 */

import axios from "axios";
import { getCachedCards, setCachedCards } from "./cache.js";

const BASE_URL = "https://db.ygoprodeck.com/api/v7";

const CATALOG_KEY = "full_catalog";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RawCard = Record<string, any>;

interface YgoApiResponse {
  data: RawCard[];
}

/** Fetch and cache the full card catalog. */
export async function getFullCatalog(): Promise<RawCard[]> {
  const cached = getCachedCards<RawCard[]>(CATALOG_KEY);
  if (cached) return cached;

  const { data } = await axios.get<YgoApiResponse>(
    `${BASE_URL}/cardinfo.php?misc=yes`
  );
  setCachedCards(CATALOG_KEY, data.data);
  return data.data;
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
