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
