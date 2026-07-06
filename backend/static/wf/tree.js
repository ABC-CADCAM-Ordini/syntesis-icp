/*
 * wf/tree.js — workflow ALBERO SCENA (tree) di Synthesis-ICP (Fase 6b modularizzazione, 8.89.0).
 * Secondo file estratto in wf/ (dopo fresabilita.js).
 *
 * CONTRATTO: 10 function declaration del dominio tree-view di Analizza (pannello "Livelli"/Albero
 * Scena, rebuildTree che rigenera il DOM dell'albero, opacità globale scan+mua, ghost/restore,
 * toggle visibilità layer/mua, espansione nodi). Nomi bare globali invariati.
 * Estrazione "functions-only" (pattern 6a): il dominio tree è PURA VISTA — non possiede stato
 * proprio salvo muaExpanded (mappa expand/collapse per-MUA) che resta nel MAIN alla posizione
 * originale, come tutto lo stato foreign che le fn leggono (scanMesh/muaObjects/meanAxisLine/
 * analysisMode/envSettings/scanbodiesVisible/divergenceLabelsVisible). Zero monkey-patch.
 *
 * ESCLUSE dal modulo (scouting): setSceneObjectColor + __synApplyColor (utility di scena/colore
 * CONDIVISE da scan/mua/icp/sost/replace — restano nel monolite, non sono tree) e getGroupBadgeColor
 * (colore puro, gemella di getGroupArrowColor già in ds/syn-color.js — resta, candidata a un passo
 * colorclass dedicato). toggleAllSB è dead-code adiacente non estratto.
 *
 * CARICAMENTO: <script src> classico NON-strict in testa (dopo wf/fresabilita.js), PRIMA del MAIN.
 * Le fn si limitano a essere DEFINITE a parse-time; leggono stato/THREE/scene/DOM solo a CALL-TIME
 * (post-init, tutte invocate da handler inline / shortcut 'L' / rebuild dopo interazione).
 * VINCOLO HARD: rebuildTree è chiamata da ds/syn-clip.js (root.rebuildTree) e ds/syn-env.js e da
 * ~23 siti nel monolite (typeof-guardati) → deve restare bare-global. Idem toggleLayersPanel
 * (shortcut tastiera 'L' + toolbar), i toggle e treeUnified_* (handler inline generati da rebuildTree).
 * GATE: scripts/gate/tree/gate.mjs (md5 verbatim per fn + esposizione + residuo) + harness browser
 * (open/close pannello classList/display, toggle, opacità, ghost/restore, rebuild innerHTML).
 */

function openLayersPanel(){
  var p = document.getElementById('layersPanel');
  if(!p) return;
  p.style.display = 'flex';
  // 8.80.4: il bottone toolbar e' #btnLivelli ('btnLayers' era il vecchio id,
  // mai aggiornato: lo stato .active non veniva mai riflesso)
  var btn = document.getElementById('btnLivelli');
  if(btn) btn.classList.add('active');
  try { localStorage.setItem('syntesis_layers_open', '1'); } catch(e){}
}
function closeLayersPanel(){
  var p = document.getElementById('layersPanel');
  if(!p) return;
  p.style.display = 'none';
  var btn = document.getElementById('btnLivelli');   // 8.80.4: era 'btnLayers' (id inesistente)
  if(btn) btn.classList.remove('active');
  try { localStorage.setItem('syntesis_layers_open', '0'); } catch(e){}
}
function toggleLayersPanel(){
  var p = document.getElementById('layersPanel');
  if(!p) return;
  if(p.style.display === 'flex'){ closeLayersPanel(); }
  else { openLayersPanel(); }
}

function rebuildTree(){
  // In workflow Sostituire l'albero mostra sostMesh + i template posizionati
  if(typeof analysisMode !== 'undefined' && analysisMode === 'sostituire'){
    if(typeof sostRebuildTree === 'function'){
      sostRebuildTree();
      return;
    }
  }
  // === Blocco 7a: pannello unificato (Albero Scena + dati Registry) ===
  // Mantengo TUTTI gli handler esistenti, riorganizzo in sezioni-gruppo.
  var h = '';
  
  // ── Gruppo 1: FILE / SCANSIONI ──
  if(scanMesh){
    var triCount = '';
    try {
      if(scanMesh.geometry && scanMesh.geometry.index){
        triCount = (scanMesh.geometry.index.count / 3);
      } else if(scanMesh.geometry && scanMesh.geometry.attributes && scanMesh.geometry.attributes.position){
        triCount = scanMesh.geometry.attributes.position.count / 3;
      }
      if(triCount) triCount = Math.round(triCount).toLocaleString('it-IT') + ' tri';
    } catch(e){ triCount = ''; }
    h += '<div class="tree-group-header">FILE / SCANSIONI<span class="group-count">1</span></div>';
    var scanOpacity = 85; // default
    try {
      if(scanMesh.material && typeof scanMesh.material.opacity === 'number'){
        scanOpacity = Math.round(scanMesh.material.opacity * 100);
      }
    } catch(e){}
    h += '<div class="tree-node">'+
      '<input type="checkbox" '+(scanMesh.visible?'checked':'')+' onchange="toggleLayer(\'scan\',this.checked)">'+
      '<input type="color" class="tree-color" value="'+((typeof envSettings!=="undefined"&&envSettings.scanColor)?envSettings.scanColor:"#b8a090")+'" title="Colore scansione" onchange="setSceneObjectColor(\'scan\',this.value)" onclick="event.stopPropagation()">'+
      '<span class="lbl">Scansione</span>'+
      (triCount ? '<span class="mua-rmsd">'+triCount+'</span>' : '')+
      '</div>'+
      '<div class="tree-opacity-row">'+
        '<input type="range" class="tree-opacity-slider" min="10" max="100" step="5" value="'+scanOpacity+'" oninput="treeUnified_setScanOpacity(this.value)" onchange="treeUnified_setScanOpacity(this.value)">'+
        '<span class="tree-opacity-value" id="treeUnified_scanOpacityVal">'+scanOpacity+'%</span>'+
      '</div>';
  }
  
  // ── Gruppo 2: MUA ──
  if(muaObjects.length > 0){
    h += '<div class="tree-group-header">MUA<span class="group-count">'+muaObjects.length+'</span></div>';
    muaObjects.forEach(function(m, i){
      var ch = '#'+m.color.toString(16).padStart(6, '0');
      var rmsdText = m.aligned ? '<span class="expert-only">RMSD '+(m.rmsd*1000).toFixed(0)+' &micro;m</span><span class="expert-hide">accoppiato</span>' : 'non accoppiato';
      var expanded = muaExpanded[m.num] === true;
      var chev = expanded ? '&#9662;' : '&#9656;';
      var groupBadge = (m.groupId && m.groupId > 0) 
        ? '<span style="display:inline-block;padding:1px 4px;background:'+getGroupBadgeColor(m.groupId)+';color:#fff;font-family:var(--mono);font-size:10px;font-weight:800;border-radius:3px;margin-right:4px">G'+m.groupId+'</span>'
        : '';
      
      h += '<div class="tree-node mua-header">'+
        '<span class="chevron" onclick="toggleMuaExpand('+m.num+')">'+chev+'</span>'+
        '<input type="color" class="tree-color" value="'+ch+'" title="Colore MUA #'+m.num+'" onchange="setSceneObjectColor(\'mua:'+i+'\',this.value)" onclick="event.stopPropagation()">'+
        groupBadge+
        '<span class="lbl" onclick="toggleMuaExpand('+m.num+')">MUA #'+m.num+'</span>'+
        '<span class="mua-rmsd">'+rmsdText+'</span>'+
        '<button class="del-btn" onclick="removeMUA('+i+')" title="Elimina MUA #'+m.num+'">&#10005;</button>'+
      '</div>';
      
      if(expanded){
        h += '<div class="tree-node sub"><input type="checkbox" '+(m.sbVisible!==false?'checked':'')+' onchange="toggleMuaLayer('+i+',\'sb\',this.checked)"><span class="lbl">Scanbody '+(m.sbType||'1T3')+'</span></div>';
        h += '<div class="tree-node sub"><input type="checkbox" checked onchange="toggleMuaLayer('+i+',\'an\',this.checked)"><span class="lbl">Analogo AB-AR</span></div>';
        h += '<div class="tree-node sub"><input type="checkbox" checked onchange="toggleMuaLayer('+i+',\'mt\',this.checked)"><span class="lbl">Connessione IPD</span></div>';
        h += '<div class="tree-node sub"><input type="checkbox" '+(m.undercutMapActive?'checked':'')+' onchange="toggleUndercutMap('+i+',this.checked)"><span class="lbl">Mappa sottosquadri</span></div>';
        h += '<div class="tree-node sub"><input type="checkbox" '+(m.axisLine.visible?'checked':'')+' onchange="toggleMuaLayer('+i+',\'ax\',this.checked)"><span class="lbl">Asse</span></div>';
        h += '<div class="tree-node sub"><input type="checkbox" '+(m.scanbodyScanVisible?'checked':'')+' onchange="toggleScanbodyCut('+i+',this.checked)"><span class="lbl">Taglia scansione</span></div>';
        h += '<div class="tree-node sub"><input type="checkbox" '+(m.scanbodyColoredVisible?'checked':'')+' onchange="toggleScanbodyColored('+i+',this.checked)"><span class="lbl">Scanbody scansione (color)</span></div>';
      }
    });
  }
  
  // ── Gruppo 3: ANALISI (asse medio + label divergenza) ──
  if(meanAxisLine){
    var analysisCount = 2;
    h += '<div class="tree-group-header">ANALISI<span class="group-count">'+analysisCount+'</span></div>';
    h += '<div class="tree-node">'+
      '<input type="checkbox" '+(meanAxisLine.visible?'checked':'')+' onchange="meanAxisLine.visible=this.checked">'+
      '<span class="dot" style="background:#fff;border:1px solid #aaa"></span>'+
      '<span class="lbl">Asse medio</span>'+
    '</div>';
    h += '<div class="tree-node">'+
      '<input type="checkbox" '+(divergenceLabelsVisible?'checked':'')+' onchange="toggleDivergenceLabels(this.checked)">'+
      '<span class="dot" style="background:linear-gradient(90deg,#0D9E6E,#F59E0B,#F97316,#DC2626)"></span>'+
      '<span class="lbl">Label divergenza</span>'+
    '</div>';
  }
  
  // ── Gruppo 4: TOGGLE MASSIVI (solo se ci sono MUA) ──
  if(muaObjects.length > 0){
    var cutsOn = muaObjects.filter(function(m){ return m.scanbodyScanVisible === true; }).length;
    var allCutsOn = cutsOn === muaObjects.length;
    var coloredOn = muaObjects.filter(function(m){ return m.scanbodyColoredVisible === true; }).length;
    var allColoredOn = coloredOn === muaObjects.length;
    var umOn = muaObjects.filter(function(m){ return m.undercutMapActive === true; }).length;
    var allUmOn = umOn === muaObjects.length;
    
    h += '<div class="tree-group-header">TOGGLE MASSIVI</div>';
    h += '<div class="tree-node"><input type="checkbox" '+(scanbodiesVisible?'checked':'')+' onchange="toggleAllScanbodies(this.checked)"><span class="dot" style="background:#ffaa44"></span><span class="lbl">Scanbody 1T3 (tutti)</span></div>';
    h += '<div class="tree-node"><input type="checkbox" '+(allCutsOn?'checked':'')+' onchange="toggleAllScanbodyCuts(this.checked)"><span class="dot" style="background:#889aad;border:1px dashed var(--dark)"></span><span class="lbl">Taglia scansione (tutti)</span></div>';
    h += '<div class="tree-node"><input type="checkbox" '+(allColoredOn?'checked':'')+' onchange="toggleAllScanbodyColored(this.checked)"><span class="dot" style="background:linear-gradient(135deg,#64748B,#0065B3)"></span><span class="lbl">Scanbody scansione (tutti)</span></div>';
    h += '<div class="tree-node"><input type="checkbox" '+(allUmOn?'checked':'')+' onchange="toggleAllUndercutMaps(this.checked)"><span class="dot" style="background:linear-gradient(90deg,#0D9E6E,#F59E0B,#F97316,#DC2626)"></span><span class="lbl">Mappa sottosquadri (tutti)</span></div>';
  }
  
  // ── Bottoni globali (Opacizza tutto / Ripristina) ──
  if(scanMesh || muaObjects.length > 0){
    h += '<div class="tree-globals">'+
      '<button class="tree-global-btn" onclick="treeUnified_ghostAll()" title="Tutte le mesh al 30% di opacita">Opacizza</button>'+
      '<button class="tree-global-btn" onclick="treeUnified_restoreAll()" title="Ripristina opacita originali">Ripristina</button>'+
    '</div>';
  }
  
  document.getElementById('layerTree').innerHTML = h;
}

// === Blocco 7a: helper per slider opacità e bottoni globali ===
function treeUnified_setScanOpacity(val){
  var v = Math.max(0.1, Math.min(1.0, parseFloat(val)/100));
  // "Opacita' comanda": opacita' <100% disattiva il taglio (trasparenza e clip+cap non coesistono).
  if(v < 1.0 && typeof synClipEnabled !== 'undefined' && synClipEnabled){
    synClipEnabled = false;
    if(typeof synUpdateClipPlane === 'function') synUpdateClipPlane();
    if(typeof tagSyncUI === 'function') tagSyncUI();
  }
  if(scanMesh && scanMesh.material){
    var mats = Array.isArray(scanMesh.material) ? scanMesh.material : [scanMesh.material];
    mats.forEach(function(mat){
      if(mat._origTransparent == null){
        mat._origTransparent = mat.transparent;
        mat._origOpacity = mat.opacity != null ? mat.opacity : 1.0;
      }
      mat.transparent = v < 1.0 || mat._origTransparent;
      mat.opacity = v;
      mat.needsUpdate = true;
    });
  }
  // Aggiorna pure il SynRegistry per coerenza
  try {
    if(window.SynRegistry && scanMesh && scanMesh._synId){
      window.SynRegistry.update(scanMesh._synId, {'visual.opacity': v});
    }
  } catch(e){}
  var lbl = document.getElementById('treeUnified_scanOpacityVal');
  if(lbl) lbl.textContent = Math.round(v*100)+'%';
}

function treeUnified_ghostAll(){
  // Ghost disattiva il taglio (trasparenza e clip+cap non coesistono).
  if(typeof synClipEnabled !== 'undefined' && synClipEnabled){
    synClipEnabled = false;
    if(typeof synUpdateClipPlane === 'function') synUpdateClipPlane();
    if(typeof tagSyncUI === 'function') tagSyncUI();
  }
  // Imposta tutte le mesh al 30%
  var ghostOp = 0.30;
  if(scanMesh && scanMesh.material){
    var mats = Array.isArray(scanMesh.material) ? scanMesh.material : [scanMesh.material];
    mats.forEach(function(mat){
      if(mat._origTransparent == null){
        mat._origTransparent = mat.transparent;
        mat._origOpacity = mat.opacity != null ? mat.opacity : 1.0;
      }
      mat.transparent = true;
      mat.opacity = ghostOp;
      mat.needsUpdate = true;
    });
  }
  muaObjects.forEach(function(m){
    [m.scanbodyMesh, m.anMesh, m.mtMesh].forEach(function(mesh){
      if(mesh && mesh.material){
        var mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach(function(mat){
          if(mat._origTransparent == null){
            mat._origTransparent = mat.transparent;
            mat._origOpacity = mat.opacity != null ? mat.opacity : 1.0;
          }
          mat.transparent = true;
          mat.opacity = ghostOp;
          mat.needsUpdate = true;
        });
      }
    });
  });
  rebuildTree();
}

function treeUnified_restoreAll(){
  // Ripristina opacita originali
  if(scanMesh && scanMesh.material){
    var mats = Array.isArray(scanMesh.material) ? scanMesh.material : [scanMesh.material];
    mats.forEach(function(mat){
      if(mat._origOpacity != null){
        mat.opacity = mat._origOpacity;
        mat.transparent = mat._origTransparent;
      } else {
        mat.opacity = 1.0;
        mat.transparent = false;
      }
      mat.needsUpdate = true;
    });
  }
  muaObjects.forEach(function(m){
    [m.scanbodyMesh, m.anMesh, m.mtMesh].forEach(function(mesh){
      if(mesh && mesh.material){
        var mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach(function(mat){
          if(mat._origOpacity != null){
            mat.opacity = mat._origOpacity;
            mat.transparent = mat._origTransparent;
          } else {
            mat.opacity = 1.0;
            mat.transparent = false;
          }
          mat.needsUpdate = true;
        });
      }
    });
  });
  rebuildTree();
}
function toggleLayer(name,on){
  if(name==='scan'&&scanMesh)scanMesh.visible=on;
}
function toggleMuaLayer(i,layer,on){
  var m=muaObjects[i];
  if(layer==='sb'){m.scanbodyMesh.visible=on;m.sbVisible=on}
  if(layer==='an'&&m.anMesh)m.anMesh.visible=on
  if(layer==='mt'&&m.mtMesh)m.mtMesh.visible=on
  if(layer==='ax')m.axisLine.visible=on;
}

function toggleMuaExpand(num){
  muaExpanded[num] = !muaExpanded[num];
  rebuildTree();
}
