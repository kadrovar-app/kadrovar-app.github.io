/* KamuRadar service worker
   - Uygulama kabuğu (sayfa, simgeler) önbellekten hemen açılır, arkada güncellenir.
   - İlan verisi her zaman önce internetten çekilir; bağlantı yoksa son kaydedilen kopya gösterilir.
   Sayfa kodu değişince SURUM'u güncelle. */
const SURUM = 'kadrovar-2026-11-26-sifirla';
const KABUK = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
  './data/ilanlar.json',
  './data/kadrolar.json'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SURUM).then(c => c.addAll(KABUK)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(anahtarlar => Promise.all(anahtarlar.filter(k => k !== SURUM).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Veri istekleri ?v=... ile gelir; önbellekte sorgusuz adresle tutulur
const sorgusuz = istek => { const u = new URL(istek.url); return u.origin + u.pathname; };

self.addEventListener('fetch', e => {
  const istek = e.request;
  if (istek.method !== 'GET') return;
  const url = new URL(istek.url);

  // İlan verisi: önce ağ, olmazsa son kayıtlı kopya
  if (url.origin === self.location.origin && url.pathname.indexOf('/data/') !== -1) {
    e.respondWith(
      fetch(istek).then(yanit => {
        if (yanit && yanit.ok) {
          const kopya = yanit.clone();
          caches.open(SURUM).then(c => c.put(sorgusuz(istek), kopya));
        }
        return yanit;
      }).catch(() => caches.match(sorgusuz(istek)).then(r => r || Response.error()))
    );
    return;
  }

  // Uygulama kabuğu: önbellekten hemen ver, arkada güncelle
  if (url.origin === self.location.origin) {
    e.respondWith(
      caches.open(SURUM).then(c => c.match(istek, { ignoreSearch: true }).then(onbellek => {
        const ag = fetch(istek).then(yanit => {
          if (yanit && yanit.ok) c.put(istek, yanit.clone());
          return yanit;
        }).catch(() => onbellek || (istek.mode === 'navigate' ? c.match('./index.html') : Response.error()));
        return onbellek || ag;
      }))
    );
    return;
  }

  // Yazı tipi stil dosyası: önbellekten ver, arkada yenile
  if (url.hostname === 'fonts.googleapis.com') {
    e.respondWith(
      caches.open(SURUM).then(c => c.match(istek).then(onbellek => {
        const ag = fetch(istek).then(yanit => {
          if (yanit && (yanit.ok || yanit.type === 'opaque')) c.put(istek, yanit.clone());
          return yanit;
        }).catch(() => onbellek || Response.error());
        return onbellek || ag;
      }))
    );
    return;
  }

  // Yazı tipi dosyaları: değişmez, ilk indirmeden sonra önbellekten
  if (url.hostname === 'fonts.gstatic.com') {
    e.respondWith(
      caches.open(SURUM).then(c => c.match(istek).then(onbellek => onbellek || fetch(istek).then(yanit => {
        if (yanit && yanit.ok) c.put(istek, yanit.clone());
        return yanit;
      })))
    );
  }
});
