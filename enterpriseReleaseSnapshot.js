import { createHash, createHmac } from "node:crypto";

const releaseSnapshotEnvKeys = Object.freeze([
  "NODE_ENV",
  "HOST",
  "PORT",
  "CARE_NOVA_PUBLIC_DEPLOYMENT",
  "ALLOWED_ORIGIN",
  "FRAME_ANCESTORS",
  "ENABLE_HSTS",
  "CARE_NOVA_ACCESS_LOG",
  "CARE_NOVA_TRUST_PROXY",
  "CARE_NOVA_AUDIT_LOG_ENABLED",
  "CARE_NOVA_REQUIRE_ADMIN_FOR_MUTATIONS",
  "CARE_NOVA_ADMIN_API_TOKEN",
  "CARE_NOVA_ADMIN_AUTH_REQUIRED",
  "CARE_NOVA_REVIEWER_API_TOKEN",
  "CARE_NOVA_ADMIN_SESSION_SECRET",
  "CARE_NOVA_PATIENT_AUTH_REQUIRED",
  "CARE_NOVA_PATIENT_ACCESS_SECRET",
  "CARE_NOVA_PATIENT_HEADER",
  "CARE_NOVA_PATIENT_SESSION_TTL_MINUTES",
  "CARE_NOVA_RELEASE_SNAPSHOT_SECRET",
  "CARE_NOVA_STRICT_STARTUP_GUARD",
  "CARE_NOVA_MAINTENANCE_MODE",
  "CARE_NOVA_READ_ONLY_MODE",
  "CARE_NOVA_MAX_JSON_BODY_BYTES"
]);

function cleanText(value, maxLength = 240) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function clampInteger(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Math.max(0, Math.trunc(Number(value))) : fallback;
}

function uniqueStrings(values = [], maxItems = 40) {
  const unique = [];

  for (const value of values) {
    const normalized = cleanText(value, 320);

    if (!normalized || unique.includes(normalized)) {
      continue;
    }

    unique.push(normalized);

    if (unique.length >= maxItems) {
      break;
    }
  }

  return unique;
}

function createFingerprint(value, length = 24) {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, length);
}

function resolveSigningSecret(env = process.env) {
  const dedicatedSecret = cleanText(env.CARE_NOVA_RELEASE_SNAPSHOT_SECRET);

  if (dedicatedSecret) {
    return {
      secret: dedicatedSecret,
      source: "CARE_NOVA_RELEASE_SNAPSHOT_SECRET"
    };
  }

  const sessionSecret = cleanText(env.CARE_NOVA_ADMIN_SESSION_SECRET);

  if (sessionSecret) {
    return {
      secret: sessionSecret,
      source: "CARE_NOVA_ADMIN_SESSION_SECRET"
    };
  }

  return {
    secret: "",
    source: ""
  };
}

export function getEnterpriseReleaseSnapshotSigningProfile(env = process.env) {
  const { secret, source } = resolveSigningSecret(env);

  return {
    status: secret ? "release-snapshot-signed" : "release-snapshot-hash-only",
    method: secret ? "hmac-sha256" : "sha256",
    signed: Boolean(secret),
    secretSource: source || "none",
    coveredEnvKeys: [...releaseSnapshotEnvKeys]
  };
}

function buildConfigurationPresence(env = process.env) {
  const entries = releaseSnapshotEnvKeys.map((key) => [key, Boolean(cleanText(env[key], 1024))]);
  const configuredCount = entries.filter(([, configured]) => configured).length;

  return {
    totalTracked: entries.length,
    configuredCount,
    configuredPercent: Number(((configuredCount / entries.length) * 100).toFixed(1)),
    values: Object.fromEntries(entries)
  };
}

function buildCompactAuditEvidence(audit = {}) {
  const summary = audit.summary || {};

  return {
    status: audit.status || "audit-log-unknown",
    enabled: audit.storage?.enabled !== false,
    file: audit.storage?.file || "",
    eventCount: clampInteger(summary.eventCount),
    latestEventAt: cleanText(summary.latestEventAt, 80),
    latestCategory: cleanText(summary.latestCategory, 40),
    latestStatus: cleanText(summary.latestStatus, 32),
    countsByCategory: summary.countsByCategory || {},
    countsByStatus: summary.countsByStatus || {}
  };
}

function buildCompactReviewHistoryEvidence(reviewHistory = {}) {
  const summary = reviewHistory.summary || {};

  return {
    status: reviewHistory.status || "review-history-unknown",
    enabled: reviewHistory.storage?.enabled !== false,
    file: reviewHistory.storage?.file || "",
    entryCount: clampInteger(summary.entryCount),
    latestAt: cleanText(summary.latestAt, 80),
    latestDecision: cleanText(summary.latestDecision, 40),
    latestRole: cleanText(summary.latestRole, 24),
    countsByDecision: summary.countsByDecision || {},
    countsByRole: summary.countsByRole || {}
  };
}

function buildCompactRuntimeEvidence(runtimeMetrics = {}) {
  const summary = runtimeMetrics.summary || {};

  return {
    status: runtimeMetrics.status || "runtime-metrics-unknown",
    startedAt: cleanText(summary.startedAt, 80),
    totalRequests: clampInteger(summary.totalRequests),
    totalErrors: clampInteger(summary.totalErrors),
    totalBlocked: clampInteger(summary.totalBlocked),
    errorRatePercent: Number(summary.errorRatePercent || 0),
    averageDurationMs: clampInteger(summary.averageDurationMs),
    maxDurationMs: clampInteger(summary.maxDurationMs),
    trackedRouteCount: clampInteger(summary.trackedRouteCount),
    maxRecentErrors: clampInteger(summary.maxRecentErrors)
  };
}

function buildCompactStorageEvidence(storageIntegrity = {}) {
  const summary = storageIntegrity.summary || {};

  return {
    status: storageIntegrity.status || "storage-integrity-unknown",
    criticalReady: summary.criticalReady !== false,
    checkedFiles: clampInteger(summary.checkedFiles),
    passCount: clampInteger(summary.passCount),
    reviewCount: clampInteger(summary.reviewCount),
    failCount: clampInteger(summary.failCount),
    latestCheckAt: cleanText(summary.latestCheckAt, 80),
    generatedDataMissing: Array.isArray(summary.generatedDataMissing)
      ? summary.generatedDataMissing.slice(0, 20)
      : []
  };
}

function buildRecommendedActions({
  configReadiness = {},
  deploymentReadiness = {},
  startupReadiness = {},
  adminPolicy = {},
  dataRetention = {},
  incidentPosture = {},
  recoveryPosture = {},
  secretPosture = {},
  storageIntegrity = {},
  runtimeMetrics = {}
} = {}) {
  const actions = [];
  const configSummary = configReadiness.summary || {};
  const publicDeployment = deploymentReadiness.publicDeployment || {};
  const startupSummary = startupReadiness.summary || {};
  const storageSummary = storageIntegrity.summary || {};
  const metricsSummary = runtimeMetrics.summary || {};
  const adminSummary = adminPolicy.summary || {};

  if ((configSummary.blockingCount || 0) > 0) {
    actions.push("Resolve blocking enterprise configuration checks before approving a shared release.");
  }

  if (publicDeployment.publicShareReady === false) {
    actions.push("Complete public-hosting controls before exposing the app outside a controlled local environment.");
  }

  if (startupSummary.shouldBlockStartup === true) {
    actions.push("Clear startup guard blocking checks before the next enterprise release candidate.");
  }

  if (storageSummary.criticalReady === false) {
    actions.push("Fix critical local storage integrity findings before release handoff.");
  }

  if (adminSummary.auditLoggingEnabled === false) {
    actions.push("Enable the persistent local audit log for enterprise operations and release review.");
  }

  if (dataRetention.status === "retention-policy-review-needed") {
    actions.push("Formalize store-specific retention windows and assign a retention owner before enterprise rollout.");
  }

  if (incidentPosture.status === "incident-posture-review-needed") {
    actions.push("Review incident ownership, escalation flow, tabletop cadence, and severity-runbook coverage before enterprise release approval.");
  }

  if (recoveryPosture.status === "recovery-posture-review-needed") {
    actions.push("Review backup ownership, restore drills, and RPO/RTO targets before enterprise release approval.");
  }

  if (secretPosture.status === "secret-posture-review-needed") {
    actions.push("Review enterprise secret storage, required secret coverage, and rotation posture before release approval.");
  }

  if ((metricsSummary.errorRatePercent || 0) > 5) {
    actions.push("Investigate elevated runtime error rate before approving production rollout.");
  }

  return uniqueStrings(actions, 12);
}

function buildReviewPoints({
  adminPolicy = {},
  configReadiness = {},
  startupReadiness = {},
  dataRetention = {},
  incidentPosture = {},
  recoveryPosture = {},
  secretPosture = {},
  storageIntegrity = {}
} = {}) {
  return uniqueStrings([
    ...(adminPolicy.reviewPoints || []),
    ...(configReadiness.reviewPoints || []),
    ...(startupReadiness.reviewPoints || []),
    ...(dataRetention.reviewPoints || []),
    ...(incidentPosture.reviewPoints || []),
    ...(recoveryPosture.reviewPoints || []),
    ...(secretPosture.reviewPoints || []),
    ...((storageIntegrity.checks || [])
      .filter((check) => check.status !== "pass")
      .map((check) => `${cleanText(check.label, 120)}: ${cleanText(check.detail, 260)}`))
  ], 40);
}

function buildSignature(payload, env = process.env) {
  const { secret, source } = resolveSigningSecret(env);
  const serialized = JSON.stringify(payload);

  if (!secret) {
    return {
      method: "sha256",
      signed: false,
      secretSource: "none",
      digest: createHash("sha256").update(serialized).digest("hex")
    };
  }

  return {
    method: "hmac-sha256",
    signed: true,
    secretSource: source,
    digest: createHmac("sha256", secret).update(serialized).digest("hex")
  };
}

export function buildEnterpriseReleaseSnapshot({
  app = "Care Nova AI",
  version = "",
  runtime = {},
  ai = {},
  externalKnowledge = {},
  enterpriseRuntime = {},
  adminPolicy = {},
  deploymentReadiness = {},
  configReadiness = {},
  startupReadiness = {},
  dataRetention = {},
  incidentPosture = {},
  recoveryPosture = {},
  secretPosture = {},
  governance = {},
  storageIntegrity = {},
  runtimeMetrics = {},
  audit = {},
  reviewHistory = {}
} = {}, env = process.env) {
  const publicDeployment = deploymentReadiness.publicDeployment || {};
  const configSummary = configReadiness.summary || {};
  const startupSummary = startupReadiness.summary || {};
  const storageSummary = storageIntegrity.summary || {};
  const presence = buildConfigurationPresence(env);
  const signingProfile = getEnterpriseReleaseSnapshotSigningProfile(env);
  const reviewPoints = buildReviewPoints({
    adminPolicy,
    configReadiness,
    startupReadiness,
    dataRetention,
    incidentPosture,
    recoveryPosture,
    secretPosture,
    storageIntegrity
  });
  const recommendedActions = buildRecommendedActions({
    configReadiness,
    deploymentReadiness,
    startupReadiness,
    adminPolicy,
    dataRetention,
    incidentPosture,
    recoveryPosture,
    secretPosture,
    storageIntegrity,
    runtimeMetrics
  });
  const releaseReady = configSummary.readyForSharedEnterpriseUse !== false
    && publicDeployment.publicShareReady !== false
    && startupSummary.shouldBlockStartup !== true
    && storageSummary.criticalReady !== false;

  const fingerprintPayload = {
    version,
    runtime: {
      nodeEnv: runtime.nodeEnv || "",
      host: runtime.host || "",
      port: runtime.port || "",
      runtimeTier: enterpriseRuntime.runtimeTier || "",
      aiMode: ai.mode || ""
    },
    governance: {
      publicDeploymentMode: publicDeployment.enabled === true,
      publicShareReady: publicDeployment.publicShareReady !== false,
      configStatus: configReadiness.status || "",
      startupStatus: startupReadiness.status || "",
      auditStatus: audit.status || "",
      storageStatus: storageIntegrity.status || ""
    },
    presence: presence.values
  };

  const baseSnapshot = {
    ok: true,
    status: "admin-release-snapshot-ready",
    summary: {
      readinessStatus: releaseReady ? "release-ready" : "release-review-needed",
      releaseApproved: releaseReady,
      localFirst: true,
      offlineCoreReady: ai.offlineReady !== false,
      runtimeTier: cleanText(enterpriseRuntime.runtimeTier, 80),
      publicDeploymentMode: publicDeployment.enabled === true,
      publicShareReady: publicDeployment.publicShareReady !== false,
      startupGuardEnabled: startupSummary.strictGuardEnabled === true,
      signedSnapshot: signingProfile.signed,
      signatureMethod: signingProfile.method,
      configuredControlCount: presence.configuredCount,
      trackedControlCount: presence.totalTracked
    },
    identity: {
      snapshotId: `release-${Date.now()}`,
      generatedAt: new Date().toISOString(),
      app,
      version
    },
    releaseGate: {
      label: "Enterprise release governance snapshot",
      command: "npm run release:check",
      windowsCommand: "release-check.cmd"
    },
    deployment: {
      status: deploymentReadiness.status || "",
      score: Number(deploymentReadiness.score || 0),
      nodeEnv: cleanText(runtime.nodeEnv, 32),
      host: cleanText(runtime.host, 120),
      port: runtime.port || "",
      publicDeployment: publicDeployment
    },
    controls: {
      access: adminPolicy.accessControls || {},
      runtime: adminPolicy.runtimeControls || {},
      transport: adminPolicy.transport || {},
      dataLifecycle: adminPolicy.dataLifecycle?.summary || {},
      configReadiness: {
        status: configReadiness.status || "",
        summary: configSummary,
        recommendedEnv: configReadiness.recommendedEnv || []
      },
      startupReadiness: {
        status: startupReadiness.status || "",
        summary: startupSummary
      },
      dataRetention: {
        status: dataRetention.status || "",
        summary: dataRetention.summary || {}
      },
      incidentPosture: {
        status: incidentPosture.status || "",
        summary: incidentPosture.summary || {}
      },
      recoveryPosture: {
        status: recoveryPosture.status || "",
        summary: recoveryPosture.summary || {}
      },
      secretPosture: {
        status: secretPosture.status || "",
        summary: secretPosture.summary || {}
      },
      governance: governance.summary || {},
      configurationPresence: presence
    },
    evidence: {
      audit: buildCompactAuditEvidence(audit),
      reviewHistory: buildCompactReviewHistoryEvidence(reviewHistory),
      runtimeMetrics: buildCompactRuntimeEvidence(runtimeMetrics),
      storageIntegrity: buildCompactStorageEvidence(storageIntegrity),
      externalKnowledge: {
        status: cleanText(externalKnowledge.status, 80),
        mode: cleanText(externalKnowledge.mode, 80),
        cacheEnabled: externalKnowledge.cache?.enabled !== false
      }
    },
    reviewPoints,
    recommendedActions,
    fingerprints: {
      config: createFingerprint(configSummary),
      runtime: createFingerprint(fingerprintPayload.runtime),
      governance: createFingerprint(fingerprintPayload.governance),
      controls: createFingerprint({
        access: adminPolicy.accessControls || {},
        runtime: adminPolicy.runtimeControls || {},
        transport: adminPolicy.transport || {},
        lifecycle: adminPolicy.dataLifecycle?.summary || {},
        retention: dataRetention.summary || {},
        incident: incidentPosture.summary || {},
        recovery: recoveryPosture.summary || {},
        secrets: secretPosture.summary || {}
      }),
      combined: createFingerprint(fingerprintPayload, 32)
    },
    probes: {
      adminPolicy: "/api/admin-policy",
      configReadiness: "/api/config-readiness",
      startupReadiness: "/api/startup-readiness",
      dataRetentionPolicy: "/api/data-retention-policy",
      incidentPosture: "/api/incident-posture",
      recoveryPosture: "/api/recovery-posture",
      adminSecretPosture: "/api/admin-secret-posture",
      adminReviewPacket: "/api/admin-review-packet",
      adminReviewHistory: "/api/admin-review-history",
      auditEvents: "/api/audit-events",
      runtimeMetrics: "/api/runtime-metrics",
      storageIntegrity: "/api/storage-integrity",
      backupPlan: "/api/backup-plan"
    },
    boundary: "This snapshot exposes enterprise governance state, readiness, and control posture only. It does not expose secrets or permit patient-care mutations.",
    timestamp: new Date().toISOString()
  };

  return {
    ...baseSnapshot,
    signature: buildSignature({
      identity: baseSnapshot.identity,
      summary: baseSnapshot.summary,
      deployment: baseSnapshot.deployment,
      controls: baseSnapshot.controls,
      evidence: baseSnapshot.evidence,
      fingerprints: baseSnapshot.fingerprints,
      reviewPoints: baseSnapshot.reviewPoints,
      recommendedActions: baseSnapshot.recommendedActions
    }, env)
  };
}
