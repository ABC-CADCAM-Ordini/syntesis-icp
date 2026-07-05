/* syn-vmbar.js — barra viewMode #vmBar (Fase 5, 8.86.0). Blocco IIFE rilocato
 * VERBATIM dalla posizione originale (dopo il markup #vmBar: l'ordine DOM e' vincolante,
 * detachToBody sposta la barra sotto <body>). Espone window.setViewMode/updateViewModeBar.
 * GATE: scripts/gate/env/gate.mjs (byte-verbatim vs HEAD + probe browser). */
(function(){
  var STORE_KEY = 'syntesis_viewMode';
  var VALID = ['solid', 'wireframe', 'both'];

  // Sposta la barra come figlia diretta di <body> per sganciarla da
  // qualsiasi ancestor con 'transform' (che altrimenti farebbe pensare
  // a position:fixed relativo a quel container invece che al viewport,
  // portando la barra "fuori dalla finestra").
  function detachToBody(){
    var bar = document.getElementById('vmBar');
    if(bar && bar.parentNode !== document.body){
      document.body.appendChild(bar);
    }
  }

  window.setViewMode = function(mode){
    if(VALID.indexOf(mode) < 0) return;
    try { localStorage.setItem(STORE_KEY, mode); } catch(e){}
    updateViewModeBar(mode);
    if(typeof window.onSyntesisViewModeChange === 'function'){
      try { window.onSyntesisViewModeChange(mode); } catch(e){ console.warn('[vm-bar]', e); }
    }
  };

  window.updateViewModeBar = function(mode){
    ['solid','wireframe','both'].forEach(function(m){
      var el = document.getElementById('vm' + m.charAt(0).toUpperCase() + m.slice(1));
      if(!el) return;
      var active = (m === mode);
      el.classList.toggle('active', active);
      el.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  };

  function boot(){
    detachToBody();
    try {
      var saved = localStorage.getItem(STORE_KEY);
      if(saved && VALID.indexOf(saved) >= 0){
        updateViewModeBar(saved);
        if(typeof window.onSyntesisViewModeChange === 'function'){
          setTimeout(function(){ window.onSyntesisViewModeChange(saved); }, 100);
        }
      }
    } catch(e){}
  }
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
