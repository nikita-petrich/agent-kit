---
name: test-spec
description: Write the non-browser tests for the current feature - unit, integration, and API tests - from the "done when" criteria in current-feature.md, using the runner /tests configured. Routes each criterion to the cheapest test type that can actually prove it, writes the tests, runs them, optionally repairs failing tests, and reports coverage and results as a table. Use when the user runs /test-spec, invokes $test-spec, asks to write unit tests, add integration or API tests, generate tests for a feature, or fix failing unit tests.
---

# test-spec - write the non-browser tests for the current spec

Where this sits in the workflow:

    /implement  ->  [test-spec]  ->  /e2e-spec  ->  /e2e-check  ->  /complete
    (built the      (unit, integration,  (browser flows)  (suite verdict)
     behavior)       API tests)

`/tests` installs the runner and proves it works with one example. This skill is
what actually writes tests for real behavior, one feature at a time.

It covers everything a browser is not needed for. Browser flows are `/e2e-spec`.

## Prerequisites

`AGENTS.md` must declare a test command. If it does not, stop and point at
`/tests`. Do not install a runner from here.

## Input

Optional. With no argument, cover the current feature's done-whens. Accepts:

- a path, module, or endpoint to cover
- a type - `unit`, `integration`, or `api` - to restrict what gets written
- `fix` to repair the project's currently failing tests instead of writing new ones

## Step 1 - route each done-when to a test type

Read `blueprint/context/current-feature.md` and the diff the feature produced.
For each done-when, pick the cheapest test that can actually prove it:

| Test type | Use it for | Example |
| --- | --- | --- |
| Unit | Pure logic with real branches: parsing, validation, formatting, pricing, permissions | A discount calculator's boundary and rounding cases |
| Integration | Two or more real parts wired together, usually with a real test database | A repository writing a record and a service reading it back |
| API | An HTTP contract: status, shape, auth, error bodies | `POST /api/orders` returns 422 with field errors on bad input |
| E2E (`/e2e-spec`) | A journey through the browser UI | Signing in, then checking out |
| Nothing | Config, copy, glue with no branches, generated code | A renamed CSS variable |

Two rules decide most cases:

- **Push the test down.** If a unit test can prove it, do not write an API test
  for it. Lower tests are faster, they fail more precisely, and they do not rot
  when unrelated wiring changes.
- **Do not mock the thing under test.** A test that mocks the database, the
  service, and the clock proves that your mocks agree with each other. If proving
  something needs the real parts, that is an integration test, not a unit test
  with five stubs.

Say out loud which done-whens you are **not** covering and why. Silent omissions
are the failure mode here.

## Step 2 - write the tests

Follow the project's existing conventions before any general advice: file
location, naming, factory or fixture helpers, and assertion style. Read a nearby
existing test first. Consistency beats your preferred style.

- One behavior per test, named for the behavior, not the function:
  `rejects an expired token`, not `test validateToken 2`.
- Cover the branches that exist: the happy path, each error path, and the
  boundaries - empty, zero, one, maximum, null, wrong type.
- Use the real module. Stub only what is genuinely outside the boundary: network,
  clock, randomness, payment providers.
- For integration and API tests, use the project's real test database or test
  client, and reset state between tests instead of depending on execution order.
- Assert on observable results and on error messages users or callers actually
  see. Asserting that a mock was called is not a test of behavior.

## Step 3 - prove the tests can fail

A test that passes no matter what is worse than no test, because it reports
safety that is not there.

For each core assertion you wrote, confirm it genuinely fails when the expected
value is wrong: invert the expectation, run it, see it fail, then put it back.
Do this for the assertions that matter, not for every trivial one.

Then run the real suite with the command from `AGENTS.md`:

```bash
npm test
```

An empty run is not a pass. If the runner reports no tests, fix the path or the
file name before reporting success.

If `AGENTS.md` documents a `Verify` command and the diff touched types or config,
run `Verify` as the final gate.

## Step 4 - repair, in `fix` mode only

Skip this step entirely without the `fix` argument. Work one failure at a time and
decide honestly what is broken:

- **The test is wrong or stale.** The behavior changed on purpose and the test
  still asserts the old contract. Update the test.
- **The app is wrong.** The test was right and caught a real defect. Leave it
  failing and hand it to `/implement` or `/fix`. Repairing the test here would
  erase the bug report.
- **Unclear which one is intended.** Stop and ask, quoting the assertion and the
  actual value.

Never repair by deleting an assertion, loosening a matcher to `expect.anything()`,
adding a sleep, or skipping the test. If the user confirms a bug that stays open,
mark it skipped with a comment naming that decision - never silently.

## Step 5 - report as a table

One row per done-when:

| Done-when | Type | Test | Result | Note |
| --- | --- | --- | --- | --- |
| Expired tokens are rejected | unit | `src/auth/token.test.ts` | pass | 4 cases incl. boundary |
| Orders persist with their line items | integration | `tests/orders.int.test.ts` | pass | real test DB |
| Bad payloads return 422 with field errors | api | `tests/api/orders.test.ts` | fail | product bug: returns 500, handed to `/implement` |
| Checkout button shows a spinner | - | - | deferred | browser flow, run `/e2e-spec` |
| Renamed brand color token | - | - | skipped | no branches to prove |

Below the table, add:

- the exact command run and the runner's pass/fail counts
- files added or changed
- done-whens deliberately left uncovered, and why
- product bugs found, handed to `/implement` or `/fix` rather than patched here
- the suggested next step: `/e2e-spec` when browser flows remain

Do not commit, merge, or push.

## Rules

- **Test files only.** This skill never edits product source to make a test pass.
- **Prove the test can fail** before reporting it as coverage.
- **Push tests down** to the cheapest type that proves the behavior.
- **A failing test that found a real bug stays failing** and gets reported.
- **No sleeps, no deleted assertions, no silent skips.**
- Browser flows belong to `/e2e-spec`. Runner setup belongs to `/tests`.

## Formatting

Format the output to match the project's conventions in
`blueprint/context/ai-interaction.md`: concise, scannable markdown, with lists for
enumerations and tables for matrices rather than dense paragraphs.
