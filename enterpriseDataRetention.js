function cleanText(value, maxLength = 160) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(cleanText(value, 32), 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function readBoolean(value) {
  return /^(1|true|yes|on)$/i.test(cleanText(value, 16));
}

const retentionDefinitions = Object.freeze([
  {
    id: "memory",
    label: "Patient memory",
    file: "data/memory/patient-memory.json",
    defaultDays: 365,
    envKey: "CARE_NOVA_RETENTION_MEMORY_DAYS",
    clearRoute: "/api/memory/clear",
    rationale: "Carries recent context across repeat interactions."
  },
  {
    id: "records",
    label: "Patient records",
    file: "data/records/patient-records.json",
    defaultDays: 2555,
    envKey: "CARE_NOVA_RETENTION_RECORDS_DAYS",
    clearRoute: "/api/records/clear",
    rationale: "Supports longitudinal care notes, handoff packets, and downloadable reports."
  },
  {
    id: "knowledge_graph",
    label: "Patient knowledge graph",
    file: "data/graph/patient-knowledge-graph.json",
    defaultDays: 365,
    envKey: "CARE_NOVA_RETENTION_GRAPH_DAYS",
    clearRoute: "/api/knowledge-graph/clear",
    rationale: "Stores structured local facts used by routing, continuity, and summarization."
  },
  {
    id: "audit_log",
    label: "Operational audit log",
    file: "data/audit/operational-audit-log.json",
    defaultDays: 365,
    envKey: "CARE_NOVA_RETENTION_AUDIT_DAYS",
    clearRoute: "",
    rationale: "Preserves protected operational review evidence for deployment and incident analysis."
  },
  {
    id: "review_history",
    label: "Admin review history",
    file: "data/audit/admin-review-history.json",
    defaultDays: 730,
    envKey: "CARE_NOVA_RETENTION_REVIEW_HISTORY_DAYS",
    clearRoute: "",
    rationale: "Keeps enterprise review decisions, fingerprints, and release-governance notes."
  },
  {
    id: "training_state",
    label: "Training calibration state",
    file: "data/training/agent-training-state.json",
    defaultDays: 365,
    envKey: "CARE_NOVA_RETENTION_TRAINING_DAYS",
    clearRoute: "",
    rationale: "Tracks local model-improvement calibration and approved feedback outcomes."
  },
  {
    id: "external_cache",
    label: "External knowledge cache",
    file: "data/external/external-knowledge-cache.json",
    defaultDays: 180,
    envKey: "CARE_NOVA_RETENTION_EXTERNAL_CACHE_DAYS",
    clearRoute: "/api/external-knowledge/clear",
    rationale: "Retains normalized reference snippets for online/offline parity."
  },
  {
    id: "onedrive_mirror",
    label: "Local OneDrive mirror",
    file: "data/onedrive-mirror/mirror-manifest.json",
    defaultDays: 365,
    envKey: "CARE_NOVA_RETENTION_MIRROR_DAYS",
    clearRoute: "/api/local-data-mirror",
    rationale: "Keeps the local mirror synchronized for restore and continuity support."
  }
]);

export function getEnterpriseDataRetentionPolicy(env = process.env) {
  const publicDeployment = readBoolean(env.CARE_NOVA_PUBLIC_DEPLOYMENT);
  const policyOwner = cleanText(env.CARE_NOVA_RETENTION_POLICY_OWNER, 80) || "deployment-owner";
  const reviewFrequencyDays = parsePositiveInteger(env.CARE_NOVA_RETENTION_REVIEW_FREQUENCY_DAYS, 90);
  const overrideCount = retentionDefinitions.filter((definition) => cleanText(env[definition.envKey], 32)).length;

  const stores = retentionDefinitions.map((definition) => {
    const retentionDays = parsePositiveInteger(env[definition.envKey], definition.defaultDays);
    const explicitlyConfigured = Boolean(cleanText(env[definition.envKey], 32));

    return {
      id: definition.id,
      label: definition.label,
      file: definition.file,
      retentionDays,
      explicitlyConfigured,
      envKey: definition.envKey,
      clearRoute: definition.clearRoute,
      rationale: definition.rationale
    };
  });

  const reviewPoints = [];

  if (publicDeployment && overrideCount === 0) {
    reviewPoints.push("Document explicit retention windows before shared enterprise deployment instead of relying on defaults only.");
  }

  if (stores.find((store) => store.id === "audit_log")?.retentionDays < 180) {
    reviewPoints.push("Audit-log retention is below 180 days. Confirm incident-review and release-governance requirements.");
  }

  if (stores.find((store) => store.id === "review_history")?.retentionDays < 365) {
    reviewPoints.push("Admin-review history retention is below 365 days. Confirm governance evidence retention requirements.");
  }

  if (!policyOwner || policyOwner === "deployment-owner") {
    reviewPoints.push("Assign a named retention-policy owner before shared enterprise use.");
  }

  const retentionDays = stores.map((store) => store.retentionDays);
  const maxDays = Math.max(...retentionDays);
  const minDays = Math.min(...retentionDays);

  return {
    ok: true,
    status: reviewPoints.length ? "retention-policy-review-needed" : "retention-policy-ready",
    summary: {
      trackedStores: stores.length,
      overrideCount,
      reviewFrequencyDays,
      policyOwner,
      publicDeployment,
      minimumRetentionDays: minDays,
      maximumRetentionDays: maxDays,
      explicitPolicyCoveragePercent: Number(((overrideCount / stores.length) * 100).toFixed(1))
    },
    stores,
    reviewPoints,
    lifecycleRules: [
      "Keep patient-local data on the approved local server store unless an approved deployment explicitly extends that boundary.",
      "Use clear routes for patient-specific data removal where available.",
      "Review retention windows on a fixed schedule before shared rollout or policy change.",
      "Backups and local mirrors should follow the same or stricter retention boundary as their source store."
    ],
    boundary: "This policy describes retention posture only. It does not automatically delete records or override legal/organizational requirements.",
    timestamp: new Date().toISOString()
  };
}
