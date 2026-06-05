/*
 * syn-panel.js — Panel/UI infra di /analizzare: pannelli drag/resize, persistenza
 * view-state + rail colonna destra, view-menu, tooltip (data-tip), helper carica-file.
 * Estratto dal monolite syntesis-analyzer-v3b.html (ex blocco <script> inline a fine
 * body) — campagna di modularizzazione del monolite v3b, modulo #2 (dopo syn-clip.js).
 *
 * RELOCAZIONE VERBATIM: il corpo qui sotto è IDENTICO byte-per-byte al blocco inline
 * originale (classic script, NON-strict). Caricato IN-PLACE alla stessa posizione del
 * documento (fine body, <script src> al posto dell'inline) -> timing identico:
 * readyState, hook DOMContentLoaded + setTimeout, ordine rispetto allo script monolite.
 * Le funzioni globali (toggleViewPanel/hidePanel/showPanel/toggleViewMenu/...) restano
 * GLOBALI per gli handler inline del markup; window.synMakePanelDraggable e
 * window.onSyntesisViewModeChange restano invariati. Dipendenze esterne tutte guardate
 * (onEnvRenderModeChange/updateRenderModeUI via typeof). NESSUN link a moduli live
 * (clip/render/gate). localStorage: chiavi proprie syntesis_panel_* / syntesis_analizza_view
 * / syntesis_analizza_rail (non condivise con altri pezzi del monolite).
 *
 * Gate di equivalenza: scripts/gate/panel (browser DOM A/B, golden inline ≡ modulo).
 */
window.onSyntesisViewModeChange = function(mode){
  if(typeof onEnvRenderModeChange === 'function'){
    onEnvRenderModeChange(mode);
    if(typeof updateRenderModeUI === 'function') updateRenderModeUI();
  }
};

// ── DRAGGABLE + RESIZABLE PANELS (v7.3.9.082) ─────────────────────
// Rende un pannello assoluto trascinabile (handle = elemento con classe
// .syn-drag-handle dentro il pannello) e ridimensionabile (handle in basso
// a destra, classe .syn-resize-handle). Stato salvato in localStorage.
(function(){
  function getZoom(){
    try { return parseFloat(document.body.style.zoom) || 1; } catch(e){ return 1; }
  }
  function saveState(panelId, state){
    try { localStorage.setItem('syntesis_panel_'+panelId, JSON.stringify(state)); } catch(e){}
  }
  function loadState(panelId){
    try {
      var s = localStorage.getItem('syntesis_panel_'+panelId);
      return s ? JSON.parse(s) : null;
    } catch(e){ return null; }
  }
  function applyState(panel, st){
    if(!st) return;
    // v7.3.9.094 - Anti-out-of-bounds clamp. Lo stato salvato in localStorage
    // puo' diventare invalido in vari casi: utente ha trascinato il pannello
    // verso il bordo, poi rimpicciolito la finestra; cambio di layout fra
    // sessioni; bug di un build precedente che ha salvato coordinate sbagliate.
    // Se le coordinate salvate porterebbero il pannello fuori dal parent
    // positioned (la viewport, tipicamente) ignoriamo lo stato e ripuliamo
    // localStorage cosi' alla prossima visita il pannello torna alla posizione
    // di default definita in CSS.
    try {
      var parent = panel.parentElement;
      if(parent){
        var pRect = parent.getBoundingClientRect();
        var pw = pRect.width, ph = pRect.height;
        // Stima dimensioni: priorita' stato salvato, fallback offsetW/H attuale
        var w = (typeof st.width  === 'number') ? st.width  : (panel.offsetWidth  || 200);
        var h = (typeof st.height === 'number') ? st.height : (panel.offsetHeight || 100);
        var l = (typeof st.left === 'number') ? st.left : null;
        var t = (typeof st.top  === 'number') ? st.top  : null;
        // Tolleranza 10px per evitare che un mezzo-pixel di rounding scarti
        // posizioni legittime al bordo.
        var invalid = false;
        if(l !== null && (l < -10 || l + w > pw + 10)) invalid = true;
        if(t !== null && (t < -10 || t + h > ph + 10)) invalid = true;
        if(invalid){
          try {
            // panel.id potrebbe non essere settato qui; ricaviamo il panelId
            // dal data-attr che setupKnownPanels imposta, oppure fallback su id.
            var pid = panel.id || '';
            if(pid) localStorage.removeItem('syntesis_panel_' + pid);
          } catch(_){}
          return; // niente apply: ricade sui default CSS (bottom:14px;left:14px ecc.)
        }
      }
    } catch(_){ /* se la check fallisce per qualche motivo, applica comunque */ }
    if(typeof st.left === 'number'){ panel.style.left = st.left + 'px'; panel.style.right = 'auto'; }
    if(typeof st.top === 'number'){ panel.style.top = st.top + 'px'; panel.style.bottom = 'auto'; }
    if(typeof st.width === 'number') panel.style.width = st.width + 'px';
    if(typeof st.height === 'number') panel.style.height = st.height + 'px';
  }
  function makeDraggable(panel, handle, panelId, opts){
    opts = opts || {};
    if(!panel || !handle) return;
    handle.classList.add('syn-drag-handle');
    handle.title = 'Trascina per spostare';
    var dragging = false, startX=0, startY=0, startL=0, startT=0;
    handle.addEventListener('mousedown', function(ev){
      // Ignora click su tasti dentro l'handle (tipo bottoni reset/close)
      if(ev.target !== handle && ev.target.closest && ev.target.closest('button,input,select,a')) return;
      dragging = true;
      var z = getZoom();
      startX = ev.clientX / z;
      startY = ev.clientY / z;
      var rect = panel.getBoundingClientRect();
      var pRect = panel.parentElement.getBoundingClientRect();
      startL = (rect.left - pRect.left) / z;
      startT = (rect.top - pRect.top) / z;
      ev.preventDefault();
    });
    document.addEventListener('mousemove', function(ev){
      if(!dragging) return;
      var z = getZoom();
      var dx = (ev.clientX / z) - startX;
      var dy = (ev.clientY / z) - startY;
      var newL = Math.max(0, startL + dx);
      var newT = Math.max(0, startT + dy);
      panel.style.left = newL + 'px';
      panel.style.right = 'auto';
      panel.style.top = newT + 'px';
      panel.style.bottom = 'auto';
    });
    document.addEventListener('mouseup', function(){
      if(!dragging) return;
      dragging = false;
      var st = loadState(panelId) || {};
      st.left = parseFloat(panel.style.left) || 0;
      st.top = parseFloat(panel.style.top) || 0;
      saveState(panelId, st);
    });
  }
  function makeResizable(panel, panelId, opts){
    opts = opts || {};
    if(!panel) return;
    if(panel.querySelector('.syn-resize-handle')) return; // gia' aggiunto
    var rh = document.createElement('div');
    rh.className = 'syn-resize-handle';
    rh.title = 'Trascina per ridimensionare';
    panel.style.position = panel.style.position || 'absolute';
    panel.appendChild(rh);
    var resizing = false, startX=0, startY=0, startW=0, startH=0;
    rh.addEventListener('mousedown', function(ev){
      resizing = true;
      var z = getZoom();
      startX = ev.clientX / z;
      startY = ev.clientY / z;
      var rect = panel.getBoundingClientRect();
      startW = rect.width / z;
      startH = rect.height / z;
      ev.preventDefault();
      ev.stopPropagation();
    });
    document.addEventListener('mousemove', function(ev){
      if(!resizing) return;
      var z = getZoom();
      var dx = (ev.clientX / z) - startX;
      var dy = (ev.clientY / z) - startY;
      var minW = opts.minWidth || 180;
      var minH = opts.minHeight || 120;
      var newW = Math.max(minW, startW + dx);
      var newH = Math.max(minH, startH + dy);
      panel.style.width = newW + 'px';
      panel.style.height = newH + 'px';
      panel.style.maxHeight = 'none';
    });
    document.addEventListener('mouseup', function(){
      if(!resizing) return;
      resizing = false;
      var st = loadState(panelId) || {};
      st.width = parseFloat(panel.style.width) || 0;
      st.height = parseFloat(panel.style.height) || 0;
      saveState(panelId, st);
    });
  }
  // API pubblica
  window.synMakePanelDraggable = function(panel, handle, panelId, opts){
    if(typeof panel === 'string') panel = document.getElementById(panel);
    if(typeof handle === 'string') handle = document.getElementById(handle);
    if(!panel) return;
    handle = handle || panel;
    makeDraggable(panel, handle, panelId, opts);
    makeResizable(panel, panelId, opts);
    // Ripristina stato salvato
    applyState(panel, loadState(panelId));
  };

  // Setup automatico per i 4 pannelli noti, con observer per quelli che
  // appaiono dopo (display:none -> display:block dopo workflow change)
  function setupKnownPanels(){
    // Analizza Albero Scena
    var lp = document.getElementById('layersPanel');
    if(lp && !lp.dataset.synDraggable){
      lp.dataset.synDraggable = '1';
      // Crea handle invisibile sul top dei prime 28px del pannello
      var handle = lp.querySelector('.tree-head, .layers-head') || (function(){
        var h = document.createElement('div');
        h.style.cssText = 'position:absolute;top:0;left:0;right:30px;height:24px;cursor:move;z-index:1';
        h.title = 'Trascina per spostare';
        lp.style.position = lp.style.position || 'absolute';
        lp.insertBefore(h, lp.firstChild);
        return h;
      })();
      window.synMakePanelDraggable(lp, handle, 'layersPanel', {minWidth: 180, minHeight: 100});
    }

    // Analizza Sezione (cutViewOverlay)
    var co = document.getElementById('cutViewOverlay');
    if(co && !co.dataset.synDraggable){
      co.dataset.synDraggable = '1';
      // Header naturale: il primo div con "Sezione" testo
      var header = co.querySelector('div');
      window.synMakePanelDraggable(co, header, 'cutViewOverlay', {minWidth: 220, minHeight: 200});
    }

    // Misurare Albero Scena
    var mt = document.getElementById('misTree');
    if(mt && !mt.dataset.synDraggable){
      mt.dataset.synDraggable = '1';
      var mh = mt.querySelector('.mis-tree-head') || mt;
      window.synMakePanelDraggable(mt, mh, 'misTree', {minWidth: 180, minHeight: 100});
    }

    // Misurare Sezione
    var mc = document.getElementById('misCutPanel');
    if(mc && !mc.dataset.synDraggable){
      mc.dataset.synDraggable = '1';
      var mch = mc.querySelector('.mis-cut-head, .mis-cut-title') || mc;
      window.synMakePanelDraggable(mc, mch, 'misCutPanel', {minWidth: 200, minHeight: 200});
    }
  }

  // Run setup al DOMContentLoaded e di nuovo dopo qualche secondo
  // (per coprire pannelli che vengono creati dinamicamente)
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', setupKnownPanels);
  } else {
    setupKnownPanels();
  }
  setTimeout(setupKnownPanels, 1000);
  setTimeout(setupKnownPanels, 3000);
})();



// ── KEYBOARD SHORTCUTS v7.3.9.082 ─────────────────────────────────
// Spazio chiama Raffina (alignAll) quando ha senso (Analizza con MUA).
// P chiama startPlacement (Posiziona).
// Skip se l'utente sta scrivendo in un input/textarea.
(function(){
  function isTypingTarget(el){
    if(!el) return false;
    var tag = (el.tagName || '').toUpperCase();
    if(tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if(el.isContentEditable) return true;
    return false;
  }
  document.addEventListener('keydown', function(ev){
    if(isTypingTarget(ev.target)) return;
    // Modifier keys: lascio passare Ctrl/Meta+altro
    if(ev.ctrlKey || ev.metaKey || ev.altKey) return;
    // Spazio = Raffina
    if(ev.code === 'Space' || ev.key === ' '){
      if(typeof alignAll === 'function'){
        var btn = document.getElementById('btnRaffina');
        // Solo se il pulsante e' visibile e non disabilitato
        if(btn && !btn.disabled && btn.offsetParent !== null){
          ev.preventDefault();
          ev.stopPropagation();
          // Feedback visivo: focus brevemente
          btn.classList.add('keyboard-pulse');
          setTimeout(function(){ btn.classList.remove('keyboard-pulse'); }, 200);
          alignAll();
        }
      }
      return;
    }
    // P = Posiziona (solo in Analizza, solo se non sto gia' posizionando)
    if(ev.key === 'p' || ev.key === 'P'){
      if(typeof startPlacement === 'function' && typeof currentWorkflow !== 'undefined' && currentWorkflow !== 'misurare'){
        ev.preventDefault();
        startPlacement();
      }
    }
  }, false);
})();

// ── PULSANTE CARICA FILE (toolbar) v7.3.9.082 ─────────────────────
// Il pulsante in toolbar inoltra al file picker corretto in base al
// workflow corrente. Quando un caricamento e' "necessario" (no scan
// caricata) il pulsante pulsa con classe .attention.
function syntesisOpenFileDialog(){
  var wf = (typeof currentWorkflow !== 'undefined') ? currentWorkflow : 'analisi';
  var inputId = null;
  if(wf === 'misurare'){
    // In misurare ci sono 2 dropzone: A e B. Apro la prima ancora vuota,
    // o A se entrambe sono vuote/piene
    var hasA = (typeof misICP_geomA !== 'undefined' && misICP_geomA);
    var hasB = (typeof misICP_geomB !== 'undefined' && misICP_geomB);
    inputId = (!hasA) ? 'misInputA' : (!hasB ? 'misInputB' : 'misInputA');
  } else if(wf === 'sostituire'){
    inputId = 'sostInputScan';
  } else {
    inputId = 'inputScan';
  }
  var inp = document.getElementById(inputId);
  if(inp) inp.click();
}

function syntesisRefreshLoadFileButton(){
  // Aggiorna stato visivo del btnLoadFile in base alla scena corrente
  var btn = document.getElementById('btnLoadFile');
  if(!btn) return;
  var wf = (typeof currentWorkflow !== 'undefined') ? currentWorkflow : 'analisi';
  var hasContent = false;
  if(wf === 'misurare'){
    hasContent = (typeof misICP_geomA !== 'undefined' && misICP_geomA) ||
                 (typeof misICP_geomB !== 'undefined' && misICP_geomB);
  } else {
    hasContent = (typeof scanMesh !== 'undefined' && scanMesh) !== null && scanMesh;
  }
  // Sempre visibile, ma con stati: attention (vuoto) / normal (caricato)
  btn.classList.remove('disabled');
  if(!hasContent){
    btn.classList.add('attention');
  } else {
    btn.classList.remove('attention');
  }
}

// Hook di refresh: chiamo dopo loadScan, dopo misICP_onPick, dopo selectWorkflow
if(typeof window !== 'undefined'){
  // Polling soft + DOMContentLoaded
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', syntesisRefreshLoadFileButton);
  } else {
    syntesisRefreshLoadFileButton();
  }
  setInterval(syntesisRefreshLoadFileButton, 1500);
}


// ── TOOLTIP CUSTOM v7.3.9.082 ─────────────────────────────────
// Sposta il `title` dei pulsanti toolbar in `data-tip` per usare i tooltip
// CSS custom istantanei (niente delay 1.5s del browser, niente fondo giallo).
// Si applica solo ai bottoni icon-only e ai pulsanti dentro btn-icon-group e
// btn-load-file. Lascia intatti title degli input, dei link, dei dropdown.
(function(){
  function migrateTitles(){
    var selectors = [
      'button.btn.icon-only[title]',
      '.btn-icon-group > button[title]',
      'button.btn-load-file[title]',
      'button.btn.icon-only.btn-load-file[title]'
    ];
    var elements = document.querySelectorAll(selectors.join(','));
    elements.forEach(function(el){
      if(el.dataset.tipMigrated === '1') return;
      var t = el.getAttribute('title');
      if(t){
        el.setAttribute('data-tip', t);
        el.removeAttribute('title');
        el.dataset.tipMigrated = '1';
      }
    });
  }
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', migrateTitles);
  } else {
    migrateTitles();
  }
  // Re-run dopo qualche secondo per pulsanti aggiunti dinamicamente
  setTimeout(migrateTitles, 800);
  setTimeout(migrateTitles, 2500);
})();


// TOOLTIP CUSTOM v7.3.9.082: sposta title -> data-tip sui bottoni toolbar
(function(){
  function migrateTitles(){
    var selectors = [
      'button.btn.icon-only[title]',
      '.btn-icon-group > button[title]',
      'button.btn-load-file[title]'
    ];
    var elements = document.querySelectorAll(selectors.join(','));
    elements.forEach(function(el){
      if(el.dataset.tipMigrated === '1') return;
      var t = el.getAttribute('title');
      if(t){
        el.setAttribute('data-tip', t);
        el.removeAttribute('title');
        el.dataset.tipMigrated = '1';
      }
    });
  }
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', migrateTitles);
  } else {
    migrateTitles();
  }
  setTimeout(migrateTitles, 800);
  setTimeout(migrateTitles, 2500);
})();


// TOOLTIP CUSTOM v7.3.9.082: sposta title -> data-tip sui bottoni toolbar
(function(){
  function migrateTitles(){
    var selectors = [
      'button.btn.icon-only[title]',
      '.btn-icon-group > button[title]',
      'button.btn-load-file[title]'
    ];
    var elements = document.querySelectorAll(selectors.join(','));
    elements.forEach(function(el){
      if(el.dataset.tipMigrated === '1') return;
      var t = el.getAttribute('title');
      if(t){
        el.setAttribute('data-tip', t);
        el.removeAttribute('title');
        el.dataset.tipMigrated = '1';
      }
    });
  }
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', migrateTitles);
  } else {
    migrateTitles();
  }
  setTimeout(migrateTitles, 800);
  setTimeout(migrateTitles, 2500);
})();


// v7.3.9.082 toggle panel collassabile
// === Pannelli destri Fase 3b: collapse + close + persistenza ===

// Lista degli ID dei pannelli destri gestiti
var COLLAPSIBLE_PANELS = ['panelScanLoad', 'panelClinicalStatus', 'panelMuaList', 'panelAngleList', 'panelAxisInfo'];

function _viewStateKey(){ return 'syntesis_analizza_view'; }

function _loadViewState(){
  try {
    var raw = localStorage.getItem(_viewStateKey());
    if(!raw) return {};
    return JSON.parse(raw) || {};
  } catch(e) { return {}; }
}
function _saveViewState(state){
  try { localStorage.setItem(_viewStateKey(), JSON.stringify(state)); } catch(e) {}
}

function applyViewState(){
  // Migrazione: se lo schema in localStorage e' di una versione precedente
  // (es. non conteneva panelScanLoad), lo aggiorno preservando solo le chiavi note
  var state = _loadViewState();
  var needsSave = false;
  COLLAPSIBLE_PANELS.forEach(function(id){
    if(state[id] === undefined){
      state[id] = { collapsed: true, hidden: false };
      needsSave = true;
    }
  });
  if(needsSave) _saveViewState(state);

  COLLAPSIBLE_PANELS.forEach(function(id){
    var el = document.getElementById(id);
    if(!el) return;
    var s = state[id] || {};
    if(s.hidden) el.classList.add('panel-hidden');
    else el.classList.remove('panel-hidden');
    if(s.collapsed === false) el.classList.remove('collapsed');
    else el.classList.add('collapsed');
  });
  _refreshViewMenu();
}

function toggleCollapsedPanel(id){
  var el = document.getElementById(id);
  if(!el) return;
  el.classList.toggle('collapsed');
  var state = _loadViewState();
  state[id] = state[id] || {};
  state[id].collapsed = el.classList.contains('collapsed');
  _saveViewState(state);
}

function hidePanel(id){
  var el = document.getElementById(id);
  if(!el) return;
  el.classList.add('panel-hidden');
  var state = _loadViewState();
  state[id] = state[id] || {};
  state[id].hidden = true;
  _saveViewState(state);
  _refreshViewMenu();
}

function showPanel(id){
  var el = document.getElementById(id);
  if(!el) return;
  el.classList.remove('panel-hidden');
  var state = _loadViewState();
  state[id] = state[id] || {};
  state[id].hidden = false;
  _saveViewState(state);
  _refreshViewMenu();
}

function toggleViewPanel(id){
  var el = document.getElementById(id);
  if(!el) return;
  if(el.classList.contains('panel-hidden')) showPanel(id);
  else hidePanel(id);
}

function resetViewPanels(){
  COLLAPSIBLE_PANELS.forEach(function(id){ showPanel(id); });
  closeViewMenu();
}

// === Colonna destra: rail mode (collassata) ===
function _railStateKey(){ return 'syntesis_analizza_rail'; }
function _isRail(){
  try { return localStorage.getItem(_railStateKey()) === '1'; } catch(e) { return false; }
}
function _setRail(v){
  try { localStorage.setItem(_railStateKey(), v ? '1' : '0'); } catch(e) {}
}

function applyRightColumnRail(){
  var col = document.getElementById('rightPanel');
  if(!col) return;
  if(_isRail()) col.classList.add('panel-rail-collapsed');
  else col.classList.remove('panel-rail-collapsed');
  _refreshRailTitles();
  _refreshViewMenuRailItem();
}

function toggleRightColumnRail(){
  _setRail(!_isRail());
  applyRightColumnRail();
  closeViewMenu();
}

// Click su una striscia verticale: espande la colonna E apre quel pannello
function _onRailTitleClick(e){
  var title = e.target.closest('.panel-rail-icon');
  if(!title) return;
  e.stopPropagation();
  var target = title.dataset.railTarget;
  // Espando la colonna
  _setRail(false);
  applyRightColumnRail();
  // Apro il pannello target
  if(target){
    var panel = document.getElementById(target);
    if(panel){
      panel.classList.remove('collapsed');
      panel.classList.remove('panel-hidden');
      var state = _loadViewState();
      state[target] = state[target] || {};
      state[target].collapsed = false;
      state[target].hidden = false;
      _saveViewState(state);
    }
  }
}

// Click sulla colonna in rail mode (zona vuota): la espande
function _onRailColClick(e){
  var col = document.getElementById('rightPanel');
  if(!col || !col.classList.contains('panel-rail-collapsed')) return;
  // Se ho cliccato su una striscia, l'altro handler gestisce
  if(e.target.closest('.panel-rail-icon')) return;
  _setRail(false);
  applyRightColumnRail();
}

// Aggiorna voce nel menu Vista
function _refreshViewMenuRailItem(){
  var item = document.getElementById('viewMenuRailToggle');
  if(!item) return;
  var label = item.querySelector('span:last-child');
  if(label) label.textContent = _isRail() ? 'Espandi colonna destra' : 'Collassa colonna destra';
}

// Aggiorna stato (visibile/nascosto, warn/crit) delle strisce verticali
function _refreshRailTitles(){
  COLLAPSIBLE_PANELS.forEach(function(id){
    var panel = document.getElementById(id);
    var title = document.querySelector('.panel-rail-icon[data-rail-target="'+id+'"]');
    if(!panel || !title) return;
    // Se il pannello è hidden via menu Vista, nascondo anche la striscia
    if(panel.classList.contains('panel-hidden')) title.classList.add('hidden-rail');
    else title.classList.remove('hidden-rail');
    // Stato critico/warning: leggo dalla classe 'crit' o 'warn' su panelClinicalStatus
    title.classList.remove('crit', 'warn');
    if(id === 'panelClinicalStatus'){
      var clin = document.getElementById('panelClinicalStatus');
      if(clin){
        if(clin.classList.contains('crit')) title.classList.add('crit');
        else if(clin.classList.contains('warn')) title.classList.add('warn');
      }
    }
  });
}

// Auto-apertura colonna se viene rilevato uno stato clinico critico
// (chiamabile dal codice esistente quando aggiorna la classe 'crit' sul pannello clinico)
function autoOpenColumnOnWarning(){
  var clin = document.getElementById('panelClinicalStatus');
  if(!clin) return;
  var isCrit = clin.classList.contains('crit');
  if(!isCrit) return;
  // Espando solo se l'utente non l'ha aperta gia' lui
  if(_isRail()){
    _setRail(false);
    applyRightColumnRail();
  }
  // Espando il pannello clinico
  clin.classList.remove('collapsed');
  clin.classList.remove('panel-hidden');
  var state = _loadViewState();
  state.panelClinicalStatus = state.panelClinicalStatus || {};
  state.panelClinicalStatus.collapsed = false;
  state.panelClinicalStatus.hidden = false;
  _saveViewState(state);
}

// Osservatore: ogni volta che le classi del pannello clinico cambiano, ricontrolla
function _watchClinicalPanel(){
  var clin = document.getElementById('panelClinicalStatus');
  if(!clin || !window.MutationObserver) return;
  var lastCrit = clin.classList.contains('crit');
  var observer = new MutationObserver(function(){
    var nowCrit = clin.classList.contains('crit');
    _refreshRailTitles();
    // Trigger auto-open solo sulla transizione false → true (critical appena emerso)
    if(!lastCrit && nowCrit){
      autoOpenColumnOnWarning();
    }
    lastCrit = nowCrit;
  });
  observer.observe(clin, { attributes: true, attributeFilter: ['class'] });
}

// Wire up
document.addEventListener('click', function(e){
  // Click su striscia verticale
  if(e.target.closest('.panel-rail-icon')){ _onRailTitleClick(e); return; }
  // Click sulla colonna in rail (zona vuota)
  var col = document.getElementById('rightPanel');
  if(col && col.classList.contains('panel-rail-collapsed') && col.contains(e.target)){
    _onRailColClick(e); return;
  }
});

// Apply rail state all'avvio
function _initRail(){
  applyRightColumnRail();
  _watchClinicalPanel();
}
if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', _initRail);
} else {
  _initRail();
}

function _refreshViewMenu(){
  COLLAPSIBLE_PANELS.forEach(function(id){
    var item = document.querySelector('.view-menu-item[data-vmi-target="'+id+'"]');
    if(!item) return;
    var el = document.getElementById(id);
    if(el && el.classList.contains('panel-hidden')) item.classList.add('hidden-state');
    else item.classList.remove('hidden-state');
  });
  if(typeof _refreshRailTitles === 'function') _refreshRailTitles();
}

function toggleViewMenu(ev){
  if(ev){ ev.stopPropagation(); }
  var m = document.getElementById('viewMenu');
  if(!m) return;
  var open = m.classList.contains('open');
  if(typeof closeFileMenu === 'function') closeFileMenu();
  if(typeof closeWorkflowMenu === 'function') closeWorkflowMenu();
  if(open) m.classList.remove('open');
  else { _refreshViewMenu(); m.classList.add('open'); }
}
function closeViewMenu(){
  var m = document.getElementById('viewMenu');
  if(m) m.classList.remove('open');
}

// Compatibilita' con la vecchia funzione (era chiamata dall'header click esistente)
function toggleAngleListPanel(){ toggleCollapsedPanel('panelAngleList'); }

// Wire up all collapsible panel headers (click sul label) e X buttons
document.addEventListener('click', function(e){
  // Chiusura menu Vista click fuori
  var inViewMenu = e.target.closest('.view-menu-wrapper');
  if(!inViewMenu) closeViewMenu();

  // Click sull'header di un pannello → collapse/expand
  var head = e.target.closest('.panel-collapsible-head');
  if(head && !e.target.closest('.panel-close-btn')){
    var section = head.closest('.panel-collapsible');
    if(section && section.id){ toggleCollapsedPanel(section.id); }
    return;
  }
  // Click su X → nasconde pannello
  var closeBtn = e.target.closest('.panel-close-btn');
  if(closeBtn){
    var pid = closeBtn.dataset.pclose;
    if(pid) hidePanel(pid);
    e.stopPropagation();
    return;
  }
});

// Applica lo stato salvato all'avvio
if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', applyViewState);
} else {
  applyViewState();
}

