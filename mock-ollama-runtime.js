import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";

const host = "127.0.0.1";
const port = Number.parseInt(process.env.MOCK_OLLAMA_PORT || "11434", 10);
const chatDelayMs = Number.parseInt(process.env.MOCK_OLLAMA_CHAT_DELAY_MS || "0", 10);
const runtime = {
  id: String(process.env.MOCK_OLLAMA_RUNTIME_ID || "care-nova-mock-local-runtime").trim(),
  kind: String(process.env.MOCK_OLLAMA_RUNTIME_KIND || "mock-compatibility-runtime").trim(),
  family: String(process.env.MOCK_OLLAMA_RUNTIME_FAMILY || "care-nova-mock-openai-compatible").trim(),
  displayName: String(process.env.MOCK_OLLAMA_RUNTIME_DISPLAY_NAME || "Care Nova Mock Local Runtime").trim()
};

const models = [
  {
    name: "deepseek-r1",
    model: "deepseek-r1"
  },
  {
    name: "qwen2.5:3b",
    model: "qwen2.5:3b"
  },
  {
    name: "llama3.2:3b",
    model: "llama3.2:3b"
  },
  {
    name: "mistral",
    model: "mistral"
  },
  {
    name: "gemma",
    model: "gemma"
  }
];

const reviewPayload = {
  summary_upgrade: "",
  step_additions: [
    "Track what changed, when it started, and any readings, triggers, or medicines linked to it.",
    "Use clinician review if symptoms worsen, feel unusual, or do not improve as expected."
  ],
  warning_additions: [
    "Seek urgent in-person care for chest pain, severe breathing trouble, fainting, or new one-sided weakness."
  ],
  missing_question: "What changed most since this concern started?",
  evidence_focus: [
    "patient context",
    "latest vitals",
    "top offline evidence"
  ],
  confidence_label: "mock-local-runtime"
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${host}:${port}`);

  if (request.method === "GET" && (url.pathname === "/api/tags" || url.pathname === "/v1/models")) {
    const payload = url.pathname === "/api/tags"
      ? { runtime, models }
      : {
          runtime,
          data: models.map((item) => ({
            id: item.model,
            object: "model"
          }))
        };
    return sendJson(response, 200, payload);
  }

  if (request.method === "POST" && (url.pathname === "/api/chat" || url.pathname === "/v1/chat/completions")) {
    const requestBody = parseJson(await readRequestBody(request));
    const requestedModel = resolveRequestedModel(requestBody);
    const selectedModel = models.find((entry) => entry.model === requestedModel || entry.name === requestedModel)?.model || "qwen2.5:3b";

    if (chatDelayMs > 0) {
      await delay(chatDelayMs);
    }

    const payload = url.pathname === "/api/chat"
      ? {
          runtime,
          model: selectedModel,
          done: true,
          message: {
            role: "assistant",
            content: JSON.stringify(reviewPayload)
          }
        }
      : {
          runtime,
          id: "mock-chatcmpl",
          object: "chat.completion",
          system_fingerprint: runtime.id,
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: JSON.stringify(reviewPayload)
              },
              finish_reason: "stop"
            }
          ]
        };

    return sendJson(response, 200, payload);
  }

  return sendJson(response, 404, {
    ok: false,
    error: "Not found",
    path: url.pathname
  });
});

server.listen(port, host, () => {
  process.stdout.write(`mock-ollama-runtime listening on http://${host}:${port}\n`);
});

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "X-Care-Nova-Runtime": runtime.kind,
    "X-Care-Nova-Runtime-Family": runtime.family
  });
  response.end(body);
}

function readRequestBody(request) {
  return new Promise((resolve) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", () => resolve(""));
  });
}

function parseJson(value) {
  try {
    return JSON.parse(String(value || "{}"));
  } catch {
    return {};
  }
}

function resolveRequestedModel(payload = {}) {
  return String(payload?.model || "").trim();
}
