/* Rival con handtraps para practicar combos ("¿mi campo pasa?").
 * Lógica pura, sin DOM: decide si el rival activa una handtrap después de cada jugada tuya y qué hace al resolverse.
 * Todo lo que guarda vive en S.opp (así deshacer lo incluye), se puede pasar a JSON y el azar usa una semilla.
 * Flujo con field.js: observe (cuentas del turno) → consider (¿responde?) → commit (eslabón en S.chain)
 * → resolveLink al resolver la cadena (devuelve operaciones que field.js aplica en tu campo).
 * Expone window.YGO.bot. */
(function () {
  const YGO = (window.YGO = window.YGO || {});
  const db = YGO.db;
  const T = db.T;
  const rules = () => YGO.rules || null;

  /* ---------- Constantes ---------- */
  const MZ = ['emz0', 'emz1', 'mz0', 'mz1', 'mz2', 'mz3', 'mz4'];
  const ST = ['st0', 'st1', 'st2', 'st3', 'st4'];
  const FIELD_ZONES = [...MZ, ...ST, 'fz'];
  const ATTR = { EARTH: 0x1, WIND: 0x8, LIGHT: 0x10 };
  const MODE_LABELS = { smart: 'Inteligente', aggressive: 'Agresivo' };
  const NORMAL_METHODS = ['normal', 'tribute'];
  const SET_METHODS = ['set', 'tributeSet', 'flip'];
  const q = (name) => '«' + name + '»';

  // [nombre, corto, qué corta, rasgos]. when: solo responde al último eslabón ("When ... is activated");
  // trap: se activa desde la mano y queda en el campo mientras está en la cadena; opt: una vez por turno por nombre;
  // act: "solo puedes activar 1 por turno"; narrow: preferencia cuando dos sirven (la más específica primero)
  const DEFS = [
    ['Ash Blossom & Joyous Spring', 'Ash', 'Niega un efecto que añade del Mazo a la mano, Invoca desde el Mazo o manda del Mazo al Cementerio.', { when: true, opt: true, narrow: 10 }],
    ['Infinite Impermanence', 'Imperm', 'Niega los efectos de un monstruo boca arriba hasta el final del turno.', { trap: true, narrow: 0 }],
    ['Effect Veiler', 'Veiler', 'En tu Fase Principal, niega los efectos de un monstruo de Efecto boca arriba hasta el final del turno.', { narrow: 2 }],
    ['Nibiru, the Primal Being', 'Nibiru', 'Si haces 5 invocaciones en el turno, sacrifica todos los monstruos boca arriba y te deja un Token.', { opt: true, narrow: 0 }],
    ['Droll & Lock Bird', 'Droll', 'Si añades una carta del Mazo a la mano, ya no puedes añadir más del Mazo ese turno.', { narrow: 10 }],
    ['Ghost Belle & Haunted Mansion', 'Belle', 'Niega una activación que saca cartas del Cementerio, Invoca desde el Cementerio o destierra del Cementerio.', { when: true, opt: true, narrow: 10 }],
    ['Ghost Ogre & Snow Rabbit', 'Ogre', 'Destruye la carta del campo que activa su efecto (el efecto igual se resuelve).', { when: true, opt: true, narrow: 6 }],
    ['Mulcharmy Fuwalos', 'Fuwalos', 'Roba 1 carta cada vez que Invocas de modo Especial desde el Mazo o el Extra Deck ese turno.', { narrow: 0 }],
    ['D.D. Crow', 'Crow', 'Destierra 1 carta de tu Cementerio.', { narrow: 8 }],
    ['Dominus Impulse', 'Dominus', 'Niega un efecto que Invoca de modo Especial.', { when: true, trap: true, act: true, narrow: 6 }],
  ];
  const HANDTRAPS = {};
  const BY_KEY = new Map();
  for (const [name, short, what, traits] of DEFS) {
    const c = db.findByName(name);
    if (!c) continue;
    const h = { name: c.name, id: c.id, short, what, limit: db.banLimit(c.id) };
    HANDTRAPS[c.name] = h;
    Object.defineProperty(h, 'traits', { value: traits, enumerable: false });
    BY_KEY.set(db.nameKey(c.name), h);
    BY_KEY.set(String(c.id), h);
  }
  const defOf = (x) => (x == null ? null : BY_KEY.get(db.nameKey(String(x))) || BY_KEY.get(String(x)) || null);
  const shortOf = (name) => { const h = defOf(name); return h ? h.short : ''; };
  // Lista por defecto: 3 copias de cada una, o lo que permita la banlist (Droll 2)
  const DEFAULT_POOL = Object.values(HANDTRAPS).map((h) => ({ name: h.name, copies: Math.min(3, h.limit) }));

  // Token de Nibiru: carta virtual (no se guarda ni sale en búsquedas)
  const TOKEN_ID = 27204312;
  const TOKEN_NAME = 'Primal Being Token';
  if (db.addVirtual && !db.get(TOKEN_ID)) {
    db.addVirtual([[TOKEN_ID, TOKEN_NAME, T.MONSTER | T.NORMAL | T.TOKEN, -2, -2, 11, 0x100, ATTR.LIGHT, 3, 0,
      'This card can be used as a "Primal Being Token". (Rock/LIGHT/Level 11. Its ATK/DEF are the combined original ATK/DEF of the monsters Tributed by "Nibiru, the Primal Being".)']]);
  }

  /* ---------- Azar con semilla (mulberry32; el estado es un número en S.opp.rng) ---------- */
  function rand(opp) {
    let t = (opp.rng = (opp.rng + 0x6D2B79F5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function shuffle(opp, arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rand(opp) * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /* ---------- Crear el rival ---------- */
  /** Lista de handtraps válida: solo las soportadas y con copias entre 0 y el límite de la banlist. */
  function normalizePool(pool) {
    const list = Array.isArray(pool) && pool.length ? pool : DEFAULT_POOL;
    const out = [];
    for (const p of list) {
      const h = defOf(p && (p.name || p.id));
      if (!h) continue;
      const n = Math.max(0, Math.min(h.limit, Math.floor(Number(p.copies) || 0)));
      const prev = out.find((x) => x.name === h.name);
      if (prev) prev.copies = Math.min(h.limit, prev.copies + n);
      else out.push({ name: h.name, copies: n });
    }
    // Sin ninguna copia válida (nombres que esta versión no conoce, todo en 0): la lista por defecto
    if (list !== DEFAULT_POOL && !out.some((x) => x.copies > 0)) return normalizePool(DEFAULT_POOL);
    return out;
  }
  const normCount = (n) => (/^2\s*[-–]\s*3$/.test(String(n)) ? '2-3' : Number.isFinite(Number(n)) && Number(n) >= 0 ? Math.min(10, Math.floor(Number(n))) : 2);

  /** opts = { enabled, pool: [{ name, copies }], count: 2 | 3 | '2-3', mode: 'smart' | 'aggressive', seed, forceHand: [nombres], starters: [ids], deckSize } */
  function newOpponent(opts) {
    opts = opts || {};
    const hasSeed = opts.seed !== undefined && opts.seed !== null && opts.seed !== '' && Number.isFinite(Number(opts.seed));
    const seed = hasSeed ? Number(opts.seed) >>> 0 : Math.floor(Math.random() * 4294967296) >>> 0;
    const opp = {
      enabled: opts.enabled !== false, mode: opts.mode === 'aggressive' ? 'aggressive' : 'smart', seed, rng: seed | 0,
      count: normCount(opts.count), pool: normalizePool(opts.pool),
      hand: [], deck: [], gy: [], ban: [], field: [], used: {}, flags: {}, blocked: {}, marks: [],
      starters: (Array.isArray(opts.starters) ? opts.starters : []).map(Number).filter(Boolean),
      summons: 0, windows: 0, adds: 0, acts: 0, ssDeckExtra: 0, drew: 0, turn: null, seq: 0, bias: 0,
      pendingDroll: false, history: [], initialHand: [],
    };
    // Variación pequeña del umbral (modo Inteligente): no todos los rivales esperan lo mismo
    opp.bias = Math.round((rand(opp) - 0.5) * 10);
    const copies = [];
    for (const p of opp.pool) for (let i = 0; i < p.copies; i++) copies.push(p.name);
    const card = (name) => ({ uid: 'o' + (++opp.seq).toString(36), id: HANDTRAPS[name].id });
    let names;
    if (Array.isArray(opts.forceHand) && opts.forceHand.length) {
      names = opts.forceHand.map(defOf).filter(Boolean).map((h) => h.name);
      for (const n of names) { const i = copies.indexOf(n); if (i >= 0) copies.splice(i, 1); }
      shuffle(opp, copies);
    } else {
      shuffle(opp, copies);
      const n = opp.count === '2-3' ? (rand(opp) < 0.5 ? 2 : 3) : opp.count;
      names = copies.splice(0, Math.min(n, copies.length));
    }
    opp.hand = names.map(card);
    opp.initialHand = names.slice();
    // Mazo para robar (Fuwalos): lo que queda de la lista + cartas cualquiera hasta 40
    const deck = copies.map(card);
    const size = Math.max(deck.length, (Number(opts.deckSize) || 40) - opp.hand.length);
    while (deck.length < size) deck.push({ uid: 'o' + (++opp.seq).toString(36), blank: true });
    opp.deck = shuffle(opp, deck);
    return opp;
  }

  /* ---------- Estado del turno ---------- */
  const tsOf = (S) => (S && S.turnState) || {};
  const turnOf = (S) => Number(tsOf(S).turn) || 1;
  const phaseOf = (S) => tsOf(S).phase || 'main1';
  const isMain = (S) => phaseOf(S) === 'main1' || phaseOf(S) === 'main2';
  /** Al cambiar de turno se reinician las cuentas del turno (las OPT usan claves con el turno). */
  function sync(S) {
    const opp = S.opp;
    const turn = turnOf(S);
    if (opp.turn !== turn) {
      opp.turn = turn;
      opp.summons = 0; opp.windows = 0; opp.adds = 0; opp.acts = 0; opp.ssDeckExtra = 0;
      opp.pendingDroll = false;
      opp.marks = [];
    }
    if (!Array.isArray(opp.marks)) opp.marks = [];
    if (!opp.blocked) opp.blocked = {};
    return turn;
  }
  const useKey = (S, key) => key + '@' + turnOf(S);
  const used = (S, key) => Number(S.opp.used[useKey(S, key)]) || 0;
  const spend = (S, key) => { const k = useKey(S, key); S.opp.used[k] = (Number(S.opp.used[k]) || 0) + 1; };

  /* ---------- Tu campo ---------- */
  const topOf = (S, z) => (S && S.zones && Array.isArray(S.zones[z]) ? S.zones[z][0] : null) || null;
  const locate = (S, uid) => { const R = rules(); return R && R.locate ? R.locate(S, uid) : null; };
  /** ¿El costo saca a la carta del campo? ("send 2 face-up cards you control to the GY, including this card", "Tribute this card")
   * Cuando el rival puede responder, ya está en el Cementerio aunque en el tablero siga ahí (el costo lo pagas a mano). */
  const COST_SELF = /\bincluding this card\b|\b(?:send|banish|return|shuffle|Tribute|place)\s+this (?:face-up )?card\b/i;
  const costRemovesSelf = (e) => !!(e && e.cost && COST_SELF.test(String(e.cost).replace(/\b(?:except|other than) this card\b/gi, '')));
  /** uids de tus cartas del campo que ya pagaste como costo de un eslabón de la cadena.
   * "send 2 face-up cards you control ..., including this card" con solo 2 boca arriba: se van las 2. */
  function paidAway(S) {
    const out = new Set();
    for (const l of (S && S.chain) || []) {
      if (!l || l.owner === 'opp' || l.cardAct || l.scale) continue;
      const loc = locate(S, l.uid);
      const e = effectOf(l).e;
      if (!loc || loc.area !== 'field' || loc.index !== 0 || !costRemovesSelf(e)) continue;
      out.add(l.uid);
      const m = /\b(\d+|two|three) face-up cards you control\b[^;]*\bincluding this card\b/i.exec(e.cost);
      if (!m) continue;
      const n = { two: 2, three: 3 }[m[1].toLowerCase()] || Number(m[1]);
      const up = FIELD_ZONES.map((z) => topOf(S, z)).filter((x) => x && !x.faceDown);
      if (up.length <= n) up.forEach((x) => out.add(x.uid));
    }
    return out;
  }
  /** Monstruos boca arriba en tus Zonas de Monstruo: [{ inst, zone, c }] (sin los que se fueron como costo) */
  function faceUpMonsters(S) {
    const out = [];
    const gone = paidAway(S);
    for (const z of MZ) {
      const inst = topOf(S, z);
      if (!inst || inst.faceDown || gone.has(inst.uid)) continue;
      const c = db.get(inst.id);
      if (c && db.isMonster(c)) out.push({ inst, zone: z, c });
    }
    return out;
  }
  /** Lo que Nibiru puede sacrificar: tus monstruos boca arriba, sin los que no le afectan ni se pueden sacrificar. */
  const tributable = (S, h) => faceUpMonsters(S).filter((m) => !shieldOf(S, m.inst, ['affect', 'tribute'], h));
  const controlledCount = (S) => FIELD_ZONES.filter((z) => topOf(S, z)).length;
  const nameById = (id) => { const c = db.get(id); return c ? c.name : 'Carta ' + id; };
  const tokenName = (inst) => (inst && inst.token && inst.token.name) || nameById(inst && inst.id);
  /** ATK/DEF originales (Link: sin DEF; "?": 0; Token: los suyos). */
  function originalStats(inst) {
    if (inst.token) return { atk: Math.max(0, Number(inst.token.atk) || 0), def: Math.max(0, Number(inst.token.def) || 0) };
    const c = db.get(inst.id);
    if (!c) return { atk: 0, def: 0 };
    return { atk: Math.max(0, c.atk), def: c.isLink ? 0 : Math.max(0, c.def) };
  }
  const negatedNow = (S, inst) => !!(inst && inst.negated && Number(inst.negated.turn) === turnOf(S));
  /** ¿Ya gastaste ese efecto este turno? (mismas claves que YGO.rules) */
  function effectSpent(S, e, uid) {
    const t = tsOf(S);
    return (e.opts || []).some((o) => {
      const key = o.perCopy ? String(o.key).replace('copy:', 'copy:' + uid) : o.key;
      return (Number(((o.duel ? t.duel : t.opt) || {})[key]) || 0) >= (Number(o.limit) || 1);
    });
  }

  /* ---------- Protecciones y bloqueos de tus cartas boca arriba ---------- */
  // "Your opponent cannot target this card with card effects", "Cannot be destroyed by battle or card effects",
  // "Unaffected by monster effects", "FIRE Dragon monsters you control are unaffected by your opponent's activated effects"...
  // [tipo, regex, forma]: 'obj' = lo protegido va después del verbo ("cannot target X with"); 'subj' = antes
  const PROT_RES = [
    ['target', /\b(?:your opponent|neither player) cannot target ([^.;]*?) with ([^.;,]*?)effects?\b/gi, 'obj'],
    ['target', /([^.;]*?)\bcannot be targeted by ([^.;,]*?)effects?\b/gi, 'subj'],
    ['destroy', /([^.;]*?)\bcannot be destroyed by (?:battle(?:,? or | and ))?([^.;,]*?)effects?\b/gi, 'subj'],
    ['affect', /([^.;]*?)\bunaffected by (?:the effects of ([^.;,]*)|([^.;,]*?)effects?\b)/gi, 'subj'],
    ['tribute', /([^.;]*?)\bcannot be Tributed\b/gi, 'subj'],
  ];
  const SELF_WHO = /^(?:(?:also|and|then)\s+)?(?:it|this\b[^,]*?\bcard\b.*)?$/i; // "", "it", "this card", "this Fusion Summoned card in the EMZ"...
  /** Texto que aplica la carta en el campo (de un Péndulo, sus efectos de monstruo). */
  const ownText = (c) => { const d = String((c && c.desc) || ''); return db.isMonster(c) && d.includes('[ Monster Effect ]') ? d.split('[ Monster Effect ]').pop() : d; };
  const protCache = new Map();
  /** Protecciones del texto de una carta: [{ kind, self, who, by, sentence }] (solo depende de la carta).
   * No cuenta lo que da un efecto al resolverse ("...; it cannot be destroyed by card effects this turn"). */
  function protectionsOf(c) {
    if (protCache.has(c.id)) return protCache.get(c.id);
    const out = [];
    for (const sentence of ownText(c).split(/\.\s+/)) {
      if (/\bthis turn\b|\buntil the end of\b/i.test(sentence)) continue;
      for (const [kind, re, form] of PROT_RES) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(sentence))) {
          if (!m[0].length) { re.lastIndex++; continue; }
          if (/[:;]/.test(sentence.slice(0, m.index))) continue;
          let who = form === 'obj' ? m[1] : m[1].split(/,\s*/).pop();
          who = who.trim().replace(/\s+(?:is|are|will be)$/i, '').trim();
          const by = kind === 'affect' ? (m[2] || m[3] || '') : (m[2] || '');
          out.push({ kind, self: SELF_WHO.test(who), who, by, sentence });
        }
      }
    }
    protCache.set(c.id, out);
    return out;
  }
  /** ¿La frase ("card effects", "monster effects", "your opponent's activated effects") alcanza a esta handtrap? */
  function covers(phrase, htype) {
    const p = String(phrase || '');
    if (/"/.test(p)) return false; // "unaffected by the effects of \"Clear World\"": solo esa carta
    const mon = /\bmonsters?\b|\bmonster's\b/i.test(p), trap = /\bTraps?\b/i.test(p), spell = /\bSpells?\b/i.test(p);
    if (mon || trap || spell) return htype === 'monster' ? mon : trap;
    return true; // "card effects", "other cards' effects", "your opponent's (activated) effects"
  }
  /** Condiciones de fase o de turno de la oración ("During your Main Phase 1, ..."). Las demás se dan por cumplidas. */
  function condActive(S, sentence) {
    const c = String(sentence || '');
    const p = phaseOf(S);
    if (/\byour opponent's turn\b/i.test(c)) return false; // el rival solo responde en tu turno
    if (/\bMain Phase 1\b/.test(c)) return p === 'main1';
    if (/\bMain Phase 2\b/.test(c)) return p === 'main2';
    if (/\bduring (?:your |the |each )?Main Phase\b/i.test(c)) return p === 'main1' || p === 'main2';
    if (/\bduring (?:your |the )?Battle Phase\b/i.test(c)) return p === 'battle';
    return true;
  }
  const RACE_EN = [['Winged Beast', 0x200], ['Beast-Warrior', 0x8000], ['Divine-Beast', 0x200000], ['Sea Serpent', 0x40000], ['Creator God', 0x400000],
    ['Warrior', 0x1], ['Spellcaster', 0x2], ['Fairy', 0x4], ['Fiend', 0x8], ['Zombie', 0x10], ['Machine', 0x20], ['Aqua', 0x40], ['Pyro', 0x80],
    ['Rock', 0x100], ['Plant', 0x400], ['Insect', 0x800], ['Thunder', 0x1000], ['Dragon', 0x2000], ['Beast', 0x4000], ['Dinosaur', 0x10000],
    ['Fish', 0x20000], ['Reptile', 0x80000], ['Psychic', 0x100000], ['Wyrm', 0x800000], ['Cyberse', 0x1000000], ['Illusion', 0x2000000]];
  const ATTR_EN = { EARTH: 0x1, WATER: 0x2, FIRE: 0x4, WIND: 0x8, LIGHT: 0x10, DARK: 0x20, DIVINE: 0x40 };
  const TYPE_EN = { Fusion: T.FUSION, Synchro: T.SYNCHRO, Xyz: T.XYZ, Link: T.LINK, Ritual: T.RITUAL, Pendulum: T.PENDULUM, Tuner: T.TUNER };
  /** ¿"FIRE Dragon monsters you control", "\"Tenpai Dragon\" monsters you control"... describe a esta carta? (lo que no entiende: sí) */
  function describes(desc, inst, c, srcUid) {
    let d = String(desc || '');
    if (!/\b(?:monsters?|cards?|Spells?|Traps?)\b/i.test(d) || /\byour opponent(?:'s| controls)\b/i.test(d)) return false; // "You are unaffected...
    if (/\bother\b/i.test(d) && inst.uid === srcUid) return false;
    const mon = /\bmonsters?\b/i.test(d);
    if (/\b(?:Spells?|Traps?)\b/.test(d) && !mon) return !db.isMonster(c);
    if (mon && !db.isMonster(c)) return false;
    const names = [];
    d = d.replace(/"([^"]+)"/g, (x, n) => { names.push(n); return ' '; });
    if (names.length && !/\bmentions?\b/i.test(d) && !names.some((n) => c.name.includes(n))) return false;
    const attrs = Object.keys(ATTR_EN).filter((a) => new RegExp('\\b' + a + '\\b').test(d));
    if (attrs.length && !attrs.some((a) => c.attribute & ATTR_EN[a])) return false;
    const races = [];
    for (const [r, bit] of RACE_EN) if (new RegExp('\\b' + r + '\\b').test(d)) { races.push(bit); d = d.replace(new RegExp('\\b' + r + '\\b', 'g'), ' '); }
    if (races.length && !races.some((b) => c.race & b)) return false;
    const types = Object.keys(TYPE_EN).filter((t) => new RegExp('\\b' + t + '\\b(?! Summon)').test(d));
    if (types.length && !types.some((t) => c.type & TYPE_EN[t])) return false;
    return true;
  }
  /** Tus cartas boca arriba que aplican sus efectos (sin las negadas este turno): [{ inst, c }] */
  function activeCards(S) {
    const out = [];
    for (const z of FIELD_ZONES) {
      const inst = topOf(S, z);
      if (!inst || inst.faceDown || inst.token || negatedNow(S, inst)) continue;
      const c = db.get(inst.id);
      if (c && !(ST.includes(z) && db.isMonster(c))) out.push({ inst, c }); // Escala de Péndulo: sus efectos de monstruo no aplican
    }
    return out;
  }
  /** ¿Tu carta inst está protegida de esta handtrap? kinds: ['target', 'affect', 'destroy', 'tribute'].
   * → nombre de la carta que la protege (la misma u otra de tu campo) o '' */
  function shieldOf(S, inst, kinds, h) {
    const c = inst && db.get(inst.id);
    if (!c) return '';
    const htype = isMonsterCard(h) ? 'monster' : 'trap';
    for (const src of activeCards(S)) {
      for (const p of protectionsOf(src.c)) {
        if (!kinds.includes(p.kind) || !covers(p.by, htype) || !condActive(S, p.sentence)) continue;
        if (p.self ? src.inst.uid === inst.uid : describes(p.who, inst, c, src.inst.uid)) return src.c.name;
      }
    }
    return '';
  }
  /** Lo que tus cartas boca arriba no dejan hacer al rival:
   * normalTrap (Lovely Labrynth: sin efectos de monstruos en respuesta a tus Trampas Normales),
   * summon[método] (Branded Lost: nada cuando haces esa invocación), fusionAct (no se niegan tus activaciones que Invocan por Fusión). */
  function responseLocks(S) {
    const out = { normalTrap: '', summon: {}, fusionAct: '' };
    for (const { c } of activeCards(S)) {
      const t = ownText(c);
      if (/\bopponent cannot activate monster effects in response to the activation of your Normal Trap/i.test(t)) out.normalTrap = c.name;
      const m = /\bopponent cannot activate cards or effects when a monster is (Fusion|Synchro|Xyz|Link|Ritual|Special) Summoned\b/i.exec(t);
      if (m) out.summon[m[1].toLowerCase()] = c.name;
      if (/\bactivation of your cards and effects that include an effect that Fusion Summons[^.]*cannot be negated/i.test(t)) out.fusionAct = c.name;
    }
    return out;
  }
  const isNormalTrapAct = (info) => !!(info && info.link.cardAct && info.c && (info.c.type & T.TRAP) && !(info.c.type & (T.CONTINUOUS | T.COUNTER)));

  /* ---------- Leer tu eslabón: qué hace el efecto ---------- */
  function topIndex(s, ch) {
    if (YGO.view && YGO.view.topIndex) return YGO.view.topIndex(s, ch);
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
  /** Carta y efecto del eslabón (YGO.rules.effectsOf con el índice del eslabón). */
  function effectOf(link) {
    const c = link && db.get(link.id);
    if (!c) return { c: null, e: null };
    const R = rules();
    const e = R ? R.effectsOf(c).find((x) => x.index === Number(link.effectIndex)) || null : null;
    return { c, e };
  }
  /** Divide el texto en [antes (condición y costo/objetivo), lo que se resuelve]. Ash no niega costos. */
  function splitEffect(e, fallback) {
    const s = String((e && e.text) || fallback || '');
    let at = 0;
    if (e && e.condition) {
      const i = s.indexOf(e.condition);
      const j = i >= 0 ? s.indexOf(':', i + e.condition.length) : -1;
      if (j >= 0) at = j + 1;
    } else {
      const j = topIndex(s, ':');
      if (j >= 0 && j < topIndex(s + ';', ';')) at = j + 1;
    }
    const rest = s.slice(at);
    const k = topIndex(rest, ';');
    if (k >= 0) at += k + 1;
    return [s.slice(0, at), s.slice(at).trim()];
  }

  const OWNER = "(?:your |the |their |its owner's |your opponent's |either player's |each player's |both players' |either |each |both )?";
  const LIST = '(?:,? and\\/or |,? or |,? and |, |\\/)';
  const DECK_SRC = new RegExp('\\bfrom ' + OWNER + '(?:(?:hand|GYs?|field|banishment|face-up EXTRA|EXTRA)' + LIST + ')*Deck\\b', 'i');
  const DECK_TOP = /\b(?:top|bottom)(?: \d+| few)? cards? of (?:your|their|the|your opponent's|either player's|each player's) Deck\b|\bfrom the top of (?:your|their|the|your opponent's) Deck\b/i;
  // "from your GY" es el origen; "in the GYs" solo cuenta para desterrar ("Banish all cards in the GYs")
  const GY_PLACES = '(?:(?:hand|Deck|field|banishment|face-up EXTRA|EXTRA|Monster Zone|Spell & Trap Zone)' + LIST + ')*GYs?\\b';
  const GY_SRC = new RegExp('\\bfrom ' + OWNER + GY_PLACES, 'i');
  const GY_IN = new RegExp('\\b(?:from|in) ' + OWNER + GY_PLACES, 'i');
  const TARGET_GY = new RegExp('\\btarget\\b[^;]*?\\b(?:in|from) ' + OWNER + '(?:(?:hand|field|banishment)' + LIST + ')*GYs?\\b', 'i');
  // "Special Summon this card from your hand or GY": ese Cementerio es solo el de esta carta (cuenta si se activó ahí)
  const SELF_GY = new RegExp('\\bthis card from ' + OWNER + GY_PLACES, 'gi');
  // Bloqueos que no son parte de lo que hace el efecto ("you cannot Special Summon...", "cards cannot be added from the Main Deck...")
  const NO_SS = /\b(?:cannot|can't|can not|neither player can|nor can)\s+(?:be\s+)?(?:Normal or |Tribute or )?(?:Special Summon|Summon|add|be added|draw)\w*[^.;●]*/gi;
  // Oraciones que son otro efecto dentro del mismo texto: reemplazos ("If a Fusion Monster you control would be destroyed
  // by card effect, you can banish this card from your GY instead") y efectos "While this card is in your GY"
  const SEPARATE = /\bwould\b[^.]*\binstead\b|^While this card is in your (?:GY|Graveyard)\b/i;
  const dropSeparate = (s) => String(s || '').split(/(?<=\.)\s+(?=[A-Z●])/).filter((x) => !SEPARATE.test(x)).join(' ');
  const REF = /\b(?:it|them|that (?:card|monster|target)|those(?: cards| monsters| targets)?|these|the targets?|both|all \d+|all of them)\b/i;
  const clausesOf = (s) => s.split(/(?:\.\s+|;\s*|●\s*|,\s*(?:and if (?:you|it|they) do(?: that)?|then|also)\s*,?\s*|\s+and if (?:you|it|they) do,?\s+)/i)
    .map((x) => x.trim()).filter(Boolean);
  // "for the Special Summon", "treated as a Synchro Summon": sustantivo, no invoca
  const SUMMON_NOUN = /\b(?:the|its|their|a|an|this|that) (?:Special|Fusion|Synchro|Xyz|Link|Ritual|Pendulum) Summon\b/gi;
  const normText = (s) => String(s || '').replace(/Extra Deck/g, 'EXTRA').replace(/Main Deck/g, 'Deck').replace(/Graveyards?/g, 'GY')
    .replace(NO_SS, '').replace(SUMMON_NOUN, '');

  /** Clasifica el texto de un efecto. full: texto completo; res: lo que se resuelve; fromGY: se activó en tu Cementerio.
   * → { addDeck, ssDeck, sendDeck, addGY, ssGY, banishGY, ss, summonProc, draw, self, maybe, ash, belle, dominus } */
  function classifyText(full, res, fromGY) {
    const out = {};
    const f = normText(dropSeparate(full)), r = normText(dropSeparate(res));
    const targetGY = TARGET_GY.test(f);
    // "target 1 card on the field or in either GY": puede que no sea del Cementerio
    const maybeGY = targetGY && /\btarget\b[^;]*\b(?:on the field|you control|your opponent controls)\b[^;]*\bGYs?\b/i.test(f);
    let selfOnly = true;
    for (const cl of clausesOf(r)) {
      const deck = DECK_SRC.test(cl) || DECK_TOP.test(cl);
      const other = cl.replace(SELF_GY, 'this card'); // sin "this card from your hand or GY" (eso lo ve fromGY)
      const gy = GY_SRC.test(other);
      const gyIn = GY_IN.test(other);
      const ref = REF.test(cl) && !/\bbanish (?:it|them) when (?:it|they) leaves?\b/i.test(cl);
      const self = /\bthis card\b/i.test(cl);
      const add = /\badd(?:s|ed)?\b|\breturn\b[^.]*\bto (?:the|your|its owner's|their) hand\b/i.test(cl);
      const toDeck = /\b(?:shuffle|return|place)\b[^.]*\b(?:into|to|on (?:the )?(?:top|bottom) of) (?:the|your|its owner's|their) (?:Deck|EXTRA)\b/i.test(cl);
      const ss = /\bSpecial Summon(?!ed|ing|s\b)/i.test(cl);
      const proc = /\b(?:Fusion|Synchro|Xyz|Link|Ritual|Pendulum) Summon(?!ed|ing|s\b)/i.test(cl);
      const send = /\bsend\b/i.test(cl) && /\bto the GY\b/i.test(cl);
      const banish = /\bbanish(?!ed|ment)/i.test(cl) && !/\bbanish (?:it|them) when (?:it|they) leaves?\b/i.test(cl);
      const hit = (k) => { out[k] = true; };
      if (add && deck) hit('addDeck');
      if (ss && deck) hit('ssDeck');
      if (send && deck) hit('sendDeck');
      if (proc && deck) hit('sendDeck'); // Fusión con materiales del Mazo ("Branded Fusion"): van del Mazo al Cementerio
      if (ss || proc) hit('ss');
      if (proc) hit('summonProc');
      // Robar es añadir del Mazo a la mano (Ash lo niega); no cuenta "Each time ..., draw" (se aplica después, como Maxx "C")
      if (/\bdraws?\b(?! Phases?)/i.test(cl) && !/\b(?:each|every) time\b|\bwhenever\b|\bnormal draw\b/i.test(cl)) hit('draw');
      let gyHit = false;
      if (gy || (targetGY && ref)) {
        if (add || toDeck) { hit('addGY'); gyHit = true; }
        if (ss) { hit('ssGY'); gyHit = true; }
        if (banish) { hit('banishGY'); gyHit = true; }
        if (gyHit && targetGY && ref && !gy && maybeGY) out.maybe = true;
      } else if (gyIn && banish) hit('banishGY');
      if (fromGY && self) {
        if (add || toDeck) { hit('addGY'); out.self = true; }
        if (ss) { hit('ssGY'); out.self = true; }
      } else if (add || ss || send || banish || proc) selfOnly = false;
    }
    // "Excavate/reveal/look at ... your Deck, and if you do, add ..." (la parte de añadir queda en otra cláusula)
    if ((/\bexcavat/i.test(r) || /\b(?:reveal|look at)\b[^.;]*\bDeck\b/i.test(r)) && /\badd\b/i.test(r)) out.addDeck = true;
    out.selfOnly = !!out.self && selfOnly;
    out.ash = !!(out.addDeck || out.ssDeck || out.sendDeck || out.draw);
    out.belle = !!(out.addGY || out.ssGY || out.banishGY);
    out.dominus = !!out.ss;
    out.targetGY = targetGY;
    return out;
  }

  /** De dónde se activó el eslabón: link.from (lo pone field.js) o donde está la carta ahora. */
  function fromOf(S, link) {
    if (link.from) return link.from;
    const loc = locate(S, link.uid);
    if (!loc) return null;
    return loc.area === 'field' || loc.area === 'material' ? loc.zone : loc.area;
  }
  /** ¿Una carta del campo activó su efecto (no la activación de la carta) y sigue ahí? → 'monster' | 'spelltrap' | null */
  function onFieldActivation(S, link, c, e) {
    if (!c || link.cardAct || link.scale || Number(link.effectIndex) === 0 || (e && e.kind === 'activation')) return null;
    const loc = locate(S, link.uid);
    if (!loc || loc.area !== 'field' || loc.index !== 0 || loc.inst.faceDown) return null;
    if (costRemovesSelf(e)) return null; // se fue del campo como costo: nada que destruir ni negar en el campo
    let zone = link.from || null;
    if (zone && !FIELD_ZONES.includes(zone)) return null;
    if (!zone) {
      if (e && Array.isArray(e.where) && !e.where.includes('field') && !e.where.includes('pendulum')) return null;
      zone = loc.zone;
    }
    if (MZ.includes(zone) && db.isMonster(c) && !(e && e.pendulum)) return 'monster';
    if (ST.includes(zone) || zone === 'fz') return 'spelltrap';
    return null;
  }

  /** Todo lo que el rival necesita saber de un eslabón tuyo. */
  function linkInfo(S, link, index) {
    const { c, e } = effectOf(link);
    const from = fromOf(S, link);
    const [pre, res] = e && !e.synthetic ? splitEffect(e, link.text) : ['', ''];
    const full = e ? e.text : '';
    const cls = e && !e.synthetic && !link.scale ? classifyText(full, res, from === 'gy') : {};
    // "(You can) activate 1 of these effects": el modo se elige al activar. Ash/Belle/Dominus solo si sirven contra ese modo
    // (link.mode, índice desde 0) o, sin saberlo, contra todos
    if (cls.ash || cls.belle || cls.dominus) {
      const fb = full.split('●');
      if (/\bactivate 1 of these effects\b/i.test(fb[0]) && fb.length > 2) {
        const per = fb.slice(1).map((b) => {
          const k = topIndex(b, ';');
          return classifyText(fb[0] + ' ● ' + b, k >= 0 ? b.slice(k + 1) : b, from === 'gy');
        });
        const pick = Number.isInteger(link.mode) && per[link.mode] ? [per[link.mode]] : per;
        for (const k of ['ash', 'belle', 'dominus']) cls[k] = pick.every((x) => x[k]);
      }
    }
    return {
      index, link, c, e, from, res, pre, cls,
      onField: onFieldActivation(S, link, c, e),
      cannotNegate: /\bcannot be negated\b/i.test(full),
      // "Neither player can activate cards or effects in response to this card's activation" (Super Polymerization)
      noResponse: /\b(?:neither player can|your opponent cannot|your opponent can't) activate[^.]*in response to (?:this|that|the)[^.]*activation/i.test(full),
    };
  }
  /** Clasificación pública (pruebas y pistas): bot.classify(S, índice o eslabón). */
  function classify(S, x) {
    const link = typeof x === 'number' ? S.chain[x] : x;
    if (!link) return null;
    const info = linkInfo(S, link, typeof x === 'number' ? x : (S.chain || []).indexOf(link));
    return Object.assign({ onField: info.onField, from: info.from, cannotNegate: info.cannotNegate, noResponse: info.noResponse }, info.cls,
      { ogre: !!info.onField, crow: !!(info.cls.self && info.from === 'gy') });
  }

  /* ---------- Puntaje (modo Inteligente) ---------- */
  const CATS = [
    ['ssDeck', 40, 'Invoca desde el Mazo'],
    ['addDeck', 32, 'Busca una carta del Mazo'],
    ['ssGY', 30, 'Invoca desde el Cementerio'],
    ['summonProc', 30, 'Hace una invocación desde el Extra Deck'],
    ['ss', 25, 'Invoca un monstruo'],
    ['sendDeck', 22, 'Manda cartas del Mazo al Cementerio'],
    ['addGY', 22, 'Recupera cartas del Cementerio'],
    ['banishGY', 15, 'Destierra del Cementerio'],
    ['draw', 15, 'Roba cartas'],
  ];
  /** Cuánto daño hace cortar este eslabón: { score, reasons } */
  function impact(S, info, isNew) {
    const opp = S.opp;
    const cls = info.cls || {};
    const reasons = [];
    let score = 12, extra = 0, found = false;
    for (const [k, v, label] of CATS) {
      if (!cls[k]) continue;
      if (!found) { score = v; reasons.push(label); found = true; } else extra += 4;
    }
    score += Math.min(extra, 8);
    if (cls.maybe) score = Math.round(score * 0.6);
    if (info.c && opp.starters.includes(info.c.id)) { score += 35; reasons.unshift('Es tu starter ★'); }
    if (isNew && opp.acts === 1) { score += 15; reasons.push('Es el primer efecto de tu turno'); }
    // Un monstruo más (o buscarlo) alarga el combo
    if (cls.ss || ((cls.addDeck || cls.addGY) && /\bmonsters?\b/i.test(info.res))) score += 8;
    const h = Array.isArray(S.hand) ? S.hand.length : 5;
    if (h < 3) { score += (3 - h) * 5; reasons.push('Te quedan pocas cartas en la mano'); }
    return { score, reasons };
  }
  /** ¿Te queda una Fase Principal este turno? (en la Fase Final ya no usas efectos de Ignición) */
  const mainLeft = (S) => phaseOf(S) !== 'end';
  /** Efectos que el monstruo todavía puede activar en el campo este turno (Ignición o Rápidos, sin gastar). */
  function threat(S, inst, c) {
    const R = rules();
    let n = 0, cont = 0;
    if (!R || !c) return { n, cont };
    const main = mainLeft(S);
    for (const e of R.effectsOf(c)) {
      if (e.pendulum) continue;
      if (e.kind === 'continuous') { if (main) cont++; continue; }
      if (e.kind !== 'ignition' && e.kind !== 'quick') continue;
      if (e.kind === 'ignition' && !main) continue;
      if (Array.isArray(e.where) && !e.where.includes('field')) continue;
      if (/During your opponent's turn/i.test(e.condition || '')) continue;
      if (effectSpent(S, e, inst.uid)) continue;
      n++;
    }
    return { n, cont };
  }
  /** Eslabones tuyos (sin negar) de este monstruo activados en el campo. */
  function linkedLinks(S, uid) {
    const out = [];
    (S.chain || []).forEach((l, i) => {
      if (!l || l.owner === 'opp' || l.negated || l.uid !== uid) return;
      const info = linkInfo(S, l, i);
      if (info.onField === 'monster') out.push(info);
    });
    return out;
  }
  /** Lo que ya apuntan los eslabones del rival en la cadena (para no gastar dos handtraps en lo mismo). */
  function pendingTargets(S) {
    const links = new Set(), uids = new Set();
    for (const l of S.chain || []) {
      if (!l || l.owner !== 'opp' || !l.target) continue;
      if (l.target.link != null) links.add(Number(l.target.link));
      if (l.target.uid) uids.add(l.target.uid);
    }
    return { links, uids };
  }

  /* ---------- D.D. Crow: efectos del Cementerio que siguen vivos ---------- */
  // "If this card is sent to the GY, or banished": desterrarla también la activa
  const BANISH_TRIGGER = /\bthis card is (?:[^.:]*\b)?banished\b|\bor banished\b/i;
  // "If this card is sent to the GY / destroyed / used as material": ese momento ya pasó
  const PAST_TRIGGER = /\bthis card (?:is|was) (?:sent|banished|destroyed|discarded|detached|Tributed|used|returned|shuffled|removed)\b/i;
  /** ¿Un efecto de Activación (trigger) en el Cementerio todavía puede activarse este turno? */
  const liveGyTrigger = (S, e) => {
    const cond = String(e.condition || '');
    if (PAST_TRIGGER.test(cond)) return false;
    return phaseOf(S) !== 'end' || /\bEnd Phase\b/i.test(cond);
  };

  /* ---------- ¿Puede activar esta handtrap ahora? ---------- */
  const isMonsterCard = (h) => { const c = db.get(h.id); return !!(c && db.isMonster(c)); };
  function canUse(S, h, ev) {
    const opp = S.opp;
    const traits = h.traits;
    const turn = turnOf(S);
    if (opp.blocked[h.name] != null && Number(opp.blocked[h.name]) >= turn) return false;
    if (traits.opt && used(S, 'opt:' + h.name)) return false;
    if (traits.act && used(S, 'act:' + h.name)) return false;
    // Dominus desde la mano: el rival ya no activa efectos de monstruos LUZ, TIERRA ni VIENTO en el Duelo
    if (opp.flags.dominusFromHand && isMonsterCard(h)) {
      const c = db.get(h.id);
      if (c.attribute & (ATTR.LIGHT | ATTR.EARTH | ATTR.WIND)) return false;
    }
    switch (h.short) {
      case 'Imperm': return opp.field.length === 0;
      case 'Veiler': return isMain(S);
      case 'Nibiru': return isMain(S) && opp.summons >= 5 && tributable(S, h).length > 0;
      // Con el bloqueo ya puesto (o un Droll en la cadena) otro Droll no hace nada
      case 'Droll': return phaseOf(S) !== 'draw' && ((ev.type === 'add' && ev.from === 'deck') || (ev.type === 'resolved' && opp.pendingDroll))
        && !(tsOf(S).locks || []).some((l) => l && l.kind === 'noDeckAdd') && !(S.chain || []).some((l) => l && l.owner === 'opp' && l.handtrap === h.name);
      case 'Fuwalos': return opp.field.length === 0 && !used(S, 'mulcharmy');
      case 'Dominus': return controlledCount(S) > 0;
      default: return true;
    }
  }
  const holdsLightEarthWind = (S, except) => S.opp.hand.some((x) => {
    if (x.blank || x.uid === except) return false;
    const c = db.get(x.id);
    return c && db.isMonster(c) && !!(c.attribute & (ATTR.LIGHT | ATTR.EARTH | ATTR.WIND));
  });

  /** Todas las respuestas posibles en esta ventana: [{ name, uid, target, score, reasons, text }] */
  function options(S, ev) {
    const opp = S && S.opp;
    if (!opp || !opp.enabled || !ev) return [];
    if (tsOf(S).mine === false) return [];
    sync(S);
    const chain = Array.isArray(S.chain) ? S.chain : [];
    const last = chain[chain.length - 1] || null;
    let lastInfo = null;
    if (ev.type === 'activation') {
      if (!last || last.owner === 'opp' || last.negated) return [];
      if ((Number(last.speed) || 1) >= 3) return [];
      lastInfo = linkInfo(S, last, chain.length - 1);
      if (lastInfo.noResponse) return [];
    } else if (chain.length) return []; // en medio de la resolución no hay ventana
    // Tus cartas que no dejan responder (Branded Lost al Invocar por Fusión; Lovely Labrynth a tus Trampas Normales)
    const locks = responseLocks(S);
    if (ev.type === 'summon') {
      const m = String(ev.method || 'special').toLowerCase();
      if (locks.summon[m] || (locks.summon.special && !NORMAL_METHODS.includes(m) && !SET_METHODS.includes(m))) return [];
    }
    const noMonsters = ev.type === 'activation' && locks.normalTrap && isNormalTrapAct(lastInfo);
    // "When ... is activated": solo justo después del eslabón recién declarado
    // (si el monstruo ya tiene los efectos negados este turno, su eslabón se resuelve negado: no gasta nada en él)
    const lastNegated = lastInfo && lastInfo.onField === 'monster' && negatedNow(S, (locate(S, last.uid) || {}).inst);
    const whenInfo = lastInfo && !lastNegated && Number(ev.link) === chain.length - 1 ? lastInfo : null;
    const pend = pendingTargets(S);
    const out = [];
    const seen = new Set();
    for (const card of opp.hand) {
      if (card.blank) continue;
      const h = defOf(card.id);
      if (!h || seen.has(h.name)) continue;
      seen.add(h.name);
      if (!canUse(S, h, ev)) continue;
      if (noMonsters && isMonsterCard(h)) continue;
      const add = (o) => out.push(Object.assign({ name: h.name, short: h.short, uid: card.uid, id: h.id }, o));
      const w = whenInfo && !pend.links.has(whenInfo.index) ? whenInfo : null;
      const cname = (info) => q(info.c ? info.c.name : '?');
      const cl = (info) => ' (CL' + (info.index + 1) + ')';
      switch (h.short) {
        case 'Ash':
        case 'Belle':
        case 'Dominus': {
          if (!w || w.cannotNegate) break;
          const key = { Ash: 'ash', Belle: 'belle', Dominus: 'dominus' }[h.short];
          if (!w.cls[key]) break;
          // Branded Lost: no se puede negar la activación de tus cartas que Invocan por Fusión (Belle niega la activación)
          if (h.short === 'Belle' && locks.fusionAct && w.cls.summonProc && /\bFusion Summon/i.test(w.res)) break;
          const im = impact(S, w, true);
          // Belle contra tu Called by the Grave que apunta a una handtrap del rival en la cadena
          const guard = h.short === 'Belle' && opp.marks.find((m) => m.link === w.index && m.kind === 'cbtg' && pendingHist(opp, m.uid));
          if (guard) { im.score = Math.max(im.score, 85); im.reasons.unshift('Protege su ' + q(guard.name) + ' de tu ' + q(guard.by)); }
          if (h.short === 'Dominus' && holdsLightEarthWind(S, card.uid)) im.score -= 15;
          const verb = h.short === 'Belle' ? 'niega la activación de ' : 'niega el efecto de ';
          add({ target: { link: w.index, uid: w.link.uid }, score: im.score, reasons: im.reasons, on: 'el efecto de ' + cname(w) + cl(w),
            text: verb + cname(w) + cl(w) });
          break;
        }
        case 'Ogre': {
          if (!w || !w.onField) break;
          if (shieldOf(S, (locate(S, w.link.uid) || {}).inst, ['affect', 'destroy'], h)) break; // no la puede destruir
          const st = w.onField === 'spelltrap';
          const th = threat(S, { uid: w.link.uid }, w.c);
          let score = 30;
          const reasons = [st ? 'Saca tu Mágica/Trampa del campo' : 'Saca a tu monstruo del campo'];
          if (opp.starters.includes(w.c.id)) { score += 20; reasons.unshift('Es tu starter ★'); }
          if (w.c && db.isExtra(w.c)) score += 10;
          if (th.n > 1) score += 8;
          add({ target: { link: w.index, uid: w.link.uid }, score, reasons, on: cname(w) + cl(w), text: 'destruye ' + cname(w) + ' (su efecto igual se resuelve)' });
          break;
        }
        case 'Veiler':
        case 'Imperm': {
          for (const m of faceUpMonsters(S)) {
            if (negatedNow(S, m.inst) || pend.uids.has(m.inst.uid) || m.inst.token) continue;
            if (h.short === 'Veiler' && !(m.c.type & T.EFFECT)) continue;
            if (shieldOf(S, m.inst, ['target', 'affect'], h)) continue; // "cannot target", "unaffected by"...
            const th = threat(S, m.inst, m.c);
            const linked = linkedLinks(S, m.inst.uid).filter((x) => !pend.links.has(x.index));
            let score, reasons, link = null;
            if (linked.length) {
              const best = linked.map((x) => ({ x, im: impact(S, x, x.index === chain.length - 1 && ev.type === 'activation') }))
                .sort((a, b) => b.im.score - a.im.score)[0];
              link = best.x;
              score = best.im.score + 5 + (th.n > 1 ? 8 : 0);
              reasons = best.im.reasons;
            } else {
              // Antes de que lo use: solo vale si le quedan efectos para este turno
              if (!th.n && !th.cont) continue;
              score = 12 + 10 * Math.min(2, th.n) + (th.cont ? 5 : 0) + (db.isExtra(m.c) ? 5 : 0);
              reasons = [th.n ? 'Le quedan efectos por usar este turno' : 'Apaga sus efectos continuos'];
              if (opp.starters.includes(m.c.id)) { score += 20; reasons.unshift('Es tu starter ★'); }
            }
            const name = q(m.c.name);
            add({ target: link ? { uid: m.inst.uid, link: link.index } : { uid: m.inst.uid }, score, reasons,
              on: name + (link ? cl(link) : ''),
              text: 'niega los efectos de ' + name + ' hasta el final del turno' + (link ? ', también el que está en la cadena' + cl(link) : '') });
          }
          break;
        }
        case 'Crow': {
          const gy = Array.isArray(S.gy) ? S.gy : [];
          const inGy = (uid) => gy.some((x) => x.uid === uid);
          let best = null;
          // Tu efecto en el Cementerio que usa "this card" (o con objetivos ahí): desterrarla lo deja sin nada
          if (lastInfo && lastInfo.cls.self && lastInfo.from === 'gy' && inGy(lastInfo.link.uid)) {
            const im = impact(S, lastInfo, ev.type === 'activation');
            best = { target: { uid: lastInfo.link.uid, link: lastInfo.index }, score: im.score, reasons: im.reasons, on: cname(lastInfo) + cl(lastInfo) };
          }
          chain.forEach((l, i) => {
            if (best || !l || l.owner === 'opp' || l.negated || !Array.isArray(l.targets)) return;
            const tu = l.targets.find(inGy);
            if (!tu) return;
            const info = linkInfo(S, l, i);
            const im = impact(S, info, false);
            best = { target: { uid: tu, link: i }, score: im.score, reasons: im.reasons, on: q(nameById(gy.find((x) => x.uid === tu).id)) + cl(info) };
          });
          if (!best) {
            // Sin eslabón: la carta de tu Cementerio con un efecto que todavía puede usar
            const R = rules();
            for (const x of gy) {
              const c = db.get(x.id);
              if (!c || !R) continue;
              const all = R.effectsOf(c);
              // Si desterrarla le da un efecto ("If this card is sent to the GY, or banished": Despian Tragedy), no
              if (all.some((e) => e.kind === 'trigger' && BANISH_TRIGGER.test(e.condition || ''))) continue;
              const fx = all.filter((e) => Array.isArray(e.where) && e.where.includes('gy') && !effectSpent(S, e, x.uid)
                && (e.kind === 'quick' || (e.kind === 'ignition' && mainLeft(S)) || (e.kind === 'trigger' && liveGyTrigger(S, e))));
              if (!fx.length) continue;
              let score = fx.some((e) => e.kind !== 'trigger') ? 20 : 14;
              const reasons = ['Le quita un efecto del Cementerio'];
              if (opp.starters.includes(c.id)) { score += 15; reasons.unshift('Es tu starter ★'); }
              if (!best || score > best.score) best = { target: { uid: x.uid }, score, reasons, on: q(c.name) };
            }
          }
          if (best) {
            const gname = q(nameById((gy.find((x) => x.uid === best.target.uid) || {}).id));
            add(Object.assign(best, { text: 'destierra ' + gname + ' de tu Cementerio' + (best.target.link != null ? ' (CL' + (best.target.link + 1) + ' ya no puede usarla)' : '') }));
          }
          break;
        }
        case 'Nibiru': {
          const n = tributable(S, h).length;
          // Con 1 solo monstruo y mano para seguir, espera una ventana o dos a que tengas más en el campo
          const hand = Array.isArray(S.hand) ? S.hand.length : 5;
          const score = n <= 1 && hand >= 3 ? 45 + 8 * n : Math.min(100, 75 + 5 * n);
          add({ target: {}, score, reasons: ['Ya hiciste ' + opp.summons + ' invocaciones este turno'].concat(n > 1 ? ['Sacrifica ' + n + ' monstruos'] : []), on: 'tus ' + opp.summons + ' invocaciones',
            text: 'sacrifica todos los monstruos boca arriba y te deja un ' + q(TOKEN_NAME) });
          break;
        }
        case 'Droll': {
          const first = opp.adds <= 1;
          add({ target: {}, score: first ? 72 : 50, reasons: [first ? 'Es tu primera búsqueda del turno: corta las que siguen' : 'Corta tus próximas búsquedas'],
            on: 'tu carta añadida del Mazo', text: 'este turno ya no puedes añadir cartas del Mazo a la mano' });
          break;
        }
        case 'Fuwalos': {
          if (used(S, 'opt:' + h.name)) break;
          const fresh = opp.ssDeckExtra === 0;
          add({ target: {}, score: fresh ? 95 : Math.max(20, 60 - 10 * opp.ssDeckExtra),
            reasons: [fresh ? 'Antes de que empieces a Invocar desde el Mazo o el Extra Deck' : 'Todavía te quedan invocaciones por hacer'],
            on: 'el inicio de tu turno', text: 'este turno roba 1 carta cada vez que Invocas de modo Especial desde el Mazo o el Extra Deck' });
          break;
        }
        default: break;
      }
    }
    return out;
  }
  /** ¿Esa carta del rival está en la cadena sin resolver? */
  const pendingHist = (opp, uid) => opp.history.some((x) => x.uid === uid && x.pending);

  /* ---------- Decidir ---------- */
  /** Umbral del modo Inteligente: baja con cada ventana que deja pasar y a medida que avanza tu combo
   * (así nunca se guarda la handtrap todo el turno). */
  const threshold = (opp) => Math.max(10, 60 + (Number(opp.bias) || 0) - 10 * (Number(opp.windows) || 0) - 3 * Math.max(0, (Number(opp.acts) || 0) - 1));
  const NARROW = (name) => { const h = defOf(name); return h ? h.traits.narrow : 0; };
  const ORDER = (name) => DEFS.findIndex((d) => d[0] === name);

  /** Después de cada jugada tuya: null o la respuesta del rival (no toca S, salvo las cuentas de S.opp). */
  function consider(S, ev) {
    const opp = S && S.opp;
    if (!opp || !opp.enabled || !ev || tsOf(S).mine === false) return null;
    sync(S);
    const opts = options(S, ev);
    if (ev.type === 'resolved') opp.pendingDroll = false; // Droll solo justo después de añadir
    if (!opts.length) return null;
    opts.sort((a, b) => (b.score + NARROW(b.name)) - (a.score + NARROW(a.name)) || ORDER(a.name) - ORDER(b.name)
      || (Number(b.target.link) || 0) - (Number(a.target.link) || 0));
    let pick = null;
    const thr = threshold(opp);
    if (opp.mode === 'aggressive') pick = opts[0];
    else pick = opts.find((o) => o.score >= thr) || null;
    if (!pick) { opp.windows = (Number(opp.windows) || 0) + 1; return null; }
    const reasons = opp.mode === 'aggressive' ? ['Modo agresivo: la usa en el primer momento en que puede']
      : pick.reasons.slice(0, 2).concat(opp.windows >= 2 ? ['Ya dejó pasar ' + opp.windows + ' momentos: no se la va a guardar'] : []);
    const h = defOf(pick.name);
    const how = h.traits.trap ? ' desde la mano' : '';
    return {
      handtrap: h.name, short: h.short, uid: pick.uid, id: h.id, target: Object.assign({}, pick.target), speed: 2,
      text: 'El rival activa ' + q(h.name) + how + ': ' + pick.text,
      reason: reasons.filter(Boolean).join('. ') + '.',
      on: pick.on, score: pick.score, threshold: opp.mode === 'aggressive' ? null : thr, mode: opp.mode,
    };
  }

  /* ---------- Activar ---------- */
  function takeFrom(list, uid) {
    const i = list.findIndex((x) => x.uid === uid);
    return i >= 0 ? list.splice(i, 1)[0] : null;
  }
  /** Activa la respuesta: paga el costo, anota los límites y pone el eslabón en S.chain. Devuelve la entrada del registro. */
  function commit(S, r) {
    const opp = S && S.opp;
    if (!opp || !r) return null;
    sync(S);
    const h = defOf(r.handtrap);
    const card = h && opp.hand.find((x) => x.uid === r.uid);
    if (!card) return null;
    const turn = turnOf(S);
    if (h.traits.trap) { takeFrom(opp.hand, card.uid); card.onChain = true; opp.field.push(card); } // Trampa desde la mano: al campo mientras se resuelve
    else if (h.short === 'Nibiru') card.onChain = true; // queda en la mano (revelada) hasta resolverse
    else { takeFrom(opp.hand, card.uid); opp.gy.push(card); } // descartarla / mandarla al Cementerio es el costo
    if (h.traits.opt) spend(S, 'opt:' + h.name);
    if (h.traits.act) spend(S, 'act:' + h.name);
    if (h.short === 'Fuwalos') { spend(S, 'mulcharmy'); spend(S, 'opt:' + h.name); }
    if (h.short === 'Dominus') opp.flags.dominusFromHand = true;
    if (h.short === 'Droll') opp.pendingDroll = false;
    if (!Array.isArray(S.chain)) S.chain = [];
    const n = S.chain.length + 1;
    opp.history.push({ turn, name: h.name, uid: card.uid, on: r.on || '', reason: r.reason || '', negated: false, pending: true, resolved: false, cl: n });
    const what = String(r.text || '').replace(/^El rival activa «[^»]+»(?: desde la mano)?: /, '');
    S.chain.push({
      owner: 'opp', uid: card.uid, id: h.id, effectIndex: 1, text: what.charAt(0).toUpperCase() + what.slice(1), speed: 2, kind: 'quick',
      handtrap: h.name, target: Object.assign({}, r.target), from: 'hand', hist: opp.history.length - 1,
    });
    opp.windows = 0; // la próxima handtrap vuelve a esperar un buen momento
    const t = tsOf(S);
    return { kind: 'opp', text: r.text + ' · Eslabón ' + n, turn, phase: t.phase, mine: t.mine !== false, handtrap: h.name, uid: card.uid, id: h.id, chainLink: n, reason: r.reason || '' };
  }

  /* ---------- Resolver ---------- */
  /** ¿La condición de tu negación ("when another monster's effect is activated", "when a Spell/Trap Card is activated")
   * alcanza a esta handtrap? "...that includes any of these effects" (Ash, Belle) no se decide solo: queda la marca "Negado". */
  function negatorFits(cond, h) {
    const c = String(cond || '');
    if (!h || /\bincludes?\b/i.test(c)) return false;
    if (/\bcards? or effects?\b/i.test(c)) return true;
    return isMonsterCard(h) ? /\bmonster(?:'s)? effects?\b|\bmonster\b[^.]*\bactivates? its effect/i.test(c) : /\bTraps?\b/.test(c);
  }
  /** ¿Tu respuesta niega este eslabón del rival? → nombre de tu carta o null.
   * (Un efecto que niega, encadenado justo después, o Called by the Grave / Crossout Designator que lo apuntan.) */
  function negatedByPlayer(S, index) {
    const L = S.chain[index];
    const P = S.chain[index + 1];
    if (P && P.owner !== 'opp' && !P.negated) {
      const { c, e } = effectOf(P);
      if (c && e && /activat/i.test(e.condition || '') && /\bnegate (?:the |that |its )?(?:activation|effect)|\bnegate that (?:monster's |card's )?effect/i.test(e.text)
        && negatorFits(e.condition, defOf(L.handtrap || L.id))) return c.name;
    }
    for (const m of S.opp.marks) {
      const ml = S.chain[m.link];
      if (m.link > index && ml && !ml.negated && !m.cancelled && m.uid === L.uid) return m.by;
    }
    return null;
  }
  const histOf = (opp, L) => (L && L.hist != null && opp.history[L.hist] && opp.history[L.hist].uid === L.uid ? opp.history[L.hist]
    : opp.history.find((x) => x.uid === L.uid && x.pending) || null);
  /** La carta del rival deja la cadena: las Trampas activadas van al Cementerio. */
  function leaveChain(opp, uid) {
    const f = opp.field.find((x) => x.uid === uid && x.onChain);
    if (f) { takeFrom(opp.field, uid); delete f.onChain; opp.gy.push(f); return; }
    const hcard = opp.hand.find((x) => x.uid === uid);
    if (hcard) delete hcard.onChain;
  }

  /** Al resolver la cadena (de la última a la primera), para cada eslabón del rival sin negar → operaciones para field.js. */
  function resolveLink(S, index) {
    const opp = S && S.opp;
    const L = S && Array.isArray(S.chain) ? S.chain[index] : null;
    if (!opp || !L || L.owner !== 'opp') return [];
    sync(S);
    const h = defOf(L.handtrap || L.id);
    const by = h ? h.name : String(L.handtrap || '');
    const hist = histOf(opp, L);
    const ops = [];
    const done = (negated) => {
      if (hist) { hist.pending = false; hist.resolved = !negated; if (negated) hist.negated = true; }
      leaveChain(opp, L.uid);
      return ops;
    };
    // Ya marcado como negado en la cadena (lo hizo field.js al resolver tu eslabón): no aplica nada
    if (L.negated) {
      const nb = L.negated && L.negated.by ? ' (por ' + q(L.negated.by) + ')' : '';
      ops.push({ op: 'log', text: 'CL' + (index + 1) + ': ' + q(by) + ' del rival queda negado' + nb + '.' });
      return done(true);
    }
    const neg = negatedByPlayer(S, index);
    if (neg) {
      L.negated = { by: neg };
      ops.push({ op: 'log', text: 'CL' + (index + 1) + ': ' + q(by) + ' del rival queda negado (por ' + q(neg) + ').' });
      return done(true);
    }
    const tgt = L.target || {};
    const tl = tgt.link != null ? S.chain[tgt.link] : null;
    const sameLink = tl && tl.uid === tgt.uid && !tl.negated;
    const tname = (uid) => { const loc = locate(S, uid); return loc ? tokenName(loc.inst) : '?'; };
    switch (h && h.short) {
      case 'Ash':
      case 'Belle': {
        if (sameLink) {
          ops.push({ op: 'negateLink', index: tgt.link, by });
          for (const m of opp.marks) if (m.link === tgt.link) m.cancelled = true;
        } else ops.push({ op: 'log', text: q(by) + ' no hace nada: ese eslabón ya no está o ya fue negado.' });
        break;
      }
      case 'Dominus': {
        if (!sameLink) { ops.push({ op: 'log', text: q(by) + ' no hace nada: ese eslabón ya no está o ya fue negado.' }); break; }
        ops.push({ op: 'negateLink', index: tgt.link, by });
        // "...then if you have a Trap in your GY, destroy that card" (solo si la carta sigue en el campo)
        const trapInGy = opp.gy.some((x) => { const c = !x.blank && db.get(x.id); return c && db.isTrap(c); });
        const loc = locate(S, tl.uid);
        if (trapInGy && loc && loc.area === 'field' && loc.index === 0 && !paidAway(S).has(tl.uid)) {
          const sh = shieldOf(S, loc.inst, ['affect', 'destroy'], h);
          if (sh) ops.push({ op: 'log', text: q(by) + ' no puede destruir ' + q(tname(tl.uid)) + ': está protegida' + (sh !== tname(tl.uid) ? ' (por ' + q(sh) + ')' : '') + '.' });
          else ops.push({ op: 'destroy', uid: tl.uid, by });
        }
        break;
      }
      case 'Ogre': {
        const loc = locate(S, tgt.uid);
        const sh = loc && shieldOf(S, loc.inst, ['affect', 'destroy'], h);
        if (!loc || loc.area !== 'field' || loc.index !== 0 || paidAway(S).has(tgt.uid)) ops.push({ op: 'log', text: q(by) + ' no hace nada: esa carta ya no está en el campo.' });
        else if (sh) ops.push({ op: 'log', text: q(by) + ' no puede destruir ' + q(tname(tgt.uid)) + ': está protegida' + (sh !== tname(tgt.uid) ? ' (por ' + q(sh) + ')' : '') + '.' });
        else ops.push({ op: 'destroy', uid: tgt.uid, by });
        break;
      }
      case 'Veiler':
      case 'Imperm': {
        const loc = locate(S, tgt.uid);
        if (!loc || loc.area !== 'field' || loc.index !== 0 || !MZ.includes(loc.zone) || loc.inst.faceDown || paidAway(S).has(tgt.uid)) {
          ops.push({ op: 'log', text: q(by) + ' no hace nada: ese monstruo ya no está boca arriba en el campo.' });
          break;
        }
        const sh = shieldOf(S, loc.inst, ['target', 'affect'], h);
        if (sh) {
          ops.push({ op: 'log', text: q(by) + ' no le hace nada a ' + q(tname(tgt.uid)) + ': está protegido' + (sh !== tname(tgt.uid) ? ' (por ' + q(sh) + ')' : '') + '.' });
          break;
        }
        ops.push({ op: 'negateMonster', uid: tgt.uid, by });
        // Sus efectos activados en el campo que siguen en la cadena (más abajo) también quedan negados
        for (let j = index - 1; j >= 0; j--) {
          const P = S.chain[j];
          if (!P || P.owner === 'opp' || P.negated || P.uid !== tgt.uid) continue;
          if (onFieldActivation(S, P, db.get(P.id), effectOf(P).e) === 'monster') ops.push({ op: 'negateLink', index: j, by });
        }
        break;
      }
      case 'Crow': {
        const inGy = (S.gy || []).some((x) => x.uid === tgt.uid);
        if (!inGy) { ops.push({ op: 'log', text: q(by) + ' no hace nada: esa carta ya no está en tu Cementerio.' }); break; }
        const name = tname(tgt.uid);
        ops.push({ op: 'banish', uid: tgt.uid, by });
        // Si tu eslabón usaba esa carta ("Special Summon this card"), se queda sin efecto
        if (sameLink) {
          const info = linkInfo(S, tl, tgt.link);
          if ((info.cls.selfOnly && tl.uid === tgt.uid) || (Array.isArray(tl.targets) && tl.targets.includes(tgt.uid))) {
            ops.push({ op: 'negateLink', index: tgt.link, by, fizzle: true });
            ops.push({ op: 'log', text: 'CL' + (tgt.link + 1) + ' ya no puede usar ' + q(name) + ': está desterrada.' });
          }
        }
        break;
      }
      case 'Nibiru': {
        const mons = tributable(S, h);
        if (!mons.length) { ops.push({ op: 'log', text: 'No hay monstruos boca arriba para sacrificar: ' + q(by) + ' no se invoca.' }); break; }
        let atk = 0, def = 0;
        for (const m of mons) { const s = originalStats(m.inst); atk += s.atk; def += s.def; }
        ops.push({ op: 'tributeAll', by, uids: mons.map((m) => m.inst.uid) });
        ops.push({ op: 'token', name: TOKEN_NAME, id: TOKEN_ID, atk, def, level: 11, attribute: ATTR.LIGHT, race: 0x100, position: 'def', by });
        ops.push({ op: 'log', text: q(by) + ' sacrifica ' + mons.length + ' monstruo' + (mons.length === 1 ? '' : 's') + ' y te deja un ' + q(TOKEN_NAME)
          + ' (ATK ' + atk + ' / DEF ' + def + ') en Defensa.' });
        const nib = takeFrom(opp.hand, L.uid);
        if (nib) { delete nib.onChain; opp.field.push(nib); }
        break;
      }
      case 'Droll': {
        const text = 'Por ' + q(by) + ', este turno no se pueden añadir cartas del Mazo a la mano.';
        ops.push({ op: 'lock', lock: { kind: 'noDeckAdd', source: by, text }, by });
        ops.push({ op: 'log', text });
        break;
      }
      case 'Fuwalos': {
        const f = opp.flags.fuwalos;
        opp.flags.fuwalos = { turn: turnOf(S), n: f && Number(f.turn) === turnOf(S) ? (Number(f.n) || 0) + 1 : 1 };
        ops.push({ op: 'log', text: 'Este turno el rival roba 1 carta cada vez que Invocas de modo Especial desde el Mazo o el Extra Deck.' });
        break;
      }
      default: ops.push({ op: 'log', text: q(by) + ' se resuelve.' });
    }
    return done(false);
  }

  /* ---------- Cuentas del turno ---------- */
  /** Called by the Grave / Crossout Designator: ¿a qué handtrap del rival apunta? (se guarda para resolverla) */
  function markNegators(S, index, L) {
    const opp = S.opp;
    const { c, e } = effectOf(L);
    const text = e ? e.text : '';
    if (!c || !/activated effects[^.]*same original name/i.test(text)) return;
    const pending = opp.history.filter((x) => x.pending);
    const isMon = (x) => { const k = db.get(x.id); return !!(k && db.isMonster(k)); };
    let card = null, kind;
    if (/Declare 1 card name/i.test(text)) {
      kind = 'crossout';
      const inDeck = (id) => (S.deck || []).some((x) => x.id === id);
      const cands = pending.map((x) => ({ uid: x.uid, id: defOf(x.name).id })).reverse();
      // Crossout solo niega si destierra una copia de tu Main Deck: sin copia en el Mazo no le pasa nada a la handtrap
      card = cands.find((x) => inDeck(x.id)) || null;
    } else if (/in your opponent's (?:GY|Graveyard)/i.test(text)) {
      kind = 'cbtg';
      const gyPending = pending.slice().reverse().map((x) => opp.gy.find((g) => g.uid === x.uid)).filter((x) => x && isMon(x));
      card = gyPending[0] || opp.gy.slice().reverse().find((x) => !x.blank && isMon(x)) || null;
    }
    if (!card) return;
    opp.marks.push({ link: index, uid: card.uid, name: nameById(card.id), by: c.name, kind, turn: turnOf(S) });
  }
  function drawOne(S, why) {
    const opp = S.opp;
    const card = opp.deck.shift();
    if (!card) return null;
    opp.hand.push(card);
    opp.drew = (Number(opp.drew) || 0) + 1;
    return { kind: 'opp', text: 'El rival roba 1 carta (por ' + q(why) + ').' };
  }

  /** Después de cada jugada tuya, antes de consider: lleva las cuentas (invocaciones para Nibiru, robos de Fuwalos...).
   * Devuelve entradas para el registro: [{ kind: 'opp', text }] */
  function observe(S, ev) {
    const opp = S && S.opp;
    if (!opp || !opp.enabled || !ev) return [];
    const turn = sync(S);
    const logs = [];
    const chain = Array.isArray(S.chain) ? S.chain : [];
    switch (ev.type) {
      case 'activation': {
        const L = chain[Number(ev.link)];
        if (L && L.owner !== 'opp') { opp.acts++; markNegators(S, Number(ev.link), L); }
        break;
      }
      case 'summon': {
        const method = ev.method || 'special';
        const uids = Array.isArray(ev.uids) && ev.uids.length ? ev.uids : [ev.uid].filter(Boolean);
        if (!SET_METHODS.includes(method)) opp.summons += uids.length || 1;
        const from = ev.from || {};
        const special = !SET_METHODS.includes(method) && !NORMAL_METHODS.includes(method);
        if (special && uids.some((u) => from[u] === 'deck' || from[u] === 'extra')) {
          opp.ssDeckExtra++;
          const f = opp.flags.fuwalos;
          if (f && Number(f.turn) === turn) {
            for (let i = 0; i < (Number(f.n) || 1); i++) { const e = drawOne(S, 'Mulcharmy Fuwalos'); if (e) logs.push(e); }
          }
        }
        break;
      }
      case 'add': {
        if ((ev.from || 'deck') === 'deck' && phaseOf(S) !== 'draw') {
          opp.adds++;
          if (chain.length) opp.pendingDroll = true; // se añadió durante la resolución: Droll espera a que termine la cadena
        }
        break;
      }
      case 'resolved': {
        // Eslabones del rival que no llegaron a resolverse: los negaste (marcados en la cadena)
        // o pasaste el turno con la cadena abierta (abandoned): su carta deja la cadena sin hacer nada
        for (const hst of opp.history) {
          if (!hst.pending) continue;
          hst.pending = false;
          hst.negated = true;
          if (ev.abandoned) hst.unresolved = true;
          leaveChain(opp, hst.uid);
          logs.push({ kind: 'opp', text: q(hst.name) + (ev.abandoned ? ' del rival no llegó a resolverse (la cadena quedó abierta).' : ' del rival quedó negado.') });
        }
        if (ev.abandoned) { opp.marks = []; break; }
        // Called by the Grave / Crossout que se resolvieron
        for (const m of opp.marks) {
          const pl = Array.isArray(ev.chain) ? ev.chain[m.link] : null;
          if (m.cancelled || (pl && pl.negated)) continue;
          if (m.kind === 'cbtg') {
            const card = takeFrom(opp.gy, m.uid);
            if (card) opp.ban.push(card);
            opp.blocked[m.name] = turn + 1;
            logs.push({ kind: 'opp', text: 'Por ' + q(m.by) + ', ' + q(m.name) + ' del rival queda desterrada y sus efectos negados hasta el final del próximo turno.' });
          } else {
            opp.blocked[m.name] = turn;
            logs.push({ kind: 'opp', text: 'Por ' + q(m.by) + ', los efectos de ' + q(m.name) + ' quedan negados este turno.' });
          }
        }
        opp.marks = [];
        break;
      }
      case 'phase': {
        // Fuwalos: una vez en la Fase Final, si tiene más de (tus cartas en el campo + 6), devuelve al Mazo al azar
        const f = opp.flags.fuwalos;
        if (ev.phase === 'end' && f && Number(f.turn) === turn && !f.endDone) {
          f.endDone = true;
          const cap = controlledCount(S) + 6;
          let n = 0;
          while (opp.hand.length > cap) {
            const i = Math.floor(rand(opp) * opp.hand.length);
            opp.deck.push(opp.hand.splice(i, 1)[0]);
            n++;
          }
          if (n) { shuffle(opp, opp.deck); logs.push({ kind: 'opp', text: 'Fase Final: el rival devuelve ' + n + ' carta' + (n === 1 ? '' : 's') + ' de la mano al Mazo (por ' + q('Mulcharmy Fuwalos') + ').' }); }
        }
        break;
      }
      default: break;
    }
    return logs;
  }

  /* ---------- Para la interfaz ---------- */
  /** Instancia del Token para tu campo (op 'token' de Nibiru). */
  function tokenInstance(S, op) {
    const opp = S && S.opp;
    const seq = opp ? ++opp.seq : Math.floor(Math.random() * 1e9);
    return {
      uid: 'tk' + seq.toString(36), id: op.id || TOKEN_ID, faceDown: false, def: op.position !== 'atk',
      token: { name: op.name || TOKEN_NAME, atk: Number(op.atk) || 0, def: Number(op.def) || 0, level: op.level || 11, attribute: op.attribute || ATTR.LIGHT, race: op.race || 0x100 },
      summonedTurn: turnOf(S), summonMethod: 'special',
    };
  }
  /** Resumen del intento: mano inicial, qué usó y sobre qué, qué se guardó, cuántas robó. */
  function summary(S) {
    const opp = S && S.opp;
    if (!opp) return { initialHand: [], used: [], unused: [], drew: 0 };
    return {
      initialHand: (opp.initialHand || []).slice(),
      used: (opp.history || []).map((x) => ({ name: x.name, turn: x.turn, on: x.on, negated: !!x.negated, unresolved: !!x.unresolved, reason: x.reason || '' })),
      unused: (opp.hand || []).filter((x) => !x.blank).map((x) => nameById(x.id)),
      drew: Number(opp.drew) || 0,
      mode: opp.mode,
    };
  }
  /** Datos para la franja del rival: mano (con cartas cualquiera como blank), Cementerio, campo, modo. */
  function view(S) {
    const opp = S && S.opp;
    if (!opp) return null;
    const card = (x) => (x.blank ? { uid: x.uid, blank: true, name: 'Otra carta' } : { uid: x.uid, id: x.id, name: nameById(x.id), short: shortOf(x.id), onChain: !!x.onChain });
    return {
      enabled: !!opp.enabled, mode: opp.mode, modeLabel: MODE_LABELS[opp.mode] || '', hand: opp.hand.map(card), gy: opp.gy.map(card),
      ban: opp.ban.map(card), field: opp.field.map(card), deckCount: opp.deck.length, summons: opp.summons,
    };
  }
  const isHandtrap = (name) => !!defOf(name);
  /** Handtraps que el rival sabe usar (para el editor de la lista). */
  const supported = () => Object.values(HANDTRAPS).map((h) => ({ name: h.name, id: h.id, short: h.short, what: h.what, limit: h.limit }));

  YGO.bot = {
    HANDTRAPS, DEFAULT_POOL, MODE_LABELS, TOKEN_ID, TOKEN_NAME,
    newOpponent, normalizePool, observe, consider, options, commit, resolveLink, summary, view, negatedBy: negatedByPlayer,
    classify, classifyText, isHandtrap, supported, tokenInstance, threshold,
  };
})();
