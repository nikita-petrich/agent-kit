const fs = require("node:fs/promises");
const path = require("node:path");

const templateRoot = path.join(__dirname, "..", "template");

fs.rm(templateRoot, { recursive: true, force: true }).catch((error) => {
  console.error(error.message);
  process.exit(1);
});
