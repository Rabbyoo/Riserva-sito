// =============================================================================
//  Generatore delle pagine "Prezzi benzina e diesel oggi a <comune>"
// =============================================================================
//  Gira su GitHub Actions (vedi .github/workflows/pagine-prezzi.yml) due volte
//  al giorno, dopo l'aggiornamento dei prezzi. Nessuna libreria esterna.
//
//  1. scarica dal database i prezzi, una regione alla volta
//  2. crea una pagina per ogni comune, provincia e regione + la pagina Italia
//  3. crea sitemap.xml (l'elenco delle pagine per Google) e robots.txt
//  4. copia il resto del sito (home, privacy, caratteri, immagini)
//
//  Tutto finisce nella cartella _site, che GitHub pubblica su riservapp.it.
//
//  Variabili:
//    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   → accesso ai dati (segreti GitHub)
//    URL_GOOGLE_PLAY, URL_APP_STORE             → link agli store (vuoti = "Presto su")
//    DATI_FILE=percorso.json                    → prova in locale senza database
//    MIN_COMUNI=1000                            → sotto questa soglia si ferma
//                                                 (protezione da dati incompleti)
// =============================================================================
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PROVINCE, REGIONI } from './province.mjs';
import { aggiornamento, dataEstesa, dataIso, esc, indirizzo, marca, nomeProprio, prezzo, slug } from './testi.mjs';

const QUI = path.dirname(fileURLToPath(import.meta.url));
const SITO = path.resolve(QUI, '..');
const USCITA = path.join(SITO, '_site');
const DOMINIO = 'https://riservapp.it';
const URL_PLAY = process.env.URL_GOOGLE_PLAY || '';
const URL_APPSTORE = process.env.URL_APP_STORE || '';
const MIN_COMUNI = Number(process.env.MIN_COMUNI ?? 1000);

const log = (...a) => console.log(...a);

// -----------------------------------------------------------------------------
// 1. Dati
// -----------------------------------------------------------------------------
async function rpc(nome, corpo) {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const chiave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !chiave) throw new Error('Mancano SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY (o DATI_FILE per una prova)');
  for (let tentativo = 1; ; tentativo++) {
    try {
      const res = await fetch(`${url}/rest/v1/rpc/${nome}`, {
        method: 'POST',
        headers: { apikey: chiave, Authorization: `Bearer ${chiave}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return await res.json();
    } catch (e) {
      if (tentativo >= 4) throw e;
      log(`⚠️  ${e.message} — nuovo tentativo tra ${tentativo * 5}s`);
      await new Promise((r) => setTimeout(r, tentativo * 5000));
    }
  }
}

async function caricaDati() {
  if (process.env.DATI_FILE) return JSON.parse(await readFile(process.env.DATI_FILE, 'utf8'));
  const tutte = [];
  let aggiornato = null;
  for (const [regione, prov] of Object.entries(REGIONI)) {
    const r = await rpc('get_dati_sito', { province: Object.keys(prov) });
    log(`⬇️  ${regione}: ${r.stazioni.length} distributori`);
    tutte.push(...r.stazioni);
    aggiornato ??= r.aggiornato_at;
  }
  return { aggiornato_at: aggiornato, stazioni: tutte };
}

// Chiavi dei prezzi: benzina e diesel self/servito, GPL e metano (qualsiasi modalità)
const VOCI = {
  diesel_self: { nome: 'Diesel self', breve: 'diesel self', unita: '€/l', modo: 'self' },
  benzina_self: { nome: 'Benzina self', breve: 'benzina self', unita: '€/l', modo: 'self' },
  diesel_serv: { nome: 'Diesel servito', breve: 'diesel servito', unita: '€/l', modo: 'servito' },
  benzina_serv: { nome: 'Benzina servito', breve: 'benzina servito', unita: '€/l', modo: 'servito' },
  gpl: { nome: 'GPL', breve: 'GPL', unita: '€/l', modo: null },
  metano: { nome: 'Metano', breve: 'metano', unita: '€/kg', modo: null },
};
const chiaveVoce = (tipo, self) => (tipo === 'gpl' || tipo === 'metano' ? tipo : `${tipo}_${self ? 'self' : 'serv'}`);

/** Distributori puliti: nome, marca, indirizzo e il prezzo migliore per ogni voce. */
function preparaStazioni(grezze) {
  return grezze.map((s) => {
    const prezzi = {};
    for (const [tipo, self, p, dt] of s.pr ?? []) {
      const k = chiaveVoce(tipo, self);
      const v = { prezzo: Number(p), dt: new Date(dt), self };
      const prima = prezzi[k];
      if (!prima || v.prezzo < prima.prezzo || (v.prezzo === prima.prezzo && v.dt > prima.dt)) prezzi[k] = v;
    }
    const m = marca(s.b);
    return {
      id: s.id, sigla: m.sigla, marca: m.nome, indirizzo: indirizzo(s.a), comuneMimit: String(s.c).trim().toUpperCase(),
      prov: String(s.p ?? '').trim().toUpperCase(), la: Number(s.la), lo: Number(s.lo), prezzi,
    };
  }).filter((s) => Object.keys(s.prezzi).length > 0);
}

/**
 * Scarta i prezzi palesemente sbagliati (errori di battitura dei gestori):
 * sotto il 70% o sopra il 150% del prezzo mediano italiano di quella voce.
 * Così un "0,169" non compare mai come il più economico.
 */
function scartaAnomali(stazioni) {
  let scartati = 0;
  for (const voce of Object.keys(VOCI)) {
    const valori = stazioni.filter((s) => s.prezzi[voce]).map((s) => s.prezzi[voce].prezzo).sort((a, b) => a - b);
    if (valori.length < 20) continue;
    const mediana = valori[Math.floor(valori.length / 2)];
    for (const s of stazioni) {
      const p = s.prezzi[voce];
      if (p && (p.prezzo < mediana * 0.7 || p.prezzo > mediana * 1.5)) { delete s.prezzi[voce]; scartati++; }
    }
  }
  if (scartati) log(`🧹 ${scartati} prezzi anomali scartati`);
  return stazioni.filter((s) => Object.keys(s.prezzi).length > 0);
}

/** Minimo, media e distributori ordinati dal più economico, per una voce. */
function statistica(stazioni, voce) {
  const con = stazioni.filter((s) => s.prezzi[voce])
    .sort((a, b) => a.prezzi[voce].prezzo - b.prezzi[voce].prezzo || b.prezzi[voce].dt - a.prezzi[voce].dt);
  if (!con.length) return { n: 0, min: null, media: null, ordinate: [] };
  const somma = con.reduce((t, s) => t + s.prezzi[voce].prezzo, 0);
  return { n: con.length, min: con[0].prezzi[voce].prezzo, media: somma / con.length, ordinate: con };
}

const statistiche = (stazioni) => Object.fromEntries(Object.keys(VOCI).map((v) => [v, statistica(stazioni, v)]));

// -----------------------------------------------------------------------------
// 2. Struttura: regioni → province → comuni
// -----------------------------------------------------------------------------
function costruisciAlbero(stazioni) {
  const regioni = new Map();
  let ignorate = 0;
  for (const s of stazioni) {
    const p = PROVINCE[s.prov];
    if (!p) { ignorate++; continue; }
    if (!regioni.has(p.regione)) {
      regioni.set(p.regione, { nome: p.regione, slug: slug(p.regione), province: new Map(), stazioni: [] });
    }
    const r = regioni.get(p.regione);
    if (!r.province.has(p.sigla)) {
      r.province.set(p.sigla, { sigla: p.sigla, nome: p.nome, slug: slug(p.nome), regione: r, comuni: new Map(), stazioni: [] });
    }
    const pr = r.province.get(p.sigla);
    if (!pr.comuni.has(s.comuneMimit)) {
      const nome = nomeProprio(s.comuneMimit);
      pr.comuni.set(s.comuneMimit, { nome, slug: slug(nome), provincia: pr, stazioni: [] });
    }
    const c = pr.comuni.get(s.comuneMimit);
    c.stazioni.push(s); pr.stazioni.push(s); r.stazioni.push(s);
    s.comune = c;
  }
  if (ignorate) log(`ℹ️  ${ignorate} distributori con sigla di provincia sconosciuta ignorati`);

  const comuni = [];
  for (const r of regioni.values()) {
    r.url = `/prezzi/${r.slug}/`;
    r.stat = statistiche(r.stazioni);
    for (const p of r.province.values()) {
      p.url = `${r.url}${p.slug}/`;
      p.stat = statistiche(p.stazioni);
      // due comuni con lo stesso nome "pulito" nella stessa provincia: si distinguono
      const usati = new Set();
      for (const c of p.comuni.values()) {
        let sl = c.slug || 'comune';
        for (let i = 2; usati.has(sl); i++) sl = `${c.slug}-${i}`;
        usati.add(sl);
        c.slug = sl;
        c.url = `${p.url}${sl}/`;
        c.stat = statistiche(c.stazioni);
        c.la = c.stazioni.reduce((t, s) => t + s.la, 0) / c.stazioni.length;
        c.lo = c.stazioni.reduce((t, s) => t + s.lo, 0) / c.stazioni.length;
        comuni.push(c);
      }
    }
  }
  return { regioni: [...regioni.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'it')), comuni };
}

/** I 6 comuni più vicini (in linea d'aria) di ogni comune. */
function collegaVicini(comuni) {
  const rad = Math.PI / 180;
  for (const c of comuni) {
    const cosLat = Math.cos(c.la * rad);
    const dist = [];
    for (const o of comuni) {
      if (o === c) continue;
      const dx = (o.lo - c.lo) * cosLat, dy = o.la - c.la;
      const d = dx * dx + dy * dy;
      if (d < 0.25) dist.push([d, o]); // ~50 km: basta e alleggerisce il calcolo
    }
    c.vicini = dist.sort((a, b) => a[0] - b[0]).slice(0, 6).map(([, o]) => o);
  }
}

// -----------------------------------------------------------------------------
// 3. HTML
// -----------------------------------------------------------------------------
const LOGO = `<svg width="42" height="27" viewBox="0 0 260 170" aria-hidden="true">
        <path d="M20 140 A110 110 0 0 1 240 140" fill="none" stroke="#2A365C" stroke-width="16" stroke-linecap="round"/>
        <path d="M20 140 A110 110 0 0 1 205.5 60" fill="none" stroke="#FFB020" stroke-width="16"/>
        <path d="M20 140 A110 110 0 0 1 23.75 111.53" fill="none" stroke="#FF5A4A" stroke-width="16"/><circle cx="20" cy="140" r="8" fill="#FF5A4A"/>
        <path d="M3 140 A127 127 0 0 1 7.33 107.13" fill="none" stroke="#FF5A4A" stroke-width="5"/><circle cx="3" cy="140" r="2.5" fill="#FF5A4A"/>
        <line x1="130" y1="140" x2="195.9" y2="70.2" stroke="#FFFFFF" stroke-width="9" stroke-linecap="round"/>
        <circle cx="130" cy="140" r="15" fill="#FFB020"/><circle cx="130" cy="140" r="6" fill="#121A33"/>
      </svg>`;

function pagina({ titolo, descrizione, url, briciole, h1, sottotitolo, corpo }) {
  const ld = {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: briciole.map((b, i) => ({ '@type': 'ListItem', position: i + 1, name: b.nome, item: DOMINIO + b.url })),
  };
  const percorso = briciole.map((b, i) => (i === briciole.length - 1 ? esc(b.nome) : `<a href="${b.url}">${esc(b.nome)}</a>`)).join(' › ');
  return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titolo)}</title>
<meta name="description" content="${esc(descrizione)}">
<link rel="canonical" href="${DOMINIO}${url}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(titolo)}">
<meta property="og:description" content="${esc(descrizione)}">
<meta property="og:url" content="${DOMINIO}${url}">
<meta property="og:locale" content="it_IT">
<meta name="theme-color" content="#121A33">
<link rel="icon" href="/img/favicon.png">
<link rel="stylesheet" href="/prezzi/stile.css">
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>
</head>
<body>
<header class="testata">
  <div class="contenitore">
    <a class="marchio" href="/" aria-label="Riserva, pagina iniziale">
      ${LOGO}
      <span>Riserva</span>
    </a>
    <a class="scarica-mini" href="#app">Scarica l'app</a>
  </div>
</header>

<div class="apertura">
  <div class="contenitore">
    <nav class="briciole" aria-label="Percorso">${percorso}</nav>
    <h1 class="titolo">${h1}</h1>
    <p class="aggiornato">${sottotitolo}</p>
    <div style="height:28px"></div>
  </div>
</div>

<main class="contenitore">
${corpo}
${bloccoApp()}
</main>

<footer class="piede">
  <div class="contenitore">
    © ${new Date().getFullYear()} Riserva · App indipendente, non collegata al Ministero delle Imprese e del Made in Italy.
    Prezzi: Open Data MIMIT (licenza IODL 2.0), rielaborati. Il prezzo esposto alla pompa prevale sempre.
    <nav><a href="/prezzi/">Prezzi in Italia</a><a href="/privacy.html">Informativa privacy</a><a href="mailto:info@riservapp.it">Contatti</a></nav>
  </div>
</footer>
</body>
</html>
`;
}

function bloccoApp() {
  const pulsante = (url, store) => (url
    ? `<a href="${esc(url)}"><small>Scarica su</small><b>${store}</b></a>`
    : `<a href="/"><small>Presto su</small><b>${store}</b></a>`);
  return `
  <section id="app">
    <div class="app">
      <div>
        <h2 class="titolo">Il più economico non sempre <em>conviene davvero</em></h2>
        <p>Se il distributore più economico è a 5 km, il viaggio può costarti più del risparmio.
        Riserva lo calcola per la tua auto e ti mostra con una stellina quello che conviene davvero.
        Gratis, senza pubblicità, senza registrazione.</p>
      </div>
      <div class="store">
        ${pulsante(URL_PLAY, 'Google Play')}
        ${pulsante(URL_APPSTORE, 'App Store')}
      </div>
    </div>
  </section>`;
}

const sottotitoloAggiornato = (agg, n) =>
  `<span>🕒 Aggiornati ${esc(dataEstesa(agg))}</span><span>⛽ ${n} ${n === 1 ? 'distributore' : 'distributori'}</span>`;

/** Differenza con la media di confronto, in centesimi: "▼ 2 cent sotto la media della provincia". */
function confronto(media, mediaRif, doveRif) {
  if (media == null || mediaRif == null) return '';
  const cent = Math.round((media - mediaRif) * 100);
  if (cent === 0) return `<div class="confronto">in linea con la media ${doveRif}</div>`;
  const quanto = `${Math.abs(cent)} cent`;
  return cent < 0
    ? `<div class="confronto giu">▼ ${quanto} sotto la media ${doveRif}</div>`
    : `<div class="confronto su">▲ ${quanto} sopra la media ${doveRif}</div>`;
}

/** I quattro riquadri: diesel self, benzina self, GPL, metano. */
function riepilogo(stat, statRif, doveRif) {
  return `  <div class="riepilogo">
${['diesel_self', 'benzina_self', 'gpl', 'metano'].map((v) => {
    const s = stat[v];
    const info = VOCI[v];
    if (!s.n) {
      return `    <div class="scheda carb"><small>${info.nome}</small><b class="vuoto">—</b><div class="media">nessun prezzo recente</div></div>`;
    }
    return `    <a class="scheda carb" href="#${v}">
      <small>${info.nome}</small>
      <b class="num">${prezzo(s.min)} <i>${info.unita}</i></b>
      <div class="media num">${s.n === 1 ? '1 distributore' : `media ${prezzo(s.media)}`}</div>
      ${statRif ? confronto(s.media, statRif[v].media, doveRif) : ''}
    </a>`;
  }).join('\n')}
  </div>`;
}

/** Elenco dei 5 più economici per una voce. */
function elenco(stat, voce, ora, { conComune = false, classe = 'elenco scheda' } = {}) {
  const info = VOCI[voce];
  const righe = stat[voce].ordinate.slice(0, 5).map((s, i) => {
    const p = s.prezzi[voce];
    const modo = info.modo ?? (p.self ? 'self' : 'servito');
    const dove = [s.indirizzo, conComune ? `${s.comune.nome} (${s.prov})` : null, `agg. ${aggiornamento(p.dt, ora)}`].filter(Boolean).join(' · ');
    return `      <li><span class="pos">${i + 1}</span>
        <span class="nome"><span class="marca">${s.sigla ? esc(s.sigla) : '⛽'}</span><span>${esc(s.marca)}</span></span>
        <span class="dove">${esc(dove)}</span>
        <span class="prezzo"><b class="num">${prezzo(p.prezzo)}</b><small>${info.unita} ${modo}</small></span></li>`;
  });
  return `    <ol class="${classe}">\n${righe.join('\n')}\n    </ol>`;
}

/** Sezione principale (diesel self, o la prima voce disponibile) + le altre a scomparsa. */
function sezioniPrezzi(stat, ora, luogo, opzioni = {}) {
  const ordine = ['diesel_self', 'benzina_self', 'diesel_serv', 'benzina_serv', 'gpl', 'metano'];
  const disponibili = ordine.filter((v) => stat[v].n);
  if (!disponibili.length) return '';
  const [prima, ...altre] = disponibili;
  let html = `
  <section id="${prima}">
    <h2 class="titolo">${VOCI[prima].nome}: i più economici</h2>
    <p>Prezzi comunicati dai gestori al Ministero${luogo ? ` · ${esc(luogo)}` : ''}.</p>
${elenco(stat, prima, ora, opzioni)}
  </section>`;
  if (altre.length) {
    html += `
  <section>
    <h2 class="titolo">Gli altri carburanti</h2>
    <p>Tocca per vedere i distributori più economici.</p>
${altre.map((v) => `    <details class="scheda" id="${v}">
      <summary><span>${VOCI[v].nome}</span><span class="da num">da ${prezzo(stat[v].min)} ${VOCI[v].unita}</span></summary>
${elenco(stat, v, ora, { ...opzioni, classe: 'elenco' })}
    </details>`).join('\n')}
  </section>`;
  }
  return html;
}

/** Tabella di comuni o province con il prezzo più basso di diesel e benzina self. */
function tabella(voci, etichetta) {
  const cella = (s, v) => (s[v].n ? `<span class="num">${prezzo(s[v].min)}</span>` : '<span class="num vuoto">—</span>');
  return `    <div class="tabella scheda">
      <div class="intestazione"><span>${etichetta}</span><span>Diesel self</span><span>Benzina self</span></div>
${voci.map((x) => `      <a href="${x.url}"><b>${esc(x.nome)}${x.extra ? ` <small>${esc(x.extra)}</small>` : ''}</b>${cella(x.stat, 'diesel_self')}${cella(x.stat, 'benzina_self')}</a>`).join('\n')}
    </div>`;
}

function paginaComune(c, ora, agg) {
  const p = c.provincia, r = p.regione, st = c.stat;
  const ds = st.diesel_self, bs = st.benzina_self;
  const luogo = `${c.nome} (${p.sigla})`;
  const inizio = [ds.n && `diesel self da ${prezzo(ds.min)} €/l`, bs.n && `benzina self da ${prezzo(bs.min)} €/l`].filter(Boolean).join(', ');
  const descrizione = `Prezzi aggiornati oggi dei distributori di ${c.nome}${inizio ? `: ${inizio}` : ''}. I più economici, la media del comune e della provincia di ${p.nome}.`;

  const faq = [];
  for (const [v, cosa] of [['diesel_self', 'il diesel'], ['benzina_self', 'la benzina']]) {
    const s = st[v];
    if (!s.n) continue;
    const t = s.ordinate[0];
    faq.push(`      <details${faq.length ? '' : ' open'}>
        <summary>Dove costa meno ${cosa} a ${esc(c.nome)} oggi?</summary>
        <p>Oggi ${cosa === 'il diesel' ? 'il diesel self più economico' : 'la benzina self più economica'} di ${esc(c.nome)} è da ${esc(t.marca)}${t.indirizzo ? ` in ${esc(t.indirizzo)}` : ''}, a ${prezzo(t.prezzi[v].prezzo)} €/l
        (aggiornato ${esc(aggiornamento(t.prezzi[v].dt, ora))}).${s.n > 1 ? ` La media del comune è ${prezzo(s.media)} €/l.` : ''}</p>
      </details>`);
  }
  faq.push(`      <details${faq.length ? '' : ' open'}>
        <summary>Da dove arrivano questi prezzi?</summary>
        <p>Dall'Osservatorio prezzi carburanti del Ministero delle Imprese e del Made in Italy: i gestori sono obbligati
        a comunicare ogni variazione. Aggiorniamo questa pagina due volte al giorno. Il prezzo esposto alla pompa prevale sempre.</p>
      </details>`);

  const vicini = c.vicini.length ? `
  <section>
    <h2 class="titolo">Comuni vicini</h2>
    <div class="vicini">
${c.vicini.map((o) => `      <a href="${o.url}">${esc(o.nome)}${o.stat.diesel_self.n ? ` <span class="num">${prezzo(o.stat.diesel_self.min)}</span>` : ''}</a>`).join('\n')}
    </div>
    <p class="nota">Prezzo più basso del diesel self di oggi.</p>
  </section>` : '';

  const corpo = `${riepilogo(st, p.stat, 'della provincia')}
${sezioniPrezzi(st, ora, luogo)}
    <p class="altri"><a href="#app">Vedi tutti ${c.stazioni.length === 1 ? 'i distributori' : `i ${c.stazioni.length} distributori`} sulla mappa nell'app →</a></p>
${vicini}
  <section class="domande">
    <h2 class="titolo">Domande frequenti</h2>
    <div class="scheda" style="padding:4px 16px;margin-top:12px">
${faq.join('\n')}
    </div>
  </section>`;

  return pagina({
    titolo: `Prezzi benzina e diesel oggi a ${c.nome} (${p.sigla}) · Riserva`,
    descrizione, url: c.url,
    briciole: [{ nome: 'Italia', url: '/prezzi/' }, { nome: r.nome, url: r.url }, { nome: p.nome, url: p.url }, { nome: c.nome, url: c.url }],
    h1: `Prezzi benzina e diesel oggi a <em>${esc(c.nome)}</em>`,
    sottotitolo: sottotitoloAggiornato(agg, c.stazioni.length),
    corpo,
  });
}

function paginaProvincia(p, ora, agg) {
  const r = p.regione;
  const comuni = [...p.comuni.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'it'));
  const ds = p.stat.diesel_self;
  const corpo = `${riepilogo(p.stat, r.stat, 'della regione')}
${sezioniPrezzi(p.stat, ora, `provincia di ${p.nome}`, { conComune: true })}
  <section>
    <h2 class="titolo">Tutti i comuni della provincia</h2>
    <p>Prezzo più basso di oggi in ogni comune. Tocca un comune per i dettagli.</p>
${tabella(comuni.map((c) => ({ nome: c.nome, url: c.url, stat: c.stat })), 'Comune')}
  </section>`;
  return pagina({
    titolo: `Prezzi benzina e diesel oggi in provincia di ${p.nome} · Riserva`,
    descrizione: `Prezzi dei carburanti oggi in provincia di ${p.nome}${ds.n ? `: diesel self da ${prezzo(ds.min)} €/l` : ''}. I distributori più economici e i prezzi di tutti i ${comuni.length} comuni.`,
    url: p.url,
    briciole: [{ nome: 'Italia', url: '/prezzi/' }, { nome: r.nome, url: r.url }, { nome: p.nome, url: p.url }],
    h1: `Prezzi benzina e diesel oggi in provincia di <em>${esc(p.nome)}</em>`,
    sottotitolo: sottotitoloAggiornato(agg, p.stazioni.length),
    corpo,
  });
}

function paginaRegione(r, italia, ora, agg) {
  const province = [...r.province.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'it'));
  const corpo = `${riepilogo(r.stat, italia, 'italiana')}
${sezioniPrezzi(r.stat, ora, r.nome, { conComune: true })}
  <section>
    <h2 class="titolo">Le province</h2>
    <p>Prezzo più basso di oggi in ogni provincia.</p>
${tabella(province.map((p) => ({ nome: p.nome, extra: `${p.comuni.size} comuni`, url: p.url, stat: p.stat })), 'Provincia')}
  </section>`;
  return pagina({
    titolo: `Prezzi benzina e diesel oggi in ${r.nome} · Riserva`,
    descrizione: `Prezzi dei carburanti oggi in ${r.nome}: i distributori più economici e i prezzi di ogni provincia e comune, aggiornati due volte al giorno.`,
    url: r.url,
    briciole: [{ nome: 'Italia', url: '/prezzi/' }, { nome: r.nome, url: r.url }],
    h1: `Prezzi benzina e diesel oggi in <em>${esc(r.nome)}</em>`,
    sottotitolo: sottotitoloAggiornato(agg, r.stazioni.length),
    corpo,
  });
}

function paginaItalia(regioni, italia, n, ora, agg) {
  const corpo = `${riepilogo(italia, null, '')}
  <section>
    <h2 class="titolo">Le regioni</h2>
    <p>Prezzo più basso di oggi in ogni regione. Tocca una regione per province e comuni.</p>
${tabella(regioni.map((r) => ({ nome: r.nome, url: r.url, stat: r.stat })), 'Regione')}
  </section>`;
  return pagina({
    titolo: 'Prezzi benzina e diesel oggi in Italia, comune per comune · Riserva',
    descrizione: 'I prezzi di benzina, diesel, GPL e metano di oggi in tutti i comuni italiani: i distributori più economici, aggiornati due volte al giorno dai dati del Ministero.',
    url: '/prezzi/',
    briciole: [{ nome: 'Italia', url: '/prezzi/' }],
    h1: 'Prezzi benzina e diesel oggi in <em>Italia</em>',
    sottotitolo: sottotitoloAggiornato(agg, n),
    corpo,
  });
}

// -----------------------------------------------------------------------------
// 4. Scrittura
// -----------------------------------------------------------------------------
async function scrivi(url, html) {
  const cartella = path.join(USCITA, ...url.split('/').filter(Boolean));
  await mkdir(cartella, { recursive: true });
  await writeFile(path.join(cartella, 'index.html'), html);
}

/** Copia il resto del sito (home, privacy, caratteri, immagini, CNAME...). */
async function copiaSito() {
  const escludi = new Set(['generatore', '_site', '_sorgente', 'node_modules', 'README.md', 'prezzi']);
  for (const voce of await readdir(SITO)) {
    if (escludi.has(voce) || voce.startsWith('.') || voce.startsWith('_')) continue;
    await cp(path.join(SITO, voce), path.join(USCITA, voce), { recursive: true });
  }
}

async function main() {
  const inizio = Date.now();
  const dati = await caricaDati();
  const ora = new Date();
  const agg = dati.aggiornato_at ? new Date(dati.aggiornato_at) : ora;
  const stazioni = scartaAnomali(preparaStazioni(dati.stazioni));
  const { regioni, comuni } = costruisciAlbero(stazioni);
  log(`📊 ${stazioni.length} distributori con prezzi · ${regioni.length} regioni · ${comuni.length} comuni`);
  if (comuni.length < MIN_COMUNI) {
    throw new Error(`Solo ${comuni.length} comuni (minimo ${MIN_COMUNI}): dati incompleti, pubblicazione annullata. Il sito resta com'era.`);
  }
  collegaVicini(comuni);
  const italia = statistiche(regioni.flatMap((r) => r.stazioni));

  await rm(USCITA, { recursive: true, force: true });
  await mkdir(path.join(USCITA, 'prezzi'), { recursive: true });
  await copiaSito();
  await cp(path.join(QUI, 'stile.css'), path.join(USCITA, 'prezzi', 'stile.css'));

  const indirizzi = ['/', '/prezzi/'];
  await scrivi('/prezzi/', paginaItalia(regioni, italia, stazioni.length, ora, agg));
  for (const r of regioni) {
    await scrivi(r.url, paginaRegione(r, italia, ora, agg));
    indirizzi.push(r.url);
    for (const p of r.province.values()) {
      await scrivi(p.url, paginaProvincia(p, ora, agg));
      indirizzi.push(p.url);
    }
  }
  for (const c of comuni) {
    await scrivi(c.url, paginaComune(c, ora, agg));
    indirizzi.push(c.url);
  }
  indirizzi.push('/privacy.html');

  // Sitemap per Google (massimo 50.000 indirizzi per file: ne bastano meno di 10.000)
  const giorno = dataIso(ora);
  await writeFile(path.join(USCITA, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${indirizzi.map((u) => `  <url><loc>${DOMINIO}${u}</loc><lastmod>${giorno}</lastmod></url>`).join('\n')}
</urlset>
`);
  if (!existsSync(path.join(USCITA, 'robots.txt'))) {
    await writeFile(path.join(USCITA, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${DOMINIO}/sitemap.xml\n`);
  }
  log(`✅ ${indirizzi.length} pagine in ${((Date.now() - inizio) / 1000).toFixed(1)} s → ${USCITA}`);
}

main().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});
