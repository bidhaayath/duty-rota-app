/* The ward's gap between night pairs: clear days after a block of nights
   before the next block starts. Off until turned on, and then nothing
   changes for a ward that never turns it on. */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { PersonWeek, givesWay, ABSENT } from "./WardNeeds";
import { mergeRules, weekConfig } from "./rosterConfig";
import { generateRoster, datesBetween } from "./rosterEngine";
import { seededWard, erWard, withNightGap, addDays } from "../tools/engine-compare/wards";

const T = { lagoon: "#0F8B7E", ink: "#142B33", inkSoft: "#4A6570", line: "#DCE8E6", mist: "#EEF4F3", coral: "#E4604E" };
const Card = ({ children }) => <div>{children}</div>;

describe("on screen", () => {
  const show = (saved) => {
    const setRules = jest.fn(), dropRule = jest.fn();
    render(<PersonWeek rules={mergeRules(saved)} setRules={setRules} dropRule={dropRule} editable T={T} Card={Card} codes={[]} />);
    return { setRules, dropRule };
  };

  test("off until turned on, and nothing is saved by looking", () => {
    const { setRules } = show({});
    expect(screen.getByText("Gap between night pairs: off")).toBeInTheDocument();
    expect(screen.queryByLabelText("Gap between night pairs: days")).toBeNull();
    expect(setRules).not.toHaveBeenCalled();
    expect(givesWay(mergeRules({})).columns.soft2).not.toContain("Gap between night pairs");
  });

  test("turned on: 3 days at Protect; 1 to 14; Turn off takes the gap away", () => {
    const { setRules } = show({});
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));
    expect(setRules).toHaveBeenCalledWith(expect.objectContaining({ nightBlockGap: 3, ruleStates: expect.objectContaining({ nightBlockGap: ABSENT.nightBlockGap }) }));
    expect(ABSENT.nightBlockGap).toEqual({ state: "soft", priority: 2 });
  });

  test("set: the days, the strength box at Protect, and the Must warning", () => {
    const { setRules, dropRule } = show({ nightBlockGap: 14, ruleStates: { nightBlockGap: { state: "soft", priority: 2 } } });
    expect(screen.getByLabelText("Gap between night pairs: days")).toHaveTextContent("14");
    expect(screen.getByRole("button", { name: "Gap between night pairs: days: one more" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Gap between night pairs: days: one fewer" }));
    expect(setRules).toHaveBeenCalledWith({ nightBlockGap: 13 });
    expect(screen.getByLabelText("Gap between night pairs: if it can't all fit")).toHaveValue("soft2");
    expect(screen.queryByText(/Must can leave a night uncovered/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
    expect(dropRule).toHaveBeenCalledWith("nightBlockGap");
    expect(givesWay(mergeRules({ nightBlockGap: 3 })).columns.soft2).toContain("Gap between night pairs");
  });

  test("Must says what it costs", () => {
    show({ nightBlockGap: 3, ruleStates: { nightBlockGap: { state: "hard", priority: 1 } } });
    expect(screen.getByText("Must can leave a night uncovered rather than start the next block sooner.")).toBeInTheDocument();
  });
});

/* Counted from the finished cells, with the days before the week read from
   its history: night blocks starting sooner than `gap` clear days after the
   person's last night. */
const tooSoon = (cfg, cells, gap) => {
  const cat = {}; (cfg.codes || []).forEach((c) => { cat[c.code] = c.counts; });
  const at = (id, d) => cells[`${id}|${d}`] ?? cat[cfg.history?.cells?.[`${id}|${d}`]];
  let n = 0;
  cfg.staff.forEach((s) => {
    datesBetween(cfg.from, cfg.to).forEach((d) => {
      if (at(s.id, d) !== "night" || at(s.id, addDays(d, -1)) === "night") return;
      for (let back = 2; back <= gap; back++) if (at(s.id, addDays(d, -back)) === "night") { n += 1; return; }
    });
  });
  return n;
};
const steady = (cfg) => ({ ...cfg, polishMaxMs: 1e9 });

describe("in the engine", () => {
  test("kept, across the start of the week too, on a ward with room", () => {
    const data = withNightGap(erWard(), 3);
    const cfg = steady(weekConfig(data, "2026-12-06"));
    const res = generateRoster(cfg);
    expect(res.ok).toBe(true);
    // Counted against the nights before the week too (its history).
    expect(tooSoon(cfg, res.cells, 3)).toBe(0);
  }, 60000);

  test("set to Ignore builds exactly as never set", () => {
    const { data, start } = seededWard(11);
    data.rosterRules.blockTogether = { night: 2 };
    const off = { ...withNightGap(data, 3), rosterRules: { ...withNightGap(data, 3).rosterRules, ruleStates: {
      ...(data.rosterRules.ruleStates || {}), nightBlockGap: { state: "disabled", priority: 1 } } } };
    expect(generateRoster(steady(weekConfig(off, start))).cells).toEqual(generateRoster(steady(weekConfig(data, start))).cells);
  }, 60000);

  test("a Must gap is never broken, even short of nights; bent at Protect, it is reported", () => {
    // A small ward: four people, two nights a night.
    const staff = [0, 1, 2, 3].map((i) => ({ id: `t${i}`, name: `T${i}`, leavePeriods: [] }));
    const base = {
      staff, codes: erWard().codes, cells: {}, cellMeta: {}, dutyRequests: [], weekStartsOn: 0, fridayRule: false, nonOfficial: [],
      rosterRules: {
        coverage: { morning: { min: 1, max: 2 }, afternoon: { min: 0, max: 1 }, evening: { min: 0, max: 0 }, night: { min: 2, max: 2 } },
        weeklyMin: { morning: 0, afternoon: 0, evening: 0, night: 0, off: 1 }, weeklyMax: { off: 3 }, blockTogether: { night: 2 },
      },
    };
    const at = (state) => {
      const d = withNightGap(base, 4);
      d.rosterRules.ruleStates = { nightBlockGap: { state, priority: 2 } };
      const cfg = steady(weekConfig(d, "2026-12-06"));
      return { cfg, res: generateRoster(cfg) };
    };
    const must = at("hard");
    expect(tooSoon(must.cfg, must.res.cells, 4)).toBe(0);
    const soft = at("soft");
    if (tooSoon(soft.cfg, soft.res.cells, 4) > 0) {
      expect(soft.res.report.relaxations.map((r) => r.rule)).toContain("gap between night pairs");
    }
    expect(soft.res.improvement.uncoveredAfter).toBeLessThanOrEqual(must.res.improvement.uncoveredAfter);
  }, 60000);
});
