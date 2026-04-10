import { useState, useDeferredValue, useMemo } from "react";
import {
  View, Text, TextInput, FlatList, TouchableOpacity,
  ScrollView, Pressable, Image, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useCardSearch } from "@/hooks/useCardSearch";
import { useDeckStore } from "@/store/deckStore";
import { CardImage } from "@/components/CardImage";
import { CardDetailModal } from "@/components/CardDetailModal";
import { exportToYdk } from "@yugioh/core";
import type { Card, LabeledDeckCard, DeckZone } from "@yugioh/core";

type ActiveZone = "main" | "extra" | "side";
type RightTab = "deck" | "prices";

// ─── Price helpers ─────────────────────────────────────────────────────────────

function getTcgPrice(card: Card) {
  return parseFloat(card.card_prices?.[0]?.tcgplayer_price ?? "0") || 0;
}

function fmt(n: number) {
  return n === 0 ? "—" : `$${n.toFixed(2)}`;
}

// ─── Zone strip component ──────────────────────────────────────────────────────

function ZoneStrip({
  label, cards, max, zone, onRemove, onArtChange,
}: {
  label: string;
  cards: LabeledDeckCard[];
  max: number;
  zone: ActiveZone;
  onRemove: (id: number) => void;
  onArtChange: (id: number, idx: number) => void;
}) {
  const total = cards.reduce((s, c) => s + c.quantity, 0);
  const over = total > max;

  return (
    <View className="mb-4">
      <View className="flex-row justify-between items-center mb-2 px-1">
        <Text className="text-muted text-xs font-semibold uppercase tracking-wider">{label}</Text>
        <View style={{ backgroundColor: over ? "#e05050" : "#2a2a3a", borderRadius: 99, paddingHorizontal: 8, paddingVertical: 2 }}>
          <Text style={{ color: over ? "#fff" : "#7070a0", fontSize: 11, fontFamily: "monospace" }}>{total}/{max}</Text>
        </View>
      </View>

      {cards.length === 0 ? (
        <View className="border-2 border-dashed border-border rounded-lg h-16 items-center justify-center">
          <Text className="text-muted text-xs">Empty</Text>
        </View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          {cards.map((dc) => (
            <DeckCardChip
              key={dc.card.id}
              dc={dc}
              onRemove={() => onRemove(dc.card.id)}
              onArtChange={(idx) => onArtChange(dc.card.id, idx)}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function DeckCardChip({ dc, onRemove, onArtChange }: {
  dc: LabeledDeckCard;
  onRemove: () => void;
  onArtChange: (idx: number) => void;
}) {
  const { card, quantity, selectedImageIndex = 0 } = dc;
  const hasAlts = card.card_images.length > 1;

  return (
    <View style={{ width: 56, position: "relative" }}>
      <TouchableOpacity
        style={{ aspectRatio: 421 / 614, borderRadius: 6, overflow: "hidden" }}
        onLongPress={() => {
          const options = hasAlts
            ? ["Remove copy", ...card.card_images.map((_, i) => `Art ${i + 1}`), "Cancel"]
            : ["Remove copy", "Cancel"];
          Alert.alert(card.name, undefined, options.map((title, i) => ({
            text: title,
            style: title === "Cancel" ? "cancel" : title === "Remove copy" ? "destructive" : "default",
            onPress: () => {
              if (title === "Remove copy") onRemove();
              else if (title.startsWith("Art ")) onArtChange(i - 1); // offset for "Remove copy"
            },
          })));
        }}
        onPress={onRemove}
      >
        <CardImage card={card} imageIndex={selectedImageIndex} size="small" style={{ width: "100%", height: "100%" }} />
      </TouchableOpacity>

      {quantity > 1 && (
        <View style={{
          position: "absolute", top: 2, right: 2,
          backgroundColor: "#c89b3c", borderRadius: 99,
          width: 16, height: 16, alignItems: "center", justifyContent: "center",
        }}>
          <Text style={{ fontSize: 9, fontWeight: "bold", color: "#000" }}>{quantity}</Text>
        </View>
      )}

      {hasAlts && (
        <View style={{
          position: "absolute", top: 2, left: 2,
          backgroundColor: "rgba(0,0,0,0.7)", borderRadius: 99,
          width: 14, height: 14, alignItems: "center", justifyContent: "center",
        }}>
          <Text style={{ fontSize: 8, color: "#c89b3c", fontWeight: "bold" }}>{card.card_images.length}</Text>
        </View>
      )}
    </View>
  );
}

// ─── Price Summary ─────────────────────────────────────────────────────────────

function PricePanel({ main, extra, side }: { main: LabeledDeckCard[]; extra: LabeledDeckCard[]; side: LabeledDeckCard[] }) {
  const rows = useMemo(() => {
    return [...main, ...extra, ...side].map((dc) => ({
      name: dc.card.name,
      qty: dc.quantity,
      zone: dc.zone,
      unit: getTcgPrice(dc.card),
      total: getTcgPrice(dc.card) * dc.quantity,
    }));
  }, [main, extra, side]);

  const grand = rows.reduce((s, r) => s + r.total, 0);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <View className="items-center">
        <Text className="text-muted text-xs uppercase tracking-wider">Total Deck Value (TCGPlayer)</Text>
        <Text className="text-accent text-3xl font-bold font-mono mt-1">{fmt(grand)}</Text>
      </View>

      {[
        { label: "Main", cards: main },
        { label: "Extra", cards: extra },
        { label: "Side", cards: side },
      ].filter(z => z.cards.length > 0).map(({ label, cards }) => (
        <View key={label} className="bg-bg rounded-xl p-3">
          <Text className="text-muted text-xs font-semibold uppercase mb-1">{label} Deck</Text>
          <Text className="text-accent font-mono font-bold">
            {fmt(cards.reduce((s, dc) => s + getTcgPrice(dc.card) * dc.quantity, 0))}
          </Text>
        </View>
      ))}

      {rows.filter(r => r.unit > 0).sort((a, b) => b.unit - a.unit).map((r, i) => (
        <View key={i} className="flex-row justify-between items-center py-2 border-b border-border">
          <View className="flex-1 mr-2">
            <Text className="text-text text-xs" numberOfLines={1}>{r.name}</Text>
            <Text className="text-muted text-xs">{r.zone} × {r.qty}</Text>
          </View>
          <Text
            className="font-mono text-xs font-semibold"
            style={{ color: r.unit >= 20 ? "#e05050" : r.unit >= 5 ? "#c89b3c" : "#7070a0" }}
          >
            {fmt(r.total)}
          </Text>
        </View>
      ))}
    </ScrollView>
  );
}

// ─── Main Screen ───────────────────────────────────────────────────────────────

export default function DeckBuilderScreen() {
  const [nameInput, setNameInput] = useState("");
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [rightTab, setRightTab] = useState<RightTab>("deck");
  const deferredName = useDeferredValue(nameInput);

  const { name, main, extra, side, addCard, removeCard, setCardImageIndex, clearDeck } = useDeckStore();

  const { cards } = useCardSearch({ name: deferredName || undefined });
  const searchResults = cards.slice(0, 30);

  const deckTotal = [...main, ...extra, ...side].reduce((s, c) => s + c.quantity, 0);
  const deckValue = [...main, ...extra, ...side].reduce((s, dc) => s + getTcgPrice(dc.card) * dc.quantity, 0);

  function handleExport() {
    const ydk = exportToYdk({ id: "x", name, format: "tcg", main, extra, side, createdAt: new Date(), updatedAt: new Date() });
    Alert.alert("YDK Export", `${ydk.slice(0, 120)}…\n\n(Copy from console)`, [{ text: "OK" }]);
    console.log(ydk);
  }

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["left", "right", "bottom"]}>
      <View className="flex-1 flex-row">

        {/* Left: Search panel */}
        <View className="w-44 bg-surface border-r border-border flex-col">
          <View className="p-2 border-b border-border">
            <TextInput
              className="bg-bg border border-border rounded-lg px-3 py-1.5 text-text text-xs"
              placeholder="Search..."
              placeholderTextColor="#7070a0"
              value={nameInput}
              onChangeText={setNameInput}
            />
          </View>
          <FlatList
            data={searchResults}
            keyExtractor={(item) => String(item.id)}
            renderItem={({ item }) => {
              const price = getTcgPrice(item);
              return (
                <TouchableOpacity
                  className="flex-row items-center gap-2 px-2 py-1.5 border-b border-border/50 active:bg-white/5"
                  onPress={() => setSelectedCard(item)}
                  onLongPress={() => addCard(item)}
                >
                  <CardImage card={item} size="small" style={{ width: 28, aspectRatio: 421 / 614, borderRadius: 4 }} />
                  <View className="flex-1 min-w-0">
                    <Text className="text-text text-xs" numberOfLines={1}>{item.name}</Text>
                    <View className="flex-row justify-between">
                      <Text className="text-muted" style={{ fontSize: 9 }}>{item.race}</Text>
                      {price > 0 && (
                        <Text style={{ fontSize: 9, color: price >= 10 ? "#e05050" : "#c89b3c", fontFamily: "monospace" }}>
                          ${price.toFixed(0)}
                        </Text>
                      )}
                    </View>
                  </View>
                  <TouchableOpacity onPress={() => addCard(item)} hitSlop={8}>
                    <Text className="text-accent text-base font-bold">+</Text>
                  </TouchableOpacity>
                </TouchableOpacity>
              );
            }}
          />
        </View>

        {/* Right: Deck */}
        <View className="flex-1 flex-col">
          {/* Header */}
          <View className="flex-row items-center px-3 py-2 bg-surface border-b border-border gap-2">
            <Text className="text-text text-sm font-semibold flex-1" numberOfLines={1}>{name}</Text>
            <Text className="text-muted text-xs font-mono">{deckTotal}c</Text>
            {deckValue > 0 && (
              <Text className="text-accent text-xs font-mono">{fmt(deckValue)}</Text>
            )}
            <TouchableOpacity onPress={handleExport} hitSlop={8}>
              <Text className="text-accent text-xs font-semibold">YDK</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={clearDeck} hitSlop={8}>
              <Text className="text-muted text-xs">Clear</Text>
            </TouchableOpacity>
          </View>

          {/* Tabs */}
          <View className="flex-row bg-surface border-b border-border">
            {(["deck", "prices"] as RightTab[]).map((tab) => (
              <TouchableOpacity
                key={tab}
                className="flex-1 py-2.5 items-center"
                style={{ borderBottomWidth: 2, borderBottomColor: rightTab === tab ? "#c89b3c" : "transparent" }}
                onPress={() => setRightTab(tab)}
              >
                <Text style={{ color: rightTab === tab ? "#c89b3c" : "#7070a0", fontSize: 12, fontWeight: rightTab === tab ? "700" : "400", textTransform: "capitalize" }}>
                  {tab}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {rightTab === "deck" ? (
            <ScrollView className="flex-1 px-3 pt-3">
              <ZoneStrip label="Main Deck" cards={main} max={60} zone="main"
                onRemove={(id) => removeCard(id, "main")}
                onArtChange={(id, idx) => setCardImageIndex(id, "main", idx)} />
              <ZoneStrip label="Extra Deck" cards={extra} max={15} zone="extra"
                onRemove={(id) => removeCard(id, "extra")}
                onArtChange={(id, idx) => setCardImageIndex(id, "extra", idx)} />
              <ZoneStrip label="Side Deck" cards={side} max={15} zone="side"
                onRemove={(id) => removeCard(id, "side")}
                onArtChange={(id, idx) => setCardImageIndex(id, "side", idx)} />
            </ScrollView>
          ) : (
            <PricePanel main={main} extra={extra} side={side} />
          )}
        </View>
      </View>

      <CardDetailModal
        card={selectedCard}
        onClose={() => setSelectedCard(null)}
        onAddToDeck={(card, imageIndex) => { addCard(card, undefined, imageIndex); setSelectedCard(null); }}
      />
    </SafeAreaView>
  );
}
