import { getEnterpriseDataLifecyclePolicy } from "./enterpriseControlProfile.js";
import { getEnterprisePublicDeploymentPolicy } from "./enterprisePublicPolicy.js";

const defaultReviewFrequencyDays = 90;
const defaultTargetRpoHours = 24;
const defaultTargetRtoHours = 8;

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
  const parsed = Number.parseInt(cleanText(value), 10);

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

function normalizeDrillStatus(value, hasDrillEvidence) {
  const normalized = cleanText(value, 24).toLowerCase();

  if (["pass", "review", "fail"].includes(normalized)) {
    return normalized;
  }

  return hasDrillEvidence ? "review" : "review";
}

export function getEnterpriseRecoveryPosture(env = process.env) {
  const publicPolicy = getEnterprisePublicDeploymentPolicy(env);
  const dataLifecycle = getEnterpriseDataLifecyclePolicy(env);
  const policyOwner = cleanText(env.CARE_NOVA_RECOVERY_POLICY_OWNER, 80);
  const reviewFrequencyDays = parsePositiveInteger(
    env.CARE_NOVA_RECOVERY_REVIEW_FREQUENCY_DAYS,
    defaultReviewFrequencyDays
  );
  const targetRpoHours = parsePositiveInteger(
    env.CARE_NOVA_RECOVERY_TARGET_RPO_HOURS,
    defaultTargetRpoHours
  );
  const targetRtoHours = parsePositiveInteger(
    env.CARE_NOVA_RECOVERY_TARGET_RTO_HOURS,
    defaultTargetRtoHours
  );
  const lastDrillAt = normalizeIsoTimestamp(env.CARE_NOVA_RECOVERY_LAST_DRILL_AT);
  const lastBackupVerifiedAt = normalizeIsoTimestamp(env.CARE_NOVA_RECOVERY_LAST_BACKUP_VERIFIED_AT);
  const mirrorEnabled = env.CARE_NOVA_ONEDRIVE_MIRROR_ENABLED !== "false";
  const primaryBackupLocation = cleanText(env.CARE_NOVA_RECOVERY_PRIMARY_BACKUP_LOCATION, 160)
    || "encrypted-local-backup";
  const secondaryBackupLocation = cleanText(env.CARE_NOVA_RECOVERY_SECONDARY_BACKUP_LOCATION, 160)
    || (mirrorEnabled ? "local-onedrive-mirror" : "secondary-location-not-configured");
  const automationPlanned = readBoolean(env.CARE_NOVA_RECOVERY_AUTOMATION_PLANNED);
  const drillStatus = normalizeDrillStatus(env.CARE_NOVA_RECOVERY_DRILL_STATUS, Boolean(lastDrillAt));
  const lastDrillAgeDays = getAgeInDays(lastDrillAt);
  const lastBackupVerificationAgeDays = getAgeInDays(lastBackupVerifiedAt);
  const stores = Array.isArray(dataLifecycle.stores) ? dataLifecycle.stores : [];
  const mirroredStores = stores.filter((store) => store?.mirrored);
  const reviewPoints = [];

  if (!policyOwner) {
    reviewPoints.push("Assign a named recovery-policy owner before shared enterprise deployment.");
  }

  if (!lastDrillAt) {
    reviewPoints.push("Record a completed restore drill date before shared enterprise rollout.");
  } else if (lastDrillAgeDays !== null && lastDrillAgeDays > reviewFrequencyDays) {
    reviewPoints.push(`Last restore drill is ${lastDrillAgeDays} day(s) old. Review recovery readiness every ${reviewFrequencyDays} day(s).`);
  }

  if (!lastBackupVerifiedAt) {
    reviewPoints.push("Record the last backup verification date for enterprise restore readiness.");
  } else if (lastBackupVerificationAgeDays !== null && lastBackupVerificationAgeDays > reviewFrequencyDays) {
    reviewPoints.push(`Last backup verification is ${lastBackupVerificationAgeDays} day(s) old. Re-verify backup readability every ${reviewFrequencyDays} day(s).`);
  }

  if (targetRpoHours > 48) {
    reviewPoints.push("Target RPO exceeds 48 hours. Confirm whether that data-loss window is acceptable.");
  }

  if (targetRtoHours > 24) {
    reviewPoints.push("Target RTO exceeds 24 hours. Confirm whether that service-recovery window is acceptable.");
  }

  if (drillStatus === "fail") {
    reviewPoints.push("Latest restore drill did not pass. Fix recovery blockers before release approval.");
  }

  if (!mirrorEnabled && publicPolicy.publicDeployment) {
    reviewPoints.push("Enable the optional local mirror or document an equivalent secondary backup before public deployment.");
  }

  if (!automationPlanned) {
    reviewPoints.push("Document how backup verification and restore drills are scheduled, even when they remain manual.");
  }

  return {
    ok: true,
    status: reviewPoints.length ? "recovery-posture-review-needed" : "recovery-posture-ready",
    summary: {
      ownerAssigned: Boolean(policyOwner),
      policyOwner: policyOwner || "",
      reviewFrequencyDays,
      targetRpoHours,
      targetRtoHours,
      lastDrillAt,
      lastBackupVerifiedAt,
      lastDrillAgeDays: lastDrillAgeDays ?? null,
      lastBackupVerificationAgeDays: lastBackupVerificationAgeDays ?? null,
      drillStatus,
      mirrorEnabled,
      automationPlanned,
      coveredStores: stores.length,
      mirroredStores: mirroredStores.length,
      primaryBackupLocation,
      secondaryBackupLocation,
      publicDeploymentMode: publicPolicy.publicDeployment === true
    },
    stores: stores.map((store) => ({
      id: store.id,
      label: store.label,
      file: store.file,
      mirrorFile: store.mirrorFile,
      classification: store.classification,
      clearRoute: store.clearRoute || "",
      mirrored: store.mirrored === true
    })),
    recoveryTargets: {
      rpoHours: targetRpoHours,
      rtoHours: targetRtoHours,
      reviewFrequencyDays,
      restoreGuideEndpoint: "/api/backup-plan"
    },
    operationalGuidance: [
      "Review /api/backup-plan before export or restore operations.",
      "Rebuild the app, restore local data files, then verify /api/health, /api/ready, /api/storage-integrity, and one sample patient workflow.",
      "Keep backup verification and restore-drill evidence with the enterprise review packet."
    ],
    reviewPoints,
    boundary: "This endpoint reports recovery ownership, drill cadence, backup posture, and restore-readiness metadata only. It does not copy or restore files automatically.",
    timestamp: new Date().toISOString()
  };
}
