// Service worker: primero la red (así siempre se ve la última versión) y, si no hay conexión, lo último guardado.
const CACHE = 'fmon-shell';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return;
  e.respondWith(
    fetch(r,{cache:'no-store'}).then(res => {
      if (res.ok) { const c = res.clone(); caches.open(CACHE).then(k => k.put(r, c)); }
      return res;
    }).catch(() => caches.match(r).then(m => m || caches.match('./')))
  );
});

// ---- avisos push ----
// El servidor manda el aviso en español con un código (c) y argumentos (a); aquí se traduce al idioma que la página guardó en la caché 'fmon-prefs'.
const LI = { es: 0, en: 1, ru: 2, ar: 3, fil: 4 };
const PL = {   // [es, en, ru, ar, fil]
  turn_t: ['¡Te toca!', 'It’s your turn!', 'Твой ход!', 'حان دورك!', 'Turn mo na!'],
  turn_b: ['Es tu turno en la partida.', 'It’s your turn in the match.', 'Сейчас твой ход в матче.', 'حان دورك في المباراة.', 'Turn mo na sa laro.'],
  join_b: ['{0} se ha unido a la partida.', '{0} joined the match.', 'Игрок {0} присоединился к матчу.', 'انضم {0} إلى المباراة.', 'Sumali si {0} sa laro.'],
  left_b: ['{0} ha abandonado la partida. Queda nula.', '{0} left the match. It is void.', 'Игрок {0} покинул матч. Матч аннулирован.', 'غادر {0} المباراة. أُلغيت.', 'Umalis si {0} sa laro. Walang bisa ito.'],
  rival: ['Tu rival', 'Your opponent', 'Твой соперник', 'خصمك', 'Ang kalaban mo'],
  tour_t: ['Torneo', 'Tournament', 'Турнир', 'البطولة', 'Torneo'],
  tour_b: ['Tu siguiente partido ya está listo. ¡A jugar!', 'Your next match is ready. Let’s play!', 'Твой следующий матч готов. В игру!', 'مباراتك التالية جاهزة. هيا بنا نلعب!', 'Handa na ang susunod mong laro. Tara na!']
};
async function swLang() {
  try { const c = await caches.open('fmon-prefs'), r = await c.match('lang'); return r ? (await r.text()) : 'es'; } catch (_) { return 'es'; }
}
function swText(d, lang) {
  const i = LI[lang] || 0, a = d.a || [], f = k => PL[k][i], nm = a[0] || f('rival');
  switch (d.c) {
    case 'turn': return { title: f('turn_t'), body: f('turn_b') };
    case 'join': return { title: 'Fútbol Monedas', body: f('join_b').replace('{0}', nm) };
    case 'left': return { title: 'Fútbol Monedas', body: f('left_b').replace('{0}', nm) };
    case 'chat': return { title: nm, body: d.body };
    case 'tour': return { title: f('tour_t') + (a[0] ? ' «' + a[0] + '»' : ''), body: f('tour_b') };
    default: return { title: d.title, body: d.body };
  }
}
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async list => {
    if (list.some(c => c.visibilityState === 'visible')) return;      // ya está mirando el juego: no hace falta avisar
    const x = swText(d, await swLang());
    return self.registration.showNotification(x.title || 'Fútbol Monedas', {
      body: x.body || '', tag: d.tag || undefined, renotify: !!d.tag, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { url: d.url || './' }
    });
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) { if ('focus' in c) return c.focus(); }
    return self.clients.openWindow((e.notification.data && e.notification.data.url) || './');
  }));
});
