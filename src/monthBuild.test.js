/* The month-building action: whole weeks at the edges of the month, locked
   cells, the fallback, look-back choices, and an end-to-end build checking
   that nothing outside the month — and nothing kept — is ever written. */

import { datesBetween } from "./rosterEngine";
import {
  prepareMonth, finishMonth, runEngine, lookbackOptions, lookbackIdFor, lookbackSentence,
  monthFingerprint,
} from "./monthBuild";

const CODES = [
  { id: "M", code: "M", color: "#F4B860", counts: "morning" },
  { id: "MR", code: "M(R)", color: "#E8A33D", counts: "morning" },
  { id: "A", code: "A", color: "#8FBF6B", counts: "afternoon" },
  { id: "N", code: "N", color: "#6FA8DC", counts: "night" },
  { id: "E", code: "E", color: "#8E7CC3", counts: "evening" },
  { id: "OFF", code: "OFF", color: "#FFFFFF", counts: "off" },
  { id: "NOFF", code: "(N)OFF", color: "#E8EEF2", counts: "off" },
  { id: "SL", code: "SL", color: "#F0A090", counts: "sl" },
  { id: "OT", code: "OT", color: "#8E7CC3", counts: "other" },
];
const CYCLE = ["M", "A", "N", "NOFF", "OFF", "M", "A"];
const CAT = { M: "morning", A: "afternoon", N: "night", OFF: "off", NOFF: "off" };

// Ten staff with a workable rota from 20 August to the end of September.
const makeData = () => {
  const staff = [...Array(10)].map((_, i) => ({ id: `s${i}`, name: `Staff ${i}` }));
  const cells = {};
  datesBetween("2026-08-20", "2026-09-30").forEach((date, di) => {
    cells[date] = {};
    staff.forEach((s, si) => { cells[date][s.id] = CYCLE[(di + si) % 7]; });
  });
  // Already on October's rota:
  cells["2026-10-05"] = { s0: [{ code: "MR", post: "p1" }, { code: "E", post: "p2" }] };  // split, with posts
  cells["2026-10-06"] = { s1: "OT" };                                                     // Other duty
  cells["2026-10-07"] = { s2: "SL", s5: "N" };                                            // sick leave, a night
  cells["2026-10-08"] = { s3: "A" };                                                      // view-only person
  return {
    staff, codes: CODES, cells, weekStartsOn: 0, fridayRule: true,
    rosterRules: { skipStaff: ["s4"] },
    dutyRequests: [{ id: "r", staffId: "s5", date: "2026-10-07", category: "morning", approved: true }],
  };
};

describe("whole weeks at the edges of the month", () => {
  test("October 2026 (starts Thursday) is built from Sunday 27 September", () => {
    const p = prepareMonth({ data: makeData(), month: "2026-10" });
    expect(p.buildFrom).toBe("2026-09-27");
    expect(p.buildTo).toBe("2026-10-31");            // a Saturday: already the end of a week
    expect(p.padded).toBe(true);
    expect(p.fellBack).toBe(false);
  });

  test("November 2026 runs on to the end of the week holding the 30th", () => {
    const p = prepareMonth({ data: makeData(), month: "2026-11" });
    expect(p.buildFrom).toBe("2026-11-01");
    expect(p.buildTo).toBe("2026-12-05");
  });

  test("Monday weeks move the edges", () => {
    const p = prepareMonth({ data: { ...makeData(), weekStartsOn: 1 }, month: "2026-10" });
    expect(p.buildFrom).toBe("2026-09-28");
    expect(p.buildTo).toBe("2026-11-01");
  });

  test("last month's duties in that week are locked; skipped staff are not", () => {
    const data = makeData();
    const p = prepareMonth({ data, month: "2026-10" });
    expect(p.pinned["s0|2026-09-27"]).toBe(CAT[data.cells["2026-09-27"].s0]);
    expect(p.pinned["s4|2026-09-27"]).toBeUndefined();
    const req = p.config.requests.find((r) => r.staffId === "s7" && r.date === "2026-09-30");
    expect(req.category).toBe(CAT[data.cells["2026-09-30"].s7]);
  });

  test("a refusal caused only by last month's days falls back to the month on its own", () => {
    const data = makeData();
    data.staff.forEach((s) => { data.cells["2026-09-28"][s.id] = "OFF"; });   // nobody worked
    const p = prepareMonth({ data, month: "2026-10" });
    expect(p.fellBack).toBe(true);
    expect(p.padded).toBe(false);
    expect(p.buildFrom).toBe("2026-10-01");
  });
});

describe("keeping what is already on the rota", () => {
  test("ticked: every filled cell is locked, in the way the engine understands", () => {
    const p = prepareMonth({ data: makeData(), month: "2026-10", keepExisting: true });
    expect(p.pinned["s0|2026-10-05"]).toBe("morning");     // split duty: its first duty counts
    expect(p.pinned["s5|2026-10-07"]).toBe("night");
    expect(p.blocked.has("s1|2026-10-06")).toBe(true);     // Other duty: a one-day absence
    const s1 = p.config.staff.find((s) => s.id === "s1");
    expect(s1.leavePeriods).toEqual([{ id: "lock-s1-2026-10-06", type: "other", start: "2026-10-06", end: "2026-10-06" }]);
    // Sick leave is left alone by the engine already.
    expect(p.pinned["s2|2026-10-07"]).toBeUndefined();
    // The night on the rota wins over the approved morning request: one per day.
    const s5 = p.config.requests.filter((r) => r.staffId === "s5" && r.date === "2026-10-07");
    expect(s5).toEqual([{ staffId: "s5", date: "2026-10-07", category: "night" }]);
  });

  test("unticked: cells inside the month are free, last month's still locked", () => {
    const p = prepareMonth({ data: makeData(), month: "2026-10", keepExisting: false });
    expect(p.pinned["s0|2026-10-05"]).toBeUndefined();
    expect(p.blocked.has("s1|2026-10-06")).toBe(false);
    expect(p.pinned["s0|2026-09-27"]).toBe(CAT[makeData().cells["2026-09-27"].s0]);
  });

  test("view-only staff are locked every day, empty days included", () => {
    const p = prepareMonth({ data: makeData(), month: "2026-10", keepExisting: false, lockedStaffIds: ["s3"] });
    expect(p.pinned["s3|2026-10-08"]).toBe("afternoon");
    expect(p.blocked.has("s3|2026-10-09")).toBe(true);
  });
});

describe("look-back choices", () => {
  test("usual follows Smart Roster's setting; January has no 'since 1 January'", () => {
    const nov = lookbackOptions("2026-11", { lookbackDays: 30 }, null);
    expect(nov.map((o) => o.id)).toEqual(["usual", "year", "3m", "6m"]);
    expect(nov[0].from).toBe("2026-10-02");
    expect(nov.find((o) => o.id === "3m").from).toBe("2026-08-01");
    expect(lookbackSentence(nov[0], "2026-11")).toBe("Fairness based on rosters from 2 Oct to 31 Oct.");
    expect(lookbackOptions("2027-01", {}, null).map((o) => o.id)).toEqual(["usual", "3m", "6m"]);
  });

  test("a date from the note is preselected, reusing a matching choice", () => {
    const opts = lookbackOptions("2026-11", {}, "2026-01-01");
    expect(lookbackIdFor(opts, "2026-01-01")).toBe("year");
    const own = lookbackOptions("2026-11", {}, "2026-03-15");
    expect(lookbackIdFor(own, "2026-03-15")).toBe("note");
    expect(lookbackSentence({ from: "2025-12-01" }, "2026-11")).toBe("Fairness based on rosters from 1 Dec 2025 to 31 Oct 2026.");
  });
});

describe("end to end with the engine", () => {
  const run = (opts) => {
    const data = makeData();
    const prep = prepareMonth({ data, month: "2026-10", ...opts });
    // Fewer improvement steps so the test is quick; the rules are the same.
    const out = runEngine({ ...prep.config, polishSteps: 3000, attempts: 1 }, prep.chosenCodes);
    expect(out.ok).toBe(true);
    return { data, prep, out, fin: finishMonth(prep, out, data) };
  };

  test("keeping: nothing outside the month and nothing already filled is written", () => {
    const { data, out, fin } = run({ keepExisting: true, lockedStaffIds: ["s3"] });
    expect(fin.writes.length).toBeGreaterThan(0);
    fin.writes.forEach((w) => {
      expect(w.date >= "2026-10-01" && w.date <= "2026-10-31").toBe(true);
      expect((data.cells[w.date] || {})[w.sid]).toBeUndefined();   // only empty cells
      expect(["s3", "s4"]).not.toContain(w.sid);                  // view-only, skipped
    });
    expect(fin.replaced).toBe(0);

    // Nobody goes over five duties in the week that straddles the 1st,
    // counting the days already worked in September.
    for (const s of data.staff) {
      if (s.id === "s4") continue;
      const worked = datesBetween("2026-09-27", "2026-10-03")
        .filter((d) => out.cells[`${s.id}|${d}`] && out.cells[`${s.id}|${d}`] !== "off").length;
      expect(worked).toBeLessThanOrEqual(5);
    }
  }, 60000);

  test("not keeping: existing duties may be replaced, and are counted", () => {
    const { data, fin } = run({ keepExisting: false });
    const touched = fin.writes.filter((w) => data.cells[w.date] && data.cells[w.date][w.sid]);
    expect(fin.replaced).toBe(touched.length);
    // Sick leave is never written over.
    expect(fin.writes.some((w) => w.sid === "s2" && w.date === "2026-10-07")).toBe(false);
    // A write is only listed where the cell actually changes.
    fin.writes.forEach((w) => expect(data.cells[w.date]?.[w.sid]).not.toBe(w.id));
  }, 60000);

  test("the fingerprint notices a change to the month, and ignores one outside it", () => {
    const data = makeData();
    const before = monthFingerprint(data, "2026-09-27", "2026-10-31");
    const other = JSON.parse(JSON.stringify(data));
    other.cells["2026-08-25"].s1 = "OFF";
    expect(monthFingerprint(other, "2026-09-27", "2026-10-31")).toBe(before);
    other.cells["2026-10-05"].s9 = "N";
    expect(monthFingerprint(other, "2026-09-27", "2026-10-31")).not.toBe(before);
  });
});
