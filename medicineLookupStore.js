import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { withFileWriteLock } from "./fileWriteLock.js";
import { getConnectivityPolicy } from "./runtimeConnectivity.js";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const cacheFile = resolve(rootDir, "data", "external", "medicine-lookup-cache.json");
const maxCacheItems = 160;
const defaultTtlHours = 24 * 30;
let cachedStore = null;
let cachedStoreMtimeMs = 0;
let storeWriteQueue = Promise.resolve();

export function getMedicineLookupStorageInfo(env = process.env) {
  const connectivity = getConnectivityPolicy(env);
  const requestedOnline = readBoolean(env.CARE_NOVA_MEDICINE_ONLINE_ENABLED);
  const onlineEnabled = requestedOnline && connectivity.networkAllowed;
  const policyBlocked = requestedOnline && !connectivity.networkAllowed;

  return {
    mode: onlineEnabled ? "online-api-with-local-cache" : "local-cache-only",
    onlineEnabled,
    requestedOnline,
    policyBlocked,
    file: "data/external/medicine-lookup-cache.json",
    onlineSources: ["RxNorm/RxNav", "openFDA drug labeling"],
    sendsPatientIdentity: false,
    queryType: "medicine-name-only",
    maxCacheItems,
    ttlHours: clampInteger(env.CARE_NOVA_MEDICINE_CACHE_TTL_HOURS, 1, 24 * 90, defaultTtlHours),
    connectivity: {
      forceOffline: connectivity.forceOffline,
      internetAvailable: connectivity.internetAvailable
    },
    reason: onlineEnabled
      ? "Medicine lookup will use trusted public label APIs and reuse the local cache."
      : policyBlocked
        ? connectivity.forceOffline
          ? "Medicine lookup online APIs are blocked by offline policy; cache only."
          : "Medicine lookup online APIs are unavailable because internet is unavailable; cache only."
        : "Medicine lookup runs from local cache only."
  };
}

export async function lookupMedicineEvidence(payload = {}, env = process.env) {
  const status = getMedicineLookupStorageInfo(env);
  const query = cleanMedicineQuery(payload.query || payload.name || payload.medicine || "");
  const store = await readStore();

  if (!query) {
    return {
      ok: false,
      mode: "needs-medicine-name",
      query: "",
      message: "Enter a medicine name before checking evidence.",
      status,
      timestamp: new Date().toISOString()
    };
  }

  const cached = findCachedEntry(store, query, status.ttlHours);
  let fetched = null;
  let fetchError = "";

  if (status.onlineEnabled && (!cached.fresh || payload.forceOnline)) {
    try {
      fetched = await fetchMedicineEvidence(query, env);
      if (fetched.rxNorm.rxcui || fetched.openFda.found || fetched.rxNorm.products.length) {
        await writeCacheEntry({ store, query, evidence: fetched });
      }
    } catch (error) {
      fetchError = cleanText(error.message).slice(0, 260);
    }
  }

  const evidence = fetched || cached.entry?.evidence || createEmptyEvidence(query);

  return {
    ok: true,
    mode: fetched
      ? "online-api-with-local-cache"
      : cached.entry
        ? "local-cache"
        : "local-library-only",
    query,
    cacheHit: Boolean(cached.entry),
    cacheFresh: Boolean(cached.fresh),
    fetchedOnline: Boolean(fetched),
    error: fetchError,
    evidence,
    status,
    safetyBoundary: "Use this as medicine identity and label evidence for pharmacist or clinician review. It does not prescribe, calculate doses, or replace the written label.",
    timestamp: new Date().toISOString()
  };
}

async function fetchMedicineEvidence(query, env) {
  const [rxNorm, openFda] = await Promise.allSettled([
    fetchRxNormEvidence(query, env),
    fetchOpenFdaLabel(query, env)
  ]);

  return {
    query,
    rxNorm: rxNorm.status === "fulfilled" ? rxNorm.value : createEmptyRxNorm(),
    openFda: openFda.status === "fulfilled" ? openFda.value : createEmptyOpenFda(),
    fetchedAt: new Date().toISOString()
  };
}

async function fetchRxNormEvidence(query, env) {
  const timeoutMs = clampInteger(env.CARE_NOVA_MEDICINE_API_TIMEOUT_MS, 1000, 15_000, 6000);
  const idPayload = await fetchJsonWithTimeout(
    `https://rxnav.nlm.nih.gov/REST/rxcui.json?name=${encodeURIComponent(query)}&search=2`,
    timeoutMs
  );
  const rxcui = idPayload?.idGroup?.rxnormId?.[0] || "";
  const [propertiesPayload, drugsPayload] = await Promise.all([
    rxcui
      ? fetchJsonWithTimeout(`https://rxnav.nlm.nih.gov/REST/rxcui/${encodeURIComponent(rxcui)}/properties.json`, timeoutMs).catch(() => null)
      : Promise.resolve(null),
    fetchJsonWithTimeout(`https://rxnav.nlm.nih.gov/REST/drugs.json?name=${encodeURIComponent(query)}`, timeoutMs).catch(() => null)
  ]);
  const products = extractRxNormProducts(drugsPayload);
  const properties = propertiesPayload?.properties || {};

  return {
    found: Boolean(rxcui || products.length),
    rxcui,
    name: cleanText(properties.name || products[0]?.name || query),
    synonym: cleanText(properties.synonym || ""),
    tty: cleanText(properties.tty || products[0]?.tty || ""),
    products,
    source: "RxNorm/RxNav"
  };
}

async function fetchOpenFdaLabel(query, env) {
  const timeoutMs = clampInteger(env.CARE_NOVA_MEDICINE_API_TIMEOUT_MS, 1000, 15_000, 6000);
  const url = new URL("https://api.fda.gov/drug/label.json");
  const safeQuery = query.replace(/"/g, " ").replace(/\s+/g, " ").trim();
  url.searchParams.set("search", `openfda.generic_name:"${safeQuery}" OR openfda.brand_name:"${safeQuery}" OR openfda.substance_name:"${safeQuery}"`);
  url.searchParams.set("limit", "1");

  try {
    const payload = await fetchJsonWithTimeout(url.toString(), timeoutMs);
    const label = payload?.results?.[0];
    return normalizeOpenFdaLabel(label, query);
  } catch (error) {
    if (/404/.test(error.message || "")) {
      return createEmptyOpenFda();
    }
    throw error;
  }
}

async function fetchJsonWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json"
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Medicine source returned ${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function extractRxNormProducts(payload) {
  const groups = payload?.drugGroup?.conceptGroup || [];
  const products = [];

  for (const group of groups) {
    for (const product of group.conceptProperties || []) {
      products.push({
        rxcui: cleanText(product.rxcui),
        name: cleanText(product.name),
        synonym: cleanText(product.synonym),
        tty: cleanText(product.tty || group.tty || "")
      });
    }
  }

  return products
    .filter((product) => product.name)
    .slice(0, 8);
}

function normalizeOpenFdaLabel(label, query) {
  if (!label || typeof label !== "object") {
    return createEmptyOpenFda();
  }

  const openfda = label.openfda || {};
  const sectionMap = [
    ["purpose", "Purpose"],
    ["indications_and_usage", "Uses / indications"],
    ["dosage_and_administration", "Label directions"],
    ["warnings", "Warnings"],
    ["boxed_warning", "Boxed warning"],
    ["contraindications", "Contraindications"],
    ["adverse_reactions", "Adverse reactions"],
    ["drug_interactions", "Drug interactions"],
    ["do_not_use", "Do not use"],
    ["ask_doctor", "Ask a doctor"],
    ["ask_doctor_or_pharmacist", "Ask doctor/pharmacist"]
  ];
  const sections = sectionMap
    .map(([key, labelText]) => ({
      key,
      label: labelText,
      text: summarizeLabelText(label[key])
    }))
    .filter((section) => section.text);

  return {
    found: true,
    brandNames: normalizeTextArray(openfda.brand_name),
    genericNames: normalizeTextArray(openfda.generic_name),
    activeIngredients: normalizeTextArray(openfda.substance_name || label.active_ingredient),
    productTypes: normalizeTextArray(openfda.product_type),
    manufacturer: normalizeTextArray(openfda.manufacturer_name).slice(0, 3),
    route: normalizeTextArray(openfda.route),
    sections: sections.slice(0, 7),
    source: "openFDA drug labeling",
    labelId: cleanText(label.id || ""),
    query
  };
}

function summarizeLabelText(value) {
  const text = normalizeTextArray(value).join(" ").replace(/\s+/g, " ").trim();
  return text.length > 460 ? `${text.slice(0, 457).trim()}...` : text;
}

function normalizeTextArray(value) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values.map(cleanText).filter(Boolean).slice(0, 8);
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

    cachedStore = cloneStore({
      version: 1,
      createdAt: parsed.createdAt || new Date().toISOString(),
      updatedAt: parsed.updatedAt || new Date().toISOString(),
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

async function writeCacheEntry({ store, query, evidence }) {
  const now = new Date().toISOString();
  const entry = {
    id: hashText(query),
    query,
    queryTokens: buildTokens(query),
    evidence,
    createdAt: now,
    updatedAt: now
  };
  const entries = [entry, ...store.entries.filter((item) => item.id !== entry.id)].slice(0, maxCacheItems);

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

function findCachedEntry(store, query, ttlHours) {
  const id = hashText(query);
  const tokens = new Set(buildTokens(query));
  const cutoff = Date.now() - ttlHours * 60 * 60 * 1000;
  let fallback = null;

  for (const entry of store.entries) {
    const updated = new Date(entry.updatedAt || entry.createdAt || 0).getTime();
    const exact = entry.id === id;
    const overlap = entry.queryTokens.filter((token) => tokens.has(token)).length;

    if (!exact && overlap < 2) {
      continue;
    }

    if (!fallback || exact) {
      fallback = entry;
    }

    if (Number.isFinite(updated) && updated >= cutoff) {
      return { entry, fresh: true };
    }
  }

  return { entry: fallback, fresh: false };
}

function normalizeCacheEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const query = cleanMedicineQuery(entry.query);
  if (!query) {
    return null;
  }

  return {
    id: entry.id || hashText(query),
    query,
    queryTokens: Array.isArray(entry.queryTokens) ? entry.queryTokens.map(cleanText).filter(Boolean).slice(0, 20) : buildTokens(query),
    evidence: normalizeCachedEvidence(entry.evidence, query),
    createdAt: parseDate(entry.createdAt) || new Date().toISOString(),
    updatedAt: parseDate(entry.updatedAt) || parseDate(entry.createdAt) || new Date().toISOString()
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

function normalizeCachedEvidence(evidence, query) {
  return {
    query,
    rxNorm: evidence?.rxNorm || createEmptyRxNorm(),
    openFda: evidence?.openFda || createEmptyOpenFda(),
    fetchedAt: parseDate(evidence?.fetchedAt) || new Date().toISOString()
  };
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

function createEmptyEvidence(query) {
  return {
    query,
    rxNorm: createEmptyRxNorm(),
    openFda: createEmptyOpenFda(),
    fetchedAt: ""
  };
}

function createEmptyRxNorm() {
  return {
    found: false,
    rxcui: "",
    name: "",
    synonym: "",
    tty: "",
    products: [],
    source: "RxNorm/RxNav"
  };
}

function createEmptyOpenFda() {
  return {
    found: false,
    brandNames: [],
    genericNames: [],
    activeIngredients: [],
    productTypes: [],
    manufacturer: [],
    route: [],
    sections: [],
    source: "openFDA drug labeling",
    labelId: ""
  };
}

function cleanMedicineQuery(value) {
  return cleanText(value)
    .replace(/[^\p{L}\p{N}\s+./-]/gu, " ")
    .replace(/\b\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml|iu|units?)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function buildTokens(value) {
  return Array.from(new Set(cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s/-]/g, " ")
    .split(/[\s/,-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2)
    .slice(0, 24)));
}

function hashText(value) {
  return createHash("sha256").update(cleanText(value).toLowerCase()).digest("hex");
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
  if (value === undefined || value === null || value === "") {
    return true;
  }

  return /^(1|true|yes|on)$/i.test(cleanText(value));
}

function clampInteger(value, min, max, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isInteger(number) ? Math.min(max, Math.max(min, number)) : fallback;
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
