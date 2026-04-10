/**
 * Monte Carlo results display.
 * Shows probability per condition + combined probability + session history stats.
 */

import type { SimulationResult, SimulationCondition } from "@yugioh/core";
import type { HandRecord } from "@/hooks/useSimulator";

interface SimResultsProps {
  result: SimulationResult | null;
  isRunning: boolean;
  conditions: SimulationCondition[];
  handHistory: HandRecord[];
  onClearHistory: () => void;
  onRun: () => void;
  iterations: number;
  onIterationsChange: (n: number) => void;
  disabled: boolean;
}

const ITERATION_PRESETS = [1_000, 5_000, 10_000, 50_000];

function ProbBar({
  label,
  probability,
  successCount,
  iterations,
  isCombo = false,
}: {
  label: string;
  probability: number;
  successCount: number;
  iterations: number;
  isCombo?: boolean;
}) {
  const pct = probability * 100;
  const color = pct >= 70 ? "#50c878" : pct >= 40 ? "var(--color-accent)" : "var(--color-danger)";

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span
          className={`text-sm ${isCombo ? "font-semibold" : ""}`}
          style={{ color: isCombo ? "var(--color-accent)" : "var(--color-text)" }}
        >
          {label}
        </span>
        <div className="flex items-baseline gap-2">
          <span className="text-xs" style={{ color: "var(--color-muted)" }}>
            {successCount.toLocaleString()} / {iterations.toLocaleString()}
          </span>
          <span className="font-mono font-bold text-base" style={{ color }}>
            {pct.toFixed(2)}%
          </span>
        </div>
      </div>
      <div className="h-2.5 rounded-full overflow-hidden" style={{ backgroundColor: "var(--color-border)" }}>
        <div
          className="h-full rounded-full"
          style={{
            width: `${pct}%`,
            backgroundColor: color,
            transition: "width 0.6s ease",
          }}
        />
      </div>
    </div>
  );
}

function SessionStats({
  handHistory,
  conditions,
  onClear,
}: {
  handHistory: HandRecord[];
  conditions: SimulationCondition[];
  onClear: () => void;
}) {
  if (handHistory.length === 0) return null;

  const total = handHistory.length;
  const allMetCount = handHistory.filter((h) => h.allMet).length;
  const allMetRate = allMetCount / total;

  return (
    <div
      className="rounded-lg p-3 space-y-2"
      style={{ backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)" }}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--color-muted)" }}>
          Session ({total} hand{total !== 1 ? "s" : ""} drawn)
        </span>
        <button
          className="text-xs opacity-50 hover:opacity-100"
          style={{ color: "var(--color-muted)" }}
          onClick={onClear}
        >
          Clear
        </button>
      </div>

      {conditions.length > 0 && (
        <div className="space-y-1.5">
          {conditions.map((c, idx) => {
            const count = handHistory.filter((h) => h.conditionsMet[idx]).length;
            const rate = count / total;
            const pct = rate * 100;
            const color = pct >= 70 ? "#50c878" : pct >= 40 ? "var(--color-accent)" : "var(--color-danger)";
            return (
              <div key={c.id} className="flex items-center justify-between text-xs">
                <span className="truncate" style={{ color: "var(--color-muted)" }}>
                  {c.label || `Condition ${idx + 1}`}
                </span>
                <span className="font-mono font-semibold ml-2" style={{ color }}>
                  {count}/{total} ({pct.toFixed(0)}%)
                </span>
              </div>
            );
          })}
          {conditions.length > 1 && (
            <div className="flex items-center justify-between text-xs border-t pt-1.5" style={{ borderColor: "var(--color-border)" }}>
              <span style={{ color: "var(--color-muted)" }}>All conditions</span>
              <span
                className="font-mono font-bold"
                style={{ color: allMetRate >= 0.5 ? "#50c878" : "var(--color-danger)" }}
              >
                {allMetCount}/{total} ({(allMetRate * 100).toFixed(0)}%)
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function SimResults({
  result,
  isRunning,
  conditions,
  handHistory,
  onClearHistory,
  onRun,
  iterations,
  onIterationsChange,
  disabled,
}: SimResultsProps) {
  return (
    <div className="space-y-4">
      {/* Run controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex rounded overflow-hidden text-xs" style={{ border: "1px solid var(--color-border)" }}>
          {ITERATION_PRESETS.map((n) => (
            <button
              key={n}
              className="px-2.5 py-1.5 transition-colors"
              style={{
                backgroundColor: iterations === n ? "var(--color-accent)" : "transparent",
                color: iterations === n ? "#000" : "var(--color-muted)",
              }}
              onClick={() => onIterationsChange(n)}
            >
              {n >= 1000 ? `${n / 1000}K` : n}
            </button>
          ))}
        </div>
        <button
          className="flex-1 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
          style={{ backgroundColor: "var(--color-accent)", color: "#000" }}
          onClick={onRun}
          disabled={disabled || isRunning || conditions.length === 0}
        >
          {isRunning ? (
            <>
              <span className="animate-spin inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full" />
              Running {iterations.toLocaleString()} iterations…
            </>
          ) : (
            `Run ${iterations.toLocaleString()} iterations`
          )}
        </button>
      </div>

      {conditions.length === 0 && (
        <p className="text-xs text-center py-2" style={{ color: "var(--color-muted)" }}>
          Add at least one condition above to run the simulation.
        </p>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-3">
          <div className="flex items-baseline justify-between">
            <span className="text-xs uppercase tracking-wide font-semibold" style={{ color: "var(--color-muted)" }}>
              Results — {result.iterations.toLocaleString()} iterations
            </span>
            <span className="text-xs" style={{ color: "var(--color-muted)" }}>
              {result.durationMs}ms
            </span>
          </div>

          {result.conditionResults.map((cr, i) => (
            <ProbBar
              key={cr.condition.id}
              label={cr.condition.label || `Condition ${i + 1}`}
              probability={cr.probability}
              successCount={cr.successCount}
              iterations={result.iterations}
            />
          ))}

          {result.conditionResults.length > 1 && (
            <div className="pt-2 border-t" style={{ borderColor: "var(--color-border)" }}>
              <ProbBar
                label="All conditions (combo rate)"
                probability={result.allConditionsMet.probability}
                successCount={result.allConditionsMet.successCount}
                iterations={result.iterations}
                isCombo
              />
            </div>
          )}
        </div>
      )}

      {/* Session history */}
      <SessionStats
        handHistory={handHistory}
        conditions={conditions}
        onClear={onClearHistory}
      />
    </div>
  );
}
