/* Rival del modo VS: decide y juega el turno del rival con su propio mazo. Lógica pura, sin DOM.
 * next(S) elige la próxima jugada; tu lado solo lo mira con YGO.duel.publicSide (nunca tu mano, tu Mazo, tu Extra Deck
 * ni tus cartas boca abajo). run(S, act) la hace con las primitivas de YGO.duel y solo si YGO.rules la da por buena sin
 * avisos. resolveLink(S, i) resuelve un eslabón del rival: lo suyo lo cambia con YGO.duel, lo tuyo vuelve como operaciones
 * (ops) que aplica field.js. consider/commit: sus Trampas colocadas conocidas (Mirror Force, Trap Hole, Solemn...) en tu turno.
 * Lo que recuerda vive en S.opp.ai (deshacer lo incluye); el azar sale de la semilla del duelo. Expone window.YGO.ai. */
(function () {
  const YGO = (window.YGO = window.YGO || {});
  const db = YGO.db;
  const T = db.T;
  const R = () => YGO.rules;
  const E = () => YGO.effects;
  const B = () => YGO.bot || {};
  const D = () => YGO.duel;
  const C = () => YGO.combos || null; // combos grabados (js/combos.js): sus líneas de Prueba, repetidas

  /* ---------- Constantes ---------- */
  const MZ = ['mz0', 'mz1', 'mz2', 'mz3', 'mz4'];
  const EMZ = ['emz0', 'emz1'];
  const MON = [...EMZ, ...MZ];
  const ST = ['st0', 'st1', 'st2', 'st3', 'st4'];
  const ZONES = [...MON, ...ST, 'fz'];
  const PILES = ['hand', 'deck', 'extra', 'gy', 'ban'];
  // Verbos que el rival sabe hacer solo (tribute, solo como costo) y los que de verdad hacen algo
  const AI_VERBS = ['add', 'addOrSS', 'ss', 'send', 'discard', 'draw', 'banish', 'destroy', 'returnHand', 'returnDeck', 'deckTop', 'set',
    'placeST', 'millTop', 'banishTop', 'payLP', 'lpGain', 'detach', 'position', 'reveal', 'target', 'tribute'];
  const PRODUCTIVE = AI_VERBS.filter((v) => !['reveal', 'target', 'payLP', 'tribute', 'position'].includes(v));
  const OPP_AREAS = ['oppField', 'oppGy', 'oppHand', 'oppDeck', 'oppExtra'];
  const REMOVAL = ['destroy', 'banish', 'returnHand', 'returnDeck', 'deckTop', 'send', 'position'];
  const TO_OWN = ['add', 'addOrSS', 'ss', 'set', 'placeST'];
  const MAX_STEPS = 40, MAX_EXTRA = 3, MAX_SETS = 2, BUDGET = 600, HAND_MAX = 6;
  const BURN = /inflict (\d+) (?:points of )?damage to your opponent/i; // "points of": textos viejos (Ookazi)
  const NEG_TEXT = /\bnegate (?:the |that |its )?(?:activation|effect)/i;
  const NEG_COND = /card or effect is activated|activates? (?:a|an) .*effect/i;
  const ASH = 'Ash Blossom & Joyous Spring', VEILER = 'Effect Veiler', IMPERM = 'Infinite Impermanence', DROLL = 'Droll & Lock Bird';
  const q = (n) => '«' + n + '»';
  const arr = (x) => (Array.isArray(x) ? x : []);
  const same = (a, b) => db.nameKey(String(a || '')) === db.nameKey(String(b || ''));
  const cardOf = (x) => (x && x.id ? db.get(x.id) : null);
  const nameById = (id) => { const c = db.get(id); return c ? c.name : '?'; };
  const isMon = (c) => !!(c && db.isMonster(c));
  const isHT = (c) => !!(c && typeof B().isHandtrap === 'function' && B().isHandtrap(c.name));
  const zoneIdx = (z) => { const i = ZONES.indexOf(z); return i < 0 ? 99 : i; };
  const lowerFirst = (s) => (/^El rival\b/.test(s) ? 'e' + s.slice(1) : s);
  const textOf = (r, fallback) => (r && typeof r.text === 'string' && r.text ? r.text : fallback);
  const ZONE_ES = (z) => (D() && D().zoneLabel ? D().zoneLabel(z) : z);

  /* ---------- Estado del rival ---------- */
  const isVs = (S) => {
    if (!D() || !S || !S.opp || !S.opp.vs) return false;
    try { return typeof D().isVs === 'function' ? !!D().isVs(S) : !!S.vs; } catch (e) { return false; }
  };
  const turnOf = (S) => Number(S && S.turnState && S.turnState.turn) || 1;
  /** S.opp.ai del turno actual (se reinicia al cambiar de turno). */
  function aiOf(S) {
    const o = S.opp;
    const t = turnOf(S);
    if (!o.ai || typeof o.ai !== 'object' || o.ai.turn !== t) o.ai = { turn: t, steps: 0, tried: {}, triggers: [], extraSummons: 0, sets: 0, fails: 0 };
    const ai = o.ai;
    if (!ai.tried || typeof ai.tried !== 'object') ai.tried = {};
    if (!Array.isArray(ai.triggers)) ai.triggers = [];
    return ai;
  }
  /** Contexto de una decisión: tu lado público, su estado del turno. */
  function ctxOf(S) {
    return { S, o: S.opp, t: D().tsOf(S), pub: D().publicSide(S), turn: turnOf(S), checks: 0 };
  }
  const view = (S, fn) => D().withRival(S, fn);
  /** Dónde está una carta del rival → { x, where: 'field'|'mat'|'hand'|'deck'|'extra'|'gy'|'ban', zone } | null */
  function locOf(S, uid) {
    let f = null;
    try { f = D().findRival(S, uid); } catch (e) { f = null; }
    if (!f) return null;
    const x = f.inst || (f.list && f.index != null ? f.list[f.index] : null);
    if (!x) return null;
    return { x, where: f.where, zone: f.zone || (f.where === 'field' ? x.zone : null) || null };
  }
  const fieldOf = (S) => arr(S.opp.field).filter(Boolean);
  const isMonEntry = (e) => !!(e && !e.onChain && !e.asSpell && MON.includes(e.zone) && isMon(cardOf(e)));
  const ownMonsters = (S) => fieldOf(S).filter(isMonEntry).sort(byZone);
  const entryAt = (S, z) => fieldOf(S).find((e) => e.zone === z) || null;
  const freeST = (S) => ST.filter((z) => !entryAt(S, z));
  const byZone = (a, b) => zoneIdx(a.zone) - zoneIdx(b.zone) || (Number(a.id) || 0) - (Number(b.id) || 0) || String(a.uid).localeCompare(String(b.uid));
  const statsOf = (S, e) => { try { return D().stats(S, 'rival', e) || {}; } catch (err) { const c = cardOf(e); return { atk: c ? c.atk : 0, def: c ? c.def : 0 }; } };
  const atkOf = (S, e) => Math.max(0, Number(statsOf(S, e).atk) || 0);
  const noDeckAdd = (cx) => arr(cx.t.locks).some((l) => l && l.kind === 'noDeckAdd');
  const lpOf = (S) => Number(S.opp.lp) || 0;
  /** Una carta por id (las copias de la mano valen lo mismo). */
  const uniqueById = (list) => { const seen = new Set(); return list.filter((x) => (x && !seen.has(x.id) ? (seen.add(x.id), true) : false)); };

  /* ---------- Tu lado (solo lo público) ---------- */
  /** Carta pública de una de tus cartas: boca abajo solo se sabe si es un monstruo o una Mágica/Trampa. */
  function pubCard(p) {
    if (p && !p.faceDown && p.id) return db.get(p.id) || null;
    return D().publicCard({ faceDown: true, zone: p && p.zone }, (p && p.zone) || 'st0');
  }
  function yourIn(cx, area) {
    const p = cx.pub;
    if (area === 'oppField') {
      return arr(p.monsters).map((m) => Object.assign({ mon: true }, m)).concat(arr(p.spells).map((s) => Object.assign({ mon: false }, s)));
    }
    if (area === 'oppGy') return arr(p.gy).map((g) => ({ uid: g.uid, id: g.id, zone: null, faceDown: false }));
    return [];
  }
  const yourName = (t) => (t.hidden || !t.id ? 'tu carta boca abajo' : 'tu ' + q(nameById(t.id)));
  const maxFaceUpAtk = (pub) => arr(pub.monsters).filter((m) => !m.faceDown).reduce((a, m) => Math.max(a, Number(m.atk) || 0), 0);
  const findYour = (cx, uid) => yourIn(cx, 'oppField').find((x) => x.uid === uid) || null;

  /* ---------- Condiciones ("If ...:") ---------- */
  const SUMMON_TRIG = /^If this card is ((?:(?:Normal|Special|Tribute|Flip|Synchro|Xyz|Link)\s+(?:or\s+|and\/or\s+)?)*)Summoned( to (?:your |the )?center Main Monster Zone)?(?:\s*\(except during the Damage Step\))?$/i;
  const GY_TRIG = /^If this card is sent to the (?:GY|Graveyard)$/i;
  /** Lee la condición → { k: 'always'|'main'|'in'|'noMon'|'noCards'|'oppMon'|'ctrl'|'summon'|'gy'|'never'|'unknown', ... } */
  function condKind(cond) {
    let s = String(cond || '').replace(/\s*\(Quick Effect\)/gi, '').trim().replace(/[.,:;\s]+$/, '');
    if (!s) return { k: 'always' };
    if (/^(?:Once per turn|Once while face-up on the field)$/i.test(s)) return { k: 'always' };
    if (/^When\b/i.test(s)) return { k: 'never' };
    s = s.replace(/^Once per turn,\s*/i, '');
    let m = s.match(SUMMON_TRIG);
    if (m) return { k: 'summon', methods: (m[1].match(/Normal|Special|Tribute|Flip|Synchro|Xyz|Link/gi) || []).map((w) => w.toLowerCase()), center: !!m[2] };
    if (GY_TRIG.test(s)) return { k: 'gy' };
    const parts = s.split(/,\s*(?=(?:if|during)\b)/i);
    const out = [];
    for (const p0 of parts) {
      const p = p0.trim();
      if (/^During your Main Phase$/i.test(p)) out.push({ k: 'main' });
      else if ((m = p.match(/^If this card is in your (hand|GY|Graveyard)$/i))) out.push({ k: 'in', where: /hand/i.test(m[1]) ? 'hand' : 'gy' });
      else if ((m = p.match(/^If you control no monsters( in your Main Monster Zone)?$/i))) out.push({ k: 'noMon', main: !!m[1] });
      else if ((m = p.match(/^If you control no (cards|face-up cards)$/i))) out.push({ k: 'noCards', faceUp: /face-up/i.test(m[1]) });
      else if ((m = p.match(/^If your opponent controls (a|more) monsters?( than you)?$/i))) out.push({ k: 'oppMon', more: m[1].toLowerCase() === 'more' });
      else if ((m = p.match(/^If you control an? "([^"]+)" (card|monster)$/i))) out.push({ k: 'ctrl', name: m[1], monster: m[2].toLowerCase() === 'monster' });
      else return { k: 'unknown' };
    }
    return out.length === 1 ? out[0] : { k: 'all', parts: out };
  }
  /** ¿El método de invocación (summonMethod) cumple "If this card is X or Y Summoned"? */
  function methodFits(methods, method) {
    const m = String(method || '').toLowerCase();
    if (!m || m === 'set' || m === 'tributeset') return false;
    if (!methods || !methods.length) return true;
    return methods.some((w) => (w === 'normal' ? m === 'normal' || m === 'tribute' : w === 'special' ? !['normal', 'tribute', 'flip'].includes(m) : w === m));
  }
  /** ¿Se cumple la condición ahora? L: dónde está la carta; trig: { type: 'summon'|'gy', method } solo desde la cola. */
  function condOk(cx, ck, L, trig) {
    const S = cx.S;
    switch (ck.k) {
      case 'always': return true;
      case 'all': return ck.parts.every((p) => condOk(cx, p, L, trig));
      case 'main': return cx.t.mine !== false && (cx.t.phase === 'main1' || cx.t.phase === 'main2');
      case 'in': return L.where === ck.where;
      case 'noMon': return !ownMonsters(S).some((e) => !ck.main || MZ.includes(e.zone));
      case 'noCards': return !fieldOf(S).some((e) => e.uid !== L.x.uid && (!ck.faceUp || !e.faceDown));
      case 'oppMon': return ck.more ? arr(cx.pub.monsters).length > ownMonsters(S).length : arr(cx.pub.monsters).length > 0;
      case 'ctrl': return fieldOf(S).some((e) => {
        if (e.faceDown) return false;
        const c = cardOf(e);
        if (!c || (ck.monster && !isMonEntry(e))) return false;
        return String(c.name).toLowerCase().includes(ck.name.toLowerCase());
      });
      case 'summon': return !!(trig && trig.type === 'summon' && methodFits(ck.methods, trig.method) && L.where === 'field' && !L.x.faceDown && (!ck.center || L.zone === 'mz2'));
      case 'gy': return !!(trig && trig.type === 'gy' && L.where === 'gy');
      default: return false;
    }
  }

  /* ---------- Planes (lo que hace el efecto) ---------- */
  const listsOf = (plan, opt) => ({
    cost: arr(plan.cost).concat(opt ? arr(opt.cost) : []),
    targets: arr(plan.targets).concat(opt ? arr(opt.targets) : []),
    actions: arr(plan.actions).concat(opt ? arr(opt.actions) : []),
    notes: arr(plan.notes).concat(opt ? arr(opt.notes) : []),
  });
  const burnOf = (notes) => notes.reduce((a, n) => { const m = n && n.kind === 'opp' && BURN.exec(n.text || ''); return a + (m ? Number(m[1]) : 0); }, 0);
  /** Motivo por el que el rival no puede hacer este plan solo (o null). */
  function planIssue(plan, opt) {
    const L = listsOf(plan, opt);
    const all = L.cost.concat(L.targets, L.actions);
    for (const x of all) {
      if (!x || x.verb === 'manual' || x.verb === 'procSummon') return 'manual';
      if (!AI_VERBS.includes(x.verb)) return 'verb';
      if (x.condition) return 'condition';
    }
    if (L.actions.some((a) => a.verb === 'tribute' || a.verb === 'target')) return 'verb';
    for (const x of all) {
      const from = arr(x.from);
      if (from.some((a) => a === 'oppHand' || a === 'oppDeck' || a === 'oppExtra')) return 'area';
      if (from.includes('oppGy')) {
        const verbs = x.verb === 'target' ? L.actions.filter((a) => a.refers === 'targets').map((a) => a.verb) : [x.verb];
        if (!verbs.length || verbs.some((v) => !['banish', 'returnDeck', 'returnHand'].includes(v))) return 'area';
      }
    }
    if (!L.actions.some((a) => PRODUCTIVE.includes(a.verb)) && !burnOf(L.notes)) return 'empty';
    return null;
  }
  const verbsOf = (plan) => {
    const out = arr(plan.actions).map((a) => a.verb);
    for (const o of arr(plan.options)) arr(o.actions).forEach((a) => out.push(a.verb));
    return out;
  };

  /* ---------- Cartas conocidas: Trampas colocadas que responden en tu turno ---------- */
  const KNOWN_NAMES = ['Mirror Force', 'Sakuretsu Armor', 'Dimensional Prison', 'Trap Hole', 'Bottomless Trap Hole', 'Torrential Tribute',
    'Solemn Warning', 'Solemn Strike', 'Solemn Judgment', 'Compulsory Evacuation Device', IMPERM];
  const knownName = (c) => (c ? KNOWN_NAMES.find((n) => same(n, c.name)) || null : null);

  /* ---------- Lo que se sabe de cada carta (sin mirar el estado) ---------- */
  const infoCache = new Map();
  function infoOf(c) {
    if (!c) return { effs: [], usable: false, searchSS: false, fieldIgn: false };
    const hit = infoCache.get(c.id);
    if (hit) return hit;
    const effs = [];
    for (const e of R().effectsOf(c)) {
      if (!e.index || e.kind === 'continuous' || e.kind === 'summon' || e.scale || e.pendulum) continue;
      let plan = null;
      try { plan = E().parse(c, e); } catch (err) { plan = null; }
      const ck = condKind(e.condition);
      const full = !!(plan && !plan.passive && plan.confidence === 'full');
      const okPlan = full && (plan.options && plan.options.length ? plan.options.some((o) => !planIssue(plan, o)) : !planIssue(plan, null));
      effs.push({ e, plan, ck, ok: okPlan && ck.k !== 'never' && ck.k !== 'unknown', mandatory: !/\byou can\b/i.test(e.text || '') });
    }
    const own = !isHT(c) && !knownName(c);
    const inf = {
      effs,
      usable: own && effs.some((x) => x.ok),
      searchSS: own && effs.some((x) => x.ok && verbsOf(x.plan).some((v) => v === 'add' || v === 'addOrSS' || v === 'ss')),
      fieldIgn: own && effs.some((x) => x.ok && (x.e.kind === 'ignition' || x.e.kind === 'quick') && arr(x.e.where).includes('field')),
    };
    infoCache.set(c.id, inf);
    return inf;
  }
  const sumTrig = (c, method) => infoOf(c).effs.some((x) => x.ok && x.ck.k === 'summon' && methodFits(x.ck.methods, method));
  const gyBenefit = (c) => !!(c && /is sent to the (?:GY|Graveyard)|If this card is in your (?:GY|Graveyard)/i.test(c.desc || ''));
  const nsAble = (c) => isMon(c) && !db.isExtra(c) && c.lv <= 4 && !(c.type & (T.RITUAL | T.TOKEN)) && !/cannot be Normal Summoned/i.test(c.desc || '');

  /** Cuánto vale una carta para el rival (para elegir qué buscar, descartar o sacrificar). */
  function value(c, cx, uid) {
    if (!c) return 0;
    let v;
    if (isHT(c)) v = 90;
    else {
      const inf = infoOf(c);
      if (inf.searchSS) v = 70;
      else if (isMon(c)) v = Math.min(60, Math.max(0, Number(c.atk) || 0) / 50);
      else v = inf.usable ? 50 : 20;
    }
    if (cx) v -= 10 * arr(cx.o.hand).filter((x) => x && x.uid !== uid && Number(x.id) === Number(c.id)).length;
    return v;
  }
  /** Valor de un monstruo en el campo (para Invocar desde el Extra Deck): ATK/100 + 30 con efecto al ser Invocado + 10 con efectos en el campo. */
  const fieldValue = (c, atk, method) => (Math.max(0, atk == null ? Number(c.atk) || 0 : atk) / 100) + (sumTrig(c, method || 'special') ? 30 : 0) + (infoOf(c).fieldIgn ? 10 : 0);

  /* ---------- Candidatas de una acción ---------- */
  /** Sus cartas en un lugar (en sus propias palabras: "you" = el rival). */
  function ownIn(S, area) {
    const o = S.opp;
    const pile = (k) => arr(o[k]).filter(Boolean).map((x) => ({ x, where: k, zone: null }));
    switch (area) {
      case 'hand': case 'deck': case 'gy': case 'ban': case 'extra': return pile(area);
      case 'extraUp': return pile('extra').filter((it) => it.x.extraFaceUp);
      case 'field': return fieldOf(S).filter((e) => e.zone).map((e) => ({ x: e, where: 'field', zone: e.zone }));
      case 'fieldUp': return ownIn(S, 'field').filter((it) => !it.x.faceDown);
      case 'mzone': return ownIn(S, 'field').filter((it) => MON.includes(it.zone));
      case 'stzone': return ownIn(S, 'field').filter((it) => ST.includes(it.zone));
      case 'pzone': return ownIn(S, 'field').filter((it) => (it.zone === 'st0' || it.zone === 'st4') && isMon(cardOf(it.x)));
      default: return [];
    }
  }
  /** → [{ mine, uid, card, x?, where?, zone, hidden, id, area, atk? }] */
  function candidates(cx, a, opts) {
    opts = opts || {};
    const out = [];
    const seen = new Set();
    const ctx = { selfUid: opts.self || null, costCards: opts.costCards || [], targetCards: opts.targetCards || [] };
    const from = arr(a.from).length ? arr(a.from) : a.verb === 'discard' || a.verb === 'reveal' ? ['hand'] : a.verb === 'tribute' ? ['field'] : [];
    for (const area of from) {
      if (OPP_AREAS.includes(area)) {
        for (const it of yourIn(cx, area)) {
          if (seen.has(it.uid)) continue;
          const card = pubCard(it);
          if (!card) continue;
          const inst = { uid: it.uid, faceDown: !!it.faceDown, def: !!it.def };
          if (typeof it.level === 'number' && !it.faceDown) inst.level = it.level;
          if (!E().match(card, a.filter, Object.assign({ inst, area }, ctx))) continue;
          seen.add(it.uid);
          out.push({ mine: false, uid: it.uid, card, zone: it.zone || null, hidden: !!it.faceDown, id: it.faceDown ? 0 : Number(it.id) || 0, area, mon: !!it.mon, atk: Number(it.atk) || 0, def: !!it.def });
        }
        continue;
      }
      for (const it of ownIn(cx.S, area)) {
        const u = it.x.uid;
        if (seen.has(u) || (opts.exclude && opts.exclude.has(u))) continue;
        if (opts.noSelf && u === opts.self) continue;
        const card = cardOf(it.x);
        if (!card) continue;
        if (a.verb === 'tribute' && !isMonEntry(it.x)) continue;
        if (!E().match(card, a.filter, Object.assign({ inst: it.x, area }, ctx))) continue;
        seen.add(u);
        out.push({ mine: true, uid: u, card, x: it.x, where: it.where, zone: it.zone, area, id: card.id });
      }
    }
    // Al Mazo con Droll & Lock Bird: no se añaden cartas del Mazo
    if ((a.verb === 'add' || opts.adding) && noDeckAdd(cx)) return out.filter((x) => !(x.mine && x.where === 'deck'));
    return out;
  }
  const tieBreak = (a, b) => zoneIdx(a.zone) - zoneIdx(b.zone) || (Number(a.id) || 0) - (Number(b.id) || 0) || String(a.uid).localeCompare(String(b.uid));
  /** Ordena las candidatas según para qué son (la primera es la elegida). */
  function sortFor(cx, list, purpose) {
    const S = cx.S;
    const v = (x) => value(x.card, cx, x.uid);
    const L = list.slice();
    const yours = (x) => (x.mine ? 1 : 0);
    const removal = (a, b) => yours(a) - yours(b)
      || (a.mine ? 0 : (a.hidden ? 2 : a.mon ? 0 : 1) - (b.hidden ? 2 : b.mon ? 0 : 1))
      || (b.mon && !b.hidden ? b.atk : 0) - (a.mon && !a.hidden ? a.atk : 0) || tieBreak(a, b);
    const cmp = {
      remove: removal,
      cost: (a, b) => (isHT(a.card) ? 1 : 0) - (isHT(b.card) ? 1 : 0) || (a.where === 'gy' ? 0 : 1) - (b.where === 'gy' ? 0 : 1) || v(a) - v(b) || tieBreak(a, b),
      add: (a, b) => {
        const inHand = (x) => (arr(cx.o.hand).some((h) => h && h.uid !== x.uid && same(nameById(h.id), x.card.name)) ? 1 : 0);
        const ns = (x) => ((cx.t.normalSummons || 0) === 0 && nsAble(x.card) ? 0 : 1);
        return inHand(a) - inHand(b) || ns(a) - ns(b) || v(b) - v(a) || tieBreak(a, b);
      },
      ss: (a, b) => (sumTrig(b.card, 'special') ? 1 : 0) - (sumTrig(a.card, 'special') ? 1 : 0) || (Number(b.card.atk) || 0) - (Number(a.card.atk) || 0) || tieBreak(a, b),
      send: (a, b) => (gyBenefit(b.card) ? 1 : 0) - (gyBenefit(a.card) ? 1 : 0) || v(a) - v(b) || tieBreak(a, b),
      best: (a, b) => v(b) - v(a) || (Number(b.card.atk) || 0) - (Number(a.card.atk) || 0) || tieBreak(a, b),
      tribute: (a, b) => atkOf(S, a.x) - atkOf(S, b.x) || v(a) - v(b) || tieBreak(a, b),
    }[purpose] || tieBreak;
    return L.sort(cmp);
  }
  /** Para qué es un objetivo: según lo que le pasa después ("destroy that target", "add it to your hand"). */
  function targetPurpose(t, actions) {
    const uses = actions.filter((a) => a.refers === 'targets').map((a) => a.verb);
    if (uses.some((v) => TO_OWN.includes(v))) return 'best';
    if (!t.owner) return uses.includes('send') ? 'send' : 'cost';
    return 'remove';
  }
  /** Para elegir objetivos para quitar: solo tus cartas (no se quita las suyas con un objetivo). */
  const pickable = (purpose, list) => (purpose === 'remove' ? list.filter((x) => !x.mine) : purpose === 'best' || purpose === 'send' || purpose === 'cost' ? list.filter((x) => x.mine) : list);
  const need = (a) => (!a || !a.count ? 1 : a.count.all ? 1 : Math.max(1, Number(a.count.min) || 0));
  const want = (a) => (!a || !a.count ? 1 : a.count.all ? Infinity : Math.max(Number(a.count.min) || 0, Number(a.count.max) || 0));

  /* ---------- ¿Se puede pagar? ¿Hace algo? ---------- */
  /** rules.checkSummon en la vista del rival, con el presupuesto de la decisión (600 revisiones). Sin zona legal: no. → ok sin avisos */
  function summonCheck(cx, req) {
    if (cx.checks >= BUDGET || req.noZone) return false;
    const L = locOf(cx.S, req.uid);
    if (!L) return false;
    let v = null;
    try {
      v = view(cx.S, (vw) => {
        if (!req.zone) {
          const zones = R().legalZones(vw, req.uid, { from: L.where, vacating: arr(req.materials), method: req.method });
          if (!zones.length) return null;
          req = Object.assign({}, req, { zone: zones[0] });
        }
        cx.checks++;
        return R().checkSummon(vw, req);
      });
    } catch (err) { v = null; }
    return !!(v && v.ok && !arr(v.warnings).length);
  }
  /** ¿Puede Invocar de modo Especial esta carta suya con este efecto (sin avisos)? */
  const canSS = (cx, uid, c, e, extra) => summonCheck(cx, Object.assign({ uid, method: 'special', position: 'atk', materials: [], source: q(c.name) }, extra || {}));
  function costFeasible(cx, a, L, used) {
    const S = cx.S;
    const self = L.x.uid;
    const n = need(a);
    if (a.refers === 'this') {
      if (a.verb === 'discard' || a.verb === 'reveal') return L.where === 'hand';
      if (a.verb === 'tribute') return L.where === 'field';
      if (a.verb === 'detach') return arr(L.x.mats).length >= n;
      used.add(self);
      return true;
    }
    if (a.refers) return false;
    switch (a.verb) {
      case 'payLP': return a.lp === 'half' ? lpOf(S) > 1 : lpOf(S) > Number(a.lp);
      case 'banishTop': case 'millTop': return arr(S.opp.deck).length >= n;
      case 'detach': {
        if (a.host === 'this') return arr(L.x.mats).length >= n;
        return ownMonsters(S).some((e) => arr(e.mats).length >= n);
      }
      case 'position': return false;
      default: {
        const list = candidates(cx, a, { self, noSelf: true, exclude: used });
        if (list.length < n) return false;
        sortFor(cx, list, a.verb === 'tribute' ? 'tribute' : 'cost').slice(0, n).forEach((x) => used.add(x.uid));
        return true;
      }
    }
  }
  function actionFeasible(cx, a, L, c, e, used) {
    const S = cx.S;
    const self = L.x.uid;
    if (a.refers === 'this') {
      if (a.verb === 'ss') return L.where !== 'field' && canSS(cx, self, c, e, ssReq(cx, c, a));
      if (a.verb === 'add') return L.where !== 'hand' && !(L.where === 'deck' && noDeckAdd(cx));
      return true;
    }
    if (a.refers) return true;
    switch (a.verb) {
      case 'draw': return arr(S.opp.deck).length >= need(a);
      case 'millTop': case 'banishTop': return arr(S.opp.deck).length >= need(a);
      case 'payLP': return a.lp === 'half' || lpOf(S) > Number(a.lp);
      case 'lpGain': case 'reveal': case 'position': return true;
      case 'detach': return a.host === 'this' ? arr(L.x.mats).length >= need(a) : ownMonsters(S).some((x) => arr(x.mats).length >= need(a));
      default: break;
    }
    let list = candidates(cx, a, { self, noSelf: true, exclude: used, adding: a.verb === 'addOrSS' });
    if (a.verb === 'set' || a.verb === 'placeST') {
      if (!freeST(S).length) return false;
      list = list.filter((x) => x.mine && !isMon(x.card) && !(x.card.type & T.FIELD));
    }
    if (a.verb === 'ss') {
      let ok = 0;
      for (const x of sortFor(cx, list.filter((y) => y.mine && y.where !== 'field'), 'ss')) {
        if (canSS(cx, x.uid, c, e, ssReq(cx, x.card, a))) ok++;
        if (ok >= need(a)) return true;
      }
      return false;
    }
    if (a.verb === 'add' || a.verb === 'addOrSS') list = list.filter((x) => x.mine && x.where !== 'hand');
    // Quitar algo "de tu campo" (owner any): con count "all" basta con que haya algo; con N, que haya N tuyas o suyas
    return list.length >= need(a);
  }
  function feasible(cx, L, c, e, plan, opt) {
    const Ls = listsOf(plan, opt);
    const used = new Set();
    for (const a of Ls.cost) if (!costFeasible(cx, a, L, used)) return false;
    for (const t of Ls.targets) {
      const purpose = targetPurpose(t, Ls.actions);
      const list = pickable(purpose, candidates(cx, t, { self: L.x.uid, noSelf: true, exclude: used }));
      if (list.length < need(t)) return false;
    }
    // Todas las que no son opcionales (también las que siguen a otra: "destroy it, and if you do, Special Summon...")
    for (const a of Ls.actions) {
      if (a.optional) continue;
      if (!actionFeasible(cx, a, L, c, e, used)) return false;
    }
    // Y al menos una que hace algo tiene que poder hacerse (o el daño)
    return !!burnOf(Ls.notes) || Ls.actions.some((a) => PRODUCTIVE.includes(a.verb) && actionFeasible(cx, a, L, c, e, new Set(used)));
  }

  /* ---------- Puntaje de un efecto ---------- */
  function scoreOf(cx, L, c, plan, opt) {
    const S = cx.S;
    const Ls = listsOf(plan, opt);
    let s = 0;
    const yourCount = (a, t) => {
      const src = t || a;
      return candidates(cx, Object.assign({}, src, { from: arr(src.from).filter((x) => OPP_AREAS.includes(x)) }), { self: L.x.uid }).length;
    };
    const ownCount = (a) => candidates(cx, Object.assign({}, a, { from: arr(a.from).filter((x) => !OPP_AREAS.includes(x)) }), { self: L.x.uid }).length;
    const nOf = (a) => (!a.count ? 1 : a.count.all ? 2 : Number(a.count.min) || (a.count.max ? 1 : 0));
    const tg = Ls.targets[0] || null;
    for (const a of Ls.actions) {
      let n = nOf(a);
      let onYou = OPP_AREAS.some((x) => arr(a.from).includes(x));
      let you = onYou ? yourCount(a) : 0;
      if (a.refers === 'targets' && tg) { n = nOf(tg); onYou = !!tg.owner; you = onYou ? yourCount(a, tg) : 0; }
      switch (a.verb) {
        case 'ss': s += 40 * n; break;
        case 'addOrSS': s += 38 * n; break;
        case 'add': s += 32 * n; break;
        case 'draw': s += 30 * n; break;
        case 'destroy': case 'banish': case 'returnDeck': case 'returnHand': {
          const w = { destroy: 25, banish: 28, returnDeck: 24, returnHand: 22 }[a.verb];
          if (onYou && you > 0) s += w * Math.min(n, a.count && a.count.all ? 2 : you);
          // "Destroy all monsters on the field": también se lleva lo suyo
          if (a.count && a.count.all && a.owner === 'any') s -= 10 * ownCount(a);
          break;
        }
        case 'send': if (arr(a.from).includes('deck')) s += 14 * n; break;
        case 'placeST': s += 12 * n; break;
        case 'set': s += 10 * n; break;
        case 'millTop': s += 6 * n; break;
        case 'lpGain': s += (Number(a.lp) || 0) / 1000; break;
        default: break;
      }
    }
    s += burnOf(Ls.notes) / 100;
    for (const a of Ls.cost) {
      const n = need(a);
      if (a.verb === 'discard') {
        const list = a.refers === 'this' ? [{ card: c }] : candidates(cx, a, { self: L.x.uid, noSelf: true });
        s -= n * (list.length && list.every((x) => isHT(x.card)) ? 20 : 8);
      } else if (a.verb === 'banish' && (a.refers === 'this' ? L.where === 'gy' : arr(a.from).includes('gy'))) s -= 2 * n;
      else if (a.verb === 'payLP') s -= (a.lp === 'half' ? lpOf(S) / 2 : Number(a.lp) || 0) / 400;
      else if (a.verb === 'tribute') {
        const list = a.refers === 'this' ? [{ x: L.x }] : sortFor(cx, candidates(cx, a, { self: L.x.uid, noSelf: true }), 'tribute');
        s -= n * ((list[0] && list[0].x ? atkOf(S, list[0].x) : 0) / 400 + 6);
      } else if (a.verb === 'detach') s -= 3 * n;
      else if (a.verb === 'send' && (a.refers === 'this' ? L.where === 'field' : arr(a.from).some((x) => /^(?:field|fieldUp|mzone|stzone)$/.test(x)))) s -= 10 * n;
    }
    return Math.round(s * 10) / 10;
  }

  /* ---------- ¿Puede usar este efecto ahora? ---------- */
  /** Evalúa el efecto idx de su carta uid. trig: { type: 'summon'|'gy', method } solo para los de la cola de triggers. */
  function evalEff(cx, uid, idx, trig) {
    const S = cx.S;
    const L = locOf(S, uid);
    if (!L || L.where === 'deck' || L.where === 'mat') return null;
    const c = cardOf(L.x);
    if (!c || isHT(c) || knownName(c)) return null;
    const e = R().effectsOf(c).find((x) => x.index === idx);
    if (!e || !idx || e.kind === 'continuous' || e.kind === 'summon' || e.scale || e.pendulum) return null;
    if (L.where === 'field' && L.x.faceDown && e.kind !== 'activation') return null;
    if (L.where === 'ban' && L.x.faceDown) return null;
    const neg = L.x.negated;
    if (neg && Number(neg.turn) === cx.turn) return null;
    if (typeof B().monsterLock === 'function') {
      try { if (B().monsterLock(S, c.id, L.where === 'field' ? 'field' : L.where)) return null; } catch (err) { /* sigue */ }
    }
    let plan;
    try { plan = E().parse(c, e); } catch (err) { return null; }
    if (!plan || plan.passive || plan.confidence !== 'full') return null;
    if (!condOk(cx, condKind(e.condition), L, trig)) return null;
    const ai = S.opp.ai && S.opp.ai.turn === cx.turn ? S.opp.ai : null;
    if (ai && ai.tried['activate:' + uid + ':' + idx]) return null;
    const opts = plan.options && plan.options.length ? plan.options.map((o, i) => i) : [null];
    let best = null;
    for (const oi of opts) {
      const opt = oi == null ? null : plan.options[oi];
      if (planIssue(plan, opt)) continue;
      if (!feasible(cx, L, c, e, plan, opt)) continue;
      const score = scoreOf(cx, L, c, plan, opt);
      if (!best || score > best.score) best = { option: oi, score };
    }
    if (!best) return null;
    let v = null;
    try { v = view(S, (vw) => R().checkActivation(vw, { uid, effectIndex: idx })); } catch (err) { v = null; }
    if (!v || !v.ok || arr(v.warnings).length) return null;
    return { c, e, plan, option: best.option, score: best.score, where: L.where, zone: L.zone, uid };
  }
  /** Efecto que el rival puede usar ahora → { c, e, plan, option, score } | null */
  function runnable(S, uid, effectIndex, trig) {
    if (!isVs(S)) return null;
    try { return evalEff(ctxOf(S), uid, Number(effectIndex), trig || null); } catch (err) { return null; }
  }

  /* ---------- Decidir (next) ---------- */
  const keyOf = (act) => act.kind + ':' + (act.uid || (act.uids ? act.uids.join(',') : '')) + ':' + (act.effectIndex != null ? act.effectIndex : act.method || act.to || '');
  const triedAct = (S, act) => !!(S.opp.ai && S.opp.ai.tried && S.opp.ai.tried[keyOf(act)]);
  const withKey = (act) => Object.assign(act, { key: keyOf(act) });
  function summonOk(cx, act) {
    const req = { uid: act.uid, method: act.method, materials: arr(act.materials).slice(), position: act.position };
    if (act.zone) req.zone = act.zone;
    if (act.ownProcedure) { req.ownProcedure = true; if (act.effectIndex != null) req.effectIndex = act.effectIndex; }
    return summonCheck(cx, req);
  }

  /** Efectos que puede usar ahora, del mejor al peor (min: puntaje mínimo). */
  function effectActs(cx, min) {
    const S = cx.S, o = cx.o;
    const out = [];
    const seenHand = new Set();
    const scan = (x, where) => {
      const c = cardOf(x);
      if (!c) return;
      if (where === 'hand') { if (seenHand.has(c.id)) return; seenHand.add(c.id); }
      const inf = infoOf(c);
      for (const it of inf.effs) {
        if (!it.ok || it.ck.k === 'summon' || it.ck.k === 'gy') continue;
        const r = evalEff(cx, x.uid, it.e.index, null);
        if (r && r.score >= min) out.push({ r, where, zone: x.zone || null, uid: x.uid, id: c.id });
      }
    };
    arr(o.hand).forEach((x) => x && scan(x, 'hand'));
    fieldOf(S).filter((e) => e.zone).sort(byZone).forEach((e) => scan(e, 'field'));
    arr(o.gy).forEach((x) => x && scan(x, 'gy'));
    arr(o.ban).forEach((x) => x && !x.faceDown && scan(x, 'ban'));
    const W = { hand: 0, field: 1, gy: 2, ban: 3 };
    out.sort((a, b) => b.r.score - a.r.score || W[a.where] - W[b.where] || zoneIdx(a.zone) - zoneIdx(b.zone) || a.id - b.id || String(a.uid).localeCompare(String(b.uid)));
    return out.map((x) => withKey({ kind: 'activate', uid: x.uid, effectIndex: x.r.e.index, score: x.r.score }));
  }

  /** 2a: la cola de efectos que se activan al Invocar o al ir al Cementerio (se saca de la cola la use o no). */
  function triggerAct(cx) {
    const ai = aiOf(cx.S);
    while (ai.triggers.length) {
      const tr = ai.triggers.shift();
      if (!tr || tr.turn !== cx.turn) continue;
      const L = locOf(cx.S, tr.uid);
      if (!L) continue;
      if (tr.type === 'summon' && !(L.where === 'field' && !L.x.faceDown)) continue;
      if (tr.type === 'gy' && L.where !== 'gy') continue;
      const c = cardOf(L.x);
      let note = '';
      for (const it of infoOf(c).effs) {
        if (tr.type === 'summon' ? !(it.ck.k === 'summon' && methodFits(it.ck.methods, tr.method)) : it.ck.k !== 'gy') continue;
        const trig = { type: tr.type, method: tr.method || null };
        const r = it.ok ? evalEff(cx, tr.uid, it.e.index, trig) : null;
        if (r) return withKey({ kind: 'activate', uid: tr.uid, effectIndex: it.e.index, trig, score: r.score });
        if (it.mandatory && !note) note = q(c.name) + ': su efecto obligatorio no se simula.';
      }
      if (note) return withKey({ kind: 'note', uid: tr.uid, text: note });
    }
    return null;
  }

  /** 2b: Mágica de Campo de la mano con la Zona de Campo libre. */
  function fieldSpellAct(cx) {
    const S = cx.S;
    if (entryAt(S, 'fz')) return null;
    for (const x of uniqueById(arr(cx.o.hand))) {
      const c = cardOf(x);
      if (!c || !db.isSpell(c) || !(c.type & T.FIELD)) continue;
      const effs = R().effectsOf(c).filter((e) => e.kind === 'activation');
      if (!effs.length) continue;
      // Si la activación hace algo que entiende, ese efecto; si no, la activación sola (efecto 0)
      let idx = null;
      for (const e of effs) if (e.index && evalEff(cx, x.uid, e.index, null)) { idx = e.index; break; }
      if (idx == null) {
        if (!effs.some((e) => e.index === 0)) continue;
        let v = null;
        try { v = view(S, (vw) => R().checkActivation(vw, { uid: x.uid, effectIndex: 0 })); } catch (err) { v = null; }
        if (!v || !v.ok || arr(v.warnings).length) continue;
        idx = 0;
      }
      const act = withKey({ kind: 'activate', uid: x.uid, effectIndex: idx, cardOnly: idx === 0 });
      if (!triedAct(S, act)) return act;
    }
    return null;
  }

  /** ¿Le queda un efecto de Ignición sin usar a este monstruo? (no lo sacrifica) */
  const unusedIgnition = (cx, e) => !e.faceDown && infoOf(cardOf(e)).effs.some((it) => it.ok && it.e.kind === 'ignition' && evalEff(cx, e.uid, it.e.index, null));
  /** 2d: Invocación Normal, por Sacrificio o Colocación. */
  function normalAct(cx) {
    const S = cx.S;
    if ((Number(cx.t.normalSummons) || 0) !== 0) return null;
    const top = maxFaceUpAtk(cx.pub);
    const mons = arr(cx.o.hand).filter((x) => { const c = cardOf(x); return c && isMon(c) && !db.isExtra(c) && !isHT(c) && !(c.type & (T.RITUAL | T.TOKEN)); });
    let best = null;
    const offer = (act, sc) => {
      if (triedAct(S, act) || !summonOk(cx, act)) return;
      if (!best || sc > best.sc) best = { act: withKey(act), sc };
    };
    for (const x of uniqueById(mons)) {
      const c = cardOf(x);
      if (c.lv > 4) continue;
      const set = (Number(c.atk) || 0) < top && (Number(c.def) || 0) > (Number(c.atk) || 0);
      const sc = value(c, cx, x.uid) + (!set && sumTrig(c, 'normal') ? 30 : 0) + (infoOf(c).fieldIgn ? 10 : 0) + Math.max(0, Number(c.atk) || 0) / 100;
      offer({ kind: 'summon', uid: x.uid, method: set ? 'set' : 'normal', materials: [], position: set ? 'set' : 'atk' }, sc);
    }
    const lowBest = best;
    best = null;
    const pool = ownMonsters(S).filter((e) => !unusedIgnition(cx, e)).map((e) => ({ x: e, uid: e.uid, zone: e.zone, id: e.id, card: cardOf(e) }));
    const sortedPool = sortFor(cx, pool, 'tribute');
    for (const x of uniqueById(mons)) {
      const c = cardOf(x);
      if (c.lv <= 4) continue;
      const n = c.lv <= 6 ? 1 : 2;
      const atk = Number(c.atk) || 0;
      if (atk < 2000 || sortedPool.length < n) continue;
      const mats = sortedPool.slice(0, n);
      const sum = mats.reduce((a, m) => a + atkOf(S, m.x), 0);
      if (!(atk > sum)) continue;
      const set = atk < top && (Number(c.def) || 0) > atk;
      const sc = value(c, cx, x.uid) + (!set && sumTrig(c, 'tribute') ? 30 : 0) + (infoOf(c).fieldIgn ? 10 : 0) + (atk - sum) / 100;
      offer({ kind: 'summon', uid: x.uid, method: set ? 'tributeSet' : 'tribute', materials: mats.map((m) => m.uid), position: set ? 'set' : 'atk' }, sc);
    }
    if (best && (!lowBest || best.sc > lowBest.sc)) return best.act;
    return lowBest ? lowBest.act : null;
  }

  /** 2e: su forma propia de Invocarse de modo Especial (sin costos y con una condición que entiende). */
  function procedureAct(cx) {
    const S = cx.S;
    const list = arr(cx.o.hand).map((x) => ({ x, where: 'hand' })).concat(arr(cx.o.gy).map((x) => ({ x, where: 'gy' })));
    const seen = new Set();
    for (const { x, where } of list) {
      const c = cardOf(x);
      if (!c || !isMon(c) || isHT(c) || seen.has(where + c.id)) continue;
      seen.add(where + c.id);
      const pr = R().procedureOf(c);
      if (!pr || pr.index == null || pr.costs || !arr(pr.from).includes(where)) continue;
      const m = String(pr.text || '').match(/^(.*?),?\s*you can Special Summon this card\b(.*)$/i);
      if (!m) continue;
      if (/\bby\b|\bTribut|\bsend|\bbanish/i.test(m[2])) continue;
      const head = m[1].replace(/^(?:Once per turn|You can only Special Summon[^.]*\.)\s*,?\s*/i, '').trim();
      if (head && !condOk(cx, condKind(head), { x, where, zone: null }, null)) continue;
      const act = { kind: 'summon', uid: x.uid, method: 'special', ownProcedure: true, effectIndex: pr.index, materials: [],
        position: /in (?:face-up )?Defense Position/i.test(m[2]) ? 'def' : 'atk' };
      if (pr.center) act.zone = 'mz2';
      if (triedAct(S, act) || !summonOk(cx, act)) continue;
      return withKey(act);
    }
    return null;
  }

  /** 2f: Invocación Link, Xyz o de Sincronía desde el Extra Deck (busca materiales entre sus monstruos boca arriba). */
  function extraAct(cx) {
    const S = cx.S;
    const ai = aiOf(S);
    if (ai.extraSummons >= MAX_EXTRA) return null;
    const mons = ownMonsters(S).filter((e) => !e.faceDown).map((e) => ({ e, c: cardOf(e), atk: atkOf(S, e) })).filter((m) => m.c);
    if (!mons.length) return null;
    // Como mucho 5 candidatos (los que menos valen)
    const cand = mons.slice().sort((a, b) => fieldValue(a.c, a.atk) - fieldValue(b.c, b.atk) || byZone(a.e, b.e)).slice(0, 5);
    let best = null;
    const ids = uniqueById(arr(cx.o.extra).filter((x) => x && !x.extraFaceUp));
    for (const x of ids) {
      const c = cardOf(x);
      if (!c || !isMon(c)) continue;
      const method = c.type & T.LINK ? 'link' : c.type & T.XYZ ? 'xyz' : c.type & T.SYNCHRO ? 'synchro' : null;
      if (!method) continue;
      const mat = R().parseMaterials(c);
      if (!mat || !mat.understood) continue;
      const minN = arr(mat.parts).reduce((a, p) => a + (Number(p.min) || 0), 0) || 1;
      const maxN = Math.min(5, arr(mat.parts).reduce((a, p) => a + (Number(p.max) || 0), 0) || 5);
      const gainBase = fieldValue(c, null, method);
      for (let mask = 1; mask < 1 << cand.length; mask++) {
        const sub = cand.filter((m, i) => mask & (1 << i));
        if (sub.length < minN || sub.length > maxN) continue;
        // Filtro rápido
        if (method === 'link') {
          if (sub.length > c.lv) continue;
          let sums = new Set([0]);
          for (const m of sub) { const nx = new Set(); for (const s of sums) { nx.add(s + 1); if (m.c.type & T.LINK) nx.add(s + m.c.lv); } sums = nx; }
          if (!sums.has(c.lv)) continue;
        } else if (method === 'xyz') {
          if (sub.some((m) => m.c.type & (T.XYZ | T.LINK) || (typeof m.e.level === 'number' ? m.e.level : m.c.lv) !== c.lv) || sub.some((m) => m.e.token)) continue;
        } else {
          const tuners = sub.filter((m) => m.c.type & T.TUNER).length;
          if (tuners !== 1 || sub.some((m) => m.c.type & (T.XYZ | T.LINK))) continue;
          if (sub.reduce((a, m) => a + (typeof m.e.level === 'number' ? m.e.level : m.c.lv), 0) !== c.lv) continue;
        }
        const gain = gainBase - sub.reduce((a, m) => a + fieldValue(m.c, m.atk), 0);
        if (!(gain > 5) || (best && gain <= best.gain)) continue;
        if (cx.checks >= BUDGET) break;
        const materials = sub.map((m) => m.e.uid);
        let zones = [];
        try { zones = view(S, (vw) => R().legalZones(vw, x.uid, { vacating: materials, from: 'extra' })); } catch (err) { zones = []; }
        if (!zones.length) continue;
        const zone = (method === 'link' && zones.find((z) => EMZ.includes(z))) || zones[0];
        const act = { kind: 'summon', uid: x.uid, method, materials, zone, position: 'atk' };
        if (triedAct(S, act)) continue;
        if (!summonCheck(cx, { uid: x.uid, method, materials: materials.slice(), zone })) continue;
        best = { act: withKey(act), gain };
      }
      if (cx.checks >= BUDGET) break;
    }
    return best ? best.act : null;
  }

  /** 2h: Invocación por Volteo y Defensa → Ataque. */
  function positionAct(cx) {
    const S = cx.S;
    const top = maxFaceUpAtk(cx.pub);
    for (const e of ownMonsters(S)) {
      if (!MZ.includes(e.zone) && !EMZ.includes(e.zone)) continue;
      const c = cardOf(e);
      const atk = atkOf(S, e);
      let act = null;
      if (e.faceDown) {
        const when = e.setTurn != null ? Number(e.setTurn) : Number(e.summonedTurn);
        if (Number.isFinite(when) && when < cx.turn && atk >= 1500) act = { kind: 'flip', uid: e.uid, to: 'atk' };
      } else if (e.def && !(c.type & T.LINK) && atk >= top && Number(e.attackedTurn) !== cx.turn) act = { kind: 'position', uid: e.uid, to: 'atk' };
      if (!act || triedAct(S, act)) continue;
      let v = null;
      try { v = view(S, (vw) => R().checkPosition(vw, e.uid, { to: 'atk' })); } catch (err) { v = null; }
      if (v && v.ok && !arr(v.warnings).length) return withKey(act);
    }
    return null;
  }

  /** 2i: Coloca Trampas y Mágicas Rápidas (2 por turno como mucho, deja una zona libre). */
  function setAct(cx) {
    const S = cx.S;
    const ai = aiOf(S);
    if (ai.sets >= MAX_SETS || freeST(S).length < 2) return null;
    const others = fieldOf(S).length > 0;
    const list = uniqueById(arr(cx.o.hand)).filter((x) => {
      const c = cardOf(x);
      if (!c || isMon(c)) return false;
      if (!(db.isTrap(c) || (db.isSpell(c) && c.type & T.QUICKPLAY))) return false;
      if (isHT(c)) return same(c.name, IMPERM) && others;
      return true;
    });
    list.sort((a, b) => (knownName(cardOf(a)) ? 0 : 1) - (knownName(cardOf(b)) ? 0 : 1) || (db.isTrap(cardOf(a)) ? 0 : 1) - (db.isTrap(cardOf(b)) ? 0 : 1) || a.id - b.id);
    for (const x of list) {
      const act = { kind: 'set', uid: x.uid };
      if (triedAct(S, act)) continue;
      let v = null;
      try { v = view(S, (vw) => R().checkSet(vw, x.uid)); } catch (err) { v = null; }
      if (v && v.ok && !arr(v.warnings).length) return withKey(act);
    }
    return null;
  }

  /** Batalla: el ataque más conveniente (solo con lo que ves de tu campo) → { kind: 'attack', attacker, target } | null */
  function chooseAttack(S) {
    if (!isVs(S)) return null;
    const cx = ctxOf(S);
    const mons = ownMonsters(S).filter((e) => !e.faceDown && !e.def).map((e) => ({ e, atk: atkOf(S, e) }))
      .filter((m) => { try { const r = D().canAttack(S, 'rival', m.e.uid); return !!(r && r.ok); } catch (err) { return false; } })
      .sort((a, b) => b.atk - a.atk || byZone(a.e, b.e));
    const yours = arr(cx.pub.monsters);
    for (const m of mons) {
      const act = (target) => withKey({ kind: 'attack', attacker: m.e.uid, target, uid: m.e.uid });
      if (!yours.length) { if (m.atk > 0) return act(null); continue; }
      const byZ = (a, b) => zoneIdx(a.zone) - zoneIdx(b.zone) || String(a.uid).localeCompare(String(b.uid));
      const atkT = yours.filter((y) => !y.faceDown && !y.def && (Number(y.atk) || 0) < m.atk).sort((a, b) => (Number(b.atk) || 0) - (Number(a.atk) || 0) || byZ(a, b));
      if (atkT.length) return act(atkT[0].uid);
      const defT = yours.filter((y) => !y.faceDown && y.def && (Number(y.defv) || 0) < m.atk).sort((a, b) => (Number(b.defv) || 0) - (Number(a.defv) || 0) || byZ(a, b));
      if (defT.length) return act(defT[0].uid);
      const down = yours.filter((y) => y.faceDown).sort(byZ);
      if (down.length && m.atk >= 1800) return act(down[0].uid);
    }
    return null;
  }

  /** Lo que descarta en la Fase Final (lo que menos vale; las handtraps se quedan). */
  function discardAct(cx) {
    const hand = arr(cx.o.hand).filter(Boolean);
    if (hand.length <= HAND_MAX) return null;
    const list = hand.map((x) => ({ x, uid: x.uid, id: x.id, card: cardOf(x), zone: null }))
      .sort((a, b) => (isHT(a.card) ? 1 : 0) - (isHT(b.card) ? 1 : 0) || value(a.card, cx, a.uid) - value(b.card, cx, b.uid) || tieBreak(a, b));
    return withKey({ kind: 'discard', uids: list.slice(0, hand.length - HAND_MAX).map((x) => x.uid) });
  }

  /** Próxima jugada del rival en su turno → act | null (null: no le toca, hay una cadena o una ventana abierta). */
  function next(S) {
    if (!isVs(S)) return null;
    if ((S.vs && (S.vs.over || S.vs.win)) || S.turnState.mine !== false || arr(S.chain).length) return null;
    const ai = aiOf(S);
    const act = decide(S, ai);
    if (act && act.kind !== 'script') ai.steps++; // (el combo grabado tiene su largo: no cuenta para MAX_STEPS)
    return act;
  }
  function decide(S, ai) {
    const cx = ctxOf(S);
    const phase = cx.t.phase || S.turnState.phase;
    if (ai.steps >= MAX_STEPS) { const d = discardAct(cx); return d && !triedAct(S, d) ? d : { kind: 'pass', key: 'pass::' }; }
    if (phase === 'draw') {
      if (cx.turn > 1 && ai.drew !== cx.turn) { ai.drew = cx.turn; return { kind: 'draw', key: 'draw::' }; }
      return { kind: 'phase', to: 'main1', key: 'phase::main1' };
    }
    if (phase === 'standby') return { kind: 'phase', to: 'main1', key: 'phase::main1' };
    if (phase === 'main1' || phase === 'main2') {
      // Primero, un combo grabado de su mazo (si su mano lo puede empezar); al terminar o cortarse sigue lo de siempre
      let sa = null;
      try { sa = C() && typeof C().nextAct === 'function' ? C().nextAct(S, ai) : null; } catch (err) { console.error('YGO.combos.nextAct falló', err); sa = null; }
      if (sa) return sa;
      const m1 = phase === 'main1';
      const steps = [
        () => triggerAct(cx),
        () => (m1 ? fieldSpellAct(cx) : null),
        () => effectActs(cx, 30)[0] || null,
        () => (m1 ? normalAct(cx) : null),
        () => (m1 ? procedureAct(cx) : null),
        () => extraAct(cx),
        () => effectActs(cx, 10)[0] || null,
        () => (m1 ? positionAct(cx) : null),
        () => setAct(cx),
      ];
      for (const f of steps) { const a = f(); if (a) return a; }
      if (m1) return cx.turn > 1 ? { kind: 'phase', to: 'battle', key: 'phase::battle' } : { kind: 'phase', to: 'end', key: 'phase::end' };
      return { kind: 'phase', to: 'end', key: 'phase::end' };
    }
    if (phase === 'battle') return chooseAttack(S) || { kind: 'phase', to: 'main2', key: 'phase::main2' };
    if (phase === 'end') { const d = discardAct(cx); return d && !triedAct(S, d) ? d : { kind: 'pass', key: 'pass::' }; }
    return { kind: 'phase', to: 'main1', key: 'phase::main1' };
  }

  /* ---------- Mover sus cartas (con YGO.duel) ---------- */
  /** Su carta sale de donde esté (campo o pila) → resultado de duel.leave ({ ok, refused?, went, text, ops }).
   * opts.top / opts.bottom: al Mazo arriba / abajo (duel.moveRival). */
  function move(S, uid, how, by, opts) {
    try {
      if (how === 'deck' && opts && (opts.top || opts.bottom)) return D().moveRival(S, uid, 'deck', { how: 'deck', by, top: !!opts.top, bottom: !!opts.bottom });
      return D().leave(S, uid, how, by);
    } catch (err) { return { ok: false, text: '' }; }
  }
  /** ¿Dónde quedó? (para la cola de triggers "If this card is sent to the GY") */
  const wentOf = (S, uid, r) => (r && r.went) || (() => { const L = locOf(S, uid); return L ? L.where : null; })();
  /** Anota en la cola un efecto que se activa al Invocar o al ir al Cementerio (solo en su turno). */
  function pushTrigger(S, uid, type, method) {
    if (!S.turnState || S.turnState.mine !== false) return;
    const L = locOf(S, uid);
    const c = L && cardOf(L.x);
    if (!c) return;
    const has = infoOf(c).effs.some((it) => (type === 'summon' ? it.ck.k === 'summon' && methodFits(it.ck.methods, method) : it.ck.k === 'gy'));
    if (!has) return;
    aiOf(S).triggers.push({ uid, id: c.id, type, method: method || null, turn: turnOf(S) });
  }
  const afterMove = (S, uid, r) => { if (wentOf(S, uid, r) === 'gy') pushTrigger(S, uid, 'gy'); };

  /* ---------- Hacer la jugada (run) ---------- */
  function fail(S, act, why) {
    try { aiOf(S).tried[act.key || keyOf(act)] = true; } catch (err) { /* nada */ }
    return { ok: false, why: why || 'No se pudo', logs: [], window: null };
  }
  /** Hace la jugada act (activate, summon, set, position, flip, discard, note) → { ok, logs: [{ kind: 'opp', text }], window } */
  function run(S, act) {
    if (!isVs(S) || !act) return { ok: false, why: 'Sin duelo VS', logs: [], window: null };
    if (!act.key) act.key = keyOf(act);
    try {
      switch (act.kind) {
        case 'activate': return runActivate(S, act);
        case 'summon': return runSummon(S, act);
        case 'set': return runSet(S, act);
        case 'position': case 'flip': return runPosition(S, act);
        case 'discard': return runDiscard(S, act);
        case 'note': return { ok: true, logs: [{ kind: 'opp', text: act.text }], window: null };
        case 'script': return C() ? C().run(S, act) : fail(S, act, 'Sin combos');
        case 'draw': {
          const r = D().draw(S, 1, { normal: true });
          return { ok: true, logs: [{ kind: 'opp', text: textOf(r, 'El rival roba 1 carta.') }], window: null, empty: !!(r && r.empty) };
        }
        default: return fail(S, act, 'Jugada desconocida');
      }
    } catch (err) {
      if (typeof console !== 'undefined') console.error('YGO.ai.run falló', err);
      return fail(S, act, 'Error interno');
    }
  }

  function runSummon(S, act) {
    const L = locOf(S, act.uid);
    if (!L) return fail(S, act, 'No encuentro esa carta');
    const c = cardOf(L.x);
    const req = { uid: act.uid, method: act.method, materials: arr(act.materials).slice(), position: act.position || (act.method === 'set' || act.method === 'tributeSet' ? 'set' : 'atk') };
    if (act.zone) req.zone = act.zone;
    if (act.ownProcedure) { req.ownProcedure = true; if (act.effectIndex != null) req.effectIndex = act.effectIndex; }
    const r = D().summon(S, req);
    if (!r || !r.ok) return fail(S, act, r && r.why);
    const logs = [{ kind: 'opp', text: textOf(r, 'El rival Invoca ' + q(c.name) + '.') }];
    const ai = aiOf(S);
    if (['link', 'xyz', 'synchro'].includes(act.method)) ai.extraSummons++;
    for (const m of req.materials) { const ml = locOf(S, m); if (ml && ml.where === 'gy') pushTrigger(S, m, 'gy'); }
    const hidden = req.position === 'set';
    if (hidden) return { ok: true, logs, window: null };
    const method = act.method === 'tribute' ? 'tribute' : act.method;
    pushTrigger(S, act.uid, 'summon', method);
    const e = (r.entry && r.entry.uid === act.uid ? r.entry : null) || (locOf(S, act.uid) || {}).x || L.x;
    return { ok: true, logs, window: { kind: 'summon', text: 'El rival Invoca ' + q(c.name) + ' (ATK ' + atkOf(S, e) + '). Puedes responder.' } };
  }

  function runSet(S, act) {
    const r = D().set(S, act.uid, act.zone);
    if (!r || !r.ok) return fail(S, act, r && r.why);
    aiOf(S).sets++;
    const z = r.entry && r.entry.zone;
    return { ok: true, logs: [{ kind: 'opp', text: textOf(r, 'El rival coloca 1 carta boca abajo' + (z ? ' en ' + ZONE_ES(z) : '') + '.') }], window: null };
  }

  function runPosition(S, act) {
    const L = locOf(S, act.uid);
    if (!L || L.where !== 'field') return fail(S, act, 'No está en el campo');
    const c = cardOf(L.x);
    const wasDown = !!L.x.faceDown;
    const r = D().position(S, act.uid, act.to || 'atk');
    if (!r || r.ok === false) return fail(S, act, r && r.why);
    const logs = [{ kind: 'opp', text: textOf(r, wasDown ? 'El rival Invoca por Volteo ' + q(c.name) + '.' : 'El rival cambia ' + q(c.name) + ' a posición de Ataque.') }];
    if (!wasDown) return { ok: true, logs, window: null };
    pushTrigger(S, act.uid, 'summon', 'flip');
    return { ok: true, logs, window: { kind: 'summon', text: 'El rival Invoca por Volteo ' + q(c.name) + ' (ATK ' + atkOf(S, L.x) + '). Puedes responder.' } };
  }

  function runDiscard(S, act) {
    const logs = [];
    for (const uid of arr(act.uids)) {
      const L = locOf(S, uid);
      if (!L || L.where !== 'hand') continue;
      const name = cardOf(L.x).name;
      const r = move(S, uid, 'discard', '');
      if (!r || r.ok === false) continue;
      afterMove(S, uid, r);
      logs.push({ kind: 'opp', text: 'El rival descarta ' + q(name) + ' por el límite de mano.' });
    }
    if (!logs.length) return fail(S, act, 'No descartó nada');
    return { ok: true, logs, window: null };
  }

  /** Elige costos y objetivos antes de activar (no mueve nada) → { costs: [{ a, uids }], targets: [cand] } | null */
  function prepare(cx, L, c, e, plan, oi) {
    const opt = oi == null ? null : plan.options[oi];
    const Ls = listsOf(plan, opt);
    const used = new Set();
    const self = L.x.uid;
    const costs = [];
    for (const a of Ls.cost) {
      const n = need(a);
      if (a.refers === 'this') { costs.push({ a, uids: [self] }); used.add(self); continue; }
      let uids = [];
      if (a.verb === 'payLP') uids = [];
      else if (a.verb === 'banishTop' || a.verb === 'millTop') uids = arr(cx.o.deck).slice(0, n).map((x) => x.uid);
      else if (a.verb === 'detach') {
        const host = a.host === 'this' ? L.x : ownMonsters(cx.S).find((m) => arr(m.mats).length >= n);
        uids = host ? arr(host.mats).slice(0, n).map((m) => m.uid) : [];
      } else {
        const list = sortFor(cx, candidates(cx, a, { self, noSelf: true, exclude: used }), a.verb === 'tribute' ? 'tribute' : a.verb === 'send' ? 'send' : 'cost');
        uids = list.slice(0, n).map((x) => x.uid);
      }
      if (a.verb !== 'payLP' && uids.length < n) return null;
      uids.forEach((u) => used.add(u));
      costs.push({ a, uids });
    }
    const costCards = costs.flatMap((s) => s.uids).map((u) => { const l = locOf(cx.S, u); return l ? cardOf(l.x) : null; }).filter(Boolean);
    const targets = [];
    for (const t of Ls.targets) {
      const purpose = targetPurpose(t, Ls.actions);
      const list = sortFor(cx, pickable(purpose, candidates(cx, t, { self, noSelf: true, exclude: used, costCards })), purpose);
      const n = Math.min(list.length, Math.max(need(t), t.count && t.count.max ? Number(t.count.max) : 1));
      if (list.length < need(t)) return null;
      list.slice(0, n).forEach((x) => { used.add(x.uid); targets.push(x); });
    }
    return { costs, targets };
  }

  function runActivate(S, act) {
    const cx = ctxOf(S);
    const idx = Number(act.effectIndex) || 0;
    const L = locOf(S, act.uid);
    if (!L) return fail(S, act, 'No encuentro esa carta');
    const c = cardOf(L.x);
    let r = null;
    if (idx === 0 || act.cardOnly) {
      const e0 = R().effectsOf(c).find((x) => x.index === 0);
      if (!e0) return fail(S, act, 'Sin activación');
      r = { c, e: e0, plan: { cost: [], targets: [], actions: [], notes: [], options: null }, option: null, score: 0 };
    } else r = evalEff(cx, act.uid, idx, act.trig || null);
    if (!r) return fail(S, act, 'Ya no puede usar ese efecto');
    const e = r.e;
    const prep = prepare(cx, L, c, e, r.plan, r.option);
    if (!prep) return fail(S, act, 'No puede pagar el costo');
    const req = { uid: act.uid, effectIndex: idx };
    const v = view(S, (vw) => R().checkActivation(vw, req));
    if (!v || !v.ok || arr(v.warnings).length) return fail(S, act, 'Las reglas no la dejan');
    const wasSet = L.where === 'field' && !!L.x.faceDown;
    const from = L.where;
    const logs = [];
    const say = (t) => { if (t) logs.push({ kind: 'opp', text: t }); };
    // La Mágica/Trampa va a su zona (o se voltea si estaba colocada)
    if (e.kind === 'activation' && !isMon(c)) {
      const placed = D().activatePlace(S, act.uid);
      if (!placed) return fail(S, act, 'No hay zona libre');
    }
    view(S, (vw) => R().commitActivation(vw, req, v));
    say('El rival activa ' + q(c.name) + (wasSet ? ' (estaba boca abajo)' : '') + '.');
    // Costos
    const costUids = [], costIds = [];
    for (const step of prep.costs) {
      const a = step.a;
      if (a.verb === 'payLP') {
        const n = a.lp === 'half' ? Math.floor(lpOf(S) / 2) : Number(a.lp) || 0;
        const before = lpOf(S);
        const pr = D().pay(S, n);
        say(textOf(pr, 'El rival paga ' + n + ' LP (LP ' + before + ' → ' + lpOf(S) + ').'));
        continue;
      }
      for (const u of step.uids) {
        const cl = locOf(S, u);
        if (!cl) continue;
        const cc = cardOf(cl.x);
        costUids.push(u);
        costIds.push(cc ? cc.id : 0);
        if (a.verb === 'reveal') { say('El rival revela ' + q(cc.name) + '.'); continue; }
        if (a.verb === 'position') { const pr = D().position(S, u, cl.x.def ? 'atk' : 'def'); say(textOf(pr, '')); continue; }
        const how = { discard: 'discard', send: 'cost', banish: a.faceDown ? 'banishFD' : 'banish', tribute: 'tribute', detach: 'material', returnDeck: 'deck', deckTop: 'deck', returnHand: 'hand', millTop: 'cost', banishTop: a.faceDown ? 'banishFD' : 'banish' }[a.verb] || 'cost';
        const mr = move(S, u, how, c.name, a.verb === 'deckTop' ? { top: a.deckPos !== 'bottom', bottom: a.deckPos === 'bottom' } : null);
        say(textOf(mr, costText(a.verb, cc, cl, a)));
        afterMove(S, u, mr);
      }
    }
    // Objetivos
    const targets = prep.targets.map((x) => (x.mine ? { uid: x.uid, side: 'rival', id: D().isPublic(x.where, x.x) ? x.id : 0, hidden: !D().isPublic(x.where, x.x), zone: x.zone || null, where: x.where }
      : { uid: x.uid, side: 'me', id: x.hidden ? 0 : x.id, hidden: !!x.hidden, zone: x.zone || null, where: x.area === 'oppGy' ? 'gy' : 'field' }));
    if (targets.length) say('Objetivo de ' + q(c.name) + ': ' + targets.map((t) => (t.side === 'me' ? yourName(t) : D().rivalName(S, t.uid))).join(', ') + '.');
    const now = locOf(S, act.uid) || L;
    if (!Array.isArray(S.chain)) S.chain = [];
    S.chain.push({
      owner: 'opp', ai: true, uid: act.uid, id: c.id, effectIndex: idx, text: e.text || '', speed: e.speed || 1, kind: e.kind,
      cardAct: e.kind === 'activation', from,
      aiRun: { option: r.option, costUids, costIds, targets, thisLoc: { where: now.where, zone: now.zone || null } },
    });
    return { ok: true, logs, window: { kind: 'activation', text: 'El rival activa ' + q(c.name) + ' (CL' + S.chain.length + '). Puedes responder.' } };
  }
  function costText(verb, c, L, a) {
    const n = q(c ? c.name : '?');
    switch (verb) {
      case 'discard': return 'El rival descarta ' + n + '.';
      case 'tribute': return 'El rival sacrifica ' + n + '.';
      case 'banish': case 'banishTop': return a && a.faceDown ? 'Una carta del rival queda desterrada boca abajo.' : n + ' del rival queda desterrada.';
      case 'detach': return 'El rival desacopla ' + n + '.';
      case 'returnHand': return L.where === 'field' && L.x.faceDown ? 'Una carta boca abajo del rival vuelve a su mano.' : n + ' vuelve a la mano del rival.';
      case 'returnDeck': case 'deckTop': return L.where === 'hand' ? 'El rival devuelve 1 carta de su mano al Mazo.' : n + ' vuelve al Mazo del rival.';
      default: return n + ' va al Cementerio del rival.';
    }
  }

  /* ---------- Resolver sus eslabones ---------- */
  const isAshName = (id) => same(nameById(id), ASH);
  /** ¿El plan de su eslabón añade del Mazo, Invoca del Mazo o manda del Mazo al Cementerio? (lo que niega Ash Blossom) */
  function ashFits(L, S) {
    if (!L || L.known) return false;
    if (L.script) { try { return !!(C() && C().fromDeck(S, L)); } catch (err) { return false; } }
    const c = db.get(L.id);
    const e = c && R().effectsOf(c).find((x) => x.index === Number(L.effectIndex));
    if (!e) return false;
    let plan;
    try { plan = E().parse(c, e); } catch (err) { return false; }
    const opt = L.aiRun && L.aiRun.option != null && plan.options ? plan.options[L.aiRun.option] : null;
    return listsOf(plan, opt).actions.some((a) => (['add', 'addOrSS', 'ss', 'send'].includes(a.verb) && arr(a.from).includes('deck')) || a.verb === 'millTop');
  }
  const linkTargets = (P) => arr(P.targets).concat(arr(P.auto && P.auto.targetLocs).map((t) => t && t.uid)).filter(Boolean);
  /** ¿Tu respuesta niega su eslabón i? → nombre de tu carta o null. No cambia nada. */
  function negatedBy(S, i) {
    const chain = arr(S && S.chain);
    const L = chain[i];
    if (!L || !L.ai) return null;
    const P = chain[i + 1];
    if (P && P.owner !== 'opp' && !P.negated) {
      const pc = db.get(P.id);
      if (pc && isAshName(pc.id)) { if (ashFits(L, S)) return pc.name; }
      else if (pc) {
        const pe = R().effectsOf(pc).find((x) => x.index === Number(P.effectIndex));
        const cond = String((pe && pe.condition) || '');
        if (pe && !/\bincludes?\b/i.test(cond) && NEG_TEXT.test(pe.text || '') && NEG_COND.test(cond)) return pc.name;
      }
    }
    // Effect Veiler / Infinite Impermanence tuyo ya resuelto que apuntó al monstruo que activó el efecto
    const src = db.get(L.id);
    if (!L.known && isMon(src) && (L.from === 'field' || (L.aiRun && L.aiRun.thisLoc && L.aiRun.thisLoc.where === 'field'))) {
      for (let k = i + 1; k < chain.length; k++) {
        const P2 = chain[k];
        if (!P2 || P2.owner === 'opp' || P2.negated || !P2.done) continue;
        const name = nameById(P2.id);
        if (!(same(name, VEILER) || same(name, IMPERM))) continue;
        if (linkTargets(P2).includes(L.uid)) return name;
      }
    }
    return null;
  }
  /** Su eslabón negado: no hace nada (su carta la mueve afterChain). */
  function negatedLink(S, i) {
    const L = arr(S && S.chain)[i];
    if (L && L.ai && !L.negated) L.negated = { by: '' };
    return [];
  }

  /** Resuelve su eslabón i → ops para tu campo (con notas en orden). */
  function resolveLink(S, i) {
    if (!isVs(S)) return [];
    const L = arr(S.chain)[i];
    if (!L || !L.ai) return [];
    try {
      const by = negatedBy(S, i);
      if (by) {
        L.negated = { by };
        if ((same(by, VEILER) || same(by, IMPERM)) && locOf(S, L.uid)) { try { D().negate(S, L.uid, by); } catch (err) { /* nada */ } }
        return [];
      }
      // Tu Droll & Lock Bird encadenado encima ya se resolvió: su bloqueo vale para este eslabón
      const pre = drollAbove(S, i);
      if (L.known) return pre.concat(resolveKnown(S, i, L));
      if (L.script) return pre.concat(C() ? C().resolveLink(S, i, L) : []);
      return pre.concat(resolveRun(S, i, L));
    } catch (err) {
      if (typeof console !== 'undefined') console.error('YGO.ai.resolveLink falló', err);
      return [{ op: 'note', text: 'No se simula: ' + q(nameById(L.id)) + ' (error interno).' }];
    }
  }

  /** ¿Ya rige el bloqueo de tu Droll & Lock Bird este turno? */
  const drollLocked = (S) => arr(D().tsOf(S).locks).some((l) => l && l.kind === 'noDeckAdd' && same(l.source || '', DROLL));
  function drollLock(S, name) {
    view(S, (vw) => R().addLock(vw, { kind: 'noDeckAdd', source: name, text: 'Este turno no se pueden añadir cartas del Mazo a la mano.' }));
    return 'Por tu ' + q(name) + ', el rival no puede añadir más cartas del Mazo a la mano este turno.';
  }
  /** Tu Droll (no negado) encima de su eslabón i: en su turno se resolvió antes, así que el bloqueo ya vale → notas */
  function drollAbove(S, i) {
    if (S.turnState.mine !== false || drollLocked(S)) return [];
    const P = arr(S.chain).find((x, j) => j > i && x && x.owner !== 'opp' && !x.ai && !x.negated && same(nameById(x.id), DROLL));
    return P ? [{ op: 'note', text: drollLock(S, nameById(P.id)) }] : [];
  }

  function resolveRun(S, i, L) {
    const cx = ctxOf(S);
    const c = db.get(L.id);
    const e = c && R().effectsOf(c).find((x) => x.index === Number(L.effectIndex));
    if (!c || !e || !L.effectIndex) return [];
    const plan = E().parse(c, e);
    const run = L.aiRun || {};
    const opt = run.option != null && plan.options ? plan.options[run.option] : null;
    const Ls = listsOf(plan, opt);
    const ops = [];
    const cl = 'CL' + (i + 1) + ' ' + q(c.name) + ': ';
    const note = (t) => { if (t) ops.push({ op: 'note', text: cl + lowerFirst(t) }); };
    const skip = (a) => ops.push({ op: 'note', text: cl + 'No se simula: ' + q(a.text || E().describe(a)) });
    const costCards = arr(run.costIds).map((id) => db.get(id)).filter(Boolean);
    const targetCards = arr(run.targets).map((t) => (t.id ? db.get(t.id) : null)).filter(Boolean);
    // Objetivos que siguen donde estaban
    const live = [];
    for (const t of arr(run.targets)) {
      if (t.side === 'me') {
        const pool = t.where === 'gy' ? yourIn(cx, 'oppGy') : yourIn(cx, 'oppField');
        const p = pool.find((x) => x.uid === t.uid && (t.where === 'gy' || x.zone === t.zone));
        if (p) live.push({ mine: false, uid: t.uid, hidden: !!p.faceDown, id: p.faceDown ? 0 : p.id, zone: p.zone, area: t.where === 'gy' ? 'oppGy' : 'oppField', mon: !!p.mon });
        else note('no se hace: ' + yourName(t) + ' ya no está.');
      } else {
        const l = locOf(S, t.uid);
        if (l && l.where === t.where && (l.where !== 'field' || l.zone === t.zone)) live.push({ mine: true, uid: t.uid, x: l.x, where: l.where, zone: l.zone, card: cardOf(l.x), id: Number(l.x.id) });
        else note('no se hace: ' + (t.id ? q(nameById(t.id)) : 'una carta del rival') + ' ya no está.');
      }
    }
    let prev = { did: true, items: [] };
    for (const a of Ls.actions) {
      if (a.dependsOnPrevious && !prev.did) { prev = { did: false, items: [] }; continue; }
      // A qué cartas: esta carta, los objetivos, lo anterior, el costo, o las que se eligen ahora
      let items = null;
      if (a.refers === 'this') {
        const l = locOf(S, L.uid);
        items = l ? [{ mine: true, uid: L.uid, x: l.x, where: l.where, zone: l.zone, card: cardOf(l.x), id: Number(l.x.id) }] : [];
      } else if (a.refers === 'targets') items = live.filter((x) => (x.mine ? !!locOf(S, x.uid) : !!yourIn(cx, x.area).find((y) => y.uid === x.uid)));
      else if (a.refers === 'previous') items = prev.items.filter((x) => (x.mine ? !!locOf(S, x.uid) : true));
      else if (a.refers === 'cost') items = arr(run.costUids).map((u) => { const l = locOf(S, u); return l ? { mine: true, uid: u, x: l.x, where: l.where, zone: l.zone, card: cardOf(l.x), id: Number(l.x.id) } : null; }).filter(Boolean);
      const res = doAction(cx, a, items, { L, c, e, costCards, targetCards, note, skip, ops });
      prev = res;
      cx.pub = D().publicSide(S);
    }
    // Daño al rival ("Inflict 800 damage to your opponent")
    const burn = burnOf(Ls.notes);
    if (burn > 0) ops.push({ op: 'damage', amount: burn });
    for (const n of Ls.notes) if (n && n.kind === 'opp' && !BURN.test(n.text || '')) ops.push({ op: 'note', text: cl + 'No se simula: ' + q(n.text) });
    return ops;
  }

  /** Hace una acción del plan. items: las cartas ya decididas (refers) o null (se eligen ahora). → { did, items } */
  function doAction(cx, a, items, k) {
    const S = cx.S;
    const by = k.c.name;
    const done = [];
    const ctxM = { self: k.L.uid, costCards: k.costCards, targetCards: k.targetCards };
    const pickNow = (purpose, filterFn) => {
      let list = candidates(cx, a, Object.assign({ adding: a.verb === 'addOrSS', noSelf: true }, ctxM));
      if (filterFn) list = list.filter(filterFn);
      if (a.count && a.count.all) return list;
      list = sortFor(cx, list, purpose);
      return list.slice(0, want(a));
    };
    switch (a.verb) {
      case 'draw': {
        const n = need(a);
        const r = D().draw(S, n, {});
        k.note(textOf(r, 'El rival roba ' + n + (n === 1 ? ' carta.' : ' cartas.')));
        return { did: !!(r && arr(r.cards).length), items: arr(r && r.cards).map((x) => ({ mine: true, uid: x.uid })) };
      }
      case 'payLP': {
        const n = a.lp === 'half' ? Math.floor(lpOf(S) / 2) : Number(a.lp) || 0;
        const before = lpOf(S);
        const r = D().pay(S, n);
        k.note(textOf(r, 'El rival paga ' + n + ' LP (LP ' + before + ' → ' + lpOf(S) + ').'));
        return { did: true, items: [] };
      }
      case 'lpGain': {
        const before = lpOf(S);
        const n = Number(a.lp) || 0;
        try { D().setLp(S, 'rival', before + n); } catch (err) { S.opp.lp = before + n; }
        k.note('El rival gana ' + n + ' LP (LP ' + before + ' → ' + lpOf(S) + ').');
        return { did: true, items: [] };
      }
      case 'millTop': case 'banishTop': {
        const n = need(a);
        const top = arr(S.opp.deck).slice(0, n);
        for (const x of top) {
          const c = cardOf(x);
          const how = a.verb === 'millTop' ? 'send' : a.faceDown ? 'banishFD' : 'banish';
          const r = move(S, x.uid, how, '');
          if (!r || r.ok === false) continue;
          k.note(textOf(r, a.verb === 'millTop' ? q(c.name) + ' va al Cementerio del rival.' : a.faceDown ? 'Una carta del rival queda desterrada boca abajo.' : q(c.name) + ' del rival queda desterrada.'));
          afterMove(S, x.uid, r);
          done.push({ mine: true, uid: x.uid });
        }
        return { did: done.length > 0, items: done };
      }
      case 'detach': {
        const host = a.host === 'this' ? (locOf(S, k.L.uid) || {}).x : ownMonsters(S).find((m) => arr(m.mats).length >= need(a));
        const mats = host ? arr(host.mats).slice(0, need(a)) : [];
        for (const m of mats) {
          const r = move(S, m.uid, 'material', '');
          k.note(textOf(r, 'El rival desacopla ' + q(nameById(m.id)) + '.'));
          afterMove(S, m.uid, r);
          done.push({ mine: true, uid: m.uid });
        }
        return { did: done.length > 0, items: done };
      }
      case 'reveal': return { did: true, items: items || [] };
      default: break;
    }
    if (!items) {
      const purpose = a.verb === 'ss' ? 'ss' : a.verb === 'add' || a.verb === 'addOrSS' ? 'add' : a.verb === 'send' ? 'send'
        : ['destroy', 'banish', 'returnHand', 'returnDeck', 'deckTop', 'position'].includes(a.verb) ? 'remove' : 'best';
      let flt = null;
      if (a.verb === 'add' || a.verb === 'addOrSS') flt = (x) => x.mine && x.where !== 'hand';
      if (a.verb === 'ss') flt = (x) => x.mine && x.where !== 'field' && canSS(cx, x.uid, k.c, k.e, ssReq(cx, x.card, a));
      if (a.verb === 'set' || a.verb === 'placeST') flt = (x) => x.mine && !isMon(x.card) && x.where !== 'field';
      if (purpose === 'remove' && !(a.count && a.count.all) && a.owner === 'opp') flt = (x) => !x.mine;
      items = pickNow(purpose, flt);
      if (!items.length) {
        if (!a.optional && need(a) > 0 && !(a.count && a.count.min === 0)) k.skip(a);
        return { did: false, items: [] };
      }
    }
    if (!items.length) return { did: false, items: [] };
    const yourOps = [];
    for (const it of items) {
      if (!it.mine) { // Tu carta: operación para field.js
        switch (a.verb) {
          case 'destroy': yourOps.push({ op: 'destroy', uid: it.uid }); break;
          case 'banish': yourOps.push({ op: 'banish', uid: it.uid }); break;
          case 'returnHand': yourOps.push({ op: 'bounce', uids: [it.uid] }); break;
          case 'send': yourOps.push({ op: 'send', uid: it.uid }); break;
          case 'returnDeck': yourOps.push({ op: 'toDeck', uid: it.uid }); break;
          case 'deckTop': yourOps.push({ op: 'toDeck', uid: it.uid, bottom: a.deckPos === 'bottom' }); break;
          case 'position': {
            const p = findYour(cx, it.uid);
            const to = a.position === 'toggle' ? (p && !p.def ? 'def' : 'atk') : a.position;
            yourOps.push({ op: 'position', uid: it.uid, to });
            break;
          }
          default: k.skip(a); continue;
        }
        done.push(it);
        continue;
      }
      const r = ownAction(cx, a, it, k);
      if (r) done.push(it);
    }
    // Las de tu campo de una misma acción van juntas (field.js las anota una por una)
    for (const op of yourOps) k.ops.push(op);
    return { did: done.length > 0, items: done };
  }

  /** Nombre de su carta para el registro: «X» si se ve; si no, sin nombre. */
  const ownName = (S, uid) => { const f = D().findRival(S, uid); return f && D().isPublic(f.where, f.inst) ? q(nameById(f.inst.id)) : 'una carta del rival'; };
  /** Acción sobre una carta suya → true si se hizo. */
  function ownAction(cx, a, it, k) {
    const S = cx.S;
    const by = k.c.name;
    const l = locOf(S, it.uid);
    if (!l) return false;
    const c = cardOf(l.x);
    const ssFirst = a.verb === 'addOrSS' && canSS(cx, it.uid, k.c, k.e, ssReq(cx, c, a)) && (noDeckAdd(cx) || (isMon(c) && (Number(cx.t.normalSummons) || 0) > 0));
    const verb = a.verb === 'addOrSS' ? (ssFirst ? 'ss' : 'add') : a.verb;
    switch (verb) {
      case 'add': {
        if (l.where === 'deck' && noDeckAdd(cx)) { k.note('no se añade: este turno no puede añadir cartas del Mazo.'); return false; }
        let r = null;
        try { r = l.where === 'field' ? D().leave(S, it.uid, 'hand', '') : D().moveRival(S, it.uid, 'hand', { how: 'hand' }); } catch (err) { r = null; }
        if (!r || r.ok === false) { k.note(r && r.refused && r.why ? r.why : ownName(S, it.uid) + ' no se añade.'); return false; }
        k.note(r.text);
        return true;
      }
      case 'ss': {
        const req = Object.assign({ uid: it.uid, method: a.treatedAs || 'special', materials: [], source: q(by) }, ssReq(cx, c, a));
        if (a.zone === 'center') req.zone = 'mz2';
        else if (a.zone === 'linked') {
          let lz = [];
          try { lz = view(S, (vw) => [...R().linkedZones(vw)]).filter((z) => MZ.includes(z) && !entryAt(S, z)); } catch (err) { lz = []; }
          if (!lz.length) { k.note(ownName(S, it.uid) + ' no se Invoca: no hay una zona a la que apunte un Link.'); return false; }
          req.zone = lz[0];
        }
        const r = D().summon(S, req);
        if (!r || !r.ok) { k.note(ownName(S, it.uid) + ' no se Invoca' + (r && r.why ? ': ' + r.why : '.')); return false; }
        k.note(textOf(r, 'El rival Invoca de modo Especial ' + q(c.name) + '.'));
        if (req.position !== 'set') pushTrigger(S, it.uid, 'summon', req.method);
        return true;
      }
      case 'set': case 'placeST': {
        let r = null;
        try {
          if (verb === 'set') r = D().set(S, it.uid, null, { effect: true, by });
          else { const en = D().activatePlace(S, it.uid); r = en ? { ok: true, text: 'El rival pone ' + q(c.name) + ' boca arriba en ' + ZONE_ES(en.zone) + '.' } : { ok: false }; }
        } catch (err) { r = null; }
        if (!r || r.ok === false) { k.note(r && r.why ? ownName(S, it.uid) + ' no se coloca: ' + r.why : 'No se simula: ' + q(a.text || E().describe(a))); return false; }
        k.note(r.text);
        return true;
      }
      case 'position': {
        const to = a.position === 'toggle' ? (l.x.def ? 'atk' : 'def') : a.position === 'set' ? 'def' : a.position;
        let r = null;
        try { r = D().position(S, it.uid, to, { effect: true, by }); } catch (err) { r = null; }
        if (r && r.ok !== false && r.text) k.note(r.text);
        return !!(r && r.ok !== false);
      }
      default: {
        const how = { send: 'send', discard: 'discard', banish: a.faceDown ? 'banishFD' : 'banish', destroy: 'destroy', returnHand: 'hand', returnDeck: 'deck', deckTop: 'deck', tribute: 'tribute' }[verb];
        if (!how) { k.skip(a); return false; }
        const r = move(S, it.uid, how, '', verb === 'deckTop' ? { top: a.deckPos !== 'bottom', bottom: a.deckPos === 'bottom' } : null);
        if (!r || r.ok === false || r.refused) { k.note(textOf(r, 'No se simula: ' + q(a.text || E().describe(a)))); return false; }
        k.note(textOf(r, costText(verb === 'destroy' ? 'send' : verb, c, l, a)));
        for (const op of arr(r.ops)) k.ops.push(op);
        afterMove(S, it.uid, r);
        return true;
      }
    }
  }
  /** Posición al Invocar de modo Especial: Ataque, salvo DEF ≥ ATK+500 y un monstruo tuyo boca arriba más fuerte.
   * → { position } (boca abajo: { position: 'set', faceDown: true }) */
  function ssReq(cx, c, a) {
    const r = ssPos(cx, c, a);
    // "a una zona a la que apunte este Link" / "a la Zona de Monstruo central": sin esa zona libre no se puede (no se activa en vano)
    if (a.zone === 'center') r.zone = 'mz2';
    else if (a.zone === 'linked') {
      let lz = [];
      try { lz = view(cx.S, (vw) => [...R().linkedZones(vw)]).filter((z) => MZ.includes(z) && !entryAt(cx.S, z)); } catch (err) { lz = []; }
      if (lz.length) r.zone = lz[0]; else r.noZone = true;
    }
    return r;
  }
  function ssPos(cx, c, a) {
    if (a.position === 'set' || a.faceDown) return { position: 'set', faceDown: true };
    if (a.position === 'def') return { position: 'def' };
    if (a.position === 'atk' || c.type & T.LINK) return { position: 'atk' };
    const atk = Number(c.atk) || 0, def = Number(c.def) || 0;
    return { position: def >= atk + 500 && maxFaceUpAtk(cx.pub) > atk ? 'def' : 'atk' };
  }
  /* ---------- Después de cerrar la cadena ---------- */
  /** Sus Mágicas/Trampas que ya se resolvieron van al Cementerio; tu Droll & Lock Bird le cierra el Mazo; tu Veiler/Imperm
   * niega a su monstruo. → [{ kind: 'opp', text }] */
  function afterChain(S, chain, opts) {
    if (!isVs(S)) return [];
    const logs = [];
    const abandoned = !!(opts && opts.abandoned);
    try {
      for (const L of arr(chain)) {
        if (!L || !L.ai) continue;
        const c = db.get(L.id);
        if (!L.cardAct || !c || isMon(c) || c.type & (T.CONTINUOUS | T.FIELD | T.EQUIP)) continue;
        const l = locOf(S, L.uid);
        if (!l || l.where !== 'field' || l.x.faceDown || !ST.includes(l.zone)) continue;
        const r = move(S, L.uid, 'gy', '');
        if (r && r.ok !== false) logs.push({ kind: 'opp', text: textOf(r, q(c.name) + ' va al Cementerio del rival.') });
      }
      for (const P of arr(chain)) {
        if (!P || P.owner === 'opp' || P.ai || P.negated) continue;
        if (abandoned && !P.done) continue;
        const name = nameById(P.id);
        if (same(name, DROLL) && S.turnState.mine === false && !drollLocked(S)) logs.push({ kind: 'opp', text: drollLock(S, name) });
        if (same(name, VEILER) || same(name, IMPERM)) {
          for (const u of linkTargets(P)) {
            const l = locOf(S, u);
            if (!l || l.where !== 'field' || l.x.faceDown || !isMonEntry(l.x)) continue;
            if (l.x.negated && Number(l.x.negated.turn) === turnOf(S)) continue;
            try { D().negate(S, u, name); } catch (err) { continue; }
            logs.push({ kind: 'opp', text: 'Los efectos de ' + q(nameById(l.x.id)) + ' del rival quedan negados este turno (por tu ' + q(name) + ').' });
          }
        }
      }
    } catch (err) {
      if (typeof console !== 'undefined') console.error('YGO.ai.afterChain falló', err);
    }
    return logs;
  }

  /* ---------- Sus Trampas colocadas conocidas, en tu turno ---------- */
  /** ¿Tu ataque le haría daño? (destruye a su monstruo o le quita 1000 o más) */
  /** Con lo que se ve de tu atacante (publicSide) y lo que sabe de su monstruo (la tabla de batalla de §2.3, sin protecciones). */
  function attackHurts(cx, ev) {
    if (!ev || !ev.attacker) return false;
    const a = findYour(cx, ev.attacker);
    if (!a || a.faceDown || !a.mon) return false;
    const A = Math.max(0, Number(a.atk) || 0);
    if (!ev.target) return A >= 1000;
    const L = locOf(cx.S, ev.target);
    if (!L || L.where !== 'field' || !isMonEntry(L.x)) return false;
    const st = statsOf(cx.S, L.x);
    if (st.pos === 'atk') return A > 0 && A >= (Number(st.atk) || 0);
    return A > (Number(st.def) || 0);
  }
  /** Tus monstruos Invocados en este evento (boca arriba, públicos) → [{ uid, atk, id, zone }] */
  const summoned = (cx, ev) => {
    const uids = arr(ev.uids).length ? arr(ev.uids) : [ev.uid].filter(Boolean);
    return arr(cx.pub.monsters).filter((m) => uids.includes(m.uid) && !m.faceDown);
  };
  /** Plan de tu eslabón (público: la carta ya se activó) → { addsDeck, ss, monster, cardAct, onField } */
  function yourLinkInfo(cx, ev) {
    const P = arr(cx.S.chain)[Number(ev.link)];
    if (!P || P.owner === 'opp' || P.negated) return null;
    const c = db.get(P.id);
    const e = c && R().effectsOf(c).find((x) => x.index === Number(P.effectIndex));
    let plan = null;
    try { plan = e ? E().parse(c, e) : null; } catch (err) { plan = null; }
    const acts = plan ? listsOf(plan, null).actions.concat(...arr(plan.options).map((o) => arr(o.actions))) : [];
    const deck = acts.some((a) => ['add', 'addOrSS', 'ss'].includes(a.verb) && arr(a.from).includes('deck'));
    const ss = acts.some((a) => a.verb === 'ss' || a.verb === 'addOrSS');
    const m = arr(cx.pub.monsters).find((x) => x.uid === P.uid && !x.faceDown);
    return { P, c, index: Number(ev.link), deck, ss, monster: isMon(c) && !P.cardAct, cardAct: !!P.cardAct || (c && !isMon(c)), onField: !!m };
  }
  const SUMMON_METHODS_SPECIAL = (m) => !['normal', 'tribute', 'flip', 'set', 'tributeSet'].includes(String(m || 'special'));
  /** Tabla de cartas conocidas: when (eventos), check (→ { score, target, text, reason } | null), ops al resolverse. */
  const KNOWN = {
    'Mirror Force': {
      when: ['attack'],
      check: (cx, ev) => {
        if (!attackHurts(cx, ev)) return null;
        const n = arr(cx.pub.monsters).filter((m) => !m.faceDown && !m.def).length;
        return { score: 80 + 5 * Math.max(0, n - 1), target: { attacker: ev.attacker, target: ev.target || null }, text: 'destruye tus monstruos en ATK.', reason: 'Tu ataque destruiría a su monstruo o le haría mucho daño.' };
      },
      ops: (cx) => arr(cx.pub.monsters).filter((m) => !m.faceDown && !m.def).map((m) => ({ op: 'destroy', uid: m.uid })),
    },
    'Sakuretsu Armor': {
      when: ['attack'],
      check: (cx, ev) => (attackHurts(cx, ev) ? { score: 81, target: { attacker: ev.attacker, target: ev.target || null }, text: 'destruye a ' + yourMon(cx, ev.attacker) + ', que ataca.', reason: 'Tu ataque destruiría a su monstruo o le haría mucho daño.' } : null),
      ops: (cx, L) => (onYourField(cx, L.target.attacker) ? [{ op: 'destroy', uid: L.target.attacker }] : []),
    },
    'Dimensional Prison': {
      when: ['attack'],
      check: (cx, ev) => (attackHurts(cx, ev) ? { score: 82, target: { attacker: ev.attacker, target: ev.target || null }, text: 'destierra a ' + yourMon(cx, ev.attacker) + ', que ataca.', reason: 'Tu ataque destruiría a su monstruo o le haría mucho daño.' } : null),
      ops: (cx, L) => (onYourField(cx, L.target.attacker) ? [{ op: 'banish', uid: L.target.attacker }] : []),
    },
    'Trap Hole': {
      when: ['summon'],
      check: (cx, ev) => {
        if (!['normal', 'tribute', 'flip'].includes(String(ev.method || ''))) return null;
        const m = bestSummoned(cx, ev, 1500);
        return m ? { score: 70, target: { uid: m.uid }, text: 'destruye a ' + yourMon(cx, m.uid) + '.', reason: 'Tu ' + q(nameById(m.id)) + ' tiene ' + m.atk + ' de ATK.' } : null;
      },
      ops: (cx, L) => { const m = findYour(cx, L.target.uid); return m && !m.faceDown && (Number(m.atk) || 0) >= 1000 ? [{ op: 'destroy', uid: m.uid }] : []; },
    },
    'Bottomless Trap Hole': {
      when: ['summon'],
      check: (cx, ev) => {
        if (/^(?:set|tributeSet)$/.test(String(ev.method || ''))) return null;
        const m = bestSummoned(cx, ev, 1500);
        return m ? { score: 75, target: { uid: m.uid }, text: 'destruye y destierra a ' + yourMon(cx, m.uid) + '.', reason: 'Tu ' + q(nameById(m.id)) + ' tiene ' + m.atk + ' de ATK.' } : null;
      },
      ops: (cx, L) => { const m = findYour(cx, L.target.uid); return m && !m.faceDown && (Number(m.atk) || 0) >= 1500 ? [{ op: 'banish', uid: m.uid }] : []; },
    },
    'Torrential Tribute': {
      when: ['summon'],
      check: (cx, ev) => {
        if (/^(?:set|tributeSet)$/.test(String(ev.method || ''))) return null;
        const m = bestSummoned(cx, ev, 1500);
        if (!m) return null;
        const yours = arr(cx.pub.monsters).filter((x) => !x.faceDown).reduce((a, x) => a + (Number(x.atk) || 0), 0);
        const own = ownMonsters(cx.S).reduce((a, e) => a + atkOf(cx.S, e), 0);
        return yours > own + 500 ? { score: 72, target: { uid: m.uid }, text: 'destruye todos los monstruos del campo.', reason: 'Tus monstruos valen más que los suyos.' } : null;
      },
      ops: (cx) => arr(cx.pub.monsters).map((m) => ({ op: 'destroy', uid: m.uid })),
      own: (cx, L, k) => { for (const e of ownMonsters(cx.S)) { const r = move(cx.S, e.uid, 'destroy', 'Torrential Tribute'); k.note(textOf(r, '')); } },
    },
    'Solemn Warning': { when: ['summon', 'activation'], pay: () => 2000, check: (cx, ev) => solemn(cx, ev, 'Solemn Warning', 68) },
    'Solemn Strike': { when: ['summon', 'activation'], pay: () => 1500, check: (cx, ev) => solemn(cx, ev, 'Solemn Strike', 70) },
    'Solemn Judgment': { when: ['summon', 'activation'], pay: (S) => Math.floor(lpOf(S) / 2), check: (cx, ev) => solemn(cx, ev, 'Solemn Judgment', 66) },
    'Compulsory Evacuation Device': {
      when: ['summon', 'attack'],
      check: (cx, ev) => {
        if (ev.type === 'attack') return attackHurts(cx, ev) ? { score: 76, target: { uid: ev.attacker }, text: 'devuelve a ' + yourMon(cx, ev.attacker) + ' a la mano.', reason: 'Tu ataque destruiría a su monstruo o le haría mucho daño.' } : null;
        if (/^(?:set|tributeSet)$/.test(String(ev.method || ''))) return null;
        const m = bestSummoned(cx, ev, 1500);
        if (!m) return null;
        const extra = db.isExtra(db.get(m.id) || { type: 0 });
        return { score: extra ? 74 : 64, target: { uid: m.uid }, text: 'devuelve a ' + yourMon(cx, m.uid) + (extra ? ' al Extra Deck.' : ' a la mano.'), reason: 'Tu ' + q(nameById(m.id)) + ' tiene ' + m.atk + ' de ATK.' };
      },
      ops: (cx, L) => (onYourField(cx, L.target.uid) ? [{ op: 'bounce', uids: [L.target.uid] }] : []),
    },
    [IMPERM]: {
      when: ['summon', 'activation'],
      check: (cx, ev) => {
        if (ev.type === 'activation') {
          const y = yourLinkInfo(cx, ev);
          if (!y || !y.monster || !y.onField || !y.deck) return null;
          return { score: 70, target: { uid: y.P.uid, link: y.index }, text: 'niega los efectos de ' + yourMon(cx, y.P.uid) + ' este turno.', reason: 'Ese efecto añade o Invoca desde el Mazo.' };
        }
        if (/^(?:set|tributeSet)$/.test(String(ev.method || ''))) return null;
        const m = summoned(cx, ev).find((x) => { const c = db.get(x.id); return c && c.type & T.EFFECT && infoOf(c).effs.length; });
        return m ? { score: 55, target: { uid: m.uid }, text: 'niega los efectos de ' + yourMon(cx, m.uid) + ' este turno.', reason: 'Tu ' + q(nameById(m.id)) + ' tiene efectos que puede usar.' } : null;
      },
      ops: (cx, L) => {
        const m = findYour(cx, L.target.uid);
        if (!m || m.faceDown) return [];
        const out = [{ op: 'negateMonster', uid: m.uid }];
        const P = L.target.link != null ? arr(cx.S.chain)[L.target.link] : null;
        if (P && P.uid === m.uid && !P.negated) out.push({ op: 'negateLink', index: L.target.link });
        return out;
      },
    },
  };
  const yourMon = (cx, uid) => { const m = findYour(cx, uid); return m && !m.faceDown && m.id ? 'tu ' + q(nameById(m.id)) : 'tu monstruo boca abajo'; };
  const onYourField = (cx, uid) => !!(uid && findYour(cx, uid));
  const bestSummoned = (cx, ev, min) => summoned(cx, ev).filter((m) => (Number(m.atk) || 0) >= min).sort((a, b) => (Number(b.atk) || 0) - (Number(a.atk) || 0))[0] || null;
  function solemn(cx, ev, name, base) {
    const S = cx.S;
    const cost = KNOWN[name].pay(S);
    if (!(lpOf(S) > cost)) return null;
    if (ev.type === 'summon') {
      if (/^(?:set|tributeSet)$/.test(String(ev.method || ''))) return null;
      if (name === 'Solemn Strike' && !SUMMON_METHODS_SPECIAL(ev.method)) return null;
      const m = bestSummoned(cx, ev, name === 'Solemn Judgment' ? 2000 : 1500);
      return m ? { score: base, target: { uid: m.uid }, text: 'niega la Invocación de ' + yourMon(cx, m.uid) + ' y lo destruye.', reason: 'Tu ' + q(nameById(m.id)) + ' tiene ' + m.atk + ' de ATK.' } : null;
    }
    const y = yourLinkInfo(cx, ev);
    if (!y || !y.deck) return null;
    if (name === 'Solemn Strike' && !y.monster) return null;
    if (name === 'Solemn Judgment' && !y.cardAct) return null;
    if (name === 'Solemn Warning' && !y.ss) return null;
    return { score: base + 2, target: { uid: y.P.uid, link: y.index }, text: 'niega la activación de tu ' + q(y.c.name) + ' y la destruye.', reason: 'Ese efecto añade o Invoca desde el Mazo.' };
  }
  function solemnOps(cx, L) {
    const t = L.target || {};
    if (t.link != null) {
      const out = [];
      const P = arr(cx.S.chain)[t.link];
      if (P && P.uid === t.uid && !P.negated) out.push({ op: 'negateLink', index: t.link });
      if (onYourField(cx, t.uid)) out.push({ op: 'destroy', uid: t.uid });
      return out;
    }
    return onYourField(cx, t.uid) ? [{ op: 'destroy', uid: t.uid }] : [];
  }

  /** Después de que bot.js no respondió: ¿activa una Trampa colocada conocida? → r | null */
  function consider(S, ev) {
    if (!isVs(S) || !ev || S.turnState.mine === false || (S.vs && S.vs.over)) return null;
    if (!['summon', 'activation', 'attack'].includes(ev.type)) return null;
    try {
      const cx = ctxOf(S);
      let best = null;
      for (const e of fieldOf(S).filter((x) => x.faceDown && ST.includes(x.zone)).sort(byZone)) {
        const c = cardOf(e);
        const name = knownName(c);
        if (!name || e.setTurn == null || !(Number(e.setTurn) < cx.turn)) continue;
        const K = KNOWN[name];
        if (!K || !K.when.includes(ev.type)) continue;
        if (arr(S.chain).some((l) => l && l.uid === e.uid)) continue;
        const r = K.check(cx, ev);
        if (!r || r.score < 50 || (best && best.score >= r.score)) continue;
        let v = null;
        try { v = view(S, (vw) => R().checkActivation(vw, { uid: e.uid, effectIndex: 1 })); } catch (err) { v = null; }
        if (!v || !v.ok) continue;
        best = { ai: true, known: name, uid: e.uid, id: c.id, effectIndex: 1, score: r.score, target: r.target,
          text: 'El rival activa ' + q(c.name) + ' (estaba boca abajo): ' + r.text, reason: r.reason, ev: { type: ev.type } };
      }
      return best;
    } catch (err) {
      if (typeof console !== 'undefined') console.error('YGO.ai.consider falló', err);
      return null;
    }
  }
  /** Activa la Trampa elegida por consider: la voltea, paga, anota y pone el eslabón. → entrada del registro | null */
  function commit(S, r) {
    if (!isVs(S) || !r || !r.known) return null;
    const l = locOf(S, r.uid);
    if (!l || l.where !== 'field' || !l.x.faceDown) return null;
    const c = cardOf(l.x);
    const e = R().effectsOf(c).find((x) => x.index === 1);
    const req = { uid: r.uid, effectIndex: 1 };
    const v = view(S, (vw) => R().checkActivation(vw, req));
    if (!v || !v.ok) return null;
    if (!D().activatePlace(S, r.uid)) return null;
    view(S, (vw) => R().commitActivation(vw, req, v));
    const K = KNOWN[r.known];
    let paid = '';
    if (K && K.pay) {
      const n = K.pay(S);
      const before = lpOf(S);
      const pr = D().pay(S, n);
      paid = ' ' + textOf(pr, 'El rival paga ' + n + ' LP (LP ' + before + ' → ' + lpOf(S) + ').');
    }
    if (!Array.isArray(S.chain)) S.chain = [];
    const zone = (locOf(S, r.uid) || l).zone;
    S.chain.push({
      owner: 'opp', ai: true, known: r.known, uid: r.uid, id: c.id, effectIndex: 1, text: e ? e.text : '', speed: e ? e.speed : 2, kind: 'activation',
      cardAct: true, from: 'field', target: Object.assign({}, r.target),
      aiRun: { option: null, costUids: [], costIds: [], targets: [], thisLoc: { where: 'field', zone } },
    });
    const t = S.turnState;
    const n = S.chain.length;
    return { kind: 'opp', text: r.text + paid + ' · Eslabón ' + n, turn: t.turn, phase: t.phase, mine: t.mine !== false, id: c.id, chainLink: n, reason: r.reason || '' };
  }
  function resolveKnown(S, i, L) {
    const cx = ctxOf(S);
    const K = KNOWN[L.known];
    if (!K) return [];
    const ops = [];
    const note = (t) => { if (t) ops.push({ op: 'note', text: 'CL' + (i + 1) + ' ' + q(L.known) + ': ' + lowerFirst(t) }); };
    const yours = /^Solemn /.test(L.known) ? solemnOps(cx, L) : K.ops ? K.ops(cx, L) : [];
    if (K.own) K.own(cx, L, { note });
    if (!yours.length && !ops.length) note('no hace nada: su objetivo ya no está.');
    return ops.concat(yours);
  }

  /** La tabla de cartas conocidas con la forma de la especificación: { name, when, cond(S, ev), score(S, ev), ops(S, ev, L) }. */
  const KNOWN_TABLE = KNOWN_NAMES.map((name) => {
    const K = KNOWN[name];
    const chk = (S, ev) => { try { return K.check(ctxOf(S), ev); } catch (err) { return null; } };
    return {
      name, when: K.when.slice(), cond: (S, ev) => !!chk(S, ev), score: (S, ev) => { const r = chk(S, ev); return r ? r.score : 0; },
      ops: (S, ev, L) => resolveKnown(S, Math.max(0, arr(S.chain).indexOf(L)), L),
    };
  });

  YGO.ai = {
    AI_VERBS, PRODUCTIVE, KNOWN: KNOWN_TABLE, KNOWN_NAMES, MAX_STEPS,
    runnable, next, run, resolveLink, negatedBy, negatedLink, afterChain, consider, commit,
    chooseAttack, value: (c, S, uid) => value(c, S && S.opp ? ctxOf(S) : null, uid), condKind,
    score: (S, uid, idx) => { const r = runnable(S, uid, idx); return r ? r.score : null; },
  };
})();
