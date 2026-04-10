import type { DeckValidationResult } from "@yugioh/core";

interface LegalityCheckProps {
  validation: DeckValidationResult;
}

export function LegalityCheck({ validation }: LegalityCheckProps) {
  const { valid, errors, warnings } = validation;

  if (errors.length === 0 && warnings.length === 0) {
    return (
      <div
        className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm"
        style={{ backgroundColor: "#1a2a1a", border: "1px solid #2a4a2a", color: "#50c878" }}
      >
        <span>✓</span>
        <span>Deck is legal and valid</span>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {errors.map((msg, i) => (
        <div
          key={i}
          className="flex items-start gap-2 px-3 py-2 rounded-lg text-sm"
          style={{ backgroundColor: "#2a1a1a", border: "1px solid #4a2a2a", color: "var(--color-danger)" }}
        >
          <span className="flex-shrink-0">✗</span>
          <span>{msg}</span>
        </div>
      ))}
      {warnings.map((msg, i) => (
        <div
          key={i}
          className="flex items-start gap-2 px-3 py-2 rounded-lg text-sm"
          style={{ backgroundColor: "#2a2a1a", border: "1px solid #4a4a1a", color: "#c8c850" }}
        >
          <span className="flex-shrink-0">⚠</span>
          <span>{msg}</span>
        </div>
      ))}
      {valid && errors.length === 0 && (
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm"
          style={{ backgroundColor: "#1a2a1a", border: "1px solid #2a4a2a", color: "#50c878" }}
        >
          <span>✓</span>
          <span>Deck is legal (with warnings above)</span>
        </div>
      )}
    </div>
  );
}
