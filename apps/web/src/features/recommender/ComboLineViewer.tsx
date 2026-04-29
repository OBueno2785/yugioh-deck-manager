import { useState } from "react";
import type { CSSProperties } from "react";
import type { LlmComboLine, AlgoComboPath } from "@/lib/recommenderApi";

const DIFFICULTY_COLOR: Record<string, string> = {
  "1-card":  "#50c878",
  "2-card":  "#c89b3c",
  "3-card":  "#e05050",
};

const ACTION_LABEL: Record<string, string> = {
  searches:         "searches",
  special_summons:  "special summons",
  mills:            "sends to GY",
  banishes:         "banishes",
  gy_trigger:       "triggers from GY",
  summon_trigger:   "triggers on summon",
  fuses_with:       "fuses with",
  returns_to_hand:  "returns to hand",
  synchro_summons:  "synchro summons",
  xyz_summons:      "xyz summons",
  link_summons:     "link summons",
  tributes:         "tributes",
  equips:           "equips",
  draws:            "draws",
};

const ZONE_STYLE: Record<string, { label: string; color: string }> = {
  field:    { label: "Field",    color: "#50c878" },
  gy:       { label: "GY",       color: "#c07070" },
  hand:     { label: "Hand",     color: "#c89b3c" },
  banished: { label: "Banished", color: "#a070c0" },
  deck:     { label: "Deck",     color: "#7090c0" },
};

// ─── LLM-narrated combo lines ─────────────────────────────────────────────────

export function LlmComboLineViewer({ lines }: { lines: LlmComboLine[] }) {
  const [open, setOpen] = useState<number>(0);
  if (lines.length === 0) return <Empty message="No combo lines narrated." />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {lines.map((line, i) => (
        <div key={i} style={{ borderRadius: 8, border: "1px solid var(--color-border)", overflow: "hidden" }}>
          <button onClick={() => setOpen(open === i ? -1 : i)} style={headerBtn}>
            <DifficultyBadge difficulty={line.difficulty} />
            <span style={{ fontWeight: 600, fontSize: 14, color: "var(--color-text)", flex: 1 }}>{line.name}</span>
            <span style={{ fontSize: 12, color: "var(--color-muted)" }}>Need: {line.hand_requirement}</span>
            <Chevron open={open === i} />
          </button>

          {open === i && (
            <div style={{ padding: "14px 16px", backgroundColor: "var(--color-bg)", display: "flex", flexDirection: "column", gap: 10 }}>
              {line.steps.map((step) => (
                <div key={step.step} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <StepNum n={step.step} />
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 700, fontSize: 13, color: "var(--color-accent)" }}>{step.card}</span>
                      <span style={{ fontSize: 12, color: "var(--color-muted)" }}>— {step.action}</span>
                    </div>
                    <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--color-text)", lineHeight: 1.55 }}>
                      <span style={{ color: "var(--color-muted)" }}>Effect: </span>{step.effect}
                    </p>
                    <p style={{ margin: "2px 0 0", fontSize: 12, color: "#50c87899", lineHeight: 1.4 }}>
                      → {step.result}
                    </p>
                  </div>
                </div>
              ))}
              <EndBoard label={line.end_board} />
              {line.interaction_points && line.interaction_points.length > 0 && (
                <InterruptWarnings points={line.interaction_points} />
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Algorithmic paths ────────────────────────────────────────────────────────

export function AlgoComboPathViewer({ paths }: { paths: AlgoComboPath[] }) {
  const [open, setOpen] = useState<number>(0);
  if (paths.length === 0) return <Empty message="No combo paths detected for this deck." />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {paths.map((path, i) => (
        <div key={i} style={{ borderRadius: 8, border: "1px solid var(--color-border)", overflow: "hidden" }}>
          {/* Header */}
          <button onClick={() => setOpen(open === i ? -1 : i)} style={headerBtn}>
            <DifficultyBadge difficulty={path.difficulty} />
            <div style={{ flex: 1, textAlign: "left" }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text)" }}>
                {path.starters.map((s) => s.name).join(" + ")}
              </span>
              <span style={{ fontSize: 11, color: "var(--color-muted)", marginLeft: 8 }}>
                {path.steps.length} steps
              </span>
            </div>
            <BoardPills field={path.result.fieldMonsters ?? []} gy={path.result.gyCards ?? []} compact />
            <Chevron open={open === i} />
          </button>

          {open === i && (
            <div style={{ padding: "14px 16px", backgroundColor: "var(--color-bg)", display: "flex", flexDirection: "column", gap: 0 }}>
              {/* Chain flow */}
              {path.steps.map((step, j) => (
                <div key={j}>
                  {/* Step row */}
                  <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "6px 0" }}>
                    <StepNum n={j + 1} />
                    <div style={{ flex: 1, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                      <CardChip name={step.card} highlight />
                      <ActionArrow label={ACTION_LABEL[step.action] ?? step.action} />
                      {step.target && <CardChip name={step.target} />}
                    </div>
                    <ZoneBadge zone={step.zoneAfter} />
                  </div>
                  {/* Connector line between steps */}
                  {j < path.steps.length - 1 && (
                    <div style={{ marginLeft: 11, width: 1, height: 8, backgroundColor: "var(--color-border)" }} />
                  )}
                </div>
              ))}

              {/* Board state */}
              {(() => {
                const field = path.result.fieldMonsters ?? [];
                const gy = path.result.gyCards ?? [];
                if (field.length === 0 && gy.length === 0) return null;
                return (
                  <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 6, backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)" }}>
                    <p style={{ margin: "0 0 8px", fontSize: 11, color: "var(--color-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      End Board
                    </p>
                    <BoardPills field={field} gy={gy} />
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Shared sub-components ────────────────────────────────────────────────────

function DifficultyBadge({ difficulty }: { difficulty: string }) {
  const color = DIFFICULTY_COLOR[difficulty] ?? "var(--color-muted)";
  return (
    <span style={{ fontSize: 11, fontWeight: 700, color, border: `1px solid ${color}`, borderRadius: 4, padding: "1px 6px", whiteSpace: "nowrap", flexShrink: 0 }}>
      {difficulty}
    </span>
  );
}

function StepNum({ n }: { n: number }) {
  return (
    <span style={{
      flexShrink: 0, width: 22, height: 22, borderRadius: "50%",
      backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: 11, fontWeight: 700, color: "var(--color-muted)",
    }}>
      {n}
    </span>
  );
}

function CardChip({ name, highlight = false }: { name: string; highlight?: boolean }) {
  return (
    <span style={{
      fontSize: 12, fontWeight: highlight ? 700 : 500,
      color: highlight ? "var(--color-accent)" : "var(--color-text)",
      backgroundColor: "var(--color-surface)",
      border: "1px solid var(--color-border)",
      borderRadius: 5, padding: "2px 8px",
      maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
    }}>
      {name}
    </span>
  );
}

function ActionArrow({ label }: { label: string }) {
  return (
    <span style={{ fontSize: 11, color: "var(--color-muted)", whiteSpace: "nowrap" }}>
      — {label} →
    </span>
  );
}

function ZoneBadge({ zone }: { zone: string }) {
  const z = ZONE_STYLE[zone] ?? { label: zone, color: "var(--color-muted)" };
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, flexShrink: 0,
      color: z.color, border: `1px solid ${z.color}60`,
      borderRadius: 4, padding: "1px 6px",
      backgroundColor: `${z.color}15`,
    }}>
      {z.label}
    </span>
  );
}

function BoardPills({ field, gy, compact = false }: { field: string[]; gy: string[]; compact?: boolean }) {
  if (compact) {
    return (
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        {field.length > 0 && (
          <span style={{ fontSize: 11, color: "#50c878" }}>⬡ {field.length} field</span>
        )}
        {gy.length > 0 && (
          <span style={{ fontSize: 11, color: "#c07070" }}>● {gy.length} GY</span>
        )}
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {field.length > 0 && (
        <div>
          <span style={{ fontSize: 11, color: "#50c878", marginRight: 6 }}>Field</span>
          <span style={{ fontSize: 12, color: "var(--color-text)" }}>{field.join(" · ")}</span>
        </div>
      )}
      {gy.length > 0 && (
        <div>
          <span style={{ fontSize: 11, color: "#c07070", marginRight: 6 }}>GY</span>
          <span style={{ fontSize: 12, color: "var(--color-muted)" }}>{gy.join(" · ")}</span>
        </div>
      )}
    </div>
  );
}

function EndBoard({ label }: { label: string }) {
  return (
    <div style={{ marginTop: 4, padding: "8px 12px", borderRadius: 6, backgroundColor: "var(--color-surface)", borderLeft: "3px solid var(--color-accent)" }}>
      <span style={{ fontSize: 11, color: "var(--color-muted)", textTransform: "uppercase" }}>End Board </span>
      <span style={{ fontSize: 13, color: "var(--color-text)" }}>{label}</span>
    </div>
  );
}

function InterruptWarnings({ points }: { points: string[] }) {
  return (
    <div>
      <p style={{ margin: "0 0 4px", fontSize: 11, color: "var(--color-muted)", textTransform: "uppercase" }}>Interrupt Points</p>
      <ul style={{ margin: 0, paddingLeft: 16 }}>
        {points.map((pt, j) => (
          <li key={j} style={{ fontSize: 12, color: "#e0505099", marginBottom: 2 }}>{pt}</li>
        ))}
      </ul>
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return <span style={{ color: "var(--color-muted)", fontSize: 11, flexShrink: 0 }}>{open ? "▲" : "▼"}</span>;
}

function Empty({ message }: { message: string }) {
  return <p style={{ color: "var(--color-muted)", fontSize: 14, textAlign: "center", padding: "20px 0" }}>{message}</p>;
}

const headerBtn: CSSProperties = {
  width: "100%", textAlign: "left", padding: "10px 14px",
  backgroundColor: "var(--color-surface)", border: "none", cursor: "pointer",
  display: "flex", alignItems: "center", gap: 10,
};
