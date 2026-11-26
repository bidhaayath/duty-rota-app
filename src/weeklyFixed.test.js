/* Duties fixed on a day of the week: rosterRules.weeklyFixed, [{ id,
   staffId, days, duty }] — "always Night on Thursday". Each matching day in
   the period becomes a fixed duty, except where leave, an approved request
   or a duty fixed on that date already says what the day is. A ward that
   sets none is handed exactly what it was. 1 November 2026 is a Sunday, so
   Thursday is the 5th. */

import { generateRoster } from "./rosterEngine";
import { weekConfig, mergeRules, weeklyFixedIn } from "./rosterConfig";
import { prepareMonth } from "./monthBuild";
import { seededWard } from "../tools/engine-compare/wards";

const steady = (cfg) => ({ ...cfg, polishMaxMs: 1e9, polishSteps: 3000 });
const withWeekly = (data, weeklyFixed) => ({ ...data, rosterRules: { ...data.rosterRules, weeklyFixed } });
const person = (id, extra = {}) => ({ id, name: id, leavePeriods: [], ...extra });

describe("which days it fixes", () => {
  test("every matching day in the period, as the manager's", () => {
    const rules = mergeRules({ weeklyFixed: [{ id: "w", staffId: "s1", days: [4], duty: "night" }] });
    expect(weeklyFixedIn(rules, "2026-11-01", "2026-11-14", [person("s1")])).toEqual([
      { staffId: "s1", date: "2026-11-05", category: "night", source: "manager" },
      { staffId: "s1", date: "2026-11-12", category: "night", source: "manager" },
    ]);
  });

  test("not on leave, not outside employment, not when skipped", () => {
    const rules = mergeRules({ weeklyFixed: [{ id: "w", staffId: "s1", days: [4], duty: "night" }] });
    const onLeave = person("s1", { leavePeriods: [{ id: "l", type: "annual", start: "2026-11-01", end: "2026-11-06" }] });
    expect(weeklyFixedIn(rules, "2026-11-01", "2026-11-14", [onLeave]).map((r) => r.date)).toEqual(["2026-11-12"]);
    const left = person("s1", { endDate: "2026-11-08" });
    expect(weeklyFixedIn(rules, "2026-11-01", "2026-11-14", [left]).map((r) => r.date)).toEqual(["2026-11-05"]);
    const skipped = mergeRules({ ...rules, skipStaff: ["s1"] });
    expect(weeklyFixedIn(skipped, "2026-11-01", "2026-11-14", [person("s1")])).toEqual([]);
  });

  test("an approved request or a duty fixed on the date wins", () => {
    const rules = mergeRules({ weeklyFixed: [{ id: "w", staffId: "s1", days: [4], duty: "night" }] });
    const taken = [{ staffId: "s1", date: "2026-11-05", category: "off" }];
    expect(weeklyFixedIn(rules, "2026-11-01", "2026-11-14", [person("s1")], taken).map((r) => r.date))
      .toEqual(["2026-11-12"]);
  });

  test("an unreadable entry is left out", () => {
    const rules = mergeRules({ weeklyFixed: [
      { id: "a", staffId: "s1", days: [4], duty: "brunch" },
      { id: "b", staffId: "s1", days: [], duty: "night" },
      { id: "c", staffId: "s1", duty: "night" },
      null,
    ] });
    expect(weeklyFixedIn(rules, "2026-11-01", "2026-11-14", [person("s1")])).toEqual([]);
  });
});

describe("what the engine is given", () => {
  test("none set: exactly what it was given before", () => {
    const { start, data } = seededWard(2);
    expect(JSON.stringify(weekConfig(withWeekly(data, []), start))).toBe(JSON.stringify(weekConfig(data, start)));
  });

  test("kept in the week as built, and in the month", () => {
    const { start, data } = seededWard(4);
    const who = data.staff[1].id;
    const dow = new Date(`${start}T00:00`).getDay();
    const thursday = [...Array(7)].map((_, i) => {
      const d = new Date(`${start}T00:00`); d.setDate(d.getDate() + i);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    })[(4 - dow + 7) % 7];
    const ward = withWeekly(data, [{ id: "w", staffId: who, days: [4], duty: "night" }]);
    const out = generateRoster(steady(weekConfig(ward, start)));
    expect(out.cells[`${who}|${thursday}`]).toBe("night");

    const month = prepareMonth({ data: ward, month: "2026-12", lookFrom: null, keepExisting: false });
    const nights = month.config.requests.filter((r) => r.staffId === who && r.source === "manager").map((r) => r.date);
    expect(nights).toEqual(expect.arrayContaining(["2026-12-03", "2026-12-10", "2026-12-17", "2026-12-24", "2026-12-31"]));
  }, 120000);
});
