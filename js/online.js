/* Conexión con la API pública de YGOPRODeck (solo cuando la app se abre como sitio web).
 * Trae las cartas que no están en la base incluida (por ejemplo cartas OCG recién salidas)
 * y completa las búsquedas. Expone window.YGO.online. */
(function () {
  const YGO = (window.YGO = window.YGO || {});
  const db = YGO.db;
  const T = db.T;
  const API = 'https://db.ygoprodeck.com/api/v7/cardinfo.php';

  const RACE = {
    Warrior: 0x1, Spellcaster: 0x2, Fairy: 0x4, Fiend: 0x8, Zombie: 0x10, Machine: 0x20, Aqua: 0x40, Pyro: 0x80,
    Rock: 0x100, 'Winged Beast': 0x200, Plant: 0x400, Insect: 0x800, Thunder: 0x1000, Dragon: 0x2000, Beast: 0x4000,
    'Beast-Warrior': 0x8000, Dinosaur: 0x10000, Fish: 0x20000, 'Sea Serpent': 0x40000, Reptile: 0x80000,
    Psychic: 0x100000, 'Divine-Beast': 0x200000, 'Creator-God': 0x400000, Wyrm: 0x800000, Cyberse: 0x1000000,
    Illusion: 0x2000000,
  };
  const ATTR = { EARTH: 0x1, WATER: 0x2, FIRE: 0x4, WIND: 0x8, LIGHT: 0x10, DARK: 0x20, DIVINE: 0x40 };
  const SUBTYPE = {
    Normal: T.NORMAL, Effect: T.EFFECT, Fusion: T.FUSION, Ritual: T.RITUAL, Spirit: T.SPIRIT, Union: T.UNION,
    Gemini: T.GEMINI, Tuner: T.TUNER, Synchro: T.SYNCHRO, Flip: T.FLIP, Toon: T.TOON, Xyz: T.XYZ,
    Pendulum: T.PENDULUM, Link: T.LINK,
  };
  const ARROWS = {
    'Top-Left': 0x40, Top: 0x80, 'Top-Right': 0x100, Left: 0x8, Right: 0x20,
    'Bottom-Left': 0x1, Bottom: 0x2, 'Bottom-Right': 0x4,
  };

  /** Convierte una carta de YGOPRODeck a la fila compacta de la base. */
  function toRow(c) {
    let type = 0, level = 0, def = c.def ?? 0, race = 0, attr = 0;
    const kind = c.type || '';
    if (/Spell/.test(kind) || /Trap/.test(kind)) {
      type = /Spell/.test(kind) ? T.SPELL : T.TRAP;
      type |= { 'Quick-Play': T.QUICKPLAY, Continuous: T.CONTINUOUS, Equip: T.EQUIP, Field: T.FIELD, Ritual: T.RITUAL, Counter: T.COUNTER }[c.race] || 0;
    } else {
      type = T.MONSTER;
      const words = (c.typeline && c.typeline.length ? c.typeline : kind.replace(/Monster/, '').split(/[\s/]+/));
      for (const w of words) type |= SUBTYPE[w.trim()] || 0;
      if (!(type & (T.NORMAL | T.EFFECT)) && /Effect/.test(kind)) type |= T.EFFECT;
      if (/Normal/.test(kind) && !(type & T.EFFECT)) type |= T.NORMAL;
      race = RACE[c.race] || 0;
      attr = ATTR[c.attribute] || 0;
      if (type & T.LINK) {
        level = c.linkval || 0;
        def = (c.linkmarkers || []).reduce((m, a) => m | (ARROWS[a] || 0), 0);
      } else {
        level = c.level || 0;
      }
      if (c.scale !== undefined && c.scale !== null) level |= (c.scale << 16) | (c.scale << 24);
    }
    const formats = (c.misc_info && c.misc_info[0] && c.misc_info[0].formats) || [];
    let ot = (formats.includes('OCG') ? 1 : 0) | (formats.includes('TCG') ? 2 : 0);
    if (!ot) ot = 3;
    return [c.id, c.name, type, c.atk ?? 0, def, level, race, attr, ot, 0, c.desc || ''];
  }

  async function get(params) {
    const res = await fetch(API + '?' + new URLSearchParams(Object.assign({ misc: 'yes' }, params)));
    if (res.status === 400) return []; // YGOPRODeck responde 400 cuando no hay resultados
    if (!res.ok) throw new Error('YGOPRODeck respondió ' + res.status);
    const json = await res.json();
    return json.data || [];
  }

  let state = 'unknown';
  const listeners = [];
  const online = {
    /** true si el navegador puede llegar a la API de YGOPRODeck. */
    available: () => state === 'ok',
    onChange: (fn) => listeners.push(fn),

    /** Prueba una vez si la API responde (en la vista de claude.ai está bloqueada). */
    probe() {
      if (state !== 'unknown') return;
      state = 'checking';
      const done = (ok) => { state = ok ? 'ok' : 'blocked'; listeners.forEach((fn) => fn(state)); };
      const timer = setTimeout(() => done(false), 8000);
      get({ id: '89631139' })
        .then((d) => { clearTimeout(timer); if (state === 'checking') done(d.length > 0); })
        .catch(() => { clearTimeout(timer); if (state === 'checking') done(false); });
    },

    /** Descarga las cartas cuyos códigos no conoce la base. Devuelve cuántas añadió. */
    async fetchIds(ids) {
      const missing = Array.from(new Set(ids.map(Number))).filter((id) => !db.has(id));
      let added = 0;
      for (let i = 0; i < missing.length; i += 40) {
        const data = await get({ id: missing.slice(i, i + 40).join(',') });
        added += db.add(data.map(toRow));
        // Las ilustraciones alternativas tienen otros códigos; el .ydk puede traer cualquiera
        for (const c of data) for (const img of c.card_images || []) if (img.id !== c.id) db.addAlias(img.id, c.id);
      }
      return added;
    },

    /** Busca cartas por nombre exacto (como vienen en una lista de mazo). Devuelve cuántas añadió. */
    async fetchNames(names) {
      const wanted = Array.from(new Set(names)).filter((n) => !db.findByName(n));
      if (!wanted.length) return 0;
      let added = 0;
      try { added += db.add((await get({ name: wanted.join('|') })).map(toRow)); } catch (e) { /* se intenta una por una */ }
      for (const n of wanted) {
        if (db.findByName(n)) continue;
        try {
          const data = await get({ fname: n.replace(/["“”]/g, '') });
          const key = db.nameKey(n);
          const hit = data.find((c) => db.nameKey(c.name) === key) || (data.length === 1 ? data[0] : null);
          if (hit) {
            added += db.add([toRow(hit)]);
            if (!db.findByName(n)) db.addNameAlias(n, hit.id);
          }
        } catch (e) { /* sin conexión */ }
      }
      return added;
    },

    /** Busca por nombre en YGOPRODeck y añade lo que falte. Devuelve cuántas cartas nuevas añadió. */
    async searchName(text) {
      const data = await get({ fname: text });
      return db.add(data.map(toRow));
    },
  };

  YGO.online = online;
})();
