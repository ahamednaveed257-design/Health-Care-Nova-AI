import { createHash } from "node:crypto";

function cleanText(value, maxLength = 240) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function parseBoolean(value, fallback = false) {
  const normalized = cleanText(value, 32).toLowerCase();

  if (!normalized) {
    return fallback;
  }

  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function uniqueStrings(values = [], maxItems = 40) {
  const unique = [];

  for (const value of values) {
    const normalized = cleanText(value, 260);

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

function getMappedLabel(map, value, prefix) {
  const normalized = cleanText(value, 120);

  if (!normalized) {
    return "";
  }

  if (!map.has(normalized)) {
    map.set(normalized, `${prefix}-${map.size + 1}`);
  }

  return map.get(normalized);
}

function sanitizeMetadata(metadata = {}, context = {}) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }

  const entries = [];

  for (const [rawKey, rawValue] of Object.entries(metadata).slice(0, 20)) {
    const key = cleanText(rawKey, 60);

    if (!key) {
      continue;
    }

    if (typeof rawValue === "boolean" || typeof rawValue === "number") {
      entries.push([key, rawValue]);
      continue;
    }

    const lowerKey = key.toLowerCase();
    const textValue = cleanText(rawValue, 180);

    if (!textValue) {
      continue;
    }

    if (context.redactPatientIds && /(patient|member|mrn)/i.test(lowerKey)) {
      entries.push([key, getMappedLabel(context.patientMap, textValue, "patient") || "[redacted]"]);
      continue;
    }

    if (context.redactRequestIds && /request/i.test(lowerKey)) {
      entries.push([key, getMappedLabel(context.requestMap, textValue, "request") || "[redacted]"]);
      continue;
    }

    entries.push([key, textValue]);
  }

  return Object.fromEntries(entries);
}

function sanitizeAuditEvents(events = [], options = {}) {
  const patientMap = new Map();
  const requestMap = new Map();
  const redactPatientIds = options.redactPatientIds !== false;
  const redactRequestIds = parseBoolean(options.redactRequestIds, true);

  return Array.isArray(events)
    ? events.map((event) => ({
      id: cleanText(event.id, 80),
      at: cleanText(event.at, 80),
      category: cleanText(event.category, 40),
      action: cleanText(event.action, 80),
      status: cleanText(event.status, 32),
      route: cleanText(event.route, 120),
      requestId: redactRequestIds
        ? (getMappedLabel(requestMap, event.requestId, "request") || "")
        : cleanText(event.requestId, 120),
      patientId: redactPatientIds
        ? (getMappedLabel(patientMap, event.patientId, "patient") || "")
        : cleanText(event.patientId, 80),
      actor: cleanText(event.actor, 80),
      summary: cleanText(event.summary, 220),
      detail: cleanText(event.detail, 420),
      metadata: sanitizeMetadata(event.metadata, {
        patientMap,
        requestMap,
        redactPatientIds,
        redactRequestIds
      })
    }))
    : [];
}

function buildRecommendedActions({
  adminPolicy = {},
  configReadiness = {},
  deploymentReadiness = {},
  storageIntegrity = {},
  runtimeMetrics = {}
} = {}) {
  const actions = [];
  const configSummary = configReadiness.summary || {};
  const publicDeployment = deploymentReadiness.publicDeployment || {};
  const runtimeControlSummary = adminPolicy.runtimeControls || {};
  const accessControls = adminPolicy.accessControls || {};
  const metricsSummary = runtimeMetrics.summary || {};
  const storageSummary = storageIntegrity.summary || {};

  if ((configSummary.blockingCount || 0) > 0) {
    actions.push("Resolve blocking enterprise configuration checks before any shared deployment.");
  }

  if (publicDeployment.publicShareReady === false) {
    actions.push("Clear public-hosting review points before exposing the app outside a controlled local environment.");
  }

  if (accessControls.adminAuthRequired !== true) {
    actions.push("Enable enterprise admin authentication for shared deployment review endpoints.");
  }

  if (accessControls.requireAdminForMutations !== true) {
    actions.push("Require admin verification for state-changing enterprise mutation routes in shared environments.");
  }

  if (runtimeControlSummary.requestValidation?.requiresJsonContentType !== true) {
    actions.push("Restore JSON request-contract enforcement across POST APIs.");
  }

  if (storageSummary.criticalReady === false) {
    actions.push("Fix critical local storage integrity findings before release.");
  }

  if ((metricsSummary.errorRatePercent || 0) > 5) {
    actions.push("Investigate elevated runtime error rate before release handoff.");
  }

  return uniqueStrings(actions, 12);
}

function createFingerprint(value) {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, 20);
}

export function buildEnterpriseReviewPacket({
  app = "Care Nova AI",
  version = "",
  runtime = {},
  ai = {},
  externalKnowledge = {},
  enterpriseRuntime = {},
  adminPolicy = {},
  deploymentReadiness = {},
  configReadiness = {},
  governance = {},
  storageIntegrity = {},
  runtimeMetrics = {},
  audit = {},
  includeEvents = false,
  redactPatientIds = true,
  redactRequestIds = true
} = {}) {
  const publicDeployment = deploymentReadiness.publicDeployment || {};
  const auditSummary = audit.summary || {};
  const metricsSummary = runtimeMetrics.summary || {};
  const configSummary = configReadiness.summary || {};
  const accessControls = adminPolicy.accessControls || {};
  const dataControls = adminPolicy.dataControls || {};
  const readinessStatus = configSummary.readyForSharedEnterpriseUse !== false
    && publicDeployment.publicShareReady !== false
    && storageIntegrity.summary?.criticalReady !== false
    ? "enterprise-review-ready"
    : "enterprise-review-needed";
  const reviewPoints = uniqueStrings([
    ...(adminPolicy.reviewPoints || []),
    ...(enterpriseRuntime.reviewPoints || []),
    ...(configReadiness.reviewPoints || [])
  ], 30);
  const recommendedActions = buildRecommendedActions({
    adminPolicy,
    configReadiness,
    deploymentReadiness,
    storageIntegrity,
    runtimeMetrics
  });
  const events = includeEvents
    ? sanitizeAuditEvents(audit.events || [], { redactPatientIds, redactRequestIds })
    : [];
  const packetId = `review-${Date.now()}`;
  const fingerprints = {
    config: createFingerprint(configReadiness.summary || {}),
    runtime: createFingerprint({
      nodeEnv: runtime.nodeEnv || "",
      host: runtime.host || "",
      port: runtime.port || "",
      runtimeTier: enterpriseRuntime.runtimeTier || "",
      aiMode: ai.mode || ""
    }),
    controls: createFingerprint({
      accessControls,
      requestValidation: adminPolicy.runtimeControls?.requestValidation || {},
      storageSummary: storageIntegrity.summary || {}
    })
  };
  fingerprints.combined = createFingerprint(fingerprints);

  return {
    ok: true,
    status: "admin-review-packet-ready",
    summary: {
      readinessStatus,
      localFirst: true,
      offlineReady: ai.offlineReady !== false,
      runtimeTier: enterpriseRuntime.runtimeTier || "",
      publicDeploymentMode: enterpriseRuntime.publicDeploymentMode === true,
      publicShareReady: publicDeployment.publicShareReady !== false,
      configBlockingCount: Number(configSummary.blockingCount || 0),
      configWarningCount: Number(configSummary.warningCount || 0),
      criticalStorageReady: storageIntegrity.summary?.criticalReady !== false,
      auditLoggingEnabled: auditSummary.enabled === true,
      adminAuthRequired: accessControls.adminAuthRequired === true,
      mutationProtectionRequired: accessControls.requireAdminForMutations === true,
      reviewPointCount: reviewPoints.length,
      eventSampleCount: events.length,
      redactionApplied: {
        patientIds: redactPatientIds !== false,
        requestIds: redactRequestIds !== false
      }
    },
    packet: {
      identity: {
        packetId,
        app,
        version,
        generatedAt: new Date().toISOString(),
        generatedFrom: "local-enterprise-review-surface",
        fingerprints
      },
      executiveSummary: {
        releaseScore: Number(deploymentReadiness.score || 0),
        deploymentStatus: deploymentReadiness.status || "",
        configStatus: configReadiness.status || "",
        adminPolicyStatus: adminPolicy.status || "",
        runtimeMetricsStatus: runtimeMetrics.status || "",
        auditStatus: audit.status || "",
        primaryDecision: readinessStatus,
        primaryReason: reviewPoints[0] || "Enterprise controls are currently aligned for this runtime profile."
      },
      environment: {
        nodeEnv: runtime.nodeEnv || "",
        host: runtime.host || "",
        port: runtime.port || "",
        startedAt: runtime.startedAt || "",
        uptimeSeconds: Number(runtime.uptimeSeconds || 0),
        aiMode: ai.mode || "",
        externalKnowledgeMode: externalKnowledge.mode || ""
      },
      controls: {
        transport: adminPolicy.transport || {},
        runtime: adminPolicy.runtimeControls || {},
        data: dataControls,
        access: accessControls
      },
      evidence: {
        configReadiness: {
          status: configReadiness.status || "",
          summary: configSummary,
          recommendedEnv: Array.isArray(configReadiness.recommendedEnv) ? configReadiness.recommendedEnv : []
        },
        deploymentReadiness: {
          status: deploymentReadiness.status || "",
          score: Number(deploymentReadiness.score || 0),
          publicDeployment
        },
        enterpriseRuntime: {
          status: enterpriseRuntime.status || "",
          runtimeTier: enterpriseRuntime.runtimeTier || "",
          safeLocalCoreReady: enterpriseRuntime.safeLocalCoreReady !== false,
          llmAugmentationAvailable: enterpriseRuntime.llmAugmentationAvailable === true
        },
        storageIntegrity: storageIntegrity.summary || {},
        runtimeMetrics: metricsSummary,
        audit: auditSummary,
        governance: governance.governance?.summary || governance.summary || {},
        dataLifecycle: adminPolicy.dataLifecycle?.summary || {}
      },
      actions: {
        recommendedActions,
        requiredPublicControls: Array.isArray(adminPolicy.requiredPublicControls) ? adminPolicy.requiredPublicControls : [],
        reviewPoints
      },
      audit: {
        summary: auditSummary,
        events
      },
      sharing: {
        safeForOperationalReview: true,
        patientIdentifiersRedacted: redactPatientIds !== false,
        requestIdentifiersRedacted: redactRequestIds !== false,
        localOnlySource: true
      }
    },
    timestamp: new Date().toISOString()
  };
}
