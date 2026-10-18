import { ImageResponse } from "next/og";

import { BrandMark } from "@/app/icons/brand-mark";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(<BrandMark size={32} glyph={0.65} flag={false} />, { ...size });
}
