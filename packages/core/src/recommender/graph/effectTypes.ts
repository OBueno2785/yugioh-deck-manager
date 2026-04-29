// ─── Edge types ───────────────────────────────────────────────────────────────

/**
 * Semantic categories of card-to-card relationships.
 * Each type corresponds to a recognizable game action extracted from card text.
 */
export type EdgeType =
  | "searches"          // add to hand from Deck/Extra
  | "special_summons"   // Special Summon from Deck/Hand/GY/Banished
  | "mills"             // send to GY from Deck/Hand
  | "banishes"          // banish from Deck/Hand/GY
  | "returns_to_hand"   // return to hand (bounce)
  | "returns_to_deck"   // shuffle back into Deck
  | "gy_trigger"        // this card activates in GY when sent there
  | "field_trigger"     // this card's effect triggers while on field
  | "summon_trigger"    // this card's effect triggers on its own summon
  | "requires_presence" // needs this card in hand/field/GY to work
  | "fuses_with"        // used as Fusion material with this card
  | "synchros_with"     // used as Synchro material with this card
  | "xyz_with"          // used as Xyz material with this card
  | "enables_link"      // provides material for a Link Summon;

// ─── Matchers ────────────────────────────────────────────────────────────────

/** A criterion that a target card must satisfy. Can be broad or narrow. */
export interface CardMatcher {
  cardId?: number;          // exact card
  cardName?: string;        // exact name (resolved at graph-build time)
  archetype?: string;       // "Despia" monster
  type?: string;            // "Spell Card", "Effect Monster"
  race?: string;            // "Dragon", "Spellcaster"
  attribute?: string;       // "DARK", "LIGHT"
  level?: number;           // exact level
  levelRange?: [number, number]; // level range [min, max]
  linkval?: number;
}

// ─── Edges ───────────────────────────────────────────────────────────────────

export interface EffectEdge {
  type: EdgeType;
  /** Where this action places/finds the target. */
  source: ZoneRef;
  target: ZoneRef;
  matcher: CardMatcher;
  /** Rough weight: how many copies of this edge can fire per turn. */
  maxUses: 1 | 2 | 3;
  /** Raw clause from card text (for debugging / LLM context). */
  rawClause: string;
}

export type ZoneRef =
  | "hand"
  | "field"
  | "gy"          // graveyard
  | "deck"
  | "extra_deck"
  | "banished"
  | "any";        // zone-agnostic

// ─── Graph node ──────────────────────────────────────────────────────────────

export interface EffectNode {
  cardId: number;
  cardName: string;
  archetype?: string;
  type: string;
  race?: string;
  attribute?: string;
  level?: number;
  linkval?: number;
  /** Edges going OUT from this card (actions this card performs). */
  outEdges: EffectEdge[];
  /** Edge indices going INTO this card (other cards that affect this one). */
  inEdges: EffectEdge[];
}

/** The full effect graph: cardId → node */
export type EffectGraph = Map<number, EffectNode>;

// ─── Combo types ─────────────────────────────────────────────────────────────

export interface ComboStep {
  cardId: number;
  cardName: string;
  action: string;           // human-readable: "Normal Summon", "Activate effect"
  edgeType: EdgeType;
  targetCardId?: number;
  targetCardName?: string;
  rawClause: string;
  zoneAfter: ZoneRef;       // where the card ends up after this step
}

export interface ComboPath {
  /** Cards needed in the opening hand to start this line. */
  starters: number[];
  steps: ComboStep[];
  /** Board state at the end of the combo. */
  result: {
    fieldMonsters: number[];
    fieldSpells: number[];
    gyCards: number[];
    banishedCards: number[];
  };
  /** Estimated number of card slots needed (unique starters). */
  handRequirement: number;
  difficulty: "1-card" | "2-card" | "3-card";
}
