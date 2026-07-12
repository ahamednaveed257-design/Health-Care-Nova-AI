import "./src/envLoader.js";

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { createServer } from "node:http";
import { stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { APP_VERSION, analyzeHealthQuery, analyzeRealtimeHealthQuery, getDeploymentGuide, getDeploymentReadiness, getHybridModelRouterStatus, getLocalAiRuntimeStatus, getModelBlueprint, getOfflineKnowledgeDatabase, getReadinessReport, getTrainingReadiness, warmHealthEngineRuntime } from "./src/healthEngine.js";
import { buildModelRouterPreview } from "./src/hybridModelRouter.js";
import {
  analyzeMultimodalIntake,
  buildAdvancedCapabilitySnapshot,
  buildDoctorReadyReport,
  buildEvidenceCitationPacket,
  buildHumanReviewPacket,
  buildPersonalizedPreventionPlan,
  getAdminTrustCenter,
  getAdvancedCapabilityCatalog,
  getEvaluationDashboard,
  getFhirConnectorStatus,
  getOfflinePackManager,
  getSecureBackupPlan,
  runClinicalSafetyTriage
} from "./src/advancedCapabilityEngine.js";
import { clearExternalKnowledgeCache, getExternalKnowledgeForRequest, getExternalKnowledgeStatus } from "./src/externalKnowledgeStore.js";
import {
  buildEnterpriseAdminSession,
  buildEnterpriseAdminSessionClearCookie,
  evaluateEnterpriseAdminAccess,
  getEnterpriseAdminAuthGuide,
  getEnterpriseAdminAuthProfile,
  getEnterpriseAdminSessionSnapshot,
  resolveEnterpriseAdminIdentity
} from "./src/enterpriseAdminSession.js";
import { appendEnterpriseAuditEvent, getEnterpriseAuditStorageInfo, loadEnterpriseAuditLog } from "./src/enterpriseAuditStore.js";
import { getEnterpriseConfigReadiness, getEnterpriseRequestContractProfile } from "./src/enterpriseConfigReadiness.js";
import { evaluateEnterprisePatientAccess, getEnterprisePatientAccessProfile } from "./src/enterprisePatientAccess.js";
import { evaluateEnterpriseMutationRequest, getEnterpriseDataLifecyclePolicy, getEnterpriseMutationControlProfile } from "./src/enterpriseControlProfile.js";
import { getEnterpriseDataRetentionPolicy } from "./src/enterpriseDataRetention.js";
import { getEnterpriseIncidentPosture } from "./src/enterpriseIncidentPosture.js";
import { getEnterpriseRecoveryPosture } from "./src/enterpriseRecoveryPosture.js";
import { appendEnterpriseReviewHistoryEntry, getEnterpriseReviewHistoryStorageInfo, loadEnterpriseReviewHistory } from "./src/enterpriseReviewHistoryStore.js";
import { buildEnterpriseReviewPacket } from "./src/enterpriseReviewPacket.js";
import { buildEnterpriseReleaseSnapshot, getEnterpriseReleaseSnapshotSigningProfile } from "./src/enterpriseReleaseSnapshot.js";
import { getEnterpriseRuntimeMetricsSnapshot, recordEnterpriseRuntimeMetric } from "./src/enterpriseRuntimeMetrics.js";
import { getEnterpriseSecretPosture } from "./src/enterpriseSecretPosture.js";
import { evaluateEnterpriseApiOriginAccess, isLoopbackHealthProbeRequest } from "./src/enterprisePublicPolicy.js";
import { createEnterpriseStartupGuardError, getEnterpriseStartupGuardProfile, getEnterpriseStartupReadiness } from "./src/enterpriseStartupGuard.js";
import { getTemporaryCloudLlmStatus, tryEnhanceAnalyzeResultWithCloudLlm } from "./src/cloudLlmGateway.js";
import { getLocalReasoningAssistStatus, tryEnhanceAnalyzeResultWithLocalReasoning } from "./src/localReasoningGateway.js";
import { clearPatientKnowledgeGraph, getKnowledgeGraphStorageInfo, loadPatientKnowledgeGraph, upsertPatientKnowledgeGraph } from "./src/knowledgeGraphStore.js";
import { getLocalDataMirrorInfo, getLocalDataMirrorStatus, syncLocalDataMirror } from "./src/localDataMirror.js";
import { appendPatientMemory, clearPatientMemory, getMemoryStorageInfo, loadPatientMemory, mergeImportedPatientMemory, mergeMemoryHistory } from "./src/memoryStore.js";
import { getMedicineLookupStorageInfo, lookupMedicineEvidence } from "./src/medicineLookupStore.js";
import { ensureLocalRuntimeProbeFresh, refreshLocalRuntimeProbe, startLocalRuntimeProbeLoop } from "./src/openSourceLocalRuntime.js";
import { buildTrustedSourcePlan, evaluateModelQuality, getFhirIntegrationGuide, getGovernanceReadiness, getModelQualityFramework, getOfflinePackCatalog, getReportTemplateCatalog, getTrustedSourceCatalog } from "./src/productIntelligence.js";
import { clearPatientDataRecords, getRecordStorageInfo, loadPatientDataRecords, savePatientDataRecords } from "./src/recordStore.js";
import { getBrowserStateStorageInfo, loadBrowserStateSnapshot, saveBrowserStateSnapshot } from "./src/browserStateStore.js";
import { getStorageIntegrityReport } from "./src/storageIntegrity.js";
import { evaluateTrainingCalibration, getMachineLearningCapabilityStatus, getTrainingCalibration, getTrainingStorageInfo, loadTrainingState, recordTrainingExample, toPublicTrainingState, trainLocalAgentCalibrator } from "./src/trainingEngine.js";
import { getModelHealthStatus } from "./src/localAiEngine.js";
import { buildAdaptiveExecutionTrace, buildAdaptiveRuntimePolicy } from "./src/agenticRuntime.js";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const publicDir = resolve(rootDir, "public");
const largeAssetsDir = resolve(rootDir, "large-assets");
const port = parsePort(process.env.PORT || "4173");
const host = normalizeHost(process.env.HOST);
const allowedOrigin = process.env.ALLOWED_ORIGIN || "";
const frameAncestors = process.env.FRAME_ANCESTORS || "'self'";
const startedAt = new Date();
const accessLogEnabled = process.env.CARE_NOVA_ACCESS_LOG === "true";
const trustProxyHeaders = process.env.CARE_NOVA_TRUST_PROXY === "true";
const publicDeploymentMode = readBooleanEnvFlag(process.env.CARE_NOVA_PUBLIC_DEPLOYMENT);
const serverOperationalState = {
  trafficState: "accepting",
  lastTransitionAt: startedAt.toISOString()
};
const apiRateLimitWindowMs = parseNonNegativeInteger(process.env.CARE_NOVA_RATE_LIMIT_WINDOW_MS, 60_000, "CARE_NOVA_RATE_LIMIT_WINDOW_MS");
const analyzeRateLimitMax = parseNonNegativeInteger(process.env.CARE_NOVA_ANALYZE_RATE_LIMIT, 360, "CARE_NOVA_ANALYZE_RATE_LIMIT");
const realtimeRateLimitMax = parseNonNegativeInteger(process.env.CARE_NOVA_REALTIME_RATE_LIMIT, 720, "CARE_NOVA_REALTIME_RATE_LIMIT");
const mutationRateLimitMax = parseNonNegativeInteger(process.env.CARE_NOVA_MUTATION_RATE_LIMIT, 120, "CARE_NOVA_MUTATION_RATE_LIMIT");
const routeRateLimitBuckets = new Map();
let lastReadinessGateAuditSignature = "";
let lastReadinessGateAuditAtMs = 0;
let localRuntimeBootstrapTriggered = false;
const supportedAnalyzeProcessingPolicies = Object.freeze([
  "standard-local",
  "local-only",
  "isolated-local-no-persist"
]);
const supportedAnalyzeIsolationModes = Object.freeze([
  "persistent",
  "prompt-only"
]);

function parsePort(value) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    throw new Error(`Invalid PORT value: ${value}`);
  }

  return parsed;
}

function parseNonNegativeInteger(value, fallback, name) {
  const raw = String(value ?? "").trim();

  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid ${name} value: ${value}`);
  }

  return parsed;
}

function readBooleanEnvFlag(value) {
  return /^(1|true|yes|on)$/i.test(String(value ?? "").trim());
}

function readBooleanEnvFlagWithDefault(value, defaultValue = false) {
  const normalized = String(value ?? "").trim();
  return normalized ? readBooleanEnvFlag(normalized) : defaultValue;
}

function isHostedRuntimeEnvironment(env = process.env) {
  if (readBooleanEnvFlag(env.CARE_NOVA_PUBLIC_DEPLOYMENT)) {
    return true;
  }

  if (String(env.NODE_ENV ?? "").trim().toLowerCase() === "production") {
    return true;
  }

  return [
    "RENDER",
    "RAILWAY_ENVIRONMENT",
    "VERCEL",
    "VERCEL_URL",
    "FLY_APP_NAME",
    "KOYEB_SERVICE_NAME",
    "HEROKU_APP_NAME",
    "WEBSITE_HOSTNAME"
  ].some((key) => String(env[key] ?? "").trim());
}

function getMaxJsonBodyBytes() {
  return parseNonNegativeInteger(process.env.CARE_NOVA_MAX_JSON_BODY_BYTES, 5_000_000, "CARE_NOVA_MAX_JSON_BODY_BYTES");
}

function normalizeHost(value, env = process.env) {
  const normalized = String(value ?? "").trim();
  if (normalized) {
    return normalized;
  }

  return isHostedRuntimeEnvironment(env) ? "0.0.0.0" : "127.0.0.1";
}

function isLoopbackHost(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "127.0.0.1"
    || normalized === "localhost"
    || normalized === "::1";
}

function shouldBootstrapLocalRuntime(env = process.env) {
  if (publicDeploymentMode) {
    return false;
  }

  if (!isLoopbackHost(host)) {
    return false;
  }

  return readBooleanEnvFlagWithDefault(env.CARE_NOVA_BOOTSTRAP_LOCAL_RUNTIME, true);
}

function buildChildProcessEnvironment(extraEnv = {}) {
  const childEnv = {};
  const normalizedPath = process.env.Path || process.env.PATH || "";

  for (const [key, value] of Object.entries(process.env)) {
    if (/^path$/i.test(key)) {
      continue;
    }

    childEnv[key] = value;
  }

  if (normalizedPath) {
    childEnv.Path = normalizedPath;
  }

  return {
    ...childEnv,
    ...extraEnv
  };
}

function getKnownLocalRuntimeBinaryPaths(env = process.env) {
  const localAppData = String(env.LOCALAPPDATA || "").trim();
  const programFiles = String(env.ProgramFiles || "").trim();

  return [
    localAppData ? resolve(localAppData, "Programs", "Ollama", "ollama.exe") : "",
    programFiles ? resolve(programFiles, "Ollama", "ollama.exe") : "",
    localAppData ? resolve(localAppData, "Programs", "LM Studio", "LM Studio.exe") : "",
    localAppData ? resolve(localAppData, "lm-studio", "LM Studio.exe") : ""
  ].filter(Boolean);
}

function hasInstalledLocalRuntimeBinary(env = process.env) {
  return getKnownLocalRuntimeBinaryPaths(env).some((candidate) => existsSync(candidate));
}

function spawnDetachedProcess(command, args, extraEnv = {}) {
  const child = spawn(command, args, {
    cwd: rootDir,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: buildChildProcessEnvironment(extraEnv)
  });

  child.once("error", (error) => {
    console.warn(`Care Nova AI local runtime bootstrap failed: ${error.message}`);
  });
  child.unref();
}

function startDirectMockLocalRuntime(env = process.env) {
  const mockRuntimeScript = resolve(rootDir, "scripts", "mock-ollama-runtime.js");

  if (!existsSync(mockRuntimeScript)) {
    return false;
  }

  spawnDetachedProcess(
    process.env.CARE_NOVA_NODE_EXE || process.execPath,
    [mockRuntimeScript],
    {
      CARE_NOVA_NODE_EXE: process.env.CARE_NOVA_NODE_EXE || process.execPath,
      MOCK_OLLAMA_PORT: "11434"
    }
  );

  return true;
}

function startLocalRuntimeBootstrapIfEligible(env = process.env) {
  if (localRuntimeBootstrapTriggered || !shouldBootstrapLocalRuntime(env)) {
    return false;
  }

  if (readBooleanEnvFlagWithDefault(env.CARE_NOVA_ENABLE_MOCK_LOCAL_RUNTIME, true) && !hasInstalledLocalRuntimeBinary(env)) {
    startDirectMockLocalRuntime(env);
    localRuntimeBootstrapTriggered = true;
    return true;
  }

  const scriptPath = resolve(rootDir, "scripts", "start-local-runtime.ps1");

  if (!existsSync(scriptPath)) {
    return false;
  }

  const args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath
  ];

  if (readBooleanEnvFlagWithDefault(env.CARE_NOVA_ENABLE_MOCK_LOCAL_RUNTIME, true)) {
    args.push("-EnableMockFallback");
  }

  try {
    spawnDetachedProcess("powershell.exe", args, {
      CARE_NOVA_NODE_EXE: process.env.CARE_NOVA_NODE_EXE || process.execPath
    });
    localRuntimeBootstrapTriggered = true;
    return true;
  } catch {
    return false;
  }
}

function normalizeRequestId(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  return String(raw ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9._:-]+/g, "")
    .slice(0, 80);
}

function getClientIpAddress(request) {
  const forwardedFor = request.headers["x-forwarded-for"];

  if (trustProxyHeaders && forwardedFor) {
    return String(Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor)
      .split(",")[0]
      .trim()
      .slice(0, 80);
  }

  return String(request.socket?.remoteAddress || request.connection?.remoteAddress || "")
    .trim()
    .slice(0, 80);
}

function createRequestContext(request, requestUrl) {
  return {
    id: normalizeRequestId(request.headers["x-request-id"] || request.headers["x-correlation-id"]) || randomUUID(),
    method: String(request.method || "GET").toUpperCase(),
    path: requestUrl.pathname || "/",
    startedAt: new Date().toISOString(),
    startedAtMs: Date.now(),
    clientIp: getClientIpAddress(request)
  };
}

function buildOperationalHeaders(headers = {}, requestContext = {}) {
  const durationMs = Math.max(0, Date.now() - Number(requestContext.startedAtMs || Date.now()));

  return {
    ...(headers && typeof headers === "object" ? headers : {}),
    "X-Request-Id": requestContext.id || "",
    "X-Care-Nova-Version": APP_VERSION,
    "X-Response-Time-Ms": String(durationMs),
    "Server-Timing": `app;desc=\"Care Nova AI\";dur=${durationMs}`
  };
}

function attachOperationalRequestContext(response, requestContext) {
  const originalWriteHead = response.writeHead.bind(response);
  response.__careNovaRequestContext = requestContext;

  response.writeHead = function patchedWriteHead(statusCode, statusMessage, headers) {
    if (typeof statusMessage === "string") {
      return originalWriteHead(statusCode, statusMessage, buildOperationalHeaders(headers, requestContext));
    }

    return originalWriteHead(statusCode, buildOperationalHeaders(statusMessage, requestContext));
  };

  response.on("finish", () => {
    const durationMs = Math.max(0, Date.now() - requestContext.startedAtMs);
    recordEnterpriseRuntimeMetric({
      requestContext,
      statusCode: response.statusCode,
      durationMs
    });

    if (accessLogEnabled || response.statusCode >= 400) {
      console.log(JSON.stringify({
        type: "access",
        requestId: requestContext.id,
        method: requestContext.method,
        path: requestContext.path,
        statusCode: response.statusCode,
        durationMs,
        clientIp: requestContext.clientIp,
        timestamp: new Date().toISOString()
      }));
    }
  });
}

function getTrafficStateSnapshot() {
  return {
    state: serverOperationalState.trafficState,
    acceptingTraffic: serverOperationalState.trafficState === "accepting",
    lastTransitionAt: serverOperationalState.lastTransitionAt
  };
}

function getRateLimitRoutes() {
  return [
    { path: "/api/analyze", limit: analyzeRateLimitMax },
    { path: "/api/realtime", limit: realtimeRateLimitMax },
    { path: "/api/training/example", limit: mutationRateLimitMax },
    { path: "/api/training/train", limit: mutationRateLimitMax },
    { path: "/api/training/evaluate", limit: mutationRateLimitMax },
    { path: "/api/external-knowledge/clear", limit: mutationRateLimitMax },
    { path: "/api/browser-state-sync", limit: mutationRateLimitMax }
  ].filter((route) => route.limit > 0);
}

function getOperationalControlsSummary() {
  const strictTransportSecurity = readBooleanEnvFlag(process.env.ENABLE_HSTS);
  const auditStorage = getEnterpriseAuditStorageInfo();
  const mutationControls = getEnterpriseMutationControlProfile();
  const adminAuth = getEnterpriseAdminAuthProfile();
  const patientAccess = getEnterprisePatientAccessProfile();
  const requestContract = getEnterpriseRequestContractProfile();
  const startupGuard = getEnterpriseStartupGuardProfile();
  const releaseSnapshotSigning = getEnterpriseReleaseSnapshotSigningProfile();

  return {
    requestTracing: true,
    accessLogging: accessLogEnabled ? "all-requests" : "errors-only",
    enterpriseAuditLog: {
      enabled: auditStorage.enabled,
      file: auditStorage.file,
      maxEvents: auditStorage.maxEvents
    },
    proxyAwareClientIp: trustProxyHeaders,
    publicDeploymentMode,
    publicBinding: host,
    corsPolicy: allowedOrigin ? "restricted-origin" : "same-origin-only",
    originValidation: "api-origin-allowlist-or-same-origin",
    allowedOriginConfigured: Boolean(allowedOrigin),
    frameAncestors,
    strictTransportSecurity,
    apiCachePolicy: "no-store",
    apiResponsesNotCached: true,
    requestValidation: {
      requiresJsonContentType: requestContract.requiresJsonContentType,
      requiresJsonObject: requestContract.requiresJsonObject,
      bodyLimitBytes: requestContract.maxJsonBodyBytes,
      supportedContentTypes: requestContract.supportedContentTypes,
      supportedAnalyzePolicies: supportedAnalyzeProcessingPolicies,
      supportedIsolationModes: supportedAnalyzeIsolationModes
    },
    rateLimiting: {
      enabled: getRateLimitRoutes().length > 0,
      windowSeconds: Math.max(1, Math.ceil(apiRateLimitWindowMs / 1000)),
      routes: getRateLimitRoutes()
    },
    startupGuard,
    releaseGovernance: {
      adminReleaseSnapshot: "/api/admin-release-snapshot",
      signatureMethod: releaseSnapshotSigning.method,
      signedSnapshot: releaseSnapshotSigning.signed,
      secretSource: releaseSnapshotSigning.secretSource
    },
    mutationControls: mutationControls.summary,
    adminAuth: adminAuth.summary,
    patientAccess: patientAccess.summary
  };
}

function buildJsonPayload(response, payload) {
  const requestId = response.__careNovaRequestContext?.id;

  if (!requestId || !payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }

  if (String(payload.requestId ?? "").trim()) {
    return payload;
  }

  return {
    requestId,
    ...payload
  };
}

function getRateLimitPolicy(method, path) {
  if (method !== "POST") {
    return null;
  }

  if (path === "/api/analyze" && analyzeRateLimitMax > 0) {
    return { name: "analyze", limit: analyzeRateLimitMax, windowMs: apiRateLimitWindowMs };
  }

  if (path === "/api/realtime" && realtimeRateLimitMax > 0) {
    return { name: "realtime", limit: realtimeRateLimitMax, windowMs: apiRateLimitWindowMs };
  }

  if (
    mutationRateLimitMax > 0
    && (
      path === "/api/training/example"
      || path === "/api/training/train"
      || path === "/api/training/evaluate"
      || path === "/api/external-knowledge/clear"
    )
  ) {
    return { name: "mutation", limit: mutationRateLimitMax, windowMs: apiRateLimitWindowMs };
  }

  return null;
}

function pruneRateLimitBuckets(nowMs) {
  if (routeRateLimitBuckets.size < 512) {
    return;
  }

  for (const [bucketKey, bucket] of routeRateLimitBuckets.entries()) {
    if (!bucket || bucket.resetAt <= nowMs) {
      routeRateLimitBuckets.delete(bucketKey);
    }
  }
}

function applyRateLimit(request, response, requestContext, requestUrl) {
  const policy = getRateLimitPolicy(requestContext.method, requestUrl.pathname);

  if (!policy) {
    return true;
  }

  const nowMs = Date.now();
  pruneRateLimitBuckets(nowMs);

  const bucketKey = `${requestContext.clientIp || "unknown"}:${policy.name}:${requestUrl.pathname}`;
  const existingBucket = routeRateLimitBuckets.get(bucketKey);
  const bucket = !existingBucket || existingBucket.resetAt <= nowMs
    ? { count: 0, resetAt: nowMs + policy.windowMs }
    : existingBucket;

  bucket.count += 1;
  routeRateLimitBuckets.set(bucketKey, bucket);

  const remaining = Math.max(0, policy.limit - bucket.count);
  const resetSeconds = Math.max(1, Math.ceil((bucket.resetAt - nowMs) / 1000));
  const windowSeconds = Math.max(1, Math.ceil(policy.windowMs / 1000));

  response.setHeader("RateLimit-Limit", String(policy.limit));
  response.setHeader("RateLimit-Remaining", String(remaining));
  response.setHeader("RateLimit-Reset", String(resetSeconds));
  response.setHeader("RateLimit-Policy", `${policy.limit};w=${windowSeconds}`);

  if (bucket.count > policy.limit) {
    response.setHeader("Retry-After", String(resetSeconds));
    void recordOperationalAuditEvent({
      category: "security",
      action: "rate_limit_blocked",
      status: "blocked",
      route: requestUrl.pathname,
      requestId: requestContext.id,
      summary: `Rate limit blocked ${requestContext.method} ${requestUrl.pathname}.`,
      detail: `Route limit ${policy.limit} per ${windowSeconds}s exceeded for this client window.`,
      metadata: {
        policy: policy.name,
        limit: policy.limit,
        retryAfterSeconds: resetSeconds
      }
    });
    sendJson(response, 429, {
      ok: false,
      code: "RATE_LIMITED",
      message: "Too many requests. Retry after the current rate-limit window resets.",
      route: requestUrl.pathname,
      retryAfterSeconds: resetSeconds
    });
    return false;
  }

  return true;
}

function mergeRequestProfile(savedProfile = {}, requestProfile = {}) {
  const pickText = (primary, fallback) => {
    const value = String(primary ?? "").trim();
    return value ? primary : fallback;
  };
  const pickList = (primary, fallback) => {
    if (Array.isArray(primary)) {
      return primary.length ? primary : fallback;
    }

    return String(primary ?? "").trim() ? primary : fallback;
  };

  return {
    ...savedProfile,
    ...requestProfile,
    name: pickText(requestProfile?.name, savedProfile?.name),
    age: pickText(requestProfile?.age, savedProfile?.age),
    conditions: pickList(requestProfile?.conditions, savedProfile?.conditions),
    medications: pickList(requestProfile?.medications, savedProfile?.medications),
    allergies: pickList(requestProfile?.allergies, savedProfile?.allergies),
    baselineBp: pickText(requestProfile?.baselineBp, savedProfile?.baselineBp),
    gender: pickText(requestProfile?.gender, savedProfile?.gender),
    notes: pickText(requestProfile?.notes, savedProfile?.notes)
  };
}

function normalizeRequestText(value, maxLength = 48) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function normalizeInterfaceName(value) {
  return normalizeRequestText(value, 32).toLowerCase();
}

function normalizeRouteHint(value) {
  return normalizeRequestText(value, 48).toUpperCase();
}

function getAnalyzeRouteHint(payload = {}) {
  return normalizeRouteHint(
    payload.preferredAgent
      || payload.agentRoute
      || payload.routeHint
      || payload.agentId
  );
}

function createRequestValidationError(message, code = "INVALID_REQUEST_PAYLOAD", statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readBooleanRequestFlag(value) {
  return /^(1|true|yes|on)$/i.test(String(value ?? "").trim());
}

function normalizeRequestedProcessingPolicy(payload = {}) {
  const requestedMode = normalizeRequestText(
    payload.processingPolicy
      || payload.executionPolicy
      || payload.privacyMode,
    48
  ).toLowerCase();

  if (readBooleanRequestFlag(payload.localOnly) || readBooleanRequestFlag(payload.forceLocalOnly)) {
    return "local-only";
  }

  switch (requestedMode) {
    case "local-only":
    case "local_only":
    case "private-local-only":
    case "local-endpoints-only":
    case "offline-only":
      return "local-only";
    case "isolated-local-no-persist":
    case "isolated_local_no_persist":
    case "prompt-only":
    case "prompt_only":
    case "ephemeral-local":
    case "non-persistent-local":
      return "isolated-local-no-persist";
    default:
      return "standard-local";
  }
}

function getAnalyzeRecordPayloadCount(value) {
  if (Array.isArray(value)) {
    return value.length;
  }

  if (isPlainObject(value) && Array.isArray(value.records)) {
    return value.records.length;
  }

  return 0;
}

function getAnalyzeKnowledgeGraphFactCount(value) {
  return isPlainObject(value) && Array.isArray(value.facts) ? value.facts.length : 0;
}

function validateAnalyzePayloadShape(payload = {}, endpoint = "/api/analyze") {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw createRequestValidationError("Request body must be a JSON object.", "INVALID_PAYLOAD");
  }

  if ("message" in payload && payload.message !== undefined && payload.message !== null && typeof payload.message !== "string") {
    throw createRequestValidationError(`Field "message" must be a string for ${endpoint}.`, "INVALID_MESSAGE_PAYLOAD");
  }

  const validateObjectField = (value, fieldName) => {
    if (value !== undefined && value !== null && !isPlainObject(value)) {
      throw createRequestValidationError(`Field "${fieldName}" must be a JSON object for ${endpoint}.`, `INVALID_${fieldName.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_PAYLOAD`);
    }
  };

  const validateRecordField = (value, fieldName) => {
    if (value === undefined || value === null) {
      return;
    }

    if (Array.isArray(value)) {
      return;
    }

    if (!isPlainObject(value)) {
      throw createRequestValidationError(`Field "${fieldName}" must be an array or object for ${endpoint}.`, `INVALID_${fieldName.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_PAYLOAD`);
    }

    if ("records" in value && value.records !== undefined && value.records !== null && !Array.isArray(value.records)) {
      throw createRequestValidationError(`Field "${fieldName}.records" must be an array for ${endpoint}.`, `INVALID_${fieldName.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_RECORDS_PAYLOAD`);
    }
  };

  const validateKnowledgeGraphField = (value, fieldName) => {
    if (value === undefined || value === null) {
      return;
    }

    if (!isPlainObject(value)) {
      throw createRequestValidationError(`Field "${fieldName}" must be a JSON object for ${endpoint}.`, `INVALID_${fieldName.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_PAYLOAD`);
    }

    if ("facts" in value && value.facts !== undefined && value.facts !== null && !Array.isArray(value.facts)) {
      throw createRequestValidationError(`Field "${fieldName}.facts" must be an array for ${endpoint}.`, `INVALID_${fieldName.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_FACTS_PAYLOAD`);
    }
  };

  validateObjectField(payload.profile, "profile");
  validateObjectField(payload.vitals, "vitals");
  validateObjectField(payload.context, "context");
  validateObjectField(payload.signals, "signals");
  validateRecordField(payload.patientRecords, "patientRecords");
  validateRecordField(payload.records, "records");
  validateKnowledgeGraphField(payload.patientKnowledgeGraph, "patientKnowledgeGraph");
  validateKnowledgeGraphField(payload.knowledgeGraph, "knowledgeGraph");

  if (
    (payload.conversationHistory !== undefined && payload.conversationHistory !== null && !Array.isArray(payload.conversationHistory))
    || (payload.history !== undefined && payload.history !== null && !Array.isArray(payload.history))
  ) {
    throw createRequestValidationError(`Field "conversationHistory" or "history" must be an array for ${endpoint}.`, "INVALID_HISTORY_PAYLOAD");
  }
}

function buildAnalyzeExecutionPolicy(payload = {}) {
  const requestedModeRaw = normalizeRequestText(
    payload.processingPolicy
      || payload.executionPolicy
      || payload.privacyMode,
    48
  ).toLowerCase();
  const isolationModeRaw = normalizeRequestText(payload.analysisIsolation || payload.isolationMode, 32).toLowerCase();
  const requestedMode = normalizeRequestedProcessingPolicy(payload);
  const promptOnlyIsolation = (
    requestedMode === "isolated-local-no-persist"
    || readBooleanRequestFlag(payload.disablePersistence)
    || readBooleanRequestFlag(payload.ephemeralSession)
    || isolationModeRaw === "prompt-only"
    || isolationModeRaw === "prompt_only"
    || isolationModeRaw === "ephemeral"
    || isolationModeRaw === "non-persistent"
  );
  const appliedMode = promptOnlyIsolation ? "isolated-local-no-persist" : requestedMode;
  const recognizedRequestedModes = new Set([
    "",
    "standard-local",
    "local-only",
    "local_only",
    "private-local-only",
    "local-endpoints-only",
    "offline-only",
    "isolated-local-no-persist",
    "isolated_local_no_persist",
    "prompt-only",
    "prompt_only",
    "ephemeral-local",
    "non-persistent-local"
  ]);
  const recognizedIsolationModes = new Set([
    "",
    "persistent",
    "prompt-only",
    "prompt_only",
    "ephemeral",
    "non-persistent"
  ]);
  const notes = [];

  if (requestedModeRaw && !recognizedRequestedModes.has(requestedModeRaw)) {
    notes.push(`Unknown processing policy "${requestedModeRaw}" fell back to standard-local.`);
  }

  if (isolationModeRaw && !recognizedIsolationModes.has(isolationModeRaw)) {
    notes.push(`Unknown isolation mode "${isolationModeRaw}" was ignored.`);
  }

  if (promptOnlyIsolation && appliedMode !== requestedMode) {
    notes.push("Prompt-only isolation forced non-persistent execution for this request.");
  }

  return {
    requestedMode: requestedModeRaw || requestedMode,
    appliedMode,
    promptOnlyIsolation,
    localEndpointsOnly: appliedMode !== "standard-local",
    remoteNetworkAllowed: appliedMode === "standard-local",
    networkAccess: appliedMode === "standard-local" ? "runtime-controlled" : "local-endpoints-only",
    localPersistence: promptOnlyIsolation ? "prompt-only-analysis" : "persistent-local-server",
    externalKnowledgeMode: appliedMode === "standard-local" ? "approved-endpoints-and-local-cache" : "local-cache-or-local-endpoint-only",
    cloudAssistMode: appliedMode === "standard-local" ? "runtime-controlled" : "local-endpoint-only",
    localReasoningMode: appliedMode === "standard-local" ? "runtime-controlled" : "local-endpoint-only",
    summary: appliedMode === "isolated-local-no-persist"
      ? "This request stayed on local persistence-free execution with remote network access blocked for non-local endpoints."
      : appliedMode === "local-only"
        ? "This request allowed only local cache reuse and local endpoints."
        : "This request used the default local-first runtime policy with standard enterprise controls.",
    notes
  };
}

function prepareAnalyzeExecutionRequest(payload = {}, endpoint = "/api/analyze") {
  validateAnalyzePayloadShape(payload, endpoint);

  const policy = buildAnalyzeExecutionPolicy(payload);
  const normalizedPayload = {
    ...payload,
    processingPolicy: policy.appliedMode,
    analysisIsolation: policy.promptOnlyIsolation ? "prompt-only" : normalizeRequestText(payload.analysisIsolation || payload.isolationMode, 32).toLowerCase() === "persistent"
      ? "persistent"
      : payload.analysisIsolation
  };
  const historyPayload = normalizedPayload.conversationHistory || normalizedPayload.history || [];
  const patientRecordsPayload = normalizedPayload.patientRecords || normalizedPayload.records || null;
  const patientKnowledgeGraphPayload = normalizedPayload.patientKnowledgeGraph || normalizedPayload.knowledgeGraph || null;

  return {
    payload: normalizedPayload,
    policy,
    contract: {
      endpoint,
      status: policy.notes.length ? "validated-with-adjustments" : "validated",
      bodyLimitBytes: getMaxJsonBodyBytes(),
      requiresJsonContentType: true,
      requiresJsonObject: true,
      supportedProcessingPolicies: supportedAnalyzeProcessingPolicies,
      supportedIsolationModes: supportedAnalyzeIsolationModes,
      requestShape: {
        hasProfile: isPlainObject(normalizedPayload.profile),
        hasVitals: isPlainObject(normalizedPayload.vitals),
        hasContext: isPlainObject(normalizedPayload.context) || isPlainObject(normalizedPayload.signals),
        historyEntries: Array.isArray(historyPayload) ? historyPayload.length : 0,
        patientRecordCount: getAnalyzeRecordPayloadCount(patientRecordsPayload),
        graphFactCount: getAnalyzeKnowledgeGraphFactCount(patientKnowledgeGraphPayload)
      },
      notes: policy.notes
    }
  };
}

function buildScopedExecutionEnv(baseEnv = process.env, policy = {}) {
  if (!policy.localEndpointsOnly) {
    return baseEnv;
  }

  return {
    ...baseEnv,
    CARE_NOVA_FORCE_OFFLINE: "true",
    CARE_NOVA_OFFLINE_ONLY: "true",
    CARE_NOVA_ONLINE_MODE: "false"
  };
}

function createExecutionStageTracker(requestContext = {}) {
  let cursorMs = Date.now();
  const stages = [];

  return {
    mark(name, detail = "") {
      const nowMs = Date.now();
      stages.push({
        name,
        durationMs: Math.max(0, nowMs - cursorMs),
        detail: normalizeRequestText(detail, 180)
      });
      cursorMs = nowMs;
    },
    snapshot() {
      return {
        startedAt: requestContext.startedAt || new Date().toISOString(),
        totalDurationMs: Math.max(0, Date.now() - Number(requestContext.startedAtMs || Date.now())),
        stages
      };
    }
  };
}

function buildEnterpriseExecutionSummary({ requestContext = {}, endpoint = "/api/analyze", policy = {}, contract = {}, timings = {} } = {}) {
  return {
    requestId: requestContext.id || "",
    endpoint,
    status: contract.status || "validated",
    policy: {
      requestedMode: policy.requestedMode || "standard-local",
      appliedMode: policy.appliedMode || "standard-local",
      promptOnlyIsolation: policy.promptOnlyIsolation === true,
      networkAccess: policy.networkAccess || "runtime-controlled",
      remoteNetworkAllowed: policy.remoteNetworkAllowed !== false,
      localPersistence: policy.localPersistence || "persistent-local-server",
      externalKnowledgeMode: policy.externalKnowledgeMode || "approved-endpoints-and-local-cache",
      cloudAssistMode: policy.cloudAssistMode || "runtime-controlled",
      localReasoningMode: policy.localReasoningMode || "runtime-controlled",
      summary: policy.summary || ""
    },
    contract: {
      endpoint: contract.endpoint || endpoint,
      bodyLimitBytes: Number(contract.bodyLimitBytes || getMaxJsonBodyBytes()),
      requiresJsonContentType: contract.requiresJsonContentType !== false,
      requiresJsonObject: contract.requiresJsonObject !== false,
      supportedProcessingPolicies: Array.isArray(contract.supportedProcessingPolicies) ? contract.supportedProcessingPolicies : supportedAnalyzeProcessingPolicies,
      supportedIsolationModes: Array.isArray(contract.supportedIsolationModes) ? contract.supportedIsolationModes : supportedAnalyzeIsolationModes,
      requestShape: contract.requestShape || {},
      notes: Array.isArray(contract.notes) ? contract.notes : []
    },
    timings: {
      startedAt: timings.startedAt || requestContext.startedAt || new Date().toISOString(),
      totalDurationMs: Number.isFinite(Number(timings.totalDurationMs)) ? Number(timings.totalDurationMs) : 0,
      stages: Array.isArray(timings.stages) ? timings.stages : []
    }
  };
}

function buildEnterpriseExecutionAuditSummary({ policy = {}, contract = {} } = {}) {
  const notes = Array.isArray(contract.notes) ? contract.notes.filter(Boolean) : [];
  const notesSummary = notes.length ? ` Adjustments: ${notes.slice(0, 3).join(" ")}` : "";
  return `Enterprise request contract applied. Mode ${policy.appliedMode || "standard-local"}; network ${policy.networkAccess || "runtime-controlled"}; persistence ${policy.localPersistence || "persistent-local-server"}.${notesSummary}`.trim();
}

function isAdvisorSingleAgentRequest(payload = {}) {
  return Boolean(payload.singleAgentMode) && normalizeInterfaceName(payload.interfaceName) === "advisor";
}

function getAnalyzeIsolationMode(payload = {}) {
  const requestedMode = normalizeRequestedProcessingPolicy(payload);

  if (
    requestedMode === "isolated-local-no-persist"
    || readBooleanRequestFlag(payload.disablePersistence)
    || readBooleanRequestFlag(payload.ephemeralSession)
  ) {
    return "prompt-only";
  }

  const isolationMode = normalizeRequestText(payload.analysisIsolation || payload.isolationMode, 32).toLowerCase();

  if (isolationMode === "ephemeral" || isolationMode === "non-persistent") {
    return "prompt-only";
  }

  return isolationMode;
}

function isPromptOnlyAnalyzeIsolation(payload = {}) {
  return getAnalyzeIsolationMode(payload) === "prompt-only";
}

function getAnalyzeConversationHistoryLimit(payload = {}) {
  const interfaceName = normalizeInterfaceName(payload.interfaceName);
  const routeHint = getAnalyzeRouteHint(payload);

  if (isAdvisorSingleAgentRequest(payload)) {
    if (routeHint === "ALERT_AGENT") {
      return 8;
    }

    if (routeHint === "RAG_AGENT" || routeHint === "SPECIALIST_DOCTOR_AGENT") {
      return 12;
    }

    return 10;
  }

  if (interfaceName === "advisor") {
    return 10;
  }

  if (interfaceName === "specialist" || interfaceName === "atlas") {
    return 14;
  }

  return 20;
}

function buildAnalyzeConversationHistory(payload = {}, memoryHistory = []) {
  const mergedHistory = mergeMemoryHistory(memoryHistory, payload.conversationHistory || payload.history);
  return mergedHistory.slice(0, getAnalyzeConversationHistoryLimit(payload));
}

function shouldFetchExternalKnowledgeForAnalyze(payload = {}) {
  const interfaceName = normalizeInterfaceName(payload.interfaceName);
  const routeHint = getAnalyzeRouteHint(payload);
  const evidenceRoutes = new Set([
    "RAG_AGENT",
    "SPECIALIST_DOCTOR_AGENT",
    "ATLAS_AGENT",
    "LABS_AGENT",
    "PHARMACY_AGENT"
  ]);

  if (routeHint) {
    return evidenceRoutes.has(routeHint);
  }

  return interfaceName === "advisor" || interfaceName === "specialist" || interfaceName === "atlas";
}

function buildDeferredExternalKnowledgeStatus() {
  const status = getExternalKnowledgeStatus();

  return {
    ...status,
    queryHash: "",
    cacheHit: false,
    cacheMatchedQueries: 0,
    fetchedOnline: false,
    usedForThisRequest: false,
    records: [],
    error: "",
    updatedAt: new Date().toISOString()
  };
}

async function loadExternalKnowledgeForAnalyze(payload = {}, env = process.env) {
  if (!shouldFetchExternalKnowledgeForAnalyze(payload)) {
    return buildDeferredExternalKnowledgeStatus();
  }

  return getExternalKnowledgeForRequest(payload, env);
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".webm": "video/webm",
  ".m3u8": "application/vnd.apple.mpegurl",
  ".ts": "video/mp2t",
  ".mpd": "application/dash+xml",
  ".m4s": "video/iso.segment",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8"
};

function getSecurityHeaders() {
  return {
    "Content-Security-Policy": `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors ${frameAncestors}`,
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Origin-Agent-Cluster": "?1",
    "X-DNS-Prefetch-Control": "off",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "X-Permitted-Cross-Domain-Policies": "none",
    ...(process.env.ENABLE_HSTS === "true" ? { "Strict-Transport-Security": "max-age=31536000; includeSubDomains" } : {})
  };
}

function getCorsHeaders() {
  if (!allowedOrigin) {
    return {};
  }

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Vary": "Origin"
  };
}

function getCorsAllowHeaders() {
  const adminHeaderName = getEnterpriseMutationControlProfile().adminHeaderName;
  const patientHeaderName = getEnterprisePatientAccessProfile().headerName;

  return [...new Set([
    "Content-Type",
    "Authorization",
    "X-Admin-Token",
    adminHeaderName,
    patientHeaderName,
    "X-Request-Id",
    "X-Correlation-Id"
  ])].join(", ");
}

function sendJson(response, statusCode, payload, extraHeaders = {}) {
  const normalizedPayload = buildJsonPayload(response, payload);
  const body = process.env.CARE_NOVA_PRETTY_JSON === "true"
    ? JSON.stringify(normalizedPayload, null, 2)
    : JSON.stringify(normalizedPayload);

  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    Pragma: "no-cache",
    Expires: "0",
    "Surrogate-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
    ...getSecurityHeaders(),
    ...getCorsHeaders(),
    ...extraHeaders
  });
  response.end(body);
}

function sendText(response, statusCode, message) {
  response.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    Pragma: "no-cache",
    Expires: "0",
    "Surrogate-Control": "no-store",
    ...getSecurityHeaders(),
    ...getCorsHeaders()
  });
  response.end(message);
}

function getRuntimeSnapshot() {
  const mutationControls = getEnterpriseMutationControlProfile();
  const adminAuth = getEnterpriseAdminAuthProfile();
  const patientAccess = getEnterprisePatientAccessProfile();

  return {
    node: process.version,
    nodeEnv: process.env.NODE_ENV || "development",
    host,
    port,
    publicDeployment: publicDeploymentMode,
    maintenanceModeEnabled: mutationControls.maintenanceModeEnabled,
    readOnlyModeEnabled: mutationControls.readOnlyModeEnabled,
    requireAdminForMutations: mutationControls.requireAdminForMutations,
    adminAuthRequired: adminAuth.required,
    patientAccessRequired: patientAccess.required,
    patientAccessHeaderName: patientAccess.headerName,
    adminSessionCookieName: adminAuth.cookieName,
    uptimeSeconds: Math.round(process.uptime()),
    startedAt: startedAt.toISOString()
  };
}

function getAdaptiveRuntimePolicy(overrides = {}) {
  return buildAdaptiveRuntimePolicy({
    localAi: overrides.localAi || getLocalAiRuntimeStatus(),
    externalKnowledge: overrides.externalKnowledge || getExternalKnowledgeStatus(),
    memory: overrides.memory || getMemoryStorageInfo(),
    records: overrides.records || getRecordStorageInfo(),
    knowledgeGraph: overrides.knowledgeGraph || getKnowledgeGraphStorageInfo(),
    runtime: overrides.runtime || getRuntimeSnapshot()
  });
}

function getEnterpriseRuntimeSummary({ ai = getLocalAiRuntimeStatus(), runtime = getRuntimeSnapshot(), externalKnowledge = getExternalKnowledgeStatus() } = {}) {
  const localReasoningAssist = getLocalReasoningAssistStatus();
  const temporaryCloudLlm = getTemporaryCloudLlmStatus();
  const adaptivePolicy = getAdaptiveRuntimePolicy({ localAi: ai, externalKnowledge, runtime });
  const deploymentReadiness = getDeploymentReadiness(runtime);
  const configReadiness = getEnterpriseConfigReadiness(process.env, runtime);
  const dataRetention = getEnterpriseDataRetentionPolicy(process.env);
  const incidentPosture = getEnterpriseIncidentPosture(process.env);
  const recoveryPosture = getEnterpriseRecoveryPosture(process.env);
  const secretPosture = getEnterpriseSecretPosture(process.env);
  const strictTransportSecurity = readBooleanEnvFlag(process.env.ENABLE_HSTS);
  const adminAuth = getEnterpriseAdminAuthProfile();
  const patientAccess = getEnterprisePatientAccessProfile();
  const productionRuntime = String(runtime.nodeEnv || "").trim().toLowerCase() === "production";
  const publicBinding = host === "0.0.0.0" || host === "::";
  const localReasoningReady = localReasoningAssist.configured === true;
  const temporaryCloudReady = temporaryCloudLlm.configured === true;
  const reviewPoints = [...(deploymentReadiness.publicDeployment?.reviewPoints || [])];

  if (productionRuntime && !allowedOrigin) {
    reviewPoints.push("Set ALLOWED_ORIGIN before enabling cross-origin browser access in production.");
  }

  if (productionRuntime && publicBinding && !strictTransportSecurity) {
    reviewPoints.push("Enable HSTS when the app is served publicly behind HTTPS.");
  }

  if (productionRuntime && publicBinding && !trustProxyHeaders) {
    reviewPoints.push("Enable CARE_NOVA_TRUST_PROXY when the app is behind a reverse proxy or load balancer.");
  }

  if (runtime.maintenanceModeEnabled) {
    reviewPoints.push("Maintenance mode is active, so protected mutation routes are intentionally paused.");
  }

  if (runtime.readOnlyModeEnabled) {
    reviewPoints.push("Read-only mode is active, so protected mutation routes are intentionally disabled.");
  }

  if (publicDeploymentMode && !adminAuth.required) {
    reviewPoints.push("Enable CARE_NOVA_ADMIN_AUTH_REQUIRED for shared enterprise admin endpoints.");
  }

  if (adminAuth.required && !adminAuth.adminTokenConfigured) {
    reviewPoints.push("CARE_NOVA_ADMIN_API_TOKEN is required when CARE_NOVA_ADMIN_AUTH_REQUIRED=true.");
  }

  if (adminAuth.required && !adminAuth.sessionSecretConfigured) {
    reviewPoints.push("CARE_NOVA_ADMIN_SESSION_SECRET is required when CARE_NOVA_ADMIN_AUTH_REQUIRED=true.");
  }

  reviewPoints.push(...(configReadiness.reviewPoints || []));
  reviewPoints.push(...(dataRetention.reviewPoints || []));
  reviewPoints.push(...(incidentPosture.reviewPoints || []));
  reviewPoints.push(...(recoveryPosture.reviewPoints || []));
  reviewPoints.push(...(secretPosture.reviewPoints || []));

  let runtimeTier = "deterministic-local-core";

  if (localReasoningReady) {
    runtimeTier = "local-open-source-reasoning-augmented";
  } else if (temporaryCloudReady) {
    runtimeTier = temporaryCloudLlm.endpointIsLocal
      ? "local-openai-compatible-augmented"
      : "hybrid-cloud-augmented";
  }

  return {
    status: reviewPoints.length ? "enterprise-hardened-with-review-points" : "enterprise-hardened",
    runtimeTier,
    safeLocalCoreReady: ai.offlineReady !== false,
    llmAugmentationAvailable: localReasoningReady || temporaryCloudReady,
    publicDeploymentMode,
    publicShareReady: deploymentReadiness.publicDeployment?.publicShareReady !== false,
    adaptivePolicy: {
      activeMode: adaptivePolicy.activeMode,
      systemState: adaptivePolicy.systemState,
      selectedPath: adaptivePolicy.decision?.selectedPath || adaptivePolicy.activeMode,
      fallbackApplied: adaptivePolicy.decision?.fallbackApplied === true
    },
    localReasoningAssist: {
      status: localReasoningAssist.status,
      configured: localReasoningAssist.configured === true,
      participantCount: Number(localReasoningAssist.participantCount || 0),
      policyBlocked: localReasoningAssist.policyBlocked === true,
      reason: localReasoningAssist.reason || ""
    },
    temporaryCloudLlm: {
      status: temporaryCloudLlm.status,
      configured: temporaryCloudLlm.configured === true,
      endpointIsLocal: temporaryCloudLlm.endpointIsLocal === true,
      endpointHost: temporaryCloudLlm.endpointHost || "",
      activationPolicy: temporaryCloudLlm.activationPolicy || "",
      reason: temporaryCloudLlm.reason || ""
    },
    operationalPolicy: {
      apiResponsesNotCached: true,
      cachePolicy: "no-store",
      corsPolicy: allowedOrigin ? "restricted-origin" : "same-origin-only",
      strictTransportSecurity,
      proxyAwareClientIp: trustProxyHeaders,
      rateLimitingEnabled: getRateLimitRoutes().length > 0,
      requestTracing: true,
      publicBinding: host,
      adminAuth: adminAuth.summary,
      patientAccess: patientAccess.summary
    },
    configReadiness: {
      status: configReadiness.status,
      blockingCount: configReadiness.summary?.blockingCount || 0,
      warningCount: configReadiness.summary?.warningCount || 0,
      readyForSharedEnterpriseUse: configReadiness.summary?.readyForSharedEnterpriseUse !== false
    },
    reviewPoints: [...new Set(reviewPoints)]
  };
}

async function getHealthPayload() {
  const ai = getLocalAiRuntimeStatus();
  const runtime = getRuntimeSnapshot();
  const externalKnowledge = getExternalKnowledgeStatus();
  const deploymentReadiness = getDeploymentReadiness(runtime);
  const startupReadiness = getEnterpriseStartupReadiness(process.env, runtime);
  const dataRetention = getEnterpriseDataRetentionPolicy(process.env);
  const incidentPosture = getEnterpriseIncidentPosture(process.env);
  const secretPosture = getEnterpriseSecretPosture(process.env);
  const trustedSources = getTrustedSourceCatalog();
  const quality = getModelQualityFramework(runtime);
  const governance = getGovernanceReadiness(runtime);
  const offlinePacks = getOfflinePackCatalog();
  const fhir = getFhirIntegrationGuide();
  const reports = getReportTemplateCatalog();
  const advancedCapabilities = getAdvancedCapabilityCatalog(runtime);
  const evaluationDashboard = getEvaluationDashboard(runtime);
  const machineLearning = getMachineLearningCapabilityStatus(runtime);
  const hybridRouter = getHybridModelRouterStatus();
  const traffic = getTrafficStateSnapshot();
  const adminAuth = getEnterpriseAdminAuthProfile();
  const patientAccess = getEnterprisePatientAccessProfile();
  const configReadiness = getEnterpriseConfigReadiness(process.env, runtime);
  const recoveryPosture = getEnterpriseRecoveryPosture(process.env);
  const [audit, storageIntegrity] = await Promise.all([
    loadEnterpriseAuditLog(process.env, { limit: 10 }),
    getStorageIntegrityReport(process.env)
  ]);

  return {
    ok: true,
    status: "healthy",
    app: "Care Nova AI",
    version: APP_VERSION,
    mode: "online-offline-local-parity",
    realtime: true,
    install: "pwa-ready",
    ai,
    agenticRuntime: getAdaptiveRuntimePolicy({ localAi: ai, externalKnowledge, runtime }),
    machineLearning: machineLearning.summary,
    runtimeParity: ai.runtimeParity,
    hybridRouter: {
      status: hybridRouter.status,
      mode: hybridRouter.mode,
      processingLabels: hybridRouter.processingLabels,
      summary: hybridRouter.summary,
      connectivity: hybridRouter.connectivity,
      fallbackPolicy: hybridRouter.fallbackPolicy
    },
    enterpriseRuntime: getEnterpriseRuntimeSummary({ ai, runtime, externalKnowledge }),
    externalKnowledge,
    medicineLookup: getMedicineLookupStorageInfo(),
    trustedSources: {
      status: trustedSources.status,
      sourceCount: trustedSources.sourceCount,
      enabledCount: trustedSources.enabledCount
    },
    quality: quality.summary,
    advancedCapabilities: advancedCapabilities.summary,
    evaluationDashboard: evaluationDashboard.summary,
    governance: governance.summary,
    offlinePacks: offlinePacks.summary,
    fhir: fhir.summary,
    reports: reports.summary,
    memory: getMemoryStorageInfo(),
    browserState: getBrowserStateStorageInfo(),
    records: getRecordStorageInfo(),
    knowledgeGraph: getKnowledgeGraphStorageInfo(),
    training: getTrainingStorageInfo(),
    audit: buildCompactAuditSummary(audit),
    dataMirror: getLocalDataMirrorInfo(),
    storageIntegrity: buildCompactStorageIntegrity(storageIntegrity),
    adminAuth: adminAuth.summary,
    patientAccess: patientAccess.summary,
    configReadiness: {
      status: configReadiness.status,
      summary: configReadiness.summary,
      recommendedEnvCount: Array.isArray(configReadiness.recommendedEnv) ? configReadiness.recommendedEnv.length : 0,
      reviewPointCount: Array.isArray(configReadiness.reviewPoints) ? configReadiness.reviewPoints.length : 0
    },
    dataRetention: {
      status: dataRetention.status,
      summary: dataRetention.summary,
      reviewPointCount: Array.isArray(dataRetention.reviewPoints) ? dataRetention.reviewPoints.length : 0
    },
    incidentPosture: {
      status: incidentPosture.status,
      summary: incidentPosture.summary,
      reviewPointCount: Array.isArray(incidentPosture.reviewPoints) ? incidentPosture.reviewPoints.length : 0
    },
    recoveryPosture: {
      status: recoveryPosture.status,
      summary: recoveryPosture.summary,
      reviewPointCount: Array.isArray(recoveryPosture.reviewPoints) ? recoveryPosture.reviewPoints.length : 0
    },
    secretPosture: {
      status: secretPosture.status,
      summary: secretPosture.summary,
      reviewPointCount: Array.isArray(secretPosture.reviewPoints) ? secretPosture.reviewPoints.length : 0
    },
    startupReadiness: {
      status: startupReadiness.status,
      summary: startupReadiness.summary,
      reviewPointCount: Array.isArray(startupReadiness.reviewPoints) ? startupReadiness.reviewPoints.length : 0
    },
    operations: getOperationalControlsSummary(),
    traffic,
    deployment: {
      host,
      port,
      globalReady: traffic.acceptingTraffic,
      publicDeploymentMode,
      publicShareReady: deploymentReadiness.publicDeployment?.publicShareReady !== false,
      deploymentStatus: deploymentReadiness.status,
      startupGuardStatus: startupReadiness.status,
      readinessEndpoint: "/api/ready",
      releaseGate: "npm run release:check"
    },
    runtime,
    timestamp: new Date().toISOString()
  };
}

async function getAdminPolicySnapshot() {
  const runtime = getRuntimeSnapshot();
  const ai = getLocalAiRuntimeStatus();
  const externalKnowledge = getExternalKnowledgeStatus();
  const deploymentReadiness = getDeploymentReadiness(runtime);
  const startupReadiness = getEnterpriseStartupReadiness(process.env, runtime);
  const governance = getGovernanceReadiness(runtime);
  const adminAuth = getEnterpriseAdminAuthProfile();
  const patientAccess = getEnterprisePatientAccessProfile();
  const mutationControls = getEnterpriseMutationControlProfile();
  const dataLifecycle = getEnterpriseDataLifecyclePolicy();
  const dataRetention = getEnterpriseDataRetentionPolicy(process.env);
  const incidentPosture = getEnterpriseIncidentPosture(process.env);
  const recoveryPosture = getEnterpriseRecoveryPosture(process.env);
  const configReadiness = getEnterpriseConfigReadiness(process.env, runtime);
  const secretPosture = getEnterpriseSecretPosture(process.env);
  const audit = await loadEnterpriseAuditLog(process.env, { limit: 10 });
  const storageIntegrity = await getStorageIntegrityReport(process.env);
  const reviewHistory = await loadEnterpriseReviewHistory(process.env, { limit: 5 });
  const mirror = await getLocalDataMirrorStatus();
  const operations = getOperationalControlsSummary();
  const enterpriseRuntime = getEnterpriseRuntimeSummary({ ai, runtime, externalKnowledge });
  const releaseSnapshotSigning = getEnterpriseReleaseSnapshotSigningProfile(process.env);

  return {
    ok: true,
    status: "admin-policy-ready",
    summary: {
      localFirst: true,
      publicDeploymentMode,
      publicShareReady: deploymentReadiness.publicDeployment?.publicShareReady !== false,
      startupReviewRequired: startupReadiness.status !== "startup-ready",
      strictStartupGuardEnabled: startupReadiness.summary.strictGuardEnabled === true,
      criticalStorageReady: storageIntegrity.summary.criticalReady !== false,
      auditLoggingEnabled: audit.storage?.enabled === true,
      rateLimitingEnabled: operations.rateLimiting.enabled === true,
      configReadyForSharedEnterpriseUse: configReadiness.summary.readyForSharedEnterpriseUse !== false,
      releaseSnapshotSigned: releaseSnapshotSigning.signed,
      releaseSnapshotSignatureMethod: releaseSnapshotSigning.method,
      retentionPolicyReady: dataRetention.status === "retention-policy-ready",
      incidentPostureReady: incidentPosture.status === "incident-posture-ready",
      recoveryPostureReady: recoveryPosture.status === "recovery-posture-ready",
      secretPostureReady: secretPosture.status === "secret-posture-ready",
      patientAccessReady: patientAccess.required ? patientAccess.patientAccessSecretConfigured : true
    },
    transport: {
      corsPolicy: operations.corsPolicy,
      allowedOriginConfigured: operations.allowedOriginConfigured === true,
      frameAncestors,
      strictTransportSecurity: operations.strictTransportSecurity === true,
      proxyAwareClientIp: operations.proxyAwareClientIp === true
    },
    runtimeControls: {
      requestTracing: true,
      apiCachePolicy: operations.apiCachePolicy,
      rateLimiting: operations.rateLimiting,
      requestValidation: operations.requestValidation,
      adminAuth: adminAuth.summary,
      patientAccess: patientAccess.summary,
      mutationControls: mutationControls.summary,
      requestTimeoutMs: 15_000,
      headersTimeoutMs: 16_000
    },
    dataControls: {
      defaultStorage: governance.privacy.defaultStorage,
      minimumNecessary: governance.privacy.minimumNecessary === true,
      externalApiUse: governance.privacy.externalApiUse,
      mirror: {
        enabled: mirror.enabled !== false,
        status: mirror.status || "mirror-unknown",
        mirrorRoot: mirror.mirrorRoot || "",
        manifest: mirror.manifest || ""
      },
      audit: buildCompactAuditSummary(audit),
      reviewHistory: {
        status: reviewHistory.status || "review-history-unknown",
        enabled: reviewHistory.storage?.enabled !== false,
        file: reviewHistory.storage?.file || "",
        entryCount: Number.isFinite(reviewHistory.summary?.entryCount) ? reviewHistory.summary.entryCount : 0,
        latestAt: reviewHistory.summary?.latestAt || ""
      },
      storageIntegrity: buildCompactStorageIntegrity(storageIntegrity),
      lifecycle: dataLifecycle.summary,
      retention: dataRetention.summary,
      incident: incidentPosture.summary,
      recovery: recoveryPosture.summary
    },
    accessControls: {
      adminAuthRequired: adminAuth.required,
      authHeaderName: adminAuth.adminHeaderName,
      adminCookieName: adminAuth.cookieName,
      adminSessionTtlMinutes: adminAuth.sessionTtlMinutes,
      sessionSecretConfigured: adminAuth.sessionSecretConfigured,
      patientAccessRequired: patientAccess.required,
      patientAccessRequiredByPublicDeployment: patientAccess.requiredByPublicDeployment === true,
      patientHeaderName: patientAccess.headerName,
      patientSessionTtlMinutes: patientAccess.sessionTtlMinutes,
      patientAccessSecretConfigured: patientAccess.patientAccessSecretConfigured,
      patientProtectedRouteCount: patientAccess.protectedRouteCount,
      mutationHeaderName: mutationControls.adminHeaderName,
      requireAdminForMutations: mutationControls.requireAdminForMutations,
      adminTokenConfigured: mutationControls.adminTokenConfigured,
      protectedRouteCount: mutationControls.protectedRouteCount,
      destructiveRouteCount: mutationControls.destructiveRouteCount
    },
    configReadiness,
    startupReadiness,
    dataRetention,
    incidentPosture,
    recoveryPosture,
    secretPosture,
    releaseSnapshots: {
      status: releaseSnapshotSigning.signed
        ? "signed-release-snapshot-ready"
        : "release-snapshot-hash-ready",
      endpoint: "/api/admin-release-snapshot",
      signatureMethod: releaseSnapshotSigning.method,
      signed: releaseSnapshotSigning.signed,
      secretSource: releaseSnapshotSigning.secretSource
    },
    reviewPoints: [...new Set([
      ...(startupReadiness.reviewPoints || []),
      ...(enterpriseRuntime.reviewPoints || []),
      ...(configReadiness.reviewPoints || []),
      ...(dataRetention.reviewPoints || []),
      ...(incidentPosture.reviewPoints || []),
      ...(recoveryPosture.reviewPoints || []),
      ...(secretPosture.reviewPoints || []),
      ...(!mutationControls.adminTokenConfigured && mutationControls.requireAdminForMutations
        ? [`${mutationControls.adminHeaderName} is required for protected mutations, but CARE_NOVA_ADMIN_API_TOKEN is not configured.`]
        : []),
      ...storageIntegrity.checks
        .filter((check) => check.status !== "pass")
        .map((check) => `${check.label}: ${check.detail}`)
    ])],
    requiredPublicControls: deploymentReadiness.publicDeployment?.recommendedEnv || [],
    probes: {
      trustCenter: "/api/admin-trust-center",
      adminSession: "/api/admin/session",
      configReadiness: "/api/config-readiness",
      startupReadiness: "/api/startup-readiness",
      dataRetentionPolicy: "/api/data-retention-policy",
      incidentPosture: "/api/incident-posture",
      recoveryPosture: "/api/recovery-posture",
      adminSecretPosture: "/api/admin-secret-posture",
      adminReviewPacket: "/api/admin-review-packet",
      adminReleaseSnapshot: "/api/admin-release-snapshot",
      adminReviewHistory: "/api/admin-review-history",
      auditEvents: "/api/audit-events",
      browserState: "/api/browser-state",
      storageIntegrity: "/api/storage-integrity",
      backupPlan: "/api/backup-plan",
      governance: "/api/governance",
      runtimeMetrics: "/api/runtime-metrics"
    },
    dataLifecycle,
    timestamp: new Date().toISOString()
  };
}

const mirrorDataFiles = {
  audit: "data/audit/operational-audit-log.json",
  memory: "data/memory/patient-memory.json",
  browserState: "data/browser-state/browser-state.json",
  records: "data/records/patient-records.json",
  training: "data/training/agent-training-state.json",
  externalKnowledge: "data/external/external-knowledge-cache.json",
  medicineLookup: "data/external/medicine-lookup-cache.json",
  reviewHistory: "data/audit/admin-review-history.json"
};
const publicMemoryHistoryLimit = 6;

async function syncDataMirrorSafely(reason, files = []) {
  try {
    return await syncLocalDataMirror(reason, process.env, { files });
  } catch (error) {
    return {
      ...getLocalDataMirrorInfo(),
      status: "mirror-sync-error",
      reason,
      error: error.message || "Unable to sync local OneDrive mirror.",
      syncedAt: new Date().toISOString(),
      fileCount: 0,
      files: []
    };
  }
}

function buildAnalyzeMirrorSummary(mirror = {}, scheduledFiles = []) {
  const scheduled = Array.isArray(scheduledFiles) ? scheduledFiles.filter(Boolean) : [];
  const skippedFileCount = Number.isFinite(mirror.skippedFileCount)
    ? mirror.skippedFileCount
    : Array.isArray(mirror.skippedFiles)
      ? mirror.skippedFiles.length
      : 0;

  return {
    status: mirror.status || "mirror-unknown",
    reason: mirror.reason || "analyze-memory-graph-sync",
    syncedAt: mirror.syncedAt || "",
    mode: mirror.mode || "",
    primaryRoot: mirror.primaryRoot || "",
    mirrorRoot: mirror.mirrorRoot || "",
    manifest: mirror.manifest || "",
    enabled: mirror.enabled !== false,
    fileCount: Number.isFinite(mirror.fileCount) ? mirror.fileCount : 0,
    copiedCount: Number.isFinite(mirror.copiedCount) ? mirror.copiedCount : 0,
    skippedFileCount,
    scheduledFiles: scheduled,
    error: mirror.error || ""
  };
}

function buildCompactAuditSummary(audit = {}) {
  const summary = audit?.summary || {};

  return {
    status: audit?.status || "audit-log-unknown",
    enabled: summary.enabled === true,
    file: summary.file || "",
    eventCount: Number.isFinite(summary.eventCount) ? summary.eventCount : 0,
    maxEvents: Number.isFinite(summary.maxEvents) ? summary.maxEvents : 0,
    latestEventAt: summary.latestEventAt || "",
    latestCategory: summary.latestCategory || "",
    latestStatus: summary.latestStatus || ""
  };
}

function buildCompactStorageIntegrity(storageIntegrity = {}) {
  const summary = storageIntegrity?.summary || {};

  return {
    status: storageIntegrity?.status || "storage-integrity-unknown",
    criticalReady: summary.criticalReady !== false,
    checkedFiles: Number.isFinite(summary.checkedFiles) ? summary.checkedFiles : 0,
    passCount: Number.isFinite(summary.passCount) ? summary.passCount : 0,
    reviewCount: Number.isFinite(summary.reviewCount) ? summary.reviewCount : 0,
    failCount: Number.isFinite(summary.failCount) ? summary.failCount : 0,
    latestCheckAt: summary.latestCheckAt || ""
  };
}

function parsePositiveQueryInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

function recordOperationalAuditEvent(event = {}) {
  return appendEnterpriseAuditEvent(event).catch((error) => {
    console.warn("Care Nova AI audit logging skipped.", error?.message || error);
    return null;
  });
}

async function enforceEnterpriseMutationControls(request, response, requestContext, requestUrl) {
  const decision = evaluateEnterpriseMutationRequest({
    method: request.method,
    path: requestUrl.pathname,
    headers: request.headers
  });

  if (decision.allowed) {
    return true;
  }

  await recordOperationalAuditEvent({
    category: "security",
    action: "mutation_guard_blocked",
    status: "blocked",
    route: requestUrl.pathname,
    requestId: requestContext.id,
    summary: `Protected mutation blocked for ${requestUrl.pathname}.`,
    detail: decision.detail,
    metadata: {
      policy: decision.policy,
      code: decision.code,
      routeType: decision.routeType,
      adminRequired: decision.adminRequired
    }
  });

  sendJson(response, decision.statusCode, {
    ok: false,
    code: decision.code,
    message: decision.detail,
    policy: decision.policy,
    routeType: decision.routeType,
    adminRequired: decision.adminRequired,
    adminHeaderName: decision.headerName
  });

  return false;
}

async function enforceEnterpriseOriginAccess(request, response, requestContext, requestUrl) {
  const decision = evaluateEnterpriseApiOriginAccess({
    headers: request.headers,
    path: requestUrl.pathname,
    env: process.env
  });

  if (decision.allowed) {
    return true;
  }

  await recordOperationalAuditEvent({
    category: "security",
    action: "origin_guard_blocked",
    status: "blocked",
    route: requestUrl.pathname,
    requestId: requestContext.id,
    summary: `Origin policy blocked ${requestContext.method} ${requestUrl.pathname}.`,
    detail: decision.detail,
    metadata: {
      code: decision.code || "",
      policy: decision.policy || "",
      allowedOrigin: decision.allowedOrigin || ""
    }
  });

  sendJson(response, decision.statusCode || 403, {
    ok: false,
    code: decision.code || "ORIGIN_NOT_ALLOWED",
    message: decision.detail,
    policy: decision.policy || "",
    allowedOrigin: decision.allowedOrigin || ""
  });

  return false;
}

async function enforceEnterpriseAdminAccess(request, response, requestContext, requestUrl) {
  const decision = evaluateEnterpriseAdminAccess({
    method: request.method,
    path: requestUrl.pathname,
    headers: request.headers
  });

  if (decision.allowed) {
    return decision;
  }

  await recordOperationalAuditEvent({
    category: "security",
    action: "admin_access_blocked",
    status: "blocked",
    route: requestUrl.pathname,
    requestId: requestContext.id,
    summary: `Admin access blocked for ${requestUrl.pathname}.`,
    detail: decision.detail,
    metadata: {
      policy: decision.policy,
      code: decision.code,
      authRequired: decision.authProfile?.required === true
    }
  });

  sendJson(response, decision.statusCode || 403, {
    ok: false,
    code: decision.code || "ADMIN_AUTH_REQUIRED",
    message: decision.detail,
    policy: decision.policy || "",
    adminAuth: decision.authProfile || {}
  });

  return null;
}

async function enforceEnterprisePatientAccess(request, response, requestContext, requestUrl, patientId) {
  const decision = evaluateEnterprisePatientAccess({
    method: request.method,
    path: requestUrl.pathname,
    headers: request.headers,
    patientId,
    env: process.env
  });

  if (decision.allowed) {
    return decision;
  }

  await recordOperationalAuditEvent({
    category: "security",
    action: "patient_access_blocked",
    status: "blocked",
    route: requestUrl.pathname,
    requestId: requestContext.id,
    patientId: decision.patientId || patientId || "demo-patient",
    summary: `Patient-scoped access blocked for ${requestUrl.pathname}.`,
    detail: decision.detail,
    metadata: {
      policy: decision.policy || "",
      code: decision.code || "",
      headerName: decision.accessProfile?.headerName || "",
      required: decision.accessProfile?.required === true,
      actorRole: decision.identity?.role || ""
    }
  });

  sendJson(response, decision.statusCode || 403, {
    ok: false,
    code: decision.code || "PATIENT_ACCESS_REQUIRED",
    message: decision.detail,
    policy: decision.policy || "",
    patientId: decision.patientId || String(patientId || "").trim() || "demo-patient",
    patientAccess: decision.accessProfile || {}
  });

  return null;
}

const jsonApiPostRoutes = new Set([
  "/api/model-router/preview",
  "/api/admin/session",
  "/api/admin-review-history",
  "/api/trusted-sources/plan",
  "/api/model-quality/evaluate",
  "/api/local-data-mirror",
  "/api/evidence-citations",
  "/api/safety-triage",
  "/api/multimodal-intake",
  "/api/prevention-plan",
  "/api/human-review",
  "/api/doctor-ready-report",
  "/api/training/example",
  "/api/training/train",
  "/api/training/evaluate",
  "/api/analyze",
  "/api/external-knowledge/clear",
  "/api/browser-state-sync",
  "/api/memory/clear",
  "/api/records",
  "/api/records/clear",
  "/api/knowledge-graph/clear",
  "/api/realtime"
]);

function hasJsonContentType(headers = {}) {
  const rawHeader = Array.isArray(headers["content-type"]) ? headers["content-type"][0] : headers["content-type"];
  const normalized = String(rawHeader || "").trim().toLowerCase();
  return normalized.startsWith("application/json");
}

function isJsonApiRequest(request, requestUrl) {
  return String(request?.method || "").toUpperCase() === "POST"
    && jsonApiPostRoutes.has(String(requestUrl?.pathname || ""));
}

async function enforceJsonRequestContract(request, response, requestContext, requestUrl) {
  if (!isJsonApiRequest(request, requestUrl)) {
    return true;
  }

  const contract = getEnterpriseRequestContractProfile();
  const rawContentLength = Array.isArray(request.headers["content-length"])
    ? request.headers["content-length"][0]
    : request.headers["content-length"];
  const contentLength = Number.parseInt(String(rawContentLength || "").trim(), 10);

  if (!hasJsonContentType(request.headers)) {
    const detail = `POST ${requestUrl.pathname} requires Content-Type: application/json.`;

    await recordOperationalAuditEvent({
      category: "security",
      action: "json_contract_blocked",
      status: "blocked",
      route: requestUrl.pathname,
      requestId: requestContext.id,
      summary: `JSON request contract blocked ${requestUrl.pathname}.`,
      detail,
      metadata: {
        code: "JSON_CONTENT_TYPE_REQUIRED",
        supportedContentTypes: contract.supportedContentTypes
      }
    });

    sendJson(response, 415, {
      ok: false,
      code: "JSON_CONTENT_TYPE_REQUIRED",
      message: detail,
      contract: contract.summary
    });
    return false;
  }

  if (Number.isInteger(contentLength) && contentLength > contract.maxJsonBodyBytes) {
    const detail = `Request body exceeds the ${contract.maxJsonBodyBytes}-byte enterprise JSON limit.`;

    await recordOperationalAuditEvent({
      category: "security",
      action: "json_contract_blocked",
      status: "blocked",
      route: requestUrl.pathname,
      requestId: requestContext.id,
      summary: `JSON body limit blocked ${requestUrl.pathname}.`,
      detail,
      metadata: {
        code: "REQUEST_BODY_TOO_LARGE",
        contentLength,
        bodyLimitBytes: contract.maxJsonBodyBytes
      }
    });

    sendJson(response, 413, {
      ok: false,
      code: "REQUEST_BODY_TOO_LARGE",
      message: detail,
      contract: contract.summary
    });
    return false;
  }

  return true;
}

function buildCompactMirrorResponse(mirror = {}) {
  return {
    status: mirror.status || "mirror-unknown",
    reason: mirror.reason || "",
    syncedAt: mirror.syncedAt || "",
    mode: mirror.mode || "",
    primaryRoot: mirror.primaryRoot || "",
    mirrorRoot: mirror.mirrorRoot || "",
    manifest: mirror.manifest || "",
    enabled: mirror.enabled !== false,
    fileCount: Number.isFinite(mirror.fileCount) ? mirror.fileCount : 0,
    copiedCount: Number.isFinite(mirror.copiedCount) ? mirror.copiedCount : 0,
    skippedFileCount: Array.isArray(mirror.skippedFiles) ? mirror.skippedFiles.length : 0,
    error: mirror.error || ""
  };
}

function buildAnalyzeTrainingSummary(trainingCalibration = {}) {
  return {
    id: trainingCalibration.id || "LOCAL_AGENT_TRAINING_CALIBRATION",
    enabled: trainingCalibration.enabled === true,
    status: trainingCalibration.status || "waiting-for-approved-feedback",
    trainedAt: trainingCalibration.trainedAt || "",
    exampleCount: Number(trainingCalibration.exampleCount || 0),
    modelVersion: trainingCalibration.modelVersion || "",
    safetyBoundary: trainingCalibration.safetyBoundary || ""
  };
}

function buildPublicMemoryHistoryItem(item = {}) {
  return {
    id: item.id || "",
    at: item.at || "",
    message: item.message || "",
    risk: item.risk || "UNKNOWN",
    riskLabel: item.riskLabel || "",
    riskScore: Number.isFinite(Number(item.riskScore)) ? Number(item.riskScore) : null,
    summary: item.summary || "",
    continuitySummary: item.continuitySummary || "",
    routeSummary: item.routeSummary || "",
    intents: Array.isArray(item.intents) ? item.intents : [],
    routes: Array.isArray(item.routes) ? item.routes : [],
    focusFamilies: Array.isArray(item.focusFamilies) ? item.focusFamilies : [],
    signals: Array.isArray(item.signals) ? item.signals : [],
    primaryIntent: item.primaryIntent || "",
    primaryRoute: item.primaryRoute || "",
    responseOwner: item.responseOwner || "",
    responseFocusLabel: item.responseFocusLabel || "",
    specialistFocus: item.specialistFocus || "",
    specialistLens: item.specialistLens || "",
    riskModifiers: Array.isArray(item.riskModifiers) ? item.riskModifiers : [],
    wellnessSignals: Array.isArray(item.wellnessSignals) ? item.wellnessSignals : [],
    visitSignals: Array.isArray(item.visitSignals) ? item.visitSignals : [],
    agents: Array.isArray(item.agents) ? item.agents : [],
    actionItems: Array.isArray(item.actionItems) ? item.actionItems : [],
    warningSigns: Array.isArray(item.warningSigns) ? item.warningSigns : [],
    evidenceRefs: Array.isArray(item.evidenceRefs) ? item.evidenceRefs : [],
    triageLevel: item.triageLevel || "",
    triageRoute: item.triageRoute || "",
    triageSignals: Array.isArray(item.triageSignals) ? item.triageSignals : [],
    reviewReasons: Array.isArray(item.reviewReasons) ? item.reviewReasons : [],
    doctorQuestions: Array.isArray(item.doctorQuestions) ? item.doctorQuestions : [],
    preventionFocusAreas: Array.isArray(item.preventionFocusAreas) ? item.preventionFocusAreas : [],
    evidenceTitles: Array.isArray(item.evidenceTitles) ? item.evidenceTitles : [],
    documentType: item.documentType || "",
    documentMarkers: Array.isArray(item.documentMarkers) ? item.documentMarkers : [],
    documentValueHints: Array.isArray(item.documentValueHints) ? item.documentValueHints : [],
    knowledgeSnapshot: item.knowledgeSnapshot && typeof item.knowledgeSnapshot === "object" ? item.knowledgeSnapshot : null,
    requirement: item.requirement && typeof item.requirement === "object" ? item.requirement : null,
    vitals: item.vitals && typeof item.vitals === "object" ? item.vitals : {},
    context: item.context && typeof item.context === "object" ? item.context : {},
    profile: item.profile && typeof item.profile === "object" ? item.profile : {}
  };
}

function buildPublicMemory(memory = {}) {
  return {
    ...memory,
    history: Array.isArray(memory.history)
      ? memory.history.slice(0, publicMemoryHistoryLimit).map((item) => buildPublicMemoryHistoryItem(item))
      : []
  };
}

function buildPublicMemoryContext(memoryContext = {}) {
  return {
    patientId: memoryContext.patientId || "",
    recentTurnCount: Number(memoryContext.recentTurnCount || 0),
    focusedTurnCount: Number(memoryContext.focusedTurnCount || 0),
    recentRisks: Array.isArray(memoryContext.recentRisks) ? memoryContext.recentRisks : [],
    recentMessages: Array.isArray(memoryContext.recentMessages) ? memoryContext.recentMessages : [],
    focusedMessages: Array.isArray(memoryContext.focusedMessages) ? memoryContext.focusedMessages : [],
    recentActions: Array.isArray(memoryContext.recentActions) ? memoryContext.recentActions : [],
    recentWarnings: Array.isArray(memoryContext.recentWarnings) ? memoryContext.recentWarnings : [],
    recentResponseOwners: Array.isArray(memoryContext.recentResponseOwners) ? memoryContext.recentResponseOwners : [],
    recentEvidenceRefs: Array.isArray(memoryContext.recentEvidenceRefs) ? memoryContext.recentEvidenceRefs : [],
    recentTriageLevels: Array.isArray(memoryContext.recentTriageLevels) ? memoryContext.recentTriageLevels : [],
    recentTriageRoutes: Array.isArray(memoryContext.recentTriageRoutes) ? memoryContext.recentTriageRoutes : [],
    recentTriageSignals: Array.isArray(memoryContext.recentTriageSignals) ? memoryContext.recentTriageSignals : [],
    recentReviewReasons: Array.isArray(memoryContext.recentReviewReasons) ? memoryContext.recentReviewReasons : [],
    recentDoctorQuestions: Array.isArray(memoryContext.recentDoctorQuestions) ? memoryContext.recentDoctorQuestions : [],
    recentPreventionFocusAreas: Array.isArray(memoryContext.recentPreventionFocusAreas) ? memoryContext.recentPreventionFocusAreas : [],
    recentEvidenceTitles: Array.isArray(memoryContext.recentEvidenceTitles) ? memoryContext.recentEvidenceTitles : [],
    recentDocumentTypes: Array.isArray(memoryContext.recentDocumentTypes) ? memoryContext.recentDocumentTypes : [],
    recentDocumentMarkers: Array.isArray(memoryContext.recentDocumentMarkers) ? memoryContext.recentDocumentMarkers : [],
    recentDocumentValueHints: Array.isArray(memoryContext.recentDocumentValueHints) ? memoryContext.recentDocumentValueHints : [],
    recentSpecialistFocuses: Array.isArray(memoryContext.recentSpecialistFocuses) ? memoryContext.recentSpecialistFocuses : [],
    recentRiskModifiers: Array.isArray(memoryContext.recentRiskModifiers) ? memoryContext.recentRiskModifiers : [],
    recentWellnessSignals: Array.isArray(memoryContext.recentWellnessSignals) ? memoryContext.recentWellnessSignals : [],
    recentVisitSignals: Array.isArray(memoryContext.recentVisitSignals) ? memoryContext.recentVisitSignals : [],
    recentRoutes: Array.isArray(memoryContext.recentRoutes) ? memoryContext.recentRoutes : [],
    recentVitals: Array.isArray(memoryContext.recentVitals) ? memoryContext.recentVitals : [],
    recentProfiles: Array.isArray(memoryContext.recentProfiles) ? memoryContext.recentProfiles : [],
    activeFocusFamilies: Array.isArray(memoryContext.activeFocusFamilies) ? memoryContext.activeFocusFamilies : [],
    continuitySignals: Array.isArray(memoryContext.continuitySignals) ? memoryContext.continuitySignals : [],
    previousVitals: memoryContext.previousVitals && typeof memoryContext.previousVitals === "object" ? memoryContext.previousVitals : {},
    latestProfile: memoryContext.latestProfile && typeof memoryContext.latestProfile === "object" ? memoryContext.latestProfile : {},
    latestVitals: memoryContext.latestVitals && typeof memoryContext.latestVitals === "object" ? memoryContext.latestVitals : {},
    latestContext: memoryContext.latestContext && typeof memoryContext.latestContext === "object" ? memoryContext.latestContext : {},
    summary: memoryContext.summary || "",
    continuitySummary: memoryContext.continuitySummary || "",
    persistence: memoryContext.persistence || "",
    storage: memoryContext.storage || "",
    savedTurns: Number(memoryContext.savedTurns || 0)
  };
}

function buildPublicSmartPrecisionSupervisor(precisionSupervisor = {}) {
  if (!precisionSupervisor || typeof precisionSupervisor !== "object") {
    return precisionSupervisor;
  }

  return {
    id: precisionSupervisor.id || "",
    score: Number(precisionSupervisor.score || 0),
    label: precisionSupervisor.label || "",
    summary: precisionSupervisor.summary || ""
  };
}

function buildPublicSmartLlmBrain(llmBrain = {}) {
  if (!llmBrain || typeof llmBrain !== "object") {
    return llmBrain;
  }

  return {
    id: llmBrain.id || "",
    score: Number(llmBrain.score || 0),
    label: llmBrain.label || "",
    status: llmBrain.status || "",
    summary: llmBrain.summary || "",
    processingMode: llmBrain.processingMode || "",
    routeDecision: llmBrain.routeDecision && typeof llmBrain.routeDecision === "object"
      ? {
        ownerRoute: llmBrain.routeDecision.ownerRoute || "",
        ownerLabel: llmBrain.routeDecision.ownerLabel || "",
        reason: llmBrain.routeDecision.reason || ""
      }
      : null,
    taskProfile: llmBrain.taskProfile && typeof llmBrain.taskProfile === "object"
      ? {
        label: llmBrain.taskProfile.label || "",
        mode: llmBrain.taskProfile.mode || "",
        focusAreas: Array.isArray(llmBrain.taskProfile.focusAreas) ? llmBrain.taskProfile.focusAreas : []
      }
      : null
  };
}

function buildPublicSmartAgenticReview(agenticReview = {}) {
  if (!agenticReview || typeof agenticReview !== "object") {
    return agenticReview;
  }

  return {
    id: agenticReview.id || "",
    score: Number(agenticReview.score || 0),
    label: agenticReview.label || "",
    status: agenticReview.status || "",
    summary: agenticReview.summary || "",
    nextBestAction: agenticReview.nextBestAction || "",
    reasoningQuality: agenticReview.reasoningQuality && typeof agenticReview.reasoningQuality === "object"
      ? {
        score: Number(agenticReview.reasoningQuality.score || 0),
        label: agenticReview.reasoningQuality.label || "",
        summary: agenticReview.reasoningQuality.summary || ""
      }
      : null,
    requirementFit: agenticReview.requirementFit && typeof agenticReview.requirementFit === "object"
      ? {
        score: Number(agenticReview.requirementFit.score || 0),
        label: agenticReview.requirementFit.label || "",
        summary: agenticReview.requirementFit.summary || ""
      }
      : null
  };
}

function buildPublicMedicalKnowledge(medicalKnowledge = {}) {
  return {
    mode: medicalKnowledge.mode || "offline-local-rag",
    offlineReady: medicalKnowledge.offlineReady !== false,
    onlineReady: medicalKnowledge.onlineReady === true,
    onlineStatus: medicalKnowledge.onlineStatus || "disabled",
    externalKnowledge: medicalKnowledge.externalKnowledge || {},
    corpusSize: Number(medicalKnowledge.corpusSize || 0),
    localCorpusSize: Number(medicalKnowledge.localCorpusSize || 0),
    offlineDatabase: medicalKnowledge.offlineDatabase || {},
    coverageScore: Number(medicalKnowledge.coverageScore || 0),
    localAi: medicalKnowledge.localAi && typeof medicalKnowledge.localAi === "object"
      ? {
        id: medicalKnowledge.localAi.id || "",
        version: medicalKnowledge.localAi.version || "",
        mode: medicalKnowledge.localAi.mode || "",
        score: Number(medicalKnowledge.localAi.score || 0),
        queryTokenCount: Number(medicalKnowledge.localAi.queryTokenCount || 0),
        expandedQueryTokenCount: Number(medicalKnowledge.localAi.expandedQueryTokenCount || 0),
        candidateCount: Number(medicalKnowledge.localAi.candidateCount || 0),
        prefiltered: Boolean(medicalKnowledge.localAi.prefiltered),
        candidateReduction: Number(medicalKnowledge.localAi.candidateReduction || 0),
        retrievalCacheHit: Boolean(medicalKnowledge.localAi.retrievalCacheHit),
        corpusCacheHit: Boolean(medicalKnowledge.localAi.corpusCacheHit),
        queryCacheHit: Boolean(medicalKnowledge.localAi.queryCacheHit),
        scope: medicalKnowledge.localAi.scope || "",
        primaryRoute: medicalKnowledge.localAi.primaryRoute || "",
        rankingDiagnostics: medicalKnowledge.localAi.rankingDiagnostics && typeof medicalKnowledge.localAi.rankingDiagnostics === "object"
          ? {
            topMatchMargin: Number(medicalKnowledge.localAi.rankingDiagnostics.topMatchMargin || 0),
            topMatchScore: Number(medicalKnowledge.localAi.rankingDiagnostics.topMatchScore || 0),
            sourceFamilyDiversity: Number(medicalKnowledge.localAi.rankingDiagnostics.sourceFamilyDiversity || 0),
            categoryDiversity: Number(medicalKnowledge.localAi.rankingDiagnostics.categoryDiversity || 0),
            ambiguityPenalty: Number(medicalKnowledge.localAi.rankingDiagnostics.ambiguityPenalty || 0),
            ambiguousTopSet: Boolean(medicalKnowledge.localAi.rankingDiagnostics.ambiguousTopSet),
            weightedCategoryCount: Number(medicalKnowledge.localAi.rankingDiagnostics.weightedCategoryCount || 0),
            candidateCount: Number(medicalKnowledge.localAi.rankingDiagnostics.candidateCount || 0),
            candidateShare: Number(medicalKnowledge.localAi.rankingDiagnostics.candidateShare || 0)
          }
          : null
      }
      : null,
    matches: Array.isArray(medicalKnowledge.matches) ? medicalKnowledge.matches : [],
    limitations: Array.isArray(medicalKnowledge.limitations) ? medicalKnowledge.limitations : [],
    learningBoundary: medicalKnowledge.learningBoundary || "",
    dataPolicy: medicalKnowledge.dataPolicy || ""
  };
}

function buildPublicSmartAnalysis(smartAnalysis = {}) {
  if (!smartAnalysis || typeof smartAnalysis !== "object") {
    return smartAnalysis;
  }

  const compact = {
    ...smartAnalysis
  };

  delete compact.medicalKnowledge;
  delete compact.messageSignals;
  delete compact.contextSignals;
  delete compact.vitalAssessment;
  delete compact.intentAnalysis;
  delete compact.routeAnalysis;
  delete compact.patientContext;
  compact.precisionSupervisor = buildPublicSmartPrecisionSupervisor(compact.precisionSupervisor);
  compact.llmBrain = buildPublicSmartLlmBrain(compact.llmBrain);
  compact.agenticReview = buildPublicSmartAgenticReview(compact.agenticReview);

  return compact;
}

function buildPublicAuditTrail(auditTrail = []) {
  return Array.isArray(auditTrail)
    ? auditTrail.map((entry) => ({
      step: entry?.step || "",
      summary: entry?.summary || entry?.detail || entry?.message || ""
    }))
    : [];
}

function buildPublicAnalyzeResult(result = {}) {
  return {
    ...result,
    memoryContext: buildPublicMemoryContext(result.memoryContext),
    memory: buildPublicMemory(result.memory),
    trainingCalibration: buildAnalyzeTrainingSummary(result.trainingCalibration),
    medicalKnowledge: buildPublicMedicalKnowledge(result.medicalKnowledge),
    smartAnalysis: buildPublicSmartAnalysis(result.smartAnalysis),
    auditTrail: buildPublicAuditTrail(result.auditTrail)
  };
}

function buildAnalyzeMirrorFiles(patientId) {
  return [
    mirrorDataFiles.audit,
    mirrorDataFiles.memory,
    buildPatientGraphMirrorFile(patientId)
  ];
}

function warmAnalyzeMedicalRetrieval() {
  try {
    warmHealthEngineRuntime();
  } catch (error) {
    console.warn("Care Nova AI local retrieval warmup skipped.", error?.message || error);
  }
}

function buildPatientGraphMirrorFile(patientId) {
  return `data/graph/patients/${normalizeDataPatientId(patientId)}.json`;
}

function normalizeDataPatientId(value) {
  const cleaned = String(value || "demo-patient")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return cleaned || "demo-patient";
}

async function readJsonBody(request) {
  const chunks = [];
  let bodyLength = 0;
  const maxJsonBodyBytes = getMaxJsonBodyBytes();

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bodyLength += buffer.length;

    if (bodyLength > maxJsonBodyBytes) {
      const error = new Error("Request body is too large.");
      error.statusCode = 413;
      error.code = "REQUEST_BODY_TOO_LARGE";
      throw error;
    }

    chunks.push(buffer);
  }

  const body = Buffer.concat(chunks, bodyLength).toString("utf8");

  if (!body.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(body);

    if (!isPlainObject(parsed)) {
      const error = new Error("Request body must be a JSON object.");
      error.statusCode = 400;
      error.code = "JSON_OBJECT_REQUIRED";
      throw error;
    }

    return parsed;
  } catch (error) {
    if (error?.code === "JSON_OBJECT_REQUIRED") {
      throw error;
    }

    const parseError = new Error("Request body must be valid JSON.");
    parseError.statusCode = 400;
    parseError.code = "INVALID_JSON";
    throw parseError;
  }
}

function getStaticPath(pathname) {
  let decodedPath;

  try {
    decodedPath = decodeURIComponent(pathname === "/" ? "/index.html" : pathname);
  } catch {
    return null;
  }

  const staticRoot = decodedPath.startsWith("/large-assets/")
    ? largeAssetsDir
    : publicDir;
  const staticPath = decodedPath.startsWith("/large-assets/")
    ? decodedPath.replace(/^\/large-assets/, "")
    : decodedPath;
  const targetPath = resolve(staticRoot, `.${staticPath}`);
  const publicPrefix = staticRoot.endsWith(sep) ? staticRoot : `${staticRoot}${sep}`;

  if (targetPath !== staticRoot && !targetPath.startsWith(publicPrefix)) {
    return null;
  }

  return targetPath;
}

async function serveStatic(request, requestUrl, response) {
  const targetPath = getStaticPath(requestUrl.pathname);

  if (!targetPath) {
    sendText(response, 403, "Forbidden");
    return;
  }

  try {
    const fileStats = await stat(targetPath);

    if (!fileStats.isFile()) {
      sendText(response, 404, "Not found");
      return;
    }

    const contentType = mimeTypes[extname(targetPath)] || "application/octet-stream";
    const range = request.headers.range;
    const baseHeaders = {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
      "Accept-Ranges": "bytes",
      ...getSecurityHeaders(),
      ...getCorsHeaders()
    };

    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);

      if (!match) {
        response.writeHead(416, {
          ...baseHeaders,
          "Content-Range": `bytes */${fileStats.size}`
        });
        response.end();
        return;
      }

      const requestedStart = match[1] ? Number.parseInt(match[1], 10) : null;
      const requestedEnd = match[2] ? Number.parseInt(match[2], 10) : null;
      const suffixLength = requestedStart === null ? requestedEnd || 0 : 0;
      const start = requestedStart === null ? Math.max(0, fileStats.size - suffixLength) : requestedStart;
      const end = requestedStart === null ? fileStats.size - 1 : Math.min(requestedEnd ?? fileStats.size - 1, fileStats.size - 1);

      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= fileStats.size || (requestedStart === null && suffixLength <= 0)) {
        response.writeHead(416, {
          ...baseHeaders,
          "Content-Range": `bytes */${fileStats.size}`
        });
        response.end();
        return;
      }

      const stream = createReadStream(targetPath, { start, end });
      response.writeHead(206, {
        ...baseHeaders,
        "Content-Length": end - start + 1,
        "Content-Range": `bytes ${start}-${end}/${fileStats.size}`
      });

      if (request.method === "HEAD") {
        response.end();
        return;
      }

      stream.pipe(response);
      return;
    }

    response.writeHead(200, {
      ...baseHeaders,
      "Content-Length": fileStats.size
    });

    if (request.method === "HEAD") {
      response.end();
      return;
    }

    createReadStream(targetPath).pipe(response);
  } catch (error) {
    if (error.code === "ENOENT") {
      sendText(response, 404, "Not found");
      return;
    }

    throw error;
  }
}

async function handleRequest(request, response) {
  const requestUrl = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  const requestContext = createRequestContext(request, requestUrl);
  attachOperationalRequestContext(response, requestContext);

  if (!(await enforceEnterpriseOriginAccess(request, response, requestContext, requestUrl))) {
    return;
  }

  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": getCorsAllowHeaders(),
      "Access-Control-Max-Age": "86400",
      ...getSecurityHeaders(),
      ...getCorsHeaders()
    });
    response.end();
    return;
  }

  if (!applyRateLimit(request, response, requestContext, requestUrl)) {
    return;
  }

  if (!(await enforceEnterpriseMutationControls(request, response, requestContext, requestUrl))) {
    return;
  }

  const adminAccessDecision = await enforceEnterpriseAdminAccess(request, response, requestContext, requestUrl);

  if (!adminAccessDecision) {
    return;
  }

  if (!(await enforceJsonRequestContract(request, response, requestContext, requestUrl))) {
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/health") {
    const healthCorsOrigin = isLoopbackHealthProbeRequest({
      headers: request.headers,
      path: requestUrl.pathname,
      env: process.env
    })
      ? "*"
      : allowedOrigin || "*";

    sendJson(response, 200, await getHealthPayload(), {
      "Access-Control-Allow-Origin": healthCorsOrigin,
      "Cross-Origin-Resource-Policy": "cross-origin"
    });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/ready") {
    const traffic = getTrafficStateSnapshot();
    const runtime = getRuntimeSnapshot();
    const ai = getLocalAiRuntimeStatus();
    const externalKnowledge = getExternalKnowledgeStatus();
    const deploymentReadiness = getDeploymentReadiness(runtime);
    const startupReadiness = getEnterpriseStartupReadiness(process.env, runtime);
    const incidentPosture = getEnterpriseIncidentPosture(process.env);
    const recoveryPosture = getEnterpriseRecoveryPosture(process.env);
    const publicShareReady = deploymentReadiness.publicDeployment?.publicShareReady !== false;
    const ready = traffic.acceptingTraffic && publicShareReady;
    const [audit, storageIntegrity] = await Promise.all([
      loadEnterpriseAuditLog(process.env, { limit: 10 }),
      getStorageIntegrityReport(process.env)
    ]);

    if (!ready) {
      const gateDetail = deploymentReadiness.publicDeployment?.blockingChecks?.join("; ")
        || "Traffic state or public-hosting controls require review.";
      const gateSignature = `${traffic.state}|${deploymentReadiness.status}|${gateDetail}`;
      const nowMs = Date.now();

      if (gateSignature !== lastReadinessGateAuditSignature || (nowMs - lastReadinessGateAuditAtMs) >= 300_000) {
        lastReadinessGateAuditSignature = gateSignature;
        lastReadinessGateAuditAtMs = nowMs;
        void recordOperationalAuditEvent({
          category: "deployment",
          action: "readiness_gate_blocked",
          status: "warning",
          route: "/api/ready",
          requestId: response.__careNovaRequestContext?.id,
          summary: "Readiness gate blocked shared traffic.",
          detail: gateDetail,
          metadata: {
            trafficState: traffic.state,
            deploymentStatus: deploymentReadiness.status,
            publicShareReady
          }
        });
      }
    }

    sendJson(response, ready ? 200 : 503, {
      ok: ready,
      status: ready
        ? "ready"
        : traffic.acceptingTraffic
          ? "deployment-review-needed"
          : "draining",
      app: "Care Nova AI",
      version: APP_VERSION,
      traffic,
      operations: getOperationalControlsSummary(),
      audit: buildCompactAuditSummary(audit),
      enterpriseRuntime: getEnterpriseRuntimeSummary({ ai, runtime, externalKnowledge }),
      configReadiness: getEnterpriseConfigReadiness(process.env, runtime),
      startupReadiness: {
        status: startupReadiness.status,
        summary: startupReadiness.summary,
        reviewPointCount: Array.isArray(startupReadiness.reviewPoints) ? startupReadiness.reviewPoints.length : 0
      },
      incidentPosture: {
        status: incidentPosture.status,
        summary: incidentPosture.summary,
        reviewPointCount: Array.isArray(incidentPosture.reviewPoints) ? incidentPosture.reviewPoints.length : 0
      },
      recoveryPosture: {
        status: recoveryPosture.status,
        summary: recoveryPosture.summary,
        reviewPointCount: Array.isArray(recoveryPosture.reviewPoints) ? recoveryPosture.reviewPoints.length : 0
      },
      deploymentReadinessStatus: deploymentReadiness.status,
      publicDeployment: deploymentReadiness.publicDeployment,
      storageIntegrity: buildCompactStorageIntegrity(storageIntegrity),
      probes: {
        health: "/api/health",
        deploymentReadiness: "/api/deployment-readiness",
        offlineKnowledge: "/api/knowledge",
        localAi: "/api/local-ai",
        agenticRuntime: "/api/agentic-runtime",
        modelRouter: "/api/model-router",
        modelRouterPreview: "/api/model-router/preview",
        modelHealth: "/api/model-health",
        externalKnowledge: "/api/external-knowledge",
        trustedSources: "/api/trusted-sources",
        modelQuality: "/api/model-quality",
        governance: "/api/governance",
        offlinePacks: "/api/offline-packs",
        fhir: "/api/fhir",
        reportTemplates: "/api/report-templates",
        advancedCapabilities: "/api/advanced-capabilities",
        evaluationDashboard: "/api/evaluation-dashboard",
        knowledgeGraph: "/api/knowledge-graph",
        safetyTriage: "/api/safety-triage",
        evidenceCitations: "/api/evidence-citations",
        humanReview: "/api/human-review",
        multimodalIntake: "/api/multimodal-intake",
        preventionPlan: "/api/prevention-plan",
        offlinePackManager: "/api/offline-pack-manager",
        fhirConnector: "/api/fhir-connector",
        adminSession: "/api/admin/session",
        adminPolicy: "/api/admin-policy",
        configReadiness: "/api/config-readiness",
        startupReadiness: "/api/startup-readiness",
        dataRetentionPolicy: "/api/data-retention-policy",
        incidentPosture: "/api/incident-posture",
        recoveryPosture: "/api/recovery-posture",
        adminSecretPosture: "/api/admin-secret-posture",
        adminReviewPacket: "/api/admin-review-packet",
        adminReleaseSnapshot: "/api/admin-release-snapshot",
        adminReviewHistory: "/api/admin-review-history",
        adminTrustCenter: "/api/admin-trust-center",
        auditEvents: "/api/audit-events",
        backupPlan: "/api/backup-plan",
        doctorReadyReport: "/api/doctor-ready-report",
        browserState: "/api/browser-state",
        browserStateSync: "/api/browser-state-sync",
        localDataMirror: "/api/local-data-mirror",
        medicineLookup: "/api/medicine/lookup",
        runtimeMetrics: "/api/runtime-metrics",
        storageIntegrity: "/api/storage-integrity",
        training: "/api/training",
        trainingExample: "/api/training/example",
        trainingRun: "/api/training/train",
        trainingEvaluate: "/api/training/evaluate"
      },
      runtime,
      timestamp: new Date().toISOString()
    });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/agentic-runtime") {
    sendJson(response, 200, {
      ok: true,
      app: "Care Nova AI",
      version: APP_VERSION,
      agenticRuntime: getAdaptiveRuntimePolicy(),
      timestamp: new Date().toISOString()
    });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/model") {
    sendJson(response, 200, getModelBlueprint());
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/model-router") {
    await ensureLocalRuntimeProbeFresh(process.env, {
      probeTimeoutMs: 600
    }).catch(() => {});
    sendJson(response, 200, {
      ok: true,
      app: "Care Nova AI",
      version: APP_VERSION,
      router: getHybridModelRouterStatus(),
      timestamp: new Date().toISOString()
    });
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/model-router/preview") {
    try {
      await ensureLocalRuntimeProbeFresh(process.env, {
        probeTimeoutMs: 600
      }).catch(() => {});
      const payload = await readJsonBody(request);

      sendJson(response, 200, {
        app: "Care Nova AI",
        version: APP_VERSION,
        ...buildModelRouterPreview(payload)
      });
    } catch (error) {
      sendJson(response, error.statusCode || 500, {
        ok: false,
        code: error.code || "MODEL_ROUTER_PREVIEW_ERROR",
        message: error.message || "Unable to preview model routing."
      });
    }
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/readiness") {
    const runtime = getRuntimeSnapshot();
    const ai = getLocalAiRuntimeStatus();
    const externalKnowledge = getExternalKnowledgeStatus();
    const deploymentReadiness = getDeploymentReadiness(runtime);
    const startupReadiness = getEnterpriseStartupReadiness(process.env, runtime);
    const [audit, storageIntegrity] = await Promise.all([
      loadEnterpriseAuditLog(process.env, { limit: 10 }),
      getStorageIntegrityReport(process.env)
    ]);

    sendJson(response, 200, {
      ...getReadinessReport(),
      audit: buildCompactAuditSummary(audit),
      operations: getOperationalControlsSummary(),
      configReadiness: getEnterpriseConfigReadiness(process.env, runtime),
      startupReadiness,
      storageIntegrity: buildCompactStorageIntegrity(storageIntegrity),
      traffic: getTrafficStateSnapshot(),
      runtime,
      deploymentReadinessStatus: deploymentReadiness.status,
      publicDeployment: deploymentReadiness.publicDeployment,
      enterpriseRuntime: getEnterpriseRuntimeSummary({ ai, runtime, externalKnowledge })
    });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/deployment") {
    sendJson(response, 200, getDeploymentGuide());
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/deployment-readiness") {
    const runtime = getRuntimeSnapshot();
    const ai = getLocalAiRuntimeStatus();
    const externalKnowledge = getExternalKnowledgeStatus();
    const startupReadiness = getEnterpriseStartupReadiness(process.env, runtime);
    const [audit, storageIntegrity] = await Promise.all([
      loadEnterpriseAuditLog(process.env, { limit: 10 }),
      getStorageIntegrityReport(process.env)
    ]);

    sendJson(response, 200, {
      ...getDeploymentReadiness(runtime),
      audit: buildCompactAuditSummary(audit),
      operations: getOperationalControlsSummary(),
      configReadiness: getEnterpriseConfigReadiness(process.env, runtime),
      startupReadiness,
      storageIntegrity: buildCompactStorageIntegrity(storageIntegrity),
      traffic: getTrafficStateSnapshot(),
      enterpriseRuntime: getEnterpriseRuntimeSummary({ ai, runtime, externalKnowledge })
    });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/admin-policy") {
    sendJson(response, 200, {
      ...(await getAdminPolicySnapshot()),
      app: "Care Nova AI",
      version: APP_VERSION
    });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/config-readiness") {
    sendJson(response, 200, {
      ...getEnterpriseConfigReadiness(process.env, getRuntimeSnapshot()),
      app: "Care Nova AI",
      version: APP_VERSION
    });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/startup-readiness") {
    const runtime = getRuntimeSnapshot();

    sendJson(response, 200, {
      ...getEnterpriseStartupReadiness(process.env, runtime),
      app: "Care Nova AI",
      version: APP_VERSION,
      runtime
    });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/data-retention-policy") {
    sendJson(response, 200, {
      ...getEnterpriseDataRetentionPolicy(process.env),
      app: "Care Nova AI",
      version: APP_VERSION
    });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/incident-posture") {
    sendJson(response, 200, {
      ...getEnterpriseIncidentPosture(process.env),
      app: "Care Nova AI",
      version: APP_VERSION
    });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/recovery-posture") {
    sendJson(response, 200, {
      ...getEnterpriseRecoveryPosture(process.env),
      app: "Care Nova AI",
      version: APP_VERSION
    });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/admin-secret-posture") {
    sendJson(response, 200, {
      ...getEnterpriseSecretPosture(process.env),
      app: "Care Nova AI",
      version: APP_VERSION
    });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/admin-review-packet") {
    const includeEvents = readBooleanEnvFlag(requestUrl.searchParams.get("includeEvents"));
    const redactPatientIds = requestUrl.searchParams.has("redactPatientIds")
      ? readBooleanEnvFlag(requestUrl.searchParams.get("redactPatientIds"))
      : true;
    const redactRequestIds = requestUrl.searchParams.has("redactRequestIds")
      ? readBooleanEnvFlag(requestUrl.searchParams.get("redactRequestIds"))
      : true;
    const download = readBooleanEnvFlag(requestUrl.searchParams.get("download"));
    const eventLimit = parsePositiveQueryInteger(requestUrl.searchParams.get("eventLimit"), 10, 1, 100);
    const runtime = getRuntimeSnapshot();
    const ai = getLocalAiRuntimeStatus();
    const externalKnowledge = getExternalKnowledgeStatus();
    const enterpriseRuntime = getEnterpriseRuntimeSummary({ ai, runtime, externalKnowledge });
    const deploymentReadiness = getDeploymentReadiness(runtime);
    const configReadiness = getEnterpriseConfigReadiness(process.env, runtime);
    const governance = getGovernanceReadiness(runtime);

    const [adminPolicy, runtimeMetrics, storageIntegrity, audit] = await Promise.all([
      getAdminPolicySnapshot(),
      Promise.resolve(getEnterpriseRuntimeMetricsSnapshot(process.env)),
      getStorageIntegrityReport(process.env),
      loadEnterpriseAuditLog(process.env, { limit: eventLimit })
    ]);

    const reviewPacket = buildEnterpriseReviewPacket({
      app: "Care Nova AI",
      version: APP_VERSION,
      runtime,
      ai,
      externalKnowledge,
      enterpriseRuntime,
      adminPolicy,
      deploymentReadiness,
      configReadiness,
      governance,
      storageIntegrity,
      runtimeMetrics,
      audit,
      includeEvents,
      redactPatientIds,
      redactRequestIds
    });

    sendJson(response, 200, reviewPacket, download
      ? {
        "Content-Disposition": `attachment; filename="care-nova-admin-review-${new Date().toISOString().slice(0, 10)}.json"`
      }
      : {});
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/admin-release-snapshot") {
    const download = readBooleanEnvFlag(requestUrl.searchParams.get("download"));
    const runtime = getRuntimeSnapshot();
    const ai = getLocalAiRuntimeStatus();
    const externalKnowledge = getExternalKnowledgeStatus();
    const enterpriseRuntime = getEnterpriseRuntimeSummary({ ai, runtime, externalKnowledge });
    const deploymentReadiness = getDeploymentReadiness(runtime);
    const configReadiness = getEnterpriseConfigReadiness(process.env, runtime);
    const startupReadiness = getEnterpriseStartupReadiness(process.env, runtime);
    const dataRetention = getEnterpriseDataRetentionPolicy(process.env);
    const incidentPosture = getEnterpriseIncidentPosture(process.env);
    const recoveryPosture = getEnterpriseRecoveryPosture(process.env);
    const secretPosture = getEnterpriseSecretPosture(process.env);
    const governance = getGovernanceReadiness(runtime);

    const [adminPolicy, runtimeMetrics, storageIntegrity, audit, reviewHistory] = await Promise.all([
      getAdminPolicySnapshot(),
      Promise.resolve(getEnterpriseRuntimeMetricsSnapshot(process.env)),
      getStorageIntegrityReport(process.env),
      loadEnterpriseAuditLog(process.env, { limit: 20 }),
      loadEnterpriseReviewHistory(process.env, { limit: 10 })
    ]);

    const releaseSnapshot = buildEnterpriseReleaseSnapshot({
      app: "Care Nova AI",
      version: APP_VERSION,
      runtime,
      ai,
      externalKnowledge,
      enterpriseRuntime,
      adminPolicy,
      deploymentReadiness,
      configReadiness,
      startupReadiness,
      dataRetention,
      incidentPosture,
      recoveryPosture,
      secretPosture,
      governance,
      storageIntegrity,
      runtimeMetrics,
      audit,
      reviewHistory
    }, process.env);

    if (download) {
      const identity = resolveEnterpriseAdminIdentity({ headers: request.headers, env: process.env });

      await recordOperationalAuditEvent({
        category: "deployment",
        action: "release_snapshot_export",
        status: "success",
        route: requestUrl.pathname,
        requestId: requestContext.id,
        actor: identity.actorId || "",
        summary: "Enterprise release snapshot exported.",
        detail: `Release snapshot exported as ${releaseSnapshot.signature.method}.`,
        metadata: {
          role: identity.role || "",
          signed: releaseSnapshot.signature.signed === true,
          signatureMethod: releaseSnapshot.signature.method,
          releaseApproved: releaseSnapshot.summary.releaseApproved === true
        }
      });
    }

    sendJson(response, 200, releaseSnapshot, download
      ? {
        "Content-Disposition": `attachment; filename="care-nova-release-snapshot-${new Date().toISOString().slice(0, 10)}.json"`
      }
      : {});
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/admin-review-history") {
    const decision = requestUrl.searchParams.get("decision") || "";
    const role = requestUrl.searchParams.get("role") || "";
    const limit = parsePositiveQueryInteger(requestUrl.searchParams.get("limit"), 20, 1, 100);

    sendJson(response, 200, {
      ...(await loadEnterpriseReviewHistory(process.env, { decision, role, limit })),
      app: "Care Nova AI",
      version: APP_VERSION
    });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/audit-events") {
    const category = requestUrl.searchParams.get("category") || "";
    const status = requestUrl.searchParams.get("status") || requestUrl.searchParams.get("severity") || "";
    const route = requestUrl.searchParams.get("route") || "";
    const patientId = requestUrl.searchParams.get("patientId") || "";
    const limit = parsePositiveQueryInteger(requestUrl.searchParams.get("limit"), 50, 1, 250);
    const download = readBooleanEnvFlag(requestUrl.searchParams.get("download"));
    const auditPayload = {
      ...(await loadEnterpriseAuditLog(process.env, { category, status, route, patientId, limit })),
      app: "Care Nova AI",
      version: APP_VERSION
    };

    if (download) {
      const identity = resolveEnterpriseAdminIdentity({ headers: request.headers, env: process.env });

      await recordOperationalAuditEvent({
        category: "admin",
        action: "audit_export",
        status: "success",
        route: requestUrl.pathname,
        requestId: requestContext.id,
        actor: identity.actorId || "",
        summary: "Operational audit log exported.",
        detail: "Audit events were downloaded from the protected enterprise audit endpoint.",
        metadata: {
          role: identity.role || "",
          category: category || "",
          status: status || "",
          limit
        }
      });
    }

    sendJson(response, 200, auditPayload, download
      ? {
        "Content-Disposition": `attachment; filename="care-nova-audit-events-${new Date().toISOString().slice(0, 10)}.json"`
      }
      : {});
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/storage-integrity") {
    sendJson(response, 200, {
      ...(await getStorageIntegrityReport(process.env)),
      app: "Care Nova AI",
      version: APP_VERSION
    });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/runtime-metrics") {
    sendJson(response, 200, {
      ...getEnterpriseRuntimeMetricsSnapshot(),
      app: "Care Nova AI",
      version: APP_VERSION
    });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/knowledge") {
    sendJson(response, 200, getOfflineKnowledgeDatabase());
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/local-ai") {
    await ensureLocalRuntimeProbeFresh(process.env, {
      probeTimeoutMs: 600
    }).catch(() => {});
    sendJson(response, 200, {
      ok: true,
      app: "Care Nova AI",
      version: APP_VERSION,
      ai: getLocalAiRuntimeStatus(),
      localReasoningAssist: getLocalReasoningAssistStatus(),
      temporaryCloudLlm: getTemporaryCloudLlmStatus(),
      modelHealth: getModelHealthStatus(),
      timestamp: new Date().toISOString()
    });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/model-health") {
    await ensureLocalRuntimeProbeFresh(process.env, {
        probeTimeoutMs: 600
    }).catch(() => {});
    const hybridRouter = getHybridModelRouterStatus();

    sendJson(response, 200, {
      ok: true,
      app: "Care Nova AI",
      version: APP_VERSION,
      modelHealth: getModelHealthStatus(),
      localReasoningAssist: getLocalReasoningAssistStatus(),
      temporaryCloudLlm: getTemporaryCloudLlmStatus(),
      hybridRouter: {
        status: hybridRouter.status,
        mode: hybridRouter.mode,
        summary: hybridRouter.summary,
        connectivity: hybridRouter.connectivity,
        fallbackPolicy: hybridRouter.fallbackPolicy
      },
      fallbackAvailable: true,
      timestamp: new Date().toISOString()
    });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/admin/session") {
    sendJson(response, 200, {
      ...getEnterpriseAdminSessionSnapshot({ headers: request.headers }),
      guide: getEnterpriseAdminAuthGuide(),
      app: "Care Nova AI",
      version: APP_VERSION
    });
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/admin/session") {
    try {
      const payload = await readJsonBody(request);
      const authProfile = getEnterpriseAdminAuthProfile();
      const presentedToken = String(
        payload.token
        || payload.adminToken
        || request.headers[authProfile.adminHeaderName.toLowerCase()]
        || request.headers["x-admin-token"]
        || ""
      ).trim();

      if (!authProfile.adminTokenConfigured || !authProfile.sessionSecretConfigured) {
        sendJson(response, 503, {
          ok: false,
          code: "ADMIN_AUTH_NOT_CONFIGURED",
          message: "Admin session login requires CARE_NOVA_ADMIN_API_TOKEN and CARE_NOVA_ADMIN_SESSION_SECRET.",
          adminAuth: authProfile.summary
        });
        return;
      }

      const identity = resolveEnterpriseAdminIdentity({
        headers: {
          [authProfile.adminHeaderName.toLowerCase()]: presentedToken
        }
      });

      if (!identity.authenticated) {
        await recordOperationalAuditEvent({
          category: "security",
          action: "admin_session_login_failed",
          status: "blocked",
          route: "/api/admin/session",
          requestId: response.__careNovaRequestContext?.id,
          summary: "Admin session login failed.",
          detail: "Provided admin token was rejected."
        });
        sendJson(response, 403, {
          ok: false,
          code: "ADMIN_AUTH_REQUIRED",
          message: "A valid admin token is required to create an admin session."
        });
        return;
      }

      const session = buildEnterpriseAdminSession({
        actorId: String(payload.actorId || identity.actorId || "enterprise-admin").trim() || "enterprise-admin",
        role: identity.role || "admin"
      });

      if (!session.ok) {
        sendJson(response, 503, {
          ok: false,
          code: session.code || "ADMIN_SESSION_CREATE_ERROR",
          message: session.message || "Unable to issue an admin session."
        });
        return;
      }

      await recordOperationalAuditEvent({
        category: "security",
        action: "admin_session_login",
        status: "success",
        route: "/api/admin/session",
        requestId: response.__careNovaRequestContext?.id,
        summary: "Admin session login succeeded.",
        detail: `Issued an admin session for ${session.payload.actorId}.`,
        metadata: {
          actorId: session.payload.actorId,
          expiresAt: session.payload.expiresAt
        }
      });

      sendJson(response, 200, {
        ok: true,
        status: "admin-session-created",
        session: {
          actorId: session.payload.actorId,
          role: session.payload.role,
          issuedAt: session.payload.issuedAt,
          expiresAt: session.payload.expiresAt
        },
        app: "Care Nova AI",
        version: APP_VERSION,
        timestamp: new Date().toISOString()
      }, {
        "Set-Cookie": session.cookie
      });
    } catch (error) {
      sendJson(response, error.statusCode || 500, {
        ok: false,
        code: error.code || "ADMIN_SESSION_LOGIN_ERROR",
        message: error.message || "Unable to create the admin session."
      });
    }
    return;
  }

  if (request.method === "DELETE" && requestUrl.pathname === "/api/admin/session") {
    await recordOperationalAuditEvent({
      category: "security",
      action: "admin_session_logout",
      status: "success",
      route: "/api/admin/session",
      requestId: response.__careNovaRequestContext?.id,
      summary: "Admin session cleared.",
      detail: "The admin session cookie was cleared."
    });

    sendJson(response, 200, {
      ok: true,
      status: "admin-session-cleared",
      app: "Care Nova AI",
      version: APP_VERSION,
      timestamp: new Date().toISOString()
    }, {
      "Set-Cookie": buildEnterpriseAdminSessionClearCookie()
    });
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/admin-review-history") {
    try {
      const payload = await readJsonBody(request);
      const includeEvents = readBooleanEnvFlag(payload.includeEvents);
      const redactPatientIds = payload.redactPatientIds !== false;
      const redactRequestIds = payload.redactRequestIds !== false;
      const eventLimit = parsePositiveQueryInteger(payload.eventLimit, 10, 1, 50);
      const runtime = getRuntimeSnapshot();
      const ai = getLocalAiRuntimeStatus();
      const externalKnowledge = getExternalKnowledgeStatus();
      const enterpriseRuntime = getEnterpriseRuntimeSummary({ ai, runtime, externalKnowledge });
      const deploymentReadiness = getDeploymentReadiness(runtime);
      const configReadiness = getEnterpriseConfigReadiness(process.env, runtime);
      const governance = getGovernanceReadiness(runtime);
      const identity = resolveEnterpriseAdminIdentity({ headers: request.headers });

      const [adminPolicy, runtimeMetrics, storageIntegrity, audit] = await Promise.all([
        getAdminPolicySnapshot(),
        Promise.resolve(getEnterpriseRuntimeMetricsSnapshot(process.env)),
        getStorageIntegrityReport(process.env),
        loadEnterpriseAuditLog(process.env, { limit: eventLimit })
      ]);

      const reviewPacket = buildEnterpriseReviewPacket({
        app: "Care Nova AI",
        version: APP_VERSION,
        runtime,
        ai,
        externalKnowledge,
        enterpriseRuntime,
        adminPolicy,
        deploymentReadiness,
        configReadiness,
        governance,
        storageIntegrity,
        runtimeMetrics,
        audit,
        includeEvents,
        redactPatientIds,
        redactRequestIds
      });

      const historySave = await appendEnterpriseReviewHistoryEntry({
        actorId: identity.actorId || "enterprise-admin",
        role: identity.role || "admin",
        title: payload.title || "Enterprise review snapshot",
        decision: payload.decision || "reviewed",
        notes: payload.notes || "",
        packetFingerprint: reviewPacket.packet?.identity?.fingerprints?.combined || "",
        packetSummary: {
          readinessStatus: reviewPacket.summary?.readinessStatus || "",
          primaryDecision: reviewPacket.packet?.executiveSummary?.primaryDecision || "",
          runtimeTier: reviewPacket.summary?.runtimeTier || "",
          publicShareReady: reviewPacket.summary?.publicShareReady === true,
          reviewPointCount: Number(reviewPacket.summary?.reviewPointCount || 0),
          recommendedActionCount: Array.isArray(reviewPacket.packet?.actions?.recommendedActions)
            ? reviewPacket.packet.actions.recommendedActions.length
            : 0
        },
        reviewPacket
      }, process.env);

      const mirror = await syncDataMirrorSafely("admin-review-history-save", [
        mirrorDataFiles.reviewHistory,
        mirrorDataFiles.audit
      ]);

      await recordOperationalAuditEvent({
        category: "admin",
        action: "admin_review_history_saved",
        status: "success",
        route: "/api/admin-review-history",
        requestId: response.__careNovaRequestContext?.id,
        actor: identity.actorId || "enterprise-admin",
        summary: "Enterprise review snapshot saved.",
        detail: `Saved ${historySave.entry?.decision || "reviewed"} snapshot with fingerprint ${historySave.entry?.packetFingerprint || "n/a"}.`,
        metadata: {
          role: identity.role || "admin",
          decision: historySave.entry?.decision || "",
          packetFingerprint: historySave.entry?.packetFingerprint || "",
          reviewHistoryEntries: Number(historySave.summary?.entryCount || 0)
        }
      });

      sendJson(response, 200, {
        ok: true,
        status: "admin-review-history-saved",
        reviewHistory: historySave,
        mirror: {
          status: mirror.status || "mirror-unknown",
          enabled: mirror.enabled !== false,
          fileCount: Number.isFinite(mirror.fileCount) ? mirror.fileCount : 0,
          copiedCount: Number.isFinite(mirror.copiedCount) ? mirror.copiedCount : 0,
          syncedAt: mirror.syncedAt || "",
          mirrorRoot: mirror.mirrorRoot || "",
          manifest: mirror.manifest || ""
        },
        app: "Care Nova AI",
        version: APP_VERSION,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      sendJson(response, error.statusCode || 500, {
        ok: false,
        code: error.code || "ADMIN_REVIEW_HISTORY_SAVE_ERROR",
        message: error.message || "Unable to save the enterprise review snapshot."
      });
    }
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/external-knowledge") {
    sendJson(response, 200, {
      ok: true,
      app: "Care Nova AI",
      version: APP_VERSION,
      externalKnowledge: getExternalKnowledgeStatus(),
      timestamp: new Date().toISOString()
    });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/trusted-sources") {
    const queryPayload = {
      message: requestUrl.searchParams.get("q") || "",
      tab: requestUrl.searchParams.get("tab") || ""
    };

    sendJson(response, 200, {
      ok: true,
      app: "Care Nova AI",
      version: APP_VERSION,
      trustedSources: getTrustedSourceCatalog(),
      plan: buildTrustedSourcePlan(queryPayload),
      timestamp: new Date().toISOString()
    });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/medicine/lookup") {
    try {
      const lookup = await lookupMedicineEvidence({
        query: requestUrl.searchParams.get("q") || requestUrl.searchParams.get("name") || "",
        forceOnline: requestUrl.searchParams.get("refresh") === "true"
      });
      const mirror = lookup.fetchedOnline
        ? await syncDataMirrorSafely("medicine-lookup-cache", [mirrorDataFiles.medicineLookup])
        : null;

      sendJson(response, lookup.ok ? 200 : 400, {
        ok: lookup.ok,
        app: "Care Nova AI",
        version: APP_VERSION,
        lookup,
        mirror: mirror ? buildCompactMirrorResponse(mirror) : null,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      sendJson(response, error.statusCode || 500, {
        ok: false,
        code: error.code || "MEDICINE_LOOKUP_ERROR",
        message: error.message || "Unable to check medicine evidence."
      });
    }
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/trusted-sources/plan") {
    try {
      const payload = await readJsonBody(request);

      sendJson(response, 200, {
        ok: true,
        app: "Care Nova AI",
        version: APP_VERSION,
        plan: buildTrustedSourcePlan(payload),
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      sendJson(response, error.statusCode || 500, {
        ok: false,
        code: error.code || "TRUSTED_SOURCE_PLAN_ERROR",
        message: error.message || "Unable to build trusted source plan."
      });
    }
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/model-quality") {
    sendJson(response, 200, {
      ok: true,
      app: "Care Nova AI",
      version: APP_VERSION,
      quality: getModelQualityFramework(getRuntimeSnapshot()),
      timestamp: new Date().toISOString()
    });
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/model-quality/evaluate") {
    try {
      const payload = await readJsonBody(request);

      sendJson(response, 200, {
        ok: true,
        app: "Care Nova AI",
        version: APP_VERSION,
        evaluation: evaluateModelQuality(payload.result || {}, payload, getRuntimeSnapshot()),
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      sendJson(response, error.statusCode || 500, {
        ok: false,
        code: error.code || "MODEL_QUALITY_EVALUATION_ERROR",
        message: error.message || "Unable to evaluate model quality."
      });
    }
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/governance") {
    sendJson(response, 200, {
      ok: true,
      app: "Care Nova AI",
      version: APP_VERSION,
      governance: getGovernanceReadiness(getRuntimeSnapshot()),
      timestamp: new Date().toISOString()
    });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/offline-packs") {
    sendJson(response, 200, {
      ok: true,
      app: "Care Nova AI",
      version: APP_VERSION,
      offlinePacks: getOfflinePackCatalog(),
      timestamp: new Date().toISOString()
    });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/fhir") {
    sendJson(response, 200, {
      ok: true,
      app: "Care Nova AI",
      version: APP_VERSION,
      fhir: getFhirIntegrationGuide(),
      timestamp: new Date().toISOString()
    });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/report-templates") {
    sendJson(response, 200, {
      ok: true,
      app: "Care Nova AI",
      version: APP_VERSION,
      reports: getReportTemplateCatalog(),
      timestamp: new Date().toISOString()
    });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/advanced-capabilities") {
    sendJson(response, 200, {
      ...getAdvancedCapabilityCatalog(getRuntimeSnapshot()),
      app: "Care Nova AI",
      version: APP_VERSION
    });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/evaluation-dashboard") {
    sendJson(response, 200, {
      ...getEvaluationDashboard(getRuntimeSnapshot()),
      app: "Care Nova AI",
      version: APP_VERSION
    });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/offline-pack-manager") {
    sendJson(response, 200, {
      ...getOfflinePackManager(),
      app: "Care Nova AI",
      version: APP_VERSION
    });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/fhir-connector") {
    sendJson(response, 200, {
      ...getFhirConnectorStatus(),
      app: "Care Nova AI",
      version: APP_VERSION
    });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/admin-trust-center") {
    sendJson(response, 200, {
      ...getAdminTrustCenter(getRuntimeSnapshot()),
      app: "Care Nova AI",
      version: APP_VERSION
    });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/backup-plan") {
    sendJson(response, 200, {
      ...getSecureBackupPlan(),
      app: "Care Nova AI",
      version: APP_VERSION
    });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/local-data-mirror") {
    sendJson(response, 200, {
      ok: true,
      app: "Care Nova AI",
      version: APP_VERSION,
      mirror: await getLocalDataMirrorStatus(),
      timestamp: new Date().toISOString()
    });
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/local-data-mirror") {
    try {
      const payload = await readJsonBody(request);
      const mirror = await syncLocalDataMirror(payload.reason || "manual-api-sync");
      await recordOperationalAuditEvent({
        category: "storage",
        action: "local_data_mirror_sync",
        status: "success",
        route: "/api/local-data-mirror",
        requestId: response.__careNovaRequestContext?.id,
        summary: "Local data mirror sync completed.",
        detail: `Mirror synced ${Number(mirror.fileCount || 0)} file(s).`,
        metadata: {
          reason: payload.reason || "manual-api-sync",
          fileCount: Number(mirror.fileCount || 0),
          copiedCount: Number(mirror.copiedCount || 0)
        }
      });

      sendJson(response, 200, {
        ok: true,
        app: "Care Nova AI",
        version: APP_VERSION,
        mirror,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      sendJson(response, error.statusCode || 500, {
        ok: false,
        code: error.code || "LOCAL_DATA_MIRROR_ERROR",
        message: error.message || "Unable to sync local OneDrive mirror."
      });
    }
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/knowledge-graph") {
    const patientId = requestUrl.searchParams.get("patientId") || "demo-patient";

    if (!(await enforceEnterprisePatientAccess(request, response, requestContext, requestUrl, patientId))) {
      return;
    }

    const graph = await loadPatientKnowledgeGraph(patientId);

    sendJson(response, 200, {
      ok: true,
      app: "Care Nova AI",
      version: APP_VERSION,
      graph,
      timestamp: new Date().toISOString()
    });
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/evidence-citations") {
    try {
      const payload = await readJsonBody(request);

      sendJson(response, 200, {
        ok: true,
        app: "Care Nova AI",
        version: APP_VERSION,
        evidence: buildEvidenceCitationPacket({ payload, result: payload.result || {} }),
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      sendJson(response, error.statusCode || 500, {
        ok: false,
        code: error.code || "EVIDENCE_CITATION_ERROR",
        message: error.message || "Unable to build evidence citations."
      });
    }
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/safety-triage") {
    try {
      const payload = await readJsonBody(request);

      sendJson(response, 200, {
        ok: true,
        app: "Care Nova AI",
        version: APP_VERSION,
        triage: runClinicalSafetyTriage({ payload, result: payload.result || {} }),
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      sendJson(response, error.statusCode || 500, {
        ok: false,
        code: error.code || "SAFETY_TRIAGE_ERROR",
        message: error.message || "Unable to run safety triage."
      });
    }
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/multimodal-intake") {
    try {
      const payload = await readJsonBody(request);

      sendJson(response, 200, {
        ok: true,
        app: "Care Nova AI",
        version: APP_VERSION,
        intake: analyzeMultimodalIntake(payload),
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      sendJson(response, error.statusCode || 500, {
        ok: false,
        code: error.code || "MULTIMODAL_INTAKE_ERROR",
        message: error.message || "Unable to review document intake."
      });
    }
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/prevention-plan") {
    try {
      const payload = await readJsonBody(request);
      const graph = payload.graph || await loadPatientKnowledgeGraph(payload.patientId || "demo-patient");

      sendJson(response, 200, {
        ok: true,
        app: "Care Nova AI",
        version: APP_VERSION,
        preventionPlan: buildPersonalizedPreventionPlan({ payload, result: payload.result || {}, graph }),
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      sendJson(response, error.statusCode || 500, {
        ok: false,
        code: error.code || "PREVENTION_PLAN_ERROR",
        message: error.message || "Unable to build prevention plan."
      });
    }
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/human-review") {
    try {
      const payload = await readJsonBody(request);
      const graph = payload.graph || await loadPatientKnowledgeGraph(payload.patientId || "demo-patient");

      sendJson(response, 200, {
        ok: true,
        app: "Care Nova AI",
        version: APP_VERSION,
        review: buildHumanReviewPacket({ payload, result: payload.result || {}, graph }),
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      sendJson(response, error.statusCode || 500, {
        ok: false,
        code: error.code || "HUMAN_REVIEW_ERROR",
        message: error.message || "Unable to build human review packet."
      });
    }
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/doctor-ready-report") {
    try {
      const payload = await readJsonBody(request);
      const graph = payload.graph || await loadPatientKnowledgeGraph(payload.patientId || "demo-patient");

      sendJson(response, 200, {
        ok: true,
        app: "Care Nova AI",
        version: APP_VERSION,
        report: buildDoctorReadyReport({ payload, result: payload.result || {}, graph }),
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      sendJson(response, error.statusCode || 500, {
        ok: false,
        code: error.code || "DOCTOR_READY_REPORT_ERROR",
        message: error.message || "Unable to build doctor-ready report."
      });
    }
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/memory") {
    const patientId = requestUrl.searchParams.get("patientId") || "demo-patient";

    if (!(await enforceEnterprisePatientAccess(request, response, requestContext, requestUrl, patientId))) {
      return;
    }

    const memory = await loadPatientMemory(patientId);

    sendJson(response, 200, {
      ok: true,
      memory: buildPublicMemory(memory),
      timestamp: new Date().toISOString()
    });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/browser-state") {
    const patientId = requestUrl.searchParams.get("patientId") || "demo-patient";

    if (!(await enforceEnterprisePatientAccess(request, response, requestContext, requestUrl, patientId))) {
      return;
    }

    const browserState = await loadBrowserStateSnapshot(patientId);

    sendJson(response, 200, {
      ok: true,
      browserState,
      timestamp: new Date().toISOString()
    });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/records") {
    const patientId = requestUrl.searchParams.get("patientId") || "demo-patient";

    if (!(await enforceEnterprisePatientAccess(request, response, requestContext, requestUrl, patientId))) {
      return;
    }

    const records = await loadPatientDataRecords(patientId);

    sendJson(response, 200, {
      ok: true,
      records,
      timestamp: new Date().toISOString()
    });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/training-readiness") {
    sendJson(response, 200, getTrainingReadiness());
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/training") {
    const state = await loadTrainingState();
    const runtime = getRuntimeSnapshot();

    sendJson(response, 200, {
      ok: true,
      app: "Care Nova AI",
      version: APP_VERSION,
      training: toPublicTrainingState(state),
      calibration: await getTrainingCalibration(),
      machineLearning: getMachineLearningCapabilityStatus(runtime),
      timestamp: new Date().toISOString()
    });
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/training/example") {
    try {
      const payload = await readJsonBody(request);
      const training = await recordTrainingExample(payload);
      await recordOperationalAuditEvent({
        category: "training",
        action: "training_example_recorded",
        status: "success",
        route: "/api/training/example",
        requestId: response.__careNovaRequestContext?.id,
        patientId: payload.patientId || "",
        summary: "Training example recorded.",
        detail: `Stored feedback example for route calibration with status ${training?.example?.status || training?.status || "saved"}.`,
        metadata: {
          reviewStatus: training?.example?.status || "",
          route: payload.route || payload.routeHint || ""
        }
      });
      const mirror = await syncDataMirrorSafely("training-example-save", [mirrorDataFiles.training]);

      sendJson(response, 200, {
        ...training,
        app: "Care Nova AI",
        version: APP_VERSION,
        mirror: buildCompactMirrorResponse(mirror),
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      sendJson(response, error.statusCode || 500, {
        ok: false,
        code: error.code || "TRAINING_EXAMPLE_ERROR",
        message: error.message || "Unable to save training feedback."
      });
    }
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/training/train") {
    try {
      const payload = await readJsonBody(request);
      const training = await trainLocalAgentCalibrator(payload);
      await recordOperationalAuditEvent({
        category: "training",
        action: "training_calibrator_run",
        status: "success",
        route: "/api/training/train",
        requestId: response.__careNovaRequestContext?.id,
        summary: "Local training calibrator run completed.",
        detail: `Training finished with status ${training?.training?.status || training?.status || "completed"}.`,
        metadata: {
          approvedExamples: Number(training?.training?.approvedExamples || 0),
          routeCount: Number(training?.training?.routeCount || 0)
        }
      });
      const mirror = await syncDataMirrorSafely("training-run-save", [mirrorDataFiles.training]);

      sendJson(response, 200, {
        ...training,
        app: "Care Nova AI",
        version: APP_VERSION,
        mirror: buildCompactMirrorResponse(mirror),
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      sendJson(response, error.statusCode || 500, {
        ok: false,
        code: error.code || "TRAINING_RUN_ERROR",
        message: error.message || "Unable to train the local agent calibrator."
      });
    }
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/training/evaluate") {
    try {
      const payload = await readJsonBody(request);
      const evaluation = await evaluateTrainingCalibration(payload);
      await recordOperationalAuditEvent({
        category: "training",
        action: "training_calibrator_evaluate",
        status: "success",
        route: "/api/training/evaluate",
        requestId: response.__careNovaRequestContext?.id,
        patientId: payload.patientId || "",
        summary: "Training calibration preview completed.",
        detail: `Training evaluation returned status ${evaluation?.status || "complete"}.`,
        metadata: {
          selectedRoute: evaluation?.decision?.selectedRoute || evaluation?.selectedRoute || ""
        }
      });

      sendJson(response, 200, {
        ok: true,
        app: "Care Nova AI",
        version: APP_VERSION,
        evaluation,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      sendJson(response, error.statusCode || 500, {
        ok: false,
        code: error.code || "TRAINING_EVALUATION_ERROR",
        message: error.message || "Unable to evaluate the local training calibration."
      });
    }
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/analyze") {
    try {
      const analyzeStageTracker = createExecutionStageTracker(requestContext);
      const rawPayload = await readJsonBody(request);
      analyzeStageTracker.mark("read_request_body", "Accepted JSON request body.");
      const { payload, policy: enterprisePolicy, contract: requestContract } = prepareAnalyzeExecutionRequest(rawPayload, requestUrl.pathname);
      analyzeStageTracker.mark("validate_request_contract", requestContract.status);
      const patientId = String(payload.patientId || "demo-patient");

      if (!(await enforceEnterprisePatientAccess(request, response, requestContext, requestUrl, patientId))) {
        return;
      }

      const scopedExecutionEnv = buildScopedExecutionEnv(process.env, enterprisePolicy);
      const promptOnlyIsolation = isPromptOnlyAnalyzeIsolation(payload);
      const runtime = getRuntimeSnapshot();
      const promptOnlyMemoryState = {
        patientId,
        profile: {},
        history: [],
        recentTurnCount: 0
      };
      const [memoryBefore, patientRecords, externalKnowledge, trainingCalibration, patientKnowledgeGraph] = await Promise.all([
        promptOnlyIsolation ? Promise.resolve(promptOnlyMemoryState) : loadPatientMemory(patientId),
        promptOnlyIsolation ? Promise.resolve(payload.patientRecords || payload.records || null) : loadPatientDataRecords(patientId),
        loadExternalKnowledgeForAnalyze(payload, scopedExecutionEnv),
        getTrainingCalibration(),
        promptOnlyIsolation ? Promise.resolve(payload.patientKnowledgeGraph || payload.knowledgeGraph || {}) : loadPatientKnowledgeGraph(patientId)
      ]);
      analyzeStageTracker.mark("load_local_context", "Loaded memory, records, graph, training, and external knowledge context.");
      const agenticRuntimePolicy = getAdaptiveRuntimePolicy({ externalKnowledge, runtime });
      const result = await analyzeHealthQuery({
        ...payload,
        profile: promptOnlyIsolation ? (payload.profile || {}) : mergeRequestProfile(memoryBefore.profile, payload.profile),
        patientRecords,
        patientKnowledgeGraph,
        trainingCalibration,
        externalKnowledge,
        conversationHistory: promptOnlyIsolation
          ? (payload.conversationHistory || payload.history || [])
          : buildAnalyzeConversationHistory(payload, memoryBefore.history)
      });
      analyzeStageTracker.mark("core_analysis", "Completed core agent routing and local response generation.");
      if (promptOnlyIsolation && Array.isArray(result.auditTrail)) {
        result.auditTrail.push({
          step: "prompt_only_analysis_isolation",
          status: "complete",
          detail: "Prompt-only analysis skipped persisted memory, records, and graph hydration for this run.",
          timestamp: new Date().toISOString()
        });
      }
      const localReasoningAssist = await tryEnhanceAnalyzeResultWithLocalReasoning({ payload, result, env: scopedExecutionEnv });
      analyzeStageTracker.mark("local_reasoning_assist", localReasoningAssist.applied ? "Applied route-aware local reasoning assist." : "Skipped or retained deterministic local answer.");

      result.localReasoningAssist = localReasoningAssist;
      result.model.localReasoningAssist = {
        enabled: localReasoningAssist.enabled,
        configured: localReasoningAssist.configured,
        attempted: localReasoningAssist.attempted,
        applied: localReasoningAssist.applied,
        provider: localReasoningAssist.provider,
        model: localReasoningAssist.model,
        endpointHost: localReasoningAssist.endpointHost,
        participants: localReasoningAssist.participants || [],
        fallbackUsed: localReasoningAssist.fallbackUsed,
        error: localReasoningAssist.error
      };

      if (Array.isArray(result.auditTrail)) {
        result.auditTrail.push({
          step: "open_source_local_reasoning_assist",
          status: "complete",
          detail: localReasoningAssist.applied
            ? "Open-source local reasoning assist strengthened the grounded local answer using evidence, memory, and agent output."
            : localReasoningAssist.attempted
              ? `Open-source local reasoning assist failed or was rejected, so the deterministic local answer stayed active. ${localReasoningAssist.error || ""}`.trim()
              : localReasoningAssist.enabled
                ? "Open-source local reasoning assist is enabled but missing configuration, so the deterministic local answer stayed active."
                : "Open-source local reasoning assist is disabled, so the deterministic local answer stayed active.",
          timestamp: new Date().toISOString()
        });
      }

      const temporaryCloudLlm = await tryEnhanceAnalyzeResultWithCloudLlm({ payload, result, env: scopedExecutionEnv });
      analyzeStageTracker.mark("cloud_second_pass", temporaryCloudLlm.applied ? "Applied cloud second pass." : "Skipped or kept local final response.");

      result.temporaryCloudLlm = temporaryCloudLlm;
      result.model.temporaryCloudLlm = {
        enabled: temporaryCloudLlm.enabled,
        configured: temporaryCloudLlm.configured,
        requestedForThisRun: temporaryCloudLlm.requestedForThisRun,
        plannedByRouter: temporaryCloudLlm.plannedByRouter,
        engagementMode: temporaryCloudLlm.engagementMode,
        attempted: temporaryCloudLlm.attempted,
        applied: temporaryCloudLlm.applied,
        provider: temporaryCloudLlm.provider,
        model: temporaryCloudLlm.model,
        endpointHost: temporaryCloudLlm.endpointHost,
        actualProcessingType: temporaryCloudLlm.actualProcessingType,
        fallbackUsed: temporaryCloudLlm.fallbackUsed,
        skipReason: temporaryCloudLlm.skipReason,
        error: temporaryCloudLlm.error
      };

      if (Array.isArray(result.auditTrail)) {
        result.auditTrail.push({
          step: "temporary_cloud_llm",
          status: "complete",
          detail: temporaryCloudLlm.applied
            ? temporaryCloudLlm.engagementMode === "route-aware-clinical-second-pass"
              ? `Route-aware OpenAI cloud second pass applied through ${temporaryCloudLlm.provider} (${temporaryCloudLlm.model}) after local specialist synthesis and before the final guarded reply.`
              : `Temporary cloud rewrite applied through ${temporaryCloudLlm.provider} (${temporaryCloudLlm.model}) after local safety output generation.`
            : temporaryCloudLlm.attempted
              ? temporaryCloudLlm.engagementMode === "route-aware-clinical-second-pass"
                ? `Route-aware OpenAI cloud second pass failed or was rejected, so the local response stayed active. ${temporaryCloudLlm.error || ""}`.trim()
                : `Temporary cloud rewrite failed or was rejected, so the default local response stayed active. ${temporaryCloudLlm.error || ""}`.trim()
              : temporaryCloudLlm.requestedForThisRun === false && temporaryCloudLlm.skipReason
                ? temporaryCloudLlm.skipReason
                : temporaryCloudLlm.enabled
                  ? "Temporary cloud path is enabled but missing configuration, so the default local response stayed active."
                  : "Temporary cloud rewrite is disabled, so the default local response stayed active.",
          timestamp: new Date().toISOString()
        });
      }

      const qualityEvaluation = evaluateModelQuality(result, payload, runtime);
      result.trustedSourcePlan = qualityEvaluation.trustedSourcePlan;
      result.qualityEvaluation = qualityEvaluation;

      const safetyTriage = runClinicalSafetyTriage({ payload, result });
      const evidenceCitations = buildEvidenceCitationPacket({ payload, result });
      const multimodalIntake = analyzeMultimodalIntake(payload);
      analyzeStageTracker.mark("quality_and_evidence", "Scored quality and assembled evidence, safety, and intake packets.");

      result.safetyTriage = safetyTriage;
      result.evidenceCitations = evidenceCitations;
      result.multimodalIntake = multimodalIntake;

      const knowledgeGraph = promptOnlyIsolation
        ? (patientKnowledgeGraph && typeof patientKnowledgeGraph === "object" ? patientKnowledgeGraph : {})
        : await upsertPatientKnowledgeGraph({
          patientId,
          payload,
          result,
          records: Array.isArray(patientRecords?.records) ? patientRecords.records : []
        });
      const preventionPlan = buildPersonalizedPreventionPlan({ payload, result, graph: knowledgeGraph });
      const humanReview = buildHumanReviewPacket({ payload, result, graph: knowledgeGraph });
      const doctorReadyReport = buildDoctorReadyReport({ payload, result, graph: knowledgeGraph });
      analyzeStageTracker.mark("graph_and_review_packets", "Built graph updates plus prevention, review, and doctor-ready packets.");

      result.preventionPlan = preventionPlan;
      result.humanReview = humanReview;
      result.doctorReadyReport = doctorReadyReport;

      const analyzeMirrorFiles = buildAnalyzeMirrorFiles(patientId);
      let memoryAfter = {};
      let localDataMirrorPromise;

      if (promptOnlyIsolation) {
        localDataMirrorPromise = Promise.resolve({
          status: "mirror-sync-skipped",
          reason: "prompt-only-analysis",
          syncedAt: new Date().toISOString(),
          mode: "prompt-only-analysis",
          enabled: false,
          fileCount: 0,
          copiedCount: 0,
          skippedFiles: analyzeMirrorFiles
        });
        result.memoryContext = {
          ...result.memoryContext,
          persistence: "prompt-only-analysis",
          storage: "",
          savedTurns: Number(memoryBefore.recentTurnCount || 0)
        };
        result.memory = {
          ok: true,
          saved: false,
          patientId,
          file: "",
          recentTurnCount: Number(memoryBefore.recentTurnCount || 0),
          mode: "prompt-only-analysis"
        };
      } else {
        memoryAfter = await appendPatientMemory({ patientId, payload, result });
        localDataMirrorPromise = syncDataMirrorSafely("analyze-memory-graph-sync", analyzeMirrorFiles);
        result.memoryContext = {
          ...result.memoryContext,
          persistence: "persistent-local-server",
          storage: memoryAfter.file,
          savedTurns: memoryAfter.recentTurnCount
        };
        result.memory = {
          ok: true,
          saved: true,
          ...memoryAfter
        };
      }
      result.governanceSnapshot = getGovernanceReadiness(runtime).summary;
      result.agenticRuntime = buildAdaptiveExecutionTrace({
        policy: agenticRuntimePolicy,
        payload,
        result,
        externalKnowledge,
        memoryBefore,
        memoryAfter,
        qualityEvaluation
      });
      result.model.adaptiveRuntime = {
        id: result.agenticRuntime.id,
        systemState: result.agenticRuntime.systemState,
        activeMode: result.agenticRuntime.activeMode,
        fallbackApplied: result.agenticRuntime.decision.fallbackApplied,
        latestDataUsed: result.agenticRuntime.latestDataUsed
      };
      result.recommendedReportTemplates = getReportTemplateCatalog().templates
        .filter((template) => (template.tabs || []).some((tab) => tab.toLowerCase() === String(payload.tab || "").toLowerCase()))
        .slice(0, 2);
      result.knowledgeGraph = knowledgeGraph;
      result.safetyTriage = safetyTriage;
      result.evidenceCitations = evidenceCitations;
      result.preventionPlan = preventionPlan;
      result.humanReview = humanReview;
      result.multimodalIntake = multimodalIntake;
      result.doctorReadyReport = doctorReadyReport;
      result.advancedCapabilities = buildAdvancedCapabilitySnapshot({
        payload,
        result,
        graph: knowledgeGraph,
        runtime,
        precomputed: {
          evidence: evidenceCitations,
          safetyTriage,
          humanReview,
          preventionPlan,
          multimodalIntake
        }
      });
      result.machineLearning = getMachineLearningCapabilityStatus(runtime).summary;
      analyzeStageTracker.mark("persistence_and_runtime", "Prepared persistence, governance, and adaptive runtime trace.");
      result.localDataMirror = buildAnalyzeMirrorSummary(await localDataMirrorPromise, analyzeMirrorFiles);
      analyzeStageTracker.mark("mirror_sync", "Completed local data mirror sync.");
      result.enterpriseExecution = buildEnterpriseExecutionSummary({
        requestContext,
        endpoint: requestUrl.pathname,
        policy: enterprisePolicy,
        contract: requestContract,
        timings: analyzeStageTracker.snapshot()
      });
      if (result.model && typeof result.model === "object" && !Array.isArray(result.model)) {
        result.model.enterpriseExecution = {
          appliedMode: result.enterpriseExecution.policy.appliedMode,
          networkAccess: result.enterpriseExecution.policy.networkAccess,
          localPersistence: result.enterpriseExecution.policy.localPersistence,
          totalDurationMs: result.enterpriseExecution.timings.totalDurationMs,
          stageCount: result.enterpriseExecution.timings.stages.length
        };
      }
      if (Array.isArray(result.auditTrail)) {
        result.auditTrail.push({
          step: "enterprise_request_contract",
          status: "complete",
          detail: buildEnterpriseExecutionAuditSummary({ policy: enterprisePolicy, contract: requestContract }),
          timestamp: new Date().toISOString()
        });
      }
      await recordOperationalAuditEvent({
        category: "analysis",
        action: "analyze",
        status: "success",
        route: requestUrl.pathname,
        requestId: requestContext.id,
        patientId,
        summary: "Analyze request completed.",
        detail: buildEnterpriseExecutionAuditSummary({ policy: enterprisePolicy, contract: requestContract }),
        metadata: {
          interfaceName: normalizeInterfaceName(payload.interfaceName),
          processingPolicy: result.enterpriseExecution.policy.appliedMode,
          networkAccess: result.enterpriseExecution.policy.networkAccess,
          promptOnlyIsolation: result.enterpriseExecution.policy.promptOnlyIsolation,
          totalDurationMs: result.enterpriseExecution.timings.totalDurationMs,
          qualityScore: Number(result.qualityEvaluation?.score || 0),
          riskLevel: result.risk?.level || "",
          responseRoute: result.plan?.responseOwner?.route || ""
        }
      });
      sendJson(response, 200, buildPublicAnalyzeResult(result), {
        "X-Care-Nova-Processing-Policy": result.enterpriseExecution.policy.appliedMode,
        "X-Care-Nova-Network-Mode": result.enterpriseExecution.policy.networkAccess
      });
    } catch (error) {
      await recordOperationalAuditEvent({
        category: "analysis",
        action: "analyze",
        status: "error",
        route: requestUrl.pathname,
        requestId: requestContext.id,
        summary: "Analyze request failed.",
        detail: error.message || "Unable to analyze the request."
      });
      sendJson(response, error.statusCode || 500, {
        ok: false,
        code: error.code || "ANALYSIS_ERROR",
        message: error.message || "Unable to analyze the request."
      });
    }
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/external-knowledge/clear") {
    try {
      const externalKnowledge = await clearExternalKnowledgeCache();
      await recordOperationalAuditEvent({
        category: "storage",
        action: "external_knowledge_cache_clear",
        status: "success",
        route: "/api/external-knowledge/clear",
        requestId: response.__careNovaRequestContext?.id,
        summary: "External knowledge cache cleared.",
        detail: "Cleared the local external-knowledge cache.",
        metadata: {
          cacheMode: externalKnowledge?.mode || ""
        }
      });
      const mirror = await syncDataMirrorSafely("external-knowledge-clear", [mirrorDataFiles.externalKnowledge]);

      sendJson(response, 200, {
        ok: true,
        externalKnowledge,
        mirror: buildCompactMirrorResponse(mirror),
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      sendJson(response, error.statusCode || 500, {
        ok: false,
        code: error.code || "EXTERNAL_KNOWLEDGE_CLEAR_ERROR",
        message: error.message || "Unable to clear the external knowledge cache."
      });
    }
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/browser-state-sync") {
    try {
      const payload = await readJsonBody(request);
      const patientId = payload.patientId || "demo-patient";

      if (!(await enforceEnterprisePatientAccess(request, response, requestContext, requestUrl, patientId))) {
        return;
      }

      const memory = await mergeImportedPatientMemory({
        patientId,
        profile: payload.profile || {},
        history: Array.isArray(payload.history) ? payload.history : []
      });
      const browserState = await saveBrowserStateSnapshot({
        patientId,
        snapshot: payload.snapshot && typeof payload.snapshot === "object" ? payload.snapshot : {},
        metadata: {
          ...(payload.metadata && typeof payload.metadata === "object" ? payload.metadata : {}),
          source: "browser-local-storage",
          requestId: response.__careNovaRequestContext?.id || ""
        }
      });
      await recordOperationalAuditEvent({
        category: "storage",
        action: "browser_state_sync",
        status: "success",
        route: "/api/browser-state-sync",
        requestId: response.__careNovaRequestContext?.id,
        patientId,
        summary: "Browser-local recovery state merged into localhost storage.",
        detail: `Merged ${Number(memory?.recentTurnCount || 0)} memory turn(s) and saved the offline browser state snapshot.`,
        metadata: {
          historyCount: Number(Array.isArray(payload.history) ? payload.history.length : 0),
          snapshotSignature: browserState.summary?.signature || "",
          patientProfileCount: Number(browserState.summary?.patientProfileCount || 0)
        }
      });
      const mirror = await syncDataMirrorSafely("browser-state-sync", [
        mirrorDataFiles.memory,
        mirrorDataFiles.browserState
      ]);

      sendJson(response, 200, {
        ok: true,
        memory: buildPublicMemory(memory),
        browserState,
        mirror: buildCompactMirrorResponse(mirror),
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      sendJson(response, error.statusCode || 500, {
        ok: false,
        code: error.code || "BROWSER_STATE_SYNC_ERROR",
        message: error.message || "Unable to sync browser recovery state."
      });
    }
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/memory/clear") {
    try {
      const payload = await readJsonBody(request);
      const memory = await clearPatientMemory(payload.patientId || "demo-patient");
      await recordOperationalAuditEvent({
        category: "storage",
        action: "memory_clear",
        status: "success",
        route: "/api/memory/clear",
        requestId: response.__careNovaRequestContext?.id,
        patientId: payload.patientId || "demo-patient",
        summary: "Patient memory cleared.",
        detail: "Cleared the persistent local patient memory store."
      });
      const mirror = await syncDataMirrorSafely("memory-clear", [mirrorDataFiles.memory]);

      sendJson(response, 200, {
        ok: true,
        memory: buildPublicMemory(memory),
        mirror: buildCompactMirrorResponse(mirror),
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      sendJson(response, error.statusCode || 500, {
        ok: false,
        code: error.code || "MEMORY_CLEAR_ERROR",
        message: error.message || "Unable to clear patient memory."
      });
    }
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/records") {
    try {
      const payload = await readJsonBody(request);
      const records = await savePatientDataRecords({
        patientId: payload.patientId || "demo-patient",
        records: Array.isArray(payload.records) ? payload.records : [],
        selectedRecordId: payload.selectedRecordId || ""
      });
      await recordOperationalAuditEvent({
        category: "storage",
        action: "records_save",
        status: "success",
        route: "/api/records",
        requestId: response.__careNovaRequestContext?.id,
        patientId: payload.patientId || "demo-patient",
        summary: "Patient records saved.",
        detail: `Saved ${Number(records?.records?.length || 0)} local patient record(s).`,
        metadata: {
          selectedRecordId: payload.selectedRecordId || ""
        }
      });
      const mirror = await syncDataMirrorSafely("records-save", [mirrorDataFiles.records]);

      sendJson(response, 200, {
        ok: true,
        records,
        mirror: buildCompactMirrorResponse(mirror),
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      sendJson(response, error.statusCode || 500, {
        ok: false,
        code: error.code || "RECORD_SAVE_ERROR",
        message: error.message || "Unable to save patient records."
      });
    }
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/records/clear") {
    try {
      const payload = await readJsonBody(request);
      const records = await clearPatientDataRecords(payload.patientId || "demo-patient");
      await recordOperationalAuditEvent({
        category: "storage",
        action: "records_clear",
        status: "success",
        route: "/api/records/clear",
        requestId: response.__careNovaRequestContext?.id,
        patientId: payload.patientId || "demo-patient",
        summary: "Patient records cleared.",
        detail: "Cleared the persistent local patient records."
      });
      const mirror = await syncDataMirrorSafely("records-clear", [mirrorDataFiles.records]);

      sendJson(response, 200, {
        ok: true,
        records,
        mirror: buildCompactMirrorResponse(mirror),
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      sendJson(response, error.statusCode || 500, {
        ok: false,
        code: error.code || "RECORD_CLEAR_ERROR",
        message: error.message || "Unable to clear patient records."
      });
    }
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/knowledge-graph/clear") {
    try {
      const payload = await readJsonBody(request);
      const graph = await clearPatientKnowledgeGraph(payload.patientId || "demo-patient");
      await recordOperationalAuditEvent({
        category: "storage",
        action: "knowledge_graph_clear",
        status: "success",
        route: "/api/knowledge-graph/clear",
        requestId: response.__careNovaRequestContext?.id,
        patientId: payload.patientId || "demo-patient",
        summary: "Patient knowledge graph cleared.",
        detail: "Cleared the persistent local structured knowledge graph."
      });
      const mirror = await syncDataMirrorSafely("knowledge-graph-clear", [buildPatientGraphMirrorFile(payload.patientId || "demo-patient")]);

      sendJson(response, 200, {
        ok: true,
        graph,
        mirror: buildCompactMirrorResponse(mirror),
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      sendJson(response, error.statusCode || 500, {
        ok: false,
        code: error.code || "KNOWLEDGE_GRAPH_CLEAR_ERROR",
        message: error.message || "Unable to clear the patient knowledge graph."
      });
    }
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/realtime") {
    try {
      const realtimeStageTracker = createExecutionStageTracker(requestContext);
      const rawPayload = await readJsonBody(request);
      realtimeStageTracker.mark("read_request_body", "Accepted JSON request body.");
      const { payload, policy: enterprisePolicy, contract: requestContract } = prepareAnalyzeExecutionRequest(rawPayload, requestUrl.pathname);
      realtimeStageTracker.mark("validate_request_contract", requestContract.status);
      const patientId = String(payload.patientId || "demo-patient");

      if (!(await enforceEnterprisePatientAccess(request, response, requestContext, requestUrl, patientId))) {
        return;
      }

      const promptOnlyIsolation = isPromptOnlyAnalyzeIsolation(payload);
      const promptOnlyMemoryState = {
        patientId,
        profile: {},
        history: [],
        recentTurnCount: 0
      };
      const [trainingCalibration, memoryBefore, patientRecords, patientKnowledgeGraph] = await Promise.all([
        getTrainingCalibration(),
        promptOnlyIsolation ? Promise.resolve(promptOnlyMemoryState) : loadPatientMemory(patientId),
        promptOnlyIsolation ? Promise.resolve(payload.patientRecords || payload.records || null) : loadPatientDataRecords(patientId),
        promptOnlyIsolation ? Promise.resolve(payload.patientKnowledgeGraph || payload.knowledgeGraph || {}) : loadPatientKnowledgeGraph(patientId)
      ]);
      realtimeStageTracker.mark("load_local_context", "Loaded memory, records, graph, and training context.");
      const result = analyzeRealtimeHealthQuery({
        ...payload,
        profile: promptOnlyIsolation ? (payload.profile || {}) : mergeRequestProfile(memoryBefore.profile, payload.profile),
        patientRecords,
        patientKnowledgeGraph,
        conversationHistory: promptOnlyIsolation
          ? (payload.conversationHistory || payload.history || [])
          : buildAnalyzeConversationHistory(payload, memoryBefore.history),
        trainingCalibration
      });
      realtimeStageTracker.mark("realtime_analysis", "Completed fast realtime triage path.");
      result.agenticRuntime = buildAdaptiveExecutionTrace({
        policy: getAdaptiveRuntimePolicy(),
        payload,
        result,
        externalKnowledge: getExternalKnowledgeStatus(),
        qualityEvaluation: {
          score: result.reasoningQuality?.score || 0,
          label: result.reasoningQuality?.label || "Realtime quality checked"
        }
      });
      realtimeStageTracker.mark("runtime_trace", "Built adaptive runtime trace.");
      result.enterpriseExecution = buildEnterpriseExecutionSummary({
        requestContext,
        endpoint: requestUrl.pathname,
        policy: enterprisePolicy,
        contract: requestContract,
        timings: realtimeStageTracker.snapshot()
      });
      if (result.model && typeof result.model === "object" && !Array.isArray(result.model)) {
        result.model.enterpriseExecution = {
          appliedMode: result.enterpriseExecution.policy.appliedMode,
          networkAccess: result.enterpriseExecution.policy.networkAccess,
          localPersistence: result.enterpriseExecution.policy.localPersistence,
          totalDurationMs: result.enterpriseExecution.timings.totalDurationMs,
          stageCount: result.enterpriseExecution.timings.stages.length
        };
      }
      await recordOperationalAuditEvent({
        category: "analysis",
        action: "realtime",
        status: "success",
        route: requestUrl.pathname,
        requestId: requestContext.id,
        patientId,
        summary: "Realtime analysis completed.",
        detail: buildEnterpriseExecutionAuditSummary({ policy: enterprisePolicy, contract: requestContract }),
        metadata: {
          interfaceName: normalizeInterfaceName(payload.interfaceName),
          processingPolicy: result.enterpriseExecution.policy.appliedMode,
          networkAccess: result.enterpriseExecution.policy.networkAccess,
          promptOnlyIsolation: result.enterpriseExecution.policy.promptOnlyIsolation,
          totalDurationMs: result.enterpriseExecution.timings.totalDurationMs,
          qualityScore: Number(result.reasoningQuality?.score || 0),
          riskLevel: result.risk?.level || "",
          responseRoute: result.plan?.responseOwner?.route || ""
        }
      });
      sendJson(response, 200, result, {
        "X-Care-Nova-Processing-Policy": result.enterpriseExecution.policy.appliedMode,
        "X-Care-Nova-Network-Mode": result.enterpriseExecution.policy.networkAccess
      });
    } catch (error) {
      await recordOperationalAuditEvent({
        category: "analysis",
        action: "realtime",
        status: "error",
        route: requestUrl.pathname,
        requestId: requestContext.id,
        summary: "Realtime analysis failed.",
        detail: error.message || "Unable to run real-time analysis."
      });
      sendJson(response, error.statusCode || 500, {
        ok: false,
        code: error.code || "REALTIME_ANALYSIS_ERROR",
        message: error.message || "Unable to run real-time analysis."
      });
    }
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    sendJson(response, 405, {
      ok: false,
      code: "METHOD_NOT_ALLOWED",
      message: "This endpoint only supports GET or POST where documented."
    });
    return;
  }

  await serveStatic(request, requestUrl, response);
}

export function createServerApp(options = {}) {
  const runtime = getRuntimeSnapshot();
  const startupReadiness = getEnterpriseStartupReadiness(process.env, runtime);
  const launchedDirectly = Boolean(process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url);
  const logStartupReadiness = options.logStartupReadiness ?? (
    launchedDirectly
  );

  if (startupReadiness.summary.shouldBlockStartup) {
    throw createEnterpriseStartupGuardError(startupReadiness);
  }

  const runtimeBootstrapStarted = launchedDirectly && startLocalRuntimeBootstrapIfEligible(process.env);
  startLocalRuntimeProbeLoop(process.env, runtimeBootstrapStarted ? { intervalMs: 5_000 } : {});

  if (runtimeBootstrapStarted) {
    setTimeout(() => {
      refreshLocalRuntimeProbe(process.env).catch(() => {});
    }, 1_500).unref();
    setTimeout(() => {
      refreshLocalRuntimeProbe(process.env).catch(() => {});
    }, 5_000).unref();
  }

  warmAnalyzeMedicalRetrieval();

  if (logStartupReadiness && startupReadiness.status !== "startup-ready") {
    console.warn(`Care Nova AI startup readiness: ${startupReadiness.status}`);
    for (const reviewPoint of startupReadiness.reviewPoints || []) {
      console.warn(`- ${reviewPoint}`);
    }
  }

  const server = createServer((request, response) => {
    handleRequest(request, response).catch((error) => {
      console.error(error);
      sendJson(response, 500, {
        ok: false,
        code: "SERVER_ERROR",
        message: "The demo server hit an unexpected error."
      });
    });
  });

  server.requestTimeout = 15_000;
  server.headersTimeout = 16_000;

  return server;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  let server;

  try {
    server = createServerApp();
  } catch (error) {
    console.error(`Care Nova AI failed to start: ${error.message}`);
    process.exit(1);
  }

  function shutdown(signal) {
    console.log(`Care Nova AI received ${signal}; closing server...`);
    serverOperationalState.trafficState = "draining";
    serverOperationalState.lastTransitionAt = new Date().toISOString();
    server.close(() => {
      console.log("Care Nova AI server closed.");
      process.exit(0);
    });

    setTimeout(() => {
      console.error("Care Nova AI forced shutdown after timeout.");
      process.exit(1);
    }, 5_000).unref();
  }

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));

  server.on("error", (error) => {
    console.error(`Care Nova AI failed to start: ${error.message}`);
    process.exit(1);
  });

  server.listen(port, host, () => {
    console.log(`Care Nova AI ${APP_VERSION} running at http://${host}:${port}`);
  });
}
