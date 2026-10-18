import { ImageResponse } from "next/og";

import { BrandMark } from "@/app/icons/brand-mark";

export const dynamic = "force-static";

// Maskable icons must fill the full square with the background color and
// keep the glyph inside a ~80% "safe zone" — the OS may crop to a circle
// or squircle and clip anything outside it.
export function GET() {
  const size = 512;
  return new ImageResponse(<BrandMark size={size} glyph={0.4} />, { width: size, height: size });
}
