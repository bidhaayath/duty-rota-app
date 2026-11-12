/* Step 1, "Ward needs": the shift cards, each person's week, what gives way
   first, and what may follow what. A new face on the settings already
   saved, so the proof is that nothing about the saved settings moves:
   a ward opens showing what it saved, opening writes nothing, each control
   writes the very keys the old box wrote, and Undo takes each one back.
   1 November 2026 is a Sunday. */

import React, { useState } from "react";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import SmartRosterTab from "./SmartRosterTab";
import { useRotaHistory } from "./useRotaHistory";
import { DEFAULT_RULES, mergeRules, LOOK_BACK_ALL } from "./rosterConfig";
import {
  IN_ROW, inRowOf, customInRow, inRowPatch, followText, givesWay, levelOf, scaleIdOf,
} from "./WardNeeds";

const CODES = [
  { id: "M", code: "M", counts: "morning", color: "#F6C48A" }, { id: "A", code: "A", counts: "afternoon" },
  { id: "E", code: "E", counts: "evening" }, { id: "N", code: "N", counts: "night" },
  { id: "OFF", code: "OFF", counts: "off" }, { id: "NOFF", code: "(N)OFF", counts: "off" },
];
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const people = (n) => [...Array(n)].map((_, i) => ({ id: `r${i}`, name: `Nurse ${i}`, leavePeriods: [] }));
const rota = (rosterRules, codes = CODES) => ({
  staff: people(15), codes, cells: {}, cellMeta: {}, nonOfficial: [], dutyRequests: [], fridayRule: false,
  ...(rosterRules === undefined ? {} : { rosterRules }),
});
const clone = (x) => JSON.parse(JSON.stringify(x));

const T = { lagoon: "#0F8B7E", ink: "#142B33", inkSoft: "#4A6570", line: "#DCE8E6", mist: "#EEF4F3", coral: "#E4604E", sand: "#C9A15A" };
const Card = ({ children }) => <div>{children}</div>;
const Btn = ({ children, kind, small, ...rest }) => <button {...rest}>{children}</button>;
const Field = ({ label, children }) => <label>{label}{children}</label>;

/* The screen as the app wires it: update() hands each edit a fresh copy, and
   the rota's Undo history watches it. Every write is counted. */
let h = {};
function Ward({ start }) {
  const [data, setData] = useState(null);
  const [deptId, setDeptId] = useState(null);
  const history = useRotaHistory(data, setData, deptId);
  const update = (fn) => { h.writes += 1; setData((d) => fn(clone(d))); };
  h = { ...h, data, history, open: () => { setData(null); setDeptId("d1"); setTimeout(() => setData(start), 0); } };
  if (!data) return <div>Loading rota…</div>;
  return (
    <SmartRosterTab deptId="d1" data={data} update={update} staffEditable T={T} Card={Card} Btn={Btn} Field={Field}
      inputStyle={{}} th={{}} td={{}} uid={() => "u1"} dstr={iso} onApplied={() => {}} />
  );
}
const openWard = async (start) => {
  h = { writes: 0 };
  render(<Ward start={start} />);
  act(() => { h.open(); });
  await screen.findByRole("heading", { name: "Who's needed on each shift" });
  return start;
};

const shown = (label) => screen.getByLabelText(label).textContent;
const picked = (label) => { const s = screen.getByLabelText(label); return s.options[s.selectedIndex].text; };
const press = (label, which, times = 1) => {
  for (let i = 0; i < times; i++) fireEvent.click(screen.getByLabelText(`${label}: one ${which}`));
};
const choose = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const openFollow = () => fireEvent.click(screen.getByRole("button", { name: /What may follow what/ }));
// The card "What may follow what" sits in: its own Add, not the personal rules one.
const followCard = () => within(screen.getByRole("button", { name: /What may follow what/ }).parentElement);

/* ── The pure pieces ── */
describe("In a row", () => {
  test("the seven options, and what each one means", () => {
    expect(IN_ROW.map((o) => [o.label, o.fewest, o.most])).toEqual([
      ["Any pattern", null, 99], ["Never 2 in a row", null, 1], ["Up to 2 in a row", null, 2],
      ["In pairs (2 together)", 2, 2], ["2 or 3 together", 2, 3],
      ["Up to 3 in a row", null, 3], ["Up to 4 in a row", null, 4],
    ]);
  });

  test("a fewest that is empty, missing or 1 asks for nothing, so it matches an option without one", () => {
    expect(inRowOf(undefined, 2).id).toBe("upto2");
    expect(inRowOf(null, 3).id).toBe("upto3");
    expect(inRowOf(1, 99).id).toBe("any");
    expect(inRowOf(2, 2).id).toBe("pairs");
    expect(inRowOf(2, 3).id).toBe("two3");
  });

  test("anything else is Custom, said as it is", () => {
    expect(inRowOf(3, 2)).toBeNull();
    expect(inRowOf(null, 5)).toBeNull();
    expect(inRowOf(2, 99)).toBeNull();
    expect(inRowOf(null, null)).toBeNull();
    expect(customInRow(3, 2)).toBe("Custom (fewest 3, most 2)");
    expect(customInRow(undefined, 5)).toBe("Custom (fewest –, most 5)");
    expect(customInRow(1, 5)).toBe("Custom (fewest 1, most 5)");
    expect(customInRow(2, 99)).toBe("Custom (fewest 2, most no limit)");
  });

  test("picking an option writes only the box that changes, and nothing for the option already chosen", () => {
    const rules = mergeRules({});
    const by = (id) => IN_ROW.find((o) => o.id === id);
    expect(inRowPatch(rules, "night", by("upto2"))).toEqual({});
    expect(inRowPatch(rules, "night", by("pairs"))).toEqual({ blockTogether: { night: 2 } });
    expect(inRowPatch(rules, "morning", by("any"))).toEqual({ blockDays: { ...rules.blockDays, morning: 99 } });
    // A fewest of 1 already asks for nothing: it is left as it is.
    const one = mergeRules({ blockTogether: { night: 1 } });
    expect(inRowPatch(one, "night", by("upto3"))).toEqual({ blockDays: { ...one.blockDays, night: 3 } });
    // From a pair back to a single option: the fewest is emptied, as the old box emptied it.
    const pair = mergeRules({ blockTogether: { night: 2 } });
    expect(inRowPatch(pair, "night", by("upto2"))).toEqual({ blockTogether: { night: null } });
  });
});

describe("the strength scale", () => {
  test("a saved strength sits in its column; a priority outside 1–4 sits where the engine puts it", () => {
    expect(levelOf(undefined)).toBe("must");
    expect(levelOf({ state: "hard", priority: 3 })).toBe("must");
    expect(levelOf({ state: "soft" })).toBe("soft2");
    expect(levelOf({ state: "soft", priority: 5 })).toBe("soft4");
    expect(levelOf({ state: "soft", priority: 0 })).toBe("soft1");
    expect(levelOf({ state: "disabled", priority: 4 })).toBe("ignore");
    expect(scaleIdOf({ state: "soft", priority: 5 })).toBe("soft5");
  });
});

describe("what may follow what, as sentences", () => {
  test("every kind of rule reads as a sentence", () => {
    expect(followText({ type: "never", after: "night", then: "morning" })).toBe("Never give Morning after Night");
    expect(followText({ type: "must", after: "night", then: "off" })).toBe("Always give an off day after Night");
    expect(followText({ type: "prefer", after: "night", then: "night" })).toBe("Prefer Night after Night");
    expect(followText({ type: "can", after: "off", then: "night" })).toBe("Night may follow an off day");
    expect(followText({ type: "never", after: "evening", then: "morning", enabled: false }))
      .toBe("Never give Morning after Evening (switched off)");
  });
});

describe("what usually gives way first", () => {
  test("each rule in the column of its saved level; Must always holds what is never traded away", () => {
    const rules = mergeRules({
      weeklyMax: { night: 2 },
      ruleStates: {
        "weeklyCaps:night": { state: "soft", priority: 5 }, offMin: { state: "disabled", priority: 1 },
        sequence: { state: "soft", priority: 3 },
      },
      personRules: [
        { id: "a", staffId: "r0", type: "atMost", shift: "night", count: 1, strength: "soft" },
        { id: "b", staffId: "r1", type: "offOn", days: [5], strength: "hard" },
      ],
    });
    expect(givesWay(rules)).toEqual({
      columns: {
        soft4: ["People's own Try rules", "Most Nights a week", "In a row, and working days in a row"],
        soft3: ["What may follow what"],
        soft2: [],
        soft1: [],
        must: ["Staff numbers", "Working days (most)", "Approved duty requests", "People's own Must rules", "Most off days"],
      },
      off: ["Fewest off days"],
    });
  });

  test("only what is set: a shift with no most, or a ward with no rules for what may follow what, has nothing to bend", () => {
    const { columns } = givesWay(mergeRules({ sequenceRules: [], weeklyDuties: { max: null } }));
    const all = Object.values(columns).flat();
    expect(all).not.toContain("What may follow what");
    expect(all.some((t) => /^Most (Morning|Afternoon|Night)s a week$/.test(t))).toBe(false);
    expect(all).not.toContain("Working days (most)");
  });
});

/* ── A ward opens showing what it saved, and opening writes nothing ── */
describe("round trip: saved settings open as they were, and nothing is written", () => {
  test("a ward that never set anything: the defaults", async () => {
    const start = await openWard(rota(undefined));
    expect([shown("Morning: at least"), shown("Morning: at most"), shown("Morning: seniors, at least")]).toEqual(["2", "3", "0"]);
    expect([shown("Night: at least"), shown("Night: at most")]).toEqual(["1", "2"]);
    // Evening is 0 and 0 by default: one quiet line, not a card of zeros.
    expect(screen.queryByLabelText("Evening: at least")).toBeNull();
    expect(screen.getByText("Evening: not run on this ward.")).toBeInTheDocument();
    expect([shown("Each person: Morning, at least"), shown("Each person: Morning, at most")]).toEqual(["1", "No limit"]);
    expect([shown("Each person: off days, at least"), shown("Each person: off days, at most")]).toEqual(["1", "2"]);
    expect(screen.queryByLabelText("Each person: Evening, at least")).toBeNull();
    expect([picked("Morning: in a row"), picked("Night: in a row")]).toEqual(["Up to 3 in a row", "Up to 2 in a row"]);
    expect(picked("Morning: if it can't all fit")).toBe("Must — never break");
    expect(picked("Off days: if it can't all fit")).toBe("Must — never break");
    expect(shown("Working days")).toBe("5");
    expect(shown("Working days in a row, at most")).toBe("5");
    expect(picked("Working days in a row: if it can't all fit")).toBe("Bend first");
    expect(picked(/^Look back at past duties/)).toBe("Last 30 days");
    expect(screen.getByRole("button", { name: /What may follow what/ })).toHaveTextContent("5 rules · Must");
    expect(h.writes).toBe(0);
    expect(h.data).toBe(start);
  });

  test("the defaults, saved", async () => {
    const start = await openWard(rota(clone(DEFAULT_RULES)));
    expect(shown("Morning: at least")).toBe("2");
    expect(picked("Night: in a row")).toBe("Up to 2 in a row");
    expect(h.writes).toBe(0);
    expect(h.data).toBe(start);
  });

  test("In a row values that match no option show as Custom", async () => {
    const start = await openWard(rota({
      blockTogether: { morning: 1, afternoon: 2, night: 3 },
      blockDays: { morning: 5, afternoon: 99, evening: 3, night: 2 },
    }));
    expect(picked("Morning: in a row")).toBe("Custom (fewest 1, most 5)");
    expect(picked("Afternoon: in a row")).toBe("Custom (fewest 2, most no limit)");
    expect(picked("Night: in a row")).toBe("Custom (fewest 3, most 2)");
    expect(h.writes).toBe(0);
    expect(h.data).toBe(start);
  });

  test("working days with a different fewest and most show as Custom, with both numbers", async () => {
    const start = await openWard(rota({ weeklyDuties: { min: 4, max: 5 } }));
    expect(screen.getByText("— Custom")).toBeInTheDocument();
    expect(screen.queryByLabelText("Working days")).toBeNull();
    expect([shown("Working days, fewest"), shown("Working days, most")]).toEqual(["4", "5"]);
    expect(h.writes).toBe(0);
    expect(h.data).toBe(start);
  });

  test("working days with no fewest, and with no limits at all", async () => {
    await openWard(rota({ weeklyDuties: { min: null, max: 6 } }));
    expect([shown("Working days, fewest"), shown("Working days, most")]).toEqual(["0", "6"]);
    expect(h.writes).toBe(0);
  });

  test("empty maximums, a priority of 5, a Custom look-back, Evening run, and rules of other kinds", async () => {
    const start = await openWard(rota({
      coverage: { afternoon: { min: 2, max: null }, evening: { min: 1, max: 1 } },
      weeklyMax: { morning: 3 },
      ruleStates: { "weeklyCaps:night": { state: "soft", priority: 5 } },
      lookbackDays: 28,
      sequenceRules: [
        { id: "a", type: "prefer", after: "night", then: "night" },
        { id: "b", type: "never", after: "evening", then: "morning", enabled: false },
      ],
    }));
    expect(shown("Afternoon: at most")).toBe("No limit");
    expect([shown("Evening: at least"), shown("Evening: at most")]).toEqual(["1", "1"]);
    expect(shown("Each person: Evening, at least")).toBe("1");
    expect(shown("Each person: Morning, at most")).toBe("3");
    expect(picked("Night: if it can't all fit")).toBe("Bend (P5)");
    expect(picked(/^Look back at past duties/)).toBe("Custom (28 days)");
    openFollow();
    expect(screen.getByText("Prefer Night after Night")).toBeInTheDocument();
    expect(screen.getByText("Never give Morning after Evening (switched off)")).toBeInTheDocument();
    expect(h.writes).toBe(0);
    expect(h.data).toBe(start);
  });

  test("the entire roster", async () => {
    await openWard(rota({ lookbackDays: LOOK_BACK_ALL }));
    expect(picked(/^Look back at past duties/)).toBe("The entire roster");
    expect(screen.getByText(/since the roster began/)).toBeInTheDocument();
  });
});

/* ── Each control writes what the old box wrote, and one Undo takes it back ──
   Every write goes through setRules, which lays the change over the
   settings as they stand — so what the old box wrote is that same thing:
   the merged settings with the one key changed.                         */
const was = (patch) => {
  const rules = mergeRules({});
  return JSON.stringify({ ...rules, ...patch(rules) });
};
const CONTROLS = [
  ["Morning at least +", () => press("Morning: at least", "more"),
    (r) => ({ coverage: { ...r.coverage, morning: { ...r.coverage.morning, min: 3 } } })],
  ["Morning at most −", () => press("Morning: at most", "fewer"),
    (r) => ({ coverage: { ...r.coverage, morning: { ...r.coverage.morning, max: 2 } } })],
  ["Morning in-charge +", () => press("Morning: seniors, at least", "more"),
    (r) => ({ seniorCover: { ...r.seniorCover, morning: 1 } })],
  ["each person, Night at least +", () => press("Each person: Night, at least", "more"),
    (r) => ({ weeklyMin: { ...r.weeklyMin, night: 2 } })],
  ["each person, Morning at most − from No limit", () => press("Each person: Morning, at most", "fewer"),
    (r) => ({ weeklyMax: { ...r.weeklyMax, morning: 7 } })],
  ["each person, off days at most +", () => press("Each person: off days, at most", "more"),
    (r) => ({ weeklyMax: { ...r.weeklyMax, off: 3 } })],
  ["each person, off days at least −", () => press("Each person: off days, at least", "fewer"),
    (r) => ({ weeklyMin: { ...r.weeklyMin, off: 0 } })],
  ["Night in pairs", () => choose("Night: in a row", "pairs"),
    () => ({ blockTogether: { night: 2 } })],
  ["Morning any pattern", () => choose("Morning: in a row", "any"),
    (r) => ({ blockDays: { ...r.blockDays, morning: 99 } })],
  ["Night most, bend if needed", () => choose("Night: if it can't all fit", "soft3"),
    (r) => ({ ruleStates: { ...r.ruleStates, "weeklyCaps:night": { state: "soft", priority: 3 } } })],
  ["off days, ignore", () => choose("Off days: if it can't all fit", "ignore"),
    (r) => ({ ruleStates: { ...r.ruleStates, offMin: { state: "disabled", priority: 1 } } })],
  ["working days −", () => press("Working days", "fewer"),
    (r) => ({ weeklyDuties: { ...r.weeklyDuties, min: 4, max: 4 } })],
  ["working days in a row +", () => press("Working days in a row, at most", "more"),
    () => ({ maxDaysOn: 6 })],
  ["working pattern, protect most", () => choose("Working days in a row: if it can't all fit", "soft1"),
    (r) => ({ ruleStates: { ...r.ruleStates, workPattern: { state: "soft", priority: 1 } } })],
  ["look back 90 days", () => choose(/^Look back at past duties/, "90"),
    () => ({ lookbackDays: 90 })],
  ["remove a rule for what may follow what", () => { openFollow(); fireEvent.click(screen.getByLabelText("Remove: Never give Morning after Night")); },
    (r) => ({ sequenceRules: r.sequenceRules.filter((x) => x.id !== "d1") })],
  ["add a rule for what may follow what", () => {
    openFollow();
    choose("Never or always", "must"); choose("This duty", "off"); choose("After this duty", "night");
    fireEvent.click(followCard().getByRole("button", { name: /^Add$/ }));
  }, (r) => ({ sequenceRules: [...r.sequenceRules, { id: "u1", type: "must", after: "night", then: "off" }] })],
  ["reset what may follow what", () => { openFollow(); fireEvent.click(screen.getByRole("button", { name: "Reset to the usual rules" })); },
    () => ({ sequenceRules: DEFAULT_RULES.sequenceRules })],
  ["what may follow what, bend first", () => { openFollow(); choose("What may follow what: if it can't all fit", "soft4"); },
    (r) => ({ ruleStates: { ...r.ruleStates, sequence: { state: "soft", priority: 4 } } })],
];

describe("each control writes exactly what the old box wrote, in one Undo step", () => {
  test.each(CONTROLS)("%s", async (_name, act_, patch) => {
    const start = await openWard(rota(undefined));
    const before = JSON.stringify(h.data);
    act_();
    expect(h.writes).toBe(1);
    expect(JSON.stringify(h.data.rosterRules)).toBe(was(patch));
    // Nothing outside the settings moved.
    expect(JSON.stringify({ ...h.data, rosterRules: undefined })).toBe(JSON.stringify({ ...start, rosterRules: undefined }));
    expect(h.history.depth).toBe(1);
    act(() => { h.history.undo(); });
    expect(JSON.stringify(h.data)).toBe(before);
  });
});

describe("the shift cards", () => {
  test("Turn on shows the card and writes nothing; the first number changed is what is saved", async () => {
    const start = await openWard(rota(undefined));
    fireEvent.click(screen.getByRole("button", { name: "Turn on Evening" }));
    expect([shown("Evening: at least"), shown("Evening: at most")]).toEqual(["0", "0"]);
    expect(h.writes).toBe(0);
    expect(h.data).toBe(start);
    press("Evening: at most", "more");
    expect(h.data.rosterRules.coverage.evening).toEqual({ min: 0, max: 1 });
    // Now run: it has a row in each person's week.
    expect(shown("Each person: Evening, at least")).toBe("1");
  });

  test("a shift with no duty code and nothing saved is not shown; one with a number saved always is", async () => {
    const noEvening = CODES.filter((c) => c.counts !== "evening");
    await openWard(rota(undefined, noEvening));
    expect(screen.queryByText("Evening: not run on this ward.")).toBeNull();
    expect(screen.queryByLabelText("Evening: at least")).toBeNull();
    expect(screen.queryByLabelText("Each person: Evening, at least")).toBeNull();
  });

  test("…and with a number saved but no code, it is a card", async () => {
    const noEvening = CODES.filter((c) => c.counts !== "evening");
    await openWard(rota({ coverage: { evening: { min: 1, max: 2 } } }, noEvening));
    expect(shown("Evening: at least")).toBe("1");
  });

  test("an empty most shows No limit: − sets it to the at least, + stays off", async () => {
    await openWard(rota({ coverage: { afternoon: { min: 2, max: null } } }));
    expect(screen.getByLabelText("Afternoon: at most: one more")).toBeDisabled();
    press("Afternoon: at most", "fewer");
    expect(h.data.rosterRules.coverage.afternoon).toEqual({ min: 2, max: 2 });
    expect(shown("Afternoon: at most")).toBe("2");
  });

  test("the in-charge number is off while nobody is needed on the shift, as before", async () => {
    await openWard(rota(undefined));
    fireEvent.click(screen.getByRole("button", { name: "Turn on Evening" }));
    expect(screen.getByLabelText("Evening: seniors, at least: one more")).toBeDisabled();
    expect(screen.getByLabelText("Morning: seniors, at least: one more")).not.toBeDisabled();
  });

  test("the ward's own word, everywhere it is said", async () => {
    await openWard(rota({ seniorTerm: "Shift Manager" }));
    expect(shown("Morning: shift managers, at least")).toBe("0");
    expect(screen.getAllByText("Shift Managers, at least")).toHaveLength(3);
  });
});

describe("each person's week", () => {
  test("a most goes from 7 to No limit and back, and No limit saves as empty", async () => {
    await openWard(rota({ weeklyMax: { night: 7 } }));
    press("Each person: Night, at most", "more");
    expect(h.data.rosterRules.weeklyMax.night).toBeNull();
    expect(shown("Each person: Night, at most")).toBe("No limit");
    expect(screen.getByLabelText("Each person: Night, at most: one more")).toBeDisabled();
    press("Each person: Night, at most", "fewer");
    expect(h.data.rosterRules.weeklyMax.night).toBe(7);
  });

  test("Custom In a row is kept until another option is picked", async () => {
    await openWard(rota({ blockTogether: { night: 3 }, blockDays: { night: 2 } }));
    expect(picked("Night: in a row")).toBe("Custom (fewest 3, most 2)");
    choose("Night: in a row", "two3");
    expect(h.data.rosterRules.blockTogether).toEqual({ night: 2 });
    expect(h.data.rosterRules.blockDays.night).toBe(3);
    expect(picked("Night: in a row")).toBe("2 or 3 together");
    // Custom is gone once nothing saved needs it.
    expect(screen.getByLabelText("Night: in a row").querySelector('option[value="custom"]')).toBeNull();
  });

  test("Custom working days: each number writes its own key; once they agree, one number writes both", async () => {
    await openWard(rota({ weeklyDuties: { min: 4, max: 6 } }));
    press("Working days, most", "fewer");
    expect(h.data.rosterRules.weeklyDuties).toEqual({ min: 4, max: 5 });
    press("Working days, fewest", "more");
    expect(h.data.rosterRules.weeklyDuties).toEqual({ min: 5, max: 5 });
    expect(shown("Working days")).toBe("5");
    press("Working days", "more");
    expect(h.data.rosterRules.weeklyDuties).toEqual({ min: 6, max: 6 });
  });

  test("working days carries a fixed Must, and working days in a row says what it shares", async () => {
    await openWard(rota(undefined));
    expect(within(screen.getByText("Working days").parentElement).getByText("Must")).toBeInTheDocument();
    expect(screen.getByText("Shared with In a row on every shift.")).toBeInTheDocument();
  });

  test("off days are spread apart, and their box covers at least", async () => {
    await openWard(rota(undefined));
    expect(screen.getByText("Spread apart")).toBeInTheDocument();
    expect(screen.getByText(/The box for off days covers "at least"\. The most off days is always held\./)).toBeInTheDocument();
  });
});

describe("the columns on the screen", () => {
  test("built from the saved strengths, and change as soon as one does", async () => {
    await openWard(rota({ weeklyMax: { night: 2 } }));
    const column = (name) => within(screen.getByRole("region", { name })).queryAllByText(/./).map((n) => n.textContent);
    expect(column("Must")).toEqual(expect.arrayContaining(["Staff numbers", "Working days (most)", "Approved duty requests", "Most Nights a week", "Most off days", "What may follow what"]));
    expect(column("Bend first")).toEqual(expect.arrayContaining(["In a row, and working days in a row"]));
    choose("Night: if it can't all fit", "soft3");
    expect(column("Bend if needed")).toContain("Most Nights a week");
    expect(column("Must")).not.toContain("Most Nights a week");
    choose("Off days: if it can't all fit", "ignore");
    expect(screen.getByText("Switched off: Fewest off days.")).toBeInTheDocument();
    expect(screen.getByText("Always aimed for, but not promised: fewest of each shift, fewest working days.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "When it can't all fit, what usually gives way first" })).toBeInTheDocument();
  });
});

describe("what may follow what", () => {
  test("folded away to begin with, the count and level in its header", async () => {
    await openWard(rota(undefined));
    const header = screen.getByRole("button", { name: /What may follow what/ });
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Never give Morning after Night")).toBeNull();
    openFollow();
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Never give Morning after Night")).toBeInTheDocument();
  });

  test("an identical rule is not added twice", async () => {
    await openWard(rota(undefined));
    openFollow();
    // The builder starts on "Never give Morning after Night", which is already a rule.
    expect(followCard().getByRole("button", { name: /^Add$/ })).toBeDisabled();
    expect(screen.getByText("That rule is already on the list.")).toBeInTheDocument();
    choose("This duty", "evening");
    expect(followCard().getByRole("button", { name: /^Add$/ })).toBeDisabled();
    choose("After this duty", "afternoon");
    expect(followCard().getByRole("button", { name: /^Add$/ })).not.toBeDisabled();
    fireEvent.click(followCard().getByRole("button", { name: /^Add$/ }));
    expect(screen.getByText("Never give Evening after Afternoon")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /What may follow what/ })).toHaveTextContent("6 rules · Must");
  });
});

describe("on a view-only rota", () => {
  test("everything is shown and nothing can be changed", () => {
    function ViewOnly() {
      return (
        <SmartRosterTab deptId="d1" data={rota(undefined)} update={() => { throw new Error("no writes"); }}
          staffEditable={false} T={T} Card={Card} Btn={Btn} Field={Field}
          inputStyle={{}} th={{}} td={{}} uid={() => "u1"} dstr={iso} onApplied={() => {}} />
      );
    }
    render(<ViewOnly />);
    expect(shown("Morning: at least")).toBe("2");
    expect(screen.getByLabelText("Morning: at least: one more")).toBeDisabled();
    expect(screen.getByLabelText("Morning: in a row")).toBeDisabled();
    expect(screen.getByLabelText("Morning: if it can't all fit")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Turn on Evening" })).toBeDisabled();
  });
});
