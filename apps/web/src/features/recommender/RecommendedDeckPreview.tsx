import { useDeckStore } from "@/store/deckStore";
import type { RecommendedCard, DeckAnalysis } from "@/lib/recommenderApi";

interface Props {
  recommendations: RecommendedCard[];
  analysis: DeckAnalysis | null;
  cardObjects: Map<number, import("@yugioh/core").Card>;
}

export function RecommendedDeckPreview({ recommendations, analysis, cardObjects }: Props) {
  const addCard = useDeckStore((s) => s.addCard);
  const deckMain = useDeckStore((s) => s.main);
  const deckExtra = useDeckStore((s) => s.extra);

  const inDeck = new Set([
    ...deckMain.map((dc) => dc.card.id),
    ...deckExtra.map((dc) => dc.card.id),
  ]);

  const maxScore = recommendations[0]?.score ?? 1;

  // Build an LLM explanation map if available
  const llmMap = new Map<string, { why_include: string; how_many: string }>();
  if (analysis?.recommendations_explanation) {
    for (const r of analysis.recommendations_explanation) {
      llmMap.set(r.card_name.toLowerCase(), r);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {recommendations.map((rec) => {
        const card = cardObjects.get(rec.id);
        const llm = llmMap.get(rec.name.toLowerCase());
        const alreadyIn = inDeck.has(rec.id);

        return (
          <div
            key={rec.id}
            style={{
              padding: "12px 14px",
              borderRadius: 8,
              backgroundColor: "var(--color-bg)",
              border: "1px solid var(--color-border)",
              opacity: alreadyIn ? 0.5 : 1,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: 14, color: "var(--color-text)" }}>{rec.name}</span>
                  {rec.archetype && (
                    <span style={{ fontSize: 11, color: "var(--color-muted)" }}>{rec.archetype}</span>
                  )}
                </div>
                <span style={{ fontSize: 11, color: "var(--color-muted)" }}>{rec.type}</span>
              </div>

              <ScoreBar score={rec.score} maxScore={maxScore} />

              {llm && (
                <span style={{
                  fontSize: 11, color: "var(--color-accent)",
                  border: "1px solid var(--color-accent)",
                  borderRadius: 4, padding: "1px 6px", whiteSpace: "nowrap",
                }}>
                  {llm.how_many}×
                </span>
              )}

              <button
                disabled={alreadyIn || !card}
                onClick={() => card && addCard(card)}
                style={{
                  padding: "4px 12px", borderRadius: 6, fontSize: 12, fontWeight: 600,
                  cursor: alreadyIn || !card ? "not-allowed" : "pointer",
                  backgroundColor: alreadyIn ? "var(--color-border)" : "var(--color-accent)",
                  color: alreadyIn ? "var(--color-muted)" : "#0f0f13",
                  border: "none",
                  transition: "opacity 0.15s",
                }}
              >
                {alreadyIn ? "In Deck" : "+ Add"}
              </button>
            </div>

            {/* Reason / LLM explanation */}
            <p style={{ margin: 0, fontSize: 12, color: "var(--color-muted)", lineHeight: 1.5 }}>
              {llm?.why_include ?? rec.reason}
            </p>

            {/* Signal bars */}
            <div style={{ display: "flex", gap: 16, marginTop: 6 }}>
              <Signal label="Co-occur" value={rec.signals.coOccurrence} />
              <Signal label="Archetype" value={rec.signals.archetype} />
              <Signal label="Role gap" value={rec.signals.roleGap} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ScoreBar({ score, maxScore }: { score: number; maxScore: number }) {
  const pct = Math.round((score / maxScore) * 100);
  const color = pct >= 70 ? "#50c878" : pct >= 40 ? "#c89b3c" : "var(--color-muted)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ width: 60, height: 5, borderRadius: 3, backgroundColor: "var(--color-border)", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", backgroundColor: color, borderRadius: 3 }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, color, minWidth: 24 }}>{score}</span>
    </div>
  );
}

function Signal({ label, value }: { label: string; value: number }) {
  const pct = Math.min(100, value);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <span style={{ fontSize: 10, color: "var(--color-muted)", minWidth: 52 }}>{label}</span>
      <div style={{ width: 40, height: 3, borderRadius: 2, backgroundColor: "var(--color-border)", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", backgroundColor: "var(--color-accent)", borderRadius: 2 }} />
      </div>
    </div>
  );
}
