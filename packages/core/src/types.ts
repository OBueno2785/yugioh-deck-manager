// ─── Card Data ───────────────────────────────────────────────────────────────

export type CardType =
  | "Effect Monster"
  | "Normal Monster"
  | "Ritual Monster"
  | "Fusion Monster"
  | "Synchro Monster"
  | "XYZ Monster"
  | "Link Monster"
  | "Pendulum Effect Monster"
  | "Pendulum Normal Monster"
  | "Spell Card"
  | "Trap Card"
  | "Skill Card"
  | "Token";

export type CardAttribute =
  | "DARK"
  | "EARTH"
  | "FIRE"
  | "LIGHT"
  | "WATER"
  | "WIND"
  | "DIVINE";

export type CardFrameType =
  | "normal"
  | "effect"
  | "ritual"
  | "fusion"
  | "synchro"
  | "xyz"
  | "link"
  | "normal_pendulum"
  | "effect_pendulum"
  | "ritual_pendulum"
  | "fusion_pendulum"
  | "synchro_pendulum"
  | "xyz_pendulum"
  | "spell"
  | "trap"
  | "token"
  | "skill";

export type BanStatus = "Banned" | "Limited" | "Semi-Limited" | "Unlimited";

export type CardRace =
  | "Aqua"
  | "Beast"
  | "Beast-Warrior"
  | "Creator-God"
  | "Cyberse"
  | "Dinosaur"
  | "Divine-Beast"
  | "Dragon"
  | "Fairy"
  | "Fiend"
  | "Fish"
  | "Insect"
  | "Machine"
  | "Plant"
  | "Psychic"
  | "Pyro"
  | "Reptile"
  | "Rock"
  | "Sea Serpent"
  | "Spellcaster"
  | "Thunder"
  | "Warrior"
  | "Winged Beast"
  | "Wyrm"
  | "Zombie"
  | "Normal"
  | "Continuous"
  | "Counter"
  | "Equip"
  | "Field"
  | "Quick-Play"
  | "Ritual";

export interface CardPrice {
  cardmarket_price: string;
  tcgplayer_price: string;
  ebay_price: string;
  amazon_price: string;
  coolstuffinc_price: string;
}

export interface CardImage {
  id: number;
  image_url: string;
  image_url_small: string;
  image_url_cropped: string;
}

export interface BanlistInfo {
  ban_tcg?: BanStatus;
  ban_ocg?: BanStatus;
  ban_goat?: BanStatus;
}

/** A specific set/print of a card, including rarity. Fetched on demand. */
export interface CardSet {
  set_name: string;
  set_code: string;
  set_rarity: string;
  set_rarity_code: string;
  set_price: string;
}

export interface Card {
  id: number;
  name: string;
  type: CardType;
  frameType: CardFrameType;
  desc: string;
  race: CardRace;
  archetype?: string;
  // Monster fields (optional for spells/traps)
  atk?: number;
  def?: number;
  level?: number;
  attribute?: CardAttribute;
  // Extra deck
  linkval?: number;
  linkmarkers?: string[];
  scale?: number; // Pendulum scale
  // Prices
  card_prices?: CardPrice[];
  // Images — each entry is a distinct art/print of the card
  card_images: CardImage[];
  // Sets & rarity — populated on demand via ?cardsets=yes
  card_sets?: CardSet[];
  // Ban info
  banlist_info?: BanlistInfo;
}

// ─── Deck ────────────────────────────────────────────────────────────────────

export type DeckZone = "main" | "extra" | "side";

export type GameFormat = "tcg" | "ocg" | "goat" | "edison";

export interface DeckCard {
  card: Card;
  quantity: number;
  zone: DeckZone;
  /** Index into card.card_images — which art variant to display (default 0). */
  selectedImageIndex?: number;
}

/** Labels assigned by the player to indicate the card's role in the deck */
export type CardRole =
  | "starter"   // Initiates the combo
  | "extender"  // Extends the combo
  | "handtrap"  // Disrupts the opponent
  | "boardbreak"// Breaks established boards
  | "garnets"   // Dead cards / bricks
  | "engine"    // Generic engine piece
  | "tech";     // Tech/specific answer card

export interface LabeledDeckCard extends DeckCard {
  role?: CardRole;
}

export interface Deck {
  id: string;
  name: string;
  format: GameFormat;
  description?: string;
  main: LabeledDeckCard[];   // 40–60 cards
  extra: LabeledDeckCard[];  // 0–15 cards
  side: LabeledDeckCard[];   // 0–15 cards
  createdAt: Date;
  updatedAt: Date;
}

// ─── Deck Validation ─────────────────────────────────────────────────────────

export interface DeckValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// ─── Consistency Analysis ────────────────────────────────────────────────────

export interface CardProbability {
  cardId: number;
  cardName: string;
  copies: number;
  probabilityInOpeningHand: number; // P(see at least 1 copy)
  probabilityGoingFirst: number;    // 5-card hand
  probabilityGoingSecond: number;   // 6-card hand
}

export interface ConsistencyReport {
  deckSize: number;
  mainDeckCount: number;
  cardProbabilities: CardProbability[];
  monsterCount: number;
  spellCount: number;
  trapCount: number;
  starterCount: number;
  extenderCount: number;
  handtrapCount: number;
  brickCount: number;
  comboRate: number;  // estimated % of hands with at least one starter
  overallScore: number; // 0–100
}

// ─── Simulator ───────────────────────────────────────────────────────────────

export type ConditionType =
  | "has_card"      // Has at least N copies of a specific card
  | "has_any"       // Has at least one card from a set
  | "has_all"       // Has all specified cards
  | "has_count";    // Has at least N cards matching a role

export interface SimulationCondition {
  id: string;
  label: string;
  type: ConditionType;
  cardIds: number[];   // for has_card / has_any / has_all
  role?: CardRole;     // for has_count
  minCount: number;
}

export interface SimulationConfig {
  deck: Card[];          // Full flat array with duplicates per quantity
  handSize: number;      // 5 (going first) or 6 (going second)
  iterations: number;    // Recommended: 10_000
  conditions: SimulationCondition[];
}

export interface SimulationResult {
  iterations: number;
  handSize: number;
  conditionResults: Array<{
    condition: SimulationCondition;
    successCount: number;
    probability: number; // 0–1
    percentage: string;  // "73.42%"
  }>;
  allConditionsMet: {
    successCount: number;
    probability: number;
    percentage: string;
  };
  durationMs: number;
}

// ─── Pricing ─────────────────────────────────────────────────────────────────

export interface DeckPriceSummary {
  totalTcgplayer: number;
  totalCardmarket: number;
  perCard: Array<{
    cardId: number;
    cardName: string;
    quantity: number;
    tcgplayer: number;
    cardmarket: number;
  }>;
  currency: "USD" | "EUR";
}
