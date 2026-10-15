/* The month preview, drawn with a real built month: it renders, marks the
   cells that change, and Apply writes exactly those cells in one update(),
   checks them, and refuses if the rota changed after building. */

import { render, screen, fireEvent, act } from "@testing-library/react";
import { datesBetween } from "./rosterEngine";
import { prepareMonth, prepareBuild, finishMonth, runEngine } from "./monthBuild";
import MonthPreview from "./MonthPreview";
import { weekTotalsFor, dayCountFor } from "./rotaCounts";

const T = { lagoon: "#0E7C7B", ink: "#142B33", inkSoft: "#4A6570", line: "#D5E2E0", mist: "#EEF4F3", coral: "#E4604E" };
const CODES = [
  { id: "M", code: "M", color: "#F4B860", counts: "morning" },
  { id: "A", code: "A", color: "#8FBF6B", counts: "afternoon" },
  { id: "N", code: "N", color: "#6FA8DC", counts: "night" },
  { id: "OFF", code: "OFF", color: "#FFFFFF", counts: "off" },
  { id: "NOFF", code: "(N)OFF", color: "#E8EEF2", counts: "off" },
  { id: "OT", code: "OT", color: "#8E7CC3", counts: "other" },
];
const CYCLE = ["M", "A", "N", "NOFF", "OFF", "M", "A"];
const makeData = () => {
  const staff = [...Array(9)].map((_, i) => ({ id: `s${i}`, name: `Staff ${i}` }));
  staff[3].leavePeriods = [{ id: "l", type: "annual", start: "2026-10-12", end: "2026-10-14" }];
  const cells = {};
  datesBetween("2026-09-01", "2026-09-30").forEach((date, di) => {
    cells[date] = {};
    staff.forEach((s, si) => { cells[date][s.id] = CYCLE[(di + si) % 7]; });
  });
  cells["2026-10-05"] = { s0: [{ code: "M", post: "p1" }, { code: "A" }], s1: "OT", s2: "N" };
  return { staff, codes: CODES, cells, weekStartsOn: 0 };
};
const build = (data, keepExisting) => {
  const prep = prepareMonth({ data, month: "2026-10", keepExisting });
  const out = runEngine({ ...prep.config, polishSteps: 2000, attempts: 1 }, prep.chosenCodes);
  return { ...finishMonth(prep, out, data), ms: 1234 };
};
const clone = (x) => JSON.parse(JSON.stringify(x));

beforeEach(() => {
  window.alert = jest.fn();
  window.confirm = jest.fn(() => true);
});

test("renders the month and marks every cell that will change", () => {
  const data = makeData();
  const proposal = build(data, true);
  render(<MonthPreview proposal={proposal} data={data} update={jest.fn()} T={T}
    onDiscard={jest.fn()} onApplied={jest.fn()} />);
  expect(screen.getByText(/Roster for October 2026/)).toBeInTheDocument();
  expect(screen.getByText(/Built in 1\.2 seconds/)).toBeInTheDocument();
  expect(document.querySelectorAll('[title*="will be"]').length).toBe(proposal.writes.length);
  expect(screen.getAllByText("AL").length).toBe(3);                // leave shown as on the rota
  expect(screen.getByText("OT")).toBeInTheDocument();              // kept Other duty
});

test("Apply writes exactly the planned cells in one update, then confirms and opens the month", () => {
  const data = makeData();
  const proposal = build(data, true);
  const update = jest.fn();
  const onApplied = jest.fn();
  const { rerender } = render(<MonthPreview proposal={proposal} data={data} update={update} T={T}
    onDiscard={jest.fn()} onApplied={onApplied} />);
  fireEvent.click(screen.getAllByText("Apply to rota")[0]);
  expect(window.confirm.mock.calls[0][0]).toMatch(/Duties already on the rota are kept exactly as they are/);
  expect(update).toHaveBeenCalledTimes(1);

  const after = update.mock.calls[0][0](clone(data));
  // Every planned cell landed; nothing else in the rota moved.
  proposal.writes.forEach((w) => expect(after.cells[w.date][w.sid]).toBe(w.id));
  const touched = new Set(proposal.writes.map((w) => `${w.sid}|${w.date}`));
  for (const [date, row] of Object.entries(data.cells)) {
    for (const [sid, v] of Object.entries(row)) {
      if (!touched.has(`${sid}|${date}`)) expect(after.cells[date][sid]).toEqual(v);
    }
  }
  expect(after.cells["2026-10-05"].s0).toEqual([{ code: "M", post: "p1" }, { code: "A" }]);

  act(() => {
    rerender(<MonthPreview proposal={proposal} data={after} update={update} T={T}
      onDiscard={jest.fn()} onApplied={onApplied} />);
  });
  expect(window.alert.mock.calls[0][0]).toMatch(/match the preview/);
  expect(onApplied).toHaveBeenCalledWith("2026-10-01", "2026-10-31");
});

test("not keeping: the confirmation says how many existing duties are replaced", () => {
  const data = makeData();
  const proposal = build(data, false);
  render(<MonthPreview proposal={proposal} data={data} update={jest.fn()} T={T}
    onDiscard={jest.fn()} onApplied={jest.fn()} />);
  fireEvent.click(screen.getAllByText("Apply to rota")[0]);
  // The split duty and the Other duty on 5 October are always replaced.
  expect(proposal.replaced).toBeGreaterThanOrEqual(2);
  expect(proposal.replacedSplit).toBeGreaterThanOrEqual(1);
  expect(window.confirm.mock.calls[0][0]).toMatch(new RegExp(`${proposal.replaced} existing duties will be replaced`));
  expect(window.confirm.mock.calls[0][0]).toMatch(/split duties or duties with a post/);
});

test("a rota that changed after building is not overwritten", () => {
  const data = makeData();
  const proposal = build(data, true);
  const changed = clone(data);
  changed.cells["2026-10-20"] = { s4: "N" };
  const update = jest.fn();
  render(<MonthPreview proposal={proposal} data={changed} update={update} T={T}
    onDiscard={jest.fn()} onApplied={jest.fn()} />);
  fireEvent.click(screen.getAllByText("Apply to rota")[0]);
  expect(update).not.toHaveBeenCalled();
  expect(window.alert.mock.calls[0][0]).toMatch(/changed since this roster was built/);
});

test("Discard writes nothing", () => {
  const data = makeData();
  const update = jest.fn();
  const onDiscard = jest.fn();
  render(<MonthPreview proposal={build(data, true)} data={data} update={update} T={T}
    onDiscard={onDiscard} onApplied={jest.fn()} />);
  fireEvent.click(screen.getAllByText("Discard")[0]);
  expect(onDiscard).toHaveBeenCalled();
  expect(update).not.toHaveBeenCalled();
});

test("totals match the rota's own counting, on the rota as it will be after Apply", () => {
  const data = { ...makeData(), nonOfficial: ["2026-10-13"], fridayRule: true };
  const proposal = build(data, true);
  render(<MonthPreview proposal={proposal} data={data} update={jest.fn()} T={T}
    onDiscard={jest.fn()} onApplied={jest.fn()} />);
  const after = clone(data);
  proposal.writes.forEach((w) => { after.cells[w.date] = { ...(after.cells[w.date] || {}), [w.sid]: w.id }; });
  const days = datesBetween("2026-10-01", "2026-10-31");

  // Each staff row ends with M, A, N, OD, RD, OFF, NON-OFF DUTY.
  const headers = [...document.querySelectorAll("thead th")].map((th) => th.textContent);
  expect(headers.slice(-7)).toEqual(["M", "A", "N", "OD", "RD", "OFF", "NON-OFF DUTY"]);
  const rows = [...document.querySelectorAll("tbody tr")];
  data.staff.forEach((s, i) => {
    const t = weekTotalsFor(after, s, days);
    const cells = [...rows[i].querySelectorAll("td")].slice(-7).map((td) => Number(td.textContent));
    expect(cells).toEqual([t.morning, t.afternoon, t.night, t.other, t.release, t.off, t.nonOfficialDuty]);
  });
  // The shift rows along the bottom: the split duty on 5 October counts for both shifts.
  const foot = [...document.querySelectorAll("tfoot tr")];
  expect(foot.map((r) => r.querySelector("td").textContent)).toEqual(["MORNING", "AFTERNOON", "NIGHT", "OTHER DUTY"]);
  ["morning", "afternoon", "night", "other"].forEach((cat, r) => {
    const counts = [...foot[r].querySelectorAll("td")].slice(1, 1 + days.length).map((td) => Number(td.textContent));
    expect(counts).toEqual(days.map((d) => dayCountFor(after, d, cat)));
  });
});

test("a chosen range is labelled with its dates and applies only inside them", () => {
  const data = makeData();
  const prep = prepareBuild({ data, from: "2026-10-07", to: "2026-10-20", keepExisting: true });
  const out = runEngine({ ...prep.config, polishSteps: 2000, attempts: 1 }, prep.chosenCodes);
  const proposal = { ...finishMonth(prep, out, data), ms: 900 };
  const update = jest.fn();
  render(<MonthPreview proposal={proposal} data={data} update={update} T={T}
    onDiscard={jest.fn()} onApplied={jest.fn()} />);
  expect(screen.getByText(/Roster for 7 Oct – 20 Oct 2026/)).toBeInTheDocument();
  expect(document.querySelectorAll("thead th").length).toBe(1 + 14 + 7);
  fireEvent.click(screen.getAllByText("Apply to rota")[0]);
  expect(window.confirm.mock.calls[0][0]).toMatch(/between 7 Oct and 20 Oct/);
  const after = update.mock.calls[0][0](clone(data));
  Object.keys(after.cells).forEach((date) => {
    if (date < "2026-10-07" || date > "2026-10-20") expect(after.cells[date]).toEqual(data.cells[date]);
  });
});

test("shifts with nobody in charge are named with the ward's own word", () => {
  const data = { ...makeData(), rosterRules: { seniorTerm: "In-charge" } };
  const proposal = { ...build(data, true), seniorGaps: [{ date: "2026-10-06", shift: "night" }, { date: "2026-10-07", shift: "morning" }] };
  render(<MonthPreview proposal={proposal} data={data} update={jest.fn()} T={T}
    onDiscard={jest.fn()} onApplied={jest.fn()} />);
  expect(screen.getByText("2 shifts with no in-charge:")).toBeInTheDocument();
  expect(screen.getByText(/2 with no in-charge/)).toBeInTheDocument();
  expect(screen.queryByText(/anyone in charge/)).toBeNull();
});
