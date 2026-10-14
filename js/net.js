/* Conexión del juego en línea (js/net.js): dos navegadores hablan directo por WebRTC con PeerJS (js/vendor/peerjs.min.js).
 * Sin cuentas ni servidor propio: para encontrarse usan el servidor público de PeerJS (o el que digan window.YGO_PEER o,
 * solo con la página en localhost, ?peerhost=…&peerport=…&peerpath=…&peersecure=0, para las pruebas). Solo lleva objetos
 * JSON de un lado al otro; no sabe nada del juego (eso es js/pvp.js). Una sala = un código de 6 letras; quien la crea
 * espera, el otro se une. Si se corta, el invitado vuelve a llamar solo (un par de minutos) y el anfitrión le guarda el
 * lugar un minuto con el mismo código (recargar la página del invitado también lo recupera: su clave queda en la pestaña).
 * Expone window.YGO.net. */
(function () {
  const YGO = (window.YGO = window.YGO || {});
  const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sin 0/O ni 1/I/L: se dicta sin confusiones
  const CODE_LEN = 6;
  const PREFIX = 'ygosim-';
  const PING_MS = 4000;   // latido
  const LOST_MS = 15000;  // sin nada del otro en este tiempo: la conexión se perdió
  const RETRY_MS = 2500;  // el invitado vuelve a llamar
  const OPEN_MS = 9000;   // una llamada que todavía se está abriendo no se corta antes de esto
  const GIVEUP_MS = 120000; // el invitado deja de llamar
  const SEAT_MS = 60000;  // el anfitrión guarda el lugar del invitado que se cortó

  let peer = null;
  let conn = null;
  let role = null;        // 'host' | 'guest'
  let code = '';
  let state = 'idle';     // idle | starting | waiting | connecting | connected | lost | error | closed
  let lastIn = 0;
  let pingTimer = null;
  let retryTimer = null;
  let everOpen = false;   // ya hubo conexión alguna vez (para saber si reintentar)
  let gid = '';           // el invitado se presenta con esto: si vuelve a llamar, el anfitrión cambia la conexión vieja por la nueva
  let hostGid = '';       // el anfitrión: quién está conectado
  let gen = 0;            // cambia con cada sala: los avisos viejos ya no hacen nada
  let attemptAt = 0;      // cuándo empezó la llamada de ahora (invitado)
  let lostAt = 0;         // cuándo se cortó
  let seatTimer = null;
  const handlers = {};
  const tap = { sent: null, got: null }; // pruebas: copia de todo lo que va y viene

  const now = () => Date.now();
  function emit(ev, ...args) {
    (handlers[ev] || []).slice().forEach((fn) => {
      try { fn(...args); } catch (err) { console.error('YGO.net: falló el aviso ' + ev, err); }
    });
  }
  /** on('status' | 'open' | 'msg' | 'close' | 'bye' | 'error', fn) → función para quitarlo */
  function on(ev, fn) {
    (handlers[ev] = handlers[ev] || []).push(fn);
    return () => { handlers[ev] = (handlers[ev] || []).filter((f) => f !== fn); };
  }
  function setState(s, info) {
    state = s;
    emit('status', s, Object.assign({ code, role }, info || {}));
  }

  /** ¿Está PeerJS? (en el artifact de claude.ai o sin el archivo, no) */
  const available = () => typeof window.Peer === 'function' && typeof window.RTCPeerConnection === 'function';
  const normCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  const validCode = (s) => new RegExp('^[' + ALPHA + ']{' + CODE_LEN + '}$').test(String(s || ''));
  function newCode() {
    const out = [];
    const buf = new Uint32Array(CODE_LEN);
    try { window.crypto.getRandomValues(buf); } catch (err) { for (let i = 0; i < CODE_LEN; i++) buf[i] = Math.floor(Math.random() * 4294967296); }
    for (let i = 0; i < CODE_LEN; i++) out.push(ALPHA[buf[i] % ALPHA.length]);
    return out.join('');
  }
  /** Opciones de PeerJS: el servidor público por defecto; window.YGO_PEER o la dirección para otro (pruebas). */
  function options() {
    const o = {};
    let q = null;
    try { q = new URLSearchParams(window.location.search); } catch (err) { q = null; }
    const w = window.YGO_PEER && typeof window.YGO_PEER === 'object' ? window.YGO_PEER : {};
    // (la dirección solo cambia el servidor en una página local: un enlace no puede mandar a nadie a otro servidor)
    const local = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(String(window.location.hostname || ''));
    if (!local) q = null;
    const host = w.host || (q && q.get('peerhost'));
    if (host) {
      o.host = String(host);
      const port = w.port || (q && q.get('peerport'));
      if (port) o.port = Number(port);
      o.path = String(w.path || (q && q.get('peerpath')) || '/');
      const sec = w.secure !== undefined ? w.secure : q && q.get('peersecure');
      o.secure = !(sec === false || sec === '0' || sec === 'false');
    }
    if (w.key) o.key = String(w.key);
    if (w.config && typeof w.config === 'object') o.config = w.config;
    if (w.debug != null) o.debug = Number(w.debug) || 0;
    return o;
  }
  /** El texto para la persona según el error de PeerJS. */
  function why(err) {
    const t = err && err.type;
    if (t === 'peer-unavailable') return 'No hay ninguna sala abierta con ese código. Revisa el código o pide uno nuevo.';
    if (t === 'browser-incompatible') return 'Este navegador no permite el juego en línea.';
    if (t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed') return 'No se pudo llegar al servidor para encontrarse. Revisa tu conexión a Internet.';
    if (t === 'unavailable-id') return 'Ese código ya está en uso.';
    if (t === 'ssl-unavailable') return 'El juego en línea necesita una página https.';
    return 'No se pudo conectar' + (err && err.message ? ' (' + err.message + ')' : '') + '.';
  }

  function clearTimers() {
    if (pingTimer) clearInterval(pingTimer);
    if (retryTimer) clearTimeout(retryTimer);
    if (seatTimer) clearTimeout(seatTimer);
    pingTimer = null;
    retryTimer = null;
    seatTimer = null;
  }
  const gidOf = (c) => String((c && c.metadata && c.metadata.gid) || '').slice(0, 40);
  /** La clave del invitado para esta sala (en la pestaña: si recarga la página, recupera su lugar). */
  function gidFor(k) {
    const key = 'ygoNetGid:' + k;
    let g = '';
    try { g = String(window.sessionStorage.getItem(key) || ''); } catch (err) { g = ''; }
    if (!/^[A-Z0-9]{12}$/.test(g)) { g = newCode() + newCode(); try { window.sessionStorage.setItem(key, g); } catch (err) { /* nada */ } }
    return g;
  }
  function startPing() {
    if (pingTimer) clearInterval(pingTimer);
    const g = gen;
    pingTimer = setInterval(() => {
      if (g !== gen) return;
      if (!conn || !conn.open) return;
      if (now() - lastIn > LOST_MS) { try { conn.close(); } catch (err) { /* nada */ } lost(conn); return; }
      try { conn.send({ t: 'ping' }); } catch (err) { /* nada */ }
    }, PING_MS);
  }

  /** Usa esta conexión (la entrante del anfitrión o la que llamó el invitado). */
  function attach(c) {
    const g = gen;
    conn = c;
    c.on('open', () => {
      if (g !== gen || conn !== c) return;
      lastIn = now();
      everOpen = true;
      lostAt = 0;
      // El lugar del invitado es de esta conexión (se toma al abrir, no al llamar)
      if (role === 'host') { hostGid = gidOf(c); if (seatTimer) { clearTimeout(seatTimer); seatTimer = null; } }
      setState('connected');
      startPing();
      emit('open');
    });
    c.on('data', (d) => {
      if (g !== gen || conn !== c) return;
      lastIn = now();
      if (!d || typeof d !== 'object') return;
      if (d.t === 'ping') { try { c.send({ t: 'pong' }); } catch (err) { /* nada */ } return; }
      if (d.t === 'pong') return;
      if (d.t === 'full') { setState('error', { why: 'Esa sala ya tiene dos jugadores.' }); return; }
      if (d.t === 'bye') {
        // El otro salió de la sala: el invitado no vuelve a llamar; el anfitrión deja la sala libre para otra persona
        clearTimers();
        if (role === 'host') {
          conn = null;
          hostGid = '';
          everOpen = false;
          setState('waiting');
          setTimeout(() => { try { c.close(); } catch (err) { /* nada */ } }, 100);
        } else setState('closed');
        emit('bye');
        return;
      }
      if (tap.got) tap.got.push(d);
      emit('msg', d);
    });
    c.on('close', () => { if (g === gen && conn === c) lost(c); });
    c.on('error', (err) => { if (g === gen && conn === c) { console.warn('YGO.net: error de la conexión', err); lost(c); } });
  }
  /** Se cortó: el invitado vuelve a llamar; el anfitrión espera otra conexión con el mismo código. Una llamada que nunca
   * llegó a abrir no es "se cortó": el anfitrión sigue como estaba (esperando, o esperando que vuelva) sin avisar. */
  function lost(c) {
    if (c && conn !== c) return;
    if (state === 'closed' || state === 'idle' || state === 'error') return;
    const wasOpen = state === 'connected';
    conn = null;
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = null;
    if (wasOpen) {
      lostAt = now();
      setState('lost');
      emit('close');
      if (role === 'host') holdSeat();
    } else if (role === 'host' && state === 'connecting') setState(everOpen ? 'lost' : 'waiting');
    if (role === 'guest') redial();
  }
  /** El anfitrión guarda el lugar del invitado que se cortó un rato; después, cualquiera con el código puede entrar. */
  function holdSeat() {
    if (seatTimer) clearTimeout(seatTimer);
    const g = gen;
    seatTimer = setTimeout(() => { seatTimer = null; if (g === gen && role === 'host' && state !== 'connected') hostGid = ''; }, SEAT_MS);
  }
  /** El invitado vuelve a llamar: una llamada a la vez; si no abre en un rato, se corta y se prueba otra (y después de
   * un par de minutos sin volver, deja de intentar). */
  function redial() {
    if (retryTimer) clearTimeout(retryTimer);
    const g = gen;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (g !== gen || role !== 'guest' || ['connected', 'closed', 'idle', 'error'].includes(state)) return;
      if (!peer || peer.destroyed) return;
      if (everOpen && lostAt && now() - lostAt > GIVEUP_MS) {
        const old = conn;
        conn = null;
        if (old) { try { old.close(); } catch (err) { /* nada */ } }
        setState('error', { why: 'Se perdió la conexión con la sala y no volvió.', type: 'gone' });
        emit('error', { type: 'gone', why: 'Se perdió la conexión con la sala y no volvió.' });
        return;
      }
      // Sin el servidor de señales no se puede llamar: primero se vuelve a registrar
      if (peer.disconnected) { try { peer.reconnect(); } catch (err) { /* nada */ } redial(); return; }
      // Una llamada que todavía se está abriendo sigue (en redes lentas tarda unos segundos)
      if (conn && !conn.open && now() - attemptAt < OPEN_MS) { redial(); return; }
      const old = conn;
      conn = null; // (su aviso de cierre ya no cuenta)
      if (old) { try { old.close(); } catch (err) { /* nada */ } }
      try { dial(); } catch (err) { /* sigue intentando */ }
      redial();
    }, RETRY_MS);
  }
  function dial() {
    attemptAt = now();
    attach(peer.connect(PREFIX + code.toLowerCase(), { reliable: true, metadata: { gid } }));
  }

  function makePeer(id) {
    const o = options();
    return id ? new window.Peer(id, o) : new window.Peer(o);
  }
  function peerEvents(p, g) {
    p.on('error', (err) => {
      if (g !== gen) return;
      const t = err && err.type;
      // El invitado reintentando: el anfitrión todavía no volvió (sigue intentando)
      if (t === 'peer-unavailable' && role === 'guest' && everOpen) return;
      if (t === 'unavailable-id' && role === 'host' && !everOpen) { startHost(); return; } // otro código
      if ((t === 'network' || t === 'socket-closed' || t === 'disconnected') && everOpen) return; // la conexión directa puede seguir
      console.warn('YGO.net: error de PeerJS', err);
      setState('error', { why: why(err), type: t || '' });
      emit('error', { type: t || '', why: why(err) });
    });
    // Se cortó el servidor de señales (no la conexión directa): se vuelve a registrar con el mismo código
    p.on('disconnected', () => {
      if (g !== gen || state === 'closed' || state === 'idle') return;
      setTimeout(() => { if (g === gen && p && !p.destroyed && p.disconnected) { try { p.reconnect(); } catch (err) { /* nada */ } } }, 1000);
    });
  }
  function startHost() {
    if (peer) { try { peer.destroy(); } catch (err) { /* nada */ } }
    code = newCode();
    const g = gen;
    let p;
    try { p = makePeer(PREFIX + code.toLowerCase()); } catch (err) { setState('error', { why: why(err) }); return; }
    peer = p;
    peerEvents(p, g);
    p.on('open', () => { if (g === gen && state !== 'connected') setState('waiting'); });
    p.on('connection', (c) => {
      if (g !== gen) return;
      // El lugar del invitado es de quien se unió primero: si vuelve a llamar (mismo gid), la conexión nueva reemplaza a
      // la vieja; cualquier otro encuentra la sala llena, aunque la conexión del invitado esté cortada en ese momento
      const who = gidOf(c);
      if ((hostGid && who !== hostGid) || (!hostGid && conn && conn.open)) {
        c.on('open', () => { try { c.send({ t: 'full' }); } catch (err) { /* nada */ } setTimeout(() => { try { c.close(); } catch (err) { /* nada */ } }, 300); });
        return;
      }
      if (conn && conn !== c) { const old = conn; conn = null; try { old.close(); } catch (err) { /* nada */ } }
      if (state !== 'connected') setState('connecting');
      attach(c);
    });
  }

  /** Crear sala: queda esperando con un código nuevo (status 'waiting' trae el código). */
  function host() {
    if (!available()) { setState('error', { why: 'El juego en línea no está disponible aquí (ábrelo en el sitio web).' }); return false; }
    leave(true);
    gen++;
    role = 'host';
    everOpen = false;
    lostAt = 0;
    hostGid = '';
    setState('starting');
    startHost();
    return true;
  }
  /** Unirse a la sala con ese código. */
  function join(c) {
    if (!available()) { setState('error', { why: 'El juego en línea no está disponible aquí (ábrelo en el sitio web).' }); return false; }
    const k = normCode(c);
    if (!validCode(k)) { setState('error', { why: 'El código tiene 6 letras y números (por ejemplo K7PQ2M).' }); return false; }
    leave(true);
    gen++;
    role = 'guest';
    code = k;
    everOpen = false;
    lostAt = 0;
    gid = gidFor(k);
    setState('connecting');
    const g = gen;
    let p;
    try { p = makePeer(null); } catch (err) { setState('error', { why: why(err) }); return false; }
    peer = p;
    peerEvents(p, g);
    p.on('open', () => {
      if (g !== gen) return;
      try { dial(); } catch (err) { setState('error', { why: why(err) }); return; }
      redial(); // si la primera llamada no abre (el anfitrión todavía no está), se vuelve a probar
    });
    return true;
  }
  /** Manda un objeto (se copia como JSON: nada de funciones ni undefined). → true si salió */
  function send(obj) {
    if (!conn || !conn.open || !obj || typeof obj !== 'object') return false;
    let msg;
    try { msg = JSON.parse(JSON.stringify(obj)); } catch (err) { console.error('YGO.net: mensaje que no es JSON', err); return false; }
    try { conn.send(msg); } catch (err) { console.warn('YGO.net: no se pudo mandar', err); return false; }
    if (tap.sent) tap.sent.push(msg);
    return true;
  }
  /** Salir de la sala (avisa al otro). quietly: sin estado 'idle' (lo usa host/join antes de empezar otra). */
  function leave(quietly) {
    gen++;
    clearTimers();
    if (conn && conn.open) { try { conn.send({ t: 'bye' }); } catch (err) { /* nada */ } }
    const c = conn, p = peer;
    conn = null;
    peer = null;
    // Un momento para que salga el "bye"
    setTimeout(() => {
      try { if (c) c.close(); } catch (err) { /* nada */ }
      try { if (p) p.destroy(); } catch (err) { /* nada */ }
    }, 150);
    role = quietly ? role : null;
    if (!quietly) { code = ''; setState('idle'); }
  }

  YGO.net = {
    available, host, join, send, leave, on, newCode, normCode, validCode,
    state: () => state, role: () => role, code: () => code, connected: () => !!(conn && conn.open),
    /** Pruebas: guarda todo lo que se manda y se recibe (tools/test_pvp.js revisa que nada oculto viaje). */
    tap(on) { tap.sent = on === false ? null : []; tap.got = on === false ? null : []; return tap; },
    taps: () => tap,
    // Para las pruebas de desconexión: corta la conexión directa como si se hubiera caído
    drop() { const c = conn; if (c) { try { c.close(); } catch (err) { /* nada */ } lost(c); } },
  };
})();
