/**
 * Minimal .env loader (no external deps).
 *
 * - Loads ".env" then ".env.local" from project root if present
 * - Does NOT override already-defined process.env values
 * - Supports:
 *    KEY=VALUE
 *    export KEY=VALUE
 *    comments starting with #
 *    single/double-quoted values
 */
const fs = require("fs");
const path = require("path");

function stripBOM(s) {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function parseEnv(content) {
  const out = {};
  const lines = stripBOM(String(content)).split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const normalized = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const eqIdx = normalized.indexOf("=");
    if (eqIdx <= 0) continue;

    const key = normalized.slice(0, eqIdx).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    let value = normalized.slice(eqIdx + 1).trim();

    // Remove inline comment for unquoted values: KEY=value # comment
    if (!(value.startsWith("'") || value.startsWith('"'))) {
      const hashIdx = value.indexOf(" #");
      if (hashIdx !== -1) value = value.slice(0, hashIdx).trim();
    }

    // Unquote
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    out[key] = value;
  }

  return out;
}

function loadOne(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const parsed = parseEnv(content);
    for (const [k, v] of Object.entries(parsed)) {
      if (process.env[k] === undefined) process.env[k] = v;
    }
  } catch (err) {
    if (err && (err.code === "ENOENT" || err.code === "ENOTDIR")) return;
    // Keep startup resilient: don't crash the app on env parsing issues
  }
}

const root = __dirname;
loadOne(path.join(root, ".env"));
loadOne(path.join(root, ".env.local"));

