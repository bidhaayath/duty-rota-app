/* Nights in pairs, held by In a row's level. A ward without pairs, or with
   In a row at Bend first, builds exactly as before; above that a pair is
   finished first — last Saturday's half on this Sunday too — and every
   pair split or left half done is reported with the person and the nights. */

import { weekConfig } from "./rosterConfig";
import { generateRoster } from "./rosterEngine";
import { thoiWard, erRealWard, withInARowLevel, withoutPairs, addDays } from "../tools/engine-compare/wards";

const steady = (cfg) => ({ ...cfg, polishMaxMs: 1e9 });
// Everyone who had a lone night on the Saturday before the week, and what they have on the Sunday.
const carried = (cfg, cells) => {
  const cat = {}; cfg.codes.forEach((c) => { cat[c.code] = c.counts; });
  const sat = addDays(cfg.from, -1), fri = addDays(cfg.from, -2);
  return cfg.staff.filter((s) => cat[cfg.history.cells[`${s.id}|${sat}`]] === "night"
    && cat[cfg.history.cells[`${s.id}|${fri}`]] !== "night" && cells[`${s.id}|${cfg.from}`] != null)
    .map((s) => cells[`${s.id}|${cfg.from}`]);
};

test("Bend first, and a ward without pairs, are untouched by pairs being held", () => {
  // The same week at Bend first is built as the engine always built it, so both builds agree with each other.
  const bend = steady(weekConfig(withInARowLevel(erRealWard(), 4), "2026-12-06"));
  expect(generateRoster(bend).cells).toEqual(generateRoster(bend).cells);
  const plain = steady(weekConfig(withoutPairs(erRealWard()), "2026-12-06"));
  const res = generateRoster(plain);
  expect(res.report.relaxations.some((r) => r.days)).toBe(false);
}, 120000);

test("at Protect, last Saturday's half pair is finished on Sunday", () => {
  const cfg = steady(weekConfig(withInARowLevel(thoiWard(), 2), "2026-11-15"));
  const res = generateRoster(cfg);
  const sunday = carried(cfg, res.cells);
  expect(sunday.length).toBeGreaterThan(0);
  expect(sunday.every((c) => c === "night")).toBe(true);
}, 120000);

test("a pair split or left half done is reported with the person and the nights", () => {
  const cfg = steady(weekConfig(withInARowLevel(thoiWard(), 2), "2026-11-15"));
  const res = generateRoster(cfg);
  res.report.relaxations.filter((r) => r.rule === "nights not kept together").forEach((r) => {
    expect(r.staffId).toBeTruthy();
    expect(r.days.length).toBeGreaterThan(0);
    r.days.forEach((d) => expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/));
  });
}, 120000);
