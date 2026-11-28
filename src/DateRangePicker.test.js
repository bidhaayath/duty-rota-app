import { rangeLabel, presetsFor } from "./DateRangePicker";

test("the date button reads naturally", () => {
  expect(rangeLabel("2026-12-01", "2026-12-31")).toBe("1 – 31 Dec 2026");
  expect(rangeLabel("2026-11-28", "2026-12-03")).toBe("28 Nov – 3 Dec 2026");
  expect(rangeLabel("2026-12-28", "2027-01-03")).toBe("28 Dec 2026 – 3 Jan 2027");
  expect(rangeLabel("2026-12-05", "2026-12-05")).toBe("5 Dec 2026");
});

test("quick picks from a Saturday in November, weeks starting Sunday", () => {
  const p = Object.fromEntries(presetsFor(new Date(2026, 10, 28), 0).map((x) => [x.id, x]));
  expect(p.this.range).toEqual(["2026-11-01", "2026-11-30"]);
  expect(p.last.range).toEqual(["2026-10-01", "2026-10-31"]);
  expect(p.next.range).toEqual(["2026-12-01", "2026-12-31"]);
  expect(p.week.range).toEqual(["2026-11-22", "2026-11-28"]);
  expect(p.second.name).toBe("16th – 30th");
  expect(presetsFor(new Date(2026, 11, 2), 1).find((x) => x.id === "second").name).toBe("16th – 31st");
});
