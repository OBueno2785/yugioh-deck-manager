/**
 * Probability of seeing at least one card from each labeled group
 * (starters, handtraps, etc.) in the opening hand.
 */

import type { CardRole } from "@yugioh/core";
import type { GroupProbRow } from "@/hooks/useConsistency";

const ROLE_COLORS: Record<CardRole, string> = {
  starter:    "#50c878",
  extender:   "#4da6ff",
  handtrap:   "#c878c8",
  boardbreak: "#ff6b6b",
  garnets:    "#666",
  engine:     "#c89b3c",
  tech:       "#ff9f4a",
};

interface GroupProbabilitiesProps {
  rows: GroupProbRow[];
  goingFirst: boolean;
}

export function GroupProbabilities({ rows, goingFirst }: GroupProbabilitiesProps) {
  if (rows.length === 0) {
    return (
      <div className="text-sm py-2" style={{ color: "var(--color-muted)" }}>
        Label cards with roles (hover a card in the deck zones) to see group probabilities.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {rows.map((row) => {
        const prob = goingFirst ? row.goingFirst : row.goingSecond;
        const pct  = goingFirst ? row.pctFirst   : row.pctSecond;
        const color = ROLE_COLORS[row.role];

        return (
          <div key={row.role}>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                <span className="text-sm" style={{ color: "var(--color-text)" }}>{row.label}</span>
                <span className="text-xs" style={{ color: "var(--color-muted)" }}>
                  ({row.totalCopies} cop{row.totalCopies === 1 ? "y" : "ies"})
                </span>
              </div>
              <span
                className="text-sm font-mono font-bold"
                style={{ color: prob >= 0.7 ? "#50c878" : prob >= 0.4 ? "var(--color-accent)" : "var(--color-muted)" }}
              >
                {pct}
              </span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: "var(--color-border)" }}>
              <div
                className="h-full rounded-full"
                style={{
                  width: `${prob * 100}%`,
                  backgroundColor: color,
                  opacity: 0.85,
                  transition: "width 0.4s ease",
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
