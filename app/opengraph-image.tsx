import { ImageResponse } from "next/og";

export const alt = "JimmyGM fantasy football projections, Trade Finder, and Start/Sit tools";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "72px 82px", color: "#f8fafc", background: "radial-gradient(circle at 78% 18%, #164e63 0%, #0f172a 38%, #020617 78%)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
        <div style={{ width: 82, height: 82, borderRadius: 22, border: "2px solid #334155", background: "#0f172a", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ color: "#67e8f9", fontSize: 42, fontWeight: 900 }}>JG</div>
        </div>
        <div style={{ fontSize: 46, fontWeight: 900, letterSpacing: -1 }}>JimmyGM</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", maxWidth: 950 }}>
        <div style={{ color: "#67e8f9", fontSize: 24, fontWeight: 800, letterSpacing: 4, textTransform: "uppercase" }}>Fantasy football, with context</div>
        <div style={{ marginTop: 22, fontSize: 68, lineHeight: 1.05, fontWeight: 900, letterSpacing: -3 }}>Trade Finder, projections &amp; Start/Sit tools</div>
        <div style={{ marginTop: 26, color: "#cbd5e1", fontSize: 28 }}>Player Values · Matchups · Sleeper league analysis</div>
      </div>
    </div>,
    size,
  );
}
