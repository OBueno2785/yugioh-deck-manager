/**
 * Sorted list of every card in the main deck with its opening-hand probability.
 * Color-coded by role. Toggle going first (5 cards) / going second (6 cards).
 */

import type { CardRole } from "@yugioh/core";
import type { CardProbRow } from "@/hooks/useConsistency";

const ROLE_COLORS: Record<CardRole, string> = {
  starter:    "#50c878",
  extender:   "#4da6ff",
  handtrap:   "#c878c8",
  boardbreak: "#ff6b6b",
  garnets:    "#666",
  engine:     "#c89b3c",
  tech:       "#ff9f4a",
};

const ROLE_LABELS: Record<CardRole, string> = {
  starter:    "Starter",
  extender:   "Extender",
  handtrap:   "Handtrap",
  boardbreak: "Board Break",
  garnets:    "Garnet",
  engine:     "Engine",
  tech:       "Tech",
};

interface CardProbabilityListProps {
  rows: CardProbRow[];
  goingFirst: boolean;
}

export function CardProbabilityList({ rows, goingFirst }: CardProbabilityListProps) {
  if (rows.length === 0) {
    return (
      <div className="text-center py-6 text-sm" style={{ color: "var(--color-muted)" }}>
        Add cards to the main deck to see probabilities.
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {rows.map((row) => {
        const prob = goingFirst ? row.goingFirst : row.goingSecond;
        const pct  = goingFirst ? row.pctFirst   : row.pctSecond;
        const roleColor = row.role ? ROLE_COLORS[row.role] : "var(--color-muted)";

        return (
          <div key={row.cardId} className="group">
            <div className="flex items-center gap-2 mb-0.5">
              {/* Role dot */}
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: roleColor }}
                title={row.role ? ROLE_LABELS[row.role] : "No role"}
              />
              {/* Name + copies */}
              <span className="flex-1 text-xs truncate" style={{ color: "var(--color-text)" }}>
                {row.cardName}
              </span>
              <span className="text-xs flex-shrink-0" style={{ color: "var(--color-muted)" }}>
                ×{row.copies}
              </span>
              {/* Role badge */}
              {row.role && (
                <span
                  className="text-xs px-1.5 py-0.5 rounded flex-shrink-0 hidden group-hover:inline"
                  style={{ backgroundColor: `${roleColor}22`, color: roleColor, border: `1px solid ${roleColor}44` }}
                >
                  {ROLE_LABELS[row.role]}
                </span>
              )}
              {/* Percentage */}
              <span
                className="text-xs font-mono font-semibold w-14 text-right flex-shrink-0"
                style={{
                  color: prob >= 0.7 ? "#50c878" : prob >= 0.4 ? "var(--color-accent)" : "var(--color-muted)",
                }}
              >
                {pct}
              </span>
            </div>
            {/* Probability bar */}
            <div
              className="ml-4 h-1 rounded-full overflow-hidden"
              style={{ backgroundColor: "var(--color-border)" }}
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: `${prob * 100}%`,
                  backgroundColor: prob >= 0.7 ? "#50c878" : prob >= 0.4 ? "var(--color-accent)" : "var(--color-muted)",
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
