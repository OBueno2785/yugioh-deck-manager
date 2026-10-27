/* Tableros: revisar los tableros guardados de cada mazo (js/boards.js; se guardan en Campo → Prueba con «Guardar tablero»).
 * Para cada uno: la foto de tu lado (campo, mano, Cementerio, desterradas), tus notas, lo que cada carta puede hacer en el
 * turno del rival (interrupciones, lo que se activa si pasa algo, lo que está siempre activo, a cuántos apunta cada Link) y
 * cómo llegaste (el registro). «Cargar en el campo» lo vuelve a poner para probar desde ahí. Expone window.YGO.boardlab. */
(function () {
  const YGO = (window.YGO = window.YGO || {});
  const { db, view, store } = YGO;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const esc = view.esc;
  const arr = (x) => (Array.isArray(x) ? x : []);
  const q = (n) => '«' + n + '»';
  const B = () => YGO.boards || null;
  const decks = () => (YGO.builder ? YGO.builder.decks() : []);
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
  const PHASE_ES = { draw: 'Fase de Robo', standby: 'Fase de Espera', main1: 'Fase Principal 1', battle: 'Fase de Batalla', main2: 'Fase Principal 2', end: 'Fase Final' };

  let d = null;        // mazo elegido
  let sel = null;      // id del tablero que se ve
  let noteTimer = null;

  function call(name, args, fallback) {
    const b = B();
    if (b && typeof b[name] === 'function') {
      try { const v = b[name].apply(b, args); if (v !== undefined) return v; } catch (err) { console.warn('YGO.boards.' + name + ' falló', err); }
    }
    return fallback;
  }
  const listOf = (deck) => (deck ? arr(call('list', [deck.id], [])) : []);
  const dateEs = (t) => {
    const n = Number(t);
    if (!n) return '';
    try { return new Date(n).toLocaleString('es', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return new Date(n).toISOString().slice(0, 16).replace('T', ' '); }
  };

  /* ---------- Dibujo ---------- */
  function cardTile(x, cls) {
    if (x && x.token) {
      const t = x.token;
      return '<span class="cl-tile' + (cls ? ' ' + cls : '') + '"><div class="card f-token" title="' + esc(t.name || 'Ficha') + '"><div class="face"><span class="nm">' + esc(t.name || 'Ficha')
        + '</span><span class="st">' + esc(String(t.atk)) + '/' + esc(String(t.def)) + '</span></div></div></span>';
    }
    const c = x && db.get(x.id);
    return c ? '<button type="button" class="cl-tile' + (cls ? ' ' + cls : '') + '" data-bl-card="' + c.id + '" aria-label="Ver ' + esc(c.name) + '">' + view.tile(c) + '</button>' : '';
  }
  const tiles = (list, cls) => arr(list).map((x) => cardTile(x, cls)).join('');
  /** Una zona del tablero chico: la carta (DEF de lado, boca abajo atenuada), sus materiales */
  function zoneCell(st, z, col, row) {
    const stack = arr(st.zones[z]);
    const top = stack[0];
    const pos = 'style="grid-column:' + col + ';grid-row:' + row + '"';
    const label = call('zoneEs', [z], z);
    if (!top) return '<div class="bl-z empty" ' + pos + ' aria-label="' + esc(label + ': vacía') + '"></div>';
    const c = db.get(top.id);
    const name = top.token ? (top.token.name || 'Ficha') : c ? c.name : '?';
    const what = (top.faceDown ? 'boca abajo' : top.def ? 'en Defensa' : db.isMonster(c || {}) ? 'en Ataque' : 'boca arriba') + (stack.length > 1 ? ', ' + plural(stack.length - 1, 'material', 'materiales') : '');
    return '<div class="bl-z' + (top.def ? ' def' : '') + (top.faceDown ? ' down' : '') + '" ' + pos + ' title="' + esc(label + ': ' + name + ' (' + what + ')') + '">'
      + cardTile(top) + (stack.length > 1 ? '<span class="bl-mats" title="Materiales">' + (stack.length - 1) + '</span>' : '')
      + (top.faceDown ? '<span class="bl-down">Boca abajo</span>' : '') + '</div>';
  }
  const pileCell = (label, n, col, row) => '<div class="bl-z pile" style="grid-column:' + col + ';grid-row:' + row + '"><span class="bl-pile-n">' + n + '</span><span class="bl-pile-l">' + esc(label) + '</span></div>';
  function boardHtml(st) {
    const cells = [zoneCell(st, 'emz0', 3, 1), zoneCell(st, 'emz1', 5, 1), zoneCell(st, 'fz', 1, 2)];
    ['mz0', 'mz1', 'mz2', 'mz3', 'mz4'].forEach((z, i) => cells.push(zoneCell(st, z, i + 2, 2)));
    cells.push(pileCell('Cementerio', arr(st.gy).length, 7, 2), pileCell('Extra', arr(st.extra).length, 1, 3));
    ['st0', 'st1', 'st2', 'st3', 'st4'].forEach((z, i) => cells.push(zoneCell(st, z, i + 2, 3)));
    cells.push(pileCell('Mazo', arr(st.deck).length, 7, 3));
    return '<div class="bl-board" role="img" aria-label="Tu lado del campo">' + cells.join('') + '</div>';
  }
  function pileRow(title, list) {
    return '<div class="bl-pile-row"><h4>' + esc(title) + ' <span>' + arr(list).length + '</span></h4><div class="cl-row">'
      + (arr(list).length ? tiles(list, 'sm') : '<p class="hint">Nada.</p>') + '</div></div>';
  }
  function optRow(o) {
    const c = db.get(o.id);
    return '<li class="bl-opt' + (o.off ? ' off' : '') + '">' + (c ? '<button type="button" class="cl-tile sm" data-bl-card="' + c.id + '" aria-label="Ver ' + esc(c.name) + '">' + view.tile(c) + '</button>' : '<span></span>')
      + '<div class="bl-opt-body"><b>' + esc(o.name) + '</b><span class="bl-opt-where">' + esc(o.place) + (o.down ? ' · boca abajo' : '') + '</span>'
      + '<span class="bl-tags">' + (o.off ? '<span class="bl-tag no">' + esc(o.why) + '</span>' : '') + o.tags.map((t) => '<span class="bl-tag' + (t === 'Niega' ? ' neg' : '') + '">' + esc(t) + '</span>').join('') + '</span>'
      + '<p class="bl-opt-text">' + (o.html || esc(o.text)) + '</p></div></li>';
  }
  function analysisHtml(a) {
    const on = a.interrupts.filter((o) => !o.off).length;
    const links = a.links.map((l) => { const c = db.get(l.id); return '<li>' + esc(q(c ? c.name : '?')) + ' apunta a ' + plural(l.points, 'monstruo', 'monstruos')
      + (l.zones.length ? ' (' + esc(l.zones.map((z) => call('zoneEs', [z], z)).join(', ')) + ')' : '') + '.</li>'; }).join('');
    const group = (title, hint, list) => '<div class="bl-group"><h4>' + esc(title) + ' <span>' + list.filter((o) => !o.off).length + '</span></h4>' + (hint ? '<p class="hint">' + esc(hint) + '</p>' : '')
      + (list.length ? '<ul class="bl-opts">' + list.map(optRow).join('') + '</ul>' : '<p class="hint">Ninguno.</p>') + '</div>';
    return '<p class="bl-score"><b>' + on + '</b> ' + (on === 1 ? 'interrupción' : 'interrupciones') + (a.negates ? ' · <b>' + a.negates + '</b> ' + (a.negates === 1 ? 'niega' : 'niegan') : '')
      + ' · ' + plural(a.reactive.length, 'se activa si pasa algo', 'se activan si pasa algo') + ' · ' + plural(a.always.length, 'siempre activo', 'siempre activos') + '</p>'
      + (links ? '<ul class="bl-links">' + links + '</ul>' : '')
      + group('Interrupciones', 'Efectos Rápidos y cartas colocadas que puedes usar en el turno del rival.', a.interrupts)
      + group('Se activan si pasa algo', 'Si el rival destruye, destierra o ataca, o en sus fases.', a.reactive)
      + group('Siempre activos', 'Efectos continuos de tus cartas boca arriba.', a.always)
      + '<p class="hint">Leído del texto de las cartas: revisa las condiciones de cada efecto. Lo tachado no se cumple ahora.</p>';
  }

  function renderDeckSelect() {
    const el = $('#bl-deck');
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
    if (!list.some((b) => b.id === sel)) sel = list.length ? list[0].id : null;
    const sum = $('#bl-sum');
    if (sum) sum.textContent = list.length ? plural(list.length, 'tablero guardado', 'tableros guardados') : 'Sin tableros guardados';
    const ul = $('#bl-list');
    ul.innerHTML = list.map((b) => {
      const mons = ['emz0', 'emz1', 'mz0', 'mz1', 'mz2', 'mz3', 'mz4'].map((z) => arr(b.state.zones[z])[0]).filter((x) => x && !x.faceDown && !x.token).slice(0, 4);
      return '<li><button type="button" class="cl-item' + (b.id === sel ? ' on' : '') + '" data-bl-pick="' + esc(b.id) + '" aria-current="' + (b.id === sel ? 'true' : 'false') + '">'
        + '<span class="cl-item-name">' + esc(b.name) + '</span>'
        + '<span class="cl-item-meta">' + esc(call('summary', [b], '')) + ' · ' + esc(dateEs(b.created)) + '</span>'
        + '<span class="cl-item-hand" aria-hidden="true">' + mons.map((x) => { const c = db.get(x.id); return c ? view.tile(c) : ''; }).join('') + '</span>'
        + '</button></li>';
    }).join('');
    ul.hidden = !list.length;
    const b = list.find((x) => x.id === sel) || null;
    $('#bl-view').innerHTML = b ? detailHtml(b) : emptyHtml();
  }
  function emptyHtml() {
    return '<div class="cl-empty"><h2>Sin tableros guardados</h2><p>' + esc(q(d.name)) + ' todavía no tiene tableros. Arma tu campo en <b>Campo → Prueba</b> y toca <b>Guardar tablero</b>:'
      + ' queda aquí para revisarlo, anotar ideas y volver a cargarlo cuando quieras.</p><button type="button" class="primary" data-bl-field>Ir al campo</button></div>';
  }
  function detailHtml(b) {
    const st = b.state;
    const ts = st.turnState || {};
    const a = call('analyze', [st], { counts: {}, links: [], interrupts: [], reactive: [], always: [], negates: 0 });
    const nm = esc(q(b.name));
    const log = arr(st.log);
    return '<header class="cl-head"><div><h2>' + esc(b.name) + '</h2><p class="hint">Guardado el ' + esc(dateEs(b.created)) + ' · turno ' + (Number(ts.turn) || 1)
      + ', ' + esc(PHASE_ES[ts.phase] || 'Fase Principal 1') + (b.second ? ' · yendo segundo' : ' · yendo primero') + ' · LP ' + esc(String(st.lp)) + '</p></div>'
      + '<div class="cl-actions"><button type="button" class="primary" data-bl-load>Cargar en el campo →</button>'
      + '<button type="button" data-bl-ren aria-label="Renombrar ' + nm + '">Renombrar</button>'
      + '<button type="button" class="ghost-danger" data-bl-del aria-label="Borrar ' + nm + '">Borrar</button></div></header>'
      + '<section class="cl-box bl-notes-box"><h3><label for="bl-notes">Notas</label></h3>'
      + '<textarea id="bl-notes" rows="3" maxlength="4000" placeholder="Qué querías probar, qué handtrap te preocupa, qué cambiarías...">' + esc(b.notes || '') + '</textarea>'
      + '<p id="bl-notes-st" class="hint" aria-live="polite">Se guardan solas.</p></section>'
      + '<div class="cl-facts bl-facts">'
      + '<section class="cl-box"><h3>Tablero</h3>' + boardHtml(st) + pileRow('Mano', st.hand) + pileRow('Cementerio', st.gy) + pileRow('Desterradas', st.ban) + '</section>'
      + '<section class="cl-box bl-analysis"><h3>En el turno del rival</h3>' + analysisHtml(a) + '</section>'
      + '</div>'
      + '<details class="cl-box bl-log"><summary><h3>Cómo llegaste <span>' + plural(log.length, 'jugada', 'jugadas') + '</span></h3></summary>'
      + (log.length ? '<ol>' + log.map((e) => '<li' + (e.illegal ? ' class="bad"' : '') + '>' + esc(e.text) + '</li>').join('') + '</ol>' : '<p class="hint">Sin jugadas anotadas.</p>') + '</details>'
      + '<p class="hint">«Cargar en el campo» lo pone en Prueba sin rival de handtraps. Pasa el turno para probar tus interrupciones en el turno del rival; Reiniciar lo vuelve a poner.</p>';
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
    const b = current();
    if (!b) return;
    dialog('Renombrar tablero', '<label class="field"><span>Nombre</span><input id="bl-rename" type="text" maxlength="80" value="' + esc(b.name) + '"></label>', [
      { label: 'Cancelar' },
      { label: 'Guardar', kind: 'primary', action: () => { const v = ($('#bl-rename') || {}).value || ''; if (v.trim()) call('update', [b.id, { name: v }]); render(); } },
    ]);
    const inp = $('#bl-rename');
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); $('#modal-foot .primary').click(); } });
    setTimeout(() => { inp.focus(); inp.select(); }, 40);
  }
  function remove() {
    const b = current();
    if (!b) return;
    dialog('¿Borrar el tablero?', '<p>' + esc(q(b.name)) + ' se borra con sus notas.</p>', [
      { label: 'Cancelar', kind: 'primary' },
      { label: 'Borrar', kind: 'danger', action: () => { call('remove', [b.id]); sel = null; render(); } },
    ]);
  }
  function load() {
    const b = current();
    if (!b || !YGO.field || typeof YGO.field.loadBoard !== 'function') return;
    flushNotes();
    if (YGO.field.loadBoard(d, b) === false) return;
    YGO.go('campo');
  }
  function toField() {
    if (!YGO.field) return;
    if (YGO.field.load(d, null, null, {}) === false) return;
    YGO.go('campo');
  }
  /** Las notas se guardan solas (un momento después de escribir, y al salir del cuadro) */
  function flushNotes() {
    clearTimeout(noteTimer);
    noteTimer = null;
    const t = $('#bl-notes');
    const b = current();
    if (!t || !b || (b.notes || '') === t.value) return;
    const r = call('update', [b.id, { notes: t.value }], null);
    const s = $('#bl-notes-st');
    if (s) s.textContent = !r ? 'No se pudieron guardar.' : r.unsaved ? 'El navegador no deja guardar: quedan hasta que cierres la página.' : 'Notas guardadas.';
  }

  function bind() {
    $('#bl-deck').addEventListener('change', (e) => {
      flushNotes();
      d = decks().find((x) => String(x.id) === e.target.value) || d;
      sel = null;
      store.savePrefs(Object.assign(store.prefs(), { boardsDeckId: d ? d.id : null }));
      render();
    });
    $('#bl-field').addEventListener('click', toField);
    $('#bl-list').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-bl-pick]');
      if (!btn) return;
      flushNotes();
      sel = btn.dataset.blPick;
      render();
      const phone = window.matchMedia && window.matchMedia('(max-width: 899px)').matches;
      const v = $('#bl-view');
      if (v && phone) v.scrollIntoView({ block: 'start' });
      const again = $('[data-bl-pick="' + CSS.escape(sel) + '"]');
      if (again && !phone) again.focus();
    });
    $('#bl-view').addEventListener('click', (e) => {
      const t = e.target.closest('[data-bl-card],[data-bl-ren],[data-bl-del],[data-bl-load],[data-bl-field]');
      if (!t) return;
      if (t.dataset.blCard) showCard(Number(t.dataset.blCard));
      else if (t.hasAttribute('data-bl-ren')) { flushNotes(); rename(); }
      else if (t.hasAttribute('data-bl-del')) remove();
      else if (t.hasAttribute('data-bl-load')) load();
      else if (t.hasAttribute('data-bl-field')) toField();
    });
    $('#bl-view').addEventListener('input', (e) => {
      if (e.target.id !== 'bl-notes') return;
      const s = $('#bl-notes-st');
      if (s) s.textContent = 'Guardando…';
      clearTimeout(noteTimer);
      noteTimer = setTimeout(flushNotes, 600);
    });
    $('#bl-view').addEventListener('focusout', (e) => { if (e.target.id === 'bl-notes') flushNotes(); });
    window.addEventListener('pagehide', flushNotes);
    if (view.images && view.images.onChange) view.images.onChange(() => { if (document.body.dataset.mode === 'tableros') render(); });
  }

  /** Al entrar: el mazo elegido antes, o el del campo/constructor, o el primero que tenga tableros. */
  function enter() {
    const list = decks();
    if (!d || !list.includes(d)) {
      const want = store.prefs().boardsDeckId;
      d = list.find((x) => x.id === want) || null;
      const cur = YGO.builder && YGO.builder.current();
      if (!d && cur && listOf(cur).length) d = cur;
      if (!d) d = list.find((x) => listOf(x).length) || cur || list[0] || null;
    }
    if (d) render();
  }
  /** Al salir de la pestaña: lo que escribiste en las notas no se pierde */
  function leave() { flushNotes(); }
  /** Mostrar ese tablero (después de guardarlo desde el campo) */
  function show(deckId, boardId) {
    d = decks().find((x) => x.id === deckId) || d;
    sel = boardId || null;
  }

  if ($('#bl-deck')) bind();
  YGO.boardlab = { enter, leave, render, show };
})();
