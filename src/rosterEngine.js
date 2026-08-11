/* ─────────────── Smart Roster engine ───────────────
   Pure functions only: give it staff, rules and a date range, get back a
   proposed rota plus a report. It touches nothing, saves nothing, and knows
   nothing about React — which is what makes it testable.

   Two kinds of rule, and the distinction matters:

   HARD — never broken. Coverage minimums, approved duty requests, skipped
   staff, leave, sequence rules like "no Morning after a Night". If these
   cannot all be met, the engine says so rather than quietly producing a
   rota that breaks them.

   SOFT — got as close to even as the arithmetic allows. "Everyone gets the
   same number of nights" is usually impossible: 14 night duties among 21
   people does not divide evenly. Treating that as hard would mean no rota
   at all, so instead the engine spreads them and reports the spread.

   ── The duty budget ──
   A week is a fixed amount of work sitting on a fixed amount of people, and
   the second number is smaller than it looks. Six staff who may each work
   five days is thirty duties. A ward needing one of each shift every day
   needs twenty-eight. Two spare — and if the generator hands out four extra
   duties on Monday to Thursday because somebody was one short of their
   weekly minimum, Saturday has nothing left and two shifts go uncovered.

   Filling a rota day by day cannot see that coming, so the arithmetic is
   done explicitly: before any duty ABOVE a shift's minimum is handed out,
   the engine checks that the rest of the week can still be covered without
   it. Capacity that a later day needs is never spent early.

   ── Trying again ──
   Even with the budget respected, a day-by-day fill can be unlucky: an
   early choice between two equally good people can be the difference
   between a clean week and a stretched one. So the whole rota is built
   several times over, each attempt varying the order in which equally good
   candidates are picked, and the best result is kept. Attempt one is the
   plain deterministic build, so this can only improve on the old
   behaviour, never worsen it.                                            */

export const SHIFTS = ['morning', 'afternoon', 'evening', 'night'];

/* Categories the generator must never write over. If a manager has already
   recorded sick leave, family leave, medical leave or a release duty on a
   date, that is a fact about what happened — not a slot to be filled. The
   generator leaves those cells exactly as they are.                      */
const OFF_CAT = 'off';
export const PRESERVE = ['sl', 'frl', 'ml', 'leave', 'release'];

/* ── Dates ──
   Every date in this engine is the plain string a rota cell is keyed by:
   2026-05-03. They compare correctly as text and never drift.

   Turning one into a Date is the only risky moment. `new Date("2026-05-03")`
   is read as midnight UTC, and then getDay() reports the LOCAL day — which
   in the Maldives is still the 3rd, and five hours earlier in the Americas
   is the 2nd. A rota that put Friday's non-official pay on a Thursday would
   be a hard bug to find, so the parsing is done component by component and
   stays local from end to end.                                            */
const pad2 = (n) => String(n).padStart(2, '0');
const toISO = (x) => `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}`;
const parseISO = (d) => {
  const [y, m, day] = String(d).slice(0, 10).split('-').map(Number);
  return new Date(y, (m || 1) - 1, day || 1);
};
const shiftDate = (d, n) => { const x = parseISO(d); x.setDate(x.getDate() + n); return toISO(x); };
const iso = (d) => (typeof d === 'string' ? String(d).slice(0, 10) : toISO(d));
const isFriday = (d) => parseISO(d).getDay() === 5;

/* Where a week begins is the ward's own convention: Sunday across much of
   the Middle East and South Asia, Monday across most of Europe. It decides
   nothing about the duties themselves — but everything about when a weekly
   limit resets, so a ward running Monday to Sunday must not have its "five
   duties a week" counted across somebody else's Sunday.

   0 is Sunday, 1 is Monday, and so on, matching JavaScript's own numbering
   so nothing has to be translated on the way in.                          */
const startOfWeek = (d, firstDay = 0) => {
  const x = parseISO(d);
  x.setDate(x.getDate() - (((x.getDay() - firstDay) % 7) + 7) % 7);
  return toISO(x);
};

export function datesBetween(from, to) {
  const out = [];
  const stop = iso(to);
  for (let d = iso(from); d <= stop; d = shiftDate(d, 1)) out.push(d);
  return out;
}

/* A small seeded random generator. Seeded, so an attempt can be repeated
   exactly — a rota that cannot be reproduced cannot be debugged. */
const rng = (seed) => {
  let a = (seed | 0) + 0x9E3779B9;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/* ── Seniority ──
   A ward usually needs somebody on each shift who can take charge. The
   designation field will not do for this: "Sister", "Senior Staff Nurse"
   and "SSN" are one person to a human being and three different strings to
   a computer, and a rule about patient safety cannot rest on spelling. So
   seniority is an explicit flag, set once per person and left alone.

   Accepted either way round — a flag on the person, or a list of ids in the
   settings — so whichever way the app stores it, the engine reads it.    */
export function isSenior(cfg, person) {
  if (!person) return false;
  if (person.senior === true || person.isSenior === true) return true;
  return (cfg.seniorStaff || []).some((id) => String(id) === String(person.id));
}

/* How many seniors a shift needs. Set per shift, because "one senior on
   every shift" is a much bigger ask than it sounds: four shifts across
   seven days is twenty-eight senior duties a week, which at five duties
   each needs six seniors. A small ward will more often want a senior on
   nights and mornings and nobody in particular on the rest. Zero means no
   senior is required, which is the default — the rule does nothing until
   it is deliberately turned on.

   A shift the ward does not run needs no senior, whatever the setting. */
/* What the ward calls these people. "Senior" is only one of the words in
   use — charge nurse, in-charge, team leader, sister — and a message that
   says "mark somebody as senior" is confusing on a ward that has never used
   the word. So the term is set once in the settings and every message the
   engine produces uses it. The default is what most wards say.

   Purely cosmetic: nothing in the rules depends on it.                   */
export function seniorTerms(cfg) {
  const one = (cfg.seniorTerm || 'senior').trim() || 'senior';
  const many = (cfg.seniorTermPlural || `${one}s`).trim() || `${one}s`;
  const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
  // "a senior" but "an in-charge". A small thing, but a message that reads
  // like it was written by a machine is trusted like one.
  const a = /^[aeiou]/i.test(one) ? 'an' : 'a';
  return { one, many, a, One: cap(one), Many: cap(many) };
}

export function seniorsNeededOn(cfg, shift) {
  const c = cfg.seniorCover;
  if (c == null) return 0;
  if ((cfg.coverage?.[shift]?.min || 0) <= 0) return 0;
  const raw = typeof c === 'number' ? c : (c[shift] ?? c.min ?? 0);
  return Math.max(0, Number(raw) || 0);
}

/* Is this person unavailable on this date? Leave of any kind — annual,
   maternity, sick — means the generator leaves them alone entirely. */
const onLeave = (person, date) =>
  (person.leavePeriods || []).some((lp) => date >= lp.start && date <= lp.end);

/* The engine works in categories (morning, night, off). The rota stores the
   user's own codes. This picks the first code that counts as the category,
   which for the default list gives M, A, N, E and OFF — the plain ones,
   because the variants like M(R) and (N)OFF sit after them. If someone has
   reordered or deleted codes, their first choice is used instead, which is
   the sensible reading of "whichever code they use for mornings".       */
export function codeForCategory(codes, category) {
  const hit = (codes || []).find((c) => c.counts === category);
  return hit ? hit.code : null;
}

/* ── The duty ceiling for one person in one week ──
   Several separate settings can decide how many days somebody works, and
   the smallest one wins. The weekly duty maximum is the obvious one; a
   minimum number of off days is the same statement turned around — two off
   days a week means at most five duties. Anyone tied to a single shift is
   outside the weekly pattern altogether, so only the duty maximum applies
   to them.

   Used for budgeting, so it deliberately takes the tightest reading. A
   budget built on the most optimistic number is not a budget.           */
function dutyCeiling(cfg, staffMember) {
  const only = cfg.staffShifts?.[staffMember.id];
  const singleShift = only && only.length === 1;
  let cap = cfg.weeklyDuties?.max != null ? cfg.weeklyDuties.max : 7;
  if (!singleShift) {
    const offMin = cfg.weeklyPerStaff?.off;
    if (offMin != null) cap = Math.min(cap, 7 - offMin);
  }
  return Math.max(0, Math.min(7, cap));
}

/* ── Feasibility ──
   Checked before generating, because "it is impossible" is far more useful
   said upfront than discovered after a long run that produces a broken rota. */
export function checkFeasible(cfg) {
  const problems = [];
  /* Warnings explain something the manager will otherwise puzzle over —
     an off-day maximum the arithmetic cannot meet, a weekly minimum that
     blocks make impossible. They do not stop a rota being generated,
     because the result is still useful; they just stop it being a
     surprise afterwards. */
  const warnings = [];
  const dates = datesBetween(cfg.from, cfg.to);
  const usable = cfg.staff.filter((s) => !cfg.skipStaff?.includes(s.id));

  if (!usable.length) problems.push('No staff are available — everyone is skipped.');
  if (!dates.length) problems.push('The date range is empty.');

  // Every category in use needs a code to write into the rota.
  if (cfg.codes) {
    const needed = SHIFTS.filter((s) => (cfg.coverage?.[s]?.min || 0) > 0).concat('off');
    needed.forEach((cat) => {
      if (!codeForCategory(cfg.codes, cat)) {
        problems.push(
          `You have no duty code set to count as "${cat}". ` +
          `Add one in Settings before generating.`
        );
      }
    });
  }

  const dailyMin = SHIFTS.reduce((n, s) => n + (cfg.coverage?.[s]?.min || 0), 0);

  /* A rule that forces rest after a shift takes those people out of the
     following day. With two on nights and a rest day after, two of the
     team are unavailable every morning — so the ward needs enough people
     to cover the duties AND absorb that. This is the commonest reason a
     sensible-looking set of rules cannot produce a rota, and it is much
     kinder said now than discovered as three uncovered shifts. */
  (cfg.sequenceRules || []).forEach((r) => {
    if (r.type !== 'must' || r.then !== 'off' || !SHIFTS.includes(r.after)) return;
    const restingEachDay = cfg.coverage?.[r.after]?.min || 0;
    if (!restingEachDay) return;
    const needed = dailyMin + restingEachDay;
    if (needed > usable.length) {
      problems.push(
        `Every day needs ${dailyMin} people on duty, and "off after ${r.after}" puts another ` +
        `${restingEachDay} on a rest day — ${needed} people in all, but you have ${usable.length}. ` +
        `Add ${needed - usable.length} more staff, lower a shift minimum, or drop the ` +
        `"off after ${r.after}" rule and rely on "never morning after ${r.after}" instead.`
      );
    }
  });

  if (dailyMin > usable.length) {
    problems.push(
      `Each day needs ${dailyMin} people on duty, but only ${usable.length} staff are available. ` +
      `Either lower the minimums or add ${dailyMin - usable.length} more staff.`
    );
  }

  // Weekly caps have to leave room for the coverage the same settings
  // demand — unless the caps are soft, in which case they can be stretched
  // and are not a reason to refuse.
  if (!cfg.soft?.weeklyCaps) {
    const weeklyNeed = dailyMin * 7;
    const weeklyCapacity = usable.reduce((n, s) => {
      const caps = SHIFTS.map((sh) => cfg.weeklyPerStaff?.[sh]);
      const capped = caps.every((c) => c != null);
      return n + (capped ? caps.reduce((a, b) => a + b, 0) : 7);
    }, 0);
    if (weeklyCapacity < weeklyNeed) {
      problems.push(
        `Each week needs ${weeklyNeed} duties, but the per-staff weekly limits only allow ` +
        `${weeklyCapacity}. Raise the weekly limits, add more staff, or set the weekly limits ` +
        `to Soft so they can be stretched when a shift would otherwise go uncovered.`
      );
    }
  }

  /* ── The plainest arithmetic in the rota: duties needed against duties
     available ──
     Said with the actual numbers, because "there were not enough staff
     free" leaves a manager guessing whether to add a nurse, lower a
     minimum, or raise a limit. Two duties short and five duties short are
     different problems with different answers.                          */
  capacityByWeek(cfg, dates, usable).forEach((w) => {
    if (w.spare >= 0) return;
    warnings.push(
      `${w.days === 7 ? 'Week of' : 'Days from'} ${w.week}: covering ${dailyMin} ` +
      `${dailyMin === 1 ? 'duty' : 'duties'} a day for ${w.days} ${w.days === 1 ? 'day' : 'days'} ` +
      `needs ${w.dutiesNeeded} duties, but your ${usable.length} staff can work at most ` +
      `${w.dutiesAvailable} between them — ${-w.spare} short, so ${-w.spare} ` +
      `${-w.spare === 1 ? 'shift' : 'shifts'} will go uncovered. Raise the weekly duty maximum ` +
      `(or lower the off-day minimum) by one, lower a shift minimum, or add ` +
      `${Math.ceil(-w.spare / Math.max(1, w.days))} more staff.`
    );
  });

  /* ── Seniors: the same arithmetic, on a smaller pool ──
     The commonest way this rule disappoints is silently: it is switched on
     for every shift, there are three seniors, and the rota comes out with
     half the evenings unsupervised. All of that is knowable before
     generating, so it is said before generating.                        */
  const T = seniorTerms(cfg);
  const seniors = usable.filter((s) => isSenior(cfg, s));
  const seniorPerDay = SHIFTS.reduce((n, sh) => n + seniorsNeededOn(cfg, sh), 0);
  if (seniorPerDay > 0) {
    if (!seniors.length) {
      problems.push(
        `You have asked for ${T.a} ${T.one} on duty, but nobody is marked as ${T.a} ${T.one}. ` +
        `Tick "${T.One}" for the staff who can take charge of a shift.`
      );
    } else if (seniorPerDay > seniors.length) {
      problems.push(
        `Every day needs ${seniorPerDay} ${T.many} on duty at once, but only ` +
        `${seniors.length} ${seniors.length === 1 ? 'person is' : 'people are'} marked as ` +
        `${seniors.length === 1 ? `${T.a} ${T.one}` : T.many}. Mark ${seniorPerDay - seniors.length} ` +
        `more, or ask for ${T.a} ${T.one} on fewer shifts.`
      );
    }
    SHIFTS.forEach((sh) => {
      const need = seniorsNeededOn(cfg, sh);
      // With nobody ticked at all, the message above says it once. Repeating
      // it per shift, and pointing at the "Only these shifts" settings,
      // sends the manager looking in the wrong place.
      if (!need || !seniors.length) return;
      const eligible = seniors.filter((s) => {
        const only = cfg.staffShifts?.[s.id];
        return !only || !only.length || only.includes(sh);
      });
      if (eligible.length < need) {
        problems.push(
          `${sh}: needs ${need} ${need === 1 ? T.one : T.many}, but only ${eligible.length} ` +
          `${eligible.length === 1 ? `${T.one} is` : `${T.many} are`} allowed to do ${sh} duties. ` +
          `Check the "Only these shifts" settings, or mark another ${T.one}.`
        );
      }
      const cover = cfg.coverage?.[sh]?.max;
      if (cover != null && need > cover) {
        problems.push(
          `${sh}: needs ${need} ${need === 1 ? T.one : T.many} but never runs more than ` +
          `${cover} ${cover === 1 ? 'person' : 'people'}. Raise the ${sh} maximum, or lower ` +
          `the ${T.one} requirement.`
        );
      }
    });
    // And the weekly version: enough seniors on the ward is not the same as
    // enough senior DUTIES to go round, once their own days off are counted.
    const per = cfg.weeklyDuties?.max
      ?? (cfg.weeklyPerStaff?.off != null ? 7 - cfg.weeklyPerStaff.off : 7);
    capacityByWeek(cfg, dates, usable).forEach((w) => {
      if (!seniors.length) return;
      if (w.seniorSpare < 0) {
        warnings.push(
          `${T.Many}: ${w.days === 7 ? 'the week of' : 'the days from'} ${w.week} needs ` +
          `${w.seniorDutiesNeeded} ${T.one} duties (${w.seniorDutiesPerDay} a day), but your ` +
          `${seniors.length} ${seniors.length === 1 ? T.one : T.many} can work at most ` +
          `${w.seniorDutiesAvailable} between them — ${-w.seniorSpare} short. At ${per} duties ` +
          `each you need ${Math.ceil(w.seniorDutiesNeeded / Math.max(1, per))} ${T.many} for this. ` +
          `Mark more staff, or ask for ${T.a} ${T.one} on fewer shifts.`
        );
      } else if (w.seniorDutiesNeeded > 0 && w.seniorSpare <= 2) {
        /* Possible, but only just. Rest days after nights fall where the
           rules put them, not where the arithmetic would like them, so a
           week with one or two senior duties to spare will usually work and
           occasionally leave one shift without a senior. Better to say so
           now than to have it look like a fault. */
        warnings.push(
          `${T.Many}: ${w.seniorDutiesNeeded} ${T.one} duties are needed this week and your ` +
          `${seniors.length} ${T.many} can work ${w.seniorDutiesAvailable} — only ` +
          `${w.seniorSpare} to spare. That usually works, but a rest day falling awkwardly ` +
          `can still leave one shift without ${T.a} ${T.one} for you to fix by hand. One more ` +
          `${T.one} would make it comfortable.`
        );
      }
    });
  }

  /* Off days are decided by arithmetic, not preference: the duties have to
     be done by somebody. Telling the manager the number before they press
     Generate is far kinder than reporting a stretched limit afterwards. */
  if (usable.length && cfg.weeklyDuties?.min != null) {
    const dailyMaxAll = SHIFTS.reduce((n, sh) => {
      const c = cfg.coverage?.[sh];
      return n + (c?.max != null ? c.max : (c?.min || 0));
    }, 0);
    const most = (dailyMaxAll * 7) / usable.length;
    if (most < cfg.weeklyDuties.min - 0.05) {
      warnings.push(
        `Duties per week: even with every shift at its fullest there are only about ` +
        `${most.toFixed(1)} duties each for ${usable.length} staff, below your minimum of ` +
        `${cfg.weeklyDuties.min}. Raise a shift maximum, or roster fewer staff.`
      );
    }
  }
  if (usable.length && dailyMin > 0) {
    /* Measured against the MAXIMUM staffing, not the minimum. The generator
       fills above the minimum when it needs to keep people off the off-day
       pile, so judging by minimums alone predicts a problem that never
       happens. Only when even a full ward leaves too many people idle is
       there something worth saying. */
    const dailyMax = SHIFTS.reduce((n, sh) => {
      const c = cfg.coverage?.[sh];
      return n + (c?.max != null ? c.max : (c?.min || 0));
    }, 0);
    const workDaysEach = Math.min(7, (dailyMax * 7) / usable.length);
    const offEach = 7 - workDaysEach;
    const offMax = cfg.weeklyPerStaff?.offMax;
    const offMin = cfg.weeklyPerStaff?.off;
    if (offMax != null && offEach > offMax + 0.05) {
      void dailyMin;
      warnings.push(
        `Off days: ${usable.length} staff covering ${dailyMin} duties a day works out at about ` +
        `${offEach.toFixed(1)} off days each per week even with every shift at its fullest, ` +
        `but your maximum is ${offMax}. Raise the maximum to ${Math.ceil(offEach)}, raise a ` +
        `shift maximum so more people can work, or roster fewer staff.`
      );
    }
    /* The two checks look at opposite ends of the range. Too FEW off days
       happens when the ward is at its busiest, so that is measured against
       the minimum staffing — the fewest duties that must be covered. */
    const offAtQuietest = 7 - Math.min(7, (dailyMin * 7) / usable.length);
    if (offMin != null && offAtQuietest < offMin - 0.05) {
      warnings.push(
        `Off days: ${usable.length} staff covering ${dailyMin} duties a day leaves only about ` +
        `${offAtQuietest.toFixed(1)} off days each per week, below your minimum of ${offMin}. ` +
        `Lower the minimum, lower a shift minimum, or add staff.`
      );
    }
  }

  /* A shift worked in blocks can only reach so many people. Two nights
     together means seven nights a week reach three or four people, not
     everybody — worth saying before someone wonders why. */
  SHIFTS.forEach((sh) => {
    const perDay = cfg.coverage?.[sh]?.min || 0;
    if (perDay > 0 && usable.length) {
      const total = perDay * 7;
      const block = cfg.maxBlock?.[sh] ?? (sh === 'night' ? 2 : 4);
      /* How many people a shift can reach in a week. Blocks are preferred
         rather than forced, so an ordinary shift reaches as many people as
         there are duties. Nights are the exception: they are worked in
         pairs, so seven nights reach four people, not seven. Only say
         something when the arithmetic genuinely leaves someone out — a
         warning that turns out to be wrong is worse than none.          */
      const reach = block <= 2 ? Math.ceil(total / 2) : total;
      if (reach < usable.length) {
        warnings.push(
          `${sh}: ${perDay} needed a day is ${total} ${sh} duties a week` +
          (block <= 2 ? `, and worked ${block} at a time that reaches about ${reach} people` : '') +
          `, so ${usable.length - reach} of your ${usable.length} staff will get no ${sh} duty ` +
          `this week. Raise the ${sh} minimum per day to spread it wider` +
          (block <= 2 ? `, or set "${sh} in a row" to 1.` : '.')
        );
      }
    }
  });

  SHIFTS.forEach((sh) => {
    const c = cfg.coverage?.[sh];
    if (c && c.max != null && c.min != null && c.max < c.min) {
      problems.push(`${sh}: the maximum (${c.max}) is below the minimum (${c.min}).`);
    }
    /* If people are restricted to particular shifts, there has to be
       enough of them left who are allowed to do this one. */
    const min = c?.min || 0;
    if (min > 0 && cfg.staffShifts) {
      const eligible = usable.filter((s) => {
        const only = cfg.staffShifts[s.id];
        return !only || !only.length || only.includes(sh);
      });
      if (eligible.length < min) {
        problems.push(
          `${sh}: needs ${min} staff, but only ${eligible.length} ${eligible.length === 1 ? 'is' : 'are'} ` +
          `allowed to do ${sh} duties. Check the "Only these shifts" settings.`
        );
      }
    }
  });

  /* Approved requests are hard rules, so too many on one date makes that
     day impossible. Better to name the date now than to generate a rota
     with a hole in it. */
  const byDate = {};
  (cfg.requests || []).forEach((r) => {
    byDate[r.date] = byDate[r.date] || [];
    byDate[r.date].push(r);
  });
  Object.entries(byDate).forEach(([date, reqs]) => {
    if (date < iso(cfg.from) || date > iso(cfg.to)) return;
    const free = usable.filter((s) =>
      !onLeave(s, date) && !reqs.some((r) => r.staffId === s.id)
    ).length;
    const coveredByRequests = SHIFTS.reduce(
      (n, sh) => n + reqs.filter((r) => r.category === sh).length, 0
    );
    const stillNeeded = Math.max(0, dailyMin - coveredByRequests);
    if (stillNeeded > free) {
      problems.push(
        `${date}: ${reqs.length} approved request${reqs.length === 1 ? '' : 's'} leave only ` +
        `${free} staff free, but ${stillNeeded} more are needed to cover the day. ` +
        `Un-approve a request for that date, or lower the minimums.`
      );
    }
  });

  ruleConflicts(cfg.sequenceRules).forEach((c) => problems.push(c.message));
  return { ok: problems.length === 0, problems, warnings };
}

/* ── Duties needed against duties available, week by week ──
   Weekly limits reset every Sunday, so the budget is a weekly one. A
   monthly range is simply several of these side by side.

   "Available" is the tightest honest reading: for each person, the smaller
   of the days they are actually here and the duties their limits allow.
   Somebody on leave from Wednesday contributes three days, not seven.    */
export function capacityByWeek(cfg, dates, staff, keep = {}) {
  const weekOf = (d) => startOfWeek(d, cfg.weekStartsOn ?? 0);
  const perDay = SHIFTS.reduce((n, sh) => n + (cfg.coverage?.[sh]?.min || 0), 0);
  const seniorPerDay = SHIFTS.reduce((n, sh) => n + seniorsNeededOn(cfg, sh), 0);
  const seniors = staff.filter((s) => isSenior(cfg, s));
  const weeks = [...new Set(dates.map(weekOf))];
  return weeks.map((week) => {
    const ds = dates.filter((d) => weekOf(d) === week);
    const room = (list) => list.reduce((n, s) => {
      const daysHere = ds.filter((d) => !onLeave(s, d) && !keep[`${s.id}|${d}`]).length;
      return n + Math.min(daysHere, dutyCeiling(cfg, s));
    }, 0);
    const cap = room(staff);
    const seniorCap = room(seniors);
    const dutiesNeeded = perDay * ds.length;
    const seniorDutiesNeeded = seniorPerDay * ds.length;
    return {
      week, days: ds.length, dutiesPerDay: perDay,
      dutiesNeeded, dutiesAvailable: cap, spare: cap - dutiesNeeded,
      seniorCount: seniors.length,
      seniorDutiesPerDay: seniorPerDay,
      seniorDutiesNeeded,
      seniorDutiesAvailable: seniorCap,
      seniorSpare: seniorCap - seniorDutiesNeeded,
    };
  });
}

/* ── Sequence rules ──
   "Never give Morning after Night" and friends. Rules look at yesterday's
   category to decide what is allowed today. A "must" rule forces today's
   category outright.                                                      */
const live = (rules) => (rules || []).filter((r) => r.enabled !== false);

const forbiddenToday = (rules, yesterday) =>
  new Set(live(rules)
    .filter((r) => r.type === 'never' && r.after === yesterday)
    .map((r) => r.then));

const forcedToday = (rules, yesterday) =>
  live(rules).find((r) => r.type === 'must' && r.after === yesterday)?.then || null;

/* A preferred transition is neither required nor forbidden — the roster
   leans towards it and gives it up without complaint. "After a night,
   prefer another night" and "after a night, prefer off" can both be set:
   they cannot both happen, and that is the point of a preference. */
const preferredToday = (rules, yesterday) =>
  new Set(live(rules)
    .filter((r) => r.type === 'prefer' && r.after === yesterday)
    .map((r) => r.then));

/* Two ALWAYS rules from the same shift cannot both hold. Reported so the
   manager can demote one to a preference rather than wondering why one is
   quietly ignored. */
export function ruleConflicts(rules) {
  const byAfter = {};
  live(rules).filter((r) => r.type === 'must').forEach((r) => {
    byAfter[r.after] = byAfter[r.after] || [];
    byAfter[r.after].push(r.then);
  });
  return Object.entries(byAfter)
    .filter(([, thens]) => new Set(thens).size > 1)
    .map(([after, thens]) => ({
      after, thens: [...new Set(thens)],
      message: `Two "Always give" rules both apply after ${after}: ${[...new Set(thens)].join(' and ')}. ` +
               `Only one can happen. Change one to "Prefer" or remove it.`,
    }));
}

/* An explicit "can give X after Y" cancels a "never" for that same pair, so
   a broad restriction can carry a deliberate exception. */
const allowedOverride = (rules, yesterday) =>
  new Set(live(rules)
    .filter((r) => r.type === 'can' && r.after === yesterday)
    .map((r) => r.then));

/* ── What a finished rota costs ──
   Everything above builds a rota. This measures one. The difference
   matters: a measure that works on a finished rota can judge ANY rota, not
   just one the builder happened to produce — which is what makes it
   possible to change a rota and find out whether the change helped.

   The weights are the ward's priorities in numbers. An uncovered shift is
   worth a thousand; a second off day in a row is worth twelve. Nothing here
   is a rule that cannot be broken, because a rota that breaks one rule
   badly is still better than no rota — but the arithmetic makes sure the
   cheap things give way long before the expensive ones.                  */
const COST = {
  uncovered: 1000,   // a shift below its minimum: the thing we are here to prevent
  restriction: 2000, // somebody on a shift they are not trained for: never acceptable
  absMax: 500,       // worked past the absolute limit on days in a row
  senior: 400,       // a shift with nobody in charge of it
  overMax: 300,      // more people on a shift than the ward runs
  dutyMax: 300,      // past the weekly duty maximum: an overtime claim
  sequence: 200,     // a "never give X after Y" rule broken
  consecutive: 80,   // past the usual limit on days in a row
  mustRule: 60,      // an "always give X after Y" rule not honoured
  block: 40,         // a run of the same duty longer than the ward likes
  weeklyCap: 25,     // past a weekly per-shift limit
  offMax: 25,        // more off days than allowed
  offMin: 25,        // fewer off days than promised
  dutyMin: 25,       // fewer duties than the person's week should hold
  doubleOff: 12,     // two off days together
  fair: 3,           // per point of spread on a fairness measure
};

/* ── Turning the manager's Hard and Soft switches into prices ──
   The weights above are defaults. What is actually hard on this ward is the
   manager's decision, and the measurement has to agree with the builder
   about it — otherwise the second stage spends its time undoing what the
   first stage was careful to respect.

   A rule marked Hard is priced above an uncovered shift, which means the
   arithmetic will never trade it away: a five-person ward covering
   twenty-eight duties is short, and no amount of rearranging changes that.
   Saying so is the honest answer. Quietly working somebody a sixth day is
   not — the shift looks covered and the overtime turns up later.        */
function costWeights(cfg) {
  const R = cfg.ruleStates || {};
  const legacy = cfg.soft || {};
  const stateOf = (key) => {
    if (R[key]?.state) return R[key].state;
    if (key === 'workPattern' || key.startsWith('weeklyCaps')) {
      return legacy.weeklyCaps ? 'soft' : 'hard';
    }
    return legacy[key] ? 'soft' : 'hard';
  };
  const HARD = 5000;              // above an uncovered shift: never traded away
  const w = { ...COST };

  // These three are hard in the builder whatever the settings say.
  w.dutyMax = HARD;
  w.restriction = HARD;
  w.absMax = HARD;

  const seq = stateOf('sequence');
  if (seq === 'hard') { w.sequence = HARD; w.mustRule = 400; }
  else if (seq === 'disabled') { w.sequence = 0; w.mustRule = 0; }

  const pattern = stateOf('workPattern');
  if (pattern === 'hard') { w.block = HARD; w.consecutive = HARD; }
  else if (pattern === 'disabled') { w.block = 0; w.consecutive = 0; w.doubleOff = 0; }

  const offMin = stateOf('offMin');
  if (offMin === 'hard') w.offMin = HARD;
  else if (offMin === 'disabled') w.offMin = 0;

  const offMax = stateOf('offMax');
  if (offMax === 'hard') w.offMax = HARD;
  else if (offMax === 'disabled') w.offMax = 0;

  w.caps = {};
  SHIFTS.forEach((sh) => {
    const st = stateOf(`weeklyCaps:${sh}`);
    w.caps[sh] = st === 'hard' ? HARD : (st === 'disabled' ? 0 : w.weeklyCap);
  });
  return w;
}

/* Everything that does not change while a rota is being rearranged, worked
   out once. Local search runs this measurement tens of thousands of times,
   so anything left inside the loop is paid for tens of thousands of times —
   date arithmetic and rule Sets especially. */
export function rosterContext(cfg, dates, staff) {
  const catOf = {};
  (cfg.codes || []).forEach((c) => { catOf[c.code] = c.counts; });

  const keep = {};
  if (cfg.existingCells && cfg.codes) {
    for (const [key, code] of Object.entries(cfg.existingCells)) {
      if (PRESERVE.includes(catOf[code])) keep[key] = code;
    }
  }
  const histCats = {};
  if (cfg.history?.cells && cfg.codes) {
    for (const [key, code] of Object.entries(cfg.history.cells)) {
      if (catOf[code]) histCats[key] = catOf[code];
    }
  }
  const requested = {};
  (cfg.requests || []).forEach((r) => { requested[`${r.staffId}|${r.date}`] = r.category; });

  // Date arithmetic, done once and looked up thereafter.
  const prevOf = {}, weekOf = {}, fridayOf = {};
  dates.forEach((d, i) => {
    prevOf[d] = i > 0 ? dates[i - 1] : shiftDate(d, -1);
    weekOf[d] = startOfWeek(d, cfg.weekStartsOn ?? 0);
    fridayOf[d] = isFriday(d);
  });
  const weekDays = {};
  dates.forEach((d) => { weekDays[weekOf[d]] = (weekDays[weekOf[d]] || 0) + 1; });
  const nonOff = new Set(cfg.nonOfficialDates || []);

  // Sequence rules, resolved per category rather than re-derived per cell.
  const rules = cfg.sequenceRules || [];
  const banned = {}, allowed = {}, forced = {};
  [...SHIFTS, OFF_CAT].forEach((cat) => {
    banned[cat] = forbiddenToday(rules, cat);
    allowed[cat] = allowedOverride(rules, cat);
    forced[cat] = forcedToday(rules, cat);
  });

  const cov = {}, seniorNeed = {}, blockMax = {};
  SHIFTS.forEach((sh) => {
    cov[sh] = { min: cfg.coverage?.[sh]?.min || 0, max: cfg.coverage?.[sh]?.max };
    seniorNeed[sh] = seniorsNeededOn(cfg, sh);
    blockMax[sh] = cfg.maxBlock?.[sh] ?? (sh === 'night' ? 2 : 4);
  });

  /* Where each person stood the day before the range began — how long they
     had been on the same duty, and how many days they had worked in a row.
     Read from history once, because history does not change. */
  const seed = {};
  staff.forEach((s) => {
    const id = String(s.id);
    let runCat = null, runLen = 0, workRun = 0, broken = false;
    let d = prevOf[dates[0]];
    for (let back = 0; back < 14; back++) {
      const c = histCats[`${id}|${d}`];
      if (!c) break;
      if (back === 0) { runCat = c; runLen = 1; }
      else if (c === runCat && !broken) runLen += 1;
      else broken = true;
      if (c !== OFF_CAT) { if (workRun === back) workRun = back + 1; }
      else if (workRun === back) break;
      d = shiftDate(d, -1);
    }
    seed[id] = { runCat, runLen, workRun };
  });

  return {
    W: costWeights(cfg),
    staff, dates, keep, histCats, requested, prevOf, weekOf, weekDays, fridayOf,
    nonOff, banned, allowed, forced, cov, seniorNeed, blockMax, seed,
    seniorIds: new Set(staff.filter((s) => isSenior(cfg, s)).map((s) => String(s.id))),
    maxDaysOn: cfg.maxConsecutiveDays ?? 4,
    absMax: cfg.absoluteMaxDaysOn ?? 6,
    ids: staff.map((s) => String(s.id)),
  };
}

/* ── Measure a rota ──
   Walks it once and reports everything wrong with it, priced. Pure: give it
   the same cells twice and it says the same thing twice.

   This replaces the old habit of recording a note whenever the BUILDER bent
   a rule. That was misleading, because a later repair often un-bent it and
   the note stayed. What is reported now is what the finished rota actually
   does.                                                                  */
export function auditRoster(cfg, ctx, cells) {
  const {
    staff, dates, weekOf, weekDays, fridayOf, nonOff,
    banned, allowed, forced, cov, seniorNeed, blockMax, seed, seniorIds,
    maxDaysOn, absMax, W,
  } = ctx;

  const shortfalls = [], seniorGaps = [], issues = [];
  let cost = 0;
  const flag = (weight, entry) => { cost += weight; issues.push(entry); };

  // ── Coverage, and who is in charge of it
  for (const date of dates) {
    const on = { morning: 0, afternoon: 0, evening: 0, night: 0 };
    const led = { morning: 0, afternoon: 0, evening: 0, night: 0 };
    for (const s of staff) {
      const c = cells[`${s.id}|${date}`];
      if (c == null || on[c] === undefined) continue;
      on[c] += 1;
      if (seniorIds.has(String(s.id))) led[c] += 1;
    }
    for (const sh of SHIFTS) {
      const { min, max } = cov[sh];
      if (on[sh] < min) {
        const n = min - on[sh];
        shortfalls.push({ date, shift: sh, needed: n });
        cost += W.uncovered * n;
      } else if (max != null && on[sh] > max) {
        flag(W.overMax * (on[sh] - max), { date, shift: sh, kind: 'overMax' });
      }
      const need = seniorNeed[sh];
      if (need > 0 && led[sh] < need) {
        const n = need - led[sh];
        seniorGaps.push({ date, shift: sh, needed: n });
        cost += W.senior * n;
      }
    }
  }

  // ── Each person's week
  const totals = {};
  for (const s of staff) {
    const id = String(s.id);
    const only = cfg.staffShifts?.[id];
    const restricted = only && only.length;
    const single = only && only.length === 1;
    const t = totals[id] = {
      morning: 0, afternoon: 0, evening: 0, night: 0, off: 0, duties: 0,
      fridayOff: 0, fridayAfternoon: 0, nonOfficial: 0, daysAvailable: 0,
    };

    let runCat = seed[id].runCat, runLen = seed[id].runLen, workRun = seed[id].workRun;
    const weeks = {};

    for (const date of dates) {
      const cat = cells[`${id}|${date}`];
      // Leave and preserved cells belong to the manager, not the engine.
      // They also break the chain: nobody is "on a run" through sick leave.
      if (cat == null) { runCat = null; runLen = 0; workRun = 0; continue; }

      const yesterday = runCat;
      if (yesterday) {
        if (banned[yesterday]?.has(cat) && !allowed[yesterday]?.has(cat)) {
          flag(W.sequence, { date, shift: cat, kind: 'sequence' });
        }
        const must = forced[yesterday];
        if (must && cat !== must) {
          /* "Off after a night" means after the RUN of nights. Someone
             part-way through a pair is not breaking the rule by finishing
             it — that is what the rule is waiting for. */
          const finishing = must === OFF_CAT && cat === yesterday
            && yesterday !== OFF_CAT && runLen < (blockMax[yesterday] ?? 2);
          if (!finishing) flag(W.mustRule, { date, shift: cat, kind: 'mustRule' });
        }
      }
      if (restricted && cat !== OFF_CAT && !only.includes(cat)) {
        flag(W.restriction, { date, shift: cat, kind: 'restriction' });
      }

      if (cat === runCat) runLen += 1; else { runCat = cat; runLen = 1; }
      if (cat === OFF_CAT) {
        workRun = 0;
        if (runLen > 1 && cfg.singleOffDays !== false) {
          flag(W.doubleOff, { date, shift: OFF_CAT, kind: 'doubleOff' });
        }
      } else {
        workRun += 1;
        if (runLen > blockMax[cat]) flag(W.block, { date, shift: cat, kind: 'block' });
        if (workRun > absMax) flag(W.absMax, { date, shift: cat, kind: 'absMax' });
        else if (workRun > maxDaysOn) flag(W.consecutive, { date, shift: cat, kind: 'consecutive' });
      }

      const wk = weekOf[date];
      const w = weeks[wk] || (weeks[wk] = {
        days: 0, duties: 0, off: 0, rest: 0,
        morning: 0, afternoon: 0, evening: 0, night: 0,
      });
      w.days += 1;
      if (cat === OFF_CAT) {
        w.off += 1;
        // A rest day after a night is recognisable, and the ward decides
        // whether it comes out of the week's off allowance.
        if (yesterday === 'night') w.rest += 1;
      } else {
        w.duties += 1;
        w[cat] += 1;
      }

      t[cat] += 1;
      t.daysAvailable += 1;
      if (cat !== OFF_CAT) t.duties += 1;
      if (fridayOf[date]) {
        if (cat === OFF_CAT) t.fridayOff += 1;
        if (cat === 'afternoon') t.fridayAfternoon += 1;
      }
      if (cat !== OFF_CAT && nonOff.has(date)) t.nonOfficial += 1;
    }

    for (const [wk, w] of Object.entries(weeks)) {
      // Only a whole week present can be judged against a weekly promise.
      const whole = weekDays[wk] === 7 && w.days === 7;
      const offs = cfg.restOutsideOffAllowance ? w.off - w.rest : w.off;

      const dMax = cfg.weeklyDuties?.max;
      if (dMax != null && w.duties > dMax) {
        flag(W.dutyMax * (w.duties - dMax), { date: wk, staffId: id, shift: OFF_CAT, kind: 'dutyMax' });
      }
      if (!whole) continue;
      const dMin = cfg.weeklyDuties?.min;
      if (dMin != null && w.duties < dMin) {
        flag(W.dutyMin * (dMin - w.duties), { date: wk, staffId: id, shift: OFF_CAT, kind: 'dutyMin' });
      }
      const offMax = cfg.weeklyPerStaff?.offMax;
      if (offMax != null && offs > offMax) {
        flag(W.offMax * (offs - offMax), { date: wk, staffId: id, shift: OFF_CAT, kind: 'offMax' });
      }
      /* The weekly table describes a rotation. Somebody tied to one shift
         has nothing to rotate, so none of it applies to them. */
      if (single) continue;
      const offMin = cfg.weeklyPerStaff?.off;
      if (offMin != null && offs < offMin) {
        flag(W.offMin * (offMin - offs), { date: wk, staffId: id, shift: OFF_CAT, kind: 'offMin' });
      }
      for (const sh of SHIFTS) {
        const cap = cfg.weeklyPerStaff?.[sh];
        if (cap != null && w[sh] > cap) {
          flag(W.caps[sh] * (w[sh] - cap), { date: wk, staffId: id, shift: sh, kind: 'weeklyCap' });
        }
      }
    }
  }

  /* Fairness last, and cheaply. It decides between rotas that are otherwise
     equally correct, and should never outweigh a shift going uncovered. */
  const present = staff.filter((s) => totals[String(s.id)].daysAvailable > 0);
  if (present.length > 1) {
    for (const key of ['duties', 'night', 'off', 'fridayOff', 'nonOfficial']) {
      let lo = Infinity, hi = -Infinity;
      for (const s of present) {
        const v = totals[String(s.id)][key];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      cost += W.fair * (hi - lo);
    }
  }

  return { cost, shortfalls, seniorGaps, issues, totals };
}

/* ── Polish ──
   The builder writes a rota one day at a time and never looks back, which
   is why it can paint itself into a corner: a choice made on Tuesday is
   what leaves Saturday uncoverable, and by Saturday it is too late.

   This does what a manager does with a printed rota and a pencil. Change
   something. Is it better? Keep it. Worse? Put it back — although not
   always, because a rota that is one step worse is sometimes the only way
   to reach one that is much better, and always refusing to go downhill is
   how you get stuck on a small hill.

   Three kinds of change, which between them can reach any rota from any
   other: give somebody a different duty; swap two people's duties on a day;
   swap one person's duties between two days. Approved requests, leave and
   preserved cells are never touched.                                     */
function polish(cfg, ctx, startCells, seedNumber) {
  const { staff, dates, keep, requested } = ctx;
  /* Counted in steps, not seconds. A budget in seconds means a fast laptop
     and a slow phone produce different rotas from the same settings, and a
     rota you cannot reproduce is a rota you cannot investigate when
     somebody says it got their week wrong.

     The number scales with the size of the problem: a week of six people is
     a few hundred cells and settles quickly, a month of twenty-one is a few
     thousand and needs longer. The wall-clock limit below is only a
     safety net for very slow devices.                                    */
  const cells = staff.length * dates.length;
  /* Measuring a rota costs time in proportion to its size, so a fixed
     number of steps would mean a week finishes instantly and a month takes
     a minute. This holds the WAIT roughly steady instead — about a second
     for a week, a few for a month — while the step count itself stays
     fixed, so the answer does not depend on how fast the machine is. */
  const steps = cfg.polishSteps
    ?? Math.max(10000, Math.min(90000, Math.round(2400000 / cells) + 12000));
  const capMs = cfg.polishMaxMs ?? 15000;
  if (steps <= 0) return startCells;

  // Which cells are ours to change, and what may go in them.
  const movable = [];
  const choices = {};
  for (const s of staff) {
    const id = String(s.id);
    const only = cfg.staffShifts?.[id];
    const shifts = (only && only.length)
      ? SHIFTS.filter((sh) => only.includes(sh))
      : SHIFTS.slice();
    // A shift the ward never runs is not an option, however free somebody is.
    choices[id] = [...shifts.filter((sh) => ctx.cov[sh].max !== 0), OFF_CAT];
    for (const date of dates) {
      const key = `${id}|${date}`;
      if (startCells[key] == null) continue;   // on leave: not a cell we own
      if (keep[key] || requested[key]) continue;
      movable.push({ id, date, key });
    }
  }
  if (movable.length < 2) return startCells;
  const keys = movable.map((m) => m.key);

  // Cells grouped by day and by person, so a swap can find a partner
  // without searching the whole rota.
  const byDate = {}, byStaff = {};
  movable.forEach((m) => {
    (byDate[m.date] = byDate[m.date] || []).push(m);
    (byStaff[m.id] = byStaff[m.id] || []).push(m);
  });
  const dateKeys = Object.keys(byDate).filter((d) => byDate[d].length > 1);
  const staffKeys = Object.keys(byStaff).filter((i) => byStaff[i].length > 1);

  const random = rng(seedNumber * 104729 + 7);
  const pick = (arr) => arr[Math.floor(random() * arr.length)];

  /* Never reassigned, only written into — so the small helper below is not
     reaching for a variable that moves under it. */
  const current = { ...startCells };
  let currentCost = auditRoster(cfg, ctx, current).cost;
  let best = { ...current };
  let bestCost = currentCost;

  /* Warm to begin with, cold by the end: early on it will accept a step
     backwards to get out of a dead end, and by the end it only improves. */
  const startHeat = 30, endHeat = 0.4;
  const began = Date.now();
  let limit = steps;
  let heat = startHeat;
  let since = 0;

  for (let step = 0; step < limit; step++) {
    if ((step & 255) === 0) {
      if (Date.now() - began > capMs) break;      // slow device: stop early
      const done = step / steps;
      heat = startHeat * Math.pow(endHeat / startHeat, done);
      // Wandered a long way without improving: go back to the best rota
      // found so far and try a different direction from there.
      if (since > 4000) {
        for (const k of keys) current[k] = best[k];
        currentCost = bestCost;
        since = 0;
      }
    }

    const undo = [];
    const set = (key, value) => { undo.push([key, current[key]]); current[key] = value; };
    const roll = random();

    if (roll < 0.45 || !dateKeys.length || !staffKeys.length) {
      // One person, one day, a different duty.
      const m = pick(movable);
      const want = pick(choices[m.id]);
      if (want === current[m.key]) continue;
      set(m.key, want);
    } else if (roll < 0.75) {
      // Two people trade duties on the same day. Keeps the day's headcount
      // identical, so it can fix "the wrong person is on nights" without
      // disturbing anything else.
      const date = pick(dateKeys);
      const pool = byDate[date];
      const a = pick(pool), b = pick(pool);
      if (a.id === b.id || current[a.key] === current[b.key]) continue;
      const ca = current[a.key], cb = current[b.key];
      if (!choices[a.id].includes(cb) || !choices[b.id].includes(ca)) continue;
      set(a.key, cb); set(b.key, ca);
    } else {
      // One person trades their own duties between two days — how a rest
      // day gets moved to where it does no harm.
      const id = pick(staffKeys);
      const pool = byStaff[id];
      const a = pick(pool), b = pick(pool);
      if (a.date === b.date || current[a.key] === current[b.key]) continue;
      const ca = current[a.key], cb = current[b.key];
      set(a.key, cb); set(b.key, ca);
    }

    const check = auditRoster(cfg, ctx, current);
    const cost = check.cost;
    const worse = cost - currentCost;
    if (worse <= 0 || random() < Math.exp(-worse / heat)) {
      currentCost = cost;
      if (cost < bestCost) {
        bestCost = cost;
        best = { ...current };
        since = 0;
        /* Every shift covered, everybody in charge who should be, and not
           one setting broken. Only the fairness spread could still improve,
           which is worth a moment but not another two seconds — a manager
           waiting on a spinner notices that far more than one duty of
           imbalance. */
        const clean = !check.shortfalls.length && !check.seniorGaps.length
          && !check.issues.length;
        if (clean) limit = Math.min(limit, step + Math.round(steps * 0.05));
      } else since += 1;
    } else {
      for (let i = undo.length - 1; i >= 0; i--) current[undo[i][0]] = undo[i][1];
      since += 1;
    }
  }

  return best;
}

/* Which off days are the rest after a night, so they can carry the (N)OFF
   code. Worked out from the finished rota rather than remembered from the
   building of it — after everything has been rearranged, what matters is
   where the nights ended up, not where they were once going to be. */
function nightRestDays(cfg, ctx, cells) {
  const rules = cfg.sequenceRules || [];
  if (forcedToday(rules, 'night') !== OFF_CAT) return [];
  const out = [];
  for (const s of ctx.staff) {
    const id = String(s.id);
    for (const date of ctx.dates) {
      if (cells[`${id}|${date}`] !== OFF_CAT) continue;
      const y = ctx.prevOf[date];
      const was = cells[`${id}|${y}`] ?? ctx.histCats[`${id}|${y}`];
      if (was === 'night') out.push(`${id}|${date}`);
    }
  }
  return out;
}

/* Turning the audit into something a manager can read. One line per thing
   the rota actually does that the settings did not ask for. */
const ISSUE_NAMES = {
  overMax: 'more people than the shift runs',
  sequence: 'duty rule',
  mustRule: 'duty rule',
  restriction: 'a shift they are not set up for',
  block: 'working pattern',
  consecutive: 'days in a row',
  absMax: 'days in a row',
  doubleOff: 'two off days together',
  dutyMax: 'weekly duty maximum',
  dutyMin: 'weekly duty minimum',
  offMax: 'maximum off days',
  offMin: 'minimum off days',
  weeklyCap: 'weekly limit',
};
function issuesToRelaxations(issues) {
  return issues.map((i) => ({
    date: i.date,
    shift: i.shift,
    staffId: i.staffId,
    rule: i.kind === 'weeklyCap' ? `weekly ${i.shift} limit` : (ISSUE_NAMES[i.kind] || i.kind),
  }));
}

/* ── Generate ──
   Builds the rota several times and keeps the best. Attempt one is the
   plain deterministic build; later attempts vary only the order in which
   equally good candidates are chosen, so a run of bad luck in the middle
   of the week gets a second chance instead of becoming the answer.

   A week is small, so this costs milliseconds. A long range gets fewer
   attempts, because the work grows with the number of days.             */
export function generateRoster(cfg) {
  const feasible = checkFeasible(cfg);
  if (!feasible.ok) return { ok: false, problems: feasible.problems, cells: {}, report: null };

  const dates = datesBetween(cfg.from, cfg.to);
  const staff = cfg.staff.filter((s) => !cfg.skipStaff?.includes(s.id));
  const ctx = rosterContext(cfg, dates, staff);
  const weeks = Math.max(1, Math.ceil(dates.length / 7));
  const attempts = Math.max(1, cfg.attempts ?? Math.max(3, Math.round(24 / weeks)));

  /* Stage one: build it the quick way, several times over, and keep the
     best. This is cheap and gets most of the way there. */
  let cells = null;
  let cost = Infinity;
  let tried = 0;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const candidate = buildOnce(cfg, attempt, ctx);
    const score = auditRoster(cfg, ctx, candidate.cells).cost;
    tried += 1;
    if (score < cost) { cells = candidate.cells; cost = score; }
    if (score === 0) break;
  }

  /* Stage two: improve it by rearrangement. The builder cannot undo a
     choice it made on Tuesday; this can, and that is where the last
     uncovered shifts and the last hand-fixes come from. */
  const before = auditRoster(cfg, ctx, cells);
  cells = polish(cfg, ctx, cells, tried);
  const audit = auditRoster(cfg, ctx, cells);

  const budget = capacityByWeek(cfg, dates, staff, ctx.keep);
  return {
    ok: true,
    problems: [],
    cells,
    nightRest: nightRestDays(cfg, ctx, cells),
    attempts: tried,
    /* Kept so the difference the second stage made is visible rather than
       taken on trust. */
    improvement: {
      uncoveredBefore: before.shortfalls.reduce((n, x) => n + x.needed, 0),
      uncoveredAfter: audit.shortfalls.reduce((n, x) => n + x.needed, 0),
      issuesBefore: before.issues.length,
      issuesAfter: audit.issues.length,
      costBefore: before.cost,
      costAfter: audit.cost,
    },
    report: buildReport(
      staff, audit.totals, audit.shortfalls, dates,
      issuesToRelaxations(audit.issues), budget, audit.seniorGaps, ctx.seniorIds,
    ),
  };
}

function buildOnce(cfg, seed, ctx) {
  // Which seven days a weekly limit covers. The ward's convention, not ours.
  const weekOf = (d) => startOfWeek(d, cfg.weekStartsOn ?? 0);
  const dates = ctx.dates;
  const staff = ctx.staff;
  const rules = cfg.sequenceRules || [];

  /* Attempt one is the old deterministic build, exactly. Later attempts
     shuffle two things and nothing else: the order the day shifts are
     filled in, and which of two otherwise equal people is picked. Both are
     arbitrary choices, so varying them explores genuinely different rotas
     without loosening a single rule. */
  const random = rng(seed * 7919 + 13);
  const shiftOffset = seed === 0 ? 0 : Math.floor(random() * 3);
  const tie = {};
  const ids = staff.map((s) => String(s.id)).sort();
  if (seed === 0) {
    ids.forEach((id, i) => { tie[id] = i; });
  } else {
    const pool = [...ids];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    pool.forEach((id, i) => { tie[id] = i; });
  }
  const tieRank = (id) => tie[String(id)] ?? 0;

  const cells = {};                                  // "staffId|date" -> category
  const prev = {};                                   // staffId -> yesterday's category
  const totals = {};                                 // staffId -> counts, INCLUDING carried-in history
  const gen = {};                                    // staffId -> counts for THIS period only
  staff.forEach((s) => {
    totals[s.id] = { morning: 0, afternoon: 0, evening: 0, night: 0, off: 0, duties: 0, fridayOff: 0, fridayAfternoon: 0, nonOfficial: 0, daysAvailable: 0 };
    gen[s.id] = { morning: 0, afternoon: 0, evening: 0, night: 0, off: 0, duties: 0, fridayOff: 0, fridayAfternoon: 0, nonOfficial: 0, daysAvailable: 0 };
  });

  /* ── Carrying fairness forward from previous months ──
     Without this, every generated period starts from a clean slate, so
     someone who did all the nights last month is just as likely to do them
     again. Feeding in the previous rota fixes that.

     The counters are compared as RATES — duties per day available — not as
     raw totals. That matters enormously for anyone who has not been there
     the whole time. A nurse who joined last week has fewer night duties
     than everyone else, but she is not "behind": she was not employed. Raw
     totals would see the gap and give her every night going to catch up.
     Rates see that 1 night in 5 days matches 8 nights in 40 days, and
     treat both people equally from here.

     The same arithmetic quietly handles staff back from maternity leave,
     part-time staff, and anyone off sick for a stretch.                  */
  if (cfg.history?.cells && cfg.codes) {
    const catOf = {};
    cfg.codes.forEach((c) => { catOf[c.code] = c.counts; });
    const seen = {};
    for (const [key, code] of Object.entries(cfg.history.cells)) {
      const [id, date] = key.split('|');
      if (!totals[id]) continue;                     // staff no longer on the rota
      const cat = catOf[code];
      if (!cat) continue;
      if (!seen[`${id}|${date}`]) { totals[id].daysAvailable += 1; seen[`${id}|${date}`] = 1; }
      if (totals[id][cat] != null) totals[id][cat] += 1;
      if (cat !== 'off' && SHIFTS.includes(cat)) totals[id].duties += 1;
      if (isFriday(date)) {
        if (cat === 'off') totals[id].fridayOff += 1;
        if (cat === 'afternoon') totals[id].fridayAfternoon += 1;
      }
      if ((cfg.history.nonOfficialDates || []).includes(date) && cat !== 'off') totals[id].nonOfficial += 1;
    }
  }

  /* A rate built on two or three days swings wildly — one night duty in a
     single day reads as 100%. So each person's rate is blended with the
     team average, weighted by how much history they actually have. Someone
     brand new starts level with the team rather than at an extreme, and
     settles onto their own true rate as days accumulate.                 */
  const PRIOR_DAYS = 7;
  const teamRate = (key) => {
    const days = staff.reduce((n, s) => n + totals[s.id].daysAvailable, 0);
    if (!days) return 0;
    return staff.reduce((n, s) => n + totals[s.id][key], 0) / days;
  };
  const rate = (id, key, avg) =>
    (totals[id][key] + PRIOR_DAYS * avg) / (totals[id].daysAvailable + PRIOR_DAYS);
  const weekly = {};                                 // "staffId|weekStart" -> counts
  const bump = (id, date, key) => {
    const k = `${id}|${weekOf(date)}`;
    weekly[k] = weekly[k] || { morning: 0, afternoon: 0, evening: 0, night: 0, off: 0, noff: 0 };
    weekly[k][key] += 1;
  };
  /* Total duties in the week, whatever their type. This is the "five
     working days" rule: a person's week has a shape regardless of which
     shifts fill it. */
  const weekDuties = (id, date) =>
    SHIFTS.reduce((n, sh) => n + weekCount(id, date, sh), 0);
  const weekCount = (id, date, key) => weekly[`${id}|${weekOf(date)}`]?.[key] || 0;

  // Approved requests are hard: they go in first and nothing may move them.
  const requested = ctx.requested;

  /* Cells that already hold sick leave, family leave, medical leave or a
     release duty are kept as they are. They record something that already
     happened, so the generator works around them rather than over them. */
  const keep = ctx.keep;

  // The duty budget for each week in the range, worked out before anything
  // is filled in. Reported as well as used, so the manager sees the same
  // arithmetic the engine did.
  const budget = capacityByWeek(cfg, dates, staff, keep);

  /* ── Seniors ──
     Counted separately all the way through, because senior cover is a
     scarcer resource than staffing and runs out sooner. The same budget
     logic applies to it: a senior spent on a Tuesday evening that already
     had one is a senior Saturday night will not have.                   */
  const seniorIds = ctx.seniorIds;
  const senior = (id) => seniorIds.has(String(id));
  const seniorNeed = (sh) => seniorsNeededOn(cfg, sh);
  const seniorPerDay = SHIFTS.reduce((n, sh) => n + seniorNeed(sh), 0);
  const seniorGaps = [];

  const seniorOnShift = (assignedToday, sh) =>
    staff.reduce((n, s) => n + ((assignedToday[s.id] === sh && senior(s.id)) ? 1 : 0), 0);

  /* Senior duties still to place this week against senior duties still
     available. Read exactly like the main budget, on the smaller pool. */
  const seniorSlack = (workerId, date, assignedToday) => {
    if (!seniorPerDay) return Infinity;
    const week = weekOf(date);
    const later = dates.filter((d) => weekOf(d) === week && d > date);
    if (!later.length) return Infinity;
    const stillToCover = seniorPerDay * later.length;
    let stillToGive = 0;
    for (const s of staff) {
      if (!senior(s.id)) continue;
      const daysHere = later.filter((d) => !onLeave(s, d) && !keep[`${s.id}|${d}`]).length;
      const today = assignedToday[s.id];
      const worksToday = String(s.id) === String(workerId) || (today != null && today !== OFF_CAT);
      const allowed = dutyCeiling(cfg, s) - weekDuties(s.id, date) - (worksToday ? 1 : 0);
      stillToGive += Math.max(0, Math.min(daysHere, allowed));
    }
    return stillToGive - stillToCover;
  };

  const shortfalls = [];
  const relaxations = [];
  const forcedRest = new Set();   // rest days forced after nights — not leisure offs   // rules that were bent, so nothing is bent silently

  /* Blocks and runs are read from the history as well as what has been
     generated so far, so the first days of a new month continue naturally
     from the end of the last one rather than starting from nothing.     */
  const histCats = ctx.histCats;
  const catAt = (id, date) => cells[`${id}|${date}`] ?? histCats[`${id}|${date}`];

  /* The day before the range matters. Someone who worked Saturday night
     must not be handed Sunday morning simply because Sunday belongs to a
     newly generated week — the rule against that transition does not stop
     at a week boundary. Blocks and runs continue across it too. */
  const dayBefore = shiftDate(dates[0], -1);
  staff.forEach((s) => {
    const carried = histCats[`${s.id}|${dayBefore}`];
    if (carried) prev[s.id] = carried;
  });

  // How many days in a row, ending yesterday, this person had this category.
  const runOf = (id, cat, date) => {
    let n = 0;
    for (let back = 1; back <= 14; back++) {
      if (catAt(id, shiftDate(date, -back)) === cat) n++; else break;
    }
    return n;
  };
  // How many days in a row, ending yesterday, this person worked at all.
  const workedRun = (id, date) => {
    let n = 0;
    for (let back = 1; back <= 14; back++) {
      const c = catAt(id, shiftDate(date, -back));
      if (c && c !== 'off') n++; else break;
    }
    return n;
  };

  // How long a block of one shift may run before the person changes to
  // something else. Nights are shorter because two together is the norm.
  const maxBlock = (sh) =>
    cfg.maxBlock?.[sh] ?? (sh === 'night' ? 2 : 4);
  const maxDaysOn = cfg.maxConsecutiveDays ?? 4;

  /* ── The capacity check ──
     Will the rest of this week still be coverable if this person works
     today? Answered in duties, not opinions:

       what is left to cover  =  the minimums on every later day this week
       what is left to give   =  for each person, the smaller of the days
                                 they are still here and the duties their
                                 limits still allow

     A positive answer means there is genuine slack and an extra duty today
     costs nothing. Zero or less means today would be borrowing a duty that
     Saturday needs — which is exactly how a week ends with two shifts
     uncovered while somebody worked an unnecessary sixth morning.

     Only ever consulted before a duty ABOVE a shift's minimum. Filling a
     minimum is never blocked by this: that IS the coverage it protects. */
  const slackIfWorks = (workerId, date, assignedToday) => {
    const week = weekOf(date);
    const later = dates.filter((d) => weekOf(d) === week && d > date);
    if (!later.length) return Infinity;      // last day of the week: nothing left to protect
    const perDay = SHIFTS.reduce((n, sh) => n + (cfg.coverage?.[sh]?.min || 0), 0);
    const stillToCover = perDay * later.length;
    let stillToGive = 0;
    for (const s of staff) {
      const daysHere = later.filter((d) => !onLeave(s, d) && !keep[`${s.id}|${d}`]).length;
      const today = assignedToday[s.id];
      const worksToday = String(s.id) === String(workerId) || (today != null && today !== OFF_CAT);
      const allowed = dutyCeiling(cfg, s) - weekDuties(s.id, date) - (worksToday ? 1 : 0);
      stillToGive += Math.max(0, Math.min(daysHere, allowed));
    }
    return stillToGive - stillToCover;
  };

  for (const date of dates) {
    const assignedToday = {};                        // staffId -> category
    const pendingBlock = {};   // may only continue this shift today, or go off
    const countToday = { morning: 0, afternoon: 0, evening: 0, night: 0 };

    const available = staff.filter((s) => !onLeave(s, date) && !keep[`${s.id}|${date}`]);
    const unavailable = staff.filter((s) => onLeave(s, date) || keep[`${s.id}|${date}`]);
    unavailable.forEach((s) => { assignedToday[s.id] = null; }); // left exactly as found

    // 1. Approved requests first — they outrank everything.
    for (const s of available) {
      const req = requested[`${s.id}|${date}`];
      if (req) {
        assignedToday[s.id] = req;
        if (countToday[req] != null) countToday[req] += 1;
      }
    }

    // 2. Forced sequence rules, e.g. "must be OFF after a Night".
    //    A forced duty still respects the shift maximum — otherwise a rule
    //    like "always Night after an Off day" would put the whole team on
    //    nights and leave nobody for the morning.
    for (const s of available) {
      if (assignedToday[s.id] !== undefined) continue;
      const force = forcedToday(rules, prev[s.id]);
      if (!force) continue;
      /* "Always give Off after Night" means after the run of nights, not
         after each one — otherwise nights could never be worked in pairs,
         and every night would spend one of the person's off days. So if
         they are part-way through a block, let it finish first. */
      if (force === 'off' && prev[s.id] && prev[s.id] !== 'off') {
        if (runOf(s.id, prev[s.id], date) < maxBlock(prev[s.id])) {
          /* The rest day is held back so the block can finish — a second
             night, say. But that is the ONLY thing they may do today:
             letting them take an afternoon instead would break the rule
             the rest day exists to enforce. */
          pendingBlock[s.id] = prev[s.id];
          continue;
        }
      }
      // A restriction outranks a forced rule. Someone on mornings only is
      // not put on a night just because a rule says nights follow off days.
      const only = cfg.staffShifts?.[s.id];
      if (only && only.length && force !== 'off' && !only.includes(force)) continue;
      const cap = cfg.coverage?.[force]?.max;
      if (countToday[force] != null && cap != null && countToday[force] >= cap) {
        relaxations.push({ date, shift: force, rule: 'duty rule (maximum reached)' });
        continue;                       // leave them for the normal filling below
      }
      /* A forced duty on a shift that is already at its minimum is an
         extra, and extras come out of the week's budget like any other. A
         rule such as "always night after an off day" can otherwise spend
         Saturday's duties on Tuesday. The rule yields, and says so. */
      if (force !== 'off' && countToday[force] != null) {
        const min = cfg.coverage?.[force]?.min || 0;
        if (countToday[force] >= min && slackIfWorks(s.id, date, assignedToday) <= 0) {
          relaxations.push({ date, shift: force, rule: 'duty rule (duties kept for a later day)' });
          continue;
        }
      }
      assignedToday[s.id] = force;
      /* A rest day the rules force after a night block is a different thing
         from an off day someone is given for their week's rest. It does not
         spend their off allowance — otherwise every pair of nights would
         cost two of the week's off days and nights would become unfillable
         by Thursday. It is also written with the (N)OFF code if one exists,
         which is exactly what that code is for. */
      if (force === 'off' && prev[s.id] === 'night') forcedRest.add(`${s.id}|${date}`);
      if (countToday[force] != null) countToday[force] += 1;
    }

    // 3. Fill each shift to its minimum. Night first: it is the most
    //    constrained, so leaving it last tends to make it unfillable.
    /* Nights are filled first because they are the most constrained. The
       day shifts then rotate their turn from one date to the next: filling
       afternoon before morning every single day means whoever is free gets
       grabbed for afternoon first, and the same people never see a morning
       all week. Rotating the order shares that advantage out. */
    const dayShifts = ['morning', 'afternoon', 'evening'];
    const turn = (dates.indexOf(date) + shiftOffset) % dayShifts.length;
    /* Shifts that need a senior are filled first. A senior can only be in
       one place, so if the evening is staffed before the morning, the one
       senior free that day can end up on the evening — which did not need
       her — leaving the morning with nobody in charge. Sorting is stable,
       so the day shifts keep their rotation among themselves. */
    const order = ['night', ...dayShifts.slice(turn), ...dayShifts.slice(0, turn)]
      .sort((a, b) => (seniorNeed(b) > 0 ? 1 : 0) - (seniorNeed(a) > 0 ? 1 : 0));
    for (const shift of order) {
      const min = cfg.coverage?.[shift]?.min || 0;
      const max = cfg.coverage?.[shift]?.max ?? Infinity;
      /* Once it is clear no senior can be found for this shift today, the
         requirement is set aside for the rest of it — otherwise the loop
         would ask the same impossible question on every pass. The gap is
         recorded, and the shift still gets staffed by whoever is free:
         unsupervised is bad, unstaffed is worse.                        */
      let noSeniorToday = false;

      while (countToday[shift] < min
             || (!noSeniorToday && seniorOnShift(assignedToday, shift) < seniorNeed(shift))) {
        /* The senior slot is filled before anything else on the shift.
           Filling by body count first and hoping a senior turns up leaves
           the last place on a one-person night shift going to whoever is
           free — and then there is no room left for the person who was
           supposed to be in charge of it. */
        const needSenior = !noSeniorToday
          && seniorOnShift(assignedToday, shift) < seniorNeed(shift);

        // The shift is as full as the ward runs it. If it still has no
        // senior, that is a gap to report, not a reason to overfill.
        if (countToday[shift] >= max) {
          if (needSenior) { seniorGaps.push({ date, shift, needed: seniorNeed(shift) - seniorOnShift(assignedToday, shift) }); }
          break;
        }

        /* Some rules can be bent rather than leaving a shift uncovered.
           Which ones is the manager's decision: a ward that would rather
           give someone a fifth morning than run a shift short sets the
           weekly cap to soft. Anything left hard is never broken.

           Relaxation is tried in order of least harm — a stretched weekly
           cap first, then a lost off day, and only last a sequence rule,
           since those usually exist for safety. Whatever gets bent is
           recorded and shown, so nothing is bent silently.              */
        /* ── Which rule gives way first ──
           Every limit is Disabled, Hard or Soft. Hard limits are never
           broken. Soft ones carry a priority, and when a shift cannot be
           covered the lowest priority yields first — P4 before P3, and so
           on. That way a cosmetic preference is sacrificed long before a
           critical rest rule.

           "Coverage first" is the one thing not negotiable: after every
           soft rule has yielded, a final pass takes anyone physically
           present rather than leave a shift unstaffed.                  */
        const R = cfg.ruleStates || {};
        // When no explicit state is set, fall back to the simple soft/hard
        // switches. Anything not mentioned stays hard, so a rule never
        // becomes bendable just because priorities were introduced.
        const legacy = cfg.soft || {};
        const defaultState = (key) => {
          if (key === 'workPattern') return legacy.weeklyCaps ? 'soft' : 'hard';
          if (key.startsWith('weeklyCaps')) return legacy.weeklyCaps ? 'soft' : 'hard';
          return legacy[key] ? 'soft' : 'hard';
        };
        const stateOf = (key) => R[key]?.state ?? defaultState(key);
        const prioOf = (key) => R[key]?.priority ?? 2;

        // The weekly cap is set per shift, so each has its own state and
        // priority: a ward may guard its night limit fiercely while letting
        // the morning limit stretch.
        const capKey = `weeklyCaps:${shift}`;
        const relaxable = [capKey, 'workPattern', 'offMin', 'sequence']
          .filter((k) => stateOf(k) === 'soft')
          .sort((a, b) => prioOf(b) - prioOf(a));      // P4 yields first

        let candidates = [];
        let usedLevel = 0;
        let yielded = [];
        // Each step drops one more soft rule; the last step drops everything.
        for (let step = 0; step <= relaxable.length + 1; step++) {
          const dropped = new Set(relaxable.slice(0, step));
          const lastResort = step > relaxable.length;
          candidates = available.filter((s) => {
            if (assignedToday[s.id] !== undefined) return false;
            // Filling the senior slot: only a senior will do. This one is
            // never relaxed, because a non-senior in the senior slot is not
            // a stretched rule, it is a different rule.
            if (needSenior && !senior(s.id)) return false;
            if (pendingBlock[s.id] && pendingBlock[s.id] !== shift) return false;
            const only = cfg.staffShifts?.[s.id];
            if (only && only.length && !only.includes(shift)) return false;  // never relaxed

            if (stateOf('sequence') !== 'disabled' && !dropped.has('sequence')
                && (!lastResort || stateOf('sequence') === 'hard')) {
              const banned = forbiddenToday(rules, prev[s.id]);
              const allowed = allowedOverride(rules, prev[s.id]);
              if (banned.has(shift) && !allowed.has(shift)) return false;
            }
            /* The weekly table describes how a rota rotates someone
               between shifts. Anyone tied to a single shift has nothing to
               rotate to, so none of it applies to them — not the caps, not
               the minimums. Enforcing it would only leave them idle while
               the one shift they are qualified for goes short. */
            /* The weekly duty maximum is hard: it is the difference
               between a full week and an overtime claim. */
            const dutyMax = cfg.weeklyDuties?.max;
            if (dutyMax != null && weekDuties(s.id, date) >= dutyMax) return false;
            const singleShift = only && only.length === 1;
            if (!singleShift && stateOf(capKey) !== 'disabled' && !dropped.has(capKey)
                && (!lastResort || stateOf(capKey) === 'hard')) {
              const cap = cfg.weeklyPerStaff?.[shift];
              if (cap != null && weekCount(s.id, date, shift) >= cap) return false;
            }
            if (stateOf('workPattern') !== 'disabled' && !dropped.has('workPattern')
                && (!lastResort || stateOf('workPattern') === 'hard')) {
              if (runOf(s.id, shift, date) >= maxBlock(shift)) return false;
              if (workedRun(s.id, date) >= maxDaysOn) return false;
            }
            if (!singleShift && stateOf('offMin') !== 'disabled' && !dropped.has('offMin')
                && (!lastResort || stateOf('offMin') === 'hard')) {
              const offMin = cfg.weeklyPerStaff?.off;
              if (offMin != null) {
                const worked = SHIFTS.reduce((n, sh) => n + weekCount(s.id, date, sh), 0);
                if (worked >= 7 - offMin) return false;
              }
            }
            // Even the last resort will not work someone into the ground.
            if (workedRun(s.id, date) >= (cfg.absoluteMaxDaysOn ?? 6)) return false;
            return true;
          });
          usedLevel = step;
          yielded = lastResort ? ['all working limits'] : [...dropped];
          if (candidates.length) break;
        }
        if (usedLevel > 0 && candidates.length) {
          const NICE = {
            workPattern: 'working pattern', offMin: 'off days', sequence: 'duty rule',
          };
          const label = (k) => k.startsWith('weeklyCaps:')
            ? `weekly ${k.split(':')[1]} limit` : (NICE[k] || k);
          relaxations.push({
            date, shift,
            rule: yielded.map(label).join(' + ') || 'working limits',
          });
        }
        if (!candidates.length) {
          /* No senior can do this shift today — every one of them is
             already on duty elsewhere, off, or barred by a rule that is
             hard. The requirement is recorded as missed and set aside, and
             the loop goes round again to staff the shift with whoever is
             free. A shift with no senior needs the manager's eye; a shift
             with nobody at all needs it more.                           */
          if (needSenior) {
            seniorGaps.push({
              date, shift,
              needed: seniorNeed(shift) - seniorOnShift(assignedToday, shift),
            });
            noSeniorToday = true;
            continue;
          }
          shortfalls.push({ date, shift, needed: min - countToday[shift] });
          break;
        }
        const near = (a, b) => Math.abs(a - b) < 1e-9;
        /* Blocks come first: real rotas are written in runs of the same
           duty, and nights are worked in pairs. */
        const blockScore = (id) => {
          const run = runOf(id, shift, date);
          const soFar = weekCount(id, date, shift);
          const wantMin = cfg.weeklyMin?.[shift];
          /* Having had none of this shift all week outranks everything,
             including finishing a pair of nights. Pairing is a preference,
             not a requirement: with seven nights and six people, insisting
             on pairs means three people take two each and the rest never
             get one at all. Everybody gets their first night, and only then
             do the spare nights pair up. */
          if (soFar === 0) return -1000;
          if (run > 0 && shift === 'night') return -900;
          // A preferred transition from yesterday's duty, e.g. "after a
          // night, prefer another night".
          if (preferredToday(rules, prev[id]).has(shift)) return -800;
          if (wantMin != null && soFar < wantMin) return -500;
          if (run > 0) return -100 - run;
          return 0;
        };

        /* Fairness measures are compared in priority order — a P1 measure
           decides before a P2 one, and a P2 before a P3. Only if they tie
           does the next measure get a say. That is the staged behaviour the
           specification asks for, applied to who gets picked. */
        const F = cfg.fairnessStates || {};
        const fState = (k) => F[k]?.state ?? (cfg.fairness?.[k] === false ? 'disabled' : 'soft');
        const fPrio = (k) => F[k]?.priority ?? 2;
        const fri = isFriday(date);
        const nonOff = (cfg.nonOfficialDates || []).includes(date);

        const measures = [
          { key: 'shift',           metric: shift,             on: true,            invert: false },
          { key: 'fridayAfternoon', metric: 'fridayAfternoon', on: fri && shift === 'afternoon', invert: false },
          { key: 'fridayOff',       metric: 'fridayOff',       on: fri,             invert: true  },
          { key: 'nonOfficial',     metric: 'nonOfficial',     on: nonOff,          invert: false },
          { key: 'duties',          metric: 'duties',          on: true,            invert: false },
        ].filter((m) => m.on && fState(m.key) !== 'disabled')
         .sort((a, b) => fPrio(a.key) - fPrio(b.key));

        const avgCache = {};
        const avgFor = (metric) => {
          if (!(metric in avgCache)) avgCache[metric] = teamRate(metric);
          return avgCache[metric];
        };

        /* When senior cover is the scarce thing, an ordinary slot should go
           to an ordinary member of staff. Spending a senior on a shift that
           already has one is how Saturday night ends up unsupervised. Only
           applied when the senior budget is genuinely tight — otherwise it
           would push seniors towards the same few shifts week after week,
           which is its own kind of unfair. */
        const seniorShortToday = SHIFTS.reduce(
          (n, sh) => n + Math.max(0, seniorNeed(sh) - seniorOnShift(assignedToday, sh)), 0);
        const seniorScarce = seniorPerDay > 0 && !needSenior
          && (seniorShortToday > 0 || seniorSlack(null, date, assignedToday) <= 0);

        candidates.sort((a, b) => {
          if (seniorScarce) {
            const sa = senior(a.id) ? 1 : 0, sb = senior(b.id) ? 1 : 0;
            if (sa !== sb) return sa - sb;
          }
          const ba = blockScore(a.id), bb = blockScore(b.id);
          if (ba !== bb) return ba - bb;
          /* Whoever has had this shift least THIS WEEK goes first. Without
             this, someone can end up with a week of nothing but afternoons
             while the totals across the month still look balanced. A mix
             within the week is what people actually notice. */
          const wa = weekCount(a.id, date, shift), wb = weekCount(b.id, date, shift);
          if (wa !== wb) return wa - wb;
          for (const m of measures) {
            const avg = avgFor(m.metric);
            const ra = rate(a.id, m.metric, avg), rb = rate(b.id, m.metric, avg);
            if (!near(ra, rb)) return m.invert ? rb - ra : ra - rb;
          }
          /* Genuinely nothing to choose between them. Which one goes first
             is arbitrary — which is precisely why it varies between
             attempts, and why one of those attempts may come out cleaner. */
          return tieRank(a.id) - tieRank(b.id);
        });

        const together = [candidates[0]];

        if (countToday[shift] + together.length > max) { together.length = Math.max(0, max - countToday[shift]); }
        if (!together.length) { shortfalls.push({ date, shift, needed: min - countToday[shift] }); break; }

        together.forEach((s) => { assignedToday[s.id] = shift; countToday[shift] += 1; });
      }
    }

    // 4. Everyone still unassigned gets OFF, unless a rule forbids it, or
    //    they have already had their maximum off days for the week — in
    //    which case they are put on a shift that still has room.
    for (const s of available) {
      if (assignedToday[s.id] !== undefined) continue;
      const banned = forbiddenToday(rules, prev[s.id]);
      const allowed = allowedOverride(rules, prev[s.id]);
      const offBanned = banned.has('off') && !allowed.has('off');

      const offMax = cfg.weeklyPerStaff?.offMax;
      const hadOff = offMax != null && weekCount(s.id, date, 'off') >= offMax;
      // Below their weekly duty minimum, so a rest day now would leave the
      // week short. Treated the same as having used up the off allowance.
      const dutyMin = cfg.weeklyDuties?.min;
      const owedDuties = dutyMin != null && weekDuties(s.id, date) < dutyMin;
      /* Off days are taken singly. Two together reads as a weekend, which
         is not how a seven-day rota works — someone off yesterday should
         normally be back on duty today. */
      const offYesterday = cfg.singleOffDays !== false && runOf(s.id, 'off', date) >= 1;

      let give = null;
      if (offBanned || hadOff || offYesterday || owedDuties) {
        const only = cfg.staffShifts?.[s.id];
        /* Which shift to try first. Not the order they happen to be listed
           in — a spare person goes wherever they are most use. Anything
           still below its minimum comes first, then whichever shift is
           thinnest. Without this, "morning" wins every time simply for
           being first in the list, and the ward ends up with three on a
           morning and nobody on the evening.                            */
        const byNeed = [...SHIFTS].sort((x, y) => {
          /* A senior with a day to spare goes first to a shift that has no
             senior on it, even if that shift is otherwise fully staffed.
             That is the whole point of marking them senior. */
          if (senior(s.id)) {
            const sx = seniorNeed(x) - seniorOnShift(assignedToday, x) > 0 ? 1 : 0;
            const sy = seniorNeed(y) - seniorOnShift(assignedToday, y) > 0 ? 1 : 0;
            if (sx !== sy) return sy - sx;
          }
          const gapX = (cfg.coverage?.[x]?.min || 0) - countToday[x];
          const gapY = (cfg.coverage?.[y]?.min || 0) - countToday[y];
          if (gapX !== gapY) return gapY - gapX;
          return countToday[x] - countToday[y];
        });
        const findShift = (ignoreCoverageMax, ignorePattern, ignoreBudget) => byNeed.find((sh) => {
          // The weekly duty maximum holds on this path too. Pushing someone
          // into a sixth day to spare them a third off day just moves the
          // problem onto the payroll.
          const dMax = cfg.weeklyDuties?.max;
          if (dMax != null && weekDuties(s.id, date) >= dMax) return false;
          if (pendingBlock[s.id] && pendingBlock[s.id] !== sh) return false;
          if (only && only.length && !only.includes(sh)) return false;
          if (banned.has(sh) && !allowed.has(sh)) return false;
          // A maximum of zero means the shift is not run at all. That is
          // never overridden — putting someone on a shift the ward does not
          // operate is worse than any off-day arithmetic.
          if (cfg.coverage?.[sh]?.max === 0) return false;
          if (!ignoreCoverageMax) {
            const max = cfg.coverage?.[sh]?.max;
            if (max != null && countToday[sh] >= max) return false;
          }
          /* ── The budget, and the whole point of it ──
             This shift already has the people it needs today, so putting
             somebody else on it is an EXTRA duty. Extras are fine while the
             week has slack, and ruinous once it does not: every extra duty
             handed out on a Tuesday is a duty that is not available on
             Saturday, and the person who worked it will be at their weekly
             maximum when Saturday arrives.

             So: an extra is allowed only if the rest of the week can still
             be covered without it. Filling a shift that is still SHORT is
             not an extra and is always allowed — that is coverage, which
             comes first.                                                */
          if (!ignoreBudget) {
            const min = cfg.coverage?.[sh]?.min || 0;
            if (countToday[sh] >= min && slackIfWorks(s.id, date, assignedToday) <= 0) return false;
            /* The same guard on the smaller pool. A senior filling an
               ordinary spare place is fine while there are seniors to
               spare, and costs a later shift its charge nurse once there
               are not. Going where a senior IS needed is always allowed —
               that is the coverage this protects. */
            if (senior(s.id) && seniorOnShift(assignedToday, sh) >= seniorNeed(sh)
                && seniorSlack(s.id, date, assignedToday) <= 0) return false;
          }
          const cap = cfg.weeklyPerStaff?.[sh];
          if (cap != null && weekCount(s.id, date, sh) >= cap) return false;
          if (!ignorePattern) {
            if (runOf(s.id, sh, date) >= maxBlock(sh)) return false;
            if (workedRun(s.id, date) >= maxDaysOn) return false;
          }
          // Nobody is worked into the ground, whatever the off limit says.
          if (workedRun(s.id, date) >= (cfg.absoluteMaxDaysOn ?? 6)) return false;
          return true;
        }) || null;

        /* A sequence rule that forbids an off day today is hard, so the
           budget yields to it — but only to it. */
        give = findShift(false, false, offBanned);
        /* When the off-day maximum is hard, an extra off day is not an
           option: the person is put on a shift even if that takes it past
           its usual maximum, or breaks a block. An over-full shift is a
           nuisance; an unexplained absence is a payroll problem.        */
        const offHard = (cfg.ruleStates?.offMax?.state ?? 'soft') === 'hard';
        if (!give && (hadOff || owedDuties)) {
          /* Stretching the working pattern is a fair price for keeping
             someone off the absent list. Overfilling a shift is not: three
             people on a one-person night shift is not a rota, and the ward
             would have to undo it by hand. The week's budget still holds
             here — a fourth morning today is not worth an uncovered night
             on Saturday. */
          const stretched = findShift(false, true, false);
          if (stretched) {
            give = stretched;
            relaxations.push({ date, shift: give, rule: 'working pattern stretched to avoid an extra off day' });
          }
        }
        /* Last of all, and only for a HARD off maximum: the budget itself
           gives way. A hard maximum is a promise to the staff, so it wins —
           but the duty it spends is one a later day will not have, so it is
           reported as exactly that.

           Being below the weekly duty MINIMUM never reaches here. That
           minimum is about one person's week; the budget is about whether
           the ward is staffed. Letting "she is one duty short" spend the
           week's last duties is how a Sunday ends up with the whole team on
           and a Saturday with nobody. */
        if (!give && hadOff && offHard) {
          const forced = findShift(false, true, true);
          if (forced) {
            give = forced;
            relaxations.push({ date, shift: give, rule: 'a later day\u2019s duty used to keep within the off maximum' });
          }
        }
        /* Nothing is reported here. Whether a person really ended the week
           short of duties, or with an extra off day, is a fact about the
           finished week — not about today. Reporting it each day turned one
           extra off day into nine separate "a limit was stretched" notes,
           which reads as a far worse rota than it is. It is counted once,
           per person, at the end, where it can be said properly.        */
      }
      assignedToday[s.id] = give || 'off';
      if (countToday[assignedToday[s.id]] != null) countToday[assignedToday[s.id]] += 1;
    }

    // 5. Record the day and roll the counters forward.
    for (const s of staff) {
      let cat = assignedToday[s.id];
      // Only leave and preserved cells are deliberately blank. Anyone else
      // must end the day with something written, even if every rule had to
      // give way to get there — a blank cell in a published rota is worse
      // than an imperfect one.
      if (cat === undefined && !onLeave(s, date) && !keep[`${s.id}|${date}`]
          && !cfg.skipStaff?.includes(s.id)) {
        cat = 'off';
        relaxations.push({ date, shift: 'off', rule: 'no duty was possible, so an off day' });
      }
      if (cat == null) { prev[s.id] = null; continue; }   // on leave: left untouched
      cells[`${s.id}|${date}`] = cat;
      // totals drive the fairness maths and carry history forward.
      // gen records only what this run produced, which is what the manager
      // is shown — otherwise last month's nights would appear in this
      // month's report and look like a wildly unfair rota.
      for (const acc of [totals[s.id], gen[s.id]]) {
        acc[cat] += 1;
        acc.daysAvailable += 1;
        if (cat !== 'off') acc.duties += 1;
        if (isFriday(date)) {
          if (cat === 'off') acc.fridayOff += 1;
          if (cat === 'afternoon') acc.fridayAfternoon += 1;
        }
        if ((cfg.nonOfficialDates || []).includes(date) && cat !== 'off') acc.nonOfficial += 1;
      }
      /* The rest day after a night is still an off day. A week is seven
         days: five working and two off. If the rest after nights sat
         outside that allowance, anyone doing nights would need an eighth
         day. It is written with the (N)OFF code so it is recognisable, but
         it counts the same. */
      bump(s.id, date, cat === 'off' && forcedRest.has(`${s.id}|${date}`) && cfg.restOutsideOffAllowance
        ? 'noff' : cat);
      prev[s.id] = cat;
    }
  }

  /* ── Repair pass ──
     Filling day by day cannot look ahead, so it sometimes uses up the only
     people who could have covered a later shift. A manager fixing this by
     hand does not start again — they swap. "Move Sarah off Tuesday morning,
     someone else can do that, and then she is free for Friday night."

     This does the same. For every shift left short, it looks for a swap that
     fills it, checks the swap breaks no hard rule, and keeps it only if it
     genuinely helps. Anything it cannot fix stays reported as a shortfall
     rather than being papered over.                                       */
  function repairShortfalls() {
    // A shift with no senior on it is a gap too, and gets the same
    // attention: swapping the charge nurse in is exactly the sort of fix a
    // manager makes by hand.
    if (!shortfalls.length && !seniorGaps.length) return;

    const countOn = (date, sh) =>
      staff.reduce((n, s) => n + (cells[`${s.id}|${date}`] === sh ? 1 : 0), 0);

    /* Rather than trying to reason about what a swap might break, every
       candidate swap is applied and the whole rota re-scored. If the score
       does not strictly improve, the swap is undone. A repair can therefore
       never make the rota worse, however unusual the situation.          */
    const score = () => {
      let short = 0, overMax = 0, seq = 0, unsupervised = 0;
      for (const date of dates) {
        for (const sh of SHIFTS) {
          const c = countOn(date, sh);
          const min = cfg.coverage?.[sh]?.min || 0;
          const max = cfg.coverage?.[sh]?.max;
          if (c < min) short += (min - c);
          if (max != null && c > max) overMax += (c - max);
          /* A repair that fills Saturday's evening by taking the only
             senior off Saturday's night has not repaired anything. Counted
             here so the rollback catches it. */
          const need = seniorNeed(sh);
          if (need) {
            const on = staff.reduce((n, s) =>
              n + ((cells[`${s.id}|${date}`] === sh && senior(s.id)) ? 1 : 0), 0);
            if (on < need) unsupervised += (need - on);
          }
        }
        for (const s of staff) {
          const y = catAt(s.id, shiftDate(date, -1));
          const t = cells[`${s.id}|${date}`];
          if (!y || !t) continue;
          const banned = forbiddenToday(rules, y);
          const allowed = allowedOverride(rules, y);
          if (banned.has(t) && !allowed.has(t)) seq += 1;
        }
      }
      // Sequence and over-max breaches weigh more than an unfilled slot,
      // so a repair never trades a broken rule for a filled shift. A shift
      // losing its senior weighs the same as losing a person: both are
      // coverage, and neither should be traded for the other.
      return short + unsupervised + overMax * 10 + seq * 10;
    };

    const canTake = (id, date, sh) => {
      /* Repairs must respect the weekly duty maximum too. Filling a gap by
         giving somebody a sixth working day is not a repair, it is a
         different problem wearing the same clothes. */
      const dMax = cfg.weeklyDuties?.max;
      if (dMax != null && sh !== OFF_CAT) {
        const wk = weekOf(date);
        const worked = dates.filter((d) => weekOf(d) === wk && d !== date)
          .reduce((n, d) => n + (cells[`${id}|${d}`] && cells[`${id}|${d}`] !== 'off' ? 1 : 0), 0);
        if (worked >= dMax) return false;
      }
      const only = cfg.staffShifts?.[id];
      if (only && only.length && sh !== 'off' && !only.includes(sh)) return false;
      const person = staff.find((s) => s.id === id);
      if (!person || onLeave(person, date)) return false;
      if (keep[`${id}|${date}`]) return false;
      const req = requested[`${id}|${date}`];
      if (req && req !== sh) return false;
      return true;
    };

    let best = score();
    for (let pass = 0; pass < 3 && best > 0; pass++) {
      let improvedThisPass = false;
      for (const gap of [...shortfalls, ...seniorGaps]) {
        const { date, shift } = gap;

        // 1. Move someone already on duty that day from a shift that can
        //    spare them.
        for (const s of staff) {
          const now = cells[`${s.id}|${date}`];
          if (!now || now === shift || !canTake(s.id, date, shift)) continue;
          cells[`${s.id}|${date}`] = shift;
          const after = score();
          if (after < best) {
            best = after; improvedThisPass = true;
            relaxations.push({ date, shift, rule: 'moved from another shift to cover' });
            break;
          }
          cells[`${s.id}|${date}`] = now;          // undo
        }

        // 2. Borrow the same duty from a day that has one to spare.
        for (const s of staff) {
          if (cells[`${s.id}|${date}`] !== 'off' || !canTake(s.id, date, shift)) continue;
          let done = false;
          for (const other of dates) {
            if (other === date || cells[`${s.id}|${other}`] !== shift) continue;
            cells[`${s.id}|${other}`] = 'off';
            cells[`${s.id}|${date}`] = shift;
            const after = score();
            if (after < best) {
              best = after; improvedThisPass = true; done = true;
              relaxations.push({ date, shift, rule: 'moved a duty from another day to cover' });
              break;
            }
            cells[`${s.id}|${other}`] = shift;     // undo
            cells[`${s.id}|${date}`] = 'off';
          }
          if (done) break;
        }

        /* 3. Take a duty off somebody who is ABOVE what the day needed and
              give it to the person who can cover this gap. Different from
              the first two: those move one person, this frees capacity from
              a day that was over-staffed and spends it here. It is the
              swap a manager makes when they notice two nurses on Tuesday
              evening and none on Saturday.                              */
        if (countOn(date, shift) < (cfg.coverage?.[shift]?.min || 0)) {
          for (const s of staff) {
            if (cells[`${s.id}|${date}`] !== 'off' || !canTake(s.id, date, shift)) continue;
            let done = false;
            for (const other of dates) {
              const had = cells[`${s.id}|${other}`];
              if (other === date || !had || had === 'off') continue;
              // Only take from a day that has more of that shift than it needs.
              if (countOn(other, had) <= (cfg.coverage?.[had]?.min || 0)) continue;
              cells[`${s.id}|${other}`] = 'off';
              cells[`${s.id}|${date}`] = shift;
              const after = score();
              if (after < best) {
                best = after; improvedThisPass = true; done = true;
                relaxations.push({ date, shift, rule: 'took a spare duty from an over-staffed day' });
                break;
              }
              cells[`${s.id}|${other}`] = had;     // undo
              cells[`${s.id}|${date}`] = 'off';
            }
            if (done) break;
          }
        }
      }
      if (!improvedThisPass) break;
    }

    // Rebuild the shortfall list from the rota as it now stands, so the
    // report never claims a gap that was filled or hides one that was not.
    shortfalls.length = 0;
    seniorGaps.length = 0;
    for (const date of dates) {
      for (const sh of SHIFTS) {
        const min = cfg.coverage?.[sh]?.min || 0;
        const c = countOn(date, sh);
        if (c < min) shortfalls.push({ date, shift: sh, needed: min - c });
        const need = seniorNeed(sh);
        if (!need) continue;
        const on = staff.reduce((n, s) =>
          n + ((cells[`${s.id}|${date}`] === sh && senior(s.id)) ? 1 : 0), 0);
        if (on < need) seniorGaps.push({ date, shift: sh, needed: need - on });
      }
    }
  }
  repairShortfalls();

  // Totals are rebuilt after repair, so the report describes the rota that
  // was actually produced rather than the one before the swaps.
  staff.forEach((s) => {
    Object.keys(gen[s.id]).forEach((k) => { gen[s.id][k] = 0; });
  });
  for (const date of dates) {
    for (const s of staff) {
      const cat = cells[`${s.id}|${date}`];
      if (!cat) continue;
      const acc = gen[s.id];
      if (acc[cat] != null) acc[cat] += 1;
      acc.daysAvailable += 1;
      if (cat !== 'off') acc.duties += 1;
      if (isFriday(date)) {
        if (cat === 'off') acc.fridayOff += 1;
        if (cat === 'afternoon') acc.fridayAfternoon += 1;
      }
      if ((cfg.nonOfficialDates || []).includes(date) && cat !== 'off') acc.nonOfficial += 1;
    }
  }

  /* ── What the week actually came to ──
     A stretched weekly limit is a property of a finished week, so it is
     counted once per person per week rather than each time the day-by-day
     fill bumped into it. Only whole weeks are judged: a five-day range
     cannot be short of a weekly minimum.                                */
  for (const week of [...new Set(dates.map(weekOf))]) {
    const ds = dates.filter((d) => weekOf(d) === week);
    if (ds.length !== 7) continue;
    for (const s of staff) {
      let duties = 0, offs = 0, present = 0;
      ds.forEach((d) => {
        const c = cells[`${s.id}|${d}`];
        if (!c) return;
        present += 1;
        if (c !== OFF_CAT) { duties += 1; return; }
        // A rest day after nights only counts against the off allowance
        // when the ward has said it should.
        if (cfg.restOutsideOffAllowance && forcedRest.has(`${s.id}|${d}`)) return;
        offs += 1;
      });
      if (present < ds.length) continue;            // part of the week on leave
      const dutyMin = cfg.weeklyDuties?.min;
      if (dutyMin != null && duties < dutyMin) {
        relaxations.push({
          date: week, staffId: s.id, staff: s.name, shift: 'off',
          rule: 'weekly duty minimum', detail: `${s.name}: ${duties} duties, not ${dutyMin}`,
        });
      }
      const offMax = cfg.weeklyPerStaff?.offMax;
      if (offMax != null && offs > offMax) {
        relaxations.push({
          date: week, staffId: s.id, staff: s.name, shift: 'off',
          rule: 'maximum off days', detail: `${s.name}: ${offs} off days, not ${offMax}`,
        });
      }
    }
  }

  return {
    ok: true, problems: [], cells, nightRest: [...forcedRest],
    report: buildReport(staff, gen, shortfalls, dates, relaxations, budget, seniorGaps, seniorIds),
  };
}

/* Turns the engine's categories into the cells the rota actually stores,
   using the person's own duty codes. Kept separate from generateRoster so
   the engine stays testable without needing a code list, and so the preview
   can show real codes before anything is written. */
export function toRotaCells(cells, codes, nightRest, chosen = {}) {
  const out = {};
  const cache = {};
  /* Which code actually gets written for each kind of duty.

     Left to itself this takes the first code set to count as the category,
     which is a guess — a reasonable one for the default list, and wrong for
     a ward that deleted M and kept M(R), or that has three different off
     codes. So the ward's choice wins where it has made one, and the guess is
     only the fallback.

     A choice is checked against the current code list before it is used: a
     code can be deleted in Settings long after it was picked here, and
     writing a code that no longer exists would leave cells the rota cannot
     colour or count. */
  const exists = (code) => !!code && (codes || []).some((c) => c.code === code);
  const codeFor = (cat) => {
    if (exists(chosen[cat])) return chosen[cat];
    if (!(cat in cache)) cache[cat] = codeForCategory(codes, cat);
    return cache[cat];
  };

  /* The rest day after a night block. Wards write this differently — (N)OFF,
     OFF(N), N/OFF, NOFF — so the ward says which one, and the old guess of
     "an off code with (N) in it" is kept only for wards that have not been
     asked yet. Falls back to the ordinary off code, which is what a rest day
     is anyway; the separate code exists to make it recognisable, not to
     change what it counts as. */
  const rest = new Set(nightRest || []);
  const nightOffCode = exists(chosen.nightOff)
    ? chosen.nightOff
    : ((codes || []).find((c) => c.counts === OFF_CAT && /\(N\)/i.test(c.code))?.code || null);

  for (const [key, category] of Object.entries(cells)) {
    const code = (category === OFF_CAT && rest.has(key) && nightOffCode)
      ? nightOffCode
      : codeFor(category);
    if (code) out[key] = code;   // no code for that category: leave the cell alone
  }
  return out;
}

/* The report is what makes the result trustworthy. It shows the spread on
   each fairness measure, so an unfair rota is visible before it is applied
   rather than discovered by the staff member who got all the nights.

   Anyone who was on leave for the entire period is left out of these
   figures. Including them would drag every minimum to zero and make a
   perfectly balanced rota look wildly unfair.                            */
function buildReport(staff, totals, shortfalls, dates, relaxations = [], budget = [],
                     seniorGaps = [], seniorIds = new Set()) {
  const worked = staff.filter((s) => {
    const t = totals[s.id];
    return t.duties + t.off > 0;
  });
  const excluded = staff.length - worked.length;

  const measure = (key) => {
    const vals = worked.map((s) => totals[s.id][key]);
    if (!vals.length) return { min: 0, max: 0, spread: 0, avg: 0 };
    const min = Math.min(...vals), max = Math.max(...vals);
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    return { min, max, spread: max - min, avg: Math.round(avg * 10) / 10 };
  };
  /* The budget is reported as well as used, so an uncovered shift can be
     explained in numbers rather than as "not enough staff were free". A
     week that was two duties short of what it needed is a settings problem;
     a week with duties to spare that still came out short is the engine's
     problem, and the report should be able to tell them apart.          */
  const shortOfCapacity = budget.filter((w) => w.spare < 0);
  return {
    days: dates.length,
    staffCount: staff.length,
    rosteredCount: worked.length,
    excludedOnLeave: excluded,
    shortfalls,
    seniorGaps,
    relaxations,
    budget,
    seniorCount: staff.filter((s) => seniorIds.has(String(s.id))).length,
    dutiesNeeded: budget.reduce((n, w) => n + w.dutiesNeeded, 0),
    dutiesAvailable: budget.reduce((n, w) => n + w.dutiesAvailable, 0),
    dutiesSpare: budget.reduce((n, w) => n + w.spare, 0),
    notEnoughCapacity: shortOfCapacity.length > 0,
    fairness: {
      nights: measure('night'),
      off: measure('off'),
      duties: measure('duties'),
      fridayOff: measure('fridayOff'),
      fridayAfternoon: measure('fridayAfternoon'),
      nonOfficial: measure('nonOfficial'),
    },
    perStaff: staff.map((s) => ({ id: s.id, name: s.name, senior: seniorIds.has(String(s.id)), ...totals[s.id] })),
  };
}