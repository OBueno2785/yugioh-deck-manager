/**
 * In-memory cache with TTL.
 * Wraps NodeCache with typed helpers.
 */

import NodeCache from "node-cache";

// Card data: 7 days (changes rarely)
const CARD_TTL = 60 * 60 * 24 * 7;
// Price data: 24 hours (changes daily)
const PRICE_TTL = 60 * 60 * 24;

const cardCache = new NodeCache({ stdTTL: CARD_TTL, useClones: false });
const priceCache = new NodeCache({ stdTTL: PRICE_TTL, useClones: false });

export function getCachedCards<T>(key: string): T | undefined {
  return cardCache.get<T>(key);
}

export function setCachedCards<T>(key: string, value: T): void {
  cardCache.set(key, value);
}

export function getCachedPrices<T>(key: string): T | undefined {
  return priceCache.get<T>(key);
}

export function setCachedPrices<T>(key: string, value: T): void {
  priceCache.set(key, value);
}

export function getCacheStats() {
  return {
    cards: cardCache.getStats(),
    prices: priceCache.getStats(),
  };
}
