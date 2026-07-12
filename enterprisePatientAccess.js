import { createHmac, timingSafeEqual } from "node:crypto";

import { resolveEnterpriseAdminIdentity } from "./enterpriseAdminSession.js";
import { getEnterprisePublicDeploymentPolicy } from "./enterprisePublicPolicy.js";

const protectedPatientRoutes = Object.freeze([
  { method: "GET", path: "/api/memory" },
  { method: "GET", path: "/api/records" },
  { method: "GET", path: "/api/knowledge-graph" },
  { method: "POST", path: "/api/analyze" },
  { method: "POST", path: "/api/realtime" }
]);

const supportedPatientRoles = Object.freeze(["patient", "caregiver", "service"]);
const defaultPatientSessionTtlMinutes = 8 * 60;

function cleanText(value, maxLength = 240) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function readBoolean(value) {
  return /^(1|true|yes|on)$/i.test(cleanText(value, 16));
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(cleanText(value, 32), 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function normalizeHeaderName(value) {
  const normalized = cleanText(value, 120)
    .replace(/[^a-zA-Z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return normalized || "X-Care-Nova-Patient-Token";
}

function normalizePatientId(value, fallback = "demo-patient") {
  const cleaned = cleanText(value || fallback, 120)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return cleaned || "demo-patient";
}

function normalizeRole(value, fallback = "") {
  const normalized = cleanText(value, 32).toLowerCase();
  return supportedPatientRoles.includes(normalized) ? normalized : fallback;
}

function getHeaderValue(headers = {}, name) {
  const lowerName = String(name || "").trim().toLowerCase();
  const raw = headers?.[lowerName] ?? headers?.[name];

  if (Array.isArray(raw)) {
    return cleanText(raw[0], 4096);
  }

  return cleanText(raw, 4096);
}

function extractPatientToken(headers = {}, preferredHeaderName = "X-Care-Nova-Patient-Token") {
  const preferredToken = getHeaderValue(headers, preferredHeaderName);

  if (preferredToken) {
    return preferredToken;
  }

  const fallbackToken = getHeaderValue(headers, "x-patient-token");

  if (fallbackToken) {
    return fallbackToken;
  }

  const authorization = getHeaderValue(headers, "authorization");
  const bearerMatch = authorization.match(/^Bearer\s+(.+)$/i);

  return cleanText(bearerMatch?.[1] || "", 4096);
}

function base64UrlEncode(value) {
  return Buffer.from(String(value), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(value) {
  const padded = String(value)
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(String(value).length / 4) * 4, "=");

  return Buffer.from(padded, "base64").toString("utf8");
}

function signTokenPayload(payload, secret) {
  return createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
}

function safeCompare(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function buildRouteKey(method, path) {
  return `${cleanText(method, 16).toUpperCase() || "GET"} ${cleanText(path, 160) || "/"}`;
}

function isProtectedPatientRoute(method, path) {
  const routeKey = buildRouteKey(method, path);
  return protectedPatientRoutes.some((route) => buildRouteKey(route.method, route.path) === routeKey);
}

export function getEnterpriseProtectedPatientRoutes() {
  return protectedPatientRoutes.map((route) => ({ ...route }));
}

export function getEnterprisePatientAccessProfile(env = process.env) {
  const publicPolicy = getEnterprisePublicDeploymentPolicy(env);
  const required = readBoolean(env.CARE_NOVA_PATIENT_AUTH_REQUIRED) || publicPolicy.publicDeployment;
  const accessSecret = cleanText(env.CARE_NOVA_PATIENT_ACCESS_SECRET, 4096);
  const headerName = normalizeHeaderName(env.CARE_NOVA_PATIENT_HEADER);
  const sessionTtlMinutes = parsePositiveInteger(env.CARE_NOVA_PATIENT_SESSION_TTL_MINUTES, defaultPatientSessionTtlMinutes);

  return {
    status: required
      ? (accessSecret ? "patient-access-required" : "patient-access-misconfigured")
      : (accessSecret ? "patient-access-ready-optional" : "patient-access-optional"),
    required,
    requiredByPublicDeployment: publicPolicy.publicDeployment,
    explicitlyRequired: readBoolean(env.CARE_NOVA_PATIENT_AUTH_REQUIRED),
    patientAccessSecretConfigured: Boolean(accessSecret),
    headerName,
    sessionTtlMinutes,
    protectedRouteCount: protectedPatientRoutes.length,
    protectedRoutes: getEnterpriseProtectedPatientRoutes(),
    summary: {
      required,
      requiredByPublicDeployment: publicPolicy.publicDeployment,
      explicitlyRequired: readBoolean(env.CARE_NOVA_PATIENT_AUTH_REQUIRED),
      patientAccessSecretConfigured: Boolean(accessSecret),
      headerName,
      sessionTtlMinutes,
      protectedRouteCount: protectedPatientRoutes.length
    }
  };
}

export function buildEnterprisePatientAccessToken(actor = {}, env = process.env) {
  const profile = getEnterprisePatientAccessProfile(env);
  const secret = cleanText(env.CARE_NOVA_PATIENT_ACCESS_SECRET, 4096);
  const patientId = normalizePatientId(actor.patientId, "");
  const role = normalizeRole(actor.role, "patient") || "patient";

  if (!secret) {
    return {
      ok: false,
      code: "PATIENT_ACCESS_SECRET_MISSING",
      message: "CARE_NOVA_PATIENT_ACCESS_SECRET must be configured before patient access tokens can be issued."
    };
  }

  if (!patientId) {
    return {
      ok: false,
      code: "PATIENT_ID_REQUIRED",
      message: "A patientId is required before a patient access token can be issued."
    };
  }

  const issuedAtMs = Date.now();
  const expiresAtMs = issuedAtMs + (profile.sessionTtlMinutes * 60 * 1000);
  const payload = {
    v: 1,
    role,
    actorId: cleanText(actor.actorId || patientId, 80) || patientId,
    patientId,
    issuedAt: new Date(issuedAtMs).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString()
  };
  const serializedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = signTokenPayload(serializedPayload, secret);

  return {
    ok: true,
    token: `${serializedPayload}.${signature}`,
    payload
  };
}

export function resolveEnterprisePatientIdentity({ headers = {}, patientId = "", env = process.env } = {}) {
  const normalizedPatientId = normalizePatientId(patientId);
  const adminIdentity = resolveEnterpriseAdminIdentity({ headers, env });

  if (adminIdentity.authenticated && adminIdentity.role === "admin") {
    return {
      authenticated: true,
      authMethod: adminIdentity.authMethod || "admin-token",
      actorId: adminIdentity.actorId || "enterprise-admin",
      role: "admin",
      patientId: normalizedPatientId,
      adminBypass: true
    };
  }

  const profile = getEnterprisePatientAccessProfile(env);
  const secret = cleanText(env.CARE_NOVA_PATIENT_ACCESS_SECRET, 4096);
  const presentedToken = extractPatientToken(headers, profile.headerName);

  if (!secret || !presentedToken) {
    return {
      authenticated: false,
      authMethod: "",
      actorId: "",
      role: "",
      patientId: normalizedPatientId,
      adminBypass: false,
      reason: !presentedToken
        ? `A valid patient access token is required in ${profile.headerName}.`
        : "CARE_NOVA_PATIENT_ACCESS_SECRET is not configured."
    };
  }

  const tokenParts = presentedToken.split(".");

  if (tokenParts.length !== 2) {
    return {
      authenticated: false,
      authMethod: profile.headerName,
      actorId: "",
      role: "",
      patientId: normalizedPatientId,
      adminBypass: false,
      reason: "Patient access token is malformed."
    };
  }

  const [serializedPayload, providedSignature] = tokenParts;
  const expectedSignature = signTokenPayload(serializedPayload, secret);

  if (!safeCompare(providedSignature, expectedSignature)) {
    return {
      authenticated: false,
      authMethod: profile.headerName,
      actorId: "",
      role: "",
      patientId: normalizedPatientId,
      adminBypass: false,
      reason: "Patient access token signature is invalid."
    };
  }

  try {
    const payload = JSON.parse(base64UrlDecode(serializedPayload));
    const expiresAtMs = Date.parse(payload.expiresAt);
    const role = normalizeRole(payload.role, "patient") || "patient";
    const payloadPatientId = normalizePatientId(payload.patientId);

    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
      return {
        authenticated: false,
        authMethod: profile.headerName,
        actorId: cleanText(payload.actorId, 80),
        role,
        patientId: payloadPatientId,
        adminBypass: false,
        reason: "Patient access token has expired."
      };
    }

    if (payloadPatientId !== normalizedPatientId) {
      return {
        authenticated: false,
        authMethod: profile.headerName,
        actorId: cleanText(payload.actorId, 80),
        role,
        patientId: payloadPatientId,
        adminBypass: false,
        reason: `Patient access token is scoped to ${payloadPatientId}, not ${normalizedPatientId}.`
      };
    }

    return {
      authenticated: true,
      authMethod: profile.headerName,
      actorId: cleanText(payload.actorId, 80) || payloadPatientId,
      role,
      patientId: payloadPatientId,
      adminBypass: false,
      issuedAt: cleanText(payload.issuedAt, 80),
      expiresAt: cleanText(payload.expiresAt, 80)
    };
  } catch {
    return {
      authenticated: false,
      authMethod: profile.headerName,
      actorId: "",
      role: "",
      patientId: normalizedPatientId,
      adminBypass: false,
      reason: "Patient access token payload could not be decoded."
    };
  }
}

export function evaluateEnterprisePatientAccess({ method = "GET", path = "", headers = {}, patientId = "", env = process.env } = {}) {
  const normalizedMethod = cleanText(method, 16).toUpperCase() || "GET";
  const normalizedPath = cleanText(path, 160) || "/";
  const normalizedPatientId = normalizePatientId(patientId);
  const profile = getEnterprisePatientAccessProfile(env);

  if (!isProtectedPatientRoute(normalizedMethod, normalizedPath)) {
    return {
      allowed: true,
      applicable: false,
      policy: "not-applicable",
      detail: "Route is not part of the protected patient-data surface.",
      patientId: normalizedPatientId,
      accessProfile: profile.summary
    };
  }

  if (!profile.required) {
    return {
      allowed: true,
      applicable: true,
      policy: profile.status,
      detail: "Patient-scoped access remains optional in this runtime.",
      patientId: normalizedPatientId,
      accessProfile: profile.summary
    };
  }

  if (!profile.patientAccessSecretConfigured) {
    return {
      allowed: false,
      applicable: true,
      statusCode: 503,
      code: "PATIENT_ACCESS_NOT_CONFIGURED",
      policy: profile.status,
      detail: "Shared or public patient-data routes require CARE_NOVA_PATIENT_ACCESS_SECRET before traffic is accepted.",
      patientId: normalizedPatientId,
      accessProfile: profile.summary
    };
  }

  const identity = resolveEnterprisePatientIdentity({ headers, patientId: normalizedPatientId, env });

  if (!identity.authenticated) {
    return {
      allowed: false,
      applicable: true,
      statusCode: 403,
      code: "PATIENT_ACCESS_REQUIRED",
      policy: profile.status,
      detail: identity.reason || `A valid patient access token is required in ${profile.headerName}.`,
      patientId: normalizedPatientId,
      accessProfile: profile.summary,
      identity
    };
  }

  return {
    allowed: true,
    applicable: true,
    policy: profile.status,
    detail: identity.adminBypass
      ? "Patient-scoped route accepted through enterprise admin override."
      : `Patient-scoped route accepted for ${normalizedPatientId}.`,
    patientId: normalizedPatientId,
    accessProfile: profile.summary,
    identity
  };
}
