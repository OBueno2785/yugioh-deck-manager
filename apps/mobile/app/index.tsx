/**
 * Card Search Screen
 * Grid of cards with name/type/attribute/budget filters.
 * Tap a card to open CardDetailModal with arts, rarity, and "Add to Deck".
 */

import { useState, useDeferredValue, useMemo } from "react";
import {
  View, Text, TextInput, FlatList, TouchableOpacity,
  ScrollView, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useCardSearch } from "@/hooks/useCardSearch";
import { useDeckStore } from "@/store/deckStore";
import { CardImage } from "@/components/CardImage";
import { CardDetailModal } from "@/components/CardDetailModal";
import type { Card } from "@yugioh/core";

const CARD_TYPES = [
  "All Types", "Effect Monster", "Normal Monster", "Fusion Monster",
  "Synchro Monster", "XYZ Monster", "Link Monster", "Spell Card", "Trap Card",
];

const BUDGET_PRESETS = [
  { label: "Any", value: 0 },
  { label: "<$1", value: 1 },
  { label: "<$5", value: 5 },
  { label: "<$10", value: 10 },
  { label: "<$25", value: 25 },
];

function getPrice(card: Card) {
  return parseFloat(card.card_prices?.[0]?.tcgplayer_price ?? "0") || 0;
}

function PriceLabel({ price }: { price: number }) {
  if (price === 0) return null;
  const color = price >= 25 ? "#e05050" : price >= 5 ? "#c89b3c" : "#50c878";
  return (
    <Text
      style={{
        position: "absolute", bottom: 2, right: 2,
        fontSize: 9, fontFamily: "monospace", fontWeight: "700",
        color, backgroundColor: "rgba(0,0,0,0.75)",
        paddingHorizontal: 3, paddingVertical: 1, borderRadius: 3,
      }}
    >
      ${price < 10 ? price.toFixed(2) : Math.round(price)}
    </Text>
  );
}

const CARD_W = 72;
const NUM_COLS = 4;

export default function CardSearchScreen() {
  const [nameInput, setNameInput] = useState("");
  const [selectedType, setSelectedType] = useState("");
  const [maxPrice, setMaxPrice] = useState(0);
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);

  const deferredName = useDeferredValue(nameInput);
  const addCard = useDeckStore((s) => s.addCard);

  const { cards, isLoading } = useCardSearch({ name: deferredName || undefined, type: selectedType || undefined });

  const filtered = useMemo(() => {
    if (!maxPrice) return cards;
    return cards.filter((c) => { const p = getPrice(c); return p > 0 && p <= maxPrice; });
  }, [cards, maxPrice]);

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["left", "right", "bottom"]}>
      {/* Search bar */}
      <View className="px-3 pt-2 pb-1 bg-surface border-b border-border gap-2">
        <TextInput
          className="bg-bg border border-border rounded-lg px-3 py-2 text-text text-sm"
          placeholder="Search cards..."
          placeholderTextColor="#7070a0"
          value={nameInput}
          onChangeText={setNameInput}
          clearButtonMode="while-editing"
        />
        {/* Type filter chips */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          {CARD_TYPES.map((t) => {
            const val = t === "All Types" ? "" : t;
            const active = selectedType === val;
            return (
              <TouchableOpacity
                key={t}
                onPress={() => setSelectedType(val)}
                style={{
                  paddingHorizontal: 10, paddingVertical: 4, borderRadius: 99,
                  backgroundColor: active ? "#c89b3c" : "#2a2a3a",
                }}
              >
                <Text style={{ color: active ? "#000" : "#7070a0", fontSize: 11, fontWeight: active ? "700" : "400" }}>
                  {t}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        {/* Budget chips */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          {BUDGET_PRESETS.map((p) => {
            const active = maxPrice === p.value;
            return (
              <TouchableOpacity
                key={p.label}
                onPress={() => setMaxPrice(p.value)}
                style={{
                  paddingHorizontal: 10, paddingVertical: 4, borderRadius: 99,
                  backgroundColor: active ? "#c89b3c" : "#2a2a3a",
                  borderWidth: active ? 0 : 1,
                  borderColor: "#2a2a3a",
                }}
              >
                <Text style={{ color: active ? "#000" : "#7070a0", fontSize: 11, fontWeight: active ? "700" : "400" }}>
                  {p.label}
                </Text>
              </TouchableOpacity>
            );
          })}
          <Text style={{ color: "#7070a0", fontSize: 11, alignSelf: "center" }}>
            {isLoading ? "Loading..." : `${filtered.length.toLocaleString()} cards`}
          </Text>
        </ScrollView>
      </View>

      {isLoading && filtered.length === 0 ? (
        <View className="flex-1 items-center justify-center gap-3">
          <ActivityIndicator color="#c89b3c" size="large" />
          <Text className="text-muted text-sm">Loading card catalog…</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => String(item.id)}
          numColumns={NUM_COLS}
          contentContainerStyle={{ padding: 8, gap: 6 }}
          columnWrapperStyle={{ gap: 6 }}
          renderItem={({ item }) => {
            const price = getPrice(item);
            const hasAlts = item.card_images.length > 1;
            return (
              <TouchableOpacity
                onPress={() => setSelectedCard(item)}
                style={{ width: CARD_W, aspectRatio: 421 / 614, borderRadius: 6, overflow: "hidden" }}
              >
                <CardImage card={item} size="small" style={{ width: "100%", height: "100%" }} />
                <PriceLabel price={price} />
                {hasAlts && (
                  <View style={{
                    position: "absolute", top: 2, left: 2,
                    backgroundColor: "rgba(0,0,0,0.7)", borderRadius: 99,
                    width: 16, height: 16, alignItems: "center", justifyContent: "center",
                  }}>
                    <Text style={{ color: "#c89b3c", fontSize: 9, fontWeight: "bold" }}>
                      {item.card_images.length}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          }}
          initialNumToRender={40}
          maxToRenderPerBatch={20}
          windowSize={5}
        />
      )}

      <CardDetailModal
        card={selectedCard}
        onClose={() => setSelectedCard(null)}
        onAddToDeck={(card, imageIndex) => { addCard(card, undefined, imageIndex); }}
      />
    </SafeAreaView>
  );
}
