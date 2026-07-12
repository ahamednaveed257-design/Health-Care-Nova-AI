#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const VERSION_TARGETS = [
  "src/healthEngine.js",
  "public/index.html",
  "public/site.webmanifest",
  "public/sw.js",
  "public/version.json",
  "scripts/build_documentation_pack.py"
];

export async function syncAppVersion(targetRoot = rootDir) {
  const packageJsonPath = path.join(targetRoot, "package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  const version = String(packageJson.version || "").trim();

  if (!version) {
    throw new Error(`Package version is missing in ${packageJsonPath}.`);
  }

  const updates = [];

  for (const relativePath of VERSION_TARGETS) {
    const absolutePath = path.join(targetRoot, relativePath);
    const original = await readFile(absolutePath, "utf8");
    const next = applyVersionToFile(relativePath, original, version);

    if (next !== original) {
      await writeFile(absolutePath, next, "utf8");
      updates.push(relativePath);
    }
  }

  return {
    version,
    updatedFiles: updates
  };
}

function applyVersionToFile(relativePath, source, version) {
  switch (relativePath) {
    case "src/healthEngine.js":
      return source.replace(
        /export const APP_VERSION = "[0-9.]+";/,
        `export const APP_VERSION = "${version}";`
      );
    case "public/index.html":
      return source
        .replace(/(<meta name="care-nova-asset-version" content=")[0-9.]+(")/, `$1${version}$2`)
        .replace(/styles\.css\?v=[0-9.]+/g, `styles.css?v=${version}`)
        .replace(/calm-theme\.css\?v=[0-9.]+/g, `calm-theme.css?v=${version}`)
        .replace(/visual-polish\.css\?v=[0-9.]+/g, `visual-polish.css?v=${version}`)
        .replace(/app\.js\?v=[0-9.]+/g, `app.js?v=${version}`);
    case "public/site.webmanifest":
      return source.replace(/([?&]v=)[0-9.]+/g, `$1${version}`);
    case "public/sw.js":
      return source
        .replace(/const APP_VERSION = "[0-9.]+";/, `const APP_VERSION = "${version}";`)
        .replace(/const CACHE_NAME = "care-nova-ai-v[0-9.]+";/, `const CACHE_NAME = "care-nova-ai-v${version}";`)
        .replace(/styles\.css\?v=[0-9.]+/g, `styles.css?v=${version}`)
        .replace(/calm-theme\.css\?v=[0-9.]+/g, `calm-theme.css?v=${version}`)
        .replace(/visual-polish\.css\?v=[0-9.]+/g, `visual-polish.css?v=${version}`)
        .replace(/app\.js\?v=[0-9.]+/g, `app.js?v=${version}`);
    case "public/version.json":
      return source
        .replace(/"appVersion":\s*"[0-9.]+"/, `"appVersion": "${version}"`)
        .replace(/"assetVersion":\s*"[0-9.]+"/, `"assetVersion": "${version}"`);
    case "scripts/build_documentation_pack.py":
      return source.replace(
        /\("Version", "[0-9.]+"\)/,
        `("Version", "${version}")`
      );
    default:
      return source;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await syncAppVersion();
  console.log(`Synchronized Care Nova app version ${result.version} in ${result.updatedFiles.length} file(s).`);
}
