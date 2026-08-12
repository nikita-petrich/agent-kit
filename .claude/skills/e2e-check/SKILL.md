---
name: e2e-check
description: Run the project's Playwright end-to-end suite and report an honest verdict against the current spec's "done when" criteria. Runs the documented E2E command, separates real product bugs from test drift and flakes using traces and the Playwright CLI, and hands each failure to the skill that owns it. Observes only - it never edits source or specs. Use when the user runs /e2e-check, invokes $e2e-check, asks to run the end-to-end tests, run Playwright, or wants browser proof before /complete.
---

# e2e-check - run the E2E suite and read the result honestly

Where this sits in the workflow:

    /e2e-spec  ->  [e2e-check]  ->  /audit current  ->  /complete
    (specs          (run them,        (review the        (close the
     exist)          triage failures)  code)              work)

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

Optional. With no argument, run the whole suite. Accepts a spec path, a `--grep`
pattern, or a project name to scope the run.

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
| Test drift | The app is correct, the spec is stale | `/e2e-spec` |
| Flake | Passes and fails on the same code, no app change | `/e2e-spec`, as a race to fix or a spec to drop |
| Environment | Missing browser, port, seed data, or credential | Report the setup fix; do not weaken the spec |

Confirm flakes rather than assuming them. Rerun the single spec a few times; if it
passes every time in isolation and fails in the suite, the cause is shared state,
and that is a real defect in the suite worth naming.

## Step 4 - report

One line per done-when, then the failures:

    [pass] Signing in lands on the dashboard - tests/e2e/sign-in.spec.ts
    [pass] Empty cart shows the empty state - tests/e2e/cart-empty.spec.ts
    [fail] Checkout emails a receipt - product bug: POST /api/receipt returns 500
    [fail] Filter chips persist on reload - test drift: chip label renamed to "Active"
    [gap]  Export to CSV - no spec covers this done-when yet

Then the bottom line:

- All mapped done-whens proven and no gaps -> ready for `/audit current`.
- Product bug -> name the failing behavior and hand it to `/implement` or `/fix`.
- Test drift or flake -> hand it to `/e2e-spec`.
- Blocked run or gaps -> say so plainly; never present either as a pass.

Include the exact command run, the pass/fail/skip counts, and where the report and
traces live.

## Rules

- **Observe, don't change.** This skill edits no product source and no spec files.
  Repair belongs to `/implement`, `/fix`, or `/e2e-spec`.
- **Every failure gets triaged.** "Probably flaky" is not a verdict.
- **The counts are not the answer.** The verdict is per done-when, against the
  spec.
- **Gaps are reported, not absorbed.** An uncovered done-when is not a pass.
- **Never rerun until green.** Reruns are for confirming a flake, not for laundering
  a failure into a pass.
- **Never weaken a spec to get a green run.**

## Formatting

Format the output to match the project's conventions in
`blueprint/context/ai-interaction.md`: concise, scannable markdown, with lists for
enumerations and tables for matrices rather than dense paragraphs.
