import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { withFileWriteLock } from "./fileWriteLock.js";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const browserStateFile = resolve(rootDir, "data", "browser-state", "browser-state.json");
const maxArrayItems = 240;
const maxObjectKeys = 48;
const maxDepth = 6;
const maxStringLength = 4000;
let cachedStore = null;
let cachedStoreMtimeMs = 0;
let storeWriteQueue = Promise.resolve();

export function getBrowserStateStorageInfo() {
  return {
    mode: "persistent-local-server",
    file: "data/browser-state/browser-state.json",
    snapshotFamilies: [
      "profile-catalog",
      "lab-reports",
      "vitals-trend",
      "medicine-vault",
      "medicine-side-effects",
      "insurance-cases",
      "visit-queue",
      "wellness-progress",
      "safety-events",
      "drafts"
    ]
  };
}

export async function loadBrowserStateSnapshot(patientId = "demo-patient") {
  const id = normalizePatientId(patientId);
  const store = await readStore();
  const patient = normalizePatientBrowserState(store.patients[id], id);

  return toPublicBrowserState(patient);
}

export async function saveBrowserStateSnapshot({
  patientId = "demo-patient",
  snapshot = {},
  metadata = {}
} = {}) {
  const id = normalizePatientId(patientId);
  const store = await readStore();
  const existing = normalizePatientBrowserState(store.patients[id], id);
  const now = new Date().toISOString();
  const normalizedSnapshot = sanitizeSnapshot(snapshot);
  const summary = buildSnapshotSummary(normalizedSnapshot);

  store.patients[id] = {
    patientId: id,
    createdAt: existing.createdAt || now,
    updatedAt: now,
    metadata: {
      ...existing.metadata,
      ...sanitizeSnapshot(metadata),
      patientId: id,
      updatedAt: now
    },
    summary,
    snapshot: normalizedSnapshot
  };
  store.updatedAt = now;

  await writeStore(store, { replacePatientIds: [id] });
  return toPublicBrowserState(store.patients[id]);
}

async function readStore() {
  try {
    await storeWriteQueue.catch(() => {});
    const fileStats = await stat(browserStateFile).catch((error) => {
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

    const raw = await readFile(browserStateFile, "utf8");
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

  storeWriteQueue = storeWriteQueue.catch(() => {}).then(async () => withFileWriteLock(browserStateFile, async () => {
    const latestStore = await readStoreFromDisk();
    const nextStore = cloneStore(mergeStoreForWrite(latestStore, queuedStore, queuedOptions));
    const body = `${JSON.stringify(nextStore, null, 2)}\n`;

    await mkdir(dirname(browserStateFile), { recursive: true });
    const temporaryFile = `${browserStateFile}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;

    await writeFile(temporaryFile, body, "utf8");
    await replaceFileWithRetry(temporaryFile, browserStateFile);
    const fileStats = await stat(browserStateFile).catch(() => null);
    cachedStore = nextStore;
    cachedStoreMtimeMs = fileStats?.mtimeMs || Date.now();
  }));

  await storeWriteQueue;
}

async function readStoreFromDisk() {
  const raw = await readFile(browserStateFile, "utf8").catch((error) => {
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
    replacePatientIds: Array.isArray(options.replacePatientIds) ? [...options.replacePatientIds] : []
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
  const merged = {
    version: 1,
    createdAt: baseStore.createdAt || nextStore.createdAt || new Date().toISOString(),
    updatedAt: nextStore.updatedAt || baseStore.updatedAt || new Date().toISOString(),
    patients: {
      ...(baseStore.patients || {})
    }
  };

  for (const patientId of replacePatientIds) {
    const basePatient = normalizePatientBrowserState(merged.patients[patientId], patientId);
    const nextPatient = normalizePatientBrowserState(nextStore.patients?.[patientId], patientId);

    merged.patients[patientId] = {
      ...basePatient,
      ...nextPatient,
      createdAt: earliestIso(basePatient.createdAt, nextPatient.createdAt),
      updatedAt: nextPatient.updatedAt || basePatient.updatedAt,
      metadata: {
        ...(basePatient.metadata || {}),
        ...(nextPatient.metadata || {}),
        patientId
      },
      summary: buildSnapshotSummary(nextPatient.snapshot),
      snapshot: nextPatient.snapshot
    };
  }

  if (!replacePatientIds.size) {
    merged.patients = {
      ...(baseStore.patients || {}),
      ...(nextStore.patients || {})
    };
  }

  return merged;
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

function normalizePatientBrowserState(record, patientId) {
  const now = new Date().toISOString();
  const snapshot = sanitizeSnapshot(record?.snapshot || {});

  return {
    patientId,
    createdAt: record?.createdAt || now,
    updatedAt: record?.updatedAt || record?.createdAt || now,
    metadata: record?.metadata && typeof record.metadata === "object" ? sanitizeSnapshot(record.metadata) : {},
    summary: buildSnapshotSummary(snapshot),
    snapshot
  };
}

function toPublicBrowserState(patient) {
  return {
    ...getBrowserStateStorageInfo(),
    patientId: patient.patientId,
    createdAt: patient.createdAt,
    updatedAt: patient.updatedAt,
    metadata: patient.metadata,
    summary: patient.summary,
    snapshot: patient.snapshot
  };
}

function buildSnapshotSummary(snapshot = {}) {
  const summary = snapshot?.summary && typeof snapshot.summary === "object" ? snapshot.summary : {};

  return {
    signature: cleanText(summary.signature || "").slice(0, 160),
    recordCount: Number(summary.recordCount || 0),
    historyCount: Number(summary.historyCount || 0),
    labReportCount: Array.isArray(snapshot.labReports) ? snapshot.labReports.length : Number(summary.labReportCount || 0),
    vitalsTrendCount: Array.isArray(snapshot.vitalsTrend) ? snapshot.vitalsTrend.length : Number(summary.vitalsTrendCount || 0),
    medicineEntryCount: Array.isArray(snapshot.medicineEntries) ? snapshot.medicineEntries.length : Number(summary.medicineEntryCount || 0),
    medicineSideEffectCount: Array.isArray(snapshot.medicineSideEffects) ? snapshot.medicineSideEffects.length : Number(summary.medicineSideEffectCount || 0),
    insuranceCaseCount: Array.isArray(snapshot.insuranceCases) ? snapshot.insuranceCases.length : Number(summary.insuranceCaseCount || 0),
    visitQueueCount: Array.isArray(snapshot.visitQueue) ? snapshot.visitQueue.length : Number(summary.visitQueueCount || 0),
    wellnessEntryCount: Array.isArray(snapshot.wellnessProgress) ? snapshot.wellnessProgress.length : Number(summary.wellnessEntryCount || 0),
    safetyEventCount: Array.isArray(snapshot.safetyEvents) ? snapshot.safetyEvents.length : Number(summary.safetyEventCount || 0),
    patientProfileCount: Array.isArray(snapshot.patientProfiles) ? snapshot.patientProfiles.length : Number(summary.patientProfileCount || 0),
    draftLabels: Array.isArray(summary.draftLabels)
      ? summary.draftLabels.map((item) => cleanText(item).slice(0, 80)).filter(Boolean).slice(0, 16)
      : [],
    selectedRecordId: cleanText(snapshot.selectedRecordId || "").slice(0, 120),
    activePatientId: cleanText(snapshot.activePatientId || "").slice(0, 120),
    latestActivityAt: cleanText(summary.latestActivity?.at || summary.latestActivityAt || "").slice(0, 80)
  };
}

function sanitizeSnapshot(value, depth = 0) {
  if (value === null) {
    return null;
  }

  if (depth > maxDepth) {
    return null;
  }

  if (typeof value === "string") {
    return cleanText(value).slice(0, maxStringLength);
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, maxArrayItems)
      .map((item) => sanitizeSnapshot(item, depth + 1))
      .filter((item) => item !== undefined);
  }

  if (typeof value === "object") {
    const entries = Object.entries(value).slice(0, maxObjectKeys);
    const output = {};

    for (const [key, item] of entries) {
      const cleanedKey = cleanText(key).slice(0, 80);

      if (!cleanedKey) {
        continue;
      }

      const normalizedItem = sanitizeSnapshot(item, depth + 1);

      if (normalizedItem !== undefined) {
        output[cleanedKey] = normalizedItem;
      }
    }

    return output;
  }

  if (value === undefined) {
    return undefined;
  }

  return cleanText(String(value)).slice(0, maxStringLength);
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
