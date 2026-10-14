/* The month preview, drawn with a real built month: it renders, marks the
   cells that change, and Apply writes exactly those cells in one update(),
   checks them, and refuses if the rota changed after building. */

import { render, screen, fireEvent, act } from "@testing-library/react";
import { datesBetween } from "./rosterEngine";
import { prepareMonth, finishMonth, runEngine } from "./monthBuild";
import MonthPreview from "./MonthPreview";

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
  expect(screen.getByText(/October 2026 roster/)).toBeInTheDocument();
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
  fireEvent.click(screen.getByText("Apply to rota"));
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
  fireEvent.click(screen.getByText("Apply to rota"));
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
  fireEvent.click(screen.getByText("Apply to rota"));
  expect(update).not.toHaveBeenCalled();
  expect(window.alert.mock.calls[0][0]).toMatch(/changed since this month was built/);
});

test("Discard writes nothing", () => {
  const data = makeData();
  const update = jest.fn();
  const onDiscard = jest.fn();
  render(<MonthPreview proposal={build(data, true)} data={data} update={update} T={T}
    onDiscard={onDiscard} onApplied={jest.fn()} />);
  fireEvent.click(screen.getByText("Discard"));
  expect(onDiscard).toHaveBeenCalled();
  expect(update).not.toHaveBeenCalled();
});
