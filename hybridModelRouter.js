import { getConnectivityPolicy, isLocalEndpoint } from "./runtimeConnectivity.js";
import { getLocalRuntimeProbeSnapshot, normalizeChatCompletionsEndpoint, resolveOpenSourceLocalAdapter } from "./openSourceLocalRuntime.js";
import { scoreTrainingCalibrationRoutes } from "./trainingEngine.js";

export const HYBRID_MODEL_ROUTER_VERSION = "1.3.2";

const localModelDefinitions = [
  {
    id: "care-nova-local-core",
    displayName: "Care Nova Local Clinical Core",
    family: "deterministic-local",
    defaultModel: "offline-ranker-safety-engine",
    costTier: "free",
    performanceClass: "safe-deterministic",
    strengths: ["offline execution", "medical safety guardrails", "local retrieval", "patient memory continuity"]
  },
  {
    id: "deepseek-r1",
    displayName: "DeepSeek-R1",
    family: "reasoning",
    defaultModel: "deepseek-r1",
    costTier: "free-or-metered",
    performanceClass: "advanced reasoning",
    strengths: ["reasoning", "complex planning", "local or compatible API deployment"],
    routeHints: ["SPECIALIST_DOCTOR_AGENT", "ALERT_AGENT", "LABS_AGENT", "PHARMACY_AGENT", "INSURANCE_AGENT"],
    preferredModes: ["deep", "handoff"],
    priority: 96,
    multilingual: false,
    envModelKeys: ["CARE_NOVA_DEEPSEEK_MODEL", "DEEPSEEK_MODEL"],
    envEndpointKeys: ["CARE_NOVA_DEEPSEEK_URL", "DEEPSEEK_BASE_URL"],
    envApiKeyKeys: ["CARE_NOVA_DEEPSEEK_API_KEY", "DEEPSEEK_API_KEY"]
  },
  {
    id: "llama-3",
    displayName: "Llama 3",
    family: "general-open-source",
    defaultModel: "llama3",
    costTier: "free",
    performanceClass: "general reasoning",
    strengths: ["offline chat", "summarization", "local knowledge-grounded answers"],
    routeHints: ["RAG_AGENT", "ATLAS_AGENT", "RECORDS_AGENT", "SUMMARY_AGENT"],
    preferredModes: ["quick", "deep"],
    priority: 86,
    multilingual: false,
    envModelKeys: ["CARE_NOVA_LLAMA_MODEL", "LLAMA_MODEL"],
    envEndpointKeys: ["CARE_NOVA_LLAMA_URL", "LLAMA_BASE_URL"],
    envApiKeyKeys: ["CARE_NOVA_LLAMA_API_KEY", "LLAMA_API_KEY"]
  },
  {
    id: "mistral",
    displayName: "Mistral",
    family: "general-open-source",
    defaultModel: "mistral",
    costTier: "free",
    performanceClass: "fast local inference",
    strengths: ["low-latency local answers", "summarization", "tool-friendly prompts"],
    routeHints: ["RAG_AGENT", "VITALS_AGENT", "SCHEDULING_AGENT", "SUMMARY_AGENT"],
    preferredModes: ["quick"],
    priority: 84,
    multilingual: false,
    envModelKeys: ["CARE_NOVA_MISTRAL_MODEL", "MISTRAL_MODEL"],
    envEndpointKeys: ["CARE_NOVA_MISTRAL_URL", "MISTRAL_BASE_URL"],
    envApiKeyKeys: ["CARE_NOVA_MISTRAL_API_KEY", "MISTRAL_API_KEY"]
  },
  {
    id: "gemma",
    displayName: "Gemma",
    family: "general-open-source",
    defaultModel: "gemma",
    costTier: "free",
    performanceClass: "compact local inference",
    strengths: ["offline answers", "low-cost deployment", "small-footprint inference"],
    routeHints: ["RAG_AGENT", "WELLNESS_AGENT", "PROFILE_AGENT"],
    preferredModes: ["quick"],
    priority: 78,
    multilingual: false,
    envModelKeys: ["CARE_NOVA_GEMMA_MODEL", "GEMMA_MODEL"],
    envEndpointKeys: ["CARE_NOVA_GEMMA_URL", "GEMMA_BASE_URL"],
    envApiKeyKeys: ["CARE_NOVA_GEMMA_API_KEY", "GEMMA_API_KEY"]
  },
  {
    id: "qwen",
    displayName: "Qwen",
    family: "general-open-source",
    defaultModel: "qwen",
    costTier: "free",
    performanceClass: "multilingual local inference",
    strengths: ["multilingual answers", "offline execution", "structured output"],
    routeHints: ["RAG_AGENT", "SPECIALIST_DOCTOR_AGENT", "ATLAS_AGENT", "PHARMACY_AGENT"],
    preferredModes: ["quick", "deep", "handoff"],
    priority: 88,
    multilingual: true,
    envModelKeys: ["CARE_NOVA_QWEN_MODEL", "QWEN_MODEL"],
    envEndpointKeys: ["CARE_NOVA_QWEN_URL", "QWEN_BASE_URL"],
    envApiKeyKeys: ["CARE_NOVA_QWEN_API_KEY", "QWEN_API_KEY"]
  }
];

const cloudProviderDefinitions = [
  {
    id: "openai",
    displayName: "OpenAI GPT",
    envEnabled: "CARE_NOVA_OPENAI_ENABLED",
    envApiKey: "OPENAI_API_KEY",
    envModel: "OPENAI_MODEL",
    envEndpoint: "OPENAI_BASE_URL",
    defaultModel: "gpt-family",
    costTier: "paid",
    performanceClass: "advanced reasoning and large context",
    strengths: ["advanced reasoning", "large-context synthesis", "tool orchestration"]
  },
  {
    id: "azure-openai",
    displayName: "Azure OpenAI",
    envEnabled: "CARE_NOVA_AZURE_OPENAI_ENABLED",
    envApiKey: "AZURE_OPENAI_API_KEY",
    envModel: "AZURE_OPENAI_DEPLOYMENT",
    envEndpoint: "AZURE_OPENAI_ENDPOINT",
    defaultModel: "azure-openai-deployment",
    costTier: "paid-enterprise",
    performanceClass: "enterprise governed cloud reasoning",
    strengths: ["enterprise deployment", "private networking options", "large-context reasoning"]
  },
  {
    id: "anthropic",
    displayName: "Anthropic Claude",
    envEnabled: "CARE_NOVA_ANTHROPIC_ENABLED",
    envApiKey: "ANTHROPIC_API_KEY",
    envModel: "ANTHROPIC_MODEL",
    envEndpoint: "ANTHROPIC_BASE_URL",
    defaultModel: "claude-family",
    costTier: "paid",
    performanceClass: "long-form reasoning",
    strengths: ["long document review", "careful summarization", "complex instruction following"]
  },
  {
    id: "google-gemini",
    displayName: "Google Gemini",
    envEnabled: "CARE_NOVA_GEMINI_ENABLED",
    envApiKey: "GEMINI_API_KEY",
    envModel: "GEMINI_MODEL",
    envEndpoint: "GEMINI_BASE_URL",
    defaultModel: "gemini-family",
    costTier: "paid",
    performanceClass: "multimodal and retrieval-friendly reasoning",
    strengths: ["multimodal-ready tasks", "large-context synthesis", "cloud retrieval workflows"]
  },
  {
    id: "enterprise-ai",
    displayName: "Enterprise AI Service",
    envEnabled: "CARE_NOVA_ENTERPRISE_AI_ENABLED",
    envApiKey: "ENTERPRISE_AI_API_KEY",
    envModel: "ENTERPRISE_AI_MODEL",
    envEndpoint: "ENTERPRISE_AI_ENDPOINT",
    defaultModel: "enterprise-ai-model",
    costTier: "paid-enterprise",
    performanceClass: "private enterprise model endpoint",
    strengths: ["enterprise policy control", "private model hosting", "domain-specific adapters"]
  }
];

const complexityKeywords = [
  "appeal",
  "authorization",
  "batch",
  "capa",
  "claim",
  "clinical document",
  "complaint",
  "design control",
  "discharge",
  "doctor note",
  "evidence",
  "explanation of benefits",
  "fhir",
  "gxp",
  "handoff",
  "large context",
  "policy",
  "prior auth",
  "qms",
  "regulatory",
  "report",
  "root cause",
  "sop",
  "summarize",
  "technical file",
  "traceability",
  "v&v"
];

const interfaceRouteMap = {
  advisor: "RAG_AGENT",
  specialist: "SPECIALIST_DOCTOR_AGENT",
  atlas: "RAG_AGENT",
  vitals: "VITALS_AGENT",
  medications: "PHARMACY_AGENT",
  medicine: "PHARMACY_AGENT",
  labs: "LABS_AGENT",
  appointments: "SCHEDULING_AGENT",
  visits: "SCHEDULING_AGENT",
  wellness: "WELLNESS_AGENT",
  safety: "ALERT_AGENT",
  records: "RECORDS_AGENT",
  insurance: "INSURANCE_AGENT",
  dashboard: "RAG_AGENT",
  summary: "RECORDS_AGENT",
  profile: "RAG_AGENT"
};

function getRequestedRouteForModelSelection(input = {}) {
  const directRoute = cleanText(
    input.preferredAgent
    || input.requirementProfile?.expectedRoute
    || input.plan?.responseOwner?.route
    || input.plan?.singleAgent?.route
  ).toUpperCase();

  if (directRoute) {
    return directRoute;
  }

  const interfaceName = cleanText(input.interfaceName).toLowerCase();
  return interfaceRouteMap[interfaceName] || "RAG_AGENT";
}

function getRequestedAnswerMode(input = {}) {
  const answerMode = cleanText(input.requirementProfile?.answerMode?.id || input.answerMode).toLowerCase();
  return answerMode || "quick";
}

function detectMultilingualNeed(input = {}) {
  const source = cleanText(`${input.message || ""} ${input.language || ""} ${input.locale || ""}`);
  return /[^\u0000-\u007f]/.test(source)
    || /\b(hindi|tamil|telugu|kannada|malayalam|marathi|urdu|arabic|spanish|french|german|japanese|chinese)\b/i.test(source);
}

function scoreLocalModelFit(model, input = {}, config = {}) {
  if (!model || !model.available) {
    return -1;
  }

  if (model.id === "care-nova-local-core") {
    return 20;
  }

  const route = getRequestedRouteForModelSelection(input);
  const answerMode = getRequestedAnswerMode(input);
  const multilingualNeed = detectMultilingualNeed(input);
  const complexity = scoreRequestComplexity(input);
  const evidenceCoverage = Number(input.medicalKnowledge?.coverageScore || 0);
  const ambiguityPenalty = Number(input.medicalKnowledge?.localAi?.rankingDiagnostics?.ambiguityPenalty || 0);
  const topMatchMargin = Number(input.medicalKnowledge?.localAi?.rankingDiagnostics?.topMatchMargin || 0);
  let score = Number(model.priority || 60);

  if (Array.isArray(model.routeHints) && model.routeHints.includes(route)) {
    score += 22;
  }

  if (Array.isArray(model.preferredModes) && model.preferredModes.includes(answerMode)) {
    score += 12;
  }

  if (multilingualNeed && model.multilingual) {
    score += 16;
  }

  if (complexity.score >= 72 && /advanced reasoning/i.test(model.performanceClass || "")) {
    score += 14;
  } else if (complexity.score < 55 && /fast local inference|compact local inference/i.test(model.performanceClass || "")) {
    score += 10;
  }

  if (
    ["SPECIALIST_DOCTOR_AGENT", "LABS_AGENT", "PHARMACY_AGENT", "INSURANCE_AGENT", "ALERT_AGENT"].includes(route)
    && model.id === "deepseek-r1"
    && complexity.score >= 58
  ) {
    score += 10;
  }

  if (
    (ambiguityPenalty >= 10 || (evidenceCoverage > 0 && evidenceCoverage < 68) || (topMatchMargin > 0 && topMatchMargin < 8))
    && /advanced reasoning|general reasoning|multilingual local inference/i.test(model.performanceClass || "")
  ) {
    score += 10;
  }

  if (ambiguityPenalty >= 12 && model.id === "deepseek-r1") {
    score += 8;
  }

  if (evidenceCoverage >= 86 && complexity.score < 70 && /fast local inference|compact local inference/i.test(model.performanceClass || "")) {
    score += 6;
  }

  if (config.preferFreeModels && model.costTier === "free") {
    score += 4;
  }

  return score;
}

export function getOpenSourceParticipationPlan(input = {}, env = process.env) {
  const config = getRouterConfig(env);
  const localModels = buildLocalModelCatalog(env, config);
  const openSourceModels = localModels.filter((model) => model.available && model.id !== "care-nova-local-core");
  const sorted = [...openSourceModels]
    .map((model) => ({ model, fitScore: scoreLocalModelFit(model, input, config) }))
    .sort((first, second) => second.fitScore - first.fitScore);
  const primary = sorted[0]?.model || null;
  const verifier = sorted.find((entry) => entry.model.id !== primary?.id && /reasoning|general-open-source/i.test(entry.model.family || ""))?.model || null;
  const responder = sorted.find((entry) => entry.model.id !== primary?.id && entry.model.id !== verifier?.id)?.model || null;
  const participants = [primary, verifier, responder].filter(Boolean);

  return {
    route: getRequestedRouteForModelSelection(input),
    answerMode: getRequestedAnswerMode(input),
    enabled: participants.length > 0,
    participantCount: participants.length,
    primary,
    verifier,
    responder,
    participants,
    summary: participants.length
      ? `Route-aware open-source participation ready with ${participants.map((item) => item.displayName).join(", ")}.`
      : "No configured open-source local model is currently available; deterministic local core remains active."
  };
}

export function getHybridModelRouterStatus(env = process.env) {
  const config = getRouterConfig(env);
  const localModels = buildLocalModelCatalog(env, config);
  const cloudModels = buildCloudModelCatalog(env, config);
  const availableLocalModels = localModels.filter((model) => model.available);
  const availableOpenSourceModels = availableLocalModels.filter((model) => model.id !== "care-nova-local-core");
  const configuredOpenSourceModels = localModels.filter((model) => model.id !== "care-nova-local-core" && model.configured);
  const availableCloudModels = cloudModels.filter((model) => model.available);
  const routableCloudModels = cloudModels.filter((model) => model.routingAvailable);
  const demoAdapterCloudModels = cloudModels.filter((model) => model.status === "demo-local-adapter-ready");
  const openSourcePlan = getOpenSourceParticipationPlan({}, env);
  const defaultLocalModel = chooseBestLocalModel(localModels, {}, config);
  const defaultCloudModel = chooseBestCloudModel(cloudModels, config);
  const cloudConfigured = cloudModels.some((model) => model.configured);
  const cloudAvailable = routableCloudModels.length > 0;
  const status = defaultLocalModel
    ? cloudAvailable
      ? "hybrid-ready"
      : cloudConfigured && !config.cloudAllowed
        ? "local-ready-cloud-disabled-by-policy"
        : "local-ready"
    : "router-needs-local-model";

  return {
    id: "CARE_NOVA_HYBRID_MODEL_ROUTER",
    version: HYBRID_MODEL_ROUTER_VERSION,
    status,
    mode: config.routingPolicy,
    processingLabels: ["Local Model", "Cloud Model", "Hybrid Processing"],
    summary: {
      localModelCount: localModels.length,
      cloudModelCount: cloudModels.length,
      availableLocalModels: availableLocalModels.length,
      availableOpenSourceModels: availableOpenSourceModels.length,
      configuredOpenSourceModels: configuredOpenSourceModels.length,
      availableCloudModels: availableCloudModels.length,
      routableCloudModels: routableCloudModels.length,
      demoAdapterCloudModels: demoAdapterCloudModels.length,
      defaultLocalModel: defaultLocalModel?.displayName || "",
      defaultOpenSourceParticipants: openSourcePlan.participants.map((item) => item.displayName),
      defaultCloudModel: defaultCloudModel?.displayName || "",
      cloudAllowed: config.cloudAllowed,
      internetAvailable: config.internetAvailable,
      costPolicy: config.costPolicy
    },
    connectivity: {
      internetAvailable: config.internetAvailable,
      forcedOffline: config.forceOffline,
      onlineModeAllowed: config.onlineModeAllowed,
      cloudAllowed: config.cloudAllowed,
      offlineExecutionReady: availableLocalModels.length > 0
    },
    costPolicy: {
      level: config.costPolicy,
      preferFreeModels: config.preferFreeModels,
      paidModelsRequireExplicitEnablement: true,
      zeroCostFallbackAlwaysAvailable: Boolean(defaultLocalModel)
    },
    localModels,
    cloudModels,
    fallbackPolicy: {
      strategy: "cloud-to-local-then-deterministic",
      apiFailure: "Switch to the best configured local/free model, then to the Care Nova deterministic core.",
      offline: "Skip paid/cloud models and use local retrieval, local memory, local knowledge packs, and cached external references.",
      apiLimit: "Treat rate limits and subscription errors as provider failure and continue with local/free models.",
      uninterruptedService: true
    },
    capabilities: {
      localKnowledgeBases: true,
      localVectorStyleRetrieval: true,
      cachedInformation: true,
      openSourceLocalEnsemble: availableOpenSourceModels.length > 0,
      cloudAdvancedReasoning: cloudAvailable,
      largeContextCloudPath: cloudAvailable,
      offlineMode: true,
      onlineMode: config.onlineModeAllowed,
      agenticPlanExecuteValidateLoop: true
    },
    timestamp: new Date().toISOString()
  };
}

export function selectHybridModelRoute(input = {}, env = process.env) {
  const router = getHybridModelRouterStatus(env);
  const config = getRouterConfig(env);
  const localModels = router.localModels;
  const cloudModels = router.cloudModels;
  const openSourcePlan = getOpenSourceParticipationPlan(input, env);
  const localModel = openSourcePlan.primary || chooseBestLocalModel(localModels, input, config);
  const cloudModel = chooseBestCloudModel(cloudModels, config);
  const complexity = scoreRequestComplexity(input);
  const hasCloud = Boolean(cloudModel);
  const hasLocal = Boolean(localModel?.available);
  const safetyLocalRequired = isHealthcareSafetyContext(input);
  const threshold = config.cloudComplexityThreshold;
  const reasons = [];
  let processingType = "local";
  let primaryModel = localModel;
  let assistModel = openSourcePlan.verifier || null;

  if (config.forceOffline) {
    reasons.push("Offline mode is forced, so cloud providers are skipped.");
  } else if (!config.internetAvailable) {
    reasons.push("Internet is unavailable, so the local/free model path is selected.");
  } else if (!config.cloudAllowed) {
    reasons.push("Paid/cloud models are not enabled by policy.");
  } else if (!hasCloud) {
    reasons.push("No paid/cloud provider is configured and available.");
  } else if (config.routingPolicy === "local-only") {
    reasons.push("Routing policy is local-only.");
  } else if (complexity.score < threshold && config.routingPolicy !== "cloud-preferred") {
    reasons.push(`Task complexity ${complexity.score}/100 is below the cloud threshold ${threshold}.`);
  } else if (hasCloud) {
    primaryModel = cloudModel;
    assistModel = localModel || assistModel;
    processingType = safetyLocalRequired ? "hybrid" : "cloud";
    reasons.push(
      config.routingPolicy === "cloud-preferred"
        ? "Cloud-preferred policy selected the best available paid model."
        : `Task complexity ${complexity.score}/100 meets the cloud threshold ${threshold}.`
    );
  }

  if (processingType === "local" && !reasons.length) {
    reasons.push("Local/free model is the most cost-efficient route for this request.");
  }

  if (openSourcePlan.participantCount > 1) {
    reasons.push(`Open-source local ensemble is available for this route: ${openSourcePlan.participants.map((model) => model.displayName).join(", ")}.`);
  } else if (openSourcePlan.participantCount === 1) {
    reasons.push(`Open-source local route owner selected: ${openSourcePlan.primary.displayName}.`);
  }

  if (!hasLocal) {
    reasons.push("No configured local LLM is required because the deterministic local core remains available.");
  }

  const fallbackChain = buildFallbackChain({ primaryModel, assistModel, localModels, cloudModels, processingType, openSourcePlan });
  const label = processingType === "hybrid"
    ? "Hybrid Processing"
    : processingType === "cloud"
      ? "Cloud Model"
      : "Local Model";
  const selectedModel = {
    processingType,
    label,
    primary: toPublicModel(primaryModel),
    assist: assistModel ? toPublicModel(assistModel) : null,
    participants: openSourcePlan.participants.map((model, index) => ({
      role: index === 0 ? "reasoner" : index === 1 ? "verifier" : "responder",
      ...toPublicModel(model)
    })),
    participantStrategy: openSourcePlan.participantCount > 1
      ? "route-aware open-source local ensemble"
      : openSourcePlan.participantCount === 1
        ? "single open-source local route owner"
        : "deterministic local core only",
    fallback: toPublicModel(fallbackChain.find((model) => model.id !== primaryModel?.id) || localModel),
    fallbackChain: fallbackChain.map(toPublicModel)
  };

  return {
    id: "CARE_NOVA_MODEL_ROUTE_DECISION",
    routerId: router.id,
    routerVersion: router.version,
    status: "selected",
    processingType,
    label,
    generatedUsing: label,
    selectedModel,
    requestProfile: complexity,
    policy: {
      routingPolicy: config.routingPolicy,
      costPolicy: config.costPolicy,
      preferFreeModels: config.preferFreeModels,
      cloudThreshold: threshold,
      paidModelsEnabled: config.paidModelsEnabled,
      cloudAllowed: config.cloudAllowed
    },
    connectivity: router.connectivity,
    failover: {
      ready: fallbackChain.some((model) => model.type === "local" && model.available),
      chain: fallbackChain.map((model) => model.displayName),
      onApiFailure: "Automatically continue with the next local/free model and never block the response.",
      fallbackTriggered: processingType === "local" && hasCloud && complexity.score >= threshold
        ? "cloud-skipped-by-policy"
        : false
    },
    cost: {
      class: processingType === "local" ? "zero-api-cost" : "paid-model-gated",
      optimized: processingType === "local" || config.costPolicy !== "premium",
      rationale: processingType === "local"
        ? "Local/free inference and deterministic retrieval avoid paid API usage."
        : "Paid/cloud use is reserved for complex or cloud-preferred tasks."
    },
    executionPlan: buildExecutionPlan({ processingType, primaryModel, assistModel, localModel, openSourcePlan }),
    reasons,
    routerSummary: router.summary,
    timestamp: new Date().toISOString()
  };
}

export function buildModelRouterPreview(payload = {}, env = process.env) {
  return {
    ok: true,
    router: getHybridModelRouterStatus(env),
    decision: selectHybridModelRoute(payload, env),
    timestamp: new Date().toISOString()
  };
}

function getRouterConfig(env) {
  const routingPolicy = normalizePolicy(env.CARE_NOVA_MODEL_ROUTING_POLICY || "local-first-auto");
  const connectivity = getConnectivityPolicy(env, { routingPolicy });
  const forceOffline = connectivity.forceOffline;
  const onlineModeAllowed = connectivity.onlineModeAllowed;
  const internetAvailable = connectivity.internetAvailable;
  const allModelsEnabled = readBoolean(env.CARE_NOVA_ENABLE_ALL_MODELS);
  const paidModelsEnabled = allModelsEnabled
    || readBooleanDefault(env.CARE_NOVA_PAID_MODELS_ENABLED, false)
    || readBooleanDefault(env.CARE_NOVA_CLOUD_MODELS_ENABLED, false);
  const cloudAllowed = internetAvailable && paidModelsEnabled && routingPolicy !== "local-only";
  const costPolicy = normalizeCostPolicy(env.CARE_NOVA_MODEL_COST_POLICY || "lowest-cost");
  const cloudComplexityThreshold = toBoundedInteger(env.CARE_NOVA_CLOUD_COMPLEXITY_THRESHOLD, 40, 95, 72);

  return {
    routingPolicy,
    forceOffline,
    onlineModeAllowed,
    internetAvailable,
    networkAllowed: !forceOffline && internetAvailable,
    allModelsEnabled,
    paidModelsEnabled,
    cloudAllowed,
    costPolicy,
    preferFreeModels: costPolicy !== "premium",
    cloudComplexityThreshold
  };
}

function buildLocalModelCatalog(env, config) {
  const localProvider = normalizeProviderId(env.LOCAL_LLM_PROVIDER || env.CARE_NOVA_LLM_PROVIDER || "auto");
  const localLlmEnabled = readBooleanDefault(env.LOCAL_LLM_ENABLED, true);
  const configuredLocalModels = config.allModelsEnabled
    ? localModelDefinitions.map((definition) => definition.id).filter((id) => id !== "care-nova-local-core")
    : parseList(env.CARE_NOVA_LOCAL_MODELS || "deepseek-r1,llama-3,mistral,gemma,qwen");
  const probeSnapshot = getLocalRuntimeProbeSnapshot();
  const catalog = [];

  for (const definition of localModelDefinitions) {
    if (definition.id === "care-nova-local-core") {
      catalog.push({
        ...definition,
        type: "local",
        model: definition.defaultModel,
        endpoint: "local-process",
        enabled: true,
        configured: true,
        available: true,
        status: "ready",
        offlineCapable: true,
        internetRequired: false,
        reason: "Always available dependency-free local retrieval, safety, memory, and response synthesis core."
      });
      continue;
    }

    const listedForSupport = configuredLocalModels.includes(definition.id);
    const isSelectedProvider = localProvider === "auto" ? definition.id === "deepseek-r1" : definition.id === localProvider;
    const adapter = resolveOpenSourceLocalAdapter(definition, env, {
      connectivity: config,
      probeSnapshot
    });
    const configured = localLlmEnabled && listedForSupport && adapter.configured;
    const available = configured && adapter.available;
    const status = !localLlmEnabled
      ? "disabled"
      : configured
        ? available
          ? "configured"
          : adapter.generationCooldownActive
            ? "local-runtime-cooldown"
          : adapter.mockRuntimeDetected
            ? "mock-runtime-detected"
          : adapter.endpointIsLocal && adapter.probeStatus === "reachable" && !adapter.modelAvailableInRuntime
            ? "local-model-not-loaded"
          : adapter.endpointIsLocal
            ? adapter.probeStatus === "unverified"
              ? "local-runtime-unverified"
              : "local-runtime-unreachable"
            : "configured-waiting-for-network"
        : listedForSupport
          ? "adapter-ready"
          : "supported";

    catalog.push({
      ...definition,
      type: "local",
      model: adapter.model || definition.defaultModel,
      endpoint: adapter.endpoint || "adapter-ready",
      apiKey: adapter.apiKey,
      apiKeyHeader: adapter.apiKeyHeader,
      authScheme: adapter.authScheme,
      enabled: localLlmEnabled && listedForSupport,
      configured,
      available,
      status,
      selected: isSelectedProvider,
      offlineCapable: adapter.endpointIsLocal || !adapter.endpoint,
      internetRequired: Boolean(adapter.endpoint && !adapter.endpointIsLocal),
      endpointIsLocal: adapter.endpointIsLocal,
      runtimeSource: adapter.runtimeSource,
      runtimeId: adapter.runtimeId,
      runtimeDisplayName: adapter.runtimeDisplayName,
      runtimeFamily: adapter.runtimeFamily,
      mockRuntimeDetected: adapter.mockRuntimeDetected,
      probeStatus: adapter.probeStatus,
      modelAvailableInRuntime: adapter.modelAvailableInRuntime,
      generationCooldownActive: adapter.generationCooldownActive,
      generationCooldownRemainingMs: adapter.generationCooldownRemainingMs,
      generationCooldownUntil: adapter.generationCooldownUntil,
      lastGenerationFailureAt: adapter.lastGenerationFailureAt,
      lastGenerationSuccessAt: adapter.lastGenerationSuccessAt,
      lastGenerationError: adapter.lastGenerationError,
      lastGenerationLatencyMs: adapter.lastGenerationLatencyMs,
      checkedAt: adapter.checkedAt,
      discoveredModelCount: adapter.discoveredModelCount,
      discoveredModelIds: adapter.discoveredModelIds,
      missing: adapter.missing,
      reason: isSelectedProvider
        ? configured
          ? available
            ? "Configured as the preferred local/free LLM adapter."
            : adapter.generationCooldownActive
              ? "Preferred local/free LLM runtime recently timed out or returned an unusable response. Deterministic local care logic stays active during cooldown."
            : adapter.mockRuntimeDetected
              ? "Care Nova compatibility runtime is active on localhost, but no native Ollama or LM Studio runtime is installed."
            : adapter.endpointIsLocal && adapter.probeStatus === "reachable" && !adapter.modelAvailableInRuntime
              ? "Preferred local/free LLM adapter runtime is reachable, but the selected model is not loaded there."
            : adapter.endpointIsLocal
              ? "Preferred local/free LLM adapter is configured and waiting for the local runtime to respond."
              : "Preferred local/free LLM adapter is configured but waiting for network access."
          : "Selected local/free LLM adapter is missing endpoint, model, or key configuration."
        : configured
          ? available
            ? "Configured as an open-source local ensemble participant."
            : adapter.generationCooldownActive
              ? "Configured local ensemble participant recently timed out or returned an unusable response, so it is cooling down."
            : adapter.mockRuntimeDetected
              ? "Compatibility runtime responded on localhost, but this is not a native local model runtime."
            : adapter.endpointIsLocal && adapter.probeStatus === "reachable" && !adapter.modelAvailableInRuntime
              ? "Configured local ensemble participant runtime is reachable, but the mapped model is not loaded there."
            : adapter.endpointIsLocal
              ? "Configured as an open-source local ensemble participant and waiting for the local runtime to respond."
              : "Configured as an open-source local ensemble participant and waiting for network access."
          : "Supported local/open-source model slot."
    });
  }

  return catalog;
}

function buildCloudModelCatalog(env, config) {
  const demoFallback = resolveLocalCloudDemoFallback(env);
  const probeSnapshot = getLocalRuntimeProbeSnapshot();

  return cloudProviderDefinitions.map((definition) => {
    const apiKey = cleanText(env[definition.envApiKey]);
    const configuredEndpoint = cleanText(env[definition.envEndpoint]);
    const configuredModel = cleanText(env[definition.envModel]) || definition.defaultModel;
    const providerEnabled = config.allModelsEnabled || readBooleanDefault(
      env[definition.envEnabled],
      Boolean(apiKey || configuredEndpoint || demoFallback.endpoint)
    );
    const demoFallbackActive = providerEnabled && !apiKey && !configuredEndpoint && Boolean(demoFallback.endpoint);
    const endpoint = demoFallbackActive ? demoFallback.endpoint : configuredEndpoint;
    const model = demoFallbackActive ? demoFallback.model : configuredModel;
    const configured = providerEnabled && Boolean(apiKey || endpoint);
    const endpointIsLocal = Boolean(endpoint) && isLocalEndpoint(endpoint);
    const compatibilityRuntimeDetected = endpointIsLocal && isMockLocalRuntimeEndpoint(endpoint, probeSnapshot);
    const routingAvailable = configured && !compatibilityRuntimeDetected && config.cloudAllowed && (Boolean(apiKey) || endpointIsLocal);
    const available = routingAvailable && !demoFallbackActive;
    const status = !providerEnabled
      ? "disabled"
      : configured
        ? available
          ? "available"
          : compatibilityRuntimeDetected
            ? "demo-local-adapter-compatibility-only"
          : demoFallbackActive && endpointIsLocal
            ? "demo-local-adapter-ready"
          : config.forceOffline || !config.internetAvailable
            ? "configured-offline"
            : "configured-disabled-by-policy"
        : "missing-configuration";

    return {
      ...definition,
      type: "cloud",
      model,
      endpoint: endpoint ? safeHost(endpoint) : "provider-default",
      enabled: providerEnabled,
      configured,
      routingAvailable,
      available,
      status,
      offlineCapable: endpointIsLocal && routingAvailable,
      internetRequired: Boolean(endpoint && !endpointIsLocal),
      apiKeyConfigured: Boolean(apiKey),
      endpointIsLocal,
      compatibilityRuntimeDetected,
      reason: configured
        ? demoFallbackActive
          ? compatibilityRuntimeDetected
            ? `${definition.displayName} is mapped to the local compatibility adapter, so cloud routing stays disabled until a native runtime or real provider endpoint is configured.`
            : `${definition.displayName} is mapped to the local OpenAI-compatible demo adapter until remote credentials are supplied.`
          : "Paid/cloud provider is configured and waits for routing policy."
        : providerEnabled
          ? "Provider slot is enabled but missing credentials or endpoint configuration."
          : "Add provider credentials and explicitly enable paid/cloud models before routing requests here."
    };
  });
}

function resolveLocalCloudDemoFallback(env = {}) {
  const endpoint = normalizeChatCompletionsEndpoint(
    env.LOCAL_LLM_URL
      || env.CARE_NOVA_LOCAL_LLM_URL
  );
  const model = cleanText(
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

  return {
    endpoint: cleanText(endpoint),
    model
  };
}

function isMockLocalRuntimeEndpoint(endpoint, probeSnapshot = getLocalRuntimeProbeSnapshot()) {
  const normalized = cleanText(normalizeChatCompletionsEndpoint(endpoint));

  if (!normalized) {
    return false;
  }

  return probeSnapshot?.endpoints?.[normalized]?.mockRuntime === true;
}

function scoreRequestComplexity(input = {}) {
  const message = cleanText(input.message);
  const riskLevel = cleanText(input.risk?.level).toUpperCase();
  const intents = Array.isArray(input.intents) ? input.intents : [];
  const planRoutes = Array.isArray(input.plan?.execute) ? input.plan.execute : [];
  const memoryTurns = Number(input.memoryContext?.recentTurnCount || 0);
  const inputQualityScore = Number(input.inputQuality?.score || 80);
  const knowledgeMatches = Array.isArray(input.medicalKnowledge?.matches) ? input.medicalKnowledge.matches.length : 0;
  const evidenceCoverage = Number(input.medicalKnowledge?.coverageScore || 0);
  const ambiguityPenalty = Number(input.medicalKnowledge?.localAi?.rankingDiagnostics?.ambiguityPenalty || 0);
  const topMatchMargin = Number(input.medicalKnowledge?.localAi?.rankingDiagnostics?.topMatchMargin || 0);
  const answerMode = cleanText(input.requirementProfile?.answerMode?.id || input.answerMode);
  const detailLevel = cleanText(input.requirementProfile?.detailLevel);
  const externalUsed = Boolean(input.externalKnowledge?.usedForThisRequest || input.medicalKnowledge?.externalKnowledge?.usedForThisRequest);
  const normalized = message.toLowerCase();
  const keywordHits = complexityKeywords.filter((keyword) => normalized.includes(keyword));
  const sortedIntents = [...intents].sort((first, second) => Number(second?.confidence || 0) - Number(first?.confidence || 0));
  const intentGap = sortedIntents.length > 1
    ? Number(sortedIntents[0]?.confidence || 0) - Number(sortedIntents[1]?.confidence || 0)
    : 1;
  const trainingRouteProfile = input.trainingCalibration
    ? scoreTrainingCalibrationRoutes({
      message: input.message,
      profile: input.profile,
      vitals: input.vitals,
      context: input.context,
      memoryContext: input.memoryContext,
      recordContext: input.recordContext,
      graphContext: input.graphContext
    }, input.trainingCalibration)
    : { rankedRoutes: [], signalSources: [] };
  const trainingTopRoute = trainingRouteProfile.rankedRoutes?.[0] || null;
  const trainingSecondRoute = trainingRouteProfile.rankedRoutes?.[1] || null;
  const trainingTopScore = Number(trainingTopRoute?.score || 0);
  const trainingRouteGap = trainingSecondRoute
    ? Math.max(0, trainingTopScore - Number(trainingSecondRoute?.score || 0))
    : trainingTopScore;
  let score = 24;
  const drivers = [];

  if (message.length > 900) {
    score += 24;
    drivers.push("large prompt");
  } else if (message.length > 500) {
    score += 16;
    drivers.push("medium prompt");
  } else if (message.length > 220) {
    score += 8;
    drivers.push("short-to-medium prompt");
  }

  if (intents.length > 2 || planRoutes.length > 1) {
    score += Math.min(Math.max(intents.length, planRoutes.length) * 5, 18);
    drivers.push("multiple agent routes");
  }

  if (["HIGH", "CRITICAL"].includes(riskLevel)) {
    score += 12;
    drivers.push("high safety context");
  } else if (riskLevel === "MEDIUM") {
    score += 7;
    drivers.push("medium safety context");
  }

  if (answerMode === "deep" || detailLevel === "deep") {
    score += 15;
    drivers.push("deep answer mode");
  }

  if (answerMode === "handoff") {
    score += 10;
    drivers.push("handoff output");
  }

  if (memoryTurns >= 4) {
    score += 8;
    drivers.push("multi-turn memory");
  } else if (memoryTurns > 0) {
    score += 4;
    drivers.push("memory context");
  }

  if (knowledgeMatches >= 4) {
    score += 6;
    drivers.push("multi-reference evidence");
  }

  if (evidenceCoverage > 0 && evidenceCoverage < 68) {
    score += 10;
    drivers.push("thin evidence coverage");
  } else if (evidenceCoverage > 0 && evidenceCoverage < 80) {
    score += 5;
    drivers.push("moderate evidence coverage");
  }

  if (ambiguityPenalty >= 12) {
    score += 10;
    drivers.push("ambiguous evidence ranking");
  } else if (ambiguityPenalty >= 6) {
    score += 5;
    drivers.push("some evidence ambiguity");
  }

  if (topMatchMargin > 0 && topMatchMargin < 8) {
    score += 6;
    drivers.push("close evidence margin");
  }

  if (intentGap > 0 && intentGap < 0.12) {
    score += 6;
    drivers.push("close route confidence");
  }

  if (trainingTopScore >= 0.42 && trainingRouteGap > 0 && trainingRouteGap < 0.12) {
    score += 8;
    drivers.push("training route ambiguity");
  } else if (trainingTopScore >= 0.42 && trainingRouteGap < 0.2) {
    score += 4;
    drivers.push("training route competition");
  } else if (trainingTopScore > 0 && trainingTopScore < 0.36 && trainingRouteProfile.tokenCount >= 10) {
    score += 4;
    drivers.push("weak learned route signal");
  }

  if (externalUsed) {
    score += 9;
    drivers.push("online or cached external references");
  }

  if (inputQualityScore < 60) {
    score += 5;
    drivers.push("low input quality needs careful fallback");
  }

  if (keywordHits.length) {
    score += Math.min(keywordHits.length * 4, 20);
    drivers.push(...keywordHits.slice(0, 5));
  }

  const finalScore = clamp(score, 0, 100);

  return {
    score: finalScore,
    label: finalScore >= 76
      ? "complex"
      : finalScore >= 55
        ? "moderate"
        : "simple",
    cloudHelpful: finalScore >= 72,
    localPreferred: finalScore < 72,
    drivers: Array.from(new Set(drivers)).slice(0, 8),
    messageLength: message.length,
    routeCount: Math.max(intents.length, planRoutes.length),
    memoryTurns,
    safetyLevel: riskLevel || "LOW",
    externalKnowledgeUsed: externalUsed,
    evidenceCoverage,
    ambiguityPenalty,
    intentGap: roundIntentGap(intentGap, 3),
    trainingTopRoute: cleanText(trainingTopRoute?.route || ""),
    trainingTopScore: roundIntentGap(trainingTopScore, 3),
    trainingRouteGap: roundIntentGap(trainingRouteGap, 3),
    trainingSignalSources: Array.isArray(trainingRouteProfile.signalSources)
      ? trainingRouteProfile.signalSources.slice(0, 4)
      : []
  };
}

function chooseBestLocalModel(models = [], input = {}, config = {}) {
  const ranked = models
    .filter((model) => model.type === "local" && model.available && model.id !== "care-nova-local-core")
    .map((model) => ({ model, score: scoreLocalModelFit(model, input, config) }))
    .sort((first, second) => second.score - first.score);

  return ranked[0]?.model
    || models.find((model) => model.id === "care-nova-local-core")
    || null;
}

function chooseBestCloudModel(models = [], config) {
  const available = models.filter((model) => model.available);
  const routingCandidates = available.length
    ? available
    : models.filter((model) => model.routingAvailable);

  if (!routingCandidates.length) {
    return null;
  }

  if (config.costPolicy === "premium") {
    return routingCandidates.find((model) => model.id === "azure-openai")
      || routingCandidates.find((model) => model.id === "openai")
      || routingCandidates[0];
  }

  if (config.costPolicy === "balanced") {
    return routingCandidates.find((model) => model.id === "enterprise-ai")
      || routingCandidates.find((model) => model.id === "azure-openai")
      || routingCandidates[0];
  }

  return routingCandidates.find((model) => model.costTier === "paid")
    || routingCandidates[0];
}

function buildFallbackChain({ primaryModel, assistModel, localModels, cloudModels, processingType, openSourcePlan = null }) {
  const chain = [];
  const pushModel = (model) => {
    if (model && !chain.some((item) => item.id === model.id)) {
      chain.push(model);
    }
  };

  pushModel(primaryModel);

  if (processingType !== "local") {
    for (const model of cloudModels.filter((item) => item.available || item.routingAvailable)) {
      pushModel(model);
    }
  }

  pushModel(assistModel);

  for (const model of (openSourcePlan?.participants || [])) {
    pushModel(model);
  }

  for (const model of localModels.filter((item) => item.available && item.id !== "care-nova-local-core")) {
    pushModel(model);
  }

  pushModel(localModels.find((model) => model.id === "care-nova-local-core"));

  return chain;
}

function buildExecutionPlan({ processingType, primaryModel, assistModel, localModel, openSourcePlan = null }) {
  const localSafetyModel = assistModel || localModel;
  const steps = [
    {
      step: "plan",
      model: toPublicModel(localSafetyModel),
      purpose: "Classify intent, risk, memory, and available tools."
    },
    {
      step: "retrieve",
      model: toPublicModel(localSafetyModel),
      purpose: "Use local knowledge packs, vector-style ranking, memory, records, graph facts, and cached references."
    }
  ];

  if (openSourcePlan?.participantCount > 1) {
    steps.push({
      step: "coordinate",
      model: toPublicModel(primaryModel),
      purpose: `Coordinate the open-source local ensemble across ${openSourcePlan.participants.map((model) => model.displayName).join(", ")}.`
    });
  }

  if (processingType === "hybrid") {
    steps.push({
      step: "reason",
      model: toPublicModel(primaryModel),
      purpose: "Use the configured paid/cloud model for advanced reasoning or large-context synthesis when allowed."
    });
    steps.push({
      step: "validate",
      model: toPublicModel(localSafetyModel),
      purpose: "Re-apply local safety guardrails, source boundaries, cost checks, and response discipline."
    });
  } else if (processingType === "cloud") {
    steps.push({
      step: "reason",
      model: toPublicModel(primaryModel),
      purpose: "Use the configured paid/cloud model for the primary answer."
    });
  } else {
    steps.push({
      step: "respond",
      model: toPublicModel(primaryModel),
      purpose: "Generate the response with local/free inference and deterministic safety logic."
    });
  }

  steps.push({
    step: "fallback",
    model: toPublicModel(localSafetyModel),
    purpose: "If any paid API, subscription, rate limit, or network path fails, continue locally."
  });

  return steps;
}

function toPublicModel(model) {
  if (!model) {
    return null;
  }

  return {
    id: model.id,
    displayName: model.displayName,
    type: model.type,
    family: model.family,
    model: model.model || model.defaultModel,
    status: model.status,
    configured: Boolean(model.configured),
    routingAvailable: Boolean(model.routingAvailable),
    costTier: model.costTier,
    performanceClass: model.performanceClass,
    offlineCapable: Boolean(model.offlineCapable),
    internetRequired: Boolean(model.internetRequired),
    runtimeSource: model.runtimeSource || "",
    probeStatus: model.probeStatus || ""
  };
}

function isHealthcareSafetyContext(input = {}) {
  return true;
}

function normalizePolicy(value) {
  const cleaned = cleanText(value).toLowerCase();
  const allowed = new Set(["local-first-auto", "cloud-preferred", "local-only", "offline-only"]);

  return allowed.has(cleaned) ? cleaned : "local-first-auto";
}

function normalizeCostPolicy(value) {
  const cleaned = cleanText(value).toLowerCase();
  const allowed = new Set(["lowest-cost", "balanced", "premium"]);

  return allowed.has(cleaned) ? cleaned : "lowest-cost";
}

function normalizeProviderId(value) {
  const cleaned = cleanText(value).toLowerCase().replace(/_/g, "-");

  if (cleaned === "auto") return "auto";
  if (/deepseek/.test(cleaned)) return "deepseek-r1";
  if (/llama/.test(cleaned)) return "llama-3";
  if (/mistral/.test(cleaned)) return "mistral";
  if (/gemma/.test(cleaned)) return "gemma";
  if (/qwen/.test(cleaned)) return "qwen";

  return cleaned || "auto";
}

function readFirstEnvValue(env, keys = [], fallback = "") {
  for (const key of Array.isArray(keys) ? keys : []) {
    const value = cleanText(env?.[key]);
    if (value) {
      return value;
    }
  }

  return cleanText(fallback);
}

function parseList(value) {
  return cleanText(value)
    .split(",")
    .map(normalizeProviderId)
    .filter(Boolean);
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

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
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

function toBoundedInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(cleanText(value), 10);

  if (!Number.isInteger(parsed)) {
    return fallback;
  }

  return clamp(parsed, min, max);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function roundIntentGap(value, precision = 2) {
  const factor = 10 ** precision;

  return Math.round((Number(value) || 0) * factor) / factor;
}
