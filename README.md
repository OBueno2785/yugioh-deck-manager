# Simulador Yugioh

Sitio estático: constructor de mazos, prueba de mano, campo para practicar combos, duelo VS contra la computadora y duelo En línea contra otra persona.
Se publica con GitHub Pages desde esta rama (gh-pages). El código fuente vive en el proyecto Simulador Yugioh.

El duelo En línea conecta los dos navegadores directo (WebRTC) con PeerJS (`js/vendor/peerjs.min.js`, licencia MIT en `js/vendor/PEERJS-LICENSE`) y su servidor público de señales. Lo oculto (mano, Mazo, Extra Deck y cartas boca abajo) no se manda por la red.
