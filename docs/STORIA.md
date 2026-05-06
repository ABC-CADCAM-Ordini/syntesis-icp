# Storia delle modifiche

Cronologia delle feature e fix significativi. Stile: una entry per modifica, in ordine cronologico inverso (piu' recente in alto).

---

## 2026-05-06 — 8.2.0: PROMOTION chiusura Fase A

Fase A formalmente chiusa. Refactor "centralizzazione costanti del dominio via registry + window.SYN" completato. Single source of truth per scanbody (1T3, OS, SR), soglie cliniche, palette colori e parametri ICP: `backend/registry.py`. Tutti i consumer (motore `icp_engine.py`, `pdf_gen.py`, frontend `v3b.html` via `window.SYN`) leggono dal registry con fallback canonico.

Promozione `8.1.13-A.5.2 → 8.2.0`: suffisso `-A.x.y` sparisce per regola schema versioning (Fase intera promossa = MINOR bump). Step chiusi: A.1, A.2, A.3, A.4, A.4.1, A.5.0, A.5.1, A.5.2 + chiusura debito su `icp_engine` (audit C15). A.6 originariamente prevista (estensione a `index.html` Hub e `syntesis-icp-replacer.html`) cancellata: `index.html` e' Hub navigazionale puro, `syntesis-icp-replacer.html` non esiste — la voce `/replacer v7.3.9.107` in STATO_SISTEMA era stale.

Stato Fase A architetturalmente: completa. Resta `syntesis-analyzer-lab.html` (3.87 MB, copia dev pre-A.5) come potenziale debito di pulizia, sospeso medio non bloccante.

---

## 2026-05-06 — 8.1.13-A.5.2: quick win cleanup (audit C3 C12 C15)

Batch di 3 fix dall'audit del codebase 2026-05-06, con allineamento del vocabolario angular ai d3 in registry.

**C12 (MEDIO) — `/api/me/projects/{id}/files` happy path restored.** L'endpoint ritornava `null` (return implicito) quando il progetto aveva un `gdrive_folder_id` configurato. Il blocco corretto (try gdrive.decrypt_token + service + list_folder) era stranded come dead code orfano dentro `_replicate_file_to_members` (avanzo merge, referenziava `creds`/`proj` non in scope). Spostato dentro `me_project_files` dopo l'early return su no-folder. Cancellato il dead code unreachable. Endpoint ora ritorna `{"files":[...], "folder_id":...}` sul happy path. Nessun consumer frontend al momento (verificato via grep), ma sblocca futura UI file-list.

**C3 (MEDIO) — Drive proxy size cap.** `/api/me/gdrive/file/{file_id}/content` materializzava in RAM tutti i bytes del file Drive prima di restituirli. Senza upper bound, un attaccante autenticato che caricava un file da GB nel proprio Drive poteva OOMare il worker uvicorn. Fix in due parti: (1) nuovo helper `gdrive.get_file_metadata(refresh_token, file_id) -> {id, name, mime_type, size}` che chiama l'API Drive solo per i metadata (1 round-trip, niente download); (2) nuovo `MAX_DRIVE_PROXY_BYTES = 100 MB` (env-overridable), check prima del download — raise 413 se eccede. Per Google Docs nativi `size` e' None e si lascia passare (sono testuali, raramente >100MB).

**C15 (MEDIO) — Chiude debito refactor Fase A su CLIN_LEVELS / CLIN_AXIS.** `icp_engine.py` aveva `CLIN_LEVELS` (soglie d3 in um + label + colori) e `CLIN_AXIS` (soglie angolari in deg + label) hardcoded inline, duplicando `registry.THRESHOLDS["d3_um"]`/`"angular_deg"` + `"d3_classes_it"`/`"angular_classes_it"` + `PALETTE["d3_hex"]`. Drift garantito: cambio in registry → frontend riceve nuovi valori via `/api/registry/constants`, ma motore ICP backend continuava sui vecchi.

Refactor: nuovi `_build_clin_levels()` e `_build_clin_axis()` derivano gli array da registry quando l'import e' andato a buon fine, fallback canonico altrimenti. Shape preservata (lista di dict con `max`/`label`/`col`), tutti i consumer di `CLIN_LEVELS[i]["max"]` etc. invariati. Esteso l'import di `registry` per includere `PALETTE` (prima solo `THRESHOLDS["max_tris_oom"]`).

**Allineamento vocabolario** (premessa al refactor C15): `registry.THRESHOLDS["angular_classes_it"][-1]` era `"Fuori"`, mentre `d3_classes_it[-1]` era `"Fuori posizione"`. Asimmetria probabilmente non voluta (commit di A.5.0 quando angular thresholds furono aggiunte). Allineato a `"Fuori posizione"` ovunque. Verificato che nessun frontend cerca le stringhe come literal — quindi cambio safe.

Versionamento: regola 4 (build bump per fix non-refactor durante Fase A aperta), suffisso `-A.5.2` mantenuto. Status Fase A: A.5.x sub-step chiusi, debito Fase A su CLIN_LEVELS/CLIN_AXIS chiuso. Resta A.6 (estensione pattern window.SYN/registry a index.html Hub e syntesis-icp-replacer.html) prima della promozione 8.2.0.

---

## 2026-05-06 — 8.1.12-A.5.2: code health batch (audit C2 C6 C7 C8 C13)

Batch di 5 fix dall'audit del codebase 2026-05-06, raccolti in un singolo commit. Tutti rerated MEDIO/BASSO post-verifica rigorosa, ma chiusi insieme per pulizia.

**C7 (BASSO) — JWT error generic in main.py.** `/auth/gdrive/connect` esponeva `f"Token JWT non valido: {e}"` interpolando il messaggio dell'eccezione pyjwt. Cambio in `"Token non valido."` senza interpolazione. Il broad `except Exception` resta, ma niente leak del motivo specifico (signature mismatch, expired, malformed).

**C13 (BASSO) — CORS allow_methods esteso.** Aggiunti `PATCH`, `DELETE`, `OPTIONS` ai metodi consentiti dal middleware CORS in main.py r.104. Necessari per gli endpoint @app.patch / @app.delete (gia' usati su /api/me/projects, /contacts, /folders) quando un client cross-origin chiama l'API. Oggi frontend e backend sono same-origin in produzione, quindi nessun bug visibile, ma sblocca l'eventuale frontend separato (Fase 1 SaaS) e gli usi cross-origin in dev.

**C6 (MEDIO) — MAX_PLACE_MUA_TRIS cap + run_in_executor.** I due endpoint `/api/place-mua` e `/api/place-mua-lab` (entrambi richiedono auth) ricevono `scan_crop_tris: list` senza upper bound: un client autenticato malicious poteva mandare milioni di triangoli e saturare RAM/CPU del worker. Il workload numpy CPU-bound girava inline nell'event loop senza timeout, bloccando il worker. Fix in due parti: (1) nuovo `MAX_PLACE_MUA_TRIS = 200000` (env-overridable), check 413 se superato; (2) chiamata a `align_template_to_marker(...)` wrapping in `asyncio.wait_for(loop.run_in_executor(None, lambda: ...), timeout=ICP_TIMEOUT_SECONDS)` con catch su `asyncio.TimeoutError -> 504`, stesso pattern di `/api/analyze`.

**C2 (MEDIO) — Drive proxy hardening.** L'endpoint `/api/me/gdrive/file/{file_id}/content` settava `Content-Disposition: inline; filename="{name}"` con `name` arbitrario dal Drive dell'utente. Pre-condizione perche' diventi critico: condivisione folder cross-utente attiva (gia' implementata in `_replicate_file_to_members`). Fix preventivo: (1) sanitizzazione filename (strip `\r\n` + sostituzione `"` con `'`); (2) `Content-Disposition: attachment` forzato per MIME non `image/*` o `video/*` (HTML/SVG/PDF caricati per XSS vengono scaricati invece che eseguiti inline nell'origin); (3) header `X-Content-Type-Options: nosniff` per bloccare lo sniffing MIME del browser.

**C8 (MEDIO) — Cleanup 5x dead def fresClearAllArrows + 5x fresBuildAllArrows in v3b.html.** Le due funzioni avevano 6 ridefinizioni ravvicinate ognuna (~r.5029-5234). Solo l'ultima vince per hoisting JS, le 5 precedenti sono dead code. Hash dei corpi: 4 versioni distinte di Clear, 2 di Build (la maggior parte erano copie identiche). Rimosse 206 righe; resta 1 sola def per nome (verificato con grep: count 1+1). Niente impatto runtime (comportamento gia' dato dalla 6a versione), ma evita confusione futura per chi cerca da dove modificare.

Versionamento: regola 4 (build bump per fix non-refactor durante Fase A aperta), suffisso `-A.5.2` mantenuto.

---

## 2026-05-06 — 8.1.11-A.5.2: fix run_icp ritorna rmsd corretto (audit C9)

Sprint 1 audit. `backend/icp_engine.py:run_icp()` ritornava `prev_rmsd` invece di `rmsd` post-convergenza: quando il loop ICP si interrompe per convergenza all'iter K, `prev_rmsd` contiene il valore dell'iter K-1 (non K). Inoltre se `max_iter=0` (caso degenere), la variabile `rmsd` non era mai definita prima del return — `NameError` runtime.

Cosa cambia:
- Aggiunta inizializzazione `rmsd = float("inf")` accanto a `prev_rmsd` (default per max_iter=0).
- Return cambia da `"rmsd": prev_rmsd` a `"rmsd": rmsd` — la variabile dell'iter corrente, sempre definita post-loop.

Impatto runtime:
- Delta numerico ≤ 1e-9 mm (la condizione di break impone questa precisione). Sotto la precisione visualizzata nei report PDF (4 decimali, ≈ 0.1 um).
- Due call site verificati (r.1521, r.1846): nessuno rompe per il fix. Il consumer a r.1847 usa rmsd come criterio di ordinamento per spin search; l'ordinamento relativo era preservato dal bug, lo resta col fix.
- Edge case `max_iter=0` ora ritorna `inf` invece di lanciare `NameError`; rilevante solo in contesti degeneri.

Versionamento: regola 4 (build bump per fix non-refactor durante Fase A aperta), suffisso `-A.5.2` mantenuto.

---

## 2026-05-06 — 8.1.10-A.5.2: fix typo bbox OS in registry

Fix di un typo di lunga data in `backend/registry.py` r.79: `SCANBODY["OS"]["bbox_xyz_mm"]` era `[3.56, 5.56, 1.10]`, corretto a `[3.56, 3.56, 1.10]`. Lo scanbody OS e' un cilindro: x = y per definizione geometrica della cap CAD. Il valore Y=5.56 era incoerente con CLAUDE.md §6 (tabella scanbody, "OS: 3.56x3.56x1.10") e con la fisica del template. Verificato sul file STL reale.

Origine: emerso durante l'audit del codebase (2026-05-06). Probabile typo introdotto al primo populate del registry in A.2 (commit 85ca7e8, 2026-05-02). Nessun consumer attualmente legge `bbox_xyz_mm` per calcoli quantitativi, quindi l'impatto a runtime e' nullo - ma il valore esposto via `/api/registry/constants` ai frontend era sbagliato e poteva guidare male qualunque codice che facesse sanity check sulla geometria scanbody.

Versionamento: regola 4 (build bump per fix non-refactor durante Fase aperta), suffisso `-A.5.2` mantenuto.

---

## 2026-05-06 — 8.1.9-A.5.2: SOSTITUIRE_TEMPLATE_INFO e TPL_ORDER da window.SYN, SR a #0052A3 ovunque

Chiusura step A.5.2 della Fase A (refactor centralizzazione costanti via `window.SYN`). Stesso pattern di A.5.1: i consumer del frontend leggono da `window.SYN.scanbody` con fallback canonico allineato al registry.

Cosa cambia:
- `SOSTITUIRE_TEMPLATE_INFO` (in `backend/static/syntesis-analyzer-v3b.html`, prima del refactor a r.14881): trasformato da oggetto literal a IIFE che parte dal fallback canonico e sovrascrive `radius`/`color` con i valori di `window.SYN.scanbody.<key>` quando disponibili. `label` e `zDisc` restano locali (UI string + dato clinico, non vivono nel bootstrap window.SYN). Tutti i 9 consumer del frontend (r.15220, 15262, 15459, 15511, 15534, 15539, 16173, 16506, 16627) restano invariati.
- `TPL_ORDER` (prima del refactor a r.16276, scope locale dentro la closure di render albero scena): derivato da `SOSTITUIRE_TEMPLATE_INFO` invece che hardcoded. Single source of truth, conversione `int -> CSS hex string` inline.
- Allineamento SR a `#0052A3` ovunque: nel fallback canonico di `SOSTITUIRE_TEMPLATE_INFO` (era `0x0065B3`), in `TPL_ORDER` (era `#0065B3`), nello swatch del radio "SR" del selettore Sostituire-source (era `#0065B3`), nella CSS custom property `--syn-marker-sr` (era `#0065B3`).

Decisioni:
- `#0065B3` resta la `--blue` UI canonica (definita a inizio CSS) per tutti gli elementi interattivi non-SR (badge, icone SVG, swatch generici, palette MUA, ecc.). Solo i punti SR-specifici sono stati allineati al brand `#0052A3`.
- Nessun consumer di `SOSTITUIRE_TEMPLATE_INFO` legge `info.zDisc` come campo (verificato con `grep "\.zDisc\b"` = 0 match): `zDisc` resta solo come metadata clinico documentale.

Versionamento: regola 2 dello schema (build + step bump nella stessa Fase) `8.1.8-A.5.1` -> `8.1.9-A.5.2`. Fase A resta aperta: prossimo step A.6 (estensione del pattern a `index.html` Hub e `syntesis-icp-replacer.html`).



Aggiunta nuova pagina interpretativa nel report clinico jsPDF (`misICP_renderClinicalPDF` in `backend/static/syntesis-analyzer-v3b.html`), inserita tra "Note metodologiche" (pag. 2) e "Glossario e soglie cliniche" (pag. 3, ora pag. 4).

Cosa fa:
- Spiega la diversa pesatura diagnostica dei quattro componenti di scostamento (X, Y, Z, angolari).
- Sotto-sezione "Piano XY": gli scostamenti laterali ammettono una quota interpretativa per via dello scarico del cono interno alla struttura fresata.
- Sotto-sezione "Asse Z e valori angolari": vincoli geometrici rigidi, nessun gioco di interfaccia, indicatori puri della qualita' produttiva.
- Schema illustrativo: sezione dell'accoppiamento cono MUA-struttura fresata (PNG 1800x1323 pre-rasterizzato dall'SVG sorgente).

Implementazione:
- Nuova funzione `misICP_pdfDrawValuesGuidePage(doc)` (~80 righe, stesso pattern di header/body delle altre pagine doc).
- Asset statici in `backend/static/assets/`:
  - `scarico_cono_mua_v4.svg` (sorgente, 6.3 KB)
  - `scarico_cono_mua_v4.png` (rasterizzato 1800x1323, 154 KB)
- PNG precaricato come `Image()` al boot per evitare race condition al click "Genera report".
- `docPages` da 2 a 3 in `misICP_renderClinicalPDF`. Numerazione pagine cilindri/coppie auto-corretta.
- Fallback grafico (rect grigio + label "[schema in caricamento]") se l'immagine non e' ancora pronta.

Decisioni architetturali:
- PNG pre-rasterizzato e committato. Niente cairosvg + system libs Cairo nel Dockerfile + endpoint backend + cache: lo schema e' statico (non cambia per record), tutto il pipeline lato runtime sarebbe sovradimensionato.
- Versione `8.1.8-A.5.1` (build bump nello stesso step A.5.1) anziche' `8.1.8` plain: Fase A e' ancora aperta (A.5.2 e A.6 da chiudere), il suffisso resta.

Verifica end-to-end attesa:
- Pagina "Lettura dei valori" presente tra pag. 2 e pag. 3.
- Schema renderizzato nitido.
- Numero totale pagine = 19 (era 18) sul caso di test 001422_modificato3 vs 001422_modificato2.
- `/api/registry/constants` risponde con `backend_version: 8.1.8-A.5.1` su entrambi i domini Railway.
