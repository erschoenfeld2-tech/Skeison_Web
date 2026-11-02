// Welche Pokemon-Arten zaehlen als "legendaer"? Genutzt fuer die Rangliste "Legendaerer Trainer" (pokedex.js).
// Gezaehlt werden Legendaere, Sub-Legendaere und Mysterioese (Mythicals). Schluessel der Pokedex-Dateien wie "cobblemon:mewtwo" werden
// vor dem Vergleich vereinheitlicht (Namensraum weg, nur Kleinbuchstaben und Ziffern), "ho-oh" und "hooh" sind also dasselbe.
// Arten, die es in der installierten Cobblemon-Version (noch) nicht gibt, schaden hier nicht.
'use strict';

const LEGENDARY = [
  // Gen 1-2
  'articuno', 'zapdos', 'moltres', 'mewtwo', 'mew', 'raikou', 'entei', 'suicune', 'lugia', 'hooh', 'celebi',
  // Gen 3-4
  'regirock', 'regice', 'registeel', 'latias', 'latios', 'kyogre', 'groudon', 'rayquaza', 'jirachi', 'deoxys',
  'uxie', 'mesprit', 'azelf', 'dialga', 'palkia', 'heatran', 'regigigas', 'giratina', 'cresselia', 'phione', 'manaphy', 'darkrai', 'shaymin', 'arceus',
  // Gen 5-6
  'victini', 'cobalion', 'terrakion', 'virizion', 'tornadus', 'thundurus', 'reshiram', 'zekrom', 'landorus', 'kyurem', 'keldeo', 'meloetta', 'genesect',
  'xerneas', 'yveltal', 'zygarde', 'diancie', 'hoopa', 'volcanion',
  // Gen 7-8
  'typenull', 'silvally', 'tapukoko', 'tapulele', 'tapubulu', 'tapufini', 'cosmog', 'cosmoem', 'solgaleo', 'lunala', 'necrozma', 'magearna', 'marshadow', 'zeraora', 'meltan', 'melmetal',
  'zacian', 'zamazenta', 'eternatus', 'kubfu', 'urshifu', 'zarude', 'regieleki', 'regidrago', 'glastrier', 'spectrier', 'calyrex', 'enamorus',
  // Gen 9
  'wochien', 'chienpao', 'tinglu', 'chiyu', 'koraidon', 'miraidon', 'okidogi', 'munkidori', 'fezandipiti', 'ogerpon', 'terapagos', 'pecharunt',
];

// Ultrabestien zaehlen standardmaessig nicht als legendaer. Zum Mitzaehlen INCLUDE_ULTRA_BEASTS auf true setzen.
const INCLUDE_ULTRA_BEASTS = false;
const ULTRA_BEASTS = ['nihilego', 'buzzwole', 'pheromosa', 'xurkitree', 'celesteela', 'kartana', 'guzzlord', 'poipole', 'naganadel', 'stakataka', 'blacephalon'];

const norm = (species) => String(species).toLowerCase().replace(/^.*:/, '').replace(/[^a-z0-9]/g, '');
const SET = new Set(LEGENDARY.concat(INCLUDE_ULTRA_BEASTS ? ULTRA_BEASTS : []));

function isLegendary(species) { return SET.has(norm(species)); }

module.exports = { isLegendary, norm, LEGENDARY, ULTRA_BEASTS };
