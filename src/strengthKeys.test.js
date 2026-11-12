/* The strength keys added in stage 2b. For each: a ward that never saved
   it builds exactly as before; the level its box shows when it is absent,
   once saved, builds exactly as absent too; each level does what it says;
   and Ini's month build reads it. The seeded wards are the comparison
   tool's, and the polish runs a fixed number of steps so every run of a
   week is the same. 1 November 2026 is a Sunday. */

import { generateRoster, rosterContext, datesBetween, checkFeasible } from "./rosterEngine";
import { weekConfig, mergeRules, seniorNeedOf } from "./rosterConfig";
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

/* A seeded ward asking for an in-charge on Mornings and Nights, with every
   third person able to take charge — or, `few`, with only the first. */
const withSeniors = (data, few = false) => ({
  ...data,
  rosterRules: {
    ...data.rosterRules,
    seniorStaff: few ? [data.staff[0].id] : data.staff.filter((_, i) => i % 3 === 0).map((s) => s.id),
    seniorCover: { morning: 1, afternoon: 0, evening: 0, night: 1 },
  },
});
const gapsOf = (out) => (out.report?.seniorGaps || []).reduce((n, g) => n + g.needed, 0);

describe("in-charge on every shift: ruleStates.seniors", () => {
  const LEVEL = {
    must: { state: "hard", priority: 1 }, protectMost: { state: "soft", priority: 1 },
    protect: { state: "soft", priority: 2 }, bendFirst: { state: "soft", priority: 4 },
    ignore: { state: "disabled", priority: 1 },
  };

  test.each(SEEDS)("ward %i: saved at Protect most, the level its box shows, it builds exactly as never saved", (seed) => {
    const { start, data } = seededWard(seed);
    const ward = withSeniors(data);
    expect(build(withStates(ward, { seniors: LEVEL.protectMost }), start)).toBe(build(ward, start));
  });

  test("too few in-charge staff: never saved, Must and Protect most refuse alike; Protect and weaker warn and build", () => {
    const { start, data } = seededWard(2);
    const short = withSeniors(data, true);
    const refused = generateRoster(steady(weekConfig(short, start)));
    expect(refused.ok).toBe(false);
    expect(refused.problems.some((p) => /^Every day needs 2 seniors on duty at once/.test(p))).toBe(true);
    for (const level of ["must", "protectMost"]) {
      expect(JSON.stringify(generateRoster(steady(weekConfig(withStates(short, { seniors: LEVEL[level] }), start)))))
        .toBe(JSON.stringify(refused));
    }
    for (const level of ["protect", "bendFirst"]) {
      const cfg = weekConfig(withStates(short, { seniors: LEVEL[level] }), start);
      const check = checkFeasible(cfg);
      expect(check.problems.some((p) => /seniors? on duty at once/.test(p))).toBe(false);
      expect(check.warnings.some((p) => /^Every day needs 2 seniors on duty at once/.test(p))).toBe(true);
      const out = generateRoster(steady(cfg));
      expect(out.ok).toBe(true);
      expect(gapsOf(out)).toBeGreaterThan(0);
    }
  }, 60000);

  test("the price of a shift with nobody in charge: 400 at every Try level, a Must's as Must, nothing at Ignore", () => {
    const { start, data } = seededWard(1);
    const ward = withSeniors(data);
    expect(weightsOf(ward, start).senior).toBe(400);
    expect(weightsOf(withStates(ward, { seniors: LEVEL.protectMost }), start).senior).toBe(400);
    expect(weightsOf(withStates(ward, { seniors: LEVEL.bendFirst }), start).senior).toBe(400);
    expect(weightsOf(withStates(ward, { seniors: LEVEL.must }), start).senior).toBe(5000);
    expect(weightsOf(withStates(ward, { seniors: LEVEL.ignore }), start).senior).toBe(0);
  });

  test.each(SEEDS.slice(0, 4))("ward %i: Ignore builds exactly as a ward that asks for no in-charge at all", (seed) => {
    const { start, data } = seededWard(seed);
    const ward = withSeniors(data);
    const none = { ...ward, rosterRules: { ...ward.rosterRules, seniorCover: { morning: 0, afternoon: 0, evening: 0, night: 0 } } };
    const ignored = generateRoster(steady(weekConfig(withStates(ward, { seniors: LEVEL.ignore }), start)));
    expect(JSON.stringify(ignored.cells)).toBe(JSON.stringify(generateRoster(steady(weekConfig(none, start))).cells));
    expect(gapsOf(ignored)).toBe(0);
  });

  test("Bend first gives up the search sooner: some week comes out differently from never saved", () => {
    const differs = SEEDS.some((seed) => {
      const { start, data } = seededWard(seed);
      const ward = withSeniors(data);
      return build(withStates(ward, { seniors: LEVEL.bendFirst }), start) !== build(ward, start);
    });
    expect(differs).toBe(true);
  }, 120000);

  test("the in-charge sum on the screen and in Ini asks for none at Ignore", () => {
    const { data } = seededWard(1);
    const rules = mergeRules(withSeniors(data).rosterRules);
    expect(seniorNeedOf(rules, data.staff).seniorPerDay).toBe(2);
    const ignored = mergeRules(withStates(withSeniors(data), { seniors: LEVEL.ignore }).rosterRules);
    expect(seniorNeedOf(ignored, data.staff).seniorPerDay).toBe(0);
  });

  test("Ini's month build hands the engine the same key", () => {
    const { data } = seededWard(3);
    const saved = withStates(withSeniors(data), { seniors: LEVEL.bendFirst });
    expect(prepareMonth({ data: saved, month: "2026-11", lookFrom: null }).config.ruleStates.seniors)
      .toEqual({ state: "soft", priority: 4 });
  });
});

/* How unevenly something is shared in one week: most anyone had, less the
   fewest anyone had, among the staff on the roster that week. */
const spreadOf = (data, start, out, isIt) => {
  const cfg = weekConfig(data, start);
  const counts = cfg.staff.filter((s) => !(cfg.skipStaff || []).includes(s.id)).map((s) =>
    datesBetween(cfg.from, cfg.to).filter((d) => isIt(out.cells[`${s.id}|${d}`], d)).length);
  return Math.max(...counts) - Math.min(...counts);
};

describe("sharing nights fairly: ruleStates.fairNights", () => {
  const at = (state, priority = 1) => ({ fairNights: { state, priority } });

  test.each(SEEDS)("ward %i: saved at Protect, the level its box shows, it builds exactly as never saved", (seed) => {
    const { start, data } = seededWard(seed);
    expect(build(withStates(data, at("soft", 2)), start)).toBe(build(data, start));
  });

  test.each(SEEDS.slice(0, 4))("ward %i: Protect most builds the same too — nights are already the first fairness question", (seed) => {
    const { start, data } = seededWard(seed);
    expect(build(withStates(data, at("soft", 1)), start)).toBe(build(data, start));
    // A Must saved anyway is read as Protect most.
    expect(build(withStates(data, at("hard", 1)), start)).toBe(build(data, start));
  });

  test("the price of an uneven share of nights: as always at every level but Ignore", () => {
    const { start, data } = seededWard(1);
    expect(weightsOf(data, start).fairNight).toBe(3);
    expect(weightsOf(withStates(data, at("soft", 4)), start).fairNight).toBe(3);
    expect(weightsOf(withStates(data, at("disabled")), start).fairNight).toBe(0);
    // Nothing else moves.
    expect(weightsOf(withStates(data, at("disabled")), start).fair).toBe(3);
  });

  test("Bend first and Ignore change the week, and Ignore shares nights less evenly over the seeded weeks", () => {
    let spreadAbsent = 0, spreadIgnored = 0, bendDiffers = false;
    for (const seed of SEEDS) {
      const { start, data } = seededWard(seed);
      const night = (c) => c === "night";
      spreadAbsent += spreadOf(data, start, generateRoster(steady(weekConfig(data, start))), night);
      const ignored = withStates(data, at("disabled"));
      spreadIgnored += spreadOf(ignored, start, generateRoster(steady(weekConfig(ignored, start))), night);
      if (build(withStates(data, at("soft", 4)), start) !== build(data, start)) bendDiffers = true;
    }
    expect(bendDiffers).toBe(true);
    expect(spreadIgnored).toBeGreaterThanOrEqual(spreadAbsent);
  }, 180000);

  test("Ini's month build hands the engine the same key", () => {
    const { data } = seededWard(3);
    expect(prepareMonth({ data: withStates(data, at("soft", 4)), month: "2026-11", lookFrom: null }).config.ruleStates.fairNights)
      .toEqual({ state: "soft", priority: 4 });
  });
});

describe("sharing non-official days fairly: ruleStates.fairNonOfficial", () => {
  const at = (state, priority = 1) => ({ fairNonOfficial: { state, priority } });
  /* The seeded wards keep the Friday rule, so every Friday is non-official;
     with two weeks' look-back the history weighs on who works them. */
  test.each(SEEDS)("ward %i: saved at Protect, the level its box shows, it builds exactly as never saved", (seed) => {
    const { start, data } = seededWard(seed);
    expect(build(withStates(data, at("soft", 2)), start)).toBe(build(data, start));
  });

  test("a Must saved anyway builds as Protect most", () => {
    const { start, data } = seededWard(2);
    expect(build(withStates(data, at("hard", 1)), start)).toBe(build(withStates(data, at("soft", 1)), start));
  });

  test("the price of an uneven share of non-official duty: as always at every level but Ignore", () => {
    const { start, data } = seededWard(1);
    expect(weightsOf(data, start).fairNonOfficial).toBe(3);
    expect(weightsOf(withStates(data, at("soft", 1)), start).fairNonOfficial).toBe(3);
    expect(weightsOf(withStates(data, at("disabled")), start).fairNonOfficial).toBe(0);
    expect(weightsOf(withStates(data, at("disabled")), start).fairNight).toBe(3);
  });

  test("Protect most, Bend first and Ignore each change some week", () => {
    const changes = { soft1: false, soft4: false, ignore: false };
    for (const seed of SEEDS) {
      const { start, data } = seededWard(seed);
      const base = build(data, start);
      if (build(withStates(data, at("soft", 1)), start) !== base) changes.soft1 = true;
      if (build(withStates(data, at("soft", 4)), start) !== base) changes.soft4 = true;
      if (build(withStates(data, at("disabled")), start) !== base) changes.ignore = true;
    }
    expect(changes).toEqual({ soft1: true, soft4: true, ignore: true });
  }, 240000);

  test("Ini's month build hands the engine the same key", () => {
    const { data } = seededWard(3);
    expect(prepareMonth({ data: withStates(data, at("disabled")), month: "2026-11", lookFrom: null }).config.ruleStates.fairNonOfficial)
      .toEqual({ state: "disabled", priority: 1 });
  });
});

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
