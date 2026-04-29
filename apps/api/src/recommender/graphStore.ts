/**
 * Singleton that holds the built Effect Graph in memory.
 * Building takes ~2-5s for 15K cards, so it's done once on warm-up.
 */

import { buildEffectGraph } from "@yugioh/core";
import type { EffectGraph, GraphBuildStats } from "@yugioh/core";
import { getFullCatalog } from "../ygoproClient.js";

interface GraphStore {
  graph: EffectGraph;
  stats: GraphBuildStats;
}

let store: GraphStore | null = null;
let buildPromise: Promise<GraphStore> | null = null;

async function build(): Promise<GraphStore> {
  const rawCards = await getFullCatalog();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { graph, stats } = buildEffectGraph(rawCards as any);
  console.log(
    `[graph] Built: ${stats.nodes} nodes, ${stats.edges} edges, ` +
    `${stats.resolvedByName} named + ${stats.resolvedByMatcher} broad — ${stats.durationMs}ms`
  );
  return { graph, stats };
}

export async function getGraphStore(): Promise<GraphStore> {
  if (store) return store;
  if (!buildPromise) buildPromise = build().then((s) => { store = s; return s; });
  return buildPromise;
}

export async function getGraphStats(): Promise<GraphBuildStats | null> {
  return store?.stats ?? null;
}
