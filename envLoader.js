import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const envFiles = [".env", ".env.local"];
const protectedEnvKeys = new Set(Object.keys(process.env));

for (const envFile of envFiles) {
  const filePath = resolve(rootDir, envFile);

  if (!existsSync(filePath)) {
    continue;
  }

  const source = readFileSync(filePath, "utf8");
  const entries = parseEnvFile(source);

  for (const [key, value] of entries) {
    if (protectedEnvKeys.has(key)) {
      continue;
    }

    process.env[key] = value;
  }
}

function parseEnvFile(source) {
  const entries = [];
  const lines = String(source || "").split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const normalized = line.startsWith("export ") ? line.slice(7).trim() : line;
    const separatorIndex = normalized.indexOf("=");

    if (separatorIndex <= 0) {
      continue;
    }

    const key = normalized.slice(0, separatorIndex).trim();
    const rawValue = normalized.slice(separatorIndex + 1).trim();

    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue;
    }

    entries.push([key, normalizeEnvValue(rawValue)]);
  }

  return entries;
}

function normalizeEnvValue(value) {
  const text = String(value || "").trim();

  if (!text) {
    return "";
  }

  if (
    (text.startsWith("\"") && text.endsWith("\""))
    || (text.startsWith("'") && text.endsWith("'"))
  ) {
    const unquoted = text.slice(1, -1);
    return text.startsWith("\"")
      ? unquoted
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\r")
        .replace(/\\t/g, "\t")
        .replace(/\\"/g, "\"")
        .replace(/\\\\/g, "\\")
      : unquoted;
  }

  return text.replace(/\s+#.*$/, "").trim();
}
