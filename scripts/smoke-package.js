const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const packageRoot = path.join(repoRoot, "packages", "agentkit-blueprint");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const modes = {
  codex: ["codex"],
  claude: ["claude"],
  both: ["claude", "codex"]
};

async function main() {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "ai-blueprint-package-"));

  try {
    const artifactsDir = path.join(workspace, "artifacts");
    const runnerDir = path.join(workspace, "runner");
    await fs.mkdir(artifactsDir, { recursive: true });
    await fs.mkdir(runnerDir, { recursive: true });

    run(npmCommand, ["pack", "--pack-destination", artifactsDir], packageRoot);
    const artifacts = (await fs.readdir(artifactsDir)).filter((file) =>
      file.endsWith(".tgz")
    );

    if (artifacts.length !== 1) {
      throw new Error(`Expected one package artifact, found ${artifacts.length}`);
    }

    const tarball = path.join(artifactsDir, artifacts[0]);
    run(
      npmCommand,
      [
        "install",
        "--prefix",
        runnerDir,
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--no-package-lock",
        tarball
      ],
      workspace
    );

    const installedPackageRoot = path.join(
      runnerDir,
      "node_modules",
      "agentkit-blueprint"
    );
    const binary = path.join(installedPackageRoot, "bin", "agentkit-blueprint.js");
    const metadata = JSON.parse(
      await fs.readFile(path.join(installedPackageRoot, "package.json"), "utf8")
    );
    await requirePath(path.join(installedPackageRoot, "lib", "update.js"));
    await requirePath(path.join(installedPackageRoot, "template", "blueprint", "README.md"));
    await requireMissing(path.join(installedPackageRoot, "evals"));
    await requireMissing(path.join(installedPackageRoot, "scripts", "evals"));
    await requireMissing(path.join(installedPackageRoot, "scripts", "e2e"));

    for (const [mode, adapters] of Object.entries(modes)) {
      const targetDir = path.join(workspace, `target-${mode}`);
      await fs.mkdir(targetDir, { recursive: true });
      run(
        process.execPath,
        [binary, "--target", targetDir, `--${mode}`, "--yes"],
        workspace
      );
      await validateInstall(targetDir, metadata.version, adapters);

      const updateResult = run(
        process.execPath,
        [binary, "update", "--target", targetDir, "--dry-run"],
        workspace,
        true
      );

      for (const expectedLine of [
        "Add: 0",
        "Update: 0",
        "Remove: 0",
        "Conflicts: 0"
      ]) {
        if (!updateResult.stdout.includes(expectedLine)) {
          throw new Error(
            `${mode} update smoke test did not report ${expectedLine.toLowerCase()}`
          );
        }
      }
    }

    console.log("Packed installer passed for codex, claude, and both adapter modes.");
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
}

async function validateInstall(targetDir, version, adapters) {
  const expectsCodex = adapters.includes("codex");
  const expectsClaude = adapters.includes("claude");
  const expectedPaths = [
    "AGENTS.md",
    "blueprint/README.md",
    "blueprint/project-plan.md",
    "blueprint/build-plan.md",
    "blueprint/context/findings.md",
    "blueprint/.state/manifest.json",
    "blueprint/.state/.gitignore"
  ];

  if (expectsCodex) {
    expectedPaths.push(
      ".agents/skills/discovery/SKILL.md",
      ".agents/skills/onboard/SKILL.md",
      ".agents/skills/rollback/SKILL.md"
    );
  }

  if (expectsClaude) {
    expectedPaths.push(
      "CLAUDE.md",
      ".claude/skills/discovery/SKILL.md",
      ".claude/skills/onboard/SKILL.md",
      ".claude/skills/rollback/SKILL.md"
    );
  }

  for (const relativePath of expectedPaths) {
    await requirePath(path.join(targetDir, ...relativePath.split("/")));
  }

  await requireMissing(path.join(targetDir, "README.md"));
  await requireMissing(path.join(targetDir, ".ai-blueprint"));

  if (!expectsCodex) {
    await requireMissing(path.join(targetDir, ".agents"));
  }

  if (!expectsClaude) {
    await requireMissing(path.join(targetDir, ".claude"));
    await requireMissing(path.join(targetDir, "CLAUDE.md"));
  }

  const manifest = JSON.parse(
    await fs.readFile(
      path.join(targetDir, "blueprint", ".state", "manifest.json"),
      "utf8"
    )
  );

  if (manifest.schemaVersion !== 1) {
    throw new Error(`Unsupported installed manifest schema: ${manifest.schemaVersion}`);
  }

  if (manifest.version !== version) {
    throw new Error(`Installed version mismatch: ${manifest.version} !== ${version}`);
  }

  if (JSON.stringify(manifest.adapters) !== JSON.stringify(adapters)) {
    throw new Error(
      `Installed adapters mismatch: ${manifest.adapters.join(", ")} !== ${adapters.join(", ")}`
    );
  }

  const expectedManagedFiles = ["blueprint/README.md"];

  if (expectsCodex) {
    expectedManagedFiles.push(
      ...(await listFiles(path.join(targetDir, ".agents", "skills"))).map(
        (file) => `.agents/skills/${file}`
      )
    );
  }

  if (expectsClaude) {
    expectedManagedFiles.push(
      ...(await listFiles(path.join(targetDir, ".claude", "skills"))).map(
        (file) => `.claude/skills/${file}`
      )
    );
  }

  const installedManagedFiles = Object.keys(manifest.managedFiles).sort();

  if (
    JSON.stringify(expectedManagedFiles.sort()) !==
    JSON.stringify(installedManagedFiles)
  ) {
    throw new Error("Installed manifest does not match the managed file inventory");
  }

  for (const [relativePath, expectedHash] of Object.entries(manifest.managedFiles)) {
    const installedFile = path.join(targetDir, ...relativePath.split("/"));
    const actualHash = crypto
      .createHash("sha256")
      .update(await fs.readFile(installedFile))
      .digest("hex");

    if (actualHash !== expectedHash) {
      throw new Error(`Managed file hash mismatch: ${relativePath}`);
    }
  }
}

async function listFiles(root) {
  const files = [];

  async function visit(current, relative) {
    const entries = await fs.readdir(current, { withFileTypes: true });

    for (const entry of entries) {
      const nextRelative = relative ? `${relative}/${entry.name}` : entry.name;
      const nextPath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        await visit(nextPath, nextRelative);
      } else if (entry.isFile()) {
        files.push(nextRelative);
      } else {
        throw new Error(`Unsupported installed entry: ${nextRelative}`);
      }
    }
  }

  await visit(root, "");
  return files.sort();
}

function run(command, args, cwd, capture = false) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      npm_config_audit: "false",
      npm_config_fund: "false",
      npm_config_update_notifier: "false"
    },
    stdio: capture ? "pipe" : "inherit"
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const detail = capture ? result.stderr.trim() : "";
    throw new Error(
      `${command} ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`
    );
  }

  return result;
}

async function requirePath(filePath) {
  try {
    await fs.access(filePath);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`Expected packaged path is missing: ${filePath}`);
    }

    throw error;
  }
}

async function requireMissing(filePath) {
  try {
    await fs.access(filePath);
  } catch (error) {
    if (error.code === "ENOENT") {
      return;
    }

    throw error;
  }

  throw new Error(`Unexpected installed path: ${filePath}`);
}

main().catch((error) => {
  console.error(`Packed installer smoke test failed: ${error.message}`);
  process.exit(1);
});
