/* ─────────────── How the rota counts ───────────────
   The rota screen's own counting rules, moved here unchanged from
   DutyRotaOriginal.js so Ini's month preview counts exactly the same way.
   DutyRotaOriginal.js imports everything below back under the same names;
   rotaCounts.test.js holds a frozen copy of the original code and proves
   the two agree.                                                         */

export const FRIDAY = 5;
export const DUTY_CATS = ["morning", "afternoon", "evening", "night", "other", "release"];
const parseD = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };

/* ─────────────────── Data helpers ─────────────────── */
export const isNonOff = (data, date) =>
  (data.fridayRule && parseD(date).getDay() === FRIDAY) || data.nonOfficial.includes(date);
// All leave periods (annual, maternity, pre-maternity, emergency, other) count
// calendar days: every day inside the period counts, including Fridays,
// Saturdays, and non-official days.
export const leaveOn = (staff, date) => (staff.leavePeriods || []).find((p) => date >= p.start && date <= p.end) || null;
export const codeByIdOf = (data) => (id) => data.codes.find((c) => c.id === id);

/* ── What a cell can hold ────────────────────────────────────────────
   Historically a cell was one duty code id:
       cells[date][staffId] = "abc123"
   To support a post alongside a duty, and two duties on one day (resort,
   guesthouse and security rotas), it may also be a list:
       cells[date][staffId] = [{ code: "abc", post: "p1" },
                                { code: "xyz", post: "p2" }]

   `post` holds the POST ID from data.posts, never the post name. Storing the
   id means renaming a post updates every rota that used it; storing the name
   would leave last month reading "Front Gate" after it became "Main Gate",
   which looks like a bug and cannot be corrected afterwards.

   BOTH SHAPES STAY VALID FOREVER. Existing rotas are never migrated —
   rewriting 800 accounts' saved data is exactly the kind of operation
   that loses someone's roster. Instead every reader goes through
   entriesOf() below, so a plain string and a list behave identically.

   COUNTING RULES, decided with the shift rules in mind:
     - Anything measuring COVERAGE counts duties. Two duties in a day
       means the unit was covered twice, so both count.
     - Anything measuring a PERSON counts days. Working a split duty is
       still one day worked, so "days on duty" and non-official day
       payment count the date once, however many duties are in it.        */
export const entriesOf = (raw) => {
  if (!raw) return [];
  if (typeof raw === "string") return [{ code: raw, post: "" }];
  if (Array.isArray(raw)) {
    return raw.filter((e) => e && e.code)
              .map((e) => ({ code: e.code, post: e.post || "" }));
  }
  return [];
};
export const cellEntries = (data, date, staffId) => entriesOf((data.cells?.[date] || {})[staffId]);

/* ── Employment window (start/end dates are INCLUSIVE) ────────────────
   startDate empty = always employed from the beginning.
   endDate   empty = still employed (active staff).                     */
export const isEmployedOn = (staff, date) => {
  if (staff.startDate && date < staff.startDate) return false;
  if (staff.endDate && date > staff.endDate) return false;
  return true;
};

export const weekTotalsFor = (data, staff, days) => {
  const codeById = codeByIdOf(data);
  const t = { morning: 0, afternoon: 0, evening: 0, night: 0, other: 0, release: 0, off: 0, nonOfficialDuty: 0 };
  days.forEach((date) => {
    if (!isEmployedOn(staff, date)) return;
    if (leaveOn(staff, date)) return;
    const codes = cellEntries(data, date, staff.id).map((e) => codeById(e.code)).filter(Boolean);
    if (!codes.length) return;
    // Shift columns count each duty: a split day adds to M and to E.
    codes.forEach((code) => { if (code.counts in t) t[code.counts]++; });
    // Non-official day payment counts the DAY, once, however many duties.
    if (isNonOff(data, date) && codes.some((c) => DUTY_CATS.includes(c.counts))) t.nonOfficialDuty++;
  });
  return t;
};
// Unit coverage counts exclude release duty (staff is on duty elsewhere).
// Historical accuracy: counts whoever was EMPLOYED on that date, so past
// weeks keep the correct coverage even after someone leaves.
export const dayCountFor = (data, date, cat) => {
  const codeById = codeByIdOf(data);
  return data.staff.reduce((a, s) => {
    if (!isEmployedOn(s, date)) return a;
    if (leaveOn(s, date)) return a;
    // Coverage counts duties, so someone doing M and E appears in both.
    const n = cellEntries(data, date, s.id)
      .map((e) => codeById(e.code))
      .filter((code) => code?.counts === cat).length;
    return a + n;
  }, 0);
};
