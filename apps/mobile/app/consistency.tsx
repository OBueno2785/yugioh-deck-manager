import { useState, useMemo, useCallback } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, FlatList, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useDeckStore } from "@/store/deckStore";
import { CardImage } from "@/components/CardImage";
import {
  generateConsistencyReport, validateDeck,
  probabilityAtLeast, groupProbability,
  runSimulation, expandDeck,
} from "@yugioh/core";
import type { CardRole, LabeledDeckCard, Card } from "@yugioh/core";

// ─── Constants ────────────────────────────────────────────────────────────────

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

// ─── Score Gauge ──────────────────────────────────────────────────────────────

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

// ─── Card Row (By Card tab) ───────────────────────────────────────────────────

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
        <Text className="text-muted" style={{ fontSize: 9 }}>opening hand</Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── Hand Card (Simulator tab) ────────────────────────────────────────────────

function HandCard({ card, dc }: { card: Card; dc: LabeledDeckCard | undefined }) {
  return (
    <View style={{ alignItems: "center", gap: 4 }}>
      <View style={{ width: 64, aspectRatio: 421 / 614, borderRadius: 6, overflow: "hidden" }}>
        <CardImage
          card={card}
          size="small"
          imageIndex={dc?.selectedImageIndex ?? 0}
          style={{ width: "100%", height: "100%" }}
        />
      </View>
      {dc?.role && (
        <View style={{
          backgroundColor: ROLE_COLORS[dc.role] + "33",
          borderRadius: 99, paddingHorizontal: 5, paddingVertical: 1,
        }}>
          <Text style={{ color: ROLE_COLORS[dc.role], fontSize: 9, fontWeight: "600" }}>
            {ROLE_LABELS[dc.role]}
          </Text>
        </View>
      )}
    </View>
  );
}

// ─── Simulator Panel ─────────────────────────────────────────────────────────

function SimulatorPanel({ main, goingFirst }: { main: LabeledDeckCard[]; goingFirst: boolean }) {
  const [hand, setHand] = useState<Card[]>([]);
  const [mcResult, setMcResult] = useState<{ prob: string; ms: number } | null>(null);
  const [running, setRunning] = useState(false);

  const expanded = useMemo(() => expandDeck(main), [main]);
  const handSize = goingFirst ? 5 : 6;

  // Map card id → LabeledDeckCard for role lookup
  const dcMap = useMemo(() => {
    const m = new Map<number, LabeledDeckCard>();
    for (const dc of main) m.set(dc.card.id, dc);
    return m;
  }, [main]);

  function drawNewHand() {
    const copy = [...expanded];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j]!, copy[i]!];
    }
    setHand(copy.slice(0, handSize));
    setMcResult(null);
  }

  function runMonteCarlo() {
    const starters = main.filter((dc) => dc.role === "starter");
    if (starters.length === 0) {
      Alert.alert("No starters tagged", "Go to the 'By Card' tab and tap cards to assign them the Starter role.");
      return;
    }
    setRunning(true);
    setTimeout(() => {
      const result = runSimulation({
        deck: expanded,
        handSize,
        iterations: 10000,
        conditions: [{
          id: "starter",
          label: "Open at least 1 starter",
          type: "has_any",
          cardIds: starters.map((dc) => dc.card.id),
          minCount: 1,
        }],
      });
      const prob = result.conditionResults[0]?.probability ?? 0;
      setMcResult({ prob: `${(prob * 100).toFixed(2)}%`, ms: result.durationMs });
      setRunning(false);
    }, 10);
  }

  // Role summary of drawn hand
  const roleSummary = useMemo(() => {
    const counts: Partial<Record<CardRole, number>> = {};
    for (const c of hand) {
      const dc = dcMap.get(c.id);
      if (dc?.role) counts[dc.role] = (counts[dc.role] ?? 0) + 1;
    }
    return counts;
  }, [hand, dcMap]);

  return (
    <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, gap: 16 }}>
      {/* Draw hand */}
      <TouchableOpacity
        className="bg-accent rounded-xl py-3 items-center"
        onPress={drawNewHand}
      >
        <Text className="text-bg font-bold text-base">
          Draw Hand ({handSize} cards)
        </Text>
      </TouchableOpacity>

      {hand.length > 0 && (
        <>
          {/* Cards */}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
            {hand.map((card, i) => (
              <HandCard key={i} card={card} dc={dcMap.get(card.id)} />
            ))}
          </View>

          {/* Role breakdown */}
          {Object.keys(roleSummary).length > 0 && (
            <View className="bg-surface rounded-xl p-3 gap-2">
              <Text className="text-muted text-xs font-semibold uppercase">Hand Breakdown</Text>
              {(Object.entries(roleSummary) as [CardRole, number][]).map(([role, count]) => (
                <View key={role} className="flex-row justify-between items-center">
                  <View className="flex-row items-center gap-2">
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: ROLE_COLORS[role] }} />
                    <Text className="text-text text-xs">{ROLE_LABELS[role]}</Text>
                  </View>
                  <Text style={{ color: ROLE_COLORS[role], fontFamily: "monospace", fontSize: 13, fontWeight: "700" }}>
                    ×{count}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </>
      )}

      {/* Monte Carlo */}
      <View className="bg-surface rounded-xl p-4 gap-3">
        <Text className="text-text text-sm font-semibold">Monte Carlo (10,000 hands)</Text>
        <Text className="text-muted text-xs">
          Runs 10,000 simulated hands and calculates the real probability of opening at least one card tagged as Starter.
        </Text>
        <TouchableOpacity
          style={{
            backgroundColor: running ? "#2a2a3a" : "#2a2a3a",
            borderWidth: 1, borderColor: "#c89b3c",
            borderRadius: 10, paddingVertical: 10, alignItems: "center",
          }}
          onPress={runMonteCarlo}
          disabled={running}
        >
          <Text style={{ color: "#c89b3c", fontWeight: "600", fontSize: 13 }}>
            {running ? "Running…" : "Run Simulation"}
          </Text>
        </TouchableOpacity>

        {mcResult && (
          <View className="items-center gap-1">
            <Text style={{ color: "#50c878", fontSize: 32, fontWeight: "bold", fontFamily: "monospace" }}>
              {mcResult.prob}
            </Text>
            <Text className="text-muted text-xs">
              probability of opening a starter ({mcResult.ms}ms)
            </Text>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

type ActiveTab = "overview" | "cards" | "simulator";

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
      "Clear role", "Starter", "Extender", "Handtrap",
      "Board Break", "Garnets (brick)", "Engine", "Tech", "Cancel",
    ];
    Alert.alert(dc.card.name, "Set role for consistency analysis", options.map((title, i) => ({
      text: title,
      style: title === "Cancel" ? "cancel" : undefined,
      onPress: () => { if (title !== "Cancel") setCardRole(dc.card.id, dc.zone, roles[i]); },
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

  const TABS: { id: ActiveTab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "cards", label: "By Card" },
    { id: "simulator", label: "Simulator" },
  ];

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["left", "right", "bottom"]}>
      {/* Tabs */}
      <View className="flex-row bg-surface border-b border-border">
        {TABS.map((tab) => (
          <TouchableOpacity
            key={tab.id}
            className="flex-1 py-2.5 items-center"
            style={{ borderBottomWidth: 2, borderBottomColor: activeTab === tab.id ? "#c89b3c" : "transparent" }}
            onPress={() => setActiveTab(tab.id)}
          >
            <Text style={{
              color: activeTab === tab.id ? "#c89b3c" : "#7070a0",
              fontSize: 12, fontWeight: activeTab === tab.id ? "700" : "400",
            }}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Going 1st / 2nd toggle (visible in overview + cards) */}
      {activeTab !== "simulator" && (
        <View className="flex-row bg-surface border-b border-border px-3 py-1.5 gap-2">
          {[true, false].map((val) => (
            <TouchableOpacity
              key={String(val)}
              className="flex-1 py-1.5 rounded-lg items-center"
              style={{ backgroundColor: goingFirst === val ? "#c89b3c" : "#2a2a3a" }}
              onPress={() => setGoingFirst(val)}
            >
              <Text style={{
                color: goingFirst === val ? "#000" : "#7070a0",
                fontSize: 11, fontWeight: goingFirst === val ? "700" : "400",
              }}>
                Going {val ? "1st (5)" : "2nd (6)"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Going 1st / 2nd toggle for simulator */}
      {activeTab === "simulator" && (
        <View className="flex-row bg-surface border-b border-border px-3 py-1.5 gap-2">
          {[true, false].map((val) => (
            <TouchableOpacity
              key={String(val)}
              className="flex-1 py-1.5 rounded-lg items-center"
              style={{ backgroundColor: goingFirst === val ? "#c89b3c" : "#2a2a3a" }}
              onPress={() => setGoingFirst(val)}
            >
              <Text style={{
                color: goingFirst === val ? "#000" : "#7070a0",
                fontSize: 11, fontWeight: goingFirst === val ? "700" : "400",
              }}>
                Going {val ? "1st (5)" : "2nd (6)"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {activeTab === "overview" && (
        <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, gap: 12 }}>
          {report && <ScoreGauge score={report.overallScore} />}

          {report && (
            <>
              <View className="flex-row gap-2">
                <StatChip label="Deck Size" value={report.deckSize} />
                <StatChip
                  label="Combo Rate"
                  value={report.starterCount > 0
                    ? pct(groupProbability(report.deckSize, report.starterCount, goingFirst ? 5 : 6))
                    : "—"}
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

          <View className="bg-surface rounded-xl p-4">
            <Text className="text-muted text-xs font-semibold uppercase mb-2">Roles (tap a card in By Card)</Text>
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
      )}

      {activeTab === "cards" && (
        <View className="flex-1">
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

      {activeTab === "simulator" && (
        <SimulatorPanel main={main} goingFirst={goingFirst} />
      )}
    </SafeAreaView>
  );
}
