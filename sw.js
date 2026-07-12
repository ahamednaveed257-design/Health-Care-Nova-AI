const APP_VERSION = "5.0.358";
const CACHE_NAME = "care-nova-ai-v5.0.358";
const assetPath = (path) => new URL(path, self.location.href).href;
const APP_SHELL = [
  assetPath("./"),
  assetPath("styles.css?v=5.0.358"),
  assetPath("calm-theme.css?v=5.0.358"),
  assetPath("visual-polish.css?v=5.0.358"),
  assetPath("app.js?v=5.0.358"),
  assetPath("favicon.svg"),
  assetPath("app-icon.svg"),
  assetPath("media/care-nova-guide-poster.svg"),
  assetPath("version.json"),
  assetPath("site.webmanifest"),
  assetPath("robots.txt")
];
const OFFLINE_FOUNDATION_ASSETS = [
  new URL("/api/health", self.location.origin).href,
  new URL("/api/readiness", self.location.origin).href,
  new URL("/api/training-readiness", self.location.origin).href,
  new URL("/api/knowledge", self.location.origin).href,
  new URL("/api/local-ai", self.location.origin).href,
  new URL("/api/model", self.location.origin).href,
  new URL("/api/agentic-runtime", self.location.origin).href,
  new URL("/api/model-router", self.location.origin).href
];
const READ_ONLY_API_PATHS = new Set([
  "/api/health",
  "/api/readiness",
  "/api/training-readiness",
  "/api/knowledge",
  "/api/local-ai",
  "/api/model",
  "/api/agentic-runtime",
  "/api/model-router"
]);
const CRITICAL_ASSET_PATTERN = /\.(?:html|css|js|json|webmanifest)$/i;
const STREAMING_ASSET_PATTERN = /\.(?:webm|m3u8|mpd|m4s|ts)$/i;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(async (cache) => {
        await cache.addAll(APP_SHELL);
        await cacheOfflineFoundation(cache);
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key !== CACHE_NAME)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") {
    return;
  }

  const requestUrl = new URL(request.url);

  if (requestUrl.origin !== self.location.origin) {
    return;
  }

  if (requestUrl.pathname.startsWith("/api/")) {
    event.respondWith(
      READ_ONLY_API_PATHS.has(requestUrl.pathname)
        ? apiReadonlyNetworkFirst(request)
        : apiNetworkOnly(request)
    );
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(navigationNetworkFirst(request));
    return;
  }

  if (STREAMING_ASSET_PATTERN.test(requestUrl.pathname)) {
    event.respondWith(mediaNetworkOnly(request));
    return;
  }

  if (isCriticalAssetRequest(requestUrl)) {
    event.respondWith(staticNetworkFirst(request));
    return;
  }

  event.respondWith(staticStaleWhileRevalidate(request));
});

function isLoopbackHostname(hostname = "") {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1" || hostname === "[::1]";
}

async function navigationNetworkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cachedShell = await cache.match(assetPath("./"));
  const requestUrl = new URL(request.url);
  const localRequest = isLoopbackHostname(requestUrl.hostname);

  if (!localRequest && self.navigator?.onLine === false && cachedShell) {
    return cachedShell;
  }

  try {
    const response = await fetch(createFreshRequest(request));

    if (response.ok) {
      cache.put(assetPath("./"), response.clone());
    }

    return response;
  } catch {
    return cachedShell || Response.error();
  }
}

function isCriticalAssetRequest(requestUrl) {
  return requestUrl.pathname === "/"
    || requestUrl.pathname.endsWith("/")
    || CRITICAL_ASSET_PATTERN.test(requestUrl.pathname);
}

function createFreshRequest(request) {
  return new Request(request, { cache: "reload" });
}

async function cacheOfflineFoundation(cache) {
  await Promise.allSettled(
    OFFLINE_FOUNDATION_ASSETS.map(async (assetUrl) => {
      const response = await fetch(assetUrl, { cache: "reload" });

      if (response.ok) {
        await cache.put(assetUrl, response.clone());
      }
    })
  );
}

async function staticNetworkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  try {
    const response = await fetch(createFreshRequest(request));

    if (response.ok) {
      cache.put(request, response.clone());
    }

    return response;
  } catch {
    return cached || Response.error();
  }
}

async function staticStaleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const requestUrl = new URL(request.url);
  const localRequest = isLoopbackHostname(requestUrl.hostname);

  if (localRequest) {
    try {
      const response = await fetch(request);

      if (response.ok) {
        cache.put(request, response.clone());
      }

      return response;
    } catch {
      return cached || Response.error();
    }
  }

  if (self.navigator?.onLine === false && cached) {
    return cached;
  }

  const fresh = fetch(request)
    .then((response) => {
      if (response.ok) {
        cache.put(request, response.clone());
      }

      return response;
    })
    .catch(() => cached);

  return cached || fresh;
}

async function apiNetworkOnly(request) {
  const requestUrl = new URL(request.url);

  if (self.navigator?.onLine === false && !isLoopbackHostname(requestUrl.hostname)) {
    return createOfflineApiResponse();
  }

  try {
    return await fetch(request);
  } catch {
    return createOfflineApiResponse();
  }
}

async function apiReadonlyNetworkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const requestUrl = new URL(request.url);

  if (self.navigator?.onLine === false && !isLoopbackHostname(requestUrl.hostname) && cached) {
    return cached;
  }

  try {
    const response = await fetch(request);

    if (response.ok) {
      cache.put(request, response.clone());
    }

    return response;
  } catch {
    return cached || createOfflineApiResponse();
  }
}

function createOfflineApiResponse() {
  return new Response(JSON.stringify({
    ok: false,
    code: "OFFLINE_APP_SHELL",
    message: "Care Nova AI is installed and the app shell is available. The browser runtime can continue locally; start the local server for filesystem memory, OneDrive mirror, and full API storage."
  }), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Care-Nova-Offline": "true"
    }
  });
}

async function mediaNetworkOnly(request) {
  const requestUrl = new URL(request.url);

  if (self.navigator?.onLine === false && !isLoopbackHostname(requestUrl.hostname)) {
    return new Response("", {
      status: 204,
      statusText: "Media unavailable while offline"
    });
  }

  try {
    return await fetch(request);
  } catch {
    return new Response("", {
      status: 204,
      statusText: "Media unavailable while offline"
    });
  }
}
