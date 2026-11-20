import { Plane, Baby, AlertTriangle, MoreHorizontal, HeartPulse, Users, Stethoscope } from "lucide-react";

/* ─────────────────── Leave types ───────────────────
   One list, used by the rota, the Staff tab, the Leave tab, Statistics and
   the exports, so a leave type always looks and counts the same way.

   A leave period lives on the staff row:
       staff.leavePeriods = [{ id, type, start, end, label? }]
   (label only for "other", the custom name). Adding a type here adds no
   database column — it is just a new value in that list.

   SL, FRL and ML can be a rota code OR a leave period. Statistics counts
   them in the same column either way, and a day inside a leave period skips
   that day's rota cell, so a day is never counted twice. */

export const LEAVE_STYLES = {
  annual:       { label: "Annual Leave",         abbrev: "AL",  bg: "#D8EEE9", fg: "#0B6A60", icon: Plane },
  maternity:    { label: "Maternity",            abbrev: "MAT", bg: "#E9E9E9", fg: "#5A6B72", icon: Baby },
  prematernity: { label: "Pre-Maternity",        abbrev: "PML", bg: "#F6E0EC", fg: "#9C3D6E", icon: Baby },
  paternity:    { label: "Paternity",            abbrev: "PAT", bg: "#DDE8F8", fg: "#2D4E8A", icon: Users },
  emergency:    { label: "Emergency Leave",      abbrev: "EL",  bg: "#FBE3DF", fg: "#B3532F", icon: AlertTriangle },
  sl:           { label: "Sick Leave",           abbrev: "SL",  bg: "#FBD9D2", fg: "#8A2E1E", icon: HeartPulse },
  frl:          { label: "Family Related Leave", abbrev: "FRL", bg: "#F3DDF1", fg: "#7A2F74", icon: Users },
  ml:           { label: "Medical Leave",        abbrev: "ML",  bg: "#E4DBF0", fg: "#4B2C77", icon: Stethoscope },
  other:        { label: "Other Extended Leave", abbrev: "LV",  bg: "#E6E4F5", fg: "#4E4A8C", icon: MoreHorizontal },
};

// The order every picker shows them in.
export const LEAVE_TYPE_OPTIONS = [
  ["annual", "Annual leave"], ["maternity", "Maternity"], ["prematernity", "Pre-maternity"],
  ["paternity", "Paternity"], ["emergency", "Emergency leave"],
  ["sl", "Sick leave (SL)"], ["frl", "Family related leave (FRL)"], ["ml", "Medical leave (ML)"],
  ["other", "Other extended leave (custom name)"],
];

// Readable text on any background colour.
const luminance = (hex) => {
  const h = (hex || "").replace("#", "");
  if (h.length < 6) return 1;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.299 * r + 0.587 * g + 0.114 * b;
};
export const textOnBg = (hex) => (luminance(hex) > 0.6 ? "#0E3A47" : "#FFFFFF");

/* A period's look. `colors` is the department's own choice per type
   (data.leaveColors, e.g. { annual: "#A7D7C5" }); without it the defaults
   above apply, so rotas saved before this look exactly as they did. */
export const styleFor = (period, colors = null) => {
  const base = LEAVE_STYLES[period.type] || LEAVE_STYLES.other;
  const picked = colors && colors[period.type];
  const looks = picked ? { ...base, bg: picked, fg: textOnBg(picked) } : base;
  return period.type === "other" && period.label ? { ...looks, label: period.label } : looks;
};

// 20 soft colours for the Leave tab's picker, plus "any colour" there.
export const LEAVE_PALETTE = [
  "#D8EEE9", "#BFE3D3", "#A7D7C5", "#CDEBF4", "#A9D3E0", "#DDE8F8", "#B9CDF0",
  "#E4DBF0", "#C9B8EC", "#F3DDF1", "#F6E0EC", "#F4C0D1", "#FBD9D2", "#FBE3DF",
  "#F5C4B3", "#FFF0CF", "#FAD9A0", "#E3F3DA", "#C0DD97", "#E9E9E9",
];
