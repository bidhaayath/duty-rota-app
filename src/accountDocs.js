import ExcelJS from "exceljs";
import { entriesOf } from "./rotaCounts";

/* ─────────────── Documents from Your account ───────────────
   Quotation, proforma invoice and payment receipt: each is a plain A4 HTML
   page opened in a new tab, where the browser's own Print → "Save as PDF"
   makes the file. No PDF library, no server, nothing stored.

   Also "Download my data": one Excel file with every department this person
   owns, built in the browser from rotas they can already open.

   Prices: the NORMAL list price from plan_limits (the same rows the plans
   page reads), never an offer price. GST is added on top at GST_RATE.

   Nothing in this file writes to the database.                          */

export const SELLER = {
  name: "SHAB INVESTMENT",
  brand: "Easy Duty Rota",
  regNo: "SP-0143/2017",
  gstTin: "1040747GST501",
  address: "G. Ranhiri, Ameenee Magu, K. Male', Maldives",
  email: "support@easydutyrota.com",
  phone: "+960 766 6261",
  web: "easydutyrota.com",
  bankName: "Bank of Maldives (BML)",
  accountName: "Shab Investment",
  accountNo: "7770000258260",     // MVR account
  accountNoUsd: "7770000258262",  // USD account
};
export const GST_RATE = 0.08;        // general sector GST, MIRA
export const QUOTE_VALID_DAYS = 30;

const pad = (n) => String(n).padStart(2, "0");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const niceDate = (d) => `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
export const money = (laari) => `MVR ${(Math.round(Number(laari) || 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* A number people can quote back: EDR-Q-261128-1435 (date, then time).
   Built from the moment it was made, so nothing has to be stored. */
export const docNumber = (kind, d = new Date()) =>
  `EDR-${kind === "proforma" ? "PI" : "Q"}-${String(d.getFullYear()).slice(2)}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;

// Subtotal, GST on top, total — all in laari, GST rounded to the laari.
export const withGst = (laari) => {
  const subtotal = Math.round(Number(laari) || 0);
  const gst = Math.round(subtotal * GST_RATE);
  return { subtotal, gst, total: subtotal + gst };
};

export const planLine = (p) => {
  const d = p.max_departments == null ? "Unlimited departments" : `${p.max_departments} department${p.max_departments === 1 ? "" : "s"}`;
  const s = p.max_staff == null ? "unlimited staff" : `up to ${p.max_staff} staff`;
  // Smart Roster comes with Plus and Pro (as on the plans page).
  const smart = ["plus", "pro"].includes(p.tier) ? ", includes Smart Roster" : "";
  return `${d}, ${s}${smart}`;
};

// Anything a person typed is escaped before it goes into the page.
export const esc = (v) => String(v == null ? "" : v)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const PAGE_CSS = `
@page{size:A4;margin:0}
*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;font-family:Inter,system-ui,-apple-system,Segoe UI,Arial,sans-serif;color:#1D2B30;font-size:11.5pt;line-height:1.45}
.sheet{max-width:210mm;margin:0 auto;padding:16mm}
.top{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}
.brand{display:flex;align-items:center;gap:10px;font-weight:800;font-size:17pt;color:#0D4F61}
.mark{width:44px;height:42px;flex:none}
.muted{color:#4A5B61}
.title{font-size:20pt;font-weight:800;letter-spacing:.04em;color:#0E3A47;text-align:right}
.box{margin-top:16px;padding:12px 14px;background:#F3F8FA;border-radius:8px;display:flex;gap:24px}
.label{font-size:8.5pt;font-weight:700;color:#6B7F86;letter-spacing:.06em}
table{width:100%;border-collapse:collapse;margin-top:16px}
th{text-align:left;font-size:8.5pt;letter-spacing:.06em;color:#6B7F86;padding:6px 4px;border-bottom:1.5px solid #0E3A47}
td{padding:10px 4px;border-bottom:1px solid #E4ECEF;vertical-align:top}
.r{text-align:right;white-space:nowrap}
.totals{margin:10px 0 0 auto;width:260px}
.totals div{display:flex;justify-content:space-between;padding:3px 0}
.grand{border-top:1.5px solid #0E3A47;margin-top:4px;padding-top:6px!important;font-weight:800;font-size:13pt}
.notes{margin-top:18px;padding-top:10px;border-top:1px solid #E4ECEF;display:flex;flex-direction:column;gap:5px}
.foot{margin-top:26px;font-size:9pt;color:#6B7F86;text-align:center}
.bar{position:sticky;top:0;background:#E4F2F8;padding:10px;text-align:center;font-family:Inter,sans-serif}
.bar button{font:inherit;font-weight:700;background:#0E3A47;color:#fff;border:0;border-radius:999px;padding:10px 20px;cursor:pointer}
@media print{.bar{display:none}}
`;

/* The Easy Duty Rota mark, the same drawing as LogoMark.js (login page and
   top bar): three stacked bars with the two accent circles. Inline SVG, so
   it prints sharp and needs no image file. */
const LOGO = `<svg class="mark" viewBox="24 13 52 50" aria-hidden="true"><defs><linearGradient id="edrDocPurple" x1="1" y1="0" x2="0" y2="1"><stop offset="50%" stop-color="#8E7CC3"/><stop offset="50%" stop-color="#C9BEE6"/></linearGradient></defs><circle cx="32.9" cy="22.5" r="5.9" fill="#E89B4C"/><rect x="43" y="16.7" width="30" height="11.7" rx="3.4" fill="#E89B4C"/><rect x="27" y="32.2" width="30.3" height="11.6" rx="3.4" fill="#4C9BDE"/><rect x="27" y="47.5" width="30.3" height="11.9" rx="3.4" fill="#82C25E"/><circle cx="67.2" cy="53.4" r="5.9" fill="url(#edrDocPurple)"/></svg>`;

const seller = () => `
  <div>
    <div class="brand">${LOGO}${esc(SELLER.brand)}</div>
    <div class="muted" style="margin-top:8px"><strong style="color:#1D2B30">${esc(SELLER.name)}</strong><br>
    Reg. no. ${esc(SELLER.regNo)} · GST TIN ${esc(SELLER.gstTin)}<br>${esc(SELLER.address)}<br>
    ${esc(SELLER.email)} · ${esc(SELLER.phone)}</div>
  </div>`;

const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><style>${PAGE_CSS}</style></head><body>
<div class="bar"><button onclick="window.print()">Save as PDF / Print</button></div>
<div class="sheet">${body}</div></body></html>`;

/* Quotation or proforma invoice.
   doc: { kind: "quote"|"proforma", to: { org, address, attn, ref }, plan, cycle: "monthly"|"annual", date } */
export function quoteHtml({ kind = "quote", to = {}, plan, cycle = "annual", date = new Date() }) {
  const annual = cycle === "annual";
  const price = annual ? plan.price_annual_laari : plan.price_monthly_laari;
  const { subtotal, gst, total } = withGst(price);
  const no = docNumber(kind, date);
  const until = new Date(date.getFullYear(), date.getMonth(), date.getDate() + QUOTE_VALID_DAYS);
  const planName = plan.label || (plan.tier ? plan.tier.charAt(0).toUpperCase() + plan.tier.slice(1) : "Plan");
  const title = kind === "proforma" ? "PROFORMA INVOICE" : "QUOTATION";
  const body = `
  <div class="top">${seller()}
    <div><div class="title">${title}</div>
    <div class="muted" style="text-align:right;margin-top:6px">No. <strong style="color:#1D2B30">${esc(no)}</strong><br>Date ${niceDate(date)}<br>Valid until ${niceDate(until)}</div></div>
  </div>
  <div class="box">
    <div style="flex:1"><div class="label">PREPARED FOR</div><strong>${esc(to.org) || "&nbsp;"}</strong>${to.address ? `<br>${esc(to.address)}` : ""}${to.attn ? `<br>Attn: ${esc(to.attn)}` : ""}</div>
    <div style="text-align:right"><div class="label">THEIR REFERENCE</div>${esc(to.ref) || "—"}</div>
  </div>
  <table><thead><tr><th>DESCRIPTION</th><th>PERIOD</th><th class="r">AMOUNT</th></tr></thead>
  <tbody><tr><td><strong>${esc(SELLER.brand)} — ${esc(planName)} plan</strong><br><span class="muted">${esc(planLine(plan))}</span></td>
  <td>${annual ? "12 months" : "1 month"}</td><td class="r">${money(subtotal)}</td></tr></tbody></table>
  <div class="totals">
    <div><span class="muted">Subtotal</span><span>${money(subtotal)}</span></div>
    <div><span class="muted">GST ${Math.round(GST_RATE * 100)}%</span><span>${money(gst)}</span></div>
    <div class="grand"><span>Total</span><span>${money(total)}</span></div>
  </div>
  <div class="notes muted">
    <div><strong style="color:#1D2B30">How to pay:</strong> bank transfer to <strong style="color:#1D2B30">${esc(SELLER.accountName)}</strong>, ${esc(SELLER.bankName)}, quoting ${esc(no)}:<br>
    MVR account <strong style="color:#1D2B30">${esc(SELLER.accountNo)}</strong> · USD account <strong style="color:#1D2B30">${esc(SELLER.accountNoUsd)}</strong><br>
    Or pay by card at ${esc(SELLER.web)}.</div>
    <div><strong style="color:#1D2B30">Activation:</strong> the plan starts the day payment is received. Nothing renews by itself.</div>
    <div>${kind === "proforma" ? "Proforma invoice for payment approval. A receipt is issued when payment is received." : "This is a quotation, not a tax invoice."}</div>
  </div>
  <div class="foot">${esc(SELLER.name)} · ${esc(SELLER.web)}</div>`;
  return page(`${title} ${no}`, body);
}

/* A receipt for one paid payment row from `payments`. */
export function receiptHtml({ payment, to = {} }) {
  const paid = new Date(payment.paid_at || payment.created_at || Date.now());
  const no = `EDR-R-${String(payment.id || "").replace(/-/g, "").slice(0, 8).toUpperCase()}`;
  const tier = payment.tier ? payment.tier.charAt(0).toUpperCase() + payment.tier.slice(1) : "Plan";
  const cycle = payment.billing_cycle === "annual" ? "12 months" : payment.billing_cycle === "monthly" ? "1 month" : (payment.billing_cycle || "");
  const by = /bml|card/i.test(payment.provider || "") ? "Card (BML)" : payment.provider ? payment.provider : "Bank transfer";
  const body = `
  <div class="top">${seller()}
    <div><div class="title">RECEIPT</div>
    <div class="muted" style="text-align:right;margin-top:6px">No. <strong style="color:#1D2B30">${esc(no)}</strong><br>Paid ${niceDate(paid)}</div></div>
  </div>
  <div class="box"><div style="flex:1"><div class="label">RECEIVED FROM</div><strong>${esc(to.org) || "&nbsp;"}</strong>${to.email ? `<br>${esc(to.email)}` : ""}</div>
    <div style="text-align:right"><div class="label">PAID BY</div>${esc(by)}</div></div>
  <table><thead><tr><th>DESCRIPTION</th><th>PERIOD</th><th class="r">AMOUNT PAID</th></tr></thead>
  <tbody><tr><td><strong>${esc(SELLER.brand)} — ${esc(tier)} plan</strong></td><td>${esc(cycle)}</td><td class="r">${money(payment.amount_laari)}</td></tr></tbody></table>
  <div class="totals"><div class="grand"><span>Total paid</span><span>${money(payment.amount_laari)}</span></div></div>
  <div class="notes muted"><div>Thank you. This receipt confirms the payment above was received.</div></div>
  <div class="foot">${esc(SELLER.name)} · ${esc(SELLER.web)}</div>`;
  return page(`Receipt ${no}`, body);
}

/* Open a document in a new tab. Called straight from a button press, so
   pop-up blockers allow it. Returns false if the browser refused. */
export function openDoc(html) {
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.open(); w.document.write(html); w.document.close();
  return true;
}

/* A ready-written email in the person's own mail app. */
export const mailto = (subject, body) =>
  `mailto:${SELLER.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
export const whatsapp = (text) => `https://wa.me/9607666261?text=${encodeURIComponent(text)}`;

/* ── Download my data ──
   depts: [{ name, data }] where data is a department's rota_data. One sheet
   per department: each person down the side, each date across, the duty
   codes in the cells (a split day as "M + E", with posts). Plus a Leave
   sheet. Built from rotas already loaded in the browser. */
export async function dataWorkbook(depts, orgName = "") {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Easy Duty Rota"; wb.created = new Date();
  const used = new Set();
  const sheetName = (n) => {
    let s = String(n || "Department").replace(/[\\/*?:[\]]/g, " ").slice(0, 28).trim() || "Department";
    let k = s, i = 2;
    while (used.has(k.toLowerCase())) k = `${s.slice(0, 25)} ${i++}`;
    used.add(k.toLowerCase()); return k;
  };
  const leaveRows = [];
  depts.forEach(({ name, data }) => {
    if (!data) return;
    const ws = wb.addWorksheet(sheetName(name));
    const codeOf = Object.fromEntries((data.codes || []).map((c) => [c.id, c.code]));
    const postOf = Object.fromEntries((data.posts || []).map((p) => [p.id, p.name]));
    const dates = Object.keys(data.cells || {}).sort();
    ws.addRow([orgName ? `${orgName} — ${name}` : name]);
    ws.getRow(1).font = { bold: true, size: 13 };
    ws.addRow(["Name", "Designation", "Email", ...dates]);
    ws.getRow(2).font = { bold: true };
    (data.staff || []).forEach((s) => {
      ws.addRow([s.name, s.designation || "", s.email || "", ...dates.map((d) =>
        entriesOf((data.cells[d] || {})[s.id]).map((e) => (codeOf[e.code] || "?") + (e.post && postOf[e.post] ? ` @ ${postOf[e.post]}` : "")).join(" + "))]);
      (s.leavePeriods || []).forEach((p) => leaveRows.push([name, s.name, p.label || p.type, p.start, p.end]));
    });
    ws.views = [{ state: "frozen", xSplit: 1, ySplit: 2 }];
    ws.getColumn(1).width = 28;
  });
  const lv = wb.addWorksheet("Leave");
  lv.addRow(["Department", "Name", "Leave type", "From", "To"]); lv.getRow(1).font = { bold: true };
  leaveRows.forEach((r) => lv.addRow(r));
  return wb;
}

export async function downloadData(depts, orgName = "") {
  const wb = await dataWorkbook(depts, orgName);
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const a = document.createElement("a");
  const d = new Date();
  a.href = URL.createObjectURL(blob);
  a.download = `Easy_Duty_Rota_my_data_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.xlsx`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
