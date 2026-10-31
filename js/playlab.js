/* Panel «Jugadas» de la prueba de mano (debajo de Consistencia) y la ventana «Etiquetas» de cada carta. Las cuentas son de
 * js/playability.js (YGO.play). Pedido de Oscar 2026-10-31: mejorar el análisis estadístico del mazo con el video de
 * Gnurrgard y thedeckspace.com como referencia.
 * Muestra: jugable / ladrillo / 2 o más jugadas / jugadas en promedio, cuántas jugadas abres, por qué no abres jugada, cartas
 * muertas, eslabones débiles, Invocación Normal, torneo, «Revisar pares» y el tamaño del mazo con más no-motor.
 * Los pares revisados no cambian «jugable» (con una jugada ya juegas) sino cuántas jugadas abres: el recuadro «Lo que cambiaron
 * tus pares» compara con no revisar ninguno, y cada toque en un par dice qué movió (pedido de Oscar 2026-10-31: «falta conectar»).
 * Gráficas (js/plcharts.js, pedido de Oscar 2026-10-31 «agrega gráficas al nuevo análisis»): cuántas jugadas abres con mano de
 * 5 y de 6, sin revisar / con tus pares, eslabones débiles en barras, partidas del torneo y el tamaño del mazo en líneas.
 * Expone window.YGO.playlab = { render, editTags }. Lo llama js/handtest.js. */
(function () {
  const YGO = window.YGO;
  const { db, game, view, store } = YGO;
  const P = () => YGO.play;
  const C = () => YGO.plcharts;
  // Colores de las series (css: .pl): 1 dorado, 2 azul, 0 gris para lo que se compara
  const COL = { s1: 'var(--plc-1)', s2: 'var(--plc-2)', base: 'var(--plc-0)' };
  const DIST_CATS = ['Ladrillo', '1 jugada', '2 jugadas', '3 o más'];
  const esc = view.esc;
  const $ = (sel, root) => (root || document).querySelector(sel);

  const prefs = Object.assign({ plRounds: 4, plMode: 'normal' }, store.prefs());
  const savePrefs = () => store.savePrefs(Object.assign(store.prefs(), { plRounds: prefs.plRounds, plMode: prefs.plMode }));
  const PAIRS_SHOWN = 12;
  let allPairs = false, openPairs = false, openSize = false;
  let ctx = null; // { box, d, hand, n, hooks } del último dibujo
  let charts = {}; // las gráficas del último dibujo: id → spec (js/plcharts.js)
  let lastFx = null; // { key, a, b, v, before, after }: el último par tocado y lo que movió
  const memo = new Map();

  const pc = (p) => (p <= 1e-12 ? '0%' : p >= 1 - 1e-9 ? '100%' : p < 0.0005 ? '<0,1%' : p >= 0.9995 ? '>99,9%' : game.pct(p));
  const dec = (x, k) => (Math.round(x * Math.pow(10, k == null ? 1 : k)) / Math.pow(10, k == null ? 1 : k)).toFixed(k == null ? 1 : k).replace('.', ',');
  const grp = (x) => String(x).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const oneIn = (p) => { const v = 1 / p; const r = v < 100 ? Math.round(v) : Math.round(v / Math.pow(10, Math.floor(Math.log10(v)) - 1)) * Math.pow(10, Math.floor(Math.log10(v)) - 1); return '1 de cada ' + grp(r); };
  const nameOf = (id) => { const c = db.get(id); return c ? c.name : String(id); };
  const plural = (x, one, many) => x + ' ' + (x === 1 ? one : many || one + 's');
  const RANK = (p) => { const r = Math.round(p * 1000) / 10; return r >= 90 ? 'S' : r >= 80 ? 'A' : r >= 70 ? 'B' : r >= 60 ? 'C' : 'D'; };

  const WHY = {
    empty: ['Solo no-motor', 'ni starters ni piezas: handtraps u otras cartas'],
    garnets: ['Ladrillos sin motor', 'sin starters ni piezas, y algún ladrillo'],
    incomplete: ['Pieza sin pareja o requisito', 'un Starter 1,5 sin lo que necesita o una Pieza de combo sola'],
    cancel: ['Starter anulado', 'un ladrillo que anula tu starter vino con él'],
  };
  const ROLE_INFO = [
    ['', 'Sin rol', 'no-motor u otra carta: nunca cuenta como muerta'],
    ['starter', '★ Starter', 'sola ya es una jugada'],
    ['starter15', '★½ Starter 1,5', 'es jugada si abres además lo que necesita'],
    ['combo2', 'C2 Pieza de combo', 'es jugada con su pareja'],
    ['extender', 'E Extender', 'alarga el combo; sin jugada en la mano es carta muerta'],
    ['handtrap', 'H Handtrap', 'interrumpe al rival (no-motor)'],
    ['brick', 'L Ladrillo', 'no la quieres abrir: siempre cuenta como muerta'],
  ];
  const REQ_TXT = { engine: 'otra carta del motor', monster: 'un monstruo', spell: 'una mágica', trap: 'una trampa', cards: 'una de estas cartas…' };

  /** Clave del mazo para no repetir cuentas: lo que cambia el resultado */
  function sig(d) {
    return JSON.stringify([d.id, d.main.slice().sort((a, b) => a - b), (d.starters || []).slice().sort(), d.roles || {}, d.tags || {}, d.pairs || {}]);
  }
  function cached(key, fn) {
    if (memo.has(key)) return memo.get(key);
    if (memo.size > 40) memo.clear();
    const v = fn();
    memo.set(key, v);
    return v;
  }
  const analysisOf = (d, n) => cached(sig(d) + '#a' + n, () => { const m = P().model(d); return { m, a: P().analyze(m, n) }; });
  /** La cuenta como si no hubieras revisado ningún par */
  const rawOf = (d, n) => analysisOf(Object.assign({}, d, { pairs: undefined }), n).a;
  /** Diferencia con signo: en puntos para un % (pc), tal cual para un promedio (dec) */
  const delta = (x, f) => (x > 0 ? '+' : '−') + (f === pc ? dec(Math.abs(x) * 100) : dec(Math.abs(x)));
  const move = (x, y, f) => f(x) === f(y) ? '<b>' + f(y) + '</b> (igual)' : f(x) + ' → <b>' + f(y) + '</b>';

  /* ---------- Panel ---------- */
  function render(box, d, hand, n, hooks) {
    ctx = { box, d, hand, n, hooks };
    charts = {};
    if (!box) return;
    if (!P() || !d || !d.main.length) { box.innerHTML = ''; box.hidden = true; return; }
    box.hidden = false;
    const ae = document.activeElement;
    const focus = ae && box.contains(ae) ? (ae.dataset.pv ? '[data-pa="' + ae.dataset.pa + '"][data-pb="' + ae.dataset.pb + '"][data-pv="' + ae.dataset.pv + '"]' : ae.id ? '#' + ae.id : '') : '';
    const engine = d.main.some((id) => P().ENGINE.has(P().roleOf(d, id)));
    if (!engine) {
      box.innerHTML = '<section class="gx-card pl pl-locked" aria-labelledby="pl-h"><h4 id="pl-h">Jugadas</h4>'
        + '<p>Marca tus <b>★ starters</b>, <b>★½ starters 1,5</b> o <b>C2 piezas de combo</b> en la columna <b>Rol</b> y aquí verás si abres una '
        + '<b>jugada</b> y cuántas jugadas independientes tienes, o sea cuántas handtraps aguantas (como thedeckspace.com).</p></section>';
      return;
    }
    const o = n === 5 ? 6 : 5;
    const { m, a } = analysisOf(d, n);
    const b = analysisOf(d, o).a;
    const pairs = P().pairs(d, n);
    const pending = pairs.filter((x) => !x.label).length;
    box.innerHTML = '<section class="gx-card pl" aria-labelledby="pl-h">'
      + '<header class="pl-head"><h4 id="pl-h">Jugadas · mano de ' + n + '</h4>'
      + '<p class="pl-sub">No basta con abrir un starter: aquí cuenta si abres una <b>jugada</b> y cuántas jugadas independientes tienes. Cada jugada de más es una handtrap más que aguantas.</p></header>'
      + stats(a, b, n)
      + distChart(a, b, n)
      + handLine(d, m, hand, n)
      + fxBox(d, n, a, pairs, pending)
      + '<div class="pl-grid">' + whyBox(a) + deadBox(a) + weakBox(a, pending) + nsBox(d, n) + tourBox(d) + '</div>'
      + pairsBox(d, n, pairs, pending)
      + sizeBox(d, n)
      + '</section>';
    C().mount(box, charts);
    if (focus) { const el = box.querySelector(focus); if (el) el.focus(); }
  }
  /** El lugar de una gráfica (se dibuja con plcharts.mount al final de render) */
  const chart = (id, spec) => { charts[id] = spec; return C().place(id, spec); };

  function stats(a, b, n) {
    const brick = 1 - a.pPlay;
    const other = n === 5 ? 'Yendo segundo' : 'Yendo primero';
    const tile = (k, v, label, sub, cls) => '<div class="pl-stat' + (cls ? ' ' + cls : '') + '" data-k="' + k + '"><b>' + v + '</b><span>' + label + '</span><small>' + sub + '</small></div>';
    return '<div class="pl-stats">'
      + tile('pl-play', pc(a.pPlay), 'jugable', other + ': ' + pc(b.pPlay), 'rk-' + RANK(a.pPlay))
      + tile('pl-brick', pc(brick), 'ladrillo', brick > 1e-9 ? oneIn(brick) + ' manos' : 'nunca', 'neg')
      + tile('pl-two', pc(a.pTwo), '2 o más jugadas', 'aguantas 1 handtrap · ' + other.toLowerCase() + ': ' + pc(b.pTwo))
      + tile('pl-avg', dec(a.avgPlays), 'jugadas en promedio', 'en tus manos con jugada')
      + '</div>';
  }

  /** Cuántas jugadas abres: columnas de la mano de 5 y la de 6 (el color sigue a la mano, el valor va sobre la elegida) */
  function distChart(a, b, n) {
    const a5 = n === 5 ? a : b, a6 = n === 5 ? b : a;
    const spec = { kind: 'cols', label: 'Cuántas jugadas abres con mano de 5 y con mano de 6', cats: DIST_CATS, fmt: pc, cap: n === 5 ? 0 : 1,
      series: [{ name: 'Mano de 5 · yendo primero', color: COL.s1, values: a5.dist }, { name: 'Mano de 6 · yendo segundo', color: COL.s2, values: a6.dist }] };
    return '<div class="pl-chart pl-dist"><div class="pl-chead"><h5>Cuántas jugadas abres</h5>' + C().legend(spec) + '</div>'
      + chart('dist', spec) + C().table(spec, 'Jugadas') + '</div>';
  }

  function handLine(d, m, hand, n) {
    if (!hand.length) return '';
    const h = P().handPlays(m, hand);
    const names = (ids) => ids.map(nameOf).join(' + ');
    const size = hand.length === n ? '' : ' <small>(tiene ' + hand.length + ' cartas, no ' + n + ')</small>';
    if (!h.plays) return '<p class="pl-hand">Tu mano: <span class="bad">ladrillo</span> · ' + WHY[h.why][0].toLowerCase() + size + '</p>';
    return '<p class="pl-hand">Tu mano: <span class="good">' + plural(h.plays, 'jugada') + '</span>'
      + (h.sources.length ? ' · <span class="pl-src">' + h.sources.map((s) => esc(names(s))).join(' · ') + '</span>' : '') + size + '</p>';
  }

  /** Qué cambiaron los pares revisados frente a no revisar ninguno (o el aviso de revisarlos) */
  function fxBox(d, n, a, pairs, pending) {
    if (!pairs.length) return '';
    const warn = '<b>' + pending + ' de ' + plural(pairs.length, 'par', 'pares') + '</b>';
    if (pending === pairs.length) {
      return '<p class="pl-warn">Te faltan ' + warn + ' por revisar: sin revisar, dos starters distintos cuentan como dos jugadas aunque terminen en la misma carta que te cortan. Abre <b>Revisar pares</b>.</p>';
    }
    const r = rawOf(d, n);
    const same = Math.abs(r.pTwo - a.pTwo) < 1e-12 && Math.abs(r.avgPlays - a.avgPlays) < 1e-12;
    const row = (label, x, y, f) => '<li><span>' + label + '</span><em>' + move(x, y, f) + (f(x) === f(y) ? '' : ' <small>' + delta(y - x, f) + '</small>') + '</em></li>';
    return '<div class="pl-fx" data-k="pl-fx"><h5>Lo que cambiaron tus pares</h5>'
      + '<p class="pl-note">' + (pairs.length - pending) + ' de ' + plural(pairs.length, 'par', 'pares') + ' revisados, comparado con no revisar ninguno (mano de ' + n + '):</p>'
      + (same ? '<p class="pl-note">Las cifras quedan igual: marcaste cada par como la cuenta ya lo suponía (<b>2 jugadas</b>, o <b>1</b> si las dos usan la Invocación Normal). Solo cambian si dos cartas que no usan la Invocación Normal son <b>1 jugada</b>, o al revés.</p>'
        : '<div class="pl-fxgrid"><ul class="pl-rows pl-fxl">' + row('2 o más jugadas <small>aguantas 1 handtrap</small>', r.pTwo, a.pTwo, pc) + row('Una sola jugada <small>1 handtrap te para</small>', r.dist[1], a.dist[1], pc)
          + row('Jugadas en promedio', r.avgPlays, a.avgPlays, dec) + '</ul>' + fxChart(r, a, n) + '</div>')
      + '<p class="pl-note"><b>Jugable</b> (' + pc(a.pPlay) + ') y <b>ladrillo</b> no cambian con los pares: con una jugada ya juegas. Los pares dicen <b>cuántas handtraps aguantas</b>: cambian 2 o más jugadas, la barra, Eslabones débiles y, en Torneo, las partidas en que una handtrap te para.'
      + (pending ? ' Te faltan ' + warn + ' por revisar.' : '') + '</p></div>';
  }

  function fxChart(r, a, n) {
    const spec = { kind: 'cols', label: 'Cuántas jugadas abres sin revisar pares y con tus pares, mano de ' + n, cats: DIST_CATS, fmt: pc, cap: 1, h: 150,
      series: [{ name: 'Sin revisar', color: COL.base, values: r.dist }, { name: 'Con tus pares', color: COL.s1, values: a.dist }] };
    return '<div class="pl-chart">' + C().legend(spec) + chart('fx', spec) + C().table(spec, 'Jugadas') + '</div>';
  }

  function whyBox(a) {
    const rows = Object.keys(WHY).filter((k) => a.breakdown[k] > 1e-9).sort((x, y) => a.breakdown[y] - a.breakdown[x]);
    return '<div class="pl-box"><h5>Por qué no abres jugada</h5>'
      + (rows.length ? '<ul class="pl-rows">' + rows.map((k) => '<li><span><b>' + WHY[k][0] + '</b><small>' + WHY[k][1] + '</small></span><em>' + pc(a.breakdown[k]) + '</em></li>').join('') + '</ul>'
        : '<p class="pl-note">Siempre abres jugada.</p>') + '</div>';
  }

  function deadBox(a) {
    const lab = ['Ninguna', '1', '2', '3 o más'];
    return '<div class="pl-box"><h5>Cartas muertas</h5><p class="pl-big"><b>' + dec(a.avgDead, 2) + '</b> por mano en promedio</p>'
      + '<ul class="pl-mini">' + a.deadDist.map((p, i) => '<li><span>' + lab[i] + '</span><b>' + pc(p) + '</b></li>').join('') + '</ul>'
      + '<p class="pl-note">Ladrillos, extenders sin jugada y piezas del motor que no aportan (anuladas, sin pareja, o la 2.ª copia de algo 1 vez por turno).</p></div>';
  }

  function weakBox(a, pending) {
    const list = P().weakLinks(a).filter((c) => c.share > 0.005).slice(0, 5);
    return '<div class="pl-box"><h5>Eslabones débiles</h5>'
      + (list.length ? '<p class="pl-note">Con ella en la mano, cuántas de tus manos jugables tienen <b>una sola jugada</b>:</p>'
        + '<ol class="pl-weak">' + list.map((c) => '<li><button type="button" class="pl-card" data-card="' + c.id + '">' + esc(nameOf(c.id)) + '</button>'
        + '<span class="pl-hb" aria-hidden="true"><i style="width:' + (c.share * 100).toFixed(1) + '%"></i></span><b>' + pc(c.share) + '</b>'
        + '<small>la abres en ' + pc(c.pIn) + '</small></li>').join('') + '</ol>'
        : '<p class="pl-note">Ninguna carta te deja con una sola jugada.</p>')
      + (pending ? '<p class="pl-note">Cambia cuando revises los pares.</p>' : '<p class="pl-note">Son las primeras candidatas a cambiar: busca otra carta que abra una jugada distinta.</p>') + '</div>';
  }

  function nsBox(d, n) {
    const ns = P().normalSummons(d, n);
    if (!ns.k) return '';
    const two = ns.dist[2] + ns.dist[3];
    return '<div class="pl-box"><h5>Invocación Normal</h5><p class="pl-big"><b>' + pc(two) + '</b> abres 2 o más que la usan</p>'
      + '<ul class="pl-mini">' + ns.dist.map((p, i) => '<li><span>' + ['0', '1', '2', '3+'][i] + '</span><b>' + pc(p) + '</b></li>').join('') + '</ul>'
      + '<p class="pl-note">' + plural(ns.k, 'copia', 'copias') + ' en el mazo usan la Invocación Normal. Juntas cuentan como una sola jugada.</p></div>';
  }

  function tourBox(d) {
    const a5 = analysisOf(d, 5).a, a6 = analysisOf(d, 6).a;
    const r = P().tournament(1 - a5.pPlay, 1 - a6.pPlay, prefs.plRounds, prefs.plMode);
    const one = P().tournament(a5.dist[0] + a5.dist[1], a6.dist[0] + a6.dist[1], prefs.plRounds, prefs.plMode);
    const rounds = Array.from({ length: 15 }, (_, i) => i + 1).map((x) => '<option value="' + x + '"' + (x === prefs.plRounds ? ' selected' : '') + '>' + x + '</option>').join('');
    const modes = [['prudente', 'Prudente: empiezas 2 de 3'], ['normal', 'Normal: empiezas la mitad'], ['optimista', 'Optimista: empiezas 1 de 3']]
      .map(([k, t]) => '<option value="' + k + '"' + (k === prefs.plMode ? ' selected' : '') + '>' + t + '</option>').join('');
    return '<div class="pl-box pl-tour"><h5>Torneo</h5>'
      + '<div class="pl-ctl"><label>Rondas <select id="pl-rounds">' + rounds + '</select></label><label><span class="sr">Cuántas partidas empiezas</span><select id="pl-mode">' + modes + '</select></label></div>'
      + '<p class="pl-big"><b>' + dec(r.expected) + '</b> partidas sin jugada en ' + plural(prefs.plRounds, 'ronda') + ' (' + r.games + ' partidas)</p>'
      + '<p class="pl-note">Lo normal: entre <b>' + r.lo + '</b> y <b>' + r.hi + '</b>. Al menos una: <b>' + pc(r.pAny) + '</b>. Cada ronda son 3 partidas.</p>'
      + '<p class="pl-big pl-one"><b>' + dec(one.expected) + '</b> con 1 jugada o ninguna: ahí una handtrap te para</p>'
      + '<p class="pl-note">Lo normal: entre <b>' + one.lo + '</b> y <b>' + one.hi + '</b>. Esta cifra usa tus pares revisados.</p>'
      + tourChart(r, one) + '</div>';
  }

  /** Probabilidad de que te pase en k de las partidas, de 0 hasta donde queda menos de 0,5% */
  function tourChart(r, one) {
    const upTo = (dist) => { let c = 0; for (let k = 0; k < dist.length; k++) { c += dist[k]; if (c >= 0.995) return k; } return dist.length - 1; };
    const K = Math.min(r.games, Math.max(3, upTo(r.dist), upTo(one.dist)));
    const ks = Array.from({ length: K + 1 }, (_, k) => k);
    const spec = { kind: 'cols', label: 'En cuántas de las ' + r.games + ' partidas te pasa', cats: ks.map(String), fmt: pc, h: 160,
      title: (i) => (i === 1 ? '1 partida' : i + ' partidas') + ' de ' + r.games,
      series: [{ name: 'Sin jugada', color: COL.s1, values: ks.map((k) => r.dist[k] || 0) }, { name: '1 jugada o ninguna', color: COL.s2, values: ks.map((k) => one.dist[k] || 0) }] };
    return '<div class="pl-chart"><div class="pl-chead"><h6>En cuántas partidas de ' + r.games + ' te pasa</h6>' + C().legend(spec) + '</div>'
      + chart('tour', spec) + C().table(spec, 'Partidas') + '</div>';
  }

  /** Lo que movió el último par tocado */
  function fxNow(d, n) {
    if (!lastFx || lastFx.key !== sig(d) + '#' + n) return '';
    const f = lastFx, x = f.before, y = f.after;
    const what = f.v ? '<b>' + plural(f.v, 'jugada') + '</b>' : '<b>sin revisar</b>';
    const nothing = Math.abs(x.pTwo - y.pTwo) < 1e-12 && Math.abs(x.avgPlays - y.avgPlays) < 1e-12;
    return '<p class="pl-fxnow" role="status">' + esc(nameOf(f.a)) + ' + ' + esc(nameOf(f.b)) + ': ' + what + '. '
      + (nothing ? 'La cuenta no cambia: ya lo contaba así.' : '2 o más jugadas ' + move(x.pTwo, y.pTwo, pc) + ' · promedio ' + move(x.avgPlays, y.avgPlays, dec) + '.') + '</p>';
  }

  function pairsBox(d, n, pairs, pending) {
    if (!pairs.length) return '';
    const shown = allPairs ? pairs : pairs.slice(0, PAIRS_SHOWN);
    const rows = shown.map((x) => {
      const pa = (v) => ' data-pa="' + x.a + '" data-pb="' + x.b + '" data-pv="' + v + '" aria-pressed="' + (x.label === v) + '"';
      const state = x.label ? '<span class="pl-ok">Revisado</span>' : '<span class="pl-auto">Sin revisar: cuenta como ' + plural(x.auto, 'jugada') + (x.why ? ' (' + x.why.toLowerCase() + ')' : '') + '</span>';
      return '<li class="pl-pair' + (x.label ? ' done' : '') + '"><span class="pl-pn"><button type="button" class="pl-card" data-card="' + x.a + '">' + esc(nameOf(x.a)) + '</button>'
        + '<span aria-hidden="true">+</span><button type="button" class="pl-card" data-card="' + x.b + '">' + esc(nameOf(x.b)) + '</button></span>'
        + '<span class="pl-pp">abres las dos: <b>' + pc(x.p) + '</b></span>'
        + '<span class="seg pl-pv" role="group" aria-label="' + esc(nameOf(x.a)) + ' y ' + esc(nameOf(x.b)) + ' juntas son"><button type="button"' + pa(1) + '>1 jugada</button><button type="button"' + pa(2) + '>2 jugadas</button></span>'
        + state + '</li>';
    }).join('');
    return '<details class="pl-pairs"' + (openPairs ? ' open' : '') + ' data-pl-open="pairs"><summary>Revisar pares · <b>' + (pairs.length - pending) + ' de ' + pairs.length + '</b> revisados</summary>'
      + '<p class="pl-note">Si abres las dos, ¿son <b>1 jugada</b> (las dos terminan en la misma carta: si te cortan esa, no tienes nada) o <b>2 jugadas</b> (si te cortan una, juegas con la otra)? Del par que más abres al que menos. Tocar otra vez lo deja sin revisar.</p>'
      + fxNow(d, n)
      + '<ul class="pl-plist">' + rows + '</ul>'
      + (pairs.length > PAIRS_SHOWN ? '<button type="button" class="small" data-pl-all>' + (allPairs ? 'Ver solo los ' + PAIRS_SHOWN + ' que más abres' : 'Ver los ' + pairs.length + ' pares') + '</button>' : '')
      + '</details>';
  }

  function sizeBox(d, n) {
    const N = d.main.length;
    if (N >= P().MAX_DECK) return '';
    let body = '';
    if (openSize) {
      const rows = cached(sig(d) + '#f' + n, () => P().fillers(d, n));
      const cur = rows[0];
      const keep = rows.filter((r) => r.pPlay >= cur.pPlay - 0.01).pop();
      const s90 = cur.pPlay >= 0.9 ? rows.filter((r) => r.pPlay >= 0.9).pop() : null;
      body = '<p class="pl-note">Si llenas el mazo con no-motor (handtraps u otras cartas que no usa tu combo): abres menos jugadas pero también menos ladrillos.</p>'
        + '<p class="pl-big">' + (keep.size > N ? 'Hasta <b>' + keep.size + ' cartas</b> pierdes menos de 1 punto de jugable (' + pc(cur.pPlay) + ' → ' + pc(keep.pPlay) + ').' : 'Cada carta de más te quita más de 1 punto de jugable.')
        + (s90 && s90.size > N && s90.size !== keep.size ? ' Con 90% o más: hasta <b>' + s90.size + '</b>.' : '') + '</p>'
        + sizeChart(rows, n)
        + '<div class="pl-twrap"><table class="pl-size-t"><caption class="sr">Tamaño del mazo con no-motor de relleno, mano de ' + n + '</caption>'
        + '<thead><tr><th scope="col">Cartas</th><th scope="col" class="num">Jugable</th><th scope="col" class="num">2+ jugadas</th><th scope="col" class="num">Jugadas</th><th scope="col" class="num">Muertas</th></tr></thead><tbody>'
        + rows.map((r) => '<tr' + (r.size === N ? ' class="cur"' : '') + '><th scope="row">' + r.size + (r.size === N ? ' <small>(ahora)</small>' : '') + '</th>'
          + '<td class="num rk-' + RANK(r.pPlay) + '">' + pc(r.pPlay) + '</td><td class="num">' + pc(r.pTwo) + '</td><td class="num">' + dec(r.avgPlays) + '</td><td class="num">' + dec(r.avgDead, 2) + '</td></tr>').join('')
        + '</tbody></table></div>';
    }
    return '<details class="pl-size"' + (openSize ? ' open' : '') + ' data-pl-open="size"><summary>Tamaño del mazo · agregar no-motor hasta ' + P().MAX_DECK + '</summary>' + body + '</details>';
  }

  function sizeChart(rows, n) {
    const spec = { kind: 'line', label: 'Jugable y 2 o más jugadas según cuántas cartas tiene el mazo, mano de ' + n, xs: rows.map((r) => r.size), fmt: pc,
      title: (i) => rows[i].size + ' cartas' + (i === 0 ? ' (ahora)' : ''),
      series: [{ name: 'Jugable', color: COL.s1, values: rows.map((r) => r.pPlay) }, { name: '2 o más jugadas', color: COL.s2, values: rows.map((r) => r.pTwo) }] };
    return '<div class="pl-chart pl-sizec">' + C().legend(spec) + chart('size', spec) + '</div>';
  }

  /* ---------- Etiquetas de una carta ---------- */
  function editTags(d, id, hooks) {
    id = Number(id);
    const c = db.get(id);
    const role = P().roleOf(d, id), t = P().tagsOf(d, id);
    const uniq = Array.from(new Set(d.main.map(Number))).filter((x) => x !== id);
    const eng = (x) => P().ENGINE.has(P().roleOf(d, x));
    const byRole = uniq.slice().sort((a, b) => Number(eng(b)) - Number(eng(a)) || nameOf(a).localeCompare(nameOf(b)));
    const check = (name, x, on) => '<label class="tg-c"><input type="checkbox" name="' + name + '" value="' + x + '"' + (on ? ' checked' : '') + '><span>' + esc(nameOf(x))
      + (P().roleOf(d, x) ? ' <small>' + ROLE_INFO.find((r) => r[0] === P().roleOf(d, x))[1].split(' ')[0] + '</small>' : '') + '</span></label>';
    $('#modal-title').textContent = 'Etiquetas · ' + c.name;
    $('#modal-body').innerHTML = '<div class="tg">'
      + '<fieldset class="tg-roles"><legend>Rol</legend>' + ROLE_INFO.map(([k, l, w]) => '<label class="tg-r"><input type="radio" name="tg-role" value="' + k + '"' + (k === role ? ' checked' : '') + '><span><b>' + l + '</b><small>' + w + '</small></span></label>').join('') + '</fieldset>'
      + '<fieldset class="tg-eng" data-for="starter starter15 combo2"><legend>Al jugarla</legend>'
      + '<label class="tg-c"><input type="checkbox" id="tg-ns"' + (t.ns ? ' checked' : '') + '><span>Usa la <b>Invocación Normal</b> <small>(dos que la usan cuentan como una jugada)</small></span></label>'
      + '<label class="tg-c"><input type="checkbox" id="tg-nopt"' + (t.nopt ? ' checked' : '') + '><span>Cada copia es otra jugada <small>(no es «1 vez por turno»)</small></span></label></fieldset>'
      + '<fieldset class="tg-req" data-for="starter15"><legend>Necesita además</legend><select id="tg-req">' + P().REQS.map((r) => '<option value="' + r + '"' + (r === t.req ? ' selected' : '') + '>' + REQ_TXT[r] + '</option>').join('') + '</select>'
      + '<p class="hint">En la mano, además de esta carta (por ejemplo, un servidor que necesita una mágica). Con <b>una de estas cartas</b> marcas cuáles.</p>'
      + '<label class="tg-c"><input type="checkbox" id="tg-self"' + (t.selfOk ? ' checked' : '') + '><span>Otra copia de esta carta también sirve <small>(abrir 2 copias ya es jugada)</small></span></label>'
      + '<div class="tg-needs"><p class="hint">Basta con abrir una de las que marques.</p>'
      + '<div class="tg-list">' + byRole.map((x) => check('tg-need', x, t.needs.includes(x))).join('') + '</div>'
      + '<p class="tg-err" role="alert" hidden>Marca al menos una carta (u «Otra copia de esta carta también sirve») o elige otra opción.</p></div></fieldset>'
      + '<fieldset class="tg-links" data-for="combo2"><legend>Hace combo con</legend><p class="hint">Si no marcas ninguna, hace combo con cualquier otra Pieza de combo sin parejas.</p>'
      + '<div class="tg-list">' + byRole.map((x) => check('tg-link', x, t.links.includes(x))).join('') + '</div></fieldset>'
      + '<fieldset class="tg-kills" data-for="brick"><legend>Anula a</legend><p class="hint">Si la abres junto con una de estas, esa no te da jugada (como Mind Shuffle con Black Chaos en el video).</p>'
      + (uniq.some(eng) ? '<div class="tg-list">' + uniq.filter(eng).map((x) => check('tg-kill', x, t.kills.includes(x))).join('') + '</div>' : '<p class="hint">Marca primero tus starters o piezas de combo.</p>') + '</fieldset>'
      + '</div>';
    const body = $('#modal-body');
    const sync = () => {
      const r = (body.querySelector('input[name="tg-role"]:checked') || {}).value || '';
      body.querySelectorAll('fieldset[data-for]').forEach((f) => { f.hidden = !f.dataset.for.split(' ').includes(r); });
      body.querySelector('.tg-needs').hidden = $('#tg-req').value !== 'cards';
    };
    body.addEventListener('change', (e) => {
      if (e.target.name === 'tg-role' || e.target.id === 'tg-req') sync();
      if (e.target.name === 'tg-need' || e.target.id === 'tg-self') body.querySelector('.tg-err').hidden = true;
    });
    sync();
    const foot = $('#modal-foot');
    foot.innerHTML = '<button type="button" data-tg="cancel">Cancelar</button><button type="button" class="primary" data-tg="save">Guardar</button>';
    foot.querySelector('[data-tg="cancel"]').addEventListener('click', () => { $('#modal').hidden = true; });
    foot.querySelector('[data-tg="save"]').addEventListener('click', () => {
      const r = (body.querySelector('input[name="tg-role"]:checked') || {}).value || '';
      const vals = (name) => Array.from(body.querySelectorAll('input[name="' + name + '"]:checked')).map((x) => Number(x.value));
      const selfOk = r === 'starter15' && $('#tg-self').checked;
      if (r === 'starter15' && $('#tg-req').value === 'cards' && !vals('tg-need').length && !selfOk) {
        const err = body.querySelector('.tg-err');
        err.hidden = false;
        err.scrollIntoView({ block: 'nearest' });
        return;
      }
      P().setRole(d, id, r);
      P().setTags(d, id, { ns: $('#tg-ns').checked, nopt: $('#tg-nopt').checked, req: $('#tg-req').value, selfOk, links: vals('tg-link'), kills: vals('tg-kill'), needs: vals('tg-need') });
      $('#modal').hidden = true;
      if (hooks && hooks.saved) hooks.saved(id);
    });
    $('#modal').hidden = false;
    const first = body.querySelector('input[name="tg-role"]:checked') || body.querySelector('input');
    if (first) first.focus();
  }

  /* ---------- Eventos (una vez) ---------- */
  function bind(box) {
    if (!box || box.dataset.bound) return;
    box.dataset.bound = '1';
    box.addEventListener('click', (e) => {
      if (!ctx) return;
      const pv = e.target.closest('[data-pv]');
      if (pv) {
        const v = Number(pv.dataset.pv), a = Number(pv.dataset.pa), b = Number(pv.dataset.pb);
        const before = analysisOf(ctx.d, ctx.n).a;
        const nv = P().pairLabel(ctx.d, a, b) === v ? 0 : v;
        P().setPair(ctx.d, a, b, nv);
        ctx.hooks.persist();
        lastFx = { key: sig(ctx.d) + '#' + ctx.n, a, b, v: nv, before, after: analysisOf(ctx.d, ctx.n).a };
        rerender();
        return;
      }
      const card = e.target.closest('[data-card]');
      if (card) { ctx.hooks.showCard(Number(card.dataset.card)); return; }
      if (e.target.closest('[data-pl-all]')) { allPairs = !allPairs; rerender(); }
    });
    box.addEventListener('change', (e) => {
      if (e.target.id === 'pl-rounds') prefs.plRounds = Math.max(1, Math.min(15, Number(e.target.value) || 4));
      else if (e.target.id === 'pl-mode') prefs.plMode = P().MODES[e.target.value] != null ? e.target.value : 'normal';
      else return;
      savePrefs();
      rerender();
    });
    box.addEventListener('toggle', (e) => {
      const k = e.target.dataset && e.target.dataset.plOpen;
      if (!k) return;
      const was = k === 'pairs' ? openPairs : openSize;
      if (was === e.target.open) return;
      if (k === 'pairs') openPairs = e.target.open; else openSize = e.target.open;
      if (k === 'size') rerender();
    }, true);
  }
  const rerender = () => { if (ctx) render(ctx.box, ctx.d, ctx.hand, ctx.n, ctx.hooks); };

  YGO.playlab = {
    render(box, d, hand, n, hooks) { bind(box); render(box, d, hand, n, hooks); },
    editTags,
    /** La cuenta exacta de una mano de n (la misma del panel, con su memoria): { m: modelo, a: analyze } */
    analysis: (d, n) => analysisOf(d, n),
  };
})();
