/* Copia de seguridad: tus mazos, tus combos grabados y tus tableros guardados en un archivo (o un texto) que restauras en este navegador o en
 * otro equipo, y el pedido al navegador de no borrar lo guardado. La app no tiene cuentas: todo vive en el navegador
 * (localStorage) y la copia es la forma de llevarlo a otro lado o de recuperarlo si se borran los datos.
 * Expone window.YGO.backup. Lo usa js/deckbuilder.js (botones Guardar y Copia de seguridad del constructor). */
(function () {
  const YGO = (window.YGO = window.YGO || {});
  const { db, deck, store } = YGO;
  const APP = 'simulador-yugioh';
  const V = 1;
  const KEYS = { cards: 'simulador-yugioh:extra-cards', aliases: 'simulador-yugioh:extra-aliases', names: 'simulador-yugioh:name-aliases' };
  const SECTIONS = ['main', 'extra', 'side'];
  const arr = (x) => (Array.isArray(x) ? x : []);
  const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : null);
  const copy = (x) => JSON.parse(JSON.stringify(x));
  const readKey = (k, fallback) => {
    try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? fallback : v; } catch (e) { return fallback; }
  };
  const nameKey = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const C = () => YGO.combos || null;
  const TB = () => YGO.boards || null;

  /** La copia de esos mazos: { app, v, savedAt, decks, combos: { deckId: [combo] }, boards: { deckId: [tablero] }, cards, aliases, names } */
  function make(decks) {
    const list = arr(decks).filter(obj).map(copy);
    const c = C();
    return {
      app: APP, v: V, savedAt: new Date().toISOString(),
      decks: list,
      combos: c ? c.exportFor(list.map((d) => d.id)) : {},
      boards: TB() ? TB().exportFor(list.map((d) => d.id)) : {},
      // Cartas que este navegador bajó de YGOPRODeck (las nuevas que no trae la base incluida): sin ellas, otro equipo sin
      // conexión no las conoce
      cards: arr(readKey(KEYS.cards, [])),
      aliases: obj(readKey(KEYS.aliases, {})) || {},
      names: obj(readKey(KEYS.names, {})) || {},
    };
  }
  const toText = (b) => JSON.stringify(b);
  /** Cuántos mazos, combos y tableros trae → { decks, combos, boards } */
  const counts = (b) => ({
    decks: arr(b && b.decks).length,
    combos: Object.values(obj(b && b.combos) || {}).reduce((n, l) => n + arr(l).length, 0),
    boards: Object.values(obj(b && b.boards) || {}).reduce((n, l) => n + arr(l).length, 0),
  });
  const pad = (n) => String(n).padStart(2, '0');
  /** simulador-yugioh-copia-2026-10-26.json */
  const filename = (date) => { const d = date || new Date(); return APP + '-copia-' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '.json'; };
  /** Fecha de la copia para leer ("26 oct 2026, 14:20") o '' */
  function when(iso) {
    const d = new Date(iso);
    if (!iso || isNaN(d.getTime())) return '';
    try { return d.toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' }); } catch (e) { return d.toISOString().slice(0, 16).replace('T', ' '); }
  }

  /** Lee el texto de una copia → { ok: true, data } | { ok: false, why } */
  function parse(text) {
    let v;
    try { v = JSON.parse(String(text == null ? '' : text).trim()); } catch (e) { return { ok: false, why: 'Eso no es una copia del simulador (no se pudo leer).' }; }
    if (!obj(v) || v.app !== APP || !Array.isArray(v.decks)) return { ok: false, why: 'Eso no es una copia del simulador.' };
    if (Number(v.v) > V) return { ok: false, why: 'La copia es de una versión más nueva del simulador: recarga la página y vuelve a intentarlo.' };
    const decks = v.decks.filter((d) => obj(d) && typeof d.id === 'string' && d.id).map((d) => {
      const out = Object.assign({}, d, { name: String(d.name || 'Mazo').slice(0, 60) });
      for (const s of SECTIONS) out[s] = arr(d[s]).map(Number).filter((x) => Number.isInteger(x) && x > 0);
      if (!obj(d.roles)) delete out.roles;
      if (!Array.isArray(d.pending)) delete out.pending;
      return out;
    });
    if (!decks.length) return { ok: false, why: 'La copia no trae mazos.' };
    const combos = {};
    for (const [k, l] of Object.entries(obj(v.combos) || {})) if (Array.isArray(l)) combos[k] = l;
    const boards = {};
    for (const [k, l] of Object.entries(obj(v.boards) || {})) if (Array.isArray(l)) boards[k] = l;
    return { ok: true, data: { savedAt: String(v.savedAt || ''), decks, combos, boards, cards: arr(v.cards).filter(Array.isArray),
      aliases: obj(v.aliases) || {}, names: obj(v.names) || {} } };
  }

  /** Qué hace restaurar: cada mazo de la copia reemplaza al tuyo con su mismo id (el mismo mazo) o, si no, con su mismo
   * nombre (el mazo compartido de otro equipo); si no hay, se agrega → { items: [{ inc, local }], replace, add } */
  function plan(local, data) {
    const used = new Set();
    const items = arr(data && data.decks).map((inc) => {
      let m = arr(local).find((d) => !used.has(d) && d.id === inc.id);
      if (!m) m = arr(local).find((d) => !used.has(d) && nameKey(d.name) === nameKey(inc.name));
      if (m) used.add(m);
      return { inc, local: m || null };
    });
    return { items, replace: items.filter((x) => x.local), add: items.filter((x) => !x.local) };
  }

  const mergeKey = (k, o) => {
    if (!Object.keys(o || {}).length) return;
    try { localStorage.setItem(k, JSON.stringify(Object.assign(obj(readKey(k, {})) || {}, o))); } catch (e) { /* sin almacenamiento */ }
  };
  /** Restaura → { list (la lista nueva de mazos), decks (los de la copia, ya en la lista), combos y boards (cuántos se
   * sumaron), unsaved (el navegador no dejó guardar los combos o los tableros) }. Los demás mazos no cambian. */
  function apply(local, data, p) {
    p = p || plan(local, data);
    // Primero las cartas bajadas de YGOPRODeck: los mazos las usan
    try { if (data.cards.length) db.add(data.cards); } catch (e) { /* filas raras: los mazos apartan lo que no conocen */ }
    mergeKey(KEYS.aliases, data.aliases);
    mergeKey(KEYS.names, data.names);
    const list = arr(local).slice();
    const out = [];
    let combos = 0, boards = 0, unsaved = false;
    for (const it of p.items) {
      const d = store.clean(Object.assign(copy(it.inc), { updated: Date.now() }));
      if (it.local) { d.id = it.local.id; list[list.indexOf(it.local)] = d; }
      else {
        if (list.some((x) => x.id === d.id)) d.id = deck.create().id;
        list.push(d);
      }
      out.push(d);
      const c = C();
      const cl = arr(data.combos[it.inc.id]);
      if (c && cl.length) { const r = c.importFor(d.id, cl); combos += r.added; unsaved = unsaved || r.unsaved; }
      const bl = arr(obj(data.boards) && data.boards[it.inc.id]);
      if (TB() && bl.length) { const r = TB().importFor(d.id, bl); boards += r.added; unsaved = unsaved || r.unsaved; }
    }
    return { list, decks: out, combos, boards, unsaved };
  }

  /** Pide al navegador que no borre lo guardado aunque le falte espacio → 'yes' | 'no' | 'unsupported' */
  async function persist() {
    try {
      const st = navigator.storage;
      if (!st || typeof st.persist !== 'function') return 'unsupported';
      if (typeof st.persisted === 'function' && (await st.persisted())) return 'yes';
      return (await st.persist()) ? 'yes' : 'no';
    } catch (e) { return 'unsupported'; }
  }

  // En claude.ai las descargas pasan por el visor (capacidad "downloads"); en el sitio, la descarga del navegador
  let dlP = null;
  function prefetch() {
    if (!dlP) {
      dlP = window.claude && typeof window.claude.use === 'function'
        ? Promise.resolve().then(() => window.claude.use('downloads')).catch(() => null)
        : Promise.resolve(null);
    }
    return dlP;
  }
  /** Ofrece el archivo → 'saved' (lo aceptaste) | 'declined' | 'busy' | 'browser' (descarga del navegador: no se sabe si
   * llegó) | 'failed' */
  async function download(name, text) {
    const dl = await prefetch();
    if (dl) {
      try { await dl.save({ filename: name, data: text }); return 'saved'; } catch (e) {
        const code = e && e.code;
        if (code === 'declined') return 'declined';
        if (code === 'rate_limited') return 'busy';
        // (no disponible aquí: prueba con la del navegador)
      }
    }
    try {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (e) { return 'failed'; }
    return 'browser';
  }

  YGO.backup = { APP, V, make, toText, counts, filename, when, parse, plan, apply, persist, prefetch, download };
})();
