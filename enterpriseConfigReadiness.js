import { getEnterpriseAdminAuthProfile } from "./enterpriseAdminSession.js";
import { getEnterpriseAuditStorageInfo } from "./enterpriseAuditStore.js";
import { getEnterprisePatientAccessProfile } from "./enterprisePatientAccess.js";
import { getEnterpriseMutationControlProfile } from "./enterpriseControlProfile.js";
import { getEnterprisePublicDeploymentPolicy } from "./enterprisePublicPolicy.js";

const defaultMaxJsonBodyBytes = 5_000_000;
const recommendedMaxJsonBodyBytes = 10 * 1024 * 1024;

function cleanText(value) {
  return String(value ?? "").trim();
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

function createCheck(id, label, status, detail, recommendedEnv = []) {
  return {
    id,
    label,
    status,
    detail,
    recommendedEnv: recommendedEnv.filter(Boolean)
  };
}

export function getEnterpriseRequestContractProfile(env = process.env) {
  const maxJsonBodyBytes = parsePositiveInteger(env.CARE_NOVA_MAX_JSON_BODY_BYTES, defaultMaxJsonBodyBytes);

  return {
    status: maxJsonBodyBytes > recommendedMaxJsonBodyBytes
      ? "request-contract-review"
      : "request-contract-ready",
    maxJsonBodyBytes,
    requiresJsonContentType: true,
    requiresJsonObject: true,
    supportedContentTypes: ["application/json"],
    recommendedUpperBoundBytes: recommendedMaxJsonBodyBytes,
    summary: {
      maxJsonBodyBytes,
      maxJsonBodyMb: Number((maxJsonBodyBytes / (1024 * 1024)).toFixed(2)),
      requiresJsonContentType: true,
      requiresJsonObject: true,
      supportedContentTypes: ["application/json"]
    }
  };
}

export function getEnterpriseConfigReadiness(env = process.env, runtime = {}) {
  const publicPolicy = getEnterprisePublicDeploymentPolicy(env);
  const publicDeployment = publicPolicy.publicDeployment;
  const productionMode = publicPolicy.productionMode;
  const allowedOriginConfigured = Boolean(publicPolicy.allowedOrigin);
  const strictTransportSecurity = publicPolicy.strictTransportSecurity;
  const trustProxy = publicPolicy.trustProxy;
  const mirrorEnabled = env.CARE_NOVA_ONEDRIVE_MIRROR_ENABLED !== "false";

  const adminAuth = getEnterpriseAdminAuthProfile(env);
  const auditStorage = getEnterpriseAuditStorageInfo(env);
  const patientAccess = getEnterprisePatientAccessProfile(env);
  const mutationControls = getEnterpriseMutationControlProfile(env);
  const requestValidation = getEnterpriseRequestContractProfile(env);

  const checks = [
    createCheck(
      "request_contract",
      "Request contract",
      requestValidation.maxJsonBodyBytes > recommendedMaxJsonBodyBytes ? "review" : "pass",
      requestValidation.maxJsonBodyBytes > recommendedMaxJsonBodyBytes
        ? `Configured JSON body limit is ${requestValidation.maxJsonBodyBytes} bytes, which is above the recommended ${recommendedMaxJsonBodyBytes}-byte enterprise ceiling.`
        : `JSON requests require application/json, object payloads, and stay within ${requestValidation.maxJsonBodyBytes} bytes.`,
      requestValidation.maxJsonBodyBytes > recommendedMaxJsonBodyBytes
        ? [`CARE_NOVA_MAX_JSON_BODY_BYTES=${recommendedMaxJsonBodyBytes}`]
        : []
    ),
    createCheck(
      "audit_log",
      "Operational audit logging",
      auditStorage.enabled ? "pass" : (publicDeployment || productionMode ? "fail" : "review"),
      auditStorage.enabled
        ? `Operational audit logging is enabled with a retention cap of ${auditStorage.maxEvents} event(s).`
        : "Operational audit logging is disabled; enterprise review and incident forensics will be incomplete.",
      ["CARE_NOVA_AUDIT_LOG_ENABLED=true"]
    ),
    createCheck(
      "public_origin_controls",
      "Origin controls",
      publicDeployment && !allowedOriginConfigured ? "fail" : "pass",
      publicDeployment && !allowedOriginConfigured
        ? "Public deployment mode is enabled but ALLOWED_ORIGIN is not configured."
        : allowedOriginConfigured
          ? "ALLOWED_ORIGIN is configured for restricted browser access."
          : "Same-origin access remains active because public deployment mode is off.",
      publicDeployment ? ["ALLOWED_ORIGIN=https://your-domain.example"] : []
    ),
    createCheck(
      "https_transport",
      "HTTPS transport policy",
      publicDeployment && !strictTransportSecurity ? "review" : "pass",
      publicDeployment && !strictTransportSecurity
        ? "Public deployment should enable HSTS after HTTPS termination is in place."
        : strictTransportSecurity
          ? "Strict transport security is enabled."
          : "HSTS is optional while the app remains local or private.",
      publicDeployment ? ["ENABLE_HSTS=true"] : []
    ),
    createCheck(
      "trusted_proxy",
      "Proxy-aware client IP policy",
      (publicDeployment || productionMode) && !trustProxy ? "review" : "pass",
      (publicDeployment || productionMode) && !trustProxy
        ? "Production or public deployments behind a reverse proxy should enable CARE_NOVA_TRUST_PROXY."
        : trustProxy
          ? "Trusted proxy header support is enabled."
          : "Direct host mode is active without proxy-aware client IP parsing.",
      (publicDeployment || productionMode) ? ["CARE_NOVA_TRUST_PROXY=true"] : []
    ),
    createCheck(
      "admin_auth",
      "Admin authentication",
      adminAuth.required
        ? (adminAuth.adminTokenConfigured && adminAuth.sessionSecretConfigured ? "pass" : "fail")
        : publicDeployment
          ? "review"
          : "pass",
      adminAuth.required
        ? (adminAuth.adminTokenConfigured && adminAuth.sessionSecretConfigured
          ? (adminAuth.reviewerTokenConfigured
            ? (adminAuth.requiredByPublicDeployment
              ? "Admin authentication is enforced for public deployment and both admin and reviewer roles are available."
              : "Admin authentication is enabled with admin and reviewer roles available.")
            : (adminAuth.requiredByPublicDeployment
              ? "Admin authentication is enforced for public deployment with admin role and session secret configured."
              : "Admin authentication is enabled with admin role and session secret configured."))
          : "Admin authentication is required but the token or session secret is missing.")
        : publicDeployment
          ? "Public deployments should require admin authentication for policy, audit, integrity, backup, and metrics endpoints."
          : "Admin authentication is optional for local/private use.",
      adminAuth.required
        ? ["CARE_NOVA_ADMIN_API_TOKEN=set-in-secret-store", "CARE_NOVA_ADMIN_SESSION_SECRET=set-in-secret-store"]
        : (publicDeployment ? ["CARE_NOVA_ADMIN_AUTH_REQUIRED=true"] : [])
    ),
    createCheck(
      "mutation_auth",
      "Protected mutation policy",
      mutationControls.requireAdminForMutations
        ? (mutationControls.adminTokenConfigured ? "pass" : "fail")
        : publicDeployment
          ? "review"
          : "pass",
      mutationControls.requireAdminForMutations
        ? (mutationControls.adminTokenConfigured
          ? (mutationControls.requiredByPublicDeployment
            ? "Protected mutation routes are enforced for public deployment and require admin verification."
            : "Protected mutation routes require admin verification.")
          : "Protected mutation routes require admin verification, but CARE_NOVA_ADMIN_API_TOKEN is not configured.")
        : publicDeployment
          ? "Public or shared deployments should require admin verification for training, mirror, memory-clear, records, and graph-clear routes."
          : "Protected mutation routes currently follow the standard local policy.",
      mutationControls.requireAdminForMutations
        ? ["CARE_NOVA_ADMIN_API_TOKEN=set-in-secret-store"]
        : (publicDeployment ? ["CARE_NOVA_REQUIRE_ADMIN_FOR_MUTATIONS=true"] : [])
    ),
    createCheck(
      "patient_access",
      "Patient-scoped access",
      patientAccess.required
        ? (patientAccess.patientAccessSecretConfigured ? "pass" : "fail")
        : "pass",
      patientAccess.required
        ? (patientAccess.patientAccessSecretConfigured
          ? (patientAccess.requiredByPublicDeployment
            ? "Patient-scoped access is enforced for shared/public patient routes."
            : "Patient-scoped access is enabled for protected patient routes.")
          : "Patient-scoped access is required but CARE_NOVA_PATIENT_ACCESS_SECRET is not configured.")
        : patientAccess.patientAccessSecretConfigured
          ? "Patient-scoped access token support is configured and available when needed."
          : "Patient-scoped access remains optional for local/private use.",
      patientAccess.required
        ? [
          "CARE_NOVA_PATIENT_ACCESS_SECRET=set-in-secret-store",
          `CARE_NOVA_PATIENT_HEADER=${patientAccess.headerName}`
        ]
        : []
    ),
    createCheck(
      "local_mirror",
      "Local data mirror",
      mirrorEnabled ? "pass" : "review",
      mirrorEnabled
        ? "The optional local OneDrive mirror path remains available for local redundancy."
        : "The local OneDrive mirror is disabled; localhost remains the only persistence target.",
      mirrorEnabled ? [] : ["CARE_NOVA_ONEDRIVE_MIRROR_ENABLED=true"]
    )
  ];

  const blockingChecks = checks.filter((check) => check.status === "fail");
  const warningChecks = checks.filter((check) => check.status === "review");
  const recommendedEnv = [...new Set(
    checks.flatMap((check) => check.status !== "pass" ? check.recommendedEnv : [])
  )];

  return {
    ok: true,
    status: blockingChecks.length
      ? "config-review-needed"
      : warningChecks.length
        ? "config-ready-with-review-points"
        : "config-ready",
    summary: {
      publicDeployment,
      productionMode,
      blockingCount: blockingChecks.length,
      warningCount: warningChecks.length,
      requestValidation: requestValidation.summary,
      adminAuthRequired: adminAuth.required,
      adminAuthRequiredByPublicDeployment: adminAuth.requiredByPublicDeployment === true,
      reviewerRoleAvailable: adminAuth.reviewerTokenConfigured === true,
      requireAdminForMutations: mutationControls.requireAdminForMutations,
      requireAdminForMutationsByPublicDeployment: mutationControls.requiredByPublicDeployment === true,
      patientAccessRequired: patientAccess.required,
      patientAccessRequiredByPublicDeployment: patientAccess.requiredByPublicDeployment === true,
      patientAccessHeaderName: patientAccess.headerName,
      patientAccessSecretConfigured: patientAccess.patientAccessSecretConfigured === true,
      auditLoggingEnabled: auditStorage.enabled,
      mirrorEnabled,
      readyForSharedEnterpriseUse: blockingChecks.length === 0
    },
    checks,
    recommendedEnv,
    reviewPoints: checks
      .filter((check) => check.status !== "pass")
      .map((check) => `${check.label}: ${check.detail}`),
    runtime: {
      nodeEnv: runtime.nodeEnv || env.NODE_ENV || "development",
      host: runtime.host || "",
      port: runtime.port || ""
    },
    timestamp: new Date().toISOString()
  };
}
