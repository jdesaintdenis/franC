import { ImageResponse } from "next/og";

import { BrandMark } from "@/app/icons/brand-mark";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(<BrandMark size={180} glyph={0.55} />, { ...size });
}
