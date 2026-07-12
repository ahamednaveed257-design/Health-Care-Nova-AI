import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { withFileWriteLock } from "./fileWriteLock.js";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const recordsFile = resolve(rootDir, "data", "records", "patient-records.json");
const maxRecordsPerPatient = 300;
let cachedStore = null;
let cachedStoreMtimeMs = 0;
let storeWriteQueue = Promise.resolve();

export function getRecordStorageInfo() {
  return {
    mode: "persistent-local-server",
    file: "data/records/patient-records.json",
    maxRecordsPerPatient
  };
}

export async function loadPatientDataRecords(patientId = "demo-patient") {
  const id = normalizePatientId(patientId);
  const store = await readStore();
  const patient = normalizePatientRecordStore(store.patients[id], id);

  return toPublicRecordStore(patient);
}

export async function savePatientDataRecords({
  patientId = "demo-patient",
  records = [],
  selectedRecordId = ""
} = {}) {
  const id = normalizePatientId(patientId);
  const store = await readStore();
  const existing = normalizePatientRecordStore(store.patients[id], id);
  const now = new Date().toISOString();
  const normalizedRecords = dedupeRecords(records.map(normalizeStoredPatientDataRecord)).slice(0, maxRecordsPerPatient);
  const selectedId = cleanText(selectedRecordId) || existing.selectedRecordId || normalizedRecords[0]?.id || "";

  store.patients[id] = {
    patientId: id,
    createdAt: existing.createdAt || now,
    updatedAt: now,
    selectedRecordId: normalizedRecords.some((record) => record.id === selectedId) ? selectedId : normalizedRecords[0]?.id || "",
    records: normalizedRecords,
    stats: buildRecordStats(normalizedRecords)
  };
  store.updatedAt = now;

  await writeStore(store, { replacePatientIds: [id] });
  return toPublicRecordStore(store.patients[id]);
}

export async function clearPatientDataRecords(patientId = "demo-patient") {
  const id = normalizePatientId(patientId);
  const store = await readStore();

  delete store.patients[id];
  store.updatedAt = new Date().toISOString();
  await writeStore(store, { deletePatientIds: [id] });

  return toPublicRecordStore(normalizePatientRecordStore(null, id));
}

async function readStore() {
  try {
    await storeWriteQueue.catch(() => {});
    const fileStats = await stat(recordsFile).catch((error) => {
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

    const raw = await readFile(recordsFile, "utf8");
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

  storeWriteQueue = storeWriteQueue.catch(() => {}).then(async () => withFileWriteLock(recordsFile, async () => {
    const latestStore = await readStoreFromDisk();
    const nextStore = cloneStore(mergeStoreForWrite(latestStore, queuedStore, queuedOptions));
    const body = `${JSON.stringify(nextStore, null, 2)}\n`;

    await mkdir(dirname(recordsFile), { recursive: true });
    const temporaryFile = `${recordsFile}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;

    await writeFile(temporaryFile, body, "utf8");
    await replaceFileWithRetry(temporaryFile, recordsFile);
    const fileStats = await stat(recordsFile).catch(() => null);
    cachedStore = nextStore;
    cachedStoreMtimeMs = fileStats?.mtimeMs || Date.now();
  }));

  await storeWriteQueue;
}

async function readStoreFromDisk() {
  const raw = await readFile(recordsFile, "utf8").catch((error) => {
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
    const basePatient = normalizePatientRecordStore(merged.patients[patientId], patientId);
    const nextPatient = normalizePatientRecordStore(nextStore.patients?.[patientId], patientId);
    const records = nextPatient.records.slice(0, maxRecordsPerPatient);

    merged.patients[patientId] = {
      ...basePatient,
      ...nextPatient,
      createdAt: earliestIso(basePatient.createdAt, nextPatient.createdAt),
      updatedAt: nextPatient.updatedAt || basePatient.updatedAt,
      selectedRecordId: records.some((record) => record.id === nextPatient.selectedRecordId)
        ? nextPatient.selectedRecordId
        : records[0]?.id || "",
      records,
      stats: buildRecordStats(records)
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

function normalizePatientRecordStore(record, patientId) {
  const now = new Date().toISOString();
  const records = Array.isArray(record?.records)
    ? dedupeRecords(record.records.map(normalizeStoredPatientDataRecord)).slice(0, maxRecordsPerPatient)
    : [];
  const selectedRecordId = cleanText(record?.selectedRecordId);

  return {
    patientId,
    createdAt: record?.createdAt || now,
    updatedAt: record?.updatedAt || record?.createdAt || now,
    selectedRecordId: records.some((item) => item.id === selectedRecordId) ? selectedRecordId : records[0]?.id || "",
    records,
    stats: record?.stats || buildRecordStats(records)
  };
}

function toPublicRecordStore(patient) {
  return {
    ...getRecordStorageInfo(),
    patientId: patient.patientId,
    createdAt: patient.createdAt,
    updatedAt: patient.updatedAt,
    selectedRecordId: patient.selectedRecordId,
    recordCount: patient.records.length,
    records: patient.records,
    stats: buildRecordStats(patient.records)
  };
}

export function normalizeStoredPatientDataRecord(record = {}) {
  const now = new Date().toISOString();
  const id = cleanRecordId(record.id) || `record-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
  const baseRecord = {
    id,
    createdAt: parseDate(record.createdAt) || now,
    updatedAt: parseDate(record.updatedAt) || now,
    patientName: cleanText(record.patientName).slice(0, 100) || "Patient",
    age: cleanText(record.age).slice(0, 20),
    type: cleanText(record.type || "profile").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").slice(0, 40) || "profile",
    date: cleanDateInput(record.date) || new Date().toISOString().slice(0, 10),
    episode: cleanText(record.episode).slice(0, 120),
    tags: cleanList(record.tags, 12, 40),
    source: cleanText(record.source).slice(0, 120),
    documentCategory: cleanText(record.documentCategory).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").slice(0, 60),
    documentName: cleanText(record.documentName).slice(0, 160),
    fileReferences: cleanMultiline(record.fileReferences || record.fileReference).slice(0, 1600),
    conditions: cleanMultiline(record.conditions).slice(0, 1200),
    allergies: cleanMultiline(record.allergies).slice(0, 800),
    medicines: cleanMultiline(record.medicines).slice(0, 1600),
    vitals: cleanMultiline(record.vitals).slice(0, 1200),
    labs: cleanMultiline(record.labs).slice(0, 1800),
    notes: cleanMultiline(record.notes).slice(0, 2400),
    followUp: cleanMultiline(record.followUp).slice(0, 1200),
    versionNote: cleanMultiline(record.versionNote).slice(0, 400),
    correctionHistory: normalizeCorrectionHistory(record.correctionHistory)
  };

  const conditionItems = baseRecord.conditions
    ? normalizeSignalItems(undefined, baseRecord.conditions, 8, 100)
    : normalizeSignalItems(record.conditionItems, "", 8, 100);
  const allergyItems = baseRecord.allergies
    ? normalizeSignalItems(undefined, baseRecord.allergies, 8, 100)
    : normalizeSignalItems(record.allergyItems, "", 8, 100);
  const medicineItems = baseRecord.medicines
    ? normalizeSignalItems(undefined, baseRecord.medicines, 12, 140)
    : normalizeSignalItems(record.medicineItems, "", 12, 140);
  const medicineNames = normalizeMedicineNames(baseRecord.medicines ? [] : record.medicineNames, medicineItems);
  const structuredVitals = normalizeStructuredVitals(
    record.structuredVitals && typeof record.structuredVitals === "object"
      ? record.structuredVitals
      : parseStructuredVitalsFromText(baseRecord.vitals)
  );
  const vitalItems = baseRecord.vitals
    ? buildVitalItems(undefined, baseRecord.vitals, structuredVitals)
    : buildVitalItems(record.vitalItems, "", structuredVitals);
  const labItems = baseRecord.labs
    ? buildLabItems(undefined, baseRecord.labs)
    : buildLabItems(record.labItems, "");
  const followUpItems = baseRecord.followUp
    ? normalizeSignalItems(undefined, baseRecord.followUp, 6, 140)
    : normalizeSignalItems(record.followUpItems, "", 6, 140);
  const noteHighlights = baseRecord.notes
    ? buildNoteHighlights(undefined, baseRecord.notes)
    : buildNoteHighlights(record.noteHighlights, "");
  const prioritySignals = buildRecordPrioritySignals({
    record: baseRecord,
    medicineNames,
    vitalItems,
    labItems,
    noteHighlights,
    followUpItems,
    structuredVitals
  });
  const summary = buildRecordSummary({
    record: baseRecord,
    conditionItems,
    medicineNames,
    vitalItems,
    labItems,
    followUpItems,
    prioritySignals
  });
  const searchText = buildRecordSearchText({
    record: baseRecord,
    conditionItems,
    allergyItems,
    medicineItems,
    medicineNames,
    vitalItems,
    labItems,
    followUpItems,
    noteHighlights,
    prioritySignals,
    summary
  });

  return {
    ...baseRecord,
    conditionItems,
    allergyItems,
    medicineItems,
    medicineNames,
    vitalItems,
    labItems,
    followUpItems,
    noteHighlights,
    prioritySignals,
    structuredVitals,
    summary,
    searchText
  };
}

function dedupeRecords(records) {
  const byId = new Map();

  for (const record of records) {
    if (!record.id) {
      continue;
    }

    const existing = byId.get(record.id);
    if (!existing || new Date(record.updatedAt).getTime() >= new Date(existing.updatedAt).getTime()) {
      byId.set(record.id, record);
    }
  }

  return Array.from(byId.values()).sort((a, b) => {
    const updatedDelta = new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    if (updatedDelta) {
      return updatedDelta;
    }

    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

function buildRecordStats(records) {
  const typeCounts = {};
  const patientNames = new Set();

  for (const record of records) {
    typeCounts[record.type] = (typeCounts[record.type] || 0) + 1;
    if (record.patientName) {
      patientNames.add(record.patientName.toLowerCase());
    }
  }

  return {
    totalRecords: records.length,
    patientCount: patientNames.size,
    typeCounts,
    latestUpdatedAt: records[0]?.updatedAt || null
  };
}

function normalizePatientId(value) {
  const cleaned = cleanText(value || "demo-patient")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return cleaned || "demo-patient";
}

function cleanRecordId(value) {
  return cleanText(value)
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function cleanDateInput(value) {
  const text = cleanText(value).slice(0, 40);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

export function splitStoredRecordSignalText(value, limit = 6) {
  return normalizeSignalItems(value, "", limit, 120);
}

export function extractStoredRecordMedicineSignals(value) {
  const medicineItems = Array.isArray(value) ? value : splitStoredRecordSignalText(value, 8);

  return dedupeTextItems(
    medicineItems
      .map((item) => cleanText(item).replace(/\s+/g, " "))
      .filter((item) => item.length <= 64)
      .filter((item) => !isInstructionLikeText(item))
      .filter((item) => !/^(\d+(\.\d+)?\s*(mg|mcg|ml|units?|iu|grams?))$/i.test(item))
  ).slice(0, 8);
}

function cleanList(value, limit = 12, itemLimit = 80) {
  const source = Array.isArray(value) ? value : String(value ?? "").split(/[,;\n]+/);
  const seen = new Set();
  const items = [];

  for (const item of source) {
    const cleaned = cleanText(item).replace(/^#/, "").slice(0, itemLimit);
    const key = cleaned.toLowerCase();

    if (!cleaned || seen.has(key)) {
      continue;
    }

    seen.add(key);
    items.push(cleaned);

    if (items.length >= limit) {
      break;
    }
  }

  return items;
}

function normalizeCorrectionHistory(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => ({
      at: parseDate(entry?.at) || new Date().toISOString(),
      note: cleanText(entry?.note).slice(0, 220),
      changes: cleanList(entry?.changes, 8, 60)
    }))
    .filter((entry) => entry.note || entry.changes.length)
    .slice(0, 10);
}

function parseDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function cleanMultiline(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function normalizeSignalItems(value, fallbackText = "", limit = 8, itemLimit = 120) {
  const source = Array.isArray(value)
    ? value
    : String(value ?? fallbackText ?? "").split(/\s*(?:\n|;|,|\|)\s*/);

  return dedupeTextItems(
    source
      .map((item) => cleanText(item).replace(/^#/, "").slice(0, itemLimit))
      .filter(Boolean)
  ).slice(0, limit);
}

function normalizeMedicineNames(value, medicineItems = []) {
  const seedItems = Array.isArray(value) && value.length
    ? value
    : extractStoredRecordMedicineSignals(medicineItems);

  return dedupeTextItems(
    seedItems
      .map((item) => stripMedicineInstructionText(item))
      .filter(Boolean)
      .filter((item) => !isInstructionLikeText(item))
      .map((item) => item.replace(/\s+\b(?:for|when|if|with)\b.*$/i, "").trim())
      .map((item) => item.split(/\s{2,}/)[0])
      .map((item) => item.slice(0, 80))
  ).slice(0, 8);
}

function stripMedicineInstructionText(value) {
  const cleaned = cleanText(value)
    .replace(/\b\d+(\.\d+)?\s*(mg|mcg|ml|units?|iu|grams?)\b/gi, "")
    .replace(/\b(?:take|apply|inject|inhale|swallow|drink|use|insert|give)\b.*$/i, "")
    .replace(/\b(?:once|twice|three times|four times|daily|nightly|weekly|monthly)\b.*$/i, "")
    .replace(/\b(?:tablet|capsule|syrup|solution|ointment|cream|drops?|spray|patch|injection|dose)\b.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned;
}

function normalizeStructuredVitals(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};

  return {
    systolic: toNumber(source.systolic),
    diastolic: toNumber(source.diastolic),
    bloodSugar: toNumber(source.bloodSugar),
    heartRate: toNumber(source.heartRate),
    temperatureC: toNumber(source.temperatureC),
    oxygenSaturation: toNumber(source.oxygenSaturation)
  };
}

function parseStructuredVitalsFromText(text = "") {
  const normalized = cleanText(text);
  const bpMatch = normalized.match(/\b(?:bp|blood pressure)?\s*(\d{2,3})\s*\/\s*(\d{2,3})\b/i);
  const sugarMatch = normalized.match(/\b(?:blood sugar|glucose|sugar)\s*[:=]?\s*(\d{2,3}(?:\.\d+)?)\b/i);
  const heartRateMatch = normalized.match(/\b(?:pulse|heart rate|hr)\s*[:=]?\s*(\d{2,3}(?:\.\d+)?)\b/i);
  const temperatureMatch = normalized.match(/\b(?:temp|temperature)\s*[:=]?\s*(\d{2,3}(?:\.\d+)?)\b/i);
  const oxygenMatch = normalized.match(/\b(?:oxygen(?: saturation)?|spo2|o2)\s*[:=]?\s*(\d{2,3}(?:\.\d+)?)\b/i);

  return normalizeStructuredVitals({
    systolic: bpMatch?.[1],
    diastolic: bpMatch?.[2],
    bloodSugar: sugarMatch?.[1],
    heartRate: heartRateMatch?.[1],
    temperatureC: temperatureMatch?.[1],
    oxygenSaturation: oxygenMatch?.[1]
  });
}

function buildVitalItems(value, fallbackText = "", structuredVitals = {}) {
  const items = normalizeSignalItems(value, fallbackText, 10, 100);

  if (structuredVitals.systolic !== null && structuredVitals.diastolic !== null) {
    items.push(`bp ${structuredVitals.systolic}/${structuredVitals.diastolic}`);
    if (structuredVitals.systolic >= 140 || structuredVitals.diastolic >= 90) {
      items.push("high blood pressure");
    }
    if (structuredVitals.systolic <= 90 || structuredVitals.diastolic <= 60) {
      items.push("low blood pressure");
    }
  }
  if (structuredVitals.bloodSugar !== null) {
    items.push(`blood sugar ${structuredVitals.bloodSugar}`);
    if (structuredVitals.bloodSugar >= 180) items.push("high blood sugar");
    if (structuredVitals.bloodSugar <= 70) items.push("low blood sugar");
  }
  if (structuredVitals.heartRate !== null) {
    items.push(`heart rate ${structuredVitals.heartRate}`);
    if (structuredVitals.heartRate >= 100) items.push("fast heart rate");
  }
  if (structuredVitals.temperatureC !== null) {
    items.push(`temperature ${structuredVitals.temperatureC}`);
    if (structuredVitals.temperatureC >= 38) items.push("fever");
  }
  if (structuredVitals.oxygenSaturation !== null) {
    items.push(`oxygen ${structuredVitals.oxygenSaturation}`);
    if (structuredVitals.oxygenSaturation <= 93) items.push("low oxygen");
  }

  return dedupeTextItems(items).slice(0, 10);
}

function buildLabItems(value, fallbackText = "") {
  const items = normalizeSignalItems(value, fallbackText, 12, 160);
  const abnormalSignals = [];

  for (const item of items) {
    const label = cleanText(item.split(":")[0]).slice(0, 80);

    if (!label) {
      continue;
    }

    if (/\b(low|below|reduced)\b/i.test(item)) {
      abnormalSignals.push(`low ${label}`);
    }
    if (/\b(high|above|elevated)\b/i.test(item)) {
      abnormalSignals.push(`high ${label}`);
    }
    if (/\bcritical\b/i.test(item)) {
      abnormalSignals.push(`critical ${label}`);
    }
  }

  return dedupeTextItems([...items, ...abnormalSignals]).slice(0, 12);
}

function buildNoteHighlights(value, fallbackText = "") {
  const lines = Array.isArray(value)
    ? value
    : cleanMultiline(value || fallbackText)
      .split("\n")
      .map((line) => line.replace(/^[-*]\s*/, ""))
      .map((line) => cleanText(line))
      .filter(Boolean);

  return dedupeTextItems(
    lines
      .filter((line) => line.length >= 8)
      .filter((line) => !/^care nova ai\b/i.test(line))
      .map((line) => line.slice(0, 160))
  ).slice(0, 10);
}

function buildRecordPrioritySignals({ record, medicineNames = [], vitalItems = [], labItems = [], noteHighlights = [], followUpItems = [], structuredVitals = {} } = {}) {
  const signals = [];
  const tagText = buildSearchText([record.type, record.documentCategory, record.documentName, ...(Array.isArray(record.tags) ? record.tags : [])].join(" "));
  const labText = buildSearchText(labItems.join(" "));
  const noteText = buildSearchText([...noteHighlights, ...followUpItems].join(" "));

  if (/medicine|prescription|pharmacy/.test(tagText)) signals.push("medicine safety review");
  if (/lab|report|pathology/.test(tagText)) signals.push("lab result follow-up");
  if (/vitals|blood-pressure|glucose/.test(tagText)) signals.push("vitals trend review");
  if (/follow-up|review/.test(tagText)) signals.push("follow-up review");
  if (/discharge|transition/.test(tagText)) signals.push("care transition");

  if (structuredVitals.systolic !== null && structuredVitals.diastolic !== null) {
    if (structuredVitals.systolic >= 140 || structuredVitals.diastolic >= 90) signals.push("high blood pressure");
    if (structuredVitals.systolic <= 90 || structuredVitals.diastolic <= 60) signals.push("low blood pressure");
  }
  if (structuredVitals.bloodSugar !== null) {
    if (structuredVitals.bloodSugar >= 180) signals.push("high blood sugar");
    if (structuredVitals.bloodSugar <= 70) signals.push("low blood sugar");
  }
  if (structuredVitals.temperatureC !== null && structuredVitals.temperatureC >= 38) signals.push("fever");
  if (structuredVitals.oxygenSaturation !== null && structuredVitals.oxygenSaturation <= 93) signals.push("low oxygen");

  if (/\begfr\b|\bcreatinine\b|\bpotassium\b|\bkidney\b/.test(labText)) signals.push("kidney review");
  if (/\bhba1c\b|\bglucose\b|\bdiabetes\b/.test(labText)) signals.push("glucose follow-up");
  if (/\bcholesterol\b|\bldl\b|\bhdl\b|\btriglyceride\b/.test(labText)) signals.push("lipid review");
  if (/\burgent\b|\bsame day\b|\bcritical\b|\bemergency\b/.test(noteText)) signals.push("urgent follow-up");
  if (/\bside effect\b|\bdizziness\b|\bswelling\b|\bfainting\b/.test(noteText)) signals.push("medicine side-effect watch");
  if (Array.isArray(medicineNames) && medicineNames.length) signals.push("saved medicine list");
  if (Array.isArray(vitalItems) && vitalItems.length) signals.push("saved readings available");

  return dedupeTextItems(signals).slice(0, 12);
}

function buildRecordSummary({ record, conditionItems = [], medicineNames = [], vitalItems = [], labItems = [], followUpItems = [], prioritySignals = [] } = {}) {
  return [
    record.documentName || record.episode || record.type,
    conditionItems.length ? `conditions ${conditionItems.slice(0, 2).join(", ")}` : "",
    medicineNames.length ? `medicines ${medicineNames.slice(0, 2).join(", ")}` : "",
    vitalItems.length ? `vitals ${vitalItems.slice(0, 2).join(", ")}` : "",
    labItems.length ? `labs ${labItems.slice(0, 2).join(", ")}` : "",
    prioritySignals.length ? `signals ${prioritySignals.slice(0, 2).join(", ")}` : "",
    followUpItems.length ? `follow-up ${followUpItems[0]}` : ""
  ]
    .filter(Boolean)
    .join("; ")
    .slice(0, 320);
}

function buildRecordSearchText({ record, conditionItems = [], allergyItems = [], medicineItems = [], medicineNames = [], vitalItems = [], labItems = [], followUpItems = [], noteHighlights = [], prioritySignals = [], summary = "" } = {}) {
  return buildSearchText([
    record.type,
    record.date,
    record.episode,
    record.source,
    record.documentCategory,
    record.documentName,
    Array.isArray(record.tags) ? record.tags.join(" ") : "",
    record.conditions,
    record.allergies,
    record.medicines,
    record.vitals,
    record.labs,
    record.notes,
    record.followUp,
    conditionItems.join(" "),
    allergyItems.join(" "),
    medicineItems.join(" "),
    medicineNames.join(" "),
    vitalItems.join(" "),
    labItems.join(" "),
    followUpItems.join(" "),
    noteHighlights.join(" "),
    prioritySignals.join(" "),
    summary
  ].join(" ")).slice(0, 2400);
}

function dedupeTextItems(items = []) {
  const seen = new Set();
  const values = [];

  for (const item of items) {
    const cleaned = cleanText(item).slice(0, 160);

    if (!cleaned) {
      continue;
    }

    const key = cleaned.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    values.push(cleaned);
  }

  return values;
}

function isInstructionLikeText(value = "") {
  return /^(?:take|apply|inject|inhale|swallow|drink|use|insert|give|stored|status|source|written label|frequency|last taken|with meals|by mouth|tablet|capsule|once daily|twice daily|three times daily)/i.test(cleanText(value));
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildSearchText(value = "") {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9/%.\s-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
