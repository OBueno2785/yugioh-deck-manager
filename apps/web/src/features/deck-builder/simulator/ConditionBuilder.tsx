/**
 * UI for building simulation conditions.
 *
 * Each condition is one row: label | type | card selector | minCount | delete.
 * Card selector shows the unique cards from the main deck as small thumbnails.
 */

import { useState } from "react";
import type { LabeledDeckCard, SimulationCondition, ConditionType } from "@yugioh/core";
import { CardImage } from "@/features/cards/CardImage";

interface ConditionBuilderProps {
  conditions: SimulationCondition[];
  deckCards: LabeledDeckCard[];   // unique cards from main deck for the selector
  onAdd: (c: Omit<SimulationCondition, "id">) => void;
  onUpdate: (id: string, patch: Partial<SimulationCondition>) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
}

const TYPE_OPTIONS: { value: ConditionType; label: string; desc: string }[] = [
  { value: "has_any",  label: "Has any of",  desc: "≥N cards from the selected set" },
  { value: "has_card", label: "Has card",    desc: "≥N copies of one specific card" },
  { value: "has_all",  label: "Has all",     desc: "At least 1 copy of each selected card" },
  { value: "has_count",label: "Has count",   desc: "≥N total from the selected set" },
];

// ─── Card Picker Modal ─────────────────────────────────────────────────────────

interface CardPickerProps {
  deckCards: LabeledDeckCard[];
  selected: number[];
  onToggle: (id: number) => void;
  onClose: () => void;
}

function CardPicker({ deckCards, selected, onToggle, onClose }: CardPickerProps) {
  const selectedSet = new Set(selected);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.7)" }}
      onClick={onClose}
    >
      <div
        className="rounded-xl p-4 w-full max-w-md max-h-[70vh] overflow-y-auto"
        style={{ backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-3">
          <span className="font-semibold text-sm" style={{ color: "var(--color-text)" }}>
            Select cards ({selected.length} selected)
          </span>
          <button className="text-sm opacity-50 hover:opacity-100" onClick={onClose}>✕</button>
        </div>
        <div className="grid gap-1.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(56px, 1fr))" }}>
          {deckCards.map((dc) => {
            const isSelected = selectedSet.has(dc.card.id);
            return (
              <button
                key={dc.card.id}
                className="relative rounded overflow-hidden"
                style={{
                  aspectRatio: "421/614",
                  outline: isSelected ? "2px solid var(--color-accent)" : "2px solid transparent",
                  outlineOffset: "1px",
                }}
                onClick={() => onToggle(dc.card.id)}
                title={dc.card.name}
              >
                <CardImage card={dc.card} size="small" className="w-full h-full object-cover" />
                {isSelected && (
                  <div
                    className="absolute inset-0 flex items-center justify-center"
                    style={{ backgroundColor: "rgba(200,155,60,0.4)" }}
                  >
                    <span className="text-white text-lg font-bold">✓</span>
                  </div>
                )}
                <div
                  className="absolute bottom-0 inset-x-0 px-0.5 py-0.5 text-center"
                  style={{ backgroundColor: "rgba(0,0,0,0.7)", fontSize: "0.55rem", color: "#fff", lineHeight: 1.2 }}
                >
                  {dc.card.name.length > 14 ? dc.card.name.slice(0, 12) + "…" : dc.card.name}
                </div>
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex justify-end">
          <button
            className="px-4 py-1.5 rounded text-sm font-medium"
            style={{ backgroundColor: "var(--color-accent)", color: "#000" }}
            onClick={onClose}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Single Condition Row ──────────────────────────────────────────────────────

interface ConditionRowProps {
  condition: SimulationCondition;
  deckCards: LabeledDeckCard[];
  onUpdate: (patch: Partial<SimulationCondition>) => void;
  onRemove: () => void;
}

function ConditionRow({ condition, deckCards, onUpdate, onRemove }: ConditionRowProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const selectedCards = deckCards.filter((dc) => condition.cardIds.includes(dc.card.id));

  function toggleCard(id: number) {
    const ids = condition.cardIds.includes(id)
      ? condition.cardIds.filter((x) => x !== id)
      : [...condition.cardIds, id];
    onUpdate({ cardIds: ids });
  }

  return (
    <div
      className="rounded-lg p-3 space-y-2"
      style={{ backgroundColor: "var(--color-bg)", border: "1px solid var(--color-border)" }}
    >
      {/* Row 1: label + type + delete */}
      <div className="flex items-center gap-2">
        <input
          className="flex-1 min-w-0 px-2 py-1 rounded text-sm outline-none"
          style={{
            backgroundColor: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            color: "var(--color-text)",
          }}
          placeholder="Condition name…"
          value={condition.label}
          onChange={(e) => onUpdate({ label: e.target.value })}
        />
        <select
          className="px-2 py-1 rounded text-xs outline-none flex-shrink-0"
          style={{
            backgroundColor: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            color: "var(--color-text)",
          }}
          value={condition.type}
          onChange={(e) => onUpdate({ type: e.target.value as ConditionType })}
        >
          {TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <button
          className="text-sm opacity-40 hover:opacity-100 px-1"
          style={{ color: "var(--color-danger)" }}
          onClick={onRemove}
          title="Delete condition"
        >
          ✕
        </button>
      </div>

      {/* Row 2: card selector + minCount */}
      <div className="flex items-center gap-2">
        <button
          className="flex-1 flex items-center gap-1.5 px-2 py-1.5 rounded text-xs text-left overflow-hidden"
          style={{
            backgroundColor: "var(--color-surface)",
            border: `1px solid ${condition.cardIds.length > 0 ? "var(--color-accent)" : "var(--color-border)"}`,
            color: condition.cardIds.length > 0 ? "var(--color-text)" : "var(--color-muted)",
          }}
          onClick={() => setPickerOpen(true)}
        >
          {selectedCards.length > 0 ? (
            <>
              <div className="flex -space-x-1 flex-shrink-0">
                {selectedCards.slice(0, 4).map((dc) => (
                  <CardImage
                    key={dc.card.id}
                    card={dc.card}
                    size="small"
                    className="w-5 h-7 object-cover rounded border"
                    style={{ borderColor: "var(--color-border)" } as React.CSSProperties}
                  />
                ))}
              </div>
              <span className="truncate">
                {selectedCards.length === 1
                  ? selectedCards[0]!.card.name
                  : `${selectedCards.length} cards selected`}
              </span>
            </>
          ) : (
            <>
              <span>+</span>
              <span>Select cards from deck…</span>
            </>
          )}
        </button>

        {/* minCount — only shown for types that use it */}
        {condition.type !== "has_all" && (
          <div className="flex items-center gap-1 flex-shrink-0">
            <span className="text-xs" style={{ color: "var(--color-muted)" }}>≥</span>
            <input
              type="number"
              min={1}
              max={6}
              className="w-10 text-center px-1 py-1 rounded text-xs outline-none"
              style={{
                backgroundColor: "var(--color-surface)",
                border: "1px solid var(--color-border)",
                color: "var(--color-text)",
              }}
              value={condition.minCount}
              onChange={(e) => onUpdate({ minCount: Math.max(1, parseInt(e.target.value) || 1) })}
            />
          </div>
        )}
      </div>

      {/* Type hint */}
      <p className="text-xs" style={{ color: "var(--color-muted)" }}>
        {TYPE_OPTIONS.find((o) => o.value === condition.type)?.desc}
      </p>

      {pickerOpen && (
        <CardPicker
          deckCards={deckCards}
          selected={condition.cardIds}
          onToggle={toggleCard}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export function ConditionBuilder({
  conditions,
  deckCards,
  onAdd,
  onUpdate,
  onRemove,
  onClear,
}: ConditionBuilderProps) {
  function handleAdd() {
    onAdd({
      label: `Condition ${conditions.length + 1}`,
      type: "has_any",
      cardIds: [],
      minCount: 1,
    });
  }

  return (
    <div className="space-y-2">
      {conditions.map((c) => (
        <ConditionRow
          key={c.id}
          condition={c}
          deckCards={deckCards}
          onUpdate={(patch) => onUpdate(c.id, patch)}
          onRemove={() => onRemove(c.id)}
        />
      ))}

      <div className="flex gap-2">
        <button
          className="flex-1 py-1.5 rounded text-sm font-medium border-dashed border-2 transition-colors hover:border-solid"
          style={{ borderColor: "var(--color-border)", color: "var(--color-muted)" }}
          onClick={handleAdd}
        >
          + Add condition
        </button>
        {conditions.length > 0 && (
          <button
            className="px-3 py-1.5 rounded text-xs"
            style={{ border: "1px solid var(--color-border)", color: "var(--color-muted)" }}
            onClick={onClear}
          >
            Clear all
          </button>
        )}
      </div>
    </div>
  );
}
