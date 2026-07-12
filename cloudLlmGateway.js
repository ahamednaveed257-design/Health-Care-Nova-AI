import { evaluateFinalResponseGuardrails, refreshEnhancedFinalResponse } from "./healthEngine.js";
import { getLocalRuntimeProbeSnapshot } from "./openSourceLocalRuntime.js";
import { getConnectivityPolicy, isEndpointUsableForThisRun, isLocalEndpoint } from "./runtimeConnectivity.js";

const DEFAULT_OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_SUPPORT_AGENT_PACKET_LIMIT = 4;
const ROUTE_ACTION_KEYS = {
  RAG_AGENT: ["safeActions", "checklist"],
  SPECIALIST_DOCTOR_AGENT: ["specialistActions", "checklist"],
  VITALS_AGENT: ["vitalActions", "checklist"],
  PHARMACY_AGENT: ["pharmacyActions", "nextSafeSteps", "checklist"],
  LABS_AGENT: ["labActions", "checklist"],
  LIFESTYLE_AGENT: ["lifestyleActions", "checklist"],
  WELLNESS_AGENT: ["supportPlan"],
  RECORDS_AGENT: ["nextActions", "checklist"],
  INSURANCE_AGENT: ["checklist"],
  SCHEDULING_AGENT: ["visitActions", "checklist"],
  ALERT_AGENT: ["safetyActions", "checklist"],
  CARE_TRANSITIONS_AGENT: ["checklist"],
  CLAIMS_OPS_AGENT: ["checklist"],
  UTILIZATION_AGENT: ["checklist"],
  GXP_QUALITY_AGENT: ["checklist"],
  MEDTECH_COMPLIANCE_AGENT: ["checklist"]
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
const ROUTE_MISSING_KEYS = {
  RAG_AGENT: ["missingContext", "missing"],
  SPECIALIST_DOCTOR_AGENT: ["specialistProfile.missingContext", "missing"],
  VITALS_AGENT: ["accuracyGaps", "missing"],
  PHARMACY_AGENT: ["reviewGaps", "missing"],
  LABS_AGENT: ["accuracyGaps", "missing"],
  LIFESTYLE_AGENT: ["missing"],
  WELLNESS_AGENT: ["missing"],
  RECORDS_AGENT: ["missingFields"],
  INSURANCE_AGENT: ["documentGaps.missing", "missing"],
  SCHEDULING_AGENT: ["readinessGaps", "missing"],
  ALERT_AGENT: ["missing"],
  CARE_TRANSITIONS_AGENT: ["missingFields", "missing"],
  CLAIMS_OPS_AGENT: ["missingFields", "missing"],
  UTILIZATION_AGENT: ["missingFields", "missing"],
  GXP_QUALITY_AGENT: ["missingFields", "missing"],
  MEDTECH_COMPLIANCE_AGENT: ["missingFields", "missing"]
};

export function getTemporaryCloudLlmStatus(env = process.env) {
  const allModelsEnabled = readBoolean(env.CARE_NOVA_ENABLE_ALL_MODELS);
  const provider = cleanText(env.CARE_NOVA_TEMP_CLOUD_PROVIDER || ((readBoolean(env.CARE_NOVA_OPENAI_ENABLED) || allModelsEnabled) ? "openai" : "openai-compatible")) || "openai-compatible";
  const paidCloudAllowed = allModelsEnabled || readBoolean(env.CARE_NOVA_PAID_MODELS_ENABLED) || readBoolean(env.CARE_NOVA_CLOUD_MODELS_ENABLED);
  const explicitRewriteEnabled = readBoolean(env.CARE_NOVA_TEMP_CLOUD_RESPONSE_ENABLED);
  const providerEnabled = (allModelsEnabled || readBoolean(env.CARE_NOVA_OPENAI_ENABLED)) && paidCloudAllowed;
  const requested = explicitRewriteEnabled || providerEnabled;
  const demoLocalEndpoint = resolveLocalDemoCloudEndpoint(env);
  const apiKey = cleanText(env.CARE_NOVA_TEMP_CLOUD_API_KEY || env.OPENAI_API_KEY);
  const configuredEndpoint = normalizeChatCompletionsEndpoint(
    env.CARE_NOVA_TEMP_CLOUD_API_URL
      || env.OPENAI_BASE_URL
      || ""
  );
  const configuredModel = cleanText(env.CARE_NOVA_TEMP_CLOUD_MODEL || env.OPENAI_MODEL || "");
  const useLocalDemoFallback = Boolean(
    allModelsEnabled
    && !explicitRewriteEnabled
    && !apiKey
    && demoLocalEndpoint
    && (!configuredEndpoint || configuredEndpoint === DEFAULT_OPENAI_CHAT_COMPLETIONS_URL)
  );
  const model = useLocalDemoFallback
    ? resolveLocalDemoCloudModel(env)
    : cleanText(configuredModel || "gpt-5.4");
  const endpoint = normalizeChatCompletionsEndpoint(
    useLocalDemoFallback
      ? demoLocalEndpoint
      : configuredEndpoint
        || (provider === "openai" || provider === "openai-compatible" ? DEFAULT_OPENAI_CHAT_COMPLETIONS_URL : "")
  );
  const connectivity = getConnectivityPolicy(env);
  const endpointIsLocal = Boolean(endpoint) && isLocalEndpoint(endpoint);
  const compatibilityRuntimeDetected = endpointIsLocal && isMockLocalRuntimeEndpoint(endpoint);
  const policyBlocked = requested && Boolean(endpoint) && !isEndpointUsableForThisRun(endpoint, env, { connectivity });
  const enabled = requested && !policyBlocked;
  const timeoutMs = clampInteger(env.CARE_NOVA_TEMP_CLOUD_TIMEOUT_MS, 2000, 30000, DEFAULT_TIMEOUT_MS);
  const keyRequired = Boolean(endpoint) && !endpointIsLocal;
  const configured = enabled && Boolean(model) && Boolean(endpoint) && (!keyRequired || Boolean(apiKey)) && !compatibilityRuntimeDetected;
  const reason = !requested
    ? "Temporary cloud rewrite is disabled."
    : policyBlocked
      ? connectivity.forceOffline
        ? "Temporary cloud rewrite is configured but blocked by offline policy."
        : "Temporary cloud rewrite is configured but internet is unavailable."
      : compatibilityRuntimeDetected
        ? "Temporary cloud rewrite is pointed at the localhost compatibility adapter. A native runtime or real cloud endpoint is required before this second pass can run."
      : keyRequired && !apiKey
        ? "API key is missing for the remote provider."
        : !model
          ? "Model is missing."
          : !endpoint
            ? "Endpoint is missing."
            : endpointIsLocal
              ? explicitRewriteEnabled
                ? "Temporary cloud rewrite is ready on a local OpenAI-compatible endpoint."
                : "OpenAI cloud second pass is ready on a local OpenAI-compatible endpoint."
              : explicitRewriteEnabled
                ? "Temporary cloud rewrite is ready."
                : "OpenAI cloud second pass is ready when the router selects a cloud or hybrid path.";

  return {
    enabled,
    requested,
    providerEnabled,
    explicitRewriteEnabled,
    configured,
    policyBlocked,
    compatibilityRuntimeDetected,
    provider,
    model,
    endpoint,
    endpointIsLocal,
    endpointHost: endpoint ? safeHost(endpoint) : "",
    timeoutMs,
    status: !enabled
      ? policyBlocked
        ? "offline-policy-blocked"
        : "disabled"
      : configured
        ? "ready"
        : compatibilityRuntimeDetected
          ? "compatibility-runtime-detected"
        : "missing-configuration",
    connectivity: {
      forceOffline: connectivity.forceOffline,
      internetAvailable: connectivity.internetAvailable
    },
    activationPolicy: explicitRewriteEnabled
      ? "always-on-final-rewrite"
      : providerEnabled
        ? "router-driven-cloud-second-pass"
        : "disabled",
    usesDeidentifiedResponseOnly: true,
    fallback: "default-local-final-response",
    reason
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

function isMockLocalRuntimeEndpoint(endpoint) {
  const normalized = cleanText(normalizeChatCompletionsEndpoint(endpoint));

  if (!normalized) {
    return false;
  }

  return getLocalRuntimeProbeSnapshot()?.endpoints?.[normalized]?.mockRuntime === true;
}

export async function tryEnhanceAnalyzeResultWithCloudLlm({ payload = {}, result = {}, env = process.env } = {}) {
  const status = getTemporaryCloudLlmStatus(env);
  const executionPlan = buildCloudExecutionPlan({ status, result });
  const execution = {
    ...status,
    ...executionPlan,
    attempted: false,
    applied: false,
    fallbackUsed: true,
    actualProcessingType: "local",
    actualGeneratedUsing: "Local Model",
    error: ""
  };

  reconcileActualExecution(result, execution);

  if (!status.enabled || !status.configured || !result?.finalResponse || !execution.requestedForThisRun) {
    return execution;
  }

  execution.attempted = true;

  try {
    const cloudDraft = await requestCloudAssist({ payload, result, status, execution, env });
    const merged = mergeCloudDraftIntoResult({ result, draft: cloudDraft, status, execution });
    const refreshedResult = {
      ...result,
      finalResponse: merged.finalResponse,
      agentResults: merged.agentResults
    };

    refreshEnhancedFinalResponse({ result: refreshedResult });
    const guardrails = evaluateFinalResponseGuardrails(refreshedResult.finalResponse);

    if (!guardrails.passed) {
      throw new Error("Cloud second pass failed local safety guardrails.");
    }

    result.finalResponse = refreshedResult.finalResponse;
    result.agentResults = refreshedResult.agentResults;
    result.guardrails = guardrails;
    execution.applied = true;
    execution.fallbackUsed = false;
    execution.actualProcessingType = "hybrid";
    execution.actualGeneratedUsing = "Hybrid Processing";
    reconcileActualExecution(result, execution);
    return execution;
  } catch (error) {
    execution.error = cleanText(error.message).slice(0, 240);
    reconcileActualExecution(result, execution);

    if (result?.finalResponse) {
      result.finalResponse = {
        ...result.finalResponse,
        processingMode: "Local Model",
        cloudLlm: {
          enabled: true,
          attempted: true,
          applied: false,
          provider: status.provider,
          model: status.model,
          endpointHost: status.endpointHost,
          engagementMode: execution.engagementMode,
          requestedForThisRun: execution.requestedForThisRun,
          fallbackUsed: true,
          error: execution.error,
          usesDeidentifiedResponseOnly: status.usesDeidentifiedResponseOnly
        }
      };
    }

    return execution;
  }
}

function buildCloudExecutionPlan({ status = {}, result = {} } = {}) {
  const plannedProcessingType = cleanText(result?.modelRouting?.processingType || "local").toLowerCase() || "local";
  const plannedPrimary = result?.modelRouting?.selectedModel?.primary || null;
  const plannedPrimaryType = cleanText(plannedPrimary?.type).toLowerCase();
  const plannedPrimaryId = cleanText(plannedPrimary?.id).toLowerCase();
  const plannedPrimaryModelName = cleanText(plannedPrimary?.displayName || plannedPrimary?.model || "");
  const plannedByRouter = plannedPrimaryType === "cloud" && (plannedProcessingType === "cloud" || plannedProcessingType === "hybrid");
  const gatewayMatchesPlan = !plannedByRouter
    || plannedPrimaryId === "openai"
    || plannedPrimaryId === "azure-openai"
    || /openai/i.test(cleanText(status.provider));
  const requestedForThisRun = Boolean(status.explicitRewriteEnabled || (plannedByRouter && gatewayMatchesPlan));
  const engagementMode = plannedByRouter && gatewayMatchesPlan
    ? "route-aware-clinical-second-pass"
    : "final-response-rewrite";
  const skipReason = requestedForThisRun
    ? ""
    : plannedByRouter && !gatewayMatchesPlan
      ? "A non-OpenAI cloud provider was selected for this request, so the OpenAI gateway stayed idle."
      : !status.enabled
        ? status.reason || "OpenAI cloud path is disabled for this run."
        : !status.configured
          ? status.reason || "OpenAI cloud path is not configured for this run."
          : "OpenAI cloud path is ready but this request stayed on the local route.";

  return {
    engagementMode,
    plannedByRouter,
    plannedProcessingType,
    plannedPrimaryModelId: plannedPrimaryId,
    plannedPrimaryModelName,
    requestedForThisRun,
    skipReason
  };
}

async function requestCloudAssist({ payload, result, status, execution, env }) {
  const request = buildCloudRequest({ payload, result, execution });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), status.timeoutMs);

  try {
    const response = await fetch(status.endpoint, {
      method: "POST",
      headers: buildHeaders(status, env),
      body: JSON.stringify({
        model: status.model,
        temperature: request.temperature,
        max_tokens: request.maxTokens,
        messages: request.messages
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Cloud LLM returned ${response.status}.`);
    }

    const json = await response.json();
    const text = extractResponseText(json);

    if (!text) {
      throw new Error("Cloud LLM returned an empty response.");
    }

    const parsed = parseJsonObject(text);

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Cloud LLM did not return valid JSON.");
    }

    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

function buildCloudRequest({ payload = {}, result = {}, execution = {} } = {}) {
  return execution.engagementMode === "route-aware-clinical-second-pass"
    ? {
      temperature: 0.15,
      maxTokens: 520,
      messages: buildRouteAwareMessages({ payload, result })
    }
    : {
      temperature: 0.2,
      maxTokens: 380,
      messages: buildRewriteMessages({ payload, result })
    };
}

function buildRewriteMessages({ payload = {}, result = {} }) {
  const finalResponse = result.finalResponse || {};
  const packet = {
    route: cleanText(finalResponse?.responseFocus?.primaryRoute || result?.plan?.responseOwner?.route || "RAG_AGENT"),
    risk: cleanText(result?.risk?.label || result?.risk?.level || "LOW"),
    answerMode: cleanText(result?.requirementProfile?.answerMode?.id || finalResponse?.responseFocus?.requirement?.answerMode || "quick"),
    localTitle: cleanText(finalResponse.title).slice(0, 140),
    localSummary: cleanText(finalResponse.summary).slice(0, 500),
    localSteps: Array.isArray(finalResponse.whatToDoNow) ? finalResponse.whatToDoNow.map((item) => cleanText(item).slice(0, 220)).filter(Boolean).slice(0, 4) : [],
    localWarnings: Array.isArray(finalResponse.warningSigns) ? finalResponse.warningSigns.map((item) => cleanText(item).slice(0, 220)).filter(Boolean).slice(0, 4) : [],
    disclaimer: cleanText(finalResponse.disclaimer).slice(0, 220),
    agentSummary: cleanText(finalResponse.agentSummary).slice(0, 700)
  };

  return [
    {
      role: "system",
      content: [
        "You rewrite a healthcare support response for clarity only.",
        "Use only the facts in the provided JSON.",
        "Do not add diagnoses, prescriptions, dosages, or new medical claims.",
        "Preserve urgency and safety wording.",
        "Return strict JSON with keys: title, summary, whatToDoNow, warningSigns."
      ].join(" ")
    },
    {
      role: "user",
      content: `Rewrite this local response in the same meaning with shorter, cleaner wording.\n${JSON.stringify(packet)}`
    }
  ];
}

function buildRouteAwareMessages({ payload = {}, result = {} }) {
  const finalResponse = result.finalResponse || {};
  const primaryRoute = cleanText(finalResponse?.responseFocus?.primaryRoute || result?.plan?.responseOwner?.route || "RAG_AGENT");
  const primaryAgent = Array.isArray(result.agentResults)
    ? result.agentResults.find((agent) => agent.id === primaryRoute) || result.agentResults[0]
    : null;
  const supportAgents = buildSupportAgentPacket(result.agentResults, primaryRoute, {
    risk: result?.risk,
    plan: result?.plan,
    limit: DEFAULT_SUPPORT_AGENT_PACKET_LIMIT
  });
  const profile = result.memoryContext?.profile || payload.profile || {};
  const latestVitals = result.memoryContext?.latestVitals || payload.vitals || {};
  const evidence = Array.isArray(result.medicalKnowledge?.matches)
    ? result.medicalKnowledge.matches.slice(0, 5).map((match) => ({
      title: cleanText(match.title).slice(0, 120),
      category: cleanText(match.category).slice(0, 60),
      summary: cleanText(match.summary).slice(0, 240),
      safetyNotes: cleanText(match.safetyNotes).slice(0, 180),
      relevance: Number(match.relevance || 0)
    }))
    : [];
  const packet = {
    route: primaryRoute,
    risk: cleanText(result?.risk?.label || result?.risk?.level || "LOW"),
    answerMode: cleanText(result?.requirementProfile?.answerMode?.id || finalResponse?.responseFocus?.requirement?.answerMode || "quick"),
    message: cleanText(payload.message || "").slice(0, 320),
    routing: {
      responseOwner: cleanText(result?.plan?.responseOwner?.route),
      singleAgent: cleanText(result?.plan?.singleAgent?.route),
      activeRoutes: Array.isArray(result?.plan?.execute) ? result.plan.execute.map((route) => cleanText(route)).filter(Boolean).slice(0, 5) : [],
      routeReasons: normalizeStringList(result?.plan?.routeReasons?.[primaryRoute], 4, 180),
      processingMode: cleanText(result?.modelRouting?.generatedUsing || result?.modelRouting?.processingType || ""),
      primaryModel: cleanText(result?.modelRouting?.selectedModel?.primary?.displayName || result?.modelRouting?.selectedModel?.primary?.model || "")
    },
    context: {
      vitals: normalizeVitalsPacket(latestVitals),
      profile: {
        age: cleanText(profile.age).slice(0, 24),
        gender: cleanText(profile.gender).slice(0, 40),
        conditions: normalizeStringList(toArray(profile.conditions), 4, 80),
        medications: normalizeStringList(toArray(profile.medications), 4, 80),
        allergies: normalizeStringList(toArray(profile.allergies), 4, 80)
      },
      memory: {
        recentTurns: Number(result.memoryContext?.recentTurnCount || 0),
        recentRisks: normalizeStringList(result.memoryContext?.recentRisks, 3, 40),
        recentMessages: normalizeStringList(result.memoryContext?.recentMessages, 2, 120)
      }
    },
    precision: {
      confidence: Number(finalResponse?.precision?.confidence || finalResponse?.precision?.score || 0),
      missing: normalizeStringList(finalResponse?.precision?.missing, 4, 160),
      confidenceLabel: cleanText(finalResponse?.precision?.confidenceLabel || finalResponse?.precision?.label || "")
    },
    evidence,
    primaryAgent: primaryAgent
      ? {
        id: primaryAgent.id,
        name: cleanText(primaryAgent.name),
        summary: cleanText(primaryAgent.output?.summary || "").slice(0, 360),
        patientAnswerSummary: cleanText(primaryAgent.output?.patientAnswerSummary || "").slice(0, 260),
        actions: collectAgentActionItems(primaryAgent.output || {}),
        questions: collectAgentQuestionItems(primaryRoute, primaryAgent.output || {}),
        checklist: normalizeStringList(primaryAgent.output?.checklist, 4, 180),
        missing: collectAgentMissingItems(primaryAgent.output || {})
      }
      : null,
    supportAgents,
    localAnswer: {
      title: cleanText(finalResponse.title).slice(0, 140),
      summary: cleanText(finalResponse.summary).slice(0, 520),
      steps: normalizeStringList(finalResponse.whatToDoNow, 4, 220),
      warnings: normalizeStringList(finalResponse.warningSigns, 4, 220),
      disclaimer: cleanText(finalResponse.disclaimer).slice(0, 220)
    }
  };

  return [
    {
      role: "system",
      content: [
        "You are the paid cloud reasoning layer for a local-first healthcare support system.",
        "Improve the grounded local answer only from the supplied JSON packet.",
        "Use support-route context only when it strengthens the same grounded answer.",
        "Do not add diagnoses, prescriptions, dosages, new medical claims, or emergency actions.",
        "Preserve urgent safety wording, uncertainty, and local evidence boundaries.",
        "Return strict JSON with keys:",
        "title, summary, whatToDoNow, warningSigns, doctorQuestion, missingContext, evidenceFocus, confidenceLabel, supportRouteUpdates.",
        "supportRouteUpdates is optional, must use only routes already listed in supportAgents, and can contain up to 2 entries with route, summary, patientAnswerSummary, actionAdditions, questionAdditions, missingContext, evidenceFocus, confidenceLabel."
      ].join(" ")
    },
    {
      role: "user",
      content: `Strengthen this routed care answer without changing its medical boundary.\n${JSON.stringify(packet)}`
    }
  ];
}

function buildSupportAgentPacket(agentResults = [], primaryRoute = "", options = {}) {
  const limit = Math.max(1, Number(options?.limit || DEFAULT_SUPPORT_AGENT_PACKET_LIMIT) || DEFAULT_SUPPORT_AGENT_PACKET_LIMIT);
  const activeRoutes = Array.isArray(options?.plan?.execute)
    ? options.plan.execute.map((route) => cleanText(route)).filter(Boolean)
    : [];
  const riskLevel = cleanText(options?.risk?.level || options?.risk?.label || "");

  return (Array.isArray(agentResults) ? agentResults : [])
    .filter((agent) => cleanText(agent?.id) && cleanText(agent?.id) !== primaryRoute)
    .map((agent) => {
      const output = agent?.output || {};
      const route = cleanText(agent?.id);
      const actions = collectAgentActionItems(output);
      const questions = collectAgentQuestionItems(agent?.id, output);
      const missing = collectAgentMissingItems(output);

      return {
        id: route,
        name: cleanText(agent?.name),
        summary: cleanText(output?.summary || "").slice(0, 260),
        patientAnswerSummary: cleanText(output?.patientAnswerSummary || "").slice(0, 220),
        actions,
        questions,
        missing,
        priorityScore: scoreSupportAgentPacketCandidate({
          route,
          primaryRoute,
          riskLevel,
          activeRoutes,
          actions,
          questions,
          missing
        }),
        confidenceLabel: cleanText(output?.reasoning?.label || output?.confidenceLabel || "").slice(0, 80)
      };
    })
    .sort((left, right) => (
      Number(right.priorityScore || 0) - Number(left.priorityScore || 0)
      || compareRouteOrder(left.id, right.id, activeRoutes)
    ))
    .slice(0, limit)
    .map(({ priorityScore, ...packet }) => packet);
}

function scoreSupportAgentPacketCandidate({
  route = "",
  primaryRoute = "",
  riskLevel = "",
  activeRoutes = [],
  actions = [],
  questions = [],
  missing = []
} = {}) {
  let score = routeSupportPriority(route);
  const routeIndex = activeRoutes.indexOf(route);
  const normalizedRisk = cleanText(riskLevel).toUpperCase();

  if (routeIndex >= 0) {
    score += Math.max(0, 24 - routeIndex * 3);
  }

  score += Math.min(actions.length, 3) * 8;
  score += Math.min(questions.length, 3) * 7;
  score += Math.min(missing.length, 3) * 6;

  if (route === "ALERT_AGENT" && (normalizedRisk === "HIGH" || normalizedRisk === "CRITICAL")) {
    score += 80;
  }

  if (primaryRoute === "SPECIALIST_DOCTOR_AGENT" && ["PHARMACY_AGENT", "LABS_AGENT", "VITALS_AGENT", "ALERT_AGENT"].includes(route)) {
    score += 18;
  }

  if (primaryRoute === "PHARMACY_AGENT" && ["VITALS_AGENT", "ALERT_AGENT", "SPECIALIST_DOCTOR_AGENT"].includes(route)) {
    score += 15;
  }

  if (primaryRoute === "LABS_AGENT" && ["SPECIALIST_DOCTOR_AGENT", "PHARMACY_AGENT", "ALERT_AGENT"].includes(route)) {
    score += 15;
  }

  if (primaryRoute === "RAG_AGENT" && ["ALERT_AGENT", "PHARMACY_AGENT", "VITALS_AGENT", "LABS_AGENT"].includes(route)) {
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
    SCHEDULING_AGENT: 58,
    RECORDS_AGENT: 54,
    INSURANCE_AGENT: 52,
    LIFESTYLE_AGENT: 48,
    WELLNESS_AGENT: 48,
    CARE_TRANSITIONS_AGENT: 44,
    CLAIMS_OPS_AGENT: 44,
    UTILIZATION_AGENT: 44,
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

function collectAgentActionItems(output = {}) {
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
    actionKeys.flatMap((key) => normalizeStringList(output?.[key], 2, 180))
  ).slice(0, 3);
}

function collectAgentQuestionItems(route = "", output = {}) {
  const routeKey = cleanText(route);
  const keys = Array.from(new Set([
    ...(ROUTE_QUESTION_KEYS[routeKey] || []),
    "doctorQuestions",
    "clinicianQuestions",
    "pharmacistQuestions",
    "benefitQuestions",
    "focusQuestions"
  ]));

  return dedupeItems(
    keys.flatMap((key) => normalizeStringList(output?.[key], 2, 180))
  ).slice(0, 3);
}

function collectAgentMissingItems(output = {}) {
  return dedupeItems([
    ...normalizeStringList(output?.missingContext, 2, 140),
    ...normalizeStringList(output?.missing, 2, 140),
    ...normalizeStringList(output?.accuracyGaps, 2, 140),
    ...normalizeStringList(output?.reviewGaps, 2, 140),
    ...normalizeStringList(output?.documentGaps?.missing, 2, 140),
    ...normalizeStringList(output?.specialistProfile?.missingContext, 2, 140),
    ...normalizeStringList(output?.structuredExtraction?.missingFields, 2, 140),
    ...normalizeStringList(output?.missingFields, 2, 140),
    ...normalizeStringList(output?.readinessGaps, 2, 140)
  ]).slice(0, 3);
}

function normalizeSupportRouteUpdates(value, limit = 2) {
  const entries = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? Object.entries(value).map(([route, update]) => ({
        route,
        ...(update && typeof update === "object" ? update : {})
      }))
      : [];

  return entries
    .map((entry) => normalizeSupportRouteUpdate(entry))
    .filter(Boolean)
    .slice(0, limit);
}

function normalizeSupportRouteUpdate(entry = {}) {
  const route = cleanText(entry?.route || entry?.id || entry?.agent || "");

  if (!route) {
    return null;
  }

  const questionItems = dedupeItems([
    ...normalizeStringList(entry?.questionAdditions || entry?.question_additions || entry?.questions, 3, 220),
    cleanText(entry?.question || entry?.doctorQuestion || entry?.doctor_question || "").slice(0, 220)
  ]).slice(0, 3);

  return {
    route,
    summary: cleanText(entry?.summary || entry?.summary_upgrade || "").slice(0, 360),
    patientAnswerSummary: cleanText(entry?.patientAnswerSummary || entry?.patient_answer_summary || "").slice(0, 260),
    actionItems: normalizeStringList(entry?.actionAdditions || entry?.action_additions || entry?.step_additions || entry?.actions, 3, 220),
    questionItems,
    missingContext: normalizeStringList(entry?.missingContext || entry?.missing_context, 3, 160),
    evidenceFocus: normalizeStringList(entry?.evidenceFocus || entry?.evidence_focus, 3, 180),
    confidenceLabel: cleanText(entry?.confidenceLabel || entry?.confidence_label || "").slice(0, 80)
  };
}

function mergeCloudDraftIntoResult({ result = {}, draft = {}, status = {}, execution = {} } = {}) {
  const finalResponse = result.finalResponse || {};
  const engagementMode = execution.engagementMode || "final-response-rewrite";
  const title = cleanText(draft.title || draft.title_upgrade).slice(0, 140) || cleanText(finalResponse.title);
  const summary = cleanText(draft.summary || draft.summary_upgrade).slice(0, 520) || cleanText(finalResponse.summary);
  const stepItems = normalizeStringList(draft.whatToDoNow || draft.steps || draft.step_additions, 4, 220);
  const warningItems = normalizeStringList(draft.warningSigns || draft.watchFor || draft.redFlags || draft.warning_additions, 4, 220);
  const missingContext = normalizeStringList(draft.missingContext || draft.missing_context, 4, 160);
  const evidenceFocus = normalizeStringList(draft.evidenceFocus || draft.evidence_focus, 4, 180);
  const doctorQuestion = cleanText(draft.doctorQuestion || draft.doctor_question || draft.missing_question).slice(0, 220);
  const confidenceLabel = cleanText(draft.confidenceLabel || draft.confidence_label).slice(0, 80);
  const supportRouteUpdates = normalizeSupportRouteUpdates(draft.supportRouteUpdates || draft.support_route_updates);
  const whatToDoNow = engagementMode === "route-aware-clinical-second-pass"
    ? dedupeItems([
      ...(Array.isArray(finalResponse.whatToDoNow) ? finalResponse.whatToDoNow : []),
      ...stepItems
    ]).slice(0, 5)
    : stepItems.length
      ? stepItems
      : (Array.isArray(finalResponse.whatToDoNow) ? finalResponse.whatToDoNow : []);
  const warningSigns = engagementMode === "route-aware-clinical-second-pass"
    ? dedupeItems([
      ...(Array.isArray(finalResponse.warningSigns) ? finalResponse.warningSigns : []),
      ...warningItems
    ]).slice(0, 5)
    : warningItems.length
      ? warningItems
      : (Array.isArray(finalResponse.warningSigns) ? finalResponse.warningSigns : []);
  const mergedFinalResponse = {
    ...finalResponse,
    title: title || finalResponse.title,
    summary: summary || finalResponse.summary,
    whatToDoNow,
    warningSigns,
    disclaimer: cleanText(finalResponse.disclaimer) || "This is not a diagnosis or prescription. Use a clinician for personal medical decisions.",
    processingMode: "Hybrid Processing",
    cloudLlm: {
      enabled: true,
      attempted: true,
      applied: true,
      provider: status.provider,
      model: status.model,
      endpointHost: status.endpointHost,
      engagementMode,
      requestedForThisRun: execution.requestedForThisRun,
      plannedByRouter: execution.plannedByRouter,
      evidenceFocus,
      missingContext,
      doctorQuestion,
      confidenceLabel,
      supportRouteCount: supportRouteUpdates.length,
      supportRoutes: supportRouteUpdates.map((update) => update.route),
      usesDeidentifiedResponseOnly: status.usesDeidentifiedResponseOnly
    }
  };
  const primaryRoute = cleanText(finalResponse?.responseFocus?.primaryRoute || result?.plan?.responseOwner?.route || "");
  const baseAgentResults = engagementMode === "route-aware-clinical-second-pass" && Array.isArray(result.agentResults)
    ? result.agentResults.map((agent) => {
      if (agent.id !== primaryRoute) {
        return agent;
      }

      return {
        ...agent,
        output: mergeRouteAssistOutput({
          route: primaryRoute,
          output: agent.output || {},
          summary,
          patientAnswerSummary: summary,
          actionItems: stepItems,
          question: doctorQuestion,
          missingItems: missingContext,
          warningItems,
          confidenceLabel,
          metadataKey: "cloudLlm",
          metadata: {
            applied: true,
            provider: status.provider,
            model: status.model,
            engagementMode,
            evidenceFocus,
            missingContext,
            doctorQuestion,
            confidenceLabel
          }
        })
      };
    })
    : result.agentResults;
  const mergedAgentResults = engagementMode === "route-aware-clinical-second-pass"
    ? mergeSupportRouteAssistOutputs({
      agentResults: baseAgentResults,
      updates: supportRouteUpdates,
      primaryRoute,
      metadataKey: "cloudLlm",
      metadataBase: {
        applied: true,
        provider: status.provider,
        model: status.model,
        engagementMode
      }
    })
    : baseAgentResults;

  return {
    finalResponse: mergedFinalResponse,
    agentResults: mergedAgentResults
  };
}

function mergeSupportRouteAssistOutputs({
  agentResults = [],
  updates = [],
  primaryRoute = "",
  metadataKey = "",
  metadataBase = {}
} = {}) {
  if (!Array.isArray(agentResults) || !updates.length) {
    return agentResults;
  }

  return agentResults.map((agent) => {
    const route = cleanText(agent?.id);

    if (!route || route === primaryRoute) {
      return agent;
    }

    const update = updates.find((candidate) => candidate.route === route);

    if (!update) {
      return agent;
    }

    return {
      ...agent,
      output: mergeRouteAssistOutput({
        route,
        output: agent.output || {},
        summary: update.summary || update.patientAnswerSummary,
        patientAnswerSummary: update.patientAnswerSummary || update.summary,
        actionItems: update.actionItems,
        questionItems: update.questionItems,
        missingItems: update.missingContext,
        confidenceLabel: update.confidenceLabel,
        metadataKey,
        metadata: {
          ...metadataBase,
          supportRoute: true,
          route,
          evidenceFocus: update.evidenceFocus,
          missingContext: update.missingContext,
          questionAdditions: update.questionItems,
          actionAdditions: update.actionItems,
          summaryUpgrade: update.summary || "",
          patientAnswerSummary: update.patientAnswerSummary || "",
          confidenceLabel: update.confidenceLabel
        }
      })
    };
  });
}

function mergeRouteAssistOutput({
  route = "",
  output = {},
  summary = "",
  patientAnswerSummary = "",
  actionItems = [],
  question = "",
  questionItems = [],
  missingItems = [],
  warningItems = [],
  confidenceLabel = "",
  metadataKey = "",
  metadata = {}
} = {}) {
  let mergedOutput = {
    ...output,
    summary: summary || cleanText(output?.summary),
    patientAnswerSummary: patientAnswerSummary || cleanText(output?.patientAnswerSummary),
    confidenceLabel: confidenceLabel || cleanText(output?.confidenceLabel)
  };
  const routeActionItems = cleanText(route) === "ALERT_AGENT"
    ? dedupeItems([...(Array.isArray(actionItems) ? actionItems : []), ...(Array.isArray(warningItems) ? warningItems : [])])
    : Array.isArray(actionItems) ? actionItems : [];
  const routeQuestionItems = dedupeItems([
    ...(question ? [question] : []),
    ...(Array.isArray(questionItems) ? questionItems : [])
  ]).slice(0, 6);

  for (const key of ROUTE_ACTION_KEYS[route] || ["checklist"]) {
    mergedOutput[key] = mergeTextListField(mergedOutput[key], routeActionItems, 6, 220);
  }

  for (const key of ROUTE_QUESTION_KEYS[route] || []) {
    mergedOutput[key] = mergeTextListField(mergedOutput[key], routeQuestionItems, 6, 220);
  }

  for (const path of ROUTE_MISSING_KEYS[route] || ["missingContext"]) {
    mergedOutput = mergeNestedTextListField(mergedOutput, path, missingItems, 6, 160);
  }

  if (metadataKey) {
    mergedOutput[metadataKey] = metadata;
  }

  return mergedOutput;
}

function mergeTextListField(currentValue, additions = [], limit = 6, maxLength = 220) {
  return dedupeItems([
    ...normalizeStringList(currentValue, limit, maxLength),
    ...normalizeStringList(additions, limit, maxLength)
  ]).slice(0, limit);
}

function mergeNestedTextListField(target = {}, path = "", additions = [], limit = 6, maxLength = 220) {
  const safePath = cleanText(path);

  if (!safePath) {
    return target;
  }

  const parts = safePath.split(".").filter(Boolean);

  if (!parts.length) {
    return target;
  }

  const nextTarget = {
    ...(target && typeof target === "object" ? target : {})
  };
  let cursor = nextTarget;
  let sourceCursor = target && typeof target === "object" ? target : {};

  for (let index = 0; index < parts.length - 1; index += 1) {
    const key = parts[index];
    const sourceValue = sourceCursor && typeof sourceCursor === "object" ? sourceCursor[key] : undefined;
    const clonedValue = sourceValue && typeof sourceValue === "object" && !Array.isArray(sourceValue)
      ? { ...sourceValue }
      : {};

    cursor[key] = clonedValue;
    cursor = clonedValue;
    sourceCursor = sourceValue;
  }

  const finalKey = parts[parts.length - 1];
  const currentValue = sourceCursor && typeof sourceCursor === "object" ? sourceCursor[finalKey] : undefined;
  cursor[finalKey] = mergeTextListField(currentValue, additions, limit, maxLength);
  return nextTarget;
}

function reconcileActualExecution(result = {}, execution = {}) {
  const plannedModelRouting = result.modelRouting && typeof result.modelRouting === "object" ? result.modelRouting : null;
  const plannedProcessingType = cleanText(plannedModelRouting?.processingType || "local").toLowerCase() || "local";
  const plannedPrimary = plannedModelRouting?.selectedModel?.plannedPrimary || plannedModelRouting?.selectedModel?.primary || null;
  const localFallback = plannedModelRouting?.selectedModel?.fallback;
  const localAssist = plannedModelRouting?.selectedModel?.assist;
  const localPrimary = (localAssist && localAssist.type === "local" ? localAssist : null)
    || (localFallback && localFallback.type === "local" ? localFallback : null)
    || {
      id: "care-nova-local-core",
      displayName: "Care Nova Local Clinical Core",
      type: "local",
      family: "deterministic-local",
      model: "offline-ranker-safety-engine",
      status: "ready",
      costTier: "free",
      performanceClass: "safe-deterministic",
      offlineCapable: true,
      internetRequired: false
    };
  const actualPrimary = execution.applied
    ? plannedPrimary || localPrimary
    : plannedProcessingType === "local" && plannedPrimary?.type === "local"
      ? plannedPrimary
      : localPrimary;
  const actualProcessingType = execution.actualProcessingType || (execution.applied ? "hybrid" : "local");
  const actualGeneratedUsing = execution.actualGeneratedUsing || (execution.applied ? "Hybrid Processing" : "Local Model");

  result.processingMode = actualGeneratedUsing;

  if (result.finalResponse && typeof result.finalResponse === "object") {
    result.finalResponse.processingMode = actualGeneratedUsing;
  }

  if (!plannedModelRouting) {
    return;
  }

  const nextModelRouting = {
    ...plannedModelRouting,
    processingType: actualProcessingType,
    label: actualGeneratedUsing,
    generatedUsing: actualGeneratedUsing,
    selectedModel: {
      ...plannedModelRouting.selectedModel,
      primary: actualPrimary,
      plannedPrimary
    },
    failover: {
      ...plannedModelRouting.failover,
      fallbackTriggered: execution.applied
        ? false
        : execution.attempted
          ? execution.error || "temporary-cloud-fallback"
          : plannedModelRouting.failover?.fallbackTriggered || false
    },
    actualExecution: {
      processingType: actualProcessingType,
      generatedUsing: actualGeneratedUsing,
      engagementMode: execution.engagementMode || "",
      requestedCloudExecution: Boolean(execution.requestedForThisRun),
      plannedByRouter: Boolean(execution.plannedByRouter),
      attemptedCloudRewrite: Boolean(execution.attempted),
      cloudRewriteApplied: Boolean(execution.applied),
      fallbackUsed: execution.fallbackUsed !== false,
      provider: execution.provider || "",
      model: execution.model || "",
      endpointHost: execution.endpointHost || "",
      error: execution.error || "",
      skipReason: execution.skipReason || ""
    }
  };

  result.modelRouting = nextModelRouting;

  if (result.finalResponse && typeof result.finalResponse === "object") {
    result.finalResponse.modelRouting = nextModelRouting;
  }

  if (result.model && typeof result.model === "object") {
    result.model.actualExecution = nextModelRouting.actualExecution;
  }
}

function buildHeaders(status, env) {
  const apiKeyHeader = cleanText(env.CARE_NOVA_TEMP_CLOUD_API_KEY_HEADER);
  const authScheme = cleanText(env.CARE_NOVA_TEMP_CLOUD_API_AUTH_SCHEME || "Bearer");
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json; charset=utf-8"
  };
  const apiKey = cleanText(env.CARE_NOVA_TEMP_CLOUD_API_KEY || env.OPENAI_API_KEY);

  if (apiKey && apiKeyHeader) {
    headers[apiKeyHeader] = apiKey;
  } else if (apiKey) {
    headers.Authorization = `${authScheme} ${apiKey}`.trim();
  }

  return headers;
}

function extractResponseText(payload) {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  if (typeof payload.output_text === "string") {
    return payload.output_text;
  }

  const responseOutput = Array.isArray(payload.output) ? payload.output : [];

  for (const item of responseOutput) {
    const contentItems = Array.isArray(item?.content) ? item.content : [];
    const text = contentItems
      .map((entry) => cleanText(entry?.text || entry?.content || ""))
      .filter(Boolean)
      .join("\n");

    if (text) {
      return text;
    }
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

function normalizeStringList(value, limit, maxLength) {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(new Set(
    value
      .map((item) => cleanText(item).slice(0, maxLength))
      .filter(Boolean)
  )).slice(0, limit);
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

function dedupeItems(items = []) {
  return Array.from(new Set((items || []).map((item) => cleanText(item)).filter(Boolean)));
}

function toArray(value) {
  if (Array.isArray(value)) {
    return value;
  }

  const text = cleanText(value);
  return text ? text.split(",").map((item) => item.trim()).filter(Boolean) : [];
}

function normalizeChatCompletionsEndpoint(value) {
  const endpoint = cleanText(value);

  if (!endpoint) {
    return "";
  }

  if (/\/chat\/completions$/i.test(endpoint)) {
    return endpoint;
  }

  if (/\/responses$/i.test(endpoint)) {
    return endpoint.replace(/\/responses$/i, "/chat/completions");
  }

  if (/\/v\d+\/?$/i.test(endpoint)) {
    return `${endpoint.replace(/\/$/, "")}/chat/completions`;
  }

  try {
    const parsed = new URL(endpoint);

    if (!parsed.pathname || parsed.pathname === "/") {
      return `${parsed.origin}/v1/chat/completions`;
    }
  } catch {
    if (/^https?:\/\/[^/]+$/i.test(endpoint)) {
      return `${endpoint}/v1/chat/completions`;
    }
  }

  if (/api\.openai\.com$/i.test(safeHost(endpoint))) {
    return `${endpoint.replace(/\/$/, "")}/v1/chat/completions`;
  }

  return endpoint;
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

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
