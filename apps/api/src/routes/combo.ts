/**
 * POST /api/combo/lines
 *   Body: { deckCardIds: number[], handCardIds?: number[] }
 *   Returns: combo paths found in the deck starting from the given hand.
 *
 * POST /api/combo/bridge
 *   Body: { archetypeA: string, archetypeB: string, topN?: number }
 *   Returns: bridge cards + gap analysis between two archetypes.
 *
 * GET /api/combo/graph-stats
 *   Returns: effect graph build stats (node/edge counts).
 */

import { Router } from "express";
import { findComboPaths, findBridges, analyzeSummonPaths } from "@yugioh/core";
import { getGraphStore, getGraphStats } from "../recommender/graphStore.js";
import { getRecommenderStore } from "../recommender/recommenderStore.js";
import { analyzeBridge } from "../llm/strategyAnalyzer.js";

export const comboRouter = Router();

// ─── GET /api/combo/graph-stats ───────────────────────────────────────────────

comboRouter.get("/graph-stats", async (_req, res) => {
  const stats = await getGraphStats();
  if (!stats) {
    res.json({ status: "building", message: "Graph not yet built — trigger a request to warm it up" });
    return;
  }
  res.json({ status: "ready", stats });
});

// ─── POST /api/combo/lines ────────────────────────────────────────────────────

comboRouter.post("/lines", async (req, res) => {
  const { deckCardIds, handCardIds, maxPaths = 10, maxDepth = 6 } = req.body as {
    deckCardIds: number[];
    handCardIds?: number[];
    maxPaths?: number;
    maxDepth?: number;
  };

  if (!Array.isArray(deckCardIds) || deckCardIds.length === 0) {
    res.status(400).json({ error: "deckCardIds must be a non-empty array" });
    return;
  }

  try {
    const { graph } = await getGraphStore();

    // Default hand: first 5 cards of the deck (simulates going first)
    const hand = handCardIds ?? deckCardIds.slice(0, 5);

    const paths = findComboPaths({
      handCardIds: hand,
      deckCardIds,
      graph,
      maxPaths,
      maxDepth,
    });

    // Resolve card names for the response
    const { cardIndex } = await getRecommenderStore();
    const enrichedPaths = paths.map((path) => ({
      ...path,
      starters: path.starters.map((id) => ({
        id,
        name: cardIndex.byId.get(id)?.name ?? `Card #${id}`,
      })),
      steps: path.steps.map((step) => ({
        ...step,
        cardName: cardIndex.byId.get(step.cardId)?.name ?? step.cardName,
        targetCardName: step.targetCardId
          ? (cardIndex.byId.get(step.targetCardId)?.name ?? step.targetCardName)
          : undefined,
      })),
    }));

    res.json({ count: enrichedPaths.length, paths: enrichedPaths });
  } catch (err) {
    res.status(502).json({ error: String(err) });
  }
});

// ─── POST /api/combo/bridge-analyze ──────────────────────────────────────────

comboRouter.post("/bridge-analyze", async (req, res) => {
  const { archetypeA, archetypeB, topN = 10, withLlm = true } = req.body as {
    archetypeA: string;
    archetypeB: string;
    topN?: number;
    withLlm?: boolean;
  };

  if (!archetypeA || !archetypeB) {
    res.status(400).json({ error: "archetypeA and archetypeB are required" });
    return;
  }

  try {
    const [{ graph }, { cardIndex }] = await Promise.all([
      getGraphStore(),
      getRecommenderStore(),
    ]);

    const result = findBridges(archetypeA, archetypeB, cardIndex.all, graph, { topN });

    const base = {
      archetypeA: result.archetypeA,
      archetypeB: result.archetypeB,
      verdict: result.verdict,
      naturalSynergyScore: result.naturalSynergyScore,
      gap: result.gap,
      profileA: { needs: result.profileA.needs, provides: result.profileA.provides },
      profileB: { needs: result.profileB.needs, provides: result.profileB.provides },
      bridgeCards: result.bridgeCards.map((b) => ({
        id: b.card.id,
        name: b.card.name,
        type: b.card.type,
        archetype: b.card.archetype,
        role: b.role,
        filledNeeds: b.filledNeeds,
        synergyScore: b.synergyScore,
        recommendedCopies: b.recommendedCopies,
        explanation: b.explanation,
      })),
      analysis: null as unknown,
    };

    if (withLlm && process.env["ANTHROPIC_API_KEY"]) {
      try {
        base.analysis = await analyzeBridge(result, cardIndex.byId);
      } catch (llmErr) {
        console.error("[combo/bridge-analyze] LLM failed:", llmErr);
        base.analysis = { error: "LLM unavailable", fallback: "Use algorithmic results above" };
      }
    }

    res.json(base);
  } catch (err) {
    res.status(502).json({ error: String(err) });
  }
});

// ─── POST /api/combo/bridge ───────────────────────────────────────────────────

comboRouter.post("/bridge", async (req, res) => {
  const { archetypeA, archetypeB, topN = 10 } = req.body as {
    archetypeA: string;
    archetypeB: string;
    topN?: number;
  };

  if (!archetypeA || !archetypeB) {
    res.status(400).json({ error: "archetypeA and archetypeB are required" });
    return;
  }

  try {
    const [{ graph }, { cardIndex }] = await Promise.all([
      getGraphStore(),
      getRecommenderStore(),
    ]);

    const result = findBridges(archetypeA, archetypeB, cardIndex.all, graph, { topN });
    const summonPaths = analyzeSummonPaths(archetypeA, archetypeB, cardIndex.all);

    res.json({
      archetypeA: result.archetypeA,
      archetypeB: result.archetypeB,
      verdict: result.verdict,
      naturalSynergyScore: result.naturalSynergyScore,
      gap: result.gap,
      profileA: { needs: result.profileA.needs, provides: result.profileA.provides },
      profileB: { needs: result.profileB.needs, provides: result.profileB.provides },
      summonPaths,
      bridgeCards: result.bridgeCards.map((b) => ({
        id: b.card.id,
        name: b.card.name,
        type: b.card.type,
        archetype: b.card.archetype,
        role: b.role,
        filledNeeds: b.filledNeeds,
        synergyScore: b.synergyScore,
        recommendedCopies: b.recommendedCopies,
        explanation: b.explanation,
      })),
    });
  } catch (err) {
    res.status(502).json({ error: String(err) });
  }
});
