import { useState } from "react";
import type { LabeledDeckCard } from "@yugioh/core";
import { useSimulator } from "@/hooks/useSimulator";
import { HandDisplay } from "./simulator/HandDisplay";
import { ConditionBuilder } from "./simulator/ConditionBuilder";
import { SimResults } from "./simulator/SimResults";

interface SimulatorPanelProps {
  main: LabeledDeckCard[];
  extra: LabeledDeckCard[];
}

type SimTab = "hands" | "montecarlo";

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--color-muted)" }}>
      {children}
    </h3>
  );
}

export function SimulatorPanel({ main, extra }: SimulatorPanelProps) {
  const [simTab, setSimTab] = useState<SimTab>("hands");

  // All hooks called unconditionally
  const {
    conditions,
    addCondition,
    updateCondition,
    removeCondition,
    clearConditions,
    goingFirst,
    setGoingFirst,
    iterations,
    setIterations,
    runMonteCarlo,
    isRunning,
    mcResult,
    drawnHand,
    drawHand,
    handHistory,
    clearHistory,
    deckIsEmpty,
  } = useSimulator(main, extra);

  if (deckIsEmpty) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-2 text-center px-8">
        <span className="text-3xl">🎲</span>
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>
          Add cards to your main deck to use the simulator.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4 overflow-y-auto">

      {/* ── Going first / second ───────────────────────────────────────── */}
      <div className="flex items-center gap-2">
        <span className="text-xs" style={{ color: "var(--color-muted)" }}>Going:</span>
        <div className="flex rounded overflow-hidden text-xs" style={{ border: "1px solid var(--color-border)" }}>
          {[
            { label: "1st (5 cards)", val: true },
            { label: "2nd (6 cards)", val: false },
          ].map(({ label, val }) => (
            <button
              key={String(val)}
              className="px-3 py-1.5 transition-colors"
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

      {/* ── Mode tabs ─────────────────────────────────────────────────── */}
      <div
        className="flex rounded overflow-hidden text-xs font-medium"
        style={{ border: "1px solid var(--color-border)" }}
      >
        {(["hands", "montecarlo"] as SimTab[]).map((tab) => (
          <button
            key={tab}
            className="flex-1 py-2 transition-colors"
            style={{
              backgroundColor: simTab === tab ? "var(--color-surface)" : "transparent",
              color: simTab === tab ? "var(--color-text)" : "var(--color-muted)",
              borderRight: tab === "hands" ? "1px solid var(--color-border)" : "none",
            }}
            onClick={() => setSimTab(tab)}
          >
            {tab === "hands" ? "Draw Hands" : "Monte Carlo"}
          </button>
        ))}
      </div>

      {/* ── Conditions (shared) ───────────────────────────────────────── */}
      <div>
        <SectionHeader>Conditions — define a "good hand"</SectionHeader>
        <ConditionBuilder
          conditions={conditions}
          deckCards={main}
          onAdd={addCondition}
          onUpdate={updateCondition}
          onRemove={removeCondition}
          onClear={clearConditions}
        />
      </div>

      {/* ── Mode content ──────────────────────────────────────────────── */}
      {simTab === "hands" ? (
        <div>
          <SectionHeader>Opening Hand</SectionHeader>
          <HandDisplay
            hand={drawnHand}
            conditions={conditions}
            onDraw={drawHand}
            goingFirst={goingFirst}
            disabled={false}
          />
        </div>
      ) : (
        <div>
          <SectionHeader>Simulation Results</SectionHeader>
          <SimResults
            result={mcResult}
            isRunning={isRunning}
            conditions={conditions}
            handHistory={handHistory}
            onClearHistory={clearHistory}
            onRun={runMonteCarlo}
            iterations={iterations}
            onIterationsChange={setIterations}
            disabled={false}
          />
        </div>
      )}
    </div>
  );
}
