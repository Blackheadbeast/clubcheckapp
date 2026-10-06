import React from "react";
import {
  useCurrentFrame,
  AbsoluteFill,
  Sequence,
  Img,
  staticFile,
  interpolate,
} from "remotion";
// To add music: import { Audio } from "remotion" and drop your MP3 at public/ad-music.mp3
import { COLORS, FONT } from "../shared/brand";

// ~40.5s @ 30fps = 1215 frames
// ⚠️  Drop your track at public/ad-music.mp3 then restart the studio

/* ─────────────────────────────────────────────
   Pure-math easing (no Easing import needed)
───────────────────────────────────────────── */
const outCubic   = (t: number) => 1 - Math.pow(1 - t, 3);
const outBack    = (t: number) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2);
const inOutCubic = (t: number) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/* ─────────────────────────────────────────────
   Shorthand helpers
───────────────────────────────────────────── */
function fi(f: number, s: number, d = 12, ease = outCubic): number {
  return interpolate(f, [s, s + d], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });
}
function fo(f: number, s: number, d = 10): number {
  return interpolate(f, [s, s + d], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: outCubic });
}
function sc(f: number, s: number, d = 18, from = 0.55): number {
  return interpolate(f, [s, s + d], [from, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: outBack });
}
function mv(f: number, s: number, d: number, from: number, to: number, ease = outCubic): number {
  return interpolate(f, [s, s + d], [from, to], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });
}

/* ─────────────────────────────────────────────
   Scene wrapper — fades in & out automatically
───────────────────────────────────────────── */
function Wrap({ children, dur }: { children: React.ReactNode; dur: number }) {
  const f = useCurrentFrame();
  const opacity = Math.min(fi(f, 0, 10), fo(f, dur - 10, 10));
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
}

/* ─────────────────────────────────────────────
   Diagonal light sweep — plays once at entry
───────────────────────────────────────────── */
function Sweep({ delay = 2, color = COLORS.primary }: { delay?: number; color?: string }) {
  const f = useCurrentFrame();
  const x = mv(f, delay, 22, -300, 1500);
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0, bottom: 0,
          width: 220,
          left: x,
          background: `linear-gradient(90deg, transparent, ${color}28, transparent)`,
          transform: "skewX(-15deg)",
        }}
      />
    </div>
  );
}

/* ─────────────────────────────────────────────
   Pulse ring — expands outward and fades
───────────────────────────────────────────── */
function Ring({ delay, size = 220, color = COLORS.primary }: { delay: number; size?: number; color?: string }) {
  const f = useCurrentFrame();
  const s = interpolate(f, [delay, delay + 40], [1, 2], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: outCubic });
  const o = interpolate(f, [delay, delay + 40], [0.6, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div
      style={{
        position: "absolute",
        width: size, height: size,
        borderRadius: "50%",
        border: `2px solid ${color}`,
        opacity: o,
        transform: `translate(-50%, -50%) scale(${s})`,
        left: "50%", top: "50%",
        pointerEvents: "none",
      }}
    />
  );
}

/* ─────────────────────────────────────────────
   Gradient text style helper
───────────────────────────────────────────── */
const grad = {
  background: `linear-gradient(135deg, ${COLORS.primaryLight} 0%, ${COLORS.primary} 60%)`,
  WebkitBackgroundClip: "text" as const,
  WebkitTextFillColor: "transparent" as const,
  backgroundClip: "text" as const,
  display: "inline-block" as const,
};

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

/* ══════════════════════════════════════════════
   S1 (0-75)  "The chaos ends here."
══════════════════════════════════════════════ */
function S1() {
  const f = useCurrentFrame();
  return (
    <Wrap dur={90}>
      <DarkBg gx={30} gy={50} />
      <Sweep color={COLORS.primary} delay={2} />

      {/* logo — top left */}
      <div
        style={{
          position: "absolute",
          top: 80,
          left: 80,
          display: "flex",
          alignItems: "center",
          gap: 14,
          opacity: fi(f, 2, 14),
          transform: `translateY(${mv(f, 2, 14, -20, 0)}px)`,
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
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

      {/* vertical amber bar */}
      <div
        style={{
          position: "absolute",
          left: 80,
          top: mv(f, 4, 20, H * 0.6, H * 0.28),
          bottom: 0,
          width: 5,
          background: `linear-gradient(180deg, ${COLORS.primary}, transparent)`,
          borderRadius: 3,
          opacity: fi(f, 4, 16),
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
            fontSize: 28,
            fontWeight: 700,
            color: COLORS.primary,
            margin: 0,
            letterSpacing: 4,
            textTransform: "uppercase",
            opacity: fi(f, 6, 10),
            transform: `translateX(${mv(f, 6, 14, -30, 0)}px)`,
          }}
        >
          For gym owners
        </p>

        <div style={{ opacity: fi(f, 12, 14), transform: `translateY(${mv(f, 12, 18, 40, 0)}px)` }}>
          <p style={{ fontSize: 96, fontWeight: 900, color: COLORS.gray100, margin: 0, lineHeight: 1.0, letterSpacing: -2 }}>
            The chaos
          </p>
          <p style={{ fontSize: 96, fontWeight: 900, margin: 0, lineHeight: 1.0, letterSpacing: -2, ...grad }}>
            ends here.
          </p>
        </div>

        <p
          style={{
            fontSize: 38,
            color: COLORS.gray500,
            margin: 0,
            fontWeight: 400,
            opacity: fi(f, 26, 12),
            transform: `translateY(${mv(f, 26, 14, 20, 0)}px)`,
          }}
        >
          Members · payments · check-ins.
        </p>
      </AbsoluteFill>
    </Wrap>
  );
}

/* ══════════════════════════════════════════════
   S2 (75-165)  Pain — strikethrough lines
══════════════════════════════════════════════ */
function S2() {
  const f = useCurrentFrame();
  const pains = [
    "Paper sign-in sheets",
    "Chasing payments",
    "Zero attendance data",
  ];
  return (
    <Wrap dur={110}>
      <AbsoluteFill style={{ background: "#0a0a0a" }}>
        <AbsoluteFill
          style={{
            background: `radial-gradient(ellipse 800px 500px at 80% 30%, #ef444412 0%, transparent 60%)`,
          }}
        />
      </AbsoluteFill>
      <Sweep color="#ef4444" delay={2} />

      <AbsoluteFill
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "0 90px",
          gap: 48,
        }}
      >
        <p
          style={{
            fontSize: 32,
            fontWeight: 700,
            letterSpacing: 4,
            textTransform: "uppercase",
            color: "#ef4444",
            margin: 0,
            opacity: fi(f, 2, 10),
          }}
        >
          Sound familiar?
        </p>

        {pains.map((p, i) => {
          const enter = 10 + i * 18;
          const strikeW = interpolate(f, [enter + 12, enter + 28], [0, 100], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: inOutCubic,
          });
          return (
            <div
              key={p}
              style={{
                opacity: fi(f, enter, 12),
                transform: `translateX(${mv(f, enter, 14, -40, 0)}px)`,
                position: "relative",
              }}
            >
              <p style={{ fontSize: 64, fontWeight: 800, color: COLORS.gray300, margin: 0, letterSpacing: -1 }}>
                {p}
              </p>
              <div
                style={{
                  position: "absolute",
                  top: "54%",
                  left: 0,
                  height: 4,
                  width: `${strikeW}%`,
                  background: "#ef4444",
                  borderRadius: 2,
                  boxShadow: "0 0 10px #ef4444",
                }}
              />
            </div>
          );
        })}
      </AbsoluteFill>
    </Wrap>
  );
}

/* ══════════════════════════════════════════════
   S3 (165-270)  ClubCheck reveal + pulse rings
══════════════════════════════════════════════ */
function S3() {
  const f = useCurrentFrame();
  return (
    <Wrap dur={90}>
      <DarkBg gx={50} gy={45} />
      <Sweep delay={2} />

      {/* pulse rings */}
      <Ring delay={8}  size={240} />
      <Ring delay={20} size={240} />
      <Ring delay={34} size={300} color={`${COLORS.primary}88`} />

      <AbsoluteFill
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 36,
        }}
      >
        {/* logo */}
        <div
          style={{
            opacity: fi(f, 0, 18),
            transform: `scale(${sc(f, 0, 24, 0.2)})`,
            width: 200, height: 200,
            borderRadius: 48,
            overflow: "hidden",
            border: `4px solid ${COLORS.primary}`,
            boxShadow: `0 0 80px ${COLORS.primary}66, 0 0 160px ${COLORS.primary}22`,
          }}
        >
          <Img src={staticFile("logo.png")} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        </div>

        {/* wordmark */}
        <div
          style={{
            opacity: fi(f, 20, 16),
            transform: `translateY(${mv(f, 20, 20, 30, 0)}px)`,
            textAlign: "center",
          }}
        >
          <p style={{ fontSize: 110, fontWeight: 900, letterSpacing: -3, margin: 0, ...grad }}>
            ClubCheck
          </p>
          <p style={{ fontSize: 40, color: COLORS.gray400, margin: "6px 0 0", fontWeight: 400 }}>
            Your gym, organized.
          </p>
        </div>
      </AbsoluteFill>
    </Wrap>
  );
}

/* ══════════════════════════════════════════════
   S4 (270-390)  QR scan → green success
══════════════════════════════════════════════ */
function S4() {
  const f = useCurrentFrame();
  const scanY = interpolate(f, [10, 88], [16, 240], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: inOutCubic });
  const checked = f > 92;

  return (
    <Wrap dur={155}>
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
            opacity: fi(f, 0, 14),
            transform: `scale(${sc(f, 0, 18, 0.85)})`,
            width: 310, height: 310,
            border: `3px solid ${checked ? COLORS.green : COLORS.primary}`,
            borderRadius: 28,
            position: "relative",
            overflow: "hidden",
            background: COLORS.bgCard,
            boxShadow: checked
              ? `0 0 60px ${COLORS.green}33`
              : `0 0 40px ${COLORS.primary}22`,
            transition: "border-color 0.2s, box-shadow 0.2s",
          }}
        >
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
                <div key={i} style={{ background: filled ? (checked ? COLORS.green : COLORS.primary) : "transparent", borderRadius: 2 }} />
              );
            })}
          </div>

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

          {checked && (
            <div
              style={{
                position: "absolute", inset: 0,
                opacity: fi(f, 94, 10),
                background: `${COLORS.green}18`,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              <div
                style={{
                  width: 110, height: 110, borderRadius: "50%",
                  background: COLORS.green,
                  transform: `scale(${sc(f, 94, 14, 0)})`,
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

        <div style={{ textAlign: "center" }}>
          {!checked ? (
            <div style={{ opacity: fi(f, 6, 14), transform: `translateY(${mv(f, 6, 16, 30, 0)}px)` }}>
              <p style={{ fontSize: 86, fontWeight: 900, color: COLORS.gray100, margin: 0, letterSpacing: -2 }}>One scan.</p>
              <p style={{ fontSize: 86, fontWeight: 900, margin: 0, letterSpacing: -2, ...grad }}>Checked in.</p>
            </div>
          ) : (
            <div style={{ opacity: fi(f, 95, 10), transform: `scale(${sc(f, 95, 14)})` }}>
              <p style={{ fontSize: 52, fontWeight: 800, color: COLORS.green, margin: 0 }}>Alex · 22-day streak</p>
            </div>
          )}
        </div>
      </AbsoluteFill>
    </Wrap>
  );
}

/* ══════════════════════════════════════════════
   S5 (390-510)  Payments
══════════════════════════════════════════════ */
function S5() {
  const f = useCurrentFrame();
  const rows = [
    { name: "Alex M.",   label: "Paid",          color: COLORS.green },
    { name: "Sarah K.",  label: "Reminder sent", color: COLORS.primary },
    { name: "Jordan P.", label: "Paid",          color: COLORS.green },
  ];
  return (
    <Wrap dur={135}>
      <DarkBg gx={70} gy={30} />
      <Sweep delay={2} />

      <AbsoluteFill
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "0 88px",
          gap: 44,
        }}
      >
        <div style={{ opacity: fi(f, 4, 14), transform: `translateY(${mv(f, 4, 16, 30, 0)}px)` }}>
          <p style={{ fontSize: 84, fontWeight: 900, color: COLORS.gray100, margin: 0, lineHeight: 1.0, letterSpacing: -2 }}>
            Payments —
          </p>
          <p style={{ fontSize: 84, fontWeight: 900, margin: 0, lineHeight: 1.0, letterSpacing: -2, ...grad }}>
            on autopilot.
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {rows.map((r, i) => (
            <div
              key={r.name}
              style={{
                opacity: fi(f, 18 + i * 16, 14),
                transform: `translateX(${mv(f, 18 + i * 16, 16, 60, 0)}px)`,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                background: COLORS.bgCard,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 20,
                padding: "28px 36px",
              }}
            >
              <span style={{ fontSize: 46, fontWeight: 700, color: COLORS.gray200 }}>{r.name}</span>
              <span style={{ fontSize: 36, fontWeight: 700, color: r.color }}>{r.label}</span>
            </div>
          ))}
        </div>

        <p style={{ fontSize: 34, color: COLORS.gray500, margin: 0, opacity: fi(f, 60, 14) }}>
          Auto reminders. No awkward follow-ups.
        </p>
      </AbsoluteFill>
    </Wrap>
  );
}

/* ══════════════════════════════════════════════
   SMembers (510-630)  Member Portal
══════════════════════════════════════════════ */
function SMembers() {
  const f = useCurrentFrame();

  // QR dot grid — deterministic so it doesn't flicker
  const qrFilled = Array.from({ length: 81 }).map((_, i) => {
    const r = Math.floor(i / 9), c = i % 9;
    const corner = (r < 3 && c < 3) || (r < 3 && c > 5) || (r > 5 && c < 3);
    return corner || (((r * 5 + c * 3 + 7) % 4) < 2);
  });

  const visits = ["Today · 10:38 AM", "Yesterday · 6:14 PM", "Feb 22 · 7:01 AM"];

  return (
    <Wrap dur={155}>
      <DarkBg gx={65} gy={40} />
      <Sweep delay={2} />

      <AbsoluteFill
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 80px",
          gap: 44,
        }}
      >
        {/* headline */}
        <div
          style={{
            opacity: fi(f, 2, 14),
            transform: `translateY(${mv(f, 2, 16, 30, 0)}px)`,
            textAlign: "center",
          }}
        >
          <p
            style={{
              fontSize: 30,
              fontWeight: 700,
              color: COLORS.primary,
              margin: "0 0 10px",
              letterSpacing: 4,
              textTransform: "uppercase",
            }}
          >
            Member Portal
          </p>
          <p style={{ fontSize: 82, fontWeight: 900, color: COLORS.gray100, margin: 0, lineHeight: 1.0, letterSpacing: -2 }}>
            No app.
          </p>
          <p style={{ fontSize: 82, fontWeight: 900, margin: 0, lineHeight: 1.0, letterSpacing: -2, ...grad }}>
            Just a link.
          </p>
        </div>

        {/* phone mockup */}
        <div
          style={{
            opacity: fi(f, 14, 16),
            transform: `scale(${sc(f, 14, 20, 0.88)})`,
            width: 420,
            background: COLORS.bgLighter,
            border: `2px solid ${COLORS.border}`,
            borderRadius: 36,
            padding: "32px 28px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 20,
            boxShadow: `0 40px 80px rgba(0,0,0,0.6), 0 0 60px ${COLORS.primary}18`,
          }}
        >
          {/* app header */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 28, height: 28, borderRadius: 6, overflow: "hidden", border: `1px solid ${COLORS.primary}55` }}>
              <Img src={staticFile("logo.png")} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            </div>
            <span style={{ fontSize: 22, fontWeight: 700, color: COLORS.gray300 }}>ClubCheck</span>
          </div>

          {/* member info */}
          <div style={{ textAlign: "center" }}>
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: "50%",
                background: COLORS.primaryGlow,
                border: `2px solid ${COLORS.primary}55`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: COLORS.primary,
                fontWeight: 800,
                fontSize: 22,
                margin: "0 auto 10px",
              }}
            >
              AM
            </div>
            <p style={{ fontSize: 26, fontWeight: 700, color: COLORS.gray100, margin: 0 }}>Alex Martinez</p>
            <p style={{ fontSize: 20, color: COLORS.primary, margin: "4px 0 0", fontWeight: 600 }}>
              🔥 22-day streak
            </p>
          </div>

          {/* QR code */}
          <div
            style={{
              opacity: fi(f, 24, 14),
              transform: `scale(${sc(f, 24, 18, 0.8)})`,
              width: 200,
              height: 200,
              border: `2px solid ${COLORS.primary}`,
              borderRadius: 16,
              padding: 14,
              background: COLORS.bgCard,
              display: "grid",
              gridTemplateColumns: "repeat(9, 1fr)",
              gap: 3,
              boxShadow: `0 0 30px ${COLORS.primary}22`,
            }}
          >
            {qrFilled.map((filled, i) => (
              <div
                key={i}
                style={{ background: filled ? COLORS.primary : "transparent", borderRadius: 2 }}
              />
            ))}
          </div>

          {/* visit history */}
          <div style={{ width: "100%" }}>
            <p style={{ fontSize: 14, color: COLORS.gray600, textTransform: "uppercase", letterSpacing: 2, margin: "0 0 10px", fontWeight: 600 }}>
              Recent visits
            </p>
            {visits.map((v, i) => (
              <div
                key={v}
                style={{
                  opacity: fi(f, 40 + i * 10, 12),
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "10px 0",
                  borderBottom: i < visits.length - 1 ? `1px solid ${COLORS.border}` : "none",
                }}
              >
                <span style={{ fontSize: 18, color: COLORS.gray500 }}>{v}</span>
                <span style={{ fontSize: 16, color: COLORS.green, fontWeight: 700 }}>✓</span>
              </div>
            ))}
          </div>
        </div>

        {/* footnote */}
        <p
          style={{
            opacity: fi(f, 88, 14),
            fontSize: 30,
            color: COLORS.gray500,
            margin: 0,
            textAlign: "center",
          }}
        >
          Works in any browser. Add to home screen.
        </p>
      </AbsoluteFill>
    </Wrap>
  );
}

/* ══════════════════════════════════════════════
   S6 (630-750)  Big numbers — full-screen each  (was 510-630)
══════════════════════════════════════════════ */
function S6() {
  const f = useCurrentFrame();
  const stats = [
    { n: "10 min",  label: "to set up" },
    { n: "14 days", label: "free trial" },
    { n: "$49/mo",  label: "to start"  },
  ];
  // each stat lives for 40 frames, in for 8, out for 8
  const active = Math.floor(f / 40);
  const localF = f % 40;

  const stat = stats[Math.min(active, stats.length - 1)];
  if (!stat) return null;

  return (
    <Wrap dur={120}>
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
            fontSize: 160,
            fontWeight: 900,
            margin: 0,
            lineHeight: 0.9,
            letterSpacing: -5,
            opacity: Math.min(fi(localF, 0, 8), fo(localF, 32, 8)),
            transform: `scale(${sc(localF, 0, 16, 0.5)})`,
            ...grad,
          }}
        >
          {stat.n}
        </p>
        <p
          key={`l-${active}`}
          style={{
            fontSize: 40,
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
   S7 (630-750)  Feature cards
══════════════════════════════════════════════ */
function S7() {
  const f = useCurrentFrame();
  const features = [
    { title: "QR Check-ins",  sub: "Every member, every visit" },
    { title: "Payments",      sub: "Track. Remind. Done." },
    { title: "Dashboard",     sub: "Your gym at a glance" },
    { title: "Staff Access",  sub: "Scoped roles & permissions" },
  ];
  return (
    <Wrap dur={130}>
      <DarkBg gx={40} gy={60} />
      <Sweep delay={2} />

      <AbsoluteFill
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 80px",
          gap: 44,
        }}
      >
        <div style={{ opacity: fi(f, 2, 14), textAlign: "center" }}>
          <p style={{ fontSize: 78, fontWeight: 900, color: COLORS.gray100, margin: 0, letterSpacing: -2 }}>
            Everything
          </p>
          <p style={{ fontSize: 78, fontWeight: 900, margin: 0, letterSpacing: -2, ...grad }}>
            in one place.
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, width: "100%" }}>
          {features.map((feat, i) => (
            <div
              key={feat.title}
              style={{
                opacity: fi(f, 14 + i * 18, 12),
                transform: `scale(${sc(f, 14 + i * 18, 14, 0.88)})`,
                background: COLORS.bgCard,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 24,
                padding: "30px 28px",
                position: "relative",
                overflow: "hidden",
              }}
            >
              {/* animated top border */}
              <div
                style={{
                  position: "absolute",
                  top: 0, left: 0,
                  height: 3,
                  width: `${interpolate(f, [14 + i * 18, 14 + i * 18 + 22], [0, 100], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: inOutCubic })}%`,
                  background: `linear-gradient(90deg, ${COLORS.primary}, ${COLORS.primaryLight})`,
                  borderRadius: "0 0 2px 2px",
                }}
              />
              <p style={{ fontSize: 38, fontWeight: 800, color: COLORS.gray100, margin: "0 0 8px", letterSpacing: -0.5 }}>
                {feat.title}
              </p>
              <p style={{ fontSize: 26, color: COLORS.gray500, margin: 0 }}>
                {feat.sub}
              </p>
            </div>
          ))}
        </div>
      </AbsoluteFill>
    </Wrap>
  );
}

/* ══════════════════════════════════════════════
   S8  CTA — amber background
══════════════════════════════════════════════ */
function S8() {
  const f = useCurrentFrame();
  return (
    <Wrap dur={140}>
      {/* amber background — complete reversal of the dark theme */}
      <AbsoluteFill
        style={{
          background: `linear-gradient(160deg, ${COLORS.primary} 0%, ${COLORS.primaryDark} 100%)`,
        }}
      />
      <Sweep delay={2} color="#ffffff" />

      {/* decorative corner lines */}
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
            opacity: fi(f, 0, 18),
            transform: `scale(${sc(f, 0, 24, 0.3)})`,
            width: 160, height: 160,
            borderRadius: 38,
            overflow: "hidden",
            border: "4px solid rgba(0,0,0,0.25)",
            boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
          }}
        >
          <Img src={staticFile("logo.png")} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        </div>

        {/* headline — dark on amber */}
        <div
          style={{
            opacity: fi(f, 14, 14),
            transform: `translateY(${mv(f, 14, 18, 30, 0)}px)`,
            textAlign: "center",
          }}
        >
          <p style={{ fontSize: 96, fontWeight: 900, color: "#000", margin: 0, lineHeight: 1.0, letterSpacing: -2 }}>
            Start free.
          </p>
          <p style={{ fontSize: 96, fontWeight: 900, color: "rgba(0,0,0,0.55)", margin: 0, lineHeight: 1.0, letterSpacing: -2 }}>
            14 days.
          </p>
          <p style={{ fontSize: 36, color: "rgba(0,0,0,0.5)", margin: "16px 0 0" }}>
            No credit card needed.
          </p>
        </div>

        {/* URL button */}
        <div
          style={{
            opacity: fi(f, 30, 14),
            transform: `scale(${sc(f, 30, 18)})`,
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
   S9 (840-900)  End card
══════════════════════════════════════════════ */
function S9() {
  const f = useCurrentFrame();
  return (
    <Wrap dur={90}>
      <DarkBg gx={50} gy={50} />
      <Ring delay={4} size={250} />
      <Ring delay={16} size={260} />

      <AbsoluteFill
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 24,
        }}
      >
        <div
          style={{
            opacity: fi(f, 0, 18),
            transform: `scale(${sc(f, 0, 22, 0.4)})`,
            width: 200, height: 200,
            borderRadius: 50,
            overflow: "hidden",
            border: `4px solid ${COLORS.primary}`,
            boxShadow: `0 0 100px ${COLORS.primary}66`,
          }}
        >
          <Img src={staticFile("logo.png")} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        </div>
        <p style={{ ...grad, fontSize: 86, fontWeight: 900, margin: 0, letterSpacing: -2, opacity: fi(f, 10, 16) }}>
          ClubCheck
        </p>
        <p style={{ fontSize: 40, color: COLORS.gray500, margin: 0, opacity: fi(f, 18, 14) }}>
          clubcheckapp.com
        </p>
      </AbsoluteFill>
    </Wrap>
  );
}

/* ══════════════════════════════════════════════
   Canvas height for helpers
══════════════════════════════════════════════ */
const H = 1920;

/* ══════════════════════════════════════════════
   Root export
══════════════════════════════════════════════ */
export function SocialAd() {
  return (
    // Dark root background — prevents white flash during scene crossfades
    <AbsoluteFill style={{ background: "#0a0a0a" }}>
      {/*
        MUSIC: once you have a track, add this line back:
          import { Audio } from "remotion"
        and drop your MP3 at:
          public/ad-music.mp3
        Then uncomment:
          <Audio src={staticFile("ad-music.mp3")} volume={0.75} startFrom={0} endAt={900} />
      */}

      {/* ~40s total = 1190 frames @ 30fps */}
      <Sequence from={0}    durationInFrames={90}><S1 /></Sequence>
      <Sequence from={90}   durationInFrames={110}><S2 /></Sequence>
      <Sequence from={200}  durationInFrames={90}><S3 /></Sequence>
      <Sequence from={290}  durationInFrames={155}><S4 /></Sequence>
      <Sequence from={445}  durationInFrames={135}><S5 /></Sequence>
      <Sequence from={580}  durationInFrames={155}><SMembers /></Sequence>
      <Sequence from={735}  durationInFrames={120}><S6 /></Sequence>
      <Sequence from={855}  durationInFrames={130}><S7 /></Sequence>
      <Sequence from={985}  durationInFrames={140}><S8 /></Sequence>
      <Sequence from={1125} durationInFrames={90}><S9 /></Sequence>
    </AbsoluteFill>
  );
}
