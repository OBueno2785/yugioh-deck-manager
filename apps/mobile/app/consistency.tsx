import { useState, useMemo } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, FlatList, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useDeckStore } from "@/store/deckStore";
import { CardImage } from "@/components/CardImage";
import {
  generateConsistencyReport, validateDeck,
  probabilityAtLeast, groupProbability, formatPercent,
} from "@yugioh/core";
import type { CardRole, LabeledDeckCard, GameFormat } from "@yugioh/core";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ROLE_LABELS: Record<CardRole, string> = {
  starter: "Starter",
  extender: "Extender",
  handtrap: "Handtrap",
  boardbreak: "Board Break",
  garnets: "Garnets",
  engine: "Engine",
  tech: "Tech",
};

const ROLE_COLORS: Record<CardRole, string> = {
  starter: "#50c878",
  extender: "#88aaff",
  handtrap: "#ff8844",
  boardbreak: "#cc44ff",
  garnets: "#e05050",
  engine: "#44ccff",
  tech: "#aaaaaa",
};

function scoreColor(score: number) {
  if (score >= 75) return "#50c878";
  if (score >= 50) return "#c89b3c";
  return "#e05050";
}

function pct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

// ─── Score Gauge ─────────────────────────────────────────────────────────────

function ScoreGauge({ score }: { score: number }) {
  const color = scoreColor(score);
  return (
    <View className="items-center py-4">
      <View style={{
        width: 96, height: 96, borderRadius: 48,
        borderWidth: 6, borderColor: color,
        alignItems: "center", justifyContent: "center",
        backgroundColor: "#1a1a24",
      }}>
        <Text style={{ color, fontSize: 28, fontWeight: "bold", fontFamily: "monospace" }}>{score}</Text>
      </View>
      <Text className="text-muted text-xs mt-2 uppercase tracking-wider">Consistency Score</Text>
    </View>
  );
}

// ─── Stat Chip ────────────────────────────────────────────────────────────────

function StatChip({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <View className="bg-bg rounded-xl p-3 flex-1 items-center">
      <Text style={{ color: color ?? "#c89b3c", fontSize: 18, fontWeight: "bold", fontFamily: "monospace" }}>
        {value}
      </Text>
      <Text className="text-muted text-xs mt-0.5" numberOfLines={1}>{label}</Text>
    </View>
  );
}

// ─── Role Badge ───────────────────────────────────────────────────────────────

function RoleBadge({ role }: { role: CardRole | undefined }) {
  if (!role) return null;
  return (
    <View style={{
      backgroundColor: ROLE_COLORS[role] + "33",
      borderRadius: 99, paddingHorizontal: 6, paddingVertical: 2,
    }}>
      <Text style={{ color: ROLE_COLORS[role], fontSize: 10, fontWeight: "600" }}>
        {ROLE_LABELS[role]}
      </Text>
    </View>
  );
}

// ─── Card Row ─────────────────────────────────────────────────────────────────

function CardRow({
  dc, deckSize, goingFirst, onSetRole,
}: {
  dc: LabeledDeckCard;
  deckSize: number;
  goingFirst: boolean;
  onSetRole: (dc: LabeledDeckCard) => void;
}) {
  const hand = goingFirst ? 5 : 6;
  const prob = probabilityAtLeast(deckSize, dc.quantity, hand, 1);

  return (
    <TouchableOpacity
      className="flex-row items-center py-2 border-b border-border gap-3 px-3"
      onPress={() => onSetRole(dc)}
    >
      <CardImage card={dc.card} size="small"
        imageIndex={dc.selectedImageIndex ?? 0}
        style={{ width: 28, aspectRatio: 421 / 614, borderRadius: 4 }} />

      <View className="flex-1 min-w-0">
        <Text className="text-text text-xs" numberOfLines={1}>{dc.card.name}</Text>
        <View className="flex-row items-center gap-1 mt-0.5">
          <Text className="text-muted" style={{ fontSize: 10 }}>×{dc.quantity}</Text>
          <RoleBadge role={dc.role} />
        </View>
      </View>

      <View className="items-end">
        <Text style={{
          fontFamily: "monospace", fontSize: 13, fontWeight: "700",
          color: prob >= 0.7 ? "#50c878" : prob >= 0.4 ? "#c89b3c" : "#e05050",
        }}>
          {pct(prob)}
        </Text>
        <Text className="text-muted" style={{ fontSize: 9 }}>in opening hand</Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

type ActiveTab = "overview" | "cards";

export default function ConsistencyScreen() {
  const [goingFirst, setGoingFirst] = useState(true);
  const [activeTab, setActiveTab] = useState<ActiveTab>("overview");

  const { name, main, extra, side, format, setCardRole } = useDeckStore();

  const deck = useMemo(() => ({
    id: "mobile", name, format, main, extra, side,
    createdAt: new Date(), updatedAt: new Date(),
  }), [name, format, main, extra, side]);

  const deckSize = main.reduce((s, c) => s + c.quantity, 0);
  const isEmpty = deckSize === 0;

  const report = useMemo(() => isEmpty ? null : generateConsistencyReport(deck), [deck, isEmpty]);
  const validation = useMemo(() => isEmpty ? null : validateDeck(deck), [deck, isEmpty]);

  // Sorted main deck cards
  const sortedMain = useMemo(() => {
    const hand = goingFirst ? 5 : 6;
    return [...main].sort((a, b) => {
      const pa = probabilityAtLeast(deckSize, a.quantity, hand, 1);
      const pb = probabilityAtLeast(deckSize, b.quantity, hand, 1);
      return pb - pa;
    });
  }, [main, deckSize, goingFirst]);

  function handleSetRole(dc: LabeledDeckCard) {
    const roles: Array<CardRole | undefined> = [
      undefined, "starter", "extender", "handtrap", "boardbreak", "garnets", "engine", "tech",
    ];
    const options = [
      "Clear role",
      "Starter",
      "Extender",
      "Handtrap",
      "Board Break",
      "Garnets (brick)",
      "Engine",
      "Tech",
      "Cancel",
    ];
    Alert.alert(dc.card.name, "Set role for consistency analysis", options.map((title, i) => ({
      text: title,
      style: title === "Cancel" ? "cancel" : undefined,
      onPress: () => {
        if (title !== "Cancel") {
          setCardRole(dc.card.id, dc.zone, roles[i]);
        }
      },
    })));
  }

  if (isEmpty) {
    return (
      <SafeAreaView className="flex-1 bg-bg items-center justify-center" edges={["left", "right", "bottom"]}>
        <Text style={{ fontSize: 40 }}>📊</Text>
        <Text className="text-text font-semibold text-base mt-3">No cards in deck</Text>
        <Text className="text-muted text-sm mt-1 text-center px-8">
          Add cards in the Deck Builder tab to see consistency analysis.
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["left", "right", "bottom"]}>
      {/* Tabs */}
      <View className="flex-row bg-surface border-b border-border">
        {(["overview", "cards"] as ActiveTab[]).map((tab) => (
          <TouchableOpacity
            key={tab}
            className="flex-1 py-2.5 items-center"
            style={{ borderBottomWidth: 2, borderBottomColor: activeTab === tab ? "#c89b3c" : "transparent" }}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={{
              color: activeTab === tab ? "#c89b3c" : "#7070a0",
              fontSize: 12, fontWeight: activeTab === tab ? "700" : "400",
              textTransform: "capitalize",
            }}>
              {tab === "overview" ? "Overview" : "By Card"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {activeTab === "overview" ? (
        <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, gap: 12 }}>
          {/* Score */}
          {report && <ScoreGauge score={report.overallScore} />}

          {/* Going 1st / 2nd toggle */}
          <View className="flex-row bg-surface rounded-xl p-1 gap-1">
            {[true, false].map((val) => (
              <TouchableOpacity
                key={String(val)}
                className="flex-1 py-2 rounded-lg items-center"
                style={{ backgroundColor: goingFirst === val ? "#c89b3c" : "transparent" }}
                onPress={() => setGoingFirst(val)}
              >
                <Text style={{
                  color: goingFirst === val ? "#000" : "#7070a0",
                  fontSize: 12, fontWeight: goingFirst === val ? "700" : "400",
                }}>
                  Going {val ? "1st (5 cards)" : "2nd (6 cards)"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Stats row */}
          {report && (
            <>
              <View className="flex-row gap-2">
                <StatChip label="Deck Size" value={report.deckSize} />
                <StatChip
                  label="Combo Rate"
                  value={report.starterCount > 0 ? pct(groupProbability(report.deckSize, report.starterCount, goingFirst ? 5 : 6)) : "—"}
                  color={report.comboRate >= 0.7 ? "#50c878" : "#c89b3c"}
                />
              </View>
              <View className="flex-row gap-2">
                <StatChip label="Monsters" value={report.monsterCount} color="#88aaff" />
                <StatChip label="Spells" value={report.spellCount} color="#50c878" />
                <StatChip label="Traps" value={report.trapCount} color="#ff8844" />
              </View>
              <View className="flex-row gap-2">
                <StatChip label="Starters" value={report.starterCount} color={ROLE_COLORS.starter} />
                <StatChip label="Extenders" value={report.extenderCount} color={ROLE_COLORS.extender} />
                <StatChip label="Handtraps" value={report.handtrapCount} color={ROLE_COLORS.handtrap} />
                <StatChip label="Garnets" value={report.brickCount} color={ROLE_COLORS.garnets} />
              </View>
            </>
          )}

          {/* Validation */}
          {validation && (
            <View className="bg-surface rounded-xl p-4 gap-2">
              <View className="flex-row items-center gap-2">
                <View style={{
                  width: 8, height: 8, borderRadius: 4,
                  backgroundColor: validation.valid ? "#50c878" : "#e05050",
                }} />
                <Text className="text-text text-xs font-semibold">
                  {validation.valid ? "Deck is legal" : "Deck has issues"}
                </Text>
              </View>
              {validation.errors.map((e, i) => (
                <View key={i} className="flex-row gap-2">
                  <Text style={{ color: "#e05050", fontSize: 11 }}>✕</Text>
                  <Text style={{ color: "#e05050", fontSize: 11, flex: 1 }}>{e}</Text>
                </View>
              ))}
              {validation.warnings.map((w, i) => (
                <View key={i} className="flex-row gap-2">
                  <Text style={{ color: "#c89b3c", fontSize: 11 }}>⚠</Text>
                  <Text style={{ color: "#c89b3c", fontSize: 11, flex: 1 }}>{w}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Role legend */}
          <View className="bg-surface rounded-xl p-4">
            <Text className="text-muted text-xs font-semibold uppercase mb-2">Roles (tap a card to assign)</Text>
            <View className="flex-row flex-wrap gap-2">
              {(Object.entries(ROLE_LABELS) as [CardRole, string][]).map(([role, label]) => (
                <View key={role} style={{
                  flexDirection: "row", alignItems: "center", gap: 4,
                  backgroundColor: ROLE_COLORS[role] + "22", borderRadius: 99,
                  paddingHorizontal: 8, paddingVertical: 3,
                }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: ROLE_COLORS[role] }} />
                  <Text style={{ color: ROLE_COLORS[role], fontSize: 11 }}>{label}</Text>
                </View>
              ))}
            </View>
          </View>
        </ScrollView>
      ) : (
        <View className="flex-1">
          {/* Header */}
          <View className="flex-row items-center justify-between px-3 py-2 bg-surface border-b border-border">
            <Text className="text-muted text-xs">Tap a card to assign its role</Text>
            <View className="flex-row bg-bg rounded-lg p-0.5 gap-0.5">
              {[true, false].map((val) => (
                <TouchableOpacity
                  key={String(val)}
                  className="px-2 py-1 rounded"
                  style={{ backgroundColor: goingFirst === val ? "#c89b3c" : "transparent" }}
                  onPress={() => setGoingFirst(val)}
                >
                  <Text style={{
                    color: goingFirst === val ? "#000" : "#7070a0", fontSize: 11,
                    fontWeight: goingFirst === val ? "700" : "400",
                  }}>
                    {val ? "1st" : "2nd"}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Column headers */}
          <View className="flex-row items-center px-3 py-1.5 border-b border-border bg-surface">
            <Text className="text-muted flex-1" style={{ fontSize: 10, textTransform: "uppercase" }}>Card</Text>
            <Text className="text-muted" style={{ fontSize: 10, textTransform: "uppercase" }}>Prob.</Text>
          </View>

          <FlatList
            data={sortedMain}
            keyExtractor={(item) => String(item.card.id)}
            renderItem={({ item }) => (
              <CardRow
                dc={item}
                deckSize={deckSize}
                goingFirst={goingFirst}
                onSetRole={handleSetRole}
              />
            )}
          />
        </View>
      )}
    </SafeAreaView>
  );
}
