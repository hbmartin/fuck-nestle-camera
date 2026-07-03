// Service worker that caches the large OCR assets (WASM binary, .rten
// models, brand list) so repeat visits load instantly and the app keeps
// working on flaky in-store connections.
const CACHE_PREFIX = "fnc-ocr-assets-"
const CACHE_NAME = `${CACHE_PREFIX}v2`
const PRECACHE_PATHS = [
  "/ocrs_bg.wasm",
  "/text-detection.rten",
  "/text-recognition.rten",
  "/brands.json",
]

function isCacheableAsset(url) {
  return (
    url.origin === self.location.origin &&
    (url.pathname.endsWith(".wasm") ||
      url.pathname.endsWith(".rten") ||
      url.pathname === "/brands.json")
  )
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME)
  const cached = await cache.match(request)
  if (cached) {
    return cached
  }
  const response = await fetch(request)
  await cacheResponse(cache, request, response)
  return response
}

async function staleWhileRevalidate(request, event) {
  const cache = await caches.open(CACHE_NAME)
  const cached = await cache.match(request)
  const networkResponse = fetch(request)
    .then(async (response) => {
      await cacheResponse(cache, request, response)
      return response
    })
    .catch((error) => {
      if (!cached) {
        throw error
      }
      console.error(
        "Failed to revalidate cached OCR asset:",
        request.url,
        error,
      )
      return cached
    })
  if (cached && event) {
    event.waitUntil(networkResponse)
  }
  return cached || networkResponse
}

async function cacheResponse(cache, request, response) {
  if (response.ok) {
    try {
      await cache.put(request, response.clone())
    } catch (error) {
      console.error("Failed to cache OCR asset:", request.url, error)
    }
  }
}

self.addEventListener("install", (event) => {
  self.skipWaiting()
  // Precache so the models are available offline right after the first
  // visit. The page is fetching these same URLs concurrently, so these
  // requests are typically served from the HTTP cache.
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_PATHS)),
  )
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(
        names
          .filter(
            (name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME,
          )
          .map((name) => caches.delete(name)),
      )
      await self.clients.claim()
    })(),
  )
})

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return
  }
  const url = new URL(event.request.url)
  if (isCacheableAsset(url)) {
    event.respondWith(
      url.pathname === "/brands.json"
        ? staleWhileRevalidate(event.request, event)
        : cacheFirst(event.request),
    )
  }
})
