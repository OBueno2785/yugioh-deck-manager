/* Tableros guardados. Pedido de Oscar (2026-10-27): "quiero la opción de poder grabar tableros para revisarlos luego y
 * analizar las opciones". En Campo → Prueba, «Guardar tablero» guarda una foto de tu lado tal como está:
 *  - el campo, con materiales y posiciones;
 *  - la mano, el Cementerio, las desterradas, el Extra Deck y el Mazo;
 *  - los LP, el turno y la fase, y las jugadas del registro.
 * La pestaña Tableros (js/boardlab.js) los muestra con tus notas y lo que cada carta puede hacer en el turno del rival.
 * «Cargar en el campo» lo vuelve a poner para probar.
 * Se guardan por mazo en localStorage ('simulador-yugioh:tableros', hasta 30 por mazo) y entran en la copia de seguridad.
 * Aquí no hay DOM: guardar, foto, volver a ponerla y el análisis (tools/test_boards.js). Expone window.YGO.boards. */
(function () {
  const YGO = (window.YGO = window.YGO || {});
  const { db } = YGO;
  const KEY = 'simulador-yugioh:tableros';
  const CAP = 30;
  const LOG_CAP = 200;
  const EMZ = ['emz0', 'emz1'];
  const MON = ['mz0', 'mz1', 'mz2', 'mz3', 'mz4'];
  const ST = ['st0', 'st1', 'st2', 'st3', 'st4'];
  const ZONES = EMZ.concat(MON, ST, ['fz']);
  const PILES = ['hand', 'deck', 'extra', 'gy', 'ban'];
  const arr = (x) => (Array.isArray(x) ? x : []);
  const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : null);
  const copy = (x) => JSON.parse(JSON.stringify(x));
  const isArr = Array.isArray;
  const q = (n) => '«' + n + '»';

  /* ---------- Guardar (por mazo) ---------- */
  let cache = null; // { [deckId]: [tablero] }
  function all() {
    if (cache) return cache;
    try {
      const v = JSON.parse(localStorage.getItem(KEY) || '{}');
      cache = obj(v) || {};
    } catch (e) { cache = {}; }
    return cache;
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(all())); return true; } catch (e) { return false; }
  }
  /** Antes de cambiar algo, relee lo guardado (otra pestaña pudo guardar un tablero); sin almacenamiento sigue en memoria. */
  function reload() {
    try { localStorage.getItem(KEY); cache = null; } catch (e) { /* sin almacenamiento: queda lo de memoria */ }
  }
  try { window.addEventListener('storage', (e) => { if (!e || e.key === KEY || e.key === null) cache = null; }); } catch (e) { /* sin eventos */ }
  const keyOf = (deckId) => String(deckId == null || deckId === '' ? 'sin-mazo' : deckId);
  const okInst = (x) => !!(obj(x) && Number.isInteger(Number(x.id)) && typeof x.uid === 'string');
  const valid = (b) => !!(obj(b) && b.id && Number(b.v) === 1 && obj(b.state) && obj(b.state.zones)
    && ZONES.every((z) => arr(b.state.zones[z]).every(okInst)) && PILES.every((p) => isArr(b.state[p]) && b.state[p].every(okInst)));
  function slot(deckId) {
    const d = all();
    const k = keyOf(deckId);
    d[k] = arr(d[k]).filter(valid);
    return d[k];
  }
  /** Los tableros de un mazo (copias), el más nuevo primero. */
  function list(deckId) { return slot(deckId).map(copy); }
  function count(deckId) { return slot(deckId).length; }
  function find(id) {
    const d = all();
    for (const k of Object.keys(d)) { const b = arr(d[k]).find((x) => valid(x) && x.id === id); if (b) return b; }
    return null;
  }
  function get(id) { const b = find(id); return b ? copy(b) : null; }
  /** Guarda un tablero nuevo (de capture) → el guardado | null. Si el navegador no deja guardar, queda en memoria hasta
   * cerrar la página y vuelve con unsaved: true. */
  function add(board) {
    if (!valid(board)) return null;
    reload();
    const s = slot(board.deckId);
    const b = copy(board);
    s.unshift(b);
    while (s.length > CAP) s.pop();
    const out = copy(b);
    if (!save()) out.unsaved = true;
    return out;
  }
  /** Cambia el nombre o las notas: patch = { name?, notes? } → el tablero (con unsaved si no se pudo guardar) | null */
  function update(id, patch) {
    reload();
    const b = find(id);
    if (!b || !patch) return null;
    if (typeof patch.name === 'string' && patch.name.trim()) b.name = patch.name.trim().slice(0, 80);
    if (typeof patch.notes === 'string') b.notes = patch.notes.slice(0, 4000);
    const out = copy(b);
    if (!save()) out.unsaved = true;
    return out;
  }
  function remove(id) {
    reload();
    const d = all();
    let gone = false;
    for (const k of Object.keys(d)) {
      const n = arr(d[k]).length;
      d[k] = arr(d[k]).filter((x) => !(x && x.id === id));
      if (d[k].length !== n) gone = true;
    }
    if (gone) save();
    return gone;
  }
  /** Para la copia de seguridad: los tableros de esos mazos → { deckId: [tablero] } */
  function exportFor(deckIds) {
    reload();
    const out = {};
    for (const id of arr(deckIds)) { const s = slot(id); if (s.length) out[keyOf(id)] = s.map(copy); }
    return out;
  }
  /** Restaurar una copia: agrega a un mazo los tableros que todavía no tiene (mismo id = el mismo) → { added, unsaved } */
  function importFor(deckId, items) {
    reload();
    const s = slot(deckId);
    let n = 0;
    for (const b of arr(items)) {
      if (s.length >= CAP) break;
      if (!valid(b) || s.some((x) => x.id === b.id)) continue;
      s.push(Object.assign(copy(b), { deckId }));
      n++;
    }
    return { added: n, unsaved: n > 0 && !save() };
  }

  /* ---------- La foto ---------- */
  // Las cartas del rival que quedaron en tu campo (Contact "C", Veidos...) no son tuyas: no entran
  const mine = (x) => okInst(x) && x.owner !== 'opp';
  const newId = () => 'tb' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  /** Foto de tu lado de S (el estado de js/field.js) → tablero. meta = { deckId, deckName, name, notes, second } */
  function capture(S, meta) {
    meta = meta || {};
    const zones = {};
    for (const z of ZONES) {
      const st = arr(S && S.zones && S.zones[z]);
      zones[z] = st.length && mine(st[0]) ? st.filter(mine).map(copy) : [];
    }
    const state = { zones, lp: Number(S && S.lp) || 0, turnDraws: Number(S && S.turnDraws) || 0, turnState: copy((S && S.turnState) || {}) };
    for (const p of PILES) state[p] = arr(S && S[p]).filter(mine).map(copy);
    // Lo que se jugó (el texto del registro, para recordar cómo llegaste)
    state.log = arr(S && S.log).filter((e) => e && e.text).slice(-LOG_CAP)
      .map((e) => ({ turn: Number(e.turn) || 1, mine: e.mine !== false, phase: String(e.phase || ''), text: String(e.text), illegal: !!e.illegal }));
    return {
      v: 1, id: newId(), deckId: meta.deckId == null ? null : meta.deckId, deckName: String(meta.deckName || ''),
      name: String(meta.name || 'Tablero').trim().slice(0, 80) || 'Tablero', notes: String(meta.notes || '').slice(0, 4000),
      created: Date.now(), second: !!meta.second, state,
    };
  }
  /** El tablero listo para el campo, con uids nuevos (newUid() da uno libre) → { zones, hand, deck, extra, gy, ban, lp,
   * turnDraws, turnState }. Los «una vez por turno» de cada copia (turnState.opt 'copy:<uid>#n') siguen con su carta. */
  function restore(board, newUid) {
    const st = board.state;
    const map = new Map();
    const re = (x) => {
      const o = copy(x);
      delete o.owner; delete o.oppUid;
      const u = newUid();
      map.set(x.uid, u);
      o.uid = u;
      return o;
    };
    const out = { zones: {}, lp: Number(st.lp) || 8000, turnDraws: Number(st.turnDraws) || 0 };
    for (const z of ZONES) out.zones[z] = arr(st.zones[z]).map(re);
    for (const p of PILES) out[p] = arr(st[p]).map(re);
    let ts = JSON.stringify(obj(st.turnState) || {});
    ts = ts.replace(/copy:([A-Za-z0-9_-]+)#/g, (m, u) => (map.has(u) ? 'copy:' + map.get(u) + '#' : m))
      .replace(/"([A-Za-z0-9_-]+)"/g, (m, u) => (map.has(u) ? '"' + map.get(u) + '"' : m));
    out.turnState = JSON.parse(ts);
    return out;
  }

  /* ---------- Análisis: qué puede hacer cada carta en el turno del rival ---------- */
  const rules = () => (YGO.rules && typeof YGO.rules.effectsOf === 'function' ? YGO.rules : null);
  function zoneEs(z) {
    const m = /^(mz|st)([0-4])$/.exec(String(z));
    if (m) return (m[1] === 'mz' ? 'Zona de Monstruo ' : 'Zona de M/T ') + (Number(m[2]) + 1);
    if (z === 'emz0') return 'Zona Extra izquierda';
    if (z === 'emz1') return 'Zona Extra derecha';
    if (z === 'fz') return 'Zona de Campo';
    return { hand: 'Mano', gy: 'Cementerio', ban: 'Desterrada', extra: 'Extra Deck' }[z] || z;
  }
  // Textos continuos que no son algo que pase en el duelo (reglas de invocación, el encabezado de los Power Patron)
  const NOT_STATIC = /^(?:For this card's|Gains these effects|You can only|Cannot be (?:Normal |Special )?Summoned|Must (?:first )?be|Can only be|This card's name|\(This card|This card is always treated)/i;
  const OWN_SUMMON = /^(?:If|When) this card is (?:(?:Normal|Special|Tribute|Flip|Synchro|Xyz|Link|Fusion|Ritual|Pendulum|or|and\/or)[\s,/]+)*Summoned\b/i;
  const REACTS = /destroyed|sent to (?:the|your) (?:GY|Graveyard)|leaves the field|banished|targeted|attack|opponent|End Phase|Standby Phase|Battle Phase|damage/i;
  /** Lo que hace el efecto (sin condición ni costo) → etiquetas */
  function tagsOf(e) {
    let t = String(e.text || '');
    t = t.replace(/^\d+\+?:\s*/, '');
    if (e.condition) { const i = t.indexOf(':'); if (i >= 0) t = t.slice(i + 1); }
    if (e.cost) { const i = t.indexOf(';'); if (i >= 0) t = t.slice(i + 1); }
    // (lo que protege no cuenta: "cannot be destroyed by card effects")
    t = t.replace(/\bcannot be (?:destroyed|banished|targeted|negated|returned|Tributed)[^.;]*/gi, '');
    const tags = [];
    if (/\bnegate\b/i.test(t)) tags.push('Niega');
    if (/\bbanish/i.test(t)) tags.push('Destierra');
    if (/\bdestroy/i.test(t)) tags.push('Destruye');
    if (/\breturn\b[^.]*\bto the (?:hand|Deck|Extra Deck)|\bshuffle\b[^.]*\binto the (?:Deck|Extra Deck)/i.test(t)) tags.push('Devuelve');
    if (/\bSpecial Summon\b/i.test(t)) tags.push('Invoca');
    const cond = String(e.condition || '') + ' ' + String(e.text || '').slice(0, 60);
    if (/Once per opponent's turn/i.test(cond)) tags.push('1 vez por turno del rival');
    else if (arr(e.opts).length || /Once per turn/i.test(cond)) tags.push('1 vez por turno');
    if (/Once per Chain/i.test(cond)) tags.push('1 vez por Cadena');
    return tags;
  }
  /** Monstruos a los que apunta cada Link boca arriba → [{ uid, id, zone, zones (a las que apunta), points }] */
  function linksOf(state) {
    const R = rules();
    const out = [];
    if (!R || typeof R.linkedZones !== 'function') return out;
    const tops = EMZ.concat(MON).map((z) => ({ z, x: arr(state.zones[z])[0] })).filter((t) => t.x && !t.x.faceDown);
    const linkTops = tops.filter((t) => { const c = db.get(t.x.id); return c && c.isLink; });
    for (const L of linkTops) {
      let zs;
      try { zs = R.linkedZones({ zones: state.zones }, linkTops.filter((o) => o !== L).map((o) => o.x.uid)); } catch (e) { zs = new Set(); }
      const zones = EMZ.concat(MON).filter((z) => zs.has && zs.has(z));
      out.push({ uid: L.x.uid, id: Number(L.x.id), zone: L.z, zones, points: zones.filter((z) => arr(state.zones[z]).length).length });
    }
    return out;
  }
  /** "3:" / "2+:" al principio del efecto (los Power Patron): ¿se cumple con a cuántos apunta? → null (no aplica) | { ok, need } */
  function linkGate(e, link) {
    const m = /^(\d+)(\+)?:/.exec(String(e.text || ''));
    if (!m || !link) return null;
    const n = Number(m[1]);
    return { ok: m[2] ? link.points >= n : link.points === n, need: m[0].slice(0, -1) };
  }
  /** Condiciones de "no controlar nada" (Mulcharmy, handtraps de mano vacía): ¿se cumplen con este campo? → null | { off, why } */
  function condOff(e, state) {
    const c = String(e.condition || '');
    const cards = ZONES.some((z) => arr(state.zones[z]).length);
    const mons = EMZ.concat(MON).some((z) => arr(state.zones[z]).length);
    if (/\byou control no cards\b/i.test(c) && cards) return { off: true, why: 'Pide que no controles cartas' };
    if (/\byou control no monsters\b/i.test(c) && mons) return { off: true, why: 'Pide que no controles monstruos' };
    return null;
  }
  /** → { counts, links, interrupts, reactive, always, negates }. Cada opción: { uid, id, name, where, place, index, text,
   * html, tags, down, off, why } (off: el efecto no aplica ahora, why dice por qué). */
  function analyze(state) {
    const R = rules();
    const out = { counts: {}, links: linksOf(state), interrupts: [], reactive: [], always: [], negates: 0 };
    for (const p of PILES) out.counts[p] = arr(state[p]).length;
    out.counts.field = ZONES.filter((z) => arr(state.zones[z]).length).length;
    if (!R) return out;
    const effs = (c) => { try { return arr(R.effectsOf(c)); } catch (e) { return []; } };
    const add = (group, x, where, e, extra) => {
      const c = db.get(x.id);
      const o = Object.assign({ uid: x.uid, id: Number(x.id), name: c ? c.name : 'Carta ' + x.id, where, place: zoneEs(where), index: e.index,
        text: String(e.text || ''), html: String(e.html || ''), tags: tagsOf(e), down: false, off: false, why: '' }, extra || {});
      out[group].push(o);
    };
    const at = (e, loc) => (isArr(e.where) ? e.where.includes(loc) : loc === 'field');
    // En el campo
    for (const z of ZONES) {
      const x = arr(state.zones[z])[0];
      if (!x || x.token) continue;
      const c = db.get(x.id);
      if (!c) continue;
      const list = effs(c);
      if (x.faceDown) {
        // Colocadas: Trampas y Mágicas Rápidas se pueden activar en el turno del rival
        if (ST.includes(z) || z === 'fz') {
          const quickSpell = db.isSpell(c) && c.type & db.T.QUICKPLAY;
          if (db.isTrap(c) || quickSpell) {
            const acts = list.filter((e) => e.kind === 'activation');
            const e = acts.find((a) => a.index > 0) || acts[0] || { index: 1, text: c.desc, html: '', kind: 'activation' };
            add('interrupts', x, z, e, { down: true, tags: [db.isTrap(c) ? 'Trampa colocada' : 'Mágica Rápida colocada'].concat(tagsOf(e)) });
          }
        }
        continue;
      }
      const link = out.links.find((l) => l.uid === x.uid) || null;
      const inPz = ST.includes(z) && db.isMonster(c);
      for (const e of list) {
        if (!!e.pendulum !== inPz) continue;
        const gate = linkGate(e, link);
        const extra = gate && !gate.ok ? { off: true, why: 'Pide ' + gate.need + ' y apunta a ' + link.points } : null;
        if (e.kind === 'quick' && at(e, 'field')) add('interrupts', x, z, e, extra);
        else if (e.kind === 'trigger' && at(e, 'field') && e.condition && !OWN_SUMMON.test(e.condition) && REACTS.test(e.condition)) add('reactive', x, z, e, extra);
        else if (e.kind === 'continuous' && !NOT_STATIC.test(String(e.text || '').replace(/^\d+\+?:\s*/, ''))) add('always', x, z, e, extra);
      }
    }
    // En la mano, el Cementerio y las desterradas
    for (const [p, loc] of [['hand', 'hand'], ['gy', 'gy'], ['ban', 'ban']]) {
      const seen = new Set();
      for (const x of arr(state[p])) {
        if (!x || x.token || seen.has(Number(x.id))) continue; // (copias iguales: una vez)
        seen.add(Number(x.id));
        const c = db.get(x.id);
        if (!c) continue;
        for (const e of effs(c)) {
          if (!at(e, loc) || e.pendulum) continue;
          if (e.kind === 'quick') add('interrupts', x, loc, e, condOff(e, state));
          else if (e.kind === 'trigger' && loc !== 'hand' && e.condition && /opponent|End Phase|Standby Phase/i.test(e.condition)) add('reactive', x, loc, e);
        }
      }
    }
    out.negates = out.interrupts.filter((o) => !o.off && o.tags.includes('Niega')).length;
    return out;
  }
  /** Resumen corto para la lista: "6 en el campo · 4 interrupciones (2 niegan)" */
  function summary(b) {
    const a = analyze(b.state);
    const on = a.interrupts.filter((o) => !o.off).length;
    return a.counts.field + ' en el campo · ' + on + (on === 1 ? ' interrupción' : ' interrupciones') + (a.negates ? ' (' + a.negates + (a.negates === 1 ? ' niega)' : ' niegan)') : '');
  }

  YGO.boards = {
    KEY, CAP, ZONES, EMZ, MON, ST, PILES, list, count, get, add, update, remove, exportFor, importFor, capture, restore, analyze, summary, zoneEs, valid, q,
    _reset: () => { cache = {}; save(); },
  };
})();
