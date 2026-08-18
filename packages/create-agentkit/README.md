# create-agentkit

Install the agent-kit workflow into an already scaffolded app: spec-driven build
loop, plus unit and Playwright end-to-end testing skills.

[![npm version](https://img.shields.io/npm/v/create-agentkit?style=flat-square&color=155eef)](https://www.npmjs.com/package/create-agentkit)
[![Validate Blueprint](https://github.com/nikita-petrich/agent-kit/actions/workflows/validate.yml/badge.svg)](https://github.com/nikita-petrich/agent-kit/actions/workflows/validate.yml)
[![MIT license](https://img.shields.io/npm/l/create-agentkit?style=flat-square&color=155eef)](LICENSE)

[Repository](https://github.com/nikita-petrich/agent-kit) |
[Changelog](https://github.com/nikita-petrich/agent-kit/blob/main/CHANGELOG.md) |
[Upstream docs](https://ai-blueprint.dev/docs/)

Requires Node.js 18 or newer. Run the installer from an application that has
already been scaffolded and initialized as a Git repository.

```bash
npx create-agentkit@latest
```

You can also use npm's initializer form:

```bash
npm create agentkit@latest
```

The installer copies the Blueprint workflow files into the current directory:

- `AGENTS.md`
- `CLAUDE.md`
- `blueprint/.state/manifest.json`
- `.agents/`
- `.claude/`
- `blueprint/`

It keeps the app's root `README.md` alone and installs the Blueprint workflow
docs at `blueprint/README.md`.

The installed workflow includes optional Render and Vercel deployment readiness
through `/release` or `$release`; it prepares local config and checks, but does
not deploy without explicit approval.

The optional `/ci` or `$ci` skill sets up automatic GitHub checks separately
from onboarding and adoption. It detects the real project commands, defines one
Verify command from checks that already exist, and adds a matching pull request
workflow without replacing existing CI. It does not invent tests or add git
hooks, coverage, browser tests, security scans, or version matrices by default.

Browser end-to-end testing is its own opt-in. `/e2e` or `$e2e` sets up Playwright
and the Playwright CLI, `/e2e-spec` turns the current spec's done-whens into
Playwright specs by driving the running app, and `/e2e-check` runs the suite and
triages each failure. The setup skill creates no CI and leaves the Verify command
unchanged unless you ask for it.

It also includes `/rollback` or `$rollback` for planning a reviewed reversal of
a completed feature from its archived spec and exact git commit. Rollbacks keep
the original feature archive and use the normal implement, check, and complete
gates.

If you install the Blueprint while Claude Code is already open in the project,
restart Claude Code in that folder so the newly added project skills appear.

## Tool support

| Tool | Installed adapter | Invocation |
| --- | --- | --- |
| Codex | `.agents/skills/` | `$feature`, `$implement`, or plain language |
| Claude Code | `.claude/skills/` | `/feature`, `/implement`, and other slash commands |
| Other tools | `AGENTS.md` plus readable skill files | Ask the agent to follow the matching `SKILL.md` |

## Options

```bash
npx create-agentkit@latest -- --codex
npx create-agentkit@latest -- --claude
npx create-agentkit@latest -- --both
npx create-agentkit@latest -- --force
npx create-agentkit@latest -- --target ./my-app
```

The same flags work with `npm create agentkit@latest -- ...`.

Use `--force` to overwrite existing Blueprint files. Without `--force`, the
installer asks before overwriting in an interactive terminal and exits in
non-interactive runs.

## Updating an existing installation

Preview the update plan:

```bash
npx create-agentkit@latest update --dry-run
```

Apply the update:

```bash
npx create-agentkit@latest update
```

The updater detects the installed adapters and manages only these paths:

- `.agents/skills/`
- `.claude/skills/`
- `blueprint/README.md`

It preserves `AGENTS.md`, `CLAUDE.md`, project and build plans, context, history,
references, and prototypes. The `blueprint/.state/manifest.json` file records the
installed version and hashes of managed files.

Locally modified managed files are reported as conflicts. Interactive updates
ask before replacing them. Non-interactive updates exit unless you pass
`--force`, which backs up the conflicting files before replacement. Backups are
stored under `blueprint/.state/backups/` and ignored by git.

The first update of a legacy install creates the manifest. Files that already
match the current package are adopted automatically. Differing files remain
conflicts so local changes are not lost.

## Help and contributing

- Read the [upstream documentation](https://ai-blueprint.dev/docs/).
- Report reproducible problems through the repository's
  [issue forms](https://github.com/nikita-petrich/agent-kit/issues/new/choose).
- Follow the repository's
  [security policy](https://github.com/nikita-petrich/agent-kit/security/policy)
  for private vulnerability reports.
- Read the
  [contribution guide](https://github.com/nikita-petrich/agent-kit/blob/main/CONTRIBUTING.md)
  before opening a pull request.

## License

MIT
