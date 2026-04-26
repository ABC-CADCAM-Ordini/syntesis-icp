# Syntesis-ICP - Changelog v7.3.9.039 → v7.3.9.041

Sprint di consolidamento. Sintesi delle modifiche concrete deployate fra il 26
aprile 2026 (mattina) e la sera dello stesso giorno.

## v7.3.9.039 - Sprint 1: bug certi backend

7 fix chirurgici al codice backend, ognuno con test runtime di verifica.

**PDF generation**
- `pdf_gen.py` riscritto da zero. Risolto `LS NameError` (variabile usata prima
  di essere definita), typo `fLS["report"]`, import `white` mancante.
  Aggiunto `VERSION = "7.3.9.039"` e `SCORE_MODEL_VERSION = "Syntesis Score v1.0"`.
- `database.py:log_analysis()` ora accetta parametro `result_json: Optional[dict]`
  e lo salva nel campo JSONB. `get_analysis()` fonde il JSON con i campi base
  prima di restituire il record. Il PDF server-side ora ha accesso a
  `pairs`, `cyl_axes`, `detected_profile`, `warnings`.
- `main.py` chiama `log_analysis(..., result_json=result)`.

**ICP engine**
- `parse_stl_with_normals()` usa dtype strutturato 50 byte. La vecchia versione
  leggeva 48 byte consecutivi senza saltare i 2 byte di attribute count,
  disallineandosi triangolo dopo triangolo (bug subdolo: produceva risultati
  "casualmente sbagliati ma plausibili" invece di crash visibile).
- Mesh ICP threshold da `D_aft < D_bef * 1.05` a `D_aft < D_bef`. Il commento
  "accetta solo se migliora" ora corrisponde al codice; prima accettava
  trasformazioni fino al 5% peggiori.
- Dopo accettazione mesh ICP, `raw_ct_b_aligned` viene ricalcolato con la
  nuova trasformazione. Prima si usava la vecchia, producendo incoerenza fra
  triangoli e centroidi nel matching finale.
- Matching hungarian su matrice piena (non più `min(nA, nB)` truncated).
  Cluster B extra non vengono più silenziosamente ignorati: warning loggato.
- `except Exception: pass` sul mesh ICP eliminato. Errori e fallimenti vanno
  in `result["warnings"]` con `stage`, `severity`, `message` strutturati.
- `requirements.txt` aggiunge `scikit-learn==1.5.2` (richiesto da
  `get_cap_clusters` che usa `sklearn.cluster.KMeans`).
- `result` ora include `score_model_version` e `warnings` per ogni analisi.

## v7.3.9.040 - Sprint 2: coerenza

**Score model unificato**
- Soglie PDF allineate al modello canonico backend: era 90/75/55/35,
  ora 85/70/50/33 (uguale a `icp_engine.score_label()`).
- Frontend `misICP_score()` (L5256): commento esplicito che è il
  Syntesis Score v1.0, sincronizzato con backend.
- Frontend `misICP_scoreLabel()`: commento sulle soglie sincronizzate.
- Frontend score temporaneo a L4787 (`100 - penRmsd - penAngle`) marcato
  esplicitamente come "SCORE PRELIMINARE rapido durante ICP, NON canonico".
  Resta in uso per UX live durante l'iterazione, ma è chiarito che viene
  sostituito dal valore canonico a fine pipeline.

**Race condition licenze**
- `database.create_user()` ora fa `UPDATE...RETURNING` atomico della licenza
  PRIMA di creare l'utente. Se la licenza è già usata, ritorna 0 righe e
  alza `ValueError`. Due richieste concorrenti non possono più consumare
  la stessa licenza.
- `auth.py /register` cattura `ValueError` e ritorna HTTP 409.

## v7.3.9.041 - Policy social login

**Decisione strategica**: licenza obbligatoria sempre, anche per Google/Apple/
Facebook login. Niente più bypass.

- `SocialLoginRequest` aggiunge `license_key: Optional[str]`.
- `/auth/social`: utenti già registrati continuano a fare login normalmente
  (la licenza era stata fornita al primo accesso). Utenti nuovi via social
  devono fornire `license_key` valida e non usata, verificata con stesso
  `UPDATE...RETURNING` atomico del flusso `/register`.
- Messaggio errore: "Per la prima registrazione e' richiesta una chiave
  di licenza valida." se license_key vuoto, oppure "Chiave di licenza non
  valida, gia' utilizzata o disattivata." se la transazione UPDATE non
  trova match.

## File toccati totale (v.039 → v.041)

```
backend/pdf_gen.py        riscritto (15.8 -> 19.5 KB)
backend/icp_engine.py     +5 patch chirurgiche (68.5 -> 73.3 KB)
backend/database.py       log_analysis + get_analysis + create_user (6.3 -> 8.0 KB)
backend/main.py           passa result_json (12.9 -> 13.0 KB)
backend/auth.py           licenza social + cattura race (13.5 -> 15.3 KB)
backend/requirements.txt  +scikit-learn==1.5.2
backend/static/syntesis-analyzer-v3b.html  commenti score canonico + bump
Dockerfile                CACHEBUST aggiornato 4 volte
```

## Cosa NON è cambiato

Per scelta esplicita, mantenuti:
- Architettura ICP cliente/server convivente. Il modulo Misurare frontend
  conserva il suo ICP semplice client-side per latenza e privacy. Il
  workflow Analizza usa esclusivamente il backend con weighted ICP.
- Soglie cliniche d3 e parametri MUA cone (`MUA_CONE_HALF_ANGLE=20°`, etc.).
- Modello score (formula iperbole inflection 110 µm steepness 1.5).
  Versionato come "Syntesis Score v1.0" - quando i pesi cambieranno,
  bumpare a v1.1 e i report storici resteranno tracciabili sul modello
  con cui sono stati prodotti.
- Pipeline di deploy GitHub→Railway: 90 secondi end-to-end.

## Cosa testare in produzione

Prima di considerare i fix "validati":
1. Confronto A vs B identici → `result["icp_rmsd"]` deve essere ~1e-6 mm
   (prima poteva essere alcuni µm a causa del disallineamento parse_stl).
2. PDF endpoint `/api/report/{analysis_id}` su un'analisi recente: deve
   produrre un PDF reale, non più HTTP 500.
3. Casi borderline mesh ICP: i warning ora compaiono nel PDF nella sezione
   "Avvertenze" se il mesh ICP non converge o viene scartato.
4. Tentativo di registrazione concorrente con stessa licenza da due
   dispositivi: solo uno deve ricevere 200 OK, l'altro 409 con messaggio
   chiaro.
