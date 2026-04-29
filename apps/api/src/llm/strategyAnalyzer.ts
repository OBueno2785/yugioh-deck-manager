/**
 * Uses Claude to generate natural-language analysis of a deck.
 *
 * The algorithmic layer (scorer, comboFinder, bridgeFinder) does the
 * hard work of finding relationships. Claude's job is to narrate:
 *   - What the deck is trying to do
 *   - How each combo line plays out step by step
 *   - Why the recommended cards fit
 *   - How bridge cards connect the archetypes
 *
 * Prompt caching: system prompt is cached across all calls.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { getClient, SYSTEM_PROMPT, ANALYSIS_TOOL, BRIDGE_TOOL } from "./claudeClient.js";
import type { CandidateScore } from "@yugioh/core";
import type { ComboPath } from "@yugioh/core";
import type { BridgeResult } from "@yugioh/core";
import type { Card } from "@yugioh/core";

const MODEL = "claude-sonnet-4-6";

// ─── Types returned by tools ──────────────────────────────────────────────────

export interface ComboStep {
  step: number;
  action: string;
  card: string;
  effect: string;
  result: string;
}

export interface ComboLineAnalysis {
  name: string;
  hand_requirement: string;
  difficulty: "1-card" | "2-card" | "3-card";
  steps: ComboStep[];
  end_board: string;
  interaction_points?: string[];
}

export interface DeckAnalysis {
  strategy_overview: string;
  deck_profile: {
    style: string;
    going_first_priority: boolean;
    consistency_rating: string;
    ceiling: string;
  };
  combo_lines: ComboLineAnalysis[];
  key_cards: Array<{ name: string; role: string; why_essential: string }>;
  recommendations_explanation?: Array<{
    card_name: string;
    why_include: string;
    how_many: string;
  }>;
}

export interface BridgeAnalysis {
  compatibility_summary: string;
  why_it_works: string;
  bridge_card_explanations: Array<{
    card_name: string;
    bridge_role: string;
    specific_interaction: string;
    example_line?: string;
    copies: string;
  }>;
  combined_combo_line: {
    name: string;
    steps: Array<{ step: number; card: string; action: string; result: string }>;
    end_board: string;
  };
  deck_building_notes?: string;
}

// ─── Prompt builders ──────────────────────────────────────────────────────────

function buildDeckPrompt(
  deckCards: Card[],
  comboPaths: ComboPath[],
  recommendations: CandidateScore[],
  cardIndex: Map<number, Card>
): string {
  const archetypeCounts = new Map<string, number>();
  for (const c of deckCards) {
    if (c.archetype) archetypeCounts.set(c.archetype, (archetypeCounts.get(c.archetype) ?? 0) + 1);
  }
  const archetypeList = [...archetypeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([a, n]) => `${a} (${n})`)
    .join(", ");

  const cardList = deckCards
    .map((c) => `- ${c.name} [${c.type}${c.archetype ? ` / ${c.archetype}` : ""}]`)
    .join("\n");

  const comboSummary = comboPaths
    .slice(0, 3)
    .map((p, i) => {
      const starterNames = p.starters
        .map((id) => cardIndex.get(id)?.name ?? `#${id}`)
        .join(" + ");
      const stepLines = p.steps
        .map((s, j) => `  ${j + 1}. ${s.cardName} → ${s.action} → ${s.targetCardName ?? "?"}`)
        .join("\n");
      return `Path ${i + 1} (${p.difficulty}, starters: ${starterNames}):\n${stepLines}\n  Result: ${p.result.fieldMonsters.length} monsters on field, ${p.result.gyCards.length} in GY`;
    })
    .join("\n\n");

  const recList = recommendations
    .slice(0, 10)
    .map((r) => `- ${r.card.name} (score ${r.totalScore}): ${r.reason}`)
    .join("\n");

  return `Analyze this Yu-Gi-Oh deck and produce detailed combo narrations and strategy explanation.

## Deck Composition
Archetypes: ${archetypeList}
Total cards analyzed: ${deckCards.length}

## Full Card List
${cardList}

## Algorithmically Detected Combo Paths
The following combo sequences were found by graph traversal. Narrate them as clear step-by-step instructions:

${comboSummary || "No paths detected by algorithm — infer likely combos from the card list."}

## Top Recommended Additions (algorithmic scores)
${recList || "No recommendations computed yet."}

## Task
Using the tool, provide:
1. A strategy overview (what the deck does, its win condition)
2. 2-4 detailed combo lines with step-by-step narration — expand the algorithmic paths above with your Yu-Gi-Oh knowledge to fill in missing steps
3. Key cards explanation
4. For each top recommendation, explain the specific synergy with THIS deck`;
}

function buildBridgePrompt(
  bridgeResult: BridgeResult,
  cardIndex: Map<number, Card>
): string {
  const bridgeCardList = bridgeResult.bridgeCards
    .slice(0, 8)
    .map((b) => `- ${b.card.name} [${b.card.type}]: ${b.explanation} (score: ${b.synergyScore}, role: ${b.role})`)
    .join("\n");

  const profileA = bridgeResult.profileA;
  const profileB = bridgeResult.profileB;

  return `Analyze the synergy between the "${bridgeResult.archetypeA}" and "${bridgeResult.archetypeB}" archetypes and explain how to bridge them.

## Archetype A: ${bridgeResult.archetypeA}
- Provides: ${profileA.provides.join(", ") || "unknown"}
- Needs: ${profileA.needs.join(", ") || "nothing specific"}
- Summon types: ${profileA.summonTypes.join(", ")}
- Dominant attributes: ${profileA.dominantAttributes.join(", ")}

## Archetype B: ${bridgeResult.archetypeB}
- Provides: ${profileB.provides.join(", ") || "unknown"}
- Needs: ${profileB.needs.join(", ") || "nothing specific"}
- Summon types: ${profileB.summonTypes.join(", ")}

## Resource Gap (what B needs that A doesn't provide)
${bridgeResult.gap.length > 0 ? bridgeResult.gap.join(", ") : "None — natural splash"}

## Algorithmic Bridge Card Candidates
${bridgeCardList || "No bridge cards found algorithmically."}

## Algorithmic Verdict
${bridgeResult.verdict} — Natural Synergy Score: ${bridgeResult.naturalSynergyScore}/100

## Task
Using the tool, provide:
1. A clear explanation of WHY these archetypes can work together (or can't)
2. For each bridge card candidate, explain the SPECIFIC interaction that connects both archetypes
3. A concrete combined combo line that uses cards from BOTH archetypes
4. Deck building notes (how many slots to allocate to each engine)`;
}

// ─── API calls ────────────────────────────────────────────────────────────────

export async function analyzeDeck(
  deckCards: Card[],
  comboPaths: ComboPath[],
  recommendations: CandidateScore[],
  cardIndex: Map<number, Card>
): Promise<DeckAnalysis> {
  const client = getClient();
  const userPrompt = buildDeckPrompt(deckCards, comboPaths, recommendations, cardIndex);

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [ANALYSIS_TOOL],
    tool_choice: { type: "tool", name: "deck_analysis" },
    messages: [{ role: "user", content: userPrompt }],
  });

  const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!toolUse) throw new Error("Claude did not return a tool_use block");

  return toolUse.input as DeckAnalysis;
}

export async function analyzeBridge(bridgeResult: BridgeResult, cardIndex: Map<number, Card>): Promise<BridgeAnalysis> {
  const client = getClient();
  const userPrompt = buildBridgePrompt(bridgeResult, cardIndex);

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 3000,
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [BRIDGE_TOOL],
    tool_choice: { type: "tool", name: "bridge_analysis" },
    messages: [{ role: "user", content: userPrompt }],
  });

  const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!toolUse) throw new Error("Claude did not return a tool_use block");

  return toolUse.input as BridgeAnalysis;
}

// ─── Usage logging ────────────────────────────────────────────────────────────

export function logUsage(response: Anthropic.Message, label: string): void {
  const u = response.usage as unknown as Record<string, unknown>;
  const cached = u["cache_read_input_tokens"] as number | undefined ?? 0;
  const created = u["cache_creation_input_tokens"] as number | undefined ?? 0;
  console.log(
    `[llm] ${label} — in: ${u.input_tokens} (cache_read: ${cached}, cache_write: ${created}) out: ${u.output_tokens}`
  );
}
