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
  let sims = { hands: 0, withStarter: 0 };

  const decks = () => window.YGO.builder.decks();
  const starters = () => new Set(d.starters || []);
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
    const st = starters();
    if (hand.some((id) => st.has(id))) sims.withStarter++;
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

  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.className = 'toast toast-warn';
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
      ? hand.map((id, i) => '<div class="ht-card">' + view.tile(db.get(id), { attrs: 'data-index="' + i + '" tabindex="0"' })
        + '<button class="ht-back" type="button" data-index="' + i + '" title="Devolver al mazo" aria-label="Devolver al mazo">×</button></div>').join('')
      : '<p class="ht-empty">Pulsa <b>Robar mano</b> para una mano al azar, o usa <b>+</b> en la lista para elegir tus cartas.</p>';
    $('#ht-hand-count').textContent = hand.length;
    $('#ht-rest').textContent = rest.length;

    // Lista de cartas con probabilidades
    const N = d.main.length;
    const counts = unique(d.main);
    const inHand = unique(hand);
    const inRest = unique(rest);
    const st = starters();
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
        + '<td><button type="button" class="star' + (st.has(id) ? ' on' : '') + '" aria-pressed="' + st.has(id) + '" title="Marcar como starter">★</button></td>'
        + '</tr>';
    });
    $('#ht-rows').innerHTML = rows.join('') || '<tr><td colspan="6" class="ht-empty">Este mazo no tiene cartas en el mazo principal.</td></tr>';
    $('#ht-deck-n').textContent = N;

    renderStats(N, counts, st, n);
  }

  function renderStats(N, counts, st, n) {
    let K = 0;
    for (const id of st) K += counts.get(id) || 0;
    const box = $('#ht-stats');
    if (!K) {
      box.innerHTML = '<h3>Consistencia</h3><p class="hint">Marca con ★ las cartas que te permiten empezar tu combo (starters) para ver la probabilidad de abrir con al menos una.</p>'
        + simLine();
      return;
    }
    const p1 = game.pAtLeastOne(N, K, n);
    const dist = [0, 1, 2].map((k) => game.pExactly(N, K, n, k));
    dist.push(Math.max(0, 1 - dist[0] - dist[1] - dist[2]));
    const labels = ['0', '1', '2', '3+'];
    const st1 = hand.some((id) => st.has(id));
    box.innerHTML = '<h3>Consistencia</h3>'
      + '<p class="big"><b>' + game.pct(p1) + '</b> de abrir con al menos un starter</p>'
      + '<p class="hint">' + K + ' starters en ' + N + ' cartas, mano de ' + n + '.'
      + (hand.length ? ' Tu mano actual ' + (st1 ? '<span class="good">tiene starter</span>' : '<span class="bad">no tiene starter</span>') + '.' : '') + '</p>'
      + '<div class="dist">' + dist.map((p, i) => '<div class="dist-col"><span class="dist-bar" style="height:' + Math.max(2, p * 100).toFixed(1) + '%"></span>'
        + '<span class="dist-p">' + game.pct(p) + '</span><span class="dist-k">' + labels[i] + '</span></div>').join('') + '</div>'
      + '<p class="hint dist-cap">Cantidad de starters en la mano inicial</p>'
      + simLine();
  }

  function simLine() {
    if (!sims.hands) return '';
    return '<p class="sim">Manos robadas: <b>' + sims.hands + '</b> · con starter: <b>' + sims.withStarter + '</b> ('
      + game.pct(sims.withStarter / sims.hands) + ')</p>';
  }

  /* ---------- Eventos ---------- */
  function bind() {
    $('#ht-deck').addEventListener('change', (e) => {
      d = decks().find((x) => x.id === e.target.value);
      sims = { hands: 0, withStarter: 0 };
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
    $('#ht-rows').addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-id]');
      if (!tr) return;
      const id = Number(tr.dataset.id);
      if (e.target.closest('.ht-plus')) take(id);
      else if (e.target.closest('.ht-minus')) giveBack(id);
      else if (e.target.closest('.star')) {
        const s = starters();
        if (s.has(id)) s.delete(id); else s.add(id);
        d.starters = Array.from(s);
        window.YGO.builder.persist();
        render();
      } else if (e.target.closest('.ht-name, .card')) showCard(id);
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
