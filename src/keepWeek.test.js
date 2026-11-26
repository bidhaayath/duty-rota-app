/* "Keep duties already on the rota" for one week. Off by default, so a week
   is built exactly as it always was. Ticked, every duty already in the week
   stays exactly as it is, code and post included, and counts toward the
   week; only the empty days are filled. 1 November 2026 is a Sunday. */

import React, { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import SmartRosterTab from "./SmartRosterTab";

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
const RULES = { coverage: { morning: { min: 2, max: 3 }, afternoon: { min: 2, max: 3 }, night: { min: 1, max: 2 } } };
const EXISTING = {
  "2026-11-03": { s0: [{ code: "N", post: "Gate" }], s1: "OFF", s2: "M" },
  "2026-11-04": { s3: "A" },
};

let saved;
function App() {
  const [data, setData] = useState(() => ({
    staff: people(12), codes: CODES, cells: JSON.parse(JSON.stringify(EXISTING)), cellMeta: {}, nonOfficial: [],
    dutyRequests: [], fridayRule: false, rosterRules: RULES,
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

const makeWeek = async (keep) => {
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: /^Step 3,/ }));
  fireEvent.change(screen.getByLabelText(/^Week beginning/), { target: { value: "2026-11-01" } });
  const box = screen.getAllByLabelText("Keep duties already on the rota (only fill empty days)")[0];
  expect(box).not.toBeChecked();
  if (keep) fireEvent.click(box);
  fireEvent.click(screen.getByText("Generate this week"));
  await screen.findByRole("button", { name: /Use this roster/ }, { timeout: 30000 });
  fireEvent.click(screen.getByRole("button", { name: /Use this roster/ }));
};

test("ticked: what was there stays exactly, and the empty days are filled", async () => {
  await makeWeek(true);
  expect(window.confirm.mock.calls[0][0]).toContain("Duties already on the rota that week are kept as they are");
  expect(saved.cells["2026-11-03"].s0).toEqual([{ code: "N", post: "Gate" }]);
  expect(saved.cells["2026-11-03"].s1).toBe("OFF");
  expect(saved.cells["2026-11-03"].s2).toBe("M");
  expect(saved.cells["2026-11-04"].s3).toBe("A");
  // Everyone has a duty or an off day every day of the week.
  for (let d = 1; d <= 7; d++) {
    for (let i = 0; i < 12; i++) expect(saved.cells[`2026-11-0${d}`]?.[`s${i}`]).toBeTruthy();
  }
}, 120000);

test("not ticked: the week is written over, as it always was", async () => {
  await makeWeek(false);
  expect(window.confirm.mock.calls[0][0]).toContain("Existing duties that week will be replaced");
  expect(Array.isArray(saved.cells["2026-11-03"].s0)).toBe(false);
}, 120000);
