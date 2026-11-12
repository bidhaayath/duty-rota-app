# Engine comparison

Compares the Smart Roster engine in `src/rosterEngine.js` with an older
version of itself, over a fixed set of made-up wards. Use it before merging
any change to the engine, to show what moved and what did not.

It is not part of the app and not part of `npm test`. Nothing here is built
or deployed.

## Run it

From the project folder:

    node tools/engine-compare/run.js

That compares the engine as it is now with the one on `main`, and takes
about three quarters of an hour. The results are printed at the end.

| Command | What it does |
|---|---|
| `node tools/engine-compare/run.js` | Everything, against `main` |
| `node tools/engine-compare/run.js --ref HEAD` | Against the last commit instead |
| `node tools/engine-compare/run.js --quick` | A small sample, a few minutes |
| `node tools/engine-compare/run.js --job rules` | Only the measured weeks |
| `node tools/engine-compare/run.js --job keys` | Only the strength keys |
| `node tools/engine-compare/run.js --parts 2` | Fewer parts at once, for a slower laptop |

It exits with an error if a list that should change nothing changed
something, or if the engine's report disagrees with the count.

## What it checks

**Lists that must change nothing** (`same-weeks`, `same-months`): 126 weeks
and 6 months, each built with no personal rules, an empty list, stage 1
rules only, day rules that cannot be read, and rules for staff who have
left. Old and new are compared as text; any difference is a failure.

**Weeks with rules set** (`rules`): 63 weeks, each built with eight lists
(none, stage 1 rules, always off as Try and as Must, only-shifts as Try and
as Must, and two mixes). For each list it prints, old engine beside new:

- uncovered shifts
- shift-days above Most
- days a day rule was not kept, Try and Must
- gaps that name a Must day rule
- seconds spent building, in all and for one week (the middle week and the
  slowest)

The times are taken with the parts running side by side and with the
rearranging stage run to its full number of steps (the app stops it after
15 seconds), so read them old against new rather than as what a manager
waits.

All of it is counted from the finished rota, not read from the engine's
report. The report is then checked against the count.

**Strength keys** (`keys`): the same 63 weeks, each built once as it is and
once with one of the stage 2b keys set to a level of its own: working days
in a row (`daysInRow`) at Must and Ignore, also on the ward with the limit
set to 3; in-charge on every shift (`seniors`) at Must, Protect, Bend first
and Ignore, on the ward with an in-charge asked for on Mornings and Nights;
sharing nights (`fairNights`) and non-official days (`fairNonOfficial`)
fairly at Protect most, Bend first and Ignore; and off days "Together is
fine" (`singleOffDays: false`). Both builds use the engine in `src`: without
the key it is proven identical to `main` by `same-weeks`. For each it prints,
without the key → with it: weeks refused, weeks with identical cells,
uncovered shifts, shift-days above Most, the measure the key controls, and
the middle week's seconds.

## The baseline

The wards are made from a seed, so the same seed always gives the same
ward, and the old-engine numbers from one branch are the baseline for the
next. The numbers recorded when this was written are in `BASELINE.md`.

Changing anything inside `seededWard()` in `wards.js` changes every ward
and so every baseline. Add new wards or new lists; do not edit the old ones.

## Files

- `wards.js`: the seeded wards and the lists of rules they are tried with
- `compare.test.js`: the comparison and the counting
- `run.js`: fetches the old engine, runs the parts side by side, prints
- `old/` and `out/`: the old engine copy and the last results; not committed
