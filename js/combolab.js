/* Combos: revisar los combos grabados de cada mazo (los que el CPU repite en VS). Lista, pasos con sus cartas, campo final,
 * con qué mano empieza y qué tan seguido la abre, si el mazo de ahora tiene todo lo que usa; usarlo o no, renombrar, borrar,
 * verlo jugarse solo en el campo (Reproducir) o practicarlo con su mano. Grabar sigue en Campo → Prueba («Grabar combo»). Expone window.YGO.combolab. */
(function () {
  const YGO = (window.YGO = window.YGO || {});
  const { db, view, store } = YGO;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = view.esc;
  const arr = (x) => (Array.isArray(x) ? x : []);
  const q = (n) => '«' + n + '»';
  const C = () => YGO.combos || null;
  const decks = () => (YGO.builder ? YGO.builder.decks() : []);
  const nameById = (id) => { const c = db.get(id); return c ? c.name : 'Carta ' + id; };
  const pct = (p) => (p * 100).toLocaleString('es', { maximumFractionDigits: 1, minimumFractionDigits: p > 0 && p < 1 ? 1 : 0 }) + ' %';
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

  let d = null;        // mazo elegido
  let sel = null;      // id del combo que se ve

  function call(name, args, fallback) {
    const c = C();
    if (c && typeof c[name] === 'function') {
      try { const v = c[name].apply(c, args); if (v !== undefined) return v; } catch (err) { console.warn('YGO.combos.' + name + ' falló', err); }
    }
    return fallback;
  }
  const listOf = (deck) => (deck ? arr(call('list', [deck.id], [])) : []);

  /* ---------- Cuentas ---------- */
  const tally = (ids) => { const m = new Map(); for (const id of ids) m.set(Number(id), (m.get(Number(id)) || 0) + 1); return m; };
  const binom = (n, k) => { if (k < 0 || k > n) return 0; let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return r; };
  /** Probabilidad de que una mano de h cartas del mazo main tenga todas las cartas de need (con sus copias). */
  function pHand(main, need, h) {
    const have = tally(main);
    const N = main.length;
    if (!N || h > N) return 0;
    let ways = new Map([[0, 1]]);
    let inNeed = 0;
    for (const [id, k] of tally(need)) {
      const n = have.get(id) || 0;
      if (n < k) return 0;
      inNeed += n;
      const next = new Map();
      for (const [t, w] of ways) for (let x = k; x <= Math.min(n, h - t); x++) next.set(t + x, (next.get(t + x) || 0) + w * binom(n, x));
      ways = next;
    }
    let ok = 0;
    for (const [t, w] of ways) ok += w * binom(N - inNeed, h - t);
    return ok / binom(N, h);
  }
  /** Probabilidad de que la mano tenga lo que empieza alguno de estos combos (20.000 manos con la misma semilla: el número
   * no cambia cada vez que se dibuja). */
  function pAny(main, combos, h) {
    const needs = combos.map((c) => tally(arr(c.hand))).filter((m) => m.size);
    if (!needs.length || main.length < h) return 0;
    let s = 0x9e3779b9;
    const rnd = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const deck = main.map(Number);
    const N = 20000;
    let hits = 0;
    for (let i = 0; i < N; i++) {
      // Las primeras h cartas de un barajado parcial
      for (let j = 0; j < h; j++) { const k = j + Math.floor(rnd() * (deck.length - j)); const t = deck[j]; deck[j] = deck[k]; deck[k] = t; }
      const hand = tally(deck.slice(0, h));
      if (needs.some((m) => [...m].every(([id, k]) => (hand.get(id) || 0) >= k))) hits++;
    }
    return hits / N;
  }
  /** Lo que el combo usa y el mazo de ahora no tiene → [texto] */
  function missing(deck, c) {
    const out = [];
    const main = tally(deck.main), extra = tally(deck.extra);
    const check = (need, have, where) => {
      for (const [id, k] of tally(need)) {
        const n = have.get(id) || 0;
        if (n < k) out.push(q(nameById(id)) + ': usa ' + k + (k === 1 ? ' copia' : ' copias') + ' ' + where + ' y el mazo tiene ' + n + '.');
      }
    };
    const needs = c.needs || {};
    check(arr(c.hand).concat(arr(needs.deck)), main, 'del Mazo principal');
    check(arr(needs.extra), extra, 'del Extra Deck');
    return out;
  }
  const declared = (c) => arr(c.steps).some((st) => st.t === 'act' && arr(st.links).some((l) => !l.inferred));
  /** Las cartas de un paso (para dibujarlas): la que se Invoca o las que se activan, y luego las que mueve. */
  function stepCards(c, st) {
    const refs = arr(c.refs);
    const ids = [];
    const add = (r) => { const x = refs[r]; if (x && !x.tok && x.id && !ids.includes(Number(x.id))) ids.push(Number(x.id)); };
    if (st.t === 'act') { arr(st.links).forEach((l) => add(l.r)); arr(st.res).forEach((m) => add(m.r)); }
    else if (st.t === 'summon') { add(st.r); arr(st.mats).forEach((m) => add(m.r)); }
    else arr(st.moves).forEach((m) => add(m.r));
    return ids.slice(0, 6);
  }

  /* ---------- Dibujo ---------- */
  const tiles = (ids, cls) => ids.map((id) => { const c = db.get(id); return c ? '<button type="button" class="cl-tile' + (cls ? ' ' + cls : '') + '" data-cl-card="' + c.id + '" aria-label="Ver ' + esc(c.name) + '">' + view.tile(c) + '</button>' : ''; }).join('');
  const dateEs = (t) => { const n = Number(t); return n ? new Date(n).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' }) : ''; };

  function renderDeckSelect() {
    const el = $('#cl-deck');
    if (!el) return;
    el.innerHTML = decks().map((x) => {
      const n = listOf(x).length;
      return '<option value="' + esc(x.id) + '"' + (x === d ? ' selected' : '') + '>' + esc(x.name) + (n ? ' (' + n + ')' : '') + '</option>';
    }).join('');
  }
  function render() {
    if (!d) return;
    renderDeckSelect();
    const list = listOf(d);
    if (!list.some((c) => c.id === sel)) sel = list.length ? list[0].id : null;
    const on = list.filter((c) => c.enabled !== false);
    const sum = $('#cl-sum');
    if (sum) {
      sum.textContent = !list.length ? 'Sin combos grabados'
        : plural(list.length, 'combo', 'combos') + ' · el CPU usa ' + on.length
          + (on.length ? ' · su mano de 5 empieza alguno en el ' + pct(pAny(d.main, on, 5)) + ' de los duelos' : '');
    }
    const ul = $('#cl-list');
    ul.innerHTML = list.length ? list.map((c) => {
      const p = pHand(d.main, arr(c.hand), 5);
      return '<li><button type="button" class="cl-item' + (c.id === sel ? ' on' : '') + (c.enabled === false ? ' off' : '') + '" data-cl-pick="' + esc(c.id) + '" aria-current="' + (c.id === sel ? 'true' : 'false') + '">'
        + '<span class="cl-item-name">' + esc(c.name) + '</span>'
        + '<span class="cl-item-meta">' + plural(arr(c.steps).length, 'paso', 'pasos') + ' · abre con su mano: ' + pct(p) + (c.enabled === false ? ' · el CPU no lo usa' : '') + '</span>'
        + '<span class="cl-item-hand" aria-hidden="true">' + arr(c.hand).map((id) => { const k = db.get(id); return k ? view.tile(k) : ''; }).join('') + '</span>'
        + '</button></li>';
    }).join('') : '';
    ul.hidden = !list.length;
    const c = list.find((x) => x.id === sel) || null;
    $('#cl-view').innerHTML = c ? detailHtml(c) : emptyHtml();
  }
  function emptyHtml() {
    return '<div class="cl-empty"><h2>Sin combos grabados</h2><p>' + esc(q(d.name)) + ' todavía no tiene combos. Se graban en <b>Campo → Prueba</b> con <b>Grabar combo</b>:'
      + ' juegas tu turno una vez y el CPU lo repite con este mazo en VS.</p><button type="button" class="primary" data-cl-rec>Grabar un combo en el campo</button></div>';
  }
  function detailHtml(c) {
    const steps = arr(c.steps);
    const miss = missing(d, c);
    const p5 = pHand(d.main, arr(c.hand), 5), p6 = pHand(d.main, arr(c.hand), 6);
    const handNames = arr(c.hand).map((id) => q(nameById(id)));
    const checks = [];
    if (miss.length) miss.forEach((t) => checks.push('<li class="bad">' + esc(t) + ' El CPU no puede hacerlo entero.</li>'));
    else checks.push('<li class="ok">El mazo tiene todas las cartas que usa.</li>');
    if (!declared(c)) checks.push('<li class="warn">No tiene activaciones declaradas: en VS el CPU mueve las cartas sin activar nada y no puedes responderle.</li>');
    if (c.cut) checks.push('<li class="warn">Era muy largo: se guardaron sus primeros ' + steps.length + ' pasos.</li>');
    const items = steps.map((st, i) => {
      const t = call('describe', [c, st], { title: '', detail: [] });
      return '<li class="cl-step"><span class="cl-n">' + (i + 1) + '</span><div class="cl-step-cards">' + tiles(stepCards(c, st), 'sm') + '</div>'
        + '<div class="cl-step-text"><b>' + esc(t.title) + '</b>' + arr(t.detail).map((x) => '<span class="cb-det">' + esc(x) + '</span>').join('') + '</div></li>';
    }).join('');
    const nm = esc(q(c.name));
    return '<header class="cl-head"><div><h2>' + esc(c.name) + '</h2><p class="hint">' + plural(steps.length, 'paso', 'pasos')
      + (c.second ? ' · grabado yendo segundo' : ' · grabado yendo primero') + (c.created ? ' · ' + esc(dateEs(c.created)) : '') + '</p></div>'
      + '<div class="cl-actions"><button type="button" class="primary" data-cl-play>▶ Reproducir en el campo</button>'
      + '<button type="button" class="go" data-cl-practice>Practicar con su mano →</button>'
      + '<button type="button" data-cl-ren aria-label="Renombrar ' + nm + '">Renombrar</button>'
      + '<button type="button" class="ghost-danger" data-cl-del aria-label="Borrar ' + nm + '">Borrar</button></div></header>'
      + '<label class="switch cl-use"><input type="checkbox" data-cl-on' + (c.enabled !== false ? ' checked' : '') + '><span>El CPU usa este combo en VS (con ' + esc(q(d.name)) + ' como mazo rival)</span></label>'
      + '<div class="cl-facts">'
      + '<section class="cl-box"><h3>Empieza con</h3><div class="cl-row">' + (arr(c.hand).length ? tiles(arr(c.hand)) : '<p class="hint">Nada de la mano.</p>') + '</div>'
      + '<p class="cl-odds"><b>' + pct(p5) + '</b> de las manos de 5 · <b>' + pct(p6) + '</b> de las de 6</p>'
      + '<p class="hint">Probabilidad de abrir con ' + esc(handNames.join(' + ') || 'eso') + ' en el mazo de ahora. Si su mano trae una carta que el combo busca, la usa igual.</p></section>'
      + '<section class="cl-box"><h3>Comprobación</h3><ul class="cl-checks">' + checks.join('') + '</ul></section>'
      + '</div>'
      + '<section class="cl-box"><h3>Pasos</h3><ol class="cl-steps">' + items + '</ol></section>'
      + '<section class="cl-box"><h3>Campo final</h3><div class="cl-row">' + (arr(c.final).length ? tiles(arr(c.final)) : '<p class="hint">Sin cartas en el campo.</p>') + '</div></section>';
  }

  /* ---------- Ventanas ---------- */
  function dialog(title, bodyHtml, buttons) {
    $('#modal-title').textContent = title;
    $('#modal-body').innerHTML = bodyHtml;
    const foot = $('#modal-foot');
    foot.innerHTML = '';
    buttons.forEach((b) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.textContent = b.label;
      el.className = b.kind || '';
      el.addEventListener('click', () => { $('#modal').hidden = true; if (b.action) b.action(); });
      foot.appendChild(el);
    });
    $('#modal').hidden = false;
    const first = $('.primary', foot) || foot.lastChild;
    if (first) setTimeout(() => first.focus(), 30);
  }
  function showCard(id) {
    const c = db.get(id);
    if (c) dialog(c.name, '<div class="modal-detail">' + view.detail(c) + '</div>', [{ label: 'Cerrar', kind: 'primary' }]);
  }
  const current = () => listOf(d).find((x) => x.id === sel) || null;
  function rename() {
    const c = current();
    if (!c) return;
    dialog('Renombrar combo', '<label class="field"><span>Nombre</span><input id="cl-rename" type="text" maxlength="80" value="' + esc(c.name) + '"></label>', [
      { label: 'Cancelar' },
      { label: 'Guardar', kind: 'primary', action: () => { const v = ($('#cl-rename') || {}).value || ''; if (v.trim()) call('update', [c.id, { name: v }]); render(); } },
    ]);
    const inp = $('#cl-rename');
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); $('#modal-foot .primary').click(); } });
    setTimeout(() => { inp.focus(); inp.select(); }, 40);
  }
  function remove() {
    const c = current();
    if (!c) return;
    dialog('¿Borrar el combo?', '<p>' + esc(q(c.name)) + ' se borra y el CPU ya no lo usa.</p>', [
      { label: 'Cancelar', kind: 'primary' },
      { label: 'Borrar', kind: 'danger', action: () => { call('remove', [c.id]); sel = null; render(); } },
    ]);
  }
  /** Al campo (Prueba) con la mano del combo; lo que falta para 5 (6 si se grabó yendo segundo) sale al azar del mazo. */
  function practice() {
    const c = current();
    if (!c || !YGO.field) return;
    const rest = d.main.slice();
    const hand = [];
    for (const id of arr(c.hand)) { const i = rest.indexOf(Number(id)); if (i >= 0) hand.push(rest.splice(i, 1)[0]); }
    const n = c.second ? 6 : 5;
    while (hand.length < n && rest.length) hand.push(rest.splice(Math.floor(Math.random() * rest.length), 1)[0]);
    if (YGO.field.load(d, hand, rest, { second: !!c.second }) === false) return;
    YGO.go('campo');
  }
  /** Al campo (Prueba) a ver el combo jugarse solo, paso a paso (YGO.field.replay). */
  function replay() {
    const c = current();
    if (!c || !YGO.field || typeof YGO.field.replay !== 'function') return;
    if (YGO.field.replay(d, c) === false) return;
    YGO.go('campo');
  }
  function record() {
    if (!YGO.field) return;
    if (YGO.field.load(d, null, null, {}) === false) return;
    YGO.go('campo');
    if (typeof YGO.field.openCombos === 'function') YGO.field.openCombos();
  }

  function bind() {
    $('#cl-deck').addEventListener('change', (e) => {
      d = decks().find((x) => String(x.id) === e.target.value) || d;
      sel = null;
      store.savePrefs(Object.assign(store.prefs(), { combosDeckId: d ? d.id : null }));
      render();
    });
    $('#cl-rec').addEventListener('click', record);
    $('#cl-list').addEventListener('click', (e) => {
      const b = e.target.closest('[data-cl-pick]');
      if (!b) return;
      sel = b.dataset.clPick;
      render();
      const v = $('#cl-view');
      if (v && window.matchMedia && window.matchMedia('(max-width: 899px)').matches) v.scrollIntoView({ block: 'start' });
      const again = $('[data-cl-pick="' + CSS.escape(sel) + '"]');
      if (again && !(window.matchMedia && window.matchMedia('(max-width: 899px)').matches)) again.focus();
    });
    $('#cl-view').addEventListener('click', (e) => {
      const t = e.target.closest('[data-cl-card],[data-cl-ren],[data-cl-del],[data-cl-practice],[data-cl-play],[data-cl-rec]');
      if (!t) return;
      if (t.dataset.clCard) showCard(Number(t.dataset.clCard));
      else if (t.hasAttribute('data-cl-ren')) rename();
      else if (t.hasAttribute('data-cl-del')) remove();
      else if (t.hasAttribute('data-cl-practice')) practice();
      else if (t.hasAttribute('data-cl-play')) replay();
      else if (t.hasAttribute('data-cl-rec')) record();
    });
    $('#cl-view').addEventListener('change', (e) => {
      if (!e.target.matches('[data-cl-on]')) return;
      const c = current();
      if (c) call('update', [c.id, { enabled: e.target.checked }]);
      render();
    });
    if (view.images && view.images.onChange) view.images.onChange(() => { if (document.body.dataset.mode === 'combos') render(); });
  }

  /** Al entrar: el mazo elegido antes, o el del constructor, o el primero que tenga combos. */
  function enter() {
    const list = decks();
    if (!d || !list.includes(d)) {
      const want = store.prefs().combosDeckId;
      d = list.find((x) => x.id === want) || null;
      const cur = YGO.builder && YGO.builder.current();
      if (!d && cur && listOf(cur).length) d = cur;
      if (!d) d = list.find((x) => listOf(x).length) || cur || list[0] || null;
    }
    if (d) render();
  }

  if ($('#cl-deck')) bind();
  YGO.combolab = { enter, render, pHand, pAny, missing };
})();
