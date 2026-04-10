import { useState, useDeferredValue, useMemo } from "react";
import {
  View, Text, TextInput, FlatList, TouchableOpacity,
  ScrollView, Pressable, Alert, Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useCardSearch } from "@/hooks/useCardSearch";
import { useDeckStore } from "@/store/deckStore";
import type { SavedDeck } from "@/store/deckStore";
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

// ─── Zone strip ────────────────────────────────────────────────────────────────

function ZoneStrip({
  label, cards, max, zone, onRemove, onArtChange,
}: {
  label: string; cards: LabeledDeckCard[]; max: number; zone: ActiveZone;
  onRemove: (id: number) => void; onArtChange: (id: number, idx: number) => void;
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
          <Text className="text-muted text-xs">Vacío</Text>
        </View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          {cards.map((dc) => (
            <DeckCardChip key={dc.card.id} dc={dc}
              onRemove={() => onRemove(dc.card.id)}
              onArtChange={(idx) => onArtChange(dc.card.id, idx)} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function DeckCardChip({ dc, onRemove, onArtChange }: {
  dc: LabeledDeckCard; onRemove: () => void; onArtChange: (idx: number) => void;
}) {
  const { card, quantity, selectedImageIndex = 0 } = dc;
  const hasAlts = card.card_images.length > 1;
  return (
    <View style={{ width: 56, position: "relative" }}>
      <TouchableOpacity
        style={{ aspectRatio: 421 / 614, borderRadius: 6, overflow: "hidden" }}
        onLongPress={() => {
          const options = hasAlts
            ? ["Quitar copia", ...card.card_images.map((_, i) => `Arte ${i + 1}`), "Cancelar"]
            : ["Quitar copia", "Cancelar"];
          Alert.alert(card.name, undefined, options.map((title, i) => ({
            text: title,
            style: title === "Cancelar" ? "cancel" : title === "Quitar copia" ? "destructive" : "default",
            onPress: () => {
              if (title === "Quitar copia") onRemove();
              else if (title.startsWith("Arte ")) onArtChange(i - 1);
            },
          })));
        }}
        onPress={onRemove}
      >
        <CardImage card={card} imageIndex={selectedImageIndex} size="small" style={{ width: "100%", height: "100%" }} />
      </TouchableOpacity>
      {quantity > 1 && (
        <View style={{ position: "absolute", top: 2, right: 2, backgroundColor: "#c89b3c", borderRadius: 99, width: 16, height: 16, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ fontSize: 9, fontWeight: "bold", color: "#000" }}>{quantity}</Text>
        </View>
      )}
      {hasAlts && (
        <View style={{ position: "absolute", top: 2, left: 2, backgroundColor: "rgba(0,0,0,0.7)", borderRadius: 99, width: 14, height: 14, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ fontSize: 8, color: "#c89b3c", fontWeight: "bold" }}>{card.card_images.length}</Text>
        </View>
      )}
    </View>
  );
}

// ─── Price panel ───────────────────────────────────────────────────────────────

function PricePanel({ main, extra, side }: { main: LabeledDeckCard[]; extra: LabeledDeckCard[]; side: LabeledDeckCard[] }) {
  const rows = useMemo(() => [...main, ...extra, ...side].map((dc) => ({
    name: dc.card.name, qty: dc.quantity, zone: dc.zone,
    unit: getTcgPrice(dc.card), total: getTcgPrice(dc.card) * dc.quantity,
  })), [main, extra, side]);
  const grand = rows.reduce((s, r) => s + r.total, 0);
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 32 }}>
      <View className="items-center">
        <Text className="text-muted text-xs uppercase tracking-wider">Valor total (TCGPlayer)</Text>
        <Text className="text-accent text-3xl font-bold font-mono mt-1">{fmt(grand)}</Text>
      </View>
      {[{ label: "Main", cards: main }, { label: "Extra", cards: extra }, { label: "Side", cards: side }]
        .filter(z => z.cards.length > 0).map(({ label, cards }) => (
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
          <Text className="font-mono text-xs font-semibold"
            style={{ color: r.unit >= 20 ? "#e05050" : r.unit >= 5 ? "#c89b3c" : "#7070a0" }}>
            {fmt(r.total)}
          </Text>
        </View>
      ))}
    </ScrollView>
  );
}

// ─── Saved Decks Modal ─────────────────────────────────────────────────────────

function SavedDecksModal({
  visible, onClose, savedDecks, onSave, onLoad, onDelete,
}: {
  visible: boolean; onClose: () => void;
  savedDecks: SavedDeck[];
  onSave: () => void;
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  function formatDate(iso: string) {
    const d = new Date(iso);
    return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  function confirmLoad(deck: SavedDeck) {
    Alert.alert(
      "Cargar mazo",
      `¿Cargar "${deck.name}"? Se reemplazará el mazo actual.`,
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Cargar", onPress: () => { onLoad(deck.id); onClose(); } },
      ]
    );
  }

  function confirmDelete(deck: SavedDeck) {
    Alert.alert(
      "Eliminar mazo",
      `¿Eliminar "${deck.name}" de la biblioteca?`,
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Eliminar", style: "destructive", onPress: () => onDelete(deck.id) },
      ]
    );
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)" }} onPress={onClose} />
      <View style={{
        backgroundColor: "#1a1a24", borderTopLeftRadius: 20, borderTopRightRadius: 20,
        maxHeight: "80%",
      }}>
        {/* Handle */}
        <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: "#3a3a4a", alignSelf: "center", marginTop: 12 }} />

        <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingVertical: 12 }}>
          <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700", flex: 1 }}>Mis Mazos</Text>
          <TouchableOpacity
            onPress={onSave}
            style={{ backgroundColor: "#c89b3c", borderRadius: 99, paddingHorizontal: 14, paddingVertical: 6 }}
          >
            <Text style={{ color: "#000", fontWeight: "700", fontSize: 13 }}>Guardar actual</Text>
          </TouchableOpacity>
        </View>

        {savedDecks.length === 0 ? (
          <View style={{ alignItems: "center", padding: 32 }}>
            <Text style={{ color: "#7070a0", fontSize: 14 }}>No hay mazos guardados</Text>
            <Text style={{ color: "#5a5a7a", fontSize: 12, marginTop: 4 }}>
              Presioná "Guardar actual" para guardar el mazo abierto
            </Text>
          </View>
        ) : (
          <FlatList
            data={savedDecks}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ paddingBottom: 32 }}
            renderItem={({ item }) => {
              const total = [...item.main, ...item.extra, ...item.side].reduce((s, c) => s + c.quantity, 0);
              return (
                <TouchableOpacity
                  onPress={() => confirmLoad(item)}
                  style={{
                    flexDirection: "row", alignItems: "center",
                    paddingHorizontal: 20, paddingVertical: 12,
                    borderBottomWidth: 1, borderBottomColor: "#2a2a3a",
                  }}
                >
                  {/* Card thumbnails */}
                  <View style={{ width: 40, height: 56, borderRadius: 4, overflow: "hidden", backgroundColor: "#2a2a3a", marginRight: 12 }}>
                    {item.main[0] && (
                      <CardImage card={item.main[0].card} size="small"
                        imageIndex={item.main[0].selectedImageIndex ?? 0}
                        style={{ width: "100%", height: "100%" }} />
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: "#fff", fontSize: 14, fontWeight: "600" }} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={{ color: "#7070a0", fontSize: 11, marginTop: 2 }}>
                      {total} cartas · {item.format.toUpperCase()} · {formatDate(item.savedAt)}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => confirmDelete(item)}
                    hitSlop={12}
                    style={{ padding: 8 }}
                  >
                    <Text style={{ color: "#e05050", fontSize: 16 }}>✕</Text>
                  </TouchableOpacity>
                </TouchableOpacity>
              );
            }}
          />
        )}
      </View>
    </Modal>
  );
}

// ─── Main screen ───────────────────────────────────────────────────────────────

export default function DeckBuilderScreen() {
  const [nameInput, setNameInput] = useState("");
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [rightTab, setRightTab] = useState<RightTab>("deck");
  const [showDecks, setShowDecks] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const deferredName = useDeferredValue(nameInput);

  const {
    name, main, extra, side,
    addCard, removeCard, setCardImageIndex, clearDeck,
    setName, savedDecks, saveDeck, loadDeck, deleteSavedDeck,
  } = useDeckStore();

  const { cards } = useCardSearch({ name: deferredName || undefined });
  const searchResults = cards.slice(0, 30);

  const deckTotal = [...main, ...extra, ...side].reduce((s, c) => s + c.quantity, 0);
  const deckValue = [...main, ...extra, ...side].reduce((s, dc) => s + getTcgPrice(dc.card) * dc.quantity, 0);

  function handleExport() {
    const ydk = exportToYdk({ id: "x", name, format: "tcg", main, extra, side, createdAt: new Date(), updatedAt: new Date() });
    Alert.alert("YDK Export", `${ydk.slice(0, 120)}…\n\n(Copiá desde la consola)`, [{ text: "OK" }]);
    console.log(ydk);
  }

  function handleSave() {
    saveDeck();
    Alert.alert("Guardado", `"${name}" guardado en tu biblioteca.`, [{ text: "OK" }]);
  }

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["left", "right"]}>
      <View className="flex-1 flex-row">

        {/* Left: Search */}
        <View className="w-44 bg-surface border-r border-border flex-col">
          <View className="p-2 border-b border-border">
            <TextInput
              className="bg-bg border border-border rounded-lg px-3 py-1.5 text-text text-xs"
              placeholder="Buscar carta..."
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
            {editingName ? (
              <TextInput
                className="text-text text-sm font-semibold flex-1 border-b border-accent"
                value={name}
                onChangeText={setName}
                onBlur={() => setEditingName(false)}
                autoFocus
                selectTextOnFocus
              />
            ) : (
              <TouchableOpacity className="flex-1" onPress={() => setEditingName(true)}>
                <Text className="text-text text-sm font-semibold" numberOfLines={1}>{name}</Text>
              </TouchableOpacity>
            )}
            <Text className="text-muted text-xs font-mono">{deckTotal}c</Text>
            {deckValue > 0 && <Text className="text-accent text-xs font-mono">{fmt(deckValue)}</Text>}
            <TouchableOpacity onPress={() => setShowDecks(true)} hitSlop={8}>
              <Text className="text-accent text-xs font-semibold">📁</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleSave} hitSlop={8}>
              <Text className="text-accent text-xs font-semibold">💾</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleExport} hitSlop={8}>
              <Text className="text-accent text-xs font-semibold">YDK</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => Alert.alert("Limpiar mazo", "¿Quitar todas las cartas?", [
              { text: "Cancelar", style: "cancel" },
              { text: "Limpiar", style: "destructive", onPress: clearDeck },
            ])} hitSlop={8}>
              <Text className="text-muted text-xs">✕</Text>
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
                  {tab === "deck" ? "Mazo" : "Precios"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {rightTab === "deck" ? (
            <ScrollView className="flex-1 px-3 pt-3" contentContainerStyle={{ paddingBottom: 32 }}>
              <ZoneStrip label="Mazo Principal" cards={main} max={60} zone="main"
                onRemove={(id) => removeCard(id, "main")}
                onArtChange={(id, idx) => setCardImageIndex(id, "main", idx)} />
              <ZoneStrip label="Mazo Extra" cards={extra} max={15} zone="extra"
                onRemove={(id) => removeCard(id, "extra")}
                onArtChange={(id, idx) => setCardImageIndex(id, "extra", idx)} />
              <ZoneStrip label="Mazo Side" cards={side} max={15} zone="side"
                onRemove={(id) => removeCard(id, "side")}
                onArtChange={(id, idx) => setCardImageIndex(id, "side", idx)} />
            </ScrollView>
          ) : (
            <PricePanel main={main} extra={extra} side={side} />
          )}
        </View>
      </View>

      {/* Modals */}
      <SavedDecksModal
        visible={showDecks}
        onClose={() => setShowDecks(false)}
        savedDecks={savedDecks}
        onSave={() => { handleSave(); }}
        onLoad={loadDeck}
        onDelete={deleteSavedDeck}
      />

      <CardDetailModal
        card={selectedCard}
        onClose={() => setSelectedCard(null)}
        onAddToDeck={(card, imageIndex) => { addCard(card, undefined, imageIndex); setSelectedCard(null); }}
      />
    </SafeAreaView>
  );
}
