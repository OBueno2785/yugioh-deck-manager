import { useState, useMemo } from "react";
import { useDeckStore } from "@/store/deckStore";
import { fetchRecommendations } from "@/lib/recommenderApi";
import type { RecommendResponse, DeckAnalysis } from "@/lib/recommenderApi";
import { StrategyPanel } from "./StrategyPanel";
import { LlmComboLineViewer, AlgoComboPathViewer } from "./ComboLineViewer";
import { BridgePanel, IntraBridgePanel } from "./BridgePanel";
import { RecommendedDeckPreview } from "./RecommendedDeckPreview";
import type { Card } from "@yugioh/core";

type ResultTab = "strategy" | "combos" | "bridge" | "recommendations";

function isRealAnalysis(a: RecommendResponse["analysis"]): a is DeckAnalysis {
  return !!a && !("error" in a);
}

export default function RecommenderPage() {
  const main  = useDeckStore((s) => s.main);
  const extra = useDeckStore((s) => s.extra);
  const deckName = useDeckStore((s) => s.name);

  const [archetypeB, setArchetypeB] = useState("");
  const [withLlm, setWithLlm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RecommendResponse | null>(null);
  const [activeTab, setActiveTab] = useState<ResultTab>("strategy");

  // Flat ordered list of card IDs (with duplicates) from the current deck
  const deckCardIds = useMemo(() => {
    const ids: number[] = [];
    for (const dc of main)  for (let i = 0; i < dc.quantity; i++) ids.push(dc.card.id);
    for (const dc of extra) for (let i = 0; i < dc.quantity; i++) ids.push(dc.card.id);
    return ids;
  }, [main, extra]);

  // Build a card lookup from the current deck for the preview component
  const cardObjects = useMemo(() => {
    const map = new Map<number, Card>();
    for (const dc of [...main, ...extra]) map.set(dc.card.id, dc.card);
    return map;
  }, [main, extra]);

  const totalCards = deckCardIds.length;
  const canAnalyze = totalCards >= 10;

  async function handleAnalyze() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await fetchRecommendations(deckCardIds, {
        archetypeB: archetypeB.trim() || undefined,
        withLlm,
      });
      setResult(data);
      setActiveTab("strategy");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const analysis = result && isRealAnalysis(result.analysis) ? result.analysis : null;

  // Tab visibility
  const intraBridges = result?.intraBridges ?? [];
  const hasBridge = !!(result?.bridge || intraBridges.length > 0);
  const bridgeTabLabel = result?.bridge
    ? `Bridge → ${result.bridge.archetypeB}`
    : intraBridges.length > 0
      ? `Bridge (${intraBridges.length} pair${intraBridges.length > 1 ? "s" : ""})`
      : "Bridge";

  const tabs: { key: ResultTab; label: string }[] = [
    { key: "strategy",        label: "Strategy" },
    { key: "combos",          label: `Combos (${result?.comboPaths.length ?? 0})` },
    ...(hasBridge ? [{ key: "bridge" as ResultTab, label: bridgeTabLabel }] : []),
    { key: "recommendations", label: `Add to Deck (${result?.recommendations.length ?? 0})` },
  ];

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "24px 16px" }}>
      {/* ── Input card ─────────────────────────────────────────────────────── */}
      <div style={{ backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10, padding: 20, marginBottom: 24 }}>
        <h2 style={{ margin: "0 0 16px", fontSize: 18, color: "var(--color-accent)" }}>
          Deck Recommender
        </h2>

        {/* Deck summary */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontSize: 14, color: "var(--color-text)", fontWeight: 600 }}>{deckName}</p>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--color-muted)" }}>
              {totalCards} cards ({main.reduce((s, dc) => s + dc.quantity, 0)} main + {extra.reduce((s, dc) => s + dc.quantity, 0)} extra)
            </p>
          </div>
          {!canAnalyze && (
            <span style={{ fontSize: 12, color: "#e05050" }}>Need at least 10 cards in deck</span>
          )}
        </div>

        {/* Bridge target */}
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label style={{ display: "block", fontSize: 12, color: "var(--color-muted)", marginBottom: 4 }}>
              Bridge target archetype (optional)
            </label>
            <input
              value={archetypeB}
              onChange={(e) => setArchetypeB(e.target.value)}
              placeholder="e.g. Snake-Eye, Branded, Labrynth…"
              style={{
                width: "100%", padding: "7px 10px", borderRadius: 6, fontSize: 13,
                backgroundColor: "var(--color-bg)", border: "1px solid var(--color-border)",
                color: "var(--color-text)", outline: "none", boxSizing: "border-box",
              }}
            />
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--color-text)", cursor: "pointer", marginBottom: 1 }}>
            <input
              type="checkbox"
              checked={withLlm}
              onChange={(e) => setWithLlm(e.target.checked)}
              style={{ accentColor: "var(--color-accent)", width: 14, height: 14 }}
            />
            Claude narration
          </label>

          <button
            onClick={handleAnalyze}
            disabled={!canAnalyze || loading}
            style={{
              padding: "8px 20px", borderRadius: 6, fontSize: 14, fontWeight: 700,
              backgroundColor: canAnalyze && !loading ? "var(--color-accent)" : "var(--color-border)",
              color: canAnalyze && !loading ? "#0f0f13" : "var(--color-muted)",
              border: "none", cursor: canAnalyze && !loading ? "pointer" : "not-allowed",
            }}
          >
            {loading ? "Analyzing…" : "Analyze Deck"}
          </button>
        </div>
      </div>

      {/* ── Error ──────────────────────────────────────────────────────────── */}
      {error && (
        <div style={{ padding: "12px 16px", borderRadius: 8, backgroundColor: "#e0505018", border: "1px solid #e0505060", marginBottom: 20, color: "#e05050", fontSize: 14 }}>
          {error}
        </div>
      )}

      {/* ── Loading ────────────────────────────────────────────────────────── */}
      {loading && (
        <div style={{ textAlign: "center", padding: "40px 0", color: "var(--color-muted)", fontSize: 14 }}>
          <Spinner />
          <p style={{ margin: "12px 0 0" }}>
            {withLlm
              ? "Running algorithmic analysis + Claude narration — this takes ~10 s…"
              : "Running algorithmic analysis…"}
          </p>
        </div>
      )}

      {/* ── Results ────────────────────────────────────────────────────────── */}
      {result && !loading && (
        <div>
          {/* Meta bar */}
          <div style={{ display: "flex", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
            <MetaChip label="Archetypes" value={result.deckArchetypes.map((a) => `${a.archetype} (${a.count})`).join(", ") || "—"} />
            <MetaChip label="Matrix decks" value={result.matrixDecks.toLocaleString()} />
            {result.analysis && "error" in result.analysis && (
              <span style={{ fontSize: 12, color: "#c89b3c", padding: "4px 10px", borderRadius: 6, border: "1px solid #c89b3c60", backgroundColor: "#c89b3c18" }}>
                LLM unavailable — showing algorithmic results
              </span>
            )}
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--color-border)", marginBottom: 20 }}>
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                style={{
                  padding: "8px 16px", fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer",
                  backgroundColor: "transparent",
                  color: activeTab === tab.key ? "var(--color-accent)" : "var(--color-muted)",
                  borderBottom: activeTab === tab.key ? "2px solid var(--color-accent)" : "2px solid transparent",
                  marginBottom: -1,
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          {activeTab === "strategy" && (
            analysis
              ? <StrategyPanel analysis={analysis} />
              : <AlgorithmicSummary result={result} />
          )}

          {activeTab === "combos" && (
            analysis && analysis.combo_lines.length > 0
              ? <LlmComboLineViewer lines={analysis.combo_lines} />
              : <AlgoComboPathViewer paths={result.comboPaths} />
          )}

          {activeTab === "bridge" && (
            result.bridge
              ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                  <BridgePanel bridge={result.bridge} analysis={result.bridgeAnalysis} />
                  {intraBridges.length > 0 && (
                    <div>
                      <h3 style={{ margin: "0 0 12px", fontSize: 13, color: "var(--color-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                        Intra-deck Archetype Bridges
                      </h3>
                      <IntraBridgePanel bridges={intraBridges} />
                    </div>
                  )}
                </div>
              )
              : <IntraBridgePanel bridges={intraBridges} />
          )}

          {activeTab === "recommendations" && (
            <RecommendedDeckPreview
              recommendations={result.recommendations}
              analysis={analysis}
              cardObjects={cardObjects}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Algorithmic summary (no LLM) ────────────────────────────────────────────

function AlgorithmicSummary({ result }: { result: RecommendResponse }) {
  const topRec = result.recommendations.slice(0, 3);
  const hasCombos = result.comboPaths.length > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Archetype breakdown */}
      <div>
        <p style={{ margin: "0 0 10px", fontSize: 12, color: "var(--color-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Archetype Breakdown
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {result.deckArchetypes.map((a, i) => {
            const maxCount = result.deckArchetypes[0]?.count ?? 1;
            const pct = Math.round((a.count / maxCount) * 100);
            return (
              <div key={a.archetype} style={{
                padding: "8px 14px", borderRadius: 8,
                backgroundColor: "var(--color-bg)", border: "1px solid var(--color-border)",
                display: "flex", flexDirection: "column", gap: 4, minWidth: 120,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: i === 0 ? "var(--color-accent)" : "var(--color-text)" }}>
                    {a.archetype}
                  </span>
                  <span style={{ fontSize: 12, color: "var(--color-muted)" }}>{a.count}</span>
                </div>
                <div style={{ height: 3, borderRadius: 2, backgroundColor: "var(--color-border)", overflow: "hidden" }}>
                  <div style={{ width: `${pct}%`, height: "100%", backgroundColor: i === 0 ? "var(--color-accent)" : "var(--color-muted)", borderRadius: 2 }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Quick stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
        <StatCard label="Deck Size" value={String(result.deckSize)} />
        <StatCard label="Unique Cards" value={String(result.uniqueCards)} />
        <StatCard label="Combos Found" value={String(result.comboPaths.length)} />
      </div>

      {/* Top recommendations preview */}
      {topRec.length > 0 && (
        <div>
          <p style={{ margin: "0 0 10px", fontSize: 12, color: "var(--color-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Top Suggestions
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {topRec.map((r) => (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 6, backgroundColor: "var(--color-bg)", border: "1px solid var(--color-border)" }}>
                <span style={{ fontWeight: 600, fontSize: 13, color: "var(--color-text)", flex: 1 }}>{r.name}</span>
                <span style={{ fontSize: 12, color: "var(--color-accent)", fontWeight: 700 }}>{r.score}</span>
                <span style={{ fontSize: 12, color: "var(--color-muted)" }}>{r.reason}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Combo hint */}
      {hasCombos && (
        <div style={{ padding: "10px 14px", borderRadius: 8, backgroundColor: "var(--color-bg)", border: "1px solid var(--color-border)", borderLeft: "3px solid var(--color-accent)" }}>
          <p style={{ margin: 0, fontSize: 13, color: "var(--color-muted)" }}>
            {result.comboPaths.length} combo path{result.comboPaths.length !== 1 ? "s" : ""} detected — see the <strong style={{ color: "var(--color-text)" }}>Combos</strong> tab for step-by-step details.
          </p>
        </div>
      )}

      {/* LLM upsell */}
      <div style={{ padding: "10px 14px", borderRadius: 8, backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)" }}>
        <p style={{ margin: 0, fontSize: 12, color: "var(--color-muted)" }}>
          Enable <strong style={{ color: "var(--color-accent)" }}>Claude narration</strong> for a full strategy write-up, narrated combo lines, and per-card explanations (requires ANTHROPIC_API_KEY).
        </p>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: "10px 14px", borderRadius: 8, backgroundColor: "var(--color-bg)", border: "1px solid var(--color-border)", textAlign: "center" }}>
      <p style={{ margin: "0 0 4px", fontSize: 11, color: "var(--color-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</p>
      <p style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "var(--color-accent)" }}>{value}</p>
    </div>
  );
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

function MetaChip({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ fontSize: 12, color: "var(--color-muted)" }}>
      <span>{label}: </span>
      <span style={{ color: "var(--color-text)" }}>{value}</span>
    </div>
  );
}

function Spinner() {
  return (
    <div style={{
      width: 32, height: 32, margin: "0 auto",
      border: "3px solid var(--color-border)",
      borderTopColor: "var(--color-accent)",
      borderRadius: "50%",
      animation: "spin 0.8s linear infinite",
    }} />
  );
}
