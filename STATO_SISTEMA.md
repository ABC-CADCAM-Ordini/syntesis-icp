# Syntesis-ICP — Stato sistema

> Snapshot corrente. Aggiornare dopo ogni fase chiusa.

## Versione live (2026-05-06)

| Componente | Versione |
|---|---|
| Backend (registry) | 8.1.10-A.5.2 |
| /analizzare | v8.1.10-A.5.2 (fix typo bbox OS in registry: 5.56 -> 3.56) |
| /replacer | v7.3.9.107 |
| / (Hub) | v8.0.0-refactor |

## Refactor Fase A — In corso

Schema: MAJOR.MINOR.BUILD-FASE.STEP. Promozione Fase A → 8.2.0.

**Chiusi**: A.1, A.2, A.3, A.4, A.4.1, A.5.0, A.5.1, A.5.2.

**Note feature 2026-05-06 (8.1.8-A.5.1)**: aggiunta nuova pagina interpretativa "Lettura dei valori" (pag. 3) nel report clinico jsPDF, tra Note metodologiche e Glossario. Schema in sezione dell'accoppiamento cono MUA-fresato (PNG pre-rasterizzato in `backend/static/assets/`). Niente cairosvg/cache: l'asset e' statico, committato nel repo.

**A.6 (next)**: estendere il pattern A.5 a index.html (Hub) e syntesis-icp-replacer.html.

## Sospesi

**Alta priorità**
1. Fase 0 stabilizzazione: split v3b.html, scripts/, pytest base
2. A.6 (chiusura Fase A)
3. app.syntesis-icp.com HTTP 503 intermittente (workaround: dominio Railway diretto)

**Media**
4. Merge Albero Scena + Scene Registry in /analizzare (lista lineare con RMSD/gruppo/opacità)
5. Test pytest sul motore ICP (set base: 16 MUA reali validati clinicamente in v8.1.0)

**Bassa**
6. Spegnimento servizio Railway legacy (7ac922ce)
7. Sentry / monitoring errori frontend
8. Pubblicazione paper JIPD con dati Syntesis-ICP

## Roadmap prodotto

- **Fase 0 stabilizzazione** (corso): split v3b.html, infra scripts/, test base
- **Fase 1 SaaS** (Q3 2026): multi-tenant Clerk, pagamenti (TBD), email Resend, dashboard cliente
- **Fase 2 lancio** (Q4 2026): rete LifeDental, paper JIPD, espansione laboratori e studi

---
*Snapshot 2026-05-06. Aggiornare al prossimo cambio di stato.*
