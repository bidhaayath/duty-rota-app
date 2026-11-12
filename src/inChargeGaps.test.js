/* A shift with no in-charge while the ward holds its in-charge as a Must:
   said at the top of the proposed week, with the day, the shift and why
   nobody who can take charge was free. 1 November 2026 is a Sunday. */

import React, { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { generateRoster } from "./rosterEngine";
import { weekConfig, mergeRules, activeStaffFor, weekDatesFrom } from "./rosterConfig";
import { whyNoInCharge, noInChargeText } from "./inChargeGaps";
import { prepareMonth, runEngine, finishMonth } from "./monthBuild";
import SmartRosterTab from "./SmartRosterTab";
import MonthPreview from "./MonthPreview";
import { seededWard } from "../tools/engine-compare/wards";

const CODES = [
  { id: "M", code: "M", counts: "morning" }, { id: "A", code: "A", counts: "afternoon" },
  { id: "N", code: "N", counts: "night" }, { id: "OFF", code: "OFF", counts: "off" },
];
const WEEK = ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"];
const person = (id, extra = {}) => ({ id, name: id, leavePeriods: [], ...extra });

/* A week written by hand: each person's seven days, Sunday first. */
const weekOf = (rows) => {
  const cells = {};
  Object.entries(rows).forEach(([id, days]) => days.forEach((c, i) => {
    if (c !== null) cells[`${id}|${WEEK[i]}`] = c;
  }));
  return cells;
};
const why = (rows, { saved = {}, rules = {}, staff, data = {}, date = "2026-11-04", shift = "night" } = {}) => {
  const all = staff || Object.keys(rows).map((id) => person(id));
  return whyNoInCharge({
    date, shift, cells: weekOf(rows), from: WEEK[0], to: WEEK[6], staff: all,
    data: { codes: CODES, cells: saved, dutyRequests: [], ...data },
    rules: mergeRules({ seniorStaff: Object.keys(rows), ...rules }),
  });
};
const O = "off", M = "morning", A = "afternoon", N = "night";

describe("why each person who can take charge was not free", () => {
  test("on leave, skipped, or kept off by the rota", () => {
    expect(why({ a: [M, M, O, null, M, O, M] }, { staff: [person("a", { leavePeriods: [{ start: "2026-11-04", end: "2026-11-04" }] })] }))
      .toEqual([["leave"]]);
    expect(why({ a: [M, M, O, O, M, O, M] }, { rules: { skipStaff: ["a"] } })).toEqual([["skipped"]]);
    // A day kept as it was — sick leave, say — has no duty from the engine.
    expect(why({ a: [M, M, O, null, M, O, M] })).toEqual([["leave"]]);
  });

  test("an approved request for something else that day", () => {
    expect(why({ a: [M, M, O, O, M, O, M] }, { data: { dutyRequests: [{ staffId: "a", date: "2026-11-04", category: "off", approved: true }] } }))
      .toEqual([["request"]]);
  });

  test("working another shift that day", () => {
    expect(why({ a: [M, M, O, M, M, O, M] })).toEqual([["working", "morning"]]);
  });

  test("resting after yesterday's duty, or the next day's duty cannot follow this one", () => {
    // Night on Tuesday: never a Night straight after… is not a rule, but off after a Night is.
    const offAfterNight = { sequenceRules: [{ id: "x", type: "must", after: "night", then: "off" }] };
    expect(why({ a: [M, O, N, O, M, O, M] }, { rules: offAfterNight })).toEqual([["rest", "night"]]);
    // The usual rules: never a Morning after a Night, so a Night today would break Thursday's Morning.
    expect(why({ a: [M, O, O, O, M, M, O] })).toEqual([["tomorrow", "morning", "night"]]);
  });

  test("a week already full, or days in a row already at six", () => {
    expect(why({ a: [M, M, A, O, O, A, M] }, { rules: { weeklyDuties: { min: 4, max: 4 } } })).toEqual([["weekMax", 4]]);
    // Six days before the week began, read from the saved rota.
    const saved = {};
    ["2026-10-29", "2026-10-30", "2026-10-31"].forEach((d) => { saved[d] = { a: "M" }; });
    expect(why({ a: [A, A, A, O, O, O, O] }, { saved, date: "2026-11-04", rules: { weeklyDuties: { min: null, max: null } } }))
      .toEqual([["daysInRow", 6]]);
  });

  test("their own rules: shifts they do, days they are off, the most they take", () => {
    expect(why({ a: [M, M, O, O, M, O, M] }, { rules: { staffShifts: { a: ["morning"] } } })).toEqual([["notTheirShift", "night"]]);
    expect(why({ a: [M, M, O, O, M, O, M] }, { rules: { personRules: [{ id: "r", staffId: "a", type: "offOn", days: [3], strength: "hard" }] } }))
      .toEqual([["ownRule"]]);
    expect(why({ a: [N, O, O, O, M, O, M] }, { rules: { personRules: [{ id: "r", staffId: "a", type: "atMost", shift: "night", count: 1, strength: "hard" }] } }))
      .toEqual([["ownRule"]]);
  });

  test("free, and none of those: a day off", () => {
    expect(why({ a: [M, A, O, O, O, O, M] })).toEqual([["off"]]);
  });
});

describe("over more than a week, as Ini's month is built", () => {
  // Two weeks, Monday 2 to Sunday 15 November, on a ward whose week starts on Monday.
  const TWO = [...Array(14)].map((_, i) => `2026-11-${String(i + 2).padStart(2, "0")}`);
  const fortnight = (days, extra = {}) => {
    const cells = {};
    days.forEach((c, i) => { if (c !== null) cells[`a|${TWO[i]}`] = c; });
    return (date) => whyNoInCharge({
      date, shift: "night", cells, from: TWO[0], to: TWO[13], staff: [person("a")],
      data: { codes: CODES, cells: {}, dutyRequests: [], weekStartsOn: 1 },
      rules: mergeRules({ seniorStaff: ["a"], weeklyDuties: { min: 5, max: 5 } }), ...extra,
    });
  };

  test("the week's most duties is counted in the ward's own week around the day, not the whole period", () => {
    // Five Mornings, Monday to Friday of the first week; the second week only two so far.
    const ask = fortnight([M, M, M, M, M, O, O, O, A, O, O, A, O, O]);
    expect(ask("2026-11-07")).toEqual([["weekMax", 5]]);      // Saturday, first week: full
    expect(ask("2026-11-11")).toEqual([["off"]]);              // Wednesday, second week: two worked
  });

  test("a day kept as it already was on the rota is said as that", () => {
    const ask = fortnight([M, M, O, O, M, O, O, O, A, O, O, A, O, O], { kept: { "a|2026-11-04": "off" } });
    expect(ask("2026-11-04")[0]).toEqual(["kept"]);
    expect(noInChargeText({ day: "Wed 4 Nov", shift: "night", termOne: "Senior", reasons: [["kept"], ["kept"]] }))
      .toBe("Night on Wed 4 Nov has no Senior: all 2 have this day already set on the rota.");
  });
});

/* A month for Ini: nine staff, a Night needing someone in charge, and the
   only person who can take charge away all October. */
const monthWard = (seniors) => {
  const staff = [...Array(9)].map((_, i) => person(`s${i}`, i === 0 ? { name: "Ali", leavePeriods: [{ start: "2026-09-20", end: "2026-11-10" }] } : {}));
  return {
    staff, codes: CODES, cells: {}, dutyRequests: [], weekStartsOn: 0,
    rosterRules: {
      seniorStaff: ["s0"], seniorCover: { night: 1 },
      coverage: { morning: { min: 2, max: 3 }, afternoon: { min: 2, max: 3 }, evening: { min: 0, max: 0 }, night: { min: 1, max: 2 } },
      ...(seniors ? { ruleStates: { seniors } } : {}),
    },
  };
};
const buildMonth = (data) => {
  const prep = prepareMonth({ data, month: "2026-10", keepExisting: false });
  const out = runEngine({ ...prep.config, polishSteps: 2000, attempts: 1 }, prep.chosenCodes);
  return finishMonth(prep, out, data);
};

describe("Ini's month", () => {
  test("at Must, each shift with nobody in charge carries why; never saved, none do", () => {
    const must = buildMonth(monthWard({ state: "hard", priority: 1 }));
    expect(must.seniorGaps.length).toBe(31);
    expect(must.noInCharge.map((g) => g.date)).toEqual(must.seniorGaps.map((g) => g.date));
    expect(must.noInCharge.every((g) => JSON.stringify(g.reasons) === JSON.stringify([["leave"]]))).toBe(true);
    const absent = buildMonth(monthWard(undefined));
    expect(absent.seniorGaps.length).toBe(31);
    expect(absent.noInCharge).toEqual([]);
  }, 60000);

  test("the month preview: the same red box as Smart Roster's week, and not the amber line too", () => {
    const T = { lagoon: "#0E7C7B", ink: "#142B33", inkSoft: "#4A6570", line: "#D5E2E0", mist: "#EEF4F3", coral: "#E4604E" };
    const data = { ...monthWard({ state: "hard", priority: 1 }), rosterRules: { ...monthWard({ state: "hard", priority: 1 }).rosterRules, seniorTerm: "Shift Manager" } };
    render(<MonthPreview proposal={buildMonth(data)} data={data} update={jest.fn()} T={T} onDiscard={jest.fn()} onApplied={jest.fn()} />);
    const red = screen.getByText("No Shift Manager where one is a Must:").parentElement;
    expect(red).toHaveTextContent("Night on Thu 1 Oct has no Shift Manager: the only one is on leave.");
    expect(red.querySelectorAll("li")).toHaveLength(31);
    expect(screen.queryByText(/with no shift manager:/)).toBeNull();
  }, 60000);

  test("never saved: the month preview keeps its amber line, with no red box", () => {
    const T = { lagoon: "#0E7C7B", ink: "#142B33", inkSoft: "#4A6570", line: "#D5E2E0", mist: "#EEF4F3", coral: "#E4604E" };
    const data = monthWard(undefined);
    render(<MonthPreview proposal={buildMonth(data)} data={data} update={jest.fn()} T={T} onDiscard={jest.fn()} onApplied={jest.fn()} />);
    expect(screen.queryByText(/where one is a Must:/)).toBeNull();
    expect(screen.getByText(/31 shifts with no senior:/)).toBeInTheDocument();
  }, 60000);
});

describe("the sentence", () => {
  const say = (reasons, termOne = "Shift Manager") =>
    noInChargeText({ day: "Tue 17 Nov", shift: "night", reasons, termOne });

  test("one reason for everyone, and for the only one", () => {
    expect(say([["leave"], ["leave"], ["leave"]])).toBe("Night on Tue 17 Nov has no Shift Manager: all 3 are on leave.");
    expect(say([["rest", "night"]], "In-charge")).toBe("Night on Tue 17 Nov has no In-charge: the only one is resting after a night.");
  });

  test("several reasons: the most common first, each counted", () => {
    expect(say([["leave"], ["rest", "night"], ["leave"], ["ownRule"], ["rest", "night"], ["leave"], ["weekMax", 5], ["working", "morning"]]))
      .toBe("Night on Tue 17 Nov has no Shift Manager: of your 8, 3 are on leave, 2 are resting after a night, "
        + "1 is off by their own rule, 1 has already worked 5 days this week and 1 is working the Morning.");
    expect(say([["tomorrow", "morning", "night"], ["rest", "afternoon"]]))
      .toBe("Night on Tue 17 Nov has no Shift Manager: of your 2, 1 is working the next day's Morning (it can't follow a night) "
        + "and 1 is resting after an afternoon.");
  });

  test("nobody on the rota who can take charge", () => {
    expect(say([])).toBe("Night on Tue 17 Nov has no Shift Manager: nobody on the rota this week can take charge.");
  });
});

/* One of the comparison tool's weeks where, at Must, Friday's Night still
   had nobody in charge: every reason is one the engine never breaks. */
test("a real week: each reason is what the week as built shows", () => {
  const { data, start } = seededWard(6);
  const ward = {
    ...data,
    rosterRules: {
      ...data.rosterRules,
      seniorStaff: data.staff.filter((_, i) => i % 3 === 0).map((s) => s.id),
      seniorCover: { morning: 1, afternoon: 0, evening: 0, night: 1 },
      ruleStates: { ...(data.rosterRules.ruleStates || {}), seniors: { state: "hard", priority: 1 } },
    },
  };
  const cfg = { ...weekConfig(ward, start), polishMaxMs: 1e9 };
  const out = generateRoster(cfg);
  const gap = out.report.seniorGaps.find((g) => g.date === "2026-11-06" && g.shift === "night");
  expect(gap).toBeTruthy();
  const reasons = whyNoInCharge({
    ...gap, cells: out.cells, data: ward, rules: mergeRules(ward.rosterRules),
    staff: activeStaffFor(ward.staff, weekDatesFrom(start)), from: cfg.from, to: cfg.to,
  });
  expect(reasons.map((r) => r[0]).sort()).toEqual(["rest", "weekMax", "working"]);
  expect(noInChargeText({ ...gap, reasons, termOne: "Senior", day: "Fri 6 Nov" }))
    .toMatch(/^Night on Fri 6 Nov has no Senior: of your 3, /);
}, 60000);

describe("on the proposed week", () => {
  const T = { lagoon: "#0F8B7E", ink: "#142B33", inkSoft: "#4A6570", line: "#DCE8E6", mist: "#EEF4F3", coral: "#E4604E", sand: "#C9A15A" };
  const Card = ({ children }) => <div>{children}</div>;
  const Btn = ({ children, kind, small, ...rest }) => <button {...rest}>{children}</button>;
  const Field = ({ label, children }) => <label>{label}{children}</label>;
  const pad = (n) => String(n).padStart(2, "0");
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  /* Ten staff, a Night needing someone in charge, and the only person who
     can take charge away all week. */
  const ward = (seniors) => ({
    staff: [...Array(10)].map((_, i) => person(`r${i}`, i === 0 ? { leavePeriods: [{ start: "2026-10-01", end: "2026-12-31" }] } : {})),
    codes: CODES, cells: {}, cellMeta: {}, nonOfficial: [], dutyRequests: [], fridayRule: false,
    rosterRules: {
      seniorTerm: "Shift Manager", seniorStaff: ["r0"], seniorCover: { night: 1 },
      coverage: { morning: { min: 2, max: 3 }, afternoon: { min: 2, max: 3 }, evening: { min: 0, max: 0 }, night: { min: 1, max: 2 } },
      ...(seniors ? { ruleStates: { seniors } } : {}),
    },
  });
  function App({ start }) {
    const [data, setData] = useState(start);
    const update = (fn) => setData((d) => fn(JSON.parse(JSON.stringify(d))));
    return (
      <SmartRosterTab deptId="d1" data={data} update={update} staffEditable T={T} Card={Card} Btn={Btn} Field={Field}
        inputStyle={{}} th={{}} td={{}} uid={() => "u1"} dstr={iso} onApplied={() => {}} />
    );
  }
  const openWeek = async (start) => {
    render(<App start={start} />);
    fireEvent.change(screen.getByLabelText(/^Week beginning/), { target: { value: "2026-11-01" } });
    fireEvent.click(screen.getByText("Generate this week"));
    await screen.findByText("Proposed week", {}, { timeout: 30000 });
  };

  test("at Must: said at the top, every night, with why — and not again below", async () => {
    await openWeek(ward({ state: "hard", priority: 1 }));
    const red = screen.getByText("No Shift Manager where one is a Must:").parentElement;
    expect(red).toHaveTextContent("Night on Sun 1 Nov has no Shift Manager: the only one is on leave.");
    expect(red.querySelectorAll("li")).toHaveLength(7);
    expect(screen.queryByText(/shifts? ha(s|ve) no shift manager on duty:/)).toBeNull();
  }, 60000);

  test("never saved (Protect most): the amber note as before, no red box", async () => {
    await openWeek(ward(undefined));
    expect(screen.queryByText("No Shift Manager where one is a Must:")).toBeNull();
    expect(screen.getByText(/7 shifts have no shift manager on duty:/)).toBeInTheDocument();
  }, 60000);
});
