/**
 * POST /api/recommend
 *
 * Full pipeline: algorithmic scoring + Claude narration.
 *
 * Body:
 *   deckCardIds   number[]   — card IDs (with duplicates for copies)
 *   topN          number?    — max recommendations (default 20)
 *   archetypeB    string?    — bridge analysis target archetype
 *   includeExtras boolean?   — include Extra Deck monsters in recs (default false)
 *   withLlm       boolean?   — include Claude narration (default true, requires API key)
 *   weights       object?    — custom scorer weights
 */

import { Router } from "express";
import { scoreCandidate, findComboPaths, findBridges, analyzeSummonPaths } from "@yugioh/core";
import type { ScorerWeights, CandidateScore, ComboPath } from "@yugioh/core";
import { getRecommenderStore } from "../recommender/recommenderStore.js";
import { getGraphStore } from "../recommender/graphStore.js";
import { analyzeDeck, analyzeBridge } from "../llm/strategyAnalyzer.js";

export const recommendRouter = Router();

const EXTRA_DECK_TYPES = new Set([
  "Fusion Monster", "Synchro Monster", "XYZ Monster", "Link Monster",
  "Synchro Tuner Monster", "Pendulum Effect Fusion Monster",
  "Fusion Pendulum Monster", "Synchro Pendulum Monster", "XYZ Pendulum Monster",
]);

function serializeBridgeResult(result: ReturnType<typeof findBridges>, allCards: Parameters<typeof analyzeSummonPaths>[2], topN = 6) {
  const summonPaths = analyzeSummonPaths(result.archetypeA, result.archetypeB, allCards);
  return {
    archetypeA: result.archetypeA,
    archetypeB: result.archetypeB,
    verdict: result.verdict,
    naturalSynergyScore: result.naturalSynergyScore,
    gap: result.gap,
    profileA: { needs: result.profileA.needs, provides: result.profileA.provides },
    profileB: { needs: result.profileB.needs, provides: result.profileB.provides },
    summonPaths,
    bridgeCards: result.bridgeCards.slice(0, topN).map((b) => ({
      id: b.card.id,
      name: b.card.name,
      type: b.card.type,
      archetype: b.card.archetype,
      race: b.card.race,
      attribute: b.card.attribute,
      atk: b.card.atk,
      def: b.card.def,
      level: b.card.level,
      desc: b.card.desc,
      role: b.role,
      filledNeeds: b.filledNeeds,
      synergyScore: b.synergyScore,
      recommendedCopies: b.recommendedCopies,
      explanation: b.explanation,
    })),
  };
}

recommendRouter.post("/", async (req, res) => {
  const {
    deckCardIds,
    topN = 20,
    archetypeB,
    includeExtras = false,
    withLlm = true,
    weights,
  } = req.body as {
    deckCardIds: number[];
    topN?: number;
    archetypeB?: string;
    includeExtras?: boolean;
    withLlm?: boolean;
    weights?: ScorerWeights;
  };

  if (!Array.isArray(deckCardIds) || deckCardIds.length < 10) {
    res.status(400).json({ error: "deckCardIds must be an array of at least 10 card IDs" });
    return;
  }

  try {
    const [{ cardIndex, coOccurrence, metaDecks }, { graph }] = await Promise.all([
      getRecommenderStore(),
      getGraphStore(),
    ]);

    const deckIdSet = new Set(deckCardIds);
    const deckCards = [...deckIdSet]
      .map((id) => cardIndex.byId.get(id))
      .filter((c): c is NonNullable<typeof c> => c !== undefined);

    // ── Algorithmic scoring ───────────────────────────────────────────────────
    const candidates = cardIndex.all.filter((c) => {
      if (deckIdSet.has(c.id)) return false;
      if (c.type === "Token" || c.type === "Skill Card") return false;
      if (!includeExtras && EXTRA_DECK_TYPES.has(c.type)) return false;
      return true;
    });

    const recommendations: CandidateScore[] = candidates
      .map((c) => scoreCandidate(c, deckCardIds, deckCards, coOccurrence, cardIndex, weights))
      .filter((s) => s.totalScore > 5)
      .sort((a, b) => b.totalScore - a.totalScore)
      .slice(0, topN);

    // ── Combo path finding ────────────────────────────────────────────────────
    const sampleHand = [...deckIdSet].slice(0, 5);
    const comboPaths: ComboPath[] = findComboPaths({
      handCardIds: sampleHand,
      deckCardIds: [...deckIdSet],
      graph,
      maxPaths: 8,
      maxDepth: 6,
    });

    // ── Archetype distribution ────────────────────────────────────────────────
    const archetypeCounts = new Map<string, number>();
    for (const card of deckCards) {
      if (card.archetype) archetypeCounts.set(card.archetype, (archetypeCounts.get(card.archetype) ?? 0) + 1);
    }
    const deckArchetypeList = [...archetypeCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([archetype, count]) => ({ archetype, count }));

    // ── External bridge analysis (optional archetypeB param) ─────────────────
    const primaryArchetype = deckArchetypeList[0]?.archetype ?? "Unknown";
    const bridgeResult = archetypeB
      ? findBridges(primaryArchetype, archetypeB, cardIndex.all, graph, { topN: 8 })
      : null;

    // ── Intra-deck bridge analysis (between the deck's own archetypes) ────────
    const topArchetypes = deckArchetypeList
      .filter((a) => a.count >= 2)   // only archetypes with ≥2 cards are real engines
      .slice(0, 4)
      .map((a) => a.archetype);

    const intraBridges: ReturnType<typeof serializeBridgeResult>[] = [];
    for (let i = 0; i < topArchetypes.length - 1; i++) {
      for (let j = i + 1; j < topArchetypes.length; j++) {
        const a = topArchetypes[i];
        const b = topArchetypes[j];
        if (a && b) {
          const result = findBridges(a, b, cardIndex.all, graph, { topN: 5 });
          intraBridges.push(serializeBridgeResult(result, cardIndex.all, 5));
        }
      }
    }

    // ── Base response (always returned) ──────────────────────────────────────
    const base = {
      deckSize: deckCardIds.length,
      uniqueCards: deckIdSet.size,
      deckArchetypes: deckArchetypeList,
      matrixDecks: metaDecks.length,
      recommendations: recommendations.map((s) => ({
        id: s.card.id,
        name: s.card.name,
        type: s.card.type,
        archetype: s.card.archetype,
        score: s.totalScore,
        signals: {
          coOccurrence: s.coOccurrenceScore,
          archetype: s.archetypeScore,
          roleGap: s.roleGapScore,
        },
        topLiftPartner: s.topLiftPartner,
        reason: s.reason,
      })),
      comboPaths: comboPaths.map((p) => ({
        difficulty: p.difficulty,
        handRequirement: p.handRequirement,
        starters: p.starters.map((id) => ({
          id,
          name: cardIndex.byId.get(id)?.name ?? `#${id}`,
        })),
        steps: p.steps.map((s) => ({
          card: cardIndex.byId.get(s.cardId)?.name ?? s.cardName,
          action: s.action,
          target: s.targetCardId ? (cardIndex.byId.get(s.targetCardId)?.name ?? s.targetCardName) : null,
          zoneAfter: s.zoneAfter,
        })),
        result: {
          fieldMonsters: p.result.fieldMonsters
            .map((id) => cardIndex.byId.get(id)?.name ?? `#${id}`),
          gyCards: p.result.gyCards
            .map((id) => cardIndex.byId.get(id)?.name ?? `#${id}`),
        },
      })),
      bridge: bridgeResult ? serializeBridgeResult(bridgeResult, cardIndex.all, 6) : null,
      intraBridges,
      analysis: null as unknown,
      bridgeAnalysis: null as unknown,
    };

    // ── LLM narration (optional, requires ANTHROPIC_API_KEY) ─────────────────
    if (withLlm && process.env["ANTHROPIC_API_KEY"]) {
      try {
        const [deckAnalysis, bridgeAnalysis] = await Promise.all([
          analyzeDeck(deckCards, comboPaths, recommendations, cardIndex.byId),
          bridgeResult ? analyzeBridge(bridgeResult, cardIndex.byId) : Promise.resolve(null),
        ]);
        base.analysis = deckAnalysis;
        base.bridgeAnalysis = bridgeAnalysis;
      } catch (llmErr) {
        console.error("[recommend] LLM analysis failed (returning without narration):", llmErr);
        base.analysis = { error: "LLM unavailable", fallback: "Use algorithmic results above" };
      }
    }

    res.json(base);
  } catch (err) {
    console.error("[recommend] Error:", err);
    res.status(502).json({ error: String(err) });
  }
});
