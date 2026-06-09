// Gate Passo 1 — centralizzazione decisione motore asse (syntesis_axis_engine).
// Prova ESAUSTIVA che _useLateral e' IDENTICO prima/dopo il refactor su tutte le
// combinazioni (valore letto da localStorage) x (isSR del sito) x (getItem LANCIA),
// per ognuno dei 3 siti, col rispettivo default-d'eccezione PRESERVATO.
// node scripts/gate/axis/truth_table.mjs  -> exit 0 se identico, 1 se diverge.

// --- mock localStorage: ritorna un valore, null, oppure LANCIA (storage bloccato) ---
function makeLS(mode, value){
  return { getItem(_k){
    if(mode === 'throw') throw new Error('SecurityError: storage blocked');
    if(mode === 'null')  return null;
    return value;                 // mode === 'value'
  }};
}

// ===== OLD: logica inline COPIATA VERBATIM dai 3 siti del monolite =====
// Sito 1 — placement findScanbodyCenter (~2728): default-throw 'cap', isSR da radius
function oldSite1(LS, isSR){
  var _axisEngine = 'cap';
  try { _axisEngine = LS.getItem('syntesis_axis_engine') || 'auto'; } catch(e){}
  return (_axisEngine === 'lateralwall') || (_axisEngine === 'auto' && isSR);
}
// Sito 2 — report misICP_cylAxis (~6383): default-throw 'cap', isSR = H>2.4
function oldSite2(LS, H){
  var _axisEngine = 'cap';
  try { _axisEngine = LS.getItem('syntesis_axis_engine') || 'auto'; } catch(e){}
  return (_axisEngine === 'lateralwall') || (_axisEngine === 'auto' && H > 2.4);
}
// Sito 3 — Raffina sostAlignAll (~15983): default-throw 'auto' (il divergente), isSR = key==='SR'
function oldSite3(LS, sourceKey){
  var _ae = 'auto';
  try { _ae = LS.getItem('syntesis_axis_engine') || 'auto'; } catch(e){}
  return (_ae === 'lateralwall') || (_ae === 'auto' && sourceKey === 'SR');
}

// ===== NEW: helper unico + i 3 call-site refattorizzati =====
function synAxisEngineRead(LS, onThrow){
  try { return LS.getItem('syntesis_axis_engine') || 'auto'; }
  catch(e){ return onThrow; }
}
function synAxisUseLateral(LS, isSR, onThrow){
  var e = synAxisEngineRead(LS, onThrow);
  return (e === 'lateralwall') || (e === 'auto' && isSR);
}
function newSite1(LS, isSR){     return synAxisUseLateral(LS, isSR, 'cap'); }
function newSite2(LS, H){        return synAxisUseLateral(LS, H > 2.4, 'cap'); }
function newSite3(LS, sourceKey){return synAxisUseLateral(LS, sourceKey === 'SR', 'auto'); }

// --- spazio degli stati ---
const ENGINE_MODES = [
  {mode:'value', value:'cap'}, {mode:'value', value:'lateralwall'},
  {mode:'value', value:'auto'}, {mode:'value', value:''},
  {mode:'value', value:'garbage'}, {mode:'null'}, {mode:'throw'},
];
const SITE1_ISSR  = [true, false, undefined];          // opts assente -> undefined
const SITE2_H     = [3.0, 2.5, 2.4, 1.9, 1.1];          // SR alto / boundary / bassi
const SITE3_KEYS  = ['SR', '1T3', 'OS', undefined];

let total = 0, fail = 0;
function check(name, oldv, newv, ctx){
  total++;
  if(!Object.is(oldv, newv)){
    fail++;
    console.log(`  ✗ MISMATCH ${name} ${ctx}: old=${String(oldv)} new=${String(newv)}`);
  }
}

for(const em of ENGINE_MODES){
  const LS = makeLS(em.mode, em.value);
  const tag = em.mode === 'value' ? `engine='${em.value}'` : `engine[${em.mode}]`;
  for(const s of SITE1_ISSR) check('site1', oldSite1(LS,s), newSite1(LS,s), `${tag} isSR=${String(s)}`);
  for(const h of SITE2_H)    check('site2', oldSite2(LS,h), newSite2(LS,h), `${tag} H=${h}`);
  for(const k of SITE3_KEYS) check('site3', oldSite3(LS,k), newSite3(LS,k), `${tag} key=${String(k)}`);
}

console.log(`\nTabella di verita' motore asse: ${total} combinazioni, ${fail} mismatch.`);
if(fail === 0){
  console.log('OK — refactor BIT-IDENTICO su tutti i siti (incl. path d\'eccezione divergente preservato).');
  process.exit(0);
} else {
  console.log('FAIL — il refactor cambierebbe comportamento.');
  process.exit(1);
}
