/* The live check at the top of Smart Roster: the first thing in the saved
   settings that cannot add up, said with the numbers; "Fix it for me" where
   there is one obvious fix; and no line said twice between it and the
   engine's own messages. 1 November 2026 is a Sunday. */

import React, { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { checkFeasible } from "./rosterEngine";
import { mergeRules, weekConfig } from "./rosterConfig";
import { checkSettings, settingsKey } from "./settingsCheck";
import SmartRosterTab from "./SmartRosterTab";

const WEEK = "2026-11-01";
const CODES = [
  { id: "M", code: "M", counts: "morning" }, { id: "A", code: "A", counts: "afternoon" },
  { id: "E", code: "E", counts: "evening" }, { id: "N", code: "N", counts: "night" },
  { id: "OFF", code: "OFF", counts: "off" }, { id: "NOFF", code: "(N)OFF", counts: "off" },
];
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const people = (n) => [...Array(n)].map((_, i) => ({ id: `r${i}`, name: `Nurse ${i}`, leavePeriods: [] }));

/* A ward that fits: 15 staff working 5 days is 75 duties; the shifts need
   70 a week (4 + 4 + 2 a day) and have room for 84 (5 + 5 + 2). */
const FITS = {
  coverage: { morning: { min: 4, max: 5 }, afternoon: { min: 4, max: 5 }, night: { min: 2, max: 2 } },
};
const over = (patch) => {
  const out = { ...FITS, ...patch };
  if (patch.coverage) out.coverage = { ...FITS.coverage, ...patch.coverage };
  return out;
};
const check = (patch = {}, staff = people(15)) => checkSettings(mergeRules(over(patch)), staff);
const IGNORE = { state: "disabled", priority: 1 };
// Fewer asked for on each shift (56 duties a week), for wards where each person can work only 4 days.
const QUIET = { coverage: { morning: { min: 3, max: 5 }, afternoon: { min: 3, max: 5 } } };

describe("the checks, in order", () => {
  test("settings that fit say so, with the number on the roster", () => {
    expect(check()).toMatchObject({ ok: true, count: 15 });
    // Skipped staff are not on the roster.
    expect(check({ skipStaff: ["r0", "r1"], coverage: { morning: { min: 3, max: 5 } } })).toMatchObject({ ok: true, count: 13 });
  });

  test("nobody on the roster", () => {
    expect(check({}, [])).toMatchObject({ ok: false, check: 0, count: 0, stops: true,
      text: "Nobody is on the rota for this week, so there is nobody to roster." });
    expect(check({ skipStaff: ["r0", "r1"] }, people(2))).toMatchObject({ check: 0, stops: true,
      text: "Everyone on the rota this week is skipped, so there is nobody to roster." });
  });

  test("1: a row's at least above its at most", () => {
    expect(check({ coverage: { morning: { min: 6, max: 5 } } })).toMatchObject({
      check: 1, stops: true, text: "Morning: at least 6 on duty, but at most 5." });
    expect(check({ weeklyMin: { night: 2 }, weeklyMax: { night: 1 } })).toMatchObject({
      check: 1, stops: false, text: "Each person: at least 2 Nights a week, but at most 1." });
    expect(check({ weeklyMin: { off: 3 }, weeklyMax: { off: 2 } })).toMatchObject({
      check: 1, text: "Each person: at least 3 off days a week, but at most 2." });
    expect(check({ weeklyDuties: { min: 6, max: 5 } })).toMatchObject({
      check: 1, text: "Each person: at least 6 working days a week, but at most 5." });
  });

  test("1: a number set to Ignore is not held against the row", () => {
    expect(check({ weeklyMin: { night: 2 }, weeklyMax: { night: 1 }, ruleStates: { "weeklyCaps:night": IGNORE } }).ok).toBe(true);
    expect(check({ ...QUIET, weeklyMin: { off: 3 }, weeklyMax: { off: 2 } }).check).toBe(1);
    expect(check({ ...QUIET, weeklyMin: { off: 3 }, weeklyMax: { off: 2 }, ruleStates: { offMin: IGNORE } }).ok).toBe(true);
  });

  test("2: a shift kept together that nobody may have two of", () => {
    expect(check({ blockTogether: { night: 2 }, weeklyMin: { night: 1 }, weeklyMax: { night: 1 } })).toMatchObject({
      check: 2, text: "Night is set to come 2 together, but each person gets at most 1 Night a week." });
    // In a row — most of 1 already stops a pair, so there is no ask to clash.
    expect(check({ blockTogether: { night: 2 }, blockDays: { night: 1 }, weeklyMax: { night: 1 } }).ok).toBe(true);
    expect(check({ blockTogether: { night: 2 }, weeklyMax: { night: 1 }, ruleStates: { "weeklyCaps:night": IGNORE } }).ok).toBe(true);
    expect(check({ blockTogether: { night: 2 }, weeklyMax: { night: 2 } }).ok).toBe(true);
  });

  test("3: the fewest of each shift add up to more than the working days", () => {
    expect(check({ weeklyMin: { morning: 2, afternoon: 2, night: 2 } })).toMatchObject({
      check: 3, text: "Each person's fewest add up to 6 duties a week (Morning 2, Afternoon 2, Night 2), but they work at most 5 days." });
    expect(check({ weeklyMin: { morning: 3, afternoon: 3, night: 2 }, weeklyDuties: { min: null, max: null } })).toMatchObject({
      check: 3, text: "Each person's fewest add up to 8 duties a week (Morning 3, Afternoon 3, Night 2), but a week has only 7 days." });
  });

  test("3: Evening counts only where the ward runs it", () => {
    // The default fewest of 1 Evening is not counted on a ward with no Evening shift.
    expect(check({ weeklyMin: { morning: 2, afternoon: 2, night: 1 } }).ok).toBe(true);
    expect(check({ weeklyMin: { morning: 2, afternoon: 2, night: 1 }, coverage: { evening: { min: 1, max: 1 } } })).toMatchObject({
      check: 3, text: "Each person's fewest add up to 6 duties a week (Morning 2, Afternoon 2, Evening 1, Night 1), but they work at most 5 days." });
  });

  test("4: the most of each shift add up to less than the working days", () => {
    expect(check({ weeklyMax: { morning: 2, afternoon: 1, night: 1 } })).toMatchObject({
      check: 4, text: "Each person's most add up to 4 duties a week (Morning 2, Afternoon 1, Night 1), fewer than their 5 working days." });
    // A shift with no most, or with its most set to Ignore, has no limit.
    expect(check({ weeklyMax: { morning: 2, afternoon: 1 } }).ok).toBe(true);
    expect(check({ weeklyMax: { morning: 2, afternoon: 1, night: 1 }, ruleStates: { "weeklyCaps:night": IGNORE } }).ok).toBe(true);
  });

  test("5: working days and off days that do not make a week", () => {
    expect(check({ weeklyMax: { off: 1 } })).toMatchObject({
      check: 5, text: "5 working days leaves 2 off days a week, but off days are set to at most 1." });
    expect(check({ weeklyMin: { off: 3 }, weeklyMax: { off: 3 } })).toMatchObject({
      check: 5, text: "5 working days leaves 2 off days a week, but off days are set to at least 3." });
    expect(check({ weeklyDuties: { min: 6, max: 6 }, weeklyMin: { off: 2 } })).toMatchObject({
      check: 5, text: "6 working days leaves 1 off day a week, but off days are set to at least 2." });
    expect(check({ weeklyDuties: { min: 3, max: 4 }, weeklyMax: { off: 2 } })).toMatchObject({
      check: 5, text: "At most 4 working days leaves at least 3 off days a week, but off days are set to at most 2." });
    // Fewest off days set to Ignore is not held against the working days.
    expect(check({ ...QUIET, weeklyMin: { off: 3 }, weeklyMax: { off: 3 } }).check).toBe(5);
    expect(check({ ...QUIET, weeklyMin: { off: 3 }, weeklyMax: { off: 3 }, ruleStates: { offMin: IGNORE } }).ok).toBe(true);
  });

  test("6: more duties than the shifts have room for", () => {
    const full = { coverage: { morning: { min: 4, max: 4 }, afternoon: { min: 4, max: 4 } } };
    expect(check(full)).toMatchObject({
      check: 6, stops: false,
      text: "15 staff working 5 days is 75 duties a week, but your shifts have room for only 70 (10 a day × 7). "
        + "Allow more staff on a shift, or lower the working days.",
    });
    // Skipping one person is enough: 14 × 5 = 70.
    expect(check({ ...full, skipStaff: ["r0"] }).ok).toBe(true);
  });

  test("7: fewer duties than the shifts need", () => {
    const busy = { coverage: { morning: { min: 5, max: 6 }, afternoon: { min: 5, max: 6 } } };
    expect(check(busy)).toMatchObject({
      check: 7, stops: false,
      text: "Your shifts need 84 duties a week (12 a day × 7), but your 15 staff can work at most 75 between them — 9 short. "
        + "Ask for fewer staff on a shift, raise the working days, or add staff.",
    });
    // More people asked for in a day than there are: Generate itself refuses.
    expect(check({}, people(9))).toMatchObject({ check: 7, stops: true });
  });

  test("7: what one person can work is the working days, the off days, and neither for someone on one shift", () => {
    const open = { weeklyDuties: { min: null, max: null }, weeklyMin: { off: 2 }, coverage: { morning: { min: 5, max: 6 } } };
    // 11 a day is 77; 15 people at 7 − 2 = 5 days is 75.
    expect(check(open)).toMatchObject({ check: 7, text: expect.stringContaining("at most 75 between them — 2 short") });
    // Somebody tied to Nights alone is outside the weekly pattern: 14 × 5 + 7 = 77.
    expect(check({ ...open, staffShifts: { r14: ["night"] } }).ok).toBe(true);
  });

  test("only the first problem is shown", () => {
    const both = { coverage: { morning: { min: 4, max: 4 }, afternoon: { min: 4, max: 4 } }, weeklyMin: { morning: 2, afternoon: 2, night: 2 } };
    expect(check(both).check).toBe(3);
    expect(check({ ...both, weeklyMax: { night: 1 } }).check).toBe(1);
  });
});

describe("Fix it for me", () => {
  const full = { coverage: { morning: { min: 4, max: 4 }, afternoon: { min: 4, max: 4 } } };

  test("one more on the shift most people can do, the earlier shift when level", () => {
    expect(check(full).fix).toEqual({ shift: "morning", from: 4, to: 5, text: "Morning: at most 4 → 5" });
    // One person cannot do Mornings, so Afternoon has more people to fill it.
    expect(check({ ...full, staffShifts: { r3: ["afternoon", "night"] } }).fix)
      .toEqual({ shift: "afternoon", from: 4, to: 5, text: "Afternoon: at most 4 → 5" });
  });

  test("the change it names clears the problem", () => {
    const { fix } = check(full);
    expect(check({ coverage: { ...full.coverage, [fix.shift]: { min: 4, max: fix.to } } }).ok).toBe(true);
  });

  test("not offered when one more would not be enough, or nobody could fill it", () => {
    // 17 × 5 = 85 against room for 70: 15 over, and one more on a shift adds 7.
    const big = check(full, people(17));
    expect(big.check).toBe(6);
    expect(big.fix).toBeUndefined();
    // A ward that runs one Morning a day and nothing else, with two people: a
    // second place on the Morning is one the second person can fill.
    const tiny = { coverage: { morning: { min: 1, max: 1 }, afternoon: { min: 0, max: 0 }, night: { min: 0, max: 0 } }, weeklyMin: { morning: 0, afternoon: 0, night: 0 } };
    expect(check(tiny, people(2)).fix).toMatchObject({ text: "Morning: at most 1 → 2" });
    // Not when the second person is set up for Nights only: nobody could take it.
    const nightOnly = check({ ...tiny, staffShifts: { r1: ["night"] } }, people(2));
    expect(nightOnly.check).toBe(6);
    expect(nightOnly.fix).toBeUndefined();
  });
});

/* ── Nothing said twice ──
   The engine's own messages are matched by their wording, and the engine
   is not to change for this — so the wording is pinned here. If one of
   these fails, the engine's sentence has moved and `hides` must follow. */
describe("the engine's messages the banner already says", () => {
  const ward = (patch, staff = people(15)) => ({ staff, codes: CODES, cells: {}, dutyRequests: [], rosterRules: over(patch) });
  const both = (data) => ({
    fit: checkSettings(mergeRules(data.rosterRules), data.staff),
    engine: checkFeasible(weekConfig(data, WEEK)),
  });

  test("everyone skipped", () => {
    const { fit, engine } = both(ward({ skipStaff: ["r0", "r1"] }, people(2)));
    expect(engine.problems).toContain("No staff are available — everyone is skipped.");
    expect(fit.hides("No staff are available — everyone is skipped.")).toBe(true);
  });

  test("a shift's maximum below its minimum, and only that shift's", () => {
    const { fit, engine } = both(ward({ coverage: { morning: { min: 6, max: 5 }, night: { min: 3, max: 2 } } }));
    expect(engine.problems).toContain("morning: the maximum (5) is below the minimum (6).");
    expect(engine.problems.filter((p) => !fit.hides(p))).toContain("night: the maximum (2) is below the minimum (3).");
    expect(engine.problems.filter((p) => !fit.hides(p))).not.toContain("morning: the maximum (5) is below the minimum (6).");
  });

  test("more duties than room: both of the engine's sums are left out, the rest stay", () => {
    const { fit, engine } = both(ward({ coverage: { morning: { min: 4, max: 4 }, afternoon: { min: 4, max: 4 } } }));
    expect(fit.check).toBe(6);
    const same = engine.warnings.filter((w) => /even with every shift at its fullest/.test(w));
    expect(same.map((w) => w.slice(0, 16))).toEqual(["Duties per week:", "Off days: 15 sta"]);
    expect(same.every(fit.hides)).toBe(true);
    const kept = engine.warnings.filter((w) => !fit.hides(w));
    expect(kept).toHaveLength(engine.warnings.length - 2);
    expect(kept.some((w) => /will get no night duty this week/.test(w))).toBe(true);
  });

  test("fewer duties than needed: the week's sum is left out only while it is the same number", () => {
    const patch = { weeklyMin: { off: 2 }, coverage: { morning: { min: 5, max: 6 }, afternoon: { min: 5, max: 6 } } };
    const { fit, engine } = both(ward(patch));
    expect(fit.check).toBe(7);
    const week = engine.warnings.find((w) => /^Week of 2026-11-01: /.test(w));
    expect(week).toMatch(/ — 9 short, so 9 shifts will go uncovered\./);
    const offs = engine.warnings.find((w) => /^Off days: /.test(w));
    expect(offs).toMatch(/leaves only about 1\.4 off days each per week, below your minimum of 2\./);
    expect(fit.hides(week)).toBe(true);
    expect(fit.hides(offs)).toBe(true);

    // One person away all week: the week is 14 short, which is not what the banner says.
    const staff = people(15);
    staff[0].leavePeriods = [{ id: "lv", type: "annual", start: "2026-11-01", end: "2026-11-07" }];
    const away = both(ward(patch, staff));
    const weekAway = away.engine.warnings.find((w) => /^Week of 2026-11-01: /.test(w));
    expect(weekAway).toMatch(/ — 14 short, so /);
    expect(away.fit.hides(weekAway)).toBe(false);
  });

  test("more people asked for in a day than there are", () => {
    const { fit, engine } = both(ward({}, people(9)));
    expect(fit).toMatchObject({ check: 7, stops: true });
    const line = "Each day needs 10 people on duty, but only 9 staff are available. Either lower the minimums or add 1 more staff.";
    expect(engine.problems).toContain(line);
    expect(fit.hides(line)).toBe(true);
  });

  test("settings that fit hide nothing, and an in-charge message is never hidden", () => {
    const { fit, engine } = both(ward({ seniorCover: { night: 1 } }));
    expect(fit.ok).toBe(true);
    expect(engine.problems.length).toBeGreaterThan(0);
    expect(engine.problems.filter((p) => !fit.hides(p))).toEqual(engine.problems);
  });

  test("the settings read the same whatever order they were saved in", () => {
    expect(settingsKey({ a: 1, b: { c: [2, { e: 3, d: 4 }], f: null } }))
      .toBe(settingsKey({ b: { f: null, c: [2, { d: 4, e: 3 }] }, a: 1 }));
    expect(settingsKey({ a: [1, 2] })).not.toBe(settingsKey({ a: [2, 1] }));
  });
});

describe("the banner on the screen", () => {
  const T = { lagoon: "#0F8B7E", ink: "#142B33", inkSoft: "#4A6570", line: "#DCE8E6", mist: "#EEF4F3", coral: "#E4604E", sand: "#C9A15A" };
  const Card = ({ children }) => <div>{children}</div>;
  const Btn = ({ children, kind, small, ...rest }) => <button {...rest}>{children}</button>;
  const Field = ({ label, children }) => <label>{label}{children}</label>;
  let saved;
  function App({ rosterRules = FITS, editable = true }) {
    const [data, setData] = useState(() => ({
      staff: people(15), codes: CODES, cells: {}, cellMeta: {}, nonOfficial: [], dutyRequests: [],
      fridayRule: false, rosterRules,
    }));
    saved = data;
    const update = (fn) => setData((d) => fn(JSON.parse(JSON.stringify(d))));
    return (
      <SmartRosterTab deptId="d1" data={data} update={update} staffEditable={editable} T={T} Card={Card} Btn={Btn} Field={Field}
        inputStyle={{}} th={{}} td={{}} uid={() => "p1"} dstr={iso} onApplied={() => {}} />
    );
  }
  const FULL = over({ coverage: { morning: { min: 4, max: 4 }, afternoon: { min: 4, max: 4 } } });
  // The first boxes on the page: Morning fewest, Morning most.
  const box = (i) => screen.getAllByRole("spinbutton")[i];
  const banner = () => screen.getAllByRole("status")[0];
  const generate = () => screen.getByRole("button", { name: /Generate this week/ });

  test("green while the settings fit, amber the moment a box stops them fitting, green again when put back", () => {
    render(<App />);
    expect(banner()).toHaveTextContent("These settings fit your 15 staff.");
    fireEvent.change(box(0), { target: { value: "9" } });
    expect(banner()).toHaveTextContent("These settings do not add up yet. Morning: at least 9 on duty, but at most 5. "
      + "Generate cannot make a week until this is changed.");
    // Said once: the engine's own line for it is left out below.
    expect(screen.queryByText(/the maximum \(5\) is below the minimum \(9\)/)).toBeNull();
    // Generate is never held back by the banner.
    expect(generate()).not.toBeDisabled();
    fireEvent.change(box(0), { target: { value: "4" } });
    expect(banner()).toHaveTextContent("These settings fit your 15 staff.");
  });

  test("Fix it for me saves one more on the shift and says exactly what it changed", () => {
    render(<App rosterRules={FULL} />);
    expect(banner()).toHaveTextContent("15 staff working 5 days is 75 duties a week, but your shifts have room for only 70");
    expect(banner()).toHaveTextContent("Changes Morning: at most 4 → 5, and saves it.");
    expect(generate()).not.toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Fix it for me/ }));
    expect(saved.rosterRules.coverage.morning).toEqual({ min: 4, max: 5 });
    expect(saved.rosterRules.coverage.afternoon).toEqual({ min: 4, max: 4 });
    expect(banner()).toHaveTextContent("These settings fit your 15 staff.");
    expect(banner()).toHaveTextContent("Changed — Morning: at most 4 → 5. Undo puts it back.");
    expect(screen.queryByRole("button", { name: /Fix it for me/ })).toBeNull();
    // The next change to the settings takes the note away.
    fireEvent.change(box(1), { target: { value: "6" } });
    expect(banner()).toHaveTextContent("These settings fit your 15 staff.");
    expect(banner()).not.toHaveTextContent("Changed");
  });

  test("the engine's lines for the same sum are left out; its other lines, and its lines for other sums, stay", () => {
    render(<App rosterRules={FULL} />);
    expect(screen.queryByText(/^Duties per week: /)).toBeNull();
    expect(screen.queryByText(/even with every shift at its fullest/)).toBeNull();
    expect(screen.getByText(/will get no night duty this week/)).toBeInTheDocument();
    // With the banner on an earlier problem, the engine's sum is not the same thing, and is shown.
    fireEvent.change(screen.getByLabelText("In a row — fewest — Night"), { target: { value: "2" } });
    // Twelve boxes for staff on each shift, five for Fewest, then Most: Night is the fourth of those.
    fireEvent.change(box(20), { target: { value: "1" } });
    expect(saved.rosterRules.weeklyMax.night).toBe(1);
    expect(banner()).toHaveTextContent("Night is set to come 2 together, but each person gets at most 1 Night a week.");
    expect(screen.getByText(/^Duties per week: /)).toBeInTheDocument();
  });

  test("on a view-only rota the banner still says it, and Fix it for me is off", () => {
    render(<App rosterRules={FULL} editable={false} />);
    expect(banner()).toHaveTextContent("These settings do not add up yet.");
    expect(screen.getByRole("button", { name: /Fix it for me/ })).toBeDisabled();
  });
});
