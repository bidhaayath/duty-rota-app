/* A Smart Roster week belongs to the department it was generated for.

   Adding a department sets the rota to empty, switches the department and
   hands over the new rota all at once, after its last await — so React
   renders it as one change and the Smart Roster tab is never unmounted on
   the way. A week generated for the old department then sat there with a
   working Apply button, and pressing it wrote the old department's duties
   into the new one as cells for staff it does not have, and said "Week
   applied — all duties match".

   Wired the way DutyRotaOriginal.js wires the tab, with "add department"
   copied exactly: setData(null), setDeptId, setData(new rota) in one go.
   The first test leaves the key off on purpose, to show the proposal's own
   department stamp stops it whatever React does. The second shows what the
   key on the real tab does — it tests React's remounting, not
   DutyRotaOriginal.js, which no test renders.                          */

import React, { useState } from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import SmartRosterTab from "./SmartRosterTab";

const T = { lagoon: "#0F8B7E", ink: "#142B33", inkSoft: "#4A6570", line: "#DCE8E6", mist: "#EEF4F3", coral: "#E4604E", sand: "#C9A15A" };
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const wardA = () => ({
  staff: [...Array(8)].map((_, i) => ({ id: `a${i}`, name: `Nurse ${i}`, leavePeriods: [] })),
  codes: [
    { id: "cM", code: "M", counts: "morning" }, { id: "cA", code: "A", counts: "afternoon" },
    { id: "cN", code: "N", counts: "night" }, { id: "cO", code: "OFF", counts: "off" },
    { id: "cNO", code: "(N)OFF", counts: "off" },
  ],
  cells: {}, cellMeta: {}, nonOfficial: [], dutyRequests: [], fridayRule: false,
});
// A brand-new department: no staff, and the default codes under ids of its own.
const newDepartment = () => ({
  staff: [],
  codes: [
    { id: "dM", code: "M", counts: "morning" }, { id: "dA", code: "A", counts: "afternoon" },
    { id: "dN", code: "N", counts: "night" }, { id: "dO", code: "OFF", counts: "off" },
    { id: "dNO", code: "(N)OFF", counts: "off" },
  ],
  cells: {}, cellMeta: {}, nonOfficial: [], dutyRequests: [], fridayRule: false,
});

const Card = ({ children }) => <div>{children}</div>;
const Btn = ({ children, kind, small, ...rest }) => <button {...rest}>{children}</button>;
const Field = ({ label, children }) => <label>{label}{children}</label>;

let api = {};
function App({ keyed }) {
  const [data, setData] = useState(null);
  const [deptId, setDeptId] = useState(null);
  const update = (fn) => setData((d) => fn(JSON.parse(JSON.stringify(d))));
  api = {
    data, deptId,
    open: (rota) => { setData(null); setDeptId("d1"); setTimeout(() => setData(rota), 0); },
    // DutyRotaOriginal's addDepartment, after its awaits: three updates, one render.
    addDepartment: () => { setData(null); setDeptId("d2"); setData(newDepartment()); },
  };
  if (!data) return <div>Loading rota…</div>;
  return (
    <SmartRosterTab key={keyed ? deptId : undefined} deptId={deptId}
      data={data} update={update} staffEditable T={T} Card={Card} Btn={Btn} Field={Field}
      inputStyle={{}} th={{}} td={{}} uid={() => "u"} dstr={iso} onApplied={() => {}} />
  );
}

let alerts;
beforeEach(() => {
  alerts = [];
  window.alert = jest.fn((m) => { alerts.push(m); });
  window.confirm = jest.fn(() => true);
});
jest.setTimeout(30000);

const generateForWardA = async () => {
  act(() => { api.open(wardA()); });
  fireEvent.click(await screen.findByText("Generate this week"));
  await screen.findByText(/Apply to rota/, {}, { timeout: 20000 });
};
const settle = () => act(() => new Promise((r) => setTimeout(r, 50)));

test("a week generated for one department cannot be applied after adding another", async () => {
  render(<App keyed={false} />);
  await generateForWardA();

  act(() => { api.addDepartment(); });
  expect(api.deptId).toBe("d2");

  const apply = screen.queryByText(/Apply to rota/);
  if (apply) fireEvent.click(apply);
  await settle();

  // Nothing written to the new department, and no claim that it worked.
  const cellsWritten = Object.values(api.data.cells).reduce((n, row) => n + Object.keys(row).length, 0);
  expect({ cellsWritten, successClaimed: alerts.filter((m) => /Week applied/.test(m)) })
    .toEqual({ cellsWritten: 0, successClaimed: [] });
  expect(window.confirm).not.toHaveBeenCalled();
  // And it says what happened, rather than going quiet.
  expect(screen.getByText(/generated for a different department/)).toBeInTheDocument();
});

test("with the tab keyed on the department, adding one starts the tab afresh", async () => {
  render(<App keyed />);
  await generateForWardA();

  act(() => { api.addDepartment(); });
  await settle();

  expect(screen.queryByText(/Apply to rota/)).toBeNull();
  expect(screen.queryByText(/generated for a different department/)).toBeNull();
  expect(api.data.cells).toEqual({});
});
