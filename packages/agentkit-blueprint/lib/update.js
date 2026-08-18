const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const CONTROL_DIR = "blueprint/.state";
const MANIFEST_PATH = `${CONTROL_DIR}/manifest.json`;
const MANIFEST_SCHEMA_VERSION = 1;
const MANAGED_ROOTS = {
  common: ["blueprint/README.md"],
  codex: [".agents/skills"],
  claude: [".claude/skills"]
};

function adapterListFromMode(adapter) {
  if (adapter === "both") {
    return ["codex", "claude"];
  }

  return [adapter];
}

function createManifest(version, adapters, templateFiles) {
  const managedFiles = {};

  for (const [relativePath, file] of [...templateFiles.entries()].sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    managedFiles[relativePath] = file.hash;
  }

  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    version,
    adapters: [...adapters].sort(),
    managedFiles
  };
}

async function collectManagedTemplateFiles(templateRoot, adapters) {
  const files = new Map();
  const roots = [
    ...MANAGED_ROOTS.common,
    ...adapters.flatMap((adapter) => MANAGED_ROOTS[adapter] || [])
  ];

  for (const relativeRoot of roots) {
    const sourceRoot = path.join(templateRoot, ...relativeRoot.split("/"));
    await collectSourceFiles(sourceRoot, relativeRoot, files);
  }

  return files;
}

async function collectSourceFiles(sourcePath, relativePath, files) {
  const stats = await fs.lstat(sourcePath);

  if (stats.isSymbolicLink()) {
    throw new Error(`Managed template path cannot be a symbolic link: ${relativePath}`);
  }

  if (stats.isDirectory()) {
    const children = (await fs.readdir(sourcePath)).sort();

    for (const child of children) {
      await collectSourceFiles(
        path.join(sourcePath, child),
        `${relativePath}/${child}`,
        files
      );
    }

    return;
  }

  if (!stats.isFile()) {
    throw new Error(`Managed template path is not a regular file: ${relativePath}`);
  }

  files.set(relativePath, {
    source: sourcePath,
    hash: await hashFile(sourcePath)
  });
}

async function readManifest(targetDir) {
  const manifestFile = targetPath(targetDir, MANIFEST_PATH);
  await assertNoSymlinkParents(targetDir, MANIFEST_PATH);

  try {
    const manifest = JSON.parse(await fs.readFile(manifestFile, "utf8"));
    validateManifest(manifest);
    return manifest;
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }

    if (error instanceof SyntaxError) {
      throw new Error(`Invalid Blueprint manifest JSON: ${MANIFEST_PATH}`);
    }

    throw error;
  }
}

function validateManifest(manifest) {
  const validAdapters = ["codex", "claude"];
  const validManagedFiles =
    manifest &&
    manifest.managedFiles &&
    typeof manifest.managedFiles === "object" &&
    !Array.isArray(manifest.managedFiles) &&
    Object.entries(manifest.managedFiles).every(
      ([relativePath, hash]) =>
        isSafeRelativePath(relativePath) &&
        typeof hash === "string" &&
        /^[a-f0-9]{64}$/.test(hash)
    );
  const manifestAdapters = Array.isArray(manifest?.adapters)
    ? manifest.adapters
    : [];
  const uniqueAdapters = new Set(manifestAdapters);

  if (
    !manifest ||
    manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION ||
    typeof manifest.version !== "string" ||
    !Array.isArray(manifest.adapters) ||
    manifest.adapters.length === 0 ||
    !manifestAdapters.every((adapter) => validAdapters.includes(adapter)) ||
    uniqueAdapters.size !== manifestAdapters.length ||
    !validManagedFiles
  ) {
    throw new Error(`Unsupported or invalid Blueprint manifest: ${MANIFEST_PATH}`);
  }
}

async function prepareUpdate({ targetDir, templateRoot, version }) {
  const realTargetDir = await fs.realpath(targetDir);
  const manifest = await readManifest(realTargetDir);
  const adapters = await detectInstalledAdapters(realTargetDir, manifest);

  if (adapters.length === 0) {
    throw new Error(
      "No installed Codex or Claude Blueprint skills were found in the target directory."
    );
  }

  const templateFiles = await collectManagedTemplateFiles(templateRoot, adapters);
  const desiredManifest = createManifest(version, adapters, templateFiles);
  const plan = {
    add: [],
    update: [],
    remove: [],
    conflicts: [],
    unchanged: []
  };

  for (const [relativePath, desired] of templateFiles) {
    const current = await getTargetFileState(realTargetDir, relativePath);

    if (current.type === "missing") {
      plan.add.push({ path: relativePath, desired });
      continue;
    }

    if (current.type !== "file") {
      plan.conflicts.push({
        path: relativePath,
        desired,
        current,
        operation: "replace",
        reason: `target is ${current.type}`
      });
      continue;
    }

    if (current.hash === desired.hash) {
      plan.unchanged.push({ path: relativePath, desired, current });
      continue;
    }

    const previousHash = manifest?.managedFiles[relativePath];

    if (previousHash && current.hash === previousHash) {
      plan.update.push({ path: relativePath, desired, current });
      continue;
    }

    plan.conflicts.push({
      path: relativePath,
      desired,
      current,
      operation: "replace",
      reason: previousHash ? "managed file was modified locally" : "legacy file has no baseline"
    });
  }

  if (manifest) {
    for (const [relativePath, previousHash] of Object.entries(manifest.managedFiles)) {
      if (templateFiles.has(relativePath) || !isManagedPath(relativePath, adapters)) {
        continue;
      }

      const current = await getTargetFileState(realTargetDir, relativePath);

      if (current.type === "missing") {
        continue;
      }

      if (current.type === "file" && current.hash === previousHash) {
        plan.remove.push({ path: relativePath, current });
        continue;
      }

      plan.conflicts.push({
        path: relativePath,
        desired: null,
        current,
        operation: "remove",
        reason:
          current.type === "file"
            ? "obsolete managed file was modified locally"
            : `obsolete target is ${current.type}`
      });
    }
  }

  sortPlan(plan);

  return {
    targetDir: realTargetDir,
    templateRoot,
    version,
    previousVersion: manifest?.version || "legacy",
    manifest,
    desiredManifest,
    adapters,
    templateFiles,
    plan
  };
}

async function applyPreparedUpdate(
  prepared,
  { replaceConflicts = false, now = () => new Date() } = {}
) {
  const { plan } = prepared;
  const unsafeConflict = plan.conflicts.find((conflict) => conflict.current.type !== "file");

  if (unsafeConflict) {
    throw new Error(
      `Refusing to update ${unsafeConflict.path}: ${unsafeConflict.reason}. Remove or replace that path manually.`
    );
  }

  if (plan.conflicts.length > 0 && !replaceConflicts) {
    throw new Error(
      `${plan.conflicts.length} managed file conflict${plan.conflicts.length === 1 ? "" : "s"} must be resolved or explicitly replaced.`
    );
  }

  const replacements = [
    ...plan.update,
    ...plan.conflicts.filter((conflict) => conflict.operation === "replace")
  ];
  const removals = [
    ...plan.remove,
    ...plan.conflicts.filter((conflict) => conflict.operation === "remove")
  ];
  const existingOperations = [...replacements, ...removals];
  const identifier = `${formatTimestamp(now())}-${sanitizeSegment(
    prepared.previousVersion
  )}-to-${sanitizeSegment(prepared.version)}-${crypto
    .randomBytes(4)
    .toString("hex")}`;
  const backupDir = existingOperations.length
    ? targetPath(prepared.targetDir, `${CONTROL_DIR}/backups/${identifier}`)
    : null;
  const stagingDir = targetPath(prepared.targetDir, `${CONTROL_DIR}/staging/${identifier}`);
  const previousManifestFile = targetPath(prepared.targetDir, MANIFEST_PATH);

  await assertPreparedTargetState(prepared);
  await assertNoSymlinkParents(
    prepared.targetDir,
    `${CONTROL_DIR}/backups/${identifier}/placeholder`
  );

  await fs.mkdir(stagingDir, { recursive: true });

  for (const operation of [...plan.add, ...replacements]) {
    const stageFile = path.join(stagingDir, ...operation.path.split("/"));
    await fs.mkdir(path.dirname(stageFile), { recursive: true });
    await fs.copyFile(operation.desired.source, stageFile);

    if ((await hashFile(stageFile)) !== operation.desired.hash) {
      throw new Error(
        `Blueprint template changed after the update plan was created: ${operation.path}`
      );
    }
  }

  if (backupDir) {
    for (const operation of existingOperations) {
      const backupFile = path.join(backupDir, "files", ...operation.path.split("/"));
      await fs.mkdir(path.dirname(backupFile), { recursive: true });
      await fs.copyFile(targetPath(prepared.targetDir, operation.path), backupFile);
    }

    try {
      await fs.copyFile(previousManifestFile, path.join(backupDir, "manifest.json"));
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }

    await fs.writeFile(
      path.join(backupDir, "backup.json"),
      `${JSON.stringify(
        {
          fromVersion: prepared.previousVersion,
          toVersion: prepared.version,
          replaced: replacements.map((operation) => operation.path),
          removed: removals.map((operation) => operation.path)
        },
        null,
        2
      )}\n`
    );
  }

  try {
    for (const operation of [...plan.add, ...replacements]) {
      const stageFile = path.join(stagingDir, ...operation.path.split("/"));
      await atomicCopy(stageFile, targetPath(prepared.targetDir, operation.path));
    }

    for (const operation of removals) {
      await fs.rm(targetPath(prepared.targetDir, operation.path), { force: true });
    }

    await writeManifest(prepared.targetDir, prepared.desiredManifest);
    await writeControlIgnore(prepared.targetDir);
  } catch (error) {
    try {
      for (const operation of plan.add) {
        await fs.rm(targetPath(prepared.targetDir, operation.path), { force: true });
      }

      if (backupDir) {
        for (const operation of existingOperations) {
          const backupFile = path.join(backupDir, "files", ...operation.path.split("/"));
          await atomicCopy(backupFile, targetPath(prepared.targetDir, operation.path));
        }
      }

      if (prepared.manifest) {
        await writeManifest(prepared.targetDir, prepared.manifest);
      } else {
        await fs.rm(previousManifestFile, { force: true });
      }
    } catch (rollbackError) {
      throw new Error(
        `Blueprint update failed: ${error.message}. Rollback also failed: ${rollbackError.message}`
      );
    }

    throw new Error(`Blueprint update failed and was rolled back: ${error.message}`);
  } finally {
    await fs.rm(stagingDir, { recursive: true, force: true });
  }

  return {
    added: plan.add.length,
    updated: replacements.length,
    removed: removals.length,
    unchanged: plan.unchanged.length,
    backupDir
  };
}

async function writeInstallManifest({ targetDir, templateRoot, version, adapter }) {
  const adapters = adapterListFromMode(adapter);
  const templateFiles = await collectManagedTemplateFiles(templateRoot, adapters);
  const manifest = createManifest(version, adapters, templateFiles);
  await writeManifest(targetDir, manifest);
  await writeControlIgnore(targetDir);
  return manifest;
}

async function detectInstalledAdapters(targetDir, manifest) {
  const adapters = new Set(manifest?.adapters || []);

  if (await pathExists(targetPath(targetDir, ".agents/skills"))) {
    adapters.add("codex");
  }

  if (await pathExists(targetPath(targetDir, ".claude/skills"))) {
    adapters.add("claude");
  }

  return ["codex", "claude"].filter((adapter) => adapters.has(adapter));
}

async function writeManifest(targetDir, manifest) {
  await assertNoSymlinkParents(targetDir, MANIFEST_PATH);
  await atomicWrite(
    targetPath(targetDir, MANIFEST_PATH),
    `${JSON.stringify(manifest, null, 2)}\n`
  );
}

async function writeControlIgnore(targetDir) {
  await assertNoSymlinkParents(targetDir, `${CONTROL_DIR}/.gitignore`);
  await atomicWrite(
    targetPath(targetDir, `${CONTROL_DIR}/.gitignore`),
    "backups/\nstaging/\n"
  );
}

async function getTargetFileState(targetDir, relativePath) {
  await assertNoSymlinkParents(targetDir, relativePath);
  const absolutePath = targetPath(targetDir, relativePath);

  try {
    const stats = await fs.lstat(absolutePath);

    if (stats.isSymbolicLink()) {
      return { type: "symbolic link" };
    }

    if (stats.isDirectory()) {
      return { type: "directory" };
    }

    if (!stats.isFile()) {
      return { type: "non-regular file" };
    }

    return { type: "file", hash: await hashFile(absolutePath) };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { type: "missing" };
    }

    throw error;
  }
}

async function assertNoSymlinkParents(targetDir, relativePath) {
  const parts = normalizeRelativePath(relativePath).split("/");
  let current = targetDir;

  for (const part of parts.slice(0, -1)) {
    current = path.join(current, part);

    try {
      const stats = await fs.lstat(current);

      if (stats.isSymbolicLink()) {
        throw new Error(`Refusing to write through symbolic-link directory: ${current}`);
      }

      if (!stats.isDirectory()) {
        throw new Error(`Managed path parent is not a directory: ${current}`);
      }
    } catch (error) {
      if (error.code === "ENOENT") {
        return;
      }

      throw error;
    }
  }
}

function isManagedPath(relativePath, adapters) {
  const roots = [
    ...MANAGED_ROOTS.common,
    ...adapters.flatMap((adapter) => MANAGED_ROOTS[adapter] || [])
  ];

  return roots.some(
    (root) => relativePath === root || relativePath.startsWith(`${root}/`)
  );
}

function sortPlan(plan) {
  for (const operations of Object.values(plan)) {
    operations.sort((a, b) => a.path.localeCompare(b.path));
  }
}

async function assertPreparedTargetState(prepared) {
  for (const operation of prepared.plan.add) {
    const current = await getTargetFileState(prepared.targetDir, operation.path);

    if (current.type !== "missing") {
      throw new Error(
        `Managed path changed after the update plan was created: ${operation.path}`
      );
    }
  }

  const existingOperations = [
    ...prepared.plan.update,
    ...prepared.plan.remove,
    ...prepared.plan.conflicts,
    ...prepared.plan.unchanged
  ];

  for (const operation of existingOperations) {
    const current = await getTargetFileState(prepared.targetDir, operation.path);
    const changed =
      current.type !== operation.current.type ||
      (current.type === "file" && current.hash !== operation.current.hash);

    if (changed) {
      throw new Error(
        `Managed path changed after the update plan was created: ${operation.path}`
      );
    }
  }
}

async function atomicCopy(source, target) {
  await atomicWrite(target, await fs.readFile(source));
}

async function atomicWrite(target, content) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = path.join(
    path.dirname(target),
    `.${path.basename(target)}.blueprint-${process.pid}-${crypto.randomBytes(4).toString("hex")}`
  );
  await fs.writeFile(temporary, content);

  try {
    await fs.rename(temporary, target);
  } catch (error) {
    if (!["EEXIST", "EPERM"].includes(error.code)) {
      await fs.rm(temporary, { force: true });
      throw error;
    }

    await fs.rm(target, { force: true });
    await fs.rename(temporary, target);
  }
}

async function hashFile(filePath) {
  const content = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

function targetPath(targetDir, relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  return path.join(targetDir, ...normalized.split("/"));
}

function normalizeRelativePath(relativePath) {
  const normalized = path.posix.normalize(String(relativePath).replaceAll("\\", "/"));

  if (!isSafeRelativePath(normalized)) {
    throw new Error(`Unsafe Blueprint path: ${relativePath}`);
  }

  return normalized;
}

function isSafeRelativePath(relativePath) {
  return (
    typeof relativePath === "string" &&
    relativePath.length > 0 &&
    relativePath !== "." &&
    !relativePath.includes("\\") &&
    path.posix.normalize(relativePath) === relativePath &&
    !path.posix.isAbsolute(relativePath) &&
    relativePath !== ".." &&
    !relativePath.startsWith("../") &&
    !relativePath.includes("/../")
  );
}

function formatTimestamp(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z").replaceAll(":", "-");
}

function sanitizeSegment(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]+/g, "-");
}

module.exports = {
  CONTROL_DIR,
  MANAGED_ROOTS,
  MANIFEST_PATH,
  adapterListFromMode,
  applyPreparedUpdate,
  collectManagedTemplateFiles,
  createManifest,
  prepareUpdate,
  readManifest,
  writeInstallManifest
};
