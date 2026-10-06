import React from "react";
import {
  useCurrentFrame,
  AbsoluteFill,
  Sequence,
  Img,
  staticFile,
  interpolate,
} from "remotion";
import { COLORS } from "../shared/brand";

// 15 seconds @ 30 fps = 450 frames
// Scenes:
//   S1   0–110   Brand hook
//   S2 110–230   QR scan → check-in
//   S3 230–345   Stats (10 min · 14 days · $49)
//   S4 345–450   CTA amber

/* ─────────────────────────────────────────────
   Easings
───────────────────────────────────────────── */
const outCubic   = (t: number) => 1 - Math.pow(1 - t, 3);
const outBack    = (t: number) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2);
const inOutCubic = (t: number) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/* ─────────────────────────────────────────────
   Shorthand animation helpers
───────────────────────────────────────────── */
function fi(f: number, s: number, d = 12, ease = outCubic) {
  return interpolate(f, [s, s + d], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });
}
function fo(f: number, s: number, d = 10) {
  return interpolate(f, [s, s + d], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: outCubic });
}
function sc(f: number, s: number, d = 16, from = 0.55) {
  return interpolate(f, [s, s + d], [from, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: outBack });
}
function mv(f: number, s: number, d: number, from: number, to: number, ease = outCubic) {
  return interpolate(f, [s, s + d], [from, to], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });
}

/* ─────────────────────────────────────────────
   Scene wrapper — fades in/out automatically
───────────────────────────────────────────── */
function Wrap({ children, dur }: { children: React.ReactNode; dur: number }) {
  const f = useCurrentFrame();
  const opacity = Math.min(fi(f, 0, 8), fo(f, dur - 8, 8));
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
}

/* ─────────────────────────────────────────────
   Light sweep
───────────────────────────────────────────── */
function Sweep({ delay = 2, color = COLORS.primary }: { delay?: number; color?: string }) {
  const f = useCurrentFrame();
  const x = mv(f, delay, 20, -300, 1500);
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          top: 0, bottom: 0,
          width: 200, left: x,
          background: `linear-gradient(90deg, transparent, ${color}28, transparent)`,
          transform: "skewX(-15deg)",
        }}
      />
    </div>
  );
}

/* ─────────────────────────────────────────────
   Dark mesh background
───────────────────────────────────────────── */
function DarkBg({ gx = 50, gy = 40 }: { gx?: number; gy?: number }) {
  return (
    <AbsoluteFill
      style={{
        background: `
          radial-gradient(ellipse 900px 600px at ${gx}% ${gy}%, ${COLORS.primary}14 0%, transparent 65%),
          #0a0a0a
        `,
      }}
    />
  );
}

/* ─────────────────────────────────────────────
   Gradient text style
───────────────────────────────────────────── */
const grad = {
  background: `linear-gradient(135deg, ${COLORS.primaryLight} 0%, ${COLORS.primary} 60%)`,
  WebkitBackgroundClip: "text" as const,
  WebkitTextFillColor: "transparent" as const,
  backgroundClip: "text" as const,
  display: "inline-block" as const,
};

/* ══════════════════════════════════════════════
   S1 (0–110)  Brand hook — "The chaos ends here."
══════════════════════════════════════════════ */
function S1() {
  const f = useCurrentFrame();
  return (
    <Wrap dur={110}>
      <DarkBg gx={30} gy={50} />
      <Sweep delay={2} />

      {/* logo top-left */}
      <div
        style={{
          position: "absolute",
          top: 80, left: 80,
          display: "flex",
          alignItems: "center",
          gap: 14,
          opacity: fi(f, 2, 12),
          transform: `translateY(${mv(f, 2, 12, -20, 0)}px)`,
        }}
      >
        <div
          style={{
            width: 56, height: 56,
            borderRadius: 14,
            overflow: "hidden",
            border: `2px solid ${COLORS.primary}66`,
          }}
        >
          <Img src={staticFile("logo.png")} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        </div>
        <span style={{ fontSize: 30, fontWeight: 800, color: COLORS.gray300, letterSpacing: -0.5 }}>
          ClubCheck
        </span>
      </div>

      {/* amber accent bar */}
      <div
        style={{
          position: "absolute",
          left: 80,
          top: mv(f, 4, 18, 1920 * 0.6, 1920 * 0.28),
          bottom: 0,
          width: 5,
          background: `linear-gradient(180deg, ${COLORS.primary}, transparent)`,
          borderRadius: 3,
          opacity: fi(f, 4, 14),
        }}
      />

      <AbsoluteFill
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "0 100px 0 110px",
          gap: 20,
        }}
      >
        <p
          style={{
            fontSize: 28, fontWeight: 700,
            color: COLORS.primary, margin: 0,
            letterSpacing: 4, textTransform: "uppercase",
            opacity: fi(f, 6, 10),
            transform: `translateX(${mv(f, 6, 12, -30, 0)}px)`,
          }}
        >
          For gym owners
        </p>

        <div style={{ opacity: fi(f, 12, 14), transform: `translateY(${mv(f, 12, 16, 40, 0)}px)` }}>
          <p style={{ fontSize: 100, fontWeight: 900, color: COLORS.gray100, margin: 0, lineHeight: 1.0, letterSpacing: -2 }}>
            The chaos
          </p>
          <p style={{ fontSize: 100, fontWeight: 900, margin: 0, lineHeight: 1.0, letterSpacing: -2, ...grad }}>
            ends here.
          </p>
        </div>

        <p
          style={{
            fontSize: 38, color: COLORS.gray500,
            margin: 0, fontWeight: 400,
            opacity: fi(f, 28, 12),
            transform: `translateY(${mv(f, 28, 14, 20, 0)}px)`,
          }}
        >
          Members · payments · check-ins.
        </p>
      </AbsoluteFill>
    </Wrap>
  );
}

/* ══════════════════════════════════════════════
   S2 (110–230)  QR scan → success
══════════════════════════════════════════════ */
function S2() {
  const f = useCurrentFrame();
  const dur = 120;
  const scanY = interpolate(f, [8, 70], [16, 240], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: inOutCubic });
  const checked = f > 74;

  return (
    <Wrap dur={dur}>
      <DarkBg gx={50} gy={35} />
      <Sweep delay={2} />

      <AbsoluteFill
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 52,
        }}
      >
        {/* QR box */}
        <div
          style={{
            opacity: fi(f, 0, 12),
            transform: `scale(${sc(f, 0, 16, 0.85)})`,
            width: 310, height: 310,
            border: `3px solid ${checked ? COLORS.green : COLORS.primary}`,
            borderRadius: 28,
            position: "relative",
            overflow: "hidden",
            background: COLORS.bgCard,
            boxShadow: checked
              ? `0 0 60px ${COLORS.green}33`
              : `0 0 40px ${COLORS.primary}22`,
          }}
        >
          {/* QR dot grid */}
          <div
            style={{
              position: "absolute",
              inset: 20,
              display: "grid",
              gridTemplateColumns: "repeat(10, 1fr)",
              gap: 4,
            }}
          >
            {Array.from({ length: 100 }).map((_, i) => {
              const r = Math.floor(i / 10), c = i % 10;
              const corner = (r < 3 && c < 3) || (r < 3 && c > 6) || (r > 6 && c < 3);
              const filled = corner || (((r * 3 + c * 7) % 5) < 2);
              return (
                <div
                  key={i}
                  style={{
                    background: filled ? (checked ? COLORS.green : COLORS.primary) : "transparent",
                    borderRadius: 2,
                  }}
                />
              );
            })}
          </div>

          {/* scan line */}
          {!checked && (
            <div
              style={{
                position: "absolute",
                left: 8, right: 8,
                top: scanY, height: 3,
                background: `linear-gradient(90deg, transparent, ${COLORS.primary}, transparent)`,
                boxShadow: `0 0 18px ${COLORS.primary}`,
              }}
            />
          )}

          {/* success overlay */}
          {checked && (
            <div
              style={{
                position: "absolute", inset: 0,
                opacity: fi(f, 76, 10),
                background: `${COLORS.green}18`,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              <div
                style={{
                  width: 110, height: 110, borderRadius: "50%",
                  background: COLORS.green,
                  transform: `scale(${sc(f, 76, 12, 0)})`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  boxShadow: `0 0 40px ${COLORS.green}88`,
                }}
              >
                <svg width="52" height="52" viewBox="0 0 24 24" fill="none">
                  <path d="M5 13l4 4L19 7" stroke="#000" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            </div>
          )}
        </div>

        {/* text */}
        <div style={{ textAlign: "center" }}>
          {!checked ? (
            <div style={{ opacity: fi(f, 4, 12), transform: `translateY(${mv(f, 4, 14, 30, 0)}px)` }}>
              <p style={{ fontSize: 90, fontWeight: 900, color: COLORS.gray100, margin: 0, letterSpacing: -2 }}>One scan.</p>
              <p style={{ fontSize: 90, fontWeight: 900, margin: 0, letterSpacing: -2, ...grad }}>Checked in.</p>
            </div>
          ) : (
            <div style={{ opacity: fi(f, 78, 10), transform: `scale(${sc(f, 78, 14)})` }}>
              <p style={{ fontSize: 56, fontWeight: 800, color: COLORS.green, margin: 0 }}>Alex · 22-day streak 🔥</p>
            </div>
          )}
        </div>
      </AbsoluteFill>
    </Wrap>
  );
}

/* ══════════════════════════════════════════════
   S3 (230–345)  Stat pops: 10 min · 14 days · $49/mo
══════════════════════════════════════════════ */
function S3() {
  const f = useCurrentFrame();
  const dur = 115;

  const stats = [
    { n: "10 min",  label: "to get started" },
    { n: "14 days", label: "free trial"      },
    { n: "$49/mo",  label: "to start"        },
  ];

  // each stat gets ~38 frames
  const active = Math.min(Math.floor(f / 38), stats.length - 1);
  const localF = f % 38;
  const stat = stats[active];

  return (
    <Wrap dur={dur}>
      <DarkBg gx={50} gy={50} />

      <AbsoluteFill
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
        }}
      >
        <p
          key={`n-${active}`}
          style={{
            fontSize: 168,
            fontWeight: 900,
            margin: 0,
            lineHeight: 0.9,
            letterSpacing: -5,
            opacity: Math.min(fi(localF, 0, 8), fo(localF, 30, 8)),
            transform: `scale(${sc(localF, 0, 14, 0.5)})`,
            ...grad,
          }}
        >
          {stat.n}
        </p>
        <p
          key={`l-${active}`}
          style={{
            fontSize: 42,
            color: COLORS.gray500,
            margin: 0,
            fontWeight: 400,
            textTransform: "uppercase",
            letterSpacing: 4,
            opacity: fi(localF, 6, 10),
          }}
        >
          {stat.label}
        </p>
      </AbsoluteFill>
    </Wrap>
  );
}

/* ══════════════════════════════════════════════
   S4 (345–450)  Amber CTA
══════════════════════════════════════════════ */
function S4() {
  const f = useCurrentFrame();
  const dur = 105;

  return (
    <Wrap dur={dur}>
      <AbsoluteFill
        style={{
          background: `linear-gradient(160deg, ${COLORS.primary} 0%, ${COLORS.primaryDark} 100%)`,
        }}
      />
      <Sweep delay={2} color="#ffffff" />

      {/* corner decorations */}
      <div style={{ position: "absolute", top: 60, right: 60, width: 80, height: 80, borderTop: "3px solid #00000030", borderRight: "3px solid #00000030" }} />
      <div style={{ position: "absolute", bottom: 60, left: 60, width: 80, height: 80, borderBottom: "3px solid #00000030", borderLeft: "3px solid #00000030" }} />

      <AbsoluteFill
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 40,
        }}
      >
        {/* logo */}
        <div
          style={{
            opacity: fi(f, 0, 16),
            transform: `scale(${sc(f, 0, 20, 0.3)})`,
            width: 160, height: 160,
            borderRadius: 38,
            overflow: "hidden",
            border: "4px solid rgba(0,0,0,0.25)",
            boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
          }}
        >
          <Img src={staticFile("logo.png")} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        </div>

        {/* headline */}
        <div
          style={{
            opacity: fi(f, 12, 14),
            transform: `translateY(${mv(f, 12, 16, 30, 0)}px)`,
            textAlign: "center",
          }}
        >
          <p style={{ fontSize: 100, fontWeight: 900, color: "#000", margin: 0, lineHeight: 1.0, letterSpacing: -2 }}>
            Start free.
          </p>
          <p style={{ fontSize: 100, fontWeight: 900, color: "rgba(0,0,0,0.5)", margin: 0, lineHeight: 1.0, letterSpacing: -2 }}>
            14 days.
          </p>
          <p style={{ fontSize: 34, color: "rgba(0,0,0,0.45)", margin: "14px 0 0" }}>
            No credit card needed.
          </p>
        </div>

        {/* URL pill */}
        <div
          style={{
            opacity: fi(f, 28, 14),
            transform: `scale(${sc(f, 28, 16)})`,
            background: "#000",
            color: COLORS.primary,
            fontWeight: 900,
            fontSize: 52,
            borderRadius: 20,
            padding: "26px 72px",
            letterSpacing: -1,
          }}
        >
          clubcheckapp.com
        </div>
      </AbsoluteFill>
    </Wrap>
  );
}

/* ══════════════════════════════════════════════
   Root export — 450 frames = 15 s @ 30 fps
══════════════════════════════════════════════ */
export function ShortAd() {
  return (
    <AbsoluteFill style={{ background: "#0a0a0a" }}>
      <Sequence from={0}   durationInFrames={110}><S1 /></Sequence>
      <Sequence from={110} durationInFrames={120}><S2 /></Sequence>
      <Sequence from={230} durationInFrames={115}><S3 /></Sequence>
      <Sequence from={345} durationInFrames={105}><S4 /></Sequence>
    </AbsoluteFill>
  );
}
