/* ─────────────── Do these settings fit this ward? ───────────────
   The check shown at the top of Smart Roster. It is worked out from the
   saved settings and the people on the roster alone — nothing about one
   week's leave or requests — and finds the first thing that cannot add up,
   in a fixed order, said with the numbers.

   It never stops a week being made, and it changes nothing the engine
   does: the engine has its own checks before generating, and where one of
   those says the same thing as the line shown here, `hides` lets the screen
   leave it out rather than say it twice.

   Pure functions only — no React, nothing saved.                        */

// The engine's SHIFTS; not imported, so this file stays free of the engine.
const SHIFTS = ["morning", "afternoon", "evening", "night"];
const LABEL = { morning: "Morning", afternoon: "Afternoon", evening: "Evening", night: "Night" };

const many = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const duties = (n) => `${n} ${n === 1 ? "duty" : "duties"}`;
const sum = (list) => list.reduce((a, b) => a + b, 0);
const none = () => false;

/* The settings as text, the same whatever order they were saved in. Used to
   tell whether anything has changed since "Fix it for me". */
export const settingsKey = (x) => JSON.stringify(x, (_, v) => (
  v && typeof v === "object" && !Array.isArray(v)
    ? Object.keys(v).sort().reduce((o, k) => { o[k] = v[k]; return o; }, {})
    : v));

/* `rules` are the ward's settings laid over the defaults (mergeRules);
   `staff` is everyone on the rota for the week being planned. Returns
     { ok: true, count }                       the settings fit
     { ok: false, count, check, text, ... }    the first problem, where
   `check` is its number in the order below, `stops` is true when Generate
   itself would refuse, `hides(line)` is true for an engine message that
   says the same thing, and `fix` — only where there is one obvious fix —
   is { shift, from, to, text }: one more allowed on that shift.        */
export function checkSettings(rules, staff) {
  const roster = (staff || []).filter((s) => !(rules.skipStaff || []).includes(s.id));
  const count = roster.length;
  const bad = (check, text, more = {}) => ({ ok: false, count, check, text, stops: false, hides: none, ...more });

  if (!count) {
    return bad(0, (staff || []).length
      ? "Everyone on the rota this week is skipped, so there is nobody to roster."
      : "Nobody is on the rota for this week, so there is nobody to roster.",
    { stops: true, hides: (line) => /^No staff are available/.test(line) });
  }

  // Set to Ignore: the engine does not apply it, so nothing here depends on it.
  const ignored = (key) => rules.ruleStates?.[key]?.state === "disabled";
  const cover = (sh) => rules.coverage?.[sh] || {};
  // Only shifts the ward runs carry a per-person number.
  const run = SHIFTS.filter((sh) => cover(sh).max !== 0);
  const least = (sh) => rules.weeklyMin?.[sh];
  const most = (sh) => (ignored(`weeklyCaps:${sh}`) ? null : rules.weeklyMax?.[sh]);
  const offLeast = ignored("offMin") ? null : rules.weeklyMin?.off;
  const offMost = ignored("offMax") ? null : rules.weeklyMax?.off;
  const workLeast = rules.weeklyDuties?.min, workMost = rules.weeklyDuties?.max;

  // 1. A row asking for at least more than its at most.
  for (const sh of SHIFTS) {
    const { min, max } = cover(sh);
    if (min != null && max != null && min > max) {
      return bad(1, `${LABEL[sh]}: at least ${min} on duty, but at most ${max}.`,
        { stops: true, hides: (line) => line.startsWith(`${sh}: the maximum (`) });
    }
  }
  for (const sh of run) {
    if (least(sh) != null && most(sh) != null && least(sh) > most(sh)) {
      return bad(1, `Each person: at least ${many(least(sh), LABEL[sh])} a week, but at most ${most(sh)}.`);
    }
  }
  if (offLeast != null && offMost != null && offLeast > offMost) {
    return bad(1, `Each person: at least ${many(offLeast, "off day")} a week, but at most ${offMost}.`);
  }
  if (workLeast != null && workMost != null && workLeast > workMost) {
    return bad(1, `Each person: at least ${many(workLeast, "working day")} a week, but at most ${workMost}.`);
  }

  // 2. A shift kept in runs that nobody may have two of. Never more to a
  //    run than In a row — most allows, as the engine reads it.
  for (const sh of run) {
    const together = Math.min(rules.blockTogether?.[sh] ?? 1, rules.blockDays?.[sh] ?? 99);
    if (together >= 2 && most(sh) != null && most(sh) < 2) {
      return bad(2, `${LABEL[sh]} is set to come ${together} together, but each person gets at most ${many(most(sh), LABEL[sh])} a week.`);
    }
  }

  // 3. The fewest of each shift, added up, against the days somebody works.
  const leasts = run.filter((sh) => least(sh) > 0);
  const leastSum = sum(leasts.map(least));
  if (leastSum > (workMost ?? 7)) {
    return bad(3, `Each person's fewest add up to ${duties(leastSum)} a week `
      + `(${leasts.map((sh) => `${LABEL[sh]} ${least(sh)}`).join(", ")}), but `
      + (workMost != null ? `they work at most ${many(workMost, "day")}.` : "a week has only 7 days."));
  }

  // 4. The most of each shift, added up, too low to fill the working days.
  //    Only when every shift the ward runs has a most that is held.
  if (workLeast != null && run.length && run.every((sh) => most(sh) != null)) {
    const mostSum = sum(run.map(most));
    if (mostSum < workLeast) {
      return bad(4, `Each person's most add up to ${duties(mostSum)} a week `
        + `(${run.map((sh) => `${LABEL[sh]} ${most(sh)}`).join(", ")}), fewer than their ${many(workLeast, "working day")}.`);
    }
  }

  // 5. Working days and off days that cannot both be kept in a 7-day week.
  const exact = workLeast === workMost;
  if (workMost != null && offMost != null && 7 - workMost > offMost) {
    return bad(5, `${exact ? "" : "At most "}${many(workMost, "working day")} leaves ${exact ? "" : "at least "}`
      + `${many(7 - workMost, "off day")} a week, but off days are set to at most ${offMost}.`);
  }
  if (workLeast != null && offLeast != null && 7 - workLeast < offLeast) {
    return bad(5, `${exact ? "" : "At least "}${many(workLeast, "working day")} leaves ${exact ? "" : "at most "}`
      + `${many(7 - workLeast, "off day")} a week, but off days are set to at least ${offLeast}.`);
  }

  // 6. More duties to hand out than the shifts have room for. An empty
  //    most counts as the fewest, as the engine's own warning counts it.
  const roomPerDay = sum(SHIFTS.map((sh) => (cover(sh).max != null ? cover(sh).max : (cover(sh).min || 0))));
  if (workLeast != null && count * workLeast > roomPerDay * 7) {
    const over = count * workLeast - roomPerDay * 7;
    /* One more allowed on one shift, where that is enough: the shift the
       most people are set up for, the earlier in the day when level, and
       never more than there are people to fill it. */
    const allowed = (sh) => roster.filter((s) => {
      const only = rules.staffShifts?.[s.id];
      return !only || !only.length || only.includes(sh);
    }).length;
    const shift = over > 7 ? null : SHIFTS
      .filter((sh) => cover(sh).max > 0 && cover(sh).max + 1 <= allowed(sh))
      .sort((a, b) => allowed(b) - allowed(a))[0];
    const fix = shift && {
      shift, from: cover(shift).max, to: cover(shift).max + 1,
      text: `${LABEL[shift]}: at most ${cover(shift).max} → ${cover(shift).max + 1}`,
    };
    return bad(6, `${count} staff working ${many(workLeast, "day")} is ${count * workLeast} duties a week, but your shifts `
      + `have room for only ${roomPerDay * 7} (${roomPerDay} a day × 7). Allow more staff on a shift, or lower the working days.`,
    { ...(fix ? { fix } : {}), hides: (line) => /^(Duties per week|Off days): .*even with every shift at its fullest/.test(line) });
  }

  // 7. Fewer duties available than the shifts need. What one person can
  //    work is read as the engine reads it: the most working days, and no
  //    more than the off days leave — except for anyone tied to one shift.
  const needPerDay = sum(SHIFTS.map((sh) => cover(sh).min || 0));
  const can = sum(roster.map((s) => {
    const only = rules.staffShifts?.[s.id];
    let cap = workMost != null ? workMost : 7;
    if (!(only && only.length === 1) && rules.weeklyMin?.off != null) cap = Math.min(cap, 7 - rules.weeklyMin.off);
    return Math.max(0, Math.min(7, cap));
  }));
  if (needPerDay * 7 > can) {
    const short = needPerDay * 7 - can;
    return bad(7, `Your shifts need ${needPerDay * 7} duties a week (${needPerDay} a day × 7), but your ${count} staff `
      + `can work at most ${can} between them — ${short} short. Ask for fewer staff on a shift, raise the working days, or add staff.`,
    {
      stops: needPerDay > count,
      hides: (line) => /^Off days: .* leaves only about /.test(line)
        || /^Each day needs \d+ people on duty, but only /.test(line)
        // The week's own sum, unless leave has made it a different number.
        || Number((/^(?:Week of|Days from) .* — (\d+) short, so /.exec(line) || [])[1]) === short,
    });
  }

  return { ok: true, count, hides: none };
}
