/* Intentos contra el rival con handtraps: cada duelo que terminas (pasas tu turno o tocas "Terminar intento")
 * queda guardado por mazo con tu mano, la mano del rival, qué handtraps usó y si tu campo pasó.
 * Calcula el % de veces que pasas (en total, yendo primero y segundo) y qué handtrap te corta más.
 * También guarda el "campo objetivo" de cada mazo (las cartas que quieres tener al terminar tu turno).
 * Expone window.YGO.attempts. Todo vive en localStorage (clave 'simulador-yugioh:intentos'); sin
 * almacenamiento sigue funcionando en memoria. No toca el DOM: las ventanas las arma js/field.js. */
(function () {
  const YGO = (window.YGO = window.YGO || {});
  const KEY = 'simulador-yugioh:intentos';
  const CAP = 300; // intentos guardados por mazo (se borran los más viejos)

  let cache = null; // { [deckId]: { list: [intento], target: [nombres] } }
  const arr = (x) => (Array.isArray(x) ? x : []);
  const copy = (x) => JSON.parse(JSON.stringify(x));

  function all() {
    if (cache) return cache;
    try {
      const v = JSON.parse(localStorage.getItem(KEY) || '{}');
      cache = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    } catch (e) { cache = {}; }
    return cache;
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(all())); return true; } catch (e) { return false; }
  }
  /** Antes de guardar, relee lo guardado (otra pestaña pudo agregar intentos); sin almacenamiento sigue en memoria. */
  function reload() {
    try { localStorage.getItem(KEY); cache = null; } catch (e) { /* sin almacenamiento: se queda lo de memoria */ }
  }
  try { window.addEventListener('storage', (e) => { if (!e || e.key === KEY || e.key === null) cache = null; }); } catch (e) { /* sin eventos */ }
  /** Datos de un mazo (los crea si faltan). Descarta lo que no sea un intento (datos dañados). */
  function slot(deckId) {
    const db = all();
    const k = String(deckId || 'sin-mazo');
    const s = db[k] && typeof db[k] === 'object' && !Array.isArray(db[k]) ? db[k] : {};
    s.list = arr(s.list).filter((a) => a && typeof a === 'object' && !Array.isArray(a));
    s.target = arr(s.target).map(String);
    db[k] = s;
    return s;
  }

  /** ¿El campo pasa? Con campo objetivo: pasa si están todas sus cartas (con sus copias). Sin objetivo: null. */
  function evaluate(target, board) {
    target = arr(target);
    if (!target.length) return { pass: null, missing: [] };
    const left = arr(board).slice();
    const missing = [];
    target.forEach((n) => {
      const i = left.indexOf(n);
      if (i >= 0) left.splice(i, 1); else missing.push(n);
    });
    return { pass: !missing.length, missing };
  }

  /** Cuentas para la ventana "Intentos". Solo cuentan para el % los intentos con respuesta (pasó o no). */
  function stats(deckId) {
    const list = slot(deckId).list;
    const part = (xs) => {
      const answered = xs.filter((a) => a.passed === true || a.passed === false);
      const passed = answered.filter((a) => a.passed === true).length;
      return { total: xs.length, answered: answered.length, passed, pct: answered.length ? passed / answered.length : null };
    };
    const out = Object.assign(part(list), {
      first: part(list.filter((a) => !a.second)),
      second: part(list.filter((a) => a.second)),
      rival: list.filter((a) => a.rival).length,
      traps: [], worst: null,
    });
    // Por handtrap: cuántas veces la tuvo, la usó, pasaste igual y te cortó (la usó sin que la negaras y no pasaste)
    const by = new Map();
    const get = (n) => {
      if (!by.has(n)) by.set(n, { name: n, seen: 0, used: 0, usedPassed: 0, usedAnswered: 0, stopped: 0 });
      return by.get(n);
    };
    list.forEach((a) => {
      new Set(arr(a.botHand).filter((n) => n != null).map(String)).forEach((n) => { get(n).seen++; });
      const used = arr(a.used).filter((u) => u && u.name).map((u) => Object.assign({}, u, { name: String(u.name) }));
      new Set(used.map((u) => u.name)).forEach((n) => {
        const t = get(n);
        t.used++;
        if (a.passed === true || a.passed === false) t.usedAnswered++;
        if (a.passed === true) t.usedPassed++;
      });
      if (a.passed === false) new Set(used.filter((u) => !u.negated).map((u) => u.name)).forEach((n) => { get(n).stopped++; });
    });
    out.traps = Array.from(by.values()).sort((x, y) => y.used - x.used || y.seen - x.seen || x.name.localeCompare(y.name));
    const worst = out.traps.filter((t) => t.stopped > 0).sort((x, y) => y.stopped - x.stopped || y.used - x.used)[0];
    out.worst = worst ? { name: worst.name, stopped: worst.stopped } : null;
    return out;
  }

  YGO.attempts = {
    KEY, CAP, evaluate, stats,
    /** Intentos del mazo, del más viejo al más nuevo (copia). */
    list: (deckId) => copy(slot(deckId).list),
    /** Guarda un intento nuevo; devuelve la copia guardada (con id y fecha). */
    add(deckId, att) {
      reload();
      const s = slot(deckId);
      const a = Object.assign({}, copy(att || {}), { id: 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), at: Date.now() });
      s.list.push(a);
      if (s.list.length > CAP) s.list.splice(0, s.list.length - CAP);
      save();
      return copy(a);
    },
    /** Cambia datos de un intento (p. ej. la respuesta "¿Tu campo pasó?"). Devuelve el intento o null. */
    update(deckId, id, patch) {
      reload();
      const a = slot(deckId).list.find((x) => x.id === id);
      if (!a) return null;
      Object.assign(a, copy(patch || {}));
      save();
      return copy(a);
    },
    get: (deckId, id) => { const a = slot(deckId).list.find((x) => x.id === id); return a ? copy(a) : null; },
    /** Borra los intentos del mazo (el campo objetivo se queda). */
    clear(deckId) { reload(); slot(deckId).list = []; save(); },
    target: (deckId) => slot(deckId).target.slice(),
    setTarget(deckId, names) { reload(); slot(deckId).target = arr(names).map(String); save(); return slot(deckId).target.slice(); },
  };
})();
