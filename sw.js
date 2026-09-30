/* Guarda la app para usarla sin señal y las teselas del mapa que ya se vieron. */
const APP = "d11178-app-v4";
const TILES = "d11178-tiles-v1";
const MAX_TILES = 3000;
const SHELL = [
  "./", "index.html", "manual.html", "styles.css", "app.js", "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
  "https://cdn.jsdelivr.net/npm/@turf/turf@6.5.0/turf.min.js"
];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(APP).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== APP && k !== TILES).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
const isTile = (u) => /arcgisonline\.com|tile\.openstreetmap\.org|tile\.googleapis\.com\/v1\/2dtiles/.test(u);
async function trim() {
  const c = await caches.open(TILES); const ks = await c.keys();
  for (let i = 0; i < ks.length - MAX_TILES; i++) await c.delete(ks[i]);
}
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = req.url;
  if (isTile(url)) {
    // teselas: primero la red (imagen actualizada), si no hay señal, la guardada
    e.respondWith(fetch(req).then((r) => {
      const cp = r.clone(); caches.open(TILES).then((c) => c.put(req, cp)).then(trim); return r;
    }).catch(() => caches.match(req)));
    return;
  }
  if (url.startsWith(self.location.origin)) {
    // archivos de la app: primero la versión nueva de internet; sin señal, la guardada
    e.respondWith(fetch(req).then((r) => { const cp = r.clone(); caches.open(APP).then((c) => c.put(req, cp)); return r; })
      .catch(() => caches.match(req).then((hit) => hit || caches.match("index.html"))));
    return;
  }
  if (url.includes("fonts.g") || url.includes("unpkg.com") || url.includes("cdn.jsdelivr.net")) {
    // librerías y fuentes: la guardada al instante
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => { const cp = r.clone(); caches.open(APP).then((c) => c.put(req, cp)); return r; })));
  }
});
