---
name: e2e-spec
description: Turn the current feature's observable "done when" criteria into real Playwright end-to-end specs, or repair specs that drifted from the app. Explores the running app with the Playwright CLI so locators and assertions come from the real page instead of guesswork, writes one spec per scenario, runs the new specs once, and reports what is covered and what is not. Use when the user runs /e2e-spec, invokes $e2e-spec, asks to write or update end-to-end tests, record a browser flow, or fix failing Playwright specs.
---

# e2e-spec - write E2E specs from the current spec

Where this sits in the workflow:

    /implement  ->  [e2e-spec]  ->  /e2e-check  ->  /complete
    (built the      (turn done-whens   (run the suite,   (with the flow
     behavior)       into specs)        prove the flow)   covered)

`/check` proves a done-when once, by hand, in this session. `/e2e-spec` turns the
done-whens worth keeping into a spec file that keeps proving them on every later
run. Not every done-when deserves that: a one-off copy tweak does not, a login
flow or a checkout does.

This skill writes test files. It never edits product source. If the app is wrong,
that goes back to `/implement` or `/fix`.

## Prerequisites

`AGENTS.md` must declare the E2E commands. If it does not, stop and point at
`/e2e`. Do not install Playwright from here.

`playwright-cli` must be available, either globally or as `npx playwright cli`.
Every action it performs prints the equivalent Playwright TypeScript, and that
generated code is the raw material for the specs. Writing locators from reading
source instead is exactly the guesswork this skill exists to avoid.

## Input

Optional. With no argument, cover the current feature's done-whens. Accepts:

- a named scenario or flow to cover
- a failing spec path to repair, such as `tests/e2e/checkout.spec.ts`
- `heal` to work through every currently failing spec

## Step 1 - decide what deserves a spec

Read `blueprint/context/current-feature.md` and pull the observable done-whens.
Sort them:

| Cover with an E2E spec | Leave to `/check` or a unit test |
| --- | --- |
| A user journey across pages or steps | A pure function's edge cases (unit test) |
| A flow that breaks quietly when it regresses | A one-time visual tweak |
| Auth, payment, upload, or other high-cost failure | Something not observable in a browser |
| A bug that already shipped once | A flow the app cannot reach yet |

Name the scenarios in kebab-case, one file each, and say out loud which done-whens
you are *not* covering and why. Silent omissions are the failure mode here.

If no feature spec is active and the user named nothing, ask what flow to cover
rather than inventing coverage.

## Step 2 - drive the real app

Start the seed test paused, in the background, then attach the CLI to it. Going
through the seed matters: it carries the project's real setup, which opening a
bare URL would skip.

```bash
PLAYWRIGHT_HTML_OPEN=never npx playwright test tests/e2e/seed.spec.ts --debug=cli
```

Wait for the printed debugging instructions and the `tw-XXXX` session name, then:

```bash
playwright-cli attach tw-XXXX
playwright-cli resume     # let the seed finish so the app is in its start state
playwright-cli snapshot   # inventory of interactive elements and their refs
```

Walk the scenario one user step at a time. Each command prints the Playwright code
it ran; collect it:

```bash
playwright-cli fill e3 "user@example.com"
playwright-cli fill e5 "correct horse battery staple" --submit
playwright-cli click e9
playwright-cli snapshot
```

When something is unclear, look instead of guessing:

```bash
playwright-cli find "Sign in"                       # locate text in a large page
playwright-cli --raw generate-locator e5            # stable locator for an assertion
playwright-cli --raw eval "el => el.textContent" e7 # expected value for an assertion
playwright-cli console                              # app-side errors
playwright-cli requests                             # failed or wrong requests
```

Stop the background test run and close the CLI session before moving to the next
scenario. Generate scenarios one at a time; they share the seed.

## Step 3 - write the spec file

One test per file, at the path named in step 1, importing the project's fixtures
when they exist.

- Paste the generated actions; do not retype locators from memory.
- Prefer the semantic locators the CLI generates - `getByRole`, `getByLabel`,
  `getByTestId` - over CSS chains.
- Comment each user step so a reviewer can read the flow without running it.
- Add an assertion for every observable outcome. Generated code captures actions,
  never expectations, so assertions are always hand-added:
  `toBeVisible`, `toHaveText`, `toHaveValue`, `toBeChecked`, `toHaveURL`, or
  `toMatchAriaSnapshot` for a region.
- When a locator is text-based, assert `toBeVisible` rather than re-asserting the
  same text.

```ts
// tests/e2e/sign-in.spec.ts
import { expect, test } from "./fixtures";

test("signs in with valid credentials", async ({ page }) => {
  // 1. Enter the email address
  await page.getByRole("textbox", { name: "Email" }).fill("user@example.com");

  // 2. Enter the password and submit
  await page.getByRole("textbox", { name: "Password" }).fill("s3cret");
  await page.getByRole("button", { name: "Sign in" }).click();

  // done when: the dashboard greets the signed-in user
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
});
```

Each scenario must start from the seed's clean state and pass on its own. Never
chain one spec's outcome into the next.

## Step 4 - repair instead of write, when healing

When the target is a failing spec rather than a new one, the loop is the same
with a different starting point:

```bash
PLAYWRIGHT_HTML_OPEN=never npx playwright test tests/e2e/checkout.spec.ts:12 --debug=cli
playwright-cli attach tw-XXXX
```

Step to just before the failing action, then diagnose with `snapshot`, `console`,
and `requests`. Usual causes: a renamed label, a new wrapper element, an assertion
the app deliberately changed, or data leaking between runs.

Then decide honestly what is broken:

- **The test drifted, the app is right.** Fix the locator or assertion here.
- **The app regressed, the test was right.** Leave the spec failing and hand it to
  `/implement` or `/fix`. Repairing the test would erase the bug report.
- **Unclear which one is intended.** Stop and ask, quoting the spec line and the
  observed behavior.

Never fix a failure with a sleep, a skipped hook, or `networkidle`. If the user
confirms a real bug that will not be fixed now, mark the spec `test.fixme` with a
comment naming that decision - never a silent skip.

## Step 5 - run what you wrote

```bash
PLAYWRIGHT_HTML_OPEN=never npx playwright test tests/e2e/sign-in.spec.ts
```

Run each new or repaired spec, then run it a second time. A spec that passes once
and fails once is a flake, and shipping a flake is worse than shipping no spec:
fix the race or drop the spec, and say which you did.

## Step 6 - report

Stop with a concise report:

- scenarios covered, with file paths
- done-whens deliberately left uncovered, and why
- specs repaired, and whether the cause was test drift or a product bug
- product bugs found, handed to `/implement` or `/fix` rather than patched here
- run results, including the repeat run
- suggested next step: `/e2e-check` for the full suite verdict

Show the diff summary. Do not commit, merge, or push.

## Rules

- **Test files only.** This skill never edits product source to make a spec pass.
- **Locators come from the running app**, through `playwright-cli`, not from
  reading components.
- **Every assertion is hand-written.** Recorded actions alone prove nothing.
- **One scenario per file, independent of every other scenario.**
- **A failing spec that found a real bug stays failing** and gets reported.
- **No sleeps, no `networkidle`, no silent skips.**
- Stop background debug runs and close CLI sessions when done.

## Formatting

Format the output to match the project's conventions in
`blueprint/context/ai-interaction.md`: concise, scannable markdown, with lists for
enumerations and tables for matrices rather than dense paragraphs.
