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
      case 'p': try { ws.send('{"t":"q"}'); } catch (e) { /* nada */ } return;
      case 'hi': this.send(ws, this.snap()); return;
      case 'chat': {                                   // mensaje al rival (no se guarda)
        const now = Date.now();
        if (now - (s.lastChat || 0) < 700) return;
        const x = typeof m.x === 'string' ? m.x.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 100) : '';
        if (!x) return;
        s.lastChat = now;
        const o = this.seats[1 - seat];
        if (o && o.ws) this.send(o.ws, { t: 'chat', f: seat, x });
        return;
      }
      case 'team':
        if (Number.isInteger(m.i) && m.i >= -1 && m.i < 64) { s.team = m.i; this.save(); this.broadcast(true); }
        return;
      case 'shot':
        if (this.g.shot(seat, m)) { this.lastAct = Date.now(); this.run(); this.broadcast(true); this.botCheck(); }
        else this.send(ws, this.snap());
        return;
      case 'place':
        if (this.g.placeCoin(seat, m)) { this.lastAct = Date.now(); this.run(); this.broadcast(true); this.save(); this.botCheck(); }
        else this.send(ws, this.snap());
        return;
      case 'new':
        if (this.g.over && !this.matchId) { this.g.newGame(); this.reported = false; this.lastAct = Date.now(); this.broadcast(true); this.save(); }
        return;
    }
  }

  snap() {
    const o = this.g.snapshot(this.seats.map(s => s.team));
    o.up = this.seats.map(s => !!s.ws || s.bot);
    o.nm = this.seats.map(s => s.name || '');
    o.tn = this.matchId ? 1 : 0;
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
    if (this.g.key !== key0 || (moving && this.syncN % 3 === 0) || this.syncN % 60 === 0) { this.syncN = 0; this.broadcast(); }
    if (this.g.over) this.finish();
    if (this.g.idleWait || this.g.over) { this.stop(); this.broadcast(); this.save(); this.botCheck(); }
  }

  botCheck() {                               // si le toca mover a un bot (partido de torneo contra la IA), piensa y juega
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
        body: JSON.stringify({ matchId: this.matchId, p0: a.pid, p1: b.pid, s0: sc[0], s1: sc[1] })
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
