/* Prueba de mano: robar manos al azar o elegir exactamente qué cartas (y cuántas) tienes en mano,
 * con probabilidades de apertura calculadas sobre el mazo principal. */
(function () {
  const { db, game, view, store } = window.YGO;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = view.esc;

  const prefs = Object.assign({ handSize: 5 }, store.prefs());
  let d = null;          // mazo elegido
  let hand = [];         // códigos en mano
  let rest = [];         // códigos que quedan en el mazo, barajados
  let sims = { hands: 0, withStarter: 0, playable: 0, dead: 0 };

  const decks = () => window.YGO.builder.decks();

  /* Roles de carta: ★ Starter (se guarda en mazo.starters, lo usa también el rival con handtraps), Extender, Handtrap y
   * Ladrillo (carta que no quieres abrir). Los otros tres van en mazo.roles = { código: 'extender' | 'handtrap' | 'brick' }. */
  const ROLES = [
    { k: 'starter', short: '★', label: 'Starter' },
    { k: 'extender', short: 'E', label: 'Extender' },
    { k: 'handtrap', short: 'H', label: 'Handtrap' },
    { k: 'brick', short: 'L', label: 'Ladrillo' },
  ];
  const ROLE = Object.fromEntries(ROLES.map((r) => [r.k, r]));
  function roleOf(id) {
    if ((d.starters || []).includes(id)) return 'starter';
    const r = d.roles && d.roles[id];
    return ROLE[r] && r !== 'starter' ? r : '';
  }
  function setRole(id, role) {
    d.starters = (d.starters || []).filter((x) => x !== id);
    d.roles = Object.assign({}, d.roles);
    delete d.roles[id];
    if (role === 'starter') d.starters.push(id);
    else if (ROLE[role]) d.roles[id] = role;
  }
  /** Cuenta los roles de una lista de códigos → { starter, extender, handtrap, brick } */
  function roleCounts(list) {
    const out = { starter: 0, extender: 0, handtrap: 0, brick: 0 };
    for (const id of list) { const r = roleOf(id); if (r) out[r]++; }
    return out;
  }
  const savePrefs = () => store.savePrefs(Object.assign(store.prefs(), { handSize: prefs.handSize }));

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
    sims.hands++;
    const k = roleCounts(hand);
    if (k.starter) sims.withStarter++;
    if (k.starter && !k.brick) sims.playable++;
    if (!k.starter && !k.handtrap) sims.dead++;
    render();
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
  }

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
      + '</select>';
  }

  /* Probabilidades por rol, para ir primero (5) y segundo (6). Grupos disjuntos: [starter, extender, handtrap, brick]. */
  const METRICS = [
    { label: 'Al menos 1 starter', need: ['starter'], ok: (k) => k[0] >= 1 },
    { label: 'Starter + extender (o 2 starters)', need: ['starter', 'extender'], ok: (k) => k[0] >= 1 && (k[1] >= 1 || k[0] >= 2) },
    { label: 'Al menos 1 handtrap', need: ['handtrap'], ok: (k) => k[2] >= 1 },
    { label: '2 o más handtraps', need: ['handtrap'], ok: (k) => k[2] >= 2 },
    { label: 'Starter + handtrap', need: ['starter', 'handtrap'], ok: (k) => k[0] >= 1 && k[2] >= 1 },
    { label: 'Ningún ladrillo', need: ['brick'], ok: (k) => k[3] === 0 },
    { label: 'Starter y ningún ladrillo', need: ['starter', 'brick'], ok: (k) => k[0] >= 1 && k[3] === 0 },
    { label: 'Mano muerta (sin starter ni handtrap)', need: ['starter', 'handtrap'], ok: (k) => !k[0] && !k[2], bad: true },
  ];

  function renderStats(N, n) {
    const tot = roleCounts(d.main);
    const K = tot.starter;
    const box = $('#ht-stats');
    const any = tot.starter + tot.extender + tot.handtrap + tot.brick;
    if (!any) {
      box.innerHTML = '<h3>Consistencia</h3><p class="hint">Marca el rol de tus cartas en la lista (columna <b>Rol</b>): <b>★ Starter</b> (empieza tu combo), '
        + '<b>Extender</b> (lo alarga), <b>Handtrap</b> y <b>Ladrillo</b> (carta que no quieres abrir). Aquí verás la probabilidad exacta de cada mano, '
        + 'yendo primero y segundo.</p>' + simLine();
      return;
    }
    const groups = [tot.starter, tot.extender, tot.handtrap, tot.brick];
    const rows = METRICS.filter((m) => m.need.every((r) => tot[r] > 0)).map((m) => {
      const p5 = game.pMulti(N, groups, 5, m.ok), p6 = game.pMulti(N, groups, 6, m.ok);
      const cell = (p, size) => '<td class="num' + (size === n ? ' cur' : '') + '"><span class="bar' + (m.bad ? ' neg' : '') + '" style="--p:' + (p * 100).toFixed(1) + '%"></span>' + game.pct(p) + '</td>';
      return '<tr' + (m.bad ? ' class="neg"' : '') + '><th scope="row">' + m.label + '</th>' + cell(p5, 5) + cell(p6, 6) + '</tr>';
    });
    const counts = ROLES.filter((r) => tot[r.k]).map((r) => '<span class="role-badge r-' + r.k + '">' + r.short + '</span> ' + tot[r.k] + ' ' + r.label.toLowerCase()
      + (tot[r.k] === 1 ? '' : 's')).join(' · ');
    const table = '<table class="ht-odds"><thead><tr><th><span class="sr">Mano</span></th><th class="num' + (n === 5 ? ' cur' : '') + '">Primero · 5</th>'
      + '<th class="num' + (n === 6 ? ' cur' : '') + '">Segundo · 6</th></tr></thead><tbody>' + rows.join('') + '</tbody></table>';
    if (!K) {
      box.innerHTML = '<h3>Consistencia</h3><p class="hint roles-line">' + counts + ' en ' + N + ' cartas.</p>' + table + handLine() + simLine();
      return;
    }
    const p1 = game.pAtLeastOne(N, K, n);
    const dist = [0, 1, 2].map((k) => game.pExactly(N, K, n, k));
    dist.push(Math.max(0, 1 - dist[0] - dist[1] - dist[2]));
    const labels = ['0', '1', '2', '3+'];
    box.innerHTML = '<h3>Consistencia</h3>'
      + '<div class="ht-odds-wrap"><div class="ht-odds-main">'
      + '<p class="big"><b>' + game.pct(p1) + '</b> de abrir con al menos un starter</p>'
      + '<p class="hint roles-line">' + counts + ' en ' + N + ' cartas, mano de ' + n + '.</p>'
      + handLine()
      + '<div class="dist">' + dist.map((p, i) => '<div class="dist-col"><span class="dist-bar" style="height:' + Math.max(2, p * 100).toFixed(1) + '%"></span>'
        + '<span class="dist-p">' + game.pct(p) + '</span><span class="dist-k">' + labels[i] + '</span></div>').join('') + '</div>'
      + '<p class="hint dist-cap">Cantidad de starters en la mano inicial</p></div>'
      + table + '</div>'
      + simLine();
  }

  /** Cómo es la mano que tienes ahora, por roles. */
  function handLine() {
    if (!hand.length) return '';
    const k = roleCounts(hand);
    const tot = roleCounts(d.main);
    const parts = [];
    if (tot.starter) parts.push(k.starter ? '<span class="good">' + (k.starter > 1 ? k.starter + ' starters' : 'starter') + '</span>' : '<span class="bad">sin starter</span>');
    if (tot.extender) parts.push(k.extender ? '<span class="good">' + k.extender + ' extender' + (k.extender > 1 ? 's' : '') + '</span>' : 'sin extender');
    if (tot.handtrap) parts.push(k.handtrap ? '<span class="good">' + k.handtrap + ' handtrap' + (k.handtrap > 1 ? 's' : '') + '</span>' : 'sin handtraps');
    if (tot.brick) parts.push(k.brick ? '<span class="bad">' + k.brick + ' ladrillo' + (k.brick > 1 ? 's' : '') + '</span>' : 'sin ladrillos');
    if (!parts.length) return '';
    const dead = (tot.starter || tot.handtrap) && !k.starter && !k.handtrap;
    return '<p class="hand-line">Tu mano: ' + parts.join(' · ') + (dead ? ' · <span class="bad">mano muerta</span>' : '') + '</p>';
  }

  function simLine() {
    if (!sims.hands) return '';
    const tot = roleCounts(d.main);
    const part = (label, x) => ' · ' + label + ': <b>' + x + '</b> (' + game.pct(x / sims.hands) + ')';
    return '<p class="sim">Manos robadas: <b>' + sims.hands + '</b>' + part('con starter', sims.withStarter)
      + (tot.brick ? part('starter sin ladrillos', sims.playable) : '')
      + (tot.starter || tot.handtrap ? part('muertas', sims.dead) : '') + '</p>';
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
      sims = { hands: 0, withStarter: 0, playable: 0, dead: 0 };
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
      setRole(Number(tr.dataset.id), sel.value);
      window.YGO.builder.persist();
      render();
    });
    $('#ht-mark-ht').addEventListener('click', markHandtraps);
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
      resetDeck();
    } else {
      // El mazo pudo cambiar en el constructor: se descartan códigos que ya no están
      const pool = d.main.slice();
      hand = hand.filter((id) => { const i = pool.indexOf(id); if (i < 0) return false; pool.splice(i, 1); return true; });
      rest = game.shuffle(pool);
    }
    renderDeckSelect();
    render();
  }

  bind();
  window.YGO.handtest = { enter, rerender: () => d && render() };
})();
