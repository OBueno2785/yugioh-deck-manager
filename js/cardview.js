/* Dibujo de cartas: miniaturas (con imagen de YGOPRODeck o un marco de color si no hay imagen)
 * y la ficha de detalle. Expone window.YGO.view. */
(function () {
  const YGO = (window.YGO = window.YGO || {});
  const db = YGO.db;

  const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  // Las imágenes vienen de images.ygoprodeck.com. Algunos entornos (como la vista publicada) las bloquean,
  // así que se prueba una vez y, si fallan, todas las cartas usan el marco de color.
  const images = { state: 'unknown', listeners: [] };
  images.probe = function () {
    if (images.state !== 'unknown') return;
    const img = new Image();
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      images.state = ok ? 'ok' : 'blocked';
      images.listeners.forEach((fn) => fn(images.state));
    };
    img.onload = () => finish(img.naturalWidth > 0);
    img.onerror = () => finish(false);
    setTimeout(() => finish(false), 5000);
    img.src = db.imageUrl(89631139, 'small');
  };
  images.onChange = (fn) => images.listeners.push(fn);

  function banBadge(id, useBanlist) {
    if (!useBanlist) return '';
    const l = db.banLimit(id);
    return l < 3 ? '<span class="ban ban-' + l + '" title="' + ['Prohibida', 'Limitada', 'Semilimitada'][l] + '">' + l + '</span>' : '';
  }

  function stars(c) {
    if (!db.isMonster(c)) return db.isSpell(c) ? 'MÁGICA' : 'TRAMPA';
    if (c.isLink) return 'LINK-' + c.lv;
    return (c.type & db.T.XYZ ? '✪' : '★') + c.lv;
  }

  /** Miniatura de carta. opts: { useBanlist, size: 'small'|'big', attrs: 'atributos html extra', atk: ATK de ahora (si cambió) } */
  function tile(c, opts) {
    opts = opts || {};
    const frame = db.frame(c).split(' ').map((f) => 'f-' + f).join(' ');
    let inner;
    if (images.state === 'ok') {
      inner = '<img loading="lazy" alt="' + esc(c.name) + '" src="' + db.imageUrl(c.id, opts.size === 'big' ? 'big' : 'small') + '">';
    } else {
      const atk = typeof opts.atk === 'number' ? opts.atk : c.atk < 0 ? '?' : c.atk;
      const stat = db.isMonster(c) ? atk + (c.isLink ? '' : '/' + (c.def < 0 ? '?' : c.def)) : '';
      inner = '<div class="face"><span class="nm">' + esc(c.name) + '</span><span class="lv">' + stars(c) + '</span>'
        + (stat ? '<span class="st">' + stat + '</span>' : '') + '</div>';
    }
    return '<div class="card ' + frame + '" data-id="' + c.id + '" title="' + esc(c.name) + '" ' + (opts.attrs || '') + '>'
      + inner + banBadge(c.id, opts.useBanlist) + '</div>';
  }

  /* ---------- Texto de la carta al estilo Dueling Nexus ----------
   * Cada efecto va en su propio párrafo y se colorea por partes (sintaxis de Konami):
   *   condición/activación (antes de ":") · costo u objetivo (antes de ";") · efecto · restricción de uso.
   * Los nombres entre comillas van en cursiva y los requisitos de invocación aparte. */
  const RESTRICTION = /^(You can only|You cannot (?:Special Summon|activate|conduct)|Once per (?:turn|Duel), )/;
  const REQUIREMENT = /^(Cannot be (?:Normal|Special) Summoned|Must (?:first )?be|Can only be (?:Special )?Summoned|This card cannot be Special Summoned except|\(This card is always treated)/;

  /** Posición de ch fuera de comillas y paréntesis, o -1. */
  function topIndex(s, ch) {
    let q = false, depth = 0;
    for (let i = 0; i < s.length; i++) {
      const x = s[i];
      if (x === '"') q = !q;
      else if (!q && x === '(') depth++;
      else if (!q && x === ')') depth = Math.max(0, depth - 1);
      else if (!q && depth === 0 && x === ch) return i;
    }
    return -1;
  }

  /** Divide un párrafo en oraciones sin cortar dentro de comillas ni paréntesis. */
  function sentences(text) {
    const out = [];
    let q = false, depth = 0, start = 0;
    for (let i = 0; i < text.length; i++) {
      const x = text[i];
      if (x === '"') q = !q;
      else if (!q && x === '(') depth++;
      else if (!q && x === ')') {
        depth = Math.max(0, depth - 1);
        // "...(This is treated as a Synchro Summon.) You can only..." también cierra la oración
        if (depth === 0 && text[i - 1] === '.' && text[i + 1] === ' ' && /[A-Z●("*]/.test(text[i + 2] || '')) {
          out.push(text.slice(start, i + 1).trim());
          start = i + 2;
        }
      } else if (x === '.' && !q && depth === 0 && text[i + 1] === ' ' && /[A-Z●("*]/.test(text[i + 2] || '')) {
        out.push(text.slice(start, i + 1).trim());
        start = i + 2;
      }
    }
    if (text.slice(start).trim()) out.push(text.slice(start).trim());
    return out;
  }

  /** Escapa y pone en cursiva los nombres entre comillas. */
  function inline(s) {
    return s.split('"').map((part, i) => (i % 2 ? '<i class="t-name">"' + esc(part) + '"</i>' : esc(part))).join('');
  }

  /** Colorea un efecto: condición (antes de ":"), costo/objetivo (antes de ";") y resolución. */
  function colorEffect(s) {
    let html = '';
    let rest = s;
    const colon = topIndex(rest, ':');
    if (colon >= 0) {
      html += '<span class="t-cond">' + inline(rest.slice(0, colon + 1)) + '</span>';
      rest = rest.slice(colon + 1);
    }
    const semi = topIndex(rest, ';');
    if (semi >= 0) {
      html += '<span class="t-cost">' + inline(rest.slice(0, semi + 1)) + '</span>';
      rest = rest.slice(semi + 1);
    }
    return html + '<span class="t-eff">' + inline(rest) + '</span>';
  }

  /**
   * Divide el texto de la carta en bloques según su papel (lo usan formatText y YGO.rules).
   * kind: 'flavor' | 'sep' | 'head' | 'note' | 'bullet' | 'materials' | 'limit' | 'req' | 'effect'.
   * text: texto del bloque; parts: oraciones del efecto; head: 'pendulum effect' | 'monster effect' | 'flavor text'.
   */
  function textBlocks(c) {
    const desc = (c.desc || '').replace(/\r\n?/g, '\n');
    if (c.type & db.T.NORMAL && !(c.type & db.T.PENDULUM)) return [{ kind: 'flavor', text: desc }];
    const blocks = [];
    const isExtraOrRitual = db.isExtra(c) || (c.type & db.T.RITUAL && db.isMonster(c));
    let first = true;
    for (const raw of desc.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      if (/^-{5,}$/.test(line)) { blocks.push({ kind: 'sep' }); continue; }
      const head = line.match(/^\[\s*(Pendulum Effect|Monster Effect|Flavor Text)\s*\]$/i);
      if (head) {
        blocks.push({ kind: 'head', head: head[1].toLowerCase() });
        first = true;
        continue;
      }
      if (line.startsWith('*')) { blocks.push({ kind: 'note', text: line }); continue; }
      if (line.startsWith('●')) { blocks.push({ kind: 'bullet', text: line.replace(/^●\s*/, '') }); continue; }
      // "(This card's original Level is always treated as 12.)": aclaración, no materiales (los materiales pueden venir después)
      if (first && db.isExtra(c) && /^\(.*\)$/.test(line)) { blocks.push({ kind: 'note', text: line }); continue; }
      // Materiales de Fusión/Sincronía/Xyz/Link: primera línea sin punto final
      if (first && isExtraOrRitual && !/\.$/.test(line) && db.isExtra(c)) {
        blocks.push({ kind: 'materials', text: line });
        first = false;
        continue;
      }
      first = false;
      // Una línea que es solo una aclaración ("(This card is not treated as a "Cyber" card.)") no es un efecto
      if (/^\(.*\)$/.test(line) && sentences(line).length === 1 && !REQUIREMENT.test(line)) { blocks.push({ kind: 'note', text: line }); continue; }
      // Agrupa oraciones: cada activación (":" o ";") o restricción abre un párrafo nuevo
      let cur = null;
      const flush = () => { if (cur) { cur.text = cur.parts.join(' '); blocks.push(cur); } cur = null; };
      const lineStart = blocks.length;
      const sens = sentences(line);
      for (let k = 0; k < sens.length; k++) {
        const sen = sens[k];
        if (RESTRICTION.test(sen)) {
          flush();
          // "Once per turn, during your Main Phase: ..." es un efecto: las oraciones que siguen sin ":" ni ";" son parte de él
          if (/^Once per (?:turn|Duel), /.test(sen) && (topIndex(sen, ':') >= 0 || topIndex(sen, ';') >= 0)) cur = { kind: 'limit', parts: [sen] };
          else blocks.push({ kind: 'limit', text: sen });
          continue;
        }
        if (REQUIREMENT.test(sen)) { flush(); blocks.push({ kind: 'req', text: sen }); continue; }
        // Aclaración entre paréntesis ("(You do not use "Polymerization".)"): va con la restricción o el requisito
        // anterior; al inicio del párrafo, si sigue más texto, queda como nota (no es un efecto)
        if (!cur && /^\(.*\)$/.test(sen)) {
          const prevBlock = blocks.length > lineStart ? blocks[blocks.length - 1] : null;
          if (prevBlock && (prevBlock.kind === 'limit' || prevBlock.kind === 'req')) { prevBlock.text += ' ' + sen; continue; }
          if (!prevBlock && k < sens.length - 1) { blocks.push({ kind: 'note', text: sen }); continue; }
        }
        const activates = topIndex(sen, ':') >= 0 || topIndex(sen, ';') >= 0;
        if (!cur || activates) { flush(); cur = { kind: 'effect', parts: [sen] }; } else cur.parts.push(sen);
      }
      flush();
    }
    return blocks;
  }

  const HEADS = { 'pendulum effect': 'Efecto de Péndulo', 'monster effect': 'Efecto de Monstruo', 'flavor text': 'Texto de ambientación' };

  /** Convierte el texto de la carta en párrafos con clases según su papel. */
  function formatText(c) {
    return textBlocks(c).map((b) => {
      switch (b.kind) {
        case 'flavor': return '<p class="t-flavor">' + inline(b.text).replace(/\n/g, '<br>') + '</p>';
        case 'sep': return '<hr class="t-sep">';
        case 'head': return '<p class="t-head">' + HEADS[b.head] + '</p>';
        case 'note': return '<p class="t-note">' + inline(b.text) + '</p>';
        case 'bullet': return '<p class="t-bullet">' + colorEffect(b.text) + '</p>';
        case 'materials': return '<p class="t-req"><span class="t-tag">Materiales</span>' + inline(b.text) + '</p>';
        case 'limit': return '<p class="t-limit">' + inline(b.text) + '</p>';
        case 'req': return '<p class="t-req"><span class="t-tag">Requisito</span>' + inline(b.text) + '</p>';
        default: return '<p class="t-effect">' + b.parts.map(colorEffect).join(' ') + '</p>';
      }
    }).join('');
  }

  /** Línea de clase al estilo "[Monstruo|Efecto] Guerrero/TIERRA". */
  function classLine(c) {
    const T = db.T, t = c.type;
    if (t & T.SPELL || t & T.TRAP) {
      const sub = t & T.QUICKPLAY ? 'Rápida' : t & T.CONTINUOUS ? 'Continua' : t & T.EQUIP ? 'Equipo' : t & T.FIELD ? 'Campo'
        : t & T.RITUAL ? 'Ritual' : t & T.COUNTER ? 'Contraefecto' : 'Normal';
      return '[' + (t & T.SPELL ? 'Mágica' : 'Trampa') + '|' + sub + ']';
    }
    const tags = ['Monstruo'];
    [[T.FUSION, 'Fusión'], [T.RITUAL, 'Ritual'], [T.SYNCHRO, 'Sincronía'], [T.XYZ, 'Xyz'], [T.LINK, 'Link'], [T.PENDULUM, 'Péndulo'],
      [T.TUNER, 'Cantante'], [T.FLIP, 'Volteo'], [T.SPIRIT, 'Espíritu'], [T.UNION, 'Unión'], [T.GEMINI, 'Géminis'], [T.TOON, 'Toon'],
      [T.SPSUMMON, 'Invocación Especial'], [T.EFFECT, 'Efecto'], [T.NORMAL, 'Normal']]
      .forEach(([b, l]) => { if (t & b) tags.push(l); });
    return '[' + tags.join('|') + '] ' + db.raceName(c) + '/' + db.attributeName(c);
  }

  function statLine(c) {
    const T = db.T;
    if (!db.isMonster(c)) return '';
    const atk = c.atk < 0 ? '?' : c.atk;
    let lv = c.isLink ? '[LINK-' + c.lv + ']' : '[' + (c.type & T.XYZ ? '✪' : '★') + c.lv + ']';
    if (c.type & T.PENDULUM) lv += ' [◆' + c.scaleL + '/' + c.scaleR + ']';
    return lv + ' ' + (c.isLink ? atk + ' ' + db.linkArrows(c) : atk + '/' + (c.def < 0 ? '?' : c.def));
  }

  /** Ficha completa de una carta para el panel de detalle. */
  function detail(c, opts) {
    opts = opts || {};
    const lim = db.banLimit(c.id);
    const banTxt = ['Prohibida', 'Limitada (1)', 'Semilimitada (2)', 'Sin límite'][lim];
    const region = c.ot === 1 ? 'OCG' : c.ot === 2 ? 'TCG' : 'TCG/OCG';
    const stat = statLine(c);
    return '<div class="detail-art">' + tile(c, { size: 'big', useBanlist: opts.useBanlist }) + '</div>'
      + '<h2 class="detail-name">' + esc(c.name) + '</h2>'
      + '<div class="ctext">'
      + '<p class="ct-id">' + c.id + ' <span class="ct-ot ot-' + c.ot + '">(' + region + ')</span>'
      + '<span class="pill ban-pill-' + lim + '">' + banTxt + '</span></p>'
      + '<p class="ct-line">' + esc(classLine(c)) + '</p>'
      + (stat ? '<p class="ct-line">' + esc(stat) + '</p>' : '')
      + '<div class="ct-body">' + formatText(c) + '</div>'
      + '</div>'
      + '<p class="t-legend"><span class="t-cond">Condición</span><span class="t-cost">Costo / objetivo</span>'
      + '<span class="t-eff">Efecto</span><span class="t-limit">Restricción</span><span class="t-req-k">Requisito</span></p>';
  }

  YGO.view = { tile, detail, images, esc, formatText, textBlocks, colorEffect, topIndex, sentences, inline };
})();
