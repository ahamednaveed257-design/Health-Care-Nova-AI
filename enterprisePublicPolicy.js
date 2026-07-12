function cleanText(value) {
  return String(value ?? "").trim();
}

function readBoolean(value) {
  return /^(1|true|yes|on)$/i.test(cleanText(value));
}

function getHeaderValue(headers = {}, name) {
  const lowerName = String(name || "").trim().toLowerCase();
  const raw = headers?.[lowerName] ?? headers?.[name];

  if (Array.isArray(raw)) {
    return cleanText(raw[0]);
  }

  return cleanText(raw);
}

function normalizeOrigin(value) {
  const raw = cleanText(value);

  if (!raw) {
    return "";
  }

  if (raw.toLowerCase() === "null") {
    return "null";
  }

  try {
    const parsed = new URL(raw);
    return `${parsed.protocol}//${parsed.host}`.toLowerCase();
  } catch {
    return "";
  }
}

function isLoopbackHostname(value) {
  const normalized = cleanText(value)
    .replace(/^\[(.*)\]$/, "$1")
    .toLowerCase();

  return normalized === "127.0.0.1"
    || normalized === "localhost"
    || normalized === "::1"
    || normalized === "0:0:0:0:0:0:0:1";
}

function isLoopbackOrigin(value) {
  const normalizedOrigin = normalizeOrigin(value);

  if (!normalizedOrigin) {
    return false;
  }

  try {
    const parsed = new URL(normalizedOrigin);
    return isLoopbackHostname(parsed.hostname);
  } catch {
    return false;
  }
}

function resolveRequestProtocol(headers = {}, env = process.env) {
  const trustProxy = readBoolean(env.CARE_NOVA_TRUST_PROXY);
  const forwardedProto = trustProxy ? getHeaderValue(headers, "x-forwarded-proto") : "";
  const candidate = cleanText(forwardedProto).split(",")[0]?.trim().toLowerCase() || "";

  if (candidate === "https" || candidate === "https:") {
    return "https:";
  }

  if (candidate === "http" || candidate === "http:") {
    return "http:";
  }

  if (readBoolean(env.ENABLE_HSTS) || readBoolean(env.CARE_NOVA_PUBLIC_DEPLOYMENT)) {
    return "https:";
  }

  return "http:";
}

export function getRequestOriginFromHeaders(headers = {}, env = process.env) {
  const trustProxy = readBoolean(env.CARE_NOVA_TRUST_PROXY);
  const forwardedHost = trustProxy ? getHeaderValue(headers, "x-forwarded-host") : "";
  const host = cleanText(forwardedHost || getHeaderValue(headers, "host"));

  if (!host) {
    return "";
  }

  return `${resolveRequestProtocol(headers, env)}//${host}`.toLowerCase();
}

export function isLoopbackHealthProbeRequest({ headers = {}, path = "", env = process.env } = {}) {
  const normalizedPath = cleanText(path) || "/";

  if (normalizedPath !== "/api/health") {
    return false;
  }

  if (readBoolean(env.CARE_NOVA_PUBLIC_DEPLOYMENT)) {
    return false;
  }

  const requestOrigin = getRequestOriginFromHeaders(headers, env);
  return isLoopbackOrigin(requestOrigin);
}

export function getEnterprisePublicDeploymentPolicy(env = process.env) {
  const publicDeployment = readBoolean(env.CARE_NOVA_PUBLIC_DEPLOYMENT);
  const productionMode = cleanText(env.NODE_ENV).toLowerCase() === "production";
  const allowedOrigin = cleanText(env.ALLOWED_ORIGIN);
  const normalizedAllowedOrigin = normalizeOrigin(allowedOrigin);
  const frameAncestors = cleanText(env.FRAME_ANCESTORS) || "'self'";
  const strictTransportSecurity = readBoolean(env.ENABLE_HSTS);
  const trustProxy = readBoolean(env.CARE_NOVA_TRUST_PROXY);
  const accessLogging = readBoolean(env.CARE_NOVA_ACCESS_LOG);
  const explicitAdminAuthRequired = readBoolean(env.CARE_NOVA_ADMIN_AUTH_REQUIRED);
  const explicitMutationProtectionRequired = readBoolean(env.CARE_NOVA_REQUIRE_ADMIN_FOR_MUTATIONS);
  const explicitSecureCookie = readBoolean(env.CARE_NOVA_ADMIN_COOKIE_SECURE);
  const adminTokenConfigured = Boolean(cleanText(env.CARE_NOVA_ADMIN_API_TOKEN));
  const reviewerTokenConfigured = Boolean(cleanText(env.CARE_NOVA_REVIEWER_API_TOKEN));
  const sessionSecretConfigured = Boolean(cleanText(env.CARE_NOVA_ADMIN_SESSION_SECRET));
  const effectiveAdminAuthRequired = explicitAdminAuthRequired || publicDeployment;
  const effectiveMutationProtectionRequired = explicitMutationProtectionRequired || publicDeployment;
  const adminAuthRequiredByPublicPolicy = publicDeployment && !explicitAdminAuthRequired;
  const mutationProtectionRequiredByPublicPolicy = publicDeployment && !explicitMutationProtectionRequired;
  const secureCookieRequiredByPublicPolicy = publicDeployment && !explicitSecureCookie;
  const effectiveSecureCookie = explicitSecureCookie || strictTransportSecurity || publicDeployment;

  return {
    publicDeployment,
    productionMode,
    allowedOrigin,
    normalizedAllowedOrigin,
    frameAncestors,
    strictTransportSecurity,
    trustProxy,
    accessLogging,
    explicitAdminAuthRequired,
    explicitMutationProtectionRequired,
    explicitSecureCookie,
    adminTokenConfigured,
    reviewerTokenConfigured,
    sessionSecretConfigured,
    effectiveAdminAuthRequired,
    effectiveMutationProtectionRequired,
    effectiveSecureCookie,
    adminAuthRequiredByPublicPolicy,
    mutationProtectionRequiredByPublicPolicy,
    secureCookieRequiredByPublicPolicy
  };
}

export function evaluateEnterpriseApiOriginAccess({ headers = {}, path = "", env = process.env } = {}) {
  const normalizedPath = cleanText(path) || "/";

  if (!normalizedPath.startsWith("/api/")) {
    return {
      allowed: true,
      applicable: false,
      policy: "not-applicable",
      detail: "Route is not part of the API surface."
    };
  }

  const publicPolicy = getEnterprisePublicDeploymentPolicy(env);
  const origin = normalizeOrigin(getHeaderValue(headers, "origin"));
  const loopbackHealthProbe = isLoopbackHealthProbeRequest({
    headers,
    path: normalizedPath,
    env
  });

  if (!origin) {
    return {
      allowed: true,
      applicable: false,
      policy: loopbackHealthProbe
        ? "loopback-health-probe"
        : publicPolicy.normalizedAllowedOrigin
          ? "restricted-origin"
          : "same-origin-only",
      detail: loopbackHealthProbe
        ? "Loopback health probes are allowed without a browser Origin header."
        : "Request did not include a browser Origin header."
    };
  }

  if (loopbackHealthProbe) {
    return {
      allowed: true,
      applicable: true,
      policy: "loopback-health-probe",
      detail: origin === "null"
        ? "Opaque browser origins may probe the loopback Care Nova health route."
        : `Origin ${origin} may probe the loopback Care Nova health route.`
    };
  }

  if (origin === "null") {
    return {
      allowed: false,
      applicable: true,
      statusCode: 403,
      code: "ORIGIN_NOT_ALLOWED",
      policy: publicPolicy.normalizedAllowedOrigin ? "restricted-origin" : "same-origin-only",
      detail: "Opaque browser origins are not allowed for Care Nova API routes.",
      allowedOrigin: publicPolicy.allowedOrigin
    };
  }

  if (publicPolicy.normalizedAllowedOrigin) {
    if (origin === publicPolicy.normalizedAllowedOrigin) {
      return {
        allowed: true,
        applicable: true,
        policy: "restricted-origin",
        detail: `Origin ${origin} matches the configured allowlist.`
      };
    }

    return {
      allowed: false,
      applicable: true,
      statusCode: 403,
      code: "ORIGIN_NOT_ALLOWED",
      policy: "restricted-origin",
      detail: `Origin ${origin} is not allowed. Configure browser API access through ALLOWED_ORIGIN.`,
      allowedOrigin: publicPolicy.allowedOrigin
    };
  }

  const requestOrigin = getRequestOriginFromHeaders(headers, env);

  if (requestOrigin && origin === requestOrigin) {
    return {
      allowed: true,
      applicable: true,
      policy: "same-origin-only",
      detail: `Origin ${origin} matches the current Care Nova origin.`
    };
  }

  return {
    allowed: false,
    applicable: true,
    statusCode: 403,
    code: "ORIGIN_NOT_ALLOWED",
    policy: "same-origin-only",
    detail: "Cross-origin API access is blocked until ALLOWED_ORIGIN is explicitly configured.",
    allowedOrigin: ""
  };
}
