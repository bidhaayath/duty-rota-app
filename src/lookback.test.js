/* How far back Smart Roster and Ini look. The look-back is for fairness
   only: rest and "what may follow what" read the 14 days before the week
   whatever it says. "The entire roster" is stored as a very long look-back.
   1 November 2026 is a Sunday. */

import React, { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { generateRoster } from "./rosterEngine";
import { weekConfig, LOOK_BACK_ALL } from "./rosterConfig";
import { prepareBuild, lookbackOptions, lookbackSentence } from "./monthBuild";
import SmartRosterTab from "./SmartRosterTab";

const WEEK = "2026-11-01";
const CODES = [
  { id: "M", code: "M", counts: "morning" }, { id: "A", code: "A", counts: "afternoon" },
  { id: "E", code: "E", counts: "evening" }, { id: "N", code: "N", counts: "night" },
  { id: "OFF", code: "OFF", counts: "off" }, { id: "NOFF", code: "(N)OFF", counts: "off" },
];
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const days = (start, n) => {
  const [y, m, d] = start.split("-").map(Number);
  return [...Array(n)].map((_, i) => iso(new Date(y, m - 1, d + i)));
};
/* Four weeks of a plain rotation ending Saturday 31 October. On that day
   r3 and r10 are on a Night. */
const ward = (lookbackDays) => {
  const staff = [...Array(14)].map((_, i) => ({ id: `r${i}`, name: `Nurse ${i}` }));
  const cycle = ["M", "A", "N", "NOFF", "OFF", "M", "A"];
  const cells = {};
  days("2026-10-04", 28).forEach((date, di) => {
    cells[date] = {};
    staff.forEach((s, si) => { cells[date][s.id] = cycle[(di + si) % 7]; });
  });
  return {
    staff, codes: CODES, cells, dutyRequests: [],
    rosterRules: {
      lookbackDays,
      coverage: { morning: { min: 3, max: 4 }, afternoon: { min: 3, max: 4 }, evening: { min: 0, max: 0 }, night: { min: 2, max: 2 } },
    },
  };
};
const datesIn = (cells) => [...new Set(Object.keys(cells).map((k) => k.slice(-10)))].sort();

describe("what the engine is given", () => {
  test("a look-back of 14 days or more is given exactly as before, with nothing marked", () => {
    for (const lb of [14, 30, LOOK_BACK_ALL]) {
      const { history } = weekConfig(ward(lb), WEEK);
      expect(history.fairFrom).toBeUndefined();
      expect(datesIn(history.cells)[0]).toBe(lb === 14 ? "2026-10-18" : "2026-10-04");
    }
  });

  test("no look-back still gives the 14 days before the week, marked as not for fairness", () => {
    const { history } = weekConfig(ward(0), WEEK);
    expect(history.fairFrom).toBe(WEEK);
    expect(datesIn(history.cells)).toEqual(days("2026-10-18", 14));
  });

  test("no look-back and no rota before the week: nothing to give, nothing marked", () => {
    const data = { ...ward(0), cells: {} };
    expect(weekConfig(data, WEEK).history).toEqual({ cells: {}, nonOfficialDates: [] });
  });
});

describe("the week built", () => {
  test("no look-back: a Night on Saturday is still not followed by a day shift on Sunday", () => {
    const out = generateRoster({ ...weekConfig(ward(0), WEEK), polishSteps: 3000 });
    expect(out.ok).toBe(true);
    for (const id of ["r3", "r10"]) {
      expect(["morning", "afternoon", "evening"]).not.toContain(out.cells[`${id}|${WEEK}`]);
    }
  }, 60000);
});

describe("Ini's month", () => {
  test("no look-back keeps the 14 rest days and counts none of them for fairness", () => {
    const prep = prepareBuild({ data: ward(30), from: WEEK, to: "2026-11-28", lookFrom: null });
    expect(prep.buildFrom).toBe(WEEK);
    expect(prep.config.history.fairFrom).toBe(WEEK);
    expect(datesIn(prep.config.history.cells)).toEqual(days("2026-10-18", 14));
  });

  test("the entire roster is said as that, not as a date a century ago", () => {
    const usual = lookbackOptions(WEEK, { lookbackDays: LOOK_BACK_ALL }, null)[0];
    expect(usual.label).toBe("Usual (the entire roster)");
    expect(lookbackSentence(usual, WEEK)).toBe("Fairness based on the entire roster, up to 31 Oct.");
    expect(lookbackSentence(usual, undefined)).toBe("Fairness based on the entire roster.");
    expect(lookbackOptions(WEEK, { lookbackDays: 30 }, null)[0]).toEqual(
      { id: "usual", label: "Usual (last 30 days)", from: "2026-10-02" });
  });
});

describe("the look-back box", () => {
  const T = { lagoon: "#0F8B7E", ink: "#142B33", inkSoft: "#4A6570", line: "#DCE8E6", mist: "#EEF4F3", coral: "#E4604E", sand: "#C9A15A" };
  const Card = ({ children }) => <div>{children}</div>;
  const Btn = ({ children, kind, small, ...rest }) => <button {...rest}>{children}</button>;
  const Field = ({ label, children }) => <label>{label}{children}</label>;
  let saved;
  function App({ rosterRules }) {
    const [data, setData] = useState(() => ({
      staff: [{ id: "a0", name: "Shau", leavePeriods: [] }],
      codes: CODES, cells: {}, cellMeta: {}, nonOfficial: [], dutyRequests: [], fridayRule: false, rosterRules,
    }));
    saved = data;
    const update = (fn) => setData((d) => fn(JSON.parse(JSON.stringify(d))));
    return (
      <SmartRosterTab deptId="d1" data={data} update={update} staffEditable T={T} Card={Card} Btn={Btn} Field={Field}
        inputStyle={{}} th={{}} td={{}} uid={() => "p1"} dstr={iso} onApplied={() => {}} />
    );
  }

  test("offers the entire roster, and saves it as a very long look-back", () => {
    render(<App />);
    fireEvent.change(screen.getByDisplayValue("Last 30 days"), { target: { value: String(LOOK_BACK_ALL) } });
    expect(saved.rosterRules.lookbackDays).toBe(LOOK_BACK_ALL);
    expect(screen.getByDisplayValue("The entire roster")).toBeInTheDocument();
  });

  test("a saved number not on the list is shown as Custom and left alone", () => {
    render(<App rosterRules={{ lookbackDays: 28 }} />);
    expect(screen.getByDisplayValue("Custom (28 days)")).toBeInTheDocument();
    expect(saved.rosterRules).toEqual({ lookbackDays: 28 });
  });
});
