// Service worker: makes the atlas installable and usable offline after the first visit.
// Navigations: network first (fresh content), falling back to the cached shell.
// Static assets and 3D models: cache first (immutable, hashed or versioned files).
const CACHE = "anatomia-v2";
const SCOPE = self.registration.scope;
const SHELL = [SCOPE, `${SCOPE}manifest.webmanifest`, `${SCOPE}icons/icon-192.png`, `${SCOPE}icons/icon-512.png`];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || !request.url.startsWith(SCOPE)) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(SCOPE, copy));
          return response;
        })
        .catch(() => caches.match(SCOPE)),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ??
        fetch(request).then((response) => {
          if (response.ok && response.type === "basic") {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
