// Sala de una partida: el servidor calcula toda la física; los móviles solo envían golpes y dibujan lo que reciben.
import { createGame, plan } from '../game.js';

const STEP = 1000 / 60;
const IDLE_MS = 20 * 60 * 1000;      // sin golpes ni colocaciones durante 20 min: se cierra la sala

export class Room {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.g = createGame();
    this.seats = [0, 1].map(() => ({ tok: null, ws: null, pid: 0, name: '', team: -1, bot: false }));
    this.thinking = false;
    this.matchId = 0;          // partido de torneo (0 = partida libre)
    this.reported = false;
    this.gone = -1;            // asiento que ha salido al menú tras terminar la partida (ya no hay revancha)
    this.left = -1;            // asiento que ha abandonado la partida (la partida queda nula)
    this.timer = null;
    this.last = 0;
    this.acc = 0;
    this.syncN = 0;
    this.syncKey = '';
    this.lastAct = Date.now();
    this.ready = state.blockConcurrencyWhile(async () => {
      const d = await state.storage.get('room');
      if (d) {
        this.seats.forEach((s, i) => { Object.assign(s, d.seats[i]); s.ws = null; });
        this.matchId = d.matchId || 0;
        this.reported = !!d.reported;
        this.left = Number.isInteger(d.left) ? d.left : -1;
        this.gone = Number.isInteger(d.gone) ? d.gone : -1;
        if (d.snap) this.g.restore(d.snap);
      }
    });
  }

  async save() {
    try {
      await this.state.storage.put('room', {
        seats: this.seats.map(s => ({ tok: s.tok, pid: s.pid, name: s.name, team: s.team, bot: s.bot })),
        matchId: this.matchId,
        reported: this.reported,
        left: this.left,
        gone: this.gone,
        snap: this.g.snapshot(null)
      });
    } catch (e) { /* el guardado es un extra */ }
  }

  async fetch(req) {
    await this.ready;
    const url = new URL(req.url);
    if (url.pathname === '/init') {                 // lo llama el torneo para reservar los dos asientos
      const b = await req.json();
      if (!this.seats[0].tok) {
        b.seats.forEach((x, i) => { Object.assign(this.seats[i], { tok: x.tok, pid: x.pid, name: x.name, bot: !!x.bot, team: x.bot ? Math.floor(Math.random() * 64) : -1 }); });
        this.matchId = b.matchId || 0;
        await this.save();
      }
      return new Response('ok');
    }
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Sala de Fútbol Monedas', { status: 200 });
    const pair = new WebSocketPair();
    const ws = pair[1];
    ws.accept();
    this.attach(ws);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  attach(ws) {
    let seat = -1;
    ws.addEventListener('message', async ev => {
      let m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (!m || typeof m !== 'object') return;
      if (seat < 0) {
        if (m.t !== 'hello') return;
        seat = await this.hello(ws, m);
        return;
      }
      this.onMsg(seat, m, ws);
    });
    const gone = () => {
      if (seat >= 0 && this.seats[seat].ws === ws) { this.seats[seat].ws = null; this.broadcast(true); }
      this.checkEmpty();
    };
    ws.addEventListener('close', gone);
    ws.addEventListener('error', gone);
  }

  async hello(ws, m) {
    const tok = typeof m.tok === 'string' ? m.tok.slice(0, 64) : '';
    let seat = -1;
    if (tok) seat = this.seats.findIndex(s => s.tok === tok);
    if (seat < 0 && !this.matchId) seat = this.seats.findIndex(s => !s.tok);   // partida libre: el primero que llega es el Jugador 1
    if (seat < 0) {
      ws.send(JSON.stringify({ t: 'err', e: tok ? 'Esta sala ya tiene dos jugadores.' : 'Esta sala está completa.' }));
      try { ws.close(4001, 'full'); } catch (e) { /* ya cerrada */ }
      return -1;
    }
    const s = this.seats[seat];
    let fresh = false;
    if (!s.tok) { s.tok = crypto.randomUUID().replace(/-/g, ''); fresh = true; }
    if (s.ws && s.ws !== ws) { try { s.ws.close(4002, 'replaced'); } catch (e) { /* nada */ } }
    s.ws = ws;
    s.hidden = false;
    if (typeof m.sid === 'string' && m.sid && !this.matchId) {       // usuario registrado (partida libre): nombre y estadísticas
      try {
        const r = await this.env.HUB.get(this.env.HUB.idFromName('main')).fetch('https://hub/internal/who', { method: 'POST', body: JSON.stringify({ sid: m.sid }) });
        const w = await r.json();
        if (w && w.pid) { s.pid = w.pid; s.name = w.name; }
      } catch (e) { /* sin cuenta */ }
    }
    if (Number.isInteger(m.team) && m.team >= -1 && m.team < 64) s.team = m.team;
    ws.send(JSON.stringify({ t: 'hi', me: seat, tok: s.tok, room: m.room }));
    if (fresh || m.team !== undefined) await this.save();
    if (fresh && !this.matchId && this.seats[1 - seat].tok) this.pushTo(1 - seat, 'game', 'Fútbol Monedas', (s.name || 'Tu rival') + ' se ha unido a la partida.', 'union');
    this.lastAct = Date.now();
    if (!this.g.idleWait && !this.g.over) this.run();            // la sala se ha recuperado a mitad de jugada
    if (!this.idleT) {
      this.idleT = setInterval(() => {
        if (Date.now() - this.lastAct > IDLE_MS) for (const x of this.seats) { try { if (x.ws) x.ws.close(4000, 'idle'); } catch (e) { /* nada */ } }
      }, 60000);
    }
    this.broadcast(true);
    this.botCheck();
    return seat;
  }

  onMsg(seat, m, ws) {
    const s = this.seats[seat];
    switch (m.t) {
      case 'vis': s.hidden = !!m.h; return;           // el móvil avisa si la app está en segundo plano
      case 'p': try { ws.send('{"t":"q"}'); } catch (e) { /* nada */ } return;
      case 'hi': this.send(ws, this.snap()); return;
      case 'aim': {                                    // lo que apunta o arrastra el jugador que tiene el turno, en directo para el rival
        if (seat !== this.g.turn || !(this.g.phase === 'aim' || this.g.phase === 'place')) return;
        const now = Date.now();
        if (now - (s.lastAim || 0) < 40) return;
        s.lastAim = now;
        const o = this.seats[1 - seat];
        if (!o || !o.ws) return;
        const n = v => (typeof v === 'number' && isFinite(v)) ? v : 0;
        if (Array.isArray(m.pl)) this.send(o.ws, { t: 'aim', pl: [n(m.pl[0]), n(m.pl[1])] });
        else this.send(o.ws, { t: 'aim', s: Math.max(1, Math.min(3, n(m.s) | 0)), ux: n(m.ux), uy: n(m.uy), e: n(m.e), p: n(m.p), ok: m.ok ? 1 : 0 });
        return;
      }
      case 'chat': {                                   // mensaje al rival (no se guarda)
        const now = Date.now();
        if (now - (s.lastChat || 0) < 700) return;
        const x = typeof m.x === 'string' ? m.x.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 100) : '';
        if (!x) return;
        s.lastChat = now;
        const o = this.seats[1 - seat];
        if (o && o.ws) this.send(o.ws, { t: 'chat', f: seat, x });
        if (o) this.pushTo(1 - seat, 'chat', s.name || 'Tu rival', x, 'chat');
        return;
      }
      case 'team':
        if (Number.isInteger(m.i) && m.i >= -1 && m.i < 64) { s.team = m.i; this.save(); this.broadcast(true); }
        return;
      case 'leave': this.leave(seat); return;
      case 'shot':
        if (this.left >= 0) return;
        if (this.g.shot(seat, m)) { this.lastAct = Date.now(); this.run(); this.broadcast(true); this.botCheck(); }
        else this.send(ws, this.snap());
        return;
      case 'place':
        if (this.left >= 0) return;
        if (this.g.placeCoin(seat, m)) { this.lastAct = Date.now(); this.run(); this.broadcast(true); this.save(); this.botCheck(); }
        else this.send(ws, this.snap());
        return;
      case 'new': {                                    // revancha (amistoso online): empieza cuando la piden los dos
        if (!this.g.over || this.matchId || this.left >= 0 || this.gone >= 0) return;
        s.rv = true;
        const o = this.seats[1 - seat];
        if (o.bot || o.rv) { this.g.newGame(); this.seats.forEach(x => { x.rv = false; }); this.reported = false; this.lastAct = Date.now(); this.save(); }
        this.broadcast(true);
        return;
      }
    }
  }

  leave(seat) {                                   // un jugador abandona a mitad de partida: se desconecta al rival y la partida queda nula (sin resultado ni estadísticas)
    const o = this.seats[1 - seat];
    if (this.left >= 0 || this.gone >= 0 || !o || !o.tok) return;
    if (this.g.over) {                               // la partida ya había terminado: no es un abandono, solo se acaba la revancha
      if (!this.matchId) { this.gone = seat; this.seats.forEach(x => { x.rv = false; }); this.save(); this.broadcast(true); }
      return;
    }
    this.stop();
    this.reported = true;
    const msg = JSON.stringify({ t: 'left', n: this.seats[seat].name || '' });
    if (o.ws) { try { o.ws.send(msg); } catch (e) { /* cerrada */ } }
    this.pushTo(1 - seat, 'game', 'Fútbol Monedas', (this.seats[seat].name || 'Tu rival') + ' ha abandonado la partida. Queda nula.', 'abandono');
    if (this.matchId) { this.g.newGame(); this.reported = false; }   // partido de torneo: vuelve a 0-0 para poder jugarse de nuevo (el creador también puede dar el pase directo)
    else this.left = seat;
    this.lastAct = Date.now();
    this.save();
    this.broadcast(true);
  }

  snap() {
    const o = this.g.snapshot(this.seats.map(s => s.team));
    o.up = this.seats.map(s => !!s.ws || s.bot);
    o.nm = this.seats.map(s => s.name || '');
    o.tn = this.matchId ? 1 : 0;
    if (this.left >= 0) o.vd = this.left;
    if (this.gone >= 0) o.gn = this.gone;
    o.rv = this.seats.map(x => !!x.rv);            // quién ha pedido la revancha
    return o;
  }
  send(ws, o) { try { ws.send(JSON.stringify(o)); } catch (e) { /* cerrada */ } }
  broadcast(force) {
    const key = this.g.key;
    const data = JSON.stringify(this.snap());
    this.syncKey = key;
    for (const s of this.seats) if (s.ws) { try { s.ws.send(data); } catch (e) { /* cerrada */ } }
  }

  run() {                                   // el reloj de la física solo funciona mientras algo se mueve
    if (this.timer) return;
    this.last = Date.now();
    this.acc = 0;
    this.timer = setInterval(() => this.tick(), 16);
  }
  stop() { if (this.timer) { clearInterval(this.timer); this.timer = null; } }
  tick() {
    const now = Date.now();
    this.acc += Math.min(100, now - this.last);
    this.last = now;
    let key0 = this.g.key;
    while (this.acc >= STEP) { this.g.step(); this.syncN++; this.acc -= STEP; }
    const moving = this.g.moving;
    if (this.g.key !== key0 || (moving && this.syncN % 2 === 0) || this.syncN % 60 === 0) { this.syncN = 0; this.broadcast(); }
    if (this.g.over) this.finish();
    if (this.g.idleWait || this.g.over) { this.stop(); this.broadcast(); this.save(); this.botCheck(); }
  }

  away(i) { const s = this.seats[i]; return !!s && !s.bot && (!s.ws || s.hidden); }
  pushTo(i, kind, title, body, tag) {             // aviso al móvil del jugador i (solo si tiene usuario y no está mirando el juego)
    const s = this.seats[i];
    if (!s || s.bot || !(s.pid > 0) || !this.away(i)) return;
    const now = Date.now(), k = 'p_' + kind;
    if (now - (s[k] || 0) < 4000) return;
    s[k] = now;
    try {
      this.env.HUB.get(this.env.HUB.idFromName('main')).fetch('https://hub/internal/push', { method: 'POST', body: JSON.stringify({ pid: s.pid, kind, title, body, tag }) }).catch(() => {});
    } catch (e) { /* sin aviso */ }
  }
  notifyTurn() {                                  // le toca a un jugador que no está mirando: aviso
    if (this.g.over || !this.g.idleWait) return;
    const key = this.g.turn + '|' + this.g.phase + '|' + this.g.score + '|' + this.g.movesLeft;
    if (key === this.turnKey) return;
    this.turnKey = key;
    if (this.g.phase === 'aim' || this.g.phase === 'place') this.pushTo(this.g.turn, 'game', '¡Te toca!', 'Es tu turno en la partida.', 'turno');
  }
  botCheck() {
    this.notifyTurn();                               // si le toca mover a un bot (partido de torneo contra la IA), piensa y juega
    if (this.thinking || this.g.over || !this.g.idleWait) return;
    const seat = this.g.turn, s = this.seats[seat];
    if (!s || !s.bot || !this.seats.some(x => !x.bot && x.ws)) return;
    this.thinking = true;
    setTimeout(() => {
      plan(this.g, seat, 2, a => {
        this.thinking = false;
        if (this.g.turn !== seat || !this.g.idleWait || this.g.over) return;
        let ok = a.t === 'shot' ? this.g.shot(seat, a) : this.g.placeCoin(seat, a);
        if (!ok && this.g.phase === 'place') { const i = this.g.placeInfo(); ok = this.g.placeCoin(seat, { x: i.init.x, y: i.init.y }); }
        if (ok) { this.lastAct = Date.now(); this.run(); this.broadcast(true); if (a.t === 'place') this.save(); this.botCheck(); }
        else setTimeout(() => this.botCheck(), 1000);
      });
    }, 900 + Math.random() * 900);
  }

  async finish() {
    if (this.reported) return;
    this.reported = true;
    const sc = this.g.score;
    const a = this.seats[0], b = this.seats[1];
    if (!this.matchId && !(a.pid && b.pid)) return;
    try {
      await this.env.HUB.get(this.env.HUB.idFromName('main')).fetch('https://hub/internal/result', {
        method: 'POST',
        body: JSON.stringify({ matchId: this.matchId, p0: a.pid, p1: b.pid, s0: sc[0], s1: sc[1], t0: a.team, t1: b.team })
      });
    } catch (e) { this.reported = false; }
    this.save();
  }

  checkEmpty() {
    if (this.seats.some(s => s.ws)) return;
    this.stop();
    if (this.idleT) { clearInterval(this.idleT); this.idleT = null; }
    this.save();
  }
}
