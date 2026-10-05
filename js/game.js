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

  const pct = (p) => (p >= 0.9995 ? '100%' : p < 0.0005 ? '0%' : (p * 100).toFixed(1).replace('.', ',') + '%');

  YGO.game = { instance, shuffle, pExactly, pAtLeastOne, pct };
})();
