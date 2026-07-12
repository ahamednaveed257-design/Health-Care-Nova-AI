import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { withFileWriteLock } from "./fileWriteLock.js";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const memoryFile = resolve(rootDir, "data", "memory", "patient-memory.json");
const maxHistoryItems = 40;
const maxSignalItems = 24;
let cachedStore = null;
let cachedStoreMtimeMs = 0;
let storeWriteQueue = Promise.resolve();

export function getMemoryStorageInfo() {
  return {
    mode: "persistent-local-server",
    file: "data/memory/patient-memory.json",
    maxHistoryItems
  };
}

export async function loadPatientMemory(patientId = "demo-patient") {
  const id = normalizePatientId(patientId);
  const store = await readStore();
  const patient = normalizePatientRecord(store.patients[id], id);

  return toPublicMemory(patient);
}

export async function appendPatientMemory({ patientId = "demo-patient", payload = {}, result = {} }) {
  const id = normalizePatientId(patientId);
  const store = await readStore();
  const patient = normalizePatientRecord(store.patients[id], id);
  const nextProfile = mergeProfiles(patient.profile, payload.profile);
  const entry = createMemoryEntry({ payload, result, profileSnapshot: nextProfile });

  patient.profile = nextProfile;
  patient.history = dedupeHistory([entry, ...patient.history]).slice(0, maxHistoryItems);
  patient.lastMemoryPatch = result.memoryPatch || null;
  patient.stats = buildStats(patient.history);
  patient.updatedAt = entry.at;
  patient.createdAt = patient.createdAt || entry.at;
  store.patients[id] = patient;
  store.updatedAt = entry.at;

  await writeStore(store, { replacePatientIds: [id] });
  return toPublicMemory(patient);
}

export async function clearPatientMemory(patientId = "demo-patient") {
  const id = normalizePatientId(patientId);
  const store = await readStore();

  delete store.patients[id];
  store.updatedAt = new Date().toISOString();
  await writeStore(store, { deletePatientIds: [id] });

  return toPublicMemory(normalizePatientRecord(null, id));
}

export function mergeMemoryHistory(primaryHistory = [], fallbackHistory = []) {
  return dedupeHistory([...primaryHistory, ...fallbackHistory]).slice(0, maxHistoryItems);
}

export async function mergeImportedPatientMemory({
  patientId = "demo-patient",
  profile = {},
  history = []
} = {}) {
  const id = normalizePatientId(patientId);
  const store = await readStore();
  const patient = normalizePatientRecord(store.patients[id], id);
  const incomingHistory = Array.isArray(history)
    ? dedupeHistory(history.map(normalizeHistoryItem)).slice(0, maxHistoryItems)
    : [];
  const nextHistory = mergeMemoryHistory(incomingHistory, patient.history);
  const now = new Date().toISOString();

  patient.profile = mergeProfiles(patient.profile, profile);
  patient.history = nextHistory;
  patient.stats = buildStats(nextHistory);
  patient.updatedAt = nextHistory[0]?.at || now;
  patient.createdAt = patient.createdAt || nextHistory[nextHistory.length - 1]?.at || now;
  store.patients[id] = patient;
  store.updatedAt = now;

  await writeStore(store, { replacePatientIds: [id] });
  return toPublicMemory(patient);
}

async function readStore() {
  try {
    await storeWriteQueue.catch(() => {});
    const fileStats = await stat(memoryFile).catch((error) => {
      if (error.code === "ENOENT") {
        return null;
      }

      throw error;
    });

    if (cachedStore && fileStats && cachedStoreMtimeMs === fileStats.mtimeMs) {
      return cloneStore(cachedStore);
    }

    if (cachedStore && !fileStats && cachedStoreMtimeMs === 0) {
      return cloneStore(cachedStore);
    }

    if (!fileStats) {
      cachedStore = createEmptyStore();
      cachedStoreMtimeMs = 0;
      return cloneStore(cachedStore);
    }

    const raw = await readFile(memoryFile, "utf8");
    let parsed;

    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      if (error instanceof SyntaxError) {
        const cachedSnapshot = useCachedStoreFallback(fileStats.mtimeMs);

        if (cachedSnapshot) {
          return cachedSnapshot;
        }
      }

      throw error;
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      const cachedSnapshot = useCachedStoreFallback(fileStats.mtimeMs);

      if (cachedSnapshot) {
        return cachedSnapshot;
      }

      cachedStore = createEmptyStore();
      cachedStoreMtimeMs = fileStats.mtimeMs;
      return cloneStore(cachedStore);
    }

    cachedStore = cloneStore({
      version: 1,
      createdAt: parsed.createdAt || new Date().toISOString(),
      updatedAt: parsed.updatedAt || parsed.createdAt || new Date().toISOString(),
      patients: parsed.patients && typeof parsed.patients === "object" && !Array.isArray(parsed.patients)
        ? parsed.patients
        : {}
    });
    cachedStoreMtimeMs = fileStats.mtimeMs;
    return cloneStore(cachedStore);
  } catch (error) {
    if (error.code === "ENOENT") {
      cachedStore = createEmptyStore();
      cachedStoreMtimeMs = 0;
      return cloneStore(cachedStore);
    }

    if (error instanceof SyntaxError) {
      const cachedSnapshot = useCachedStoreFallback();

      if (cachedSnapshot) {
        return cachedSnapshot;
      }

      cachedStore = createEmptyStore();
      cachedStoreMtimeMs = 0;
      return cloneStore(cachedStore);
    }

    throw error;
  }
}

async function writeStore(store, options = {}) {
  const queuedStore = cloneStore(store);
  const queuedOptions = snapshotWriteOptions(options);

  storeWriteQueue = storeWriteQueue.catch(() => {}).then(async () => withFileWriteLock(memoryFile, async () => {
    const latestStore = await readStoreFromDisk();
    const nextStore = cloneStore(mergeStoreForWrite(latestStore, queuedStore, queuedOptions));
    const body = `${JSON.stringify(nextStore, null, 2)}\n`;

    await mkdir(dirname(memoryFile), { recursive: true });
    const temporaryFile = `${memoryFile}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;

    await writeFile(temporaryFile, body, "utf8");
    await replaceFileWithRetry(temporaryFile, memoryFile);
    const fileStats = await stat(memoryFile).catch(() => null);
    cachedStore = nextStore;
    cachedStoreMtimeMs = fileStats?.mtimeMs || Date.now();
  }));

  await storeWriteQueue;
}

async function readStoreFromDisk() {
  const raw = await readFile(memoryFile, "utf8").catch((error) => {
    if (error.code === "ENOENT") {
      return "";
    }

    throw error;
  });

  if (!raw.trim()) {
    const cachedSnapshot = useCachedStoreFallback();

    if (cachedSnapshot) {
      return cachedSnapshot;
    }

    return createEmptyStore();
  }

  try {
    const parsed = JSON.parse(raw);

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      const cachedSnapshot = useCachedStoreFallback();

      if (cachedSnapshot) {
        return cachedSnapshot;
      }

      return createEmptyStore();
    }

    return cloneStore({
      version: 1,
      createdAt: parsed.createdAt || new Date().toISOString(),
      updatedAt: parsed.updatedAt || parsed.createdAt || new Date().toISOString(),
      patients: parsed.patients && typeof parsed.patients === "object" && !Array.isArray(parsed.patients)
        ? parsed.patients
        : {}
    });
  } catch {
    const cachedSnapshot = useCachedStoreFallback();

    if (cachedSnapshot) {
      return cachedSnapshot;
    }

    return createEmptyStore();
  }
}

function cloneStore(store = null) {
  const source = store && typeof store === "object" && !Array.isArray(store)
    ? deepClone(store)
    : createEmptyStore();

  return {
    version: 1,
    createdAt: cleanText(source.createdAt) || new Date().toISOString(),
    updatedAt: cleanText(source.updatedAt) || cleanText(source.createdAt) || new Date().toISOString(),
    patients: source.patients && typeof source.patients === "object" && !Array.isArray(source.patients)
      ? source.patients
      : {}
  };
}

function snapshotWriteOptions(options = {}) {
  return {
    replacePatientIds: Array.isArray(options.replacePatientIds) ? [...options.replacePatientIds] : [],
    deletePatientIds: Array.isArray(options.deletePatientIds) ? [...options.deletePatientIds] : []
  };
}

function useCachedStoreFallback(mtimeMs = cachedStoreMtimeMs) {
  if (!cachedStore) {
    return null;
  }

  if (Number.isFinite(mtimeMs)) {
    cachedStoreMtimeMs = mtimeMs;
  }

  return cloneStore(cachedStore);
}

function mergeStoreForWrite(baseStore, nextStore, options = {}) {
  const replacePatientIds = new Set(options.replacePatientIds || []);
  const deletePatientIds = new Set(options.deletePatientIds || []);
  const merged = {
    version: 1,
    createdAt: baseStore.createdAt || nextStore.createdAt || new Date().toISOString(),
    updatedAt: nextStore.updatedAt || baseStore.updatedAt || new Date().toISOString(),
    patients: {
      ...(baseStore.patients || {})
    }
  };

  for (const patientId of deletePatientIds) {
    delete merged.patients[patientId];
  }

  for (const patientId of replacePatientIds) {
    const basePatient = normalizePatientRecord(merged.patients[patientId], patientId);
    const nextPatient = normalizePatientRecord(nextStore.patients?.[patientId], patientId);
    const history = mergeMemoryHistory(nextPatient.history, basePatient.history);

    merged.patients[patientId] = {
      ...basePatient,
      ...nextPatient,
      createdAt: earliestIso(basePatient.createdAt, nextPatient.createdAt),
      updatedAt: nextPatient.updatedAt || basePatient.updatedAt,
      history,
      stats: buildStats(history),
      lastMemoryPatch: nextPatient.lastMemoryPatch || basePatient.lastMemoryPatch
    };
  }

  if (!replacePatientIds.size && !deletePatientIds.size) {
    merged.patients = {
      ...(baseStore.patients || {}),
      ...(nextStore.patients || {})
    };
  }

  return merged;
}

function earliestIso(first, second) {
  const firstTime = new Date(first).getTime();
  const secondTime = new Date(second).getTime();

  if (!Number.isFinite(firstTime)) {
    return second || new Date().toISOString();
  }

  if (!Number.isFinite(secondTime)) {
    return first || new Date().toISOString();
  }

  return firstTime <= secondTime ? first : second;
}

async function replaceFileWithRetry(source, target) {
  let lastError = null;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await rename(source, target);
      return;
    } catch (error) {
      lastError = error;

      if (!["EBUSY", "EPERM", "EACCES"].includes(error.code)) {
        throw error;
      }

      await wait(25 * (attempt + 1));
    }
  }

  throw lastError;
}

function wait(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function deepClone(value) {
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
}

function createEmptyStore() {
  const now = new Date().toISOString();

  return {
    version: 1,
    createdAt: now,
    updatedAt: now,
    patients: {}
  };
}

function normalizePatientRecord(record, patientId) {
  const now = new Date().toISOString();
  const history = Array.isArray(record?.history)
    ? dedupeHistory(record.history.map(normalizeHistoryItem)).slice(0, maxHistoryItems)
    : [];

  return {
    patientId,
    createdAt: record?.createdAt || now,
    updatedAt: record?.updatedAt || record?.createdAt || now,
    profile: sanitizeProfile(record?.profile || {}),
    history,
    lastMemoryPatch: record?.lastMemoryPatch || null,
    stats: buildStats(history)
  };
}

function toPublicMemory(patient) {
  return {
    ...getMemoryStorageInfo(),
    patientId: patient.patientId,
    createdAt: patient.createdAt,
    updatedAt: patient.updatedAt,
    recentTurnCount: patient.history.length,
    profile: patient.profile,
    history: patient.history,
    stats: patient.stats,
    lastMemoryPatch: patient.lastMemoryPatch
  };
}

function createMemoryEntry({ payload, result, profileSnapshot = {} }) {
  const patch = result.memoryPatch || {};
  const risk = result.risk || {};
  const response = result.finalResponse || {};
  const safetyTriage = result.safetyTriage && typeof result.safetyTriage === "object"
    ? result.safetyTriage
    : {};
  const evidenceCitations = result.evidenceCitations && typeof result.evidenceCitations === "object"
    ? result.evidenceCitations
    : {};
  const humanReview = result.humanReview && typeof result.humanReview === "object"
    ? result.humanReview
    : {};
  const preventionPlan = result.preventionPlan && typeof result.preventionPlan === "object"
    ? result.preventionPlan
    : {};
  const doctorReadyReport = result.doctorReadyReport && typeof result.doctorReadyReport === "object"
    ? result.doctorReadyReport
    : {};
  const multimodalIntake = result.multimodalIntake && typeof result.multimodalIntake === "object"
    ? result.multimodalIntake
    : {};
  const responseFocus = response.responseFocus && typeof response.responseFocus === "object"
    ? response.responseFocus
    : {};
  const responseOwner = result.plan?.responseOwner && typeof result.plan.responseOwner === "object"
    ? result.plan.responseOwner
    : {};
  const topIntent = Array.isArray(result.intents) ? (result.intents[0] || {}) : {};
  const agentResults = Array.isArray(result.agentResults) ? result.agentResults : [];
  const routes = Array.isArray(patch.latestRoutes) ? patch.latestRoutes : [];
  const intents = Array.isArray(patch.latestIntents) ? patch.latestIntents : [];
  const vitals = patch.recentReadings || payload.vitals || {};
  const contextSignals = mergeContextSignalSources(
    (payload.context && typeof payload.context === "object") ? payload.context : {},
    (patch.latestContextSignals && typeof patch.latestContextSignals === "object") ? patch.latestContextSignals : {}
  );
  const snapshotProfile = patch.profileSnapshot || profileSnapshot || payload.profile || {};
  const focusFamilies = normalizeFocusFamilies(patch.latestFocusFamilies);
  const contextSignalBundle = buildContextSignalBundle(contextSignals);
  const primaryIntent = cleanText(topIntent.type || responseFocus.primaryIntent).slice(0, 80);
  const primaryRoute = cleanText(topIntent.route || responseFocus.primaryRoute).slice(0, 80);
  const responseOwnerRoute = cleanText(responseOwner.route || primaryRoute).slice(0, 80);
  const responseFocusLabel = cleanText(responseFocus.label || responseFocus.title || response.title).slice(0, 140);
  const actionItems = normalizeFlexibleTextArray(response.whatToDoNow, 6, 180);
  const warningSigns = normalizeFlexibleTextArray(response.warningSigns, 6, 180);
  const evidenceRefs = normalizeFlexibleTextArray(patch.knowledgeSnapshot?.references, 8, 120);
  const triageLevel = cleanText(safetyTriage.level || risk.level || patch.latestRiskLevel || "UNKNOWN").toUpperCase().slice(0, 20);
  const triageRoute = cleanText(safetyTriage.recommendedRoute || responseOwnerRoute || primaryRoute).slice(0, 80);
  const triageSignals = normalizeFlexibleTextArray(
    Array.isArray(safetyTriage.signals)
      ? safetyTriage.signals.map((signal) => signal?.label || signal?.id)
      : [],
    6,
    160
  );
  const reviewReasons = normalizeFlexibleTextArray(humanReview.reviewReasons, 6, 120);
  const doctorQuestions = normalizeFlexibleTextArray(doctorReadyReport.questionsToAsk, 6, 180);
  const preventionFocusAreas = normalizeFlexibleTextArray(preventionPlan.focusAreas, 6, 120);
  const evidenceTitles = normalizeFlexibleTextArray(
    Array.isArray(evidenceCitations.items)
      ? evidenceCitations.items.map((item) => [item?.citationKey, item?.title].filter(Boolean).join(" "))
      : [],
    6,
    180
  );
  const documentType = cleanText(multimodalIntake.documentType?.id || multimodalIntake.documentType?.label).slice(0, 80);
  const documentMarkers = normalizeFlexibleTextArray(
    Array.isArray(multimodalIntake.markers)
      ? multimodalIntake.markers.map((marker) => marker?.marker || marker?.label)
      : [],
    8,
    80
  );
  const documentValueHints = normalizeFlexibleTextArray(
    Array.isArray(multimodalIntake.valueHints)
      ? multimodalIntake.valueHints.map((hint) => [hint?.marker, hint?.value].filter(Boolean).join(" "))
      : [],
    8,
    80
  );
  const continuitySummary = buildContinuitySummary({
    profile: snapshotProfile,
    vitals,
    risk: risk.level || patch.latestRiskLevel || "UNKNOWN",
    routes,
    focusFamilies,
    summary: response.summary || "",
    responseFocusLabel,
    warningSigns,
    contextSignalBundle,
    triageLevel,
    triageSignals,
    reviewReasons,
    preventionFocusAreas
  });
  const routeSummary = buildRouteSummary({ routes, responseOwnerRoute, responseFocusLabel });
  const searchText = buildMemorySearchText({
    message: patch.lastMessage || payload.message || "",
    summary: response.summary || "",
    continuitySummary,
    profile: snapshotProfile,
    vitals,
    context: contextSignals,
    intents,
    routes,
    primaryIntent,
    primaryRoute,
    responseOwnerRoute,
    responseFocusLabel,
    focusFamilies,
    contextSignalBundle,
    actionItems,
    warningSigns,
    evidenceRefs,
    triageLevel,
    triageRoute,
    triageSignals,
    reviewReasons,
    doctorQuestions,
    preventionFocusAreas,
    evidenceTitles,
    documentType,
    documentMarkers,
    documentValueHints
  });

  return normalizeHistoryItem({
    id: globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    at: patch.lastInteractionAt || new Date().toISOString(),
    message: patch.lastMessage || payload.message || "",
    risk: risk.level || patch.latestRiskLevel || "UNKNOWN",
    riskLabel: risk.label || "",
    riskScore: Number.isFinite(risk.score) ? risk.score : null,
    intents,
    routes,
    requirement: patch.latestRequirement || null,
    agents: agentResults.map((agent) => agent.name || agent.id).filter(Boolean).slice(0, 8),
    vitals,
    context: contextSignals,
    profile: snapshotProfile,
    knowledgeSnapshot: patch.knowledgeSnapshot || null,
    summary: response.summary || "",
    routeSummary,
    continuitySummary,
    primaryIntent,
    primaryRoute,
    responseOwner: responseOwnerRoute,
    responseFocusLabel,
    focusFamilies,
    specialistFocus: contextSignalBundle.specialistFocus,
    specialistLens: contextSignalBundle.specialistLens,
    riskModifiers: contextSignalBundle.riskModifiers,
    wellnessSignals: contextSignalBundle.wellnessSignals,
    visitSignals: contextSignalBundle.visitSignals,
    actionItems,
    warningSigns,
    evidenceRefs,
    triageLevel,
    triageRoute,
    triageSignals,
    reviewReasons,
    doctorQuestions,
    preventionFocusAreas,
    evidenceTitles,
    documentType,
    documentMarkers,
    documentValueHints,
    searchText,
    signals: buildMemorySignals({
      message: patch.lastMessage || payload.message || "",
      summary: response.summary || "",
      profile: snapshotProfile,
      vitals,
      context: contextSignals,
      intents,
      routes,
      risk: risk.level || patch.latestRiskLevel || "UNKNOWN",
      responseOwner: responseOwnerRoute,
      responseFocusLabel,
      focusFamilies,
      contextSignalBundle,
      actionItems,
      warningSigns,
      evidenceRefs,
      triageLevel,
      triageRoute,
      triageSignals,
      reviewReasons,
      doctorQuestions,
      preventionFocusAreas,
      evidenceTitles,
      documentType,
      documentMarkers,
      documentValueHints
    })
  });
}

function normalizeHistoryItem(item = {}) {
  return {
    id: cleanText(item.id) || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    at: parseDate(item.at) || new Date().toISOString(),
    message: cleanText(item.message || item.lastMessage).slice(0, 240),
    risk: cleanText(item.risk || item.latestRiskLevel || "UNKNOWN").toUpperCase(),
    riskLabel: cleanText(item.riskLabel || ""),
    riskScore: Number.isFinite(Number(item.riskScore)) ? Number(item.riskScore) : null,
    intents: normalizeTextArray(item.intents || item.latestIntents),
    routes: normalizeTextArray(item.routes || item.latestRoutes),
    requirement: item.requirement && typeof item.requirement === "object"
      ? sanitizeObject(item.requirement)
      : null,
    agents: normalizeTextArray(item.agents),
    vitals: sanitizeObject(item.vitals || item.recentReadings),
    context: sanitizeObject(item.context || item.latestContextSignals),
    profile: sanitizeProfile(item.profile || item.profileSnapshot || {}),
    focusFamilies: normalizeFocusFamilies(item.focusFamilies),
    signals: normalizeTextArray(item.signals).slice(0, maxSignalItems),
    primaryIntent: cleanText(item.primaryIntent).slice(0, 80),
    primaryRoute: cleanText(item.primaryRoute).slice(0, 80),
    responseOwner: cleanText(item.responseOwner).slice(0, 80),
    responseFocusLabel: cleanText(item.responseFocusLabel).slice(0, 140),
    specialistFocus: cleanText(item.specialistFocus).slice(0, 80),
    specialistLens: cleanText(item.specialistLens).slice(0, 80),
    riskModifiers: normalizeFlexibleTextArray(item.riskModifiers, 6, 120),
    wellnessSignals: normalizeFlexibleTextArray(item.wellnessSignals, 8, 160),
    visitSignals: normalizeFlexibleTextArray(item.visitSignals, 8, 180),
    actionItems: normalizeFlexibleTextArray(item.actionItems || item.whatToDoNow, 6, 180),
    warningSigns: normalizeFlexibleTextArray(item.warningSigns, 6, 180),
    evidenceRefs: normalizeFlexibleTextArray(item.evidenceRefs || item.references, 8, 120),
    triageLevel: cleanText(item.triageLevel).toUpperCase().slice(0, 20),
    triageRoute: cleanText(item.triageRoute).slice(0, 80),
    triageSignals: normalizeFlexibleTextArray(item.triageSignals, 6, 160),
    reviewReasons: normalizeFlexibleTextArray(item.reviewReasons, 6, 120),
    doctorQuestions: normalizeFlexibleTextArray(item.doctorQuestions, 6, 180),
    preventionFocusAreas: normalizeFlexibleTextArray(item.preventionFocusAreas, 6, 120),
    evidenceTitles: normalizeFlexibleTextArray(item.evidenceTitles, 6, 180),
    documentType: cleanText(item.documentType).slice(0, 80),
    documentMarkers: normalizeFlexibleTextArray(item.documentMarkers, 8, 80),
    documentValueHints: normalizeFlexibleTextArray(item.documentValueHints, 8, 80),
    routeSummary: cleanText(item.routeSummary).slice(0, 160),
    continuitySummary: cleanText(item.continuitySummary).slice(0, 240),
    knowledgeSnapshot: item.knowledgeSnapshot && typeof item.knowledgeSnapshot === "object"
      ? sanitizeObject(item.knowledgeSnapshot)
      : null,
    summary: cleanText(item.summary).slice(0, 360),
    searchText: cleanText(item.searchText).slice(0, 1800)
  };
}

function dedupeHistory(history) {
  const seen = new Set();
  const unique = [];

  for (const item of history.map(normalizeHistoryItem)) {
    const key = `${item.at}:${item.message}:${item.risk}`;

    if (!item.message || seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(item);
  }

  return unique.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

function buildStats(history) {
  const riskCounts = {};
  const routeCounts = {};
  const intentCounts = {};
  const triageCounts = {};
  const triageRouteCounts = {};
  const recentHistory = history.slice(0, 8);

  for (const item of history) {
    riskCounts[item.risk] = (riskCounts[item.risk] || 0) + 1;
    if (item.triageLevel) {
      triageCounts[item.triageLevel] = (triageCounts[item.triageLevel] || 0) + 1;
    }
    countValues(routeCounts, item.routes);
    countValues(intentCounts, item.intents);
    countValues(triageRouteCounts, item.triageRoute ? [item.triageRoute] : []);
  }

  return {
    totalTurns: history.length,
    riskCounts,
    routeCounts,
    intentCounts,
    triageCounts,
    triageRouteCounts,
    latestRisk: history[0]?.risk || "NONE",
    latestInteractionAt: history[0]?.at || null,
    latestRoutes: Array.isArray(history[0]?.routes) ? history[0].routes : [],
    latestIntents: Array.isArray(history[0]?.intents) ? history[0].intents : [],
    latestResponseOwner: cleanText(history[0]?.responseOwner || history[0]?.primaryRoute || ""),
    latestTriageLevel: cleanText(history[0]?.triageLevel || history[0]?.risk || "NONE").toUpperCase(),
    latestTriageRoute: cleanText(history[0]?.triageRoute || history[0]?.responseOwner || history[0]?.primaryRoute || ""),
    activeConditions: dedupeTextItems(
      recentHistory.flatMap((item) => Array.isArray(item.profile?.conditions) ? item.profile.conditions : [])
    ).slice(0, 6),
    activeMedications: dedupeTextItems(
      recentHistory.flatMap((item) => Array.isArray(item.profile?.medications) ? item.profile.medications : [])
    ).slice(0, 6),
    recentWarnings: dedupeTextItems(
      recentHistory.flatMap((item) => Array.isArray(item.warningSigns) ? item.warningSigns : [])
    ).slice(0, 4),
    recentActionItems: dedupeTextItems(
      recentHistory.flatMap((item) => Array.isArray(item.actionItems) ? item.actionItems : [])
    ).slice(0, 4),
    recentSpecialistFocuses: dedupeTextItems(
      recentHistory.map((item) => item.specialistFocus)
    ).slice(0, 4),
    recentRiskModifiers: dedupeTextItems(
      recentHistory.flatMap((item) => Array.isArray(item.riskModifiers) ? item.riskModifiers : [])
    ).slice(0, 6),
    recentWellnessSignals: dedupeTextItems(
      recentHistory.flatMap((item) => Array.isArray(item.wellnessSignals) ? item.wellnessSignals : [])
    ).slice(0, 6),
    recentVisitSignals: dedupeTextItems(
      recentHistory.flatMap((item) => Array.isArray(item.visitSignals) ? item.visitSignals : [])
    ).slice(0, 6),
    recentTriageSignals: dedupeTextItems(
      recentHistory.flatMap((item) => Array.isArray(item.triageSignals) ? item.triageSignals : [])
    ).slice(0, 4),
    recentReviewReasons: dedupeTextItems(
      recentHistory.flatMap((item) => Array.isArray(item.reviewReasons) ? item.reviewReasons : [])
    ).slice(0, 4),
    recentDoctorQuestions: dedupeTextItems(
      recentHistory.flatMap((item) => Array.isArray(item.doctorQuestions) ? item.doctorQuestions : [])
    ).slice(0, 4),
    recentPreventionFocusAreas: dedupeTextItems(
      recentHistory.flatMap((item) => Array.isArray(item.preventionFocusAreas) ? item.preventionFocusAreas : [])
    ).slice(0, 4),
    evidenceRefs: dedupeTextItems(
      recentHistory.flatMap((item) => Array.isArray(item.evidenceRefs) ? item.evidenceRefs : [])
    ).slice(0, 8),
    recentEvidenceTitles: dedupeTextItems(
      recentHistory.flatMap((item) => Array.isArray(item.evidenceTitles) ? item.evidenceTitles : [])
    ).slice(0, 4),
    documentTypes: dedupeTextItems(
      recentHistory.map((item) => item.documentType)
    ).slice(0, 4),
    recentDocumentMarkers: dedupeTextItems(
      recentHistory.flatMap((item) => Array.isArray(item.documentMarkers) ? item.documentMarkers : [])
    ).slice(0, 6)
  };
}

function sanitizeProfile(profile = {}) {
  return {
    name: cleanText(profile.name).slice(0, 80),
    age: cleanText(profile.age).slice(0, 20),
    conditions: normalizeProfileList(profile.conditions).slice(0, 12),
    medications: normalizeProfileList(profile.medications).slice(0, 12),
    allergies: normalizeProfileList(profile.allergies).slice(0, 12),
    baselineBp: cleanText(profile.baselineBp).slice(0, 40),
    gender: cleanText(profile.gender).slice(0, 60),
    notes: cleanText(profile.notes).slice(0, 400)
  };
}

function mergeProfiles(baseProfile = {}, overrideProfile = {}) {
  const base = sanitizeProfile(baseProfile);
  const override = sanitizeProfile(overrideProfile);

  return {
    name: override.name || base.name,
    age: override.age || base.age,
    conditions: override.conditions.length ? override.conditions : base.conditions,
    medications: override.medications.length ? override.medications : base.medications,
    allergies: override.allergies.length ? override.allergies : base.allergies,
    baselineBp: override.baselineBp || base.baselineBp,
    gender: override.gender || base.gender,
    notes: mergeProfileNotes(base.notes, override.notes)
  };
}

function mergeProfileNotes(baseNotes = "", overrideNotes = "") {
  const base = cleanText(baseNotes).slice(0, 400);
  const override = cleanText(overrideNotes).slice(0, 400);

  if (!override) {
    return base;
  }

  if (!base) {
    return override;
  }

  const baseNormalized = base.toLowerCase();
  const overrideNormalized = override.toLowerCase();

  if (baseNormalized === overrideNormalized || baseNormalized.includes(overrideNormalized)) {
    return base;
  }

  if (overrideNormalized.includes(baseNormalized)) {
    return override;
  }

  return `${override}; ${base}`.slice(0, 400);
}

function normalizeProfileList(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => cleanText(item).slice(0, 120))
      .filter(Boolean);
  }

  return String(value || "")
    .split(/[,\n;|]+/)
    .map((item) => cleanText(item).slice(0, 120))
    .filter(Boolean);
}

function sanitizeObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entryValue]) => entryValue !== null && entryValue !== undefined && entryValue !== "")
      .map(([key, entryValue]) => [
        cleanText(key).slice(0, 80),
        Array.isArray(entryValue)
          ? normalizeTextArray(entryValue).slice(0, 8)
          : typeof entryValue === "object"
            ? sanitizeObject(entryValue)
            : cleanText(entryValue).slice(0, 240)
      ])
      .filter(([key]) => Boolean(key))
  );
}

function normalizeTextArray(value) {
  return Array.isArray(value)
    ? value.map((item) => cleanText(item).slice(0, 120)).filter(Boolean)
    : [];
}

function normalizeFlexibleTextArray(value, limit = 8, itemLimit = 120) {
  if (Array.isArray(value)) {
    return value.map((item) => cleanText(item).slice(0, itemLimit)).filter(Boolean).slice(0, limit);
  }

  const text = cleanText(value).slice(0, itemLimit);
  return text ? [text] : [];
}

function buildMemorySignals({
  message = "",
  summary = "",
  profile = {},
  vitals = {},
  context = {},
  intents = [],
  routes = [],
  risk = "",
  responseOwner = "",
  responseFocusLabel = "",
  focusFamilies = [],
  contextSignalBundle = {},
  actionItems = [],
  warningSigns = [],
  evidenceRefs = [],
  triageLevel = "",
  triageRoute = "",
  triageSignals = [],
  reviewReasons = [],
  doctorQuestions = [],
  preventionFocusAreas = [],
  evidenceTitles = [],
  documentType = "",
  documentMarkers = [],
  documentValueHints = []
} = {}) {
  const cleanProfile = sanitizeProfile(profile);
  const contextSignals = context && typeof context === "object" ? context : {};
  const normalizedContextBundle = buildContextSignalBundle({
    ...contextSignals,
    ...(contextSignalBundle && typeof contextSignalBundle === "object" ? contextSignalBundle : {})
  });

  return dedupeTextItems([
    ...extractKeyPhrases(message, 6),
    ...extractKeyPhrases(summary, 5),
    ...extractKeyPhrases(responseFocusLabel, 2),
    ...extractKeyPhrases(actionItems.join(" "), 3),
    ...extractKeyPhrases(warningSigns.join(" "), 3),
    triageLevel && triageLevel !== "UNKNOWN" ? `triage ${triageLevel}` : "",
    triageRoute ? `triage route ${triageRoute.replace(/_/g, " ")}` : "",
    ...extractKeyPhrases(triageSignals.join(" "), 3),
    ...reviewReasons.map((item) => item.replace(/-/g, " ")),
    ...extractKeyPhrases(doctorQuestions.join(" "), 3),
    ...preventionFocusAreas,
    ...extractKeyPhrases(evidenceTitles.join(" "), 3),
    documentType ? `document ${documentType.replace(/_/g, " ")}` : "",
    ...documentMarkers,
    ...documentValueHints,
    normalizedContextBundle.specialistFocus ? `specialist ${normalizedContextBundle.specialistFocus.replace(/-/g, " ")}` : "",
    normalizedContextBundle.specialistLens ? `lens ${normalizedContextBundle.specialistLens.replace(/-/g, " ")}` : "",
    ...normalizedContextBundle.riskModifiers.map((item) => `modifier ${item.replace(/-/g, " ")}`),
    ...normalizedContextBundle.wellnessSignals,
    ...normalizedContextBundle.visitSignals,
    ...normalizeFocusFamilies(focusFamilies).map((item) => `topic ${formatFocusFamily(item)}`),
    ...cleanProfile.conditions,
    ...cleanProfile.medications,
    ...cleanProfile.allergies,
    cleanProfile.baselineBp ? `baseline bp ${cleanProfile.baselineBp}` : "",
    ...buildVitalSignals(vitals),
    ...normalizeTextArray(intents),
    ...normalizeTextArray(routes),
    responseOwner ? `owner ${responseOwner.replace(/_/g, " ")}` : "",
    ...evidenceRefs,
    risk && risk !== "UNKNOWN" ? `risk ${risk}` : "",
    contextSignals.duration ? `duration ${contextSignals.duration}` : "",
    contextSignals.careGoal ? `goal ${contextSignals.careGoal}` : "",
    contextSignals.severity ? `severity ${contextSignals.severity}` : "",
    contextSignals.lastMedicationTime ? `last medication ${contextSignals.lastMedicationTime}` : "",
    ...(Array.isArray(contextSignals.redFlags) ? contextSignals.redFlags : [])
  ]).slice(0, maxSignalItems);
}

function buildContinuitySummary({
  profile = {},
  vitals = {},
  risk = "",
  routes = [],
  focusFamilies = [],
  contextSignalBundle = {},
  summary = "",
  responseFocusLabel = "",
  warningSigns = [],
  triageLevel = "",
  triageSignals = [],
  reviewReasons = [],
  preventionFocusAreas = []
} = {}) {
  const cleanProfile = sanitizeProfile(profile);
  const normalizedContextBundle = buildContextSignalBundle(contextSignalBundle);
  const highlights = dedupeTextItems([
    ...cleanProfile.conditions.slice(0, 2),
    ...cleanProfile.medications.slice(0, 2),
    ...buildVitalSignals(vitals).slice(0, 2),
    risk && risk !== "UNKNOWN" ? `risk ${risk}` : "",
    triageLevel && triageLevel !== "UNKNOWN" ? `triage ${triageLevel}` : "",
    ...normalizeTextArray(routes).slice(0, 1),
    ...normalizeFocusFamilies(focusFamilies).slice(0, 2).map(formatFocusFamily),
    normalizedContextBundle.specialistFocus ? normalizedContextBundle.specialistFocus.replace(/-/g, " ") : "",
    ...normalizedContextBundle.riskModifiers.slice(0, 1).map((item) => item.replace(/-/g, " ")),
    ...normalizedContextBundle.wellnessSignals.slice(0, 1),
    ...normalizedContextBundle.visitSignals.slice(0, 1),
    ...extractKeyPhrases(responseFocusLabel, 1),
    ...extractKeyPhrases(triageSignals.join(" "), 1),
    ...reviewReasons.slice(0, 1).map((item) => item.replace(/-/g, " ")),
    ...preventionFocusAreas.slice(0, 1),
    ...extractKeyPhrases(warningSigns.join(" "), 1),
    ...extractKeyPhrases(summary, 2)
  ]);

  return highlights.join("; ").slice(0, 240);
}

function buildRouteSummary({ routes = [], responseOwnerRoute = "", responseFocusLabel = "" } = {}) {
  return dedupeTextItems([
    ...normalizeTextArray(routes),
    responseOwnerRoute ? `owner ${responseOwnerRoute}` : "",
    responseFocusLabel
  ]).join(", ").slice(0, 160);
}

function buildMemorySearchText({
  message = "",
  summary = "",
  continuitySummary = "",
  profile = {},
  vitals = {},
  context = {},
  intents = [],
  routes = [],
  primaryIntent = "",
  primaryRoute = "",
  responseOwnerRoute = "",
  responseFocusLabel = "",
  focusFamilies = [],
  contextSignalBundle = {},
  actionItems = [],
  warningSigns = [],
  evidenceRefs = [],
  triageLevel = "",
  triageRoute = "",
  triageSignals = [],
  reviewReasons = [],
  doctorQuestions = [],
  preventionFocusAreas = [],
  evidenceTitles = [],
  documentType = "",
  documentMarkers = [],
  documentValueHints = []
} = {}) {
  const cleanProfile = sanitizeProfile(profile);
  const contextSignals = context && typeof context === "object" ? context : {};
  const normalizedContextBundle = buildContextSignalBundle({
    ...contextSignals,
    ...(contextSignalBundle && typeof contextSignalBundle === "object" ? contextSignalBundle : {})
  });

  return dedupeTextItems([
    ...extractKeyPhrases(message, 6),
    ...extractKeyPhrases(summary, 5),
    ...extractKeyPhrases(continuitySummary, 4),
    responseFocusLabel,
    primaryIntent ? primaryIntent.replace(/_/g, " ") : "",
    primaryRoute ? primaryRoute.replace(/_/g, " ") : "",
    responseOwnerRoute ? responseOwnerRoute.replace(/_/g, " ") : "",
    triageLevel && triageLevel !== "UNKNOWN" ? `triage ${triageLevel}` : "",
    triageRoute ? `triage route ${triageRoute.replace(/_/g, " ")}` : "",
    ...triageSignals,
    ...reviewReasons.map((item) => item.replace(/-/g, " ")),
    ...doctorQuestions,
    ...preventionFocusAreas,
    ...evidenceTitles,
    documentType ? `document ${documentType.replace(/_/g, " ")}` : "",
    ...documentMarkers,
    ...documentValueHints,
    normalizedContextBundle.specialistFocus ? normalizedContextBundle.specialistFocus.replace(/-/g, " ") : "",
    normalizedContextBundle.specialistLens ? normalizedContextBundle.specialistLens.replace(/-/g, " ") : "",
    ...normalizedContextBundle.riskModifiers.map((item) => item.replace(/-/g, " ")),
    ...normalizedContextBundle.wellnessSignals,
    ...normalizedContextBundle.visitSignals,
    ...normalizeFocusFamilies(focusFamilies).map(formatFocusFamily),
    ...cleanProfile.conditions,
    ...cleanProfile.medications,
    ...cleanProfile.allergies,
    cleanProfile.notes,
    ...buildVitalSignals(vitals),
    ...normalizeTextArray(intents),
    ...normalizeTextArray(routes).map((item) => item.replace(/_/g, " ")),
    ...actionItems,
    ...warningSigns,
    ...evidenceRefs,
    contextSignals.duration ? `duration ${contextSignals.duration}` : "",
    contextSignals.careGoal ? `goal ${contextSignals.careGoal}` : "",
    contextSignals.severity ? `severity ${contextSignals.severity}` : "",
    contextSignals.lastMedicationTime ? `last medication ${contextSignals.lastMedicationTime}` : "",
    ...(Array.isArray(contextSignals.redFlags) ? contextSignals.redFlags : [])
  ]).join(" ").slice(0, 1800);
}

function buildVitalSignals(vitals = {}) {
  const source = vitals && typeof vitals === "object" ? vitals : {};
  const systolic = toNumber(source.systolic);
  const diastolic = toNumber(source.diastolic);
  const bloodSugar = toNumber(source.bloodSugar);
  const heartRate = toNumber(source.heartRate);
  const temperatureC = toNumber(source.temperatureC);
  const oxygenSaturation = toNumber(source.oxygenSaturation);
  const signals = [];

  if (systolic !== null && diastolic !== null) {
    signals.push(`bp ${systolic}/${diastolic}`);
  }
  if (systolic !== null && systolic >= 140 || diastolic !== null && diastolic >= 90) {
    signals.push("high blood pressure");
  }
  if (systolic !== null && systolic <= 90 || diastolic !== null && diastolic <= 60) {
    signals.push("low blood pressure");
  }
  if (bloodSugar !== null) {
    signals.push(`blood sugar ${bloodSugar}`);
    if (bloodSugar >= 180) signals.push("high blood sugar");
    if (bloodSugar <= 70) signals.push("low blood sugar");
  }
  if (heartRate !== null) {
    signals.push(`heart rate ${heartRate}`);
    if (heartRate >= 100) signals.push("fast heart rate");
  }
  if (temperatureC !== null) {
    signals.push(`temperature ${temperatureC}`);
    if (temperatureC >= 38) signals.push("fever");
  }
  if (oxygenSaturation !== null) {
    signals.push(`oxygen ${oxygenSaturation}`);
    if (oxygenSaturation <= 93) signals.push("low oxygen");
  }

  return dedupeTextItems(signals).slice(0, 8);
}

function extractKeyPhrases(value, limit = 6) {
  const text = cleanText(value).toLowerCase();

  if (!text) {
    return [];
  }

  const phraseCandidates = text
    .split(/\b(?:and|but|because|with|while|after|before|then)\b|[.!?;,:]+/i)
    .map((item) => cleanText(item))
    .filter(Boolean)
    .filter((item) => item.length >= 6);

  const keywordCandidates = text
    .split(/\s+/)
    .map((item) => item.replace(/[^a-z0-9/-]+/g, ""))
    .filter((item) => item.length >= 4)
    .filter((item) => !memoryStopWords.has(item));

  return dedupeTextItems([...phraseCandidates, ...keywordCandidates]).slice(0, limit);
}

function dedupeTextItems(items = []) {
  const seen = new Set();
  const deduped = [];

  for (const item of items) {
    const value = cleanText(item).slice(0, 120);

    if (!value) {
      continue;
    }

    const key = value.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(value);
  }

  return deduped;
}

function buildContextSignalBundle(context = {}) {
  const source = context && typeof context === "object" ? context : {};
  const specialistFocus = cleanText(source.specialistFocus).slice(0, 80);
  const specialistLens = cleanText(source.specialistLens).slice(0, 80);
  const riskModifiers = Array.isArray(source.riskModifiers)
    ? source.riskModifiers.map((item) => cleanText(item).slice(0, 120)).filter(Boolean).slice(0, 6)
    : [];
  const wellnessSignals = flattenContextProfileSignals(source.wellnessProfile, 8, 160);
  const visitSignals = flattenContextProfileSignals(source.visitProfile, 8, 180);

  return {
    specialistFocus,
    specialistLens,
    riskModifiers,
    wellnessSignals,
    visitSignals
  };
}

function mergeContextSignalSources(primary = {}, override = {}) {
  const base = primary && typeof primary === "object" && !Array.isArray(primary) ? primary : {};
  const next = override && typeof override === "object" && !Array.isArray(override) ? override : {};
  const merged = { ...base };

  for (const [key, value] of Object.entries(next)) {
    if (key === "wellnessProfile" || key === "visitProfile") {
      merged[key] = mergeContextObjectSource(base[key], value);
      continue;
    }

    if (hasMeaningfulContextValue(value)) {
      merged[key] = value;
    }
  }

  return merged;
}

function mergeContextObjectSource(primary = {}, override = {}) {
  const base = primary && typeof primary === "object" && !Array.isArray(primary) ? primary : {};
  const next = override && typeof override === "object" && !Array.isArray(override) ? override : {};
  const merged = { ...base };

  for (const [key, value] of Object.entries(next)) {
    if (hasMeaningfulContextValue(value)) {
      merged[key] = value;
    }
  }

  return merged;
}

function hasMeaningfulContextValue(value) {
  if (value === null || value === undefined) {
    return false;
  }

  if (Array.isArray(value)) {
    return value.some((item) => hasMeaningfulContextValue(item));
  }

  if (typeof value === "object") {
    return Object.values(value).some((entry) => hasMeaningfulContextValue(entry));
  }

  if (typeof value === "string") {
    return Boolean(cleanText(value));
  }

  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  if (typeof value === "boolean") {
    return true;
  }

  return Boolean(value);
}

function flattenContextProfileSignals(value, limit = 8, itemLimit = 160) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }

  return dedupeTextItems(
    Object.entries(value)
      .map(([key, entryValue]) => {
        const cleanKey = cleanText(key).replace(/[-_]+/g, " ").slice(0, 60);
        const cleanValue = cleanText(entryValue).slice(0, itemLimit);

        if (!cleanKey || !cleanValue) {
          return "";
        }

        return `${cleanKey} ${cleanValue}`;
      })
      .filter(Boolean)
  ).slice(0, limit);
}

function normalizeFocusFamilies(value) {
  return Array.isArray(value)
    ? dedupeTextItems(
      value
        .map((item) => cleanText(item).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, ""))
        .filter(Boolean)
    ).slice(0, 8)
    : [];
}

function formatFocusFamily(value) {
  return cleanText(value).replace(/[-_]+/g, " ").toLowerCase();
}

function countValues(counter, values = []) {
  for (const value of Array.isArray(values) ? values : []) {
    const key = cleanText(value);

    if (!key) {
      continue;
    }

    counter[key] = (counter[key] || 0) + 1;
  }
}

function normalizePatientId(value) {
  const cleaned = cleanText(value || "demo-patient")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return cleaned || "demo-patient";
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function parseDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const memoryStopWords = new Set([
  "about",
  "after",
  "also",
  "because",
  "before",
  "could",
  "does",
  "feel",
  "felt",
  "from",
  "have",
  "just",
  "more",
  "need",
  "should",
  "still",
  "that",
  "them",
  "they",
  "this",
  "today",
  "want",
  "what",
  "when",
  "with"
]);
