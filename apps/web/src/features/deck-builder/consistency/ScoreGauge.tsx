/**
 * Circular gauge showing the overall consistency score (0–100).
 * Uses SVG with a stroke-dasharray arc technique — no external chart lib needed.
 */

interface ScoreGaugeProps {
  score: number; // 0–100
  size?: number;
}

function scoreColor(score: number): string {
  if (score >= 70) return "#50c878"; // green
  if (score >= 45) return "#c89b3c"; // gold
  return "#e05050";                  // red
}

function scoreLabel(score: number): string {
  if (score >= 80) return "Excellent";
  if (score >= 65) return "Good";
  if (score >= 45) return "Fair";
  if (score >= 25) return "Weak";
  return "Poor";
}

export function ScoreGauge({ score, size = 120 }: ScoreGaugeProps) {
  const r = (size - 16) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;

  // We show a 270° arc (from 135° to 405° / -225°)
  const ARC_FRACTION = 0.75;
  const arcLen = circumference * ARC_FRACTION;
  const filled = (score / 100) * arcLen;
  const gap = arcLen - filled;

  // SVG arc starts at the right (0°); we rotate so it starts bottom-left
  const rotation = 135;

  const color = scoreColor(score);

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Track */}
        <circle
          cx={cx} cy={cy} r={r}
          fill="none"
          stroke="var(--color-border)"
          strokeWidth={8}
          strokeDasharray={`${arcLen} ${circumference - arcLen}`}
          strokeDashoffset={0}
          strokeLinecap="round"
          transform={`rotate(${rotation} ${cx} ${cy})`}
        />
        {/* Fill */}
        <circle
          cx={cx} cy={cy} r={r}
          fill="none"
          stroke={color}
          strokeWidth={8}
          strokeDasharray={`${filled} ${gap + (circumference - arcLen)}`}
          strokeDashoffset={0}
          strokeLinecap="round"
          transform={`rotate(${rotation} ${cx} ${cy})`}
          style={{ transition: "stroke-dasharray 0.6s ease" }}
        />
        {/* Score number */}
        <text
          x={cx} y={cy - 4}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={size * 0.22}
          fontWeight="bold"
          fontFamily="monospace"
          fill={color}
        >
          {score}
        </text>
        {/* Label */}
        <text
          x={cx} y={cy + size * 0.15}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={size * 0.1}
          fill="var(--color-muted)"
        >
          {scoreLabel(score)}
        </text>
      </svg>
      <span className="text-xs" style={{ color: "var(--color-muted)" }}>Consistency Score</span>
    </div>
  );
}
