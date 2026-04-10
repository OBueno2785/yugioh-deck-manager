import { useState } from "react";
import { useDeckPrices, type PriceSrc } from "@/hooks/useDeckPrices";
import type { LabeledDeckCard } from "@yugioh/core";

interface PriceSummaryProps {
  main: LabeledDeckCard[];
  extra: LabeledDeckCard[];
  side: LabeledDeckCard[];
}

function fmt(usd: number): string {
  return usd === 0 ? "—" : `$${usd.toFixed(2)}`;
}

function PriceToggle({ src, onChange }: { src: PriceSrc; onChange: (s: PriceSrc) => void }) {
  return (
    <div className="flex rounded overflow-hidden text-xs font-medium" style={{ border: "1px solid var(--color-border)" }}>
      {(["tcgplayer", "cardmarket"] as PriceSrc[]).map((s) => (
        <button
          key={s}
          className="px-3 py-1 transition-colors"
          style={{
            backgroundColor: src === s ? "var(--color-accent)" : "transparent",
            color: src === s ? "#000" : "var(--color-muted)",
          }}
          onClick={() => onChange(s)}
        >
          {s === "tcgplayer" ? "TCGPlayer" : "Cardmarket"}
        </button>
      ))}
    </div>
  );
}

type SortKey = "name" | "unit" | "total";

export function PriceSummary({ main, extra, side }: PriceSummaryProps) {
  const [src, setSrc] = useState<PriceSrc>("tcgplayer");
  const [sortBy, setSortBy] = useState<SortKey>("total");
  const [sortAsc, setSortAsc] = useState(false);

  const { rows, zones, grandTotalTcg, grandTotalCm, mostExpensive, cheapestAlternatives } =
    useDeckPrices(main, extra, side);

  const grandTotal = src === "tcgplayer" ? grandTotalTcg : grandTotalCm;

  const sorted = [...rows].sort((a, b) => {
    let diff = 0;
    if (sortBy === "name")  diff = a.cardName.localeCompare(b.cardName);
    if (sortBy === "unit")  diff = (src === "tcgplayer" ? a.unitTcg - b.unitTcg : a.unitCm - b.unitCm);
    if (sortBy === "total") diff = (src === "tcgplayer" ? a.totalTcg - b.totalTcg : a.totalCm - b.totalCm);
    return sortAsc ? diff : -diff;
  });

  function toggleSort(key: SortKey) {
    if (sortBy === key) setAsc((v) => !v);
    else { setSortBy(key); setAsc(false); }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  function setAsc(fn: (v: boolean) => boolean) { setSortAsc(fn); }

  const SortIcon = ({ col }: { col: SortKey }) =>
    sortBy === col ? (sortAsc ? " ↑" : " ↓") : "";

  return (
    <div className="flex flex-col gap-4 p-4 overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide" style={{ color: "var(--color-muted)" }}>
            Total deck value
          </div>
          <div className="text-3xl font-bold font-mono" style={{ color: "var(--color-accent)" }}>
            {fmt(grandTotal)}
          </div>
        </div>
        <PriceToggle src={src} onChange={setSrc} />
      </div>

      {/* Zone breakdown */}
      <div className="grid grid-cols-3 gap-2">
        {zones.map((z) => (
          <div
            key={z.label}
            className="rounded-lg p-3 text-center"
            style={{ backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)" }}
          >
            <div className="text-xs mb-1" style={{ color: "var(--color-muted)" }}>{z.label}</div>
            <div className="font-mono font-semibold text-sm" style={{ color: "var(--color-text)" }}>
              {fmt(src === "tcgplayer" ? z.totalTcg : z.totalCm)}
            </div>
            <div className="text-xs" style={{ color: "var(--color-muted)" }}>{z.cardCount} cards</div>
          </div>
        ))}
      </div>

      {/* Savings tip */}
      {cheapestAlternatives.length > 0 && (
        <div
          className="rounded-lg p-3 text-sm"
          style={{ backgroundColor: "#1a2a1a", border: "1px solid #2a4a2a" }}
        >
          <div className="font-semibold mb-1" style={{ color: "#50c878" }}>
            💡 Potential savings on Cardmarket
          </div>
          <div className="space-y-0.5">
            {cheapestAlternatives.slice(0, 3).map((r) => (
              <div key={r.cardId} className="flex justify-between text-xs" style={{ color: "var(--color-muted)" }}>
                <span className="truncate mr-2">{r.cardName}</span>
                <span>
                  <span style={{ color: "var(--color-danger)" }}>${r.unitTcg.toFixed(2)}</span>
                  {" → "}
                  <span style={{ color: "#50c878" }}>${r.unitCm.toFixed(2)}</span>
                </span>
              </div>
            ))}
            {cheapestAlternatives.length > 3 && (
              <div className="text-xs" style={{ color: "var(--color-muted)" }}>
                +{cheapestAlternatives.length - 3} more cards with cheaper CM prices
              </div>
            )}
          </div>
        </div>
      )}

      {/* Most expensive card */}
      {mostExpensive && mostExpensive.unitTcg > 0 && (
        <div className="flex items-center justify-between text-sm" style={{ color: "var(--color-muted)" }}>
          <span>Most expensive: <span style={{ color: "var(--color-text)" }}>{mostExpensive.cardName}</span></span>
          <span className="font-mono" style={{ color: "var(--color-accent)" }}>
            {fmt(src === "tcgplayer" ? mostExpensive.unitTcg : mostExpensive.unitCm)} / copy
          </span>
        </div>
      )}

      {/* Per-card table */}
      {rows.length > 0 && (
        <div>
          <table className="w-full text-xs">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                <th
                  className="text-left py-1.5 pr-2 cursor-pointer select-none"
                  style={{ color: "var(--color-muted)" }}
                  onClick={() => toggleSort("name")}
                >
                  Card<SortIcon col="name" />
                </th>
                <th className="text-center py-1.5 px-2" style={{ color: "var(--color-muted)" }}>Qty</th>
                <th
                  className="text-right py-1.5 px-2 cursor-pointer select-none"
                  style={{ color: "var(--color-muted)" }}
                  onClick={() => toggleSort("unit")}
                >
                  Unit<SortIcon col="unit" />
                </th>
                <th
                  className="text-right py-1.5 pl-2 cursor-pointer select-none"
                  style={{ color: "var(--color-muted)" }}
                  onClick={() => toggleSort("total")}
                >
                  Total<SortIcon col="total" />
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => {
                const unit  = src === "tcgplayer" ? row.unitTcg  : row.unitCm;
                const total = src === "tcgplayer" ? row.totalTcg : row.totalCm;
                return (
                  <tr
                    key={`${row.cardId}-${row.zone}`}
                    className="border-b"
                    style={{ borderColor: "var(--color-border)" }}
                  >
                    <td className="py-1.5 pr-2 truncate max-w-0 w-full" style={{ color: "var(--color-text)" }}>
                      <span className="inline-block max-w-full truncate">{row.cardName}</span>
                      <span className="ml-1 text-xs" style={{ color: "var(--color-muted)" }}>
                        ({row.zone})
                      </span>
                    </td>
                    <td className="text-center py-1.5 px-2" style={{ color: "var(--color-muted)" }}>
                      {row.quantity}
                    </td>
                    <td className="text-right py-1.5 px-2 font-mono" style={{ color: unit > 20 ? "var(--color-danger)" : unit > 5 ? "var(--color-accent)" : "var(--color-muted)" }}>
                      {fmt(unit)}
                    </td>
                    <td className="text-right py-1.5 pl-2 font-mono font-semibold" style={{ color: "var(--color-text)" }}>
                      {fmt(total)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} className="pt-2 text-right text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--color-muted)" }}>
                  Grand Total
                </td>
                <td className="pt-2 pl-2 text-right font-mono font-bold text-sm" style={{ color: "var(--color-accent)" }}>
                  {fmt(grandTotal)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {rows.length === 0 && (
        <div className="text-center py-8 text-sm" style={{ color: "var(--color-muted)" }}>
          Add cards to your deck to see prices.
        </div>
      )}
    </div>
  );
}
