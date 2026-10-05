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

  /** Miniatura de carta. opts: { useBanlist, size: 'small'|'big', attrs: 'atributos html extra' } */
  function tile(c, opts) {
    opts = opts || {};
    const frame = db.frame(c).split(' ').map((f) => 'f-' + f).join(' ');
    let inner;
    if (images.state === 'ok') {
      inner = '<img loading="lazy" alt="' + esc(c.name) + '" src="' + db.imageUrl(c.id, opts.size === 'big' ? 'big' : 'small') + '">';
    } else {
      const stat = db.isMonster(c) ? (c.atk < 0 ? '?' : c.atk) + (c.isLink ? '' : '/' + (c.def < 0 ? '?' : c.def)) : '';
      inner = '<div class="face"><span class="nm">' + esc(c.name) + '</span><span class="lv">' + stars(c) + '</span>'
        + (stat ? '<span class="st">' + stat + '</span>' : '') + '</div>';
    }
    return '<div class="card ' + frame + '" data-id="' + c.id + '" title="' + esc(c.name) + '" ' + (opts.attrs || '') + '>'
      + inner + banBadge(c.id, opts.useBanlist) + '</div>';
  }

  /** Ficha completa de una carta para el panel de detalle. */
  function detail(c, opts) {
    opts = opts || {};
    const facts = [];
    if (db.isMonster(c)) {
      facts.push(['Atributo', db.attributeName(c)]);
      facts.push([c.isLink ? 'Link' : c.type & db.T.XYZ ? 'Rango' : 'Nivel', String(c.lv)]);
      if (c.type & db.T.PENDULUM) facts.push(['Escala', c.scaleL + ' / ' + c.scaleR]);
      if (c.isLink) facts.push(['Flechas', db.linkArrows(c)]);
      facts.push(['ATK', c.atk < 0 ? '?' : String(c.atk)]);
      if (!c.isLink) facts.push(['DEF', c.def < 0 ? '?' : String(c.def)]);
    }
    const lim = db.banLimit(c.id);
    const banTxt = ['Prohibida', 'Limitada (1)', 'Semilimitada (2)', 'Sin límite'][lim];
    const region = c.ot === 1 ? 'Solo OCG' : c.ot === 2 ? 'Solo TCG' : '';
    return '<div class="detail-art">' + tile(c, { size: 'big', useBanlist: opts.useBanlist }) + '</div>'
      + '<h2 class="detail-name">' + esc(c.name) + '</h2>'
      + '<p class="detail-type">' + esc(db.typeLine(c)) + '</p>'
      + (facts.length ? '<dl class="facts">' + facts.map(([k, v]) => '<div><dt>' + k + '</dt><dd>' + esc(v) + '</dd></div>').join('') + '</dl>' : '')
      + '<p class="detail-meta"><span class="pill ban-pill-' + lim + '">' + banTxt + '</span>'
      + (region ? '<span class="pill">' + region + '</span>' : '') + '<span class="code">#' + c.id + '</span></p>'
      + '<div class="detail-desc">' + esc(c.desc).replace(/\n/g, '<br>') + '</div>';
  }

  YGO.view = { tile, detail, images, esc };
})();
