import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getEnterpriseConfigReadiness } from "./enterpriseConfigReadiness.js";
import { getDeploymentReadiness } from "./healthEngine.js";
import { getStorageIntegrityTargetCatalog } from "./storageIntegrity.js";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const startupReadinessCacheTtlMs = 15_000;
let cachedStartupReadiness = null;
let cachedStartupReadinessAtMs = 0;
let cachedStartupReadinessKey = "";

function cleanText(value) {
  return String(value ?? "").trim();
}

function readBoolean(value) {
  return /^(1|true|yes|on)$/i.test(cleanText(value));
}

function dedupeStrings(values = []) {
  return [...new Set(values.map((value) => cleanText(value)).filter(Boolean))];
}

function summarizeCheckSource(source) {
  switch (source) {
    case "storage":
      return "startup storage integrity";
    case "configuration":
      return "enterprise configuration";
    case "deployment":
      return "deployment release gate";
    default:
      return "startup guard";
  }
}

function buildCheckFingerprint(check = {}) {
  return [
    cleanText(check.source || ""),
    cleanText(check.id || ""),
    cleanText(check.status || "")
  ].join(":");
}

function buildStartupReadinessCacheKey(env = process.env, runtime = {}) {
  return JSON.stringify({
    strictStartupGuard: cleanText(env.CARE_NOVA_STRICT_STARTUP_GUARD),
    publicDeployment: cleanText(env.CARE_NOVA_PUBLIC_DEPLOYMENT),
    allowedOrigin: cleanText(env.ALLOWED_ORIGIN),
    frameAncestors: cleanText(env.FRAME_ANCESTORS),
    enableHsts: cleanText(env.ENABLE_HSTS),
    accessLog: cleanText(env.CARE_NOVA_ACCESS_LOG),
    trustProxy: cleanText(env.CARE_NOVA_TRUST_PROXY),
    auditLog: cleanText(env.CARE_NOVA_AUDIT_LOG_ENABLED),
    adminToken: Boolean(cleanText(env.CARE_NOVA_ADMIN_API_TOKEN)),
    reviewerToken: Boolean(cleanText(env.CARE_NOVA_REVIEWER_API_TOKEN)),
    sessionSecret: Boolean(cleanText(env.CARE_NOVA_ADMIN_SESSION_SECRET)),
    patientAuthRequired: cleanText(env.CARE_NOVA_PATIENT_AUTH_REQUIRED),
    patientAccessSecret: Boolean(cleanText(env.CARE_NOVA_PATIENT_ACCESS_SECRET)),
    patientHeader: cleanText(env.CARE_NOVA_PATIENT_HEADER),
    requireAdminForMutations: cleanText(env.CARE_NOVA_REQUIRE_ADMIN_FOR_MUTATIONS),
    host: cleanText(runtime.host),
    port: cleanText(runtime.port),
    publicDeploymentRuntime: cleanText(runtime.publicDeployment),
    nodeEnv: cleanText(runtime.nodeEnv)
  });
}

function inspectCriticalStorageFiles() {
  const targets = getStorageIntegrityTargetCatalog().filter((target) => target.required);

  return targets.map((target) => {
    const absoluteFile = resolve(rootDir, target.file);

    try {
      const stats = statSync(absoluteFile);
      const raw = readFileSync(absoluteFile, "utf8");
      JSON.parse(raw);

      return {
        id: target.id,
        label: target.label,
        file: target.file,
        source: "storage",
        status: "pass",
        bytes: stats.size,
        updatedAt: stats.mtime.toISOString(),
        detail: `${target.label} is present and JSON-parseable.`
      };
    } catch (error) {
      const missing = error?.code === "ENOENT";

      return {
        id: target.id,
        label: target.label,
        file: target.file,
        source: "storage",
        status: "fail",
        bytes: 0,
        updatedAt: "",
        detail: missing
          ? `${target.label} is missing from ${target.file}.`
          : `${target.label} could not be parsed safely: ${error?.message || "unknown parse error"}.`
      };
    }
  });
}

function normalizeBlockingChecks(checks = [], source) {
  return checks.map((check) => ({
    id: cleanText(check.id),
    label: cleanText(check.label),
    source,
    status: cleanText(check.status || "review"),
    detail: cleanText(check.detail),
    recommendedEnv: Array.isArray(check.recommendedEnv) ? check.recommendedEnv.filter(Boolean) : []
  }));
}

export function getEnterpriseStartupGuardProfile(env = process.env) {
  const strictModeEnabled = readBoolean(env.CARE_NOVA_STRICT_STARTUP_GUARD);

  return {
    strictModeEnabled,
    mode: strictModeEnabled ? "fail-fast" : "warn-only",
    blocksOnCriticalReadiness: strictModeEnabled
  };
}

export function getEnterpriseStartupReadiness(env = process.env, runtime = {}) {
  const nowMs = Date.now();
  const cacheKey = buildStartupReadinessCacheKey(env, runtime);

  if (
    cachedStartupReadiness
    && cachedStartupReadinessKey === cacheKey
    && (nowMs - cachedStartupReadinessAtMs) < startupReadinessCacheTtlMs
  ) {
    return cachedStartupReadiness;
  }

  const startupGuard = getEnterpriseStartupGuardProfile(env);
  const configReadiness = getEnterpriseConfigReadiness(env, runtime);
  const deploymentReadiness = getDeploymentReadiness(runtime);
  const criticalFiles = inspectCriticalStorageFiles();
  const criticalStorageReady = criticalFiles.every((check) => check.status === "pass");

  const deploymentBlockingChecks = normalizeBlockingChecks(
    (deploymentReadiness.checks || []).filter((check) => check.status !== "pass"),
    "deployment"
  );
  const configBlockingChecks = normalizeBlockingChecks(
    (configReadiness.checks || []).filter((check) => check.status === "fail"),
    "configuration"
  );
  const storageBlockingChecks = normalizeBlockingChecks(
    criticalFiles.filter((check) => check.status !== "pass"),
    "storage"
  );
  const warningChecks = normalizeBlockingChecks(
    (configReadiness.checks || []).filter((check) => check.status === "review"),
    "configuration"
  );

  const combinedBlockingChecks = [];
  const seenFingerprints = new Set();

  for (const check of [...deploymentBlockingChecks, ...configBlockingChecks, ...storageBlockingChecks]) {
    const fingerprint = buildCheckFingerprint(check);

    if (seenFingerprints.has(fingerprint)) {
      continue;
    }

    seenFingerprints.add(fingerprint);
    combinedBlockingChecks.push(check);
  }

  const shouldBlockStartup = startupGuard.strictModeEnabled && combinedBlockingChecks.length > 0;
  const status = shouldBlockStartup
    ? "startup-blocked"
    : combinedBlockingChecks.length
      ? "startup-review-needed"
      : warningChecks.length
        ? "startup-ready-with-review-points"
        : "startup-ready";

  const checks = [
    {
      id: "startup_guard_mode",
      label: "Startup guard mode",
      source: "policy",
      status: "pass",
      detail: startupGuard.strictModeEnabled
        ? "Strict startup guard is enabled and will fail fast on deployment, configuration, or critical storage gaps."
        : "Warn-only startup guard is active. Startup diagnostics are exposed without blocking boot."
    },
    {
      id: "deployment_release_gate",
      label: "Deployment release gate",
      source: "deployment",
      status: deploymentBlockingChecks.length ? "review" : "pass",
      detail: deploymentBlockingChecks.length
        ? `Deployment readiness still has ${deploymentBlockingChecks.length} unresolved release-gate point(s).`
        : "Deployment release gate checks are clean."
    },
    {
      id: "configuration_gate",
      label: "Enterprise configuration gate",
      source: "configuration",
      status: configBlockingChecks.length
        ? "fail"
        : warningChecks.length
          ? "review"
          : "pass",
      detail: configBlockingChecks.length
        ? `${configBlockingChecks.length} configuration blocker(s) must be fixed before strict enterprise rollout.`
        : warningChecks.length
          ? `${warningChecks.length} non-blocking configuration review point(s) remain.`
          : "Enterprise configuration checks are clean."
    },
    {
      id: "critical_storage_files",
      label: "Critical storage files",
      source: "storage",
      status: criticalStorageReady ? "pass" : "fail",
      detail: criticalStorageReady
        ? `All ${criticalFiles.length} critical bundled storage file(s) are present and parse safely.`
        : "One or more critical bundled storage files are missing or malformed."
    }
  ];

  cachedStartupReadiness = {
    ok: true,
    status,
    summary: {
      strictGuardEnabled: startupGuard.strictModeEnabled,
      mode: startupGuard.mode,
      publicDeployment: deploymentReadiness.publicDeployment?.enabled === true,
      publicShareReady: deploymentReadiness.publicDeployment?.publicShareReady !== false,
      deploymentStatus: deploymentReadiness.status,
      configReadyForSharedEnterpriseUse: configReadiness.summary?.readyForSharedEnterpriseUse !== false,
      criticalStorageReady,
      criticalFileCount: criticalFiles.length,
      blockingCount: combinedBlockingChecks.length,
      warningCount: warningChecks.length,
      shouldBlockStartup,
      readyForTraffic: !shouldBlockStartup
    },
    checks,
    blockingChecks: combinedBlockingChecks,
    warningChecks,
    criticalFiles,
    recommendedEnv: dedupeStrings([
      ...(deploymentReadiness.publicDeployment?.recommendedEnv || []),
      ...(configReadiness.recommendedEnv || []),
      "CARE_NOVA_STRICT_STARTUP_GUARD=true"
    ]),
    reviewPoints: dedupeStrings([
      ...combinedBlockingChecks.map((check) => `${check.label}: ${check.detail}`),
      ...warningChecks.map((check) => `${check.label}: ${check.detail}`)
    ]),
    timestamp: new Date().toISOString()
  };
  cachedStartupReadinessAtMs = nowMs;
  cachedStartupReadinessKey = cacheKey;

  return cachedStartupReadiness;
}

export function formatEnterpriseStartupGuardError(report = {}) {
  const header = "Care Nova AI startup guard blocked server startup.";
  const summary = report?.summary?.strictGuardEnabled
    ? "Strict startup guard is enabled."
    : "Startup diagnostics found blocking issues.";
  const issues = Array.isArray(report?.blockingChecks) ? report.blockingChecks : [];
  const details = issues.length
    ? issues.slice(0, 8).map((check) => `- ${summarizeCheckSource(check.source)}: ${check.label} - ${check.detail}`)
    : ["- No detailed blocking checks were captured."];

  return [header, summary, ...details].join("\n");
}

export function createEnterpriseStartupGuardError(report = {}) {
  const error = new Error(formatEnterpriseStartupGuardError(report));
  error.code = "STARTUP_GUARD_BLOCKED";
  error.statusCode = 503;
  error.startupReadiness = report;
  return error;
}
