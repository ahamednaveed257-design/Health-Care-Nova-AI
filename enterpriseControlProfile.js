import { resolveEnterpriseAdminIdentity } from "./enterpriseAdminSession.js";
import { getEnterprisePublicDeploymentPolicy } from "./enterprisePublicPolicy.js";

const protectedMutationRoutes = Object.freeze([
  "/api/local-data-mirror",
  "/api/training/example",
  "/api/training/train",
  "/api/training/evaluate",
  "/api/external-knowledge/clear",
  "/api/admin-review-history",
  "/api/memory/clear",
  "/api/records",
  "/api/records/clear",
  "/api/knowledge-graph/clear"
]);

const destructiveMutationRoutes = Object.freeze([
  "/api/external-knowledge/clear",
  "/api/memory/clear",
  "/api/records/clear",
  "/api/knowledge-graph/clear"
]);

const dataLifecycleDefinitions = Object.freeze([
  {
    id: "memory",
    label: "Patient memory",
    file: "data/memory/patient-memory.json",
    mirrorFile: "data/onedrive-mirror/memory/patient-memory.json",
    classification: "patient-context",
    retention: "Retained locally until explicitly cleared by the owner.",
    clearRoute: "/api/memory/clear",
    mirrored: true
  },
  {
    id: "records",
    label: "Patient records",
    file: "data/records/patient-records.json",
    mirrorFile: "data/onedrive-mirror/records/patient-records.json",
    classification: "patient-records",
    retention: "Retained locally until updated or cleared by the owner.",
    clearRoute: "/api/records/clear",
    mirrored: true
  },
  {
    id: "knowledge-graph",
    label: "Patient knowledge graph",
    file: "data/graph/patient-knowledge-graph.json",
    mirrorFile: "data/onedrive-mirror/graph/patient-knowledge-graph.json",
    classification: "derived-structured-context",
    retention: "Retained locally for continuity until explicitly cleared.",
    clearRoute: "/api/knowledge-graph/clear",
    mirrored: true
  },
  {
    id: "training",
    label: "Local training calibration",
    file: "data/training/agent-training-state.json",
    mirrorFile: "data/onedrive-mirror/training/agent-training-state.json",
    classification: "governed-calibration-state",
    retention: "Retained locally until retrained, rotated, or reset by an admin-reviewed workflow.",
    clearRoute: "",
    mirrored: true
  },
  {
    id: "external-knowledge-cache",
    label: "External knowledge cache",
    file: "data/external/external-knowledge-cache.json",
    mirrorFile: "data/onedrive-mirror/external/external-knowledge-cache.json",
    classification: "normalized-reference-cache",
    retention: "Retained locally until cache clear or refresh.",
    clearRoute: "/api/external-knowledge/clear",
    mirrored: true
  },
  {
    id: "medicine-lookup-cache",
    label: "Medicine lookup cache",
    file: "data/external/medicine-lookup-cache.json",
    mirrorFile: "data/onedrive-mirror/external/medicine-lookup-cache.json",
    classification: "reference-cache",
    retention: "Retained locally until refreshed by a later medicine lookup.",
    clearRoute: "",
    mirrored: true
  },
  {
    id: "audit-log",
    label: "Operational audit log",
    file: "data/audit/operational-audit-log.json",
    mirrorFile: "data/onedrive-mirror/audit/operational-audit-log.json",
    classification: "operational-audit",
    retention: "Retained locally according to CARE_NOVA_AUDIT_MAX_EVENTS.",
    clearRoute: "",
    mirrored: true
  },
  {
    id: "review-history",
    label: "Enterprise review history",
    file: "data/audit/admin-review-history.json",
    mirrorFile: "data/onedrive-mirror/audit/admin-review-history.json",
    classification: "enterprise-release-review",
    retention: "Retained locally according to CARE_NOVA_REVIEW_HISTORY_MAX for release and governance review.",
    clearRoute: "",
    mirrored: true
  }
]);

function readBoolean(value) {
  return /^(1|true|yes|on)$/i.test(String(value ?? "").trim());
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function normalizeHeaderName(value) {
  const normalized = cleanText(value)
    .replace(/[^a-zA-Z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return normalized || "X-Care-Nova-Admin-Token";
}

function getHeaderValue(headers = {}, name) {
  const lowerName = String(name || "").trim().toLowerCase();
  const raw = headers?.[lowerName] ?? headers?.[name];

  if (Array.isArray(raw)) {
    return cleanText(raw[0]);
  }

  return cleanText(raw);
}

function extractAdminToken(headers = {}, preferredHeaderName) {
  const preferredToken = getHeaderValue(headers, preferredHeaderName);

  if (preferredToken) {
    return preferredToken;
  }

  const fallbackToken = getHeaderValue(headers, "x-admin-token");

  if (fallbackToken) {
    return fallbackToken;
  }

  const authorization = getHeaderValue(headers, "authorization");
  const bearerMatch = authorization.match(/^Bearer\s+(.+)$/i);

  return cleanText(bearerMatch?.[1] || "");
}

function buildBlockedDecision({ statusCode, code, policy, routeType, detail, adminRequired, headerName }) {
  return {
    allowed: false,
    applicable: true,
    statusCode,
    code,
    policy,
    routeType,
    adminRequired,
    headerName,
    detail
  };
}

export function getProtectedMutationRoutes() {
  return [...protectedMutationRoutes];
}

export function getDestructiveMutationRoutes() {
  return [...destructiveMutationRoutes];
}

export function getEnterpriseMutationControlProfile(env = process.env) {
  const publicPolicy = getEnterprisePublicDeploymentPolicy(env);
  const adminHeaderName = normalizeHeaderName(env.CARE_NOVA_ADMIN_HEADER);
  const requireAdminForMutations = publicPolicy.effectiveMutationProtectionRequired;
  const maintenanceModeEnabled = readBoolean(env.CARE_NOVA_MAINTENANCE_MODE);
  const readOnlyModeEnabled = readBoolean(env.CARE_NOVA_READ_ONLY_MODE);
  const adminApiToken = cleanText(env.CARE_NOVA_ADMIN_API_TOKEN);

  return {
    status: maintenanceModeEnabled
      ? "maintenance-mode-active"
      : readOnlyModeEnabled
        ? "read-only-mode-active"
        : requireAdminForMutations
          ? (adminApiToken ? "admin-protected-mutations" : "admin-protection-misconfigured")
          : "standard-mutation-policy",
    maintenanceModeEnabled,
    readOnlyModeEnabled,
    requireAdminForMutations,
    explicitlyRequired: publicPolicy.explicitMutationProtectionRequired,
    requiredByPublicDeployment: publicPolicy.mutationProtectionRequiredByPublicPolicy,
    adminTokenConfigured: Boolean(adminApiToken),
    adminHeaderName,
    protectedRouteCount: protectedMutationRoutes.length,
    destructiveRouteCount: destructiveMutationRoutes.length,
    protectedRoutes: [...protectedMutationRoutes],
    destructiveRoutes: [...destructiveMutationRoutes],
    summary: {
      maintenanceModeEnabled,
      readOnlyModeEnabled,
      requireAdminForMutations,
      explicitlyRequired: publicPolicy.explicitMutationProtectionRequired,
      requiredByPublicDeployment: publicPolicy.mutationProtectionRequiredByPublicPolicy,
      adminTokenConfigured: Boolean(adminApiToken),
      adminHeaderName,
      protectedRouteCount: protectedMutationRoutes.length,
      destructiveRouteCount: destructiveMutationRoutes.length
    }
  };
}

export function getEnterpriseDataLifecyclePolicy(env = process.env) {
  const mutationControls = getEnterpriseMutationControlProfile(env);

  return {
    status: "enterprise-data-governance-ready",
    summary: {
      storeCount: dataLifecycleDefinitions.length,
      localOnlyStores: dataLifecycleDefinitions.length,
      mirroredStores: dataLifecycleDefinitions.filter((store) => store.mirrored).length,
      adminProtectedMutations: mutationControls.requireAdminForMutations,
      maintenanceModeSupported: true,
      readOnlyModeSupported: true
    },
    stores: dataLifecycleDefinitions.map((definition) => ({
      ...definition,
      clearRouteProtected: Boolean(definition.clearRoute) && mutationControls.requireAdminForMutations,
      runtimeMode: "localhost-primary-plus-optional-onedrive-mirror"
    })),
    accessControls: [
      "All operational data stores remain on localhost by default.",
      "Optional OneDrive mirror copies local JSON files without enabling public cloud APIs by default.",
      "Protected mutation routes can require an admin token before state changes are accepted.",
      "Maintenance mode and read-only mode can halt state-changing routes without changing read access."
    ],
    lifecycleRules: [
      "Patient facts and context are updated locally through guided workflows, not direct public ingestion.",
      "Operational audit events are retained locally with bounded history for enterprise review.",
      "Reference caches remain educational support data and still pass Care Nova safety boundaries before display.",
      "Public static packaging excludes runtime-generated patient files and local audit history."
    ]
  };
}

export function evaluateEnterpriseMutationRequest({ method = "GET", path = "", headers = {}, env = process.env } = {}) {
  const normalizedMethod = cleanText(method).toUpperCase() || "GET";
  const normalizedPath = cleanText(path) || "/";

  if (normalizedMethod !== "POST" || !protectedMutationRoutes.includes(normalizedPath)) {
    return {
      allowed: true,
      applicable: false,
      policy: "not-applicable",
      routeType: "none",
      adminRequired: false,
      headerName: normalizeHeaderName(env.CARE_NOVA_ADMIN_HEADER),
      detail: "Route is not part of the protected enterprise mutation surface."
    };
  }

  const profile = getEnterpriseMutationControlProfile(env);
  const routeType = destructiveMutationRoutes.includes(normalizedPath) ? "destructive" : "state-changing";

  if (profile.maintenanceModeEnabled) {
    return buildBlockedDecision({
      statusCode: 503,
      code: "MAINTENANCE_MODE_ACTIVE",
      policy: profile.status,
      routeType,
      adminRequired: false,
      headerName: profile.adminHeaderName,
      detail: "Mutation routes are paused because enterprise maintenance mode is active."
    });
  }

  if (profile.readOnlyModeEnabled) {
    return buildBlockedDecision({
      statusCode: 503,
      code: "READ_ONLY_MODE_ACTIVE",
      policy: profile.status,
      routeType,
      adminRequired: false,
      headerName: profile.adminHeaderName,
      detail: "Mutation routes are disabled because the runtime is in read-only mode."
    });
  }

  if (profile.requireAdminForMutations) {
    if (!profile.adminTokenConfigured) {
      return buildBlockedDecision({
        statusCode: 503,
        code: "ADMIN_TOKEN_NOT_CONFIGURED",
        policy: profile.status,
        routeType,
        adminRequired: true,
        headerName: profile.adminHeaderName,
        detail: `Protected mutation routes require ${profile.adminHeaderName}, but CARE_NOVA_ADMIN_API_TOKEN is not configured.`
      });
    }

    const identity = resolveEnterpriseAdminIdentity({ headers, env });

    if (!identity.authenticated || identity.role !== "admin") {
      return buildBlockedDecision({
        statusCode: 403,
        code: identity.authenticated ? "ADMIN_ROLE_REQUIRED" : "ADMIN_AUTH_REQUIRED",
        policy: profile.status,
        routeType,
        adminRequired: true,
        headerName: profile.adminHeaderName,
        detail: identity.authenticated
          ? "Protected mutation routes require the admin role."
          : `Protected mutation routes require a valid admin token in ${profile.adminHeaderName} or Authorization: Bearer <token>.`
      });
    }
  }

  return {
    allowed: true,
    applicable: true,
    policy: profile.status,
    routeType,
    adminRequired: profile.requireAdminForMutations,
    headerName: profile.adminHeaderName,
    detail: profile.requireAdminForMutations
      ? "Protected mutation route accepted after admin verification."
      : "Protected mutation route accepted under the standard local mutation policy."
  };
}
