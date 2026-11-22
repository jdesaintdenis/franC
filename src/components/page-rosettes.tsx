/* The 50 F page ground: night colour, two guilloché rosettes and two stars (DESIGN.md "The Pattern
   Below"). Drawn as inline SVG, not CSS gradients: Firefox for Android sometimes paints page-sized
   CSS repeating-radial-gradients as bright magenta bands (GPU gradient path), while inline SVG is
   rasterised in tiles on the CPU. Same geometry as the old CSS: rings 1px thick every 7px / 9px,
   centred at 85% 12% and 10% 70% of the page. Sits under the content at a negative z-index, so `.bg-50f`
   paints no background of its own. Duplicate ids across instances are harmless: every copy
   defines the same gradients. */
const RING = "rgb(142 162 255)";

export function PageRosettes() {
  return (
    <svg aria-hidden="true" focusable="false" className="pointer-events-none absolute inset-0 -z-10 size-full">
      <defs>
        <Rosette id="rosette-a" cx="85%" cy="12%" pitch={7} opacity={0.07} />
        <Rosette id="rosette-b" cx="10%" cy="70%" pitch={9} opacity={0.05} />
        <Star id="star-a" color="rgb(243 227 166)" opacity={0.67} />
        <Star id="star-b" color="rgb(255 255 255)" opacity={0.53} />
      </defs>
      <rect width="100%" height="100%" fill="#04051a" />
      <rect width="100%" height="100%" fill="url(#rosette-b)" />
      <rect width="100%" height="100%" fill="url(#rosette-a)" />
      <circle cx="140" cy="160" r="1" fill="url(#star-b)" />
      <circle cx="30" cy="40" r="1.2" fill="url(#star-a)" />
    </svg>
  );
}

/** A 1px ring every `pitch` px, repeated outwards from the centre. */
function Rosette({ id, cx, cy, pitch, opacity }: { id: string; cx: string; cy: string; pitch: number; opacity: number }) {
  const ring = 1 / pitch;
  return (
    <radialGradient id={id} gradientUnits="userSpaceOnUse" cx={cx} cy={cy} r={pitch} spreadMethod="repeat">
      <stop offset={0} stopColor={RING} stopOpacity={opacity} />
      <stop offset={ring} stopColor={RING} stopOpacity={opacity} />
      <stop offset={ring} stopColor={RING} stopOpacity={0} />
      <stop offset={1} stopColor={RING} stopOpacity={0} />
    </radialGradient>
  );
}

/** Solid to half the radius, then fading out, like the old `radial-gradient(color 50%, transparent)`. */
function Star({ id, color, opacity }: { id: string; color: string; opacity: number }) {
  return (
    <radialGradient id={id}>
      <stop offset={0.5} stopColor={color} stopOpacity={opacity} />
      <stop offset={1} stopColor={color} stopOpacity={0} />
    </radialGradient>
  );
}
