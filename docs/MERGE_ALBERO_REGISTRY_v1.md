# MERGE ALBERO SCENA + SCENE REGISTRY
## Documento di pianificazione - 2026-04-30

---

## 0. Visione

Unificare i due pannelli del viewer Analizza in **un unico pannello "Albero Scena"** posizionato a sinistra. Lo scopo è eliminare la frammentazione (l'utente oggi deve guardare due posti per capire cosa c'è nella scena) e arricchire l'albero con i dati del Registry (RMSD, gruppo, opacità).

Stile finale richiesto da Francesco:
- Posizione: **sinistra** (rimpiazza l'attuale "Albero Scena")
- Stile: **lista lineare semplice con checkbox e gerarchia** (come l'Albero Scena attuale)
- Arricchimento: dati ricchi del Registry (RMSD, gruppo, opacità)

---

## 1. Stato attuale - cosa esiste oggi

### 1.1 Albero Scena (a sinistra)

**Posizione**: `<div id="layersPanel">` a 14px dal bordo top-left dell'area canvas.
**Larghezza**: 240px fissa.
**Stile**: backdrop-filter blur, bordo, padding 6/8px.

**Funzione che lo costruisce**: `rebuildTree()` (riga 3262)
**Container**: `<div id="layerTree" class="tree">`

**Cosa mostra** (in ordine):
1. **Scansione** (checkbox visibilità globale)
2. **Scanbody 1T3 (tutti)** (toggle massivo)
3. **Taglia scansione su MUA (tutti)** (toggle massivo)
4. **Mostra scanbody scansione (tutti)** (toggle massivo)
5. **Mappa sottosquadri (tutti)** (toggle massivo)
6. Per ogni MUA:
   - Header espandibile (chevron, dot colore, badge gruppo, label "MUA #N (RMSD X um)", X di rimozione)
   - Se espanso (`muaExpanded[m.num]`):
     - Scanbody 1T3
     - Analogo AB-AR
     - Connessione IPD
     - Mappa sottosquadri
     - Asse
     - Taglia scansione
     - Scanbody scansione (color)
7. **Asse medio** (se esiste)
8. **Label divergenza** (se asse medio esiste)

**Eventi ai checkbox**:
- `toggleLayer('scan', on)` per la scansione
- `toggleAllScanbodies(on)`, `toggleAllScanbodyCuts(on)`, `toggleAllScanbodyColored(on)`, `toggleAllUndercutMaps(on)` per i toggle massivi
- `toggleMuaLayer(i, layer, on)` per i sub-layer di ogni MUA
- `toggleUndercutMap(i, on)`, `toggleScanbodyCut(i, on)`, `toggleScanbodyColored(i, on)` per layer specifici MUA
- `meanAxisLine.visible = on` per asse medio (diretto, niente wrapper)
- `toggleDivergenceLabels(on)` per label divergenza

**Bottone X di rimozione**: `removeMUA(i)` rimuove l'intero MUA (inclusi mesh, helper, dal Registry)

**Limitazioni attuali**:
- Niente slider opacità
- Niente RMSD numerico mostrato per il MUA non espanso (solo nell'header riassunto)
- Niente raggruppamento per gruppo G0/G1/...
- Niente visualizzazione di mesh aggiuntive (es. coni divergenza, helper)

### 1.2 Scene Registry (a destra-alto)

**Posizione**: `<div id="synLayerPanel" class="syn-layer-panel">` posizionato top-right del canvas.
**Stile**: pannello sopra il viewer con badge "PREVIEW v8".

**Backbone**: `window.SynRegistry` (IIFE riga 1807) — è il "datastore centralizzato".
- Memorizza oggetti con: `id, type, role, name, group, parentId, module, three (riferimenti mesh/helpers/labels), visual (visible/opacity/color/transparent/locked), meta, analysis, measurements`
- API: `add()`, `remove()`, `update()`, `get()`, `getAll()`, `query()`, `byGroup()`, `select()`, `selectAdd()`, `selectRemove()`
- Eventi: `ADD, REMOVE, UPDATE, SELECT, CLEAR, CHANGE`

**Funzione che lo costruisce**: IIFE `SynLayerPanel` (riga 17400) con `render()` chiamato su ogni evento.

**Cosa mostra**:
- Raggruppamento per `group`: FILE/SCANSIONI, MARKER, MISURE, FORME, SEZIONI, HELPER, ANALISI, ALTRO
- Per ogni oggetto:
  - Riga 1: bottone occhio (visibilità) + dot colore + nome + meta (es. "959,409 tri" per scansioni o "#3 g1" per MUA) + bottone cestino
  - Riga 2 (se applicabile): slider opacità 0-100% con valore testuale
- Bottoni globali in fondo: "Opacizza tutto" (al 30%), "Ripristina"

**Quando viene popolato**:
- Riga 2305-2308: scansione caricata → `add({type:'mesh', role:'scan', module:'analizza', ...})`
- Riga 2582: MUA accoppiato → `add({type:'marker', ...})` con `_synId` salvato sul MUA
- Riga 3547: removeMUA → rimuove dal Registry
- Riga 3587: clearAll → svuota Registry

**Punti di forza rispetto all'Albero Scena**:
- Slider opacità per ogni mesh
- Raggruppamento automatico per categoria
- Metadati ricchi (numero triangoli, gruppo MUA, etc.)
- Bottoni globali "Opacizza tutto" / "Ripristina"
- Architettura event-driven (re-render automatico)

**Limitazioni attuali**:
- Marcato "PREVIEW v8" — non è ancora il sistema ufficiale
- Non gestisce i sub-layer dei MUA (asse, scanbody scansione, mappa sottosquadri specifico)
- Non mostra l'asse medio del gruppo
- Non mostra le label divergenza
- Layout duplicato: l'utente vede gli stessi MUA in due posti

---

## 2. Punti di intersezione - dove si toccano

| Cosa | Albero Scena | Scene Registry |
|---|---|---|
| Scansione | toggle visibilità | toggle visibilità + slider opacità |
| MUA accoppiato | header + sub-layer + X | riga + occhio + slider + cestino |
| Asse medio | toggle visibilità | non presente |
| Label divergenza | toggle visibilità | non presente |
| Scanbody (tutti) | toggle massivo | non presente |
| Coni divergenza | non presente | non presente |
| Sezioni | non presente | gruppo predisposto, vuoto oggi |

**Sincronizzazione**: oggi sono **completamente indipendenti**. Se l'utente cambia visibilità di un MUA in un pannello, l'altro non si aggiorna. Questo è un bug latente che la merge risolverà.

---

## 3. Proposta di pannello unificato

### 3.1 Posizione e dimensioni
- **Posizione**: sinistra (sostituisce `<div id="layersPanel">`)
- **Larghezza**: 280px (50px in più dell'attuale per ospitare slider opacità)
- **Altezza**: max-height del canvas (scroll interno se serve)
- **Stile**: stessa estetica dell'Albero Scena attuale (backdrop blur, bordo morbido)
- **Headers di gruppo**: come SCENE REGISTRY ma sobri (no badge "PREVIEW v8")

### 3.2 Struttura finale ad albero

```
ALBERO SCENA
├── 📄 SCANSIONI                           [ Opacizza tutto ] [ Ripristina ]
│  └─ ☑ Scansione intraorale            959.409 tri    [👁] ▬▬▬●▬ 85%
│
├── 🎯 MUA (4)
│  ├─ ☑ ▸ MUA #2 (G1)                    RMSD 159 um   [👁] ▬▬▬●▬ 90%  ✕
│  │      ├─ ☑ Scanbody 1T3
│  │      ├─ ☑ Analogo AB-AR
│  │      ├─ ☑ Connessione IPD
│  │      ├─ ☐ Mappa sottosquadri
│  │      ├─ ☑ Asse
│  │      ├─ ☐ Taglia scansione
│  │      └─ ☐ Scanbody scansione (color)
│  ├─ ☑ ▸ MUA #3 (G1)                    RMSD 152 um   [👁] ▬▬▬●▬ 90%  ✕
│  ├─ ☑ ▸ MUA #4 (G1)                    RMSD 163 um   [👁] ▬▬▬●▬ 90%  ✕
│  └─ ☑ ▸ MUA #5 (G1)                    RMSD 162 um   [👁] ▬▬▬●▬ 90%  ✕
│
├── 📐 ANALISI (asse, divergenze)
│  ├─ ☑ Asse medio
│  ├─ ☑ Label divergenza
│  └─ ☐ Coni divergenza
│
├── ⚡ TOGGLE MASSIVI
│  ├─ ☑ Scanbody 1T3 (tutti)
│  ├─ ☐ Taglia scansione (tutti)
│  ├─ ☐ Scanbody scansione (tutti)
│  └─ ☐ Mappa sottosquadri (tutti)
│
└── (sezioni / forme / misure: solo se presenti)
```

### 3.3 Caratteristiche da assemblare

| Feature | Provenienza | Note |
|---|---|---|
| Lista lineare con checkbox | Albero Scena | Mantengo |
| Gerarchia espandibile (chevron) | Albero Scena | Mantengo |
| Badge gruppo G0/G1 | Albero Scena | Mantengo, evidenzio |
| Bottone X rimozione MUA | Albero Scena | Mantengo |
| Raggruppamento per categoria | Scene Registry | Adotto |
| Slider opacità 0-100% | Scene Registry | Aggiungo a livello mesh |
| Bottoni globali "Opacizza/Ripristina" | Scene Registry | Aggiungo in alto |
| Numero triangoli scansione | Scene Registry | Aggiungo |
| RMSD MUA visibile sempre | Albero Scena | Confermo |
| Sezioni/forme/misure (placeholder) | Scene Registry | Predisposto |

### 3.4 Sincronizzazione con SynRegistry

Il nuovo pannello non sostituisce SynRegistry come datastore. SynRegistry resta il **single source of truth**.

Il pannello unificato:
1. Si **abbona** agli eventi `SynRegistry.on('change')` per re-render automatico
2. **Legge** lo stato da `SynRegistry.getAll()` (o `byGroup()`)
3. **Scrive** modifiche tramite `SynRegistry.update(id, ...)` (visibilità, opacità)

Per le entità che oggi non sono nel Registry (asse medio, label divergenza, coni divergenza), si fanno due cose:
- **Opzione A**: aggiungerle al Registry come `type:'helper'` con `module:'analizza'`. Pulito ma richiede modificare 3-4 punti del codice esistente.
- **Opzione B**: il pannello legge sia dal Registry sia dalle variabili globali (`meanAxisLine`, `divergenceLabelsVisible`, etc.). Più sporco ma meno invasivo.

Raccomandazione: **Opzione B** per il primo deploy, **Opzione A** in iterazione successiva.

---

## 4. Cosa NON va perso

Lista di funzioni che oggi funzionano e devono continuare a funzionare dopo il merge:

| Funzione | Dove era | Dove sarà |
|---|---|---|
| `toggleLayer('scan', on)` | Albero Scena | Mantengo, chiamato dal nuovo pannello |
| `toggleAllScanbodies(on)` | Albero Scena | Mantengo |
| `toggleAllScanbodyCuts(on)` | Albero Scena | Mantengo |
| `toggleAllScanbodyColored(on)` | Albero Scena | Mantengo |
| `toggleAllUndercutMaps(on)` | Albero Scena | Mantengo |
| `toggleMuaLayer(i, layer, on)` | Albero Scena | Mantengo |
| `toggleScanbodyCut(i, on)` | Albero Scena | Mantengo |
| `toggleScanbodyColored(i, on)` | Albero Scena | Mantengo |
| `toggleUndercutMap(i, on)` | Albero Scena | Mantengo |
| `toggleMuaExpand(num)` | Albero Scena | Mantengo |
| `removeMUA(i)` | Albero Scena | Mantengo |
| `meanAxisLine.visible = on` | Albero Scena | Mantengo (o via Registry) |
| `toggleDivergenceLabels(on)` | Albero Scena | Mantengo |
| `applyVisibilityToThree(obj, visible)` | SynLayerPanel | Mantengo |
| `applyOpacityToThree(obj, opacity)` | SynLayerPanel | Mantengo, esporto utilizzabile dal nuovo pannello |
| Eventi SynRegistry add/remove/update | SynRegistry | Mantengo |
| Workflow Sostituire (`sostRebuildTree`) | Albero Scena | Mantengo, fork mantenuto |

---

## 5. Cosa scompare

| Cosa | Motivazione |
|---|---|
| Pannello SCENE REGISTRY a destra | Le funzioni vanno tutte nel pannello unificato a sinistra |
| Badge "PREVIEW v8" | Diventa il sistema ufficiale |
| Duplicazione MUA in due pannelli | Source of truth unico nel pannello a sinistra |

La colonna destra del viewer (oggi occupata dal Registry "PREVIEW v8") **diventa libera**. Si può usare per:
- Spostare lì il pannello "Stato clinico" + "MUA posizionati" + "Analisi angolare" che sono già a destra fuori dal canvas
- Aggiungere nuove sezioni in futuro
- Lasciarla vuota per più spazio visivo

---

## 6. Stima implementazione

| Fase | Tempo |
|---|---|
| Setup HTML del nuovo pannello (replace `layerTree`) | 30 min |
| CSS riarrangiato (slider, bottoni globali, larghezza 280px) | 30 min |
| Funzione `rebuildTreeUnified()` che genera l'albero unificato | 1.5 ore |
| Sincronizzazione SynRegistry events → chiamate `rebuildTreeUnified()` | 30 min |
| Gestione slider opacità (con throttle per non rerender ad ogni px) | 30 min |
| Bottoni "Opacizza tutto" / "Ripristina" (riusare logica SynLayerPanel) | 20 min |
| Gestione asse medio + label divergenza (Opzione B: variabili globali) | 30 min |
| Rimozione `<div id="synLayerPanel">` e CSS associato | 15 min |
| Test su caso reale (DS3 4 MUA con sottosquadri) | 30 min |
| Bug fixing post-deploy | 1-2 ore |

**Totale**: 5-6 ore di lavoro pulito, in **una o due sessioni dedicate**.

---

## 7. Punti aperti da decidere prima del codice

1. **Toggle massivi**: vanno in una sezione separata "Toggle massivi" come nel mockup, oppure resi inline (es. checkbox "tutti" sopra il gruppo MUA)?
2. **Slider opacità**: solo per la scansione (1 slider) o anche per ogni MUA individuale (4 slider)?
3. **Coni divergenza**: vanno aggiunti come voce esplicita o nascosti dietro "Avanzato"?
4. **Sezioni / Misure**: lasciare voci placeholder vuote o nascondere finché non popolate?
5. **Workflow Sostituire**: il pannello unificato deve gestire anche il workflow Sostituire (template MUA), o resta `sostRebuildTree()` separato?

---

## 8. Ordine di implementazione consigliato

1. **Iter 1 (MVP)**: pannello unificato a sx con tutte le voci attuali dell'Albero Scena + slider opacità solo sulla scansione + bottoni "Opacizza/Ripristina". Sezioni/misure nascoste se vuote.
2. **Iter 2**: slider opacità per ogni MUA + raggruppamento per gruppo MUA (G0/G1).
3. **Iter 3**: opzione A — migrazione di `meanAxisLine`, `divergenceLabels` nel Registry come helper.
4. **Iter 4**: rimozione `<div id="synLayerPanel">` e cleanup definitivo CSS.

---

## 9. Rischio principale

Il rischio è di rompere la sincronia con SynRegistry. Oggi il Registry funziona già parzialmente — alcuni elementi sono dentro (scansione, MUA marker), altri no (helper geometrici, asse medio). Se il nuovo pannello legge solo dal Registry e dimentica i fallback alle variabili globali, alcuni layer non si vedranno più.

Mitigazione: dual-source (Registry + globali) per il primo deploy, una iter di pulizia successiva.

---

## 10. Definizione di "fatto"

L'iterazione 1 è completa quando:
- L'utente apre Analizza, vede solo il pannello a sinistra (nessun riquadro a destra)
- Tutte le voci che oggi vede nell'Albero Scena ci sono (Scansione, Scanbody, MUA con sub-layer, Asse medio, Label divergenza)
- C'è almeno uno slider opacità funzionante (sulla scansione)
- I bottoni globali "Opacizza tutto" / "Ripristina" funzionano sui MUA e sulla scansione
- Tutte le funzioni esistenti continuano a funzionare (toggle, expand, remove)
- Nessun errore in console
- Il Registry è ancora popolato correttamente (verificabile con `window.SynRegistry.getAll()` da console)

---

*Documento di pianificazione - Synthesis-ICP Analizza - 2026-04-30*
