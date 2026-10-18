/**
 * App icon art for `ImageResponse`: a white "f" on the Tricolore navy, with a
 * small blue-white-red bar under it (SPEC §49). Plain inline styles because
 * Satori renders these, not the browser.
 */
export const ICON_NAVY = "#0a2a5e";
const FLAG = ["#4f8be8", "#ffffff", "#d62839"] as const;

export function BrandMark({ size, glyph, flag = true }: { size: number; glyph: number; flag?: boolean }) {
  const barWidth = size * glyph * 0.9;
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: ICON_NAVY,
        color: "#ffffff",
        fontFamily: "sans-serif",
        fontWeight: 700,
      }}
    >
      <div style={{ display: "flex", fontSize: size * glyph, lineHeight: 1 }}>f</div>
      {flag && (
        <div style={{ display: "flex", marginTop: size * 0.04, width: barWidth, height: Math.max(2, size * 0.035) }}>
          {FLAG.map((color) => (
            <div key={color} style={{ flex: 1, background: color }} />
          ))}
        </div>
      )}
    </div>
  );
}
