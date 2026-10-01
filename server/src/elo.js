// Fuerza actual de cada equipo (Elo de clubes, septiembre de 2026; los de LaLiga y Segunda, de elofootball.com/clubelo.com;
// los equipos sin dato fiable, estimados). MISMO ORDEN que TEAMS en index.html (0-19 Primera, 20-41 Segunda, 42-63 resto de Europa).
export const TEAM_ELO = [
  1995, 2148, 1935, 1975, 1905, 1860, 2298, 1900, 1860, 1700, 1775, 1935, 1650, 1895, 2036, 2243, 1965, 1905, 2006, 2039,   // 0-19
  1600, 1735, 1650, 1770, 1700, 1655, 1870, 1660, 1600, 1570, 1700, 1620, 1890, 1780, 1600, 1900, 1850, 1730, 1720, 1765, 1795, 1825,   // 20-41
  2288, 2346, 2156, 2086, 2183, 2046, 2113, 2199, 2227, 2061, 2088, 2090, 2072, 2110, 2399, 2154, 2128, 2315, 1995, 2115, 2136, 2082   // 42-63
];
const ORDER = TEAM_ELO.map((_, i) => i).sort((a, b) => TEAM_ELO[b] - TEAM_ELO[a]);
// Nivel de la IA del torneo: de qué equipos salen los rivales de IA (3 = los mejores del mundo hoy, 1 = la parte baja)
export const AI_POOLS = { 3: ORDER.slice(0, 20), 2: ORDER.slice(20, 42), 1: ORDER.slice(42) };
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export function botTeam(level, tid, k) {          // equipo de la IA número k (1, 2, 3…) de un torneo: siempre el mismo, y distinto entre IA
  const pool = ORDER.slice(), r = rng(tid * 7919 + level);   // cualquier equipo puede tocar en cualquier nivel; lo bueno que sea decide cuánto mejora o empeora la IA
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  return pool[(k - 1) % pool.length];
}
// Equipos de la IA de un torneo: del grupo de su nivel (Pesadilla top 5, Difícil 6-15, Normal 16-30, Fácil 31-último); si el grupo se queda corto,
// se completa con los puestos más cercanos al grupo. Nunca repite equipo entre las IA ni con los de los jugadores humanos.
export const AI_TIERS = { 1: [30, 64], 2: [15, 30], 3: [5, 15], 4: [0, 5] };
export function botTeams(level, tid, humanTeams, n) {
  const [lo, hi] = AI_TIERS[level] || AI_TIERS[2], taken = new Set((humanTeams || []).filter(t => t >= 0));
  const r = rng(tid * 7919 + level), inTier = ORDER.slice(lo, hi).filter(t => !taken.has(t));
  for (let i = inTier.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [inTier[i], inTier[j]] = [inTier[j], inTier[i]]; }
  const dist = rk => (rk < lo ? lo - rk : rk - hi + 1);
  const rest = ORDER.map((t, rk) => ({ t, rk })).filter(x => (x.rk < lo || x.rk >= hi) && !taken.has(x.t)).sort((a, b) => dist(a.rk) - dist(b.rk)).map(x => x.t);
  return inTier.concat(rest).slice(0, n);
}
export const eloOf = t => (t >= 0 && t < TEAM_ELO.length ? TEAM_ELO[t] : 1900);
export const AIENG = [0, 2, 3, 4, 5];   // nivel de la app (1 Fácil, 2 Normal, 3 Difícil, 4 Pesadilla) → nivel del motor de IA; igual que jugar contra la IA
// Nivel real de la IA = nivel elegido (Fácil/Normal/Difícil/Pesadilla) ± el efecto del equipo: de -1,5 (equipo flojo) a +1,5 (equipo top).
// Es más que un escalón entero, así que un grande en Fácil juega mejor que un equipo pequeño en Normal.
export const botSkill = (elo, level) => Math.max(0.3, Math.min(5, (AIENG[level] || 3) + 3 * (Math.max(0, Math.min(1, (elo - 1650) / (2400 - 1650))) - 0.5)));
export const winProb = (e0, e1) => 1 / (1 + Math.pow(10, (e1 - e0) / 400));
