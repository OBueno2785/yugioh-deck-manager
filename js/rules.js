/* Reglas del duelo (Master Rule, revisión de abril de 2020) para el campo de combos:
 * declarar invocaciones y efectos antes de hacerlos y avisar si una jugada es ilegal.
 * Son funciones puras sobre el estado S de field.js (no tocan el DOM ni mueven cartas).
 * Si el texto de una carta puede cambiar la regla, se avisa (warnings) en vez de marcar error (errors).
 * Expone window.YGO.rules. */
(function () {
  const YGO = (window.YGO = window.YGO || {});
  const db = YGO.db;
  const T = db.T;

  /* ---------- Constantes ---------- */
  const PHASES = [['draw', 'Robo'], ['standby', 'Standby'], ['main1', 'Principal 1'], ['battle', 'Batalla'], ['main2', 'Principal 2'], ['end', 'Final']];
  const PHASE_KEYS = PHASES.map((p) => p[0]);
  const MZ = ['mz0', 'mz1', 'mz2', 'mz3', 'mz4'];
  const EMZ = ['emz0', 'emz1'];
  const MON_ZONES = [...EMZ, ...MZ];
  const ST = ['st0', 'st1', 'st2', 'st3', 'st4'];
  const FIELD_ZONES = [...MON_ZONES, ...ST, 'fz'];
  const AREAS = ['hand', 'deck', 'extra', 'gy', 'ban'];
  const ZONE_NAMES = {
    emz0: 'Zona de Monstruo Extra izquierda', emz1: 'Zona de Monstruo Extra derecha',
    mz0: 'Zona de Monstruo 1', mz1: 'Zona de Monstruo 2', mz2: 'Zona de Monstruo central', mz3: 'Zona de Monstruo 4', mz4: 'Zona de Monstruo 5',
    st0: 'Zona de Mágicas y Trampas 1', st1: 'Zona de Mágicas y Trampas 2', st2: 'Zona de Mágicas y Trampas 3',
    st3: 'Zona de Mágicas y Trampas 4', st4: 'Zona de Mágicas y Trampas 5', fz: 'Zona de Campo',
  };
  const AREA_NAMES = {
    hand: 'la mano', deck: 'el Mazo', extra: 'el Extra Deck', gy: 'el Cementerio', ban: 'desterrada',
    field: 'el campo', material: 'como material Xyz', pendulum: 'la Zona de Péndulo',
  };
  const METHOD_LABELS = {
    normal: 'Invocación Normal', set: 'Colocación', tribute: 'Invocación por Sacrificio', tributeSet: 'Colocación por Sacrificio',
    special: 'Invocación Especial', synchro: 'Invocación por Sincronía', xyz: 'Invocación Xyz', link: 'Invocación Link',
    fusion: 'Invocación por Fusión', ritual: 'Invocación por Ritual', pendulum: 'Invocación por Péndulo',
  };
  const KIND_LABELS = {
    activation: 'Activación de la carta', ignition: 'Efecto de Ignición', quick: 'Efecto Rápido',
    trigger: 'Efecto de activación (trigger)', continuous: 'Efecto continuo', summon: 'Forma de invocarse',
  };
  const NORMAL_METHODS = ['normal', 'set', 'tribute', 'tributeSet'];
  // Flechas Link (bits de card.def) como desplazamiento [columna, fila]; fila -1 = fila de las Zonas Extra
  const ARROWS = [[0x40, -1, -1], [0x80, 0, -1], [0x100, 1, -1], [0x8, -1, 0], [0x20, 1, 0], [0x1, -1, 1], [0x2, 0, 1], [0x4, 1, 1]];
  // Posición en la cuadrícula: las Zonas Extra están sobre las columnas 1 y 3 de las Zonas de Monstruo
  const GRID = { emz0: [1, -1], emz1: [3, -1], mz0: [0, 0], mz1: [1, 0], mz2: [2, 0], mz3: [3, 0], mz4: [4, 0] };

  const ATTRS = [['EARTH', 0x1], ['WATER', 0x2], ['FIRE', 0x4], ['WIND', 0x8], ['LIGHT', 0x10], ['DARK', 0x20], ['DIVINE', 0x40]];
  const RACES_EN = [['Beast-Warrior', 0x8000], ['Winged Beast', 0x200], ['Sea Serpent', 0x40000], ['Divine-Beast', 0x200000],
    ['Creator God', 0x400000], ['Spellcaster', 0x2], ['Warrior', 0x1], ['Fairy', 0x4], ['Fiend', 0x8], ['Zombie', 0x10],
    ['Machine', 0x20], ['Aqua', 0x40], ['Pyro', 0x80], ['Rock', 0x100], ['Plant', 0x400], ['Insect', 0x800], ['Thunder', 0x1000],
    ['Dragon', 0x2000], ['Beast', 0x4000], ['Dinosaur', 0x10000], ['Fish', 0x20000], ['Reptile', 0x80000], ['Psychic', 0x100000],
    ['Wyrm', 0x800000], ['Cyberse', 0x1000000], ['Illusion', 0x2000000]];
  const KINDS = {
    Tuner: [T.TUNER, 'Cantante'], Effect: [T.EFFECT, 'de Efecto'], Normal: [T.NORMAL, 'Normal'], Fusion: [T.FUSION, 'de Fusión'],
    Synchro: [T.SYNCHRO, 'de Sincronía'], Xyz: [T.XYZ, 'Xyz'], Link: [T.LINK, 'Link'], Ritual: [T.RITUAL, 'de Ritual'],
    Pendulum: [T.PENDULUM, 'de Péndulo'], Flip: [T.FLIP, 'de Volteo'], Toon: [T.TOON, 'Toon'], Gemini: [T.GEMINI, 'Géminis'],
    Spirit: [T.SPIRIT, 'Espíritu'], Union: [T.UNION, 'Unión'],
  };
  const SEP = '(?:, and\\/or |, or |, and | and\\/or | or | and |, )';
  const listRe = (item) => new RegExp('^(?:' + item + ')(?:' + SEP + '(?:' + item + '))*');
  const ATTR_ITEM = ATTRS.map((a) => a[0]).join('|');
  const RACE_ITEM = '(?:' + RACES_EN.map((r) => r[0]).join('|') + ')(?:-Type)?';
  const KIND_ITEM = '(?:Tuners?|' + Object.keys(KINDS).filter((k) => k !== 'Tuner').join('|') + ')\\b';
  const ATTR_LIST = listRe(ATTR_ITEM);
  const RACE_LIST = listRe(RACE_ITEM);
  const KIND_LIST = new RegExp(listRe(KIND_ITEM).source + '(?:\\s+(?:Monsters?|monsters?)\\b)?');
  const QUOTE_LIST = listRe('"[^"]+"');

  const attrName = (bit) => (db.ATTRIBUTES.find((a) => a[0] === bit) || [0, ''])[1];
  const raceName = (bit) => (db.RACES.find((r) => r[0] === bit) || [0, ''])[1];
  const phaseName = (k) => (PHASES.find((p) => p[0] === k) || [k, k])[1];
  const q = (name) => '«' + name + '»';
  const CONTACT_C = 87170768; // Contact "C": quien la controla solo Invoca por Fusión/Sincronía/Xyz/Link con ella como material
  const reEsc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Ritual por ATK ("Tribute ... whose total ATK equal or exceed the ATK of the Ritual Monster")
  const RITUAL_ATK = /\b(?:total|combined) ATK\b[^.]*\bRitual\b|\bRitual\b[^.]*\b(?:total|combined) ATK\b/i;

  /* ---------- Estado del turno ---------- */
  function newTurnState(opts) {
    // turn/mine/phase/normalSummons/opt: contrato con field.js; el resto lo usa solo este módulo
    // acts: efectos activados este turno ({ id, effectIndex, monster }), para efectos que dan permisos o límites ese turno
    // opts.second: vas segundo → es tu turno 2 (con Fase de Batalla); opts.phase: fase inicial
    opts = opts || {};
    const phase = PHASE_KEYS.includes(opts.phase) ? opts.phase : 'main1';
    return { turn: opts.second ? 2 : 1, mine: true, phase, normalSummons: 0, opt: {}, pendulumSummons: 0, duel: {}, locks: [], specials: [], acts: [] };
  }
  /** Lectura tolerante (estados viejos sin turnState). No modifica S. */
  function tsOf(S) {
    const t = (S && S.turnState) || {};
    return {
      turn: Number(t.turn) || 1, mine: t.mine !== false, phase: PHASE_KEYS.includes(t.phase) ? t.phase : 'main1',
      normalSummons: t.normalSummons || 0, pendulumSummons: t.pendulumSummons || 0, opt: t.opt || {}, duel: t.duel || {},
      locks: Array.isArray(t.locks) ? t.locks : [], specials: Array.isArray(t.specials) ? t.specials : [],
      acts: Array.isArray(t.acts) ? t.acts : [],
    };
  }
  /** Crea o completa S.turnState para escribir en él. */
  function ensureTS(S) {
    if (!S.turnState || typeof S.turnState !== 'object') S.turnState = newTurnState();
    const t = S.turnState;
    const base = newTurnState();
    for (const k of Object.keys(base)) if (t[k] === undefined || t[k] === null) t[k] = base[k];
    return t;
  }
  function setPhase(S, key) {
    const t = ensureTS(S);
    if (PHASE_KEYS.includes(key)) t.phase = key;
    return t;
  }
  /** Pasa a la fase siguiente; después de la Fase Final empieza el otro turno. El turno 1 no tiene Batalla. */
  function nextPhase(S) {
    const t = ensureTS(S);
    if (t.phase === 'end') return passTurn(S);
    let next = PHASE_KEYS[PHASE_KEYS.indexOf(t.phase) + 1] || 'end';
    if (next === 'battle' && t.turn === 1) next = 'end';
    t.phase = next;
    return t;
  }
  function passTurn(S) {
    const t = ensureTS(S);
    t.turn = (Number(t.turn) || 1) + 1;
    t.mine = !t.mine;
    t.phase = 'draw';
    t.normalSummons = 0;
    t.pendulumSummons = 0;
    t.opt = {};
    // Siguen los bloqueos del rival que no son "este turno": los de una carta suya que sigue en su campo (sourceUid:
    // Retaliating "C", Angelechy Shatranga, Angelechy Destrier; ver lockLive) y los que tienen turno final (until: Dimension Shifter)
    t.locks = (Array.isArray(t.locks) ? t.locks : []).filter((l) => l && l.kind && (l.sourceUid || (l.until != null && Number(l.until) >= t.turn)));
    t.specials = [];
    t.acts = [];
    S.chain = [];
    return t;
  }
  const turnLabel = (S) => {
    const t = tsOf(S);
    return 'Turno ' + t.turn + ' · ' + (t.mine ? 'Tuyo' : 'Del adversario') + ' · ' + phaseName(t.phase);
  };
  const isMain = (t) => t.phase === 'main1' || t.phase === 'main2';
  const chainLen = (S) => (S && Array.isArray(S.chain) ? S.chain.length : 0);

  /* ---------- Ubicación de cartas ---------- */
  /** { area: 'hand'|'deck'|'extra'|'gy'|'ban'|'field'|'material', zone, index, inst } */
  function locate(S, uid) {
    if (!S || !uid) return null;
    for (const a of AREAS) {
      const list = S[a];
      if (!Array.isArray(list)) continue;
      const i = list.findIndex((x) => x && x.uid === uid);
      if (i >= 0) return { area: a, index: i, inst: list[i] };
    }
    const zones = S.zones || {};
    for (const z of FIELD_ZONES) {
      const list = zones[z];
      if (!Array.isArray(list)) continue;
      const i = list.findIndex((x) => x && x.uid === uid);
      if (i >= 0) return { area: i === 0 ? 'field' : 'material', zone: z, index: i, inst: list[i] };
    }
    return null;
  }
  const topOf = (S, z) => (S && S.zones && Array.isArray(S.zones[z]) ? S.zones[z][0] : null) || null;
  /** Lugar "jugable" de la carta: distingue la Zona de Péndulo. */
  function placeOf(loc, c) {
    if (!loc) return null;
    if (loc.area === 'field' && (loc.zone === 'st0' || loc.zone === 'st4') && db.isMonster(c) && !loc.inst.faceDown) return 'pendulum';
    return loc.area;
  }
  // field.js marca extraFaceUp al mandar un Péndulo boca arriba al Extra Deck (faceUp: estados viejos)
  const faceUpInExtra = (c, inst) => !!(c.type & T.PENDULUM) && (!db.isExtra(c) || !!(inst && (inst.extraFaceUp || inst.faceUp || inst.summonMethod)));
  /** Un Péndulo boca arriba en el Extra Deck solo se puede Invocar por Péndulo, no por Fusión, Sincronía, Xyz ni Link. */
  const faceUpExtraOnlyPendulum = (method) => 'Un monstruo de Péndulo boca arriba en el Extra Deck no se puede hacer su '
    + METHOD_LABELS[method] + ': boca arriba solo se puede Invocar por Péndulo (o con un efecto que lo invoque).';
  // Xyz/Link de Péndulo que su texto deja Invocar por Péndulo desde el Extra Deck ("If you can Pendulum Summon Level 7...")
  const PEND_FACEUP_LEVEL = /If you can Pendulum Summon Level (\d+), you can Pendulum Summon this face-up card in your Extra Deck/i;
  /** Cómo se invocó antes (field.js guarda properSummon al dejar el campo; summonMethod mientras sigue en él). */
  const properOf = (inst) => (inst && (inst.properSummon || inst.summonMethod)) || null;
  const hasLevel = (c) => db.isMonster(c) && !(c.type & (T.XYZ | T.LINK));
  const levelOf = (c, inst) => (inst && typeof inst.level === 'number' ? inst.level : c.lv);
  /** inst.negated = { turn, by }: field.js lo pone cuando el rival niega sus efectos (vale hasta el final de ese turno). */
  const negatedNow = (inst, t) => (inst && inst.negated && Number(inst.negated.turn) === t.turn ? inst.negated : null);
  /** Token (inst.token = { name, atk, def, level, attribute, race }, p. ej. el de Nibiru) o carta de tipo Token. */
  const isToken = (x) => !!(x && ((x.inst && x.inst.token) || (x.c && x.c.type & T.TOKEN)));

  /* ---------- Texto ---------- */
  function topIndex(s, ch) {
    const v = YGO.view;
    if (v && v.topIndex) return v.topIndex(s, ch);
    let qo = false, depth = 0;
    for (let i = 0; i < s.length; i++) {
      const x = s[i];
      if (x === '"') qo = !qo;
      else if (!qo && x === '(') depth++;
      else if (!qo && x === ')') depth = Math.max(0, depth - 1);
      else if (!qo && depth === 0 && x === ch) return i;
    }
    return -1;
  }
  const hasTop = (s, ch) => topIndex(s, ch) >= 0;
  // Sin lookbehind en la expresión: Safari anterior a 16.4 no la entiende y no cargaría el módulo
  const sentencesOf = (s) => (YGO.view && YGO.view.sentences ? YGO.view.sentences(s) : s.replace(/\.\s+(?=[A-Z])/g, '.\u0001').split('\u0001'));
  /** Bloques del texto, igual que los párrafos de la ficha (YGO.view.textBlocks). */
  function blocksOf(c) {
    const v = YGO.view;
    if (v && v.textBlocks) return v.textBlocks(c);
    return String(c.desc || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => ({ kind: 'effect', parts: [l], text: l }));
  }
  const colorEffect = (s) => {
    const v = YGO.view;
    if (v && v.colorEffect) return v.colorEffect(s);
    return '<span class="t-eff">' + String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])) + '</span>';
  };

  /* ---------- Arquetipos ---------- */
  // Se reconoce por el nombre ("X" en el nombre), por "siempre se trata como" o por el setcode más común del arquetipo
  const archCache = new Map();
  const chunks = (code) => {
    const out = [];
    let n = Number(code) || 0;
    while (n > 0) { const ch = n % 65536; if (ch) out.push(ch); n = Math.floor(n / 65536); }
    return out;
  };
  const inSet = (ch, code) => (ch & 0xfff) === (code & 0xfff) && (ch & code) === code;
  function archCode(name) {
    const k = db.norm(name);
    if (archCache.has(k)) return archCache.get(k);
    const cands = db.cards.filter((c) => c._name.includes(k));
    let best = 0, bestN = 0;
    const seen = new Set();
    for (const c of cands) for (const ch of chunks(c.setcode)) seen.add(ch);
    for (const code of seen) {
      const n = cands.filter((c) => chunks(c.setcode).some((ch) => inSet(ch, code))).length;
      if (n > bestN || (n === bestN && code < best)) { best = code; bestN = n; }
    }
    const code = cands.length >= 3 && bestN >= cands.length * 0.6 ? best : 0;
    archCache.set(k, code);
    return code;
  }
  // El arquetipo en el nombre distingue mayúsculas ("HERO" no es "Heroic", "Xyz" no es "XYZ-Dragon Cannon"); los que no lo
  // llevan tal cual ("Purrely" en «Epurrely Noir») entran por su código de arquetipo (setcode)
  const caseKey = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\u201c\u201d\u2033]/g, '"').replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2010-\u2015\u2212]/g, '-');
  function isArch(c, name) {
    if (!c) return false;
    if (caseKey(c.name).includes(caseKey(name))) return true;
    const d = c.desc || '';
    if (d.includes('always treated as a "' + name + '"') || d.includes('always treated as an "' + name + '"')) return true;
    const code = archCode(name);
    return !!code && chunks(c.setcode).some((ch) => inSet(ch, code));
  }
  function isNamed(c, name) {
    if (!c) return false;
    if (db.nameKey(c.name) === db.nameKey(name)) return true;
    const d = c.desc || '';
    return d.includes('always treated as "' + name + '"') || d.includes('name becomes "' + name + '"');
  }

  /* ---------- Descripciones de monstruos ("1 non-Tuner Spellcaster monster") ---------- */
  /** Devuelve { tests: [fn(x)], labels: [texto], understood }. x = { c: carta, inst } */
  function parseDesc(src) {
    const d = { tests: [], labels: [], understood: true, src };
    let s = String(src || '').trim();
    const take = (re) => {
      const m = s.match(re);
      if (m) s = s.slice(m[0].length).trimStart();
      return m;
    };
    const items = (str, re) => str.split(new RegExp(SEP)).map((x) => x.trim()).filter((x) => re.test(x));
    let m, guard = 0;
    while (s && guard++ < 30) {
      if (take(/^non-Tuners?\b/)) { d.tests.push((x) => !(x.c.type & T.TUNER)); d.labels.push('no Cantante'); continue; }
      if (take(/^non-Link\b/)) { d.tests.push((x) => !(x.c.type & T.LINK)); d.labels.push('no Link'); continue; }
      if (take(/^non-Effect\b/)) { d.tests.push((x) => !(x.c.type & T.EFFECT)); d.labels.push('sin Efecto'); continue; }
      if (take(/^non-Token\b/)) { d.tests.push((x) => !isToken(x)); continue; }
      if ((m = take(new RegExp('^non-(' + ATTR_ITEM + ')\\b')))) {
        const bit = ATTRS.find((a) => a[0] === m[1])[1];
        d.tests.push((x) => x.c.attribute !== bit);
        d.labels.push('no ' + attrName(bit));
        continue;
      }
      if ((m = take(/^non-"([^"]+)"/))) { const n = m[1]; d.tests.push((x) => !isArch(x.c, n)); d.labels.push('no ' + q(n)); continue; }
      if ((m = take(/^Level (\d+) or (higher|lower|more|less)\b/))) {
        const n = +m[1], up = m[2] === 'higher' || m[2] === 'more';
        d.tests.push((x) => hasLevel(x.c) && (up ? levelOf(x.c, x.inst) >= n : levelOf(x.c, x.inst) <= n));
        d.labels.push('Nivel ' + n + (up ? ' o más' : ' o menos'));
        continue;
      }
      if ((m = take(/^Level (\d+)\b/))) { const n = +m[1]; d.tests.push((x) => hasLevel(x.c) && levelOf(x.c, x.inst) === n); d.labels.push('Nivel ' + n); d.level = n; continue; }
      if ((m = take(/^Rank (\d+)(?: or (higher|lower))?\b/))) {
        const n = +m[1], dir = m[2];
        d.tests.push((x) => !!(x.c.type & T.XYZ) && (dir === 'higher' ? x.c.lv >= n : dir === 'lower' ? x.c.lv <= n : x.c.lv === n));
        d.labels.push('Rango ' + n + (dir ? (dir === 'higher' ? ' o más' : ' o menos') : ''));
        continue;
      }
      if ((m = take(/^Level\/Rank\/Link (\d+)\b/))) { const n = +m[1]; d.tests.push((x) => x.c.lv === n); d.labels.push('Nivel/Rango/Link ' + n); continue; }
      if ((m = take(ATTR_LIST))) {
        const bits = items(m[0], new RegExp('^(' + ATTR_ITEM + ')$')).map((a) => ATTRS.find((x) => x[0] === a)[1]);
        d.tests.push((x) => bits.includes(x.c.attribute));
        d.labels.push(bits.map(attrName).join(' o '));
        continue;
      }
      if ((m = take(RACE_LIST))) {
        const bits = items(m[0], /./).map((r) => (RACES_EN.find((x) => x[0] === r.replace(/-Type$/, '')) || [0, 0])[1]).filter(Boolean);
        d.tests.push((x) => bits.includes(x.c.race));
        d.labels.push(bits.map(raceName).join(' o '));
        continue;
      }
      if ((m = take(KIND_LIST))) {
        const words = items(m[0].replace(/\s+(?:Monsters?|monsters?)$/, ''), /./).map((w) => w.replace(/^Tuners$/, 'Tuner'));
        const bits = words.map((w) => (KINDS[w] || [0])[0]).filter(Boolean);
        if (!bits.length) { d.understood = false; break; }
        const any = bits.reduce((a, b) => a | b, 0);
        d.tests.push((x) => db.isMonster(x.c) && !!(x.c.type & any));
        d.labels.push(words.map((w) => (KINDS[w] || [0, w])[1]).join(' o '));
        continue;
      }
      if ((m = take(QUOTE_LIST))) {
        const names = m[0].match(/"[^"]+"/g).map((n) => n.slice(1, -1));
        const arch = /^(?:monsters?|Monsters?|Tuners?|cards?|Spells?|Traps?|Ritual|Fusion|Synchro|Xyz|Link|Pendulum|Normal|Effect)\b/.test(s);
        if (arch) { d.tests.push((x) => names.some((n) => isArch(x.c, n))); d.labels.push(names.map(q).join(' o ')); }
        else { d.tests.push((x) => names.some((n) => isNamed(x.c, n))); d.labels.push(names.map(q).join(' o ')); d.named = names; }
        continue;
      }
      if (take(/^(?:monsters?|Monsters?)\b/)) continue;
      if (take(/^with a Level\b/)) { d.tests.push((x) => hasLevel(x.c)); d.labels.push('con Nivel'); continue; }
      if ((m = take(/^with (\d+) or (less|more|lower|higher) (original )?(ATK|DEF)\b/))) {
        const n = +m[1], up = m[2] === 'more' || m[2] === 'higher', stat = m[4] === 'ATK' ? 'atk' : 'def';
        d.tests.push((x) => (up ? x.c[stat] >= n : x.c[stat] >= 0 && x.c[stat] <= n));
        d.labels.push('con ' + n + ' o ' + (up ? 'más' : 'menos') + ' de ' + m[4]);
        continue;
      }
      d.understood = false;
      break;
    }
    return d;
  }
  const fits = (desc, x) => desc.tests.every((t) => t(x));

  /** "2+ Effect Monsters, including a Tuner" → { min, max, desc, group, understood } */
  function parsePart(p) {
    let s = String(p).trim();
    let min = 1, max = 1, m;
    if ((m = s.match(/^(\d+)\+\s+/))) { min = +m[1]; max = Infinity; }
    else if ((m = s.match(/^(\d+) or more(?: \(max\. (\d+)\))?\s+/))) { min = +m[1]; max = m[2] ? +m[2] : Infinity; }
    else if ((m = s.match(/^(\d+)\s+/))) { min = max = +m[1]; }
    if (m) s = s.slice(m[0].length);
    const group = {};
    let understood = true, guard = 0, changed = true;
    // Cláusulas al final que valen para todo el grupo
    while (changed && guard++ < 6) {
      changed = false;
      const cut = (re, fn) => {
        const r = s.match(re);
        if (r) { fn(r); s = s.slice(0, r.index).trim(); changed = true; }
        return !!r;
      };
      if (cut(/,? except Tokens$/, () => { group.noTokens = true; })) continue;
      if (cut(/,? including (?:a|an|at least (\d+)) (.+)$/, (r) => { group.including = parseDesc(r[2]); group.includingMin = r[1] ? +r[1] : 1; })) continue;
      if (cut(/,? with different names$/, () => { group.diffNames = true; })) continue;
      if (cut(/,? with the same Attribute but different Types$/, () => { group.same = ['attribute']; group.diff = ['race']; })) continue;
      if (cut(/,? with different (Types|Attributes)(?: and (?:different )?(Types|Attributes))?$/, (r) => {
        group.diff = [r[1], r[2]].filter(Boolean).map((w) => (w === 'Types' ? 'race' : 'attribute'));
      })) continue;
      if (cut(/,? with the same (Type|Attribute|Level|Rank)(?: and (Type|Attribute))?$/, (r) => {
        group.same = [r[1], r[2]].filter(Boolean).map((w) => ({ Type: 'race', Attribute: 'attribute', Level: 'lv', Rank: 'lv' }[w]));
      })) continue;
      if (cut(/,? except "([^"]+)"(?: monsters?)?$/, (r) => { group.except = r[1]; })) continue;
    }
    const desc = parseDesc(s);
    if (group.including && !group.including.understood) understood = false;
    return { min, max, desc, group, understood: understood && desc.understood, text: String(p).trim() };
  }
  function groupOk(part, xs) {
    const g = part.group;
    if (g.diffNames && new Set(xs.map((x) => x.c.name)).size !== xs.length) return false;
    for (const f of g.diff || []) if (new Set(xs.map((x) => x.c[f])).size !== xs.length) return false;
    for (const f of g.same || []) if (new Set(xs.map((x) => x.c[f])).size > 1) return false;
    if (g.except && xs.some((x) => isArch(x.c, g.except))) return false;
    if (g.noTokens && xs.some(isToken)) return false;
    if (g.including && xs.filter((x) => fits(g.including, x)).length < g.includingMin) return false;
    return true;
  }
  /** Reparte los materiales entre las partes ("1 Tuner" + "1+ non-Tuner"). Devuelve la asignación o null. */
  function solve(xs, parts) {
    const n = xs.length, k = parts.length;
    if (n > 12) return null;
    const ok = xs.map((x) => parts.map((p) => fits(p.desc, x)));
    const assign = new Array(n);
    const counts = new Array(k).fill(0);
    const rec = (i) => {
      if (i === n) {
        for (let j = 0; j < k; j++) if (counts[j] < parts[j].min || counts[j] > parts[j].max) return false;
        return parts.every((p, j) => groupOk(p, xs.filter((_, ii) => assign[ii] === j)));
      }
      for (let j = 0; j < k; j++) {
        if (!ok[i][j] || counts[j] >= parts[j].max) continue;
        assign[i] = j;
        counts[j]++;
        if (rec(i + 1)) return true;
        counts[j]--;
      }
      return false;
    };
    return rec(0) ? assign.slice() : null;
  }
  function splitTop(line, sep) {
    const out = [];
    let qo = false, start = 0;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') qo = !qo;
      else if (!qo && line.startsWith(sep, i)) { out.push(line.slice(start, i)); start = i + sep.length; i += sep.length - 1; }
    }
    out.push(line.slice(start));
    return out.map((x) => x.trim()).filter(Boolean);
  }
  function partSummary(p) {
    const n = p.min === p.max ? String(p.min) : p.max === Infinity ? p.min + '+' : p.min + '-' + p.max;
    let s = n + ' ' + (p.desc.labels.length ? p.desc.labels.join(' ') : 'monstruo');
    const g = p.group;
    if (g.including) s += ', incluyendo ' + (g.includingMin > 1 ? g.includingMin + ' ' : '1 ') + (g.including.labels.join(' ') || 'monstruo');
    if (g.diffNames) s += ', con nombres distintos';
    if (g.diff) s += ', con ' + g.diff.map((f) => (f === 'race' ? 'Tipos' : 'Atributos')).join(' y ') + ' distintos';
    if (g.same) s += ', del mismo ' + g.same.map((f) => ({ race: 'Tipo', attribute: 'Atributo', lv: 'Nivel' }[f])).join(' y ');
    if (g.except) s += ', excepto ' + q(g.except);
    return s;
  }

  /* ---------- Bloqueos ("you cannot Special Summon ..., except ...") ---------- */
  /** timing: 'rest' (resto del turno) | 'turn' (el turno en que lo activas) | 'continuous' (mientras esté en el campo) */
  function parseLocks(text, fallback) {
    const out = [];
    for (const sen of sentencesOf(String(text || ''))) {
      const re = /you cannot Special Summon\b([^.;]*)/gi;
      let m;
      while ((m = re.exec(sen))) {
        const p = m[1].split(/, (?:also|and if you do|then)\b| and you\b/)[0];
        const ex = p.match(/,?\s*except (.+?)(?:,|$| the turn you| during the turn| for the rest)/i);
        let head = (ex ? p.slice(0, ex.index) : p)
          .replace(/\b(?:monsters|from the Extra Deck|for the rest of this turn(?: after this card resolves)?|(?:during )?the turn you activate (?:this card|this effect|either effect|either of this card's effects|any of this card's effects)|during this turn|this turn)\b/gi, '')
          .replace(/[,\s]+/g, ' ').trim();
        const timing = /the turn you activate/i.test(p) ? 'turn' : /this turn/i.test(sen) ? 'rest' : fallback;
        let allow = ex ? ex[1].trim() : null;
        let understood = !head;
        if (allow) {
          if (/^(?:in |from |by )/i.test(allow)) understood = false;
          else if (!parseDesc(allow).understood) understood = false;
        }
        out.push({ extra: /from the Extra Deck/i.test(p) && !/except from the Extra Deck/i.test(p), timing, allow, understood, text: ('You cannot Special Summon' + p).trim() });
      }
    }
    return out;
  }
  /** ¿El bloqueo impide invocar esta carta? → null (no aplica) | 'ok' | 'bad' | 'unknown' */
  function lockVerdict(lock, c, fromExtra) {
    if (lock.extra && !fromExtra) return null;
    if (!lock.understood) return 'unknown';
    if (!lock.allow) return 'bad';
    return fits(parseDesc(lock.allow), { c, inst: null }) ? 'ok' : 'bad';
  }

  /* ---------- Efectos de una carta ---------- */
  const analysisCache = new Map();
  const EMPTY = { effects: [], reqs: [], materials: null, summonOpts: [], fieldLocks: [], controlOne: null, archOnly: null };
  const ACTIVATED = ['activation', 'ignition', 'quick', 'trigger'];
  const STATE_COND = /^(?:If|While) (?:this card is (?:in|face-up in|on|the only)|this card (?:is )?in your|you control|your opponent controls|you have|your opponent has|there (?:is|are)|this card has|it is|your LP|all |this is the only|you do not|neither|both|you control no)/i;
  const EVENT_COND = /\b(?:is|are|was|were|gets?|has been|have been)\s+(?:\w+[\s/]+){0,3}?(?:Summoned|Set|sent|destroyed|banished|added|discarded|Tributed|detached|targeted|activated|flipped|returned|shuffled|used|attached|equipped|placed|drawn|revealed|excavated|changed|attacked|removed|negated|moved|declared)\b|\b(?:activates?|declares?|attacks?|leaves|inflicts?|takes|draws?|resolves?|battles?|destroys?|Summons?)\b/i;

  function classify(c, s0, cond, activated) {
    if (!activated) {
      // Solo "You can Special Summon this card..." es una forma propia de invocarse (Normal/Sacrificio/Ritual van como requisito)
      if (/\byou can Special Summon (?:this card|it)\b/i.test(s0)) return { kind: 'summon' };
      if (OLD_IGNITION.test(s0) && !/\b(?:instead|would)\b/i.test(s0)) return { kind: 'ignition', unsure: true };
      return { kind: 'continuous' };
    }
    const k = (cond || '').replace(/^Once per (?:turn|Chain|Duel)\s*,?\s*/i, '').trim();
    let kind;
    if (/Quick Effect/i.test(cond || '')) kind = 'quick';
    else if (!k) kind = 'ignition';
    else if (/^FLIP$/i.test(k)) kind = 'trigger';
    else if (/^During (?:each of )?your opponent's (?:next )?(?:End|Standby|Draw) Phases?\b/i.test(k)) kind = 'trigger';
    else if (/^During (?:your opponent's|either player's|each player's)\b/i.test(k)) {
      // "During your opponent's turn, if this card is sent to the GY:" es un trigger; "..., when ... is activated:" (texto antiguo) es rápido
      const r = k.replace(/^During [^,]*,\s*/i, '');
      kind = r !== k && /^if\b/i.test(r) && EVENT_COND.test(r) && !/activat/i.test(r) ? 'trigger' : 'quick';
    }
    else if (/^During (?:your |the |each )?Main Phase/i.test(k)) kind = 'ignition';
    else if (/^(?:During (?:each of )?(?:the |your |each |either player's )?(?:next )?(?:End|Standby|Draw|Battle) Phases?\b|At the (?:start|end|beginning) of|(?:Before|During) damage calculation\b)/i.test(k)) kind = 'trigger';
    else if (/^(?:If|When|Each time|After|Once while|While)\b/i.test(k)) kind = STATE_COND.test(k) && !EVENT_COND.test(k) ? 'ignition' : 'trigger';
    else kind = 'ignition';
    // Los efectos de Trampa (aunque estén en el Cementerio) son de velocidad 2
    if (kind === 'ignition' && db.isTrap(c)) kind = 'quick';
    return { kind };
  }
  function speedOf(c, kind) {
    if (kind === 'continuous' || kind === 'summon') return null;
    if (db.isTrap(c)) return kind === 'activation' && c.type & T.COUNTER ? 3 : 2;
    if (db.isSpell(c) && kind === 'activation') return c.type & T.QUICKPLAY ? 2 : 1;
    return kind === 'quick' ? 2 : 1;
  }
  /** Dónde debe estar la carta para usar el efecto (aproximado; solo genera avisos). */
  function whereOf(c, e, head) {
    if (e.kind === 'activation') return null;
    if (e.pendulum) return ['pendulum'];
    const h = head.toLowerCase();
    const w = new Set();
    if (/discard this card|this card (?:is )?in your hand|reveal this card|this card from your hand|this card \(from your hand|this card is (?:added to your hand|drawn)/.test(h)) w.add('hand');
    if (/this card (?:is )?in your (?:gy|graveyard)|this card from your (?:gy|graveyard)|this card (?:is|was) sent to the (?:gy|graveyard)|this card (?:is|was) (?:sent from|destroyed|tributed|detached|discarded|used as)|this card from your hand or (?:gy|graveyard)|this card in your (?:gy|graveyard)/.test(h)) w.add('gy');
    if (/this card is banished|while this card is banished|this banished card|this card (?:is )?(?:currently )?banished/.test(h)) w.add('ban');
    if (/this card (?:is )?(?:face-up )?in your extra deck|face-up in your extra deck/.test(h)) w.add('extra');
    if (/this card is (?:(?:normal|special|tribute|flip|fusion|synchro|xyz|link|ritual|pendulum|or|and\/or|,)\s+)*summoned|this card (?:you control|on the field|in your main monster zone|in the extra monster zone)|this card is in (?:the |your )?(?:center )?(?:main |extra )?monster zone|tribute this card|detach|this face-up card|this card is in (?:attack|defense) position|(?:target|banish|destroy|return) this card on the field/.test(h)) w.add('field');
    if (/used as (?:synchro |xyz |link |fusion )?material/.test(h)) { w.add('field'); w.add('material'); }
    if (/destroyed/.test(h) && c.type & T.PENDULUM) w.add('extra');
    if (!w.size) w.add('field');
    return [...w];
  }

  function makeEffect(c, r, index, isAct) {
    const s0 = stripLead(r.parts[0]);
    const colon = topIndex(s0, ':');
    const condition = colon >= 0 ? s0.slice(0, colon).trim() : null;
    const rest = colon >= 0 ? s0.slice(colon + 1) : s0;
    const semi = topIndex(rest, ';');
    const cost = semi >= 0 ? rest.slice(0, semi).trim() : null;
    const cls = isAct ? { kind: 'activation' } : classify(c, s0, condition, colon >= 0 || semi >= 0);
    const text = r.parts.join(' ') + r.bullets.map((b) => ' ● ' + b).join('');
    const e = {
      index, text,
      html: r.parts.map(colorEffect).join(' ') + r.bullets.map((b) => '<br>● ' + colorEffect(b)).join(''),
      kind: cls.kind, speed: speedOf(c, cls.kind), condition, cost,
      optKey: null, optLimit: null, optLabel: null, opts: [],
      pendulum: r.section === 'pendulum', unsure: !!cls.unsure,
      oncePerChain: /^Once per Chain\b/i.test(condition || ''),
      locks: parseLocks(text, cls.kind === 'continuous' ? 'continuous' : 'rest').map((l) => Object.assign(l, { section: r.section })),
    };
    e.where = whereOf(c, e, (condition || '') + ' ' + (semi >= 0 ? rest.slice(0, semi) : rest));
    // "...; Special Summon this card from your hand" también dice dónde está la carta
    if (e.where && !e.pendulum) {
      const m = s0.match(/Special Summon this card \(?from your (hand|GY|Graveyard)(?: or (GY|Graveyard|hand))?/i);
      if (m) {
        if (e.where.length === 1 && e.where[0] === 'field' && !/this card (?:you control|on the field|is (?:Normal |Special |Tribute |Flip )?Summoned)/i.test(s0)) e.where = [];
        for (const w of [m[1], m[2]].filter(Boolean)) {
          const k = /hand/i.test(w) ? 'hand' : 'gy';
          if (!e.where.includes(k)) e.where.push(k);
        }
      }
    }
    if (/^Once per turn\b/i.test(condition || s0) && ACTIVATED.includes(e.kind)) {
      e.opts.push({ key: 'copy:#' + index, limit: 1, perCopy: true, label: 'Una vez por turno (cada copia)' });
    }
    return e;
  }

  // Reglas de invocación que no son efectos ("You can Normal Summon this card without Tributing", "You can Ritual Summon this card with ...")
  // (también "You can also Xyz Summon this card by using ...": otra forma de Invocación Xyz, que lee parseMaterials)
  const SUMMON_RULE = /^(?:Once per turn, )?(?:You can (?:Normal|Tribute|Ritual) Summon(?:\/Set)? (?:this card|it)\b|You can (?:Normal|Tribute) Set this card\b|You can Tribute \d+ [^:;]*?\bto (?:Normal |Tribute )?Summon (?:\(but not Set\) )?this card\b|You can also (?:Xyz|Synchro|Link|Fusion) Summon (?:this card|"[^"]+"))/i;
  // Resultados de un dado o de una cuenta ("1: ...", "3-4: ...") y continuaciones ("If you do: ...") son parte del efecto anterior
  const NUM_COND = /^\d+\+?(?:\s*(?:[-–~,]|or more|or less)\s*\d*)*\s*:/;
  const CONTINUES = /^(?:If you do|If it does|If they do|Then)\b/;
  /** Viñeta que es un efecto que se activa ("You can ...;", "If ...: You can ...", "Once per turn: ..."). */
  const OLD_IGNITION = /^(?:Once per turn, )?you can (?:Tribute|send|discard|banish|pay|detach|remove|target|select|flip|change|equip|add|destroy|look|draw|reveal|return|shuffle)\b/i;
  const activatedBullet = (s) => {
    s = stripLead(s);
    return hasTop(s, ';') || /^(?:Once per (?:turn|Chain)\b|Target\b)/i.test(s) || OLD_IGNITION.test(s)
      || (hasTop(s, ':') && (/^(?:If|When|During|At the|Each time|After|Before|FLIP)\b/i.test(s) || /\(Quick Effect\)\s*:/i.test(s)));
  };
  /** Efecto que no se activa: continuo o forma de invocarse (las viñetas que se activan no se le suman).
   * "Activate 1 of these effects." / "apply the following effects" encabezan opciones: no cuentan como continuos. */
  function passiveRaw(r) {
    const s = stripLead(r.parts[0]);
    if (hasTop(s, ':') || hasTop(s, ';')) return false;
    if (/^(?:Activate|Apply|Choose|You can activate)\b|\bof (?:these|the following) effects\b|\bapply (?:these|the following) effects\b/i.test(s)) return false;
    return !/^(?:Once per turn, )?you can\b/i.test(s) || /\byou can Special Summon (?:this card|it)\b/i.test(s);
  }
  /** "Un monstruo Xyz que tenga esta carta como material gana este efecto": el efecto es del otro monstruo. */
  const grantsOther = (r) => /has this card as (?:material|an Xyz Material)|Summoned using this card|using this card as (?:material|\w+ Material)/i.test(r.parts.join(' '));
  /** Quita una aclaración inicial ("(You do not use "Polymerization".) Once per turn (Quick Effect): ...")
   * o la cuenta de una viñeta ("3+: When ... (Quick Effect): ...") para leer la condición del efecto. */
  const stripLead = (s) => {
    s = String(s || '');
    const m = s.match(/^\((?:[^()"]|"[^"]*")*\)\s+(?=[A-Z])/) || s.match(/^\d+\+?(?:\s*(?:[-–~,]|or more|or less)\s*\d*)*\s*:\s+(?=\S)/);
    return m ? s.slice(m[0].length) : s;
  };

  function buildAnalysis(c) {
    const isMon = db.isMonster(c);
    const raw = [];
    const limits = [];
    const reqs = [];
    let materials = null, section = isMon ? 'monster' : 'card', prev = null, last = null;
    let list = null;     // restricción que encabeza una lista de efectos con viñetas
    let runOwn = false;  // las viñetas de esta tanda son efectos aparte
    const blocks = blocksOf(c);
    blocks.forEach((b, bi) => {
      if (b.kind !== 'bullet') { list = null; runOwn = false; }
      if (b.kind === 'head') {
        section = b.head === 'pendulum effect' ? 'pendulum' : b.head === 'flavor text' ? 'flavor' : 'monster';
        last = null;
        prev = 'head';
        return;
      }
      if (b.kind === 'flavor' || b.kind === 'sep' || b.kind === 'note') { prev = b.kind; return; }
      // "(This card's original Level is always treated as 12.)" no son materiales aunque esté en la primera línea
      if (b.kind === 'materials' && /^\(.*\)$/.test(b.text)) { prev = 'note'; return; }
      if (b.kind === 'materials') { materials = b.text; prev = b.kind; return; }
      if (section === 'flavor') return;
      if (b.kind === 'req' || (b.kind === 'effect' && /^Cannot be (?:Fusion|Synchro|Xyz|Link|Ritual|Pendulum) Summoned\.?$/.test(b.text))) { reqs.push(b.text); prev = 'req'; return; }
      if (b.kind === 'limit') {
        // "Once per turn, you can activate 1 of these effects.": encabeza una lista; cada viñeta es un efecto (límite blando compartido)
        if (/^Once per (?:turn|Duel), you can activate (?:1|one) of (?:these|the following) effects\.?$/i.test(b.text)) {
          limits.push((list = { text: b.text, section, at: raw.length, head: true }));
          prev = 'limit';
          return;
        }
        // "Once per turn, you can also Xyz Summon "X" by using ...": forma de invocarse, no efecto
        if (SUMMON_RULE.test(b.text) && !hasTop(b.text, ':') && !hasTop(b.text, ';')) { reqs.push(b.text); prev = 'req'; return; }
        // "Once per turn, ...: ..." es un efecto con límite blando, aunque la ficha lo pinte como restricción
        if (/^Once per (?:turn|Duel), /.test(b.text) && (hasTop(b.text, ':') || hasTop(b.text, ';') || /\byou can\b/i.test(b.text))) {
          raw.push((last = { section, parts: (b.parts || [b.text]).slice(), bullets: [] }));
          prev = 'effect';
          return;
        }
        const L = { text: b.text, section, at: raw.length };
        limits.push(L);
        // "You can only use each of the following effects..." / "...1 of these effects...": las viñetas que siguen son efectos aparte
        if (/\b(?:following|these) effects\b|\beach (?:monster )?effect of\b/i.test(b.text) && !/\bpreceding\b/i.test(b.text)) list = L;
        prev = 'limit';
        return;
      }
      if (b.kind === 'bullet') {
        if (!blocks[bi - 1] || blocks[bi - 1].kind !== 'bullet') {
          // Primera viñeta de la tanda: tras una lista de efectos, o tras un efecto continuo que gana efectos que se activan
          // ("...it gains these effects. ● Once per turn: You can ..."), cada viñeta es un efecto aparte
          const run = [];
          for (let j = bi; j < blocks.length && blocks[j].kind === 'bullet'; j++) run.push(blocks[j].text);
          // (la activación de una Mágica/Trampa normal no es "continua": sus viñetas son opciones)
          const actLike = !isMon && !(c.type & (T.CONTINUOUS | T.FIELD | T.EQUIP)) && last === raw[0];
          runOwn = !!list || !!(last && !actLike && passiveRaw(last) && !grantsOther(last) && run.some(activatedBullet));
        }
        // Si no, son opciones del efecto anterior (salvo una viñeta con su propia condición tras una restricción)
        const own = runOwn || (prev === 'limit' && hasTop(b.text, ':') && !NUM_COND.test(b.text));
        if (own || !last) {
          raw.push((last = { section, parts: [b.text], bullets: [] }));
          if (list) list.end = raw.length;
          if (!own) prev = 'effect';
          return;
        }
        last.bullets.push(b.text);
        return;
      }
      const parts = (b.parts || [b.text]).slice();
      // "You can activate 1 of these effects." (sin ":") en un monstruo o una carta que se queda en el campo: encabeza una lista
      if (/^You can activate (?:1|one) of (?:these|the following) effects\.$/i.test(parts.join(' ')) && (isMon || c.type & (T.CONTINUOUS | T.FIELD | T.EQUIP))) {
        limits.push((list = { text: b.text, section, at: raw.length, plain: true }));
        prev = 'limit';
        return;
      }
      // "1: Halve your LP." (dado) o "If you do: ..." siguen el efecto anterior
      if (last && last.section === section && (NUM_COND.test(parts[0]) || CONTINUES.test(parts[0]))) {
        last.parts.push(...parts);
        prev = 'effect';
        return;
      }
      // "You can Normal Summon this card without Tributing." / "You can Ritual Summon this card with ...": requisito, no efecto
      let rule = false;
      while (parts.length && SUMMON_RULE.test(parts[0]) && !hasTop(parts[0], ':') && !hasTop(parts[0], ';')) {
        reqs.push(parts.shift());
        // "(Transfer its materials to this card.)" va con esa forma de invocarse
        while (parts.length && /^\(.*\)$/.test(parts[0])) reqs.push(parts.shift());
        rule = true;
      }
      if (rule && !parts.length) { prev = 'req'; return; }
      if (!parts.length) { prev = 'req'; return; }
      raw.push((last = { section, parts, bullets: [] }));
      prev = 'effect';
    });

    // Activación de Mágicas y Trampas
    const effects = [];
    let actIdx = -1;
    if (!isMon) {
      if (!(c.type & (T.CONTINUOUS | T.FIELD | T.EQUIP))) actIdx = raw.length ? 0 : -1;
      else {
        actIdx = raw.findIndex((r) => /^When this card is activated\b/i.test(r.parts[0]));
        // Tras "You can activate 1 of these effects." las viñetas son efectos de la carta ya activada
        if (actIdx < 0 && raw.length && !limits.some((L) => L.plain && L.at === 0)) {
          const s0 = raw[0].parts[0];
          if (/^(?:Activate this card|Activate only)/i.test(s0)
            || (c.type & T.TRAP && hasTop(s0, ';') && !hasTop(s0, ':') && !/^(?:You can|Once per)/i.test(s0))) actIdx = 0;
        }
      }
      if (actIdx < 0) {
        effects.push({
          index: 0, text: 'Activar la carta.', html: '<span class="t-eff">Activar la carta.</span>', kind: 'activation',
          speed: speedOf(c, 'activation'), condition: null, cost: null, optKey: null, optLimit: null, optLabel: null, opts: [],
          pendulum: false, unsure: false, oncePerChain: false, locks: [], where: null, synthetic: true,
        });
      }
    }
    raw.forEach((r, i) => effects.push(makeEffect(c, r, i + 1, i === actIdx)));

    // Restricciones de uso ("You can only use ... once per turn") y bloqueos
    const name = c.name;
    const real = effects.filter((e) => !e.synthetic);
    const usable = (e) => e && ACTIVATED.includes(e.kind);
    const summonOpts = [];
    const fieldLocks = [];
    const times = (w) => (/four times/.test(w) ? 4 : /thrice/.test(w) ? 3 : /twice/.test(w) ? 2 : 1);
    let controlOne = null, archOnly = null;
    const perLabel = (duel) => (duel ? 'por Duelo' : 'por turno');
    const add = (e, o) => { if (usable(e) && !e.opts.some((x) => x.key === o.key)) e.opts.push(o); };
    for (const L of limits) {
      const t = L.text;
      const duel = /per Duel/i.test(t);
      const sec = (e) => e.pendulum === (L.section === 'pendulum');
      const before = real.filter((e) => e.index <= L.at && sec(e));
      const after = real.filter((e) => e.index > L.at && sec(e));
      let m;
      if (L.head) {
        // "Once per turn, you can activate 1 of these effects.": las viñetas comparten un límite blando (cada copia)
        const range = after.filter((e) => e.index <= (L.end || L.at));
        for (const e of range) add(e, { key: 'copy:#list' + L.at, limit: 1, perCopy: true, duel, label: 'Solo 1 de estos efectos ' + perLabel(duel) + ' (cada copia)' });
        continue;
      }
      if ((m = t.match(/^You can only (?:use|apply) (?:this|the|the previous|the preceding) effect of ".*" (once|twice|thrice|up to twice|up to thrice|up to four times) per (?:turn|Duel)/))) {
        const target = before.filter(usable).pop() || before[before.length - 1] || after.find(usable);
        const n = times(m[1]);
        if (target) add(target, { key: 'opt:' + name + '#' + target.index, limit: n, duel, label: (['', 'Una vez', 'Dos veces', 'Tres veces', 'Cuatro veces'][n] || n + ' veces') + ' ' + perLabel(duel) + ' (este efecto)' });
        if (/its previous effect only once per turn/.test(t)) {
          const p2 = before.filter(usable).slice(-2)[0];
          if (p2 && p2 !== target) add(p2, { key: 'opt:' + name + '#' + p2.index, limit: 1, label: 'Una vez por turno (este efecto)' });
        }
      } else if (/^You can only (?:use|activate) (?:this|the) effect of ".*" once per Chain/.test(t)) {
        const target = before.filter(usable).pop() || after.find(usable);
        if (target) target.oncePerChain = true;
      } else if (/^You can only use (?:the following effect|the 1st of the following effects) of /.test(t)) {
        const target = after.find(usable);
        if (target) add(target, { key: 'opt:' + name + '#' + target.index, limit: 1, duel, label: 'Una vez ' + perLabel(duel) + ' (este efecto)' });
      } else if ((m = t.match(/^You can only (?:use|apply) each (?:of the (following|preceding|previous) effects|of these effects|(Pendulum Effect|Monster Effect|monster effect|effect)) of /))) {
        let range;
        if (m[1]) range = m[1] === 'following' ? after : before;
        else if (m[2] === 'Pendulum Effect') range = real.filter((e) => e.pendulum);
        else if (/^Monster Effect$/i.test(m[2])) range = real.filter((e) => !e.pendulum);
        else if (m[2] === 'effect') range = real.filter(sec);
        else range = after.some(usable) ? after : before;
        for (const e of range) add(e, { key: 'opt:' + name + '#' + e.index, limit: 1, duel, label: 'Una vez ' + perLabel(duel) + ' (cada efecto por separado)' });
      } else if ((m = t.match(/^You can only use (\d+) (?:of the (following)|of (these)|".*" effect)/))) {
        const range = m[2] ? after : m[3] ? (after.some(usable) ? after : before) : real;
        const key = 'opt:' + name + '#shared' + (m[2] || m[3] ? ':' + L.at : '');
        const label = m[2] || m[3] ? 'Solo ' + m[1] + ' de estos efectos ' + perLabel(duel) : 'Solo ' + m[1] + ' efecto de ' + q(name) + ' ' + perLabel(duel);
        for (const e of range) add(e, { key, limit: 1, duel, label, shared: true });
      } else if ((m = t.match(/^You can only activate (?:(\d+) ".*" per|".*" once per) (?:turn|Duel)/))) {
        const n = Number(m[1]) || 1;
        if (!isMon) for (const e of effects.filter((x) => x.kind === 'activation')) add(e, { key: 'act:' + name, limit: n, duel, act: true, label: 'Solo puedes activar ' + n + ' ' + q(name) + ' ' + perLabel(duel) });
      } else if ((m = t.match(/^You can only control (?:1|one) (face-up )?"([^"]+)"/))) {
        // "You can only control 1 "X"": no puedes tener otra boca arriba (lo revisan la invocación y la activación)
        controlOne = { name: m[2], faceUp: true };
      } else if ((m = t.match(/^You can only activate (\d+) other "([^"]+)" monster effects?, the turn you activate this effect/))) {
        // Mulcharmy: el turno en que activas este efecto, solo 1 efecto de monstruo "Mulcharmy" más
        const target = before.filter(usable).pop();
        if (target) archOnly = { arch: m[2], others: Number(m[1]) || 1, index: target.index };
      } else if ((m = t.match(/^You can only (Special|Link|Synchro|Xyz|Fusion|Ritual|Pendulum) Summon ".*" once per (?:turn|Duel)( this way)?/))) {
        const method = m[1] === 'Special' ? null : m[1].toLowerCase();
        summonOpts.push({
          key: 'ss:' + name + (method ? ':' + method : ''), limit: 1, duel, method, thisWay: !!m[2],
          label: 'Solo puedes Invocar ' + q(name) + ' una vez ' + perLabel(duel) + (m[2] ? ' de esta forma' : ''),
        });
      }
      // Bloqueos dentro de la restricción ("You cannot Special Summon ... the turn you activate ...")
      for (const lock of parseLocks(t, 'continuous')) {
        lock.section = L.section;
        if (lock.timing === 'continuous') { fieldLocks.push(lock); continue; }
        let range;
        if (/this effect/i.test(t) && !/either|these effects|this card's effects/i.test(t)) range = [before.filter(usable).pop() || after.find(usable)].filter(Boolean);
        else if (/this card\b(?!'s)/i.test(t) && !isMon) range = effects.filter((e) => e.kind === 'activation');
        else range = effects.filter(usable);
        for (const e of range) e.locks.push(lock);
      }
    }
    for (const e of effects) {
      if (e.kind === 'continuous') for (const l of e.locks) fieldLocks.push(Object.assign({}, l, { timing: 'continuous' }));
      if (e.opts.length) {
        const hard = e.opts.find((o) => !o.perCopy && !o.act) || e.opts[0];
        e.optKey = hard.key;
        e.optLimit = hard.limit;
        e.optLabel = e.opts.map((o) => o.label).join(' · ');
      }
    }
    return { effects, reqs, materials, summonOpts, fieldLocks, controlOne, archOnly };
  }
  function analyze(c) {
    if (!c) return EMPTY;
    const hit = analysisCache.get(c.id);
    if (hit && hit.desc === c.desc) return hit.a;
    let a;
    try { a = buildAnalysis(c); } catch (e) { a = EMPTY; }
    analysisCache.set(c.id, { desc: c.desc, a });
    return a;
  }
  const cardOf = (x) => (x && typeof x === 'object' ? x : db.get(x));
  /** Efectos de la carta, numerados como en la ficha (index 1 = primer párrafo de efecto; 0 = activar la carta sin efecto). */
  function effectsOf(card) {
    const c = cardOf(card);
    return c ? analyze(c).effects : [];
  }

  /** Forma propia de invocarse: un efecto 'summon' ("You can Special Summon this card (from your hand)...")
   * o un requisito "Must be Special Summoned (from your Extra Deck) by sending ...".
   * → { text, index (del efecto o null), from: ['hand'|'gy'|'extra'|'deck'|'ban'], center, costs } o null */
  function procedureOf(card) {
    const c = cardOf(card);
    if (!c || !db.isMonster(c)) return null;
    const a = analyze(c);
    const e = a.effects.find((x) => x.kind === 'summon');
    const r = a.reqs.find((t) => /^(?:Must (?:first )?be|Can only be) Special Summoned\b.*\bby\b/i.test(t));
    const text = e ? e.text : r || null;
    if (!text) return null;
    const fm = text.match(/from your ([^).;]*?)(?:\)| by\b| to\b|\.|,|$)/i);
    const src = fm ? fm[1] : '';
    const from = [];
    if (/\bhand\b/i.test(src)) from.push('hand');
    if (/\b(?:GY|Graveyard)\b/i.test(src)) from.push('gy');
    if (/Extra Deck/i.test(src)) from.push('extra');
    else if (/\bDeck\b/i.test(src)) from.push('deck');
    if (/banish/i.test(src) || /while (?:it is |this card is )?banished/i.test(text)) from.push('ban');
    return {
      text, index: e ? e.index : null, from, center: /center Main Monster Zone/i.test(text),
      costs: /\bby (?:sending|Tributing|banishing|returning|shuffling|discarding|detaching|placing|revealing|paying|removing)\b/i.test(text),
    };
  }

  /* ---------- Materiales ---------- */
  const matCache = new Map();
  function parseMaterials(card) {
    const c = cardOf(card);
    if (!c || !db.isMonster(c)) return { procedure: null, text: null, understood: false, summary: '', parts: [] };
    if (matCache.has(c.id)) return matCache.get(c.id);
    const t = c.type;
    const procedure = t & T.SYNCHRO ? 'synchro' : t & T.XYZ ? 'xyz' : t & T.LINK ? 'link' : t & T.FUSION ? 'fusion' : t & T.RITUAL ? 'ritual' : null;
    let res;
    if (procedure === 'ritual') {
      const m = (c.desc || '').match(/Ritual Summon this card with "([^"]+)"/);
      const spell = m ? db.findByName(m[1]) : null;
      const exact = !!(spell && /exactly equal|equal exactly/i.test(spell.desc || ''));
      // "Meteonis Drytron": se libera ATK (total igual o mayor que el ATK del monstruo de Ritual), no Niveles
      const spellAtk = !!(spell && RITUAL_ATK.test(spell.desc || ''));
      res = {
        procedure, text: m ? m[0] : null, understood: true, parts: [], spell: m ? m[1] : null, exact, spellAtk,
        summary: spellAtk ? 'Liberar monstruos de tu mano o campo cuyo ATK total sea ' + c.atk + ' o más (con ' + q(m[1]) + ')'
          : 'Liberar monstruos de tu mano o campo cuyos Niveles sumen ' + (exact ? 'exactamente ' + c.lv : c.lv + ' o más') + (m ? ' (con ' + q(m[1]) + ')' : ''),
      };
    } else if (procedure) {
      const text = analyze(c).materials;
      let parts = [], understood = false;
      if (text) {
        parts = splitTop(text, ' + ').map(parsePart);
        understood = parts.length > 0 && parts.every((p) => p.understood);
      }
      // Otra forma de Invocación Xyz/Sincronía...: "You can also Xyz Summon this card by using ..." o con el nombre de la carta
      // ("you can also Xyz Summon "Cyber Dragon Infinity" by using "Cyber Dragon Nova" ..."); sigue siendo esa invocación
      const altRe = new RegExp('\\b(?:also|can) (?:Xyz|Synchro|Link|Fusion) Summon (?:this card|"' + reEsc(c.name) + '")([^.]*)|Xyz Summon this card by using([^.]*)', 'i');
      const am = (c.desc || '').match(altRe);
      const alt = !!am;
      let altDesc = null;
      const using = am && (am[1] || am[2] || '').match(/by using (?:1 |a |an )?(.+?)(?: you control)?(?: with a different name)?(?: on the field)? as (?:the )?(?:Xyz )?[Mm]aterial/);
      if (using) { const d = parseDesc(using[1]); if (d.understood && d.tests.length) altDesc = d; }
      const word = { synchro: 'Synchro', xyz: 'Xyz', link: 'Link', fusion: 'Fusion' }[procedure];
      const blocked = analyze(c).reqs.some((r) => new RegExp('^Cannot be ' + word + ' Summoned').test(r));
      res = {
        procedure, text, understood: understood && !blocked, parts, alt, altDesc, blocked,
        summary: blocked ? 'No se puede hacer su ' + METHOD_LABELS[procedure] + ': se invoca con su propio procedimiento.'
          : understood ? parts.map(partSummary).join(' + ') : 'No entendí los materiales: ' + (text || '(sin texto)'),
      };
    } else res = { procedure: null, text: null, understood: false, summary: '', parts: [] };
    matCache.set(c.id, res);
    return res;
  }

  /* ---------- Zonas ---------- */
  /** Zonas a las que apuntan los monstruos Link boca arriba del jugador (sin contar los uids de exclude). */
  function linkedZones(S, exclude) {
    const skip = new Set(exclude || []);
    const out = new Set();
    for (const z of MON_ZONES) {
      const inst = topOf(S, z);
      if (!inst || inst.faceDown || skip.has(inst.uid)) continue;
      const c = db.get(inst.id);
      if (!c || !c.isLink) continue;
      const [col, row] = GRID[z];
      for (const [bit, dx, dy] of ARROWS) {
        if (!(c.def & bit)) continue;
        const tc = col + dx, tr = row + dy;
        const hit = Object.keys(GRID).find((k) => GRID[k][0] === tc && GRID[k][1] === tr);
        if (hit) out.add(hit);
      }
    }
    return out;
  }
  function placementChecks(S, uid, zone, opts, v) {
    opts = opts || {};
    const loc = locate(S, uid);
    const inst = loc ? loc.inst : opts.inst;
    const c = inst && db.get(inst.id);
    if (!c) { err(v, 'No encuentro esa carta.'); return; }
    if (!FIELD_ZONES.includes(zone)) { err(v, 'Zona desconocida.'); return; }
    const from = opts.from || (loc ? loc.area : null);
    const vac = new Set(opts.vacating || []);
    const taken = new Set(opts.taken || []);
    const occ = topOf(S, zone);
    if ((occ && occ.uid !== uid && !vac.has(occ.uid)) || taken.has(zone)) err(v, 'Esa zona ya está ocupada.');
    if (zone === 'fz') {
      if (!(c.type & T.FIELD)) err(v, 'La Zona de Campo es solo para Mágicas de Campo.');
      return;
    }
    if (ST.includes(zone)) {
      if (db.isMonster(c)) {
        if (c.type & T.PENDULUM && !opts.faceDown) {
          if (zone !== 'st0' && zone !== 'st4') err(v, 'Las Escalas de Péndulo van en las zonas de los extremos.');
        } else warn(v, 'Un monstruo solo va en la Zona de Mágicas y Trampas si un efecto lo pone ahí.');
      } else if (c.type & T.FIELD) err(v, 'Las Mágicas de Campo van en la Zona de Campo.');
      return;
    }
    if (!db.isMonster(c)) {
      if (/Special Summon this card .*as an? .*Monster/i.test(c.desc || '')) warn(v, 'Trampa Monstruo: solo con su propio efecto.');
      else err(v, 'En las Zonas de Monstruo solo van monstruos.');
      return;
    }
    const fromExtra = from === 'extra';
    const linked = linkedZones(S, [...vac, uid]);
    // Un monstruo del rival en esa Zona Extra (Angelechy Destrier): no es tuya mientras siga ahí
    const tk = EMZ.includes(zone) ? emzTakenLock(S, zone) : null;
    if (tk) err(v, 'Esa Zona de Monstruo Extra la ocupa ' + q(tk.source || 'un monstruo del rival') + ' del rival.');
    if (EMZ.includes(zone)) {
      if (!fromExtra) {
        if (from === 'field' || from === 'material') warn(v, 'Solo un efecto puede mover un monstruo a la Zona de Monstruo Extra.');
        else err(v, 'La Zona de Monstruo Extra es solo para monstruos que salen del Extra Deck.');
      }
      const other = topOf(S, zone === 'emz0' ? 'emz1' : 'emz0');
      const otherTaken = taken.has(zone === 'emz0' ? 'emz1' : 'emz0');
      if (((other && other.uid !== uid && !vac.has(other.uid)) || otherTaken) && !linked.has(zone)) err(v, 'Solo puedes usar una Zona de Monstruo Extra a la vez.');
    } else if (fromExtra && (c.isLink || faceUpInExtra(c, inst))) {
      if (!linked.has(zone)) {
        err(v, (c.isLink ? 'Los monstruos Link' : 'Los monstruos de Péndulo boca arriba')
          + ' que salen del Extra Deck van a una Zona de Monstruo Extra o a una zona a la que apunte un Link.');
      }
    }
  }
  function checkPlacement(S, uid, zone, opts) {
    const v = verdict();
    try { placementChecks(S, uid, zone, opts, v); } catch (e) { warn(v, 'No pude revisar la zona.'); }
    return done(v);
  }
  /** Zonas válidas para la carta (para resaltar en el tablero). */
  function legalZones(S, uid, opts) {
    const loc = locate(S, uid);
    const c = loc && db.get(loc.inst.id);
    if (!c) return [];
    let cands;
    if (opts && opts.zones) cands = opts.zones;
    else if (db.isMonster(c) && !(opts && opts.scale)) cands = MON_ZONES;
    else if (c.type & T.FIELD) cands = ['fz'];
    else if (db.isMonster(c)) cands = ['st0', 'st4'];
    else cands = ST;
    return cands.filter((z) => {
      const v = verdict();
      try { placementChecks(S, uid, z, opts, v); } catch (e) { return false; }
      return !v.errors.length;
    });
  }

  /* ---------- Veredictos ---------- */
  function verdict() { return { ok: true, errors: [], warnings: [] }; }
  function err(v, m) { if (!v.errors.includes(m)) v.errors.push(m); }
  function warn(v, m) { if (!v.warnings.includes(m)) v.warnings.push(m); }
  function done(v) { v.ok = !v.errors.length; return v; }
  /** Invocaciones "inherentes" (Normal, Sincronía, Xyz, Link, Péndulo, procedimiento propio): tu Fase Principal y cadena vacía. */
  function openMain(v, S, t, what) {
    if (!t.mine) err(v, 'Solo puedes ' + what + ' en tu turno.');
    else if (!isMain(t)) err(v, 'Solo puedes ' + what + ' en tu Fase Principal.');
    if (chainLen(S)) err(v, 'Solo puedes ' + what + ' con la cadena vacía.');
  }

  /* ---------- Efecto que permite una invocación ---------- */
  /** Carta del efecto: req.sourceId, req.sourceUid o el nombre entre «» de req.source (lo arma field.js). null si no se sabe. */
  function sourceCard(S, req) {
    if (!req) return null;
    if (req.sourceId) { const c = db.get(req.sourceId); if (c) return c; }
    if (req.sourceUid) { const l = locate(S, req.sourceUid); const c = l && db.get(l.inst.id); if (c) return c; }
    const m = /«([^»]+)»/.exec(String(req.source || ''));
    return (m && db.findByName(m[1])) || (req.source && db.findByName(String(req.source))) || null;
  }
  /** Texto del efecto de la fuente: el efecto N si se sabe (eslabón de la cadena o "(efecto N)"); si no, todo el texto. */
  function sourceText(S, req, c) {
    const chain = S && Array.isArray(S.chain) ? S.chain : [];
    const link = chain.find((l) => l && ((req.sourceUid && l.uid === req.sourceUid) || (!req.sourceUid && req.sourceId && l.id === req.sourceId)));
    const m = /\(efecto (\d+)\)/.exec(String(req.source || ''));
    const idx = req.sourceEffect != null ? Number(req.sourceEffect) : link ? Number(link.effectIndex) : m ? Number(m[1]) : null;
    const e = idx ? effectsOf(c).find((x) => x.index === idx) : null;
    return e ? e.text : c.desc || '';
  }
  /** ¿El efecto hace esta invocación? 'yes' | 'special' (solo Invoca de forma Especial) | 'no' (no invoca) */
  function sourceDoes(text, method) {
    const word = { synchro: 'Synchro', xyz: 'Xyz', link: 'Link', fusion: 'Fusion', ritual: 'Ritual', pendulum: 'Pendulum' }[method];
    const t = String(text || '').replace(new RegExp('not (?:treated as|considered) an? ' + word + ' Summon', 'gi'), '');
    if (new RegExp('\\b' + word + ' Summon|treated as an? ' + word + ' Summon|as ' + word + ' Material', 'i').test(t)) return 'yes';
    if (method === 'ritual' && /Tribute[^.]*Levels?|Levels?[^.]*Tribute|total ATK/i.test(t)) return 'yes';
    if (/Special Summon/i.test(t)) return 'special';
    return /\bSummon/i.test(t) ? 'yes' : 'no';
  }
  /** Material de Fusión/Ritual que no está en tu mano ni en tu campo: vale si el efecto usa materiales de ese lugar. */
  function matPlace(v, S, req, x, verb) {
    const where = { gy: 'en el Cementerio', deck: 'en el Mazo', extra: 'en el Extra Deck', ban: 'desterrada', material: 'como material Xyz' }[x.loc.area] || 'fuera de tu mano y tu campo';
    const src = sourceCard(S, req);
    const text = src ? sourceText(S, req, src) : '';
    const words = { gy: /\bGY\b|Graveyard/i, deck: /\bDeck\b/i, extra: /Extra Deck/i, ban: /banish/i }[x.loc.area];
    const t2 = x.loc.area === 'deck' ? text.replace(/Extra Deck/gi, '') : text;
    if (src && words && !words.test(t2)) err(v, q(x.c.name) + ' está ' + where + ': el efecto de ' + q(src.name) + ' no usa materiales de ahí.');
    else if (!src || !words) warn(v, q(x.c.name) + ' está ' + where + ': solo vale si el efecto que usas permite ' + verb + ' materiales de ahí.');
  }

  /* ---------- Invocaciones ---------- */
  function checkSummon(S, req) {
    const v = verdict();
    v.from = {};
    try { summonChecks(S, req || {}, v); } catch (e) { warn(v, 'No pude revisar esta invocación por completo.'); }
    return done(v);
  }

  /** Materiales: [{ uid, loc, inst, c }] y errores comunes (repetidos, inexistentes, la misma carta). */
  function materialsOf(S, req, v) {
    const out = [];
    const seen = new Set();
    for (const uid of req.materials || []) {
      if (seen.has(uid)) { err(v, 'Elegiste el mismo material dos veces.'); continue; }
      seen.add(uid);
      if (uid === req.uid) { err(v, 'Un monstruo no puede ser su propio material.'); continue; }
      const loc = locate(S, uid);
      const c = loc && db.get(loc.inst.id);
      if (!c) { err(v, 'No encuentro uno de los materiales.'); continue; }
      out.push({ uid, loc, inst: loc.inst, c });
    }
    return out;
  }
  // Materiales con texto que cambia la regla: desde la mano, "trátalo como no Cantante", "como Nivel N", "como 2 materiales"...
  const SPECIAL_MAT = {
    Synchro: /would be used as Synchro Material|treat (?:it|this card) as (?:a )?(?:non-Tuner|Tuner|Level \d)|can be treated as (?:a )?(?:non-Tuner|Level)/i,
    Xyz: /would be used as Xyz Material|treat (?:it|this card) as (?:a )?Level \d|can be treated as (?:a )?Level|for the Xyz Summon of/i,
    Link: /would be used as Link Material|as 2 (?:Link )?materials|treat (?:it|this card) as 2|treat this card as Link Material|can be used as Link Material/i,
  };
  const specialMat = (word, x) => SPECIAL_MAT[word].test(x.c.desc || '');
  /** Cartas boca arriba en tu campo (para efectos continuos que cambian reglas). */
  const fieldCards = (S) => FIELD_ZONES.map((z) => topOf(S, z)).filter((i) => i && !i.faceDown).map((i) => db.get(i.id)).filter(Boolean);
  const onFieldFaceUp = (x) => x.loc.area === 'field' && MON_ZONES.includes(x.loc.zone) && !x.inst.faceDown;
  const onField = (x) => x.loc.area === 'field' && MON_ZONES.includes(x.loc.zone);
  /** Los materiales de Sincronía/Xyz/Link deben estar boca arriba en tu campo. */
  function needFieldFaceUp(v, xs, word, relaxed) {
    for (const x of xs) {
      if (onFieldFaceUp(x)) continue;
      const special = specialMat(word, x);
      const msg = !onField(x) ? q(x.c.name) + ' no está en tu campo.' : q(x.c.name) + ' está boca abajo: los materiales deben estar boca arriba.';
      if (relaxed || special) warn(v, msg + ' Solo vale si un efecto lo permite.');
      else err(v, msg);
    }
  }
  /** Reparte materiales según el texto; si falla, explica por qué. */
  function matchParts(v, xs, mat, c, soft) {
    const fail = soft ? warn : err;
    if (!mat.understood) {
      warn(v, 'No pude verificar los materiales de ' + q(c.name) + ': ' + (mat.text || 'sin texto') + '.');
      return true;
    }
    if (solve(xs, mat.parts)) return true;
    const minN = mat.parts.reduce((a, p) => a + p.min, 0);
    const maxN = mat.parts.reduce((a, p) => a + p.max, 0);
    if (xs.length < minN || xs.length > maxN) {
      fail(v, q(c.name) + ' pide ' + mat.summary + ' (usaste ' + xs.length + ' material' + (xs.length === 1 ? '' : 'es') + ').');
      return false;
    }
    const bad = xs.find((x) => !mat.parts.some((p) => fits(p.desc, x)));
    if (bad) fail(v, q(bad.c.name) + ' no sirve como material de ' + q(c.name) + ' (pide ' + mat.summary + ').');
    else fail(v, 'Los materiales no cumplen: ' + mat.summary + '.');
    return false;
  }

  function summonChecks(S, req, v) {
    const t = tsOf(S);
    const method = req.method || 'special';
    if (method === 'pendulum') { pendulumChecks(S, req, v, t); return; }
    const loc = locate(S, req.uid);
    const c = loc && db.get(loc.inst.id);
    if (!c) { err(v, 'No encuentro esa carta.'); return; }
    v.from[req.uid] = loc.area;
    if (!db.isMonster(c)) {
      if (/Special Summon this card .*as an? .*Monster/i.test(c.desc || '')) warn(v, 'Trampa Monstruo: solo con su propio efecto.');
      else { err(v, 'Solo se pueden invocar monstruos.'); return; }
    }
    const a = analyze(c);
    const reqText = a.reqs.join(' ');
    const desc = c.desc || '';
    const xs = materialsOf(S, req, v);
    // Contact "C" boca arriba en tu campo (la Invoca el rival): sin ella como material no hay Fusión, Sincronía, Xyz ni Link
    if (['fusion', 'synchro', 'xyz', 'link'].includes(method)) {
      // Cada copia boca arriba pone su propia restricción: todas tienen que ser materiales
      const ccs = MON_ZONES.map((z) => topOf(S, z)).filter((i) => i && !i.faceDown && Number(i.id) === CONTACT_C);
      const missing = ccs.filter((i) => !(req.materials || []).includes(i.uid)).length;
      if (missing) err(v, 'Por «Contact "C"» solo puedes invocar por Fusión, Sincronía, Xyz o Link usándola como material'
        + (ccs.length > 1 ? ' (tienen que ser materiales las ' + ccs.length + ' que hay en tu campo).' : '.'));
    }
    const vacating = xs.filter(onField).map((x) => x.uid);
    const fromExtra = loc.area === 'extra';
    // Un monstruo boca arriba en la Zona de Péndulo sí puede invocarse desde ahí (lo dice el efecto que lo permite)
    if (!NORMAL_METHODS.includes(method) && loc.area === 'field' && placeOf(loc, c) !== 'pendulum') err(v, q(c.name) + ' ya está en el campo.');
    // "You can only control 1 "X"": otra boca arriba en tu campo impide invocarla boca arriba
    const pos0 = req.position || (method === 'set' || method === 'tributeSet' ? 'set' : 'atk');
    if (a.controlOne && pos0 !== 'set' && controlsOther(S, req.uid, a.controlOne.name)) err(v, 'Solo puedes controlar 1 ' + q(a.controlOne.name) + ' boca arriba.');

    if (NORMAL_METHODS.includes(method)) normalChecks(S, req, v, t, c, loc, xs, desc, reqText);
    else if (method === 'synchro' || method === 'xyz' || method === 'link') {
      const bit = { synchro: T.SYNCHRO, xyz: T.XYZ, link: T.LINK }[method];
      const word = { synchro: 'Synchro', xyz: 'Xyz', link: 'Link' }[method];
      const label = { synchro: 'de Sincronía', xyz: 'Xyz', link: 'Link' }[method];
      if (!(c.type & bit)) { err(v, q(c.name) + ' no es un monstruo ' + label + '.'); return; }
      if (new RegExp('Cannot be ' + word + ' Summoned', 'i').test(reqText)) err(v, q(c.name) + ' no se puede Invocar por ' + { synchro: 'Sincronía', xyz: 'Xyz', link: 'Link' }[method] + ': usa su propio procedimiento (Invocación Especial).');
      if (!fromExtra) err(v, 'La ' + METHOD_LABELS[method] + ' es desde el Extra Deck.');
      else if (db.isExtra(c) && faceUpInExtra(c, loc.inst)) err(v, faceUpExtraOnlyPendulum(method));
      sourceOrMain(v, S, req, t, method, true);
      if (!xs.length) err(v, 'Elige los materiales.');
      else {
        needFieldFaceUp(v, xs, word, !!req.source);
        // Los Tokens no pueden ser material Xyz (sí de Sincronía, Link o Fusión)
        if (method === 'xyz') for (const x of xs) if (isToken(x)) err(v, q((x.inst.token && x.inst.token.name) || x.c.name) + ' es un Token: los Tokens no pueden ser material Xyz.');
        if (method === 'synchro') synchroChecks(v, c, xs);
        else if (method === 'xyz') xyzChecks(v, c, xs, req);
        else linkChecks(v, c, xs);
      }
    } else if (method === 'fusion') {
      if (!(c.type & T.FUSION)) { err(v, q(c.name) + ' no es un monstruo de Fusión.'); return; }
      sourceOrMain(v, S, req, t, method, false);
      if (/Cannot be Fusion Summoned/i.test(reqText)) err(v, q(c.name) + ' no se puede Invocar por Fusión: usa su propio procedimiento (Invocación Especial).');
      if (!fromExtra) err(v, 'La Invocación por Fusión es desde el Extra Deck.');
      else if (db.isExtra(c) && faceUpInExtra(c, loc.inst)) err(v, faceUpExtraOnlyPendulum(method));
      if (/Must (?:first )?be Special Summoned\b/i.test(reqText) && !/Fusion Summon/i.test(reqText) && !req.source) {
        warn(v, q(c.name) + ' se invoca con su propio procedimiento (no con Polimerización).');
      }
      if (!xs.length) (req.source ? warn : err)(v, 'Elige los materiales de Fusión.');
      for (const x of xs) {
        if (!(db.isMonster(x.c) || /Fusion Material/i.test(x.c.desc || ''))) err(v, q(x.c.name) + ' no es un monstruo.');
        if (!(x.loc.area === 'hand' || onField(x))) matPlace(v, S, req, x, 'usar');
      }
      if (xs.length) fusionChecks(v, c, xs);
    } else if (method === 'ritual') { sourceOrMain(v, S, req, t, method, false); ritualChecks(S, req, v, t, c, loc, xs); }
    else specialChecks(S, req, v, t, c, loc, xs, a, reqText);

    // Posición
    const pos = req.position;
    if (c.isLink && pos && pos !== 'atk') err(v, 'Los monstruos Link siempre están en posición de Ataque.');
    if (pos === 'set' && !NORMAL_METHODS.includes(method)) warn(v, 'Solo algunos efectos invocan boca abajo.');

    // Zona
    if (req.zone) placementChecks(S, req.uid, req.zone, { vacating, from: loc.area }, v);
    else if (!legalZones(S, req.uid, { vacating, from: loc.area }).length) err(v, 'No hay una zona válida libre para este monstruo.');

    if (!NORMAL_METHODS.includes(method)) specialLimits(S, req, v, t, c, a, fromExtra, method);
  }

  /** ¿Controlas boca arriba otra carta llamada así (sin contar uid)? */
  function controlsOther(S, uid, name) {
    return FIELD_ZONES.some((z) => {
      const i = topOf(S, z);
      return i && i.uid !== uid && !i.faceDown && isNamed(db.get(i.id), name);
    });
  }
  /** Invocación hecha por un efecto (req.source) o inherente (inherent: en tu Fase Principal con la cadena vacía).
   * Si se sabe qué carta es la fuente, se revisa que su efecto haga esa invocación. */
  function sourceOrMain(v, S, req, t, method, inherent) {
    const what = 'hacer una ' + METHOD_LABELS[method];
    if (!req.source) { if (inherent) openMain(v, S, t, what); return; }
    const src = sourceCard(S, req);
    if (!src) {
      // "Otro efecto" sin carta: no se puede comprobar; fuera de momento solo se avisa
      const tmp = verdict();
      if (inherent) openMain(tmp, S, t, what);
      if (tmp.errors.length) warn(v, 'Fuera de tu Fase Principal o con una cadena abierta, solo vale si ese efecto hace la ' + METHOD_LABELS[method] + '.');
      return;
    }
    const does = sourceDoes(sourceText(S, req, src), method);
    if (does === 'yes') return;
    err(v, does === 'special'
      ? 'El efecto de ' + q(src.name) + ' Invoca de forma Especial, pero no hace una ' + METHOD_LABELS[method] + ' (decláralo como Invocación Especial).'
      : 'El efecto de ' + q(src.name) + ' no hace una ' + METHOD_LABELS[method] + '.');
    if (inherent) openMain(v, S, t, what);
  }
  // Efectos que dan una Invocación Normal adicional ("in addition to your Normal Summon/Set", "conduct 2 Normal Summons")
  const EXTRA_NS = /in addition to your Normal Summon|(?:conduct|perform) (?:2|two) Normal Summons|additional Normal Summon/i;
  /** Texto del efecto activado (entrada de turnState.acts). */
  function actText(a) {
    const c = db.get(a.id);
    if (!c) return '';
    const e = a.effectIndex ? effectsOf(c).find((x) => x.index === Number(a.effectIndex)) : null;
    return e ? e.text : c.desc || '';
  }

  function normalChecks(S, req, v, t, c, loc, xs, desc, reqText) {
    const method = req.method;
    const isSet = method === 'set' || method === 'tributeSet';
    const what = isSet ? 'Colocar de forma Normal' : 'Invocar de forma Normal';
    openMain(v, S, t, what);
    if (t.normalSummons >= 1) {
      // Una Invocación Normal adicional es legal si un efecto te la da: uno activado este turno o uno continuo en tu campo
      const granted = t.acts.filter((x) => EXTRA_NS.test(actText(x))).length;
      const onBoard = fieldCards(S).some((fc) => EXTRA_NS.test(fc.desc || ''));
      if (t.normalSummons < 1 + granted) warn(v, 'Invocación Normal adicional por un efecto que activaste este turno: revisa que el monstruo cumpla lo que pide.');
      else if (req.additional || onBoard) warn(v, 'Invocación Normal adicional: solo vale si un efecto de tu campo te la da (revisa lo que pide).');
      else err(v, 'Ya usaste tu Invocación Normal de este turno (Invocar o Colocar).');
    }
    if (db.isExtra(c)) { err(v, 'Los monstruos del Extra Deck no se pueden Invocar ni Colocar de forma Normal.'); return; }
    if (c.type & T.GEMINI && loc.area === 'field') warn(v, 'Invocación Normal de un Géminis en el campo: cuenta como tu Invocación Normal.');
    else if (loc.area !== 'hand') err(v, 'La Invocación Normal es desde la mano.');
    if (c.type & T.RITUAL) err(v, 'Los monstruos de Ritual no se pueden Invocar ni Colocar de forma Normal.');
    if (/(?:^|\. |\n)(?:This card )?cannot be Normal Summoned(?:\/Set| or Set)/i.test(desc)) err(v, q(c.name) + ' no se puede Invocar ni Colocar de forma Normal.');
    else if (!isSet && /(?:^|\. |\n)(?:This card )?cannot be Normal Summoned/i.test(desc)) err(v, q(c.name) + ' no se puede Invocar de forma Normal.');
    if (isSet && /cannot be Normal Set/i.test(desc)) err(v, q(c.name) + ' no se puede Colocar.');
    // Sacrificios
    let need = c.lv <= 4 ? 0 : c.lv <= 6 ? 1 : 2;
    const reqN = desc.match(/Requires (\d+) Tributes? to Normal Summon/i);
    if (reqN) need = +reqN[1];
    for (const x of xs) if (!onField(x)) err(v, q(x.c.name) + ' no está en tu campo: solo puedes sacrificar monstruos que controlas.');
    const flexible = /without Tributing|Tribute Summon this card by Tributing|Normal Summon this card by Tributing|by Tributing|for 1 less Tribute|Tributes? to Tribute Summon|Tribute Summon this card/i.test(desc)
      || xs.some((x) => /2 Tributes|as 2 Tributes|treated as 2/i.test(x.c.desc || ''))
      || fieldCards(S).some((fc) => /Normal Summon [^.]*without Tributing|for 1 less Tribute|Tribute Summon [^.]*by Tributing 1\b/i.test(fc.desc || ''));
    if (xs.length !== need) {
      const m = q(c.name) + (reqN ? '' : ' es Nivel ' + c.lv + ':') + ' necesita ' + need + ' sacrificio' + (need === 1 ? '' : 's') + ' y elegiste ' + xs.length + '.';
      if (flexible) warn(v, m + ' Solo vale si su texto (o el de otra carta) lo permite.');
      else err(v, m);
    }
    const pos = req.position;
    if (!isSet && pos && pos !== 'atk') err(v, 'La Invocación Normal es en Ataque boca arriba (para Defensa, Colócalo boca abajo).');
    if (isSet && pos && pos !== 'set' && pos !== 'def') err(v, 'La Colocación es boca abajo en Defensa.');
  }

  function synchroChecks(v, c, xs) {
    const mat = parseMaterials(c);
    const special = xs.some((x) => specialMat('Synchro', x));
    for (const x of xs) if (!hasLevel(x.c)) err(v, q(x.c.name) + ' no tiene Nivel (Xyz y Link no tienen): no puede ser material de Sincronía.');
    const withLv = xs.filter((x) => hasLevel(x.c));
    const sum = withLv.reduce((a, x) => a + levelOf(x.c, x.inst), 0);
    if (withLv.length === xs.length && sum !== c.lv) {
      const m = 'Los Niveles suman ' + sum + ' y ' + q(c.name) + ' es Nivel ' + c.lv + '.';
      if (special) warn(v, m + ' Solo vale si un efecto cambia el Nivel.');
      else err(v, m + ' (Si un efecto cambió un Nivel, anótalo con «Cambiar Nivel…» en la carta.)');
    }
    if (!mat.understood) {
      // Regla base: exactamente 1 Cantante y al menos 1 que no lo sea
      warn(v, 'No pude verificar los materiales de ' + q(c.name) + ': ' + (mat.text || 'sin texto') + '.');
      const tuners = xs.filter((x) => x.c.type & T.TUNER).length;
      if (tuners < 1) err(v, 'La Sincronía necesita un Cantante.');
      if (xs.length - tuners < 1) err(v, 'La Sincronía necesita al menos un monstruo que no sea Cantante.');
      return;
    }
    matchParts(v, xs, mat, c, special);
  }

  function xyzChecks(v, c, xs, req) {
    const mat = parseMaterials(c);
    // Su otra forma ("by using "Cyber Dragon Nova" you control as material"): 1 material que cumple, sin mirar Niveles
    if (mat.altDesc && xs.length === 1 && fits(mat.altDesc, xs[0])) {
      warn(v, 'Invocación Xyz de ' + q(c.name) + ' con su otra forma (sobre ' + q(xs[0].c.name) + '): revisa las demás condiciones de su texto.');
      return;
    }
    const soft = !!req.source || mat.alt || xs.some((x) => specialMat('Xyz', x));
    if (mat.understood && mat.parts.some((p) => p.desc.level)) {
      const before = v.errors.length;
      for (const x of xs) if (!hasLevel(x.c)) (soft ? warn : err)(v, q(x.c.name) + ' no tiene Nivel (Xyz y Link no tienen): no sirve para ' + q(c.name) + '.');
      for (const x of xs) {
        if (hasLevel(x.c) && levelOf(x.c, x.inst) !== c.lv && !mat.parts.some((p) => p.desc.level === levelOf(x.c, x.inst))) {
          (soft ? warn : err)(v, q(x.c.name) + ' es Nivel ' + levelOf(x.c, x.inst) + '; ' + q(c.name) + ' es Rango ' + c.lv + '.');
        }
      }
      if (v.errors.length === before) matchParts(v, xs, mat, c, soft);
      if (soft && mat.alt) warn(v, q(c.name) + ' tiene otra forma de Invocación Xyz; revisa que la cumplas.');
      return;
    }
    if (mat.understood) { matchParts(v, xs, mat, c, soft); return; }
    warn(v, 'No pude verificar los materiales de ' + q(c.name) + ': ' + (mat.text || 'sin texto') + '.');
    for (const x of xs) if (!hasLevel(x.c) || levelOf(x.c, x.inst) !== c.lv) warn(v, q(x.c.name) + ' no es Nivel ' + c.lv + '.');
    if (xs.length < 2) warn(v, 'Normalmente una Invocación Xyz usa 2 o más materiales.');
  }

  function linkChecks(v, c, xs) {
    const mat = parseMaterials(c);
    const rating = c.lv;
    const soft = xs.some((x) => specialMat('Link', x));
    const fail = soft ? warn : err;
    if (xs.length > rating) fail(v, 'Un Link-' + rating + ' usa como máximo ' + rating + ' materiales.');
    // Cada material vale 1, o su valor Link si es un monstruo Link
    let sums = new Set([0]);
    for (const x of xs) {
      const next = new Set();
      for (const s of sums) { next.add(s + 1); if (x.c.isLink) next.add(s + x.c.lv); }
      sums = next;
    }
    if (!sums.has(rating)) fail(v, 'Los materiales no suman LINK-' + rating + ' (cada uno vale 1, o su valor Link si es un monstruo Link).');
    matchParts(v, xs, mat, c, soft);
  }

  function fusionChecks(v, c, xs) {
    const mat = parseMaterials(c);
    if (!mat.understood) { warn(v, 'No pude verificar los materiales de ' + q(c.name) + ': ' + (mat.text || 'sin texto') + '.'); return; }
    if (solve(xs, mat.parts)) return;
    // Sustitutos de material ("can be used as a substitute for any 1 Fusion Material whose name is specifically listed")
    const subs = xs.filter((x) => /substitute for any 1 Fusion Material/i.test(x.c.desc || ''));
    if (subs.length) {
      const relaxed = mat.parts.map((p) => (p.desc.named ? Object.assign({}, p, { desc: { tests: [(x) => fits(p.desc, x) || subs.includes(x)] } }) : p));
      if (solve(xs, relaxed)) { warn(v, 'Usaste un sustituto de material de Fusión; revisa que el resto sea correcto.'); return; }
    }
    matchParts(v, xs, mat, c, false);
  }

  function ritualChecks(S, req, v, t, c, loc, xs) {
    if (!(c.type & T.RITUAL)) { err(v, q(c.name) + ' no es un monstruo de Ritual.'); return; }
    if (loc.area !== 'hand') warn(v, 'Normalmente el monstruo de Ritual se invoca desde la mano.');
    if (!xs.length) { (req.source ? warn : err)(v, 'Elige los monstruos que vas a liberar.'); return; }
    for (const x of xs) {
      if (!db.isMonster(x.c)) err(v, q(x.c.name) + ' no es un monstruo.');
      else if (!(x.loc.area === 'hand' || onField(x))) matPlace(v, S, req, x, 'liberar');
      if (db.isMonster(x.c) && !hasLevel(x.c)) warn(v, q(x.c.name) + ' no tiene Nivel: no suma para el Ritual.');
    }
    const sum = xs.filter((x) => hasLevel(x.c)).reduce((a, x) => a + levelOf(x.c, x.inst), 0);
    const mat = parseMaterials(c);
    const src = sourceCard(S, req);
    const srcText = src ? sourceText(S, req, src) : '';
    // "this card can be used as the entire Tribute / Level requirement" (Lo, Shurit, Ritual Raven...)
    if (xs.length === 1 && /entire (?:Tribute|Level requirement|requirement)/i.test(xs[0].c.desc || '')) {
      warn(v, q(xs[0].c.name) + ' cuenta como todo el requisito solo si se cumple su texto (1 monstruo de Ritual, con un efecto).');
      return;
    }
    // Ritual por ATK (Meteonis Drytron): el ATK total debe igualar o superar el ATK del monstruo de Ritual
    if (mat.spellAtk || RITUAL_ATK.test(srcText)) {
      const atk = xs.reduce((a, x) => a + Math.max(0, Number(x.c.atk) || 0), 0);
      if (atk < c.atk) err(v, 'El ATK liberado suma ' + atk + '; ' + q(c.name) + ' necesita ' + c.atk + ' o más.');
      return;
    }
    // Si la fuente es una carta cuyo texto no habla de Niveles, la suma no se puede asegurar: solo aviso
    const byLevel = !req.source || (src ? /\bLevels?\b/i.test(srcText) : false);
    if (sum < c.lv) (byLevel ? err : warn)(v, 'Los Niveles liberados suman ' + sum + '; ' + q(c.name) + ' necesita ' + c.lv + ' o más'
      + (byLevel ? '.' : ' (salvo que el efecto use otra cuenta).'));
    else if (mat.exact && sum !== c.lv) warn(v, q(mat.spell) + ' pide que los Niveles sumen exactamente ' + c.lv + '.');
  }

  function specialChecks(S, req, v, t, c, loc, xs, a, reqText) {
    const desc = c.desc || '';
    const proc = a.effects.find((e) => e.kind === 'summon' && (req.effectIndex == null || e.index === Number(req.effectIndex)));
    const own = !!(req.ownProcedure || (req.effectIndex != null && proc));
    if (/(?:^|\. |\n)(?:This card )?cannot be Special Summoned\./i.test(desc)) err(v, q(c.name) + ' no se puede Invocar de forma Especial.');
    else if (/cannot be Special Summoned,? except/i.test(reqText) && !own) warn(v, q(c.name) + ' solo se invoca de forma especial de la manera que dice su texto.');
    const src = sourceCard(S, req);
    const srcText = src ? sourceText(S, req, src) : '';
    const ignores = /ignoring (?:its|their) Summoning conditions/i.test(srcText);
    // "Must be Special Summoned ..." (sin "first"): solo se invoca así; nunca se revive ni la invoca otro efecto
    const nomi = reqText.match(/(?:^|\. )Must be Special Summoned\b([^.]*)/i);
    if (nomi && !own && !ignores) {
      const names = (nomi[1].match(/"[^"]+"/g) || []).map((n) => n.slice(1, -1));
      const anyEffect = /by (?:a )?card effects?\b|by an effect\b/i.test(nomi[1]);
      const allowed = anyEffect || (src && names.some((n) => isNamed(src, n) || isArch(src, n)));
      if (!allowed) {
        if (src) err(v, q(c.name) + ' solo se puede Invocar de forma Especial como dice su texto: no se puede revivir ni invocar con el efecto de ' + q(src.name) + '.');
        else warn(v, q(c.name) + ' solo se puede Invocar de forma Especial como dice su texto: revisa que ese efecto lo permita.');
      }
    } else if (/Cannot be Normal Summoned/i.test(reqText) && /Must first be Special Summoned/i.test(reqText) && !own && !ignores && !properOf(loc.inst)) {
      warn(v, q(c.name) + ' debe invocarse primero con su propio procedimiento (luego sí se puede revivir).');
    }
    if (src && !/\bSummon/i.test(srcText)) warn(v, 'El efecto de ' + q(src.name) + ' no parece invocar monstruos: revisa que sea el correcto.');
    if (own) {
      const pr = procedureOf(c);
      if (!pr) warn(v, q(c.name) + ' no tiene una forma propia de Invocación Especial.');
      else {
        openMain(v, S, t, 'usar la Invocación Especial propia de ' + q(c.name));
        if (pr.from.length && !pr.from.includes(loc.area)) err(v, 'Esta forma de invocarse es desde ' + pr.from.map((w) => AREA_NAMES[w]).join(' o ') + '.');
        if (pr.center && req.zone && req.zone !== 'mz2') err(v, 'Esta forma de invocarse es solo a tu Zona de Monstruo central.');
        if (pr.costs && !xs.length) warn(v, 'Su procedimiento pide cartas: elígelas para que queden anotadas.');
      }
    }
    if (db.isExtra(c)) {
      const proper = c.type & T.SYNCHRO ? 'synchro' : c.type & T.XYZ ? 'xyz' : c.type & T.LINK ? 'link' : 'fusion';
      if (loc.area === 'extra' && !own && !faceUpInExtra(c, loc.inst) && !/Must (?:first )?be Special Summoned (?:with|by|from|\()/i.test(reqText)) {
        // "(this is treated as a Synchro Summon)": el modo Automático lo manda como 'special' con treatedAs
        if (!req.treatedAs) warn(v, 'Desde el Extra Deck se invoca con su procedimiento (' + METHOD_LABELS[proper] + '); usa ese tipo si el efecto lo trata así.');
      } else if ((loc.area === 'gy' || loc.area === 'ban') && !ignores) {
        const m = properOf(loc.inst);
        if (!m) warn(v, 'Un monstruo del Extra Deck solo se revive si antes se invocó correctamente (' + METHOD_LABELS[proper] + ').');
        else if (m !== proper && m !== 'pendulum' && m !== 'special') warn(v, q(c.name) + ' no se invocó correctamente antes: no se puede revivir (salvo que el efecto ignore sus condiciones).');
      }
      if (own && xs.length && parseMaterials(c).understood) matchParts(v, xs, parseMaterials(c), c, true);
    } else if (c.type & T.RITUAL) {
      if (loc.area === 'hand' || loc.area === 'deck') warn(v, 'Los monstruos de Ritual se invocan por Ritual (salvo que el efecto ignore sus condiciones de invocación).');
      else if ((loc.area === 'gy' || loc.area === 'ban') && !ignores && properOf(loc.inst) !== 'ritual') warn(v, 'Un monstruo de Ritual solo se revive si antes se invocó por Ritual.');
    }
    if (!desc && !reqText) warn(v, 'Carta sin texto: no puedo revisar sus condiciones.');
  }

  function pendulumChecks(S, req, v, t) {
    const uids = Array.isArray(req.uids) && req.uids.length ? req.uids : [req.uid];
    const zones = Array.isArray(req.zones) ? req.zones : [req.zone];
    sourceOrMain(v, S, req, t, 'pendulum', true);
    if (t.pendulumSummons >= 1) {
      if (req.additional) warn(v, 'Invocación por Péndulo adicional: solo si un efecto te la da.');
      else err(v, 'Ya hiciste tu Invocación por Péndulo de este turno.');
    }
    const L = topOf(S, 'st0'), R = topOf(S, 'st4');
    const cl = L && db.get(L.id), cr = R && db.get(R.id);
    const isScale = (inst, c) => inst && c && !inst.faceDown && c.type & T.PENDULUM && db.isMonster(c);
    if (!isScale(L, cl) || !isScale(R, cr)) { err(v, 'Necesitas dos Escalas de Péndulo (en las zonas de los extremos).'); return; }
    const low = Math.min(cl.scaleL, cr.scaleR), high = Math.max(cl.scaleL, cr.scaleR);
    if (high - low < 2) err(v, 'Con Escalas ' + low + ' y ' + high + ' no se puede invocar ningún Nivel.');
    const taken = [];
    let emzUsed = false;
    uids.forEach((uid, i) => {
      const loc = locate(S, uid);
      const c = loc && db.get(loc.inst.id);
      if (!c) { err(v, 'No encuentro esa carta.'); return; }
      v.from[uid] = loc.area;
      if (!db.isMonster(c)) { err(v, q(c.name) + ' no es un monstruo.'); return; }
      // Un Xyz de Péndulo no tiene Nivel, pero su texto puede dejar invocarlo boca arriba desde el Extra Deck
      // ("If you can Pendulum Summon Level 7, you can Pendulum Summon this face-up card in your Extra Deck")
      const clause = !hasLevel(c) && loc.area === 'extra' && faceUpInExtra(c, loc.inst) ? PEND_FACEUP_LEVEL.exec(c.desc || '') : null;
      const lv = hasLevel(c) ? levelOf(c, loc.inst) : clause ? Number(clause[1]) : null;
      if (lv == null) err(v, q(c.name) + ' no tiene Nivel: no se puede Invocar por Péndulo.');
      else if (!(lv > low && lv < high)) {
        err(v, q(c.name) + (clause ? ' pide poder Invocar por Péndulo Nivel ' + lv : ' es Nivel ' + lv)
          + '; con Escalas ' + low + ' y ' + high + ' solo puedes invocar Niveles ' + (low + 1) + ' a ' + (high - 1) + '.');
      }
      if (loc.area === 'extra') {
        if (!faceUpInExtra(c, loc.inst)) err(v, 'Desde el Extra Deck solo puedes invocar monstruos de Péndulo boca arriba.');
      } else if (loc.area !== 'hand') err(v, 'La Invocación por Péndulo es desde la mano o desde el Extra Deck (boca arriba).');
      const reqText = analyze(c).reqs.join(' ');
      if (/(?:^|\. )Cannot be Special Summoned\./.test(reqText)) err(v, q(c.name) + ' no se puede Invocar de forma Especial.');
      else if (/Must (?:first )?be (?:Special|Fusion|Synchro|Xyz|Link|Ritual) Summoned/i.test(reqText) && !properOf(loc.inst)) warn(v, q(c.name) + ' debe invocarse primero de la forma que dice su texto.');
      if (c.type & T.RITUAL && loc.area === 'hand') warn(v, 'Los monstruos de Ritual no se pueden Invocar por Péndulo desde la mano.');
      const zone = zones[i];
      const opts = { from: loc.area, taken };
      if (zone) {
        placementChecks(S, uid, zone, opts, v);
        if (EMZ.includes(zone)) { if (emzUsed) err(v, 'Solo puedes usar una Zona de Monstruo Extra a la vez.'); emzUsed = true; }
        taken.push(zone);
      } else if (!legalZones(S, uid, opts).length) err(v, 'No hay una zona válida libre para ' + q(c.name) + '.');
      specialLimits(S, { method: 'pendulum', uid }, v, t, c, analyze(c), loc.area === 'extra', 'pendulum');
    });
  }

  /** Bloqueos de invocación activos y "solo puedes invocar X una vez por turno". */
  function specialLimits(S, req, v, t, c, a, fromExtra, method) {
    // Los bloqueos con kind (p. ej. 'noDeckAdd' de Droll) no son de invocación
    const locks = t.locks.filter((l) => l && !l.kind).map((l) => ({ lock: l, source: l.source }));
    for (const z of [...MON_ZONES, ...ST, 'fz']) {
      const inst = topOf(S, z);
      if (!inst || inst.faceDown || inst.uid === req.uid) continue;
      const fc = db.get(inst.id);
      if (!fc) continue;
      // Un Efecto de Péndulo solo vale en la Zona de Péndulo; un efecto de monstruo, en una Zona de Monstruo
      const scale = (z === 'st0' || z === 'st4') && db.isMonster(fc);
      for (const l of analyze(fc).fieldLocks) {
        if (l.section === 'pendulum' && !scale) continue;
        if (l.section === 'monster' && !MON_ZONES.includes(z)) continue;
        locks.push({ lock: l, source: fc.name });
      }
    }
    for (const { lock, source } of locks) {
      const r = lockVerdict(lock, c, fromExtra);
      if (r === 'bad') {
        err(v, 'Por ' + q(source) + ', no puedes Invocar de forma Especial ' + (lock.extra ? 'desde el Extra Deck ' : '')
          + (lock.allow ? 'monstruos que no sean: ' + parseDesc(lock.allow).labels.join(' ') : 'este turno') + '.');
      } else if (r === 'unknown') warn(v, 'Revisa la restricción de ' + q(source) + ': ' + lock.text + '.');
    }
    const own = !!(req.ownProcedure || (req.effectIndex != null));
    for (const o of a.summonOpts) {
      if (o.method && o.method !== method) continue;
      if (o.thisWay && !own) continue;
      const used = (o.duel ? t.duel : t.opt)[o.key] || 0;
      if (used >= o.limit) err(v, 'Ya invocaste ' + q(c.name) + (o.thisWay ? ' de esta forma' : '') + (o.duel ? ' en este Duelo.' : ' este turno.'));
    }
  }

  /* ---------- Activación de cartas y efectos ---------- */
  function checkActivation(S, req) {
    const v = verdict();
    try { activationChecks(S, req || {}, v); } catch (e) { warn(v, 'No pude revisar esta activación por completo.'); }
    return done(v);
  }
  function activationChecks(S, req, v) {
    const t = tsOf(S);
    const loc = locate(S, req.uid);
    const c = loc && db.get(loc.inst.id);
    if (!c) { err(v, 'No encuentro esa carta.'); return; }
    const effs = effectsOf(c);
    const cl = req.chainLength != null ? Number(req.chainLength) : chainLen(S);
    const idx = req.effectIndex != null ? Number(req.effectIndex) : (effs[0] ? effs[0].index : 1);
    if (idx === 0 && db.isMonster(c)) { scaleChecks(S, req, v, t, c, loc, cl); return; }
    const e = effs.find((x) => x.index === idx);
    if (!e) { err(v, 'Esa carta no tiene ese efecto.'); return; }
    if (e.kind === 'continuous') { err(v, 'Es un efecto continuo: no se activa.'); return; }
    if (e.kind === 'summon') { err(v, 'Es su forma de Invocación Especial: decláralo como invocación, no como efecto.'); return; }
    if (e.unsure) warn(v, 'Texto antiguo: no estoy seguro de si este efecto se activa.');

    // Cadena y velocidad de hechizo
    const prev = cl > 0 && Array.isArray(S.chain) ? S.chain[cl - 1] : null;
    if (cl > 0) {
      const ps = prev ? Number(prev.speed) || linkSpeed(prev) : null;
      if (e.speed === 1) {
        if (e.kind === 'trigger') warn(v, 'Un efecto de activación de velocidad 1 solo entra en la cadena si se activó a la vez que los anteriores.');
        else err(v, 'Un efecto de velocidad 1 solo puede ser el Eslabón 1: no se puede encadenar.');
      } else if (ps && e.speed < ps) {
        err(v, ps === 3 ? 'A un efecto de velocidad 3 solo responde otro de velocidad 3 (Trampa de Contraefecto).' : 'Un efecto de velocidad ' + e.speed + ' no puede responder a uno de velocidad ' + ps + '.');
      }
      if (e.oncePerChain && S.chain.some((l) => l && l.uid === req.uid && Number(l.effectIndex) === e.index)) err(v, 'Este efecto solo se activa una vez por cadena.');
    }

    if (e.kind === 'activation') cardActivation(S, req, v, t, c, loc, e);
    else effectUse(S, req, v, t, c, loc, e);

    // Fase o turno escrito en la condición ("During your opponent's turn")
    const need = phaseNeed(e.condition);
    if (need && !need.some((n) => phaseOk(n, t))) err(v, 'Este efecto solo se usa ' + need.map(phaseText).join(' o ') + '.');

    // Una vez por turno
    for (const o of e.opts) {
      const key = o.perCopy ? o.key.replace('copy:', 'copy:' + req.uid) : o.key;
      const used = (o.duel ? t.duel : t.opt)[key] || 0;
      if (used >= o.limit) {
        if (o.act) err(v, 'Ya activaste ' + q(c.name) + ' este turno (' + o.label + ').');
        else err(v, (o.duel ? 'Ya usaste este efecto en este Duelo' : 'Ya usaste este efecto este turno') + ' (' + o.label + ').');
      }
    }

    // Bloqueos "el turno en que activas esto": mira lo que ya invocaste
    for (const lock of e.locks.filter((l) => l.timing === 'turn')) {
      for (const sp of t.specials) {
        const r = lockVerdict(lock, db.get(sp.id), !!sp.extra);
        const sc = db.get(sp.id);
        if (r === 'bad') err(v, 'Este turno ya invocaste ' + q(sc ? sc.name : sp.id) + '; ' + q(c.name) + ' no permite eso el turno en que lo activas.');
        else if (r === 'unknown') warn(v, 'Revisa la restricción: ' + lock.text + '.');
      }
    }
    // "You can only activate 1 other "Mulcharmy" monster effect, the turn you activate this effect"
    if (db.isMonster(c) && idx > 0) archLimits(v, t, c, e);
    // Angelechy Shatranga en el campo del rival: "your opponent can only attempt to activate up to 5 monster effects per turn"
    if (db.isMonster(c) && idx > 0 && !e.pendulum) {
      const n = monsterActs(t);
      for (const l of liveLocks(S, 'monsterEffectCap')) {
        const max = Number(l.max) > 0 ? Number(l.max) : 5;
        if (n >= max) { err(v, 'Por ' + q(l.source || 'Angelechy Shatranga') + ', solo puedes intentar activar ' + max + ' efectos de monstruo por turno (ya van ' + n + ').'); break; }
      }
    }
    // Bloqueos activos que impiden activar (p. ej. "you cannot activate")
    // Artifact Lancea: nadie puede desterrar este turno (un costo que destierra no se paga; lo que destierra al resolverse no pasa)
    const nb = noBanishLock(t);
    if (nb) {
      let res = String(e.text || '');
      if (e.condition) res = res.replace(e.condition, '');
      if (e.cost) res = res.replace(e.cost, '');
      if (e.cost && BANISH_VERB.test(e.cost)) err(v, noBanishText(nb) + ' No puedes pagar el costo de este efecto (destierra).');
      else if (BANISH_VERB.test(res)) warn(v, noBanishText(nb) + ' Lo que este efecto destierre no se destierra.');
    }
  }
  /** Límites por arquetipo del turno (Mulcharmy): cuenta los efectos de monstruo del arquetipo ya activados. */
  function archLimits(v, t, c, e) {
    const acts = t.acts.filter((a) => a && a.monster);
    const own = analyze(c).archOnly;
    if (own && own.index === e.index) {
      const n = acts.filter((a) => isArch(db.get(a.id), own.arch)).length;
      if (n > own.others) err(v, 'Este turno ya activaste ' + n + ' efectos de monstruos ' + q(own.arch) + ': este efecto solo permite ' + own.others + ' más.');
    }
    for (const a of acts) {
      const ac = db.get(a.id);
      const lim = ac && analyze(ac).archOnly;
      if (!lim || lim.index !== Number(a.effectIndex) || !isArch(c, lim.arch)) continue;
      const n = acts.filter((x) => isArch(db.get(x.id), lim.arch)).length;
      if (n >= lim.others + 1) { err(v, 'Por ' + q(ac.name) + ', este turno solo puedes activar ' + lim.others + ' efecto más de monstruos ' + q(lim.arch) + '.'); break; }
    }
  }
  function linkSpeed(link) {
    const c = db.get(link.id);
    const e = c && effectsOf(c).find((x) => x.index === Number(link.effectIndex));
    return e ? e.speed : null;
  }
  const setThisTurn = (inst, t) => inst && inst.setTurn != null && Number(inst.setTurn) === t.turn;
  /** Una carta boca arriba (Rescue-ACE Hydrant...) o un efecto activado este turno ("It can be activated this turn")
   * permite activar una Mágica Rápida/Trampa el turno en que se Colocó. Devuelve el nombre de esa carta o null. */
  function setTurnGrant(S, t) {
    const fc = fieldCards(S).find((x) => /activate[^.]*the turn (?:it was|they were|it is|they are) Set/i.test(x.desc || ''));
    if (fc) return fc.name;
    const a = t.acts.find((x) => /can be activated (?:the turn it was Set|this turn)|activate (?:it|that card|them|those cards) (?:the turn it was Set|this turn)/i.test(actText(x)));
    const ac = a && db.get(a.id);
    return ac ? ac.name : null;
  }

  function cardActivation(S, req, v, t, c, loc, e) {
    const desc = c.desc || '';
    const area = loc.area;
    const set = area === 'field' && !!loc.inst.faceDown;
    if (area === 'field' && !set) err(v, 'La carta ya está boca arriba: su activación ya se hizo.');
    else if (area === 'material') err(v, 'Esa carta está como material Xyz.');
    else if (area !== 'hand' && area !== 'field') {
      if (/activate (?:this card|it) from (?:your )?(?:GY|Graveyard|Deck)/i.test(desc)) warn(v, 'Solo si su texto permite activarla desde ' + AREA_NAMES[area] + '.');
      else err(v, 'Las Mágicas y Trampas se activan desde la mano o Colocadas en el campo.');
    }
    if (db.isSpell(c)) {
      if (c.type & T.QUICKPLAY) {
        if (area === 'hand' && !t.mine) err(v, 'Desde la mano, una Mágica Rápida solo se activa en tu turno.');
        if (set && setThisTurn(loc.inst, t)) {
          const by = setTurnGrant(S, t);
          if (by) warn(v, 'El turno en que la Colocaste solo si se cumple lo que dice ' + q(by) + ' (p. ej., que la Colocó ese efecto).');
          else err(v, 'No puedes activar una Mágica Rápida el turno en que la Colocaste.');
        }
      } else if (!t.mine) err(v, 'Esta Mágica solo se activa en tu turno.');
      else if (!isMain(t)) err(v, 'Esta Mágica solo se activa en tu Fase Principal.');
    } else if (db.isTrap(c)) {
      if (area === 'hand') {
        if (/activate this card from your hand/i.test(desc)) warn(v, 'Desde la mano solo si cumples la condición de su texto.');
        else err(v, 'Las Trampas se Colocan primero; no se activan desde la mano.');
      }
      if (set && setThisTurn(loc.inst, t)) {
        const by = setTurnGrant(S, t);
        if (/the turn it was Set|activate this card the turn/i.test(desc)) warn(v, 'El turno en que la Colocaste solo si cumples la condición de su texto.');
        else if (by) warn(v, 'El turno en que la Colocaste solo si se cumple lo que dice ' + q(by) + ' (p. ej., que la Colocó ese efecto).');
        else err(v, 'No puedes activar una Trampa el turno en que la Colocaste.');
      }
    }
    // "You can only control 1 "X"": no se activa si ya hay otra boca arriba
    const one = analyze(c).controlOne;
    if (one && (area === 'hand' || set) && controlsOther(S, req.uid, one.name)) err(v, 'Solo puedes controlar 1 ' + q(one.name) + ' boca arriba.');
    if (area === 'hand') {
      const zone = req.zone;
      if (c.type & T.FIELD) {
        if (zone && zone !== 'fz') err(v, 'Las Mágicas de Campo se activan en la Zona de Campo.');
        if (topOf(S, 'fz')) warn(v, 'Tu Mágica de Campo anterior se manda al Cementerio.');
      } else if (zone) {
        if (!ST.includes(zone)) err(v, 'Elige una Zona de Mágicas y Trampas.');
        else if (topOf(S, zone)) err(v, 'Esa zona ya está ocupada.');
      } else if (!ST.some((z) => !topOf(S, z))) err(v, 'No quedan Zonas de Mágicas y Trampas libres.');
    }
  }

  function effectUse(S, req, v, t, c, loc, e) {
    const place = placeOf(loc, c);
    if (e.kind === 'ignition') {
      if (!t.mine) err(v, 'Es un efecto de Ignición: solo en tu turno.');
      else if (!isMain(t)) err(v, 'Es un efecto de Ignición: solo en tu Fase Principal.');
    }
    if (e.pendulum) {
      if (place !== 'pendulum') err(v, 'Los Efectos de Péndulo solo se usan con la carta en la Zona de Péndulo.');
      return;
    }
    if (place === 'pendulum') { err(v, 'En la Zona de Péndulo solo se usan sus Efectos de Péndulo.'); return; }
    const where = e.where || ['field'];
    if (place === 'field' && loc.inst.faceDown && where.includes('field')) {
      if (db.isMonster(c)) err(v, 'Un monstruo boca abajo no puede activar sus efectos.');
      else if (e.kind === 'trigger') warn(v, 'La carta está boca abajo; revisa que el efecto se pueda usar así.');
      else err(v, 'La carta está boca abajo: primero actívala.');
      return;
    }
    // Monstruo con los efectos negados este turno (Effect Veiler, Infinite Impermanence del rival)
    const neg = negatedNow(loc.inst, t);
    if (place === 'field' && MON_ZONES.includes(loc.zone) && db.isMonster(c) && neg) {
      err(v, 'Los efectos de ' + q(c.name) + ' están negados este turno' + (neg.by ? ' (por ' + q(neg.by) + ')' : '') + '.');
    }
    if (place && !where.includes(place)) {
      warn(v, 'Este efecto se usa con la carta en ' + where.map((w) => AREA_NAMES[w] || w).join(' o ') + ', y está en ' + (AREA_NAMES[place] || place) + '.');
    }
  }

  function scaleChecks(S, req, v, t, c, loc, cl) {
    if (!(c.type & T.PENDULUM)) { err(v, 'Esa carta no tiene ese efecto.'); return; }
    if (loc.area !== 'hand') warn(v, 'Normalmente la Escala de Péndulo se activa desde la mano.');
    if (!t.mine) err(v, 'Las Escalas de Péndulo solo se activan en tu turno.');
    else if (!isMain(t)) err(v, 'Las Escalas de Péndulo solo se activan en tu Fase Principal.');
    if (cl > 0) err(v, 'Solo puedes activar una Escala con la cadena vacía.');
    if (req.zone) {
      if (req.zone !== 'st0' && req.zone !== 'st4') err(v, 'Las Escalas de Péndulo van en las zonas de los extremos.');
      else if (topOf(S, req.zone)) err(v, 'Esa Zona de Péndulo ya está ocupada.');
    } else if (topOf(S, 'st0') && topOf(S, 'st4')) err(v, 'Las Zonas de Péndulo (extremos) están ocupadas.');
  }

  /** "During your opponent's turn (Quick Effect)" → [{ who: 'opp', what: 'turn' }]; null si no hay restricción clara. */
  function phaseNeed(cond) {
    if (!cond) return null;
    const k = cond.replace(/^Once per (?:turn|Chain|Duel),?\s*/i, '');
    const m = k.match(/^During ([^:,(]+)/i);
    if (!m) return null;
    const PH = /^(your opponent's|your|the|either player's|each player's|each|this) (Main Phase 1|Main Phase 2|Main Phase|Battle Phase|End Phase|Standby Phase|Draw Phase|Damage Step|turn)$/i;
    let owner = null;
    const alts = m[1].trim().split(/ or /i).map((a) => {
      // "your opponent's Main Phase or Battle Phase": la segunda parte hereda el dueño de la primera
      let r = a.trim().match(PH);
      if (!r && owner) r = (owner + ' ' + a.trim()).match(PH);
      if (!r) return null;
      owner = r[1];
      const who = /opponent/i.test(r[1]) ? 'opp' : /^your$/i.test(r[1]) ? 'me' : 'any';
      return { who, what: r[2].toLowerCase() };
    });
    return alts.every(Boolean) ? alts : null;
  }
  function phaseOk(n, t) {
    if (n.who === 'me' && !t.mine) return false;
    if (n.who === 'opp' && t.mine) return false;
    switch (n.what) {
      case 'turn': return true;
      case 'main phase': return isMain(t);
      case 'main phase 1': return t.phase === 'main1';
      case 'main phase 2': return t.phase === 'main2';
      case 'battle phase': case 'damage step': return t.phase === 'battle';
      case 'end phase': return t.phase === 'end';
      case 'standby phase': return t.phase === 'standby';
      case 'draw phase': return t.phase === 'draw';
      default: return true;
    }
  }
  function phaseText(n) {
    const what = { turn: 'turno', 'main phase': 'Fase Principal', 'main phase 1': 'Fase Principal 1', 'main phase 2': 'Fase Principal 2', 'battle phase': 'Fase de Batalla', 'damage step': 'Paso de Daño', 'end phase': 'Fase Final', 'standby phase': 'Fase de Standby', 'draw phase': 'Fase de Robo' }[n.what] || n.what;
    if (n.who === 'me') return 'durante tu ' + what;
    if (n.who === 'opp') return 'durante ' + (n.what === 'turn' ? 'el turno' : 'la ' + what) + ' del adversario';
    return 'durante ' + (n.what === 'turn' ? 'cualquier turno' : 'la ' + what);
  }

  /* ---------- Posición y Colocar ---------- */
  function checkPosition(S, uid, opts) {
    const v = verdict();
    try {
      const t = tsOf(S);
      const loc = locate(S, uid);
      const c = loc && db.get(loc.inst.id);
      if (!c) { err(v, 'No encuentro esa carta.'); return done(v); }
      if (loc.area !== 'field' || !MON_ZONES.includes(loc.zone)) { err(v, 'Solo puedes cambiar la posición de un monstruo en tu campo.'); return done(v); }
      const inst = loc.inst;
      if (opts && opts.to === 'set') { warn(v, 'Solo un efecto puede poner un monstruo boca abajo.'); return done(v); }
      if (!t.mine) err(v, 'Solo puedes cambiar posiciones en tu turno.');
      else if (!isMain(t)) err(v, 'Solo puedes cambiar posiciones en tu Fase Principal.');
      if (chainLen(S)) err(v, 'Solo con la cadena vacía.');
      if (c.isLink) err(v, 'Los monstruos Link no pueden cambiar a Defensa.');
      if (inst.faceDown) {
        const setNow = setThisTurn(inst, t) || ((inst.summonMethod === 'set' || inst.summonMethod === 'tributeSet') && Number(inst.summonedTurn) === t.turn);
        if (setNow) err(v, 'No puedes Invocar por Volteo el turno en que lo Colocaste.');
      } else if (inst.summonedTurn != null && Number(inst.summonedTurn) === t.turn) err(v, 'No puedes cambiar la posición el turno en que se invocó.');
      if (inst.positionChangedTurn != null && Number(inst.positionChangedTurn) === t.turn) err(v, 'Ya cambió de posición este turno.');
    } catch (e) { warn(v, 'No pude revisar el cambio de posición.'); }
    return done(v);
  }
  /** Colocar una Mágica o Trampa boca abajo. */
  function checkSet(S, uid, zone, opts) {
    const v = verdict();
    try {
      const t = tsOf(S);
      const loc = locate(S, uid);
      const c = loc && db.get(loc.inst.id);
      if (!c) { err(v, 'No encuentro esa carta.'); return done(v); }
      openMain(v, S, t, 'Colocar cartas');
      if (db.isMonster(c)) warn(v, 'Los monstruos se Colocan con la Colocación Normal (en Zona de Monstruo).');
      if (loc.area !== 'hand') warn(v, 'Normalmente se Coloca desde la mano.');
      if (zone) {
        placementChecks(S, uid, zone, Object.assign({ faceDown: true }, opts), v);
        if (zone === 'fz' && topOf(S, 'fz') && c.type & T.FIELD) warn(v, 'Tu Mágica de Campo anterior se manda al Cementerio.');
      } else if (!(c.type & T.FIELD) && !ST.some((z) => !topOf(S, z))) err(v, 'No quedan Zonas de Mágicas y Trampas libres.');
    } catch (e) { warn(v, 'No pude revisar esta Colocación.'); }
    return done(v);
  }

  /* ---------- Registrar jugadas (no mueven cartas) ---------- */
  function entry(S, kind, text, v, extra) {
    const t = tsOf(S);
    return Object.assign({
      turn: t.turn, phase: t.phase, mine: t.mine, kind, text,
      illegal: !!(v && v.errors && v.errors.length), reasons: v && v.errors ? v.errors.slice() : [], warnings: v && v.warnings ? v.warnings.slice() : [],
    }, extra || {});
  }
  const nameOf = (S, uid) => {
    const loc = locate(S, uid);
    const c = loc && db.get(loc.inst.id);
    return c ? c.name : '?';
  };
  /** Anota la invocación en S.turnState (Invocación Normal usada, límites por turno, invocaciones especiales). */
  function commitSummon(S, req, v) {
    req = req || {};
    v = v || checkSummon(S, req);
    const t = ensureTS(S);
    const method = req.method || 'special';
    const uids = method === 'pendulum' && Array.isArray(req.uids) && req.uids.length ? req.uids : [req.uid];
    try {
      if (NORMAL_METHODS.includes(method)) t.normalSummons = (t.normalSummons || 0) + 1;
      else {
        if (method === 'pendulum') t.pendulumSummons = (t.pendulumSummons || 0) + 1;
        const own = !!(req.ownProcedure || req.effectIndex != null);
        for (const uid of uids) {
          const loc = locate(S, uid);
          const c = loc && db.get(loc.inst.id);
          if (!c) continue;
          const from = (v.from && v.from[uid]) || loc.area;
          t.specials.push({ id: c.id, extra: from === 'extra' });
          for (const o of analyze(c).summonOpts) {
            if (o.method && o.method !== method) continue;
            if (o.thisWay && !own) continue;
            const store = o.duel ? t.duel : t.opt;
            store[o.key] = (store[o.key] || 0) + 1;
          }
          // "If Summoned this way, you cannot Special Summon ... for the rest of this turn" (Ryzeal, Mitsurugi...)
          if (own && method === 'special') {
            const proc = analyze(c).effects.find((e) => e.kind === 'summon' && (req.effectIndex == null || e.index === Number(req.effectIndex)));
            for (const l of (proc ? proc.locks : [])) if (l.timing === 'rest' || l.timing === 'turn') t.locks.push(Object.assign({ source: c.name }, l));
          }
        }
      }
    } catch (e) { /* el registro nunca debe romper el campo */ }
    const names = uids.map((u) => q(nameOf(S, u))).join(', ');
    const mats = (req.materials || []).map((u) => q(nameOf(S, u)));
    let text = METHOD_LABELS[method] + ' de ' + names;
    if (mats.length) text += (NORMAL_METHODS.includes(method) ? ' sacrificando ' : method === 'ritual' ? ' liberando ' : ' con ') + mats.join(', ');
    if (req.source) text += ' (por ' + req.source + ')';
    return entry(S, 'summon', text, v, { method, uid: req.uid, uids, materials: (req.materials || []).slice() });
  }
  /** Anota la activación (límites por turno y bloqueos). Devuelve la entrada del registro y el eslabón para S.chain. */
  function commitActivation(S, req, v) {
    req = req || {};
    v = v || checkActivation(S, req);
    const t = ensureTS(S);
    const loc = locate(S, req.uid);
    const c = loc && db.get(loc.inst.id);
    const idx = Number(req.effectIndex) || 0;
    const e = c ? effectsOf(c).find((x) => x.index === idx) : null;
    try {
      if (e) {
        for (const o of e.opts) {
          const key = o.perCopy ? o.key.replace('copy:', 'copy:' + req.uid) : o.key;
          const store = o.duel ? t.duel : t.opt;
          store[key] = (store[key] || 0) + 1;
        }
        for (const l of e.locks) if (l.timing === 'rest' || l.timing === 'turn') t.locks.push(Object.assign({ source: c.name }, l));
      }
      // Efectos activados este turno (Invocación Normal adicional, activar el turno en que se Colocó, Mulcharmy...)
      if (c) t.acts.push({ id: c.id, effectIndex: idx, monster: db.isMonster(c) && idx > 0 });
    } catch (err2) { /* el registro nunca debe romper el campo */ }
    const cl = (req.chainLength != null ? Number(req.chainLength) : chainLen(S)) + 1;
    const name = c ? c.name : '?';
    let text;
    if (idx === 0 && c && db.isMonster(c)) text = 'Activa ' + q(name) + ' como Escala de Péndulo';
    else text = 'Activa ' + q(name) + (e && !e.synthetic && !(e.kind === 'activation' && effectsOf(c).filter((x) => !x.synthetic).length === 1) ? ' (efecto ' + idx + ')' : '') + ' · Eslabón ' + cl;
    const link = { uid: req.uid, id: c ? c.id : null, effectIndex: idx, text: e ? e.text : '', speed: e ? e.speed : (c && db.isMonster(c) ? 1 : null) };
    return entry(S, 'activation', text, v, { uid: req.uid, id: link.id, effectIndex: idx, chainLink: cl, link });
  }
  function commitPosition(S, uid, v) {
    v = v || checkPosition(S, uid);
    const loc = locate(S, uid);
    const flip = !!(loc && loc.inst.faceDown);
    return entry(S, 'position', (flip ? 'Invocación por Volteo de ' : 'Cambia la posición de ') + q(nameOf(S, uid)), v, { uid, flip });
  }
  function commitSet(S, uid, v) {
    v = v || checkSet(S, uid);
    return entry(S, 'set', 'Coloca ' + q(nameOf(S, uid)), v, { uid });
  }

  /* ---------- Movimientos manuales y bloqueos del rival ---------- */
  /** ¿Sigue vigente este bloqueo del rival? Pregunta a YGO.bot.lockActive; sin él: con sourceUid, mientras esa carta siga
   * boca arriba en el campo del rival; con until, hasta el final de ese turno; los demás, sí (se borran al pasar de turno). */
  function lockLive(S, l) {
    if (!l) return false;
    const B = YGO.bot;
    if (B && typeof B.lockActive === 'function') {
      try { return !!B.lockActive(S, l); } catch (e) { /* sigue con la versión local */ }
    }
    if (l.sourceUid) return !!(S && S.opp && Array.isArray(S.opp.field) && S.opp.field.some((x) => x && x.uid === l.sourceUid && !x.faceDown));
    if (l.until != null) return tsOf(S).turn <= Number(l.until);
    return true;
  }
  const liveLocks = (S, kind) => tsOf(S).locks.filter((l) => l && l.kind === kind && lockLive(S, l));
  // Angelechy Destrier en una Zona de Monstruo Extra ({ kind: 'emzTaken', zone }): esa zona no es tuya mientras siga ahí
  const emzTakenLock = (S, zone) => liveLocks(S, 'emzTaken').find((l) => (l.zone || 'emz1') === zone) || null;
  // Angelechy Shatranga ({ kind: 'monsterEffectCap', max }): solo puedes intentar activar max efectos de monstruo por turno
  const pendAct = (a) => { const c = db.get(a.id); const e = c && effectsOf(c).find((x) => x.index === Number(a.effectIndex)); return !!(e && e.pendulum); };
  /** Efectos de monstruo que ya intentaste activar este turno (los negados también cuentan; los de Péndulo, no). */
  const monsterActs = (t) => t.acts.filter((a) => a && a.monster && !pendAct(a)).length;
  // Artifact Lancea ({ kind: 'noBanish' }): este turno nadie puede desterrar cartas
  const noBanishLock = (t) => t.locks.find((l) => l && l.kind === 'noBanish') || null;
  const noBanishText = (l) => 'Por ' + q(l.source || 'Artifact Lancea') + ', este turno nadie puede desterrar cartas.';
  const BANISH_VERB = /\bbanish\b/i;
  /** Movimiento manual (añadir del Mazo a la mano, etc.). Los robos no pasan por aquí (Droll no los impide). */
  function checkMove(S, uid, dest, opts) {
    const v = verdict();
    try {
      const loc = locate(S, uid);
      if (!loc) { err(v, 'No encuentro esa carta.'); return done(v); }
      const t = tsOf(S);
      const nb = dest === 'ban' ? noBanishLock(t) : null;
      if (nb) err(v, noBanishText(nb));
      if (dest === 'hand' && loc.area === 'deck' && !(opts && opts.draw)) {
        for (const l of t.locks) {
          if (l && l.kind === 'noDeckAdd') err(v, 'Por ' + q(l.source || 'Droll & Lock Bird') + ', este turno no se pueden añadir cartas del Mazo a la mano.');
        }
      }
    } catch (e) { warn(v, 'No pude revisar este movimiento.'); }
    return done(v);
  }
  /** Agrega un bloqueo: { kind: 'noDeckAdd' | 'noBanish' | 'gyToBan' | 'monsterEffectCap' | 'emzTaken', source, text,
   * sourceUid?, until?, zone?, max? }. Se borra al pasar de turno salvo los que tienen sourceUid o until (ver passTurn).
   * Uno igual (tipo y carta) no se repite; si es de otra copia (otro sourceUid) o con otro until, reemplaza al anterior. */
  function addLock(S, lock) {
    const t = ensureTS(S);
    if (!lock || typeof lock !== 'object') return t;
    const i = t.locks.findIndex((l) => l && l.kind === lock.kind && l.source === lock.source);
    if (i < 0) t.locks.push(Object.assign({}, lock));
    else if (t.locks[i].sourceUid !== lock.sourceUid || t.locks[i].until !== lock.until) t.locks[i] = Object.assign({}, lock);
    return t;
  }

  YGO.rules = {
    PHASES, ZONE_NAMES, METHOD_LABELS, KIND_LABELS,
    newTurnState, nextPhase, setPhase, passTurn, phaseName, turnLabel,
    effectsOf, parseMaterials, procedureOf, linkedZones, legalZones, locate,
    checkSummon, checkActivation, checkPlacement, checkPosition, checkSet, checkMove,
    commitSummon, commitActivation, commitPosition, commitSet, addLock, isArch, isNamed,
  };
})();
