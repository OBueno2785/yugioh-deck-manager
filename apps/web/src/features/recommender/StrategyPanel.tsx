import type { DeckAnalysis } from "@/lib/recommenderApi";

const STYLE_COLOR: Record<string, string> = {
  combo:    "#c89b3c",
  control:  "#7070d0",
  midrange: "#50c878",
  turbo:    "#e05050",
  stun:     "#a070a0",
  grind:    "#708090",
};

const CONSISTENCY_COLOR: Record<string, string> = {
  "Low":       "#e05050",
  "Medium":    "#c89b3c",
  "High":      "#50c878",
  "Very High": "#40e0a0",
};

export function StrategyPanel({ analysis }: { analysis: DeckAnalysis }) {
  const profile = analysis.deck_profile;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Profile badges */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        <Badge
          label="Style"
          value={profile.style}
          color={STYLE_COLOR[profile.style] ?? "var(--color-muted)"}
        />
        <Badge
          label="Going First"
          value={profile.going_first_priority ? "Preferred" : "Flexible"}
          color={profile.going_first_priority ? "#c89b3c" : "var(--color-muted)"}
        />
        <Badge
          label="Consistency"
          value={profile.consistency_rating}
          color={CONSISTENCY_COLOR[profile.consistency_rating] ?? "var(--color-muted)"}
        />
      </div>

      {/* Ceiling */}
      <div style={{ padding: "10px 14px", borderRadius: 6, backgroundColor: "var(--color-bg)", border: "1px solid var(--color-border)" }}>
        <span style={{ fontSize: 11, color: "var(--color-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Ceiling</span>
        <p style={{ margin: "4px 0 0", fontSize: 14, color: "var(--color-text)" }}>{profile.ceiling}</p>
      </div>

      {/* Strategy overview */}
      <div>
        <h3 style={{ margin: "0 0 10px", fontSize: 14, color: "var(--color-accent)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Strategy Overview
        </h3>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.7, color: "var(--color-text)", whiteSpace: "pre-wrap" }}>
          {analysis.strategy_overview}
        </p>
      </div>

      {/* Key cards */}
      {analysis.key_cards.length > 0 && (
        <div>
          <h3 style={{ margin: "0 0 10px", fontSize: 14, color: "var(--color-accent)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Key Cards
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {analysis.key_cards.map((kc) => (
              <div
                key={kc.name}
                style={{ padding: "10px 14px", borderRadius: 6, backgroundColor: "var(--color-bg)", border: "1px solid var(--color-border)" }}
              >
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
                  <span style={{ fontWeight: 600, fontSize: 14, color: "var(--color-text)" }}>{kc.name}</span>
                  <span style={{ fontSize: 12, color: "var(--color-muted)", textTransform: "uppercase" }}>{kc.role}</span>
                </div>
                <p style={{ margin: 0, fontSize: 13, color: "var(--color-muted)", lineHeight: 1.5 }}>{kc.why_essential}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Badge({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 11, color: "var(--color-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color, padding: "2px 8px", borderRadius: 4, border: `1px solid ${color}33`, backgroundColor: `${color}18` }}>
        {value}
      </span>
    </div>
  );
}
