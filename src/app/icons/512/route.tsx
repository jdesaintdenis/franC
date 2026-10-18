import { ImageResponse } from "next/og";

import { BrandMark } from "@/app/icons/brand-mark";

export const dynamic = "force-static";

export function GET() {
  const size = 512;
  return new ImageResponse(<BrandMark size={size} glyph={0.55} />, { width: size, height: size });
}
