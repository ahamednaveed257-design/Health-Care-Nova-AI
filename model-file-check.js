#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const requiredFiles = [
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
  "data/README.md",
  "data/offline-medical-db.json",
  "data/offline-clinical-repository.json",
  "data/offline-knowledge-index.json",
  "data/offline-repository-manifest.json",
  "data/memory/.gitkeep",
  "data/records/.gitkeep",
  "data/graph/.gitkeep",
  "data/training/.gitkeep",
  "data/external/.gitkeep",
  "data/audit/.gitkeep",
  "data/onedrive-mirror/.gitkeep",
  "public/index.html",
  "public/app.js",
  "public/styles.css",
  "public/calm-theme.css",
  "public/visual-polish.css",
  "public/sw.js",
  "public/site.webmanifest",
  "public/favicon.svg",
  "public/app-icon.svg",
  "public/robots.txt",
  "public/media/README.md",
  "public/media/care-nova-guide-poster.svg",
  ".github/workflows/ci.yml",
  "scripts/deployment-check.js",
  "scripts/build-offline-repository.js",
  "scripts/build-guide-streaming-assets.js",
  "scripts/enterprise-release-snapshot-check.js",
  "scripts/enterprise-startup-guard-check.js",
  "scripts/github-package-check.js",
  "scripts/model-file-check.js",
  "scripts/smoke-test.js",
  "scripts/ui-smoke-test.js",
  "scripts/build-github-standalone.js",
  "src/advancedCapabilityEngine.js",
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
  "src/externalKnowledgeStore.js",
  "src/healthEngine.js",
  "src/hybridModelRouter.js",
  "src/knowledgeGraphStore.js",
  "src/localAiEngine.js",
  "src/localDataMirror.js",
  "src/medicineLookupStore.js",
  "src/memoryStore.js",
  "src/offlineMedicalDatabase.js",
  "src/productIntelligence.js",
  "src/recordStore.js",
  "src/storageIntegrity.js",
  "src/trainingEngine.js",
  "videos/care-nova-ai-usage-video/README.md",
  "videos/care-nova-ai-usage-video/SCRIPT.md",
  "videos/care-nova-ai-usage-video/render-canvas-webm.cjs"
];

const localOnlyExamples = [
  "data/memory/patient-memory.json",
  "data/records/patient-records.json",
  "data/graph/patient-knowledge-graph.json",
  "data/training/agent-training-state.json",
  "data/external/external-knowledge-cache.json",
  "data/audit/operational-audit-log.json",
  "data/audit/admin-review-history.json",
  "data/onedrive-mirror/audit/operational-audit-log.json",
  "data/onedrive-mirror/audit/admin-review-history.json",
  "data/onedrive-mirror/mirror-manifest.json",
  "public/media/care-nova-ai-usage-guide-v24.webm"
];

function toPlatformPath(relativePath) {
  return path.join(rootDir, ...relativePath.split("/"));
}

function fileExists(relativePath) {
  return existsSync(toPlatformPath(relativePath));
}

function readText(relativePath) {
  return readFileSync(toPlatformPath(relativePath), "utf8").replace(/^\uFEFF/, "");
}

function getGitExecutableCandidates() {
  const candidates = [
    process.env.CARE_NOVA_GIT_EXE,
    process.env.GIT_EXE,
    process.env.USERPROFILE
      ? path.join(process.env.USERPROFILE, ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "native", "git", "cmd", "git.exe")
      : "",
    "git"
  ];

  return [...new Set(candidates.filter(Boolean))];
}

function runGit(args) {
  let lastError = null;

  for (const executable of getGitExecutableCandidates()) {
    try {
      execFileSync(executable, args, {
        cwd: rootDir,
        stdio: "ignore"
      });
      return;
    } catch (error) {
      if (error.code === "ENOENT") {
        lastError = error;
        continue;
      }

      throw error;
    }
  }

  throw lastError || new Error("Git executable not available.");
}

function isIgnored(relativePath) {
  try {
    runGit(["check-ignore", "-q", relativePath]);
    return true;
  } catch (error) {
    return error.status === 1 ? false : null;
  }
}

function validateRequiredFiles(errors) {
  for (const requiredFile of requiredFiles) {
    if (!fileExists(requiredFile)) {
      errors.push(`Missing required local model file: ${requiredFile}`);
      continue;
    }

    const ignored = isIgnored(requiredFile);
    if (ignored === true) {
      errors.push(`Required local model file is ignored by Git: ${requiredFile}`);
    }
  }
}

function validateLocalOnlyRules(errors) {
  for (const localOnlyFile of localOnlyExamples) {
    if (!fileExists(localOnlyFile)) {
      continue;
    }

    const ignored = isIgnored(localOnlyFile);
    if (ignored === false) {
      errors.push(`Private/generated file should stay ignored: ${localOnlyFile}`);
    }
  }
}

function validateContent(errors) {
  const packageJson = JSON.parse(readText("package.json"));
  if (packageJson.name !== "care-nova-ai") {
    errors.push("package.json should identify this project as care-nova-ai.");
  }
  if (packageJson.scripts?.["start"] !== "node server.js") {
    errors.push("package.json should include start for the local Care Nova server.");
  }
  if (packageJson.scripts?.["model:files"] !== "node scripts/model-file-check.js") {
    errors.push("package.json should include model:files for local project verification.");
  }
  if (packageJson.scripts?.["deploy:check"] !== "node scripts/deployment-check.js") {
    errors.push("package.json should include deploy:check for local deployment verification.");
  }
  for (const removedScript of ["github:check", "pages:build", "pages:check", "package:github"]) {
    if (packageJson.scripts?.[removedScript]) {
      errors.push(`package.json should not include removed GitHub script: ${removedScript}`);
    }
  }

  const rootIndex = readText("index.html");
  if (!rootIndex.includes("public/index.html") && !rootIndex.includes("public/")) {
    errors.push("root index.html should route to the public Care Nova workspace.");
  }
  const hasVisibleOfflineFallbackLink = rootIndex.includes('id="openOfflineLink"')
    && (rootIndex.includes('href="public/index.html?static=1"') || rootIndex.includes('href="public/?static=1'));
  const hasVisibleLiveFallbackLink = rootIndex.includes('id="openLiveLink"')
    && rootIndex.includes('href="http://127.0.0.1:4173/"');
  if (!hasVisibleOfflineFallbackLink && !hasVisibleLiveFallbackLink) {
    errors.push("root index.html should include visible fallback links to the Care Nova app.");
  }
  if (rootIndex.includes("static-github-runtime.js")) {
    errors.push("root index.html should not load the removed GitHub static runtime.");
  }

  const publicIndex = readText("public/index.html");
  if (!publicIndex.includes("app.js")) {
    errors.push("public/index.html should load the Care Nova app script.");
  }
  if (publicIndex.includes("static-github-runtime.js")) {
    errors.push("public/index.html should not load the removed GitHub static runtime.");
  }

  const offlineDbStats = statSync(toPlatformPath("data/offline-medical-db.json"));
  if (offlineDbStats.size < 1024) {
    errors.push("data/offline-medical-db.json looks too small to be the real offline database.");
  }
  const offlineRepository = JSON.parse(readText("data/offline-clinical-repository.json"));
  if (!Array.isArray(offlineRepository.records) || offlineRepository.records.length < 40) {
    errors.push("data/offline-clinical-repository.json should include the expanded offline clinical repository records.");
  }
  const offlineIndex = JSON.parse(readText("data/offline-knowledge-index.json"));
  if (!offlineIndex.documentCount || offlineIndex.documentCount < offlineRepository.records.length) {
    errors.push("data/offline-knowledge-index.json should index the offline repository records.");
  }
  const offlineManifest = JSON.parse(readText("data/offline-repository-manifest.json"));
  if (!offlineManifest.summary?.totalRetrievalRecords || offlineManifest.summary.totalRetrievalRecords < offlineIndex.documentCount) {
    errors.push("data/offline-repository-manifest.json should report total offline retrieval records.");
  }
  if (fileExists("large-assets/manifest.json")) {
    const videoManifest = JSON.parse(readText("large-assets/manifest.json"));
    const file = videoManifest.files?.find((item) => item.originalPath === "public/media/care-nova-ai-usage-guide-v24.webm");
    if (!file?.parts?.length || file.parts.length < 2) {
      errors.push("large-assets/manifest.json should include GitHub-safe guide video chunks.");
    }
  }
  if (fileExists("large-assets/streaming-manifest.json")) {
    const streamingManifest = JSON.parse(readText("large-assets/streaming-manifest.json"));
    if (!streamingManifest.chunks?.ready || !streamingManifest.chunks?.parts?.length) {
      errors.push("large-assets/streaming-manifest.json should expose chunk fallback metadata.");
    }
  }

  const projectMap = readText("PROJECT_FILES.md");
  for (const section of ["Main Model Files", "User Interface Files", "Data Files"]) {
    if (!projectMap.includes(section)) {
      errors.push(`PROJECT_FILES.md is missing section: ${section}`);
    }
  }
}

const errors = [];
validateRequiredFiles(errors);
validateLocalOnlyRules(errors);
validateContent(errors);

if (errors.length) {
  console.error("Care Nova local model file check failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("Care Nova local model file check passed.");
console.log(`Required local model files: ${requiredFiles.length}`);
console.log("Private patient/runtime files remain local-only.");
