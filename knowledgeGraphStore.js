import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { normalizeStoredPatientDataRecord } from "./recordStore.js";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const graphFile = resolve(rootDir, "data", "graph", "patient-knowledge-graph.json");
const graphShardDir = resolve(rootDir, "data", "graph", "patients");
const graphBundleManifestFile = resolve(rootDir, "data", "graph", "patients.bundle.manifest.json");
const maxFactsPerPatient = 500;
const maxPatientCacheEntries = 256;
let cachedLegacyStore = null;
let cachedLegacyStoreMtimeMs = 0;
let legacyStoreLoad = null;
let cachedBundleManifest = null;
let cachedBundleManifestMtimeMs = 0;
let cachedShardPatientIds = null;
let shardPatientIndexLoad = null;
const cachedPatientGraphs = new Map();
const cachedBundleParts = new Map();
const patientWriteQueues = new Map();

export function getKnowledgeGraphStorageInfo() {
  return {
    mode: "persistent-local-server",
    file: "data/graph/patient-knowledge-graph.json",
    shardDirectory: "data/graph/patients",
    bundledShardManifest: "data/graph/patients.bundle.manifest.json",
    maxFactsPerPatient
  };
}

export function warmKnowledgeGraphStore() {
  const shardPatientIds = readShardPatientIdIndexSync();

  if (shardPatientIds.size) {
    return {
      ready: true,
      patientCount: shardPatientIds.size,
      source: "shard-index-warm"
    };
  }

  try {
    const fileStats = statSync(graphFile, { throwIfNoEntry: false });

    if (!fileStats) {
      cachedLegacyStore = createEmptyStore();
      cachedLegacyStoreMtimeMs = 0;
      return {
        ready: true,
        patientCount: 0,
        source: "empty-legacy-store"
      };
    }

    if (cachedLegacyStore && cachedLegacyStoreMtimeMs === fileStats.mtimeMs) {
      return {
        ready: true,
        patientCount: Object.keys(cachedLegacyStore.patients || {}).length,
        source: "legacy-store-cache"
      };
    }

    const parsed = JSON.parse(readFileSync(graphFile, "utf8"));

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      const cachedSnapshot = useCachedLegacyStoreFallback(fileStats.mtimeMs);

      if (cachedSnapshot) {
        return {
          ready: true,
          patientCount: Object.keys(cachedSnapshot.patients || {}).length,
          source: "legacy-store-cache-fallback"
        };
      }

      cachedLegacyStore = createEmptyStore();
    } else {
      cachedLegacyStore = cloneLegacyStore({
        version: 1,
        createdAt: parsed.createdAt || new Date().toISOString(),
        updatedAt: parsed.updatedAt || parsed.createdAt || new Date().toISOString(),
        patients: parsed.patients && typeof parsed.patients === "object" && !Array.isArray(parsed.patients)
          ? parsed.patients
          : {}
      });
    }

    cachedLegacyStoreMtimeMs = fileStats.mtimeMs;

    return {
      ready: true,
      patientCount: Object.keys(cachedLegacyStore.patients || {}).length,
      source: "legacy-store-sync-warm"
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      cachedLegacyStore = createEmptyStore();
      cachedLegacyStoreMtimeMs = 0;
      return {
        ready: true,
        patientCount: 0,
        source: "empty-legacy-store"
      };
    }

    if (error instanceof SyntaxError) {
      const cachedSnapshot = useCachedLegacyStoreFallback();

      if (cachedSnapshot) {
        return {
          ready: true,
          patientCount: Object.keys(cachedSnapshot.patients || {}).length,
          source: "legacy-store-cache-fallback"
        };
      }

      cachedLegacyStore = createEmptyStore();
      cachedLegacyStoreMtimeMs = 0;
      return {
        ready: true,
        patientCount: 0,
        source: "empty-legacy-store"
      };
    }

    throw error;
  }
}

export async function loadPatientKnowledgeGraph(patientId = "demo-patient") {
  const id = normalizePatientId(patientId);
  const graph = await readPatientGraph(id);

  return toPublicGraph(graph);
}

export async function upsertPatientKnowledgeGraph({
  patientId = "demo-patient",
  payload = {},
  result = {},
  records = []
} = {}) {
  const id = normalizePatientId(patientId);
  const existing = await readPatientGraph(id);
  const now = new Date().toISOString();
  const nextFacts = extractFacts({ payload, result, records, now });
  const facts = dedupeFacts([...nextFacts, ...existing.facts]).slice(0, maxFactsPerPatient);
  const graph = {
    patientId: id,
    createdAt: existing.createdAt || now,
    updatedAt: now,
    facts,
    nodes: buildNodes(id, facts),
    edges: buildEdges(id, facts),
    stats: buildStats(facts)
  };

  await writePatientGraph(id, graph);

  return toPublicGraph(graph);
}

export async function clearPatientKnowledgeGraph(patientId = "demo-patient") {
  const id = normalizePatientId(patientId);
  const graph = normalizePatientGraph(null, id);
  await writePatientGraph(id, graph);

  return toPublicGraph(graph);
}

async function readPatientGraph(patientId) {
  const shardGraph = await readPatientShard(patientId);

  if (shardGraph) {
    return shardGraph;
  }

  const bundledGraph = await readBundledPatientGraph(patientId);

  if (bundledGraph) {
    return bundledGraph;
  }

  const shardPatientIds = await readShardPatientIdIndex();

  if (shardPatientIds.size && !shardPatientIds.has(patientId)) {
    return normalizePatientGraph(null, patientId);
  }

  const legacyStore = await readLegacyStore();
  const legacyRecord = legacyStore.patients?.[patientId];

  if (!legacyRecord) {
    return normalizePatientGraph(null, patientId);
  }

  const graph = normalizePatientGraph(legacyRecord, patientId);
  await writePatientGraph(patientId, graph);
  return graph;
}

async function readPatientShard(patientId) {
  const graphPath = getPatientGraphPath(patientId);
  let fileStats = null;

  try {
    fileStats = await stat(graphPath).catch((error) => {
      if (error.code === "ENOENT") {
        return null;
      }

      throw error;
    });
    const cached = cachedPatientGraphs.get(patientId);

    if (cached && fileStats && cached.mtimeMs === fileStats.mtimeMs) {
      markPatientCacheUsed(patientId, cached);
      return clonePatientGraph(cached.graph, patientId);
    }

    if (!fileStats) {
      if (cachedShardPatientIds) {
        cachedShardPatientIds.delete(patientId);
      }
      cachedPatientGraphs.delete(patientId);
      return null;
    }

    const raw = await readFile(graphPath, "utf8");
    const parsed = JSON.parse(raw);
    const graph = normalizePatientGraph(parsed, patientId);

    cachePatientGraph(patientId, graph, fileStats.mtimeMs);
    return clonePatientGraph(graph, patientId);
  } catch (error) {
    if (error.code === "ENOENT") {
      if (cachedShardPatientIds) {
        cachedShardPatientIds.delete(patientId);
      }
      cachedPatientGraphs.delete(patientId);
      return null;
    }

    if (error instanceof SyntaxError) {
      const cachedSnapshot = useCachedPatientGraphFallback(patientId, fileStats?.mtimeMs);

      if (cachedSnapshot) {
        return cachedSnapshot;
      }

      return normalizePatientGraph(null, patientId);
    }

    throw error;
  }
}

async function readLegacyStore() {
  const fileStats = await stat(graphFile).catch((error) => {
    if (error.code === "ENOENT") {
      return null;
    }

    throw error;
  });

  if (cachedLegacyStore && fileStats && cachedLegacyStoreMtimeMs === fileStats.mtimeMs) {
    return cloneLegacyStore(cachedLegacyStore);
  }

  if (cachedLegacyStore && !fileStats && cachedLegacyStoreMtimeMs === 0) {
    return cloneLegacyStore(cachedLegacyStore);
  }

  if (!fileStats) {
    cachedLegacyStore = createEmptyStore();
    cachedLegacyStoreMtimeMs = 0;
    return cloneLegacyStore(cachedLegacyStore);
  }

  if (!legacyStoreLoad) {
    legacyStoreLoad = readLegacyStoreFromDisk(fileStats).finally(() => {
      legacyStoreLoad = null;
    });
  }

  return legacyStoreLoad;
}

async function readLegacyStoreFromDisk(fileStats) {
  try {
    const parsed = JSON.parse(await readFile(graphFile, "utf8"));

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      const cachedSnapshot = useCachedLegacyStoreFallback(fileStats.mtimeMs);

      if (cachedSnapshot) {
        return cachedSnapshot;
      }

      cachedLegacyStore = createEmptyStore();
    } else {
      cachedLegacyStore = cloneLegacyStore({
        version: 1,
        createdAt: parsed.createdAt || new Date().toISOString(),
        updatedAt: parsed.updatedAt || parsed.createdAt || new Date().toISOString(),
        patients: parsed.patients && typeof parsed.patients === "object" && !Array.isArray(parsed.patients)
          ? parsed.patients
          : {}
      });
    }

    cachedLegacyStoreMtimeMs = fileStats.mtimeMs;
    return cloneLegacyStore(cachedLegacyStore);
  } catch (error) {
    if (error.code === "ENOENT") {
      cachedLegacyStore = createEmptyStore();
      cachedLegacyStoreMtimeMs = 0;
      return cloneLegacyStore(cachedLegacyStore);
    }

    if (error instanceof SyntaxError) {
      const cachedSnapshot = useCachedLegacyStoreFallback(fileStats.mtimeMs);

      if (cachedSnapshot) {
        return cachedSnapshot;
      }

      cachedLegacyStore = createEmptyStore();
      cachedLegacyStoreMtimeMs = fileStats.mtimeMs;
      return cloneLegacyStore(cachedLegacyStore);
    }

    throw error;
  }
}

async function readBundledPatientGraph(patientId) {
  const manifest = await readBundleManifest();

  if (!manifest?.parts?.length) {
    return null;
  }

  const part = manifest.parts.find((entry) => Array.isArray(entry.patientIds) && entry.patientIds.includes(patientId));

  if (!part?.file) {
    return null;
  }

  const payload = await readBundlePart(part.file, manifest.compression);
  const graph = payload?.patients?.[patientId];

  return graph ? normalizePatientGraph(graph, patientId) : null;
}

async function readBundleManifest() {
  const fileStats = await stat(graphBundleManifestFile).catch((error) => {
    if (error.code === "ENOENT") {
      return null;
    }

    throw error;
  });

  if (!fileStats) {
    cachedBundleManifest = null;
    cachedBundleManifestMtimeMs = 0;
    return null;
  }

  if (cachedBundleManifest && cachedBundleManifestMtimeMs === fileStats.mtimeMs) {
    return cloneBundleManifest(cachedBundleManifest);
  }

  try {
    const parsed = JSON.parse(await readFile(graphBundleManifestFile, "utf8"));
    const manifest = cloneBundleManifest({
      compression: parsed?.compression || "gzip",
      parts: Array.isArray(parsed?.parts)
        ? parsed.parts
          .map((part) => ({
            file: typeof part?.file === "string" ? part.file : "",
            patientIds: Array.isArray(part?.patientIds) ? part.patientIds.map((value) => normalizePatientId(value)) : []
          }))
          .filter((part) => part.file)
        : []
    });

    cachedBundleManifest = manifest;
    cachedBundleManifestMtimeMs = fileStats.mtimeMs;
    return cloneBundleManifest(manifest);
  } catch (error) {
    if (error instanceof SyntaxError) {
      const cachedSnapshot = useCachedBundleManifestFallback(fileStats.mtimeMs);

      if (cachedSnapshot) {
        return cachedSnapshot;
      }

      cachedBundleManifest = null;
      cachedBundleManifestMtimeMs = fileStats.mtimeMs;
      return null;
    }

    throw error;
  }
}

async function readBundlePart(fileName, compression = "gzip") {
  const bundlePath = resolve(graphShardDir, fileName);
  const fileStats = await stat(bundlePath).catch((error) => {
    if (error.code === "ENOENT") {
      return null;
    }

    throw error;
  });

  if (!fileStats) {
    cachedBundleParts.delete(fileName);
    return null;
  }

  const cached = cachedBundleParts.get(fileName);

  if (cached && cached.mtimeMs === fileStats.mtimeMs) {
    markBundlePartCacheUsed(fileName, cached);
    return cloneBundlePayload(cached.payload);
  }

  try {
    const raw = await readFile(bundlePath);
    const body = decompressBundleBody(raw, compression);
    const parsed = JSON.parse(body.toString("utf8"));
    const payload = parsed && typeof parsed === "object" && parsed.patients && typeof parsed.patients === "object"
      ? cloneBundlePayload(parsed)
      : { patients: {} };

    cacheBundlePart(fileName, payload, fileStats.mtimeMs);
    return cloneBundlePayload(payload);
  } catch (error) {
    if (error instanceof SyntaxError) {
      const cachedSnapshot = useCachedBundlePartFallback(fileName, fileStats.mtimeMs);

      if (cachedSnapshot) {
        return cachedSnapshot;
      }

      return { patients: {} };
    }

    throw error;
  }
}

async function writePatientGraph(patientId, graph) {
  const graphPath = getPatientGraphPath(patientId);
  const queuedGraph = clonePatientGraph(graph, patientId);
  const body = `${JSON.stringify(queuedGraph, null, 2)}\n`;
  const previousQueue = patientWriteQueues.get(patientId) || Promise.resolve();
  const nextQueue = previousQueue.catch(() => {}).then(async () => {
    await mkdir(dirname(graphPath), { recursive: true });
    const temporaryFile = `${graphPath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;

    await writeFile(temporaryFile, body, "utf8");
    await replaceFileWithRetry(temporaryFile, graphPath);
    const fileStats = await stat(graphPath).catch(() => null);
    cachePatientGraph(patientId, queuedGraph, fileStats?.mtimeMs || Date.now());
    if (cachedShardPatientIds) {
      cachedShardPatientIds.add(patientId);
    }
  });

  patientWriteQueues.set(patientId, nextQueue);
  await nextQueue;

  if (patientWriteQueues.get(patientId) === nextQueue) {
    patientWriteQueues.delete(patientId);
  }
}

function getPatientGraphPath(patientId) {
  return resolve(graphShardDir, `${patientId}.json`);
}

function cachePatientGraph(patientId, graph, mtimeMs) {
  cachedPatientGraphs.set(patientId, {
    graph: clonePatientGraph(graph, patientId),
    mtimeMs
  });
  prunePatientCache();
}

function markPatientCacheUsed(patientId, cached) {
  cachedPatientGraphs.delete(patientId);
  cachedPatientGraphs.set(patientId, cached);
}

function cacheBundlePart(fileName, payload, mtimeMs) {
  cachedBundleParts.set(fileName, {
    payload: cloneBundlePayload(payload),
    mtimeMs
  });
  pruneBundlePartCache();
}

function markBundlePartCacheUsed(fileName, cached) {
  cachedBundleParts.delete(fileName);
  cachedBundleParts.set(fileName, cached);
}

function cloneLegacyStore(store = null) {
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

function clonePatientGraph(graph = null, patientId = "") {
  const normalizedPatientId = normalizePatientId(patientId || graph?.patientId || "demo-patient");
  const source = graph && typeof graph === "object" && !Array.isArray(graph)
    ? deepClone(graph)
    : null;

  return normalizePatientGraph(source, normalizedPatientId);
}

function cloneBundleManifest(manifest = null) {
  const source = manifest && typeof manifest === "object" && !Array.isArray(manifest)
    ? deepClone(manifest)
    : {};

  return {
    compression: cleanText(source.compression) || "gzip",
    parts: Array.isArray(source.parts)
      ? source.parts
        .map((part) => ({
          file: typeof part?.file === "string" ? part.file : "",
          patientIds: Array.isArray(part?.patientIds) ? part.patientIds.map((value) => normalizePatientId(value)).filter(Boolean) : []
        }))
        .filter((part) => part.file)
      : []
  };
}

function cloneBundlePayload(payload = null) {
  const source = payload && typeof payload === "object" && !Array.isArray(payload)
    ? deepClone(payload)
    : {};

  return {
    patients: source.patients && typeof source.patients === "object" && !Array.isArray(source.patients)
      ? source.patients
      : {}
  };
}

function useCachedLegacyStoreFallback(mtimeMs = cachedLegacyStoreMtimeMs) {
  if (!cachedLegacyStore) {
    return null;
  }

  if (Number.isFinite(mtimeMs)) {
    cachedLegacyStoreMtimeMs = mtimeMs;
  }

  return cloneLegacyStore(cachedLegacyStore);
}

function useCachedPatientGraphFallback(patientId, mtimeMs = null) {
  const cached = cachedPatientGraphs.get(patientId);

  if (!cached) {
    return null;
  }

  const nextMtimeMs = Number.isFinite(mtimeMs) ? mtimeMs : cached.mtimeMs;
  cachePatientGraph(patientId, cached.graph, nextMtimeMs);
  return clonePatientGraph(cached.graph, patientId);
}

function useCachedBundleManifestFallback(mtimeMs = cachedBundleManifestMtimeMs) {
  if (!cachedBundleManifest) {
    return null;
  }

  if (Number.isFinite(mtimeMs)) {
    cachedBundleManifestMtimeMs = mtimeMs;
  }

  return cloneBundleManifest(cachedBundleManifest);
}

function useCachedBundlePartFallback(fileName, mtimeMs = null) {
  const cached = cachedBundleParts.get(fileName);

  if (!cached) {
    return null;
  }

  const nextMtimeMs = Number.isFinite(mtimeMs) ? mtimeMs : cached.mtimeMs;
  cacheBundlePart(fileName, cached.payload, nextMtimeMs);
  return cloneBundlePayload(cached.payload);
}

function readShardPatientIdIndexSync() {
  if (cachedShardPatientIds) {
    return cachedShardPatientIds;
  }

  try {
    const entries = readdirSync(graphShardDir, { withFileTypes: true });
    cachedShardPatientIds = new Set(
      entries
        .filter((entry) => entry?.isFile?.() && entry.name.endsWith(".json"))
        .map((entry) => normalizePatientId(entry.name.slice(0, -5)))
        .filter(Boolean)
    );
    return cachedShardPatientIds;
  } catch (error) {
    if (error?.code === "ENOENT") {
      cachedShardPatientIds = new Set();
      return cachedShardPatientIds;
    }

    throw error;
  }
}

async function readShardPatientIdIndex() {
  if (cachedShardPatientIds) {
    return cachedShardPatientIds;
  }

  if (!shardPatientIndexLoad) {
    shardPatientIndexLoad = readdir(graphShardDir, { withFileTypes: true })
      .then((entries) => {
        cachedShardPatientIds = new Set(
          entries
            .filter((entry) => entry?.isFile?.() && entry.name.endsWith(".json"))
            .map((entry) => normalizePatientId(entry.name.slice(0, -5)))
            .filter(Boolean)
        );
        return cachedShardPatientIds;
      })
      .catch((error) => {
        if (error?.code === "ENOENT") {
          cachedShardPatientIds = new Set();
          return cachedShardPatientIds;
        }

        throw error;
      })
      .finally(() => {
        shardPatientIndexLoad = null;
      });
  }

  return shardPatientIndexLoad;
}

function prunePatientCache() {
  while (cachedPatientGraphs.size > maxPatientCacheEntries) {
    const oldestKey = cachedPatientGraphs.keys().next().value;
    cachedPatientGraphs.delete(oldestKey);
  }
}

function pruneBundlePartCache() {
  while (cachedBundleParts.size > 8) {
    const oldestKey = cachedBundleParts.keys().next().value;
    cachedBundleParts.delete(oldestKey);
  }
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

function decompressBundleBody(buffer, compression) {
  if (compression === "gzip" || !compression) {
    return gunzipSync(buffer);
  }

  throw new Error(`Unsupported patient graph bundle compression: ${compression}`);
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

function normalizePatientGraph(record, patientId) {
  const now = new Date().toISOString();
  const facts = Array.isArray(record?.facts)
    ? dedupeFacts(record.facts.map(normalizeFact)).slice(0, maxFactsPerPatient)
    : [];

  return {
    patientId,
    createdAt: record?.createdAt || now,
    updatedAt: record?.updatedAt || record?.createdAt || now,
    facts,
    nodes: Array.isArray(record?.nodes) ? record.nodes.map(normalizeNode).filter(Boolean) : buildNodes(patientId, facts),
    edges: Array.isArray(record?.edges) ? record.edges.map(normalizeEdge).filter(Boolean) : buildEdges(patientId, facts),
    stats: record?.stats || buildStats(facts)
  };
}

function toPublicGraph(graph) {
  return {
    ...getKnowledgeGraphStorageInfo(),
    patientId: graph.patientId,
    createdAt: graph.createdAt,
    updatedAt: graph.updatedAt,
    factCount: graph.facts.length,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    facts: graph.facts,
    nodes: graph.nodes,
    edges: graph.edges,
    stats: buildStats(graph.facts),
    summary: buildGraphSummary(graph.facts)
  };
}

function extractFacts({ payload, result, records, now }) {
  const profile = payload.profile || {};
  const vitals = payload.vitals || {};
  const context = payload.context || {};
  const message = cleanText(payload.message);
  const response = result.finalResponse || {};
  const safetyTriage = result.safetyTriage && typeof result.safetyTriage === "object"
    ? result.safetyTriage
    : {};
  const evidenceCitations = result.evidenceCitations && typeof result.evidenceCitations === "object"
    ? result.evidenceCitations
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
  const facts = [];

  addSplitFacts(facts, "condition", profile.conditions, "profile", now, 0.9);
  addSplitFacts(facts, "medicine", profile.medications || profile.medicines, "profile", now, 0.9);
  addSplitFacts(facts, "allergy", profile.allergies, "profile", now, 0.9);
  addFact(facts, "profile", "age", profile.age, "profile", now, 0.85);
  addFact(facts, "profile", "baselineBp", profile.baselineBp, "profile", now, 0.8);

  for (const [key, value] of Object.entries(vitals || {})) {
    addFact(facts, "vital", key, value, "latest-request", now, 0.82);
  }

  addFact(facts, "concern", "message", message, "latest-request", now, 0.8);
  addSplitFacts(facts, "safetyFlag", (context.redFlags || []).join(", "), "latest-context", now, 0.92);
  addFact(facts, "context", "duration", context.duration, "latest-context", now, 0.72);
  addFact(facts, "context", "severity", context.severity, "latest-context", now, 0.72);
  addFact(facts, "context", "careGoal", context.careGoal, "latest-context", now, 0.76);
  addFact(facts, "context", "supportNow", context.supportNow, "latest-context", now, 0.68);
  addFact(facts, "context", "lastMedicationTime", context.lastMedicationTime, "latest-context", now, 0.7);
  addFact(facts, "specialistFocus", "specialistFocus", context.specialistFocus, "latest-context", now, 0.76);
  addFact(facts, "specialistLens", "specialistLens", context.specialistLens, "latest-context", now, 0.74);
  addSplitFacts(facts, "riskModifier", context.riskModifiers, "latest-context", now, 0.78);
  addObjectFacts(facts, "wellness", context.wellnessProfile, "latest-context", now, 0.72);
  addObjectFacts(facts, "visit", context.visitProfile, "latest-context", now, 0.72);
  addFact(facts, "triageRoute", "recommendedRoute", safetyTriage.recommendedRoute, "triage", now, 0.88);
  addSplitFacts(
    facts,
    "triageSignal",
    Array.isArray(safetyTriage.signals)
      ? safetyTriage.signals.map((signal) => signal?.label || signal?.id)
      : [],
    "triage",
    now,
    0.88
  );
  addSplitFacts(facts, "triageModifier", safetyTriage.modifiers, "triage", now, 0.78);
  addSplitFacts(facts, "triageAction", safetyTriage.actions, "triage", now, 0.78);
  addFact(
    facts,
    "documentType",
    multimodalIntake.documentType?.id || multimodalIntake.documentType?.label,
    multimodalIntake.documentType?.label || multimodalIntake.documentType?.id,
    "multimodal-intake",
    now,
    0.76
  );
  addSplitFacts(
    facts,
    "documentMarker",
    Array.isArray(multimodalIntake.markers)
      ? multimodalIntake.markers.map((marker) => marker?.marker || marker?.label)
      : [],
    "multimodal-intake",
    now,
    0.76
  );
  addSplitFacts(
    facts,
    "documentValue",
    Array.isArray(multimodalIntake.valueHints)
      ? multimodalIntake.valueHints.map((hint) => [hint?.marker, hint?.value].filter(Boolean).join(" "))
      : [],
    "multimodal-intake",
    now,
    0.74
  );

  if (result.risk?.level) {
    addFact(facts, "risk", result.risk.level, result.risk.label || result.risk.level, "analysis", now, 0.9);
  }

  addFact(
    facts,
    "focus",
    responseFocus.primaryIntent || responseFocus.primaryRoute || responseFocus.label,
    responseFocus.label || responseFocus.title || response.title,
    "analysis",
    now,
    0.84
  );
  addFact(
    facts,
    "responseOwner",
    responseOwner.route || responseFocus.primaryRoute,
    responseOwner.label || responseFocus.primaryAgent || responseOwner.route,
    "analysis",
    now,
    0.86
  );
  addSplitFacts(facts, "action", response.whatToDoNow, "analysis", now, 0.76);
  addSplitFacts(facts, "warning", response.warningSigns, "analysis", now, 0.9);
  addSplitFacts(
    facts,
    "evidenceRef",
    result.memoryPatch?.knowledgeSnapshot?.references || result.medicalKnowledge?.matches?.map((match) => match.id || match.title),
    "local-knowledge",
    now,
    0.8
  );
  addSplitFacts(
    facts,
    "evidenceTitle",
    Array.isArray(evidenceCitations.items)
      ? evidenceCitations.items.map((item) => [item?.citationKey, item?.title].filter(Boolean).join(" "))
      : [],
    "evidence-packet",
    now,
    0.78
  );

  for (const intent of result.intents || []) {
    addFact(facts, "intent", intent.route || intent.type, intent.label || intent.type, "analysis", now, Number(intent.confidence || 0.75));
  }

  for (const agent of result.agentResults || []) {
    addFact(facts, "agent", agent.id, agent.name || agent.id, "analysis", now, 0.86);
  }

  for (const match of result.medicalKnowledge?.matches || []) {
    addFact(facts, "evidence", match.id || match.title, match.title || match.category, "local-knowledge", now, Number(match.relevance || 70) / 100);
  }

  for (const record of records || []) {
    const normalizedRecord = normalizeStoredPatientDataRecord(record);
    addFact(facts, "record", normalizedRecord.id, normalizedRecord.documentName || normalizedRecord.summary || normalizedRecord.type || "patient record", "records", now, 0.78);
    addSplitFacts(facts, "condition", normalizedRecord.conditionItems, "records", now, 0.76);
    addSplitFacts(facts, "medicine", normalizedRecord.medicineNames.length ? normalizedRecord.medicineNames : normalizedRecord.medicineItems, "records", now, 0.76);
    addSplitFacts(facts, "allergy", normalizedRecord.allergyItems, "records", now, 0.76);
    addSplitFacts(facts, "lab", normalizedRecord.labItems, "records", now, 0.74);
    addSplitFacts(facts, "vital", normalizedRecord.vitalItems, "records", now, 0.74);
    addSplitFacts(facts, "followUp", normalizedRecord.followUpItems, "records", now, 0.72);
    addSplitFacts(facts, "safetyFlag", normalizedRecord.prioritySignals, "records", now, 0.78);
  }

  return facts;
}

function addSplitFacts(facts, type, value, source, now, confidence) {
  for (const item of splitHealthList(value)) {
    addFact(facts, type, item, item, source, now, confidence);
  }
}

function addObjectFacts(facts, type, value, source, now, confidence) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return;
  }

  for (const [key, entryValue] of Object.entries(value)) {
    addFact(
      facts,
      type,
      key,
      [cleanText(key).replace(/[-_]+/g, " "), cleanText(entryValue)].filter(Boolean).join(" "),
      source,
      now,
      confidence
    );
  }
}

function addFact(facts, type, key, value, source, now, confidence) {
  const cleanKey = cleanText(key).slice(0, 120);
  const cleanValue = cleanText(value).slice(0, 240);

  if (!cleanKey || !cleanValue || cleanValue.toLowerCase() === "none") {
    return;
  }

  facts.push(normalizeFact({
    id: `${type}:${slugify(cleanKey)}:${slugify(cleanValue)}`.slice(0, 180),
    type,
    key: cleanKey,
    value: cleanValue,
    source,
    confidence,
    firstSeenAt: now,
    lastSeenAt: now
  }));
}

function splitHealthList(value) {
  const source = Array.isArray(value) ? value : cleanText(value).split(/[,;|\n]+/g);

  return source
    .map((item) => cleanText(item).replace(/^and\s+/i, ""))
    .filter(Boolean)
    .slice(0, 24);
}

function dedupeFacts(facts) {
  const byId = new Map();

  for (const fact of facts.map(normalizeFact)) {
    if (!fact.id) {
      continue;
    }

    const existing = byId.get(fact.id);
    if (!existing || new Date(fact.lastSeenAt).getTime() >= new Date(existing.lastSeenAt).getTime()) {
      byId.set(fact.id, {
        ...existing,
        ...fact,
        firstSeenAt: existing?.firstSeenAt || fact.firstSeenAt
      });
    }
  }

  return Array.from(byId.values()).sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime());
}

function normalizeFact(fact = {}) {
  const type = cleanText(fact.type).replace(/[^a-zA-Z0-9_-]+/g, "").slice(0, 40) || "fact";
  const key = cleanText(fact.key || fact.value).slice(0, 120);
  const value = cleanText(fact.value || key).slice(0, 240);
  const id = cleanText(fact.id) || `${type}:${slugify(key)}:${slugify(value)}`;

  return {
    id: id.slice(0, 180),
    type,
    key,
    value,
    source: cleanText(fact.source || "local").slice(0, 80),
    confidence: clampNumber(fact.confidence, 0, 1, 0.7),
    firstSeenAt: parseDate(fact.firstSeenAt) || new Date().toISOString(),
    lastSeenAt: parseDate(fact.lastSeenAt) || parseDate(fact.firstSeenAt) || new Date().toISOString()
  };
}

function buildNodes(patientId, facts) {
  const nodes = new Map();

  nodes.set(`patient:${patientId}`, {
    id: `patient:${patientId}`,
    type: "patient",
    label: patientId,
    count: 1
  });

  for (const fact of facts) {
    const id = `${fact.type}:${slugify(fact.value || fact.key)}`.slice(0, 160);
    const existing = nodes.get(id);

    nodes.set(id, {
      id,
      type: fact.type,
      label: fact.value || fact.key,
      count: (existing?.count || 0) + 1,
      lastSeenAt: fact.lastSeenAt
    });
  }

  return Array.from(nodes.values());
}

function buildEdges(patientId, facts) {
  return facts.map((fact) => ({
    id: `edge:${patientId}:${fact.id}`.slice(0, 220),
    from: `patient:${patientId}`,
    to: `${fact.type}:${slugify(fact.value || fact.key)}`.slice(0, 160),
    label: fact.type,
    source: fact.source,
    confidence: fact.confidence,
    lastSeenAt: fact.lastSeenAt
  }));
}

function normalizeNode(node = {}) {
  const id = cleanText(node.id);
  if (!id) return null;

  return {
    id: id.slice(0, 160),
    type: cleanText(node.type || "fact").slice(0, 40),
    label: cleanText(node.label || id).slice(0, 160),
    count: Number.isFinite(Number(node.count)) ? Number(node.count) : 1,
    lastSeenAt: parseDate(node.lastSeenAt) || ""
  };
}

function normalizeEdge(edge = {}) {
  const id = cleanText(edge.id);
  const from = cleanText(edge.from);
  const to = cleanText(edge.to);

  if (!id || !from || !to) return null;

  return {
    id: id.slice(0, 220),
    from: from.slice(0, 160),
    to: to.slice(0, 160),
    label: cleanText(edge.label || "related").slice(0, 60),
    source: cleanText(edge.source || "local").slice(0, 80),
    confidence: clampNumber(edge.confidence, 0, 1, 0.7),
    lastSeenAt: parseDate(edge.lastSeenAt) || ""
  };
}

function buildStats(facts) {
  const typeCounts = {};

  for (const fact of facts) {
    typeCounts[fact.type] = (typeCounts[fact.type] || 0) + 1;
  }

  return {
    totalFacts: facts.length,
    typeCounts,
    latestFactAt: facts[0]?.lastSeenAt || null,
    localOnly: true
  };
}

function buildGraphSummary(facts) {
  const stats = buildStats(facts);
  const topTypes = Object.entries(stats.typeCounts)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5)
    .map(([type, count]) => `${type}: ${count}`);

  return {
    label: facts.length ? "Structured patient context ready" : "No structured context yet",
    detail: topTypes.length ? topTypes.join("; ") : "Run a health check or add records to build the graph.",
    localOnly: true
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

function parseDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function deepClone(value) {
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
}

function slugify(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "item";
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}
