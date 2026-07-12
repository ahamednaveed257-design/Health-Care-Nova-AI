import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { withFileWriteLock } from "./fileWriteLock.js";
import { getConnectivityPolicy, isEndpointUsableForThisRun, isLocalEndpoint } from "./runtimeConnectivity.js";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const cacheFile = resolve(rootDir, "data", "external", "external-knowledge-cache.json");
const maxCacheItems = 200;
const maxRecordsPerQuery = 8;
let cachedStore = null;
let cachedStoreMtimeMs = 0;
let storeWriteQueue = Promise.resolve();

export function getExternalKnowledgeStatus(env = process.env) {
  const connectivity = getConnectivityPolicy(env);
  const endpoint = cleanText(env.CARE_NOVA_EXTERNAL_API_URL);
  const requested = readBoolean(env.CARE_NOVA_EXTERNAL_API_ENABLED) && Boolean(endpoint);
  const endpointIsLocal = Boolean(endpoint) && isLocalEndpoint(endpoint);
  const policyBlocked = requested && !isEndpointUsableForThisRun(endpoint, env, { connectivity });
  const enabled = requested && !policyBlocked;
  const method = cleanText(env.CARE_NOVA_EXTERNAL_API_METHOD || "GET").toUpperCase() === "POST" ? "POST" : "GET";
  const ttlHours = clampInteger(env.CARE_NOVA_EXTERNAL_CACHE_TTL_HOURS, 1, 24 * 30, 24 * 7);
  const reason = enabled
    ? endpointIsLocal
      ? "Local external knowledge endpoint is ready with local cache reuse."
      : "External knowledge API is ready with local cache reuse."
    : policyBlocked
      ? connectivity.forceOffline
        ? "External knowledge API is configured but blocked by offline policy."
        : "External knowledge API is configured but internet is unavailable."
      : "External knowledge API is disabled; local cache only.";

  return {
    mode: enabled
      ? endpointIsLocal
        ? "local-endpoint-with-local-cache"
        : "approved-online-api-with-local-cache"
      : "disabled-local-cache-ready",
    enabled,
    requested,
    configured: requested,
    policyBlocked,
    onlineUse: enabled
      ? endpointIsLocal
        ? "local-endpoint-then-local-cache"
        : "external-api-then-local-cache"
      : "local-cache-only",
    endpointConfigured: Boolean(endpoint),
    endpointIsLocal,
    endpointHost: endpoint ? safeHost(endpoint) : "",
    method,
    queryParam: cleanText(env.CARE_NOVA_EXTERNAL_API_QUERY_PARAM) || "q",
    status: enabled
      ? "ready"
      : policyBlocked
        ? "offline-policy-local-cache-only"
        : "disabled-local-cache-ready",
    connectivity: {
      forceOffline: connectivity.forceOffline,
      internetAvailable: connectivity.internetAvailable
    },
    cache: {
      mode: "persistent-local-server",
      file: "data/external/external-knowledge-cache.json",
      maxCacheItems,
      maxRecordsPerQuery,
      ttlHours
    },
    privacy: {
      deidentifyQueryByDefault: true,
      sendsNameOrPhone: false,
      sendsHealthContext: readBoolean(env.CARE_NOVA_EXTERNAL_API_SEND_HEALTH_CONTEXT)
    },
    futureRequestReuse: true,
    safetyBoundary: "External content is treated as reference material only and still passes Care Nova safety guardrails.",
    reason
  };
}

export async function getExternalKnowledgeForRequest(payload = {}, env = process.env) {
  const status = getExternalKnowledgeStatus(env);
  const query = buildExternalQuery(payload, status.privacy.sendsHealthContext);
  const queryHash = hashText(query);
  const store = await readStore();
  const cached = findCachedRecords(store, query, status.cache.ttlHours);
  let fetchedRecords = [];
  let fetchError = "";

  if (status.enabled && query) {
    try {
      fetchedRecords = await fetchExternalRecords({ query, status, env });

      if (fetchedRecords.length) {
        await writeCacheEntry({
          store,
          query,
          queryHash,
          records: fetchedRecords,
          endpointHost: status.endpointHost
        });
      }
    } catch (error) {
      fetchError = cleanText(error.message).slice(0, 240);
    }
  }

  const records = dedupeRecords([...fetchedRecords, ...cached.records]).slice(0, maxRecordsPerQuery);

  return {
    ...status,
    queryHash,
    cacheHit: cached.records.length > 0,
    cacheMatchedQueries: cached.matchedQueries,
    fetchedOnline: fetchedRecords.length > 0,
    usedForThisRequest: records.length > 0,
    records,
    error: fetchError,
    updatedAt: new Date().toISOString()
  };
}

export async function clearExternalKnowledgeCache() {
  await writeStore(createEmptyStore());
  return {
    ok: true,
    ...getExternalKnowledgeStatus(),
    cleared: true,
    timestamp: new Date().toISOString()
  };
}

async function fetchExternalRecords({ query, status, env }) {
  const endpoint = cleanText(env.CARE_NOVA_EXTERNAL_API_URL);
  const timeoutMs = clampInteger(env.CARE_NOVA_EXTERNAL_API_TIMEOUT_MS, 1000, 15_000, 5000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(buildRequestUrl(endpoint, query, status), {
      method: status.method,
      headers: buildHeaders(env, status.method),
      body: status.method === "POST"
        ? JSON.stringify({
            query,
            source: "Care Nova AI",
            privacy: "deidentified-query"
          })
        : undefined,
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`External API returned ${response.status}`);
    }

    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json") ? await response.json() : await response.text();
    return normalizeExternalRecords(payload, status.endpointHost);
  } finally {
    clearTimeout(timer);
  }
}

function buildRequestUrl(endpoint, query, status) {
  if (status.method === "POST") {
    return endpoint;
  }

  if (endpoint.includes("{query}")) {
    return endpoint.replaceAll("{query}", encodeURIComponent(query));
  }

  const url = new URL(endpoint);
  url.searchParams.set(status.queryParam, query);
  return url.toString();
}

function buildHeaders(env, method) {
  const headers = {
    Accept: "application/json, text/plain;q=0.8"
  };
  const apiKey = cleanText(env.CARE_NOVA_EXTERNAL_API_KEY);
  const authScheme = cleanText(env.CARE_NOVA_EXTERNAL_API_AUTH_SCHEME || "Bearer");
  const apiKeyHeader = cleanText(env.CARE_NOVA_EXTERNAL_API_KEY_HEADER);

  if (method === "POST") {
    headers["Content-Type"] = "application/json; charset=utf-8";
  }

  if (apiKey && apiKeyHeader) {
    headers[apiKeyHeader] = apiKey;
  } else if (apiKey) {
    headers.Authorization = `${authScheme} ${apiKey}`.trim();
  }

  return headers;
}

function normalizeExternalRecords(payload, endpointHost) {
  const items = extractItems(payload);
  return items.map((item, index) => normalizeExternalRecord(item, index, endpointHost)).filter(Boolean).slice(0, maxRecordsPerQuery);
}

function extractItems(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (typeof payload === "string") {
    return [{ title: "External reference", summary: payload }];
  }

  if (!payload || typeof payload !== "object") {
    return [];
  }

  for (const key of ["records", "results", "items", "data", "documents", "entries"]) {
    if (Array.isArray(payload[key])) {
      return payload[key];
    }
  }

  return [payload];
}

function normalizeExternalRecord(item, index, endpointHost) {
  const value = item && typeof item === "object" ? item : { summary: item };
  const title = cleanText(value.title || value.name || value.question || value.heading || `External reference ${index + 1}`).slice(0, 140);
  const summary = cleanText(value.summary || value.description || value.snippet || value.answer || value.text || value.content).slice(0, 900);

  if (!summary) {
    return null;
  }

  const source = cleanText(value.source || value.url || value.link || endpointHost || "Approved external API").slice(0, 180);
  const category = cleanText(value.category || value.type || "External Reference").slice(0, 80);
  const keywords = Array.isArray(value.keywords)
    ? value.keywords.map(cleanText).filter(Boolean).slice(0, 12)
    : buildKeywords(`${title} ${category} ${summary}`).slice(0, 12);

  return {
    id: `external-${hashText(`${title}:${summary}:${source}`).slice(0, 16)}`,
    title,
    category,
    keywords,
    summary,
    safetyNotes: cleanText(value.safetyNotes || value.warning || "External API reference cached locally; verify against approved clinical sources and clinician review.").slice(0, 360),
    source,
    sourceMode: "external-api-local-cache",
    cachedAt: new Date().toISOString()
  };
}

async function readStore() {
  try {
    await storeWriteQueue.catch(() => {});
    const fileStats = await stat(cacheFile).catch((error) => {
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

    const raw = await readFile(cacheFile, "utf8");
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
      entries: Array.isArray(parsed.entries) ? parsed.entries.map(normalizeCacheEntry).filter(Boolean).slice(0, maxCacheItems) : []
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

async function writeCacheEntry({ store, query, queryHash, records, endpointHost }) {
  const now = new Date().toISOString();
  const nextEntry = {
    queryHash,
    query: cleanText(query).slice(0, 280),
    queryTokens: buildKeywords(query).slice(0, 24),
    endpointHost,
    createdAt: now,
    updatedAt: now,
    records: records.map((record) => ({
      ...record,
      cachedAt: now
    }))
  };
  const entries = [nextEntry, ...store.entries.filter((entry) => entry.queryHash !== queryHash)].slice(0, maxCacheItems);

  await writeStore({
    version: 1,
    createdAt: store.createdAt || now,
    updatedAt: now,
    entries
  });
}

async function writeStore(store) {
  const queuedStore = cloneStore(store);
  const body = `${JSON.stringify(queuedStore, null, 2)}\n`;

  storeWriteQueue = storeWriteQueue.catch(() => {}).then(async () => withFileWriteLock(cacheFile, async () => {
    await mkdir(dirname(cacheFile), { recursive: true });
    const temporaryFile = `${cacheFile}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;

    await writeFile(temporaryFile, body, "utf8");
    await replaceFileWithRetry(temporaryFile, cacheFile);
    const fileStats = await stat(cacheFile).catch(() => null);
    cachedStore = queuedStore;
    cachedStoreMtimeMs = fileStats?.mtimeMs || Date.now();
  }));

  await storeWriteQueue;
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

function findCachedRecords(store, query, ttlHours) {
  const queryHash = hashText(query);
  const queryTokens = new Set(buildKeywords(query));
  const cutoff = Date.now() - (ttlHours * 60 * 60 * 1000);
  const matches = [];

  for (const entry of store.entries) {
    const updated = new Date(entry.updatedAt || entry.createdAt || 0).getTime();

    if (Number.isFinite(updated) && updated < cutoff) {
      continue;
    }

    const exact = entry.queryHash === queryHash;
    const overlap = entry.queryTokens.filter((token) => queryTokens.has(token)).length;

    if (!exact && overlap < 2) {
      continue;
    }

    matches.push({
      score: exact ? 100 : overlap,
      queryHash: entry.queryHash,
      records: entry.records
    });
  }

  matches.sort((left, right) => right.score - left.score);

  return {
    matchedQueries: matches.length,
    records: dedupeRecords(matches.flatMap((match) => match.records)).slice(0, maxRecordsPerQuery)
  };
}

function normalizeCacheEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  return {
    queryHash: cleanText(entry.queryHash),
    query: cleanText(entry.query).slice(0, 280),
    queryTokens: Array.isArray(entry.queryTokens) ? entry.queryTokens.map(cleanText).filter(Boolean).slice(0, 24) : [],
    endpointHost: cleanText(entry.endpointHost).slice(0, 120),
    createdAt: parseDate(entry.createdAt) || new Date().toISOString(),
    updatedAt: parseDate(entry.updatedAt) || parseDate(entry.createdAt) || new Date().toISOString(),
    records: Array.isArray(entry.records) ? entry.records.map((record, index) => normalizeExternalRecord(record, index, entry.endpointHost)).filter(Boolean) : []
  };
}

function cloneStore(store = null) {
  const source = store && typeof store === "object" && !Array.isArray(store)
    ? deepClone(store)
    : createEmptyStore();

  return {
    version: 1,
    createdAt: cleanText(source.createdAt) || new Date().toISOString(),
    updatedAt: cleanText(source.updatedAt) || cleanText(source.createdAt) || new Date().toISOString(),
    entries: Array.isArray(source.entries) ? source.entries.map(normalizeCacheEntry).filter(Boolean).slice(0, maxCacheItems) : []
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

function createEmptyStore() {
  const now = new Date().toISOString();

  return {
    version: 1,
    createdAt: now,
    updatedAt: now,
    entries: []
  };
}

function buildExternalQuery(payload, includeHealthContext) {
  const parts = [payload.message];

  if (includeHealthContext && payload.profile && typeof payload.profile === "object") {
    parts.push(payload.profile.conditions, payload.profile.medications, payload.profile.allergies);
  }

  return deidentifyText(parts.join(" ")).slice(0, 360);
}

function deidentifyText(value) {
  return cleanText(value)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, " ")
    .replace(/\b(?:\+?\d[\d\s().-]{7,}\d)\b/g, " ")
    .replace(/\bmy name is\s+[a-z][a-z.'-]*(?:\s+(?!(?:and|with|my|i|bp|blood|sugar|pressure|have|feel|feeling|has|had)\b)[a-z][a-z.'-]*)?/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildKeywords(value) {
  return Array.from(new Set(cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9/%.\s-]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2)
    .slice(0, 40)));
}

function dedupeRecords(records = []) {
  const byId = new Map();

  for (const record of records) {
    if (!record?.id || byId.has(record.id)) {
      continue;
    }

    byId.set(record.id, record);
  }

  return Array.from(byId.values());
}

function hashText(value) {
  return createHash("sha256").update(cleanText(value).toLowerCase()).digest("hex");
}

function safeHost(value) {
  try {
    return new URL(value).host;
  } catch {
    return "";
  }
}

function parseDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function wait(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function readBoolean(value) {
  return /^(1|true|yes|on)$/i.test(cleanText(value));
}

function clampInteger(value, min, max, fallback) {
  const number = Number.parseInt(value, 10);

  if (!Number.isInteger(number)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, number));
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
