/*
 * syn-env.js — pannello Impostazioni di Syntesis-ICP (Fase 5 modularizzazione, 8.86.0).
 *
 * CONTRATTO: SOLO function declaration (36), nomi bare globali invariati (18 handler inline
 * + chiamate cross-dominio + ds_refs). Lo STATO del dominio resta nel monolite alla
 * posizione originale (§IMPOSTAZIONI-RUNTIME): envSettings / millerSettings /
 * controlsSettings + load localStorage, MUA_PALETTES / MILLER_PRESETS, la chiamata
 * top-level syncMuaColorsFromPalette() e l'hook DOMContentLoaded->loadUiZoom.
 * NON spostare qui quegli statement: il try di millerSettings scrive MAX_MILLING_ANGLE
 * (dichiarato prima nel MAIN) e l'ordine di esecuzione e' semanticamente vincolante.
 *
 * Aree: ambiente (bg/gradiente/palette/scan color), render mode (solid/wireframe/both),
 * fresatore (preset -> MAX_MILLING_ANGLE), controlli 3D (moltiplicatori camera),
 * UI zoom, dialog (open/close/cancel/save, tab).
 * CARICAMENTO: <script src> classico NON-strict in testa (dopo syn-color); THREE/scene/
 * DOM letti SOLO a call-time. GATE: scripts/gate/env/gate.mjs (verbatim md5 per fn +
 * harness browser old/new: tab/save/reset, snapshot localStorage+DOM).
 */

// MUA_COLORS viene sincronizzato con la palette attiva
function syncMuaColorsFromPalette(){
  var pal = MUA_PALETTES[envSettings.palette] || MUA_PALETTES['syntesis'];
  MUA_COLORS = pal.colors.slice();
}

// ── RENDER MODE (Solid / Wireframe / Both) ──────────────────────
// Per "both" aggiungo un LineSegments overlay al mesh con WireframeGeometry
function applyRenderModeToMesh(mesh){
  if(!mesh || !mesh.material) return;
  var mode = envSettings.renderMode || 'solid';
  // Rimuovo overlay precedente se esiste
  if(mesh.userData && mesh.userData.wireframeOverlay){
    mesh.remove(mesh.userData.wireframeOverlay);
    if(mesh.userData.wireframeOverlay.geometry) mesh.userData.wireframeOverlay.geometry.dispose();
    if(mesh.userData.wireframeOverlay.material) mesh.userData.wireframeOverlay.material.dispose();
    mesh.userData.wireframeOverlay = null;
  }
  if(mode === 'wireframe'){
    mesh.material.wireframe = true;
    mesh.material.needsUpdate = true;
  } else if(mode === 'both'){
    mesh.material.wireframe = false;
    mesh.material.needsUpdate = true;
    // Aggiungo overlay wireframe con colore scuro sottile
    try {
      var wireGeo = new THREE.WireframeGeometry(mesh.geometry);
      var wireMat = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthTest: true, clippingPlanes: (typeof synClipArr==='function'?synClipArr():[]) });
      var wireLines = new THREE.LineSegments(wireGeo, wireMat);
      wireLines.name = '_wireOverlay';
      mesh.add(wireLines);
      if(!mesh.userData) mesh.userData = {};
      mesh.userData.wireframeOverlay = wireLines;
    } catch(e){}
  } else { // solid
    mesh.material.wireframe = false;
    mesh.material.needsUpdate = true;
  }
}

function applyRenderModeToScene(){
  // Scansione
  if(typeof scanMesh !== 'undefined' && scanMesh){
    applyRenderModeToMesh(scanMesh);
  }
  // MUA (scanbody + connessione + analogo + scanbody scansione colorato)
  if(typeof muaObjects !== 'undefined'){
    muaObjects.forEach(function(m){
      if(m.scanbodyMesh) applyRenderModeToMesh(m.scanbodyMesh);
      if(m.mtMesh) applyRenderModeToMesh(m.mtMesh);
      if(m.anMesh) applyRenderModeToMesh(m.anMesh);
      if(m.scanbodyScanMesh) applyRenderModeToMesh(m.scanbodyScanMesh);
    });
  }
  // FIX v7.3.9.082: applico la modalita\' anche alle mesh Misurare
  // (arcate riferimento/confronto + scanbody A e B post-ICP)
  if(typeof misICP_bgMeshA !== 'undefined' && misICP_bgMeshA){
    applyRenderModeToMesh(misICP_bgMeshA);
  }
  if(typeof misICP_bgMeshB !== 'undefined' && misICP_bgMeshB){
    applyRenderModeToMesh(misICP_bgMeshB);
  }
  if(typeof misICP_meshesA !== 'undefined' && misICP_meshesA){
    misICP_meshesA.forEach(function(m){ if(m) applyRenderModeToMesh(m); });
  }
  if(typeof misICP_meshesB !== 'undefined' && misICP_meshesB){
    misICP_meshesB.forEach(function(m){ if(m) applyRenderModeToMesh(m); });
  }
  // Legacy single mesh (nel caso vengano ancora usate)
  if(typeof misICP_meshA !== 'undefined' && misICP_meshA){
    applyRenderModeToMesh(misICP_meshA);
  }
  if(typeof misICP_meshB !== 'undefined' && misICP_meshB){
    applyRenderModeToMesh(misICP_meshB);
  }
  // 8.39.0: Replace-iT (scansione + madre/figlio di ogni impianto + anteprima) ->
  // la barra globale #vmBar/Impostazioni raggiunge anche le mesh del workflow replace.
  if(typeof replaceApplyRenderMode === 'function') replaceApplyRenderMode();
  // 8.71.3: Sostituire (scansione Multi-A + template posizionati) -> la barra globale
  // #vmBar/Impostazioni raggiunge anche le mesh del workflow Sostituire.
  if(typeof sostApplyRenderMode === 'function') sostApplyRenderMode();
}

// Genera CSS background per il viewport (<div>) -- stesso risultato della texture Three
function envBgCss(){
  if(envSettings.bgType === 'gradient'){
    return 'linear-gradient(' + envSettings.bgAngle + 'deg, ' + envSettings.bgColor + ', ' + envSettings.bgColor2 + ')';
  }
  return envSettings.bgColor;
}

// Applica impostazioni ambiente in tempo reale (scene + scanMesh + MUA esistenti)
function applyEnvToScene(){
  if(typeof scene !== 'undefined' && scene){
    if(envSettings.bgType === 'gradient'){
      scene.background = makeGradientTexture(envSettings.bgColor, envSettings.bgColor2, envSettings.bgAngle);
    } else {
      scene.background = new THREE.Color(envSettings.bgColor);
    }
  }
  var vp = document.getElementById('viewport');
  if(vp) vp.style.background = envBgCss();
  if(typeof scanMesh !== 'undefined' && scanMesh && scanMesh.material){
    scanMesh.material.color = new THREE.Color(envSettings.scanColor);
    scanMesh.material.needsUpdate = true;
  }
  // Ricoloro MUA esistenti secondo la palette corrente
  syncMuaColorsFromPalette();
  if(typeof muaObjects !== 'undefined' && muaObjects.length > 0){
    muaObjects.forEach(function(m, i){
      var newCol = MUA_COLORS[i % MUA_COLORS.length];
      m.color = newCol;
      var threeCol = new THREE.Color(newCol);
      if(m.mtMesh && m.mtMesh.material){ m.mtMesh.material.color = threeCol; m.mtMesh.material.needsUpdate = true; }
      if(m.anMesh && m.anMesh.material){ m.anMesh.material.color = threeCol; m.anMesh.material.needsUpdate = true; }
      if(m.axisLine && m.axisLine.material){ m.axisLine.material.color = threeCol; m.axisLine.material.needsUpdate = true; }
    });
    if(typeof rebuildTree === 'function') rebuildTree();
    if(typeof updateMuaPanel === 'function') updateMuaPanel();
    if(typeof updateDivergenceLabels === 'function') updateDivergenceLabels();
  }
  // Riapplico render mode (perché potrebbero esserci nuovi overlay da rigenerare)
  applyRenderModeToScene();
}

function onEnvBgPickerChange(val){
  // Se siamo in modalità gradient, cambia il primo colore del gradiente (non esce dal gradiente)
  if(envSettings.bgType === 'gradient'){
    envSettings.bgColor = val;
    document.getElementById('settingsBgHex').textContent = 'gradiente';
    var c1 = document.getElementById('settingsCustomColor1');
    if(c1) c1.value = val;
    applyEnvToScene();
    updateCustomPreview();
  } else {
    onEnvBgChange(val);
  }
}

function onEnvBgChange(val){
  // Chiamata dai swatch preset e dal color picker principale: imposta solido
  envSettings.bgType = 'solid';
  envSettings.bgColor = val;
  var picker = document.getElementById('settingsBgColor');
  if(picker && picker.value.toLowerCase() !== val.toLowerCase()) picker.value = val;
  document.getElementById('settingsBgHex').textContent = val;
  // Nascondo box custom se aperto
  var custom = document.getElementById('settingsBgCustomBox');
  if(custom) custom.style.display = 'none';
  applyEnvToScene();
  updateEnvSwatchBorders();
  updateCustomPreview();
}

function onEnvBgCustomOpen(){
  // Apre il pannello custom. Se siamo ancora in "solid" normale,
  // mantiene il colore corrente come primo colore e imposta un secondo di default.
  envSettings.bgType = envSettings.bgType === 'gradient' ? 'gradient' : 'solid';
  if(!envSettings.bgColor2) envSettings.bgColor2 = '#415A77';
  if(typeof envSettings.bgAngle !== 'number') envSettings.bgAngle = 180;
  var box = document.getElementById('settingsBgCustomBox');
  if(box) box.style.display = 'block';
  // Sincronizzo i controlli interni
  document.getElementById('settingsCustomColor1').value = envSettings.bgColor;
  document.getElementById('settingsCustomColor2').value = envSettings.bgColor2;
  document.getElementById('settingsCustomAngle').value = envSettings.bgAngle;
  document.getElementById('settingsCustomAngleVal').textContent = envSettings.bgAngle + '°';
  var rSolid = document.getElementById('settingsCustomSolid');
  var rGrad = document.getElementById('settingsCustomGradient');
  rSolid.checked = (envSettings.bgType === 'solid');
  rGrad.checked = (envSettings.bgType === 'gradient');
  updateCustomModeUI();
  applyEnvToScene();
  updateEnvSwatchBorders();
  updateCustomPreview();
}

function onEnvCustomModeChange(mode){
  envSettings.bgType = mode;
  updateCustomModeUI();
  applyEnvToScene();
  updateCustomPreview();
  updateEnvSwatchBorders();
}

function updateCustomModeUI(){
  var gradRow = document.getElementById('settingsCustomGradientRow');
  if(gradRow) gradRow.style.display = envSettings.bgType === 'gradient' ? 'flex' : 'none';
}

function onEnvBgCustomPrimary(val){
  envSettings.bgColor = val;
  document.getElementById('settingsBgColor').value = val;
  document.getElementById('settingsBgHex').textContent = envSettings.bgType === 'gradient' ? 'gradiente' : val;
  applyEnvToScene();
  updateCustomPreview();
}

function onEnvBgCustomSecondary(val){
  envSettings.bgColor2 = val;
  applyEnvToScene();
  updateCustomPreview();
}

function onEnvBgAngleChange(val){
  envSettings.bgAngle = parseInt(val);
  document.getElementById('settingsCustomAngleVal').textContent = envSettings.bgAngle + '°';
  applyEnvToScene();
  updateCustomPreview();
}

function updateCustomPreview(){
  var prev = document.getElementById('settingsCustomPreview');
  if(!prev) return;
  prev.style.background = envBgCss();
  var hint = document.getElementById('settingsCustomHint');
  if(hint){
    if(envSettings.bgType === 'gradient'){
      var a = envSettings.bgAngle;
      var dir = (a >= 337 || a < 23) ? "dall'alto" :
                (a < 68)  ? "obliquo in alto a destra" :
                (a < 113) ? "da destra" :
                (a < 158) ? "obliquo in basso a destra" :
                (a < 203) ? "dal basso" :
                (a < 248) ? "obliquo in basso a sinistra" :
                (a < 293) ? "da sinistra" : "obliquo in alto a sinistra";
      hint.textContent = 'anteprima · ' + dir;
    } else {
      hint.textContent = 'anteprima · solido';
    }
  }
}

function onEnvScanColorChange(val){
  envSettings.scanColor = val;
  var picker = document.getElementById('settingsScanColor');
  if(picker && picker.value.toLowerCase() !== val.toLowerCase()) picker.value = val;
  document.getElementById('settingsScanHex').textContent = val;
  applyEnvToScene();
  updateEnvSwatchBorders();
}

function onEnvPaletteChange(key){
  if(!MUA_PALETTES[key]) return;
  envSettings.palette = key;
  applyEnvToScene();
  buildPaletteGrid();
}

function onEnvRenderModeChange(mode){
  if(mode !== 'solid' && mode !== 'wireframe' && mode !== 'both') return;
  envSettings.renderMode = mode;
  applyRenderModeToScene();
  updateRenderModeUI();
}

function updateRenderModeUI(){
  ['solid','wireframe','both'].forEach(function(m){
    var btn = document.getElementById('settingsRender_' + m);
    if(!btn) return;
    if(envSettings.renderMode === m){
      btn.style.background = 'var(--blue)';
      btn.style.color = '#fff';
      btn.style.borderColor = 'var(--blue)';
    } else {
      btn.style.background = '#fff';
      btn.style.color = 'var(--dark)';
      btn.style.borderColor = '#ccc';
    }
  });
}

function updateEnvSwatchBorders(){
  // Evidenzia il swatch corrispondente
  var presetBgValues = ['#1a1a2e','#0a0a0f','#243447','#f0f5fa','#ffffff'];
  var inPreset = envSettings.bgType === 'solid' &&
                 presetBgValues.indexOf(envSettings.bgColor.toLowerCase()) !== -1;
  var isCustom = !inPreset; // gradient o colore fuori preset → evidenzia "+"
  
  var swatchesBg = document.querySelectorAll('.env-swatch');
  swatchesBg.forEach(function(s){
    var val = s.getAttribute('data-value');
    if(val === 'custom'){
      s.style.border = isCustom ? '1.5px solid var(--blue)' : '1px solid #D6E4F0';
    } else if(val && inPreset && val.toLowerCase() === envSettings.bgColor.toLowerCase()){
      s.style.border = '1.5px solid var(--blue)';
    } else {
      s.style.border = '1px solid #D6E4F0';
    }
  });
  var swatchesScan = document.querySelectorAll('.env-swatch-scan');
  swatchesScan.forEach(function(s){
    if(s.getAttribute('data-value') && s.getAttribute('data-value').toLowerCase() === envSettings.scanColor.toLowerCase()){
      s.style.border = '1.5px solid var(--blue)';
    } else {
      s.style.border = '1px solid #D6E4F0';
    }
  });
}

function buildPaletteGrid(){
  var grid = document.getElementById('settingsPaletteGrid');
  if(!grid) return;
  var html = '';
  Object.keys(MUA_PALETTES).forEach(function(key){
    var pal = MUA_PALETTES[key];
    var isActive = (key === envSettings.palette);
    var border = isActive ? '1.5px solid var(--blue)' : '1px solid #D6E4F0';
    html += '<div onclick="onEnvPaletteChange(\''+key+'\')" style="padding:10px;border:'+border+';border-radius:6px;cursor:pointer">';
    html += '<div style="font-family:var(--mono);font-size:12px;color:var(--dark);font-weight:500;margin-bottom:5px">'+pal.name+'</div>';
    html += '<div style="display:flex;gap:3px">';
    pal.colors.slice(0,5).forEach(function(c){
      var hex = '#' + c.toString(16).padStart(6,'0');
      html += '<span style="width:16px;height:16px;background:'+hex+';border-radius:50%;display:inline-block"></span>';
    });
    html += '</div></div>';
  });
  grid.innerHTML = html;
}

function switchSettingsTab(which){
  var tabs = {
    env:  {tab: document.getElementById('settingsTabEnv'),  btn: document.getElementById('settingsTabEnvBtn')},
    mach: {tab: document.getElementById('settingsTabMach'), btn: document.getElementById('settingsTabMachBtn')},
    ui:   {tab: document.getElementById('settingsTabUi'),   btn: document.getElementById('settingsTabUiBtn')},
    algo: {tab: document.getElementById('settingsTabAlgo'), btn: document.getElementById('settingsTabAlgoBtn')}
  };
  Object.keys(tabs).forEach(function(k){
    var T = tabs[k]; if(!T.tab || !T.btn) return;
    var active = (k === which);
    T.tab.style.display = active ? 'block' : 'none';
    T.btn.style.color = active ? 'var(--blue)' : 'var(--gray)';
    T.btn.style.fontWeight = active ? '800' : 'normal';
    T.btn.style.borderBottom = active ? '2px solid var(--blue)' : 'none';
  });
  if(which === 'ui' && typeof refreshUiZoomButtons === 'function') refreshUiZoomButtons();
  if(which === 'algo'){
    // Riallinea radio button al valore salvato + refresh diagnostica
    try {
      var saved = localStorage.getItem('syntesis_mua_algorithm') || 'client';
      var radios = document.querySelectorAll('input[name="algoOpt"]');
      radios.forEach(function(r){ r.checked = (r.value === saved); });
      // Motore asse cilindro (syntesis_axis_engine): riallinea radio + stile
      var savedAx = localStorage.getItem('syntesis_axis_engine') || 'auto';
      document.querySelectorAll('input[name="axisEngineOpt"]').forEach(function(r){ r.checked = (r.value === savedAx); });
      if(typeof onAxisEngineChange === 'function') onAxisEngineChange(savedAx);
      // Motore centraggio Sostituire (syntesis_sost_center): riallinea radio + stile
      var savedSc = localStorage.getItem('syntesis_sost_center') || 'robust';   // 8.96.0: default robust (coerente con synSostCenterRead)
      document.querySelectorAll('input[name="sostCenterOpt"]').forEach(function(r){ r.checked = (r.value === savedSc); });
      if(typeof onSostCenterChange === 'function') onSostCenterChange(savedSc);
      // 8.97.0: Motore Raffina Sostituire (syntesis_sost_raffina): riallinea radio + stile (default balanced)
      var savedRa = localStorage.getItem('syntesis_sost_raffina') || 'balanced';
      document.querySelectorAll('input[name="sostRaffinaOpt"]').forEach(function(r){ r.checked = (r.value === savedRa); });
      if(typeof onSostRaffinaChange === 'function') onSostRaffinaChange(savedRa);
      // 8.48.0: Motore ICP Replace-iT (syntesis_replace_icp): riallinea radio + stile
      var savedIcp = localStorage.getItem('syntesis_replace_icp') || 'p2point';
      document.querySelectorAll('input[name="replaceICPOpt"]').forEach(function(r){ r.checked = (r.value === savedIcp); });
      if(typeof onReplaceICPChange === 'function') onReplaceICPChange(savedIcp);
    } catch(e){}
    if(typeof refreshAlgoDiagnostics === 'function') refreshAlgoDiagnostics();
  }
}

// Applica i moltiplicatori all'istanza controls (idempotente; safe se controls
// non ancora creato). persist=true salva anche in localStorage.
function applyControlsSettings(persist){
  if(typeof controls !== 'undefined' && controls){
    controls.rotateSpeed = CONTROLS_BASE.rotate * controlsSettings.rotate;
    controls.panSpeed    = CONTROLS_BASE.pan    * controlsSettings.pan;
    controls.zoomSpeed   = CONTROLS_BASE.zoom   * controlsSettings.zoom;
  }
  if(persist){ try { localStorage.setItem(SYN_CONTROLS_KEY, JSON.stringify(controlsSettings)); } catch(e){} }
}

// Handler slider (applica subito + salva, come lo zoom testo del tab Interfaccia)
function onControlsSettingChange(kind, value){
  var v = parseFloat(value);
  if(!(v > 0)) return;
  controlsSettings[kind] = v;
  var lbl = document.getElementById('ctrlSpeed_' + kind + '_val');
  if(lbl) lbl.textContent = v.toFixed(1) + '×';
  applyControlsSettings(true);
}

// Ripristina i default (1.0×) e riallinea gli slider aperti
function resetControlsSettings(){
  controlsSettings = { rotate: 1.0, pan: 1.0, zoom: 1.0 };
  applyControlsSettings(true);
  ['rotate','pan','zoom'].forEach(function(k){
    var sl = document.getElementById('ctrlSpeed_' + k);   if(sl)  sl.value = 1.0;
    var lbl = document.getElementById('ctrlSpeed_' + k + '_val'); if(lbl) lbl.textContent = '1.0×';
  });
}

// Popola gli slider dai valori correnti (chiamato da openSettings)
function syncControlsSettingsUI(){
  ['rotate','pan','zoom'].forEach(function(k){
    var sl = document.getElementById('ctrlSpeed_' + k);   if(sl)  sl.value = controlsSettings[k];
    var lbl = document.getElementById('ctrlSpeed_' + k + '_val'); if(lbl) lbl.textContent = controlsSettings[k].toFixed(1) + '×';
  });
}

// Helper v7.3.9.082: ritorna il fattore zoom corrente del body
// (per compensare coordinate label che vengono ri-zoomate dal browser)
function syntesisGetUiZoom(){
  try {
    var z = parseFloat(document.body.style.zoom);
    if(z && !isNaN(z) && z > 0) return z;
  } catch(e){}
  return 1.0;
}

function applyUiZoom(zoom, opts){
  // v7.3.9.082: opts.silent=true applica senza salvare in localStorage
  // (usato da loadUiZoom quando applica il default 130%)
  zoom = parseFloat(zoom);
  if(!zoom || isNaN(zoom)) zoom = 1.30;
  zoom = Math.max(0.7, Math.min(1.5, zoom));
  try {
    document.body.style.zoom = String(zoom);
    if(navigator.userAgent.indexOf('Firefox') >= 0){
      document.body.style.transform = 'scale(' + zoom + ')';
      document.body.style.transformOrigin = '0 0';
      document.body.style.width = (100/zoom) + '%';
      document.body.style.height = (100/zoom) + '%';
    }
  } catch(e){ console.warn('[UI zoom] apply failed:', e); }
  if(!(opts && opts.silent)){
    try { localStorage.setItem(SYNTESIS_UI_ZOOM_KEY, String(zoom)); } catch(e){}
  }
  if(typeof refreshUiZoomButtons === 'function') refreshUiZoomButtons();
}

function loadUiZoom(){
  // v7.3.9.082: zoom default 1.0. I font base sono stati ingranditi nel CSS,
  // quindi non serve piu' lo zoom forzato di v044.
  // Reset una-tantum: chi aveva la migrazione automatica v044 attiva con zoom
  // 1.15/1.30/1.45 (cioe' non aveva scelto consapevolmente) viene riportato a
  // 1.0 cosi' vede i nuovi font CSS senza moltiplicatore aggiuntivo.
  // Chi ha esplicitamente scelto altro mantiene la sua preferenza.
  var DEFAULT_UI_ZOOM = 1.0;
  var RESET_KEY = 'syntesis_ui_zoom_reset_v045';
  try {
    var raw = localStorage.getItem(SYNTESIS_UI_ZOOM_KEY);
    var resetDone = localStorage.getItem(RESET_KEY);
    var hadV044Migration = localStorage.getItem('syntesis_ui_zoom_migrated_v044');
    if(raw === null || raw === undefined || raw === ''){
      applyUiZoom(DEFAULT_UI_ZOOM, {silent:true});
      try { localStorage.setItem(RESET_KEY, '1'); } catch(e){}
      return;
    }
    var z = parseFloat(raw);
    // Reset solo se NON e' stato gia' fatto E il valore corrente proviene
    // probabilmente dal default forzato di v044 (1.15, 1.30, 1.45)
    if(!resetDone && hadV044Migration && (z === 1.15 || z === 1.30 || z === 1.45)){
      applyUiZoom(DEFAULT_UI_ZOOM, {silent:false});  // salva 1.0 come nuova preferenza
      try { localStorage.setItem(RESET_KEY, '1'); } catch(e){}
      return;
    }
    if(z && z >= 0.7 && z <= 1.6){ applyUiZoom(z, {silent:true}); }
    else { applyUiZoom(DEFAULT_UI_ZOOM, {silent:true}); }
    try { localStorage.setItem(RESET_KEY, '1'); } catch(e){}
  } catch(e){
    try { applyUiZoom(DEFAULT_UI_ZOOM, {silent:true}); } catch(e2){}
  }
}

function refreshUiZoomButtons(){
  // v7.3.9.082: 5 bottoni 100/115/130/145/160 (130 = default)
  var z = 1.30;
  try { z = parseFloat(localStorage.getItem(SYNTESIS_UI_ZOOM_KEY)) || 1.30; } catch(e){}
  var btns = [
    {id:'uiZoomBtn100', val:1.0},
    {id:'uiZoomBtn115', val:1.15},
    {id:'uiZoomBtn130', val:1.3},
    {id:'uiZoomBtn145', val:1.45},
    {id:'uiZoomBtn160', val:1.6}
  ];
  btns.forEach(function(b){
    var el = document.getElementById(b.id); if(!el) return;
    var active = Math.abs(z - b.val) < 0.01;
    el.style.background = active ? 'var(--blue)' : '#fff';
    el.style.color = active ? '#fff' : 'var(--dark)';
    el.style.borderColor = active ? 'var(--blue)' : 'var(--border)';
    el.style.fontWeight = active ? '800' : '600';
  });
}

function openSettings(){
  // Backup per Annulla
  envSettingsBackup = JSON.parse(JSON.stringify(envSettings));
  millerSettingsBackup = JSON.parse(JSON.stringify(millerSettings));

  // Popola controlli tab AMBIENTE
  document.getElementById('settingsBgColor').value = envSettings.bgColor;
  document.getElementById('settingsBgHex').textContent = envSettings.bgType === 'gradient' ? 'gradiente' : envSettings.bgColor;
  document.getElementById('settingsScanColor').value = envSettings.scanColor;
  document.getElementById('settingsScanHex').textContent = envSettings.scanColor;
  // Ripopolo campi custom
  document.getElementById('settingsCustomColor1').value = envSettings.bgColor;
  document.getElementById('settingsCustomColor2').value = envSettings.bgColor2 || '#415A77';
  document.getElementById('settingsCustomAngle').value = envSettings.bgAngle || 180;
  document.getElementById('settingsCustomAngleVal').textContent = (envSettings.bgAngle || 180) + '°';
  document.getElementById('settingsCustomSolid').checked = (envSettings.bgType !== 'gradient');
  document.getElementById('settingsCustomGradient').checked = (envSettings.bgType === 'gradient');
  // Apro box custom se in gradient, altrimenti lo chiudo
  document.getElementById('settingsBgCustomBox').style.display = (envSettings.bgType === 'gradient') ? 'block' : 'none';
  updateCustomModeUI();
  updateCustomPreview();
  updateEnvSwatchBorders();
  buildPaletteGrid();
  updateRenderModeUI();

  // Popola controlli tab MACCHINE
  document.getElementById('settingsPreset').value = millerSettings.preset || 'custom';
  var radios = document.getElementsByName('settingsAxes');
  for(var i = 0; i < radios.length; i++){
    radios[i].checked = (parseInt(radios[i].value) === millerSettings.axes);
  }
  document.getElementById('settingsBAxisSlider').value = millerSettings.bAxis;
  document.getElementById('settingsBAxisValue').textContent = millerSettings.bAxis + '°';
  updateSettingsUIState();

  // 8.82.0: allinea gli slider "Controlli 3D (mouse)" ai valori salvati
  if(typeof syncControlsSettingsUI === 'function') syncControlsSettingsUI();

  // Apri sul tab Ambiente
  switchSettingsTab('env');
  document.getElementById('settingsDialog').style.display = 'flex';
}

function closeSettings(){
  document.getElementById('settingsDialog').style.display = 'none';
}

function cancelSettings(){
  // Ripristino lo stato precedente all'apertura
  if(envSettingsBackup){
    envSettings = JSON.parse(JSON.stringify(envSettingsBackup));
    applyEnvToScene();
  }
  if(millerSettingsBackup){
    millerSettings = JSON.parse(JSON.stringify(millerSettingsBackup));
    MAX_MILLING_ANGLE = millerSettings.bAxis;
    if(typeof computeClinicalAnalysis === 'function') computeClinicalAnalysis();
  }
  closeSettings();
}

function applyMillerPreset(){
  var presetKey = document.getElementById('settingsPreset').value;
  var preset = MILLER_PRESETS[presetKey];
  if(!preset) return;
  // Aggiorna radio tipo assi
  var radios = document.getElementsByName('settingsAxes');
  for(var i = 0; i < radios.length; i++){
    radios[i].checked = (parseInt(radios[i].value) === preset.axes);
  }
  // Aggiorna slider
  document.getElementById('settingsBAxisSlider').value = preset.bAxis;
  document.getElementById('settingsBAxisValue').textContent = preset.bAxis + '°';
  document.getElementById('settingsInfo').textContent = preset.desc;
  updateSettingsUIState();
}

function updateMillerSettings(){
  // Quando l'utente cambia manualmente, passo a "custom"
  document.getElementById('settingsPreset').value = 'custom';
  var slider = document.getElementById('settingsBAxisSlider');
  document.getElementById('settingsBAxisValue').textContent = slider.value + '°';
  updateSettingsUIState();
}

function updateSettingsUIState(){
  // Se 3 assi e' selezionato, il B axis slider perde senso ma lo mostro come "limite divergenza"
  var radios = document.getElementsByName('settingsAxes');
  var axes = 5;
  for(var i = 0; i < radios.length; i++){
    if(radios[i].checked){ axes = parseInt(radios[i].value); break; }
  }
  var row = document.getElementById('settingsBAxisRow');
  var label = row.querySelector('label span:first-child');
  if(axes === 3){
    label.textContent = 'Limite divergenza totale (paralleli)';
  } else if(axes === 4){
    label.textContent = 'Limite angolare asse rotante (4°)';
  } else {
    label.textContent = 'Limite angolare asse B (5°)';
  }
}

function saveSettings(){
  var radios = document.getElementsByName('settingsAxes');
  var axes = 5;
  for(var i = 0; i < radios.length; i++){
    if(radios[i].checked){ axes = parseInt(radios[i].value); break; }
  }
  var bAxis = parseInt(document.getElementById('settingsBAxisSlider').value);
  var preset = document.getElementById('settingsPreset').value;
  millerSettings = { preset: preset, axes: axes, bAxis: bAxis };
  MAX_MILLING_ANGLE = bAxis;
  try { localStorage.setItem('syntesis_miller_settings', JSON.stringify(millerSettings)); } catch(e){}
  // Salvo anche envSettings
  try { localStorage.setItem('syntesis_env_settings', JSON.stringify(envSettings)); } catch(e){}
  closeSettings();
  showStatus('Impostazioni salvate.');
  if(typeof computeClinicalAnalysis === 'function') computeClinicalAnalysis();
}
