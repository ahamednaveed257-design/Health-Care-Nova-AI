import { createHmac, timingSafeEqual } from "node:crypto";
import { getEnterprisePublicDeploymentPolicy } from "./enterprisePublicPolicy.js";

const adminProtectedRoutes = Object.freeze([
  "/api/admin-policy",
  "/api/admin-secret-posture",
  "/api/admin-trust-center",
  "/api/data-retention-policy",
  "/api/incident-posture",
  "/api/recovery-posture",
  "/api/admin-review-packet",
  "/api/admin-release-snapshot",
  "/api/admin-review-history",
  "/api/audit-events",
  "/api/backup-plan",
  "/api/config-readiness",
  "/api/external-knowledge/clear",
  "/api/local-data-mirror",
  "/api/runtime-metrics",
  "/api/startup-readiness",
  "/api/storage-integrity",
  "/api/training/evaluate",
  "/api/training/train"
]);

const defaultSessionTtlMinutes = 8 * 60;
const supportedEnterpriseRoles = Object.freeze(["reviewer", "admin"]);

function cleanText(value) {
  return String(value ?? "").trim();
}

function readBoolean(value) {
  return /^(1|true|yes|on)$/i.test(cleanText(value));
}

function normalizeHeaderName(value) {
  const normalized = cleanText(value)
    .replace(/[^a-zA-Z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return normalized || "X-Care-Nova-Admin-Token";
}

function normalizeCookieName(value) {
  const normalized = cleanText(value)
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized || "care_nova_admin_session";
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(cleanText(value), 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function safeHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
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

function normalizeRole(value, fallback = "") {
  const normalized = cleanText(value).toLowerCase();
  return supportedEnterpriseRoles.includes(normalized) ? normalized : fallback;
}

function getRoleRank(role) {
  return role === "admin" ? 2 : role === "reviewer" ? 1 : 0;
}

function hasRequiredRole(role, requiredRole) {
  return getRoleRank(role) >= getRoleRank(requiredRole);
}

function parseCookieHeader(cookieHeader = "") {
  return String(cookieHeader)
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const index = part.indexOf("=");

      if (index === -1) {
        return cookies;
      }

      const key = part.slice(0, index).trim();
      const value = part.slice(index + 1).trim();

      if (key) {
        cookies[key] = decodeURIComponent(value);
      }

      return cookies;
    }, {});
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

export function getEnterpriseAdminProtectedRoutes() {
  return [...adminProtectedRoutes];
}

export function getEnterpriseAdminAuthProfile(env = process.env) {
  const publicPolicy = getEnterprisePublicDeploymentPolicy(env);
  const required = publicPolicy.effectiveAdminAuthRequired;
  const adminToken = cleanText(env.CARE_NOVA_ADMIN_API_TOKEN);
  const reviewerToken = cleanText(env.CARE_NOVA_REVIEWER_API_TOKEN);
  const sessionSecret = cleanText(env.CARE_NOVA_ADMIN_SESSION_SECRET);
  const adminHeaderName = normalizeHeaderName(env.CARE_NOVA_ADMIN_HEADER);
  const cookieName = normalizeCookieName(env.CARE_NOVA_ADMIN_COOKIE_NAME);
  const sessionTtlMinutes = parsePositiveInteger(env.CARE_NOVA_ADMIN_SESSION_TTL_MINUTES, defaultSessionTtlMinutes);
  const secureCookie = publicPolicy.effectiveSecureCookie;

  return {
    status: required
      ? (adminToken && sessionSecret ? "admin-auth-required" : "admin-auth-misconfigured")
      : (adminToken && sessionSecret ? "admin-auth-ready-optional" : "admin-auth-optional"),
    required,
    explicitlyRequired: publicPolicy.explicitAdminAuthRequired,
    requiredByPublicDeployment: publicPolicy.adminAuthRequiredByPublicPolicy,
    adminTokenConfigured: Boolean(adminToken),
    reviewerTokenConfigured: Boolean(reviewerToken),
    sessionSecretConfigured: Boolean(sessionSecret),
    adminHeaderName,
    cookieName,
    sessionTtlMinutes,
    secureCookie,
    protectedRouteCount: adminProtectedRoutes.length,
    protectedRoutes: [...adminProtectedRoutes],
    summary: {
      required,
      explicitlyRequired: publicPolicy.explicitAdminAuthRequired,
      requiredByPublicDeployment: publicPolicy.adminAuthRequiredByPublicPolicy,
      adminTokenConfigured: Boolean(adminToken),
      reviewerTokenConfigured: Boolean(reviewerToken),
      sessionSecretConfigured: Boolean(sessionSecret),
      adminHeaderName,
      cookieName,
      sessionTtlMinutes,
      secureCookie,
      protectedRouteCount: adminProtectedRoutes.length,
      supportedRoles: Boolean(reviewerToken) ? [...supportedEnterpriseRoles] : ["admin"]
    }
  };
}

export function buildEnterpriseAdminSession(actor = {}, env = process.env) {
  const profile = getEnterpriseAdminAuthProfile(env);
  const secret = cleanText(env.CARE_NOVA_ADMIN_SESSION_SECRET);
  const role = normalizeRole(actor.role, "admin") || "admin";

  if (!secret) {
    return {
      ok: false,
      code: "ADMIN_SESSION_SECRET_MISSING",
      message: "CARE_NOVA_ADMIN_SESSION_SECRET must be configured before admin sessions can be issued."
    };
  }

  const issuedAtMs = Date.now();
  const expiresAtMs = issuedAtMs + (profile.sessionTtlMinutes * 60 * 1000);
  const payload = {
    v: 1,
    role,
    actorId: cleanText(actor.actorId) || "enterprise-admin",
    issuedAt: new Date(issuedAtMs).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString()
  };
  const serializedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = signTokenPayload(serializedPayload, secret);
  const token = `${serializedPayload}.${signature}`;

  return {
    ok: true,
    token,
    payload,
    cookie: buildEnterpriseAdminSessionCookie(token, env)
  };
}

export function buildEnterpriseAdminSessionCookie(token, env = process.env) {
  const profile = getEnterpriseAdminAuthProfile(env);
  const cookieParts = [
    `${profile.cookieName}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${profile.sessionTtlMinutes * 60}`
  ];

  if (profile.secureCookie) {
    cookieParts.push("Secure");
  }

  return cookieParts.join("; ");
}

export function buildEnterpriseAdminSessionClearCookie(env = process.env) {
  const profile = getEnterpriseAdminAuthProfile(env);
  const cookieParts = [
    `${profile.cookieName}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=0"
  ];

  if (profile.secureCookie) {
    cookieParts.push("Secure");
  }

  return cookieParts.join("; ");
}

export function resolveEnterpriseAdminIdentity({ headers = {}, env = process.env } = {}) {
  const profile = getEnterpriseAdminAuthProfile(env);
  const configuredToken = cleanText(env.CARE_NOVA_ADMIN_API_TOKEN);
  const configuredReviewerToken = cleanText(env.CARE_NOVA_REVIEWER_API_TOKEN);
  const presentedToken = extractAdminToken(headers, profile.adminHeaderName);

  if (configuredToken && presentedToken && safeCompare(presentedToken, configuredToken)) {
    return {
      authenticated: true,
      authMethod: "admin-token",
      actorId: "admin-token",
      role: "admin",
      session: false
    };
  }

  if (configuredReviewerToken && presentedToken && safeCompare(presentedToken, configuredReviewerToken)) {
    return {
      authenticated: true,
      authMethod: "reviewer-token",
      actorId: "reviewer-token",
      role: "reviewer",
      session: false
    };
  }

  const secret = cleanText(env.CARE_NOVA_ADMIN_SESSION_SECRET);
  const cookies = parseCookieHeader(getHeaderValue(headers, "cookie"));
  const sessionToken = cleanText(cookies[profile.cookieName]);

  if (!secret || !sessionToken) {
    return {
      authenticated: false,
      authMethod: "",
      actorId: "",
      role: "",
      session: false,
      reason: sessionToken && !secret
        ? "Admin session cookie is present, but CARE_NOVA_ADMIN_SESSION_SECRET is not configured."
        : "No valid admin token or session was provided."
    };
  }

  const tokenParts = sessionToken.split(".");

  if (tokenParts.length !== 2) {
    return {
      authenticated: false,
      authMethod: "cookie-session",
      actorId: "",
      role: "",
      session: true,
      reason: "Admin session cookie is malformed."
    };
  }

  const [serializedPayload, providedSignature] = tokenParts;
  const expectedSignature = signTokenPayload(serializedPayload, secret);

  if (!safeCompare(providedSignature, expectedSignature)) {
    return {
      authenticated: false,
      authMethod: "cookie-session",
      actorId: "",
      role: "",
      session: true,
      reason: "Admin session cookie signature is invalid."
    };
  }

  try {
    const payload = JSON.parse(base64UrlDecode(serializedPayload));
    const expiresAtMs = Date.parse(payload.expiresAt);

    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
      return {
        authenticated: false,
        authMethod: "cookie-session",
        actorId: "",
        role: "",
        session: true,
        reason: "Admin session cookie has expired."
      };
    }

    const role = normalizeRole(payload.role);

    if (!role) {
      return {
        authenticated: false,
        authMethod: "cookie-session",
        actorId: cleanText(payload.actorId),
        role: cleanText(payload.role),
        session: true,
        reason: "Admin session cookie does not carry a supported enterprise role."
      };
    }

    return {
      authenticated: true,
      authMethod: "cookie-session",
      actorId: cleanText(payload.actorId) || "enterprise-admin",
      role,
      session: true,
      expiresAt: payload.expiresAt,
      issuedAt: payload.issuedAt
    };
  } catch {
    return {
      authenticated: false,
      authMethod: "cookie-session",
      actorId: "",
      role: "",
      session: true,
      reason: "Admin session cookie payload could not be decoded."
    };
  }
}

export function evaluateEnterpriseAdminAccess({ method = "GET", path = "", headers = {}, env = process.env } = {}) {
  const normalizedPath = cleanText(path) || "/";
  const normalizedMethod = cleanText(method).toUpperCase() || "GET";
  const profile = getEnterpriseAdminAuthProfile(env);
  const requiredRole = normalizedMethod === "GET" ? "reviewer" : "admin";

  if (!adminProtectedRoutes.includes(normalizedPath)) {
    return {
      allowed: true,
      applicable: false,
      policy: "not-applicable",
      detail: "Route is not part of the protected enterprise admin surface.",
      authProfile: profile.summary,
      requiredRole
    };
  }

  if (!profile.required) {
    return {
      allowed: true,
      applicable: true,
      policy: profile.status,
      detail: "Admin-protected route is available because admin auth is optional in this runtime.",
      authProfile: profile.summary,
      identity: resolveEnterpriseAdminIdentity({ headers, env }),
      requiredRole
    };
  }

  if (!profile.adminTokenConfigured || !profile.sessionSecretConfigured) {
    return {
      allowed: false,
      applicable: true,
      statusCode: 503,
      code: "ADMIN_AUTH_NOT_CONFIGURED",
      policy: profile.status,
      detail: "CARE_NOVA_ADMIN_AUTH_REQUIRED is enabled, but CARE_NOVA_ADMIN_API_TOKEN or CARE_NOVA_ADMIN_SESSION_SECRET is missing.",
      authProfile: profile.summary,
      requiredRole
    };
  }

  const identity = resolveEnterpriseAdminIdentity({ headers, env });

  if (!identity.authenticated) {
    return {
      allowed: false,
      applicable: true,
      statusCode: 403,
      code: "ADMIN_AUTH_REQUIRED",
      policy: profile.status,
      detail: identity.reason || "A valid admin token or admin session cookie is required for this endpoint.",
      authProfile: profile.summary,
      identity,
      requiredRole
    };
  }

  if (!hasRequiredRole(identity.role, requiredRole)) {
    return {
      allowed: false,
      applicable: true,
      statusCode: 403,
      code: "ADMIN_ROLE_REQUIRED",
      policy: profile.status,
      detail: `This endpoint requires the ${requiredRole} role. Current role: ${identity.role || "none"}.`,
      authProfile: profile.summary,
      identity,
      requiredRole
    };
  }

  return {
    allowed: true,
    applicable: true,
    policy: profile.status,
    detail: `Admin access granted by ${identity.authMethod}.`,
    authProfile: profile.summary,
    identity,
    requiredRole
  };
}

export function getEnterpriseAdminAuthGuide(env = process.env) {
  const profile = getEnterpriseAdminAuthProfile(env);

  return {
    status: "enterprise-admin-auth-ready",
    summary: {
      required: profile.required,
      adminTokenConfigured: profile.adminTokenConfigured,
      reviewerTokenConfigured: profile.reviewerTokenConfigured,
      sessionSecretConfigured: profile.sessionSecretConfigured,
      protectedRouteCount: profile.protectedRouteCount,
      cookieName: profile.cookieName,
      cookieSecure: profile.secureCookie,
      supportedRoles: profile.summary.supportedRoles
    },
    protectedRoutes: profile.protectedRoutes,
    loginFlow: [
      `Send the enterprise token in ${profile.adminHeaderName}, X-Admin-Token, Authorization: Bearer <token>, or a JSON body field named token to POST /api/admin/session.`,
      "The server issues an HttpOnly enterprise session cookie carrying either reviewer or admin role.",
      "Use DELETE /api/admin/session to clear the admin session cookie."
    ],
    requirements: [
      "Set CARE_NOVA_ADMIN_AUTH_REQUIRED=true for shared enterprise deployments.",
      "Set CARE_NOVA_ADMIN_API_TOKEN in a secret store.",
      "Optionally set CARE_NOVA_REVIEWER_API_TOKEN for read-only reviewer access.",
      "Set CARE_NOVA_ADMIN_SESSION_SECRET in a secret store.",
      "Keep admin session cookies same-origin and behind HTTPS for public deployments."
    ],
    boundary: "Admin auth protects deployment owner endpoints and does not change patient-care safety boundaries."
  };
}

export function getEnterpriseAdminSessionSnapshot({ headers = {}, env = process.env } = {}) {
  const profile = getEnterpriseAdminAuthProfile(env);
  const identity = resolveEnterpriseAdminIdentity({ headers, env });

  return {
    ok: true,
    status: identity.authenticated ? "admin-session-active" : "admin-session-inactive",
    auth: {
      ...profile.summary,
      protectedRoutes: profile.protectedRoutes
    },
    identity: {
      authenticated: identity.authenticated === true,
      authMethod: identity.authMethod || "",
      actorId: identity.actorId || "",
      role: identity.role || "",
      session: identity.session === true,
      expiresAt: identity.expiresAt || ""
    },
    timestamp: new Date().toISOString()
  };
}
