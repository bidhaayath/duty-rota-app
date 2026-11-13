/* Ini's panel with one person's rules: the questions Ini asks on a line it
   could not finish, answered on screen, and everything saved in one step.
   The server's answer is made by the server's own checks from what Claude
   might say; the database and Claude are stand-ins. */

import { render, screen, fireEvent, within } from "@testing-library/react";
import AssistantPanel from "./AssistantPanel";

const parse = require("../api/ai/parse.js")._test;

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
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };
const daysOn = (n) => daysAgo(-n);

const STAFF = [["ana", "RN ANA"], ["rah", "RAHEEMA"], ["sha", "SHAU"], ["mar", "MARIYAM"], ["ras", "RASHEE"]];
const makeData = () => ({
  staff: STAFF.map(([id, name]) => ({ id, name, leavePeriods: [] })),
  codes: [{ id: "M", code: "M", counts: "morning" }], cells: {}, nonOfficial: [], dutyRequests: [],
});

test("Ini asks on the line, the answers tick it, and the whole note saves in one step", async () => {
  // Rashee's night is on a date that has gone by, so Ini asks which year.
  const gone = daysAgo(17);
  const note = "Ana gets all morning duty and is off on Friday and Saturday. Shau will get only 1 night duty a week. "
    + "If Mariyam is having two nights in a week, give them days apart. Rashee: night on the 27th. Raheema is on leave from the 3rd.";
  const claude = { actions: [
    { type: "set_shifts", staff: "s1", shifts: ["morning"] },
    { type: "person_rule", staff: "s1", rule: "offOn", shift: null, count: null, days: [5, 6], shifts: null, weekend: false, must: false },
    { type: "person_rule", staff: "s3", rule: "atMost", shift: "night", count: 1, days: null, shifts: null, weekend: false, must: false },
    { type: "person_rule", staff: "s4", rule: "apart", shift: "night", count: null, days: null, shifts: null, weekend: false, must: false },
    { type: "fixed_duty", staff: "s5", date: gone, duty: "night" },
    // Leave from a day, with no last day: Ini asks until when.
    { type: "add_leave", staff: "s2", leaveType: null, start: daysOn(20), end: null },
  ], unclear: [] };
  global.fetch = jest.fn((url, req) => {
    const { input } = parse.readInput(JSON.parse(req.body));
    const out = parse.checkAnswer(claude, input, iso(new Date()));
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, ...out, usage: { cap: 20, used: 2, remaining: 18 } }) });
  });

  let data = makeData();
  const update = jest.fn((fn) => { data = fn(JSON.parse(JSON.stringify(data))); });
  const panel = (d) => <AssistantPanel visible deptId="11111111-1111-1111-1111-111111111111" data={d} update={update} T={T}
    uid={uidFn} dstr={iso} canBuild onMonthApplied={jest.fn()} />;
  const uidFn = (() => { let n = 0; return () => `r${++n}`; })();
  const { rerender } = render(panel(data));
  fireEvent.click(screen.getByLabelText("Ask Ini"));
  fireEvent.change(await screen.findByPlaceholderText(/Fathimath Easa/), { target: { value: note } });
  fireEvent.click(screen.getByText("Read my note"));

  expect(await screen.findByText("Your staff")).toBeInTheDocument();
  expect(screen.getByText("Rule · RN ANA · Always off on Friday and Saturday — starts as Must")).toBeInTheDocument();
  // Two lines wait for an answer, and cannot be ticked until then.
  const apart = screen.getByRole("checkbox", { name: "Rule · MARIYAM · At least ? days between nights — starts as Try" });
  expect(apart).toBeDisabled();
  expect(screen.getAllByText("Answer Ini's question to add this.")).toHaveLength(3);
  expect(screen.getByRole("button", { name: "Add 3 items" })).toBeInTheDocument();

  const gap = screen.getByRole("group", { name: "How many days between MARIYAM's nights?" });
  fireEvent.click(within(gap).getByRole("button", { name: "One more" }));
  fireEvent.click(within(gap).getByRole("button", { name: "One more" }));
  expect(screen.getByRole("checkbox", { name: "Rule · MARIYAM · At least 3 days between nights — starts as Try" })).toBeChecked();

  const year = Number(gone.slice(0, 4)) + 1;
  fireEvent.click(screen.getByRole("button", { name: String(year) }));
  // The kind of leave was not in the note: asked, never assumed.
  fireEvent.click(within(screen.getByRole("group", { name: "What kind of leave is RAHEEMA on?" })).getByRole("button", { name: "Annual leave" }));
  fireEvent.change(within(screen.getByRole("group", { name: "Until when is RAHEEMA on leave?" })).getByLabelText("Last day of leave"), { target: { value: daysOn(24) } });
  expect(screen.queryByText("Answer Ini's question to add this.")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Add 6 items" }));
  // The panel says Added once the saved rota comes back to it.
  rerender(panel(data));
  await screen.findByText(/^Added /);

  // One update: one Undo takes all of it back.
  expect(update).toHaveBeenCalledTimes(1);
  expect(data.rosterRules).toEqual({
    staffShifts: { ana: ["morning"] },
    personRules: [
      { id: expect.any(String), staffId: "ana", type: "offOn", days: [5, 6], strength: "hard" },
      { id: expect.any(String), staffId: "sha", type: "atMost", shift: "night", count: 1, strength: "soft" },
      { id: expect.any(String), staffId: "mar", type: "apart", shift: "night", count: 3, strength: "soft" },
    ],
    fixedDuties: [{ id: expect.any(String), staffId: "ras", date: `${year}${gone.slice(4)}`, duty: "night" }],
  });
  expect(data.staff.find((p) => p.id === "rah").leavePeriods)
    .toEqual([{ id: expect.any(String), type: "annual", start: daysOn(20), end: daysOn(24) }]);
});

test("a name that could be two people is asked about, offering only them", async () => {
  global.fetch = jest.fn((url, req) => {
    const { input } = parse.readInput(JSON.parse(req.body));
    const out = parse.checkAnswer({ actions: [
      { type: "set_skip", staff: null, choices: ["s1", "s6"], named: "Ana", skip: true },
    ], unclear: [] }, input, iso(new Date()));
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, ...out }) });
  });
  let data = makeData();
  data.staff.push({ id: "ana2", name: "ANA MOOSA", leavePeriods: [] });
  const update = jest.fn((fn) => { data = fn(JSON.parse(JSON.stringify(data))); });
  const panel = (d) => <AssistantPanel visible deptId="11111111-1111-1111-1111-111111111111" data={d} update={update} T={T}
    uid={uidFn} dstr={iso} canBuild onMonthApplied={jest.fn()} />;
  const uidFn = () => "u";
  const { rerender } = render(panel(data));
  fireEvent.click(screen.getByLabelText("Ask Ini"));
  fireEvent.change(await screen.findByPlaceholderText(/Fathimath Easa/), { target: { value: "Skip Ana" } });
  fireEvent.click(screen.getByText("Read my note"));

  expect(await screen.findByText('Who is "Ana"?')).toBeInTheDocument();
  const picker = screen.getByRole("combobox");
  expect([...picker.options].map((o) => o.textContent)).toEqual(["Choose who…", "RN ANA", "ANA MOOSA"]);
  expect(screen.getByRole("checkbox", { name: "Skip · Ana · on the rota → skipped" })).toBeDisabled();

  fireEvent.change(picker, { target: { value: "ana2" } });
  expect(screen.getByRole("checkbox", { name: "Skip · ANA MOOSA · on the rota → skipped" })).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Add 1 item" }));
  // The panel says Added once the saved rota comes back to it.
  rerender(panel(data));
  await screen.findByText(/^Added /);
  expect(data.rosterRules).toEqual({ skipStaff: ["ana2"] });
});
