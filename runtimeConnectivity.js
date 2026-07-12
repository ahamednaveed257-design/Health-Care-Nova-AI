export function getConnectivityPolicy(env = process.env, { routingPolicy = "" } = {}) {
  const normalizedRoutingPolicy = cleanText(routingPolicy || env.CARE_NOVA_MODEL_ROUTING_POLICY).toLowerCase();
  const forceOffline = readBoolean(env.CARE_NOVA_FORCE_OFFLINE)
    || readBoolean(env.CARE_NOVA_OFFLINE_ONLY)
    || normalizedRoutingPolicy === "offline-only";
  const internetAvailable = !forceOffline && readBooleanDefault(env.CARE_NOVA_INTERNET_AVAILABLE, true);
  const onlineModeAllowed = !forceOffline && readBooleanDefault(env.CARE_NOVA_ONLINE_MODE, false);

  return {
    routingPolicy: normalizedRoutingPolicy,
    forceOffline,
    internetAvailable,
    onlineModeAllowed,
    networkAllowed: !forceOffline && internetAvailable
  };
}

export function isEndpointUsableForThisRun(value, env = process.env, options = {}) {
  const connectivity = options.connectivity || getConnectivityPolicy(env, options);
  return isLocalEndpoint(value) || connectivity.networkAllowed;
}

export function isLocalEndpoint(value) {
  const endpoint = cleanText(value);

  if (!endpoint) {
    return false;
  }

  if (endpoint.toLowerCase().startsWith("file:")) {
    return true;
  }

  try {
    const parsed = new URL(endpoint);
    return isLocalHostname(parsed.hostname);
  } catch {
    const lowered = endpoint.toLowerCase();

    return isLocalHostname(lowered)
      || lowered.includes("localhost")
      || lowered.includes("127.0.0.1")
      || lowered.includes("0.0.0.0")
      || lowered.includes("host.docker.internal");
  }
}

function isLocalHostname(value) {
  const hostname = cleanText(value).toLowerCase().replace(/^\[|\]$/g, "");

  return Boolean(hostname) && (
    hostname === "localhost"
    || hostname === "127.0.0.1"
    || hostname === "0.0.0.0"
    || hostname === "::1"
    || hostname === "host.docker.internal"
    || /^10\./.test(hostname)
    || /^192\.168\./.test(hostname)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
  );
}

function readBoolean(value) {
  return /^(1|true|yes|on)$/i.test(cleanText(value));
}

function readBooleanDefault(value, defaultValue = false) {
  const cleaned = cleanText(value);

  if (!cleaned) {
    return defaultValue;
  }

  return /^(1|true|yes|on)$/i.test(cleaned);
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
