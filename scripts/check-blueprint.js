const { spawnSync } = require("node:child_process");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const checks = [
  {
    name: "Static Blueprint contract",
    command: process.execPath,
    args: ["scripts/validate-blueprint.js"]
  },
  {
    name: "Skill routing evaluations",
    command: npmCommand,
    args: ["run", "test:routing"]
  },
  {
    name: "Installer unit tests",
    command: npmCommand,
    args: ["--prefix", "packages/create-agentkit", "test"]
  },
  {
    name: "Packed installer smoke tests",
    command: process.execPath,
    args: ["scripts/smoke-package.js"]
  }
];

for (const check of checks) {
  console.log(`\n[check] ${check.name}`);
  const result = spawnSync(check.command, check.args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      npm_config_audit: "false",
      npm_config_fund: "false",
      npm_config_update_notifier: "false"
    },
    stdio: "inherit"
  });

  if (result.error) {
    console.error(`[fail] ${check.name}: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(`[fail] ${check.name}`);
    process.exit(result.status || 1);
  }
}

console.log("\nagent-kit validation passed.");
