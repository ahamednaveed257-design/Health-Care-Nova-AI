import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { withFileWriteLock } from "./fileWriteLock.js";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const auditFile = resolve(rootDir, "data", "audit", "operational-audit-log.json");
const defaultMaxEvents = 5000;
const defaultReadLimit = 50;
const knownCategories = new Set([
  "admin",
  "analysis",
  "deployment",
  "governance",
  "runtime",
  "security",
  "storage",
  "training"
]);
const knownStatuses = new Set(["success", "info", "warning", "error", "blocked"]);
let cachedStore = null;
let cachedStoreMtimeMs = 0;
let storeWriteQueue = Promise.resolve();

export function getEnterpriseAuditStorageInfo(env = process.env) {
  return {
    mode: "persistent-local-server-audit-log",
    file: "data/audit/operational-audit-log.json",
    enabled: env.CARE_NOVA_AUDIT_LOG_ENABLED !== "false",
    maxEvents: parseAuditMaxEvents(env.CARE_NOVA_AUDIT_MAX_EVENTS),
    categories: [...knownCategories]
  };
}

export async function loadEnterpriseAuditLog(env = process.env, options = {}) {
  const storage = getEnterpriseAuditStorageInfo(env);
  const store = await readStore(storage);
  const category = normalizeCategory(options.category);
  const status = normalizeStatus(options.status || options.severity);
  const route = cleanText(options.route, 120);
  const patientId = normalizePatientId(options.patientId);
  const limit = clampInteger(options.limit, defaultReadLimit, 1, 250);

  let events = [...store.events];

  if (category) {
    events = events.filter((event) => event.category === category);
  }

  if (status) {
    events = events.filter((event) => event.status === status);
  }

  if (route) {
    events = events.filter((event) => event.route === route);
  }

  if (patientId) {
    events = events.filter((event) => event.patientId === patientId);
  }

  events = events.slice(0, limit);

  return {
    ok: true,
    status: storage.enabled ? "audit-log-ready" : "audit-log-disabled",
    storage,
    summary: buildAuditSummary(store.events, storage),
    events,
    timestamp: new Date().toISOString()
  };
}

export async function appendEnterpriseAuditEvent(event = {}, env = process.env) {
  const storage = getEnterpriseAuditStorageInfo(env);

  if (!storage.enabled) {
    return {
      ok: true,
      status: "audit-log-disabled",
      storage,
      event: null,
      timestamp: new Date().toISOString()
    };
  }

  const store = await readStore(storage);
  const entry = normalizeAuditEvent(event);

  store.events = [entry, ...store.events].slice(0, storage.maxEvents);
  store.updatedAt = entry.at;
  store.createdAt = store.createdAt || entry.at;

  await writeStore(store, storage);

  return {
    ok: true,
    status: "audit-event-recorded",
    storage,
    event: entry,
    timestamp: new Date().toISOString()
  };
}

async function readStore(storage) {
  try {
    await storeWriteQueue.catch(() => {});
    const fileStats = await stat(auditFile).catch((error) => {
      if (error.code === "ENOENT") {
        return null;
      }

      throw error;
    });

    if (cachedStore && fileStats && cachedStoreMtimeMs === fileStats.mtimeMs) {
      return cloneStore(cachedStore, storage);
    }

    if (cachedStore && !fileStats && cachedStoreMtimeMs === 0) {
      return cloneStore(cachedStore, storage);
    }

    if (!fileStats) {
      cachedStore = createEmptyStore(storage);
      cachedStoreMtimeMs = 0;
      return cloneStore(cachedStore, storage);
    }

    const raw = await readFile(auditFile, "utf8");
    let parsed;

    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      if (error instanceof SyntaxError) {
        const cachedSnapshot = useCachedStoreFallback(storage, fileStats.mtimeMs);

        if (cachedSnapshot) {
          return cachedSnapshot;
        }
      }

      throw error;
    }

    cachedStore = normalizeAuditStore(parsed, storage);
    cachedStoreMtimeMs = fileStats.mtimeMs;
    return cloneStore(cachedStore, storage);
  } catch (error) {
    if (error.code === "ENOENT") {
      cachedStore = createEmptyStore(storage);
      cachedStoreMtimeMs = 0;
      return cloneStore(cachedStore, storage);
    }

    if (error instanceof SyntaxError) {
      const cachedSnapshot = useCachedStoreFallback(storage);

      if (cachedSnapshot) {
        return cachedSnapshot;
      }

      cachedStore = createEmptyStore(storage);
      cachedStoreMtimeMs = 0;
      return cloneStore(cachedStore, storage);
    }

    throw error;
  }
}

async function writeStore(store, storage) {
  const queuedStore = cloneStore(store, storage);
  const queuedStorage = { ...storage };

  storeWriteQueue = storeWriteQueue.catch(() => {}).then(async () => withFileWriteLock(auditFile, async () => {
    const latestStore = await readStoreFromDisk(queuedStorage);
    const mergedEvents = mergeAuditEvents(latestStore.events, queuedStore.events, queuedStorage.maxEvents);
    const nextStore = {
      ...latestStore,
      ...queuedStore,
      version: 1,
      maxEvents: queuedStorage.maxEvents,
      updatedAt: mergedEvents[0]?.at || queuedStore.updatedAt || latestStore.updatedAt || new Date().toISOString(),
      events: mergedEvents
    };
    const body = `${JSON.stringify(nextStore, null, 2)}\n`;

    await mkdir(dirname(auditFile), { recursive: true });
    const temporaryFile = `${auditFile}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;

    await writeFile(temporaryFile, body, "utf8");
    await replaceFileWithRetry(temporaryFile, auditFile);
    const fileStats = await stat(auditFile).catch(() => null);
    cachedStore = nextStore;
    cachedStoreMtimeMs = fileStats?.mtimeMs || Date.now();
  }));

  await storeWriteQueue;
}

async function readStoreFromDisk(storage) {
  const raw = await readFile(auditFile, "utf8").catch((error) => {
    if (error.code === "ENOENT") {
      return "";
    }

    throw error;
  });

  if (!raw.trim()) {
    const cachedSnapshot = useCachedStoreFallback(storage);

    if (cachedSnapshot) {
      return cachedSnapshot;
    }

    return createEmptyStore(storage);
  }

  try {
    return cloneStore(normalizeAuditStore(JSON.parse(raw), storage), storage);
  } catch {
    const cachedSnapshot = useCachedStoreFallback(storage);

    if (cachedSnapshot) {
      return cachedSnapshot;
    }

    return createEmptyStore(storage);
  }
}

function cloneStore(store, storage) {
  return normalizeAuditStore(
    store && typeof store === "object" && !Array.isArray(store)
      ? deepClone(store)
      : createEmptyStore(storage),
    storage
  );
}

function useCachedStoreFallback(storage, mtimeMs = cachedStoreMtimeMs) {
  if (!cachedStore) {
    return null;
  }

  if (Number.isFinite(mtimeMs)) {
    cachedStoreMtimeMs = mtimeMs;
  }

  return cloneStore(cachedStore, storage);
}

function normalizeAuditStore(value, storage) {
  const createdAt = cleanIso(value?.createdAt) || new Date().toISOString();
  const updatedAt = cleanIso(value?.updatedAt) || createdAt;
  const events = Array.isArray(value?.events)
    ? value.events.map(normalizeAuditEvent).slice(0, storage.maxEvents)
    : [];

  return {
    version: 1,
    createdAt,
    updatedAt,
    maxEvents: storage.maxEvents,
    events
  };
}

function createEmptyStore(storage) {
  const now = new Date().toISOString();

  return {
    version: 1,
    createdAt: now,
    updatedAt: now,
    maxEvents: storage.maxEvents,
    events: []
  };
}

function normalizeAuditEvent(event = {}) {
  const at = cleanIso(event.at) || new Date().toISOString();
  const metadata = normalizeMetadata(event.metadata);

  return {
    id: cleanText(event.id, 80) || randomUUID(),
    at,
    category: normalizeCategory(event.category) || "runtime",
    action: cleanText(event.action, 80) || "event",
    status: normalizeStatus(event.status) || "info",
    route: cleanText(event.route, 120),
    requestId: cleanText(event.requestId, 120),
    patientId: normalizePatientId(event.patientId),
    actor: cleanText(event.actor, 80) || "care-nova-server",
    summary: cleanText(event.summary, 220),
    detail: cleanText(event.detail, 420),
    metadata
  };
}

function buildAuditSummary(events = [], storage = getEnterpriseAuditStorageInfo()) {
  const countsByCategory = {};
  const countsByStatus = {};

  for (const category of knownCategories) {
    countsByCategory[category] = 0;
  }

  for (const status of knownStatuses) {
    countsByStatus[status] = 0;
  }

  for (const event of events) {
    countsByCategory[event.category] = (countsByCategory[event.category] || 0) + 1;
    countsByStatus[event.status] = (countsByStatus[event.status] || 0) + 1;
  }

  return {
    enabled: storage.enabled,
    file: storage.file,
    maxEvents: storage.maxEvents,
    eventCount: events.length,
    latestEventAt: events[0]?.at || "",
    latestCategory: events[0]?.category || "",
    latestStatus: events[0]?.status || "",
    countsByCategory,
    countsByStatus
  };
}

function mergeAuditEvents(baseEvents = [], nextEvents = [], maxEvents = defaultMaxEvents) {
  const merged = new Map();

  for (const event of [...nextEvents, ...baseEvents]) {
    const normalized = normalizeAuditEvent(event);

    if (!merged.has(normalized.id)) {
      merged.set(normalized.id, normalized);
    }
  }

  return [...merged.values()]
    .sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime())
    .slice(0, maxEvents);
}

function normalizeCategory(value) {
  const normalized = cleanText(value, 40).toLowerCase();
  return knownCategories.has(normalized) ? normalized : "";
}

function normalizeStatus(value) {
  const normalized = cleanText(value, 32).toLowerCase();
  return knownStatuses.has(normalized) ? normalized : "";
}

function normalizePatientId(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9._:-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

function normalizeMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const entries = Object.entries(value)
    .filter(([key]) => cleanText(key, 60))
    .slice(0, 12)
    .map(([key, metadataValue]) => {
      if (typeof metadataValue === "boolean" || typeof metadataValue === "number") {
        return [cleanText(key, 60), metadataValue];
      }

      return [cleanText(key, 60), cleanText(metadataValue, 160)];
    });

  return Object.fromEntries(entries);
}

function parseAuditMaxEvents(value) {
  return clampInteger(value, defaultMaxEvents, 100, 50000);
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

function cleanIso(value) {
  const normalized = cleanText(value, 80);
  return normalized && Number.isFinite(new Date(normalized).getTime()) ? normalized : "";
}

function cleanText(value, maxLength = 160) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function deepClone(value) {
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
}

async function replaceFileWithRetry(source, destination, attempts = 6) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await rename(source, destination);
      return;
    } catch (error) {
      if ((error.code !== "EPERM" && error.code !== "EBUSY") || attempt === attempts - 1) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, 40 * (attempt + 1)));
    }
  }
}
