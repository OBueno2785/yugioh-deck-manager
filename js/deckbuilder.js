/* Pantalla del constructor de mazos: buscador, panel de detalle y edición del mazo. */
(function () {
  const { db, deck, store, view } = window.YGO;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = view.esc;
  const PAGE = 60;

  /* ---------- Estado ---------- */
  let decks = store.load();
  const prefs = Object.assign({ useBanlist: true }, store.prefs());
  let current = decks.find((d) => d.id === prefs.lastDeckId) || decks[0];
  let selectedId = null;
  let results = [];
  let shown = 0;

  const persist = () => {
    prefs.lastDeckId = current.id;
    store.save(decks);
    store.savePrefs(prefs);
  };

  /* ---------- Avisos ---------- */
  let toastTimer;
  function toast(msg, kind) {
    const el = $('#toast');
    el.textContent = msg;
    el.className = 'toast' + (kind ? ' toast-' + kind : '');
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
  }

  /* ---------- Mazo ---------- */
  function renderDeckSelect() {
    const sel = $('#deck-select');
    sel.innerHTML = decks
      .slice().sort((a, b) => a.name.localeCompare(b.name))
      .map((d) => '<option value="' + d.id + '"' + (d.id === current.id ? ' selected' : '') + '>' + esc(d.name) + '</option>')
      .join('');
  }

  function renderDeck() {
    const s = deck.stats(current);
    for (const section of deck.SECTIONS) {
      const zone = $('.zone[data-section="' + section + '"]');
      const lim = deck.LIMITS[section];
      const n = current[section].length;
      $('.count', zone).textContent = n + (section === 'main' ? ' / 40–60' : ' / ' + lim.max);
      $('.count', zone).classList.toggle('bad', n > lim.max || (section === 'main' && n < lim.min));
      $('.grid', zone).innerHTML = current[section].length
        ? current[section].map((id, i) => {
          const c = db.get(id);
          return c ? view.tile(c, { useBanlist: prefs.useBanlist, attrs: 'draggable="true" data-index="' + i + '" data-section="' + section + '" tabindex="0"' }) : '';
        }).join('')
        : '<p class="zone-empty">' + (section === 'main'
          ? 'Busca cartas a la derecha y pulsa + o arrástralas aquí.'
          : section === 'extra' ? 'Monstruos de Fusión, Sincronía, Xyz y Link.' : 'Cartas para cambiar entre partidas.') + '</p>';
      if (selectedId) $$('.card[data-id="' + selectedId + '"]', zone).forEach((el) => el.classList.add('sel'));
    }
    $('#breakdown').innerHTML = '<span><b>' + s.monsters + '</b> Monstruos</span><span><b>' + s.spells
      + '</b> Mágicas</span><span><b>' + s.traps + '</b> Trampas</span>';
    const probs = deck.problems(current, prefs.useBanlist);
    const v = $('#validity');
    v.className = 'validity ' + (probs.length ? 'warn' : 'ok');
    v.textContent = probs.length ? probs[0] + (probs.length > 1 ? ' (+' + (probs.length - 1) + ' más)' : '') : 'Mazo válido para duelo';
    v.title = probs.join('\n');
    $('#tab-deck-count').textContent = s.main;
    const pend = current.pending || [];
    const pn = pend.reduce((n, e) => n + e.count, 0);
    $('#pending-note').hidden = !pn;
    if (pn) {
      $('#pending-note').innerHTML = '<b>Faltan ' + pn + ' cartas por cargar:</b> ' + pend.map((e) => e.count + '× ' + esc(e.name)).join(', ')
        + (window.YGO.online.available() ? '. Buscándolas en YGOPRODeck…' : '. Son cartas nuevas que no trae la base incluida; se cargan solas al abrir el simulador como sitio web.');
    }
  }

  function commit() {
    renderDeck();
    renderDetail();
    markResults();
    persist();
  }

  function addCard(id, section) {
    const why = deck.add(current, id, section, prefs.useBanlist);
    if (why) { toast(why, 'warn'); return false; }
    commit();
    return true;
  }

  function removeCard(section, id, index) {
    if (deck.remove(current, section, id, index)) commit();
  }

  /* ---------- Detalle ---------- */
  function select(id) {
    selectedId = id;
    $$('.card.sel, .result.sel').forEach((el) => el.classList.remove('sel'));
    $$('[data-id="' + id + '"]').forEach((el) => el.classList.add('sel'));
    renderDetail();
    document.body.classList.add('detail-open');
  }

  function renderDetail() {
    const box = $('#detail-body');
    const c = selectedId && db.get(selectedId);
    if (!c) {
      box.innerHTML = '<div class="detail-empty"><div class="card-back" aria-hidden="true"></div>'
        + '<p>Elige una carta del buscador o del mazo para ver su texto completo.</p></div>';
      $('#detail-actions').hidden = true;
      return;
    }
    box.innerHTML = view.detail(c, { useBanlist: prefs.useBanlist });
    const n = deck.copies(current, c.id);
    const max = deck.maxCopies(c.id, prefs.useBanlist);
    const nat = deck.naturalSection(c.id);
    $('#detail-actions').hidden = false;
    $('#copies').innerHTML = 'En este mazo: <b>' + n + '</b> de ' + max;
    $('#act-add').textContent = nat === 'extra' ? '+ Extra Deck' : '+ Principal';
    $('#act-add').disabled = !!deck.whyNot(current, c.id, nat, prefs.useBanlist);
    $('#act-side').disabled = !!deck.whyNot(current, c.id, 'side', prefs.useBanlist);
    $('#act-remove').disabled = n === 0;
  }

  /* ---------- Búsqueda ---------- */
  function filters() {
    return {
      text: $('#q').value,
      kind: $('#f-kind').value,
      sub: $('#f-sub').value,
      attribute: $('#f-attr').value,
      race: $('#f-race').value,
      lvMin: $('#f-lvmin').value, lvMax: $('#f-lvmax').value,
      atkMin: $('#f-atkmin').value, atkMax: $('#f-atkmax').value,
      defMin: $('#f-defmin').value, defMax: $('#f-defmax').value,
      ban: $('#f-ban').value,
      sort: $('#f-sort').value,
    };
  }

  function activeFilterCount() {
    return ['#f-kind', '#f-sub', '#f-attr', '#f-race', '#f-lvmin', '#f-lvmax', '#f-atkmin', '#f-atkmax', '#f-defmin', '#f-defmax', '#f-ban']
      .filter((s) => $(s).value !== '').length;
  }

  function runSearch() {
    results = db.search(filters());
    shown = 0;
    $('#results').innerHTML = '';
    $('#result-count').textContent = results.length.toLocaleString('es') + (results.length === 1 ? ' carta' : ' cartas');
    const n = activeFilterCount();
    $('#btn-filters').textContent = n ? 'Filtros (' + n + ')' : 'Filtros';
    renderMore();
  }

  function resultRow(c) {
    const stat = db.isMonster(c)
      ? '<span>' + esc(db.attributeName(c)) + '</span><span>' + db.levelText(c) + '</span><span>' + db.statText(c) + '</span>'
      : '<span>' + esc(db.typeLine(c).replace('Carta ', '')) + '</span>';
    return '<li class="result" data-id="' + c.id + '" draggable="true">'
      + view.tile(c, { useBanlist: prefs.useBanlist })
      + '<button class="result-main" type="button"><span class="r-name">' + esc(c.name) + '</span>'
      + '<span class="r-sub">' + stat + '</span>'
      + '<span class="r-type">' + esc(db.isMonster(c) ? db.raceName(c) : '') + '</span></button>'
      + '<span class="r-copies"></span>'
      + '<button class="r-add" type="button" title="Añadir al mazo" aria-label="Añadir ' + esc(c.name) + ' al mazo">+</button></li>';
  }

  function renderMore() {
    const slice = results.slice(shown, shown + PAGE);
    $('#results').insertAdjacentHTML('beforeend', slice.map(resultRow).join(''));
    shown += slice.length;
    $('#more').hidden = shown >= results.length;
    if (!results.length) $('#results').innerHTML = '<li class="no-results">Ninguna carta coincide. Prueba con menos filtros o con otra palabra.</li>';
    markResults();
  }

  function markResults() {
    $$('#results .result').forEach((li) => {
      const n = deck.copies(current, li.dataset.id);
      const el = $('.r-copies', li);
      el.textContent = n ? '×' + n : '';
      li.classList.toggle('sel', li.dataset.id === String(selectedId));
    });
  }

  function fillSubtypes() {
    const kind = $('#f-kind').value;
    const sub = $('#f-sub');
    const opts = kind ? db.SUBTYPES[kind] : [];
    sub.innerHTML = '<option value="">Cualquiera</option>' + opts.map(([k, l]) => '<option value="' + k + '">' + l + '</option>').join('');
    sub.disabled = !kind;
    $$('.monster-only').forEach((el) => { el.classList.toggle('dim', kind === 'spell' || kind === 'trap'); });
  }

  /* ---------- Ventana modal ---------- */
  function modal(title, bodyHtml, buttons) {
    const m = $('#modal');
    $('#modal-title').textContent = title;
    $('#modal-body').innerHTML = bodyHtml;
    const foot = $('#modal-foot');
    foot.innerHTML = '';
    buttons.forEach((b) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.textContent = b.label;
      el.className = b.kind || '';
      el.addEventListener('click', () => { if (b.action && b.action() === false) return; closeModal(); });
      foot.appendChild(el);
    });
    m.hidden = false;
    const first = $('input, textarea', m) || foot.lastChild;
    if (first) setTimeout(() => first.focus(), 30);
  }
  function closeModal() { $('#modal').hidden = true; }

  function askName(title, value, onOk) {
    modal(title, '<label class="field"><span>Nombre del mazo</span><input id="m-name" type="text" maxlength="60" value="' + esc(value) + '"></label>', [
      { label: 'Cancelar' },
      { label: 'Guardar', kind: 'primary', action: () => {
        const v = $('#m-name').value.trim();
        if (!v) { $('#m-name').focus(); return false; }
        onOk(v);
      } },
    ]);
    $('#m-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#modal-foot .primary').click(); });
  }

  function switchDeck(d) {
    current = d;
    renderDeckSelect();
    commit();
  }

  /* ---------- Importar / exportar ---------- */
  function openExport() {
    const text = deck.toYdk(current);
    modal('Exportar ' + current.name, '<p class="hint">Formato .ydk, compatible con Dueling Nexus, EDOPro y YGO Omega. Cópialo o descárgalo.</p>'
      + '<textarea id="m-ydk" rows="12" readonly spellcheck="false">' + esc(text) + '</textarea>', [
      { label: 'Descargar .ydk', action: () => {
        try {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
          a.download = current.name.replace(/[\\/:*?"<>|]+/g, '_') + '.ydk';
          document.body.appendChild(a); a.click(); a.remove();
        } catch (e) { /* algunos visores bloquean descargas */ }
        toast('Si no se descargó, usa Copiar y pégalo en un archivo .ydk');
        return false;
      } },
      { label: 'Copiar', kind: 'primary', action: () => {
        const ta = $('#m-ydk');
        const fallback = () => { ta.focus(); ta.select(); toast('Texto seleccionado: cópialo con Ctrl+C'); };
        try {
          navigator.clipboard.writeText(text).then(() => toast('Copiado al portapapeles', 'ok'), fallback);
        } catch (e) { fallback(); }
        return false;
      } },
      { label: 'Cerrar' },
    ]);
  }

  function openImport() {
    modal('Importar mazo', '<p class="hint">Acepta archivos .ydk y listas de texto como las que exporta Dueling Nexus (<i>3x Ash Blossom &amp; Joyous Spring</i>).</p>'
      + '<label class="field"><span>Archivo .ydk o .txt</span><input id="m-file" type="file" accept=".ydk,.txt,text/plain"></label>'
      + '<label class="field"><span>O pega el contenido</span><textarea id="m-text" rows="9" spellcheck="false" placeholder="Main Deck:&#10;3x Ash Blossom &amp; Joyous Spring&#10;..."></textarea></label>'
      + '<label class="field"><span>Nombre</span><input id="m-name" type="text" maxlength="60" value="Mazo importado"></label>', [
      { label: 'Cancelar' },
      { label: 'Importar como mazo nuevo', kind: 'primary', action: () => {
        const text = $('#m-text').value;
        const name = $('#m-name').value.trim() || 'Mazo importado';
        const first = deck.fromText(text);
        if (!(first.main.length + first.extra.length + first.side.length + first.unknown)) {
          toast('No encontré códigos de cartas en el texto', 'warn');
          return false;
        }
        if (first.unknown && window.YGO.online.available()) {
          // Cartas que no están en la base incluida: se piden a YGOPRODeck antes de importar
          const btn = $('#modal-foot .primary');
          btn.disabled = true;
          btn.textContent = 'Buscando ' + first.unknown + ' cartas nuevas…';
          (first.missing.length ? window.YGO.online.fetchNames(first.missing.map((e) => e.name)) : window.YGO.online.fetchIds(first.unknownIds))
            .catch(() => 0)
            .then(() => { closeModal(); finishImport(text, name); refreshDbCount(); });
          return false;
        }
        finishImport(text, name);
      } },
    ]);
    $('#m-file').addEventListener('change', (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        $('#m-text').value = r.result;
        $('#m-name').value = f.name.replace(/\.(ydk|txt)$/i, '');
      };
      r.readAsText(f);
    });
  }

  function finishImport(text, name) {
    const parsed = deck.fromText(text);
    const total = parsed.main.length + parsed.extra.length + parsed.side.length;
    const d = deck.create(name, { main: parsed.main, extra: parsed.extra, side: parsed.side, pending: parsed.missing });
    decks.push(d);
    switchDeck(d);
    const lost = parsed.missing.length ? '; ' + parsed.unknown + ' quedan pendientes (se buscan en YGOPRODeck desde el sitio web)'
      : parsed.unknown ? '; ' + parsed.unknown + ' códigos desconocidos se omitieron' : '';
    toast('Importadas ' + total + ' cartas' + lost, parsed.unknown ? 'warn' : 'ok');
  }

  function refreshDbCount() {
    $('#db-count').textContent = db.cards.length.toLocaleString('es');
  }

  /** Busca en YGOPRODeck las cartas pendientes de todos los mazos y las coloca. */
  function resolvePendingAll() {
    if (!window.YGO.online.available()) return;
    const names = [];
    decks.forEach((d) => (d.pending || []).forEach((e) => names.push(e.name)));
    if (!names.length) return;
    window.YGO.online.fetchNames(names).catch(() => 0).then(() => {
      let placed = 0;
      decks.forEach((d) => { placed += deck.resolvePending(d); });
      if (placed) {
        refreshDbCount();
        commit();
        toast('Se cargaron ' + placed + ' cartas nuevas desde YGOPRODeck', 'ok');
      }
    });
  }

  /* ---------- Búsqueda en línea ---------- */
  const askedOnline = new Set();
  function searchOnline() {
    const text = $('#q').value.trim();
    if (text.length < 3 || !window.YGO.online.available() || askedOnline.has(text.toLowerCase())) return;
    askedOnline.add(text.toLowerCase());
    $('#online-status').hidden = false;
    window.YGO.online.searchName(text)
      .then((added) => {
        if (added) { refreshDbCount(); if ($('#q').value.trim() === text) runSearch(); }
      })
      .catch(() => { /* sin conexión: se queda con la base incluida */ })
      .finally(() => { $('#online-status').hidden = true; });
  }

  /* ---------- Arrastrar y soltar ---------- */
  let drag = null; // { id, from: 'results' | section, index }
  function onDragStart(e) {
    const el = e.target.closest('[data-id]');
    if (!el) return;
    const card = el.closest('.result') || el;
    drag = { id: Number(card.dataset.id), from: card.dataset.section || 'results', index: Number(card.dataset.index) };
    e.dataTransfer.effectAllowed = 'copyMove';
    try { e.dataTransfer.setData('text/plain', String(drag.id)); } catch (err) { /* nada */ }
    document.body.classList.add('dragging');
  }
  function onDragEnd() {
    drag = null;
    document.body.classList.remove('dragging');
    $$('.drop-ok').forEach((el) => el.classList.remove('drop-ok'));
  }
  function bindDrops() {
    $$('.zone').forEach((zone) => {
      zone.addEventListener('dragover', (e) => { if (drag) { e.preventDefault(); zone.classList.add('drop-ok'); } });
      zone.addEventListener('dragleave', () => zone.classList.remove('drop-ok'));
      zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('drop-ok');
        if (!drag) return;
        const to = zone.dataset.section;
        if (drag.from === to) return;
        if (drag.from === 'results') { addCard(drag.id, to); return; }
        // Mover entre secciones: se quita primero para no contar la copia dos veces
        const id = drag.id;
        current[drag.from].splice(drag.index, 1);
        const why = deck.add(current, id, to, prefs.useBanlist);
        if (why) { current[drag.from].splice(drag.index, 0, id); toast(why, 'warn'); }
        commit();
      });
    });
    const pane = $('.searchpane');
    pane.addEventListener('dragover', (e) => { if (drag && drag.from !== 'results') { e.preventDefault(); pane.classList.add('drop-ok'); } });
    pane.addEventListener('dragleave', (e) => { if (!pane.contains(e.relatedTarget)) pane.classList.remove('drop-ok'); });
    pane.addEventListener('drop', (e) => {
      e.preventDefault();
      pane.classList.remove('drop-ok');
      if (drag && drag.from !== 'results') removeCard(drag.from, drag.id, drag.index);
    });
  }

  /* ---------- Eventos ---------- */
  function bind() {
    let t;
    let tOnline;
    $('#q').addEventListener('input', () => {
      clearTimeout(t); t = setTimeout(runSearch, 140);
      clearTimeout(tOnline); tOnline = setTimeout(searchOnline, 700);
    });
    $('#f-kind').addEventListener('change', () => { fillSubtypes(); runSearch(); });
    $$('#filters select, #filters input, #f-sort').forEach((el) => {
      if (el.id === 'f-kind') return;
      el.addEventListener(el.tagName === 'INPUT' ? 'input' : 'change', () => { clearTimeout(t); t = setTimeout(runSearch, 160); });
    });
    $('#btn-filters').addEventListener('click', () => {
      const f = $('#filters');
      f.hidden = !f.hidden;
      $('#btn-filters').setAttribute('aria-expanded', String(!f.hidden));
    });
    $('#btn-reset').addEventListener('click', () => {
      $$('#filters select, #filters input').forEach((el) => { el.value = ''; });
      fillSubtypes();
      runSearch();
    });
    $('#more').addEventListener('click', renderMore);
    if ('IntersectionObserver' in window) {
      new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && shown < results.length) renderMore();
      }, { root: $('#results-scroll'), rootMargin: '300px' }).observe($('#more'));
    }

    $('#results').addEventListener('click', (e) => {
      const li = e.target.closest('.result');
      if (!li) return;
      if (e.target.closest('.r-add')) addCard(Number(li.dataset.id));
      else select(Number(li.dataset.id));
    });
    $('#results').addEventListener('contextmenu', (e) => {
      const li = e.target.closest('.result');
      if (!li) return;
      e.preventDefault();
      addCard(Number(li.dataset.id), e.shiftKey ? 'side' : undefined);
    });

    const deckpane = $('.deckpane');
    deckpane.addEventListener('click', (e) => {
      const el = e.target.closest('.card[data-section]');
      if (el) select(Number(el.dataset.id));
    });
    deckpane.addEventListener('contextmenu', (e) => {
      const el = e.target.closest('.card[data-section]');
      if (!el) return;
      e.preventDefault();
      removeCard(el.dataset.section, Number(el.dataset.id), Number(el.dataset.index));
    });
    deckpane.addEventListener('keydown', (e) => {
      const el = e.target.closest('.card[data-section]');
      if (!el) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(Number(el.dataset.id)); }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeCard(el.dataset.section, Number(el.dataset.id), Number(el.dataset.index)); }
    });
    document.addEventListener('dragstart', onDragStart);
    document.addEventListener('dragend', onDragEnd);
    bindDrops();

    $('#act-add').addEventListener('click', () => addCard(selectedId));
    $('#act-side').addEventListener('click', () => addCard(selectedId, 'side'));
    $('#act-remove').addEventListener('click', () => {
      for (const s of ['side', 'extra', 'main']) {
        if (current[s].some((x) => db.get(x) === db.get(selectedId))) {
          // Quita primero de la sección natural; el side solo si no queda en otra
          const nat = deck.naturalSection(selectedId);
          const inNat = current[nat].some((x) => db.get(x) === db.get(selectedId));
          removeCard(inNat ? nat : s, selectedId);
          return;
        }
      }
    });
    $('#detail-close').addEventListener('click', () => document.body.classList.remove('detail-open'));
    $('.scrim').addEventListener('click', () => document.body.classList.remove('detail-open'));

    $('#deck-select').addEventListener('change', (e) => switchDeck(decks.find((d) => d.id === e.target.value)));
    $('#btn-new').addEventListener('click', () => askName('Nuevo mazo', 'Mazo nuevo', (name) => {
      const d = deck.create(name);
      decks.push(d);
      switchDeck(d);
    }));
    $('#btn-rename').addEventListener('click', () => askName('Renombrar mazo', current.name, (name) => {
      current.name = name;
      renderDeckSelect();
      persist();
    }));
    $('#btn-dup').addEventListener('click', () => {
      const d = deck.create(current.name + ' (copia)', { main: current.main.slice(), extra: current.extra.slice(), side: current.side.slice() });
      decks.push(d);
      switchDeck(d);
      toast('Mazo duplicado', 'ok');
    });
    $('#btn-del').addEventListener('click', () => modal('Eliminar mazo',
      '<p>Se borrará <b>' + esc(current.name) + '</b> de este navegador. Exporta el .ydk antes si quieres conservarlo.</p>', [
        { label: 'Cancelar' },
        { label: 'Eliminar', kind: 'danger', action: () => {
          decks = decks.filter((d) => d !== current);
          if (!decks.length) decks.push(deck.create());
          switchDeck(decks[0]);
        } },
      ]));
    $('#btn-sort').addEventListener('click', () => { deck.sort(current); commit(); });
    $('#btn-clear').addEventListener('click', () => modal('Vaciar mazo',
      '<p>Se quitarán todas las cartas de <b>' + esc(current.name) + '</b>.</p>', [
        { label: 'Cancelar' },
        { label: 'Vaciar', kind: 'danger', action: () => {
          current.main = []; current.extra = []; current.side = [];
          commit();
        } },
      ]));
    $('#btn-import').addEventListener('click', openImport);
    $('#btn-export').addEventListener('click', openExport);

    $('#opt-banlist').checked = prefs.useBanlist;
    $('#opt-banlist').addEventListener('change', (e) => {
      prefs.useBanlist = e.target.checked;
      commit();
      runSearch();
    });

    $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!$('#modal').hidden) closeModal();
      else document.body.classList.remove('detail-open');
    });

    $$('.mtab').forEach((b) => b.addEventListener('click', () => {
      document.body.dataset.pane = b.dataset.pane;
      $$('.mtab').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    }));
  }

  /* ---------- Inicio ---------- */
  function init() {
    $('#f-attr').innerHTML = '<option value="">Cualquiera</option>' + db.ATTRIBUTES.map(([b, n]) => '<option value="' + b + '">' + n + '</option>').join('');
    $('#f-race').innerHTML = '<option value="">Cualquiera</option>' + db.RACES.map(([b, n]) => '<option value="' + b + '">' + n + '</option>').join('');
    $('#banlist-name').textContent = db.banlistName || 'TCG';
    refreshDbCount();
    fillSubtypes();
    bind();
    renderDeckSelect();
    renderDeck();
    renderDetail();
    runSearch();
    view.images.onChange(() => {
      renderDeck(); renderDetail(); $('#results').innerHTML = ''; const n = shown; shown = 0; while (shown < n) renderMore();
    });
    window.YGO.online.onChange(() => {
      $('#online-badge').hidden = !window.YGO.online.available();
      searchOnline();
      resolvePendingAll();
    });
    window.YGO.online.probe();
    view.images.probe();
    persist();
  }

  init();

  // Acceso compartido para la prueba de mano y el campo
  window.YGO.builder = {
    decks: () => decks,
    current: () => current,
    persist,
    refresh() { renderDeckSelect(); renderDeck(); renderDetail(); markResults(); },
  };
})();
