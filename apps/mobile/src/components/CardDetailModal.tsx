import { useState } from "react";
import {
  Modal, View, Text, ScrollView, TouchableOpacity,
  Image, ActivityIndicator, Pressable,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import type { Card, CardSet } from "@yugioh/core";
import { CardImage } from "./CardImage";
import { fetchCardWithSets } from "@/lib/ygoproApi";

const RARITY_COLORS: Record<string, string> = {
  "Common": "#aaa",
  "Rare": "#88aaff",
  "Super Rare": "#ffcc44",
  "Ultra Rare": "#ffaa00",
  "Secret Rare": "#ff44cc",
  "Ultimate Rare": "#50c878",
  "Ghost Rare": "#ccffff",
  "Starlight Rare": "#ffe44d",
};

function rarityColor(r: string) {
  return RARITY_COLORS[r] ?? "#999";
}

function BanBadge({ format, status }: { format: string; status: string }) {
  const bg: Record<string, string> = {
    Banned: "#e05050", Limited: "#e08830",
    "Semi-Limited": "#e0c030", Unlimited: "#50c878",
  };
  return (
    <View style={{ backgroundColor: bg[status] ?? "#888", borderRadius: 99, paddingHorizontal: 8, paddingVertical: 2, marginRight: 4 }}>
      <Text style={{ color: "#000", fontSize: 10, fontWeight: "bold" }}>{format}: {status}</Text>
    </View>
  );
}

interface CardDetailModalProps {
  card: Card | null;
  onClose: () => void;
  onAddToDeck?: (card: Card, imageIndex: number) => void;
}

export function CardDetailModal({ card, onClose, onAddToDeck }: CardDetailModalProps) {
  const [imageIndex, setImageIndex] = useState(0);

  const { data: cardWithSets, isLoading: setsLoading } = useQuery({
    queryKey: ["card", "sets", card?.id],
    queryFn: () => fetchCardWithSets(card!.id),
    enabled: !!card,
    staleTime: Infinity,
  });

  if (!card) return null;
  const sets: CardSet[] = cardWithSets?.card_sets ?? [];
  const price = card.card_prices?.[0];
  const isMonster = card.type.toLowerCase().includes("monster");

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View className="flex-1 bg-surface">
        {/* Header */}
        <View className="flex-row items-center justify-between px-4 py-3 border-b border-border">
          <Text className="text-text font-bold text-base flex-1 mr-2" numberOfLines={1}>{card.name}</Text>
          <TouchableOpacity onPress={onClose}>
            <Text className="text-muted text-lg">✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, gap: 16 }}>
          {/* Card + info */}
          <View className="flex-row gap-4">
            <CardImage
              card={card}
              size="normal"
              imageIndex={imageIndex}
              style={{ width: 120, aspectRatio: 421 / 614, borderRadius: 8 }}
            />
            <View className="flex-1">
              <Text className="text-muted text-xs mb-1">{card.type}</Text>
              {card.archetype && <Text className="text-muted text-xs">Archetype: {card.archetype}</Text>}
              {isMonster && (
                <>
                  {card.attribute && <Text className="text-muted text-xs">{card.attribute} / {card.race}</Text>}
                  {card.level != null && <Text className="text-muted text-xs">Level {card.level}</Text>}
                  {card.linkval != null && <Text className="text-muted text-xs">Link {card.linkval}</Text>}
                  {card.scale != null && <Text className="text-muted text-xs">Pendulum {card.scale}</Text>}
                  <Text className="text-muted text-xs font-mono">ATK {card.atk ?? "?"} / DEF {card.def ?? "?"}</Text>
                </>
              )}
              {!isMonster && <Text className="text-muted text-xs">{card.race}</Text>}
              {/* Ban badges */}
              {card.banlist_info && (
                <View className="flex-row flex-wrap mt-1 gap-1">
                  {card.banlist_info.ban_tcg && <BanBadge format="TCG" status={card.banlist_info.ban_tcg} />}
                  {card.banlist_info.ban_ocg && <BanBadge format="OCG" status={card.banlist_info.ban_ocg} />}
                </View>
              )}
            </View>
          </View>

          {/* Description */}
          <Text className="text-muted text-sm leading-5">{card.desc}</Text>

          {/* Alt arts picker */}
          {card.card_images.length > 1 && (
            <View>
              <Text className="text-muted text-xs uppercase font-semibold mb-2">
                Alternate Arts ({card.card_images.length})
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                {card.card_images.map((img, i) => (
                  <Pressable
                    key={img.id}
                    onPress={() => setImageIndex(i)}
                    style={{
                      width: 56, aspectRatio: 421 / 614, borderRadius: 6, overflow: "hidden",
                      borderWidth: 2,
                      borderColor: imageIndex === i ? "#c89b3c" : "#2a2a3a",
                    }}
                  >
                    <Image source={{ uri: img.image_url_small }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          )}

          {/* Sets & Rarity */}
          {(setsLoading || sets.length > 0) && (
            <View>
              <Text className="text-muted text-xs uppercase font-semibold mb-2">Printings & Rarity</Text>
              {setsLoading ? (
                <ActivityIndicator color="#c89b3c" />
              ) : (
                sets.slice(0, 8).map((s, i) => (
                  <View key={i} className="flex-row items-center justify-between py-1.5 border-b border-border">
                    <View className="flex-1 mr-2">
                      <Text className="text-text text-xs">{s.set_code}</Text>
                      <Text className="text-muted text-xs" numberOfLines={1}>{s.set_name}</Text>
                    </View>
                    <View className="items-end">
                      <Text style={{ color: rarityColor(s.set_rarity), fontSize: 11, fontWeight: "600" }}>
                        {s.set_rarity}
                      </Text>
                      {parseFloat(s.set_price) > 0 && (
                        <Text className="text-accent text-xs font-mono">${parseFloat(s.set_price).toFixed(2)}</Text>
                      )}
                    </View>
                  </View>
                ))
              )}
            </View>
          )}

          {/* Prices */}
          {price && (
            <View>
              <Text className="text-muted text-xs uppercase font-semibold mb-2">Market Prices</Text>
              {[
                { label: "TCGPlayer", val: price.tcgplayer_price },
                { label: "Cardmarket", val: price.cardmarket_price },
              ].map(({ label, val }) => {
                const n = parseFloat(val);
                if (!n) return null;
                return (
                  <View key={label} className="flex-row justify-between py-1.5 border-b border-border">
                    <Text className="text-muted text-sm">{label}</Text>
                    <Text className="text-accent font-mono font-semibold text-sm">${n.toFixed(2)}</Text>
                  </View>
                );
              })}
            </View>
          )}
        </ScrollView>

        {/* Add to deck */}
        {onAddToDeck && (
          <View className="px-4 py-3 border-t border-border">
            <TouchableOpacity
              className="bg-accent rounded-xl py-3 items-center"
              onPress={() => { onAddToDeck(card, imageIndex); onClose(); }}
            >
              <Text className="text-bg font-bold text-base">
                + Add to Deck
                {card.card_images.length > 1 ? ` (Art ${imageIndex + 1}/${card.card_images.length})` : ""}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </Modal>
  );
}
