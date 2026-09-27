// Piccoli aiuti di formattazione per le pagine (tutto in italiano).

/** Testo sicuro dentro l'HTML. */
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** "Ruvo di Puglia" → "ruvo-di-puglia" (per gli indirizzi delle pagine). */
export const slug = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/['’]/g, '-').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** 1.689 → "1,689" */
export const prezzo = (p) => Number(p).toFixed(3).replace('.', ',');

const PICCOLE = new Set(['di', 'del', 'della', 'delle', 'dei', 'degli', 'dello', 'da', 'dal', 'dalla', 'dalle', 'e', 'ed',
  'in', 'sul', 'sulla', 'sui', 'al', 'allo', 'alla', 'alle', 'ai', 'agli', 'nel', 'nella', 'nei', 'con', 'sopra', 'sotto',
  'a', 'o', 'su', 'per', 'tra', 'fra', 'de', 'la', 'le', 'lo', 'il']);
const ACCENTI = { A: 'à', E: 'è', I: 'ì', O: 'ò', U: 'ù' };

/**
 * Nome scritto per bene da un testo in maiuscolo del MIMIT:
 * "RUVO DI PUGLIA" → "Ruvo di Puglia", "CANTU'" → "Cantù",
 * "SANT'AGATA DE' GOTI" → "Sant'Agata de' Goti", "L'AQUILA" → "L'Aquila".
 */
export function nomeProprio(s) {
  if (!s) return '';
  const t = String(s).trim().replace(/\s+/g, ' ');
  // Se è già scritto in minuscolo/maiuscolo misto lo lasciamo com'è
  if (t !== t.toUpperCase()) return t;
  let primo = true;
  return t.split(/([ \/-])/).map((parte) => {
    if (parte === ' ' || parte === '/' || parte === '-' || parte === '') return parte;
    const p = parte
      // vocale finale con apostrofo = accento (CANTU' → Cantù)
      // (solo parole lunghe: "DE'" in "SANT'AGATA DE' GOTI" resta "de'")
      .replace(/^(.{3,}[AEIOU])'$/, (_, w) => w.slice(0, -1) + ACCENTI[w.at(-1)])
      .toLowerCase()
      .split("'")
      .map((pezzo, i, arr) => {
        if (!pezzo) return pezzo;
        const conApostrofo = i < arr.length - 1; // "d'", "l'", "sant'"
        const minuscola = !primo && ((i === 0 && (conApostrofo ? ['d', 'l', 'de', 'dell', 'nell', 'all', 'dall', 'sull'].includes(pezzo) : PICCOLE.has(pezzo))));
        return minuscola ? pezzo : pezzo[0].toUpperCase() + pezzo.slice(1);
      })
      .join("'");
    primo = false;
    return p;
  }).join('');
}

/** Indirizzo leggibile: "VIA RUVO 120" → "Via Ruvo 120", "S.P. 231 KM 12+500" → "S.P. 231 km 12+500". */
export function indirizzo(s) {
  if (!s) return '';
  return nomeProprio(s)
    .replace(/\bKm\b/g, 'km')
    .replace(/\b(Ss|Sp|Sr|Sc)\b/g, (m) => m.toUpperCase())
    .replace(/\b(S\.s\.|S\.p\.|S\.r\.|S\.c\.)/g, (m) => m.toUpperCase());
}

// Marche note: sigla del bollino e nome da mostrare (solo testo, nessun logo)
const MARCHE = [
  ['agip', 'ENI', 'Eni'], ['eni', 'ENI', 'Eni'], ['q8easy', 'Q8', 'Q8 Easy'], ['q8', 'Q8', 'Q8'],
  ['api', 'IP', 'IP'], ['ip', 'IP', 'IP'], ['esso', 'ESSO', 'Esso'], ['tamoil', 'TAMOIL', 'Tamoil'],
  ['shell', 'SHELL', 'Shell'], ['total', 'TOTAL', 'Total'], ['repsol', 'REPSOL', 'Repsol'],
  ['saras', 'SARAS', 'Saras'], ['keropetrol', 'KERO', 'Keropetrol'],
];

/** { sigla, nome } della marca; sigla null = pompa bianca. Stessa logica dell'app. */
export function marca(bandiera) {
  const b = (bandiera ?? '').trim();
  const l = b.toLowerCase();
  if (!b || l.includes('pompe bianche') || l === 'pompa bianca') return { sigla: null, nome: 'Pompa bianca' };
  for (const [chiave, sigla, nome] of MARCHE) {
    if (l === chiave || l.startsWith(chiave + ' ') || l.startsWith(chiave + '-') || l.includes(' ' + chiave)) return { sigla, nome };
  }
  const parola = b.split(/[\s-]+/)[0].toUpperCase();
  return { sigla: parola.slice(0, 6), nome: nomeProprio(b) };
}

// -----------------------------------------------------------------------------
// Date nel fuso italiano
// -----------------------------------------------------------------------------
const parti = (d, opzioni) => Object.fromEntries(
  new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', ...opzioni }).formatToParts(d).map((p) => [p.type, p.value]),
);
const giornoRoma = (d) => { const p = parti(d, { year: 'numeric', month: '2-digit', day: '2-digit' }); return `${p.year}-${p.month}-${p.day}`; };
const oraRoma = (d) => { const p = parti(d, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }); return `${p.hour}:${p.minute}`; };

/** "domenica 27 settembre alle 12:10" */
export function dataEstesa(d) {
  const p = parti(d, { weekday: 'long', day: 'numeric', month: 'long' });
  return `${p.weekday} ${p.day} ${p.month} alle ${oraRoma(d)}`;
}

/** "oggi 07:30", "ieri 19:40", "3 giorni fa", "12/09/2026" (rispetto ad [ora]). */
export function aggiornamento(d, ora) {
  const g = (x) => Date.parse(giornoRoma(x) + 'T00:00:00Z');
  const diff = Math.round((g(ora) - g(d)) / 86400000);
  if (diff <= 0) return `oggi ${oraRoma(d)}`;
  if (diff === 1) return `ieri ${oraRoma(d)}`;
  if (diff < 7) return `${diff} giorni fa`;
  const p = parti(d, { year: 'numeric', month: '2-digit', day: '2-digit' });
  return `${p.day}/${p.month}/${p.year}`;
}

/** Data per la sitemap: "2026-09-27" */
export const dataIso = (d) => giornoRoma(d);
