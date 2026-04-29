import { useState } from "react";
import { useDeckStore } from "@/store/deckStore";
import type { AlgoBridge, AlgoBridgeCard, BridgeAnalysis, SummonPath } from "@/lib/recommenderApi";
import type { Card } from "@yugioh/core";

const VERDICT_COLOR: Record<string, string> = {
  "Natural Splash":    "#50c878",
  "Engineered Bridge": "#c89b3c",
  "Forced":            "#e05050",
  "Incompatible":      "#7070a0",
};

// ─── Intra-deck bridges (multiple pairs) ─────────────────────────────────────

export function IntraBridgePanel({ bridges }: { bridges: AlgoBridge[] }) {
  const [active, setActive] = useState(0);
  if (bridges.length === 0) {
    return (
      <p style={{ color: "var(--color-muted)", fontSize: 14, textAlign: "center", padding: "20px 0" }}>
        The deck needs at least 2 archetypes with ≥2 cards each for intra-bridge analysis.
      </p>
    );
  }

  const current = bridges[active];
  if (!current) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Pair selector tabs */}
      {bridges.length > 1 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {bridges.map((b, i) => (
            <button
              key={i}
              onClick={() => setActive(i)}
              style={{
                padding: "5px 12px", borderRadius: 6, fontSize: 12, fontWeight: 600,
                border: "1px solid var(--color-border)", cursor: "pointer",
                backgroundColor: active === i ? "var(--color-accent)" : "var(--color-bg)",
                color: active === i ? "#0f0f13" : "var(--color-muted)",
              }}
            >
              {b.archetypeA} ↔ {b.archetypeB}
            </button>
          ))}
        </div>
      )}

      <BridgeDetail bridge={current} analysis={null} />
    </div>
  );
}

// ─── Single bridge detail (used by both intra and external) ──────────────────

interface BridgePanelProps {
  bridge: AlgoBridge;
  analysis: BridgeAnalysis | null;
}

export function BridgePanel({ bridge, analysis }: BridgePanelProps) {
  return <BridgeDetail bridge={bridge} analysis={analysis} />;
}

function BridgeDetail({ bridge, analysis }: { bridge: AlgoBridge; analysis: BridgeAnalysis | null }) {
  const verdictColor = VERDICT_COLOR[bridge.verdict] ?? "var(--color-muted)";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <ArchBadge name={bridge.archetypeA ?? "Archetype A"} primary />
          <span style={{ color: "var(--color-muted)", fontSize: 14 }}>↔</span>
          <ArchBadge name={bridge.archetypeB} />
        </div>
        <span style={{
          fontWeight: 700, fontSize: 13, color: verdictColor,
          border: `1px solid ${verdictColor}`, padding: "2px 10px",
          borderRadius: 4, backgroundColor: `${verdictColor}18`,
        }}>
          {bridge.verdict}
        </span>
        <SynergyBar score={bridge.naturalSynergyScore} />
      </div>

      {/* LLM summary */}
      {analysis && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.7, color: "var(--color-text)" }}>
            {analysis.compatibility_summary}
          </p>
          <div style={{ padding: "10px 14px", borderRadius: 6, backgroundColor: "var(--color-bg)", border: "1px solid var(--color-border)", borderLeft: "3px solid var(--color-accent)" }}>
            <span style={{ fontSize: 11, color: "var(--color-muted)", textTransform: "uppercase" }}>Why it works </span>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--color-text)", lineHeight: 1.6 }}>{analysis.why_it_works}</p>
          </div>
        </div>
      )}

      {/* Profile comparison */}
      {bridge.profileA && bridge.profileB && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <ProfileCard title={bridge.archetypeA ?? bridge.archetypeB} provides={bridge.profileA.provides} needs={bridge.profileA.needs} />
          <ProfileCard title={bridge.archetypeB} provides={bridge.profileB.provides} needs={bridge.profileB.needs} />
        </div>
      )}

      {/* Gap */}
      {(bridge.gap?.length ?? 0) > 0 && (
        <div>
          <p style={{ margin: "0 0 6px", fontSize: 11, color: "var(--color-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Resource Gap — what {bridge.archetypeB} needs that {bridge.archetypeA ?? "archetype A"} doesn't cover
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {(bridge.gap ?? []).map((g) => (
              <span key={g} style={{ fontSize: 12, color: "#e05050", border: "1px solid #e0505060", borderRadius: 4, padding: "2px 8px" }}>{g}</span>
            ))}
          </div>
        </div>
      )}

      {/* Summon Paths */}
      {(bridge.summonPaths?.length ?? 0) > 0 && (
        <SummonPathsSection
          paths={bridge.summonPaths}
          archetypeA={bridge.archetypeA ?? "your engine"}
          archetypeB={bridge.archetypeB}
        />
      )}

      {/* Bridge cards */}
      {bridge.bridgeCards.length > 0
        ? (
          <div>
            <h3 style={{ margin: "0 0 10px", fontSize: 13, color: "var(--color-accent)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Add these cards to bridge {bridge.archetypeA ?? "A"} ↔ {bridge.archetypeB}
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {bridge.bridgeCards.map((bc) => {
                const llmCard = analysis?.bridge_card_explanations.find(
                  (e) => e.card_name.toLowerCase() === bc.name.toLowerCase()
                );
                return (
                  <BridgeCardRow key={bc.id} bc={bc} llmExplanation={llmCard?.specific_interaction} llmExample={llmCard?.example_line} />
                );
              })}
            </div>
          </div>
        )
        : bridge.verdict === "Natural Splash" && (
          <div style={{ padding: "12px 14px", borderRadius: 8, backgroundColor: "var(--color-bg)", border: "1px solid #50c87860", borderLeft: "3px solid #50c878" }}>
            <p style={{ margin: 0, fontSize: 13, color: "#50c878" }}>
              These archetypes work naturally together — no dedicated bridge cards needed. You can freely mix them without extra support.
            </p>
          </div>
        )
      }

      {/* LLM combined combo */}
      {analysis?.combined_combo_line && (
        <div>
          <h3 style={{ margin: "0 0 10px", fontSize: 13, color: "var(--color-accent)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Combined Combo — {analysis.combined_combo_line.name}
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {analysis.combined_combo_line.steps.map((step) => (
              <div key={step.step} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <StepNum n={step.step} />
                <div>
                  <span style={{ fontWeight: 600, fontSize: 13, color: "var(--color-accent)" }}>{step.card}</span>
                  <span style={{ fontSize: 12, color: "var(--color-muted)" }}> — {step.action}</span>
                  <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--color-text)", lineHeight: 1.5 }}>{step.result}</p>
                </div>
              </div>
            ))}
            <div style={{ marginTop: 6, padding: "8px 12px", borderRadius: 6, backgroundColor: "var(--color-surface)", borderLeft: "3px solid var(--color-accent)" }}>
              <span style={{ fontSize: 11, color: "var(--color-muted)", textTransform: "uppercase" }}>End Board </span>
              <span style={{ fontSize: 13, color: "var(--color-text)" }}>{analysis.combined_combo_line.end_board}</span>
            </div>
          </div>
        </div>
      )}

      {analysis?.deck_building_notes && (
        <div style={{ padding: "10px 14px", borderRadius: 6, backgroundColor: "var(--color-bg)", border: "1px solid var(--color-border)" }}>
          <p style={{ margin: "0 0 4px", fontSize: 11, color: "var(--color-muted)", textTransform: "uppercase" }}>Deck Building Notes</p>
          <p style={{ margin: 0, fontSize: 13, color: "var(--color-text)", lineHeight: 1.6 }}>{analysis.deck_building_notes}</p>
        </div>
      )}
    </div>
  );
}

// ─── Summon paths section ─────────────────────────────────────────────────────

const METHOD_COLOR: Record<string, string> = {
  Fusion:  "#c89b3c",
  Synchro: "#e8e8e8",
  Xyz:     "#a070c0",
  Link:    "#4090e0",
};

function SummonPathsSection({ paths, archetypeA, archetypeB }: { paths: SummonPath[]; archetypeA: string; archetypeB: string }) {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <div>
      <h3 style={{ margin: "0 0 10px", fontSize: 13, color: "var(--color-accent)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        How to Summon {archetypeB} monsters using {archetypeA}
      </h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {paths.map((path, i) => {
          const isOpen = open === i;
          const color = METHOD_COLOR[path.summonMethod] ?? "var(--color-muted)";
          const allMet = path.materialMatches.every((m) => m.isFullyMet) && path.additionalNeeded.length === 0;

          return (
            <div key={path.target.id} style={{ borderRadius: 8, border: `1px solid ${allMet ? "#50c87860" : "var(--color-border)"}`, overflow: "hidden" }}>
              {/* Header */}
              <button
                onClick={() => setOpen(isOpen ? null : i)}
                style={{ width: "100%", textAlign: "left", padding: "10px 14px", backgroundColor: "var(--color-surface)", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 10 }}
              >
                {/* Method badge */}
                <span style={{ fontSize: 11, fontWeight: 700, color, border: `1px solid ${color}`, borderRadius: 4, padding: "1px 6px", flexShrink: 0 }}>
                  {path.summonMethod}
                </span>

                <div style={{ flex: 1, textAlign: "left" }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text)" }}>{path.target.name}</span>
                  {path.target.level && (
                    <span style={{ fontSize: 11, color: "var(--color-muted)", marginLeft: 6 }}>
                      {path.summonMethod === "Link" ? `Link-${path.target.linkval}` : `Lv.${path.target.level}`}
                    </span>
                  )}
                </div>

                {/* Achievability bar */}
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <div style={{ width: 50, height: 4, borderRadius: 2, backgroundColor: "var(--color-border)", overflow: "hidden" }}>
                    <div style={{
                      width: `${path.achievabilityScore}%`, height: "100%", borderRadius: 2,
                      backgroundColor: path.achievabilityScore >= 70 ? "#50c878" : path.achievabilityScore >= 40 ? "#c89b3c" : "#e05050",
                    }} />
                  </div>
                  <span style={{ fontSize: 10, color: "var(--color-muted)", minWidth: 28 }}>{path.achievabilityScore}%</span>
                </div>

                {allMet && <span style={{ fontSize: 10, color: "#50c878", fontWeight: 700 }}>✓ READY</span>}
                <span style={{ fontSize: 11, color: "var(--color-muted)" }}>{isOpen ? "▲" : "▼"}</span>
              </button>

              {isOpen && (
                <div style={{ padding: "12px 14px", backgroundColor: "var(--color-bg)", display: "flex", flexDirection: "column", gap: 12 }}>
                  {/* Summary */}
                  <p style={{ margin: 0, fontSize: 13, color: "var(--color-text)", lineHeight: 1.6 }}>{path.summary}</p>

                  {/* Material requirements */}
                  <div>
                    <p style={{ margin: "0 0 6px", fontSize: 11, color: "var(--color-muted)", textTransform: "uppercase" }}>Materials</p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {path.materialMatches.map((mm, j) => (
                        <div key={j} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                          <span style={{ fontSize: 12, flexShrink: 0, color: mm.isFullyMet ? "#50c878" : "#e05050" }}>
                            {mm.isFullyMet ? "✓" : "✗"}
                          </span>
                          <div style={{ flex: 1 }}>
                            <span style={{ fontSize: 12, color: "var(--color-muted)" }}>{mm.req.raw}</span>
                            {mm.isFullyMet && mm.matchedCards.length > 0 && (
                              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 3 }}>
                                {mm.matchedCards.map((c) => (
                                  <span key={c.id} style={{ fontSize: 11, color: "var(--color-accent)", backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 4, padding: "1px 7px" }}>
                                    {c.name}
                                  </span>
                                ))}
                              </div>
                            )}
                            {!mm.isFullyMet && (
                              <p style={{ margin: "2px 0 0", fontSize: 11, color: "#e05050" }}>{mm.missingDescription}</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Additional needed */}
                  {path.additionalNeeded.length > 0 && (
                    <div>
                      <p style={{ margin: "0 0 6px", fontSize: 11, color: "#c89b3c", textTransform: "uppercase" }}>Also needed</p>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {path.additionalNeeded.map((need, k) => (
                          <div key={k} style={{ padding: "8px 10px", borderRadius: 6, backgroundColor: "var(--color-surface)", borderLeft: "3px solid #c89b3c" }}>
                            <p style={{ margin: "0 0 4px", fontSize: 12, color: "#c89b3c" }}>{need.description}</p>
                            {need.suggestedCards.length > 0 && (
                              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                                <span style={{ fontSize: 11, color: "var(--color-muted)" }}>Suggested: </span>
                                {need.suggestedCards.map((c) => (
                                  <span key={c.id} style={{ fontSize: 11, color: "var(--color-text)", backgroundColor: "var(--color-bg)", border: "1px solid var(--color-border)", borderRadius: 4, padding: "1px 7px" }}>
                                    {c.name}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Bridge card row ──────────────────────────────────────────────────────────

const ROLE_LABEL: Record<string, string> = {
  shared_engine:  "Shared Engine",
  extender:       "Extender",
  boss_enabler:   "Boss Enabler",
  material_bridge:"Material Bridge",
  gy_connector:   "GY Connector",
  search_bridge:  "Search Bridge",
};

const NEED_LABEL: Record<string, string> = {
  gy_setup:        "GY Setup",
  search:          "Search",
  special_summon:  "Special Summon",
  banish:          "Banish",
  hand_advantage:  "Hand +",
  level2:          "Lv2 Body",
  light_monsters:  "LIGHT",
  dark_monsters:   "DARK",
  dragon_monsters: "Dragon",
  fusion_material: "Fusion Material",
  synchro_material:"Synchro Material",
  link_material:   "Link Material",
  xyz_material:    "Xyz Material",
  omni_negate:     "Omni-Negate",
};

function BridgeCardRow({
  bc,
  llmExplanation,
  llmExample,
}: {
  bc: AlgoBridgeCard;
  llmExplanation?: string;
  llmExample?: string;
}) {
  const addCard = useDeckStore((s) => s.addCard);
  const deckMain = useDeckStore((s) => s.main);
  const deckExtra = useDeckStore((s) => s.extra);
  const [showDesc, setShowDesc] = useState(false);

  const inDeck = deckMain.some((dc) => dc.card.id === bc.id) || deckExtra.some((dc) => dc.card.id === bc.id);

  function handleAdd() {
    // Reconstruct a minimal Card object from the bridge card data
    const card: Card = {
      id: bc.id,
      name: bc.name,
      type: bc.type,
      ...(bc.archetype !== undefined ? { archetype: bc.archetype } : {}),
      ...(bc.race !== undefined ? { race: bc.race } : {}),
      ...(bc.attribute !== undefined ? { attribute: bc.attribute } : {}),
      ...(bc.atk !== undefined ? { atk: bc.atk } : {}),
      ...(bc.def !== undefined ? { def: bc.def } : {}),
      ...(bc.level !== undefined ? { level: bc.level } : {}),
      ...(bc.desc !== undefined ? { desc: bc.desc } : {}),
    };
    addCard(card);
  }

  return (
    <div style={{ borderRadius: 8, border: "1px solid var(--color-border)", overflow: "hidden" }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", backgroundColor: "var(--color-surface)" }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontWeight: 700, fontSize: 14, color: "var(--color-text)" }}>{bc.name}</span>
            <span style={{ fontSize: 11, color: "var(--color-muted)", textTransform: "uppercase" }}>
              {ROLE_LABEL[bc.role] ?? bc.role}
            </span>
          </div>
          <span style={{ fontSize: 11, color: "var(--color-muted)" }}>{bc.type}{bc.archetype ? ` · ${bc.archetype}` : ""}</span>
        </div>

        {/* Copies badge */}
        <span style={{ fontSize: 13, fontWeight: 800, color: "var(--color-accent)", minWidth: 24, textAlign: "center" }}>
          {bc.recommendedCopies}×
        </span>

        {/* Score bar */}
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <div style={{ width: 50, height: 4, borderRadius: 2, backgroundColor: "var(--color-border)", overflow: "hidden" }}>
            <div style={{ width: `${Math.min(100, bc.synergyScore)}%`, height: "100%", backgroundColor: "var(--color-accent)", borderRadius: 2 }} />
          </div>
          <span style={{ fontSize: 10, color: "var(--color-muted)", minWidth: 22 }}>{bc.synergyScore}</span>
        </div>

        {/* Add button */}
        <button
          onClick={handleAdd}
          disabled={inDeck}
          style={{
            padding: "4px 12px", borderRadius: 5, fontSize: 12, fontWeight: 600, border: "none",
            cursor: inDeck ? "not-allowed" : "pointer",
            backgroundColor: inDeck ? "var(--color-border)" : "var(--color-accent)",
            color: inDeck ? "var(--color-muted)" : "#0f0f13",
          }}
        >
          {inDeck ? "In Deck" : "+ Add"}
        </button>
      </div>

      {/* Needs filled */}
      <div style={{ padding: "8px 14px", backgroundColor: "var(--color-bg)", display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "var(--color-muted)", marginRight: 4 }}>Fills:</span>
          {bc.filledNeeds.map((n) => (
            <span key={n} style={{ fontSize: 11, color: "#50c878", border: "1px solid #50c87850", borderRadius: 4, padding: "1px 7px", backgroundColor: "#50c87810" }}>
              {NEED_LABEL[n] ?? n}
            </span>
          ))}
        </div>

        {/* Explanation */}
        <p style={{ margin: 0, fontSize: 13, color: "var(--color-text)", lineHeight: 1.6 }}>
          {llmExplanation ?? bc.explanation}
        </p>

        {llmExample && (
          <p style={{ margin: 0, fontSize: 12, color: "var(--color-muted)", lineHeight: 1.5, fontStyle: "italic" }}>
            "{llmExample}"
          </p>
        )}

        {/* Card effect toggle */}
        {bc.desc && (
          <div>
            <button
              onClick={() => setShowDesc((v) => !v)}
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11, color: "var(--color-muted)", padding: 0, textDecoration: "underline" }}
            >
              {showDesc ? "Hide card text" : "Show card text"}
            </button>
            {showDesc && (
              <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--color-muted)", lineHeight: 1.6, fontStyle: "italic" }}>
                {bc.desc}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ArchBadge({ name, primary = false }: { name: string; primary?: boolean }) {
  return (
    <span style={{
      fontSize: 13, fontWeight: 700,
      color: primary ? "var(--color-accent)" : "var(--color-text)",
      padding: "3px 10px", borderRadius: 6,
      border: `1px solid ${primary ? "var(--color-accent)" : "var(--color-border)"}`,
      backgroundColor: primary ? "var(--color-accent)18" : "var(--color-bg)",
    }}>
      {name}
    </span>
  );
}

function ProfileCard({ title, provides, needs }: { title: string; provides: string[]; needs: string[] }) {
  return (
    <div style={{ padding: "10px 12px", borderRadius: 8, backgroundColor: "var(--color-bg)", border: "1px solid var(--color-border)" }}>
      <p style={{ margin: "0 0 8px", fontSize: 12, fontWeight: 700, color: "var(--color-text)" }}>{title}</p>
      {provides.length > 0 && (
        <div style={{ marginBottom: 6 }}>
          <span style={{ fontSize: 10, color: "#50c878", textTransform: "uppercase", display: "block", marginBottom: 3 }}>Provides</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {provides.slice(0, 4).map((p) => (
              <span key={p} style={{ fontSize: 10, color: "#50c878", border: "1px solid #50c87840", borderRadius: 3, padding: "1px 5px" }}>{p}</span>
            ))}
          </div>
        </div>
      )}
      {needs.length > 0 && (
        <div>
          <span style={{ fontSize: 10, color: "#e05050", textTransform: "uppercase", display: "block", marginBottom: 3 }}>Needs</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {needs.slice(0, 4).map((n) => (
              <span key={n} style={{ fontSize: 10, color: "#e05050", border: "1px solid #e0505040", borderRadius: 3, padding: "1px 5px" }}>{n}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SynergyBar({ score }: { score: number }) {
  const color = score >= 80 ? "#50c878" : score >= 50 ? "#c89b3c" : "#e05050";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ width: 80, height: 6, borderRadius: 3, backgroundColor: "var(--color-border)", overflow: "hidden" }}>
        <div style={{ width: `${score}%`, height: "100%", backgroundColor: color, borderRadius: 3 }} />
      </div>
      <span style={{ fontSize: 12, color, fontWeight: 700 }}>{score}/100</span>
    </div>
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
