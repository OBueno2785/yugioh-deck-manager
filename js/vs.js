/* Modo VS: el controlador del duelo contra la computadora (js/vs.js).
 * Mueve al rival en su turno (YGO.ai) con el ritmo elegido (Normal, Rápido, Paso a paso), abre las ventanas para que
 * respondas (activación, Invocación, ataque), lleva tu Fase de Batalla (Atacar, objetivo, Calcular daño), el límite de
 * mano, el piso de Deshacer, el final del duelo (¡Ganaste! / Perdiste / Empate, Revancha, Rendirse), Ajustar LP y las
 * filas VS de "Nuevo duelo". Toca el campo solo con YGO.field.port (field.js) y el estado del rival con YGO.duel.
 * Lo oculto del rival (su mano, su Mazo, su Extra Deck, sus cartas boca abajo) nunca sale de aquí: los textos vienen de
 * YGO.duel.rivalName / YGO.ai (sin nombres ocultos) y el HTML de YGO.vsview. Sin S.vs (modo Prueba) nada hace nada.
 * Expone window.YGO.vs. */
(function () {
  const YGO = (window.YGO = window.YGO || {});
  const P = () => (YGO.field && YGO.field.port) || null;
  const D = () => YGO.duel || null;
  const A = () => YGO.ai || null;
  const V = () => YGO.vsview || null;
  const PV = () => YGO.pvp || null; // en línea (js/pvp.js): el rival es otra persona
  const pvpOn = (s) => !!(s && s.vs && s.vs.pvp);
  const arr = (x) => (Array.isArray(x) ? x : []);
  const q = (name) => '«' + name + '»';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const PACE = { normal: 700, fast: 250, step: 0 };
  const WAIT_NO_ANSWER = 1200; // ventana sin nada con qué responder (Detenerse solo cuando puedo responder)
  const RETRY = 500;           // el rival espera (una ventana abierta, una invocación a medias…): vuelve a mirar
  const HAND_MAX = 6;
  const MON = ['emz0', 'emz1', 'mz0', 'mz1', 'mz2', 'mz3', 'mz4'];
  const PILES = ['deck', 'extra', 'gy', 'ban'];
  const STOP_LINE = 'El ataque se detiene';
  const CANT_MOVE = 'Ya atacó este turno: no puede cambiar de posición.';

  /* ---------- Estado de la pantalla (no va en S: Deshacer no lo restaura) ---------- */
  let gen = 0;          // cambia con cada duelo nuevo o Deshacer: los temporizadores viejos ya no hacen nada
  let timer = null;     // a lo sumo un temporizador del rival
  let ui = freshUi();   // tu ataque: { mode: 'target', attacker, targets: Set(zonas del rival), direct }
  let narr = null;      // lo último que hizo el rival (para la barra): { turn, text }
  let fails = 0;        // jugadas del rival que fallaron seguidas
  let lastLp = null;    // LP de la última vez (para el rojo / verde de los chips)
  let lpFx = { me: null, rival: null };
  let fxTimer = null;
  let sawOpp = false;   // la cadena abierta tuvo un eslabón del rival (al cerrarse, piso de Deshacer)
  let sawMine = false;  // la cadena abierta tuvo un eslabón tuyo (respondiste en su ventana de ataque)
  let lastBar = '';
  let respCache = { key: '', v: false };
  let running = false;  // un paso del rival en curso (no se encadena otro)
  let endTimer = null;
  let goneTimer = null; // tu atacante dejó el campo: el ataque se detiene después del dibujo

  function freshUi() { return { mode: null, attacker: null, targets: new Set(), direct: false }; }

  /* ---------- Lecturas ---------- */
  const S = () => { const p = P(); try { return p ? p.S() : null; } catch (err) { return null; } };
  function isVs() {
    const s = S();
    const d = D();
    return !!(s && s.vs && s.opp && d && typeof d.isVs === 'function' && d.isVs(s));
  }
  const turnOf = (s) => Number(s && s.turnState && s.turnState.turn) || 1;
  const onCampo = () => typeof document !== 'undefined' && document.body && document.body.dataset.mode === 'campo';
  const blocked = (p) => { try { return !!(p.busy() || p.modalOpen()); } catch (err) { return true; } };
  const phone = () => { try { return !!(window.matchMedia && window.matchMedia('(max-width: 899px)').matches); } catch (err) { return false; } };
  const myName = (uid) => { const f = P().find(uid); return f ? q((f.c && f.c.name) || P().nameById(f.inst.id)) : '?'; };
  const rivalName = (uid) => { try { return D().rivalName(S(), uid); } catch (err) { return 'una carta del rival'; } };
  const log = (kind, text) => { if (text) P().pushLog({ kind, text: String(text) }); };
  const atkOf = (side, uid) => { try { const st = D().stats(S(), side, uid); return st ? st.atk : 0; } catch (err) { return 0; } };
  const deckById = (id) => { if (id == null) return null; try { return arr(P().decks()).find((x) => x && String(x.id) === String(id)) || null; } catch (err) { return null; } };
  const playable = (dk) => !!(dk && arr(dk.main).length >= 5);
  const oppLinks = (s) => arr(s && s.chain).some((l) => l && l.owner === 'opp');
  const myLinks = (s) => arr(s && s.chain).some((l) => l && l.owner !== 'opp' && !l.done);
  /** ¿Terminó el duelo? En línea solo cuentan tus LP: los del rival los ve y los avisa su dueño (js/pvp.js). */
  const outcome = (s) => {
    if (!pvpOn(s) || (s.vs && s.vs.over)) return D().result(s);
    return (Number(s.lp) || 0) <= 0 ? { winner: 'rival', why: 'lp', turn: turnOf(s) } : null;
  };
  /** En línea: lo que no se puede hacer ahora (sin conexión, pasando el turno…); '' si se puede. */
  const pvpBlock = (s) => (pvpOn(s) && PV() && typeof PV().blockReason === 'function' ? String(PV().blockReason() || '') : '');

  /* ---------- Temporizador del rival ---------- */
  let timerKey = '';    // para qué es el temporizador pendiente ('tick', 'retry', 'win3'…)
  let winRef = null, winSeq = 0;
  function clearTimer() { if (timer) clearTimeout(timer); timer = null; timerKey = ''; }
  function after(ms, fn, key) {
    clearTimer();
    const g = gen;
    timerKey = key || 'x';
    timer = setTimeout(() => {
      timer = null;
      timerKey = '';
      if (g !== gen || !isVs()) return;
      try { fn(); } catch (err) { console.error('YGO.vs: falló el paso del rival', err); }
      // Si no quedó nada pendiente, se vuelve a mirar qué toca (nunca se queda quieto sin motivo)
      if (!timer && g === gen) schedule();
    }, Math.max(0, ms));
  }
  /** Clave de la ventana abierta (la misma ventana, la misma clave). */
  const winKey = (w) => { if (w !== winRef) { winRef = w; winSeq++; } return 'win' + winSeq; };
  /** ¿Puede seguir solo el rival ahora? 'go' | 'wait' (vuelve a mirar en un rato) | 'stop' (hasta el próximo dibujo). */
  function gate(s) {
    if (!s || !s.vs || s.vs.over || s.vs.paused) return 'stop';
    if (!onCampo()) return 'stop'; // al volver al campo se dibuja y sigue
    if (blocked(P())) return 'wait';
    return 'go';
  }
  /** Prepara lo próximo del rival (a lo sumo un temporizador). Lo llama render() después de cada dibujo; si ya hay un
   * temporizador para lo mismo, lo deja; si la situación cambió, lo reemplaza. */
  function schedule() {
    if (running || !isVs()) return;
    const want = plan(S());
    if (!want) { clearTimer(); return; }
    if (timer && timerKey === want.key) return;
    after(want.ms, want.fn, want.key);
  }
  /** Qué toca ahora: { key, ms, fn } o null (nada: espera un botón, tu turno, la pausa…). Si toca algo pero hay una
   * ventana abierta o una jugada tuya a medias, vuelve a mirar en un rato. */
  function plan(s) {
    if (!s || !s.vs || s.vs.over || s.vs.paused || !onCampo()) return null; // al volver al campo se dibuja y sigue
    if (pvpOn(s)) return null; // en línea no hay IA: el rival juega desde su navegador
    const w = s.vs.win;
    let want;
    if (w) {
      if (w.kind === 'mine-attack') return null;                  // espera Calcular daño / El ataque no sigue
      if (myLinks(s)) return null;                                // respondiste: espera Resolver cadena
      if (w.responded) return null;                               // ya respondiste a su ataque: espera Seguir
      if (!s.vs.askOnly || canRespond(w.kind)) return null;       // espera Seguir
      want = { key: winKey(w), ms: WAIT_NO_ANSWER, fn: () => {    // no tienes con qué responder: sigue solo
        const s2 = S();
        if (!s2 || !s2.vs || s2.vs.win !== w || w.responded || gate(s2) !== 'go' || myLinks(s2) || (s2.vs.askOnly && canRespond(w.kind))) return;
        continueWindow();
      } };
    } else {
      if (s.turnState.mine || arr(s.chain).length) return null;
      if (s.vs.pace === 'step') return null;                      // espera Siguiente
      want = { key: 'tick', ms: PACE[s.vs.pace] || PACE.normal, fn: tick };
    }
    if (blocked(P())) return { key: 'retry', ms: RETRY, fn: () => {} };
    return want;
  }
  function tick() {
    const s = S();
    if (gate(s) !== 'go' || s.vs.win || s.turnState.mine || arr(s.chain).length) return; // after() vuelve a mirar
    stepNow();
    P().render();
  }

  /* ---------- Un paso del rival ---------- */
  /** Una jugada del rival (sin foto: port.quiet). → true si hizo algo. */
  function stepNow() {
    const s = S();
    const p = P();
    if (!s || running || pvpOn(s)) return false;
    running = true;
    const from = arr(s.log).length;
    let act = null;
    try {
      try { act = A().next(s); } catch (err) { console.error('YGO.ai.next falló', err); act = null; }
      if (!act) {
        if (!s.vs.win && !s.vs.over && !s.turnState.mine && !arr(s.chain).length) failed(s, null, 'sin jugada');
        return false;
      }
      let ok = true;
      p.quiet(() => { ok = apply(s, act) !== false; });
      if (ok) fails = 0; else failed(s, act, 'falló');
      p.lockUndo(); // lo que hizo el rival no se deshace
      const lines = arr(s.log).slice(from).filter((e) => e && e.text && e.kind !== 'phase').map((e) => e.text);
      if (lines.length) narr = { turn: turnOf(s), text: lines[lines.length - 1] };
      if (s.vs.over) endDuel(s.vs.over);
      else checkEnd();
      return true;
    } finally { running = false; }
  }
  function failed(s, act, why) {
    try { if (act && act.key && s.opp && s.opp.ai) s.opp.ai.tried[act.key] = true; } catch (err) { /* nada */ }
    fails++;
    if (fails < 3) return;
    fails = 0;
    console.error('YGO.vs: el rival no pudo seguir (' + why + '); pasa el turno', act);
    if (s.turnState.mine || s.vs.over) return;
    P().quiet(() => {
      log('opp', 'El rival termina su turno.');
      s.vs.win = null;
      P().passTurn({ rival: true });
    });
    P().lockUndo();
  }
  /** Hace la jugada del rival. → false si no se pudo. */
  function apply(s, act) {
    const p = P();
    const d = D();
    switch (act.kind) {
      case 'draw': {
        const r = d.draw(s, 1, { normal: true });
        log('opp', (r && r.text) || 'El rival roba 1 carta.');
        return true;
      }
      case 'phase': {
        const ph = s.turnState.phase;
        // De la Fase de Robo a la Principal 1 pasa por la Standby (queda en el registro)
        if (act.to === 'main1' && ph === 'draw') p.setPhase('standby', { rival: true });
        p.setPhase(act.to, { rival: true });
        return s.turnState.phase === act.to;
      }
      case 'pass':
        s.vs.win = null;
        p.passTurn({ rival: true });
        return true;
      case 'attack': return rivalAttack(s, act);
      default: {
        const r = A().run(s, act);
        arr(r && r.logs).forEach((e) => { if (e && e.text) p.pushLog({ kind: e.kind || 'opp', text: String(e.text) }); });
        if (!r || !r.ok) return false;
        if (r.window && r.window.kind) s.vs.win = { kind: r.window.kind, text: String(r.window.text || '') };
        return true;
      }
    }
  }
  /** El rival declara un ataque: queda la ventana de ataque (Seguir · El ataque no sigue). */
  function rivalAttack(s, act) {
    const d = D();
    const f = d.findRival(s, act.attacker);
    if (!f || f.where !== 'field') return false;
    const c = YGO.db.get(f.inst.id);
    const a = q((f.inst.token && f.inst.token.name) || (c && c.name) || '?');
    const atk = atkOf('rival', act.attacker);
    let text, line;
    if (act.target) {
      const mf = P().find(act.target);
      if (!mf || mf.loc.area !== 'field') return false;
      const t = myName(act.target) + (mf.inst.faceDown ? ' (boca abajo)' : '');
      text = a + ' del rival (ATK ' + atk + ') ataca a tu ' + t + '.';
      line = a + ' del rival ataca a tu ' + t + '.';
    } else {
      text = a + ' del rival (ATK ' + atk + ') te ataca directamente.';
      line = a + ' del rival te ataca directamente.';
    }
    f.inst.attackedTurn = turnOf(s);
    log('battle', line);
    s.vs.win = { kind: 'attack', text, attack: { side: 'rival', attacker: act.attacker, target: act.target || null } };
    return true;
  }

  /* ---------- Ventanas ---------- */
  /** Seguir: la ventana abierta continúa (la cadena se resuelve; en un ataque, el cálculo de daño). */
  function continueWindow() {
    const s = S();
    const p = P();
    const w = s && s.vs && s.vs.win;
    if (!w) return;
    // En línea: tu ataque lo calcula el rival (conoce su monstruo); su activación: Pasar
    if (pvpOn(s) && w.kind === 'mine-attack') { if (arr(s.chain).length) p.resolveChain(); return; }
    if (pvpOn(s) && w.kind === 'activation') { if (PV()) PV().pass(); return; }
    if (w.kind === 'mine-attack') { if (arr(s.chain).length) p.resolveChain(); else damageStep(); return; }
    if (arr(s.chain).length) {
      // La cadena (su eslabón y tus respuestas) se resuelve; al cerrarse, chainClosed sigue con la ventana
      p.quiet(() => p.resolveChain());
      if (arr(S().chain).length) p.render(); // quedó en pausa ("Primero tus eslabones"): sigue con Seguir resolviendo
      return;
    }
    if (w.kind === 'attack') { damageStep(); return; }
    s.vs.win = null;
    p.lockUndo();
    p.render();
  }
  /** Lo que la ventana permite responder: alguna carta tuya (mano, campo boca arriba, colocadas, Cementerio,
   * desterradas boca arriba) con un efecto de velocidad 2 o más que las reglas dejan activar ahora. */
  function canRespond(kind) {
    const s = S();
    const p = P();
    if (!s || !p) return false;
    const key = [gen, turnOf(s), s.turnState.phase, arr(s.log).length, arr(s.chain).length, kind, s.hand.length].join('|');
    if (respCache.key === key) return respCache.v;
    let v = false;
    const cards = [];
    arr(s.hand).forEach((x) => cards.push(x));
    Object.keys(s.zones || {}).forEach((z) => {
      const top = arr(s.zones[z])[0];
      if (!top) return;
      if (top.faceDown && MON.includes(z)) return; // monstruo boca abajo: no responde
      cards.push(top);
    });
    arr(s.gy).forEach((x) => cards.push(x));
    arr(s.ban).forEach((x) => { if (!x.faceDown) cards.push(x); });
    try {
      for (const x of cards) {
        const c = p.cardOf(x);
        if (!c) continue;
        for (const e of arr(p.effectsOf(c))) {
          if (!e || (Number(e.speed) || 0) < 2 || e.kind === 'continuous' || e.kind === 'summon') continue;
          if (p.canActivate(x.uid, e.index)) { v = true; break; }
        }
        if (v) break;
      }
    } catch (err) { v = true; } // ante la duda, espera a que sigas tú
    respCache = { key, v };
    return v;
  }

  /* ---------- Batalla ---------- */
  /** "Atacar": modo objetivo (las celdas de sus monstruos se marcan). */
  function startAttack(uid) {
    const s = S();
    const d = D();
    if (pvpBlock(s)) { P().toast(pvpBlock(s)); return; }
    const can = d.canAttack(s, 'me', uid);
    if (!can.ok) { P().toast(can.why || 'No puede atacar ahora.'); return; }
    const t = d.targets(s, 'me');
    ui = { mode: 'target', attacker: uid, targets: new Set(arr(t.monsters).map((m) => m.zone)), direct: !!t.direct };
    P().select(null); // cierra la hoja de acciones y dibuja
  }
  function cancelTarget() {
    ui = freshUi();
    P().render();
  }
  /** Declara tu ataque (target: uid de su monstruo o null = directo). El rival puede responder (handtraps, colocadas). */
  function declareAttack(target) {
    const s = S();
    const p = P();
    const d = D();
    const uid = ui.attacker;
    if (!uid) return;
    if (pvpBlock(s)) { ui = freshUi(); p.toast(pvpBlock(s)); p.render(); return; }
    const can = d.canAttack(s, 'me', uid);
    if (!can.ok) { ui = freshUi(); p.toast(can.why || 'No puede atacar ahora.'); p.render(); return; }
    const t = d.targets(s, 'me');
    if (!target && !t.direct) { p.toast('No puedes atacar directamente: el rival controla monstruos.'); return; }
    if (target && !arr(t.monsters).some((m) => m.uid === target)) { p.toast('Ese no es un objetivo válido.'); return; }
    p.snapshot(); // "Deshacer" vuelve a antes de declarar (si el rival no respondió)
    const f = p.find(uid);
    f.inst.attackedTurn = turnOf(s);
    const a = myName(uid);
    let text;
    if (!target) text = a + ' ataca directamente.';
    else {
      const rf = d.findRival(s, target);
      text = rf && rf.inst.faceDown ? a + ' ataca a un monstruo boca abajo.' : a + ' ataca a ' + rivalName(target) + '.';
    }
    log('battle', text);
    s.vs.win = { kind: 'mine-attack', text, attack: { side: 'me', attacker: uid, target: target || null }, declared: true };
    ui = freshUi();
    p.render();
    // El rival ve la declaración: puede responder (sus handtraps con bot.js; sus Trampas colocadas con YGO.ai)
    p.botEvent({ type: 'attack', attacker: uid, target: target || null });
    p.render();
  }
  /** "El ataque no sigue": el ataque cuenta como hecho, pero no hay cálculo de daño. */
  function stopAttack() {
    const s = S();
    const p = P();
    const w = s.vs.win;
    if (!w || !w.attack) return;
    if (arr(s.chain).length) { p.toast('Primero resuelve la cadena.'); return; }
    p.snapshot();
    const a = w.attack.side === 'me' ? myName(w.attack.attacker) : rivalName(w.attack.attacker);
    log('battle', 'El ataque de ' + a + ' no sigue.');
    s.vs.win = null;
    if (pvpOn(s) && PV()) PV().attackStopped(w.attack);
    p.render();
  }
  /** Cambias de fase o pasas el turno con tu ataque declarado sin calcular el daño: no sigue (cuenta como hecho y queda
   * en el registro, como «El ataque no sigue»). Lo llama field.js antes de cambiar de fase. */
  function dropAttack() {
    const s = S();
    const w = s && s.vs && s.vs.win;
    if (!isVs() || !w || w.kind !== 'mine-attack' || !w.attack) return;
    const f = P().find(w.attack.attacker);
    log('battle', 'El ataque de ' + (f ? myName(w.attack.attacker) : 'tu monstruo') + ' no sigue.');
    s.vs.win = null;
    // En línea, el rival también deja de esperarlo
    if (pvpOn(s) && PV()) PV().attackStopped(w.attack);
  }
  /** ¿Tu atacante ya dejó el campo? (p. ej. «Sakuretsu Armor» del rival lo destruyó) */
  const attackerGone = (w) => { const f = P().find(w.attack.attacker); return !(f && f.loc && f.loc.area === 'field'); };
  /** Cálculo de daño del ataque de la ventana (el tuyo o el del rival). */
  function damageStep() {
    const s = S();
    const p = P();
    const d = D();
    const w = s.vs.win;
    if (!w || !w.attack) return;
    if (arr(s.chain).length) { p.toast('Primero resuelve la cadena.'); return; }
    // En línea, el daño lo calcula quien defiende (sabe qué tiene boca abajo)
    if (pvpOn(s) && w.attack.side === 'me') { p.toast('El daño lo calcula el rival cuando decide no responder.'); return; }
    const at = w.attack;
    const lines = [];
    let fought = null;
    p.quiet(() => {
      const res = d.battle(s, { side: at.side, attacker: at.attacker, target: at.target });
      if (!res || res.ok === false) {
        const mine = at.side === 'me';
        const aName = mine ? myName(at.attacker) : rivalName(at.attacker);
        if (res && res.gone === 'target') {
          const tName = mine ? rivalName(at.target) : myName(at.target);
          // El ataque no cuenta: el atacante puede declarar otro (el rival elige de nuevo)
          const af = mine ? p.find(at.attacker) : d.findRival(s, at.attacker);
          if (af && af.inst) delete af.inst.attackedTurn;
          lines.push(mine ? STOP_LINE + ': ' + (/^«/.test(tName) ? tName : 'el monstruo') + ' ya no está (puedes declarar otro ataque con ' + aName + ').'
            : STOP_LINE + ': tu monstruo ya no está.');
        } else lines.push(STOP_LINE + ': ' + aName + ' ya no está.');
      } else {
        const r = d.applyBattle(s, res, { leaveMine: (uid) => p.leaveField(uid) });
        lines.push(...arr(r && r.lines));
        if (r && arr(r.ops).length) p.applyOps(r.ops, 'Batalla');
      }
      fought = res;
      s.vs.win = null;
      lines.forEach((t) => log('battle', t));
    });
    // En línea: el atacante cierra su ataque (lo que le pasó a sus cartas ya le llegó como pedido)
    if (pvpOn(s) && PV()) PV().battleDone(at, fought);
    p.lockUndo();
    const over = outcome(s);
    if (over) { endDuel(over); return; }
    p.render();
  }

  /* ---------- Final del duelo ---------- */
  const TITLE = { me: '¡Ganaste!', rival: 'Perdiste', draw: 'Empate' };
  const WORD = { me: 'ganaste', rival: 'perdiste', draw: 'empate' };
  function endDuel(over) {
    const s = S();
    const p = P();
    const d = D();
    if (!s || !s.vs) return;
    if (!s.vs.over) s.vs.over = Object.assign({ turn: turnOf(s) }, over);
    over = s.vs.over;
    clearTimer();
    ui = freshUi();
    s.vs.win = null;
    if (s.vs.recorded !== over.winner) {
      const dk = p.deck() || {};
      // (En línea no se guarda en el historial del VS: ese es por mazo rival de la computadora)
      if (!pvpOn(s)) { try { d.record(s, { myDeckId: dk.id != null ? dk.id : null, myDeckName: dk.name || '' }); } catch (err) { console.warn('YGO.duel.record falló', err); } }
      else s.vs.recorded = over.winner;
      log('vs', over.why === 'nostart' ? 'El duelo en línea no empezó: el rival no pudo repartir su mano.' : 'Fin del duelo: ' + TITLE[over.winner] + ' (turno ' + (over.turn || turnOf(s)) + ').');
    }
    p.lockUndo();
    if (pvpOn(s) && PV()) PV().ended(over);
    p.render();
    showEnd();
  }
  function checkEnd() {
    const s = S();
    if (!s || !s.vs || s.vs.over) return false;
    const over = outcome(s);
    if (over) { endDuel(over); return true; }
    return false;
  }
  function showEnd() {
    const s = S();
    const p = P();
    const over = s && s.vs && s.vs.over;
    if (!over) return;
    let stats = null;
    if (pvpOn(s)) {
      p.openDialog(TITLE[over.winner] || 'Fin del duelo', V().endBody(over, null, s), [
        { label: 'Ver el campo' },
        { label: 'Salir de la sala', action: () => { if (PV()) PV().leave(); } },
        { label: 'Revancha', kind: 'primary', action: rematch },
      ]);
      return;
    }
    try { stats = D().statsVs(null, s.vs.rival ? s.vs.rival.id : null); } catch (err) { stats = null; }
    p.openDialog(TITLE[over.winner] || 'Fin del duelo', V().endBody(over, stats, s), [
      { label: 'Ver el campo' },
      { label: 'Nuevo duelo…', action: () => p.openSetup({ vs: true }) },
      { label: 'Revancha', kind: 'primary', action: rematch },
    ]);
  }
  /** Revancha: los mismos mazos y opciones, otra semilla (Al azar vuelve a tirar la moneda). */
  function rematch() {
    const s = S();
    const p = P();
    if (pvpOn(s)) { if (PV()) PV().rematch(); return; }
    const st = Object.assign({}, (s && s.start && s.start.vs) || {});
    const rival = deckById(st.rivalId != null ? st.rivalId : s && s.vs && s.vs.rival && s.vs.rival.id);
    if (!playable(rival)) { p.toast('El mazo del rival ya no está: elige otro.', 'bad'); p.openSetup({ vs: true }); return; }
    delete st.seed;
    p.newDuel(null, null, { vs: Object.assign(st, { rival, rivalId: rival.id, seed: undefined }) });
  }
  function concede() {
    if (!isVs()) return;
    const s = S();
    const p = P();
    if (s.vs.over) { p.toast('El duelo terminó'); return; }
    p.openDialog('¿Rendirte?', '<p>Cuenta como derrota.</p>', [
      { label: 'Seguir jugando' },
      { label: 'Rendirme', kind: 'danger', action: () => { log('vs', 'Te rindes.'); endDuel({ winner: 'rival', why: 'concede', turn: turnOf(S()) }); } },
    ]);
  }

  /* ---------- LP ---------- */
  function adjustLp(side) {
    if (!isVs()) return;
    side = side === 'rival' ? 'rival' : 'me';
    const s = S();
    const p = P();
    if (s.vs.over) { p.toast('El duelo terminó'); return; }
    const cur = side === 'me' ? Number(s.lp) || 0 : Number(s.opp.lp) || 0;
    const body = '<div class="setup vs-lpdlg"><label class="field"><span>' + (side === 'me' ? 'Tus LP' : 'LP del rival') + '</span>'
      + '<input type="number" id="vs-lp-in" min="0" step="100" inputmode="numeric" value="' + cur + '"></label>'
      + '<div class="seg" role="group" aria-label="Cambios rápidos">'
      + [-1000, -500, 500, 1000].map((n) => '<button type="button" data-lpd="' + n + '">' + (n < 0 ? '−' + -n : '+' + n) + '</button>').join('') + '</div>'
      + '<p class="hint">Queda en el registro y se puede deshacer. Con 0 LP termina el duelo.</p></div>';
    const applyNow = () => {
      const inp = $('#vs-lp-in');
      // Solo un número de 0 o más (vacío o negativo no deja los LP en 0 por error)
      const raw = String((inp && inp.value) || '').trim();
      if (!/^\d+$/.test(raw)) { p.toast('Escribe los LP (un número de 0 o más).', 'bad'); return; }
      const v = Math.round(Number(raw));
      if (!Number.isFinite(v)) { p.toast('Escribe los LP (un número de 0 o más).', 'bad'); return; }
      const s2 = S();
      const now = side === 'me' ? Number(s2.lp) || 0 : Number(s2.opp.lp) || 0;
      p.closeModal();
      if (v === now) return;
      p.snapshot();
      const r = D().setLp(s2, side, v);
      log('manual', r && r.text);
      if (!checkEnd()) p.render();
    };
    p.openDialog(side === 'me' ? 'Ajustar tus LP' : 'Ajustar LP del rival', body, [
      { label: 'Cancelar' },
      { label: 'Aplicar', kind: 'primary', keep: true, action: applyNow },
    ]);
    const root = $('#modal-body');
    const inp = $('#vs-lp-in', root);
    $$('[data-lpd]', root).forEach((b) => b.addEventListener('click', () => {
      inp.value = String(Math.max(0, (Number(inp.value) || 0) + Number(b.dataset.lpd)));
    }));
    if (inp) inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyNow(); } });
  }
  /** Rojo (bajan) o verde (suben) en los chips de LP durante 600 ms. */
  function lpTrack(s) {
    const now = { me: Number(s.lp) || 0, rival: Number(s.opp && s.opp.lp) || 0 };
    if (!lastLp) { lastLp = now; return; }
    let changed = false;
    ['me', 'rival'].forEach((k) => {
      if (now[k] === lastLp[k]) return;
      lpFx[k] = now[k] < lastLp[k] ? 'hit' : 'gain';
      changed = true;
    });
    lastLp = now;
    if (!changed) return;
    clearTimeout(fxTimer);
    const g = gen;
    fxTimer = setTimeout(() => {
      lpFx = { me: null, rival: null };
      if (g === gen && isVs()) P().render();
    }, 600);
  }

  /* ---------- Límite de mano ---------- */
  /** Antes de pasar tu turno: con más de 6 cartas en la mano, descartas hasta 6 (luego sigue cont). */
  function beforePass(cont0) {
    const s = S();
    const p = P();
    // En línea: antes de pasar el turno, el rival confirma que no está activando nada (js/pvp.js)
    const cont = pvpOn(s) && PV() ? () => PV().askPass(cont0) : cont0;
    if (!isVs() || arr(s.hand).length <= HAND_MAX) { cont(); return; }
    const n = s.hand.length - HAND_MAX;
    const cands = s.hand.map((x) => ({ uid: x.uid, area: 'hand', c: p.cardOf(x), inst: x })).filter((x) => x.c);
    const action = { verb: 'discard', count: { min: n, max: n }, from: ['hand'], filter: null };
    Promise.resolve(p.pickCards({ title: 'Descarta hasta tener 6 cartas (te sobran ' + n + ')', action, cands, min: n, max: n, cancel: true }))
      .then((r) => {
        if (!Array.isArray(r) || r.length !== n) {
          p.toast(r === 'manual' ? 'Descarta a mano hasta tener 6 cartas y vuelve a pasar el turno.' : 'Para pasar el turno, descarta hasta tener 6 cartas.');
          return;
        }
        const s2 = S();
        if (s2 !== s || !isVs() || !s2.turnState.mine) return;
        p.snapshot();
        p.discard(r, 'por el límite de mano');
        cont();
      });
  }

  /* ---------- Cartas del rival (tocar su campo y sus pilas) ---------- */
  function clickRival(key) {
    if (!isVs()) return;
    const s = S();
    const p = P();
    const d = D();
    key = String(key || '');
    if (ui.mode === 'target') {
      if (ui.targets.has(key)) {
        const e = d.entryAt(s, key);
        if (e) declareAttack(e.uid);
      } else p.toast('Toca un monstruo del rival marcado' + (ui.direct ? ' o elige Ataque directo' : '') + ' (o Cancelar).');
      return;
    }
    if (p.busy()) { p.toast('Termina primero lo que estás haciendo.'); return; }
    const o = s.opp;
    if (key === 'deck') { p.toast('El Mazo del rival tiene ' + nOf(arr(o.deck).length) + '.'); return; }
    if (key === 'extra') {
      const up = arr(o.extra).filter((x) => x && x.extraFaceUp).length;
      if (up) openPile('extra');
      else p.toast('El Extra Deck del rival tiene ' + nOf(arr(o.extra).length) + '.');
      return;
    }
    if (key === 'gy' || key === 'ban') { openPile(key); return; }
    const e = d.entryAt(s, key);
    if (e) p.oppField(e.uid);
  }
  const nOf = (n) => n + ' ' + (n === 1 ? 'carta' : 'cartas');
  const PILE_TITLE = { gy: 'Cementerio del rival', ban: 'Desterradas del rival', extra: 'Extra Deck del rival (boca arriba)' };
  /** Su Cementerio, sus desterradas (o sus Péndulos boca arriba del Extra Deck): lista pública; tocar una carta, qué hacer. */
  function openPile(pile) {
    const s = S();
    const p = P();
    const list = arr(s.opp[pile]);
    p.openDialog(PILE_TITLE[pile] + ' (' + (pile === 'extra' ? list.filter((x) => x && x.extraFaceUp).length : list.length) + ')', V().pileList(s, pile), [{ label: 'Cerrar', kind: 'primary' }]);
    const root = $('#modal-body');
    const go = (el) => {
      const s2 = S();
      const x = arr(s2.opp[pile])[Number(el.dataset.ri)];
      if (x) pileCard(pile, x);
    };
    $$('[data-ri]', root).forEach((el) => {
      el.addEventListener('click', () => go(el));
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(el); } });
    });
  }
  function pileCard(pile, x) {
    const p = P();
    const d = D();
    const hidden = !d.isPublic(pile, x);
    const c = hidden ? null : YGO.db.get(x.id);
    const extra = !!(c && YGO.db.isExtra(c));
    const items = [];
    if (pile === 'gy') items.push({ label: 'Desterrar', kind: 'primary', action: () => pileMove(x.uid, 'ban', 'banish') });
    if (pile !== 'extra') {
      items.push({ label: extra ? 'Al Extra Deck' : 'A su mano', action: () => pileMove(x.uid, 'hand', 'hand') });
      items.push({ label: extra ? 'Al Extra Deck (barajar)' : 'A su Mazo', action: () => pileMove(x.uid, 'deck', 'deck') });
    }
    if (c) items.push({ label: 'Ver la carta', kind: 'link-btn', action: () => p.showCard(x.id) });
    const where = { gy: 'Cementerio del rival', ban: 'Desterradas del rival', extra: 'Extra Deck del rival' }[pile];
    p.chooser(where + ' · ' + (c ? c.name : 'Carta boca abajo'), c ? 'Si un efecto tuyo la mueve, elige adónde va.' : 'Desterrada boca abajo: no se ve.', items);
  }
  /** Mueve una carta de su Cementerio o destierro por un efecto tuyo (con foto para Deshacer). */
  function pileMove(uid, dest, how) {
    const p = P();
    const d = D();
    const s = S();
    const opts = { how, by: 'un efecto tuyo' };
    // Prueba en una copia: si el rival no lo permite (p. ej. nadie destierra), no se toma foto
    let probe = null;
    try { probe = d.moveRival(JSON.parse(JSON.stringify(s)), uid, dest, opts); } catch (err) { probe = null; }
    if (!probe || !probe.ok) { p.openDialog('No se puede', '<p class="hint">' + esc((probe && probe.why) || 'No se pudo mover esa carta del rival.') + '</p>', [{ label: 'Entendido', kind: 'primary' }]); return; }
    p.snapshot();
    const r = d.moveRival(s, uid, dest, opts);
    if (r && r.text) log('manual', 'Movimiento manual: ' + r.text);
    if (r && arr(r.ops).length) p.applyOps(r.ops, 'un efecto tuyo');
    p.render();
  }

  /* ---------- Barra del VS (#fd-vs) ---------- */
  function barModel(s) {
    const p = P();
    const t = s.turnState;
    const over = s.vs.over;
    const pause = { id: 'vs-pause', label: s.vs.paused ? 'Reanudar' : 'Pausar', kind: s.vs.paused ? 'primary' : '' };
    if (over) {
      return { tone: 'end', text: 'Duelo terminado: ' + WORD[over.winner] + '.', buttons: [{ id: 'vs-again', label: 'Revancha', kind: 'primary' }, { id: 'vs-result', label: 'Ver resultado' }] };
    }
    if (ui.mode === 'target' && ui.attacker) {
      return {
        tone: 'battle', text: myName(ui.attacker) + ' (ATK ' + atkOf('me', ui.attacker) + ') ataca: toca un monstruo del rival',
        buttons: [{ id: 'vs-direct', label: 'Ataque directo', kind: ui.direct ? 'primary' : '', disabled: !ui.direct, title: ui.direct ? '' : 'El rival controla monstruos' },
          { id: 'vs-cancel', label: 'Cancelar' }],
      };
    }
    // En línea: las ventanas, la cadena y el turno del rival los cuenta js/pvp.js (null: como siempre)
    if (pvpOn(s) && PV()) { const m = PV().bar(s); if (m) return m; }
    const w = s.vs.win;
    const chain = arr(s.chain).length > 0;
    if (w && w.kind === 'mine-attack' && w.attack) {
      const a = myName(w.attack.attacker);
      const tg = w.attack.target ? rivalName(w.attack.target) : 'ataque directo';
      if (chain) {
        return { tone: 'battle', text: 'Ataque declarado: ' + a + ' → ' + tg + '. Resuelve la cadena antes de calcular el daño.',
          buttons: [{ id: 'vs-next', label: 'Resolver cadena', kind: 'primary' }] };
      }
      return { tone: 'battle', text: 'Ataque declarado: ' + a + ' → ' + tg,
        buttons: [{ id: 'vs-next', label: 'Calcular daño', kind: 'primary' }, { id: 'vs-stop', label: 'El ataque no sigue' }] };
    }
    if (w) {
      const resp = myLinks(s);
      const seguir = { id: 'vs-next', label: resp ? 'Resolver cadena' : 'Seguir', kind: 'primary' };
      const auto = s.vs.askOnly && !resp && !s.vs.paused && !w.responded && !canRespond(w.kind);
      const sub = auto ? 'No tienes con qué responder: sigue solo.'
        : w.responded && !resp ? 'Si algo de tu respuesta quedó a mano, hazlo ahora (toca sus cartas) y pulsa Seguir para calcular el daño.'
        : w.kind === 'activation' ? 'Si tu respuesta niega el efecto del rival, toca «Negado» en su eslabón.' : '';
      if (w.kind === 'attack') {
        return { tone: 'battle', text: w.text, sub, paused: s.vs.paused,
          buttons: [seguir, { id: 'vs-stop', label: 'El ataque no sigue' }, pause] };
      }
      return { tone: 'rival', text: w.text, sub, paused: s.vs.paused, buttons: [seguir, pause] };
    }
    if (!t.mine) {
      const ph = p.phaseName(t.phase);
      if (chain) {
        return { tone: 'rival', text: 'Turno del rival · ' + ph + ': hay una cadena abierta; resuélvela para que el rival siga.', paused: s.vs.paused,
          buttons: [{ id: 'vs-next', label: 'Resolver cadena', kind: 'primary' }, pause] };
      }
      const said = narr && narr.turn === t.turn ? ': ' + narr.text : '.';
      const btns = [];
      if (s.vs.pace === 'step' || s.vs.paused) btns.push({ id: 'vs-next', label: 'Siguiente', kind: s.vs.pace === 'step' ? 'primary' : '' });
      btns.push(pause);
      return { tone: 'rival', text: (s.vs.paused ? 'En pausa · ' : '') + 'Turno del rival · ' + ph + said, paused: s.vs.paused,
        sub: s.vs.paused ? 'Haz a mano lo que haga falta (toca sus cartas o sus LP) y pulsa Reanudar.' : '', buttons: btns };
    }
    if (t.phase === 'battle') {
      const any = MON.some((z) => { const x = arr(s.zones[z])[0]; return x && attackOk(s, x.uid); });
      return { tone: 'battle', text: any ? 'Fase de Batalla: toca un monstruo tuyo en ATK y elige «Atacar».'
        : 'Fase de Batalla: no tienes monstruos que puedan atacar ahora.', buttons: [] };
    }
    return { tone: 'mine', text: 'Tu turno · ' + p.phaseName(t.phase) + (t.turn === 1 ? ' (primer turno: sin Fase de Batalla)' : ''), buttons: [] };
  }
  const attackOk = (s, uid) => { try { return !!D().canAttack(s, 'me', uid).ok; } catch (err) { return false; } };

  function barClick(btn) {
    if (!isVs() || !btn) return;
    const s = S();
    const p = P();
    if (/^pvp-/.test(btn.id || '')) { if (PV()) PV().barClick(btn.id); return; }
    switch (btn.id) {
      case 'vs-next': return next();
      case 'vs-stop': return stopAttack();
      case 'vs-direct': return declareAttack(null);
      case 'vs-cancel': return cancelTarget();
      case 'vs-pause':
        s.vs.paused = !s.vs.paused;
        clearTimer();
        p.render();
        return;
      case 'vs-again': return rematch();
      case 'vs-result': return showEnd();
      default: return;
    }
  }
  /** Siguiente / Seguir / Calcular daño / Resolver cadena: lo que toque ahora. */
  function next() {
    const s = S();
    const p = P();
    if (s.vs.over) return;
    if (p.busy()) { p.toast('Termina primero lo que estás haciendo.'); return; }
    clearTimer();
    const w = s.vs.win;
    if (w && w.kind === 'mine-attack') {
      if (arr(s.chain).length) p.resolveChain(); else damageStep();
      return;
    }
    if (w) { continueWindow(); return; }
    if (arr(s.chain).length) { p.resolveChain(); return; }
    if (!s.turnState.mine && !pvpOn(s)) { stepNow(); p.render(); }
  }
  function oppClick(btn) {
    if (!isVs() || !btn) return;
    const k = btn.dataset ? btn.dataset.vsopp : '';
    if (k === 'lp') adjustLp('rival');
    else if (k === 'setup') { if (pvpOn(S()) && PV()) PV().open({}); else P().openSetup({ vs: true }); }
  }

  /* ---------- Ganchos de field.js ---------- */
  function reset() {
    gen++;
    clearTimer();
    clearTimeout(fxTimer);
    clearTimeout(endTimer);
    clearTimeout(goneTimer);
    fxTimer = null;
    endTimer = null;
    goneTimer = null;
    ui = freshUi();
    narr = null;
    fails = 0;
    lastLp = null;
    lpFx = { me: null, rival: null };
    sawOpp = false;
    sawMine = false;
    lastBar = '';
    respCache = { key: '', v: false };
    running = false;
  }
  function begin() {
    if (!isVs()) return;
    const s = S();
    const p = P();
    lastLp = { me: Number(s.lp) || 0, rival: Number(s.opp.lp) || 0 };
    p.lockUndo(); // repartir no se deshace
    if (s.turnState.mine) phoneScroll(true);
    else phoneScroll(false);
    p.render();
  }
  function turnChanged() {
    if (!isVs()) return;
    const s = S();
    const p = P();
    clearTimer();
    ui = freshUi();
    narr = null;
    fails = 0;
    if (s.vs.over) { p.render(); return; }
    if (s.turnState.mine) {
      if (!arr(s.deck).length) {
        log('vs', 'No puedes robar: tu Mazo está vacío.');
        endDuel({ winner: 'rival', why: 'deckout', turn: turnOf(s) });
        return;
      }
      // Robas en tu Fase de Robo y el turno queda ahí (como en Dueling Nexus): tú pasas a la Standby y a la Principal 1
      p.quiet(() => {
        S().turnState.phase = 'draw';
        p.draw(1);
      });
      p.lockUndo();
      p.toast('Tu turno', 'ok');
      p.render();
      phoneScroll(true);
    } else {
      s.vs.win = null;
      p.lockUndo(); // turno nuevo: lo tuyo de antes ya no se deshace
      p.render();
      phoneScroll(false);
    }
  }
  function chainClosed() {
    if (!isVs()) return;
    const s = S();
    const p = P();
    const had = sawOpp;
    const mineToo = sawMine;
    sawOpp = false;
    sawMine = false;
    respCache = { key: '', v: false };
    if (s.vs.over) return;
    const w = s.vs.win;
    if (had || (w && w.kind === 'activation')) p.lockUndo(); // lo que resolvió el rival no se deshace
    if (checkEnd()) return;
    if (w) {
      if (w.kind === 'attack') {
        // Respondiste a su ataque y su monstruo sigue ahí: la ventana queda abierta (Seguir / El ataque no sigue) para que
        // termines a mano lo que tu respuesta no hizo sola ("Haz a mano") antes de calcular el daño
        const at = w.attack;
        const still = at && at.side === 'rival' && (() => { try { const f = D().findRival(s, at.attacker); return !!(f && f.where === 'field'); } catch (err) { return false; } })();
        if (mineToo && still) { w.responded = true; p.render(); return; }
        // En línea: el daño se calcula cuando tocas Seguir (el atacante también pudo responder); sin atacante, se detiene ya
        if (pvpOn(s) && still) { w.responded = true; p.render(); return; }
        damageStep();
        return;
      }
      if (w.kind === 'activation' || w.kind === 'summon') { s.vs.win = null; p.lockUndo(); }
      // Tu ataque y la respuesta del rival se llevó a tu atacante: el ataque se detiene (sin esperar a Calcular daño)
      // (en línea lo decide el rival, que calcula el daño)
      if (w.kind === 'mine-attack' && w.attack && attackerGone(w) && !pvpOn(s)) { damageStep(); return; }
    }
    p.render();
  }
  function restored() {
    gen++;
    clearTimer();
    ui = freshUi();
    running = false;
    respCache = { key: '', v: false };
    const s = S();
    if (s && s.vs) {
      lastLp = { me: Number(s.lp) || 0, rival: Number(s.opp && s.opp.lp) || 0 };
      lpFx = { me: null, rival: null };
      sawOpp = oppLinks(s);
      sawMine = myLinks(s);
    }
    // En línea: el lado del rival (y sus eslabones) vuelven a como los dejó él, no a la foto vieja
    if (pvpOn(s) && PV()) PV().restored();
  }
  function render() {
    if (!isVs()) return;
    const s = S();
    const p = P();
    const t = s.turnState;
    if (oppLinks(s)) sawOpp = true;
    if (myLinks(s)) sawMine = true;
    lpTrack(s);
    // Tu ataque a medias ya no vale fuera de tu Fase de Batalla (field.js ya lo anotó al cambiar de fase; por si acaso)
    const w = s.vs.win;
    if (w && w.kind === 'mine-attack' && (!t.mine || t.phase !== 'battle')) dropAttack();
    // Tu atacante dejó el campo (lo moviste a mano…): el ataque se detiene, después de este dibujo (en línea lo ve el rival)
    else if (w && w.kind === 'mine-attack' && w.attack && !arr(s.chain).length && !running && !goneTimer && attackerGone(w) && !pvpOn(s)) {
      const g = gen;
      goneTimer = setTimeout(() => {
        goneTimer = null;
        const s2 = S();
        const w2 = s2 && s2.vs && s2.vs.win;
        if (g === gen && isVs() && w2 === w && !arr(s2.chain).length && !P().busy() && attackerGone(w2)) damageStep();
      }, 0);
    }
    if (ui.mode === 'target' && (s.vs.over || !t.mine || t.phase !== 'battle' || arr(s.chain).length || !attackOk(s, ui.attacker))) ui = freshUi();
    const bar = $('#fd-vs');
    if (bar) {
      const html = V().bar(barModel(s));
      if (html !== lastBar || !bar.innerHTML) { bar.innerHTML = html; lastBar = html; }
      bar.hidden = false;
    }
    // Tus monstruos que pueden atacar ahora
    const free = !s.vs.over && !s.vs.win && !arr(s.chain).length && t.mine && t.phase === 'battle';
    MON.forEach((z) => {
      const el = $('#board [data-zone="' + z + '"]');
      if (!el || el.classList.contains('opp-taken')) return; // su monstruo en la Zona Extra: lo marca vsview
      const x = arr(s.zones[z])[0];
      el.classList.toggle('can-attack', !!(free && x && attackOk(s, x.uid)));
    });
    // Se terminó por LP (un efecto, un ajuste…): el final, después de este dibujo
    if (!s.vs.over && !endTimer && outcome(s)) {
      const g = gen;
      endTimer = setTimeout(() => { endTimer = null; if (g === gen && isVs()) checkEnd(); }, 0);
    }
    schedule();
  }
  function phoneScroll(mine) {
    if (!phone()) return;
    try {
      const el = mine ? $('#board [data-zone="fz"]') : $('#board [data-ozone="deck"]');
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
    } catch (err) { /* nada */ }
  }
  /** Lo que vsview dibuja en el tablero: { targets, direct, attacker, mode, lpFx }. */
  function uiState() {
    const s = S();
    if (s && s.vs && s.opp) lpTrack(s);
    const w = s && s.vs && s.vs.win;
    const rivalAtk = w && w.kind === 'attack' && w.attack ? w.attack.attacker : null;
    return { targets: ui.mode === 'target' ? ui.targets : new Set(), direct: !!(ui.mode === 'target' && ui.direct), attacker: ui.mode === 'target' ? ui.attacker : rivalAtk,
      mode: ui.mode, lpFx: Object.assign({}, lpFx) };
  }
  /** "Atacar" (primero en las acciones de tu monstruo) cuando puede atacar ahora. */
  function actions(uid) {
    if (!isVs()) return [];
    const s = S();
    if (s.vs.over || s.vs.win || arr(s.chain).length || !attackOk(s, uid)) return [];
    return [{ label: 'Atacar', kind: 'primary', fn: () => startAttack(uid) }];
  }
  function positionVerdict(uid) {
    if (!isVs()) return { ok: true };
    const s = S();
    const f = P().find(uid);
    if (f && f.inst && f.inst.attackedTurn != null && Number(f.inst.attackedTurn) === turnOf(s)) return { ok: false, why: CANT_MOVE };
    return { ok: true };
  }

  /* ---------- Nuevo duelo: filas del VS ---------- */
  const seg = (id, key, items, cur) => '<div class="seg" id="' + id + '" role="group">' + items.map(([v, l]) => '<button type="button" data-' + key + '="' + v
    + '" aria-pressed="' + (String(v) === String(cur)) + '">' + l + '</button>').join('') + '</div>';
  /** Lo elegido antes: cfg (lo que pase field.js), las preferencias o lo de este duelo. */
  function setupDefaults(cfg) {
    cfg = cfg && typeof cfg === 'object' ? cfg : {};
    const p = P();
    let pr = {};
    try { pr = p.prefs() || {}; } catch (err) { pr = {}; }
    const s = S();
    const cur = s && s.vs && s.start && s.start.vs ? s.start.vs : null;
    const mine = cfg.deck && typeof cfg.deck === 'object' ? cfg.deck : p.deck();
    const list = arr(p.decks());
    const want = [cfg.rivalId, cfg.rival && typeof cfg.rival === 'object' ? cfg.rival.id : cfg.rival, pr.vsRivalDeckId, cur && cur.rivalId];
    let rival = null;
    for (const id of want) { const dk = deckById(id); if (playable(dk)) { rival = dk; break; } }
    if (!rival) rival = list.find((x) => playable(x) && (!mine || x.id !== mine.id)) || (playable(mine) ? mine : list.find(playable)) || null;
    const pick = (v, ok, dflt) => (ok.includes(v) ? v : dflt);
    return {
      mine, rival,
      first: pick(cfg.firstPref || pr.vsFirst, ['me', 'rival', 'coin'], 'coin'),
      pace: pick(cfg.pace || pr.vsPace, ['normal', 'fast', 'step'], 'normal'),
      askOnly: cfg.askOnly !== undefined ? cfg.askOnly !== false : pr.vsAskOnly !== false,
      responds: cfg.responds !== undefined ? cfg.responds !== false : pr.vsResponds !== false,
      combos: cfg.combos !== undefined ? cfg.combos !== false : pr.vsCombos !== false,
    };
  }
  /** Filas VS de la ventana "Nuevo duelo" (todas con la clase su-vsrow). */
  function setupHtml(cfg) {
    const st = setupDefaults(cfg);
    const list = arr(P().decks());
    const opts = list.map((dk) => {
      const ok = playable(dk);
      return '<option value="' + esc(dk.id) + '"' + (st.rival && dk.id === st.rival.id ? ' selected' : '') + (ok ? '' : ' disabled') + '>'
        + esc(dk.name || 'Mazo') + (ok ? '' : ' (menos de 5 cartas)') + '</option>';
    }).join('');
    const help = V() && typeof V().helpHtml === 'function' ? V().helpHtml() : '';
    return '<div class="field su-vsrow"><span>Tu mazo</span><p class="hint" id="su-mydeck">Tu mazo: <b>' + esc(q(st.mine ? st.mine.name : '—')) + '</b>'
      + ' <span class="su-note">(cámbialo con el selector de mazo del campo)</span></p></div>'
      + '<div class="field su-vsrow"><span>Mazo del rival</span><select id="su-rival" class="deck-select" aria-label="Mazo del rival">' + opts + '</select>'
      + '<p class="hint su-note" id="su-rival-note">' + esc(rivalNote(st.rival)) + '</p></div>'
      + '<div class="field su-vsrow"><span>Empieza</span>' + seg('su-first', 'first', [['me', 'Yo'], ['rival', 'El rival'], ['coin', 'Al azar']], st.first) + '</div>'
      + '<div class="field su-vsrow"><span>Ritmo del rival</span>' + seg('su-pace', 'pace', [['normal', 'Normal'], ['fast', 'Rápido'], ['step', 'Paso a paso']], st.pace)
      + '<p class="hint su-note" id="su-pace-note">' + esc(paceNote(st.pace)) + '</p></div>'
      + '<label class="switch su-vsrow"><input type="checkbox" id="su-askonly"' + (st.askOnly ? ' checked' : '') + '><span>Detenerse solo cuando puedo responder</span></label>'
      + '<label class="switch su-vsrow"><input type="checkbox" id="su-responds"' + (st.responds ? ' checked' : '') + '><span>El rival responde en mi turno (handtraps y cartas colocadas)</span></label>'
      + '<label class="switch su-vsrow"><input type="checkbox" id="su-combos" aria-describedby="su-combos-note"' + (st.combos ? ' checked' : '') + '><span>El rival usa sus combos grabados</span></label>'
      + '<p class="hint su-note su-vsrow" id="su-combos-note">' + esc(combosNote(st.rival, st.combos)) + '</p>'
      + recordHtml(st.rival)
      + '<details class="su-help su-vsrow"><summary>Qué hace el rival (y qué no)</summary>' + help + '</details>';
  }
  function rivalNote(dk) {
    if (!dk) return 'No hay ningún mazo con al menos 5 cartas.';
    const n = arr(dk.main).length;
    const x = arr(dk.extra).length;
    return n >= 40 ? n + ' cartas · Extra ' + x : 'Tiene ' + n + ' cartas: el rival puede quedarse sin cartas.' + (x ? ' · Extra ' + x : '');
  }
  /** Cuántos combos grabados tiene el mazo del rival (los graba "Grabar combo" en Prueba, js/combos.js). */
  function combosNote(dk, use) {
    const C = YGO.combos;
    if (!dk || !C || typeof C.count !== 'function') return '';
    let n = 0, on = 0;
    try { n = C.count(dk.id); on = C.count(dk.id, true); } catch (err) { n = 0; on = 0; }
    if (!n) return 'Este mazo no tiene combos grabados: grábalos en Prueba con «Grabar combo».';
    const has = (n === 1 ? '1 combo grabado' : n + ' combos grabados') + (on < n ? ' (' + on + ' en uso)' : '');
    return use === false ? has + ': este duelo no los usa.' : has + ': cuando su mano pueda empezar uno, lo juega.';
  }
  const paceNote = (pace) => ({ normal: 'Una jugada del rival cada 0,7 s.', fast: 'Una jugada cada 0,25 s.', step: 'Cada jugada del rival espera a que toques «Siguiente».' }[pace] || '');
  function recordText(dk) {
    if (!dk) return '';
    try {
      const st = D().statsVs(null, dk.id);
      return V().recordText(dk.name, st) || '';
    } catch (err) { return ''; }
  }
  const recordHtml = (dk) => { const t = recordText(dk); return '<p class="hint su-vsrow" id="su-record"' + (t ? '' : ' hidden') + '>' + esc(t) + '</p>'; };
  /** Botones y notas de las filas VS (lo elegido queda en el DOM: readSetup lo lee). */
  function bindSetup(root, cfg) {
    root = root || $('#modal-body');
    if (!root) return;
    $$('[data-first]', root).forEach((b) => b.addEventListener('click', () => {
      $$('[data-first]', root).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    }));
    $$('[data-pace]', root).forEach((b) => b.addEventListener('click', () => {
      $$('[data-pace]', root).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      const n = $('#su-pace-note', root);
      if (n) n.textContent = paceNote(b.dataset.pace);
    }));
    const sel = $('#su-rival', root);
    if (sel) sel.addEventListener('change', () => {
      const dk = deckById(sel.value);
      const n = $('#su-rival-note', root);
      if (n) n.textContent = rivalNote(dk);
      const r = $('#su-record', root);
      if (r) { const t = recordText(dk); r.textContent = t; r.hidden = !t; }
      const cn = $('#su-combos-note', root);
      if (cn) cn.textContent = combosNote(dk, comboBox());
    });
    const comboBox = () => { const b = $('#su-combos', root); return !b || b.checked; };
    const cb = $('#su-combos', root);
    if (cb) cb.addEventListener('change', () => {
      const cn = $('#su-combos-note', root);
      if (cn) cn.textContent = combosNote(sel ? deckById(sel.value) : setupDefaults({}).rival, cb.checked);
    });
  }
  /** Lo elegido en las filas VS → cfg para newDuel(…, { vs: cfg }) (y prefs: lo que se guarda). */
  function readSetup(root) {
    root = root || $('#modal-body');
    const pressed = (key, dflt) => { const b = root && $('[data-' + key + '][aria-pressed="true"]', root); return b ? b.dataset[key] : dflt; };
    const sel = root && $('#su-rival', root);
    const st = setupDefaults({});
    let rival = sel ? deckById(sel.value) : st.rival;
    if (!playable(rival)) rival = null;
    const box = (id, dflt) => { const el = root && $('#' + id, root); return el ? !!el.checked : dflt; };
    const cfg = {
      rival, rivalId: rival ? rival.id : null,
      firstPref: pressed('first', st.first), pace: pressed('pace', st.pace),
      askOnly: box('su-askonly', st.askOnly), responds: box('su-responds', st.responds), combos: box('su-combos', st.combos),
    };
    cfg.prefs = { fieldVs: true, vsRivalDeckId: cfg.rivalId, vsFirst: cfg.firstPref, vsPace: cfg.pace, vsAskOnly: cfg.askOnly, vsResponds: cfg.responds, vsCombos: cfg.combos };
    return cfg;
  }

  /* ---------- Pruebas (tools/test_vs.js) ---------- */
  const logFrom = (n) => arr((S() || {}).log).slice(n).map((e) => e && e.text).filter(Boolean);
  const test = {
    /** Juega el rival de una vez (sin ritmo ni temporizadores) hasta una ventana, tu turno o el final. → líneas nuevas del registro */
    runAi(max) {
      max = Number(max) > 0 ? Number(max) : 200;
      const n0 = arr((S() || {}).log).length;
      clearTimer();
      for (let i = 0; i < max; i++) {
        const s = S();
        if (!isVs() || s.vs.over || s.turnState.mine || s.vs.win || arr(s.chain).length || P().busy()) break;
        if (!stepNow()) break;
      }
      if (isVs()) P().render();
      return logFrom(n0);
    },
    /** Un paso: sigue la ventana abierta o hace una jugada del rival. → líneas nuevas */
    step() {
      const n0 = arr((S() || {}).log).length;
      if (!isVs()) return [];
      clearTimer();
      const s = S();
      if (s.vs.win) continueWindow();
      else if (!s.turnState.mine && !arr(s.chain).length && !s.vs.over) { stepNow(); P().render(); }
      return logFrom(n0);
    },
    continue() { const n0 = arr((S() || {}).log).length; if (isVs()) { clearTimer(); continueWindow(); } return logFrom(n0); },
    state() {
      const s = S();
      if (!s || !s.vs) return null;
      return { win: s.vs.win ? JSON.parse(JSON.stringify(s.vs.win)) : null, ui: { mode: ui.mode, attacker: ui.attacker, targets: [...ui.targets], direct: ui.direct },
        pace: s.vs.pace, paused: !!s.vs.paused, over: s.vs.over ? Object.assign({}, s.vs.over) : null, canRespond: s.vs.win ? canRespond(s.vs.win.kind) : false };
    },
    setLp(side, n) {
      if (!isVs()) return null;
      const r = D().setLp(S(), side === 'rival' ? 'rival' : 'me', n);
      if (!checkEnd()) P().render();
      return r;
    },
    attack(attacker, target) { if (!isVs()) return; startAttack(attacker); if (ui.mode === 'target') declareAttack(target || null); },
    damage() { if (isVs()) damageStep(); },
    pause(on) { const s = S(); if (!isVs()) return; s.vs.paused = on !== false; clearTimer(); P().render(); },
  };

  YGO.vs = {
    reset, begin, turnChanged, beforePass, chainClosed, restored, render, ui: uiState, actions, positionVerdict,
    clickRival, barClick, oppClick, canRespond, setupHtml, bindSetup, readSetup, concede, adjustLp,
    // también para field.js / pruebas
    endDuel, checkEnd, showEnd, rematch, startAttack, declareAttack, damageStep, continueWindow, schedule, dropAttack,
    // en línea (js/pvp.js): el ataque que declaró el rival desde su navegador abre la misma ventana que el de la IA
    remoteAttack: (attacker, target) => { const s = S(); if (!isVs() || !pvpOn(s)) return false; const ok = rivalAttack(s, { attacker, target: target || null }); if (ok) P().render(); return ok; },
    clearUi: () => { ui = freshUi(); },
    test,
  };
})();
