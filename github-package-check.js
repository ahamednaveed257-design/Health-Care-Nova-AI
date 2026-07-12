#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nestedPackageDir = path.basename(rootDir) === "github-ready-care-nova-ai"
  ? null
  : path.join(rootDir, "github-ready-care-nova-ai");
const packageDir = nestedPackageDir || rootDir;
const maxFileBytes = 5 * 1024 * 1024;
const requiredPaths = [
  ".github/workflows/ci.yml",
  "index.html",
  "package.json",
  "server.js",
  "public/index.html",
  "public/app.js",
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
  "scripts/deployment-check.js",
  "scripts/enterprise-release-snapshot-check.js",
  "scripts/enterprise-startup-guard-check.js",
  "scripts/github-package-check.js",
  "scripts/model-file-check.js",
  "scripts/smoke-test.js",
  "scripts/ui-smoke-test.js",
  "scripts/build-github-standalone.js"
];
const mirroredPaths = [
  ".github/workflows/ci.yml",
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

assert.ok(existsSync(packageDir), `GitHub package folder is missing: ${packageDir}`);

for (const relativePath of requiredPaths) {
  assert.ok(existsSync(path.join(packageDir, relativePath)), `Required package file is missing: ${relativePath}`);
}

if (nestedPackageDir) {
  const staleMirrors = [];

  for (const relativePath of mirroredPaths) {
    const sourcePath = path.join(rootDir, relativePath);
    const mirroredPath = path.join(packageDir, relativePath);

    assert.ok(existsSync(sourcePath), `Required source file is missing: ${relativePath}`);
    assert.ok(existsSync(mirroredPath), `Required mirrored package file is missing: ${relativePath}`);

    const [sourceFile, mirroredFile] = await Promise.all([
      readFile(sourcePath),
      readFile(mirroredPath)
    ]);

    if (!sourceFile.equals(mirroredFile)) {
      staleMirrors.push(relativePath);
    }
  }

  assert.deepEqual(
    staleMirrors,
    [],
    `GitHub package is stale for: ${staleMirrors.join(", ")}. Run "node scripts/build-github-standalone.js" to refresh the package.`
  );
}

const oversizedFiles = [];

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") {
      return null;
    }

    throw error;
  });

  if (!entries) {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      await walk(fullPath);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const details = await stat(fullPath).catch((error) => {
      if (error.code === "ENOENT") {
        return null;
      }

      throw error;
    });

    if (!details) {
      continue;
    }

    if (details.size > maxFileBytes) {
      oversizedFiles.push({
        path: path.relative(packageDir, fullPath).replace(/\\/g, "/"),
        bytes: details.size
      });
    }
  }
}

await walk(packageDir);

assert.deepEqual(oversizedFiles, []);

const patientBundleManifestPath = path.join(packageDir, "data", "graph", "patients.bundle.manifest.json");
assert.ok(existsSync(patientBundleManifestPath), "Bundled patient graph manifest is missing from the GitHub package.");

const patientBundleManifest = JSON.parse(await readFile(patientBundleManifestPath, "utf8"));
assert.ok(Array.isArray(patientBundleManifest.parts) && patientBundleManifest.parts.length === 11, "Patient graphs should be bundled into 11 GitHub-safe files.");

for (const part of patientBundleManifest.parts) {
  const bundlePath = path.join(packageDir, "data", "graph", "patients", part.file);
  assert.ok(existsSync(bundlePath), `Bundled patient graph file is missing: ${part.file}`);
  const bundleStats = await stat(bundlePath);
  assert.ok(bundleStats.size <= maxFileBytes, `Bundled patient graph file exceeds 5 MB: ${part.file}`);
}

console.log("Care Nova GitHub package check passed.");
console.log("Every package file is below 5 MB.");
