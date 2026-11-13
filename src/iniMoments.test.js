/* Ini's moments: what Ini says unasked, when, how often, and Quiet Ini.
   Time is set by hand (fake timers); localStorage is cleared after each
   test (setupTests.js). */

import React, { useState } from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import {
  MESSAGES, messageFor, weekMoment, firstOfMonth, arrivalMoment, tell, useIniMoments, setQuiet, isQuiet,
  resetMoments, GAP_MS, BUBBLE_MS,
} from "./iniMoments";
import IniMascot from "./IniMascot";
import { AskIniBar } from "./IniBuddy";
import SmartRosterTab from "./SmartRosterTab";

const T = { lagoon: "#0F8B7E", ink: "#142B33", inkSoft: "#4A6570", line: "#DCE8E6", mist: "#EEF4F3", coral: "#E4604E", sand: "#C9A15A" };
const reduceMotion = (on) => {
  window.matchMedia = (q) => ({ matches: on && /reduce/.test(q), media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
};
beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date(2026, 10, 18, 14, 0)); });   // a Wednesday afternoon
afterEach(() => { resetMoments(); delete window.matchMedia; jest.useRealTimers(); });

// One Ini listening, showing what it says and does.
function Ini({ userId = "u1", priority = 1, label = "ini" }) {
  const m = useIniMoments({ userId, priority });
  return <div data-testid={label} data-act={m.act ? `${m.act.name}#${m.act.n}` : ""}>{m.bubble || ""}</div>;
}
const said = (label = "ini") => screen.getByTestId(label).textContent;
const did = (label = "ini") => screen.getByTestId(label).getAttribute("data-act");

describe("what Ini says", () => {
  test("each moment's lines in turn, including the new ones", () => {
    expect(MESSAGES.covered).toContain("Everyone placed, nobody grumpy. That's the dream.");
    expect(MESSAGES.tricky).toContain("That one made my blob wobble. But it fits!");
    expect(MESSAGES.late).toContain("Even I'm sleepy, and I'm a blob.");
    expect(MESSAGES.returning).toContain("I missed you! The roster missed you too.");
    expect(MESSAGES.morning).toEqual(["Good morning! Coffee first, roster second?", "Morning! Let's make today's roster painless."]);
    expect([1, 2, 3].map(() => messageFor("fixed"))).toEqual([
      "Fixed! The numbers add up now.", "There we go — everything fits again.", "Fixed! The numbers add up now.",
    ]);
    expect(messageFor("firstOfMonth", { month: "December" })).toBe("First roster of December! Fresh month, fresh start.");
  });

  test("gone wrong: plain help, said the same way each time", () => {
    expect(messageFor("gaps", { n: 1 })).toBe("1 shift still needs someone. The notes under the week say why.");
    expect(messageFor("gaps", { n: 2 })).toBe("2 shifts still need someone. The notes under the week say why.");
    expect(messageFor("mustMissed", { n: 1 })).toBe("One person's Must couldn't be kept this week. The details are under the week.");
  });

  test("the moment a finished week is", () => {
    const week = (x) => ({ shortfalls: [], relaxations: [], seniorGaps: [], budget: [{ spare: 4 }], ...x });
    expect(weekMoment(week({ shortfalls: [{ needed: 2 }, {}] }))).toEqual({ moment: "gaps", n: 3 });
    expect(weekMoment(week({ relaxations: [{ personal: true, strength: "hard", staffId: "a", rule: "r" }, { personal: true, strength: "soft" }] })))
      .toEqual({ moment: "mustMissed", n: 1 });
    expect(weekMoment(week({ seniorGaps: [{}] }))).toBeNull();
    expect(weekMoment(week({ budget: [{ spare: 1 }] }))).toEqual({ moment: "tricky" });
    expect(weekMoment(week())).toEqual({ moment: "covered" });
  });

  test("the first roster of a month, once per month and department", () => {
    expect(firstOfMonth("d1", "2026-12-07")).toBe("December");
    expect(firstOfMonth("d1", "2026-12-14")).toBeNull();
    expect(firstOfMonth("d2", "2026-12-14")).toBe("December");
    expect(firstOfMonth("d1", "2027-01-04")).toBe("January");
  });
});

describe("arriving", () => {
  const at = (y, m, d, h) => new Date(y, m, d, h, 0);
  test("the first visit of the day before 10:00, then nothing more that day", () => {
    expect(arrivalMoment("u1", at(2026, 10, 18, 8))).toBe("morning");
    expect(arrivalMoment("u1", at(2026, 10, 18, 9))).toBeNull();
  });
  test("a Friday, once; working late, once a night", () => {
    expect(arrivalMoment("u1", at(2026, 10, 20, 14))).toBe("friday");
    expect(arrivalMoment("u1", at(2026, 10, 20, 15))).toBeNull();
    expect(arrivalMoment("u1", at(2026, 10, 20, 23))).toBe("late");
    expect(arrivalMoment("u1", at(2026, 10, 20, 23))).toBeNull();
  });
  test("back after 7 days or more comes first; each person is their own", () => {
    arrivalMoment("u1", at(2026, 10, 1, 14));
    expect(arrivalMoment("u1", at(2026, 10, 9, 8))).toBe("returning");
    expect(arrivalMoment("u2", at(2026, 10, 9, 8))).toBe("morning");
  });
  test("said by the Ini on screen a moment after it appears, once per page load", () => {
    jest.setSystemTime(new Date(2026, 10, 18, 8, 30));
    render(<Ini />);
    act(() => { jest.advanceTimersByTime(1600); });
    expect(MESSAGES.morning).toContain(said());
    expect(did()).toBe("wave#1");
  });
});

describe("how often, and one at a time", () => {
  test("a bubble goes by itself, and the next unasked one waits 4 minutes; the move still plays", () => {
    render(<Ini />);
    act(() => { tell("fixed"); });
    expect(said()).toBe("Fixed! The numbers add up now.");
    act(() => { jest.advanceTimersByTime(BUBBLE_MS); });
    expect(said()).toBe("");
    act(() => { tell("covered"); });
    expect([said(), did()]).toEqual(["", "dance#2"]);
    act(() => { jest.advanceTimersByTime(GAP_MS); });
    act(() => { tell("covered"); });
    expect(MESSAGES.covered).toContain(said());
  });

  test("gone wrong: help in words, and no dance", () => {
    render(<Ini />);
    act(() => { tell("gaps", { n: 2 }); });
    expect([said(), did()]).toEqual(["2 shifts still need someone. The notes under the week say why.", ""]);
  });

  test("the Ini with the higher priority says it; the other stays still", () => {
    render(<><Ini label="button" priority={1} /><Ini label="bar" priority={2} /></>);
    act(() => { tell("fixed"); });
    expect([said("bar"), said("button"), did("button")]).toEqual(["Fixed! The numbers add up now.", "", ""]);
  });

  test("ten minutes with nothing done: a yawn, no words", () => {
    render(<Ini />);
    act(() => { jest.advanceTimersByTime(10 * 60 * 1000); });
    expect([said(), did()]).toEqual(["", "yawn#1"]);
  });
});

describe("Quiet Ini", () => {
  test("no unasked words and no moves, for that person only", () => {
    setQuiet("u1", true);
    render(<><Ini userId="u1" label="quiet" priority={2} /></>);
    act(() => { tell("covered"); });
    expect([said("quiet"), did("quiet")]).toEqual(["", ""]);
    expect(isQuiet("u2")).toBe(false);
  });

  test("the switch on the bar is remembered per person, and taps are still answered", () => {
    reduceMotion(true);
    const { unmount } = render(<AskIniBar onAsk={jest.fn()} T={T} userId="u1" />);
    const quiet = screen.getByRole("button", { name: /Quiet Ini/ });
    expect(quiet).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(quiet);
    expect(quiet).toHaveAttribute("aria-pressed", "true");
    // Hovering says nothing now; a tap still gets a tip.
    fireEvent.pointerEnter(screen.getByRole("button", { name: "Ini: tap for a tip" }));
    expect(screen.queryByText("Hi! Need a hand?")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Ini: tap for a tip" }));
    expect(screen.getByText(/three steps above are always open/)).toBeInTheDocument();
    unmount();
    render(<AskIniBar onAsk={jest.fn()} T={T} userId="u1" />);
    expect(screen.getByRole("button", { name: /Quiet Ini/ })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("Ini's moves", () => {
  const outer = () => screen.getByRole("img").firstElementChild.nextElementSibling;
  test("a move plays once, with a little arm for a wave, and the yawn has its face", () => {
    reduceMotion(false);
    const { rerender } = render(<IniMascot act={{ name: "wave", n: 1 }} />);
    expect(outer().getAttribute("style")).toMatch(/iniActWave/);
    expect(screen.getByRole("img").querySelectorAll("ellipse[cx='172']")).toHaveLength(1);
    act(() => { jest.advanceTimersByTime(1600); });
    expect(outer().getAttribute("style") || "").not.toMatch(/iniAct/);
    rerender(<IniMascot act={{ name: "yawn", n: 2 }} />);
    expect(screen.getByRole("img")).toHaveAttribute("aria-label", "Ini, yawning");
  });

  test("with reduce motion nothing moves, and the face stays as it is", () => {
    reduceMotion(true);
    render(<IniMascot act={{ name: "yawn", n: 1 }} />);
    expect(outer().getAttribute("style") || "").not.toMatch(/iniAct/);
    expect(screen.getByRole("img")).toHaveAttribute("aria-label", "Ini, listening");
  });
});

describe("on Smart Roster", () => {
  const Card = ({ children }) => <div>{children}</div>;
  const Btn = ({ children, kind, small, ...rest }) => <button {...rest}>{children}</button>;
  const Field = ({ label, children }) => <label>{label}{children}</label>;
  function Ward() {
    const [data, setData] = useState(() => ({
      staff: [...Array(15)].map((_, i) => ({ id: `s${i}`, name: `S${i}`, leavePeriods: [] })),
      codes: [{ id: "M", code: "M", counts: "morning" }, { id: "A", code: "A", counts: "afternoon" }, { id: "N", code: "N", counts: "night" }, { id: "O", code: "OFF", counts: "off" }],
      cells: {}, cellMeta: {}, nonOfficial: [], dutyRequests: [], fridayRule: false,
      rosterRules: { coverage: { morning: { min: 4, max: 4 }, afternoon: { min: 4, max: 4 }, night: { min: 2, max: 2 } } },
    }));
    const update = (fn) => setData((d) => fn(JSON.parse(JSON.stringify(d))));
    return (
      <SmartRosterTab deptId="d1" data={data} update={update} staffEditable T={T} Card={Card} Btn={Btn} Field={Field}
        inputStyle={{}} th={{}} td={{}} uid={() => "u"} dstr={(d) => d.toISOString().slice(0, 10)} onApplied={() => {}}
        onAskIni={jest.fn()} userId="u1" />
    );
  }

  test("Fix it for me: the bar's Ini says so", () => {
    reduceMotion(true);
    render(<Ward />);
    fireEvent.click(screen.getByRole("button", { name: /Fix it for me/ }));
    expect(screen.getByText("Fixed! The numbers add up now.")).toBeInTheDocument();
  });
});
