/* Ini on Smart Roster's "Ask Ini" bar: the note goes to the Ini panel and is
   read straight away; Ini's face follows what is happening; a hover says
   hello once; taps give tips, and five quick taps a spin; with "reduce
   motion" nothing moves. The database and the AI are stand-ins. */

import React, { useState } from "react";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { AskIniBar, IniBuddy, barMood, TIPS } from "./IniBuddy";
import AssistantPanel from "./AssistantPanel";
import SmartRosterTab from "./SmartRosterTab";

jest.mock("./supabaseClient", () => ({
  __esModule: true,
  default: {
    rpc: () => Promise.resolve({ data: { ok: true, cap: 20, used: 1, remaining: 19 }, error: null }),
    auth: { getSession: () => Promise.resolve({ data: { session: { access_token: "t" } } }) },
  },
}));
jest.mock("./monthBuildRunner", () => ({ startMonthBuild: jest.fn() }));

const T = { lagoon: "#0F8B7E", ink: "#142B33", inkSoft: "#4A6570", line: "#DCE8E6", mist: "#EEF4F3", coral: "#E4604E", sand: "#C9A15A" };
const face = () => screen.getByRole("img", { name: /^Ini, / }).getAttribute("aria-label");
const reduceMotion = (on) => {
  window.matchMedia = (q) => ({ matches: on && /reduce/.test(q), media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
};
afterEach(() => { delete window.matchMedia; jest.useRealTimers(); });

describe("Ini's face on the bar", () => {
  test("asleep, then waking, then listening; thinking and pleased when told", () => {
    expect(barMood({ phase: "asleep", thinking: true })).toBe("resting");
    expect(barMood({ phase: "waking" })).toBe("waking");
    expect(barMood({ phase: "awake" })).toBe("listening");
    expect(barMood({ phase: "awake", thinking: true, celebrating: true })).toBe("thinking");
    expect(barMood({ phase: "awake", celebrating: true })).toBe("done");
  });

  test("on the page: asleep when it opens, awake a moment later", () => {
    jest.useFakeTimers();
    render(<AskIniBar onAsk={jest.fn()} T={T} />);
    expect(face()).toBe("Ini, resting");
    act(() => { jest.advanceTimersByTime(900); });
    expect(face()).toBe("Ini, waking up");
    act(() => { jest.advanceTimersByTime(520); });
    expect(face()).toBe("Ini, listening");
  });

  test("the cursor in the box wakes Ini at once", () => {
    jest.useFakeTimers();
    render(<AskIniBar onAsk={jest.fn()} T={T} />);
    fireEvent.focus(screen.getByLabelText("Ask Ini a question"));
    expect(face()).toBe("Ini, listening");
  });

  test("thinking while a week is made or Ini is busy; pleased when a week is ready", () => {
    reduceMotion(true);
    const { rerender } = render(<AskIniBar onAsk={jest.fn()} thinking T={T} />);
    expect(face()).toBe("Ini, thinking");
    rerender(<AskIniBar onAsk={jest.fn()} celebrating T={T} />);
    expect(face()).toBe("Ini, all done");
  });
});

describe("the bar", () => {
  test("Send hands the note on and empties the box; Enter does the same", () => {
    const onAsk = jest.fn();
    render(<AskIniBar onAsk={onAsk} T={T} />);
    const box = screen.getByLabelText("Ask Ini a question");
    const send = screen.getByRole("button", { name: /Send/ });
    expect(send).toBeDisabled();
    fireEvent.change(box, { target: { value: "  Mariyam is on leave 10th to 15th " } });
    fireEvent.click(send);
    expect(onAsk).toHaveBeenCalledWith("Mariyam is on leave 10th to 15th");
    expect(box).toHaveValue("");
    fireEvent.change(box, { target: { value: "Ali nights 3rd and 4th" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onAsk).toHaveBeenLastCalledWith("Ali nights 3rd and 4th");
  });

  test("where editing is paused, nothing can be sent", () => {
    const onAsk = jest.fn();
    render(<AskIniBar onAsk={onAsk} editable={false} T={T} />);
    expect(screen.getByLabelText("Ask Ini a question")).toBeDisabled();
    expect(screen.getByRole("button", { name: /Send/ })).toBeDisabled();
  });

  test("everything on it can be reached by keyboard, at least 44px", () => {
    render(<AskIniBar onAsk={jest.fn()} T={T} />);
    const ini = screen.getByRole("button", { name: "Ini: tap for a tip" });
    ini.focus();
    expect(document.activeElement).toBe(ini);
    [ini, screen.getByRole("button", { name: /Send/ })].forEach((b) => expect(parseInt(b.style.minHeight, 10)).toBeGreaterThanOrEqual(44));
    expect(parseInt(screen.getByLabelText("Ask Ini a question").style.minHeight, 10)).toBeGreaterThanOrEqual(44);
  });
});

describe("hover and taps", () => {
  const ini = () => screen.getByRole("button", { name: "Ini: tap for a tip" });

  test("a hover lifts and tilts Ini and says hello, once", () => {
    jest.useFakeTimers();
    render(<IniBuddy mood="listening" />);
    fireEvent.pointerOver(ini());
    expect(screen.getByText("Hi! Need a hand?")).toBeInTheDocument();
    expect(ini()).toHaveStyle({ transform: "translateY(-3px) rotate(-6deg)" });
    act(() => { jest.advanceTimersByTime(3000); });
    expect(screen.queryByText("Hi! Need a hand?")).toBeNull();
    fireEvent.pointerOut(ini());
    fireEvent.pointerOver(ini());
    expect(screen.queryByText("Hi! Need a hand?")).toBeNull();
  });

  test("a tap: surprised, a jump, and a tip — the next tip each time", () => {
    jest.useFakeTimers();
    render(<IniBuddy mood="listening" />);
    fireEvent.click(ini());
    expect(face()).toBe("Ini, spotted something");
    expect(ini().style.animation).toMatch(/iniBuddyHop/);
    expect(screen.getByText(TIPS[0])).toBeInTheDocument();
    act(() => { jest.advanceTimersByTime(2000); });
    expect(face()).toBe("Ini, listening");
    fireEvent.click(ini());
    expect(screen.getByText(TIPS[1])).toBeInTheDocument();
  });

  test("five quick taps: a spin, and it tickles", () => {
    jest.useFakeTimers();
    render(<IniBuddy mood="listening" />);
    for (let i = 0; i < 5; i++) { fireEvent.click(ini()); act(() => { jest.advanceTimersByTime(150); }); }
    expect(screen.getByText("Wheee! That tickles!")).toBeInTheDocument();
    expect(ini().style.animation).toMatch(/iniBuddySpin/);
  });

  test("five slow taps are five tips, not a spin", () => {
    jest.useFakeTimers();
    render(<IniBuddy mood="listening" />);
    for (let i = 0; i < 5; i++) { fireEvent.click(ini()); act(() => { jest.advanceTimersByTime(900); }); }
    expect(screen.queryByText("Wheee! That tickles!")).toBeNull();
  });

  test("with reduce motion: no lift, no jump, no spin, no bob — Ini still says it", () => {
    reduceMotion(true);
    render(<AskIniBar onAsk={jest.fn()} T={T} />);
    expect(face()).toBe("Ini, listening");                        // awake at once
    fireEvent.pointerOver(ini());
    expect(ini().style.transform).toBe("");
    expect(screen.getByText("Hi! Need a hand?")).toBeInTheDocument();
    for (let i = 0; i < 5; i++) fireEvent.click(ini());
    expect(ini().style.animation).toBe("");
    expect(screen.getByText("Wheee! That tickles!")).toBeInTheDocument();
    const svg = screen.getByRole("img", { name: /^Ini, / });
    expect(svg.querySelector("g").style.animation).toBe("");
    expect(svg.querySelector("path").style.animation).toBe("");
  });
});

describe("the Ini panel, given a note from the bar", () => {
  const data = {
    staff: [{ id: "a", name: "Ali" }, { id: "m", name: "Mariyam" }],
    codes: [{ id: "M", code: "M", color: "#F4B860", counts: "morning" }],
    cells: {}, nonOfficial: [], dutyRequests: [],
  };
  beforeEach(() => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, actions: [], unclear: [] }) }));
  });

  // As in the app: the panel is there first, and a note arrives later.
  test("reads it straight away, as Read my note does, and saves nothing", async () => {
    const update = jest.fn();
    const onWorking = jest.fn();
    const props = { visible: true, deptId: "d1", data, update, T, uid: () => "u", dstr: (d) => d.toISOString().slice(0, 10), onWorking };
    const { rerender } = render(<AssistantPanel {...props} ask={null} />);
    expect(global.fetch).not.toHaveBeenCalled();
    rerender(<AssistantPanel {...props} ask={{ text: "Ali is on leave 10th to 12th", n: 1 }} />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.text).toBe("Ali is on leave 10th to 12th");
    // The panel is open: the floating button gives way to it.
    expect(screen.queryByRole("button", { name: "Ask Ini" })).toBeNull();
    await waitFor(() => expect(onWorking).toHaveBeenLastCalledWith(false));
    expect(onWorking).toHaveBeenCalledWith(true);
    expect(update).not.toHaveBeenCalled();
  });

  test("a note already there when the panel first appears is not sent again", async () => {
    render(<AssistantPanel visible deptId="d1" data={data} update={jest.fn()} T={T} uid={() => "u"}
      dstr={(d) => d.toISOString().slice(0, 10)} ask={{ text: "old", n: 4 }} />);
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("the same note is read once; a new one is read again", async () => {
    const props = { visible: true, deptId: "d1", data, update: jest.fn(), T, uid: () => "u", dstr: (d) => d.toISOString().slice(0, 10) };
    const { rerender } = render(<AssistantPanel {...props} ask={null} />);
    rerender(<AssistantPanel {...props} ask={{ text: "one", n: 1 }} />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    rerender(<AssistantPanel {...props} ask={{ text: "one", n: 1 }} />);
    rerender(<AssistantPanel {...props} ask={{ text: "two", n: 2 }} />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    expect(JSON.parse(global.fetch.mock.calls[1][1].body).text).toBe("two");
  });
});

describe("on Smart Roster", () => {
  const Card = ({ children }) => <div>{children}</div>;
  const Btn = ({ children, kind, small, ...rest }) => <button {...rest}>{children}</button>;
  const Field = ({ label, children }) => <label>{label}{children}</label>;
  const pad = (n) => String(n).padStart(2, "0");
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  function Ward({ onAskIni }) {
    const [data, setData] = useState(() => ({
      staff: [...Array(15)].map((_, i) => ({ id: `s${i}`, name: `S${i}`, leavePeriods: [] })),
      codes: [{ id: "M", code: "M", counts: "morning" }, { id: "A", code: "A", counts: "afternoon" }, { id: "N", code: "N", counts: "night" }, { id: "O", code: "OFF", counts: "off" }],
      cells: {}, cellMeta: {}, nonOfficial: [], dutyRequests: [], fridayRule: false,
      rosterRules: { coverage: { morning: { min: 4, max: 4 }, afternoon: { min: 4, max: 4 }, night: { min: 2, max: 2 } } },
    }));
    const update = (fn) => setData((d) => fn(JSON.parse(JSON.stringify(d))));
    return (
      <SmartRosterTab deptId="d1" data={data} update={update} staffEditable T={T} Card={Card} Btn={Btn} Field={Field}
        inputStyle={{}} th={{}} td={{}} uid={() => "u"} dstr={iso} onApplied={() => {}} onAskIni={onAskIni} />
    );
  }

  test("the bar is on every step, and only where there is an Ini to send to", () => {
    const { unmount } = render(<Ward />);
    expect(screen.queryByLabelText("Ask Ini a question")).toBeNull();
    unmount();
    const onAskIni = jest.fn();
    render(<Ward onAskIni={onAskIni} />);
    [1, 2, 3].forEach((n) => {
      fireEvent.click(screen.getByRole("button", { name: new RegExp(`^Step ${n},`) }));
      expect(screen.getByLabelText("Ask Ini a question")).toBeInTheDocument();
    });
    fireEvent.change(screen.getByLabelText("Ask Ini a question"), { target: { value: "Ana off Friday" } });
    fireEvent.click(screen.getByRole("button", { name: /Send/ }));
    expect(onAskIni).toHaveBeenCalledWith("Ana off Friday");
  });

  test("pleased when Fix it for me works", () => {
    reduceMotion(true);
    render(<Ward onAskIni={jest.fn()} />);
    expect(face()).toBe("Ini, listening");
    fireEvent.click(screen.getByRole("button", { name: /Fix it for me/ }));
    expect(face()).toBe("Ini, all done");
  });
});
