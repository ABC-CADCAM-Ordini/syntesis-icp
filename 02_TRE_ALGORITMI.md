# Syntesis-ICP - I tre algoritmi di posizionamento

**Data:** 2026-04-26
**Versione di riferimento:** v7.3.9.042
**Autore:** Francesco Biaggini con Claude

---

## Premessa - perche' questo documento esiste

Durante una review automatica del backup (gennaio 2026) un sistema di analisi
esterno ha letto il codice e ha tratto la conclusione che il software contiene
"due implementazioni ICP duplicate" - una server-side e una client-side - e
che il client-side dovrebbe essere migrato al server per protezione IP e
coerenza algoritmica.

**Quella conclusione era sbagliata.** Non c'e' duplicazione. Ci sono tre
algoritmi distinti, ognuno scelto deliberatamente per il suo workflow.

Questo documento fissa per sempre il razionale architetturale, in modo che
nessun altro reviewer (umano o automatico) tragga la stessa conclusione
sbagliata.

---

## I tre workflow del software

Syntesis-ICP serve tre obiettivi clinici diversi, e ognuno richiede un
algoritmo di natura diversa.

### Workflow 1: Misurare

**Obiettivo clinico:** confrontare due scansioni complete della stessa arcata
(es. riferimento del laboratorio vs scansione del paziente) e produrre un
report metrologico con score di precisione, deviazioni per coppia, divergenze
angolari.

**Algoritmo:** weighted ICP cap+cylinder.

**Dove gira:** server (Python su Railway), funzione `analyze_stl_pair` in
`backend/icp_engine.py`.

**Caratteristiche tecniche:**
- Generalista: lavora su qualsiasi profilo scanbody senza conoscere il CAD
- Iterativo: 35-80 iterazioni con outlier rejection Tukey-like
- Pesato: i triangoli del cap (faccia piatta superiore) hanno peso 5x rispetto
  al body (cilindro laterale). Bilancia cap vs body considerando il rapporto
  d'area 1:5 tipico
- Robusto: scarta automaticamente outlier (rumore di scansione, gengiva)
- Tempo: 3-15 secondi per due STL completi

**Perche' server e non client:** il calcolo e' pesante (max 2500 triangoli per
evitare OOM su Railway), e il file STL completo deve essere accessibile per
analisi globale. Inoltre l'algoritmo weighted ICP e' il "valore proprietario"
del software e tenerlo server-side ha senso anche per protezione IP.

---

### Workflow 2: Analizza

**Obiettivo clinico:** posizionare uno o piu' MUA (Multi-Unit Abutment)
all'interno di una scansione, per pianificare la protesi e verificare
fresabilita', divergenze, paralleli, posizione asse-asse.

**Algoritmo:** fit di cerchio a raggio fisso CAD-aware.

**Dove gira:** browser (JavaScript Three.js), funzione `findScanbodyCenter` in
`backend/static/syntesis-analyzer-v3b.html`.

**Caratteristiche tecniche:**
- Specializzato: usa il raggio nominale CAD del template scanbody come vincolo
  geometrico (1T3=2.515mm, OS=1.78mm, SR=2.03mm)
- Deterministico: nessuna iterazione, soluzione chiusa per minimi quadrati
- Risultato: errore tipico < 15um sotto rumore di scansione (~30um)
- Tempo: pochi millisecondi per click

**Perche' fit specializzato e non weighted ICP:** quando si conosce a priori
il raggio del cilindro, il problema di posizionamento si riduce a un fit con
un solo parametro libero (il centro). Un algoritmo specializzato per questo
caso ha errore intrinsecamente piu' basso di un algoritmo generalista
iterativo, perche' sfrutta un'informazione che il generalista ignora.
**E' matematica, non opinione.** Il weighted ICP e' migliore in casi senza
conoscenza CAD; il fit a raggio fisso e' migliore quando la conoscenza c'e'.

**Perche' client e non server:** il workflow Analizza e' interattivo per
natura - l'utente clicca, vede, sposta, riclicca. Mandare ogni click al server
introdurrebbe latenza percepita di 200-500ms ad ogni interazione. Un
posizionamento di 6 MUA passerebbe da pochi secondi a quasi un minuto.
Inoltre, in Analizza i dati clinici non lasciano mai il browser durante
l'editing - la scansione paziente non viene mai uploadata se non c'e'
necessita'.

**v7.3.9.042 - Dual algorithm opt-in:** dalla versione 7.3.9.042, l'utente
puo' attivare nelle impostazioni l'uso del weighted ICP server-side come
ALTERNATIVA. Default invariato (client). Lo scopo e' raccogliere dati
comparativi su casi reali per decidere in futuro se il weighted ICP e'
sistematicamente migliore o peggiore del fit specializzato. Il toggle e'
nelle impostazioni > tab "Algoritmo", e una diagnostica per-MUA mostra
algoritmo, RMSD, tempo di calcolo.

---

### Workflow 3: Sostituire

**Obiettivo clinico:** dato uno scanbody piazzato in scansione, sostituirlo
con un altro modello (cambio scanbody), mantenendo la posizione corretta del
moncone implantare sottostante.

**Algoritmo:** ICP locale point-to-point con peso cap+body, inizializzato dal
fit di cerchio specializzato.

**Dove gira:** browser, funzione `sostAlignAll` in
`backend/static/syntesis-analyzer-v3b.html`.

**Caratteristiche tecniche:**
- Riusa `findScanbodyCenter(opts.radius)` con il raggio del NUOVO template
  come fase di inizializzazione
- Poi raffina con ICP locale point-to-point su un crop di scansione (entro
  3-5mm dal click), 25-35 iterazioni
- Pesa cap (peso 5x) vs body (peso 1x) come il backend ICP, ma su scala locale
- Tempo: 100-300ms per scanbody

**Perche' ICP locale e non fit specializzato:** in Sostituire NON conosci
a priori la posizione esatta perche' stai cambiando il template. Il fit
specializzato del nuovo raggio e' un punto di partenza, ma serve raffinamento
ICP per gestire l'incertezza nell'allineamento del nuovo template.

**Perche' client e non server:** stesso ragionamento di Analizza - workflow
interattivo, latenza zero richiesta, dati che non lasciano il browser.

---

## Tabella riassuntiva

| Aspetto              | Misurare         | Analizza         | Sostituire        |
|----------------------|------------------|------------------|-------------------|
| Algoritmo            | Weighted ICP     | Fit cerchio CAD  | ICP locale        |
| Tipo                 | Generalista      | Specializzato    | Specializzato+ICP |
| Iterativo            | Si (35-80 iter)  | No               | Si (25-35 iter)   |
| Conosce CAD          | No               | Si               | Si                |
| Esecuzione           | Server (Python)  | Client (JS)      | Client (JS)       |
| Latenza tipica       | 3-15 secondi     | < 5 millisecondi | 100-300 ms        |
| Output               | Score globale +  | Centro + asse    | Centro + asse     |
|                      | deviazioni       | per click        | per scanbody      |
| Errore tipico        | RMSD 50-200um    | < 15um           | 20-80um           |
| Casi d'uso           | Validazione      | Pianificazione   | Cambio template   |
|                      | metrologica      | protesi          |                   |

---

## Versione e cronologia

| Versione   | Data       | Cambiamento                                       |
|------------|------------|---------------------------------------------------|
| < v7.3.9.042 | -        | Tre algoritmi presenti, nessuna documentazione    |
|            |            | esplicita. Il fraintendimento "duplicazione" era  |
|            |            | possibile.                                        |
| v7.3.9.042 | 2026-04-26 | Documentazione esplicita aggiunta:                |
|            |            | - MASTER_DOC.md sezione 3.1                       |
|            |            | - Banner architetturale in findScanbodyCenter     |
|            |            | - Docstring aggiornata in analyze_stl_pair        |
|            |            | - Endpoint /api/place-mua aggiunto come opt-in    |
|            |            | - UI dual algorithm con diagnostica A/B           |
|            |            | - Questo file 02_TRE_ALGORITMI.md                 |

---

## Domande frequenti

**D: Posso eliminare il client-side e tenere solo il server-side per uniformare?**
R: No, sarebbe un degrado UX e clinico. La latenza interattiva esploderebbe.
Inoltre per il caso Analizza il fit specializzato e' matematicamente piu'
accurato del weighted ICP generalista.

**D: Posso eliminare il server-side e tenere solo il client-side?**
R: No, in Misurare il calcolo su due STL completi e' troppo pesante per il
browser e produrrebbe OOM. Inoltre il weighted ICP e' il valore proprietario
del software, mantenerlo server-side ha senso per protezione IP.

**D: Sono davvero tre algoritmi diversi o stessa formula con parametri?**
R: Sono tre algoritmi diversi nella struttura matematica, non solo nei
parametri:
- Misurare: ICP iterativo + Hungarian matching su tutta la scena
- Analizza: minimi quadrati su circle-fitting in piano proiettato
- Sostituire: ICP locale point-to-point con vincolo radiale CAD

**D: Cosa succede se in futuro vorremo unificarli?**
R: Vedi v7.3.9.042 dual algorithm. Stiamo gia' testando l'unificazione
opt-in per Analizza. Se i dati raccolti in 6 mesi mostrano che il server-side
e' equivalente o migliore E la latenza non e' un problema per i workflow
interattivi (forse con WebSocket o caching aggressivo), si potra'
deprecare il fit client-side. Ma e' una decisione data-driven, non
architetturale a priori.

---

## Riferimenti

- `backend/icp_engine.py` -> `analyze_stl_pair` (Misurare)
- `backend/icp_engine.py` -> `align_template_to_marker` (riusato dal nuovo
  endpoint `/api/place-mua` per il dual algorithm)
- `backend/main.py` -> `POST /api/place-mua` (v7.3.9.042)
- `backend/static/syntesis-analyzer-v3b.html` -> `findScanbodyCenter` (Analizza)
- `backend/static/syntesis-analyzer-v3b.html` -> `sostAlignAll` (Sostituire)
- `backend/static/syntesis-analyzer-v3b.html` -> `alignAll` + `alignAllServer`
  (routing dual algorithm)
- `MASTER_DOC.md` sezione 3.1 e 3.2

---

*Questo documento e' parte della documentazione persistente del progetto.
Aggiornarlo ogni volta che cambia uno dei tre algoritmi o l'architettura
dual.*
