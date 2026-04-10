import { useState } from "react";
import type { LabeledDeckCard, DeckZone as DeckZoneType, CardRole } from "@yugioh/core";
import { CardImage } from "@/features/cards/CardImage";
import { useDeckStore } from "@/store/deckStore";

const ROLE_COLORS: Record<CardRole, string> = {
  starter:    "#50c878",
  extender:   "#4da6ff",
  handtrap:   "#c878c8",
  boardbreak: "#ff6b6b",
  garnets:    "#888",
  engine:     "#c89b3c",
  tech:       "#ff9f4a",
};

interface DeckZoneProps {
  zone: DeckZoneType;
  cards: LabeledDeckCard[];
  label: string;
  maxCards: number;
}

export function DeckZone({ zone, cards, label, maxCards }: DeckZoneProps) {
  const { removeCard, setCardRole, setCardImageIndex } = useDeckStore();
  const totalCards = cards.reduce((s, c) => s + c.quantity, 0);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between px-1">
        <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--color-muted)" }}>
          {label}
        </span>
        <span
          className="text-xs font-mono px-2 py-0.5 rounded-full"
          style={{
            backgroundColor: totalCards > maxCards ? "var(--color-danger)" : "var(--color-surface)",
            color: totalCards > maxCards ? "#fff" : "var(--color-muted)",
            border: "1px solid var(--color-border)",
          }}
        >
          {totalCards} / {maxCards}
        </span>
      </div>

      {cards.length === 0 ? (
        <div
          className="rounded-lg border-2 border-dashed flex items-center justify-center h-20 text-xs"
          style={{ borderColor: "var(--color-border)", color: "var(--color-muted)" }}
        >
          Empty
        </div>
      ) : (
        <div className="grid gap-1" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(56px, 1fr))" }}>
          {cards.map((dc) => (
            <DeckCardSlot
              key={dc.card.id}
              deckCard={dc}
              zone={zone}
              onRemove={() => removeCard(dc.card.id, zone)}
              onRoleChange={(role) => setCardRole(dc.card.id, zone, role)}
              onImageIndexChange={(idx) => setCardImageIndex(dc.card.id, zone, idx)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface DeckCardSlotProps {
  deckCard: LabeledDeckCard;
  zone: DeckZoneType;
  onRemove: () => void;
  onRoleChange: (role: CardRole | undefined) => void;
  onImageIndexChange: (idx: number) => void;
}

function DeckCardSlot({ deckCard, onRemove, onRoleChange, onImageIndexChange }: DeckCardSlotProps) {
  const { card, quantity, role, selectedImageIndex = 0 } = deckCard;
  const hasAlts = card.card_images.length > 1;
  const [showArtPicker, setShowArtPicker] = useState(false);

  return (
    <>
      <div className="relative group" style={{ aspectRatio: "421/614" }}>
        <CardImage
          card={card}
          size="small"
          imageIndex={selectedImageIndex}
          className="w-full h-full object-cover rounded"
        />

        {/* Quantity badge */}
        {quantity > 1 && (
          <span
            className="absolute top-0.5 right-0.5 text-xs font-bold w-4 h-4 rounded-full flex items-center justify-center"
            style={{ backgroundColor: "var(--color-accent)", color: "#000" }}
          >
            {quantity}
          </span>
        )}

        {/* Alt art indicator */}
        {hasAlts && (
          <span
            className="absolute top-0.5 left-0.5 text-xs w-4 h-4 rounded-full flex items-center justify-center"
            style={{ backgroundColor: "rgba(0,0,0,0.7)", color: "var(--color-accent)" }}
            title={`${card.card_images.length} arts available`}
          >
            {card.card_images.length}
          </span>
        )}

        {/* Role dot */}
        {role && (
          <span
            className="absolute bottom-0.5 left-0.5 w-2 h-2 rounded-full"
            style={{ backgroundColor: ROLE_COLORS[role] }}
            title={role}
          />
        )}

        {/* Hover overlay */}
        <div
          className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col rounded overflow-hidden"
          style={{ background: "rgba(0,0,0,0.85)" }}
        >
          <button
            className="flex-1 text-base font-semibold hover:text-red-400 transition-colors"
            style={{ color: "var(--color-text)" }}
            onClick={onRemove}
            title="Remove one copy"
          >
            −
          </button>

          {/* Art switcher button — only if multiple arts */}
          {hasAlts && (
            <button
              className="py-0.5 text-xs font-medium"
              style={{ color: "var(--color-accent)", borderTop: "1px solid rgba(255,255,255,0.1)" }}
              onClick={() => setShowArtPicker(true)}
              title="Change art"
            >
              Art {selectedImageIndex + 1}/{card.card_images.length}
            </button>
          )}

          <select
            className="text-xs px-0.5 py-0.5 w-full"
            style={{
              backgroundColor: "transparent",
              color: "var(--color-muted)",
              border: "none",
              outline: "none",
              borderTop: "1px solid rgba(255,255,255,0.1)",
            }}
            value={role ?? ""}
            onChange={(e) => onRoleChange((e.target.value || undefined) as CardRole | undefined)}
            title="Set role"
          >
            <option value="">Role…</option>
            <option value="starter">Starter</option>
            <option value="extender">Extender</option>
            <option value="handtrap">Handtrap</option>
            <option value="boardbreak">Boardbreak</option>
            <option value="garnets">Garnets</option>
            <option value="engine">Engine</option>
            <option value="tech">Tech</option>
          </select>
        </div>
      </div>

      {/* Art picker modal */}
      {showArtPicker && (
        <ArtPickerModal
          card={card}
          currentIndex={selectedImageIndex}
          onSelect={(idx) => { onImageIndexChange(idx); setShowArtPicker(false); }}
          onClose={() => setShowArtPicker(false)}
        />
      )}
    </>
  );
}

function ArtPickerModal({
  card,
  currentIndex,
  onSelect,
  onClose,
}: {
  card: LabeledDeckCard["card"];
  currentIndex: number;
  onSelect: (idx: number) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.75)" }}
      onClick={onClose}
    >
      <div
        className="rounded-xl p-4 max-w-xs w-full"
        style={{ backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-3">
          <span className="font-semibold text-sm truncate" style={{ color: "var(--color-text)" }}>
            {card.name}
          </span>
          <button className="text-sm opacity-50 hover:opacity-100 ml-2 flex-shrink-0" onClick={onClose}>✕</button>
        </div>
        <p className="text-xs mb-3" style={{ color: "var(--color-muted)" }}>
          Select which art to use in your deck
        </p>
        <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(64px, 1fr))" }}>
          {card.card_images.map((img, i) => (
            <button
              key={img.id}
              className="rounded overflow-hidden"
              style={{
                aspectRatio: "421/614",
                outline: currentIndex === i ? "2px solid var(--color-accent)" : "2px solid var(--color-border)",
                outlineOffset: "2px",
              }}
              onClick={() => onSelect(i)}
              title={`Art ${i + 1} (ID: ${img.id})`}
            >
              <img src={img.image_url_small} alt={`Art ${i + 1}`} className="w-full h-full object-cover" loading="lazy" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
