// Punto de entrada: reparte las conexiones a las salas (WebSocket) y las peticiones de cuentas/torneos a la base de datos.
export { Room } from './room.js';
export { Hub } from './hub.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (url.pathname.startsWith('/ws/')) {
      const code = url.pathname.slice(4).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
      if (!code) return new Response('Falta el código', { status: 400 });
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('Se esperaba WebSocket', { status: 426 });
      return env.ROOM.get(env.ROOM.idFromName(code)).fetch(req);
    }
    if (env.TEST && url.pathname.startsWith('/internal/')) return env.HUB.get(env.HUB.idFromName('main')).fetch(req);   // solo en pruebas locales
    if (url.pathname.startsWith('/api/')) {
      const r = await env.HUB.get(env.HUB.idFromName('main')).fetch(req);
      const h = new Headers(r.headers);
      for (const k in CORS) h.set(k, CORS[k]);
      return new Response(r.body, { status: r.status, headers: h });
    }
    return new Response('Servidor de Fútbol Monedas: en marcha', { headers: { 'content-type': 'text/plain; charset=utf-8', ...CORS } });
  }
};
