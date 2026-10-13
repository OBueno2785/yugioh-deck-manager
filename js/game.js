/* Utilidades de partida compartidas por la prueba de mano y el campo:
 * instancias de carta, barajado y probabilidades (hipergeométrica). Expone window.YGO.game. */
(function () {
  const YGO = (window.YGO = window.YGO || {});

  let seq = 0;
  /** Copia física de una carta en juego: { uid, id, faceDown, def } */
  const instance = (id) => ({ uid: 'c' + (++seq).toString(36), id: Number(id), faceDown: false, def: false });

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // ln C(n, k) con una tabla de ln n! (los mazos tienen como mucho 60 cartas)
  const LF = [0];
  for (let i = 1; i <= 200; i++) LF[i] = LF[i - 1] + Math.log(i);
  const lnC = (n, k) => (k < 0 || k > n ? -Infinity : LF[n] - LF[k] - LF[n - k]);

  /** P(exactamente k copias) al robar n de un mazo de N con K copias. */
  function pExactly(N, K, n, k) {
    if (n > N) n = N;
    return Math.exp(lnC(K, k) + lnC(N - K, n - k) - lnC(N, n));
  }
  /** P(al menos 1 copia) al robar n de un mazo de N con K copias. */
  function pAtLeastOne(N, K, n) {
    if (K <= 0 || N <= 0 || n <= 0) return 0;
    if (n > N) n = N;
    return 1 - Math.exp(lnC(N - K, n) - lnC(N, n));
  }

  /** P(mano de n cartas cumple ok(k)) con varios grupos disjuntos: groups = [K1, K2, ...] copias de cada grupo en un mazo
   * de N; ok recibe [k1, k2, ...] (cuántas de cada grupo hay en la mano). Hipergeométrica multivariable exacta. */
  function pMulti(N, groups, n, ok) {
    if (n > N) n = N;
    const rest = N - groups.reduce((a, b) => a + b, 0);
    const base = lnC(N, n);
    const k = groups.map(() => 0);
    let total = 0;
    (function walk(i, used, ln) {
      if (i === groups.length) {
        const left = n - used;
        if (left > rest) return;
        if (ok(k)) total += Math.exp(ln + lnC(rest, left) - base);
        return;
      }
      for (let x = 0; x <= Math.min(groups[i], n - used); x++) { k[i] = x; walk(i + 1, used + x, ln + lnC(groups[i], x)); }
      k[i] = 0;
    })(0, 0, 0);
    return Math.min(1, total);
  }

  const pct = (p) => (p >= 0.9995 ? '100%' : p < 0.0005 ? '0%' : (p * 100).toFixed(1).replace('.', ',') + '%');

  YGO.game = { instance, shuffle, pExactly, pAtLeastOne, pMulti, pct };
})();
