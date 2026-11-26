/* KamuRadar service worker
   - Uygulama kabuğu (sayfa, simgeler) önbellekten hemen açılır, arkada güncellenir.
   - İlan verisi her zaman önce internetten çekilir; bağlantı yoksa son kaydedilen kopya gösterilir.
   Sayfa kodu değişince SURUM'u güncelle. */
const SURUM = 'kadrovar-2026-11-27-isci';
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

// Arka planda ilan denetimi (Android'de ana ekrana eklenmiş uygulama) ve bildirime dokununca açma
async function arkaplanDenetle() {
  const c = await caches.open('kr-durum');
  const r = await c.match('./__durum.json'); if (!r) return;
  const d = await r.json();
  if (!d.tercih || !d.tercih.telefon) return;
  const veri = await (await fetch('./data/ilanlar.json?v=' + Date.now(), { cache: 'no-store' })).json();
  const simdi = Date.now();
  const gorulen = new Set(d.gorulen || []);
  const uyar = il => {
    if (!(d.tercih.turler || []).includes(il.tur)) return false;
    if (il.basvuru && il.basvuru.bitis && new Date(il.basvuru.bitis).getTime() < simdi) return false;
    if (d.tercih.illerim && (d.iller || []).length) { const y = il.iller || []; if (y.length && !y.includes('*') && !y.some(x => d.iller.includes(x))) return false; }
    return true;
  };
  const yeni = (veri.ilanlar || []).filter(il => !gorulen.has(il.id) && uyar(il));
  const gD = new Set(d.gorulenDuyuru || []), takip = new Set(d.takip || []);
  const yeniD = [];
  (veri.ilanlar || []).forEach(il => (il.duyurular || []).forEach(x => { const k = il.id + '|' + x.tarih + '|' + x.baslik; if (takip.has(il.id) && !gD.has(k) && d.tercih.duyuru !== false) yeniD.push([il, x, k]); }));
  if (yeni.length) await self.registration.showNotification(yeni.length === 1 ? 'Yeni ilan: ' + yeni[0].kurum : yeni.length + ' yeni ilan', { body: yeni.slice(0, 3).map(il => il.kurum + ' – ' + il.baslik).join('\n'), icon: 'icons/icon-192.png', badge: 'icons/favicon-32.png', tag: 'kr-yeni', data: { url: yeni.length === 1 ? '#ilan-' + yeni[0].id : '#ilanlar' } });
  for (const [il, x] of yeniD) await self.registration.showNotification('Duyuru: ' + il.kurum, { body: x.baslik, icon: 'icons/icon-192.png', badge: 'icons/favicon-32.png', tag: 'kr-d-' + il.id, data: { url: '#ilan-' + il.id } });
  d.gorulen = (veri.ilanlar || []).map(il => il.id).concat(d.gorulen || []).slice(0, 2000);
  d.gorulenDuyuru = (d.gorulenDuyuru || []).concat(yeniD.map(z => z[2]));
  await c.put('./__durum.json', new Response(JSON.stringify(d), { headers: { 'Content-Type': 'application/json' } }));
}
self.addEventListener('periodicsync', e => { if (e.tag === 'kr-ilan') e.waitUntil(arkaplanDenetle().catch(() => {})); });
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const hedef = new URL('./' + ((e.notification.data && e.notification.data.url) || ''), self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ws => {
    for (const w of ws) { if ('focus' in w) { w.navigate(hedef).catch(() => {}); return w.focus(); } }
    return self.clients.openWindow(hedef);
  }));
});
