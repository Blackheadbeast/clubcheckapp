export const COLORS = {
  bg: "#0a0a0a",
  bgLighter: "#111111",
  bgCard: "#171717",
  border: "#1f1f1f",
  primary: "#f59e0b",
  primaryDark: "#d97706",
  primaryLight: "#fbbf24",
  primaryGlow: "rgba(245,158,11,0.15)",
  gray100: "#f3f4f6",
  gray200: "#e5e7eb",
  gray300: "#d1d5db",
  gray400: "#9ca3af",
  gray500: "#6b7280",
  gray600: "#4b5563",
  gray700: "#374151",
  gray800: "#1f2937",
  green: "#22c55e",
  greenDim: "rgba(34,197,94,0.15)",
} as const;

export const FONT = {
  sans: "Inter, system-ui, -apple-system, sans-serif",
  mono: "'JetBrains Mono', 'Fira Code', monospace",
} as const;

export const FEATURES = [
  { icon: "qr", title: "QR Check-Ins", desc: "Each member gets a unique QR code. Instant scan-and-go at the kiosk." },
  { icon: "members", title: "Member Management", desc: "Add, search, and track all members with status, streaks, and history." },
  { icon: "payment", title: "Payment Tracking", desc: "Log cash, Zelle, or card payments. Auto email reminders before due dates." },
  { icon: "staff", title: "Staff Accounts", desc: "Front desk and manager roles with scoped permissions." },
  { icon: "analytics", title: "Dashboard & Analytics", desc: "Today's check-ins, peak hours, revenue — at a glance." },
  { icon: "portal", title: "Member Portal", desc: "Members access their QR code and history in any browser. No app needed." },
] as const;
