# Syntesis-ICP — Stato sistema

> Snapshot corrente. Aggiornare dopo ogni fase chiusa.

## Versione live (2026-05-08)

| Componente | Versione |
|---|---|
| Backend (registry) | 8.2.1 |
| /analizzare | v8.2.1 |
| / (Hub) | v8.0.0-refactor |

> Voce `/replacer v7.3.9.107` rimossa il 2026-05-06: era stale, riferimento a un frontend obsoleto / mai integrato (la route `/replacer` non esiste in `main.py` e il file `syntesis-icp-replacer.html` non e' mai esistito in `backend/static/`).

> Cleanup 2026-05-08 (8.2.1): rimosso `backend/static/syntesis-statistiche-v7.4.0.001.html` (146KB, 1089 righe). Era dead code: zero referenze nel repo (CI, scripts, Dockerfile, href HTML, .py); sostituito da `v7.4.0.002` servito su `/statistiche`.

## 8.2.1 — UI alignment Vedere (2026-05-08)

Allineamento header `/vedere` al pattern canonico `.app-header` (Hub/Calibrator). Singolo cambio CSS sulla classe genitore `.header` di `syntesis-icp-vedere.html`:

- `border-bottom: 1px solid var(--border)` → `3px solid var(--blue)` (separazione identitaria forte)
- `padding: 10px 16px` → `14px 20px` (respiro verticale, in linea con Hub)
- `gap: 6px` → `12px` (logo / titolo / toolbar / bottoni distanziati)

Toolbar interna (logo, "Vedere", home/File/Workflow, Aggiungi file/Svuota scena) intatta: il delta tocca solo le proprietà del genitore. Verificato live su entrambi i servizi Railway (BACKEND + LEGACY): HTTP 200, `backend_version: 8.2.1`, `ANALIZZA_BUILD = '8.2.1'`.

Punto #2 del piano UI (allineamento font/header tra moduli) chiuso. Statistiche v002 era già su Source Sans 3, niente da migrare lato font. Resta sospeso il dominio custom `app.syntesis-icp.com` (#2 sospesi).

## Fase A — Chiusa (2026-05-06)

Refactor "centralizzazione costanti del dominio via `backend/registry.py` + bootstrap `window.SYN` nei frontend". Single source of truth per scanbody (1T3, OS, SR), soglie cliniche (d3 in um, angular in deg, MUA cone, fresabilita'), palette colori (classi cliniche, brand).

Step chiusi:
- **A.1, A.2** (2026-05-02): introduzione `backend/registry.py` + endpoint `/api/registry/constants`
- **A.3** (2026-05-02): `icp_engine.py` legge `max_tris` dal registry
- **A.4** (2026-05-02): `pdf_gen.py` legge palette brand dal registry
- **A.4.1** (2026-05-02): `BACKEND_VERSION` esplicito nel registry
- **A.5.0** (2026-05-02): aggiunte soglie angolari (`angular_deg`, `angular_classes_it`)
- **A.5.1** (2026-05-03): bootstrap `window.SYN` nel frontend `v3b.html` (`SCANBODY_CFG`, `MUA_*`, `MIS_CLIN`, `MIS_CLIN_AX`)
- **A.5.2** (2026-05-06): `SOSTITUIRE_TEMPLATE_INFO` + `TPL_ORDER` allineati a `window.SYN`; SR a `0x0052A3` ovunque
- **A.5.x post-batch** (2026-05-06): chiusura debito su `icp_engine.CLIN_LEVELS`/`CLIN_AXIS` (audit C15) — derivati da `registry.THRESHOLDS`+`PALETTE`, vocabolario `angular_classes_it` allineato a `d3_classes_it` (`"Fuori posizione"`).

`A.6` originariamente pianificata (estensione pattern a `index.html` Hub e `syntesis-icp-replacer.html`) verificata e cancellata: `index.html` e' un Hub navigazionale puro senza costanti dominio, e `syntesis-icp-replacer.html` non esiste. L'unico file che effettivamente conteneva costanti CAD/cliniche era `syntesis-analyzer-v3b.html`, gia' migrato in A.5.x.

Promozione `8.1.13-A.5.2 → 8.2.0`: suffisso `-A.x.y` sparisce, MINOR bump come da schema versioning.

## Sospesi

**Alta priorità**
1. Fase 0 stabilizzazione: split v3b.html, scripts/, pytest base
2. app.syntesis-icp.com HTTP 503 intermittente + cert SSL mismatch (workaround: dominio Railway diretto)
3. Audit 2026-05-06 finding open: C1 (JWT in query), C4 (Google access-token client) — diventano critici al lancio Fase 1 SaaS (sharing folder cross-utente, free-tier registration)

**Media**
4. Merge Albero Scena + Scene Registry in /analizzare (lista lineare con RMSD/gruppo/opacità)
5. Test pytest sul motore ICP (set base: 16 MUA reali validati clinicamente in v8.1.0)
6. Cleanup `syntesis-analyzer-lab.html`: probabile copia pre-A.5 con costanti hardcoded duplicate. Da migrare o rigenerare da v3b post-A.5

**Bassa**
7. Spegnimento servizio Railway legacy (7ac922ce)
8. Sentry / monitoring errori frontend
9. Pubblicazione paper JIPD con dati Syntesis-ICP
10. Audit 2026-05-06 cluster MEDI/BASSI: ~25 finding di code health, performance icp_engine, listener/dispose leak in v3b.html

## Roadmap prodotto

- **Fase 0 stabilizzazione** (corso): split v3b.html, infra scripts/, test base
- **Fase 1 SaaS** (Q3 2026): multi-tenant Clerk, pagamenti (TBD), email Resend, dashboard cliente
- **Fase 2 lancio** (Q4 2026): rete LifeDental, paper JIPD, espansione laboratori e studi

## Documentazione storica

- [docs/STORIA.md](docs/STORIA.md) — cronologia commit per commit
- [docs/AUDIT_2026-05-06.md](docs/AUDIT_2026-05-06.md) — audit codebase pre-promozione

---
*Snapshot 2026-05-06. Aggiornare al prossimo cambio di stato.*
