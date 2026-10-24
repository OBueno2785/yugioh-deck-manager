/* Motor del modo VS (duelo completo contra la computadora). Lógica pura, sin DOM: nunca llama a field.js.
 * El rival vive en S.opp con la forma de YGO.bot.newOpponent (así bot.js sigue funcionando) más lo del VS: su Extra Deck,
 * sus LP, su propio turnState (S.opp.ts) y el estado de la IA (S.opp.ai). Todo está en S, así deshacer lo incluye.
 * Sus zonas se nombran desde SU asiento (mz0 = su izquierda); mirror() las pasa a tu marco y al revés.
 * Las reglas (YGO.rules) revisan sus jugadas con una vista del rival (rivalView): sus pilas, sus zonas y su turnState.
 * Lo oculto (su mano, su Mazo, su Extra Deck, sus cartas boca abajo) nunca se nombra: los textos salen de rivalName/moveText.
 * Las funciones que producen texto para el registro lo devuelven; quien llama lo anota.
 * Expone window.YGO.duel. */
(function () {
  const YGO = (window.YGO = window.YGO || {});
  const db = YGO.db;
  const T = db.T;
  const R = () => YGO.rules || null;
  const B = () => YGO.bot || null;

  /* ---------- Constantes ---------- */
  const MZ = ['mz0', 'mz1', 'mz2', 'mz3', 'mz4'];
  const EMZ = ['emz0', 'emz1'];
  const MON = [...EMZ, ...MZ];
  const ST = ['st0', 'st1', 'st2', 'st3', 'st4'];
  const FIELD = [...EMZ, ...MZ, ...ST, 'fz'];
  const PILES = ['hand', 'deck', 'extra', 'gy', 'ban'];
  const LP0 = 8000;
  const REC_KEY = 'simulador-yugioh:vs';
  const REC_MAX = 200;
  // Cómo deja el campo (o su pila) → a dónde va
  const DEST = { destroy: 'gy', battle: 'gy', gy: 'gy', send: 'gy', tribute: 'gy', material: 'gy', cost: 'gy', discard: 'gy', banish: 'ban', banishFD: 'ban', hand: 'hand', deck: 'deck' };
  const PILE_WORD = { hand: 'mano', deck: 'Mazo', extra: 'Extra Deck', gy: 'Cementerio', ban: 'destierro' };
  const FROM_TXT = { hand: 'desde su mano', deck: 'desde su Mazo', gy: 'desde su Cementerio', ban: 'desde el destierro', extra: 'desde su Extra Deck' };
  // Batalla: la única protección que se aplica sola, y los textos de combate que solo se avisan
  const NO_BATTLE_DESTROY = /(?:^|\.\s|\n)This card cannot be destroyed by battle\./;
  const NO_BATTLE_DESTROY_G = /(?:^|\.\s|\n)This card cannot be destroyed by battle\./g;
  const COMBAT_TEXT = /piercing|battle damage|ATK becomes|DEF becomes|(?:gains?|loses?) \d+ (?:ATK|DEF)|cannot attack|cannot be targeted for attacks|cannot be destroyed by battle/i;
  const CANNOT_ATTACK = /(?:^|[.\n]\s*)(?:This card|This monster) cannot (?:declare an )?attack\./i;

  const q = (name) => '«' + name + '»';
  const arr = (x) => (Array.isArray(x) ? x : []);
  const turnOf = (S) => Number(S && S.turnState && S.turnState.turn) || 1;
  /** "(por X)": un nombre suelto va entre «»; un texto que ya los trae ("«X»") o una frase ("un efecto tuyo") va tal cual. */
  const byText = (by) => { const s = String(by || ''); return /«|^(?:un|una|el|la|los|las|tu|tus|su|sus)\s/i.test(s) ? s : q(s); };
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

  /* ---------- Zonas ---------- */
  /** Zona del rival (su asiento) ↔ tu marco: mzN ↔ mz(4-N), stN ↔ st(4-N), emz0 ↔ emz1, fz ↔ fz. */
  function mirror(z) {
    const m = /^(mz|st)([0-4])$/.exec(String(z));
    if (m) return m[1] + (4 - Number(m[2]));
    if (z === 'emz0') return 'emz1';
    if (z === 'emz1') return 'emz0';
    return z;
  }
  /** "su Zona de Monstruo 3" | "su Zona de M/T 2" | "su Zona Extra" | "su Zona de Campo" (contadas desde su asiento, desde 1). */
  function zoneLabel(z) {
    const m = /^(mz|st)([0-4])$/.exec(String(z));
    if (m) return 'su ' + (m[1] === 'mz' ? 'Zona de Monstruo ' : 'Zona de M/T ') + (Number(m[2]) + 1);
    if (EMZ.includes(z)) return 'su Zona Extra';
    if (z === 'fz') return 'su Zona de Campo';
    return 'su campo';
  }
  const isVs = (S) => !!(S && S.vs && S.opp && S.opp.vs);
  /** Duelo en línea (js/pvp.js): el rival es otra persona y S.opp es el espejo de lo público de su lado. */
  const isPvp = (S) => !!(isVs(S) && S.vs.pvp && S.opp.pvp);
  /** En línea, lo que un efecto tuyo le hace a una carta del rival se cambia aquí (para verlo ya) y además va como pedido a
   * su dueño, que lo aplica de verdad (YGO.pvp.out). */
  function out(S, op) {
    if (!isPvp(S)) return;
    const P = YGO.pvp;
    if (P && typeof P.out === 'function') { try { P.out(S, op); } catch (e) { console.warn('YGO.pvp.out falló', e); } }
  }

  /* ---------- Azar con semilla (el estado vive en S.opp.rng) ---------- */
  function mulberry(o) {
    let t = (o.rng = ((Number(o.rng) | 0) + 0x6D2B79F5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const randOpp = (o) => { const b = B(); return b && typeof b.rand === 'function' ? b.rand(o) : mulberry(o); };
  /** Número al azar [0, 1) con la semilla del rival (nunca Math.random). */
  const rand = (S) => randOpp(S.opp);
  function shuffleOpp(o, list) {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(randOpp(o) * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  }
  const shuffle = (S, list) => shuffleOpp(S.opp, list);

  /* ---------- Cartas ---------- */
  const cardOf = (x) => (x && x.id ? db.get(x.id) || null : null);
  const nameOf = (x) => (x && x.token && x.token.name) || (cardOf(x) || {}).name || '?';
  const isMonsterCard = (x) => { const c = cardOf(x); return !!(c && db.isMonster(c)); };
  const isToken = (x) => !!(x && (x.token || ((cardOf(x) || { type: 0 }).type & T.TOKEN)));
  /** Monstruo en el campo del rival (lo mismo que mira bot.js: no en la cadena, no puesto como Mágica, no en M/T ni en la Zona de Campo). */
  const isMonsterEntry = (e) => !!(e && !e.onChain && !e.asSpell && e.zone !== 'fz' && e.zone !== 'st' && !ST.includes(e.zone) && (e.monster || isMonsterCard(e)));
  const negatedNow = (S, x) => !!(x && x.negated && Number(x.negated.turn) === turnOf(S));
  const levelOf = (x) => { const c = cardOf(x); return x && x.token ? Number(x.token.level) || 0 : x && typeof x.level === 'number' ? x.level : c ? c.lv : 0; };
  const topMine = (S, z) => (S && S.zones && Array.isArray(S.zones[z]) ? S.zones[z][0] : null) || null;
  /** Tu carta en el campo: { zone, index, inst } (o en otra parte, con area). */
  function locMine(S, uid) {
    const RS = R();
    if (RS && RS.locate) return RS.locate(S, uid);
    for (const z of FIELD) { const i = arr(S.zones && S.zones[z]).findIndex((x) => x && x.uid === uid); if (i >= 0) return { area: i ? 'material' : 'field', zone: z, index: i, inst: S.zones[z][i] }; }
    return null;
  }
  /** Copia limpia para una pila: olvida todo lo del campo. Al Cementerio/destierro recuerda cómo se invocó (para revivirlo). */
  function cleanInst(x, keepProper) {
    const out = { uid: x.uid, id: x.id, faceDown: false, def: false };
    if (keepProper) {
      if (x.summonMethod && (!x.properSummon || x.properSummon === 'special')) out.properSummon = x.summonMethod;
      else if (x.properSummon) out.properSummon = x.properSummon;
    }
    return out;
  }

  /* ---------- Buscar cartas del rival ---------- */
  /** → { entry|inst, where: 'field'|'mat'|'hand'|'deck'|'extra'|'gy'|'ban', zone?, list, index } | null */
  function findRival(S, uid) {
    const o = S && S.opp;
    if (!o || !uid) return null;
    const f = arr(o.field);
    for (let i = 0; i < f.length; i++) {
      const e = f[i];
      if (!e) continue;
      if (e.uid === uid) return { entry: e, inst: e, where: 'field', zone: e.zone || null, list: f, index: i };
      const mats = arr(e.mats);
      const j = mats.findIndex((m) => m && m.uid === uid);
      if (j >= 0) return { entry: e, inst: mats[j], where: 'mat', zone: e.zone || null, list: e.mats, index: j };
    }
    for (const p of PILES) {
      const list = o[p];
      if (!Array.isArray(list)) continue;
      const i = list.findIndex((x) => x && x.uid === uid);
      if (i >= 0) return { inst: list[i], where: p, list, index: i };
    }
    return null;
  }
  const entryAt = (S, zone) => arr(S && S.opp && S.opp.field).find((e) => e && e.zone === zone) || null;
  /** Sus monstruos en el campo ({ faceUp: true }: solo boca arriba). */
  const monsters = (S, opts) => arr(S && S.opp && S.opp.field).filter((e) => isMonsterEntry(e) && !(opts && opts.faceUp && e.faceDown));
  /** Sus cartas en el campo que no son monstruos (Mágicas/Trampas, Zona de Campo, en la cadena). */
  const spellTraps = (S) => arr(S && S.opp && S.opp.field).filter((e) => e && !isMonsterEntry(e));
  /** ¿Tu monstruo ocupa la Zona Extra que en su asiento es z? */
  const emzMine = (S, z) => !!topMine(S, mirror(z));
  /** Primera zona libre suya: kind 'mz' (Zonas de Monstruo principales) | 'st' | 'emz' | 'fz'; prefer si está libre. */
  function freeZone(S, kind, prefer) {
    const list = kind === 'st' ? ST : kind === 'emz' ? EMZ : kind === 'fz' ? ['fz'] : MZ;
    const taken = new Set(arr(S && S.opp && S.opp.field).map((e) => e && e.zone).filter(Boolean));
    const ok = (z) => list.includes(z) && !taken.has(z) && !(EMZ.includes(z) && emzMine(S, z));
    if (prefer && ok(prefer)) return prefer;
    return list.find(ok) || null;
  }

  /* ---------- Vista del rival para las reglas ---------- */
  /** S.opp.ts al día: contadores del turno, turno/fase/mine desde S.turnState y los bloqueos compartidos. */
  function tsOf(S) {
    const o = S.opp;
    const RS = R();
    const base = RS ? RS.newTurnState() : { turn: 1, mine: true, phase: 'main1', normalSummons: 0, opt: {}, pendulumSummons: 0, duel: {}, locks: [], specials: [], acts: [] };
    if (!o.ts || typeof o.ts !== 'object') o.ts = base;
    const ts = o.ts;
    for (const k of Object.keys(base)) if (ts[k] === undefined || ts[k] === null) ts[k] = base[k];
    const m = S.turnState || {};
    const turn = Number(m.turn) || 1;
    if (ts.turn !== turn) {
      // Turno nuevo: como rules.passTurn (los bloqueos con sourceUid o con until siguen; duel no se toca)
      ts.normalSummons = 0;
      ts.pendulumSummons = 0;
      ts.opt = {};
      ts.specials = [];
      ts.acts = [];
      ts.locks = arr(ts.locks).filter((l) => l && l.kind && (l.sourceUid || (l.until != null && Number(l.until) >= turn)));
    }
    ts.turn = turn;
    ts.phase = m.phase || 'main1';
    ts.mine = m.mine === false;
    // Compartidos: "nadie puede desterrar" (Artifact Lancea) y tus monstruos en las Zonas Extra
    ts.locks = arr(ts.locks).filter((l) => l && !l.vsShared);
    for (const l of arr(m.locks)) if (l && l.kind === 'noBanish' && !l.vsShared && !l.vsEmz) ts.locks.push(Object.assign({}, l, { vsShared: true }));
    for (const z of EMZ) if (topMine(S, z)) ts.locks.push({ kind: 'emzTaken', zone: mirror(z), source: 'tu monstruo', vsShared: true });
    return ts;
  }
  /** Sus zonas como las de S: { zona: [entrada, ...materiales] } (las 13). */
  function zonesOf(S) {
    const zones = {};
    FIELD.forEach((z) => { zones[z] = []; });
    for (const e of arr(S && S.opp && S.opp.field)) if (e && zones[e.zone] && !zones[e.zone].length) zones[e.zone] = [e, ...arr(e.mats)];
    return zones;
  }
  /** S visto desde el asiento del rival (las pilas son las suyas, por referencia; turnState ES S.opp.ts). */
  function rivalView(S) {
    const o = S.opp;
    return { hand: o.hand, deck: o.deck, extra: arr(o.extra), gy: o.gy, ban: o.ban, zones: zonesOf(S), chain: Array.isArray(S.chain) ? S.chain : [], lp: o.lp, turnState: tsOf(S), opp: null };
  }
  const withRival = (S, fn) => fn(rivalView(S));

  /* ---------- Sincronizar ---------- */
  /** Idempotente: zonas para las entradas que no tienen (bot.js las crea sin zona) y bloqueos de tus Zonas Extra ocupadas por él. */
  function sync(S) {
    const o = S && S.opp;
    if (!o || !o.vs) return S;
    if (!Array.isArray(o.field)) o.field = [];
    if (!Array.isArray(o.extra)) o.extra = [];
    const used = new Set();
    const bad = [];
    for (const e of o.field) {
      if (!e) continue;
      const z = e.zone;
      const c = cardOf(e);
      // (En línea, una Mágica de Campo boca abajo del rival llega sin código: se queda en su Zona de Campo)
      const fits = FIELD.includes(z) && !used.has(z) && (z !== 'fz' || !!(c && c.type & T.FIELD) || (!c && !!e.faceDown && !!o.pvp));
      if (!fits) { bad.push(e); continue; }
      used.add(z);
      // Un monstruo en una Zona de M/T (puesto como Mágica): asSpell mantiene bien isMonsterEntry de bot.js
      if (ST.includes(z) && c && db.isMonster(c) && !e.asSpell) e.asSpell = true;
    }
    for (const e of bad) {
      const c = cardOf(e);
      const free = (list) => list.find((z) => !used.has(z)) || null;
      let z;
      if (e.onChain || e.asSpell || !c || !db.isMonster(c)) z = c && c.type & T.FIELD && !used.has('fz') ? 'fz' : free(ST);
      else z = free(MZ);
      e.zone = z; // null: no quedó zona libre (la vista lo muestra aparte)
      if (z) used.add(z);
      if (z && ST.includes(z) && c && db.isMonster(c)) e.asSpell = true;
    }
    // Sus monstruos en una Zona Extra: esa zona (en tu marco) no es tuya mientras sigan ahí
    if (S.turnState && typeof S.turnState === 'object') {
      const t = S.turnState;
      t.locks = arr(t.locks).filter((l) => l && !l.vsEmz);
      for (const e of o.field) {
        if (!e || !EMZ.includes(e.zone)) continue;
        const mine = mirror(e.zone);
        const side = mine === 'emz0' ? 'izquierda' : 'derecha';
        const up = !e.faceDown;
        t.locks.push({
          kind: 'emzTaken', zone: mine, source: up ? nameOf(e) : 'un monstruo del rival', sourceUid: e.uid, vsEmz: true,
          text: up ? 'Por ' + q(nameOf(e)) + ' del rival, tu Zona de Monstruo Extra ' + side + ' está ocupada.' : 'Un monstruo del rival ocupa tu Zona de Monstruo Extra ' + side + '.',
        });
      }
    }
    return S;
  }

  /* ---------- Lo público ---------- */
  /** ¿Se ve esta carta? where: 'gy' | 'mat' (sí), 'field' | 'ban' (si está boca arriba), 'extra' (si está boca arriba), 'hand' | 'deck' (no). */
  function isPublic(where, x) {
    if (FIELD.includes(where)) where = 'field';
    switch (where) {
      case 'gy': case 'mat': return true;
      case 'field': case 'ban': return !(x && x.faceDown);
      case 'extra': return !!(x && x.extraFaceUp);
      default: return false;
    }
  }
  /** Carta para comparar con filtros (effects.match): boca arriba, la de verdad; boca abajo, solo lo que se sabe por dónde está. */
  function publicCard(x, zoneKind) {
    if (!x) return null;
    const k = String(zoneKind || x.zone || '');
    const hidden = PILES.includes(k) ? !isPublic(k, x) : !!x.faceDown;
    if (!hidden) return cardOf(x);
    if (PILES.includes(k)) return { id: 0, name: '', type: 0, desc: '' };
    if (/^(?:e?mz\d?|monster|mzone)$/.test(k)) return { id: 0, name: '', type: T.MONSTER, desc: '' };
    if (k === 'fz') return { id: 0, name: '', type: T.SPELL | T.FIELD, desc: '' };
    return { id: 0, name: '', type: T.SPELL | T.TRAP, desc: '' };
  }
  /** Tu lado como lo puede ver el rival (lo único que lee la IA de ti). De tu mano, Mazo y Extra Deck solo cuenta cuántas hay. */
  function publicSide(S) {
    const len = (x) => (x ? Number(x.length) || 0 : 0);
    const out = {
      lp: Number(S.lp) || 0, counts: { hand: len(S.hand), deck: len(S.deck), extra: len(S.extra), gy: len(S.gy), ban: len(S.ban) },
      monsters: [], spells: [], gy: [], ban: [],
    };
    const turn = turnOf(S);
    for (const z of MON) {
      const x = topMine(S, z);
      if (!x) continue;
      const at = x.attackedTurn != null ? x.attackedTurn : null;
      if (x.faceDown) {
        out.monsters.push({ uid: x.uid, zone: z, faceDown: true, def: !!x.def, id: 0, atk: null, defv: null, level: null, isLink: false, negated: false, attackedTurn: at });
        continue;
      }
      const s = stats(S, 'me', x);
      out.monsters.push({
        uid: x.uid, zone: z, faceDown: false, def: s.pos === 'def', id: x.id, atk: s.atk, defv: s.def, level: levelOf(x), isLink: s.link,
        negated: !!(x.negated && Number(x.negated.turn) === turn), attackedTurn: at,
      });
    }
    for (const z of [...ST, 'fz']) {
      const x = topMine(S, z);
      if (x) out.spells.push({ uid: x.uid, zone: z, faceDown: !!x.faceDown, id: x.faceDown ? 0 : x.id });
    }
    out.gy = arr(S.gy).map((x) => ({ uid: x.uid, id: x.id }));
    out.ban = arr(S.ban).map((x) => ({ uid: x.uid, id: x.faceDown ? 0 : x.id }));
    return out;
  }
  /** '«X»' | 'un monstruo boca abajo del rival' | 'una carta boca abajo del rival'. Tus cartas, por su nombre. */
  function rivalName(S, x) {
    const uid = typeof x === 'string' ? x : x && x.uid;
    const f = uid ? findRival(S, uid) : null;
    if (!f) {
      const mine = uid && S && S.zones ? locMine(S, uid) : null;
      if (mine && mine.inst) return q(nameOf(mine.inst));
      if (x && typeof x === 'object' && x.id && !x.faceDown && FIELD.includes(x.zone)) return q(nameOf(x));
      return x && typeof x === 'object' && x.faceDown && MON.includes(x.zone) ? 'un monstruo boca abajo del rival' : 'una carta boca abajo del rival';
    }
    if (isPublic(f.where, f.inst)) return q(nameOf(f.inst));
    if (f.where === 'field' && MON.includes(f.zone)) return 'un monstruo boca abajo del rival';
    return 'una carta boca abajo del rival';
  }
  /** Texto de un movimiento (sin nombrar lo que sigue oculto).
   * res = { name, from: 'field'|'mat'|pila, to: pila|'gone'|'owner', wasHidden, isHiddenNow, how, by?, monster?, redirect?, faceUpExtra?, reveal? } */
  function moveText(S, res) {
    res = res || {};
    const name = res.name ? q(res.name) : '';
    const from = FIELD.includes(res.from) ? 'field' : res.from;
    const to = res.to;
    const how = res.how || '';
    const g = res.monster ? 'o' : 'a';
    const end = (s) => s + (res.by ? ' (por ' + byText(res.by) + ')' : '') + '.';
    const fromField = from === 'field' || from === 'mat';
    const redirect = res.redirect ? ' en lugar de ir al Cementerio (por ' + byText(res.redirect) + ')' : '';
    if (to === 'owner') return end(name + ' deja el campo del rival (es tuyo)');
    if (to === 'gone') return end(name + ' del rival desaparece');
    if (to === 'ban' && res.isHiddenNow) return end('Una carta del rival queda desterrada boca abajo');
    if ((res.wasHidden && res.isHiddenNow && !res.reveal) || !name) {
      // Nada se nombra: la carta estaba oculta y sigue oculta
      if (fromField) return end('Una carta boca abajo del rival vuelve a su ' + (PILE_WORD[to] || 'mano'));
      if (from === 'hand' && to === 'deck') return end('El rival devuelve 1 carta de su mano al Mazo');
      if (from === 'deck' && to === 'hand') return end('El rival roba 1 carta');
      if (from === 'ban') return end('Una carta desterrada boca abajo del rival vuelve a su ' + (PILE_WORD[to] || 'mano'));
      if (from === 'extra' && to === 'deck') return end('El rival devuelve 1 carta de su Extra Deck al Mazo');
      return end('Una carta del rival cambia de lugar');
    }
    const verb = { destroy: 'es destruid' + g, battle: 'es destruid' + g + ' en batalla', tribute: 'es sacrificad' + g }[how] || '';
    if (fromField) {
      const subj = res.wasHidden ? name + ' (estaba boca abajo)' : name + ' del rival';
      const gyWhere = res.wasHidden ? 'al Cementerio del rival' : 'a su Cementerio';
      switch (to) {
        case 'gy': return end(subj + (verb ? ' ' + verb + ' y va ' : ' va ') + gyWhere + (how === 'material' ? ' como material' : how === 'cost' ? ' como costo' : ''));
        case 'ban': return end(subj + (verb ? ' ' + verb + ' y queda desterrad' + g : ' queda desterrad' + g) + redirect);
        case 'hand': return end(subj + ' vuelve a su mano');
        case 'deck': return end(subj + ' vuelve a su Mazo');
        case 'extra':
          if (res.faceUpExtra) return end(subj + (verb ? ' ' + verb + ' y va' : ' va') + ' boca arriba a su Extra Deck');
          return end(subj + ' vuelve a su Extra Deck');
        default: return end(subj + ' deja el campo');
      }
    }
    const banned = res.redirect ? ' y queda desterrad' + g + redirect : '';
    switch (from) {
      case 'hand':
        if (to === 'gy' || (to === 'ban' && res.redirect)) {
          if (how === 'discard') return end('El rival descarta ' + name + banned);
          return end('El rival manda ' + name + ' de su mano al Cementerio' + (how === 'cost' ? ' como costo' : '') + banned);
        }
        if (to === 'ban') return end('El rival destierra ' + name + ' de su mano');
        break;
      case 'deck':
        if (to === 'hand') return end('El rival añade ' + name + ' de su Mazo a su mano');
        if (to === 'gy' || (to === 'ban' && res.redirect)) return end('El rival manda ' + name + ' de su Mazo al Cementerio' + banned);
        if (to === 'ban') return end('El rival destierra ' + name + ' de su Mazo');
        break;
      case 'extra':
        if (to === 'hand') return end('El rival añade ' + name + ' de su Extra Deck a su mano');
        if (to === 'gy' || (to === 'ban' && res.redirect)) return end('El rival manda ' + name + ' de su Extra Deck al Cementerio' + banned);
        if (to === 'ban') return end('El rival destierra ' + name + ' de su Extra Deck');
        break;
      case 'gy':
        if (to === 'hand') return end('El rival añade ' + name + ' de su Cementerio a su mano');
        if (to === 'deck') return end(name + ' vuelve del Cementerio al Mazo del rival');
        if (to === 'extra') return end(name + ' vuelve del Cementerio al Extra Deck del rival');
        if (to === 'ban') return end(name + ' del Cementerio del rival queda desterrad' + g);
        break;
      case 'ban':
        if (to === 'hand') return end('El rival añade ' + name + ' desterrad' + g + ' a su mano');
        if (to === 'deck') return end(name + ' vuelve del destierro al Mazo del rival');
        if (to === 'extra') return end(name + ' vuelve del destierro al Extra Deck del rival');
        if (to === 'gy') return end(name + (res.wasHidden ? ' (estaba desterrad' + g + ' boca abajo)' : '') + ' vuelve al Cementerio del rival');
        break;
      default: break;
    }
    return end(name + ' del rival va a su ' + (PILE_WORD[to] || 'mano'));
  }

  /* ---------- Bloqueos que tocan movimientos ---------- */
  function lockLive(S, l) {
    const b = B();
    try { return b && typeof b.lockActive === 'function' ? !!b.lockActive(S, l) : true; } catch (e) { return true; }
  }
  /** «Artifact Lancea» (de cualquiera de los dos): nadie destierra este turno → bloqueo o null */
  function noBanishLock(S) {
    const all = [...arr(S.turnState && S.turnState.locks), ...arr(S.opp && S.opp.ts && S.opp.ts.locks)];
    return all.find((l) => l && l.kind === 'noBanish' && lockLive(S, l)) || null;
  }
  /** Lo que iría al Cementerio queda desterrado (Retaliating "C", Dimension Shifter): { source } | null (lo decide bot.js) */
  function redirectOf(S) {
    const b = B();
    try { const r = b && typeof b.gyRedirect === 'function' ? b.gyRedirect(S) : null; return r && typeof r === 'object' ? r : null; } catch (e) { return null; }
  }
  /** Una copia limpia al Cementerio del rival (o al destierro con un reemplazo activo). → 'gy' | 'ban' */
  function toGy(S, inst) {
    if (redirectOf(S)) { S.opp.ban.push(inst); return 'ban'; }
    S.opp.gy.push(inst);
    return 'gy';
  }

  /* ---------- Mover cartas del rival ---------- */
  /** Mueve la carta encontrada (f = findRival) a dest: 'gy' | 'ban' | 'hand' | 'deck' | 'extra'.
   * opts: { how, by, faceDown (destierro boca abajo), top, bottom (Mazo), reveal (se muestra al moverla) }
   * → { ok, refused?, why?, went, text, ops } */
  function move(S, f, dest, opts) {
    opts = opts || {};
    const o = S.opp;
    const how = opts.how || '';
    const inst = f.inst;
    const c = cardOf(inst);
    const name = nameOf(inst);
    const ops = [];
    const fromField = f.where === 'field';
    const wasHidden = !isPublic(f.where, inst);
    // Tu carta en su campo (Hecahands Godos): vuelve a ti (field.js la pone donde corresponde)
    if (fromField && inst.owner === 'player') {
      const nb = !!noBanishLock(S);
      let d = inst.banishOnLeave && !nb ? 'ban' : dest === 'hand' ? 'hand' : dest === 'deck' ? 'deck' : dest === 'ban' && !nb ? 'ban' : 'gy';
      if (d === 'gy' && redirectOf(S)) d = 'ban';
      f.list.splice(f.index, 1);
      const why = d === 'ban' && inst.banishOnLeave ? inst.by || opts.by || name : opts.by || inst.by || name;
      ops.push({ op: 'returnOwned', card: inst.card || { uid: inst.uid, id: inst.id }, dest: d, by: why });
      return { ok: true, went: 'owner', text: moveText(S, { name, from: 'field', to: 'owner' }), ops };
    }
    if (dest === 'ban') {
      const nb = noBanishLock(S);
      if (nb) {
        const why = 'Por ' + q(nb.source || 'Artifact Lancea') + ', este turno nadie puede desterrar cartas.';
        return { ok: false, refused: true, why, went: null, text: rivalName(S, inst.uid) + ' no se puede desterrar: ' + why.charAt(0).toLowerCase() + why.slice(1), ops };
      }
    }
    f.list.splice(f.index, 1);
    let extraText = '';
    if (fromField) {
      // Sus materiales Xyz van al Cementerio; si estaba en la cadena (una Trampa de bot.js), deja la cadena
      const mats = arr(inst.mats);
      if (mats.length) {
        mats.forEach((m) => toGy(S, cleanInst(m, true)));
        extraText = ' ' + (mats.length === 1 ? 'Su material ' + q(nameOf(mats[0])) + ' va' : 'Sus materiales (' + mats.map((m) => q(nameOf(m))).join(', ') + ') van') + ' a su Cementerio.';
      }
    }
    const res = { name, from: f.where, how, by: opts.by, monster: !!(c && db.isMonster(c)), wasHidden, reveal: !!opts.reveal };
    let went;
    const fromBoard = fromField || f.where === 'mat';
    if (fromBoard && isToken(inst)) went = 'gone';
    else if (dest === 'gy') {
      // Un Péndulo que deja el campo hacia el Cementerio va boca arriba al Extra Deck
      const pend = fromField && c && db.isMonster(c) && c.type & T.PENDULUM && (isMonsterEntry(inst) || inst.zone === 'st0' || inst.zone === 'st4');
      if (pend) {
        const card = cleanInst(inst, true);
        card.extraFaceUp = true;
        o.extra.push(card);
        went = 'extra';
        res.faceUpExtra = true;
      } else {
        const rd = redirectOf(S);
        went = toGy(S, cleanInst(inst, true));
        if (went === 'ban' && rd) res.redirect = rd.source || 'un efecto';
      }
    } else if (dest === 'ban') {
      const card = cleanInst(inst, true);
      if (opts.faceDown) card.faceDown = true;
      o.ban.push(card);
      went = 'ban';
    } else if (dest === 'extra' || ((dest === 'hand' || dest === 'deck') && c && db.isExtra(c))) {
      const card = cleanInst(inst, dest === 'extra' && !!opts.faceUp);
      if (dest === 'extra' && opts.faceUp) { card.extraFaceUp = true; res.faceUpExtra = true; }
      o.extra.push(card);
      went = 'extra';
    } else if (dest === 'hand') {
      o.hand.push(cleanInst(inst, false));
      went = 'hand';
    } else if (dest === 'deck') {
      const card = cleanInst(inst, false);
      if (opts.top) o.deck.unshift(card);
      else if (opts.bottom) o.deck.push(card);
      else o.deck.splice(Math.floor(rand(S) * (o.deck.length + 1)), 0, card);
      went = 'deck';
    } else {
      // Destino desconocido: al Cementerio
      went = toGy(S, cleanInst(inst, true));
    }
    const last = went === 'extra' ? o.extra[o.extra.length - 1] : went === 'ban' ? o.ban[o.ban.length - 1] : null;
    res.to = went;
    res.isHiddenNow = went === 'hand' || went === 'deck' || (went === 'extra' && !(last && last.extraFaceUp)) || (went === 'ban' && !!(last && last.faceDown));
    out(S, { op: 'move', uid: inst.uid, from: f.where, dest, how, by: opts.by || '', faceDown: !!opts.faceDown, top: !!opts.top, bottom: !!opts.bottom, faceUp: !!opts.faceUp });
    return { ok: true, went, text: moveText(S, res) + extraText, ops };
  }
  /** Una carta del rival (del campo, un material o una pila) se va. how: destroy | battle | banish | banishFD | hand | deck | gy | send
   * | tribute | material | cost | discard. → { ok, refused?, why?, went, text, ops } (ops: tu carta que tenía, para field.js) */
  function leave(S, uid, how, by) {
    const f = findRival(S, uid);
    if (!f) return { ok: false, why: 'No encuentro esa carta del rival.', went: null, text: '', ops: [] };
    const r = move(S, f, DEST[how] || 'gy', { how: how || 'gy', by, faceDown: how === 'banishFD' });
    sync(S);
    return r;
  }
  /** De una pila a otra (o del campo). dest: 'hand' | 'deck' | 'gy' | 'ban' | 'extra'.
   * opts: { how, by, top, bottom, faceDown, faceUp (Extra Deck), draw (robo: no se muestra), reveal (por defecto: al añadir del Mazo) } */
  function moveRival(S, uid, dest, opts) {
    opts = Object.assign({}, opts || {});
    const f = findRival(S, uid);
    if (!f) return { ok: false, why: 'No encuentro esa carta del rival.', went: null, text: '', ops: [] };
    if (!['hand', 'deck', 'gy', 'ban', 'extra'].includes(dest)) return { ok: false, why: 'Destino desconocido.', went: null, text: '', ops: [] };
    if (dest === 'hand' && f.where === 'deck') {
      if (!opts.draw) {
        const lock = arr(tsOf(S).locks).find((l) => l && l.kind === 'noDeckAdd');
        if (lock) {
          const why = 'Por ' + q(lock.source || 'Droll & Lock Bird') + ', este turno el rival no puede añadir cartas de su Mazo a la mano.';
          return { ok: false, refused: true, why, went: null, text: why, ops: [] };
        }
        if (opts.reveal === undefined) opts.reveal = true;
      } else opts.reveal = false;
    }
    if (dest === 'ban' && opts.faceDown) opts.how = opts.how || 'banishFD';
    const r = move(S, f, dest, opts);
    sync(S);
    return r;
  }

  /* ---------- Preparar el duelo ---------- */
  /** Mazo del rival: el objeto { id, name, main, extra } o su id en YGO.builder.decks(). */
  function deckOf(x) {
    if (x && typeof x === 'object' && Array.isArray(x.main)) return x;
    if (x == null || x === '') return null;
    let list = [];
    try { list = YGO.builder && typeof YGO.builder.decks === 'function' ? arr(YGO.builder.decks()) : []; } catch (e) { list = []; }
    return list.find((d) => d && String(d.id) === String(x)) || null;
  }
  /** Prepara el lado del rival en un S recién repartido (tu mano, Mazo y Extra Deck ya están). Lanza un error si no se puede
   * (sin tocar S). cfg = { rival: mazo | id, firstPref: 'me'|'rival'|'coin', seed?, pace?, askOnly?, responds?, combos?, rivalHand?: ids,
   * rivalOrder?: ids (de arriba abajo), starters?: ids }. → { ok, first, coin, dropped, logs: [texto] } */
  function setup(S, cfg) {
    cfg = cfg || {};
    if (cfg.pvp) return setupPvp(S, cfg.pvp);
    const RS = R(), BT = B();
    if (!S || typeof S !== 'object') throw new Error('Falta el estado del duelo');
    if (!RS || !BT || typeof BT.newOpponent !== 'function') throw new Error('Faltan YGO.rules o YGO.bot');
    const deck = deckOf(cfg.rival != null ? cfg.rival : cfg.rivalId);
    if (!deck) throw new Error('No encuentro el mazo del rival');
    const known = (id) => Number(id) > 0 && !!db.get(Number(id));
    let dropped = 0;
    const keep = (list) => arr(list).filter((x) => { if (known(x)) return true; dropped++; return false; }).map(Number);
    const main = keep(deck.main);
    const extraIds = keep(deck.extra);
    const handIds0 = Array.isArray(cfg.rivalHand) && cfg.rivalHand.length ? cfg.rivalHand.filter(known).map(Number) : null;
    if (!main.length && !(handIds0 && handIds0.length)) throw new Error('El mazo del rival no tiene cartas');
    const hasSeed = cfg.seed !== undefined && cfg.seed !== null && cfg.seed !== '' && Number.isFinite(Number(cfg.seed));
    const seed = hasSeed ? Number(cfg.seed) >>> 0 : Math.floor(Math.random() * 4294967296) >>> 0; // solo aquí: crear una semilla
    const o = BT.newOpponent({ enabled: true, mode: 'smart', count: 0, pool: [], seed, starters: arr(cfg.starters) });
    Object.assign(o, {
      pool: [], hand: [], deck: [], gy: [], ban: [], field: [], initialHand: [], count: 0,
      vs: true, deckId: deck.id != null ? deck.id : null, name: String(deck.name || 'Rival'), extra: [], lp: LP0, rseq: 0,
      ts: RS.newTurnState(),
      ai: { turn: null, steps: 0, tried: {}, triggers: [], extraSummons: 0, sets: 0, fails: 0 },
    });
    // Orden del Mazo: rivalOrder tal cual (lo que no nombra va detrás) o barajado con la semilla. Los uids, después.
    const pool = main.slice();
    const take = (id) => { const i = pool.indexOf(id); if (i >= 0) pool.splice(i, 1); };
    let handIds = null;
    if (handIds0) { handIds = handIds0; handIds.forEach(take); }
    let order;
    if (Array.isArray(cfg.rivalOrder) && cfg.rivalOrder.length) {
      const ord = cfg.rivalOrder.filter(known).map(Number);
      ord.forEach(take);
      order = ord.concat(pool);
    } else order = shuffleOpp(o, pool);
    if (!handIds) handIds = order.splice(0, 5);
    const mk = (id) => ({ uid: 'r' + (++o.rseq).toString(36), id, faceDown: false, def: false });
    o.hand = handIds.map(mk);
    o.deck = order.map(mk);
    o.extra = extraIds.map(mk);
    const pref = ['me', 'rival', 'coin'].includes(cfg.firstPref) ? cfg.firstPref : 'coin';
    const coin = pref === 'coin';
    const first = coin ? (randOpp(o) < 0.5 ? 'me' : 'rival') : pref;
    // Desde aquí se toca S
    S.opp = o;
    S.lp = LP0;
    if (!Array.isArray(S.chain)) S.chain = [];
    // Como en Dueling Nexus, el turno empieza en la Fase de Robo (también el tuyo)
    S.turnState = RS.newTurnState({ phase: 'draw' });
    S.turnState.turn = 1;
    S.turnState.mine = first === 'me';
    S.vs = {
      v: 1, seed, first, firstPref: pref, coin, pace: ['normal', 'fast', 'step'].includes(cfg.pace) ? cfg.pace : 'normal', paused: false,
      askOnly: cfg.askOnly !== false, responds: cfg.responds !== false, rival: { id: o.deckId, name: o.name },
      combos: cfg.combos !== false, // repite los combos grabados de su mazo (js/combos.js)
      over: null, win: null, warned: {}, recorded: null,
    };
    tsOf(S);
    sync(S);
    const who = first === 'me' ? 'empiezas tú' : 'empieza el rival';
    const logs = ['Duelo VS contra ' + q(o.name) + ' · ' + LP0 + ' LP · ' + who + '.'];
    if (coin) logs.push('Moneda: ' + who + '.');
    if (dropped) logs.push(dropped === 1 ? '1 carta del mazo del rival no está en la base: se quita.' : dropped + ' cartas del mazo del rival no están en la base: se quitan.');
    logs.push('El rival juega solo; lo que no sabe simular no lo usa o queda en el registro como «no se simula».');
    return { ok: true, first, coin, dropped, logs };
  }

  /** Duelo en línea (js/pvp.js): el rival es otra persona en otro navegador. Su lado empieza vacío (5 cartas en la mano y
   * su Mazo, solo como cantidades) y YGO.pvp lo va llenando con lo público que llega por la red. Aquí no hay mazo del
   * rival, ni semilla, ni IA. p = { role: 'host'|'guest', duelId, first: 'me'|'rival', coin, firstPref, name, main, extra, code }.
   * → { ok, first, coin, dropped: 0, logs } */
  function setupPvp(S, p) {
    p = p || {};
    const RS = R(), BT = B();
    if (!S || typeof S !== 'object') throw new Error('Falta el estado del duelo');
    if (!RS) throw new Error('Faltan YGO.rules');
    const o = BT && typeof BT.newOpponent === 'function' ? BT.newOpponent({ enabled: true, mode: 'smart', count: 0, pool: [], seed: 1 }) || {} : {};
    // Cartas sin código (solo se sabe cuántas hay): uids propios, que nunca son de una carta real
    const blank = (n, k) => Array.from({ length: Math.max(0, Math.floor(Number(n) || 0)) }, (_, i) => ({ uid: 'p-' + k + i, id: 0, faceDown: true, def: false }));
    const main = Math.max(0, Number(p.main) || 40);
    Object.assign(o, {
      enabled: true, pool: [], hand: blank(Math.min(5, main), 'h'), deck: blank(Math.max(0, main - 5), 'd'), gy: [], ban: [], field: [],
      initialHand: [], count: 0, vs: true, pvp: true, deckId: null, name: String(p.name || 'Rival').slice(0, 40),
      extra: blank(p.extra, 'x'), lp: LP0, rseq: 0, ts: RS.newTurnState(),
      ai: { turn: null, steps: 0, tried: {}, triggers: [], extraSummons: 0, sets: 0, fails: 0 },
    });
    const first = p.first === 'rival' ? 'rival' : 'me';
    S.opp = o;
    S.lp = LP0;
    if (!Array.isArray(S.chain)) S.chain = [];
    S.turnState = RS.newTurnState({ phase: 'draw' });
    S.turnState.turn = 1;
    S.turnState.mine = first === 'me';
    S.vs = {
      v: 1, pvp: { role: p.role === 'guest' ? 'guest' : 'host', duelId: String(p.duelId || ''), code: String(p.code || '') },
      seed: 0, first, firstPref: ['me', 'rival', 'coin'].includes(p.firstPref) ? p.firstPref : 'coin', coin: !!p.coin,
      pace: 'step', paused: false, askOnly: false, responds: false, rival: { id: null, name: o.name },
      over: null, win: null, warned: {}, recorded: null,
    };
    tsOf(S);
    sync(S);
    const who = first === 'me' ? 'empiezas tú' : 'empieza ' + q(o.name);
    const logs = ['Duelo en línea contra ' + q(o.name) + ' · ' + LP0 + ' LP · ' + who + '.'];
    if (p.coin) logs.push('Moneda: ' + who + '.');
    logs.push('Cada uno mueve sus cartas. Lo que un efecto tuyo le hace a una carta del rival lo aplica su dueño.');
    return { ok: true, first, coin: !!p.coin, dropped: 0, logs };
  }

  /* ---------- Jugadas del rival ---------- */
  /** Roba n cartas de su Mazo. Con normal (su Fase de Robo) y el Mazo vacío pierde: S.vs.over. → { cards, empty, text } (sin nombres) */
  function draw(S, n, opts) {
    opts = opts || {};
    const o = S.opp;
    n = Math.max(1, Math.floor(Number(n) || 1));
    const cards = o.deck.splice(0, n);
    o.hand.push(...cards);
    o.drew = (Number(o.drew) || 0) + cards.length;
    const empty = cards.length < n;
    const by = opts.by ? ' (por ' + byText(opts.by) + ')' : '';
    let text = cards.length ? 'El rival roba ' + plural(cards.length, 'carta', 'cartas') + by + '.' : '';
    if (empty && opts.normal) {
      if (S.vs && !S.vs.over) S.vs.over = { winner: 'me', why: 'deckout', turn: turnOf(S) };
      text = 'El rival no puede robar: su Mazo está vacío.';
    } else if (empty) text = (text ? text + ' ' : '') + 'Su Mazo está vacío.';
    sync(S);
    return { cards, empty, text };
  }
  /** Zona para invocar: los Link prefieren una Zona Extra; los demás del Extra Deck, una principal (como field.js);
   * "center" en su procedimiento → mz2. null si no hay ninguna legal. */
  function pickZone(S, uid, c, from, mats, method, own) {
    const RS = R();
    const zones = withRival(S, (view) => RS.legalZones(view, uid, { from, vacating: mats, method }));
    if (!zones.length) return null;
    if (own) { const pr = RS.procedureOf(c); if (pr && pr.center) return zones.includes('mz2') ? 'mz2' : null; }
    if (c.type & T.LINK) return zones.find((z) => EMZ.includes(z)) || zones[0];
    return zones.find((z) => MZ.includes(z)) || zones[0];
  }
  /** Invocación del rival revisada por las reglas (sin errores ni avisos).
   * req = { uid, method: normal|set|tribute|tributeSet|special|link|xyz|synchro, zone?, position: atk|def|set, materials: [uid],
   * ownProcedure?, source?, matHow? (special: cómo pagan los materiales, 'cost' por defecto), allowWarnings? }
   * → { ok, why?, v, entry, text, ops } */
  function summon(S, req) {
    const RS = R();
    req = Object.assign({}, req || {});
    const fail = (why, v) => ({ ok: false, why, v: v || null, entry: null, text: '', ops: [] });
    if (!RS) return fail('Faltan las reglas.');
    const f = findRival(S, req.uid);
    if (!f) return fail('No encuentro esa carta del rival.');
    if (f.where === 'field' || f.where === 'mat') return fail('Esa carta ya está en el campo.');
    const c = cardOf(f.inst);
    if (!c) return fail('Carta desconocida.');
    const method = req.method || 'special';
    req.method = method;
    req.materials = arr(req.materials).slice();
    if (!req.position) req.position = method === 'set' || method === 'tributeSet' ? 'set' : 'atk';
    if (c.type & T.LINK) req.position = 'atk';
    const from = f.where;
    if (!req.zone) req.zone = pickZone(S, req.uid, c, from, req.materials, method, !!req.ownProcedure);
    if (!req.zone) return fail('No hay una zona válida libre para este monstruo.');
    const v = withRival(S, (view) => RS.checkSummon(view, req));
    if (!v.ok) return fail(v.errors[0] || 'Las reglas no permiten esta invocación.', v);
    if (v.warnings.length && !req.allowWarnings) return fail(v.warnings[0], v);
    withRival(S, (view) => RS.commitSummon(view, req, v)); // la entrada del registro no se usa (nombra cartas)
    const turn = turnOf(S);
    const ops = [];
    const matNames = [];
    const attached = [];
    const xyz = method === 'xyz';
    const matHow = method === 'tribute' || method === 'tributeSet' ? 'tribute' : ['link', 'synchro', 'xyz', 'fusion', 'ritual'].includes(method) ? 'material' : req.matHow || 'cost';
    for (const uid of req.materials) {
      const mf = findRival(S, uid);
      if (!mf) continue;
      matNames.push(q(nameOf(mf.inst)));
      if (xyz && mf.where === 'field') {
        mf.list.splice(mf.index, 1);
        arr(mf.entry.mats).forEach((m) => toGy(S, cleanInst(m, true)));
        attached.push(cleanInst(mf.inst, true));
      } else {
        const r = move(S, mf, DEST[matHow] || 'gy', { how: matHow });
        ops.push(...arr(r.ops));
      }
    }
    const sf = findRival(S, req.uid);
    sf.list.splice(sf.index, 1);
    const inst = sf.inst;
    const e = {
      uid: inst.uid, id: inst.id, faceDown: req.position === 'set', def: req.position !== 'atk', zone: req.zone, monster: true,
      summonedTurn: turn, summonMethod: method,
    };
    if (inst.properSummon) e.properSummon = inst.properSummon;
    if (req.position === 'set') e.setTurn = turn;
    if (xyz) e.mats = attached;
    S.opp.field.push(e);
    const name = q(c.name);
    const where = zoneLabel(e.zone);
    const mats = matNames.join(', ');
    let text;
    switch (method) {
      case 'normal': text = 'El rival Invoca de modo Normal ' + name + ' en ' + where + '.'; break;
      case 'tribute': text = 'El rival Invoca por Sacrificio ' + name + ' en ' + where + (mats ? ' (sacrificando ' + mats + ')' : '') + '.'; break;
      case 'set': text = 'El rival coloca 1 monstruo boca abajo en defensa (' + where + ').'; break;
      case 'tributeSet': text = 'El rival coloca 1 monstruo boca abajo en defensa (' + where + ')' + (mats ? ', sacrificando ' + mats : '') + '.'; break;
      case 'link': text = 'El rival Invoca por Link ' + name + ' (materiales: ' + mats + ').'; break;
      case 'xyz': text = 'El rival Invoca por Xyz ' + name + ' (materiales: ' + mats + ').'; break;
      case 'synchro': text = 'El rival Invoca por Sincronía ' + name + ' (materiales: ' + mats + ').'; break;
      default:
        if (e.faceDown) text = 'El rival Invoca de modo Especial 1 monstruo boca abajo en defensa (' + where + ').';
        else {
          text = 'El rival Invoca de modo Especial ' + name + ' ' + (FROM_TXT[from] || '') + (e.def ? ' en Defensa' : '') + ' en ' + where
            + (req.source ? ' (por ' + byText(req.source) + ')' : '') + (mats && !req.source ? ' (con ' + mats + ')' : '') + '.';
        }
    }
    sync(S);
    return { ok: true, v, entry: e, text, ops };
  }
  /** Coloca una Mágica/Trampa boca abajo (con setTurn). opts.effect: la coloca un efecto (sin revisar Fase ni cadena).
   * → { ok, why?, entry, text } (texto sin nombre) */
  function set(S, uid, zone, opts) {
    const RS = R();
    opts = opts || {};
    const fail = (why, v) => ({ ok: false, why, v: v || null, entry: null, text: '' });
    const f = findRival(S, uid);
    if (!f) return fail('No encuentro esa carta del rival.');
    if (f.where === 'field' || f.where === 'mat') return fail('Esa carta ya está en el campo.');
    const c = cardOf(f.inst);
    if (!c || db.isMonster(c)) return fail('Solo se colocan así las Mágicas y Trampas.');
    const isField = !!(c.type & T.FIELD);
    if (!zone) zone = isField ? 'fz' : freeZone(S, 'st');
    if (!zone) return fail('No quedan Zonas de Mágicas y Trampas libres.');
    if (isField ? zone !== 'fz' : !ST.includes(zone)) return fail('Esa zona no sirve para esta carta.');
    if (zone !== 'fz' && entryAt(S, zone)) return fail('Esa zona ya está ocupada.');
    let v = null;
    if (!opts.effect && RS) {
      const old = zone === 'fz' ? entryAt(S, 'fz') : null; // la Mágica de Campo anterior se va al Cementerio
      v = withRival(S, (view) => RS.checkSet(view, uid, zone, old ? { vacating: [old.uid] } : {}));
      if (!v.ok) return fail(v.errors[0] || 'Las reglas no permiten colocarla.', v);
      if (zone !== 'fz' && v.warnings.length) return fail(v.warnings[0], v);
      withRival(S, (view) => RS.commitSet(view, uid, v));
    }
    let extra = '';
    if (zone === 'fz') { const old = entryAt(S, 'fz'); if (old) { const r = leave(S, old.uid, 'gy'); if (r.text) extra = ' ' + r.text; } }
    const sf = findRival(S, uid);
    sf.list.splice(sf.index, 1);
    const e = { uid: sf.inst.uid, id: sf.inst.id, faceDown: true, def: false, zone, setTurn: turnOf(S) };
    S.opp.field.push(e);
    sync(S);
    return { ok: true, v, entry: e, text: 'El rival coloca 1 carta boca abajo en ' + zoneLabel(zone) + '.' + extra };
  }
  /** Activar una Mágica/Trampa: de la mano a una Zona de M/T libre (Mágica de Campo → fz; la anterior va al Cementerio)
   * o voltea la que estaba Colocada. → la entrada | null */
  function activatePlace(S, uid) {
    const f = findRival(S, uid);
    if (!f || f.where === 'mat') return null;
    if (f.where === 'field') {
      if (f.entry.faceDown) f.entry.faceDown = false;
      sync(S);
      return f.entry;
    }
    const c = cardOf(f.inst);
    if (!c || db.isMonster(c)) return null;
    let zone;
    if (c.type & T.FIELD) {
      const old = entryAt(S, 'fz');
      if (old) leave(S, old.uid, 'gy');
      zone = 'fz';
    } else zone = freeZone(S, 'st');
    if (!zone) return null;
    const sf = findRival(S, uid);
    sf.list.splice(sf.index, 1);
    const e = { uid: sf.inst.uid, id: sf.inst.id, faceDown: false, def: false, zone };
    S.opp.field.push(e);
    sync(S);
    return e;
  }
  /** Pone una carta del rival en su campo sin revisar las reglas (los combos grabados de js/combos.js ya se jugaron así).
   * opts: { zone (la preferida), faceDown, def, method (se Invoca: summonMethod), under (uid del monstruo del que queda como
   * material), mats ([uid] de su campo que quedan debajo, Xyz), token: { id, token } (una ficha nueva, uid propio) }.
   * Sin zona libre de ese tipo prueba otra que sirva (Zona Extra ↔ principal para las del Extra Deck); con un monstruo suyo ya
   * en una Zona Extra, el nuevo va a una principal (cada jugador usa una sola).
   * → { ok, why?, entry, zone, from: 'field'|'mat'|pila|'new', was: { zone, faceDown, def } | null, extra: [texto] (la Mágica de
   *   Campo que reemplazó y va a su Cementerio) } */
  function place(S, uid, opts) {
    opts = opts || {};
    const o = S && S.opp;
    const fail = (why) => ({ ok: false, why, entry: null, zone: null, from: null, was: null });
    if (!o || !Array.isArray(o.field)) return fail('Sin rival.');
    const turn = turnOf(S);
    let f = null;
    let inst;
    if (opts.token && opts.token.id) {
      inst = { uid: 'r' + (++o.rseq).toString(36), id: Number(opts.token.id), faceDown: false, def: false, token: Object.assign({}, opts.token.token || {}) };
    } else {
      f = findRival(S, uid);
      if (!f) return fail('No encuentro esa carta del rival.');
      inst = f.inst;
    }
    const from = f ? f.where : 'new';
    const take = () => {
      if (!f) return [];
      const cur = findRival(S, inst.uid);
      if (!cur) return [];
      cur.list.splice(cur.index, 1);
      return cur.where === 'field' ? arr(cur.entry.mats) : [];
    };
    // Queda como material de otro monstruo (con los materiales que tenía)
    if (opts.under) {
      const hf = findRival(S, opts.under);
      if (!hf || hf.where !== 'field' || hf.entry.uid === inst.uid) return fail('No encuentro el monstruo.');
      const carried = take();
      const host = findRival(S, opts.under).entry;
      host.mats = arr(host.mats).concat([cleanInst(inst, true)], carried.map((m) => cleanInst(m, true)));
      sync(S);
      return { ok: true, entry: host, zone: host.zone, from, was: null };
    }
    const c = cardOf(inst);
    const mon = !!(inst.token || (c && db.isMonster(c)));
    const fieldSpell = !!(c && !db.isMonster(c) && c.type & T.FIELD);
    const want = opts.zone && FIELD.includes(opts.zone) ? opts.zone : null;
    const kindOf = (z) => (z === 'fz' ? 'fz' : ST.includes(z) ? 'st' : EMZ.includes(z) ? 'emz' : 'mz');
    const was = f && f.where === 'field' ? { zone: f.entry.zone, faceDown: !!f.entry.faceDown, def: !!f.entry.def } : null;
    // Los materiales Xyz dejan sus zonas antes de elegir la del monstruo nuevo
    const under = [];
    for (const m of arr(opts.mats)) {
      const mf = findRival(S, m);
      if (!mf || mf.where !== 'field' || m === inst.uid) continue;
      mf.list.splice(mf.index, 1);
      under.push(cleanInst(mf.inst, true), ...arr(mf.entry.mats).map((x) => cleanInst(x, true)));
    }
    let zone = null;
    if (was && (!want || want === was.zone)) zone = was.zone;
    else {
      let kind = want ? kindOf(want) : fieldSpell ? 'fz' : mon ? 'mz' : 'st';
      const extraOk = !!(c && db.isExtra(c));
      // Ya tiene un monstruo en una Zona Extra (otro que este): la otra no es suya
      const emzUsed = o.field.some((x) => x && EMZ.includes(x.zone) && x.uid !== inst.uid);
      if (kind === 'emz' && emzUsed) kind = 'mz';
      if (kind === 'fz') zone = 'fz';
      else zone = freeZone(S, kind, want) || (kind === 'emz' ? freeZone(S, 'mz') : kind === 'mz' && extraOk && !emzUsed ? freeZone(S, 'emz') : null);
    }
    if (!zone) {
      // Sin zona: los materiales Xyz vuelven a su Cementerio (ya no tienen zona)
      under.forEach((m) => toGy(S, m));
      return fail('No hay una zona libre.');
    }
    const extra = [];
    if (zone === 'fz' && !(was && was.zone === 'fz')) {
      const old = entryAt(S, 'fz');
      if (old && old.uid !== inst.uid) { const r = leave(S, old.uid, 'gy'); if (r && r.text) extra.push(r.text); }
    }
    let e;
    if (was) {
      e = f.entry;
      e.zone = zone;
    } else {
      const carried = take();
      e = { uid: inst.uid, id: inst.id, faceDown: false, def: false, zone };
      if (inst.token) e.token = Object.assign({}, inst.token);
      if (inst.properSummon) e.properSummon = inst.properSummon;
      if (carried.length) e.mats = carried.map((m) => cleanInst(m, true));
      o.field.push(e);
    }
    e.faceDown = !!opts.faceDown;
    e.def = !!(opts.def || opts.faceDown) && MON.includes(zone);
    if (MON.includes(zone) && mon) {
      e.monster = true;
      delete e.asSpell;
    } else if (ST.includes(zone) && mon) e.asSpell = true;
    if (opts.method && MON.includes(zone)) { e.summonedTurn = turn; e.summonMethod = opts.method; }
    if (e.faceDown && (!was || !was.faceDown)) e.setTurn = turn;
    if (under.length) e.mats = arr(e.mats).concat(under);
    sync(S);
    return { ok: true, entry: e, zone, from, was, extra };
  }
  const statLine = (S, side, x) => { const s = stats(S, side, Object.assign({}, x, { faceDown: false })); return s.link ? 'ATK ' + s.atk + ' / LINK-' + ((cardOf(x) || {}).lv || 0) : 'ATK ' + s.atk + ' / DEF ' + s.def; };
  /** Voltea boca arriba una carta suya (batalla o efecto). → { ok, entry, text } */
  function flip(S, uid) {
    const f = findRival(S, uid);
    if (!f || f.where !== 'field') return { ok: false, why: 'Esa carta no está en el campo del rival.', entry: null, text: '' };
    const e = f.entry;
    if (!e.faceDown) return { ok: true, entry: e, text: '' };
    e.faceDown = false;
    out(S, { op: 'flip', uid });
    const text = 'Se voltea ' + q(nameOf(e)) + ' del rival' + (isMonsterEntry(e) ? ' (' + statLine(S, 'rival', e) + ')' : '') + '.';
    sync(S);
    return { ok: true, entry: e, text };
  }
  /** Cambia la posición de su monstruo. En su turno es su cambio de posición (o Invocación por Volteo), revisado por las reglas;
   * en tu turno, o con opts.effect, lo hace un efecto (sin revisar). to: 'atk' | 'def' | 'set' (solo por efecto). */
  function position(S, uid, to, opts) {
    const RS = R();
    opts = opts || {};
    const fail = (why, v) => ({ ok: false, why, v: v || null, entry: null, text: '' });
    const f = findRival(S, uid);
    if (!f || f.where !== 'field' || !MON.includes(f.zone) || !isMonsterEntry(f.entry)) return fail('Solo se cambia la posición de un monstruo en el campo del rival.');
    const e = f.entry;
    const c = cardOf(e);
    const turn = turnOf(S);
    if (!['atk', 'def', 'set'].includes(to)) return fail('Posición desconocida.');
    if (c && c.type & T.LINK && to !== 'atk') return fail('Los monstruos Link siempre están en posición de Ataque.');
    const effect = !!opts.effect || (S.turnState && S.turnState.mine !== false);
    const wasDown = !!e.faceDown;
    let v = null;
    if (!effect) {
      if (to === 'set') return fail('Solo un efecto puede poner un monstruo boca abajo.');
      if (e.attackedTurn != null && Number(e.attackedTurn) === turn) return fail('Ya atacó este turno: no puede cambiar de posición.');
      if (wasDown && to !== 'atk') return fail('Un monstruo boca abajo solo pasa a Ataque boca arriba (Invocación por Volteo).');
      if (!wasDown && (to === 'def') === !!e.def) return fail('Ya está en esa posición.');
      if (RS) {
        v = withRival(S, (view) => RS.checkPosition(view, uid, { to }));
        if (!v.ok) return fail(v.errors[0] || 'Las reglas no permiten el cambio.', v);
        if (v.warnings.length) return fail(v.warnings[0], v);
        withRival(S, (view) => RS.commitPosition(view, uid, v));
      }
    }
    if (to === 'set') { e.faceDown = true; e.def = true; } else { e.faceDown = false; e.def = to === 'def'; }
    out(S, { op: 'position', uid, to, by: opts.by || '' });
    const name = q(nameOf(e));
    const by = opts.by ? ' (por ' + byText(opts.by) + ')' : '';
    let text;
    if (!effect) {
      e.positionChangedTurn = turn;
      if (wasDown) { e.summonMethod = 'flip'; e.summonedTurn = turn; text = 'El rival Invoca por Volteo ' + name + ' (' + statLine(S, 'rival', e) + ').'; }
      else text = name + ' del rival pasa a posición de ' + (to === 'def' ? 'Defensa' : 'Ataque') + '.';
    } else if (to === 'set') text = (wasDown ? 'Un monstruo boca abajo del rival sigue boca abajo' : name + ' del rival queda boca abajo en Defensa') + by + '.';
    else if (wasDown) text = 'Se voltea ' + name + ' del rival (' + statLine(S, 'rival', e) + ') y queda en ' + (to === 'def' ? 'Defensa' : 'Ataque') + by + '.';
    else text = name + ' del rival pasa a posición de ' + (to === 'def' ? 'Defensa' : 'Ataque') + by + '.';
    sync(S);
    return { ok: true, v, entry: e, text };
  }
  /** Niega los efectos de su carta hasta el final del turno (Effect Veiler, Infinite Impermanence, "Negar sus efectos"). */
  function negate(S, uid, by) {
    const f = findRival(S, uid);
    if (!f || f.where !== 'field') return { ok: false, why: 'Esa carta no está en el campo del rival.', entry: null, text: '' };
    const e = f.entry;
    e.negated = { turn: turnOf(S), by: by || '' };
    out(S, { op: 'negate', uid, by: by || '' });
    sync(S);
    return { ok: true, entry: e, text: 'Los efectos de ' + rivalName(S, e) + ' quedan negados hasta el final del turno' + (by ? ' (por ' + byText(by) + ')' : '') + '.' };
  }

  /* ---------- Batalla ---------- */
  /** Ubicación en el campo: { zone, inst } (side 'me': S.zones; 'rival': S.opp.field) o null. */
  function onFieldOf(S, side, uid) {
    if (!uid) return null;
    if (side === 'rival') {
      const f = findRival(S, uid);
      return f && f.where === 'field' ? { zone: f.zone, inst: f.entry } : null;
    }
    const loc = locMine(S, uid);
    return loc && loc.area === 'field' && loc.index === 0 ? { zone: loc.zone, inst: loc.inst } : null;
  }
  /** { atk, def, pos: 'atk'|'def', faceDown, link } — el ATK cambiado este turno (atkSet) manda; Tokens con inst.token; Link: DEF 0, siempre ATK. */
  function stats(S, side, x) {
    let inst = x;
    if (typeof x === 'string') { const l = side === 'rival' ? findRival(S, x) : locMine(S, x); inst = l ? l.inst : null; }
    if (!inst) return null;
    const c = cardOf(inst) || { type: 0 };
    const num = (n) => (typeof n === 'number' && n >= 0 ? n : Number(n) >= 0 ? Number(n) : 0);
    const link = !!(c.type & T.LINK || c.isLink);
    let atk = num(inst.token ? inst.token.atk : c.atk);
    const def = link ? 0 : num(inst.token ? inst.token.def : c.def);
    if (inst.atkSet && !inst.faceDown && Number(inst.atkSet.turn) === turnOf(S)) atk = num(inst.atkSet.atk);
    return { atk, def, pos: link ? 'atk' : inst.def || inst.faceDown ? 'def' : 'atk', faceDown: !!inst.faceDown, link };
  }
  /** ¿Puede atacar? Tu turno (o el suyo), Fase de Batalla, turno > 1, boca arriba en Ataque en una Zona de Monstruo,
   * no atacó este turno y su texto no dice "This card cannot attack." → { ok, why } */
  function canAttack(S, side, uid) {
    const no = (why) => ({ ok: false, why });
    side = side === 'rival' ? 'rival' : 'me';
    if (S.vs && S.vs.over) return no('El duelo terminó.');
    const t = S.turnState || {};
    const mine = t.mine !== false;
    if ((side === 'me') !== mine) return no(side === 'me' ? 'Es el turno del rival.' : 'Es tu turno.');
    if (t.phase !== 'battle') return no('Solo se ataca en la Fase de Batalla.');
    if ((Number(t.turn) || 1) <= 1) return no('En el primer turno del Duelo no hay Fase de Batalla.');
    const at = onFieldOf(S, side, uid);
    if (!at || !MON.includes(at.zone) || (side === 'rival' && !isMonsterEntry(at.inst))) return no('Solo atacan los monstruos en una Zona de Monstruo.');
    const inst = at.inst;
    if (inst.faceDown) return no('Un monstruo boca abajo no puede atacar.');
    if (stats(S, side, inst).pos !== 'atk') return no('Solo atacan los monstruos en posición de Ataque.');
    if (inst.attackedTurn != null && Number(inst.attackedTurn) === turnOf(S)) return no('Ya atacó este turno.');
    if (CANNOT_ATTACK.test((cardOf(inst) || {}).desc || '')) return no('Su texto dice que no puede atacar.');
    return { ok: true, why: '' };
  }
  /** Monstruos que side puede atacar (los del otro) y si puede atacar directamente (el otro no controla monstruos). */
  function targets(S, side) {
    const out = { monsters: [], direct: false };
    if (side === 'rival') {
      for (const z of MON) { const x = topMine(S, z); if (x) out.monsters.push({ uid: x.uid, zone: z, hidden: !!x.faceDown }); }
      out.direct = !out.monsters.length;
    } else {
      const mons = monsters(S);
      for (const e of mons) if (MON.includes(e.zone)) out.monsters.push({ uid: e.uid, zone: e.zone, hidden: !!e.faceDown });
      out.direct = !mons.length;
    }
    return out;
  }
  const descOf = (x) => (cardOf(x) || {}).desc || '';
  const safeInBattle = (S, x, flipped) => (!x.faceDown || flipped) && !negatedNow(S, x) && NO_BATTLE_DESTROY.test(descOf(x));
  const combatText = (x) => COMBAT_TEXT.test(descOf(x).replace(NO_BATTLE_DESTROY_G, ' '));
  /** Cálculo de daño (puro, no cambia S). req = { side: 'me'|'rival' (quien ataca), attacker: uid, target: uid | null }.
   * → { ok, gone?, side, attacker: { uid, name, atk }, target: null | { uid, name, pos, value, flip }, destroy: [{ side, uid }],
   *   damage: { me, rival }, warn: [cardId], lines: [texto] } */
  function battle(S, req) {
    req = req || {};
    const side = req.side === 'rival' ? 'rival' : 'me';
    const other = side === 'me' ? 'rival' : 'me';
    const res = { ok: true, side, attacker: null, target: null, destroy: [], damage: { me: 0, rival: 0 }, warn: [], lines: [] };
    const at = onFieldOf(S, side, req.attacker);
    if (!at || !MON.includes(at.zone)) { res.ok = false; res.gone = 'attacker'; return res; }
    const a = at.inst;
    const as = stats(S, side, a);
    res.attacker = { uid: a.uid, name: nameOf(a), atk: as.atk };
    const tag = (s, x) => (s === 'me' ? 'Tu ' + q(nameOf(x)) : q(nameOf(x)) + ' del rival');
    const warnOf = (x) => { if (combatText(x) && !res.warn.includes(Number(x.id))) res.warn.push(Number(x.id)); };
    if (!req.target) {
      res.damage[other] = as.atk;
      warnOf(a);
      return res;
    }
    const tt = onFieldOf(S, other, req.target);
    if (!tt || !MON.includes(tt.zone)) { res.ok = false; res.gone = 'target'; return res; }
    const t = tt.inst;
    const flipped = !!t.faceDown;
    const ts = stats(S, other, Object.assign({}, t, { faceDown: false }));
    const pos = t.faceDown || t.def ? (ts.link ? 'atk' : 'def') : 'atk';
    const value = pos === 'atk' ? ts.atk : ts.def;
    res.target = { uid: t.uid, name: nameOf(t), pos, value, flip: flipped };
    if (flipped) res.lines.push((other === 'me' ? 'Se voltea tu ' + q(nameOf(t)) : 'Se voltea ' + q(nameOf(t)) + ' del rival') + ' (' + statLine(S, other, t) + ').');
    const kill = (s, x, flippedNow) => {
      if (safeInBattle(S, x, flippedNow)) res.lines.push(tag(s, x) + ' no se destruye en batalla (lo dice su texto).');
      else res.destroy.push({ side: s, uid: x.uid });
    };
    const A = as.atk;
    if (pos === 'atk') {
      if (A > value) { kill(other, t, flipped); res.damage[other] = A - value; }
      else if (A === value) {
        if (A > 0) { kill(other, t, flipped); kill(side, a, false); } else res.lines.push('Ninguno se destruye (0 contra 0).');
      } else { kill(side, a, false); res.damage[side] = value - A; }
    } else if (A > value) kill(other, t, flipped);
    else if (A < value) res.damage[side] = value - A;
    else res.lines.push('ATK igual a la DEF: ninguno se destruye.');
    warnOf(a);
    warnOf(t);
    return res;
  }
  /** Aplica el resultado de battle(): voltea, destruye (los tuyos con leaveMine = port.leaveField; los suyos con leave),
   * aplica el daño, marca attackedTurn y avisa (una vez por carta y duelo) de los textos de combate.
   * → { lines: [todo lo que pasó, incluidas las de result.lines], ops } */
  function applyBattle(S, res, opts) {
    const lines = arr(res && res.lines).slice();
    const ops = [];
    if (!res || res.ok === false || !res.attacker) return { lines, ops };
    const side = res.side === 'rival' ? 'rival' : 'me';
    const other = side === 'me' ? 'rival' : 'me';
    const leaveMine = opts && typeof opts.leaveMine === 'function' ? opts.leaveMine : null;
    const turn = turnOf(S);
    const names = {};
    if (res.target && res.target.flip) {
      const tt = onFieldOf(S, other, res.target.uid);
      if (tt) tt.inst.faceDown = false;
      if (tt && other === 'rival') out(S, { op: 'flip', uid: res.target.uid });
    }
    const at = onFieldOf(S, side, res.attacker.uid);
    if (at) at.inst.attackedTurn = turn;
    if (at) names[at.inst.id] = nameOf(at.inst);
    if (res.target) { const tt = onFieldOf(S, other, res.target.uid); if (tt) names[tt.inst.id] = nameOf(tt.inst); }
    for (const d of arr(res.destroy)) {
      if (d.side === 'rival') {
        const r = leave(S, d.uid, 'battle');
        if (r.text) lines.push(r.text);
        ops.push(...arr(r.ops));
      } else {
        const mine = onFieldOf(S, 'me', d.uid);
        if (!mine) continue;
        const name = q(nameOf(mine.inst));
        const went = leaveMine ? leaveMine(d.uid) : null;
        const tail = { gy: ' y va a tu Cementerio', ban: ' y queda desterrado', extra: ' y va boca arriba a tu Extra Deck', opp: ' y vuelve al rival' }[went] || '';
        lines.push('Tu ' + name + ' es destruido en batalla' + tail + '.');
      }
    }
    for (const s of ['me', 'rival']) if (res.damage && res.damage[s] > 0) lines.push(damage(S, s, res.damage[s], 'battle').text);
    if (S.vs) {
      if (!S.vs.warned || typeof S.vs.warned !== 'object') S.vs.warned = {};
      for (const id of arr(res.warn)) {
        if (S.vs.warned[id]) continue;
        S.vs.warned[id] = true;
        lines.push(q(names[id] || (db.get(id) || {}).name || '?') + ' tiene un efecto de combate que no se aplica solo: corrígelo a mano si hace falta.');
      }
    }
    sync(S);
    return { lines, ops };
  }

  /* ---------- LP y final ---------- */
  const lpOf = (S, side) => Number(side === 'rival' ? S.opp && S.opp.lp : S.lp) || 0;
  const putLp = (S, side, v) => { if (side === 'rival') S.opp.lp = v; else S.lp = v; };
  /** Daño (side 'me' = tú). why: 'battle' o la carta que lo hace. → { before, after, text } */
  function damage(S, side, n, why) {
    side = side === 'rival' ? 'rival' : 'me';
    n = Math.max(0, Math.round(Number(n) || 0));
    const before = lpOf(S, side);
    const after = Math.max(0, before - n);
    putLp(S, side, after);
    if (side === 'rival' && n) out(S, { op: 'damage', amount: n, battle: why === 'battle', by: why === 'battle' ? '' : String(why || '') });
    let text = '';
    if (n) {
      if (why === 'battle') text = 'Daño de batalla: ' + (side === 'me' ? 'recibes ' : 'el rival recibe ') + n + ' (LP ' + before + ' → ' + after + ').';
      else text = (side === 'me' ? 'Recibes ' : 'El rival recibe ') + n + ' de daño' + (why ? ' (por ' + byText(why) + ')' : '') + ': LP ' + before + ' → ' + after + '.';
    }
    return { before, after, text };
  }
  /** Ajustar LP a mano. → { before, after, text } */
  function setLp(S, side, v) {
    side = side === 'rival' ? 'rival' : 'me';
    const before = lpOf(S, side);
    const after = Math.max(0, Math.round(Number(v) || 0));
    putLp(S, side, after);
    // En línea: un cambio (no el valor), para no pisar lo que el rival haya cambiado a la vez
    if (side === 'rival' && after !== before) out(S, { op: 'lpDelta', delta: after - before });
    return { before, after, text: (side === 'me' ? 'Ajustas tus LP: ' : 'Ajustas los LP del rival: ') + before + ' → ' + after + ' (a mano).' };
  }
  /** El rival paga LP como costo (no puede pagar más de los que tiene). → { ok, before, after, text } */
  function pay(S, n, by) {
    n = Math.max(0, Math.round(Number(n) || 0));
    const before = lpOf(S, 'rival');
    if (n > before) return { ok: false, before, after: before, text: '', why: 'El rival no tiene LP suficientes para pagar ' + n + '.' };
    const after = before - n;
    putLp(S, 'rival', after);
    return { ok: true, before, after, text: n ? 'El rival paga ' + n + ' LP' + (by ? ' (por ' + byText(by) + ')' : '') + ': ' + before + ' → ' + after + '.' : '' };
  }
  /** S.vs.over, o el final por LP (los dos en 0: empate) sin guardarlo en S; null si el duelo sigue. */
  function result(S) {
    if (S.vs && S.vs.over) return S.vs.over;
    const me = lpOf(S, 'me'), rv = lpOf(S, 'rival');
    if (me > 0 && rv > 0) return null;
    return { winner: me <= 0 && rv <= 0 ? 'draw' : me <= 0 ? 'rival' : 'me', why: 'lp', turn: turnOf(S) };
  }

  /* ---------- Historial de duelos VS ---------- */
  function storage() { try { return window.localStorage || null; } catch (e) { return null; } }
  function readRecords() {
    try {
      const s = storage();
      const raw = s && s.getItem(REC_KEY);
      const d = raw ? JSON.parse(raw) : null;
      if (d && Array.isArray(d.games)) return { v: 1, games: d.games.filter((g) => g && typeof g === 'object') };
    } catch (e) { /* datos dañados: se empieza de nuevo */ }
    return { v: 1, games: [] };
  }
  /** Guarda el resultado (S.vs.over) en localStorage['simulador-yugioh:vs']; el mismo duelo (duelId) se actualiza. → la partida | null */
  function record(S, opts) {
    opts = opts || {};
    const over = S && S.vs && S.vs.over;
    if (!over) return null;
    const g = {
      at: Date.now(), duelId: S.duelId || 'vs-' + S.vs.seed, myDeckId: opts.myDeckId != null ? opts.myDeckId : null, myDeckName: opts.myDeckName || '',
      rivalId: S.vs.rival ? S.vs.rival.id : null, rivalName: S.vs.rival ? S.vs.rival.name : '', winner: over.winner, why: over.why,
      turns: Number(over.turn) || turnOf(S), first: S.vs.first, myLp: lpOf(S, 'me'), rivalLp: lpOf(S, 'rival'),
    };
    try {
      const d = readRecords();
      const i = d.games.findIndex((x) => x.duelId === g.duelId);
      if (i >= 0) d.games[i] = g; else d.games.push(g);
      if (d.games.length > REC_MAX) d.games = d.games.slice(-REC_MAX);
      const s = storage();
      if (s) s.setItem(REC_KEY, JSON.stringify({ v: 1, games: d.games }));
    } catch (e) { /* sin almacenamiento: el duelo sigue igual */ }
    S.vs.recorded = over.winner;
    return g;
  }
  /** Ganadas, perdidas y empates contra ese mazo (y con tu mazo, si se da). */
  function statsVs(myDeckId, rivalId) {
    const out = { won: 0, lost: 0, draw: 0 };
    for (const g of readRecords().games) {
      if (rivalId != null && String(g.rivalId) !== String(rivalId)) continue;
      if (myDeckId != null && String(g.myDeckId) !== String(myDeckId)) continue;
      if (g.winner === 'me') out.won++;
      else if (g.winner === 'rival') out.lost++;
      else if (g.winner === 'draw') out.draw++;
    }
    return out;
  }

  YGO.duel = {
    MZ, EMZ, ST, FIELD, MON,
    mirror, zoneLabel, isVs, isPvp, rand, shuffle,
    setup, tsOf, zonesOf, rivalView, withRival, findRival, entryAt, monsters, spellTraps, freeZone, isMonsterEntry,
    sync, publicSide, publicCard, isPublic, rivalName, moveText,
    draw, summon, set, activatePlace, leave, flip, position, negate, moveRival, place,
    stats, canAttack, targets, battle, applyBattle, damage, setLp, pay, result,
    record, statsVs,
  };
})();
