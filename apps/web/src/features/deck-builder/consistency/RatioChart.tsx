/**
 * Horizontal stacked bar showing Monster / Spell / Trap ratio.
 * No external chart library — pure SVG/CSS.
 */

import type { ConsistencyReport } from "@yugioh/core";

interface RatioChartProps {
  report: ConsistencyReport;
}

interface Segment {
  label: string;
  count: number;
  color: string;
}

function PctBar({ segments, total }: { segments: Segment[]; total: number }) {
  if (total === 0) return null;
  return (
    <div className="flex rounded overflow-hidden h-4 w-full">
      {segments.map((s) => {
        const pct = (s.count / total) * 100;
        return (
          <div
            key={s.label}
            title={`${s.label}: ${s.count} (${pct.toFixed(1)}%)`}
            style={{ width: `${pct}%`, backgroundColor: s.color, transition: "width 0.4s ease" }}
          />
        );
      })}
    </div>
  );
}

export function RatioChart({ report }: RatioChartProps) {
  const { monsterCount, spellCount, trapCount, deckSize } = report;

  const segments: Segment[] = [
    { label: "Monsters", count: monsterCount, color: "#4da6ff" },
    { label: "Spells",   count: spellCount,   color: "#50c878" },
    { label: "Traps",    count: trapCount,     color: "#c878c8" },
  ];

  return (
    <div className="space-y-2">
      <PctBar segments={segments} total={deckSize} />
      <div className="flex gap-4 flex-wrap">
        {segments.map((s) => (
          <div key={s.label} className="flex items-center gap-1.5 text-xs">
            <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: s.color }} />
            <span style={{ color: "var(--color-muted)" }}>{s.label}</span>
            <span className="font-mono font-semibold" style={{ color: "var(--color-text)" }}>{s.count}</span>
            {deckSize > 0 && (
              <span style={{ color: "var(--color-muted)" }}>
                ({((s.count / deckSize) * 100).toFixed(0)}%)
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
