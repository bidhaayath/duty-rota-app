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
     describe    (line, ctx) -> { what, when, details? }   plain words;
                 details is an optional list shown under "Show"
     check       (line, ctx) -> { blocked?, warnings? }
     apply       (draft, line, { uid, today }) -> draft
     saved       (count) -> "2 leave periods", for the message after saving
     footnote    optional sentence shown under the group
     tabNote     optional { tabName: sentence } shown while on that tab
     opensRequests  offer "Open Duty Requests" after saving

   check gets ctx = { data, sim }: `data` is the rota as it is now, `sim` the
   rota as it will be once every ticked line above this one is saved. So a
   request sees leave added a line earlier, and two lines that touch the
   same day know about each other.

   apply is used both to work out `sim` and to save, so the warnings
   describe exactly what is saved. For that it must never change an object
   it was given: it sets top-level fields on the draft (d.staff,
   d.dutyRequests, d.cells, ...) to NEW objects, and leaves the old ones
   alone. A cell is a plain code id or a list of duties with posts; an
   apply that touches cells must handle both.

   Out of reach on purpose: billing and plans, members, invites, roles,
   deleting staff or departments, other departments. None of them lives in
   the rota, and an action type that is not listed here is ignored. */

import { addLeave, addRequest } from "./leaveAndRequests";
import { build } from "./build";
import { plural, listWords, staffOf } from "./shared";

export { LEAVE_TYPES } from "./shared";

// Shown in this order; applied settings first, then rota edits, then
// leave and requests. The build always comes last, after saving.
export const GROUPS = [
  { id: "rota", title: "Changes to the rota", applyOrder: 2 },
  { id: "leave", title: "Leave & requests", applyOrder: 3 },
  { id: "settings", title: "Standing settings", applyOrder: 1 },
];

const CATALOGUE = Object.fromEntries([addLeave, addRequest, build].map((e) => [e.type, e]));
export const entryFor = (type) => CATALOGUE[type] || null;

/* Actions the server can already suggest but this panel cannot carry out
   yet. Each is mentioned under "Not added", once, rather than vanishing.
   An entry leaves this list when it joins the catalogue. */
const COMING = {
  set_code: "putting duty codes on the rota",
  clear_days: "clearing days on the rota",
  swap_duties: "swapping duties",
  set_non_official: "marking non-official days",
  set_shifts: "Smart Roster's shift setting for a person",
  set_offs_per_week: "Smart Roster's off days per week",
  weekly_off: "regular weekly days off",
};

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
export function readReply(body, { staffIds, from, to }) {
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
    if ((entry.people || []).some((p) => !known.has(fields[p]))) return;
    const span = entry.span ? entry.span(fields) : null;
    const outside = !!span && (span[1] < pFrom || span[0] > pTo);
    lines.push({ key: `${a.type}-${i}`, type: a.type, ...fields, outside, checked: !outside });
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
    .sort((a, b) => (g[a.e.group] - g[b.e.group]) || ((a.e.order || 0) - (b.e.order || 0)) || (a.i - b.i));
};

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
  const own = blocked ? {} : (entry.check ? entry.check(l, ctx) || {} : {});
  const warnings = [...(own.warnings || [])];
  if (l.outside) warnings.unshift("outside the dates you chose");
  return { people, blocked: blocked || own.blocked || "", warnings };
}

const PREVIEW = { uid: () => "ini-preview", today: "" };

/* Every line with its checks: { ...line, people, blocked, warnings, on,
   words }, in the order given. Worked out afresh whenever a line is ticked
   or corrected, so the warnings follow straight away. */
export function checkLines(lines, { data, staffEditable = () => true }) {
  const out = {};
  let sim = data;
  byApplyOrder(lines).forEach(({ l, e }) => {
    const res = checkOne(e, l, { data, sim }, staffEditable);
    const on = !!l.checked && !res.blocked;
    out[l.key] = { ...res, on, words: e.describe(l, { data, sim }) };
    if (on) sim = e.apply({ ...sim }, l, PREVIEW);
  });
  return lines.filter((l) => out[l.key]).map((l) => ({ ...l, ...out[l.key] }));
}

/* The body of the update(): every ticked line, checked again against the
   rota as it is at that moment (it may have changed since the checklist
   was drawn), then applied in order. */
export function applyLines(d, lines, { staffEditable = () => true, uid, today }) {
  const data = { ...d };
  let draft = d;
  byApplyOrder(lines.filter((l) => l.checked)).forEach(({ l, e }) => {
    if (checkOne(e, l, { data, sim: draft }, staffEditable).blocked) return;
    draft = e.apply(draft, l, { uid, today });
  });
  return draft;
}

// "2 leave periods and 1 duty request", for the lines being saved.
export function savedWords(lines) {
  const counts = {};
  lines.forEach((l) => { counts[l.type] = (counts[l.type] || 0) + 1; });
  return listWords(Object.entries(counts).map(([t, n]) => CATALOGUE[t].saved ? CATALOGUE[t].saved(n) : plural(n, "change")));
}
