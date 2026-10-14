/* Dibujo del modo VS: solo arma texto HTML (no toca el DOM ni el estado). Lo usan field.js (tablero, franja del rival,
 * Zona Extra compartida) y vs.js (barra del VS, listas de su Cementerio y destierro, fin del duelo, ayuda).
 * Lo oculto del rival (su mano, su Mazo, su Extra Deck, sus cartas boca abajo en el campo o desterradas) nunca sale aquí:
 * ni nombre, ni código, ni imagen, ni title/alt; y ningún uid del rival llega al HTML (sus celdas usan data-ozone con
 * la zona de SU asiento: mz0 = su izquierda, que desde tu asiento se ve a la derecha).
 * Expone window.YGO.vsview. */
(function () {
  const YGO = (window.YGO = window.YGO || {});
  const db = YGO.db;
  const T = db.T;
  const V = () => YGO.view;
  const D = () => YGO.duel || null;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const arr = (x) => (Array.isArray(x) ? x : []);
  const q = (name) => '«' + name + '»';

  /* ---------- Zonas (asiento del rival) ---------- */
  const MZ = ['mz0', 'mz1', 'mz2', 'mz3', 'mz4'];
  const EMZ = ['emz0', 'emz1'];
  const ST = ['st0', 'st1', 'st2', 'st3', 'st4'];
  const MON = [...EMZ, ...MZ];
  const FIELD = [...EMZ, ...MZ, ...ST, 'fz'];
  const PILES = ['deck', 'extra', 'gy', 'ban'];
  // Filas A y B del tablero VS (§1.3), de izquierda a derecha desde tu asiento: su fila de atrás y la de sus monstruos
  const ROW_A = ['deck', 'st4', 'st3', 'st2', 'st1', 'st0', 'extra'];
  const ROW_B = ['gy', 'mz4', 'mz3', 'mz2', 'mz1', 'mz0', 'fz'];
  const PILE_NAMES = { deck: 'Mazo', extra: 'Extra Deck', gy: 'Cementerio', ban: 'Desterradas' };
  /** Zona del rival ↔ tu marco (lo mismo que duel.mirror). */
  function mirror(z) {
    const d = D();
    if (d && typeof d.mirror === 'function') return d.mirror(z);
    const m = /^(mz|st)([0-4])$/.exec(String(z));
    if (m) return m[1] + (4 - Number(m[2]));
    return z === 'emz0' ? 'emz1' : z === 'emz1' ? 'emz0' : z;
  }
  /** "Zona de Monstruo 3" | "Zona de M/T 2" | "Zona de Monstruo Extra" | "Zona de Campo" (contadas desde su asiento, desde 1). */
  function zoneName(z) {
    const m = /^(mz|st)([0-4])$/.exec(String(z));
    if (m) return (m[1] === 'mz' ? 'Zona de Monstruo ' : 'Zona de M/T ') + (Number(m[2]) + 1);
    if (EMZ.includes(z)) return 'Zona de Monstruo Extra';
    if (z === 'fz') return 'Zona de Campo';
    return PILE_NAMES[z] || String(z);
  }
  const shortLabel = (z) => (MZ.includes(z) ? 'Monstruo' : ST.includes(z) ? 'M/T' : z === 'fz' ? 'Zona de Campo' : 'Extra');
  const zoneClass = (z) => 'z-' + String(z).replace(/\d/, '');
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
  const cartas = (n) => plural(n, 'carta', 'cartas');
  const turnOf = (S) => Number(S && S.turnState && S.turnState.turn) || 1;
  const lpText = (n) => String(Math.max(0, Math.round(Number(n) || 0)));

  /* ---------- Cartas ---------- */
  const cardOf = (x) => (x && x.id ? db.get(x.id) || null : null);
  const isLinkCard = (c) => !!(c && (c.isLink || c.type & T.LINK));
  /** ¿Se ve? En el campo y en el destierro, si está boca arriba; en el Cementerio, siempre; en el Extra, solo Péndulos boca arriba. */
  function visible(where, x) {
    if (!x) return false;
    const d = D();
    if (d && typeof d.isPublic === 'function') return !!d.isPublic(where, x);
    if (where === 'gy' || where === 'mat') return true;
    if (where === 'extra') return !!x.extraFaceUp;
    if (where === 'hand' || where === 'deck') return false;
    return !x.faceDown;
  }
  /** Sus cartas en el campo por zona (la primera que ocupa la zona, como duel.zonesOf). */
  function fieldOf(S) {
    const out = {};
    for (const e of arr(S && S.opp && S.opp.field)) if (e && FIELD.includes(e.zone) && !out[e.zone]) out[e.zone] = e;
    return out;
  }
  /** Carta boca abajo (o desterrada boca abajo): solo el dorso, sin nombre, código, imagen ni title. */
  const hiddenTile = (def) => '<div class="slot-card' + (def ? ' is-def' : '') + '"><div class="card back"></div></div>';
  /** Ficha (Token): no está en la base; se dibuja con sus datos (siempre está boca arriba). */
  function tokenTile(x) {
    const t = x.token || {};
    const base = cardOf(x) || {};
    const name = t.name || base.name || 'Ficha';
    const lv = Number(t.level) || base.lv || 1;
    const atk = Number(t.atk) >= 0 ? Number(t.atk) : 0, def = Number(t.def) >= 0 ? Number(t.def) : 0;
    return '<div class="card f-token" title="' + esc(name) + '"><div class="face"><span class="nm">' + esc(name) + '</span><span class="lv">★' + lv
      + '</span><span class="st">' + atk + '/' + def + '</span></div></div>';
  }
  /** ATK cambiado este turno (atkSet), o null. */
  function atkNow(S, x) {
    if (!x || x.faceDown || !x.atkSet || Number(x.atkSet.turn) !== turnOf(S)) return null;
    const n = Number(x.atkSet.atk);
    return n >= 0 ? n : 0;
  }
  /** Miniatura pública de una carta boca arriba (YGO.view.tile, sin uid). */
  function faceTile(S, x, opts) {
    const c = cardOf(x);
    const atk = atkNow(S, x);
    const html = x.token ? tokenTile(x) : c ? V().tile(c, atk != null ? { atk } : {}) : '<div class="card"></div>';
    const def = !!(opts && opts.def);
    return '<div class="slot-card' + (def ? ' is-def' : '') + '">' + html + '</div>';
  }
  const nameOf = (x) => (x && x.token && x.token.name) || (cardOf(x) || {}).name || 'Carta';
  const isMonsterHere = (e) => !!(e && MON.includes(e.zone) && !e.asSpell);
  /** CL1, CL2…: eslabones de la cadena de esta carta (la activación es pública). */
  function chainTag(S, x) {
    return arr(S && S.chain).map((l, i) => (l && x && l.uid === x.uid ? 'CL' + (i + 1) : '')).filter(Boolean).join(' ');
  }
  /** Marcas de una carta boca arriba del rival: materiales, Nivel, Negado, ATK de ahora, "Tuya". */
  function badges(S, e) {
    if (!e || e.faceDown) return '';
    let out = '';
    const mats = arr(e.mats).length;
    if (mats) out += '<span class="mats" title="Materiales">' + mats + '</span>';
    if (typeof e.level === 'number') out += '<span class="lv-badge" title="Nivel cambiado por un efecto">Nv ' + e.level + '</span>';
    if (e.negated && Number(e.negated.turn) === turnOf(S)) out += '<span class="neg-badge" title="Efectos negados este turno">Negado</span>';
    if (e.owner === 'player') out += '<span class="own-badge mine" title="Es tu carta: vuelve a ti cuando deja el campo">Tuya</span>';
    const atk = atkNow(S, e);
    if (atk != null) out += '<span class="atk-badge" title="ATK cambiado este turno">ATK ' + atk + '</span>';
    return out;
  }
  /** Lo que dice aria-label de una carta del campo del rival. */
  function describe(S, e) {
    if (!e) return 'vacía';
    if (e.faceDown) return 'carta boca abajo' + (e.def ? ' en DEF' : '');
    let s = q(nameOf(e));
    const c = cardOf(e);
    if (isMonsterHere(e)) s += isLinkCard(c) || !e.def ? ' en ATK' : ' en DEF';
    const mats = arr(e.mats).length;
    if (mats) s += ' · ' + plural(mats, 'material', 'materiales');
    if (e.negated && Number(e.negated.turn) === turnOf(S)) s += ' · negado';
    const atk = atkNow(S, e);
    if (atk != null) s += ' · ATK ' + atk;
    return s;
  }
  const hasIn = (set, k) => !!(set && k != null && (typeof set.has === 'function' ? set.has(k) : Array.isArray(set) && set.includes(k)));
  /** ¿Es objetivo de tu ataque? ui.targets: zonas del rival (Set o lista). */
  const isTarget = (ui, zone, e) => !!(ui && (hasIn(ui.targets, zone) || (e && hasIn(ui.targets, e.uid))));
  /** ¿Es el monstruo del rival que está atacando? ui.attacker: su uid (o su zona). */
  const isAttacker = (ui, zone, e) => !!(ui && ui.attacker != null && e && (ui.attacker === e.uid || ui.attacker === zone));

  /* ---------- Celdas del tablero ---------- */
  function zoneCell(S, z, ui) {
    const e = fieldOf(S)[z] || null;
    const cls = ['zone-slot', 'oz', zoneClass(z)];
    if (isTarget(ui, z, e)) cls.push('target');
    if (isAttacker(ui, z, e)) cls.push('can-attack');
    let inner;
    if (!e) inner = '<span class="zl">' + shortLabel(z) + '</span>';
    else if (e.faceDown) inner = hiddenTile(!!e.def);
    else inner = faceTile(S, e, { def: isMonsterHere(e) && !!e.def && !isLinkCard(cardOf(e)) }) + badges(S, e);
    const cl = e ? chainTag(S, e) : '';
    return '<div class="' + cls.join(' ') + '" data-ozone="' + z + '" tabindex="0" aria-label="' + esc('Rival · ' + zoneName(z) + ': ' + describe(S, e)) + '">'
      + inner + (cl ? '<span class="cl-badge">' + cl + '</span>' : '') + '</div>';
  }
  function pileCell(S, p, ui) {
    const o = (S && S.opp) || {};
    const list = arr(o[p]);
    const n = list.length;
    let top = '';
    let up = 0;
    let aria = 'Rival · ' + PILE_NAMES[p] + ': ' + cartas(n);
    if (p === 'deck') top = n ? hiddenTile(false) : '';
    else if (p === 'extra') {
      // Péndulos boca arriba en su Extra Deck: se ven (el último que llegó, encima); lo demás, el dorso
      const faceUp = list.filter((x) => x && x.extraFaceUp);
      up = faceUp.length;
      top = up ? faceTile(S, faceUp[up - 1]) : n ? hiddenTile(false) : '';
      if (up) aria += ', ' + up + ' boca arriba';
    } else if (n) {
      const x = list[n - 1];
      if (visible(p, x)) { top = faceTile(S, x); aria += ', arriba ' + q(nameOf(x)); } else top = hiddenTile(false);
    }
    return '<div class="zone-slot pile oz ' + zoneClass(p) + (hasIn(ui && ui.targets, p) ? ' target' : '') + '" data-ozone="' + p + '" tabindex="0" aria-label="' + esc(aria) + '">'
      + top + (up ? '<span class="pile-up" title="Péndulo boca arriba en su Extra Deck">' + up + ' ▲</span>' : '')
      + '<span class="pile-count"><span class="pile-name">' + PILE_NAMES[p] + ' · </span>' + n + '</span></div>';
  }
  /** Una celda del rival: una zona de su asiento (mz0…, st0…, fz, emz0/emz1) o una pila (deck, extra, gy, ban). */
  function cell(S, key, ui) {
    if (PILES.includes(key)) return pileCell(S, key, ui);
    if (FIELD.includes(key)) return zoneCell(S, key, ui);
    return '';
  }
  /** Filas A y B del tablero VS: 14 celdas [data-ozone] en el orden de §1.3. */
  function rows(S, ui) {
    return ROW_A.map((k) => cell(S, k, ui)).join('') + ROW_B.map((k) => cell(S, k, ui)).join('');
  }
  /** Zona Extra compartida (fila C) que ocupa un monstruo del rival. playerZone: emz0|emz1 en TU marco (data-zone);
   * el rival la tiene como mirror(playerZone). Sin uid: al tocarla, field.js pasa mirror(zona) a vs.clickRival. */
  function emzCell(S, playerZone, ui) {
    const pz = playerZone === 'emz1' ? 'emz1' : 'emz0';
    const rz = mirror(pz);
    const e = fieldOf(S)[rz] || null;
    const label = 'Zona de Monstruo Extra ' + (pz === 'emz0' ? 'izquierda' : 'derecha');
    const cls = ['zone-slot', 'z-emz', 'opp-taken'];
    if (isTarget(ui, rz, e)) cls.push('target');
    if (isAttacker(ui, rz, e)) cls.push('can-attack');
    let inner;
    let who;
    if (!e) { inner = '<span class="zl">Rival</span>'; who = 'el rival'; }
    else if (e.faceDown) { inner = hiddenTile(!!e.def); who = 'un monstruo boca abajo del rival'; }
    else {
      inner = faceTile(S, e, { def: !!e.def && !isLinkCard(cardOf(e)) }) + badges(S, e);
      who = describe(S, e).replace(/^(«[^»]*»)/, '$1 del rival');
    }
    const cl = e ? chainTag(S, e) : '';
    return '<div class="' + cls.join(' ') + '" data-zone="' + pz + '" tabindex="0" aria-label="' + esc(label + ': la ocupa ' + who) + '">'
      + inner + (e ? '<span class="own-badge">Rival</span>' : '') + (cl ? '<span class="cl-badge">' + cl + '</span>' : '') + '</div>';
  }

  /* ---------- Franja del rival (#fd-opp en VS) ---------- */
  const fx = (ui, side) => {
    const v = ui && ui.lpFx && ui.lpFx[side];
    return v === 'hit' ? ' vs-hit' : v === 'gain' ? ' vs-gain' : '';
  };
  /** RIVAL · «Mazo» · [LP 8000] · Mano ▮▮▮▮▮ 5 · Mazo 30 · Extra 15 · [Cambiar…] (sin "Ver mano" ni Intentos). */
  function strip(S, ui) {
    const o = (S && S.opp) || {};
    const name = String(o.name || (S && S.vs && S.vs.rival && S.vs.rival.name) || 'Rival');
    const hand = arr(o.hand).length;
    const deck = arr(o.deck).length;
    const extra = arr(o.extra).length;
    const lp = lpText(o.lp);
    const shown = Math.min(hand, 8);
    const backs = '<span class="opp-backs" aria-hidden="true">' + '<i></i>'.repeat(shown) + '</span>'
      + (hand > shown ? '<span class="opp-more" aria-hidden="true">+' + (hand - shown) + '</span>' : '');
    // Sin zona: las que no tienen una válida y las que comparten zona con otra (no se dibujan en el tablero)
    const drawn = new Set(Object.values(fieldOf(S)));
    const loose = arr(o.field).filter((e) => e && !drawn.has(e)).length;
    // En línea: el rival es una persona (su nombre, no el de su mazo); "Sala…" en vez de cambiar su mazo
    const pvp = !!(S && S.vs && S.vs.pvp);
    return '<span class="opp-tag">' + (pvp ? 'En línea' : 'Rival') + '</span><span class="vs-deckname" title="' + esc(pvp ? 'Rival en línea: ' + name : 'Mazo del rival: ' + name) + '">' + esc(q(name)) + '</span>'
      + '<button type="button" class="vs-lp' + fx(ui, 'rival') + '" data-vsopp="lp" aria-label="LP del rival: ' + lp + (pvp ? ' (toca para hacerle daño o subirlos a mano)' : ' (toca para ajustarlos)') + '" title="' + (pvp ? 'Cambiar los LP del rival (a mano, se le avisa)' : 'Ajustar LP del rival') + '">LP ' + lp + '</button>'
      + '<span class="opp-group opp-hand" aria-label="Mano del rival: ' + cartas(hand) + '"><span class="opp-label">Mano</span>' + backs + '<b class="opp-n">' + hand + '</b></span>'
      + '<span class="vs-count" aria-label="Mazo del rival: ' + cartas(deck) + '"><span class="opp-label">Mazo</span><b>' + deck + '</b></span>'
      + '<span class="vs-count" aria-label="Extra Deck del rival: ' + cartas(extra) + '"><span class="opp-label">Extra</span><b>' + extra + '</b></span>'
      + (loose ? '<span class="opp-lock vs-nozone" title="No le quedó zona libre: búscala en el registro">' + cartas(loose) + ' sin zona</span>' : '')
      + (pvp ? '<button type="button" class="opp-btn" data-vsopp="setup" title="La sala en línea: código, revancha, salir">Sala…</button>'
        : '<button type="button" class="opp-btn" data-vsopp="setup" title="Elegir otro mazo para el rival (Nuevo duelo)">Cambiar…</button>');
  }
  /** "LP 8000" para #vs-mylp. */
  const myLp = (S) => 'LP ' + lpText(S && S.lp);

  /* ---------- Barra del VS (#fd-vs) ---------- */
  const TONES = ['rival', 'mine', 'battle', 'end'];
  const cssWord = (s) => String(s || '').replace(/[^a-z0-9 _-]/gi, '').trim();
  /** model = { tone: 'rival'|'mine'|'battle'|'end', text, sub?, buttons: [{ id, label, kind, disabled, title?, act? }], paused } */
  function bar(model) {
    model = model || {};
    const tone = TONES.includes(model.tone) ? model.tone : 'mine';
    const btns = arr(model.buttons).filter((b) => b && b.label != null).map((b) => '<button type="button"'
      + (b.id ? ' id="' + esc(b.id) + '"' : '') + (cssWord(b.kind) ? ' class="' + cssWord(b.kind) + '"' : '')
      + (b.act ? ' data-act="' + esc(b.act) + '"' : '') + (b.title ? ' title="' + esc(b.title) + '"' : '') + (b.disabled ? ' disabled' : '') + '>'
      + esc(b.label) + '</button>').join('');
    return '<div class="vs-in ' + tone + (model.paused ? ' paused' : '') + '">'
      + (model.paused ? '<span class="vs-tag">En pausa</span>' : '')
      + '<p id="vs-msg">' + esc(model.text || '') + '</p>'
      + (btns ? '<div class="vs-btns">' + btns + '</div>' : '')
      + (model.sub ? '<p class="vs-sub">' + esc(model.sub) + '</p>' : '') + '</div>';
  }

  /* ---------- Su Cementerio, su destierro (y su Extra Deck boca arriba) ---------- */
  /** Lista pública para una ventana: la más reciente primero; data-ri = índice en su pila. Desterradas boca abajo: el dorso. */
  function pileList(S, pile) {
    const o = (S && S.opp) || {};
    const p = ['gy', 'ban', 'extra'].includes(pile) ? pile : 'gy';
    const list = arr(o[p]);
    const items = list.map((x, i) => ({ x, i })).filter((it) => it.x && (p !== 'extra' || it.x.extraFaceUp)).reverse();
    const where = { gy: 'su Cementerio', ban: 'el destierro', extra: 'su Extra Deck (boca arriba)' }[p];
    if (!items.length) return '<p class="hint">No hay cartas en ' + where + '.</p>' + (p === 'extra' && list.length ? '<p class="hint">' + cartas(list.length) + ' boca abajo.</p>' : '');
    const down = items.filter((it) => !visible(p, it.x)).length;
    const tiles = items.map(({ x, i }) => (visible(p, x)
      ? '<div class="slot-card" data-ri="' + i + '" tabindex="0" role="button" aria-label="' + esc(q(nameOf(x))) + '">' + (x.token ? tokenTile(x) : cardOf(x) ? V().tile(cardOf(x)) : '<div class="card"></div>') + '</div>'
      : '<div class="slot-card" data-ri="' + i + '" tabindex="0" role="button" aria-label="Carta desterrada boca abajo"><div class="card back"></div></div>')).join('');
    const hint = p === 'extra'
      ? cartas(items.length) + ' boca arriba' + (list.length > items.length ? ' · ' + (list.length - items.length) + ' boca abajo (no se ven)' : '') + '.'
      : 'Toca una carta para ver qué puedes hacer con ella.' + (down ? ' ' + plural(down, 'carta boca abajo', 'cartas boca abajo') + ': no se ve' + (down === 1 ? '' : 'n') + '.' : '');
    return '<p class="hint">' + hint + '</p><div class="pile-grid vs-pile">' + tiles + '</div>';
  }

  /* ---------- Fin del duelo ---------- */
  /** "Contra «Mazo»: 3 ganadas · 2 perdidas" (· N empates), o '' si no hay partidas. */
  function recordText(name, stats) {
    const s = stats || {};
    const won = Number(s.won) || 0, lost = Number(s.lost) || 0, draw = Number(s.draw) || 0;
    if (!won && !lost && !draw) return '';
    const parts = [plural(won, 'ganada', 'ganadas'), plural(lost, 'perdida', 'perdidas')];
    if (draw) parts.push(plural(draw, 'empate', 'empates'));
    return 'Contra ' + q(name || 'Rival') + ': ' + parts.join(' · ');
  }
  const WHY = {
    lp: { me: 'Los LP del rival llegaron a 0.', rival: 'Tus LP llegaron a 0.', draw: 'Los LP de los dos llegaron a 0 a la vez.' },
    deckout: { me: 'El rival no pudo robar: su Mazo está vacío.', rival: 'No pudiste robar: tu Mazo está vacío.', draw: 'Nadie pudo robar.' },
    concede: { me: 'El rival se rindió.', rival: 'Te rendiste.', draw: 'Empate.' },
    left: { me: 'El rival salió de la sala.', rival: 'Saliste de la sala.', draw: 'Empate.' },
    nostart: { me: 'El duelo no empezó.', rival: 'El duelo no empezó.', draw: 'El rival no pudo empezar el duelo.' },
  };
  /** Cuerpo de la ventana del final (el título ¡Ganaste! / Perdiste / Empate lo pone vs.js). */
  function endBody(over, stats, S) {
    over = over || {};
    const w = ['me', 'rival', 'draw'].includes(over.winner) ? over.winner : 'draw';
    const why = (WHY[over.why] || WHY.lp)[w];
    const turn = Number(over.turn) || turnOf(S);
    const o = (S && S.opp) || {};
    const name = o.name || (S && S.vs && S.vs.rival && S.vs.rival.name) || 'Rival';
    const rec = recordText(name, stats);
    const cls = w === 'me' ? 'win' : w === 'rival' ? 'lose' : 'draw';
    return '<div class="vs-end ' + cls + '"><p class="vs-end-why">' + esc(why) + '</p>'
      + '<p class="vs-end-score">Turno ' + turn + ' · Tus LP ' + lpText(S && S.lp) + ' · LP del rival ' + lpText(o.lp) + '</p>'
      + (rec ? '<p class="vs-end-rec">' + esc(rec) + '</p>' : '') + '</div>';
  }

  /* ---------- Qué hace el rival (y qué no) ---------- */
  const HELP = [
    'Juega su turno solo: roba, invoca (Normal, por Sacrificio, colocando, Enlace, Sincronía y Xyz), activa los efectos que el simulador entiende del todo, coloca cartas, ataca cuando le conviene y descarta al final.',
    'En tu turno responde con las handtraps que tiene de verdad en la mano y con algunas Trampas colocadas conocidas (Mirror Force, Trap Hole, Solemn…).',
    'Todavía no: Invocaciones por Fusión, Ritual o Péndulo; encadenar a tus respuestas; efectos con condiciones que no entiende (esos no los usa); cambios de ATK, protecciones y daño de penetración.',
    'Nunca ve tu mano ni tus cartas boca abajo, y tú tampoco las suyas.',
    'Si algo queda a medias, pulsa Pausar y hazlo a mano: toca una carta del rival para destruirla, desterrarla, devolverla… o ajusta los LP tocándolos.',
  ];
  const helpHtml = () => '<ul class="su-help-list">' + HELP.map((t) => '<li>' + esc(t) + '</li>').join('') + '</ul>';

  YGO.vsview = {
    rows, cell, emzCell, hiddenTile, strip, myLp, bar, pileList, endBody, helpHtml, recordText,
    ROW_A, ROW_B, zoneName,
  };
})();
