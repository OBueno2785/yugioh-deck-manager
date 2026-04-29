/**
 * Parses YGOPRODeck sitemaps to extract all deck page URLs and IDs.
 *
 * YGOPRODeck deck URLs follow the pattern:
 *   https://ygoprodeck.com/deck/[deck-name-slug]-[numeric-id]
 *
 * Sitemaps 2-22 at https://ygoprodeck.com/sitemapN.xml contain these pages.
 */

import axios from "axios";

const SITEMAP_BASE = "https://ygoprodeck.com/sitemap";
// Sitemaps known to contain deck pages (discovered by inspection)
const DECK_SITEMAP_RANGE = { start: 2, end: 22 };

const DECK_URL_PATTERN = /https:\/\/ygoprodeck\.com\/deck\/(.+?)-(\d+)\s*$/;

export interface DeckRef {
  id: number;
  slug: string;
  url: string;
}

/** Extract deck refs from a single sitemap XML string. */
function parseSitemapXml(xml: string): DeckRef[] {
  const refs: DeckRef[] = [];
  // Match all <loc> URLs
  const locMatches = xml.matchAll(/<loc>(https:\/\/ygoprodeck\.com\/deck\/[^<]+)<\/loc>/g);
  for (const [, url] of locMatches) {
    if (!url) continue;
    const m = url.trim().match(DECK_URL_PATTERN);
    if (m) {
      refs.push({ id: parseInt(m[2]!, 10), slug: m[1]!, url: url.trim() });
    }
  }
  return refs;
}

export interface SitemapFetchOptions {
  /** Only fetch sitemaps up to this index (for testing). Default: all 22. */
  maxSitemap?: number;
  /** ms to wait between sitemap requests. Default: 200. */
  delayMs?: number;
  onProgress?: (sitemapIndex: number, found: number, total: number) => void;
}

/** Fetch all deck refs from YGOPRODeck sitemaps. */
export async function fetchAllDeckRefs(
  options: SitemapFetchOptions = {}
): Promise<DeckRef[]> {
  const { maxSitemap = DECK_SITEMAP_RANGE.end, delayMs = 200, onProgress } = options;
  const allRefs: DeckRef[] = [];
  const seenIds = new Set<number>();

  for (let i = DECK_SITEMAP_RANGE.start; i <= maxSitemap; i++) {
    const url = `${SITEMAP_BASE}${i}.xml`;
    try {
      const { data: xml } = await axios.get<string>(url, {
        responseType: "text",
        timeout: 15_000,
        headers: { "User-Agent": "YugiohDeckManager/1.0 (research)" },
      });

      const refs = parseSitemapXml(xml);
      let added = 0;
      for (const ref of refs) {
        if (!seenIds.has(ref.id)) {
          seenIds.add(ref.id);
          allRefs.push(ref);
          added++;
        }
      }

      onProgress?.(i, added, allRefs.length);
    } catch (err) {
      console.warn(`[sitemap] Failed to fetch sitemap${i}.xml:`, (err as Error).message);
    }

    if (i < maxSitemap) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  return allRefs;
}
