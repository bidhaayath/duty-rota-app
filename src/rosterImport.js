import { isNonOff, leaveOn, entriesOf } from "./rotaCounts";
import { LEAVE_STYLES } from "./leaveTypes";

/* ────────────────────────────────────────────────────────────────────────
   Roster import: reading a manager's previous roster into the rota.

   WHY THIS FILE IS SEPARATE
     The same reason rotaExcel.js is: DutyRotaOriginal.js is long and
     changes constantly. Everything here is a pure function. It is handed
     a workbook (or plain rows) and the current rota data, and hands back
     a description of what it found. It reads no React state, makes no
     network call and touches no database. The only thing that ever saves
     is the caller, through update(), once, after the manager has seen the
     preview — so a whole import is one save and one Undo.

   THE THREE STEPS
     1. readSheets(file)      workbook bytes → plain sheets
                              { name, cells: [[text]], merges: [{r1,c1,r2,c2}] }
     2. readGrid(sheets)      plain sheets → the roster as found in the file:
                              days, people, and for each person and day the
                              code, post, break and leave written there.
                              Knows nothing about the department.
     3. planImport(grid, d)   matches that against the department: which
                              names are existing staff, which codes and
                              posts already exist, what is new, and how
                              many existing duties the import would touch.
        applyImport(d, grid, plan, choices)
                              writes it into a copy of the rota data and
                              returns it with a short report. Called inside
                              update(), so it must only change `d`.

   WHAT IT UNDERSTANDS
     Easy Duty Rota's own Excel export, and rosters laid out the usual way:
     a header row of dates, a name column, one cell per person per day.
     A day cell can hold several lines, in any order after the first:
         D                    a duty code (or a leave name such as "AL")
         07:00–15:00          the duty's hours
         P1 – Main Gate       a post
         ☕ 11:00–11:30        a break ("Break 11:00–11:30" works too)
     A merged cell across several days (how the export draws leave) counts
     for every day it covers.
   ──────────────────────────────────────────────────────────────────────── */

/* ─────────────────── Small helpers ─────────────────── */

const pad = (n) => String(n).padStart(2, "0");
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const addDays = (s, n) => {
  const [y, m, d] = s.split("-").map(Number);
  const t = new Date(y, m - 1, d + n);
  return iso(t.getFullYear(), t.getMonth() + 1, t.getDate());
};
const clean = (s) => String(s == null ? "" : s).replace(/ /g, " ").replace(/[ \t]+/g, " ").trim();
// Every kind of dash a spreadsheet produces, as a plain hyphen, for comparing.
const dashes = (s) => s.replace(/[‐‑‒–—―−]/g, "-");

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const monthOf = (word) => {
  const w = String(word || "").toLowerCase().slice(0, 3);
  const i = MONTHS.indexOf(w === "sep" ? "sep" : w);
  return i >= 0 ? i + 1 : 0;
};
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const weekdayOf = (word) => WEEKDAYS.indexOf(String(word || "").toLowerCase().slice(0, 3));

/* "7:00", "07.00", "0700" → "07:00". Anything else → "". */
const hhmm = (t) => {
  const m = String(t || "").match(/^(\d{1,2})[:.h]?(\d{2})$/);
  if (!m) return "";
  const h = Number(m[1]), mi = Number(m[2]);
  if (h > 24 || mi > 59) return "";
  return `${pad(h)}:${pad(mi)}`;
};
const TIME_RANGE = /(\d{1,2}[:.h]?\d{2})\s*(?:-|to)\s*(\d{1,2}[:.h]?\d{2})/i;
const timeRange = (s) => {
  const m = dashes(s).match(TIME_RANGE);
  if (!m) return null;
  const start = hhmm(m[1]), end = hhmm(m[2]);
  return start && end ? { start, end } : null;
};

/* ─────────────────── Step 1: workbook → plain sheets ─────────────────── */

/* ExcelJS gives a cell's value in many shapes. This turns any of them into
   the text a person sees. A real date becomes "2026-12-06" so the header
   reader recognises it whatever the cell's display format was. */
export const cellText = (v) => {
  if (v == null) return "";
  if (v instanceof Date) return iso(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate());
  if (typeof v === "object") {
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text || "").join("");
    if (v.result !== undefined) return cellText(v.result);
    if (v.text !== undefined) return cellText(v.text);
    if (v.error) return "";
    return "";
  }
  return String(v);
};

const A1 = (ref) => {
  const m = String(ref).match(/^([A-Z]+)(\d+)$/i);
  if (!m) return null;
  const c = m[1].toUpperCase().split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
  return { r: Number(m[2]) - 1, c: c - 1 };
};

/* An ExcelJS worksheet → { name, cells, merges }, all 0-based. A merged
   block's text sits in its top-left cell only; the other cells are blank
   and the block is listed in merges, so the grid reader can spread it. */
export const sheetFromExcelJS = (ws) => {
  const merges = [];
  const list = (ws.model && ws.model.merges) || [];
  list.forEach((rng) => {
    const [a, b] = String(rng).split(":");
    const p = A1(a), q = A1(b || a);
    if (p && q) merges.push({ r1: p.r, c1: p.c, r2: q.r, c2: q.c });
  });
  const slave = new Set();
  merges.forEach((m) => {
    for (let r = m.r1; r <= m.r2; r++) for (let c = m.c1; c <= m.c2; c++) if (r !== m.r1 || c !== m.c1) slave.add(`${r},${c}`);
  });
  const cells = [];
  const rows = ws.rowCount || 0, cols = ws.columnCount || 0;
  for (let r = 0; r < rows; r++) {
    const row = [];
    const xr = ws.getRow(r + 1);
    for (let c = 0; c < cols; c++) {
      row.push(slave.has(`${r},${c}`) ? "" : cellText(xr.getCell(c + 1).value));
    }
    cells.push(row);
  }
  return { name: ws.name, cells, merges };
};

/* Plain CSV → one sheet. Handles quoted fields, commas and line breaks
   inside quotes, and a semicolon-separated file (common where the comma
   is the decimal mark). */
export const sheetFromCSV = (text, name = "Sheet1") => {
  const src = String(text || "").replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/)[0] || "";
  const sep = (firstLine.split(";").length > firstLine.split(",").length) ? ";" : ",";
  const rows = [];
  let row = [], field = "", q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') q = false;
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return { name, cells: rows, merges: [] };
};

/* A File (or ArrayBuffer) from the upload button → plain sheets.
   ExcelJS is loaded only when someone imports, so it adds nothing to the
   app's first load. .xls (Excel 97–2003) is a different, binary format
   ExcelJS cannot read: the caller tells the manager to "Save As .xlsx". */
export const readSheets = async (file, fileName = "") => {
  const name = (fileName || (file && file.name) || "").toLowerCase();
  if (/\.xls$/.test(name)) {
    const e = new Error("This is an old .xls file. Open it in Excel and use Save As → Excel Workbook (.xlsx), then import that.");
    e.code = "xls";
    throw e;
  }
  const buf = file && typeof file.arrayBuffer === "function" ? await file.arrayBuffer() : file;
  if (/\.(csv|txt)$/.test(name)) {
    const text = typeof buf === "string" ? buf : new TextDecoder("utf-8").decode(buf);
    return [sheetFromCSV(text, fileName.replace(/\.[^.]+$/, "") || "Sheet1")];
  }
  const ExcelJS = (await import("exceljs")).default || (await import("exceljs"));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return wb.worksheets.map(sheetFromExcelJS);
};

/* ─────────────────── Step 2: plain sheets → the roster grid ─────────────────── */

/* One header cell → what date it names, as far as the cell alone can tell.
     "SUN\n6 Dec"  "6 Dec 2026"  "01 Tue"  "Tue 1"  "2026-12-06"  "6/12/2026"
     "Dec 6"  "6-Dec-26"  … plus "NON-OFFICIAL" / "Holiday" for a gold day.
   Returns null when the cell is not a date. `bare` marks a plain number
   ("6"), which only counts when the whole row is a run of them. */
export const parseDayHeader = (raw) => {
  const text = clean(raw);
  if (!text) return null;
  const flat = dashes(text.replace(/\n/g, " ")).replace(/\s+/g, " ").trim();
  const nonOff = /non[- ]?official|public holiday|\bholiday\b|\bPH\b/i.test(flat);
  const body = flat.replace(/non[- ]?official|public holiday|\bholiday\b|\bPH\b/gi, " ").replace(/[(),]/g, " ").replace(/\s+/g, " ").trim();
  let wd = -1;
  const words = body.split(" ");
  const rest = words.filter((w) => {
    if (wd < 0 && /^[a-z]{3,9}\.?$/i.test(w) && weekdayOf(w) >= 0 && !monthOf(w)) {
      // "Sun", "SUNDAY", "Tue." — but not "Mar" or "May", which are months.
      const full = w.toLowerCase().replace(".", "");
      const ok = ["sun", "mon", "tue", "tues", "wed", "thu", "thur", "thurs", "fri", "sat"].includes(full)
        || /^(sun|mon|tues|wednes|thurs|fri|satur)day$/.test(full);
      if (ok) { wd = weekdayOf(w); return false; }
    }
    return true;
  }).join(" ");
  let m;
  const out = (day, month = 0, year = 0, bare = false) => {
    if (day < 1 || day > 31 || month < 0 || month > 12) return null;
    if (year && year < 100) year += 2000;
    return { day, month, year, weekday: wd, nonOff, bare };
  };
  if ((m = rest.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) return out(+m[3], +m[2], +m[1]);
  if ((m = rest.match(/^(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?$/))) return out(+m[1], +m[2], m[3] ? +m[3] : 0);
  if ((m = rest.match(/^(\d{1,2})(?:st|nd|rd|th)?[ -]([a-z]{3,9})\.?(?:[ -](\d{2,4}))?$/i)) && monthOf(m[2])) return out(+m[1], monthOf(m[2]), m[3] ? +m[3] : 0);
  if ((m = rest.match(/^([a-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)?(?: (\d{4}))?$/i)) && monthOf(m[1])) return out(+m[2], monthOf(m[1]), m[3] ? +m[3] : 0);
  if ((m = rest.match(/^(\d{1,2})(?:st|nd|rd|th)?$/))) return out(+m[1], 0, 0, wd < 0);
  return null;
};

/* The roster's year (and month) from its title rows, sheet name or file
   name: "6 Dec 2026 – 26 Dec 2026", "December 2026", "Roster_Dec_2026". */
const findPeriod = (texts) => {
  for (const t of texts) {
    const s = dashes(clean(t)).replace(/_/g, " ");
    let m = s.match(/\b(\d{1,2}) ([a-z]{3,9})\.? (\d{4})\b/i);
    if (m && monthOf(m[2])) return { year: +m[3], month: monthOf(m[2]) };
    m = s.match(/\b([a-z]{3,9})\.? (\d{4})\b/i);
    if (m && monthOf(m[1])) return { year: +m[2], month: monthOf(m[1]) };
    m = s.match(/\b(\d{4})-(\d{2})-\d{2}\b/);
    if (m) return { year: +m[1], month: +m[2] };
  }
  for (const t of texts) {
    const m = String(t || "").match(/\b(20\d{2})\b/);
    if (m) return { year: +m[1], month: 0 };
  }
  return null;
};

/* Headers to the left of the days, by what they hold. */
const LEFT_COLUMNS = [
  ["skip", /^(#|no\.?|s\.? ?no\.?|sl\.? ?no\.?|sr\.? ?no\.?|number)$/i],
  ["name", /^(name|names|staff|staff name|employee|employee name|officer|officers|nurse|nurses|member|person|full name)$/i],
  ["designation", /^(designation|title|rank|position|grade|role|job title)$/i],
  ["contact", /^(contact|contact no\.?|phone|mobile|tel|telephone)$/i],
  ["email", /^(e-?mail|email address)$/i],
  ["recc", /^(employee id|emp\.? ?id|staff id|staff no\.?|id|id no\.?|service no\.?|rec(c)? no\.?|employee no\.?)$/i],
  ["post", /^(post|assigned post|station|location|posting)$/i],
];
const classifyLeft = (head) => {
  const h = clean(head).replace(/\n/g, " ");
  if (!h) return null;
  const hit = LEFT_COLUMNS.find(([, re]) => re.test(h));
  return hit ? hit[0] : "extra";
};

/* Rows under the grid that are counts or footers, not people. */
const NOT_A_PERSON = /^(morning|afternoon|evening|night|other duty|on-?call|total|totals|grand total|legend|note|notes|key|signature|prepared by|checked by|approved by|in charge|count)\b/i;

/* Leave names as the export writes them, and the usual short forms.
   SL, FRL and ML are deliberately absent: written short they are rota
   codes (the export writes a leave PERIOD of those as "Sick Leave", etc.),
   so they go through the code matching like any other duty. */
const LEAVE_WORDS = (() => {
  const m = new Map();
  Object.entries(LEAVE_STYLES).forEach(([type, st]) => {
    m.set(st.label.toLowerCase(), type);
    if (!["sl", "frl", "ml"].includes(type)) m.set(st.abbrev.toLowerCase(), type);
  });
  [["a/l", "annual"], ["annual", "annual"], ["vacation", "annual"], ["maternity leave", "maternity"],
   ["paternity leave", "paternity"], ["emergency", "emergency"], ["pre-maternity leave", "prematernity"],
   ["pre maternity", "prematernity"], ["sick leave", "sl"], ["medical leave", "ml"], ["family related leave", "frl"],
  ].forEach(([k, v]) => m.set(k, v));
  return m;
})();
export const leaveFromText = (line) => {
  const low = clean(line).toLowerCase().replace(/\s+/g, " ");
  if (!low) return null;
  if (LEAVE_WORDS.has(low)) return { type: LEAVE_WORDS.get(low), label: "" };
  // "Hajj Leave", "Study leave": an extended leave with its own name.
  if (/\bleave\b/.test(low) && low.includes(" ") && low.length <= 40) return { type: "other", label: clean(line) };
  return null;
};

/* What the export writes for days a person was not employed. */
const NOT_EMPLOYED = /^(not yet joined|left|—|–|-)$/i;
const DATE_RANGE_LINE = /^\(?\s*\d{1,2} [a-z]{3,9}\.?( \d{4})?\s*-\s*\d{1,2} [a-z]{3,9}\.?( \d{4})?\s*\)?$/i;
const BREAK_LINE = /^(☕|break|brk|rest|meal)\b\s*:?/i;
// Markers the export puts after a changed duty.
const stripMarks = (s) => clean(s.replace(/[👤💼]/gu, ""));

/* One day cell's text → what it says.
     { code, time, post, second, secondTime, secondPost, brk, leave, blank,
       notEmployed, lines }
   `isCode(text)` says whether a later line is a duty code (a split duty's
   second duty) rather than a post. */
export const parseCell = (raw, isCode = () => false) => {
  const lines = String(raw == null ? "" : raw).split(/\r?\n/).map(clean).filter(Boolean);
  const cell = { code: "", time: null, post: "", second: "", secondTime: null, secondPost: "", brk: null, leave: null,
                 blank: !lines.length, notEmployed: false, lines };
  if (!lines.length) return cell;
  const rest = [];
  lines.forEach((ln) => {
    const flat = dashes(ln);
    if (BREAK_LINE.test(flat) || flat.startsWith("☕")) { cell.brk = timeRange(flat) || cell.brk; return; }
    if (DATE_RANGE_LINE.test(flat)) return;           // the export's "(14 Dec 2026 – 20 Dec 2026)"
    rest.push(ln);
  });
  if (!rest.length) return cell;
  let first = stripMarks(rest[0]);
  if (NOT_EMPLOYED.test(first)) { cell.notEmployed = true; return cell; }
  const lv = leaveFromText(first);
  if (lv) { cell.leave = lv; return cell; }
  // "D 07:00–15:00" on one line: the code, then its hours.
  const t0 = timeRange(first);
  if (t0) {
    const before = clean(dashes(first).split(TIME_RANGE)[0]);
    if (before) { cell.code = before; cell.time = t0; }
    else { cell.time = t0; first = ""; }               // a cell that is only hours
  } else cell.code = first;
  let i = 1;
  let target = "first";
  for (; i < rest.length; i++) {
    const ln = stripMarks(rest[i]);
    const tr = timeRange(ln);
    if (tr && dashes(ln).replace(TIME_RANGE, "").trim() === "") {
      if (target === "first" && !cell.time) cell.time = tr;
      else if (target === "second" && !cell.secondTime) cell.secondTime = tr;
      continue;
    }
    if (!cell.second && cell.code && isCode(tr ? clean(dashes(ln).split(TIME_RANGE)[0]) : ln)) {
      cell.second = tr ? clean(dashes(ln).split(TIME_RANGE)[0]) : ln;
      if (tr) cell.secondTime = tr;
      target = "second";
      continue;
    }
    if (target === "first" && !cell.post) cell.post = ln;
    else if (target === "second" && !cell.secondPost) cell.secondPost = ln;
  }
  return cell;
};

/* "Ahmed — Security Officer" → name and designation, the way the export
   writes a person when designation is not its own column. Only a spaced
   dash splits, so "Ali-Rasheed" stays whole. */
export const splitNameDesignation = (raw) => {
  const s = clean(String(raw).replace(/\n/g, " "));
  const m = s.match(/^(.+?)\s+[—–-]\s+(.+)$/);
  return m ? { name: clean(m[1]), designation: clean(m[2]) } : { name: s, designation: "" };
};

/* The legend: "D = Day duty (07:00–15:00) · E = Evening …", or a block of
   two columns, code then description. Returns { CODE: { label, start, end } }. */
const LEGEND_ENTRY = /^\s*([A-Za-z0-9()/]{1,8})\s*(?:=|:|\|)\s*(.+?)\s*$/;
export const readLegend = (sheet, fromRow = 0) => {
  const out = {};
  const add = (code, desc) => {
    const key = clean(code).toUpperCase();
    if (!key || out[key]) return;
    const t = timeRange(desc);
    const label = clean(dashes(desc).replace(/\(?\s*\d{1,2}[:.h]?\d{2}\s*(?:-|to)\s*\d{1,2}[:.h]?\d{2}\s*\)?/i, "")).replace(/[\s,;-]+$/, "");
    out[key] = { label: label || key, start: t ? t.start : "", end: t ? t.end : "" };
  };
  sheet.cells.forEach((row, r) => {
    row.forEach((v, c) => {
      const text = clean(v);
      if (!text) return;
      if (/^(legend|key)\b/i.test(text) || (text.includes(" = ") && text.split(" = ").length > 2)) {
        text.replace(/^(legend|key)\s*:?/i, "").split(/\s+·\s+|\n|;/).forEach((part) => {
          const m = part.match(LEGEND_ENTRY);
          if (m) add(m[1], m[2]);
        });
        return;
      }
      if (r < fromRow) return;
      // Two-column legend under the grid: a short code, then its meaning.
      if (c + 1 < row.length && /^[A-Za-z][A-Za-z0-9()/]{0,6}$/.test(text)) {
        const next = row.slice(c + 1).map(clean).find(Boolean) || "";
        if (next && next.length > 2 && /[a-z]/i.test(next) && row.slice(0, c).every((x) => !clean(x))) add(text, next);
      }
    });
  });
  return out;
};

/* The export's second sheet: one row per person with their details. */
const STAFF_SHEET_COLS = {
  name: /^(name|staff name|employee name|full name)$/i,
  designation: /^(designation|title|rank|position)$/i,
  email: /^e-?mail$/i,
  contact: /^(contact|phone|mobile)$/i,
  recc: /^(employee id|emp id|staff id|id)$/i,
  licence: /^(licen[cs]e expiry|licen[cs]e)$/i,
  startDate: /^(employed from|start date|joined|date joined)$/i,
  endDate: /^(employed to|end date|left)$/i,
};
const anyDate = (s) => {
  const t = clean(s);
  if (!t) return "";
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return t;
  m = dashes(t).match(/^(\d{1,2})[ -]([a-z]{3,9})\.?[ -](\d{4})$/i);
  if (m && monthOf(m[2])) return iso(+m[3], monthOf(m[2]), +m[1]);
  m = t.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
  if (m) return iso(+m[3], +m[2], +m[1]);
  return "";
};
export const readStaffSheet = (sheet) => {
  const head = (sheet.cells[0] || []).map(clean);
  const col = {};
  head.forEach((h, i) => {
    const k = Object.keys(STAFF_SHEET_COLS).find((key) => STAFF_SHEET_COLS[key].test(h));
    if (k && col[k] === undefined) col[k] = i;
  });
  if (col.name === undefined || Object.keys(col).length < 3) return null;
  return sheet.cells.slice(1).map((row) => {
    const get = (k) => (col[k] === undefined ? "" : clean(row[col[k]]));
    const p = { name: get("name") };
    ["designation", "email", "contact", "recc"].forEach((k) => { p[k] = get(k); });
    ["licence", "startDate", "endDate"].forEach((k) => { p[k] = anyDate(get(k)); });
    return p;
  }).filter((p) => p.name);
};

/* Find the header row: the row (in the top 15) with the most cells that
   read as dates. Plain numbers count only as a run of seven or more. */
const findHeader = (sheet) => {
  let best = null;
  sheet.cells.slice(0, 15).forEach((row, r) => {
    const hits = [];
    row.forEach((v, c) => { const h = parseDayHeader(v); if (h) hits.push({ c, h }); });
    const strong = hits.filter((x) => !x.h.bare);
    const bare = hits.filter((x) => x.h.bare);
    const use = strong.length >= 3 ? strong : (bare.length >= 7 ? hits : []);
    if (use.length >= 3 && (!best || use.length > best.cols.length)) best = { row: r, cols: use };
  });
  return best;
};

/**
 * Plain sheets → the roster as found in the file.
 * @param sheets   from readSheets
 * @param opts     { fileName, fallbackYear }
 * @returns {
 *   sheetName, headerRow,
 *   days:   [{ date, col, nonOff }],
 *   people: [{ row, name, designation, details: {contact,email,recc}, extra: {colName: value},
 *              defaultPost, cells: { [date]: parsedCell } }],
 *   legend: { CODE: { label, start, end } },
 *   staffSheet: [{ name, designation, email, contact, recc, licence, startDate, endDate }] | null,
 *   issues: [string]       things the manager should know (year guessed, weekday mismatch…)
 * }
 * Throws an Error with a plain message when no roster can be found.
 */
export const readGrid = (sheets, opts = {}) => {
  const issues = [];
  const list = (sheets || []).filter((s) => s && s.cells && s.cells.length);
  let sheet = null, header = null;
  list.forEach((s) => {
    const h = findHeader(s);
    if (h && (!header || h.cols.length > header.cols.length)) { sheet = s; header = h; }
  });
  if (!sheet) {
    throw new Error("I couldn't find a row of dates in this file. The roster needs a header row with one column per day, such as \"1 Dec\", \"Mon 1\" or \"2026-12-01\".");
  }

  /* Dates. Each header gives what it can; the title rows, sheet name and
     file name fill in the month and year; a day number that goes down
     means the next month has started. */
  const titleTexts = sheet.cells.slice(0, header.row).flat().concat([sheet.name, opts.fileName || ""]);
  const period = findPeriod(titleTexts);
  let year = (header.cols.find((x) => x.h.year) || {}).h?.year || period?.year || 0;
  let month = (header.cols.find((x) => x.h.month) || {}).h?.month || period?.month || 0;
  if (!year) {
    year = opts.fallbackYear || new Date().getFullYear();
    issues.push(`The file doesn't say which year it is, so I've assumed ${year}.`);
  }
  if (!month) {
    throw new Error("I found the days, but not the month. Add the month to the title (for example \"December 2026\") or to the date headers, and try again.");
  }
  const days = [];
  let prevDay = 0, mismatches = 0;
  header.cols.forEach(({ c, h }) => {
    if (h.year) year = h.year;
    if (h.month) {
      if (h.month < month && !h.year && month === 12) year += 1;
      month = h.month;
    } else if (prevDay && h.day < prevDay) {
      month += 1;
      if (month > 12) { month = 1; year += 1; }
    }
    prevDay = h.day;
    const date = iso(year, month, h.day);
    const [yy, mm, dd] = date.split("-").map(Number);
    const real = new Date(yy, mm - 1, dd);
    if (real.getMonth() !== mm - 1) return;                 // "31 Nov" — skip it
    if (h.weekday >= 0 && real.getDay() !== h.weekday) mismatches += 1;
    if (days.some((d) => d.date === date)) return;          // a repeated header
    days.push({ date, col: c, nonOff: !!h.nonOff });
  });
  if (mismatches > days.length / 2) {
    issues.push("The weekday names in the file don't match the dates I worked out. Please check the year and month in the preview before adding.");
  }
  const dayCols = new Set(days.map((d) => d.col));
  const firstDayCol = Math.min(...days.map((d) => d.col));

  /* Columns left of the days. */
  const headRow = sheet.cells[header.row] || [];
  const kinds = {};
  for (let c = 0; c < firstDayCol; c++) {
    const k = classifyLeft(headRow[c]);
    if (k) kinds[c] = k;
  }
  let nameCol = Object.keys(kinds).find((c) => kinds[c] === "name");
  if (nameCol === undefined) {
    // No "Name" heading: the left-hand column with the most words in it.
    let bestC = -1, bestN = 0;
    for (let c = 0; c < firstDayCol; c++) {
      if (kinds[c] && kinds[c] !== "extra") continue;
      const n = sheet.cells.slice(header.row + 1).filter((row) => /[a-z]{2}/i.test(clean(row[c]))).length;
      if (n > bestN) { bestN = n; bestC = c; }
    }
    if (bestC < 0) throw new Error("I found the dates, but not a column of names to the left of them.");
    nameCol = bestC;
    if (kinds[bestC] === "extra") delete kinds[bestC];
  }
  nameCol = Number(nameCol);
  const hasDesignationCol = Object.values(kinds).includes("designation");

  /* Merged blocks inside the day columns: spread each over its days. */
  const spread = new Map();       // "r,c" → text of the block's top-left cell
  sheet.merges.forEach((m) => {
    if (m.r1 <= header.row) return;
    const text = (sheet.cells[m.r1] || [])[m.c1] || "";
    for (let r = m.r1; r <= m.r2; r++) for (let c = m.c1; c <= m.c2; c++) if (dayCols.has(c)) spread.set(`${r},${c}`, text);
  });
  const textAt = (r, c) => (spread.has(`${r},${c}`) ? spread.get(`${r},${c}`) : (sheet.cells[r] || [])[c] || "");

  /* People. First pass collects first lines, so a split duty's second code
     can be told apart from a post on the second pass. */
  const personRows = [];
  for (let r = header.row + 1; r < sheet.cells.length; r++) {
    const rawName = clean((sheet.cells[r] || [])[nameCol]);
    if (!rawName || NOT_A_PERSON.test(rawName)) continue;
    if (/^\d+([.,]\d+)?$/.test(rawName)) continue;
    const dayTexts = days.map((d) => clean(textAt(r, d.col)));
    if (!dayTexts.some(Boolean)) continue;
    // A counts row ("5 5 4 5 …") rather than a person.
    if (dayTexts.filter(Boolean).every((t) => /^\d+$/.test(t))) continue;
    personRows.push(r);
  }
  if (!personRows.length) throw new Error("I found the dates, but no rows of people with duties under them.");

  const firstLines = new Set();
  personRows.forEach((r) => days.forEach((d) => {
    const p = parseCell(textAt(r, d.col));
    if (p.code) firstLines.add(p.code.toUpperCase());
  }));
  const isCode = (t) => firstLines.has(clean(t).toUpperCase());

  const people = personRows.map((r) => {
    const row = sheet.cells[r] || [];
    const split = hasDesignationCol ? { name: clean(row[nameCol]), designation: "" } : splitNameDesignation(row[nameCol]);
    const p = { row: r, name: split.name, designation: split.designation, details: {}, extra: {}, defaultPost: "", cells: {} };
    Object.entries(kinds).forEach(([c, k]) => {
      const v = clean(row[c]);
      if (!v || k === "skip" || k === "name") return;
      if (k === "designation") p.designation = v;
      else if (k === "post") p.defaultPost = v;
      else if (k === "extra") p.extra[clean(headRow[c]).replace(/\n/g, " ")] = v;
      else p.details[k] = v;
    });
    days.forEach((d) => { p.cells[d.date] = parseCell(textAt(r, d.col), isCode); });
    return p;
  });

  const lastPersonRow = personRows[personRows.length - 1];
  const legend = readLegend(sheet, lastPersonRow + 1);
  let staffSheet = null;
  list.forEach((s) => { if (s !== sheet && !staffSheet) staffSheet = readStaffSheet(s); });

  return { sheetName: sheet.name, headerRow: header.row, days, people, legend, staffSheet, issues };
};

/* ─────────────────── Step 3: match against the department ─────────────────── */

/* Names are compared ignoring case, spacing, titles and the common
   spellings of Maldivian names, so "Aishath" finds "Aisha" and
   "Mohammed" finds "Mohamed". A match found only that way is offered,
   never assumed: the manager confirms it in the preview. */
const TITLES = /^(dr|prof|mr|mrs|ms|miss|mstr|sr|srn|rn|en|sn|pc|lcpl|cpl|sgt|ssgt|insp|si|asi)\.?\s+/i;
const VARIANTS = [
  [/^aish(ath|a|ath|athu)$/, "aishath"], [/^(fath(imath|ima|uma)|fathmath)$/, "fathimath"],
  [/^(mo|mu)ha?mm?[ae]d$/, "mohamed"], [/^ahm[ae]d$/, "ahmed"], [/^has+an$/, "hassan"], [/^hus+[ae]in$/, "hussain"],
  [/^ibrah?[ie]m$/, "ibrahim"], [/^ism[ae][ae]?il$/, "ismail"], [/^m[ae]r?i?y?am$/, "mariyam"], [/^aminath?$/, "aminath"],
  [/^hawwa?$/, "hawwa"], [/^abdul+a+h?$/, "abdulla"], [/^ab(d|du)ul?$/, "abdul"], [/^ras(h)?ee?d$/, "rasheed"],
  [/^shir(ee|i)n$/, "shirin"], [/^nas(ee|i)r$/, "naseer"], [/^ya(a)?m(ee|i)n$/, "yameen"], [/^ali$/, "ali"],
];
export const nameKey = (s) => clean(String(s || "").replace(/\n/g, " "))
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(TITLES, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const looseKey = (s) => nameKey(s).split(" ").map((w) => {
  const v = VARIANTS.find(([re]) => re.test(w));
  return v ? v[1] : w.replace(/(.)\1+/g, "$1").replace(/[aeiou]+/g, "");
}).join(" ");
const editDistance = (a, b) => {
  if (a === b) return 0;
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]; dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
};

/* One person from the file → { status: "exact"|"close"|"new", staffId, suggestions } */
export const matchStaff = (name, designation, staff) => {
  const key = nameKey(name);
  const withDes = nameKey(designation ? `${name} ${designation}` : name);
  const exact = staff.filter((s) => nameKey(s.name) === key || nameKey(`${s.name} ${s.designation || ""}`) === withDes);
  if (exact.length === 1) return { status: "exact", staffId: exact[0].id, suggestions: [] };
  if (exact.length > 1) {
    // Two people of the same name: the designation decides, otherwise ask.
    const byDes = exact.filter((s) => nameKey(s.designation) === nameKey(designation));
    if (byDes.length === 1) return { status: "exact", staffId: byDes[0].id, suggestions: [] };
    return { status: "close", staffId: exact[0].id, suggestions: exact.map((s) => s.id) };
  }
  const lk = looseKey(name);
  const close = staff
    .map((s) => {
      const sk = looseKey(s.name);
      let score = sk === lk ? 0 : editDistance(nameKey(s.name), key);
      // "Ahmed" against "Ahmed Rasheed": a first name that is someone's whole first name.
      if (score && key.split(" ").length === 1 && nameKey(s.name).split(" ")[0] === key) score = 1;
      return { id: s.id, score };
    })
    .filter((x) => x.score === 0 || (x.score <= 2 && key.length >= 5))
    .sort((a, b) => a.score - b.score);
  if (close.length) return { status: "close", staffId: close[0].id, suggestions: close.slice(0, 3).map((x) => x.id) };
  return { status: "new", staffId: "", suggestions: [] };
};

const codeKey = (s) => clean(s).toUpperCase().replace(/\s+/g, "");
const postKey = (s) => dashes(clean(s)).toLowerCase().replace(/[^a-z0-9]+/g, "");

/* A best guess at what a new code counts as, from its name and hours, so
   the manager mostly just confirms. */
export const guessCounts = (code, label = "", start = "") => {
  const t = `${code} ${label}`.toLowerCase();
  if (/\boff\b|day off|rest day|\bdo\b|\bro\b/.test(t)) return "off";
  if (/sick/.test(t)) return "sl";
  if (/family/.test(t)) return "frl";
  if (/medical/.test(t)) return "ml";
  if (/leave|holiday|vacation/.test(t)) return "leave";
  if (/release|other unit|\brd\b/.test(t)) return "release";
  if (/night/.test(t)) return "night";
  if (/evening/.test(t)) return "evening";
  if (/afternoon|\bpm\b/.test(t)) return "afternoon";
  if (/morning|\bday\b|\bam\b/.test(t)) return "morning";
  const h = start ? Number(start.slice(0, 2)) : -1;
  if (h >= 4 && h < 11) return "morning";
  if (h >= 11 && h < 15) return "afternoon";
  if (h >= 15 && h < 20) return "evening";
  if (h >= 20 || (h >= 0 && h < 4)) return "night";
  return "other";
};
const NEW_CODE_COLORS = ["#F4B860", "#8FBF6B", "#6FA8DC", "#8E7CC3", "#E58E77", "#C08552", "#5BB5A2", "#D98BD3", "#A9D3E0", "#FAD9A0"];

/* Consecutive days of the same leave → periods. */
const leaveRuns = (person, days) => {
  const runs = [];
  let cur = null;
  days.forEach(({ date }) => {
    const lv = person.cells[date] && person.cells[date].leave;
    const same = lv && cur && cur.type === lv.type && (cur.label || "") === (lv.label || "") && addDays(cur.end, 1) === date;
    if (same) cur.end = date;
    else {
      if (cur) runs.push(cur);
      cur = lv ? { type: lv.type, label: lv.label || "", start: date, end: date } : null;
    }
  });
  if (cur) runs.push(cur);
  return runs;
};

/**
 * The file against the department. Nothing here changes `data`.
 * @returns {
 *   from, to, days,
 *   people: [{ index, name, designation, status, staffId, suggestions, duties, leaveDays }],
 *   codes:  [{ key, text, count, existingId, proposal: {code,label,counts,color,start,end} }],
 *   posts:  [{ key, name, count, existingId }],
 *   leave:  [{ index, type, label, start, end }],
 *   counts: { people, days, duties, breaks, leavePeriods, newCodes, newPosts, newStaff, closeNames,
 *             nonOfficial, unclear },
 *   unclear: [{ index, date, text }]     cells it couldn't read
 *   existing: number                     cells in the date range that already hold a duty,
 *                                        for the people the file matched
 * }
 */
export const planImport = (grid, data) => {
  const staff = data.staff || [];
  const codesByKey = new Map((data.codes || []).map((c) => [codeKey(c.code), c]));
  const postsByKey = new Map((data.posts || []).map((p) => [postKey(p.name), p]));
  const codeTally = new Map();   // key → { text, count, times: Map }
  const postTally = new Map();
  const unclear = [];
  let duties = 0, breaks = 0;

  const tallyCode = (text, time) => {
    if (!text) return;
    const k = codeKey(text);
    if (!codeTally.has(k)) codeTally.set(k, { text: clean(text), count: 0, times: new Map() });
    const t = codeTally.get(k);
    t.count += 1;
    if (time) { const tk = `${time.start}-${time.end}`; t.times.set(tk, (t.times.get(tk) || 0) + 1); }
  };
  const tallyPost = (name) => {
    if (!name) return;
    const k = postKey(name);
    if (!k) return;
    if (!postTally.has(k)) postTally.set(k, { name: clean(name), count: 0 });
    postTally.get(k).count += 1;
  };

  const people = grid.people.map((p, index) => {
    const m = matchStaff(p.name, p.designation, staff);
    let pd = 0, ld = 0;
    grid.days.forEach(({ date }) => {
      const c = p.cells[date];
      if (!c || c.blank || c.notEmployed) return;
      if (c.leave) { ld += 1; return; }
      if (!c.code) { unclear.push({ index, date, text: c.lines.join(" / ") }); return; }
      tallyCode(c.code, c.time); pd += 1; duties += 1;
      if (c.second) { tallyCode(c.second, c.secondTime); duties += 1; }
      if (c.brk) breaks += 1;
      tallyPost(c.post || ""); tallyPost(c.secondPost || "");
    });
    return { index, name: p.name, designation: p.designation, status: m.status, staffId: m.staffId, suggestions: m.suggestions, duties: pd, leaveDays: ld };
  });

  let colorAt = 0;
  const codes = [...codeTally.entries()].map(([key, t]) => {
    const existing = codesByKey.get(key);
    const legend = grid.legend[key] || {};
    const commonTime = [...t.times.entries()].sort((a, b) => b[1] - a[1])[0];
    const [cs, ce] = commonTime ? commonTime[0].split("-") : [legend.start || "", legend.end || ""];
    const proposal = existing ? null : {
      code: t.text, label: legend.label && legend.label.toUpperCase() !== key ? legend.label : t.text,
      counts: guessCounts(t.text, legend.label || "", cs || legend.start || ""),
      color: NEW_CODE_COLORS[colorAt++ % NEW_CODE_COLORS.length],
      start: cs || legend.start || "", end: ce || legend.end || "",
    };
    return { key, text: t.text, count: t.count, existingId: existing ? existing.id : "", proposal };
  }).sort((a, b) => b.count - a.count);

  const posts = [...postTally.entries()].map(([key, t]) => {
    const existing = postsByKey.get(key);
    return { key, name: t.name, count: t.count, existingId: existing ? existing.id : "" };
  });

  const leave = [];
  grid.people.forEach((p, index) => leaveRuns(p, grid.days).forEach((run) => leave.push({ index, ...run })));

  const dates = grid.days.map((d) => d.date);
  let existing = 0;
  people.forEach((pp) => {
    if (!pp.staffId) return;
    dates.forEach((date) => { if (entriesOf((data.cells?.[date] || {})[pp.staffId]).length) existing += 1; });
  });

  const nonOfficial = grid.days.filter((d) => d.nonOff && !isNonOff({ fridayRule: data.fridayRule, nonOfficial: data.nonOfficial || [] }, d.date)).length;

  return {
    from: dates[0], to: dates[dates.length - 1], days: dates.length,
    people, codes, posts, leave, unclear, existing,
    counts: {
      people: people.length, days: dates.length, duties, breaks, leavePeriods: leave.length,
      newCodes: codes.filter((c) => !c.existingId).length,
      newPosts: posts.filter((p) => !p.existingId).length,
      newStaff: people.filter((p) => p.status === "new").length,
      closeNames: people.filter((p) => p.status === "close").length,
      nonOfficial, unclear: unclear.length,
    },
  };
};

/* The default choices for a plan, which the preview screen then lets the
   manager change: exact and close matches as found, new names added
   (ticked by default, as agreed), known codes and posts mapped, new ones
   created from their proposals. */
export const defaultChoices = (plan) => ({
  mode: plan.existing ? "" : "replace",       // "" = the manager must pick, because duties would be overwritten
  people: Object.fromEntries(plan.people.map((p) => [p.index, p.staffId || "new"])),
  codes: Object.fromEntries(plan.codes.map((c) => [c.key, c.existingId || { create: true, ...c.proposal }])),
  posts: Object.fromEntries(plan.posts.map((p) => [p.key, p.existingId || "new"])),
  staffDetails: true,      // fill blank designation/contact/ID/dates from the file
  emails: false,           // an email links a staff row to someone's login, so it's opt-in
});

/**
 * Writes the import into `d` (already a copy — this runs inside update()).
 * @param choices   from defaultChoices, as changed by the manager:
 *   mode:   "replace" (the file wins on days it fills) | "fill" (only days that are empty)
 *   people: { [index]: staffId | "new" | "skip" }
 *   codes:  { [key]: codeId | "skip" | { create: true, code, label, counts, color, start, end } }
 *   posts:  { [key]: postId | "new" | "skip" }
 *   staffDetails, emails: booleans
 * @param opts { staffLimit, today }   today as "YYYY-MM-DD"
 * @returns { data: d, report }
 *
 * Days the file leaves blank are never cleared, in either mode: an import
 * only ever adds or replaces what the file actually says.
 */
export const applyImport = (d, grid, plan, choices, opts = {}) => {
  const report = {
    staffAdded: 0, staffMatched: 0, staffSkipped: 0, staffOverLimit: [], codesAdded: 0, postsAdded: 0,
    duties: 0, breaks: 0, overwritten: 0, keptExisting: 0, leavePeriods: 0, leaveSkipped: 0,
    nonOfficialAdded: 0, detailsFilled: 0, columnsAdded: 0,
  };
  const today = opts.today || iso(new Date().getFullYear(), new Date().getMonth() + 1, new Date().getDate());
  d.staff = d.staff || [];
  d.codes = d.codes || [];
  d.posts = d.posts || [];
  d.cells = d.cells || {};
  d.cellMeta = d.cellMeta || {};
  d.nonOfficial = d.nonOfficial || [];

  /* Codes. */
  const codeId = {};
  Object.entries(choices.codes || {}).forEach(([key, ch]) => {
    if (!ch || ch === "skip") return;
    if (typeof ch === "string") { if (d.codes.some((c) => c.id === ch)) codeId[key] = ch; return; }
    const again = d.codes.find((c) => codeKey(c.code) === codeKey(ch.code));
    if (again) { codeId[key] = again.id; return; }
    const id = uid();
    const c = { id, code: clean(ch.code).slice(0, 8), label: clean(ch.label) || clean(ch.code), color: ch.color || "#A9D3E0", counts: ch.counts || "other" };
    if (ch.start && ch.end) { c.start = ch.start; c.end = ch.end; }
    if (c.counts === "evening") d.eveningEnabled = true;
    d.codes.push(c);
    codeId[key] = id;
    report.codesAdded += 1;
  });

  /* Posts. */
  const postId = {};
  plan.posts.forEach((p) => {
    const ch = (choices.posts || {})[p.key];
    if (!ch || ch === "skip") return;
    if (ch !== "new") { if (d.posts.some((x) => x.id === ch)) postId[p.key] = ch; return; }
    const again = d.posts.find((x) => postKey(x.name) === p.key);
    if (again) { postId[p.key] = again.id; return; }
    const id = uid();
    d.posts.push({ id, name: p.name });
    postId[p.key] = id;
    report.postsAdded += 1;
  });

  /* People. New staff respect the plan's staff limit (Basic: 20). */
  const activeCount = () => d.staff.filter((s) => !s.endDate || s.endDate >= today).length;
  const staffSheetByKey = new Map((grid.staffSheet || []).map((s) => [nameKey(s.name), s]));
  const staffOf = {};
  grid.people.forEach((p, index) => {
    const ch = (choices.people || {})[index];
    if (!ch || ch === "skip") { report.staffSkipped += 1; return; }
    if (ch !== "new") {
      const s = d.staff.find((x) => x.id === ch);
      if (s) { staffOf[index] = s; report.staffMatched += 1; } else report.staffSkipped += 1;
      return;
    }
    if (opts.staffLimit != null && activeCount() >= opts.staffLimit) { report.staffOverLimit.push(p.name); return; }
    const s = { name: p.name, designation: "", contact: "", recc: "", licence: "", email: "",
                employmentRole: "employee", startDate: "", endDate: "", leavePeriods: [], id: uid() };
    d.staff.push(s);
    staffOf[index] = s;
    report.staffAdded += 1;
  });

  /* Details: only ever fill a blank, never overwrite. */
  if (choices.staffDetails) {
    const ownCols = () => (d.staffColumns = d.staffColumns || []);
    grid.people.forEach((p, index) => {
      const s = staffOf[index];
      if (!s) return;
      const sheet = staffSheetByKey.get(nameKey(p.name)) || {};
      const offer = {
        designation: p.designation || sheet.designation, contact: p.details.contact || sheet.contact,
        recc: p.details.recc || sheet.recc, licence: sheet.licence, startDate: sheet.startDate, endDate: sheet.endDate,
        ...(choices.emails ? { email: p.details.email || sheet.email } : {}),
      };
      let filled = false;
      Object.entries(offer).forEach(([k, v]) => {
        if (v && !clean(s[k])) { s[k] = clean(v); filled = true; }
      });
      Object.entries(p.extra || {}).forEach(([colName, v]) => {
        if (!v) return;
        let col = ownCols().find((c) => c.name.toLowerCase() === colName.toLowerCase());
        if (!col) { col = { id: uid(), name: colName.slice(0, 30) }; ownCols().push(col); report.columnsAdded += 1; }
        s.extra = s.extra || {};
        if (!clean(s.extra[col.id])) { s.extra[col.id] = v; filled = true; }
      });
      if (filled) report.detailsFilled += 1;
    });
  }

  /* Leave periods: added unless the person already has leave overlapping
     them, so an import never stacks two leaves on one day. */
  const periodsFor = new Map();   // staffId → [{start,end}] added by this import
  plan.leave.forEach((lv) => {
    const s = staffOf[lv.index];
    if (!s) return;
    s.leavePeriods = s.leavePeriods || [];
    const overlap = s.leavePeriods.some((x) => x.start <= lv.end && x.end >= lv.start);
    if (overlap) { report.leaveSkipped += 1; return; }
    const period = { id: uid(), type: lv.type, start: lv.start, end: lv.end };
    if (lv.type === "other" && lv.label) period.label = lv.label;
    s.leavePeriods.push(period);
    if (!periodsFor.has(s.id)) periodsFor.set(s.id, []);
    periodsFor.get(s.id).push(period);
    report.leavePeriods += 1;
  });

  /* Duties and breaks. */
  const replace = choices.mode !== "fill";
  const anyPosts = Object.keys(postId).length > 0;
  if (anyPosts) d.postsEnabled = true;
  const postFor = (name) => (name ? postId[postKey(name)] || "" : "");
  grid.people.forEach((p, index) => {
    const s = staffOf[index];
    if (!s) return;
    grid.days.forEach(({ date }) => {
      const c = p.cells[date];
      if (!c || c.blank || c.notEmployed) return;
      const had = entriesOf((d.cells[date] || {})[s.id]).length > 0;
      const onOldLeave = !(periodsFor.get(s.id) || []).some((x) => date >= x.start && date <= x.end) && leaveOn(s, date);
      if (c.leave) {
        // A leave day: the period now covers it. The day's own cell is skipped
        // by every count, so on Replace an old duty there is cleared.
        if (replace && had && (periodsFor.get(s.id) || []).some((x) => date >= x.start && date <= x.end)) {
          delete d.cells[date][s.id];
          report.overwritten += 1;
        }
        return;
      }
      const first = codeId[codeKey(c.code)];
      if (!first) return;
      if (!replace && (had || onOldLeave)) { report.keptExisting += 1; return; }
      const ents = [{ code: first, post: postFor(c.post) }];
      const second = c.second ? codeId[codeKey(c.second)] : "";
      if (second) { ents.push({ code: second, post: postFor(c.secondPost) }); d.splitEnabled = true; }
      const value = ents.length === 1 && !ents[0].post ? first : ents;
      if (had) report.overwritten += 1;
      d.cells[date] = d.cells[date] || {};
      d.cells[date][s.id] = value;
      report.duties += ents.length;
      const metaDay = (d.cellMeta[date] = d.cellMeta[date] || {});
      if (c.brk) {
        metaDay[s.id] = { ...(metaDay[s.id] || {}), breakTime: { start: c.brk.start, end: c.brk.end } };
        report.breaks += 1;
      } else if (had && metaDay[s.id] && metaDay[s.id].breakTime) {
        // The old duty's break doesn't belong to the new duty.
        delete metaDay[s.id].breakTime;
        if (!Object.keys(metaDay[s.id]).length) delete metaDay[s.id];
      }
    });
  });

  /* Non-official days the file marks that the department doesn't have yet. */
  grid.days.forEach(({ date, nonOff }) => {
    if (nonOff && !isNonOff(d, date)) { d.nonOfficial.push(date); report.nonOfficialAdded += 1; }
  });

  return { data: d, report };
};

/* For the preview: the one-line summary, e.g.
   "20 staff · 21 days · 411 duties and days off · 299 breaks · 2 leave periods". */
export const summaryLine = (plan) => {
  const c = plan.counts;
  const bits = [
    `${c.people} staff`, `${c.days} days`, `${c.duties} duties and days off`,
    c.breaks ? `${c.breaks} breaks` : "", c.leavePeriods ? `${c.leavePeriods} leave period${c.leavePeriods === 1 ? "" : "s"}` : "",
    c.newCodes ? `${c.newCodes} new code${c.newCodes === 1 ? "" : "s"}` : "",
    c.newPosts ? `${c.newPosts} new post${c.newPosts === 1 ? "" : "s"}` : "",
    c.newStaff ? `${c.newStaff} new name${c.newStaff === 1 ? "" : "s"}` : "",
    c.closeNames ? `${c.closeNames} to check` : "",
  ];
  return bits.filter(Boolean).join(" · ");
};
