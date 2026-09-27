// Province italiane: sigla → nome e regione (per i percorsi delle pagine).
// Comprende anche le vecchie sigle sarde (OT, OG, CI, VS) che l'anagrafica
// MIMIT può ancora usare.
export const REGIONI = {
  'Piemonte': { TO: 'Torino', VC: 'Vercelli', NO: 'Novara', CN: 'Cuneo', AT: 'Asti', AL: 'Alessandria', BI: 'Biella', VB: 'Verbano-Cusio-Ossola' },
  "Valle d'Aosta": { AO: 'Aosta' },
  'Lombardia': { VA: 'Varese', CO: 'Como', SO: 'Sondrio', MI: 'Milano', BG: 'Bergamo', BS: 'Brescia', PV: 'Pavia', CR: 'Cremona', MN: 'Mantova', LC: 'Lecco', LO: 'Lodi', MB: 'Monza e Brianza' },
  'Trentino-Alto Adige': { BZ: 'Bolzano', TN: 'Trento' },
  'Veneto': { VR: 'Verona', VI: 'Vicenza', BL: 'Belluno', TV: 'Treviso', VE: 'Venezia', PD: 'Padova', RO: 'Rovigo' },
  'Friuli-Venezia Giulia': { UD: 'Udine', GO: 'Gorizia', TS: 'Trieste', PN: 'Pordenone' },
  'Liguria': { IM: 'Imperia', SV: 'Savona', GE: 'Genova', SP: 'La Spezia' },
  'Emilia-Romagna': { PC: 'Piacenza', PR: 'Parma', RE: 'Reggio Emilia', MO: 'Modena', BO: 'Bologna', FE: 'Ferrara', RA: 'Ravenna', FC: 'Forlì-Cesena', RN: 'Rimini' },
  'Toscana': { MS: 'Massa-Carrara', LU: 'Lucca', PT: 'Pistoia', FI: 'Firenze', LI: 'Livorno', PI: 'Pisa', AR: 'Arezzo', SI: 'Siena', GR: 'Grosseto', PO: 'Prato' },
  'Umbria': { PG: 'Perugia', TR: 'Terni' },
  'Marche': { PU: 'Pesaro e Urbino', AN: 'Ancona', MC: 'Macerata', AP: 'Ascoli Piceno', FM: 'Fermo' },
  'Lazio': { VT: 'Viterbo', RI: 'Rieti', RM: 'Roma', LT: 'Latina', FR: 'Frosinone' },
  'Abruzzo': { AQ: "L'Aquila", TE: 'Teramo', PE: 'Pescara', CH: 'Chieti' },
  'Molise': { CB: 'Campobasso', IS: 'Isernia' },
  'Campania': { CE: 'Caserta', BN: 'Benevento', NA: 'Napoli', AV: 'Avellino', SA: 'Salerno' },
  'Puglia': { FG: 'Foggia', BA: 'Bari', TA: 'Taranto', BR: 'Brindisi', LE: 'Lecce', BT: 'Barletta-Andria-Trani' },
  'Basilicata': { PZ: 'Potenza', MT: 'Matera' },
  'Calabria': { CS: 'Cosenza', CZ: 'Catanzaro', RC: 'Reggio Calabria', KR: 'Crotone', VV: 'Vibo Valentia' },
  'Sicilia': { TP: 'Trapani', PA: 'Palermo', ME: 'Messina', AG: 'Agrigento', CL: 'Caltanissetta', EN: 'Enna', CT: 'Catania', RG: 'Ragusa', SR: 'Siracusa' },
  'Sardegna': { SS: 'Sassari', NU: 'Nuoro', CA: 'Cagliari', OR: 'Oristano', SU: 'Sud Sardegna', OT: 'Olbia-Tempio', OG: 'Ogliastra', CI: 'Carbonia-Iglesias', VS: 'Medio Campidano' },
};

/** sigla → { sigla, nome, regione } */
export const PROVINCE = Object.fromEntries(
  Object.entries(REGIONI).flatMap(([regione, prov]) =>
    Object.entries(prov).map(([sigla, nome]) => [sigla, { sigla, nome, regione }])),
);
