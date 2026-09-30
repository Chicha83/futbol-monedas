import { newVapid, sendPush, endpointOk } from './push.js';
// Base de datos del juego (un único Hub): usuarios con PIN de 4 cifras, estadísticas, ranking y torneos.
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
import { botTeam, botSkill, eloOf, winProb } from './elo.js';
const BOTS = ['IA Lobo', 'IA Halcón', 'IA Tigre', 'IA Toro', 'IA Zorro', 'IA Águila', 'IA Oso', 'IA Pantera'];
const LOCK_MS = 15 * 60 * 1000;
const MAX_FAILS = 5;

const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const rndHex = n => hex(crypto.getRandomValues(new Uint8Array(n)));
const rndCode = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => ALPHA[b % ALPHA.length]).join('');
async function hashPin(pin, salt) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':' + pin));
  return hex(d);
}
const cleanName = v => String(v || '').trim().replace(/\s+/g, ' ');
const nameOk = v => /^[\p{L}\p{N}_ .-]{3,14}$/u.test(v);

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (msg, status = 400) => { throw new HttpError(status, msg); };

// orden de emparejamiento habitual: los mejor sembrados no se cruzan hasta el final
function seedOrder(n) {
  let r = [1];
  while (r.length < n) {
    const m = r.length * 2 + 1;
    r = r.flatMap(x => [x, m - x]);
  }
  return r;
}

export class Hub {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sql = state.storage.sql;
    state.blockConcurrencyWhile(async () => {
      this.sql.exec(`CREATE TABLE IF NOT EXISTS players(
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, lname TEXT NOT NULL UNIQUE,
        salt TEXT NOT NULL, pin TEXT NOT NULL, team INTEGER DEFAULT -1,
        played INTEGER DEFAULT 0, won INTEGER DEFAULT 0, lost INTEGER DEFAULT 0, gf INTEGER DEFAULT 0, ga INTEGER DEFAULT 0,
        fails INTEGER DEFAULT 0, lock_until INTEGER DEFAULT 0, created INTEGER)`);
      this.sql.exec('CREATE TABLE IF NOT EXISTS sessions(sid TEXT PRIMARY KEY, pid INTEGER, ts INTEGER)');
      this.sql.exec(`CREATE TABLE IF NOT EXISTS matches(
        id INTEGER PRIMARY KEY AUTOINCREMENT, p0 INTEGER, p1 INTEGER, s0 INTEGER, s1 INTEGER, ts INTEGER, tm INTEGER DEFAULT 0)`);
      this.sql.exec(`CREATE TABLE IF NOT EXISTS tournaments(
        id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE, name TEXT, owner INTEGER, state TEXT, size INTEGER DEFAULT 0,
        created INTEGER, champion INTEGER DEFAULT 0, maxp INTEGER DEFAULT 8, bots INTEGER DEFAULT 0)`);
      this.sql.exec(`CREATE TABLE IF NOT EXISTS tmembers(tid INTEGER, pid INTEGER, joined INTEGER, PRIMARY KEY(tid,pid))`);
      this.sql.exec(`CREATE TABLE IF NOT EXISTS tmatches(
        id INTEGER PRIMARY KEY AUTOINCREMENT, tid INTEGER, rnd INTEGER, idx INTEGER, p0 INTEGER DEFAULT 0, p1 INTEGER DEFAULT 0,
        winner INTEGER DEFAULT 0, s0 INTEGER DEFAULT 0, s1 INTEGER DEFAULT 0, state TEXT, room TEXT, tok0 TEXT, tok1 TEXT)`);
      try { this.sql.exec('ALTER TABLE tournaments ADD COLUMN blevel INTEGER DEFAULT 2'); } catch (e) { /* ya existe */ }   // nivel de la IA del torneo: 1 baja, 2 media, 3 alta
      for (const c of ['t0', 't1']) { try { this.sql.exec('ALTER TABLE tmatches ADD COLUMN ' + c + ' INTEGER DEFAULT -1'); } catch (e) { /* ya existe */ } }   // equipo de cada jugador en el partido
      this.sql.exec('CREATE INDEX IF NOT EXISTS tm_tid ON tmatches(tid)');
      this.sql.exec(`CREATE TABLE IF NOT EXISTS push(endpoint TEXT PRIMARY KEY, pid INTEGER, p256dh TEXT, auth TEXT,
        game INTEGER DEFAULT 1, chat INTEGER DEFAULT 1, tour INTEGER DEFAULT 1, ts INTEGER)`);
      this.sql.exec('CREATE INDEX IF NOT EXISTS push_pid ON push(pid)');
      this.vapid = await state.storage.get('vapid');                 // claves VAPID: se crean una sola vez y nunca salen del servidor (salvo la pública)
      if (!this.vapid) { this.vapid = await newVapid(); await state.storage.put('vapid', this.vapid); }
    });
    this.outbox = [];
  }

  q(query, ...a) { return this.sql.exec(query, ...a).toArray(); }
  one(query, ...a) { return this.q(query, ...a)[0] || null; }

  async fetch(req) {
    const url = new URL(req.url);
    let body = {};
    if (req.method === 'POST') { try { body = await req.json(); } catch (e) { body = {}; } }
    try {
      const out = await this.route(url.pathname, body, url.searchParams);
      await this.flush();
      return Response.json(out);
    } catch (e) {
      if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
      return Response.json({ error: 'Error del servidor' }, { status: 500 });
    }
  }

  async route(path, b, sp) {
    switch (path) {
      case '/api/register': return this.register(b);
      case '/api/login': return this.login(b);
      case '/api/me': return { profile: this.profile(this.auth(b.sid)) };
      case '/api/team': { const u = this.auth(b.sid); const t = Number(b.team); if (Number.isInteger(t) && t >= -1 && t < 64) this.q('UPDATE players SET team=? WHERE id=?', t, u.id); return { ok: 1 }; }
      case '/api/logout': { this.q('DELETE FROM sessions WHERE sid=?', String(b.sid || '')); return { ok: 1 }; }
      case '/api/profile': return this.publicProfile(sp.get('name'));
      case '/api/ranking': return this.ranking();
      case '/api/t/create': return this.tCreate(b);
      case '/api/t/join': return this.tJoin(b);
      case '/api/t/leave': return this.tLeave(b);
      case '/api/t/get': return this.tGet(b.code || sp.get('code'), b.sid || sp.get('sid'));
      case '/api/t/start': return this.tStart(b);
      case '/api/t/match': return this.tMatch(b);
      case '/api/t/walkover': return this.tWalkover(b);
      case '/api/push/key': return { key: this.vapid.pub };
      case '/api/push/sub': return this.pSub(b);
      case '/api/push/unsub': { const u = this.auth(b.sid); this.q('DELETE FROM push WHERE endpoint=? AND pid=?', String(b.endpoint || ''), u.id); return { ok: 1 }; }
      case '/api/push/prefs': return this.pPrefs(b);
      case '/api/push/state': return this.pState(b);
      case '/internal/push': this.outbox.push([Number(b.pid) | 0, String(b.kind), { title: String(b.title || 'Fútbol Monedas').slice(0, 60), body: String(b.body || '').slice(0, 120), tag: String(b.tag || ''), url: './' }]); return { ok: 1 };
      case '/internal/who': { const u = this.one('SELECT p.id,p.name FROM sessions s JOIN players p ON p.id=s.pid WHERE s.sid=?', String(b.sid || '')); return u ? { pid: u.id, name: u.name } : {}; }
      case '/internal/result': return this.result(b);
    }
    return bad('No encontrado', 404);
  }

  /* ---------- usuarios ---------- */
  auth(sid) {
    const u = sid ? this.one('SELECT p.* FROM sessions s JOIN players p ON p.id=s.pid WHERE s.sid=?', String(sid)) : null;
    if (!u) bad('Sesión caducada: vuelve a entrar con tu nombre y tu PIN.', 401);
    return u;
  }
  // ---------- avisos push ----------
  pSub(b) {
    const u = this.auth(b.sid), s = b.sub || {};
    if (!endpointOk(s.endpoint) || !s.keys || typeof s.keys.p256dh !== 'string' || typeof s.keys.auth !== 'string') bad('Este móvil no admite avisos.');
    const f = x => (x === false || x === 0 ? 0 : 1), p = b.prefs || {};
    this.q('INSERT OR REPLACE INTO push(endpoint,pid,p256dh,auth,game,chat,tour,ts) VALUES(?,?,?,?,?,?,?,?)',
      s.endpoint, u.id, s.keys.p256dh.slice(0, 120), s.keys.auth.slice(0, 40), f(p.game), f(p.chat), f(p.tour), Date.now());
    const n = this.one('SELECT COUNT(*) AS n FROM push WHERE pid=?', u.id).n;
    if (n > 6) this.q('DELETE FROM push WHERE pid=? AND endpoint IN (SELECT endpoint FROM push WHERE pid=? ORDER BY ts LIMIT ?)', u.id, u.id, n - 6);
    return { ok: 1 };
  }
  pPrefs(b) {
    const u = this.auth(b.sid), p = b.prefs || {}, f = x => (x === false || x === 0 ? 0 : 1);
    this.q('UPDATE push SET game=?, chat=?, tour=? WHERE endpoint=? AND pid=?', f(p.game), f(p.chat), f(p.tour), String(b.endpoint || ''), u.id);
    return { ok: 1 };
  }
  pState(b) {
    const u = this.auth(b.sid), r = this.one('SELECT game,chat,tour FROM push WHERE endpoint=? AND pid=?', String(b.endpoint || ''), u.id);
    return r ? { on: true, prefs: { game: !!r.game, chat: !!r.chat, tour: !!r.tour } } : { on: false };
  }
  async notify(pid, kind, payload) {
    if (!(pid > 0) || !['game', 'chat', 'tour'].includes(kind)) return 0;
    let sent = 0;
    console.log('aviso', kind, pid);
    for (const r of this.q(`SELECT * FROM push WHERE pid=? AND ${kind}=1`, pid)) {
      try {
        const st = await sendPush(this.vapid, { endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }, payload);
        if (st === 404 || st === 410) this.q('DELETE FROM push WHERE endpoint=?', r.endpoint);
        else if (st >= 200 && st < 300) sent++;
      } catch (e) { /* sin red o servicio caído: el aviso se pierde */ }
    }
    return sent;
  }
  async flush() {
    const o = this.outbox; this.outbox = [];
    await Promise.all(o.map(([pid, kind, payload]) => this.notify(pid, kind, payload)));
  }
  readyPush(m, tname) {                          // un partido de torneo ya se puede jugar: avisa a los jugadores reales
    for (const pid of [m.p0, m.p1]) if (pid > 0) this.outbox.push([pid, 'tour', { title: 'Torneo' + (tname ? ' «' + tname + '»' : ''), body: 'Tu siguiente partido ya está listo. ¡A jugar!', tag: 'torneo-' + m.tid, url: './' }]);
  }
  profile(u) {
    const last = this.q(`SELECT m.p0,m.p1,m.s0,m.s1,m.ts,m.tm,a.name AS n0,b.name AS n1 FROM matches m
      JOIN players a ON a.id=m.p0 JOIN players b ON b.id=m.p1 WHERE m.p0=? OR m.p1=? ORDER BY m.id DESC LIMIT 10`, u.id, u.id);
    let pos = null;
    const total = this.one('SELECT COUNT(*) AS n FROM players WHERE played>0').n;
    if (u.played > 0) {
      pos = 1 + this.one(`SELECT COUNT(*) AS n FROM players WHERE played>0 AND (won>? OR (won=? AND (gf-ga)>?) OR (won=? AND (gf-ga)=? AND played<?))`,
        u.won, u.won, u.gf - u.ga, u.won, u.gf - u.ga, u.played).n;
    }
    return {
      id: u.id, name: u.name, team: u.team, played: u.played, won: u.won, lost: u.lost, gf: u.gf, ga: u.ga, pos, total,
      history: last.map(r => {
        const me0 = r.p0 === u.id;
        return { opp: me0 ? r.n1 : r.n0, gf: me0 ? r.s0 : r.s1, ga: me0 ? r.s1 : r.s0, ts: r.ts, torneo: !!r.tm };
      })
    };
  }
  publicProfile(name) {
    const u = this.one('SELECT * FROM players WHERE lname=?', cleanName(name).toLowerCase());
    if (!u) bad('No existe ese jugador.', 404);
    const p = this.profile(u);
    return { profile: { name: p.name, played: p.played, won: p.won, lost: p.lost, gf: p.gf, ga: p.ga } };
  }
  ranking() {
    const rows = this.q('SELECT name,played,won,lost,gf,ga FROM players WHERE played>0 ORDER BY won DESC, (gf-ga) DESC, played ASC LIMIT 20');
    return { ranking: rows };
  }
  async register(b) {
    const name = cleanName(b.name), pin = String(b.pin || '');
    if (!nameOk(name)) bad('El nombre debe tener de 3 a 14 caracteres (letras, números, espacio, guion o punto).');
    if (!/^\d{4}$/.test(pin)) bad('El PIN son 4 números.');
    if (b.pin2 !== undefined && String(b.pin2) !== pin) bad('Los dos PIN no coinciden.');
    if (this.one('SELECT id FROM players WHERE lname=?', name.toLowerCase())) bad('Ese nombre ya está cogido. Si eres tú, pulsa «Entrar».', 409);
    const salt = rndHex(8), sid = rndHex(24);
    this.q('INSERT INTO players(name,lname,salt,pin,created) VALUES(?,?,?,?,?)', name, name.toLowerCase(), salt, await hashPin(pin, salt), Date.now());
    const u = this.one('SELECT * FROM players WHERE lname=?', name.toLowerCase());
    this.q('INSERT INTO sessions(sid,pid,ts) VALUES(?,?,?)', sid, u.id, Date.now());
    return { sid, profile: this.profile(u) };
  }
  async login(b) {
    const name = cleanName(b.name), pin = String(b.pin || '');
    const u = this.one('SELECT * FROM players WHERE lname=?', name.toLowerCase());
    if (!u || !/^\d{4}$/.test(pin)) bad('Nombre o PIN incorrectos.', 401);
    const now = Date.now();
    if (u.lock_until > now) bad('Demasiados intentos. Prueba de nuevo en ' + Math.ceil((u.lock_until - now) / 60000) + ' min.', 429);
    if (await hashPin(pin, u.salt) !== u.pin) {
      const f = u.fails + 1;
      if (f >= MAX_FAILS) { this.q('UPDATE players SET fails=0, lock_until=? WHERE id=?', now + LOCK_MS, u.id); bad('Demasiados intentos. Prueba de nuevo en 15 min.', 429); }
      this.q('UPDATE players SET fails=? WHERE id=?', f, u.id);
      bad('Nombre o PIN incorrectos.', 401);
    }
    const sid = rndHex(24);
    this.q('UPDATE players SET fails=0, lock_until=0 WHERE id=?', u.id);
    this.q('INSERT INTO sessions(sid,pid,ts) VALUES(?,?,?)', sid, u.id, Date.now());
    this.q('DELETE FROM sessions WHERE pid=? AND sid NOT IN (SELECT sid FROM sessions WHERE pid=? ORDER BY ts DESC LIMIT 8)', u.id, u.id);   // como mucho 8 dispositivos
    return { sid, profile: this.profile(u) };
  }

  /* ---------- resultados ---------- */
  result(b) {
    const s0 = Number(b.s0) | 0, s1 = Number(b.s1) | 0;
    let p0 = Number(b.p0) | 0, p1 = Number(b.p1) | 0, tm = 0;
    if (b.matchId) {
      const m = this.one('SELECT * FROM tmatches WHERE id=?', b.matchId);
      if (!m || m.winner) return { ok: 1 };
      p0 = m.p0; p1 = m.p1; tm = m.tid;
      if (s0 === s1) return { ok: 1 };
      this.setWinner(m, s0 > s1 ? 0 : 1, s0, s1);
      const tk = v => (Number.isInteger(v) && v >= 0 && v < 64 ? v : -1);
      this.q('UPDATE tmatches SET t0=?, t1=? WHERE id=?', tk(b.t0), tk(b.t1), m.id);
    }
    if (p0 > 0 && p1 > 0 && p0 !== p1 && s0 !== s1) this.stats(p0, p1, s0, s1, tm);
    return { ok: 1 };
  }
  stats(p0, p1, s0, s1, tm) {
    const w0 = s0 > s1;
    this.q('UPDATE players SET played=played+1, won=won+?, lost=lost+?, gf=gf+?, ga=ga+? WHERE id=?', w0 ? 1 : 0, w0 ? 0 : 1, s0, s1, p0);
    this.q('UPDATE players SET played=played+1, won=won+?, lost=lost+?, gf=gf+?, ga=ga+? WHERE id=?', w0 ? 0 : 1, w0 ? 1 : 0, s1, s0, p1);
    this.q('INSERT INTO matches(p0,p1,s0,s1,ts,tm) VALUES(?,?,?,?,?,?)', p0, p1, s0, s1, Date.now(), tm);
  }

  /* ---------- torneos ---------- */
  tour(code) {
    const t = this.one('SELECT * FROM tournaments WHERE code=?', String(code || '').toUpperCase());
    if (!t) bad('No existe ese torneo.', 404);
    return t;
  }
  botTm(t, pid) { return botTeam(t.blevel || 2, t.id, -pid); }     // equipo de una IA del torneo
  pname(id) { if (!id) return ''; if (id < 0) return BOTS[(-id - 1) % BOTS.length]; const r = this.one('SELECT name FROM players WHERE id=?', id); return r ? r.name : '?'; }
  tCreate(b) {
    const u = this.auth(b.sid);
    const name = cleanName(b.name).slice(0, 30) || ('Copa de ' + u.name);
    let code;
    do { code = rndCode(5); } while (this.one('SELECT id FROM tournaments WHERE code=?', code));
    const maxp = Number(b.size) === 4 ? 4 : 8;
    const lv = [1, 2, 3].includes(Number(b.ai)) ? Number(b.ai) : 2;
    this.q('INSERT INTO tournaments(code,name,owner,state,created,maxp,bots,blevel) VALUES(?,?,?,?,?,?,?,?)', code, name, u.id, 'open', Date.now(), maxp, b.bots ? 1 : 0, lv);
    const t = this.tour(code);
    this.q('INSERT INTO tmembers(tid,pid,joined) VALUES(?,?,?)', t.id, u.id, Date.now());
    return this.tGet(code, b.sid);
  }
  tJoin(b) {
    const u = this.auth(b.sid), t = this.tour(b.code);
    if (t.state !== 'open') bad('Ese torneo ya ha empezado.');
    if (this.one('SELECT pid FROM tmembers WHERE tid=? AND pid=?', t.id, u.id)) return this.tGet(t.code, b.sid);
    const n = this.one('SELECT COUNT(*) AS n FROM tmembers WHERE tid=?', t.id).n;
    if (n >= t.maxp) bad('El torneo está completo (' + t.maxp + ' jugadores).');
    this.q('INSERT INTO tmembers(tid,pid,joined) VALUES(?,?,?)', t.id, u.id, Date.now());
    return this.tGet(t.code, b.sid);
  }
  tLeave(b) {
    const u = this.auth(b.sid), t = this.tour(b.code);
    if (t.state !== 'open') bad('Ese torneo ya ha empezado.');
    if (t.owner === u.id) bad('El creador no puede salirse: si quieres cancelarlo, simplemente no lo empieces.');
    this.q('DELETE FROM tmembers WHERE tid=? AND pid=?', t.id, u.id);
    return { ok: 1 };
  }
  tStart(b) {
    const u = this.auth(b.sid), t = this.tour(b.code);
    if (t.owner !== u.id) bad('Solo el creador puede empezar el torneo.', 403);
    if (t.state !== 'open') bad('Ese torneo ya ha empezado.');
    const ids = this.q('SELECT pid FROM tmembers WHERE tid=?', t.id).map(r => r.pid);
    if (ids.length < 2 && !t.bots) bad('Hacen falta al menos 2 jugadores (o activa las IA al crear el torneo).');
    if (t.bots) { let k = 1; while (ids.length < t.maxp) ids.push(-(k++)); }       // los huecos se rellenan con IA
    for (let i = ids.length - 1; i > 0; i--) { const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1); [ids[i], ids[j]] = [ids[j], ids[i]]; }
    let size = 2; while (size < ids.length) size *= 2;
    if (size > t.maxp) size = t.maxp;
    const order = seedOrder(size);                  // posición -> número de cabeza de serie
    const slot = order.map(seed => ids[seed - 1] || 0);
    const rounds = Math.log2(size);
    for (let r = 1; r <= rounds; r++) {
      const n = size / Math.pow(2, r);
      for (let i = 0; i < n; i++) {
        const p0 = r === 1 ? slot[2 * i] : 0, p1 = r === 1 ? slot[2 * i + 1] : 0;
        this.q('INSERT INTO tmatches(tid,rnd,idx,p0,p1,state) VALUES(?,?,?,?,?,?)', t.id, r, i, p0, p1, r === 1 ? ((p0 && p1) ? 'ready' : 'bye') : 'wait');
      }
    }
    this.q('UPDATE tournaments SET state=?, size=? WHERE id=?', 'running', size, t.id);
    for (const m of this.q("SELECT * FROM tmatches WHERE tid=? AND state='ready'", t.id)) this.readyPush(m, t.name);
    for (const m of this.q("SELECT * FROM tmatches WHERE tid=? AND state='bye'", t.id)) {
      const w = m.p0 || m.p1;
      this.q("UPDATE tmatches SET winner=?, state='done' WHERE id=?", w, m.id);
      this.advance(t, m.rnd, m.idx, w);
    }
    this.autoBots(t);
    return this.tGet(t.code, b.sid);
  }
  advance(t, rnd, idx, winnerPid) {
    const next = this.one('SELECT * FROM tmatches WHERE tid=? AND rnd=? AND idx=?', t.id, rnd + 1, idx >> 1);
    if (!next) { this.q("UPDATE tournaments SET state='done', champion=? WHERE id=?", winnerPid, t.id); return; }
    const col = (idx & 1) ? 'p1' : 'p0';
    this.q(`UPDATE tmatches SET ${col}=? WHERE id=?`, winnerPid, next.id);
    const m = this.one('SELECT * FROM tmatches WHERE id=?', next.id);
    if (m.p0 && m.p1) { this.q("UPDATE tmatches SET state='ready' WHERE id=?", m.id); this.readyPush(m, t.name); }
  }
  setWinner(m, seat, s0, s1) {
    const t = this.one('SELECT * FROM tournaments WHERE id=?', m.tid);
    const w = seat === 0 ? m.p0 : m.p1;
    this.q("UPDATE tmatches SET winner=?, s0=?, s1=?, state='done' WHERE id=?", w, s0, s1, m.id);
    this.advance(t, m.rnd, m.idx, w);
    this.autoBots(t);
  }
  autoBots(t) {                                   // los partidos entre dos IA se resuelven solos
    for (let n = 0; n < 20; n++) {
      const m = this.one("SELECT * FROM tmatches WHERE tid=? AND state='ready' AND p0<0 AND p1<0 LIMIT 1", t.id);
      if (!m) return;
      const tm0 = this.botTm(t, m.p0), tm1 = this.botTm(t, m.p1);      // gana más a menudo el equipo mejor (según su Elo)
      const seat = Math.random() < winProb(eloOf(tm0), eloOf(tm1)) ? 0 : 1, lose = crypto.getRandomValues(new Uint8Array(1))[0] % 3;
      const w = seat === 0 ? m.p0 : m.p1;
      this.q("UPDATE tmatches SET winner=?, s0=?, s1=?, state='done', t0=?, t1=? WHERE id=?", w, seat === 0 ? 3 : lose, seat === 1 ? 3 : lose, tm0, tm1, m.id);
      this.advance(t, m.rnd, m.idx, w);
    }
  }
  tGet(code, sid) {
    const t = this.tour(code);
    let me = 0;
    if (sid) { const u = this.one('SELECT pid FROM sessions WHERE sid=?', String(sid)); if (u) me = u.pid; }
    const members = this.q('SELECT p.id,p.name FROM tmembers m JOIN players p ON p.id=m.pid WHERE m.tid=? ORDER BY m.joined', t.id);
    const rows = this.q('SELECT * FROM tmatches WHERE tid=? ORDER BY rnd, idx', t.id);
    const rounds = [];
    let mine = null;
    for (const r of rows) {
      (rounds[r.rnd - 1] = rounds[r.rnd - 1] || []).push({
        id: r.id, p0: this.pname(r.p0), p1: this.pname(r.p1), s0: r.s0, s1: r.s1, state: r.state, t0: r.t0 >= 0 ? r.t0 : (r.p0 < 0 ? this.botTm(t, r.p0) : -1), t1: r.t1 >= 0 ? r.t1 : (r.p1 < 0 ? this.botTm(t, r.p1) : -1),
        w: r.winner ? (r.winner === r.p0 ? 0 : 1) : -1
      });
      if (me && r.state === 'ready' && (r.p0 === me || r.p1 === me)) mine = { id: r.id, opp: this.pname(r.p0 === me ? r.p1 : r.p0), rnd: r.rnd };
    }
    return {
      code: t.code, name: t.name, state: t.state, size: t.size, maxp: t.maxp, bots: !!t.bots, ai: t.blevel || 2, owner: this.pname(t.owner), isOwner: t.owner === me,
      joined: !!members.find(x => x.id === me), count: members.length, members: members.map(x => x.name),
      champion: this.pname(t.champion), rounds, mine
    };
  }
  async tMatch(b) {
    const u = this.auth(b.sid), t = this.tour(b.code);
    const m = this.one("SELECT * FROM tmatches WHERE tid=? AND state='ready' AND (p0=? OR p1=?) ORDER BY rnd LIMIT 1", t.id, u.id, u.id);
    if (!m) bad('Ahora mismo no tienes ningún partido pendiente.');
    let { room, tok0, tok1 } = m;
    if (!room) {
      room = rndCode(6); tok0 = rndHex(16); tok1 = rndHex(16);
      const stub = this.env.ROOM.get(this.env.ROOM.idFromName(room));
      await stub.fetch('https://room/init', {
        method: 'POST',
        body: JSON.stringify({ matchId: m.id, seats: [m.p0, m.p1].map((pid, i) => { const tm = pid < 0 ? this.botTm(t, pid) : -1; return { pid, name: this.pname(pid), tok: pid < 0 ? 'bot' : (i === 0 ? tok0 : tok1), bot: pid < 0, team: tm, lv: pid < 0 ? botSkill(eloOf(tm)) : 0 }; }) })
      });
      this.q('UPDATE tmatches SET room=?, tok0=?, tok1=? WHERE id=?', room, tok0, tok1, m.id);
    }
    const seat = m.p0 === u.id ? 0 : 1;
    return { room, tok: seat === 0 ? tok0 : tok1, seat, opp: this.pname(seat === 0 ? m.p1 : m.p0), rnd: m.rnd };
  }
  tWalkover(b) {
    const u = this.auth(b.sid), t = this.tour(b.code);
    if (t.owner !== u.id) bad('Solo el creador puede decidirlo.', 403);
    const m = this.one('SELECT * FROM tmatches WHERE id=? AND tid=?', Number(b.matchId) | 0, t.id);
    if (!m || m.state !== 'ready') bad('Ese partido no está pendiente.');
    const seat = Number(b.seat) === 1 ? 1 : 0;
    this.setWinner(m, seat, seat === 0 ? 1 : 0, seat === 1 ? 1 : 0);
    return this.tGet(t.code, b.sid);
  }
}
