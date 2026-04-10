/**
 * YGOPRODeck API client.
 * Docs: https://ygoprodeck.com/api-guide/
 *
 * The full card catalog (~3 MB) is fetched once and cached in memory
 * by TanStack Query (staleTime = 1 hour).
 */

import axios from "axios";
import type { Card } from "@yugioh/core";

const BASE_URL = "https://db.ygoprodeck.com/api/v7";

// ─── Raw API Response Types ───────────────────────────────────────────────────

interface YgoApiCard {
  id: number;
  name: string;
  type: string;
  frameType: string;
  desc: string;
  race: string;
  archetype?: string;
  atk?: number;
  def?: number;
  level?: number;
  attribute?: string;
  linkval?: number;
  linkmarkers?: string[];
  scale?: number;
  card_prices: Array<{
    cardmarket_price: string;
    tcgplayer_price: string;
    ebay_price: string;
    amazon_price: string;
    coolstuffinc_price: string;
  }>;
  card_images: Array<{
    id: number;
    image_url: string;
    image_url_small: string;
    image_url_cropped: string;
  }>;
  banlist_info?: {
    ban_tcg?: string;
    ban_ocg?: string;
    ban_goat?: string;
  };
}

interface YgoApiResponse {
  data: YgoApiCard[];
}

// ─── Mapper ───────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapCard(raw: YgoApiCard): Card {
  return raw as unknown as Card;
}

// ─── API Functions ────────────────────────────────────────────────────────────

/** Fetch all cards (full catalog). Cached by TanStack Query. */
export async function fetchAllCards(): Promise<Card[]> {
  const { data } = await axios.get<YgoApiResponse>(
    `${BASE_URL}/cardinfo.php?misc=yes`
  );
  return data.data.map(mapCard);
}

export interface CardSearchParams {
  name?: string;
  type?: string;
  attribute?: string;
  level?: number;
  race?: string;
  archetype?: string;
  atk?: number;
  def?: number;
}

/** Search cards with filters via the API. */
export async function searchCards(params: CardSearchParams): Promise<Card[]> {
  const query = new URLSearchParams();
  if (params.name) query.set("fname", params.name);
  if (params.type) query.set("type", params.type);
  if (params.attribute) query.set("attribute", params.attribute);
  if (params.level !== undefined) query.set("level", String(params.level));
  if (params.race) query.set("race", params.race);
  if (params.archetype) query.set("archetype", params.archetype);

  const { data } = await axios.get<YgoApiResponse>(
    `${BASE_URL}/cardinfo.php?${query.toString()}`
  );
  return data.data.map(mapCard);
}

/** Fetch a single card by exact ID. */
export async function fetchCardById(id: number): Promise<Card> {
  const { data } = await axios.get<YgoApiResponse>(
    `${BASE_URL}/cardinfo.php?id=${id}`
  );
  const card = data.data[0];
  if (!card) throw new Error(`Card ${id} not found`);
  return mapCard(card);
}

/**
 * Fetch a card with full set/rarity data.
 * Uses ?cardsets=yes — only called on demand (CardDetail), not in the catalog.
 */
export async function fetchCardWithSets(id: number): Promise<Card> {
  const { data } = await axios.get<YgoApiResponse>(
    `${BASE_URL}/cardinfo.php?id=${id}&cardsets=yes`
  );
  const card = data.data[0];
  if (!card) throw new Error(`Card ${id} not found`);
  return mapCard(card);
}

/** Fetch multiple cards by ID array (batch). */
export async function fetchCardsByIds(ids: number[]): Promise<Card[]> {
  if (ids.length === 0) return [];
  // YGOPRODeck supports comma-separated IDs
  const { data } = await axios.get<YgoApiResponse>(
    `${BASE_URL}/cardinfo.php?id=${ids.join(",")}`
  );
  return data.data.map(mapCard);
}
