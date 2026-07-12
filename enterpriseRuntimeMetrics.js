const defaultMaxRecentErrors = 50;
const routeMetricLimit = 20;

const metricsState = {
  startedAt: new Date().toISOString(),
  totalRequests: 0,
  totalErrors: 0,
  totalBlocked: 0,
  totalDurationMs: 0,
  maxDurationMs: 0,
  byMethod: new Map(),
  byStatusFamily: new Map(),
  byRoute: new Map(),
  recentErrors: []
};

function cleanText(value) {
  return String(value ?? "").trim();
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(cleanText(value), 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function incrementMetric(map, key, delta = 1) {
  map.set(key, Number(map.get(key) || 0) + delta);
}

function toSortedEntries(map) {
  return [...map.entries()]
    .map(([key, value]) => ({ key, value }))
    .sort((left, right) => right.value - left.value);
}

function getStatusFamily(statusCode) {
  const family = Math.floor(Number(statusCode || 0) / 100);

  if (family >= 1 && family <= 5) {
    return `${family}xx`;
  }

  return "unknown";
}

function buildRouteKey({ method = "GET", path = "/" } = {}) {
  return `${cleanText(method).toUpperCase() || "GET"} ${cleanText(path) || "/"}`;
}

export function recordEnterpriseRuntimeMetric({ requestContext = {}, statusCode = 200, durationMs = 0 } = {}, env = process.env) {
  metricsState.totalRequests += 1;
  metricsState.totalDurationMs += Math.max(0, Number(durationMs || 0));
  metricsState.maxDurationMs = Math.max(metricsState.maxDurationMs, Math.max(0, Number(durationMs || 0)));

  const method = cleanText(requestContext.method).toUpperCase() || "GET";
  const path = cleanText(requestContext.path) || "/";
  const routeKey = buildRouteKey({ method, path });
  const statusFamily = getStatusFamily(statusCode);

  incrementMetric(metricsState.byMethod, method);
  incrementMetric(metricsState.byStatusFamily, statusFamily);
  incrementMetric(metricsState.byRoute, routeKey);

  if (Number(statusCode || 0) >= 400) {
    metricsState.totalErrors += 1;
  }

  if ([403, 429, 503].includes(Number(statusCode || 0))) {
    metricsState.totalBlocked += 1;
  }

  if (Number(statusCode || 0) >= 400) {
    const maxRecentErrors = parsePositiveInteger(env.CARE_NOVA_METRICS_MAX_ERRORS, defaultMaxRecentErrors);
    metricsState.recentErrors.unshift({
      at: new Date().toISOString(),
      requestId: cleanText(requestContext.id),
      method,
      path,
      statusCode: Number(statusCode || 0),
      durationMs: Math.max(0, Number(durationMs || 0))
    });
    metricsState.recentErrors = metricsState.recentErrors.slice(0, maxRecentErrors);
  }
}

export function getEnterpriseRuntimeMetricsSnapshot(env = process.env) {
  const averageDurationMs = metricsState.totalRequests
    ? Math.round(metricsState.totalDurationMs / metricsState.totalRequests)
    : 0;

  return {
    ok: true,
    status: "runtime-metrics-ready",
    summary: {
      startedAt: metricsState.startedAt,
      totalRequests: metricsState.totalRequests,
      totalErrors: metricsState.totalErrors,
      totalBlocked: metricsState.totalBlocked,
      errorRatePercent: metricsState.totalRequests
        ? Number(((metricsState.totalErrors / metricsState.totalRequests) * 100).toFixed(2))
        : 0,
      averageDurationMs,
      maxDurationMs: metricsState.maxDurationMs,
      trackedRouteCount: metricsState.byRoute.size,
      maxRecentErrors: parsePositiveInteger(env.CARE_NOVA_METRICS_MAX_ERRORS, defaultMaxRecentErrors)
    },
    byMethod: toSortedEntries(metricsState.byMethod),
    byStatusFamily: toSortedEntries(metricsState.byStatusFamily),
    topRoutes: toSortedEntries(metricsState.byRoute).slice(0, routeMetricLimit).map((item) => ({
      route: item.key,
      hits: item.value
    })),
    recentErrors: metricsState.recentErrors,
    notes: [
      "Metrics are process-local and reset when the server restarts.",
      "Use runtime metrics together with the persistent audit log for enterprise incident review."
    ],
    timestamp: new Date().toISOString()
  };
}
