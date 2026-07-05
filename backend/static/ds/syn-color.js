/*
 * syn-color.js — classificazione colori PURA di Syntesis-ICP (Fase 4 modularizzazione, 8.85.0).
 *
 * CONTRATTO: zero stato; mappe valore->classe/colore deterministiche + escape HTML.
 *   - _escHtml(s)                 escape &<>"' per innesti in innerHTML
 *   - classifyDivergence(deg)     good/warn/risk/bad (etichette divergenza overlay)
 *   - getGroupArrowColor(gid)     palette frecce di setup per gruppo (+ variante Int)
 *   - undercutColorForAngle(deg)  gradiente continuo tipo jet 0..90°+ per undercut
 *
 * I colori CLINICI (soglie d3/angolari, brand scanbody) NON vivono qui: stanno in
 * backend/registry.py -> window.SYN (CLAUDE.md §7/§9) e sono immutabili senza
 * autorizzazione. ESCLUSA buildUndercutColors (legge muaObjects: stateful, monolite).
 * CARICAMENTO: <script src> classico NON-strict in testa.
 * GATE: scripts/gate/purelib/gate.mjs --from-ds --check
 */

function _escHtml(s){
  return String(s || '').replace(/[&<>"']/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}

function classifyDivergence(angle){
  if(angle <= 15) return 'good';
  if(angle <= 25) return 'warn';
  if(angle <= 45) return 'risk';
  return 'bad';
}

// Helper v7.3.9.082: colore freccia di setup per gruppo
// Distinto da getGroupBadgeColor per coerenza visiva (gid 0 blu primario,
// non grigio come il badge che e' "senza gruppo")
function getGroupArrowColor(gid){
  var colors = ['#0065B3', '#8B5CF6', '#10B981', '#F59E0B', '#EC4899', '#06B6D4'];
  return colors[(gid|0) % colors.length];
}

function getGroupArrowColorInt(gid){
  return parseInt(getGroupArrowColor(gid).replace('#',''), 16);
}

// Dato un angolo (gradi), ritorna il colore RGB [r,g,b] in 0..1
// Gradiente continuo tipo "jet": blu(0°)->ciano(30°)->verde(50°)->giallo(65°)->arancio(80°)->rosso(90°)->rossoscuro(>90°)
function undercutColorForAngle(ang){
  // Punti chiave del gradiente (angolo, [r,g,b])
  var stops = [
    [  0, [0.00, 0.20, 0.80]],  // blu scuro
    [ 30, [0.00, 0.72, 1.00]],  // ciano
    [ 50, [0.27, 1.00, 0.40]],  // verde
    [ 65, [1.00, 1.00, 0.00]],  // giallo
    [ 80, [1.00, 0.42, 0.00]],  // arancio
    [ 90, [0.90, 0.00, 0.00]]   // rosso
  ];
  if(ang <= 0) return stops[0][1];
  if(ang > 90) return [0.50, 0.00, 0.00]; // rosso scuro (sottosquadro)
  // Trova il segmento e interpola linearmente
  for(var i = 0; i < stops.length - 1; i++){
    var a0 = stops[i][0], a1 = stops[i+1][0];
    if(ang >= a0 && ang <= a1){
      var t = (ang - a0) / (a1 - a0);
      var c0 = stops[i][1], c1 = stops[i+1][1];
      return [
        c0[0] + (c1[0]-c0[0])*t,
        c0[1] + (c1[1]-c0[1])*t,
        c0[2] + (c1[2]-c0[2])*t
      ];
    }
  }
  return stops[stops.length-1][1];
}
