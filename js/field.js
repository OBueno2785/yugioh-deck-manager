/* Campo de juego para practicar combos: zonas de Master Rule, mano, mazo, Extra, cementerio y destierro.
 * Las cartas se mueven arrastrando o tocando la carta y luego la zona destino.
 * Las invocaciones y los efectos se declaran antes de hacerlos: YGO.rules (js/rules.js) dice si la jugada
 * es legal, la cadena se arma y se resuelve aquí, y todo queda anotado en el registro del duelo.
 * Rival con handtraps (js/bot.js): responde solo a tus jugadas, sus efectos se aplican al resolver la cadena,
 * y cada intento queda guardado (js/attempts.js) para saber cuántas veces pasa tu campo. */
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
  const ZONE_NAMES = {
    emz0: 'Zona Extra izquierda', emz1: 'Zona Extra derecha', fz: 'Zona de Campo',
    mz0: 'Zona de Monstruo 1', mz1: 'Zona de Monstruo 2', mz2: 'Zona de Monstruo 3', mz3: 'Zona de Monstruo 4', mz4: 'Zona de Monstruo 5',
    st0: 'Zona de M/T 1', st1: 'Zona de M/T 2', st2: 'Zona de M/T 3', st3: 'Zona de M/T 4', st4: 'Zona de M/T 5',
  };
  const isMonsterZone = (z) => z.startsWith('mz') || z.startsWith('emz');
  const placeName = (z) => ZONE_NAMES[z] || PILE_NAMES[z] || z;

  // Nombres en español de cada forma de invocar y de cada tipo de efecto (los métodos son los del contrato de YGO.rules)
  const METHOD = {
    normal: 'Invocación Normal', set: 'Colocación', tribute: 'Invocación por Sacrificio', tributeSet: 'Colocación por Sacrificio',
    special: 'Invocación Especial', synchro: 'Invocación por Sincronía', xyz: 'Invocación Xyz', link: 'Invocación Link',
    fusion: 'Invocación por Fusión', ritual: 'Invocación por Ritual', pendulum: 'Invocación por Péndulo', flip: 'Invocación por Volteo',
  };
  const PROCEDURES = ['synchro', 'xyz', 'link', 'fusion', 'ritual'];
  const KIND = {
    activation: 'Activación de carta', ignition: 'Efecto de Ignición', quick: 'Efecto Rápido', trigger: 'Efecto de Disparo',
    continuous: 'Efecto Continuo', summon: 'Procedimiento de invocación',
  };
  const PHASES = [['draw', 'Robo'], ['standby', 'Standby'], ['main1', 'Principal 1'], ['battle', 'Batalla'], ['main2', 'Principal 2'], ['end', 'Final']];
  const PHASE_SHORT = { main1: 'P1', main2: 'P2' };

  // fieldSecond: ir segundo; botCount: 0 (sin rival) | 2 | 3 | '2-3'; botMode: 'smart' | 'aggressive'; botPool: [{ name, copies }]
  const prefs = Object.assign({ handSize: 5, fieldStrict: true, fieldSecond: false, botCount: 0, botMode: 'smart', botPool: null }, store.prefs());
  const savePref = (patch) => { Object.assign(prefs, patch); store.savePrefs(Object.assign(store.prefs(), patch)); };
  // Antes el campo repartía prefs.handSize: quien tenía 6 practicaba ir segundo (se guarda una vez como fieldSecond)
  if (store.prefs().fieldSecond === undefined && Number(prefs.handSize) === 6) savePref({ fieldSecond: true });
  /** Relee las preferencias guardadas (otra pestaña pudo cambiarlas). */
  const freshPrefs = () => Object.assign(prefs, store.prefs());
  let d = null;
  let S = null;           // estado de la partida (incluye turnState, chain y log: así deshacer los incluye)
  let history = [];
  let histBase = 0;       // fotos descartadas por el límite de history (para ubicar la foto de una declaración)
  let selected = null;    // uid de la carta elegida
  let pending = null;     // { kind: 'move' | 'overlay' | 'attach', uid } o una invocación en curso { kind: 'summon', ... }
  let pileOpen = null;    // pila que se está viendo en la ventana
  let dialogOpen = false; // la ventana compartida muestra un diálogo del campo
  let escModal = false;   // la tecla Escape cerró una ventana (no debe cancelar nada más)
  let chainFolded = false; // franja de la cadena plegada (móvil)
  let logSeen = 0;        // entradas del registro ya mostradas (para bajar al final cuando hay nuevas)
  let oppQueued = null;   // respuesta del rival que se muestra al volver a la pestaña del campo
  let revealed = {};      // "Ver mano" del rival, por duelo (S.duelId)
  let recorded = null;    // { duelId, id }: intento ya guardado de este duelo (si se termina otra vez, se actualiza)

  const decks = () => window.YGO.builder.decks();
  const blank = () => {
    const zones = {};
    FIELD_ZONES.forEach((z) => { zones[z] = []; });
    return { deck: [], hand: [], extra: [], gy: [], ban: [], zones, lp: 8000, turnDraws: 0, turnState: newTurnState(), chain: [], log: [], opp: null };
  };
  const arr = (x) => (Array.isArray(x) ? x : []);

  /* ---------- Reglas (js/rules.js) ----------
   * Todas las consultas pasan por aquí: si el módulo falta o falla, el campo sigue funcionando sin revisar nada. */
  const rules = () => window.YGO.rules || null;
  const PASS = () => ({ ok: true, errors: [], warnings: [] });
  const fail = (...errors) => ({ ok: false, errors, warnings: [] });

  /** Consulta pura: devuelve fallback si la función no existe, falla o no responde nada. */
  function ask(name, args, fallback) {
    const R = rules();
    if (R && typeof R[name] === 'function') {
      try {
        const v = R[name].apply(R, args);
        if (v !== undefined && v !== null) return v;
      } catch (err) { console.warn('YGO.rules.' + name + ' falló', err); }
    }
    return typeof fallback === 'function' ? fallback() : fallback;
  }
  /** Llama una función de las reglas que cambia S; la versión local solo se usa si no existe o falla. */
  function run(name, args, fallback) {
    const R = rules();
    if (R && typeof R[name] === 'function') {
      try { return R[name].apply(R, args); } catch (err) { console.warn('YGO.rules.' + name + ' falló', err); }
    }
    return fallback();
  }

  /** Veredicto { ok, errors, warnings } con listas limpias, aunque las reglas respondan algo incompleto. */
  function verdict(v) {
    v = v && typeof v === 'object' ? v : {};
    const list = (x) => (Array.isArray(x) ? x : x ? [x] : []).filter(Boolean).map(String);
    const out = { ok: true, errors: list(v.errors), warnings: list(v.warnings) };
    if (v.ok === false && !out.errors.length) out.errors.push('Las reglas no permiten esta jugada.');
    out.ok = !out.errors.length;
    return out;
  }
  /** Junta varios veredictos sin repetir mensajes. */
  function merge(...vs) {
    const out = { ok: true, errors: [], warnings: [] };
    vs.forEach((x) => {
      if (!x) return;
      const v = verdict(x);
      v.errors.forEach((m) => { if (!out.errors.includes(m)) out.errors.push(m); });
      v.warnings.forEach((m) => { if (!out.warnings.includes(m)) out.warnings.push(m); });
    });
    out.ok = !out.errors.length;
    return out;
  }

  const checkSummon = (req) => verdict(ask('checkSummon', [S, req], PASS));
  // Un monstruo con sus efectos negados (Effect Veiler, Infinite Impermanence) no los activa ese turno: si las reglas
  // ya lo dicen, merge no repite el mensaje
  const checkActivation = (req) => merge(verdict(ask('checkActivation', [S, req], PASS)), negatedVerdict(req.uid));
  const checkPosition = (uid, to) => verdict(ask('checkPosition', [S, uid, { to }], PASS));
  const checkPlacement = (st, uid, zone, opts) => verdict(ask('checkPlacement', [st, uid, zone, opts || {}], () => localPlacement(st, uid, zone)));
  /** Movimiento manual (p. ej. del Mazo a la mano con Droll & Lock Bird activo). */
  const checkMove = (uid, dest, opts) => verdict(ask('checkMove', [S, uid, dest, opts || {}], () => localCheckMove(uid, dest)));

  /** Sin YGO.rules.checkMove: solo el bloqueo de Droll & Lock Bird ("no se añaden cartas del Mazo a la mano"). */
  function localCheckMove(uid, dest) {
    const loc = locate(uid);
    const lock = arr(S.turnState.locks).find((l) => l && l.kind === 'noDeckAdd');
    if (loc && loc.area === 'deck' && dest === 'hand' && lock) {
      return fail('Por ' + q(lock.source || 'Droll & Lock Bird') + ', este turno no se pueden añadir cartas del Mazo a la mano.');
    }
    return PASS();
  }
  /** Efectos negados este turno por el rival (inst.negated = { turn, by }). */
  const isNegated = (inst) => !!(inst && inst.negated && inst.negated.turn === S.turnState.turn);
  const byText = (by) => (!by ? '' : String(by).includes('«') ? String(by) : q(by));
  function negatedVerdict(uid) {
    const f = uid && find(uid);
    if (!f || f.loc.area !== 'field' || !isNegated(f.inst)) return null;
    return fail('Los efectos de ' + q(f.c.name) + ' están negados este turno (por ' + byText(f.inst.negated.by) + ').');
  }

  /** Revisión mínima de zonas para cuando no hay módulo de reglas. */
  function localPlacement(st, uid, zone) {
    const loc = locate(uid, st);
    const c = loc && cardOf(loc.list[loc.index]);
    if (!c || !st.zones[zone]) return PASS();
    const errors = [];
    if (st.zones[zone].length) errors.push('Esa zona ya está ocupada.');
    if (zone === 'fz' && !(c.type & T.FIELD)) errors.push('La Zona de Campo es solo para Mágicas de Campo.');
    if (isMonsterZone(zone) && !db.isMonster(c)) errors.push('En esa zona solo van monstruos.');
    return { ok: !errors.length, errors, warnings: [] };
  }

  function linkedZones() {
    const v = ask('linkedZones', [S], null);
    return v instanceof Set ? v : new Set(Array.isArray(v) ? v : []);
  }

  function materialsInfo(c) {
    const pm = ask('parseMaterials', [c], null) || {};
    return { summary: pm.summary ? String(pm.summary) : '', text: pm.text ? String(pm.text) : '', understood: pm.understood !== false && !!pm.summary, blocked: !!pm.blocked };
  }
  /** Forma propia de invocarse ("You can Special Summon this card (from your hand)..." o "Must be Special Summoned ... by ..."). */
  function procedureOf(c) {
    const p = ask('procedureOf', [c], null);
    return p && typeof p === 'object' && p.text ? p : null;
  }
  /** Nivel actual de un monstruo en juego (inst.level si un efecto lo cambió). */
  const levelOf = (inst, c) => (inst && typeof inst.level === 'number' ? inst.level : c.lv);

  function effectsOf(c) {
    const list = ask('effectsOf', [c], null);
    if (Array.isArray(list)) return list.filter((x) => x && typeof x === 'object');
    // Sin reglas: todo el texto como un solo efecto
    const st = !db.isMonster(c);
    return [{ index: 1, text: c.desc, html: view.formatText(c), kind: st ? 'activation' : 'ignition', speed: st && db.isTrap(c) ? 2 : 1, optKey: null }];
  }

  /* ---------- Turno, fases y registro ---------- */
  const phases = () => { const R = rules(); return R && Array.isArray(R.PHASES) && R.PHASES.length ? R.PHASES : PHASES; };
  const phaseName = (k) => (phases().find((p) => p[0] === k) || [k, k])[1];
  const strict = () => prefs.fieldStrict !== false;

  /** opts.second: vas segundo (turno 2, tu turno, con Fase de Batalla). */
  function newTurnState(opts) {
    const second = !!(opts && opts.second);
    const t = ask('newTurnState', second ? [{ second: true }] : [], () => ({ turn: 1, mine: true, phase: 'main1', normalSummons: 0, opt: {} }));
    // Si las reglas no conocen { second }, el turno 2 se pone aquí
    if (second && t && t.turn === 1) { t.turn = 2; t.mine = true; }
    return t;
  }
  /** Completa estados viejos (fotos de deshacer o partidas de antes) que no traen turno, cadena ni registro. */
  function ensureState() {
    if (!S.turnState || typeof S.turnState !== 'object') S.turnState = newTurnState();
    const t = S.turnState;
    if (typeof t.turn !== 'number') t.turn = 1;
    if (typeof t.mine !== 'boolean') t.mine = true;
    if (!t.phase) t.phase = 'main1';
    if (!t.opt || typeof t.opt !== 'object') t.opt = {};
    if (!Array.isArray(S.chain)) S.chain = [];
    if (!Array.isArray(S.log)) S.log = [];
  }

  // Versiones locales de los cambios de fase (solo si no hay reglas)
  function localNextPhase(st) {
    const keys = phases().map((p) => p[0]);
    const i = keys.indexOf(st.turnState.phase);
    if (i < 0 || i >= keys.length - 1) localPassTurn(st);
    else st.turnState.phase = keys[i + 1];
  }
  function localPassTurn(st) {
    const t = st.turnState;
    t.turn += 1;
    t.mine = !t.mine;
    t.phase = 'draw';
    t.normalSummons = 0;
    t.opt = {};
    st.chain = [];
  }

  /** Anota una jugada. Si el veredicto tiene errores queda como ilegal; los avisos se guardan aparte. */
  function pushLog(entry, v) {
    const t = S.turnState;
    const e = { turn: t.turn, mine: t.mine, phase: t.phase, kind: 'manual', text: '', illegal: false, reasons: [] };
    Object.keys(entry || {}).forEach((k) => { if (entry[k] !== undefined && entry[k] !== null) e[k] = entry[k]; });
    if (v && !v.ok) {
      e.illegal = true;
      if (!Array.isArray(e.reasons) || !e.reasons.length) e.reasons = v.errors.slice();
    }
    if (v && v.warnings.length && !(Array.isArray(e.warnings) && e.warnings.length)) e.warnings = v.warnings.slice();
    S.log.push(e);
    return e;
  }
  const logManual = (text, v) => pushLog({ kind: 'manual', text: 'Movimiento manual: ' + text }, v || null);

  /** Avisa a las reglas (contadores del turno) y deja la jugada en el registro una sola vez.
   * args: lo que recibe la función de las reglas después de S (p. ej. [req, v]). */
  function commit(name, args, v, fallbackEntry, localCount) {
    const before = S.log.length;
    const entry = run(name, [S].concat(args), () => { if (localCount) localCount(); return null; });
    if (S.log.length > before) {
      // Las reglas ya la anotaron: solo se completa con el veredicto
      const e = S.log[S.log.length - 1];
      if (!e.text) e.text = fallbackEntry.text;
      if (!e.kind) e.kind = fallbackEntry.kind;
      if (!v.ok) { e.illegal = true; if (!Array.isArray(e.reasons) || !e.reasons.length) e.reasons = v.errors.slice(); }
      if (v.warnings.length && !(Array.isArray(e.warnings) && e.warnings.length)) e.warnings = v.warnings.slice();
      return e;
    }
    const base = entry && typeof entry === 'object' && entry.text ? Object.assign({}, fallbackEntry, entry) : fallbackEntry;
    return pushLog(base, v);
  }

  /* ---------- Estado ---------- */
  function snapshot() {
    history.push(JSON.stringify(S));
    if (history.length > 150) { history.shift(); histBase++; }
  }
  function undo() {
    if (!history.length) { toast('No hay nada que deshacer'); return; }
    S = JSON.parse(history.pop());
    selected = null;
    pending = null;
    render();
  }

  /** ¿Hay jugadas anotadas después de repartir? (el robo de quien va segundo no cuenta) */
  const hasPlays = () => !!(S && Array.isArray(S.log) && S.log.length > (Number(S.setupLog) || 0));
  /** Antes de borrar una partida con jugadas anotadas, pregunta. */
  function confirmRestart(go) {
    if (!hasPlays()) { go(); return; }
    openDialog('¿Empezar un duelo nuevo?', '<p class="hint">Se borra la partida actual: el campo, la cadena y el registro de jugadas.</p>',
      [{ label: 'Cancelar' }, { label: 'Nuevo duelo', kind: 'primary', action: go }]);
  }

  /** Duelo nuevo. handIds/restIds: mano y mazo exactos (si no, se reparte al azar).
   * opts: { second, bot: { enabled, count, mode, pool, seed, forceHand } }; sin opts.bot se usan las preferencias. */
  function newDuel(handIds, restIds, opts) {
    opts = opts || {};
    const second = opts.second !== undefined ? !!opts.second : !!freshPrefs().fieldSecond;
    // Una ventana del campo que quedó abierta (p. ej. "El rival responde" del duelo anterior) ya no vale
    if (dialogOpen || pileOpen) closeModal();
    S = blank();
    history = [];
    histBase = 0;
    selected = null;
    pending = null;
    logSeen = 0;
    oppQueued = null;
    S.duelId = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    S.turnState = newTurnState({ second });
    if (handIds) {
      S.hand = handIds.map(game.instance);
      S.deck = game.shuffle(restIds.map(game.instance));
    } else {
      S.deck = game.shuffle(d.main.map(game.instance));
      S.hand = S.deck.splice(0, 5);
    }
    S.extra = d.extra.map(game.instance);
    if (second) secondDraw(!!handIds && handIds.length >= 6);
    const cfg = botConfig(opts.bot);
    S.opp = makeOpponent(cfg);
    // Para "Misma mano, otras handtraps" y para cambiar entre Primero y Segundo con la misma mano
    S.start = {
      deckId: d.id, hand: S.hand.map((x) => x.id), second,
      bot: { enabled: !!S.opp, count: cfg.count, mode: cfg.mode, pool: cfg.pool || null },
    };
    render();
    botEvent({ type: 'start' });
    // Lo que se anotó al repartir (el robo de quien va segundo, la respuesta del rival al empezar) no cuenta como jugada tuya
    S.setupLog = S.log.length;
  }

  /** Vas segundo: en la Fase de Robo robas 1 (si la mano ya trae 6 cartas, la 6ª cuenta como la robada). */
  function secondDraw(given) {
    const t = S.turnState;
    t.phase = 'draw';
    let card = null;
    if (given) card = S.hand[S.hand.length - 1];
    else if (S.deck.length) { card = S.deck.shift(); S.hand.push(card); }
    pushLog({ kind: 'draw', text: 'Vas segundo · Fase de Robo: robas ' + (card ? q(nameById(card.id)) : 'nada (el mazo está vacío)') });
    t.phase = 'main1';
  }
  /** Mazo principal sin las cartas de la mano (con sus copias). */
  function restOf(handIds) {
    const pool = d.main.slice();
    handIds.forEach((id) => { const i = pool.indexOf(id); if (i >= 0) pool.splice(i, 1); });
    return pool;
  }

  /** Busca una carta por uid (en S o en otro estado). Devuelve { area, zone, index, list } */
  function locate(uid, st) {
    st = st || S;
    for (const a of ['hand', ...PILES]) {
      const i = st[a].findIndex((c) => c.uid === uid);
      if (i >= 0) return { area: a, index: i, list: st[a] };
    }
    for (const z of FIELD_ZONES) {
      const i = st.zones[z].findIndex((c) => c.uid === uid);
      if (i >= 0) return { area: 'field', zone: z, index: i, list: st.zones[z] };
    }
    return null;
  }
  /** Carta por uid con su ubicación: { loc, inst, c } */
  function find(uid) {
    const loc = uid && locate(uid);
    if (!loc) return null;
    const inst = loc.list[loc.index];
    return { loc, inst, c: cardOf(inst) };
  }
  const q = (name) => '«' + name + '»';
  /** Lista en español: "A", "A y B", "A, B y C". */
  const listEs = (xs) => (xs.length > 1 ? xs.slice(0, -1).join(', ') + ' y ' + xs[xs.length - 1] : xs.join(''));
  /** "1 carta", "3 cartas". */
  const nOf = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');
  const nameById = (id) => { const c = db.get(id); return c ? c.name : 'Carta ' + id; };
  const nameOf = (uid) => { const f = find(uid); return f ? (f.c ? f.c.name : nameById(f.inst.id)) : '?'; };

  /* ---------- Fichas (Primal Being Token de Nibiru) ----------
   * inst.token = { name, atk, def, level, attribute, race }. No están en la base de cartas (o bot.js las registra
   * con un código virtual): se arma una carta con sus datos. Desaparecen al dejar el campo. */
  const ATTR_BITS = { EARTH: 0x1, WATER: 0x2, FIRE: 0x4, WIND: 0x8, LIGHT: 0x10, DARK: 0x20, DIVINE: 0x40 };
  const RACE_BITS = { WARRIOR: 0x1, SPELLCASTER: 0x2, FAIRY: 0x4, FIEND: 0x8, ZOMBIE: 0x10, MACHINE: 0x20, AQUA: 0x40, PYRO: 0x80, ROCK: 0x100, DRAGON: 0x2000, BEAST: 0x4000 };
  const statNum = (n) => (typeof n === 'number' && n >= 0 ? n : Number(n) >= 0 ? Number(n) : 0);
  function tokenCard(inst) {
    const t = inst.token || {};
    const base = db.get(inst.id) || {};
    const bits = (v, map, dflt) => (typeof v === 'number' ? v : map[String(v || '').toUpperCase()] || dflt);
    const lv = Number(t.level) || base.lv || 1;
    return Object.assign({}, base, {
      id: inst.id, name: t.name || base.name || 'Ficha', type: T.MONSTER | T.NORMAL | T.TOKEN, atk: statNum(t.atk), def: statNum(t.def),
      level: lv, lv, race: bits(t.race, RACE_BITS, base.race || 0x100), attribute: bits(t.attribute, ATTR_BITS, base.attribute || 0x10),
      isLink: false, scaleL: 0, scaleR: 0, desc: base.desc || 'Ficha creada por un efecto. Desaparece cuando deja el campo.', isToken: true,
    });
  }
  /** Carta de una instancia (las fichas, con sus propios datos). */
  const cardOf = (inst) => (!inst ? null : inst.token ? tokenCard(inst) : db.get(inst.id));
  function tokenTile(c, attrs) {
    return '<div class="card f-token" data-id="' + esc(c.id) + '" title="' + esc(c.name) + '" ' + (attrs || '') + '><div class="face"><span class="nm">'
      + esc(c.name) + '</span><span class="lv">★' + c.lv + '</span><span class="st">' + c.atk + '/' + c.def + '</span></div></div>';
  }
  function tokenDetail(c) {
    return '<div class="detail-art">' + tokenTile(c) + '</div><h2 class="detail-name">' + esc(c.name) + '</h2><div class="ctext">'
      + '<p class="ct-line">Ficha · ' + esc(db.raceName(c) || '') + ' · ' + esc(db.attributeName(c) || '') + ' · Nivel ' + c.lv + '</p>'
      + '<p class="ct-line">ATK ' + c.atk + ' / DEF ' + c.def + '</p><div class="ct-body"><p>' + esc(c.desc) + '</p></div></div>';
  }
  /** Las fichas fuera del campo (o como material) desaparecen. Devuelve cuántas se quitaron. */
  function sweepTokens() {
    let n = 0;
    ['hand', ...PILES].forEach((a) => { const before = S[a].length; S[a] = S[a].filter((x) => !x.token); n += before - S[a].length; });
    FIELD_ZONES.forEach((z) => {
      const st = S.zones[z];
      const keep = st.filter((x, i) => i === 0 || !x.token);
      n += st.length - keep.length;
      S.zones[z] = keep;
    });
    return n;
  }
  const fromKey = (loc) => (loc.area === 'field' ? loc.zone : loc.area);

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
  /** La carta deja el campo: vuelve boca arriba y olvida cuándo se invocó. Cómo se invocó queda en properSummon
   * (las reglas lo miran para revivir monstruos del Extra Deck o de Ritual); se borra al volver a la mano o al mazo. */
  const resetCard = (c) => {
    c.faceDown = false;
    c.def = false;
    // Si ya se invocó bien antes (p. ej. Sincronía y luego revivido), conserva esa primera forma
    if (c.summonMethod && (!c.properSummon || c.properSummon === 'special')) c.properSummon = c.summonMethod;
    delete c.summonedTurn; delete c.summonMethod; delete c.setTurn; delete c.positionChangedTurn; delete c.extraFaceUp; delete c.level;
    delete c.negated; // la negación de Veiler o Impermanence es solo mientras está en el campo
    return c;
  };
  /** Vuelve a la mano, al mazo o boca abajo al Extra Deck: ya no cuenta cómo se invocó antes. */
  const forget = (c) => { delete c.properSummon; return c; };
  /** Regla del Péndulo: un monstruo de Péndulo en el campo que iría al cementerio se coloca boca arriba en el Extra Deck,
   * como Monstruo o como Mágica (Escala, equipada o colocada boca abajo) y aunque esté boca abajo.
   * No cuentan los materiales Xyz ni las cartas cuya invocación o activación fue negada (opts.negated). */
  const pendulumToExtra = (from, c) => !!(from && from.area === 'field' && from.index === 0 && c && db.isMonster(c)
    && c.type & T.PENDULUM && (isMonsterZone(from.zone) || ST.includes(from.zone)));
  const PEND_TOAST = 'Los monstruos de Péndulo que dejan el campo van boca arriba al Extra Deck';
  // Xyz/Link de Péndulo: solo se pueden Invocar por Péndulo desde el Extra Deck si su texto lo dice (no tienen Nivel)
  const PEND_FACEUP_LEVEL = /If you can Pendulum Summon Level (\d+), you can Pendulum Summon this face-up card in your Extra Deck/i;
  const pendFromExtra = (c) => !(c.type & (T.XYZ | T.LINK)) || PEND_FACEUP_LEVEL.test(c.desc || '');
  /** Un Péndulo boca arriba en el Extra Deck: solo se invoca por Péndulo y puede activar efectos desde ahí. */
  const faceUpInExtra = (loc, inst) => !!(loc && loc.area === 'extra' && inst && inst.extraFaceUp);

  /** Mueve una carta a mano (sin declarar nada; queda en el registro como movimiento manual).
   * dest: 'hand' | pila | zona; opts: { faceDown, def, bottom, overlay, attach } */
  function move(uid, dest, opts) {
    opts = opts || {};
    const loc = locate(uid);
    if (!loc) return false;
    // Del Mazo a la mano (buscar una carta): las reglas revisan bloqueos como el de Droll & Lock Bird
    if (loc.area === 'deck' && dest === 'hand') {
      const v = checkMove(uid, dest, opts);
      gate(v, () => {
        if (moveNow(uid, dest, opts, v)) botEvent({ type: 'add', uids: [uid], from: 'deck' });
      });
      return false;
    }
    return moveNow(uid, dest, opts, null);
  }
  /** v: veredicto de checkMove (si la jugada fue ilegal, queda marcada en el registro). */
  function moveNow(uid, dest, opts, v) {
    const loc = locate(uid);
    if (!loc) return false;
    const c = cardOf(loc.list[loc.index]);
    // Una ficha que deja el campo desaparece
    if (loc.list[loc.index].token && !FIELD_ZONES.includes(dest)) {
      snapshot();
      if (loc.area === 'field' && loc.index === 0) takeStack(uid).slice(1).forEach((m) => S.gy.push(resetCard(m)));
      else loc.list.splice(loc.index, 1);
      logManual(q(c.name) + ' deja el campo y desaparece');
      selected = null;
      render();
      return true;
    }
    if (FIELD_ZONES.includes(dest)) {
      const target = S.zones[dest];
      if (target.length && !opts.overlay && !opts.attach) { toast('Esa zona ya está ocupada'); return false; }
      if ((opts.overlay || opts.attach) && (!target.length || !isMonsterZone(dest))) { toast('Elige un monstruo en el campo'); return false; }
      if (target.length && target.some((x) => x.uid === uid)) return false;
      if (dest === 'fz' && !(c.type & T.FIELD)) { toast('La Zona de Campo es solo para Mágicas de Campo'); return false; }
      if (isMonsterZone(dest) && !db.isMonster(c) && !opts.attach) { toast('Solo monstruos en esa zona'); return false; }
    }
    else if (opts.overlay || opts.attach) { toast('Elige un monstruo en el campo'); return false; }
    snapshot();
    const host = (opts.overlay || opts.attach) ? nameById(S.zones[dest][0].id) : '';
    // Un monstruo que cambia de zona dentro del campo se lleva sus materiales Xyz
    const whole = loc.area === 'field' && loc.index === 0 && FIELD_ZONES.includes(dest) && !opts.attach;
    const stack = whole ? takeStack(uid) : null;
    const { card } = stack ? { card: stack[0] } : detach(uid);
    const under = stack ? stack.slice(1) : [];
    let where = placeName(dest);
    if (dest === 'hand') { S.hand.push(forget(resetCard(card))); }
    else if (dest === 'deck') {
      forget(resetCard(card));
      if (opts.bottom) S.deck.push(card); else S.deck.unshift(card);
      if (opts.shuffle) game.shuffle(S.deck);
      where = opts.shuffle ? 'Mazo (barajado)' : opts.bottom ? 'Mazo (abajo)' : 'Mazo (arriba)';
    }
    else if (dest === 'extra') {
      resetCard(card);
      if (!db.isExtra(c) && !(c.type & T.PENDULUM)) { S.hand.push(forget(card)); toast('Esa carta no va en el Extra Deck: volvió a la mano'); where = 'Mano'; }
      else {
        // Un Péndulo del Mazo Principal solo puede estar boca arriba en el Extra Deck; uno de Fusión/Sincronía/Xyz
        // vuelve boca abajo (así regresa cuando un efecto lo devuelve) salvo que se pida boca arriba
        const pend = !!(c.type & T.PENDULUM);
        card.extraFaceUp = pend && (!db.isExtra(c) || opts.faceUp === true);
        if (!card.extraFaceUp) forget(card);
        S.extra.push(card);
        if (pend) where = 'Extra Deck (boca ' + (card.extraFaceUp ? 'arriba' : 'abajo') + ')';
      }
    }
    else if (dest === 'gy' && !opts.negated && pendulumToExtra(loc, c)) {
      // "Al cementerio" (destruido, sacrificado, enviado...) de un Péndulo en el campo
      resetCard(card).extraFaceUp = true;
      S.extra.push(card);
      where = 'Extra Deck (boca arriba)';
      toast(PEND_TOAST);
    }
    else if (dest === 'gy' || dest === 'ban') {
      resetCard(card);
      // Un Péndulo cuya invocación o activación fue negada sí va al cementerio
      if (opts.negated && dest === 'gy') where = 'Cementerio (invocación o activación negada)';
      // Las cartas del Extra Deck vuelven al Extra si se mandan a la mano o al mazo; al cementerio van normal
      S[dest].push(card);
    } else {
      // Dentro del campo conserva cómo se invocó; si entra desde fuera, entra sin declarar
      if (loc.area !== 'field') resetCard(card);
      card.faceDown = !!opts.faceDown;
      card.def = !!opts.def;
      if (opts.attach) { resetCard(card); S.zones[dest].push(card); where = 'material de ' + q(host); }
      else if (opts.overlay) {
        // Encima del monstruo: el de abajo y sus materiales quedan como materiales (y los que traía la carta también)
        S.zones[dest] = [card].concat(under.map(resetCard), S.zones[dest].map(resetCard));
        where = placeName(dest) + ', encima de ' + q(host);
      } else S.zones[dest].push(card, ...under);
      if (under.length && !opts.overlay) where += ' (con sus ' + under.length + ' material' + (under.length === 1 ? '' : 'es') + ')';
    }
    // Una carta del Extra Deck que vuelve a la mano o al mazo regresa al Extra
    if ((dest === 'hand' || dest === 'deck') && db.isExtra(c)) {
      const arr = dest === 'hand' ? S.hand : S.deck;
      const i = arr.indexOf(card);
      arr.splice(i, 1);
      S.extra.push(card);
      where = 'Extra Deck';
      toast('Los monstruos del Extra Deck regresan al Extra Deck');
    }
    logManual(q(c.name) + ': ' + placeName(fromKey(loc)) + ' → ' + where, v);
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
    const cards = S.deck.splice(0, n);
    S.hand.push(...cards);
    pushLog({ kind: 'draw', text: 'Roba ' + cards.map((x) => q(nameById(x.id))).join(', ') });
    render();
  }

  /* ---------- Zonas posibles ---------- */
  /** Orden en que se prueban las zonas: los Link (y los Péndulo boca arriba del Extra) prefieren la Zona Extra. */
  function zoneOrder(c, area, method) {
    if (!db.isMonster(c)) return c.type & T.FIELD ? ['fz'] : ST.slice();
    if (c.type & T.LINK || (area === 'extra' && (method === 'pendulum' || !db.isExtra(c)))) return [...EMZ, ...MZ];
    if (db.isExtra(c)) return [...MZ, ...EMZ];
    return MZ.slice();
  }

  /** Copia de S como quedaría tras retirar los materiales (para saber qué zonas quedan libres o apuntadas). */
  function without(uids) {
    if (!uids || !uids.length) return S;
    const st = JSON.parse(JSON.stringify(Object.assign({}, S, { log: [] })));
    uids.forEach((u) => {
      const loc = locate(u, st);
      if (!loc) return;
      if (loc.area === 'field' && loc.index === 0) st.gy.push(...st.zones[loc.zone].splice(0));
      else st.gy.push(...loc.list.splice(loc.index, 1));
    });
    return st;
  }

  /** Zonas donde la carta puede quedar (ya sin los materiales), en orden de preferencia. */
  function legalZones(uid, mats, method, opts) {
    const f = find(uid);
    if (!f) return [];
    const st = without(mats);
    return zoneOrder(f.c, f.loc.area, method)
      .filter((z) => !st.zones[z].length && checkPlacement(st, uid, z, Object.assign({ method }, opts)).ok);
  }
  /** Primera zona válida; si ninguna lo es, la primera libre (y las reglas dirán por qué no vale). */
  function autoZone(uid, mats, method, opts) {
    const f = find(uid);
    if (!f) return null;
    const st = without(mats);
    return legalZones(uid, mats, method, opts)[0] || zoneOrder(f.c, f.loc.area, method).find((z) => !st.zones[z].length) || null;
  }
  /** Zona automática de una invocación: la primera donde las reglas no ven errores
   * (p. ej. "a tu Zona de Monstruo central" de Elfnote Lucina); si no hay, la de autoZone. */
  function bestZone(req) {
    const zones = legalZones(req.uid, req.materials, req.method);
    return zones.find((z) => checkSummon(Object.assign({}, req, { zone: z })).ok) || zones[0] || autoZone(req.uid, req.materials, req.method);
  }

  const scalesSet = () => ['st0', 'st4'].every((z) => {
    const top = S.zones[z][0];
    const c = top && !top.faceDown && db.get(top.id);
    return !!(c && db.isMonster(c) && c.type & T.PENDULUM);
  });

  /* ---------- Juego: ventana de "jugada ilegal" ---------- */
  /** Hace la jugada si es legal. Si no: en modo estricto pregunta; si no, la hace y queda marcada en rojo. */
  function gate(v, perform) {
    if (v.ok || !strict()) { perform(); return; }
    illegalDialog(v, perform);
  }
  function checksHtml(v, okText) {
    const items = v.errors.map((m) => '<li class="err">' + esc(m) + '</li>')
      .concat(v.warnings.map((m) => '<li class="warn">' + esc(m) + '</li>'));
    if (!items.length && okText) items.push('<li class="ok">' + esc(okText) + '</li>');
    return items.length ? '<ul class="checks">' + items.join('') + '</ul>' : '';
  }
  function illegalDialog(v, perform) {
    openDialog('Jugada ilegal', '<div class="illegal-box"><p>Según las reglas, esta jugada no se puede hacer:</p>' + checksHtml(v)
      + '<p class="hint">Si sabes que es correcta (por un efecto que el sistema no reconoce), puedes hacerla igual: quedará marcada en rojo en el registro.</p></div>',
    [{ label: 'Hacerla igual', kind: 'ghost-danger', action: perform }, { label: 'Cancelar', kind: 'primary' }]);
  }
  /** Después de una jugada declarada: redibuja y avisa si fue ilegal o tiene advertencias. */
  function afterPlay(v) {
    render();
    if (!v.ok) toast('Jugada ilegal: ' + v.errors[0], 'bad');
    else if (v.warnings.length) toast(v.warnings[0], 'warn');
  }

  /* ---------- Invocaciones ---------- */
  function tributesNeeded(c) {
    if (!db.isMonster(c) || db.isExtra(c)) return 0;
    return c.lv >= 7 ? 2 : c.lv >= 5 ? 1 : 0;
  }
  const isNormalMethod = (m) => m === 'normal' || m === 'set' || m === 'tribute' || m === 'tributeSet';

  /** Formas de invocar la carta desde donde está. Cada una: { method, label, action } */
  function summonOptions(uid, zone) {
    const f = find(uid);
    if (!f || !db.isMonster(f.c)) return [];
    const { c, inst, loc } = f;
    const out = [];
    const add = (method, label) => out.push({ method, label, action: () => declareSummon(uid, method, { zone }) });
    const pend = !!(c.type & T.PENDULUM);
    // Procedimiento propio que pide cartas ("Must be Special Summoned ... by sending 2 monsters ..."): se eligen como materiales
    const pr = procedureOf(c);
    const addProc = () => {
      if (pr && pr.costs && (!pr.from.length || pr.from.includes(loc.area))) {
        out.push({ method: 'special', proc: true, label: 'Invocación Especial por su procedimiento', action: () => startSummon('special', uid, { zone }) });
      }
    };
    if (loc.area === 'hand' && !db.isExtra(c)) {
      if (c.type & T.RITUAL) add('ritual', METHOD.ritual);
      else { add('normal', 'Invocación Normal'); add('set', 'Colocar (boca abajo)'); }
      addProc();
      add('special', 'Invocación Especial…');
      if (pend && scalesSet()) add('pendulum', 'Invocación por Péndulo');
    } else if (loc.area === 'extra') {
      const blocked = materialsInfo(c).blocked; // "Cannot be Synchro Summoned" (p. ej. Ultimaya Tzolkin)
      // Boca arriba en el Extra Deck (un Péndulo que dejó el campo) solo se puede Invocar por Péndulo
      const faceUp = db.isExtra(c) && faceUpInExtra(loc, inst);
      [[T.SYNCHRO, 'synchro'], [T.XYZ, 'xyz'], [T.LINK, 'link'], [T.FUSION, 'fusion']].forEach(([bit, m]) => {
        if (db.isExtra(c) && c.type & bit && !blocked && !faceUp) add(m, METHOD[m]);
      });
      addProc();
      if (pend && scalesSet() && (!db.isExtra(c) || (inst.extraFaceUp && pendFromExtra(c)))) add('pendulum', 'Invocación por Péndulo');
      add('special', 'Invocación Especial…');
    } else {
      if (c.type & T.RITUAL && loc.area !== 'ban') add('ritual', METHOD.ritual);
      addProc();
      add('special', 'Invocación Especial…');
    }
    return out;
  }

  function declareSummon(uid, method, opts) {
    opts = opts || {};
    if (method === 'normal' || method === 'set') normalSummon(uid, method === 'set', opts.zone);
    else if (method === 'special') openSpecial(uid, opts);
    else startSummon(method, uid, opts);
  }

  /** Invocación Normal o Colocación: si el monstruo pide sacrificios, se pasa a elegirlos. */
  function normalSummon(uid, set, zone) {
    const f = find(uid);
    if (!f) return;
    const need = tributesNeeded(f.c);
    if (need) { startSummon(set ? 'tributeSet' : 'tribute', uid, { zone, need }); return; }
    submitSummon({ method: set ? 'set' : 'normal', uid, zone: zone || null, materials: [], position: set ? 'set' : 'atk' });
  }

  function verifySummon(req) {
    let v = checkSummon(req);
    if (req.selfEffect) {
      // "Por su propio efecto" en una carta cuyo texto no la invoca a sí misma
      const f = find(req.uid);
      if (f && !/Special Summon (?:this card|it)\b/i.test(f.c.desc || '')) {
        v = merge(v, { warnings: [q(f.c.name) + ' no tiene un efecto que la invoque a sí misma: elige qué carta lo permite.'] });
      }
    }
    if (!req.zone) return merge(v, fail('No queda ninguna zona libre para esta carta.'));
    return merge(v, checkPlacement(without(req.materials), req.uid, req.zone, { method: req.method, faceDown: req.position === 'set' }));
  }

  function submitSummon(req) {
    if (!req.zone) req.zone = bestZone(req);
    if (!req.zone) { toast('No quedan zonas de monstruo libres'); return; }
    if (without(req.materials).zones[req.zone].length) { toast('Esa zona ya está ocupada'); return; }
    const v = verifySummon(req);
    gate(v, () => performSummon(req, v));
  }

  /** Manda un material a su destino. Un Péndulo que deja el campo hacia el cementerio va boca arriba al Extra Deck. */
  function sendMaterial(uid, dest) {
    const r = detach(uid);
    if (!r) return;
    if (r.card.token) return 'gone'; // una ficha (p. ej. material de un Link) desaparece
    const card = resetCard(r.card);
    const c = db.get(card.id);
    if (dest === 'gy' && pendulumToExtra(r.from, c)) {
      card.extraFaceUp = true;
      S.extra.push(card);
      return 'extra';
    }
    if (dest === 'back') {
      // "devolverlos al Mazo/Extra Deck" (costos de algunos procedimientos, como Vidolium)
      forget(card);
      if (c && db.isExtra(c)) S.extra.push(card);
      else { S.deck.push(card); game.shuffle(S.deck); }
      return;
    }
    S[dest === 'ban' ? 'ban' : 'gy'].push(card);
  }
  /** Saca un monstruo del campo con todo lo que tiene debajo (para apilarlo como material Xyz). */
  function takeStack(uid) {
    const loc = locate(uid);
    if (!loc) return [];
    if (loc.area === 'field' && loc.index === 0) return loc.list.splice(0);
    const r = detach(uid);
    return r ? [r.card] : [];
  }
  function setPosition(inst, pos) {
    inst.faceDown = pos === 'set';
    inst.def = pos === 'def' || pos === 'set';
  }
  /** Deja la carta invocada en su zona con los datos que usan las reglas (turno y forma de invocación). */
  function placeSummoned(card, zone, method, position, under) {
    resetCard(card);
    setPosition(card, position);
    card.summonedTurn = S.turnState.turn;
    card.summonMethod = method;
    if (position === 'set') card.setTurn = S.turnState.turn;
    S.zones[zone] = [card].concat(under || [], S.zones[zone]);
  }

  function summonText(req) {
    const name = q(nameOf(req.uid));
    const mats = (req.materials || []).map((u) => q(nameOf(u)));
    let s = req.method === 'set' ? 'Coloca ' + name : req.method === 'tributeSet' ? 'Coloca por Sacrificio ' + name : METHOD[req.method] + ' de ' + name;
    if (mats.length) s += (req.method.startsWith('tribute') ? ' sacrificando ' : ' con ') + mats.join(', ');
    if (req.source) s += ' (por ' + req.source + ')';
    if (req.zone) s += ' en ' + placeName(req.zone);
    if (req.position === 'def') s += ', en DEF';
    return s;
  }

  function performSummon(req, v) {
    const f0 = find(req.uid);
    if (!f0) return;
    const from = {};
    from[req.uid] = fromKey(f0.loc);
    pending = null;
    selected = null;
    snapshot();
    // Primero se avisa a las reglas (ven el mismo estado que revisaron) y luego se mueven las cartas
    const e = commit('commitSummon', [req, v], v, { kind: 'summon', text: summonText(req) }, () => {
      if (isNormalMethod(req.method)) S.turnState.normalSummons = (Number(S.turnState.normalSummons) || 0) + 1;
    });
    // El texto de las reglas no dice la zona ni la posición: se agregan para que el registro sirva para repetir el combo
    if (req.zone && !String(e.text).includes(placeName(req.zone))) e.text += ' en ' + placeName(req.zone);
    if (req.position === 'def' && !/en DEF/.test(e.text)) e.text += ', en DEF';
    const mats = req.materials || [];
    let under = [];
    if (req.method === 'xyz') mats.forEach((m) => { under = under.concat(takeStack(m).map(resetCard)); });
    else {
      const toExtra = [];
      mats.forEach((m) => { const n = nameOf(m); if (sendMaterial(m, req.matDest === 'ban' || req.matDest === 'back' ? req.matDest : 'gy') === 'extra') toExtra.push(q(n)); });
      if (toExtra.length) { e.text += ' · ' + listEs(toExtra) + ' va' + (toExtra.length > 1 ? 'n' : '') + ' boca arriba al Extra Deck'; toast(PEND_TOAST); }
    }
    const r = detach(req.uid);
    if (r) placeSummoned(r.card, req.zone, req.method, req.position, under);
    afterPlay(v);
    botEvent({ type: 'summon', uids: [req.uid], method: req.method, from });
  }

  /** Entra en el modo de elegir materiales (o sacrificios, o las cartas de una Invocación por Péndulo). */
  function startSummon(method, uid, opts) {
    opts = opts || {};
    const f = find(uid);
    if (!f) return;
    closeModal();
    pending = {
      kind: 'summon', method, uid,
      picks: method === 'pendulum' ? [uid] : (opts.picks || []).filter((u) => u !== uid),
      zone: method === 'pendulum' ? null : opts.zone || null,
      zones: method === 'pendulum' && opts.zone ? [opts.zone] : [], // Péndulo: zonas tocadas, en orden
      position: method === 'tributeSet' ? 'set' : 'atk',
      matDest: 'gy',
      need: opts.need || 0,
      pm: PROCEDURES.includes(method) ? materialsInfo(f.c) : null,
      // Qué efecto permite la invocación: con una cadena abierta, tu último eslabón (p. ej. Elfnote Power Patron; nunca el del rival)
      src: method !== 'special' && !isNormalMethod(method) && ownTopCL() >= 0 ? 'chain:' + ownTopCL() : '',
      proc: method === 'special' ? procedureOf(f.c) : null, // Invocación Especial por su procedimiento (con costos)
    };
    selected = null;
    render();
  }
  /** Índice de tu eslabón más alto en la cadena (los del rival no Invocan por ti) o -1. */
  function ownTopCL() {
    for (let i = S.chain.length - 1; i >= 0; i--) if (S.chain[i] && S.chain[i].owner !== 'opp') return i;
    return -1;
  }
  /** Opciones "CLn · carta" de tus eslabones (sin los del rival). */
  const ownLinkOpts = (opt, sel) => S.chain.map((l, i) => (l.owner === 'opp' ? '' : opt('chain:' + i,
    'CL' + (i + 1) + ' · ' + nameById(l.id) + (l.effectIndex ? ' (efecto ' + l.effectIndex + ')' : ''), sel(i)))).join('');
  /** Texto y carta del efecto que permite la invocación: '' (procedimiento normal) | 'chain:i' | 'other'. */
  function sourceReq(src) {
    if (!src) return {};
    if (src === 'other') return { source: 'otro efecto' };
    const l = S.chain[Number(src.split(':')[1])];
    if (!l) return {};
    return { source: 'el efecto de ' + q(nameById(l.id)) + (l.effectIndex ? ' (efecto ' + l.effectIndex + ')' : ''), sourceUid: l.uid, sourceId: l.id };
  }

  function togglePick(uid) {
    const p = pending;
    if (uid === p.uid && p.method !== 'pendulum') { toast('Esa es la carta que vas a invocar'); return; }
    const i = p.picks.indexOf(uid);
    if (i >= 0) p.picks.splice(i, 1);
    else {
      // Por Péndulo solo se invoca desde la mano o boca arriba del Extra Deck (no del cementerio, el mazo ni desterradas)
      const f = p.method === 'pendulum' ? find(uid) : null;
      if (f && !(f.loc.area === 'hand' || (faceUpInExtra(f.loc, f.inst) && pendFromExtra(f.c)))) {
        toast('Solo monstruos de Péndulo de la mano o boca arriba del Extra Deck');
        return;
      }
      p.picks.push(uid);
    }
    render();
  }

  /** Toque sobre el tablero durante una invocación: elige material o zona de destino. */
  function pickZone(z) {
    const p = pending;
    if (PILES.includes(z)) { openPile(z); return; }
    const stack = S.zones[z];
    if (p.method === 'pendulum') {
      if (stack.length) { toast('Elige monstruos de la mano o del Extra Deck (boca arriba)'); return; }
      if (!isMonsterZone(z)) { toast('Elige una Zona de Monstruo'); return; }
      const i = p.zones.indexOf(z);
      if (i >= 0) p.zones.splice(i, 1); else p.zones.push(z);
      render();
      return;
    }
    if (stack.length) { togglePick(stack[0].uid); return; }
    if (!isMonsterZone(z)) { toast('Elige una Zona de Monstruo'); return; }
    p.zone = p.zone === z ? null : z;
    render();
  }

  function pickReq(p) {
    const req = {
      method: p.method, uid: p.uid, zone: p.zone, materials: p.picks.slice(),
      position: p.method === 'link' ? 'atk' : p.position,
    };
    if (p.method === 'fusion' || p.method === 'ritual' || p.method === 'special') req.matDest = p.matDest;
    if (p.method === 'special') {
      req.ownProcedure = true;
      if (p.proc && p.proc.index != null) req.effectIndex = p.proc.index;
      req.source = 'su propio procedimiento';
    } else Object.assign(req, sourceReq(p.src));
    if (!req.zone) req.zone = bestZone(req);
    return req;
  }

  function confirmSummon() {
    const p = pending;
    if (!p || p.kind !== 'summon') return;
    if (p.method === 'pendulum') { confirmPendulum(); return; }
    submitSummon(pickReq(p));
  }

  /* Invocación por Péndulo: varias cartas a la vez. Las zonas tocadas se usan en orden; las demás se eligen solas.
   * opts.taken (zonas ya repartidas en esta invocación) lo entiende checkPlacement de YGO.rules. */
  function pendAssign(p) {
    const manual = p.zones.slice();
    const asg = p.picks.filter((u) => find(u)).map((uid) => ({ uid, zone: manual.shift() || null }));
    const taken = asg.filter((a) => a.zone).map((a) => a.zone);
    const auto = asg.filter((a) => !a.zone);
    const fits = (uid, z, used) => !S.zones[z].length && !used.includes(z)
      && !(EMZ.includes(z) && used.some((u) => EMZ.includes(u)))
      && checkPlacement(S, uid, z, { method: 'pendulum', taken: used.slice() }).ok;
    // Zonas posibles de cada carta sin zona elegida: las del Extra Deck solo van a la Zona Extra o a una zona apuntada
    const cands = new Map(auto.map((a) => [a, zoneOrder(find(a.uid).c, find(a.uid).loc.area, 'pendulum').filter((z) => fits(a.uid, z, taken))]));
    // Las más limitadas primero (las del Extra Deck) y, si una combinación no deja sitio a otra carta, se prueba otra
    const order = auto.slice().sort((a, b) => cands.get(a).length - cands.get(b).length);
    const fill = (i, used) => {
      if (i >= order.length) return true;
      const a = order[i];
      for (const z of cands.get(a)) {
        if (!fits(a.uid, z, used)) continue;
        a.zone = z;
        if (fill(i + 1, used.concat(z))) return true;
        a.zone = null;
      }
      return false;
    };
    fill(0, taken.slice());
    return asg;
  }
  /** Es una sola invocación: req.uid/req.zone son la primera carta y req.uids/req.zones el grupo completo. */
  const pendReq = (p, asg) => Object.assign({
    method: 'pendulum', uid: asg[0].uid, zone: asg[0].zone, uids: asg.map((a) => a.uid), zones: asg.map((a) => a.zone),
    materials: [], position: p.position,
  }, sourceReq(p.src));

  function pendVerdict(p, asg) {
    if (!asg.length) return fail('Elige al menos un monstruo para invocar.');
    return merge(checkSummon(pendReq(p, asg)), ...asg.map((a) => (a.zone
      ? checkPlacement(S, a.uid, a.zone, { method: 'pendulum', taken: asg.filter((x) => x !== a && x.zone).map((x) => x.zone) })
      // El mismo texto que usan las reglas: así el aviso no sale dos veces
      : fail('No hay una zona válida libre para ' + q(nameOf(a.uid)) + '.'))));
  }

  function confirmPendulum() {
    const p = pending;
    const asg = pendAssign(p);
    if (!asg.length) { toast('Elige al menos un monstruo para invocar'); return; }
    if (asg.some((a) => !a.zone)) { toast('No quedan zonas libres para todas las cartas'); return; }
    const v = pendVerdict(p, asg);
    gate(v, () => performPendulum(p, asg, v));
  }

  function performPendulum(p, asg, v) {
    pending = null;
    selected = null;
    snapshot();
    const names = asg.map((a) => q(nameOf(a.uid)));
    // De dónde sale cada carta y a qué zona va: el registro sirve para repetir el combo
    const details = asg.map((a, i) => {
      const f = find(a.uid);
      return names[i] + (f && f.loc.area === 'extra' ? ' (del Extra Deck)' : '') + (a.zone ? ' en ' + placeName(a.zone) : '');
    });
    // Es una sola invocación: se avisa a las reglas una vez, con el grupo completo
    const e = commit('commitSummon', [pendReq(p, asg), v], v,
      { kind: 'summon', text: 'Invocación por Péndulo de ' + names.join(', ') + (p.position === 'def' ? ', en DEF' : '') }, null);
    if (String(e.text).includes(names.join(', '))) e.text = String(e.text).replace(names.join(', '), details.join(', '));
    else e.text += ' · ' + details.join(', ');
    if (p.position === 'def' && !/en DEF/.test(e.text)) e.text += ', en DEF';
    const from = {};
    asg.forEach((a) => { const f = find(a.uid); if (f) from[a.uid] = fromKey(f.loc); });
    asg.forEach((a) => {
      const r = detach(a.uid);
      if (r) placeSummoned(r.card, a.zone, 'pendulum', p.position);
    });
    afterPlay(v);
    botEvent({ type: 'summon', uids: asg.map((a) => a.uid), method: 'pendulum', from });
  }

  /* ---------- Invocación Especial (ventana) ---------- */
  function openSpecial(uid, opts) {
    opts = opts || {};
    const f = find(uid);
    if (!f) return;
    const c = f.c;
    const link = !!(c.type & T.LINK);
    const zones = legalZones(uid, [], 'special');
    const procs = effectsOf(c).filter((x) => x.kind === 'summon');
    // Zona automática para la opción marcada al abrir (con su procedimiento puede ser otra: Lucina va al centro)
    const lastCL = ownTopCL();
    const ownFirst = !!(opts.own || lastCL < 0) && procs.length;
    const auto = ownFirst ? bestZone({ method: 'special', uid, materials: [], ownProcedure: true, effectIndex: opts.effectIndex != null ? opts.effectIndex : procs[0].index })
      : zones[0] || autoZone(uid, [], 'special');
    // Cartas cuyo efecto puede dar la invocación: primero las de la cadena
    const opt = (v, label, sel) => '<option value="' + esc(v) + '"' + (sel ? ' selected' : '') + '>' + esc(label) + '</option>';
    let srcHtml = opt('own', 'Por su propio efecto o procedimiento', opts.own || lastCL < 0);
    if (lastCL >= 0) srcHtml += '<optgroup label="Por el efecto en la cadena">' + ownLinkOpts(opt, (i) => !opts.own && i === lastCL) + '</optgroup>';
    const fieldTops = FIELD_ZONES.map((z) => S.zones[z][0]).filter((x) => x && !x.faceDown);
    [['en el campo', fieldTops], ['en la mano', S.hand], ['en el cementerio', S.gy], ['desterradas', S.ban]].forEach(([where, list]) => {
      const seen = new Set();
      const items = list.filter((x) => x.uid !== uid && !seen.has(x.id) && seen.add(x.id));
      if (items.length) srcHtml += '<optgroup label="Por el efecto de una carta ' + where + '">' + items.map((x) => opt('card:' + x.uid, nameById(x.id))).join('') + '</optgroup>';
    });
    srcHtml += opt('other', 'Otra carta o efecto…');
    const zoneOpts = zones.slice();
    if (opts.zone && !zoneOpts.includes(opts.zone)) zoneOpts.push(opts.zone);
    const html = '<label class="field"><span>¿Qué efecto permite la invocación?</span><select id="sp-src">' + srcHtml + '</select></label>'
      + '<label class="field" id="sp-other-wrap" hidden><span>¿Cuál?</span><input id="sp-other" type="text" maxlength="80" placeholder="Nombre de la carta o del efecto"></label>'
      + (link ? '<p class="hint">Los monstruos Link siempre van en posición de ataque.</p>'
        : '<div class="field"><span>Posición</span><div class="seg" id="sp-pos" role="group" aria-label="Posición">'
        + '<button type="button" data-pos="atk" aria-pressed="true">ATK</button><button type="button" data-pos="def" aria-pressed="false">DEF</button>'
        + '<button type="button" data-pos="set" aria-pressed="false">Boca abajo</button></div></div>')
      + '<label class="field"><span>Zona</span><select id="sp-zone">'
      + opt('', 'Elegir zona (automática' + (auto ? ': ' + placeName(auto) : '') + ')', !opts.zone)
      + zoneOpts.map((z) => opt(z, placeName(z) + (zones.includes(z) ? '' : ' (no válida)'), z === opts.zone)).join('') + '</select></label>';
    const buttons = [];
    if (opts.drop && opts.zone) buttons.push({ label: 'Solo moverla', kind: 'link-btn', action: () => move(uid, opts.zone, {}) });
    buttons.push({ label: 'Cancelar' });
    buttons.push({
      label: 'Invocar', kind: 'primary', action: () => {
        const src = $('#sp-src').value;
        const req = { method: 'special', uid, zone: $('#sp-zone').value || null, materials: [], position: link ? 'atk' : (($('#sp-pos [aria-pressed="true"]') || {}).dataset || {}).pos || 'atk' };
        if (src === 'own') {
          // Con procedimiento propio ("You can Special Summon this card..."), las reglas lo revisan como tal
          if (procs.length) {
            req.ownProcedure = true;
            req.effectIndex = opts.effectIndex != null ? opts.effectIndex : procs[0].index;
            req.source = 'su propio procedimiento';
          } else if (procedureOf(c)) {
            // "Must be Special Summoned ... by ..." (sin efecto que diga "You can"): es su procedimiento, no un efecto
            req.ownProcedure = true;
            req.source = 'su propio procedimiento';
          } else { req.source = 'su propio efecto'; req.selfEffect = true; }
        } else if (src === 'other') req.source = $('#sp-other').value.trim() || 'otro efecto';
        else {
          const [k, v] = src.split(':');
          const link0 = k === 'chain' ? S.chain[Number(v)] : null;
          const id = link0 ? link0.id : (find(v) || { inst: {} }).inst.id;
          req.source = 'el efecto de ' + q(nameById(id)) + (link0 && link0.effectIndex ? ' (efecto ' + link0.effectIndex + ')' : '');
          req.sourceUid = link0 ? link0.uid : v;
          req.sourceId = id;
        }
        submitSummon(req);
      },
    });
    openDialog('Invocación Especial · ' + c.name, html, buttons);
    $('#sp-src').addEventListener('change', (e) => {
      $('#sp-other-wrap').hidden = e.target.value !== 'other';
      if (e.target.value === 'other') $('#sp-other').focus();
    });
    $('#sp-other').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#modal-foot .primary').click(); });
    $$('#sp-pos [data-pos]').forEach((b) => b.addEventListener('click', () => {
      $$('#sp-pos [data-pos]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    }));
  }

  /* ---------- Efectos y cadena ---------- */
  /** ¿Ya se gastó el límite por turno de este efecto? Usa fx.opts de YGO.rules si están; si no, optKey/optLimit. */
  function optUsed(fx, uid) {
    const t = S.turnState;
    const count = (store, key) => {
      const v = (store || {})[key];
      return typeof v === 'number' ? v : Array.isArray(v) ? v.length : v ? 1 : 0;
    };
    if (Array.isArray(fx.opts) && fx.opts.length) {
      return fx.opts.some((o) => {
        const key = o.perCopy ? String(o.key).replace('copy:', 'copy:' + uid) : o.key;
        return count(o.duel ? t.duel : t.opt, key) >= (Number(o.limit) || 1);
      });
    }
    return !!fx.optKey && count(t.opt, fx.optKey) >= (Number(fx.optLimit) || 1);
  }
  /** Activación de una Mágica/Trampa sin efecto propio al activarse (solo si las reglas no traen una). */
  function cardActivation(c) {
    const speed = c.type & T.COUNTER ? 3 : db.isTrap(c) || c.type & T.QUICKPLAY ? 2 : 1;
    return { index: 0, text: 'Activar la carta.', html: '', kind: 'activation', speed, optKey: null };
  }
  /** Activación de un monstruo Péndulo como Escala: para YGO.rules es el "efecto" 0 del monstruo. */
  const SCALE_FX = { index: 0, text: 'Activación como Escala de Péndulo', html: '', kind: 'activation', speed: 1, optKey: null, scale: true };
  const shortText = (fx) => {
    const s = String(fx.text || KIND[fx.kind] || '').replace(/\s+/g, ' ').trim();
    return s.length > 120 ? s.slice(0, 117) + '…' : s;
  };

  /** Botón "Activar" de una Mágica/Trampa (en la mano o colocada): si tiene una sola activación, va directo. */
  function activateCard(uid, zone) {
    const f = find(uid);
    if (!f) return;
    const acts = effectsOf(f.c).filter((x) => x.kind === 'activation');
    if (acts.length === 1) activate(uid, acts[0], zone);
    else if (!acts.length) activate(uid, cardActivation(f.c), zone);
    else openEffects(uid, { zone });
  }
  const activateScale = (uid, zone) => activate(uid, SCALE_FX, zone);

  function activationText(c, fx, loc, zone) {
    if (fx.scale) return 'Activa ' + q(c.name) + ' como Escala de Péndulo en ' + placeName(zone);
    const from = { hand: ' desde la mano', gy: ' desde el cementerio', ban: ' (desterrada)' }[loc.area] || '';
    if (fx.kind === 'activation') return 'Activa ' + q(c.name) + from;
    return 'Activa el efecto ' + (fx.index || '') + ' de ' + q(c.name) + from;
  }

  /** Zona a la que va una Mágica/Trampa activada desde la mano, o un Péndulo activado como Escala. */
  function activationZone(uid, fx, zoneHint) {
    const f = find(uid);
    if (fx.scale) return zoneHint || ['st0', 'st4'].find((z) => !S.zones[z].length) || null;
    if (db.isMonster(f.c) || f.loc.area !== 'hand') return null;
    if (f.c.type & T.FIELD) return zoneHint || 'fz';
    return zoneHint || legalZones(uid, [], 'activate')[0] || firstEmpty(ST) || null;
  }
  function activationReq(uid, fx, zone) {
    return { uid, effectIndex: fx.index, zone, chainLength: S.chain.length };
  }

  /** Declara un efecto: revisa, lo agrega a la cadena y lo anota. Las Mágicas/Trampas de la mano pasan al campo. */
  function activate(uid, fx, zoneHint) {
    const f = find(uid);
    if (!f) return;
    const { loc, inst, c } = f;
    const st = !db.isMonster(c);
    // Solo la activación de la carta la pone en el campo (un efecto de una Mágica en la mano, p. ej. "discard this card", no)
    const moves = !!fx.scale || (st && loc.area === 'hand' && fx.kind === 'activation');
    const zone = moves ? activationZone(uid, fx, zoneHint) : null;
    // Una Mágica de Campo nueva reemplaza a la anterior (la anterior va al cementerio)
    const oldField = zone === 'fz' && !fx.scale && S.zones.fz.length ? S.zones.fz[0] : null;
    if (moves && (!zone || (S.zones[zone].length && !oldField))) {
      toast(fx.scale ? 'Las Zonas de Péndulo (los extremos) están ocupadas' : c.type & T.FIELD ? 'La Zona de Campo está ocupada' : 'No quedan zonas de Mágicas y Trampas libres');
      return;
    }
    const wasSet = st && loc.area === 'field' && inst.faceDown;
    const req = activationReq(uid, fx, zone);
    // Con la cadena en pausa (estás haciendo tus eslabones antes del rival) no se activa nada nuevo
    const mid = S.chain.some((l) => l.done) ? { ok: false, errors: ['La cadena se está resolviendo: toca «Seguir resolviendo» antes de activar otro efecto.'], warnings: [] } : null;
    const v = merge(checkActivation(req), mid, zone ? checkPlacement(S, uid, zone, { method: fx.scale ? 'scale' : 'activate', vacating: oldField ? [oldField.uid] : [] }) : null);
    gate(v, () => {
      const f1 = find(uid);
      if (!f1) return;
      const from = fromKey(f1.loc); // de dónde se activa (mano, cementerio, zona...): el rival lo mira
      snapshot();
      const n = S.chain.length + 1;
      const chainBefore = S.chain.length;
      const e = commit('commitActivation', [req, v], v, { kind: 'activation', text: activationText(c, fx, loc, zone) }, () => {
        if (fx.optKey) S.turnState.opt[fx.optKey] = (Number(S.turnState.opt[fx.optKey]) || 0) + 1;
      });
      if (!/\bCL\s?\d|Eslab[oó]n\s*\d/i.test(e.text)) e.text += ' · Eslabón ' + n;
      const ruleLink = e.link && typeof e.link === 'object' ? e.link : {};
      delete e.link; // el eslabón va a S.chain; en el registro sobra
      if (oldField && locate(oldField.uid)) {
        sendMaterial(oldField.uid, 'gy');
        e.text += ' (' + q(nameById(oldField.id)) + ' va al cementerio)';
      }
      if (zone) {
        const r = detach(uid);
        S.zones[zone].push(resetCard(r.card));
      } else if (wasSet) inst.faceDown = false;
      const paid = payOwnCost(uid, fx);
      if (paid) e.text += ' · costo: ' + paid;
      const link = {
        uid, id: inst.id, effectIndex: fx.index, text: shortText(fx), speed: fx.speed || ruleLink.speed || 1, kind: fx.kind,
        cardAct: !!fx.scale || (st && (!!zone || wasSet || fx.kind === 'activation')), scale: !!fx.scale,
        snap: histBase + history.length - 1, // foto de antes de declarar (para "Deshacer última declaración")
        owner: 'me', from,
      };
      if (S.chain.length > chainBefore) Object.assign(S.chain[S.chain.length - 1], { snap: link.snap, cardAct: link.cardAct, kind: link.kind, scale: link.scale, owner: 'me', from });
      else S.chain.push(link);
      afterPlay(v);
      botEvent({ type: 'activation', link: S.chain.length - 1 });
    });
  }

  /** Costos de la propia carta que no piden elegir nada ("discard this card", "send this card from your hand to the GY",
   * "banish this card from your GY", "Tribute this card"): se pagan al declarar. Devuelve el texto para el registro o ''. */
  function payOwnCost(uid, fx) {
    const f = find(uid);
    if (!f || !fx || fx.scale || fx.kind === 'activation' || !fx.cost) return '';
    const cost = String(fx.cost);
    const area = f.loc.area === 'field' ? (f.loc.index === 0 && isMonsterZone(f.loc.zone) ? 'mzone' : '') : f.loc.area;
    let dest = null, text = '';
    if (area === 'hand' && /\bdiscard this card\b/i.test(cost)) { dest = 'gy'; text = 'se descarta'; }
    else if (area === 'hand' && /\bsend this card from your hand to the (?:GY|Graveyard)\b/i.test(cost)) { dest = 'gy'; text = 'va de la mano al cementerio'; }
    else if (area === 'hand' && /\bbanish this card from your hand\b/i.test(cost)) { dest = 'ban'; text = 'se destierra de la mano'; }
    else if (area === 'gy' && /\bbanish this card from your (?:GY|Graveyard)\b/i.test(cost)) { dest = 'ban'; text = 'se destierra del cementerio'; }
    else if (area === 'mzone' && /\bTribute this card\b/i.test(cost)) { dest = 'gy'; text = 'se sacrifica'; }
    if (!dest) return '';
    const went = sendMaterial(uid, dest);
    if (went === 'extra') toast(PEND_TOAST);
    return q(f.c.name) + ' ' + text + (went === 'extra' ? ' (va boca arriba al Extra Deck)' : '');
  }

  /** Errores de momento para lo que solo se hace en tu Fase Principal con la cadena vacía (si no hay reglas). */
  function mainPhaseOnly(what) {
    const t = S.turnState;
    const errors = [];
    if (!t.mine) errors.push('Solo puedes ' + what + ' en tu propio turno.');
    else if (t.phase !== 'main1' && t.phase !== 'main2') errors.push('Solo puedes ' + what + ' en tu Fase Principal.');
    if (S.chain.length) errors.push('No puedes ' + what + ' mientras hay una cadena abierta.');
    return { ok: !errors.length, errors, warnings: [] };
  }

  /** Coloca boca abajo una Mágica/Trampa de la mano (YGO.rules.checkSet/commitSet si existen). */
  function setSpellTrap(uid, zoneHint) {
    const f = find(uid);
    if (!f) return;
    const field = !!(f.c.type & T.FIELD);
    const zone = zoneHint || (field ? 'fz' : (legalZones(uid, [], 'set', { faceDown: true })[0] || firstEmpty(ST)));
    const oldField = zone === 'fz' && S.zones.fz.length ? S.zones.fz[0] : null; // la Mágica de Campo anterior va al cementerio
    if (!zone || (S.zones[zone].length && !oldField)) { toast(field ? 'La Zona de Campo está ocupada' : 'No quedan zonas de Mágicas y Trampas libres'); return; }
    const vacating = oldField ? [oldField.uid] : [];
    const v = merge(verdict(ask('checkSet', [S, uid, zone, { vacating }], () => mainPhaseOnly('Colocar cartas'))),
      checkPlacement(S, uid, zone, { method: 'set', faceDown: true, vacating }));
    gate(v, () => {
      snapshot();
      const e = commit('commitSet', [uid, v], v, { kind: 'set', text: 'Coloca ' + q(f.c.name) });
      if (!e.text.includes(placeName(zone))) e.text += ' en ' + placeName(zone);
      if (oldField && locate(oldField.uid)) {
        sendMaterial(oldField.uid, 'gy');
        e.text += ' (' + q(nameById(oldField.id)) + ' va al cementerio)';
      }
      const r = detach(uid);
      const card = resetCard(r.card);
      card.faceDown = true;
      card.setTurn = S.turnState.turn;
      S.zones[zone].push(card);
      selected = null;
      afterPlay(v);
    });
  }

  /** Lista numerada de efectos de la carta para declarar uno; cada efecto muestra si ahora se puede usar. */
  function openEffects(uid, opts) {
    opts = opts || {};
    const f = find(uid);
    if (!f) return;
    const { c, loc, inst } = f;
    let fxs = effectsOf(c);
    const cardFromHand = !db.isMonster(c) && (loc.area === 'hand' || (loc.area === 'field' && inst.faceDown));
    if (cardFromHand && !fxs.some((x) => x.kind === 'activation')) fxs = [cardActivation(c)].concat(fxs);
    const item = (fx, i) => {
      const used = optUsed(fx, uid);
      const passive = fx.kind === 'continuous' || fx.kind === 'summon';
      let now = '';
      if (!passive) {
        const zone = (fx.scale || (cardFromHand && loc.area === 'hand' && fx.kind === 'activation')) ? activationZone(uid, fx, opts.zone) : null;
        const v = checkActivation(activationReq(uid, fx, zone));
        if (!v.ok && !(used && v.errors.length === 1)) now = '<span class="fx-why">' + esc(v.errors.filter((m) => !/Ya (?:usaste|activaste)/.test(m))[0] || v.errors[0]) + '</span>';
      }
      const label = fx.optLabel || (Array.isArray(fx.opts) && fx.opts[0] && fx.opts[0].label) || '';
      return '<div class="fx-item k-' + esc(fx.kind || 'x') + (used ? ' used' : '') + (now ? ' blocked' : '') + '" role="button" tabindex="0" data-fx="' + i + '">'
        + '<span class="fx-head"><span class="fx-n">' + (fx.index ? 'Efecto ' + fx.index : 'Carta') + '</span>'
        + '<span class="fx-kind">' + esc(KIND[fx.kind] || 'Efecto') + (fx.speed ? ' · Velocidad ' + fx.speed : '') + '</span>'
        + (label ? '<span class="fx-opt">' + esc(label) + '</span>' : '')
        + (used ? '<span class="fx-used">Ya usado este turno</span>' : '')
        + (fx.kind === 'continuous' ? '<span class="fx-opt">No se activa</span>' : '')
        + (fx.kind === 'summon' ? '<span class="fx-opt">Se declara como Invocación Especial</span>' : '')
        + '</span><div class="fx-text">' + (fx.html || esc(fx.text || '')) + '</div>' + now + '</div>';
    };
    const body = '<p class="hint">Elige el efecto que declaras. Entra a la cadena como CL' + (S.chain.length + 1) + '.</p>'
      + (fxs.length ? '<div class="fx-list">' + fxs.map(item).join('') + '</div>' : '<p class="hint">No se reconocieron efectos en el texto de esta carta.</p>');
    openDialog('Activar efecto · ' + c.name, body, [{ label: 'Cancelar' }]);
    const choose = (el) => {
      const fx = fxs[Number(el.dataset.fx)];
      closeModal();
      if (fx.kind === 'summon') openSpecial(uid, { own: true, effectIndex: fx.index });
      else activate(uid, fx, opts.zone);
    };
    $$('[data-fx]', $('#modal-body')).forEach((el) => {
      el.addEventListener('click', () => choose(el));
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(el); } });
    });
  }

  /** Resuelve la cadena de la última a la primera; las Mágicas/Trampas normales que se activaron van al cementerio.
   * Los eslabones negados no hacen nada; los del rival aplican su efecto (YGO.bot.resolveLink).
   * Tus eslabones los haces tú a mano: si hay alguno encima de uno del rival, la cadena se pausa antes del rival
   * (los resueltos quedan marcados done) para que los hagas primero; "Seguir resolviendo" continúa. */
  function resolveChain() {
    if (!S.chain.length) return;
    snapshot();
    const negatedMine = [];
    const doing = []; // tus eslabones resueltos en esta pasada (los haces a mano)
    let stop = -1;
    for (let i = S.chain.length - 1; i >= 0; i--) {
      const l = S.chain[i];
      if (l.done) continue;
      const opp = l.owner === 'opp';
      // Ash y Belle solo niegan un eslabón de abajo: no importa el orden. Si tu respuesta lo niega, tampoco.
      if (opp && !l.negated && doing.length && !['Ash', 'Belle'].includes(shortName(l.handtrap || nameById(l.id)))
        && !botCall('negatedBy', [S, i], null)) { stop = i; break; }
      l.done = true;
      if (l.negated) {
        const fizzle = !opp && l.negated.fizzle;
        pushLog({ kind: opp ? 'opp' : 'resolve', text: 'CL' + (i + 1) + ': ' + q(nameById(l.id)) + (fizzle ? ' ya no puede usar la carta que necesitaba' : ' queda negado')
          + (l.negated.by ? ' (por ' + byText(l.negated.by) + ')' : '')
          + (opp ? '' : fizzle ? ' · Haz solo lo que no necesite esa carta' : ' · No hagas lo que dice este efecto') });
        if (opp) {
          // El rival anota que quedó negada y su carta deja la cadena; sus operaciones no se aplican
          if (!Array.isArray(botCall('resolveLink', [S, i], null))) oppNegated(l, i);
        } else if (!fizzle) negatedMine.push('CL' + (i + 1));
      } else if (opp) {
        const ops = botCall('resolveLink', [S, i], []);
        if (l.negated) {
          // El rival vio que lo negaste (Called by the Grave / Crossout Designator sobre esa handtrap): no hace nada
          pushLog({ kind: 'opp', text: 'CL' + (i + 1) + ': ' + q(nameById(l.id)) + ' queda negado' + (l.negated.by ? ' (por ' + byText(l.negated.by) + ')' : '') });
          markOppHistory(l, true);
        } else {
          pushLog({ kind: 'opp', text: 'Resuelve CL' + (i + 1) + ' (rival): ' + q(nameById(l.id)) });
          applyOppOps(ops, l);
        }
      } else {
        pushLog({ kind: 'resolve', text: 'Resuelve CL' + (i + 1) + ': ' + q(nameById(l.id)) + (l.scale ? ' (Escala de Péndulo)' : l.effectIndex ? ' (efecto ' + l.effectIndex + ')' : '') });
      }
      if (!opp && (!l.negated || l.negated.fizzle)) doing.push('CL' + (i + 1));
    }
    if (stop >= 0) {
      const who = q(nameById(S.chain[stop].id));
      pushLog({ kind: 'resolve', text: 'Pausa antes de CL' + (stop + 1) + ' (rival, ' + who + '): primero haz lo que dice' + (doing.length > 1 ? 'n ' : ' ') + listEs(doing) });
      render();
      if (negatedMine.length) toast(listEs(negatedMine) + (negatedMine.length > 1 ? ' quedaron negados' : ' quedó negado') + ': no hagas lo que dice su efecto', 'warn');
      openDialog('Primero tus eslabones', '<p>' + listEs(doing) + (doing.length > 1 ? ' se resuelven' : ' se resuelve') + ' antes que CL' + (stop + 1) + ' del rival (' + esc(who) + ').</p>'
        + '<p class="hint">Haz ahora en el campo lo que ' + (doing.length > 1 ? 'dicen' : 'dice') + ' (por ejemplo, la Invocación). Después toca <b>Seguir resolviendo</b> para que se resuelva el eslabón del rival.</p>',
      [{ label: 'Entendido', kind: 'primary' }]);
      return;
    }
    // Al cerrar la cadena, tus Mágicas/Trampas Normales activadas van al cementerio
    const toGy = S.chain.filter((l) => {
      const c = db.get(l.id);
      return l.owner !== 'opp' && l.cardAct && c && !db.isMonster(c) && !(c.type & (T.CONTINUOUS | T.FIELD | T.EQUIP));
    }).map((l) => l.uid);
    const sent = [];
    toGy.forEach((uid) => {
      const loc = locate(uid);
      if (!loc || loc.area !== 'field' || loc.index !== 0 || loc.list[0].faceDown) return;
      const r = detach(uid);
      S.gy.push(resetCard(r.card));
      sent.push(q(nameById(r.card.id)));
    });
    if (sent.length) pushLog({ kind: 'resolve', text: 'Al cerrar la cadena van al cementerio: ' + sent.join(', ') });
    const resolved = S.chain;
    S.chain = [];
    render();
    if (negatedMine.length) toast(listEs(negatedMine) + (negatedMine.length > 1 ? ' quedaron negados' : ' quedó negado') + ': no hagas lo que dice su efecto', 'warn');
    // chain: la cadena que se acaba de resolver (el rival mira si tus Called by the Grave quedaron negados)
    botEvent({ type: 'resolved', chain: JSON.parse(JSON.stringify(resolved)) });
  }

  /** Marca o desmarca un eslabón como negado (p. ej. respondiste a Ash Blossom con Called by the Grave). */
  function toggleNegated(i) {
    const l = S.chain[i];
    if (!l) return;
    snapshot();
    const name = q(nameById(l.id));
    if (l.negated) {
      delete l.negated;
      if (l.owner === 'opp') markOppHistory(l, false);
      pushLog({ kind: 'activation', text: 'Quita la marca de negado de CL' + (i + 1) + ' (' + name + ')' });
    } else {
      // Quién lo niega: el último eslabón del otro jugador encima de este (si hay)
      const opp = l.owner === 'opp';
      let by = '';
      for (let k = S.chain.length - 1; k > i && !by; k--) if ((S.chain[k].owner === 'opp') !== opp) by = nameById(S.chain[k].id);
      l.negated = { by, manual: true };
      if (opp) markOppHistory(l, true);
      pushLog({ kind: 'activation', text: 'Marca CL' + (i + 1) + ' (' + name + ') como negado' + (by ? ' (por ' + q(by) + ')' : '') });
    }
    render();
  }

  /** Vuelve a como estaba todo justo antes de declarar el último eslabón.
   * Si el último es del rival, se deshace la jugada tuya a la que respondió (y su respuesta). */
  function undoDeclaration() {
    const n = S.chain.length;
    const l = S.chain[n - 1];
    if (!l) return;
    const name = q(nameById(l.id));
    const opp = l.owner === 'opp';
    const i = typeof l.snap === 'number' ? l.snap - histBase : -1;
    if (i >= 0 && i < history.length) {
      const prev = JSON.parse(history[i]);
      if (Array.isArray(prev.chain) && (prev.chain.length < n || opp)) {
        const after = history.length - 1 - i;
        S = prev;
        history.length = i;
        selected = null;
        pending = null;
        render();
        toast(opp ? 'Se deshizo tu última jugada y la respuesta del rival (' + name + ')'
          : 'Se deshizo CL' + n + ' (' + name + ')' + (after ? ' y lo que hiciste después' : ''), 'ok');
        return;
      }
    }
    if (opp) { toast('La respuesta del rival no se deshace: respóndele con un efecto o márcala como negada', 'warn'); return; }
    // Sin foto (historial recortado): solo se quita el eslabón
    snapshot();
    S.chain.pop();
    pushLog({ kind: 'activation', text: 'Retira la declaración CL' + n + ' de ' + name });
    render();
  }

  /* ---------- Posiciones ---------- */
  function changePosition(uid, to) {
    const f = find(uid);
    if (!f) return;
    const v = checkPosition(uid, to);
    gate(v, () => {
      snapshot();
      const t = S.turnState;
      const inst = f.inst;
      let text;
      if (to === 'flip') {
        inst.faceDown = false;
        inst.def = false;
        inst.summonedTurn = t.turn;
        inst.summonMethod = 'flip';
        text = 'Invocación por Volteo de ' + q(f.c.name);
      } else {
        inst.def = to === 'def';
        text = 'Cambia ' + q(f.c.name) + ' a posición de ' + (to === 'def' ? 'defensa' : 'ataque');
      }
      inst.positionChangedTurn = t.turn;
      pushLog({ kind: to === 'flip' ? 'summon' : 'position', text }, v);
      afterPlay(v);
    });
  }

  /* ---------- Fases y turnos ---------- */
  function phaseVerdict(target) {
    const errors = [];
    const t = S.turnState;
    if (S.chain.length) errors.push('Hay una cadena sin resolver: resuélvela antes de cambiar de fase.');
    if (target) {
      const keys = phases().map((p) => p[0]);
      if (keys.indexOf(target) < keys.indexOf(t.phase)) errors.push('No se puede volver a una fase anterior.');
      if (target === 'battle' && t.turn === 1) errors.push('En el primer turno del duelo no hay Fase de Batalla.');
    }
    return { ok: !errors.length, errors, warnings: [] };
  }
  function setPhase(key) {
    if (key === S.turnState.phase) return;
    const v = phaseVerdict(key);
    gate(v, () => {
      snapshot();
      run('setPhase', [S, key], () => { S.turnState.phase = key; });
      ensureState();
      pushLog({ kind: 'phase', text: 'Fase: ' + phaseName(S.turnState.phase) }, v);
      afterPlay(v);
      botEvent({ type: 'phase', phase: S.turnState.phase });
    });
  }
  function nextPhase() {
    const v = phaseVerdict(null);
    gate(v, () => {
      snapshot();
      const turn = S.turnState.turn;
      const mine = S.turnState.mine;
      run('nextPhase', [S], () => localNextPhase(S));
      ensureState();
      const t = S.turnState;
      pushLog({ kind: 'phase', text: t.turn !== turn ? 'Empieza el turno ' + t.turn + ' (' + (t.mine ? 'tu turno' : 'turno rival') + ')' : 'Fase: ' + phaseName(t.phase) }, v);
      afterPlay(v);
      botEvent({ type: 'phase', phase: t.phase });
      // Después de tu Fase Final empieza el turno rival: termina el intento
      if (t.turn !== turn && mine && oppOn()) endAttempt();
    });
  }
  function passTurn() {
    const v = phaseVerdict(null);
    gate(v, () => {
      const mine = S.turnState.mine;
      snapshot();
      // Eslabones del rival que quedan sin resolver: su carta deja la cadena sin hacer nada (no "te cortó")
      if (oppOn() && S.chain.some((l) => l && l.owner === 'opp' && !l.done)) {
        arr(botCall('observe', [S, { type: 'resolved', abandoned: true, chain: JSON.parse(JSON.stringify(S.chain)) }], []))
          .forEach((n) => { if (n && n.text) pushLog(Object.assign({}, n, { kind: 'opp' })); });
      }
      pushLog({ kind: 'phase', text: 'Termina el turno ' + S.turnState.turn }, v);
      run('passTurn', [S], () => localPassTurn(S));
      ensureState();
      S.chain = [];
      pending = null;
      selected = null;
      afterPlay(v);
      toast('Turno ' + S.turnState.turn + ': ' + (S.turnState.mine ? 'tu turno' : 'turno rival'), 'ok');
      botEvent({ type: 'phase', phase: S.turnState.phase });
      // Pasar tu turno contra el rival termina el intento: se guarda y se ve el resumen
      if (mine && oppOn()) endAttempt();
    });
  }

  /* ---------- Acciones de la carta elegida ---------- */
  function actionsFor(uid) {
    const f = find(uid);
    if (!f) return [];
    const { loc, inst, c } = f;
    const acts = [];
    const onField = loc.area === 'field';
    const isTop = onField && loc.index === 0;
    const extraMon = db.isExtra(c);
    const add = (label, fn, kind) => acts.push({ label, fn, kind });
    const fx = () => openEffects(uid);

    // Ficha (Primal Being Token): no tiene efectos; solo cambia de posición, se mueve o deja el campo (y desaparece)
    if (inst.token) {
      if (isTop && isMonsterZone(loc.zone)) add(inst.def ? 'Cambiar a ATK' : 'Cambiar a DEF', () => changePosition(uid, inst.def ? 'atk' : 'def'), 'primary');
      acts.push({ group: 'Movimientos manuales' });
      add('Mover a una zona…', () => startPending('move', uid));
      add('Quitar del campo (desaparece)', () => move(uid, 'gy'));
      return acts;
    }

    if (!onField) {
      if (db.isMonster(c)) {
        const opts = summonOptions(uid);
        if (loc.area === 'gy' || loc.area === 'ban') add('Activar efecto…', fx, 'primary');
        opts.forEach((o, i) => add(o.label, o.action, i === 0 && loc.area !== 'gy' && loc.area !== 'ban' ? 'primary' : ''));
        if (c.type & T.PENDULUM && loc.area === 'hand') add('Activar como Escala de Péndulo', () => activateScale(uid));
        // Boca arriba en el Extra Deck hay efectos que se activan desde ahí ("If this card is face-up in your Extra Deck")
        if (loc.area === 'hand' || faceUpInExtra(loc, inst)) add('Activar efecto…', fx);
      } else if (loc.area === 'hand') {
        add('Activar', () => activateCard(uid), db.isSpell(c) ? 'primary' : '');
        add('Colocar (boca abajo)', () => setSpellTrap(uid), db.isTrap(c) ? 'primary' : '');
      } else if (loc.area === 'gy' || loc.area === 'ban') add('Activar efecto…', fx, 'primary');
    } else if (isTop) {
      if (isMonsterZone(loc.zone)) {
        if (inst.faceDown) add('Voltear boca arriba', () => changePosition(uid, 'flip'), 'primary');
        else {
          add('Activar efecto…', fx, 'primary');
          add(inst.def ? 'Cambiar a ATK' : 'Cambiar a DEF', () => changePosition(uid, inst.def ? 'atk' : 'def'));
          if (!(c.type & (T.XYZ | T.LINK))) add('Cambiar Nivel…', () => openLevel(uid));
        }
        if (loc.list.length > 1) add('Desacoplar material (' + (loc.list.length - 1) + ')', () => detachMaterial(loc.zone));
      } else if (inst.faceDown) add('Activar (voltear)', () => activateCard(uid), 'primary');
      else {
        add('Activar efecto…', fx, 'primary');
        // Un monstruo Péndulo en la Zona de Péndulo puede invocarse desde ahí si un efecto lo permite
        if (db.isMonster(c) && (loc.zone === 'st0' || loc.zone === 'st4')) add('Invocación Especial…', () => openSpecial(uid));
      }
    }
    acts.push({ group: 'Movimientos manuales' });
    if (isTop && !inst.faceDown) add('Colocar boca abajo', () => manualFlip(uid, true));
    if (isTop && inst.faceDown) add(isMonsterZone(loc.zone) ? 'Voltear (por un efecto)' : 'Voltear sin activar', () => manualFlip(uid, false));
    add('Mover a una zona…', () => startPending('move', uid));
    if (db.isMonster(c) && !(onField && isTop && isMonsterZone(loc.zone))) add('Acoplar como material…', () => startPending('attach', uid));
    if (loc.area !== 'gy') add('Al cementerio', () => move(uid, 'gy'));
    // Un Péndulo cuya Invocación (Normal, Especial o por Péndulo) o activación como Escala fue negada sí va al cementerio
    if (pendulumToExtra(loc, c)) add('Al cementerio (invocación negada)', () => move(uid, 'gy', { negated: true }));
    if (loc.area !== 'ban') add('Desterrar', () => move(uid, 'ban'));
    const pendMon = db.isMonster(c) && !!(c.type & T.PENDULUM);
    if (loc.area !== 'extra') {
      // Péndulo del Mazo Principal: solo boca arriba. De Fusión/Sincronía/Xyz: boca arriba (dejó el campo) o boca abajo (regresa)
      if (pendMon) add('Al Extra Deck (boca arriba)', () => move(uid, 'extra', { faceUp: true }));
      if (pendMon && extraMon) add('Al Extra Deck (boca abajo)', () => move(uid, 'extra', { faceUp: false }));
      if (!pendMon && extraMon) add('Al Extra Deck', () => move(uid, 'extra'));
    }
    if (loc.area !== 'hand' && !extraMon) add('A la mano', () => move(uid, 'hand'));
    if (!extraMon) {
      add('Al mazo (arriba)', () => move(uid, 'deck'));
      add('Al mazo (abajo)', () => move(uid, 'deck', { bottom: true }));
      add('Barajar en el mazo', () => move(uid, 'deck', { shuffle: true }));
    }
    return acts;
  }

  /** Boca abajo / boca arriba por un efecto (sin declarar). */
  function manualFlip(uid, down) {
    const f = find(uid);
    if (!f) return;
    snapshot();
    f.inst.faceDown = down;
    if (down && isMonsterZone(f.loc.zone)) f.inst.def = true;
    logManual(q(f.c.name) + (down ? ' queda boca abajo' : ' queda boca arriba'));
    render();
  }

  /** Anota el Nivel actual de un monstruo cuando un efecto lo cambia (p. ej. Elfnote Power Patron: +3).
   * Las reglas usan ese Nivel para la Sincronía, el Xyz y el Péndulo; se olvida cuando la carta deja el campo. */
  function openLevel(uid) {
    const f = find(uid);
    if (!f) return;
    const cur = levelOf(f.inst, f.c);
    openDialog('Nivel de ' + f.c.name, '<p class="hint">Nivel original: ' + f.c.lv + '. Anota el Nivel que tiene ahora por un efecto.</p>'
      + '<label class="field"><span>Nivel actual</span><input id="lv-input" type="number" min="1" max="13" step="1" inputmode="numeric" value="' + cur + '"></label>'
      + '<div class="seg lv-steps" role="group" aria-label="Sumar o restar"><button type="button" data-lv="-3">−3</button><button type="button" data-lv="-1">−1</button>'
      + '<button type="button" data-lv="1">+1</button><button type="button" data-lv="3">+3</button></div>',
    [{ label: 'Cancelar' }, {
      label: 'Guardar', kind: 'primary', action: () => {
        const n = Math.max(1, Math.min(13, Math.round(Number($('#lv-input').value) || f.c.lv)));
        if (!find(uid) || n === cur) return;
        snapshot();
        if (n === f.c.lv) delete f.inst.level; else f.inst.level = n;
        pushLog({ kind: 'manual', text: 'Nivel de ' + q(f.c.name) + ': ' + cur + ' → ' + n + ' (por un efecto)' });
        render();
      },
    }]);
    const input = $('#lv-input');
    $$('[data-lv]', $('#modal-body')).forEach((b) => b.addEventListener('click', () => {
      input.value = Math.max(1, Math.min(13, (Number(input.value) || cur) + Number(b.dataset.lv)));
    }));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#modal-foot .primary').click(); });
  }

  /** Desacopla un material; si hay varios, pregunta cuál. */
  function detachMaterial(zone) {
    const stack = S.zones[zone];
    const host = stack[0];
    const doIt = (m) => {
      snapshot();
      const i = stack.indexOf(m);
      if (i < 1) return;
      stack.splice(i, 1);
      S.gy.push(resetCard(m));
      pushLog({ kind: 'manual', text: 'Desacopla ' + q(nameById(m.id)) + ' de ' + q(nameById(host.id)) });
      render();
    };
    if (stack.length === 2) { doIt(stack[1]); return; }
    chooser('¿Qué material desacoplas?', nameById(host.id), stack.slice(1).map((m) => ({ label: nameById(m.id), action: () => doIt(m) })));
  }

  function startPending(kind, uid) {
    pending = { kind, uid };
    selected = null; // la hoja de acciones se cierra: ahora se toca la zona
    closePile();
    render();
  }

  /** Una carta llega a una zona (arrastrándola, o tocando la carta y luego la zona). Pregunta qué se declara. */
  function dropTo(uid, zone) {
    const f = find(uid);
    if (!f) return;
    const { loc, c } = f;
    if (zone === 'hand' || PILES.includes(zone)) { move(uid, zone, defaultOpts(uid, zone)); return; }
    const stack = S.zones[zone];
    if (stack.length && stack[0].uid === uid) return;
    const mon = db.isMonster(c);
    // Boca arriba en el Extra Deck: no se puede hacer su Invocación Xyz/Fusión/Sincronía (summonOptions ya las quita)
    const xyz = mon && !!(c.type & T.XYZ) && !faceUpInExtra(loc, f.inst);
    if (stack.length) {
      // Otra Mágica de Campo de la mano: se activa o coloca y la anterior va al cementerio
      if (zone === 'fz' && !mon && loc.area === 'hand' && c.type & T.FIELD) {
        chooser('¿Activar o colocar?', c.name, [
          { label: 'Activar', kind: 'primary', action: () => activateCard(uid, zone) },
          { label: 'Colocar (boca abajo)', action: () => setSpellTrap(uid, zone) },
        ]);
        return;
      }
      if (!isMonsterZone(zone)) { toast('Esa zona ya está ocupada'); return; }
      if (xyz && loc.area === 'extra') { startSummon('xyz', uid, { zone, picks: [stack[0].uid] }); return; }
      if (xyz) { move(uid, zone, { overlay: true }); return; }
      const host = stack[0];
      const hc = db.get(host.id);
      const attach = { label: 'Acoplar como material de ' + (hc ? hc.name : 'ese monstruo'), action: () => move(uid, zone, { attach: true }) };
      // Solo un Xyz boca arriba lleva materiales: sobre otro monstruo se pregunta qué se quiere hacer
      if (hc && hc.type & T.XYZ && !host.faceDown) { attach.action(); return; }
      const items = [];
      if (mon && loc.area === 'extra') {
        summonOptions(uid).filter((o) => o.method !== 'pendulum' && (o.method !== 'special' || o.proc))
          .forEach((o) => items.push({ label: o.label, action: () => startSummon(o.method, uid, { zone, picks: [host.uid] }) }));
      } else if (mon && loc.area === 'hand') {
        const need = tributesNeeded(c);
        if (c.type & T.RITUAL) items.push({ label: METHOD.ritual, action: () => startSummon('ritual', uid, { zone, picks: [host.uid] }) });
        else if (need) items.push({ label: METHOD.tribute, action: () => startSummon('tribute', uid, { zone, need, picks: [host.uid] }) });
      }
      items.push(attach);
      chooser('¿Qué haces con ' + (hc ? hc.name : 'ese monstruo') + '?', c.name, items.map((o, i) => Object.assign({}, o, { kind: i ? '' : 'primary' })));
      return;
    }
    // Un monstruo en la Zona de Péndulo que baja a una Zona de Monstruo: Invocación Especial (o solo moverlo)
    if (loc.area === 'field' && mon && (loc.zone === 'st0' || loc.zone === 'st4') && !f.inst.faceDown && isMonsterZone(zone)) {
      openSpecial(uid, { zone, drop: true });
      return;
    }
    if (loc.area === 'field') { move(uid, zone, defaultOpts(uid, zone)); return; }
    const manual = { label: 'Mover sin declarar', kind: 'ghost', action: () => move(uid, zone, {}) };
    const firstPrimary = (list) => list.map((o, i) => Object.assign({}, o, { kind: i ? '' : 'primary' }));
    if (mon && isMonsterZone(zone)) {
      const opts = summonOptions(uid, zone);
      if (loc.area === 'extra') {
        const procs = opts.filter((o) => o.method !== 'special');
        if (procs.length === 1) { procs[0].action(); return; }
        chooser('¿Cómo la invocas?', c.name, firstPrimary(opts).concat(manual));
      } else if (loc.area === 'hand') chooser('¿Cómo la invocas?', c.name, firstPrimary(opts).concat(manual));
      else openSpecial(uid, { zone, drop: true });
      return;
    }
    if (mon && c.type & T.PENDULUM && (zone === 'st0' || zone === 'st4') && loc.area === 'hand') {
      chooser('¿La activas como Escala?', c.name, [{ label: 'Activar como Escala de Péndulo', kind: 'primary', action: () => activateScale(uid, zone) }, manual]);
      return;
    }
    if (!mon && loc.area === 'hand' && !isMonsterZone(zone) && (zone === 'fz') === !!(c.type & T.FIELD)) {
      chooser('¿Activar o colocar?', c.name, [
        { label: 'Activar', kind: db.isSpell(c) ? 'primary' : '', action: () => activateCard(uid, zone) },
        { label: 'Colocar (boca abajo)', kind: db.isTrap(c) ? 'primary' : '', action: () => setSpellTrap(uid, zone) },
        manual,
      ]);
      return;
    }
    move(uid, zone, defaultOpts(uid, zone));
  }

  /** Toque/clic sobre una zona o pila del tablero. */
  function onZone(zone) {
    if (pending && pending.kind === 'summon') { pickZone(zone); return; }
    if (pending) {
      const { kind, uid } = pending;
      // Acoplar o poner encima: solo sobre un monstruo del campo; si no, se sigue esperando
      if (kind !== 'move' && !(FIELD_ZONES.includes(zone) && isMonsterZone(zone) && S.zones[zone].length)) { toast('Elige un monstruo en el campo'); return; }
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
    if (selected) dropTo(selected, zone);
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
  /** kind: 'warn' (ámbar, por defecto) | 'bad' (rojo) | 'ok' (verde) */
  function toast(msg, kind) {
    const el = $('#toast');
    el.textContent = msg;
    el.className = 'toast toast-' + (kind || 'warn');
    el.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { el.hidden = true; }, kind === 'bad' ? 4200 : 2600);
  }

  /** Diálogo en la ventana compartida. buttons: [{ label, kind, action }]; el botón cierra antes de actuar. */
  function openDialog(title, bodyHtml, buttons) {
    pileOpen = null;
    $('#modal-title').textContent = title;
    $('#modal-body').innerHTML = bodyHtml;
    const foot = $('#modal-foot');
    foot.innerHTML = '';
    buttons.forEach((b) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.textContent = b.label;
      el.className = b.kind || '';
      el.addEventListener('click', () => { closeModal(); if (b.action) b.action(); });
      foot.appendChild(el);
    });
    $('#modal').hidden = false;
    dialogOpen = true;
    const first = $('.primary', foot) || foot.lastChild;
    if (first) setTimeout(() => first.focus(), 30);
  }
  function closeModal() {
    pileOpen = null;
    dialogOpen = false;
    $('#modal').hidden = true;
  }
  /** Lista de opciones (p. ej. "¿Cómo la invocas?"). items: [{ label, kind, action }] */
  function chooser(title, cardName, items) {
    openDialog(title, '<p class="hint">' + esc(cardName) + '</p><div class="chooser">'
      + items.map((it, i) => '<button type="button" class="' + (it.kind || '') + '" data-ch="' + i + '">' + esc(it.label) + '</button>').join('')
      + '</div>', [{ label: 'Cancelar' }]);
    $$('[data-ch]', $('#modal-body')).forEach((b) => b.addEventListener('click', () => {
      closeModal();
      items[Number(b.dataset.ch)].action();
    }));
  }

  function openPile(pile) {
    dialogOpen = false;
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
    const picking = pending && pending.kind === 'summon';
    // Por Péndulo solo se invoca desde la mano o boca arriba del Extra Deck: lo demás se ve apagado y no se elige
    const pendPick = !!(picking && pending.method === 'pendulum');
    $('#modal-title').textContent = PILE_NAMES[pileOpen] + ' (' + list.length + ')';
    const grid = (l, off) => '<div class="pile-grid' + (off ? ' pile-off' : '') + '">' + l.map((x) => tileFor(x, true)).join('') + '</div>';
    let cards = list.length ? grid(list, pendPick && pileOpen !== 'extra') : '<p class="hint">No hay cartas aquí.</p>';
    if (pileOpen === 'extra' && list.some((x) => x.extraFaceUp)) {
      // Boca arriba (Péndulo, a la vista de ambos jugadores) primero, el más reciente adelante
      const up = list.filter((x) => x.extraFaceUp).reverse(), down = list.filter((x) => !x.extraFaceUp);
      cards = '<h3 class="pile-sec">Boca arriba · ' + up.length + '</h3>' + grid(up)
        + '<h3 class="pile-sec">Boca abajo · ' + down.length + (pendPick ? ' (no se pueden Invocar por Péndulo)' : '') + '</h3>'
        + (down.length ? grid(down, pendPick) : '<p class="hint">No hay cartas boca abajo.</p>');
    }
    $('#modal-body').innerHTML = (pendPick ? '<p class="hint">Toca las cartas para elegirlas: de la mano, o del Extra Deck si están boca arriba.</p>'
      : picking ? '<p class="hint">Toca las cartas para elegirlas. Cierra la ventana cuando termines.</p>'
        : pileOpen === 'deck' ? '<p class="hint">Ordenado por nombre. Al sacar una carta, el mazo se baraja.</p>' : '')
      + cards;
    const foot = $('#modal-foot');
    foot.innerHTML = '';
    if (pileOpen === 'deck' && !picking) {
      const sh = document.createElement('button');
      sh.type = 'button';
      sh.textContent = 'Barajar';
      sh.addEventListener('click', () => { snapshot(); game.shuffle(S.deck); toast('Mazo barajado'); render(); });
      foot.appendChild(sh);
    }
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = picking ? 'Listo' : 'Cerrar';
    if (picking) close.className = 'primary';
    close.addEventListener('click', closePile);
    foot.appendChild(close);
  }

  /* ---------- Dibujo ---------- */
  function chainTag(uid) {
    return S.chain.map((l, i) => (l.uid === uid ? 'CL' + (i + 1) : '')).filter(Boolean).join(' ');
  }

  /** Eslabones del rival que apuntan a esta carta (Veiler, Impermanence, Ogre, Crow...). */
  function oppTargets(uid) {
    return S.chain.map((l, i) => (l.owner === 'opp' && !l.negated && l.target && l.target.uid === uid ? 'CL' + (i + 1) + ' ' + nameById(l.id) : '')).filter(Boolean);
  }

  function tileFor(inst, reveal, inZone) {
    const c = cardOf(inst);
    const p = pending && pending.kind === 'summon' ? pending : null;
    const cls = [inst.uid === selected ? 'sel' : '', inst.def ? 'is-def' : '', inst.faceDown && !reveal ? 'is-down' : '',
      p && p.picks.includes(inst.uid) ? 'pick' : '', p && p.method !== 'pendulum' && p.uid === inst.uid ? 'summoning' : ''].join(' ');
    const attrs = 'data-uid="' + inst.uid + '" draggable="true" tabindex="0"';
    const html = inst.token ? tokenTile(c, attrs) : view.tile(c, { attrs });
    const cl = !inZone && chainTag(inst.uid);
    const hit = oppTargets(inst.uid);
    return '<div class="slot-card ' + cls + '">' + html + (inst.faceDown && !reveal ? '<span class="down-label">' + esc(c.name) + '</span>' : '')
      + (cl ? '<span class="cl-badge">' + cl + '</span>' : '')
      + (hit.length ? '<span class="opp-hit" title="Objetivo del rival: ' + esc(hit.join(', ')) + '">↯</span>' : '') + '</div>';
  }

  function zoneHtml(z, label, ctx) {
    const stack = S.zones[z];
    const mats = stack.length > 1 ? '<span class="mats" title="Materiales">' + (stack.length - 1) + '</span>' : '';
    const lv = stack.length && typeof stack[0].level === 'number' && !stack[0].faceDown ? '<span class="lv-badge" title="Nivel cambiado por un efecto">Nv ' + stack[0].level + '</span>' : '';
    const neg = stack.length && isNegated(stack[0]) ? '<span class="neg-badge" title="Efectos negados este turno (por ' + esc(byText(stack[0].negated.by)) + ')">Negado</span>' : '';
    let target = false;
    const dest = ctx.dest.has(z);
    if (pending && pending.kind === 'summon') target = !stack.length && !dest && ctx.cands.has(z);
    else if (pending && pending.kind === 'move') {
      // Igual que move(): la Zona de Campo solo para Mágicas de Campo y las de monstruo solo para monstruos
      const m = find(pending.uid);
      target = !stack.length && !!m && (z === 'fz' ? !!(m.c.type & T.FIELD) : isMonsterZone(z) ? db.isMonster(m.c) : true);
    } else if (pending) target = stack.length && isMonsterZone(z);
    const cl = stack.length ? chainTag(stack[0].uid) : '';
    return '<div class="zone-slot z-' + z.replace(/\d/, '') + (target ? ' target' : '') + (dest ? ' dest' : '') + (ctx.linked.has(z) ? ' linked' : '')
      + '" data-zone="' + z + '" tabindex="0" aria-label="' + label + '">'
      + (stack.length ? tileFor(stack[0], false, true) + mats + lv + neg : '<span class="zl">' + (dest ? 'Destino' : label) + '</span>')
      + (stack.length && dest ? '<span class="dest-tag">Destino</span>' : '')
      + (cl ? '<span class="cl-badge">' + cl + '</span>' : '') + '</div>';
  }

  function pileHtml(p) {
    const list = S[p];
    // En el Extra Deck, los Péndulo boca arriba se ven encima (el último que llegó)
    const up = p === 'extra' ? list.filter((x) => x.extraFaceUp) : [];
    const top = !list.length ? '' : up.length ? tileFor(up[up.length - 1], true)
      : p === 'deck' || p === 'extra' ? '<div class="card back"></div>' : tileFor(list[list.length - 1], true);
    // Por Péndulo solo se invoca desde la mano o del Extra Deck: las demás pilas no son destino
    const target = pending && (pending.kind === 'move'
      || (pending.kind === 'summon' && (pending.method !== 'pendulum' || p === 'extra')));
    return '<div class="zone-slot pile z-' + p + (target ? ' target' : '') + '" data-zone="' + p + '" tabindex="0" aria-label="' + PILE_NAMES[p] + '">'
      + top
      + (up.length ? '<span class="pile-up" title="Péndulo boca arriba en el Extra Deck">' + up.length + ' ▲</span>' : '')
      // En pantallas angostas solo se ve el número (el nombre está en aria-label y en la ventana de la pila)
      + '<span class="pile-count"><span class="pile-name">' + PILE_NAMES[p] + ' · </span>' + list.length + '</span></div>';
  }

  /** Zonas candidatas, destino elegido y zonas apuntadas por Links, para dibujar el tablero. */
  function boardCtx() {
    const ctx = { cands: new Set(), dest: new Set(), linked: linkedZones() };
    const p = pending;
    if (!p || p.kind !== 'summon') return ctx;
    if (p.method === 'pendulum') {
      pendAssign(p).forEach((a) => { if (a.zone) ctx.dest.add(a.zone); });
      // Solo las zonas donde puede ir alguno de los elegidos (la Zona Extra, solo para los del Extra Deck)
      const fits = (z) => p.picks.some((u) => checkPlacement(S, u, z, { method: 'pendulum' }).ok);
      [...EMZ, ...MZ].forEach((z) => { if (!S.zones[z].length && (p.picks.length ? fits(z) : !EMZ.includes(z))) ctx.cands.add(z); });
    } else {
      legalZones(p.uid, p.picks, p.method).forEach((z) => ctx.cands.add(z));
      const z = pickReq(p).zone;
      if (z) ctx.dest.add(z);
    }
    return ctx;
  }

  function render() {
    if (!S) return;
    ensureState();
    if (sweepTokens()) toast('Las fichas desaparecen cuando dejan el campo');
    if (pending && !locate(pending.uid)) pending = null;
    if (pending && pending.kind === 'summon') pending.picks = pending.picks.filter((u) => locate(u));
    // Primero / Segundo: lo del duelo actual
    const second = !!(S.start ? S.start.second : S.turnState.turn === 2);
    $$('#fd-order button').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.order === 'second') === second)));
    const st = ['Zona de Péndulo / M/T', 'M/T', 'M/T', 'M/T', 'Zona de Péndulo / M/T'];
    const ctx = boardCtx();
    $('#board').innerHTML =
      '<div class="cell spacer"></div><div class="cell spacer"></div>' + zoneHtml('emz0', 'Zona de Monstruo Extra', ctx)
      + '<div class="cell spacer"></div>' + zoneHtml('emz1', 'Zona de Monstruo Extra', ctx) + '<div class="cell spacer"></div>' + pileHtml('ban')
      + zoneHtml('fz', 'Zona de Campo', ctx) + MZ.map((z) => zoneHtml(z, 'Monstruo', ctx)).join('') + pileHtml('gy')
      + pileHtml('extra') + ST.map((z, i) => zoneHtml(z, st[i], ctx)).join('') + pileHtml('deck');
    $('#fd-hand').innerHTML = S.hand.length ? S.hand.map((x) => tileFor(x, true)).join('') : '<p class="ht-empty">Tu mano está vacía.</p>';
    $('#fd-hand-count').textContent = S.hand.length;
    $('#fd-hand-wrap').classList.toggle('picking', !!(pending && pending.kind === 'summon'));
    $('#fd-undo').disabled = !history.length;
    $('#fd-lp').value = S.lp;
    renderTurn();
    renderOpp();
    renderPending();
    renderChain();
    renderLog();
    renderSide();
    renderPile();
  }

  function renderTurn() {
    const t = S.turnState;
    $('#fd-turn').classList.toggle('rival', !t.mine);
    $('#fd-turn-n').textContent = 'Turno ' + t.turn;
    $('#fd-turn-who').textContent = t.mine ? 'Tu turno' : 'Turno rival';
    $('#fd-phases').innerHTML = phases().map(([k, label]) => '<button type="button" data-phase="' + esc(k) + '" aria-pressed="' + (k === t.phase) + '">'
      + '<span class="ph-l">' + esc(label) + '</span><span class="ph-s">' + esc(PHASE_SHORT[k] || label) + '</span></button>').join('');
    const used = (Number(t.normalSummons) || 0) >= 1;
    $('#fd-ns').innerHTML = 'Invocación Normal: <b class="' + (used ? 'ns-used' : 'ns-free') + '">' + (used ? 'usada' : 'disponible') + '</b>';
    $('#fd-strict').checked = strict();
    $('#fd-log-btn').textContent = 'Registro (' + S.log.length + ')';
    // "Terminar intento": contra el rival o si el mazo tiene campo objetivo
    $('#fd-end').hidden = !(oppOn() || attemptTarget().length);
  }

  /** Banda de arriba del tablero: mover a una zona, o elegir materiales con revisión en vivo. */
  function renderPending() {
    const box = $('#fd-pending');
    const picking = !!(pending && pending.kind === 'summon');
    box.hidden = !pending;
    box.classList.toggle('pick-mode', picking);
    $('#board').classList.toggle('picking', !!pending);
    $('#fd-pick').hidden = !picking;
    $('#fd-confirm').hidden = !picking;
    if (!pending) return;
    const f = find(pending.uid);
    if (!picking) {
      $('#fd-pending-text').textContent = {
        move: 'Toca la zona a la que quieres mover ' + f.c.name,
        overlay: 'Toca el monstruo que será material de ' + f.c.name,
        attach: 'Toca el monstruo al que se acopla ' + f.c.name,
      }[pending.kind];
      return;
    }
    const p = pending;
    const c = f.c;
    const name = esc(q(c.name));
    let title;
    if (p.method === 'tribute' || p.method === 'tributeSet') {
      title = '<b>' + METHOD[p.method] + '</b> de ' + name + ': toca ' + (p.need === 1 ? 'el monstruo' : 'los ' + p.need + ' monstruos') + ' que sacrificas.';
    } else if (p.method === 'pendulum') {
      title = '<b>Invocación por Péndulo</b>: toca los monstruos que invocas (de la mano, o del Extra Deck si están boca arriba).';
    } else if (p.method === 'special') {
      title = '<b>Invocación Especial</b> de ' + name + ' por su procedimiento: toca las cartas que pide su texto (en el campo, la mano o el cementerio).';
    } else {
      title = '<b>' + METHOD[p.method] + '</b> de ' + name + ': toca los materiales en el campo o en la mano'
        + (p.method === 'fusion' || p.method === 'ritual' ? ' (o abre el cementerio o el mazo para usar cartas de ahí)' : '') + '.';
    }
    $('#fd-pending-text').innerHTML = title;

    let body = '';
    if (p.pm) {
      body += '<p class="pick-req"><span class="t-tag">Requisito</span>' + esc(p.pm.summary || 'No se pudo leer el requisito: revísalo en el texto de la carta.')
        + (p.pm.text ? '<span class="pick-raw">' + esc(p.pm.text) + '</span>' : '') + '</p>';
    } else if (p.proc) {
      body += '<p class="pick-req"><span class="t-tag">Procedimiento</span>' + esc(p.proc.text) + '</p>';
    } else if (p.method === 'pendulum' && scalesSet()) {
      const [l, r] = ['st0', 'st4'].map((z) => db.get(S.zones[z][0].id));
      const lo = Math.min(l.scaleL, r.scaleR), hi = Math.max(l.scaleL, r.scaleR);
      body += '<p class="pick-req"><span class="t-tag">Escalas</span>' + lo + ' y ' + hi + ': puedes invocar monstruos de Nivel ' + (lo + 1) + ' a ' + (hi - 1) + '.</p>';
    }
    body += '<p class="pick-stats">' + esc(pickStats(p, c)) + '</p>';
    const asg = p.method === 'pendulum' ? pendAssign(p) : null;
    body += '<div class="pick-chips"><span class="pick-label">Elegidas (' + p.picks.length + '):</span>'
      + (p.picks.length ? p.picks.map((u) => {
        const a = asg && asg.find((x) => x.uid === u);
        return '<button type="button" class="pick-chip" data-unpick="' + u + '" title="Quitar">' + esc(nameOf(u))
          + (a ? ' → ' + esc(a.zone ? placeName(a.zone) : 'sin zona') : '') + ' <span aria-hidden="true">×</span></button>';
      }).join('') : '<span class="pick-none">ninguna todavía</span>') + '</div>';

    let row = '';
    const req = p.method === 'pendulum' ? null : pickReq(p);
    if (p.method !== 'special' && !isNormalMethod(p.method)) {
      // Qué permite la invocación: su procedimiento (tu Fase Principal, cadena vacía) o un efecto de la cadena
      const opt = (k, l) => '<option value="' + esc(k) + '"' + (k === p.src ? ' selected' : '') + '>' + esc(l) + '</option>';
      row += '<label><span>Por</span><select id="fd-pick-src">'
        + opt('', p.method === 'fusion' || p.method === 'ritual' ? 'Sin indicar el efecto' : 'Su procedimiento (sin efecto)')
        + ownLinkOpts((k, l) => opt(k, l), () => false)
        + opt('other', 'Otro efecto') + '</select></label>';
    }
    if (p.method !== 'pendulum') {
      const zones = legalZones(p.uid, p.picks, p.method);
      const auto = req.zone;
      const list = zones.slice();
      if (p.zone && !list.includes(p.zone)) list.push(p.zone);
      row += '<label><span>Zona</span><select id="fd-pick-zone"><option value="">Elegir zona (' + esc(p.zone ? 'automática' : auto ? placeName(auto) : 'no hay libres') + ')</option>'
        + list.map((z) => '<option value="' + z + '"' + (z === p.zone ? ' selected' : '') + '>' + esc(placeName(z) + (zones.includes(z) ? '' : ' (no válida)')) + '</option>').join('')
        + '</select></label>';
    }
    // La Invocación por Sacrificio es siempre en ATK boca arriba (y la Colocación, boca abajo en DEF)
    if (p.method !== 'link' && p.method !== 'tributeSet' && p.method !== 'tribute') {
      row += '<div class="seg" role="group" aria-label="Posición">' + [['atk', 'ATK'], ['def', 'DEF']].map(([k, l]) =>
        '<button type="button" data-pickpos="' + k + '" aria-pressed="' + (p.position === k) + '">' + l + '</button>').join('') + '</div>';
    }
    if (p.method === 'fusion' || p.method === 'ritual' || p.method === 'special') {
      const dests = [['gy', p.method === 'special' ? 'Al cementerio' : 'Materiales al cementerio'], ['ban', 'Desterrarlos']];
      if (p.method === 'special') dests.push(['back', 'Al Mazo / Extra Deck']);
      row += '<div class="seg" role="group" aria-label="Destino de los materiales">' + dests.map(([k, l]) =>
        '<button type="button" data-mdest="' + k + '" aria-pressed="' + (p.matDest === k) + '">' + l + '</button>').join('') + '</div>';
    }
    if (row) body += '<div class="pick-row">' + row + '</div>';
    const v = p.method === 'pendulum' ? pendVerdict(p, asg) : verifySummon(req);
    body += checksHtml(v, 'Jugada legal según el texto de las cartas.');
    $('#fd-pick').innerHTML = body;
    $('#fd-confirm').textContent = v.ok ? 'Confirmar' : 'Confirmar…';
  }

  /** Línea de cuentas para elegir materiales: niveles, rangos o cuántos cuentan para el Link. */
  function pickStats(p, c) {
    const found = p.picks.map((u) => find(u)).filter(Boolean);
    const mats = found.map((x) => x.c);
    const lvs = found.map((x) => levelOf(x.inst, x.c)); // con el Nivel cambiado por efectos, si lo hay
    const sum = lvs.reduce((s, n) => s + n, 0);
    switch (p.method) {
      case 'synchro':
      case 'ritual':
        return 'Niveles: ' + (lvs.length ? lvs.join(' + ') + ' = ' + sum : '0') + ' · ' + q(c.name) + ' es Nivel ' + c.lv;
      case 'xyz':
        return 'Niveles: ' + (lvs.join(', ') || '—') + ' · ' + q(c.name) + ' es Rango ' + c.lv;
      case 'link': {
        const max = mats.reduce((s, x) => s + (x.isLink ? x.lv : 1), 0);
        return 'Materiales: ' + mats.length + (max !== mats.length ? ' (cuentan como ' + mats.length + ' a ' + max + ')' : '') + ' · ' + q(c.name) + ' es LINK-' + c.lv;
      }
      case 'tribute':
      case 'tributeSet':
        return 'Sacrificios: ' + mats.length + ' de ' + p.need + ' · ' + q(c.name) + ' es Nivel ' + c.lv;
      case 'pendulum':
        return 'Niveles: ' + (lvs.join(', ') || '—');
      case 'special':
        return 'Cartas elegidas: ' + mats.length;
      default:
        return 'Materiales: ' + mats.length;
    }
  }

  function chainHtml(strip) {
    const n = S.chain.length;
    const head = strip
      ? '<button type="button" class="chain-toggle" data-chain="fold" aria-expanded="' + !chainFolded + '"><b>Cadena</b> · ' + n + (n === 1 ? ' eslabón' : ' eslabones')
        + '<span class="chev" aria-hidden="true">' + (chainFolded ? '▸' : '▾') + '</span></button>'
      : '<header class="chain-head"><h3>Cadena</h3><span class="count">' + n + '</span></header>';
    if (!n) return head + '<p class="chain-empty">Sin cadena abierta. Al activar un efecto aparece aquí.</p>';
    if (strip && chainFolded) return head;
    // Eslabones del rival en rojo; cada eslabón se puede marcar como negado (p. ej. por Called by the Grave)
    const paused = S.chain.some((l) => l.done);
    return head + '<ol class="chain-list">' + S.chain.map((l, i) => {
      const opp = l.owner === 'opp';
      const neg = l.negated;
      if (l.done) {
        return '<li class="' + (opp ? 'opp' : 'mine') + ' done' + (neg ? ' negated' : '') + '"><span class="cl">CL' + (i + 1) + '</span><span class="cl-body">'
          + (opp ? '<span class="cl-who">Rival</span>' : '') + '<b>' + esc(nameById(l.id)) + '</b><span class="cl-done">Resuelto</span>'
          + (!opp && !neg ? '<span class="cl-hint">Hazlo ahora en el campo</span>' : '') + '</span></li>';
      }
      return '<li class="' + (opp ? 'opp' : 'mine') + (neg ? ' negated' : '') + '"><span class="cl">CL' + (i + 1) + '</span><span class="cl-body">'
        + (opp ? '<span class="cl-who">Rival</span>' : '') + '<b>' + esc(nameById(l.id)) + '</b>'
        + (l.scale ? ' <span class="cl-fx">Escala</span>' : !opp && l.effectIndex ? ' <span class="cl-fx">efecto ' + l.effectIndex + '</span>' : '')
        + (neg ? '<span class="cl-neg">' + (neg.fizzle ? 'Sin su carta' : 'Negado') + (neg.by ? ' · por ' + esc(byText(neg.by)) : '') + '</span>'
          + (opp ? '' : '<span class="cl-hint">' + (neg.fizzle ? 'Ya no puede usar la carta desterrada' : 'No hagas lo que dice este efecto') + '</span>') : '')
        + (l.text ? '<span class="cl-text">' + esc(l.text) + '</span>' : '') + '</span>'
        + '<button type="button" class="cl-negbtn" data-neg="' + i + '" aria-pressed="' + !!neg + '" title="'
        + (neg ? 'Quitar la marca de negado' : 'Marcar como negado (por ejemplo, con Called by the Grave)') + '">' + (neg ? 'Quitar' : 'Negado') + '</button></li>';
    }).join('') + '</ol>'
      + '<div class="chain-btns"><button type="button" class="primary" data-chain="resolve">' + (paused ? 'Seguir resolviendo' : 'Resolver cadena') + '</button>'
      + '<button type="button" data-chain="undo">Deshacer última declaración</button></div>';
  }
  function renderChain() {
    $('#fd-chain').innerHTML = chainHtml(false);
    const strip = $('#fd-chain-strip');
    strip.hidden = !S.chain.length;
    strip.innerHTML = S.chain.length ? chainHtml(true) : '';
  }

  function logHtml() {
    if (!S.log.length) return '<p class="log-empty">Todavía no hay jugadas. Lo que declares queda anotado aquí.</p>';
    let html = '';
    let turn = null;
    S.log.forEach((e) => {
      if (e.turn !== turn) {
        if (turn !== null) html += '</ol>';
        turn = e.turn;
        html += '<h4 class="log-turn">Turno ' + esc(e.turn) + ' · ' + (e.mine === false ? 'Turno rival' : 'Tu turno') + '</h4><ol class="log-list">';
      }
      const why = (e.illegal && Array.isArray(e.reasons) ? e.reasons : []).map((m) => '<li class="err">' + esc(m) + '</li>')
        .concat((Array.isArray(e.warnings) ? e.warnings : []).map((m) => '<li class="warn">' + esc(m) + '</li>'));
      html += '<li class="log-e k-' + esc(e.kind || 'manual') + (e.illegal ? ' illegal' : '') + (e.warnings && e.warnings.length ? ' warned' : '') + '">'
        + '<span class="log-text">' + esc(e.text) + '</span>' + (e.illegal ? ' <span class="chip-illegal">Ilegal</span>' : '')
        + (why.length ? '<ul class="log-why">' + why.join('') + '</ul>' : '') + '</li>';
    });
    return html + '</ol>';
  }
  function renderLog() {
    const box = $('#fd-log');
    box.innerHTML = '<header class="chain-head"><h3>Registro</h3><span class="count">' + S.log.length + '</span></header><div class="log-scroll">' + logHtml() + '</div>';
    if (S.log.length !== logSeen) {
      const sc = $('.log-scroll', box);
      sc.scrollTop = sc.scrollHeight;
      logSeen = S.log.length;
    }
  }
  function openLog() {
    openDialog('Registro del duelo', '<div class="log-modal">' + logHtml() + '</div>', [{ label: 'Cerrar', kind: 'primary' }]);
    const b = $('#modal-body');
    b.scrollTop = b.scrollHeight;
    const box = $('#modal .modal-box');
    box.scrollTop = box.scrollHeight;
  }

  function renderSide() {
    const side = $('#fd-side');
    const loc = selected && locate(selected);
    if (!loc) {
      selected = null;
      document.body.classList.remove('fd-selected');
      $('#fd-actions').innerHTML = '';
      side._acts = [];
      const p = pending && pending.kind === 'summon' && find(pending.uid);
      $('#fd-detail').innerHTML = p ? '<p class="fd-where">Invocando</p>' + view.detail(p.c)
        : '<div class="detail-empty"><div class="card-back" aria-hidden="true"></div>'
        + '<p>Toca una carta para ver qué puedes hacer con ella. Toca una zona libre para colocarla, o arrástrala.</p></div>';
      return;
    }
    document.body.classList.add('fd-selected');
    const inst = loc.list[loc.index];
    const c = cardOf(inst);
    const t = S.turnState;
    let where = loc.area === 'field' ? (loc.index ? 'Material de un monstruo' : 'En el campo' + (inst.faceDown ? ', boca abajo' : '') + (inst.def ? ', en DEF' : ''))
      : 'En ' + PILE_NAMES[loc.area].toLowerCase();
    if (loc.area === 'field' && !loc.index && inst.summonMethod && inst.summonedTurn === t.turn) where += ' · ' + (METHOD[inst.summonMethod] || 'Invocación') + ' este turno';
    if (loc.area === 'field' && isNegated(inst)) where += ' · Efectos negados (por ' + byText(inst.negated.by) + ')';
    $('#fd-detail').innerHTML = '<p class="fd-where">' + esc(where) + '</p>' + (inst.token ? tokenDetail(c) : view.detail(c));
    const acts = actionsFor(selected);
    $('#fd-actions').innerHTML = '<p class="fd-act-name">' + esc(c.name) + '</p><div class="fd-act-grid">'
      + acts.map((a, i) => (a.group ? '<p class="fd-act-group">' + esc(a.group) + '</p>'
        : '<button type="button" data-act="' + i + '" class="' + (a.kind || '') + '">' + esc(a.label) + '</button>')).join('')
      + '</div>';
    side._acts = acts;
  }

  function renderDeckSelect() {
    $('#fd-deck').innerHTML = decks().map((x) => '<option value="' + x.id + '"' + (x === d ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('');
  }

  /* ---------- Rival con handtraps (js/bot.js) ----------
   * El rival no juega su turno: solo responde a tus jugadas con las handtraps de su mano. Todo lo suyo vive en S.opp
   * (así "Deshacer" lo incluye). Cada llamada a YGO.bot pasa por botCall: si el módulo falta o falla, no hay rival. */
  const bot = () => { const B = window.YGO.bot; return B && typeof B === 'object' ? B : null; };
  function botCall(name, args, fallback) {
    const B = bot();
    if (B && typeof B[name] === 'function') {
      try { return B[name].apply(B, args); } catch (err) { console.warn('YGO.bot.' + name + ' falló', err); }
    }
    return typeof fallback === 'function' ? fallback() : fallback;
  }
  const oppOn = () => !!(S && S.opp && S.opp.enabled);
  /** Cuántas handtraps tiene el rival: 0 (sin rival) | 2 | 3 | '2-3'. */
  const normCount = (n) => (n === '2-3' ? '2-3' : Number(n) === 2 || Number(n) === 3 ? Number(n) : 0);
  const HT = () => { const B = bot(); return B && B.HANDTRAPS && typeof B.HANDTRAPS === 'object' ? B.HANDTRAPS : {}; };
  const shortName = (name) => { const h = HT()[name]; return (h && h.short) || name; };
  const idByName = (name) => { const h = HT()[name]; const c = (h && h.id && db.get(h.id)) || db.findByName(name); return c ? c.id : 0; };
  /** Lista de handtraps con al menos una copia ([{ name, copies }]); si no hay, la de fábrica. */
  function poolOf(pool) {
    const B = bot();
    const known = (n) => !B || typeof B.isHandtrap !== 'function' || B.isHandtrap(n);
    const ok = arr(pool).filter((x) => x && x.name && known(String(x.name)) && Math.floor(Number(x.copies)) > 0)
      .map((x) => ({ name: String(x.name), copies: Math.floor(Number(x.copies)) }));
    if (ok.length) return ok;
    return B ? arr(B.DEFAULT_POOL).map((x) => ({ name: x.name, copies: x.copies })) : [];
  }
  /** Opciones del rival: las de opts.bot o, si no vienen, las de las preferencias (ventana Nuevo duelo). */
  function botConfig(b) {
    freshPrefs();
    const count = normCount(prefs.botCount);
    const base = { enabled: count !== 0, count, mode: prefs.botMode === 'aggressive' ? 'aggressive' : 'smart', pool: poolOf(prefs.botPool) };
    if (!b || typeof b !== 'object') return base;
    const out = Object.assign({}, base, b);
    out.enabled = b.enabled !== false;
    out.count = normCount(b.count !== undefined ? b.count : count) || (arr(b.forceHand).length || '2-3');
    out.mode = out.mode === 'aggressive' ? 'aggressive' : 'smart';
    out.pool = poolOf(out.pool);
    return out;
  }
  function makeOpponent(cfg) {
    if (!cfg || !cfg.enabled || !bot()) return null;
    const o = { enabled: true, pool: cfg.pool, count: cfg.count, mode: cfg.mode, starters: arr(d.starters).slice() };
    if (typeof cfg.seed === 'number') o.seed = cfg.seed;
    if (Array.isArray(cfg.forceHand)) o.forceHand = cfg.forceHand.slice();
    const opp = botCall('newOpponent', [o], null);
    return opp && typeof opp === 'object' ? opp : null;
  }

  /** Avisa al rival de una jugada tuya: lleva sus cuentas (observe) y, en tu turno, decide si responde (consider).
   * Si responde, su eslabón entra a la cadena y sale la ventana "El rival responde". No toma foto propia:
   * "Deshacer" quita tu jugada y su respuesta juntas. */
  function botEvent(ev) {
    if (!oppOn()) return null;
    const notes = arr(botCall('observe', [S, ev], []));
    notes.forEach((n) => { if (n && n.text) pushLog(Object.assign({}, n, { kind: 'opp' })); });
    const r = S.turnState.mine && !pending ? botCall('consider', [S, ev], null) : null;
    if (!r || typeof r !== 'object') { if (notes.length) render(); return null; }
    const before = S.chain.length;
    const e = botCall('commit', [S, r], null);
    if (!e && S.chain.length === before) { if (notes.length) render(); return null; }
    if (S.chain.length > before) {
      const l = S.chain[S.chain.length - 1];
      l.owner = 'opp';
      // Foto de tu jugada a la que responde (para "Deshacer última declaración")
      if (l.snap == null && history.length) l.snap = histBase + history.length - 1;
    }
    pushLog(Object.assign({ text: r.text || 'El rival activa ' + q(r.handtrap || nameById(r.id)) }, e && typeof e === 'object' ? e : {}, { kind: 'opp' }));
    render();
    showOpp(r);
    return r;
  }

  /** Ventana "El rival responde": qué activó, sobre qué y (modo Inteligente) por qué ahora. */
  function showOpp(r) {
    if (document.body.dataset.mode !== 'campo') { oppQueued = r; return; }
    oppQueued = null;
    const c = db.get(r.id) || db.get(idByName(r.handtrap));
    const h = HT()[r.handtrap || (c && c.name)] || {};
    const smart = !S.opp || S.opp.mode !== 'aggressive';
    const body = '<div class="opp-resp">' + (c ? '<div class="opp-resp-card">' + view.tile(c) + '</div>' : '')
      + '<div class="opp-resp-text"><p class="opp-resp-line">' + esc(r.text || ('El rival activa ' + q(r.handtrap || ''))) + '</p>'
      + (smart && r.reason ? '<p class="opp-resp-why"><b>Por qué ahora:</b> ' + esc(r.reason) + '</p>' : '')
      + (h.what ? '<p class="hint">' + esc(h.what) + '</p>' : '') + '</div></div>'
      + '<p class="hint">Puedes responder declarando un efecto (por ejemplo «Called by the Grave» o «Crossout Designator»); si lo niegas, toca <b>Negado</b> en su eslabón. Si no respondes, toca <b>Resolver cadena</b>.</p>';
    openDialog('El rival responde', body, [{ label: 'Responder' }, { label: 'Resolver cadena', kind: 'primary', action: resolveChain }]);
  }

  /** Eslabón del rival negado: no hace nada. Su carta, si quedó en su campo, va al cementerio (o vuelve a su mano si es un monstruo). */
  function oppNegated(l, i) {
    if (bot() && typeof bot().negatedLink === 'function') { botCall('negatedLink', [S, i], null); return; }
    const o = S.opp;
    const k = arr(o && o.field).findIndex((x) => x && x.uid === l.uid);
    if (k < 0) return;
    const [card] = o.field.splice(k, 1);
    delete card.onChain;
    const c = db.get(card.id);
    if (c && db.isMonster(c)) { if (Array.isArray(o.hand)) o.hand.push(card); } else if (Array.isArray(o.gy)) o.gy.push(card);
  }
  /** Marca en el historial del rival que esa handtrap fue negada (para el resumen del intento). */
  function markOppHistory(l, on) {
    const h = arr(S.opp && S.opp.history);
    const name = l.handtrap || nameById(l.id);
    for (let k = h.length - 1; k >= 0; k--) {
      const x = h[k];
      if (x && (x.uid ? x.uid === l.uid : x.name === name && x.turn === S.turnState.turn) && !!x.negated !== on) { x.negated = on; return; }
    }
  }

  /** Aplica lo que hace un eslabón del rival al resolverse (ops de YGO.bot.resolveLink). */
  function applyOppOps(ops, l) {
    const src = l.handtrap || nameById(l.id);
    const logFrom = S.log.length;
    let tributed = [];
    let token = ''; // ficha ya anotada (el resumen del rival sobre ella sobra)
    arr(ops).forEach((op) => {
      if (!op || typeof op !== 'object') return;
      const by = byText(op.by || src);
      try {
        if (op.op === 'negateLink') {
          // fizzle (D.D. Crow): el eslabón no está negado, pero ya no puede usar la carta que se desterró
          const t = S.chain[op.index];
          if (t && !t.negated) t.negated = op.fizzle ? { by: op.by || src, fizzle: true } : { by: op.by || src };
        } else if (op.op === 'negateMonster') {
          const f = find(op.uid);
          if (!f || f.loc.area !== 'field') return;
          f.inst.negated = { turn: S.turnState.turn, by: op.by || src };
          pushLog({ kind: 'opp', text: 'Los efectos de ' + q(f.c.name) + ' quedan negados este turno (por ' + by + ')' });
        } else if (op.op === 'destroy') {
          const f = find(op.uid);
          if (!f || f.loc.area !== 'field') return;
          const went = leaveField(op.uid);
          pushLog({ kind: 'opp', text: q(f.c.name) + ' es destruido (por ' + by + ')' + (went === 'extra' ? ': va boca arriba al Extra Deck' : went === 'gone' ? ' y desaparece' : '') });
          if (went === 'extra') toast(PEND_TOAST);
        } else if (op.op === 'banish') {
          const f = find(op.uid);
          if (!f || f.loc.area !== 'gy') return;
          S.ban.push(S.gy.splice(f.loc.index, 1)[0]);
          pushLog({ kind: 'opp', text: q(f.c.name) + ' queda desterrada de tu Cementerio (por ' + by + ')' });
        } else if (op.op === 'tributeAll') tributed = tributeAll(by, op.uids);
        else if (op.op === 'token') { placeToken(op, tributed, by); token = op.name || 'Primal Being Token'; }
        else if (op.op === 'lock' && op.lock) {
          const lock = Object.assign({ source: src }, op.lock);
          run('addLock', [S, lock], () => { const t = S.turnState; if (!Array.isArray(t.locks)) t.locks = []; t.locks.push(lock); });
          pushLog({ kind: 'opp', text: lock.text || 'Bloqueo por ' + by + ' hasta el final del turno' });
        } else if (op.op === 'log' && op.text) {
          // Sin repetir lo que ya se anotó al aplicar este eslabón (p. ej. el texto del bloqueo de Droll o la ficha de Nibiru)
          const seen = S.log.slice(logFrom).some((e) => e && e.text === String(op.text)) || (token && String(op.text).includes(token));
          if (!seen) pushLog({ kind: 'opp', text: String(op.text) });
        }
      } catch (err) { console.warn('No se pudo aplicar el efecto del rival', op, err); }
    });
  }
  /** Una carta deja el campo por un efecto del rival: las fichas desaparecen; los Péndulo van boca arriba al Extra Deck. */
  function leaveField(uid) {
    const f = find(uid);
    if (!f) return null;
    if (f.inst.token) { takeStack(uid).slice(1).forEach((m) => S.gy.push(resetCard(m))); return 'gone'; }
    return sendMaterial(uid, 'gy') || 'gy';
  }
  /** Nibiru: se sacrifican todos los monstruos boca arriba de tu campo (o los de uids, si el rival los dice).
   * Devuelve sus ATK/DEF originales. */
  function tributeAll(by, uids) {
    const out = [];
    let pend = false;
    [...EMZ, ...MZ].forEach((z) => {
      const top = S.zones[z][0];
      if (!top || top.faceDown || (Array.isArray(uids) && !uids.includes(top.uid))) return;
      const c = cardOf(top);
      out.push({ name: c.name, atk: statNum(c.atk), def: c.isLink ? 0 : statNum(c.def) });
      if (leaveField(top.uid) === 'extra') pend = true;
    });
    pushLog({ kind: 'opp', text: out.length ? 'Se sacrifican ' + listEs(out.map((x) => q(x.name))) + ' (por ' + by + ')' : 'No hay monstruos boca arriba para sacrificar (' + by + ')' });
    if (pend) toast(PEND_TOAST);
    return out;
  }
  /** Ficha en tu campo (Primal Being Token): ATK/DEF = suma de los ATK/DEF originales de lo sacrificado. */
  function placeToken(op, tributed, by) {
    const name = op.name || 'Primal Being Token';
    const zone = firstEmpty(MZ);
    if (!zone) { pushLog({ kind: 'opp', text: 'No queda una Zona de Monstruo libre para ' + q(name) }); return; }
    const atk = typeof op.atk === 'number' ? op.atk : tributed.reduce((s, x) => s + x.atk, 0);
    const def = typeof op.def === 'number' ? op.def : tributed.reduce((s, x) => s + x.def, 0);
    const o2 = Object.assign({}, op, { name, atk, def });
    // La instancia la arma el rival si sabe (código virtual de la ficha); si no, aquí
    let inst = botCall('tokenInstance', [S, o2], null);
    if (!inst || typeof inst !== 'object' || !inst.uid || !inst.token) {
      inst = game.instance(Number(op.id) || idByName(name) || 0);
      inst.token = { name, atk, def, level: op.level || 11, attribute: op.attribute || 'LIGHT', race: op.race || 'Rock' };
      inst.summonedTurn = S.turnState.turn;
      inst.summonMethod = 'special';
      inst.def = op.position === 'def';
    }
    S.zones[zone].push(inst);
    pushLog({ kind: 'opp', text: 'El rival invoca ' + q(name) + ' (ATK ' + atk + ' / DEF ' + def + ') en tu ' + placeName(zone) + (inst.def ? ', en DEF' : '') + ' (por ' + by + ')' });
  }

  /** Resumen del rival para el intento: { initialHand, used: [{ name, turn, on, negated }], unused, drew }. */
  function oppSummary() {
    const o = S.opp;
    if (!o) return { initialHand: [], used: [], unused: [], drew: 0 };
    const s = botCall('summary', [S], null);
    if (s && typeof s === 'object') {
      return { initialHand: arr(s.initialHand), used: arr(s.used).filter((u) => u && u.name), unused: arr(s.unused), drew: Number(s.drew) || 0 };
    }
    return {
      initialHand: arr(o.initialHand),
      used: arr(o.history).map((h) => ({ name: h.name, turn: h.turn, on: h.on || (typeof h.target === 'string' ? h.target : ''), negated: !!h.negated })),
      unused: arr(o.hand).filter((x) => x && !x.blank).map((x) => nameById(x.id)), drew: 0,
    };
  }

  /* ---------- Franja del rival (sobre el tablero) ---------- */
  function renderOpp() {
    const box = $('#fd-opp');
    const st = attemptStats();
    const statsBtn = '<button type="button" class="opp-btn opp-stats" data-opp="stats">Intentos'
      + (st && st.total ? ' · ' + st.total + (st.pct !== null ? ' (' + game.pct(st.pct) + ')' : '') : '') + '</button>';
    if (!oppOn()) {
      box.className = 'fd-opp off';
      box.innerHTML = '<span class="opp-tag">Rival</span><span class="opp-off">' + (bot() ? 'Sin handtraps' : 'No disponible') + '</span>'
        + (bot() ? '<button type="button" class="opp-btn go" data-opp="setup">Jugar contra handtraps…</button>' : '') + statsBtn;
      return;
    }
    const o = S.opp;
    const hand = arr(o.hand);
    const show = !!revealed[S.duelId];
    const chip = (id, cls, title) => (id ? '<button type="button" class="opp-chip' + (cls ? ' ' + cls : '') + '" data-oppcard="' + id + '" title="' + esc(title || nameById(id)) + '">'
      + esc(shortName(nameById(id))) + '</button>' : '<span class="opp-chip blank">Otra carta</span>');
    const handHtml = show ? (hand.length ? hand.map((x) => chip(x && !x.blank ? x.id : 0)).join('') : '<span class="opp-none">sin cartas</span>')
      : '<span class="opp-backs" aria-hidden="true">' + hand.map(() => '<i></i>').join('') + '</span>';
    const used = arr(o.history).map((h) => {
      const on = h.on || (typeof h.target === 'string' ? h.target : '');
      return chip(idByName(h.name), 'used' + (h.negated ? ' neg' : ''), h.name + (on ? ' → ' + on : '') + (h.negated ? ' (negada)' : ''));
    }).join('');
    const field = arr(o.field).map((x) => chip(x && x.id)).join('');
    const locks = arr(S.turnState.locks).filter((l) => l && l.kind === 'noDeckAdd')
      .map((l) => '<span class="opp-lock" title="' + esc(l.text || '') + '">' + esc(shortName(l.source || 'Droll & Lock Bird')) + ': no añades del Mazo</span>').join('');
    box.className = 'fd-opp';
    box.innerHTML = '<span class="opp-tag">Rival</span><span class="opp-mode">' + (o.mode === 'aggressive' ? 'Agresivo' : 'Inteligente') + '</span>'
      + '<span class="opp-group opp-hand" aria-label="Mano del rival: ' + hand.length + ' cartas"><span class="opp-label">Mano</span>' + handHtml
      + (show ? '' : '<b class="opp-n">' + hand.length + '</b>')
      + '<button type="button" class="opp-btn" data-opp="reveal" aria-pressed="' + show + '">' + (show ? 'Ocultar mano' : 'Ver mano') + '</button></span>'
      + (field ? '<span class="opp-group"><span class="opp-label">En su campo</span>' + field + '</span>' : '')
      + (used ? '<span class="opp-group"><span class="opp-label">Usó</span>' + used + '</span>' : '')
      + locks + statsBtn;
  }
  function showCard(id) {
    const c = db.get(id);
    if (c) openDialog(c.name, '<div class="modal-detail">' + view.detail(c) + '</div>', [{ label: 'Cerrar', kind: 'primary' }]);
  }

  /* ---------- Nuevo duelo: turno, rival y lista de handtraps ---------- */
  /** opts.deck: mazo nuevo (al cambiar el selector). state: lo elegido (al volver de la lista de handtraps).
   * Si hay jugadas anotadas, el título avisa que se borran. Lo elegido se recuerda en las preferencias. */
  function openSetup(opts, state) {
    opts = opts || {};
    const B = bot();
    if (!state) freshPrefs();
    const st = state || {
      second: !!prefs.fieldSecond, count: normCount(prefs.botCount), mode: prefs.botMode === 'aggressive' ? 'aggressive' : 'smart',
      pool: poolOf(prefs.botPool), same: false,
    };
    // "Jugar contra handtraps…" de la franja: ya viene con rival (2–3 al azar si no había)
    if (!state && opts.wantBot && st.count === 0) st.count = '2-3';
    const busy = hasPlays();
    const canSame = !opts.deck && !!(S && S.start && d && S.start.deckId === d.id);
    const seg = (id, key, items, cur) => '<div class="seg" id="' + id + '" role="group">' + items.map(([v, l]) => '<button type="button" data-' + key + '="' + v
      + '" aria-pressed="' + (String(v) === String(cur)) + '">' + l + '</button>').join('') + '</div>';
    const body = (busy ? '<p class="setup-warn">Se borra la partida actual: el campo, la cadena y el registro de jugadas.</p>' : '')
      + (opts.deck ? '<p class="hint">Mazo: <b>' + esc(opts.deck.name) + '</b></p>' : '')
      + '<div class="field"><span>Turno</span>' + seg('su-turn', 'second', [['0', 'Primero · 5 cartas'], ['1', 'Segundo · 6 cartas']], st.second ? '1' : '0')
      + '<p class="hint su-note" id="su-turn-note"></p></div>'
      + '<div class="field"><span>Rival</span>' + (B ? seg('su-count', 'count', [['0', 'Sin handtraps'], ['2', '2'], ['3', '3'], ['2-3', '2–3 al azar']], st.count)
        : '<p class="hint">El rival con handtraps no está disponible.</p>') + '</div>'
      + (B ? '<div class="field su-bot"><span>Modo</span>' + seg('su-mode', 'mode', [['smart', 'Inteligente'], ['aggressive', 'Agresivo']], st.mode)
        + '<p class="hint su-note" id="su-mode-note"></p></div>'
        + '<p class="su-pool su-bot"><span id="su-pool-sum"></span> <button type="button" class="link-btn" id="su-pool">Editar lista de handtraps…</button></p>' : '')
      + (canSame ? '<label class="switch su-same"><input type="checkbox" id="su-same"' + (st.same ? ' checked' : '') + '><span>Repetir la mano inicial de este duelo</span></label>' : '');
    openDialog(busy ? '¿Empezar un duelo nuevo?' : 'Nuevo duelo', '<div class="setup">' + body + '</div>', [
      { label: 'Cancelar' },
      { label: busy ? 'Nuevo duelo' : 'Empezar', kind: 'primary', action: () => startFromSetup(st, opts) },
    ]);
    const root = $('#modal-body');
    const sync = () => {
      $$('#su-turn [data-second]', root).forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.second === '1') === st.second)));
      $('#su-turn-note', root).textContent = st.second ? 'Robas la 6ª carta en la Fase de Robo. Es el turno 2: hay Fase de Batalla.'
        : 'Empiezas con 5 cartas: no robas y no hay Fase de Batalla.';
      if (!B) return;
      $$('#su-count [data-count]', root).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.count === String(st.count))));
      $$('#su-mode [data-mode]', root).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === st.mode)));
      $$('.su-bot', root).forEach((el) => { el.hidden = st.count === 0; });
      $('#su-mode-note', root).textContent = st.mode === 'aggressive' ? 'Usa cada handtrap en el primer momento legal.'
        : 'Guarda sus handtraps para el golpe más dañino (tus starters ★), sin dejar pasar todo tu turno.';
      const copies = st.pool.reduce((s, x) => s + x.copies, 0);
      $('#su-pool-sum', root).textContent = 'Lista: ' + nOf(st.pool.length, 'carta') + ' · ' + nOf(copies, 'copia') + '.';
    };
    root.querySelectorAll('[data-second], [data-count], [data-mode]').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.second) st.second = b.dataset.second === '1';
      if (b.dataset.count) st.count = normCount(b.dataset.count);
      if (b.dataset.mode) st.mode = b.dataset.mode === 'aggressive' ? 'aggressive' : 'smart';
      sync();
    }));
    const pb = $('#su-pool', root);
    if (pb) pb.addEventListener('click', () => openPool(st, () => openSetup(opts, st)));
    const same = $('#su-same', root);
    if (same) same.addEventListener('change', () => { st.same = same.checked; });
    sync();
  }
  function startFromSetup(st, opts) {
    savePref({ fieldSecond: st.second, botCount: st.count, botMode: st.mode, botPool: st.pool });
    if (opts.deck) d = opts.deck;
    const bot0 = { enabled: st.count !== 0, count: st.count, mode: st.mode, pool: st.pool };
    if (st.same && !opts.deck) restartSameHand({ second: st.second, bot: bot0 });
    else newDuel(null, null, { second: st.second, bot: bot0 });
    renderDeckSelect();
  }
  /** Lista de handtraps del rival: copias de 0 al máximo de la banlist TCG. */
  function openPool(st, back) {
    const H = HT();
    const cur = new Map(st.pool.map((x) => [x.name, x.copies]));
    const draft = Object.keys(H).filter((n) => idByName(n)).map((n) => {
      const lim = Number(H[n] && H[n].limit);
      const max = Math.max(0, Math.min(3, isNaN(lim) ? 3 : lim, db.banLimit(idByName(n))));
      return { name: n, copies: Math.min(max, cur.get(n) || 0), max };
    });
    const total = () => draft.reduce((s, x) => s + x.copies, 0);
    const row = (x, i) => '<div class="pool-row"><div class="pool-info"><b class="pool-name">' + esc(x.name) + '</b>'
      + (H[x.name].what ? '<span class="hint">' + esc(H[x.name].what) + '</span>' : '')
      + (x.max < 3 ? '<span class="pool-lim">' + (x.max === 2 ? 'Semilimitada: máx. 2' : x.max === 1 ? 'Limitada: máx. 1' : 'Prohibida') + '</span>' : '') + '</div>'
      + '<div class="stepper"><button type="button" data-pool="' + i + '" data-d="-1" aria-label="Quitar una copia">−</button><b id="pool-n' + i + '">' + x.copies
      + '</b><button type="button" data-pool="' + i + '" data-d="1" aria-label="Agregar una copia">+</button></div></div>';
    const need = st.count === 3 || st.count === '2-3' ? 3 : 2; // las que puede robar el rival
    const totalText = () => 'Total: ' + nOf(total(), 'copia') + (!total() ? ' · pon al menos 1 copia'
      : total() < need ? ' · pon al menos ' + need + ' para que el rival pueda tener ' + need + ' handtraps' : '');
    openDialog('Lista de handtraps', '<p class="hint">El rival roba sus handtraps al azar de esta lista (respeta la banlist TCG).</p>'
      + '<div class="pool-list">' + draft.map(row).join('') + '</div><p class="pool-total" id="pool-total">' + esc(totalText()) + '</p>', [
      { label: 'Restablecer', kind: 'link-btn', action: () => { st.pool = poolOf(null); openPool(st, back); } },
      { label: 'Cancelar', action: back },
      { label: 'Listo', kind: 'primary', action: () => {
        const list = draft.filter((x) => x.copies > 0).map((x) => ({ name: x.name, copies: x.copies }));
        st.pool = list.length ? list : poolOf(null);
        back();
      } },
    ]);
    const root = $('#modal-body');
    // "Listo" sin copias no vale (antes volvía en silencio a la lista de fábrica)
    const done = $$('#modal-foot button').find((b) => b.textContent === 'Listo');
    const upd = () => {
      $('#pool-total', root).textContent = totalText();
      $('#pool-total', root).classList.toggle('bad', !total());
      if (done) done.disabled = !total();
    };
    $$('[data-pool]', root).forEach((b) => b.addEventListener('click', () => {
      const x = draft[Number(b.dataset.pool)];
      x.copies = Math.max(0, Math.min(x.max, x.copies + Number(b.dataset.d)));
      $('#pool-n' + b.dataset.pool, root).textContent = x.copies;
      upd();
    }));
    upd();
  }

  /** Duelo nuevo con la misma mano inicial del actual (al pasar a ir primero, la 6ª carta, que fue el robo, vuelve al mazo).
   * o: { second, keepBot (mismas handtraps del rival), bot (otra configuración del rival) }. */
  function restartSameHand(o) {
    const st = S && S.start;
    const cfg = { second: !!o.second, bot: Object.assign({}, o.bot || (st && st.bot) || botConfig()) };
    if (o.keepBot && S && S.opp) {
      cfg.bot.forceHand = arr(S.opp.initialHand).slice();
      if (typeof S.opp.seed === 'number') cfg.bot.seed = S.opp.seed;
    }
    if (!st || st.deckId !== d.id) { newDuel(null, null, cfg); return; }
    let hand = st.hand.slice();
    if (!cfg.second && st.second) hand = hand.slice(0, 5);
    newDuel(hand, restOf(hand), cfg);
  }

  /* ---------- Intentos (js/attempts.js) ----------
   * Un intento termina al pasar tu turno contra el rival o con "Terminar intento": se guarda y sale el resumen. */
  function aCall(name, args, fallback) {
    const A = window.YGO.attempts;
    if (A && typeof A[name] === 'function') {
      try { const v = A[name].apply(A, args); if (v !== undefined) return v; } catch (err) { console.warn('YGO.attempts.' + name + ' falló', err); }
    }
    return fallback;
  }
  const attemptTarget = () => (d ? arr(aCall('target', [d.id], [])) : []);
  const attemptStats = () => (d ? aCall('stats', [d.id], null) : null);
  /** Nombres de las cartas en tu campo (las de encima de cada zona). */
  const boardNames = () => FIELD_ZONES.map((z) => S.zones[z][0]).filter(Boolean).map((x) => cardOf(x)).filter(Boolean).map((c) => c.name);

  function endAttempt() {
    if (!S || !d) return;
    const sum = oppSummary();
    const board = boardNames();
    const target = attemptTarget();
    const ev = aCall('evaluate', [target, board], null) || { pass: null, missing: [] };
    const rec = {
      deckName: d.name, second: !!(S.start && S.start.second), rival: oppOn(), mode: S.opp ? S.opp.mode : null,
      count: S.start && S.start.bot && S.start.bot.enabled ? S.start.bot.count : 0, turn: S.turnState.turn,
      hand: arr(S.start && S.start.hand).map(nameById), botHand: sum.initialHand.slice(), used: sum.used, unused: sum.unused, drew: sum.drew,
      board, hasTarget: target.length > 0, auto: ev.pass, missing: arr(ev.missing),
    };
    let att = null;
    if (recorded && recorded.duelId === S.duelId) {
      // Ya se guardó este duelo: se actualiza (lo que respondiste a mano se respeta)
      const old = aCall('get', [d.id, recorded.id], null);
      rec.passed = old && old.manual ? old.passed : ev.pass;
      att = aCall('update', [d.id, recorded.id, rec], null);
    }
    if (!att) {
      rec.passed = ev.pass;
      att = aCall('add', [d.id, rec], null);
      if (att) recorded = { duelId: S.duelId, id: att.id };
    }
    render();
    openSummary(att || rec);
  }

  const chipList = (names, cls) => names.map((n) => '<span class="sum-chip' + (cls ? ' ' + cls : '') + '">' + esc(n) + '</span>').join('');
  function summaryHtml(att) {
    const res = att.passed === true ? ['pass', 'Tu campo pasó'] : att.passed === false ? ['fail', 'Tu campo no pasó'] : ['unknown', 'Sin responder'];
    let auto = att.hasTarget ? (att.auto ? 'Tienes todo tu campo objetivo.' : 'Te falta del campo objetivo: ' + listEs(arr(att.missing).map(q)) + '.')
      : 'Sin campo objetivo: respóndelo tú.';
    // Tu respuesta manda sobre la evaluación automática: se dice cuando no coinciden
    if (att.hasTarget && att.manual && typeof att.auto === 'boolean' && typeof att.passed === 'boolean' && att.passed !== att.auto) {
      auto = auto.slice(0, -1) + (att.passed ? ', pero marcaste que pasó igual.' : ', pero marcaste que no pasó.');
    }
    const usedNames = arr(att.used).map((u) => u.name);
    const target = attemptTarget();
    return '<div class="summary">'
      + '<div class="sum-result ' + res[0] + '"><b>' + res[1] + '</b><span class="hint">' + esc(auto) + '</span>'
      + '<div class="sum-ask"><span>¿Tu campo pasó?</span><div class="seg" role="group" aria-label="¿Tu campo pasó?">'
      + '<button type="button" data-pass="1" aria-pressed="' + (att.passed === true) + '">Sí</button><button type="button" data-pass="0" aria-pressed="' + (att.passed === false) + '">No</button></div></div></div>'
      + (att.rival
        ? '<section><h3>Mano del rival</h3><div class="sum-chips">' + arr(att.botHand).map((n) => '<span class="sum-chip' + (usedNames.includes(n) ? ' used' : '') + '">' + esc(n) + '</span>').join('')
          + (att.drew ? '<span class="hint">+ ' + att.drew + ' robada' + (att.drew > 1 ? 's' : '') + '</span>' : '') + '</div></section>'
          + '<section><h3>Lo que usó</h3>' + (arr(att.used).length ? '<ul class="sum-used">' + att.used.map((u) => '<li><b>' + esc(u.name) + '</b>'
            + (u.on ? ' en ' + esc(u.on) : '') + (u.turn ? ' · turno ' + esc(u.turn) : '')
            + (u.unresolved ? ' <span class="sum-neg">No se resolvió</span>' : u.negated ? ' <span class="sum-neg">Negada</span>' : '') + '</li>').join('') + '</ul>'
            : '<p class="hint">No usó ninguna handtrap.</p>') + '</section>'
          + '<section><h3>Se guardó</h3>' + (arr(att.unused).length ? '<div class="sum-chips">' + chipList(att.unused) + '</div>' : '<p class="hint">Nada: usó todo lo que tenía.</p>') + '</section>'
        : '<p class="hint">Este intento fue sin rival.</p>')
      + '<section><h3>Tu campo al final</h3>' + (arr(att.board).length ? '<div class="sum-chips">' + arr(att.board).map((n) => '<span class="sum-chip' + (target.includes(n) ? ' goal' : '') + '">' + esc(n) + '</span>').join('') + '</div>'
        : '<p class="hint">Tu campo quedó vacío.</p>')
      + (S && boardNames().length ? '<button type="button" class="link-btn" data-sum="target">Guardar este campo como objetivo</button>' : '') + '</section>'
      + '</div>';
  }
  function openSummary(att) {
    const second = !!(S.start && S.start.second);
    openDialog('Resumen del intento', summaryHtml(att), [
      { label: 'Seguir jugando' },
      { label: 'Misma mano, otras handtraps', action: () => restartSameHand({ second }) },
      { label: 'Siguiente intento (mano nueva)', kind: 'primary', action: () => newDuel(null, null, { second, bot: S.start ? S.start.bot : undefined }) },
    ]);
    bindSummary(att);
  }
  function bindSummary(att) {
    const root = $('#modal-body');
    const redraw = (a) => { root.innerHTML = summaryHtml(a); bindSummary(a); render(); };
    $$('[data-pass]', root).forEach((b) => b.addEventListener('click', () => {
      const passed = b.dataset.pass === '1';
      redraw((att.id && aCall('update', [d.id, att.id, { passed, manual: true }], null)) || Object.assign(att, { passed }));
    }));
    const t = $('[data-sum="target"]', root);
    if (t) t.addEventListener('click', () => {
      const board = boardNames();
      aCall('setTarget', [d.id, board], null);
      const ev = aCall('evaluate', [board, att.board], null) || { pass: null, missing: [] };
      const patch = { hasTarget: true, auto: ev.pass, missing: arr(ev.missing) };
      if (!att.manual) patch.passed = ev.pass;
      toast('Campo objetivo guardado: ' + board.length + ' carta' + (board.length === 1 ? '' : 's'), 'ok');
      redraw((att.id && aCall('update', [d.id, att.id, patch], null)) || Object.assign(att, patch));
    });
  }

  /** Ventana "Intentos": % que pasa tu campo, por turno y por handtrap, y el campo objetivo del mazo. */
  function statsHtml() {
    const s = attemptStats() || { total: 0, traps: [] };
    const pct = (x) => (x.pct === null || x.pct === undefined ? '—' : game.pct(x.pct));
    const part = (label, x) => label + ': ' + (x && x.answered ? x.passed + ' de ' + x.answered + ' (' + pct(x) + ')' : '—');
    const target = attemptTarget();
    const recent = arr(aCall('list', [d.id], [])).slice(-8).reverse();
    let html = '';
    if (!s.total) {
      html += '<p class="hint">Todavía no hay intentos con este mazo. Empieza un duelo contra handtraps (<b>Nuevo duelo</b> → Rival) y pasa tu turno: cada turno cuenta como un intento.</p>';
    } else {
      html += '<p class="st-big"><b>' + pct(s) + '</b> de las veces tu campo pasó · ' + s.passed + ' de ' + s.answered + ' intento' + (s.answered === 1 ? '' : 's') + '</p>'
        + '<p class="hint">' + part('Yendo primero', s.first) + ' · ' + part('Yendo segundo', s.second) + '</p>'
        + (s.answered < s.total ? '<p class="hint">' + (s.total - s.answered) + ' sin responder "¿Tu campo pasó?" (no cuentan para el %).</p>' : '')
        + (s.worst ? '<p class="st-worst">La que más te cortó: <b>' + esc(s.worst.name) + '</b> (' + s.worst.stopped + ' ' + (s.worst.stopped === 1 ? 'vez' : 'veces') + ')</p>' : '');
      if (s.traps.length) {
        html += '<div class="st-table-wrap"><table class="st-table"><thead><tr><th>Handtrap</th><th class="num">La tuvo</th><th class="num">La usó</th><th class="num">Pasaste igual</th></tr></thead><tbody>'
          + s.traps.map((t) => '<tr><td>' + esc(t.name) + '</td><td class="num">' + t.seen + '</td><td class="num">' + t.used + '</td><td class="num">'
            + (t.usedAnswered ? t.usedPassed + ' <span class="st-pct">(' + game.pct(t.usedPassed / t.usedAnswered) + ')</span>' : '—') + '</td></tr>').join('') + '</tbody></table></div>';
      }
    }
    html += '<section><h3>Campo objetivo</h3>' + (target.length
      ? '<p class="hint">Pasas si al terminar tienes todas estas cartas en el campo.</p><div class="sum-chips">' + target.map((n, i) => '<span class="sum-chip goal">' + esc(n)
        + '<button type="button" class="chip-x" data-tdel="' + i + '" aria-label="Quitar ' + esc(n) + '">×</button></span>').join('') + '</div>'
      : '<p class="hint">Sin campo objetivo: al terminar cada intento respondes "¿Tu campo pasó?". Arma tu campo final y guárdalo aquí para que se evalúe solo.</p>')
      + (S && boardNames().length ? '<button type="button" class="link-btn" data-st="save">Guardar el campo actual como objetivo</button>' : '') + '</section>';
    if (recent.length) {
      html += '<section><h3>Últimos intentos</h3><ol class="st-recent">' + recent.map((a) => '<li><span class="st-r ' + (a.passed === true ? 'pass' : a.passed === false ? 'fail' : '') + '">'
        + (a.passed === true ? 'Pasó' : a.passed === false ? 'No pasó' : '—') + '</span> ' + (a.second ? 'Segundo' : 'Primero')
        + (a.rival ? ' · ' + (arr(a.used).length ? 'usó ' + esc(arr(a.used).map((u) => shortName(u.name)).join(', ')) : 'no usó nada') : ' · sin rival') + '</li>').join('') + '</ol></section>';
    }
    return '<div class="stats">' + html + '</div>';
  }
  function openStats() {
    if (!d) return;
    openDialog('Intentos · ' + d.name, statsHtml(), [
      { label: 'Borrar estadísticas', kind: 'ghost-danger', action: () => openDialog('¿Borrar estadísticas?', '<p class="hint">Se borran los intentos de «' + esc(d.name) + '». El campo objetivo se queda.</p>', [
        { label: 'Cancelar', action: openStats },
        { label: 'Borrar', kind: 'danger', action: () => { aCall('clear', [d.id], null); recorded = null; render(); openStats(); } },
      ]) },
      { label: 'Cerrar', kind: 'primary' },
    ]);
    bindStats();
  }
  function bindStats() {
    const root = $('#modal-body');
    const redraw = () => { root.innerHTML = statsHtml(); bindStats(); render(); };
    $$('[data-tdel]', root).forEach((b) => b.addEventListener('click', () => {
      const t = attemptTarget();
      t.splice(Number(b.dataset.tdel), 1);
      aCall('setTarget', [d.id, t], null);
      redraw();
    }));
    const sv = $('[data-st="save"]', root);
    if (sv) sv.addEventListener('click', () => { aCall('setTarget', [d.id, boardNames()], null); toast('Campo objetivo guardado', 'ok'); redraw(); });
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
      if (pending && pending.kind === 'summon') { toast('Termina o cancela la invocación primero'); return; }
      if (z.id === 'fd-hand-wrap') { move(uid, 'hand'); return; }
      dropTo(uid, z.dataset.zone);
    });
  }

  /* ---------- Eventos ---------- */
  function bind() {
    $('#fd-deck').addEventListener('change', (e) => {
      const next = decks().find((x) => x.id === e.target.value);
      // Mientras no confirme, el selector sigue mostrando el mazo de la partida actual
      if (d) e.target.value = d.id;
      if (next) openSetup({ deck: next });
    });
    // Primero / Segundo: el mismo duelo con la misma mano inicial (y las mismas handtraps), cambiando el turno
    $$('#fd-order button').forEach((b) => b.addEventListener('click', () => {
      const second = b.dataset.order === 'second';
      if (!S || !!(S.start && S.start.second) === second) return;
      confirmRestart(() => {
        savePref({ fieldSecond: second });
        restartSameHand({ second, keepBot: true });
        toast(second ? 'Vas segundo: robaste 1 carta en la Fase de Robo' : 'Vas primero: 5 cartas, sin robo ni Fase de Batalla', 'ok');
      });
    }));
    $('#fd-new').addEventListener('click', () => openSetup());
    $('#fd-end').addEventListener('click', () => endAttempt());
    // Franja del rival: ver su mano, sus cartas, intentos y la ventana de Nuevo duelo
    $('#fd-opp').addEventListener('click', (e) => {
      const b = e.target.closest('[data-opp], [data-oppcard]');
      if (!b) return;
      if (b.dataset.oppcard) { showCard(Number(b.dataset.oppcard)); return; }
      const k = b.dataset.opp;
      if (k === 'reveal') { revealed[S.duelId] = !revealed[S.duelId]; renderOpp(); }
      else if (k === 'setup') openSetup({ wantBot: true });
      else if (k === 'stats') openStats();
    });
    $('#fd-draw').addEventListener('click', () => draw(1));
    $('#fd-shuffle').addEventListener('click', () => { snapshot(); game.shuffle(S.deck); toast('Mazo barajado'); render(); });
    $('#fd-search').addEventListener('click', () => openPile('deck'));
    $('#fd-undo').addEventListener('click', undo);
    $('#fd-cancel').addEventListener('click', () => { pending = null; render(); });
    $('#fd-confirm').addEventListener('click', confirmSummon);
    $('#fd-lp').addEventListener('change', (e) => {
      const lp = Number(e.target.value) || 0;
      if (lp === S.lp) return;
      snapshot();
      pushLog({ kind: 'manual', text: 'LP: ' + S.lp + ' → ' + lp });
      S.lp = lp;
      render();
    });

    // Turno y fases
    $('#fd-phases').addEventListener('click', (e) => {
      const b = e.target.closest('[data-phase]');
      if (b) setPhase(b.dataset.phase);
    });
    $('#fd-next-phase').addEventListener('click', nextPhase);
    $('#fd-pass').addEventListener('click', passTurn);
    $('#fd-log-btn').addEventListener('click', openLog);
    $('#fd-strict').addEventListener('change', (e) => {
      prefs.fieldStrict = e.target.checked;
      store.savePrefs(Object.assign(store.prefs(), { fieldStrict: prefs.fieldStrict }));
      toast(prefs.fieldStrict ? 'Las jugadas ilegales se bloquean' : 'Las jugadas ilegales se permiten y quedan marcadas en rojo', 'ok');
    });

    // Banda de materiales: quitar elegidas, zona, posición y destino de los materiales
    $('#fd-pending').addEventListener('click', (e) => {
      if (!pending || pending.kind !== 'summon') return;
      const un = e.target.closest('[data-unpick]');
      const pos = e.target.closest('[data-pickpos]');
      const md = e.target.closest('[data-mdest]');
      if (un) togglePick(un.dataset.unpick);
      else if (pos) { pending.position = pos.dataset.pickpos; render(); }
      else if (md) { pending.matDest = md.dataset.mdest; render(); }
    });
    $('#fd-pending').addEventListener('change', (e) => {
      if (!pending || pending.kind !== 'summon') return;
      if (e.target.id === 'fd-pick-zone') pending.zone = e.target.value || null;
      else if (e.target.id === 'fd-pick-src') pending.src = e.target.value;
      else return;
      render();
    });

    // Cadena (panel lateral y franja del móvil)
    [$('#fd-chain'), $('#fd-chain-strip')].forEach((el) => el.addEventListener('click', (e) => {
      const nb = e.target.closest('[data-neg]');
      if (nb) { toggleNegated(Number(nb.dataset.neg)); return; }
      const b = e.target.closest('[data-chain]');
      if (!b) return;
      if (b.dataset.chain === 'resolve') resolveChain();
      else if (b.dataset.chain === 'undo') undoDeclaration();
      else { chainFolded = !chainFolded; renderChain(); }
    }));

    $('#board').addEventListener('click', (e) => {
      const zone = e.target.closest('[data-zone]');
      if (!zone) return;
      // En pilas, un clic sobre la carta superior abre la pila (o roba, en el mazo)
      onZone(zone.dataset.zone);
    });
    $('#board').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const zone = e.target.closest('[data-zone]');
      if (zone) { e.preventDefault(); onZone(zone.dataset.zone); }
    });
    $('#fd-hand').addEventListener('click', (e) => {
      const el = e.target.closest('[data-uid]');
      if (!el) return;
      if (pending && pending.kind === 'summon') { togglePick(el.dataset.uid); return; }
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
    $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') { pileOpen = null; dialogOpen = false; } });
    $('#modal-body').addEventListener('click', (e) => {
      const el = e.target.closest('[data-uid]');
      if (!el || !pileOpen) return;
      if (pending && pending.kind === 'summon') { togglePick(el.dataset.uid); return; }
      selected = el.dataset.uid;
      closePile();
      render();
    });
    $('#fd-actions').addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const a = $('#fd-side')._acts[Number(b.dataset.act)];
      if (a && a.fn) a.fn();
    });
    $('#fd-deselect').addEventListener('click', () => { selected = null; render(); });
    // Escape primero cierra la ventana (de eso se encarga el constructor); se anota antes de que se cierre
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      escModal = !$('#modal').hidden;
      if (escModal) { pileOpen = null; dialogOpen = false; }
    }, true);
    document.addEventListener('keydown', (e) => {
      if (document.body.dataset.mode !== 'campo' || e.target.matches('input, select, textarea')) return;
      if (e.key === 'Escape') {
        if (escModal) { escModal = false; return; }
        pending = null; selected = null; render();
        return;
      }
      if (!$('#modal').hidden) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
      else if (e.key === 'd' || e.key === 'D') draw(1);
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
    // La respuesta del rival al empezar (p. ej. desde la prueba de mano) se muestra ya en el campo
    if (oppQueued) showOpp(oppQueued);
  }

  /** Empieza un duelo con una mano concreta (desde la prueba de mano).
   * opts: { second (la 6ª carta de la mano cuenta como robada), bot: { enabled, count, mode, pool, seed, forceHand } }.
   * Sin opts.bot, el rival es el de las preferencias (ventana Nuevo duelo). */
  function load(deckObj, handIds, restIds, opts) {
    d = deckObj;
    opts = Object.assign({ second: false }, opts);
    newDuel(handIds, restIds, opts);
    renderDeckSelect();
  }

  bind();
  // state(): copia del estado actual (solo lectura; la usan las pruebas de tools/test_field.js)
  window.YGO.field = { enter, load, state: () => (S ? JSON.parse(JSON.stringify(S)) : null) };
})();
