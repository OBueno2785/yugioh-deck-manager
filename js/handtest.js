/* Prueba de mano: robar manos al azar o elegir exactamente qué cartas (y cuántas) tienes en mano,
 * con probabilidades de apertura calculadas sobre el mazo principal. */
(function () {
  const { db, game, view, store } = window.YGO;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = view.esc;

  const prefs = Object.assign({ handSize: 5, statsView: 'medals' }, store.prefs());
  let d = null;          // mazo elegido
  let hand = [];         // códigos en mano
  let rest = [];         // códigos que quedan en el mazo, barajados
  // Manos robadas al azar con «Robar mano»: { no, ids, n }. Los roles se miran al dibujar el panel (si cambias un rol, cuenta el nuevo).
  let sims = { log: [], count: 0 };
  const LOG_MAX = 500;
  // Último valor de cada pieza del panel ([data-k]): solo se anima lo que cambió de verdad (ver animate()).
  let prevVals = new Map();

  const decks = () => window.YGO.builder.decks();

  /* Roles de carta: ★ Starter (se guarda en mazo.starters, lo usa también el rival con handtraps), Starter 1,5 (necesita otra
   * carta), Pieza de combo (con su pareja), Extender, Handtrap y Ladrillo (carta que no quieres abrir). Los demás van en
   * mazo.roles = { código: rol }; las etiquetas avanzadas (⋯) en mazo.tags y los pares revisados en mazo.pairs (ver
   * js/playability.js y el panel Jugadas de js/playlab.js). */
  const ROLES = [
    { k: 'starter', short: '★', label: 'Starter' },
    { k: 'starter15', short: '★½', label: 'Starter 1,5' },
    { k: 'combo2', short: 'C2', label: 'Pieza de combo', many: 'Piezas de combo' },
    { k: 'extender', short: 'E', label: 'Extender' },
    { k: 'handtrap', short: 'H', label: 'Handtrap' },
    { k: 'brick', short: 'L', label: 'Ladrillo' },
  ];
  const ROLE = Object.fromEntries(ROLES.map((r) => [r.k, r]));
  const roleOf = (id) => window.YGO.play.roleOf(d, id);
  const setRole = (id, role) => window.YGO.play.setRole(d, id, role);
  /** Cuenta los roles de una lista de códigos → { starter, starter15, combo2, extender, handtrap, brick } */
  function roleCounts(list) {
    const out = Object.fromEntries(ROLES.map((r) => [r.k, 0]));
    for (const id of list) { const r = roleOf(id); if (r) out[r]++; }
    return out;
  }
  const savePrefs = () => store.savePrefs(Object.assign(store.prefs(), { handSize: prefs.handSize, statsView: prefs.statsView }));

  function unique(list) {
    const m = new Map();
    for (const id of list) m.set(id, (m.get(id) || 0) + 1);
    return m;
  }

  function resetDeck() {
    hand = [];
    rest = game.shuffle(d.main.slice());
  }

  function drawHand() {
    resetDeck();
    hand = rest.splice(0, prefs.handSize);
    sims.log.push({ no: ++sims.count, ids: hand.slice(), n: hand.length });
    if (sims.log.length > LOG_MAX) sims.log.shift();
    render();
    // Lector de pantalla: solo la mano nueva (el panel entero sería demasiado)
    const live = $('#ht-live'), line = $('#ht-stats .hand-line'), run = $('#ht-stats .gx-streak > span:nth-child(2)');
    if (live) live.textContent = 'Mano ' + sims.count + (line ? ': ' + line.textContent.replace(/^Tu mano:\s*/, '') : ' robada') + '.' + (run ? ' ' + run.textContent + '.' : '');
  }

  function draw1() {
    if (!rest.length) { toast('No quedan cartas en el mazo'); return; }
    hand.push(rest.shift());
    render();
  }

  function take(id) {
    const i = rest.indexOf(id);
    if (i < 0) return;
    rest.splice(i, 1);
    hand.push(id);
    render();
  }
  function giveBack(id, index) {
    const i = index !== undefined ? index : hand.lastIndexOf(id);
    if (i < 0) return;
    hand.splice(i, 1);
    rest.push(id);
    game.shuffle(rest);
    render();
  }

  function toast(msg, kind) {
    const el = $('#toast');
    el.textContent = msg;
    el.className = 'toast toast-' + (kind || 'warn');
    el.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { el.hidden = true; }, 2400);
  }

  function showCard(id) {
    const c = db.get(id);
    $('#modal-title').textContent = c.name;
    $('#modal-body').innerHTML = '<div class="modal-detail">' + view.detail(c) + '</div>';
    const foot = $('#modal-foot');
    foot.innerHTML = '<button type="button">Cerrar</button>';
    foot.firstChild.addEventListener('click', () => { $('#modal').hidden = true; });
    $('#modal').hidden = false;
  }

  /* ---------- Render ---------- */
  function renderDeckSelect() {
    $('#ht-deck').innerHTML = decks().map((x) => '<option value="' + x.id + '"' + (x === d ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('');
  }

  function render() {
    const n = prefs.handSize;
    $$('#ht-size button').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.n) === n)));

    // Mano
    $('#ht-hand').innerHTML = hand.length
      ? hand.map((id, i) => '<div class="ht-card">' + view.tile(db.get(id), { attrs: 'data-index="' + i + '" tabindex="0"' }) + roleBadge(id)
        + '<button class="ht-back" type="button" data-index="' + i + '" title="Devolver al mazo" aria-label="Devolver al mazo">×</button></div>').join('')
      : '<p class="ht-empty">Pulsa <b>Robar mano</b> para una mano al azar, o usa <b>+</b> en la lista para elegir tus cartas.</p>';
    $('#ht-hand-count').textContent = hand.length;
    $('#ht-rest').textContent = rest.length;

    // Lista de cartas con probabilidades
    const N = d.main.length;
    const counts = unique(d.main);
    const inHand = unique(hand);
    const inRest = unique(rest);
    const ids = Array.from(counts.keys());
    const rows = ids.map((id) => {
      const c = db.get(id);
      const K = counts.get(id);
      const h = inHand.get(id) || 0;
      const r = inRest.get(id) || 0;
      const pOpen = game.pAtLeastOne(N, K, n);
      const pNext = rest.length ? r / rest.length : 0;
      return '<tr data-id="' + id + '"' + (h ? ' class="in-hand"' : '') + '>'
        + '<td class="ht-c">' + view.tile(c) + '<button type="button" class="ht-name">' + esc(c.name) + '</button></td>'
        + '<td class="num">' + K + '</td>'
        + '<td class="num"><span class="bar" style="--p:' + (pOpen * 100).toFixed(1) + '%"></span>' + game.pct(pOpen) + '</td>'
        + '<td class="num">' + game.pct(pNext) + '</td>'
        + '<td class="stepper"><button type="button" class="ht-minus" aria-label="Quitar de la mano"' + (h ? '' : ' disabled') + '>−</button>'
        + '<b>' + h + '</b><button type="button" class="ht-plus" aria-label="Poner en la mano"' + (r ? '' : ' disabled') + '>+</button></td>'
        + '<td class="ht-role">' + roleSelect(id, c) + '</td>'
        + '</tr>';
    });
    $('#ht-rows').innerHTML = rows.join('') || '<tr><td colspan="6" class="ht-empty">Este mazo no tiene cartas en el mazo principal.</td></tr>';
    $('#ht-deck-n').textContent = N;

    renderStats(N, n);
    if (window.YGO.playlab) window.YGO.playlab.render($('#ht-plays'), d, hand, n, PLAY_HOOKS);
  }
  const PLAY_HOOKS = { persist: () => window.YGO.builder.persist(), showCard: (id) => showCard(id) };

  function roleBadge(id) {
    const r = roleOf(id);
    return r ? '<span class="role-badge r-' + r + '" title="' + ROLE[r].label + '">' + ROLE[r].short + '</span>' : '';
  }
  function roleSelect(id, c) {
    const r = roleOf(id);
    return '<label class="sr" for="role-' + id + '">Rol de ' + esc(c.name) + '</label>'
      + '<select id="role-' + id + '" class="role-pick' + (r ? ' r-' + r : '') + '" title="Rol de la carta">'
      + '<option value="">—</option>'
      + ROLES.map((x) => '<option value="' + x.k + '"' + (x.k === r ? ' selected' : '') + '>' + x.short + ' ' + x.label + '</option>').join('')
      + '</select>' + tagsBtn(id, c);
  }
  /** ⋯ Etiquetas de la carta (panel Jugadas): debajo del rol, para no ensanchar la tabla */
  function tagsBtn(id, c) {
    if (!window.YGO.playlab) return '';
    const tags = d.tags && d.tags[id] && Object.keys(d.tags[id]).length;
    return '<button type="button" class="ht-tags' + (tags ? ' has' : '') + '" id="tags-' + id + '" title="Etiquetas: rol, Invocación Normal, parejas de combo, qué anula un ladrillo"'
      + ' aria-label="Etiquetas de ' + esc(c.name) + (tags ? ' (tiene etiquetas)' : '') + '"><span aria-hidden="true">⋯<span class="ht-tags-w"> Etiquetas</span>' + (tags ? ' ●' : '') + '</span></button>';
  }

  /* Probabilidades por rol, para ir primero (5) y segundo (6). Grupos disjuntos: [starter, extender, handtrap, brick].
   * icon: las fichas de rol de su medalla ('!brick' = ninguno). */
  const METRICS = [
    { id: 's1', label: 'Al menos 1 starter', need: ['starter'], ok: (k) => k[0] >= 1, icon: ['starter'] },
    { id: 'se', label: 'Starter + extender (o 2 starters)', need: ['starter', 'extender'], ok: (k) => k[0] >= 1 && (k[1] >= 1 || k[0] >= 2), icon: ['starter', 'extender'] },
    { id: 'h1', label: 'Al menos 1 handtrap', need: ['handtrap'], ok: (k) => k[2] >= 1, icon: ['handtrap'] },
    { id: 'h2', label: '2 o más handtraps', need: ['handtrap'], ok: (k) => k[2] >= 2, icon: ['handtrap', 'handtrap'] },
    { id: 'sh', label: 'Starter + handtrap', need: ['starter', 'handtrap'], ok: (k) => k[0] >= 1 && k[2] >= 1, icon: ['starter', 'handtrap'] },
    { id: 'nl', label: 'Ningún ladrillo', need: ['brick'], ok: (k) => k[3] === 0, icon: ['!brick'] },
    { id: 'sl', label: 'Starter y ningún ladrillo', need: ['starter', 'brick'], ok: (k) => k[0] >= 1 && k[3] === 0, icon: ['starter', '!brick'] },
    { id: 'dd', label: 'Mano muerta (sin starter ni handtrap)', need: ['starter', 'handtrap'], ok: (k) => !k[0] && !k[2], bad: true },
  ];
  const kArr = (c) => [c.starter, c.extender, c.handtrap, c.brick];

  /* ---------- Panel «Consistencia», como la pantalla de resultado de un juego ----------
   * Rango del mazo S·A·B·C·D (sale solo del % de abrir con starter), medallas por logro, cuántos starters abres (abanicos de
   * cartas), tu mano, y tus manos robadas con racha y suerte frente a lo esperado. Toda cifra se lee como texto; «Tabla» muestra
   * las mismas en la tabla de siempre. Se redibuja entero en cada clic: solo se anima lo que cambió (animate()). */
  const RANKS = [{ k: 'S', min: 90 }, { k: 'A', min: 80 }, { k: 'B', min: 70 }, { k: 'C', min: 60 }, { k: 'D', min: -1 }];
  const MEDALS = [{ k: 'oro', label: 'Oro', min: 90 }, { k: 'plata', label: 'Plata', min: 80 }, { k: 'bronce', label: 'Bronce', min: 70 }];
  const SCALE = 'S desde 90% · A desde 80% · B desde 70% · C desde 60% · D menos';
  const r1 = (p) => Math.round(p * 1000) / 10; // el % como se ve (un decimal): los umbrales usan este valor, así el rango no contradice la cifra
  const rankOf = (p) => RANKS.find((x) => r1(p) >= x.min);
  const medalOf = (p) => MEDALS.find((x) => r1(p) >= x.min) || null;
  /** % del panel: nunca "0%" ni "100%" si no lo es del todo */
  const pc = (p) => (p <= 1e-12 ? '0%' : p >= 1 - 1e-9 ? '100%' : p < 0.0005 ? '<0,1%' : p >= 0.9995 ? '>99,9%' : game.pct(p));
  const grp = (x) => String(x).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const round2 = (x) => { if (x < 100) return Math.round(x); const e = Math.pow(10, Math.floor(Math.log10(x)) - 1); return Math.round(x / e) * e; };
  /** "1 de cada 13" (2 cifras: 1 de cada 1.800); desde 30%, "7 de cada 10" */
  const oneIn = (p) => {
    if (p < 0.3) return '1 de cada ' + grp(round2(1 / p));
    const k = Math.round(p * 10);
    return (p >= 1 - 1e-9 ? '10' : k >= 10 ? 'más de 9' : k) + ' de cada 10';
  };
  const plural = (x, one, many) => x + ' ' + (x === 1 ? one : many || one + 's');
  const badge = (r, cls) => '<span class="role-badge r-' + r + (cls ? ' ' + cls : '') + '" aria-hidden="true">' + ROLE[r].short + '</span>';
  const bothSizes = (n, a, b) => (n === 5 ? [a, b] : [b, a]);
  const OTHER = { 5: 'Segundo · 6', 6: 'Primero · 5' };

  /* Sello del rango: rosetón con cintas (SVG; un solo sello por panel, así los id de los degradados no se repiten) */
  const SEAL = {
    S: ['#fbe6a6', '#e2b24a', '#94691c', '#1b1405'], A: ['#f3f6fb', '#c3cede', '#76839b', '#121a2a'],
    B: ['#f3cba6', '#d39260', '#8a5428', '#22140a'], C: ['#c4d0e4', '#7f93b8', '#4c5d7f', '#0a1120'],
    D: ['#f6b0a8', '#e3594e', '#93322a', '#1f0806'], '?': ['#3a4d74', '#24365a', '#182540', '#8d9dbb'],
  };
  const SEAL_PTS = Array.from({ length: 48 }, (_, i) => {
    const a = (Math.PI * 2 * i) / 48 - Math.PI / 2, r = i % 2 ? 42.5 : 47;
    return (50 + r * Math.cos(a)).toFixed(1) + ',' + (48 + r * Math.sin(a)).toFixed(1);
  }).join(' ');
  function seal(rank, label, attrs) {
    const c = SEAL[rank], id = 'gx-seal-' + (rank === '?' ? 'x' : rank);
    const shine = rank === 'S' ? '<path d="M92 6 l2 6 6 2 -6 2 -2 6 -2 -6 -6 -2 6 -2z" fill="#f6d987"/><path d="M6 70 l1.4 4 4 1.4 -4 1.4 -1.4 4 -1.4 -4 -4 -1.4 4 -1.4z" fill="#f6d987" opacity=".8"/>' : '';
    return '<svg class="gx-seal" viewBox="0 0 100 118" role="img" aria-label="' + label + '"' + (attrs || '') + '>'
      + '<defs><linearGradient id="' + id + 'a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + c[0] + '"/><stop offset=".5" stop-color="' + c[1] + '"/><stop offset="1" stop-color="' + c[2] + '"/></linearGradient>'
      + '<linearGradient id="' + id + 'b" x1="1" y1="1" x2="0" y2="0"><stop offset="0" stop-color="' + c[0] + '"/><stop offset=".55" stop-color="' + c[1] + '"/><stop offset="1" stop-color="' + c[2] + '"/></linearGradient></defs>'
      + '<path d="M31 76 L20 116 L32 108 L40 117 L48 84Z" fill="' + c[2] + '"/><path d="M69 76 L80 116 L68 108 L60 117 L52 84Z" fill="' + c[2] + '"/>'
      + '<polygon points="' + SEAL_PTS + '" fill="url(#' + id + 'a)"/>'
      + '<circle cx="50" cy="48" r="35" fill="url(#' + id + 'b)" stroke="' + c[3] + '" stroke-opacity=".35" stroke-width="1.5"/>'
      + '<circle cx="50" cy="48" r="30.5" fill="none" stroke="' + c[3] + '" stroke-opacity=".22" stroke-width="1"/>'
      + '<ellipse cx="38" cy="30" rx="17" ry="7" fill="#fff" opacity=".2" transform="rotate(-28 38 30)"/>'
      + '<text x="50" y="64" text-anchor="middle" fill="' + c[3] + '">' + rank + '</text>' + shine + '</svg>';
  }

  /** 10 cartas a lo ancho: cuántas de cada 10 manos abren con starter (la última, a medias) */
  function freq(p) {
    const x = p * 10;
    let h = '';
    for (let i = 0; i < 10; i++) {
      const f = Math.max(0, Math.min(1, x - i));
      h += '<i class="gx-fc' + (f >= 1 ? ' on' : '') + '" style="--f:' + Math.round(f * 100) + '%"></i>';
    }
    const k = Math.round(x);
    const txt = p >= 1 - 1e-9 ? '10 de cada 10' : '≈ ' + (k >= 10 ? 'más de 9' : k <= 0 ? 'menos de 1' : k) + ' de cada 10';
    return '<div class="gx-freq"><span class="gx-fcs" aria-hidden="true">' + h + '</span><p><b>' + txt + '</b> manos abren con starter</p></div>';
  }

  /** Escalera D·C·B·A·S (con el % mínimo de cada rango) y la marca del mazo */
  function ladder(p) {
    const order = ['D', 'C', 'B', 'A', 'S'], cur = order.indexOf(rankOf(p).k), r = r1(p);
    const x = Math.max(2, Math.min(98, r < 60 ? (r / 60) * 20 : 20 + (r - 60) * 2));
    const min = { D: '<60', C: '60', B: '70', A: '80', S: '90' };
    return '<div class="gx-ladder" aria-hidden="true">' + order.map((k, i) => '<span class="gx-step' + (i < cur ? ' done' : i === cur ? ' cur' : '') + '">'
      + k + '<small>' + min[k] + '</small></span>').join('') + '<span class="gx-lad-mark" style="--x:' + x.toFixed(1) + '%"></span></div>';
  }

  /** Margen del rango: cuántos starters menos aguanta, o cuántos más faltan para el siguiente (solo datos exactos) */
  function rankNote(N, K, n, p) {
    const rk = rankOf(p);
    if (rk.k === 'S') {
      let k = 0;
      while (K - k - 1 > 0 && rankOf(game.pAtLeastOne(N, K - k - 1, n)).k === 'S') k++;
      if (k) return 'Margen: con <b>' + plural(k, 'starter') + ' menos</b> seguirías en S.';
      const q = game.pAtLeastOne(N, K - 1, n);
      return 'Al límite: con 1 starter menos bajarías a <b>' + rankOf(q).k + '</b> (' + pc(q) + ').';
    }
    const next = RANKS[RANKS.indexOf(rk) - 1];
    for (let k = 1; K + k <= N && k <= 20; k++) {
      const q = game.pAtLeastOne(N, K + k, n);
      if (r1(q) >= next.min) return 'Para <b>' + rankOf(q).k + '</b>: ' + plural(k, 'starter') + ' más en lugar de otras cartas (' + pc(q) + ').';
    }
    return '';
  }

  /** Cabecera: para qué mano, cuántas cartas de cada rol y el canto del mazo (una franja por carta) */
  function header(tot, N, n) {
    const any = ROLES.some((r) => tot[r.k]);
    let deck = '';
    if (any && N) {
      const none = N - ROLES.reduce((s, r) => s + tot[r.k], 0);
      deck = '<div class="gx-deck" aria-hidden="true">' + ROLES.map((r) => ('<i class="r-' + r.k + '"></i>').repeat(tot[r.k])).join('') + '<i></i>'.repeat(Math.max(0, none)) + '</div>';
    }
    return '<header class="gx-head"><h3>Consistencia</h3><span class="gx-mode">' + (n === 5 ? 'Yendo primero · mano de 5' : 'Yendo segundo · mano de 6') + '</span>'
      + (any ? '<p class="roles-line gx-roles">' + ROLES.filter((r) => tot[r.k]).map((r) => '<span>' + badge(r.k) + ' <b>' + tot[r.k] + '</b> '
        + (tot[r.k] === 1 ? r.label : r.many || r.label + 's').toLowerCase() + '</span>').join('') + '<span>en <b>' + N + '</b> cartas</span></p>' : '')
      + '</header>' + deck;
  }

  /** El rango del mazo: sello, cifra grande, 10 manos, la otra mano y la escalera */
  function hero(N, K, n, s1) {
    const [p, q] = bothSizes(n, s1.p5, s1.p6); // las mismas cifras que la fila de la tabla
    const rk = rankOf(p), rq = rankOf(q);
    return '<section class="gx-card gx-hero" aria-labelledby="gx-h-hero">'
      + '<h4 id="gx-h-hero">Rango del mazo · mano de ' + n + '</h4>'
      + '<div class="gx-hero-top">' + seal(rk.k, 'Rango ' + rk.k + ' (' + SCALE + ')', ' data-k="rank" data-v="' + (4 - RANKS.indexOf(rk)) + '"')
      + '<div class="gx-hero-body"><p class="gx-big"><b data-k="p" data-v="' + pc(p) + '">' + pc(p) + '</b>de abrir con al menos un starter</p>'
      + '<p class="gx-sub">' + (p < 1 - 1e-9 ? 'Sin starter: <b>' + oneIn(1 - p) + '</b> manos · ' : '') + '<span class="gx-nw">' + (n === 5 ? 'Yendo segundo' : 'Yendo primero') + ': <b>' + pc(q) + '</b>'
      + ' <span class="sr">rango </span><span class="gx-rk" title="Rango yendo ' + (n === 5 ? 'segundo' : 'primero') + '">' + rq.k + '</span></span></p></div></div>'
      + freq(p)
      + ladder(p)
      + '<p class="gx-note" title="' + SCALE + '">' + rankNote(N, K, n, p) + '</p>'
      + '</section>';
  }

  /* Cuántos starters abres: abanicos de n cartas (starters boca arriba) sobre pilas tan altas como la probabilidad */
  const DIST_K = ['0', '1', '2', '3+'], DIST_W = ['ninguno', '1 starter', '2 starters', '3 o más'];
  function distOf(N, K, n) {
    const d = [0, 1, 2].map((k) => game.pExactly(N, K, n, k));
    d.push(Math.max(0, 1 - d[0] - d[1] - d[2]));
    return d;
  }
  function fan(n, k) {
    const mid = (n - 1) / 2;
    const idx = Array.from({ length: n }, (_, i) => i);
    const star = new Set(idx.slice().sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid) || a - b).slice(0, k));
    return '<span class="gx-fan">' + idx.map((i) => '<i class="gx-mc' + (star.has(i) ? ' s' : '') + '" style="--a:' + ((i - mid) * 9).toFixed(1) + '"></i>').join('') + '</span>';
  }
  function roll(N, K, n, handK) {
    const d = distOf(N, K, n), o = distOf(N, K, n === 5 ? 6 : 5), max = Math.max(...d);
    const hk = handK && hand.length === n ? Math.min(3, handK.starter) : -1;
    const cols = d.map((p, i) => {
      const h = Math.max(3, (p / max) * 76).toFixed(1) + 'px';
      return '<div class="gx-dcol' + (i === 0 ? ' is-zero' : '') + (i === hk ? ' is-hand' : '') + '" data-k="d' + i + '" data-v="' + pc(p) + '" data-w="' + h + '">'
        + '<span class="gx-dtag">' + (p === max ? 'Más común' : '') + '</span><span class="gx-dp">' + pc(p) + '</span>' + fan(n, i)
        + '<span class="gx-pile" style="height:' + h + '"></span><span class="gx-dk"><b>' + DIST_K[i] + '</b>' + DIST_W[i] + '</span>'
        + '<span class="gx-dhand">' + (i === hk ? '▲ tu mano' : '') + '</span></div>';
    }).join('');
    const table = '<table class="sr"><caption>Starters en la mano inicial</caption><thead><tr><th scope="col">Starters</th><th scope="col">Primero · 5</th>'
      + '<th scope="col">Segundo · 6</th></tr></thead><tbody>' + d.map((p, i) => { const [p5, p6] = bothSizes(n, p, o[i]); return '<tr><th scope="row">' + DIST_K[i] + '</th><td>' + pc(p5) + '</td><td>' + pc(p6) + '</td></tr>'; }).join('')
      + '</tbody></table>';
    const mode = d.indexOf(max);
    return '<section class="gx-card gx-roll" aria-labelledby="gx-h-roll">'
      + '<h4 id="gx-h-roll">¿Cuántos starters abres? · mano de ' + n + '</h4>'
      + '<div class="gx-dist" aria-hidden="true">' + cols + '</div>' + table
      + '<p class="gx-note">Lo más común: <b>' + DIST_W[mode] + '</b> (' + pc(max) + '). Ninguno: <b>' + pc(d[0]) + '</b>' + (d[0] > 0 ? ' <span class="gx-nw">(' + oneIn(d[0]) + ')</span>' : '') + '.</p>'
      + handBox()
      + '</section>';
  }

  /** Tu mano: sus cartas como cartitas del color de su rol, y cómo es (handLine) */
  function handBox() {
    if (!hand.length) return '';
    const cards = hand.map((id) => { const r = roleOf(id); return '<i class="gx-hc' + (r ? ' r-' + r : '') + '">' + (r ? ROLE[r].short : '') + '</i>'; }).join('');
    return '<div class="gx-hand"><span class="gx-hcs" aria-hidden="true">' + cards + '</span>' + handLine() + '</div>';
  }

  /* Medallas: oro desde 90%, plata desde 80%, bronce desde 70% (la cifra de la mano elegida); debajo, sin medalla */
  function medalIcons(list) { return (list || []).map((x) => (x[0] === '!' ? badge(x.slice(1), 'gx-no') : badge(x))).join(''); }
  function tile(m, n, kk) {
    const [p, q] = bothSizes(n, m.p5, m.p6);
    const w = (x) => (x * 100).toFixed(1) + '%';
    if (m.bad) {
      const dead = kk && m.ok(kk);
      return '<li class="gx-tile t-risk" data-k="m-' + m.id + '" data-v="' + pc(p) + '">'
        + '<span class="gx-medal" aria-hidden="true">☠</span>'
        + '<div class="gx-tm"><p class="gx-tn">' + m.label + (dead ? '<span class="sr"> (tu mano lo es)</span>' : '') + '</p>'
        + '<p class="gx-to">' + (p > 0 ? '<span class="gx-odds">≈ ' + oneIn(p) + ' manos</span>' : '<span class="gx-odds">Nunca</span>') + '<span>' + OTHER[n] + ': <b>' + pc(q) + '</b></span></p></div>'
        + '<p class="gx-tv"><span class="sr">' + OTHER[n === 5 ? 6 : 5] + ': </span><b>' + pc(p) + '</b>' + (dead ? '<span class="gx-stamp">Tu mano</span>' : '<span class="gx-tier">Menos es mejor</span>') + '</p></li>';
    }
    const md = medalOf(p), met = kk && m.ok(kk);
    return '<li class="gx-tile t-' + (md ? md.k : 'sin') + '" data-k="m-' + m.id + '" data-v="' + pc(p) + '" data-w="' + w(p) + '">'
      + '<span class="gx-medal" data-k="t-' + m.id + '" data-v="' + (md ? 3 - MEDALS.indexOf(md) : 0) + '" aria-hidden="true">' + medalIcons(m.icon)
      + (met ? '<span class="gx-check">✓</span>' : '') + '</span>'
      + '<div class="gx-tm"><p class="gx-tn">' + m.label + (met ? '<span class="sr"> (tu mano lo cumple)</span>' : '') + '</p>'
      + '<span class="gx-meter" aria-hidden="true"><i style="width:' + w(p) + '"></i><u style="left:' + w(q) + '"></u></span>'
      + '<p class="gx-to"><span>' + OTHER[n] + ': <b>' + pc(q) + '</b></span></p></div>'
      + '<p class="gx-tv"><span class="sr">' + OTHER[n === 5 ? 6 : 5] + ': </span><b>' + pc(p) + '</b>' + (md ? '<span class="gx-tier">' + md.label + '</span>' : '') + '</p></li>';
  }
  /** La tabla de siempre (las dos manos, lado a lado) */
  function oddsTable(ms, n) {
    const rows = ms.map((m) => {
      const cell = (p, size) => '<td class="num' + (size === n ? ' cur' : '') + '"><span class="bar' + (m.bad ? ' neg' : '') + '" style="--p:' + (p * 100).toFixed(1) + '%"></span>' + pc(p) + '</td>';
      return '<tr' + (m.bad ? ' class="neg"' : '') + '><th scope="row">' + m.label + '</th>' + cell(m.p5, 5) + cell(m.p6, 6) + '</tr>';
    });
    return '<table class="ht-odds"><caption class="sr">Probabilidades yendo primero (mano de 5) y segundo (mano de 6)</caption>'
      + '<thead><tr><th scope="col"><span class="sr">Mano</span></th><th scope="col" class="num' + (n === 5 ? ' cur' : '') + '">Primero · 5</th>'
      + '<th scope="col" class="num' + (n === 6 ? ' cur' : '') + '">Segundo · 6</th></tr></thead><tbody>' + rows.join('') + '</tbody></table>';
  }
  function achievements(ms, n, handK, heroShown) {
    const table = prefs.statsView === 'table';
    const kk = handK && hand.length === n && kArr(handK); // ✓ solo si tu mano es de este tamaño
    const tiles = ms.filter((m) => !(heroShown && m.id === 's1'));
    const pressed = (v) => ' aria-pressed="' + (prefs.statsView === v || (v === 'medals' && !table)) + '"';
    return '<section class="gx-ach" aria-labelledby="gx-h-ach">'
      + '<header><h4 id="gx-h-ach">' + (table ? 'Probabilidades' : 'Logros · mano de ' + n) + '</h4>'
      + '<div class="seg gx-view" role="group" aria-label="Ver las probabilidades como"><button type="button" data-view="medals"' + pressed('medals') + '>Medallas</button>'
      + '<button type="button" data-view="table"' + pressed('table') + '>Tabla</button></div>'
      + (table || !tiles.length ? '' : '<p class="gx-legend"><span class="t-oro">oro desde 90%</span><span class="t-plata">plata desde 80%</span><span class="t-bronce">bronce desde 70%</span>'
        + (kk ? '<span class="k-met">tu mano lo cumple</span>' : '') + '</p>')
      + '</header>'
      + (table ? oddsTable(ms, n) : tiles.length ? '<ul class="gx-tiles">' + tiles.map((m) => tile(m, n, kk)).join('') + '</ul>'
        : '<p class="gx-note">Marca extenders, handtraps o ladrillos en la columna <b>Rol</b> para ganar medallas.</p>')
      + '</section>';
  }

  /* ---------- Tus manos robadas: historial, racha y suerte frente a lo esperado ---------- */
  /** Cuántas veces sale algo en manos con probabilidades distintas (binomial de Poisson): [P(0), P(1), …] */
  function countDist(ps) {
    let f = [1];
    for (const p of ps) {
      const g = new Array(f.length + 1).fill(0);
      for (let i = 0; i < f.length; i++) { g[i] += f[i] * (1 - p); g[i + 1] += f[i] * p; }
      f = g;
    }
    return f;
  }
  /** Rango normal (95%): de lo que sale 2,5% de las veces o menos por abajo, a lo de 2,5% o menos por arriba */
  function normalRange(ps) {
    const f = countDist(ps);
    let c = 0, lo = -1, hi = -1;
    for (let k = 0; k < f.length; k++) { c += f[k]; if (lo < 0 && c >= 0.025) lo = k; if (hi < 0 && c >= 0.975) { hi = k; break; } }
    return [Math.max(0, lo), hi < 0 ? f.length - 1 : hi];
  }
  const VERDICT_MIN = 20;
  const CHIP = { s: ['★', 'con starter, sin ladrillos'], b: ['★', 'con starter y ladrillo'], x: ['–', 'sin starter'], d: ['☠', 'mano muerta'], o: ['·', 'robada'] };
  function session(N, tot, groups) {
    const L = sims.log, H = L.length;
    if (!H) return '';
    const deadOn = tot.starter > 0 && tot.handtrap > 0; // como la fila «Mano muerta»: hace falta marcar starters y handtraps
    const ks = L.map((e) => kArr(roleCounts(e.ids)));
    const code = (k) => (deadOn && !k[0] && !k[2] ? 'd' : !tot.starter ? 'o' : k[0] ? (tot.brick && k[3] ? 'b' : 's') : 'x');
    const codes = ks.map(code);
    const shown = L.slice(-20);
    const chips = shown.map((e, i) => {
      const c = codes[H - shown.length + i];
      return '<li class="gx-chip c-' + c + (i === shown.length - 1 ? ' is-last' : '') + '" data-k="h-' + e.no + '" data-v="' + c + '">'
        + '<span aria-hidden="true">' + CHIP[c][0] + '</span><span class="sr">Mano ' + e.no + ': ' + CHIP[c][1] + '</span></li>';
    }).join('');
    const legend = (tot.starter ? '<span><i class="c-s">★</i>con starter</span>' + (tot.brick ? '<span><i class="c-b">★</i>con ladrillo</span>' : '') + '<span><i class="c-x">–</i>sin starter</span>' : '')
      + (deadOn ? '<span><i class="c-d">☠</i>muerta</span>' : '') + (tot.starter ? '' : '<span><i class="c-o">·</i>mano robada (marca starters para tu racha)</span>');
    // Racha: manos seguidas con starter
    let streak = '';
    if (tot.starter) {
      let run = 0, best = 0;
      ks.forEach((k) => { run = k[0] ? run + 1 : 0; best = Math.max(best, run); });
      streak = '<p class="gx-streak"><span class="gx-streak-n" data-k="streak" data-v="' + run + '" aria-hidden="true">×' + run + '</span><span>Racha: <b>' + plural(run, 'mano') + '</b> seguida'
        + (run === 1 ? '' : 's') + ' con starter' + (best > run ? ' · mejor: <b>' + best + '</b>' : '') + '</span>'
        + (run >= 5 && run === best ? '<span class="gx-rec">Récord</span>' : '') + '</p>';
    }
    // Lo que te salió frente a lo esperado (cada mano con su tamaño: 5 o 6)
    const pOf = {};
    const rows = [];
    const add = (id, label, ok, bad) => {
      const ps = L.map((e) => {
        const key = id + e.n;
        if (pOf[key] == null) pOf[key] = game.pMulti(N, groups, e.n, ok);
        return pOf[key];
      });
      const x = ks.filter(ok).length, exp = ps.reduce((s, p) => s + p, 0) / H;
      const [lo, hi] = normalRange(ps);
      const out = H >= VERDICT_MIN && (x < lo || x > hi);
      const cls = !out ? 'even' : (x > hi) !== !!bad ? 'up' : 'down';
      rows.push({ id, x, lo, hi, cls });
      const word = !out ? '' : ' · <span class="gx-out ' + cls + '">' + (x > hi ? 'más' : 'menos') + ' de lo normal</span>';
      return '<li class="gx-vs-row" data-k="o-' + id + '" data-v="' + x + '/' + H + '"><span class="l">' + label + '</span>'
        + '<span class="s"><b>' + x + ' de ' + H + '</b> · ' + game.pct(x / H) + '</span>'
        + '<span class="gx-bullet" aria-hidden="true"><i class="you ' + cls + '" style="width:' + (x / H * 100).toFixed(1) + '%"></i><i class="exp" style="left:' + (exp * 100).toFixed(1) + '%"></i></span>'
        + '<span class="e">esperado <b>' + pc(exp) + '</b>' + word + '</span></li>';
    };
    const vs = (tot.starter ? add('s1', 'Con starter', METRICS[0].ok) : '')
      + (tot.starter && tot.brick ? add('sl', 'Starter sin ladrillos', METRICS[6].ok) : '')
      + (deadOn ? add('dd', 'Muertas', METRICS[7].ok, true) : '');
    let verdict = '';
    const main = rows[0];
    if (main && main.id === 's1') {
      if (H < VERDICT_MIN) {
        verdict = '<p class="gx-verdict"><span class="gx-die" aria-hidden="true">⚄</span><span>Con <b>' + VERDICT_MIN + ' manos</b> te digo si estás con suerte. Llevas <b>' + H + '</b>: sigue robando'
          + '<span class="kbd-hint">&nbsp;con <kbd>R</kbd></span>.</span></p>';
      } else {
        const range = 'lo normal con ' + H + ' manos es abrir starter entre <b>' + main.lo + '</b> y <b>' + main.hi + '</b> veces';
        verdict = main.cls === 'down'
          ? '<p class="gx-verdict down"><span class="gx-die" aria-hidden="true">⚄</span><span><b>Mala suerte.</b> ' + main.x + ' de ' + H + ' con starter, y ' + range + '. Pasa menos de 1 de cada 40 veces: es el azar, no el mazo.</span></p>'
          : main.cls === 'up'
            ? '<p class="gx-verdict up"><span class="gx-die" aria-hidden="true">⚄</span><span><b>¡Buena suerte!</b> ' + main.x + ' de ' + H + ' con starter, y ' + range + '. Pasa menos de 1 de cada 40 veces.</span></p>'
            : '<p class="gx-verdict"><span class="gx-die" aria-hidden="true">⚄</span><span><b>Dentro de lo normal:</b> ' + range + '.</span></p>';
      }
    }
    return '<section class="gx-card gx-sess" aria-labelledby="gx-h-sess">'
      + '<h4 id="gx-h-sess">Manos robadas: <b>' + sims.count + '</b>' + (sims.count > H ? ' <small>(cuentan las últimas ' + H + ')</small>' : '') + '</h4>'
      + '<div class="gx-sess-body"><div class="gx-sess-a">'
      + '<ol class="gx-chips" aria-label="Últimas ' + shown.length + ' manos, de la más antigua a la más reciente">' + chips + '</ol>'
      + (legend ? '<p class="gx-chips-legend" aria-hidden="true">' + legend + '</p>' : '')
      + streak + '</div>'
      + (vs ? '<ul class="gx-vs">' + vs + '</ul>' : '') + '</div>'
      + verdict + '</section>';
  }

  function renderStats(N, n) {
    const box = $('#ht-stats');
    const ae = document.activeElement, fv = ae && box.contains(ae) && ae.dataset.view;
    try { draw(box, N, n); } finally {
      const nb = fv && box.querySelector('[data-view="' + fv + '"]');
      if (nb) nb.focus();
    }
  }
  function draw(box, N, n) {
    const tot = roleCounts(d.main);
    const any = ROLES.some((r) => tot[r.k]);
    if (!any) {
      box.innerHTML = header(tot, N, n)
        + '<div class="gx-card gx-locked">' + seal('?', 'Sin rango todavía') + '<div><p><b>Desbloquea el rango de tu mazo.</b> Marca el rol de tus cartas en la lista '
        + '(columna <b>Rol</b>): aquí verás tu rango, tus medallas y la probabilidad exacta de cada mano, yendo primero y segundo.</p>'
        + '<ul class="gx-rolelist"><li>' + badge('starter') + '<span><b>★ Starter</b>: empieza tu combo (da el rango)</span></li>'
        + '<li>' + badge('starter15') + '<span><b>Starter 1,5</b>: empieza tu combo si abres además lo que necesita</span></li>'
        + '<li>' + badge('combo2') + '<span><b>Pieza de combo</b>: es jugada con su pareja</span></li>'
        + '<li>' + badge('extender') + '<span><b>Extender</b>: lo alarga</span></li>'
        + '<li>' + badge('handtrap') + '<span><b>Handtrap</b>: interrumpe al rival desde la mano</span></li>'
        + '<li>' + badge('brick') + '<span><b>Ladrillo</b>: carta que no quieres abrir</span></li></ul></div></div>'
        + (sims.log.length ? '<p class="gx-sim">Manos robadas: <b>' + sims.log.length + '</b>. Marca roles para ver tu racha y tu suerte.</p>' : '');
      animate(box);
      return;
    }
    const groups = kArr(tot);
    const handK = hand.length ? roleCounts(hand) : null;
    const ms = METRICS.filter((m) => m.need.every((r) => tot[r] > 0))
      .map((m) => Object.assign({}, m, { p5: game.pMulti(N, groups, 5, m.ok), p6: game.pMulti(N, groups, 6, m.ok) }));
    const K = tot.starter;
    const sess = session(N, tot, groups);
    if (!K) {
      box.innerHTML = header(tot, N, n)
        + '<div class="gx-grid gx-simple"><div class="gx-card gx-locked">' + seal('?', 'Sin rango todavía') + '<p><b>Sin rango todavía.</b> Marca tus starters '
        + badge('starter') + ' en la columna <b>Rol</b>: el mazo recibe un rango de S a D según cuánto abres con starter.</p></div>'
        + (hand.length ? '<section class="gx-card" aria-label="Tu mano">' + handBox() + '</section>' : '')
        + achievements(ms, n, handK, false) + sess + '</div>';
    } else {
      box.innerHTML = header(tot, N, n)
        + '<div class="gx-grid">' + hero(N, K, n, ms[0]) + roll(N, K, n, handK) + achievements(ms, n, handK, true) + sess + '</div>';
    }
    animate(box);
  }

  /** Marca lo que cambió desde el dibujo anterior (y la mano recién robada) para que solo eso se mueva */
  function animate(box) {
    const next = new Map();
    const had = prevVals.size > 0;
    box.querySelectorAll('[data-k]').forEach((el) => {
      const k = el.dataset.k, v = el.dataset.v, was = prevVals.get(k);
      next.set(k, { v, w: el.dataset.w });
      if (!had) return;
      if (!was) { if (k.startsWith('h-')) el.classList.add('is-new'); return; }
      if (was.v === v) return;
      el.classList.add('is-changed');
      if (Number(v) > Number(was.v)) el.classList.add('is-up');
      if (!was.w) return;
      if (/px$/.test(was.w)) { // pila: crece con scale y el abanico la acompaña, sin mover la fila
        const a = parseFloat(was.w), b = parseFloat(el.dataset.w) || a;
        el.style.setProperty('--s0', (a / b).toFixed(3));
        el.style.setProperty('--dy0', (b - a).toFixed(1) + 'px');
      } else el.style.setProperty('--w0', was.w);
    });
    prevVals = next;
  }

  /** Cómo es la mano que tienes ahora, por roles. */
  function handLine() {
    if (!hand.length) return '';
    const k = roleCounts(hand);
    const tot = roleCounts(d.main);
    const parts = [];
    if (tot.starter) parts.push(k.starter ? '<span class="good">' + k.starter + ' starter' + (k.starter > 1 ? 's' : '') + '</span>' : '<span class="bad">sin starter</span>');
    if (tot.extender) parts.push(k.extender ? '<span class="good">' + k.extender + ' extender' + (k.extender > 1 ? 's' : '') + '</span>' : 'sin extender');
    if (tot.handtrap) parts.push(k.handtrap ? '<span class="good">' + k.handtrap + ' handtrap' + (k.handtrap > 1 ? 's' : '') + '</span>' : 'sin handtraps');
    if (tot.brick) parts.push(k.brick ? '<span class="bad">' + k.brick + ' ladrillo' + (k.brick > 1 ? 's' : '') + '</span>' : 'sin ladrillos');
    if (!parts.length) return '';
    const dead = tot.starter && tot.handtrap && !k.starter && !k.handtrap;
    return '<p class="hand-line">Tu mano: ' + parts.join(' · ') + (dead ? ' · <span class="bad">mano muerta</span>' : '') + '</p>';
  }

  /** Marca como Handtrap las cartas del mazo que el rival con handtraps conoce (y algunas más comunes), sin tocar las que ya tienen rol. */
  const MORE_HANDTRAPS = ['Maxx "C"', 'Ghost Sister & Spooky Dogwood', 'Herald of Orange Light', 'Gnomaterial', 'Ghost Ogre & Snow Rabbit',
    'Nibiru, the Primal Being', 'Bystial Druiswurm', 'Bystial Saronir', 'Dimension Shifter', 'Mulcharmy Meowls'];
  function markHandtraps() {
    const bot = window.YGO.bot;
    const more = new Set(MORE_HANDTRAPS.map((x) => { const c = db.findByName(x); return c && c.id; }).filter(Boolean));
    let n = 0;
    for (const id of new Set(d.main)) {
      if (roleOf(id)) continue;
      const c = db.get(id);
      if ((bot && bot.isHandtrap(c.name)) || more.has(c.id)) { setRole(id, 'handtrap'); n++; }
    }
    if (n) { window.YGO.builder.persist(); render(); }
    toast(n ? 'Marcadas ' + n + ' handtraps' : 'No encontré handtraps sin rol en este mazo', n ? 'ok' : 'warn');
  }

  /* ---------- Eventos ---------- */
  function bind() {
    $('#ht-deck').addEventListener('change', (e) => {
      d = decks().find((x) => x.id === e.target.value);
      sims = { log: [], count: 0 };
      prevVals = new Map();
      resetDeck();
      render();
    });
    $$('#ht-size button').forEach((b) => b.addEventListener('click', () => {
      prefs.handSize = Number(b.dataset.n);
      savePrefs();
      render();
    }));
    $('#ht-draw').addEventListener('click', drawHand);
    $('#ht-draw1').addEventListener('click', draw1);
    $('#ht-clear').addEventListener('click', () => { resetDeck(); render(); });
    $('#ht-tofield').addEventListener('click', () => {
      // Con 6 cartas vas segundo: la 6ª cuenta como la robada en la Fase de Robo (turno 2)
      window.YGO.field.load(d, hand.slice(), rest.slice(), { second: hand.length === 6 });
      window.YGO.go('campo');
    });
    $('#ht-hand').addEventListener('click', (e) => {
      const back = e.target.closest('.ht-back');
      if (back) { giveBack(hand[Number(back.dataset.index)], Number(back.dataset.index)); return; }
      const card = e.target.closest('.card');
      if (card) showCard(Number(card.dataset.id));
    });
    $('#ht-rows').addEventListener('change', (e) => {
      const sel = e.target.closest('.role-pick');
      const tr = e.target.closest('tr[data-id]');
      if (!sel || !tr) return;
      const id = tr.dataset.id;
      setRole(Number(id), sel.value);
      window.YGO.builder.persist();
      render();
      const ns = document.getElementById('role-' + id);
      if (ns && ns !== document.activeElement) ns.focus();
    });
    $('#ht-mark-ht').addEventListener('click', markHandtraps);
    // Etiquetas avanzadas de una carta (⋯ en la columna Rol)
    $('#ht-rows').addEventListener('click', (e) => {
      const b = e.target.closest('.ht-tags');
      if (!b || !window.YGO.playlab) return;
      const id = Number(b.closest('tr[data-id]').dataset.id);
      window.YGO.playlab.editTags(d, id, { saved: () => {
        window.YGO.builder.persist();
        render();
        const nb = document.getElementById('tags-' + id);
        if (nb) nb.focus();
      } });
    });
    // Consistencia: ver como Medallas o Tabla (el panel se redibuja: el foco vuelve al botón)
    $('#ht-stats').addEventListener('click', (e) => {
      const b = e.target.closest('[data-view]');
      if (!b || b.dataset.view === prefs.statsView) return;
      prefs.statsView = b.dataset.view === 'table' ? 'table' : 'medals';
      savePrefs();
      render();
      const nb = $('#ht-stats [data-view="' + prefs.statsView + '"]');
      if (nb) nb.focus();
    });
    // Atajos: R robar mano, 1 robar una carta
    document.addEventListener('keydown', (e) => {
      if (document.body.dataset.mode !== 'mano' || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target.matches('input, select, textarea') || !$('#modal').hidden) return;
      if (e.key === 'r' || e.key === 'R') { e.preventDefault(); drawHand(); }
      else if (e.key === '1') { e.preventDefault(); draw1(); }
    });
    $('#ht-rows').addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-id]');
      if (!tr) return;
      const id = Number(tr.dataset.id);
      if (e.target.closest('.ht-plus')) take(id);
      else if (e.target.closest('.ht-minus')) giveBack(id);
      else if (e.target.closest('.ht-name, .card')) showCard(id);
    });
  }

  /** Se llama al entrar en la pestaña. */
  function enter() {
    const list = decks();
    if (!d || !list.includes(d)) {
      d = window.YGO.builder.current();
      sims = { log: [], count: 0 };
      resetDeck();
    } else {
      // El mazo pudo cambiar en el constructor: se descartan códigos que ya no están
      const pool = d.main.slice();
      hand = hand.filter((id) => { const i = pool.indexOf(id); if (i < 0) return false; pool.splice(i, 1); return true; });
      rest = game.shuffle(pool);
    }
    renderDeckSelect();
    prevVals = new Map(); // al entrar no se anima nada
    render();
  }

  bind();
  window.YGO.handtest = { enter, rerender: () => d && render() };
})();
