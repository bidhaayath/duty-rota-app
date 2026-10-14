/* Ini and Undo together: everything Ini saves from one checklist is one
   Undo step, and undoing never leaves the rota empty. Wired the way
   DutyRotaOriginal.js wires them: the rota starts empty while the
   department loads, update() hands a fresh copy to each edit, and the
   history watches the rota. The database and the AI are stand-ins. */

import React, { useState } from "react";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import AssistantPanel from "./AssistantPanel";
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

let api = {};
function App() {
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
