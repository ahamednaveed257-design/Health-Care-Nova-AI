import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const historyFile = resolve(rootDir, "data", "audit", "admin-review-history.json");
const defaultMaxEntries = 250;
const defaultReadLimit = 20;
let cachedStore = null;
let cachedStoreMtimeMs = 0;
let writeQueue = Promise.resolve();

export function getEnterpriseReviewHistoryStorageInfo(env = process.env) {
  return {
    mode: "persistent-local-server-review-history",
    file: "data/audit/admin-review-history.json",
    maxEntries: parseMaxEntries(env.CARE_NOVA_REVIEW_HISTORY_MAX),
    enabled: env.CARE_NOVA_REVIEW_HISTORY_ENABLED !== "false"
  };
}

export async function loadEnterpriseReviewHistory(env = process.env, options = {}) {
  const storage = getEnterpriseReviewHistoryStorageInfo(env);
  const store = await readStore(storage);
  const decision = cleanText(options.decision, 40).toLowerCase();
  const role = cleanText(options.role, 24).toLowerCase();
  const limit = clampInteger(options.limit, defaultReadLimit, 1, 100);

  let entries = [...store.entries];

  if (decision) {
    entries = entries.filter((entry) => entry.decision === decision);
  }

  if (role) {
    entries = entries.filter((entry) => entry.role === role);
  }

  entries = entries.slice(0, limit);

  return {
    ok: true,
    status: storage.enabled ? "review-history-ready" : "review-history-disabled",
    storage,
    summary: buildSummary(store.entries, storage),
    entries,
    timestamp: new Date().toISOString()
  };
}

export async function appendEnterpriseReviewHistoryEntry(entry = {}, env = process.env) {
  const storage = getEnterpriseReviewHistoryStorageInfo(env);

  if (!storage.enabled) {
    return {
      ok: true,
      status: "review-history-disabled",
      storage,
      entry: null,
      timestamp: new Date().toISOString()
    };
  }

  const store = await readStore(storage);
  const normalized = normalizeEntry(entry);

  store.entries = [normalized, ...store.entries].slice(0, storage.maxEntries);
  store.updatedAt = normalized.at;
  store.createdAt = store.createdAt || normalized.at;

  await writeStore(store, storage);

  return {
    ok: true,
    status: "review-history-entry-recorded",
    storage,
    entry: normalized,
    summary: buildSummary(store.entries, storage),
    timestamp: new Date().toISOString()
  };
}

async function readStore(storage) {
  try {
    await writeQueue.catch(() => {});
    const fileStats = await stat(historyFile).catch((error) => {
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

    const raw = await readFile(historyFile, "utf8");
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

    cachedStore = normalizeStore(parsed, storage);
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

  writeQueue = writeQueue.catch(() => {}).then(async () => {
    const latestStore = await readStoreFromDisk(queuedStorage);
    const mergedEntries = mergeEntries(latestStore.entries, queuedStore.entries, queuedStorage.maxEntries);
    const nextStore = {
      ...latestStore,
      ...queuedStore,
      version: 1,
      maxEntries: queuedStorage.maxEntries,
      updatedAt: mergedEntries[0]?.at || queuedStore.updatedAt || latestStore.updatedAt || new Date().toISOString(),
      entries: mergedEntries
    };
    const body = `${JSON.stringify(nextStore, null, 2)}\n`;

    await mkdir(dirname(historyFile), { recursive: true });
    const temporaryFile = `${historyFile}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;

    await writeFile(temporaryFile, body, "utf8");
    await replaceFileWithRetry(temporaryFile, historyFile);
    const fileStats = await stat(historyFile).catch(() => null);
    cachedStore = nextStore;
    cachedStoreMtimeMs = fileStats?.mtimeMs || Date.now();
  });

  await writeQueue;
}

async function readStoreFromDisk(storage) {
  const raw = await readFile(historyFile, "utf8").catch((error) => {
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
    return cloneStore(normalizeStore(JSON.parse(raw), storage), storage);
  } catch {
    const cachedSnapshot = useCachedStoreFallback(storage);

    if (cachedSnapshot) {
      return cachedSnapshot;
    }

    return createEmptyStore(storage);
  }
}

function cloneStore(store, storage) {
  return normalizeStore(
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

function normalizeStore(value, storage) {
  const createdAt = cleanIso(value?.createdAt) || new Date().toISOString();
  const updatedAt = cleanIso(value?.updatedAt) || createdAt;
  const entries = Array.isArray(value?.entries)
    ? value.entries.map(normalizeEntry).slice(0, storage.maxEntries)
    : [];

  return {
    version: 1,
    createdAt,
    updatedAt,
    maxEntries: storage.maxEntries,
    entries
  };
}

function createEmptyStore(storage) {
  const now = new Date().toISOString();

  return {
    version: 1,
    createdAt: now,
    updatedAt: now,
    maxEntries: storage.maxEntries,
    entries: []
  };
}

function normalizeEntry(entry = {}) {
  const at = cleanIso(entry.at) || new Date().toISOString();
  const packet = normalizePacket(entry.reviewPacket);
  const packetSummary = normalizePacketSummary(entry.packetSummary, packet);
  const decision = normalizeDecision(entry.decision);
  const role = normalizeRole(entry.role);

  return {
    id: cleanText(entry.id, 80) || randomUUID(),
    at,
    actorId: cleanText(entry.actorId, 80) || "enterprise-admin",
    role,
    title: cleanText(entry.title, 120) || "Enterprise review snapshot",
    decision,
    notes: cleanText(entry.notes, 1000),
    packetFingerprint: cleanText(entry.packetFingerprint, 120)
      || cleanText(packet?.packet?.identity?.fingerprints?.combined, 120),
    packetSummary,
    reviewPacket: packet
  };
}

function normalizePacket(packet) {
  if (!packet || typeof packet !== "object" || Array.isArray(packet)) {
    return {};
  }

  return packet;
}

function normalizePacketSummary(summary, packet) {
  if (summary && typeof summary === "object" && !Array.isArray(summary)) {
    return {
      readinessStatus: cleanText(summary.readinessStatus, 64),
      primaryDecision: cleanText(summary.primaryDecision, 120),
      runtimeTier: cleanText(summary.runtimeTier, 80),
      publicShareReady: summary.publicShareReady === true,
      reviewPointCount: clampInteger(summary.reviewPointCount, 0, 0, 9999),
      recommendedActionCount: clampInteger(summary.recommendedActionCount, 0, 0, 9999)
    };
  }

  const packetSummary = packet?.summary || {};
  const executiveSummary = packet?.packet?.executiveSummary || {};
  const actions = packet?.packet?.actions || {};

  return {
    readinessStatus: cleanText(packetSummary.readinessStatus, 64),
    primaryDecision: cleanText(executiveSummary.primaryDecision, 120),
    runtimeTier: cleanText(packetSummary.runtimeTier, 80),
    publicShareReady: packetSummary.publicShareReady === true,
    reviewPointCount: Array.isArray(actions.reviewPoints) ? actions.reviewPoints.length : 0,
    recommendedActionCount: Array.isArray(actions.recommendedActions) ? actions.recommendedActions.length : 0
  };
}

function buildSummary(entries = [], storage = getEnterpriseReviewHistoryStorageInfo()) {
  const countsByDecision = {};
  const countsByRole = {};

  for (const entry of entries) {
    countsByDecision[entry.decision] = (countsByDecision[entry.decision] || 0) + 1;
    countsByRole[entry.role] = (countsByRole[entry.role] || 0) + 1;
  }

  return {
    enabled: storage.enabled,
    file: storage.file,
    maxEntries: storage.maxEntries,
    entryCount: entries.length,
    latestAt: entries[0]?.at || "",
    latestDecision: entries[0]?.decision || "",
    latestRole: entries[0]?.role || "",
    countsByDecision,
    countsByRole
  };
}

function mergeEntries(baseEntries = [], nextEntries = [], maxEntries = defaultMaxEntries) {
  const merged = new Map();

  for (const entry of [...nextEntries, ...baseEntries]) {
    const normalized = normalizeEntry(entry);

    if (!merged.has(normalized.id)) {
      merged.set(normalized.id, normalized);
    }
  }

  return [...merged.values()]
    .sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime())
    .slice(0, maxEntries);
}

function normalizeDecision(value) {
  const normalized = cleanText(value, 40).toLowerCase();

  if (!normalized) {
    return "reviewed";
  }

  if (["approved", "reviewed", "blocked", "needs-follow-up", "draft"].includes(normalized)) {
    return normalized;
  }

  return "reviewed";
}

function normalizeRole(value) {
  const normalized = cleanText(value, 24).toLowerCase();
  return normalized === "reviewer" ? "reviewer" : "admin";
}

function parseMaxEntries(value) {
  return clampInteger(value, defaultMaxEntries, 25, 2000);
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
