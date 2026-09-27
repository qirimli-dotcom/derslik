const V = "cantam-v1";
const SHELL = V + "-shell";
const BOOKS = "cantam-books";
const FILES = [
  "./", "index.html", "app.css", "app.js", "strings.js", "books.json", "manifest.webmanifest",
  "icons/icon.svg", "icons/icon-180.png", "icons/icon-192.png", "icons/icon-512.png",
  "pdfjs/pdf.min.js", "pdfjs/pdf.worker.min.js",
  "fonts/unbounded.woff2", "fonts/onest.woff2"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(
    ks.filter(k => k !== SHELL && k !== BOOKS).map(k => caches.delete(k))
  )).then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Каталог: сначала сеть, чтобы новые книги появлялись сразу
  if (url.pathname.endsWith("books.json")) {
    e.respondWith(fetch(req).then(r => {
      const copy = r.clone(); caches.open(SHELL).then(c => c.put(req, copy)); return r;
    }).catch(() => caches.match(req)));
    return;
  }

  // PDF: из кеша, если скачан через «Yükle», иначе из сети
  if (url.pathname.toLowerCase().endsWith(".pdf")) {
    e.respondWith(caches.open(BOOKS).then(c => c.match(req.url)).then(r => r || fetch(req)));
    return;
  }

  // Всё остальное: кеш, потом сеть
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(r => r || fetch(req).then(res => {
    if (res.ok && url.origin === location.origin) {
      const copy = res.clone(); caches.open(SHELL).then(c => c.put(req, copy));
    }
    return res;
  }).catch(() => caches.match("index.html"))));
});
