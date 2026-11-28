import { docNumber, withGst, quoteHtml, receiptHtml, dataWorkbook, money, SELLER } from "./accountDocs";

const plan = { tier: "plus", label: "Plus", price_monthly_laari: 120000, price_annual_laari: 1200000, max_departments: 6, max_staff: null };
const when = new Date(2026, 10, 28, 14, 35);

test("document numbers come from the date and time", () => {
  expect(docNumber("quote", when)).toBe("EDR-Q-261128-1435");
  expect(docNumber("proforma", when)).toBe("EDR-PI-261128-1435");
});

test("GST is 8% on top, rounded to the laari", () => {
  expect(withGst(1200000)).toEqual({ subtotal: 1200000, gst: 96000, total: 1296000 });
  expect(withGst(46501).gst).toBe(3720);
  expect(money(1296000)).toBe("MVR 12,960.00");
});

test("a quotation shows the normal price, GST, total, validity and bank details", () => {
  const h = quoteHtml({ kind: "quote", to: { org: "Male' Hospital", address: "Sosun Magu", attn: "Procurement" }, plan, cycle: "annual", date: when });
  expect(h).toContain("QUOTATION");
  expect(h).toContain("EDR-Q-261128-1435");
  expect(h).toContain("Valid until 28 Dec 2026");
  expect(h).toContain("MVR 12,000.00");
  expect(h).toContain("MVR 960.00");
  expect(h).toContain("MVR 12,960.00");
  expect(h).toContain(SELLER.accountNo);
  expect(h).toContain(SELLER.accountNoUsd);
  expect(h).toContain(SELLER.gstTin);
  expect(h).toContain("This is a quotation, not a tax invoice.");
  expect(h).toContain("6 departments, unlimited staff, includes Smart Roster");
  expect(quoteHtml({ to: { org: "X" }, plan: { ...plan, tier: "standard", max_departments: 1 }, date: when })).not.toContain("Smart Roster");
  expect(h).toContain('viewBox="24 13 52 50"'); // the real logo, not a placeholder
});

test("a proforma says what it is, and monthly uses the monthly price", () => {
  const h = quoteHtml({ kind: "proforma", to: { org: "X" }, plan, cycle: "monthly", date: when });
  expect(h).toContain("PROFORMA INVOICE");
  expect(h).toContain("MVR 1,200.00");
  expect(h).toContain("1 month");
});

test("anything typed is escaped, so it can never run as code", () => {
  const h = quoteHtml({ to: { org: "<img src=x onerror=alert(1)>" }, plan, date: when });
  expect(h).not.toContain("<img src=x");
  expect(h).toContain("&lt;img src=x onerror=alert(1)&gt;");
});

test("a receipt shows the amount actually paid", () => {
  const h = receiptHtml({ payment: { id: "abcd1234-ef", amount_laari: 46500, tier: "standard", billing_cycle: "monthly", paid_at: "2026-11-02T10:00:00Z", provider: "bml" }, to: { org: "Ward 3", email: "a@b.mv" } });
  expect(h).toContain("RECEIPT");
  expect(h).toContain("EDR-R-ABCD1234");
  expect(h).toContain("MVR 465.00");
  expect(h).toContain("Card (BML)");
});

test("download my data: a sheet per department plus leave, codes in the cells", async () => {
  const data = {
    codes: [{ id: "m", code: "M" }, { id: "e", code: "E" }], posts: [{ id: "p1", name: "Gate" }],
    staff: [{ id: "s1", name: "Aisha", leavePeriods: [{ type: "annual", start: "2026-12-08", end: "2026-12-12" }] }],
    cells: { "2026-12-01": { s1: "m" }, "2026-12-02": { s1: [{ code: "m", post: "p1" }, { code: "e" }] } },
  };
  const wb = await dataWorkbook([{ name: "ER", data }, { name: "ER", data }], "Org");
  expect(wb.worksheets.map((w) => w.name)).toEqual(["ER", "ER 2", "Leave"]);
  const row = wb.getWorksheet("ER").getRow(3).values;
  expect(row.slice(1)).toEqual(["Aisha", "", "", "M", "M @ Gate + E"]);
  expect(wb.getWorksheet("Leave").rowCount).toBe(3);
});
