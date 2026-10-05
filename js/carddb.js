/* Base de datos de cartas: decodifica data/cards.js y ofrece búsqueda y utilidades.
 * Expone window.YGO.db. Lo usan el constructor, la prueba de mano y el campo de juego. */
(function () {
  const YGO = (window.YGO = window.YGO || {});

  const T = {
    MONSTER: 0x1, SPELL: 0x2, TRAP: 0x4, NORMAL: 0x10, EFFECT: 0x20, FUSION: 0x40, RITUAL: 0x80,
    SPIRIT: 0x200, UNION: 0x400, GEMINI: 0x800, TUNER: 0x1000, SYNCHRO: 0x2000, TOKEN: 0x4000,
    QUICKPLAY: 0x10000, CONTINUOUS: 0x20000, EQUIP: 0x40000, FIELD: 0x80000, COUNTER: 0x100000,
    FLIP: 0x200000, TOON: 0x400000, XYZ: 0x800000, PENDULUM: 0x1000000, SPSUMMON: 0x2000000, LINK: 0x4000000,
  };
  const EXTRA_MASK = T.FUSION | T.SYNCHRO | T.XYZ | T.LINK;

  const RACES = [
    [0x1, 'Guerrero'], [0x2, 'Lanzador de Conjuros'], [0x4, 'Hada'], [0x8, 'Demonio'], [0x10, 'Zombi'],
    [0x20, 'Máquina'], [0x40, 'Aqua'], [0x80, 'Piro'], [0x100, 'Roca'], [0x200, 'Bestia Alada'],
    [0x400, 'Planta'], [0x800, 'Insecto'], [0x1000, 'Trueno'], [0x2000, 'Dragón'], [0x4000, 'Bestia'],
    [0x8000, 'Guerrero-Bestia'], [0x10000, 'Dinosaurio'], [0x20000, 'Pez'], [0x40000, 'Serpiente Marina'],
    [0x80000, 'Reptil'], [0x100000, 'Psíquico'], [0x200000, 'Bestia Divina'], [0x400000, 'Dios Creador'],
    [0x800000, 'Wyrm'], [0x1000000, 'Ciberso'], [0x2000000, 'Ilusión'],
  ];
  const ATTRIBUTES = [
    [0x1, 'TIERRA'], [0x2, 'AGUA'], [0x4, 'FUEGO'], [0x8, 'VIENTO'], [0x10, 'LUZ'], [0x20, 'OSCURIDAD'], [0x40, 'DIVINO'],
  ];
  // Subtipos para el filtro: [clave, etiqueta, predicado]
  const SUBTYPES = {
    monster: [
      ['normal', 'Normal', (c) => c.type & T.NORMAL],
      ['effect', 'Efecto', (c) => c.type & T.EFFECT],
      ['ritual', 'Ritual', (c) => c.type & T.RITUAL],
      ['fusion', 'Fusión', (c) => c.type & T.FUSION],
      ['synchro', 'Sincronía', (c) => c.type & T.SYNCHRO],
      ['xyz', 'Xyz', (c) => c.type & T.XYZ],
      ['link', 'Link', (c) => c.type & T.LINK],
      ['pendulum', 'Péndulo', (c) => c.type & T.PENDULUM],
      ['tuner', 'Cantante', (c) => c.type & T.TUNER],
      ['flip', 'Volteo', (c) => c.type & T.FLIP],
      ['spirit', 'Espíritu', (c) => c.type & T.SPIRIT],
      ['union', 'Unión', (c) => c.type & T.UNION],
      ['gemini', 'Géminis', (c) => c.type & T.GEMINI],
      ['toon', 'Toon', (c) => c.type & T.TOON],
      ['main', 'Mazo principal', (c) => !(c.type & EXTRA_MASK)],
      ['extra', 'Extra Deck', (c) => c.type & EXTRA_MASK],
    ],
    spell: [
      ['normal', 'Normal', (c) => !(c.type & (T.QUICKPLAY | T.CONTINUOUS | T.EQUIP | T.FIELD | T.RITUAL))],
      ['quickplay', 'Rápida', (c) => c.type & T.QUICKPLAY],
      ['continuous', 'Continua', (c) => c.type & T.CONTINUOUS],
      ['equip', 'Equipo', (c) => c.type & T.EQUIP],
      ['field', 'Campo', (c) => c.type & T.FIELD],
      ['ritual', 'Ritual', (c) => c.type & T.RITUAL],
    ],
    trap: [
      ['normal', 'Normal', (c) => !(c.type & (T.CONTINUOUS | T.COUNTER))],
      ['continuous', 'Continua', (c) => c.type & T.CONTINUOUS],
      ['counter', 'Contraefecto', (c) => c.type & T.COUNTER],
    ],
  };
  // Flechas Link: bits del campo def
  const LINK_ARROWS = [[0x40, '↖'], [0x80, '↑'], [0x100, '↗'], [0x8, '←'], [0x20, '→'], [0x1, '↙'], [0x2, '↓'], [0x4, '↘']];

  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  // Clave para comparar nombres de cartas escritos a mano o exportados por otros simuladores
  const nameKey = (s) => norm(String(s).replace(/&amp;/g, '&').replace(/[\u201c\u201d\u2033]/g, '"').replace(/[\u2018\u2019]/g, "'"))
    .replace(/\s+/g, ' ').trim();

  const raw = window.YGO_DATA || { fields: [], cards: [], aliases: {} };
  // Fila compacta: [id, nombre, tipo, atk, def, nivel, raza, atributo, ot, setcode, texto]
  const fromRow = (r) => {
    const c = {
      id: r[0], name: r[1], type: r[2], atk: r[3], def: r[4], level: r[5], race: r[6], attribute: r[7],
      ot: r[8], setcode: r[9], desc: r[10],
    };
    c.isLink = !!(c.type & T.LINK);
    c.lv = c.level & 0xff;
    c.scaleL = (c.level >> 24) & 0xff;
    c.scaleR = (c.level >> 16) & 0xff;
    c._name = norm(c.name);
    c._desc = norm(c.desc);
    return c;
  };
  const cards = raw.cards.map(fromRow);
  const byId = new Map(cards.map((c) => [c.id, c]));
  // Cartas descargadas de YGOPRODeck en visitas anteriores (cartas nuevas que no trae la base incluida)
  const EXTRA_KEY = 'simulador-yugioh:extra-cards';
  let extraRows = [];
  try { extraRows = JSON.parse(localStorage.getItem(EXTRA_KEY) || '[]'); } catch (e) { extraRows = []; }
  for (const r of extraRows) {
    if (byId.has(r[0])) continue;
    const c = fromRow(r);
    c.online = true;
    cards.push(c);
    byId.set(c.id, c);
  }
  if (extraRows.length) cards.sort((a, b) => a.name.localeCompare(b.name));
  const aliases = raw.aliases || {};
  const ALIAS_KEY = 'simulador-yugioh:extra-aliases';
  let extraAliases = {};
  try { extraAliases = JSON.parse(localStorage.getItem(ALIAS_KEY) || '{}'); } catch (e) { extraAliases = {}; }
  Object.assign(aliases, extraAliases);
  const banlist = window.YGO_BANLIST || { name: '', limits: {} };
  let nameIndex = null;
  const NAME_ALIAS_KEY = 'simulador-yugioh:name-aliases';
  let nameAliases = {};
  try { nameAliases = JSON.parse(localStorage.getItem(NAME_ALIAS_KEY) || '{}'); } catch (e) { nameAliases = {}; }

  const db = {
    T, RACES, ATTRIBUTES, SUBTYPES, LINK_ARROWS, cards, banlistName: banlist.name, norm,

    /** Añade cartas (filas compactas) que no estaban en la base. Devuelve cuántas eran nuevas. */
    add(rows) {
      let n = 0;
      for (const r of rows) {
        if (byId.has(r[0])) continue;
        const c = fromRow(r);
        c.online = true;
        cards.push(c);
        byId.set(c.id, c);
        extraRows.push(r);
        n++;
      }
      if (n) {
        nameIndex = null;
        cards.sort((a, b) => a.name.localeCompare(b.name));
        try { localStorage.setItem(EXTRA_KEY, JSON.stringify(extraRows)); } catch (e) { /* sin almacenamiento */ }
      }
      return n;
    },
    has: (id) => byId.has(Number(id)) || byId.has(Number(aliases[id])),

    /** Busca una carta por su nombre exacto (sin distinguir mayúsculas, tildes ni comillas tipográficas). */
    findByName(name) {
      if (!nameIndex) nameIndex = new Map(cards.map((c) => [nameKey(c.name), c]));
      const k = nameKey(name);
      return nameIndex.get(k) || byId.get(nameAliases[k]) || null;
    },
    /** Recuerda que un nombre escrito de otra forma corresponde a esta carta. */
    addNameAlias(name, id) {
      nameAliases[nameKey(name)] = Number(id);
      try { localStorage.setItem(NAME_ALIAS_KEY, JSON.stringify(nameAliases)); } catch (e) { /* sin almacenamiento */ }
    },
    nameKey,

    /** Registra una ilustración alternativa (otro código) de una carta ya conocida. */
    addAlias(altId, baseId) {
      if (byId.has(Number(altId)) || aliases[altId]) return;
      aliases[altId] = Number(baseId);
      extraAliases[altId] = Number(baseId);
      try { localStorage.setItem(ALIAS_KEY, JSON.stringify(extraAliases)); } catch (e) { /* sin almacenamiento */ }
    },

    /** Devuelve la carta por código; resuelve ilustraciones alternativas a su carta base. */
    get(id) {
      id = Number(id);
      return byId.get(id) || byId.get(Number(aliases[id])) || null;
    },
    isMonster: (c) => !!(c.type & T.MONSTER),
    isSpell: (c) => !!(c.type & T.SPELL),
    isTrap: (c) => !!(c.type & T.TRAP),
    isExtra: (c) => !!(c.type & T.MONSTER) && !!(c.type & EXTRA_MASK),

    /** Límite de copias según la banlist TCG (3 si no aparece). */
    banLimit(id) {
      const c = db.get(id);
      if (!c) return 3;
      const v = banlist.limits[c.id];
      return v === undefined ? 3 : Math.max(0, v);
    },

    raceName(c) { const r = RACES.find(([b]) => b === c.race); return r ? r[1] : ''; },
    attributeName(c) { const a = ATTRIBUTES.find(([b]) => b === c.attribute); return a ? a[1] : ''; },

    /** Clase de marco para colorear la carta (efecto, fusión, mágica...). */
    frame(c) {
      const t = c.type;
      if (t & T.SPELL) return 'spell';
      if (t & T.TRAP) return 'trap';
      const p = t & T.PENDULUM ? ' pendulum' : '';
      if (t & T.LINK) return 'link';
      if (t & T.XYZ) return 'xyz' + p;
      if (t & T.SYNCHRO) return 'synchro' + p;
      if (t & T.FUSION) return 'fusion' + p;
      if (t & T.RITUAL) return 'ritual' + p;
      if (t & T.NORMAL) return 'normal' + p;
      return 'effect' + p;
    },

    /** Línea de tipo en español, p. ej. "Monstruo de Efecto Sincronía / Cantante". */
    typeLine(c) {
      const t = c.type;
      if (t & T.SPELL) {
        const s = t & T.QUICKPLAY ? 'Rápida' : t & T.CONTINUOUS ? 'Continua' : t & T.EQUIP ? 'de Equipo'
          : t & T.FIELD ? 'de Campo' : t & T.RITUAL ? 'de Ritual' : 'Normal';
        return 'Carta Mágica ' + s;
      }
      if (t & T.TRAP) {
        const s = t & T.CONTINUOUS ? 'Continua' : t & T.COUNTER ? 'de Contraefecto' : 'Normal';
        return 'Carta de Trampa ' + s;
      }
      const parts = [db.raceName(c)];
      const add = (bit, label) => { if (t & bit) parts.push(label); };
      add(T.FUSION, 'Fusión'); add(T.SYNCHRO, 'Sincronía'); add(T.XYZ, 'Xyz'); add(T.LINK, 'Link');
      add(T.RITUAL, 'Ritual'); add(T.PENDULUM, 'Péndulo'); add(T.FLIP, 'Volteo'); add(T.SPIRIT, 'Espíritu');
      add(T.UNION, 'Unión'); add(T.GEMINI, 'Géminis'); add(T.TOON, 'Toon'); add(T.TUNER, 'Cantante');
      add(T.SPSUMMON, 'Invocación Especial');
      parts.push(t & T.EFFECT ? 'Efecto' : t & T.NORMAL ? 'Normal' : '');
      return parts.filter(Boolean).join(' / ');
    },

    /** Texto de nivel/rango/link. */
    levelText(c) {
      if (!(c.type & T.MONSTER)) return '';
      if (c.isLink) return 'LINK-' + c.lv;
      return (c.type & T.XYZ ? 'Rango ' : 'Nivel ') + c.lv;
    },

    statText(c) {
      if (!(c.type & T.MONSTER)) return '';
      const a = c.atk < 0 ? '?' : c.atk;
      if (c.isLink) return 'ATK ' + a;
      return 'ATK ' + a + ' / DEF ' + (c.def < 0 ? '?' : c.def);
    },

    linkArrows(c) {
      return c.isLink ? LINK_ARROWS.filter(([b]) => c.def & b).map(([, s]) => s).join('') : '';
    },

    imageUrl(id, size) {
      return 'https://images.ygoprodeck.com/images/' + (size === 'small' ? 'cards_small/' : 'cards/') + id + '.jpg';
    },

    /**
     * Busca cartas. Los resultados cuyo nombre coincide van primero; luego los que coinciden por texto.
     * f: { text, kind: 'monster'|'spell'|'trap', sub, attribute, race, lvMin, lvMax, atkMin, atkMax,
     *      defMin, defMax, ban: 'forbidden'|'limited'|'semi'|'unlimited', sort: 'name'|'atk'|'def'|'level' }
     */
    search(f) {
      const words = norm((f.text || '').trim()).split(/\s+/).filter(Boolean);
      const subPred = f.kind && f.sub ? (SUBTYPES[f.kind].find(([k]) => k === f.sub) || [])[2] : null;
      const num = (v) => (v === '' || v === undefined || v === null || isNaN(v) ? null : Number(v));
      const lvMin = num(f.lvMin), lvMax = num(f.lvMax), atkMin = num(f.atkMin), atkMax = num(f.atkMax);
      const defMin = num(f.defMin), defMax = num(f.defMax);
      const monsterOnly = f.attribute || f.race || lvMin !== null || lvMax !== null || atkMin !== null
        || atkMax !== null || defMin !== null || defMax !== null;
      const byName = [], byText = [];
      for (const c of cards) {
        if (f.kind === 'monster' && !(c.type & T.MONSTER)) continue;
        if (f.kind === 'spell' && !(c.type & T.SPELL)) continue;
        if (f.kind === 'trap' && !(c.type & T.TRAP)) continue;
        if (subPred && !subPred(c)) continue;
        if (monsterOnly && !(c.type & T.MONSTER)) continue;
        if (f.attribute && c.attribute !== Number(f.attribute)) continue;
        if (f.race && c.race !== Number(f.race)) continue;
        if (lvMin !== null && c.lv < lvMin) continue;
        if (lvMax !== null && c.lv > lvMax) continue;
        if (atkMin !== null && c.atk < atkMin) continue;
        if (atkMax !== null && (c.atk < 0 || c.atk > atkMax)) continue;
        if (defMin !== null && (c.isLink || c.def < defMin)) continue;
        if (defMax !== null && (c.isLink || c.def < 0 || c.def > defMax)) continue;
        if (f.ban) {
          const l = db.banLimit(c.id);
          if (f.ban === 'forbidden' && l !== 0) continue;
          if (f.ban === 'limited' && l !== 1) continue;
          if (f.ban === 'semi' && l !== 2) continue;
          if (f.ban === 'unlimited' && l !== 3) continue;
        }
        if (words.length) {
          if (words.every((w) => c._name.includes(w))) byName.push(c);
          else if (f.inText !== false && words.every((w) => c._desc.includes(w) || c._name.includes(w))) byText.push(c);
        } else byName.push(c);
      }
      const sorter = {
        atk: (a, b) => b.atk - a.atk || a.name.localeCompare(b.name),
        def: (a, b) => b.def - a.def || a.name.localeCompare(b.name),
        level: (a, b) => b.lv - a.lv || a.name.localeCompare(b.name),
      }[f.sort];
      if (sorter) { byName.sort(sorter); byText.sort(sorter); }
      else if (words.length) {
        // Coincidencia exacta y prefijo primero
        const q = words.join(' ');
        const rank = (c) => (c._name === q ? 0 : c._name.startsWith(q) ? 1 : 2);
        byName.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
      }
      return byName.concat(byText);
    },
  };

  YGO.db = db;
})();
