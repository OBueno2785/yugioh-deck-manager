/* Duelo en línea contra otra persona (js/pvp.js). Usa la conexión de js/net.js y todo el modo VS del campo (js/duel.js,
 * js/vsview.js, js/vs.js): el rival vive en S.opp, pero aquí S.opp es solo el espejo de lo PÚBLICO de su lado, que llega
 * por la red. Cada uno es dueño de sus cartas y las mueve con las herramientas de siempre del Campo.
 *  - Lo público de tu lado sale hacia el rival después de cada dibujo ('state'): tu campo (lo boca abajo sin código), tu
 *    Cementerio, tu destierro (lo boca abajo sin código), tus Péndulos boca arriba del Extra Deck, cuántas cartas tienes en la
 *    mano, el Mazo y el Extra Deck, tus LP, el turno, la fase y tus eslabones. Nunca viaja un uid de verdad (dicen el orden
 *    de tu lista de mazo): cada carta lleva un alias al azar, y una carta que queda boca abajo recibe uno nuevo.
 *  - Lo que pasó lo cuenta quien lo hizo ('moves', sin texto: el que lo recibe arma la línea): una carta se nombra solo si
 *    se ve en el destino o en el origen; los robos no se nombran, las búsquedas del Mazo sí (como en Dueling Nexus).
 *  - Lo que un efecto tuyo le hace a una carta del rival (destruir, desterrar, devolver, negar, cambiar de posición, sus LP)
 *    se ve enseguida en tu pantalla y sale como pedido ('req'); su dueño lo aplica (solo una lista cerrada de operaciones).
 *  - La cadena es de los dos y tiene turnos: tras una activación, el otro responde o toca «Pasar»; entonces quien activó lo
 *    último encadena otra cosa o resuelve. Se resuelve de arriba abajo y cada eslabón lo resuelve su dueño.
 *  - Los ataques: quien ataca declara; quien defiende responde o toca «Seguir», y su navegador calcula el daño (sabe qué
 *    tiene boca abajo); lo que le pasa al atacante le llega como pedido.
 *  - Pasar el turno: el rival confirma antes (si estaba activando algo, espera).
 * Todo mensaje que no es 'state' lleva un número (n) y se guarda hasta que el otro confirma que lo recibió (k): si la
 * conexión se corta, al volver se manda otra vez lo que faltó. Lo que llega se aplica en orden y solo cuando el campo no
 * está a mitad de algo (eligiendo una zona o resolviendo un eslabón automático).
 * Expone window.YGO.pvp. */
(function () {
  const YGO = (window.YGO = window.YGO || {});
  const P = () => (YGO.field && YGO.field.port) || null;
  const D = () => YGO.duel || null;
  const N = () => YGO.net || null;
  const VS = () => YGO.vs || null;
  const arr = (x) => (Array.isArray(x) ? x : []);
  const own = (o, x) => typeof x === 'string' && Object.prototype.hasOwnProperty.call(o, x);
  const q = (name) => '«' + name + '»';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const V = 1; // versión del protocolo (los dos tienen que tener la misma)
  const PASS_MS = 15000;   // el pase de turno sin respuesta se cancela
  const ANSWER_MS = 8000;  // con una ventana abierta, se espera esto antes de contestar el pase de turno
  const MZ = ['mz0', 'mz1', 'mz2', 'mz3', 'mz4'];
  const EMZ = ['emz0', 'emz1'];
  const ST = ['st0', 'st1', 'st2', 'st3', 'st4'];
  const MON = [...EMZ, ...MZ];
  const FIELD = [...EMZ, ...MZ, ...ST, 'fz'];
  const PHASE_KEYS = ['draw', 'standby', 'main1', 'battle', 'main2', 'end'];
  const NAME_KEY = 'pvpName';
  const ALIAS = /^[a-z0-9]{4,20}(\.\d{1,2})?$/;
  const LK = /^k[a-z0-9]{4,24}$/;
  const GAME = ['req', 'chain', 'attack', 'battle', 'end', 'turn', 'reveal', 'moves'];
  const isLk = (x) => typeof x === 'string' && LK.test(x);

  /* ---------- Estado (fuera de S: Deshacer no lo toca) ---------- */
  // over: el duelo en línea de ahora ya terminó (o no empezó); inDuel sigue hasta el próximo (los mensajes de este aún valen)
  const freshRoom = () => ({ role: null, code: '', status: 'idle', why: '', note: '', peer: null, duelId: '', inDuel: false, over: false, first: 'coin', rematch: null });
  let room = freshRoom();
  // Sesión (una por sala): números de los mensajes y lo que falta confirmar
  let outN = 0, inN = 0, outbox = [], early = new Map(), ackTimer = null;
  // Lo que llega espera su turno (en orden) hasta que el campo no esté a mitad de algo
  let inbox = [], drainTimer = null, draining = false;
  let applied = 0;            // el último mensaje del rival ya aplicado (su número n)
  let lastStateIn = 0;        // el último 'state' aplicado (su seq)
  // Tu proyección
  let aliasPub = new Map();   // uid tuyo → alias (cartas que se ven)
  let aliasHid = new Map();   // uid tuyo → alias (boca abajo en el campo o desterradas boca abajo)
  let backs = [];             // alias → uid de las últimas proyecciones (para los pedidos que llegan)
  let lastKey = '';
  let lastLoc = null;
  let seq = 0;
  let sendTimer = null;
  // El duelo
  let remote = null;          // la última proyección del rival (ya revisada)
  let remoteKey = '';
  let seenLinks = new Set();  // eslabones del rival ya contados en el registro
  let outQ = [];              // pedidos para el rival (lo que tus efectos le hacen)
  let lastReq = 0;            // número del último pedido mandado: su proyección más vieja que eso no se aplica
  let applying = 0;
  let drew = new Set();
  let closed = new Set();
  let chain = freshChain();
  let handed = new Set();
  let negOver = {};
  let expectLp = null;
  let undoMark = false;
  let passAsk = null;         // { id, cont }: esperando que el rival confirme el pase de turno
  let lastNudge = 0;
  let bound = false;
  let pendingCode = '';
  let testHand = null;
  let mySid = '';             // esta página en esta sala (si el rival es otra persona, la numeración empieza de nuevo)
  let peerSid = '';
  let nextDeck = null;        // el mazo elegido para el próximo duelo en línea (con el selector, durante la sala)
  let stale = null, staleTimer = null;

  function freshChain() { return { c: '', phase: 'build', passed: '' }; }
  const S = () => { const p = P(); try { return p ? p.S() : null; } catch (err) { return null; } };
  const connected = () => { const n = N(); return !!(n && n.connected()); };
  const active = () => { const s = S(); return !!(s && s.vs && s.vs.pvp && s.opp && s.opp.pvp && room.inDuel && s.vs.pvp.duelId === room.duelId); };
  const rid = () => { const b = new Uint32Array(2); try { crypto.getRandomValues(b); } catch (err) { b[0] = Math.random() * 4294967296; b[1] = Math.random() * 4294967296; } return b[0].toString(36) + b[1].toString(36); };
  const peerName = () => (room.peer && room.peer.name) || 'Rival';
  const myName = () => { let n = ''; try { n = String((P().prefs() || {})[NAME_KEY] || ''); } catch (err) { n = ''; } return n.trim().slice(0, 24) || 'Jugador'; };
  const nameById = (id) => { const c = YGO.db.get(Number(id)); return c ? c.name : '?'; };
  const log = (kind, text) => { if (text) P().pushLog({ kind, text: String(text) }); };
  const turnOf = (s) => Number(s && s.turnState && s.turnState.turn) || 1;
  const int = (v, lo, hi) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo; };
  const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').slice(0, n);
  const okA = (a) => typeof a === 'string' && ALIAS.test(a);
  const theirUid = (a) => 'p' + a;
  const theirAlias = (uid) => (/^p[a-z0-9]/.test(String(uid || '')) ? String(uid).slice(1) : null);

  /* ---------- Mandar ---------- */
  function raw(msg) {
    msg.k = inN;
    const n = N();
    return !!(n && n.connected() && n.send(msg));
  }
  /** Un mensaje que tiene que llegar (con número; se vuelve a mandar al reconectar si no se confirmó). */
  function post(msg) {
    msg.n = ++outN;
    if (GAME.includes(msg.t)) msg.d = room.duelId;
    outbox.push(msg); // (sin tope: sacar uno del medio dejaría al rival esperándolo para siempre)
    raw(msg);
    return msg.n;
  }
  function prune(k) {
    if (typeof k !== 'number') return;
    if (outbox.length && outbox[0].n <= k) outbox = outbox.filter((m) => m.n > k);
  }
  /** Confirma lo recibido aunque no haya nada más que mandar (un momento después, juntando varios). */
  function ackSoon() {
    if (ackTimer) return;
    ackTimer = setTimeout(() => { ackTimer = null; raw({ t: 'ack' }); }, 600);
  }
  /** Lo pendiente (proyección y pedidos) sale ahora mismo, antes de un aviso ('chain', 'attack', 'battle'…). */
  function flush() {
    if (sendTimer) { clearTimeout(sendTimer); sendTimer = null; }
    if (!active()) return;
    sendState(false);
    if (outQ.length) {
      const ops = outQ;
      outQ = [];
      lastReq = post({ t: 'req', ops });
      P().lockUndo(); // lo que el rival aplica no se deshace
    }
  }
  function later() {
    if (sendTimer) return;
    sendTimer = setTimeout(() => { sendTimer = null; flush(); }, 0);
  }

  /* ---------- Tu lado, como lo ve el rival ---------- */
  function project() {
    const s = S();
    const pub = new Map();
    const hid = new Map();
    const A = (uid) => { let a = aliasPub.get(uid) || pub.get(uid); if (!a) a = rid(); pub.set(uid, a); return a; };
    const H = (uid) => { let a = aliasHid.get(uid) || hid.get(uid); if (!a) a = rid(); hid.set(uid, a); return a; };
    const turn = turnOf(s);
    const field = [];
    for (const z of FIELD) {
      const st = arr(s.zones && s.zones[z]);
      const x = st[0];
      if (!x) continue;
      if (x.faceDown) {
        // Boca abajo: solo dónde está y en qué posición (nada que la una a la carta que era)
        const a = H(x.uid);
        field.push({ a, zone: z, faceDown: true, def: !!x.def, id: 0, mats: st.slice(1).map((m, i) => ({ a: a + '.' + i, id: 0 })) });
        continue;
      }
      const e = { a: A(x.uid), zone: z, faceDown: false, def: !!x.def, id: Number(x.id) || 0 };
      if (x.token) e.token = { name: str(x.token.name || 'Ficha', 60), atk: int(x.token.atk, 0, 99999), def: int(x.token.def, 0, 99999), level: int(x.token.level, 0, 13), attribute: str(x.token.attribute, 12), race: str(x.token.race, 24) };
      if (typeof x.level === 'number') e.level = int(x.level, 0, 13);
      if (x.atkSet && Number(x.atkSet.turn) === turn) e.atkSet = { atk: int(x.atkSet.atk, 0, 99999), turn };
      if (x.negated && Number(x.negated.turn) === turn) e.negated = { turn };
      if (x.attackedTurn != null) e.attackedTurn = int(x.attackedTurn, 0, 9999);
      if (x.summonedTurn != null) e.summonedTurn = int(x.summonedTurn, 0, 9999);
      e.mats = st.slice(1).map((m) => ({ a: A(m.uid), id: Number(m.id) || 0 }));
      field.push(e);
    }
    const gy = arr(s.gy).map((x) => ({ a: A(x.uid), id: Number(x.id) || 0 }));
    const ban = arr(s.ban).map((x) => (x.faceDown ? { a: H(x.uid), id: 0, faceDown: true } : { a: A(x.uid), id: Number(x.id) || 0 }));
    const extraUp = arr(s.extra).filter((x) => x && x.extraFaceUp).map((x) => ({ a: A(x.uid), id: Number(x.id) || 0 }));
    // Tus eslabones (los del rival no): clave lk al azar, su número al declararlo (n) y la cadena a la que pertenecen (c)
    arr(s.chain).forEach((l, i) => {
      if (!l || l.pvp) return;
      if (!l.lk) l.lk = 'k' + rid();
      if (!l.n) l.n = i + 1;
      if (!l.c) l.c = (i > 0 && s.chain[0] && s.chain[0].c) || l.lk;
    });
    const chainOut = arr(s.chain).filter((l) => l && !l.pvp).map((l) => {
      // El origen se nombra si se ve (en el campo boca arriba, el Cementerio…); desde la mano, solo el código de la carta
      const o = { lk: l.lk, n: l.n, c: l.c, id: Number(l.id) || 0, a: pub.get(l.uid) || null, fx: int(l.effectIndex, 0, 20), kind: str(l.kind, 20), scale: !!l.scale,
        done: !!(l.done && handed.has(l.lk)) };
      if (l.negated) o.negated = { fizzle: !!l.negated.fizzle };
      // Objetivos (la marca ↯ en su lado): sus cartas por su alias; las tuyas, solo si se ven
      const t = arr(l.auto && l.auto.targetLocs).map((x) => {
        const u = String((x && x.uid) || '');
        if (theirAlias(u)) return { you: true, a: theirAlias(u) };
        return pub.get(u) ? { a: pub.get(u) } : null;
      }).filter(Boolean).slice(0, 6);
      if (t.length) o.targets = t;
      return o;
    });
    const t = s.turnState || {};
    const locks = arr(t.locks).filter((l) => l && l.kind === 'noBanish' && !l.vsShared && !l.vsEmz && !l.pvpLock).map((l) => ({ kind: 'noBanish', source: str(l.source, 60) }));
    const body = {
      turn: { turn: Number(t.turn) || 1, phase: PHASE_KEYS.includes(t.phase) ? t.phase : 'draw', mine: t.mine !== false }, ns: Number(t.normalSummons) || 0,
      lp: Math.max(0, Number(s.lp) || 0), counts: { hand: arr(s.hand).length, deck: arr(s.deck).length, extra: arr(s.extra).length },
      field, gy, ban, extraUp, chain: chainOut, locks, ap: applied,
    };
    return { body, pub, hid, locs: locsOf(s) };
  }
  /** Dónde está cada carta tuya ahora (por uid real; nunca sale de aquí). */
  function locsOf(s) {
    const m = new Map();
    const put = (x, w, z, extra) => {
      if (!x || !x.uid) return;
      m.set(x.uid, Object.assign({ w, z: z || '', fd: !!x.faceDown, df: !!x.def, id: Number(x.id) || 0, tname: x.token ? str(x.token.name, 60) : '', sm: x.summonMethod || '' }, extra || {}));
    };
    arr(s.hand).forEach((x) => put(x, 'hand'));
    arr(s.deck).forEach((x) => put(x, 'deck'));
    arr(s.extra).forEach((x) => put(x, 'extra', '', { up: !!x.extraFaceUp }));
    arr(s.gy).forEach((x) => put(x, 'gy'));
    arr(s.ban).forEach((x) => put(x, 'ban'));
    for (const z of FIELD) {
      const st = arr(s.zones && s.zones[z]);
      const down = !!(st[0] && st[0].faceDown); // los materiales de una carta boca abajo tampoco se ven
      st.forEach((x, i) => put(x, i ? 'mat' : 'field', z, i && down ? { fd: true } : null));
    }
    return m;
  }
  const isPubLoc = (l) => !!l && (l.w === 'gy' || ((l.w === 'field' || l.w === 'ban' || l.w === 'mat') && !l.fd) || (l.w === 'extra' && l.up));

  /** Lo que pasó desde la última proyección, sin nada oculto. → { moves, revealed } (revealed: se vio algo que estaba oculto) */
  function movesOf(prev, cur) {
    const out = [];
    let revealed = false;
    if (!prev) return { moves: out, revealed };
    const s = S();
    const linkUids = new Set(arr(s.chain).filter((l) => l && !l.pvp).map((l) => l.uid));
    let draws = 0;
    const ids = new Set([...prev.keys(), ...cur.keys()]);
    for (const uid of ids) {
      const b = prev.get(uid);
      const a = cur.get(uid);
      if (b && a && b.w === a.w && b.z === a.z) {
        if (a.w === 'field' && (b.fd !== a.fd || b.df !== a.df)) {
          const seen = isPubLoc(a) || isPubLoc(b);
          if (b.fd && !a.fd) revealed = true;
          out.push({ k: 'pos', zone: a.z, id: seen ? a.id : 0, tok: a.tname || '', from: { fd: b.fd, df: b.df }, to: { fd: a.fd, df: a.df }, how: a.sm === 'flip' ? 'flip' : '' });
        }
        continue;
      }
      if (b && a && b.w === 'deck' && a.w === 'hand' && drew.has(uid)) { draws++; continue; }
      if (!b && a) { if (a.w === 'field') out.push({ k: 'in', tz: a.z, id: isPubLoc(a) ? a.id : 0, tok: a.tname || '', fd: a.fd, df: a.df }); continue; }
      if (b && !a) { if (b.w === 'field') out.push({ k: 'gone', fz: b.z, id: isPubLoc(b) ? b.id : 0, tok: b.tname || '' }); continue; }
      // De un lugar a otro: el nombre solo si se ve en el destino o en el origen (y las búsquedas del Mazo)
      const search = b.w === 'deck' && a.w === 'hand';
      const seen = isPubLoc(a) || isPubLoc(b) || search;
      if (seen && !isPubLoc(b)) revealed = true;
      const how = a.w === 'field' ? (a.fd ? 'set' : a.sm || (linkUids.has(uid) ? 'activate' : '')) : '';
      out.push({ k: 'mv', from: b.w, fz: b.z, to: a.w, tz: a.z, id: seen ? a.id : 0, tok: a.tname || '', fd: a.fd, df: a.df, how });
    }
    if (draws) out.unshift({ k: 'draw', n: draws });
    drew = new Set([...drew].filter((u) => { const l = cur.get(u); return l && l.w === 'deck'; }));
    return { moves: out.slice(0, 80), revealed };
  }

  /** Tu proyección (si cambió, o con force). Sin conexión también se lleva la cuenta (lo que pasó sale numerado en 'moves'
   * y llega al volver, en orden); la proyección sale cuando hay conexión. */
  function sendState(force) {
    if (!active()) return;
    const pr = project();
    const key = JSON.stringify(pr.body);
    if (!force && key === lastKey) return;
    const mv = movesOf(lastLoc, pr.locs);
    if (undoMark) { mv.moves.unshift({ k: 'undo' }); undoMark = false; }
    // Una carta que volvió a la mano, al Mazo o boca abajo al Extra Deck es otra carta: sus alias viejos ya no la nombran
    const hiddenNow = new Set();
    pr.locs.forEach((l, u) => { if (l.w === 'hand' || l.w === 'deck' || (l.w === 'extra' && !l.up)) hiddenNow.add(u); });
    backs.forEach((bm) => bm.forEach((u, a) => { if (hiddenNow.has(u)) bm.delete(a); }));
    // Los alias de esta vuelta reemplazan a los viejos (una carta que dejó de verse pierde el suyo)
    aliasPub = pr.pub;
    aliasHid = pr.hid;
    lastKey = key;
    lastLoc = pr.locs;
    if (mv.moves.length) post({ t: 'moves', moves: mv.moves });
    // Se vio una carta que estaba oculta (una búsqueda, un volteo…): ya no se deshace
    if (mv.revealed) P().lockUndo();
    if (!connected()) { lastKey = ''; return; } // (al volver sale la proyección de ese momento)
    const back = new Map();
    pr.pub.forEach((a, u) => back.set(a, u));
    pr.hid.forEach((a, u) => back.set(a, u));
    backs.unshift(back);
    if (backs.length > 6) backs.length = 6;
    seq++;
    raw(Object.assign({ t: 'state', d: room.duelId, seq }, pr.body));
  }
  /** Una carta tuya por el alias que le diste (en una proyección reciente). */
  function mine(a) {
    if (!okA(a)) return null;
    for (const m of backs) if (m.has(a)) return m.get(a);
    return null;
  }

  /* ---------- Lo que llega del rival ---------- */
  function onMsg(m) {
    if (!m || typeof m !== 'object' || typeof m.t !== 'string') return;
    try {
      prune(m.k);
      if (m.t === 'ack') return;
      if (m.t === 'hello') { onHello(m); return; }
      if (m.t === 'deck') { onDeck(m); return; }
      if (m.t === 'state') { enqueue(m); return; }
      const n = Number(m.n);
      if (!Number.isInteger(n) || n <= inN) return; // repetido (se volvió a mandar al reconectar)
      if (n > inN + 1) { if (early.size < 5000) early.set(n, m); return; }
      accept(m);
      while (early.has(inN + 1)) { const x = early.get(inN + 1); early.delete(inN + 1); accept(x); }
    } catch (err) { console.error('YGO.pvp: no se pudo leer un mensaje del rival', m && m.t, err); }
  }
  function accept(m) {
    inN = m.n;
    ackSoon();
    switch (m.t) {
      case 'start': return onStart(m);
      case 'rematch': return onRematch(m);
      case 'chat': return onChat(m);
      case 'left': return onLeft();
      case 'startFailed': return onStartFailed(m);
      default:
        if (GAME.includes(m.t)) enqueue(m);
    }
  }
  function enqueue(m) {
    if (m.d !== room.duelId || !room.inDuel) return; // de otro duelo (el anterior a la revancha)
    inbox.push(m);
    drain();
  }
  /** Aplica lo que llegó, en orden, si el campo no está a mitad de algo (si no, un poco después). */
  function drain() {
    if (draining || !inbox.length) return;
    const p = P();
    if (!p) return;
    if (p.busy()) { drainLater(); return; }
    draining = true;
    try {
      while (inbox.length && !P().busy()) {
        const m = inbox.shift();
        try { handle(m); } catch (err) { console.error('YGO.pvp: no se pudo aplicar un mensaje del rival', m && m.t, err); }
        if (m.n) applied = m.n;
      }
    } finally { draining = false; }
    if (inbox.length) drainLater();
    if (active()) later();
  }
  function drainLater() {
    if (drainTimer) return;
    drainTimer = setTimeout(() => { drainTimer = null; drain(); }, 300);
  }
  function handle(m) {
    // El duelo en línea se reemplazó por otro sin pasar por la sala: el rival se entera (si no, se queda esperando)
    if (!active()) { if (room.inDuel && !room.over) abandon(); return; }
    switch (m.t) {
      case 'state': return onState(m);
      case 'stale': { if (m.m.seq === lastStateIn) { apply(m.m); P().render(); } return; }
      case 'moves': return onMoves(m);
      case 'req': return onReq(m);
      case 'chain': return onChain(m);
      case 'attack': return onAttack(m);
      case 'battle': return onBattle(m);
      case 'end': return onEnd(m);
      case 'turn': return onTurn(m);
      case 'reveal': return onReveal(m);
      default: return;
    }
  }

  /** La proyección del rival, revisada campo por campo (lo que no tiene la forma esperada se descarta). */
  function clean(m) {
    const card = (x) => (x && okA(x.a) ? { a: x.a, id: int(x.id, 0, 2e9) } : null);
    const t = m.turn && typeof m.turn === 'object' ? m.turn : {};
    const c = m.counts && typeof m.counts === 'object' ? m.counts : {};
    const field = [];
    const used = new Set();
    arr(m.field).slice(0, 20).forEach((e) => {
      if (!e || !okA(e.a) || !FIELD.includes(e.zone) || used.has(e.zone)) return;
      used.add(e.zone);
      const x = { a: e.a, zone: e.zone, faceDown: !!e.faceDown, def: !!e.def, id: e.faceDown ? 0 : int(e.id, 0, 2e9), mats: arr(e.mats).slice(0, 12).map(card).filter(Boolean) };
      if (!x.faceDown) {
        if (e.token && typeof e.token === 'object') x.token = { name: str(e.token.name || 'Ficha', 60), atk: int(e.token.atk, 0, 99999), def: int(e.token.def, 0, 99999), level: int(e.token.level, 0, 13), attribute: str(e.token.attribute, 12), race: str(e.token.race, 24) };
        if (typeof e.level === 'number') x.level = int(e.level, 0, 13);
        if (e.atkSet && typeof e.atkSet === 'object') x.atkSet = { atk: int(e.atkSet.atk, 0, 99999), turn: int(e.atkSet.turn, 0, 9999) };
        if (e.negated && typeof e.negated === 'object') x.negated = { turn: int(e.negated.turn, 0, 9999) };
        if (e.attackedTurn != null) x.attackedTurn = int(e.attackedTurn, 0, 9999);
        if (e.summonedTurn != null) x.summonedTurn = int(e.summonedTurn, 0, 9999);
      } else x.mats = x.mats.map((mm) => ({ a: mm.a, id: 0 }));
      field.push(x);
    });
    const chainIn = arr(m.chain).slice(0, 30).filter((l) => l && isLk(l.lk)).map((l) => ({
      lk: l.lk, n: int(l.n, 1, 99), c: isLk(l.c) ? l.c : l.lk, id: int(l.id, 0, 2e9), a: okA(l.a) ? l.a : null, fx: int(l.fx, 0, 20),
      kind: str(l.kind, 20), scale: !!l.scale, done: !!l.done, negated: l.negated && typeof l.negated === 'object' ? { fizzle: !!l.negated.fizzle } : null,
      targets: arr(l.targets).slice(0, 6).filter((y) => y && okA(y.a)).map((y) => ({ you: !!y.you, a: y.a })),
    }));
    return {
      seq: int(m.seq, 0, 1e9), ap: int(m.ap, 0, 1e9),
      turn: { turn: int(t.turn, 1, 9999), phase: PHASE_KEYS.includes(t.phase) ? t.phase : 'draw', mine: !!t.mine }, ns: int(m.ns, 0, 99),
      lp: int(m.lp, 0, 9999999), counts: { hand: int(c.hand, 0, 120), deck: int(c.deck, 0, 120), extra: int(c.extra, 0, 60) },
      field, gy: arr(m.gy).slice(0, 120).map(card).filter(Boolean),
      ban: arr(m.ban).slice(0, 120).filter((x) => x && okA(x.a)).map((x) => ({ a: x.a, id: x.faceDown ? 0 : int(x.id, 0, 2e9), faceDown: !!x.faceDown })),
      extraUp: arr(m.extraUp).slice(0, 60).map(card).filter(Boolean),
      chain: chainIn, locks: arr(m.locks).slice(0, 4).filter((l) => l && l.kind === 'noBanish').map((l) => ({ kind: 'noBanish', source: str(l.source, 60) })),
    };
  }

  /** El rival en S.opp: lo público de su último 'state' (lo oculto, solo cuántas hay). */
  function buildOpp(s, m) {
    const o = s.opp;
    const blank = (n, k) => Array.from({ length: Math.max(0, Math.floor(Number(n) || 0)) }, (_, i) => ({ uid: 'p-' + k + i, id: 0, faceDown: true, def: false }));
    const c = m.counts;
    const up = m.extraUp.map((x) => ({ uid: theirUid(x.a), id: x.id, faceDown: false, def: false, extraFaceUp: true }));
    o.hand = blank(c.hand, 'h');
    o.deck = blank(c.deck, 'd');
    o.extra = blank(Math.max(0, c.extra - up.length), 'x').concat(up);
    o.gy = m.gy.map((x) => ({ uid: theirUid(x.a), id: x.id, faceDown: false, def: false }));
    o.ban = m.ban.map((x) => ({ uid: theirUid(x.a), id: x.id, faceDown: x.faceDown, def: false }));
    o.field = m.field.map((e) => {
      const x = { uid: theirUid(e.a), id: e.id, zone: e.zone, faceDown: e.faceDown, def: e.def, mats: e.mats.map((mm) => ({ uid: theirUid(mm.a), id: mm.id, faceDown: false, def: false })) };
      if (e.faceDown && MON.includes(e.zone)) x.monster = true; // un monstruo boca abajo (se le puede atacar)
      if (e.token) x.token = Object.assign({}, e.token);
      if (typeof e.level === 'number') x.level = e.level;
      if (e.atkSet) x.atkSet = { atk: e.atkSet.atk, turn: e.atkSet.turn, by: '' };
      if (e.negated) x.negated = { turn: e.negated.turn, by: '' };
      if (e.attackedTurn != null) x.attackedTurn = e.attackedTurn;
      if (e.summonedTurn != null) x.summonedTurn = e.summonedTurn;
      return x;
    });
    o.lp = m.lp;
    o.name = peerName();
    if (!o.ts || typeof o.ts !== 'object') o.ts = {};
    o.ts.normalSummons = m.ns;
    // "Nadie puede desterrar" del rival (Artifact Lancea) también te frena a ti
    const t = s.turnState;
    t.locks = arr(t.locks).filter((l) => !(l && l.pvpLock));
    m.locks.forEach((l) => t.locks.push({ kind: 'noBanish', source: l.source || 'un efecto del rival', pvpLock: true, vsShared: true }));
  }

  /** Los eslabones del rival dentro de tu cadena (orden por n; si los dos declararon a la misma altura, primero el del turno). */
  function mergeChain(s) {
    const m = remote;
    const theirs = arr(m && m.chain).filter((l) => !closed.has(l.c)).map((l) => {
      const x = { uid: l.a ? theirUid(l.a) : 'p-l' + l.lk, id: l.id, effectIndex: l.fx, kind: l.kind, scale: l.scale, text: '', speed: 2,
        owner: 'opp', pvp: true, lk: l.lk, n: l.n, c: l.c };
      if (l.done) x.done = true;
      if (l.negated) x.negated = { by: '', fizzle: l.negated.fizzle };
      if (Object.prototype.hasOwnProperty.call(negOver, l.lk)) {
        // Lo que pediste se ve ya (hasta que el rival lo confirme)
        if (negOver[l.lk] === !!l.negated) delete negOver[l.lk];
        else if (negOver[l.lk]) x.negated = { by: 'un efecto tuyo', manual: true }; else delete x.negated;
      }
      const t = l.targets.map((y) => (y.you ? mine(y.a) : theirUid(y.a))).filter(Boolean);
      if (t.length) x.target = { uid: t[0] };
      return x;
    });
    const mineL = arr(s.chain).filter((l) => l && !l.pvp);
    const before = mineL.map((l) => s.chain.indexOf(l));
    mineL.forEach((l, i) => { if (!l.n) l.n = i + 1; });
    const myTurn = s.turnState.mine !== false;
    const all = mineL.concat(theirs);
    const rank = (l) => ((l.owner === 'opp') === myTurn ? 1 : 0); // a la misma altura, el del jugador del turno va primero
    all.sort((a, b) => (a.n - b.n) || (rank(a) - rank(b)));
    s.chain = all;
    // Si un eslabón tuyo quedó en otro lugar (los dos activaron a la vez), se dice
    mineL.forEach((l, i) => {
      const now = all.indexOf(l);
      if (before[i] >= 0 && now !== before[i]) log('activation', 'Tu ' + q(nameById(l.id)) + ' queda como CL' + (now + 1) + ': ' + q(peerName()) + ' activó algo a la vez.');
    });
    // Los eslabones nuevos del rival, en tu registro
    theirs.forEach((l) => {
      if (seenLinks.has(l.lk)) return;
      seenLinks.add(l.lk);
      const i = all.indexOf(l);
      log('opp', q(peerName()) + ' activa ' + q(nameById(l.id)) + (l.scale ? ' (Escala de Péndulo)' : l.effectIndex ? ' (efecto ' + l.effectIndex + ')' : '') + ' · CL' + (i + 1)
        + (l.target && l.target.uid && !theirAlias(l.target.uid) ? ' · objetivo: tu ' + q(nameOf(l.target.uid)) : ''));
    });
  }
  const nameOf = (uid) => { const f = P().find(uid); return f ? (f.c && f.c.name) || nameById(f.inst.id) : '?'; };

  /** Turno y fase del rival → los tuyos (en su turno manda él; nunca hacia atrás). */
  function syncTurn(s, r) {
    const p = P();
    const t = s.turnState;
    const my = turnOf(s);
    if (r.mine) {
      // Dice que es su turno
      if (t.mine !== false) return; // los dos dicen que es suyo: espera (lo corrige el próximo mensaje)
      if (r.turn < my) return;
      if (r.turn > my) t.turn = r.turn;
      const a = PHASE_KEYS.indexOf(r.phase), b = PHASE_KEYS.indexOf(t.phase);
      if (a > b || r.turn > my) p.setPhase(r.phase, { rival: true });
    } else if (t.mine === false && r.turn > my) {
      // Te pasó el turno: empieza el tuyo (robas en tu Fase de Robo)
      if (myUndone(s)) log('activation', 'Tus eslabones sin resolver se descartan: ' + q(peerName()) + ' pasó el turno.');
      if (r.turn > my + 1) t.turn = r.turn - 1;
      p.passTurn({ rival: true });
    }
    // Su ataque declarado ya no sigue si salió de su Fase de Batalla (o pasó el turno)
    const s2 = S();
    const w = s2.vs && s2.vs.win;
    if (w && w.kind === 'attack' && (s2.turnState.mine !== false || s2.turnState.phase !== 'battle')) {
      s2.vs.win = null;
      log('battle', 'El ataque del rival no sigue: salió de su Fase de Batalla.');
    }
  }

  function onState(m0) {
    const s = S();
    const p = P();
    const seqIn = int(m0.seq, 0, 1e9);
    if (seqIn <= lastStateIn) return; // una proyección vieja (de la conexión anterior)
    lastStateIn = seqIn;
    const m = clean(m0);
    // Más vieja que tu último pedido (todavía no lo aplicó): se espera la siguiente, que ya lo trae
    if (lastReq && m.ap < lastReq) {
      // (si la siguiente no llega, esta se aplica igual en un momento)
      stale = m;
      if (staleTimer) clearTimeout(staleTimer);
      staleTimer = setTimeout(() => { staleTimer = null; const x = stale; if (x && active() && x.seq === lastStateIn) { stale = null; inbox.push({ t: 'stale', m: x, d: room.duelId }); drain(); } }, 2500);
      return;
    }
    stale = null;
    apply(m);
    p.render();
  }
  function apply(m) {
    const s = S();
    const p = P();
    const prev = remote;
    remote = m;
    const key = JSON.stringify(Object.assign({}, m, { seq: 0, ap: 0 }));
    const changed = key !== remoteKey;
    remoteKey = key;
    const lp0 = Number(s.opp.lp) || 0;
    applying++;
    try {
      p.quiet(() => {
        buildOpp(s, m);
        mergeChain(s);
        narrateLp(m, prev, lp0);
        syncTurn(S(), m.turn);
      });
    } finally { applying--; }
    chainCheck();
    if (changed) p.lockUndo(); // lo que hizo o mostró el rival no se deshace
    // Su primera proyección de este duelo: la tuya otra vez (la primera pudo llegar antes de que empezara el suyo)
    if (!prev) { lastKey = ''; later(); }
  }

  /** Lo que el rival hizo ('moves'), en tu registro (kind 'opp'), armado aquí con sus datos (no con texto suyo). */
  function onMoves(m) {
    let n = 0;
    P().quiet(() => {
      arr(m.moves).slice(0, 80).forEach((mv) => { const t = mv && typeof mv === 'object' ? moveLine(mv) : ''; if (t) { log('opp', t); n++; } });
    });
    if (!n) return;
    P().lockUndo(); // (deshacer no borra del registro lo que hizo el rival)
    P().render();
  }
  function narrateLp(m, prev, lp0) {
    if (prev && m.lp !== lp0) {
      if (expectLp != null && m.lp === expectLp) expectLp = null;
      else log('opp', 'LP de ' + q(peerName()) + ': ' + lp0 + ' → ' + m.lp);
    }
  }
  const zoneWord = (z) => {
    const mm = /^(mz|st)([0-4])$/.exec(String(z));
    if (mm) return (mm[1] === 'mz' ? 'su Zona de Monstruo ' : 'su Zona de M/T ') + (Number(mm[2]) + 1);
    if (EMZ.includes(z)) return 'la Zona de Monstruo Extra';
    if (z === 'fz') return 'su Zona de Campo';
    return 'su campo';
  };
  const FROM = { hand: 'de su mano', deck: 'de su Mazo', extra: 'de su Extra Deck', gy: 'de su Cementerio', ban: 'del destierro', field: 'del campo', mat: 'de los materiales' };
  const PILE = { hand: 'su mano', deck: 'su Mazo', extra: 'su Extra Deck', gy: 'su Cementerio', ban: 'el destierro' };
  const HOW = { normal: 'Invoca de Modo Normal', tribute: 'Invoca por Sacrificio', special: 'Invoca de Modo Especial', fusion: 'Invoca por Fusión', synchro: 'Invoca por Sincronía',
    xyz: 'Invoca por Xyz', link: 'Invoca por Enlace', ritual: 'Invoca por Ritual', pendulum: 'Invoca por Péndulo', flip: 'Invoca por Volteo' };
  function moveLine(mv) {
    const k = String(mv.k || '');
    const id = int(mv.id, 0, 2e9);
    const w = (x) => (own(FROM, x) ? x : '');
    const from = w(mv.from), to = w(mv.to);
    // Una Ficha (solo vive en el campo) se nombra por el nombre que trae; cualquier otra carta, por su código
    const tokOk = typeof mv.tok === 'string' && mv.tok && (k === 'in' || k === 'gone' || k === 'pos' || (k === 'mv' && (from === 'field' || to === 'field')));
    const nm = tokOk ? q(str(mv.tok, 60)) : id ? q(nameById(id)) : '';
    const who = 'El rival';
    const tz = FIELD.includes(mv.tz) ? mv.tz : '';
    switch (k) {
      case 'undo': return who + ' deshace su última jugada.';
      case 'draw': { const n = int(mv.n, 1, 60); return who + ' roba ' + (n === 1 ? '1 carta' : n + ' cartas') + '.'; }
      case 'in': return nm ? 'Aparece ' + nm + ' en ' + zoneWord(tz) + '.' : '';
      case 'gone': return nm ? nm + ' del rival deja el campo y desaparece.' : '';
      case 'pos': {
        const f = mv.from || {}, t = mv.to || {};
        const zone = FIELD.includes(mv.zone) ? mv.zone : '';
        if (f.fd && !t.fd) return mv.how === 'flip' ? who + ' Invoca por Volteo ' + nm + '.' : 'Se voltea ' + (nm || 'una carta') + ' del rival' + (MON.includes(zone) ? (t.df ? ' (en DEF)' : ' (en ATK)') : '') + '.';
        if (!f.fd && t.fd) return (nm || 'Una carta') + ' del rival queda boca abajo.';
        if (t.fd) return 'Un monstruo boca abajo del rival cambia de posición.';
        return (nm || 'Un monstruo') + ' del rival pasa a posición de ' + (t.df ? 'Defensa' : 'Ataque') + '.';
      }
      case 'mv': {
        const mon = MON.includes(tz);
        if (to === 'field') {
          if (mv.fd) return mon ? who + ' coloca un monstruo boca abajo en ' + zoneWord(tz) + (from && from !== 'hand' ? ' ' + FROM[from] : '') + '.'
            : who + ' coloca una carta boca abajo en ' + zoneWord(tz) + (from && from !== 'hand' ? ' ' + FROM[from] : '') + '.';
          if (mon) {
            const h = own(HOW, mv.how) ? HOW[mv.how] : '';
            return who + ' ' + (h || 'pone') + ' ' + (nm || 'un monstruo') + (h ? '' : ' en ' + zoneWord(tz)) + (from && from !== 'hand' ? ' ' + FROM[from] : '') + (mv.df ? ' en DEF' : '') + '.';
          }
          if (mv.how === 'activate') return ''; // la activación la cuenta su eslabón
          return nm ? nm + ' del rival llega a ' + zoneWord(tz) + (from && from !== 'hand' ? ' ' + FROM[from] : '') + '.' : '';
        }
        if (to === 'mat') return nm ? nm + ' del rival pasa a ser material.' : '';
        if (from === 'field' || from === 'mat') {
          const subj = nm ? nm + ' del rival' : 'Una carta boca abajo del rival';
          if (to === 'gy') return subj + ' va a su Cementerio.';
          if (to === 'ban') return subj + (mv.fd ? ' queda desterrada boca abajo.' : ' queda desterrada.');
          if (to === 'extra') return subj + ' va a su Extra Deck.';
          return subj + ' vuelve a ' + (PILE[to] || 'su mano') + '.';
        }
        if (to === 'hand') return nm ? who + ' añade ' + nm + ' ' + (FROM[from] || '') + ' a su mano.' : who + ' añade 1 carta ' + (FROM[from] || '') + ' a su mano.';
        if (to === 'gy') return nm ? who + ' manda ' + nm + ' ' + (FROM[from] || '') + ' al Cementerio.' : '';
        if (to === 'ban') return nm && !mv.fd ? who + ' destierra ' + nm + ' ' + (FROM[from] || '') + '.' : who + ' destierra 1 carta boca abajo ' + (FROM[from] || '') + '.';
        if (to === 'deck') return nm ? nm + ' del rival vuelve a su Mazo.' : who + ' devuelve 1 carta ' + (FROM[from] || '') + ' a su Mazo.';
        if (to === 'extra') return nm ? nm + ' del rival va a su Extra Deck' + (from === 'hand' ? '' : '') + '.' : '';
        return '';
      }
      default: return '';
    }
  }

  /* ---------- Pedidos: lo que tus efectos le hacen a sus cartas ---------- */
  /** Lo llama duel.js (move, flip, position, negate, damage, setLp) cuando cambia S.opp en un duelo en línea. */
  function out(s, op) {
    if (!active() || applying || !op || typeof op !== 'object') return;
    const r = { op: String(op.op || '') };
    if (op.uid != null) {
      const a = theirAlias(op.uid);
      if (!a || !okA(a)) return; // una carta sin alias (de su mano o su Mazo, sin código): no se puede pedir
      r.a = a;
    }
    ['from', 'dest', 'how', 'to'].forEach((k) => { if (op[k] != null) r[k] = str(op[k], 16); });
    // Dónde la viste (su dueño revisa que siga ahí): voltear, cambiar de posición y negar son siempre en el campo
    if (r.a && !r.from && ['flip', 'position', 'negate'].includes(r.op)) r.from = 'field';
    ['faceDown', 'bottom', 'top', 'faceUp', 'battle'].forEach((k) => { if (op[k]) r[k] = true; });
    if (op.by) r.by = str(op.by, 80);
    if (op.amount != null) r.amount = int(op.amount, 0, 999999);
    if (op.delta != null) r.delta = int(op.delta, -999999, 999999);
    if (r.op === 'damage' || r.op === 'lpDelta') expectLp = Math.max(0, Number(s.opp.lp) || 0);
    outQ.push(r);
    later();
  }
  /** "por «X»" (dicho por el rival) → "«X» del rival" (en tu registro). Solo un nombre de carta que exista. */
  const byFromRival = (by) => {
    const t = String(by || '');
    const nm = /«([^»]{1,80})»/.exec(t);
    return nm && YGO.db.findByName && YGO.db.findByName(nm[1]) ? '«' + nm[1] + '» del rival' : 'un efecto del rival';
  };
  const AREA = { field: 'field', gy: 'gy', ban: 'ban' };
  function onReq(m) {
    const p = P();
    const s = S();
    const ops = [];
    let lost = 0;
    arr(m.ops).slice(0, 40).forEach((op) => {
      if (!op || typeof op !== 'object') return;
      const kind = String(op.op || '');
      if (kind === 'negateLink') return; // (abajo)
      const by = op.battle ? '' : byFromRival(op.by);
      if (kind === 'damage') { ops.push({ op: 'damage', amount: int(op.amount, 0, 999999), by: op.battle ? 'el daño de batalla' : by }); return; }
      if (kind === 'lpDelta') { ops.push({ op: 'setLp', value: Math.max(0, (Number(s.lp) || 0) + int(op.delta, -999999, 999999)) }); return; }
      const uid = mine(op.a);
      const f = uid ? p.find(uid) : null;
      if (!f) { lost++; return; }
      const area = f.loc.area;
      // Tiene que seguir donde el rival la vio (si ya se movió, o no dice dónde, el pedido no vale)
      if (!own(AREA, op.from) || AREA[op.from] !== area) { lost++; return; }
      const top = area === 'field' && f.loc.index === 0;
      switch (kind) {
        case 'negate': if (top) ops.push({ op: 'negateMonster', uid, by }); else lost++; return;
        case 'position': if (top) ops.push({ op: 'position', uid, to: ['atk', 'def', 'set'].includes(op.to) ? op.to : 'def', by }); else lost++; return;
        case 'flip': if (top && f.inst.faceDown) ops.push({ op: 'position', uid, to: f.inst.def ? 'def' : 'atk', by }); return;
        case 'move': {
          const dest = String(op.dest || 'gy');
          const how = String(op.how || '');
          if (top) {
            if (how === 'destroy' || how === 'battle') ops.push({ op: 'destroy', uid, battle: how === 'battle', by });
            else if (dest === 'ban') ops.push({ op: 'banish', uid, faceDown: !!op.faceDown, by });
            else if (dest === 'hand' || dest === 'extra') ops.push({ op: 'bounce', uids: [uid], by });
            else if (dest === 'deck') ops.push({ op: 'toDeck', uid, bottom: !!op.bottom, by });
            else ops.push({ op: 'send', uid, by });
            return;
          }
          if (area === 'gy') {
            if (dest === 'ban') ops.push({ op: 'banish', uid, faceDown: !!op.faceDown, by });
            else if (dest === 'hand') ops.push({ op: 'toHand', uid, by });
            else if (dest === 'deck' || dest === 'extra') ops.push({ op: 'toDeck', uid, bottom: !!op.bottom, by });
            else lost++;
            return;
          }
          if (area === 'ban') {
            if (dest === 'hand') ops.push({ op: 'toHand', uid, by });
            else if (dest === 'deck' || dest === 'extra') ops.push({ op: 'toDeck', uid, bottom: !!op.bottom, by });
            else if (dest === 'gy') ops.push({ op: 'toGy', uid, by });
            else lost++;
            return;
          }
          lost++;
          return;
        }
        default: lost++;
      }
    });
    // Marcas de negado sobre tus eslabones (por su clave)
    arr(m.ops).slice(0, 40).forEach((op) => {
      if (op && op.op === 'negateLink' && isLk(op.lk)) ops.push({ op: 'negateLink', lk: op.lk, off: !!op.off, by: op.off ? '' : 'un efecto del rival' });
    });
    applying++;
    try {
      p.quiet(() => {
        if (ops.length) p.applyOps(ops, 'un efecto del rival');
        if (lost) log('opp', 'El rival pidió mover ' + (lost === 1 ? 'una carta tuya que ya no estaba ahí' : lost + ' cartas tuyas que ya no estaban ahí') + ': no cambia nada.');
      });
    } finally { applying--; }
    p.lockUndo();
    // Si quedaste en 0 LP, perdiste (lo avisas tú)
    VS() && VS().checkEnd && VS().checkEnd();
    p.render();
  }

  /* ---------- Cadena (con turnos: quién puede activar ahora) ---------- */
  const topLink = (s) => { const c = arr(s && s.chain); return c.length ? c[c.length - 1] : null; };
  const undoneTop = (s) => { const c = arr(s && s.chain); for (let i = c.length - 1; i >= 0; i--) if (c[i] && !c[i].done) return { l: c[i], i }; return null; };
  const chainId = (s) => { const c = arr(s && s.chain); return c.length ? String(c[0].c || c[0].lk || '') : ''; };
  const myUndone = (s) => arr(s && s.chain).some((l) => l && !l.pvp && !l.done);
  /** Si la cadena es otra (o ya no hay), se empieza de cero. */
  function chainCheck() {
    const s = S();
    if (!s) return;
    if (!arr(s.chain).length) { chain = freshChain(); handed = new Set(); return; }
    const c = chainId(s);
    if (chain.c !== c) chain = Object.assign(freshChain(), { c });
    if (arr(s.chain).some((l) => l && l.done)) chain.phase = 'resolve';
  }
  /** mode: 'respond' (te toca: responde o pasa) | 'wait' (el rival decide) | 'last' (el rival pasó: encadena o resuelve) |
   * 'wait-resolve' (pasaste: el rival encadena o resuelve) | 'resolve' (resuelves tu eslabón) | 'doing' (haz lo tuyo y Listo) |
   * 'rival-resolves' | 'closing'. null sin cadena. */
  function chainState(s) {
    if (!arr(s && s.chain).length) return null;
    chainCheck();
    const top = topLink(s);
    const u = undoneTop(s);
    if (!u) return { mode: 'closing' };
    if (chain.phase === 'build') {
      const topMine = !top.pvp;
      const i = s.chain.length - 1;
      if (chain.passed !== top.lk) return topMine ? { mode: 'wait', l: top, i } : { mode: 'respond', l: top, i };
      return topMine ? { mode: 'last', l: top, i } : { mode: 'wait-resolve', l: top, i };
    }
    if (!u.l.pvp) return { mode: 'resolve', l: u.l, i: u.i };
    // Lo de abajo es del rival: si resolviste algo tuyo que todavía no le pasaste (lo haces a mano), primero «Listo»
    return arr(s.chain).some((l) => l && !l.pvp && l.done && !handed.has(l.lk)) ? { mode: 'doing', l: u.l, i: u.i } : { mode: 'rival-resolves', l: u.l, i: u.i };
  }
  /** Por qué no puedes activar ahora ('' si puedes). Lo mira field.js activate(). */
  function chainBlock() {
    if (!active()) return '';
    const s = S();
    if (s.vs.over) return 'El duelo terminó.';
    if (!connected()) return 'Sin conexión con ' + q(peerName()) + ': espera a que vuelva.';
    if (passAsk) return 'Estás pasando el turno: espera la respuesta de ' + q(peerName()) + '.';
    const st = chainState(s);
    if (!st) return '';
    switch (st.mode) {
      case 'respond': case 'last': return '';
      case 'wait': return 'Espera a que ' + q(peerName()) + ' responda o pase.';
      case 'wait-resolve': return 'Pasaste: ' + q(peerName()) + ' decide si encadena algo más o resuelve.';
      default: return 'La cadena se está resolviendo: no se puede activar nada nuevo.';
    }
  }
  /** Lo que no se puede hacer ahora en el duelo (atacar…): '' si se puede. */
  function blockReason() {
    if (!active()) return '';
    if (!connected()) return 'Sin conexión con ' + q(peerName()) + ': espera a que vuelva.';
    if (passAsk) return 'Estás pasando el turno: espera la respuesta de ' + q(peerName()) + '.';
    return '';
  }
  /** «Pasar»: no respondes a lo que está arriba. */
  function pass() {
    const s = S();
    if (!active()) return;
    const st = chainState(s);
    if (!st || st.mode !== 'respond') { P().toast('Ahora no hay nada a qué responder.'); return; }
    if (!connected()) { P().toast('Sin conexión con ' + q(peerName()) + '.', 'bad'); return; }
    chain.passed = st.l.lk;
    flush();
    post({ t: 'chain', ev: 'pass', top: st.l.lk });
    P().lockUndo();
    log('activation', 'Pasas: no respondes a CL' + (st.i + 1) + ' (' + q(nameById(st.l.id)) + ').');
    P().render();
  }
  function onChain(m) {
    const s = S();
    const p = P();
    const top = topLink(s);
    if (m.ev === 'pass') {
      // Si ya hay otro eslabón arriba, su "Pasar" era para lo de antes
      if (!top || top.lk !== m.top || top.pvp) return;
      chain.passed = m.top;
      log('opp', q(peerName()) + ' pasa: no responde a CL' + s.chain.length + '. Encadena otro efecto o resuelve la cadena.');
      p.lockUndo();
      p.render();
      return;
    }
    if (m.ev === 'resolve') {
      // Solo después de que pasaste a su último eslabón
      if (!top || !top.pvp || !isLk(m.top) || top.lk !== m.top || chain.passed !== m.top) return;
      chain.phase = 'resolve';
      log('opp', q(peerName()) + ' resuelve la cadena.');
      p.render();
      return;
    }
    if (m.ev === 'closed') {
      // El rival resolvió el último eslabón: tu cadena también se cierra (tus Mágicas/Trampas Normales van al Cementerio)
      const cs = new Set(arr(m.cs).slice(0, 10).filter(isLk));
      cs.forEach((c) => closed.add(c));
      // Tiene que ser esta cadena, con lo tuyo ya resuelto (un aviso viejo o adelantado no cierra nada)
      if (arr(s.chain).length && (!cs.has(chainId(s)) || myUndone(s))) return;
      arr(s.chain).forEach((l) => { if (l && l.pvp && cs.has(l.c)) l.done = true; });
      if (arr(s.chain).length) {
        remoteClose = true;
        try { p.quiet(() => p.resolveChain()); } finally { remoteClose = false; }
      }
      chain = freshChain();
      handed = new Set();
      p.lockUndo();
      p.render();
      return;
    }
    if (m.ev === 'nudge') { p.toast(q(peerName()) + ' espera tu respuesta', 'warn'); }
  }
  let remoteClose = false;
  /** ¿Puedes tocar Resolver cadena ahora? (field.js resolveChain) */
  function mayResolve() {
    if (!active() || remoteClose) return true;
    const s = S();
    const st = chainState(s);
    if (!st || st.mode === 'resolve' || st.mode === 'closing') return true;
    const p = P();
    if (st.mode === 'last') {
      // El rival pasó: resuelves. Desde ahora nadie activa nada nuevo en esta cadena
      if (!connected()) { p.toast('Sin conexión con ' + q(peerName()) + '.', 'bad'); return false; }
      chain.phase = 'resolve';
      flush();
      post({ t: 'chain', ev: 'resolve', top: st.l.lk });
      p.lockUndo();
      return true;
    }
    if (st.mode === 'respond') p.toast('Primero responde o toca «Pasar» (en la barra de arriba).');
    else if (st.mode === 'wait') p.toast('Espera a que ' + q(peerName()) + ' responda o pase.');
    else if (st.mode === 'wait-resolve') p.toast(q(peerName()) + ' decide si encadena algo más o resuelve.');
    else if (st.mode === 'doing') p.toast('Haz lo que dice tu eslabón y toca «Listo».');
    else p.toast(q(peerName()) + ' está resolviendo su eslabón.');
    return false;
  }
  /** El botón de la cadena (field.js chainBtns). */
  function chainUi() {
    const s = S();
    const st = chainState(s);
    if (!st) return { ok: true, label: 'Resolver cadena', title: '' };
    switch (st.mode) {
      case 'respond': return { ok: false, label: 'Responde o pasa', title: 'Activa una carta para responder, o toca «Pasar» en la barra de arriba' };
      case 'wait': return { ok: false, label: 'Esperando al rival', title: 'El rival puede responder o pasar' };
      case 'wait-resolve': return { ok: false, label: 'Decide el rival', title: 'El rival encadena algo más o resuelve' };
      case 'doing': return { ok: false, label: 'Toca «Listo» arriba', title: 'Haz lo que dicen tus eslabones resueltos y toca Listo' };
      case 'rival-resolves': return { ok: false, label: 'Resuelve el rival', title: 'El rival resuelve su eslabón' };
      default: return { ok: true, label: arr(s.chain).some((l) => l.done) ? 'Seguir resolviendo' : 'Resolver cadena', title: '' };
    }
  }
  /** field.js resolveChain se detuvo en un eslabón del rival: lo tuyo de arriba ya está. info = { stop, doing, touched } */
  function handOver(info) {
    const s = S();
    if (!active()) return;
    chain.phase = 'resolve';
    // Con algo que hacer a mano: primero lo haces y tocas «Listo» (chainState: 'doing'); si no, el rival sigue ya
    if (arr(info && info.doing).length) { P().render(); return; }
    arr(s.chain).forEach((l) => { if (l && !l.pvp && l.done) handed.add(l.lk); });
    flush();
    P().lockUndo();
    P().render();
  }
  function doneDoing() {
    const s = S();
    const st = active() ? chainState(s) : null;
    if (!st || st.mode !== 'doing') return;
    arr(s.chain).forEach((l) => { if (l && !l.pvp && l.done) handed.add(l.lk); });
    log('resolve', 'Listo: resolviste lo tuyo. Sigue ' + q(peerName()) + '.');
    flush();
    P().lockUndo();
    P().render();
  }
  /** Marca de negado sobre un eslabón del rival: se pide a su dueño (y se ve ya). */
  function negateLink(i) {
    const s = S();
    const l = arr(s.chain)[i];
    if (!l || !l.pvp || l.done) { if (l && l.done) P().toast('Ese eslabón ya se resolvió.'); return; }
    const on = !l.negated;
    negOver[l.lk] = on;
    if (on) l.negated = { by: 'un efecto tuyo', manual: true }; else delete l.negated;
    outQ.push({ op: 'negateLink', lk: l.lk, off: !on });
    log('activation', (on ? 'Marcas CL' : 'Quitas la marca de negado de CL') + (i + 1) + ' (' + q(nameById(l.id)) + ')' + (on ? ' como negado' : '') + '.');
    flush();
    P().render();
  }
  /** Al cerrarse tu cadena (resolviste el último eslabón): el rival también la cierra. */
  function chainClosedHere() {
    if (!active() || remoteClose) return;
    const cs = new Set([chain.c].filter(Boolean));
    arr(remote && remote.chain).forEach((l) => cs.add(l.c));
    cs.forEach((c) => closed.add(c));
    chain = freshChain();
    handed = new Set();
    flush();
    if (cs.size) post({ t: 'chain', ev: 'closed', cs: [...cs] });
    P().lockUndo(); // el rival ya la cerró: deshacer la traería de vuelta solo de tu lado
  }

  /* ---------- Pasar el turno (el rival confirma) ---------- */
  function askPass(cont) {
    const s = S();
    const p = P();
    if (!active()) { cont(); return; }
    if (!connected()) { p.toast('Sin conexión con ' + q(peerName()) + ': espera a que vuelva para pasar el turno.', 'bad'); return; }
    if (passAsk) { p.toast('Esperando a que ' + q(peerName()) + ' confirme…'); return; }
    if (arr(s.chain).length) { p.toast('Hay una cadena sin resolver: resuélvela antes de pasar el turno.'); return; }
    const a = { id: rid(), cont, turn: turnOf(s), timer: null };
    passAsk = a;
    // Si no contesta (se cortó, o su navegador no empezó este duelo), no quedas trabado
    a.timer = setTimeout(() => {
      if (passAsk !== a) return;
      passAsk = null;
      P().toast(q(peerName()) + ' no confirmó el pase de turno: vuelve a intentarlo.', 'warn');
      P().render();
    }, PASS_MS);
    flush();
    post({ t: 'turn', ev: 'ask', id: a.id, turn: turnOf(s) });
    p.render();
  }
  function cancelPass() {
    if (!passAsk) return;
    clearTimeout(passAsk.timer);
    passAsk = null;
    P().render();
  }
  function onTurn(m) {
    const id = str(m.id, 30);
    if (m.ev === 'ask') { answerPass(id, Date.now()); return; }
    if (!passAsk || passAsk.id !== id) return;
    const p = P();
    const a = passAsk;
    clearTimeout(a.timer);
    passAsk = null;
    if (m.ev === 'ok') {
      const s2 = S();
      if (!s2.turnState.mine || turnOf(s2) !== a.turn || arr(s2.chain).length || s2.vs.over) { p.render(); return; }
      a.cont();
      return;
    }
    p.toast(q(peerName()) + ' está activando algo: espera y vuelve a pasar el turno.', 'warn');
    p.render();
  }
  /** El rival quiere pasar el turno: confirmas solo, salvo que estés a mitad de algo (una ventana abierta, como «Activar
   * efecto…», se espera un momento; si sigue abierta o tienes eslabones sin resolver, que espere él). */
  function answerPass(id, t0) {
    if (!active()) return;
    const p = P();
    if ((p.busy() || p.modalOpen()) && Date.now() - t0 < ANSWER_MS) { setTimeout(() => answerPass(id, t0), 400); return; }
    const wait = p.busy() || p.modalOpen() || myUndone(S());
    post({ t: 'turn', ev: wait ? 'wait' : 'ok', id });
  }

  /* ---------- Ataques ---------- */
  function onAttack(m) {
    const s = S();
    const p = P();
    const id = str(m.id, 30);
    if (m.ev === 'stop') {
      const w = s.vs.win;
      if (w && w.attack && w.attack.pvpId === id && (w.kind === 'attack' || w.kind === 'mine-attack')) {
        s.vs.win = null;
        log('battle', 'El ataque no sigue (lo dice ' + q(peerName()) + ').');
        p.lockUndo();
        p.render();
      }
      return;
    }
    if (!okA(m.a)) return;
    const attacker = theirUid(m.a);
    const target = m.target ? mine(m.target.a) : null;
    const reject = (why) => {
      post({ t: 'battle', ev: 'replay', id, why });
      log('battle', q(peerName()) + ' declaró un ataque que no vale: ' + why);
    };
    if (m.target && !target) { reject('esa carta ya no está.'); return; }
    if (target) { const f = p.find(target); if (!f || f.loc.area !== 'field' || f.loc.index !== 0 || !MON.includes(f.loc.zone)) { reject('esa carta ya no está.'); return; } }
    // Ataque directo con monstruos en tu campo: no vale (quizás todavía no los veía)
    if (!target && MON.some((z) => arr(s.zones[z]).length)) { reject('controlas monstruos.'); return; }
    if (VS() && VS().remoteAttack(attacker, target)) {
      const w = S().vs.win;
      if (w && w.attack) w.attack.pvpId = id;
      p.lockUndo();
      p.render();
    } else reject('su monstruo ya no está.');
  }
  /** Quien defiende calculó el daño (vs.js damageStep): el atacante cierra su ataque. at = { attacker, target, pvpId }, res = duel.battle */
  function battleDone(at, res) {
    if (!active() || !at || !at.pvpId) return;
    const p = P();
    let sum = null;
    if (res && res.ok !== false) {
      const tf = res.target && res.target.uid ? p.find(res.target.uid) : null;
      sum = { ok: true, atk: int(res.attacker && res.attacker.atk, 0, 99999),
        target: res.target ? { id: tf && !tf.inst.faceDown ? Number(tf.inst.id) || 0 : 0, pos: res.target.pos === 'atk' ? 'atk' : 'def', value: int(res.target.value, 0, 99999) } : null,
        damage: { attacker: int(res.damage && res.damage.rival, 0, 999999), defender: int(res.damage && res.damage.me, 0, 999999) } };
    } else sum = { ok: false, gone: res && res.gone === 'target' ? 'target' : 'attacker' };
    flush();
    post({ t: 'battle', ev: 'done', id: at.pvpId, sum });
  }
  function onBattle(m) {
    const s = S();
    const p = P();
    const id = str(m.id, 30);
    const w = s.vs.win;
    const mineAtk = w && w.kind === 'mine-attack' && w.attack && w.attack.pvpId === id ? w : null;
    if (m.ev === 'replay') {
      // El ataque no vale (el objetivo ya no estaba, o había monstruos): tu monstruo puede atacar otra vez
      if (mineAtk) {
        const f = p.find(mineAtk.attack.attacker);
        if (f && f.inst) delete f.inst.attackedTurn;
        s.vs.win = null;
      }
      log('battle', 'El ataque no sigue: ' + str(m.why, 80) + ' Puedes declarar otro.');
      p.render();
      return;
    }
    if (mineAtk) s.vs.win = null;
    const sum = m.sum && typeof m.sum === 'object' ? m.sum : null;
    if (sum && sum.ok && sum.target) {
      const tid = int(sum.target.id, 0, 2e9);
      log('battle', 'Cálculo de daño: ATK ' + int(sum.atk, 0, 99999) + ' contra ' + (tid ? q(nameById(tid)) : 'su monstruo') + ' (' + (sum.target.pos === 'atk' ? 'ATK ' : 'DEF ') + int(sum.target.value, 0, 99999) + ').');
    } else if (sum && sum.ok) log('battle', 'Ataque directo: ' + q(peerName()) + ' recibe ' + int(sum.damage && sum.damage.defender, 0, 999999) + ' de daño.');
    else if (sum) {
      if (sum.gone === 'target' && mineAtk) { const f = p.find(mineAtk.attack.attacker); if (f && f.inst) delete f.inst.attackedTurn; }
      log('battle', 'El ataque se detiene: ' + (sum.gone === 'target' ? 'su monstruo ya no está (puedes declarar otro ataque).' : 'tu monstruo ya no está.'));
    }
    p.lockUndo();
    p.render();
  }
  function attackStopped(at) {
    if (!active() || !at || !at.pvpId) return;
    flush();
    post({ t: 'attack', ev: 'stop', id: at.pvpId });
    P().lockUndo();
  }

  /* ---------- Lo que haces tú (field.js botEvent) ---------- */
  function event(ev) {
    if (!active() || applying || !ev) return;
    const s = S();
    if (ev.type === 'activation') {
      const l = arr(s.chain)[ev.link];
      if (l && !l.pvp) {
        if (!l.lk) l.lk = 'k' + rid();
        l.n = ev.link + 1;
        l.c = (ev.link > 0 && s.chain[0] && (s.chain[0].c || s.chain[0].lk)) || l.lk;
        chain.passed = '';
        if (chain.phase === 'resolve' && !arr(s.chain).some((x) => x.done)) chain.phase = 'build';
      }
      flush();
      P().lockUndo(); // el rival ya la vio
      return;
    }
    if (ev.type === 'attack') {
      const w = s.vs.win;
      const id = rid();
      if (w && w.kind === 'mine-attack' && w.attack) w.attack.pvpId = id;
      flush();
      const a = aliasPub.get(ev.attacker);
      if (!a) return;
      const tg = ev.target ? theirAlias(ev.target) : null;
      post({ t: 'attack', id, a, target: tg ? { a: tg } : null });
      P().lockUndo();
      return;
    }
    if (ev.type === 'resolved') { chainClosedHere(); return; }
    // Cambiar de fase no se deshace (el rival ya te siguió: él no vuelve atrás)
    if (ev.type === 'phase') { flush(); P().lockUndo(); return; }
    later();
  }
  function drewCards(uids) {
    arr(uids).forEach((u) => drew.add(u));
    if (active()) P().lockUndo(); // lo robado no se deshace (no se puede espiar el Mazo)
  }
  /** «Mostrar al rival»: le enseñas cartas de tu mano (no se mueven). */
  function reveal(uids) {
    if (!active()) return;
    const p = P();
    const ids = arr(uids).map((u) => p.find(u)).filter((f) => f && f.loc.area === 'hand').map((f) => Number(f.inst.id) || 0).filter(Boolean);
    if (!ids.length) return;
    if (!connected()) { p.toast('Sin conexión con ' + q(peerName()) + '.', 'bad'); return; }
    flush();
    post({ t: 'reveal', ids, from: 'hand' });
    log('vs', 'Le muestras a ' + q(peerName()) + ': ' + ids.map((id) => q(nameById(id))).join(', ') + '.');
    p.select(null);
    p.toast('Se la mostraste al rival', 'ok');
  }
  function onReveal(m) {
    const p = P();
    const ids = arr(m.ids).slice(0, 10).map((x) => int(x, 0, 2e9)).filter((id) => id && YGO.db.get(id));
    if (!ids.length) return;
    const names = ids.map((id) => q(nameById(id))).join(', ');
    log('opp', q(peerName()) + ' te muestra de su mano: ' + names + '.');
    p.toast(q(peerName()) + ' te muestra: ' + names);
    p.render();
  }

  /* ---------- Fin, revancha, salir ---------- */
  /** vs.js endDuel: tu derrota (LP, Mazo vacío, rendirte, salir) se la cuentas al rival; su derrota la cuenta él. */
  function ended(over) {
    if (!active() || !over) return;
    room.over = true;
    // Lo que dijo el rival (su derrota, que saliste…) ya lo sabe; tu derrota la cuentas siempre, también si llegó mientras
    // se aplicaba su mensaje (p. ej. sin cartas para robar al empezar tu turno)
    const mine = over.winner === 'rival' && over.why !== 'left';
    if (applying && !mine) return;
    const winner = over.winner === 'me' ? 'rival' : over.winner === 'rival' ? 'me' : 'draw';
    flush();
    post({ t: 'end', winner, why: str(over.why || 'lp', 12) });
  }
  function onEnd(m) {
    const s = S();
    // Cada uno cuenta solo su derrota (o el empate de los dos en 0): el rival no puede decir que perdiste tú
    if (m.winner !== 'me') return;
    const winner = 'me';
    const why = ['lp', 'deckout', 'concede', 'left'].includes(m.why) ? m.why : 'lp';
    const o = s.vs.over;
    if (o) {
      // Los dos perdieron a la vez (los dos en 0 LP): empate
      if (o.winner === 'rival' && winner === 'me' && o.why === 'lp' && why === 'lp' && o.turn === turnOf(s)) {
        s.vs.over = Object.assign({}, o, { winner: 'draw' });
        log('vs', 'Los LP de los dos llegaron a 0: empate.');
        applying++;
        try { VS().endDuel(s.vs.over); } finally { applying--; }
      }
      return;
    }
    applying++;
    try { VS().endDuel({ winner, why, turn: turnOf(s) }); } finally { applying--; }
  }
  function rematch() {
    if (!connected()) { P().toast('No hay conexión con el rival.', 'bad'); return; }
    if (room.rematch === 'theirs') { acceptRematch(); return; }
    room.rematch = 'mine';
    post({ t: 'rematch', ev: 'ask', of: room.duelId });
    P().toast('Le pediste la revancha a ' + q(peerName()) + '.', 'ok');
    open({});
  }
  function onRematch(m) {
    const p = P();
    // Es la revancha de este duelo (una respuesta a un pedido viejo no reparte otra vez)
    const of = typeof m.of === 'string' ? m.of : '';
    if (of !== room.duelId) return;
    if (m.ev === 'ask') {
      if (room.rematch === 'mine') { acceptRematch(); return; }
      room.rematch = 'theirs';
      p.openDialog('Revancha', '<p>' + esc(q(peerName())) + ' quiere la revancha (con el mazo que tenga elegido cada uno).</p>', [
        { label: 'Ahora no', action: () => { if (room.duelId !== of) return; room.rematch = null; post({ t: 'rematch', ev: 'no', of }); } },
        { label: 'Aceptar', kind: 'primary', action: () => { if (room.duelId === of && room.rematch === 'theirs') acceptRematch(); } },
      ]);
      return;
    }
    if (m.ev === 'yes') { if (room.role === 'host' && room.rematch === 'mine') startDuel(); return; }
    if (m.ev === 'no') { room.rematch = null; p.toast(q(peerName()) + ' no quiere la revancha ahora.'); renderRoom(); }
  }
  function acceptRematch() {
    room.rematch = null;
    if (room.role === 'host') startDuel();
    else { post({ t: 'rematch', ev: 'yes', of: room.duelId }); P().toast('Revancha: empieza cuando el anfitrión reparta.', 'ok'); }
  }
  function onLeft() {
    const s = S();
    if (!room.peer && !room.inDuel) return; // ya se supo (llega 'left' y después el 'bye' de la conexión)
    const name = q(peerName());
    if (active() && !s.vs.over) {
      log('vs', name + ' salió de la sala.');
      applying++;
      try { VS().endDuel({ winner: 'me', why: 'left', turn: turnOf(s) }); } finally { applying--; }
    } else P().toast(name + ' salió de la sala.');
    room.inDuel = false;
    room.over = true;
    room.peer = null;
    room.rematch = null;
    if (room.role === 'guest') room.status = 'closed';
    else resetPeer(); // la sala espera a otra persona
    renderRoom();
  }
  /** Salir de la sala (el duelo, si seguía, termina). ask: primero se pregunta si hay un duelo a medias. */
  function leave(ask) {
    const s = S();
    if (ask === true && live()) {
      confirm2('¿Salir de la sala?', 'El duelo termina: gana ' + q(peerName()) + ' (cuenta como que saliste).', () => leave());
      return;
    }
    if (connected()) post({ t: 'left' });
    if (active() && !s.vs.over) {
      log('vs', 'Saliste de la sala.');
      applying++;
      try { VS().endDuel({ winner: 'rival', why: 'left', turn: turnOf(s) }); } finally { applying--; }
    }
    room.inDuel = false;
    setTimeout(() => { if (N()) N().leave(); }, 80);
    room = freshRoom();
    resetSession();
    nextDeck = null;
    P().closeModal();
    P().render();
  }

  /* ---------- Chat ---------- */
  let lastChat = 0;
  function chat(text) {
    const t = str(text, 200).replace(/\s+/g, ' ').trim();
    if (!t) return;
    if (Date.now() - lastChat < 700) return;
    lastChat = Date.now();
    if (!room.peer) { P().toast('No hay nadie en la sala.', 'bad'); return; }
    if (!connected()) P().toast('Sin conexión: el mensaje sale cuando vuelva.');
    post({ t: 'chat', text: t });
    if (S()) { log('chat', 'Tú: ' + t); P().render(); }
  }
  function onChat(m) {
    const t = str(m.text, 200).replace(/\s+/g, ' ').trim();
    if (!t) return;
    if (S() && active()) { log('chat', q(peerName()) + ': ' + t); P().render(); }
    P().toast(q(peerName()) + ': ' + t);
  }

  /* ---------- Barra del VS en línea (vs.js barModel) ---------- */
  function bar(s) {
    if (!active() || s.vs.over) return null;
    const p = P();
    const n = N();
    const name = q(peerName());
    const t = s.turnState;
    const st0 = n && n.state();
    if (!connected()) {
      if (st0 === 'closed') return { tone: 'end', text: name + ' salió de la sala.', buttons: [{ id: 'pvp-room', label: 'Sala…' }] };
      if (st0 === 'error') return { tone: 'end', text: 'No se pudo volver a conectar con ' + name + '.', sub: 'Puede que haya cerrado la página o perdido Internet.', buttons: [{ id: 'pvp-leave', label: 'Salir de la sala' }] };
      return { tone: 'rival', text: 'Se cortó la conexión con ' + name + ': esperando que vuelva…', sub: 'Puedes mover tus cartas; al volver, se pone al día. Para activar o atacar, espera.', buttons: [{ id: 'pvp-leave', label: 'Salir de la sala' }] };
    }
    if (passAsk) return { tone: 'mine', text: 'Pasando el turno: esperando a que ' + name + ' confirme…', buttons: [{ id: 'pvp-cancel-pass', label: 'Cancelar' }] };
    const w = s.vs.win;
    const st = chainState(s);
    const cl = (x) => 'CL' + (x.i + 1) + ' (' + q(nameById(x.l.id)) + ')';
    if (st) {
      switch (st.mode) {
        case 'respond': return { tone: 'rival', text: name + ' activa ' + cl(st) + '. ¿Respondes?', sub: 'Para responder, activa una carta tuya; si no, toca Pasar. Si tu respuesta lo niega, toca «Negado» en su eslabón.',
          buttons: [{ id: 'pvp-pass', label: 'Pasar', kind: 'primary' }] };
        case 'wait': return { tone: 'mine', text: 'Activaste ' + cl(st) + ': esperando a que ' + name + ' responda o pase…', buttons: [{ id: 'pvp-nudge', label: 'Avisarle' }] };
        case 'last': return { tone: 'mine', text: name + ' no responde a ' + cl(st) + '. Encadena otro efecto o resuelve la cadena.', buttons: [{ id: 'pvp-resolve', label: 'Resolver cadena', kind: 'primary' }] };
        case 'wait-resolve': return { tone: 'rival', text: 'Pasaste: ' + name + ' encadena algo más o resuelve la cadena…', buttons: [{ id: 'pvp-nudge', label: 'Avisarle' }] };
        case 'resolve': return { tone: 'mine', text: 'Te toca resolver: ' + cl(st) + '.', buttons: [{ id: 'pvp-resolve', label: arr(s.chain).some((l) => l.done) ? 'Seguir resolviendo' : 'Resolver cadena', kind: 'primary' }] };
        case 'doing': return { tone: 'mine', text: 'Haz en el campo lo que dicen tus eslabones resueltos y toca «Listo»: después sigue ' + name + '.', sub: 'Si tu eslabón niega uno del rival, toca «Negado» en ese eslabón antes de Listo.', buttons: [{ id: 'pvp-done', label: 'Listo', kind: 'primary' }] };
        case 'rival-resolves': return { tone: 'rival', text: name + ' está resolviendo ' + cl(st) + '…', buttons: [{ id: 'pvp-nudge', label: 'Avisarle' }] };
        default: break;
      }
    }
    if (w && w.kind === 'mine-attack' && w.attack) {
      const f = p.find(w.attack.attacker);
      const a = f ? q((f.c && f.c.name) || p.nameById(f.inst.id)) : 'tu monstruo';
      const tg = w.attack.target ? D().rivalName(s, w.attack.target) : 'ataque directo';
      return { tone: 'battle', text: 'Ataque declarado: ' + a + ' → ' + tg + '. Esperando a ' + name + '…', sub: name + ' puede responder; después su lado calcula el daño.',
        buttons: [{ id: 'vs-stop', label: 'El ataque no sigue' }] };
    }
    if (w && w.kind === 'attack') {
      return { tone: 'battle', text: w.text, sub: w.responded ? 'Si algo quedó a mano, hazlo ahora y toca Seguir para calcular el daño.' : 'Puedes responder activando una carta; si no, toca Seguir y se calcula el daño.',
        buttons: [{ id: 'vs-next', label: 'Seguir', kind: 'primary' }, { id: 'vs-stop', label: 'El ataque no sigue' }] };
    }
    if (!t.mine) return { tone: 'rival', text: 'Turno de ' + name + ' · ' + p.phaseName(t.phase), sub: 'Puedes activar tus cartas cuando quieras (por ejemplo, una handtrap): el rival la ve y responde o pasa.', buttons: [] };
    return null;
  }
  function barClick(id) {
    switch (id) {
      case 'pvp-pass': return pass();
      case 'pvp-resolve': return P().resolveChain();
      case 'pvp-done': return doneDoing();
      case 'pvp-cancel-pass': return cancelPass();
      case 'pvp-nudge': {
        if (Date.now() - lastNudge < 4000) return undefined;
        lastNudge = Date.now();
        post({ t: 'chain', ev: 'nudge' });
        P().toast('Le avisaste a ' + q(peerName()) + '.', 'ok');
        return undefined;
      }
      case 'pvp-leave': return leave(true);
      case 'pvp-room': return open({});
      default: return undefined;
    }
  }

  /* ---------- Deshacer ---------- */
  /** Volviste a una foto vieja: el lado del rival y sus eslabones vuelven a lo último que mandó él. */
  function restored() {
    const s = S();
    if (!active() || !remote) return;
    P().quiet(() => { buildOpp(s, remote); mergeChain(s); });
    undoMark = true;
    later();
  }

  /* ---------- Sala: crear, unirse y empezar ---------- */
  /** La numeración de los mensajes con el rival empieza de cero (otra persona en la sala, o el rival recargó la página). */
  function resetPeer() {
    outN = 0; inN = 0; outbox = []; early = new Map(); inbox = []; applied = 0; lastStateIn = 0; peerSid = '';
    if (ackTimer) clearTimeout(ackTimer);
    ackTimer = null;
    if (staleTimer) clearTimeout(staleTimer);
    staleTimer = null;
    stale = null;
    if (passAsk) clearTimeout(passAsk.timer);
    passAsk = null;
  }
  function resetSession() {
    resetPeer();
    mySid = rid();
  }
  function onHello(m) {
    if (Number(m.v) !== V) {
      room.status = 'error';
      room.why = 'El rival tiene otra versión del simulador. Recarguen la página los dos.';
      renderRoom();
      return;
    }
    const sid = str(m.sid, 30);
    if (peerSid && sid !== peerSid) {
      // Otra persona (o el rival recargó la página): lo de antes no cuenta
      if (active() && !S().vs.over) { applying++; try { VS().endDuel({ winner: 'me', why: 'left', turn: turnOf(S()) }); } finally { applying--; } }
      room.inDuel = false;
      room.over = true;
      room.rematch = null;
      resetPeer();
    }
    peerSid = sid;
    room.peer = { name: str(m.name || 'Rival', 24).trim() || 'Rival', main: int(m.main, 0, 90), extra: int(m.extra, 0, 30) };
    if (S() && S().opp && active()) S().opp.name = room.peer.name;
    // Lo que no le llegó (también un 'start' que se perdió), antes que nada
    const k = typeof m.got === 'number' ? m.got : -1;
    prune(k);
    outbox.filter((x) => x.n > k).forEach((x) => raw(x));
    // Volvió la conexión en medio del duelo: lo público otra vez
    if (room.inDuel && m.duelId && m.duelId === room.duelId) {
      lastKey = '';
      sendState(true);
      P().toast('Volvió la conexión con ' + q(peerName()), 'ok');
      P().render();
      return;
    }
    renderRoom();
  }
  const roomDeck = () => nextDeck || P().deck() || {};
  function hello() {
    const d = roomDeck();
    if (!mySid) mySid = rid();
    raw({ t: 'hello', v: V, sid: mySid, name: myName(), main: arr(d.main).length, extra: arr(d.extra).length, duelId: room.inDuel ? room.duelId : '', got: inN });
  }
  /** Cambió tu mazo para el próximo duelo: el rival ve cuántas cartas tiene. */
  function onDeck(m) {
    if (!room.peer) return;
    room.peer.main = int(m.main, 0, 90);
    room.peer.extra = int(m.extra, 0, 30);
    renderRoom();
  }
  /** El anfitrión reparte: quién empieza y el id del duelo. */
  function startDuel() {
    if (room.role !== 'host' || !room.peer) return;
    if (!connected()) { P().toast('No hay conexión con el rival.', 'bad'); return; }
    const d = roomDeck();
    if (arr(d.main).length < 5) { P().toast('Tu mazo necesita al menos 5 cartas.', 'bad'); return; }
    if (room.peer.main < 5) { P().toast('El mazo de ' + q(peerName()) + ' tiene menos de 5 cartas: que elija otro.', 'bad'); return; }
    // Lo que tengas en el campo (Prueba o VS contra la computadora) se reemplaza: si hay jugadas, se pregunta
    const s = S();
    if (!(s && s.vs && s.vs.pvp) && P().hasPlays()) { P().confirmRestart(deal); return; }
    deal();
  }
  function deal() {
    if (room.role !== 'host' || !room.peer || !connected()) return;
    const pref = room.first;
    const coin = pref === 'coin';
    let hostFirst = pref === 'me';
    if (coin) { const b = new Uint8Array(1); try { crypto.getRandomValues(b); } catch (err) { b[0] = Math.random() * 256; } hostFirst = (b[0] & 1) === 0; }
    const duelId = 'n' + rid();
    post({ t: 'start', v: V, duelId, first: hostFirst ? 'host' : 'guest', coin });
    begin({ duelId, first: hostFirst ? 'me' : 'rival', coin });
  }
  function onStart(m) {
    if (room.role !== 'guest') return;
    const duelId = /^n[a-z0-9]{4,24}$/.test(String(m.duelId || '')) ? m.duelId : '';
    if (!duelId) return;
    if (!begin({ duelId, first: m.first === 'guest' ? 'me' : 'rival', coin: !!m.coin })) {
      post({ t: 'startFailed', of: duelId, why: arr(roomDeck().main).length < 5 ? 'deck' : '' });
    }
  }
  /** El invitado no pudo empezar el duelo que repartiste: no queda nadie del otro lado. */
  function onStartFailed(m) {
    if (room.role !== 'host' || m.of !== room.duelId || !room.inDuel) return;
    const s = S();
    room.inDuel = false;
    room.over = true;
    if (s && s.vs && s.vs.pvp && !s.vs.over) { applying++; try { VS().endDuel({ winner: 'draw', why: 'nostart', turn: 1 }); } finally { applying--; } }
    room.note = q(peerName()) + ' no pudo empezar el duelo' + (m.why === 'deck' ? ': su mazo necesita al menos 5 cartas.' : '.');
    open({});
  }
  /** → true si empezó el duelo en línea */
  function begin(o) {
    const p = P();
    const d = roomDeck();
    if (arr(d.main).length < 5) { p.toast('Tu mazo necesita al menos 5 cartas para el duelo en línea.', 'bad'); return false; }
    // Todo lo del duelo anterior se olvida (la sesión de mensajes sigue: es la misma sala)
    remote = null; remoteKey = ''; stale = null; seenLinks = new Set();
    aliasPub = new Map(); aliasHid = new Map(); backs = []; lastKey = ''; lastLoc = null; seq = 0;
    outQ = []; lastReq = 0; drew = new Set(); closed = new Set(); chain = freshChain(); handed = new Set(); negOver = {}; expectLp = null; undoMark = false;
    if (passAsk) clearTimeout(passAsk.timer);
    passAsk = null; inbox = []; lastStateIn = 0;
    if (staleTimer) clearTimeout(staleTimer);
    staleTimer = null;
    room.duelId = o.duelId;
    room.inDuel = true;
    room.over = false;
    room.rematch = null;
    room.note = '';
    const peer = room.peer || { name: 'Rival', main: 40, extra: 15 };
    p.closeModal();
    if (YGO.go && document.body.dataset.mode !== 'campo') YGO.go('campo');
    // El mazo que elegiste en la sala para este duelo pasa a ser el del campo
    if (nextDeck) { p.setDeck(nextDeck); nextDeck = null; }
    // (tools/test_pvp.js puede fijar la mano: test.hand)
    const th = testHand;
    testHand = null;
    p.newDuel(th ? th.hand : null, th ? th.rest : null, { vs: { pvp: { role: room.role, duelId: o.duelId, first: o.first, coin: o.coin, firstPref: room.first, name: peer.name, main: peer.main, extra: peer.extra, code: room.code } } });
    const s = S();
    if (!active()) { room.inDuel = false; room.over = true; p.toast('No se pudo empezar el duelo en línea', 'bad'); return false; }
    lastLoc = locsOf(s);
    sendState(true);
    p.render();
    return true;
  }
  /** ¿Hay un duelo en línea en juego ahora (sin terminar)? */
  function live() { const s = S(); return active() && !room.over && !(s && s.vs && s.vs.over); }
  /** El campo empezó otro duelo sin pasar por la sala (p. ej. se borró el mazo de este): el duelo termina para los dos. */
  function abandon() {
    if (!room.inDuel || room.over) return;
    room.over = true;
    if (passAsk) clearTimeout(passAsk.timer);
    passAsk = null;
    post({ t: 'end', winner: 'me', why: 'left' }); // (gana el rival)
    try { P().toast('Dejaste el duelo en línea: gana ' + q(peerName()) + '.', 'warn'); } catch (err) { /* nada */ }
  }

  /** La ventana de la sala (botón «En línea», Nuevo duelo y el selector de mazo durante un duelo en línea). */
  function open(opts) {
    opts = opts || {};
    const p = P();
    bind();
    // El selector de mazo durante la sala: ese mazo es para el próximo duelo en línea (el de ahora sigue con el suyo)
    if (opts.deck && arr(opts.deck.main).length) {
      const cur = P().deck();
      nextDeck = cur && opts.deck.id === cur.id ? null : opts.deck;
      const d = roomDeck();
      if (connected()) raw({ t: 'deck', main: arr(d.main).length, extra: arr(d.extra).length });
      p.toast('Mazo para el próximo duelo en línea: ' + q(d.name || '—'), 'ok');
    }
    p.openDialog('Jugar en línea', roomHtml(), roomButtons());
    bindRoom();
  }
  /** ¿El campo le pasa a la sala «Nuevo duelo» o el selector de mazo? (durante un duelo en línea, o un mazo con alguien en la sala) */
  function wants(opts) {
    if (live()) return true;
    return !!(opts && opts.deck && room.role && room.peer);
  }
  function roomButtons() {
    const s = S();
    // El foco va a «Cerrar» (el último) o a «Empezar duelo»: nunca a algo que termine el duelo
    const btns = [];
    if (room.role) btns.push({ label: 'Salir de la sala', kind: 'danger', action: () => leave(true) });
    const host = room.role === 'host' && room.peer && connected();
    const playing = live();
    if (host && playing) btns.push({ label: 'Repartir de nuevo', action: () => confirm2('¿Empezar otro duelo?', 'El duelo de ahora termina para los dos.', () => startDuel()) });
    btns.push({ label: 'Cerrar' });
    if (host && !playing) btns.push({ label: 'Empezar duelo', kind: 'primary', keep: true, action: () => startDuel() });
    return btns;
  }
  function confirm2(title, text, go) {
    P().openDialog(title, '<p>' + esc(text) + '</p>', [{ label: 'Sí', kind: 'danger', action: go }, { label: 'Cancelar' }]);
  }
  function linkFor(code) {
    try {
      const u = new URL(window.location.href);
      u.hash = 'campo';
      u.search = '';
      u.searchParams.set('sala', code);
      return u.toString();
    } catch (err) { return ''; }
  }
  function roomHtml() {
    const n = N();
    const st = n ? n.state() : 'idle';
    const ok = !!(n && n.available());
    const d = roomDeck();
    const playing = live();
    const deckLine = '<p class="hint">' + (playing && nextDeck ? 'Para el próximo duelo: ' : 'Tu mazo: ') + '<b>' + esc(q(d.name || '—')) + '</b> (' + arr(d.main).length + ' cartas · Extra ' + arr(d.extra).length + '). '
      + (playing ? 'Con el selector de mazo del campo eliges el del próximo duelo.' : 'Cámbialo con el selector de mazo del campo antes de empezar.') + '</p>';
    const nameRow = '<label class="field"><span>Tu nombre</span><input type="text" id="pvp-name" maxlength="24" value="' + esc(myName()) + '" autocomplete="nickname"></label>';
    if (!ok) {
      return '<div class="setup pvp-room"><p>El juego en línea funciona en el sitio web del simulador: aquí el navegador no deja conectarse con otra persona.</p>'
        + '<p class="hint">Ábrelo en https://obueno2785.github.io/yugioh-deck-manager/ y entra a Campo → En línea.</p></div>';
    }
    if (!room.role || (room.status === 'error' && !room.inDuel)) {
      return '<div class="setup pvp-room">'
        + '<p>Juega contra otra persona: uno crea la sala y le pasa el código o el enlace al otro. Cada uno usa su propio mazo y mueve solo sus cartas.</p>'
        + nameRow + deckLine
        + '<div class="pvp-choices"><div class="pvp-box"><h3>Crear una sala</h3><p class="hint">Te da un código para pasárselo al rival.</p><button type="button" class="primary" id="pvp-host">Crear sala</button></div>'
        + '<div class="pvp-box"><h3>Unirse a una sala</h3><label class="field"><span>Código</span><input type="text" id="pvp-code" maxlength="8" placeholder="K7PQ2M" autocapitalize="characters" autocomplete="off" spellcheck="false" value="' + esc(pendingCode || '') + '"></label>'
        + '<button type="button" id="pvp-join">Unirse</button></div></div>'
        + '<p class="hint">Tu mano, tu Mazo, tu Extra Deck y tus cartas boca abajo no se mandan: el rival solo ve lo que se ve en un duelo de verdad. Al conectarse, cada navegador ve la dirección IP del otro.</p>'
        + (room.status === 'error' && room.why ? '<p class="hint pvp-err" role="alert">' + esc(room.why) + '</p>' : '')
        + '</div>';
    }
    const code = room.code || (n && n.code()) || '';
    const link = code ? linkFor(code) : '';
    const peer = room.peer;
    let status;
    if (st === 'starting') status = 'Creando la sala…';
    else if (st === 'waiting') status = 'Esperando a que alguien se una…';
    else if (st === 'connecting') status = room.role === 'guest' ? 'Conectando con la sala ' + code + '…' : 'Alguien se está uniendo…';
    else if (st === 'connected') status = peer ? 'Conectado con ' + q(peer.name) + ' (' + peer.main + ' cartas · Extra ' + peer.extra + ').' : 'Conectado. Esperando sus datos…';
    else if (st === 'lost') status = 'Se cortó la conexión: intentando volver…';
    else if (st === 'closed') status = 'El rival salió de la sala.';
    else if (st === 'error') status = room.why || 'No se pudo conectar.';
    else status = '';
    const seg = (items, cur) => '<div class="seg" id="pvp-first" role="group" aria-label="Quién empieza">' + items.map(([v, l]) => '<button type="button" data-first="' + v + '" aria-pressed="' + (v === cur) + '">' + l + '</button>').join('') + '</div>';
    return '<div class="setup pvp-room">'
      + (room.role === 'host' && code ? '<div class="pvp-code-row"><span>Código de la sala</span><b id="pvp-room-code" class="pvp-code">' + esc(code) + '</b>'
        + '<button type="button" id="pvp-copy" class="small">Copiar enlace</button></div>'
        + '<p class="hint pvp-link" id="pvp-link">' + esc(link) + '</p>' : '<p>Sala <b class="pvp-code">' + esc(code) + '</b></p>')
      + '<p class="pvp-status" id="pvp-status" role="status">' + esc(status) + '</p>'
      + (room.role === 'host' ? '<div class="field"><span>Empieza</span>' + seg([['me', 'Yo'], ['rival', 'El rival'], ['coin', 'Al azar']], room.first) + '</div>' : '')
      + (room.role === 'guest' && st === 'connected' && !playing ? '<p class="hint">El anfitrión elige quién empieza y reparte.</p>' : '')
      + (room.note ? '<p class="hint pvp-err" role="alert">' + esc(room.note) + '</p>' : '')
      + deckLine
      + (!playing ? '<p class="hint">Al empezar, el duelo en línea reemplaza lo que tengas ahora en el campo.</p>' : '')
      + (room.peer ? '<label class="field pvp-chat"><span>Mensaje al rival</span><input type="text" id="pvp-chat" maxlength="200" placeholder="Escribe y pulsa Enter" autocomplete="off"></label>' : '')
      + (room.rematch === 'mine' ? '<p class="hint">Le pediste la revancha: espera a que acepte.</p>' : '')
      + '</div>';
  }
  function bindRoom() {
    const root = $('#modal-body');
    if (!root || !$('.pvp-room', root)) return;
    const host = $('#pvp-host', root);
    if (host) host.addEventListener('click', () => { saveName(); createRoom(); });
    const join = $('#pvp-join', root);
    const code = $('#pvp-code', root);
    const go = () => { saveName(); joinRoom(code ? code.value : ''); };
    if (join) join.addEventListener('click', go);
    if (code) code.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    const nm = $('#pvp-name', root);
    if (nm) nm.addEventListener('change', saveName);
    const copy = $('#pvp-copy', root);
    if (copy) copy.addEventListener('click', () => {
      const link = linkFor(room.code);
      const done = () => P().toast('Enlace copiado: pásaselo al rival', 'ok');
      const manual = () => P().toast('Copia el enlace a mano: ' + link);
      try { navigator.clipboard.writeText(link).then(done, manual); } catch (err) { manual(); }
    });
    $$('[data-first]', root).forEach((b) => b.addEventListener('click', () => {
      room.first = b.dataset.first;
      $$('[data-first]', root).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    }));
    const ch = $('#pvp-chat', root);
    if (ch) ch.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); chat(ch.value); ch.value = ''; } });
  }
  function saveName() {
    const nm = $('#pvp-name');
    if (nm) { try { P().savePref({ [NAME_KEY]: str(nm.value, 24).trim() }); } catch (err) { /* nada */ } }
  }
  /** Vuelve a dibujar la ventana de la sala si está abierta (cambió la conexión, llegó el rival…). */
  function renderRoom() {
    const m = $('#modal');
    const root = $('#modal-body');
    const s = S();
    if (!m || m.hidden || !root || !$('.pvp-room', root)) { if (s && s.vs && s.vs.pvp) P().render(); return; }
    const ae = document.activeElement;
    const inModal = !!(ae && ae !== document.body && m.contains(ae));
    const focus = inModal ? ae.id : '';
    const sel = inModal && typeof ae.selectionStart === 'number' ? [ae.selectionStart, ae.selectionEnd] : null;
    const typed = { code: ($('#pvp-code', root) || {}).value, chat: ($('#pvp-chat', root) || {}).value, name: ($('#pvp-name', root) || {}).value };
    // Volver a dibujarla no le roba el foco a lo que escribes: queda donde estaba, al momento (sin esperar)
    P().openDialog('Jugar en línea', roomHtml(), roomButtons(), null, { keepFocus: true });
    bindRoom();
    if (typed.code != null && $('#pvp-code')) $('#pvp-code').value = typed.code;
    if (typed.chat != null && $('#pvp-chat')) $('#pvp-chat').value = typed.chat;
    if (typed.name != null && $('#pvp-name')) $('#pvp-name').value = typed.name;
    const el = focus && document.getElementById(focus);
    if (el && m.contains(el)) {
      el.focus();
      if (sel) { try { el.setSelectionRange(sel[0], sel[1]); } catch (err) { /* nada */ } }
    } else if (inModal || !m.contains(document.activeElement)) {
      const foot = $('#modal-foot');
      const first = foot && ($('.primary', foot) || foot.lastChild);
      if (first) first.focus();
    }
  }
  function createRoom() {
    const n = N();
    if (!n) return;
    resetSession();
    room = Object.assign(freshRoom(), { role: 'host', status: 'starting', first: room.first || 'coin' });
    n.host();
    room.code = n.code();
    renderRoom();
  }
  function joinRoom(code) {
    const n = N();
    if (!n) return;
    const k = n.normCode(code);
    if (!n.validCode(k)) { room = Object.assign(freshRoom(), { status: 'error', why: 'El código tiene 6 letras y números (por ejemplo K7PQ2M).' }); renderRoom(); return; }
    resetSession();
    pendingCode = k;
    room = Object.assign(freshRoom(), { role: 'guest', code: k, status: 'connecting' });
    n.join(k);
    renderRoom();
  }

  function bind() {
    if (bound || !N()) return;
    bound = true;
    const n = N();
    n.on('status', (st, info) => {
      room.status = st;
      if (st === 'error') room.why = (info && info.why) || 'No se pudo conectar.';
      if (st === 'waiting' && info && info.code) room.code = info.code;
      renderRoom();
    });
    n.on('open', () => { hello(); renderRoom(); });
    n.on('msg', onMsg);
    n.on('bye', () => onLeft());
    n.on('close', () => { if (active()) { log('vs', 'Se cortó la conexión con ' + q(peerName()) + '.'); P().render(); } else renderRoom(); });
    // Cerrar o recargar la página es salir de la sala (el duelo no sobrevive a una recarga)
    window.addEventListener('pagehide', () => {
      if (!connected()) return;
      try { raw({ t: 'left', n: ++outN }); } catch (err) { /* nada */ }
      try { N().leave(); } catch (err) { /* nada */ }
    });
  }

  /** ?sala=CODIGO en la dirección: se abre la sala para unirse. */
  function fromLink() {
    let code = '';
    try { code = new URLSearchParams(window.location.search).get('sala') || ''; } catch (err) { code = ''; }
    if (!code || !N()) return;
    pendingCode = N().normCode(code);
    const tryOpen = (n) => {
      if (P() && document.body && document.body.dataset.mode === 'campo' && S()) { open({}); return; }
      if (n > 0) setTimeout(() => tryOpen(n - 1), 300);
    };
    if (YGO.go && document.body.dataset.mode !== 'campo') YGO.go('campo');
    setTimeout(() => tryOpen(20), 100);
  }

  YGO.pvp = {
    // field.js / vs.js / duel.js
    afterRender: () => { if (!active()) return; if (inbox.length) drain(); if (!applying) later(); },
    event, out, drew: drewCards, handOver, mayResolve, chainBlock, blockReason, chainUi, negateLink, restored, askPass, reveal,
    pass, bar, barClick, battleDone, attackStopped, ended, rematch, leave, open, chat, live, wants, abandon,
    info: () => ({ role: room.role, code: room.code, status: room.status, peer: room.peer ? Object.assign({}, room.peer) : null, inDuel: room.inDuel, duelId: room.duelId }),
    // Para tools/test_pvp.js
    test: {
      state: () => ({ chain: Object.assign({}, chain), mode: (() => { const st = active() ? chainState(S()) : null; return st ? st.mode : null; })(), handed: [...handed], seq, outN, inN, outbox: outbox.length, inbox: inbox.length, applied, passAsk: !!passAsk, lastReq }),
      create: () => { bind(); createRoom(); }, join: (c) => { bind(); joinRoom(c); }, start: () => startDuel(), setFirst: (v) => { room.first = v; },
      flush: () => flush(),
      hand: (hand, rest) => { testHand = { hand: arr(hand).slice(), rest: arr(rest).slice() }; },
      // Un mensaje cualquiera con número (para probar que el otro lado revisa lo que llega)
      post: (msg) => post(Object.assign({}, msg)),
    },
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { bind(); fromLink(); });
  else setTimeout(() => { bind(); fromLink(); }, 0);
})();
