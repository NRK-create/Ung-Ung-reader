// แคชไฟล์แอป (รวมนิทานทั้งหมด) ไว้ใช้ตอนไม่มีเน็ต แต่ถ้ามีเน็ตจะดึงไฟล์ใหม่ก่อนเสมอ เพื่อให้อัปเดตแล้วเห็นทันที
const CACHE = 'ung-ung-v3';
const CORE = ['./','./index.html','./style.css','./app.js','./backend.js','./firebase-config.js',
  './stories/easy/stories.js','./stories/challenge/stories.js','./stories/hard/stories.js',
  './manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png','./icons/apple-touch-icon.png','./icons/favicon-48.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === location.origin;
  const isFont = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (!sameOrigin && !isFont) return;          // Firebase และ Google API ไม่ผ่านแคช
  e.respondWith(
    fetch(req).then(res => {
      if (res && (res.ok || res.type === 'opaque')) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, {ignoreSearch: true}).then(hit => hit || caches.match('./index.html')))
  );
});
