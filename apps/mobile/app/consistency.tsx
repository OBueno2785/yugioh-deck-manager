import { useState, useMemo } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, FlatList,
  Modal, Pressable, Alert,
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

const ROLES: { role: CardRole; label: string; desc: string; color: string }[] = [
  { role: "starter",    label: "Starter",     desc: "Inicia el combo principal",         color: "#50c878" },
  { role: "extender",   label: "Extender",    desc: "Extiende el combo desde la mano",   color: "#88aaff" },
  { role: "handtrap",   label: "Handtrap",    desc: "Disruption desde la mano",          color: "#ff8844" },
  { role: "boardbreak", label: "Board Break", desc: "Rompe tableros establecidos",       color: "#cc44ff" },
  { role: "garnets",    label: "Garnets",     desc: "Cartas situacionales / ladrillos",  color: "#e05050" },
  { role: "engine",     label: "Engine",      desc: "Pieza de motor genérico",           color: "#44ccff" },
  { role: "tech",       label: "Tech",        desc: "Respuesta específica / tech card",  color: "#aaaaaa" },
];

const ROLE_COLOR: Record<CardRole, string> = Object.fromEntries(
  ROLES.map((r) => [r.role, r.color])
) as Record<CardRole, string>;

const ROLE_LABEL: Record<CardRole, string> = Object.fromEntries(
  ROLES.map((r) => [r.role, r.label])
) as Record<CardRole, string>;

function scoreColor(score: number) {
  if (score >= 75) return "#50c878";
  if (score >= 50) return "#c89b3c";
  return "#e05050";
}

function pct(n: number) { return `${(n * 100).toFixed(1)}%`; }

// ─── Role Picker Modal ────────────────────────────────────────────────────────

function RolePickerModal({
  dc, onClose, onSelect,
}: {
  dc: LabeledDeckCard | null;
  onClose: () => void;
  onSelect: (role: CardRole | undefined) => void;
}) {
  if (!dc) return null;
  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)" }} onPress={onClose} />
      <View style={{
        backgroundColor: "#1a1a24",
        borderTopLeftRadius: 20, borderTopRightRadius: 20,
        paddingBottom: 32, paddingTop: 16,
      }}>
        {/* Handle */}
        <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: "#3a3a4a", alignSelf: "center", marginBottom: 12 }} />

        <Text style={{ color: "#fff", fontSize: 14, fontWeight: "700", paddingHorizontal: 20, marginBottom: 4 }}
          numberOfLines={1}>
          {dc.card.name}
        </Text>
        <Text style={{ color: "#7070a0", fontSize: 11, paddingHorizontal: 20, marginBottom: 16 }}>
          Asignar rol para análisis de consistencia
        </Text>

        {/* Clear */}
        <TouchableOpacity
          onPress={() => { onSelect(undefined); onClose(); }}
          style={{
            flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingVertical: 12,
            borderBottomWidth: 1, borderBottomColor: "#2a2a3a",
          }}
        >
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: "#3a3a4a", marginRight: 12 }} />
          <Text style={{ color: "#7070a0", fontSize: 14 }}>Sin rol</Text>
          {!dc.role && (
            <Text style={{ color: "#c89b3c", fontSize: 12, marginLeft: "auto" }}>✓ actual</Text>
          )}
        </TouchableOpacity>

        {ROLES.map(({ role, label, desc, color }) => (
          <TouchableOpacity
            key={role}
            onPress={() => { onSelect(role); onClose(); }}
            style={{
              flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingVertical: 12,
              borderBottomWidth: 1, borderBottomColor: "#2a2a3a",
              backgroundColor: dc.role === role ? color + "15" : "transparent",
            }}
          >
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color, marginRight: 12 }} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: "#fff", fontSize: 14, fontWeight: dc.role === role ? "700" : "400" }}>{label}</Text>
              <Text style={{ color: "#7070a0", fontSize: 11 }}>{desc}</Text>
            </View>
            {dc.role === role && (
              <Text style={{ color: color, fontSize: 14, fontWeight: "700" }}>✓</Text>
            )}
          </TouchableOpacity>
        ))}
      </View>
    </Modal>
  );
}

// ─── Score Gauge + Legend ─────────────────────────────────────────────────────

function ScoreGauge({ score }: { score: number }) {
  const color = scoreColor(score);
  const [showInfo, setShowInfo] = useState(false);
  return (
    <View className="items-center py-2">
      <View style={{
        width: 96, height: 96, borderRadius: 48,
        borderWidth: 6, borderColor: color,
        alignItems: "center", justifyContent: "center",
        backgroundColor: "#1a1a24",
      }}>
        <Text style={{ color, fontSize: 28, fontWeight: "bold", fontFamily: "monospace" }}>{score}</Text>
      </View>
      <TouchableOpacity onPress={() => setShowInfo(!showInfo)} style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 8 }}>
        <Text className="text-muted text-xs uppercase tracking-wider">Consistency Score</Text>
        <Text style={{ color: "#7070a0", fontSize: 12 }}>{showInfo ? "▲" : "ⓘ"}</Text>
      </TouchableOpacity>

      {showInfo && (
        <View style={{
          marginTop: 8, backgroundColor: "#1e1e2e", borderRadius: 12, padding: 12, width: "100%",
          borderWidth: 1, borderColor: "#2a2a3a",
        }}>
          <Text style={{ color: "#c89b3c", fontSize: 12, fontWeight: "700", marginBottom: 6 }}>¿Cómo se calcula?</Text>
          {[
            { label: "Combo Rate", pts: "hasta 40 pts", desc: "P(abrir al menos 1 Starter en mano inicial)" },
            { label: "Mazo de 40 cartas", pts: "20 pts", desc: "Mazos más pequeños son más consistentes" },
            { label: "Handtraps", pts: "hasta 20 pts", desc: "Más handtraps = más disruption (cap en 9)" },
            { label: "Garnets", pts: "−hasta 20 pts", desc: "Cartas ladrillo penalizan la consistencia" },
          ].map(({ label, pts, desc }) => (
            <View key={label} style={{ flexDirection: "row", gap: 8, marginBottom: 4 }}>
              <Text style={{ color: "#c89b3c", fontSize: 10, width: 70 }}>{pts}</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ color: "#fff", fontSize: 11, fontWeight: "600" }}>{label}</Text>
                <Text style={{ color: "#7070a0", fontSize: 10 }}>{desc}</Text>
              </View>
            </View>
          ))}
          <View style={{ marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: "#2a2a3a", flexDirection: "row", gap: 12 }}>
            {[["≥75", "#50c878", "Bueno"], ["≥50", "#c89b3c", "Regular"], ["<50", "#e05050", "Bajo"]].map(([v, c, l]) => (
              <View key={v} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c }} />
                <Text style={{ color: "#aaa", fontSize: 10 }}>{v} = {l}</Text>
              </View>
            ))}
          </View>
        </View>
      )}
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
  const color = ROLE_COLOR[role];
  return (
    <View style={{ backgroundColor: color + "33", borderRadius: 99, paddingHorizontal: 6, paddingVertical: 2 }}>
      <Text style={{ color, fontSize: 10, fontWeight: "600" }}>{ROLE_LABEL[role]}</Text>
    </View>
  );
}

// ─── Card Row ─────────────────────────────────────────────────────────────────

function CardRow({
  dc, deckSize, goingFirst, onPress,
}: {
  dc: LabeledDeckCard;
  deckSize: number;
  goingFirst: boolean;
  onPress: () => void;
}) {
  const prob = probabilityAtLeast(deckSize, dc.quantity, goingFirst ? 5 : 6, 1);
  return (
    <TouchableOpacity
      className="flex-row items-center py-2 border-b border-border gap-3 px-3"
      onPress={onPress}
    >
      <CardImage card={dc.card} size="small" imageIndex={dc.selectedImageIndex ?? 0}
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
        }}>{pct(prob)}</Text>
        <Text className="text-muted" style={{ fontSize: 9 }}>opening hand</Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── Simulator Panel ─────────────────────────────────────────────────────────

function SimulatorPanel({ main, goingFirst }: { main: LabeledDeckCard[]; goingFirst: boolean }) {
  const [hand, setHand] = useState<Card[]>([]);
  const [mcResult, setMcResult] = useState<{ prob: string; ms: number } | null>(null);
  const [running, setRunning] = useState(false);

  const expanded = useMemo(() => expandDeck(main), [main]);
  const handSize = goingFirst ? 5 : 6;
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
      Alert.alert("Sin Starters", "Ve al tab 'Por Carta' y asigna el rol Starter a las cartas que inician tu combo.");
      return;
    }
    setRunning(true);
    setTimeout(() => {
      const result = runSimulation({
        deck: expanded, handSize, iterations: 10000,
        conditions: [{
          id: "starter", label: "Abrir al menos 1 starter",
          type: "has_any", cardIds: starters.map((dc) => dc.card.id), minCount: 1,
        }],
      });
      const prob = result.conditionResults[0]?.probability ?? 0;
      setMcResult({ prob: `${(prob * 100).toFixed(2)}%`, ms: result.durationMs });
      setRunning(false);
    }, 10);
  }

  const roleSummary = useMemo(() => {
    const counts: Partial<Record<CardRole, number>> = {};
    for (const c of hand) {
      const dc = dcMap.get(c.id);
      if (dc?.role) counts[dc.role] = (counts[dc.role] ?? 0) + 1;
    }
    return counts;
  }, [hand, dcMap]);

  return (
    <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 32 }}>
      <TouchableOpacity className="bg-accent rounded-xl py-3 items-center" onPress={drawNewHand}>
        <Text className="text-bg font-bold text-base">Robar mano ({handSize} cartas)</Text>
      </TouchableOpacity>

      {hand.length > 0 && (
        <>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
            {hand.map((card, i) => {
              const dc = dcMap.get(card.id);
              return (
                <View key={i} style={{ alignItems: "center", gap: 4 }}>
                  <View style={{ width: 64, aspectRatio: 421 / 614, borderRadius: 6, overflow: "hidden" }}>
                    <CardImage card={card} size="small" imageIndex={dc?.selectedImageIndex ?? 0}
                      style={{ width: "100%", height: "100%" }} />
                  </View>
                  {dc?.role && (
                    <View style={{
                      backgroundColor: ROLE_COLOR[dc.role] + "33", borderRadius: 99,
                      paddingHorizontal: 5, paddingVertical: 1,
                    }}>
                      <Text style={{ color: ROLE_COLOR[dc.role], fontSize: 9, fontWeight: "600" }}>
                        {ROLE_LABEL[dc.role]}
                      </Text>
                    </View>
                  )}
                </View>
              );
            })}
          </View>

          {Object.keys(roleSummary).length > 0 && (
            <View className="bg-surface rounded-xl p-3 gap-2">
              <Text className="text-muted text-xs font-semibold uppercase">Composición de la mano</Text>
              {(Object.entries(roleSummary) as [CardRole, number][]).map(([role, count]) => (
                <View key={role} className="flex-row justify-between items-center">
                  <View className="flex-row items-center gap-2">
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: ROLE_COLOR[role] }} />
                    <Text className="text-text text-xs">{ROLE_LABEL[role]}</Text>
                  </View>
                  <Text style={{ color: ROLE_COLOR[role], fontFamily: "monospace", fontSize: 13, fontWeight: "700" }}>
                    ×{count}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </>
      )}

      <View className="bg-surface rounded-xl p-4 gap-3">
        <Text className="text-text text-sm font-semibold">Monte Carlo — 10,000 manos</Text>
        <Text className="text-muted text-xs">
          Simula 10,000 manos de apertura y calcula la probabilidad real de abrir al menos 1 carta con rol Starter.
        </Text>
        <TouchableOpacity
          style={{
            borderWidth: 1, borderColor: running ? "#3a3a4a" : "#c89b3c",
            borderRadius: 10, paddingVertical: 10, alignItems: "center",
          }}
          onPress={runMonteCarlo}
          disabled={running}
        >
          <Text style={{ color: running ? "#3a3a4a" : "#c89b3c", fontWeight: "600", fontSize: 13 }}>
            {running ? "Calculando…" : "Correr simulación"}
          </Text>
        </TouchableOpacity>

        {mcResult && (
          <View className="items-center gap-1">
            <Text style={{ color: "#50c878", fontSize: 32, fontWeight: "bold", fontFamily: "monospace" }}>
              {mcResult.prob}
            </Text>
            <Text className="text-muted text-xs">probabilidad de abrir un starter ({mcResult.ms}ms)</Text>
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
  const [roleTarget, setRoleTarget] = useState<LabeledDeckCard | null>(null);

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
    return [...main].sort((a, b) =>
      probabilityAtLeast(deckSize, b.quantity, hand, 1) -
      probabilityAtLeast(deckSize, a.quantity, hand, 1)
    );
  }, [main, deckSize, goingFirst]);

  if (isEmpty) {
    return (
      <SafeAreaView className="flex-1 bg-bg items-center justify-center" edges={["left", "right"]}>
        <Text style={{ fontSize: 40 }}>📊</Text>
        <Text className="text-text font-semibold text-base mt-3">Mazo vacío</Text>
        <Text className="text-muted text-sm mt-1 text-center px-8">
          Agregá cartas en el Deck Builder para ver el análisis de consistencia.
        </Text>
      </SafeAreaView>
    );
  }

  const TABS: { id: ActiveTab; label: string }[] = [
    { id: "overview", label: "Resumen" },
    { id: "cards", label: "Por Carta" },
    { id: "simulator", label: "Simulador" },
  ];

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["left", "right"]}>
      {/* Role picker modal */}
      <RolePickerModal
        dc={roleTarget}
        onClose={() => setRoleTarget(null)}
        onSelect={(role) => {
          if (roleTarget) setCardRole(roleTarget.card.id, roleTarget.zone, role);
        }}
      />

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

      {/* Going 1st / 2nd toggle */}
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
              {val ? "Ir primero (5)" : "Ir segundo (6)"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Overview */}
      {activeTab === "overview" && (
        <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 32 }}>
          {report && <ScoreGauge score={report.overallScore} />}

          {report && (
            <>
              <View className="flex-row gap-2">
                <StatChip label="Tamaño" value={report.deckSize} />
                <StatChip
                  label="Combo Rate"
                  value={report.starterCount > 0
                    ? pct(groupProbability(report.deckSize, report.starterCount, goingFirst ? 5 : 6))
                    : "—"}
                  color={report.comboRate >= 0.7 ? "#50c878" : "#c89b3c"}
                />
              </View>
              <View className="flex-row gap-2">
                <StatChip label="Monstruos" value={report.monsterCount} color="#88aaff" />
                <StatChip label="Magias" value={report.spellCount} color="#50c878" />
                <StatChip label="Trampas" value={report.trapCount} color="#ff8844" />
              </View>
              <View className="flex-row gap-2">
                <StatChip label="Starters" value={report.starterCount} color="#50c878" />
                <StatChip label="Extenders" value={report.extenderCount} color="#88aaff" />
                <StatChip label="Handtraps" value={report.handtrapCount} color="#ff8844" />
                <StatChip label="Garnets" value={report.brickCount} color="#e05050" />
              </View>
            </>
          )}

          {validation && (
            <View className="bg-surface rounded-xl p-4 gap-2">
              <View className="flex-row items-center gap-2">
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: validation.valid ? "#50c878" : "#e05050" }} />
                <Text className="text-text text-xs font-semibold">
                  {validation.valid ? "Mazo legal" : "El mazo tiene problemas"}
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
        </ScrollView>
      )}

      {/* By Card */}
      {activeTab === "cards" && (
        <View className="flex-1">
          <View className="flex-row items-center px-3 py-1.5 border-b border-border bg-surface">
            <Text className="text-muted flex-1" style={{ fontSize: 10, textTransform: "uppercase" }}>
              Carta — toca para asignar rol
            </Text>
            <Text className="text-muted" style={{ fontSize: 10, textTransform: "uppercase" }}>Prob.</Text>
          </View>
          <FlatList
            data={sortedMain}
            keyExtractor={(item) => String(item.card.id)}
            contentContainerStyle={{ paddingBottom: 32 }}
            renderItem={({ item }) => (
              <CardRow
                dc={item}
                deckSize={deckSize}
                goingFirst={goingFirst}
                onPress={() => setRoleTarget(item)}
              />
            )}
          />
        </View>
      )}

      {/* Simulator */}
      {activeTab === "simulator" && (
        <SimulatorPanel main={main} goingFirst={goingFirst} />
      )}
    </SafeAreaView>
  );
}
