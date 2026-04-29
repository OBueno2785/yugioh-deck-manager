import { Router } from "express";
import {
  getRecommenderStore,
  rebuildRecommenderStore,
  lastUnresolvedNames,
} from "../recommender/recommenderStore.js";
import { fetchAllDeckRefs } from "../recommender/sitemapParser.js";
import { scrapeDecks } from "../recommender/deckScraper.js";
import { loadProgress, readAllDecks } from "../recommender/diskCache.js";

// ─── /api/meta-decks ─────────────────────────────────────────────────────────

export const metaDecksRouter = Router();

/** GET /api/meta-decks — list all meta decks with basic stats */
metaDecksRouter.get("/", async (_req, res) => {
  try {
    const { metaDecks } = await getRecommenderStore();

    const summary = metaDecks.map((d) => ({
      id: d.id,
      name: d.name,
      tier: d.tier,
      format: d.format,
      date: d.date,
      archetypes: d.archetypes,
      mainCount: d.main.length,
      extraCount: d.extra.length,
    }));

    res.json({ data: summary, count: summary.length });
  } catch {
    res.status(502).json({ error: "Failed to load meta decks" });
  }
});

/** GET /api/meta-decks/:id — full deck list for one meta deck */
metaDecksRouter.get("/:id", async (req, res) => {
  try {
    const { metaDecks, cardIndex } = await getRecommenderStore();
    const deck = metaDecks.find((d) => d.id === req.params["id"]);

    if (!deck) {
      res.status(404).json({ error: "Meta deck not found" });
      return;
    }

    const resolveIds = (ids: number[]) =>
      ids.map((id) => cardIndex.byId.get(id)).filter(Boolean);

    res.json({
      data: {
        ...deck,
        mainCards: resolveIds([...new Set(deck.main)]),
        extraCards: resolveIds([...new Set(deck.extra)]),
      },
    });
  } catch {
    res.status(502).json({ error: "Failed to load meta deck" });
  }
});

// ─── /api/recommender ────────────────────────────────────────────────────────

export const recommenderRouter = Router();

/** GET /api/recommender/status — build status, matrix stats, unresolved names */
recommenderRouter.get("/status", async (_req, res) => {
  try {
    const { metaDecks, stats } = await getRecommenderStore();
    const progress = await loadProgress();

    res.json({
      status: "ready",
      metaDeckCount: metaDecks.length,
      matrix: {
        totalDecks: stats.totalDecks,
        uniqueCards: stats.uniqueCards,
        matrixSize: stats.matrixSize,
        builtAt: stats.builtAt,
      },
      scrapeProgress: progress
        ? {
            processed: progress.processedDeckIds.length,
            failed: progress.failedDeckIds.length,
            total: progress.totalDeckIds,
            pct: Math.round(
              (progress.processedDeckIds.length / Math.max(progress.totalDeckIds, 1)) * 100
            ),
            lastUpdatedAt: progress.lastUpdatedAt,
          }
        : null,
      unresolvedNames: lastUnresolvedNames,
    });
  } catch {
    res.status(502).json({ error: "Recommender store not ready" });
  }
});

/** POST /api/recommender/rebuild — rebuild co-occurrence matrix from current data */
recommenderRouter.post("/rebuild", async (_req, res) => {
  try {
    const { stats } = await rebuildRecommenderStore();
    res.json({ status: "rebuilt", stats, unresolvedNames: lastUnresolvedNames });
  } catch {
    res.status(502).json({ error: "Rebuild failed" });
  }
});

/**
 * POST /api/recommender/import
 *
 * Launches a full import of all YGOPRODeck deck data:
 *   1. Parse sitemaps 2-22 to collect all deck URLs
 *   2. Scrape each deck page to extract card IDs
 *   3. Persist to data/decks.ndjson
 *   4. Rebuild the co-occurrence matrix
 *
 * Body params (all optional):
 *   maxSitemap  — stop after this sitemap index (1-22, default 22)
 *   concurrency — parallel requests per burst (default 3)
 *   delayMs     — ms between bursts (default 150)
 *   limit       — max decks to scrape (default unlimited)
 */
recommenderRouter.post("/import", async (req, res) => {
  const {
    maxSitemap = 22,
    concurrency = 3,
    delayMs = 150,
    limit,
  } = (req.body ?? {}) as {
    maxSitemap?: number;
    concurrency?: number;
    delayMs?: number;
    limit?: number;
  };

  // Respond immediately — import runs in the background
  res.json({
    status: "started",
    message: "Import running in background. Poll /api/recommender/status for progress.",
    config: { maxSitemap, concurrency, delayMs, limit },
  });

  // Run async in background
  const importOpts = { maxSitemap, concurrency, delayMs, ...(limit !== undefined ? { limit } : {}) };
  runImport(importOpts).catch((err) =>
    console.error("[import] Fatal error:", err)
  );
});

/**
 * POST /api/recommender/import-sitemaps
 *
 * Step 1 only: parse all sitemaps and return the list of deck IDs found.
 * Useful to preview the dataset size before committing to a full scrape.
 */
recommenderRouter.post("/import-sitemaps", async (req, res) => {
  const { maxSitemap = 22 } = (req.body ?? {}) as { maxSitemap?: number };

  try {
    console.log(`[import] Parsing sitemaps 2-${maxSitemap}...`);
    const refs = await fetchAllDeckRefs({
      maxSitemap,
      delayMs: 200,
      onProgress: (idx, found, total) =>
        console.log(`[sitemap] sitemap${idx}.xml → +${found} decks (total: ${total})`),
    });

    res.json({
      totalDecks: refs.length,
      sample: refs.slice(0, 5),
    });
  } catch (err) {
    res.status(502).json({ error: String(err) });
  }
});

/** GET /api/recommender/decks — stats on stored decks */
recommenderRouter.get("/decks", async (_req, res) => {
  try {
    const decks = await readAllDecks();
    res.json({
      count: decks.length,
      sample: decks.slice(0, 3).map((d) => ({
        id: d.id,
        name: d.name,
        mainCount: d.main.length,
        extraCount: d.extra.length,
        fetchedAt: d.fetchedAt,
      })),
    });
  } catch {
    res.status(502).json({ error: "Failed to read stored decks" });
  }
});

// ─── Background import logic ──────────────────────────────────────────────────

async function runImport(opts: {
  maxSitemap: number;
  concurrency: number;
  delayMs: number;
  limit?: number;
}): Promise<void> {
  const t0 = Date.now();
  console.log("[import] Starting deck import...");

  // Step 1: parse sitemaps
  console.log(`[import] Parsing sitemaps 2-${opts.maxSitemap}...`);
  let refs = await fetchAllDeckRefs({
    maxSitemap: opts.maxSitemap,
    delayMs: 200,
    onProgress: (idx, found, total) =>
      console.log(`[sitemap] sitemap${idx}.xml → +${found} decks (total: ${total})`),
  });

  if (opts.limit) refs = refs.slice(0, opts.limit);

  console.log(`[import] Found ${refs.length} deck URLs. Starting scrape...`);

  // Step 2: scrape decks
  const result = await scrapeDecks({
    refs,
    concurrency: opts.concurrency,
    delayMs: opts.delayMs,
    onProgress: (done, total, failed) => {
      if (done % 100 === 0) {
        const pct = ((done / total) * 100).toFixed(1);
        console.log(`[import] ${done}/${total} (${pct}%) — ${failed} failed`);
      }
    },
  });

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(
    `[import] Done in ${elapsed}s — new: ${result.newDecks}, failed: ${result.failed}, skipped: ${result.skipped}`
  );

  // Step 3: rebuild recommender matrix
  console.log("[import] Rebuilding co-occurrence matrix...");
  await rebuildRecommenderStore();
  console.log("[import] Matrix rebuilt. Import complete.");
}
