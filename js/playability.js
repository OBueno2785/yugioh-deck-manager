/* Jugadas: análisis de manos como thedeckspace.com y el video «Your Deckbuilding Theory is OUTDATED» (Gnurrgard,
 * 2026-10-30) que Oscar pidió como referencia el 2026-10-31. La hipergeométrica de siempre dice si abres un starter; esto
 * dice si abres una JUGADA y cuántas jugadas independientes tienes (cuántas handtraps aguantas):
 *  - Roles del motor: ★ Starter (sola es jugada), Starter 1,5 (necesita otra carta: del motor, un monstruo, una mágica o
 *    una trampa) y Pieza de combo (jugada con su pareja). Ladrillo es la carta que no quieres abrir; si «anula» a un
 *    starter, abrirlos juntos deja ese starter sin jugada (Mind Shuffle con Black Chaos en el video).
 *  - Dos fuentes de jugada son la misma jugada si comparten carta (2 copias de algo 1 vez por turno), si las dos usan la
 *    Invocación Normal o si las marcaste así en «Revisar pares» (las dos terminan en la misma carta que te cortan).
 *    Jugadas = el mayor grupo de fuentes que no son la misma jugada entre sí.
 *  - Todo es exacto: recorre cada mano posible por grupos de cartas (hipergeométrica multivariable).
 * Expone window.YGO.play. Lo usa js/handtest.js (panel «Jugadas» de la prueba de mano). */
(function () {
  const YGO = (window.YGO = window.YGO || {});

  const LF = [0];
  for (let i = 1; i <= 400; i++) LF[i] = LF[i - 1] + Math.log(i);
  const lnC = (n, k) => (k < 0 || k > n ? -Infinity : LF[n] - LF[k] - LF[n - k]);

  const ROLE_KEYS = ['starter', 'starter15', 'combo2', 'extender', 'handtrap', 'brick'];
  const ENGINE = new Set(['starter', 'starter15', 'combo2']);
  const REQS = ['engine', 'monster', 'spell', 'trap'];
  const MAX_DECK = 60;
  const pairKey = (a, b) => (Number(a) < Number(b) ? a + '|' + b : b + '|' + a);
  const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : null);

  /** Rol de una carta en un mazo: los starters ★ van en mazo.starters (los usa el rival con handtraps), el resto en mazo.roles */
  function roleOf(d, id) {
    id = Number(id);
    if ((d.starters || []).map(Number).includes(id)) return 'starter';
    const r = d.roles && d.roles[id];
    return ROLE_KEYS.includes(r) && r !== 'starter' ? r : '';
  }
  /** Cambia el rol de una carta ('' lo quita) */
  function setRole(d, id, role) {
    id = Number(id);
    d.starters = (d.starters || []).filter((x) => Number(x) !== id);
    d.roles = Object.assign({}, d.roles);
    delete d.roles[id];
    if (role === 'starter') d.starters.push(id);
    else if (ROLE_KEYS.includes(role)) d.roles[id] = role;
  }
  /** Etiquetas de una carta: { ns, nopt, req, links: [ids], kills: [ids] } (siempre un objeto nuevo) */
  function tagsOf(d, id) {
    const t = obj(d.tags && d.tags[id]) || {};
    const ids = (x) => (Array.isArray(x) ? x.map(Number).filter((v) => Number.isInteger(v) && v > 0 && v !== Number(id)) : []);
    return { ns: !!t.ns, nopt: !!t.nopt, req: REQS.includes(t.req) ? t.req : 'engine', links: ids(t.links), kills: ids(t.kills) };
  }
  /** Guarda las etiquetas (borra las vacías para no ensuciar el mazo) */
  function setTags(d, id, t) {
    d.tags = Object.assign({}, obj(d.tags));
    const v = {};
    if (t.ns) v.ns = true;
    if (t.nopt) v.nopt = true;
    if (t.req && t.req !== 'engine' && REQS.includes(t.req)) v.req = t.req;
    if (t.links && t.links.length) v.links = Array.from(new Set(t.links.map(Number)));
    if (t.kills && t.kills.length) v.kills = Array.from(new Set(t.kills.map(Number)));
    if (Object.keys(v).length) d.tags[id] = v; else delete d.tags[id];
    if (!Object.keys(d.tags).length) delete d.tags;
  }
  /** Lo que marcaste en «Revisar pares»: 1 (misma jugada), 2 (dos jugadas) o 0 (sin revisar) */
  const pairLabel = (d, a, b) => { const v = obj(d.pairs) && d.pairs[pairKey(a, b)]; return v === 1 || v === 2 ? v : 0; };
  function setPair(d, a, b, v) {
    d.pairs = Object.assign({}, obj(d.pairs));
    if (v === 1 || v === 2) d.pairs[pairKey(a, b)] = v; else delete d.pairs[pairKey(a, b)];
    if (!Object.keys(d.pairs).length) delete d.pairs;
  }

  /** Clase de carta para los requisitos de un Starter 1,5 */
  function frameOf(id) {
    const db = YGO.db, c = db && db.get(id);
    if (!c) return '';
    return db.isSpell(c) ? 'spell' : db.isTrap(c) ? 'trap' : 'monster';
  }

  /** El mazo como tipos de carta para recorrer manos. Las cartas del motor, las que se nombran en una pareja o en «anula» y
   * los ladrillos que anulan van una por una; el resto se agrupa (ladrillos, extenders y no-motor; por clase de carta solo
   * si algún Starter 1,5 pide un monstruo, una mágica o una trampa). opts.extra: cartas no-motor de relleno que se agregan
   * (análisis del tamaño del mazo). */
  function model(d, opts) {
    opts = opts || {};
    const frame = opts.frame || frameOf;
    const counts = new Map();
    for (const id of d.main || []) counts.set(Number(id), (counts.get(Number(id)) || 0) + 1);
    const role = new Map(), tags = new Map();
    for (const id of counts.keys()) { role.set(id, roleOf(d, id)); tags.set(id, tagsOf(d, id)); }
    const inDeck = (x) => counts.has(x);
    const single = new Set();
    let needFrame = false;
    for (const id of counts.keys()) {
      const r = role.get(id), t = tags.get(id);
      if (ENGINE.has(r)) {
        single.add(id);
        if (r === 'combo2') t.links.filter(inDeck).forEach((x) => single.add(x));
        if (r === 'starter15' && t.req !== 'engine') needFrame = true;
      }
    }
    for (const id of counts.keys()) {
      if (role.get(id) === 'brick' && tags.get(id).kills.some((x) => inDeck(x) && ENGINE.has(role.get(x)))) single.add(id);
    }
    // Quién nombra a quién (una Pieza de combo sin parejas hace combo con otra Pieza de combo sin parejas)
    const named = new Set();
    for (const id of single) if (role.get(id) === 'combo2') tags.get(id).links.filter(inDeck).forEach((x) => named.add(x));
    const types = [], typeOf = new Map();
    for (const id of single) {
      const r = role.get(id), t = tags.get(id);
      typeOf.set(id, types[types.push({
        key: String(id), id, count: counts.get(id), role: r, ns: t.ns && ENGINE.has(r), nopt: t.nopt && ENGINE.has(r), req: t.req,
        frame: frame(id), links: new Set(r === 'combo2' ? t.links.filter(inDeck) : []),
        kills: new Set(r === 'brick' ? t.kills.filter((x) => inDeck(x) && ENGINE.has(role.get(x))) : []),
        free: r === 'combo2' && !t.links.some(inDeck) && !named.has(id),
      }) - 1]);
    }
    const groups = new Map();
    for (const [id, n] of counts) {
      if (single.has(id)) continue;
      const r = role.get(id);
      const cls = r === 'brick' ? 'brick' : r === 'extender' ? 'extender' : 'other';
      const f = needFrame ? frame(id) : '';
      const key = 'g:' + cls + (f ? ':' + f : '');
      const g = groups.get(key) || { key, id: 0, count: 0, role: cls === 'other' ? '' : cls, group: cls, frame: f, links: new Set(), kills: new Set() };
      g.count += n;
      groups.set(key, g);
      typeOf.set(id, g);
    }
    const extra = Math.max(0, Math.floor(opts.extra || 0));
    if (extra) {
      const g = groups.get('g:other') || { key: 'g:other', id: 0, count: 0, role: '', group: 'other', frame: '', links: new Set(), kills: new Set() };
      g.count += extra;
      groups.set('g:other', g);
    }
    const list = types.concat(Array.from(groups.values()));
    list.forEach((t, i) => { t.idx = i; });
    const N = list.reduce((s, t) => s + t.count, 0);
    const pairs = new Map();
    for (const [k, v] of Object.entries(obj(d.pairs) || {})) if (v === 1 || v === 2) pairs.set(k, v);
    const index = new Map();
    for (const [id, t] of typeOf) index.set(id, t.idx);
    return { N, types: list, pairs, extra, index };
  }

  /** Una mano concreta (códigos) → { plays, sources: [[ids]], dead, why } (why: por qué es ladrillo) */
  function handPlays(m, ids) {
    const x = new Array(m.types.length).fill(0);
    for (const id of ids) { const i = m.index.get(Number(id)); if (i != null) x[i]++; }
    const s = sourcesOf(m, x);
    const plays = playCount(m, s.src);
    return { plays, sources: s.src.map((f) => f.ids.slice()), why: plays ? '' : s.anyCancelled ? 'cancel' : s.hasEngine ? 'incomplete' : s.bricks ? 'garnets' : 'empty' };
  }

  /** Las fuentes de jugada de una mano (x = copias de cada tipo) y cómo quedó cada carta */
  function sourcesOf(m, x) {
    const T = m.types;
    const cancelled = new Set();
    const fr = { monster: 0, spell: 0, trap: 0 };
    let engineCards = 0, bricks = 0, hasEngine = false;
    for (let i = 0; i < T.length; i++) {
      if (!x[i]) continue;
      const t = T[i];
      if (t.role === 'brick') { bricks += x[i]; t.kills.forEach((k) => cancelled.add(k)); }
      if (ENGINE.has(t.role) || t.role === 'extender') engineCards += x[i];
      if (ENGINE.has(t.role)) hasEngine = true;
      if (t.frame) fr[t.frame] += x[i];
    }
    const src = [];
    let anyCancelled = false;
    for (let i = 0; i < T.length; i++) {
      const t = T[i];
      if (!x[i] || !ENGINE.has(t.role)) continue;
      if (cancelled.has(t.id)) { anyCancelled = true; continue; }
      if (t.role === 'starter15') {
        const ok = t.req === 'engine' ? engineCards - x[i] >= 1 : fr[t.req] - (t.frame === t.req ? x[i] : 0) >= 1;
        if (!ok) continue;
      }
      if (t.role === 'starter' || t.role === 'starter15') {
        const k = t.nopt ? x[i] : 1;
        for (let c = 0; c < k; c++) src.push({ ids: [t.id], ns: t.ns, copy: t.nopt, type: i });
        continue;
      }
      // Pieza de combo: una jugada por cada pareja en la mano
      for (let j = 0; j < T.length; j++) {
        const u = T[j];
        if (j === i || !x[j] || !u.id || cancelled.has(u.id)) continue;
        const linked = t.links.has(u.id) || (u.role === 'combo2' && u.links.has(t.id)) || (t.free && u.free);
        if (!linked) continue;
        if (u.role === 'combo2' && j < i) continue; // la pareja ya se contó desde la otra pieza
        src.push({ ids: [t.id, u.id], ns: t.ns || (u.ns && ENGINE.has(u.role)), copy: false, type: i, other: j });
      }
    }
    return { src, cancelled, anyCancelled, hasEngine, bricks };
  }

  /** ¿Dos fuentes son la misma jugada? Lo que marcaste en «Revisar pares» manda; si no, comparten carta o las dos usan la
   * Invocación Normal (las copias de una carta que no es 1 vez por turno son jugadas distintas) */
  function sameAs(m, s, t) {
    const share = s.ids.some((a) => t.ids.includes(a));
    if (share && !(s.copy && t.copy && s.ids.length === 1 && t.ids.length === 1)) return true;
    let one = false, two = false;
    for (const a of s.ids) for (const b of t.ids) {
      if (a === b) continue;
      const v = m.pairs.get(pairKey(a, b));
      if (v === 1) one = true; else if (v === 2) two = true;
    }
    if (one) return true;
    if (two) return false;
    return !!(s.ns && t.ns);
  }
  /** Jugadas independientes: el mayor grupo de fuentes sin «misma jugada» entre ellas */
  function playCount(m, src) {
    const k = src.length;
    if (k <= 1) return k;
    const adj = new Array(k).fill(0);
    for (let a = 0; a < k; a++) for (let b = a + 1; b < k; b++) if (sameAs(m, src[a], src[b])) { adj[a] |= 1 << b; adj[b] |= 1 << a; }
    if (adj.every((v) => !v)) return k;
    const lim = Math.min(k, 16);
    let best = 1;
    for (let mask = 1; mask < 1 << lim; mask++) {
      let bits = 0, ok = true;
      for (let a = 0; a < lim && ok; a++) if (mask & (1 << a)) { if (adj[a] & mask) ok = false; bits++; }
      if (ok && bits > best) best = bits;
    }
    return best;
  }

  /** Recorre cada mano posible de n cartas → { pPlay, dist [0, 1, 2, 3+ jugadas], pTwo, avgPlays (de las manos con jugada),
   * deadDist [0, 1, 2, 3+], avgDead, breakdown { empty, garnets, incomplete, cancel }, cards [{ id, pIn, pPlay, pOne }] } */
  function analyze(m, n) {
    const T = m.types, N = m.N;
    if (n > N) n = N;
    const base = lnC(N, n);
    const x = new Array(T.length).fill(0);
    const out = { n, N, pPlay: 0, dist: [0, 0, 0, 0], avgPlays: 0, pTwo: 0, deadDist: [0, 0, 0, 0], avgDead: 0,
      breakdown: { empty: 0, garnets: 0, incomplete: 0, cancel: 0 }, cards: [] };
    const per = T.map(() => ({ pIn: 0, pPlay: 0, pOne: 0 }));
    let playsSum = 0, deadSum = 0;
    // Lo que queda después de cada tipo: corta las ramas que no pueden completar la mano
    const after = new Array(T.length + 1).fill(0);
    for (let i = T.length - 1; i >= 0; i--) after[i] = after[i + 1] + T[i].count;
    (function walk(i, used, ln) {
      if (used === n) { leaf(Math.exp(ln - base)); return; }
      if (i === T.length || after[i] < n - used) return;
      const max = Math.min(T[i].count, n - used);
      for (let v = max; v >= 0; v--) {
        x[i] = v;
        walk(i + 1, used + v, ln + lnC(T[i].count, v));
      }
      x[i] = 0;
    })(0, 0, 0);
    function leaf(w) {
      const s = sourcesOf(m, x);
      const plays = playCount(m, s.src);
      out.dist[Math.min(3, plays)] += w;
      if (plays) { out.pPlay += w; playsSum += w * plays; if (plays >= 2) out.pTwo += w; }
      else out.breakdown[s.anyCancelled ? 'cancel' : s.hasEngine ? 'incomplete' : s.bricks ? 'garnets' : 'empty'] += w;
      // Cartas muertas: ladrillos, extenders sin jugada y piezas del motor que no aportan (anuladas, sin su pareja o
      // requisito, o copias de más de algo 1 vez por turno)
      const usedBy = new Map();
      for (const f of s.src) { for (const id of f.ids) usedBy.set(id, (usedBy.get(id) || 0) + (f.copy ? 1 : 0)); }
      let dead = 0;
      for (let i = 0; i < T.length; i++) {
        if (!x[i]) continue;
        const t = T[i];
        if (t.role === 'brick') dead += x[i];
        else if (t.role === 'extender') { if (!plays) dead += x[i]; }
        else if (ENGINE.has(t.role)) {
          const u = usedBy.has(t.id) ? Math.max(1, usedBy.get(t.id)) : 0;
          dead += Math.max(0, x[i] - u);
        }
        if (t.id && ENGINE.has(t.role)) {
          per[i].pIn += w;
          if (plays) per[i].pPlay += w;
          if (plays === 1) per[i].pOne += w;
        }
      }
      out.deadDist[Math.min(3, dead)] += w;
      deadSum += w * dead;
    }
    out.avgPlays = out.pPlay ? playsSum / out.pPlay : 0;
    out.avgDead = deadSum;
    out.cards = T.map((t, i) => (t.id && ENGINE.has(t.role) ? Object.assign({ id: t.id, role: t.role }, per[i]) : null)).filter(Boolean);
    return out;
  }

  /** P(abrir al menos una copia de a y de b) en una mano de n */
  function pBoth(N, ka, kb, n) {
    if (n > N) n = N;
    const b = lnC(N, n);
    const p0 = (k) => Math.exp(lnC(N - k, n) - b);
    return Math.max(0, 1 - p0(ka) - p0(kb) + Math.exp(lnC(N - ka - kb, n) - b));
  }

  /** Los pares que conviene revisar: starters (★ y 1,5) entre sí y con Piezas de combo, del que más abres al que menos →
   * [{ a, b, p, label (0 sin revisar), auto (1|2), why }] */
  function pairs(d, n) {
    const counts = new Map();
    for (const id of d.main || []) counts.set(Number(id), (counts.get(Number(id)) || 0) + 1);
    const N = (d.main || []).length;
    const eng = Array.from(counts.keys()).filter((id) => ENGINE.has(roleOf(d, id)));
    const out = [];
    for (let i = 0; i < eng.length; i++) for (let j = i + 1; j < eng.length; j++) {
      const a = eng[i], b = eng[j], ra = roleOf(d, a), rb = roleOf(d, b);
      if (ra === 'combo2' && rb === 'combo2') continue;
      const ta = tagsOf(d, a), tb = tagsOf(d, b);
      const auto = ta.ns && tb.ns ? 1 : 2;
      out.push({ a: Math.min(a, b), b: Math.max(a, b), p: pBoth(N, counts.get(a), counts.get(b), n), label: pairLabel(d, a, b), auto,
        why: auto === 1 ? 'Las dos usan la Invocación Normal' : '' });
    }
    return out.sort((x, y) => y.p - x.p || x.a - y.a || x.b - y.b);
  }

  /** Cuántas cartas que usan la Invocación Normal abres → { k: copias en el mazo, dist [0, 1, 2, 3+] } */
  function normalSummons(d, n) {
    const N = (d.main || []).length;
    const K = (d.main || []).filter((id) => ENGINE.has(roleOf(d, id)) && tagsOf(d, id).ns).length;
    if (n > N) n = N;
    const b = lnC(N, n);
    const p = (k) => Math.exp(lnC(K, k) + lnC(N - K, n - k) - b);
    const dist = [p(0), p(1), p(2)];
    dist.push(Math.max(0, 1 - dist[0] - dist[1] - dist[2]));
    return { k: K, dist };
  }

  /** Rango normal (95%) de cuántas veces pasa algo en intentos con probabilidades distintas (binomial de Poisson) */
  function range95(ps) {
    let f = [1];
    for (const p of ps) {
      const g = new Array(f.length + 1).fill(0);
      for (let i = 0; i < f.length; i++) { g[i] += f[i] * (1 - p); g[i + 1] += f[i] * p; }
      f = g;
    }
    let c = 0, lo = -1, hi = -1;
    for (let k = 0; k < f.length; k++) { c += f[k]; if (lo < 0 && c >= 0.025) lo = k; if (hi < 0 && c >= 0.975) { hi = k; break; } }
    return { lo: Math.max(0, lo), hi: hi < 0 ? f.length - 1 : hi, p0: f[0], dist: f };
  }

  /* Torneo: cada ronda son 3 partidas. Cuántas vas primero (mano de 5) por ronda según la idea que tengas:
   * prudente 2 (pierdes el dado y te toca empezar más), normal 1,5 (cada partida a la mitad) y optimista 1. */
  const MODES = { prudente: 2, normal: 1.5, optimista: 1 };
  /** → { games, expected, lo, hi, pAny, dist } con brick5 / brick6 = P(ladrillo) con mano de 5 / de 6; dist[k] = P(k partidas así) */
  function tournament(brick5, brick6, rounds, mode) {
    const g1 = MODES[mode] != null ? MODES[mode] : 1.5;
    const ps = [];
    for (let r = 0; r < rounds; r++) {
      if (g1 === 1.5) ps.push((brick5 + brick6) / 2, (brick5 + brick6) / 2, (brick5 + brick6) / 2);
      else for (let g = 0; g < 3; g++) ps.push(g < g1 ? brick5 : brick6);
    }
    const r = range95(ps);
    return { games: ps.length, expected: ps.reduce((s, p) => s + p, 0), lo: r.lo, hi: r.hi, pAny: 1 - r.p0, dist: r.dist };
  }

  /** Cómo cambia el mazo si agregas no-motor (handtraps u otras cartas que no son del motor) hasta 60 →
   * [{ size, pPlay, pTwo, avgPlays, avgDead }] (la primera fila es el mazo como está) */
  function fillers(d, n, opts) {
    const N = (d.main || []).length, out = [];
    for (let k = 0; N + k <= MAX_DECK; k++) {
      const a = analyze(model(d, Object.assign({}, opts, { extra: k })), n);
      out.push({ size: N + k, pPlay: a.pPlay, pTwo: a.pTwo, avgPlays: a.avgPlays, avgDead: a.avgDead, one: a.dist[1] });
    }
    return out;
  }

  /** Las cartas que más te dejan con una sola jugada (con ellas en la mano), de la peor a la mejor */
  function weakLinks(a, minIn) {
    return a.cards.filter((c) => c.pPlay > 0 && c.pIn >= (minIn == null ? 0.02 : minIn))
      .map((c) => Object.assign({}, c, { share: c.pOne / c.pPlay }))
      .sort((x, y) => y.share - x.share || y.pIn - x.pIn);
  }

  YGO.play = { ROLE_KEYS, ENGINE, REQS, MODES, MAX_DECK, pairKey, roleOf, setRole, tagsOf, setTags, pairLabel, setPair, model, analyze,
    handPlays, pairs, pBoth, normalSummons, tournament, fillers, weakLinks, range95, _sourcesOf: sourcesOf, _playCount: playCount };
})();
