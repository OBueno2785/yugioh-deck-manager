import { useState } from "react";
import type { LabeledDeckCard, GameFormat } from "@yugioh/core";
import { useConsistency } from "@/hooks/useConsistency";
import { ScoreGauge } from "./consistency/ScoreGauge";
import { LegalityCheck } from "./consistency/LegalityCheck";
import { RatioChart } from "./consistency/RatioChart";
import { CardProbabilityList } from "./consistency/CardProbabilityList";
import { GroupProbabilities } from "./consistency/GroupProbabilities";

interface ConsistencyPanelProps {
  main: LabeledDeckCard[];
  extra: LabeledDeckCard[];
  side: LabeledDeckCard[];
  format: GameFormat;
}

type InnerTab = "groups" | "cards";

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--color-muted)" }}>
      {children}
    </h3>
  );
}

export function ConsistencyPanel({ main, extra, side, format }: ConsistencyPanelProps) {
  const [goingFirst, setGoingFirst] = useState(true);
  const [innerTab, setInnerTab] = useState<InnerTab>("groups");

  const { report, validation, cardRows, groupRows, deckSize, isEmpty } =
    useConsistency(main, extra, side, format);

  if (isEmpty) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-2 text-center px-8">
        <span className="text-3xl">🃏</span>
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>
          Add cards to your main deck to see consistency metrics.
        </p>
        <p className="text-xs" style={{ color: "var(--color-muted)" }}>
          Label cards as <strong>Starter</strong>, <strong>Extender</strong>, or <strong>Handtrap</strong> by hovering them in the deck zones to unlock group probability analysis.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-5 overflow-y-auto">

      {/* ── Top row: Score + Key Metrics ────────────────────────────────── */}
      <div className="flex items-start gap-6 flex-wrap">
        <ScoreGauge score={report.overallScore} size={130} />

        <div className="flex-1 min-w-48 space-y-3">
          {/* Going first / second toggle */}
          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: "var(--color-muted)" }}>Hand size:</span>
            <div className="flex rounded overflow-hidden text-xs" style={{ border: "1px solid var(--color-border)" }}>
              {[
                { label: "Going 1st (5)", val: true },
                { label: "Going 2nd (6)", val: false },
              ].map(({ label, val }) => (
                <button
                  key={String(val)}
                  className="px-3 py-1 transition-colors"
                  style={{
                    backgroundColor: goingFirst === val ? "var(--color-accent)" : "transparent",
                    color: goingFirst === val ? "#000" : "var(--color-muted)",
                  }}
                  onClick={() => setGoingFirst(val)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Key stats grid */}
          <div className="grid grid-cols-2 gap-2">
            <StatCard
              label="Combo Rate"
              value={`${(report.comboRate * 100).toFixed(1)}%`}
              sub={`P(open ≥1 starter)`}
              color={report.comboRate >= 0.65 ? "#50c878" : report.comboRate >= 0.4 ? "var(--color-accent)" : "var(--color-danger)"}
            />
            <StatCard
              label="Deck Size"
              value={String(deckSize)}
              sub={deckSize === 40 ? "Optimal" : deckSize < 40 ? "Too small" : `${deckSize - 40} over minimum`}
              color={deckSize === 40 ? "#50c878" : deckSize < 40 ? "var(--color-danger)" : "var(--color-accent)"}
            />
            <StatCard
              label="Starters"
              value={String(report.starterCount)}
              sub={`cop${report.starterCount === 1 ? "y" : "ies"} in deck`}
              color={report.starterCount >= 6 ? "#50c878" : report.starterCount >= 3 ? "var(--color-accent)" : "var(--color-danger)"}
            />
            <StatCard
              label="Handtraps"
              value={String(report.handtrapCount)}
              sub={`cop${report.handtrapCount === 1 ? "y" : "ies"} in deck`}
              color={report.handtrapCount >= 9 ? "#50c878" : report.handtrapCount >= 3 ? "var(--color-accent)" : "var(--color-muted)"}
            />
          </div>
        </div>
      </div>

      {/* ── Deck Legality ────────────────────────────────────────────────── */}
      <div>
        <SectionHeader>Legality & Warnings</SectionHeader>
        <LegalityCheck validation={validation} />
      </div>

      {/* ── Monster / Spell / Trap Ratio ─────────────────────────────────── */}
      <div>
        <SectionHeader>Card Type Ratio</SectionHeader>
        <RatioChart report={report} />
      </div>

      {/* ── Probability Analysis ─────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <SectionHeader>Opening Hand Probabilities</SectionHeader>
          {/* Inner tab toggle */}
          <div className="flex rounded overflow-hidden text-xs" style={{ border: "1px solid var(--color-border)" }}>
            <button
              className="px-2.5 py-1 transition-colors"
              style={{
                backgroundColor: innerTab === "groups" ? "var(--color-accent)" : "transparent",
                color: innerTab === "groups" ? "#000" : "var(--color-muted)",
              }}
              onClick={() => setInnerTab("groups")}
            >
              By Role
            </button>
            <button
              className="px-2.5 py-1 transition-colors"
              style={{
                backgroundColor: innerTab === "cards" ? "var(--color-accent)" : "transparent",
                color: innerTab === "cards" ? "#000" : "var(--color-muted)",
              }}
              onClick={() => setInnerTab("cards")}
            >
              By Card
            </button>
          </div>
        </div>

        {innerTab === "groups" ? (
          <GroupProbabilities rows={groupRows} goingFirst={goingFirst} />
        ) : (
          <CardProbabilityList rows={cardRows} goingFirst={goingFirst} />
        )}
      </div>

      {/* ── Formula footnote ─────────────────────────────────────────────── */}
      <p className="text-xs" style={{ color: "var(--color-muted)" }}>
        Probabilities use the exact hypergeometric distribution.
        P(see ≥1 copy in {goingFirst ? "5" : "6"}-card opening hand).
      </p>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub: string;
  color: string;
}) {
  return (
    <div
      className="rounded-lg p-2.5"
      style={{ backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)" }}
    >
      <div className="text-xs mb-0.5" style={{ color: "var(--color-muted)" }}>{label}</div>
      <div className="text-lg font-bold font-mono" style={{ color }}>{value}</div>
      <div className="text-xs" style={{ color: "var(--color-muted)" }}>{sub}</div>
    </div>
  );
}
