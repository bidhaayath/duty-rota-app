import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import StatsDashboard from "./StatsDashboard";
import { buildStatsModel } from "./statsModel";

const data = {
  fridayRule: true, nonOfficial: [], eveningEnabled: false, postsEnabled: true,
  posts: [{ id: "p1", name: "Triage" }],
  codes: [{ id: "M", code: "M", counts: "morning" }, { id: "SL", code: "SL", counts: "sl" }],
  staff: [
    { id: "a", name: "Aisha", leavePeriods: [{ id: "x", type: "annual", start: "2026-12-03", end: "2026-12-09" }] },
    { id: "b", name: "Bilal", leavePeriods: [] },
  ],
  cells: { "2026-12-01": { a: [{ code: "M", post: "p1" }], b: "SL" }, "2026-12-02": { b: "M" } },
};
const row = (staff, t) => ({ staff, morning: 0, afternoon: 0, evening: 0, night: 0, other: 0, release: 0, off: 0,
  annualDays: 0, maternityDays: 0, sl: 0, frl: 0, ml: 0, otherLeave: 0, nonOfficialDuty: 0, dutyShifts: t.morning || 0, ...t });
const rows = [row(data.staff[0], { morning: 1, annualDays: 5 }), row(data.staff[1], { morning: 1, sl: 1 })];
const coverage = ["1 Dec", "2 Dec", "3 Dec"].map((date, i) => ({ date, Morning: [1, 1, 0][i], Afternoon: 0, Evening: 0, Night: 0 }));
const CountUp = ({ value }) => <span>{value}</span>;

test("the new Statistics screen draws with real-shaped data", () => {
  render(<StatsDashboard data={data} model={buildStatsModel(data, rows, "2026-12-01", "2026-12-07")}
    summary={{ onAnnual: 1, staffCount: 2, annualDays: 5, avgPerDay: 0.3, nonOffDays: 1, joined: 0, left: 0 }}
    totals={{ duty: 2, nonOff: 0, leave: 6, off: 0 }} coverage={coverage} CountUp={CountUp}
    saveBtn={() => null} cardRef={() => () => {}} />);
  expect(screen.getByText("On annual leave")).toBeInTheDocument();
  expect(screen.getByText("Posts")).toBeInTheDocument();
  expect(screen.getByText("Rota at a glance")).toBeInTheDocument();
  // Tapping a leave row lists who took it.
  fireEvent.click(screen.getByText("Sick leave (SL)"));
  expect(screen.getAllByText("Bilal").length).toBeGreaterThan(0);
});
