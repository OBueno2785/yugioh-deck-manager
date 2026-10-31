/* Gráficas del panel «Jugadas» (js/playlab.js): columnas agrupadas y líneas en SVG, dibujadas al ancho real de su caja y
 * otra vez cuando cambia (ResizeObserver). Cada una muestra sus valores al pasar el puntero o el dedo, y con las flechas del
 * teclado; los mismos valores están en texto o en una tabla («Ver como tabla»). Pedido de Oscar 2026-10-31: «agrega gráficas
 * al nuevo análisis».
 * Colores (validados con la guía de gráficas sobre el fondo de las cajas, #141f35): serie 1 dorado #c98500, serie 2 azul
 * #3987e5; gris #6b7a99 para lo que se compara («sin revisar»). El texto nunca lleva el color de la serie.
 * Expone window.YGO.plcharts = { place(id, spec), mount(root, specs), legend(spec), table(spec, head) }.
 * spec = { kind: 'cols' | 'line', label, series: [{ name, color, values, line? }], fmt(v), cats (columnas) | xs (líneas),
 *          title(i) (encabezado del tooltip), h, cap (índice de la serie con su valor sobre la columna) } */
(function () {
  const YGO = (window.YGO = window.YGO || {});
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const state = new WeakMap(); // el → { spec, w, pos, plot, i }
  let ro = null;

  const STEPS = [0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1];
  /** Eje de % con 5 tramos como mucho y números redondos */
  function scale(lo, hi) {
    for (const st of STEPS) {
      const a = Math.floor(lo / st + 1e-9) * st, b = Math.max(a + st, Math.ceil(hi / st - 1e-9) * st);
      if (Math.round((b - a) / st) <= 5) return { lo: Math.max(0, a), hi: Math.min(Math.max(b, a + st), 1), step: st };
    }
    return { lo: 0, hi: 1, step: 0.25 };
  }
  const tick = (v) => Math.round(v * 100) + '%';
  const textW = (s, px) => String(s).length * (px || 12) * 0.5 + 4; // Barlow Condensed: unos 0,5 em por carácter
  const bar = (x, y, w, h) => {
    const r = Math.min(4, w / 2, h);
    return 'M' + x + ',' + (y + h) + 'V' + (y + r) + 'A' + r + ',' + r + ' 0 0 1 ' + (x + r) + ',' + y + 'H' + (x + w - r) + 'A' + r + ',' + r + ' 0 0 1 ' + (x + w) + ',' + (y + r) + 'V' + (y + h) + 'Z';
  };
  const f = (x) => Math.round(x * 10) / 10;

  function gridY(sc, y, m, W) {
    let g = '';
    for (let k = 0; sc.lo + k * sc.step <= sc.hi + 1e-9; k++) {
      const v = sc.lo + k * sc.step, yy = f(y(v));
      g += '<line class="plc-grid" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + yy + '" y2="' + yy + '"/>'
        + '<text class="plc-tick" x="' + (m.l - 6) + '" y="' + (yy + 4) + '" text-anchor="end">' + tick(v) + '</text>';
    }
    return g;
  }

  /** Columnas agrupadas: una por categoría y serie, desde una sola base */
  function cols(el, s, W) {
    const H = s.h || 170, m = { l: 38, r: 6, t: s.cap != null ? 22 : 10, b: 24 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const sc = scale(0, Math.max(1e-9, ...s.series.flatMap((x) => x.values)));
    const y = (v) => m.t + ph - ((v - sc.lo) / (sc.hi - sc.lo)) * ph;
    const n = s.cats.length, k = s.series.length, band = pw / n, gap = 2;
    const bw = Math.max(2, Math.min(24, (band * 0.72 - gap * (k - 1)) / k)), gw = bw * k + gap * (k - 1);
    const capFit = s.cap != null && s.cats.every((c, i) => textW(s.fmt(s.series[s.cap].values[i])) <= band - 2);
    const every = Math.max(1, Math.ceil(Math.max(...s.cats.map((c) => textW(c))) / band));
    let g = gridY(sc, y, m, W), caps = '';
    const pos = [];
    s.cats.forEach((c, i) => {
      const x0 = m.l + band * i + (band - gw) / 2;
      pos.push(m.l + band * (i + 0.5));
      let top = y(0);
      s.series.forEach((se, j) => {
        const v = se.values[i], x = f(x0 + j * (bw + gap)), yy = y(v), y0 = y(0);
        if (y0 - yy >= 0.5) g += '<path d="' + bar(x, f(yy), f(bw), f(y0 - yy)) + '" style="fill:' + se.color + '"/>';
        top = Math.min(top, yy);
      });
      if (capFit) caps += '<text class="plc-cap" x="' + f(x0 + s.cap * (bw + gap) + bw / 2) + '" y="' + f(top - 6) + '" text-anchor="middle">' + esc(s.fmt(s.series[s.cap].values[i])) + '</text>';
      if (i % every === 0) g += '<text class="plc-x" x="' + f(pos[i]) + '" y="' + (H - 7) + '" text-anchor="middle">' + esc(c) + '</text>';
    });
    g += '<line class="plc-base" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + f(y(0)) + '" y2="' + f(y(0)) + '"/>' + caps;
    const hl = '<rect class="plc-hl" x="0" y="' + m.t + '" width="' + f(band) + '" height="' + f(ph) + '" rx="4" hidden/>';
    return { svg: hl + g, H, pos, plot: { l: m.l, r: W - m.r, t: m.t, b: m.t + ph, band } };
  }

  /** Líneas de 2 px con su valor al final */
  function line(el, s, W) {
    const H = s.h || 190, m = { l: 38, r: 50, t: 12, b: 24 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const all = s.series.flatMap((x) => x.values);
    const sc = scale(Math.min(...all), Math.max(...all));
    const y = (v) => m.t + ph - ((v - sc.lo) / (sc.hi - sc.lo)) * ph;
    const x0 = s.xs[0], x1 = s.xs[s.xs.length - 1];
    const x = (i) => m.l + (x1 === x0 ? pw / 2 : ((s.xs[i] - x0) / (x1 - x0)) * pw);
    let g = gridY(sc, y, m, W);
    const pos = s.xs.map((_, i) => x(i));
    // Marcas del eje x: la primera, la última y las redondas que quepan
    const room = textW('00') + 10;
    let last = -1e9;
    s.xs.forEach((v, i) => {
      const end = i === s.xs.length - 1;
      if (i === 0 || end || (v % 5 === 0 && pos[i] - last >= room && pos[pos.length - 1] - pos[i] >= room)) {
        g += '<text class="plc-x" x="' + f(pos[i]) + '" y="' + (H - 7) + '" text-anchor="middle">' + v + '</text>';
        last = pos[i];
      }
    });
    g += '<line class="plc-base" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + f(m.t + ph) + '" y2="' + f(m.t + ph) + '"/>';
    const ends = [];
    s.series.forEach((se) => {
      g += '<path class="plc-line" d="' + se.values.map((v, i) => (i ? 'L' : 'M') + f(x(i)) + ',' + f(y(v))).join('') + '" style="stroke:' + se.color + '"/>';
      const li = se.values.length - 1;
      ends.push({ y: y(se.values[li]), v: se.values[li] });
      g += '<circle class="plc-dot" cx="' + f(x(li)) + '" cy="' + f(y(se.values[li])) + '" r="4" style="fill:' + se.color + '"/>';
    });
    // Valor al final de cada línea; si dos quedan encima, solo el de la primera (los demás, en el tooltip y la tabla)
    ends.forEach((e, j) => {
      if (ends.slice(0, j).some((o) => Math.abs(o.y - e.y) < 14)) return;
      g += '<text class="plc-cap" x="' + f(x(s.xs.length - 1) + 8) + '" y="' + f(e.y + 4) + '">' + esc(s.fmt(e.v)) + '</text>';
    });
    const hl = '<line class="plc-cross" x1="0" x2="0" y1="' + m.t + '" y2="' + (m.t + ph) + '" hidden/>'
      + '<g class="plc-hot" hidden>' + s.series.map((se) => '<circle class="plc-dot" r="4" style="fill:' + se.color + '"/>').join('') + '</g>';
    return { svg: g + hl, H, pos, plot: { l: m.l, r: W - m.r, t: m.t, b: m.t + ph }, y };
  }

  function draw(el) {
    const st = state.get(el);
    const W = Math.floor(el.clientWidth);
    if (!st || W < 120 || W === st.w) return;
    st.w = W;
    const r = (st.spec.kind === 'line' ? line : cols)(el, st.spec, W);
    Object.assign(st, r);
    el.innerHTML = '<svg width="' + W + '" height="' + r.H + '" viewBox="0 0 ' + W + ' ' + r.H + '" aria-hidden="true" focusable="false">' + r.svg + '</svg><div class="plc-tip" hidden></div>';
    if (st.i != null) show(el, st.i);
  }

  function show(el, i) {
    const st = state.get(el);
    if (!st || !st.pos) return;
    const s = st.spec, n = st.pos.length;
    i = Math.max(0, Math.min(n - 1, i));
    st.i = i;
    const svg = el.querySelector('svg'), tip = el.querySelector('.plc-tip');
    if (s.kind === 'line') {
      const cx = f(st.pos[i]);
      const cross = svg.querySelector('.plc-cross');
      cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.removeAttribute('hidden');
      const hot = svg.querySelector('.plc-hot');
      hot.querySelectorAll('circle').forEach((c, j) => { c.setAttribute('cx', cx); c.setAttribute('cy', f(st.y(s.series[j].values[i]))); });
      hot.removeAttribute('hidden');
    } else {
      const hl = svg.querySelector('.plc-hl');
      hl.setAttribute('x', f(st.plot.l + st.plot.band * i)); hl.removeAttribute('hidden');
    }
    tip.textContent = '';
    const h = document.createElement('b');
    h.textContent = s.title ? s.title(i) : s.cats[i];
    tip.appendChild(h);
    s.series.forEach((se) => {
      const row = document.createElement('span');
      const key = document.createElement('i');
      key.style.background = se.color;
      const v = document.createElement('strong');
      v.textContent = s.fmt(se.values[i]);
      row.append(key, v, document.createTextNode(' ' + se.name));
      tip.appendChild(row);
    });
    tip.hidden = false;
    const tw = tip.offsetWidth, W = st.w;
    let left = st.pos[i] + 14;
    if (left + tw > W) left = st.pos[i] - tw - 14;
    tip.style.left = Math.max(0, Math.min(W - tw, left)) + 'px';
    tip.style.top = st.plot.t + 'px';
  }
  function hide(el) {
    const st = state.get(el);
    if (st) st.i = null;
    el.querySelectorAll('.plc-tip, .plc-hl, .plc-cross, .plc-hot').forEach((x) => (x.tagName === 'DIV' ? (x.hidden = true) : x.setAttribute('hidden', '')));
  }
  function nearest(el, clientX) {
    const st = state.get(el);
    if (!st || !st.pos) return null;
    const px = clientX - el.getBoundingClientRect().left;
    const pad = st.plot.band ? st.plot.band / 2 : 12;
    if (px < st.plot.l - pad || px > st.plot.r + pad) return null;
    let best = 0;
    st.pos.forEach((p, i) => { if (Math.abs(p - px) < Math.abs(st.pos[best] - px)) best = i; });
    return best;
  }

  function bind(el) {
    const move = (e) => { const i = nearest(el, e.clientX); if (i == null) hide(el); else show(el, i); };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerdown', move);
    el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(el); }); // con el dedo queda hasta tocar fuera
    el.addEventListener('focus', () => { const st = state.get(el); show(el, st && st.i != null ? st.i : 0); });
    el.addEventListener('blur', () => hide(el));
    el.addEventListener('keydown', (e) => {
      const st = state.get(el);
      if (!st || !st.pos) return;
      const i = st.i == null ? 0 : st.i, last = st.pos.length - 1;
      const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: last }[e.key];
      if (to == null) { if (e.key === 'Escape') hide(el); return; }
      e.preventDefault();
      show(el, to);
    });
  }

  /** Dibuja cada .plc[data-plc] de root con su spec y los vuelve a dibujar cuando cambia su ancho */
  function mount(root, specs) {
    if (!ro && typeof ResizeObserver === 'function') ro = new ResizeObserver((list) => list.forEach((e) => draw(e.target)));
    if (ro) ro.disconnect();
    root.querySelectorAll('.plc[data-plc]').forEach((el) => {
      const spec = specs[el.dataset.plc];
      if (!spec) return;
      state.set(el, { spec, w: 0, i: null });
      bind(el);
      draw(el);
      if (ro) ro.observe(el);
    });
  }

  /** El lugar de una gráfica: se dibuja después con mount() */
  const place = (id, spec) => '<div class="plc" id="plc-' + id + '" data-plc="' + id + '" tabindex="0" role="img" aria-label="' + esc(spec.label + '. Con las flechas recorres los valores; también están en la tabla.') + '"'
    + ' style="min-height:' + ((spec.h || (spec.kind === 'line' ? 190 : 170))) + 'px"></div>';

  /** Leyenda (2 o más series): cuadrito para columnas, raya para líneas */
  const legend = (spec) => (spec.series.length < 2 ? '' : '<ul class="plc-legend">' + spec.series.map((se) => '<li><i class="' + (spec.kind === 'line' ? 'ln' : 'sq') + '" style="background:' + se.color + '" aria-hidden="true"></i>' + esc(se.name) + '</li>').join('') + '</ul>');

  /** La misma gráfica como tabla */
  function table(spec, head) {
    const cats = spec.kind === 'line' ? spec.xs.map((x, i) => (spec.title ? spec.title(i) : x)) : spec.cats;
    return '<details class="plc-tbl"><summary>Ver como tabla</summary><div class="pl-twrap"><table><thead><tr><th scope="col">' + esc(head) + '</th>'
      + spec.series.map((se) => '<th scope="col" class="num">' + esc(se.name) + '</th>').join('') + '</tr></thead><tbody>'
      + cats.map((c, i) => '<tr><th scope="row">' + esc(c) + '</th>' + spec.series.map((se) => '<td class="num">' + esc(spec.fmt(se.values[i])) + '</td>').join('') + '</tr>').join('')
      + '</tbody></table></div></details>';
  }

  YGO.plcharts = { place, mount, legend, table, _scale: scale };
})();
