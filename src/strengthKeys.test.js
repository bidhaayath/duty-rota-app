/* The strength keys added in stage 2b. For each: a ward that never saved
   it builds exactly as before; the level its box shows when it is absent,
   once saved, builds exactly as absent too; each level does what it says;
   and Ini's month build reads it. The seeded wards are the comparison
   tool's, and the polish runs a fixed number of steps so every run of a
   week is the same. 1 November 2026 is a Sunday. */

import { generateRoster, rosterContext, datesBetween } from "./rosterEngine";
import { weekConfig, mergeRules } from "./rosterConfig";
import { prepareMonth } from "./monthBuild";
import { seededWard } from "../tools/engine-compare/wards";

const steady = (cfg) => ({ ...cfg, polishMaxMs: 1e9, polishSteps: 3000 });
const withStates = (data, states) => ({
  ...data, rosterRules: { ...data.rosterRules, ruleStates: { ...(data.rosterRules.ruleStates || {}), ...states } },
});
const build = (data, start) => JSON.stringify(generateRoster(steady(weekConfig(data, start))));
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const weightsOf = (data, start) => {
  const cfg = weekConfig(data, start);
  const dates = datesBetween(cfg.from, cfg.to);
  return rosterContext(cfg, dates, cfg.staff).W;
};

describe("working days in a row: ruleStates.daysInRow", () => {
  test.each(SEEDS)("ward %i: saved at In a row's own level, it builds exactly as never saved", (seed) => {
    const { start, data } = seededWard(seed);
    const pattern = mergeRules(data.rosterRules).ruleStates.workPattern;
    expect(build(withStates(data, { daysInRow: { ...pattern } }), start)).toBe(build(data, start));
  });

  test("its price follows its own level, and the working pattern keeps the rest", () => {
    const { start, data } = seededWard(1);
    const absent = weightsOf(data, start);
    // Never saved: the working pattern's, Bend first by default.
    expect([absent.consecutive, absent.block, absent.doubleOff]).toEqual([80, 40, 12]);
    const must = weightsOf(withStates(data, { daysInRow: { state: "hard", priority: 1 } }), start);
    expect([must.consecutive, must.block, must.doubleOff]).toEqual([5000, 40, 12]);
    const off = weightsOf(withStates(data, { daysInRow: { state: "disabled", priority: 1 } }), start);
    expect([off.consecutive, off.block, off.doubleOff]).toEqual([0, 40, 12]);
    // In a row held as a Must, working days in a row bent: each its own.
    const split = weightsOf(withStates(data, {
      workPattern: { state: "hard", priority: 1 }, daysInRow: { state: "soft", priority: 3 },
    }), start);
    expect([split.consecutive, split.block]).toEqual([80, 5000]);
    // In a row switched off still stops keeping off days apart, and nothing else.
    const patternOff = weightsOf(withStates(data, { workPattern: { state: "disabled", priority: 1 } }), start);
    expect([patternOff.consecutive, patternOff.block, patternOff.doubleOff]).toEqual([0, 0, 0]);
    const patternOffDaysHeld = weightsOf(withStates(data, {
      workPattern: { state: "disabled", priority: 1 }, daysInRow: { state: "hard", priority: 1 },
    }), start);
    expect([patternOffDaysHeld.consecutive, patternOffDaysHeld.block, patternOffDaysHeld.doubleOff]).toEqual([5000, 0, 0]);
  });

  test("a level of its own changes the week: Ignore lets runs go past the limit that Must holds", () => {
    let ignoredOver = 0, heldOver = 0;
    const over = (data, start, out) => {
      const limit = mergeRules(data.rosterRules).maxDaysOn ?? 5;
      const cfg = weekConfig(data, start);
      let n = 0;
      for (const s of cfg.staff) {
        let run = 0;
        for (const d of datesBetween(cfg.from, cfg.to)) {
          const c = out.cells[`${s.id}|${d}`];
          run = c && c !== "off" ? run + 1 : 0;
          if (run > limit) n += 1;
        }
      }
      return n;
    };
    for (const seed of SEEDS) {
      const { start, data } = seededWard(seed);
      const tight = { ...data, rosterRules: { ...data.rosterRules, maxDaysOn: 3 } };
      const ignored = withStates(tight, { daysInRow: { state: "disabled", priority: 1 } });
      const held = withStates(tight, { daysInRow: { state: "hard", priority: 1 } });
      ignoredOver += over(ignored, start, generateRoster(steady(weekConfig(ignored, start))));
      heldOver += over(held, start, generateRoster(steady(weekConfig(held, start))));
    }
    expect(ignoredOver).toBeGreaterThan(heldOver);
  }, 120000);

  test("Ini's month build hands the engine the same key", () => {
    const { data } = seededWard(3);
    const saved = withStates(data, { daysInRow: { state: "hard", priority: 1 } });
    expect(prepareMonth({ data: saved, month: "2026-11", lookFrom: null }).config.ruleStates.daysInRow)
      .toEqual({ state: "hard", priority: 1 });
  });
});
