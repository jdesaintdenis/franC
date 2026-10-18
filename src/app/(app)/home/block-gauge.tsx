import { gaugeBlocks, type GaugeSegment } from "@/lib/dashboard/home-lists";
import { cn } from "@/lib/utils";

const TONE = { accent: "bg-primary", warning: "bg-warning", sand: "bg-sand" } as const;
const TONE_VAR = { accent: "var(--primary)", warning: "var(--warning)", sand: "var(--sand)" } as const;

// Regular payments still due: hatched sand with a thin sand edge, so "expected" reads differently from "done".
const DUE_STYLE = {
  background: "repeating-linear-gradient(135deg, var(--sand) 0 2px, transparent 2px 5px)",
  boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--sand) 55%, transparent)",
} as const;

/** The part of each segment inside the block that starts at `lo` % (blocks are 10 % wide), as % of the block. */
function segmentSpans(segments: GaugeSegment[], lo: number) {
  const spans: { kind: GaugeSegment["kind"]; from: number; width: number }[] = [];
  let at = 0;
  for (const segment of segments) {
    const start = Math.max(at, lo);
    const end = Math.min(at + segment.percent, lo + 10);
    if (end > start) spans.push({ kind: segment.kind, from: (start - lo) * 10, width: (end - start) * 10 });
    at += segment.percent;
  }
  return spans;
}

/**
 * Ten blocks, one per 10 % (a half block for 5 %), with an optional white tick for the pace the
 * month calls for today. Decorative: the percentage next to it says the same.
 */
export function BlockGauge({
  percent,
  tone,
  paceAt,
  segments,
}: {
  percent: number;
  tone: keyof typeof TONE;
  /** 0-100: where an even pace stands today. */
  paceAt?: number;
  /** Budgets with regular payments: paid (sand), other spending (`tone`), due (sand hatching), in order. */
  segments?: GaugeSegment[];
}) {
  const { full, half } = gaugeBlocks(percent);
  return (
    <span aria-hidden="true" className="relative grid h-3 grid-cols-10 gap-[3px]">
      {segments &&
        Array.from({ length: 10 }, (_, i) => (
          <span key={i} className="bg-gauge-off relative overflow-hidden rounded-[2px]">
            {segmentSpans(segments, i * 10).map((span) => (
              <span
                key={span.kind}
                className={cn("absolute inset-y-0", span.kind === "paid" && "bg-sand", span.kind === "other" && TONE[tone])}
                style={{
                  left: `${span.from}%`,
                  width: `${span.width}%`,
                  ...(span.kind === "due" ? DUE_STYLE : undefined),
                }}
              />
            ))}
          </span>
        ))}
      {!segments && Array.from({ length: 10 }, (_, i) => (
        <span
          key={i}
          className={cn("rounded-[2px]", i < full ? TONE[tone] : i === full && half ? "" : "bg-gauge-off")}
          style={i === full && half ? { background: `linear-gradient(90deg, ${TONE_VAR[tone]} 50%, var(--gauge-off) 50%)` } : undefined}
        />
      ))}
      {paceAt !== undefined && (
        <span data-pace="" className="bg-foreground absolute -top-1 -bottom-1 w-0.5 rounded-full" style={{ left: `${paceAt}%` }} />
      )}
    </span>
  );
}
