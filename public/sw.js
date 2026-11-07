// Guarda só a "casca" da app para abrir depressa. A música vem sempre do servidor (offline fica para a v2).
const CACHE = 'som-v4';
const CASCA = ['/', '/index.html', '/estilo.css', '/app.js', '/manifest.webmanifest', '/icone.svg', '/icones.js', '/extras.js', '/icone-192.png', '/icone-512.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(CASCA))));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.pathname.startsWith('/api/') || u.pathname.startsWith('/audio/') || u.pathname.startsWith('/rest/') || u.pathname.startsWith('/capa/')) return;
  // rede primeiro, cache se não houver rede
  e.respondWith(fetch(e.request).then(r => {
    const c = r.clone(); caches.open(CACHE).then(k => k.put(e.request, c)); return r;
  }).catch(() => caches.match(e.request)));
});
