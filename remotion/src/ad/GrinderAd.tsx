import React from "react";
import {
  useCurrentFrame,
  AbsoluteFill,
  Sequence,
  Img,
  staticFile,
  interpolate,
} from "remotion";

// 15 seconds @ 30fps = 450 frames
// S1   0–90   Hook — "POV: You finally upgraded your kitchen."
// S2  90–210  Product reveal — one press, spice flows
// S3 210–370  Feature checkmarks (4 items)
// S4 370–450  Final CTA — "Your kitchen called."

/* ─────────────────────────────────────────────
   Color palette — warm kitchen / premium black
───────────────────────────────────────────── */
const C = {
  bg: "#0d0d0b",
  bgWarm: "#120f08",
  gold: "#c8963a",
  goldLight: "#e8b96a",
  goldDark: "#a07828",
  goldGlow: "rgba(200,150,58,0.15)",
  white: "#f5f0e8",
  gray300: "#c8c0b0",
  gray500: "#7a7060",
} as const;

const grad = {
  background: `linear-gradient(135deg, ${C.goldLight} 0%, ${C.gold} 60%)`,
  WebkitBackgroundClip: "text" as const,
  WebkitTextFillColor: "transparent" as const,
  backgroundClip: "text" as const,
  display: "inline-block" as const,
};

/* ─────────────────────────────────────────────
   Easing helpers
───────────────────────────────────────────── */
const outCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const outBack  = (t: number) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2);

function fi(f: number, s: number, d = 12, ease = outCubic) {
  return interpolate(f, [s, s + d], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });
}
function fo(f: number, s: number, d = 10) {
  return interpolate(f, [s, s + d], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: outCubic });
}
function sc(f: number, s: number, d = 16, from = 0.6) {
  return interpolate(f, [s, s + d], [from, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: outBack });
}
function mv(f: number, s: number, d: number, from: number, to: number, ease = outCubic) {
  return interpolate(f, [s, s + d], [from, to], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });
}

function Wrap({ children, dur }: { children: React.ReactNode; dur: number }) {
  const f = useCurrentFrame();
  const opacity = Math.min(fi(f, 0, 8), fo(f, dur - 8, 8));
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
}

function WarmBg({ gx = 50, gy = 50 }: { gx?: number; gy?: number }) {
  return (
    <AbsoluteFill
      style={{
        background: `
          radial-gradient(ellipse 900px 700px at ${gx}% ${gy}%, ${C.goldGlow} 0%, transparent 65%),
          ${C.bg}
        `,
      }}
    />
  );
}

/* light sweep */
function Sweep({ delay = 2 }: { delay?: number }) {
  const f = useCurrentFrame();
  const x = mv(f, delay, 22, -300, 1500);
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          top: 0, bottom: 0,
          width: 200, left: x,
          background: `linear-gradient(90deg, transparent, ${C.gold}20, transparent)`,
          transform: "skewX(-15deg)",
        }}
      />
    </div>
  );
}

/* ══════════════════════════════════════════════
   S1 (0–90)  Hook
══════════════════════════════════════════════ */
function S1() {
  const f = useCurrentFrame();
  return (
    <Wrap dur={90}>
      <WarmBg gx={30} gy={60} />
      <Sweep delay={2} />

      {/* thin gold top bar */}
      <div
        style={{
          position: "absolute",
          top: 0, left: 0, right: 0,
          height: 3,
          background: `linear-gradient(90deg, transparent, ${C.gold}, transparent)`,
          opacity: fi(f, 0, 10),
        }}
      />

      <AbsoluteFill
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "0 96px",
          gap: 16,
        }}
      >
        {/* "POV:" label */}
        <p
          style={{
            fontSize: 32,
            fontWeight: 700,
            color: C.gold,
            margin: 0,
            letterSpacing: 6,
            textTransform: "uppercase",
            opacity: fi(f, 4, 10),
            transform: `translateX(${mv(f, 4, 12, -30, 0)}px)`,
          }}
        >
          POV
        </p>

        {/* headline */}
        <div
          style={{
            opacity: fi(f, 10, 14),
            transform: `translateY(${mv(f, 10, 16, 50, 0)}px)`,
          }}
        >
          <p style={{ fontSize: 104, fontWeight: 900, color: C.white, margin: 0, lineHeight: 1.0, letterSpacing: -3 }}>
            You finally
          </p>
          <p style={{ fontSize: 104, fontWeight: 900, margin: 0, lineHeight: 1.0, letterSpacing: -3, ...grad }}>
            upgraded
          </p>
          <p style={{ fontSize: 104, fontWeight: 900, color: C.white, margin: 0, lineHeight: 1.0, letterSpacing: -3 }}>
            your kitchen.
          </p>
        </div>

        {/* sub */}
        <p
          style={{
            fontSize: 36,
            color: C.gray300,
            margin: "8px 0 0",
            fontWeight: 400,
            opacity: fi(f, 28, 12),
            transform: `translateY(${mv(f, 28, 14, 20, 0)}px)`,
          }}
        >
          And it only took one button.
        </p>
      </AbsoluteFill>
    </Wrap>
  );
}

/* ══════════════════════════════════════════════
   S2 (90–210)  Product reveal — the moment
══════════════════════════════════════════════ */
function S2() {
  const f = useCurrentFrame();
  const dur = 120;

  // button press pulse at frame 50
  const pressPulse = interpolate(f, [50, 70], [1, 1.06], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: outBack,
  });
  const glowPulse = interpolate(f, [50, 80], [0.3, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: outCubic,
  });

  return (
    <Wrap dur={dur}>
      <WarmBg gx={50} gy={40} />
      <Sweep delay={2} />

      <AbsoluteFill
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 40,
          padding: "0 80px",
        }}
      >
        {/* "One press." headline */}
        <div
          style={{
            opacity: fi(f, 0, 14),
            transform: `translateY(${mv(f, 0, 16, -40, 0)}px)`,
            textAlign: "center",
          }}
        >
          <p style={{ fontSize: 96, fontWeight: 900, color: C.white, margin: 0, lineHeight: 1.0, letterSpacing: -3 }}>
            One press.
          </p>
          <p style={{ fontSize: 96, fontWeight: 900, margin: 0, lineHeight: 1.0, letterSpacing: -3, ...grad }}>
            That's it.
          </p>
        </div>

        {/* product image */}
        <div
          style={{
            opacity: fi(f, 8, 16),
            transform: `scale(${sc(f, 8, 20, 0.75) * pressPulse})`,
            borderRadius: 32,
            overflow: "hidden",
            width: 680,
            height: 520,
            boxShadow: `0 40px 100px rgba(0,0,0,0.8), 0 0 ${80 * glowPulse}px ${C.gold}${Math.round(40 * glowPulse).toString(16).padStart(2, "0")}`,
          }}
        >
          <Img
            src={staticFile("grinder.png")}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        </div>

        {/* sub caption */}
        <p
          style={{
            opacity: fi(f, 30, 14),
            fontSize: 36,
            color: C.gray300,
            margin: 0,
            textAlign: "center",
            fontWeight: 400,
            transform: `translateY(${mv(f, 30, 14, 20, 0)}px)`,
          }}
        >
          Spice flows out perfectly. No twisting. No struggling.
        </p>
      </AbsoluteFill>
    </Wrap>
  );
}

/* ══════════════════════════════════════════════
   S3 (210–370)  Feature checkmarks
══════════════════════════════════════════════ */
function S3() {
  const f = useCurrentFrame();
  const dur = 160;

  const features = [
    "One-Hand Automatic Operation",
    "USB Rechargeable — No Batteries Ever",
    "Adjustable Coarseness",
    "Works for Salt, Pepper & More",
  ];

  return (
    <Wrap dur={dur}>
      <WarmBg gx={70} gy={30} />
      <Sweep delay={2} />

      <AbsoluteFill
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "0 88px",
          gap: 16,
        }}
      >
        {/* header */}
        <p
          style={{
            fontSize: 34,
            fontWeight: 700,
            color: C.gold,
            margin: "0 0 24px",
            letterSpacing: 4,
            textTransform: "uppercase",
            opacity: fi(f, 4, 10),
          }}
        >
          Here's what changed.
        </p>

        {/* feature rows */}
        {features.map((feat, i) => {
          const enter = 10 + i * 26;
          const checkScale = sc(f, enter + 4, 14, 0);
          return (
            <div
              key={feat}
              style={{
                opacity: fi(f, enter, 14),
                transform: `translateX(${mv(f, enter, 16, -50, 0)}px)`,
                display: "flex",
                alignItems: "center",
                gap: 28,
                background: "rgba(200,150,58,0.06)",
                border: `1px solid ${C.gold}30`,
                borderRadius: 20,
                padding: "26px 32px",
              }}
            >
              {/* checkmark circle */}
              <div
                style={{
                  width: 60,
                  height: 60,
                  borderRadius: "50%",
                  background: `linear-gradient(135deg, ${C.goldLight}, ${C.gold})`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  transform: `scale(${checkScale})`,
                  boxShadow: `0 0 20px ${C.gold}44`,
                }}
              >
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                  <path d="M5 13l4 4L19 7" stroke="#000" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <p style={{ fontSize: 46, fontWeight: 700, color: C.white, margin: 0, letterSpacing: -0.5 }}>
                {feat}
              </p>
            </div>
          );
        })}
      </AbsoluteFill>
    </Wrap>
  );
}

/* ══════════════════════════════════════════════
   S4 (370–450)  Final CTA
══════════════════════════════════════════════ */
function S4() {
  const f = useCurrentFrame();
  const dur = 80;

  return (
    <Wrap dur={dur}>
      {/* warm amber gradient bg */}
      <AbsoluteFill
        style={{
          background: `linear-gradient(160deg, ${C.gold} 0%, ${C.goldDark} 100%)`,
        }}
      />
      <Sweep delay={2} />

      {/* decorative corners */}
      <div style={{ position: "absolute", top: 60, right: 60, width: 80, height: 80, borderTop: "3px solid #00000025", borderRight: "3px solid #00000025" }} />
      <div style={{ position: "absolute", bottom: 60, left: 60, width: 80, height: 80, borderBottom: "3px solid #00000025", borderLeft: "3px solid #00000025" }} />

      <AbsoluteFill
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 32,
          padding: "0 96px",
          textAlign: "center",
        }}
      >
        {/* product image small */}
        <div
          style={{
            opacity: fi(f, 0, 14),
            transform: `scale(${sc(f, 0, 18, 0.5)})`,
            width: 240,
            height: 180,
            borderRadius: 24,
            overflow: "hidden",
            boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
            border: "3px solid rgba(255,255,255,0.2)",
          }}
        >
          <Img
            src={staticFile("grinder.png")}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        </div>

        {/* CTA headline */}
        <div
          style={{
            opacity: fi(f, 12, 14),
            transform: `translateY(${mv(f, 12, 16, 30, 0)}px)`,
          }}
        >
          <p style={{ fontSize: 96, fontWeight: 900, color: "#000", margin: 0, lineHeight: 1.0, letterSpacing: -2 }}>
            Your kitchen called.
          </p>
          <p style={{ fontSize: 96, fontWeight: 900, color: "rgba(0,0,0,0.5)", margin: 0, lineHeight: 1.0, letterSpacing: -2 }}>
            It wants an upgrade.
          </p>
        </div>
      </AbsoluteFill>
    </Wrap>
  );
}

/* ══════════════════════════════════════════════
   Root export — 450 frames = 15s @ 30fps
══════════════════════════════════════════════ */
export function GrinderAd() {
  return (
    <AbsoluteFill style={{ background: C.bg, fontFamily: "system-ui, -apple-system, sans-serif" }}>
      <Sequence from={0}   durationInFrames={90}><S1 /></Sequence>
      <Sequence from={90}  durationInFrames={120}><S2 /></Sequence>
      <Sequence from={210} durationInFrames={160}><S3 /></Sequence>
      <Sequence from={370} durationInFrames={80}><S4 /></Sequence>
    </AbsoluteFill>
  );
}
