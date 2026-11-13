/* ─────────────── Ini's moments ───────────────
   The short things Ini says, unasked, at real moments — a week with every
   shift covered, a setting fixed, the first roster of a month, coming back
   after a while — and the little move that goes with each.

   The rules:
     · One bubble at a time; it goes by itself after a few seconds.
     · At most one unasked bubble every 4 minutes, per person.
     · When something has gone wrong Ini does not joke and does not dance:
       it says what helps, plainly.
     · "Quiet Ini" (remembered per person, on this device) stops unasked
       bubbles and the dancing. Ini still blinks, looks and answers taps.
     · With "reduce motion" nothing moves; the words still appear.

   Whichever Ini is on screen says it: the one on Smart Roster's Ask Ini
   bar when it is there, otherwise the floating Ini button (listen(),
   higher priority first). Everything kept is in localStorage, read and
   written inside try/catch, so a browser that refuses it just means Ini
   may say hello again.                                                  */

import { useEffect, useRef, useState } from "react";

export const MESSAGES = {
  covered: [
    "Every shift covered! Time for a little dance.",
    "Full house! Every shift has its people.",
    "Not a single gap. Your ward is going to love this week.",
    "Everyone placed, nobody grumpy. That's the dream.",
  ],
  tricky: [
    "That was a tight one, and we made it fit!",
    "Phew! Not much room this week, but everyone's placed.",
    "Tricky week, tidy result. Nicely done.",
    "That one made my blob wobble. But it fits!",
  ],
  fixed: ["Fixed! The numbers add up now.", "There we go — everything fits again."],
  firstOfMonth: ["First roster of {month}! Fresh month, fresh start.", "{month}'s first week is in. Off to a good start!"],
  late: [
    "Working late? I'll be quick — you deserve some rest.",
    "It's late! Let's get this done so you can rest.",
    "Even I'm sleepy, and I'm a blob.",
  ],
  friday: ["Working on a Friday? Thank you. Let's keep it short.", "Happy Friday! Let's get the roster sorted."],
  returning: [
    "Welcome back! I kept everything just as you left it.",
    "Hello again! Nice to see you.",
    "I missed you! The roster missed you too.",
  ],
  morning: ["Good morning! Coffee first, roster second?", "Morning! Let's make today's roster painless."],
};
// Gone wrong: helpful only, the same words each time.
const HELPFUL = {
  gaps: (n) => `${n} shift${n === 1 ? " still needs" : "s still need"} someone. The notes under the week say why.`,
  mustMissed: (n) => (n === 1
    ? "One person's Must couldn't be kept this week. The details are under the week."
    : `${n} Must rules couldn't be kept this week. The details are under the week.`),
};
// The move that goes with each moment. Nothing for anything gone wrong.
export const ACT_FOR = {
  covered: "dance", tricky: "hop", fixed: "hop", firstOfMonth: "wave",
  late: "yawn", friday: "wave", returning: "wave", morning: "wave", idle: "yawn",
};

export const BUBBLE_MS = 5000;
export const GAP_MS = 4 * 60 * 1000;
const IDLE_MS = 10 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const read = (k) => { try { return window.localStorage.getItem(k); } catch (e) { return null; } };
const write = (k, v) => { try { window.localStorage.setItem(k, v); } catch (e) { /* only a convenience */ } };
const who = (userId) => userId || "anon";
const dayOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/* ── Quiet Ini ── */
export const isQuiet = (userId) => read(`ini:quiet:${who(userId)}`) === "1";
export const setQuiet = (userId, on) => write(`ini:quiet:${who(userId)}`, on ? "1" : "0");

/* ── What to say: each moment's lines in turn ── */
export function messageFor(moment, extra = {}) {
  if (HELPFUL[moment]) return HELPFUL[moment](extra.n || 1);
  const list = MESSAGES[moment];
  if (!list) return null;
  const k = `ini:said:${moment}`;
  const i = (Number(read(k)) || 0) % list.length;
  write(k, String(i + 1));
  return list[i].replace("{month}", extra.month || "this month");
}

/* ── At most one unasked bubble every few minutes ── */
export const mayBubble = (userId, now = Date.now()) => now - (Number(read(`ini:lastBubble:${who(userId)}`)) || 0) >= GAP_MS;
const noteBubble = (userId, now = Date.now()) => write(`ini:lastBubble:${who(userId)}`, String(now));

/* ── The moment a finished week is ──
   Gone wrong first: shifts left uncovered, then a personal Must not kept.
   Otherwise every shift covered — "tricky" when the week had at most one
   duty to spare. A week missing only someone in charge says nothing. */
export function weekMoment(report) {
  const uncovered = (report.shortfalls || []).reduce((n, s) => n + (s.needed || 1), 0);
  if (uncovered) return { moment: "gaps", n: uncovered };
  const must = new Set((report.relaxations || []).filter((r) => r.personal && r.strength === "hard")
    .map((r) => `${r.staffId}|${r.rule}`)).size;
  if (must) return { moment: "mustMissed", n: must };
  if ((report.seniorGaps || []).length) return null;
  const spare = report.budget?.[0]?.spare;
  return { moment: spare != null && spare <= 1 ? "tricky" : "covered" };
}

/* ── The first roster of a month, per department ──
   The month of the week used; remembered once said, so the second week of
   December is not "first" again. */
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export function firstOfMonth(deptId, weekStart) {
  const key = `ini:months:${deptId}`;
  const month = String(weekStart).slice(0, 7);
  let seen = [];
  try { seen = JSON.parse(read(key) || "[]"); } catch (e) { seen = []; }
  if (!Array.isArray(seen) || seen.includes(month)) return null;
  write(key, JSON.stringify([...seen, month].slice(-24)));
  return MONTHS[Number(month.slice(5, 7)) - 1] || null;
}

/* ── Arriving: what to say first ──
   Back after a week or more; working late (22:00–05:00); the first visit of
   the day before 10:00; a Friday. Each at most once a day. */
export function arrivalMoment(userId, now = new Date()) {
  const u = who(userId);
  const last = Number(read(`ini:lastSeen:${u}`)) || 0;
  write(`ini:lastSeen:${u}`, String(now.getTime()));
  const today = dayOf(now);
  const firstToday = read(`ini:lastDay:${u}`) !== today;
  write(`ini:lastDay:${u}`, today);
  const once = (kind) => {
    if (read(`ini:${kind}:${u}`) === today) return false;
    write(`ini:${kind}:${u}`, today);
    return true;
  };
  const h = now.getHours();
  if (last && now.getTime() - last >= WEEK_MS && once("returning")) return "returning";
  if ((h >= 22 || h < 5) && once("late")) return "late";
  if (firstToday && h < 10 && once("morning")) return "morning";
  if (now.getDay() === 5 && once("friday")) return "friday";
  return null;
}

/* ── The channel ── */
let listeners = [];
let idleTimer = null;
const resetIdle = () => {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => tell("idle"), IDLE_MS);
};
const ACTIVITY = ["pointerdown", "keydown", "wheel", "touchstart"];
const watchIdle = (on) => {
  try {
    ACTIVITY.forEach((e) => (on ? window.addEventListener(e, resetIdle, { passive: true }) : window.removeEventListener(e, resetIdle)));
  } catch (e) { /* no window */ }
  if (on) resetIdle(); else clearTimeout(idleTimer);
};

// fn(moment, extra) — the Ini with the highest priority hears it; the newest wins a tie.
export function listen(fn, priority = 0) {
  const entry = { fn, priority };
  listeners = [...listeners, entry];
  if (listeners.length === 1) watchIdle(true);
  return () => {
    listeners = listeners.filter((x) => x !== entry);
    if (!listeners.length) watchIdle(false);
  };
}
export function tell(moment, extra = {}) {
  const top = listeners.reduce((best, x) => (!best || x.priority >= best.priority ? x : best), null);
  if (top) top.fn(moment, extra);
}

let arrived = null;   // the person already greeted on this page load
// For tests: forget the page load.
export const resetMoments = () => { arrived = null; listeners = []; watchIdle(false); };

/* One Ini's side of it: what it is saying and doing now. `act` is
   { name, n } for IniMascot; `bubble` the words, or null. */
export function useIniMoments({ userId, priority = 0, enabled = true }) {
  const [bubble, setBubble] = useState(null);
  const [act, setAct] = useState(null);
  const n = useRef(0);
  const timer = useRef(null);
  const user = useRef(userId);
  user.current = userId;

  useEffect(() => {
    if (!enabled) return undefined;
    const off = listen((moment, extra) => {
      const u = user.current;
      const quiet = isQuiet(u);
      const name = ACT_FOR[moment];
      if (name && !quiet) { n.current += 1; setAct({ name, n: n.current }); }
      if (quiet || moment === "idle" || !mayBubble(u)) return;
      const text = messageFor(moment, extra);
      if (!text) return;
      noteBubble(u);
      setBubble(text);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setBubble(null), BUBBLE_MS);
    }, priority);
    return () => { off(); clearTimeout(timer.current); };
  }, [enabled, priority]);

  // Arriving: once per person per page load, after Ini has had a moment to wake.
  useEffect(() => {
    if (!enabled || !userId || arrived === userId) return undefined;
    arrived = userId;
    const t = setTimeout(() => {
      const m = arrivalMoment(userId);
      if (m) tell(m);
    }, 1500);
    return () => clearTimeout(t);
  }, [enabled, userId]);

  const hush = () => { clearTimeout(timer.current); setBubble(null); };
  return { bubble, act, hush };
}
