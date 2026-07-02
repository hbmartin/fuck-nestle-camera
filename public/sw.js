// Service worker that caches the large OCR assets (WASM binary, .rten
// models, brand list) so repeat visits load instantly and the app keeps
// working on flaky in-store connections.
const CACHE_NAME = "fnc-ocr-assets-v1"
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
  if (response.ok) {
    await cache.put(request, response.clone())
  }
  return response
}

self.addEventListener("install", (event) => {
  self.skipWaiting()
  // Precache so the models are available offline right after the first
  // visit. The page is fetching these same URLs concurrently, so these
  // requests are typically served from the HTTP cache.
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_PATHS))
      .catch((error) => {
        console.error("Precaching OCR assets failed:", error)
      }),
  )
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(
        names
          .filter((name) => name !== CACHE_NAME)
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
    event.respondWith(cacheFirst(event.request))
  }
})
