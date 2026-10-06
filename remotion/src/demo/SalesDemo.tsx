import React from "react";
import { useCurrentFrame, AbsoluteFill, Sequence, Img, staticFile } from "remotion";
import { COLORS, FONT, FEATURES } from "../shared/brand";
import { fadeIn, slideUp, pop, smooth, fadeOut } from "../shared/animations";

// ~4 min @ 30fps = 7200 frames
// Scene timeline:
//   0    – 240   Title card
//   240  – 600   Problem / who it's for
//   600  – 1050  Dashboard overview
//   1050 – 1500  Member management
//   1500 – 1950  QR kiosk check-in
//   1950 – 2400  Payment tracking
//   2400 – 2850  Staff accounts
//   2850 – 3300  Analytics
//   3300 – 3750  Member portal
//   3750 – 4200  Setup (3 steps)
//   4200 – 4650  Pricing
//   4650 – 5100  Q&A / objections
//   5100 – 5400  CTA

const W = 1920;
const H = 1080;

/* ─── Layout helpers ─── */

function FullBg({ children }: { children?: React.ReactNode }) {
  return (
    <AbsoluteFill style={{ background: COLORS.bg, fontFamily: FONT.sans }}>
      {/* subtle grid */}
      <AbsoluteFill
        style={{
          backgroundImage: `linear-gradient(${COLORS.border} 1px, transparent 1px), linear-gradient(90deg, ${COLORS.border} 1px, transparent 1px)`,
          backgroundSize: "80px 80px",
          opacity: 0.2,
        }}
      />
      {children}
    </AbsoluteFill>
  );
}

function Glow({ x, y, r, color = COLORS.primary, opacity = 0.12 }: { x: number; y: number; r: number; color?: string; opacity?: number }) {
  return (
    <div
      style={{
        position: "absolute",
        left: x - r,
        top: y - r,
        width: r * 2,
        height: r * 2,
        borderRadius: "50%",
        background: `radial-gradient(circle, ${color} 0%, transparent 70%)`,
        opacity,
        pointerEvents: "none",
      }}
    />
  );
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        background: COLORS.bgCard,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 16,
        padding: "28px 32px",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function SectionLabel({ text }: { text: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        background: `${COLORS.primary}22`,
        color: COLORS.primary,
        border: `1px solid ${COLORS.primary}44`,
        borderRadius: 8,
        padding: "4px 16px",
        fontSize: 18,
        fontWeight: 700,
        letterSpacing: 2,
        textTransform: "uppercase",
        marginBottom: 12,
      }}
    >
      {text}
    </span>
  );
}

function NavBar({ active }: { active: string }) {
  const items = ["Dashboard", "Members", "Check-ins", "Payments", "Staff", "Analytics", "Settings"];
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: 60,
        background: `${COLORS.bg}ee`,
        borderBottom: `1px solid ${COLORS.border}`,
        display: "flex",
        alignItems: "center",
        padding: "0 32px",
        gap: 8,
        backdropFilter: "blur(10px)",
        zIndex: 100,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginRight: 32 }}>
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 6,
            overflow: "hidden",
            border: `1px solid ${COLORS.primary}55`,
          }}
        >
          <Img src={staticFile("logo.png")} style={{ width: "100%", height: "100%" }} />
        </div>
        <span style={{ color: COLORS.gray200, fontWeight: 700, fontSize: 16 }}>ClubCheck</span>
      </div>
      {items.map((item) => (
        <div
          key={item}
          style={{
            padding: "6px 14px",
            borderRadius: 8,
            fontSize: 14,
            fontWeight: item === active ? 600 : 400,
            color: item === active ? COLORS.primary : COLORS.gray500,
            background: item === active ? `${COLORS.primary}15` : "transparent",
            cursor: "pointer",
          }}
        >
          {item}
        </div>
      ))}
    </div>
  );
}

/* ─── Scene 1 (0-240): Title Card ─── */
function SceneTitle() {
  const frame = useCurrentFrame();
  return (
    <FullBg>
      <Glow x={W * 0.2} y={H * 0.4} r={500} opacity={0.15} />
      <Glow x={W * 0.8} y={H * 0.6} r={400} opacity={0.1} />
      <AbsoluteFill
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 60,
        }}
      >
        {/* left: logo */}
        <div
          style={{
            opacity: fadeIn(frame, 0, 25),
            transform: `scale(${pop(frame, 0, 35)})`,
            width: 200,
            height: 200,
            borderRadius: 44,
            overflow: "hidden",
            border: `4px solid ${COLORS.primary}`,
            boxShadow: `0 0 80px ${COLORS.primary}55`,
          }}
        >
          <Img src={staticFile("logo.png")} style={{ width: "100%", height: "100%" }} />
        </div>

        {/* right: text */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div
            style={{
              opacity: fadeIn(frame, 15, 22),
              transform: `translateY(${slideUp(frame, 15, 22)}px)`,
            }}
          >
            <SectionLabel text="Product Overview" />
          </div>

          <div
            style={{
              opacity: fadeIn(frame, 22, 22),
              transform: `translateY(${slideUp(frame, 22, 22)}px)`,
            }}
          >
            <h1
              style={{
                fontSize: 80,
                fontWeight: 900,
                color: COLORS.gray100,
                margin: 0,
                letterSpacing: -2,
                lineHeight: 1.05,
              }}
            >
              ClubCheck
            </h1>
            <h2
              style={{
                fontSize: 36,
                fontWeight: 500,
                color: COLORS.primary,
                margin: "8px 0 0",
              }}
            >
              Gym management without the chaos.
            </h2>
          </div>

          <div
            style={{
              opacity: fadeIn(frame, 45, 22),
              transform: `translateY(${slideUp(frame, 45, 22)}px)`,
              display: "flex",
              gap: 32,
              marginTop: 8,
            }}
          >
            {[
              { n: "14-Day", label: "Free Trial" },
              { n: "10 min", label: "Setup Time" },
              { n: "150", label: "Max Members" },
              { n: "$49.99", label: "Starting / mo" },
            ].map((s, i) => (
              <div key={i} style={{ textAlign: "center" }}>
                <div style={{ fontSize: 38, fontWeight: 800, color: COLORS.primary }}>{s.n}</div>
                <div style={{ fontSize: 16, color: COLORS.gray500 }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </AbsoluteFill>
    </FullBg>
  );
}

/* ─── Scene 2 (240-600): Who it's for ─── */
function SceneWho() {
  const frame = useCurrentFrame();
  const gyms = [
    "Boxing gyms",
    "CrossFit boxes",
    "MMA & martial arts",
    "Personal training studios",
    "Yoga & pilates studios",
    "Weightlifting clubs",
  ];
  const pains = [
    "Paper sign-in sheets",
    "Manual payment reminders",
    "No check-in history",
    "Staff permission chaos",
  ];
  return (
    <FullBg>
      <Glow x={W * 0.15} y={H * 0.3} r={400} opacity={0.1} />
      <Glow x={W * 0.85} y={H * 0.7} r={350} opacity={0.08} />
      <AbsoluteFill style={{ paddingTop: 80, padding: "80px 100px 60px", display: "flex", flexDirection: "column", gap: 40 }}>
        <div style={{ opacity: fadeIn(frame, 0, 20), transform: `translateY(${slideUp(frame, 0, 20)}px)` }}>
          <SectionLabel text="Who It's For" />
          <h2 style={{ fontSize: 52, fontWeight: 800, color: COLORS.gray100, margin: 0, lineHeight: 1.15 }}>
            Built for boutique fitness facilities<br />with{" "}
            <span style={{ color: COLORS.primary }}>10 – 150 members.</span>
          </h2>
        </div>

        <div style={{ display: "flex", gap: 60 }}>
          {/* gym types */}
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 20, color: COLORS.gray500, fontWeight: 600, marginBottom: 16, textTransform: "uppercase", letterSpacing: 2 }}>Gym Types</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {gyms.map((g, i) => (
                <div
                  key={g}
                  style={{
                    opacity: fadeIn(frame, 20 + i * 12, 15),
                    transform: `translateX(${smooth(frame, 20 + i * 12, 35 + i * 12, -40, 0)}px)`,
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    background: COLORS.bgCard,
                    border: `1px solid ${COLORS.border}`,
                    borderRadius: 10,
                    padding: "12px 20px",
                  }}
                >
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: COLORS.primary }} />
                  <span style={{ fontSize: 20, color: COLORS.gray300, fontWeight: 500 }}>{g}</span>
                </div>
              ))}
            </div>
          </div>

          {/* problems solved */}
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 20, color: COLORS.gray500, fontWeight: 600, marginBottom: 16, textTransform: "uppercase", letterSpacing: 2 }}>Problems We Solve</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {pains.map((p, i) => (
                <div
                  key={p}
                  style={{
                    opacity: fadeIn(frame, 30 + i * 15, 15),
                    transform: `translateX(${smooth(frame, 30 + i * 15, 45 + i * 15, 40, 0)}px)`,
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    background: "rgba(239,68,68,0.06)",
                    border: "1px solid rgba(239,68,68,0.2)",
                    borderRadius: 10,
                    padding: "12px 20px",
                  }}
                >
                  <span style={{ fontSize: 22 }}>❌</span>
                  <span style={{ fontSize: 20, color: COLORS.gray400, fontWeight: 500, textDecoration: "line-through" }}>{p}</span>
                </div>
              ))}
            </div>
            {/* replaced by */}
            <div style={{ marginTop: 16, opacity: fadeIn(frame, 100, 20) }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  background: COLORS.greenDim,
                  border: `1px solid ${COLORS.green}44`,
                  borderRadius: 10,
                  padding: "12px 20px",
                }}
              >
                <span style={{ fontSize: 22 }}>✅</span>
                <span style={{ fontSize: 20, color: COLORS.green, fontWeight: 600 }}>
                  Replaced by ClubCheck — one tool for all of it.
                </span>
              </div>
            </div>
          </div>
        </div>
      </AbsoluteFill>
    </FullBg>
  );
}

/* ─── Scene 3 (600-1050): Dashboard ─── */
function SceneDashboard() {
  const frame = useCurrentFrame();
  const stats = [
    { label: "Check-ins Today", value: "31", sub: "+4 vs yesterday", color: COLORS.primary },
    { label: "Active Members", value: "87", sub: "of 100 capacity", color: COLORS.green },
    { label: "Due This Week", value: "12", sub: "$1,440 pending", color: COLORS.primary },
    { label: "Top Streak", value: "🔥 22", sub: "days — Alex M.", color: "#f97316" },
  ];
  return (
    <FullBg>
      <Glow x={W * 0.5} y={H * 0.3} r={600} opacity={0.08} />
      <NavBar active="Dashboard" />
      <AbsoluteFill style={{ paddingTop: 80, padding: "100px 80px 40px" }}>
        <div style={{ opacity: fadeIn(frame, 0, 18), marginBottom: 32 }}>
          <SectionLabel text="Dashboard" />
          <h2 style={{ fontSize: 44, fontWeight: 800, color: COLORS.gray100, margin: 0 }}>
            Iron Valley Fitness — Today's Overview
          </h2>
          <p style={{ fontSize: 20, color: COLORS.gray500, margin: "6px 0 0" }}>
            Monday, February 24 · 10:42 AM
          </p>
        </div>

        {/* stats row */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 20, marginBottom: 28 }}>
          {stats.map((s, i) => (
            <Card
              key={i}
              style={{
                opacity: fadeIn(frame, 15 + i * 12, 18),
                transform: `translateY(${slideUp(frame, 15 + i * 12, 18)}px)`,
              }}
            >
              <p style={{ fontSize: 14, color: COLORS.gray500, margin: "0 0 8px", textTransform: "uppercase", letterSpacing: 1 }}>{s.label}</p>
              <p style={{ fontSize: 52, fontWeight: 900, color: s.color, margin: 0, lineHeight: 1 }}>{s.value}</p>
              <p style={{ fontSize: 14, color: COLORS.gray600, margin: "6px 0 0" }}>{s.sub}</p>
            </Card>
          ))}
        </div>

        {/* recent check-ins list */}
        <div style={{ opacity: fadeIn(frame, 60, 20) }}>
          <Card>
            <p style={{ fontSize: 16, fontWeight: 700, color: COLORS.gray300, marginBottom: 16, marginTop: 0 }}>Recent Check-Ins</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[
                { name: "Alex M.", time: "10:38 AM", streak: "22 days 🔥" },
                { name: "Sarah K.", time: "10:31 AM", streak: "8 days" },
                { name: "Jordan P.", time: "10:22 AM", streak: "3 days" },
                { name: "Chris T.", time: "10:14 AM", streak: "15 days 🔥" },
              ].map((r, i) => (
                <div
                  key={i}
                  style={{
                    opacity: fadeIn(frame, 70 + i * 8, 12),
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "10px 0",
                    borderBottom: i < 3 ? `1px solid ${COLORS.border}` : "none",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: "50%",
                        background: COLORS.primaryGlow,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: COLORS.primary,
                        fontWeight: 700,
                        fontSize: 14,
                      }}
                    >
                      {r.name.split(" ").map((n) => n[0]).join("")}
                    </div>
                    <span style={{ fontSize: 18, color: COLORS.gray200, fontWeight: 500 }}>{r.name}</span>
                  </div>
                  <div style={{ display: "flex", gap: 24 }}>
                    <span style={{ fontSize: 15, color: COLORS.gray500 }}>{r.time}</span>
                    <span style={{ fontSize: 15, color: COLORS.gray400 }}>{r.streak}</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </AbsoluteFill>
    </FullBg>
  );
}

/* ─── Scene 4 (1050-1500): Member Management ─── */
function SceneMembers() {
  const frame = useCurrentFrame();
  const members = [
    { name: "Alex Martinez", email: "alex@example.com", status: "Active", joined: "Jan 2025", streak: 22, payment: "Paid" },
    { name: "Sarah Kim", email: "sarah@example.com", status: "Active", joined: "Mar 2025", streak: 8, payment: "Due soon" },
    { name: "Jordan Park", email: "jordan@example.com", status: "Active", joined: "Nov 2024", streak: 3, payment: "Paid" },
    { name: "Chris Turner", email: "chris@example.com", status: "Inactive", joined: "Feb 2024", streak: 0, payment: "Overdue" },
  ];
  const statusColor: Record<string, string> = { Active: COLORS.green, Inactive: COLORS.gray500 };
  const payColor: Record<string, string> = { Paid: COLORS.green, "Due soon": COLORS.primary, Overdue: "#ef4444" };
  return (
    <FullBg>
      <NavBar active="Members" />
      <AbsoluteFill style={{ padding: "100px 80px 40px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 28 }}>
          <div style={{ opacity: fadeIn(frame, 0, 18) }}>
            <SectionLabel text="Members" />
            <h2 style={{ fontSize: 44, fontWeight: 800, color: COLORS.gray100, margin: 0 }}>
              Member Management
            </h2>
            <p style={{ fontSize: 20, color: COLORS.gray500, margin: "6px 0 0" }}>87 active · 13 inactive · 100 total</p>
          </div>
          <div style={{ opacity: fadeIn(frame, 10, 18), display: "flex", gap: 12 }}>
            <div
              style={{
                background: COLORS.bgCard,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 10,
                padding: "10px 20px",
                color: COLORS.gray400,
                fontSize: 16,
              }}
            >
              🔍  Search members...
            </div>
            <div
              style={{
                background: COLORS.primary,
                borderRadius: 10,
                padding: "10px 22px",
                color: "#000",
                fontSize: 16,
                fontWeight: 700,
              }}
            >
              + Add Member
            </div>
          </div>
        </div>

        {/* table */}
        <Card>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "2fr 1.5fr 1fr 1fr 1fr 1fr",
              gap: 0,
              borderBottom: `1px solid ${COLORS.border}`,
              paddingBottom: 12,
              marginBottom: 12,
            }}
          >
            {["Name", "Email", "Status", "Joined", "Streak", "Payment"].map((h) => (
              <span key={h} style={{ fontSize: 13, color: COLORS.gray600, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>{h}</span>
            ))}
          </div>
          {members.map((m, i) => (
            <div
              key={i}
              style={{
                opacity: fadeIn(frame, 20 + i * 15, 15),
                display: "grid",
                gridTemplateColumns: "2fr 1.5fr 1fr 1fr 1fr 1fr",
                alignItems: "center",
                padding: "14px 0",
                borderBottom: i < members.length - 1 ? `1px solid ${COLORS.border}` : "none",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: "50%",
                    background: COLORS.primaryGlow,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: COLORS.primary,
                    fontWeight: 700,
                    fontSize: 13,
                  }}
                >
                  {m.name.split(" ").map((n) => n[0]).join("")}
                </div>
                <span style={{ fontSize: 17, color: COLORS.gray200, fontWeight: 500 }}>{m.name}</span>
              </div>
              <span style={{ fontSize: 15, color: COLORS.gray500 }}>{m.email}</span>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 14,
                  color: statusColor[m.status],
                  fontWeight: 600,
                }}
              >
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: statusColor[m.status], display: "inline-block" }} />
                {m.status}
              </span>
              <span style={{ fontSize: 15, color: COLORS.gray500 }}>{m.joined}</span>
              <span style={{ fontSize: 15, color: m.streak > 0 ? COLORS.gray300 : COLORS.gray600 }}>
                {m.streak > 0 ? `${m.streak}d 🔥` : "—"}
              </span>
              <span
                style={{
                  display: "inline-block",
                  background: `${payColor[m.payment]}20`,
                  color: payColor[m.payment],
                  border: `1px solid ${payColor[m.payment]}44`,
                  borderRadius: 20,
                  padding: "4px 14px",
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                {m.payment}
              </span>
            </div>
          ))}
        </Card>

        {/* callout */}
        <div
          style={{
            opacity: fadeIn(frame, 100, 20),
            marginTop: 24,
            display: "flex",
            gap: 20,
          }}
        >
          {["CSV import in one click", "QR codes emailed automatically", "Full check-in history per member"].map((t, i) => (
            <div
              key={i}
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                gap: 10,
                background: COLORS.bgCard,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 10,
                padding: "12px 18px",
              }}
            >
              <span style={{ color: COLORS.green, fontSize: 18 }}>✓</span>
              <span style={{ fontSize: 16, color: COLORS.gray400 }}>{t}</span>
            </div>
          ))}
        </div>
      </AbsoluteFill>
    </FullBg>
  );
}

/* ─── Scene 5 (1500-1950): Kiosk QR Check-in ─── */
function SceneKiosk() {
  const frame = useCurrentFrame();
  const scanProgress = smooth(frame, 60, 100, 0, 1);
  return (
    <FullBg>
      <Glow x={W * 0.3} y={H * 0.5} r={500} opacity={0.12} />
      <AbsoluteFill style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 80 }}>
        {/* Kiosk screen mockup */}
        <div
          style={{
            opacity: fadeIn(frame, 0, 20),
            width: 380,
            background: COLORS.bgLighter,
            border: `2px solid ${COLORS.border}`,
            borderRadius: 28,
            padding: 40,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 24,
            boxShadow: "0 40px 100px rgba(0,0,0,0.5)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <div style={{ width: 22, height: 22, borderRadius: 4, overflow: "hidden" }}>
              <Img src={staticFile("logo.png")} style={{ width: "100%", height: "100%" }} />
            </div>
            <span style={{ color: COLORS.gray300, fontWeight: 700, fontSize: 18 }}>ClubCheck Kiosk</span>
          </div>

          <p style={{ fontSize: 22, color: COLORS.gray400, margin: 0, textAlign: "center" }}>
            Scan your QR code to check in
          </p>

          {/* QR scanner area */}
          <div
            style={{
              width: 220,
              height: 220,
              border: `2px solid ${COLORS.primary}`,
              borderRadius: 16,
              position: "relative",
              overflow: "hidden",
              background: COLORS.bgCard,
            }}
          >
            {/* scan line */}
            <div
              style={{
                position: "absolute",
                left: 8,
                right: 8,
                top: 8 + (220 - 16) * scanProgress,
                height: 2,
                background: `linear-gradient(90deg, transparent, ${COLORS.primary}, transparent)`,
                boxShadow: `0 0 12px ${COLORS.primary}`,
              }}
            />
            {/* corner brackets */}
            {[
              { top: 8, left: 8 },
              { top: 8, right: 8 },
              { bottom: 8, left: 8 },
              { bottom: 8, right: 8 },
            ].map((pos, i) => (
              <div
                key={i}
                style={{
                  position: "absolute",
                  width: 24,
                  height: 24,
                  borderColor: COLORS.primary,
                  borderStyle: "solid",
                  borderWidth: 0,
                  ...pos,
                  ...(i === 0 ? { borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 4 } : {}),
                  ...(i === 1 ? { borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 4 } : {}),
                  ...(i === 2 ? { borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 4 } : {}),
                  ...(i === 3 ? { borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 4 } : {}),
                }}
              />
            ))}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
              <span style={{ fontSize: 60 }}>📱</span>
            </div>
          </div>

          {/* success state */}
          {frame > 100 && (
            <div
              style={{
                opacity: fadeIn(frame, 100, 15),
                transform: `scale(${pop(frame, 100, 20)})`,
                width: "100%",
                background: COLORS.greenDim,
                border: `1px solid ${COLORS.green}44`,
                borderRadius: 12,
                padding: "16px 20px",
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: 36 }}>✅</div>
              <p style={{ fontSize: 20, fontWeight: 700, color: COLORS.green, margin: "6px 0 0" }}>
                Alex M. checked in!
              </p>
              <p style={{ fontSize: 14, color: COLORS.gray500, margin: "4px 0 0" }}>
                🔥 22-day streak
              </p>
            </div>
          )}
        </div>

        {/* callouts */}
        <div style={{ display: "flex", flexDirection: "column", gap: 24, maxWidth: 480 }}>
          <div style={{ opacity: fadeIn(frame, 0, 20) }}>
            <SectionLabel text="Kiosk Check-In" />
            <h2 style={{ fontSize: 52, fontWeight: 800, color: COLORS.gray100, margin: 0, lineHeight: 1.15 }}>
              Any tablet.
              <br />
              <span style={{ color: COLORS.primary }}>Zero friction.</span>
            </h2>
          </div>
          {[
            { icon: "📱", title: "No app download", desc: "QR code arrives via email. Members tap to open their portal in any browser." },
            { icon: "⚡", title: "Instant check-in", desc: "One scan logs attendance, updates streaks, and timestamps the visit." },
            { icon: "🖥️", title: "Works on any device", desc: "iPad, Android tablet, old laptop — if it has a camera and a browser, it works." },
          ].map((b, i) => (
            <div
              key={i}
              style={{
                opacity: fadeIn(frame, 20 + i * 20, 18),
                transform: `translateX(${smooth(frame, 20 + i * 20, 38 + i * 20, 40, 0)}px)`,
                display: "flex",
                gap: 16,
                alignItems: "flex-start",
              }}
            >
              <span style={{ fontSize: 30, marginTop: 2 }}>{b.icon}</span>
              <div>
                <p style={{ fontSize: 20, fontWeight: 700, color: COLORS.gray200, margin: 0 }}>{b.title}</p>
                <p style={{ fontSize: 16, color: COLORS.gray500, margin: "4px 0 0" }}>{b.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </AbsoluteFill>
    </FullBg>
  );
}

/* ─── Scene 6 (1950-2400): Payment Tracking ─── */
function ScenePayments() {
  const frame = useCurrentFrame();
  const members = [
    { name: "Alex M.", method: "Zelle", due: "Feb 28", status: "Paid", amount: "$99" },
    { name: "Sarah K.", method: "Cash", due: "Feb 26", status: "Due soon", amount: "$49" },
    { name: "Jordan P.", method: "Card", due: "Mar 1", status: "Paid", amount: "$99" },
    { name: "Chris T.", method: "Venmo", due: "Feb 20", status: "Overdue", amount: "$49" },
    { name: "Dana L.", method: "Cash", due: "Mar 5", status: "Paid", amount: "$99" },
  ];
  const statusColor: Record<string, string> = { Paid: COLORS.green, "Due soon": COLORS.primary, Overdue: "#ef4444" };
  return (
    <FullBg>
      <NavBar active="Payments" />
      <AbsoluteFill style={{ padding: "100px 80px 40px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 28 }}>
          <div style={{ opacity: fadeIn(frame, 0, 18) }}>
            <SectionLabel text="Payments" />
            <h2 style={{ fontSize: 44, fontWeight: 800, color: COLORS.gray100, margin: 0 }}>Payment Tracking</h2>
            <p style={{ fontSize: 20, color: COLORS.gray500, margin: "6px 0 0" }}>
              Supports cash, Zelle, Venmo, and card. Auto email reminders.
            </p>
          </div>
        </div>

        {/* summary chips */}
        <div style={{ display: "flex", gap: 16, marginBottom: 24, opacity: fadeIn(frame, 10, 18) }}>
          {[
            { label: "Collected this month", value: "$4,230", color: COLORS.green },
            { label: "Pending", value: "$490", color: COLORS.primary },
            { label: "Overdue", value: "$98", color: "#ef4444" },
          ].map((s, i) => (
            <div
              key={i}
              style={{
                background: `${s.color}15`,
                border: `1px solid ${s.color}33`,
                borderRadius: 12,
                padding: "14px 24px",
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              <span style={{ fontSize: 14, color: COLORS.gray500, textTransform: "uppercase", letterSpacing: 1 }}>{s.label}</span>
              <span style={{ fontSize: 32, fontWeight: 800, color: s.color }}>{s.value}</span>
            </div>
          ))}
        </div>

        <Card>
          {members.map((m, i) => (
            <div
              key={i}
              style={{
                opacity: fadeIn(frame, 20 + i * 12, 15),
                display: "grid",
                gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr",
                alignItems: "center",
                padding: "14px 0",
                borderBottom: i < members.length - 1 ? `1px solid ${COLORS.border}` : "none",
              }}
            >
              <span style={{ fontSize: 17, color: COLORS.gray200, fontWeight: 500 }}>{m.name}</span>
              <span style={{ fontSize: 15, color: COLORS.gray500 }}>{m.method}</span>
              <span style={{ fontSize: 15, color: COLORS.gray500 }}>Due {m.due}</span>
              <span style={{ fontSize: 17, fontWeight: 700, color: COLORS.gray200 }}>{m.amount}</span>
              <span
                style={{
                  display: "inline-block",
                  background: `${statusColor[m.status]}20`,
                  color: statusColor[m.status],
                  border: `1px solid ${statusColor[m.status]}44`,
                  borderRadius: 20,
                  padding: "4px 14px",
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                {m.status}
              </span>
            </div>
          ))}
        </Card>

        <div
          style={{
            opacity: fadeIn(frame, 100, 20),
            marginTop: 24,
            background: COLORS.bgCard,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 12,
            padding: "16px 24px",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <span style={{ fontSize: 24 }}>📧</span>
          <span style={{ fontSize: 18, color: COLORS.gray400 }}>
            Automated reminders sent <strong style={{ color: COLORS.gray200 }}>3 days before</strong> and on due date — no manual follow-up needed.
          </span>
        </div>
      </AbsoluteFill>
    </FullBg>
  );
}

/* ─── Scene 7 (2400-2850): Staff Accounts ─── */
function SceneStaff() {
  const frame = useCurrentFrame();
  const staff = [
    { name: "Maria R.", role: "Manager", code: "MR-449", perms: ["View members", "Log payments", "View analytics", "Manage staff"] },
    { name: "Dave S.", role: "Front Desk", code: "DS-201", perms: ["Operate kiosk", "View members"] },
    { name: "Jen T.", role: "Front Desk", code: "JT-883", perms: ["Operate kiosk", "View members"] },
  ];
  const roleColor: Record<string, string> = { Manager: COLORS.primary, "Front Desk": "#60a5fa" };
  return (
    <FullBg>
      <NavBar active="Staff" />
      <AbsoluteFill style={{ padding: "100px 80px 40px" }}>
        <div style={{ opacity: fadeIn(frame, 0, 18), marginBottom: 28 }}>
          <SectionLabel text="Staff" />
          <h2 style={{ fontSize: 44, fontWeight: 800, color: COLORS.gray100, margin: 0 }}>Staff Accounts & Permissions</h2>
          <p style={{ fontSize: 20, color: COLORS.gray500, margin: "6px 0 0" }}>
            Each staff member logs in with a 6-character code. No password sharing.
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 24 }}>
          {staff.map((s, i) => (
            <Card
              key={i}
              style={{
                opacity: fadeIn(frame, 15 + i * 20, 18),
                transform: `translateY(${slideUp(frame, 15 + i * 20, 18)}px)`,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                <div>
                  <p style={{ fontSize: 20, fontWeight: 700, color: COLORS.gray200, margin: 0 }}>{s.name}</p>
                  <span
                    style={{
                      display: "inline-block",
                      marginTop: 6,
                      background: `${roleColor[s.role]}20`,
                      color: roleColor[s.role],
                      border: `1px solid ${roleColor[s.role]}44`,
                      borderRadius: 20,
                      padding: "3px 12px",
                      fontSize: 13,
                      fontWeight: 700,
                    }}
                  >
                    {s.role}
                  </span>
                </div>
                <div
                  style={{
                    background: COLORS.bgCard,
                    border: `1px solid ${COLORS.border}`,
                    borderRadius: 8,
                    padding: "6px 12px",
                    fontFamily: FONT.mono,
                    fontSize: 16,
                    color: COLORS.primary,
                    letterSpacing: 2,
                  }}
                >
                  {s.code}
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <p style={{ fontSize: 12, color: COLORS.gray600, textTransform: "uppercase", letterSpacing: 1, margin: 0 }}>Permissions</p>
                {s.perms.map((p) => (
                  <div key={p} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ color: COLORS.green, fontSize: 14 }}>✓</span>
                    <span style={{ fontSize: 15, color: COLORS.gray400 }}>{p}</span>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>

        <div
          style={{
            opacity: fadeIn(frame, 90, 20),
            marginTop: 28,
            display: "flex",
            gap: 20,
          }}
        >
          {[
            "Owner keeps full control — staff only see what they need",
            "Login code is easy to revoke — no shared passwords",
            "Staff can run the kiosk without accessing billing or member data",
          ].map((t, i) => (
            <div
              key={i}
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                gap: 10,
                background: COLORS.bgCard,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 10,
                padding: "12px 18px",
              }}
            >
              <span style={{ color: COLORS.primary, fontSize: 18 }}>→</span>
              <span style={{ fontSize: 15, color: COLORS.gray400 }}>{t}</span>
            </div>
          ))}
        </div>
      </AbsoluteFill>
    </FullBg>
  );
}

/* ─── Scene 8 (2850-3300): Analytics ─── */
function SceneAnalytics() {
  const frame = useCurrentFrame();
  const bars = [38, 52, 29, 61, 74, 45, 31]; // check-ins per day
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const maxBar = Math.max(...bars);
  return (
    <FullBg>
      <NavBar active="Analytics" />
      <AbsoluteFill style={{ padding: "100px 80px 40px" }}>
        <div style={{ opacity: fadeIn(frame, 0, 18), marginBottom: 32 }}>
          <SectionLabel text="Analytics" />
          <h2 style={{ fontSize: 44, fontWeight: 800, color: COLORS.gray100, margin: 0 }}>
            Data that helps you make decisions.
          </h2>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 28 }}>
          {/* Bar chart */}
          <Card>
            <p style={{ fontSize: 16, fontWeight: 600, color: COLORS.gray400, margin: "0 0 20px" }}>Check-ins This Week</p>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 16, height: 180 }}>
              {bars.map((b, i) => {
                const pct = b / maxBar;
                const heightPx = smooth(frame, 20 + i * 8, 40 + i * 8, 0, pct * 180);
                return (
                  <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 13, color: COLORS.gray500 }}>{b}</span>
                    <div
                      style={{
                        width: "100%",
                        height: heightPx,
                        background: `linear-gradient(180deg, ${COLORS.primary} 0%, ${COLORS.primaryDark} 100%)`,
                        borderRadius: "4px 4px 0 0",
                        opacity: fadeIn(frame, 20 + i * 8, 15),
                      }}
                    />
                    <span style={{ fontSize: 13, color: COLORS.gray600 }}>{days[i]}</span>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* stats */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {[
              { label: "Peak day", value: "Friday", sub: "74 avg check-ins", icon: "📅" },
              { label: "Peak hour", value: "6–7 PM", sub: "highest traffic window", icon: "🕕" },
              { label: "Avg visits/member", value: "4.2x", sub: "per week", icon: "📈" },
              { label: "Retention rate", value: "88%", sub: "30-day rolling", icon: "💪" },
            ].map((s, i) => (
              <Card
                key={i}
                style={{
                  opacity: fadeIn(frame, 20 + i * 15, 15),
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  padding: "16px 20px",
                }}
              >
                <span style={{ fontSize: 26 }}>{s.icon}</span>
                <div>
                  <span style={{ fontSize: 13, color: COLORS.gray600, textTransform: "uppercase", letterSpacing: 1 }}>{s.label}</span>
                  <p style={{ fontSize: 22, fontWeight: 800, color: COLORS.primary, margin: "2px 0 0" }}>{s.value}</p>
                  <p style={{ fontSize: 13, color: COLORS.gray600, margin: 0 }}>{s.sub}</p>
                </div>
              </Card>
            ))}
          </div>
        </div>
      </AbsoluteFill>
    </FullBg>
  );
}

/* ─── Scene 9 (3300-3750): Member Portal ─── */
function SceneMemberPortal() {
  const frame = useCurrentFrame();
  return (
    <FullBg>
      <Glow x={W * 0.25} y={H * 0.5} r={500} opacity={0.1} />
      <AbsoluteFill style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 80 }}>
        {/* phone mockup */}
        <div
          style={{
            opacity: fadeIn(frame, 0, 22),
            transform: `scale(${pop(frame, 0, 30)})`,
            width: 300,
            background: COLORS.bgLighter,
            border: `2px solid ${COLORS.border}`,
            borderRadius: 40,
            padding: "28px 24px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 20,
            boxShadow: "0 40px 100px rgba(0,0,0,0.6)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 20, height: 20, borderRadius: 4, overflow: "hidden" }}>
              <Img src={staticFile("logo.png")} style={{ width: "100%", height: "100%" }} />
            </div>
            <span style={{ color: COLORS.gray300, fontWeight: 700, fontSize: 14 }}>ClubCheck</span>
          </div>

          {/* avatar */}
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: "50%",
              background: COLORS.primaryGlow,
              border: `2px solid ${COLORS.primary}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 28,
              fontWeight: 800,
              color: COLORS.primary,
            }}
          >
            AM
          </div>
          <div style={{ textAlign: "center" }}>
            <p style={{ fontSize: 18, fontWeight: 700, color: COLORS.gray100, margin: 0 }}>Alex Martinez</p>
            <p style={{ fontSize: 13, color: COLORS.primary, margin: "4px 0 0" }}>🔥 22-day streak</p>
          </div>

          {/* QR code placeholder */}
          <div
            style={{
              width: 160,
              height: 160,
              border: `2px solid ${COLORS.primary}`,
              borderRadius: 12,
              display: "grid",
              gridTemplateColumns: "repeat(5, 1fr)",
              padding: 10,
              gap: 3,
              background: COLORS.bgCard,
            }}
          >
            {Array.from({ length: 25 }).map((_, i) => {
              const row = Math.floor(i / 5);
              const col = i % 5;
              const corner = (row < 2 && col < 2) || (row < 2 && col > 2) || (row > 2 && col < 2);
              return (
                <div
                  key={i}
                  style={{
                    background: corner || [7, 8, 11, 13, 16, 17, 19, 22].includes(i) ? COLORS.primary : "transparent",
                    borderRadius: 2,
                  }}
                />
              );
            })}
          </div>

          {/* mini history */}
          <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 6 }}>
            <p style={{ fontSize: 11, color: COLORS.gray600, textTransform: "uppercase", letterSpacing: 1, margin: 0 }}>Recent visits</p>
            {["Today · 10:38 AM", "Yesterday · 6:12 PM", "Feb 22 · 7:04 AM"].map((d, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: `1px solid ${COLORS.border}` }}>
                <span style={{ fontSize: 12, color: COLORS.gray500 }}>{d}</span>
                <span style={{ color: COLORS.green, fontSize: 12 }}>✓</span>
              </div>
            ))}
          </div>
        </div>

        {/* right: callouts */}
        <div style={{ display: "flex", flexDirection: "column", gap: 24, maxWidth: 500 }}>
          <div style={{ opacity: fadeIn(frame, 0, 18) }}>
            <SectionLabel text="Member Portal" />
            <h2 style={{ fontSize: 52, fontWeight: 800, color: COLORS.gray100, margin: 0, lineHeight: 1.15 }}>
              Members self-serve.
              <br />
              <span style={{ color: COLORS.primary }}>No app required.</span>
            </h2>
          </div>
          {[
            { icon: "📧", title: "Email-delivered QR", desc: "QR code sent on signup. Members access their portal via any browser." },
            { icon: "🏠", title: "Add to home screen", desc: "One-tap access from iPhone or Android without installing anything." },
            { icon: "📊", title: "Personal history", desc: "Each member sees their own check-in log, current streak, and longest streak." },
          ].map((b, i) => (
            <div
              key={i}
              style={{
                opacity: fadeIn(frame, 18 + i * 20, 18),
                transform: `translateX(${smooth(frame, 18 + i * 20, 36 + i * 20, 40, 0)}px)`,
                display: "flex",
                gap: 16,
                alignItems: "flex-start",
              }}
            >
              <span style={{ fontSize: 30 }}>{b.icon}</span>
              <div>
                <p style={{ fontSize: 20, fontWeight: 700, color: COLORS.gray200, margin: 0 }}>{b.title}</p>
                <p style={{ fontSize: 16, color: COLORS.gray500, margin: "4px 0 0" }}>{b.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </AbsoluteFill>
    </FullBg>
  );
}

/* ─── Scene 10 (3750-4200): Setup ─── */
function SceneSetup() {
  const frame = useCurrentFrame();
  const steps = [
    {
      n: "01",
      title: "Create your account",
      desc: "Sign up with email or Google. Enter your gym name. Your dashboard is live in under 60 seconds.",
      time: "~1 min",
    },
    {
      n: "02",
      title: "Add your members",
      desc: "Add members one by one or import a CSV. Every member gets their QR code emailed automatically.",
      time: "~5 min",
    },
    {
      n: "03",
      title: "Open your kiosk",
      desc: "Open ClubCheck on any tablet at the front desk. Members scan to check in — you're done.",
      time: "~2 min",
    },
  ];
  return (
    <FullBg>
      <Glow x={W / 2} y={H * 0.4} r={600} opacity={0.1} />
      <AbsoluteFill style={{ padding: "80px 120px", display: "flex", flexDirection: "column", gap: 48 }}>
        <div style={{ opacity: fadeIn(frame, 0, 20), textAlign: "center" }}>
          <SectionLabel text="Getting Started" />
          <h2 style={{ fontSize: 56, fontWeight: 900, color: COLORS.gray100, margin: "8px 0 0" }}>
            Up and running in{" "}
            <span style={{ color: COLORS.primary }}>10 minutes.</span>
          </h2>
          <p style={{ fontSize: 22, color: COLORS.gray500, margin: "8px 0 0" }}>
            No technical setup. No IT required. Just sign up and go.
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 32 }}>
          {steps.map((s, i) => (
            <div
              key={i}
              style={{
                opacity: fadeIn(frame, 20 + i * 25, 22),
                transform: `translateY(${slideUp(frame, 20 + i * 25, 22)}px)`,
              }}
            >
              <Card style={{ height: "100%", position: "relative" }}>
                <div
                  style={{
                    position: "absolute",
                    top: -1,
                    left: -1,
                    right: -1,
                    height: 3,
                    background: `linear-gradient(90deg, ${COLORS.primary}, ${COLORS.primaryLight})`,
                    borderRadius: "16px 16px 0 0",
                  }}
                />
                <div
                  style={{
                    fontSize: 48,
                    fontWeight: 900,
                    color: COLORS.primary,
                    fontFamily: FONT.mono,
                    marginBottom: 12,
                  }}
                >
                  {s.n}
                </div>
                <h3 style={{ fontSize: 22, fontWeight: 700, color: COLORS.gray100, margin: "0 0 10px" }}>{s.title}</h3>
                <p style={{ fontSize: 16, color: COLORS.gray500, lineHeight: 1.6, margin: 0 }}>{s.desc}</p>
                <div
                  style={{
                    marginTop: 16,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    background: COLORS.greenDim,
                    border: `1px solid ${COLORS.green}33`,
                    borderRadius: 20,
                    padding: "4px 14px",
                  }}
                >
                  <span style={{ fontSize: 13, color: COLORS.green, fontWeight: 600 }}>⏱ {s.time}</span>
                </div>
              </Card>
            </div>
          ))}
        </div>
      </AbsoluteFill>
    </FullBg>
  );
}

/* ─── Scene 11 (4200-4650): Pricing ─── */
function ScenePricing() {
  const frame = useCurrentFrame();
  const features = [
    "QR check-ins & kiosk mode",
    "Member management & CSV import",
    "Payment tracking & reminders",
    "Dashboard & analytics",
    "Staff accounts",
    "Broadcast messaging",
    "Member portal",
  ];
  return (
    <FullBg>
      <Glow x={W * 0.3} y={H * 0.5} r={500} opacity={0.1} />
      <Glow x={W * 0.75} y={H * 0.4} r={450} opacity={0.1} />
      <AbsoluteFill style={{ padding: "80px 120px", display: "flex", flexDirection: "column", gap: 40 }}>
        <div style={{ opacity: fadeIn(frame, 0, 20), textAlign: "center" }}>
          <SectionLabel text="Pricing" />
          <h2 style={{ fontSize: 56, fontWeight: 900, color: COLORS.gray100, margin: "8px 0 0" }}>
            Simple, transparent pricing.
          </h2>
          <p style={{ fontSize: 20, color: COLORS.gray500, margin: "8px 0 0" }}>
            14-day free trial. No credit card. No contracts. Cancel anytime.
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32, maxWidth: 900, margin: "0 auto", width: "100%" }}>
          {/* Starter */}
          <Card
            style={{
              opacity: fadeIn(frame, 15, 20),
              transform: `translateY(${slideUp(frame, 15, 20)}px)`,
            }}
          >
            <h3 style={{ fontSize: 28, fontWeight: 800, color: COLORS.gray100, margin: "0 0 4px" }}>Starter</h3>
            <p style={{ fontSize: 16, color: COLORS.gray500, margin: "0 0 20px" }}>Up to 75 members</p>
            <div style={{ marginBottom: 20 }}>
              <span style={{ fontSize: 56, fontWeight: 900, color: COLORS.gray100 }}>$49.99</span>
              <span style={{ fontSize: 18, color: COLORS.gray500 }}>/month</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {features.map((f) => (
                <div key={f} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ color: COLORS.green, fontSize: 16 }}>✓</span>
                  <span style={{ fontSize: 16, color: COLORS.gray400 }}>{f}</span>
                </div>
              ))}
            </div>
          </Card>

          {/* Pro */}
          <Card
            style={{
              opacity: fadeIn(frame, 28, 20),
              transform: `translateY(${slideUp(frame, 28, 20)}px)`,
              border: `1px solid ${COLORS.primary}66`,
              position: "relative",
            }}
          >
            <div
              style={{
                position: "absolute",
                top: -14,
                left: 24,
                background: COLORS.primary,
                color: "#000",
                fontSize: 13,
                fontWeight: 700,
                borderRadius: 20,
                padding: "4px 16px",
              }}
            >
              Most Popular
            </div>
            <h3 style={{ fontSize: 28, fontWeight: 800, color: COLORS.gray100, margin: "0 0 4px" }}>Pro</h3>
            <p style={{ fontSize: 16, color: COLORS.gray500, margin: "0 0 20px" }}>Up to 150 members</p>
            <div style={{ marginBottom: 20 }}>
              <span style={{ fontSize: 56, fontWeight: 900, color: COLORS.gray100 }}>$99.99</span>
              <span style={{ fontSize: 18, color: COLORS.gray500 }}>/month</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {["Everything in Starter", "Up to 150 active members", "Priority email support", "Advanced analytics"].map((f) => (
                <div key={f} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ color: COLORS.green, fontSize: 16 }}>✓</span>
                  <span style={{ fontSize: 16, color: COLORS.gray400 }}>{f}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div
          style={{
            opacity: fadeIn(frame, 60, 20),
            display: "flex",
            justifyContent: "center",
            gap: 48,
          }}
        >
          {["No credit card to start", "Save ~$100/yr with annual billing", "Cancel anytime — data preserved"].map((t, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ color: COLORS.green }}>✓</span>
              <span style={{ fontSize: 16, color: COLORS.gray500 }}>{t}</span>
            </div>
          ))}
        </div>
      </AbsoluteFill>
    </FullBg>
  );
}

/* ─── Scene 12 (4650-5100): Q&A / Objections ─── */
function SceneQA() {
  const frame = useCurrentFrame();
  const qa = [
    { q: "Do members need to download an app?", a: "No. QR code arrives by email. They open the portal in any browser — or add it to their home screen." },
    { q: "What equipment does the kiosk need?", a: "Any device with a camera and a browser. An iPad or $80 Android tablet works perfectly." },
    { q: "What if we need to cancel?", a: "Cancel from the billing page anytime. Access stays through the end of the billing period. All data preserved." },
    { q: "Is our member data secure?", a: "HTTPS, hashed passwords (bcrypt), signed JWT tokens, Stripe PCI-DSS Level 1. Each gym's data is fully isolated." },
  ];
  return (
    <FullBg>
      <Glow x={W * 0.8} y={H * 0.3} r={400} opacity={0.08} />
      <AbsoluteFill style={{ padding: "80px 120px", display: "flex", flexDirection: "column", gap: 40 }}>
        <div style={{ opacity: fadeIn(frame, 0, 20) }}>
          <SectionLabel text="Common Questions" />
          <h2 style={{ fontSize: 52, fontWeight: 800, color: COLORS.gray100, margin: "8px 0 0" }}>
            Answers before you ask.
          </h2>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          {qa.map((item, i) => (
            <Card
              key={i}
              style={{
                opacity: fadeIn(frame, 15 + i * 18, 18),
                transform: `translateY(${slideUp(frame, 15 + i * 18, 18)}px)`,
              }}
            >
              <p style={{ fontSize: 18, fontWeight: 700, color: COLORS.gray100, margin: "0 0 10px" }}>
                {item.q}
              </p>
              <p style={{ fontSize: 16, color: COLORS.gray500, margin: 0, lineHeight: 1.6 }}>
                {item.a}
              </p>
            </Card>
          ))}
        </div>
      </AbsoluteFill>
    </FullBg>
  );
}

/* ─── Scene 13 (5100-5400): CTA ─── */
function SceneCTA() {
  const frame = useCurrentFrame();
  return (
    <FullBg>
      <Glow x={W / 2} y={H / 2} r={700} opacity={0.18} />
      <AbsoluteFill
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 40,
        }}
      >
        <div
          style={{
            opacity: fadeIn(frame, 0, 22),
            transform: `scale(${pop(frame, 0, 30)})`,
            width: 140,
            height: 140,
            borderRadius: 30,
            overflow: "hidden",
            border: `3px solid ${COLORS.primary}`,
            boxShadow: `0 0 80px ${COLORS.primary}66`,
          }}
        >
          <Img src={staticFile("logo.png")} style={{ width: "100%", height: "100%" }} />
        </div>

        <div style={{ textAlign: "center", opacity: fadeIn(frame, 15, 22) }}>
          <h1 style={{ fontSize: 80, fontWeight: 900, color: COLORS.gray100, margin: 0, letterSpacing: -2 }}>
            Ready to simplify your gym?
          </h1>
          <p style={{ fontSize: 28, color: COLORS.gray400, margin: "12px 0 0" }}>
            14-day free trial · No credit card · Set up in 10 minutes
          </p>
        </div>

        <div
          style={{
            opacity: fadeIn(frame, 30, 20),
            display: "flex",
            gap: 24,
            alignItems: "center",
          }}
        >
          <div
            style={{
              background: COLORS.primary,
              color: "#000",
              fontWeight: 800,
              fontSize: 28,
              borderRadius: 14,
              padding: "20px 56px",
            }}
          >
            Start Free Trial → clubcheckapp.com
          </div>
          <div
            style={{
              background: "transparent",
              color: COLORS.gray400,
              fontWeight: 600,
              fontSize: 22,
              borderRadius: 14,
              padding: "20px 32px",
              border: `1px solid ${COLORS.border}`,
            }}
          >
            Book a Demo
          </div>
        </div>

        <div
          style={{
            opacity: fadeIn(frame, 50, 20),
            display: "flex",
            gap: 48,
          }}
        >
          {["Starter: $49.99/mo · 75 members", "Pro: $99.99/mo · 150 members", "Operated by BlueLoom Ventures LLC"].map((t, i) => (
            <span key={i} style={{ fontSize: 16, color: COLORS.gray600 }}>{t}</span>
          ))}
        </div>
      </AbsoluteFill>
    </FullBg>
  );
}

/* ─── Main Composition ─── */
export function SalesDemo() {
  return (
    <AbsoluteFill>
      <Sequence from={0} durationInFrames={240}><SceneTitle /></Sequence>
      <Sequence from={240} durationInFrames={360}><SceneWho /></Sequence>
      <Sequence from={600} durationInFrames={450}><SceneDashboard /></Sequence>
      <Sequence from={1050} durationInFrames={450}><SceneMembers /></Sequence>
      <Sequence from={1500} durationInFrames={450}><SceneKiosk /></Sequence>
      <Sequence from={1950} durationInFrames={450}><ScenePayments /></Sequence>
      <Sequence from={2400} durationInFrames={450}><SceneStaff /></Sequence>
      <Sequence from={2850} durationInFrames={450}><SceneAnalytics /></Sequence>
      <Sequence from={3300} durationInFrames={450}><SceneMemberPortal /></Sequence>
      <Sequence from={3750} durationInFrames={450}><SceneSetup /></Sequence>
      <Sequence from={4200} durationInFrames={450}><ScenePricing /></Sequence>
      <Sequence from={4650} durationInFrames={450}><SceneQA /></Sequence>
      <Sequence from={5100} durationInFrames={300}><SceneCTA /></Sequence>
    </AbsoluteFill>
  );
}
