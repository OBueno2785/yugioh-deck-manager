/* Lector de efectos para el modo Automático del campo: lee el texto de cada efecto (costo, objetivos y lo que hace
 * al resolverse) y lo convierte en pasos que js/field.js sabe hacer (añadir, Invocar de modo Especial, mandar,
 * robar, desterrar, destruir, devolver, descartar...). Lo que no entiende con seguridad queda como paso manual:
 * nunca se adivina (una acción automática equivocada es peor que una nota para hacerlo a mano).
 * Funciones puras: no tocan el DOM ni el estado del duelo. Depende de YGO.db y YGO.rules. Expone window.YGO.effects. */
(function () {
  const YGO = (window.YGO = window.YGO || {});
  const db = YGO.db;
  const T = db.T;
  const R = () => YGO.rules || {};

  /* ---------- Constantes ---------- */
  const AREAS = {
    hand: 'la mano', deck: 'el Mazo', extra: 'el Extra Deck', extraUp: 'boca arriba del Extra Deck', gy: 'el Cementerio',
    ban: 'desterradas', field: 'el campo', fieldUp: 'boca arriba en el campo', mzone: 'tu Zona de Monstruo',
    stzone: 'tu Zona de Mágicas y Trampas', pzone: 'tu Zona de Péndulo', oppField: 'el campo del rival',
    oppGy: 'el Cementerio del rival', oppHand: 'la mano del rival',
  };
  const VERBS = ['add', 'addOrSS', 'ss', 'token', 'send', 'discard', 'draw', 'banish', 'destroy', 'returnHand', 'returnDeck',
    'deckTop', 'set', 'placeST', 'placePZ', 'attach', 'detach', 'tribute', 'banishTop', 'millTop', 'position', 'level',
    'payLP', 'lpGain', 'reveal', 'procSummon', 'target'];
  // Mismas tablas que rules.js (ATTRS / RACES_EN)
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
    Spirit: [T.SPIRIT, 'Espíritu'], Union: [T.UNION, 'Unión'], Token: [T.TOKEN, 'Ficha'],
  };
  const SUBS = {
    Continuous: [T.CONTINUOUS, 'Continua'], 'Quick-Play': [T.QUICKPLAY, 'Rápida'], Field: [T.FIELD, 'de Campo'],
    Equip: [T.EQUIP, 'de Equipo'], Ritual: [T.RITUAL, 'de Ritual'], Counter: [T.COUNTER, 'de Contraefecto'], Normal: [0, 'Normal'],
  };
  const SUB_MASK = T.CONTINUOUS | T.QUICKPLAY | T.FIELD | T.EQUIP | T.RITUAL | T.COUNTER;
  const NUMW = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
  const OPP_AREAS = ['oppField', 'oppGy', 'oppHand', 'oppDeck', 'oppExtra'];
  const REMOVERS = ['destroy', 'banish', 'returnHand'];
  const TO_ME = ['add', 'addOrSS', 'ss', 'set', 'placeST', 'placePZ', 'attach', 'token'];
  // Verbos cuyo resultado son cartas a las que se puede referir después ("..., and if you do, Special Summon it")
  const PRODUCES = ['add', 'addOrSS', 'ss', 'token', 'send', 'discard', 'banish', 'destroy', 'returnHand', 'returnDeck', 'deckTop',
    'set', 'placeST', 'placePZ', 'attach', 'millTop', 'draw'];
  const COST_VERBS = ['discard', 'send', 'banish', 'tribute', 'detach', 'payLP', 'banishTop', 'millTop', 'returnDeck', 'returnHand',
    'deckTop', 'reveal', 'position', 'target'];
  // Mueven cartas como costo (para "the sent card" y differentFrom)
  const COST_MOVES = ['discard', 'send', 'banish', 'tribute', 'detach', 'returnDeck', 'returnHand', 'deckTop'];
  const ACTIVATED = ['activation', 'ignition', 'quick', 'trigger'];

  /* ---------- Texto ---------- */
  const reEsc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  /** true en cada posición que está dentro de comillas o de paréntesis. */
  function maskOf(s) {
    const m = new Array(s.length);
    let q = false, d = 0;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === '"') { q = !q; m[i] = true; continue; }
      if (!q && ch === '(') d++;
      m[i] = q || d > 0;
      if (!q && ch === ')') d = Math.max(0, d - 1);
    }
    return m;
  }
  // Versiones globales de las expresiones (se compilan una sola vez) y la última máscara calculada
  const globals = new WeakMap();
  const globalOf = (re) => {
    let g = globals.get(re);
    if (!g) { g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'); globals.set(re, g); }
    g.lastIndex = 0;
    return g;
  };
  let lastMask = { s: null, m: null };
  const maskCached = (s) => (lastMask.s === s ? lastMask.m : (lastMask = { s, m: maskOf(s) }).m);
  /** Primera coincidencia de re fuera de comillas y paréntesis (o null). */
  function findTop(s, re) {
    // Lo común: la primera coincidencia ya está fuera de comillas (sin compilar otra expresión)
    const first = re.global ? null : s.match(re);
    if (!re.global && !first) return null;
    const m = maskCached(s);
    if (first && first[0].length && !m[first.index]) return first;
    const g = globalOf(re);
    let x;
    while ((x = g.exec(s))) {
      if (!x[0].length) { g.lastIndex++; continue; }
      if (!m[x.index]) return x;
    }
    return null;
  }
  const allTop = (s, re) => {
    const m = maskCached(s), g = globalOf(re), out = [];
    let x;
    while ((x = g.exec(s))) { if (!x[0].length) { g.lastIndex++; continue; } if (!m[x.index]) out.push(x); }
    return out;
  };
  /** Divide s en las coincidencias de re fuera de comillas/paréntesis → [{ text, sep }] (sep: el separador anterior). */
  function splitAt(s, re) {
    const out = [];
    let last = 0, sep = null;
    for (const x of allTop(s, re)) { out.push({ text: s.slice(last, x.index), sep }); sep = x[0]; last = x.index + x[0].length; }
    out.push({ text: s.slice(last), sep });
    return out.map((p) => ({ text: p.text.trim(), sep: p.sep })).filter((p) => p.text);
  }
  const cut = (s, x) => (s.slice(0, x.index) + ' ' + s.slice(x.index + x[0].length)).replace(/\s+/g, ' ').replace(/\s+,/g, ',').trim();
  const NEEDS_NORM = /[\u201c\u201d\u2033\u2018\u2019]|Graveyard|Main Deck|\s\s|[\t\n\r]/;
  function norm(s) {
    s = String(s || '');
    if (!NEEDS_NORM.test(s)) return s.trim();
    return s.replace(/[“”″]/g, '"').replace(/[‘’]/g, "'")
      .replace(/\bGraveyards?\b/g, 'GY').replace(/\bMain Deck\b/g, 'Deck').replace(/\s+/g, ' ').trim();
  }
  const clean = (s) => norm(s).replace(/^[,\s]+/, '').replace(/[.\s]+$/, '').trim();
  function sentencesOf(text) {
    const v = YGO.view;
    if (v && v.sentences) return v.sentences(text);
    return text.replace(/\.\s+(?=[A-Z(])/g, '.\u0001').split('\u0001');
  }
  function topIndex(s, ch) {
    const m = maskOf(s);
    for (let i = 0; i < s.length; i++) if (s[i] === ch && !m[i]) return i;
    return -1;
  }

  /* ---------- Filtros ---------- */
  const SEP = '(?:, and\\/or |, or |, and | and\\/or | or | and |, )';
  const listOf = (item) => '(?:' + item + ')(?:' + SEP + '(?:' + item + '))*';
  const SEP_RE = new RegExp(SEP);
  const splitList = (s) => s.split(SEP_RE).map((x) => x.trim()).filter(Boolean);
  const ATTR_ITEM = ATTRS.map((a) => a[0]).join('|');
  const RACE_ITEM = '(?:' + RACES_EN.map((r) => r[0]).join('|') + ')(?:-Type)?';
  const KIND_ITEM = '(?:Tuner|Effect|Normal|Fusion|Synchro|Xyz|Link|Ritual|Pendulum|Flip|Toon|Gemini|Spirit|Union)';
  const END = '(?=[\\s,]|$)';
  const NOUN_AHEAD = /^(?:monsters?|Monsters?|Monster Cards?|cards?|Cards?|Spells?|Traps?|Spell\/Traps?|Spells?\/Traps?|Spell Cards?|Trap Cards?|Spell or Trap|Spells? and Traps?|Tuners?|Continuous|Quick-Play|Field|Equip|Normal|Counter|Ritual|Tuner|Effect|Fusion|Synchro|Xyz|Link|Pendulum|Flip|Toon|Gemini|Spirit|Union|Attack Position|Defense Position)\b/;
  // "Tribute 2 "Cyber Dragons"": el nombre de la carta es "Cyber Dragon"
  const singular = (n) => (/s$/.test(n) && !db.findByName(n) && db.findByName(n.slice(0, -1)) ? n.slice(0, -1) : n);
  const ATTR_RE = new RegExp('^' + listOf(ATTR_ITEM) + END);
  const RACE_RE = new RegExp('^' + listOf(RACE_ITEM) + END);
  const QUOTE_RE = new RegExp('^' + listOf('"[^"]+"') + '(?=[\\s,]|$)');
  const KIND_RE = new RegExp('^' + listOf(KIND_ITEM + 's?') + '(?=[\\s,]|$)');
  const NON_ATTR_RE = new RegExp('^non-(' + ATTR_ITEM + ')\\b');
  const range = (n, how) => (/lower|less/.test(how) ? { max: n } : { min: n });

  /** Lee un filtro sin la cantidad ("other "Elfnote" monster, except "Elfnote Lucina"") → { ok, filter } | { ok: false, rest } */
  function parseFilter(text) {
    const src = String(text || '').trim();
    if (!src) return { ok: false, rest: '(vacío)' };
    // Alternativas: "1 "A" monster or 1 "B""
    let body = src, tailEx = '';
    // ", except "X"" al final vale para todas las opciones ("1 "Bystial" monster or 1 "Branded" Spell/Trap, except "Bystial Saronir"");
    // sin coma ("or 1 FIRE Warrior monster except "X"") solo para la última
    const ex = findTop(body, /, except "[^"]+"(?:(?:,? or |, |,? and )"[^"]+")*(?: monsters?| cards?)?$/);
    if (ex) { tailEx = ex[0]; body = body.slice(0, ex.index); }
    const alts = splitAt(body, /,? or (?:1|a|an) (?=["A-Za-z0-9])|, OR 1 /);
    if (alts.length > 1) {
      const fs = [];
      for (const a of alts) { const r = parseOne(a.text + tailEx); if (!r.ok) return r; fs.push(r.filter); }
      return { ok: true, filter: { anyOf: fs } };
    }
    return parseOne(src);
  }
  function parseOne(src) {
    let s = ' ' + src.replace(/,\s*$/, '').trim() + ' ';
    const f = {};
    const strip = (re, fn) => {
      const x = findTop(s, re);
      if (!x) return false;
      s = ' ' + cut(s, x) + ' ';
      fn(x);
      return true;
    };
    // "except "Elfnote Lucina"": ese nombre; "except "Destiny HERO" monsters": ese arquetipo (no un nombre); otra palabra → no se adivina
    let bad = null;
    strip(/,? except ("[^"]+"(?:(?:,? or |, |,? and )"[^"]+")*)( monsters?| cards?)?(?= ([A-Za-z\/-]*))/, (m) => {
      const names = m[1].match(/"[^"]+"/g).map((x) => x.slice(1, -1));
      if (m[2]) f.notArch = (f.notArch || []).concat(names);
      else if (/^(?:[A-Z]|monsters?$|cards?$)/.test(m[3] || '')) bad = m[0].trim();
      else f.except = names;
    });
    if (bad) return { ok: false, rest: bad };
    strip(/,? except this card\b/, () => { f.other = true; });
    strip(/ that (?:mentions?|lists?|specifically lists the card) ("[^"]+")(?: in its text)?/, (m) => { f.mentions = [m[1].slice(1, -1)]; });
    strip(/ with (\d+) or (less|more|lower|higher) (?:original )?(ATK|DEF)\b/, (m) => { f[m[3].toLowerCase()] = range(+m[1], m[2]); });
    strip(/ with (\d+) (ATK|DEF)\b/, (m) => { f[m[2].toLowerCase()] = { eq: +m[1] }; });
    strip(/ with different names\b/, () => { f.distinctNames = true; });
    strip(/ with a different (?:original )?(Attribute|Type|name|Level)\b/, (m) => {
      const p = m[1].toLowerCase();
      f.differentFrom = { prop: p === 'type' ? 'race' : p, ref: 'cost' };
    });
    strip(/ with a Level\b/, () => { f.level = { min: 1 }; });
    strip(/ whose original Level is (\d+)\b/, (m) => { f.level = { eq: +m[1] }; });
    s = s.trim();
    const pre = (re, fn) => {
      const m = s.match(re);
      if (!m) return false;
      s = s.slice(m[0].length).trim();
      fn(m);
      return true;
    };
    const add = (k, v) => { f[k] = (f[k] || []).concat(v); };
    let guard = 0;
    while (s && guard++ < 30) {
      if (pre(/^other\b/, () => { f.other = true; })) continue;
      if (pre(/^face-up\b/, () => { f.faceUp = true; })) continue;
      if (pre(/^face-down\b/, () => { f.faceDown = true; })) continue;
      if (pre(/^non-Tuners?\b/, () => add('notKinds', 'Tuner'))) continue;
      if (pre(/^non-Tokens?\b/, () => add('notKinds', 'Token'))) continue;
      if (pre(/^non-(Effect|Link|Pendulum|Xyz|Fusion|Synchro|Ritual)\b/, (m) => add('notKinds', m[1]))) continue;
      if (pre(NON_ATTR_RE, (m) => add('notAttr', m[1]))) continue;
      if (pre(/^non-"([^"]+)"/, (m) => add('notArch', m[1]))) continue;
      if (pre(/^Level (\d+) or (lower|higher|less|more)\b/, (m) => { f.level = range(+m[1], m[2]); })) continue;
      if (pre(/^Level (\d+) or (\d+)\b/, (m) => { f.level = { in: [+m[1], +m[2]] }; })) continue;
      if (pre(/^Level (\d+)\b/, (m) => { f.level = { eq: +m[1] }; })) continue;
      if (pre(/^Rank (\d+) or (lower|higher|less|more)\b/, (m) => { f.rank = range(+m[1], m[2]); })) continue;
      if (pre(/^Rank (\d+)\b/, (m) => { f.rank = { eq: +m[1] }; })) continue;
      if (pre(/^Link-(\d+) or (lower|higher|less|more)\b/, (m) => { f.link = range(+m[1], m[2]); })) continue;
      if (pre(/^Link-(\d+)\b/, (m) => { f.link = { eq: +m[1] }; })) continue;
      if (pre(ATTR_RE, (m) => add('attr', splitList(m[0])))) continue;
      if (pre(RACE_RE, (m) => add('race', splitList(m[0]).map((x) => x.replace(/-Type$/, ''))))) continue;
      if (pre(QUOTE_RE, (m) => {
        const names = m[0].match(/"[^"]+"/g).map((x) => x.slice(1, -1));
        if (NOUN_AHEAD.test(s)) add('arch', names); else add('names', names.map(singular));
      })) continue;
      if (pre(/^(Continuous|Quick-Play|Field|Equip|Ritual|Counter|Normal) (?=Spells?\b|Traps?\b|Spell\/Traps?\b)/, (m) => add('sub', m[1]))) continue;
      if (pre(KIND_RE, (m) => {
        const ks = splitList(m[0]).map((x) => x.replace(/s$/, ''));
        // Dos tipos seguidos ("Tuner Synchro Monster", "Pendulum Effect Monster"): tiene que ser los dos
        if (f.kinds || f.kindsAll) {
          const prev = f.kindsAll || f.kinds;
          if (ks.length > 1 || (f.kinds && f.kinds.length > 1)) { f.kindsBad = true; return; }
          f.kindsAll = prev.concat(ks);
          delete f.kinds;
        } else f.kinds = ks;
      })) { if (f.kindsBad) return { ok: false, rest: 'kinds' }; continue; }
      if (pre(/^(Attack|Defense) Position\b/, (m) => { f.position = m[1] === 'Attack' ? 'atk' : 'def'; })) continue;
      if (pre(/^(?:Monster Cards?|monsters?|Monsters?)(?:\(s\))?(?=\s|$)/, () => { f.type = 'monster'; })) continue;
      if (pre(/^(?:Spell\/Trap Cards?|Spells?\/Traps?|Spell or Trap Cards?|Spell and Trap Cards?|Spell Cards? and Trap Cards?|Spell Cards? or Trap Cards?|Spells? or Traps?|Spells? and Traps?)(?:\(s\))?(?=\s|$)/, () => { f.type = 'spelltrap'; })) continue;
      if (pre(/^(?:Spell Cards?|Spells?)(?:\(s\))?(?=\s|$)/, () => { f.type = 'spell'; })) continue;
      if (pre(/^(?:Trap Cards?|Traps?)(?:\(s\))?(?=\s|$)/, () => { f.type = 'trap'; })) continue;
      if (pre(/^cards?(?:\(s\))?(?=\s|$)/, () => { f.type = 'card'; })) continue;
      return { ok: false, rest: s };
    }
    if (s) return { ok: false, rest: s };
    if (!f.type) {
      if (f.names) f.type = 'card';
      else if (f.kinds || f.kindsAll || f.level || f.rank || f.link || f.attr || f.race || f.notKinds || f.atk || f.def) f.type = 'monster';
      else return { ok: false, rest: '(sin sustantivo)' };
    }
    if (f.sub && f.type === 'monster') return { ok: false, rest: f.sub.join(' ') };
    // Un "Normal" delante de Mágica/Trampa es subtipo; delante de monstruo es tipo de monstruo
    if ((f.kinds || f.kindsAll) && f.type !== 'monster' && f.type !== 'card') return { ok: false, rest: (f.kinds || f.kindsAll).join(' ') };
    return { ok: true, filter: f };
  }

  /* ---------- Comparar cartas con un filtro ---------- */
  const inRange = (v, r) => {
    if (typeof v !== 'number' || v < 0) return false;
    if ('eq' in r) return v === r.eq;
    if ('in' in r) return r.in.includes(v);
    if ('min' in r && v < r.min) return false;
    if ('max' in r && v > r.max) return false;
    return true;
  };
  const bitOf = (table, w) => (table.find((x) => x[0] === w) || [0, 0])[1];
  const isArch = (c, n) => (R().isArch ? R().isArch(c, n) : db.norm(c.name).includes(db.norm(n)));
  const isNamed = (c, n) => (R().isNamed ? R().isNamed(c, n) : db.nameKey(c.name) === db.nameKey(n));
  const propOf = (c, p) => (p === 'attribute' ? c.attribute : p === 'race' ? c.race : p === 'name' ? db.nameKey(c.name) : c.lv);

  /** ¿La carta c cumple el filtro? ctx: { inst, area, selfUid, costCards: [cartas], targetCards: [cartas] } */
  function match(card, f, ctx) {
    const c = card;
    if (!c) return false;
    if (!f) return true;
    ctx = ctx || {};
    if (f.anyOf) return f.anyOf.some((g) => match(c, g, ctx));
    const inst = ctx.inst || null;
    const mon = db.isMonster(c), spell = db.isSpell(c), trap = db.isTrap(c);
    const tok = !!(c.type & T.TOKEN) || !!(inst && inst.token);
    if (f.type === 'monster' && !mon) return false;
    if (f.type === 'spell' && !spell) return false;
    if (f.type === 'trap' && !trap) return false;
    if (f.type === 'spelltrap' && !spell && !trap) return false;
    if (f.sub) {
      if (!spell && !trap) return false;
      if (!f.sub.some((w) => (w === 'Normal' ? !(c.type & SUB_MASK) : !!(c.type & SUBS[w][0])))) return false;
    }
    const kindHas = (w) => (w === 'Token' ? tok : !!(c.type & KINDS[w][0]));
    if (f.kinds && !(mon && f.kinds.some(kindHas))) return false;
    if (f.kindsAll && !(mon && f.kindsAll.every(kindHas))) return false;
    if (f.notKinds && f.notKinds.some(kindHas)) return false;
    const xyzLink = !!(c.type & (T.XYZ | T.LINK));
    if (f.level && !(mon && !xyzLink && inRange(inst && typeof inst.level === 'number' ? inst.level : c.lv, f.level))) return false;
    if (f.rank && !(c.type & T.XYZ && inRange(c.lv, f.rank))) return false;
    if (f.link && !(c.type & T.LINK && inRange(c.lv, f.link))) return false;
    if (f.atk && !(mon && inRange(c.atk, f.atk))) return false;
    if (f.def && !(mon && !(c.type & T.LINK) && inRange(c.def, f.def))) return false;
    if (f.attr && !(mon && f.attr.some((a) => c.attribute === bitOf(ATTRS, a)))) return false;
    if (f.notAttr && mon && f.notAttr.some((a) => c.attribute === bitOf(ATTRS, a))) return false;
    if (f.race && !(mon && f.race.some((r) => c.race === bitOf(RACES_EN, r)))) return false;
    if (f.arch && !f.arch.some((n) => isArch(c, n))) return false;
    if (f.notArch && f.notArch.some((n) => isArch(c, n))) return false;
    if (f.names && !f.names.some((n) => isNamed(c, n))) return false;
    if (f.except && f.except.some((n) => isNamed(c, n))) return false;
    if (f.mentions && !f.mentions.some((n) => String(c.desc || '').includes('"' + n + '"') && db.nameKey(c.name) !== db.nameKey(n))) return false;
    const area = ctx.area || null;
    const inExtra = area === 'extra' || area === 'extraUp' || (!area && inst && 'extraFaceUp' in inst);
    const onField = area ? /^(?:field|fieldUp|mzone|stzone|pzone|oppField)$/.test(area) : !!(inst && 'faceDown' in inst && !inExtra);
    if (f.faceUp) {
      if (inExtra) { if (!(inst && inst.extraFaceUp)) return false; }
      else if (inst && inst.faceDown) return false;
    }
    if (f.faceDown && !(onField && inst && inst.faceDown)) return false;
    if (f.position && !(inst && !inst.faceDown && (f.position === 'def') === !!inst.def)) return false;
    if (f.other && inst && ctx.selfUid != null && inst.uid === ctx.selfUid) return false;
    if (f.differentFrom) {
      const list = (f.differentFrom.ref === 'targets' ? ctx.targetCards : ctx.costCards) || [];
      if (!list.length) return false;
      const p = f.differentFrom.prop;
      if (list.some((x) => x && propOf(x, p) === propOf(c, p))) return false;
    }
    return true;
  }

  /* ---------- Lugares ---------- */
  const AREA_ITEM = '(?:face-up Extra Deck|Extra Deck|hand|Deck|GY|banishment|banished cards|face-up field|field|Main Monster Zones?|Monster Zones?|Spell & Trap Zones?|Pendulum Zones?)';
  const ASEP = '(?:, and\\/or |, or |, and | and\\/or | or | and |, |\\/)';
  const AREA_LIST = AREA_ITEM + '(?:' + ASEP + '(?:your )?' + AREA_ITEM + ')*';
  const areaWord = (w) => {
    w = w.replace(/^your /, '');
    if (w === 'face-up Extra Deck') return 'extraUp';
    if (w === 'Extra Deck') return 'extra';
    if (w === 'hand') return 'hand';
    if (w === 'Deck') return 'deck';
    if (w === 'GY') return 'gy';
    if (w === 'banishment' || w === 'banished cards') return 'ban';
    if (w === 'face-up field') return 'fieldUp';
    if (w === 'field') return 'field';
    if (/Monster Zone/.test(w)) return 'mzone';
    if (/Spell & Trap Zone/.test(w)) return 'stzone';
    if (/Pendulum Zone/.test(w)) return 'pzone';
    return null;
  };
  const ASEP_RE = new RegExp(ASEP);
  const areasOf = (list) => [...new Set(list.split(ASEP_RE).map((x) => areaWord(x.trim())).filter(Boolean))];
  const OPP_WORD = { hand: 'oppHand', GY: 'oppGy', Deck: 'oppDeck', field: 'oppField', 'Extra Deck': 'oppExtra' };
  // [expresión, (m) → { areas, zone?, bothGy? }] en orden: las más largas primero
  const PLACES = [
    [/,? on the field or in either GY\b/, () => ({ areas: ['field', 'gy', 'oppField', 'oppGy'] })],
    [/,? (?:in|from) either field or GY\b/, () => ({ areas: ['field', 'gy', 'oppField', 'oppGy'] })],
    [/,? (?:in|from) (?:the|both|each) GYs?\b|,? (?:in|from) both players' GYs\b/, () => ({ areas: ['gy', 'oppGy'], bothGy: true })],
    [/,? (?:in|from) either (?:player's )?GY\b/, () => ({ areas: ['gy', 'oppGy'] })],
    [/,? (?:directly )?(?:in|from|on) your opponent's ((?:hand|GY|Deck|field|Extra Deck)(?:(?:, and\/or |, or |, and | and\/or | or | and |, )(?:hand|GY|Deck|field|Extra Deck))*)/, (m) => ({ areas: splitList(m[1]).map((w) => OPP_WORD[w]) })],
    [/,? (?:that )?your opponent controls\b|,? on your opponent's side of the field\b/, () => ({ areas: ['oppField'] })],
    [/,? (?:on|in|from) (?:the|either) field\b|,? on either player's field\b|,? on the field\b/, () => ({ areas: ['field', 'oppField'] })],
    [/,? in your center Main Monster Zone\b/, () => ({ areas: ['mzone'], zone: 'center' })],
    [/,? (?:that )?you control\b|,? on your field\b|,? from your field\b/, () => ({ areas: ['field'] })],
    // "in the Spell & Trap Zone": de cualquiera de los dos jugadores → no se adivina
    [/,? (?:in|from|on) the (?:Main |Extra )?(?:Monster|Spell & Trap|Pendulum|Field) Zones?\b|,? (?:in|from) the GY\b/, () => ({ areas: [], unclear: true })],
    // "from their hand/GY": de quién es depende del texto (casi siempre del rival o de cada jugador) → no se adivina
    [new RegExp(',? (?:directly )?(?:in|from) (?:your|the|its owner\'s|their owner\'s) (' + AREA_LIST + ')(?=[\\s,]|$)'), (m) => ({ areas: areasOf(m[1]) })],
    [/,? (?:that (?:is|are) banished|among your banished (?:cards|monsters))\b/, () => ({ areas: ['ban'] })],
  ];
  /** Busca el lugar de origen en s. → { areas, zone, bothGy, s (sin el lugar), many (había más de uno) } | null */
  function placeOf(s) {
    let hit = null;
    for (const [re, fn] of PLACES) {
      const x = findTop(s, re);
      if (x) { hit = Object.assign(fn(x), { x }); break; }
    }
    if (!hit) return null;
    const rest = cut(s, hit.x);
    // Un segundo lugar (dos objetos distintos o un lugar que no entiendo) → no se adivina
    const again = PLACES.some(([re]) => findTop(rest, re));
    return { areas: hit.areas, zone: hit.zone, bothGy: hit.bothGy, s: rest, many: again || !!hit.unclear };
  }
  /** Dueño según los lugares: { owner } | { note } | { manual: why } */
  function ownerOf(verb, areas, count) {
    const opp = areas.filter((a) => OPP_AREAS.includes(a)), own = areas.filter((a) => !OPP_AREAS.includes(a));
    if (!opp.length) return { owner: 'me' };
    if (!own.length) {
      if (verb === 'target') return opp.every((a) => a === 'oppField' || a === 'oppGy') ? { owner: 'opp' } : { manual: 'opp-target' };
      if (REMOVERS.includes(verb) && opp.every((a) => a === 'oppField')) return { owner: 'opp' };
      if (TO_ME.includes(verb)) return { manual: 'opp-source' };
      return { note: true };
    }
    if (verb === 'target') return opp.every((a) => a === 'oppField' || a === 'oppGy') ? { owner: 'any' } : { manual: 'opp-target' };
    if (REMOVERS.concat(['level', 'position']).includes(verb)) {
      if (count && count.all && opp.some((a) => a !== 'oppField')) return { manual: 'both-gy' };
      if (opp.some((a) => a !== 'oppField' && a !== 'oppGy')) return { manual: 'mixed-owner' };
      return { owner: 'any' };
    }
    return { manual: opp.includes('oppGy') ? 'both-gy' : 'mixed-owner' };
  }

  /* ---------- Cantidades y referencias ---------- */
  /** "1 ..." / "up to 2 ..." / "all ..." → { count, rest } | { manual } | null */
  function countOf(s, verb) {
    let m;
    if ((m = s.match(/^up to (\d+|one|two|three|four|five) (.+)$/i))) {
      const n = +m[1] || NUMW[m[1].toLowerCase()];
      return { count: verb === 'target' ? { min: 1, max: n } : { min: 0, max: n }, rest: m[2] };
    }
    if ((m = s.match(/^as many (.+?) as possible$/i))) {
      return REMOVERS.includes(verb) ? { count: { all: true }, rest: m[1] } : { manual: 'count' };
    }
    if ((m = s.match(/^all (?:of )?(?:the )?(.+)$/i))) {
      return REMOVERS.includes(verb) || verb === 'level' ? { count: { all: true }, rest: m[1] } : { manual: 'count' };
    }
    if (/^(?:any number of|\d+ or more|\d+ or \d+|\d+ or less|\d+ to \d+|cards? equal|monsters? equal|a number of)\b/i.test(s)) return { manual: 'count' };
    if ((m = s.match(/^(\d+|a|an|one|two|three|four|five|six) (.+)$/i))) {
      if (/^(?:or|of|to)\b/i.test(m[2])) return { manual: 'count' };
      const n = +m[1] || NUMW[m[1].toLowerCase()];
      return { count: { min: n, max: n }, rest: m[2] };
    }
    return null;
  }
  const REF_THIS = /^(?:this card|this banished card|this face-up card|this Set card)$/i;
  const REF_TARGET = /^(?:that target|those targets|the targets?|the targeted (?:card|monster)s?|that targeted (?:card|monster))$/i;
  const REF_IT = /^it$/i;
  const REF_THEM = /^(?:them|both|both of them|both cards|both monsters)$/i;
  const REF_DESTROYED = /^(?:that|the) destroyed (?:card|monster)s?$/i;
  const REF_THAT = /^(?:that card|that monster|those cards|those monsters|that negated card|that face-up monster|that face-up card|that Set card|those face-up monsters)$/i;
  const REF_COST = /^(?:the (?:sent|discarded|banished|Tributed|revealed|returned|shuffled) (?:card|monster)s?|the detached materials?)$/i;
  const REF_POSS = /^(?:its|their|that monster's|that card's|the target's|this card's)$/i;
  const refKind = (s) => (REF_THIS.test(s) ? 'this' : REF_TARGET.test(s) ? 'targets' : REF_IT.test(s) ? 'it' : REF_THEM.test(s) ? 'them' : REF_THAT.test(s) ? 'that' : REF_DESTROYED.test(s) ? 'destroyed' : REF_COST.test(s) ? 'cost' : null);

  /** Une una referencia con el plan → { refers, owner } | { note: 'opp' } | { manual } */
  function bindRef(kind, verb, ctx) {
    if (kind === 'this') return { refers: 'this' };
    // "the revealed card": solo si el costo eligió cartas en un único paso (si no, no sé cuáles son)
    if (kind === 'cost') return ctx.costPick === 1 ? { refers: 'cost' } : { manual: 'ref' };
    const prev = ctx.prev;
    const t = ctx.targets && ctx.targets.length ? ctx.targets[ctx.targets.length - 1] : null;
    if (kind === 'destroyed') {
      // "that destroyed monster": solo si lo anterior fue destruir (si no, es el de la condición)
      const la = ctx.lastAction;
      if (prev && prev.kind === 'opp') return { note: 'opp' };
      if (!la || la.verb !== 'destroy' || la.owner) return { manual: 'ref' };
      return { refers: 'previous' };
    }
    if (kind === 'it' || kind === 'that' || kind === 'them') {
      if (prev && prev.kind === 'opp') return { note: 'opp' };
      if (prev && prev.verb === 'manual') return { manual: 'ref' };
      const la = ctx.lastAction;
      // "send this card to the GY, and if you do, place that card ...": "that card" no es esta carta
      if (la && PRODUCES.includes(la.verb) && !(kind === 'that' && la.refers === 'this')) {
        if (la.owner === 'opp') return { note: 'opp' };
        if (la.owner === 'any') return { manual: 'ref' };
        // Con objetivos y otra acción antes, "it" es ambiguo; "that monster" es el objetivo
        if (!t || la.refers === 'targets') return { refers: 'previous' };
        if (kind !== 'that') return { manual: 'ref' };
      }
    }
    if (!t) {
      if (kind === 'it' && ctx.selfCond) return { refers: 'this' };
      if ((kind === 'it' || kind === 'that' || kind === 'them') && ctx.respond) return { note: 'opp' };
      return { manual: 'ref' };
    }
    if (t.verb === 'manual') return { manual: 'ref' };
    if (t.owner === 'opp') {
      if (TO_ME.includes(verb)) return { manual: 'opp-source' };
      if (REMOVERS.includes(verb) && t.from && t.from.every((a) => a === 'oppField')) return { refers: 'targets', owner: 'opp' };
      return { note: 'opp' };
    }
    return { refers: 'targets' };
  }

  /* ---------- Cláusulas ---------- */
  const manual = (text, why) => ({ verb: 'manual', text, why });
  const note = (kind, text) => ({ kind, text });
  const LOCK = /\b(?:cannot|can't|can only)\b|^neither player can\b|^for the rest of (?:this|the) turn\b|^until the end of\b|^this turn,/i;
  const STAT = /\b(?:gains?|loses?) (?:\d+ )?(?:ATK|DEF)\b|\b(?:gains?|loses?) (?:ATK|DEF) equal\b|\b(?:ATK|DEF)(?:\/DEF| and DEF)? (?:becomes?|is halved|is doubled|become)\b|\b(?:original|current) (?:ATK|DEF) becomes?\b|\bATK (?:becomes|become) double\b/i;
  const DELAYED = /\bduring (?:the|this|your|each|the next) (?:next )?(?:End|Standby) Phase\b|\b(?:2nd|next) Standby Phase\b|\bduring the End Phase of\b|\bat the end of the Battle Phase\b/i;
  const OPP_HEAD = /^(?:negate\b|take control\b|look at (?:your opponent's|the top (?:\d+ )?cards? of your opponent's)|your opponent\b|the opponent\b|change control\b)/i;
  // Comienzo de lo que sigue a una condición "if ..., <esto>"
  const AFTER_COND = /^(?:you can |immediately |for the rest |until the end |your opponent |neither |also |then )|^(?:add|special summon|send|draw|destroy|banish|return|shuffle|place|set|attach|detach|change|increase|reduce|pay|gain|tribute|discard|negate|inflict|take|equip|target|reveal|look|excavate|fusion summon|synchro summon|xyz summon|link summon|ritual summon|apply|activate|this card|that monster|that card|it|its|they|their|it gains|you gain|all|each)\b/i;
  const ACTION_HEAD = /^(?:take|equip|choose|excavate|add|send|banish|special summon|normal summon|summon|place|attach|detach|shuffle|return|destroy|discard|set|tribute|reveal|draw|move|flip|toss|roll|declare|look|switch|swap|give|activate|apply|fusion summon|synchro summon|xyz summon|link summon|ritual summon|pendulum summon|pay|gain control|banish all|target|excavate)\b/i;
  const HIDDEN = /\b(?:it|that card|that monster|they|the (?:drawn|excavated|revealed|added) cards?) (?:was|is|were|are) (?:an?|the) /i;

  /** Lee una cláusula → Action | ManualStep | Note.
   * ctx: { first, hasCost, cost, prev, lastAction, targets, costMoves, respond, option, card } */
  function parseClause(text, ctx) {
    ctx = ctx || {};
    const raw = clean(text);
    let s = raw;
    const flags = {};
    let m, guard = 0;
    // Encabezados de la cláusula, en orden
    while (guard++ < 6) {
      if ((m = s.match(/^(?:and )?if (?:you|it|they) do(?: that| so)?,\s*/i))) { flags.dependsOnPrevious = true; s = s.slice(m[0].length); continue; }
      if ((m = s.match(/^then,?\s+/i))) { flags.dependsOnPrevious = true; s = s.slice(m[0].length); continue; }
      if ((m = s.match(/^also,?\s+/i))) { s = s.slice(m[0].length); continue; }
      if ((m = s.match(/^once per (?:turn|chain),\s*/i))) { s = s.slice(m[0].length); continue; }
      if ((m = s.match(/^immediately after this effect resolves,?\s*/i))) { flags.after = true; s = s.slice(m[0].length); continue; }
      if (/^if\s/i.test(s) && !flags.condition) {
        const commas = allTop(s, /, /);
        const at = commas.find((x) => AFTER_COND.test(s.slice(x.index + 2)));
        if (!at) return manual(raw, 'condition');
        flags.condition = s.slice(3, at.index).trim();
        s = s.slice(at.index + 2);
        continue;
      }
      if ((m = s.match(/^you can\s+(?!only\b)/i))) {
        if (!ctx.cost && !(ctx.first && !ctx.hasCost)) flags.optional = true;
        s = s.slice(m[0].length);
        continue;
      }
      break;
    }
    const withFlags = (x) => {
      if (x.verb && x.verb !== 'manual') {
        for (const k of ['optional', 'dependsOnPrevious', 'condition', 'after']) if (flags[k] && x[k] === undefined) x[k] = flags[k];
        if (x.condition && HIDDEN.test(x.condition)) return manual(raw, 'hidden');
        // "if all the Fusion Materials ... are in your Deck, Special Summon them": la condición nombra otras cartas
        if (x.condition && (x.refers === 'previous' || x.refers === 'targets') && /\b(?:monsters?|cards?|them|they|this card)\b/i.test(x.condition)) return manual(raw, 'ref');
      }
      return x;
    };
    // Notas que no dependen del verbo
    if (/\byou can (?:also )?activate this card\b/i.test(raw)) return note('rule', raw);
    // Efecto de reemplazo ("If X would be destroyed ..., you can banish 1 ... instead"): no es parte de esta resolución
    if (/\bwould be (?:destroyed|sent|banished|returned|Tributed)\b.*\binstead\b/i.test(raw)) return note('rule', raw);
    // Requisitos de la activación que ya se cumplieron al declararla
    if (/^Activate only (?:when|if|during|while)\b|\bto activate and to resolve this effect\b|^This is a Quick Effect\b|^It can be activated this turn\b|^You can only (?:use|activate)\b/i.test(raw)) return note('rule', raw);
    // Cartas de Ritual: los monstruos que se sacrifican los eliges tú al invocar (lo revisan las reglas)
    if (/^You must also (?:Tribute|offer) (?:monsters?|"[^"]+" monsters?|a monster)\b/i.test(raw) && /\bLevel(?:s| Stars)?\b/.test(raw) && !/\b(?:banish|send|Deck|GY|shuffle)\b/i.test(raw)) return note('rule', raw);
    // Lo que pasará después ("When this card leaves the field, destroy that monster")
    if (/^(?:when|if) (?:this card|that monster|the equipped monster|it) (?:leaves the field|is destroyed|is removed from the field)\b|^While this card is (?:equipped|face-up on the field)\b/i.test(raw)) return note('linger', raw);
    if (/^\(.*\)$/.test(raw)) {
      const t = raw.match(/^\(this is treated as an? (Synchro|Xyz|Fusion|Link|Ritual) Summon\.?\)$/i);
      return t ? { kind: 'treated', text: raw, treatedAs: t[1].toLowerCase() } : note('info', raw);
    }
    const out = { verb: null, text: raw };
    const r = verbClause(s, out, ctx, flags);
    if (r) return withFlags(r);
    // Sin verbo conocido
    if (OPP_HEAD.test(s) && !/^your opponent (?:cannot|can't)\b/i.test(s)) {
      if (/^your opponent\b/i.test(s) && STAT.test(s)) return note('stat', raw);
      return note('opp', raw);
    }
    if (/^inflict\b/i.test(s)) return /\bto your opponent\b/i.test(s) && !/\bequal to\b|\bfor each\b/i.test(s) ? note('opp', raw) : manual(raw, 'damage');
    // Una orden que no sé hacer ("Take 1 ...", "Banish, face-down, ...", "equip ...") no es una nota aunque diga "cannot" o "gains ATK"
    if (ACTION_HEAD.test(s) && !/\bin addition to your Normal Summon\b/i.test(s)) return manual(raw, 'unknown-verb');
    if (STAT.test(s) && !/\b(?:cannot|can't)\b/i.test(s)) return note('stat', raw);
    if (DELAYED.test(s)) return note('delayed', raw);
    if (LOCK.test(s)) return note('lock', raw);
    return manual(raw, 'unknown-verb');
  }

  // Modificadores de una Invocación Especial (y del destierro) que se quitan antes de leer el objeto
  const SS_MODS = [
    [/,? ignoring (?:its|their) Summoning conditions/i, (o) => { o.ignoreConditions = true; }],
    [/,? but (?:negate (?:its|their) effects|(?:its|their) effects are negated|(?:it|they) (?:has|have) (?:its|their) effects negated)/i, (o) => { o.negateEffects = true; }],
    [/,? but banish (?:it|them) when (?:it|they) leaves? the field|\s*\(but banish (?:it|them) when (?:it|they) leaves? the field\)/i, (o) => { o.banishOnLeave = true; o.note = 'Si deja el campo, queda desterrada.'; }],
    [/,? but (?:place|shuffle|return) (?:it|them) (?:on the bottom of|into) the Deck when (?:it|they) leaves? the field/i, (o, x) => { o._notes.push(note('linger', x[0].replace(/^,?\s*but\s*/i, ''))); }],
    [/,? but (?:destroy|banish|return|send|shuffle) (?:it|them)(?: to the hand| to the GY| into the Deck)? during the End Phase(?: of (?:this|the next) turn)?/i, (o, x) => { o._notes.push(note('delayed', x[0].replace(/^,?\s*but\s*/i, ''))); }],
    [/,? but (?:it|they) (?:cannot|can't)\b[^,]*/i, (o, x) => { o._notes.push(note('lock', x[0].replace(/^,?\s*but\s*/i, ''))); }],
    [/,? but you cannot\b.*$/i, (o, x) => { o._notes.push(note('lock', x[0].replace(/^,?\s*but\s*/i, ''))); }],
    [/\s*\(this is treated as an? (Synchro|Xyz|Fusion|Link|Ritual) Summon\)/i, (o, x) => { o.treatedAs = x[1].toLowerCase(); }],
    [/,? in (face-up Attack|face-up Defense|face-down Defense|Attack|Defense) Position/i, (o, x) => { o.position = /face-down/i.test(x[1]) ? 'set' : /Attack/i.test(x[1]) ? 'atk' : 'def'; }],
    [/,? to your center Main Monster Zone/i, (o) => { o.zone = 'center'; }],
    [/,? to (?:your|a) zone (?:this card|that monster|that target|a Link Monster|it|that Link Monster) points? to/i, (o) => { o.zone = 'linked'; }],
    [/,? to the Extra Monster Zone/i, (o) => { o.zone = 'emz'; }],
    [/,? to your field/i, () => {}],
  ];
  // ", but you cannot ..." / ", but it cannot ..." al final de cualquier acción: nota de bloqueo
  const butLock = (o, x) => { o._notes.push(note('lock', x[0].replace(/^,?\s*but\s*/i, ''))); };
  const LOCK_MODS = [[/,? but (?:it|they) (?:cannot|can't)\b[^,]*/i, butLock], [/,? but you cannot\b.*$/i, butLock]];
  function applyMods(s, out, mods) {
    for (const [re, fn] of mods) {
      const x = findTop(s, re) || s.match(re);
      if (x) { s = cut(s, x); fn(out, x); }
    }
    return s;
  }
  const finish = (out) => { if (out._notes && !out._notes.length) delete out._notes; return out; };

  /** Cláusula con verbo conocido → Action | ManualStep | Note, o null si no empieza con un verbo conocido. */
  function verbClause(s, out, ctx, flags) {
    const raw = out.text;
    let m;
    out._notes = [];
    // Valores sueltos
    if ((m = s.match(/^draw (\d+|a|an|one|two|three|four|five) cards?$/i))) {
      const n = +m[1] || NUMW[m[1].toLowerCase()];
      return finish(Object.assign(out, { verb: 'draw', count: { min: n, max: n } }));
    }
    if (/^draw\b/i.test(s)) return manual(raw, 'count');
    if ((m = s.match(/^pay (\d+|half your) LP$/i))) return finish(Object.assign(out, { verb: 'payLP', lp: /half/i.test(m[1]) ? 'half' : +m[1] }));
    if (/^pay\b/i.test(s)) return manual(raw, 'lp');
    if ((m = s.match(/^(?:you )?gain (\d+) LP$/i))) return finish(Object.assign(out, { verb: 'lpGain', lp: +m[1] }));
    if (/^(?:you )?gain\b.*\bLP\b/i.test(s)) return manual(raw, 'lp');
    // Cartas de arriba del Mazo
    if ((m = s.match(/^(banish|send) (?:the top (\d+|two|three|five|ten) cards? of your Deck|the top card of your Deck|(\d+) cards? from the top of your Deck)((?:,? face-down| \(face-down\))?)(?: to the GY)?$/i))) {
      const n = +(m[2] || m[3] || 1) || NUMW[String(m[2]).toLowerCase()] || ({ ten: 10 })[String(m[2]).toLowerCase()];
      Object.assign(out, { verb: /banish/i.test(m[1]) ? 'banishTop' : 'millTop', count: { min: n, max: n } });
      if (/face-down/i.test(m[4])) out.faceDown = true;
      return finish(out);
    }
    if (/^(?:banish|send|excavate|reveal) (?:the top|\d+ cards? from the top)/i.test(s)) return manual(raw, 'top');
    if (/^look at\b/i.test(s) && !/^look at (?:your opponent's|the top (?:\d+ )?cards? of your opponent's)/i.test(s)) return manual(raw, 'look');
    // Niveles
    if (/^(?:increase|reduce|decrease|lower|raise) /i.test(s)) return levelClause(s, out, ctx);
    // Posiciones
    if (/^change /i.test(s)) return positionClause(s, out, ctx);
    if ((m = s.match(/^(Fusion|Synchro|Xyz|Link|Ritual) Summon (.+)$/i))) return procClause(m, out, ctx);
    // Mágica de Ritual: "This card is used to Ritual Summon "X"" / "...any "Y" Ritual Monster"
    if ((m = s.match(/^This card (?:can be|is) used to Ritual Summon (?:any (?:1 )?|1 )?(.+)$/i))) {
      const fr = parseFilter(m[1]);
      if (!fr.ok) return manual(raw, 'filter');
      return finish(Object.assign(out, { verb: 'procSummon', method: 'ritual', from: ['hand'], filter: fr.filter }));
    }
    if (/^Special Summon (?:\d+|a|an|one|two|three|four|five) "[^"]+ Tokens?"/i.test(s)) return tokenClause(s, out);
    if (/^Special Summon "[^"]+ Tokens?"/i.test(s)) return manual(raw, 'token');
    // Verbos con objeto
    const V = [
      ['addOrSS', /^add to (?:your|the) hand,? or Special Summon,?\s+/i],
      ['ss', /^Special Summon\s+/i],
      ['add', /^add\s+/i],
      ['send', /^send\s+/i],
      ['discard', /^discard\s+/i],
      ['banish', /^banish\s+/i],
      ['destroy', /^destroy\s+/i],
      ['return', /^return\s+/i],
      ['shuffle', /^shuffle\s+/i],
      ['place', /^place\s+/i],
      ['set', /^Set\s+/i],
      ['attach', /^attach\s+/i],
      ['detach', /^detach\s+/i],
      ['tribute', /^Tribute\s+/i],
      ['reveal', /^reveal\s+/i],
      ['target', /^target\s+/i],
    ];
    const hit = V.find(([, re]) => re.test(s));
    if (!hit) return null;
    let verb = hit[0];
    s = s.replace(hit[1], '');
    // "reveal" solo como costo; "target" solo antes del ";"
    if ((verb === 'reveal' || verb === 'target') && !ctx.cost) return manual(raw, 'shape');
    // "Tribute 1 X to discard ...": una cosa para hacer otra
    if (findTop(s, /\bto (?:discard|destroy|banish|draw|add|target|inflict|Special Summon|send|return|negate|change)\b/i)) return manual(raw, 'shape');
    s = applyMods(s, out, LOCK_MODS);
    if (/\brandom(?:ly)?\b/i.test(s)) {
      return /opponent/i.test(s) && !/\byour (?!opponent)/i.test(s) ? note('opp', raw) : manual(raw, 'random');
    }
    s = s.replace(/\s*\(at random\)/i, '');
    // Destino según el verbo
    const dest = (re) => { const x = findTop(s, re); if (!x) return null; s = cut(s, x); return x; };
    if (verb === 'add') { if (!dest(/,? to (?:your|the|its owner's|their owner's|their owners') hands?\b/i)) return manual(raw, 'dest'); }
    else if (verb === 'send') { if (!dest(/,? to the GYs?\b/i)) return manual(raw, 'dest'); }
    else if (verb === 'discard') dest(/,? to the GY\b/i);
    else if (verb === 'return' || verb === 'shuffle') {
      let x;
      if ((x = dest(/,? to (?:the|your|its owner's|their owner's|their owners'|their|the owner's) hands?$/i))) verb = 'returnHand';
      else if ((x = dest(/,? on (?:the )?(top|bottom|top or bottom) of (?:the|your|its owner's|their owners'|the owner's) Decks?(?: in any order)?$/i))) { verb = 'deckTop'; out.deckPos = x[1] === 'top or bottom' ? 'topOrBottom' : x[1]; }
      else if ((x = dest(/,? (?:in)?to (?:the|your|its owner's|their owners'|the owner's|their) (?:Deck(?:\/Extra Deck| or Extra Deck| and\/or Extra Deck)?|Extra Deck)(?: and shuffle(?: it| them)?)?$/i))) { verb = 'returnDeck'; out.deckPos = 'shuffle'; }
      else return manual(raw, 'dest');
    } else if (verb === 'place') {
      let x;
      if ((x = dest(/,? on (?:the )?(top|bottom|top or bottom) of (?:the|your|its owner's|their owners'|the owner's) Decks?(?: in any order)?$/i))) { verb = 'deckTop'; out.deckPos = x[1] === 'top or bottom' ? 'topOrBottom' : x[1]; }
      else if (dest(/,? in your Pendulum Zone$/i)) verb = 'placePZ';
      else if (dest(/,? (?:face-up )?(?:on your field|in your Spell & Trap Zone)(?: as (?:an? )?(?:face-up )?Continuous (?:Spell|Trap)(?: Card)?s?)?$|,? as (?:an? )?face-up Continuous (?:Spell|Trap)(?: Card)?s?$/i)) {
        verb = 'placeST';
        s = s.replace(/,? face-up$/i, '').trim();
      } else return manual(raw, 'dest');
    } else if (verb === 'set') dest(/,? (?:to|on) your field$|,? in your Spell & Trap Zone$/i);
    else if (verb === 'attach') {
      const x = dest(/ to (this card|that monster|it|that target|1 Xyz Monster you control|an Xyz Monster you control|a monster you control) as (?:material|an? Xyz Materials?|Xyz Materials?|its material)s?$/i);
      if (!x) return manual(raw, 'dest');
      out.host = /this card/i.test(x[1]) ? 'this' : /Xyz Monster you control|monster you control/i.test(x[1]) ? 'choose' : 'targets';
    } else if (verb === 'detach') {
      const x = dest(/ from (this card|a monster you control|an Xyz Monster you control|that monster|it)$/i);
      if (!x) return manual(raw, 'dest');
      out.host = /this card/i.test(x[1]) ? 'this' : /you control/i.test(x[1]) ? 'choose' : 'targets';
    }
    if (verb === 'ss' || verb === 'addOrSS') s = applyMods(s, out, SS_MODS);
    if (verb === 'banish') {
      const fd = findTop(s, /\s*\(face-down\)|,? face-down$/i) || s.match(/^\(face-down\)\s*/i);
      if (fd) { s = cut(s, fd); out.faceDown = true; }
      const fu = findTop(s, /\s*\(face-up\)|,? face-up$/i) || s.match(/^\(face-up\)\s*/i);
      if (fu) s = cut(s, fu);
      if (/\buntil the (?:End Phase|end of)/i.test(s)) return manual(raw, 'temporary');
    }
    s = s.replace(/\s*\((?:until the end of (?:this|the next) turn)\)/i, '').replace(/^directly /i, '').trim();
    if (DELAYED.test(s)) {
      const rest = s.replace(/,? during (?:the|this|your|each|the next) (?:next )?(?:End|Standby) Phase(?: of (?:this|the next) turn)?$/i, '').trim();
      return refKind(rest) ? note('delayed', raw) : manual(raw, 'delayed');
    }
    if (/\buntil the (?:End Phase|end of)\b/i.test(s)) return manual(raw, 'temporary');
    // Lugar
    let place = null;
    if (verb === 'target') {
      const x = findTop(s, /,? in your center Main Monster Zone$/i);
      if (x) { place = { areas: ['mzone'], zone: 'center' }; s = cut(s, x); }
    }
    if (!place) {
      place = placeOf(s);
      if (place) {
        if (place.many) return manual(raw, 'place');
        s = place.s;
      }
    }
    s = s.replace(/^directly /i, '').replace(/,$/, '').trim();
    // Dos objetos ("1 X and 1 Y", "both this card and 1 X")
    if (findTop(s, / and (?:\d+|a|an|up to \d+|this card|that)\b|^both this card\b|,? including\b/i)) return manual(raw, 'multi-object');
    // Leftover de origen sin entender ("from your ...")
    if (/\b(?:from|in) (?:your|the|either|their)\b/i.test(s.replace(/"[^"]*"/g, ''))) return manual(raw, 'place');
    // Objeto: referencia
    const rk = refKind(s);
    if (/^(?:that|those|the) opponent's (?:card|monster)s?$|^that (?:card|monster) your opponent controls$/i.test(s)) return note('opp', raw);
    if (rk) {
      if (verb === 'target') return manual(raw, 'ref');
      const b = bindRef(rk, verb, ctx);
      if (b.note) return note('opp', raw);
      if (b.manual) return manual(raw, b.manual);
      Object.assign(out, { verb, refers: b.refers });
      if (b.owner && b.owner !== 'me') out.owner = b.owner;
      if (place && place.areas) {
        const o = ownerOf(verb, place.areas, null);
        if (o.note || o.manual) { if (b.refers === 'this') return manual(raw, 'place'); }
        else if (o.owner === 'me') out.from = place.areas;
      }
      if (verb === 'set' && b.refers === 'this' && ctx.card && db.isMonster(ctx.card)) return manual(raw, 'set-monster');
      if (verb === 'placeST' || verb === 'placePZ' || verb === 'attach') { /* referencias: la carta ya está decidida */ }
      return finish(out);
    }
    // Objeto: cantidad + filtro
    if (verb === 'detach') {
      const dm = s.match(/^(\d+|a|an|one|two) (?:materials?|Xyz Materials?|material)$/i);
      if (!dm) return manual(raw, 'count');
      const n = +dm[1] || NUMW[dm[1].toLowerCase()];
      return finish(Object.assign(out, { verb, count: { min: n, max: n } }));
    }
    let each = false;
    if (/\s+each$/i.test(s)) { each = true; s = s.replace(/\s+each$/i, ''); }
    const co = countOf(s, verb);
    if (!co) return manual(raw, 'object');
    if (co.manual) return manual(raw, co.manual);
    if (/^of\b/i.test(co.rest)) return manual(raw, 'object');
    const fr = parseFilter(co.rest);
    if (!fr.ok) return manual(raw, 'filter');
    Object.assign(out, { verb, count: co.count });
    if (each) out.each = true;
    // Origen
    let areas = place ? place.areas : null;
    if (!areas) {
      if (verb === 'discard' || verb === 'reveal') areas = ['hand'];
      else if (verb === 'tribute') areas = ['field'];
      else if (verb === 'detach') areas = null;
      else return manual(raw, 'no-from');
    }
    if (place && place.bothGy && (co.count.all || verb !== 'target')) return manual(raw, 'both-gy');
    const o = ownerOf(verb, areas, co.count);
    if (o.note) return note('opp', raw);
    if (o.manual) return manual(raw, o.manual);
    if (o.owner !== 'me') out.owner = o.owner;
    out.from = areas;
    if (place && place.zone) out.zone = place.zone;
    out.filter = fr.filter;
    if (verb === 'set' && out.filter.type === 'monster') return manual(raw, 'set-monster');
    if (verb === 'discard' && areas.some((a) => a !== 'hand')) return manual(raw, 'place');
    if (each && !(out.count.min === 0)) return manual(raw, 'count');
    if (co.count.all && verb === 'target') return manual(raw, 'count');
    return finish(out);
  }

  function levelClause(s, out, ctx) {
    const raw = out.text;
    let m;
    const sign = /^(?:reduce|decrease|lower)/i.test(s) ? -1 : 1;
    const t = s.replace(/\s*\(until the end of (?:this|the next) turn\)/i, '').replace(/,? until the end of (?:this|the next) turn$/i, '').trim();
    if ((m = t.match(/^(?:increase|reduce|decrease|lower|raise) the Levels? of all (.+?) (on the field|you control|your opponent controls) by (\d+)$/i))) {
      const fr = parseFilter(m[1]);
      if (!fr.ok) return manual(raw, 'filter');
      const areas = /on the field/i.test(m[2]) ? ['field', 'oppField'] : /opponent/i.test(m[2]) ? ['oppField'] : ['field'];
      if (areas.length === 1 && areas[0] === 'oppField') return note('opp', raw);
      Object.assign(out, { verb: 'level', count: { all: true }, from: areas, filter: fr.filter, amount: sign * +m[3] });
      if (areas.length > 1) out.owner = 'any';
      return finish(out);
    }
    if ((m = t.match(/^(?:increase|reduce|decrease|lower|raise) (its|their|this card's|that monster's|that target's|the target's|those monsters') Levels? by (\d+)$/i))) {
      const kind = /this card's/i.test(m[1]) ? 'this' : /target/i.test(m[1]) ? 'targets' : /^its$/i.test(m[1]) ? 'it' : /^their|those/i.test(m[1]) ? 'them' : 'that';
      const b = bindRef(kind, 'level', ctx);
      if (b.note) return note('opp', raw);
      if (b.manual) return manual(raw, b.manual);
      if (b.owner === 'opp') return note('opp', raw);
      return finish(Object.assign(out, { verb: 'level', refers: b.refers, amount: sign * +m[2] }));
    }
    return manual(raw, /\bATK\b|\bDEF\b/.test(t) ? 'stat' : 'level');
  }

  function positionClause(s, out, ctx) {
    const raw = out.text;
    let m, obj, pos;
    if ((m = s.match(/^change (.+?) to (face-up Attack|face-up Defense|face-down Defense|Attack|Defense) Position$/i))) {
      obj = m[1]; pos = /face-down/i.test(m[2]) ? 'set' : /Attack/i.test(m[2]) ? 'atk' : 'def';
    } else if ((m = s.match(/^change (its|their|that monster's|that target's|this card's) battle positions?$/i))) {
      obj = { its: 'it', their: 'them', "that monster's": 'that monster', "that target's": 'that target', "this card's": 'this card' }[m[1].toLowerCase()] || 'it';
      pos = 'toggle';
    } else if ((m = s.match(/^change the battle positions? of (.+)$/i))) {
      obj = m[1]; pos = 'toggle';
    } else return null;
    const rk = refKind(obj);
    if (!rk) return /opponent/i.test(obj) ? note('opp', raw) : manual(raw, 'object');
    const b = bindRef(rk, 'position', ctx);
    if (b.note || b.owner === 'opp') return note('opp', raw);
    if (b.manual) return manual(raw, b.manual);
    return finish(Object.assign(out, { verb: 'position', refers: b.refers, position: pos }));
  }

  function procClause(m, out, ctx) {
    const raw = out.text;
    let s = m[2];
    out.verb = 'procSummon';
    out.method = m[1].toLowerCase();
    // "Fusion Summon ..., OR Ritual Summon ...": dos invocaciones distintas para elegir → a mano
    if (/\bOR (?:Fusion|Synchro|Xyz|Link|Ritual) Summon\b/i.test(s)) return manual(raw, 'options');
    const tail = findTop(s, /,? (?:using|by using|by Tributing|by banishing|by sending|by shuffling|whose)\b.*$/i);
    if (tail) {
      // Materiales que la banda de materiales no hace así (desterrados, barajados, del Mazo o del Cementerio, del rival, "but ..."): a mano
      if (/\b(?:banish\w*|shuffl\w*|Deck|GY|either field|opponent'?s?|Pendulum Zones?|Spell & Trap Zones?|banishment|but)\b/i.test(tail[0])) return manual(raw, 'materials');
      if (/\bincluding this card\b|\busing (?:only )?this card\b/i.test(tail[0])) out.including = 'this';
      if (/\bduring the End Phase\b/i.test(tail[0])) out._notes.push(note('delayed', tail[0].replace(/^,?\s*/, '')));
      s = cut(s, tail);
    }
    const place = placeOf(s);
    if (place) {
      if (place.many || place.areas.some((a) => OPP_AREAS.includes(a))) return manual(raw, 'place');
      s = place.s;
      out.from = place.areas;
    }
    s = s.replace(/,$/, '').trim();
    const co = countOf(s, 'procSummon');
    if (!co || co.manual || !(co.count.min === 1 && co.count.max === 1)) return manual(raw, 'count');
    const fr = parseFilter(co.rest);
    if (!fr.ok) return manual(raw, 'filter');
    out.filter = fr.filter;
    return finish(out);
  }

  function tokenClause(s, out) {
    const raw = out.text;
    const m = s.match(new RegExp('^Special Summon (\\d+|a|an|one|two|three|four|five) "([^"]+ Token)s?" \\((' + RACE_ITEM + ')\\/(' + ATTR_ITEM + ')\\/Level (\\d+)\\/ATK (\\d+)\\/DEF (\\d+)\\)(?:,? in (face-up Attack|face-up Defense|Attack|Defense) Position)?(?:,? to your field)?$', 'i'));
    if (!m) return manual(raw, 'token');
    const n = +m[1] || NUMW[m[1].toLowerCase()];
    Object.assign(out, { verb: 'token', count: { min: n, max: n }, token: { name: m[2], race: m[3].replace(/-Type$/, ''), attribute: m[4], level: +m[5], atk: +m[6], def: +m[7] } });
    if (m[8]) out.position = /Attack/i.test(m[8]) ? 'atk' : 'def';
    return finish(out);
  }

  /* ---------- Efectos ---------- */
  const OPTIONS = /\b(?:activate|apply|choose) (?:1|one) of (?:these|the following) effects\b/i;
  const LINGER = /^(?:you can )?apply (?:these|the following) effects\b|\bapply (?:the following|these) effects\b/i;
  /** "apply these effects ..." antes de las viñetas → 'linger' (duran: "this turn", "until", "while", o sin más: "apply these
   * effects"), 'seq' (se hacen ahora, en orden: "in sequence", "(simultaneously)") o 'cond' (dependen de algo: "based on",
   * "depending on", "If it is the Main Phase: ..." → a mano). */
  function leadOf(res) {
    const m = String(res || '').match(/([^.●;]*)\bapply (?:these|the following) effects\b([^.●;]*)/i);
    if (!m) return null;
    const pre = m[1].replace(/^.*(?:,? and if (?:you|it|they) do(?: that| so)?,|\bthen,?)\s*/i, '').trim();
    const tail = m[2].replace(/,? also\b.*$/i, '').replace(/[:\s]+$/, '').trim();
    if (/\b(?:this turn|until|while|from the start|for the rest of|this Duel)\b/i.test(pre + ' ' + tail)) return 'linger';
    if (!/^(?:you can)?$/i.test(pre)) return 'cond';
    if (!tail) return 'linger';
    if (/^(?:,?\s*in sequence,?|\(?simultaneously\)?)$/i.test(tail)) return 'seq';
    return 'cond';
  }
  const DESC_BULLETS = /\bany of these effects\b/i;
  const LINKERS = /,? and if (?:you|it|they) do(?: that| so)?,\s*|(?:,\s*|\s+)(?:and\s+)?then,?\s+|,\s*also,?\s+|\s+also,\s+/i;

  /** { head, cost, res, bullets } del texto del efecto (sin la condición). */
  function partsOf(e) {
    let s = norm(e.text);
    let bullets = [];
    const bi = s.indexOf(' ● ');
    if (bi >= 0) { bullets = s.slice(bi + 3).split(' ● ').map((x) => x.trim()).filter(Boolean); s = s.slice(0, bi); }
    let at = 0;
    const cond = e.condition ? norm(e.condition) : '';
    if (cond) {
      const i = s.indexOf(cond);
      const j = i >= 0 ? s.indexOf(':', i + cond.length) : -1;
      if (j >= 0 && j - (i + cond.length) <= 2) at = j + 1;
    }
    if (!at) {
      // "(You do not use ...) Once per turn: ..." u otra aclaración inicial
      const lead = s.match(/^\((?:[^()"]|"[^"]*")*\)\s+(?=[A-Z])/);
      if (lead) s = s.slice(lead[0].length);
    }
    let rest = s.slice(at).trim().replace(/^Once per (?:turn|Chain), /i, '');
    const k = topIndex(rest, ';');
    return { cond, cost: k >= 0 ? rest.slice(0, k).trim() : '', res: (k >= 0 ? rest.slice(k + 1) : rest).trim(), bullets, hasCost: k >= 0 };
  }
  const costClauses = (cost) => (cost ? splitAt(cost.replace(/\.$/, ''), /,? then,?\s+|,?\s+and (?=target\b)/i).map((p) => p.text) : []);
  /** Cláusulas de la resolución → [{ text, dep }] */
  function resClauses(text) {
    const out = [];
    for (const sen of sentencesOf(text)) {
      const t = sen.trim().replace(/\.$/, '');
      if (!t) continue;
      for (const p of splitAt(t, LINKERS)) out.push({ text: p.text, dep: !!(p.sep && /if|then/i.test(p.sep)) });
    }
    return out;
  }

  /** Lee costo + resolución en el plan (o en una opción). */
  function readInto(target, costText, resText, ctx) {
    for (const t of costClauses(costText)) {
      if (OPTIONS.test(t) || /^(?:you can )?activate this effect(?: once per (?:turn|battle|Chain))?$/i.test(clean(t))) continue;
      const x = parseClause(t, Object.assign({}, ctx, { cost: true, prev: null, targets: ctx.allTargets() }));
      // Un costo que no sé pagar nunca se salta: solo las aclaraciones (reglas) quedan como nota
      if (x.kind) { if (x.kind === 'rule' || x.kind === 'info') target.notes.push(x); else target.cost.push(manual(x.text, 'cost-note')); continue; }
      if (x.verb !== 'manual' && !COST_VERBS.includes(x.verb)) { target.cost.push(manual(x.text, 'cost-verb')); continue; }
      takeNotes(x, target);
      if (x.verb === 'target' || (x.verb === 'manual' && /^(?:you can )?target\b/i.test(x.text))) target.targets.push(x);
      else target.cost.push(x);
      if (x.verb !== 'manual' && COST_MOVES.includes(x.verb)) ctx.costMoves = true;
      if (x.verb !== 'manual' && (COST_MOVES.includes(x.verb) || x.verb === 'reveal')) ctx.costPick = (ctx.costPick || 0) + (x.refers ? 2 : 1);
    }
    let prev = null, first = true;
    for (const cl of resClauses(resText)) {
      if (ctx.lingerBullets === 'linger' ? LINGER.test(cl.text) : ctx.lingerBullets === 'seq' && /^(?:you can )?apply (?:these|the following) effects\b/i.test(cl.text)) { first = false; continue; }
      if (ctx.optionsHead && OPTIONS.test(cl.text)) { first = false; continue; }
      const x = parseClause(cl.text, Object.assign({}, ctx, { cost: false, first, prev, lastAction: ctx.lastAction, targets: ctx.allTargets() }));
      first = false;
      if (x.kind === 'treated') {
        const ss = ctx.lastAction;
        if (ss && ss.verb === 'ss') ss.treatedAs = x.treatedAs; else target.notes.push(note('info', x.text));
        continue;
      }
      if (x.kind) { target.notes.push(x); prev = x; continue; }
      if (cl.dep && x.verb !== 'manual') x.dependsOnPrevious = true;
      takeNotes(x, target);
      target.actions.push(x);
      prev = x;
      if (x.verb !== 'manual') ctx.lastAction = x;
    }
  }
  function takeNotes(x, target) {
    if (x._notes) { target.notes.push(...x._notes); delete x._notes; }
  }
  const isAction = (x) => x && x.verb && x.verb !== 'manual';
  const passivePlan = () => ({ passive: true, cost: [], targets: [], actions: [], options: null, notes: [], unknown: [], confidence: 'none', auto: false });
  const emptyPlan = (c, e) => ({ cardId: c ? c.id : null, index: e ? e.index : 0, kind: e ? e.kind : 'activation', passive: false, cost: [], targets: [], actions: [], options: null, notes: [], unknown: [], confidence: 'full', auto: true });

  function build(c, e) {
    const plan = emptyPlan(c, e);
    const p = partsOf(e);
    const descBullets = DESC_BULLETS.test(p.cond) || DESC_BULLETS.test(p.cost) || DESC_BULLETS.test(p.res);
    // Opciones solo cuando se eligen al activar ("Activate 1 of these effects;"); "..., then you can apply 1 of these effects" queda a mano
    const options = !descBullets && p.bullets.length && (OPTIONS.test(p.cost) || /^(?:you can )?(?:activate|apply|choose) (?:1|one) of (?:these|the following) effects\b/i.test(p.res));
    const optionsMid = !descBullets && !options && p.bullets.length && OPTIONS.test(p.res);
    const lead = !descBullets && !options && !optionsMid && p.bullets.length ? leadOf(p.res) : null;
    const linger = lead === 'linger';
    let res = p.res;
    // "Apply these effects in sequence": las viñetas se hacen ahora, como el resto de la resolución
    if (!descBullets && !options && !optionsMid && !linger && lead !== 'cond' && p.bullets.length) res = res.replace(/:\s*$/, '.') + ' ' + p.bullets.map((b) => (/[.]$/.test(b) ? b : b + '.')).join(' ');
    const ctx = {
      // "When ... is activated": "that card" es la carta que se activó (casi siempre del rival)
      // ("When you activate a "Purrely" Quick-Play Spell": "that card" es tuya → no es una nota del rival)
      card: c, hasCost: p.hasCost, respond: /\bactivat/i.test(p.cond.replace(/\bthis card is activated\b/i, ''))
        && (/\bopponent\b/i.test(p.cond) || !/\byou (?:activate|control)\b|\byour\b/i.test(p.cond)),
      // "If this card is sent to the GY: Special Summon it": la condición solo nombra a esta carta
      selfCond: /^(?:during [^,:]+, )?(?:if|when) this (?:set |face-up )?card\b/i.test(p.cond)
        && !/\b(?:monsters?|cards?|it|its|they|them|opponent's|target)\b/i.test(p.cond.replace(/\bthis (?:set |face-up )?card\b/gi, '')),
      lingerBullets: linger ? 'linger' : lead === 'seq' ? 'seq' : null, optionsHead: !!options, costMoves: false, lastAction: null,
      allTargets: () => plan.targets.concat(ctx.optTargets || []),
    };
    readInto(plan, p.cost, options ? '' : res, ctx);
    if (linger) for (const b of p.bullets) plan.notes.push(note('linger', clean(b)));
    if (lead === 'cond') {
      // Viñetas que dependen de algo que no se lee ("based on the number of ..."): todo a mano
      const m = plan.actions.find((x) => x.verb === 'manual' && LINGER.test(x.text));
      if (m) m.text += ': ● ' + p.bullets.map(clean).join(' ● ');
      else plan.actions.push(manual(p.bullets.map(clean).join(' ● '), 'options'));
    }
    if (optionsMid) {
      const m = plan.actions.find((x) => x.verb === 'manual' && OPTIONS.test(x.text));
      if (m) m.text += ': ● ' + p.bullets.map(clean).join(' ● ');
      else plan.actions.push(manual(p.bullets.map(clean).join(' ● '), 'options'));
    }
    if (options) {
      plan.options = p.bullets.map((b) => {
        const o = { text: clean(b), cost: [], targets: [], actions: [], notes: [], unknown: [] };
        const k = topIndex(norm(b), ';');
        const octx = Object.assign({}, ctx, { hasCost: false, lastAction: null, costMoves: ctx.costMoves, optTargets: o.targets });
        octx.allTargets = () => plan.targets.concat(o.targets);
        readInto(o, k >= 0 ? norm(b).slice(0, k) : '', k >= 0 ? norm(b).slice(k + 1) : norm(b), octx);
        fixDiffRef(o, !!(octx.costPick || ctx.costPick), plan.targets.concat(o.targets), plan.cost.concat(o.cost).some((x) => x.verb === 'manual'));
        o.unknown = o.cost.concat(o.targets, o.actions).filter((x) => x.verb === 'manual').map((x) => x.text);
        return o;
      });
    }
    fixDiffRef(plan, !!ctx.costPick, plan.targets, plan.cost.some((x) => x.verb === 'manual'));
    plan.unknown = plan.cost.concat(plan.targets, plan.actions).filter((x) => x.verb === 'manual').map((x) => x.text);
    const all = plan.cost.concat(plan.targets, plan.actions);
    const optAll = plan.options ? [].concat(...plan.options.map((o) => o.cost.concat(o.targets, o.actions))) : [];
    const anyManual = all.concat(optAll).some((x) => x.verb === 'manual');
    const anyAction = all.concat(optAll).some(isAction);
    plan.confidence = !anyManual ? 'full' : anyAction ? 'partial' : 'none';
    plan.auto = plan.confidence !== 'none';
    return plan;
  }
  /** "with a different Attribute" compara con el costo; si el costo no elige cartas pero hay objetivos, con los objetivos;
   * si no hay ninguno de los dos (compara con esta carta o con lo anterior), a mano: no se adivina. */
  function fixDiffRef(plan, costCards, targets, costUnknown) {
    if (costCards) return;
    for (const k of ['actions', 'targets']) {
      plan[k] = plan[k].map((x) => {
        const fs = x.filter ? (x.filter.anyOf || [x.filter]) : [];
        if (!fs.some((f) => f.differentFrom)) return x;
        if (costUnknown || !targets.length || x.verb === 'target') return manual(x.text, 'ref');
        fs.forEach((f) => { if (f.differentFrom) f.differentFrom.ref = 'targets'; });
        return x;
      });
    }
  }

  const cache = new Map();
  /** Plan del efecto (objeto de rules.effectsOf(card) o su índice). */
  function parse(card, effect) {
    const c = card && typeof card === 'object' ? card : db.get(card);
    if (!c) return Object.assign(passivePlan(), { passive: false });
    let e = effect;
    if (typeof e === 'number' || typeof e === 'string') {
      const n = Number(e);
      e = (R().effectsOf ? R().effectsOf(c) : []).find((x) => x.index === n) || (n === 0 ? { index: 0, kind: 'activation', synthetic: true, text: '' } : null);
      if (!e) return Object.assign(passivePlan(), { passive: false });
    }
    if (!e) return Object.assign(passivePlan(), { passive: false });
    if (e.scale || e.synthetic || e.index === 0) return emptyPlan(c, e);
    if (e.kind === 'continuous' || e.kind === 'summon') return Object.assign(passivePlan(), { cardId: c.id, index: e.index, kind: e.kind });
    const key = c.id + ':' + e.index + ':' + (e.optionKey || '');
    const hit = cache.get(key);
    if (hit && hit.desc === c.desc && hit.text === e.text) return hit.plan;
    let plan;
    try { plan = build(c, e); } catch (err) {
      plan = emptyPlan(c, e);
      plan.actions = [manual(String(e.text || ''), 'error')];
      plan.unknown = [String(e.text || '')];
      plan.confidence = 'none'; plan.auto = false;
    }
    cache.set(key, { desc: c.desc, text: e.text, plan });
    return plan;
  }

  /* ---------- Descripción en español ---------- */
  const VERB_ES = {
    add: 'Añade', ss: 'Invoca de modo Especial', addOrSS: 'Añade a la mano o Invoca de modo Especial', send: 'Manda al Cementerio',
    discard: 'Descarta', banish: 'Destierra', destroy: 'Destruye', returnHand: 'Devuelve a la mano', returnDeck: 'Baraja en el Mazo',
    deckTop: 'Pone en el Mazo', set: 'Coloca', placeST: 'Pone boca arriba', placePZ: 'Pone en tu Zona de Péndulo',
    attach: 'Acopla como material', detach: 'Desacopla', tribute: 'Sacrifica', banishTop: 'Destierra de arriba del Mazo',
    millTop: 'Manda de arriba del Mazo al Cementerio', draw: 'Roba', position: 'Cambia la posición de', level: 'Cambia el Nivel de',
    payLP: 'Paga', lpGain: 'Gana', token: 'Invoca', reveal: 'Revela', target: 'Elige como objetivo',
  };
  const FROM_ES = {
    hand: 'de la mano', deck: 'del Mazo', extra: 'del Extra Deck', extraUp: 'boca arriba del Extra Deck', gy: 'del Cementerio',
    ban: 'de entre tus cartas desterradas', field: 'del campo', fieldUp: 'boca arriba de tu campo', mzone: 'de tu Zona de Monstruo',
    stzone: 'de tu Zona de Mágicas y Trampas', pzone: 'de tu Zona de Péndulo', oppField: 'del campo del rival',
    oppGy: 'del Cementerio del rival', oppHand: 'de la mano del rival',
  };
  const REF_ES = { this: 'esta carta', targets: 'el objetivo', previous: 'esa carta', cost: 'la carta del costo' };
  const q = (n) => '«' + n + '»';
  const attrEs = (w) => (db.ATTRIBUTES.find((a) => a[0] === bitOf(ATTRS, w)) || [0, w])[1];
  const raceEs = (w) => (db.RACES.find((a) => a[0] === bitOf(RACES_EN, w)) || [0, w])[1];
  const rangeEs = (r, what) => ('eq' in r ? what + ' ' + r.eq : 'in' in r ? what + ' ' + r.in.join(' o ') : 'min' in r && 'max' in r ? what + ' ' + r.min + ' a ' + r.max : 'max' in r ? what + ' ' + r.max + ' o menos' : what + ' ' + r.min + ' o más');
  const statEs = (r, what) => ('eq' in r ? r.eq + ' ' + what : 'max' in r ? r.max + ' ' + what + ' o menos' : 'min' in r ? r.min + ' ' + what + ' o más' : what);

  function filterEs(f, plural) {
    if (!f) return plural ? 'cartas' : 'carta';
    if (f.anyOf) return f.anyOf.map((g) => filterEs(g, plural)).join(' o 1 ');
    const fem = f.type !== 'monster';
    const pl = (w) => (plural ? w.replace(/(a)$/, 'as').replace(/o$/, 'os') : w);
    const nouns = { monster: pl('monstruo'), card: pl('carta'), spell: pl('Mágica'), trap: pl('Trampa'), spelltrap: plural ? 'Mágicas o Trampas' : 'Mágica o Trampa' };
    const out = [];
    if (f.other) out.push(fem ? 'otra' : 'otro');
    const named = f.names && f.type === 'card' && !f.arch;
    if (!named) out.push(nouns[f.type] || 'carta');
    if (f.sub) out.push(f.sub.map((w) => SUBS[w][1]).join(' o '));
    if (f.kinds) out.push(f.kinds.map((w) => KINDS[w][1]).join(' o '));
    if (f.kindsAll) out.push(f.kindsAll.map((w) => KINDS[w][1]).join(' '));
    if (f.notKinds) out.push(f.notKinds.map((w) => 'no ' + KINDS[w][1]).join(' ni '));
    // El Tipo antes del Atributo: "monstruo Hada de OSCURIDAD"
    if (f.race) out.push(f.race.map(raceEs).join(' o '));
    if (f.attr) out.push('de ' + f.attr.map(attrEs).join(' o '));
    if (f.notAttr) out.push('que no sea ' + f.notAttr.map(attrEs).join(' ni '));
    if (f.level) out.push('de ' + rangeEs(f.level, 'Nivel'));
    if (f.rank) out.push('de ' + rangeEs(f.rank, 'Rango'));
    if (f.link) out.push('de ' + rangeEs(f.link, 'Link'));
    if (f.arch) out.push(f.arch.map(q).join(' o '));
    if (f.notArch) out.push((plural ? 'que no sean ' : 'que no sea ') + f.notArch.map(q).join(' ni '));
    if (f.names) out.push(f.names.map(q).join(' o '));
    if (f.position) out.push(f.position === 'def' ? 'en Defensa' : 'en Ataque');
    if (f.faceUp) out.push('boca arriba');
    if (f.faceDown) out.push('boca abajo');
    if (f.atk) out.push('con ' + statEs(f.atk, 'ATK'));
    if (f.def) out.push('con ' + statEs(f.def, 'DEF'));
    if (f.mentions) out.push('que mencione ' + f.mentions.map(q).join(' o '));
    if (f.differentFrom) out.push('con distinto ' + ({ attribute: 'Atributo original', race: 'Tipo original', name: 'nombre', level: 'Nivel original' })[f.differentFrom.prop]);
    if (f.distinctNames) out.push('con nombres distintos');
    return out.join(' ');
  }
  const countEs = (n) => (!n ? '' : n.all ? 'todas las' : n.min === n.max ? String(n.max) : n.min === 0 ? 'hasta ' + n.max : n.min + ' a ' + n.max);
  const exceptOf = (f) => (f && f.except ? f.except : f && f.anyOf && f.anyOf[f.anyOf.length - 1].except) || null;

  /** Frase en español de una acción, para diálogos y el registro. */
  function describe(a) {
    if (!a) return '';
    if (a.verb === 'manual') return 'Hazlo a mano: ' + q(a.text);
    if (a.verb === 'draw') return 'Roba ' + a.count.max + (a.count.max === 1 ? ' carta' : ' cartas');
    if (a.verb === 'payLP') return a.lp === 'half' ? 'Paga la mitad de tus LP' : 'Paga ' + a.lp + ' LP';
    if (a.verb === 'lpGain') return 'Gana ' + a.lp + ' LP';
    if (a.verb === 'banishTop' || a.verb === 'millTop') return VERB_ES[a.verb] + ' ' + a.count.max + (a.count.max === 1 ? ' carta' : ' cartas') + (a.faceDown ? ' (boca abajo)' : '');
    if (a.verb === 'token') return 'Invoca ' + a.count.max + ' ' + q(a.token.name) + (a.position === 'def' ? ' en Defensa' : '');
    if (a.verb === 'detach') return 'Desacopla ' + a.count.max + (a.count.max === 1 ? ' material' : ' materiales') + (a.host === 'this' ? ' de esta carta' : '');
    let head = a.verb === 'procSummon' ? ((R().METHOD_LABELS || {})[a.method] || a.method) + ' de' : VERB_ES[a.verb] || a.verb;
    let obj;
    const plural = a.count && (a.count.all || a.count.max > 1);
    if (a.refers) obj = REF_ES[a.refers] || 'esa carta';
    else {
      const f = a.filter;
      obj = a.count && a.count.all ? (f && f.type === 'monster' ? 'todos los ' : 'todas las ') + filterEs(f, true) : countEs(a.count) + ' ' + filterEs(f, plural);
    }
    let s = head + ' ' + obj;
    if (a.from && a.from.length) {
      // "on the field" son los dos campos: no dos lugares distintos
      const both = a.from.includes('field') && a.from.includes('oppField');
      const fr = both ? a.from.filter((w) => w !== 'oppField').map((w) => (w === 'field' ? 'del campo (tuyo o del rival)' : FROM_ES[w] || w)) : a.from.map((w) => FROM_ES[w] || w);
      s += ' ' + fr.join(' o ');
    }
    if (a.each) s += ' (de cada lugar)';
    if (a.zone === 'center') s += a.verb === 'target' ? ' (Zona de Monstruo central)' : ' a tu Zona de Monstruo central';
    if (a.verb === 'add') s += ' a la mano';
    if (a.verb === 'level') s += ' (' + (a.amount > 0 ? '+' : '') + a.amount + ')';
    if (a.verb === 'position') s += ': ' + ({ atk: 'en Ataque', def: 'en Defensa', set: 'boca abajo en Defensa', toggle: 'la contraria' })[a.position];
    else if (a.position) s += ({ atk: ' en Ataque', def: ' en Defensa', set: ' boca abajo en Defensa' })[a.position];
    if (a.verb === 'deckTop') s += ({ top: ' (arriba)', bottom: ' (abajo)', topOrBottom: ' (arriba o abajo)' })[a.deckPos] || '';
    if (a.faceDown && a.verb === 'banish') s += ' (boca abajo)';
    if (a.treatedAs) s += ' (se trata como ' + ((R().METHOD_LABELS || {})[a.treatedAs] || a.treatedAs) + ')';
    const ex = exceptOf(a.filter);
    if (ex) s += ', excepto ' + ex.map(q).join(' ni ');
    return s.replace(/\bde el\b/g, 'del').replace(/\ba el\b/g, 'al').replace(/\s+/g, ' ').trim();
  }

  /** ¿Con qué cartas compara "with a different ..."? → 'cost' | 'targets' | null (para saber si faltan esas cartas). */
  const diffRefOf = (f) => (!f ? null : f.anyOf ? f.anyOf.map(diffRefOf).find(Boolean) || null : f.differentFrom ? f.differentFrom.ref : null);
  // Bits de Atributo y Tipo por su nombre en inglés ("EARTH", "Beast"), para las fichas
  const bits = { attr: (w) => bitOf(ATTRS, String(w || '').toUpperCase()), race: (w) => bitOf(RACES_EN, String(w || '').replace(/-Type$/, '')) };
  YGO.effects = { parse, parseClause, parseFilter, match, describe, diffRefOf, bits, AREAS, VERBS, ACTIVATED };
})();
