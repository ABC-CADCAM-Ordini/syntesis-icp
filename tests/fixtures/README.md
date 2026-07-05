# Fixtures STL golden-master

Set di STL di riferimento per i **gate di equivalenza** delle fasi che toccano il motore
ICP (Fase 4 libreria math, Fase 6f core Misurare — vedi `docs/MODULARIZZAZIONE_STUDIO.md`).

## Cosa sono

Coppie sintetiche `(A, B)` dove **B = trasformazione rigida NOTA di A** (`B = R·A + t`).
Poiché la trasformazione è nota, il risultato atteso di un allineamento ICP è esatto per
costruzione: la deviazione ideale dopo il recupero di `T` è **0**. Questo permette a un gate
di provare che il codice estratto misura identico all'originale.

Le basi non sono dati inventati né dati paziente: sono i **CAD scanbody reali** (1T3, OS, SR)
già embedded nel monolite (`var SCANBODY_*_B64`), decodificati.

## Come si (ri)generano

```bash
python3 scripts/make_fixtures.py          # genera base/ + pairs/ + MANIFEST.json
python3 scripts/make_fixtures.py --check   # verifica solo che i sorgenti B64 siano parsabili
node    scripts/gate/fixtures/gate.mjs     # gate: STL validi e coerenti col MANIFEST
```

## Cosa è versionato e cosa no

- **Versionato:** `MANIFEST.json` (il ground-truth: per ogni coppia, la trasformazione `T`,
  il conteggio triangoli, e l'MD5 del sorgente B64 → riproducibilità verificabile).
- **NON versionato** (gitignored, rigenerabile): i binari `stl/base/*.stl` e `stl/pairs/*.stl`
  (~3,3 MB). Un checkout pulito li materializza con `make_fixtures.py`.

## Estensioni future (additive, non bloccanti)

- Casi **reali anonimizzati** per tipo scanbody (1T3/OS/SR): si aggiungono in `stl/real/`
  con lo stesso schema di manifest; opzionali, rafforzano il golden-master del core.
- Se il totale supera ~15 MB → valutare Git LFS **prima** di committare binari.
