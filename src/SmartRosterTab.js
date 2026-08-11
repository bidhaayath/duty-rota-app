/* ─────────────── Smart Roster ───────────────
   One week at a time. The settings that matter are on the page; everything
   else has a sensible default and lives under "More rules" for the rare
   occasion someone needs to change it.

   What it is trying to do, in order:
     1. Cover every shift with the number of staff you asked for, and with
        somebody on it who can take charge.
     2. Give everyone a fair mix — not five afternoons in a row while
        somebody else does all the nights.
     3. Respect the rest rules: at most two off days, no morning straight
        after a night or an afternoon.

   Nothing is written to the rota until Apply is pressed.                */

import React, { useState, useMemo, useEffect } from "react";
import { Plus, Trash2, Wand2, AlertTriangle, Check, X, ChevronDown, ChevronRight } from "lucide-react";
import { generateRoster, checkFeasible, toRotaCells, SHIFTS } from "./rosterEngine";

const SHIFT_LABELS = { morning: "Morning", afternoon: "Afternoon", evening: "Evening", night: "Night" };
const SEQ_CATS = [...SHIFTS, "off"];
const SEQ_LABELS = { ...SHIFT_LABELS, off: "Off day" };

/* The defaults are the rules you described, already set up. Someone opening
   this page for the first time should be able to press Generate and get a
   sensible week without configuring anything. */
const DEFAULT_RULES = {
  coverage: {
    morning: { min: 2, max: 3 }, afternoon: { min: 2, max: 3 },
    evening: { min: 0, max: 0 }, night: { min: 1, max: 2 },
  },
  // At least one of every shift the ward runs, so nobody goes a week
  // without seeing a night, or without a morning.
  weeklyMin: { morning: 1, afternoon: 1, evening: 1, night: 1, off: 1 },
  weeklyMax: { morning: null, afternoon: null, evening: null, night: null, off: 2 },
  blockDays: { morning: 3, afternoon: 3, evening: 3, night: 2 },
  sequenceRules: [
    { id: "d1", type: "never", after: "night", then: "morning" },
    { id: "d2", type: "never", after: "night", then: "afternoon" },
    { id: "d3", type: "never", after: "night", then: "evening" },
    { id: "d4", type: "never", after: "afternoon", then: "morning" },
    { id: "d5", type: "never", after: "evening", then: "morning" },
  ],
  maxDaysOn: 5,
  skipStaff: [],
  staffShifts: {},
  weeklyDuties: { min: 5, max: 5 },
  lookbackDays: 30,
  /* Who can take charge of a shift, and how many each shift needs. Off by
     default — every number zero — so nothing changes for a ward that has
     never thought about it. The word is theirs to choose: "senior" is only
     one of the ones in use. */
  seniorStaff: [],
  seniorCover: { morning: 0, afternoon: 0, evening: 0, night: 0 },
  seniorTerm: "Senior",
  seniorTermPlural: "",
  /* Which code gets written for each kind of duty. Empty = work it out, which
     is what every existing rota does today, so nothing changes until a ward
     says otherwise. Stored as code ids, not code text, so renaming a code in
     Settings does not quietly break the choice. */
  codeFor: { morning: "", afternoon: "", evening: "", night: "", off: "", nightOff: "" },
  ruleStates: { coverage: { state: 'hard', priority: 1 }, sequence: { state: 'hard', priority: 1 },
                offMax: { state: 'hard', priority: 1 }, workPattern: { state: 'soft', priority: 4 } },
};

const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
/* Back to the start of whatever the ward calls a week — Sunday in the
   Maldives, Monday across much of Europe. 0 is Sunday, matching JavaScript's
   own day numbering, so nothing has to be translated on the way through. */
const weekStartOf = (d, firstDay = 0) => {
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - (((x.getDay() - firstDay) % 7) + 7) % 7);
  return x;
};
const DAY_LABEL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/* Hard, Soft with a priority, or Off. Sits beside a section heading so the
   strength of a whole group of rules is set in one place. */
function Strength({ value, onChange, disabled, T, sel }) {
  const st = value?.state || "soft";
  const pr = value?.priority ?? 2;
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <span style={{ display: "inline-flex", borderRadius: 7, overflow: "hidden", border: `1px solid ${T.line}` }}>
        {["hard", "soft", "disabled"].map((v) => (
          <button key={v} disabled={disabled} onClick={() => onChange({ state: v, priority: pr })}
            style={{ fontFamily: "inherit", fontSize: 11, fontWeight: 700, border: "none",
              padding: "4px 9px", cursor: disabled ? "not-allowed" : "pointer",
              background: st === v ? (v === "hard" ? T.lagoon : v === "soft" ? T.sand : "#9AACA9") : "transparent",
              color: st === v ? "#fff" : T.inkSoft }}>
            {v === "hard" ? "Hard" : v === "soft" ? "Soft" : "Off"}
          </button>
        ))}
      </span>
      {st === "soft" && (
        <select value={pr} disabled={disabled} style={{ ...sel, minWidth: 60, padding: "4px 6px", fontSize: 11.5 }}
          onChange={(e) => onChange({ state: st, priority: Number(e.target.value) })}>
          <option value={1}>P1</option><option value={2}>P2</option>
          <option value={3}>P3</option><option value={4}>P4</option>
        </select>
      )}
    </span>
  );
}

export default function SmartRosterTab({
  data, update, staffEditable, T, Card, Btn, Field, inputStyle, th, td, uid, dstr,
  onApplied,
}) {
  const saved = data.rosterRules || {};
  const rules = {
    ...DEFAULT_RULES, ...saved,
    coverage: { ...DEFAULT_RULES.coverage, ...(saved.coverage || {}) },
    weeklyMin: { ...DEFAULT_RULES.weeklyMin, ...(saved.weeklyMin || {}) },
    weeklyMax: { ...DEFAULT_RULES.weeklyMax, ...(saved.weeklyMax || {}) },
    blockDays: { ...DEFAULT_RULES.blockDays, ...(saved.blockDays || {}) },
    sequenceRules: saved.sequenceRules || DEFAULT_RULES.sequenceRules,
    staffShifts: saved.staffShifts || {},
    skipStaff: saved.skipStaff || [],
    seniorStaff: saved.seniorStaff || [],
    seniorCover: { ...DEFAULT_RULES.seniorCover, ...(saved.seniorCover || {}) },
    codeFor: { ...DEFAULT_RULES.codeFor, ...(saved.codeFor || {}) },
    ruleStates: { ...DEFAULT_RULES.ruleStates, ...(saved.ruleStates || {}) },
    weeklyDuties: { ...DEFAULT_RULES.weeklyDuties, ...(saved.weeklyDuties || {}) },
  };

  /* The word this ward uses. Everything on the page and every message the
     engine produces follows it, so a ward that says "in-charge" never sees
     the word "senior" anywhere. */
  const termOne = (rules.seniorTerm || "Senior").trim() || "Senior";
  const termMany = (rules.seniorTermPlural || "").trim() || `${termOne}s`;
  const lower = termOne.toLowerCase();

  /* Which day a week begins on, as set in Settings. Sunday unless the ward
     says otherwise, which is what every existing rota has always assumed. */
  const firstDay = data.weekStartsOn ?? 0;

  // Next week, since that is almost always the one being planned.
  const [weekStart, setWeekStart] = useState(() => dstr(weekStartOf(addDays(new Date(), 7), data.weekStartsOn ?? 0)));

  /* Changing the setting in the middle of planning would otherwise leave the
     picker on a date that is no longer the start of a week. */
  useEffect(() => {
    setWeekStart((w) => dstr(weekStartOf(new Date(w), firstDay)));
    // dstr is listed because React asks for it, not because it moves — it is
    // defined once at the top of the app and handed down unchanged.
  }, [firstDay, dstr]);
  const [proposal, setProposal] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showMore, setShowMore] = useState(false);

  const setRules = (patch) => update((d) => { d.rosterRules = { ...rules, ...patch }; return d; });

  const weekEnd = dstr(addDays(new Date(weekStart), 6));
  const today = dstr(new Date());

  /* ── Who is actually on the rota this week ──
     Employment dates are inclusive, and the rota grid only shows somebody on
     the days between their joining date and their last working day. The
     generator has to use the same rule, or it rosters people the rota will
     not display: their duties are written, nobody can see them, and the ward
     is quietly a person short for the week.

     Read from the same two fields the Staff tab sets, in plain string
     comparison — the dates are stored as YYYY-MM-DD, which sorts correctly
     as text and avoids every timezone trap. */
  const employedOn = (s, date) => {
    if (s.startDate && date < s.startDate) return false;
    if (s.endDate && date > s.endDate) return false;
    return true;
  };
  const shiftISO = (iso, n) => {
    const [y, m, d] = String(iso).split("-").map(Number);
    const x = new Date(y, m - 1, d);
    x.setDate(x.getDate() + n);
    return dstr(x);
  };
  const weekDates = useMemo(
    () => [...Array(7)].map((_, i) => dstr(addDays(new Date(weekStart), i))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [weekStart]
  );

  /* Everyone still with the ward — the list the settings below apply to. It
     deliberately does NOT change with the week being planned: a "skip" or a
     shift restriction is a fact about the person, not about seven days. */
  const allStaff = useMemo(
    () => (data.staff || []).filter((s) => !(s.endDate && s.endDate < today)),
    [data.staff, today]
  );
  // Everyone employed on at least one day of THIS week — the ones to roster.
  const activeStaff = useMemo(
    () => (data.staff || []).filter((s) => weekDates.some((d) => employedOn(s, d))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.staff, weekDates]
  );
  /* Left out of this week, and why. Drawn from EVERY staff member, not just
     the current ones — the whole point is the person a manager expects to
     see and does not, and somebody who left last month is exactly that.

     Bounded at both ends by eight weeks, so it names the nurse who left in
     July while planning August, and stays quiet about a porter who left in
     2019 or a joiner starting next year. */
  const notThisWeek = useMemo(() => {
    const longGone = shiftISO(weekStart, -56);
    const farOff = shiftISO(weekEnd, 56);
    return (data.staff || [])
      .filter((s) => !weekDates.some((d) => employedOn(s, d)))
      .map((s) => {
        if (s.endDate && s.endDate < weekStart && s.endDate >= longGone) {
          return { name: s.name, why: `left ${s.endDate}` };
        }
        if (s.startDate && s.startDate > weekEnd && s.startDate <= farOff) {
          return { name: s.name, why: `joins ${s.startDate}` };
        }
        return null;
      })
      .filter(Boolean);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.staff, weekDates, weekStart, weekEnd]);
  const weekLabel = `${new Date(weekStart).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – ` +
                    `${new Date(weekEnd).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;

  const nonOfficialFor = (from, to) => {
    const out = new Set(data.nonOfficial || []);
    if (data.fridayRule) {
      for (let d = new Date(from); dstr(d) <= to; d = addDays(d, 1)) if (d.getDay() === 5) out.add(dstr(d));
    }
    return [...out];
  };

  /* The rota stores cells as cells[date][staffId] = codeId — nested by
     date, holding the code's id. The engine works in flat "staffId|date"
     keys holding the code itself. These two translate between them; getting
     this wrong means the engine reads no history and writes nothing the
     rota can see. */
  const codeById = useMemo(() => {
    const m = {}; (data.codes || []).forEach((c) => { m[c.id] = c.code; }); return m;
  }, [data.codes]);
  /* Code text back to the code's id. FIRST match wins, because that is what
     the engine picks too — it takes the first code counting as a category.
     Last-wins would quietly hand every morning to a second code that
     happens to share the letters, and the preview would look right while
     the rota got something else. */
  const idByCode = useMemo(() => {
    const m = {};
    (data.codes || []).forEach((c) => { if (!(c.code in m)) m[c.code] = c.id; });
    return m;
  }, [data.codes]);

  const flatten = (from, to) => {
    const out = {};
    for (const [date, row] of Object.entries(data.cells || {})) {
      if (date < from || date > to) continue;
      for (const [sid, codeId] of Object.entries(row || {})) {
        const code = codeById[codeId];
        if (code) out[`${sid}|${date}`] = code;
      }
    }
    return out;
  };

  const buildConfig = () => {
    const lookFrom = dstr(addDays(new Date(weekStart), -(rules.lookbackDays || 0)));
    const lookTo = dstr(addDays(new Date(weekStart), -1));
    const history = flatten(lookFrom, lookTo);
    /* Somebody who joins on the Wednesday should be rostered from Wednesday,
       not from Sunday. The engine has no notion of employment dates, but it
       does understand leave — so the days outside somebody's employment are
       handed to it as leave periods. It then leaves those cells untouched,
       exactly as the rota grid shows them. */
    const rosterStaff = activeStaff.map((s) => {
      const gaps = [];
      if (s.startDate && s.startDate > weekStart) {
        gaps.push({ id: `pre-${s.id}`, type: "other", start: weekStart, end: shiftISO(s.startDate, -1) });
      }
      if (s.endDate && s.endDate < weekEnd) {
        gaps.push({ id: `post-${s.id}`, type: "other", start: shiftISO(s.endDate, 1), end: weekEnd });
      }
      return gaps.length ? { ...s, leavePeriods: [...(s.leavePeriods || []), ...gaps] } : s;
    });
    return {
      from: weekStart, to: weekEnd,
      // The weekly limits below reset on the ward's own week boundary.
      weekStartsOn: firstDay,
      staff: rosterStaff,
      codes: data.codes || [],
      existingCells: flatten(weekStart, weekEnd),
      coverage: rules.coverage,
      /* Per-shift caps are left off deliberately: the generator already
         spreads shift types within the week, so a cap would only get in its
         way. Off days carry both ends — `off` is the FEWEST somebody should
         get, `offMax` the most. These were once both fed from the "most"
         column, which quietly held everyone to exactly that many. */
      weeklyPerStaff: {
        ...rules.weeklyMax,
        off: rules.weeklyMin?.off ?? null,
        offMax: rules.weeklyMax?.off ?? null,
      },
      weeklyMin: rules.weeklyMin,
      weeklyDuties: rules.weeklyDuties,
      sequenceRules: rules.sequenceRules,
      skipStaff: rules.skipStaff,
      staffShifts: rules.staffShifts,
      // Who can take charge, how many each shift needs, and what they are
      // called — the last so the engine's own messages use the ward's word.
      seniorStaff: rules.seniorStaff,
      seniorCover: rules.seniorCover,
      seniorTerm: lower,
      seniorTermPlural: termMany.toLowerCase(),
      // Blocks are kept short so a week reads as a mix rather than five
      // afternoons running. Nights are the exception: they pair.
      maxBlock: rules.blockDays,
      maxConsecutiveDays: rules.maxDaysOn ?? 5,
      // The working pattern is held firm: it is what stops one person
      // collecting a whole week of the same duty. Only the off-day floor
      // gives way, and only to keep a shift covered.
      ruleStates: rules.ruleStates,
      nonOfficialDates: nonOfficialFor(weekStart, weekEnd),
      requests: (data.dutyRequests || [])
        .filter((r) => r.approved && r.date >= weekStart && r.date <= weekEnd)
        .map((r) => ({ staffId: r.staffId, date: r.date, category: r.category })),
      history: { cells: history, nonOfficialDates: nonOfficialFor(lookFrom, lookTo) },
    };
  };

  const feasibility = useMemo(() => {
    if (!activeStaff.length) return null;
    try { return checkFeasible(buildConfig()); } catch { return null; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, rules, weekStart, activeStaff]);

  /* The ward's code choices, turned from ids into the code text the engine
     writes. A choice pointing at a code that has since been deleted simply
     drops out here, and the engine falls back to working it out. */
  const chosenCodes = useMemo(() => {
    const out = {};
    Object.entries(rules.codeFor || {}).forEach(([slot, id]) => {
      const c = (data.codes || []).find((x) => x.id === id);
      if (c) out[slot] = c.code;
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rules.codeFor, data.codes]);

  const generate = () => {
    setBusy(true);
    // The pause lets the button repaint as "Generating…" before the work
    // begins. Building the week takes about a second: it is built quickly
    // several times over, then improved by rearrangement, which is where
    // the last uncovered shifts get resolved.
    setTimeout(() => {
      try {
        const res = generateRoster(buildConfig());
        if (!res.ok) { setProposal({ failed: true, problems: res.problems }); return; }
        const yearStart = `${weekStart.slice(0, 4)}-01-01`;
        setProposal({
          cells: res.cells, report: res.report,
          yearToDate: flatten(yearStart, weekEnd),
          yearStart,
          rotaCells: toRotaCells(res.cells, data.codes || [], res.nightRest, chosenCodes),
          from: weekStart, to: weekEnd,
        });
      } catch (e) {
        console.error("Roster generation failed:", e);
        setProposal({ failed: true, problems: ["Something went wrong. Nothing has been changed."] });
      } finally { setBusy(false); }
    }, 30);
  };

  /* ── Applying, and checking that it landed ──
     Writing the week and trusting that it worked is how a rota that looks
     nothing like the preview goes unnoticed. So the write is planned first,
     performed, and then read back and compared cell by cell. If anything
     differs, it says exactly which cells and what they became, rather than
     leaving it to be discovered on the printed rota. */
  const [verify, setVerify] = useState(null);

  useEffect(() => {
    if (!verify) return undefined;
    /* update() hands the change to the parent, which clones the rota and
       sets it again — so a successful write always arrives as a NEW data
       object. Until it does there is nothing to compare against, and
       comparing early would report a mismatch that is only impatience.

       If it never arrives, the write was refused: the trial has ended, or
       this department is view-only. Worth saying plainly, since the old
       behaviour was to announce success either way. */
    if (data === verify.before) {
      const timer = setTimeout(() => {
        setVerify(null);
        window.alert(
          "Nothing was written — the rota is unchanged.\n\n" +
          "Editing is usually paused for one of two reasons: the free trial has ended, " +
          "or this department is view-only on your plan."
        );
      }, 1500);
      return () => clearTimeout(timer);
    }
    const wrong = [];
    for (const w of verify.writes) {
      const landed = (data.cells?.[w.date] || {})[w.sid];
      if (landed !== w.id) {
        const who = (data.staff || []).find((s) => String(s.id) === String(w.sid))?.name || w.sid;
        wrong.push(`${w.date} · ${who}: expected ${w.code}, rota has ${codeById[landed] || "nothing"}`);
      }
    }
    const total = verify.writes.length;
    setVerify(null);
    if (wrong.length) {
      console.warn("Smart Roster: applied week does not match the preview", wrong);
      window.alert(
        `Applied, but ${wrong.length} of ${total} cells did not land as previewed:\n\n` +
        wrong.slice(0, 10).join("\n") +
        (wrong.length > 10 ? `\n…and ${wrong.length - 10} more` : "") +
        `\n\nThe full list is in the browser console. Please send it over — this should not happen.`
      );
    } else {
      window.alert(
        `Week applied — all ${total} duties match the preview.\n\n` +
        `You can still edit any cell by hand, and Undo will put it back as it was.`
      );
      /* Straight to the week that was just written. The Weekly Rota tab
         opens on the CURRENT week, and this one is usually next week — so
         without this the manager arrives at a different seven days and
         reasonably concludes the wrong rota was applied. */
      if (onApplied) onApplied(verify.week);
    }
    return undefined;
  }, [data, verify, codeById, onApplied]);

  const apply = () => {
    // Plan the write before touching anything, so a code that cannot be
    // resolved stops the whole thing rather than leaving half a week behind.
    const writes = [];
    const missing = new Set();
    for (const [key, code] of Object.entries(proposal.rotaCells)) {
      const cut = key.lastIndexOf("|");            // a date never contains "|"
      const sid = key.slice(0, cut);
      const date = key.slice(cut + 1);
      const id = idByCode[code];
      if (!id) { missing.add(code); continue; }
      writes.push({ sid, date, id, code });
    }
    if (missing.size) {
      window.alert(
        `Cannot apply: no duty code is set up for ${[...missing].join(", ")}.\n\n` +
        `Add ${missing.size === 1 ? "it" : "them"} under Settings, then generate again. ` +
        `Nothing has been changed.`
      );
      return;
    }
    /* A "changed duty" mark remembers the duty a cell held before it was
       exchanged. Once the cell is rewritten that memory points at a duty
       nobody worked, so applying clears it — which is the only thing here
       that removes anything the manager entered by hand. It is counted and
       said out loud beforehand rather than discovered later in Insights. */
    const marksCleared = writes.filter((w) => data.cellMeta?.[w.date]?.[w.sid]?.exchange).length;
    if (!window.confirm(
      `Apply this week?\n\n${writes.length} duties will be written for ${weekLabel}.\n\n` +
      `Existing duties that week will be replaced. Recorded leave is kept as it is, ` +
      `and so are any notes on the cells.` +
      (marksCleared
        ? `\n\n${marksCleared} "changed duty" mark${marksCleared === 1 ? "" : "s"} on that week ` +
          `will be cleared, because the duty ${marksCleared === 1 ? "it remembers" : "they remember"} ` +
          `is being replaced.`
        : "") +
      `\n\nUndo will put everything back if you change your mind.`
    )) return;

    update((d) => {
      const next = { ...(d.cells || {}) };
      for (const w of writes) {
        next[w.date] = { ...(next[w.date] || {}), [w.sid]: w.id };
        /* A "changed duty" mark remembers what a cell held before it was
           exchanged. Once the cell has been rewritten by a fresh rota that
           memory is of a duty nobody ever worked, so it goes. Notes on the
           cell are about the person and the day, so those stay. */
        const meta = d.cellMeta?.[w.date]?.[w.sid];
        if (meta?.exchange) {
          delete meta.exchange;
          if (!Object.keys(meta).length) delete d.cellMeta[w.date][w.sid];
        }
      }
      d.cells = next;
      return d;
    });
    setProposal(null);
    setVerify({ writes, before: data, week: weekStart });
  };

  const setCoverage = (shift, key, v) =>
    setRules({ coverage: { ...rules.coverage, [shift]: { ...rules.coverage[shift], [key]: v === "" ? null : Number(v) } } });
  const setSeniorCover = (shift, v) =>
    setRules({ seniorCover: { ...rules.seniorCover, [shift]: v === "" ? 0 : Math.max(0, Number(v) || 0) } });
  const toggleSkip = (id) =>
    setRules({ skipStaff: rules.skipStaff.includes(id) ? rules.skipStaff.filter((x) => x !== id) : [...rules.skipStaff, id] });
  const toggleSenior = (id) =>
    setRules({ seniorStaff: rules.seniorStaff.includes(id) ? rules.seniorStaff.filter((x) => x !== id) : [...rules.seniorStaff, id] });
  const setStaffShifts = (id, list) => {
    const next = { ...(rules.staffShifts || {}) };
    if (list.length) next[id] = list; else delete next[id];
    setRules({ staffShifts: next });
  };

  const num = { ...inputStyle, width: 70, padding: "7px 9px" };
  const sel = { ...inputStyle, width: "auto", minWidth: 118, cursor: "pointer", padding: "7px 9px" };
  const title = { fontFamily: "Sora, sans-serif", fontSize: 15, margin: "0 0 3px" };
  const hint = { fontSize: 12.5, color: T.inkSoft, lineHeight: 1.6, margin: "0 0 14px" };
  const chip = (on, colour) => ({
    fontFamily: "inherit", fontSize: 12, fontWeight: 600, borderRadius: 999,
    padding: "5px 11px", cursor: staffEditable ? "pointer" : "not-allowed",
    border: `1px solid ${on ? colour : T.line}`,
    background: on ? (colour === T.coral ? "#FBEAE7" : "#D8EEE9") : "#fff",
    color: on ? colour : T.inkSoft,
  });

  const seniorCount = activeStaff.filter((s) => rules.seniorStaff.includes(s.id) && !rules.skipStaff.includes(s.id)).length;
  const seniorPerDay = SHIFTS.reduce((n, sh) => n + ((rules.coverage[sh]?.min || 0) > 0 ? (rules.seniorCover[sh] || 0) : 0), 0);

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Card>
        <h2 style={{ fontFamily: "Sora, sans-serif", fontSize: 17, margin: "0 0 4px",
                     display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          Smart Roster
          <span style={{ fontSize: 11, fontWeight: 700, background: "#E6E4F5",
            color: "#4E4A8C", border: "1px solid #C4C0E8",
            borderRadius: 999, padding: "2px 9px", letterSpacing: 0.3 }}>
            BETA
          </span>
          <span style={{ fontSize: 11, fontWeight: 700, background: "#FBF1DC",
            color: "#8A5A0F", border: "1px solid #E7D9B8",
            borderRadius: 999, padding: "2px 9px", letterSpacing: 0.3 }}>
            Plus
          </span>
        </h2>
        <p style={{ ...hint, marginBottom: 0 }}>
          Generates one week at a time. It covers every shift first, then shares the shift types out
          evenly so nobody ends up with a whole week of afternoons. Nothing is written to your rota
          until you press Apply.{" "}
          <strong>This feature is in beta</strong> — it works well for most wards, but check the
          result before applying, and use the Undo button if anything looks wrong.
        </p>
        {!staffEditable && (
          <div style={{ background: "#FBEAE7", border: "1px solid #F1B8AE", borderRadius: 10, padding: "10px 12px", fontSize: 13, color: "#8A2E1E", marginTop: 12 }}>
            Editing is paused on this plan, so a rota cannot be generated.
          </div>
        )}
      </Card>

      {/* ── Staff per shift ── */}
      <Card>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 3 }}>
          <h3 style={{ ...title, margin: 0 }}>How many staff on each shift</h3>
          <Strength value={rules.ruleStates?.coverage} disabled={!staffEditable} T={T} sel={sel}
            onChange={(v) => setRules({ ruleStates: { ...rules.ruleStates, coverage: v } })} />
        </div>
        <p style={hint}>
          Set the minimum to 0 for a shift you do not run. Kept <strong>Hard</strong>, a shift is
          never left below its minimum. The last column is how many of those people must be a{" "}
          {lower} — leave it at 0 if it does not matter who is on.
        </p>
        <table style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>Shift</th><th style={th}>Fewest</th><th style={th}>Most</th>
              <th style={{ ...th, background: "#F1F5F4" }}>…of whom {lower}</th>
            </tr>
          </thead>
          <tbody>
            {SHIFTS.map((s) => (
              <tr key={s}>
                <td style={{ ...td, fontWeight: 600 }}>{SHIFT_LABELS[s]}</td>
                <td style={td}><input type="number" min={0} style={num} disabled={!staffEditable}
                  value={rules.coverage[s]?.min ?? ""} onChange={(e) => setCoverage(s, "min", e.target.value)} /></td>
                <td style={td}><input type="number" min={0} style={num} disabled={!staffEditable}
                  value={rules.coverage[s]?.max ?? ""} onChange={(e) => setCoverage(s, "max", e.target.value)} /></td>
                <td style={{ ...td, background: "#F1F5F4" }}>
                  <input type="number" min={0} style={num}
                    disabled={!staffEditable || (rules.coverage[s]?.min || 0) === 0}
                    value={rules.seniorCover[s] ?? 0} onChange={(e) => setSeniorCover(s, e.target.value)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {seniorPerDay > 0 && (
          <p style={{ ...hint, margin: "12px 0 0" }}>
            That is <strong>{seniorPerDay} {seniorPerDay === 1 ? lower : termMany.toLowerCase()} on duty every day</strong>,
            or {seniorPerDay * 7} {lower} duties across the week. At {rules.weeklyDuties?.max || 5} duties
            each that needs at least <strong>{Math.ceil((seniorPerDay * 7) / (rules.weeklyDuties?.max || 5))}</strong>{" "}
            {termMany.toLowerCase()}; you have ticked {seniorCount}.
          </p>
        )}
      </Card>

      {/* ── Per-person weekly shape ── */}
      <Card>
        <h3 style={title}>What one person should get in a week</h3>
        <p style={hint}>
          Laid out the same way as the results, so you can set a rule and check it in the same
          shape. Leave a box empty for no limit. <strong>Fewest</strong> is a goal — the generator
          works towards it but cannot always reach it. <strong>Most</strong> is a limit.
          <strong> In a row</strong> is how many of that shift can come together before a change:
          two nights together is normal, and keeping the others to about three is what stops a
          whole week of afternoons.
        </p>
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", minWidth: 460 }}>
            <thead>
              <tr>
                <th style={th}></th>
                {SHIFTS.map((s) => <th key={s} style={{ ...th, textAlign: "center" }}>{SHIFT_LABELS[s]}</th>)}
                <th style={{ ...th, textAlign: "center" }}>Off days</th>
              </tr>
            </thead>
            <tbody>
              {[["weeklyMin", "Fewest"], ["weeklyMax", "Most"]].map(([field, label]) => (
                <tr key={field}>
                  <td style={{ ...td, fontWeight: 600 }}>{label}</td>
                  {[...SHIFTS, "off"].map((sh) => (
                    <td key={sh} style={{ ...td, textAlign: "center" }}>
                      <input type="number" min={0} max={7} style={num} disabled={!staffEditable}
                        value={rules[field]?.[sh] ?? ""}
                        onChange={(e) => setRules({ [field]: { ...rules[field], [sh]: e.target.value === "" ? null : Number(e.target.value) } })} />
                    </td>
                  ))}
                </tr>
              ))}
              <tr style={{ background: "#F7FAFA" }}>
                <td style={{ ...td, fontWeight: 700 }}>Duties in total</td>
                <td style={{ ...td, textAlign: "center" }} colSpan={2}>
                  <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                    <span style={{ fontSize: 11.5, color: T.inkSoft }}>fewest</span>
                    <input type="number" min={0} max={7} style={num} disabled={!staffEditable}
                      value={rules.weeklyDuties?.min ?? ""}
                      onChange={(e) => setRules({ weeklyDuties: { ...rules.weeklyDuties, min: e.target.value === "" ? null : Number(e.target.value) } })} />
                    <span style={{ fontSize: 11.5, color: T.inkSoft }}>most</span>
                    <input type="number" min={0} max={7} style={num} disabled={!staffEditable}
                      value={rules.weeklyDuties?.max ?? ""}
                      onChange={(e) => setRules({ weeklyDuties: { ...rules.weeklyDuties, max: e.target.value === "" ? null : Number(e.target.value) } })} />
                  </span>
                </td>
                <td style={{ ...td, textAlign: "center", fontSize: 11.5, color: T.inkSoft }} colSpan={3}>
                  Hard rule — how many days someone works, whatever the shifts
                </td>
              </tr>
              <tr>
                <td style={{ ...td, fontWeight: 600 }}>Priority</td>
                {[...SHIFTS, "off"].map((sh) => {
                  const key = sh === "off" ? "offMin" : `weeklyCaps:${sh}`;
                  const cur = rules.ruleStates?.[key]?.priority ?? 3;
                  return (
                    <td key={sh} style={{ ...td, textAlign: "center" }}>
                      <select value={cur} disabled={!staffEditable}
                        onChange={(e) => setRules({ ruleStates: { ...rules.ruleStates,
                          [key]: { state: rules.ruleStates?.[key]?.state || "soft", priority: Number(e.target.value) } } })}
                        style={{ ...sel, minWidth: 62, padding: "6px 6px", fontSize: 12 }}>
                        <option value={1}>P1</option><option value={2}>P2</option>
                        <option value={3}>P3</option><option value={4}>P4</option>
                      </select>
                    </td>
                  );
                })}
              </tr>
              <tr>
                <td style={{ ...td, fontWeight: 600 }}>In a row</td>
                {SHIFTS.map((sh) => (
                  <td key={sh} style={{ ...td, textAlign: "center" }}>
                    <input type="number" min={1} max={7} style={num} disabled={!staffEditable}
                      value={rules.blockDays?.[sh] ?? ""}
                      onChange={(e) => setRules({ blockDays: { ...rules.blockDays, [sh]: Math.max(1, Number(e.target.value) || 1) } })} />
                  </td>
                ))}
                <td style={{ ...td, textAlign: "center", color: T.inkSoft }}>—</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p style={{ ...hint, margin: "12px 0 0" }}>
          <strong>Priority</strong> decides which limit gives way first when a shift would
          otherwise go uncovered: P4 is sacrificed before P3, and P1 is protected longest.
          Covering the shift always comes first, and anything given up is listed after generating.
          Anyone tied to a single shift is not held to any of this — these limits exist to rotate
          people between shifts, and they have nowhere else to go.
        </p>
      </Card>

      {/* ── Exceptions ── */}
      <Card>
        <h3 style={title}>Staff exceptions</h3>
        <p style={hint}>
          Tick shifts for anyone who only ever does those — they are then left out of the fair-share
          calculations, since they cannot rotate. The <strong>{termOne}</strong> tick marks anyone
          who can take charge of a shift; it only does anything once you have asked for one in the
          table above. Use <strong>Skip</strong> for anyone whose duties you enter by hand. Staff on
          recorded leave are skipped automatically.
        </p>

        <div style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap", marginBottom: 14 }}>
          <Field label="What this ward calls them">
            <input style={{ ...inputStyle, width: 170 }} disabled={!staffEditable}
              value={rules.seniorTerm} placeholder="Senior"
              onChange={(e) => setRules({ seniorTerm: e.target.value })} />
          </Field>
          <Field label="More than one of them">
            <input style={{ ...inputStyle, width: 170 }} disabled={!staffEditable}
              value={rules.seniorTermPlural} placeholder={`${termOne}s`}
              onChange={(e) => setRules({ seniorTermPlural: e.target.value })} />
          </Field>
          <p style={{ ...hint, margin: "0 0 9px", flex: "1 1 220px", minWidth: 200 }}>
            In-charge, team leader, sister — whatever you say on the ward. It is used everywhere on
            this page, including the warnings.
          </p>
        </div>

        <div style={{ display: "grid", gap: 9 }}>
          {allStaff.map((s) => {
            const only = rules.staffShifts?.[s.id] || [];
            const skipped = rules.skipStaff.includes(s.id);
            const isSenior = rules.seniorStaff.includes(s.id);
            return (
              <div key={s.id} style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap", opacity: skipped ? 0.55 : 1 }}>
                <span style={{ fontSize: 13, fontWeight: 600, minWidth: 104 }}>{s.name}</span>
                {SHIFTS.map((sh) => {
                  const on = only.includes(sh);
                  return (
                    <button key={sh} disabled={!staffEditable || skipped}
                      onClick={() => setStaffShifts(s.id, on ? only.filter((x) => x !== sh) : [...only, sh])}
                      style={chip(on, T.lagoon)}>
                      {on ? "✓ " : ""}{SHIFT_LABELS[sh]}
                    </button>
                  );
                })}
                <span style={{ width: 1, height: 20, background: T.line, margin: "0 2px" }} />
                <button disabled={!staffEditable || skipped} onClick={() => toggleSenior(s.id)}
                  style={chip(isSenior, T.lagoon)}>
                  {isSenior ? "✓ " : ""}{termOne}
                </button>
                <button disabled={!staffEditable} onClick={() => toggleSkip(s.id)} style={chip(skipped, T.coral)}>
                  {skipped ? "✓ Skipped" : "Skip"}
                </button>
              </div>
            );
          })}
          {!allStaff.length && <p style={{ fontSize: 12.5, color: T.inkSoft, margin: 0 }}>No staff yet.</p>}
        </div>
      </Card>

      {/* ── More rules ── */}
      <Card style={{ padding: showMore ? 18 : "12px 18px" }}>
        <button onClick={() => setShowMore(!showMore)}
          style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit",
                   fontSize: 14, fontWeight: 700, color: T.ink, display: "flex", alignItems: "center", gap: 6 }}>
          {showMore ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          More rules
        </button>
        {showMore && (
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", margin: "12px 0 0" }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Duty rules</span>
            <Strength value={rules.ruleStates?.sequence} disabled={!staffEditable} T={T} sel={sel}
              onChange={(v) => setRules({ ruleStates: { ...rules.ruleStates, sequence: v } })} />
            <span style={{ fontSize: 13, fontWeight: 600, marginLeft: 12 }}>Working pattern</span>
            <Strength value={rules.ruleStates?.workPattern} disabled={!staffEditable} T={T} sel={sel}
              onChange={(v) => setRules({ ruleStates: { ...rules.ruleStates, workPattern: v } })} />
          </div>
        )}
        {showMore && (
          <div style={{ marginTop: 14 }}>
            <p style={hint}>
              What may follow what, from one day to the next. These are already set to the usual
              rules: no morning, afternoon or evening straight after a night, and no morning after
              an afternoon or evening.
            </p>
            <div style={{ display: "grid", gap: 8 }}>
              {rules.sequenceRules.map((r) => (
                <div key={r.id} style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap" }}>
                  <select value={r.type} disabled={!staffEditable} style={sel}
                    onChange={(e) => setRules({ sequenceRules: rules.sequenceRules.map((x) => x.id === r.id ? { ...x, type: e.target.value } : x) })}>
                    <option value="never">Never give</option>
                    <option value="must">Always give</option>
                  </select>
                  <select value={r.then} disabled={!staffEditable} style={sel}
                    onChange={(e) => setRules({ sequenceRules: rules.sequenceRules.map((x) => x.id === r.id ? { ...x, then: e.target.value } : x) })}>
                    {SEQ_CATS.map((c) => <option key={c} value={c}>{SEQ_LABELS[c]}</option>)}
                  </select>
                  <span style={{ fontSize: 13, color: T.inkSoft }}>after</span>
                  <select value={r.after} disabled={!staffEditable} style={sel}
                    onChange={(e) => setRules({ sequenceRules: rules.sequenceRules.map((x) => x.id === r.id ? { ...x, after: e.target.value } : x) })}>
                    {SEQ_CATS.map((c) => <option key={c} value={c}>{SEQ_LABELS[c]}</option>)}
                  </select>
                  <Btn kind="danger" small disabled={!staffEditable}
                    onClick={() => setRules({ sequenceRules: rules.sequenceRules.filter((x) => x.id !== r.id) })}>
                    <Trash2 size={13} />
                  </Btn>
                </div>
              ))}
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <Btn kind="ghost" small disabled={!staffEditable}
                  onClick={() => setRules({ sequenceRules: [...rules.sequenceRules, { id: uid(), type: "never", after: "night", then: "morning" }] })}>
                  <Plus size={14} /> Add a rule
                </Btn>
                <Btn kind="ghost" small disabled={!staffEditable}
                  onClick={() => setRules({ sequenceRules: DEFAULT_RULES.sequenceRules })}>
                  Reset to the usual rules
                </Btn>
              </div>
            </div>

            {/* ── Which code gets written ── */}
            <div style={{ marginTop: 18, borderTop: `1px solid ${T.line}`, paddingTop: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Which code to write</div>
              <p style={{ ...hint, marginBottom: 12 }}>
                Several of your codes can count as the same thing — M and M(R) are both mornings,
                and you may have more than one kind of off day. <strong>Work it out</strong> uses the
                first code set to count as that type, which is right for most wards. Choose
                explicitly if it is picking the wrong one.
              </p>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {[
                  ["morning", "Morning", "morning"],
                  ["afternoon", "Afternoon", "afternoon"],
                  ["evening", "Evening", "evening"],
                  ["night", "Night", "night"],
                  ["off", "Off day", "off"],
                  ["nightOff", "Rest day after nights", "off"],
                ].filter(([slot]) => {
                  // Only offer shifts the ward actually runs; off days always.
                  if (slot === "off" || slot === "nightOff") return true;
                  return (rules.coverage[slot]?.min || 0) > 0 || (rules.coverage[slot]?.max || 0) > 0;
                }).map(([slot, label, cat]) => {
                  const options = (data.codes || []).filter((c) => c.counts === cat);
                  const auto = options[0]?.code;
                  const autoNightOff = options.find((c) => /\(N\)/i.test(c.code))?.code;
                  const fallback = slot === "nightOff" ? (autoNightOff || auto) : auto;
                  return (
                    <Field key={slot} label={label}>
                      <select style={{ ...sel, minWidth: 150 }} disabled={!staffEditable}
                        value={rules.codeFor?.[slot] || ""}
                        onChange={(e) => setRules({ codeFor: { ...rules.codeFor, [slot]: e.target.value } })}>
                        <option value="">Work it out{fallback ? ` — ${fallback}` : ""}</option>
                        {options.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.label}</option>)}
                      </select>
                    </Field>
                  );
                })}
              </div>
              {/* The rest day after nights is the one wards name most variously,
                  and the one most likely to be guessed wrong in silence. */}
              {(() => {
                const offs = (data.codes || []).filter((c) => c.counts === "off");
                const bracketed = offs.filter((c) => /\(N\)/i.test(c.code));
                if (rules.codeFor?.nightOff) return null;
                if (bracketed.length > 1) {
                  return (
                    <p style={{ ...hint, margin: "12px 0 0", color: "#8A5A0F" }}>
                      You have more than one off code with (N) in it — {bracketed.map((c) => c.code).join(", ")} —
                      so <strong>{bracketed[0].code}</strong> is being used for the rest day after nights.
                      Choose above if that is the wrong one.
                    </p>
                  );
                }
                if (bracketed.length === 0 && offs.length > 0) {
                  return (
                    <p style={{ ...hint, margin: "12px 0 0" }}>
                      No off code has (N) in its name, so the rest day after nights is written as{" "}
                      <strong>{offs[0].code}</strong> like any other off day. If you have a separate
                      code for it — N/OFF, NOFF, or whatever your ward calls it — choose it above.
                    </p>
                  );
                }
                return null;
              })()}
            </div>

            <div style={{ marginTop: 18 }}>
              <Field label="Look back at recent duties">
                <select value={rules.lookbackDays} disabled={!staffEditable} style={{ ...sel, minWidth: 160 }}
                  onChange={(e) => setRules({ lookbackDays: Number(e.target.value) })}>
                  <option value={0}>Do not look back</option>
                  <option value={14}>Last 14 days</option>
                  <option value={30}>Last 30 days</option>
                  <option value={60}>Last 60 days</option>
                  <option value={90}>Last 90 days</option>
                </select>
              </Field>
              <p style={{ ...hint, margin: "6px 0 0" }}>
                Recent duties are counted so fairness carries across weeks — someone who did a lot of
                nights last week gets fewer this week. Non-official days are counted over the same
                period. Staff who joined recently are compared on their rate, not their totals, so
                they are never given extra to catch up.
              </p>
            </div>
          </div>
        )}
      </Card>

      {/* ── Generate ── */}
      <Card>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "end" }}>
          <Field label={`Week beginning (${DAY_LABEL[firstDay]})`}>
            <input type="date" value={weekStart} disabled={!staffEditable}
              onChange={(e) => { setWeekStart(dstr(weekStartOf(e.target.value, firstDay))); setProposal(null); }}
              style={{ ...inputStyle, width: "auto" }} />
          </Field>
          <div style={{ fontSize: 12.5, color: T.inkSoft, paddingBottom: 9 }}>{weekLabel}</div>
          <Btn onClick={generate} disabled={!staffEditable || busy}>
            <Wand2 size={15} /> {busy ? "Generating…" : "Generate this week"}
          </Btn>
          {busy && (
            <div style={{ fontSize: 12, color: T.inkSoft, paddingBottom: 9 }}>
              Building the week, then improving it — about a second.
            </div>
          )}
        </div>

        {/* Somebody who has left, or has not started, is not on the rota for
            this week — so they are not rostered either. Said here because the
            alternative is noticing a missing row after applying. */}
        {notThisWeek.length > 0 && (
          <div style={{ fontSize: 12.5, color: T.inkSoft, marginTop: 10, lineHeight: 1.6 }}>
            Not on the rota this week, so left out:{" "}
            {notThisWeek.map((x) => `${x.name} (${x.why})`).join(", ")}. Employment dates are set
            on the <strong>Staff</strong> tab.
          </div>
        )}

        {feasibility?.warnings?.length > 0 && feasibility.ok && (
          <div style={{ background: "#FBF1DC", border: "1px solid #E7D9B8", borderRadius: 10, padding: "11px 13px", marginTop: 14 }}>
            <div style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
              <AlertTriangle size={15} color="#8A5A0F" style={{ flexShrink: 0, marginTop: 2 }} />
              <div style={{ fontSize: 12.5, color: "#8A5A0F", lineHeight: 1.7, minWidth: 0 }}>
                <strong>Worth knowing before you generate:</strong>
                <ul style={{ margin: "5px 0 0", paddingLeft: 17 }}>
                  {feasibility.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </div>
            </div>
          </div>
        )}

        {feasibility && !feasibility.ok && (
          <div style={{ background: "#FBF1DC", border: "1px solid #E7D9B8", borderRadius: 10, padding: "11px 13px", marginTop: 14 }}>
            <div style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
              <AlertTriangle size={15} color="#8A5A0F" style={{ flexShrink: 0, marginTop: 2 }} />
              <div style={{ fontSize: 12.5, color: "#8A5A0F", lineHeight: 1.7, minWidth: 0 }}>
                <strong>These settings cannot produce a week yet:</strong>
                <ul style={{ margin: "5px 0 0", paddingLeft: 17 }}>
                  {feasibility.problems.map((p, i) => <li key={i}>{p}</li>)}
                </ul>
              </div>
            </div>
          </div>
        )}
      </Card>

      {proposal?.failed && (
        <Card style={{ background: "#FBEAE7", borderColor: "#F1B8AE" }}>
          <strong style={{ fontSize: 14, color: "#8A2E1E" }}>Could not generate</strong>
          <ul style={{ margin: "7px 0 0", paddingLeft: 18, fontSize: 13, color: "#8A2E1E", lineHeight: 1.7 }}>
            {proposal.problems.map((p, i) => <li key={i}>{p}</li>)}
          </ul>
        </Card>
      )}

      {proposal && !proposal.failed && (
        <Week proposal={proposal} data={data} activeStaff={activeStaff} weekLabel={weekLabel}
          codeById={codeById} termOne={termOne} termMany={termMany}
          onApply={apply} onDiscard={() => setProposal(null)}
          T={T} Card={Card} Btn={Btn} Field={Field} inputStyle={inputStyle}
          th={th} td={td} dstr={dstr} rules={rules} />
      )}
    </div>
  );
}

/* The proposed week, with the counts underneath. Coverage is shown per day
   so a short shift is obvious at a glance, and each person's mix of duties
   is shown so an unfair week cannot hide behind a tidy-looking grid. */
function Week({ proposal, data, activeStaff, weekLabel, onApply, onDiscard, T, Card, Btn, Field, inputStyle, th, td, dstr, rules, codeById, termOne, termMany }) {
  const { report, rotaCells, cells, from } = proposal;
  const dates = useMemo(() => [...Array(7)].map((_, i) => dstr(addDays(new Date(from), i))), [from, dstr]);
  const colorOf = useMemo(() => {
    const m = {}; (data.codes || []).forEach((c) => { m[c.code] = c.color; }); return m;
  }, [data.codes]);

  const lower = termOne.toLowerCase();
  const isSenior = (id) => (rules.seniorStaff || []).includes(id);
  const countOn = (date, sh) => activeStaff.reduce((n, s) => n + (cells[`${s.id}|${date}`] === sh ? 1 : 0), 0);
  const seniorsOn = (date, sh) =>
    activeStaff.reduce((n, s) => n + (cells[`${s.id}|${date}`] === sh && isSenior(s.id) ? 1 : 0), 0);
  const usedShifts = SHIFTS.filter((sh) => (rules.coverage[sh]?.min || 0) > 0 || (rules.coverage[sh]?.max || 0) > 0);
  // Totals sit beside the grid, as they do on the printed rota, so a
  // lopsided week is visible on the same row as the duties that caused it.
  const totalsFor = useMemo(() => {
    const m = {};
    report.perStaff.forEach((p) => { m[p.id] = p; });
    return m;
  }, [report.perStaff]);
  const totalCols = [...usedShifts, "off"];
  const COL_LABEL = { morning: "M", afternoon: "A", evening: "E", night: "N", off: "OFF" };

  const week = report.budget?.[0];
  const dayOf = (d) => new Date(d).getDate();
  const note = { background: "#FBF1DC", border: "1px solid #E7D9B8", borderRadius: 10,
                 padding: "10px 12px", marginTop: 12, fontSize: 12.5, color: "#8A5A0F", lineHeight: 1.6 };

  return (
    <>
      <Card style={{ borderColor: T.lagoon, borderWidth: 2 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <h3 style={{ fontFamily: "Sora, sans-serif", fontSize: 16, margin: "0 0 3px" }}>Proposed week</h3>
            <span style={{ fontSize: 12.5, color: T.inkSoft }}>{weekLabel} · {report.rosteredCount} staff</span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn kind="ghost" onClick={onDiscard}><X size={15} /> Discard</Btn>
            <Btn onClick={onApply}><Check size={15} /> Apply to rota</Btn>
          </div>
        </div>

        {report.shortfalls.length > 0 && (
          <div style={note}>
            <strong>{report.shortfalls.length} shift{report.shortfalls.length === 1 ? "" : "s"} could not be filled:</strong>{" "}
            {report.shortfalls.map((s) => `${dayOf(s.date)} ${s.shift}`).join(", ")}.{" "}
            {/* The numbers, not "there were not enough staff free" — two duties
                short and five duties short need different answers. */}
            {week && week.spare < 0
              ? `This week needs ${week.dutiesNeeded} duties and your staff can work ${week.dutiesAvailable} between them, so you are ${-week.spare} short. Raise the weekly duty maximum by one, lower a shift minimum, or add someone.`
              : `There were enough duties available (${week ? `${week.dutiesAvailable} for ${week.dutiesNeeded} needed` : "on paper"}), but the rest rules left nobody free at those moments. Loosening a limit under "More rules" would usually fix it.`}
            {" "}You can apply this and fill them by hand.
          </div>
        )}

        {report.seniorGaps?.length > 0 && (
          <div style={note}>
            <strong>{report.seniorGaps.length} shift{report.seniorGaps.length === 1 ? " has" : "s have"} no {lower} on duty:</strong>{" "}
            {report.seniorGaps.map((s) => `${dayOf(s.date)} ${s.shift}`).join(", ")}.{" "}
            {week && week.seniorSpare < 0
              ? `${week.seniorDutiesNeeded} ${lower} duties are needed this week and your ${week.seniorCount} ${week.seniorCount === 1 ? lower : termMany.toLowerCase()} can work ${week.seniorDutiesAvailable}. Tick another, or ask for one on fewer shifts.`
              : `The shift is staffed — just not by anyone ticked as a ${lower}.`}
          </div>
        )}

        {report.relaxations?.length > 0 && (
          <div style={note}>
            {/* This lists what the FINISHED week does, not what the generator
                bent along the way — those are different things, and only the
                first is worth your attention. */}
            <strong>The week works, but {report.relaxations.length} of your
              setting{report.relaxations.length === 1 ? " is" : "s are"} not fully met:</strong>{" "}
            {Object.entries(report.relaxations.reduce((m, r) => { m[r.rule] = (m[r.rule] || 0) + 1; return m; }, {}))
              .sort((a, b) => b[1] - a[1])
              .map(([r, n]) => `${r} (${n})`).join(", ")}.
          </div>
        )}
      </Card>

      <Card style={{ padding: 0, overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 12, width: "100%" }}>
          <thead>
            <tr>
              <th style={{ ...th, position: "sticky", left: 0, background: "#fff", zIndex: 2 }}>Staff</th>
              {dates.map((d) => {
                const dd = new Date(d);
                return (
                  <th key={d} style={{ ...th, textAlign: "center", padding: "7px 5px", minWidth: 54 }}>
                    <div style={{ fontSize: 9.5, color: T.inkSoft }}>{["SUN","MON","TUE","WED","THU","FRI","SAT"][dd.getDay()]}</div>
                    <div>{dd.getDate()}</div>
                  </th>
                );
              })}
              {totalCols.map((c) => (
                <th key={c} style={{ ...th, textAlign: "center", padding: "7px 6px", background: "#F1F5F4", minWidth: 34 }}>
                  {COL_LABEL[c]}
                </th>
              ))}
              <th style={{ ...th, textAlign: "center", padding: "7px 8px", background: "#FBF1DC", whiteSpace: "nowrap" }}>
                Non-off
              </th>
            </tr>
          </thead>
          <tbody>
            {activeStaff.map((s) => (
              <tr key={s.id}>
                <td style={{ ...td, position: "sticky", left: 0, background: "#fff", fontWeight: 600, zIndex: 1 }}>
                  {s.name}
                  {isSenior(s.id) && (
                    <span title={termOne} style={{ marginLeft: 5, fontSize: 9.5, fontWeight: 700, color: T.lagoon,
                      border: `1px solid ${T.lagoon}`, borderRadius: 4, padding: "1px 4px" }}>
                      {termOne.slice(0, 3).toUpperCase()}
                    </span>
                  )}
                </td>
                {dates.map((d) => {
                  const code = rotaCells[`${s.id}|${d}`];
                  return (
                    <td key={d} style={{ ...td, textAlign: "center", padding: "6px 4px",
                      background: code && colorOf[code] ? colorOf[code] + "33" : code ? "transparent" : "#F7FAFA" }}>
                      {code || <span style={{ color: "#C7D6D3" }}>—</span>}
                    </td>
                  );
                })}
                {totalCols.map((c) => (
                  <td key={c} style={{ ...td, textAlign: "center", background: "#F1F5F4", fontWeight: 600 }}>
                    {totalsFor[s.id]?.[c] ?? 0}
                  </td>
                ))}
                <td style={{ ...td, textAlign: "center", background: "#FBF1DC", fontWeight: 700 }}>
                  {totalsFor[s.id]?.nonOfficial ?? 0}
                </td>
              </tr>
            ))}
            {usedShifts.map((sh) => {
              const needSenior = rules.seniorCover?.[sh] || 0;
              return (
                <tr key={sh} style={{ background: "#F7FAFA" }}>
                  <td style={{ ...td, position: "sticky", left: 0, background: "#F7FAFA", fontWeight: 700, fontSize: 11.5, textTransform: "uppercase", letterSpacing: 0.3, color: T.inkSoft }}>
                    {SHIFT_LABELS[sh]}
                  </td>
                  {dates.map((d) => {
                    const c = countOn(d, sh);
                    const min = rules.coverage[sh]?.min || 0;
                    const led = needSenior ? seniorsOn(d, sh) : 0;
                    return (
                      <td key={d} style={{ ...td, textAlign: "center", fontWeight: 700, color: c < min ? T.coral : T.ink }}>
                        {c}
                        {needSenior > 0 && (
                          <div style={{ fontSize: 9.5, fontWeight: 700, marginTop: 1,
                            color: led < needSenior ? T.coral : T.inkSoft }}>
                            {led}/{needSenior}
                          </div>
                        )}
                      </td>
                    );
                  })}
                  {totalCols.map((c) => <td key={c} style={{ ...td, background: "#F1F5F4" }} />)}
                  <td style={{ ...td, background: "#FBF1DC" }} />
                </tr>
              );
            })}
          </tbody>
        </table>
        <p style={{ fontSize: 11.5, color: T.inkSoft, margin: 0, padding: "10px 14px 14px", lineHeight: 1.6 }}>
          The grey columns are each person's totals for the week, and the last one counts duties on
          non-official days. A fair week shows a mix along each row, not one duty type repeated —
          except for staff tied to a single shift, who will only ever show that one. The rows at the
          bottom are how many staff are on each shift that day; red means below your minimum. Where
          you have asked for a {lower}, the small figure underneath is how many are on that shift
          against how many you asked for.
        </p>
      </Card>

      <YearToDate proposal={proposal} activeStaff={activeStaff} rules={rules}
        T={T} Card={Card} Btn={Btn} Field={Field} inputStyle={inputStyle}
        th={th} td={td} codeById={codeById} data={data} />
    </>
  );
}

/* Totals since 1 January, with this proposed week folded in. Non-official
   days carry extra pay, so they are the numbers people compare across the
   year rather than the week — a gap that looks small in seven days can be
   twenty duties by December. Shown after the week so the effect of applying
   it is visible before deciding. */
/* Totals over a date range, with this proposed week folded in. Non-official
   days carry extra pay, so they are the numbers people compare across the
   year rather than the week — a gap that looks small in seven days can be
   twenty duties by December.

   The range is the manager's to choose. "Since January" answers one question;
   "since the last roster meeting", "this month", "the last quarter" answer
   others, and those are usually the ones being argued about. The proposed
   week is counted in whenever it falls inside the range, and the heading
   says plainly when it does not.                                          */
function YearToDate({ proposal, activeStaff, rules, T, Card, Btn, Field, inputStyle, th, td, codeById, data }) {
  const { rotaCells, yearStart, from: weekFrom, to: weekTo } = proposal;

  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const pretty = (v) => {
    const [y, m, d] = String(v).split("-").map(Number);
    if (!y) return v;
    return new Date(y, m - 1, d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  };

  /* Starts where it always did — 1 January to the end of the proposed week —
     so nobody who liked the old behaviour has to do anything. */
  const [span, setSpan] = useState({ from: yearStart, to: weekTo });
  const valid = span.from && span.to && span.from <= span.to;
  // Whether the week being proposed actually falls inside the chosen range.
  const weekCounted = valid && weekFrom <= span.to && weekTo >= span.from;

  const preset = (kind) => {
    const now = new Date();
    if (kind === "year") return setSpan({ from: yearStart, to: weekTo });
    if (kind === "month") {
      return setSpan({
        from: iso(new Date(now.getFullYear(), now.getMonth(), 1)),
        to: iso(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
      });
    }
    if (kind === "quarter") {
      return setSpan({ from: iso(new Date(now.getFullYear(), now.getMonth() - 2, 1)), to: weekTo });
    }
  };

  const catOf = useMemo(() => {
    const m = {}; (data.codes || []).forEach((c) => { m[c.code] = c.counts; }); return m;
  }, [data.codes]);

  const isNonOfficial = (date) => {
    if ((data.nonOfficial || []).includes(date)) return true;
    if (!data.fridayRule) return false;
    const [y, m, d] = date.split("-").map(Number);
    return new Date(y, m - 1, d).getDay() === 5;
  };

  /* ── Who belongs in this table ──
     Whoever was employed at some point inside the range. Somebody who left
     in March has no business in a table covering May onwards, and somebody
     starting in August has none either — their empty row is just a question
     the manager has to stop and answer.

     Employment dates are inclusive at both ends, and blank means "always" —
     the same reading the Staff tab and the rota grid use. */
  const employedInRange = (s, from, to) => {
    if (s.startDate && s.startDate > to) return false;
    if (s.endDate && s.endDate < from) return false;
    return true;
  };
  const employedOnDate = (s, date) => {
    if (s.startDate && date < s.startDate) return false;
    if (s.endDate && date > s.endDate) return false;
    return true;
  };

  /* Read straight from the rota for whatever range is chosen, rather than
     from a slice prepared in advance — otherwise changing the dates could
     only ever narrow what was already fetched. */
  const totals = useMemo(() => {
    const t = {};
    const byId = {};
    (data.staff || []).forEach((s) => {
      byId[s.id] = s;
      t[s.id] = { morning: 0, afternoon: 0, evening: 0, night: 0, off: 0, nonOfficial: 0, any: 0 };
    });
    if (!valid) return t;

    const add = (sid, code, date) => {
      const cat = catOf[code];
      if (!t[sid] || !cat || t[sid][cat] === undefined) return;
      /* A duty on a day somebody was not employed is not a duty they worked.
         Such cells can exist — an earlier version of this page rostered
         staff the rota itself does not show — and counting them would put
         duties against a nurse who had already left. The Staff Records tab
         has always skipped them; this now agrees with it. */
      if (!employedOnDate(byId[sid] || {}, date)) return;
      t[sid][cat] += 1;
      t[sid].any += 1;
      if (cat !== "off" && isNonOfficial(date)) t[sid].nonOfficial += 1;
    };

    for (const [date, row] of Object.entries(data.cells || {})) {
      if (date < span.from || date > span.to) continue;
      // The proposed week replaces whatever is currently on those dates.
      if (weekCounted && date >= weekFrom && date <= weekTo) continue;
      for (const [sid, codeId] of Object.entries(row || {})) {
        const code = codeById[codeId];
        if (code) add(sid, code, date);
      }
    }
    if (weekCounted) {
      for (const [key, code] of Object.entries(rotaCells || {})) {
        const cut = key.lastIndexOf("|");
        const sid = key.slice(0, cut), date = key.slice(cut + 1);
        if (date < span.from || date > span.to) continue;
        add(sid, code, date);
      }
    }
    return t;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.cells, data.staff, catOf, codeById, rotaCells, span, valid, weekCounted, weekFrom, weekTo]);

  /* A range covering March shows March's team, not today's — so this is
     employment, not "has duties". Somebody employed the whole range with an
     empty rota still belongs here, and their row of zeros is the point. */
  const rows = useMemo(
    () => (valid ? (data.staff || []).filter((s) => employedInRange(s, span.from, span.to)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.staff, span, valid]
  );

  const used = SHIFTS.filter((sh) => (rules.coverage[sh]?.max || 0) > 0 || (rules.coverage[sh]?.min || 0) > 0);
  const LABEL = { morning: "Morning", afternoon: "Afternoon", evening: "Evening", night: "Night" };
  const dateBox = { ...inputStyle, width: "auto" };

  return (
    <Card>
      <h3 style={{ fontFamily: "Sora, sans-serif", fontSize: 15, margin: "0 0 4px" }}>
        Totals for {valid ? `${pretty(span.from)} – ${pretty(span.to)}` : "the chosen range"}
        {weekCounted ? ", including this week" : ""}
      </h3>
      <p style={{ fontSize: 12, color: T.inkSoft, margin: "0 0 12px", lineHeight: 1.6 }}>
        {weekCounted
          ? `The proposed week (${pretty(weekFrom)} – ${pretty(weekTo)}) is inside this range and counted in, replacing whatever is currently on those dates. `
          : `The proposed week (${pretty(weekFrom)} – ${pretty(weekTo)}) is outside this range, so it is not counted. `}
        Only staff employed during the range are listed. 
        Non-official duties carry extra pay, so these are the numbers worth keeping level — a small
        gap in one week becomes a large one by December.
      </p>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 14 }}>
        <Field label="From">
          <input type="date" style={dateBox} value={span.from}
            onChange={(e) => setSpan({ ...span, from: e.target.value })} />
        </Field>
        <Field label="To">
          <input type="date" style={dateBox} value={span.to}
            onChange={(e) => setSpan({ ...span, to: e.target.value })} />
        </Field>
        <Btn kind="ghost" small onClick={() => preset("year")}>This year</Btn>
        <Btn kind="ghost" small onClick={() => preset("quarter")}>Last 3 months</Btn>
        <Btn kind="ghost" small onClick={() => preset("month")}>This month</Btn>
      </div>

      {!valid ? (
        <div style={{ fontSize: 13, color: T.coral }}>
          Pick a valid range — "From" must be on or before "To".
        </div>
      ) : !rows.length ? (
        <div style={{ fontSize: 13, color: T.inkSoft, padding: "16px 0", textAlign: "center" }}>
          No duties recorded in this range.
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 460 }}>
            <thead>
              <tr>
                <th style={th}>Staff</th>
                {used.map((sh) => <th key={sh} style={{ ...th, textAlign: "center" }}>{LABEL[sh]}</th>)}
                <th style={{ ...th, textAlign: "center" }}>Off</th>
                <th style={{ ...th, textAlign: "center", background: "#FBF1DC" }}>Non-official</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td style={{ ...td, fontWeight: 600 }}>
                    {s.name}
                    {!activeStaff.some((a) => a.id === s.id) && (
                      <span style={{ marginLeft: 7, fontSize: 11, color: T.inkSoft, fontWeight: 500 }}>
                        not on this week
                      </span>
                    )}
                  </td>
                  {used.map((sh) => (
                    <td key={sh} style={{ ...td, textAlign: "center" }}>{totals[s.id]?.[sh] ?? 0}</td>
                  ))}
                  <td style={{ ...td, textAlign: "center" }}>{totals[s.id]?.off ?? 0}</td>
                  <td style={{ ...td, textAlign: "center", fontWeight: 700, background: "#FBF1DC" }}>
                    {totals[s.id]?.nonOfficial ?? 0}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}