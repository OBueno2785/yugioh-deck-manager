/**
 * Visual display of a drawn opening hand.
 * Highlights cards that participate in a satisfied condition.
 */

import type { Card, SimulationCondition } from "@yugioh/core";
import { CardImage } from "@/features/cards/CardImage";

interface HandDisplayProps {
  hand: Card[];
  conditions: SimulationCondition[];
  onDraw: () => void;
  goingFirst: boolean;
  disabled: boolean;
}

function conditionsMet(hand: Card[], conditions: SimulationCondition[]): boolean[] {
  return conditions.map((c) => {
    const idSet = new Set(c.cardIds);
    switch (c.type) {
      case "has_card": return hand.filter((card) => card.id === c.cardIds[0]).length >= c.minCount;
      case "has_any":
      case "has_count": return hand.filter((card) => idSet.has(card.id)).length >= c.minCount;
      case "has_all":   return c.cardIds.every((id) => hand.some((card) => card.id === id));
      default: return false;
    }
  });
}

function isRelevant(card: Card, conditions: SimulationCondition[]): boolean {
  return conditions.some((c) => c.cardIds.includes(card.id));
}

export function HandDisplay({ hand, conditions, onDraw, goingFirst, disabled }: HandDisplayProps) {
  const met = conditionsMet(hand, conditions);
  const allMet = met.length > 0 && met.every(Boolean);
  const anyMet = met.some(Boolean);
  const handSize = goingFirst ? 5 : 6;

  return (
    <div className="space-y-3">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <span className="text-xs" style={{ color: "var(--color-muted)" }}>
          Opening hand ({handSize} cards, going {goingFirst ? "first" : "second"})
        </span>
        {hand.length > 0 && conditions.length > 0 && (
          <span
            className="text-xs font-semibold px-2 py-0.5 rounded-full"
            style={{
              backgroundColor: allMet ? "#1a3a1a" : anyMet ? "#2a2a1a" : "#2a1a1a",
              color: allMet ? "#50c878" : anyMet ? "#c8c850" : "var(--color-danger)",
              border: `1px solid ${allMet ? "#2a5a2a" : anyMet ? "#4a4a1a" : "#4a1a1a"}`,
            }}
          >
            {allMet ? "✓ All conditions met" : anyMet ? "~ Partial" : "✗ No conditions met"}
          </span>
        )}
      </div>

      {/* Card slots */}
      <div className="flex gap-2 justify-center flex-wrap">
        {hand.length === 0 ? (
          // Empty placeholders
          Array.from({ length: handSize }).map((_, i) => (
            <div
              key={i}
              className="rounded-lg border-2 border-dashed flex-shrink-0"
              style={{
                width: 72,
                aspectRatio: "421/614",
                borderColor: "var(--color-border)",
              }}
            />
          ))
        ) : (
          hand.map((card, i) => {
            const relevant = conditions.length > 0 && isRelevant(card, conditions);
            return (
              <div
                key={`${card.id}-${i}`}
                className="relative flex-shrink-0 rounded-lg overflow-hidden"
                style={{
                  width: 72,
                  aspectRatio: "421/614",
                  outline: relevant ? "2px solid var(--color-accent)" : "2px solid transparent",
                  outlineOffset: "2px",
                  boxShadow: relevant ? "0 0 8px rgba(200,155,60,0.4)" : "none",
                  transition: "outline 0.2s, box-shadow 0.2s",
                }}
              >
                <CardImage card={card} size="normal" className="w-full h-full object-cover" />
                {relevant && (
                  <div
                    className="absolute top-0.5 right-0.5 w-3.5 h-3.5 rounded-full flex items-center justify-center"
                    style={{ backgroundColor: "var(--color-accent)" }}
                  >
                    <span style={{ fontSize: "0.5rem", color: "#000", fontWeight: "bold" }}>★</span>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Condition status badges */}
      {conditions.length > 0 && hand.length > 0 && (
        <div className="flex flex-wrap gap-1.5 justify-center">
          {conditions.map((c, i) => (
            <span
              key={c.id}
              className="text-xs px-2 py-0.5 rounded-full"
              style={{
                backgroundColor: met[i] ? "#1a3a1a" : "#2a1a1a",
                color: met[i] ? "#50c878" : "var(--color-danger)",
                border: `1px solid ${met[i] ? "#2a5a2a" : "#4a1a1a"}`,
              }}
            >
              {met[i] ? "✓" : "✗"} {c.label || `Condition ${i + 1}`}
            </span>
          ))}
        </div>
      )}

      {/* Draw button */}
      <div className="flex justify-center">
        <button
          className="px-6 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-40"
          style={{ backgroundColor: "var(--color-accent)", color: "#000" }}
          onClick={onDraw}
          disabled={disabled}
        >
          {hand.length === 0 ? "Draw Opening Hand" : "New Hand"}
        </button>
      </div>
    </div>
  );
}
