#!/usr/bin/env node
import { execFile } from "node:child_process";
import { copyFile, cp, lstat, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { buildGuideStreamingAssets } from "./build-guide-streaming-assets.js";
import { buildPatientGraphBundles } from "./build-patient-graph-bundles.js";
import { syncAppVersion } from "./sync-app-version.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nestedGithubDir = path.join(rootDir, "github-ready-care-nova-ai");
const sourcePublicDir = path.join(rootDir, "public");
const githubPublicDir = existsSync(nestedGithubDir)
  ? path.join(nestedGithubDir, "public")
  : sourcePublicDir;

const githubRootIndex = existsSync(nestedGithubDir)
  ? path.join(nestedGithubDir, "index.html")
  : path.join(rootDir, "index.html");
const maxGithubFileBytes = 5 * 1024 * 1024;
const rootLauncherHtml = await readFile(path.join(rootDir, "index.html"), "utf8");

const githubProjectFiles = [
  ".dockerignore",
  ".env.example",
  ".gitignore",
  "Dockerfile",
  "package.json",
  "PROJECT_FILES.md",
  "README.md",
  "release-check.cmd",
  "server.js",
  "start-care-nova-global.cmd",
  "start-care-nova.cmd",
  "start-vitaflow-global.cmd",
  "start-vitaflow.cmd"
];

const githubProjectDirs = [
  ".github",
  "data",
  "large-assets",
  "scripts",
  "src",
  "videos"
];

const githubMirrorFiles = [
  ".dockerignore",
  ".env.example",
  ".gitignore",
  "Dockerfile",
  "PROJECT_FILES.md",
  "README.md",
  "index.html",
  "package.json",
  "release-check.cmd",
  "server.js",
  "start-care-nova-global.cmd",
  "start-care-nova.cmd",
  "start-vitaflow-global.cmd",
  "start-vitaflow.cmd",
  "public/app.js",
  "public/index.html",
  "public/styles.css",
  "public/visual-polish.css",
  "public/sw.js",
  "src/agenticRuntime.js",
  "src/enterpriseAdminSession.js",
  "src/enterpriseAuditStore.js",
  "src/enterprisePatientAccess.js",
  "src/enterpriseConfigReadiness.js",
  "src/enterpriseControlProfile.js",
  "src/enterpriseDataRetention.js",
  "src/enterpriseIncidentPosture.js",
  "src/enterpriseRecoveryPosture.js",
  "src/enterprisePublicPolicy.js",
  "src/enterpriseReviewHistoryStore.js",
  "src/enterpriseReviewPacket.js",
  "src/enterpriseReleaseSnapshot.js",
  "src/enterpriseRuntimeMetrics.js",
  "src/enterpriseSecretPosture.js",
  "src/enterpriseStartupGuard.js",
  "src/healthEngine.js",
  "src/memoryStore.js",
  "src/recordStore.js",
  "src/storageIntegrity.js",
  "scripts/build-github-standalone.js",
  "scripts/build-guide-streaming-assets.js",
  "scripts/build-patient-graph-bundles.js",
  "scripts/deployment-check.js",
  "scripts/enterprise-release-snapshot-check.js",
  "scripts/enterprise-startup-guard-check.js",
  "scripts/github-package-check.js",
  "scripts/model-file-check.js",
  "scripts/smoke-test.js",
  "scripts/ui-smoke-test.js",
  "scripts/sync-app-version.js"
];

const githubRuntimeDataFiles = [
  "data/audit/operational-audit-log.json",
  "data/audit/admin-review-history.json",
  "data/graph/patient-knowledge-graph.json",
  "data/memory/patient-memory.json",
  "data/records/patient-records.json",
  "data/training/agent-training-state.json",
  "data/external/external-knowledge-cache.json",
  "data/onedrive-mirror/audit/operational-audit-log.json",
  "data/onedrive-mirror/audit/admin-review-history.json",
  "data/onedrive-mirror/graph/patient-knowledge-graph.json",
  "data/onedrive-mirror/memory/patient-memory.json",
  "data/onedrive-mirror/records/patient-records.json",
  "data/onedrive-mirror/training/agent-training-state.json",
  "data/onedrive-mirror/external/external-knowledge-cache.json",
  "data/onedrive-mirror/offline-medical-db.json",
  "data/onedrive-mirror/mirror-manifest.json"
];

function normalizeGithubRelativePath(sourcePath) {
  return path.relative(rootDir, sourcePath).replace(/\\/g, "/");
}

function shouldIncludeGithubPackagePath(sourcePath) {
  const relativePath = normalizeGithubRelativePath(sourcePath);

  if (!relativePath || relativePath === ".") {
    return true;
  }

  if (/^public\/media\/care-nova-ai-usage-guide(?:-v\d+)?\.webm$/i.test(relativePath)) {
    return false;
  }

  if (/^videos\/care-nova-ai-usage-video\/renders(?:\/|$)/i.test(relativePath)) {
    return false;
  }

  return true;
}

await syncAppVersion(rootDir);
await buildGuideStreamingAssets({ rootDir, chunkBytes: 4 * 1024 * 1024 });

await removePathRobust(githubPublicDir, { recursive: true, force: true });
await mkdir(githubPublicDir, { recursive: true });
await cp(sourcePublicDir, githubPublicDir, {
  recursive: true,
  force: true,
  filter: shouldIncludeGithubPackagePath
});

if (existsSync(nestedGithubDir)) {
  await Promise.all(githubProjectFiles.map(async (fileName) => {
    const sourcePath = path.join(rootDir, fileName);
    const targetPath = path.join(nestedGithubDir, fileName);

    if (existsSync(sourcePath)) {
      await copyFile(sourcePath, targetPath);
    }
  }));

  await Promise.all(githubProjectDirs.map(async (dirName) => {
    const sourcePath = path.join(rootDir, dirName);
    const targetPath = path.join(nestedGithubDir, dirName);

    if (existsSync(sourcePath)) {
      await removePathRobust(targetPath, { recursive: true, force: true });
      await cp(sourcePath, targetPath, {
        recursive: true,
        force: true,
        filter: shouldIncludeGithubPackagePath
      });
    }
  }));
}

await Promise.all([
  writeFile(path.join(rootDir, "index.html"), rootLauncherHtml, "utf8"),
  writeFile(githubRootIndex, rootLauncherHtml, "utf8")
]);

if (existsSync(nestedGithubDir)) {
  await writeFile(path.join(nestedGithubDir, "404.html"), rootLauncherHtml, "utf8");
}

if (existsSync(nestedGithubDir)) {
  await Promise.all(githubRuntimeDataFiles.map((fileName) => (
    removePathRobust(path.join(nestedGithubDir, fileName), { force: true })
  )));

  const patientBundleResult = await buildPatientGraphBundles({
    rootDir,
    targetRoot: nestedGithubDir,
    removeSourceShards: true,
    maxBundleBytes: maxGithubFileBytes,
    targetPartCount: 11
  });

  const prunedFiles = await pruneOversizedFiles(nestedGithubDir, maxGithubFileBytes);

  if (prunedFiles.length) {
    const largeAssetDir = path.join(nestedGithubDir, "large-assets");
    await mkdir(largeAssetDir, { recursive: true });
    await writeFile(
      path.join(largeAssetDir, "README.md"),
      [
        "# Large Local Media",
        "",
        "Oversized generated video/audio render files are kept out of this GitHub-ready package so every uploaded file stays below 5 MB.",
        "The app remains functional on GitHub Pages through the built-in slide guide and local-first workspace.",
        "Restore local media from the main project folder when running a full local demo.",
        "",
        "Pruned files:",
        ...prunedFiles.map((file) => `- ${file}`)
      ].join("\n") + "\n",
      "utf8"
    );
  }

  if (!patientBundleResult.skipped) {
    console.log(`Bundled ${patientBundleResult.patientCount} patient graph shard(s) into ${patientBundleResult.partCount} GitHub-safe file(s).`);
  }

  await syncExplicitGithubMirrorFiles(rootDir, nestedGithubDir, githubMirrorFiles);
  await Promise.all(githubRuntimeDataFiles.map((fileName) => (
    removePathRobust(path.join(nestedGithubDir, fileName), { force: true })
  )));
} else {
  const patientBundleResult = await buildPatientGraphBundles({
    rootDir,
    targetRoot: rootDir,
    removeSourceShards: true,
    maxBundleBytes: maxGithubFileBytes,
    targetPartCount: 11
  });

  if (!patientBundleResult.skipped) {
    console.log(`Bundled ${patientBundleResult.patientCount} patient graph shard(s) into ${patientBundleResult.partCount} GitHub-safe file(s).`);
  }
}

console.log("GitHub app package built with frontend, backend, scripts, media, and launcher files.");

async function pruneOversizedFiles(targetDir, maxBytes) {
  const removed = [];

  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (entry.name === ".git" || entry.name === "node_modules") {
          continue;
        }

        await walk(fullPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const details = await stat(fullPath);

      if (details.size > maxBytes) {
        removed.push(path.relative(targetDir, fullPath).replace(/\\/g, "/"));
        await removePathRobust(fullPath, { force: true });
      }
    }
  }

  await walk(targetDir);
  return removed.sort();
}

async function syncExplicitGithubMirrorFiles(sourceRoot, targetRoot, files = []) {
  for (const relativePath of files) {
    const sourcePath = path.join(sourceRoot, relativePath);
    const targetPath = path.join(targetRoot, relativePath);

    if (!existsSync(sourcePath)) {
      continue;
    }

    await mkdir(path.dirname(targetPath), { recursive: true });
    await copyFile(sourcePath, targetPath);
  }
}

async function removePathRobust(targetPath, options = { recursive: true, force: true }, attempts = 6) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await rm(targetPath, options);
      return;
    } catch (error) {
      const shouldRetry = ["ENOTEMPTY", "EPERM", "EBUSY"].includes(error?.code);

      if (!shouldRetry) {
        throw error;
      }

      if (options?.recursive && existsSync(targetPath)) {
        await emptyDirectoryRobust(targetPath);
      }

      if (attempt === attempts) {
        if (process.platform === "win32" && existsSync(targetPath)) {
          await removePathWithPowerShell(targetPath);
          return;
        }

        throw error;
      }

      await delay(attempt * 120);
    }
  }
}

async function emptyDirectoryRobust(targetPath) {
  const details = await lstat(targetPath).catch(() => null);

  if (!details || !details.isDirectory()) {
    return;
  }

  const entries = await readdir(targetPath, { withFileTypes: true }).catch(() => []);

  for (const entry of entries) {
    const childPath = path.join(targetPath, entry.name);

    if (entry.isDirectory()) {
      await removePathRobust(childPath, { recursive: true, force: true }, 3);
      continue;
    }

    await rm(childPath, { force: true }).catch(() => {});
  }
}

async function removePathWithPowerShell(targetPath) {
  const escapedPath = String(targetPath).replace(/'/g, "''");
  const command = [
    `$path = '${escapedPath}'`,
    "if (Test-Path -LiteralPath $path) {",
    "  $item = Get-Item -LiteralPath $path -Force",
    "  if ($item.PSIsContainer) {",
    "    Get-ChildItem -LiteralPath $path -Force -Recurse -ErrorAction SilentlyContinue |",
    "      Sort-Object FullName -Descending |",
    "      ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force -Recurse -ErrorAction SilentlyContinue }",
    "  }",
    "  Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction Stop",
    "}"
  ].join("; ");

  await new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", command],
      (error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      }
    );
  });
}
