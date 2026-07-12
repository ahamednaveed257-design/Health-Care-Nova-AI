import { getConnectivityPolicy } from "./runtimeConnectivity.js";

export const AGENTIC_RUNTIME_VERSION = "1.0.0";

export function buildAdaptiveRuntimePolicy({
  localAi = {},
  externalKnowledge = {},
  memory = {},
  records = {},
  knowledgeGraph = {},
  runtime = {},
  env = process.env
} = {}) {
  const external = normalizeExternalStatus(externalKnowledge);
  const localLlm = localAi.localLlm || {};
  const onlineConnector = localAi.onlineConnector || {};
  const connectivity = getConnectivityPolicy(env);
  const forcedOffline = connectivity.forceOffline;
  const localLlmConfigured = Boolean(localLlm.enabled && (localLlm.health?.available || localLlm.status === "configured"));
  const externalConfigured = Boolean(external.enabled && external.endpointConfigured && (external.endpointIsLocal || connectivity.networkAllowed));
  const apiConfigured = localLlmConfigured || externalConfigured || Boolean(onlineConnector.enabled);
  const externalFetched = Boolean(external.fetchedOnline);
  const cacheHit = Boolean(external.cacheHit);
  const apiError = cleanText(external.error);
  const localFallbacks = buildFallbacks({ forcedOffline, localLlm, external, apiConfigured, apiError, cacheHit });
  const activeMode = selectActiveMode({ forcedOffline, externalFetched, cacheHit, apiError, apiConfigured });
  const systemState = selectSystemState({ forcedOffline, externalFetched, cacheHit, apiError, apiConfigured });
  const latestDataUsed = externalFetched || cacheHit;

  return {
    id: "ADAPTIVE_AGENTIC_RUNTIME",
    version: AGENTIC_RUNTIME_VERSION,
    status: "adaptive-runtime-ready",
    systemState,
    activeMode,
    localFirst: true,
    internetRequired: false,
    apiConfigured,
    latestDataUsed,
    decision: {
      selectedPath: activeMode,
      reason: buildDecisionReason({ activeMode, externalFetched, cacheHit, apiError, apiConfigured, forcedOffline }),
      fallbackApplied: localFallbacks.length > 0,
      fallbackCount: localFallbacks.length
    },
    online: {
      requested: Boolean(external.enabled || onlineConnector.enabled || localLlm.enabled),
      availableForThisRun: Boolean(externalFetched || localLlmConfigured || externalConfigured || onlineConnector.enabled),
      networkAvailable: connectivity.internetAvailable,
      apiConfigured,
      externalApiEnabled: external.enabled,
      externalApiAvailable: externalConfigured,
      externalApiFetched: externalFetched,
      externalApiCacheHit: cacheHit,
      endpointHost: external.endpointHost,
      localLlmAvailable: localLlmConfigured,
      localLlmConfigured,
      localLlmStatus: cleanText(localLlm.status) || "unknown",
      error: apiError
    },
    offline: {
      ready: true,
      selected: activeMode.startsWith("offline") || activeMode.includes("cache"),
      engine: "local deterministic healthcare engine",
      knowledgeBase: "Care Nova offline medical database",
      evidenceRanker: localAi.mlCore?.enabled !== false,
      memoryMode: cleanText(memory.mode) || "persistent-local-server",
      recordsMode: cleanText(records.mode) || "persistent-local-server",
      graphMode: cleanText(knowledgeGraph.mode) || "persistent-local-server",
      cacheFile: external.cache?.file || "data/external/external-knowledge-cache.json"
    },
    fallbackStrategy: {
      applied: localFallbacks.length > 0,
      fallbacks: localFallbacks,
      rule: "Use approved APIs when configured and reachable; otherwise use cached references, local medical knowledge, local memory, and safety guardrails."
    },
    responseContract: {
      structure: "clear-concise-actionable",
      complexQueries: "plan-execute-validate-respond",
      incompleteData: "state limitations and use best available local reasoning",
      medicalSafety: "education and care preparation only; no diagnosis, prescribing, dose calculation, or emergency dispatch"
    },
    stores: {
      memory: cleanText(memory.file) || "data/memory/patient-memory.json",
      records: cleanText(records.file) || "data/records/patient-records.json",
      graph: cleanText(knowledgeGraph.file) || "data/graph/patient-knowledge-graph.json",
      externalCache: external.cache?.file || "data/external/external-knowledge-cache.json"
    },
    runtime: {
      node: runtime.node || "",
      nodeEnv: runtime.nodeEnv || "",
      host: runtime.host || "",
      port: runtime.port || ""
    },
    timestamp: new Date().toISOString()
  };
}

export function buildAdaptiveExecutionTrace({
  policy,
  payload = {},
  result = {},
  externalKnowledge = {},
  memoryBefore = {},
  memoryAfter = {},
  qualityEvaluation = {}
} = {}) {
  const runtimePolicy = policy || buildAdaptiveRuntimePolicy({ externalKnowledge });
  const routeCount = Array.isArray(result.agentResults) ? result.agentResults.length : 0;
  const routeOwner = cleanText(result.plan?.responseOwner?.route || result.finalResponse?.responseFocus?.primaryRoute) || "RAG_AGENT";
  const matchCount = Array.isArray(result.medicalKnowledge?.matches) ? result.medicalKnowledge.matches.length : 0;
  const guardrailsPassed = result.guardrails?.passed !== false;
  const memorySaved = result.memory?.saved === true || memoryAfter.recentTurnCount >= 0;
  const external = normalizeExternalStatus(externalKnowledge);

  return {
    ...runtimePolicy,
    request: {
      patientId: cleanText(payload.patientId) || "demo-patient",
      messageLength: cleanText(payload.message).length,
      domain: result.requirementProfile?.domain || result.plan?.responseOwner?.domain || "healthcare",
      answerMode: result.requirementProfile?.answerMode || "safe-concise"
    },
    executionTrace: {
      status: guardrailsPassed ? "validated" : "review-needed",
      steps: [
        {
          id: "plan",
          status: "complete",
          detail: `${runtimePolicy.activeMode} selected; ${routeOwner} owns the visible answer.`
        },
        {
          id: "retrieve",
          status: matchCount ? "complete" : "fallback",
          detail: `${matchCount} local/cached reference(s) matched; external fetched: ${external.fetchedOnline ? "yes" : "no"}.`
        },
        {
          id: "execute",
          status: routeCount ? "complete" : "fallback",
          detail: `${routeCount || 1} specialist route(s) executed with local safety logic.`
        },
        {
          id: "validate",
          status: guardrailsPassed ? "complete" : "review-needed",
          detail: `${qualityEvaluation.label || "Quality checked"}; guardrails ${guardrailsPassed ? "passed" : "need review"}.`
        },
        {
          id: "persist",
          status: memorySaved ? "complete" : "deferred",
          detail: memorySaved
            ? `Memory advanced from ${memoryBefore.recentTurnCount || 0} to ${memoryAfter.recentTurnCount || 0} local turn(s).`
            : "Memory persistence was not confirmed for this run."
        }
      ],
      validationScore: toBoundedInteger(qualityEvaluation.score, 0, 100, result.agenticReview?.score || 0),
      nextBestAction: result.agenticReview?.nextBestAction || "Continue with local evidence, safety checks, and clear user-facing guidance."
    }
  };
}

function normalizeExternalStatus(status = {}) {
  return {
    enabled: Boolean(status.enabled),
    endpointConfigured: Boolean(status.endpointConfigured),
    endpointIsLocal: Boolean(status.endpointIsLocal),
    endpointHost: cleanText(status.endpointHost),
    fetchedOnline: Boolean(status.fetchedOnline),
    cacheHit: Boolean(status.cacheHit),
    error: cleanText(status.error),
    futureRequestReuse: status.futureRequestReuse !== false,
    cache: status.cache && typeof status.cache === "object" ? status.cache : {}
  };
}

function selectActiveMode({ forcedOffline, externalFetched, cacheHit, apiError, apiConfigured }) {
  if (forcedOffline) {
    return "offline-forced-local";
  }

  if (externalFetched) {
    return "online-api-augmented";
  }

  if (cacheHit) {
    return apiError ? "offline-cache-fallback" : "cached-reference-local";
  }

  if (apiConfigured && apiError) {
    return "offline-api-fallback";
  }

  if (apiConfigured) {
    return "online-ready-local-safe-core";
  }

  return "offline-local-rag";
}

function selectSystemState({ forcedOffline, externalFetched, cacheHit, apiError, apiConfigured }) {
  if (forcedOffline) {
    return "Offline";
  }

  if (externalFetched) {
    return "Online";
  }

  if (cacheHit && apiError) {
    return "Offline";
  }

  if (apiConfigured && !apiError) {
    return "Online-ready";
  }

  return "Offline";
}

function buildFallbacks({ forcedOffline, localLlm, external, apiConfigured, apiError, cacheHit }) {
  const fallbacks = [];

  if (forcedOffline) {
    fallbacks.push("operator-forced-offline");
  }

  if (localLlm.enabled && localLlm.status && localLlm.status !== "configured") {
    fallbacks.push("primary-llm-safe-local-fallback");
  }

  if (!external.enabled) {
    fallbacks.push("external-api-disabled-local-rag");
  }

  if (external.enabled && apiError) {
    fallbacks.push(cacheHit ? "external-api-error-cache-reused" : "external-api-error-local-rag");
  }

  if (!apiConfigured) {
    fallbacks.push("no-approved-online-api-configured");
  }

  return Array.from(new Set(fallbacks));
}

function buildDecisionReason({ activeMode, externalFetched, cacheHit, apiError, apiConfigured, forcedOffline }) {
  if (forcedOffline) {
    return "Offline-only mode was requested, so the local engine was selected.";
  }

  if (externalFetched) {
    return "An approved external reference source responded and was combined with local retrieval and safety checks.";
  }

  if (cacheHit) {
    return apiError
      ? "The online source failed, so cached reference material and local retrieval were used."
      : "Cached approved reference material was reused with local retrieval.";
  }

  if (apiConfigured && apiError) {
    return "An approved API was configured but unavailable, so the local deterministic engine handled the request.";
  }

  if (activeMode === "online-ready-local-safe-core") {
    return "An online connector is configured, but this run did not need a live fetch; the local safe core handled it.";
  }

  return "No approved online source is active, so local memory, offline knowledge, and deterministic safety rules were selected.";
}

function toBoundedInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  const number = Number.isInteger(parsed) ? parsed : Number.parseInt(fallback, 10);

  if (!Number.isInteger(number)) {
    return min;
  }

  return Math.min(max, Math.max(min, number));
}

function readBoolean(value) {
  return /^(1|true|yes|on)$/i.test(cleanText(value));
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
