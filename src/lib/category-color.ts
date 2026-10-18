/** Neutral grey for outflows without a category. */
export const UNCATEGORIZED_COLOR = "#9ca3af";

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** "#1e3a8a" from user input ("1E3A8A", " #1e3a8a "), or null when it isn't a 6-digit hex colour. */
export function parseHexColor(input: string): string | null {
  const value = input.trim().replace(/^#?/, "#").toLowerCase();
  return HEX_COLOR.test(value) ? value : null;
}

/** Lightness floor in dark mode: dark category colours (e.g. bank brown) vanish on a dark card. */
const DARK_MIN_LIGHTNESS = 0.72;

/**
 * CSS colour to paint a category with: its own colour in light mode, and in
 * dark mode the same hue lifted to a readable lightness when it is too dark.
 * Stored colours never change; this only affects display. Anything that isn't
 * a 6-digit hex (never expected, the schema enforces it) falls back to grey
 * so no arbitrary string reaches a style attribute.
 */
export function categoryDisplayColor(color: string | null | undefined): string {
  const hex = color && HEX_COLOR.test(color) ? color : UNCATEGORIZED_COLOR;
  return `light-dark(${hex}, oklch(from ${hex} max(l, ${DARK_MIN_LIGHTNESS}) c h))`;
}

/** Soft background tint of a category colour, readable on light and dark cards. */
export function categoryTint(color: string | null | undefined, percent = 15): string {
  return `color-mix(in srgb, ${categoryDisplayColor(color)} ${percent}%, transparent)`;
}

/**
 * Category colours (SPEC §49): distinct from each other and kept away from the
 * brand blue and from the money red and green, so a category dot never reads
 * as a status. Each passes 3:1 against a white card.
 */
export const CATEGORY_PALETTE: readonly string[] = [
  "#7c3aed", // violet
  "#0891b2", // cyan
  "#d97706", // amber
  "#db2777", // pink
  "#64748b", // slate
  "#ea580c", // orange
  "#c026d3", // fuchsia
  "#92400e", // brown
  "#a16207", // ochre
  "#6366f1", // periwinkle
  "#86198f", // plum
  "#78716c", // stone
];

/** Colours "Create all" used before Slice 35; the recolour migration treats them as defaults. */
export const LEGACY_BANK_CATEGORY_COLORS: readonly string[] = [
  "#2e7d32",
  "#1565c0",
  "#ef6c00",
  "#6a1b9a",
  "#00838f",
  "#c2185b",
  "#5d4037",
  "#558b2f",
  "#ad1457",
  "#00695c",
  "#b71c1c",
  "#455a64",
];

/** The first palette colour not in `used` (any case); when all are taken, cycle on the count. */
export function nextCategoryColor(used: readonly string[]): string {
  const taken = new Set(used.map((c) => c.toLowerCase()));
  return CATEGORY_PALETTE.find((c) => !taken.has(c)) ?? CATEGORY_PALETTE[used.length % CATEGORY_PALETTE.length];
}

type Rgb = readonly [number, number, number];

function toRgb(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(rgb: Rgb): string {
  return `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}

/** WCAG relative luminance. */
function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two 6-digit hex colours. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Mix towards white (amount > 0) or black (amount < 0). */
function shade(hex: string, amount: number): string {
  const target = amount > 0 ? 255 : 0;
  const t = Math.abs(amount);
  return toHex(toRgb(hex).map((v) => v + (target - v) * t) as unknown as Rgb);
}

/** Alternating darker and lighter steps, so neighbouring subcategories differ most. */
const SHADE_STEPS = [-0.25, 0.22, -0.45, 0.4, -0.6, 0.55] as const;

/**
 * The colour of the `index`-th subcategory created under a parent: a shade of
 * the parent's colour, so a family reads as one group without siblings sharing
 * a colour. A lighter step that would drop under 3:1 on white goes darker instead.
 */
export function subcategoryShade(parentHex: string, index: number): string {
  const parent = HEX_COLOR.test(parentHex) ? parentHex.toLowerCase() : UNCATEGORIZED_COLOR;
  const step = SHADE_STEPS[index % SHADE_STEPS.length];
  const lighter = shade(parent, step);
  if (step < 0 || contrastRatio(lighter, "#ffffff") >= 3) return lighter;
  return shade(parent, -step);
}
