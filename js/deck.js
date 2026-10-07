/* Modelo de mazo, formato .ydk y guardado en el navegador.
 * Expone window.YGO.deck (funciones puras sobre mazos) y window.YGO.store (lista de mazos guardados).
 * Un mazo es { id, name, main: [códigos], extra: [códigos], side: [códigos], updated }. */
(function () {
  const YGO = (window.YGO = window.YGO || {});
  const db = YGO.db;

  const LIMITS = { main: { min: 40, max: 60 }, extra: { min: 0, max: 15 }, side: { min: 0, max: 15 } };
  const SECTIONS = ['main', 'extra', 'side'];

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  const deck = {
    LIMITS, SECTIONS,

    create(name, data) {
      return { id: uid(), name: name || 'Mazo nuevo', main: [], extra: [], side: [], updated: Date.now(), ...(data || {}) };
    },

    /** Copias de una carta (por su código base) entre principal, extra y side. */
    copies(d, id) {
      const base = db.get(id);
      if (!base) return 0;
      let n = 0;
      for (const s of SECTIONS) for (const x of d[s]) if (db.get(x) === base) n++;
      return n;
    },

    /** Máximo de copias permitido: 3, o lo que diga la banlist si está activa. */
    maxCopies(id, useBanlist) {
      return useBanlist ? db.banLimit(id) : 3;
    },

    /** Sección natural de una carta: los monstruos de Fusión/Sincronía/Xyz/Link van al Extra. */
    naturalSection(id) {
      const c = db.get(id);
      return c && db.isExtra(c) ? 'extra' : 'main';
    },

    /** Indica si la carta puede ir en esa sección. Devuelve null si se puede, o el motivo en texto. */
    whyNot(d, id, section, useBanlist) {
      const c = db.get(id);
      if (!c) return 'Carta desconocida';
      if (section === 'main' && db.isExtra(c)) return 'Esta carta va en el Extra Deck';
      if (section === 'extra' && !db.isExtra(c)) return 'Solo monstruos de Fusión, Sincronía, Xyz y Link van en el Extra Deck';
      if (d[section].length >= LIMITS[section].max) return 'Esa sección ya tiene ' + LIMITS[section].max + ' cartas';
      const max = deck.maxCopies(id, useBanlist);
      if (deck.copies(d, id) >= max) {
        return max === 0 ? 'Carta prohibida en la banlist' : 'Ya tienes el máximo de copias (' + max + ')';
      }
      return null;
    },

    /** Añade una carta. section es opcional (usa la natural). Devuelve null si se añadió o el motivo. */
    add(d, id, section, useBanlist) {
      section = section || deck.naturalSection(id);
      const c = db.get(id);
      const why = deck.whyNot(d, id, section, useBanlist);
      if (why) return why;
      d[section].push(c.id);
      d.updated = Date.now();
      return null;
    },

    /** Quita una copia. Si index se da, quita esa posición; si no, la última copia de esa carta. */
    remove(d, section, id, index) {
      const arr = d[section];
      if (index === undefined) {
        const base = db.get(id);
        index = arr.map((x) => db.get(x)).lastIndexOf(base);
      }
      if (index < 0 || index >= arr.length) return false;
      arr.splice(index, 1);
      d.updated = Date.now();
      return true;
    },

    /** Orden típico de un listado: monstruos, mágicas, trampas; luego nivel y nombre. */
    sort(d) {
      const key = (c) => [db.isMonster(c) ? 0 : db.isSpell(c) ? 1 : 2, db.frame(c), -c.lv, c.name];
      const cmp = (a, b) => {
        const ka = key(db.get(a)), kb = key(db.get(b));
        for (let i = 0; i < ka.length; i++) {
          if (ka[i] < kb[i]) return -1;
          if (ka[i] > kb[i]) return 1;
        }
        return 0;
      };
      for (const s of SECTIONS) d[s].sort(cmp);
      d.updated = Date.now();
    },

    stats(d) {
      const count = (arr, pred) => arr.filter((x) => pred(db.get(x))).length;
      return {
        main: d.main.length, extra: d.extra.length, side: d.side.length,
        monsters: count(d.main, db.isMonster), spells: count(d.main, db.isSpell), traps: count(d.main, db.isTrap),
      };
    },

    /** Problemas que impiden usar el mazo en un duelo oficial. */
    problems(d, useBanlist) {
      const out = [];
      if (d.main.length < 40) out.push('El mazo principal necesita al menos 40 cartas (tiene ' + d.main.length + ')');
      if (d.main.length > 60) out.push('El mazo principal admite como máximo 60 cartas');
      if (d.extra.length > 15) out.push('El Extra Deck admite como máximo 15 cartas');
      if (d.side.length > 15) out.push('El Side Deck admite como máximo 15 cartas');
      const seen = new Set();
      for (const s of SECTIONS) for (const id of d[s]) {
        const c = db.get(id);
        if (!c || seen.has(c.id)) continue;
        seen.add(c.id);
        const n = deck.copies(d, id), max = deck.maxCopies(id, useBanlist);
        if (n > max) out.push(c.name + ': ' + n + ' copias, el máximo es ' + max);
      }
      return out;
    },

    toYdk(d) {
      return ['#created by Simulador Yugioh', '#main', ...d.main, '#extra', ...d.extra, '!side', ...d.side].join('\n') + '\n';
    },

    /** Lee un .ydk. Devuelve { main, extra, side, unknown, unknownIds } con códigos base. */
    fromYdk(text) {
      const out = { main: [], extra: [], side: [], unknown: 0, unknownIds: [] };
      let section = 'main';
      for (let line of text.split(/\r?\n/)) {
        line = line.trim();
        if (!line) continue;
        if (line === '#main') section = 'main';
        else if (line === '#extra') section = 'extra';
        else if (line === '!side') section = 'side';
        else if (/^\d+$/.test(line)) {
          const c = db.get(line);
          if (c) out[section].push(c.id);
          else { out.unknown++; out.unknownIds.push(Number(line)); }
        }
      }
      return out;
    },

    /** Lee una lista de texto tipo "3x Ash Blossom & Joyous Spring" con secciones Main/Extra/Side.
     *  Devuelve null si el texto no tiene ese formato. */
    parseList(text) {
      const entries = [];
      let section = 'main';
      for (let line of text.split(/\r?\n/)) {
        line = line.trim();
        if (/^main( deck)?:?$/i.test(line)) section = 'main';
        else if (/^extra( deck)?:?$/i.test(line)) section = 'extra';
        else if (/^side( deck)?:?$/i.test(line)) section = 'side';
        else {
          const m = line.match(/^(\d+)\s*x\s+(.+)$/i);
          if (m) entries.push({ section, count: Number(m[1]), name: m[2].replace(/&amp;/g, '&').trim() });
        }
      }
      return entries.length ? entries : null;
    },

    /** Coloca en el mazo las entradas de lista cuyas cartas ya conoce la base; devuelve las que faltan. */
    placeEntries(d, entries) {
      const missing = [];
      for (const e of entries) {
        const c = db.findByName(e.name);
        if (!c) { missing.push(e); continue; }
        const section = e.section === 'side' ? 'side' : db.isExtra(c) ? 'extra' : 'main';
        for (let i = 0; i < e.count; i++) d[section].push(c.id);
      }
      return missing;
    },

    /** Lee un mazo en .ydk o en lista de texto. Devuelve { main, extra, side, unknown, unknownIds, missing }. */
    fromText(text) {
      const entries = deck.parseList(text);
      if (!entries) return Object.assign(deck.fromYdk(text), { missing: [] });
      const out = { main: [], extra: [], side: [], unknown: 0, unknownIds: [] };
      out.missing = deck.placeEntries(out, entries);
      out.unknown = out.missing.reduce((n, e) => n + e.count, 0);
      return out;
    },

    /** Intenta colocar las cartas pendientes (las que faltaban al importar). Devuelve cuántas colocó. */
    resolvePending(d) {
      if (!d.pending || !d.pending.length) return 0;
      const before = d.pending.reduce((n, e) => n + e.count, 0);
      d.pending = deck.placeEntries(d, d.pending);
      const after = d.pending.reduce((n, e) => n + e.count, 0);
      if (after !== before) d.updated = Date.now();
      return before - after;
    },

    /** Mazo como lista de cartas expandida (útil para la prueba de mano y el campo). */
    cards(d, section) {
      return d[section || 'main'].map((id) => db.get(id)).filter(Boolean);
    },
  };

  /* ---------- Guardado local ---------- */
  const KEY = 'simulador-yugioh:decks';
  const PREF = 'simulador-yugioh:prefs';
  const read = (k, fallback) => {
    try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
  };
  const write = (k, v) => {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; }
  };
  /** Preferencias guardadas; si lo guardado no es un objeto (p. ej. 'null'), se empieza de cero. */
  const readPrefs = () => {
    const p = read(PREF, {});
    return p && typeof p === 'object' && !Array.isArray(p) ? p : {};
  };

  const store = {
    /** Lista de mazos guardados; si no hay ninguno devuelve el mazo de ejemplo. */
    load() {
      let list = read(KEY, null);
      if (Array.isArray(list)) list = list.filter((d) => d && typeof d === 'object');
      if (!Array.isArray(list) || !list.length) {
        const s = window.YGO_SAMPLE_DECK;
        list = [s ? deck.create(s.name, { main: s.main.slice(), extra: s.extra.slice(), side: s.side.slice() }) : deck.create()];
      }
      // Códigos que la base ya no conoce (p. ej. cartas en línea cuyo caché se borró): se apartan para no romper la app
      for (const d of list) {
        for (const s of SECTIONS) {
          if (!Array.isArray(d[s])) d[s] = [];
          const bad = d[s].filter((id) => !db.get(id));
          if (bad.length) { d[s] = d[s].filter((id) => db.get(id)); d.unknownIds = (d.unknownIds || []).concat(bad); }
        }
        // Cartas que faltaban al importar y que ahora trae la base (también sin conexión)
        deck.resolvePending(d);
      }
      // Mazos compartidos en el proyecto: se agregan una sola vez a la lista guardada
      const prefs = readPrefs();
      const added = Array.isArray(prefs.presetsAdded) ? prefs.presetsAdded : [];
      for (const p of window.YGO_PRESET_DECKS || []) {
        if (added.includes(p.presetId) || list.some((d) => d.presetId === p.presetId)) continue;
        const d = deck.create(p.name, { presetId: p.presetId });
        d.pending = deck.placeEntries(d, deck.parseList(p.list));
        list.push(d);
        added.push(p.presetId);
        prefs.lastDeckId = d.id;
      }
      prefs.presetsAdded = added;
      write(PREF, prefs);
      return list;
    },
    save(list) { return write(KEY, list); },
    prefs() { return readPrefs(); },
    savePrefs(p) { return write(PREF, p); },
  };

  YGO.deck = deck;
  YGO.store = store;
})();
