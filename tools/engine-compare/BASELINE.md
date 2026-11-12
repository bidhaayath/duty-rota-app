# Baseline

Recorded 12 November 2026, on branch `per-person-days`, with
`node tools/engine-compare/run.js --ref main`. The old engine is `main` at
`7f958ad` (per-person rules stage 1 merged); the new engine is stage 2, the
rules about days.

These replace the earlier figures of 3 uncovered shifts and 93 to 94
shift-days above Most. Those came from a set of wards that was never saved.

## Lists that must change nothing

126 weeks and 6 months, each with six lists (no personal rules, an empty
list, stage 1 rules only, day rules that cannot be read, rules for departed
staff only, stage 1 rules with unreadable day rules beside them). Old and
new compared as text: **no differences**.

## Weeks with rules set

63 weeks. One is refused by both engines (too few staff for a day), leaving
62 measured. Counted from the finished rotas.

| List | Uncovered, old | Uncovered, new | Above Most, old | Above Most, new |
|---|---|---|---|---|
| No personal rules | 59 | 59 | 27 | 27 |
| Stage 1 rules | 59 | 59 | 23 | 23 |
| Always off Fri+Sat, Try | 60 | 59 | 26 | 27 |
| Always off Fri+Sat, Must | 60 | 59 | 26 | 27 |
| Fri+Sat only Morning, Try | 59 | 60 | 27 | 20 |
| Fri+Sat only Morning, Must | 59 | 61 | 27 | 20 |
| Always off Must, only Morning Try | 60 | 60 | 26 | 21 |
| Stage 1 rules and both day rules | 59 | 59 | 26 | 25 |

The first two rows are the baseline for a later branch: **59 uncovered
shifts and 27 shift-days above Most with no personal rules; 59 and 23 with
stage 1 rules.**

The old engine does not know the day rules, so in the last six rows its
figures are the same wards built without them. They differ slightly from
the first row because the person who is always off is given a history that
fits the rule (off on those days before the week too).

Uncovered shifts and shift-days above Most are what a later run should be
held to. "Above Most" counts a shift on a day once, however many people it
is over by.

## Time to build one week

Recorded 12 November 2026 with `--job rules`, four parts side by side, the
rearranging stage run to its full number of steps. Seconds; "typical" is
the middle week of the 62.

| List | Typical, old | Typical, new | Slowest, old | Slowest, new |
|---|---|---|---|---|
| No personal rules | 3.8 | 4.0 | 9.8 | 10.2 |
| Stage 1 rules | 4.0 | 4.2 | 9.8 | 9.1 |
| Always off Fri+Sat, Try | 3.7 | 4.4 | 9.7 | 17.5 |
| Always off Fri+Sat, Must | 3.8 | 3.9 | 10.0 | 11.1 |
| Fri+Sat only Morning, Try | 3.6 | 4.7 | 10.0 | 17.0 |
| Fri+Sat only Morning, Must | 3.7 | 4.0 | 9.9 | 10.3 |
| Always off Must, only Morning Try | 3.8 | 4.7 | 9.6 | 17.4 |
| Stage 1 rules and both day rules | 3.9 | 4.9 | 9.9 | 18.0 |
| All lists | 3.8 | 4.3 | 10.0 | 18.0 |

The slowest weeks with a Try rule about days are the ones with a shift
still short: they are rearranged a second time with the Try free.
