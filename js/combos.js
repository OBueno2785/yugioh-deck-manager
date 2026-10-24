/* Combos grabados para el rival del modo VS.
 * En Prueba juegas una vez tu turno con un mazo y js/field.js guarda las fotos de cada jugada; build() las convierte en
 * pasos (activar, invocar, mover) que nombran las cartas por referencia. En VS, cuando el rival usa ese mazo, js/ai.js le
 * pide aquí la próxima jugada: si su mano tiene las cartas para empezar una línea, la repite con sus cartas reales.
 * Si lo interrumpes (Ash Blossom, Droll & Lock Bird, Nibiru, Effect Veiler...), lo que dependía de eso no se hace y la
 * línea se corta en el primer paso que ya no puede hacer; desde ahí sigue la IA de siempre.
 * Expone window.YGO.combos. Se guarda en localStorage (clave 'simulador-yugioh:combos'); sin almacenamiento sigue en
 * memoria. Lo oculto del rival sigue oculto: los textos salen de YGO.duel (moveText) y lo colocado no se nombra. */
(function () {
  const YGO = (window.YGO = window.YGO || {});
  const db = YGO.db;
  const T = db.T;
  const D = () => YGO.duel || null;
  const R = () => YGO.rules || null;

  const KEY = 'simulador-yugioh:combos';
  const CAP = 30;         // combos guardados por mazo (se borran los más viejos)
  const MAX_STEPS = 120;  // pasos de un combo
  const EMZ = ['emz0', 'emz1'];
  const MZ = ['mz0', 'mz1', 'mz2', 'mz3', 'mz4'];
  const MON = [...EMZ, ...MZ];
  const ST = ['st0', 'st1', 'st2', 'st3', 'st4'];
  const FIELD = [...MON, ...ST, 'fz'];
  const PILES = ['hand', 'deck', 'extra', 'gy', 'ban'];
  // Invocaciones que hace un efecto al resolverse (van con su eslabón); las demás son un paso propio
  const EFFECT_SUMMONS = ['special', 'fusion', 'ritual'];
  const NORMAL_SUMMONS = ['normal', 'tribute', 'set', 'tributeSet'];

  const arr = (x) => (Array.isArray(x) ? x : []);
  const copy = (x) => JSON.parse(JSON.stringify(x));
  const q = (n) => '«' + n + '»';
  const nameById = (id) => { const c = db.get(id); return c ? c.name : 'Carta ' + id; };
  const isMonId = (id) => { const c = db.get(id); return !!(c && db.isMonster(c)); };
  const turnOf = (S) => Number(S && S.turnState && S.turnState.turn) || 1;
  const lowerFirst = (s) => (/^El rival\b/.test(s) ? 'e' + s.slice(1) : s);
  const listEs = (xs) => (xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' y ' + xs[xs.length - 1]);

  /* ---------- Guardar (por mazo) ---------- */
  let cache = null; // { [deckId]: [combo] }
  function all() {
    if (cache) return cache;
    try {
      const v = JSON.parse(localStorage.getItem(KEY) || '{}');
      cache = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    } catch (e) { cache = {}; }
    return cache;
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(all())); return true; } catch (e) { return false; }
  }
  /** Antes de cambiar algo, relee lo guardado (otra pestaña pudo grabar un combo); sin almacenamiento sigue en memoria. */
  function reload() {
    try { localStorage.getItem(KEY); cache = null; } catch (e) { /* sin almacenamiento: queda lo de memoria */ }
  }
  try { window.addEventListener('storage', (e) => { if (!e || e.key === KEY || e.key === null) cache = null; }); } catch (e) { /* sin eventos */ }
  const keyOf = (deckId) => String(deckId == null || deckId === '' ? 'sin-mazo' : deckId);
  const isArr = Array.isArray;
  const okMove = (m) => !!(m && typeof m === 'object' && Number.isInteger(m.r) && m.from && typeof m.from.a === 'string' && m.to && typeof m.to.a === 'string');
  const okStep = (st) => !!st && (st.t === 'act' ? isArr(st.links) && st.links.length > 0 && st.links.every((l) => l && Number.isInteger(l.r)) && isArr(st.pre) && isArr(st.res) && st.pre.concat(st.res).every(okMove)
    : st.t === 'summon' ? Number.isInteger(st.r) && typeof st.method === 'string' && !!st.to && isArr(st.mats) && isArr(st.extra) && st.mats.concat(st.extra).every(okMove)
      : st.t === 'move' ? isArr(st.moves) && st.moves.every(okMove) : false);
  const valid = (c) => !!(c && typeof c === 'object' && !isArr(c) && c.id && Number(c.v) === 1 && isArr(c.steps) && isArr(c.refs) && c.steps.every(okStep));
  function slot(deckId) {
    const d = all();
    const k = keyOf(deckId);
    d[k] = arr(d[k]).filter(valid);
    return d[k];
  }
  /** Los combos de un mazo (copias), el más nuevo primero. */
  function list(deckId) { return slot(deckId).map(copy); }
  /** Cuántos tiene un mazo (onlyOn: solo los que el rival usa). */
  function count(deckId, onlyOn) { return slot(deckId).filter((c) => !onlyOn || c.enabled !== false).length; }
  /** Un combo por su id (en cualquier mazo) o null. Sin copia: no se cambia. */
  function find(id) {
    const d = all();
    for (const k of Object.keys(d)) { const c = arr(d[k]).find((x) => valid(x) && x.id === id); if (c) return c; }
    return null;
  }
  function get(id) { const c = find(id); return c ? copy(c) : null; }
  /** Guarda un combo nuevo (de build) → el combo guardado | null. Si el navegador no deja guardar (almacenamiento lleno o
   * bloqueado), queda en memoria hasta cerrar la página y vuelve con unsaved: true. */
  function add(combo) {
    if (!valid(combo)) return null;
    reload();
    const s = slot(combo.deckId);
    const c = copy(combo);
    s.unshift(c);
    while (s.length > CAP) s.pop();
    const out = copy(c);
    if (!save()) out.unsaved = true;
    return out;
  }
  /** Cambia el nombre o si el rival lo usa: patch = { name?, enabled? } → el combo | null */
  function update(id, patch) {
    reload();
    const c = find(id);
    if (!c || !patch) return null;
    if (typeof patch.name === 'string' && patch.name.trim()) c.name = patch.name.trim().slice(0, 80);
    if (patch.enabled !== undefined) c.enabled = !!patch.enabled;
    save();
    return copy(c);
  }
  function remove(id) {
    reload();
    const d = all();
    let gone = false;
    for (const k of Object.keys(d)) {
      const n = arr(d[k]).length;
      d[k] = arr(d[k]).filter((x) => !(x && x.id === id));
      if (d[k].length !== n) gone = true;
    }
    if (gone) save();
    return gone;
  }

  /* ---------- Grabar: fotos → pasos ---------- */
  /** Dónde está cada carta en una foto de field.js: uid → { a: pila|'field'|'mat', z, fd, def, sm, st, host, i, id, tok, opp } */
  function locsOf(S) {
    const m = new Map();
    for (const p of PILES) {
      arr(S[p]).forEach((x, i) => {
        if (!x || !x.uid) return;
        m.set(x.uid, { a: p, i, n: arr(S[p]).length, id: Number(x.id) || 0, fd: p === 'ban' && !!x.faceDown, fu: p === 'extra' && !!x.extraFaceUp, tok: x.token || null, opp: x.owner === 'opp' });
      });
    }
    for (const z of FIELD) {
      const L = arr(S.zones && S.zones[z]);
      L.forEach((x, i) => {
        if (!x || !x.uid) return;
        if (i === 0) {
          m.set(x.uid, { a: 'field', z, id: Number(x.id) || 0, fd: !!x.faceDown, def: !!x.def, sm: x.summonMethod || null,
            st: x.summonedTurn != null ? Number(x.summonedTurn) : null, tok: x.token || null, opp: x.owner === 'opp' });
        } else m.set(x.uid, { a: 'mat', z, host: L[0].uid, id: Number(x.id) || 0, tok: null, opp: x.owner === 'opp' });
      });
    }
    return m;
  }
  function changed(a, b) {
    if (a.a !== b.a) return true;
    if (a.a === 'field') return a.z !== b.z || a.fd !== b.fd || a.def !== b.def || a.sm !== b.sm || a.st !== b.st;
    if (a.a === 'mat') return a.host !== b.host;
    if (a.a === 'ban') return a.fd !== b.fd;
    if (a.a === 'extra') return a.fu !== b.fu;
    return false;
  }
  /** Datos de una ficha para volver a crearla (su carta virtual y inst.token). */
  function tokRow(l) {
    const c = db.get(l.id) || {};
    const t = l.tok || {};
    return { id: l.id, name: c.name || t.name || 'Ficha', atk: Number(c.atk != null ? c.atk : t.atk) || 0, def: Number(c.def != null ? c.def : t.def) || 0,
      lv: Number(c.lv || t.level) || 1, race: Number(c.race) || 0x100, attr: Number(c.attribute) || 0x10, token: Object.assign({}, t) };
  }
  const normFrom = (from) => (FIELD.includes(from) ? 'field' : PILES.includes(from) ? from : 'hand');
  const doneN = (S) => arr(S && S.chain).filter((l) => l && l.done).length;
  /** El eslabón al que se refiere el registro de esta jugada ("Resuelve CL2", "CL2: añade..."): índice o -1 */
  function clOf(logs, n) {
    const seen = new Set();
    for (const e of logs) {
      if (!e || (e.kind !== 'auto' && e.kind !== 'resolve')) continue;
      const m = /^(?:Resuelve |Haz a mano \()?CL\s?(\d+)\b/.exec(String(e.text || ''));
      if (m) seen.add(Number(m[1]));
    }
    if (seen.size !== 1) return -1;
    const k = [...seen][0] - 1;
    return k >= 0 && k < n ? k : -1;
  }
  /** ¿Se resolvieron varios eslabones en esta jugada? (no se sabe de cuál es cada cosa) */
  function resolvedMany(logs) {
    const seen = new Set();
    for (const e of logs) {
      if (!e || (e.kind !== 'auto' && e.kind !== 'resolve')) continue;
      const m = /^(?:Resuelve |Haz a mano \()?CL\s?(\d+)\b/.exec(String(e.text || ''));
      if (m) seen.add(Number(m[1]));
    }
    return seen.size > 1;
  }
  /** Índice del efecto que activa la carta (Mágica/Trampa boca arriba sin declarar) */
  function activationIndex(id) {
    const c = db.get(id);
    try { const e = c && R() ? R().effectsOf(c).find((x) => x.kind === 'activation') : null; return e ? e.index : 1; } catch (err) { return 1; }
  }

  /** Arma el combo con las fotos del turno (la primera: cuando empezó a grabar; la última: ahora).
   * opts = { deckId, deckName, name } → { ok, why?, combo } */
  function build(states, opts) {
    opts = opts || {};
    states = arr(states).filter((s) => s && typeof s === 'object');
    if (states.length < 2) return { ok: false, why: 'No grabaste ninguna jugada.' };
    const S0 = states[0];
    if (FIELD.some((z) => arr(S0.zones && S0.zones[z]).length) || arr(S0.gy).length || arr(S0.ban).length || arr(S0.chain).length) {
      return { ok: false, why: 'La grabación tiene que empezar con el campo, el Cementerio y las desterradas vacíos.' };
    }
    const turn0 = turnOf(S0);
    const own = new Set();
    ['hand', 'deck', 'extra'].forEach((p) => arr(S0[p]).forEach((x) => { if (x && x.uid) own.add(x.uid); }));
    const refs = [];
    const refOf = new Map();
    const ref = (uid, from, l) => {
      if (refOf.has(uid)) return refOf.get(uid);
      const e = { id: Number(l.id) || 0, from };
      if (from === 'token') e.tok = tokRow(l);
      refs.push(e);
      refOf.set(uid, refs.length - 1);
      return refs.length - 1;
    };
    const steps = [];
    let group = null; // { step, state: 'chain' | 'post' }
    let last = 0;     // última foto que se usó (para el campo final)
    let skipped = 0;
    let afterTurn = false;
    for (let k = 0; k + 1 < states.length; k++) {
      const A = states[k], B = states[k + 1];
      const tA = A.turnState || {}, tB = B.turnState || {};
      // Pasaste el turno: ahí termina (afterTurn: hiciste algo más después, que no se graba)
      if (turnOf(B) !== turn0 || tB.mine === false) {
        const rest = arr(states[states.length - 1].log).slice(arr(A.log).length);
        afterTurn = rest.some((e) => e && !['phase', 'draw', 'opp', 'vs', 'resolve'].includes(e.kind));
        break;
      }
      const ph = tA.phase || 'main1';
      const phaseChange = (tB.phase || '') !== (tA.phase || '');
      const logs = arr(B.log).slice(arr(A.log).length);
      const la = locsOf(A), lb = locsOf(B);
      let raw = [];
      for (const [uid, b] of lb) {
        if (b.opp) continue;
        const a = la.get(uid);
        if (!a) {
          if (b.tok && b.a === 'field') { own.add(uid); raw.push({ uid, a: { a: 'new', id: b.id }, b }); }
          continue;
        }
        if (!own.has(uid) || a.opp) continue;
        if (changed(a, b)) raw.push({ uid, a, b });
      }
      for (const [uid, a] of la) if (!lb.has(uid) && own.has(uid) && !a.opp) raw.push({ uid, a, b: { a: 'gone' } });
      const drew = logs.some((e) => e && e.kind === 'draw');
      const isDraw = (m) => drew && m.a.a === 'deck' && m.b.a === 'hand';
      if (ph === 'draw') raw = raw.filter((m) => !isDraw(m)); // el robo de la Fase de Robo (en VS ya robó)
      last = k + 1;
      if (ph === 'battle' || ph === 'end') { if (raw.length) skipped++; group = null; continue; }
      const isSum = (m) => m.b.a === 'field' && MON.includes(m.b.z) && !!m.b.sm && Number(m.b.st) === turn0
        && (m.a.a !== 'field' || m.a.sm !== m.b.sm || m.a.st !== m.b.st);
      // Referencias: primero las cartas que van arriba de una zona (un material nombra a su monstruo)
      raw.sort((x, y) => (x.b.a === 'mat') - (y.b.a === 'mat'));
      const toMove = (m) => {
        const r = m.a.a === 'new' ? ref(m.uid, 'token', m.b) : ref(m.uid, isDraw(m) ? 'draw' : m.a.a, m.a);
        const from = { a: m.a.a };
        if (m.a.a === 'field') { from.z = m.a.z; if (m.a.fd) from.fd = true; }
        const to = { a: m.b.a };
        if (m.b.a === 'field') { to.z = m.b.z; if (m.b.fd) to.fd = true; if (m.b.def) to.def = true; }
        else if (m.b.a === 'mat') to.host = refOf.has(m.b.host) ? refOf.get(m.b.host) : -1;
        else if (m.b.a === 'ban' && m.b.fd) to.fd = true;
        else if (m.b.a === 'extra' && m.b.fu) to.fu = true;
        else if (m.b.a === 'deck') { if (m.b.i === 0) to.top = true; else if (m.b.i === m.b.n - 1) to.bottom = true; }
        const mv = { r, from, to };
        if (isSum(m)) mv.sum = m.b.sm;
        if (isDraw(m)) mv.draw = true;
        return mv;
      };
      const chA = arr(A.chain), chB = arr(B.chain);
      const declared = chB.length > chA.length ? chB.slice(chA.length).filter((l) => l && l.owner !== 'opp') : [];
      // 1) Declaraste un efecto: un paso de activación nuevo (o se suma al de la cadena abierta)
      if (declared.length) {
        if (!(group && group.state === 'chain' && chA.length)) {
          group = { step: { t: 'act', links: [], pre: [], res: [] }, state: 'chain' };
          steps.push(group.step);
        }
        const ms = raw.map(toMove);
        for (const l of declared) {
          const at = la.get(l.uid);
          if (!at || !own.has(l.uid)) continue;
          const r = ref(l.uid, at.a, at);
          group.step.links.push({ r, id: Number(l.id) || at.id, eff: Number(l.effectIndex) || 0, from: normFrom(l.from || at.a), kind: String(l.kind || ''),
            speed: Number(l.speed) || 1, cardAct: !!l.cardAct, text: String(l.text || '').slice(0, 400) });
        }
        group.step.pre.push(...ms);
        continue;
      }
      // 2) Con la cadena abierta: antes de resolver son costos; al resolver, lo que hace cada eslabón
      if (group && group.state === 'chain') {
        const resolving = !chB.length || doneN(B) > doneN(A) || doneN(A) > 0 || logs.some((e) => e && e.kind === 'resolve');
        const ms = raw.map(toMove);
        if (!resolving) group.step.pre.push(...ms);
        else {
          // El eslabón que se resuelve: el que nombra el registro de esta jugada, o el último que se resolvió (a mano: "Resuelve
          // CL2" y después mueves tú lo que hace)
          const named = clOf(logs, group.step.links.length);
          if (named >= 0) group.cur = named;
          else if (resolvedMany(logs)) group.cur = -1;
          const by = named >= 0 ? named : group.cur >= 0 ? group.cur : -1;
          ms.forEach((m) => { m.by = by; group.step.res.push(m); });
        }
        if (!chB.length) group.state = 'post';
        if (phaseChange) group = null;
        continue;
      }
      if (!raw.length) { if (phaseChange) group = null; continue; }
      // 3) Sin cadena
      const sums = raw.filter((m) => isSum(m) && m.a.a !== 'new'); // (una ficha nueva es un movimiento: la crea un efecto)
      // Después de una cadena, una Invocación Especial es lo que hizo el eslabón, salvo la que hiciste por su propio procedimiento
      const ownProc = logs.some((e) => e && e.kind === 'summon' && /\(por su propio (?:procedimiento|efecto)\)/.test(String(e.text || '')));
      const own1 = sums.filter((m) => !(group && group.state === 'post' && EFFECT_SUMMONS.includes(m.b.sm) && !ownProc));
      if (own1.length) {
        // Invocación propia (Normal, Sacrificio, Link, Xyz, Sincronía, Péndulo...) con sus materiales
        group = null;
        const rest = raw.filter((m) => !own1.includes(m));
        own1.forEach((m, j) => {
          const st = { t: 'summon', r: ref(m.uid, m.a.a, m.a), id: m.b.id, method: m.b.sm, from: m.a.a, to: { z: m.b.z }, mats: [], extra: [] };
          if (ownProc && EFFECT_SUMMONS.includes(m.b.sm)) st.own = true;
          if (m.b.fd) st.to.fd = true;
          if (m.b.def) st.to.def = true;
          if (j === 0) {
            for (const x of rest) {
              const mat = (x.a.a === 'field' || x.a.a === 'mat') && (['gy', 'ban', 'extra', 'gone'].includes(x.b.a) || (x.b.a === 'mat' && x.b.host === m.uid));
              (mat ? st.mats : st.extra).push(toMove(x));
            }
          }
          steps.push(st);
        });
        if (phaseChange) group = null;
        continue;
      }
      const sets = raw.filter((m) => m.a.a === 'hand' && m.b.a === 'field' && m.b.fd);
      const actST = raw.find((m) => m.b.a === 'field' && !m.b.fd && (ST.includes(m.b.z) || m.b.z === 'fz') && !isMonId(m.b.id)
        && (m.a.a === 'hand' || (m.a.a === 'field' && m.a.fd && m.a.z === m.b.z)));
      if (sets.length) {
        group = null;
        steps.push({ t: 'move', moves: raw.map(toMove) });
      } else if (actST) {
        // Una Mágica/Trampa que pusiste boca arriba sin declarar: se toma como su activación (y lo que sigue, su efecto)
        const r = ref(actST.uid, actST.a.a, actST.a);
        const st = { t: 'act', links: [{ r, id: actST.b.id, eff: activationIndex(actST.b.id), from: actST.a.a === 'field' ? 'field' : 'hand', kind: 'activation', speed: 1, cardAct: true, inferred: true }],
          pre: [toMove(actST)], res: raw.filter((m) => m !== actST).map((m) => Object.assign(toMove(m), { by: -1 })) };
        steps.push(st);
        group = { step: st, state: 'post' };
      } else if (group && group.state === 'post') {
        const by = group.cur >= 0 ? group.cur : -1;
        raw.forEach((m) => group.step.res.push(Object.assign(toMove(m), { by })));
      } else steps.push({ t: 'move', moves: raw.map(toMove) });
      if (phaseChange) group = null;
    }
    // Limpieza: activaciones sin eslabón propio → movimientos; pasos vacíos fuera
    const out = [];
    for (const st of steps) {
      if (st.t === 'act' && !st.links.length) { const ms = st.pre.concat(st.res); if (ms.length) out.push({ t: 'move', moves: ms.map((m) => { delete m.by; return m; }) }); continue; }
      if (st.t === 'move' && !st.moves.length) continue;
      out.push(st);
    }
    if (!out.length) return { ok: false, why: 'No grabaste ninguna jugada.' };
    const cut = out.length > MAX_STEPS;
    const stepsF = out.slice(0, MAX_STEPS);
    const used = new Set();
    const useR = (r) => { if (typeof r === 'number' && r >= 0) used.add(r); };
    const useM = (m) => { useR(m.r); if (m.to && m.to.a === 'mat') useR(m.to.host); };
    stepsF.forEach((st) => {
      if (st.t === 'act') { st.links.forEach((l) => useR(l.r)); st.pre.forEach(useM); st.res.forEach(useM); }
      else if (st.t === 'summon') { useR(st.r); st.mats.forEach(useM); st.extra.forEach(useM); }
      else st.moves.forEach(useM);
    });
    const need = (from) => [...used].filter((r) => refs[r] && refs[r].from === from).map((r) => refs[r].id).sort((a, b) => a - b);
    const SL = states[last] || states[states.length - 1];
    const final = FIELD.map((z) => arr(SL.zones && SL.zones[z])[0]).filter((x) => x && x.owner !== 'opp' && !x.faceDown).map((x) => Number(x.id));
    const firstAct = stepsF.find((s) => s.t === 'act');
    const lead = firstAct ? nameById(firstAct.links[0].id) : stepsF[0].t === 'summon' ? nameById(stepsF[0].id) : '';
    const combo = {
      v: 1, id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), deckId: opts.deckId != null ? opts.deckId : null,
      deckName: String(opts.deckName || ''), name: String(opts.name || '').trim().slice(0, 80) || ('Combo con ' + q(lead || 'tu mano')),
      created: Date.now(), enabled: true, second: !!(S0.turnState && S0.turnState.turn > 1), refs, hand: need('hand'),
      needs: { deck: need('deck'), extra: need('extra') }, steps: stepsF, final, skipped, cut, afterTurn,
    };
    return { ok: true, combo };
  }

  /* ---------- Textos (la lista de pasos en Prueba: es tu combo, se nombra todo) ---------- */
  const PILE_ES = { hand: 'Mano', deck: 'Mazo', extra: 'Extra Deck', gy: 'Cementerio', ban: 'Desterradas', gone: 'desaparece', new: 'Ficha nueva', mat: 'material' };
  const METHOD_ES = { normal: 'Invocación Normal', tribute: 'Invocación por Sacrificio', set: 'Colocación', tributeSet: 'Colocación por Sacrificio',
    special: 'Invocación Especial', link: 'Invocación por Link', xyz: 'Invocación Xyz', synchro: 'Invocación por Sincronía', fusion: 'Invocación por Fusión',
    ritual: 'Invocación por Ritual', pendulum: 'Invocación por Péndulo', flip: 'Invocación por Volteo' };
  function zoneEs(z) {
    const m = /^(mz|st)([0-4])$/.exec(String(z));
    if (m) return (m[1] === 'mz' ? 'Zona de Monstruo ' : 'Zona de M/T ') + (Number(m[2]) + 1);
    if (EMZ.includes(z)) return 'Zona Extra';
    if (z === 'fz') return 'Zona de Campo';
    return 'campo';
  }
  const refName = (combo, r) => { const x = combo.refs[r]; return x ? q(x.tok ? x.tok.name : nameById(x.id)) : '«?»'; };
  function placeEs(combo, p) {
    if (!p) return '?';
    if (p.a === 'field') return zoneEs(p.z) + (p.fd ? ' (boca abajo)' : p.def ? ' (DEF)' : '');
    if (p.a === 'mat') return 'material de ' + refName(combo, p.host);
    if (p.a === 'deck') return 'Mazo' + (p.top ? ' (arriba)' : p.bottom ? ' (abajo)' : '');
    return PILE_ES[p.a] || p.a;
  }
  const moveEs = (combo, m) => refName(combo, m.r) + ': ' + (m.draw ? 'se roba' : placeEs(combo, m.from) + ' → ' + placeEs(combo, m.to));
  /** Un paso en palabras (para la lista de Prueba). → { title, detail: [texto] } */
  function describe(combo, st) {
    if (!combo || !st) return { title: '', detail: [] };
    if (st.t === 'act') {
      const names = st.links.map((l) => refName(combo, l.r));
      const title = (st.links.some((l) => l.inferred) ? 'Pone boca arriba ' : 'Activa ') + listEs(names) + (st.links.length > 1 ? ' (en cadena)' : '');
      const pre = st.pre.filter((m) => !st.links.some((l) => l.r === m.r && m.to.a === 'field'));
      const detail = [];
      if (pre.length) detail.push('Costo: ' + pre.map((m) => moveEs(combo, m)).join('; '));
      if (st.res.length) detail.push('Resuelve: ' + st.res.map((m) => moveEs(combo, m)).join('; '));
      return { title, detail };
    }
    if (st.t === 'summon') {
      const mats = st.mats.map((m) => refName(combo, m.r));
      const title = (METHOD_ES[st.method] || 'Invocación') + ' de ' + refName(combo, st.r) + ' en ' + zoneEs(st.to.z) + (mats.length ? ' (con ' + listEs(mats) + ')' : '');
      return { title, detail: st.extra.length ? ['Además: ' + st.extra.map((m) => moveEs(combo, m)).join('; ')] : [] };
    }
    const ms = arr(st.moves);
    return { title: ms.length === 1 ? moveEs(combo, ms[0]) : 'Mueve ' + ms.length + ' cartas', detail: ms.length > 1 ? [ms.map((m) => moveEs(combo, m)).join('; ')] : [] };
  }
  const handNames = (combo) => arr(combo && combo.hand).map((id) => q(nameById(id)));
  const finalNames = (combo) => arr(combo && combo.final).map((id) => q(nameById(id)));

  /* ---------- Repetir en VS ---------- */
  const isVs = (S) => !!(D() && S && S.vs && S.opp && S.opp.vs && D().isVs(S) && !S.vs.pvp);
  const on = (S) => isVs(S) && S.vs.combos !== false;
  const view = (S, fn) => D().withRival(S, fn);
  const where = (S, uid) => { try { return D().findRival(S, uid); } catch (e) { return null; } };
  const ids = (list) => arr(list).map((x) => Number(x && x.id));
  /** ¿Tiene el rival lo que pide el combo? (cada copia cuenta una vez) */
  function covers(have, want) {
    const left = have.slice();
    for (const id of arr(want)) { const i = left.indexOf(Number(id)); if (i < 0) return false; left.splice(i, 1); }
    return true;
  }
  function feasible(S, c) {
    const o = S.opp;
    return covers(ids(o.hand), c.hand) && covers(ids(o.deck), c.needs && c.needs.deck) && covers(ids(o.extra), c.needs && c.needs.extra);
  }
  /** Elige el combo de este turno (el de más pasos de los posibles) → guion | null */
  function start(S) {
    const o = S.opp;
    const mine = slot(o.deckId).filter((c) => c.enabled !== false && arr(c.steps).length);
    const ok = mine.filter((c) => feasible(S, c)).sort((a, b) => b.steps.length - a.steps.length || (Number(b.created) || 0) - (Number(a.created) || 0));
    if (!ok.length) return null;
    const c = ok[0];
    return { id: c.id, name: c.name, n: 0, total: c.steps.length, map: {}, done: false, cut: null, sumWin: null };
  }
  /** El guion de este turno (S.opp.ai lo reinicia js/ai.js en cada turno). */
  const scriptOf = (S) => (S && S.opp && S.opp.ai && S.opp.ai.script) || null;

  /** La próxima jugada del guion para js/ai.js (en sus Fases Principales, con la cadena vacía): { kind: 'script', key } | null */
  function nextAct(S, ai) {
    if (!on(S) || !ai) return null;
    if (!ai.script) {
      let sc = null;
      try { sc = start(S); } catch (err) { if (typeof console !== 'undefined') console.error('YGO.combos.start falló', err); }
      ai.script = sc || { none: true };
    }
    const sc = ai.script;
    if (sc.none || (sc.done && !sc.sumWin)) return null;
    const key = 'script:' + sc.id + ':' + sc.n + (sc.sumWin ? ':w' : '');
    // (js/ai.js marca en tried lo que no salió: el guion termina ahí y sigue la IA de siempre)
    if (ai.tried && ai.tried[key]) { sc.done = true; sc.sumWin = null; return null; }
    return { kind: 'script', key };
  }

  /** La carta del combo (ref r) que debería estar en area → { uid, f } | null. Sin asignar, toma una copia libre de esa
   * carta en ese lugar (del Mazo, la de arriba si es un robo). tmp: asignaciones de prueba (no cambian el guion). */
  function locate(S, sc, combo, r, area, opts) {
    opts = opts || {};
    const x = combo.refs[r];
    if (!x) return null;
    const map = opts.tmp ? Object.assign({}, sc.map, opts.tmp) : sc.map;
    const uid = map[r];
    if (uid) {
      const f = where(S, uid);
      if (!f || (area && f.where !== area) || (Number(f.inst.id) !== Number(x.id) && !x.tok)) return null;
      return { uid, f };
    }
    if (x.from === 'token') return null;
    const used = new Set(Object.values(map));
    const o = S.opp;
    let pick = null;
    if (opts.draw) pick = arr(o.deck).find((y) => y && !used.has(y.uid)) || null;
    else {
      const list = area === 'field' ? arr(o.field) : PILES.includes(area) ? arr(o[area]) : [];
      pick = list.find((y) => y && !used.has(y.uid) && Number(y.id) === Number(x.id)) || null;
    }
    if (!pick) return null;
    if (opts.tmp) opts.tmp[r] = pick.uid;
    return { uid: pick.uid, f: where(S, pick.uid) };
  }
  const negatedNow = (S, e) => !!(e && e.negated && Number(e.negated.turn) === turnOf(S));
  /** ¿Puede hacer este paso? (sus cartas están donde el paso las usa) → '' | por qué no (sin nombrar lo oculto) */
  function check(S, sc, combo, st) {
    const tmp = {};
    const at = (r, area, draw) => !!locate(S, sc, combo, r, area, { tmp, draw });
    const srcOk = (m) => {
      if (m.from.a === 'new') return true;
      if (m.from.a === 'deck' && m.draw) return at(m.r, 'deck', true);
      return at(m.r, m.from.a);
    };
    if (st.t === 'act') {
      for (const m of st.pre) if (!srcOk(m)) return 'falta una carta';
      for (const l of st.links) {
        const pm = st.pre.find((m) => m.r === l.r);
        const area = pm ? pm.from.a : l.from === 'field' ? 'field' : l.from;
        const hit = locate(S, sc, combo, l.r, area, { tmp });
        if (!hit) return 'falta una carta';
        if (hit.f.where !== 'field') continue;
        if (negatedNow(S, hit.f.entry)) return 'sus efectos están negados';
        // Boca abajo cuando la grabaste boca arriba (p. ej. un monstruo volteado por Book of Moon)
        if (hit.f.entry.faceDown && !(pm && pm.from.fd)) return 'está boca abajo';
      }
      return '';
    }
    if (st.t === 'summon') {
      if (!at(st.r, st.from)) return 'falta una carta';
      for (const m of st.mats) if (!srcOk(m)) return 'falta un material';
      return '';
    }
    for (const m of arr(st.moves)) if (!srcOk(m)) return 'falta una carta';
    return '';
  }
  function ensureToken(tok) {
    if (!tok || !tok.id || db.get(tok.id) || !db.addVirtual) return;
    try { db.addVirtual([[tok.id, tok.name, T.MONSTER | T.NORMAL | T.TOKEN, tok.atk, tok.def, tok.lv, tok.race, tok.attr, 3, 0, 'Ficha creada por un efecto. Desaparece cuando deja el campo.']]); } catch (e) { /* sin ficha virtual */ }
  }
  const nameOfEntry = (e) => (e && e.token && e.token.name) || nameById(e && e.id);
  /** Texto de lo que hizo place (sin nombrar lo que queda oculto). */
  function placeText(S, before, res) {
    const e = res.entry;
    const z = D().zoneLabel(res.zone);
    const name = q(nameOfEntry(e));
    const tail = '';
    const monZone = MON.includes(res.zone);
    if (e.faceDown) {
      if (before && before.where === 'field' && !before.wasDown) return 'El rival pone ' + name + ' boca abajo' + tail + '.';
      return (monZone ? 'El rival coloca 1 monstruo boca abajo en defensa (' + z + ')' : 'El rival coloca 1 carta boca abajo en ' + z) + tail + '.';
    }
    if (before && before.where === 'field') {
      if (before.wasDown) return 'Se voltea ' + name + ' del rival' + tail + '.';
      if (before.zone !== res.zone) return name + ' del rival se mueve a ' + z + tail + '.';
      if (before.def !== !!e.def) return 'El rival cambia ' + name + ' a posición de ' + (e.def ? 'Defensa' : 'Ataque') + tail + '.';
      return name + ' del rival sigue en ' + z + '.';
    }
    if (monZone && e.monster) {
      if (e.token) return 'El rival Invoca ' + name + ' en ' + z + (e.def ? ' en Defensa' : '') + tail + '.';
      return 'El rival Invoca de modo Especial ' + name + ' en ' + z + (e.def ? ' en Defensa' : '') + tail + '.';
    }
    if (e.asSpell) return 'El rival pone ' + name + ' en ' + z + ' como Mágica Continua' + tail + '.';
    return 'El rival pone ' + name + ' boca arriba en ' + z + tail + '.';
  }
  const HOW_PRE = { gy: 'cost', ban: 'banish', hand: 'hand', deck: 'deck' };
  /** Hace los movimientos en orden: a las pilas, después arriba de las zonas, después los materiales.
   * ctx = { pre (costos), mat (materiales: 'material' | 'tribute'), quiet: Set de refs que no se anuncian al ponerse en el campo,
   *   ops: [] (tu carta que estaba en su campo y vuelve a ti) }
   * → { logs: [texto], failed, refused, summoned: [nombre] } */
  function applyMoves(S, sc, combo, moves, ctx) {
    ctx = ctx || {};
    const out = { logs: [], failed: 0, refused: 0, summoned: [] };
    const phase = (m) => (m.to.a === 'mat' ? 2 : m.to.a === 'field' ? 1 : 0);
    // (la misma carta que se mueve dos veces va en el orden en que se grabó: Mazo → campo → Cementerio)
    const list = arr(moves).map((m, i) => ({ m, i })).sort((x, y) => (x.m.r === y.m.r ? x.i - y.i : phase(x.m) - phase(y.m) || x.i - y.i)).map((x) => x.m);
    for (const m of list) {
      const to = m.to || {};
      // Ficha nueva
      if (m.from.a === 'new') {
        const x = combo.refs[m.r];
        if (!x || !x.tok || to.a !== 'field') continue;
        ensureToken(x.tok);
        const res = D().place(S, null, { token: { id: x.tok.id, token: x.tok.token }, zone: to.z, def: !!to.def, faceDown: !!to.fd, method: 'special' });
        if (!res.ok) { out.failed++; continue; }
        sc.map[m.r] = res.entry.uid;
        out.logs.push(placeText(S, null, res));
        if (!res.entry.faceDown) out.summoned.push(q(nameOfEntry(res.entry)));
        continue;
      }
      let hit = locate(S, sc, combo, m.r, m.from.a, { draw: m.from.a === 'deck' && m.draw });
      if (!hit) {
        // Ya está donde iba (p. ej. la Mágica Normal que el campo mandó al Cementerio al cerrar la cadena): nada que hacer
        const uid = sc.map[m.r];
        const f = uid ? where(S, uid) : null;
        if (uid && (to.a === 'gone' ? !f : f && f.where === to.a)) continue;
        out.failed++;
        continue;
      }
      sc.map[m.r] = hit.uid;
      const f = hit.f;
      if (to.a === 'gone') {
        const r = D().leave(S, hit.uid, 'gy', '');
        if (r && r.text) out.logs.push(r.text);
        continue;
      }
      if (PILES.includes(to.a)) {
        let how = '';
        if (ctx.pre) how = f.where === 'hand' && to.a === 'gy' ? 'discard' : HOW_PRE[to.a] || '';
        else if (ctx.mat) how = to.a === 'gy' ? ctx.mat : '';
        if (to.a === 'ban' && to.fd) how = 'banishFD';
        const r = D().moveRival(S, hit.uid, to.a, { how, by: '', top: !!to.top, bottom: !!to.bottom, faceDown: !!to.fd, faceUp: !!to.fu, draw: !!m.draw });
        if (!r || r.ok === false) { out.refused++; if (r && r.text) out.logs.push(r.text); continue; }
        if (r.text) out.logs.push(r.text);
        // Su carta en el campo del rival (Contact "C"...) vuelve a ti: lo hace field.js
        if (arr(r.ops).length && ctx.ops) ctx.ops.push(...r.ops);
        continue;
      }
      if (to.a === 'field') {
        const before = f.where === 'field' ? { where: 'field', zone: f.entry.zone, wasDown: !!f.entry.faceDown, def: !!f.entry.def } : { where: f.where };
        const entering = f.where !== 'field';
        const isMon = isMonId(f.inst.id) || !!f.inst.token;
        const method = m.sum || (entering && MON.includes(to.z) && !to.fd && isMon ? 'special' : null);
        const res = D().place(S, hit.uid, { zone: to.z, faceDown: !!to.fd, def: !!to.def, method });
        if (!res.ok) { out.failed++; continue; }
        arr(res.extra).forEach((t) => out.logs.push(t));
        if (!(ctx.quiet && ctx.quiet.has(m.r))) out.logs.push(placeText(S, before, res));
        if (entering && MON.includes(res.zone) && !res.entry.faceDown && res.entry.monster) out.summoned.push(q(nameOfEntry(res.entry)));
        continue;
      }
      if (to.a === 'mat') {
        const host = sc.map[to.host];
        const hf = host ? where(S, host) : null;
        if (!hf || hf.where !== 'field') { out.failed++; continue; }
        const name = q(nameOfEntry(f.inst));
        const res = D().place(S, hit.uid, { under: host });
        if (!res.ok) { out.failed++; continue; }
        out.logs.push(name + ' queda como material de ' + (hf.entry.faceDown ? '1 monstruo boca abajo' : q(nameOfEntry(hf.entry))) + ' del rival.');
      }
    }
    return out;
  }

  /** Lo del rival que puede cambiar un paso del guion, para volver atrás si el paso no se puede hacer. */
  const OPP_KEYS = ['hand', 'deck', 'extra', 'gy', 'ban', 'field'];
  function snapOpp(S) {
    const o = S.opp;
    return JSON.stringify({ piles: OPP_KEYS.map((k) => arr(o[k])), rseq: o.rseq, rng: o.rng, ts: o.ts || null });
  }
  function restoreOpp(S, snap) {
    const o = S.opp;
    const v = JSON.parse(snap);
    OPP_KEYS.forEach((k, i) => { if (Array.isArray(o[k])) o[k].splice(0, o[k].length, ...v.piles[i]); else o[k] = v.piles[i]; });
    o.rseq = v.rseq;
    o.rng = v.rng;
    if (v.ts) o.ts = v.ts;
    try { D().sync(S); } catch (e) { /* nada */ }
  }
  const textOf = (r, fallback) => (r && typeof r.text === 'string' && r.text ? r.text : fallback);
  const cutLog = (sc, why) => ({ kind: 'opp', text: 'El rival no puede seguir su combo (paso ' + (sc.n + 1) + ' de ' + sc.total + (why ? ': ' + why : '') + '): sigue jugando por su cuenta.' });
  /** Hace el próximo paso del guion (lo llama js/ai.js con act.kind === 'script') → { ok, logs: [{ kind, text }], window } */
  function run(S, act) {
    const ai = S && S.opp && S.opp.ai;
    const sc = ai && ai.script;
    if (!sc || sc.none) return { ok: false, why: 'Sin combo', logs: [], window: null };
    const snap = snapOpp(S);
    const chain0 = arr(S.chain).length;
    try { return runStep(S, sc); } catch (err) {
      if (typeof console !== 'undefined') console.error('YGO.combos.run falló', err);
      restoreOpp(S, snap);
      if (Array.isArray(S.chain)) S.chain.length = Math.min(S.chain.length, chain0);
      sc.done = true;
      sc.sumWin = null;
      return { ok: true, logs: [cutLog(Object.assign({}, sc, { n: Math.max(0, sc.n - 1) }), '')], window: null };
    }
  }
  function runStep(S, sc) {
    // Monstruos que Invocó al resolver su eslabón: puedes responder ahora
    if (sc.sumWin) {
      const t = sc.sumWin;
      sc.sumWin = null;
      return { ok: true, logs: [], window: { kind: 'summon', text: t } };
    }
    if (sc.done) return { ok: false, why: 'Combo terminado', logs: [], window: null };
    const combo = find(sc.id);
    const st = combo ? combo.steps[sc.n] : null;
    if (!st) { sc.done = true; return { ok: true, logs: [], window: null }; }
    const why = check(S, sc, combo, st);
    if (why) { sc.done = true; sc.cut = sc.n; return { ok: true, logs: [cutLog(sc, why)], window: null }; }
    const n = sc.n;
    sc.n++;
    if (sc.n >= sc.total) sc.done = true;
    if (st.t === 'act') return runAct(S, sc, combo, st, n);
    if (st.t === 'summon') return runSummon(S, sc, combo, st);
    const r = applyMoves(S, sc, combo, st.moves, { pre: false });
    const logs = r.logs.map((t) => ({ kind: 'opp', text: t }));
    if (r.summoned.length) return { ok: true, logs, window: { kind: 'summon', text: 'El rival Invoca ' + listEs(r.summoned) + '. Puedes responder.' } };
    return { ok: true, logs, window: null };
  }
  function runAct(S, sc, combo, st, n) {
    const logs = [];
    const say = (t) => { if (t) logs.push({ kind: 'opp', text: t }); };
    // Antes de mover nada: dónde está cada carta que activa (boca abajo = estaba Colocada)
    const links = [];
    for (const l of st.links) {
      const pm = st.pre.find((m) => m.r === l.r);
      const area = pm ? pm.from.a : l.from;
      const hit = locate(S, sc, combo, l.r, area);
      if (!hit) { sc.done = true; return { ok: true, logs: [cutLog(Object.assign({}, sc, { n }), 'falta una carta')], window: null }; }
      sc.map[l.r] = hit.uid;
      links.push({ l, uid: hit.uid, wasSet: hit.f.where === 'field' && !!hit.f.entry.faceDown });
    }
    // Costos y la carta que se pone en su zona (eso no se anuncia: ya dice que la activa). Si algo no se puede (zona
    // ocupada, Lancea...), todo vuelve como estaba y no se nombra nada: la carta sigue oculta en su mano
    const snap = snapOpp(S);
    const quiet = new Set(st.links.map((l) => l.r));
    const map0 = Object.assign({}, sc.map);
    const pre = applyMoves(S, sc, combo, st.pre, { pre: true, quiet });
    if (pre.refused || pre.failed) {
      restoreOpp(S, snap);
      sc.map = map0;
      sc.done = true;
      sc.cut = n;
      logs.push(cutLog(Object.assign({}, sc, { n }), 'no pudo pagar'));
      return { ok: true, logs, window: null };
    }
    links.forEach((x) => say('El rival activa ' + q(nameById(x.l.id)) + (x.wasSet ? ' (estaba boca abajo)' : '') + '.'));
    pre.logs.forEach(say);
    if (!Array.isArray(S.chain)) S.chain = [];
    const base = S.chain.length;
    links.forEach((x, k) => {
      const l = x.l;
      try { view(S, (vw) => R().commitActivation(vw, { uid: x.uid, effectIndex: l.eff }, { ok: true, errors: [], warnings: [] })); } catch (err) { /* el registro nunca rompe el combo */ }
      const now = where(S, x.uid);
      S.chain.push({
        owner: 'opp', ai: true, script: { id: combo.id, step: n, k, of: st.links.length }, uid: x.uid, id: l.id, effectIndex: l.eff, text: l.text || '',
        speed: l.speed || 1, kind: l.kind || 'activation', cardAct: !!l.cardAct, from: l.from,
        aiRun: { option: null, costUids: [], costIds: [], targets: [], thisLoc: { where: now ? now.where : l.from, zone: now && now.zone ? now.zone : null } },
      });
    });
    const cls = links.map((x, k) => q(nameById(x.l.id)) + ' (CL' + (base + k + 1) + ')');
    return { ok: true, logs, window: { kind: 'activation', text: 'El rival activa ' + listEs(cls) + '. Puedes responder.' } };
  }
  function runSummon(S, sc, combo, st) {
    const logs = [];
    const say = (t) => { if (t) logs.push({ kind: 'opp', text: t }); };
    const cut = (why) => { sc.done = true; logs.push(cutLog(Object.assign({}, sc, { n: sc.n - 1 }), why)); return { ok: true, logs, window: null }; };
    const hit = locate(S, sc, combo, st.r, st.from);
    if (!hit) return cut('falta una carta');
    sc.map[st.r] = hit.uid;
    const name = nameById(st.id);
    const xyz = st.mats.filter((m) => m.to.a === 'mat');
    const other = st.mats.filter((m) => m.to.a !== 'mat');
    // Cada material, una carta distinta (dos copias de la misma carta no son el mismo material)
    const tmp = {};
    const matUids = st.mats.map((m) => { const h = locate(S, sc, combo, m.r, m.from.a, { tmp }); return h ? h.uid : null; }).filter(Boolean);
    Object.assign(sc.map, tmp);
    const matNames = matUids.map((u) => { const f = where(S, u); return f ? q(nameOfEntry(f.inst)) : ''; }).filter(Boolean);
    const pos = st.to.fd ? 'set' : st.to.def ? 'def' : 'atk';
    const req = { uid: hit.uid, method: st.method, materials: matUids.slice(), position: pos, zone: st.to.z };
    if (st.own) { req.ownProcedure = true; req.source = 'su propio procedimiento'; }
    // La Invocación Normal (o Colocar) del turno: si ya la usó (p. ej. negaste lo que le daba otra), la línea se corta
    if (NORMAL_SUMMONS.includes(st.method)) {
      let v = null;
      try { v = view(S, (vw) => R().checkSummon(vw, Object.assign({}, req))); } catch (err) { v = null; }
      if (v && !v.ok && arr(v.errors).some((e) => /Ya usaste tu Invocación Normal/.test(e))) return cut('ya usó su Invocación Normal');
    }
    // Materiales y la carta a su zona; si no hay zona, todo vuelve como estaba
    const snap = snapOpp(S);
    const map0 = Object.assign({}, sc.map);
    const how = ['tribute', 'tributeSet'].includes(st.method) ? 'tribute' : 'material';
    const m1 = applyMoves(S, sc, combo, other, { mat: how });
    const xyzUids = xyz.map((m) => { const h = locate(S, sc, combo, m.r, m.from.a); if (h) sc.map[m.r] = h.uid; return h ? h.uid : null; }).filter(Boolean);
    const res = D().place(S, hit.uid, { zone: st.to.z, faceDown: !!st.to.fd, def: !!st.to.def, method: st.method, mats: xyzUids });
    if (!res.ok) { restoreOpp(S, snap); sc.map = map0; return cut('no hay zona libre'); }
    // Las reglas cuentan la Invocación (Normal del turno, Invocaciones Especiales, "una vez por turno")
    try { view(S, (vw) => R().commitSummon(vw, req, { ok: true, errors: [], warnings: [], from: { [hit.uid]: st.from } })); } catch (err) { /* el registro nunca rompe el combo */ }
    const z = D().zoneLabel(res.zone);
    const mats = matNames.join(', ');
    const N = q(name);
    let text;
    switch (st.method) {
      case 'normal': text = 'El rival Invoca de modo Normal ' + N + ' en ' + z + '.'; break;
      case 'tribute': text = 'El rival Invoca por Sacrificio ' + N + ' en ' + z + (mats ? ' (sacrificando ' + mats + ')' : '') + '.'; break;
      case 'set': text = 'El rival coloca 1 monstruo boca abajo en defensa (' + z + ').'; break;
      case 'tributeSet': text = 'El rival coloca 1 monstruo boca abajo en defensa (' + z + ')' + (mats ? ', sacrificando ' + mats : '') + '.'; break;
      case 'link': text = 'El rival Invoca por Link ' + N + ' (materiales: ' + mats + ').'; break;
      case 'xyz': text = 'El rival Invoca por Xyz ' + N + ' (materiales: ' + mats + ').'; break;
      case 'synchro': text = 'El rival Invoca por Sincronía ' + N + ' (materiales: ' + mats + ').'; break;
      case 'fusion': text = 'El rival Invoca por Fusión ' + N + (mats ? ' (materiales: ' + mats + ')' : '') + '.'; break;
      case 'ritual': text = 'El rival Invoca por Ritual ' + N + (mats ? ' (liberando ' + mats + ')' : '') + '.'; break;
      case 'pendulum': text = 'El rival Invoca por Péndulo ' + N + ' en ' + z + '.'; break;
      case 'flip': text = 'El rival Invoca por Volteo ' + N + ' en ' + z + '.'; break;
      default: text = res.entry.faceDown ? 'El rival Invoca de modo Especial 1 monstruo boca abajo en defensa (' + z + ').' : 'El rival Invoca de modo Especial ' + N + ' en ' + z + '.';
    }
    if (res.entry.def && !res.entry.faceDown && !/Defensa/.test(text)) text = text.replace(/\.$/, ', en Defensa.');
    say(text);
    m1.logs.filter((t) => !/como material|sacrificad/.test(t)).forEach(say);
    const ex = applyMoves(S, sc, combo, st.extra, {});
    ex.logs.forEach(say);
    if (res.entry.faceDown) return { ok: true, logs, window: null };
    let atk = 0;
    try { atk = Number(D().stats(S, 'rival', res.entry).atk) || 0; } catch (err) { atk = 0; }
    return { ok: true, logs, window: { kind: 'summon', text: 'El rival Invoca ' + N + ' (ATK ' + atk + '). Puedes responder.' } };
  }

  /** Los movimientos de res que hace el eslabón L (con su índice en la cadena i). */
  /** Con varios eslabones en el paso, lo que no se sabe de cuál es: el único cuyo texto lo dice (robar → "draw"; del Mazo →
   * "Deck") → índice | -1 */
  function guessBy(st, m) {
    const links = arr(st.links);
    if (links.length < 2) return links.length ? 0 : -1;
    const textOfLink = (l) => String(l.text || (db.get(l.id) || {}).desc || '').replace(/Extra Deck/g, '');
    const re = m.draw ? /\bdraw/i : m.from && m.from.a === 'deck' ? /\bDeck\b/ : null;
    if (!re) return -1;
    const hits = links.map((l, k) => (re.test(textOfLink(l)) ? k : -1)).filter((k) => k >= 0);
    return hits.length === 1 ? hits[0] : -1;
  }
  const byOf = (st, m) => (m.by >= 0 ? m.by : guessBy(st, m));
  function resOf(S, L, st) {
    const k = L.script.k;
    const group = arr(S.chain).filter((l) => l && l.script && l.script.id === L.script.id && l.script.step === L.script.step);
    const lowest = Math.min(...group.map((l) => l.script.k)) === k;
    const negAny = group.some((l) => l.negated);
    return arr(st.res).filter((m) => { const b = byOf(st, m); return b === k || (b < 0 && lowest && !negAny); });
  }
  /** Resuelve su eslabón de guion i (no negado) → ops para field.js (notas en orden; tu carta que vuelve a ti) */
  function resolveLink(S, i, L) {
    const sc = scriptOf(S);
    const combo = L && L.script ? find(L.script.id) : null;
    const st = combo ? combo.steps[L.script.step] : null;
    if (!sc || !combo || !st || sc.id !== combo.id) return [];
    const ops = [];
    const by = nameById(L.id);
    const cl = 'CL' + (i + 1) + ' ' + q(by) + ': ';
    const r = applyMoves(S, sc, combo, resOf(S, L, st), { ops });
    const notes = r.logs.map((t) => ({ op: 'note', text: cl + lowerFirst(t) }));
    if (r.summoned.length) sc.sumWin = 'El rival Invocó ' + listEs(r.summoned) + '. Puedes responder.';
    return notes.concat(ops);
  }
  /** ¿Lo que hace su eslabón de guion saca cartas del Mazo (añadir, Invocar, mandar al Cementerio)? (Ash Blossom) */
  function fromDeck(S, L) {
    const combo = L && L.script ? find(L.script.id) : null;
    const st = combo ? combo.steps[L.script.step] : null;
    if (!st) return false;
    const k = L.script.k;
    // (lo que no se sabe de qué eslabón es: el que su texto dice; si no se sabe, solo con un eslabón en el paso)
    return arr(st.res).some((m) => byOf(st, m) === k && m.from.a === 'deck' && !m.draw
      && (m.to.a === 'hand' || m.to.a === 'gy' || (m.to.a === 'field' && MON.includes(m.to.z))));
  }

  YGO.combos = {
    KEY, CAP, list, count, get, add, update, remove, build, describe, handNames, finalNames, zoneEs,
    nextAct, run, resolveLink, fromDeck, feasible: (S, c) => (S && S.opp && c ? feasible(S, c) : false),
    // Para las pruebas: lo que hay guardado (sin copiar) y empezar de cero
    _reset: () => { cache = {}; save(); },
  };
})();
