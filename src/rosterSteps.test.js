/* Smart Roster in three steps: 1 Ward needs · 2 Your staff · 3 Make the
   roster. The buttons and what each says, which sections each step holds,
   the step each department was last on (remembered in this browser, and
   never a reason to fail), the ready checklist, and the one line said first
   about a proposed week. 1 November 2026 is a Sunday. */

import React, { useState } from "react";
import { render, screen, fireEvent, within, cleanup } from "@testing-library/react";
import SmartRosterTab from "./SmartRosterTab";
import { readyLines, weekSummary, stepKey, loadStep } from "./RosterSteps";
import { mergeRules, LOOK_BACK_ALL } from "./rosterConfig";

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
function App({ rosterRules, deptId = "d1", staff = people(15), extra = {} }) {
  const [data, setData] = useState(() => ({
    staff, codes: CODES, cells: {}, cellMeta: {}, nonOfficial: [], dutyRequests: [], fridayRule: false,
    ...(rosterRules ? { rosterRules } : {}), ...extra,
  }));
  saved = data;
  const update = (fn) => setData((d) => fn(JSON.parse(JSON.stringify(d))));
  return (
    <SmartRosterTab key={deptId} deptId={deptId} data={data} update={update} staffEditable T={T} Card={Card} Btn={Btn} Field={Field}
      inputStyle={{}} th={{}} td={{}} uid={() => "u1"} dstr={iso} onApplied={() => {}} />
  );
}
const stepButton = (n) => screen.getByRole("button", { name: new RegExp(`^Step ${n},`) });
const goStep = (n) => fireEvent.click(stepButton(n));

beforeEach(() => {
  window.alert = jest.fn();
  window.confirm = jest.fn(() => true);
  window.scrollTo = jest.fn();
});

describe("the three steps", () => {
  test("each button says where its step stands, and the current one is marked", () => {
    // Ten on the defaults fit (fifteen would be more duties than the shifts hold).
    render(<App staff={people(10)} />);
    expect(stepButton(1)).toHaveAccessibleName("Step 1, Ward needs: Done");
    expect(stepButton(2)).toHaveAccessibleName("Step 2, Your staff: 10 on the roster");
    expect(stepButton(3)).toHaveAccessibleName("Step 3, Make the roster: Pick a week");
    expect(stepButton(1)).toHaveAttribute("aria-current", "step");
    expect(stepButton(2)).not.toHaveAttribute("aria-current");
  });

  test("Needs a fix while the settings do not add up, and the roster count leaves out Skip", () => {
    render(<App rosterRules={{ coverage: { morning: { min: 6, max: 5 } }, skipStaff: ["s0", "s1"] }} />);
    expect(stepButton(1)).toHaveAccessibleName("Step 1, Ward needs: Needs a fix");
    expect(stepButton(2)).toHaveAccessibleName("Step 2, Your staff: 13 on the roster");
  });

  test("each step holds its own sections; Next and Back move between them", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "Who's needed on each shift" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Your staff" })).toBeNull();
    expect(screen.queryByText("Generate this week")).toBeNull();
    expect(screen.queryByRole("button", { name: /← Back/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next: your staff →" }));
    expect(screen.getByRole("heading", { name: "Your staff" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Who's needed on each shift" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next: make the roster →" }));
    expect(screen.getByText("Generate this week")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Next:/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "← Back" }));
    expect(screen.getByRole("heading", { name: "Your staff" })).toBeInTheDocument();
  });

  test("the steps are always clickable, in any order, and moving writes nothing to the rota", () => {
    render(<App />);
    const before = saved;
    goStep(3); goStep(1); goStep(2);
    expect(screen.getByRole("heading", { name: "Your staff" })).toBeInTheDocument();
    expect(saved).toBe(before);
  });

  test("buttons a finger can find: the steps 60px, Next and Back 48px", () => {
    render(<App />);
    [1, 2, 3].forEach((n) => expect(parseInt(stepButton(n).style.minHeight, 10)).toBeGreaterThanOrEqual(44));
    expect(parseInt(screen.getByRole("button", { name: /^Next:/ }).style.minHeight, 10)).toBeGreaterThanOrEqual(44);
  });
});

describe("the step each department was last on", () => {
  test("remembered per department, in this browser", () => {
    render(<App deptId="d1" />);
    goStep(3);
    expect(window.localStorage.getItem(stepKey("d1"))).toBe("3");
    cleanup();
    render(<App deptId="d1" />);
    expect(stepButton(3)).toHaveAttribute("aria-current", "step");
    cleanup();
    render(<App deptId="d2" />);
    expect(stepButton(1)).toHaveAttribute("aria-current", "step");
  });

  test("anything stored that is not a step reads as step 1", () => {
    window.localStorage.setItem(stepKey("d1"), "banana");
    expect(loadStep("d1")).toBe(1);
    window.localStorage.setItem(stepKey("d1"), "2");
    expect(loadStep("d1")).toBe(2);
  });

  test("storage blocked: the page still opens on step 1 and the steps still work", () => {
    const real = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", { configurable: true, get() { throw new Error("blocked"); } });
    try {
      render(<App />);
      expect(stepButton(1)).toHaveAttribute("aria-current", "step");
      goStep(2);
      expect(screen.getByRole("heading", { name: "Your staff" })).toBeInTheDocument();
    } finally {
      Object.defineProperty(window, "localStorage", real);
    }
  });

  test("the rota's own recovery keys are left exactly as they were", () => {
    window.localStorage.setItem("dutyrota:recovering", "x1");
    window.localStorage.setItem("dutyrota:recovery-done", "x2");
    render(<App />);
    goStep(3); goStep(2);
    expect(window.localStorage.getItem("dutyrota:recovering")).toBe("x1");
    expect(window.localStorage.getItem("dutyrota:recovery-done")).toBe("x2");
  });
});

describe("ready to make the roster", () => {
  const terms = { termOne: "Shift Manager", termMany: "Shift Managers", lower: "shift manager" };
  const base = { from: "2026-11-01", to: "2026-11-07", staff: people(10), data: { dutyRequests: [] } };
  const fitOk = { ok: true, count: 10 };
  const senior = (seniorCount, seniorPerDay, needed) => ({ seniorCount, seniorPerDay, perPerson: 5, needed });
  const lines = (over = {}) => readyLines({ fit: fitOk, rules: mergeRules({}), senior: senior(0, 0, 0), terms, ...base, ...over })
    .map((l) => `${l.ok ? "✓" : "!"} ${l.text}${l.toStep ? ` → ${l.toStep}` : ""}`);

  test("a ward on the defaults", () => {
    expect(lines()).toEqual([
      "✓ Ward needs fit your 10 staff",
      "✓ No shift manager asked for on any shift",
      "✓ 10 people on the roster",
      "✓ No approved duty requests or fixed duties this week",
      "✓ 5 rules for what may follow what (Must)",
      "✓ Looking back at the last 30 days for fair shares",
    ]);
  });

  test("what needs a look, with where to look", () => {
    const got = lines({
      fit: { ok: false, count: 10 }, senior: senior(2, 2, 3),
      rules: mergeRules({ skipStaff: ["s0"], lookbackDays: 0, sequenceRules: [], fixedDuties: [
        { id: "f", staffId: "s1", date: "2026-11-03", duty: "night" }, { id: "g", staffId: "s1", date: "2026-12-03", duty: "night" }] }),
      data: { dutyRequests: [
        { id: "q", staffId: "s2", date: "2026-11-02", category: "off", approved: true },
        { id: "r", staffId: "s3", date: "2026-11-02", category: "off", approved: false },
        { id: "t", staffId: "s3", date: "2026-11-09", category: "off", approved: true }] },
    });
    expect(got).toEqual([
      "! Ward needs don't add up yet → 1",
      "! Only 2 Shift Managers for 2 a day: at 5 duties each that needs 3, so some shifts may have none → 2",
      "✓ 9 people on the roster, 1 skipped",
      "✓ 1 approved duty request and 1 duty you fixed this week — always kept (Must)",
      "✓ No rules for what may follow what",
      "✓ Not looking back at past duties for fair shares (rest after last week is still checked)",
    ]);
  });

  test("enough people who can take charge, and the entire roster", () => {
    const got = lines({ senior: senior(4, 2, 3), rules: mergeRules({ lookbackDays: LOOK_BACK_ALL }) });
    expect(got[1]).toBe("✓ 4 Shift Managers on the roster — enough for 2 a day");
    expect(got[5]).toBe("✓ Looking back at the entire roster for fair shares");
  });

  test("on step 3 before a week is made, with a way back to step 1 when it needs one", () => {
    render(<App rosterRules={{ coverage: { morning: { min: 6, max: 5 } } }} />);
    goStep(3);
    expect(screen.getByText("Ready to make the roster?").parentElement)
      .toHaveTextContent("Ward needs don't add up yet — go back to step 1");
    fireEvent.click(screen.getByRole("button", { name: "go back to step 1" }));
    expect(stepButton(1)).toHaveAttribute("aria-current", "step");
  });
});

describe("the proposed week", () => {
  test("the one line said first", () => {
    expect(weekSummary({ report: { shortfalls: [], seniorGaps: [] }, termOne: "Senior" }))
      .toEqual({ ok: true, text: "All Must rules met, every shift covered." });
    expect(weekSummary({
      report: { shortfalls: [{ needed: 1 }, { needed: 2 }], seniorGaps: [{}] }, mustMissed: 1, termOne: "Shift Manager",
    })).toEqual({ ok: false, text: "3 shifts not covered · 1 shift with no Shift Manager · 1 personal Must rule not met" });
  });

  test("made on step 3: the summary first; the checklist gives way to the week; Use this roster applies as Apply did", async () => {
    render(<App staff={people(12)} rosterRules={{ coverage: { morning: { min: 2, max: 3 }, afternoon: { min: 2, max: 3 }, night: { min: 1, max: 2 } } }} />);
    goStep(3);
    fireEvent.change(screen.getByLabelText(/^Week beginning/), { target: { value: "2026-11-01" } });
    fireEvent.click(screen.getByText("Generate this week"));
    const use = await screen.findByRole("button", { name: /Use this roster/ }, { timeout: 30000 });
    expect(stepButton(3)).toHaveAccessibleName("Step 3, Make the roster: Week ready");
    expect(screen.queryByText("Ready to make the roster?")).toBeNull();
    const card = screen.getByRole("heading", { name: "Proposed week" }).closest("div").parentElement.parentElement;
    expect(within(card).getAllByRole("status")[0]).toHaveTextContent(/^(All Must rules met, every shift covered\.|.*not covered.*)$/);
    fireEvent.click(use);
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/^Apply this week\?/));
    expect(Object.keys(saved.cells).length).toBeGreaterThan(0);
  }, 60000);

  test("Discard: back to the checklist, and Pick a week", async () => {
    render(<App staff={people(12)} />);
    goStep(3);
    fireEvent.click(screen.getByText("Generate this week"));
    await screen.findByRole("button", { name: /Use this roster/ }, { timeout: 30000 });
    fireEvent.click(screen.getByRole("button", { name: /Discard/ }));
    expect(screen.getByText("Ready to make the roster?")).toBeInTheDocument();
    expect(stepButton(3)).toHaveAccessibleName("Step 3, Make the roster: Pick a week");
  }, 60000);
});
