import { useState, useDeferredValue, useMemo } from "react";
import { useCardSearch } from "@/hooks/useCardSearch";
import { CardDetail } from "./CardDetail";
import { CardImage } from "./CardImage";
import type { Card } from "@yugioh/core";

const CARD_TYPES = [
  "Effect Monster", "Normal Monster", "Ritual Monster",
  "Fusion Monster", "Synchro Monster", "XYZ Monster", "Link Monster",
  "Pendulum Effect Monster", "Spell Card", "Trap Card",
];

const ATTRIBUTES = ["DARK", "EARTH", "FIRE", "LIGHT", "WATER", "WIND", "DIVINE"];

const BUDGET_PRESETS = [
  { label: "Any price", value: "" },
  { label: "Under $1",  value: "1" },
  { label: "Under $5",  value: "5" },
  { label: "Under $10", value: "10" },
  { label: "Under $25", value: "25" },
  { label: "Under $50", value: "50" },
];

const PAGE_SIZE = 60;

function getCardPrice(card: Card): number {
  return parseFloat(card.card_prices?.[0]?.tcgplayer_price ?? "0") || 0;
}

function PriceBadge({ price }: { price: number }) {
  if (price === 0) return null;
  const color = price >= 25 ? "var(--color-danger)" : price >= 5 ? "var(--color-accent)" : "#50c878";
  return (
    <span
      className="absolute bottom-0.5 right-0.5 text-xs font-mono font-bold px-1 rounded"
      style={{ backgroundColor: "rgba(0,0,0,0.75)", color }}
    >
      ${price < 10 ? price.toFixed(2) : price.toFixed(0)}
    </span>
  );
}

export default function CardSearchPage() {
  const [nameInput, setNameInput] = useState("");
  const [type, setType] = useState("");
  const [attribute, setAttribute] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);

  const deferredName = useDeferredValue(nameInput);
  const deferredMaxPrice = useDeferredValue(maxPrice);

  const { cards, isLoading } = useCardSearch({
    params: {
      name: deferredName || undefined,
      type: type || undefined,
      attribute: attribute || undefined,
    },
  });

  // Apply budget filter client-side (prices are in the card objects)
  const filteredCards = useMemo(() => {
    const limit = parseFloat(deferredMaxPrice);
    if (!deferredMaxPrice || isNaN(limit)) return cards;
    return cards.filter((card) => {
      const price = getCardPrice(card);
      return price > 0 && price <= limit;
    });
  }, [cards, deferredMaxPrice]);

  const [page, setPage] = useState(1);
  const visibleCards = filteredCards.slice(0, page * PAGE_SIZE);
  const hasMore = visibleCards.length < filteredCards.length;

  function handleFilterChange(setter: (v: string) => void) {
    return (e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) => {
      setter(e.target.value);
      setPage(1);
    };
  }

  return (
    <div className="flex flex-col h-full">
      {/* Search bar */}
      <div className="p-4 flex flex-wrap gap-3 border-b" style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-surface)" }}>
        <input
          type="search"
          placeholder="Search by name..."
          value={nameInput}
          onChange={handleFilterChange(setNameInput)}
          className="flex-1 min-w-48 px-3 py-2 rounded-lg text-sm outline-none"
          style={{
            backgroundColor: "var(--color-bg)",
            border: "1px solid var(--color-border)",
            color: "var(--color-text)",
          }}
        />
        <select
          value={type}
          onChange={handleFilterChange(setType)}
          className="px-3 py-2 rounded-lg text-sm outline-none"
          style={{
            backgroundColor: "var(--color-bg)",
            border: "1px solid var(--color-border)",
            color: type ? "var(--color-text)" : "var(--color-muted)",
          }}
        >
          <option value="">All Types</option>
          {CARD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select
          value={attribute}
          onChange={handleFilterChange(setAttribute)}
          className="px-3 py-2 rounded-lg text-sm outline-none"
          style={{
            backgroundColor: "var(--color-bg)",
            border: "1px solid var(--color-border)",
            color: attribute ? "var(--color-text)" : "var(--color-muted)",
          }}
        >
          <option value="">All Attributes</option>
          {ATTRIBUTES.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>

        {/* Budget filter */}
        <select
          value={maxPrice}
          onChange={handleFilterChange(setMaxPrice)}
          className="px-3 py-2 rounded-lg text-sm outline-none"
          style={{
            backgroundColor: "var(--color-bg)",
            border: `1px solid ${maxPrice ? "var(--color-accent)" : "var(--color-border)"}`,
            color: maxPrice ? "var(--color-accent)" : "var(--color-muted)",
          }}
        >
          {BUDGET_PRESETS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>

        <span className="self-center text-sm" style={{ color: "var(--color-muted)" }}>
          {isLoading
            ? "Loading..."
            : maxPrice
              ? `${filteredCards.length.toLocaleString()} / ${cards.length.toLocaleString()} cards`
              : `${cards.length.toLocaleString()} cards`}
        </span>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-4">
        {isLoading && cards.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-sm" style={{ color: "var(--color-muted)" }}>
            Loading card catalog...
          </div>
        ) : filteredCards.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-sm" style={{ color: "var(--color-muted)" }}>
            No cards match the budget filter. Try increasing the max price.
          </div>
        ) : (
          <>
            <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))" }}>
              {visibleCards.map((card) => {
                const price = getCardPrice(card);
                return (
                  <button
                    key={card.id}
                    className="relative group rounded overflow-hidden focus:outline-none"
                    style={{ aspectRatio: "421/614" }}
                    onClick={() => setSelectedCard(card)}
                    title={`${card.name}${price > 0 ? ` — $${price.toFixed(2)}` : ""}`}
                  >
                    <CardImage
                      card={card}
                      size="small"
                      className="w-full h-full object-cover transition-transform group-hover:scale-105"
                    />
                    {/* Price badge — always visible */}
                    <PriceBadge price={price} />
                    {/* Name on hover */}
                    <div
                      className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-1"
                      style={{ background: "linear-gradient(transparent, rgba(0,0,0,0.8))" }}
                    >
                      <span className="text-white text-xs leading-tight line-clamp-2">{card.name}</span>
                    </div>
                  </button>
                );
              })}
            </div>

            {hasMore && (
              <div className="flex justify-center mt-6">
                <button
                  className="px-6 py-2 rounded-lg text-sm font-medium"
                  style={{
                    backgroundColor: "var(--color-surface)",
                    border: "1px solid var(--color-border)",
                    color: "var(--color-text)",
                  }}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Load more ({filteredCards.length - visibleCards.length} remaining)
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {selectedCard && (
        <CardDetail
          card={selectedCard}
          onClose={() => setSelectedCard(null)}
          onAddToDeck={(_card, _imageIndex) => setSelectedCard(null)}
        />
      )}
    </div>
  );
}
