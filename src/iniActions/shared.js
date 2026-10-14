/* ─────────────── Ini's actions: shared helpers ───────────────
   Dates in plain words, the names the app shows for leave types and
   duties, and a few small readings of the rota that more than one action
   needs. Pure functions only. */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const isISO = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
export const parseISO = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
export const dayMonth = (s) => { const d = parseISO(s); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };
export const withWeekday = (s) => `${WEEKDAYS[parseISO(s).getDay()]} ${dayMonth(s)}`;
// "10–15 Nov", "28 Nov – 3 Dec", or one day on its own.
export const rangeLabel = (a, b) => {
  if (a === b) return dayMonth(a);
  const x = parseISO(a), y = parseISO(b);
  if (x.getFullYear() !== y.getFullYear()) {
    return `${dayMonth(a)} ${x.getFullYear()} – ${dayMonth(b)} ${y.getFullYear()}`;
  }
  if (x.getMonth() === y.getMonth()) return `${x.getDate()}–${dayMonth(b)}`;
  return `${dayMonth(a)} – ${dayMonth(b)}`;
};
export const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
// "a, b and c"
export const listWords = (parts) =>
  parts.length <= 1 ? (parts[0] || "") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;

// The leave types the Staff tab offers, with the labels it shows.
export const LEAVE_TYPES = [
  ["annual", "Annual leave"],
  ["maternity", "Maternity"],
  ["prematernity", "Pre-maternity"],
  ["emergency", "Emergency leave"],
  ["other", "Other extended leave"],
];
export const LEAVE_LABEL = Object.fromEntries(LEAVE_TYPES);
export const DUTIES = ["morning", "afternoon", "evening", "night", "off"];
export const REQUEST_LABEL = {
  morning: "Morning duty", afternoon: "Afternoon duty", evening: "Evening duty",
  night: "Night duty", off: "Off day",
};
export const SHIFT_LABELS = { morning: "morning", afternoon: "afternoon", evening: "evening", night: "night" };

export const staffOf = (data, id) => (data.staff || []).find((s) => s.id === id) || null;
export const leaveOn = (person, date) =>
  (person?.leavePeriods || []).find((lp) => date >= lp.start && date <= lp.end) || null;
export const leaveName = (p) => (p.type === "other" && p.label ? p.label : (LEAVE_LABEL[p.type] || "leave"));
