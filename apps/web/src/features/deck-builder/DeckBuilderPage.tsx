import { useState, useDeferredValue } from "react";
import { useCardSearch } from "@/hooks/useCardSearch";
import { useDeckStore } from "@/store/deckStore";
import { useDeckPrices } from "@/hooks/useDeckPrices";
import { CardImage } from "@/features/cards/CardImage";
import { CardDetail } from "@/features/cards/CardDetail";
import { DeckZone } from "./DeckZone";
import { DeckStats } from "./DeckStats";
import { PriceSummary } from "./PriceSummary";
import { ConsistencyPanel } from "./ConsistencyPanel";
import { SimulatorPanel } from "./SimulatorPanel";
import { exportToYdk } from "@yugioh/core";
import type { Card, Deck } from "@yugioh/core";

const CARD_TYPES = [
  "Effect Monster", "Normal Monster", "Ritual Monster",
  "Fusion Monster", "Synchro Monster", "XYZ Monster", "Link Monster",
  "Pendulum Effect Monster", "Spell Card", "Trap Card",
];

type RightTab = "deck" | "prices" | "consistency" | "simulator";

function downloadText(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function DeckBuilderPage() {
  const { name, format, main, extra, side, setName, setFormat, addCard, clearDeck } = useDeckStore();
  const [nameInput, setNameInput] = useState("");
  const [type, setType] = useState("");
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [rightTab, setRightTab] = useState<RightTab>("deck");
  const deferredName = useDeferredValue(nameInput);

  const { cards, isLoading } = useCardSearch({
    params: {
      name: deferredName || undefined,
      type: type || undefined,
    },
  });

  const { grandTotalTcg } = useDeckPrices(main, extra, side);

  const searchResults = cards.slice(0, 40);

  function handleExportYdk() {
    const deck: Deck = {
      id: "export",
      name,
      format,
      main,
      extra,
      side,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const ydk = exportToYdk(deck);
    downloadText(ydk, `${name.replace(/\s+/g, "_")}.ydk`);
  }

  return (
    <div className="flex h-[calc(100vh-49px)]">
      {/* Left: Card Search Panel */}
      <div className="w-72 flex-shrink-0 flex flex-col border-r" style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-surface)" }}>
        <div className="p-3 space-y-2 border-b" style={{ borderColor: "var(--color-border)" }}>
          <input
            type="search"
            placeholder="Search cards..."
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            className="w-full px-3 py-1.5 rounded text-sm outline-none"
            style={{
              backgroundColor: "var(--color-bg)",
              border: "1px solid var(--color-border)",
              color: "var(--color-text)",
            }}
          />
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="w-full px-2 py-1.5 rounded text-sm outline-none"
            style={{
              backgroundColor: "var(--color-bg)",
              border: "1px solid var(--color-border)",
              color: type ? "var(--color-text)" : "var(--color-muted)",
            }}
          >
            <option value="">All Types</option>
            {CARD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {isLoading && searchResults.length === 0 ? (
            <div className="text-xs text-center mt-4" style={{ color: "var(--color-muted)" }}>Loading...</div>
          ) : (
            <div className="space-y-0.5">
              {searchResults.map((card) => (
                <SearchResultRow
                  key={card.id}
                  card={card}
                  onAdd={() => addCard(card)}
                  onView={() => setSelectedCard(card)}
                />
              ))}
              {cards.length > 40 && (
                <p className="text-xs text-center py-2" style={{ color: "var(--color-muted)" }}>
                  Showing 40 of {cards.length} — refine your search
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Deck header */}
        <div className="flex items-center gap-3 px-4 py-2 border-b" style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-surface)" }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="font-semibold text-sm bg-transparent outline-none flex-1"
            style={{ color: "var(--color-text)" }}
          />
          <select
            value={format}
            onChange={(e) => setFormat(e.target.value as "tcg" | "ocg" | "goat" | "edison")}
            className="text-xs px-2 py-1 rounded outline-none"
            style={{
              backgroundColor: "var(--color-bg)",
              border: "1px solid var(--color-border)",
              color: "var(--color-text)",
            }}
          >
            <option value="tcg">TCG</option>
            <option value="ocg">OCG</option>
            <option value="goat">GOAT</option>
            <option value="edison">Edison</option>
          </select>
          <button
            onClick={handleExportYdk}
            className="text-xs px-3 py-1 rounded font-medium"
            style={{ backgroundColor: "var(--color-accent)", color: "#000" }}
          >
            Export YDK
          </button>
          <button
            onClick={clearDeck}
            className="text-xs px-3 py-1 rounded"
            style={{ border: "1px solid var(--color-border)", color: "var(--color-muted)" }}
          >
            Clear
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b" style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-surface)" }}>
          <TabButton active={rightTab === "deck"} onClick={() => setRightTab("deck")}>
            Deck
          </TabButton>
          <TabButton active={rightTab === "prices"} onClick={() => setRightTab("prices")}>
            Prices
            {grandTotalTcg > 0 && (
              <span
                className="ml-2 text-xs font-mono px-1.5 py-0.5 rounded"
                style={{
                  backgroundColor: rightTab === "prices" ? "rgba(0,0,0,0.2)" : "var(--color-border)",
                  color: rightTab === "prices" ? "#000" : "var(--color-accent)",
                }}
              >
                ${grandTotalTcg.toFixed(0)}
              </span>
            )}
          </TabButton>
          <TabButton active={rightTab === "consistency"} onClick={() => setRightTab("consistency")}>
            Consistency
          </TabButton>
          <TabButton active={rightTab === "simulator"} onClick={() => setRightTab("simulator")}>
            Simulator
          </TabButton>
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto">
          {rightTab === "deck" && (
            <div className="p-4 space-y-4">
              <DeckStats main={main} extra={extra} side={side} />
              <DeckZone zone="main"  cards={main}  label="Main Deck"  maxCards={60} />
              <DeckZone zone="extra" cards={extra} label="Extra Deck" maxCards={15} />
              <DeckZone zone="side"  cards={side}  label="Side Deck"  maxCards={15} />
            </div>
          )}
          {rightTab === "prices" && (
            <PriceSummary main={main} extra={extra} side={side} />
          )}
          {rightTab === "consistency" && (
            <ConsistencyPanel main={main} extra={extra} side={side} format={format} />
          )}
          {rightTab === "simulator" && (
            <SimulatorPanel main={main} extra={extra} />
          )}
        </div>
      </div>

      {selectedCard && (
        <CardDetail
          card={selectedCard}
          onClose={() => setSelectedCard(null)}
          onAddToDeck={(card, imageIndex) => { addCard(card, undefined, imageIndex); setSelectedCard(null); }}
        />
      )}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      className="px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center"
      style={{
        borderBottomColor: active ? "var(--color-accent)" : "transparent",
        color: active ? "var(--color-accent)" : "var(--color-muted)",
        backgroundColor: "transparent",
      }}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function SearchResultRow({ card, onAdd, onView }: { card: Card; onAdd: () => void; onView: () => void }) {
  const price = parseFloat(card.card_prices?.[0]?.tcgplayer_price ?? "0") || 0;
  return (
    <div
      className="flex items-center gap-2 p-1.5 rounded hover:bg-white/5 cursor-pointer group"
      onClick={onView}
    >
      <CardImage card={card} size="small" className="w-8 h-11 object-cover rounded flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium truncate" style={{ color: "var(--color-text)" }}>{card.name}</div>
        <div className="flex items-center gap-1">
          <span className="text-xs truncate" style={{ color: "var(--color-muted)" }}>{card.race}</span>
          {price > 0 && (
            <span
              className="text-xs font-mono ml-auto"
              style={{ color: price >= 10 ? "var(--color-danger)" : price >= 2 ? "var(--color-accent)" : "#50c878" }}
            >
              ${price.toFixed(2)}
            </span>
          )}
        </div>
      </div>
      <button
        className="opacity-0 group-hover:opacity-100 text-lg leading-none font-bold px-2 transition-opacity"
        style={{ color: "var(--color-accent)" }}
        onClick={(e) => { e.stopPropagation(); onAdd(); }}
        title="Add to deck"
      >
        +
      </button>
    </div>
  );
}
