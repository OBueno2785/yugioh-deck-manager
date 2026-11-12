/* Pestaña «Comparar» (#comparar): las estadísticas de dos mazos lado a lado, con el mismo formato del panel Consistencia
 * (rango S–D con su sello, 10 cartas, medallas oro/plata/bronce) y del panel Jugadas (jugable, ladrillo, 2 o más jugadas,
 * gráficas de js/plcharts.js) de la prueba de mano. Pedido de Oscar 2026-11-12: «quiero una pantalla que permita comparar las
 * estadísticas de 2 mazos, debe tener el mismo formato que el actual».
 * Las cifras salen de las mismas cuentas: YGO.handtest.summaryOf (Consistencia) y YGO.playlab.analysis (Jugadas), así un mazo
 * muestra aquí lo mismo que en Prueba de mano. Gana cada apartado el mazo con la cifra mejor (más alta; más baja en lo que
 * «menos es mejor»), si la diferencia se ve con el decimal que se muestra.
 * Expone window.YGO.compare = { enter, summary(a, b, n) }. */
(function () {
  const YGO = window.YGO;
  const { game, view, store } = YGO;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const esc = view.esc;
  const K = () => YGO.handtest.kit;
  const C = () => YGO.plcharts;
  const P = () => YGO.play;
  const COL = { a: 'var(--plc-1)', b: 'var(--plc-2)' };
  const SIDES = ['a', 'b'];

  const prefs = Object.assign({ cmpA: null, cmpB: null, cmpN: null }, store.prefs());
  const savePrefs = () => store.savePrefs(Object.assign(store.prefs(), { cmpA: prefs.cmpA, cmpB: prefs.cmpB, cmpN: prefs.cmpN }));
  let charts = {};
  let bound = false;

  const decks = () => YGO.builder.decks();
  const dec = (x) => (Math.round(x * 10) / 10).toFixed(1).replace('.', ',');
  const pts = (x) => dec(Math.abs(x) * 100) + ' pts';
  const r1 = (p) => Math.round(p * 1000) / 10;
  const plural = (x, one, many) => x + ' ' + (x === 1 ? one : many || one + 's');
  const nOf = () => (prefs.cmpN === 6 ? 6 : prefs.cmpN === 5 ? 5 : (store.prefs().handSize === 6 ? 6 : 5));

  /** Los dos mazos elegidos (si falta uno, el actual del constructor y otro distinto) */
  function pick() {
    const list = decks();
    if (!list.length) return [null, null];
    const byId = (id) => list.find((x) => x.id === id);
    let a = byId(prefs.cmpA) || YGO.builder.current() || list[0];
    let b = byId(prefs.cmpB);
    if (!b || (b === a && list.length > 1)) b = list.find((x) => x !== a) || a;
    prefs.cmpA = a.id; prefs.cmpB = b.id;
    return [a, b];
  }

  /** Quién gana una cifra: 'a', 'b' o '' (empate o falta una). low = menos es mejor. num = promedio (no %). */
  function winner(x, y, low, num) {
    if (x == null || y == null) return '';
    const f = num ? (v) => Math.round(v * 10) : (v) => r1(v); // como se ve: % con un decimal, promedio con un decimal
    const u = f(x), v = f(y);
    if (u === v) return '';
    return (u > v) !== !!low ? 'a' : 'b';
  }

  /** Todo lo que se compara, sin HTML (también lo usan las pruebas): { n, sides: [{ d, s, play }], rows, score } */
  function summary(da, db, n) {
    const sides = [da, db].map((d) => {
      const s = YGO.handtest.summaryOf(d);
      const engine = P() && d.main.length && d.main.some((id) => P().ENGINE.has(P().roleOf(d, id)));
      let play = null;
      if (engine) {
        const a5 = YGO.playlab.analysis(d, 5).a, a6 = YGO.playlab.analysis(d, 6).a;
        play = { a5, a6, cur: n === 5 ? a5 : a6, other: n === 5 ? a6 : a5 };
      }
      return { d, s, play };
    });
    const rows = [];
    const at = (side, id) => { const m = side.s.ms.find((x) => x.id === id); return m ? (n === 5 ? m.p5 : m.p6) : null; };
    const atO = (side, id) => { const m = side.s.ms.find((x) => x.id === id); return m ? (n === 5 ? m.p6 : m.p5) : null; };
    for (const m of K().METRICS) {
      const va = at(sides[0], m.id), vb = at(sides[1], m.id);
      if (va == null && vb == null) continue;
      rows.push({ id: m.id, group: 'cons', label: m.label, icon: m.icon, low: !!m.bad, need: m.need, fmt: 'pct',
        a: va, b: vb, ao: atO(sides[0], m.id), bo: atO(sides[1], m.id), win: winner(va, vb, m.bad) });
    }
    const PL = [
      { id: 'pl-play', label: 'Jugable (abres al menos una jugada)', get: (a) => a.pPlay, fmt: 'pct' },
      { id: 'pl-brick', label: 'Ladrillo (sin jugada)', get: (a) => 1 - a.pPlay, fmt: 'pct', low: true },
      { id: 'pl-two', label: '2 o más jugadas (aguantas 1 handtrap)', get: (a) => a.pTwo, fmt: 'pct' },
      { id: 'pl-avg', label: 'Jugadas en promedio', get: (a) => a.avgPlays, fmt: 'num' },
      { id: 'pl-dead', label: 'Cartas muertas en promedio', get: (a) => a.avgDead, fmt: 'num', low: true },
    ];
    if (sides.some((x) => x.play)) {
      for (const r of PL) {
        const g = (side, k) => (side.play ? r.get(side.play[k]) : null);
        const va = g(sides[0], 'cur'), vb = g(sides[1], 'cur');
        rows.push({ id: r.id, group: 'play', label: r.label, low: !!r.low, fmt: r.fmt, a: va, b: vb, ao: g(sides[0], 'other'), bo: g(sides[1], 'other'),
          win: winner(va, vb, r.low, r.fmt === 'num') });
      }
    }
    const score = { a: rows.filter((r) => r.win === 'a').length, b: rows.filter((r) => r.win === 'b').length,
      tie: rows.filter((r) => !r.win && r.a != null && r.b != null).length };
    return { n, sides, rows, score };
  }

  /* ---------- Dibujo ---------- */
  const tag = (side) => '<span class="cmp-tag t-' + side + '" aria-hidden="true">' + side.toUpperCase() + '</span>';
  const fmtOf = (r, v) => (v == null ? '—' : r.fmt === 'num' ? dec(v) : K().pc(v));

  /** Canto del mazo (una franja por carta con el color de su rol) y cuántas de cada rol */
  function rolesOf(s) {
    const { ROLES, badge } = K();
    if (!s.any) return '<p class="gx-note">Sin roles marcados.</p>';
    const none = s.N - ROLES.reduce((x, r) => x + s.tot[r.k], 0);
    return '<p class="roles-line gx-roles">' + ROLES.filter((r) => s.tot[r.k]).map((r) => '<span>' + badge(r.k) + ' <b>' + s.tot[r.k] + '</b> '
      + (s.tot[r.k] === 1 ? r.label : r.many || r.label + 's').toLowerCase() + '</span>').join('') + '<span>en <b>' + s.N + '</b> cartas</span></p>'
      + '<div class="gx-deck" aria-hidden="true">' + ROLES.map((r) => ('<i class="r-' + r.k + '"></i>').repeat(s.tot[r.k])).join('') + '<i></i>'.repeat(Math.max(0, none)) + '</div>';
  }

  /** La tarjeta de rango de un mazo: nombre, sello, cifra grande, la otra mano, 10 cartas y escalera */
  function heroOf(side, x, n, won) {
    const { seal, rankOf, pc, freq, ladder, SCALE, oneIn } = K();
    const s = x.s, name = esc(x.d.name);
    const head = '<header class="cmp-hhead">' + tag(side) + '<h4 class="cmp-name">' + name + '</h4>' + (won ? '<span class="cmp-crown" title="Mejor rango">Mejor rango</span>' : '') + '</header>';
    if (!s.N) return '<section class="gx-card gx-hero cmp-hero s-' + side + '">' + head + '<p class="gx-note">Este mazo no tiene cartas en el principal.</p></section>';
    if (!s.K) {
      return '<section class="gx-card gx-hero cmp-hero s-' + side + '">' + head + rolesOf(s)
        + '<div class="gx-hero-top">' + seal('?', 'Sin rango todavía') + '<p><b>Sin rango todavía.</b> Marca sus starters en <b>Prueba de mano</b> (columna <b>Rol</b>) para compararlo.</p></div>'
        + '<button type="button" class="small" data-open="' + esc(x.d.id) + '">Marcar roles en Prueba de mano →</button></section>';
    }
    const m = s.ms[0];
    const p = n === 5 ? m.p5 : m.p6, q = n === 5 ? m.p6 : m.p5;
    const rk = rankOf(p), rq = rankOf(q);
    return '<section class="gx-card gx-hero cmp-hero s-' + side + '" aria-label="' + name + '">' + head + rolesOf(s)
      + '<div class="gx-hero-top">' + seal(rk.k, 'Rango ' + rk.k + ' (' + SCALE + ')')
      + '<div class="gx-hero-body"><p class="gx-big"><b data-cmp="' + side + '-p">' + pc(p) + '</b>de abrir con al menos un starter'
      + (s.joint ? ' <span class="gx-what">(' + s.what + ')</span>' : '') + '</p>'
      + '<p class="gx-sub">' + (p < 1 - 1e-9 ? 'Sin starter: <b>' + oneIn(1 - p) + '</b> manos · ' : '') + '<span class="gx-nw">' + (n === 5 ? 'Yendo segundo' : 'Yendo primero') + ': <b>' + pc(q) + '</b>'
      + ' <span class="sr">rango </span><span class="gx-rk">' + rq.k + '</span></span></p></div></div>'
      + freq(p) + ladder(p) + '</section>';
  }

  /** Quién abre más con starter, en una línea */
  function verdict(sm) {
    const r = sm.rows.find((x) => x.id === 's1');
    const [A, B] = sm.sides;
    if (!r || r.a == null || r.b == null) return '<p class="cmp-verdict">Marca los starters de los dos mazos en <b>Prueba de mano</b> para ver cuál abre más.</p>';
    if (!r.win) return '<p class="cmp-verdict">Los dos abren con starter lo mismo: <b>' + K().pc(r.a) + '</b>.</p>';
    const w = r.win === 'a' ? A : B, l = r.win === 'a' ? B : A;
    const d = Math.abs(r.a - r.b);
    return '<p class="cmp-verdict">' + tag(r.win) + ' <b>' + esc(w.d.name) + '</b> abre con starter <b>' + pts(d) + ' más</b> que ' + esc(l.d.name)
      + ' <span class="gx-nw">(≈ ' + plural(Math.max(1, Math.round(d * 100)), 'mano') + ' más de cada 100)</span>.</p>';
  }

  /** Una fila de la comparación: cifra de A, barras de los dos, cifra de B; gana la que tiene ▲ */
  function rowOf(r, n) {
    const { medalOf, medalIcons, MEDALS } = K();
    const other = n === 5 ? 'Segundo · 6' : 'Primero · 5';
    const cell = (side) => {
      const v = r[side], o = r[side + 'o'];
      if (v == null) return '<div class="cmp-v s-' + side + ' is-none"><b>—</b><small>' + (r.group === 'play' ? 'sin starters' : 'falta marcar el rol') + '</small></div>';
      const md = r.fmt === 'pct' && !r.low ? medalOf(v) : null;
      return '<div class="cmp-v s-' + side + (r.win === side ? ' win' : '') + '">'
        + '<b>' + (r.win === side ? '<span class="cmp-up" aria-hidden="true">▲</span>' : '') + fmtOf(r, v) + '</b>'
        + (md ? '<span class="cmp-medal t-' + md.k + '">' + md.label + '</span>' : '')
        + '<small>' + other + ': ' + fmtOf(r, o) + '</small></div>';
    };
    const max = r.fmt === 'num' ? Math.max(1, r.a || 0, r.b || 0) : 1;
    const bar = (side) => '<i class="s-' + side + '" style="width:' + (r[side] == null ? 0 : Math.max(0.5, (r[side] / max) * 100)).toFixed(1) + '%"></i>';
    // (la diferencia entre las cifras como se ven, así cuadra con la resta que haces a ojo)
    const diff = r.win ? (r.fmt === 'num' ? dec(Math.abs(Math.round(r.a * 10) - Math.round(r.b * 10)) / 10) + ' más' : dec(Math.abs(r1(r.a) - r1(r.b))) + ' pts') : '';
    const sr = r.win ? ' (gana ' + r.win.toUpperCase() + ')' : r.a != null && r.b != null ? ' (empate)' : '';
    return '<li class="cmp-row' + (r.low ? ' is-low' : '') + '" data-row="' + r.id + '" data-win="' + (r.win || '') + '">'
      + cell('a')
      + '<div class="cmp-mid"><p class="cmp-lbl">' + (r.icon ? '<span class="cmp-ic" aria-hidden="true">' + medalIcons(r.icon) + '</span>' : '') + esc(r.label)
      + '<span class="sr">' + sr + '</span></p>'
      + '<span class="cmp-bars" aria-hidden="true">' + bar('a') + bar('b') + '</span>'
      + '<p class="cmp-diff">' + (r.win ? (r.low ? 'menos es mejor · ' : '') + tag(r.win) + ' por ' + diff : r.a != null && r.b != null ? 'Empate' + (r.low ? ' · menos es mejor' : '') : (r.low ? 'menos es mejor' : '')) + '</p></div>'
      + cell('b') + '</li>';
  }

  function chart(id, spec) { charts[id] = spec; return C().place(id, spec); }

  function distBox(sm, n) {
    const [A, B] = sm.sides;
    const da = n === 5 ? A.s.dist5 : A.s.dist6, db = n === 5 ? B.s.dist5 : B.s.dist6;
    if (!da && !db) return '';
    const spec = { kind: 'cols', label: '¿Cuántos starters abres? con mano de ' + n + ', mazo A y mazo B', cats: ['Ninguno', '1 starter', '2 starters', '3 o más'], fmt: K().pc,
      series: [{ name: 'A · ' + A.d.name, color: COL.a, values: da || [0, 0, 0, 0] }, { name: 'B · ' + B.d.name, color: COL.b, values: db || [0, 0, 0, 0] }] };
    return '<section class="gx-card cmp-chart"><div class="pl-chead"><h4>¿Cuántos starters abres? · mano de ' + n + '</h4>' + C().legend(spec) + '</div>'
      + chart('dist', spec) + C().table(spec, 'Starters') + '</section>';
  }

  function playsBox(sm, n) {
    const [A, B] = sm.sides;
    if (!A.play && !B.play) return '';
    const zero = [0, 0, 0, 0];
    const spec = { kind: 'cols', label: 'Cuántas jugadas abres con mano de ' + n + ', mazo A y mazo B', cats: ['Ladrillo', '1 jugada', '2 jugadas', '3 o más'], fmt: K().pc,
      series: [{ name: 'A · ' + A.d.name, color: COL.a, values: A.play ? A.play.cur.dist : zero }, { name: 'B · ' + B.d.name, color: COL.b, values: B.play ? B.play.cur.dist : zero }] };
    const pr = store.prefs(), rounds = pr.plRounds || 4, mode = pr.plMode || 'normal';
    const tour = (x) => (x.play ? P().tournament(1 - x.play.a5.pPlay, 1 - x.play.a6.pPlay, rounds, mode) : null);
    const ta = tour(A), tb = tour(B);
    const games = (ta || tb).games;
    const tline = (side, x, t) => '<li>' + tag(side) + ' <span>' + esc(x.d.name) + ': ' + (t ? '<b>≈ ' + dec(t.expected) + '</b> partidas sin jugada · alguna: <b>' + K().pc(t.pAny) + '</b>' : 'sin starters marcados') + '</span></li>';
    return '<section class="gx-card cmp-chart"><div class="pl-chead"><h4>Cuántas jugadas abres · mano de ' + n + '</h4>' + C().legend(spec) + '</div>'
      + chart('plays', spec) + C().table(spec, 'Jugadas')
      + '<div class="cmp-tour"><h5>Torneo de ' + plural(rounds, 'ronda') + ' (' + games + ' partidas)</h5><ul>' + tline('a', A, ta) + tline('b', B, tb) + '</ul>'
      + '<p class="gx-note">Las rondas y cuántas vas primero son las del Torneo del panel Jugadas.</p></div></section>';
  }

  function render() {
    const body = $('#cmp-body');
    if (!body) return;
    const list = decks();
    const [da, db] = pick();
    const n = nOf();
    const opts = (sel) => list.map((x) => '<option value="' + esc(x.id) + '"' + (x === sel ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('');
    $('#cmp-a').innerHTML = opts(da);
    $('#cmp-b').innerHTML = opts(db);
    document.querySelectorAll('#cmp-size [data-n]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.n) === n)));
    charts = {};
    if (!da) { body.innerHTML = '<p class="gx-note">Crea o importa un mazo en el Constructor para comparar.</p>'; return; }
    const sm = summary(da, db, n);
    const [A, B] = sm.sides;
    const rk = (x) => (x.s.K ? K().RANKS.indexOf(K().rankOf(n === 5 ? x.s.ms[0].p5 : x.s.ms[0].p6)) : 99);
    const rw = sm.rows.find((r) => r.id === 's1');
    const best = rk(A) < rk(B) ? 'a' : rk(B) < rk(A) ? 'b' : '';
    const cons = sm.rows.filter((r) => r.group === 'cons'), plays = sm.rows.filter((r) => r.group === 'play');
    const sc = sm.score;
    const lead = sc.a === sc.b ? 'Empate' : (sc.a > sc.b ? 'Gana A' : 'Gana B');
    body.innerHTML = '<header class="gx-head"><h3>Comparar mazos</h3><span class="gx-mode">' + (n === 5 ? 'Yendo primero · mano de 5' : 'Yendo segundo · mano de 6') + '</span>'
      + (sm.rows.length ? '<p class="cmp-score" data-score="' + sc.a + '-' + sc.b + '"><span class="sr">Marcador: </span>' + tag('a') + '<b>' + sc.a + '</b><span class="cmp-dash">–</span><b>' + sc.b + '</b>' + tag('b')
        + '<span class="cmp-lead">' + lead + (sc.tie ? ' · ' + plural(sc.tie, 'empate') : '') + '</span></p>' : '') + '</header>'
      + (da === db ? '<p class="cmp-same">Elegiste el mismo mazo en los dos lados' + (list.length < 2 ? ': crea o importa otro mazo en el Constructor para comparar.' : '.') + '</p>' : '')
      + '<div class="cmp-duel">' + heroOf('a', A, n, best === 'a') + '<span class="cmp-vs" aria-hidden="true">VS</span>' + heroOf('b', B, n, best === 'b') + '</div>'
      + (rw ? verdict(sm) : '')
      + (cons.length ? '<section class="gx-card cmp-list"><header class="cmp-lhead"><h4>Logros · mano de ' + n + '</h4>'
        + '<p class="gx-legend"><span class="t-oro">oro desde 90%</span><span class="t-plata">plata desde 80%</span><span class="t-bronce">bronce desde 70%</span><span>▲ gana</span></p></header>'
        + '<ul class="cmp-rows">' + cons.map((r) => rowOf(r, n)).join('') + '</ul></section>' : '')
      + distBox(sm, n)
      + (plays.length ? '<section class="gx-card cmp-list"><header class="cmp-lhead"><h4>Jugadas · mano de ' + n + '</h4>'
        + '<p class="gx-note">Como en el panel <b>Jugadas</b>: no basta con abrir un starter, cuenta si abres una <b>jugada</b> y cuántas.</p></header>'
        + '<ul class="cmp-rows">' + plays.map((r) => rowOf(r, n)).join('') + '</ul></section>' : '')
      + playsBox(sm, n);
    C().mount(body, charts);
  }

  function bind() {
    if (bound) return;
    bound = true;
    // (elegir en un lado el mazo del otro los cambia de lado: comparar un mazo consigo mismo no dice nada)
    $('#cmp-a').addEventListener('change', (e) => { if (e.target.value === prefs.cmpB) prefs.cmpB = prefs.cmpA; prefs.cmpA = e.target.value; savePrefs(); render(); });
    $('#cmp-b').addEventListener('change', (e) => { if (e.target.value === prefs.cmpA) prefs.cmpA = prefs.cmpB; prefs.cmpB = e.target.value; savePrefs(); render(); });
    $('#cmp-swap').addEventListener('click', () => { const t = prefs.cmpA; prefs.cmpA = prefs.cmpB; prefs.cmpB = t; savePrefs(); render(); });
    $('#cmp-size').addEventListener('click', (e) => {
      const b = e.target.closest('[data-n]');
      if (!b) return;
      prefs.cmpN = Number(b.dataset.n); savePrefs(); render();
    });
    $('#cmp-body').addEventListener('click', (e) => {
      const b = e.target.closest('[data-open]');
      if (!b) return;
      YGO.handtest.show(b.dataset.open);
      YGO.go('mano');
    });
  }

  function enter() {
    // Las preferencias pudieron cambiar en otra pestaña (Torneo, tamaño de la mano)
    const p = store.prefs();
    ['cmpA', 'cmpB', 'cmpN'].forEach((k) => { if (p[k] != null) prefs[k] = p[k]; });
    bind();
    render();
    savePrefs();
  }

  YGO.compare = { enter, summary, render };
})();
