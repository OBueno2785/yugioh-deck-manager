/**
 * Anthropic Claude client with prompt caching.
 *
 * The system prompt (Yu-Gi-Oh context) is marked as cacheable — it's the same
 * across all requests, so after the first call it hits the cache and costs ~10%
 * of the input token price.
 *
 * API key is read from ANTHROPIC_API_KEY environment variable.
 */

import Anthropic from "@anthropic-ai/sdk";

let _client: Anthropic | null = null;

export function getClient(): Anthropic {
  if (!_client) {
    const apiKey = process.env["ANTHROPIC_API_KEY"];
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY environment variable is not set");
    _client = new Anthropic({ apiKey });
  }
  return _client;
}

// ─── Cached system prompt ─────────────────────────────────────────────────────

export const SYSTEM_PROMPT = `You are an expert Yu-Gi-Oh! deck analyst with deep knowledge of:
- All current and historical Yu-Gi-Oh! card archetypes, mechanics, and strategies
- TCG and OCG formats, ban lists, and the competitive metagame
- Combo theory: how cards chain together through searches, special summons, mills, and GY effects
- Deck construction principles: ratios, consistency, engine size, handtrap counts
- Bridge cards: generic support that connects multiple archetypes

When analyzing decks and combos, you:
1. Use correct Yu-Gi-Oh terminology (GY = Graveyard, SS = Special Summon, NS = Normal Summon)
2. Describe combos in numbered steps with clear card actions
3. Explain WHY each step works (what effect triggers, what condition is met)
4. Identify the board state result (what ends up where)
5. Note hand requirements (what you need in opening hand)
6. Point out key interactions between archetypes

You always respond with valid JSON matching the exact schema provided in each request.`;

// Tool definition for structured output
export const ANALYSIS_TOOL: Anthropic.Tool = {
  name: "deck_analysis",
  description: "Return structured deck analysis with combo narrations and strategy",
  input_schema: {
    type: "object" as const,
    properties: {
      strategy_overview: {
        type: "string",
        description: "2-3 paragraphs describing the deck's strategy, win condition, and game plan",
      },
      deck_profile: {
        type: "object",
        properties: {
          style: { type: "string", enum: ["combo", "control", "midrange", "turbo", "stun", "grind"] },
          going_first_priority: { type: "boolean" },
          consistency_rating: { type: "string", enum: ["Low", "Medium", "High", "Very High"] },
          ceiling: { type: "string", description: "What the deck can accomplish at its best" },
        },
        required: ["style", "going_first_priority", "consistency_rating", "ceiling"],
      },
      combo_lines: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Short name for this combo line" },
            hand_requirement: { type: "string", description: "Cards needed in opening hand" },
            difficulty: { type: "string", enum: ["1-card", "2-card", "3-card"] },
            steps: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  step: { type: "number" },
                  action: { type: "string", description: "What you do this step" },
                  card: { type: "string", description: "Card being used" },
                  effect: { type: "string", description: "Which effect activates and what it does" },
                  result: { type: "string", description: "Board state after this step" },
                },
                required: ["step", "action", "card", "effect", "result"],
              },
            },
            end_board: { type: "string", description: "Final board state after completing the combo" },
            interaction_points: {
              type: "array",
              items: { type: "string" },
              description: "Steps where opponent can interrupt and how to play around it",
            },
          },
          required: ["name", "hand_requirement", "difficulty", "steps", "end_board"],
        },
      },
      key_cards: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            role: { type: "string" },
            why_essential: { type: "string" },
          },
          required: ["name", "role", "why_essential"],
        },
      },
      recommendations_explanation: {
        type: "array",
        items: {
          type: "object",
          properties: {
            card_name: { type: "string" },
            why_include: { type: "string", description: "Specific synergy with this deck" },
            how_many: { type: "string", enum: ["1", "2", "3"] },
          },
          required: ["card_name", "why_include", "how_many"],
        },
      },
    },
    required: ["strategy_overview", "deck_profile", "combo_lines", "key_cards"],
  },
};

export const BRIDGE_TOOL: Anthropic.Tool = {
  name: "bridge_analysis",
  description: "Return structured bridge analysis between two archetypes",
  input_schema: {
    type: "object" as const,
    properties: {
      compatibility_summary: {
        type: "string",
        description: "Overall assessment of how naturally these archetypes work together",
      },
      why_it_works: {
        type: "string",
        description: "The core interaction that makes the combination viable",
      },
      bridge_card_explanations: {
        type: "array",
        items: {
          type: "object",
          properties: {
            card_name: { type: "string" },
            bridge_role: { type: "string" },
            specific_interaction: {
              type: "string",
              description: "Exactly how this card connects the two archetypes",
            },
            example_line: {
              type: "string",
              description: "A concrete example combo sequence using this bridge card",
            },
            copies: { type: "string", enum: ["1", "2", "3"] },
          },
          required: ["card_name", "bridge_role", "specific_interaction", "copies"],
        },
      },
      combined_combo_line: {
        type: "object",
        properties: {
          name: { type: "string" },
          steps: {
            type: "array",
            items: {
              type: "object",
              properties: {
                step: { type: "number" },
                card: { type: "string" },
                action: { type: "string" },
                result: { type: "string" },
              },
              required: ["step", "card", "action", "result"],
            },
          },
          end_board: { type: "string" },
        },
        required: ["name", "steps", "end_board"],
      },
      deck_building_notes: {
        type: "string",
        description: "How many slots each archetype needs and how to balance the deck",
      },
    },
    required: ["compatibility_summary", "why_it_works", "bridge_card_explanations", "combined_combo_line"],
  },
};
