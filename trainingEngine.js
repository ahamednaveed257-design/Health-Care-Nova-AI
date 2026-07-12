import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const TRAINING_ENGINE_VERSION = "1.1.0";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const trainingFile = resolve(rootDir, "data", "training", "agent-training-state.json");
const maxStoredExamples = 500;
let cachedTrainingState = null;
let cachedTrainingMtimeMs = 0;
let trainingWriteQueue = Promise.resolve();

const supportedRoutes = [
  "RAG_AGENT",
  "SPECIALIST_DOCTOR_AGENT",
  "VITALS_AGENT",
  "PHARMACY_AGENT",
  "LABS_AGENT",
  "WELLNESS_AGENT",
  "SCHEDULING_AGENT",
  "RECORDS_AGENT",
  "INSURANCE_AGENT",
  "ALERT_AGENT"
];

const routeAliases = {
  general: "RAG_AGENT",
  talk: "RAG_AGENT",
  symptom: "RAG_AGENT",
  symptoms: "RAG_AGENT",
  health: "RAG_AGENT",
  specialist: "SPECIALIST_DOCTOR_AGENT",
  disease: "SPECIALIST_DOCTOR_AGENT",
  diseases: "SPECIALIST_DOCTOR_AGENT",
  atlas: "SPECIALIST_DOCTOR_AGENT",
  library: "SPECIALIST_DOCTOR_AGENT",
  vitals: "VITALS_AGENT",
  vital: "VITALS_AGENT",
  bp: "VITALS_AGENT",
  medicine: "PHARMACY_AGENT",
  medication: "PHARMACY_AGENT",
  pharmacy: "PHARMACY_AGENT",
  labs: "LABS_AGENT",
  lab: "LABS_AGENT",
  report: "LABS_AGENT",
  wellness: "WELLNESS_AGENT",
  lifestyle: "WELLNESS_AGENT",
  visits: "SCHEDULING_AGENT",
  visit: "SCHEDULING_AGENT",
  appointment: "SCHEDULING_AGENT",
  appointments: "SCHEDULING_AGENT",
  safety: "ALERT_AGENT",
  urgent: "ALERT_AGENT",
  emergency: "ALERT_AGENT",
  alert: "ALERT_AGENT",
  records: "RECORDS_AGENT",
  record: "RECORDS_AGENT",
  summary: "RECORDS_AGENT",
  insurance: "INSURANCE_AGENT",
  claim: "INSURANCE_AGENT",
  claims: "INSURANCE_AGENT"
};

const stopWords = new Set([
  "a",
  "about",
  "after",
  "all",
  "also",
  "am",
  "an",
  "and",
  "any",
  "are",
  "as",
  "at",
  "be",
  "been",
  "before",
  "but",
  "by",
  "can",
  "could",
  "do",
  "does",
  "for",
  "from",
  "give",
  "had",
  "has",
  "have",
  "help",
  "health",
  "how",
  "i",
  "in",
  "is",
  "it",
  "language",
  "me",
  "matter",
  "matters",
  "my",
  "need",
  "next",
  "of",
  "on",
  "or",
  "plain",
  "please",
  "plan",
  "prepare",
  "question",
  "questions",
  "real",
  "review",
  "reviews",
  "safe",
  "safely",
  "should",
  "that",
  "the",
  "this",
  "to",
  "up",
  "want",
  "was",
  "what",
  "when",
  "with",
  "world",
  "you",
  "focus",
  "doctor"
]);

export function getTrainingStorageInfo() {
  return {
    mode: "persistent-local-ml-training-store",
    file: formatProjectRelativePath(trainingFile),
    mirrorEligible: true,
    version: TRAINING_ENGINE_VERSION,
    privacy: "Stores approved feedback and de-identified training signals locally; raw PHI should not be used for model tuning.",
    maxStoredExamples,
    supportedRoutes
  };
}

export function getMachineLearningCapabilityStatus(runtime = {}, env = process.env) {
  const localLlmUrl = env.LOCAL_LLM_URL || env.CARE_NOVA_LOCAL_LLM_URL || "https://api.deepseek.com/chat/completions";
  const localLlmModel = env.LOCAL_LLM_MODEL || env.CARE_NOVA_LOCAL_LLM_MODEL || env.DEEPSEEK_MODEL || "deepseek-reasoner";
  const onlineApiEnabled = env.CARE_NOVA_EXTERNAL_API_ENABLED === "true";

  return {
    ok: true,
    version: TRAINING_ENGINE_VERSION,
    status: "ml-dl-training-ready",
    summary: {
      classicalMlReady: true,
      deepLearningAdapterReady: true,
      activeFoundationTraining: false,
      onlineOfflineParity: true,
      localFirstStorage: true,
      safeMedicalBoundary: true
    },
    machineLearning: {
      mode: "local-agent-calibration",
      algorithms: [
        "TF-IDF-style route keyword weighting",
        "Bigram and trigram route phrase calibration",
        "Route prototype vectors from approved examples",
        "Nearest approved exemplar similarity scoring",
        "Signal-source coverage scoring across message, vitals, profile, records, and graph context",
        "Agent route prior calibration",
        "Per-agent reliability scoring",
        "Confusion-matrix driven routing review",
        "Approved feedback loop with rollback-safe JSON state"
      ],
      trains: [
        "which agent should answer",
        "which route should own the response",
        "which prompt patterns need stronger context",
        "which tabs are under-performing"
      ],
      doesNotTrain: [
        "new medical facts from patient messages",
        "diagnosis logic without clinical review",
        "prescribing or dosage rules",
        "emergency contact automation"
      ]
    },
    deepLearning: {
      status: localLlmUrl ? "deepseek-r1-primary-configured" : "adapter-ready",
      activeTraining: false,
      localAdapters: [
        "DeepSeek-R1 primary reasoning endpoint",
        "OpenAI-compatible DeepSeek API shape",
        "Ollama-style localhost LLM endpoint",
        "ONNX/TensorFlow.js embedding adapter slot",
        "Vector database connector slot for approved offline corpora",
        "Adaptive router that escalates ambiguous or low-evidence cases to stronger reasoning models"
      ],
      currentEndpoint: localLlmUrl || "not configured",
      currentModel: localLlmModel,
      fallback: "If DeepSeek-R1 is unavailable, deterministic local routing, retrieval, safety, and report generation remain active.",
      policy: "DeepSeek-R1 can improve language understanding only after approved corpus setup, PHI removal, clinical evaluation, prompt controls, and rollback."
    },
    governance: {
      approvedFeedbackOnly: true,
      noPhiTraining: true,
      reviewerSignoffRequired: true,
      rollbackRequired: true,
      onlineApiEnabled,
      runtimeNode: runtime.node || ""
    },
    storage: getTrainingStorageInfo()
  };
}

export function buildTrainingCalibrationSignalBundle(input = {}) {
  const payload = input && typeof input === "object" && !Array.isArray(input)
    ? input
    : { message: input };
  const profile = payload.profile && typeof payload.profile === "object" ? payload.profile : {};
  const vitals = payload.vitals && typeof payload.vitals === "object" ? payload.vitals : {};
  const context = payload.context && typeof payload.context === "object" ? payload.context : {};
  const memoryContext = payload.memoryContext && typeof payload.memoryContext === "object" ? payload.memoryContext : {};
  const recordContext = payload.recordContext && typeof payload.recordContext === "object" ? payload.recordContext : {};
  const graphContext = payload.graphContext && typeof payload.graphContext === "object" ? payload.graphContext : {};
  const parts = [];
  const sources = [];
  const sourceTokens = {};
  const addPart = (source, value, limit = 260) => {
    const text = sanitizeTrainingText(value).slice(0, limit);

    if (!text || parts.includes(text)) {
      return;
    }

    parts.push(text);

    if (!sources.includes(source)) {
      sources.push(source);
    }

    const tokens = tokenizeTrainingText(text);
    if (tokens.length) {
      sourceTokens[source] = Array.from(new Set([
        ...(Array.isArray(sourceTokens[source]) ? sourceTokens[source] : []),
        ...tokens
      ])).slice(0, 90);
    }
  };

  addPart("message", payload.message || payload.input || payload.question || "");

  const conditionSignals = dedupeTrainingSignalTerms([
    ...readTrainingSignalTerms(profile.conditions, 6),
    ...readTrainingSignalTerms(recordContext.conditions, 4),
    ...readTrainingSignalTerms(graphContext.conditions, 4)
  ], 8);
  const medicationSignals = dedupeTrainingSignalTerms([
    ...readTrainingSignalTerms(profile.medications, 6),
    ...readTrainingSignalTerms(recordContext.medicines, 4),
    ...readTrainingSignalTerms(graphContext.medicines, 4)
  ], 8);
  const allergySignals = dedupeTrainingSignalTerms([
    ...readTrainingSignalTerms(profile.allergies, 4),
    ...readTrainingSignalTerms(recordContext.allergies, 3),
    ...readTrainingSignalTerms(graphContext.allergies, 3)
  ], 5);
  const vitalSignals = buildTrainingVitalSignalParts(vitals);
  const contextSignals = buildTrainingContextSignalParts(context);
  const memorySignals = dedupeTrainingSignalTerms([
    ...readTrainingSignalTerms(memoryContext.recentMessages, 2),
    ...readTrainingSignalTerms(memoryContext.recentRisks, 2)
  ], 4);
  const recordSignals = dedupeTrainingSignalTerms([
    ...readTrainingSignalTerms(recordContext.recentRecordTypes, 3),
    ...readTrainingSignalTerms(recordContext.recentTags, 4),
    ...readTrainingSignalTerms(recordContext.followUps, 2),
    ...readTrainingSignalTerms(recordContext.labs, 3)
  ], 6);
  const graphSignals = dedupeTrainingSignalTerms([
    ...readTrainingSignalTerms(graphContext.safetyFlags, 3),
    ...readTrainingSignalTerms(graphContext.riskLevels, 3),
    ...readTrainingSignalTerms(graphContext.recentFacts, 3),
    ...readTrainingSignalTerms(graphContext.labs, 3)
  ], 6);

  if (conditionSignals.length) {
    addPart("profile", `conditions ${conditionSignals.join(" ")}`);
  }
  if (medicationSignals.length) {
    addPart("profile", `medications ${medicationSignals.join(" ")}`);
  }
  if (allergySignals.length) {
    addPart("profile", `allergies ${allergySignals.join(" ")}`);
  }

  for (const signal of vitalSignals) {
    addPart("vitals", signal, 140);
  }

  if (contextSignals.length) {
    addPart("context", contextSignals.join(" "), 260);
  }
  if (memorySignals.length) {
    addPart("memory", `recent context ${memorySignals.join(" ")}`, 220);
  }
  if (recordSignals.length) {
    addPart("records", `local records ${recordSignals.join(" ")}`, 220);
  }
  if (graphSignals.length) {
    addPart("knowledge-graph", `knowledge graph ${graphSignals.join(" ")}`, 220);
  }

  const text = sanitizeTrainingText(parts.join(". "));

  return {
    text,
    parts,
    sources,
    sourceTokens,
    tokenCount: tokenizeTrainingText(text).length
  };
}

export async function loadTrainingState() {
  try {
    await trainingWriteQueue.catch(() => {});
    const fileStats = await stat(trainingFile).catch((error) => {
      if (error.code === "ENOENT") {
        return null;
      }

      throw error;
    });

    if (cachedTrainingState && fileStats && cachedTrainingMtimeMs === fileStats.mtimeMs) {
      return cachedTrainingState;
    }

    if (cachedTrainingState && !fileStats && cachedTrainingMtimeMs === 0) {
      return cachedTrainingState;
    }

    if (!fileStats) {
      const state = createDefaultTrainingState();
      state.models.routeCalibrator = createRouteCalibratorModel(state.examples);
      await writeTrainingState(state);
      return state;
    }

    const parsed = JSON.parse(await readFile(trainingFile, "utf8"));
    const normalized = normalizeTrainingState(parsed);
    const parsedExampleCount = Array.isArray(parsed.examples) ? parsed.examples.length : 0;
    const approvedCount = normalized.examples.filter((example) => example.approved && example.expectedRoute).length;
    const modelCount = Number(normalized.models.routeCalibrator?.exampleCount || 0);

    if (
      normalized.examples.length !== parsedExampleCount
      || modelCount !== approvedCount
      || !hasRouteCalibratorFeatureSet(normalized.models.routeCalibrator)
    ) {
      normalized.models.routeCalibrator = createRouteCalibratorModel(normalized.examples);
      normalized.updatedAt = new Date().toISOString();
      await writeTrainingState(normalized);
    }

    cachedTrainingState = normalized;
    cachedTrainingMtimeMs = fileStats.mtimeMs;
    return cachedTrainingState;
  } catch (error) {
    if (error.code !== "ENOENT") {
      return normalizeTrainingState({});
    }

    const state = createDefaultTrainingState();
    state.models.routeCalibrator = createRouteCalibratorModel(state.examples);
    await writeTrainingState(state);
    return state;
  }
}

export async function recordTrainingExample(payload = {}) {
  const state = await loadTrainingState();
  const message = sanitizeTrainingText(payload.message || payload.input || payload.question || "");
  const expectedRoute = normalizeRoute(payload.expectedRoute || payload.correctRoute || payload.route || payload.tab, detectRouteFromText(message));
  const actualRoute = normalizeRoute(payload.actualRoute || payload.predictedRoute || payload.agentRoute, "");

  if (!message && !expectedRoute) {
    const error = new Error("Training example needs a message or expected route.");
    error.statusCode = 400;
    error.code = "EMPTY_TRAINING_EXAMPLE";
    throw error;
  }

  const example = {
    id: payload.id || randomUUID(),
    createdAt: payload.createdAt || new Date().toISOString(),
    patientFingerprint: hashId(payload.patientId || "demo-patient"),
    tab: normalizeTab(payload.tab || payload.interface || ""),
    message,
    expectedRoute,
    actualRoute,
    approved: payload.approved === true || payload.reviewerApproved === true,
    rating: normalizeRating(payload.rating || payload.score || payload.userRating),
    outcome: normalizeOutcome(payload.outcome || payload.result || ""),
    tags: normalizeTags(payload.tags || payload.labels || []),
    reviewer: sanitizeTrainingText(payload.reviewer || payload.reviewedBy || "").slice(0, 80),
    note: sanitizeTrainingText(payload.note || payload.feedback || payload.comment || "").slice(0, 240)
  };

  state.examples = [
    example,
    ...state.examples.filter((item) => item.id !== example.id)
  ].slice(0, maxStoredExamples);
  state.updatedAt = new Date().toISOString();
  await writeTrainingState(state);

  return {
    ok: true,
    status: "training-example-saved",
    example: toPublicTrainingExample(example),
    training: toPublicTrainingState(state),
    storage: getTrainingStorageInfo()
  };
}

export async function trainLocalAgentCalibrator(payload = {}) {
  const state = await loadTrainingState();

  if (Array.isArray(payload.examples)) {
    for (const example of payload.examples) {
      await recordTrainingExample(example);
    }
    return trainLocalAgentCalibrator({ ...payload, examples: undefined });
  }

  state.models.routeCalibrator = createRouteCalibratorModel(state.examples);
  state.updatedAt = new Date().toISOString();
  await writeTrainingState(state);

  return {
    ok: true,
    status: state.models.routeCalibrator.status,
    model: state.models.routeCalibrator,
    calibration: buildTrainingCalibration(state),
    training: toPublicTrainingState(state),
    storage: getTrainingStorageInfo()
  };
}

export async function getTrainingCalibration() {
  const state = await loadTrainingState();

  return buildTrainingCalibration(state);
}

export async function evaluateTrainingCalibration(payload = {}) {
  const calibration = payload.calibration || await getTrainingCalibration();
  const message = sanitizeTrainingText(payload.message || payload.input || payload.question || "");
  const scored = scoreTrainingCalibrationRoutes(message, calibration);
  const scoredRoutes = scored.rankedRoutes;
  const topRoute = scoredRoutes[0] || { route: "RAG_AGENT", score: 0 };

  return {
    ok: true,
    status: calibration.enabled ? "calibration-evaluated" : "calibration-waiting-for-approved-feedback",
    recommendedRoute: topRoute.route,
    confidence: Math.round(clamp(topRoute.score * 100, calibration.enabled ? 46 : 30, 96)),
    evidence: [...(topRoute.keywordHits || []), ...(topRoute.distinctMatches || [])].slice(0, 10),
    rankedRoutes: scoredRoutes.slice(0, 5),
    calibration: {
      enabled: calibration.enabled,
      trainedAt: calibration.trainedAt,
      exampleCount: calibration.exampleCount,
      modelVersion: calibration.modelVersion
    },
    boundary: calibration.safetyBoundary
  };
}

export function toPublicTrainingState(state = createDefaultTrainingState()) {
  const normalized = normalizeTrainingState(state);
  const model = normalized.models.routeCalibrator;

  return {
    ok: true,
    status: model.status,
    version: TRAINING_ENGINE_VERSION,
    updatedAt: normalized.updatedAt,
    exampleCount: normalized.examples.length,
    approvedExampleCount: normalized.examples.filter((example) => example.approved).length,
    model: {
      version: model.version,
      status: model.status,
      trainedAt: model.trainedAt,
      exampleCount: model.exampleCount,
      routesCovered: model.metrics?.routesCovered || 0,
      weightedAccuracy: model.metrics?.weightedAccuracy || 0,
      reviewerApprovedOnly: true,
      medicalFactTraining: false
    },
    recentExamples: normalized.examples.slice(0, 6).map(toPublicTrainingExample),
    storage: getTrainingStorageInfo(),
    machineLearning: getMachineLearningCapabilityStatus().summary
  };
}

function buildTrainingCalibration(state) {
  const model = normalizeTrainingState(state).models.routeCalibrator;
  const enabled = model.status === "trained" && Number(model.exampleCount || 0) > 0;

  return {
    id: "LOCAL_AGENT_TRAINING_CALIBRATION",
    modelVersion: model.version || TRAINING_ENGINE_VERSION,
    enabled,
    status: model.status || "waiting-for-approved-feedback",
    trainedAt: model.trainedAt || "",
    exampleCount: Number(model.exampleCount || 0),
    routePriors: model.routePriors || {},
    keywordRouteWeights: model.keywordRouteWeights || {},
    routePrototypeVectors: model.routePrototypeVectors || {},
    routePrototypeNorms: model.routePrototypeNorms || {},
    routeDistinctiveTokens: model.routeDistinctiveTokens || {},
    routeExemplarSignatures: model.routeExemplarSignatures || {},
    tokenIdf: model.tokenIdf || {},
    agentReliability: model.agentReliability || {},
    confusionMatrix: model.confusionMatrix || {},
    metrics: model.metrics || {},
    safetyBoundary: "Local ML/DL training calibrates agent routing and answer precision only; it does not create new medical facts, diagnoses, prescriptions, or dosage rules."
  };
}

function createDefaultTrainingState() {
  const baselineExamples = createBaselineTrainingExamples();

  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    examples: baselineExamples,
    models: {
      routeCalibrator: {
        version: TRAINING_ENGINE_VERSION,
        status: "waiting-for-approved-feedback",
        trainedAt: "",
        exampleCount: 0,
        routePriors: {},
        keywordRouteWeights: {},
        routePrototypeVectors: {},
        routePrototypeNorms: {},
        routeDistinctiveTokens: {},
        routeExemplarSignatures: {},
        tokenIdf: {},
        agentReliability: {},
        confusionMatrix: {},
        metrics: {
          approvedExampleCount: 0,
          storedExampleCount: 0,
          routesCovered: 0,
          weightedAccuracy: 0,
          vocabularySize: 0,
          prototypeRoutes: 0,
          exemplarRoutes: 0,
          reviewerApprovedOnly: true,
          noPhiTraining: true,
          medicalFactTraining: false
        }
      }
    }
  };
}

function normalizeTrainingState(value = {}) {
  const storedExamples = Array.isArray(value.examples) ? value.examples.map(normalizeStoredExample).filter(Boolean) : [];
  const storedIds = new Set(storedExamples.map((example) => example.id));
  const examples = [
    ...storedExamples,
    ...createBaselineTrainingExamples().filter((example) => !storedIds.has(example.id))
  ].slice(0, maxStoredExamples);
  const state = {
    ...createDefaultTrainingState(),
    ...value,
    examples,
    models: {
      ...createDefaultTrainingState().models,
      ...(value.models && typeof value.models === "object" ? value.models : {})
    }
  };

  state.models.routeCalibrator = {
    ...createDefaultTrainingState().models.routeCalibrator,
    ...(state.models.routeCalibrator && typeof state.models.routeCalibrator === "object" ? state.models.routeCalibrator : {})
  };

  return state;
}

function createBaselineTrainingExamples() {
  const createdAt = "2026-06-28T00:00:00.000Z";
  const patientFingerprint = "baseline-training";
  const rows = [
    {
      id: "baseline-general-health-guidance",
      tab: "general",
      message: "I have a mild headache since morning, no fever, and want safe general guidance.",
      expectedRoute: "RAG_AGENT",
      tags: ["general", "symptom", "headache"]
    },
    {
      id: "baseline-general-respiratory-home-guidance",
      tab: "general",
      message: "I have cough, fever, and body aches for two days. I want plain general guidance and warning signs to watch at home.",
      expectedRoute: "RAG_AGENT",
      tags: ["general", "respiratory", "home monitoring", "warning signs"]
    },
    {
      id: "baseline-specialist-core-disease",
      tab: "specialist",
      message: "Explain hypertension and type 2 diabetes prevention, monitoring, and questions for a doctor.",
      expectedRoute: "SPECIALIST_DOCTOR_AGENT",
      tags: ["specialist", "disease", "diabetes", "hypertension"]
    },
    {
      id: "baseline-specialist-kidney-followup",
      tab: "specialist",
      message: "Kidney specialist review for creatinine 1.6 and eGFR 48 after ibuprofen use. What should nephrology focus on and which follow-up tests matter next?",
      expectedRoute: "SPECIALIST_DOCTOR_AGENT",
      tags: ["specialist", "kidney", "creatinine", "egfr", "ibuprofen", "nephrology"]
    },
    {
      id: "baseline-vitals-review",
      tab: "vitals",
      message: "My BP is 160/98, pulse is fast, and I need help reviewing daily vital readings.",
      expectedRoute: "VITALS_AGENT",
      tags: ["vitals", "bp", "pulse"]
    },
    {
      id: "baseline-vitals-repeat-bp-headache",
      tab: "vitals",
      message: "My blood pressure stayed high after repeat checks and I have headache and dizziness. Which readings should I recheck and track today?",
      expectedRoute: "VITALS_AGENT",
      tags: ["vitals", "repeat blood pressure", "headache", "dizziness", "track"]
    },
    {
      id: "baseline-medicine-safety",
      tab: "medicine",
      message: "I missed my blood pressure tablet and want to understand medicine safety and side effects.",
      expectedRoute: "PHARMACY_AGENT",
      tags: ["medicine", "missed dose", "side effect"]
    },
    {
      id: "baseline-medicine-standing-dizziness",
      tab: "medicine",
      message: "I take amlodipine and feel dizzy when I stand up. What medicine side effects and precautions should I watch for?",
      expectedRoute: "PHARMACY_AGENT",
      tags: ["medicine", "amlodipine", "dizziness", "standing", "precautions"]
    },
    {
      id: "baseline-lab-report-review",
      tab: "labs",
      message: "Explain my HbA1c, LDL cholesterol, CBC, kidney, and thyroid lab report in simple words.",
      expectedRoute: "LABS_AGENT",
      tags: ["labs", "hba1c", "cholesterol"]
    },
    {
      id: "baseline-labs-kidney-diabetes-values",
      tab: "labs",
      message: "My creatinine is 1.6 and A1c is 8.9. Explain what these lab values mean, the reference range context, and what to recheck.",
      expectedRoute: "LABS_AGENT",
      tags: ["labs", "creatinine", "a1c", "reference range", "recheck"]
    },
    {
      id: "baseline-wellness-plan",
      tab: "wellness",
      message: "Build a healthy life routine for sleep, stress, diet, hydration, walking, and age group habits.",
      expectedRoute: "WELLNESS_AGENT",
      tags: ["wellness", "habit", "sleep", "diet"]
    },
    {
      id: "baseline-visit-follow-up",
      tab: "visits",
      message: "Help me book a doctor appointment, prepare questions, and plan follow-up reminders.",
      expectedRoute: "SCHEDULING_AGENT",
      tags: ["visit", "appointment", "follow up"]
    },
    {
      id: "baseline-visit-cardiology-followup",
      tab: "visits",
      message: "Help me prepare a cardiology follow-up appointment next week with blood pressure questions and recent reading notes.",
      expectedRoute: "SCHEDULING_AGENT",
      tags: ["visit", "cardiology", "follow up", "appointment", "prepare"]
    },
    {
      id: "baseline-records-summary",
      tab: "records",
      message: "Create a patient health record summary with symptoms, medicines, vitals, labs, and visit notes.",
      expectedRoute: "RECORDS_AGENT",
      tags: ["records", "summary", "doctor note"]
    },
    {
      id: "baseline-insurance-claim",
      tab: "insurance",
      message: "Help with insurance claim, coverage, EOB, benefits, prior authorization, and missing documents.",
      expectedRoute: "INSURANCE_AGENT",
      tags: ["insurance", "claim", "coverage"]
    },
    {
      id: "baseline-insurance-code-appeal",
      tab: "insurance",
      message: "My MRI claim was denied for the wrong code. Help me prepare the appeal packet, EOB details, and corrected billing documents.",
      expectedRoute: "INSURANCE_AGENT",
      tags: ["insurance", "appeal", "code", "claim denial", "documents"]
    },
    {
      id: "baseline-safety-alert",
      tab: "safety",
      message: "Chest pain, trouble breathing, fainting, one-sided weakness, or severe allergy warning signs.",
      expectedRoute: "ALERT_AGENT",
      tags: ["safety", "urgent", "warning signs"]
    },
    {
      id: "baseline-safety-chest-pain-now",
      tab: "safety",
      message: "I have chest pain, sweating, and shortness of breath right now. Tell me the urgent safety action.",
      expectedRoute: "ALERT_AGENT",
      tags: ["safety", "chest pain", "shortness of breath", "urgent action"]
    }
  ];

  return rows.map((row) => normalizeStoredExample({
    ...row,
    createdAt,
    patientFingerprint,
    actualRoute: row.expectedRoute,
    approved: true,
    rating: 4,
    outcome: "correct",
    reviewer: "baseline",
    note: "Safe synthetic baseline example for local route calibration."
  }));
}

function createRouteCalibratorModel(examples = []) {
  const approvedExamples = examples.filter((example) => example.approved && example.expectedRoute);
  const routeCounts = {};
  const tokenCounts = {};
  const reliabilityBuckets = {};
  const confusionMatrix = {};
  const documentFrequency = {};
  const globalTokenTotals = {};
  const routeExamples = {};

  for (const route of supportedRoutes) {
    routeCounts[route] = 0;
    tokenCounts[route] = {};
    routeExamples[route] = [];
    reliabilityBuckets[route] = {
      ratings: [],
      correct: 0,
      total: 0,
      needsReview: 0
    };
  }

  for (const example of approvedExamples) {
    const route = normalizeRoute(example.expectedRoute, "RAG_AGENT");
    const actualRoute = normalizeRoute(example.actualRoute, "");
    const text = `${example.message} ${example.note} ${example.tags.join(" ")}`;
    const tokens = tokenizeTrainingText(text);
    const uniqueTokens = [...new Set(tokens)];
    const tokenFrequency = countTrainingTokens(tokens);
    const weight = calculateTrainingExampleWeight(example);

    routeCounts[route] = (routeCounts[route] || 0) + 1;

    for (const token of uniqueTokens) {
      documentFrequency[token] = (documentFrequency[token] || 0) + 1;
    }

    for (const [token, frequency] of Object.entries(tokenFrequency)) {
      const adjustedWeight = weight * (1 + Math.min((frequency - 1) * 0.18, 0.54));

      tokenCounts[route][token] = (tokenCounts[route][token] || 0) + adjustedWeight;
      globalTokenTotals[token] = (globalTokenTotals[token] || 0) + adjustedWeight;
    }

    routeExamples[route].push({
      id: example.id,
      preview: buildTrainingPreview(example.message),
      weight,
      tokenFrequency
    });

    reliabilityBuckets[route].ratings.push(Number(example.rating || 3));
    reliabilityBuckets[route].total += 1;
    if (!actualRoute || actualRoute === route || example.outcome === "correct") {
      reliabilityBuckets[route].correct += 1;
    }
    if (example.outcome === "needs_review" || example.outcome === "incorrect") {
      reliabilityBuckets[route].needsReview += 1;
    }

    if (actualRoute) {
      confusionMatrix[actualRoute] = confusionMatrix[actualRoute] || {};
      confusionMatrix[actualRoute][route] = (confusionMatrix[actualRoute][route] || 0) + 1;
    }
  }

  const totalApproved = approvedExamples.length;
  const routePriors = {};
  const keywordRouteWeights = {};
  const routePrototypeVectors = {};
  const routePrototypeNorms = {};
  const routeDistinctiveTokens = {};
  const routeExemplarSignatures = {};
  const agentReliability = {};
  const tokenIdf = buildTokenIdfWeights(documentFrequency, totalApproved);

  for (const route of supportedRoutes) {
    routePriors[route] = totalApproved ? round(routeCounts[route] / totalApproved, 4) : 0;
    keywordRouteWeights[route] = buildRouteKeywordWeights(route, tokenCounts, routeCounts, tokenIdf, globalTokenTotals);
    routePrototypeVectors[route] = buildRoutePrototypeVector(route, tokenCounts, routeCounts, tokenIdf, globalTokenTotals);
    routePrototypeNorms[route] = round(computeVectorNorm(routePrototypeVectors[route]), 4);
    routeDistinctiveTokens[route] = Object.entries(routePrototypeVectors[route])
      .sort((first, second) => second[1] - first[1])
      .slice(0, 16)
      .map(([token]) => token);
    routeExemplarSignatures[route] = buildRouteExemplarSignatures(routeExamples[route], tokenIdf);

    const bucket = reliabilityBuckets[route];
    const avgRating = bucket.ratings.length
      ? bucket.ratings.reduce((total, rating) => total + rating, 0) / bucket.ratings.length
      : 3;
    const correctRate = bucket.total ? bucket.correct / bucket.total : 0.8;
    const reviewPenalty = bucket.total ? bucket.needsReview / bucket.total : 0;
    const score = Math.round(clamp(50 + avgRating * 7 + correctRate * 14 - reviewPenalty * 12, 45, 98));

    agentReliability[route] = {
      score,
      examples: bucket.total,
      avgRating: round(avgRating, 2),
      correctRate: round(correctRate, 3),
      needsReviewRate: round(reviewPenalty, 3)
    };
  }

  return {
    version: TRAINING_ENGINE_VERSION,
    status: totalApproved ? "trained" : "waiting-for-approved-feedback",
    trainedAt: new Date().toISOString(),
    exampleCount: totalApproved,
    routePriors,
    keywordRouteWeights,
    routePrototypeVectors,
    routePrototypeNorms,
    routeDistinctiveTokens,
    routeExemplarSignatures,
    tokenIdf,
    agentReliability,
    confusionMatrix,
    metrics: {
      approvedExampleCount: totalApproved,
      storedExampleCount: examples.length,
      routesCovered: Object.values(routeCounts).filter(Boolean).length,
      weightedAccuracy: totalApproved
        ? round(Object.values(reliabilityBuckets).reduce((total, bucket) => total + bucket.correct, 0) / totalApproved, 3)
        : 0,
      vocabularySize: Object.keys(tokenIdf).length,
      prototypeRoutes: Object.values(routePrototypeVectors).filter((vector) => Object.keys(vector).length > 0).length,
      exemplarRoutes: Object.values(routeExemplarSignatures).filter((entries) => entries.length > 0).length,
      reviewerApprovedOnly: true,
      noPhiTraining: true,
      medicalFactTraining: false
    }
  };
}

export function scoreTrainingCalibrationRoutes(input = "", calibration = {}) {
  const normalized = normalizeCalibrationForScoring(calibration);
  const signalBundle = buildTrainingCalibrationSignalBundle(input);
  const cleanMessage = signalBundle.text;
  const tokens = tokenizeTrainingText(cleanMessage);
  const uniqueTokens = [...new Set(tokens)];
  const tokenSet = new Set(uniqueTokens);
  const sourceTokenSets = Object.fromEntries(
    Object.entries(signalBundle.sourceTokens || {}).map(([source, sourceTokens]) => [
      source,
      new Set(Array.isArray(sourceTokens) ? sourceTokens : [])
    ])
  );
  const sourceCount = Math.max(Object.keys(sourceTokenSets).length, 1);
  const queryVector = buildWeightedQueryVector(tokens, normalized.tokenIdf);
  const queryNorm = computeVectorNorm(queryVector);
  const rankedRoutes = supportedRoutes
    .map((route) => {
      const weights = normalized.keywordRouteWeights[route] || {};
      const keywordHits = uniqueTokens
        .filter((token) => Number(weights[token] || 0) > 0)
        .map((token) => ({ token, score: Number(weights[token] || 0) }))
        .sort((first, second) => second.score - first.score);
      const phraseHits = keywordHits.filter((item) => item.token.includes(" "));
      const rawKeywordScore = keywordHits.reduce((total, item) => total + item.score, 0);
      const rawPhraseScore = phraseHits.reduce((total, item) => total + item.score, 0);
      const keywordSignal = normalized.enabled
        ? normalizePositiveSignal(rawKeywordScore, uniqueTokens.length > 10 ? 3.4 : 2.8)
        : 0;
      const phraseSignal = normalized.enabled
        ? normalizePositiveSignal(rawPhraseScore, phraseHits.length > 1 ? 2.2 : 1.6)
        : 0;
      const prototypeSimilarity = normalized.enabled
        ? computeCosineSimilarity(
          queryVector,
          normalized.routePrototypeVectors[route] || {},
          queryNorm,
          Number(normalized.routePrototypeNorms[route] || 0)
        )
        : 0;
      const distinctMatches = Array.isArray(normalized.routeDistinctiveTokens[route])
        ? normalized.routeDistinctiveTokens[route].filter((token) => tokenSet.has(token))
        : [];
      const exemplarMatch = normalized.enabled
        ? scoreBestExemplarMatch(tokenSet, normalized.routeExemplarSignatures[route] || [])
        : { score: 0, preview: "", id: "", matchedTokens: [] };
      const priorScore = Number(normalized.routePriors[route] || 0);
      const reliability = normalized.agentReliability[route] || { score: 70, examples: 0 };
      const reliabilitySignal = Number(reliability.score || 70) / 100;
      const confusionRisk = Number(normalized.routeConfusionRisk[route] || 0);
      const confusionPenalty = clamp(confusionRisk * 0.08, 0, 0.06);
      const matchedSourceCount = keywordHits.length
        ? Object.values(sourceTokenSets).filter((set) => keywordHits.some((item) => set.has(item.token))).length
        : 0;
      const sourceCoverageSignal = clamp(matchedSourceCount / sourceCount, 0, 1);
      const evidenceDiversitySignal = clamp(
        keywordHits.length
          ? new Set(keywordHits.map((item) => item.token.split(" ")[0])).size / 5
          : 0,
        0,
        1
      );
      const distinctiveSignal = clamp(distinctMatches.length / 4, 0, 1);
      const score = normalized.enabled
        ? clamp(
          keywordSignal * 0.24
          + phraseSignal * 0.08
          + prototypeSimilarity * 0.31
          + exemplarMatch.score * 0.14
          + sourceCoverageSignal * 0.05
          + evidenceDiversitySignal * 0.04
          + distinctiveSignal * 0.04
          + priorScore * 0.03
          + reliabilitySignal * 0.08
          - confusionPenalty,
          0,
          1
        )
        : 0;

      return {
        route,
        score: round(score, 4),
        keywordSignal: round(keywordSignal, 4),
        phraseSignal: round(phraseSignal, 4),
        prototypeSimilarity: round(prototypeSimilarity, 4),
        exemplarSignal: round(exemplarMatch.score, 4),
        sourceCoverageSignal: round(sourceCoverageSignal, 4),
        evidenceDiversitySignal: round(evidenceDiversitySignal, 4),
        keywordHits: keywordHits.slice(0, 10).map((item) => item.token),
        phraseHits: phraseHits.slice(0, 6).map((item) => item.token),
        distinctMatches: distinctMatches.slice(0, 8),
        exemplarPreview: exemplarMatch.preview,
        exemplarId: exemplarMatch.id,
        exemplarMatches: exemplarMatch.matchedTokens,
        matchedSourceCount,
        confusionRisk: round(confusionRisk, 4),
        confusionPenalty: round(confusionPenalty, 4),
        priorScore: round(priorScore, 4),
        reliability
      };
    })
    .sort((first, second) => second.score - first.score);

  return {
    ok: true,
    enabled: normalized.enabled,
    tokenCount: uniqueTokens.length,
    signalSources: signalBundle.sources,
    signalPreview: buildTrainingPreview(cleanMessage),
    signalPartCount: signalBundle.parts.length,
    tokens: uniqueTokens.slice(0, 40),
    rankedRoutes
  };
}

function hasRouteCalibratorFeatureSet(model = {}) {
  return String(model?.version || "") === TRAINING_ENGINE_VERSION
    && model.routePrototypeVectors
    && typeof model.routePrototypeVectors === "object"
    && !Array.isArray(model.routePrototypeVectors)
    && model.routeExemplarSignatures
    && typeof model.routeExemplarSignatures === "object"
    && !Array.isArray(model.routeExemplarSignatures)
    && model.tokenIdf
    && typeof model.tokenIdf === "object"
    && !Array.isArray(model.tokenIdf);
}

function normalizeCalibrationForScoring(value = {}) {
  const calibration = value && typeof value === "object" && !Array.isArray(value) ? value : {};

  return {
    enabled: calibration.enabled === true || (calibration.status === "trained" && Number(calibration.exampleCount || 0) > 0),
    routePriors: normalizeNumericMap(calibration.routePriors, 0, 1),
    keywordRouteWeights: normalizeRouteWeightMap(calibration.keywordRouteWeights, 12, 180),
    routePrototypeVectors: normalizeRouteWeightMap(calibration.routePrototypeVectors, 20, 180),
    routePrototypeNorms: normalizeNumericMap(calibration.routePrototypeNorms, 0, 1000),
    routeDistinctiveTokens: normalizeRouteTokenListMap(calibration.routeDistinctiveTokens, 20),
    routeExemplarSignatures: normalizeRouteExemplarSignatureMap(calibration.routeExemplarSignatures),
    tokenIdf: normalizeGenericTokenWeights(calibration.tokenIdf, 12, 480),
    agentReliability: normalizeTrainingAgentReliability(calibration.agentReliability),
    confusionMatrix: normalizeRouteConfusionMatrix(calibration.confusionMatrix),
    routeConfusionRisk: buildRouteConfusionRiskMap(calibration.confusionMatrix)
  };
}

function normalizeNumericMap(value = {}, min = 0, max = 1) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .map(([key, score]) => [String(key), clamp(Number(score || 0), min, max)])
      .filter(([, score]) => score > 0)
  );
}

function normalizeRouteWeightMap(value = {}, maxValue = 12, maxTokens = 180) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const output = {};

  for (const [route, weights] of Object.entries(value)) {
    if (!weights || typeof weights !== "object" || Array.isArray(weights)) {
      continue;
    }

    output[route] = Object.fromEntries(
      Object.entries(weights)
        .map(([token, score]) => [normalizeText(token), clamp(Number(score || 0), 0, maxValue)])
        .filter(([token, score]) => token && score > 0)
        .slice(0, maxTokens)
    );
  }

  return output;
}

function normalizeRouteTokenListMap(value = {}, maxItems = 20) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).map(([route, tokens]) => [
      String(route),
      (Array.isArray(tokens) ? tokens : [])
        .map((token) => normalizeText(token))
        .filter(Boolean)
        .slice(0, maxItems)
    ])
  );
}

function normalizeRouteExemplarSignatureMap(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const output = {};

  for (const [route, exemplars] of Object.entries(value)) {
    if (!Array.isArray(exemplars)) {
      continue;
    }

    output[route] = exemplars.slice(0, 8).map((example) => {
      const tokenWeights = normalizeGenericTokenWeights(example?.tokenWeights, 20, 20);
      const signatureTokens = Array.isArray(example?.signatureTokens) && example.signatureTokens.length
        ? example.signatureTokens.map((token) => normalizeText(token)).filter(Boolean).slice(0, 16)
        : Object.keys(tokenWeights).slice(0, 16);
      const totalWeight = Number(example?.totalWeight || Object.values(tokenWeights).reduce((total, score) => total + Number(score || 0), 0));

      return {
        id: String(example?.id || ""),
        preview: sanitizeTrainingText(example?.preview || "").slice(0, 160),
        weight: clamp(Number(example?.weight || 1), 0.5, 1.4),
        signatureTokens,
        tokenWeights,
        totalWeight: clamp(totalWeight, 0, 200)
      };
    });
  }

  return output;
}

function normalizeGenericTokenWeights(value = {}, maxValue = 12, maxTokens = 480) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .map(([token, score]) => [normalizeText(token), clamp(Number(score || 0), 0, maxValue)])
      .filter(([token, score]) => token && score > 0)
      .slice(0, maxTokens)
  );
}

function normalizeTrainingAgentReliability(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).map(([route, details]) => [
      String(route),
      {
        ...(details && typeof details === "object" && !Array.isArray(details) ? details : {}),
        score: clamp(Number(details?.score || 70), 0, 100),
        examples: Math.max(0, Number(details?.examples || 0))
      }
    ])
  );
}

function normalizeRouteConfusionMatrix(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const output = {};

  for (const [actualRoute, expectedMap] of Object.entries(value)) {
    if (!expectedMap || typeof expectedMap !== "object" || Array.isArray(expectedMap)) {
      continue;
    }

    output[String(actualRoute)] = Object.fromEntries(
      Object.entries(expectedMap)
        .map(([expectedRoute, count]) => [String(expectedRoute), Math.max(0, Number(count || 0))])
        .filter(([, count]) => count > 0)
    );
  }

  return output;
}

function buildRouteConfusionRiskMap(confusionMatrix = {}) {
  const normalized = normalizeRouteConfusionMatrix(confusionMatrix);
  const riskMap = {};

  for (const route of supportedRoutes) {
    const expectedCounts = normalized[route] || {};
    const total = Object.values(expectedCounts).reduce((sum, count) => sum + Number(count || 0), 0);
    const wrong = Object.entries(expectedCounts)
      .filter(([expectedRoute]) => expectedRoute !== route)
      .reduce((sum, [, count]) => sum + Number(count || 0), 0);

    riskMap[route] = total ? round(wrong / total, 4) : 0;
  }

  return riskMap;
}

function countTrainingTokens(tokens = []) {
  const counts = {};

  for (const token of tokens) {
    counts[token] = (counts[token] || 0) + 1;
  }

  return counts;
}

function calculateTrainingExampleWeight(example = {}) {
  return 1
    + (Number(example.rating || 3) - 3) * 0.12
    + (example.outcome === "correct" ? 0.18 : 0)
    - (example.outcome === "needs_review" ? 0.06 : 0)
    - (example.outcome === "incorrect" ? 0.12 : 0);
}

function buildTokenIdfWeights(documentFrequency = {}, totalDocuments = 0) {
  if (!totalDocuments) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(documentFrequency)
      .map(([token, frequency]) => [
        token,
        round(Math.log((totalDocuments + 1) / (Number(frequency || 0) + 1)) + 1, 4)
      ])
      .sort((first, second) => second[1] - first[1])
      .slice(0, 420)
  );
}

function buildRouteKeywordWeights(route, tokenCounts, routeCounts, tokenIdf, globalTokenTotals) {
  return Object.fromEntries(
    Object.entries(tokenCounts[route] || {})
      .map(([token, score]) => {
        const routeAverage = Number(score || 0) / Math.max(routeCounts[route] || 0, 1);
        const concentration = Number(score || 0) / Math.max(Number(globalTokenTotals[token] || score || 1), 1);
        const idf = Number(tokenIdf[token] || 1);
        const weightedScore = routeAverage * (0.72 + concentration * 0.58) * (0.84 + idf * 0.16);

        return [token, round(weightedScore, 4)];
      })
      .sort((first, second) => second[1] - first[1])
      .slice(0, 110)
  );
}

function buildRoutePrototypeVector(route, tokenCounts, routeCounts, tokenIdf, globalTokenTotals) {
  return Object.fromEntries(
    Object.entries(tokenCounts[route] || {})
      .map(([token, score]) => {
        const routeAverage = Number(score || 0) / Math.max(routeCounts[route] || 0, 1);
        const concentration = Number(score || 0) / Math.max(Number(globalTokenTotals[token] || score || 1), 1);
        const idf = Number(tokenIdf[token] || 1);
        const weightedScore = routeAverage * idf * (0.76 + concentration * 0.68);

        return [token, round(weightedScore, 4)];
      })
      .sort((first, second) => second[1] - first[1])
      .slice(0, 140)
  );
}

function buildRouteExemplarSignatures(examples = [], tokenIdf = {}) {
  return [...examples]
    .sort((first, second) => second.weight - first.weight || Object.keys(second.tokenFrequency || {}).length - Object.keys(first.tokenFrequency || {}).length)
    .slice(0, 6)
    .map((example) => {
      const tokenWeights = Object.fromEntries(
        Object.entries(example.tokenFrequency || {})
          .map(([token, frequency]) => [token, round(Math.min(Number(frequency || 0), 3) * Number(tokenIdf[token] || 1), 4)])
          .sort((first, second) => second[1] - first[1])
          .slice(0, 12)
      );

      return {
        id: example.id,
        preview: example.preview,
        weight: round(example.weight, 3),
        signatureTokens: Object.keys(tokenWeights),
        tokenWeights,
        totalWeight: round(Object.values(tokenWeights).reduce((total, score) => total + Number(score || 0), 0), 4)
      };
    });
}

function buildWeightedQueryVector(tokens = [], tokenIdf = {}) {
  const counts = countTrainingTokens(tokens);

  return Object.fromEntries(
    Object.entries(counts).map(([token, frequency]) => [
      token,
      round(Math.min(Number(frequency || 0), 3) * Number(tokenIdf[token] || 1), 4)
    ])
  );
}

function computeVectorNorm(vector = {}) {
  return Math.sqrt(
    Object.values(vector).reduce((total, score) => total + Number(score || 0) ** 2, 0)
  );
}

function computeCosineSimilarity(sourceVector = {}, targetVector = {}, sourceNorm = 0, targetNorm = 0) {
  const leftNorm = Number(sourceNorm || 0);
  const rightNorm = Number(targetNorm || 0);

  if (!leftNorm || !rightNorm) {
    return 0;
  }

  const sourceEntries = Object.entries(sourceVector);
  const targetEntries = Object.entries(targetVector);
  const [smaller, lookup] = sourceEntries.length <= targetEntries.length
    ? [sourceEntries, targetVector]
    : [targetEntries, sourceVector];
  const dotProduct = smaller.reduce((total, [token, score]) => total + Number(score || 0) * Number(lookup[token] || 0), 0);

  return clamp(dotProduct / (leftNorm * rightNorm), 0, 1);
}

function normalizePositiveSignal(value, scale = 3) {
  if (!value) {
    return 0;
  }

  return clamp(1 - Math.exp(-Number(value || 0) / Math.max(Number(scale || 3), 0.5)), 0, 1);
}

function scoreBestExemplarMatch(tokenSet, exemplars = []) {
  const best = exemplars
    .map((example) => {
      const tokenWeights = example?.tokenWeights || {};
      const signatureTokens = Array.isArray(example?.signatureTokens) && example.signatureTokens.length
        ? example.signatureTokens
        : Object.keys(tokenWeights);
      const matchedTokens = signatureTokens.filter((token) => tokenSet.has(token));
      const matchedWeight = matchedTokens.reduce((total, token) => total + Number(tokenWeights[token] || 0), 0);
      const totalWeight = Number(example?.totalWeight || Object.values(tokenWeights).reduce((total, score) => total + Number(score || 0), 0));
      const coverage = totalWeight ? matchedWeight / totalWeight : 0;
      const density = matchedTokens.length / Math.max(signatureTokens.length, 1);
      const score = clamp(
        (coverage * 0.72 + density * 0.28) * clamp(Number(example?.weight || 1), 0.75, 1.15),
        0,
        1
      );

      return {
        score,
        preview: String(example?.preview || ""),
        id: String(example?.id || ""),
        matchedTokens: matchedTokens.slice(0, 8)
      };
    })
    .sort((first, second) => second.score - first.score);

  return best[0] || { score: 0, preview: "", id: "", matchedTokens: [] };
}

function buildTrainingPreview(message) {
  const clean = sanitizeTrainingText(message || "");

  return clean ? `${clean.slice(0, 120)}${clean.length > 120 ? "..." : ""}` : "";
}

function normalizeStoredExample(example) {
  if (!example || typeof example !== "object") {
    return null;
  }

  return {
    id: String(example.id || randomUUID()),
    createdAt: String(example.createdAt || new Date().toISOString()),
    patientFingerprint: String(example.patientFingerprint || hashId(example.patientId || "demo-patient")),
    tab: normalizeTab(example.tab || ""),
    message: sanitizeTrainingText(example.message || "").slice(0, 700),
    expectedRoute: normalizeRoute(example.expectedRoute || example.route || "", ""),
    actualRoute: normalizeRoute(example.actualRoute || "", ""),
    approved: example.approved === true,
    rating: normalizeRating(example.rating),
    outcome: normalizeOutcome(example.outcome || ""),
    tags: normalizeTags(example.tags || []),
    reviewer: sanitizeTrainingText(example.reviewer || "").slice(0, 80),
    note: sanitizeTrainingText(example.note || "").slice(0, 240)
  };
}

function toPublicTrainingExample(example) {
  return {
    id: example.id,
    createdAt: example.createdAt,
    tab: example.tab,
    expectedRoute: example.expectedRoute,
    actualRoute: example.actualRoute,
    approved: example.approved,
    rating: example.rating,
    outcome: example.outcome,
    tags: example.tags,
    preview: example.message ? `${example.message.slice(0, 90)}${example.message.length > 90 ? "..." : ""}` : ""
  };
}

async function writeTrainingState(state) {
  const body = `${JSON.stringify(state, null, 2)}\n`;

  trainingWriteQueue = trainingWriteQueue.catch(() => {}).then(async () => {
    await mkdir(dirname(trainingFile), { recursive: true });
    const tmpFile = `${trainingFile}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
    await writeFile(tmpFile, body, "utf8");
    await rename(tmpFile, trainingFile);
    const fileStats = await stat(trainingFile).catch(() => null);
    cachedTrainingState = state;
    cachedTrainingMtimeMs = fileStats?.mtimeMs || Date.now();
  });

  await trainingWriteQueue;
}

function detectRouteFromText(message) {
  const text = normalizeText(message);

  if (/\b(chest pain|shortness of breath|cannot breathe|faint|stroke|severe allergy|suicide|self harm)\b/.test(text)) {
    return "ALERT_AGENT";
  }
  if (/\b(medicine|medication|tablet|dose|side effect|metformin|amlodipine|insulin|drug)\b/.test(text)) {
    return "PHARMACY_AGENT";
  }
  if (/\b(bp|blood pressure|sugar|glucose|pulse|heart rate|temperature|bmi|weight)\b/.test(text)) {
    return "VITALS_AGENT";
  }
  if (/\b(hba1c|cholesterol|cbc|lab|report|creatinine|egfr|ldl|hdl)\b/.test(text)) {
    return "LABS_AGENT";
  }
  if (/\b(appointment|visit|follow up|schedule|book|doctor)\b/.test(text)) {
    return "SCHEDULING_AGENT";
  }
  if (/\b(insurance|claim|coverage|prior auth|appeal|eob|benefit)\b/.test(text)) {
    return "INSURANCE_AGENT";
  }
  if (/\b(record|summary|history|vault|profile)\b/.test(text)) {
    return "RECORDS_AGENT";
  }
  if (/\b(diet|sleep|stress|exercise|walking|habit|wellness|mental)\b/.test(text)) {
    return "WELLNESS_AGENT";
  }
  if (/\b(disease|condition|diabetes|hypertension|asthma|kidney|heart)\b/.test(text)) {
    return "SPECIALIST_DOCTOR_AGENT";
  }

  return "RAG_AGENT";
}

function normalizeRoute(value, fallback = "RAG_AGENT") {
  const raw = String(value || "").trim();

  if (!raw) {
    return fallback;
  }

  const upper = raw.toUpperCase().replace(/[^A-Z0-9_]+/g, "_");
  if (supportedRoutes.includes(upper)) {
    return upper;
  }

  return routeAliases[normalizeText(raw)] || fallback;
}

function normalizeTab(value) {
  return normalizeText(value).slice(0, 40);
}

function normalizeOutcome(value) {
  const text = normalizeText(value);

  if (["correct", "success", "helpful", "accepted"].includes(text)) {
    return "correct";
  }
  if (["wrong", "incorrect", "bad", "failed"].includes(text)) {
    return "incorrect";
  }
  if (["review", "needs review", "needs_review", "unclear"].includes(text)) {
    return "needs_review";
  }

  return text || "not_reviewed";
}

function normalizeRating(value) {
  const rating = Number.parseFloat(value);

  if (!Number.isFinite(rating)) {
    return 3;
  }

  return Math.round(clamp(rating, 1, 5));
}

function normalizeTags(value) {
  const tags = Array.isArray(value) ? value : String(value || "").split(",");

  return tags
    .map((tag) => sanitizeTrainingText(tag).slice(0, 32))
    .filter(Boolean)
    .slice(0, 8);
}

function dedupeTrainingSignalTerms(items = [], limit = 8) {
  const seen = new Set();
  const output = [];

  for (const item of items) {
    const text = sanitizeTrainingText(item).slice(0, 90);
    const key = normalizeText(text);

    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(text);

    if (output.length >= limit) {
      break;
    }
  }

  return output;
}

function readTrainingSignalTerms(value, limit = 6) {
  const values = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? Object.values(value)
      : String(value || "").split(/[,;|]/);

  return dedupeTrainingSignalTerms(
    values
      .map(extractTrainingSignalText)
      .filter(Boolean),
    limit
  );
}

function extractTrainingSignalText(value) {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }

  if (!value || typeof value !== "object") {
    return "";
  }

  return [
    value.name,
    value.label,
    value.title,
    value.type,
    value.metric,
    value.result,
    value.value,
    value.condition,
    value.medication,
    value.allergy,
    value.text
  ]
    .map((item) => String(item || "").trim())
    .find(Boolean) || "";
}

function buildTrainingVitalSignalParts(vitals = {}) {
  const signals = [];
  const systolic = readTrainingNumeric(vitals.systolic);
  const diastolic = readTrainingNumeric(vitals.diastolic);
  const heartRate = readTrainingNumeric(vitals.heartRate || vitals.pulse);
  const glucose = readTrainingNumeric(vitals.bloodSugar || vitals.glucose);
  const oxygen = readTrainingNumeric(vitals.oxygen || vitals.spo2);
  const temperature = readTrainingNumeric(vitals.temperatureC || vitals.temperatureF || vitals.temperature);
  const bmi = readTrainingNumeric(vitals.bmi);

  if (systolic || diastolic) {
    signals.push(`blood pressure ${[systolic, diastolic].filter(Boolean).join(" ")}`);
  }
  if (heartRate) {
    signals.push(`heart rate ${heartRate}`);
  }
  if (glucose) {
    signals.push(`blood sugar ${glucose}`);
  }
  if (oxygen) {
    signals.push(`oxygen ${oxygen}`);
  }
  if (temperature) {
    signals.push(`temperature ${temperature}`);
  }
  if (bmi) {
    signals.push(`bmi ${bmi}`);
  }

  return signals;
}

function readTrainingNumeric(value) {
  const text = String(value ?? "").trim();
  const match = text.match(/\d+(?:\.\d+)?/);
  return match ? match[0] : "";
}

function buildTrainingContextSignalParts(context = {}) {
  const signals = [];
  const careGoal = sanitizeTrainingText(context.careGoal || "");
  const duration = sanitizeTrainingText(context.duration || "");
  const severity = readTrainingNumeric(context.severity);
  const supportNow = sanitizeTrainingText(context.supportNow || "");
  const specialistFocus = sanitizeTrainingText(context.specialistFocus || "");
  const specialistLens = sanitizeTrainingText(context.specialistLens || "");
  const lastMedicationTime = sanitizeTrainingText(context.lastMedicationTime || "");
  const redFlags = readTrainingSignalTerms(context.redFlags, 4);
  const riskModifiers = readTrainingSignalTerms(context.riskModifiers, 4);

  if (careGoal) {
    signals.push(`care goal ${careGoal}`);
  }
  if (duration && duration !== "not-sure") {
    signals.push(`duration ${duration}`);
  }
  if (severity) {
    signals.push(`severity ${severity} out of 10`);
  }
  if (supportNow && supportNow !== "with-someone") {
    signals.push(`support ${supportNow}`);
  }
  if (specialistFocus) {
    signals.push(`specialist focus ${specialistFocus}`);
  }
  if (specialistLens) {
    signals.push(`specialist lens ${specialistLens}`);
  }
  if (lastMedicationTime) {
    signals.push(`medication timing ${lastMedicationTime}`);
  }
  if (redFlags.length) {
    signals.push(`red flags ${redFlags.join(" ")}`);
  }
  if (riskModifiers.length) {
    signals.push(`risk modifiers ${riskModifiers.join(" ")}`);
  }

  return signals;
}

function tokenizeTrainingText(value) {
  const words = normalizeText(value)
    .split(" ")
    .filter((word) => word.length > 1 && !stopWords.has(word));
  const tokens = [...words];

  for (let index = 0; index < words.length - 1; index += 1) {
    const phrase = `${words[index]} ${words[index + 1]}`;
    if (!stopWords.has(words[index]) && !stopWords.has(words[index + 1])) {
      tokens.push(phrase);
    }
  }

  for (let index = 0; index < words.length - 2; index += 1) {
    const first = words[index];
    const second = words[index + 1];
    const third = words[index + 2];
    if (!stopWords.has(first) && !stopWords.has(second) && !stopWords.has(third)) {
      tokens.push(`${first} ${second} ${third}`);
    }
  }

  return tokens.slice(0, 160);
}

function sanitizeTrainingText(value) {
  return String(value || "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\b(?:\+?\d[\d\s().-]{7,}\d)\b/g, "[phone]")
    .replace(/\b(?:mrn|medical record|patient id)\s*[:#-]?\s*[a-z0-9-]+\b/gi, "[identifier]")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hashId(value) {
  return createHash("sha256").update(String(value || "demo-patient")).digest("hex").slice(0, 16);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function round(value, precision = 2) {
  const factor = 10 ** precision;

  return Math.round((Number(value) || 0) * factor) / factor;
}

function formatProjectRelativePath(filePath) {
  const projectRelative = relative(rootDir, filePath).replace(/\\/g, "/");

  if (!projectRelative || projectRelative.startsWith("..")) {
    return filePath;
  }

  return projectRelative;
}
