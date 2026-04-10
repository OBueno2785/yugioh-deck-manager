import { useState } from "react";
import type { Card, CardSet } from "@yugioh/core";
import { CardImage } from "./CardImage";
import { useCardSets } from "@/hooks/useCardSets";

interface CardDetailProps {
  card: Card;
  onClose: () => void;
  /** If provided, shows "Add to Deck" button and passes selected imageIndex */
  onAddToDeck?: (card: Card, imageIndex: number) => void;
}

// ─── Rarity colors ────────────────────────────────────────────────────────────

const RARITY_COLORS: Record<string, string> = {
  "Common":              "#aaa",
  "Rare":                "#88aaff",
  "Super Rare":          "#ffcc44",
  "Ultra Rare":          "#ffaa00",
  "Secret Rare":         "#ff44cc",
  "Ultimate Rare":       "#50c878",
  "Ghost Rare":          "#ccffff",
  "Platinum Rare":       "#e0e0e0",
  "Starlight Rare":      "#ffe44d",
  "Quarter Century SR":  "#c89b3c",
  "Collector's Rare":    "#ff88ff",
  "Prismatic Secret Rare": "#ff66ff",
  "Short Print":         "#aaa",
  "Super Short Print":   "#aaa",
};

function rarityColor(rarity: string): string {
  return RARITY_COLORS[rarity] ?? "#999";
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PriceTag({ label, value }: { label: string; value: string }) {
  const num = parseFloat(value);
  if (!num || num === 0) return null;
  return (
    <div className="flex justify-between text-sm py-1 border-b" style={{ borderColor: "var(--color-border)" }}>
      <span style={{ color: "var(--color-muted)" }}>{label}</span>
      <span className="font-mono font-semibold" style={{ color: "var(--color-accent)" }}>
        ${num.toFixed(2)}
      </span>
    </div>
  );
}

function BanBadge({ format, status }: { format: string; status: string }) {
  const colors: Record<string, string> = {
    Banned: "#e05050", Limited: "#e08830",
    "Semi-Limited": "#e0c030", Unlimited: "#50c878",
  };
  return (
    <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
      style={{ backgroundColor: colors[status] ?? "#888", color: "#000" }}>
      {format}: {status}
    </span>
  );
}

function SetList({ sets }: { sets: CardSet[] }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? sets : sets.slice(0, 4);

  return (
    <div>
      <div className="space-y-1">
        {shown.map((s, i) => (
          <div key={i} className="flex items-center justify-between text-xs gap-2">
            <span className="truncate" style={{ color: "var(--color-muted)" }}>
              {s.set_code} — {s.set_name}
            </span>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span
                className="font-semibold px-1.5 py-0.5 rounded text-xs"
                style={{
                  color: rarityColor(s.set_rarity),
                  backgroundColor: `${rarityColor(s.set_rarity)}18`,
                  border: `1px solid ${rarityColor(s.set_rarity)}44`,
                  whiteSpace: "nowrap",
                }}
              >
                {s.set_rarity}
              </span>
              {parseFloat(s.set_price) > 0 && (
                <span className="font-mono" style={{ color: "var(--color-accent)" }}>
                  ${parseFloat(s.set_price).toFixed(2)}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
      {sets.length > 4 && (
        <button
          className="text-xs mt-1"
          style={{ color: "var(--color-muted)" }}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Show less" : `+${sets.length - 4} more printings`}
        </button>
      )}
    </div>
  );
}

// ─── Art Picker ───────────────────────────────────────────────────────────────

function ArtPicker({
  card,
  selectedIndex,
  onChange,
}: {
  card: Card;
  selectedIndex: number;
  onChange: (i: number) => void;
}) {
  if (card.card_images.length <= 1) return null;

  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--color-muted)" }}>
        Alternate Arts ({card.card_images.length})
      </h3>
      <div className="flex gap-2 flex-wrap">
        {card.card_images.map((img, i) => (
          <button
            key={img.id}
            className="rounded overflow-hidden flex-shrink-0 transition-all"
            style={{
              width: 52,
              aspectRatio: "421/614",
              outline: selectedIndex === i
                ? "2px solid var(--color-accent)"
                : "2px solid var(--color-border)",
              outlineOffset: "2px",
              opacity: selectedIndex === i ? 1 : 0.6,
            }}
            onClick={() => onChange(i)}
            title={`Art ${i + 1}`}
          >
            <img
              src={img.image_url_small}
              alt={`Art ${i + 1}`}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function CardDetail({ card, onClose, onAddToDeck }: CardDetailProps) {
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const isMonster = card.type.toLowerCase().includes("monster");

  // Fetch full set data on demand
  const { data: cardWithSets, isLoading: setsLoading } = useCardSets(card.id);
  const sets = cardWithSets?.card_sets ?? [];
  const price = card.card_prices?.[0];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.75)" }}
      onClick={onClose}
    >
      <div
        className="relative rounded-xl max-w-lg w-full max-h-[92vh] overflow-y-auto"
        style={{ backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="absolute top-3 right-3 z-10 text-lg leading-none opacity-50 hover:opacity-100"
          onClick={onClose}
        >✕</button>

        <div className="p-5 space-y-4">
          {/* ── Card header ─────────────────────────────────────────── */}
          <div className="flex gap-4">
            <div className="flex-shrink-0">
              <CardImage
                card={card}
                size="normal"
                imageIndex={selectedImageIndex}
                className="w-36 h-52 object-cover rounded-lg"
              />
            </div>

            <div className="flex-1 min-w-0">
              <h2 className="font-bold text-base leading-tight mb-1" style={{ color: "var(--color-text)" }}>
                {card.name}
              </h2>
              <div className="text-xs mb-2 space-y-0.5" style={{ color: "var(--color-muted)" }}>
                <div>{card.type}</div>
                {card.archetype && <div>Archetype: {card.archetype}</div>}
                {isMonster && (
                  <>
                    {card.attribute && <div>{card.attribute} / {card.race}</div>}
                    {card.level !== undefined && <div>Level {card.level}</div>}
                    {card.linkval !== undefined && <div>Link {card.linkval}</div>}
                    {card.scale !== undefined && <div>Pendulum Scale {card.scale}</div>}
                    <div className="font-mono">
                      ATK {card.atk ?? "?"} / DEF {card.def ?? "?"}
                    </div>
                    {card.linkmarkers && card.linkmarkers.length > 0 && (
                      <div>Links: {card.linkmarkers.join(", ")}</div>
                    )}
                  </>
                )}
                {!isMonster && <div>{card.race}</div>}
              </div>

              {/* Ban status */}
              {card.banlist_info && (
                <div className="flex gap-1.5 flex-wrap">
                  {card.banlist_info.ban_tcg && (
                    <BanBadge format="TCG" status={card.banlist_info.ban_tcg} />
                  )}
                  {card.banlist_info.ban_ocg && (
                    <BanBadge format="OCG" status={card.banlist_info.ban_ocg} />
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── Description ─────────────────────────────────────────── */}
          <p className="text-sm leading-relaxed" style={{ color: "var(--color-muted)" }}>
            {card.desc}
          </p>

          {/* ── Art picker ──────────────────────────────────────────── */}
          <ArtPicker
            card={card}
            selectedIndex={selectedImageIndex}
            onChange={setSelectedImageIndex}
          />

          {/* ── Sets & rarity ───────────────────────────────────────── */}
          {(setsLoading || sets.length > 0) && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--color-muted)" }}>
                Printings & Rarity
              </h3>
              {setsLoading ? (
                <p className="text-xs" style={{ color: "var(--color-muted)" }}>Loading sets…</p>
              ) : (
                <SetList sets={sets} />
              )}
            </div>
          )}

          {/* ── Prices ──────────────────────────────────────────────── */}
          {price && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--color-muted)" }}>
                Market Prices
              </h3>
              <PriceTag label="TCGPlayer"    value={price.tcgplayer_price} />
              <PriceTag label="Cardmarket"   value={price.cardmarket_price} />
              <PriceTag label="CoolStuffInc" value={price.coolstuffinc_price} />
            </div>
          )}

          {/* ── Add to Deck ─────────────────────────────────────────── */}
          {onAddToDeck && (
            <button
              className="w-full py-2 rounded-lg text-sm font-semibold"
              style={{ backgroundColor: "var(--color-accent)", color: "#000" }}
              onClick={() => onAddToDeck(card, selectedImageIndex)}
            >
              + Add to Deck
              {card.card_images.length > 1 && (
                <span className="ml-1 opacity-70 text-xs">
                  (Art {selectedImageIndex + 1}/{card.card_images.length})
                </span>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
