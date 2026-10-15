/* Ini and Undo together: everything Ini saves from one checklist is one
   Undo step, and undoing never leaves the rota empty. Wired the way
   DutyRotaOriginal.js wires them: the rota starts empty while the
   department loads, update() hands a fresh copy to each edit, and the
   history watches the rota. The database and the AI are stand-ins. */

import React, { useState } from "react";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import AssistantPanel from "./AssistantPanel";
import SmartRosterTab from "./SmartRosterTab";
import { useRotaHistory } from "./useRotaHistory";

jest.mock("./supabaseClient", () => ({
  __esModule: true,
  default: {
    rpc: () => Promise.resolve({ data: { ok: true, cap: 20, used: 1, remaining: 19 }, error: null }),
    auth: { getSession: () => Promise.resolve({ data: { session: { access_token: "t" } } }) },
  },
}));
jest.mock("./monthBuildRunner", () => ({ startMonthBuild: jest.fn() }));

const T = { lagoon: "#0F8B7E", ink: "#142B33", inkSoft: "#4A6570", line: "#DCE8E6", mist: "#EEF4F3", coral: "#E4604E" };
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const loaded = () => ({
  staff: [{ id: "ali", name: "Ali", leavePeriods: [] }, { id: "m", name: "Mariyam", leavePeriods: [] }],
  codes: [{ id: "N", code: "N", label: "Night duty", counts: "night" }, { id: "M", code: "M", counts: "morning" }],
  cells: { "2026-11-09": { m: "M" }, "2026-11-13": { m: "M" } },
  cellMeta: {}, nonOfficial: [], dutyRequests: [], fridayRule: false,
});

// Plain stand-ins for the app's own small building blocks.
const Card = ({ children }) => <div>{children}</div>;
const Btn = ({ children, kind, small, ...rest }) => <button {...rest}>{children}</button>;
const Field = ({ label, children }) => <label>{label}{children}</label>;

let api = {};
function App({ withSmartRoster = false }) {
  const [data, setData] = useState(null);
  const [deptId, setDeptId] = useState(null);
  const history = useRotaHistory(data, setData, deptId);
  // The app uses structuredClone, which this test environment lacks.
  const update = (fn) => setData((d) => fn(JSON.parse(JSON.stringify(d))));
  api = { data, history, open: (rota) => { setData(null); setDeptId("d1"); setTimeout(() => setData(rota), 0); } };
  if (!data) return <div>Loading rota…</div>;
  return (
    <>
      <button onClick={history.undo}>Undo</button>
      {withSmartRoster && (
        <SmartRosterTab data={data} update={update} staffEditable T={T} Card={Card} Btn={Btn} Field={Field}
          inputStyle={{}} th={{}} td={{}} uid={() => "u"} dstr={iso} onApplied={() => {}} />
      )}
      <AssistantPanel visible deptId={deptId} data={data} update={update} T={T}
        uid={() => Math.random().toString(36).slice(2)} dstr={iso} canBuild onMonthApplied={() => {}} />
    </>
  );
}

test("leave and duty codes from one note are one Undo step, and Undo never empties the rota", async () => {
  global.fetch = jest.fn(() => Promise.resolve({
    ok: true, status: 200,
    json: () => Promise.resolve({
      ok: true, unclear: [],
      actions: [
        { type: "add_leave", staffId: "ali", leaveType: "annual", start: "2026-11-10", end: "2026-11-12" },
        { type: "set_code", staffId: "ali", start: "2026-11-09", end: "2026-11-09", codeId: "N", code: "N" },
        { type: "set_code", staffId: "ali", start: "2026-11-13", end: "2026-11-13", codeId: "N", code: "N" },
      ],
    }),
  }));
  render(<App />);
  // Opening the department: the rota is empty while it loads.
  act(() => { api.open(loaded()); });
  await screen.findByLabelText("Ask Ini");
  const before = JSON.stringify(api.data);

  fireEvent.click(screen.getByLabelText("Ask Ini"));
  fireEvent.click(await screen.findByText("Choose dates"));
  fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-11-01" } });
  fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-11-30" } });
  fireEvent.change(screen.getByPlaceholderText(/Fathimath Easa/), { target: { value: "Ali leave 10-12, N on 9th and 13th" } });
  fireEvent.click(screen.getByText("Read my note"));
  fireEvent.click(await screen.findByText("Add 3 items"));
  await screen.findByText(/Added 1 leave period and 2 changes to the rota\./);

  expect(api.data.cells["2026-11-09"].ali).toBe("N");
  expect(api.data.cells["2026-11-13"].ali).toBe("N");
  expect(api.data.staff[0].leavePeriods).toHaveLength(1);
  // One save: one step, and nothing below it from opening the department.
  expect(api.history.depth).toBe(1);
  expect(api.history.undoLabel).toBe("2 duties changed across 2 days");

  // One Undo takes back everything Ini added.
  act(() => { api.history.undo(); });
  expect(JSON.stringify(api.data)).toBe(before);
  expect(api.history.canUndo).toBe(false);

  // A second Undo has nothing to take back, and the rota stays on screen.
  act(() => { api.history.undo(); });
  expect(api.data).not.toBeNull();
  expect(JSON.stringify(api.data)).toBe(before);
  await waitFor(() => expect(screen.queryByText("Loading rota…")).toBeNull());

  // Redo puts all of it back in one step.
  act(() => { api.history.redo(); });
  expect(api.data.cells["2026-11-09"].ali).toBe("N");
  expect(api.data.cells["2026-11-13"].ali).toBe("N");
  expect(api.data.staff[0].leavePeriods).toHaveLength(1);
});

test("standing settings and weekly days off save with everything else, one Undo reverts them, and Smart Roster shows it", async () => {
  global.fetch = jest.fn(() => Promise.resolve({
    ok: true, status: 200,
    json: () => Promise.resolve({
      ok: true, unclear: [],
      actions: [
        { type: "set_shifts", staffId: "m", staffName: "Mariyam", shifts: ["night"] },
        { type: "set_offs_per_week", min: 2, max: null },
        { type: "weekly_off", staffId: "m", staffName: "Mariyam", weekdays: [5, 6], start: "2026-11-01", end: "2026-11-30" },
        { type: "set_code", staffId: "ali", start: "2026-11-09", end: "2026-11-09", codeId: "N", code: "N" },
      ],
    }),
  }));
  render(<App withSmartRoster />);
  act(() => { api.open(loaded()); });
  await screen.findByLabelText("Ask Ini");
  const before = JSON.stringify(api.data);

  // What Smart Roster's screen shows: Mariyam's shift chips and the off days.
  const mariyamChips = () => screen.getAllByText("Mariyam", { selector: "span" })[0].parentElement.textContent;
  const offDays = (row) => {
    const inputs = screen.getByText(row, { selector: "td" }).closest("tr").querySelectorAll("input");
    return inputs[inputs.length - 1].value;
  };
  expect(mariyamChips()).not.toMatch(/✓/);
  expect([offDays("Fewest"), offDays("Most")]).toEqual(["1", "2"]);

  fireEvent.click(screen.getByLabelText("Ask Ini"));
  fireEvent.click(await screen.findByText("Choose dates"));
  fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-11-01" } });
  fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-11-30" } });
  fireEvent.change(screen.getByPlaceholderText(/Fathimath Easa/), { target: { value: "Mariyam nights only, 2 offs a week, off Fri Sat, Ali N 9th" } });
  fireEvent.click(screen.getByText("Read my note"));

  expect(await screen.findByText("Standing settings")).toBeInTheDocument();
  expect(screen.getByText("Standing setting: applies from now on")).toBeInTheDocument();
  expect(screen.getByText("Shifts · Mariyam · any shift → night only")).toBeInTheDocument();
  expect(screen.getByText("Off days per week · 1–2 → 2–2")).toBeInTheDocument();
  expect(screen.getByText("Off every Fri and Sat · Mariyam · 8 days, 1–30 Nov")).toBeInTheDocument();
  fireEvent.click(screen.getByText("Add 4 items"));
  await screen.findByText(/^Added /);

  // All of it landed in one step, and Smart Roster's screen shows it at once.
  expect(api.history.depth).toBe(1);
  expect(api.data.dutyRequests.filter((r) => r.staffId === "m" && r.category === "off")).toHaveLength(8);
  expect(api.data.cells["2026-11-09"].ali).toBe("N");
  expect(mariyamChips()).toMatch(/✓ Night/);
  expect([offDays("Fewest"), offDays("Most")]).toEqual(["2", "2"]);

  // One Undo, and Smart Roster shows the old values again.
  act(() => { api.history.undo(); });
  expect(JSON.stringify(api.data)).toBe(before);
  expect(mariyamChips()).not.toMatch(/✓/);
  expect([offDays("Fewest"), offDays("Most")]).toEqual(["1", "2"]);
});

test("senior lines send the ward's word, save in one step with everything else, and Smart Roster shows them", async () => {
  global.fetch = jest.fn(() => Promise.resolve({
    ok: true, status: 200,
    json: () => Promise.resolve({
      ok: true, unclear: [],
      actions: [
        { type: "set_senior_cover", cover: { morning: 1, afternoon: null, evening: null, night: 2 } },
        { type: "set_seniors", add: [{ staffId: "ali", staffName: "Ali" }], remove: [{ staffId: "m", staffName: "Mariyam" }] },
        { type: "set_code", staffId: "ali", start: "2026-11-09", end: "2026-11-09", codeId: "N", code: "N" },
      ],
    }),
  }));
  render(<App withSmartRoster />);
  act(() => { api.open({ ...loaded(), rosterRules: { seniorTerm: "In-charge", seniorStaff: ["m"] } }); });
  await screen.findByLabelText("Ask Ini");
  const before = JSON.stringify(api.data);

  const chipsOf = (name) => screen.getAllByText(name, { selector: "span" })[0].parentElement.textContent;
  const seniorsOn = (shift) => {
    const inputs = screen.getAllByText(shift, { selector: "td" })[0].closest("tr").querySelectorAll("input");
    return inputs[inputs.length - 1].value;
  };
  expect(chipsOf("Ali")).not.toMatch(/✓ In-charge/);
  expect(chipsOf("Mariyam")).toMatch(/✓ In-charge/);
  expect([seniorsOn("Morning"), seniorsOn("Night")]).toEqual(["0", "0"]);

  fireEvent.click(screen.getByLabelText("Ask Ini"));
  fireEvent.click(await screen.findByText("Choose dates"));
  fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-11-01" } });
  fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-11-30" } });
  fireEvent.change(screen.getByPlaceholderText(/Fathimath Easa/), { target: { value: "1 in-charge mornings, 2 nights; Ali can take charge, Mariyam not; Ali N 9th" } });
  fireEvent.click(screen.getByText("Read my note"));

  expect(await screen.findByText("In-charges per shift · morning 0 → 1, night 0 → 2")).toBeInTheDocument();
  expect(screen.getByText("Can take charge · + Ali · − Mariyam")).toBeInTheDocument();
  expect(JSON.parse(global.fetch.mock.calls[0][1].body).seniorTerm).toBe("In-charge");
  fireEvent.click(screen.getByText("Add 3 items"));
  await screen.findByText(/^Added /);

  expect(api.history.depth).toBe(1);
  expect(api.data.rosterRules.seniorCover).toEqual({ morning: 1, afternoon: 0, evening: 0, night: 2 });
  expect(api.data.rosterRules.seniorStaff).toEqual(["ali"]);
  expect(api.data.cells["2026-11-09"].ali).toBe("N");
  expect(chipsOf("Ali")).toMatch(/✓ In-charge/);
  expect(chipsOf("Mariyam")).not.toMatch(/✓ In-charge/);
  expect([seniorsOn("Morning"), seniorsOn("Night")]).toEqual(["1", "2"]);

  act(() => { api.history.undo(); });
  expect(JSON.stringify(api.data)).toBe(before);
  expect(chipsOf("Ali")).not.toMatch(/✓ In-charge/);
  expect(chipsOf("Mariyam")).toMatch(/✓ In-charge/);
  expect([seniorsOn("Morning"), seniorsOn("Night")]).toEqual(["0", "0"]);
});
