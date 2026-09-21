/* 服装予報 — Service Worker
   アプリ本体（HTML/CSS/JS/画像）はキャッシュ優先で、オフラインでも開けるようにする。
   天気データそのものは app.js 側が localStorage で1時間キャッシュしているので、
   ここでは API 応答を持たない（古い予報を SW が握り続けるのを避けるため）。 */
'use strict';

const VERSION = 'fy-v2';
const SHELL = [
  './', './index.html', './styles.css', './app.js', './manifest.webmanifest',
  './img/icon-192.png', './img/icon-512.png', './img/icon-maskable.png',
  './img/wear_1_tee_shorts.png', './img/wear_2_tee_pants.png', './img/wear_3_shirt.png',
  './img/wear_4_longsleeve.png', './img/wear_5_jacket.png', './img/wear_6_coat.png',
  './img/gear_umbrella.png', './img/gear_boots.png',
  './img/wx_clear.png', './img/wx_partly.png', './img/wx_cloudy.png', './img/wx_fog.png',
  './img/wx_drizzle.png', './img/wx_rain.png', './img/wx_heavy_rain.png',
  './img/wx_shower.png', './img/wx_sleet.png', './img/wx_snow.png', './img/wx_thunder.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(VERSION)
      .then(c => Promise.allSettled(SHELL.map(u => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const u = new URL(req.url);
  if (u.origin !== self.location.origin) return;   // API はそのまま通す

  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(VERSION).then(c => c.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
