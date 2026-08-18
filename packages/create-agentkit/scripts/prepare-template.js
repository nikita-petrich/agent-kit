const fs = require("node:fs/promises");
const path = require("node:path");

const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const templateRoot = path.join(packageRoot, "template");

const entries = ["AGENTS.md", "CLAUDE.md", ".agents", ".claude", "blueprint"];

async function copyEntry(entry) {
  const source = path.join(repoRoot, entry);
  const target = path.join(templateRoot, entry);
  await fs.cp(source, target, { recursive: true });
}

async function main() {
  await fs.rm(templateRoot, { recursive: true, force: true });
  await fs.mkdir(templateRoot, { recursive: true });

  for (const entry of entries) {
    await copyEntry(entry);
  }

  await fs.copyFile(
    path.join(repoRoot, "README.md"),
    path.join(templateRoot, "blueprint", "README.md")
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
