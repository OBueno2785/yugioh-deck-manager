/* Mazos compartidos en el proyecto. Se agregan una vez a la lista de mazos guardados.
 * Formato de lista "3x Nombre" (el que exporta Dueling Nexus como texto). Las cartas que no
 * estén en la base incluida se buscan por nombre en YGOPRODeck cuando la app se abre como sitio web.
 * replaces: presetId de versiones anteriores; el mazo guardado de esa versión (o uno con un nombre de
 * replacesNames) se reemplaza por esta lista al abrir la app, conservando su id, su nombre si lo cambiaste
 * y los roles de sus cartas.
 * rival: true → al agregarse queda como "Mazo del rival" por defecto del modo VS (no cambia tu mazo elegido). */
window.YGO_PRESET_DECKS = [
  {
    // Lista del video «Elfnote Ars Magna Post Banlist» (Kaiba Core, 2026-10-22) que Oscar pidió el 2026-10-26; el Side es
    // el de su lista anterior. Sus 3 combos vienen en js/preset-combos.js
    presetId: 'oscar-elfnote-2026-10-26',
    name: 'Elfnote Ars Magna',
    replaces: ['oscar-elfnote-2026-10-20', 'oscar-elfnote-2026-10'],
    replacesNames: ['Elfnote (Dueling Nexus)', 'Elfnote Arsmagna', 'Elfnote Ars Magna'],
    list: "Main Deck:\n3x Elfnote Lucina\n3x Elfnote Regina\n1x Elfnote Fortuna\n2x Elfnote Power Patron\n1x Elfnotes: Welcome Home\n1x Elfnotes: Rhapsodia of Madness\n2x Medius the Pure\n2x Vidolium the Unstable Power Patron of Unity\n1x Junoldo the Shadespirit Power Patron\n1x Prohibited Power Patron Portal - Terminus\n1x Theorealize Past Lull\n1x Theorealize\n1x Ars Magna the Finite and the Infinite\n1x Ars Magna the Corruption and the Purification\n1x Ars Magna the Division and the Union\n1x Theorealized Medius\n1x Ars Magna \"Citrinitas\"\n1x Jet Synchron\n3x Mulcharmy Fuwalos\n3x Ash Blossom & Joyous Spring\n3x Ghost Ogre & Snow Rabbit\n3x Effect Veiler\n3x Nibiru, the Primal Being\n1x Droll & Lock Bird\nExtra Deck:\n1x Mediclius the Extraordinary Power Patron\n1x Purification Power Patron\n1x S:P Little Knight\n1x Number 90: Galaxy-Eyes Photon Lord\n1x Accel Synchron\n1x Elfnote June Pride\n1x Ravenous Crocodragon Archethys\n1x Accel Synchro Stardust Dragon\n1x Black Rose Dragon\n1x Elfnote Seraphim Strelitzia\n1x Chaos Angel\n1x Juraishin, the Cursed Thunder God\n1x Crimson Dragon\n1x Shooting Majestic Star Dragon\n1x Crystal Clear Wing Synchro Dragon\nSide Deck:\n2x Hey, Space Trunade!\n1x Harpie's Feather Duster\n2x Illusion Gate\n2x Theorealize\n2x Pot of Sloth\n2x Solemn Accusation\n1x Solemn Warning",
  },
  {
    presetId: 'oscar-angelechy-2026-10-20',
    name: 'Angelechy',
    rival: true,
    list: "Main Deck:\n1x Witness of the Ancient\n2x Fydraulis Harmonia\n3x Chaospawn Bishop\n2x Mulcharmy Fuwalos\n2x Mulcharmy Purulia\n3x Ash Blossom & Joyous Spring\n3x Angelechy Strategy Score\n2x Angelechy Brilliant Move\n1x Terraforming\n3x Angelechy Opposition\n3x Angelechy Endgame Problem\n3x Angelechy Problem\n2x Angelechy Verdict\n1x Angelechy Disturbance\n3x Angelechy Opening to e4\n3x Dominus Impulse\n3x Dominus Spark\nExtra Deck:\n1x Chaos Angel\n1x Black-Winged Assault Dragon\n2x Angelechy Shatranga\n1x Angelechy Seneschal\n2x Angelechy Bastion\n1x Glitch Clutch Nullgainer\n2x Angelechy Destrier\n1x Angelechy Castellan\n1x Golden Cloud Beast - Malong\n3x Angelechy Enlisted",
  },
];
