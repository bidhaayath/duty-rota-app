/* Ini's face: which mood shows in each situation, on the button and in the
   panel header, and that both stay out of exports. The database, the AI,
   the background build and the month preview are stand-ins — nothing here
   reaches the live service. */

import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import AssistantPanel, { iniMood, iniSpotted } from "./AssistantPanel";
import { startMonthBuild } from "./monthBuildRunner";

let mockStatus;
jest.mock("./supabaseClient", () => ({
  __esModule: true,
  default: {
    rpc: () => Promise.resolve({ data: mockStatus, error: null }),
    auth: { getSession: () => Promise.resolve({ data: { session: { access_token: "t" } } }) },
  },
}));
jest.mock("./monthBuildRunner", () => ({ startMonthBuild: jest.fn() }));
// The preview is replaced by a single Apply button; finishing the month is
// not under test here.
jest.mock("./MonthPreview", () => {
  const React = require("react");
  return {
    __esModule: true,
    default: ({ onApplied }) => React.createElement("button", { onClick: () => onApplied("2026-11-01", "2026-11-30") }, "Apply month"),
  };
});
jest.mock("./monthBuild", () => ({ ...jest.requireActual("./monthBuild"), finishMonth: () => ({}) }));

beforeEach(() => {
  mockStatus = { ok: true, cap: 20, used: 1, remaining: 19 };
  startMonthBuild.mockImplementation(() => ({ promise: new Promise(() => {}), cancel: () => {} }));
});
afterEach(() => { delete window.matchMedia; });

const T = { lagoon: "#0F8B7E", ink: "#142B33", inkSoft: "#4A6570", line: "#DCE8E6", mist: "#EEF4F3", coral: "#E4604E" };
const makeData = () => ({
  staff: [{ id: "a", name: "Ali" }, { id: "m", name: "Mariyam" }],
  codes: [{ id: "M", code: "M", color: "#F4B860", counts: "morning" }],
  cells: {}, nonOfficial: [], dutyRequests: [],
});
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const n = new Date();
const nextFirst = iso(new Date(n.getFullYear(), n.getMonth() + 1, 1));
const nextFifth = `${nextFirst.slice(0, 8)}05`;

const panel = (data, update) => (
  <AssistantPanel visible deptId="d1" data={data} update={update} T={T}
    uid={() => Math.random().toString(36).slice(2)} dstr={iso} canBuild onMonthApplied={jest.fn()} />
);
// The mood each Ini is showing, from its screen-reader label ("Ini, listening").
const moodOf = (root) => root.querySelector('svg[aria-label^="Ini, "]').getAttribute("aria-label").slice(5);
const buttonMood = () => moodOf(screen.getByLabelText("Ask Ini"));
const headerMood = () => moodOf(screen.getByRole("dialog"));
const reply = (body, status = 200) => Promise.resolve({ ok: status === 200, status, json: () => Promise.resolve(body) });
const openPanel = async () => {
  fireEvent.click(screen.getByLabelText("Ask Ini"));
  await screen.findByRole("dialog");
  await screen.findByPlaceholderText(/Fathimath Easa/);
};
const sendNote = (text = "a note") => {
  fireEvent.change(screen.getByPlaceholderText(/Fathimath Easa/), { target: { value: text } });
  fireEvent.click(screen.getByText("Read my note"));
};

describe("iniMood", () => {
  test.each([
    ["button, nothing happening", {}, "resting"],
    ["button, tapped", { waking: true }, "waking"],
    ["button, just after Apply", { done: "apply" }, "done"],
    ["button, just after Add (seen in the header, not here)", { done: "add" }, "resting"],
    ["button, tapped just after Apply", { waking: true, done: "apply" }, "waking"],
    ["button, building in the background", { reading: true, spotted: true }, "resting"],
    ["header, nothing happening", { open: true }, "listening"],
    ["header, reading beats everything", { open: true, reading: true, spotted: true, done: "add" }, "reading"],
    ["header, spotted beats done", { open: true, spotted: true, done: "add" }, "spotted"],
    ["header, just after Add", { open: true, done: "add" }, "done"],
    ["header, reopened just after Apply", { open: true, done: "apply" }, "done"],
  ])("%s → %s", (_, state, mood) => {
    expect(iniMood(state)).toBe(mood);
  });
});

describe("iniSpotted: only what is on screen", () => {
  const ok = { ok: true, cap: 20, used: 1, remaining: 19 };
  const line = (o = {}) => ({ blocked: "", warnings: [], ...o });
  test.each([
    ["note form, all clear", { view: "form", status: ok }, false],
    ["note form, still checking", { view: "form", status: null }, false],
    ["note form, an error", { view: "form", status: ok, error: "Please try again." }, true],
    ["note form, limit reached", { view: "form", status: { ...ok, remaining: 0 } }, true],
    ["note form, not allowed", { view: "form", status: { ok: false, reason: "not_allowed" } }, true],
    ["note form, not on plan (an upgrade offer, not an error)", { view: "form", status: { ok: false, reason: "not_on_plan" } }, false],
    ["note form, build problems", { view: "form", status: ok, buildProblems: ["Nobody on this rota…"] }, true],
    ["note form, empty build problems", { view: "form", status: ok, buildProblems: [] }, false],
    ["checklist, all clear", { view: "checklist", lines: [line()] }, false],
    ["checklist, a warning", { view: "checklist", lines: [line(), line({ warnings: ["outside the dates you chose"] })] }, true],
    ["checklist, a blocked line", { view: "checklist", lines: [line({ blocked: "Already M." })] }, true],
    ["checklist, Not added", { view: "checklist", lines: [], unclear: ["Who is Zed?"] }, true],
    ["checklist, save refused", { view: "checklist", lines: [line()], saveProblem: "Nothing was saved." }, true],
    ["checklist, the limit now 0 is not on screen", { view: "checklist", lines: [line()], status: { ...ok, remaining: 0 } }, false],
    ["saved, all clear", { view: "saved" }, false],
    ["saved, the build failed", { view: "saved", buildProblems: ["x"] }, true],
    ["building, an old error", { view: "building", error: "x", buildProblems: ["x"] }, false],
  ])("%s → %s", (_, state, spotted) => {
    expect(iniSpotted(state)).toBe(spotted);
  });
});

describe("Ini's face in the panel", () => {
  test("the button rests, wakes when tapped, and the panel opens listening", async () => {
    render(panel(makeData(), jest.fn()));
    expect(buttonMood()).toBe("resting");
    fireEvent.click(screen.getByLabelText("Ask Ini"));
    expect(buttonMood()).toBe("waking up");
    expect(screen.queryByRole("dialog")).toBeNull();
    // A second tap while waking does nothing extra.
    fireEvent.click(screen.getByLabelText("Ask Ini"));
    await screen.findByRole("dialog");
    expect(headerMood()).toBe("listening");
    expect(screen.queryByLabelText("Ask Ini")).toBeNull();
  });

  test("with reduced motion the panel opens straight away", async () => {
    window.matchMedia = (q) => ({ matches: q.includes("reduce"), addListener() {}, removeListener() {} });
    render(panel(makeData(), jest.fn()));
    fireEvent.click(screen.getByLabelText("Ask Ini"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(headerMood()).toBe("listening");
    await screen.findByPlaceholderText(/Fathimath Easa/);
  });

  test("listening while typing, reading while the note is read, spotted at Not added", async () => {
    let answer;
    global.fetch = jest.fn(() => new Promise((r) => { answer = r; }));
    render(panel(makeData(), jest.fn()));
    await openPanel();
    fireEvent.change(screen.getByPlaceholderText(/Fathimath Easa/), { target: { value: "Zed off" } });
    expect(headerMood()).toBe("listening");
    fireEvent.click(screen.getByText("Read my note"));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(headerMood()).toBe("reading your note");
    await act(async () => { answer(await reply({ ok: true, actions: [], unclear: ["Who is Zed?"] })); });
    expect(await screen.findByText("Not added")).toBeInTheDocument();
    expect(headerMood()).toBe("spotted something");
  });

  test("spotted for a warning line and for a blocked line", async () => {
    global.fetch = jest.fn(() => reply({
      ok: true, unclear: [],
      actions: [{ type: "add_leave", staffId: "a", leaveType: "annual", start: "2020-01-10", end: "2020-01-12" }],
    }));
    const { unmount } = render(panel(makeData(), jest.fn()));
    await openPanel();
    sendNote();
    expect(await screen.findByText("outside the dates you chose")).toBeInTheDocument();
    expect(headerMood()).toBe("spotted something");
    unmount();

    global.fetch = jest.fn(() => reply({ ok: true, unclear: [], actions: [{ type: "set_offs_per_week", min: 1, max: 2 }] }));
    render(panel(makeData(), jest.fn()));
    await openPanel();
    sendNote();
    expect(await screen.findByText("Off days per week are already set like this.")).toBeInTheDocument();
    expect(headerMood()).toBe("spotted something");
  });

  test("a clean checklist keeps listening", async () => {
    global.fetch = jest.fn(() => reply({ ok: true, unclear: [], actions: [{ type: "add_request", staffId: "m", date: nextFifth, duty: "off" }] }));
    render(panel(makeData(), jest.fn()));
    await openPanel();
    sendNote();
    expect(await screen.findByText("Add 1 item")).toBeInTheDocument();
    expect(headerMood()).toBe("listening");
  });

  test.each([
    ["limit reached", () => reply({ error: "limit_reached" }, 429), /used this month's notes/],
    ["unavailable", () => reply({ error: "not_configured" }, 503), /isn't switched on yet/],
    ["can't read the note", () => reply({ error: "upstream" }, 500), /couldn't read your note/],
  ])("spotted when an error shows: %s", async (_, fetchReply, message) => {
    global.fetch = jest.fn(fetchReply);
    render(panel(makeData(), jest.fn()));
    await openPanel();
    sendNote();
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(headerMood()).toBe("spotted something");
  });

  test("spotted when the allowance check says no, but not for the upgrade offer", async () => {
    mockStatus = { ok: false, reason: "not_allowed" };
    const { unmount } = render(panel(makeData(), jest.fn()));
    fireEvent.click(screen.getByLabelText("Ask Ini"));
    expect(await screen.findByText(/Only the owner and managers/)).toBeInTheDocument();
    expect(headerMood()).toBe("spotted something");
    unmount();

    mockStatus = { ok: false, reason: "not_on_plan" };
    render(panel(makeData(), jest.fn()));
    fireEvent.click(screen.getByLabelText("Ask Ini"));
    expect(await screen.findByText(/Ini is on the Plus, Pro and Custom plans/)).toBeInTheDocument();
    expect(headerMood()).toBe("listening");
  });

  test("reading while a month builds", async () => {
    render(panel(makeData(), jest.fn()));
    await openPanel();
    fireEvent.click(screen.getAllByRole("button").find((b) => /^\s*Build .*roster/.test(b.textContent)));
    expect(await screen.findByText(/this can take a few seconds/)).toBeInTheDocument();
    expect(headerMood()).toBe("reading your note");
  });

  describe("done after a save", () => {
    beforeEach(() => { jest.useFakeTimers(); });
    afterEach(() => { jest.useRealTimers(); });

    const addOne = async () => {
      global.fetch = jest.fn(() => reply({ ok: true, unclear: [], actions: [{ type: "add_request", staffId: "m", date: nextFifth, duty: "off" }] }));
      let data = makeData();
      const update = jest.fn((fn) => { data = fn(JSON.parse(JSON.stringify(data))); });
      const view = render(panel(data, update));
      await openPanel();
      sendNote();
      fireEvent.click(await screen.findByText("Add 1 item"));
      act(() => { view.rerender(panel(data, update)); });
      expect(await screen.findByText("Added 1 duty request.")).toBeInTheDocument();
    };

    test("done for 4 seconds after Add, then listening", async () => {
      await addOne();
      expect(headerMood()).toBe("all done");
      act(() => { jest.advanceTimersByTime(3900); });
      expect(headerMood()).toBe("all done");
      act(() => { jest.advanceTimersByTime(200); });
      expect(headerMood()).toBe("listening");
    });

    test("done ends as soon as the manager starts typing", async () => {
      await addOne();
      fireEvent.click(screen.getByText("Write another note"));
      expect(headerMood()).toBe("all done");
      fireEvent.change(screen.getByPlaceholderText(/Fathimath Easa/), { target: { value: "M" } });
      expect(headerMood()).toBe("listening");
    });

    test("after Apply the button shows done for 4 seconds, then rests", async () => {
      startMonthBuild.mockImplementation(() => ({ promise: Promise.resolve({ ok: true, ms: 5 }), cancel: () => {} }));
      render(panel(makeData(), jest.fn()));
      await openPanel();
      fireEvent.click(screen.getAllByRole("button").find((b) => /^\s*Build .*roster/.test(b.textContent)));
      fireEvent.click(await screen.findByText("Apply month"));
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(buttonMood()).toBe("all done");
      act(() => { jest.advanceTimersByTime(4100); });
      expect(buttonMood()).toBe("resting");
    });
  });
});

test("neither Ini can reach an export: both sit inside the no-print wrapper", async () => {
  const { container } = render(panel(makeData(), jest.fn()));
  const wrapper = container.firstChild;
  expect(wrapper).toHaveClass("no-print", "ini-root");
  expect(wrapper.textContent + wrapper.innerHTML).toMatch(/@media print \{ \.ini-root \{ display: none !important; \} \}/);
  expect(wrapper).toContainElement(screen.getByLabelText("Ask Ini"));
  await openPanel();
  expect(wrapper).toContainElement(screen.getByRole("dialog"));
});
