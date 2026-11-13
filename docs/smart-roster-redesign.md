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

As built in stage 1 (`src/settingsCheck.js`, pure, nothing from the engine):
- **N** is everyone on the rota for the week being planned, minus Skip — the same people Generate uses. Before check 1 comes **nobody on the roster** (everyone skipped, or nobody employed that week).
- **Shifts** are the ones the ward runs (`coverage[sh].max` not 0), so Evening counts only where it is used.
- **What each check reads:**
  1. `coverage[sh].min/max`; `weeklyMin[sh]` / `weeklyMax[sh]`; `weeklyMin.off` / `weeklyMax.off`; `weeklyDuties.min/max`.
  2. `blockTogether[sh]` (never more than `blockDays[sh]`, as the engine reads it) of 2 or more, with `weeklyMax[sh]` below 2.
  3. The sum of `weeklyMin[sh]` against `weeklyDuties.max` (empty = 7).
  4. The sum of `weeklyMax[sh]`, only when every shift the ward runs has one, against `weeklyDuties.min`.
  5. `weeklyDuties.min/max` against `weeklyMin.off` / `weeklyMax.off`.
  6. N × `weeklyDuties.min` against the sum of `coverage[sh].max` (empty = min) × 7.
  7. The sum of `coverage[sh].min` × 7 against what N people can work: `weeklyDuties.max`, and no more than 7 − `weeklyMin.off` except for anyone ticked to a single shift (the engine's own reading).
- A number whose strength is **Ignore** (`ruleStates["weeklyCaps:<sh>"]`, `offMin`, `offMax`) is not held against checks 1, 2, 4 and 5, because the engine does not apply it.
- **The green message is a slim, quiet line**, not a card, so the amber card stands out when it appears.
- **Never blocks Generate.** Where the problem shown is one Generate itself refuses on, the banner adds "Generate cannot make a week until this is changed."
- **Fix it for me** (check 6 only, and only when one more on one shift is enough): raises the "at most" of the shift the most staff are allowed to do, ties broken Morning, Afternoon, Evening, Night, and never above the number of staff allowed on that shift. It saves at once like any setting, and the banner then says exactly what changed — "Changed — Morning: at most 4 → 5. Undo puts it back." — until the settings next change.
- **Nothing said twice.** An engine message in "Worth knowing before you generate" or "These settings cannot produce a week yet" is left out only while the banner is saying the same thing: nobody on the roster (check 0); that shift's maximum below its minimum (check 1); the two "even with every shift at its fullest" sums (check 6); "leaves only about X off days", "Each day needs X people… only Y staff", and the week's "N short" line when N is the banner's number (check 7 — if leave makes the week shorter still, it stays). Everything else stays in those boxes: in-charge messages, how many people a shift reaches, missing codes, requests, "what may follow what" conflicts, "Only these shifts". The engine messages are matched by their wording, pinned in `settingsCheck.test.js`.

### "Who's needed on each shift"
One card per shift the ward uses (Morning, Afternoon, Evening, Night — from the ward's duty codes). Each card: **At least**, **At most**, **[In-charge word]s, at least** — each with − / + buttons, not empty boxes. Below the cards: "Staff numbers — **Must — always**" (fixed label) and "[In-charge word]s on every shift" with a strength box. The in-charge strength box (`ruleStates.seniors`) shows **Protect most** until changed — see "As built in stage 2b".

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
- Off days In a row: **Spread apart** (today's default behaviour) · **Together is fine** · **Always together**. Spread apart and Together is fine (`rosterRules.singleOffDays: false`) are offered since stage 2b. "Always together" is new engine behaviour (stage 8).
- Under the table:
  - **Working days** (− / +) with a fixed **"Must"** label, no strength box. It writes `weeklyDuties.min` and `.max` together; a saved pair that differs shows as **"Custom (fewest X, most Y)"**. The maximum stays unbendable — it is hard throughout the engine and making it bendable is out of scope.
  - **Working days in a row, at most** (− / +, `maxDaysOn`, 1–6) with a strength box. Since stage 2b its strength is its own key, `ruleStates.daysInRow`, which follows In a row (`ruleStates.workPattern`) until it is changed; In a row's strength is one row under the table, "In a row, every shift".
  - **Share nights fairly** and **Share non-official days (Fridays and holidays) fairly**: strength box offering **Protect most to Ignore only — no Must** (Ignore = off). `ruleStates.fairNights` / `ruleStates.fairNonOfficial` since stage 2b; Protect until changed.
  - **Look back at past duties**: The entire roster · Last 90 / 60 / 30 / 14 days · Don't look back, with a one-line explanation under it. Stored in `lookbackDays`: "The entire roster" is `36500` (`LOOK_BACK_ALL`), a plain number that older code reads as a very long look-back; Don't look back is `0`; any other saved number shows as **"Custom (N days)"**. Look-back only affects fairness; rest and "what may follow what" always check the 14 days before the week regardless (stage 0).

### Strength ("If it can't all fit")
Every ward rule gets the existing six-level scale: **Must — never break · Protect most · Protect · Bend if needed · Bend first · Ignore (off)**. The box is lightly tinted by level.

### "When it can't all fit, what usually gives way first"
Five columns, left to right: Bend first → Bend if needed → Protect → Protect most → Must. The title says **"Usually gives way first"**, not a strict order: the levels decide what gives way in the first build, but the later rearranging pass prices every Try level the same. That pricing is **not** to be changed. Each column lists the rules currently at that level, live. The Must column always also lists **Staff numbers**, **Working days**, **Approved duty requests** and **Duties you fixed**.

### "What may follow what" (collapsed by default)
Header shows "N rules · [level]". Inside: rules as sentences ("Never give Morning after Night", "Always give an off day after Night") with a remove button; the existing builder (Never/Always give · duty · after · duty · Add); **Reset to the usual rules**; one strength box for the group.

### As built in stage 2 (`src/WardNeeds.js`)
- **Page order kept** until stage 5: banner, Who's needed on each shift, Each person each week (with working days, In a row and the look-back, moved up from More rules), What usually gives way first, Staff exceptions, Personal rules, What may follow what (collapsed), Which code to write (collapsed, unchanged inside), Generate.
- **Same keys, same writes.** Every control writes through the existing `setRules`, the key the old box wrote: `coverage[sh].min/max`, `seniorCover[sh]`, `weeklyMin/weeklyMax[sh|off]`, `blockTogether[sh]` + `blockDays[sh]`, `ruleStates[…]`, `weeklyDuties.min/max`, `maxDaysOn`, `lookbackDays`, `sequenceRules`. Nothing is written on opening or by re-picking the current option. Two accepted differences: the six-level box for what may follow what writes priority 1 for Must and Ignore (the old buttons kept the previous number; the engine ignores it at those levels), and a shift's "at most" cannot be emptied again once it has a number (an empty one still shows as "No limit").
- **Shift cards:** one for every shift the ward has a duty code for, plus any shift with a non-zero number saved. A shift saved as 0 / 0 is a slim line, "Evening: not run on this ward.", with **Turn on Evening**: that only shows the card, and nothing is written until a number changes. An empty "at most" shows "No limit"; − sets it to the "at least" (never below 1) and + stays off.
- **Each person:** rows only for shifts the ward runs, plus Off days. "At most" runs 0–7 then **No limit** (saved as empty). Off days' In a row is fixed text, "Spread apart", until stage 8.
- **In a row** options as listed above, with **Up to 2 in a row**. Picking an option writes only the box that changes: a fewest that is already empty or 1 is left alone.
- **Working days:** one − / + writing fewest and most together when they are equal; when they differ, "Custom" with two − / + (fewest, most), each writing its own key. Fixed **Must** label.
- **Working days in a row** shares its strength box with In a row (`workPattern`), and says so.
- **Gives way first:** columns built from the saved strengths, only for what is set (a shift with no most has nothing to bend). Also shown: **People's own Try rules** (Bend first, which is what the engine bends first), **People's own Must rules** and **Most off days** (`offMax`) in their columns. Ignore is listed under the columns as "Switched off: …". One line under them: "Always aimed for, but not promised: fewest of each shift, fewest working days." **Duties you fixed** joins the Must column in stage 4.
- Every − / +, select and remove button is at least 44 × 44px. The rows wrap at phone width rather than scrolling sideways: a − / + keeps its own width and moves to the next line when there is no room; a select takes the room there is and can narrow. Checked in a headless browser at every width from 300 to 430px: nothing reaches past a card's edge.
- **The ward's own colours.** Each row of "Each person, each week" has its name on a tag in the colour of the duty code Smart Roster writes for it (the one chosen under "Which code to write", or else the first code that counts as it — the same colour as on the rota grid), and a light wash of that colour (one part to nine of white) behind the row. Off days use the Off code's colour. A code with no colour, or no off code, is a neutral grey (`#B7C4C2`). The dots on the shift cards use the same colours. The name on a tag is the app's ink where that reads at 4.5 : 1 or better, otherwise black or white, whichever reads better; captions on the wash also read at 4.5 : 1 or better, for every colour (tested over the whole colour range).

### As built in stage 2b (new strength keys)
Each key is stored only when a manager changes it. Absent, the engine takes exactly the path it always did (proven against `main` on every seeded week and month). What a box shows when its key is absent is the level that behaves exactly as absent, and saving that level changes nothing — each pair is tested.

| Key | Shows when absent | Levels |
|---|---|---|
| `ruleStates.daysInRow` (working days in a row) | In a row's level (`workPattern`), with "Follows In a row until you change it." Saved at In a row's own level it is still the one combined rule. | **Must**: never bent in the first build, priced 5000 in the polish. **Try levels**: its own step in the give-way order, 80 a day. **Ignore**: not checked. The 6-day ceiling stays hard, and the "stretched to avoid an extra off day" path still ignores it, as before. |
| `ruleStates.seniors` (in-charge on every shift) | **Protect most** | **Must** and **Protect most**: the slot is filled by bending any Try rule, too few in-charge staff stops Generate (as before); Must is priced 5000 in the polish, Protect most 400. **Protect / Bend if needed / Bend first**: searched for only by bending weaker Try rules, then the gap is recorded and the place filled by whoever is free; too few is a warning and the week is still made; 400. **Ignore**: no in-charge asked for anywhere; the numbers stay saved, greyed out. |
| `ruleStates.fairNights` (share nights fairly) | **Protect** | Protect most to Ignore, no Must (a saved Must reads as Protect most). The level is the place of "who has had fewest nights" among the fairness tie-breaks when a Night is filled; Protect most and Protect both leave it first, where it already was. Polish 3 a point of spread; **Ignore** 0 and the tie-break left out. |
| `ruleStates.fairNonOfficial` (share non-official days fairly) | **Protect** | The same rules. Covers the non-official measure only (Fridays where the Friday rule makes them non-official, and holidays), not the Friday off-day or Friday afternoon measures. Protect most puts it first among the tie-breaks. |
| `rosterRules.singleOffDays: false` (off days Together is fine) | Spread apart | Together is fine stores `false` and is passed to the engine only when stored; choosing Spread apart again removes the key. |

- As agreed in stage 0, the level changes the first build; the polish only tells Must, Try and Ignore apart.
- Screen: the in-charge box sits under "Staff numbers"; "In a row, every shift" (`workPattern`) is one row under the table; working days in a row, then the two fairness boxes (nights only where the ward runs them), then the look-back. Under working days in a row at Must: "Must can leave shifts uncovered rather than allow a longer run."; under in-charge at Must: "Must can leave a shift short rather than go without a [ward's word]." "What usually gives way first" lists every key in its column.
- Also in this stage: "Each person, each week" opens with one line, "What each person gets in a week. Everyone follows this unless they have their own rule."; "At least 1 Night = everyone gets a Night every week." is said once for the table; "Two side by side; a single one is still fine, so everyone gets one." appears under In a row only for In pairs and 2 or 3 together.
- Measured with the comparison tool's `keys` job (63 seeded weeks, without the key → with it): working days in a row at Must with the limit at 3 cuts runs past it from 61 to 4 but leaves 125 shifts uncovered against 77; at Ignore 216 runs past it, 60 uncovered. In-charge Must cuts shift-days with no in-charge from 13 to 9; Protect changes nothing; Ignore asks for none. Nights at Ignore: spread 108 → 126; non-official at Ignore: 70 → 75. Together is fine: off days side by side 29 → 91, no change in cover. Build times unchanged.

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

### As built in stages 3 and 4 (`src/YourStaff.js`)
- **One list** in place of the Staff exceptions and Personal rules cards, in today's page order. Each row: the name, with labels under it — the shifts they are kept to ("Morning & Afternoon only"), their own rules in grey ("(Must)" where Must), their approved duty requests from today on in blue (three, then a clickable "+N more" that shows the rest in the row, and "Show fewer"), and duties you fixed in purple (greyed once gone by); then the shift chips (shifts the ward runs, plus any already ticked), the in-charge tick in the ward's word, Skip (the row greys out), and "+ Rule" / "Rules (N)" / "Close". One panel open at a time.
- **Above the list**: "This ward calls the person in charge" (and the plural box for a ward that already saved one), a one-line key for ticks, the in-charge word, Skip, blue and purple, "Staff on recorded leave are skipped automatically for those days.", "Clear past fixed duties (N)" when any have gone by, and each day a Must leaves too few people for, said once.
- **The panel**: the person's rules as sentences with Must / Try and remove, their fixed duties with "Always kept" and remove, the requests note where they have requests, then "Add a rule" (seven kinds, only the fields each needs), the preview, every refusal and warning as before, and "Add rule". "At least … days between" is now "Gap between shifts: at least … days". Rules saved for people no longer on the ward are listed at the bottom so they can be taken away.
- **Same keys**: `staffShifts`, `seniorStaff`, `skipStaff`, `seniorTerm` (+ `seniorTermPlural`), `personRules`, through the same handlers; opening writes nothing; one Undo step each. Every button at least 44px; checked in a headless browser from 300 to 430px, list and open panels.
- **Fixed duties** (`rosterRules.fixedDuties: [{ id, staffId, date, duty }]`, removed when empty): handed to the engine with the approved requests as `{ staffId, date, category: duty, source: "manager" }`, only those in the period; the engine keeps them as it keeps a request. Messages say "duties fixed by you" ("Remove a fixed duty for that date"), Ini says "the duties you fixed", and the in-charge reasons "is on a duty fixed by you". Refused on screen: an approved request that day, leave or not employed, Skip, a shift the person is not ticked for, a day their own "always off" Must covers (Off that day is fine), a fixed duty already that day. "Duties you fixed" is in the Must column of "What usually gives way first". With none in the period, rosters are identical to before (engine-compare against `main`: 0 different).

## Step 3 — Make the roster

- Week picker and one big **Make the roster** button.
- **Ready checklist** before generating: ward needs fit (or a link back to step 1), enough [In-charge word]s on the roster, staff on the roster / skipped, approved duty requests this week — always kept (Must), "what may follow what" rules, look-back period.
- Result: a one-line summary ("All Must rules met, every shift covered…"), then **What had to give**, each item with person/shift, rule, strength and plain reason. Red box for gaps caused by personal Musts at the top (wording from per-person-days). A gap explained in the red box is never repeated in the generic "could not be filled" box.
- Buttons: **Use this roster** (today's Apply), **Show another option**, **Discard**. "Show another option" needs engine work (different seeds, keep the 3 best distinct results) — its own later stage.

### As built in stage 5 (`src/RosterSteps.js`)
- **Three step buttons** at the top — 1 Ward needs · 2 Your staff · 3 Make the roster — always clickable, each with a one-line status: "Done" / "Needs a fix", "N on the roster", "Week ready" / "Pick a week". The current one has a green border and `aria-current="step"`. "← Back" and "Next: …" under each step. On the narrowest phones (340px and below) the words drop under the number.
- **Step 1** holds the live check banner and the Ward needs sections; **step 2** Your staff; **step 3** the week picker, Make the roster, and the proposed week.
- **Ready checklist** on step 3 until a week is made: settings fit (or "go back to step 1"), enough in-charge on the roster, how many on the roster and skipped, approved requests and fixed duties this week (always kept), "what may follow what", the look-back.
- **After making**: a one-line summary first ("All Must rules met, every shift covered." or "N shifts not covered · …"), then the week. Apply is now **Use this roster**, same behaviour. No "Show another option" yet (stage 7).
- The last step is remembered per department in `localStorage` (`smartRoster:step:<deptId>`, try/catch, starts at step 1 when unreadable). `dutyrota:recovering` and `dutyrota:recovery-done` are untouched.

## Ini

Animated Ini in the Ask Ini bar, built from Ini's measured proportions (rounded-square green body #9ED066, large round white eyes nearly touching, small brown pupils #945600, tiny smile). Eyes follow the pointer; body gently morphs; blinks. Moods: asleep on load → wakes; listening (input focused); thinking (generating; pupils up, half lids); celebrating (result ready, Fix it worked; bounce); surprised (tapped). Hover: lift and tilt, "Hi! Need a hand?" bubble once. Tap: jump/wiggle with rotating tips; five quick taps: spin + "Wheee! That tickles!". All motion off under prefers-reduced-motion. Bidhoo's own green-screen clips (wake, listening, thinking, celebrate) are available as transparent animated WebP if preferred for big moments.

### As built in stage 6 (`src/IniBuddy.js`, `src/IniMascot.js`)
- **Ask Ini bar** above the step buttons on every step, shown only where the Ini panel is (a department, not view-only, not locked). Send or Enter hands the note to the Ini panel, which opens and reads it at once, as if "Read my note" was pressed. Nothing new is saved: the panel shows its checklist and adds only on "Add N items" (one Undo step); a month Ini builds still opens as a preview first.
- **Ini** is the same `IniMascot`, recoloured #9ED066 / #945600, with a new `thinking` mood. Bar moods: resting → waking → listening; thinking while a week is made or the panel is working; "all done" for three seconds after a week is made or Fix it for me worked; surprised ("spotted") on a tap. Eyes follow the pointer, also on the floating Ini button. Hover lifts and tilts and says "Hi! Need a hand?" once; taps say five tips in turn; five taps within 1.6s spin and say "Wheee! That tickles!". What Ini says is read out (`aria-live`).
- Under prefers-reduced-motion: awake at once, eyes ahead, no morph, lift, hop or spin; the words still appear. Ini, the box and Send are each at least 44px and reachable by keyboard.

### As built: Ini learns personal rules (branch `ini-personal-rules`)
- A note can give one person what Your staff gives them: shift ticks, the in-charge tick, Skip (`set_skip`), any of the six rules (`person_rule`), and fixed duties (`fixed_duty`). Shown under a new **Your staff** heading in Ini's checklist, in the panel's own sentences; "Standing settings" keeps only the ward's. Saved on "Add N items", one Undo step.
- **One copy of the checks**: the panel's refusals and warnings live in `src/personRuleChecks.js`, used by both Your staff and Ini. A line sees the lines before it in the same note.
- **Never ward-wide for one person**: the prompt forbids it; something about one person with no action (e.g. nights in a row) is a note saying it can only be set for the whole ward.
- **Ini asks on the line** when it cannot finish it, and the line waits until answered: a number left out (stepper), "weekend" (the seven days in the ward's order), a name that could be two people (a picker with only them), a fixed duty on a date gone by (which year). No second request.
- Decisions (13 Nov 2026): weekdays off with no dates = standing "always off on" (Must); `weekly_off` only with dates. Leave with both dates is recorded as before; otherwise a note pointing to the Staff tab. "Only 1 night a week" = at most 1. Rules start as the panel starts them; only "must" / "has to" makes one Must.
- **Cost**: nothing new about staff is sent (names under one-time refs). The instructions grew from 8,292 to 11,399 characters (~820 tokens a note, ~34% more input); still one request per note.

## Fit check against the engine (12 November 2026)

| Control | Stored today | Engine |
|---|---|---|
| Shift cards: at least / at most / in-charge at least | `coverage[sh]`, `seniorCover[sh]` | Yes |
| In-charge on every shift: strength | `ruleStates.seniors` | Yes, since stage 2b |
| Per shift At least / At most / In a row | `weeklyMin[sh]`, `weeklyMax[sh]`, `blockTogether[sh]` + `blockDays[sh]` | Yes |
| Per shift strength | `ruleStates["weeklyCaps:<sh>"]` (At most only) | Yes, six levels |
| Off days At least / At most / strength | `weeklyMin.off`, `weeklyMax.off`, `ruleStates.offMin` | Yes |
| Off days In a row | Spread apart: engine default · Together is fine: `singleOffDays: false` · Always together: — | Partly (stage 8 for Always together) |
| Working days | `weeklyDuties.min/max` | Yes; fixed Must label |
| Working days in a row | `maxDaysOn`, strength `ruleStates.daysInRow` (follows `workPattern` until set) | Yes, since stage 2b |
| Share nights / non-official days fairly | `ruleStates.fairNights`, `ruleStates.fairNonOfficial` | Yes, since stage 2b |
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
| 0 | **Look-back fix.** Rest and "what may follow what" always read the 14 days before the period; fairness counts only from the look-back start (`history.fairFrom`, added only when needed). "The entire roster" = `36500`. Set lookup for non-official dates. Ini's label and sentence for the entire roster. Smart Roster's look-back box gains "The entire roster" and "Custom (N days)". | **Engine (small)** | Merged (PR #71) |
| 1 | **Live check banner** in today's layout | Screen only | Merged (PR #72) |
| 2 | **Step 1 controls**: shift cards with − / +, the per-person table with the In a row dropdown, strength boxes, Working days with a fixed Must label, look-back row, the "usually gives way first" columns. The in-charge strength and the two fairness rows stay hidden until 2b. Prove saved settings round-trip unchanged. | Screen only | Merged (PR #73) |
| 2b | **New strength keys**: a separate key for working days in a row (falls back to `workPattern`), in-charge strength, night and non-official fairness (Protect most to Ignore), off days "Together is fine" passed through. All mean today's behaviour when absent. | **Engine (medium)** | Merged (PR #74) |
| 3 | **Step 2 Your staff**: merge Staff exceptions, Personal rules and request labels into one list with the inline rule panel. | Screen only | Merged (PR #75) |
| 4 | **Manager-fixed duty** (engine + panel type 7). | **Engine (small)** + screen | Merged (PR #75) |
| 5 | **Three-step layout, ready checklist and result summary.** | Screen only | In progress on `three-steps` |
| 6 | **Ini animations.** | Screen only | In progress on `three-steps` |
| 7 | **Show another option**: different seeds, keep the 3 best distinct results. | **Engine (medium)** | |
| 8 | **Off days "Always together".** | **Engine (medium)** | |

## Verification for every stage

- A department saved before the stage opens with identical values, and Save without changes writes byte-identical settings.
- Engine untouched stages: the comparison tool (`node tools/engine-compare/run.js --quick`) shows no difference.
- Tests and `CI=true npm run build` pass; CRLF kept.
- Localhost test steps for the Emergency Room, with how to undo any test changes.
