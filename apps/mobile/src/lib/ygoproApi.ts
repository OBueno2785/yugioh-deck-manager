/**
 * YGOPRODeck API client for React Native.
 * Identical logic to the web version — axios works in RN out of the box.
 */

import axios from "axios";
import type { Card } from "@yugioh/core";

const BASE_URL = "https://db.ygoprodeck.com/api/v7";

interface YgoApiResponse {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapCard(raw: any): Card {
  return raw as Card;
}

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
}

export async function searchCards(params: CardSearchParams): Promise<Card[]> {
  const query = new URLSearchParams();
  if (params.name)      query.set("fname", params.name);
  if (params.type)      query.set("type",  params.type);
  if (params.attribute) query.set("attribute", params.attribute);
  if (params.level !== undefined) query.set("level", String(params.level));
  if (params.race)      query.set("race",  params.race);
  if (params.archetype) query.set("archetype", params.archetype);

  const { data } = await axios.get<YgoApiResponse>(
    `${BASE_URL}/cardinfo.php?${query.toString()}`
  );
  return data.data.map(mapCard);
}

export async function fetchCardWithSets(id: number): Promise<Card> {
  const { data } = await axios.get<YgoApiResponse>(
    `${BASE_URL}/cardinfo.php?id=${id}&cardsets=yes`
  );
  const card = data.data[0];
  if (!card) throw new Error(`Card ${id} not found`);
  return mapCard(card);
}
