import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { analyzeHealthQuery } from "../src/healthEngine.js";
import { getTemporaryCloudLlmStatus } from "../src/cloudLlmGateway.js";
import { getHybridModelRouterStatus } from "../src/hybridModelRouter.js";
import { getModelHealthStatus } from "../src/localAiEngine.js";
import { getLocalReasoningAssistStatus, tryEnhanceAnalyzeResultWithLocalReasoning } from "../src/localReasoningGateway.js";
import { refreshLocalRuntimeProbe } from "../src/openSourceLocalRuntime.js";
import { getSpecialistLlmAgentStatus } from "../src/specialistLlmGateway.js";

const workspaceNode = process.execPath;
const mockRuntimeScript = fileURLToPath(new URL("./mock-ollama-runtime.js", import.meta.url));
const runtimeCheckScript = fileURLToPath(new URL("./local-llm-runtime-check.js", import.meta.url));

await runCompatibilityRuntimeDetectionRegression();
await runLocalRuntimeCooldownRegression();
await runLateRuntimeAvailabilityCacheRefreshRegression();

console.log("Local LLM runtime check regression passed.");

async function runCompatibilityRuntimeDetectionRegression() {
  const mockPort = 11435;
  const mockBaseUrl = `http://127.0.0.1:${mockPort}`;
  const mockRuntime = startMockRuntime({
    MOCK_OLLAMA_PORT: String(mockPort)
  });

  try {
    await waitForUrl(`${mockBaseUrl}/api/tags`);

    const nativeLocalOnlyCloudEnv = {
      ...process.env,
      CARE_NOVA_AUTO_DETECT_LOCAL_RUNTIME: "false",
      CARE_NOVA_ENABLE_ALL_MODELS: "true",
      CARE_NOVA_FORCE_OFFLINE: "false",
      CARE_NOVA_INTERNET_AVAILABLE: "true",
      CARE_NOVA_ONLINE_MODE: "true",
      CARE_NOVA_PAID_MODELS_ENABLED: "true",
      CARE_NOVA_CLOUD_MODELS_ENABLED: "true",
      CARE_NOVA_OPENAI_ENABLED: "true",
      LOCAL_LLM_URL: "",
      CARE_NOVA_LOCAL_LLM_URL: "",
      OLLAMA_BASE_URL: `${mockBaseUrl}/v1/chat/completions`,
      LM_STUDIO_BASE_URL: "",
      OPENAI_BASE_URL: "",
      OPENAI_API_KEY: ""
    };

    const hybridRouter = getHybridModelRouterStatus(nativeLocalOnlyCloudEnv);
    assert.equal(
      hybridRouter.summary.routableCloudModels,
      0,
      "Local LLM runtime check regression: OLLAMA_BASE_URL alone must not be promoted into a routable paid/cloud provider path."
    );

    const tempCloudStatus = getTemporaryCloudLlmStatus(nativeLocalOnlyCloudEnv);
    assert.equal(
      tempCloudStatus.configured,
      false,
      "Local LLM runtime check regression: the OpenAI cloud rewrite must not auto-configure itself from the native Ollama runtime endpoint."
    );

    const report = await runRuntimeCheck({
      CARE_NOVA_AUTO_DETECT_LOCAL_RUNTIME: "false",
      LOCAL_LLM_URL: "",
      CARE_NOVA_LOCAL_LLM_URL: "",
      OLLAMA_BASE_URL: `${mockBaseUrl}/v1/chat/completions`,
      LM_STUDIO_BASE_URL: "",
      CARE_NOVA_DEEPSEEK_URL: "",
      DEEPSEEK_BASE_URL: "",
      CARE_NOVA_LLAMA_URL: "",
      LLAMA_BASE_URL: "",
      CARE_NOVA_MISTRAL_URL: "",
      MISTRAL_BASE_URL: "",
      CARE_NOVA_GEMMA_URL: "",
      GEMMA_BASE_URL: "",
      CARE_NOVA_QWEN_URL: "",
      QWEN_BASE_URL: ""
    });

    const ollamaRuntime = Array.isArray(report?.localRuntimeExpectation?.installations)
      ? report.localRuntimeExpectation.installations.find((runtime) => runtime?.id === "ollama")
      : null;

    assert.ok(ollamaRuntime, "Local LLM runtime check regression: expected an Ollama-compatible runtime entry.");
    assert.equal(
      ollamaRuntime.installed,
      false,
      "Local LLM runtime check regression: endpoint reachability must not mark the Ollama binary as installed."
    );
    assert.equal(
      ollamaRuntime.binaryInstalled,
      false,
      "Local LLM runtime check regression: the Ollama binary should remain unconfirmed in endpoint-only mode."
    );
    assert.equal(
      ollamaRuntime.reachable,
      true,
      "Local LLM runtime check regression: the mock local runtime endpoint should be detected as reachable."
    );
    assert.equal(
      ollamaRuntime.runtimeAvailable,
      false,
      "Local LLM runtime check regression: the mock compatibility runtime must not be treated as a native local LLM runtime."
    );
    assert.equal(
      ollamaRuntime.detectionSource,
      "mock-endpoint",
      "Local LLM runtime check regression: mock compatibility detection should be labeled explicitly."
    );
    assert.equal(
      ollamaRuntime.status,
      "mock-compatibility-runtime-detected",
      "Local LLM runtime check regression: the mock compatibility runtime should be reported explicitly."
    );
    assert.equal(
      report?.localRuntimeExpectation?.compatibilityRuntimeDetected,
      true,
      "Local LLM runtime check regression: the top-level runtime report should flag the compatibility runtime."
    );
  } finally {
    await stopMockRuntime(mockRuntime);
  }
}

async function runLocalRuntimeCooldownRegression() {
  const slowPort = 11436;
  const slowBaseUrl = `http://127.0.0.1:${slowPort}`;
  const slowRuntime = startMockRuntime({
    MOCK_OLLAMA_PORT: String(slowPort),
    MOCK_OLLAMA_CHAT_DELAY_MS: "5000",
    MOCK_OLLAMA_RUNTIME_ID: "care-nova-native-local-runtime",
    MOCK_OLLAMA_RUNTIME_KIND: "native-local-runtime",
    MOCK_OLLAMA_RUNTIME_FAMILY: "ollama-compatible",
    MOCK_OLLAMA_RUNTIME_DISPLAY_NAME: "Care Nova Native Local Runtime"
  });

  try {
    await waitForUrl(`${slowBaseUrl}/api/tags`);

    const env = {
      ...process.env,
      CARE_NOVA_AUTO_DETECT_LOCAL_RUNTIME: "false",
      LOCAL_LLM_ENABLED: "true",
      LOCAL_LLM_URL: "",
      CARE_NOVA_LOCAL_LLM_URL: "",
      OLLAMA_BASE_URL: `${slowBaseUrl}/v1/chat/completions`,
      LM_STUDIO_BASE_URL: "",
      CARE_NOVA_DEEPSEEK_URL: "",
      DEEPSEEK_BASE_URL: "",
      CARE_NOVA_LLAMA_URL: "",
      LLAMA_BASE_URL: "",
      CARE_NOVA_MISTRAL_URL: "",
      MISTRAL_BASE_URL: "",
      CARE_NOVA_GEMMA_URL: "",
      GEMMA_BASE_URL: "",
      CARE_NOVA_QWEN_URL: "",
      QWEN_BASE_URL: "",
      CARE_NOVA_LOCAL_REASONING_ASSIST_ENABLED: "true",
      CARE_NOVA_LOCAL_REASONING_ASSIST_TIMEOUT_MS: "2000",
      CARE_NOVA_SPECIALIST_LLM_AGENTS_ENABLED: "true",
      CARE_NOVA_SPECIALIST_LLM_AGENTS_TIMEOUT_MS: "2000",
      CARE_NOVA_LOCAL_RUNTIME_REQUEST_TIMEOUT_MS: "2000",
      CARE_NOVA_LOCAL_RUNTIME_FAILURE_COOLDOWN_MS: "60000"
    };

    await refreshLocalRuntimeProbe(env);

    const initialModelHealth = getModelHealthStatus(env);
    assert.equal(
      initialModelHealth.available,
      true,
      "Local runtime cooldown regression: a native local runtime with listed models should be treated as available before the chat timeout occurs."
    );

    const initialReasoningStatus = getLocalReasoningAssistStatus(
      env,
      { preferredAgent: "SPECIALIST_DOCTOR_AGENT" },
      buildMinimalAnalysisResult()
    );
    assert.equal(
      initialReasoningStatus.status,
      "ready",
      "Local runtime cooldown regression: reasoning assist should begin in the ready state before a runtime timeout."
    );

    const firstStart = Date.now();
    const firstExecution = await tryEnhanceAnalyzeResultWithLocalReasoning({
      payload: buildMinimalPayload(),
      result: buildMinimalAnalysisResult(),
      env
    });
    const firstElapsedMs = Date.now() - firstStart;

    assert.equal(
      firstExecution.applied,
      false,
      "Local runtime cooldown regression: the delayed native runtime should not enhance the result after timing out."
    );
    assert.equal(
      firstExecution.attempted,
      true,
      "Local runtime cooldown regression: the first reasoning attempt should try the local runtime before cooldown is applied."
    );
    assert.ok(
      firstExecution.error.length > 0,
      "Local runtime cooldown regression: the failed first attempt should capture an execution error."
    );
    assert.ok(
      firstElapsedMs < 4500,
      `Local runtime cooldown regression: the first failed attempt should stop after the first timed-out endpoint instead of retrying every model on the same runtime (actual ${firstElapsedMs}ms).`
    );

    const cooledModelHealth = getModelHealthStatus(env);
    assert.equal(
      cooledModelHealth.available,
      false,
      "Local runtime cooldown regression: the local model should be marked unavailable after a local chat timeout."
    );
    assert.equal(
      cooledModelHealth.status,
      "generation-cooldown",
      "Local runtime cooldown regression: the model health status should enter generation cooldown after a chat timeout."
    );
    assert.equal(
      cooledModelHealth.healthCheck?.generationCooldownActive,
      true,
      "Local runtime cooldown regression: the health check should report that local generation cooldown is active."
    );

    const cooledReasoningStatus = getLocalReasoningAssistStatus(
      env,
      { preferredAgent: "SPECIALIST_DOCTOR_AGENT" },
      buildMinimalAnalysisResult()
    );
    assert.equal(
      cooledReasoningStatus.status,
      "local-runtime-cooldown",
      "Local runtime cooldown regression: reasoning assist should stop reporting ready once the local runtime times out."
    );
    assert.equal(
      cooledReasoningStatus.configured,
      false,
      "Local runtime cooldown regression: reasoning assist should not stay configured while the local runtime is cooling down."
    );

    const cooledSpecialistStatus = getSpecialistLlmAgentStatus(env, {
      preferredAgent: "SPECIALIST_DOCTOR_AGENT"
    });
    assert.equal(
      cooledSpecialistStatus.status,
      "local-runtime-cooldown",
      "Local runtime cooldown regression: specialist assist should inherit the same cooldown state after a local runtime timeout."
    );
    assert.equal(
      cooledSpecialistStatus.configured,
      false,
      "Local runtime cooldown regression: specialist assist should not stay configured during the local runtime cooldown."
    );

    const secondStart = Date.now();
    const secondExecution = await tryEnhanceAnalyzeResultWithLocalReasoning({
      payload: buildMinimalPayload(),
      result: buildMinimalAnalysisResult(),
      env
    });
    const secondElapsedMs = Date.now() - secondStart;

    assert.equal(
      secondExecution.attempted,
      false,
      "Local runtime cooldown regression: a second reasoning request should skip the local runtime while cooldown is active."
    );
    assert.ok(
      secondElapsedMs < 800,
      `Local runtime cooldown regression: a cooled-down local runtime should fail fast on the next request (actual ${secondElapsedMs}ms).`
    );
  } finally {
    await stopMockRuntime(slowRuntime);
  }
}

async function runLateRuntimeAvailabilityCacheRefreshRegression() {
  const livePort = 11437;
  const liveBaseUrl = `http://127.0.0.1:${livePort}`;
  const scopedEnv = {
    CARE_NOVA_AUTO_DETECT_LOCAL_RUNTIME: "false",
    CARE_NOVA_LOCAL_RUNTIME_STALE_REFRESH_MS: "1000",
    CARE_NOVA_LOCAL_RUNTIME_PROBE_TIMEOUT_MS: "250",
    OLLAMA_BASE_URL: `${liveBaseUrl}/v1/chat/completions`,
    LOCAL_LLM_URL: "",
    CARE_NOVA_LOCAL_LLM_URL: "",
    LM_STUDIO_BASE_URL: "",
    CARE_NOVA_DEEPSEEK_URL: "",
    DEEPSEEK_BASE_URL: "",
    CARE_NOVA_LLAMA_URL: "",
    LLAMA_BASE_URL: "",
    CARE_NOVA_MISTRAL_URL: "",
    MISTRAL_BASE_URL: "",
    CARE_NOVA_GEMMA_URL: "",
    GEMMA_BASE_URL: "",
    CARE_NOVA_QWEN_URL: "",
    QWEN_BASE_URL: "",
    CARE_NOVA_SPECIALIST_LLM_AGENTS_ENABLED: "true",
    CARE_NOVA_SPECIALIST_LLM_AGENTS_TIMEOUT_MS: "2000"
  };
  const restoreEnv = applyEnvOverrides(scopedEnv);

  try {
    await refreshLocalRuntimeProbe(process.env);

    const firstResult = await analyzeHealthQuery(buildSpecialistAnalysisPayload("runtime-cache-regression"));
    assert.equal(
      firstResult.cache?.analysisCacheHit,
      false,
      "Local runtime refresh regression: the initial analysis should be computed normally."
    );
    assert.equal(
      firstResult.modelRouting?.selectedModel?.primary?.id,
      "care-nova-local-core",
      "Local runtime refresh regression: the deterministic local core should own the first run before the runtime is available."
    );
    assert.equal(
      firstResult.specialistLlmAgents?.configured,
      false,
      "Local runtime refresh regression: specialist LLM assist should remain unavailable before the local runtime starts."
    );

    const liveRuntime = startMockRuntime({
      MOCK_OLLAMA_PORT: String(livePort),
      MOCK_OLLAMA_RUNTIME_ID: "care-nova-native-local-runtime",
      MOCK_OLLAMA_RUNTIME_KIND: "native-local-runtime",
      MOCK_OLLAMA_RUNTIME_FAMILY: "ollama-compatible",
      MOCK_OLLAMA_RUNTIME_DISPLAY_NAME: "Care Nova Native Local Runtime"
    });

    try {
      await waitForUrl(`${liveBaseUrl}/api/tags`);
      await delay(1100);

      const secondResult = await analyzeHealthQuery(buildSpecialistAnalysisPayload("runtime-cache-regression"));
      assert.equal(
        secondResult.cache?.analysisCacheHit,
        false,
        "Local runtime refresh regression: the runtime availability change should invalidate the old cached analysis."
      );
      assert.notEqual(
        secondResult.modelRouting?.selectedModel?.primary?.id,
        "care-nova-local-core",
        "Local runtime refresh regression: a newly available local LLM should replace the deterministic core for the same routed specialist request."
      );
      assert.equal(
        secondResult.specialistLlmAgents?.configured,
        true,
        "Local runtime refresh regression: specialist LLM assist should become configured as soon as the local runtime is reachable."
      );
    } finally {
      await stopMockRuntime(liveRuntime);
    }
  } finally {
    restoreEnv();
  }
}

function startMockRuntime(overrides = {}) {
  const child = spawn(workspaceNode, [mockRuntimeScript], {
    env: {
      ...process.env,
      ...overrides
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.resume();
  child.stderr.resume();
  return child;
}

async function stopMockRuntime(child) {
  child.kill("SIGTERM");
  await Promise.race([
    once(child, "exit"),
    delay(2000)
  ]);
}

async function waitForUrl(url, attempts = 40, delayMs = 150) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {}

    await delay(delayMs);
  }

  throw new Error(`Mock local runtime did not become ready at ${url}.`);
}

async function runRuntimeCheck(overrides = {}) {
  const child = spawn(
    workspaceNode,
    [runtimeCheckScript],
    {
      env: {
        ...process.env,
        ...overrides
      },
      stdio: ["ignore", "pipe", "pipe"]
    }
  );

  let stdout = "";
  let stderr = "";

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  const [exitCode] = await once(child, "exit");

  if (exitCode !== 0) {
    throw new Error(`Runtime check exited with code ${exitCode}: ${stderr || stdout}`);
  }

  return JSON.parse(stdout);
}

function buildMinimalPayload() {
  return {
    message: "Please review my blood pressure follow-up and what tests I should discuss.",
    profile: {
      age: "52",
      conditions: ["Hypertension"],
      medications: ["Amlodipine"]
    },
    vitals: {
      systolic: "152",
      diastolic: "94"
    }
  };
}

function buildMinimalAnalysisResult() {
  return {
    finalResponse: {
      title: "Follow-up review",
      summary: "Monitor blood pressure and compare with your usual readings.",
      whatToDoNow: [
        "Track BP twice daily."
      ],
      warningSigns: [
        "Seek urgent care for chest pain or severe breathing trouble."
      ],
      responseFocus: {
        primaryRoute: "SPECIALIST_DOCTOR_AGENT",
        requirement: {
          answerMode: "deep"
        }
      }
    },
    agentResults: [
      {
        id: "SPECIALIST_DOCTOR_AGENT",
        name: "Specialist Doctor",
        output: {
          summary: "Compare current readings with baseline and note symptoms.",
          patientAnswerSummary: "Compare readings with baseline.",
          specialistActions: [
            "Repeat BP twice daily."
          ],
          checklist: [
            "Log symptoms."
          ],
          doctorQuestions: [
            "What changed most since the readings started?"
          ],
          missingContext: []
        }
      }
    ],
    plan: {
      responseOwner: {
        route: "SPECIALIST_DOCTOR_AGENT"
      },
      execute: ["SPECIALIST_DOCTOR_AGENT"]
    },
    risk: {
      level: "LOW",
      label: "LOW"
    },
    requirementProfile: {
      expectedRoute: "SPECIALIST_DOCTOR_AGENT",
      answerMode: {
        id: "deep"
      }
    },
    modelRouting: {
      generatedUsing: "Local Model",
      processingType: "local",
      selectedModel: {
        primary: {
          id: "care-nova-local-core",
          displayName: "Care Nova Local Clinical Core"
        }
      }
    }
  };
}

function buildSpecialistAnalysisPayload(patientId) {
  return {
    patientId,
    message: "Please review my blood pressure trend, dizziness, and what cardiology follow-up questions I should ask.",
    interfaceName: "specialist",
    singleAgentMode: true,
    preferredAgent: "SPECIALIST_DOCTOR_AGENT",
    answerMode: "deep",
    profile: {
      age: "52",
      conditions: ["Hypertension"],
      medications: ["Amlodipine"]
    },
    vitals: {
      systolic: "152",
      diastolic: "94"
    },
    context: {
      specialistFocus: "cardiology",
      specialistLens: "full-review",
      duration: "same-day",
      severity: "4",
      careGoal: "understand",
      redFlags: []
    }
  };
}

function applyEnvOverrides(overrides = {}) {
  const previous = {};

  for (const [key, value] of Object.entries(overrides)) {
    previous[key] = Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined;
    process.env[key] = value;
  }

  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}
