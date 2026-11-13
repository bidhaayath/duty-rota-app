/* ─────────────── Ini's actions: the catalogue ───────────────
   Every change Ini can make is one entry here. The panel (AssistantPanel.js)
   knows nothing about any of them: it shows the lines, lets the manager
   tick and correct them, and saves them all in one update(), so one Undo
   takes the lot back. Adding an action means adding one entry.

   An entry:
     type        the server's action type (api/ai/parse.js)
     group       which part of the checklist it is shown in (GROUPS below)
     order       where it is applied within its group
     people      the fields holding a staff id; each gets a person picker,
                 and is blocked when that person is gone or view-only
     fromServer  (item, period) -> the line's own fields, or null to drop it
     span        (line) -> [first, last] date it touches, or none; lines
                 outside the period start unticked
     describe    (line, ctx) -> { what, when, details?, title? }   plain words;
                 details is an optional list shown under "Show"; title, when
                 given, is the whole line ("Change …'s gap … from 4 to 3 days")
     check       (line, ctx) -> { blocked?, warnings? }
     apply       (draft, line, { uid, today }) -> draft
     saved       (count) -> "2 leave periods", for the message after saving
     savedAs     optional: entries sharing it are counted together there
     footnote    optional sentence shown under the group
     tabNote     optional { tabName: sentence } shown while on that tab
     opensRequests  offer "Open Duty Requests" after saving
     applyOrder  optional: applied at this point instead of its group's
     asks        optional (line, { today }) -> { kind, question, ... } when
                 Ini could not finish the line and asks the manager instead
     missing     optional (line) -> true while that question is unanswered;
                 such a line cannot be ticked, checked or saved
     together    optional (final, ctx) -> warnings, for a check that only
                 makes sense on the result of several lines at once. Entries
                 sharing the same function are one family: it runs once, on
                 the rota as it will be after every ticked line, and its
                 warnings go on the family's last line that will be saved.

   A name in the note that could be two people arrives with no person and
   `choices` (and `named`, the name as written): the panel asks which, from
   those people only, and the line waits for the answer.

   check gets ctx = { data, sim, staffEditable, today }: `data` is the rota as it
   is now, `sim` the rota as it will be once every ticked line above this
   one is saved. So a request sees leave added a line earlier, and two
   lines that touch the same day know about each other. apply gets
   staffEditable too, for a line naming several people.

   apply is used both to work out `sim` and to save, so the warnings
   describe exactly what is saved. For that it must never change an object
   it was given: it sets top-level fields on the draft (d.staff,
   d.dutyRequests, d.cells, ...) to NEW objects, and leaves the old ones
   alone. A cell is a plain code id or a list of duties with posts; an
   apply that touches cells must handle both.

   Out of reach on purpose: billing and plans, members, invites, roles,
   deleting staff or departments, other departments. None of them lives in
   the rota, and an action type that is not listed here is ignored. */

import { addLeave, addRequest, weeklyOff } from "./leaveAndRequests";
import { setCode, clearDays, swapDuties, setNonOfficial } from "./rotaEdits";
import { setShifts, setOffsPerWeek, setMaxInARow, setSeniorCover, setSeniors } from "./settings";
import { setSkip, personRule, fixedDuty } from "./people";
import { build } from "./build";
import { plural, listWords, staffOf } from "./shared";

export { LEAVE_TYPES } from "./shared";

/* Shown in this order. Applied: the ward's settings first, then each
   person's, then leave and requests, then changes to the rota — so a duty
   written on a day sees leave added in the same note and skips it, rather
   than being written and then hidden under the leave. The build always
   comes last, after saving. Within a group, lines are applied in the
   order the note gave them unless an entry says otherwise. */
export const GROUPS = [
  { id: "rota", title: "Changes to the rota", applyOrder: 3 },
  { id: "leave", title: "Leave & requests", applyOrder: 2 },
  { id: "people", title: "Your staff", note: "Each person's own, from now on: as in Smart Roster → Your staff", applyOrder: 1.5 },
  { id: "settings", title: "Standing settings", note: "Standing setting: applies from now on", applyOrder: 1 },
];

const CATALOGUE = Object.fromEntries(
  [addLeave, addRequest, weeklyOff, setCode, clearDays, swapDuties, setNonOfficial,
    setShifts, setOffsPerWeek, setMaxInARow, setSeniorCover, setSeniors,
    setSkip, personRule, fixedDuty, build].map((e) => [e.type, e]),
);
export const entryFor = (type) => CATALOGUE[type] || null;

/* Actions the server can already suggest but this panel cannot carry out
   yet. Each is mentioned under "Not added", once, rather than vanishing.
   An entry leaves this list when it joins the catalogue; every action the
   server sends today has one, so the list is empty. */
const COMING = {};

/* The server's actions. Until every server sends `actions`, the older
   reply (leave, requests, build) is turned into the same thing. */
export function actionsOf(body) {
  if (Array.isArray(body.actions)) return body.actions.filter((a) => a && typeof a === "object");
  const out = [];
  (Array.isArray(body.leave) ? body.leave : []).forEach((l) => out.push({
    type: "add_leave", staffId: l.staffId, leaveType: l.type, start: l.start, end: l.end,
  }));
  (Array.isArray(body.requests) ? body.requests : []).forEach((r) => out.push({
    type: "add_request", staffId: r.staffId, date: r.date, duty: r.category,
  }));
  if (body.build === true) {
    out.push({ type: "build", from: body.buildFrom, to: body.buildTo, historyFrom: body.historyFrom });
  }
  return out;
}

/* The server's answer, turned into checklist lines. `staffIds` are the
   people the note was read against; a line naming anyone else is dropped.
   Anything outside the period (or the dates the note asks to build) is
   kept but starts unticked, so it is never added by accident. */
export function readReply(body, { staffIds, from, to, today = todayISO() }) {
  const actions = actionsOf(body || {});
  const known = new Set(staffIds);
  const b = actions.find((a) => a.type === "build");
  const buildLine = b ? build.fromServer(b, { from, to }) : null;
  const pFrom = buildLine ? buildLine.from : from;
  const pTo = buildLine ? buildLine.to : to;

  const lines = [];
  const coming = new Set();
  actions.forEach((a, i) => {
    const entry = CATALOGUE[a.type];
    if (!entry) { if (COMING[a.type]) coming.add(a.type); return; }
    if (entry.afterSave) return;
    const fields = entry.fromServer(a, { from, to });
    if (!fields) return;
    const people = entry.people || [];
    // A name that could be two or more people: ask which, from those only.
    const choices = (Array.isArray(a.choices) ? a.choices : []).filter((c) => c && known.has(c.staffId));
    const ask = people.length === 1 && !fields[people[0]] && choices.length > 1;
    if (!ask && people.some((p) => !known.has(fields[p]))) return;
    if ((ask || entry.asks) && (a.staffName || a.named)) fields.named = String(a.named || a.staffName);
    if (ask) fields.choices = choices.map((c) => ({ staffId: c.staffId, staffName: String(c.staffName || "") }));
    const question = ask ? { kind: "person", question: `Who is "${fields.named || "this"}"?` }
      : entry.asks ? entry.asks(fields, { today }) : null;
    const span = entry.span ? entry.span(fields) : null;
    const outside = !!span && (span[1] < pFrom || span[0] > pTo);
    lines.push({
      key: `${a.type}-${i}`, type: a.type, ...fields, ...(question ? { ask: question } : {}),
      outside, checked: !outside && !question,
    });
  });

  const unclear = (Array.isArray(body?.unclear) ? body.unclear : [])
    .map((u) => String(u || "").trim()).filter(Boolean);
  [...coming].forEach((t) => {
    unclear.push(`Your note asks for ${COMING[t]}. Ini cannot do that yet, so it was not added. You can make the change by hand for now.`);
  });
  return { lines, unclear, build: buildLine };
}

const byApplyOrder = (lines) => {
  const g = Object.fromEntries(GROUPS.map((x) => [x.id, x.applyOrder]));
  return lines
    .map((l, i) => ({ l, i, e: CATALOGUE[l.type] }))
    .filter((x) => x.e && x.e.apply)
    .sort((a, b) => ((a.e.applyOrder ?? g[a.e.group]) - (b.e.applyOrder ?? g[b.e.group]))
      || ((a.e.order || 0) - (b.e.order || 0)) || (a.i - b.i));
};

// A line still waiting for the manager's answer: a person to pick, or the entry's own question.
const waiting = (e, l) => (e.people || []).some((p) => !l[p]) || (!!e.missing && e.missing(l));

// The checks every line gets, then the entry's own.
function checkOne(entry, l, ctx, staffEditable) {
  const people = {};
  let blocked = "";
  for (const field of entry.people || []) {
    const who = staffOf(ctx.sim, l[field]);
    people[field] = who;
    if (blocked) continue;
    if (!who) blocked = "This person is no longer on the rota, so this cannot be added.";
    else if (!staffEditable(who.id)) blocked = `${who.name} is view-only on your current plan, so this cannot be added.`;
  }
  const own = blocked ? {} : (entry.check ? entry.check(l, { ...ctx, staffEditable }) || {} : {});
  const warnings = [...(own.warnings || [])];
  if (l.outside) warnings.unshift("outside the dates you chose");
  return { people, blocked: blocked || own.blocked || "", warnings };
}

const PREVIEW = { uid: () => "ini-preview", today: "" };

/* Every line with its checks: { ...line, people, blocked, warnings, on,
   words }, in the order given. Worked out afresh whenever a line is ticked
   or corrected, so the warnings follow straight away. */
export function checkLines(lines, { data, staffEditable = () => true, today = todayISO() }) {
  const out = {};
  const lastOf = new Map();      // together-check -> key of its last saved line
  let sim = data;
  byApplyOrder(lines).forEach(({ l, e }) => {
    const words = e.describe(l, { data, sim, staffEditable });
    if (waiting(e, l)) {
      // Nothing to check until it is answered; the person is named as the note named them.
      const people = Object.fromEntries((e.people || []).map((p) => [p, staffOf(sim, l[p]) || { name: l.named || "?" }]));
      out[l.key] = { people, blocked: "", warnings: [], on: false, waiting: true, words };
      return;
    }
    const res = checkOne(e, l, { data, sim, today }, staffEditable);
    const on = !!l.checked && !res.blocked;
    out[l.key] = { ...res, on, waiting: false, words };
    if (on) sim = e.apply({ ...sim }, l, { ...PREVIEW, staffEditable });
    if (on && e.together) lastOf.set(e.together, l.key);
  });
  lastOf.forEach((key, together) => {
    out[key].warnings = [...out[key].warnings, ...together(sim, { data, today })];
  });
  return lines.filter((l) => out[l.key]).map((l) => ({ ...l, ...out[l.key] }));
}

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/* The body of the update(): every ticked line, checked again against the
   rota as it is at that moment (it may have changed since the checklist
   was drawn), then applied in order. */
export function applyLines(d, lines, { staffEditable = () => true, uid, today }) {
  const data = { ...d };
  let draft = d;
  byApplyOrder(lines.filter((l) => l.checked)).forEach(({ l, e }) => {
    if (waiting(e, l)) return;
    if (checkOne(e, l, { data, sim: draft, today }, staffEditable).blocked) return;
    draft = e.apply(draft, l, { uid, today, staffEditable });
  });
  return draft;
}

// "2 leave periods and 1 duty request", for the lines being saved.
export function savedWords(lines) {
  const counts = {};
  lines.forEach((l) => {
    const e = CATALOGUE[l.type];
    const k = e.savedAs || l.type;
    counts[k] = counts[k] || { e, n: 0 };
    counts[k].n += 1;
  });
  return listWords(Object.values(counts).map(({ e, n }) => (e.saved ? e.saved(n) : plural(n, "change"))));
}
