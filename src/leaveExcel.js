import ExcelJS from "exceljs";

/* ────────────────────────────────────────────────────────────────────────
   Excel export for the Leave tab.

   Like rotaExcel.js, this file is pure formatting: LeaveTab.js builds a
   plain description of the leave on screen (who, which days, which type,
   in which colour) and this turns it into a workbook. It reads no state
   and touches no database; it only writes a file on the person's device.

   Sheets (following the Export menu choice):
     · "Leave chart": names down the side, one column per day, each leave
       day filled in its leave colour with its code, and the person's leave
       days in these dates on the right.
       Past 62 days (a year, a long range) the chart goes month by month
       instead: one column per month, each leave a band across the months
       it covers with its dates ("AL (7 Jul – 9 Aug)"), and the exact days
       move to a "Day by day" sheet after it.
     · "Leave list": one row per leave, with real Excel dates, so it can be
       sorted and filtered.
   ──────────────────────────────────────────────────────────────────────── */

const argb = (hex, fallback = "FFFFFFFF") => {
  if (!hex || typeof hex !== "string") return fallback;
  let h = hex.trim().replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6) return fallback;
  return "FF" + h.toUpperCase();
};
const THIN = { style: "thin", color: { argb: "FFD3E0E4" } };
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };
const INK = "FF0E3A47";
const SOFT = "FF3A5F6B";
const LAGOON = "FF0D4F61";
const HEAD_BG = "FFF1F7F9";
const GOLD_BG = "FFFBF1DC";
const GOLD_FG = "FFA5731B";
const safeFileName = (s) => (s || "leave").replace(/[^a-z0-9\-_ ]/gi, "").replace(/\s+/g, "_").slice(0, 80);
const asDate = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };

function titleBlock(ws, lastCol, { orgName, deptName, rangeLabel, typeLabel }) {
  ws.mergeCells(1, 1, 1, lastCol);
  const t1 = ws.getCell(1, 1);
  t1.value = orgName ? `${orgName} — ${deptName}` : deptName;
  t1.font = { bold: true, size: 14, color: { argb: LAGOON } };
  ws.getRow(1).height = 20;
  ws.mergeCells(2, 1, 2, lastCol);
  const t2 = ws.getCell(2, 1);
  t2.value = `Leave · ${rangeLabel} · ${typeLabel}`;
  t2.font = { size: 10, color: { argb: SOFT } };
}

/**
 * model:
 *   orgName, deptName, rangeLabel, typeLabel  strings
 *   parts      "both" | "chart" | "list"
 *   days       [{ date, dow, day, month, nonOff }]
 *   rows       [{ name, total, cells: { [dayIndex]: { text, bg, fg } } }]
 *   list       [{ name, abbrev, type, start, end, days, enteredAs, bg, fg }]
 */
export async function exportLeaveToExcel(model) {
  const { orgName = "", deptName = "Leave", rangeLabel = "", typeLabel = "All leave", parts = "both",
    days = [], rows = [], list = [] } = model || {};
  const wb = new ExcelJS.Workbook();
  wb.creator = "Easy Duty Rota";
  wb.created = new Date();
  const long = days.length > 62;

  /* ── Month by month, for a year or a long range ── */
  if (parts !== "list" && long) {
    const months = [];
    days.forEach((d, i) => {
      if (!months.length || months[months.length - 1].label !== d.month) months.push({ label: d.month, idx: [] });
      months[months.length - 1].idx.push(i);
    });
    const ws = wb.addWorksheet("Leave chart", {
      views: [{ state: "frozen", xSplit: 2, ySplit: 4 }],
      pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0,
        margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } },
    });
    const lastCol = 2 + months.length + 1;
    titleBlock(ws, lastCol, { orgName, deptName, rangeLabel, typeLabel });
    ws.mergeCells(3, 1, 3, lastCol);
    ws.getCell(3, 1).value = "Each leave across the months it covers. The exact days are on the Day by day sheet.";
    ws.getCell(3, 1).font = { size: 9, italic: true, color: { argb: SOFT } };
    const H = 4;
    const heads = ["#", "NAME", ...months.map((m) => m.label.toUpperCase()), "LEAVE DAYS"];
    heads.forEach((h, i) => {
      const cell = ws.getCell(H, i + 1);
      cell.value = h;
      cell.font = { bold: true, size: 9, color: { argb: SOFT } };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD_BG } };
      cell.border = BORDER;
    });
    ws.getRow(H).height = 28;
    ws.getColumn(1).width = 4;
    ws.getColumn(2).width = 24;
    months.forEach((m, i) => { ws.getColumn(3 + i).width = 16; });
    ws.getColumn(lastCol).width = 11;
    rows.forEach((r, k) => {
      const row = ws.getRow(H + 1 + k);
      let tall = false;
      row.getCell(1).value = k + 1;
      row.getCell(2).value = r.name;
      const monthOf = (i) => months.findIndex((m) => m.idx.includes(i));
      /* Each leave is a band over the months it covers, merged into one
         cell. When two leaves share a month, the later one's words join
         the cell already there instead of merging over it. */
      const taken = {};   // month column -> { cell texts }
      (r.bands || []).forEach((b) => {
        const m0 = monthOf(b.from), m1 = monthOf(b.to);
        if (m0 < 0 || m1 < 0) return;
        let free = true;
        for (let j = m0; j <= m1; j++) if (taken[j]) free = false;
        if (free) {
          if (m1 > m0) ws.mergeCells(row.number, 3 + m0, row.number, 3 + m1);
          const entry = { texts: [b.text], first: m0, span: m1 - m0 + 1, look: b };
          for (let j = m0; j <= m1; j++) taken[j] = entry;
        } else {
          for (let j = m0; j <= m1; j++) {
            if (taken[j]) { if (!taken[j].texts.includes(b.text)) taken[j].texts.push(b.text); }
            else taken[j] = { texts: [b.text], first: j, span: 1, look: b };
          }
        }
      });
      months.forEach((m, j) => {
        const cell = row.getCell(3 + j);
        const e = taken[j];
        if (e && e.first === j) {
          cell.value = e.texts.join("\n");
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(e.look.bg) } };
          cell.font = { bold: true, size: 9, color: { argb: argb(e.look.fg, INK) } };
          // Room for every line: about 17 characters fit in one month's width.
          const lines = e.texts.reduce((n, t) => n + Math.ceil(t.length / (17 * e.span)), 0);
          if (lines > 1) tall = Math.max(tall || 0, lines);
        }
        cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        cell.border = BORDER;
      });
      row.getCell(lastCol).value = r.total;
      row.height = tall ? 8 + 13 * tall : 20;
      row.getCell(1).font = { size: 9, color: { argb: SOFT } };
      row.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
      row.getCell(2).font = { bold: true, size: 10, color: { argb: INK } };
      row.getCell(2).alignment = { vertical: "middle", wrapText: true };
      row.getCell(lastCol).font = { bold: true, size: 10, color: { argb: INK } };
      row.getCell(lastCol).alignment = { horizontal: "center", vertical: "middle" };
      [1, 2, lastCol].forEach((c) => { row.getCell(c).border = BORDER; });
    });
    const foot = ws.getRow(H + 2 + rows.length);
    foot.getCell(2).value = "Made with Easy Duty Rota · easydutyrota.com";
    foot.getCell(2).font = { size: 8, italic: true, color: { argb: "FF888888" } };
  }

  /* ── The chart day by day (for a long range: the "Day by day" sheet) ── */
  if (parts !== "list") {
    const ws = wb.addWorksheet(long ? "Day by day" : "Leave chart", {
      views: [{ state: "frozen", xSplit: 2, ySplit: 5 }],
      pageSetup: { orientation: days.length > 10 ? "landscape" : "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0,
        margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } },
    });
    const lastCol = 2 + days.length + 1;
    titleBlock(ws, lastCol, { orgName, deptName, rangeLabel, typeLabel });
    ws.mergeCells(3, 1, 3, lastCol);
    const t3 = ws.getCell(3, 1);
    t3.value = "Gold columns are non-official days.";
    t3.font = { size: 9, italic: true, color: { argb: GOLD_FG } };

    // Row 4: the months; row 5: each day.
    const MONTH = 4, DAY = 5;
    let start = 0;
    days.forEach((d, i) => {
      const last = i === days.length - 1 || days[i + 1].month !== d.month;
      if (!last) return;
      if (i > start) ws.mergeCells(MONTH, 3 + start, MONTH, 3 + i);
      const c = ws.getCell(MONTH, 3 + start);
      c.value = d.month;
      start = i + 1;
    });
    ws.mergeCells(MONTH, 1, DAY, 1);
    ws.mergeCells(MONTH, 2, DAY, 2);
    ws.mergeCells(MONTH, lastCol, DAY, lastCol);
    ws.getCell(MONTH, 1).value = "#";
    ws.getCell(MONTH, 2).value = "NAME";
    ws.getCell(MONTH, lastCol).value = "LEAVE DAYS";
    days.forEach((d, i) => { ws.getCell(DAY, 3 + i).value = long ? d.day : `${d.dow}\n${d.day}`; });
    ws.getRow(DAY).height = long ? 16 : 28;
    for (let r = MONTH; r <= DAY; r++) {
      for (let c = 1; c <= lastCol; c++) {
        const cell = ws.getCell(r, c);
        const gold = r === DAY && c >= 3 && c < lastCol && days[c - 3].nonOff;
        cell.font = { bold: true, size: long ? 8 : 9, color: { argb: gold ? GOLD_FG : SOFT } };
        cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: gold ? GOLD_BG : HEAD_BG } };
        cell.border = BORDER;
      }
    }
    ws.getColumn(1).width = 4;
    ws.getColumn(2).width = 24;
    for (let i = 0; i < days.length; i++) ws.getColumn(3 + i).width = long ? 3.6 : 5.2;
    ws.getColumn(lastCol).width = 11;

    rows.forEach((r, k) => {
      const row = ws.getRow(DAY + 1 + k);
      row.height = 18;
      row.getCell(1).value = k + 1;
      row.getCell(2).value = r.name;
      days.forEach((d, i) => {
        const cell = row.getCell(3 + i);
        const hit = r.cells[i];
        if (hit) {
          cell.value = hit.text;
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(hit.bg) } };
          cell.font = { bold: true, size: long ? 7 : 8, color: { argb: argb(hit.fg, INK) } };
        } else if (d.nonOff) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GOLD_BG } };
        }
        cell.alignment = { horizontal: "center", vertical: "middle" };
        cell.border = BORDER;
      });
      row.getCell(lastCol).value = r.total;
      row.getCell(1).font = { size: 9, color: { argb: SOFT } };
      row.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
      row.getCell(2).font = { bold: true, size: 10, color: { argb: INK } };
      row.getCell(2).alignment = { vertical: "middle" };
      row.getCell(lastCol).font = { bold: true, size: 10, color: { argb: INK } };
      row.getCell(lastCol).alignment = { horizontal: "center", vertical: "middle" };
      [1, 2, lastCol].forEach((c) => { row.getCell(c).border = BORDER; });
    });
    const foot = ws.getRow(DAY + 2 + rows.length);
    foot.getCell(2).value = "Made with Easy Duty Rota · easydutyrota.com";
    foot.getCell(2).font = { size: 8, italic: true, color: { argb: "FF888888" } };
  }

  /* ── Sheet 2: the list ── */
  if (parts !== "chart") {
    const ws = wb.addWorksheet("Leave list", { views: [{ state: "frozen", ySplit: 3 }] });
    const heads = ["#", "Name", "Leave", "Type", "From", "To", "Days", "Entered as"];
    titleBlock(ws, heads.length, { orgName, deptName, rangeLabel, typeLabel });
    const H = 3;
    heads.forEach((h, i) => {
      const cell = ws.getCell(H, i + 1);
      cell.value = h.toUpperCase();
      cell.font = { bold: true, size: 9, color: { argb: SOFT } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD_BG } };
      cell.alignment = { vertical: "middle", horizontal: h === "#" || h === "Days" ? "center" : "left" };
      cell.border = BORDER;
    });
    [4, 26, 8, 24, 13, 13, 7, 14].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    if (!list.length) ws.getCell(H + 1, 2).value = "No leave in these dates.";
    list.forEach((it, k) => {
      const row = ws.getRow(H + 1 + k);
      row.values = [k + 1, it.name, it.abbrev, it.type, asDate(it.start), asDate(it.end), it.days, it.enteredAs];
      for (let c = 1; c <= heads.length; c++) {
        const cell = row.getCell(c);
        cell.font = { size: 10, color: { argb: INK }, bold: c === 2 || c === 7 };
        cell.border = BORDER;
        cell.alignment = { vertical: "middle", horizontal: c === 1 || c === 3 || c === 7 ? "center" : "left" };
      }
      row.getCell(3).fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(it.bg) } };
      row.getCell(3).font = { size: 9, bold: true, color: { argb: argb(it.fg, INK) } };
      row.getCell(5).numFmt = "d mmm yyyy";
      row.getCell(6).numFmt = "d mmm yyyy";
    });
    ws.autoFilter = { from: { row: H, column: 1 }, to: { row: H + Math.max(1, list.length), column: heads.length } };
  }

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safeFileName(deptName)}_Leave_${safeFileName(rangeLabel)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoking straight away cancels the download on some Android browsers.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
