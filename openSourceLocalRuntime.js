import { getConnectivityPolicy, isLocalEndpoint } from "./runtimeConnectivity.js";

export const LOCAL_OPEN_SOURCE_RUNTIME_VERSION = "1.0.0";

const DEFAULT_PROBE_TIMEOUT_MS = 1500;
const DEFAULT_PROBE_INTERVAL_MS = 45000;
const DEFAULT_PROBE_STALE_REFRESH_MS = 12000;
const DEFAULT_RUNTIME_FAILURE_COOLDOWN_MS = 120000;
const DEFAULT_LOCAL_RUNTIME_REQUEST_TIMEOUT_MS = 6000;

const DEFAULT_RUNTIME_CANDIDATES = [
  {
    id: "ollama",
    displayName: "Ollama",
    endpoint: "http://127.0.0.1:11434/v1/chat/completions"
  },
  {
    id: "lm-studio",
    displayName: "LM Studio",
    endpoint: "http://127.0.0.1:1234/v1/chat/completions"
  }
];

const MODEL_ALIASES = {
  "deepseek-r1": [
    "deepseek-r1",
    "deepseek-r1:latest",
    "deepseek-r1-distill-llama-8b",
    "deepseek-r1-distill-qwen-7b"
  ],
  "llama-3": [
    "llama3",
    "llama3:latest",
    "llama-3",
    "llama3.1",
    "llama3.1:latest",
    "meta-llama-3"
  ],
  mistral: [
    "mistral",
    "mistral:latest",
    "mistral-7b-instruct",
    "mistral-instruct"
  ],
  gemma: [
    "gemma",
    "gemma:latest",
    "gemma2",
    "gemma2:latest",
    "gemma-2"
  ],
  qwen: [
    "qwen",
    "qwen:latest",
    "qwen2.5",
    "qwen2.5:latest",
    "qwen-2.5"
  ]
};

let probeTimer = null;
let probeInFlight = null;
let probeState = {
  version: LOCAL_OPEN_SOURCE_RUNTIME_VERSION,
  started: false,
  lastCheckedAt: "",
  endpoints: {}
};

export function normalizeChatCompletionsEndpoint(value) {
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

  if (/\/models$/i.test(endpoint)) {
    return endpoint.replace(/\/models$/i, "/chat/completions");
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

  return endpoint;
}

export function getLocalRuntimeCandidates(env = process.env) {
  const candidates = [];
  const autoDetect = readBooleanDefault(env.CARE_NOVA_AUTO_DETECT_LOCAL_RUNTIME, true);

  const explicitCandidates = [
    {
      id: "local-llm",
      displayName: "Local OpenAI-Compatible Runtime",
      endpoint: env.LOCAL_LLM_URL || env.CARE_NOVA_LOCAL_LLM_URL
    },
    {
      id: "ollama",
      displayName: "Ollama",
      endpoint: env.OLLAMA_BASE_URL
    },
    {
      id: "lm-studio",
      displayName: "LM Studio",
      endpoint: env.LM_STUDIO_BASE_URL
    }
  ];

  for (const candidate of explicitCandidates) {
    pushRuntimeCandidate(candidates, candidate, "env");
  }

  if (autoDetect) {
    for (const candidate of DEFAULT_RUNTIME_CANDIDATES) {
      pushRuntimeCandidate(candidates, candidate, "auto");
    }
  }

  return candidates;
}

export function getLocalRuntimeProbeSnapshot() {
  return {
    version: probeState.version,
    started: probeState.started,
    lastCheckedAt: probeState.lastCheckedAt,
    endpoints: Object.fromEntries(
      Object.entries(probeState.endpoints).map(([key, value]) => [key, { ...value, modelIds: [...(value.modelIds || [])] }])
    )
  };
}

export function shouldRefreshLocalRuntimeProbe(env = process.env, options = {}) {
  const snapshot = options.snapshot || getLocalRuntimeProbeSnapshot();
  const maxAgeMs = clampInteger(
    options.maxAgeMs ?? env.CARE_NOVA_LOCAL_RUNTIME_STALE_REFRESH_MS,
    1000,
    300000,
    DEFAULT_PROBE_STALE_REFRESH_MS
  );
  const candidates = getLocalRuntimeCandidates(env).filter((candidate) => isLocalEndpoint(candidate.endpoint));

  if (!candidates.length) {
    return false;
  }

  const endpointRecords = Object.values(snapshot?.endpoints || {});
  const lastCheckedMs = toFiniteEpochMs(snapshot?.lastCheckedAt);
  const ageMs = lastCheckedMs ? Math.max(0, Date.now() - lastCheckedMs) : Number.POSITIVE_INFINITY;
  const hasReachableEndpoint = endpointRecords.some((record) => record?.reachable);
  const hasGenerationCooldown = endpointRecords.some((record) => record?.generationCooldownActive);

  return !snapshot?.started
    || ageMs >= maxAgeMs
    || (!hasReachableEndpoint && !hasGenerationCooldown && ageMs >= maxAgeMs);
}

export async function ensureLocalRuntimeProbeFresh(env = process.env, options = {}) {
  const snapshot = options.snapshot || getLocalRuntimeProbeSnapshot();

  if (!shouldRefreshLocalRuntimeProbe(env, { ...options, snapshot })) {
    return snapshot;
  }

  return refreshLocalRuntimeProbe(buildProbeRefreshEnvironment(env, options));
}

export function refreshLocalRuntimeProbeInBackground(env = process.env, options = {}) {
  const snapshot = options.snapshot || getLocalRuntimeProbeSnapshot();

  if (!shouldRefreshLocalRuntimeProbe(env, { ...options, snapshot })) {
    return false;
  }

  refreshLocalRuntimeProbe(buildProbeRefreshEnvironment(env, options)).catch(() => {});
  return true;
}

export function getLocalRuntimeGenerationStatus(endpoint, env = process.env, snapshot = getLocalRuntimeProbeSnapshot()) {
  const normalizedEndpoint = cleanText(normalizeChatCompletionsEndpoint(endpoint));
  const endpointIsLocal = isLocalEndpoint(normalizedEndpoint);
  const record = normalizedEndpoint ? snapshot?.endpoints?.[normalizedEndpoint] || {} : {};
  const generationState = normalizeGenerationCooldown(record, endpointIsLocal);

  return {
    endpoint: normalizedEndpoint,
    endpointIsLocal,
    ready: Boolean(normalizedEndpoint) && (!endpointIsLocal || !generationState.generationCooldownActive),
    ...generationState
  };
}

export function recordLocalRuntimeGenerationSuccess(endpoint, options = {}) {
  const normalizedEndpoint = cleanText(normalizeChatCompletionsEndpoint(endpoint));

  if (!normalizedEndpoint || !isLocalEndpoint(normalizedEndpoint)) {
    return null;
  }

  const nowIso = new Date().toISOString();
  return updateEndpointGenerationState(normalizedEndpoint, (current = {}) => ({
    ...current,
    generationCooldownUntil: "",
    generationCooldownActive: false,
    generationCooldownRemainingMs: 0,
    lastGenerationSuccessAt: nowIso,
    lastGenerationError: "",
    lastGenerationLatencyMs: toFiniteLatencyMs(options.latencyMs)
  }));
}

export function recordLocalRuntimeGenerationFailure(endpoint, error, env = process.env, options = {}) {
  const normalizedEndpoint = cleanText(normalizeChatCompletionsEndpoint(endpoint));

  if (!normalizedEndpoint || !isLocalEndpoint(normalizedEndpoint)) {
    return null;
  }

  const cooldownMs = clampInteger(
    env.CARE_NOVA_LOCAL_RUNTIME_FAILURE_COOLDOWN_MS,
    5000,
    600000,
    DEFAULT_RUNTIME_FAILURE_COOLDOWN_MS
  );
  const now = Date.now();

  return updateEndpointGenerationState(normalizedEndpoint, (current = {}) => ({
    ...current,
    generationCooldownUntil: new Date(now + cooldownMs).toISOString(),
    lastGenerationFailureAt: new Date(now).toISOString(),
    lastGenerationError: cleanText(error?.message || error).slice(0, 240),
    lastGenerationLatencyMs: toFiniteLatencyMs(options.latencyMs)
  }));
}

export function resolveRuntimeRequestTimeout(endpoint, requestedTimeoutMs, env = process.env) {
  const normalizedRequestedTimeout = clampInteger(
    requestedTimeoutMs,
    2000,
    120000,
    DEFAULT_LOCAL_RUNTIME_REQUEST_TIMEOUT_MS
  );

  if (!isLocalEndpoint(endpoint)) {
    return normalizedRequestedTimeout;
  }

  return clampInteger(
    env.CARE_NOVA_LOCAL_RUNTIME_REQUEST_TIMEOUT_MS,
    1500,
    60000,
    Math.min(normalizedRequestedTimeout, DEFAULT_LOCAL_RUNTIME_REQUEST_TIMEOUT_MS)
  );
}

export async function refreshLocalRuntimeProbe(env = process.env) {
  if (probeInFlight) {
    return probeInFlight;
  }

  probeInFlight = (async () => {
    const candidates = getLocalRuntimeCandidates(env).filter((candidate) => isLocalEndpoint(candidate.endpoint));
    const endpointEntries = {};
    const checkedAt = new Date().toISOString();
    const timeoutMs = clampInteger(env.CARE_NOVA_LOCAL_RUNTIME_PROBE_TIMEOUT_MS, 500, 5000, DEFAULT_PROBE_TIMEOUT_MS);

    for (const candidate of candidates) {
      const status = await probeRuntimeEndpoint(candidate.endpoint, timeoutMs);
      const previousEntry = probeState.endpoints[candidate.endpoint] || {};
      endpointEntries[candidate.endpoint] = {
        id: candidate.id,
        displayName: candidate.displayName,
        endpoint: candidate.endpoint,
        source: candidate.source,
        checkedAt,
        ...status,
        ...normalizeGenerationCooldown(previousEntry, true)
      };
    }

    probeState = {
      version: LOCAL_OPEN_SOURCE_RUNTIME_VERSION,
      started: true,
      lastCheckedAt: checkedAt,
      endpoints: endpointEntries
    };

    return getLocalRuntimeProbeSnapshot();
  })();

  try {
    return await probeInFlight;
  } finally {
    probeInFlight = null;
  }
}

export function startLocalRuntimeProbeLoop(env = process.env, options = {}) {
  if (probeTimer) {
    return probeTimer;
  }

  const intervalMs = clampInteger(
    options.intervalMs ?? env.CARE_NOVA_LOCAL_RUNTIME_PROBE_INTERVAL_MS,
    5000,
    300000,
    DEFAULT_PROBE_INTERVAL_MS
  );

  refreshLocalRuntimeProbe(env).catch(() => {});
  probeTimer = setInterval(() => {
    refreshLocalRuntimeProbe(env).catch(() => {});
  }, intervalMs);

  if (typeof probeTimer.unref === "function") {
    probeTimer.unref();
  }

  return probeTimer;
}

export function stopLocalRuntimeProbeLoop() {
  if (probeTimer) {
    clearInterval(probeTimer);
    probeTimer = null;
  }
}

export function resolveOpenSourceLocalAdapter(definition, env = process.env, options = {}) {
  const probeSnapshot = options.probeSnapshot || getLocalRuntimeProbeSnapshot();
  const sharedEndpoint = normalizeChatCompletionsEndpoint(
    env.LOCAL_LLM_URL || env.CARE_NOVA_LOCAL_LLM_URL || env.OLLAMA_BASE_URL || env.LM_STUDIO_BASE_URL
  );
  const sharedModelName = cleanText(env.LOCAL_LLM_MODEL || env.CARE_NOVA_LOCAL_LLM_MODEL || env.DEEPSEEK_MODEL);
  const sharedApiKey = cleanText(env.LOCAL_LLM_API_KEY || env.CARE_NOVA_LLM_API_KEY || env.DEEPSEEK_API_KEY);
  const endpointFromEnv = normalizeChatCompletionsEndpoint(
    readFirstEnvValue(env, definition.envEndpointKeys, sharedEndpoint)
  );
  const candidate = endpointFromEnv
    ? {
      id: "explicit-endpoint",
      displayName: "Explicit Local LLM Endpoint",
      endpoint: endpointFromEnv,
      source: "env"
    }
    : chooseAutoDetectedCandidate(probeSnapshot, env);
  const endpoint = cleanText(candidate?.endpoint);
  const endpointIsLocal = isLocalEndpoint(endpoint);
  const probeRecord = endpointIsLocal ? findProbeRecord(endpoint, probeSnapshot) : null;
  const discoveredModel = findMatchingDiscoveredModel(definition.id, probeRecord?.modelIds || []);
  const model = cleanText(
    readFirstEnvValue(env, definition.envModelKeys, sharedModelName || discoveredModel || definition.defaultModel)
  );
  const mockRuntimeDetected = Boolean(probeRecord?.mockRuntime);
  const generationStatus = endpointIsLocal ? getLocalRuntimeGenerationStatus(endpoint, env, probeSnapshot) : null;
  const modelAvailableInRuntime = endpointIsLocal
    ? isModelAvailableInRuntime(model, probeRecord?.modelIds || [])
    : Boolean(model);
  const apiKey = cleanText(readFirstEnvValue(env, definition.envApiKeyKeys, sharedApiKey));
  const apiKeyHeader = cleanText(env.CARE_NOVA_LOCAL_REASONING_API_KEY_HEADER);
  const authScheme = cleanText(env.CARE_NOVA_LOCAL_REASONING_API_AUTH_SCHEME || "Bearer");
  const connectivity = options.connectivity || getConnectivityPolicy(env);
  const keyRequirementMet = endpointIsLocal || !endpoint || Boolean(apiKey);
  const configured = Boolean(endpoint && model && keyRequirementMet);
  const available = configured && (
    endpointIsLocal
      ? (Boolean(probeRecord?.reachable) || readBooleanDefault(env.CARE_NOVA_ASSUME_LOCAL_RUNTIME, false))
        && modelAvailableInRuntime
        && !mockRuntimeDetected
        && !generationStatus?.generationCooldownActive
      : connectivity.networkAllowed
  );

  return {
    endpoint,
    model,
    apiKey,
    apiKeyHeader,
    authScheme,
    endpointIsLocal,
    configured,
    available,
    runtimeSource: candidate?.source || "",
    runtimeId: candidate?.id || "",
    runtimeDisplayName: candidate?.displayName || "",
    runtimeFamily: probeRecord?.runtimeFamily || (endpointIsLocal ? "local-openai-compatible" : "remote-openai-compatible"),
    mockRuntimeDetected,
    probeStatus: endpointIsLocal
      ? generationStatus?.generationCooldownActive
        ? "generation-cooldown"
        : probeRecord?.status || "unverified"
      : configured
        ? "remote-configured"
        : "missing-configuration",
    checkedAt: probeRecord?.checkedAt || "",
    modelAvailableInRuntime,
    discoveredModelCount: Array.isArray(probeRecord?.modelIds) ? probeRecord.modelIds.length : 0,
    discoveredModelIds: Array.isArray(probeRecord?.modelIds) ? [...probeRecord.modelIds] : [],
    generationCooldownActive: Boolean(generationStatus?.generationCooldownActive),
    generationCooldownRemainingMs: Number(generationStatus?.generationCooldownRemainingMs || 0),
    generationCooldownUntil: generationStatus?.generationCooldownUntil || "",
    lastGenerationFailureAt: generationStatus?.lastGenerationFailureAt || "",
    lastGenerationSuccessAt: generationStatus?.lastGenerationSuccessAt || "",
    lastGenerationError: generationStatus?.lastGenerationError || "",
    lastGenerationLatencyMs: Number(generationStatus?.lastGenerationLatencyMs || 0),
    missing: buildMissingFields({ endpoint, model, endpointIsLocal, apiKey, modelAvailableInRuntime, hasDiscoveredModels: Array.isArray(probeRecord?.modelIds) && probeRecord.modelIds.length > 0 })
  };
}

function chooseAutoDetectedCandidate(probeSnapshot, env) {
  const candidates = getLocalRuntimeCandidates(env).filter((candidate) => isLocalEndpoint(candidate.endpoint));
  const reachable = candidates.find((candidate) => findProbeRecord(candidate.endpoint, probeSnapshot)?.reachable);

  if (reachable) {
    return reachable;
  }

  return candidates[0] || null;
}

function buildMissingFields({ endpoint, model, endpointIsLocal, apiKey, modelAvailableInRuntime, hasDiscoveredModels }) {
  const missing = [];

  if (!endpoint) {
    missing.push("LOCAL_RUNTIME_ENDPOINT");
  }
  if (!model) {
    missing.push("LOCAL_RUNTIME_MODEL");
  }
  if (endpointIsLocal && hasDiscoveredModels && !modelAvailableInRuntime) {
    missing.push("LOCAL_RUNTIME_MODEL_NOT_LOADED");
  }
  if (endpoint && !endpointIsLocal && !apiKey) {
    missing.push("LOCAL_RUNTIME_API_KEY");
  }

  return missing;
}

function isModelAvailableInRuntime(model, discoveredModelIds = []) {
  const selectedModel = cleanText(model).toLowerCase();

  if (!selectedModel) {
    return false;
  }

  if (!Array.isArray(discoveredModelIds) || !discoveredModelIds.length) {
    return true;
  }

  return discoveredModelIds.some((candidate) => {
    const normalizedCandidate = cleanText(candidate).toLowerCase();
    return normalizedCandidate === selectedModel
      || normalizedCandidate.includes(selectedModel)
      || selectedModel.includes(normalizedCandidate);
  });
}

async function probeRuntimeEndpoint(endpoint, timeoutMs) {
  const urls = deriveProbeUrls(endpoint);
  const errors = [];

  for (const candidate of urls) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(candidate.url, {
        method: "GET",
        headers: {
          Accept: "application/json"
        },
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`${candidate.kind} returned ${response.status}`);
      }

      const payload = await response.json();
      const modelIds = extractModelIds(payload);
      const mockRuntime = detectMockRuntime(payload, response.headers);
      const runtimeFamily = mockRuntime
        ? cleanText(payload?.runtime?.family || response.headers.get("x-care-nova-runtime-family") || "care-nova-mock-openai-compatible")
        : candidate.runtimeFamily;

      return {
        reachable: true,
        status: mockRuntime ? "mock-runtime" : "reachable",
        runtimeFamily,
        mockRuntime,
        modelIds,
        detail: mockRuntime
          ? "Care Nova compatibility runtime responded. Native Ollama or LM Studio was not confirmed."
          : modelIds.length
            ? `${candidate.runtimeFamily} runtime responded with ${modelIds.length} model(s).`
            : `${candidate.runtimeFamily} runtime responded but did not list models.`
      };
    } catch (error) {
      errors.push(cleanText(error?.message || `${candidate.kind} failed`));
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    reachable: false,
    status: errors.length ? "unreachable" : "unverified",
    runtimeFamily: "",
    mockRuntime: false,
    modelIds: [],
    detail: errors.join(" | ")
  };
}

function deriveProbeUrls(endpoint) {
  const normalized = normalizeChatCompletionsEndpoint(endpoint);
  const probeUrls = [];

  try {
    const parsed = new URL(normalized);
    const origin = parsed.origin;
    const chatPath = parsed.pathname.replace(/\/$/, "");
    const modelsPath = /\/chat\/completions$/i.test(chatPath)
      ? chatPath.replace(/\/chat\/completions$/i, "/models")
      : "/v1/models";

    probeUrls.push({
      kind: "models",
      runtimeFamily: "openai-compatible",
      url: `${origin}${modelsPath}`
    });
    probeUrls.push({
      kind: "tags",
      runtimeFamily: "ollama-compatible",
      url: `${origin}/api/tags`
    });
  } catch {
    return [];
  }

  return dedupeBy(probeUrls, (item) => item.url);
}

function extractModelIds(payload) {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  if (Array.isArray(payload.data)) {
    return dedupeBy(
      payload.data
        .map((entry) => cleanText(entry?.id || entry?.name || entry?.model))
        .filter(Boolean),
      (item) => item.toLowerCase()
    );
  }

  if (Array.isArray(payload.models)) {
    return dedupeBy(
      payload.models
        .map((entry) => cleanText(entry?.name || entry?.model || entry?.id))
        .filter(Boolean),
      (item) => item.toLowerCase()
    );
  }

  return [];
}

function detectMockRuntime(payload, headers) {
  const runtimeHeader = cleanText(headers?.get?.("x-care-nova-runtime") || "");
  const runtimeFamilyHeader = cleanText(headers?.get?.("x-care-nova-runtime-family") || "");
  const payloadKind = cleanText(payload?.runtime?.kind || "");
  const payloadFamily = cleanText(payload?.runtime?.family || "");
  const payloadId = cleanText(payload?.runtime?.id || "");

  return /mock/i.test(runtimeHeader)
    || /mock/i.test(runtimeFamilyHeader)
    || /mock/i.test(payloadKind)
    || /mock/i.test(payloadFamily)
    || /care-nova-mock/i.test(payloadId);
}

function findMatchingDiscoveredModel(modelId, discoveredModelIds = []) {
  const aliases = MODEL_ALIASES[modelId] || [modelId];
  const normalizedDiscovered = discoveredModelIds.map((item) => ({
    raw: item,
    normalized: cleanText(item).toLowerCase()
  }));

  for (const alias of aliases) {
    const normalizedAlias = cleanText(alias).toLowerCase();
    const exact = normalizedDiscovered.find((item) => item.normalized === normalizedAlias);

    if (exact) {
      return exact.raw;
    }
  }

  for (const alias of aliases) {
    const normalizedAlias = cleanText(alias).toLowerCase();
    const partial = normalizedDiscovered.find((item) => item.normalized.includes(normalizedAlias));

    if (partial) {
      return partial.raw;
    }
  }

  return "";
}

function findProbeRecord(endpoint, probeSnapshot = getLocalRuntimeProbeSnapshot()) {
  const normalized = cleanText(normalizeChatCompletionsEndpoint(endpoint));
  return probeSnapshot?.endpoints?.[normalized] || null;
}

function pushRuntimeCandidate(target, candidate, source) {
  const endpoint = normalizeChatCompletionsEndpoint(candidate?.endpoint);

  if (!endpoint) {
    return;
  }

  const normalizedSource = cleanText(source || candidate?.source || "auto");
  const displayName = cleanText(candidate?.displayName || candidate?.id || "Local Runtime");
  const id = cleanText(candidate?.id || displayName.toLowerCase().replace(/\s+/g, "-"));

  if (target.some((item) => item.endpoint === endpoint)) {
    return;
  }

  target.push({
    id,
    displayName,
    endpoint,
    source: normalizedSource
  });
}

function dedupeBy(items = [], keySelector = (value) => value) {
  const seen = new Set();
  const result = [];

  for (const item of items) {
    const key = keySelector(item);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
  }

  return result;
}

function buildProbeRefreshEnvironment(env = process.env, options = {}) {
  if (options.probeTimeoutMs === undefined || options.probeTimeoutMs === null) {
    return env;
  }

  return {
    ...env,
    CARE_NOVA_LOCAL_RUNTIME_PROBE_TIMEOUT_MS: String(clampInteger(
      options.probeTimeoutMs,
      250,
      5000,
      DEFAULT_PROBE_TIMEOUT_MS
    ))
  };
}

function normalizeGenerationCooldown(record = {}, endpointIsLocal = false) {
  const cooldownUntilMs = toFiniteEpochMs(record?.generationCooldownUntil);
  const cooldownUntil = cooldownUntilMs ? new Date(cooldownUntilMs).toISOString() : "";
  const cooldownActive = Boolean(endpointIsLocal && cooldownUntilMs && cooldownUntilMs > Date.now());

  return {
    generationCooldownActive: cooldownActive,
    generationCooldownRemainingMs: cooldownActive ? cooldownUntilMs - Date.now() : 0,
    generationCooldownUntil: cooldownUntil,
    lastGenerationFailureAt: cleanText(record?.lastGenerationFailureAt || ""),
    lastGenerationSuccessAt: cleanText(record?.lastGenerationSuccessAt || ""),
    lastGenerationError: cleanText(record?.lastGenerationError || ""),
    lastGenerationLatencyMs: toFiniteLatencyMs(record?.lastGenerationLatencyMs)
  };
}

function updateEndpointGenerationState(endpoint, updater) {
  const normalizedEndpoint = cleanText(normalizeChatCompletionsEndpoint(endpoint));

  if (!normalizedEndpoint) {
    return null;
  }

  const current = probeState.endpoints[normalizedEndpoint] || {
    endpoint: normalizedEndpoint,
    id: "",
    displayName: "",
    source: "",
    checkedAt: "",
    reachable: false,
    status: "unverified",
    runtimeFamily: "",
    mockRuntime: false,
    modelIds: [],
    detail: ""
  };
  const next = {
    ...current,
    ...(typeof updater === "function" ? updater(current) : updater)
  };

  probeState = {
    ...probeState,
    endpoints: {
      ...probeState.endpoints,
      [normalizedEndpoint]: {
        ...next,
        ...normalizeGenerationCooldown(next, isLocalEndpoint(normalizedEndpoint))
      }
    }
  };

  return probeState.endpoints[normalizedEndpoint];
}

function toFiniteEpochMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 0 ? value : 0;
  }

  const parsed = Date.parse(cleanText(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function toFiniteLatencyMs(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(cleanText(value), 10);
  const number = Number.isInteger(parsed) ? parsed : fallback;
  return Math.min(max, Math.max(min, number));
}

function readBooleanDefault(value, defaultValue = false) {
  const cleaned = cleanText(value);

  if (!cleaned) {
    return defaultValue;
  }

  return /^(1|true|yes|on)$/i.test(cleaned);
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

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
