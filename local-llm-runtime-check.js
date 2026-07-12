import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

import "../src/envLoader.js";

import { refreshLocalRuntimeProbe } from "../src/openSourceLocalRuntime.js";
import { getLocalAiRuntimeStatus } from "../src/localAiEngine.js";
import { getLocalReasoningAssistStatus } from "../src/localReasoningGateway.js";

const require = createRequire(import.meta.url);
const probeSnapshot = await refreshLocalRuntimeProbe();

const localAi = getLocalAiRuntimeStatus();
const localReasoning = getLocalReasoningAssistStatus();
const reachableEndpoints = collectReachableEndpoints(probeSnapshot);
const runtimeInstallations = detectKnownRuntimeInstallations(probeSnapshot);
const reachableNativeEndpoints = reachableEndpoints.filter((endpoint) => endpoint.mockRuntime !== true);
const compatibilityRuntimeDetected = reachableEndpoints.some((endpoint) => endpoint.mockRuntime === true);
const clientPackages = detectLocalRuntimeClientPackages();
const requireLocalRuntime = readBoolean(process.env.CARE_NOVA_REQUIRE_LOCAL_LLM)
  || reachableNativeEndpoints.length > 0
  || runtimeInstallations.some((runtime) => runtime.binaryInstalled);

const report = {
  localRuntimeExpectation: {
    requireLocalRuntime,
    compatibilityRuntimeDetected,
    installations: runtimeInstallations,
    clientPackages,
    reachableEndpoints
  },
  localAi: {
    mode: localAi.mode,
    localLlm: localAi.localLlm,
    hybridRouter: {
      status: localAi.hybridRouter?.status,
      summary: localAi.hybridRouter?.summary
    }
  },
  localReasoning: {
    featureEnabled: localReasoning.featureEnabled,
    enabled: localReasoning.enabled,
    configured: localReasoning.configured,
    status: localReasoning.status,
    provider: localReasoning.provider,
    model: localReasoning.model,
    runtimeFamily: localReasoning.runtimeFamily,
    endpointHost: localReasoning.endpointHost,
    participantCount: localReasoning.participantCount,
    participants: (localReasoning.participants || []).map((item) => ({
      displayName: item.displayName,
      model: item.model,
      runtimeFamily: item.runtimeFamily,
      endpointHost: item.endpointHost
    })),
    reason: localReasoning.reason
  }
};

console.log(JSON.stringify(report, null, 2));

const localLlmHealthy = !requireLocalRuntime || Boolean(localAi.localLlm?.available);
const localReasoningHealthy = !requireLocalRuntime
  || !localReasoning.featureEnabled
  || Boolean(localReasoning.configured);

if (!localLlmHealthy || !localReasoningHealthy) {
  process.exitCode = 1;
}

function detectKnownRuntimeInstallations(probeSnapshot = {}) {
  const homeDir = os.homedir();
  const localAppData = process.env.LOCALAPPDATA || path.join(homeDir, "AppData", "Local");
  const programFiles = process.env.ProgramFiles || "C:\\Program Files";
  const probesByRuntimeId = indexProbeRecordsByRuntimeId(probeSnapshot);

  return [
    buildRuntimeDetection({
      id: "ollama",
      displayName: "Ollama",
      binaryInstalled: existsSync(path.join(localAppData, "Programs", "Ollama", "ollama.exe"))
        || existsSync(path.join(programFiles, "Ollama", "ollama.exe")),
      probeRecord: probesByRuntimeId.get("ollama")
    }),
    buildRuntimeDetection({
      id: "lm-studio",
      displayName: "LM Studio",
      binaryInstalled: existsSync(path.join(localAppData, "Programs", "LM Studio", "LM Studio.exe"))
        || existsSync(path.join(localAppData, "lm-studio", "LM Studio.exe")),
      probeRecord: probesByRuntimeId.get("lm-studio")
    })
  ];
}

function buildRuntimeDetection({ id, displayName, binaryInstalled = false, probeRecord = null }) {
  const reachable = Boolean(probeRecord?.reachable);
  const mockRuntime = probeRecord?.mockRuntime === true;
  const binaryPresent = Boolean(binaryInstalled);
  const runtimeAvailable = Boolean(binaryPresent || (reachable && !mockRuntime));

  return {
    id,
    displayName,
    installed: binaryPresent,
    binaryInstalled: binaryPresent,
    reachable,
    runtimeAvailable,
    detectionSource: runtimeAvailable
      ? binaryPresent && reachable
        ? "binary+endpoint"
        : binaryPresent
          ? "binary"
          : "endpoint"
      : mockRuntime
        ? "mock-endpoint"
      : "none",
    endpoint: probeRecord?.endpoint || "",
    runtimeFamily: probeRecord?.runtimeFamily || "",
    mockRuntime,
    modelCount: Array.isArray(probeRecord?.modelIds) ? probeRecord.modelIds.length : 0,
    checkedAt: probeRecord?.checkedAt || "",
    probeStatus: probeRecord?.status || "",
    status: mockRuntime
      ? "mock-compatibility-runtime-detected"
      : reachable
      ? binaryPresent
        ? "binary-confirmed-runtime-ready"
        : "compatible-runtime-ready"
      : binaryPresent
        ? "binary-found-runtime-not-ready"
        : "not-detected"
  };
}

function indexProbeRecordsByRuntimeId(probeSnapshot = {}) {
  const records = Object.values(probeSnapshot?.endpoints || {});
  const map = new Map();

  for (const record of records) {
    const runtimeId = String(record?.id || "").trim();
    if (!runtimeId || map.has(runtimeId)) {
      continue;
    }
    map.set(runtimeId, record);
  }

  return map;
}

function collectReachableEndpoints(probeSnapshot = {}) {
  return Object.values(probeSnapshot?.endpoints || {})
    .filter((endpoint) => endpoint?.reachable)
    .map((endpoint) => ({
      id: endpoint.id,
      displayName: endpoint.displayName,
      endpoint: endpoint.endpoint,
      source: endpoint.source,
      runtimeFamily: endpoint.runtimeFamily,
      mockRuntime: endpoint.mockRuntime === true,
      modelCount: Array.isArray(endpoint.modelIds) ? endpoint.modelIds.length : 0,
      checkedAt: endpoint.checkedAt
    }));
}

function detectLocalRuntimeClientPackages() {
  return [
    {
      id: "ollama",
      displayName: "Ollama Node client",
      purpose: "Native localhost Ollama integration"
    },
    {
      id: "openai",
      displayName: "OpenAI-compatible Node client",
      purpose: "LM Studio or other OpenAI-compatible local endpoints"
    }
  ].map((client) => {
    try {
      const manifest = readInstalledPackageManifest(client.id);
      return {
        ...client,
        installed: true,
        version: String(manifest?.version || "")
      };
    } catch {
      return {
        ...client,
        installed: false,
        version: ""
      };
    }
  });
}

function readInstalledPackageManifest(packageId) {
  const entryPath = require.resolve(packageId);
  let currentDir = path.dirname(entryPath);

  for (let index = 0; index < 6; index += 1) {
    const manifestPath = path.join(currentDir, "package.json");
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      if (manifest?.name === packageId) {
        return manifest;
      }
    }

    const nextDir = path.dirname(currentDir);
    if (!nextDir || nextDir === currentDir) {
      break;
    }
    currentDir = nextDir;
  }

  throw new Error(`Package manifest could not be resolved for ${packageId}.`);
}

function readBoolean(value) {
  return /^(1|true|yes|on)$/i.test(String(value ?? "").trim());
}
