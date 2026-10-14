/* Ini's panel: "A month" or "Choose dates", the three-month limit, and a
   note that asks to build particular dates. The database, the AI and the
   background build are replaced with stand-ins — nothing here reaches the
   live service. */

import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import AssistantPanel from "./AssistantPanel";
import { startMonthBuild } from "./monthBuildRunner";

jest.mock("./supabaseClient", () => ({
  __esModule: true,
  default: {
    rpc: () => Promise.resolve({ data: { ok: true, cap: 20, used: 1, remaining: 19 }, error: null }),
    auth: { getSession: () => Promise.resolve({ data: { session: { access_token: "t" } } }) },
  },
}));
jest.mock("./monthBuildRunner", () => ({ startMonthBuild: jest.fn() }));
// The test setup resets stand-ins before each test, so they are set here.
beforeEach(() => {
  startMonthBuild.mockImplementation(() => ({ promise: new Promise(() => {}), cancel: () => {} }));
});

const T = { lagoon: "#0F8B7E", ink: "#142B33", inkSoft: "#4A6570", line: "#DCE8E6", mist: "#EEF4F3", coral: "#E4604E" };
const makeData = () => ({
  staff: [{ id: "a", name: "Ali" }, { id: "m", name: "Mariyam" }],
  codes: [{ id: "M", code: "M", color: "#F4B860", counts: "morning" }],
  cells: {}, nonOfficial: [], dutyRequests: [],
});
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const renderPanel = (data, update = jest.fn()) => render(
  <AssistantPanel visible deptId="d1" data={data} update={update} T={T}
    uid={() => Math.random().toString(36).slice(2)} dstr={iso} canBuild onMonthApplied={jest.fn()} />,
);
const open = async () => {
  fireEvent.click(screen.getByLabelText("Ask Ini"));
  await screen.findByText("Choose dates");
};

test("choosing dates: defaults to the month shown, and blocks more than three months", async () => {
  renderPanel(makeData());
  await open();
  fireEvent.click(screen.getByText("Choose dates"));
  const from = screen.getByLabelText("From");
  const to = screen.getByLabelText("To");
  const n = new Date();
  expect(from.value).toBe(iso(new Date(n.getFullYear(), n.getMonth() + 1, 1)));
  expect(to.value).toBe(iso(new Date(n.getFullYear(), n.getMonth() + 2, 0)));

  fireEvent.change(from, { target: { value: "2026-11-15" } });
  fireEvent.change(to, { target: { value: "2026-12-14" } });
  expect(screen.getByText(/Build roster for 15 Nov – 14 Dec/)).not.toBeDisabled();

  fireEvent.change(to, { target: { value: "2027-03-01" } });
  expect(screen.getByRole("alert")).toHaveTextContent("Choose at most 3 months (92 days) at a time.");
  expect(screen.getByText(/Build roster for/).closest("button")).toBeDisabled();
});

test("a note that asks to build particular dates switches to those dates", async () => {
  global.fetch = jest.fn(() => Promise.resolve({
    ok: true, status: 200,
    json: () => Promise.resolve({
      ok: true, unclear: [], requests: [],
      leave: [{ staffId: "a", type: "annual", start: "2026-12-10", end: "2026-12-12" }],
      build: true, buildFrom: "2026-11-15", buildTo: "2026-12-14", historyFrom: null,
      usage: { cap: 20, used: 2, remaining: 18 },
    }),
  }));
  let data = makeData();
  const update = jest.fn((fn) => { data = fn(JSON.parse(JSON.stringify(data))); });
  const { rerender } = renderPanel(data, update);
  await open();
  fireEvent.change(screen.getByPlaceholderText(/Fathimath Easa/), { target: { value: "Ali leave 10-12 Dec, build 15 Nov to 14 Dec" } });
  fireEvent.click(screen.getByText("Read my note"));

  expect(await screen.findByText("Build the roster for 15 Nov – 14 Dec")).toBeInTheDocument();
  // The leave falls inside the dates being built, so it starts ticked.
  expect(screen.queryByText("outside the dates you chose")).toBeNull();
  const confirm = screen.getByText(/Add 1 item and build 15 Nov – 14 Dec/);
  fireEvent.click(confirm);
  expect(update).toHaveBeenCalledTimes(1);

  // The month is built from the rota that includes the leave just added.
  act(() => {
    rerender(<AssistantPanel visible deptId="d1" data={data} update={update} T={T}
      uid={() => "x"} dstr={iso} canBuild onMonthApplied={jest.fn()} />);
  });
  await waitFor(() => expect(startMonthBuild).toHaveBeenCalled());
  const config = startMonthBuild.mock.calls[0][0];
  expect(config.from <= "2026-11-15" && config.to >= "2026-12-14").toBe(true);
  const ali = config.staff.find((s) => s.id === "a");
  expect(ali.leavePeriods.some((p) => p.start === "2026-12-10" && p.end === "2026-12-12")).toBe(true);
});

test("the new reply: the department's codes and shifts are sent, a month build stays a month, and Added waits for the save", async () => {
  const n = new Date();
  const first = iso(new Date(n.getFullYear(), n.getMonth() + 1, 1));
  const last = iso(new Date(n.getFullYear(), n.getMonth() + 2, 0));
  const day = `${first.slice(0, 8)}05`;
  global.fetch = jest.fn(() => Promise.resolve({
    ok: true, status: 200,
    json: () => Promise.resolve({
      ok: true, unclear: [],
      actions: [
        { type: "add_request", staffId: "m", date: day, duty: "off" },
        { type: "build", from: first, to: last, historyFrom: null },
      ],
      // The older fields come too during the changeover; they must not double up.
      requests: [{ staffId: "m", date: day, category: "off" }], leave: [], build: true,
      usage: { cap: 20, used: 2, remaining: 18 },
    }),
  }));
  let data = makeData();
  const update = jest.fn((fn) => { data = fn(JSON.parse(JSON.stringify(data))); });
  const { rerender } = renderPanel(data, update);
  await open();
  fireEvent.change(screen.getByPlaceholderText(/Fathimath Easa/), { target: { value: "Mariyam off on the 5th, build next month" } });
  fireEvent.click(screen.getByText("Read my note"));

  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  const sent = JSON.parse(global.fetch.mock.calls[0][1].body);
  expect(sent.codes).toEqual([{ id: "M", code: "M", label: "", counts: "morning" }]);
  expect(sent.shifts).toEqual(["morning", "afternoon", "night"]);
  expect(sent.fridayRule).toBe(false);

  expect(await screen.findByText("Leave & requests")).toBeInTheDocument();
  expect(screen.getAllByLabelText(/Off day · Mariyam/)).toHaveLength(1);
  // Untick the build, so this is a plain save.
  fireEvent.click(screen.getByText(/^Build the .* roster$/).closest("label").querySelector("input"));
  fireEvent.click(screen.getByText("Add 1 item"));
  expect(update).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(/Added/)).toBeNull();
  act(() => {
    rerender(<AssistantPanel visible deptId="d1" data={data} update={update} T={T}
      uid={() => "x"} dstr={iso} canBuild onMonthApplied={jest.fn()} />);
  });
  expect(await screen.findByText("Added 1 duty request.")).toBeInTheDocument();
  expect(data.dutyRequests).toHaveLength(1);
  expect(startMonthBuild).not.toHaveBeenCalled();
});

test("a save that is refused says so and keeps the checklist", async () => {
  jest.useFakeTimers();
  try {
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true, status: 200,
      json: () => Promise.resolve({
        ok: true, unclear: [],
        actions: [{ type: "add_leave", staffId: "a", leaveType: "annual", start: "2026-12-10", end: "2026-12-12" }],
      }),
    }));
    const update = jest.fn();          // refuses: the rota never changes
    renderPanel(makeData(), update);
    fireEvent.click(screen.getByLabelText("Ask Ini"));
    await screen.findByText("Choose dates");
    fireEvent.click(screen.getByText("Choose dates"));
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-12-01" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-12-31" } });
    fireEvent.change(screen.getByPlaceholderText(/Fathimath Easa/), { target: { value: "Ali leave 10-12 Dec" } });
    fireEvent.click(screen.getByText("Read my note"));
    fireEvent.click(await screen.findByText("Add 1 item"));
    act(() => { jest.advanceTimersByTime(1600); });
    expect(screen.getByRole("alert")).toHaveTextContent("Nothing was saved.");
    expect(screen.getByText("Add 1 item")).toBeInTheDocument();
  } finally {
    jest.useRealTimers();
  }
});

describe("the look-back line and what the build receives", () => {
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const D = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const add = (s, n) => { const d = D(s); d.setDate(d.getDate() + n); return iso(d); };
  const fmt = (s) => `${D(s).getDate()} ${MON[D(s).getMonth()]}`;
  // Worked out here independently of the app's own code.
  const expectedStart = (first, choice) => {
    const d = D(first);
    if (choice === "usual") return add(first, -30);
    if (choice === "year") return `${d.getFullYear()}-01-01`;
    return iso(new Date(d.getFullYear(), d.getMonth() - (choice === "3m" ? 3 : 6), 1));
  };
  const expectedSentence = (start, first) => {
    const end = add(first, -1);
    const y1 = start.slice(0, 4), y2 = end.slice(0, 4);
    return `Fairness based on rosters from ${fmt(start)}${y1 !== y2 ? ` ${y1}` : ""} to ${fmt(end)}${y1 !== y2 ? ` ${y2}` : ""}.`;
  };
  // A rota filled every day for a year either side of today.
  const filledData = () => {
    const data = makeData();
    const n = new Date();
    for (let d = new Date(n.getFullYear() - 1, n.getMonth(), 1); d < new Date(n.getFullYear() + 1, n.getMonth(), 1); d.setDate(d.getDate() + 1)) {
      data.cells[iso(d)] = { a: "M", m: "M" };
    }
    return data;
  };
  const n = new Date();
  const nextMonthFirst = iso(new Date(n.getFullYear(), n.getMonth() + 1, 1));
  const MODES = [["A month", nextMonthFirst, null], ["Choose dates", "2026-11-14", "2026-12-15"]];
  const CHOICES = ["usual", "year", "3m", "6m"];

  test.each(MODES.flatMap(([mode, first, last]) => CHOICES.map((c) => [mode, c, first, last])))(
    "%s, %s", async (mode, choice, first, last) => {
      if (choice === "year" && first.endsWith("-01-01")) return;   // not offered for a period starting 1 January
      const { unmount } = renderPanel(filledData());
      await open();
      if (mode === "Choose dates") {
        fireEvent.click(screen.getByText("Choose dates"));
        fireEvent.change(screen.getByLabelText("From"), { target: { value: first } });
        fireEvent.change(screen.getByLabelText("To"), { target: { value: last } });
      }
      fireEvent.change(screen.getByLabelText("How far back fairness looks"), { target: { value: choice } });
      const start = expectedStart(first, choice);
      expect(screen.getByText(/^Fairness based on rosters/)).toHaveTextContent(expectedSentence(start, first));
      expect(screen.getByText(/^Fairness based on rosters/).textContent).not.toMatch(/NaN|undefined/);

      // Build, and look at exactly what the engine was handed.
      fireEvent.click(screen.getAllByRole("button").find((b) => /^\s*Build .*roster/.test(b.textContent)));
      await waitFor(() => expect(startMonthBuild).toHaveBeenCalled());
      const config = startMonthBuild.mock.calls[0][0];
      const hist = Object.keys(config.history.cells).map((k) => k.slice(-10)).sort();
      expect(hist[0]).toBe(start);                          // starts where the line says
      expect(hist[hist.length - 1]).toBe(add(config.from, -1)); // ends the day before the first day built
      expect(config.from <= first).toBe(true);
      unmount();
    },
  );
});
