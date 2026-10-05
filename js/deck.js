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

  const store = {
    /** Lista de mazos guardados; si no hay ninguno devuelve el mazo de ejemplo. */
    load() {
      const list = read(KEY, null);
      if (Array.isArray(list) && list.length) return list;
      const s = window.YGO_SAMPLE_DECK;
      return [s ? deck.create(s.name, { main: s.main.slice(), extra: s.extra.slice(), side: s.side.slice() }) : deck.create()];
    },
    save(list) { return write(KEY, list); },
    prefs() { return read(PREF, {}); },
    savePrefs(p) { return write(PREF, p); },
  };

  YGO.deck = deck;
  YGO.store = store;
})();
