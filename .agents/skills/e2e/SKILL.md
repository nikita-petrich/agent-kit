---
name: e2e
description: Add or normalize end-to-end browser testing for a Blueprint project using Playwright and the Playwright CLI. Detects the stack and any existing Playwright setup, installs the test runner and browsers when missing, writes a project-shaped config with a webServer, adds a seed test and one smoke spec, records the E2E commands in AGENTS.md, and runs the smoke spec once. Use when the user runs /e2e, invokes $e2e, asks to add end-to-end tests, set up Playwright, add browser testing, or make browser flows part of the Blueprint workflow.
---

# e2e - add end-to-end browser testing to the project

Where this sits in the workflow:

    any time  ->  [e2e]  ->  E2E commands in AGENTS.md  ->  /e2e-spec + /e2e-check
                  (setup)    (the opt-in browser gate)     (author and prove flows)

End-to-end testing is optional in the Blueprint until the project declares real
E2E commands in `AGENTS.md`. This skill is the explicit setup path. It sets up
**browser end-to-end testing only**. Unit testing stays with `/tests`, and
automatic GitHub checks stay with `/ci`.

Two different Playwright tools are involved, and they do different jobs:

- **`@playwright/test`** is the test runner. It owns `playwright.config.*`, the
  spec files, and `npx playwright test`. This is what CI and `/e2e-check` run.
- **`playwright-cli`** (`@playwright/cli`) is the agent-facing command line. It
  drives a real browser one command at a time and prints the equivalent
  Playwright TypeScript for each action. `/e2e-spec` uses it to author specs and
  `/e2e-check` uses it to diagnose failures.

Set up both. The runner is the durable artifact; the CLI is how the agent writes
and repairs it without guessing selectors.

## Input

No argument is required. If the user names a browser, base URL, or directory
preference, treat it as a preference and verify it against the project files.

## Step 1 - inspect the project

Read enough files to identify the real setup:

- `AGENTS.md` Commands section, including any documented `Verify` command
- package or language manifest and the lockfile that implies the package manager
- existing `playwright.config.*`, `cypress.config.*`, or other E2E config
- existing test directories and what they already cover
- how the app is served locally: dev command, build command, start command, port
- `blueprint/context/project-overview.md` for the primary user flow
- `blueprint/context/coding-standards.md`

Do not assume Next.js, npm, or port 3000. Detect them.

If an E2E runner is already configured, reuse it. Do not add Playwright next to
an existing Cypress or WebdriverIO setup unless the user explicitly asks for the
switch; report the existing setup and stop instead.

The Playwright Node runner drives the browser, not the backend, so it works for a
Django, Rails, Laravel, or Go app just as well as a Node app. Use it whenever the
project serves a web UI. If the project has no browser UI at all, say so and stop
rather than installing a browser runner it cannot use.

## Step 2 - install the runner and browsers

Skip anything already present. Installing browsers downloads a few hundred MB, so
ask for approval through the current tool's approval flow before running it.

```bash
npm init playwright@latest
```

The scaffolder asks for a test directory, whether to add a GitHub Actions
workflow, and whether to install browsers. Answer with the project's real
choices: **decline the GitHub Actions workflow** here, because CI stays an
explicit `/ci` decision.

When Playwright is already a dependency but browsers are missing:

```bash
npx playwright install --with-deps
```

Use the project's package manager for every install command.

## Step 3 - make the runner match the project

Keep the config small and project-shaped. Set only what the project needs:

- `testDir` pointing at the E2E directory (`tests/e2e` unless the project already
  has a convention)
- `use.baseURL` from the real local URL, so specs can use relative paths
- `use.trace: "on-first-retry"` so `/e2e-check` has evidence when something fails
- `webServer` with the project's real command, URL, and
  `reuseExistingServer: !process.env.CI`, so the suite starts the app itself
- `retries` only in CI, not locally, so local flakes stay visible
- the browser projects the project actually cares about; one Chromium project is
  a fine start

Example only. Detect the real commands and paths before writing anything:

```ts
// playwright.config.ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry"
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI
  }
});
```

## Step 4 - add the seed test and one smoke spec

Two files, both small.

The **seed test** lands the browser in the state every scenario starts from:
navigation to the app, and any login or feature flag the app always needs. It
exists so `/e2e-spec` can pause inside real project setup instead of opening a
bare URL. Push shared setup into a fixture when there is any, so specs reuse it.

```ts
// tests/e2e/fixtures.ts
import { test as baseTest } from "@playwright/test";

export { expect } from "@playwright/test";

export const test = baseTest.extend({
  page: async ({ page }, use) => {
    await page.goto("/");
    await use(page);
  }
});
```

```ts
// tests/e2e/seed.spec.ts
import { test } from "./fixtures";

test("seed", async () => {
  // The fixture already navigates. This test is the attach point for /e2e-spec.
});
```

The **smoke spec** proves the whole chain works: server starts, browser launches,
a real page renders. Assert one thing that is true today and would be false if the
app were broken. Do not write a suite here; `/e2e-spec` adds feature coverage
later.

```ts
// tests/e2e/smoke.spec.ts
import { expect, test } from "./fixtures";

test("app renders its landing page", async ({ page }) => {
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});
```

Use a role, label, or test-id locator, never a brittle CSS chain. If the app has
no stable landing heading, pick another element that is genuinely stable and say
which one you chose.

## Step 5 - make the agent CLI available

`/e2e-spec` and `/e2e-check` need `playwright-cli`. Check for it in this order and
record which one the project should use:

```bash
npx --no-install playwright --version   # local Playwright: use `npx playwright cli`
playwright-cli --help                   # global install already present
```

If neither is available, ask before installing it globally:

```bash
npm install -g @playwright/cli@latest
```

The CLI writes snapshots and traces to `.playwright-cli/`. Add that directory,
plus Playwright's `test-results/` and `playwright-report/`, to `.gitignore` if the
scaffolder did not.

## Step 6 - record the commands in AGENTS.md

Add the real commands to the Commands section, using the detected package
manager. Set `PLAYWRIGHT_HTML_OPEN=never` on run commands so an agent run never
blocks on the interactive HTML report.

```text
- E2E tests: `PLAYWRIGHT_HTML_OPEN=never npx playwright test`
- E2E report: `npx playwright show-report`
- E2E CLI: `playwright-cli` (or `npx playwright cli` when installed locally)
```

Leave the `Verify` command alone by default. E2E runs need a browser download and
a booted app, so folding them into every `Verify` makes the fast inner loop slow.
Offer it as an explicit choice and only change `Verify` if the user says yes.

Update `blueprint/context/coding-standards.md` only if the project needs an E2E
convention that differs from the default, such as a required test-id attribute.

## Step 7 - verify

Run the smoke spec once:

```bash
PLAYWRIGHT_HTML_OPEN=never npx playwright test tests/e2e/smoke.spec.ts
```

An empty run is not a pass. If Playwright reports no tests, fix the `testDir` or
the file name before reporting success.

If a `Verify` command exists and the diff touched config or types it covers, run
`Verify` too.

## Step 8 - report

Stop with a concise report:

- existing E2E setup found, and whether it was reused or left alone
- runner and browsers installed, or confirmation they were already present
- config values set: test directory, base URL, web server command, trace mode
- files added
- commands added to `AGENTS.md`, and whether `Verify` was left unchanged
- `playwright-cli` availability and how the project invokes it
- smoke spec result
- suggested next step: `/e2e-spec` once a feature spec is active

Show the diff summary. Do not commit, merge, push, or start product feature work.

## Rules

- Browser E2E only. Unit testing is `/tests`. CI is `/ci`.
- Reuse an existing E2E runner before adding another one.
- Never create a GitHub workflow here, and decline the scaffolder's offer to add
  one.
- Never add E2E to `Verify` without explicit approval.
- One smoke spec. Feature coverage is `/e2e-spec`'s job.
- Ask before installing browsers or global packages; both are large or
  machine-wide.
- Do not hide install or run failures. Report exactly what failed and what to fix.

## Formatting

Format the output to match the project's conventions in
`blueprint/context/ai-interaction.md`: concise, scannable markdown, with lists for
enumerations and tables for matrices rather than dense paragraphs.
