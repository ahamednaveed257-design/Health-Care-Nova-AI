import { readFileSync } from "node:fs";
import { cleanKnowledgeText, enrichOfflineKnowledgeRecord } from "./offlineKnowledgeEnrichment.js";

const databaseUrl = new URL("../data/offline-medical-db.json", import.meta.url);
const repositoryUrl = new URL("../data/offline-clinical-repository.json", import.meta.url);
const indexUrl = new URL("../data/offline-knowledge-index.json", import.meta.url);
const manifestUrl = new URL("../data/offline-repository-manifest.json", import.meta.url);

const fallbackDatabase = {
  name: "Care Nova Offline Medical Knowledge Database",
  version: "fallback",
  mode: "offline-fallback",
  storage: "in-memory-fallback",
  trainingStatus: "not-foundation-model-training",
  scaleTarget: "trillion-token governed medical corpus readiness",
  currentBoundary: "Offline database file was unavailable, so the app used an empty fallback.",
  governance: {
    requiresApprovedSources: true,
    requiresPhiRemoval: true,
    requiresClinicalReview: true,
    allowsPatientConversationTraining: false,
    allowsDiagnosisOrPrescribing: false,
    retrievalMode: "deterministic keyword and evidence scoring"
  },
  domains: [],
  validationGates: [],
  records: []
};

const fallbackRepository = {
  name: "Care Nova Offline Clinical Repository",
  version: "not-built",
  mode: "offline-repository-not-built",
  sourceRegistry: [],
  sourcePacks: [],
  records: []
};

const fallbackKnowledgeIndex = {
  name: "Care Nova Offline Knowledge Retrieval Index",
  version: "not-built",
  mode: "index-not-built",
  documentCount: 0,
  tokenCount: 0,
  categories: [],
  contentTypes: [],
  sourceFamilies: [],
  populationTags: [],
  sourceReferenceCount: 0
};

const fallbackRepositoryManifest = {
  name: "Care Nova Offline Repository Manifest",
  version: "not-built",
  summary: {
    baseRecordCount: 0,
    repositoryRecordCount: 0,
    packRecordCount: 0,
    totalRetrievalRecords: 0,
    tokenCount: 0,
    categoryCount: 0,
    contentTypeCount: 0,
    populationSegmentCount: 0,
    structuredRecordCount: 0,
    sourceReferenceCount: 0,
    maintenanceTagCount: 0,
    sourcePackCount: 0,
    sourceFamilyCount: 0,
    contentTypeDistribution: {},
    categoryDistribution: {},
    sourceFamilyDistribution: {},
    populationDistribution: {},
    packDistribution: {},
    runsWithoutInternet: true,
    dependencyFree: true
  },
  maintenanceWorkflow: []
};

function loadDatabase() {
  try {
    return JSON.parse(readFileSync(databaseUrl, "utf8"));
  } catch {
    return fallbackDatabase;
  }
}

function loadJson(url, fallback) {
  try {
    return JSON.parse(readFileSync(url, "utf8"));
  } catch {
    return fallback;
  }
}

function normalizeRecord(record, index) {
  const enriched = enrichOfflineKnowledgeRecord(record, {
    fallbackId: `offline-record-${index + 1}`
  });

  return {
    id: cleanText(enriched.id) || `offline-record-${index + 1}`,
    title: cleanText(enriched.title) || "Offline Medical Reference",
    category: cleanText(enriched.category) || "General",
    contentType: cleanText(enriched.contentType),
    keywords: Array.isArray(enriched.keywords) ? enriched.keywords.map(cleanText).filter(Boolean) : [],
    aliases: Array.isArray(enriched.aliases) ? enriched.aliases.map(cleanText).filter(Boolean) : [],
    relatedTerms: Array.isArray(enriched.relatedTerms) ? enriched.relatedTerms.map(cleanText).filter(Boolean) : [],
    routeTags: Array.isArray(enriched.routeTags) ? enriched.routeTags.map(cleanText).filter(Boolean) : [],
    clinicalDomains: Array.isArray(enriched.clinicalDomains) ? enriched.clinicalDomains.map(cleanText).filter(Boolean) : [],
    populationTags: Array.isArray(enriched.populationTags) ? enriched.populationTags.map(cleanText).filter(Boolean) : [],
    summary: cleanText(enriched.summary),
    safetyNotes: cleanText(enriched.safetyNotes),
    whatToTrack: Array.isArray(enriched.whatToTrack) ? enriched.whatToTrack.map(cleanText).filter(Boolean) : [],
    careQuestions: Array.isArray(enriched.careQuestions) ? enriched.careQuestions.map(cleanText).filter(Boolean) : [],
    precautions: Array.isArray(enriched.precautions) ? enriched.precautions.map(cleanText).filter(Boolean) : [],
    redFlagTerms: Array.isArray(enriched.redFlagTerms) ? enriched.redFlagTerms.map(cleanText).filter(Boolean) : [],
    queryPrompts: Array.isArray(enriched.queryPrompts) ? enriched.queryPrompts.map(cleanText).filter(Boolean) : [],
    sourceReferences: Array.isArray(enriched.sourceReferences) ? enriched.sourceReferences.map(cleanText).filter(Boolean) : [],
    maintenanceTags: Array.isArray(enriched.maintenanceTags) ? enriched.maintenanceTags.map(cleanText).filter(Boolean) : [],
    evidenceSignals: Array.isArray(enriched.evidenceSignals) ? enriched.evidenceSignals.map(cleanText).filter(Boolean) : [],
    qualityScore: Number.isFinite(Number(enriched.qualityScore)) ? Number(enriched.qualityScore) : 0,
    sections: normalizeSections(enriched.sections),
    source: cleanText(enriched.source) || "Offline medical database",
    sourceFamily: cleanText(enriched.sourceFamily),
    evidenceLevel: cleanText(enriched.evidenceLevel),
    verificationStatus: cleanText(enriched.verificationStatus),
    lastReviewed: cleanText(enriched.lastReviewed),
    updateCadence: cleanText(enriched.updateCadence),
    retrievalText: cleanText(enriched.retrievalText)
  };
}

function normalizeDatabase(database, repository, knowledgeIndex, repositoryManifest) {
  const baseRecords = Array.isArray(database.records)
    ? database.records.map((record, index) => normalizeRecord(record, index)).filter((record) => record.summary && record.keywords.length)
    : [];
  const repositoryRecords = Array.isArray(repository.records)
    ? repository.records.map((record, index) => normalizeRecord(record, baseRecords.length + index)).filter((record) => record.summary && record.keywords.length)
    : [];
  const records = dedupeRecords([...baseRecords, ...repositoryRecords]);

  return {
    name: cleanText(database.name) || fallbackDatabase.name,
    version: cleanText(database.version) || "1.0.0",
    mode: cleanText(database.mode) || "offline-seeded-governed",
    storage: cleanText(database.storage) || "local-json-database",
    trainingStatus: cleanText(database.trainingStatus) || fallbackDatabase.trainingStatus,
    scaleTarget: cleanText(database.scaleTarget) || fallbackDatabase.scaleTarget,
    currentBoundary: cleanText(database.currentBoundary) || fallbackDatabase.currentBoundary,
    governance: {
      ...fallbackDatabase.governance,
      ...(database.governance && typeof database.governance === "object" ? database.governance : {})
    },
    domains: Array.isArray(database.domains) ? database.domains.map(cleanText).filter(Boolean) : [],
    validationGates: Array.isArray(database.validationGates) ? database.validationGates.map(cleanText).filter(Boolean) : [],
    repository: normalizeRepositorySummary(repository),
    knowledgeIndex: normalizeKnowledgeIndexSummary(knowledgeIndex),
    repositoryManifest: normalizeRepositoryManifest(repositoryManifest, baseRecords.length, repositoryRecords.length, records.length),
    records
  };
}

function buildSummary(database) {
  return {
    name: database.name,
    version: database.version,
    mode: database.mode,
    storage: database.storage,
    trainingStatus: database.trainingStatus,
    scaleTarget: database.scaleTarget,
    currentBoundary: database.currentBoundary,
    offlineReady: true,
    storedRecords: database.records.length,
    domains: database.domains,
    validationGates: database.validationGates,
    governance: database.governance,
    repository: database.repository,
    knowledgeIndex: database.knowledgeIndex,
    repositoryManifest: database.repositoryManifest,
    contentTypes: Array.from(new Set(database.records.map((record) => cleanText(record.contentType)).filter(Boolean))).sort(),
    sourceFamilies: Array.from(new Set(database.records.map((record) => cleanText(record.sourceFamily)).filter(Boolean))).sort(),
    populationTags: Array.from(new Set(database.records.flatMap((record) => record.populationTags || []).map(cleanText).filter(Boolean))).sort(),
    categoryDistribution: buildDistribution(database.records.map((record) => record.category || "General")),
    contentTypeDistribution: buildDistribution(database.records.map((record) => record.contentType || "general")),
    sourceFamilyDistribution: buildDistribution(database.records.map((record) => record.sourceFamily || "clinical-reference-pack")),
    populationDistribution: buildDistribution(database.records.flatMap((record) => record.populationTags || [])),
    structuredRecordCount: database.records.filter((record) => record.sections?.overview || record.whatToTrack?.length || record.careQuestions?.length).length,
    sourceReferenceCount: database.records.reduce((total, record) => total + (Array.isArray(record.sourceReferences) ? record.sourceReferences.length : 0), 0),
    maintenanceTagCount: database.records.reduce((total, record) => total + (Array.isArray(record.maintenanceTags) ? record.maintenanceTags.length : 0), 0),
    sourcePackCount: Array.isArray(database.repository?.sourcePacks) ? database.repository.sourcePacks.length : 0,
    averageQualityScore: database.records.length
      ? Math.round(database.records.reduce((total, record) => total + Number(record.qualityScore || 0), 0) / database.records.length)
      : 0
  };
}

export const OFFLINE_MEDICAL_DATABASE = normalizeDatabase(
  loadDatabase(),
  loadJson(repositoryUrl, fallbackRepository),
  loadJson(indexUrl, fallbackKnowledgeIndex),
  loadJson(manifestUrl, fallbackRepositoryManifest)
);
export const offlineMedicalRecords = OFFLINE_MEDICAL_DATABASE.records;
export const OFFLINE_DATABASE_SUMMARY = buildSummary(OFFLINE_MEDICAL_DATABASE);

export function getOfflineKnowledgeDatabase() {
  return {
    ok: true,
    database: OFFLINE_DATABASE_SUMMARY,
    repository: OFFLINE_MEDICAL_DATABASE.repository,
    knowledgeIndex: OFFLINE_MEDICAL_DATABASE.knowledgeIndex,
    repositoryManifest: OFFLINE_MEDICAL_DATABASE.repositoryManifest,
    records: OFFLINE_MEDICAL_DATABASE.records
  };
}

function normalizeRepositorySummary(repository) {
  const sourceRegistry = Array.isArray(repository.sourceRegistry)
    ? repository.sourceRegistry.map((source) => ({
      id: cleanText(source.id),
      name: cleanText(source.name),
      sourceTypes: Array.isArray(source.sourceTypes) ? source.sourceTypes.map(cleanText).filter(Boolean) : [],
      contentTypes: Array.isArray(source.contentTypes) ? source.contentTypes.map(cleanText).filter(Boolean) : [],
      updateCadence: cleanText(source.updateCadence),
      licensePolicy: cleanText(source.licensePolicy),
      verificationGate: cleanText(source.verificationGate)
    })).filter((source) => source.id && source.name)
    : [];

  return {
    name: cleanText(repository.name) || fallbackRepository.name,
    version: cleanText(repository.version) || fallbackRepository.version,
    mode: cleanText(repository.mode) || fallbackRepository.mode,
    recordCount: Array.isArray(repository.records) ? repository.records.length : 0,
    sourceFamilyCount: sourceRegistry.length,
    sourcePacks: Array.isArray(repository.sourcePacks)
      ? repository.sourcePacks.map((pack) => ({
        id: cleanText(pack.id),
        name: cleanText(pack.name),
        version: cleanText(pack.version),
        recordCount: Number.isFinite(Number(pack.recordCount)) ? Number(pack.recordCount) : 0,
        sourceFamily: cleanText(pack.sourceFamily),
        contentTypeDistribution: normalizeDistributionMap(pack.contentTypeDistribution),
        categoryDistribution: normalizeDistributionMap(pack.categoryDistribution),
        description: cleanText(pack.description),
        reviewStatus: cleanText(pack.reviewStatus),
        updateCadence: cleanText(pack.updateCadence)
      })).filter((pack) => pack.id && pack.name)
      : [],
    sourceRegistry
  };
}

function normalizeKnowledgeIndexSummary(index) {
  return {
    name: cleanText(index.name) || fallbackKnowledgeIndex.name,
    version: cleanText(index.version) || fallbackKnowledgeIndex.version,
    mode: cleanText(index.mode) || fallbackKnowledgeIndex.mode,
    algorithm: cleanText(index.algorithm),
    documentCount: Number.isFinite(index.documentCount) ? index.documentCount : 0,
    tokenCount: Number.isFinite(index.tokenCount) ? index.tokenCount : 0,
    categories: Array.isArray(index.categories) ? index.categories.map(cleanText).filter(Boolean) : [],
    contentTypes: Array.isArray(index.contentTypes) ? index.contentTypes.map(cleanText).filter(Boolean) : [],
    sourceFamilies: Array.isArray(index.sourceFamilies) ? index.sourceFamilies.map(cleanText).filter(Boolean) : [],
    populationTags: Array.isArray(index.populationTags) ? index.populationTags.map(cleanText).filter(Boolean) : [],
    sourceReferenceCount: Number.isFinite(index.sourceReferenceCount) ? index.sourceReferenceCount : 0
  };
}

function normalizeRepositoryManifest(manifest, baseRecordCount, repositoryRecordCount, totalRetrievalRecords) {
  const summary = manifest.summary && typeof manifest.summary === "object" ? manifest.summary : {};

  return {
    name: cleanText(manifest.name) || fallbackRepositoryManifest.name,
    version: cleanText(manifest.version) || fallbackRepositoryManifest.version,
    generatedAt: cleanText(manifest.generatedAt),
    summary: {
      ...fallbackRepositoryManifest.summary,
      ...summary,
      baseRecordCount,
      repositoryRecordCount,
      totalRetrievalRecords
    },
    maintenanceWorkflow: Array.isArray(manifest.maintenanceWorkflow)
      ? manifest.maintenanceWorkflow.map(cleanText).filter(Boolean)
      : []
  };
}

function dedupeRecords(records) {
  const seen = new Set();
  const unique = [];

  for (const record of records) {
    const key = cleanText(record.id).toLowerCase();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(record);
  }

  return unique;
}

function normalizeSections(sections) {
  const value = sections && typeof sections === "object" ? sections : {};

  return {
    overview: cleanText(value.overview),
    whatToTrack: Array.isArray(value.whatToTrack) ? value.whatToTrack.map(cleanText).filter(Boolean) : [],
    careQuestions: Array.isArray(value.careQuestions) ? value.careQuestions.map(cleanText).filter(Boolean) : [],
    precautions: Array.isArray(value.precautions) ? value.precautions.map(cleanText).filter(Boolean) : [],
    sourceReferences: Array.isArray(value.sourceReferences) ? value.sourceReferences.map(cleanText).filter(Boolean) : []
  };
}

function cleanText(value) {
  return cleanKnowledgeText(value);
}

function buildDistribution(values) {
  const counts = {};

  for (const value of values) {
    const key = cleanText(value) || "unknown";
    counts[key] = (counts[key] || 0) + 1;
  }

  return Object.fromEntries(
    Object.entries(counts).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
  );
}

function normalizeDistributionMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .map(([key, count]) => [cleanText(key) || "unknown", Number.isFinite(Number(count)) ? Number(count) : 0])
      .filter(([key, count]) => key && count > 0)
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
  );
}
