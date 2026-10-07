/* Rival con handtraps para practicar combos ("¿mi campo pasa?").
 * Lógica pura, sin DOM: decide si el rival activa una handtrap después de cada jugada tuya y qué hace al resolverse.
 * Todo lo que guarda vive en S.opp (así deshacer lo incluye), se puede pasar a JSON y el azar usa una semilla.
 * Flujo con field.js: observe (cuentas del turno) → consider (¿responde?) → commit (eslabón en S.chain)
 * → resolveLink al resolver la cadena (devuelve operaciones que field.js aplica en tu campo).
 * El rival solo aplica SUS efectos: nunca toca tus zonas; lo que te hace va en operaciones (ops) que aplica field.js.
 * Sus monstruos en el campo viven en S.opp.field: { uid, id, monster: true, def?, by, turn, banishAtEnd?, banishOnLeave?, owner? }.
 * Expone window.YGO.bot. */
(function () {
  const YGO = (window.YGO = window.YGO || {});
  const db = YGO.db;
  const T = db.T;
  const rules = () => YGO.rules || null;

  /* ---------- Constantes ---------- */
  const MZ = ['emz0', 'emz1', 'mz0', 'mz1', 'mz2', 'mz3', 'mz4'];
  const MMZ = ['mz0', 'mz1', 'mz2', 'mz3', 'mz4'];
  const ST = ['st0', 'st1', 'st2', 'st3', 'st4'];
  const FIELD_ZONES = [...MZ, ...ST, 'fz'];
  const ATTR = { EARTH: 0x1, WATER: 0x2, FIRE: 0x4, WIND: 0x8, LIGHT: 0x10, DARK: 0x20 };
  const MODE_LABELS = { smart: 'Inteligente', aggressive: 'Agresivo' };
  const NORMAL_METHODS = ['normal', 'tribute'];
  const SET_METHODS = ['set', 'tributeSet', 'flip'];
  const isSpecialMethod = (m) => !SET_METHODS.includes(m) && !NORMAL_METHODS.includes(m);
  const HT_MAX = 15; // handtraps como máximo entre la mano y el Mazo del rival (Mazo de 40)
  const BOT_ZONES = 5; // Zonas de Monstruo del rival
  const q = (name) => '«' + name + '»';

  // [nombre, corto, qué hace, rasgos], en el orden de la lista de Oscar (la de 34 y después las 4 que no repitió).
  // when: solo responde al último eslabón ("When ... is activated"); trap: Trampa que se activa desde la mano y queda en el campo
  // mientras está en la cadena; self: el monstruo se Invoca a sí mismo (queda en la mano, revelado, mientras está en la cadena);
  // opt: una vez por turno por nombre; act: "solo puedes activar 1 por turno"; lock: atributos que bloquea si se activó desde la mano;
  // mulcharmy: clave de su efecto; narrow: preferencia cuando dos sirven (la más específica primero);
  // alias: el nombre con que Oscar la conoce (se muestra en la lista); aliases: otros nombres que se aceptan
  const DEFS = [
    ['Mulcharmy Fuwalos', 'Fuwalos', 'Roba 1 carta cada vez que Invocas de modo Especial desde el Mazo o el Extra Deck ese turno.', { mulcharmy: 'fuwalos', narrow: 0 }],
    ['Mulcharmy Purulia', 'Purulia', 'Roba 1 carta cada vez que Invocas de modo Normal o Especial desde la mano ese turno.', { mulcharmy: 'purulia', narrow: 0 }],
    ['Droll & Lock Bird', 'Droll', 'Si añades una carta del Mazo a la mano, ya no puedes añadir más del Mazo ese turno.', { narrow: 10 }],
    ['Ash Blossom & Joyous Spring', 'Ash', 'Niega un efecto que añade del Mazo a la mano, Invoca desde el Mazo o manda del Mazo al Cementerio.', { when: true, opt: true, narrow: 10 }],
    ['Fydraulis Harmonia', 'Harmonia', 'Cuando tu monstruo activa su efecto en el campo, se Invoca y destruye 1 monstruo de tu campo.', { when: true, opt: true, self: true, narrow: 4 }],
    ['Dominus Impulse', 'Impulse', 'Niega un efecto que Invoca de modo Especial.', { when: true, trap: true, act: true, lock: ATTR.LIGHT | ATTR.EARTH | ATTR.WIND, narrow: 6 }],
    ['Multiplying Kuriboh!', 'Kuriboh', 'Se Invoca cuando activas un efecto de monstruo; desde su campo Invoca otra copia (o un monstruo de 300 ATK/200 DEF) y deja en 0 el ATK de tu monstruo.',
      { when: true, self: true, narrow: 0, alias: 'Kuriboh - Multiply!', aliases: ['Kuriboh - Multiply!', 'Kuriboh Multiplier'] }],
    ['Griffoh', 'Griffoh', 'En este simulador no hace nada en tu turno: su escudo de daño no sirve aquí y lo que puede Colocar necesita cartas de «Light and Darkness Ritual». El rival la tiene en la mano sin usarla.', { narrow: 0 }],
    ['Nibiru, the Primal Being', 'Nibiru', 'Si haces 5 invocaciones en el turno, sacrifica todos los monstruos boca arriba y te deja un Token.', { opt: true, self: true, narrow: 0 }],
    ['Typhoon', 'Typhoon', 'Si controlas 2 o más Mágicas/Trampas y el rival ninguna, destruye 1 Mágica/Trampa boca arriba de tu campo.', { trap: true, narrow: 4 }],
    ['Songs of the Dominators', 'Songs', 'Niega un efecto de monstruo activado en el campo.', { when: true, trap: true, act: true, narrow: 6 }],
    ['Dominus Spark', 'Spark', 'Si activaste un efecto de monstruo en la mano o el Cementerio, destierra 1 monstruo de tu campo.', { trap: true, act: true, lock: ATTR.EARTH | ATTR.WATER | ATTR.FIRE | ATTR.WIND, narrow: 2 }],
    ['Angelechy Opening to e4', 'Opening', 'Si vas primero, en tu primera Fase de Espera pone en su campo «Angelechy Problem», «Angelechy Destrier» (en tu Zona Extra) y «Angelechy Bastion» con «Angelechy Shatranga»: solo puedes intentar 5 efectos de monstruo por turno.', { trap: true, narrow: 0 }],
    ['Dominus Purge', 'Purge', 'Niega un efecto que añade una carta del Mazo a la mano.', { when: true, trap: true, act: true, lock: ATTR.DARK | ATTR.WATER | ATTR.FIRE, narrow: 8 }],
    ['Infinite Impermanence', 'Imperm', 'Niega los efectos de un monstruo boca arriba hasta el final del turno.', { trap: true, narrow: 0 }],
    ['PSY-Framegear Gamma', 'Gamma', 'Si no controla monstruos, niega la activación de un efecto de monstruo y destruye ese monstruo.', { when: true, self: true, narrow: 4 }],
    ['Ghost Ogre & Snow Rabbit', 'Ogre', 'Destruye la carta del campo que activa su efecto (el efecto igual se resuelve).', { when: true, opt: true, narrow: 6 }],
    ['Mulcharmy Meowls', 'Meowls', 'Roba 1 carta cada vez que Invocas de modo Especial desde el Cementerio o el destierro ese turno.', { mulcharmy: 'meowls', narrow: 0 }],
    ['Bystial Magnamhut', 'Magnamhut', 'Destierra 1 monstruo LUZ u OSCURIDAD de tu Cementerio y se Invoca.', { opt: true, self: true, narrow: 6 }],
    ['Synchro Emergency', 'Emergency', 'Si solo tú controlas monstruos, Invoca 1 monstruo de su mano (y un «Synchron» si tienes un monstruo del Extra Deck).', { trap: true, act: true, narrow: 0 }],
    ['Ghost Belle & Haunted Mansion', 'Belle', 'Niega una activación que saca cartas del Cementerio, Invoca desde el Cementerio o destierra del Cementerio.', { when: true, opt: true, narrow: 10 }],
    ['Fantastical Dragon Phantazmay', 'Phantazmay', 'Si Invocas un monstruo Link, se Invoca, roba cartas y devuelve otras a su Mazo.', { opt: true, self: true, narrow: 2 }],
    ['Effect Veiler', 'Veiler', 'En tu Fase Principal, niega los efectos de un monstruo de Efecto boca arriba hasta el final del turno.', { narrow: 2 }],
    ['PSY-Framegear Delta', 'Delta', 'Si no controla monstruos, niega la activación de una Carta Mágica y la destruye.', { when: true, self: true, narrow: 6 }],
    ['Dominus Spiral', 'Spiral', 'Si activaste un efecto de monstruo en la mano o el Cementerio, devuelve 1 monstruo de tu campo a la mano o al Extra Deck.', { trap: true, act: true, lock: ATTR.LIGHT | ATTR.DARK, narrow: 2 }],
    ['D.D. Crow', 'Crow', 'Destierra 1 carta de tu Cementerio.', { narrow: 8 }],
    ['Skull Meister', 'Skull', 'Niega un efecto que activas en tu Cementerio.', { when: true, narrow: 9 }],
    ['K9-17 Izuna', 'Izuna', 'Si activaste un efecto de monstruo en la mano o el Cementerio, se Invoca en la Fase Principal.', { opt: true, self: true, narrow: 0 }],
    ['Retaliating "C"', 'Retaliating', 'Cuando activas una Carta Mágica que Invoca, se Invoca y, mientras esté boca arriba, lo que va al Cementerio queda desterrado.', { when: true, self: true, narrow: 2 }],
    ['Ghost Mourner & Moonlit Chill', 'Mourner', 'Si Invocas de modo Especial, niega los efectos de ese monstruo; si deja el campo este turno, recibes daño igual a su ATK.', { opt: true, narrow: 2 }],
    ['Veidos the Eruption Dragon of Extinction', 'Veidos', 'En la Fase Principal se Invoca en tu campo y destruye tu carta de la Zona de Campo; si la mandas de tu campo a su Cementerio, puede destruir todos los monstruos del campo.',
      { self: true, narrow: 2, aliases: ['Veidos'] }],
    ['Artifact Lancea', 'Lancea', 'En tu turno, nadie puede desterrar cartas por el resto del turno.', { narrow: 0 }],
    ['Contact "C"', 'Contact', 'Cuando Invocas, se Invoca en tu campo en Defensa; mientras esté ahí, solo puedes Invocar desde el Extra Deck usándola como material.', { when: true, self: true, narrow: 2 }],
    ['Hecahands Godos', 'Godos', 'Se Invoca si añades una carta a la mano; en tu Fase Principal se lleva a su campo 1 monstruo de tu Cementerio.', { self: true, narrow: 2 }],
    ['Shiina, Twin Tempests of Celestial Thunder', 'Shiina', 'Si controla un monstruo VIENTO, se Invoca y devuelve a la mano los monstruos boca arriba o las Mágicas/Trampas del campo.', { when: true, opt: true, self: true, narrow: 0 }],
    ['Dimension Shifter', 'Shifter', 'Si su Cementerio está vacío, hasta el final del próximo turno lo que va al Cementerio queda desterrado.', { narrow: 0 }],
    ['Ghost Reaper & Winter Cherries', 'Reaper', 'Si controlas más monstruos que el rival, destierra de tu Extra Deck todas las copias de una carta.', { opt: true, narrow: 4 }],
    ['Rescue-ACE Impulse', 'Rescue-ACE', 'Cuando tu monstruo activa su efecto en el campo, se sacrifica e Invoca a «Rescue-ACE Fire Attacker».', { when: true, opt: true, narrow: 2 }],
  ];
  const HANDTRAPS = {};
  const BY_KEY = new Map();
  for (const [name, short, what, traits] of DEFS) {
    const c = db.findByName(name);
    if (!c) continue;
    const h = { name: c.name, id: c.id, short, what, limit: db.banLimit(c.id), ot: c.ot };
    if (traits.alias) h.alias = traits.alias;
    if (traits.aliases) h.aliases = traits.aliases.slice();
    HANDTRAPS[c.name] = h;
    Object.defineProperty(h, 'traits', { value: traits, enumerable: false });
    BY_KEY.set(db.nameKey(c.name), h);
    BY_KEY.set(String(c.id), h);
    // "Kuriboh - Multiply!" / "Kuriboh Multiplier" (como la llama Oscar), "Veidos"
    for (const a of [traits.alias, ...(traits.aliases || [])]) if (a) BY_KEY.set(db.nameKey(a), h);
  }
  const defOf = (x) => (x == null ? null : BY_KEY.get(db.nameKey(String(x))) || BY_KEY.get(String(x)) || null);
  const shortOf = (name) => { const h = defOf(name); return h ? h.short : ''; };
  // Lista por defecto: 3 copias de cada una, o lo que permita la banlist (Droll 2, Magnamhut 1, Gamma 1, Dimension Shifter 0)
  const DEFAULT_POOL = Object.values(HANDTRAPS).map((h) => ({ name: h.name, copies: Math.min(3, h.limit) }));
  // Las listas por defecto de antes: las 10 handtraps del principio y las 33 de la primera lista de Oscar.
  // Quien guardó una de ellas tal cual (mismos nombres y copias por defecto, en cualquier orden) recibe la nueva.
  const OLD_DEFAULTS = [
    ['Ash Blossom & Joyous Spring', 'Infinite Impermanence', 'Effect Veiler', 'Nibiru, the Primal Being', 'Droll & Lock Bird',
      'Ghost Belle & Haunted Mansion', 'Ghost Ogre & Snow Rabbit', 'Mulcharmy Fuwalos', 'D.D. Crow', 'Dominus Impulse'],
    ['Mulcharmy Fuwalos', 'Mulcharmy Purulia', 'Ash Blossom & Joyous Spring', 'Droll & Lock Bird', 'Dominus Impulse', 'Multiplying Kuriboh!',
      'Fydraulis Harmonia', 'Nibiru, the Primal Being', 'Dominus Spark', 'Bystial Magnamhut', 'Ghost Belle & Haunted Mansion', 'Synchro Emergency',
      'Songs of the Dominators', 'Infinite Impermanence', 'Ghost Ogre & Snow Rabbit', 'Dominus Purge', 'Shiina, Twin Tempests of Celestial Thunder',
      'PSY-Framegear Gamma', 'PSY-Framegear Delta', 'Ghost Mourner & Moonlit Chill', 'Hecahands Godos', 'Effect Veiler', 'K9-17 Izuna',
      'Fantastical Dragon Phantazmay', 'Mulcharmy Meowls', 'D.D. Crow', 'Artifact Lancea', 'Dominus Spiral', 'Contact "C"', 'Retaliating "C"',
      'Dimension Shifter', 'Ghost Reaper & Winter Cherries', 'Rescue-ACE Impulse'],
  ];

  // Token de Nibiru: carta virtual (no se guarda ni sale en búsquedas)
  const TOKEN_ID = 27204312;
  const TOKEN_NAME = 'Primal Being Token';
  if (db.addVirtual && !db.get(TOKEN_ID)) {
    db.addVirtual([[TOKEN_ID, TOKEN_NAME, T.MONSTER | T.NORMAL | T.TOKEN, -2, -2, 11, 0x100, ATTR.LIGHT, 3, 0,
      'This card can be used as a "Primal Being Token". (Rock/LIGHT/Level 11. Its ATK/DEF are the combined original ATK/DEF of the monsters Tributed by "Nibiru, the Primal Being".)']]);
  }
  // Cartas de apoyo que el rival "tiene en el Mazo" (no son handtraps): se sacan del Mazo en lugar de una carta cualquiera
  const SUPPORT = {
    driver: 49036338, // PSY-Frame Driver
    fire: 64612053, // Rescue-ACE Fire Attacker
    synchron: (() => { const c = db.findByName('Junk Synchron') || db.cards.find((x) => db.isMonster(x) && /Synchron/.test(x.name)); return c ? c.id : 0; })(),
    ashened: 66848311, // Ashened for Eternity (Veidos)
  };
  const KURIBOH = 'Multiplying Kuriboh!';
  const VEIDOS = 'Veidos the Eruption Dragon of Extinction';
  // Angelechy Opening to e4: el rival juega el Extra Deck de Angelechy
  const ANGELECHY = { problem: 17782288, destrier: 55393975, bastion: 28904860, shatranga: 42410161 };
  const isAngelechy = (id) => /\bAngelechy\b/.test(nameById(id));

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
  /** ¿Es una lista por defecto vieja (las 10 del principio o las 33 de la primera lista de Oscar, con sus copias por defecto,
   * en cualquier orden)? Las de 0 copias por defecto (Dimension Shifter) pueden faltar: la lista guardada no las incluye.
   * field.js la usa una sola vez con las preferencias guardadas (botPoolVer); una lista igual elegida después se respeta. */
  function isOldDefaultPool(pool) {
    if (!Array.isArray(pool) || !pool.length) return false;
    const got = new Map();
    for (const p of pool) {
      const h = defOf(p && (p.name || p.id));
      if (!h || got.has(h.name)) return false;
      got.set(h.name, Math.floor(Number(p.copies)));
    }
    return OLD_DEFAULTS.some((names) => [...got.keys()].every((n) => names.includes(n))
      && names.every((n) => { const h = HANDTRAPS[n]; return h && (got.has(n) ? got.get(n) : 0) === Math.min(3, h.limit); }));
  }
  /** Lista de handtraps válida: solo las soportadas y con copias entre 0 y el límite de la banlist. */
  function normalizePool(pool) {
    // (La lista de fábrica vieja guardada la cambia field.js una sola vez, con isOldDefaultPool; aquí se respeta lo que llega.)
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
      summons: 0, windows: 0, adds: 0, acts: 0, ssDeckExtra: 0, handSummons: 0, gySS: 0, drew: 0, turn: null, seq: 0, bias: 0,
      pendingDroll: false, pendingGodos: false, pendingFire: false, pendingSummons: [], history: [], initialHand: [],
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
    // Mazo para robar: una muestra al azar de lo que queda de la lista (mano + Mazo ≤ 15 handtraps) + cartas cualquiera hasta 40
    const deck = copies.slice(0, Math.max(0, HT_MAX - opp.hand.length)).map(card);
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
      opp.summons = 0; opp.windows = 0; opp.adds = 0; opp.acts = 0; opp.ssDeckExtra = 0; opp.handSummons = 0; opp.gySS = 0;
      opp.pendingDroll = false; opp.pendingGodos = false; opp.pendingFire = false; opp.pendingSummons = [];
      opp.marks = [];
    }
    if (!Array.isArray(opp.marks)) opp.marks = [];
    if (!opp.blocked) opp.blocked = {};
    if (!opp.flags) opp.flags = {};
    if (!Array.isArray(opp.field)) opp.field = [];
    if (!Array.isArray(opp.pendingSummons)) opp.pendingSummons = [];
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
    return playerMonsters(S).filter((m) => !m.inst.faceDown);
  }
  /** Monstruos que controlas (boca arriba o abajo, también «Contact "C"» del rival en tu campo): [{ inst, zone, c }] */
  function playerMonsters(S) {
    const out = [];
    const gone = paidAway(S);
    for (const z of MZ) {
      const inst = topOf(S, z);
      if (!inst || gone.has(inst.uid)) continue;
      const c = db.get(inst.id);
      if (c && db.isMonster(c)) out.push({ inst, zone: z, c });
    }
    return out;
  }
  /** Tus Mágicas/Trampas del campo (Zonas de Mágicas y Trampas y de Campo, boca arriba o abajo; también las Escalas). */
  const playerSpellTraps = (S) => [...ST, 'fz'].map((z) => topOf(S, z)).filter(Boolean);
  /** Lo que Nibiru puede sacrificar: tus monstruos boca arriba, sin los que no le afectan ni se pueden sacrificar. */
  const tributable = (S, h) => faceUpMonsters(S).filter((m) => !shieldOf(S, m.inst, ['affect', 'tribute'], h));
  const controlledCount = (S) => FIELD_ZONES.filter((z) => topOf(S, z)).length;
  const freePlayerZone = (S) => MMZ.some((z) => !topOf(S, z));
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
  /** Tu monstruo invocado desde el Extra Deck (Fusión, Sincronía, Xyz, Link). */
  const fromExtra = (inst, c) => !!(c && db.isExtra(c) && (['fusion', 'synchro', 'xyz', 'link'].includes(inst.summonMethod) || inst.summonFrom === 'extra' || inst.from === 'extra'));
  /** Todas tus cartas (Mazo, mano, Extra Deck, Cementerio y campo) para medir qué usa tu mazo. */
  function playerCards(S) {
    const out = [];
    for (const a of ['deck', 'hand', 'extra', 'gy']) for (const x of (Array.isArray(S[a]) ? S[a] : [])) out.push(x);
    for (const z of FIELD_ZONES) for (const x of (S.zones && Array.isArray(S.zones[z]) ? S.zones[z] : [])) if (!x.token && x.owner !== 'opp') out.push(x);
    return out.map((x) => x && db.get(x.id)).filter(Boolean);
  }
  const textCache = new Map();
  /** Cuántas de tus cartas tienen un texto que cumple re (con caché por carta y regla). */
  function countText(S, key, re) {
    let n = 0;
    for (const c of playerCards(S)) {
      const k = key + ':' + c.id;
      if (!textCache.has(k)) textCache.set(k, typeof re === 'function' ? !!re(c) : re.test(String(c.desc || '')));
      if (textCache.get(k)) n++;
    }
    return n;
  }
  // Mulcharmy: qué tanto tu mazo Invoca desde la mano (Purulia) o desde el Cementerio / el destierro (Meowls)
  const AFFINITY = {
    purulia: /\bSpecial Summon (?:this card|[^.;]*?) from (?:your |the )?hand\b|\bNormal Summon/i,
    meowls: /\bSpecial Summon[^.;]*\b(?:GYs?|Graveyard|banishment|banished)\b/i,
  };
  // Cartas que funcionan en el Cementerio o mandan cartas ahí (Retaliating "C", Dimension Shifter)
  const GY_AFFINITY = /\b(?:in|from) your (?:GY|Graveyard)\b|\bsent to the (?:GY|Graveyard)\b|\bsend\b[^.;]*\bto the (?:GY|Graveyard)\b/i;
  /** ¿Algún efecto de la carta destierra como costo? ("banish 1 card from your GY;", "by banishing ...") */
  function banishCost(c) {
    const R = rules();
    if (/\bby banishing\b/i.test(String(c.desc || ''))) return true;
    if (R) return R.effectsOf(c).some((e) => e.cost && /\bbanish/i.test(e.cost));
    return /\bbanish[^.;:]*;/i.test(String(c.desc || ''));
  }
  /** Puntaje de un Mulcharmy nuevo (Purulia/Meowls): 45–90 según cuánto tu mazo usa ese origen. */
  function mulAffinity(S, key) {
    const total = playerCards(S).length;
    if (!total) return 80;
    const ratio = countText(S, key, AFFINITY[key]) / total;
    return Math.round(45 + 45 * Math.min(1, ratio * 3));
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
      if (!inst || inst.faceDown || inst.token || negatedNow(S, inst) || inst.owner === 'opp') continue;
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

  /* ---------- El lado del rival: campo, Cementerio, bloqueos ---------- */
  const cardOf = (x) => (x && !x.blank && x.id ? db.get(x.id) : null);
  // Sus cartas que no son monstruos en el campo: Trampas en la cadena (onChain), la Mágica de Campo (zone 'fz') y los monstruos
  // Angelechy puestos como Mágicas Continuas (zone 'st', asSpell). «Angelechy Destrier» está en tu Zona Extra (zone 'emz1').
  const isMonsterEntry = (x) => !!(x && !x.onChain && !x.asSpell && x.zone !== 'fz' && x.zone !== 'st' && (x.monster || (cardOf(x) && db.isMonster(cardOf(x)))));
  const botMonsters = (S) => S.opp.field.filter(isMonsterEntry);
  const botSpellTraps = (S) => S.opp.field.filter((x) => x && !isMonsterEntry(x));
  const inEmz = (x) => /^emz/.test(String(x.zone || ''));
  const freeBotZones = (S) => BOT_ZONES - botMonsters(S).filter((x) => !inEmz(x)).length;
  const newUid = (opp) => 'o' + (++opp.seq).toString(36);
  const trapInGy = (opp) => opp.gy.some((x) => { const c = cardOf(x); return !!(c && db.isTrap(c)); });
  const monsterInGy = (opp) => opp.gy.some((x) => { const c = cardOf(x); return !!(c && db.isMonster(c)); });
  const locksOf = (S) => (Array.isArray(tsOf(S).locks) ? tsOf(S).locks : []).filter(Boolean);
  /** ¿Sigue vigente este bloqueo? Con sourceUid (Retaliating "C", «Angelechy Shatranga», «Angelechy Destrier»): mientras esa
   * carta siga boca arriba en el campo del rival; con until (Dimension Shifter): hasta el final de ese turno; los demás: sí. */
  function lockActive(S, lock) {
    if (!lock) return false;
    if (lock.sourceUid) return !!(S && S.opp && Array.isArray(S.opp.field) && S.opp.field.some((x) => x && x.uid === lock.sourceUid && !x.faceDown));
    if (lock.until != null) return turnOf(S) <= Number(lock.until);
    return true;
  }
  /** «Artifact Lancea»: nadie puede desterrar este turno → nombre de la carta o '' */
  const noBanish = (S) => { const l = locksOf(S).find((x) => x.kind === 'noBanish' && lockActive(S, x)); return l ? l.source || 'Artifact Lancea' : ''; };
  /** ¿Lo que va al Cementerio queda desterrado (Retaliating "C", Dimension Shifter)? → null | { source }.
   * Con «Artifact Lancea» activo nadie destierra: las cartas van al Cementerio. */
  function gyRedirect(S) {
    if (!S || noBanish(S)) return null;
    for (const l of locksOf(S)) if (l.kind === 'gyToBan' && lockActive(S, l)) return { source: l.source || '' };
    const o = S.opp;
    if (!o) return null;
    const rc = (Array.isArray(o.field) ? o.field : []).find((x) => x && x.gyLock && !x.faceDown);
    if (rc) return { source: nameById(rc.id) };
    const sh = o.flags && o.flags.shifter;
    if (sh && turnOf(S) <= Number(sh.until)) return { source: 'Dimension Shifter' };
    return null;
  }
  /** Una carta del rival va a su Cementerio (o al destierro si hay un reemplazo activo). → 'gy' | 'ban' */
  function botToGy(S, card) {
    if (gyRedirect(S)) { S.opp.ban.push(card); return 'ban'; }
    S.opp.gy.push(card);
    return 'gy';
  }
  // Bloqueos a los efectos de monstruo del propio rival
  const attrMask = (opp) => (Number(opp.flags.attrLock) || 0) | (opp.flags.dominusFromHand ? ATTR.LIGHT | ATTR.EARTH | ATTR.WIND : 0);
  /** ¿El rival no puede activar efectos de este monstruo suyo desde where ('hand' | 'gy' | 'ban' | 'field')? → motivo o '' */
  function monsterLock(S, id, where) {
    const c = db.get(id);
    if (!c || !db.isMonster(c)) return '';
    const opp = S.opp;
    if (c.attribute & attrMask(opp)) return 'dominus'; // Dominus desde la mano: el resto del Duelo
    if (where !== 'field' && Number(opp.flags.songsUntil) >= turnOf(S)) return 'songs'; // Songs desde la mano: hasta el final del próximo turno
    return '';
  }
  /** ¿Le quedan en la mano monstruos de esos atributos (que todavía no tiene bloqueados)? */
  const holdsAttr = (S, mask, except) => {
    const m = mask & ~attrMask(S.opp);
    return !!m && S.opp.hand.some((x) => {
      if (x.blank || x.uid === except) return false;
      const c = db.get(x.id);
      return c && db.isMonster(c) && !!(c.attribute & m);
    });
  };
  const holdsMonster = (S, except) => S.opp.hand.some((x) => { if (x.blank || x.uid === except) return false; const c = db.get(x.id); return !!(c && db.isMonster(c)); });
  /** Cuánto le sirve al rival guardar esa carta de la mano (para descartar o devolver al Mazo lo que menos sirve). */
  function keepValue(S, x) {
    if (!x || x.blank) return -1;
    const h = defOf(x.id);
    if (!h) return 1;
    if (h.short === 'Griffoh') return 0; // no la puede usar aquí
    if ((h.traits.opt && used(S, 'opt:' + h.name)) || (h.traits.act && used(S, 'act:' + h.name)) || monsterLock(S, h.id, 'hand')) return 0;
    return 100 - ORDER(h.name);
  }
  const leastValuable = (S, list, filter) => list.filter((x) => !x.onChain && (!filter || filter(x))).sort((a, b) => keepValue(S, a) - keepValue(S, b))[0] || null;
  /** Pone una carta en el campo del rival como monstruo. */
  function toField(S, card, by, extra) {
    const e = Object.assign({ uid: card.uid, id: card.id, monster: true, by, turn: turnOf(S) }, extra || {});
    S.opp.field.push(e);
    return e;
  }
  /** El monstruo que se Invoca a sí mismo deja la mano y va al campo del rival. */
  function summonFromHand(S, uid, by, extra) {
    const card = takeFrom(S.opp.hand, uid);
    if (!card) return null;
    delete card.onChain;
    return toField(S, card, by, extra);
  }
  /** Carta de apoyo del Mazo del rival: una copia real si la tiene; si no (PSY-Frame Driver, Fire Attacker, un "Synchron"),
   * da por hecho que la juega: saca una carta cualquiera del Mazo y usa la carta real.
   * kind: 'driver' | 'fire' | 'synchron' | 'ashened' | 'kuriboh' | 'dominus' | 'blank' (una carta cualquiera: la Trampa Angelechy) */
  function takeSupport(S, kind) {
    const opp = S.opp;
    const pick = (list, test) => { const i = list.findIndex((x) => x && !x.blank && test(x)); return i >= 0 ? list.splice(i, 1)[0] : null; };
    if (kind === 'kuriboh') {
      // "1 monster with 300 ATK/200 DEF from your Deck or GY": otra «Multiplying Kuriboh!» primero (o «Griffoh», que también es 300/200)
      const id = HANDTRAPS[KURIBOH] && HANDTRAPS[KURIBOH].id;
      return pick(opp.deck, (x) => x.id === id) || pick(opp.gy, (x) => x.id === id) || pick(opp.deck, is300) || pick(opp.gy, is300);
    }
    if (kind === 'dominus') return pick(opp.deck, (x) => /\bDominus\b/.test(nameById(x.id)));
    const b = opp.deck.findIndex((x) => x && x.blank);
    if (kind === 'blank') return b >= 0 ? opp.deck.splice(b, 1)[0] : { uid: newUid(opp), blank: true };
    const id = SUPPORT[kind];
    if (!id) return null;
    const real = pick(opp.deck, (x) => x.id === id);
    if (real) return real;
    const uid = b >= 0 ? opp.deck.splice(b, 1)[0].uid : newUid(opp);
    return { uid, id };
  }
  /** Monstruo de 300 ATK/200 DEF (lo que Invoca el 2.º efecto de «Multiplying Kuriboh!»). */
  const is300 = (x) => { const c = cardOf(x); return !!(c && db.isMonster(c) && !c.isLink && c.atk === 300 && c.def === 200); };
  const hasKuribohCopy = (S) => [...S.opp.deck, ...S.opp.gy].some(is300);

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
   * → { addDeck, ssDeck, sendDeck, addGY, ssGY, banishGY, ss, summonProc, draw, self, maybe, ash, belle, dominus, purge } */
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
      if (banish) hit('banish');
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
    out.purge = !!(out.addDeck || out.draw); // Dominus Purge: "adds a card(s) from the Deck to the hand"
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
  /** ¿Se activó en el campo (solo mira dónde se activó)? A diferencia de onFieldActivation, cuenta aunque el costo haya sacado
   * al monstruo del campo («Fiendsmith's Requiem»: "Tribute this card"): Songs, Rescue-ACE Impulse, Harmonia y el 2.º efecto
   * de Kuriboh responden a "a monster effect activated on the field". → 'monster' | 'spelltrap' | null */
  function activatedOnField(S, link, c, e) {
    if (!c || link.cardAct || link.scale || Number(link.effectIndex) === 0 || (e && e.kind === 'activation')) return null;
    let zone = link.from || null;
    if (!zone) {
      const loc = locate(S, link.uid);
      if (!loc || loc.area !== 'field' || loc.index !== 0 || loc.inst.faceDown) return null;
      if (e && Array.isArray(e.where) && !e.where.includes('field') && !e.where.includes('pendulum')) return null;
      zone = loc.zone;
    }
    if (MZ.includes(zone) && db.isMonster(c) && !(e && e.pendulum)) return 'monster';
    if (ST.includes(zone) || zone === 'fz') return 'spelltrap';
    return null;
  }
  /** ¿El eslabón es un efecto de monstruo (en cualquier lugar)? La activación de una carta o de una Escala de Péndulo no. */
  const isMonsterEffect = (info) => !!(info && info.c && db.isMonster(info.c) && !info.link.cardAct && !info.link.scale && !(info.e && info.e.pendulum));
  /** ¿Es la activación de una Carta Mágica (también poner una Escala de Péndulo)? */
  const isSpellCardAct = (info) => !!(info && info.c && ((info.link.cardAct && db.isSpell(info.c)) || info.link.scale));

  /** Todo lo que el rival necesita saber de un eslabón tuyo. */
  function linkInfo(S, link, index) {
    const { c, e } = effectOf(link);
    const from = fromOf(S, link);
    const [pre, res] = e && !e.synthetic ? splitEffect(e, link.text) : ['', ''];
    const full = e ? e.text : '';
    const cls = e && !e.synthetic && !link.scale ? classifyText(full, res, from === 'gy') : {};
    // "(You can) activate 1 of these effects": el modo se elige al activar. Ash/Belle/Dominus solo si sirven contra ese modo
    // (link.mode, índice desde 0) o, sin saberlo, contra todos
    if (cls.ash || cls.belle || cls.dominus || cls.purge) {
      const fb = full.split('●');
      if (/\bactivate 1 of these effects\b/i.test(fb[0]) && fb.length > 2) {
        const per = fb.slice(1).map((b) => {
          const k = topIndex(b, ';');
          return classifyText(fb[0] + ' ● ' + b, k >= 0 ? b.slice(k + 1) : b, from === 'gy');
        });
        const pick = Number.isInteger(link.mode) && per[link.mode] ? [per[link.mode]] : per;
        for (const k of ['ash', 'belle', 'dominus', 'purge']) cls[k] = pick.every((x) => x[k]);
      }
    }
    return {
      index, link, c, e, from, res, pre, cls,
      onField: onFieldActivation(S, link, c, e),
      actField: activatedOnField(S, link, c, e),
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
    return Object.assign({ onField: info.onField, actField: info.actField, from: info.from, cannotNegate: info.cannotNegate, noResponse: info.noResponse }, info.cls,
      { ogre: !!info.onField, crow: !!(info.cls.self && info.from === 'gy'), monsterEffect: isMonsterEffect(info), spellCard: isSpellCardAct(info) });
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
  /** Cuánto vale sacar (o negar) a tu monstruo m = { inst, c } antes de que lo use: { score, reasons } */
  function removalScore(S, m) {
    if (m.inst.faceDown) return { score: 15, reasons: ['Saca un monstruo boca abajo de tu campo'] };
    const th = negatedNow(S, m.inst) || m.inst.token ? { n: 0, cont: 0 } : threat(S, m.inst, m.c);
    let score = 15 + 10 * Math.min(2, th.n) + (th.cont ? 5 : 0) + (db.isExtra(m.c) ? 5 : 0) - (m.inst.token ? 5 : 0);
    const reasons = [th.n ? 'Le quedan efectos por usar este turno' : th.cont ? 'Apaga sus efectos continuos' : 'Te quita un monstruo del campo'];
    if (S.opp.starters.includes(m.c.id)) { score += 20; reasons.unshift('Es tu starter ★'); }
    return { score, reasons };
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
  /** ¿Un efecto ("Special Summon it to your field", Hecahands Godos) puede Invocar este monstruo de tu Cementerio?
   * No: "Cannot be Special Summoned", "Must be Special Summoned with ..." (salvo "by a card effect"), ni los del Extra Deck,
   * los de Ritual o los "Must first be ..." que no se invocaron correctamente antes (field.js guarda properSummon). */
  function revivable(c, x) {
    if (!db.isMonster(c)) return false;
    const d = String(c.desc || '');
    if (/(?:^|\. |\n)(?:This card )?cannot be Special Summoned\./i.test(d)) return false;
    const nomi = d.match(/(?:^|\. |\n)Must be Special Summoned\b([^.]*)/i);
    if (nomi && !/by (?:a )?card effects?\b|by an effect\b/i.test(nomi[1])) return false;
    const m = (x && (x.properSummon || x.summonMethod)) || null;
    if (db.isExtra(c)) {
      const proper = c.type & T.SYNCHRO ? 'synchro' : c.type & T.XYZ ? 'xyz' : c.type & T.LINK ? 'link' : 'fusion';
      return m === proper || m === 'pendulum' || m === 'special';
    }
    if (c.type & T.RITUAL) return m === 'ritual';
    if (/Must first be (?:Special|Fusion|Synchro|Xyz|Link|Ritual) Summoned/i.test(d)) return !!m;
    return true;
  }
  /** La mejor carta de tu Cementerio para sacar de ahí (D.D. Crow, Bystial Magnamhut, Hecahands Godos): la que usa tu eslabón
   * ("this card" o su objetivo) o una con un efecto que todavía puede usar. accept(c, x) filtra las cartas que sirven.
   * → { target: { uid, link? }, score, reasons, on } | null */
  function gyPick(S, ev, lastInfo, accept) {
    const opp = S.opp;
    const chain = Array.isArray(S.chain) ? S.chain : [];
    const gy = Array.isArray(S.gy) ? S.gy : [];
    const fits = (x) => { const c = x && db.get(x.id); return !!(c && accept(c, x)); };
    const inGy = (uid) => gy.some((x) => x.uid === uid && fits(x));
    const cl = (i) => ' (CL' + (i + 1) + ')';
    let best = null;
    // Tu efecto en el Cementerio que usa "this card" (o con objetivos ahí): sacarla lo deja sin nada
    if (lastInfo && lastInfo.cls.self && lastInfo.from === 'gy' && inGy(lastInfo.link.uid)) {
      const im = impact(S, lastInfo, ev.type === 'activation');
      best = { target: { uid: lastInfo.link.uid, link: lastInfo.index }, score: im.score, reasons: im.reasons, on: q(lastInfo.c ? lastInfo.c.name : '?') + cl(lastInfo.index) };
    }
    chain.forEach((l, i) => {
      if (best || !l || l.owner === 'opp' || l.negated || !Array.isArray(l.targets)) return;
      const tu = l.targets.find(inGy);
      if (!tu) return;
      const info = linkInfo(S, l, i);
      const im = impact(S, info, false);
      best = { target: { uid: tu, link: i }, score: im.score, reasons: im.reasons, on: q(nameById(gy.find((x) => x.uid === tu).id)) + cl(i) };
    });
    if (!best) {
      // Sin eslabón: la carta de tu Cementerio con un efecto que todavía puede usar
      const R = rules();
      for (const x of gy) {
        const c = db.get(x.id);
        if (!c || !R || !fits(x)) continue;
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
    return best;
  }
  /** Al resolver: si tu eslabón usaba esa carta del Cementerio ("Special Summon this card", su objetivo), se queda sin ella. */
  function fizzleOps(S, tgt, by) {
    const ops = [];
    const tl = tgt.link != null ? S.chain[tgt.link] : null;
    if (!tl || tl.negated || tl.owner === 'opp') return ops;
    const info = linkInfo(S, tl, tgt.link);
    if ((info.cls.selfOnly && tl.uid === tgt.uid) || (Array.isArray(tl.targets) && tl.targets.includes(tgt.uid))) {
      const name = nameById((locate(S, tgt.uid) || { inst: {} }).inst.id);
      ops.push({ op: 'negateLink', index: tgt.link, by, fizzle: true });
      ops.push({ op: 'log', text: 'CL' + (tgt.link + 1) + ' ya no puede usar ' + q(name) + ': dejó tu Cementerio.' });
    }
    return ops;
  }
  /** Ghost Reaper: la carta genérica de tu Extra Deck (sin nombre de arquetipo en sus materiales) con más copias. → { id, n } | null */
  function reaperPick(S) {
    const counts = new Map();
    for (const x of Array.isArray(S.extra) ? S.extra : []) {
      const c = x && db.get(x.id);
      if (!c || !db.isExtra(c) || x.extraFaceUp || x.faceUp) continue;
      const first = String(c.desc || '').split(/\r?\n/)[0];
      if (/"/.test(first)) continue; // "1 \"Fallen of Albaz\" + 1 monster": de arquetipo, el rival no la juega
      counts.set(c.id, (counts.get(c.id) || 0) + 1);
    }
    let best = null;
    for (const [id, n] of counts) {
      const lv = db.get(id).lv;
      if (!best || n > best.n || (n === best.n && lv > best.lv)) best = { id, n, lv };
    }
    return best;
  }

  /* ---------- ¿Puede activar esta handtrap ahora? ---------- */
  const isMonsterCard = (h) => { const c = db.get(h.id); return !!(c && db.isMonster(c)); };
  /** card: la carta del rival (en la mano o, con src 'field', en su campo). */
  function canUse(S, h, ev, card, src) {
    const opp = S.opp;
    const traits = h.traits;
    const turn = turnOf(S);
    src = src || 'hand';
    if (opp.blocked[h.name] != null && Number(opp.blocked[h.name]) >= turn) return false;
    if (traits.opt && used(S, 'opt:' + h.name)) return false;
    if (traits.act && used(S, 'act:' + h.name)) return false;
    // Dominus desde la mano (atributos, el resto del Duelo) y Songs desde la mano (mano, Cementerio y destierro)
    if (monsterLock(S, h.id, src)) return false;
    if (src === 'field' && card && card.negated) return false;
    const nb = !!noBanish(S);
    const handGy = Number(opp.flags.handGyAct) === turn;
    switch (h.short) {
      case 'Imperm': return opp.field.length === 0;
      case 'Veiler': return isMain(S);
      case 'Nibiru': return isMain(S) && opp.summons >= 5 && tributable(S, h).length > 0;
      // Con el bloqueo ya puesto (o un Droll en la cadena) otro Droll no hace nada
      case 'Droll': return phaseOf(S) !== 'draw' && ((ev.type === 'add' && (ev.from || 'deck') === 'deck') || (ev.type === 'resolved' && opp.pendingDroll))
        && !locksOf(S).some((l) => l.kind === 'noDeckAdd') && !(S.chain || []).some((l) => l && l.owner === 'opp' && l.handtrap === h.name);
      // Mulcharmy: sin cartas en su campo y como mucho 2 efectos "Mulcharmy" por turno (también 2 del mismo nombre)
      case 'Fuwalos': case 'Purulia': case 'Meowls': return opp.field.length === 0 && used(S, 'mulcharmy') < 2;
      case 'Impulse': case 'Purge': return controlledCount(S) > 0;
      case 'Kuriboh': return src === 'field' ? !used(S, 'opt:' + h.name + '#2:' + card.uid) && freeBotZones(S) > 0 && hasKuribohCopy(S)
        : !used(S, 'opt:' + h.name + '#1') && freeBotZones(S) > 0;
      case 'Harmonia': case 'Phantazmay': case 'Retaliating': return freeBotZones(S) > 0;
      case 'Spark': return !nb && handGy && playerMonsters(S).length > 0;
      case 'Spiral': return handGy && playerMonsters(S).length > 0;
      case 'Magnamhut': return !nb && freeBotZones(S) > 0 && playerMonsters(S).length > 0; // Rápido solo si controlas un monstruo
      case 'Emergency': return playerMonsters(S).length > 0 && botMonsters(S).length === 0 && freeBotZones(S) > 0
        && opp.hand.some((x) => x !== card && !x.blank && !x.onChain && db.isMonster(db.get(x.id) || { type: 0 }));
      case 'Songs': return !monsterInGy(opp);
      case 'Shiina': return freeBotZones(S) > 0 && botMonsters(S).some((x) => { const c = cardOf(x); return c && (c.attribute & ATTR.WIND) && !x.faceDown; });
      case 'Gamma': case 'Delta': return botMonsters(S).length === 0;
      case 'Godos': return src === 'field' ? isMain(S) && !used(S, 'opt:' + h.name + '#2') && freeBotZones(S) > 0
        : phaseOf(S) !== 'draw' && !used(S, 'opt:' + h.name + '#1') && freeBotZones(S) > 0;
      case 'Izuna': return isMain(S) && handGy && freeBotZones(S) > 0;
      case 'Lancea': return !nb;
      case 'Contact': return freePlayerZone(S);
      case 'Shifter': return opp.gy.length === 0 && !nb && !gyRedirect(S);
      case 'Reaper': return !nb && playerMonsters(S).length > botMonsters(S).length;
      case 'Crow': return !nb;
      case 'Rescue-ACE': return src === 'field' || freeBotZones(S) > 0;
      // Griffoh: su escudo de daño no hace nada aquí y lo que Coloca necesita cartas de "Light and Darkness Ritual"
      case 'Griffoh': return false;
      // Typhoon desde la mano: controlas 2 o más Mágicas/Trampas (también boca abajo y las Escalas) y el rival ninguna
      case 'Typhoon': return playerSpellTraps(S).length >= 2 && botSpellTraps(S).length === 0;
      // Angelechy Opening to e4: solo si vas primero, en la Fase de Espera de tu primer turno (el evento 'start' del turno 1)
      case 'Opening': return ev.type === 'start' && turn === 1;
      case 'Veidos': return src === 'gy' ? !used(S, 'opt:' + h.name + '#2') && veidosArmed(S, card)
        : isMain(S) && !used(S, 'opt:' + h.name + '#1') && freePlayerZone(S) && !!fieldZoneCard(S);
      default: return true;
    }
  }
  /** Tu carta de la Zona de Campo (boca arriba o abajo) que «Veidos» puede apuntar, o null. */
  const fieldZoneCard = (S) => { const x = topOf(S, 'fz'); return x && x.owner !== 'opp' ? x : null; };
  /** ¿«Veidos» acaba de llegar de tu campo a su Cementerio (su 2.º efecto espera la próxima ventana)? */
  const veidosArmed = (S, card) => { const v = S.opp.flags.veidosGy; return !!(v && Number(v.turn) === turnOf(S) && card && v.uid === card.uid && S.opp.gy.some((x) => x.uid === card.uid)); };
  /** Lo que acabas de Invocar (evento 'summon') o lo que Invocaste mientras se resolvía la cadena (al terminar: 'resolved'). */
  const summonsOf = (S, ev) => (ev.type === 'summon' ? [{ uids: Array.isArray(ev.uids) && ev.uids.length ? ev.uids : [ev.uid].filter(Boolean),
    method: String(ev.method || 'special'), from: ev.from || {} }] : ev.type === 'resolved' ? S.opp.pendingSummons || [] : []);

  /** Todas las respuestas posibles en esta ventana: [{ name, uid, target, score, reasons, text, src? }] */
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
      if (locks.summon[m] || (locks.summon.special && isSpecialMethod(m))) return [];
    }
    const noMonsters = ev.type === 'activation' && locks.normalTrap && isNormalTrapAct(lastInfo);
    // "When ... is activated": solo justo después del eslabón recién declarado
    // (si el monstruo ya tiene los efectos negados este turno, su eslabón se resuelve negado: no gasta nada en él)
    const lastNegated = lastInfo && lastInfo.onField === 'monster' && negatedNow(S, (locate(S, last.uid) || {}).inst);
    const whenInfo = lastInfo && !lastNegated && Number(ev.link) === chain.length - 1 ? lastInfo : null;
    const pend = pendingTargets(S);
    const out = [];
    const seen = new Set();
    // Fuentes: las handtraps de su mano y sus monstruos en el campo con efectos ahí (Kuriboh, Godos, Rescue-ACE Impulse)
    const sources = [];
    for (const card of opp.hand) if (!card.blank && !card.onChain) sources.push({ card, src: 'hand' });
    for (const card of opp.field) if (isMonsterEntry(card) && card.owner !== 'player' && !card.faceDown) sources.push({ card, src: 'field' });
    // «Veidos» que mandaste de tu campo a su Cementerio: su 2.º efecto
    const vg = opp.flags.veidosGy && opp.gy.find((x) => x.uid === opp.flags.veidosGy.uid);
    if (vg) sources.push({ card: vg, src: 'gy' });
    for (const { card, src } of sources) {
      const h = defOf(card.id);
      if (!h) continue;
      const key = src === 'hand' ? h.name : src + ':' + card.uid;
      if (seen.has(key)) continue;
      seen.add(key);
      if (src === 'field' && !['Kuriboh', 'Godos', 'Rescue-ACE'].includes(h.short)) continue;
      if (!canUse(S, h, ev, card, src)) continue;
      if (noMonsters && isMonsterCard(h)) continue;
      const add = (o) => out.push(Object.assign({ name: h.name, short: h.short, uid: card.uid, id: h.id }, src !== 'hand' ? { src } : {}, o));
      const w = whenInfo && !pend.links.has(whenInfo.index) ? whenInfo : null;
      const cname = (info) => q(info.c ? info.c.name : '?');
      const cl = (info) => ' (CL' + (info.index + 1) + ')';
      const onLink = (info) => ({ link: info.index, uid: info.link.uid });
      switch (h.short) {
        case 'Ash':
        case 'Belle':
        case 'Impulse':
        case 'Purge':
        case 'Songs': {
          if (!w || w.cannotNegate) break;
          const fits = { Ash: w.cls.ash, Belle: w.cls.belle, Impulse: w.cls.dominus, Purge: w.cls.purge, Songs: w.actField === 'monster' }[h.short];
          if (!fits) break;
          // Branded Lost: no se puede negar la activación de tus cartas que Invocan por Fusión (Belle niega la activación)
          if (h.short === 'Belle' && locks.fusionAct && w.cls.summonProc && /\bFusion Summon/i.test(w.res)) break;
          const im = impact(S, w, true);
          // Belle contra tu Called by the Grave que apunta a una handtrap del rival en la cadena
          const guard = h.short === 'Belle' && opp.marks.find((m) => m.link === w.index && m.kind === 'cbtg' && pendingHist(opp, m.uid));
          if (guard) { im.score = Math.max(im.score, 85); im.reasons.unshift('Protege su ' + q(guard.name) + ' de tu ' + q(guard.by)); }
          // Dominus desde la mano: le cuesta si todavía tiene monstruos de esos atributos; Songs bloquea todos sus monstruos de la mano
          if (h.traits.lock && holdsAttr(S, h.traits.lock, card.uid)) im.score -= 15;
          if (h.short === 'Songs' && holdsMonster(S, card.uid)) im.score -= 20;
          const verb = h.short === 'Belle' ? 'niega la activación de ' : 'niega el efecto de ';
          add({ target: onLink(w), score: im.score, reasons: im.reasons, on: 'el efecto de ' + cname(w) + cl(w),
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
          add({ target: onLink(w), score, reasons, on: cname(w) + cl(w), text: 'destruye ' + cname(w) + ' (su efecto igual se resuelve)' });
          break;
        }
        case 'Veiler':
        case 'Imperm': {
          for (const m of faceUpMonsters(S)) {
            if (negatedNow(S, m.inst) || pend.uids.has(m.inst.uid) || m.inst.token || m.inst.owner === 'opp') continue;
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
        case 'Crow':
        case 'Magnamhut':
        case 'Godos': {
          if (h.short === 'Godos' && src !== 'field') {
            // Godos en la mano: si añades una carta a la mano (también robando), fuera de la Fase de Robo
            if (!((ev.type === 'add' && phaseOf(S) !== 'draw') || (ev.type === 'resolved' && opp.pendingGodos))) break;
            add({ target: {}, score: 45, reasons: ['Añadiste una carta a la mano: se pone en su campo'], on: 'tu carta añadida a la mano',
              text: 'se Invoca de modo Especial desde la mano' });
            break;
          }
          const accept = h.short === 'Crow' ? () => true
            : h.short === 'Magnamhut' ? (c) => db.isMonster(c) && !!(c.attribute & (ATTR.LIGHT | ATTR.DARK)) : revivable;
          const best = gyPick(S, ev, lastInfo, accept);
          if (!best) break;
          const gname = q(nameById(((S.gy || []).find((x) => x.uid === best.target.uid) || {}).id));
          const tail = best.target.link != null ? ' (CL' + (best.target.link + 1) + ' ya no puede usarla)' : '';
          if (h.short === 'Godos') { best.score += 10; best.text = 'se lleva ' + gname + ' de tu Cementerio a su campo' + tail; }
          else if (h.short === 'Magnamhut') best.text = 'destierra ' + gname + ' de tu Cementerio y se Invoca' + tail;
          else best.text = 'destierra ' + gname + ' de tu Cementerio' + tail;
          add(best);
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
        case 'Fuwalos':
        case 'Purulia':
        case 'Meowls': {
          // En la Fase Final ya no vas a Invocar (no robaría nada); en la de Batalla, casi nunca
          if (phaseOf(S) === 'end') break;
          const k = h.traits.mulcharmy;
          const f = opp.flags[k];
          const dup = !!(f && Number(f.turn) === turnOf(S));
          let score, reasons, text;
          if (k === 'fuwalos') {
            const fresh = opp.ssDeckExtra === 0;
            score = fresh ? 95 : Math.max(20, 60 - 10 * opp.ssDeckExtra);
            reasons = [fresh ? 'Antes de que empieces a Invocar desde el Mazo o el Extra Deck' : 'Todavía te quedan invocaciones por hacer'];
            text = 'este turno roba 1 carta cada vez que Invocas de modo Especial desde el Mazo o el Extra Deck';
          } else {
            const n = k === 'purulia' ? Number(opp.handSummons) || 0 : Number(opp.gySS) || 0;
            const top = mulAffinity(S, k);
            const place = k === 'purulia' ? 'la mano' : 'el Cementerio o el destierro';
            score = n === 0 ? top : Math.max(20, top - 35 - 10 * n);
            reasons = [n === 0 ? 'Antes de que empieces a Invocar desde ' + place : 'Todavía te quedan invocaciones por hacer'];
            if (n === 0 && top >= 70) reasons.push('Tu mazo Invoca mucho desde ' + place);
            text = k === 'purulia' ? 'este turno roba 1 carta cada vez que Invocas de modo Normal o Especial desde la mano'
              : 'este turno roba 1 carta cada vez que Invocas de modo Especial desde el Cementerio o el destierro';
          }
          if (dup) { score -= 25; reasons.push('Ya tiene ese efecto activo: robará el doble'); }
          if (phaseOf(S) === 'battle') score = Math.min(score, 15);
          add({ target: {}, score, reasons, on: ev.type === 'start' ? 'el inicio de tu turno' : 'tu turno', text });
          break;
        }
        case 'Kuriboh': {
          if (!w) break;
          if (src === 'field') {
            // Ya en su campo: cuando un monstruo tuyo activa su efecto en el campo, Invoca otra copia y le deja el ATK en 0
            if (w.actField !== 'monster') break;
            add({ target: onLink(w), eff: 2, score: 25, reasons: ['Pone otro monstruo en su campo y te baja el ATK'], on: cname(w) + cl(w),
              text: 'Invoca otra ' + q(KURIBOH) + ' (o un monstruo de 300 ATK/200 DEF) de su Mazo o Cementerio y deja en 0 el ATK de ' + cname(w) });
          } else {
            if (!isMonsterEffect(w)) break;
            add({ target: onLink(w), eff: 1, score: 22, reasons: ['Se pone en su campo sin costo'], on: 'el efecto de ' + cname(w) + cl(w),
              text: 'se Invoca de modo Especial desde la mano' });
          }
          break;
        }
        case 'Harmonia': {
          if (!w || w.actField !== 'monster') break;
          // Si el costo lo sacó del campo, destruye a otro (lo elige al resolverse)
          const loc = w.onField === 'monster' ? locate(S, w.link.uid) : null;
          const m = loc && { inst: loc.inst, c: w.c };
          let score = 35;
          const reasons = [m ? 'Destruye a tu monstruo que activó su efecto' : 'Se pone en su campo y destruye 1 monstruo tuyo'];
          if (opp.starters.includes(w.c.id)) { score += 20; reasons.unshift('Es tu starter ★'); }
          if (db.isExtra(w.c)) score += 10;
          if (m && threat(S, m.inst, m.c).n > 1) score += 8;
          if (!m || shieldOf(S, m.inst, ['affect', 'destroy'], h)) score -= 15; // tendrá que destruir otro
          add({ target: onLink(w), score, reasons, on: cname(w) + cl(w), text: 'se Invoca de modo Especial y destruye 1 monstruo de tu campo' });
          break;
        }
        case 'Spark':
        case 'Spiral': {
          let best = null;
          for (const m of playerMonsters(S)) {
            if (m.inst.owner === 'opp' || pend.uids.has(m.inst.uid)) continue;
            if (shieldOf(S, m.inst, ['target', 'affect'], h)) continue;
            const r = removalScore(S, m);
            r.score += 15; // sacarlo del campo es para siempre
            if (h.short === 'Spiral' && db.isExtra(m.c)) { r.score += 10; r.reasons.push('Vuelve al Extra Deck: pierdes esa invocación'); }
            if (!best || r.score > best.score) best = Object.assign(r, { m });
          }
          if (!best) break;
          const name = best.m.inst.faceDown ? 'tu monstruo boca abajo' : q(best.m.c.name);
          if (h.traits.lock && holdsAttr(S, h.traits.lock, card.uid)) best.score -= 15;
          add({ target: { uid: best.m.inst.uid }, score: best.score, reasons: best.reasons, on: name,
            text: h.short === 'Spark' ? 'destierra ' + name + ' de tu campo' : 'devuelve ' + name + (db.isExtra(best.m.c) ? ' a tu Extra Deck' : ' a tu mano') });
          break;
        }
        case 'Emergency': {
          // Invoca (con los efectos negados) lo que menos le sirve de la mano: no gasta así una handtrap que todavía puede usar
          const m = leastValuable(S, opp.hand, (x) => x !== card && !x.blank && db.isMonster(db.get(x.id) || { type: 0 }));
          if (!m || keepValue(S, m) > 1) break;
          add({ target: {}, score: 25, reasons: ['Pone monstruos en su campo para Invocar por Sincronía'], on: 'tu campo',
            text: 'Invoca de modo Especial 1 monstruo de su mano (con sus efectos negados)' });
          break;
        }
        case 'Shiina': {
          if (!w) break;
          if (isMonsterEffect(w)) {
            const n = faceUpMonsters(S).filter((m) => m.inst.owner !== 'opp').length;
            if (!n) break;
            add({ target: Object.assign(onLink(w), { mode: 'monster' }), score: Math.min(100, 40 + 12 * n), reasons: ['Devuelve a la mano tus ' + n + ' monstruo' + (n === 1 ? '' : 's') + ' boca arriba'],
              on: 'el efecto de ' + cname(w) + cl(w), text: 'se Invoca y devuelve a la mano todos los monstruos boca arriba del campo' });
          } else {
            const n = playerSpellTraps(S).length;
            if (!n) break;
            add({ target: Object.assign(onLink(w), { mode: 'st' }), score: Math.min(100, 30 + 10 * n), reasons: ['Devuelve a la mano tus ' + n + ' Mágica' + (n === 1 ? '' : 's') + '/Trampa' + (n === 1 ? '' : 's')],
              on: cname(w) + cl(w), text: 'se Invoca y devuelve a la mano todas las Mágicas/Trampas del campo' });
          }
          break;
        }
        case 'Gamma':
        case 'Delta': {
          if (!w || w.cannotNegate) break;
          if (h.short === 'Gamma' ? !isMonsterEffect(w) : !isSpellCardAct(w)) break;
          const im = impact(S, w, true);
          // Solo destruye la carta si sigue boca arriba en tu campo (no la que activó su efecto en la mano o se fue como costo)
          const kill = h.short === 'Gamma' ? (w.onField === 'monster' ? ' y destruye ese monstruo' : '')
            : (() => { const l = locate(S, w.link.uid); return l && l.area === 'field' && !l.inst.faceDown ? ' y destruye esa Mágica' : ''; })();
          add({ target: onLink(w), score: im.score + 15, reasons: im.reasons.concat([kill ? 'Niega y destruye' : 'Niega la activación']), on: (h.short === 'Gamma' ? 'el efecto de ' : '') + cname(w) + cl(w),
            text: 'Invoca a ' + q(h.name) + ' y ' + q(nameById(SUPPORT.driver)) + ', niega la activación de ' + cname(w) + cl(w) + kill });
          break;
        }
        case 'Mourner': {
          let best = null;
          for (const s of summonsOf(S, ev)) {
            if (!isSpecialMethod(s.method)) continue;
            for (const uid of s.uids) {
              const loc = locate(S, uid);
              if (!loc || loc.area !== 'field' || loc.inst.faceDown || loc.inst.owner === 'opp' || negatedNow(S, loc.inst) || pend.uids.has(uid)) continue;
              const c = db.get(loc.inst.id);
              if (!c || !db.isMonster(c) || shieldOf(S, loc.inst, ['target', 'affect'], h)) continue;
              const r = removalScore(S, { inst: loc.inst, c });
              r.score += 10;
              if (!best || r.score > best.score) best = Object.assign(r, { uid, c });
            }
          }
          if (!best) break;
          add({ target: { uid: best.uid }, score: best.score, reasons: best.reasons, on: q(best.c.name),
            text: 'niega los efectos de ' + q(best.c.name) + ' este turno; si deja el campo, recibes ' + originalStats({ id: best.c.id }).atk + ' de daño' });
          break;
        }
        case 'Izuna': {
          add({ target: {}, score: 25, reasons: ['Activaste un efecto de monstruo en la mano o el Cementerio'], on: 'tu turno',
            text: 'se Invoca de modo Especial desde la mano' });
          break;
        }
        case 'Phantazmay': {
          const link = summonsOf(S, ev).some((s) => isSpecialMethod(s.method) && s.uids.some((u) => { const l = locate(S, u); const c = l && db.get(l.inst.id); return !!(c && c.isLink); }));
          if (!link) break;
          add({ target: {}, score: 50, reasons: ['Invocaste un monstruo Link: roba cartas'], on: 'tu Invocación Link', text: 'se Invoca, roba cartas y devuelve otras a su Mazo' });
          break;
        }
        case 'Lancea': {
          if (!(ev.type === 'start' || (ev.type === 'activation' && w))) break;
          const nc = countText(S, 'banishCost', banishCost);
          const now = !!(w && (w.cls.banish || w.cls.banishGY));
          if (!nc && !now) break; // tu mazo no destierra: el bloqueo no haría nada
          let score = 20 + 8 * nc;
          const reasons = nc ? ['Tu mazo destierra como costo'] : [];
          if (now) { score += 25; reasons.unshift(cname(w) + ' destierra al resolverse'); }
          add({ target: w ? onLink(w) : {}, score: Math.min(90, score), reasons, on: w ? 'el efecto de ' + cname(w) + cl(w) : 'el inicio de tu turno',
            text: 'este turno nadie puede desterrar cartas' });
          break;
        }
        case 'Contact': {
          if (ev.type !== 'summon' || SET_METHODS.includes(String(ev.method || 'special'))) break;
          // Sin monstruos boca abajo en tu Extra Deck no traba nada (y te regala un monstruo)
          const ne = (S.extra || []).filter((x) => { const c = db.get(x.id); return c && db.isExtra(c) && !x.extraFaceUp && !x.faceUp; }).length;
          if (!ne) break;
          add({ target: {}, score: 45 + (ne >= 6 ? 10 : 0), reasons: ['Te traba las invocaciones desde el Extra Deck'], on: 'tu Invocación',
            text: 'se Invoca en tu campo en Defensa; mientras esté ahí, solo puedes Invocar por Fusión, Sincronía, Xyz o Link si la usas como material' });
          break;
        }
        case 'Retaliating': {
          if (!w || !(w.link.cardAct && w.c && db.isSpell(w.c) && w.cls.ss)) break;
          if (noBanish(S)) break; // con «Artifact Lancea» activo nadie destierra: su reemplazo no haría nada
          add({ target: onLink(w), score: Math.min(85, 30 + 3 * countText(S, 'gy', GY_AFFINITY)), reasons: ['Tu mazo usa el Cementerio'], on: cname(w) + cl(w),
            text: 'se Invoca y, mientras esté boca arriba, las cartas que van al Cementerio quedan desterradas' });
          break;
        }
        case 'Shifter': {
          if (phaseOf(S) === 'end') break; // en tu Fase Final ya casi no mandas cartas al Cementerio
          add({ target: {}, score: Math.min(95, 40 + 3 * countText(S, 'gy', GY_AFFINITY)), reasons: ['Tu mazo usa el Cementerio'], on: 'tu turno',
            text: 'hasta el final del próximo turno, las cartas que van al Cementerio quedan desterradas' });
          break;
        }
        case 'Reaper': {
          const p = reaperPick(S);
          if (!p) break;
          add({ target: { id: p.id }, score: Math.min(90, 40 + 15 * p.n), reasons: ['Tienes ' + p.n + ' copia' + (p.n === 1 ? '' : 's') + ' de ' + q(nameById(p.id)) + ' en el Extra Deck'],
            on: 'tu Extra Deck', text: 'destierra todas las copias de ' + q(nameById(p.id)) + ' de tu Extra Deck' });
          break;
        }
        case 'Rescue-ACE': {
          if (!w || w.actField !== 'monster') break;
          add({ target: onLink(w), score: 35, reasons: ['Pone a ' + q(nameById(SUPPORT.fire)) + ' en su campo'], on: cname(w) + cl(w),
            text: 'se sacrifica e Invoca a ' + q(nameById(SUPPORT.fire)) + ' desde su Mazo' });
          break;
        }
        case 'Skull': {
          // "When a card effect is activated in your opponent's GY": un efecto (no la activación de una carta) activado en tu Cementerio
          if (!w || w.cannotNegate || w.from !== 'gy' || w.link.cardAct || w.link.scale) break;
          const im = impact(S, w, true);
          add({ target: onLink(w), score: im.score, reasons: im.reasons, on: 'el efecto de ' + cname(w) + cl(w), text: 'niega el efecto de ' + cname(w) + cl(w) });
          break;
        }
        case 'Typhoon': {
          // Tu Mágica/Trampa boca arriba que más vale sacar: Campo, Continua, de Equipo o Escala con efectos que todavía puedes usar
          let best = null;
          const onChain = new Set(chain.filter((l) => l && l.owner !== 'opp' && !l.negated).map((l) => l.uid));
          for (const z of [...ST, 'fz']) {
            const inst = topOf(S, z);
            const c = inst && !inst.faceDown && inst.owner !== 'opp' ? db.get(inst.id) : null;
            if (!c || pend.uids.has(inst.uid)) continue;
            const lasting = db.isMonster(c) || z === 'fz' || !!(c.type & (T.CONTINUOUS | T.FIELD | T.EQUIP));
            if (!lasting) continue; // una Mágica Normal o de Juego Rápido en la cadena se va igual
            if (shieldOf(S, inst, ['target', 'affect', 'destroy'], h)) continue;
            const th = negatedNow(S, inst) ? { n: 0, cont: 0 } : threat(S, inst, c);
            let score = 30 + 10 * Math.min(2, th.n) + (th.cont ? 5 : 0);
            const reasons = [z === 'fz' ? 'Saca tu Mágica de Campo' : db.isMonster(c) ? 'Saca tu Escala de Péndulo' : 'Saca tu Mágica/Trampa boca arriba'];
            if (th.n) reasons.push('Le quedan efectos por usar este turno');
            if (opp.starters.includes(c.id)) { score += 20; reasons.unshift('Es tu starter ★'); }
            if (onChain.has(inst.uid)) { score += 10; reasons.push('Su efecto está en la cadena'); }
            if (!best || score > best.score) best = { score, reasons, inst, c };
          }
          if (!best) break;
          add({ target: { uid: best.inst.uid }, score: best.score, reasons: best.reasons, on: q(best.c.name), text: 'destruye ' + q(best.c.name) + ' de tu campo' });
          break;
        }
        case 'Opening': {
          add({ target: {}, score: 100, reasons: ['Vas primero: es la Fase de Espera de tu primer turno'], on: 'el inicio de tu turno',
            text: 'pone en su campo «Angelechy Problem», «Angelechy Destrier» y «Angelechy Bastion» con «Angelechy Shatranga»' });
          break;
        }
        case 'Veidos': {
          if (src === 'gy') {
            // 2.º efecto: la mandaste de tu campo a su Cementerio → destruye todos los monstruos del campo
            const n = playerMonsters(S).filter((m) => m.inst.owner !== 'opp' && !shieldOf(S, m.inst, ['affect', 'destroy'], h)).length;
            if (!n) break;
            add({ target: {}, eff: 2, score: 90, reasons: ['La mandaste de tu campo a su Cementerio', 'Destruye ' + n + ' monstruo' + (n === 1 ? '' : 's') + ' tuyo' + (n === 1 ? '' : 's')],
              on: 'tus monstruos', text: 'destruye todos los monstruos del campo' });
            break;
          }
          const inst = fieldZoneCard(S);
          const c = inst && db.get(inst.id);
          if (!c || pend.uids.has(inst.uid) || shieldOf(S, inst, ['target', 'affect', 'destroy'], h)) break;
          let score = 45;
          const reasons = ['Destruye tu carta de la Zona de Campo'];
          const th = inst.faceDown || negatedNow(S, inst) ? { n: 0, cont: 0 } : threat(S, inst, c);
          if (th.n || th.cont) { score += 20; reasons.push(th.n ? 'Le quedan efectos por usar este turno' : 'Apaga sus efectos continuos'); }
          if (!inst.faceDown && opp.starters.includes(c.id)) { score += 20; reasons.unshift('Es tu starter ★'); }
          if (chain.some((l) => l && l.owner !== 'opp' && !l.negated && l.uid === inst.uid)) { score += 10; reasons.push('Su efecto está en la cadena'); }
          const name = inst.faceDown ? 'tu carta boca abajo de la Zona de Campo' : q(c.name);
          add({ target: { uid: inst.uid }, eff: 1, score, reasons, on: name,
            text: 'se Invoca en tu campo y destruye ' + name + '; después añade «Ashened for Eternity» de su Mazo a la mano' });
          break;
        }
        default: break;
      }
    }
    // Poner un monstruo en su campo apaga lo que pide un campo vacío: «Infinite Impermanence» desde la mano y los Mulcharmy
    // ("if you control no cards"), Gamma, Delta y Synchro Emergency ("if you control no monsters"). Si todavía puede usar
    // alguna, la respuesta pierde puntos; si no le queda nada, no la ofrece.
    const fieldEmpty = !opp.field.some((x) => x && !x.onChain), noMons = botMonsters(S).length === 0;
    if (!fieldEmpty && !noMons) return out;
    return out.filter((o) => {
      if (!FILLS_FIELD.includes(o.short)) return true;
      const lost = [];
      for (const x of opp.hand) {
        if (x.blank || x.onChain || x.uid === o.uid) continue;
        const h2 = defOf(x.id);
        if (!h2 || lost.includes(h2.name) || (h2.traits.mulcharmy && phaseOf(S) === 'end')) continue;
        const needs = NEEDS_NO_CARDS.includes(h2.short) ? fieldEmpty : NEEDS_NO_MONSTERS.includes(h2.short) ? noMons : false;
        if (needs && canUse(S, h2, ev, x, 'hand')) lost.push(h2.name);
      }
      if (!lost.length) return true;
      o.score -= Math.min(40, 20 * lost.length);
      o.reasons = o.reasons.concat(['Deja sin usar ' + lost.map(q).join(', ')]);
      return o.score > 0;
    });
  }
  // Respuestas que dejan un monstruo en su campo y handtraps que piden que no controle cartas / monstruos
  const FILLS_FIELD = ['Kuriboh', 'Harmonia', 'Nibiru', 'Magnamhut', 'Emergency', 'Shiina', 'Gamma', 'Delta', 'Godos', 'Izuna', 'Phantazmay', 'Retaliating', 'Rescue-ACE'];
  const NEEDS_NO_CARDS = ['Imperm', 'Fuwalos', 'Purulia', 'Meowls'];
  const NEEDS_NO_MONSTERS = ['Gamma', 'Delta', 'Emergency'];
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
    if (ev.type === 'resolved') { opp.pendingDroll = false; opp.pendingGodos = false; opp.pendingSummons = []; } // solo justo después
    // El 2.º efecto de «Veidos» se activa en la primera ventana después de llegar al Cementerio (no en medio de una resolución):
    // si no lo usa ahí, se pierde
    const open = ev.type === 'activation' || !(Array.isArray(S.chain) && S.chain.length);
    const vg = opp.flags.veidosGy;
    if (vg && (Number(vg.turn) !== turnOf(S) || open)) delete opp.flags.veidosGy;
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
    const how = pick.src === 'field' ? ' en su campo' : pick.src === 'gy' ? ' en su Cementerio' : h.traits.trap ? ' desde la mano' : '';
    const r = {
      handtrap: h.name, short: h.short, uid: pick.uid, id: h.id, target: Object.assign({}, pick.target), speed: 2,
      text: 'El rival activa ' + q(h.name) + how + ': ' + pick.text,
      reason: reasons.filter(Boolean).join('. ') + '.',
      on: pick.on, score: pick.score, threshold: opp.mode === 'aggressive' ? null : thr, mode: opp.mode,
    };
    if (pick.src) r.src = pick.src;
    if (pick.eff) r.eff = pick.eff;
    return r;
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
    const src = r.src === 'field' || r.src === 'gy' ? r.src : 'hand';
    const card = h && (src === 'field' ? opp.field : src === 'gy' ? opp.gy : opp.hand).find((x) => x.uid === r.uid);
    if (!card) return null;
    const turn = turnOf(S);
    if (src === 'gy') delete opp.flags.veidosGy; // «Veidos» activa su efecto en el Cementerio: se queda ahí
    else if (src === 'field') {
      if (h.short === 'Rescue-ACE' || h.short === 'Lancea') { takeFrom(opp.field, card.uid); botToGy(S, { uid: card.uid, id: card.id }); } // Sacrificarla del campo
    } else if (h.traits.trap) { takeFrom(opp.hand, card.uid); card.onChain = true; opp.field.push(card); } // Trampa desde la mano: al campo mientras se resuelve
    else if (h.traits.self) card.onChain = true; // se Invoca a sí misma: queda en la mano (revelada) hasta resolverse
    else { takeFrom(opp.hand, card.uid); botToGy(S, card); } // descartarla / sacrificarla / mandarla al Cementerio es el costo
    if (h.traits.opt) spend(S, 'opt:' + h.name);
    if (h.traits.act) spend(S, 'act:' + h.name);
    if (h.traits.mulcharmy) spend(S, 'mulcharmy');
    if (h.short === 'Kuriboh') spend(S, 'opt:' + h.name + (src === 'field' ? '#2:' + card.uid : '#1'));
    if (h.short === 'Godos') spend(S, 'opt:' + h.name + (src === 'field' ? '#2' : '#1'));
    if (h.short === 'Veidos') spend(S, 'opt:' + h.name + (src === 'gy' ? '#2' : '#1'));
    // Dominus desde la mano: el resto del Duelo no activa efectos de monstruos de esos atributos
    if (h.traits.lock && src === 'hand') opp.flags.attrLock = (Number(opp.flags.attrLock) || 0) | h.traits.lock;
    if (h.short === 'Songs') opp.flags.songsUntil = turn + 1; // hasta el final del próximo turno
    if (h.short === 'Droll') opp.pendingDroll = false;
    if (h.short === 'Godos' && src === 'hand') opp.pendingGodos = false;
    if (!Array.isArray(S.chain)) S.chain = [];
    const n = S.chain.length + 1;
    opp.history.push({ turn, name: h.name, uid: card.uid, on: r.on || '', reason: r.reason || '', negated: false, pending: true, resolved: false, cl: n });
    const what = String(r.text || '').replace(/^El rival activa «[^»]+»(?: desde la mano| en su campo| en su Cementerio)?: /, '');
    S.chain.push({
      owner: 'opp', uid: card.uid, id: h.id, effectIndex: r.eff || 1, text: what.charAt(0).toUpperCase() + what.slice(1), speed: 2, kind: 'quick',
      handtrap: h.name, target: Object.assign({}, r.target), from: src, src, hist: opp.history.length - 1,
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
  /** La carta del rival deja la cadena: las Trampas activadas van al Cementerio; los monstruos que se Invocan solos
   * (negados o sin resolverse) se quedan en la mano. */
  function leaveChain(S, uid) {
    const opp = S.opp;
    const f = opp.field.find((x) => x.uid === uid && x.onChain);
    if (f) { takeFrom(opp.field, uid); delete f.onChain; botToGy(S, f); return; }
    const hcard = opp.hand.find((x) => x.uid === uid);
    if (hcard) delete hcard.onChain;
  }
  /** Eslabón del rival negado (si field.js lo pide aparte): lo anota y su carta deja la cadena. */
  function negatedLink(S, index) {
    const opp = S && S.opp;
    const L = opp && Array.isArray(S.chain) ? S.chain[index] : null;
    if (!L || L.owner !== 'opp') return [];
    const hist = histOf(opp, L);
    if (hist) { hist.pending = false; hist.resolved = false; hist.negated = true; }
    leaveChain(S, L.uid);
    return [];
  }

  /** Una carta deja el campo del rival (índice en opp.field). how: 'destroy' | 'banish' | 'hand' | 'tribute'.
   * Los monstruos del Extra Deck (y los Angelechy puestos como Mágicas Continuas) que vuelven "a la mano" van a su Extra Deck.
   * → { text, ops } (ops para field.js: una carta tuya que se llevó vuelve a ti) */
  function leaveBotField(S, i, how, by) {
    const opp = S.opp;
    const e = opp.field[i];
    const name = nameById(e.id);
    const nb = noBanish(S);
    const ops = [];
    if (e.owner === 'player') {
      // Tu carta (Hecahands Godos): "banish it when it leaves the field"; sin poder desterrar, va a donde iba a ir
      let dest = e.banishOnLeave && !nb ? 'ban' : how === 'hand' ? 'hand' : how === 'banish' && !nb ? 'ban' : 'gy';
      if (dest === 'gy' && gyRedirect(S)) dest = 'ban';
      opp.field.splice(i, 1);
      // Desterrada por "banish it when it leaves the field": es por la carta que se la llevó (Godos)
      const why = dest === 'ban' && e.banishOnLeave ? e.by || by || name : by || e.by || name;
      ops.push({ op: 'returnOwned', card: e.card || { uid: e.uid, id: e.id }, dest, by: why });
      // A dónde va lo anota field.js al aplicar 'returnOwned' (una sola vez, con el destino real)
      return { text: q(name) + ' deja el campo del rival (es tuyo).', ops };
    }
    if (how === 'banish' && nb) return { text: q(name) + ' no se puede desterrar (por ' + q(nb) + '): se queda en el campo del rival.', ops };
    opp.field.splice(i, 1);
    const card = { uid: e.uid, id: e.id };
    const c = db.get(e.id);
    const mon = isMonsterEntry(e);
    let where;
    if (how === 'hand' && c && db.isExtra(c)) where = 'extra'; // a su Extra Deck (el rival no lleva la cuenta)
    else if (how === 'hand') { opp.hand.push(card); where = 'hand'; } else if (how === 'banish') { opp.ban.push(card); where = 'ban'; } else where = botToGy(S, card);
    const o = mon ? 'o' : 'a';
    let text = q(name) + ' del rival ' + (where === 'extra' ? 'vuelve a su Extra Deck' : where === 'hand' ? 'vuelve a su mano' : where === 'ban' ? 'queda desterrad' + o
      : how === 'destroy' ? 'es destruid' + o + ' y va a su Cementerio' : how === 'tribute' ? 'es sacrificad' + o + ' y va a su Cementerio' : 'va a su Cementerio') + '.';
    // Retaliating "C" mandada del campo al Cementerio: busca un Insecto TIERRA
    if (e.gyLock && where === 'gy') {
      opp.hand.push(takeSupport(S, 'blank'));
      text += ' El rival añade 1 Insecto TIERRA de su Mazo a la mano (por ' + q(name) + ').';
    }
    return { text, ops };
  }
  /** ¿«Angelechy Bastion» (boca arriba como Mágica Continua) protege a esta carta de tus efectos de destrucción? → motivo o '' */
  function bastionGuard(S, e) {
    if (!e || e.id === ANGELECHY.bastion || !isAngelechy(e.id)) return '';
    const b = S.opp.field.find((x) => x && x.id === ANGELECHY.bastion && x.zone === 'st' && !x.faceDown && !x.negated);
    return b ? 'mientras «Angelechy Bastion» siga en su Zona de Mágicas y Trampas, tus efectos no pueden destruir a las otras cartas «Angelechy».' : '';
  }
  /** La sacas con un efecto tuyo desde la franja del rival. how: 'destroy' | 'banish' | 'hand'.
   * → [{ kind: 'opp', text, ops?, refused? }] (refused: no pasa nada y text dice por qué) */
  function removeFromField(S, uid, how) {
    const opp = S && S.opp;
    if (!opp || !Array.isArray(opp.field)) return [];
    sync(S);
    const i = opp.field.findIndex((x) => x && x.uid === uid);
    if (i < 0) return [];
    const e = opp.field[i];
    const guard = how !== 'banish' && how !== 'hand' ? bastionGuard(S, e) : '';
    if (guard) return [{ kind: 'opp', refused: true, text: q(nameById(e.id)) + ' no se puede destruir: ' + guard }];
    if (e.onChain) {
      // Una Trampa del rival en la cadena: deja el campo (su efecto igual se resuelve)
      opp.field.splice(i, 1);
      delete e.onChain;
      const where = how === 'hand' ? (opp.hand.push(e), 'hand') : how === 'banish' && !noBanish(S) ? (opp.ban.push(e), 'ban') : botToGy(S, e);
      return [{ kind: 'opp', text: q(nameById(e.id)) + ' del rival deja el campo (' + { hand: 'a su mano', ban: 'desterrada', gy: 'a su Cementerio' }[where] + ').' }];
    }
    const r = leaveBotField(S, i, how === 'banish' || how === 'hand' ? how : 'destroy');
    const out = { kind: 'opp', text: r.text };
    if (r.ops.length) out.ops = r.ops;
    return [out];
  }
  /** Godos se lleva tu monstruo del Cementerio: field.js lo saca de S.gy y llama a esto. → entrada del registro */
  function takeControl(S, card, by) {
    const opp = S && S.opp;
    if (!opp || !card) return null;
    sync(S);
    opp.field.push({ uid: card.uid, id: card.id, monster: true, owner: 'player', banishOnLeave: true, card, by: by || '', turn: turnOf(S) });
    return { kind: 'opp', text: 'El rival Invoca ' + q(nameById(card.id)) + ' de tu Cementerio en su campo' + (by ? ' (por ' + q(by) + ')' : '') + '; se destierra cuando deje el campo.' };
  }
  /** Una carta del rival que estaba en tu campo («Contact "C"», «Veidos») vuelve a su pila. dest: 'gy' | 'ban' | 'hand' | 'deck'.
   * opts.fromField: dejó una Zona de Monstruo (no es un material Xyz desacoplado). «Veidos» mandada así a su Cementerio deja
   * listo su 2.º efecto (destruir todos los monstruos del campo) para la próxima ventana. */
  function returnCard(S, inst, dest, opts) {
    const opp = S && S.opp;
    if (!opp || !inst) return null;
    sync(S);
    const card = { uid: inst.oppUid || inst.uid, id: inst.id };
    let where = dest;
    if (dest === 'hand') opp.hand.push(card);
    else if (dest === 'deck') opp.deck.splice(Math.floor(rand(opp) * (opp.deck.length + 1)), 0, card);
    else if (dest === 'ban' && !noBanish(S)) opp.ban.push(card);
    else where = botToGy(S, card);
    const txt = { hand: 'vuelve a la mano del rival', deck: 'vuelve al Mazo del rival', ban: 'queda desterrada (es del rival)', gy: 'va al Cementerio del rival' }[where];
    let text = q(nameById(card.id)) + ' ' + txt + '.';
    const h = defOf(card.id);
    if (h && h.short === 'Veidos' && where === 'gy' && opts && opts.fromField && !used(S, 'opt:' + h.name + '#2')) {
      opp.flags.veidosGy = { uid: card.uid, turn: turnOf(S) };
      text += ' Puede activar su efecto: destruir todos los monstruos del campo.';
    }
    return { kind: 'opp', text };
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
    const log = (text) => ops.push({ op: 'log', text });
    const done = (negated) => {
      if (hist) { hist.pending = false; hist.resolved = !negated; if (negated) hist.negated = true; }
      leaveChain(S, L.uid);
      return ops;
    };
    // Ya marcado como negado en la cadena (lo hizo field.js al resolver tu eslabón): no aplica nada
    if (L.negated) {
      const nb = L.negated && L.negated.by ? ' (por ' + q(L.negated.by) + ')' : '';
      log('CL' + (index + 1) + ': ' + q(by) + ' del rival queda negado' + nb + '.');
      return done(true);
    }
    const neg = negatedByPlayer(S, index);
    if (neg) {
      L.negated = { by: neg };
      log('CL' + (index + 1) + ': ' + q(by) + ' del rival queda negado (por ' + q(neg) + ').');
      return done(true);
    }
    const tgt = L.target || {};
    const tl = tgt.link != null ? S.chain[tgt.link] : null;
    const sameLink = tl && tl.uid === tgt.uid && !tl.negated;
    const tname = (uid) => { const loc = locate(S, uid); return loc ? tokenName(loc.inst) : '?'; };
    const onField = (uid) => { const loc = locate(S, uid); return loc && loc.area === 'field' && loc.index === 0 && !paidAway(S).has(uid) ? loc : null; };
    const protectedLog = (uid, sh, verb) => log(q(by) + ' no puede ' + verb + ' ' + q(tname(uid)) + ': está protegido' + (sh !== tname(uid) ? ' (por ' + q(sh) + ')' : '') + '.');
    const nothing = (why) => log(q(by) + ' no hace nada: ' + why);
    const nb = noBanish(S);
    /** Monstruo de la mano al campo del rival; si no hay zona libre, no se Invoca. */
    const selfSummon = (extra) => {
      if (freeBotZones(S) <= 0) { log('El rival no tiene Zonas de Monstruo libres: ' + q(by) + ' no se Invoca.'); return null; }
      const e = summonFromHand(S, L.uid, by, extra);
      if (e) log('El rival Invoca de modo Especial ' + q(by) + ' en su campo' + (e.def ? ' en Defensa' : '') + '.');
      return e;
    };
    /** Destruye tu carta (si sigue en el campo y no está protegida). */
    const destroy = (uid) => {
      if (!onField(uid)) return false;
      const sh = shieldOf(S, onField(uid).inst, ['affect', 'destroy'], h);
      if (sh) { protectedLog(uid, sh, 'destruir'); return false; }
      ops.push({ op: 'destroy', uid, by });
      return true;
    };
    switch (h && h.short) {
      case 'Ash':
      case 'Belle': {
        if (sameLink) {
          ops.push({ op: 'negateLink', index: tgt.link, by });
          for (const m of opp.marks) if (m.link === tgt.link) m.cancelled = true;
        } else nothing('ese eslabón ya no está o ya fue negado.');
        break;
      }
      case 'Impulse':
      case 'Purge': {
        if (!sameLink) { nothing('ese eslabón ya no está o ya fue negado.'); break; }
        ops.push({ op: 'negateLink', index: tgt.link, by });
        // "...then if you have a Trap in your GY, destroy that card" (solo si la carta sigue en el campo)
        if (trapInGy(opp)) destroy(tl.uid);
        break;
      }
      case 'Songs': {
        if (!sameLink) { nothing('ese eslabón ya no está o ya fue negado.'); break; }
        ops.push({ op: 'negateLink', index: tgt.link, by });
        // "...then if you have a Trap in your GY, you can add 1 "Dominus" card from your Deck to your hand"
        if (trapInGy(opp)) {
          const d = takeSupport(S, 'dominus');
          if (d) { opp.hand.push(d); log('El rival añade 1 carta «Dominus» de su Mazo a la mano (por ' + q(by) + ').'); }
        }
        break;
      }
      case 'Ogre': {
        const loc = locate(S, tgt.uid);
        const sh = loc && shieldOf(S, loc.inst, ['affect', 'destroy'], h);
        if (!loc || loc.area !== 'field' || loc.index !== 0 || paidAway(S).has(tgt.uid)) nothing('esa carta ya no está en el campo.');
        else if (sh) protectedLog(tgt.uid, sh, 'destruir');
        else ops.push({ op: 'destroy', uid: tgt.uid, by });
        break;
      }
      case 'Veiler':
      case 'Imperm':
      case 'Mourner': {
        const loc = locate(S, tgt.uid);
        if (!loc || loc.area !== 'field' || loc.index !== 0 || !MZ.includes(loc.zone) || loc.inst.faceDown || paidAway(S).has(tgt.uid)) {
          nothing('ese monstruo ya no está boca arriba en el campo.');
          break;
        }
        const sh = shieldOf(S, loc.inst, ['target', 'affect'], h);
        if (sh) {
          log(q(by) + ' no le hace nada a ' + q(tname(tgt.uid)) + ': está protegido' + (sh !== tname(tgt.uid) ? ' (por ' + q(sh) + ')' : '') + '.');
          break;
        }
        ops.push({ op: 'negateMonster', uid: tgt.uid, by });
        if (h.short === 'Mourner') {
          // Si ese monstruo deja el campo este turno, recibes daño igual a su ATK original (lo mira observe)
          const atk = originalStats(loc.inst).atk;
          opp.flags.mourner = { uid: tgt.uid, atk, turn: turnOf(S), name: tname(tgt.uid) };
          log('Si ' + q(tname(tgt.uid)) + ' deja el campo este turno, recibes ' + atk + ' de daño (por ' + q(by) + ').');
        }
        // Sus efectos activados en el campo que siguen en la cadena (más abajo) también quedan negados
        for (let j = index - 1; j >= 0; j--) {
          const P = S.chain[j];
          if (!P || P.owner === 'opp' || P.negated || P.uid !== tgt.uid) continue;
          if (onFieldActivation(S, P, db.get(P.id), effectOf(P).e) === 'monster') ops.push({ op: 'negateLink', index: j, by });
        }
        break;
      }
      case 'Crow':
      case 'Magnamhut': {
        const inGy = (S.gy || []).some((x) => x.uid === tgt.uid);
        if (nb) { nothing('nadie puede desterrar este turno (por ' + q(nb) + ').'); break; }
        if (!inGy) { nothing('esa carta ya no está en tu Cementerio.'); break; }
        ops.push(...fizzleOps(S, tgt, by));
        ops.unshift({ op: 'banish', uid: tgt.uid, by });
        if (h.short === 'Magnamhut') {
          if (selfSummon()) log('En la Fase Final el rival añadirá 1 monstruo Dragón de su Mazo o Cementerio a la mano (por ' + q(by) + ').');
        }
        break;
      }
      case 'Godos': {
        if (L.src !== 'field') { selfSummon(); break; }
        const x = (S.gy || []).find((g) => g.uid === tgt.uid);
        const c = x && db.get(x.id);
        if (!c || !db.isMonster(c)) { nothing('ese monstruo ya no está en tu Cementerio.'); break; }
        if (!revivable(c, x)) { nothing(q(c.name) + ' no se puede Invocar de modo Especial así.'); break; }
        if (freeBotZones(S) <= 0) { nothing('no tiene Zonas de Monstruo libres.'); break; }
        ops.push(...fizzleOps(S, tgt, by));
        ops.unshift({ op: 'steal', uid: tgt.uid, by });
        break;
      }
      case 'Nibiru': {
        // "Tribute as many face-up monsters on the field as possible": los tuyos (op) y también los suyos
        const mons = tributable(S, h);
        const own = S.opp.field.filter((x) => isMonsterEntry(x) && !x.faceDown);
        if (!mons.length && !own.length) { log('No hay monstruos boca arriba para sacrificar: ' + q(by) + ' no se invoca.'); break; }
        let atk = 0, def = 0;
        for (const m of mons) { const s = originalStats(m.inst); atk += s.atk; def += s.def; }
        for (const x of own) { const s = originalStats({ id: x.id }); atk += s.atk; def += s.def; }
        if (mons.length) ops.push({ op: 'tributeAll', by, uids: mons.map((m) => m.inst.uid) });
        for (const x of own) {
          const r = leaveBotField(S, opp.field.indexOf(x), 'tribute', by);
          ops.push(...r.ops);
          log(r.text);
        }
        ops.push({ op: 'token', name: TOKEN_NAME, id: TOKEN_ID, atk, def, level: 11, attribute: ATTR.LIGHT, race: 0x100, position: 'def', by });
        const n = mons.length + own.length;
        log(q(by) + ' sacrifica ' + n + ' monstruo' + (n === 1 ? '' : 's') + (own.length ? ' (' + own.length + ' del rival)' : '') + ' y te deja un ' + q(TOKEN_NAME)
          + ' (ATK ' + atk + ' / DEF ' + def + ') en Defensa.');
        const nib = takeFrom(opp.hand, L.uid);
        if (nib) { delete nib.onChain; toField(S, nib, by); }
        break;
      }
      case 'Droll': {
        const text = 'Por ' + q(by) + ', este turno no se pueden añadir cartas del Mazo a la mano.';
        ops.push({ op: 'lock', lock: { kind: 'noDeckAdd', source: by, text }, by });
        log(text);
        break;
      }
      case 'Fuwalos':
      case 'Purulia':
      case 'Meowls': {
        const k = h.traits.mulcharmy;
        const f = opp.flags[k];
        opp.flags[k] = { turn: turnOf(S), n: f && Number(f.turn) === turnOf(S) ? (Number(f.n) || 0) + 1 : 1 };
        log('Este turno el rival roba 1 carta cada vez que ' + (k === 'fuwalos' ? 'Invocas de modo Especial desde el Mazo o el Extra Deck'
          : k === 'purulia' ? 'Invocas de modo Normal o Especial desde la mano' : 'Invocas de modo Especial desde el Cementerio o el destierro')
          + (opp.flags[k].n > 1 ? ' (×' + opp.flags[k].n + ')' : '') + '.');
        break;
      }
      case 'Kuriboh': {
        if (L.src !== 'field') { selfSummon(); break; }
        const copy = freeBotZones(S) > 0 ? takeSupport(S, 'kuriboh') : null;
        if (!copy) { nothing('no le queda otra copia (ni un monstruo de 300 ATK/200 DEF) en el Mazo ni en el Cementerio.'); break; }
        toField(S, copy, by);
        log('El rival Invoca ' + (copy.id === h.id ? 'otra ' + q(KURIBOH) : q(nameById(copy.id))) + ' de su Mazo o Cementerio en su campo.');
        const loc = tl && onField(tl.uid);
        if (loc && !loc.inst.faceDown && MZ.includes(loc.zone)) {
          const sh = shieldOf(S, loc.inst, ['affect'], h);
          if (sh) protectedLog(tl.uid, sh, 'cambiar el ATK de');
          else ops.push({ op: 'setAtk', uid: tl.uid, atk: 0, by });
        }
        break;
      }
      case 'Harmonia': {
        if (!selfSummon()) break;
        log('El rival manda 1 Monstruo de Sincronía revelado de su Extra Deck al Cementerio (por ' + q(by) + ').');
        // Destruye 1 monstruo tuyo (sin apuntar): el que activó su efecto si sigue ahí, o el más peligroso
        const ok = (inst) => inst && inst.owner !== 'opp' && !shieldOf(S, inst, ['affect', 'destroy'], h);
        let uid = null;
        const first = tl && onField(tl.uid);
        if (first && MZ.includes(first.zone) && ok(first.inst)) uid = tl.uid;
        else {
          let bs = -1;
          for (const m of playerMonsters(S)) { if (!ok(m.inst)) continue; const s = removalScore(S, m).score; if (s > bs) { bs = s; uid = m.inst.uid; } }
        }
        if (uid) ops.push({ op: 'destroy', uid, by });
        else log(q(by) + ' no encuentra un monstruo tuyo que pueda destruir.');
        break;
      }
      case 'Spark':
      case 'Spiral': {
        const loc = onField(tgt.uid);
        if (!loc || !MZ.includes(loc.zone)) { nothing('ese monstruo ya no está en tu campo.'); break; }
        const sh = shieldOf(S, loc.inst, ['target', 'affect'], h);
        if (sh) { protectedLog(tgt.uid, sh, h.short === 'Spark' ? 'desterrar' : 'devolver'); break; }
        if (h.short === 'Spark') {
          if (nb) { nothing('nadie puede desterrar este turno (por ' + q(nb) + ').'); break; }
          ops.push({ op: 'banish', uid: tgt.uid, by });
        } else ops.push({ op: 'bounce', uids: [tgt.uid], by });
        // "...then if you have no Traps in your GY, your opponent can Special Summon 1 monster from their hand / GY" (la Trampa sigue en el campo)
        if (!trapInGy(opp)) log('Puedes Invocar de modo Especial 1 monstruo de tu ' + (h.short === 'Spark' ? 'mano' : 'Cementerio') + ' (por ' + q(by) + ').');
        break;
      }
      case 'Emergency': {
        const m = leastValuable(S, opp.hand, (x) => !x.blank && db.isMonster(db.get(x.id) || { type: 0 }));
        if (!m || freeBotZones(S) <= 0) { nothing('no tiene un monstruo en la mano para Invocar.'); break; }
        takeFrom(opp.hand, m.uid);
        toField(S, m, by, { negated: true });
        log('El rival Invoca de modo Especial ' + q(nameById(m.id)) + ' desde su mano, con sus efectos negados (por ' + q(by) + ').');
        if (freeBotZones(S) > 0 && playerMonsters(S).some((x) => fromExtra(x.inst, x.c))) {
          const sy = takeSupport(S, 'synchron');
          if (sy) { toField(S, sy, by); log('El rival Invoca de modo Especial ' + q(nameById(sy.id)) + ' desde su Mazo (por ' + q(by) + ').'); }
        }
        log('Con ' + q(by) + ' en su Cementerio, el rival podría Invocar por Sincronía.');
        break;
      }
      case 'Shiina': {
        if (!selfSummon()) break;
        if (tgt.mode === 'monster') {
          const uids = faceUpMonsters(S).filter((m) => !shieldOf(S, m.inst, ['affect'], h)).map((m) => m.inst.uid);
          if (uids.length) ops.push({ op: 'bounce', uids, by });
          // Sus otros monstruos boca arriba también vuelven a la mano
          for (let i = opp.field.length - 1; i >= 0; i--) {
            const x = opp.field[i];
            if (!isMonsterEntry(x) || x.uid === L.uid || x.faceDown) continue;
            const r = leaveBotField(S, i, 'hand', by);
            ops.push(...r.ops);
            log(r.text);
          }
        } else {
          const uids = playerSpellTraps(S).filter((x) => !shieldOf(S, x, ['affect'], h)).map((x) => x.uid);
          if (uids.length) ops.push({ op: 'bounce', uids, by });
          for (let i = opp.field.length - 1; i >= 0; i--) {
            const x = opp.field[i];
            const c = cardOf(x);
            if (!c || isMonsterEntry(x)) continue;
            if (x.onChain) {
              opp.field.splice(i, 1);
              opp.hand.push(x); // su Trampa en la cadena vuelve a la mano (el efecto igual se resuelve)
              log(q(c.name) + ' del rival vuelve a su mano.');
            } else log(leaveBotField(S, i, 'hand', by).text); // su Mágica de Campo; los Angelechy como Mágicas Continuas, a su Extra Deck
          }
        }
        break;
      }
      case 'Gamma':
      case 'Delta': {
        if (freeBotZones(S) < 2) { log('El rival no tiene 2 Zonas de Monstruo libres: ' + q(by) + ' no hace nada.'); break; }
        if (!selfSummon({ banishAtEnd: true })) break;
        const dr = takeSupport(S, 'driver');
        if (dr) { toField(S, dr, by, { banishAtEnd: true }); log('El rival Invoca de modo Especial ' + q(nameById(dr.id)) + ' desde su Mazo.'); }
        if (!sameLink) { nothing('ese eslabón ya no está o ya fue negado.'); break; }
        ops.push({ op: 'negateLink', index: tgt.link, by });
        destroy(tl.uid);
        break;
      }
      case 'Izuna': {
        if (selfSummon()) log('El rival manda 1 carta «K9» de su Mazo al Cementerio (por ' + q(by) + ').');
        break;
      }
      case 'Phantazmay': {
        if (!selfSummon()) break;
        const links = playerMonsters(S).filter((m) => !m.inst.faceDown && m.c.isLink && m.inst.owner !== 'opp').length;
        let drew = 0;
        for (let i = 0; i < links + 1; i++) if (drawOne(S, by)) drew++;
        let back = 0;
        for (let i = 0; i < links; i++) {
          const x = leastValuable(S, opp.hand);
          if (!x) break;
          takeFrom(opp.hand, x.uid);
          opp.deck.push(x);
          back++;
        }
        if (back) shuffle(opp, opp.deck);
        log('El rival roba ' + drew + ' carta' + (drew === 1 ? '' : 's') + (back ? ' y devuelve ' + back + ' de su mano al Mazo' : '') + ' (por ' + q(by) + ').');
        break;
      }
      case 'Lancea': {
        const text = 'Por ' + q(by) + ', este turno nadie puede desterrar cartas.';
        ops.push({ op: 'lock', lock: { kind: 'noBanish', source: by, text }, by });
        log(text);
        break;
      }
      case 'Contact': {
        if (!freePlayerZone(S)) { log('No tienes una Zona de Monstruo libre: ' + q(by) + ' no se Invoca.'); break; }
        const c = takeFrom(opp.hand, L.uid);
        if (!c) break;
        ops.push({ op: 'giveMonster', id: c.id, uid: c.uid, position: 'def', by });
        log('El rival Invoca ' + q(by) + ' en tu campo en Defensa: no puedes Invocar por Fusión, Sincronía, Xyz ni Link sin usarla como material.');
        break;
      }
      case 'Retaliating': {
        const e = selfSummon({ gyLock: true });
        if (!e) break;
        const text = 'Por ' + q(by) + ', mientras esté boca arriba en el campo, las cartas que van al Cementerio quedan desterradas.';
        ops.push({ op: 'lock', lock: { kind: 'gyToBan', source: by, sourceUid: e.uid, text }, by });
        log(text);
        break;
      }
      case 'Shifter': {
        const until = turnOf(S) + 1;
        opp.flags.shifter = { until };
        const text = 'Por ' + q(by) + ', hasta el final del próximo turno las cartas que van al Cementerio quedan desterradas.';
        ops.push({ op: 'lock', lock: { kind: 'gyToBan', source: by, until, text }, by });
        log(text);
        break;
      }
      case 'Reaper': {
        if (nb) { nothing('nadie puede desterrar este turno (por ' + q(nb) + ').'); break; }
        const id = Number(tgt.id);
        if (!(S.extra || []).some((x) => x.id === id)) { nothing('ya no tienes ' + q(nameById(id)) + ' en el Extra Deck.'); break; }
        log('El rival revela ' + q(nameById(id)) + ' de su Extra Deck y mira el tuyo.');
        ops.push({ op: 'banishExtra', id, by });
        break;
      }
      case 'Rescue-ACE': {
        if (freeBotZones(S) <= 0) { nothing('no tiene Zonas de Monstruo libres.'); break; }
        const fa = takeSupport(S, 'fire');
        if (fa) { toField(S, fa, by); log('El rival Invoca de modo Especial ' + q(nameById(fa.id)) + ' desde su Mazo (por ' + q(by) + ').'); }
        break;
      }
      case 'Skull': {
        if (sameLink) ops.push({ op: 'negateLink', index: tgt.link, by });
        else nothing('ese eslabón ya no está o ya fue negado.');
        break;
      }
      case 'Typhoon': {
        const loc = onField(tgt.uid);
        if (!loc || !(ST.includes(loc.zone) || loc.zone === 'fz') || loc.inst.faceDown) { nothing('esa carta ya no está boca arriba en tu campo.'); break; }
        const sh = shieldOf(S, loc.inst, ['target'], h);
        if (sh) { protectedLog(tgt.uid, sh, 'destruir'); break; }
        destroy(tgt.uid);
        break;
      }
      case 'Opening': {
        // Supone que el rival juega el Extra Deck de Angelechy: Mágica de Campo, Destrier en la Zona Extra y Bastion (que pone a Shatranga)
        const t = turnOf(S);
        const place = (id, extra) => { const e = Object.assign({ uid: newUid(opp), id, by, turn: t }, extra); opp.field.push(e); return e; };
        const pb = takeSupport(S, 'blank'); // la Mágica de Campo sale de su Mazo
        place(ANGELECHY.problem, { uid: pb.uid, zone: 'fz' });
        log('El rival pone «Angelechy Problem» boca arriba en su Zona de Campo.');
        const emz = !topOf(S, 'emz1') ? 'emz1' : !topOf(S, 'emz0') ? 'emz0' : null;
        if (!emz) { log('Tus Zonas de Monstruo Extra están ocupadas: el rival no Invoca a «Angelechy Destrier».'); break; }
        const de = place(ANGELECHY.destrier, { monster: true, zone: emz });
        const side = emz === 'emz1' ? 'derecha' : 'izquierda';
        const tx1 = 'Por «Angelechy Destrier» del rival, la Zona de Monstruo Extra de la ' + side + ' está ocupada: no puedes usarla.';
        ops.push({ op: 'lock', lock: { kind: 'emzTaken', zone: emz, source: 'Angelechy Destrier', sourceUid: de.uid, text: tx1 }, by });
        log('El rival Invoca por Sincronía «Angelechy Destrier» en la Zona de Monstruo Extra de la ' + side + '.');
        place(ANGELECHY.bastion, { zone: 'st', asSpell: true });
        log('El rival pone «Angelechy Bastion» como Mágica Continua: tus efectos no pueden destruir a sus otras cartas «Angelechy».');
        const sa = place(ANGELECHY.shatranga, { zone: 'st', asSpell: true });
        const tx2 = 'Por «Angelechy Shatranga» del rival, solo puedes intentar activar hasta 5 efectos de monstruo por turno.';
        ops.push({ op: 'lock', lock: { kind: 'monsterEffectCap', max: 5, source: 'Angelechy Shatranga', sourceUid: sa.uid, text: tx2 }, by });
        log('Por «Angelechy Bastion», el rival pone «Angelechy Shatranga» como Mágica Continua.');
        opp.hand.push(takeSupport(S, 'blank'));
        log('Por «Angelechy Shatranga», el rival añade 1 Trampa «Angelechy» de su Mazo a la mano.');
        break;
      }
      case 'Veidos': {
        if (L.src === 'gy') {
          // "You can destroy all monsters on the field": los tuyos (ops) y los suyos (los manda él a su Cementerio)
          let n = 0;
          for (const m of playerMonsters(S)) {
            const sh = shieldOf(S, m.inst, ['affect', 'destroy'], h);
            if (sh) { protectedLog(m.inst.uid, sh, 'destruir'); continue; }
            ops.push({ op: 'destroy', uid: m.inst.uid, by });
            n++;
          }
          for (let i = opp.field.length - 1; i >= 0; i--) {
            if (!isMonsterEntry(opp.field[i])) continue;
            const r = leaveBotField(S, i, 'destroy', by);
            ops.push(...r.ops);
            log(r.text);
          }
          if (!n) log(q(by) + ' no destruye ningún monstruo tuyo.');
          break;
        }
        const loc = onField(tgt.uid);
        if (!loc || loc.zone !== 'fz') { nothing('esa carta ya no está en tu Zona de Campo.'); break; }
        if (!freePlayerZone(S)) { log('No tienes una Zona de Monstruo libre: ' + q(by) + ' no se Invoca.'); break; }
        const sh = shieldOf(S, loc.inst, ['target'], h);
        if (sh) { protectedLog(tgt.uid, sh, 'apuntar a'); break; }
        const v = takeFrom(opp.hand, L.uid);
        if (!v) break;
        ops.push({ op: 'giveMonster', id: v.id, uid: v.uid, position: 'def', by });
        log('El rival Invoca ' + q(by) + ' en tu campo en Defensa.');
        destroy(tgt.uid);
        const ash = takeSupport(S, 'ashened');
        if (ash) { opp.hand.push(ash); log('El rival añade ' + q(nameById(ash.id)) + ' de su Mazo a la mano (por ' + q(by) + ').'); }
        break;
      }
      default: log(q(by) + ' se resuelve.');
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
  /** Robos de un Mulcharmy activo este turno (uno por copia activa). */
  function mulDraw(S, key, name, logs) {
    const f = S.opp.flags[key];
    if (!f || Number(f.turn) !== turnOf(S)) return;
    for (let i = 0; i < (Number(f.n) || 1); i++) { const e = drawOne(S, name); if (e) logs.push(e); }
  }
  /** «Rescue-ACE Fire Attacker» en su campo: si añades una carta a la mano sin robarla, roba 2 y descarta 1 (una vez por turno). */
  function fireAttacker(S, logs) {
    const opp = S.opp;
    const fa = opp.field.find((x) => isMonsterEntry(x) && x.id === SUPPORT.fire && !x.negated && !x.faceDown);
    if (!fa || used(S, 'opt:fire') || monsterLock(S, fa.id, 'field')) return;
    spend(S, 'opt:fire');
    const name = nameById(fa.id);
    let n = 0;
    for (let i = 0; i < 2; i++) if (drawOne(S, name)) n++;
    const x = leastValuable(S, opp.hand);
    if (x) { takeFrom(opp.hand, x.uid); botToGy(S, x); }
    logs.push({ kind: 'opp', text: 'El rival roba ' + n + ' carta' + (n === 1 ? '' : 's') + (x ? ' y descarta 1' : '') + ' (por ' + q(name) + ').' });
  }

  /** Después de cada jugada tuya, antes de consider: lleva las cuentas (invocaciones para Nibiru, robos de los Mulcharmy...).
   * Devuelve entradas para el registro: [{ kind: 'opp', text, ops? }] (field.js aplica las ops sin eslabón) */
  function observe(S, ev) {
    const opp = S && S.opp;
    if (!opp || !opp.enabled || !ev) return [];
    const turn = sync(S);
    const logs = [];
    const chain = Array.isArray(S.chain) ? S.chain : [];
    switch (ev.type) {
      case 'activation': {
        const L = chain[Number(ev.link)];
        if (L && L.owner !== 'opp') {
          opp.acts++;
          markNegators(S, Number(ev.link), L);
          // Efecto de monstruo activado en la mano o el Cementerio (Dominus Spark, Dominus Spiral, K9-17 Izuna)
          const { c, e } = effectOf(L);
          const f = fromOf(S, L);
          if (c && db.isMonster(c) && !L.cardAct && !L.scale && !(e && e.pendulum) && (f === 'hand' || f === 'gy')) opp.flags.handGyAct = turn;
        }
        break;
      }
      case 'summon': {
        const method = String(ev.method || 'special');
        const uids = Array.isArray(ev.uids) && ev.uids.length ? ev.uids : [ev.uid].filter(Boolean);
        if (!SET_METHODS.includes(method)) opp.summons += uids.length || 1;
        const from = ev.from || {};
        const special = isSpecialMethod(method);
        if (special && uids.some((u) => from[u] === 'deck' || from[u] === 'extra')) {
          opp.ssDeckExtra++;
          mulDraw(S, 'fuwalos', 'Mulcharmy Fuwalos', logs);
        }
        // Purulia: Invocación Normal o Especial desde la mano (1 robo por Invocación, no por monstruo)
        if (!SET_METHODS.includes(method) && uids.some((u) => from[u] === 'hand')) {
          opp.handSummons = (Number(opp.handSummons) || 0) + 1;
          mulDraw(S, 'purulia', 'Mulcharmy Purulia', logs);
        }
        // Meowls: Invocación Especial desde el Cementerio o el destierro
        if (special && uids.some((u) => from[u] === 'gy' || from[u] === 'ban')) {
          opp.gySS = (Number(opp.gySS) || 0) + 1;
          mulDraw(S, 'meowls', 'Mulcharmy Meowls', logs);
        }
        // Durante la resolución de la cadena: los "If ..." (Mourner, Phantazmay) esperan a que termine
        if (chain.length && !SET_METHODS.includes(method)) opp.pendingSummons.push({ uids: uids.slice(), method, from: Object.assign({}, from) });
        break;
      }
      case 'add': {
        const src = ev.from || 'deck';
        if (phaseOf(S) !== 'draw') {
          if (src === 'deck') {
            opp.adds++;
            if (chain.length) opp.pendingDroll = true; // se añadió durante la resolución: Droll espera a que termine la cadena
          }
          if (chain.length) opp.pendingGodos = true; // Godos también
        }
        if (!ev.draw && phaseOf(S) !== 'damage') {
          if (chain.length) opp.pendingFire = true;
          else fireAttacker(S, logs);
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
          leaveChain(S, hst.uid);
          logs.push({ kind: 'opp', text: q(hst.name) + (ev.abandoned ? ' del rival no llegó a resolverse (la cadena quedó abierta).' : ' del rival quedó negado.') });
        }
        if (ev.abandoned) { opp.marks = []; opp.pendingFire = false; break; }
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
        if (opp.pendingFire) { opp.pendingFire = false; fireAttacker(S, logs); }
        break;
      }
      case 'phase': {
        if (ev.phase !== 'end') break;
        // Mulcharmy: una vez en la Fase Final (aunque haya varios), si tiene más de (tus cartas en el campo + 6), devuelve al Mazo al azar
        const keys = ['fuwalos', 'purulia', 'meowls'].filter((k) => opp.flags[k] && Number(opp.flags[k].turn) === turn && !opp.flags[k].endDone);
        if (keys.length && Number(opp.flags.mulEnd) !== turn) {
          opp.flags.mulEnd = turn;
          keys.forEach((k) => { opp.flags[k].endDone = true; });
          const cap = controlledCount(S) + 6;
          let n = 0;
          while (opp.hand.length > cap) {
            const i = Math.floor(rand(opp) * opp.hand.length);
            opp.deck.push(opp.hand.splice(i, 1)[0]);
            n++;
          }
          const names = keys.map((k) => q({ fuwalos: 'Mulcharmy Fuwalos', purulia: 'Mulcharmy Purulia', meowls: 'Mulcharmy Meowls' }[k])).join(', ');
          if (n) { shuffle(opp, opp.deck); logs.push({ kind: 'opp', text: 'Fase Final: el rival devuelve ' + n + ' carta' + (n === 1 ? '' : 's') + ' de la mano al Mazo (por ' + names + ').' }); }
        }
        // PSY-Framegear: en la Fase Final se destierran los monstruos que Invocó (con «Artifact Lancea» activo se quedan)
        for (let i = opp.field.length - 1; i >= 0; i--) {
          const x = opp.field[i];
          if (!x || !x.banishAtEnd || Number(x.turn) !== turn) continue;
          const r = leaveBotField(S, i, 'banish');
          if (/no se puede desterrar/.test(r.text)) x.banishAtEnd = false;
          logs.push({ kind: 'opp', text: 'Fase Final: ' + r.text });
        }
        break;
      }
      default: break;
    }
    // Ghost Mourner: si el monstruo deja el campo este turno, recibes daño igual a su ATK original
    const mo = opp.flags.mourner;
    if (mo) {
      if (Number(mo.turn) !== turn) delete opp.flags.mourner;
      else {
        const loc = locate(S, mo.uid);
        if (!loc || loc.area !== 'field') {
          delete opp.flags.mourner;
          logs.push({ kind: 'opp', text: q(mo.name || nameById((loc && loc.inst.id) || 0)) + ' dejó el campo: recibes ' + mo.atk + ' de daño (por ' + q('Ghost Mourner & Moonlit Chill') + ').',
            ops: [{ op: 'damage', amount: Number(mo.atk) || 0, by: 'Ghost Mourner & Moonlit Chill' }] });
        }
      }
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
      unused: (opp.hand || []).filter((x) => !x.blank && defOf(x.id)).map((x) => nameById(x.id)), // solo handtraps (no «Ashened for Eternity»)
      drew: Number(opp.drew) || 0,
      mode: opp.mode,
    };
  }
  /** Datos para la franja del rival: mano (con cartas cualquiera como blank), Cementerio, campo (sus monstruos con monster: true;
   * zone: 'fz' su Mágica de Campo, 'st' un Angelechy como Mágica Continua, 'emz0'/'emz1' «Angelechy Destrier» en tu Zona Extra), modo. */
  function view(S) {
    const opp = S && S.opp;
    if (!opp) return null;
    const card = (x) => (x.blank ? { uid: x.uid, blank: true, name: 'Otra carta' } : { uid: x.uid, id: x.id, name: nameById(x.id), short: shortOf(x.id), onChain: !!x.onChain });
    const fieldCard = (x) => Object.assign(card(x), isMonsterEntry(x) ? { monster: true, def: !!x.def, owner: x.owner || 'opp', by: x.by || '', negated: !!x.negated, banishAtEnd: !!x.banishAtEnd } : {},
      x.zone ? { zone: x.zone } : {}, x.asSpell ? { asSpell: true } : {});
    return {
      enabled: !!opp.enabled, mode: opp.mode, modeLabel: MODE_LABELS[opp.mode] || '', hand: opp.hand.map(card), gy: opp.gy.map(card),
      ban: opp.ban.map(card), field: opp.field.map(fieldCard), deckCount: opp.deck.length, summons: opp.summons,
    };
  }
  const isHandtrap = (name) => !!defOf(name);
  /** Handtraps que el rival sabe usar (para el editor de la lista), en el orden de la lista. */
  const supported = () => Object.values(HANDTRAPS).map((h) => Object.assign({ name: h.name, id: h.id, short: h.short, what: h.what, limit: h.limit, ot: h.ot },
    h.alias ? { alias: h.alias } : {}, h.aliases ? { aliases: h.aliases.slice() } : {}));

  YGO.bot = {
    HANDTRAPS, DEFAULT_POOL, MODE_LABELS, TOKEN_ID, TOKEN_NAME, HT_MAX, SUPPORT, ANGELECHY,
    newOpponent, normalizePool, isOldDefaultPool, observe, consider, options, commit, resolveLink, summary, view, negatedBy: negatedByPlayer,
    negatedLink, classify, classifyText, isHandtrap, supported, tokenInstance, threshold,
    takeControl, returnCard, removeFromField, lockActive, gyRedirect,
  };
})();
