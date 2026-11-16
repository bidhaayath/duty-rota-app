/* "Show another option": the same week built again with every random choice
   moved along. The first option is generateRoster exactly as it always was;
   another is kept only if a tenth of the person-days differ from every
   option already kept and it is no worse on cover, in-charge or any Must.
   Built only when asked for. 1 November 2026 is a Sunday. */

import React, { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { generateRoster, generateOptions, nextOption, optionDifference, OPTION_TRIES, OPTION_DIFFERENCE } from "./rosterEngine";
import { weekConfig, mergeRules } from "./rosterConfig";
import { PersonWeek } from "./WardNeeds";
import SmartRosterTab from "./SmartRosterTab";
import { seededWard } from "../tools/engine-compare/wards";

const steady = (cfg) => ({ ...cfg, polishMaxMs: 1e9, polishSteps: 3000 });
const uncovered = (res) => res.report.shortfalls.reduce((n, x) => n + x.needed, 0);
const noInCharge = (res) => (res.report.seniorGaps || []).reduce((n, x) => n + (x.needed || 1), 0);
const mustBent = (res) => (res.report.relaxations || []).filter((r) => r.strength === "hard").length;

describe("the engine", () => {
  test("option 1 is generateRoster, byte for byte; offset 0 is the default", () => {
    const { start, data } = seededWard(3);
    const cfg = steady(weekConfig(data, start));
    const today = JSON.stringify(generateRoster(cfg));
    expect(JSON.stringify(generateRoster(cfg, 0))).toBe(today);
    const options = generateOptions(cfg, 3);
    expect(JSON.stringify(options[0])).toBe(today);
  }, 120000);

  test("extra options differ by a tenth from each other, and are never worse than the first", () => {
    const { start, data } = seededWard(5);
    const cfg = steady(weekConfig(data, start));
    const options = generateOptions(cfg, 3);
    expect(options.length).toBeGreaterThan(1);
    expect(options.length).toBeLessThanOrEqual(3);
    options.forEach((o, i) => {
      options.slice(0, i).forEach((k) => expect(optionDifference(cfg, k.cells, o.cells)).toBeGreaterThanOrEqual(OPTION_DIFFERENCE));
      expect(uncovered(o)).toBeLessThanOrEqual(uncovered(options[0]));
      expect(noInCharge(o)).toBeLessThanOrEqual(noInCharge(options[0]));
      expect(mustBent(o)).toBeLessThanOrEqual(mustBent(options[0]));
    });
  }, 180000);

  test("tries stop at six; a failed first build has no others", () => {
    const { start, data } = seededWard(2);
    const cfg = steady(weekConfig(data, start));
    const first = generateRoster(cfg);
    // Everything already "kept" twice over, so no build can differ enough.
    const { option, next } = nextOption(cfg, [first], OPTION_TRIES);
    expect(next).toBe(OPTION_TRIES + 1);
    expect(option === null || optionDifference(cfg, first.cells, option.cells) >= OPTION_DIFFERENCE).toBe(true);
    expect(nextOption(cfg, [first], OPTION_TRIES + 1)).toEqual({ option: null, next: OPTION_TRIES + 1 });
    expect(nextOption(cfg, [{ ok: false }], 1).option).toBeNull();
    expect(generateOptions(cfg, 3, { ok: false, problems: ["x"] })).toEqual([{ ok: false, problems: ["x"] }]);
  }, 120000);

  test("person-days: a tenth of the people times the days", () => {
    const cfg = { from: "2026-11-01", to: "2026-11-07", staff: [{ id: "a" }, { id: "b" }] };
    const a = { "a|2026-11-01": "night" };
    expect(optionDifference(cfg, a, a)).toBe(0);
    expect(optionDifference(cfg, a, {})).toBeCloseTo(1 / 14);
    expect(optionDifference(cfg, a, { "a|2026-11-01": "off" })).toBeCloseTo(1 / 14);
    expect(optionDifference(cfg, { "a|2026-11-01": "off" }, {})).toBe(0);
  });
});

/* ── On the screen ── */
const CODES = [
  { id: "M", code: "M", counts: "morning" }, { id: "A", code: "A", counts: "afternoon" },
  { id: "N", code: "N", counts: "night" }, { id: "OFF", code: "OFF", counts: "off" },
];
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const people = (n) => [...Array(n)].map((_, i) => ({ id: `s${i}`, name: `Nurse ${i}`, leavePeriods: [] }));
const T = { lagoon: "#0F8B7E", ink: "#142B33", inkSoft: "#4A6570", line: "#DCE8E6", mist: "#EEF4F3", coral: "#E4604E", sand: "#C9A15A" };
const Card = ({ children }) => <div>{children}</div>;
const Btn = ({ children, kind, small, ...rest }) => <button {...rest}>{children}</button>;
const Field = ({ label, children }) => <label>{label}{children}</label>;

let saved;
function App({ rosterRules, staff }) {
  const [data, setData] = useState(() => ({
    staff, codes: CODES, cells: {}, cellMeta: {}, nonOfficial: [], dutyRequests: [], fridayRule: false, rosterRules,
  }));
  saved = data;
  const update = (fn) => setData((d) => fn(JSON.parse(JSON.stringify(d))));
  return (
    <SmartRosterTab deptId="d1" data={data} update={update} staffEditable T={T} Card={Card} Btn={Btn} Field={Field}
      inputStyle={{}} th={{}} td={{}} uid={() => "u1"} dstr={iso} onApplied={() => {}} />
  );
}

beforeEach(() => {
  window.alert = jest.fn();
  window.confirm = jest.fn(() => true);
  window.scrollTo = jest.fn();
});

const makeWeek = async (props) => {
  render(<App {...props} />);
  fireEvent.click(screen.getByRole("button", { name: /^Step 3,/ }));
  fireEvent.change(screen.getByLabelText(/^Week beginning/), { target: { value: "2026-11-01" } });
  fireEvent.click(screen.getByText("Generate this week"));
  await screen.findByRole("button", { name: /Use this roster/ }, { timeout: 30000 });
};
// The page as read, without the paging line, so two options can be compared.
const grid = () => document.body.textContent.replace(/Option \d of \d/, "");

describe("on screen", () => {
  test("paging: Option 2 of 2, back and forward, and Use this roster writes the option shown", async () => {
    await makeWeek({ staff: people(12), rosterRules: { coverage: { morning: { min: 2, max: 3 }, afternoon: { min: 2, max: 3 }, night: { min: 1, max: 2 } } } });
    expect(screen.queryByText(/^Option \d of \d$/)).toBeNull();
    const firstWeek = grid();
    fireEvent.click(screen.getByRole("button", { name: /Show another option/ }));
    await screen.findByText("Option 2 of 2", {}, { timeout: 60000 });
    const secondWeek = grid();
    expect(secondWeek).not.toBe(firstWeek);
    fireEvent.click(screen.getByRole("button", { name: "Previous option" }));
    expect(screen.getByText("Option 1 of 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous option" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Next option" }));
    expect(grid()).toBe(secondWeek);
    // What is written is the week on screen: each person's codes, day by day, as their row reads.
    fireEvent.click(screen.getByRole("button", { name: /Use this roster/ }));
    const row = (cells, i) => `Nurse ${i}` + [1, 2, 3, 4, 5, 6, 7].map((d) => cells[`2026-11-0${d}`]?.[`s${i}`]).join("");
    [...Array(12)].forEach((_, i) => expect(secondWeek).toContain(row(saved.cells, i)));
    expect([...Array(12)].some((_, i) => !firstWeek.includes(row(saved.cells, i)))).toBe(true);
  }, 120000);

  test("nothing different enough: said kindly, and the button goes", async () => {
    // One person, one Morning a day: there is only one way to fill the week.
    await makeWeek({ staff: people(1), rosterRules: {
      coverage: { morning: { min: 1, max: 1 }, afternoon: { min: 0, max: 0 }, evening: { min: 0, max: 0 }, night: { min: 0, max: 0 } },
    } });
    fireEvent.click(screen.getByRole("button", { name: /Show another option/ }));
    await screen.findByText(/This is the best fit I found/, {}, { timeout: 60000 });
    expect(screen.queryByRole("button", { name: /Show another option/ })).toBeNull();
    expect(screen.queryByText(/^Option \d of \d$/)).toBeNull();
  }, 120000);
});

describe("the night pairs tip", () => {
  const show = (saved) => render(<PersonWeek rules={mergeRules(saved)} setRules={jest.fn()} dropRule={jest.fn()} editable T={T} Card={Card} codes={[]} />);
  const TIP = "Tip: turn on Gap between night pairs to keep pairs together.";

  test("In pairs with the gap off: the tip", () => {
    show({ blockTogether: { night: 2 }, blockDays: { night: 2 } });
    expect(screen.getByText(TIP)).toBeInTheDocument();
  });

  test("not with the gap on, nor for another In a row", () => {
    const { unmount } = show({ blockTogether: { night: 2 }, blockDays: { night: 2 }, nightBlockGap: 3 });
    expect(screen.queryByText(TIP)).toBeNull();
    unmount();
    show({ blockDays: { night: 2 } });
    expect(screen.queryByText(TIP)).toBeNull();
  });
});
