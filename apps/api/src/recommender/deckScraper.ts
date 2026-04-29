/**
 * Scrapes deck card lists from YGOPRODeck deck pages.
 *
 * Each deck page embeds card IDs in anchor hrefs as:
 *   /card/?search=<cardId>
 *
 * Cards are grouped into zones by their surrounding section.
 * The main/extra/side boundaries are determined by section headings.
 */

import axios from "axios";
import * as cheerio from "cheerio";
import type { StoredDeck } from "./diskCache.js";
import type { DeckRef } from "./sitemapParser.js";
import {
  appendDeck,
  loadProgress,
  saveProgress,
  readAllDecks,
  type ScrapeProgress,
} from "./diskCache.js";

const CARD_SEARCH_PATTERN = /\/card\/\?search=(\d+)/;
const YGOPRO_BASE = "https://ygoprodeck.com";

// ─── Single deck scrape ────────────────────────────────────────────────────────

/** Fetch and parse a single deck page. Returns null on failure. */
export async function scrapeDeckPage(ref: DeckRef): Promise<StoredDeck | null> {
  try {
    const { data: html } = await axios.get<string>(`${YGOPRO_BASE}/deck/${ref.slug}-${ref.id}`, {
      timeout: 15_000,
      headers: {
        "User-Agent": "YugiohDeckManager/1.0 (research)",
        Accept: "text/html",
      },
    });

    return parseDeckHtml(html, ref);
  } catch {
    return null;
  }
}

function parseDeckHtml(html: string, ref: DeckRef): StoredDeck {
  const $ = cheerio.load(html);
  const main: number[] = [];
  const extra: number[] = [];
  const side: number[] = [];

  // YGOPRODeck deck pages have sections with headings like "Main Deck", "Extra Deck", "Side Deck"
  // Each section contains <a href="/card/?search=ID"> elements for every card copy.
  let currentZone: "main" | "extra" | "side" = "main";

  $("*").each((_i, el) => {
    const tag = el.type === "tag" ? el.name : null;
    if (!tag) return;

    const text = $(el).text().trim().toLowerCase();

    // Zone boundary detection from section headings
    if (tag.match(/^h[1-6]$/) || $(el).hasClass("deck-section-title")) {
      if (text.includes("extra deck")) currentZone = "extra";
      else if (text.includes("side deck")) currentZone = "side";
      else if (text.includes("main deck")) currentZone = "main";
      return;
    }

    // Card link extraction
    if (tag === "a") {
      const href = $(el).attr("href") ?? "";
      const m = href.match(CARD_SEARCH_PATTERN);
      if (m) {
        const cardId = parseInt(m[1]!, 10);
        if (currentZone === "main") main.push(cardId);
        else if (currentZone === "extra") extra.push(cardId);
        else side.push(cardId);
      }
    }
  });

  // Fallback: if cheerio traversal order didn't find zones, use global regex
  // and split by Extra Deck monsters (which we know can be identified later)
  if (main.length === 0) {
    const allIds = [...html.matchAll(/\/card\/\?search=(\d+)/g)].map((m) =>
      parseInt(m[1]!, 10)
    );
    main.push(...allIds);
  }

  return {
    id: ref.id,
    name: ref.slug.replace(/-/g, " "),
    main,
    extra,
    side,
    fetchedAt: new Date().toISOString(),
  };
}

// ─── Batch scraper with resume ────────────────────────────────────────────────

export interface ScraperOptions {
  /** Deck refs to scrape. */
  refs: DeckRef[];
  /** Max concurrent requests. Default: 3. */
  concurrency?: number;
  /** ms between each request burst. Default: 100. */
  delayMs?: number;
  /** Save progress every N decks. Default: 50. */
  checkpointEvery?: number;
  onProgress?: (done: number, total: number, failed: number) => void;
}

/** Scrape all deck refs, skipping already-processed IDs. Resumes on restart. */
export async function scrapeDecks(options: ScraperOptions): Promise<{
  newDecks: number;
  failed: number;
  skipped: number;
}> {
  const { refs, concurrency = 3, delayMs = 100, checkpointEvery = 50, onProgress } = options;

  let progress = await loadProgress();
  const processedSet = new Set(progress?.processedDeckIds ?? []);
  const failedSet = new Set(progress?.failedDeckIds ?? []);

  if (!progress) {
    progress = {
      totalDeckIds: refs.length,
      processedDeckIds: [],
      failedDeckIds: [],
      startedAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
    };
  }

  const pending = refs.filter((r) => !processedSet.has(r.id) && !failedSet.has(r.id));
  let newDecks = 0;
  let failed = 0;
  const skipped = refs.length - pending.length;

  for (let i = 0; i < pending.length; i += concurrency) {
    const batch = pending.slice(i, i + concurrency);
    const results = await Promise.all(batch.map((ref) => scrapeDeckPage(ref)));

    for (let j = 0; j < batch.length; j++) {
      const ref = batch[j]!;
      const deck = results[j];

      if (deck && deck.main.length >= 20) {
        await appendDeck(deck);
        processedSet.add(ref.id);
        progress.processedDeckIds.push(ref.id);
        newDecks++;
      } else {
        failedSet.add(ref.id);
        progress.failedDeckIds.push(ref.id);
        failed++;
      }
    }

    onProgress?.(processedSet.size + failedSet.size, refs.length, failed);

    // Checkpoint
    if ((i + concurrency) % checkpointEvery === 0) {
      progress.lastUpdatedAt = new Date().toISOString();
      await saveProgress(progress);
    }

    if (i + concurrency < pending.length) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  progress.lastUpdatedAt = new Date().toISOString();
  await saveProgress(progress);

  return { newDecks, failed, skipped };
}

// ─── Load all stored decks for the recommender ────────────────────────────────

/**
 * Convert StoredDecks to the MetaDeck format used by the recommender.
 * Since these are community decks (not curated meta), we assign tier=3 by default.
 */
export async function loadStoredDecksAsMetaDecks() {
  const stored = await readAllDecks();
  return stored.map((d) => ({
    id: `ygopro-${d.id}`,
    name: d.name,
    tier: 3 as const,
    format: "tcg" as const,
    date: d.fetchedAt.slice(0, 7),
    archetypes: [] as string[],
    main: d.main,
    extra: d.extra,
  }));
}
