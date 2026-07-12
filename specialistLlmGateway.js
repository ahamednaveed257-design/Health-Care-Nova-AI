import { getModelHealthStatus } from "./localAiEngine.js";
import { getOpenSourceParticipationPlan } from "./hybridModelRouter.js";
import {
  ensureLocalRuntimeProbeFresh,
  getLocalRuntimeGenerationStatus,
  getLocalRuntimeProbeSnapshot,
  normalizeChatCompletionsEndpoint,
  recordLocalRuntimeGenerationFailure,
  recordLocalRuntimeGenerationSuccess,
  resolveRuntimeRequestTimeout
} from "./openSourceLocalRuntime.js";
import { getConnectivityPolicy, isEndpointUsableForThisRun, isLocalEndpoint } from "./runtimeConnectivity.js";

const DEFAULT_OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 25000;
const DEFAULT_MAX_AGENTS = 4;
const DEFAULT_PEER_ROUTE_PACKET_LIMIT = 4;

const ROUTE_ACTION_KEYS = {
  RAG_AGENT: "safeActions",
  SPECIALIST_DOCTOR_AGENT: "specialistActions",
  VITALS_AGENT: "vitalActions",
  PHARMACY_AGENT: "pharmacyActions",
  SCHEDULING_AGENT: "visitActions",
  ALERT_AGENT: "safetyActions",
  LABS_AGENT: "labActions",
  LIFESTYLE_AGENT: "lifestyleActions",
  WELLNESS_AGENT: "checklist",
  RECORDS_AGENT: "checklist",
  INSURANCE_AGENT: "checklist",
  CARE_TRANSITIONS_AGENT: "checklist",
  CLAIMS_OPS_AGENT: "checklist",
  UTILIZATION_AGENT: "checklist",
  GXP_QUALITY_AGENT: "checklist",
  MEDTECH_COMPLIANCE_AGENT: "checklist"
};

const ROUTE_QUESTION_KEYS = {
  RAG_AGENT: ["focusQuestions"],
  SPECIALIST_DOCTOR_AGENT: ["doctorQuestions"],
  VITALS_AGENT: ["clinicianQuestions"],
  PHARMACY_AGENT: ["pharmacistQuestions"],
  LABS_AGENT: ["doctorQuestions"],
  LIFESTYLE_AGENT: ["clinicianQuestions"],
  INSURANCE_AGENT: ["benefitQuestions"]
};

const ROUTE_BOUNDARIES = {
  RAG_AGENT: "General health education only. Do not diagnose, prescribe, or give dosage instructions.",
  SPECIALIST_DOCTOR_AGENT: "Specialist education only. Do not confirm diagnosis, treatment, or testing decisions.",
  VITALS_AGENT: "Vitals interpretation support only. Do not finalize clinician decisions or treatment changes.",
  PHARMACY_AGENT: "Medication safety education only. Do not tell the patient to start, stop, double, or dose a medicine.",
  SCHEDULING_AGENT: "Appointment planning only. Do not claim a booked visit or clinician approval.",
  ALERT_AGENT: "Safety escalation wording only. Do not claim emergency dispatch, monitoring, or diagnosis.",
  LABS_AGENT: "Lab explanation only. Do not confirm a diagnosis or treatment plan from a lab value.",
  LIFESTYLE_AGENT: "Lifestyle coaching only. Do not override a clinician care plan.",
  WELLNESS_AGENT: "Supportive wellness guidance only. Real-world crisis help must stay external to the app.",
  RECORDS_AGENT: "Documentation drafting only. Do not treat drafts as signed medical records.",
  INSURANCE_AGENT: "Administrative support only. Do not approve or deny coverage, payment, or authorization.",
  CARE_TRANSITIONS_AGENT: "Discharge-transition drafting only. Final instructions require care-team review.",
  CLAIMS_OPS_AGENT: "Claims operations support only. Do not issue adjudication or payment decisions.",
  UTILIZATION_AGENT: "Prior-authorization drafting only. Do not approve or deny treatment.",
  GXP_QUALITY_AGENT: "GxP quality drafting only. Do not release a batch, approve CAPA, or close a deviation.",
  MEDTECH_COMPLIANCE_AGENT: "MedTech compliance drafting only. Do not issue a regulatory submission or quality decision."
};

export function getSpecialistLlmAgentStatus(env = process.env, input = {}) {
  return buildSpecialistRuntimePlan(env, input).status;
}

export async function tryEnhanceSpecialistAgentResultsWithLlm({
  message = "",
  profile = {},
  vitals = {},
  context = {},
  memoryContext = {},
  risk = {},
  plan = {},
  requirementProfile = {},
  agentResults = [],
  medicalKnowledge = {},
  llmBrain = {},
  modelRouting = {},
  env = process.env
} = {}) {
  const preferredAgent = cleanText(
    plan?.singleAgent?.route
      || plan?.responseOwner?.route
      || requirementProfile?.expectedRoute
      || ""
  );
  let runtimePlan = buildSpecialistRuntimePlan(env, { preferredAgent, plan, requirementProfile });

  if (runtimePlan.status.featureEnabled && !runtimePlan.status.configured && runtimePlan.status.status !== "local-runtime-cooldown") {
    await ensureLocalRuntimeProbeFresh(env, { probeTimeoutMs: 700 }).catch(() => {});
    runtimePlan = buildSpecialistRuntimePlan(env, { preferredAgent, plan, requirementProfile });
  }

  const execution = {
    ...runtimePlan.status,
    attempted: false,
    applied: false,
    appliedCount: 0,
    attemptedCount: 0,
    fallbackUsed: true,
    error: "",
    targetRoutes: [],
    enhancedRoutes: [],
    routeReports: []
  };

  if (!execution.featureEnabled || !execution.configured || !Array.isArray(agentResults) || !agentResults.length) {
    return {
      agentResults,
      execution
    };
  }

  const targetRoutes = selectTargetRoutes({
    plan,
    requirementProfile,
    risk,
    agentResults,
    maxAgents: execution.maxAgents
  });

  execution.targetRoutes = targetRoutes;

  if (!targetRoutes.length) {
    execution.error = "No eligible specialist routes were available for LLM refinement.";
    return {
      agentResults,
      execution
    };
  }

  execution.attempted = true;
  execution.attemptedCount = targetRoutes.length;
  const mergedAgentResults = Array.isArray(agentResults) ? [...agentResults] : [];

  for (const route of targetRoutes) {
    const agentIndex = mergedAgentResults.findIndex((agent) => agent?.id === route);

    if (agentIndex === -1) {
      execution.routeReports.push({
        route,
        applied: false,
        error: "Route output was not present in the deterministic plan."
      });
      continue;
    }

    try {
      const review = await requestSpecialistReview({
        route,
        agent: mergedAgentResults[agentIndex],
        runtimeCandidates: runtimePlan.readyRuntimeCandidates,
        timeoutMs: execution.timeoutMs,
        env,
        packet: buildSpecialistPacket({
          route,
          agent: mergedAgentResults[agentIndex],
          agentResults: mergedAgentResults,
          message,
          profile,
          vitals,
          context,
          memoryContext,
          risk,
          plan,
          requirementProfile,
          medicalKnowledge,
          llmBrain,
          modelRouting
        })
      });
      const merged = mergeSpecialistReviewIntoAgent({
        route,
        agent: mergedAgentResults[agentIndex],
        review: review.review,
        candidate: review.candidate
      });

      if (merged.changed) {
        mergedAgentResults[agentIndex] = merged.agent;
        execution.appliedCount += 1;
        execution.enhancedRoutes.push(route);
      }

      execution.routeReports.push({
        route,
        applied: merged.changed,
        provider: review.candidate.displayName || review.candidate.provider || "",
        model: review.candidate.model || "",
        source: review.candidate.source || "",
        error: merged.changed ? "" : "No grounded refinements were returned."
      });
    } catch (error) {
      execution.routeReports.push({
        route,
        applied: false,
        error: cleanText(error.message).slice(0, 220)
      });
    }
  }

  execution.applied = execution.appliedCount > 0;
  execution.fallbackUsed = !execution.applied;
  execution.error = execution.applied
    ? ""
    : execution.routeReports
      .filter((entry) => !entry.applied && entry.error)
      .map((entry) => `${routeLabel(entry.route)}: ${entry.error}`)
      .slice(0, 3)
      .join(" | ")
      || execution.reason;

  return {
    agentResults: mergedAgentResults,
    execution
  };
}

function buildSpecialistRuntimePlan(env = process.env, input = {}) {
  const connectivity = getConnectivityPolicy(env);
  const featureEnabled = readBooleanDefault(env.CARE_NOVA_SPECIALIST_LLM_AGENTS_ENABLED, true);
  const timeoutMs = clampInteger(env.CARE_NOVA_SPECIALIST_LLM_AGENTS_TIMEOUT_MS, 2000, 120000, DEFAULT_TIMEOUT_MS);
  const maxAgents = clampInteger(env.CARE_NOVA_SPECIALIST_LLM_AGENTS_MAX, 1, 6, DEFAULT_MAX_AGENTS);
  const preferredAgent = cleanText(input?.preferredAgent || "");
  const ensemble = getOpenSourceParticipationPlan({
    preferredAgent
  }, env);
  const modelHealth = getModelHealthStatus(env);
  const localRuntimeCoolingDown = Boolean(modelHealth.healthCheck?.generationCooldownActive);
  const cloudRuntime = buildSpecialistCloudRuntime(env);
  const runtimeCandidates = dedupeRuntimeCandidates([
    ...buildOpenSourceCandidates(ensemble),
    ...buildFallbackCandidates(modelHealth),
    ...buildCloudCandidates(cloudRuntime)
  ]);
  const readyRuntimeCandidates = [];
  const blockedRuntimeCandidates = [];

  for (const candidate of runtimeCandidates) {
    if (isEndpointUsableForThisRun(candidate.endpoint, env, { connectivity })) {
      readyRuntimeCandidates.push(candidate);
    } else {
      blockedRuntimeCandidates.push(candidate);
    }
  }

  const safeReadyCandidates = readyRuntimeCandidates.map(sanitizeRuntimeCandidate);
  const safeBlockedCandidates = blockedRuntimeCandidates.map(sanitizeRuntimeCandidate);
  const anyCandidate = runtimeCandidates.length > 0;
  const requested = Boolean(anyCandidate || blockedRuntimeCandidates.length || cloudRuntime.requested);
  const configured = featureEnabled && readyRuntimeCandidates.length > 0;
  const policyBlocked = featureEnabled && !configured && blockedRuntimeCandidates.length > 0;
  const enabled = featureEnabled && requested && !policyBlocked;
  const provider = readyRuntimeCandidates[0]?.provider || blockedRuntimeCandidates[0]?.provider || cloudRuntime.provider || "";
  const displayName = readyRuntimeCandidates[0]?.displayName || blockedRuntimeCandidates[0]?.displayName || cloudRuntime.displayName || "";
  const model = readyRuntimeCandidates[0]?.model || blockedRuntimeCandidates[0]?.model || cloudRuntime.model || "";
  const endpointHost = readyRuntimeCandidates[0]?.endpointHost || blockedRuntimeCandidates[0]?.endpointHost || cloudRuntime.endpointHost || "";
  const runtimeFamily = readyRuntimeCandidates[0]?.runtimeFamily || blockedRuntimeCandidates[0]?.runtimeFamily || cloudRuntime.runtimeFamily || "";
  const status = {
    featureEnabled,
    enabled,
    configured,
    policyBlocked,
    requested,
    provider,
    displayName,
    model,
    endpointHost,
    runtimeFamily,
    timeoutMs,
    maxAgents,
    candidateCount: safeReadyCandidates.length,
    blockedCandidateCount: safeBlockedCandidates.length,
    candidates: safeReadyCandidates,
    blockedCandidates: safeBlockedCandidates,
    connectivity: {
      forceOffline: connectivity.forceOffline,
      internetAvailable: connectivity.internetAvailable
    },
    status: !featureEnabled
      ? "disabled"
      : configured
        ? "ready"
        : localRuntimeCoolingDown
          ? "local-runtime-cooldown"
        : blockedRuntimeCandidates.length
          ? "offline-policy-blocked"
          : "missing-configuration",
    reasoningMode: "route-aware-specialist-llm-assist",
    fallback: "deterministic-specialist-agent-output",
    reason: buildStatusReason({
      featureEnabled,
      configured,
      anyCandidate,
      localRuntimeCoolingDown,
      readyCandidates: safeReadyCandidates,
      blockedCandidates: safeBlockedCandidates,
      connectivity,
      cloudRuntime
    })
  };

  return {
    status,
    readyRuntimeCandidates
  };
}

function buildOpenSourceCandidates(ensemble = {}) {
  return (Array.isArray(ensemble.participants) ? ensemble.participants : [])
    .map((model, index) => {
      const endpoint = normalizeChatCompletionsEndpoint(model?.endpoint);

      if (!endpoint || !model?.model) {
        return null;
      }

      return {
        id: cleanText(model.id || `open-source-${index + 1}`),
        provider: cleanText(model.id || "open-source-local"),
        displayName: cleanText(model.displayName || model.model || "Open-source local model"),
        model: cleanText(model.model),
        endpoint,
        endpointHost: safeHost(endpoint),
        runtimeFamily: cleanText(model.runtimeFamily || ""),
        apiKey: cleanText(model.apiKey || ""),
        apiKeyHeader: cleanText(model.apiKeyHeader || ""),
        authScheme: cleanText(model.authScheme || "Bearer"),
        source: "open-source-ensemble"
      };
    })
    .filter(Boolean);
}

function buildFallbackCandidates(modelHealth = {}) {
  const endpoint = normalizeChatCompletionsEndpoint(modelHealth.endpoint);

  if (!modelHealth.healthCheck?.available || !endpoint || !modelHealth.model) {
    return [];
  }

  return [{
    id: cleanText(modelHealth.provider || "local-fallback"),
    provider: cleanText(modelHealth.provider || "local-fallback"),
    displayName: cleanText(modelHealth.displayName || "Local fallback runtime"),
    model: cleanText(modelHealth.model),
    endpoint,
    endpointHost: safeHost(endpoint),
    runtimeFamily: cleanText(modelHealth.runtimeFamily || ""),
    apiKey: cleanText(modelHealth.apiKey || ""),
    apiKeyHeader: cleanText(modelHealth.apiKeyHeader || ""),
    authScheme: cleanText(modelHealth.authScheme || "Bearer"),
    source: "local-health-fallback"
  }];
}

function buildSpecialistCloudRuntime(env = process.env) {
  const allModelsEnabled = readBoolean(env.CARE_NOVA_ENABLE_ALL_MODELS);
  const demoLocalEndpoint = resolveLocalDemoCloudEndpoint(env);
  const apiKey = cleanText(
    env.CARE_NOVA_SPECIALIST_LLM_API_KEY
      || env.CARE_NOVA_TEMP_CLOUD_API_KEY
      || env.OPENAI_API_KEY
  );
  const configuredEndpoint = normalizeChatCompletionsEndpoint(
    env.CARE_NOVA_TEMP_CLOUD_API_URL
      || env.OPENAI_BASE_URL
      || ""
  );
  const providerEnabled = readBooleanDefault(
    env.CARE_NOVA_OPENAI_ENABLED,
    Boolean(apiKey || configuredEndpoint || demoLocalEndpoint)
  ) || allModelsEnabled;
  const paidCloudAllowed = allModelsEnabled || readBoolean(env.CARE_NOVA_PAID_MODELS_ENABLED) || readBoolean(env.CARE_NOVA_CLOUD_MODELS_ENABLED);
  const explicitCloudEnabled = allModelsEnabled || readBoolean(env.CARE_NOVA_SPECIALIST_LLM_CLOUD_ENABLED) || readBoolean(env.CARE_NOVA_TEMP_CLOUD_RESPONSE_ENABLED);
  const requested = explicitCloudEnabled || (providerEnabled && paidCloudAllowed);
  const provider = cleanText(
    env.CARE_NOVA_TEMP_CLOUD_PROVIDER
      || (providerEnabled ? "openai" : "openai-compatible")
      || "openai-compatible"
  ) || "openai-compatible";
  const configuredModel = cleanText(env.CARE_NOVA_TEMP_CLOUD_MODEL || env.OPENAI_MODEL || "");
  const useLocalDemoFallback = Boolean(
    allModelsEnabled
    && !explicitCloudEnabled
    && !apiKey
    && demoLocalEndpoint
    && (!configuredEndpoint || configuredEndpoint === DEFAULT_OPENAI_CHAT_COMPLETIONS_URL)
  );
  const endpoint = normalizeChatCompletionsEndpoint(
    useLocalDemoFallback
      ? demoLocalEndpoint
      : configuredEndpoint || DEFAULT_OPENAI_CHAT_COMPLETIONS_URL
  );
  const model = useLocalDemoFallback
    ? resolveLocalDemoCloudModel(env)
    : cleanText(configuredModel || "gpt-5.4");
  const endpointIsLocal = Boolean(endpoint) && isLocalEndpoint(endpoint);
  const compatibilityRuntimeDetected = endpointIsLocal && isMockLocalRuntimeEndpoint(endpoint);
  const missingApiKey = requested && Boolean(endpoint) && !endpointIsLocal && !apiKey;

  return {
    requested,
    explicitCloudEnabled,
    providerEnabled,
    paidCloudAllowed,
    provider,
    displayName: provider === "openai" ? "OpenAI Cloud" : "OpenAI-Compatible Cloud",
    model,
    endpoint,
    endpointHost: endpoint ? safeHost(endpoint) : "",
    runtimeFamily: endpointIsLocal ? "local-openai-compatible" : "remote-openai-compatible",
    endpointIsLocal,
    compatibilityRuntimeDetected,
    apiKey,
    missingApiKey
  };
}

function resolveLocalDemoCloudEndpoint(env = {}) {
  return normalizeChatCompletionsEndpoint(
    env.LOCAL_LLM_URL
      || env.CARE_NOVA_LOCAL_LLM_URL
  );
}

function resolveLocalDemoCloudModel(env = {}) {
  return cleanText(
    env.LOCAL_LLM_MODEL
      || env.CARE_NOVA_LOCAL_LLM_MODEL
      || env.CARE_NOVA_DEEPSEEK_MODEL
      || env.DEEPSEEK_MODEL
      || env.CARE_NOVA_QWEN_MODEL
      || env.QWEN_MODEL
      || env.CARE_NOVA_LLAMA_MODEL
      || env.LLAMA_MODEL
      || "qwen2.5:3b"
  );
}

function buildCloudCandidates(cloudRuntime = {}) {
  if (!cloudRuntime.requested) {
    return [];
  }

  if (!cloudRuntime.endpoint || !cloudRuntime.model || cloudRuntime.missingApiKey || cloudRuntime.compatibilityRuntimeDetected) {
    return [];
  }

  return [{
    id: cloudRuntime.provider || "openai",
    provider: cloudRuntime.provider || "openai",
    displayName: cloudRuntime.displayName || "OpenAI-Compatible Cloud",
    model: cloudRuntime.model,
    endpoint: cloudRuntime.endpoint,
    endpointHost: cloudRuntime.endpointHost,
    runtimeFamily: cloudRuntime.runtimeFamily,
    apiKey: cloudRuntime.apiKey,
    apiKeyHeader: "",
    authScheme: "Bearer",
    source: cloudRuntime.endpointIsLocal ? "openai-compatible-local" : "openai-cloud"
  }];
}

function dedupeRuntimeCandidates(candidates = []) {
  const seen = new Set();
  const unique = [];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    const key = [
      cleanText(candidate.provider).toLowerCase(),
      cleanText(candidate.model).toLowerCase(),
      cleanText(candidate.endpoint).toLowerCase(),
      cleanText(candidate.source).toLowerCase()
    ].join("::");

    if (!candidate.endpoint || !candidate.model || seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(candidate);
  }

  return unique;
}

function sanitizeRuntimeCandidate(candidate = {}) {
  return {
    provider: cleanText(candidate.provider),
    displayName: cleanText(candidate.displayName),
    model: cleanText(candidate.model),
    endpointHost: cleanText(candidate.endpointHost),
    runtimeFamily: cleanText(candidate.runtimeFamily),
    source: cleanText(candidate.source)
  };
}

function buildStatusReason({
  featureEnabled,
  configured,
  anyCandidate,
  localRuntimeCoolingDown,
  readyCandidates = [],
  blockedCandidates = [],
  connectivity,
  cloudRuntime = {}
} = {}) {
  if (!featureEnabled) {
    return "Specialist LLM agent assist is disabled.";
  }

  if (configured) {
    const readyNames = readyCandidates.map((candidate) => candidate.displayName).filter(Boolean);
    const readyBase = readyNames.length > 1
      ? `Specialist LLM agent assist is ready with ${readyNames.join(", ")}.`
      : readyNames.length === 1
        ? `Specialist LLM agent assist is ready with ${readyNames[0]}.`
        : "Specialist LLM agent assist is ready.";

    return blockedCandidates.length
      ? `${readyBase} Remote-only candidates were skipped when policy required the safe route.`
      : readyBase;
  }

  if (blockedCandidates.length) {
    return connectivity?.forceOffline
      ? "Specialist LLM candidates are configured but blocked by offline policy."
      : "Specialist LLM candidates are configured but internet is unavailable.";
  }

  if (localRuntimeCoolingDown) {
    return "Specialist LLM assist is paused because the local runtime recently timed out or returned an unusable response. Deterministic specialist routes remain active during cooldown.";
  }

  if (!anyCandidate) {
    if (cloudRuntime.requested && cloudRuntime.compatibilityRuntimeDetected) {
      return "Specialist LLM cloud assist is pointed at the localhost compatibility adapter, so deterministic specialist routes remain active until a native runtime or real cloud endpoint is configured.";
    }

    if (cloudRuntime.requested && cloudRuntime.missingApiKey) {
      return "Specialist LLM cloud assist is enabled but the API key is missing for the remote provider.";
    }

    if (cloudRuntime.requested && !cloudRuntime.model) {
      return "Specialist LLM cloud assist is enabled but the model is missing.";
    }

    if (cloudRuntime.requested && !cloudRuntime.endpoint) {
      return "Specialist LLM cloud assist is enabled but the endpoint is missing.";
    }

    return "Specialist LLM agent assist is missing local or cloud model configuration.";
  }

  return "Specialist LLM agent assist is not ready, so deterministic specialist routes remain active.";
}

function isMockLocalRuntimeEndpoint(endpoint) {
  const normalized = cleanText(normalizeChatCompletionsEndpoint(endpoint));

  if (!normalized) {
    return false;
  }

  return getLocalRuntimeProbeSnapshot()?.endpoints?.[normalized]?.mockRuntime === true;
}

function selectTargetRoutes({ plan = {}, requirementProfile = {}, risk = {}, agentResults = [], maxAgents = DEFAULT_MAX_AGENTS } = {}) {
  const availableRoutes = new Set(
    (Array.isArray(agentResults) ? agentResults : [])
      .map((agent) => cleanText(agent?.id))
      .filter(Boolean)
  );
  const singleAgentEnabled = Boolean(plan?.singleAgent?.enabled);

  if (singleAgentEnabled) {
    const focusedSingleAgentRoutes = dedupeItems([
      cleanText(plan?.singleAgent?.route),
      cleanText(plan?.responseOwner?.route),
      cleanText(requirementProfile?.expectedRoute)
    ]).filter((route) => availableRoutes.has(route));

    if (focusedSingleAgentRoutes.length) {
      return focusedSingleAgentRoutes.slice(0, 1);
    }
  }

  const ordered = dedupeItems([
    cleanText(plan?.singleAgent?.route),
    cleanText(plan?.responseOwner?.route),
    cleanText(requirementProfile?.expectedRoute),
    cleanText(risk?.level || risk?.label).toUpperCase() !== "LOW" ? "ALERT_AGENT" : "",
    ...(Array.isArray(plan?.execute) ? plan.execute.map((route) => cleanText(route)) : []),
    ...(Array.isArray(agentResults) ? agentResults.map((agent) => cleanText(agent?.id)) : [])
  ]);

  return ordered
    .filter((route) => availableRoutes.has(route))
    .map((route, index) => ({
      route,
      index,
      score: scoreSpecialistRouteTarget({
        route,
        index,
        plan,
        requirementProfile,
        risk,
        agentResults
      })
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, maxAgents)
    .map((entry) => entry.route);
}

function scoreSpecialistRouteTarget({ route = "", index = 0, plan = {}, requirementProfile = {}, risk = {}, agentResults = [] } = {}) {
  const agent = (Array.isArray(agentResults) ? agentResults : []).find((candidate) => cleanText(candidate?.id) === route) || null;
  const output = agent?.output || {};
  const reasoningScore = Number(output?.reasoning?.score || output?.specialistProfile?.confidence || output?.confidenceScore || 0);
  const missingContextCount = collectMissingContext(output).length;
  const summaryLength = cleanText(output?.summary || output?.patientAnswerSummary || "").length;
  const qualityGateStatus = cleanText(output?.qualityGate?.status);
  const confidenceLabel = cleanText(output?.reasoning?.label || output?.confidenceLabel || "");
  const outputActionCount = countRouteActionHints(output);
  let score = Math.max(0, 24 - index * 2);

  if (/SPECIALIST|PHARMACY|LABS|VITALS|ALERT/.test(route)) {
    score += 8;
  }

  if (cleanText(plan?.singleAgent?.route) === route) {
    score += 140;
  }

  if (cleanText(plan?.responseOwner?.route) === route) {
    score += 120;
  }

  if (cleanText(requirementProfile?.expectedRoute) === route) {
    score += 90;
  }

  if (cleanText(risk?.level || risk?.label).toUpperCase() !== "LOW" && route === "ALERT_AGENT") {
    score += 80;
  }

  if (Array.isArray(plan?.execute) && plan.execute.includes(route)) {
    score += 22;
  }

  if (missingContextCount) {
    score += Math.min(missingContextCount, 4) * 8;
  }

  if (reasoningScore > 0 && reasoningScore < 88) {
    score += Math.ceil((88 - reasoningScore) / 4);
  }

  if (!summaryLength || summaryLength < 140) {
    score += 8;
  }

  if (outputActionCount <= 1) {
    score += 6;
  }

  if (qualityGateStatus && !/ready|pass|strong|green/i.test(qualityGateStatus)) {
    score += 6;
  }

  if (/needs|limited|partial|uncertain|low/i.test(confidenceLabel)) {
    score += 6;
  }

  if (output?.llmAgentAssist?.applied) {
    score -= 80;
  }

  return score;
}

function countRouteActionHints(output = {}) {
  const actionKeys = [
    "safeActions",
    "specialistActions",
    "vitalActions",
    "pharmacyActions",
    "visitActions",
    "safetyActions",
    "labActions",
    "lifestyleActions",
    "checklist",
    "focusQuestions",
    "doctorQuestions",
    "clinicianQuestions",
    "pharmacistQuestions",
    "benefitQuestions",
    "prepChecklist",
    "nextActions"
  ];

  return actionKeys.reduce(
    (total, key) => total + (Array.isArray(output?.[key]) ? output[key].filter((item) => cleanText(item)).length : 0),
    0
  );
}

async function requestSpecialistReview({
  route = "",
  agent = {},
  runtimeCandidates = [],
  packet = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
  env = process.env
} = {}) {
  const errors = [];

  for (const candidate of runtimeCandidates) {
    const runtimeHealth = getLocalRuntimeGenerationStatus(candidate.endpoint, env);

    if (candidate.endpoint && runtimeHealth.endpointIsLocal && !runtimeHealth.ready) {
      errors.push(
        `${candidate.displayName || candidate.provider || "local"} is temporarily cooling down after a recent local runtime failure.`
      );
      continue;
    }

    const requestTimeoutMs = resolveRuntimeRequestTimeout(candidate.endpoint, timeoutMs, env);
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);

    try {
      const request = buildRuntimeRequest({ candidate, route, packet, env });
      const response = await fetch(request.url, {
        method: "POST",
        headers: request.headers,
        body: JSON.stringify(request.body),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`${candidate.displayName} returned ${response.status}.`);
      }

      const json = await response.json();
      const text = extractResponseText(json);

      if (!text) {
        throw new Error(`${candidate.displayName} returned an empty response.`);
      }

      const parsed = parseJsonObject(text);

      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(`${candidate.displayName} did not return valid JSON.`);
      }

      validateSpecialistReview({ route, review: parsed, agent });
      recordLocalRuntimeGenerationSuccess(candidate.endpoint, {
        latencyMs: Date.now() - startedAt
      });
      return {
        review: parsed,
        candidate
      };
    } catch (error) {
      recordLocalRuntimeGenerationFailure(candidate.endpoint, error, env, {
        latencyMs: Date.now() - startedAt
      });
      errors.push(cleanText(error.message).slice(0, 180));
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(
    errors.length
      ? `${routeLabel(route)} assist failed. ${errors.join(" | ")}`
      : `${routeLabel(route)} assist is not configured.`
  );
}

function buildRuntimeRequest({ candidate = {}, route = "", packet = {}, env = process.env } = {}) {
  const messages = buildSpecialistMessages({ route, packet });
  const runtimeFamily = cleanText(candidate.runtimeFamily).toLowerCase();
  const focusedSingleAgent = cleanText(packet?.packetMode).toLowerCase() === "focused-single-agent";
  const useOllamaNative = runtimeFamily === "ollama-compatible"
    || /localhost:11434|127\.0\.0\.1:11434/i.test(cleanText(candidate.endpoint));

  if (useOllamaNative) {
    return {
      url: toOllamaChatEndpoint(candidate.endpoint),
      headers: buildHeaders(env, candidate),
      body: {
        model: candidate.model,
        stream: false,
        format: buildSpecialistJsonSchema(),
        messages
      }
    };
  }

  return {
    url: candidate.endpoint,
    headers: buildHeaders(env, candidate),
    body: {
      model: candidate.model,
      temperature: 0.1,
      max_tokens: focusedSingleAgent ? 320 : 480,
      messages
    }
  };
}

function buildSpecialistMessages({ route = "", packet = {} } = {}) {
  const boundary = routeBoundary(route);
  return [
    {
      role: "system",
      content: [
        `You refine deterministic Care Nova ${routeLabel(route)} output.`,
        `Safety boundary: ${boundary}`,
        "Use only packet evidence, peer-route context, and keep urgent wording conservative.",
        "Do not add diagnosis, prescriptions, dosing, dispatch claims, coverage/payment/authorization decisions, batch release decisions, CAPA closure, or regulatory approvals.",
        "Return strict JSON with keys summary, patient_answer_summary, action_additions, question_additions, warning_additions, missing_context, evidence_focus, confidence_label.",
        "Use empty arrays or empty strings when no grounded change is needed."
      ].join(" ")
    },
    {
      role: "user",
      content: `Refine this specialist packet.\n${JSON.stringify(packet)}`
    }
  ];
}

function buildSpecialistJsonSchema() {
  return {
    type: "object",
    properties: {
      summary: { type: "string" },
      patient_answer_summary: { type: "string" },
      action_additions: {
        type: "array",
        items: { type: "string" }
      },
      question_additions: {
        type: "array",
        items: { type: "string" }
      },
      warning_additions: {
        type: "array",
        items: { type: "string" }
      },
      missing_context: {
        type: "array",
        items: { type: "string" }
      },
      evidence_focus: {
        type: "array",
        items: { type: "string" }
      },
      confidence_label: { type: "string" }
    },
    required: [
      "summary",
      "patient_answer_summary",
      "action_additions",
      "question_additions",
      "warning_additions",
      "missing_context",
      "evidence_focus",
      "confidence_label"
    ],
    additionalProperties: false
  };
}

function buildSpecialistPacket({
  route = "",
  agent = {},
  agentResults = [],
  message = "",
  profile = {},
  vitals = {},
  context = {},
  memoryContext = {},
  risk = {},
  plan = {},
  requirementProfile = {},
  medicalKnowledge = {},
  llmBrain = {},
  modelRouting = {}
} = {}) {
  const output = agent?.output || {};
  const actionKey = ROUTE_ACTION_KEYS[route] || "checklist";
  const questionKey = getPrimaryRouteQuestionKey(route);
  const focusedSingleAgent = Boolean(plan?.singleAgent?.enabled) && cleanText(plan?.singleAgent?.route) === route;
  const packetProfile = focusedSingleAgent
    ? {
      patientMessageLimit: 240,
      profileListLimit: 3,
      recentMessageLimit: 1,
      routeReasonLimit: 2,
      summaryLimit: 360,
      patientAnswerLimit: 240,
      actionLimit: 3,
      questionLimit: 3,
      checklistLimit: 3,
      evidenceLimit: 2,
      peerRouteLimit: 3
    }
    : {
      patientMessageLimit: 360,
      profileListLimit: 5,
      recentMessageLimit: 2,
      routeReasonLimit: 4,
      summaryLimit: 520,
      patientAnswerLimit: 320,
      actionLimit: 4,
      questionLimit: 4,
      checklistLimit: 4,
      evidenceLimit: 4,
      peerRouteLimit: DEFAULT_PEER_ROUTE_PACKET_LIMIT
    };
  const routeKnowledgeMatches = Array.isArray(medicalKnowledge?.routeMatchesByRoute?.[route]?.matches)
    && medicalKnowledge.routeMatchesByRoute[route].matches.length
      ? medicalKnowledge.routeMatchesByRoute[route].matches
      : Array.isArray(medicalKnowledge?.matches)
        ? medicalKnowledge.matches
        : [];
  const evidence = routeKnowledgeMatches.slice(0, packetProfile.evidenceLimit).map((match) => ({
        title: cleanText(match?.title).slice(0, 120),
        category: cleanText(match?.category).slice(0, 60),
        summary: cleanText(match?.summary).slice(0, 240),
        safetyNotes: cleanText(match?.safetyNotes).slice(0, 180),
        relevance: Number(match?.relevance || 0)
      }));

  return {
    route,
    routeLabel: cleanText(agent?.name || routeLabel(route)),
    boundary: routeBoundary(route),
    risk: {
      level: cleanText(risk?.label || risk?.level || "LOW"),
      reasons: normalizeFlexibleStringList(risk?.reasons, 4, 160)
    },
    answerMode: cleanText(requirementProfile?.answerMode?.id || ""),
    patientMessage: cleanText(message).slice(0, packetProfile.patientMessageLimit),
    profile: {
      age: cleanText(profile?.age).slice(0, 24),
      gender: cleanText(profile?.gender).slice(0, 40),
      conditions: normalizeFlexibleStringList(profile?.conditions, packetProfile.profileListLimit, 80),
      medications: normalizeFlexibleStringList(profile?.medications, packetProfile.profileListLimit, 80),
      allergies: normalizeFlexibleStringList(profile?.allergies, packetProfile.profileListLimit, 80)
    },
    vitals: normalizeVitalsPacket(vitals),
    context: {
      redFlags: normalizeFlexibleStringList(context?.redFlags, 4, 120),
      recentMessages: normalizeFlexibleStringList(memoryContext?.recentMessages, packetProfile.recentMessageLimit, 140),
      recentRisks: normalizeFlexibleStringList(memoryContext?.recentRisks, 3, 40),
      recentTurnCount: Number(memoryContext?.recentTurnCount || 0)
    },
    routing: {
      responseOwner: cleanText(plan?.responseOwner?.route),
      singleAgent: cleanText(plan?.singleAgent?.route),
      activeRoutes: Array.isArray(plan?.execute) ? plan.execute.map((item) => cleanText(item)).filter(Boolean).slice(0, 6) : [],
      routeReasons: normalizeFlexibleStringList(plan?.routeReasons?.[route], packetProfile.routeReasonLimit, 180),
      llmBrainLabel: cleanText(llmBrain?.label).slice(0, 80),
      llmBrainSummary: cleanText(llmBrain?.summary).slice(0, 220),
      processingMode: cleanText(modelRouting?.generatedUsing || modelRouting?.processingType || ""),
      primaryModel: cleanText(modelRouting?.selectedModel?.primary?.displayName || modelRouting?.selectedModel?.primary?.model || "")
    },
    deterministicAgent: {
      summary: cleanText(output?.summary).slice(0, packetProfile.summaryLimit),
      patientAnswerSummary: cleanText(output?.patientAnswerSummary).slice(0, packetProfile.patientAnswerLimit),
      actionField: actionKey,
      actions: normalizeFlexibleStringList(output?.[actionKey], packetProfile.actionLimit, 220),
      questionField: questionKey,
      questions: questionKey ? normalizeFlexibleStringList(output?.[questionKey], packetProfile.questionLimit, 220) : [],
      checklist: normalizeFlexibleStringList(output?.checklist, packetProfile.checklistLimit, 220),
      missingContext: collectMissingContext(output),
      complianceBoundary: cleanText(output?.complianceBoundary).slice(0, 220),
      liveAction: cleanText(output?.liveAction).slice(0, 220),
      confidenceLabel: cleanText(output?.confidenceLabel).slice(0, 80)
    },
    peerRoutes: buildPeerRoutePacket(agentResults, route, packetProfile, {
      risk,
      activeRoutes: plan?.execute
    }),
    evidence,
    packetMode: focusedSingleAgent ? "focused-single-agent" : "multi-route"
  };
}

function buildPeerRoutePacket(agentResults = [], activeRoute = "", packetProfile = {}, options = {}) {
  const actionLimit = Math.max(2, Number(packetProfile?.actionLimit || 3) - 1);
  const questionLimit = Math.max(2, Number(packetProfile?.questionLimit || 3) - 1);
  const peerRouteLimit = Math.max(2, Number(packetProfile?.peerRouteLimit || DEFAULT_PEER_ROUTE_PACKET_LIMIT) || DEFAULT_PEER_ROUTE_PACKET_LIMIT);
  const activeRoutes = Array.isArray(options?.activeRoutes)
    ? options.activeRoutes.map((route) => cleanText(route)).filter(Boolean)
    : [];
  const riskLevel = cleanText(options?.risk?.level || options?.risk?.label || "");

  return (Array.isArray(agentResults) ? agentResults : [])
    .filter((candidate) => cleanText(candidate?.id) && cleanText(candidate?.id) !== activeRoute)
    .map((candidate) => {
      const route = cleanText(candidate?.id);
      const output = candidate?.output || {};
      const actions = collectPeerRouteActions(output, actionLimit);
      const questions = collectPeerRouteQuestions(route, output, questionLimit);
      const missingContext = collectMissingContext(output).slice(0, 3);

      return {
        route,
        routeLabel: cleanText(candidate?.name || routeLabel(candidate?.id || "")),
        summary: cleanText(output?.summary || "").slice(0, 240),
        patientAnswerSummary: cleanText(output?.patientAnswerSummary || "").slice(0, 200),
        actions,
        questions,
        missingContext,
        priorityScore: scorePeerRoutePacketCandidate({
          route,
          activeRoute,
          riskLevel,
          activeRoutes,
          actions,
          questions,
          missingContext
        }),
        confidenceLabel: cleanText(output?.reasoning?.label || output?.confidenceLabel || "").slice(0, 80)
      };
    })
    .sort((left, right) => (
      Number(right.priorityScore || 0) - Number(left.priorityScore || 0)
      || compareRouteOrder(left.route, right.route, activeRoutes)
    ))
    .slice(0, peerRouteLimit)
    .map(({ priorityScore, ...packet }) => packet);
}

function collectPeerRouteActions(output = {}, actionLimit = 2) {
  const actionKeys = [
    "checklist",
    "safeActions",
    "specialistActions",
    "vitalActions",
    "pharmacyActions",
    "visitActions",
    "safetyActions",
    "labActions",
    "lifestyleActions",
    "nextActions",
    "benefitQuestions"
  ];

  return dedupeItems(
    actionKeys.flatMap((key) => normalizeFlexibleStringList(output?.[key], actionLimit, 180))
  ).slice(0, actionLimit + 1);
}

function collectPeerRouteQuestions(route = "", output = {}, questionLimit = 2) {
  const genericQuestionKeys = [
    "focusQuestions",
    "doctorQuestions",
    "clinicianQuestions",
    "pharmacistQuestions",
    "benefitQuestions"
  ];
  const routeQuestionKeys = ROUTE_QUESTION_KEYS[route] || [];

  return dedupeItems(
    [...new Set([...routeQuestionKeys, ...genericQuestionKeys])]
      .flatMap((key) => normalizeFlexibleStringList(output?.[key], questionLimit, 180))
  ).slice(0, questionLimit);
}

function scorePeerRoutePacketCandidate({
  route = "",
  activeRoute = "",
  riskLevel = "",
  activeRoutes = [],
  actions = [],
  questions = [],
  missingContext = []
} = {}) {
  let score = routeSupportPriority(route);
  const routeIndex = activeRoutes.indexOf(route);
  const normalizedRisk = cleanText(riskLevel).toUpperCase();

  if (routeIndex >= 0) {
    score += Math.max(0, 24 - routeIndex * 3);
  }

  score += Math.min(actions.length, 3) * 8;
  score += Math.min(questions.length, 3) * 7;
  score += Math.min(missingContext.length, 3) * 6;

  if (route === "ALERT_AGENT" && (normalizedRisk === "HIGH" || normalizedRisk === "CRITICAL")) {
    score += 80;
  }

  if (activeRoute === "SPECIALIST_DOCTOR_AGENT" && ["PHARMACY_AGENT", "LABS_AGENT", "VITALS_AGENT", "ALERT_AGENT"].includes(route)) {
    score += 18;
  }

  if (activeRoute === "PHARMACY_AGENT" && ["VITALS_AGENT", "ALERT_AGENT", "SPECIALIST_DOCTOR_AGENT"].includes(route)) {
    score += 15;
  }

  if (activeRoute === "LABS_AGENT" && ["SPECIALIST_DOCTOR_AGENT", "PHARMACY_AGENT", "ALERT_AGENT"].includes(route)) {
    score += 15;
  }

  if (activeRoute === "VITALS_AGENT" && ["SPECIALIST_DOCTOR_AGENT", "PHARMACY_AGENT", "ALERT_AGENT"].includes(route)) {
    score += 15;
  }

  if (activeRoute === "INSURANCE_AGENT" && ["CLAIMS_OPS_AGENT", "UTILIZATION_AGENT", "RECORDS_AGENT"].includes(route)) {
    score += 16;
  }

  if (activeRoute === "CLAIMS_OPS_AGENT" && ["INSURANCE_AGENT", "UTILIZATION_AGENT", "RECORDS_AGENT"].includes(route)) {
    score += 16;
  }

  if (activeRoute === "RAG_AGENT" && ["ALERT_AGENT", "PHARMACY_AGENT", "VITALS_AGENT", "LABS_AGENT"].includes(route)) {
    score += 12;
  }

  return score;
}

function routeSupportPriority(route = "") {
  const priorities = {
    ALERT_AGENT: 120,
    SPECIALIST_DOCTOR_AGENT: 88,
    PHARMACY_AGENT: 82,
    VITALS_AGENT: 80,
    LABS_AGENT: 78,
    RAG_AGENT: 72,
    SCHEDULING_AGENT: 58,
    INSURANCE_AGENT: 56,
    CLAIMS_OPS_AGENT: 54,
    UTILIZATION_AGENT: 54,
    RECORDS_AGENT: 52,
    LIFESTYLE_AGENT: 48,
    WELLNESS_AGENT: 48,
    CARE_TRANSITIONS_AGENT: 44,
    GXP_QUALITY_AGENT: 40,
    MEDTECH_COMPLIANCE_AGENT: 40
  };

  return priorities[cleanText(route)] || 36;
}

function compareRouteOrder(leftRoute = "", rightRoute = "", activeRoutes = []) {
  const leftIndex = activeRoutes.indexOf(cleanText(leftRoute));
  const rightIndex = activeRoutes.indexOf(cleanText(rightRoute));

  if (leftIndex === -1 && rightIndex === -1) {
    return 0;
  }

  if (leftIndex === -1) {
    return 1;
  }

  if (rightIndex === -1) {
    return -1;
  }

  return leftIndex - rightIndex;
}

function mergeSpecialistReviewIntoAgent({ route = "", agent = {}, review = {}, candidate = {} } = {}) {
  const output = agent?.output || {};
  const actionKey = ROUTE_ACTION_KEYS[route] || "checklist";
  const questionKey = getPrimaryRouteQuestionKey(route);
  const summary = cleanText(review.summary || review.summary_upgrade || "").slice(0, 520);
  const patientAnswerSummary = cleanText(review.patient_answer_summary || review.patientAnswerSummary || "").slice(0, 320);
  const actionAdditions = normalizeFlexibleStringList(review.action_additions || review.step_additions, 3, 220);
  const missingQuestion = cleanText(review.missing_question || review.missingQuestion).slice(0, 220);
  const questionAdditions = dedupeItems([
    ...normalizeFlexibleStringList(review.question_additions || review.questions, 3, 220),
    ...normalizeFlexibleStringList(missingQuestion, 1, 220)
  ]).slice(0, 3);
  const warningAdditions = normalizeFlexibleStringList(review.warning_additions || review.warningSigns, 3, 220);
  const missingContext = normalizeFlexibleStringList(review.missing_context || review.missingContext, 4, 160);
  const evidenceFocus = normalizeFlexibleStringList(review.evidence_focus, 4, 180);
  const confidenceLabel = cleanText(review.confidence_label).slice(0, 80);
  const mergedActions = dedupeItems([
    ...normalizeFlexibleStringList(output?.[actionKey], 5, 220),
    ...actionAdditions,
    ...(route === "ALERT_AGENT" ? warningAdditions : [])
  ]).slice(0, 5);
  const mergedChecklist = dedupeItems([
    ...normalizeFlexibleStringList(output?.checklist, 5, 220),
    ...actionAdditions,
    ...warningAdditions
  ]).slice(0, 5);
  const mergedQuestions = questionKey
    ? dedupeItems([
        ...normalizeFlexibleStringList(output?.[questionKey], 6, 220),
        ...questionAdditions
      ]).slice(0, 6)
    : [];
  const mergedMissing = dedupeItems([
    ...collectMissingContext(output),
    ...missingContext
  ]).slice(0, 5);
  const changed = Boolean(
    (summary && summary !== cleanText(output?.summary))
    || (patientAnswerSummary && patientAnswerSummary !== cleanText(output?.patientAnswerSummary))
    || actionAdditions.length
    || questionAdditions.length
    || warningAdditions.length
    || missingContext.length
  );

  if (!changed) {
    return {
      changed: false,
      agent
    };
  }

  return {
    changed: true,
    agent: {
      ...agent,
      output: {
        ...output,
        summary: summary || cleanText(output?.summary),
        patientAnswerSummary: patientAnswerSummary || cleanText(output?.patientAnswerSummary),
        [actionKey]: mergedActions,
        ...(questionKey ? { [questionKey]: mergedQuestions } : {}),
        checklist: mergedChecklist,
        missingContext: mergedMissing,
        llmAgentAssist: {
          enabled: true,
          attempted: true,
          applied: true,
          provider: candidate.displayName || candidate.provider || "Specialist LLM",
          model: cleanText(candidate.model),
          endpointHost: cleanText(candidate.endpointHost),
          route,
          source: cleanText(candidate.source),
          confidenceLabel,
          evidenceFocus,
          warningAdditions,
          missingContext: mergedMissing
        },
        performance: {
          ...(output?.performance || {}),
          deterministic: false,
          llmBacked: true,
          llmProvider: candidate.displayName || candidate.provider || "Specialist LLM",
          llmModel: cleanText(candidate.model)
        }
      }
    }
  };
}

function validateSpecialistReview({ route = "", review = {}, agent = {} } = {}) {
  const output = agent?.output || {};
  const summary = cleanText(review.summary || review.summary_upgrade || "").slice(0, 520);
  const patientAnswerSummary = cleanText(review.patient_answer_summary || review.patientAnswerSummary || "").slice(0, 320);
  const actionAdditions = normalizeFlexibleStringList(review.action_additions || review.step_additions, 3, 220);
  const missingQuestion = cleanText(review.missing_question || review.missingQuestion).slice(0, 220);
  const questionAdditions = dedupeItems([
    ...normalizeFlexibleStringList(review.question_additions || review.questions, 3, 220),
    ...normalizeFlexibleStringList(missingQuestion, 1, 220)
  ]).slice(0, 3);
  const warningAdditions = normalizeFlexibleStringList(review.warning_additions || review.warningSigns, 3, 220);
  const missingContext = normalizeFlexibleStringList(review.missing_context || review.missingContext, 4, 160);
  const reviewText = [
    summary,
    patientAnswerSummary,
    ...actionAdditions,
    ...questionAdditions,
    ...warningAdditions,
    ...missingContext
  ].filter(Boolean).join(" ");

  if (!reviewText) {
    throw new Error(`${routeLabel(route)} assist returned no usable grounded content.`);
  }

  if (hasUnsafeSpecialistContent(reviewText)) {
    throw new Error(`${routeLabel(route)} assist proposed content outside the safety boundary.`);
  }

  if (summary && summary === cleanText(output?.summary) && !actionAdditions.length && !questionAdditions.length && !warningAdditions.length && !missingContext.length) {
    return;
  }
}

function hasUnsafeSpecialistContent(value) {
  const text = cleanText(value);

  if (!text) {
    return false;
  }

  return [
    /\b(start|take|use|give|increase|decrease|double|stop|begin|prescribe)\b[^.]{0,40}\b\d+(?:\.\d+)?\s?(?:mg|mcg|g|kg|ml|units?|tablets?|capsules?|drops?)\b/i,
    /\byou (?:have|likely have|probably have|definitely have)\b/i,
    /\bthis (?:is|looks like|seems like)\b/i,
    /\bapprove(?:d)?\b[^.]{0,40}\b(?:claim|coverage|authorization|payment)\b/i,
    /\bdeny\b[^.]{0,40}\b(?:claim|coverage|authorization|payment)\b/i,
    /\bauthori[sz]e\b[^.]{0,40}\b(?:claim|coverage|treatment|payment)\b/i,
    /\brelease\b[^.]{0,40}\b(?:batch|product|lot)\b/i,
    /\bsubmit\b[^.]{0,40}\b(?:510\(k\)|fda|regulatory|capa|change control)\b/i
  ].some((pattern) => pattern.test(text));
}

function buildHeaders(env, candidate = {}) {
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json; charset=utf-8"
  };
  const apiKey = cleanText(
    candidate.apiKey
      || env.CARE_NOVA_SPECIALIST_LLM_API_KEY
      || env.CARE_NOVA_TEMP_CLOUD_API_KEY
      || env.OPENAI_API_KEY
      || env.DEEPSEEK_API_KEY
      || env.LOCAL_LLM_API_KEY
      || env.CARE_NOVA_LLM_API_KEY
  );
  const apiKeyHeader = cleanText(
    candidate.apiKeyHeader
      || env.CARE_NOVA_SPECIALIST_LLM_API_KEY_HEADER
      || env.CARE_NOVA_LOCAL_REASONING_API_KEY_HEADER
  );
  const authScheme = cleanText(
    candidate.authScheme
      || env.CARE_NOVA_SPECIALIST_LLM_API_AUTH_SCHEME
      || env.CARE_NOVA_LOCAL_REASONING_API_AUTH_SCHEME
      || "Bearer"
  );

  if (apiKey && apiKeyHeader) {
    headers[apiKeyHeader] = apiKey;
  } else if (apiKey) {
    headers.Authorization = `${authScheme} ${apiKey}`.trim();
  }

  return headers;
}

function toOllamaChatEndpoint(endpoint) {
  try {
    const parsed = new URL(normalizeChatCompletionsEndpoint(endpoint));
    return `${parsed.origin}/api/chat`;
  } catch {
    return endpoint;
  }
}

function collectMissingContext(output = {}) {
  return dedupeItems([
    ...normalizeFlexibleStringList(output?.missingContext, 4, 160),
    ...normalizeFlexibleStringList(output?.missing, 4, 160)
  ]).slice(0, 4);
}

function normalizeVitalsPacket(vitals = {}) {
  const source = vitals && typeof vitals === "object" ? vitals : {};
  const allowed = ["systolic", "diastolic", "bloodSugar", "heartRate", "temperatureC", "oxygenSaturation", "weightKg", "heightCm"];
  return Object.fromEntries(
    Object.entries(source)
      .filter(([key, value]) => allowed.includes(key) && value !== null && value !== undefined && cleanText(value))
      .slice(0, 8)
  );
}

function routeLabel(route) {
  return {
    RAG_AGENT: "General Health Intelligence",
    SPECIALIST_DOCTOR_AGENT: "Specialist Doctor",
    VITALS_AGENT: "Vital Specialist Review",
    PHARMACY_AGENT: "Medication Safety",
    SCHEDULING_AGENT: "Appointment Booking",
    ALERT_AGENT: "Safety Measures",
    LABS_AGENT: "Lab Report",
    LIFESTYLE_AGENT: "Lifestyle Guide",
    WELLNESS_AGENT: "Mental Wellness",
    RECORDS_AGENT: "Health Records",
    INSURANCE_AGENT: "Insurance Support",
    CARE_TRANSITIONS_AGENT: "Discharge Transitions",
    CLAIMS_OPS_AGENT: "Claims Operations",
    UTILIZATION_AGENT: "Prior Authorization",
    GXP_QUALITY_AGENT: "GxP Quality",
    MEDTECH_COMPLIANCE_AGENT: "MedTech Compliance"
  }[route] || cleanText(route || "Specialist Agent");
}

function routeBoundary(route) {
  return ROUTE_BOUNDARIES[route] || "Grounded drafting only. Keep the deterministic safety boundary intact.";
}

function getPrimaryRouteQuestionKey(route = "") {
  const questionKeys = ROUTE_QUESTION_KEYS[route] || [];
  return questionKeys[0] || "";
}

function dedupeItems(items = []) {
  return Array.from(new Set((items || []).map((item) => cleanText(item)).filter(Boolean)));
}

function normalizeFlexibleStringList(value, limit, maxLength) {
  if (Array.isArray(value)) {
    return normalizeStringList(value, limit, maxLength);
  }

  if (typeof value === "string") {
    return normalizeStringList([value], limit, maxLength);
  }

  return [];
}

function normalizeStringList(value, limit, maxLength) {
  if (!Array.isArray(value)) {
    return [];
  }

  return dedupeItems(
    value.map((item) => cleanText(item).slice(0, maxLength))
  ).slice(0, limit);
}

function extractResponseText(payload) {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const ollamaMessage = payload.message?.content;

  if (typeof ollamaMessage === "string") {
    return ollamaMessage;
  }

  if (Array.isArray(ollamaMessage)) {
    return ollamaMessage
      .map((entry) => cleanText(entry?.text || entry?.content || ""))
      .filter(Boolean)
      .join("\n");
  }

  const message = payload.choices?.[0]?.message?.content;

  if (typeof message === "string") {
    return message;
  }

  if (Array.isArray(message)) {
    return message
      .map((entry) => cleanText(entry?.text || entry?.content || ""))
      .filter(Boolean)
      .join("\n");
  }

  if (typeof payload.output_text === "string") {
    return payload.output_text;
  }

  return cleanText(payload.choices?.[0]?.text || "");
}

function parseJsonObject(text) {
  const source = String(text || "").trim();

  if (!source) {
    return null;
  }

  try {
    return JSON.parse(source);
  } catch {
    const start = source.indexOf("{");
    const end = source.lastIndexOf("}");

    if (start === -1 || end <= start) {
      return null;
    }

    try {
      return JSON.parse(source.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function safeHost(value) {
  const text = cleanText(value);

  if (!text) {
    return "";
  }

  try {
    return new URL(text).host || text;
  } catch {
    return text.replace(/\/.*$/, "");
  }
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(cleanText(value), 10);
  const number = Number.isInteger(parsed) ? parsed : fallback;
  return Math.min(max, Math.max(min, number));
}

function readBoolean(value) {
  return /^(1|true|yes|on)$/i.test(cleanText(value));
}

function readBooleanDefault(value, defaultValue = false) {
  const cleaned = cleanText(value);

  if (!cleaned) {
    return defaultValue;
  }

  return /^(1|true|yes|on)$/i.test(cleaned);
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
