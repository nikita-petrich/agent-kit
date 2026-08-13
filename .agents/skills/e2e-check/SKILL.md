---
name: e2e-check
description: Run the project's Playwright end-to-end suite, triage every failure, optionally repair the ones the suite owns, and report the result as a table against the current spec's "done when" criteria. Separates real product bugs from test drift and flakes using traces and the Playwright CLI, and hands each remaining failure to the skill that owns it. Use when the user runs /e2e-check, invokes $e2e-check, asks to run the end-to-end tests, run Playwright, fix failing E2E tests, or wants browser proof before /complete.
---

# e2e-check - run the E2E suite and read the result honestly

Where this sits in the workflow:

    /e2e-spec  ->  [e2e-check]  ->  /audit current  ->  /complete
    (specs          (run, triage,     (review the        (close the
     exist)          repair, report)   code)              work)

`/check` drives the app by hand and proves this feature's done-whens once.
`/e2e-check` runs the recorded suite and answers a wider question: does this
feature work, and did it break anything already covered?

The output that matters is not "12 passed". It is which done-whens are proven,
and for each failure, whether the app is broken or the test is.

## Prerequisites

`AGENTS.md` must declare the E2E command. If it does not, stop and point at
`/e2e`. If it does but no specs exist beyond the smoke spec, run anyway and say
plainly that coverage is a smoke test only.

## Input

Optional. With no argument, run the whole suite and report without changing
files. Accepts:

- a spec path, a `--grep` pattern, or a project name to scope the run
- `fix` to also repair the failures this suite owns (see step 4)

`fix` never widens what may be edited. It repairs **test files only**. A product
bug stays a reported failure either way, because repairing a test to match broken
behavior would erase the bug report.

## Step 1 - build the checklist first

Read `blueprint/context/current-feature.md` and list the done-whens this suite is
supposed to prove. Do this before running anything, so the run is measured against
the spec rather than against itself. A green suite that never touches the current
feature is not proof of the current feature.

Map each done-when to the spec that covers it. Anything unmapped is a gap, and
gaps get reported, not rounded up to a pass.

## Step 2 - run the suite

Use the exact command from `AGENTS.md`. Keep the HTML report from blocking:

```bash
PLAYWRIGHT_HTML_OPEN=never npx playwright test
```

Scope it when the user asked for less:

```bash
PLAYWRIGHT_HTML_OPEN=never npx playwright test tests/e2e/checkout.spec.ts
PLAYWRIGHT_HTML_OPEN=never npx playwright test --grep "sign in"
```

If the run cannot start - no browsers, port already taken, web server command
fails - report that as a blocked run and say what to fix. A suite that never ran
is not a passing suite.

## Step 3 - triage every failure

Never report a failure as "flaky test" without looking. Open the evidence:

```bash
npx playwright show-report            # HTML report for the run
npx playwright show-trace <trace.zip> # the recorded trace for one failure
```

For anything the trace does not settle, reproduce it live:

```bash
PLAYWRIGHT_HTML_OPEN=never npx playwright test tests/e2e/checkout.spec.ts:24 --debug=cli
playwright-cli attach tw-XXXX
playwright-cli snapshot   # is the element gone, renamed, or moved?
playwright-cli console    # app-side errors?
playwright-cli requests   # failed request or wrong payload?
```

Stop the background run when done. Put each failure in exactly one bucket:

| Bucket | Evidence | Owner |
| --- | --- | --- |
| Product bug | The app really does the wrong thing | `/implement` for in-scope work, `/fix` otherwise |
| Test drift | The app is correct, the spec is stale | this skill in `fix` mode, else `/e2e-spec` |
| Flake | Passes and fails on the same code, no app change | this skill in `fix` mode, else `/e2e-spec` |
| Environment | Missing browser, port, seed data, or credential | Report the setup fix; do not weaken the spec |

Confirm flakes rather than assuming them. Rerun the single spec a few times; if it
passes every time in isolation and fails in the suite, the cause is shared state,
and that is a real defect in the suite worth naming.

## Step 4 - repair, in `fix` mode only

Skip this step entirely without the `fix` argument.

Repair only the **test drift** and **flake** buckets, one failure at a time:

- **Test drift**: update the locator or the assertion to match what the app
  correctly does now. Rehearse the corrected interaction through `playwright-cli`
  first, so the replacement comes from the running page rather than a guess.
- **Flake**: fix the actual race - a missing web-first assertion, an implicit wait
  on an animation, or state leaking between specs. If the race cannot be fixed
  honestly, delete the spec and say so. A spec that lies is worse than no spec.

After each repair, rerun that single spec twice. One pass is not proof for
something that was intermittent.

Never repair with a sleep, a skipped hook, `networkidle`, a loosened assertion, or
a `test.skip`. Those turn a red suite green without changing anything true.

Leave **product bugs** failing. Report them; do not touch product source here.
If the user confirms a bug will not be fixed now, mark that spec `test.fixme` with
a comment naming the decision - never a silent skip.

## Step 5 - report as a table

Always report one row per done-when, in this shape:

| Done-when | Spec | Result | Cause | Action |
| --- | --- | --- | --- | --- |
| Signing in lands on the dashboard | `tests/e2e/sign-in.spec.ts` | pass | - | - |
| Empty cart shows the empty state | `tests/e2e/cart-empty.spec.ts` | pass | - | - |
| Checkout emails a receipt | `tests/e2e/checkout.spec.ts` | fail | product bug: `POST /api/receipt` returns 500 | handed to `/implement` |
| Filter chips persist on reload | `tests/e2e/filters.spec.ts` | fixed | test drift: chip label renamed to "Active" | locator updated, passes 2/2 |
| Export to CSV | - | gap | no spec covers this done-when | run `/e2e-spec` |

Result values: `pass`, `fail`, `fixed`, `gap`, `blocked`, `skipped`. Use `fixed`
only in `fix` mode and only after the repaired spec passed twice.

Below the table, add:

- the exact command run, and the pass/fail/skip counts Playwright reported
- where the HTML report and traces live
- files changed, or "none" in report-only mode
- the bottom line:
  - All done-whens `pass` or `fixed`, no gaps -> ready for `/audit current`.
  - Any product bug -> name the failing behavior, hand it to `/implement` or `/fix`.
  - Any gap or blocked run -> say so plainly; never present either as a pass.

Do not commit, merge, or push.

## Rules

- **Test files only, and only in `fix` mode.** Product source is never edited
  here. Repairing it belongs to `/implement` or `/fix`.
- **Every failure gets triaged.** "Probably flaky" is not a verdict.
- **The counts are not the answer.** The verdict is per done-when, against the
  spec.
- **Gaps are reported, not absorbed.** An uncovered done-when is not a pass.
- **Never rerun until green.** Reruns confirm a flake or a repair; they never
  launder a failure into a pass.
- **Never weaken a spec to get a green run.**

## Formatting

Format the output to match the project's conventions in
`blueprint/context/ai-interaction.md`: concise, scannable markdown, with lists for
enumerations and tables for matrices rather than dense paragraphs.
