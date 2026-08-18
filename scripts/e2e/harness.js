const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..", "..");
const packageRoot = path.join(repoRoot, "packages", "agentkit-blueprint");
const runsRoot = path.join(__dirname, "runs");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function run(command, args, cwd, options = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...options
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(
      `${command} ${args.join(" ")} failed (${result.status}): ${(result.stderr || "").slice(0, 2000)}`
    );
  }

  return result;
}

function git(workspace, ...args) {
  return run("git", args, workspace).stdout.trim();
}

class Runner {
  constructor(scenarioName) {
    this.name = scenarioName;
    this.checks = [];
    this.currentPhase = "setup";
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    this.runDir = path.join(runsRoot, `${stamp}-${scenarioName}`);
    this.workspace = path.join(this.runDir, "workspace");
    this.phaseCount = 0;
    fs.mkdirSync(this.workspace, { recursive: true });
  }

  phase(name) {
    this.currentPhase = name;
    console.log(`\n== ${this.name} / ${name} ==`);
  }

  check(description, condition) {
    this.checks.push({ phase: this.currentPhase, description, passed: Boolean(condition) });
    console.log(`  ${condition ? "PASS" : "FAIL"}  ${description}`);
  }

  // Installs the packed local tarball into the run's workspace, so every
  // scenario exercises exactly what `npm publish` would ship.
  installBlueprint(adapterFlag = "--claude") {
    const artifacts = path.join(this.runDir, "artifacts");
    const runner = path.join(this.runDir, "npm-runner");
    fs.mkdirSync(artifacts, { recursive: true });
    fs.mkdirSync(runner, { recursive: true });

    run(npmCommand, ["pack", "--pack-destination", artifacts], packageRoot);
    const tarball = fs.readdirSync(artifacts).find((file) => file.endsWith(".tgz"));

    if (!tarball) {
      throw new Error("npm pack produced no tarball");
    }

    run(
      npmCommand,
      [
        "install",
        "--prefix",
        runner,
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--no-package-lock",
        path.join(artifacts, tarball)
      ],
      this.runDir
    );

    const binary = path.join(runner, "node_modules", "agentkit-blueprint", "bin", "agentkit-blueprint.js");
    run(process.execPath, [binary, "--target", this.workspace, adapterFlag, "--yes"], this.runDir);
  }

  gitInit() {
    run("git", ["init", "-b", "main"], this.workspace);
    run("git", ["config", "user.email", "e2e@ai-blueprint.test"], this.workspace);
    run("git", ["config", "user.name", "Blueprint E2E"], this.workspace);
  }

  write(relativePath, content) {
    const target = path.join(this.workspace, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }

  read(relativePath) {
    const target = path.join(this.workspace, relativePath);
    return fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null;
  }

  git(...args) {
    return git(this.workspace, ...args);
  }

  // One headless agent invocation. The transcript JSON is saved per phase so a
  // failing assertion can be traced back to what the agent actually did.
  claude(prompt, { maxTurns = 50, timeoutMs = 15 * 60 * 1000 } = {}) {
    this.phaseCount += 1;
    const args = ["-p", prompt, "--output-format", "json", "--max-turns", String(maxTurns), "--dangerously-skip-permissions"];

    if (process.env.E2E_MODEL) {
      args.push("--model", process.env.E2E_MODEL);
    }

    const env = { ...process.env };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;

    const result = run("claude", args, this.workspace, {
      allowFailure: true,
      timeout: timeoutMs,
      env
    });

    const logBase = path.join(this.runDir, `phase-${this.phaseCount}`);
    fs.writeFileSync(`${logBase}.stdout.json`, result.stdout || "");

    if (result.stderr) {
      fs.writeFileSync(`${logBase}.stderr.log`, result.stderr);
    }

    let transcript = null;

    try {
      transcript = JSON.parse(result.stdout);
    } catch {
      transcript = null;
    }

    return {
      status: result.status,
      resultText: transcript && typeof transcript.result === "string" ? transcript.result : "",
      transcript
    };
  }

  report() {
    const failed = this.checks.filter((check) => !check.passed);
    console.log(`\n${this.name}: ${this.checks.length - failed.length}/${this.checks.length} checks passed`);

    if (failed.length > 0) {
      console.log(`Artifacts: ${this.runDir}`);
    }

    return failed.length;
  }
}

function ensureClaudeAvailable() {
  const probe = spawnSync("claude", ["--version"], { encoding: "utf8" });

  if (probe.error || probe.status !== 0) {
    throw new Error("The claude CLI is required for e2e runs and was not found on PATH.");
  }
}

module.exports = { Runner, ensureClaudeAvailable };
