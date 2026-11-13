/* Nights in pairs, held by In a row's level. A ward without pairs builds
   exactly as before; at every level last Saturday's half is finished on
   Sunday where someone is free to, and above Bend first a pair is finished
   first all week and held by price. Every pair split or left half done is
   reported with the person and the nights. */

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

test("a ward without pairs reports no pair split or left half done", () => {
  const plain = steady(weekConfig(withoutPairs(erRealWard()), "2026-12-06"));
  const res = generateRoster(plain);
  expect(res.report.relaxations.some((r) => r.days)).toBe(false);
}, 120000);

test.each([2, 4])("at In a row level %i (Protect, Bend first), last Saturday's half pair is finished on Sunday", (level) => {
  const cfg = steady(weekConfig(withInARowLevel(thoiWard(), level), "2026-11-15"));
  const res = generateRoster(cfg);
  const sunday = carried(cfg, res.cells);
  expect(sunday.length).toBeGreaterThan(0);
  expect(sunday.filter((c) => c !== "night").length).toBeLessThanOrEqual(1);
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
