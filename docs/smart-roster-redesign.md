# Smart Roster redesign — design brief

Agreed with Bidhoo on 11–12 November 2026. Source mockup: Claude Design artifact "Smart Roster — simple 3-step design" (the HTML is saved next to this file as `smart-roster-mockup.dc.html` for reference only; it is not app code).

## Goal

A ward manager who has never seen Smart Roster can set it up and make a fair roster without training. Same engine, same saved settings — this is a new screen over what already exists.

## Ground rules

- **No data migration.** Every control reads and writes the settings already stored in `rosterRules` / staff exceptions / `personRules`. A department saved before the redesign must open with every value showing correctly, and saving without changes must write identical data.
- **No engine changes**, except where a stage says so.
- `DEFAULT_RULES`, `mergeRules` and `rosterConfig.test.js` stay untouched.
- One stage per branch, with localhost testing in the imaduddin.edu.mv Emergency Room only.
- Use the ward's own word for the person in charge everywhere (today's "What this ward calls them" setting).
- Touch targets at least 44px; works at phone width.
- **No queries on the live database** to find unusual saved values. Any saved value that matches none of a control's options is shown as **"Custom (…)"**, kept unchanged, and only replaced when the manager picks another option.
- A new stored key means "today's behaviour" when absent, and is passed to the engine only when present, so `rosterConfig.test.js` keeps passing untouched.

## Layout: three steps

A row of three step buttons at the top, always clickable: **1 Ward needs** · **2 Your staff** · **3 Make the roster**. Each shows a one-line status ("Needs a fix" / "Done", "15 on the roster", "Pick a week"). An **Ask Ini** bar sits above the steps on every step.

## Step 1 — Ward needs

### Live check banner (top of step 1)
Recomputed on every change. Green "These settings fit your N staff" or amber with a plain-numbers reason. Checks, in order:
1. A row's "at least" above its "at most".
2. A shift set to "In pairs" / "2 or 3 together" with "at most" below 2.
3. Per-person minimums (Morning + Afternoon + Night [+ Evening]) above working days.
4. Per-person maximums too low to fill working days.
5. Working days and off days not adding to 7.
6. Staff × working days above what the shifts can hold (sum of shift maximums × 7) — offer **Fix it for me** (raise the shift maximum with the most room by 1).
7. Staff × working days below what the shifts need (sum of shift minimums × 7).
N = staff not skipped. Show only the first problem found.

### "Who's needed on each shift"
One card per shift the ward uses (Morning, Afternoon, Evening, Night — from the ward's duty codes). Each card: **At least**, **At most**, **[In-charge word]s, at least** — each with − / + buttons, not empty boxes. Below the cards: "Staff numbers — **Must — always**" (fixed label) and "[In-charge word]s on every shift" with a strength box. The in-charge strength box has no engine support yet (stage 2b); until then it is not shown.

### "Each person, each week"
A table, one row per shift plus **Off days**:

| Each person gets | At least | At most | In a row | If it can't all fit |
|---|---|---|---|---|

- At least / At most → the existing Fewest / Most per shift.
- **In a row** is a dropdown that writes the existing "In a row — fewest" and "In a row — most":
  - Any pattern → fewest unset, most 99 (No limit)
  - Never 2 in a row → most 1
  - Up to 2 in a row → most 2 (today's Night default)
  - In pairs (2 together) → fewest 2, most 2
  - 2 or 3 together → fewest 2, most 3
  - Up to 3 in a row → most 3
  - Up to 4 in a row → most 4
  - When matching, fewest null / missing / 1 counts as unset and most 99 as no limit, but those values are never rewritten just by showing them.
  - Saved values that match none of these show as **"Custom (fewest X, most Y)"** (– for unset) and are kept unchanged unless the manager picks another option; picking Custom again writes nothing.
- The row's "If it can't all fit" box is `ruleStates["weeklyCaps:<shift>"]` and governs **At most** only. At least is always a goal; In a row follows the working-pattern strength.
- Off days row: At least / At most are `weeklyMin.off` / `weeklyMax.off`; its "If it can't all fit" box is `ruleStates.offMin` (At least). The off-day maximum stays Must and is not shown.
- Off days In a row: **Spread apart** (today's default behaviour) · **Together is fine** · **Always together**. Only "Spread apart" is offered today. "Together is fine" exists in the engine already (`singleOffDays: false`) and only needs a stored key passed through (stage 2b). "Always together" is new engine behaviour (stage 8).
- Under the table:
  - **Working days** (− / +) with a fixed **"Must"** label, no strength box. It writes `weeklyDuties.min` and `.max` together; a saved pair that differs shows as **"Custom (fewest X, most Y)"**. The maximum stays unbendable — it is hard throughout the engine and making it bendable is out of scope.
  - **Working days in a row, at most** (− / +, `maxDaysOn`, 1–6) with a strength box. Today that strength is `ruleStates.workPattern`, shared with every shift's In a row and with spreading off days, so until stage 2b the box says it also covers In a row.
  - **Share nights fairly** and **Share non-official days (Fridays and holidays) fairly**: strength box offering **Protect most to Ignore only — no Must** (Ignore = off). No engine support yet (stage 2b); not shown until then.
  - **Look back at past duties**: The entire roster · Last 90 / 60 / 30 / 14 days · Don't look back, with a one-line explanation under it. Stored in `lookbackDays`: "The entire roster" is `36500` (`LOOK_BACK_ALL`), a plain number that older code reads as a very long look-back; Don't look back is `0`; any other saved number shows as **"Custom (N days)"**. Look-back only affects fairness; rest and "what may follow what" always check the 14 days before the week regardless (stage 0).

### Strength ("If it can't all fit")
Every ward rule gets the existing six-level scale: **Must — never break · Protect most · Protect · Bend if needed · Bend first · Ignore (off)**. The box is lightly tinted by level.

### "When it can't all fit, what usually gives way first"
Five columns, left to right: Bend first → Bend if needed → Protect → Protect most → Must. The title says **"Usually gives way first"**, not a strict order: the levels decide what gives way in the first build, but the later rearranging pass prices every Try level the same. That pricing is **not** to be changed. Each column lists the rules currently at that level, live. The Must column always also lists **Staff numbers**, **Working days**, **Approved duty requests** and **Duties you fixed**.

### "What may follow what" (collapsed by default)
Header shows "N rules · [level]". Inside: rules as sentences ("Never give Morning after Night", "Always give an off day after Night") with a remove button; the existing builder (Never/Always give · duty · after · duty · Add); **Reset to the usual rules**; one strength box for the group.

## Step 2 — Your staff

One list of every staff member. Each row:
- Name, and small labels under it: shift ticks ("Morning & Afternoon only"), personal rules (grey), **approved duty requests (blue)**, **duties fixed by the manager (purple)**.
- Shift chips (tick only if they never do the others; no ticks = any shift), the **[In-charge word]** tick, **Skip** (row greys out).
- **+ Rule** / **Rules (N)** / **Close** button opening an inline panel under the row.

Above the list: "This ward calls the person in charge [ ]" and a one-line key for ticks, Skip, blue and purple labels. Note: "Staff on recorded leave are skipped automatically for those days."

### Inline rule panel
- Current rules as sentences, each with a **Must / Try** switch and remove. Fixed duties show **"Always kept"** instead of the switch.
- **Add a rule** dropdown with seven types; only the fields that type needs appear:
  1. At most … of a shift a week (number, shift) — starts Try
  2. At least … of a shift a week (number, shift) — starts Try
  3. **Gap between shifts: at least … days** (number, shift) — starts Try. Worded differently from "at least … a week" on purpose: Bidhoo mixed them up in testing.
  4. A shift in pairs (shift) — starts Try
  5. Always off on … (seven day chips, ward's week order, no Weekend shortcut — customers have different weekends) — starts Must
  6. On … only … (day chips + shift chips) — starts Try
  7. **Fixed duty on a date (set by you)** (date, duty incl. Off) — always kept, like an approved request. **Needs engine work** (stage 4): stored as `rosterRules.fixedDuties` (`{ id, staffId, date, category }`, removed when empty), added to the engine's `requests` with `source: "manager"` only when there are any, so it reuses the approved-request path (hard in the builder, never moved by polish or repair; Ini's month build gets it too). Engine messages that say "approved request" follow the source. The panel refuses a fixed duty that clashes with an approved request that day, leave, Skip, a shift the person isn't ticked for, or an "Always off" Must.
- Live preview: "[Name]: At most 1 Night a week — starts as Try". **Add rule** greyed out until complete or if it clashes; existing refusals from stages 1–2 apply.
- A note when the person has requests: "Blue labels are approved duty requests. Change them in the Duty requests tab."

## Step 3 — Make the roster

- Week picker and one big **Make the roster** button.
- **Ready checklist** before generating: ward needs fit (or a link back to step 1), enough [In-charge word]s on the roster, staff on the roster / skipped, approved duty requests this week — always kept (Must), "what may follow what" rules, look-back period.
- Result: a one-line summary ("All Must rules met, every shift covered…"), then **What had to give**, each item with person/shift, rule, strength and plain reason. Red box for gaps caused by personal Musts at the top (wording from per-person-days). A gap explained in the red box is never repeated in the generic "could not be filled" box.
- Buttons: **Use this roster** (today's Apply), **Show another option**, **Discard**. "Show another option" needs engine work (different seeds, keep the 3 best distinct results) — its own later stage.

## Ini

Animated Ini in the Ask Ini bar, built from Ini's measured proportions (rounded-square green body #9ED066, large round white eyes nearly touching, small brown pupils #945600, tiny smile). Eyes follow the pointer; body gently morphs; blinks. Moods: asleep on load → wakes; listening (input focused); thinking (generating; pupils up, half lids); celebrating (result ready, Fix it worked; bounce); surprised (tapped). Hover: lift and tilt, "Hi! Need a hand?" bubble once. Tap: jump/wiggle with rotating tips; five quick taps: spin + "Wheee! That tickles!". All motion off under prefers-reduced-motion. Bidhoo's own green-screen clips (wake, listening, thinking, celebrate) are available as transparent animated WebP if preferred for big moments.

## Fit check against the engine (12 November 2026)

| Control | Stored today | Engine |
|---|---|---|
| Shift cards: at least / at most / in-charge at least | `coverage[sh]`, `seniorCover[sh]` | Yes |
| In-charge on every shift: strength | — | No (stage 2b) |
| Per shift At least / At most / In a row | `weeklyMin[sh]`, `weeklyMax[sh]`, `blockTogether[sh]` + `blockDays[sh]` | Yes |
| Per shift strength | `ruleStates["weeklyCaps:<sh>"]` (At most only) | Yes, six levels |
| Off days At least / At most / strength | `weeklyMin.off`, `weeklyMax.off`, `ruleStates.offMin` | Yes |
| Off days In a row | Spread apart: engine default · Together is fine: `singleOffDays`, not stored · Always together: — | Partly (2b, 8) |
| Working days | `weeklyDuties.min/max` | Yes; fixed Must label |
| Working days in a row | `maxDaysOn`, strength `ruleStates.workPattern` (shared) | Partly (2b) |
| Share nights / non-official days fairly | — | No (2b) |
| Look back | `lookbackDays` | Fixed in stage 0 |
| What may follow what | `sequenceRules`, `ruleStates.sequence` | Yes, six levels |
| Staff ticks, in-charge, Skip, ward word | `staffShifts`, `seniorStaff`, `skipStaff`, `seniorTerm` (+ `seniorTermPlural`) | Yes |
| Personal rules 1–6, Must / Try | `personRules[]` | Yes |
| Fixed duty | — | No (stage 4) |
| Show another option | — | No (stage 7) |

Things that change how an existing department's roster is built: only stage 0 (a ward on "Don't look back" now has rest checked at the start of the week). Everything else is either the manager's own choice on the screen, or a new key that means today's behaviour when absent. The first edit on the screen still writes the whole merged settings, as today.

## Stages (one branch each, checkpoints A / B / C)

| # | Stage | Kind | Status |
|---|---|---|---|
| 0 | **Look-back fix.** Rest and "what may follow what" always read the 14 days before the period; fairness counts only from the look-back start (`history.fairFrom`, added only when needed). "The entire roster" = `36500`. Set lookup for non-official dates. Ini's label and sentence for the entire roster. Smart Roster's look-back box gains "The entire roster" and "Custom (N days)". | **Engine (small)** | In progress on `smart-roster-redesign` |
| 1 | **Live check banner** in today's layout | Screen only | |
| 2 | **Step 1 controls**: shift cards with − / +, the per-person table with the In a row dropdown, strength boxes, Working days with a fixed Must label, look-back row, the "usually gives way first" columns. The in-charge strength and the two fairness rows stay hidden until 2b. Prove saved settings round-trip unchanged. | Screen only | |
| 2b | **New strength keys**: a separate key for working days in a row (falls back to `workPattern`), in-charge strength, night and non-official fairness (Protect most to Ignore), off days "Together is fine" passed through. All mean today's behaviour when absent. | **Engine (medium)** | |
| 3 | **Step 2 Your staff**: merge Staff exceptions, Personal rules and request labels into one list with the inline rule panel. | Screen only | |
| 4 | **Manager-fixed duty** (engine + panel type 7). | **Engine (small)** + screen | |
| 5 | **Three-step layout, ready checklist and result summary.** | Screen only | |
| 6 | **Ini animations.** | Screen only | |
| 7 | **Show another option**: different seeds, keep the 3 best distinct results. | **Engine (medium)** | |
| 8 | **Off days "Always together".** | **Engine (medium)** | |

## Verification for every stage

- A department saved before the stage opens with identical values, and Save without changes writes byte-identical settings.
- Engine untouched stages: the comparison tool (`node tools/engine-compare/run.js --quick`) shows no difference.
- Tests and `CI=true npm run build` pass; CRLF kept.
- Localhost test steps for the Emergency Room, with how to undo any test changes.
