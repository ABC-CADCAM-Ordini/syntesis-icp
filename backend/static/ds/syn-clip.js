/*
 * syn-clip.js — CLIP ENGINE (r169) di /analizzare: clipping plane + stencil cap
 * per "vedere dentro" la scansione, + pannello "Taglio". Estratto dal monolite
 * syntesis-analyzer-v3b.html (blocco originale ~2574-2717) in modulo.
 *
 * CONFINE: il MOTORE non cambia. Pattern ufficiale webgl_clipping_stencil
 * (stencil group back/front + cap NotEqual + clearStencil in onAfterRender).
 * Clip applicato SOLO alla scansione (scanMesh): i MUA restano interi.
 *
 * CARICAMENTO: <script src="/static/ds/syn-clip.js"> classico (NON module),
 * come ds/syn-render.js / ds/syn-gate.js. NON tocca THREE a parse-time
 * (legge window.THREE solo dentro le funzioni, invocate dopo 'three-ready').
 *
 * STATO SU window (NON incapsulato in chiusura): synClipEnabled & co. sono
 * mutati DALL'ESTERNO dal monolite (regola "opacità comanda" in
 * treeUnified_setScanOpacity / treeUnified_ghostAll, v3b ~4013-4045, che fanno
 * `synClipEnabled = false`). Tenendo lo stato come proprietà di window e
 * ri-esponendo le funzioni coi nomi bare, quei call-site esterni e gli handler
 * inline (#panelTaglio: openTaglio()/tagOnToggle()...) restano INVARIATI.
 *
 * VALORI/COMPORTAMENTO: identici al blocco originale (gate di equivalenza
 * scripts/gate/clip: G1 numerico/strutturale + G2 DOM, golden==after).
 */
(function (root) {
  "use strict";

  // ── Stato del motore su window (vedi nota STATO SU window in testa) ──
  if (root.synClipPlane    === undefined) root.synClipPlane    = null;
  if (root.synClipEnabled  === undefined) root.synClipEnabled  = false;
  if (root.synClipAxis     === undefined) root.synClipAxis     = 'y';
  if (root.synClipPos      === undefined) root.synClipPos      = 0;
  if (root.synClipFlip     === undefined) root.synClipFlip     = false;
  if (root.synStencilGroup === undefined) root.synStencilGroup = null;
  if (root.synCapMesh      === undefined) root.synCapMesh      = null;
  // synClipCenter lazy (no new THREE.* a parse-time: window.THREE non c'è ancora).
  if (root.synClipCenter   === undefined) root.synClipCenter   = null;
  if (root.synClipDiag     === undefined) root.synClipDiag     = 100;
  if (root.tagState        === undefined) root.tagState        = { isOpen: false };

  function synClipArr(){ return (root.synClipEnabled && root.synClipPlane) ? [root.synClipPlane] : []; }

  // Stencil group: back-face incrementa, front-face decrementa (solo stencil, no colore/profondità).
  function synMakeStencilGroup(geometry){
    var THREE = root.THREE;
    var group=new THREE.Group();
    var base=new THREE.MeshBasicMaterial();
    base.depthWrite=false; base.depthTest=false; base.colorWrite=false;
    base.stencilWrite=true; base.stencilFunc=THREE.AlwaysStencilFunc;
    var back=base.clone(); back.side=THREE.BackSide; back.clippingPlanes=[root.synClipPlane];
    back.stencilFail=THREE.IncrementWrapStencilOp; back.stencilZFail=THREE.IncrementWrapStencilOp; back.stencilZPass=THREE.IncrementWrapStencilOp;
    var mBack=new THREE.Mesh(geometry,back); mBack.renderOrder=1;
    var front=base.clone(); front.side=THREE.FrontSide; front.clippingPlanes=[root.synClipPlane];
    front.stencilFail=THREE.DecrementWrapStencilOp; front.stencilZFail=THREE.DecrementWrapStencilOp; front.stencilZPass=THREE.DecrementWrapStencilOp;
    var mFront=new THREE.Mesh(geometry,front); mFront.renderOrder=1;
    group.add(mBack,mFront);
    return group;
  }

  // Allinea il piano-tappo al clip plane (orientamento + posizione coplanare).
  function synPositionCap(){
    var THREE = root.THREE;
    if(!root.synCapMesh||!root.synClipPlane) return;
    var n=root.synClipPlane.normal.clone();
    var q=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),n);
    root.synCapMesh.quaternion.copy(q);
    root.synCapMesh.position.copy(n.multiplyScalar(-root.synClipPlane.constant));
  }

  // Ricalcola normale/costante del piano da asse+posizione+flip e propaga ai materiali clippabili.
  function synUpdateClipPlane(){
    var THREE = root.THREE;
    if(!root.synClipPlane) root.synClipPlane=new THREE.Plane(new THREE.Vector3(0,-1,0),0);
    if(!root.synClipCenter) root.synClipCenter=new THREE.Vector3();
    var n=new THREE.Vector3(root.synClipAxis==='x'?1:0, root.synClipAxis==='y'?1:0, root.synClipAxis==='z'?1:0);
    if(root.synClipFlip) n.negate();
    var pt=root.synClipCenter.clone().add(n.clone().multiplyScalar(root.synClipPos));
    root.synClipPlane.setFromNormalAndCoplanarPoint(n,pt);
    var arr=synClipArr();
    if(root.scanMesh&&root.scanMesh.material) root.scanMesh.material.clippingPlanes=arr;
    if(root.scanMesh&&root.scanMesh.userData&&root.scanMesh.userData.wireframeOverlay&&root.scanMesh.userData.wireframeOverlay.material) root.scanMesh.userData.wireframeOverlay.material.clippingPlanes=arr;
    if(root.synStencilGroup){ root.synStencilGroup.visible=root.synClipEnabled; root.synStencilGroup.children.forEach(function(m){ m.material.clippingPlanes=(root.synClipEnabled?[root.synClipPlane]:[]); }); }
    if(root.synCapMesh){ root.synCapMesh.visible=root.synClipEnabled; synPositionCap(); }
  }

  // (Ri)costruisce stencil group + cap dalla geometria CORRENTE della scansione.
  // Da chiamare quando scanMesh viene creata (loadScanFile) o la sua geometria cambia (rebuildScanMeshGeometry).
  function synRebuildClip(){
    var THREE = root.THREE;
    if(!root.scanMesh||!root.scene) return;
    if(!root.synClipCenter) root.synClipCenter=new THREE.Vector3();
    root.scanMesh.geometry.computeBoundingBox();
    var bb=root.scanMesh.geometry.boundingBox;
    bb.getCenter(root.synClipCenter);
    root.synClipDiag=bb.getSize(new THREE.Vector3()).length();
    if(!root.synClipPlane) root.synClipPlane=new THREE.Plane(new THREE.Vector3(0,-1,0),0);
    if(root.synStencilGroup){ root.scene.remove(root.synStencilGroup); root.synStencilGroup.traverse(function(o){ if(o.material)o.material.dispose(); }); root.synStencilGroup=null; }
    if(root.synCapMesh){ root.scene.remove(root.synCapMesh); root.synCapMesh.geometry.dispose(); root.synCapMesh.material.dispose(); root.synCapMesh=null; }
    root.synStencilGroup=synMakeStencilGroup(root.scanMesh.geometry);
    root.scene.add(root.synStencilGroup);
    // Cap solido: look Phong come la scansione (stesso colore/specular/shininess), disegnato dove stencil!=0.
    var capMat=new THREE.MeshPhongMaterial({
      color:new THREE.Color(root.envSettings.scanColor), specular:0x111111, shininess:30, side:THREE.DoubleSide,
      stencilWrite:true, stencilRef:0, stencilFunc:THREE.NotEqualStencilFunc,
      stencilFail:THREE.ReplaceStencilOp, stencilZFail:THREE.ReplaceStencilOp, stencilZPass:THREE.ReplaceStencilOp
    });
    root.synCapMesh=new THREE.Mesh(new THREE.PlaneGeometry(root.synClipDiag*2.5, root.synClipDiag*2.5), capMat);
    root.synCapMesh.renderOrder=1.1;
    root.synCapMesh.onAfterRender=function(r){ r.clearStencil(); };
    root.scene.add(root.synCapMesh);
    root.scanMesh.renderOrder=6;
    var bs=root.document.getElementById('btnOpenTaglio'); if(bs) bs.disabled=false;
    var posR=root.document.getElementById('tagPos');
    if(posR){ var h=Math.ceil(root.synClipDiag/2); posR.min=-h; posR.max=h; }
    synUpdateClipPlane();
  }

  // ── Pannello "Taglio" (UI di prodotto del clip engine) ──
  // Pilota i globali del motore (synClipEnabled/Axis/Pos/Flip) + synUpdateClipPlane: il MOTORE non cambia.
  function openTaglio(){
    if(typeof root.scanMesh==='undefined' || !root.scanMesh){ if(typeof root.showStatus==='function') root.showStatus('Carica prima una scansione'); return; }
    if(typeof root.fresState!=='undefined' && root.fresState.isOpen && typeof root.closeFresability==='function') root.closeFresability();
    var panMua=root.document.getElementById('panelMuaList'), panAng=root.document.getElementById('panelAngleList'), panAx=root.document.getElementById('panelAxisInfo'), panFres=root.document.getElementById('panelFresabilita'), panSez=root.document.getElementById('panelTaglio');
    if(panMua) panMua.style.display='none';
    if(panAng) panAng.style.display='none';
    if(panAx) panAx.style.display='none';
    if(panFres) panFres.style.display='none';
    if(panSez) panSez.style.display='';
    root.tagState.isOpen=true;
    var b=root.document.getElementById('btnOpenTaglio'); if(b) b.classList.add('active');
    tagSyncUI();
    if(typeof root.showStatus==='function') root.showStatus('Taglio: taglia la scansione per vedere dentro');
  }

  function closeTaglio(){
    var panMua=root.document.getElementById('panelMuaList'), panAng=root.document.getElementById('panelAngleList'), panAx=root.document.getElementById('panelAxisInfo'), panSez=root.document.getElementById('panelTaglio');
    if(panMua) panMua.style.display='';
    if(panAng) panAng.style.display='';
    if(panAx) panAx.style.display='';
    if(panSez) panSez.style.display='none';
    root.tagState.isOpen=false;
    var b=root.document.getElementById('btnOpenTaglio'); if(b) b.classList.remove('active');
  }

  // Allinea i controlli del pannello ai globali correnti del motore clip.
  function tagSyncUI(){
    var t=root.document.getElementById('tagToggle'); if(t) t.checked=!!root.synClipEnabled;
    var f=root.document.getElementById('tagFlip'); if(f) f.checked=!!root.synClipFlip;
    var p=root.document.getElementById('tagPos'); if(p) p.value=root.synClipPos;
    var pv=root.document.getElementById('tagPosVal'); if(pv) pv.textContent=root.synClipPos;
    var radios=root.document.querySelectorAll('#tagAxisRadio input[name="sezAxis"]');
    for(var i=0;i<radios.length;i++){ var r=radios[i]; r.checked=(r.value===root.synClipAxis); var lab=r.closest('label'); if(lab) lab.classList.toggle('active', r.value===root.synClipAxis); }
  }

  function tagOnToggle(on){
    if(on){ tagForceScanOpaque(); root.synClipEnabled=true; } else { root.synClipEnabled=false; }
    if(typeof synUpdateClipPlane==='function') synUpdateClipPlane();
  }
  function tagOnAxis(ax){ root.synClipAxis=ax; if(typeof synUpdateClipPlane==='function') synUpdateClipPlane(); tagSyncUI(); }
  function tagOnPos(v){ root.synClipPos=parseFloat(v); var pv=root.document.getElementById('tagPosVal'); if(pv) pv.textContent=v; if(typeof synUpdateClipPlane==='function') synUpdateClipPlane(); }
  function tagOnFlip(on){ root.synClipFlip=!!on; if(typeof synUpdateClipPlane==='function') synUpdateClipPlane(); }

  // Il cap stencil richiede la scansione OPACA: abilitare il taglio forza opaco e riallinea lo slider opacità a 100%.
  function tagForceScanOpaque(){
    if(root.scanMesh && root.scanMesh.material){
      var mats=Array.isArray(root.scanMesh.material)?root.scanMesh.material:[root.scanMesh.material];
      mats.forEach(function(mat){ mat.opacity=1.0; mat.transparent=false; mat._origOpacity=1.0; mat._origTransparent=false; mat.needsUpdate=true; });
    }
    if(typeof root.rebuildTree==='function') root.rebuildTree();
  }

  // ── Ri-esposizione: nomi bare su window (handler inline + call-site interni INVARIATI) + namespace SynClip ──
  var api = {
    synClipArr: synClipArr,
    synMakeStencilGroup: synMakeStencilGroup,
    synPositionCap: synPositionCap,
    synUpdateClipPlane: synUpdateClipPlane,
    synRebuildClip: synRebuildClip,
    openTaglio: openTaglio,
    closeTaglio: closeTaglio,
    tagSyncUI: tagSyncUI,
    tagOnToggle: tagOnToggle,
    tagOnAxis: tagOnAxis,
    tagOnPos: tagOnPos,
    tagOnFlip: tagOnFlip,
    tagForceScanOpaque: tagForceScanOpaque
  };
  for (var k in api) root[k] = api[k];
  root.SynClip = api;

})(window);
