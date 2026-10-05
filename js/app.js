/* Navegación entre Constructor, Prueba de mano y Campo (con #constructor, #mano, #campo). */
(function () {
  const YGO = window.YGO;
  const MODES = ['constructor', 'mano', 'campo'];

  function route(want) {
    const h = typeof want === 'string' ? want : location.hash.replace('#', '');
    const mode = MODES.includes(h) ? h : 'constructor';
    document.body.dataset.mode = mode;
    document.querySelectorAll('.mode-pane').forEach((el) => { el.hidden = el.dataset.mode !== mode; });
    document.querySelectorAll('.modes .mode').forEach((a) => {
      const on = a.getAttribute('href') === '#' + mode;
      a.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    document.getElementById('modal').hidden = true;
    document.body.classList.remove('detail-open');
    if (mode === 'constructor') YGO.builder.refresh();
    if (mode === 'mano') YGO.handtest.enter();
    if (mode === 'campo') YGO.field.enter();
  }

  // Al cambiar de modo dentro del visor no siempre llega hashchange; se maneja el clic directamente
  document.querySelectorAll('.modes .mode').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    YGO.go(a.getAttribute('href').slice(1));
  }));
  window.addEventListener('hashchange', route);
  YGO.go = (mode) => {
    try { history.replaceState(null, '', '#' + mode); } catch (err) { /* nada */ }
    route(mode);
  };
  route();
})();
