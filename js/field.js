/* Campo de juego para practicar combos: zonas de Master Rule, mano, mazo, Extra, cementerio y destierro.
 * Las cartas se mueven arrastrando o tocando la carta y luego la zona destino. */
(function () {
  const { db, game, view, store } = window.YGO;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = view.esc;
  const T = db.T;

  const MZ = ['mz0', 'mz1', 'mz2', 'mz3', 'mz4'];
  const EMZ = ['emz0', 'emz1'];
  const ST = ['st0', 'st1', 'st2', 'st3', 'st4'];
  const FIELD_ZONES = [...EMZ, ...MZ, ...ST, 'fz'];
  const PILES = ['deck', 'extra', 'gy', 'ban'];
  const PILE_NAMES = { deck: 'Mazo', extra: 'Extra Deck', gy: 'Cementerio', ban: 'Desterradas', hand: 'Mano' };
  const isMonsterZone = (z) => z.startsWith('mz') || z.startsWith('emz');

  const prefs = Object.assign({ handSize: 5 }, store.prefs());
  let d = null;
  let S = null;           // estado de la partida
  let history = [];
  let selected = null;    // uid de la carta elegida
  let pending = null;     // { kind: 'move' | 'overlay' | 'attach', uid }
  let pileOpen = null;    // pila que se está viendo en la ventana

  const decks = () => window.YGO.builder.decks();
  const blank = () => {
    const zones = {};
    FIELD_ZONES.forEach((z) => { zones[z] = []; });
    return { deck: [], hand: [], extra: [], gy: [], ban: [], zones, lp: 8000, turnDraws: 0 };
  };

  /* ---------- Estado ---------- */
  function snapshot() {
    history.push(JSON.stringify(S));
    if (history.length > 150) history.shift();
  }
  function undo() {
    if (!history.length) { toast('No hay nada que deshacer'); return; }
    S = JSON.parse(history.pop());
    selected = null;
    pending = null;
    render();
  }

  function newDuel(handIds, restIds) {
    S = blank();
    history = [];
    selected = null;
    pending = null;
    if (handIds) {
      S.hand = handIds.map(game.instance);
      S.deck = game.shuffle(restIds.map(game.instance));
    } else {
      S.deck = game.shuffle(d.main.map(game.instance));
      S.hand = S.deck.splice(0, prefs.handSize);
    }
    S.extra = d.extra.map(game.instance);
    render();
  }

  /** Busca una carta por uid. Devuelve { area, zone, index, list } */
  function locate(uid) {
    for (const a of ['hand', ...PILES]) {
      const i = S[a].findIndex((c) => c.uid === uid);
      if (i >= 0) return { area: a, index: i, list: S[a] };
    }
    for (const z of FIELD_ZONES) {
      const i = S.zones[z].findIndex((c) => c.uid === uid);
      if (i >= 0) return { area: 'field', zone: z, index: i, list: S.zones[z] };
    }
    return null;
  }

  /** Saca la carta de donde esté. Si era un monstruo con materiales, estos van al cementerio. */
  function detach(uid) {
    const loc = locate(uid);
    if (!loc) return null;
    const [card] = loc.list.splice(loc.index, 1);
    if (loc.area === 'field' && loc.index === 0 && loc.list.length) {
      S.gy.push(...loc.list.splice(0).map(resetCard));
    }
    if (loc.area === 'deck') game.shuffle(S.deck);
    return { card, from: loc };
  }
  const resetCard = (c) => { c.faceDown = false; c.def = false; return c; };

  /** Mueve una carta a un destino. dest: 'hand' | pila | zona; opts: { faceDown, def, bottom, overlay, attach } */
  function move(uid, dest, opts) {
    opts = opts || {};
    const loc = locate(uid);
    if (!loc) return false;
    const c = db.get(loc.list[loc.index].id);
    if (FIELD_ZONES.includes(dest)) {
      const target = S.zones[dest];
      if (target.length && !opts.overlay && !opts.attach) { toast('Esa zona ya está ocupada'); return false; }
      if ((opts.overlay || opts.attach) && (!target.length || !isMonsterZone(dest))) { toast('Elige un monstruo en el campo'); return false; }
      if (target.length && target.some((x) => x.uid === uid)) return false;
      if (dest === 'fz' && !(c.type & T.FIELD)) { toast('La Zona de Campo es solo para Mágicas de Campo'); return false; }
      if (isMonsterZone(dest) && !db.isMonster(c) && !opts.attach) { toast('Solo monstruos en esa zona'); return false; }
    }
    snapshot();
    const { card } = detach(uid);
    if (dest === 'hand') { S.hand.push(resetCard(card)); }
    else if (dest === 'deck') { resetCard(card); if (opts.bottom) S.deck.push(card); else S.deck.unshift(card); if (opts.shuffle) game.shuffle(S.deck); }
    else if (dest === 'extra') {
      resetCard(card);
      if (!db.isExtra(c) && !(c.type & T.PENDULUM)) { S.hand.push(card); toast('Esa carta no va en el Extra Deck: volvió a la mano'); }
      else S.extra.push(card);
    }
    else if (dest === 'gy' || dest === 'ban') {
      resetCard(card);
      // Las cartas del Extra Deck vuelven al Extra si se mandan a la mano o al mazo; al cementerio van normal
      S[dest].push(card);
    } else {
      card.faceDown = !!opts.faceDown;
      card.def = !!opts.def;
      if (opts.attach) { resetCard(card); S.zones[dest].push(card); }
      else if (opts.overlay) S.zones[dest].unshift(card);
      else S.zones[dest].push(card);
    }
    // Una carta del Extra Deck que vuelve a la mano o al mazo regresa al Extra
    if ((dest === 'hand' || dest === 'deck') && db.isExtra(c)) {
      const arr = dest === 'hand' ? S.hand : S.deck;
      const i = arr.indexOf(card);
      arr.splice(i, 1);
      S.extra.push(card);
      toast('Los monstruos del Extra Deck regresan al Extra Deck');
    }
    if (pileOpen && !S[pileOpen].length) closePile();
    selected = null;
    render();
    return true;
  }

  function firstEmpty(list) { return list.find((z) => !S.zones[z].length); }

  function draw(n) {
    n = n || 1;
    if (!S.deck.length) { toast('El mazo está vacío'); return; }
    snapshot();
    S.hand.push(...S.deck.splice(0, n));
    render();
  }

  /* ---------- Acciones de la carta elegida ---------- */
  function actionsFor(uid) {
    const loc = locate(uid);
    if (!loc) return [];
    const inst = loc.list[loc.index];
    const c = db.get(inst.id);
    const acts = [];
    const onField = loc.area === 'field';
    const isTop = onField && loc.index === 0;
    const extraMon = db.isExtra(c);
    const add = (label, fn, kind) => acts.push({ label, fn, kind });
    const placeMon = (opts) => {
      const z = extraMon ? firstEmpty([...EMZ, ...MZ]) : firstEmpty(MZ);
      if (!z) { toast('No quedan zonas de monstruo libres'); return; }
      move(uid, z, opts);
    };
    const placeST = (opts) => {
      const z = firstEmpty(ST);
      if (!z) { toast('No quedan zonas de Mágicas y Trampas libres'); return; }
      move(uid, z, opts);
    };

    if (!onField) {
      if (db.isMonster(c)) {
        add(extraMon ? 'Invocar' : 'Invocar en ATK', () => placeMon({}), 'primary');
        if (!extraMon) {
          add('Colocar boca abajo', () => placeMon({ faceDown: true, def: true }));
          add('Invocar en DEF', () => placeMon({ def: true }));
        } else {
          add('Invocar en DEF', () => placeMon({ def: true }));
        }
        if (c.type & T.XYZ) add('Invocar Xyz encima de…', () => startPending('overlay', uid));
        if (c.type & T.PENDULUM) add('Activar como escala', () => {
          const z = firstEmpty(['st0', 'st4']);
          if (!z) { toast('Las Zonas de Péndulo (extremos) están ocupadas'); return; }
          move(uid, z, {});
        });
      } else if (c.type & T.FIELD) {
        add('Activar', () => (S.zones.fz.length ? toast('La Zona de Campo está ocupada') : move(uid, 'fz', {})), 'primary');
        add('Colocar boca abajo', () => (S.zones.fz.length ? toast('La Zona de Campo está ocupada') : move(uid, 'fz', { faceDown: true })));
      } else {
        add(db.isSpell(c) ? 'Activar' : 'Activar', () => placeST({}), db.isSpell(c) ? 'primary' : '');
        add('Colocar boca abajo', () => placeST({ faceDown: true }), db.isTrap(c) ? 'primary' : '');
      }
    } else if (isTop) {
      if (isMonsterZone(loc.zone)) {
        if (inst.faceDown) add('Voltear boca arriba', () => mutate(inst, { faceDown: false, def: inst.def }), 'primary');
        else add(inst.def ? 'Cambiar a ATK' : 'Cambiar a DEF', () => mutate(inst, { def: !inst.def }), 'primary');
        if (!inst.faceDown) add('Colocar boca abajo', () => mutate(inst, { faceDown: true, def: true }));
        if (loc.list.length > 1) add('Desacoplar material (' + (loc.list.length - 1) + ')', () => {
          snapshot();
          const m = loc.list.pop();
          S.gy.push(resetCard(m));
          render();
        });
      } else if (inst.faceDown) add('Activar (voltear)', () => mutate(inst, { faceDown: false }), 'primary');
      else add('Colocar boca abajo', () => mutate(inst, { faceDown: true }));
    }
    add('Mover a una zona…', () => startPending('move', uid));
    if (db.isMonster(c) && !(onField && isTop && isMonsterZone(loc.zone))) add('Acoplar como material…', () => startPending('attach', uid));
    if (loc.area !== 'gy') add('Al cementerio', () => move(uid, 'gy'));
    if (loc.area !== 'ban') add('Desterrar', () => move(uid, 'ban'));
    if (extraMon || (c.type & T.PENDULUM && onField)) { if (loc.area !== 'extra') add('Al Extra Deck', () => move(uid, 'extra')); }
    if (loc.area !== 'hand' && !extraMon) add('A la mano', () => move(uid, 'hand'));
    if (!extraMon) {
      add('Al mazo (arriba)', () => move(uid, 'deck'));
      add('Al mazo (abajo)', () => move(uid, 'deck', { bottom: true }));
      add('Barajar en el mazo', () => move(uid, 'deck', { shuffle: true }));
    }
    return acts;
  }

  function mutate(inst, patch) {
    snapshot();
    Object.assign(inst, patch);
    render();
  }

  function startPending(kind, uid) {
    pending = { kind, uid };
    closePile();
    render();
  }

  /** Toque/clic sobre una zona o pila del tablero. */
  function onZone(zone) {
    if (pending) {
      const { kind, uid } = pending;
      pending = null;
      if (kind === 'move') move(uid, zone, defaultOpts(uid, zone));
      else if (kind === 'overlay') move(uid, zone, { overlay: true });
      else move(uid, zone, { attach: true });
      render();
      return;
    }
    if (PILES.includes(zone)) {
      if (zone === 'deck') { draw(1); return; }
      openPile(zone);
      return;
    }
    const stack = S.zones[zone];
    if (stack.length) { select(stack[0].uid); return; }
    if (selected) move(selected, zone, defaultOpts(selected, zone));
  }

  function defaultOpts(uid, zone) {
    const loc = locate(uid);
    if (!loc || !FIELD_ZONES.includes(zone)) return {};
    const inst = loc.list[loc.index];
    // Mover dentro del campo conserva la posición; desde fuera entra boca arriba en ATK
    return loc.area === 'field' ? { faceDown: inst.faceDown, def: inst.def } : {};
  }

  function select(uid) {
    selected = selected === uid ? null : uid;
    render();
  }

  /* ---------- Avisos y ventanas ---------- */
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.className = 'toast toast-warn';
    el.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { el.hidden = true; }, 2400);
  }

  function openPile(pile) {
    pileOpen = pile;
    renderPile();
    $('#modal').hidden = false;
  }
  function closePile() {
    if (!pileOpen) return;
    pileOpen = null;
    $('#modal').hidden = true;
  }
  function renderPile() {
    if (!pileOpen) return;
    let list = S[pileOpen].slice();
    if (pileOpen === 'deck') list.sort((a, b) => db.get(a.id).name.localeCompare(db.get(b.id).name));
    if (pileOpen === 'gy' || pileOpen === 'ban') list.reverse();
    $('#modal-title').textContent = PILE_NAMES[pileOpen] + ' (' + list.length + ')';
    $('#modal-body').innerHTML = (pileOpen === 'deck' ? '<p class="hint">Ordenado por nombre. Al sacar una carta, el mazo se baraja.</p>' : '')
      + (list.length ? '<div class="pile-grid">' + list.map((x) => tileFor(x, true)).join('') + '</div>'
        : '<p class="hint">No hay cartas aquí.</p>');
    const foot = $('#modal-foot');
    foot.innerHTML = '';
    if (pileOpen === 'deck') {
      const sh = document.createElement('button');
      sh.type = 'button';
      sh.textContent = 'Barajar';
      sh.addEventListener('click', () => { snapshot(); game.shuffle(S.deck); toast('Mazo barajado'); });
      foot.appendChild(sh);
    }
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Cerrar';
    close.addEventListener('click', closePile);
    foot.appendChild(close);
  }

  /* ---------- Dibujo ---------- */
  function tileFor(inst, reveal) {
    const c = db.get(inst.id);
    const cls = [inst.uid === selected ? 'sel' : '', inst.def ? 'is-def' : '', inst.faceDown && !reveal ? 'is-down' : ''].join(' ');
    const html = view.tile(c, { attrs: 'data-uid="' + inst.uid + '" draggable="true" tabindex="0"' });
    return '<div class="slot-card ' + cls + '">' + html + (inst.faceDown && !reveal ? '<span class="down-label">' + esc(c.name) + '</span>' : '') + '</div>';
  }

  function zoneHtml(z, label) {
    const stack = S.zones[z];
    const mats = stack.length > 1 ? '<span class="mats" title="Materiales">' + (stack.length - 1) + '</span>' : '';
    const target = pending && (pending.kind === 'move' ? !stack.length : stack.length && isMonsterZone(z));
    return '<div class="zone-slot z-' + z.replace(/\d/, '') + (target ? ' target' : '') + '" data-zone="' + z + '" tabindex="0" aria-label="' + label + '">'
      + (stack.length ? tileFor(stack[0]) + mats : '<span class="zl">' + label + '</span>') + '</div>';
  }

  function pileHtml(p) {
    const list = S[p];
    const top = list.length ? (p === 'deck' || p === 'extra' ? '<div class="card back"></div>' : tileFor(list[list.length - 1], true)) : '';
    const target = pending && pending.kind === 'move';
    return '<div class="zone-slot pile z-' + p + (target ? ' target' : '') + '" data-zone="' + p + '" tabindex="0" aria-label="' + PILE_NAMES[p] + '">'
      + top
      + '<span class="pile-count">' + PILE_NAMES[p] + ' · ' + list.length + '</span></div>';
  }

  function render() {
    if (!S) return;
    $$('#fd-size button').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.n) === prefs.handSize)));
    const st = ['Zona de Péndulo / M-T', 'M/T', 'M/T', 'M/T', 'Zona de Péndulo / M-T'];
    $('#board').innerHTML =
      '<div class="cell spacer"></div><div class="cell spacer"></div>' + zoneHtml('emz0', 'Zona de Monstruo Extra')
      + '<div class="cell spacer"></div>' + zoneHtml('emz1', 'Zona de Monstruo Extra') + '<div class="cell spacer"></div>' + pileHtml('ban')
      + zoneHtml('fz', 'Zona de Campo') + MZ.map((z) => zoneHtml(z, 'Monstruo')).join('') + pileHtml('gy')
      + pileHtml('extra') + ST.map((z, i) => zoneHtml(z, st[i])).join('') + pileHtml('deck');
    $('#fd-hand').innerHTML = S.hand.length ? S.hand.map((x) => tileFor(x, true)).join('') : '<p class="ht-empty">Tu mano está vacía.</p>';
    $('#fd-hand-count').textContent = S.hand.length;
    $('#fd-undo').disabled = !history.length;
    $('#fd-lp').value = S.lp;
    $('#board').classList.toggle('picking', !!pending);
    $('#fd-pending').hidden = !pending;
    if (pending) {
      const name = db.get(locate(pending.uid).list[locate(pending.uid).index].id).name;
      $('#fd-pending-text').textContent = {
        move: 'Toca la zona a la que quieres mover ' + name,
        overlay: 'Toca el monstruo que será material de ' + name,
        attach: 'Toca el monstruo al que se acopla ' + name,
      }[pending.kind];
    }
    renderSide();
    renderPile();
  }

  function renderSide() {
    const side = $('#fd-side');
    const loc = selected && locate(selected);
    if (!loc) {
      selected = null;
      document.body.classList.remove('fd-selected');
      $('#fd-detail').innerHTML = '<div class="detail-empty"><div class="card-back" aria-hidden="true"></div>'
        + '<p>Toca una carta para ver qué puedes hacer con ella. Toca una zona libre para colocarla, o arrástrala.</p></div>';
      $('#fd-actions').innerHTML = '';
      return;
    }
    document.body.classList.add('fd-selected');
    const inst = loc.list[loc.index];
    const c = db.get(inst.id);
    const where = loc.area === 'field' ? (loc.index ? 'Material de un monstruo' : 'En el campo' + (inst.faceDown ? ', boca abajo' : '') + (inst.def ? ', en DEF' : ''))
      : 'En ' + PILE_NAMES[loc.area].toLowerCase();
    $('#fd-detail').innerHTML = '<p class="fd-where">' + where + '</p>' + view.detail(c);
    const acts = actionsFor(selected);
    $('#fd-actions').innerHTML = '<p class="fd-act-name">' + esc(c.name) + '</p><div class="fd-act-grid">'
      + acts.map((a, i) => '<button type="button" data-act="' + i + '" class="' + (a.kind || '') + '">' + esc(a.label) + '</button>').join('')
      + '</div>';
    side._acts = acts;
  }

  function renderDeckSelect() {
    $('#fd-deck').innerHTML = decks().map((x) => '<option value="' + x.id + '"' + (x === d ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('');
  }

  /* ---------- Arrastrar ---------- */
  let dragUid = null;
  function bindDrag() {
    const root = $('.fieldmode');
    root.addEventListener('dragstart', (e) => {
      const el = e.target.closest('[data-uid]');
      if (!el) return;
      dragUid = el.dataset.uid;
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', dragUid); } catch (err) { /* nada */ }
    });
    $('#modal').addEventListener('dragstart', (e) => {
      const el = e.target.closest('[data-uid]');
      if (!el || !pileOpen) return;
      dragUid = el.dataset.uid;
      setTimeout(() => { $('#modal').hidden = true; }, 0);
    });
    document.addEventListener('dragend', () => {
      dragUid = null;
      $$('.drop-hover').forEach((x) => x.classList.remove('drop-hover'));
      if (pileOpen) { pileOpen = null; }
    });
    root.addEventListener('dragover', (e) => {
      if (!dragUid) return;
      const z = e.target.closest('[data-zone], #fd-hand-wrap');
      if (!z) return;
      e.preventDefault();
      $$('.drop-hover').forEach((x) => x !== z && x.classList.remove('drop-hover'));
      z.classList.add('drop-hover');
    });
    root.addEventListener('drop', (e) => {
      if (!dragUid) return;
      const z = e.target.closest('[data-zone], #fd-hand-wrap');
      if (!z) return;
      e.preventDefault();
      const uid = dragUid;
      dragUid = null;
      if (z.id === 'fd-hand-wrap') { move(uid, 'hand'); return; }
      const zone = z.dataset.zone;
      if (FIELD_ZONES.includes(zone) && S.zones[zone].length) {
        if (S.zones[zone][0].uid === uid) return;
        if (isMonsterZone(zone)) move(uid, zone, { overlay: true });
        else toast('Esa zona ya está ocupada');
      } else move(uid, zone, defaultOpts(uid, zone));
    });
  }

  /* ---------- Eventos ---------- */
  function bind() {
    $('#fd-deck').addEventListener('change', (e) => {
      d = decks().find((x) => x.id === e.target.value);
      newDuel();
    });
    $$('#fd-size button').forEach((b) => b.addEventListener('click', () => {
      prefs.handSize = Number(b.dataset.n);
      store.savePrefs(Object.assign(store.prefs(), { handSize: prefs.handSize }));
      render();
    }));
    $('#fd-new').addEventListener('click', () => newDuel());
    $('#fd-draw').addEventListener('click', () => draw(1));
    $('#fd-shuffle').addEventListener('click', () => { snapshot(); game.shuffle(S.deck); toast('Mazo barajado'); render(); });
    $('#fd-search').addEventListener('click', () => openPile('deck'));
    $('#fd-undo').addEventListener('click', undo);
    $('#fd-cancel').addEventListener('click', () => { pending = null; render(); });
    $('#fd-lp').addEventListener('change', (e) => { snapshot(); S.lp = Number(e.target.value) || 0; render(); });

    $('#board').addEventListener('click', (e) => {
      const zone = e.target.closest('[data-zone]');
      if (!zone) return;
      const z = zone.dataset.zone;
      // En pilas, un clic sobre la carta superior abre la pila (o roba, en el mazo)
      onZone(z);
    });
    $('#board').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const zone = e.target.closest('[data-zone]');
      if (zone) { e.preventDefault(); onZone(zone.dataset.zone); }
    });
    $('#fd-hand').addEventListener('click', (e) => {
      const el = e.target.closest('[data-uid]');
      if (!el) return;
      if (pending) { toast('Toca una zona del tablero'); return; }
      select(el.dataset.uid);
    });
    $('#fd-hand-wrap').addEventListener('click', (e) => {
      if (pending && pending.kind === 'move' && !e.target.closest('[data-uid]')) {
        const uid = pending.uid;
        pending = null;
        move(uid, 'hand');
      }
    });
    $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') pileOpen = null; });
    $('#modal-body').addEventListener('click', (e) => {
      const el = e.target.closest('[data-uid]');
      if (!el || !pileOpen) return;
      selected = el.dataset.uid;
      closePile();
      render();
    });
    $('#fd-actions').addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const a = $('#fd-side')._acts[Number(b.dataset.act)];
      if (a) a.fn();
    });
    $('#fd-deselect').addEventListener('click', () => { selected = null; render(); });
    document.addEventListener('keydown', (e) => {
      if (document.body.dataset.mode !== 'campo' || e.target.matches('input, select, textarea')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
      else if (e.key === 'd' || e.key === 'D') draw(1);
      else if (e.key === 'Escape') { pending = null; selected = null; pileOpen = null; render(); }
    });
    bindDrag();
  }

  /* ---------- API ---------- */
  function enter() {
    if (!d || !decks().includes(d)) {
      d = window.YGO.builder.current();
      newDuel();
    } else render();
    renderDeckSelect();
  }

  /** Empieza un duelo con una mano concreta (desde la prueba de mano). */
  function load(deckObj, handIds, restIds) {
    d = deckObj;
    newDuel(handIds, restIds);
    renderDeckSelect();
  }

  bind();
  window.YGO.field = { enter, load };
})();
