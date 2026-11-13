/**
 * @jest-environment node
 */
/* Ini, with the REAL model: Bidhoo's paragraph read three times, through the
   server's own prompt and checks and the app's own checklist, and the lines
   compared. Skipped unless ANTHROPIC_API_KEY is set, so it never runs (or
   costs anything) in normal test runs. Each run is one request, the same as
   one "Read my note". To run it:

     PowerShell:  $env:ANTHROPIC_API_KEY="sk-…"; $env:CI="true"; npx react-scripts test --watchAll=false --testPathPattern iniLive
     Git Bash:    ANTHROPIC_API_KEY=sk-… CI=true npx react-scripts test --watchAll=false --testPathPattern iniLive

   Only the rota below (made-up, with the paragraph's names) is sent. */

import { readReply, checkLines } from "./iniActions";

const parse = require("../api/ai/parse.js")._test;

const KEY = process.env.ANTHROPIC_API_KEY;
const RUNS = 3;
const PARAGRAPH = "Ana gets all morning duty and is off on Friday and Saturday. Raheema is doing only morning and "
  + "afternoon duty, no night. Shau will get only 1 night duty a week. If Mariyam is having two nights in a week, "
  + "give them days apart. Rashee is going on leave on 28 December so the day before she leaves give a night duty.";
// As on the rota tested: Raheema already morning and afternoon only, Mariyam already 4 days between nights.
const STAFF = [["ana", "RN ANA"], ["rah", "RAHEEMA"], ["sha", "SHAU"], ["mar", "RN MARIYAM"], ["ras", "RASHEE"],
  ["ali", "ALI"], ["haw", "HAWWA"], ["ais", "AISHATH"]];
const data = {
  staff: STAFF.map(([id, name]) => ({ id, name, leavePeriods: [] })),
  codes: [{ id: "M", code: "M", counts: "morning" }, { id: "A", code: "A", counts: "afternoon" },
    { id: "N", code: "N", counts: "night" }, { id: "O", code: "OFF", counts: "off" }],
  cells: {}, nonOfficial: [], dutyRequests: [],
  rosterRules: {
    staffShifts: { rah: ["morning", "afternoon"] },
    personRules: [{ id: "old", staffId: "mar", type: "apart", shift: "night", count: 4, strength: "soft" }],
  },
};
const EXPECTED = [
  "Shifts · RN ANA · any shift → morning only",
  "Rule · RN ANA · Always off on Friday and Saturday — starts as Must",
  "Shifts · RAHEEMA · morning and afternoon only → morning and afternoon only  [refused: RAHEEMA is already set up for morning and afternoon only.]",
  "Rule · SHAU · At most 1 night a week — starts as Try",
  "Rule · RN MARIYAM · At least ? days between nights — starts as Try  [asks: How many days between RN MARIYAM's nights?]",
  "Leave · RASHEE · from Mon 28 Dec until ?  [asks: What kind of leave is RASHEE on?]",
  "Fixed duty · RASHEE · Night on Sun 27 Dec 2026, fixed by you — always kept",
];

const lineText = (l) => {
  const t = l.words.title || [l.words.what, Object.values(l.people).map((p) => p.name).join(" & "), l.words.when].filter(Boolean).join(" · ");
  return t + (l.blocked ? `  [refused: ${l.blocked}]` : l.ask ? `  [asks: ${l.ask.question}]` : "");
};

(KEY ? test : test.skip)(`the paragraph, ${RUNS} real runs, gives the same lines every time`, async () => {
  const today = parse.todayMaldives();
  const { input } = parse.readInput({
    departmentId: "11111111-1111-1111-1111-111111111111", text: PARAGRAPH, from: "2026-12-01", to: "2026-12-31",
    staff: data.staff.map((s) => ({ id: s.id, name: s.name })), shifts: ["morning", "afternoon", "night"],
    leaveTypes: ["annual", "maternity", "prematernity", "emergency", "other"],
    codes: data.codes, seniorTerm: "In-charge",
  });
  const runs = [];
  for (let i = 0; i < RUNS; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const answer = await parse.askClaude({ anthropicKey: KEY }, input, today);
    expect(answer).toBeTruthy();
    const body = { ok: true, ...parse.checkAnswer(answer, input, today) };
    const reply = readReply(body, { staffIds: data.staff.map((s) => s.id), from: "2026-12-01", to: "2026-12-31", today });
    const lines = checkLines(reply.lines, { data, today }).map(lineText);
    runs.push({ lines, notAdded: reply.unclear });
    // eslint-disable-next-line no-console
    console.log(`Run ${i + 1}\n  ${lines.join("\n  ")}\n  Not added: ${reply.unclear.length ? reply.unclear.join(" | ") : "(nothing)"}`);
  }
  runs.forEach((r) => {
    expect([...r.lines].sort()).toEqual([...EXPECTED].sort());
    expect(r.notAdded).toEqual([]);
  });
}, 180000);
