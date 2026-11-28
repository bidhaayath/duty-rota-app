/* ─────────────── Extra figures for the Statistics screen ───────────────
   The redesigned Statistics screen shows a few things the old one did not:
   the rota as coloured squares, where people worked (posts), who took each
   kind of leave, and who did the most duties.

   Everything here only READS the rota. Nothing is saved.

   It counts with the same rules as the rest of the app (rotaCounts.js):
   a day inside a leave period skips that day's rota cell, a person only
   counts while employed, and posts are read through entriesOf so a cell
   can be a plain code id or a list of duties.

   The per-person totals (duties, SL, FRL, ML, annual days) come in from
   recordsFor() as `rows`, unchanged, so the numbers on this screen are the
   same numbers Staff Records shows. statsModel.test.js checks that the
   names-and-days lists here add up to exactly those totals.          */
import { DUTY_CATS, isNonOff, leaveOn, codeByIdOf, cellEntries, isEmployedOn } from "./rotaCounts";

const pad = (n) => String(n).padStart(2, "0");
const parseD = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const dstr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (s, n) => { const d = parseD(s); d.setDate(d.getDate() + n); return dstr(d); };
const datesBetween = (from, to) => { const out = []; let d = from; while (d <= to) { out.push(d); d = addDays(d, 1); } return out; };
const spanDays = (a, b) => Math.round((parseD(b) - parseD(a)) / 86400000) + 1;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const dayMonth = (s) => { const d = parseD(s); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };
// "3 Dec", "8–19 Dec", "28 Nov – 3 Dec"
const rangeText = (a, b) => {
  if (a === b) return dayMonth(a);
  const A = parseD(a), B = parseD(b);
  return A.getMonth() === B.getMonth() && A.getFullYear() === B.getFullYear()
    ? `${A.getDate()}–${B.getDate()} ${MONTHS[B.getMonth()]}`
    : `${dayMonth(a)} – ${dayMonth(b)}`;
};
// A sorted list of dates as runs: ["1 Dec", "8–10 Dec"]
const runsText = (dates) => {
  const out = []; let s = null, prev = null;
  [...dates].sort().forEach((d) => {
    if (s && addDays(prev, 1) === d) { prev = d; return; }
    if (s) out.push(rangeText(s, prev));
    s = d; prev = d;
  });
  if (s) out.push(rangeText(s, prev));
  return out.join(", ");
};

/* Chart colours. Softer than the rota's own code colours, and tested to be
   told apart with colour blindness. The rota grid keeps each department's
   own code colours; only the charts use these. */
export const SHIFT_COLOURS = {
  morning: "#CF9A52", afternoon: "#6AA37A", evening: "#B8739B", night: "#5B82B8",
  other: "#9089BD", release: "#A98466",
};
export const SHIFT_NAMES = {
  morning: "Morning", afternoon: "Afternoon", evening: "Evening", night: "Night",
  other: "Other duty", release: "Release",
};
const LEAVE_COLOURS = {
  annual: "#86C2B6", maternity: "#B3BEC3", prematernity: "#D3A3BC", paternity: "#9DB2D5",
  emergency: "#DDA58E", other: "#B3AEDA", sl: "#DDA5A5", frl: "#C8A2CE", ml: "#A69AC8",
  otherCodes: "#C2C8CC",
};
export const OFF_COLOUR = "#E2EBEE";
const POST_COLOURS = ["#2F7F8F", "#6FA3B0", "#A9C7CF", "#1D4E5C", "#4E9AA8", "#8DB6C0", "#3B6670", "#C3D9DE"];

/* Which leave column a code feeds — the same rule as leaveBucket() in
   DutyRotaOriginal.js, repeated here so this file can be tested alone. */
export const leaveBucketOf = (code) => {
  if (["sl", "frl", "ml"].includes(code.counts)) return code.counts;
  if (code.counts !== "leave") return null;
  const c = (code.code || "").toUpperCase();
  return c === "SL" ? "sl" : c === "FRL" ? "frl" : c === "ML" ? "ml" : "other";
};

const PERIOD_LEAVE = [
  ["annual", "Annual leave"], ["maternity", "Maternity"], ["prematernity", "Pre-maternity"],
  ["paternity", "Paternity"], ["emergency", "Emergency leave"], ["other", "Other extended leave"],
];
const CODE_LEAVE = [["sl", "Sick leave (SL)"], ["frl", "Family related leave (FRL)"], ["ml", "Medical leave (ML)"]];

export function buildStatsModel(data, rows, from, to, labelOf = (s) => s.name) {
  const codeById = codeByIdOf(data);
  const dates = datesBetween(from, to);
  const clip = (p) => {
    const a = p.start > from ? p.start : from, b = p.end < to ? p.end : to;
    return a > b ? null : [a, b];
  };

  /* ── Non-official dates in the range ── */
  const nodDates = dates.filter((d) => isNonOff(data, d));

  /* ── Who is on annual leave, and when ── */
  const away = [];
  rows.forEach((r) => (r.staff.leavePeriods || []).forEach((p) => {
    if (p.type !== "annual") return;
    const c = clip(p); if (!c) return;
    const when = p.start < from && p.end > to ? "all of this range"
      : p.end > to ? `from ${dayMonth(c[0])}` : p.start < from ? `until ${dayMonth(c[1])}` : rangeText(c[0], c[1]);
    away.push({ id: r.staff.id + p.id, name: r.staff.name, start: c[0], when });
  }));
  away.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));

  /* ── Shift mix: every duty worked, by shift ── */
  const mixKeys = ["morning", "afternoon", "evening", "night", "other", "release"];
  const mixTotals = mixKeys.map((k) => [k, rows.reduce((a, r) => a + (r[k] || 0), 0)]).filter(([, n]) => n > 0);
  const mixTotal = mixTotals.reduce((a, [, n]) => a + n, 0);
  const mix = {
    total: mixTotal,
    items: mixTotals.map(([k, n]) => ({ key: k, name: SHIFT_NAMES[k], colour: SHIFT_COLOURS[k], n, pct: mixTotal ? Math.round((n / mixTotal) * 100) : 0 })),
  };

  /* ── Duties per person, most first ── */
  const segsOf = (r) => mixKeys.filter((k) => r[k]).map((k) => ({ key: k, n: r[k], colour: SHIFT_COLOURS[k], label: `${SHIFT_NAMES[k]}: ${r[k]}` }));
  const leaveDaysOf = (r) => r.annualDays + r.maternityDays + r.sl + r.frl + r.ml + r.otherLeave;
  const ranked = rows.map((r) => ({
    id: r.staff.id, name: r.staff.name, label: labelOf(r.staff), total: r.dutyShifts, segs: segsOf(r),
    nod: r.nonOfficialDuty, leaveDays: leaveDaysOf(r), staff: r.staff,
  })).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const maxDuty = Math.max(1, ...ranked.map((x) => x.total));
  ranked.forEach((x) => { x.w = (x.total / maxDuty) * 100; });
  let fewest = null;
  if (ranked.length > 1) {
    const lo = ranked[ranked.length - 1];
    const why = lo.leaveDays ? `${lo.leaveDays} day${lo.leaveDays === 1 ? "" : "s"} on leave`
      : lo.staff.startDate && lo.staff.startDate > from ? `joined ${dayMonth(lo.staff.startDate)}`
      : lo.staff.endDate && lo.staff.endDate < to ? `left ${dayMonth(lo.staff.endDate)}` : "";
    fewest = { name: lo.name, total: lo.total, why };
  }
  const maxNod = Math.max(1, ...rows.map((r) => r.nonOfficialDuty));
  const nodPer = rows.map((r) => ({ id: r.staff.id, name: r.staff.name, label: labelOf(r.staff), n: r.nonOfficialDuty, w: (r.nonOfficialDuty / maxNod) * 100 }))
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));

  /* ── Leave: who took each kind, how many days, and when ── */
  const leave = [];
  PERIOD_LEAVE.forEach(([type, label]) => {
    const people = [];
    rows.forEach((r) => {
      const spans = (r.staff.leavePeriods || []).filter((p) => p.type === type).map(clip).filter(Boolean);
      if (!spans.length) return;
      people.push({ id: r.staff.id, name: r.staff.name, days: spans.reduce((a, [x, y]) => a + spanDays(x, y), 0), when: spans.map(([x, y]) => rangeText(x, y)).join(", ") });
    });
    if (people.length) leave.push({ key: type, label, colour: LEAVE_COLOURS[type], people });
  });
  /* SL, FRL and ML can be a rota code or a leave period, and land in one
     column either way (as in recordsFor). Other leave codes get their own row. */
  const codeDates = {}; // staffId -> bucket -> [dates]
  rows.forEach((r) => {
    const s = r.staff; const mine = (codeDates[s.id] = { sl: [], frl: [], ml: [], other: [] });
    dates.forEach((date) => {
      if (!isEmployedOn(s, date) || leaveOn(s, date)) return;
      cellEntries(data, date, s.id).forEach((e) => {
        const code = codeById(e.code); if (!code) return;
        const b = leaveBucketOf(code); if (b) mine[b].push(date);
      });
    });
  });
  CODE_LEAVE.forEach(([type, label]) => {
    const people = [];
    rows.forEach((r) => {
      const fromCodes = codeDates[r.staff.id][type];
      const spans = (r.staff.leavePeriods || []).filter((p) => p.type === type).map(clip).filter(Boolean);
      const days = fromCodes.length + spans.reduce((a, [x, y]) => a + spanDays(x, y), 0);
      if (!days) return;
      const when = [runsText(fromCodes), ...spans.map(([x, y]) => rangeText(x, y))].filter(Boolean).join(", ");
      people.push({ id: r.staff.id, name: r.staff.name, days, when });
    });
    if (people.length) leave.push({ key: type, label, colour: LEAVE_COLOURS[type], people });
  });
  {
    const people = rows.map((r) => ({ id: r.staff.id, name: r.staff.name, d: codeDates[r.staff.id].other }))
      .filter((x) => x.d.length).map((x) => ({ id: x.id, name: x.name, days: x.d.length, when: runsText(x.d) }));
    if (people.length) leave.push({ key: "otherCodes", label: "Other leave (codes)", colour: LEAVE_COLOURS.otherCodes, people });
  }
  leave.forEach((g) => {
    g.people.sort((a, b) => b.days - a.days || a.name.localeCompare(b.name));
    g.staff = g.people.length; g.days = g.people.reduce((a, p) => a + p.days, 0);
  });
  const maxLeave = Math.max(1, ...leave.map((g) => g.days));
  leave.forEach((g) => { g.w = Math.max(4, (g.days / maxLeave) * 100); });

  /* ── Posts: where people worked ── */
  let posts = null;
  if (data.postsEnabled && (data.posts || []).length) {
    const byPost = {}; // postId -> staffId -> n
    rows.forEach((r) => {
      const s = r.staff;
      dates.forEach((date) => {
        if (!isEmployedOn(s, date) || leaveOn(s, date)) return;
        cellEntries(data, date, s.id).forEach((e) => {
          const code = codeById(e.code);
          if (!code || !DUTY_CATS.includes(code.counts) || !e.post) return;
          const m = (byPost[e.post] = byPost[e.post] || {}); m[s.id] = (m[s.id] || 0) + 1;
        });
      });
    });
    const nameOf = Object.fromEntries(rows.map((r) => [r.staff.id, r.staff.name]));
    posts = data.posts.map((p, i) => {
      const m = byPost[p.id] || {};
      const people = Object.keys(m).map((id) => ({ id, name: nameOf[id], n: m[id] })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
      return { id: p.id, name: p.name, colour: POST_COLOURS[i % POST_COLOURS.length], n: people.reduce((a, x) => a + x.n, 0), people };
    }).filter((p) => p.n > 0);
  }

  /* ── The rota as coloured squares (up to two months) ── */
  let heat = null;
  if (dates.length <= 62) {
    const postName = Object.fromEntries((data.posts || []).map((p) => [p.id, p.name]));
    const seen = new Set();
    const people = rows.map((r) => {
      const s = r.staff;
      const cells = dates.map((date) => {
        const tipStart = `${s.name} · ${dayMonth(date)}`;
        if (!isEmployedOn(s, date)) return { cat: "none", colour: "transparent", tip: `${tipStart} · not employed` };
        const p = leaveOn(s, date);
        if (p) {
          const k = LEAVE_COLOURS[p.type] ? p.type : "other"; seen.add("leave");
          return { cat: "leave", colour: LEAVE_COLOURS[k], tip: `${tipStart} · ${(PERIOD_LEAVE.find(([t]) => t === p.type) || CODE_LEAVE.find(([t]) => t === p.type) || [0, p.label || "Leave"])[1]}` };
        }
        const entries = cellEntries(data, date, s.id).map((e) => ({ code: codeById(e.code), post: e.post })).filter((e) => e.code);
        if (!entries.length) return { cat: "empty", colour: "transparent", tip: `${tipStart} · nothing set`, empty: true };
        const what = entries.map((e) => e.code.code + (e.post && postName[e.post] ? ` at ${postName[e.post]}` : "")).join(" + ");
        const duty = entries.find((e) => DUTY_CATS.includes(e.code.counts));
        if (duty) { seen.add(duty.code.counts); return { cat: duty.code.counts, colour: SHIFT_COLOURS[duty.code.counts], tip: `${tipStart} · ${what}` }; }
        const lv = entries.find((e) => leaveBucketOf(e.code));
        if (lv) { const b = leaveBucketOf(lv.code); seen.add("leave"); return { cat: "leave", colour: LEAVE_COLOURS[b === "other" ? "otherCodes" : b], tip: `${tipStart} · ${what}` }; }
        if (entries.some((e) => e.code.counts === "off")) { seen.add("off"); return { cat: "off", colour: OFF_COLOUR, tip: `${tipStart} · ${what}` }; }
        return { cat: "empty", colour: "transparent", tip: `${tipStart} · ${what}`, empty: true };
      });
      return { id: s.id, name: s.name, label: labelOf(s), cells };
    });
    const legend = [...mixKeys.filter((k) => seen.has(k)).map((k) => ({ name: SHIFT_NAMES[k], colour: SHIFT_COLOURS[k] })),
      ...(seen.has("leave") ? [{ name: "Leave", colour: LEAVE_COLOURS.annual }] : []),
      ...(seen.has("off") ? [{ name: "Off", colour: OFF_COLOUR }] : [])];
    heat = {
      days: dates.map((date) => { const d = parseD(date); return { date, n: d.getDate(), dow: "SMTWTFS"[d.getDay()], nod: isNonOff(data, date) }; }),
      people, legend,
    };
  }

  /* ── Staff: how many at the start and end, and who joined or left ──
     The same rule as the old "Staff" figure: joined = a start date inside
     the range, left = an end date inside it. */
  const inRange = (d) => d && d >= from && d <= to;
  const all = data.staff || [];
  const joined = all.filter((s) => inRange(s.startDate)).map((s) => ({ id: s.id, name: s.name, date: s.startDate, when: dayMonth(s.startDate) }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const left = all.filter((s) => inRange(s.endDate)).map((s) => ({ id: s.id, name: s.name, date: s.endDate, when: dayMonth(s.endDate) }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const people = {
    joined, left,
    atStart: all.filter((s) => isEmployedOn(s, from)).length,
    atEnd: all.filter((s) => isEmployedOn(s, to)).length,
    from: dayMonth(from), to: dayMonth(to),
  };

  return { dates, nodDates, away, mix, ranked, fewest, nodPer, leave, posts, heat, people };
}
