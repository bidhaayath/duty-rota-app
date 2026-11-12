/* ─────────────── Smart Roster: what the ward needs ───────────────
   Step 1 of the redesign: the shift cards, each person's week, what gives
   way first, and what may follow what. A new face on the settings already
   saved — every control reads and writes the very keys the old boxes did,
   through the same setRules, so a ward saved before this opens exactly as
   it was, and nothing is written until a number or a choice changes.

   The pure helpers are exported for the tests.                          */

import React, { useState } from "react";
import { Plus, X, ChevronDown, ChevronRight } from "lucide-react";
import { SHIFTS } from "./rosterEngine";
import { DEFAULT_RULES, LOOK_BACK_ALL } from "./rosterConfig";

const LABEL = { morning: "Morning", afternoon: "Afternoon", evening: "Evening", night: "Night" };
const upperFirst = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/* ── How strongly ──
   State and priority as one scale, strongest first. A rule with no saved
   entry is Must, because that is what the engine does with it. */
export const STRENGTH_SCALE = [
  { id: "must", label: "Must — never break", short: "Must", state: "hard", priority: 1, tint: "#E6F4F1" },
  { id: "soft1", label: "Protect most", short: "Protect most", state: "soft", priority: 1, tint: "#EAF3F5" },
  { id: "soft2", label: "Protect", short: "Protect", state: "soft", priority: 2, tint: "#F1F6F7" },
  { id: "soft3", label: "Bend if needed", short: "Bend if needed", state: "soft", priority: 3, tint: "#FFF7EA" },
  { id: "soft4", label: "Bend first", short: "Bend first", state: "soft", priority: 4, tint: "#FFF1DC" },
  { id: "ignore", label: "Ignore (off)", short: "Ignore", state: "disabled", priority: 1, tint: "#F1F4F5" },
];
// A soft priority outside 1–4 keeps its own id, so it is shown as it is.
export const scaleIdOf = (v) => {
  if (!v?.state || v.state === "hard") return "must";
  if (v.state === "disabled") return "ignore";
  return `soft${v.priority ?? 2}`;
};
/* Where a saved strength sits on the scale. A priority outside 1–4 sits
   where the engine puts it: above 4 gives way before Bend first, below 1
   holds after Protect most. */
export const levelOf = (v) => {
  const id = scaleIdOf(v);
  if (STRENGTH_SCALE.some((o) => o.id === id)) return id;
  return (v.priority ?? 2) > 4 ? "soft4" : "soft1";
};
const tintOf = (v) => STRENGTH_SCALE.find((o) => o.id === levelOf(v)).tint;

/* ── In a row ──
   One choice in place of the two old boxes, "In a row — fewest" and
   "In a row — most". A fewest that is empty or 1 asks for nothing, so it
   matches an option with no fewest; anything that matches no option is
   shown as it is, as Custom, and left alone. */
export const NO_LIMIT = 99;
export const IN_ROW = [
  { id: "any", label: "Any pattern", fewest: null, most: NO_LIMIT },
  { id: "never2", label: "Never 2 in a row", fewest: null, most: 1 },
  { id: "upto2", label: "Up to 2 in a row", fewest: null, most: 2 },
  { id: "pairs", label: "In pairs (2 together)", fewest: 2, most: 2 },
  { id: "two3", label: "2 or 3 together", fewest: 2, most: 3 },
  { id: "upto3", label: "Up to 3 in a row", fewest: null, most: 3 },
  { id: "upto4", label: "Up to 4 in a row", fewest: null, most: 4 },
];
const noFewest = (f) => f == null || f === 1;
const sameFewest = (saved, wanted) => (wanted == null ? noFewest(saved) : saved === wanted);
export const inRowOf = (fewest, most) =>
  IN_ROW.find((o) => sameFewest(fewest, o.fewest) && most === o.most) || null;
export const customInRow = (fewest, most) =>
  `Custom (fewest ${fewest == null ? "–" : fewest}, most ${most === NO_LIMIT ? "no limit" : most == null ? "–" : most})`;
/* What picking an option writes: only the box that actually changes, so a
   ward that never set a fewest is not handed one. Empty is saved as null,
   as the old box saved it. */
export const inRowPatch = (rules, sh, opt) => {
  const patch = {};
  if (!sameFewest(rules.blockTogether?.[sh], opt.fewest)) {
    patch.blockTogether = { ...rules.blockTogether, [sh]: opt.fewest };
  }
  if (rules.blockDays?.[sh] !== opt.most) patch.blockDays = { ...rules.blockDays, [sh]: opt.most };
  return patch;
};

/* ── What may follow what, as sentences ── */
const SEQ_WORD = { ...LABEL, off: "an off day" };
const SEQ_CATS = [...SHIFTS, "off"];
export const followText = (r) => {
  const a = SEQ_WORD[r.then] || r.then, b = SEQ_WORD[r.after] || r.after;
  const t = r.type === "never" ? `Never give ${a} after ${b}`
    : r.type === "must" ? `Always give ${a} after ${b}`
    : r.type === "prefer" ? `Prefer ${a} after ${b}`
    : r.type === "can" ? `${upperFirst(a)} may follow ${b}`
    : `${upperFirst(a)} after ${b}`;
  return r.enabled === false ? `${t} (switched off)` : t;
};

/* ── What usually gives way first ──
   Every rule with a strength, in the column of its saved level, weakest
   first. Only what is actually set: a shift with no most has nothing to
   bend. The Must column always holds what the engine never trades away. */
export const COLUMNS = ["soft4", "soft3", "soft2", "soft1", "must"];
/* What a strength never saved behaves as, and so what its box shows. Any
   of these, once saved, builds exactly as never saving it. */
export const ABSENT = {
  seniors: { state: "soft", priority: 1 },
  fairNights: { state: "soft", priority: 2 },
  fairNonOfficial: { state: "soft", priority: 2 },
};
// Strengths with no Must: a saved Must counts as Protect most.
const NO_MUST = ["fairNights", "fairNonOfficial"];

export function givesWay(rules, { termMany = "Seniors" } = {}) {
  const run = SHIFTS.filter((sh) => rules.coverage?.[sh]?.max !== 0);
  const asksSenior = run.some((sh) => (rules.coverage?.[sh]?.min || 0) > 0 && (rules.seniorCover?.[sh] || 0) > 0);
  const columns = Object.fromEntries(COLUMNS.map((c) => [c, []]));
  const off = [];
  const own = rules.personRules || [];
  if (own.some((r) => r && r.strength !== "hard")) columns.soft4.push("People's own Try rules");
  const entries = [
    ...run.filter((sh) => rules.weeklyMax?.[sh] != null).map((sh) => [`Most ${LABEL[sh]}s a week`, `weeklyCaps:${sh}`]),
    ...(rules.weeklyMin?.off != null ? [["Fewest off days", "offMin"]] : []),
    ...(rules.weeklyMax?.off != null ? [["Most off days", "offMax"]] : []),
    // Working days in a row is its own rule once it has a strength of its own.
    ...(rules.ruleStates?.daysInRow
      ? [["In a row, every shift", "workPattern"], ["Working days in a row", "daysInRow"]]
      : [["In a row, and working days in a row", "workPattern"]]),
    ...((rules.sequenceRules || []).length ? [["What may follow what", "sequence"]] : []),
    ...(asksSenior ? [[`${termMany} on every shift`, "seniors"]] : []),
    ...(run.includes("night") ? [["Sharing nights fairly", "fairNights"]] : []),
    ["Sharing non-official days fairly", "fairNonOfficial"],
  ];
  columns.must.push("Staff numbers");
  if (rules.weeklyDuties?.max != null) columns.must.push("Working days (most)");
  columns.must.push("Approved duty requests");
  if (own.some((r) => r && r.strength === "hard")) columns.must.push("People's own Must rules");
  entries.forEach(([text, key]) => {
    const raw = levelOf(rules.ruleStates?.[key] ?? ABSENT[key]);
    const level = raw === "must" && NO_MUST.includes(key) ? "soft1" : raw;
    (level === "ignore" ? off : columns[level]).push(text);
  });
  return { columns, off };
}

/* ── The pieces ── */
const fieldStyle = (T, editable) => ({
  fontFamily: "inherit", fontSize: 14, color: T.ink, border: `1px solid ${T.line}`, borderRadius: 10,
  padding: "9px 10px", minHeight: 44, background: "#fff", cursor: editable ? "pointer" : "not-allowed",
  width: "100%", minWidth: 0, maxWidth: "100%", boxSizing: "border-box", textOverflow: "ellipsis",
});

/* The strength box for one ruleStates key, tinted by its level. Only a real
   change is written; re-picking the same option saves nothing. */
/* `fallback` is what a key that has never been saved behaves as, and so
   what the box shows for it: picking that same level saves nothing, and
   saving it behaves exactly as not having saved it. */
export function StrengthSelect({ value, fallback, onPick, label, editable, T, noMust = false }) {
  // Fairness has no Must: one saved anyway is read, and shown, as Protect most.
  const saved = value ?? fallback;
  const shown = noMust && saved?.state === "hard" ? { state: "soft", priority: 1 } : saved;
  const cur = scaleIdOf(shown);
  const scale = noMust ? STRENGTH_SCALE.filter((o) => o.id !== "must") : STRENGTH_SCALE;
  const known = scale.some((o) => o.id === cur);
  return (
    <select aria-label={label} value={cur} disabled={!editable}
      onChange={(e) => {
        const pick = STRENGTH_SCALE.find((o) => o.id === e.target.value);
        if (!pick || pick.id === cur) return;
        onPick({ state: pick.state, priority: pick.priority });
      }}
      style={{ ...fieldStyle(T, editable), background: tintOf(shown) }}>
      {scale.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      {!known && <option value={cur}>Bend (P{shown?.priority})</option>}
    </select>
  );
}

/* − and + around a number. `none` describes what an empty saved value
   means: "No limit" above the top for a most, reached by + from the top
   when `reachable`; with no `none`, empty reads as the bottom number,
   which is what the engine makes of it. Only a change is reported. */
function Stepper({ label, value, onChange, min = 0, max = 99, none, editable, T }) {
  const top = !!none && value == null;
  const cur = value == null ? min : value;
  const down = top ? none.down : cur - 1;
  const canDown = top || cur > min;
  const canUp = !top && (cur < max || (!!none && none.reachable));
  const up = cur >= max ? null : cur + 1;
  const btn = (enabled) => ({
    width: 44, height: 44, borderRadius: 10, border: `1px solid ${T.line}`, background: "#fff",
    fontSize: 20, lineHeight: 1, color: enabled ? T.lagoon : "#B9C7C5", fontFamily: "inherit",
    cursor: enabled ? "pointer" : "not-allowed", flexShrink: 0,
  });
  const on = (ok) => editable && ok;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <button type="button" aria-label={`${label}: one fewer`} disabled={!on(canDown)} style={btn(on(canDown))}
        onClick={() => onChange(down)}>−</button>
      <output aria-label={label} style={{ minWidth: top ? 56 : 34, textAlign: "center", fontSize: top ? 13 : 17,
                                          fontWeight: 700, color: T.ink, whiteSpace: "nowrap" }}>
        {top ? none.text : cur}
      </output>
      <button type="button" aria-label={`${label}: one more`} disabled={!on(canUp)} style={btn(on(canUp))}
        onClick={() => onChange(up)}>+</button>
    </span>
  );
}

const sectionTitle = { fontFamily: "Sora, sans-serif", fontSize: 16, margin: 0 };
const caption = (T) => ({ fontSize: 12, fontWeight: 600, color: T.inkSoft });
const mustChip = {
  fontSize: 13, fontWeight: 700, color: "#0D4A3F", background: "#E6F4F1", border: "1px solid #B9DFD5",
  borderRadius: 10, padding: "9px 13px", maxWidth: "100%", boxSizing: "border-box",
};

/* ── The ward's own colours ──
   Each shift, and off days, in the colour of the duty code Smart Roster
   writes for it — the one chosen under "Which code to write", or else the
   first code that counts as it — so a row here looks like its cells on the
   rota grid. A code with no colour, and off days with no off code, are a
   neutral grey. */
export const NEUTRAL = "#B7C4C2";
const hex6 = (c) => {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(c || "").trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split("").map((x) => x + x).join("") : m[1];
  return `#${h.toUpperCase()}`;
};
export const colourFor = (rules, codes, cat) => {
  const list = codes || [];
  const code = list.find((c) => c.id === rules.codeFor?.[cat] && c.counts === cat)
    || list.find((c) => c.counts === cat);
  return hex6(code?.color) || NEUTRAL;
};
// WCAG relative luminance and contrast ratio.
const channel = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const lum = (c) => {
  const h = hex6(c);
  return 0.2126 * channel(parseInt(h.slice(1, 3), 16)) + 0.7152 * channel(parseInt(h.slice(3, 5), 16))
    + 0.0722 * channel(parseInt(h.slice(5, 7), 16));
};
export const contrast = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
/* The name on a coloured tag: the app's ink where it reads well enough, or
   else black or white, whichever reads better. One of black and white is
   always at least 4.58 : 1 against any colour. */
export const textOn = (bg, ink) => {
  if (ink && contrast(bg, ink) >= 4.5) return ink;
  return contrast(bg, "#000000") >= contrast(bg, "#FFFFFF") ? "#000000" : "#FFFFFF";
};
// A very light wash of the colour, for behind its row: one part colour to nine of white.
export const tintOf10 = (c) => {
  const h = hex6(c) || NEUTRAL;
  const mix = (i) => Math.round(parseInt(h.slice(i, i + 2), 16) * 0.1 + 255 * 0.9).toString(16).padStart(2, "0");
  return `#${mix(1)}${mix(3)}${mix(5)}`.toUpperCase();
};
const swatch = (colour) => ({
  width: 14, height: 14, borderRadius: 4, background: colour, display: "inline-block", flexShrink: 0,
  boxShadow: "inset 0 0 0 1px rgba(20,43,51,0.18)",
});

/* ── Who's needed on each shift ──
   A card for every shift the ward has a duty code for, and for any shift
   with a number saved. A shift saved as 0 and 0 is not run: it is one
   quiet line, and "Turn on" only shows its card — nothing is written until
   a number changes. */
export function ShiftNeeds({ rules, setRules, editable, T, Card, codes, termMany, children }) {
  const [turnedOn, setTurnedOn] = useState([]);
  // Set to Ignore: the numbers stay saved, but nothing asks for them.
  const seniorsOff = rules.ruleStates?.seniors?.state === "disabled";
  const cov = (sh) => rules.coverage?.[sh] || {};
  const notRun = (sh) => (cov(sh).min || 0) === 0 && cov(sh).max === 0;
  const shown = SHIFTS.filter((sh) => (codes || []).some((c) => c.counts === sh) || !notRun(sh));
  const cards = shown.filter((sh) => !notRun(sh) || turnedOn.includes(sh));
  const quiet = shown.filter((sh) => notRun(sh) && !turnedOn.includes(sh));

  // The same writes as the old boxes: a number, and the in-charge never below 0.
  const setCoverage = (sh, key, n) =>
    setRules({ coverage: { ...rules.coverage, [sh]: { ...rules.coverage[sh], [key]: n } } });
  const setSeniorCover = (sh, n) =>
    setRules({ seniorCover: { ...rules.seniorCover, [sh]: Math.max(0, n || 0) } });

  const row = (text, stepper) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
      <span style={{ fontSize: 14 }}>{text}</span>{stepper}
    </div>
  );
  return (
    <Card>
      <h3 style={sectionTitle}>Who's needed on each shift</h3>
      <p style={{ fontSize: 13, color: T.inkSoft, margin: "4px 0 14px", lineHeight: 1.6 }}>
        Every day, Smart Roster puts this many people on each shift. Covering every shift comes
        before every other rule.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 12 }}>
        {cards.map((sh) => (
          <div key={sh} style={{ border: `1px solid ${T.line}`, borderRadius: 14, padding: 14, display: "grid", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={swatch(colourFor(rules, codes, sh))} />
              <strong style={{ fontSize: 15 }}>{LABEL[sh]}</strong>
            </div>
            {row("At least", (
              <Stepper label={`${LABEL[sh]}: at least`} value={cov(sh).min} editable={editable} T={T}
                onChange={(n) => setCoverage(sh, "min", n)} />
            ))}
            {row("At most", (
              <Stepper label={`${LABEL[sh]}: at most`} value={cov(sh).max} editable={editable} T={T}
                none={{ text: "No limit", down: Math.max(1, cov(sh).min || 0), reachable: false }}
                onChange={(n) => setCoverage(sh, "max", n)} />
            ))}
            {row(`${termMany}, at least`, (
              <Stepper label={`${LABEL[sh]}: ${termMany.toLowerCase()}, at least`} value={rules.seniorCover?.[sh] ?? 0}
                max={9} editable={editable && !seniorsOff && (cov(sh).min || 0) > 0} T={T}
                onChange={(n) => setSeniorCover(sh, n)} />
            ))}
          </div>
        ))}
      </div>
      {quiet.map((sh) => (
        <div key={sh} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 10,
                               fontSize: 13.5, color: T.inkSoft }}>
          <span style={swatch(colourFor(rules, codes, sh))} />
          <span style={{ flex: "1 1 200px" }}>{LABEL[sh]}: not run on this ward.</span>
          <button type="button" disabled={!editable} onClick={() => setTurnedOn([...turnedOn, sh])}
            style={{ background: "none", border: "none", color: T.lagoon, fontFamily: "inherit", fontSize: 14,
                     fontWeight: 700, minHeight: 44, padding: "0 6px", cursor: editable ? "pointer" : "not-allowed" }}>
            Turn on {LABEL[sh]}
          </button>
        </div>
      ))}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 16px", marginTop: 14,
                    paddingTop: 12, borderTop: `1px solid ${T.line}` }}>
        <span style={{ fontSize: 14, flex: "1 1 240px" }}>Staff numbers (at least / at most)</span>
        <span style={mustChip}>Must — always</span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 16px", marginTop: 10 }}>
        <span style={{ fontSize: 14, flex: "1 1 240px", minWidth: 0 }}>{termMany} on every shift</span>
        <span style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", flex: "1 1 190px", minWidth: 0, maxWidth: 260 }}>
          <StrengthSelect label={`${termMany} on every shift: if it can't all fit`} value={rules.ruleStates?.seniors}
            fallback={ABSENT.seniors} editable={editable} T={T}
            onPick={(v) => setRules({ ruleStates: { ...rules.ruleStates, seniors: v } })} />
        </span>
      </div>
      {seniorsOff && (
        <p style={{ fontSize: 12.5, color: T.inkSoft, margin: "6px 0 0" }}>
          Switched off: no {termMany.toLowerCase()} asked for on any shift.
        </p>
      )}
      {!seniorsOff && children}
    </Card>
  );
}

/* ── Each person, each week ── */
const LOOK_BACK = [
  [LOOK_BACK_ALL, "The entire roster"], [90, "Last 90 days"], [60, "Last 60 days"],
  [30, "Last 30 days"], [14, "Last 14 days"], [0, "Do not look back"],
];
const lookBackHint = (days) => {
  if (!days) return "Fair shares count only the week being made. Rest after last week's duties is still checked.";
  if (days >= LOOK_BACK_ALL) return "Fair shares count every duty since the roster began. Rest after last week's duties is always checked.";
  return `Fair shares count duties from the last ${days} days, so someone who did a lot of nights recently gets fewer. Rest after last week's duties is always checked.`;
};

export function PersonWeek({ rules, setRules, dropRule, editable, T, Card, codes }) {
  const run = SHIFTS.filter((sh) => rules.coverage?.[sh]?.max !== 0);
  // The shift the "at least" hint is said with: Night where the ward runs it.
  const example = run.includes("night") ? "night" : (run[0] || "night");
  const field = fieldStyle(T, editable);
  const setIn = (group, key, n) => setRules({ [group]: { ...rules[group], [key]: n } });
  // Fairness the ward can set the strength of: nights only where it runs them.
  const fairRows = [
    ...(run.includes("night") ? [["fairNights", "Share nights fairly"]] : []),
    ["fairNonOfficial", "Share non-official days (Fridays and holidays) fairly"],
  ];
  const strength = (key, label, fallback) => (
    <StrengthSelect label={label} value={rules.ruleStates?.[key]} fallback={fallback} editable={editable} T={T}
      onPick={(v) => setRules({ ruleStates: { ...rules.ruleStates, [key]: v } })} />
  );
  const most = { text: "No limit", down: 7, reachable: true };
  /* A number keeps its own width and moves to the next line when there is
     no room for it; a box takes the room there is and can narrow to fit, so
     nothing in a row is ever wider than the card. */
  const cell = (text, child, basis) => (
    <div style={basis
      ? { display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 4, flex: `1 1 ${basis}`, minWidth: 0 }
      : { display: "grid", gap: 4, flex: "0 0 auto" }}>
      <span style={caption(T)}>{text}</span>{child}
    </div>
  );

  const inRow = (sh) => {
    const fewest = rules.blockTogether?.[sh], longest = rules.blockDays?.[sh];
    const match = inRowOf(fewest, longest);
    const box = (
      <select aria-label={`${LABEL[sh]}: in a row`} value={match ? match.id : "custom"} disabled={!editable} style={field}
        onChange={(e) => {
          const opt = IN_ROW.find((o) => o.id === e.target.value);
          if (!opt) return;                          // Custom again: nothing to write
          const patch = inRowPatch(rules, sh, opt);
          if (Object.keys(patch).length) setRules(patch);
        }}>
        {IN_ROW.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        {!match && <option value="custom">{customInRow(fewest, longest)}</option>}
      </select>
    );
    // Only where a choice keeps a shift together does it need saying what that means.
    const together = match && (match.id === "pairs" || match.id === "two3");
    return together ? (
      <>
        {box}
        <span style={{ fontSize: 12, color: T.inkSoft, lineHeight: 1.45 }}>
          Two side by side; a single one is still fine, so everyone gets one.
        </span>
      </>
    ) : box;
  };
  /* Each row in its duty code's colour: the name on a tag of that colour,
     and a light wash of it behind the row. */
  const personRow = (key, name, colour, cells) => (
    <div key={key} data-colour={colour}
      style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: "10px 14px",
               padding: 12, marginTop: 8, borderRadius: 12, background: tintOf10(colour) }}>
      <span style={{ flex: "1 1 100%" }}>
        <strong data-tag style={{ display: "inline-block", fontSize: 14, borderRadius: 999, padding: "4px 12px",
                                  background: colour, color: textOn(colour, T.ink) }}>{name}</strong>
      </span>
      {cells}
    </div>
  );

  const work = rules.weeklyDuties || {};
  const oneNumber = work.min != null && work.min === work.max;
  return (
    <Card>
      <h3 style={sectionTitle}>Each person, each week</h3>
      <p style={{ fontSize: 13, color: T.inkSoft, margin: "4px 0 6px", lineHeight: 1.6 }}>
        What each person gets in a week. Everyone follows this unless they have their own rule.
      </p>
      {/* Said once for the whole table, with a shift the ward runs. */}
      <p style={{ fontSize: 12.5, color: T.inkSoft, margin: "0 0 2px", lineHeight: 1.5 }}>
        At least 1 {LABEL[example]} = everyone gets {/^[AEIOU]/.test(LABEL[example]) ? "an" : "a"} {LABEL[example]} every week.
      </p>
      {run.map((sh) => personRow(sh, LABEL[sh], colourFor(rules, codes, sh), <>
        {cell("At least", <Stepper label={`Each person: ${LABEL[sh]}, at least`} value={rules.weeklyMin?.[sh]}
          max={7} editable={editable} T={T} onChange={(n) => setIn("weeklyMin", sh, n)} />)}
        {cell("At most", <Stepper label={`Each person: ${LABEL[sh]}, at most`} value={rules.weeklyMax?.[sh]}
          max={7} none={most} editable={editable} T={T} onChange={(n) => setIn("weeklyMax", sh, n)} />)}
        {cell("In a row", inRow(sh), "180px")}
        {cell("If it can't all fit", strength(`weeklyCaps:${sh}`, `${LABEL[sh]}: if it can't all fit`), "170px")}
      </>))}
      {personRow("off", "Off days", colourFor(rules, codes, "off"), <>
        {cell("At least", <Stepper label="Each person: off days, at least" value={rules.weeklyMin?.off}
          max={7} editable={editable} T={T} onChange={(n) => setIn("weeklyMin", "off", n)} />)}
        {cell("At most", <Stepper label="Each person: off days, at most" value={rules.weeklyMax?.off}
          max={7} none={most} editable={editable} T={T} onChange={(n) => setIn("weeklyMax", "off", n)} />)}
        {cell("In a row", <>
          {/* Spread apart is how it always was: choosing it again takes the setting away. */}
          <select aria-label="Off days: in a row" value={rules.singleOffDays === false ? "together" : "apart"}
            disabled={!editable} style={field}
            onChange={(e) => {
              if (e.target.value === "together") setRules({ singleOffDays: false });
              else if ("singleOffDays" in rules) dropRule("singleOffDays");
            }}>
            <option value="apart">Spread apart</option>
            <option value="together">Together is fine</option>
          </select>
          {rules.singleOffDays !== false && rules.ruleStates?.workPattern?.state === "disabled" && (
            <span style={{ fontSize: 12, color: T.inkSoft, lineHeight: 1.45 }}>
              In a row, every shift is set to Ignore, so off days are not kept apart.
            </span>
          )}
        </>, "180px")}
        {cell("If it can't all fit", strength("offMin", "Off days: if it can't all fit"), "170px")}
      </>)}
      <p style={{ fontSize: 12.5, color: T.inkSoft, margin: "4px 0 0", lineHeight: 1.6 }}>
        The box for off days covers "at least". The most off days is always held.
      </p>

      <div style={{ marginTop: 14, borderTop: `1px solid ${T.line}` }}>
        {/* One strength for In a row on every shift: the working pattern. */}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 16px", padding: "12px 0",
                      borderBottom: `1px solid ${T.line}` }}>
          <span style={{ fontSize: 15, flex: "1 1 200px", minWidth: 0 }}>In a row, every shift</span>
          <span style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 4, flex: "1 1 190px", minWidth: 0, maxWidth: 260 }}>
            {strength("workPattern", "In a row, every shift: if it can't all fit")}
            <span style={{ fontSize: 12, color: T.inkSoft }}>Ignore also stops keeping off days apart.</span>
          </span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 16px", padding: "12px 0",
                      borderBottom: `1px solid ${T.line}` }}>
          <span style={{ fontSize: 15, flex: "1 1 200px", minWidth: 0 }}>
            Working days{!oneNumber && <span style={{ color: T.inkSoft }}> — Custom</span>}
          </span>
          {oneNumber ? (
            <Stepper label="Working days" value={work.min} max={7} editable={editable} T={T}
              onChange={(n) => setRules({ weeklyDuties: { ...rules.weeklyDuties, min: n, max: n } })} />
          ) : (
            <span style={{ display: "inline-flex", flexWrap: "wrap", gap: "6px 14px", alignItems: "center", maxWidth: "100%" }}>
              {/* Each word stays with its number when the row wraps. */}
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <span style={caption(T)}>fewest</span>
                <Stepper label="Working days, fewest" value={work.min} max={7} editable={editable} T={T}
                  onChange={(n) => setIn("weeklyDuties", "min", n)} />
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <span style={caption(T)}>most</span>
                <Stepper label="Working days, most" value={work.max} max={7} none={most} editable={editable} T={T}
                  onChange={(n) => setIn("weeklyDuties", "max", n)} />
              </span>
            </span>
          )}
          <span style={mustChip}>Must</span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 16px", padding: "12px 0",
                      borderBottom: `1px solid ${T.line}` }}>
          <span style={{ fontSize: 15, flex: "1 1 200px", minWidth: 0 }}>Working days in a row, at most</span>
          <Stepper label="Working days in a row, at most" value={rules.maxDaysOn ?? 5} min={1} max={6}
            editable={editable} T={T} onChange={(n) => setRules({ maxDaysOn: n })} />
          <span style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 4, flex: "1 1 190px", minWidth: 0, maxWidth: 260 }}>
            {/* Never saved: it is the working pattern's, and says so. */}
            {strength("daysInRow", "Working days in a row: if it can't all fit", rules.ruleStates?.workPattern)}
            {!rules.ruleStates?.daysInRow && (
              <span style={{ fontSize: 12, color: T.inkSoft }}>Follows In a row until you change it.</span>
            )}
          </span>
        </div>
        {fairRows.map(([key, text]) => (
          <div key={key} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 16px", padding: "12px 0",
                                  borderBottom: `1px solid ${T.line}` }}>
            <span style={{ fontSize: 15, flex: "1 1 260px", minWidth: 0 }}>{text}</span>
            <span style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", flex: "1 1 190px", minWidth: 0, maxWidth: 260 }}>
              <StrengthSelect label={`${text}: if it can't all fit`} value={rules.ruleStates?.[key]} fallback={ABSENT[key]}
                noMust editable={editable} T={T}
                onPick={(v) => setRules({ ruleStates: { ...rules.ruleStates, [key]: v } })} />
            </span>
          </div>
        ))}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 16px", padding: "12px 0" }}>
          <label htmlFor="sr-lookback" style={{ display: "grid", gap: 2, flex: "1 1 260px", minWidth: 0 }}>
            <span style={{ fontSize: 15 }}>Look back at past duties</span>
            <span style={{ fontSize: 12.5, color: T.inkSoft, lineHeight: 1.5 }}>{lookBackHint(rules.lookbackDays)}</span>
          </label>
          <select id="sr-lookback" value={rules.lookbackDays || 0} disabled={!editable}
            style={{ ...field, width: "auto", minWidth: "min(180px, 100%)", flex: "0 1 auto" }}
            onChange={(e) => setRules({ lookbackDays: Number(e.target.value) })}>
            {LOOK_BACK.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
            {/* A saved number not on the list is shown as it is, and kept. */}
            {Number.isFinite(rules.lookbackDays) && !LOOK_BACK.some(([v]) => v === rules.lookbackDays) && (
              <option value={rules.lookbackDays}>Custom ({rules.lookbackDays} days)</option>
            )}
          </select>
        </div>
      </div>
    </Card>
  );
}

/* ── When it can't all fit ── */
const COLUMN_HINT = {
  soft4: "Bent before anything else", soft3: "Bent when needed", soft2: "Kept unless it would leave a gap",
  soft1: "Bent only as a last resort", must: "Always kept, even if a shift goes short",
};
export function GivesWay({ rules, T, Card, termMany }) {
  const { columns, off } = givesWay(rules, { termMany });
  return (
    <Card>
      <h3 style={sectionTitle}>When it can't all fit, what usually gives way first</h3>
      <p style={{ fontSize: 13, color: T.inkSoft, margin: "4px 0 14px", lineHeight: 1.6 }}>
        Some weeks there aren't enough people for every rule. Smart Roster usually bends them from left
        to right, and only as much as it has to. Covering every shift comes before everything except Must.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
        {COLUMNS.map((c) => {
          const level = STRENGTH_SCALE.find((o) => o.id === c);
          return (
            <section key={c} aria-label={level.short}
              style={{ borderRadius: 12, padding: 12, border: `1px solid ${T.line}`, background: level.tint, display: "grid", gap: 4, alignContent: "start" }}>
              <strong style={{ fontSize: 14 }}>{level.short}</strong>
              <span style={{ fontSize: 12, color: T.inkSoft }}>{COLUMN_HINT[c]}</span>
              {columns[c].map((t) => (
                <span key={t} style={{ fontSize: 13, background: "#fff", border: `1px solid ${T.line}`, borderRadius: 8, padding: "4px 8px" }}>{t}</span>
              ))}
              {!columns[c].length && <span style={{ fontSize: 12.5, color: T.inkSoft }}>Nothing here</span>}
            </section>
          );
        })}
      </div>
      {off.length > 0 && (
        <p style={{ fontSize: 13, color: T.inkSoft, margin: "12px 0 0" }}>Switched off: {off.join(", ")}.</p>
      )}
      <p style={{ fontSize: 13, color: T.inkSoft, margin: "8px 0 0" }}>
        Always aimed for, but not promised: fewest of each shift, fewest working days.
      </p>
    </Card>
  );
}

/* ── What may follow what ──
   Collapsed by default. Each rule is a sentence with a remove button; new
   ones are put together below and added whole. An identical rule is not
   added twice. */
export function FollowRules({ rules, setRules, editable, T, Card, Btn, uid }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ type: "never", then: "morning", after: "night" });
  const list = rules.sequenceRules || [];
  const field = { ...fieldStyle(T, editable), width: "auto" };
  const level = STRENGTH_SCALE.find((o) => o.id === levelOf(rules.ruleStates?.sequence));
  const twin = list.some((r) => r.type === draft.type && r.then === draft.then && r.after === draft.after);
  return (
    <Card style={{ padding: open ? 18 : "6px 18px" }}>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}
        style={{ width: "100%", background: "none", border: "none", padding: 0, minHeight: 44, cursor: "pointer",
                 fontFamily: "inherit", display: "flex", alignItems: "center", gap: 6, color: T.ink, textAlign: "left" }}>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <span style={{ fontSize: 15, fontWeight: 700 }}>What may follow what</span>
        <span style={{ fontSize: 13, color: T.inkSoft }}>
          · {list.length} rule{list.length === 1 ? "" : "s"} · {level.short}
        </span>
      </button>
      {open && (
        <div style={{ display: "grid", gap: 4, marginTop: 8 }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 16px", paddingBottom: 8 }}>
            <span style={{ fontSize: 13, color: T.inkSoft, flex: "1 1 260px" }}>
              From one day to the next. Already set to the usual rules.
            </span>
            <span style={{ flex: "0 1 220px" }}>
              <StrengthSelect label="What may follow what: if it can't all fit" value={rules.ruleStates?.sequence}
                editable={editable} T={T}
                onPick={(v) => setRules({ ruleStates: { ...rules.ruleStates, sequence: v } })} />
            </span>
          </div>
          {list.map((r) => (
            <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 8, borderTop: `1px solid ${T.line}` }}>
              <span style={{ flex: 1, fontSize: 14 }}>{followText(r)}</span>
              <button type="button" aria-label={`Remove: ${followText(r)}`} disabled={!editable}
                onClick={() => setRules({ sequenceRules: list.filter((x) => x.id !== r.id) })}
                style={{ width: 44, height: 44, background: "none", border: "none", color: T.inkSoft,
                         cursor: editable ? "pointer" : "not-allowed", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <X size={18} />
              </button>
            </div>
          ))}
          {!list.length && <span style={{ fontSize: 13, color: T.inkSoft, padding: "8px 0" }}>No rules yet.</span>}
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, paddingTop: 10, borderTop: `1px solid ${T.line}` }}>
            <select aria-label="Never or always" value={draft.type} disabled={!editable} style={field}
              onChange={(e) => setDraft({ ...draft, type: e.target.value })}>
              <option value="never">Never give</option>
              <option value="must">Always give</option>
            </select>
            <select aria-label="This duty" value={draft.then} disabled={!editable} style={field}
              onChange={(e) => setDraft({ ...draft, then: e.target.value })}>
              {SEQ_CATS.map((c) => <option key={c} value={c}>{upperFirst(SEQ_WORD[c])}</option>)}
            </select>
            <span style={{ fontSize: 14 }}>after</span>
            <select aria-label="After this duty" value={draft.after} disabled={!editable} style={field}
              onChange={(e) => setDraft({ ...draft, after: e.target.value })}>
              {SEQ_CATS.map((c) => <option key={c} value={c}>{upperFirst(SEQ_WORD[c])}</option>)}
            </select>
            <Btn disabled={!editable || twin} style={{ minHeight: 44 }}
              onClick={() => setRules({ sequenceRules: [...list, { id: uid(), type: draft.type, after: draft.after, then: draft.then }] })}>
              <Plus size={15} /> Add
            </Btn>
            <Btn kind="ghost" disabled={!editable} style={{ minHeight: 44 }}
              onClick={() => setRules({ sequenceRules: DEFAULT_RULES.sequenceRules })}>
              Reset to the usual rules
            </Btn>
          </div>
          {twin && <span style={{ fontSize: 12.5, color: T.inkSoft }}>That rule is already on the list.</span>}
        </div>
      )}
    </Card>
  );
}
