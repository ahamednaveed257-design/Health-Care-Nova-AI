import { getEnterpriseAuditStorageInfo } from "./enterpriseAuditStore.js";
import { getEnterprisePublicDeploymentPolicy } from "./enterprisePublicPolicy.js";

const defaultReviewFrequencyDays = 90;
const defaultTabletopFrequencyDays = 180;
const defaultTargetAckMinutes = 15;
const defaultStatusUpdateMinutes = 60;

function cleanText(value, maxLength = 240) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function readBoolean(value) {
  return /^(1|true|yes|on)$/i.test(cleanText(value));
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(cleanText(value, 32), 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function normalizeIsoTimestamp(value) {
  const candidate = cleanText(value, 80);

  if (!candidate) {
    return "";
  }

  const parsed = new Date(candidate);

  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function getAgeInDays(isoTimestamp) {
  if (!isoTimestamp) {
    return null;
  }

  const deltaMs = Date.now() - new Date(isoTimestamp).getTime();

  if (!Number.isFinite(deltaMs) || deltaMs < 0) {
    return 0;
  }

  return Math.floor(deltaMs / 86_400_000);
}

function normalizeOnCallMode(value) {
  const normalized = cleanText(value, 48).toLowerCase();

  if ([
    "single-owner",
    "shared-rotation",
    "follow-the-sun",
    "business-hours-only"
  ].includes(normalized)) {
    return normalized;
  }

  return "single-owner";
}

function buildSeverityCoverage(env = process.env) {
  return [
    {
      id: "sev1",
      label: "Severity 1 / critical incident",
      ready: readBoolean(env.CARE_NOVA_INCIDENT_SEV1_RUNBOOK_READY),
      focus: "Immediate containment, command owner, communication path, and safety-bounded rollback."
    },
    {
      id: "sev2",
      label: "Severity 2 / degraded service incident",
      ready: readBoolean(env.CARE_NOVA_INCIDENT_SEV2_RUNBOOK_READY),
      focus: "Mitigation owner, user-impact tracking, and same-day recovery coordination."
    },
    {
      id: "sev3",
      label: "Severity 3 / contained operational issue",
      ready: readBoolean(env.CARE_NOVA_INCIDENT_SEV3_RUNBOOK_READY),
      focus: "Queue review, operational follow-up, and evidence capture for low-blast-radius issues."
    }
  ];
}

export function getEnterpriseIncidentPosture(env = process.env) {
  const publicPolicy = getEnterprisePublicDeploymentPolicy(env);
  const auditStorage = getEnterpriseAuditStorageInfo(env);
  const policyOwner = cleanText(env.CARE_NOVA_INCIDENT_POLICY_OWNER, 80);
  const escalationChannel = cleanText(env.CARE_NOVA_INCIDENT_ESCALATION_CHANNEL, 120);
  const reviewFrequencyDays = parsePositiveInteger(
    env.CARE_NOVA_INCIDENT_REVIEW_FREQUENCY_DAYS,
    defaultReviewFrequencyDays
  );
  const tabletopFrequencyDays = parsePositiveInteger(
    env.CARE_NOVA_INCIDENT_TABLETOP_FREQUENCY_DAYS,
    defaultTabletopFrequencyDays
  );
  const targetAckMinutes = parsePositiveInteger(
    env.CARE_NOVA_INCIDENT_TARGET_ACK_MINUTES,
    defaultTargetAckMinutes
  );
  const targetStatusUpdateMinutes = parsePositiveInteger(
    env.CARE_NOVA_INCIDENT_TARGET_STATUS_UPDATE_MINUTES,
    defaultStatusUpdateMinutes
  );
  const lastTabletopAt = normalizeIsoTimestamp(env.CARE_NOVA_INCIDENT_LAST_TABLETOP_AT);
  const lastRunbookReviewAt = normalizeIsoTimestamp(env.CARE_NOVA_INCIDENT_LAST_RUNBOOK_REVIEW_AT);
  const lastTabletopAgeDays = getAgeInDays(lastTabletopAt);
  const lastRunbookReviewAgeDays = getAgeInDays(lastRunbookReviewAt);
  const communicationsTemplateReady = readBoolean(env.CARE_NOVA_INCIDENT_COMMS_TEMPLATE_READY);
  const automationPlanned = readBoolean(env.CARE_NOVA_INCIDENT_AUTOMATION_PLANNED);
  const onCallMode = normalizeOnCallMode(env.CARE_NOVA_INCIDENT_ONCALL_MODE);
  const severityCoverage = buildSeverityCoverage(env);
  const documentedSeverityRunbooks = severityCoverage.filter((item) => item.ready).length;
  const reviewPoints = [];

  if (!policyOwner) {
    reviewPoints.push("Assign a named incident-response owner before shared enterprise deployment.");
  }

  if (!escalationChannel) {
    reviewPoints.push("Define an incident escalation channel or bridge before enterprise rollout.");
  }

  if (!lastTabletopAt) {
    reviewPoints.push("Record a completed incident tabletop date before shared enterprise rollout.");
  } else if (lastTabletopAgeDays !== null && lastTabletopAgeDays > tabletopFrequencyDays) {
    reviewPoints.push(`Last incident tabletop is ${lastTabletopAgeDays} day(s) old. Review incident drills every ${tabletopFrequencyDays} day(s).`);
  }

  if (!lastRunbookReviewAt) {
    reviewPoints.push("Record the last incident runbook review date for release governance.");
  } else if (lastRunbookReviewAgeDays !== null && lastRunbookReviewAgeDays > reviewFrequencyDays) {
    reviewPoints.push(`Last incident runbook review is ${lastRunbookReviewAgeDays} day(s) old. Review runbooks every ${reviewFrequencyDays} day(s).`);
  }

  if (!severityCoverage.find((item) => item.id === "sev1")?.ready) {
    reviewPoints.push("Document a severity-1 incident runbook before enterprise release approval.");
  }

  if (!severityCoverage.find((item) => item.id === "sev2")?.ready) {
    reviewPoints.push("Document a severity-2 incident runbook before enterprise release approval.");
  }

  if (!auditStorage.enabled) {
    reviewPoints.push("Enable the persistent operational audit log so incident evidence is preserved locally.");
  }

  if (publicPolicy.publicDeployment && !communicationsTemplateReady) {
    reviewPoints.push("Prepare a customer-facing communication template before public or shared deployment.");
  }

  if (publicPolicy.publicDeployment && onCallMode === "business-hours-only") {
    reviewPoints.push("Business-hours-only incident coverage is weak for shared or public deployment. Document after-hours escalation.");
  }

  if (targetAckMinutes > 30) {
    reviewPoints.push("Target incident acknowledgment exceeds 30 minutes. Confirm whether that response window is acceptable.");
  }

  if (targetStatusUpdateMinutes > 120) {
    reviewPoints.push("Target incident status-update cadence exceeds 120 minutes. Confirm whether that communication window is acceptable.");
  }

  if (!automationPlanned) {
    reviewPoints.push("Document how incident evidence, follow-up tasks, and review reminders are tracked, even if they stay manual.");
  }

  return {
    ok: true,
    status: reviewPoints.length ? "incident-posture-review-needed" : "incident-posture-ready",
    summary: {
      ownerAssigned: Boolean(policyOwner),
      policyOwner: policyOwner || "",
      escalationChannelConfigured: Boolean(escalationChannel),
      escalationChannel: escalationChannel || "",
      reviewFrequencyDays,
      tabletopFrequencyDays,
      targetAckMinutes,
      targetStatusUpdateMinutes,
      lastTabletopAt,
      lastRunbookReviewAt,
      lastTabletopAgeDays: lastTabletopAgeDays ?? null,
      lastRunbookReviewAgeDays: lastRunbookReviewAgeDays ?? null,
      publicDeploymentMode: publicPolicy.publicDeployment === true,
      auditLoggingEnabled: auditStorage.enabled === true,
      communicationsTemplateReady,
      automationPlanned,
      onCallMode,
      documentedSeverityRunbooks,
      totalSeverityRunbooks: severityCoverage.length
    },
    severityCoverage,
    incidentTargets: {
      targetAckMinutes,
      targetStatusUpdateMinutes,
      tabletopFrequencyDays,
      reviewFrequencyDays,
      auditEvidenceEndpoint: "/api/audit-events"
    },
    operationalGuidance: [
      "Review /api/audit-events after drills, outages, or privileged release checks to confirm incident evidence was captured.",
      "Store release decisions, mitigation notes, and restore outcomes with the protected review packet before closing the incident.",
      "Rehearse severity-1 and severity-2 response flow before shared deployment, especially when local data and patient workflow continuity matter."
    ],
    reviewPoints,
    boundary: "This endpoint reports incident-response ownership, drill cadence, and escalation-readiness metadata only. It does not page responders or create external incidents automatically.",
    timestamp: new Date().toISOString()
  };
}
