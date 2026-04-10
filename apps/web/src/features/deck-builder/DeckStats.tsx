import { useMemo } from "react";
import type { LabeledDeckCard } from "@yugioh/core";

interface DeckStatsProps {
  main: LabeledDeckCard[];
  extra: LabeledDeckCard[];
  side: LabeledDeckCard[];
}

function StatBar({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div>
      <div className="flex justify-between text-xs mb-0.5" style={{ color: "var(--color-muted)" }}>
        <span>{label}</span>
        <span>{count}</span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: "var(--color-border)" }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

export function DeckStats({ main }: DeckStatsProps) {
  const stats = useMemo(() => {
    const total = main.reduce((s, c) => s + c.quantity, 0);
    const monsters = main.filter((c) => c.card.type.toLowerCase().includes("monster")).reduce((s, c) => s + c.quantity, 0);
    const spells = main.filter((c) => c.card.type === "Spell Card").reduce((s, c) => s + c.quantity, 0);
    const traps = main.filter((c) => c.card.type === "Trap Card").reduce((s, c) => s + c.quantity, 0);
    const starters = main.filter((c) => c.role === "starter").reduce((s, c) => s + c.quantity, 0);
    const handtraps = main.filter((c) => c.role === "handtrap").reduce((s, c) => s + c.quantity, 0);
    return { total, monsters, spells, traps, starters, handtraps };
  }, [main]);

  return (
    <div className="p-3 rounded-lg space-y-2" style={{ backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)" }}>
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--color-muted)" }}>
          Main Deck
        </span>
        <span
          className="text-sm font-mono font-bold"
          style={{ color: stats.total < 40 || stats.total > 60 ? "var(--color-danger)" : "var(--color-accent)" }}
        >
          {stats.total}
        </span>
      </div>
      <StatBar label="Monsters" count={stats.monsters} total={stats.total} color="#4da6ff" />
      <StatBar label="Spells"   count={stats.spells}   total={stats.total} color="#50c878" />
      <StatBar label="Traps"    count={stats.traps}    total={stats.total} color="#c878c8" />
      {stats.starters > 0 && (
        <StatBar label="Starters"  count={stats.starters}  total={stats.total} color="#50c878" />
      )}
      {stats.handtraps > 0 && (
        <StatBar label="Handtraps" count={stats.handtraps} total={stats.total} color="#c878c8" />
      )}
    </div>
  );
}
