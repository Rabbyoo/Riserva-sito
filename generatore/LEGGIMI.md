# Generatore delle pagine "Prezzi oggi"

Crea una pagina per ogni comune, provincia e regione con i prezzi del giorno,
più `sitemap.xml` e `robots.txt`. Gira da solo su GitHub Actions
(`.github/workflows/pagine-prezzi.yml`) due volte al giorno.

- `genera.mjs` – il programma (Node 22, nessuna libreria esterna)
- `province.mjs` – sigle delle province, nomi e regioni
- `testi.mjs` – nomi dei comuni scritti per bene, date, marche
- `stile.css` – aspetto delle pagine (stessi colori e caratteri del sito)

Prova in locale senza database: `DATI_FILE=dati.json MIN_COMUNI=1 node generatore/genera.mjs`
(il risultato finisce nella cartella `_site`).
