const V = "cantam-v3";
const SHELL = V + "-shell";
const BOOKS = "cantam-books";
const FILES = [
  "./", "index.html", "app.css", "app.js", "strings.js", "qrcode.js", "manifest.webmanifest",
  "icons/icon.svg", "icons/icon-180.png", "icons/icon-192.png", "icons/icon-512.png",
  "pdfjs/pdf.min.js", "pdfjs/pdf.worker.min.js", "fonts/unbounded.woff2", "fonts/onest.woff2"
];
self.addEventListener("install", e => { e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== SHELL && k !== BOOKS).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (!req.url.startsWith(self.registration.scope)) return;         // только файлы самого приложения
  if (url.pathname.includes("/data/") || url.pathname.includes("/books/")) return;  // данные и учебники ведёт приложение
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => {
    const net = fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(SHELL).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => hit || caches.match("index.html"));
    return hit || net;
  }));
});
