// Types mirroring the /api/recommend response

export interface RecommendedCard {
  id: number;
  name: string;
  type: string;
  archetype?: string;
  score: number;
  signals: { coOccurrence: number; archetype: number; roleGap: number };
  topLiftPartner?: { cardId: number; cardName: string; lift: number };
  reason: string;
}

export interface AlgoComboStep {
  card: string;
  action: string;
  target: string | null;
  zoneAfter: string;
}

export interface AlgoComboPath {
  difficulty: string;
  handRequirement: number;
  starters: { id: number; name: string }[];
  steps: AlgoComboStep[];
  result: { fieldMonsters: string[]; gyCards: string[] };
}

export interface AlgoBridgeCard {
  id: number;
  name: string;
  type: string;
  archetype?: string;
  race?: string;
  attribute?: string;
  atk?: number;
  def?: number;
  level?: number;
  desc?: string;
  role: string;
  filledNeeds: string[];
  synergyScore: number;
  recommendedCopies: number;
  explanation: string;
}

export interface MaterialMatch {
  req: {
    index: number; raw: string; quantity: number;
    namedCard?: string; archetype?: string; attribute?: string; race?: string;
    level?: number; isTuner?: boolean; isGeneric: boolean;
  };
  matchedCards: { id: number; name: string }[];
  isFullyMet: boolean;
  missingDescription: string;
}

export interface SummonPath {
  target: { id: number; name: string; type: string; level?: number; linkval?: number };
  summonMethod: "Fusion" | "Synchro" | "Xyz" | "Link";
  materialMatches: MaterialMatch[];
  additionalNeeded: { description: string; suggestedCards: { id: number; name: string }[] }[];
  achievabilityScore: number;
  summary: string;
}

export interface AlgoBridge {
  archetypeA: string;
  archetypeB: string;
  verdict: string;
  naturalSynergyScore: number;
  gap: string[];
  profileA: { needs: string[]; provides: string[] };
  profileB: { needs: string[]; provides: string[] };
  summonPaths: SummonPath[];
  bridgeCards: AlgoBridgeCard[];
}

// LLM analysis types

export interface LlmComboStep {
  step: number;
  action: string;
  card: string;
  effect: string;
  result: string;
}

export interface LlmComboLine {
  name: string;
  hand_requirement: string;
  difficulty: "1-card" | "2-card" | "3-card";
  steps: LlmComboStep[];
  end_board: string;
  interaction_points?: string[];
}

export interface DeckProfile {
  style: string;
  going_first_priority: boolean;
  consistency_rating: string;
  ceiling: string;
}

export interface DeckAnalysis {
  strategy_overview: string;
  deck_profile: DeckProfile;
  combo_lines: LlmComboLine[];
  key_cards: { name: string; role: string; why_essential: string }[];
  recommendations_explanation?: { card_name: string; why_include: string; how_many: string }[];
}

export interface BridgeCardExplanation {
  card_name: string;
  bridge_role: string;
  specific_interaction: string;
  example_line?: string;
  copies: string;
}

export interface BridgeAnalysis {
  compatibility_summary: string;
  why_it_works: string;
  bridge_card_explanations: BridgeCardExplanation[];
  combined_combo_line: {
    name: string;
    steps: { step: number; card: string; action: string; result: string }[];
    end_board: string;
  };
  deck_building_notes?: string;
}

export interface RecommendResponse {
  deckSize: number;
  uniqueCards: number;
  deckArchetypes: { archetype: string; count: number }[];
  matrixDecks: number;
  recommendations: RecommendedCard[];
  comboPaths: AlgoComboPath[];
  bridge: AlgoBridge | null;
  intraBridges: AlgoBridge[];
  analysis: DeckAnalysis | { error: string; fallback: string } | null;
  bridgeAnalysis: BridgeAnalysis | null;
}

export async function fetchRecommendations(
  deckCardIds: number[],
  options: { archetypeB?: string; topN?: number; withLlm?: boolean } = {}
): Promise<RecommendResponse> {
  const res = await fetch("/api/recommend", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deckCardIds, ...options }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? res.statusText);
  }
  return res.json() as Promise<RecommendResponse>;
}
