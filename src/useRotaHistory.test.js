/* Undo and redo for ordinary hand edits, with the rota loading the way
   DutyRotaOriginal.js loads it: empty while a department opens, then the
   saved rota. Each edit is a fresh copy, as update() makes. */

import { useState } from "react";
import { render, act } from "@testing-library/react";
import { useRotaHistory } from "./useRotaHistory";

let h = {};
function Harness() {
  const [data, setData] = useState(null);
  const [deptId, setDeptId] = useState(null);
  const history = useRotaHistory(data, setData, deptId);
  h = {
    data, history,
    // Same order as the app: empty the rota, change department, then load.
    open: (id, rota) => { setData(null); setDeptId(id); setTimeout(() => setData(rota), 0); },
    edit: (fn) => setData((d) => fn(JSON.parse(JSON.stringify(d)))),
    retrySave: () => setData((d) => JSON.parse(JSON.stringify(d))),
  };
  return null;
}

const rota = (name = "Ward A") => ({
  title: name,
  staff: [{ id: "a", name: "Ali", leavePeriods: [] }],
  codes: [{ id: "M", code: "M" }, { id: "N", code: "N" }],
  cells: { "2026-11-02": { a: "M" } },
  cellMeta: {}, nonOfficial: [], dutyRequests: [],
});
const setCell = (date, code) => (d) => { d.cells[date] = { ...(d.cells[date] || {}), a: code }; return d; };
const open = async (id, r) => {
  act(() => { h.open(id, r); });
  await act(async () => { await new Promise((ok) => setTimeout(ok, 5)); });
};

test("two hand edits are two steps; undoing both returns the rota as loaded, and a third Undo does nothing", async () => {
  render(<Harness />);
  await open("d1", rota());
  const loaded = JSON.stringify(h.data);
  expect(h.history.canUndo).toBe(false);          // opening is not an edit

  act(() => { h.edit(setCell("2026-11-02", "N")); });
  act(() => { h.edit(setCell("2026-11-03", "M")); });
  expect(h.history.depth).toBe(2);
  expect(h.history.undoLabel).toBe("M given to Ali on 3 Nov");

  act(() => { h.history.undo(); });
  expect(h.history.undoLabel).toBe("Ali's duty on 2 Nov changed from M to N");
  expect(h.data.cells["2026-11-03"]).toBeUndefined();
  act(() => { h.history.undo(); });
  expect(JSON.stringify(h.data)).toBe(loaded);
  expect(h.history.canUndo).toBe(false);

  act(() => { h.history.undo(); });                // nothing left: the rota stays
  expect(h.data).not.toBeNull();
  expect(JSON.stringify(h.data)).toBe(loaded);

  // Redo steps forward again, in order.
  act(() => { h.history.redo(); });
  expect(h.data.cells["2026-11-02"].a).toBe("N");
  expect(h.data.cells["2026-11-03"]).toBeUndefined();
  act(() => { h.history.redo(); });
  expect(h.data.cells["2026-11-03"].a).toBe("M");
  expect(h.history.canRedo).toBe(false);
});

test("a fresh edit after an undo clears the redo trail", async () => {
  render(<Harness />);
  await open("d1", rota());
  act(() => { h.edit(setCell("2026-11-02", "N")); });
  act(() => { h.history.undo(); });
  expect(h.history.canRedo).toBe(true);
  act(() => { h.edit(setCell("2026-11-04", "N")); });
  expect(h.history.canRedo).toBe(false);
  expect(h.history.depth).toBe(1);
});

test("switching department drops the trail, and the new department starts with nothing to undo", async () => {
  render(<Harness />);
  await open("d1", rota("Ward A"));
  act(() => { h.edit(setCell("2026-11-02", "N")); });
  expect(h.history.canUndo).toBe(true);

  await open("d2", rota("Ward B"));
  expect(h.data.title).toBe("Ward B");
  expect(h.history.canUndo).toBe(false);
  expect(h.history.canRedo).toBe(false);
  act(() => { h.history.undo(); });
  expect(h.data.title).toBe("Ward B");             // never empty, never Ward A
});

test('"Try saving again" (a new copy with the same content) is not filed as a step', async () => {
  render(<Harness />);
  await open("d1", rota());
  act(() => { h.edit(setCell("2026-11-02", "N")); });
  act(() => { h.retrySave(); });
  expect(h.history.depth).toBe(1);
  expect(h.history.undoLabel).toBe("Ali's duty on 2 Nov changed from M to N");
});
