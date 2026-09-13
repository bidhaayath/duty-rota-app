import ExcelJS from "exceljs";

/* ────────────────────────────────────────────────────────────────────────
   Excel export for a duty rota.

   WHY THIS FILE IS SEPARATE
     DutyRotaOriginal.js is already long and changes constantly. Everything
     here is pure formatting: it is handed a plain description of the rota
     and turns it into a workbook. It reads no state and touches no
     database. All the app knowledge — who is employed when, what a leave
     span covers, how totals are counted — stays in DutyRotaOriginal.js,
     which builds the model and passes it in. That way there is only ever
     one version of those rules.

   WHAT IT WRITES
     A file on the person's device. Nothing else. No network calls, no
     Supabase, nothing that could alter or expose customer data.

   WHO READS THE RESULT
     Usually the ward manager's boss, who receives several of these and
     stacks them together. So the shape is deliberately identical for
     every department: same header rows, same column order, totals always
     on the right. Predictable beats pretty when someone is combining them.
   ──────────────────────────────────────────────────────────────────────── */

/* ExcelJS wants "FFRRGGBB" — eight hex digits, alpha first. The app stores
   colours as "#RRGGBB", and a few as the shorthand "#RGB". */
const argb = (hex, fallback = "FFFFFFFF") => {
  if (!hex || typeof hex !== "string") return fallback;
  let h = hex.trim().replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6) return fallback;
  return "FF" + h.toUpperCase();
};

const THIN = { style: "thin", color: { argb: "FFD3E0E4" } };
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };

const LAGOON = "FF0F8B7E";
const GOLD_BG = "FFFBF1DC";   // non-official day, matching the screen
const GOLD_FG = "FFA5731B";
const HEAD_BG = "FFF4F8F7";

/* Excel refuses these in a sheet name, and silently truncates past 31. */
const safeSheetName = (name, fallback = "Rota") => {
  const cleaned = (name || "").replace(/[*?:\\/[\]]/g, " ").trim();
  return (cleaned || fallback).slice(0, 31);
};

/* A filename that survives Windows, Android and iOS. */
const safeFileName = (s) =>
  (s || "rota").replace(/[^a-z0-9\-_ ]/gi, "").replace(/\s+/g, "_").slice(0, 80);

/**
 * @param {object} model
 *   orgName     string
 *   deptName    string
 *   rangeLabel  string  e.g. "6 Sept 2026 – 12 Sept 2026"
 *   days        [{ date, dayName, dayLabel, nonOff }]
 *   totalHeads  [string]  e.g. ["M","A","N","OD","RD","OFF"]
 *   rows        [{ num, name, designation, cells, totals, nonOfficialDuty }]
 *                 cells: [{ span, text, post, second, secondPost, bg, fg, muted }]
 *                 totals: [number] aligned with totalHeads
 *   onCall      [string]  one per day, "" when nobody
 *   staff       [{ name, designation, email, contact, recc, licence,
 *                  employmentRole, startDate, endDate, status }]
 */
export async function exportRotaToExcel(model) {
  const {
    orgName = "", deptName = "Rota", rangeLabel = "",
    days = [], totalHeads = [], rows = [], onCall = [], staff = [], coverage = [],
  } = model || {};

  const wb = new ExcelJS.Workbook();
  wb.creator = "Easy Duty Rota";
  wb.created = new Date();

  /* ── Sheet 1: the rota grid ─────────────────────────────────────────── */
  const ws = wb.addWorksheet(safeSheetName(deptName), {
    views: [{ state: "frozen", xSplit: 2, ySplit: 4 }],
    pageSetup: {
      orientation: days.length > 10 ? "landscape" : "portrait",
      fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
    },
  });

  const lastCol = 2 + days.length + totalHeads.length + 1;

  /* Title block. The boss needs to know whose rota this is at a glance,
     which is why the organisation name leads, exactly as on the PDF. */
  ws.mergeCells(1, 1, 1, lastCol);
  const t1 = ws.getCell(1, 1);
  t1.value = orgName ? `${orgName} — ${deptName}` : deptName;
  t1.font = { bold: true, size: 14, color: { argb: LAGOON } };
  t1.alignment = { vertical: "middle" };
  ws.getRow(1).height = 20;

  ws.mergeCells(2, 1, 2, lastCol);
  const t2 = ws.getCell(2, 1);
  t2.value = rangeLabel;
  t2.font = { size: 10, color: { argb: "FF4A6570" } };

  ws.mergeCells(3, 1, 3, lastCol);
  const t3 = ws.getCell(3, 1);
  t3.value = "Gold columns are non-official days. Duty on those days counts for payment.";
  t3.font = { size: 9, italic: true, color: { argb: GOLD_FG } };

  /* Header row. */
  const HEAD = 4;
  const head = ws.getRow(HEAD);
  head.height = 30;
  head.getCell(1).value = "#";
  head.getCell(2).value = "NAME";
  days.forEach((d, i) => {
    const c = head.getCell(3 + i);
    c.value = d.nonOff ? `${d.dayName}\n${d.dayLabel}\nNON-OFFICIAL` : `${d.dayName}\n${d.dayLabel}`;
  });
  totalHeads.forEach((h, i) => { head.getCell(3 + days.length + i).value = h; });
  head.getCell(lastCol).value = "NON-OFF DUTY";

  for (let c = 1; c <= lastCol; c++) {
    const cell = head.getCell(c);
    const isDay = c >= 3 && c < 3 + days.length;
    const gold = (isDay && days[c - 3].nonOff) || c === lastCol;
    cell.font = { bold: true, size: 9, color: { argb: gold ? GOLD_FG : "FF4A6570" } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: gold ? GOLD_BG : HEAD_BG } };
    cell.border = BORDER;
  }

  /* Staff rows. */
  rows.forEach((r, ri) => {
    const row = ws.getRow(HEAD + 1 + ri);
    /* Tall enough for the busiest cell in the row: a duty, its post, a second
       duty and its post is four lines. */
    const maxLines = r.cells.reduce((n, c) => Math.max(n,
      (c.text ? 1 : 0) + (c.post ? 1 : 0) + (c.second ? 1 : 0) + (c.secondPost ? 1 : 0)), 1);
    row.height = maxLines > 1 ? 12 + maxLines * 11 : 20;

    row.getCell(1).value = r.num;
    row.getCell(1).font = { size: 9, color: { argb: "FF4A6570" } };
    row.getCell(1).alignment = { horizontal: "center", vertical: "middle" };

    row.getCell(2).value = r.designation ? `${r.name} — ${r.designation}` : r.name;
    row.getCell(2).font = { bold: true, size: 10 };
    row.getCell(2).alignment = { vertical: "middle", wrapText: false };

    /* Cells arrive as segments so a leave period or a not-yet-joined gap
       covers several days as one block, exactly as it looks on screen. */
    let col = 3;
    r.cells.forEach((seg) => {
      const span = Math.max(1, seg.span || 1);
      const cell = row.getCell(col);
      if (span > 1) ws.mergeCells(row.number, col, row.number, col + span - 1);
      /* Everything about the day stacks inside one cell: the duty, its post,
         then a second duty and its post where the day is a split one. Two rows
         per person would double the height of every sheet and make combining
         several departments much harder, which is the whole point of this
         export for the person receiving it. */
      const lines = [];
      if (seg.text) lines.push(seg.text);
      if (seg.post) lines.push(seg.post);
      if (seg.second) lines.push(seg.second);
      if (seg.secondPost) lines.push(seg.secondPost);
      cell.value = lines.join("\n");
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: lines.length > 1 };
      cell.font = {
        bold: !seg.muted, size: 10,
        italic: !!seg.muted,
        color: { argb: argb(seg.fg, "FF142B33") },
      };
      if (seg.bg) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(seg.bg) } };
      for (let k = 0; k < span; k++) row.getCell(col + k).border = BORDER;
      col += span;
    });

    /* Totals, then the payment-relevant count on the far right. */
    (r.totals || []).forEach((v, i) => {
      const cell = row.getCell(3 + days.length + i);
      cell.value = v;
      cell.font = { bold: true, size: 10 };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = BORDER;
    });
    const nod = row.getCell(lastCol);
    nod.value = r.nonOfficialDuty;
    nod.font = { bold: true, size: 10, color: { argb: GOLD_FG } };
    nod.alignment = { horizontal: "center", vertical: "middle" };
    nod.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GOLD_BG } };
    nod.border = BORDER;
  });

  /* On-call row, when the department uses it. */
  if (onCall.some((x) => x)) {
    const row = ws.getRow(HEAD + 1 + rows.length);
    row.height = 20;
    row.getCell(2).value = "On-call";
    row.getCell(2).font = { bold: true, size: 10, color: { argb: GOLD_FG } };
    row.getCell(2).alignment = { vertical: "middle" };
    row.getCell(1).border = BORDER;
    row.getCell(2).border = BORDER;
    onCall.forEach((name, i) => {
      const cell = row.getCell(3 + i);
      cell.value = name || "";
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.font = { size: 9.5 };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDF8EE" } };
      cell.border = BORDER;
    });
    for (let c = 3 + days.length; c <= lastCol; c++) row.getCell(c).border = BORDER;
  }

  /* Coverage rows: how many people are on each shift each day. On screen
     these sit under the grid in the table footer. A boss combining several
     departments reads these first -- they answer "who have I got on Tuesday"
     -- so they must travel with the grid, not be left behind. */
  if (coverage.length) {
    let r = HEAD + 1 + rows.length + (onCall.some((x) => x) ? 1 : 0) + 1;
    coverage.forEach((cov) => {
      const row = ws.getRow(r);
      row.height = 18;
      ws.mergeCells(r, 1, r, 2);
      const lab = ws.getCell(r, 1);
      lab.value = cov.label;
      lab.font = { bold: true, size: 10, color: { argb: argb(cov.fg, "FF142B33") } };
      lab.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
      lab.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(cov.color) } };
      lab.border = BORDER;
      ws.getCell(r, 2).border = BORDER;
      (cov.counts || []).forEach((n, i) => {
        const cell = row.getCell(3 + i);
        cell.value = n;
        cell.font = { bold: true, size: 10 };
        cell.alignment = { horizontal: "center", vertical: "middle" };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(cov.soft, "FFF4F8F7") } };
        cell.border = BORDER;
      });
      for (let c = 3 + days.length; c <= lastCol; c++) row.getCell(c).border = BORDER;
      r += 1;
    });
  }

  ws.getColumn(1).width = 4;
  ws.getColumn(2).width = 30;
  for (let i = 0; i < days.length; i++) ws.getColumn(3 + i).width = 11;
  for (let i = 0; i < totalHeads.length; i++) ws.getColumn(3 + days.length + i).width = 5.5;
  ws.getColumn(lastCol).width = 13;

  /* ── Sheet 2: staff records ─────────────────────────────────────────── */
  if (staff.length) {
    const sh = wb.addWorksheet("Staff", {
      views: [{ state: "frozen", ySplit: 1 }],
      pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });
    const cols = [
      ["Name", 24], ["Designation", 20], ["Email", 28], ["Contact", 14],
      ["Employee ID", 14], ["Licence expiry", 15], ["Access", 12],
      ["Employed from", 15], ["Employed to", 15], ["Status", 10],
    ];
    sh.getRow(1).values = cols.map(([c]) => c);
    cols.forEach(([, w], i) => { sh.getColumn(i + 1).width = w; });
    const h = sh.getRow(1);
    h.height = 20;
    cols.forEach((_, i) => {
      const cell = h.getCell(i + 1);
      cell.font = { bold: true, size: 9, color: { argb: "FF4A6570" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD_BG } };
      cell.alignment = { vertical: "middle" };
      cell.border = BORDER;
    });
    staff.forEach((s, i) => {
      const row = sh.getRow(2 + i);
      row.values = [
        s.name || "", s.designation || "", s.email || "", s.contact || "",
        s.recc || "", s.licence || "", s.employmentRole || "",
        s.startDate || "", s.endDate || "", s.status || "",
      ];
      for (let c = 1; c <= cols.length; c++) {
        row.getCell(c).font = { size: 10 };
        row.getCell(c).border = BORDER;
      }
    });
  }

  /* Write and hand the file to the browser. */
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safeFileName(deptName)}_${safeFileName(rangeLabel) || "rota"}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  /* Give the browser a moment to start the download before releasing it;
     revoking straight away cancels it on some Android browsers. */
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}