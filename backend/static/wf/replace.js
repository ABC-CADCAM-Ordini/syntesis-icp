/*
 * wf/replace.js — workflow REPLACE-IT di Synthesis-ICP (Fase 6e modularizzazione, 8.92.0).
 * Quinto file estratto in wf/ (dopo fresabilita, tree, report-analizza, sostituire).
 *
 * CONTRATTO: 92 function declaration del dominio Replace-iT — accoppia CAD SORGENTE (brand scansionato)
 * alla scansione, il SOSTITUTO IPD eredita via origine condivisa; cascata librerie Marca/Modello/
 * Diametro, seeding 3-punti, allineamento, raffina client/server (ICP point-to-plane), export STL,
 * albero scena dedicato, taglio scansione adattivo, anteprima 3D trackball. Nomi bare globali invariati.
 * Estrazione "functions-only" (pattern 6a-6d): lo STATO resta nel monolite (§REPLACE-IT: replaceMesh/
 * replaceOriginalGeo/replacePlacementMode/replacePickDownX/Y/Shift/replacePlaced/replaceCounter/replaceActiveNum/
 * replaceLibs/replaceCurrentLibId/Detail/Type/replaceSourceType/replaceSubstType/replaceMarkerGeoCache/replacePaletteIdx/
 * replaceSeed/replacePending/replacePreviewMoveH/UpH/replacePreviewCam) — letto anche dal listener
 * pointerdown del MAIN (replacePickDown*) e da selectWorkflow. Banner §REPLACE-IT/§REPLACE-CUT-SCAN
 * restano nel monolite (check_anchors).
 *
 * VINCOLO CRITICO: la FORMULA NDC del picking 3-punti (clientX-rect.left)/rect.width vive dentro le fn
 * (replacePreviewPickAt ecc.) ed è preservata PER COSTRUZIONE (byte-identica). NON reintrodurre mai
 * offsetX/clientWidth (regressione 8.59.2 revocata).
 * CARICAMENTO: <script src> classico NON-strict in testa (dopo wf/sostituire.js), PRIMA del MAIN.
 * GATE: scripts/gate/replace/gate.mjs (92 md5-verbatim + esposizione + residuo stato/banner + wiring).
 */

function replaceShowStatus(msg, isError){
  var s = document.getElementById('replaceStatus');
  if(!s) return;
  s.style.display = '';
  s.textContent = msg;
  s.style.color = isError ? '#EF4444' : 'var(--gray)';
}

// 2b-1.4: marcatore NUMERATO (sprite billboard, sempre leggibile) per i punti del
// seme — disco colorato + cifra 1/2/3, uguale su anteprima-marker e scansione.
function _replaceNumSprite(n, colorHex, worldSize){
  var c = document.createElement('canvas'); c.width = 64; c.height = 64;
  var x = c.getContext('2d');
  x.fillStyle = '#' + ('000000' + (colorHex >>> 0).toString(16)).slice(-6);
  x.beginPath(); x.arc(32, 32, 29, 0, 2 * Math.PI); x.fill();
  x.lineWidth = 4; x.strokeStyle = '#ffffff'; x.stroke();
  x.fillStyle = '#ffffff'; x.font = 'bold 38px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(String(n), 32, 35);
  var tex = new THREE.CanvasTexture(c); tex.needsUpdate = true;
  var mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true });
  var sp = new THREE.Sprite(mat); sp.renderOrder = 10003;
  var s = worldSize || (REPLACE_DOT_R * 3);
  sp.scale.set(s, s, 1);
  sp.userData.isReplace = true;
  return sp;
}

// Rimuove+dispone un dot/sprite del seme (gestisce sia Mesh che Sprite, e la
// texture della SpriteMaterial). Funziona per figli della scena o di una mesh.
function _replaceDisposeDot(d){
  if(!d) return;
  if(d.parent) d.parent.remove(d); else scene.remove(d);
  if(d.geometry) d.geometry.dispose();
  if(d.material){ if(d.material.map) d.material.map.dispose(); d.material.dispose(); }
}

// 8.32.0: etichetta sprite per gli assi origine (X0/Y0/Z0), depthTest off.
function _replaceAxisLabel(text, colorHex){
  var c = document.createElement('canvas'); c.width = 64; c.height = 32;
  var x = c.getContext('2d');
  x.font = 'bold 24px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.lineWidth = 5; x.strokeStyle = 'rgba(0,0,0,0.65)'; x.strokeText(text, 32, 17);
  x.fillStyle = '#' + ('000000' + (colorHex >>> 0).toString(16)).slice(-6); x.fillText(text, 32, 17);
  var tex = new THREE.CanvasTexture(c); tex.needsUpdate = true;
  var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true }));
  sp.renderOrder = 10004; sp.scale.set(1.3, 0.65, 1); sp.userData.isReplace = true;
  return sp;
}
// 8.32.0: terna ORIGINE (x0/y0/z0) del frame CAD condiviso (sorgente+sostituto).
// 3 assi colorati (X rosso / Y verde / Z blu) dall'origine LOCALE (0,0,0) del group
// + sferetta all'origine + etichette. depthTest off -> sempre visibile. Figlio del group.
function _replaceMakeOriginAxes(len){
  var L = len || 3.2;
  var g = new THREE.Group(); g.name = 'replace-origin';
  var defs = [[new THREE.Vector3(L,0,0), 0xFF3B30, 'X0'], [new THREE.Vector3(0,L,0), 0x34C759, 'Y0'], [new THREE.Vector3(0,0,L), 0x0A84FF, 'Z0']];
  for(var i = 0; i < defs.length; i++){
    var d = defs[i];
    var lgeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,0), d[0]]);
    var ln = new THREE.Line(lgeo, new THREE.LineBasicMaterial({ color: d[1], depthTest: false, transparent: true }));
    ln.renderOrder = 10003; ln.userData.isReplace = true; g.add(ln);
    var lab = _replaceAxisLabel(d[2], d[1]); lab.position.copy(d[0]).multiplyScalar(1.14); g.add(lab);
  }
  var sph = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true }));
  sph.renderOrder = 10003; sph.userData.isReplace = true; g.add(sph);
  g.userData.isReplace = true; g.userData.replaceRole = 'origin';
  return g;
}
// 8.32.0: applica lo stato vista (sorgente|sostituto + origine on/off) al group di un record.
function _replaceApplyView(p){
  if(!p) return;
  // 8.33.0: MADRE (sorgente) e FIGLIO (sostituto) hanno visibilita' INDIPENDENTE -> entrambi
  // visibili insieme di default (madre accoppiata alla scansione, figlio che eredita la posa).
  if(p.meshSrc) p.meshSrc.visible = (p.showSrc !== false);
  if(p.meshSub) p.meshSub.visible = (p.showSub !== false);
  if(p.originAxes) p.originAxes.visible = !!p.showOrigin;
}
// 8.32.0: dispone i material/texture/geometrie NON-cache di un group marker. Le mesh
// marker (geoSub/geoSrc) hanno geometria in CACHE -> solo material; la terna origine
// (geometrie+sprite proprie) -> dispose completo.
function _replaceDisposeGroup(group){
  if(!group) return;
  (group.children || []).forEach(function(c){
    if(c.userData && c.userData.replaceRole === 'origin'){
      c.traverse(function(o){
        if(o.geometry) o.geometry.dispose();
        if(o.material){ if(o.material.map) o.material.map.dispose(); o.material.dispose(); }
      });
    } else if(c.material){
      // 8.39.0: l'overlay wireframe (modalita' "both") e' figlio della mesh -> disponilo
      // qui, altrimenti resta orfano (la geometria marker e' cache condivisa e NON si disposa).
      if(c.userData && c.userData.wireframeOverlay){
        var _wo = c.userData.wireframeOverlay;
        if(_wo.geometry) _wo.geometry.dispose();
        if(_wo.material) _wo.material.dispose();
        c.userData.wireframeOverlay = null;
      }
      // 8.43.0 (review): se la geometria e' OWNED (sorgente TAGLIATO, non la cache condivisa),
      // disponila qui -> evita leak alla cancellazione/abbandono del marker (delete + pending).
      if(c.geometry && c.geometry.userData && c.geometry.userData.replaceOwned){ try { c.geometry.dispose(); } catch(e){} }
      if(c.material.map) c.material.map.dispose();
      c.material.dispose();
    }
  });
}
// 8.33.0: visibilita' INDIPENDENTE di MADRE (sorgente) e FIGLIO (sostituto) sul marker
// PENDING (finestra guida) — which='src'|'sub'.
function replaceSetPendingMeshVis(which, on){
  if(!replacePending) return;
  if(which === 'src') replacePending.showSrc = !!on; else replacePending.showSub = !!on;
  _replaceApplyView(replacePending);
}
function replaceTogglePendingOrigin(on){
  if(!replacePending) return;
  replacePending.showOrigin = !!on; _replaceApplyView(replacePending);
}
// 8.33.0: visibilita' madre/figlio per i marker CONFERMATI (albero scena).
function replaceSetMarkerMeshVis(num, which, on){
  for(var i = 0; i < replacePlaced.length; i++){
    if(replacePlaced[i].num === num){
      if(which === 'src') replacePlaced[i].showSrc = !!on; else replacePlaced[i].showSub = !!on;
      _replaceApplyView(replacePlaced[i]); break;
    }
  }
}
function replaceToggleMarkerOrigin(num, on){
  for(var i = 0; i < replacePlaced.length; i++){
    if(replacePlaced[i].num === num){ replacePlaced[i].showOrigin = !!on; _replaceApplyView(replacePlaced[i]); break; }
  }
}
// 8.38.0: CAMBIA FIGLIO dall'albero — richiama un altro IPD della stessa MADRE (stessa libreria/
// origine condivisa) senza ri-accoppiare: fetcha il nuovo STL e fa lo SWAP della sola geometria del
// figlio (meshSub) alla STESSA posa. Madre, terna e posa restano. La vecchia geometria e' in cache
// (replaceMarkerGeoCache, condivisa) -> NON va disposta.
function replaceSwapFiglio(num, ord){
  var p = null;
  for(var i = 0; i < replacePlaced.length; i++){ if(replacePlaced[i].num === num){ p = replacePlaced[i]; break; } }
  if(!p || !p.meshSub) return;
  if(ord === p.typeOrd) return;   // nessun cambio
  var t = (p.libTypes || []).filter(function(x){ return x.ord === ord; })[0];
  if(!t || !t.sha){ replaceShowStatus('Type figlio non valido.', true); return; }
  // 8.38.0 (review): token monotono per-record anti-stale -> due swap rapidi (uno in cache, uno
  // in rete) non si scambiano l'ordine; e re-check che il marker esista ancora (swap durante delete).
  var _g = (p._swapGen = (p._swapGen || 0) + 1);
  replaceShowStatus('Carico il sostituto «' + t.label + '»…');
  replaceFetchMarkerGeo(t.sha).then(function(geo){
    if(replacePlaced.indexOf(p) < 0 || _g !== p._swapGen) return;   // marker eliminato o swap piu' recente vinto -> scarta
    if(!geo){ replaceShowStatus('Impossibile caricare il sostituto.', true); replaceRebuildPlacedList(); return; }   // re-sync dropdown sul type vecchio
    p.meshSub.geometry = geo;   // swap geometria figlio (stessa posa via origine condivisa)
    p.typeOrd = ord; p.markerSha = t.sha; p.typeLabel = t.label;
    // (la posa/asse non cambiano -> il "Taglia scansione" resta valido, niente rebuild)
    replaceRebuildPlacedList();   // ricostruisce albero + lista pannello
    replaceShowStatus('Impianto #' + num + ': FIGLIO cambiato in «' + t.label + '» (stessa posa, niente ri-accoppiamento).');
  }).catch(function(st){ replaceShowStatus('Sostituto: ' + _replaceFetchErrMsg(st), true); if(replacePlaced.indexOf(p) >= 0) replaceRebuildPlacedList(); });   // re-sync dropdown su errore
}

// --- DOT marcatore del punto di riferimento (clone idioma ensurePivotMarker) ---
// Sfera rossa piccola, MeshBasicMaterial depthTest:false -> sempre visibile sopra
// le mesh. Persistente (niente fade). Usata sia per i dot dei marker piazzati sia
// (lazy) per il dot di hover.
// ===== 2b-1.2: ANTEPRIMA INTERATTIVA (secondo renderer) + SEEDING A 3 PUNTI =====
// L'anteprima e' un piccolo viewport Three PROPRIO (canvas #replacePreviewCanvas),
// indipendente dal viewer principale. La camera orbita attorno all'origine; la mesh
// del marker (dalla cache) e' offsettata cosi' che il baricentro sia all'origine ->
// orbit pulito, e worldToLocal sui click restituisce coord nel frame LOCALE canonico
// del marker. I dot dei 3 punti marker sono FIGLI della mesh (seguono l'orbita).
function replacePreviewRender(){
  if(replacePreviewRenderer && replacePreviewScene && replacePreviewCamera)
    replacePreviewRenderer.render(replacePreviewScene, replacePreviewCamera);
}
function replacePreviewUpdateCam(){
  if(!replacePreviewCamera || !replacePreviewCam || !replacePreviewCam.q) return;
  // 2b-3e: orbita LIBERA (trackball a quaternioni). Camera a distanza rad orientata
  // dal quaternione q (guarda l'origine), NESSUN clamp polare -> ruoti il marker in
  // qualsiasi direzione, anche oltre i poli. Il mesh resta fermo all'origine.
  var q = replacePreviewCam.q;
  replacePreviewCamera.position.set(0, 0, replacePreviewCam.rad).applyQuaternion(q);
  replacePreviewCamera.quaternion.copy(q);
  replacePreviewCamera.updateMatrixWorld();
}

function _replaceTrimAxisVec(axisObj){
  var ax = new THREE.Vector3((axisObj && axisObj.x) || 0, (axisObj && axisObj.y) || 0, (axisObj && axisObj.z) || 0);
  if(ax.lengthSq() < 1e-9) ax.set(0, 0, 1);
  return ax.normalize();
}
function replaceGeoAxialRange(geo, axisObj){
  var ax = _replaceTrimAxisVec(axisObj);
  var pos = geo.attributes.position.array, n = pos.length / 3, lo = Infinity, hi = -Infinity;
  for(var i = 0; i < n; i++){
    var a = pos[i*3]*ax.x + pos[i*3+1]*ax.y + pos[i*3+2]*ax.z;
    if(a < lo) lo = a; if(a > hi) hi = a;
  }
  if(!isFinite(lo)){ lo = 0; hi = 0; }
  return { lo: lo, hi: hi };
}
// nuova BufferGeometry coi SOLI triangoli col centroide a coord assiale >= soglia (rimuove la
// parte apicale vicino all'origine, tiene il cap occlusale = alta coord assiale su axis_occlusal).
function replaceTrimGeoAlongAxis(geo, axisObj, threshold){
  if(!geo || !geo.attributes || !geo.attributes.position) return geo;
  if(geo.index){ try { geo = geo.toNonIndexed(); } catch(e){} }   // 8.43.0 (review): il taglio assume non-indicizzata (9 float/tri)
  var ax = _replaceTrimAxisVec(axisObj);
  var pos = geo.attributes.position.array;
  var nrm = geo.attributes.normal ? geo.attributes.normal.array : null;
  if(nrm && nrm.length < pos.length) nrm = null;   // 8.43.0 (review): normal disallineata -> ricomputa
  var nTri = pos.length / 9, kp = [], kn = nrm ? [] : null;
  for(var i = 0; i < nTri; i++){
    var o = i*9;
    var cx = (pos[o]+pos[o+3]+pos[o+6])/3, cy = (pos[o+1]+pos[o+4]+pos[o+7])/3, cz = (pos[o+2]+pos[o+5]+pos[o+8])/3;
    if((cx*ax.x + cy*ax.y + cz*ax.z) < threshold) continue;
    for(var v = 0; v < 9; v++){ kp.push(pos[o+v]); if(kn) kn.push(nrm[o+v]); }
  }
  var ng = new THREE.BufferGeometry();
  ng.setAttribute('position', new THREE.Float32BufferAttribute(kp, 3));
  if(kn && kn.length) ng.setAttribute('normal', new THREE.Float32BufferAttribute(kn, 3));
  else ng.computeVertexNormals();
  if(!ng.userData) ng.userData = {};
  ng.userData.replaceOwned = true;   // 8.43.0 (review): geometria OWNED -> da disporre (dispose group/preview)
  return ng;
}
function _replaceTrimThresholdFromSlider(val){
  var f = Math.max(0, Math.min(95, parseFloat(val) || 0)) / 100;
  return replaceSrcTrim.lo + f * (replaceSrcTrim.hi - replaceSrcTrim.lo);
}
// handler slider: ri-taglia il sorgente e aggiorna l'anteprima LIVE (il marker non si sposta:
// l'offset baricentro resta quello del geo PIENO; sparisce solo la parte tagliata).
function replaceOnSrcTrim(val){
  if(!replaceSrcTrim.full || !replacePreviewMesh) return;
  replaceSrcTrim.threshold = _replaceTrimThresholdFromSlider(val);
  var f = parseFloat(val) || 0;
  var ng = (f <= 0.5) ? replaceSrcTrim.full : replaceTrimGeoAlongAxis(replaceSrcTrim.full, replaceSrcTrim.axis, replaceSrcTrim.threshold);
  if(replacePreviewMesh.geometry && replacePreviewMesh.geometry !== replaceSrcTrim.full){ try { replacePreviewMesh.geometry.dispose(); } catch(e){} }
  replacePreviewMesh.geometry = ng;
  // 8.43.0 (review): ri-tagliare dopo aver gia' piazzato dei punti marker li scarta (potrebbero
  // cadere sulla parte rimossa) -> si ripicca sul nuovo cap.
  if(replaceSeed.markerPts && replaceSeed.markerPts.length > 0){
    (replaceSeed.markerDots || []).forEach(_replaceDisposeDot);
    replaceSeed.markerPts = []; replaceSeed.markerDots = [];
    replaceSeedUpdateUI();
  }
  replacePreviewRender();
  var lbl = document.getElementById('replaceTrimLbl');
  if(lbl) lbl.textContent = (f <= 0.5) ? 'intero' : ('\u2212' + Math.round(f) + '%');
}
function replacePreviewInit(geo){
  var canvas = document.getElementById('replacePreviewCanvas');
  var box = document.getElementById('replacePreviewBox');
  if(!canvas || !geo) return;
  if(box) box.style.display = '';
  replacePreviewDispose();
  var w = canvas.clientWidth || 230, h = canvas.clientHeight || 300;
  replacePreviewRenderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
  replacePreviewRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  replacePreviewRenderer.setSize(w, h, false);
  replacePreviewScene = new THREE.Scene();
  replacePreviewScene.add(new THREE.AmbientLight(0xffffff, 0.75));
  var key = new THREE.DirectionalLight(0xffffff, 0.85); key.position.set(1, 1.2, 2);
  replacePreviewScene.add(key);
  var mat = new THREE.MeshPhongMaterial({ color: 0xBFD4E6, specular: 0x223344, shininess: 30, side: THREE.DoubleSide });
  replacePreviewMesh = new THREE.Mesh(geo, mat);
  geo.computeBoundingSphere();
  var bs = geo.boundingSphere, rad = (bs && bs.radius) || 10;
  if(bs) replacePreviewMesh.position.copy(bs.center).multiplyScalar(-1); // baricentro -> origine
  replacePreviewScene.add(replacePreviewMesh);
  // 8.43.0 (F2): inizializza il contesto di taglio del sorgente (asse occlusale dalla libreria,
  // fallback +Z); reset slider/etichetta a "intero". Il taglio agisce nel frame CAD (origine 0,0,0).
  replaceSrcTrim.full = geo;
  // 8.43.0 (review): orienta l'asse di taglio verso il CAP. axis_occlusal dovrebbe puntare
  // occlusalmente (origine/platform -> cap); se una libreria lo desse invertito il taglio
  // terrebbe l'apicale. Flip robusto: l'asse deve puntare verso il baricentro del marker
  // (la massa e' dal lato del cap rispetto all'origine CAD 0,0,0).
  var _trimAx = _replaceTrimAxisVec((replaceCurrentDetail && replaceCurrentDetail.axis_occlusal) || { x: 0, y: 0, z: 1 });
  var _ctr = (geo.boundingSphere && geo.boundingSphere.center) ? geo.boundingSphere.center : new THREE.Vector3();
  if(_trimAx.dot(_ctr) < 0) _trimAx.multiplyScalar(-1);
  replaceSrcTrim.axis = { x: _trimAx.x, y: _trimAx.y, z: _trimAx.z };
  var _ar = replaceGeoAxialRange(geo, replaceSrcTrim.axis);
  replaceSrcTrim.lo = _ar.lo; replaceSrcTrim.hi = _ar.hi; replaceSrcTrim.threshold = _ar.lo;
  var _ts = document.getElementById('replaceTrimSlider'); if(_ts) _ts.value = 0;
  var _tl = document.getElementById('replaceTrimLbl'); if(_tl) _tl.textContent = 'intero';
  replacePreviewCamera = new THREE.PerspectiveCamera(40, w / h, Math.max(rad * 0.02, 0.05), rad * 100);
  replacePreviewCam = { q: new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.35, 0.6, 0, 'XYZ')), rad: rad * 3.4 };
  replacePreviewUpdateCam();
  replacePreviewAttachInput(canvas);
  replacePreviewRender();
}
function replacePreviewAttachInput(canvas){
  var down = false, moved = false, sx = 0, sy = 0, shiftAtDown = false;
  canvas._replDown = function(e){ down = true; moved = false; sx = e.clientX; sy = e.clientY; shiftAtDown = !!e.shiftKey; };   // 8.54.0: Shift al press
  replacePreviewMoveH = function(e){
    if(!down) return;
    var dx = e.clientX - sx, dy = e.clientY - sy;
    if(Math.abs(dx) + Math.abs(dy) > 3) moved = true;
    if(replacePreviewCam && replacePreviewCam.q){
      // trackball libero: rotazioni attorno agli assi LOCALI della camera (post-moltiplica
      // -> niente blocco ai poli, ruoti come vuoi). yaw=dx attorno all'up, pitch=dy al right.
      var qx = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -dx * 0.01);
      var qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -dy * 0.01);
      replacePreviewCam.q.multiply(qx).multiply(qy).normalize();
    }
    sx = e.clientX; sy = e.clientY;
    replacePreviewUpdateCam(); replacePreviewRender();
  };
  replacePreviewUpH = function(e){
    if(down && !moved){
      if(shiftAtDown) replacePreviewPickAt(e.clientX, e.clientY);   // 8.54.0: Shift catturato al press posa, trascina ruota
      else replaceShowStatus('Tieni premuto Shift e clicca per posare il punto sul marker · trascina per ruotare.');
    }
    down = false;
  };
  canvas.addEventListener('mousedown', canvas._replDown);
  window.addEventListener('mousemove', replacePreviewMoveH);
  window.addEventListener('mouseup', replacePreviewUpH);
  replaceSeedUpdateUI();   // 2b-3b: testo-passo iniziale nella finestra guida appena aperta
}
function replacePreviewPickAt(clientX, clientY){
  if(!replacePreviewRenderer || !replacePreviewMesh) return;
  if(replaceSeed.phase !== 'pickMarker' || replaceSeed.markerPts.length >= REPLACE_SEED_N) return;
  var canvas = replacePreviewRenderer.domElement;
  var rect = canvas.getBoundingClientRect();
  var mouse = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  var rc = new THREE.Raycaster(); rc.setFromCamera(mouse, replacePreviewCamera);
  var hits = rc.intersectObject(replacePreviewMesh);
  if(!hits.length){ replaceShowStatus('Clicca sulla superficie del marker.', true); return; }
  var local = replacePreviewMesh.worldToLocal(hits[0].point.clone()); // frame locale canonico
  var idx = replaceSeed.markerPts.length;
  replaceSeed.markerPts.push(local.clone());
  // dot NUMERATO (sprite) figlio della mesh -> segue l'orbita, cifra sempre leggibile.
  var bs = replacePreviewMesh.geometry.boundingSphere;
  var sz = (bs && bs.radius) ? bs.radius * 0.22 : REPLACE_DOT_R * 3;
  var dot = _replaceNumSprite(idx + 1, REPLACE_SEED_COLORS[idx], sz);
  dot.position.copy(local);
  replacePreviewMesh.add(dot);
  replaceSeed.markerDots.push(dot);
  replacePreviewRender();
  if(replaceSeed.markerPts.length >= REPLACE_SEED_N){
    // rifiuto terna MARKER quasi collineare (orientamento mal vincolato): rifai il 3°
    var mp = replaceSeed.markerPts;
    var mArea = 0.5 * mp[1].clone().sub(mp[0]).cross(mp[2].clone().sub(mp[0])).length();
    var mEdge = Math.max(mp[0].distanceTo(mp[1]), mp[1].distanceTo(mp[2]), mp[2].distanceTo(mp[0]));
    if(mArea < 0.08 * mEdge * mEdge){
      replaceSeed.markerPts.pop(); _replaceDisposeDot(replaceSeed.markerDots.pop()); replacePreviewRender();
      replaceShowStatus('I 3 punti sul MARKER sono troppo allineati: scegli il 3° punto piu\' lontano dagli altri due.', true);
      replaceSeedUpdateUI();
      return;
    }
    replaceSeed.phase = 'pickScan';
    replaceShowStatus('Ora posa i 3 punti GEMELLI sulla scansione con SHIFT+CLIC, nello stesso ordine: 1 rosso, 2 verde, 3 blu. Trascina (senza Shift) per ruotare.');
  }
  replaceSeedUpdateUI();
}
function replacePreviewDispose(){
  var canvas = document.getElementById('replacePreviewCanvas');
  if(canvas && canvas._replDown){ canvas.removeEventListener('mousedown', canvas._replDown); canvas._replDown = null; }
  if(replacePreviewMoveH){ window.removeEventListener('mousemove', replacePreviewMoveH); replacePreviewMoveH = null; }
  if(replacePreviewUpH){ window.removeEventListener('mouseup', replacePreviewUpH); replacePreviewUpH = null; }
  // i markerDots sono figli della mesh -> rimossi/disposti qui (la GEOMETRIA marker
  // resta nella cache, NON la disposo).
  (replaceSeed.markerDots || []).forEach(_replaceDisposeDot);
  replaceSeed.markerDots = [];
  if(replacePreviewMesh){
    // 8.43.0 (F2): se l'anteprima mostra una geometria TAGLIATA (owned, non la full in cache), disponila
    if(replacePreviewMesh.geometry && replacePreviewMesh.geometry !== replaceSrcTrim.full){ try { replacePreviewMesh.geometry.dispose(); } catch(e){} }
    if(replacePreviewMesh.material) replacePreviewMesh.material.dispose(); replacePreviewMesh = null;
  }
  replaceSrcTrim.full = null; replaceSrcTrim.threshold = 0;
  if(replacePreviewRenderer){ try { replacePreviewRenderer.dispose(); } catch(e){} replacePreviewRenderer = null; }
  replacePreviewScene = null; replacePreviewCamera = null; replacePreviewCam = null;
}

// Azzera il seme in corso (dot anteprima + dot scansione non ancora trasferiti),
// torna in idle e disarma il placement. Usato anche dal bottone "Ricomincia".
function replaceSeedClear(keepSource){
  // marker in anteprima posa non confermato (Ricomincia da pendingConfirm)
  replaceSeedGen++;   // invalida un eventuale fetch marker in volo
  if(replacePending){
    if(replacePending.group){
      _replaceDisposeGroup(replacePending.group);   // 8.32.0: mesh (cache) + sorgente + terna origine
      scene.remove(replacePending.group);
    }
    replacePending = null;
  }
  (replaceSeed.markerDots || []).forEach(_replaceDisposeDot);
  (replaceSeed.scanDots || []).forEach(_replaceDisposeDot);
  replaceSeed.markerPts = []; replaceSeed.scanPts = []; replaceSeed.scanNormals = []; replaceSeed.markerDots = []; replaceSeed.scanDots = [];
  replaceSeed.phase = 'idle';
  replacePlacementMode = false;
  if(typeof renderer !== 'undefined' && renderer && renderer.domElement) renderer.domElement.style.cursor = 'default';
  if(replacePreviewRenderer) replacePreviewRender();
  replaceSeedUpdateUI();
}

// Annulla l'ultimo punto della fase corrente.
function replaceSeedUndo(){
  // da pendingConfirm: annullare = scartare la posa di anteprima (il group),
  // tornare a pickScan coi dot scansione INTATTI (vivono in replaceSeed), poi
  // ripiccare l'ultimo gemello.
  if(replaceSeed.phase === 'pendingConfirm'){
    if(replacePending && replacePending.group){
      _replaceDisposeGroup(replacePending.group);   // 8.32.0
      scene.remove(replacePending.group);
    }
    replacePending = null;
    replaceSeed.phase = 'pickScan';
  }
  if(replaceSeed.phase === 'pickScan' && replaceSeed.scanPts.length > 0){
    replaceSeed.scanPts.pop();
    replaceSeed.scanNormals.pop();
    _replaceDisposeDot(replaceSeed.scanDots.pop());
  } else if(replaceSeed.markerPts.length > 0){
    replaceSeed.phase = 'pickMarker';
    replaceSeed.markerPts.pop();
    _replaceDisposeDot(replaceSeed.markerDots.pop());
    replacePreviewRender();
  }
  replaceSeedUpdateUI();
}

function replaceSeedUpdateUI(){
  var ph = replaceSeed.phase;
  // 8.36.1 (fix sovrapposizione finestra guida ↔ albero scena, segnalato dall'utente):
  // la finestra guida #replacePreviewBox vive SOLO durante il piazzamento attivo
  // (pickMarker/pickScan/pendingConfirm); quando idle si nasconde -> l'Albero scena torna
  // pienamente cliccabile (prima la guida z25 copriva l'albero z8 e si bloccavano a vicenda).
  // Durante il piazzamento l'albero e' limitato al TOP (riservando in basso lo spazio della
  // guida: ~42vh canvas + ~190px chrome) cosi' non finisce sotto la finestra; quando idle
  // riprende l'altezza piena. Tutto gated su analysisMode==='replace' (zero impatto sugli altri).
  if(typeof analysisMode !== 'undefined' && analysisMode === 'replace'){
    var _placing = (ph === 'pickMarker' || ph === 'pickScan' || ph === 'pendingConfirm');
    try { if(typeof controls !== 'undefined' && controls) controls.noInertia = _placing; } catch(e){}   // 8.56.1: stop inerzia camera durante la posa
    var _gbox = document.getElementById('replacePreviewBox');
    if(_gbox) _gbox.style.display = _placing ? '' : 'none';
    var _lp = document.getElementById('layersPanel');
    if(_lp) _lp.style.maxHeight = _placing ? 'max(120px, calc(100% - 28px - 42vh - 190px))' : 'calc(100% - 28px)';
    // 8.37.0 (protezione seme, fix audit): durante il piazzamento DISABILITA i dropdown libreria/type
    // -> cambiarli a meta' azzererebbe in silenzio i punti gia' cliccati (replaceSeedClear). Riabilitati a idle.
    ['replaceMarcaSelect','replaceModelloSelect','replaceDiamSelect','replaceSourceTypeSelect','replaceTypeSelect'].forEach(function(_id){
      var _s = document.getElementById(_id); if(_s){ _s.disabled = _placing; _s.style.opacity = _placing ? '0.55' : ''; _s.style.cursor = _placing ? 'not-allowed' : ''; }
    });
  }
  var c = document.getElementById('replaceSeedCounter');
  if(c){
    if(ph === 'pickMarker') c.textContent = '① Marker: ' + replaceSeed.markerPts.length + '/3';
    else if(ph === 'pickScan') c.textContent = '② Scansione: ' + replaceSeed.scanPts.length + '/3';
    else if(ph === 'pendingConfirm') c.textContent = '③ Anteprima posa';
    else c.textContent = '';
  }
  // Conferma: posa di anteprima pendente (3-punti 'pendingConfirm').
  var cb = document.getElementById('replaceBtnConfirm');
  if(cb) cb.style.display = (ph === 'pendingConfirm') ? '' : 'none';
  // 8.33.0/8.34.1: riga "Vista" (checkbox Madre + Figlio + origine) durante l'ispezione (pendingConfirm).
  var _viewPh = (ph === 'pendingConfirm');
  var vr = document.getElementById('replaceViewRow');
  if(vr) vr.style.display = (_viewPh && replacePending && replacePending.meshSrc) ? 'flex' : 'none';
  if(_viewPh && replacePending && replacePending.meshSrc){
    var cvs = document.getElementById('replaceViewSrc'); if(cvs) cvs.checked = (replacePending.showSrc !== false);
    var cvb = document.getElementById('replaceViewSub'); if(cvb) cvb.checked = (replacePending.showSub !== false);
    var voc = document.getElementById('replaceViewOrigin'); if(voc) voc.checked = !!replacePending.showOrigin;
  }
  // "Annulla punto": durante la raccolta dei 3 punti e in pendingConfirm (scarta la posa 3-punti).
  var bu = document.getElementById('replaceSeedUndo');
  if(bu) bu.style.display = (ph === 'pickMarker' || ph === 'pickScan' || ph === 'pendingConfirm') ? '' : 'none';
  replaceGuideRender();   // 2b-3b: aggiorna titolo impianto, badge passi, testo-passo nella finestra guida
}

// 2b-3b: render della finestra guida (titolo impianto + badge dei 3 passi + testo-passo
// dinamico). Riflette replaceSeed.phase. Tutti gli elementi null-checked (no-op se la
// finestra non e' nel DOM).
function replaceGuideRender(){
  var ph = replaceSeed.phase;
  var titleEl = document.getElementById('replaceGuideTitle');
  if(titleEl) titleEl.textContent = 'Impianto #' + (replacePlaced.length + 1);
  // 8.36.0: flusso a 3 punti diretto — step ① Marker (pickMarker) → ② Scansione (pickScan) →
  // ③ Conferma (pendingConfirm). idle→1 (fallback).
  var cur = (ph === 'pickMarker' || ph === 'idle') ? 1 : (ph === 'pickScan') ? 2 : 3;
  var stepsEl = document.getElementById('replaceGuideSteps');
  if(stepsEl){
    var defs = [['1', 'Marker'], ['2', 'Scansione'], ['3', 'Conferma']];
    var html = '';
    for(var i = 0; i < defs.length; i++){
      var on = (i + 1) === cur;
      html += '<span style="flex:1;text-align:center;padding:3px 2px;border-radius:4px;font-weight:700;' +
              (on ? 'background:var(--fill-confirm);color:var(--dark);' : 'background:var(--pearl);color:var(--gray);') + '">' +
              defs[i][0] + ' ' + defs[i][1] + '</span>';
    }
    stepsEl.innerHTML = html;
  }
  var stepEl = document.getElementById('replaceGuideStep');
  if(stepEl){
    var C = '<span style="color:#FF3B30;font-weight:700">1</span>·<span style="color:#00C853;font-weight:700">2</span>·<span style="color:#2979FF;font-weight:700">3</span>';
    var t;
    if(ph === 'pickMarker') t = '<b>① Marker</b> — <b>SHIFT+CLIC</b> sul punto <b>' + (replaceSeed.markerPts.length + 1) + ' di 3</b> sul <b>MARKER</b> nell\'anteprima qui sopra (ordine ' + C + '). Trascina (senza Shift) per ruotare. Scegli 3 punti ben distanti tra loro (no in linea).';
    else if(ph === 'pickScan') t = '<b>② Scansione</b> — <b>SHIFT+CLIC</b> sul punto <b>' + (replaceSeed.scanPts.length + 1) + ' di 3</b> <b>GEMELLO</b> sulla <b>scansione</b> (viewport grande), <b>stesso ordine</b> ' + C + ' del marker. Trascina (senza Shift) per ruotare. <b>Annulla punto</b> se sbagli.';
    else if(ph === 'pendingConfirm') t = '<b>③ Conferma</b> — posa pronta: <b>madre</b> (grigio-blu) + <b>figlio</b> + <b>origine</b>. Controlla l\'incastro, poi <b>✓ Conferma</b>. <b>Annulla punto</b> per correggere o <b>Ricomincia</b> da capo.';
    else t = 'Scegli i type <b>SORGENTE</b> + <b>SOSTITUTO</b>, poi <b>+ Nuovo impianto</b> per allineare con 3 punti.';
    stepEl.innerHTML = t;
  }
}

// --- FETCH /api/rit/* (Bearer da localStorage, pattern /api/place-mua) ---
function _replaceAuthHeaders(){
  var token = '';
  try { token = localStorage.getItem('syntesis_token') || ''; } catch(e){}
  return { 'Authorization': 'Bearer ' + token };
}
// 8.37.0 (fix audit): messaggio leggibile per i fetch /api/rit/* (st = HTTP status numerico o Error di rete).
function _replaceFetchErrMsg(st){
  if(st === 401 || st === 403) return 'sessione scaduta o non autorizzato — rifai il login.';
  if(st === 404) return 'risorsa non trovata (libreria/marker).';
  if(typeof st === 'number') return 'errore server (' + st + ').';
  return 'errore di rete — controlla la connessione e riprova.';
}

function replaceFetchLibraries(){
  return fetch('/api/rit/libraries', { headers: _replaceAuthHeaders() })
    .then(function(r){ if(!r.ok) throw r.status; return r.json(); })
    .then(function(d){ replaceLibs = (d && d.libraries) || []; replaceBuildCascade(); })
    .catch(function(st){ replaceShowStatus('Librerie: ' + _replaceFetchErrMsg(st), true); });
}

// 8.52.0 cascata Marca>Modello>Diametro: ogni livello filtra il successivo;
// l'ultimo (Ø) atterra sulla libreria e ne carica i type (madre/figlio).
function _replaceLibKey(L, field){
  return field === 'marca' ? (L.marca || '(altre)')
       : field === 'modello' ? (L.modello || '(—)')
       : (L.diametro || '(—)');
}
// 8.53.0: identità libreria per l'etichetta impianto = "Marca Modello Ømm" (es. "Megagen AnyRidge 4mm").
// Stringa vuota se l'impianto non ha marca/modello/diametro (libreria legacy non assegnata)
// -> i siti chiamanti ricadono sul vecchio typeLabel/"impianto".
function _replaceLibId(rec){
  if(rec && rec.marca && rec.modello && rec.diametro != null && rec.diametro !== ''){
    var d = ('' + rec.diametro).replace(/[Øø⌀]/g, '').trim().replace(/\.0+$/, '');
    if(!d) return '';   // 8.53.0 review: diametro solo-simbolo (Ø) -> evita "marca modello mm", ricade sul fallback
    return rec.marca + ' ' + rec.modello + ' ' + d + 'mm';
  }
  return '';
}
function replaceBuildCascade(){
  var msel = document.getElementById('replaceMarcaSelect');
  if(!msel) return;
  var marche = [];
  replaceLibs.forEach(function(L){ var m = _replaceLibKey(L, 'marca'); if(marche.indexOf(m) < 0) marche.push(m); });
  marche.sort();
  msel.innerHTML = '<option value="">— marca —</option>';
  marche.forEach(function(m){ var o = document.createElement('option'); o.value = m; o.textContent = m; msel.appendChild(o); });
  msel.value = '';
  replaceCascadeReset('marca');
}
function replaceCascadeReset(level){
  var osel = document.getElementById('replaceModelloSelect');
  var dsel = document.getElementById('replaceDiamSelect');
  if(level === 'marca' && osel) osel.innerHTML = '<option value="">— modello —</option>';
  if((level === 'marca' || level === 'modello') && dsel) dsel.innerHTML = '<option value="">— Ø —</option>';
  replaceLoadLibrary(null);
}
function replaceOnMarcaChange(){
  var marca = document.getElementById('replaceMarcaSelect').value;
  replaceCascadeReset('marca');
  if(!marca) return;
  var modelli = [];
  replaceLibs.forEach(function(L){ if(_replaceLibKey(L,'marca') === marca){ var md = _replaceLibKey(L,'modello'); if(modelli.indexOf(md) < 0) modelli.push(md); } });
  modelli.sort();
  var osel = document.getElementById('replaceModelloSelect');
  osel.innerHTML = '<option value="">— modello —</option>';
  modelli.forEach(function(md){ var o = document.createElement('option'); o.value = md; o.textContent = md; osel.appendChild(o); });
}
function replaceOnModelloChange(){
  var marca = document.getElementById('replaceMarcaSelect').value;
  var modello = document.getElementById('replaceModelloSelect').value;
  replaceCascadeReset('modello');
  if(!modello) return;
  var diams = [];
  replaceLibs.forEach(function(L){ if(_replaceLibKey(L,'marca') === marca && _replaceLibKey(L,'modello') === modello){ var di = _replaceLibKey(L,'diametro'); if(diams.indexOf(di) < 0) diams.push(di); } });
  diams.sort();
  var dsel = document.getElementById('replaceDiamSelect');
  dsel.innerHTML = '<option value="">— Ø —</option>';
  diams.forEach(function(di){ var o = document.createElement('option'); o.value = di; o.textContent = di; dsel.appendChild(o); });
}
function replaceOnDiamChange(){
  var marca = document.getElementById('replaceMarcaSelect').value;
  var modello = document.getElementById('replaceModelloSelect').value;
  var diam = document.getElementById('replaceDiamSelect').value;
  if(!diam){ replaceLoadLibrary(null); return; }
  var matches = replaceLibs.filter(function(x){ return _replaceLibKey(x,'marca') === marca && _replaceLibKey(x,'modello') === modello && _replaceLibKey(x,'diametro') === diam; });
  if(matches.length > 1){ replaceShowStatus('Attenzione: ' + matches.length + ' librerie con la stessa marca/modello/Ø; uso la prima (id ' + matches[0].id + '). Verifica le librerie importate.', true); }
  replaceLoadLibrary(matches.length ? matches[0].id : null);
}

// carica la libreria scelta dalla cascata e popola Madre/Figlio (per ruolo).
function replaceLoadLibrary(id){
  id = (id != null) ? parseInt(id, 10) : null;
  replaceCurrentLibId = id;
  replaceCurrentDetail = null;
  replaceCurrentType = null; replaceSourceType = null; replaceSubstType = null;
  var tsel = document.getElementById('replaceTypeSelect'); if(tsel) tsel.innerHTML = '<option value="">— scegli figlio —</option>';
  var ssel = document.getElementById('replaceSourceTypeSelect'); if(ssel) ssel.innerHTML = '<option value="">— scegli madre —</option>';
  if(id == null) return;
  fetch('/api/rit/libraries/' + id, { headers: _replaceAuthHeaders() })
    .then(function(r){ if(!r.ok) throw r.status; return r.json(); })
    .then(function(d){ replaceCurrentDetail = d;
      replacePopulateTypeOptions('replaceSourceTypeSelect', '— scegli madre —', 'madre');
      replacePopulateTypeOptions('replaceTypeSelect', '— scegli figlio —', 'figlio'); })
    .catch(function(st){ replaceShowStatus('Type: ' + _replaceFetchErrMsg(st), true); });
}

// popola un dropdown type filtrato per RUOLO: 'madre' -> madre|entrambi,
// 'figlio' -> figlio|entrambi. Se la libreria non ha ruoli assegnati (es. LITE
// importata) -> fallback: mostra TUTTI i type (retrocompatibile).
function replacePopulateTypeOptions(selId, placeholder, want){
  var sel = document.getElementById(selId);
  if(!sel || !replaceCurrentDetail) return;
  var types = replaceCurrentDetail.types || [];
  var cands = want ? types.filter(function(t){ return t.role === want || t.role === 'entrambi'; }) : types;
  // fallback a TUTTI solo se la libreria non ha PROPRIO ruoli (LITE non
  // assegnata); con ruoli parziali un dropdown senza match resta vuoto, niente
  // type del ruolo sbagliato (label 'figlio' non deve elencare le madri).
  if(want && !cands.length){
    var anyRole = types.some(function(t){ return t.role === 'madre' || t.role === 'figlio' || t.role === 'entrambi'; });
    if(!anyRole) cands = types;
  }
  sel.innerHTML = '<option value="">' + placeholder + '</option>';
  cands.forEach(function(t){
    var o = document.createElement('option');
    o.value = (t.ord != null ? t.ord : '');
    var tag = (t.is_eng === true) ? '[ENG] ' : (t.is_eng === false) ? '[Non-ENG] ' : '';
    o.textContent = tag + (t.display || t.keyword || ('type ' + t.ord));
    sel.appendChild(o);
  });
}
function replaceTypeByOrd(ord){ return (replaceCurrentDetail && replaceCurrentDetail.types || []).filter(function(x){ return x.ord === ord; })[0] || null; }
// avvia la posa automatica sorgente->sostituto quando ci sono: scanbody individuato + entrambi i type.
function replaceMaybeAutoPlace(){
  // 8.40.0: vestigiale (era il gate dell'auto-ICP, ora rimossa). Si limita a rinfrescare la UI;
  // mantenuta come no-op perche' chiamata dagli handler dei dropdown type (zero side-effect).
  replaceSeedUpdateUI();
}

function replaceOnTypeChange(sel){   // 2b-3f: SOSTITUTO (IPD da piazzare)
  replaceSeedClear();          // scarta la posa pending
  if(!replaceCurrentDetail || sel.value === ''){
    replaceCurrentType = null; replaceSubstType = null;
    var b0 = document.getElementById('replacePreviewBox'); if(b0) b0.style.display = 'none';
    return;
  }
  var t = replaceTypeByOrd(parseInt(sel.value, 10));
  replaceCurrentType = t; replaceSubstType = t;   // alias per i consumer a valle (replaceConfirmSeed ecc.)
  if(!t) return;
  replaceMaybeAutoPlace();
  if(!replaceSourceType) replaceShowStatus('Scegli anche il type SORGENTE (lo scanbody scansionato), poi "+ Nuovo impianto" e clicca lo scanbody.');
}

// 2b-3f: SORGENTE (scanbody nella scansione) = il CAD su cui gira l'ICP.
function replaceOnSourceTypeChange(sel){
  replaceSeedClear();
  if(!replaceCurrentDetail || sel.value === ''){ replaceSourceType = null; return; }
  replaceSourceType = replaceTypeByOrd(parseInt(sel.value, 10));
  if(!replaceSourceType) return;
  // comodita': se il sostituto non e' ancora scelto, pre-selezionalo = sorgente
  if(!replaceSubstType){
    var tsel = document.getElementById('replaceTypeSelect');
    if(tsel){ tsel.value = sel.value; replaceCurrentType = replaceSourceType; replaceSubstType = replaceSourceType; }
  }
  // anteprima del CAD SORGENTE nella finestra guida (necessaria per i 3 punti sul marker)
  replaceFetchMarkerGeo(replaceSourceType.marker_sha256).then(function(geo){
    if(geo) replacePreviewInit(geo);
    replaceMaybeAutoPlace();
  }).catch(function(st){   // 8.37.0 (fix audit): non ingoiare l'errore in silenzio (era un soft dead-end)
    replaceShowStatus('Anteprima marker sorgente: ' + _replaceFetchErrMsg(st), true);
    replaceMaybeAutoPlace();
  });
}

// Fetch del marker STL per sha256 -> geometry (riuso sostParseSTLToGeometry).
function replaceFetchMarkerGeo(sha){
  if(replaceMarkerGeoCache[sha]) return Promise.resolve(replaceMarkerGeoCache[sha]);
  return fetch('/api/rit/markers/' + sha, { headers: _replaceAuthHeaders() })
    .then(function(r){ if(!r.ok) throw r.status; return r.arrayBuffer(); })
    .then(function(ab){
      var geo = sostParseSTLToGeometry(new Uint8Array(ab));
      if(geo) replaceMarkerGeoCache[sha] = geo;
      return geo;
    });
}

// --- SCAN LOADER (clone di sostOnScanPicked/sostLoadScanToScene) ---
function replaceOnScanPicked(evt){
  var file = evt.target.files && evt.target.files[0];
  if(!file) return;
  var reader = new FileReader();
  reader.onerror = function(){ replaceShowStatus('Errore di lettura del file. Riprova.', true); };   // 8.80.4
  reader.onload = function(e){
    // 8.80.4: parseSTL puo' LANCIARE su STL troncato/corrotto: senza try/catch il
    // guard if(!geo) di replaceLoadScanToScene era irraggiungibile e l'eccezione
    // usciva silenziosa. E siccome replaceLoadScanToScene fa replaceClearScene()
    // PRIMA del guard, su file invalido NON va chiamata affatto: cosi' scansione
    // e impianti gia' piazzati restano intatti.
    var parsed = null;
    try { parsed = parseSTL(e.target.result); } catch(_ePr){ parsed = null; }
    if(!parsed || !parsed.geometry){ replaceShowStatus('Errore: file STL non valido o corrotto. La scena non e\' stata toccata.', true); return; }
    replaceLoadScanToScene(parsed.geometry, file.name);
  };
  reader.readAsArrayBuffer(file);
}

function replaceClearScene(){
  if(replaceMesh){
    scene.remove(replaceMesh);
    if(replaceMesh.geometry) replaceMesh.geometry.dispose();
    if(replaceMesh.material) replaceMesh.material.dispose();
    replaceMesh = null;
  }
  if(replaceOriginalGeo){ replaceOriginalGeo.dispose(); replaceOriginalGeo = null; }
  // NB: NON disposo le geometrie marker (replaceMarkerGeoCache, condivise/cache);
  // rimuovo solo i gruppi dalla scena. I dot (sfere per-marker) sono propri di ogni
  // marker -> dispose sicuro.
  replacePlaced.forEach(function(p){
    if(p.group){ _replaceDisposeGroup(p.group); scene.remove(p.group); }   // 8.32.0: mesh (cache) + sorgente + terna origine (6° sito)
    (p.dotMeshes || []).forEach(_replaceDisposeDot);
  });
  replacePlaced.length = 0;
  replaceCounter = 0;
  replacePaletteIdx = 0;
  // 2b-1.2: azzera anche il seme in corso (dot scansione non ancora piazzati) +
  // disarma il placement; nasconde l'hover dot e ripristina il cursore.
  replaceSeedClear();
}

function replaceLoadScanToScene(geo, filename){
  replaceClearScene();
  if(!geo){ replaceShowStatus('Errore: impossibile parsare il file STL.', true); return; }
  var mat = new THREE.MeshPhongMaterial({ color: 0xc4a48c, side: THREE.DoubleSide, transparent: false, opacity: 1.0, depthWrite: true });
  replaceMesh = new THREE.Mesh(geo, mat);
  replaceMesh.userData.isReplace = true;
  replaceMesh.userData.replaceRole = 'scan';
  scene.add(replaceMesh);
  replaceOriginalGeo = geo.clone();
  var emptyState = document.getElementById('emptyState');
  if(emptyState) emptyState.classList.add('hidden');
  geo.computeBoundingSphere();
  var bs = geo.boundingSphere;
  if(bs){
    controls.target.copy(bs.center);
    camera.position.set(bs.center.x + bs.radius*1.5, bs.center.y + bs.radius, bs.center.z + bs.radius*1.5);
    controls.update();
  }
  var slot = document.getElementById('replaceSlotScan');
  if(slot){
    slot.classList.add('loaded');
    // 8.80.4: filename escapato (nome file utente in innerHTML)
    slot.innerHTML = '<div class="fname">' + ((typeof _escHtml==='function')?_escHtml(filename):filename) + '</div><div class="finfo">' +
      (geo.attributes.position.count / 3).toLocaleString() + ' triangoli</div>';
  }
  var ph = document.getElementById('replaceScanPlaceholder');
  if(ph) ph.style.display = 'none';
  try { replaceRebuildTree(); } catch(e){}   // 2b-3a: la scansione compare nell'albero
  replaceShowStatus('Scansione caricata. Premi "+ Nuovo impianto" e indica lo scanbody da sostituire.');
}

// --- PLACEMENT (clone semplificato di sostStartPlacement/sostOnViewportClick) ---
// 2b-3e.2: avvia il wizard di un NUOVO impianto -> step ① "indica lo scanbody da
// sostituire" (fase pickSource). Non serve type/anteprima qui: si scelgono allo step ②.
// 8.36.0: INGRESSO DIRETTO al flusso a 3 punti (scelta utente: "andiamo diretti sui 3 punti").
// "+ Nuovo impianto" non passa piu' dal click-scanbody (pickSource) ne' dal pulsante ▶ Allinea:
// valida scansione + type + anteprima e avvia SUBITO il seeding a 3 punti (replaceStartThreePoint).
function replaceStartNewImplant(){
  if(!replaceMesh){ replaceShowStatus('Carica prima una scansione.', true); return; }
  if(!replaceSourceType || !replaceSubstType){ replaceShowStatus('Scegli prima i type SORGENTE e SOSTITUTO nel pannello a destra.', true); return; }
  if(!replacePreviewRenderer){ replaceShowStatus('Anteprima del marker non pronta: ri-seleziona il type SORGENTE.', true); return; }
  var box = document.getElementById('replacePreviewBox'); if(box) box.style.display = '';
  replaceSeedClear();           // slate pulito (azzera seme/source/pending precedenti)
  replaceStartThreePoint();     // -> fase pickMarker (3 punti sul marker)
}


function replaceOnViewportClick(event){
  // Collector dei punti GEMELLI sulla scansione (fase pickScan del seme 3-punti, ramo "Allinea a 3 punti").
  if(replaceSeed.phase !== 'pickScan' || !replaceMesh) return false;
  if(replaceSeed.scanPts.length >= REPLACE_SEED_N) return false;
  // 8.54.0 (feedback utente: ruotando il modello il clic finiva fuori posizione): posa SOLO con
  // SHIFT+CLIC PULITO. Un trascinamento (rotazione) non posa mai; un clic senza Shift dà solo un hint.
  if(Math.abs(event.clientX - replacePickDownX) > 6 || Math.abs(event.clientY - replacePickDownY) > 6) return false;   // era un trascinamento = rotazione
  if(!replacePickDownShift){ replaceShowStatus('Tieni premuto Shift e clicca per posare il punto · trascina (senza Shift) per ruotare.'); return false; }
  // 8.59.3 (REVERT del fix NDC 8.59.2): MISURATO in Chromium (Blink) che con body.style.zoom=1.30
  // (default applyUiZoom) clientX, getBoundingClientRect e offsetX sono nello stesso spazio VISUAL
  // (zoomato), MA clientWidth/clientHeight restano UNZOOMED -> offsetX/clientWidth sbagliava di 1.3x.
  // La formula storica clientX/rect e' CORRETTA (clientX e rect entrambi visual -> rapporto giusto).
  // Mantengo solo updateMatrixWorld (difensivo: ray da una camera con matrice mondo aggiornata).
  var rect = renderer.domElement.getBoundingClientRect();
  var mouse = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1
  );
  var raycaster = new THREE.Raycaster();
  if(camera) camera.updateMatrixWorld();
  raycaster.setFromCamera(mouse, camera);
  var hits = raycaster.intersectObject(replaceMesh);
  if(hits.length === 0) return false;
  // 8.59.5 (causa REALE del pallino spostato, trovata con diagnosi console A/B con l'utente): il
  // raycast su replaceMesh restituisce un hits[0].point FUORI dal raggio di ~0.5-1mm (misurato:
  // distToRay ~1mm; updateWorldMatrix NON aiuta -> non e' matrice stantia; nessuna BVH -> e' il
  // raycast nativo del bridge r169 che calcola male il .point su mesh grandi). Lo 0.5-1mm laterale
  // si proietta nei ~20-40px di offset che l'utente vedeva. Il .distance e' CORRETTO: il punto SUL
  // raggio alla distanza del colpo ricade ESATTAMENTE sotto il cursore (misurato onray-offNDC=0.0000).
  // Uso quel punto per il dot E per il seme. (L'anteprima usa un'altra mesh -> non aveva il problema.)
  var _hp = raycaster.ray.at(hits[0].distance, new THREE.Vector3());
  for(var _j = 0; _j < replaceSeed.scanPts.length; _j++){
    if(_hp.distanceTo(replaceSeed.scanPts[_j]) < 0.6){
      replaceShowStatus('Punto troppo vicino al gemello ' + (_j + 1) + ': scegline uno più distante (servono 3 punti ben separati).', true);
      return false;
    }
  }
  var idx = replaceSeed.scanPts.length;
  replaceSeed.scanPts.push(_hp.clone());
  // normale della faccia colpita (replaceMesh ha trasform identita' -> world) per
  // l'asse outward del seme (2b-1.4).
  var fn = (hits[0].face && hits[0].face.normal) ? hits[0].face.normal.clone() : new THREE.Vector3(0,0,1);
  replaceSeed.scanNormals.push(fn);
  var dot = _replaceNumSprite(idx + 1, REPLACE_SEED_COLORS[idx]);
  dot.position.copy(_hp); scene.add(dot);
  replaceSeed.scanDots.push(dot);
  replaceSeedUpdateUI();
  if(replaceSeed.scanPts.length >= REPLACE_SEED_N){
    replacePlaceFromSeed();
  }
  return true;
}

// 2b-1.5: stima ROBUSTA dell'asse del cilindro scanbody attorno a `center`,
// INDIPENDENTE da dove cadono i 3 click. Fix del "marker coricato" del seed
// 8.23.0: quando i punti cadono sulla PARETE, la media delle normali-click e'
// radiale (perp. all'asse) e findScanbodyCenter restituiva un asse radiale.
// Per un cilindro le normali di superficie sono tutte perpendicolari all'asse ->
// l'asse e' l'autovettore con autovalore MINORE di M = Sigma area*nn^T (la
// direzione meno rappresentata fra le normali). Pass 1 su tutti i triangoli
// vicini (asse grezzo), pass 2 tenendo solo la PARETE (|n.asse|<0.35) per
// togliere il cap. Ritorna {axis, capSum} (capSum = somma pesata delle normali
// "cap-like" |n.asse|>0.6, per orientare il verso occlusale). Riusa
// misICP_jacobi3 (eigensolver 3x3 gia' presente ~6275). null se <8 triangoli.
function replaceEstimateCylinderAxis(geo, center, searchR){
  var pos = geo.attributes.position.array;
  var nrm = geo.attributes.normal && geo.attributes.normal.array;
  if(!nrm) return null;
  var nTri = pos.length / 9, r2 = searchR * searchR;
  var tN = [], tW = [];   // normali (unit) + peso area dei triangoli vicini
  for(var i = 0; i < nTri; i++){
    var k = i * 9;
    var cx = (pos[k]+pos[k+3]+pos[k+6])/3, cy = (pos[k+1]+pos[k+4]+pos[k+7])/3, cz = (pos[k+2]+pos[k+5]+pos[k+8])/3;
    var dx = cx-center.x, dy = cy-center.y, dz = cz-center.z;
    if(dx*dx + dy*dy + dz*dz > r2) continue;
    var nx = (nrm[k]+nrm[k+3]+nrm[k+6])/3, ny = (nrm[k+1]+nrm[k+4]+nrm[k+7])/3, nz = (nrm[k+2]+nrm[k+5]+nrm[k+8])/3;
    var nl = Math.sqrt(nx*nx + ny*ny + nz*nz); if(nl < 1e-6) continue;
    nx /= nl; ny /= nl; nz /= nl;
    var e1x = pos[k+3]-pos[k], e1y = pos[k+4]-pos[k+1], e1z = pos[k+5]-pos[k+2];
    var e2x = pos[k+6]-pos[k], e2y = pos[k+7]-pos[k+1], e2z = pos[k+8]-pos[k+2];
    var crx = e1y*e2z-e1z*e2y, cry = e1z*e2x-e1x*e2z, crz = e1x*e2y-e1y*e2x;
    tN.push([nx, ny, nz]); tW.push(0.5 * Math.sqrt(crx*crx + cry*cry + crz*crz));
  }
  if(tN.length < 8) return null;
  function minorAxis(keep){   // autovettore minore di Sigma w*nn^T (keep = solo parete ⊥ keep)
    var S = [[0,0,0],[0,0,0],[0,0,0]], used = 0;
    for(var j = 0; j < tN.length; j++){
      var n = tN[j];
      if(keep && Math.abs(n[0]*keep.x + n[1]*keep.y + n[2]*keep.z) >= 0.35) continue;
      var w = tW[j];
      S[0][0]+=w*n[0]*n[0]; S[0][1]+=w*n[0]*n[1]; S[0][2]+=w*n[0]*n[2];
      S[1][1]+=w*n[1]*n[1]; S[1][2]+=w*n[1]*n[2]; S[2][2]+=w*n[2]*n[2];
      used++;
    }
    if(used < 8) return null;
    S[1][0]=S[0][1]; S[2][0]=S[0][2]; S[2][1]=S[1][2];
    var e = misICP_jacobi3(S), mi = 0;
    if(e.vals[1] < e.vals[mi]) mi = 1;
    if(e.vals[2] < e.vals[mi]) mi = 2;
    var a = new THREE.Vector3(e.vecs[0][mi], e.vecs[1][mi], e.vecs[2][mi]);
    return (a.lengthSq() > 1e-12) ? a.normalize() : null;
  }
  var ax = minorAxis(null); if(!ax) return null;   // pass 1: asse grezzo (tutti i tri)
  var ax2 = minorAxis(ax); if(ax2) ax = ax2;        // pass 2: solo parete -> asse pulito
  var capSum = new THREE.Vector3();                 // verso occlusale dalle normali cap-like
  for(var m = 0; m < tN.length; m++){
    var nn = tN[m];
    if(Math.abs(nn[0]*ax.x + nn[1]*ax.y + nn[2]*ax.z) > 0.6){
      capSum.add(new THREE.Vector3(nn[0], nn[1], nn[2]).multiplyScalar(tW[m]));
    }
  }
  return { axis: ax, capSum: capSum };
}

// 2b-1.4: posa di ANTEPRIMA dai 3 punti, con ASSE preso dalla superficie della
// scansione (robusto, niente ribaltamento) e i 3 punti che fissano posizione +
// roll. Niente piu' Kabsch puro (che sbagliava il verso su cilindri lisci).
// Non finalizza: crea un marker "pending" che l'utente Conferma o Ricomincia.
function replacePlaceFromSeed(){
  var t = replaceCurrentType;
  if(!t || !t.marker_sha256){ replaceShowStatus('Type non valido.', true); return; }
  if(replaceSeed.markerPts.length < REPLACE_SEED_N || replaceSeed.scanPts.length < REPLACE_SEED_N){
    replaceShowStatus('Servono 3 punti sul marker e 3 sulla scansione.', true); return;
  }
  // (3) rifiuto terna SCANSIONE quasi collineare (quella marker e' gia' validata
  // al 3° punto in replacePreviewPickAt). Orientamento mal vincolato -> ripicca.
  var _sArea = 0.5 * replaceSeed.scanPts[1].clone().sub(replaceSeed.scanPts[0]).cross(replaceSeed.scanPts[2].clone().sub(replaceSeed.scanPts[0])).length();
  var sE = Math.max(replaceSeed.scanPts[0].distanceTo(replaceSeed.scanPts[1]), replaceSeed.scanPts[1].distanceTo(replaceSeed.scanPts[2]), replaceSeed.scanPts[2].distanceTo(replaceSeed.scanPts[0]));
  if(_sArea < 0.08 * sE * sE){
    replaceSeed.scanPts.pop(); replaceSeed.scanNormals.pop(); _replaceDisposeDot(replaceSeed.scanDots.pop());
    replaceShowStatus('I 3 punti sulla SCANSIONE sono troppo allineati: scegli il 3° punto piu\' lontano dagli altri due.', true);
    replaceSeedUpdateUI();
    return;
  }
  // (1) ASSE del cilindro scanbody: stima ROBUSTA e INDIPENDENTE dai 3 click
  // (2b-1.5). avgN (media normali-click) NON e' piu' l'asse (con punti sulla
  // parete e' radiale -> era il bug "marker coricato" del seed 8.23.0): resta
  // solo come ultimo fallback di verso.
  var avgN = new THREE.Vector3();
  (replaceSeed.scanNormals || []).forEach(function(n){ avgN.add(n); });
  if(avgN.lengthSq() < 1e-9) avgN.set(0, 0, 1);
  avgN.normalize();
  var cB = new THREE.Vector3();
  replaceSeed.scanPts.forEach(function(p){ cB.add(p); });
  cB.multiplyScalar(1 / replaceSeed.scanPts.length);
  var N;
  // 2b-3d: il fit usa la geometria ORIGINALE (mai tagliata) -> il "Taglia scansione"
  // (buco attorno ai marker) non rompe il seed (ne' la Raffina, vedi _replaceDoRefine).
  var _alignGeo = replaceOriginalGeo || replaceMesh.geometry;
  var cyl = replaceEstimateCylinderAxis(_alignGeo, cB.clone(), 5.0);
  if(cyl){
    N = cyl.axis.clone().normalize();
    // verso OCCLUSALE/outward: 1) normali del cap (occlusali); 2) "lo scanbody
    // sporge dalla scansione" (cB - centro scansione); 3) media normali-click.
    var sgnRef = (cyl.capSum && cyl.capSum.lengthSq() > 1e-9) ? cyl.capSum : null;
    if(!sgnRef){
      var bs = _alignGeo.boundingSphere;
      if(!bs){ _alignGeo.computeBoundingSphere(); bs = _alignGeo.boundingSphere; }
      if(bs) sgnRef = cB.clone().sub(bs.center);
    }
    if(!sgnRef || sgnRef.lengthSq() < 1e-9) sgnRef = avgN;
    if(N.dot(sgnRef) < 0) N.multiplyScalar(-1);
  } else {
    // fallback legacy (poche facce vicine): findScanbodyCenter col seme normali-click
    var fit = findScanbodyCenter(_alignGeo, cB.clone(), avgN.clone());
    N = fit.axis.clone().normalize();
    if(N.dot(avgN) < 0) N.multiplyScalar(-1);   // verso outward
  }
  // asse di inserzione LOCALE del marker (da axis_occlusal della libreria; fallback +Z)
  var ao = (replaceCurrentDetail && replaceCurrentDetail.axis_occlusal) || { x: 0, y: 0, z: 1 };
  var u = new THREE.Vector3(ao.x || 0, ao.y || 0, ao.z || 0);
  if(u.lengthSq() < 1e-9) u.set(0, 0, 1);
  u.normalize();
  // q0: porta l'asse locale u sull'asse-mondo N (l'asse e' sempre outward -> no flip)
  var q0 = new THREE.Quaternion().setFromUnitVectors(u, N);
  // base ortonormale del piano perpendicolare a N
  var tmp = (Math.abs(N.x) > 0.9) ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  var e1 = new THREE.Vector3().crossVectors(tmp, N).normalize();
  var e2 = new THREE.Vector3().crossVectors(N, e1).normalize();
  // (2D Procrustes) roll attorno a N dai 3 punti: i punti danno posizione + roll
  var Apts = replaceSeed.markerPts.map(function(p){ return p.clone().applyQuaternion(q0); });
  var cA = new THREE.Vector3(); Apts.forEach(function(p){ cA.add(p); }); cA.multiplyScalar(1 / Apts.length);
  var sumSin = 0, sumCos = 0;
  for(var i = 0; i < Apts.length; i++){
    var a = Apts[i].clone().sub(cA), b = replaceSeed.scanPts[i].clone().sub(cB);
    var axp = a.dot(e1), ayp = a.dot(e2), bxp = b.dot(e1), byp = b.dot(e2);
    sumSin += axp * byp - ayp * bxp;
    sumCos += axp * bxp + ayp * byp;
  }
  var theta = Math.atan2(sumSin, sumCos);
  var qRoll = new THREE.Quaternion().setFromAxisAngle(N, theta);
  var qFinal = qRoll.clone().multiply(q0);                       // q0 poi qRoll
  var posV = cB.clone().sub(cA.clone().applyQuaternion(qRoll));  // allinea i centroidi
  var seedMarker = replaceSeed.markerPts.map(function(p){ return p.clone(); });
  var seedScan = replaceSeed.scanPts.map(function(p){ return p.clone(); });
  var _gen = replaceSeedGen;   // guardia anti-fantasma: se il seme cambia durante il fetch, bail
  // 8.34.1: il 3-punti costruisce la STESSA struttura MADRE+FIGLIO dell'auto (geoSrc SORGENTE +
  // geoSub SOSTITUTO nello stesso frame + terna origine) -> anche col fallback ai 3 punti vedi
  // MADRE (grigio-blu) + FIGLIO + origine nella scena e nell'albero. La posa (posV/qFinal) viene dai
  // 3 click (allineano il SORGENTE alla scansione); il sostituto eredita via origine condivisa.
  var _tSub = t;                                  // = replaceCurrentType (SOSTITUTO/figlio)
  var _tSrc = replaceSourceType || t;             // SORGENTE/madre
  Promise.all([replaceFetchMarkerGeo(_tSrc.marker_sha256), replaceFetchMarkerGeo(_tSub.marker_sha256)]).then(function(geos){
    if(_gen !== replaceSeedGen) return;   // reset/cambio workflow durante il fetch -> scarta
    var geoSrc = geos[0], geoSub = geos[1];
    if(!geoSrc || !geoSub){ replaceShowStatus('Impossibile caricare gli STL sorgente/sostituto.', true); return; }
    // 8.43.0 (F2): se l'utente ha accorciato il sorgente (slider taglio dall'origine), usa il CAD
    // tagliato per la MADRE visibile + per il fit (srcGeo -> _replaceDoRefine campiona il cap esposto).
    if(typeof replaceSrcTrim !== 'undefined' && replaceSrcTrim.full && replaceSrcTrim.threshold > replaceSrcTrim.lo + 1e-6){
      try { geoSrc = replaceTrimGeoAlongAxis(geoSrc, replaceSrcTrim.axis, replaceSrcTrim.threshold); } catch(e){}
    }
    var matSub = new THREE.MeshPhongMaterial({ color: 0x9aa7b3, specular: 0x222222, shininess: 40, side: THREE.DoubleSide, transparent: true, opacity: 0.9, depthWrite: true });
    var meshSub = new THREE.Mesh(geoSub, matSub); meshSub.name = 'replace-marker';            // FIGLIO children[0]
    var matSrc = new THREE.MeshPhongMaterial({ color: 0x8090A8, specular: 0x222222, shininess: 40, side: THREE.DoubleSide, transparent: true, opacity: 0.5, depthWrite: false });
    var meshSrc = new THREE.Mesh(geoSrc, matSrc); meshSrc.name = 'replace-source'; meshSrc.renderOrder = 1;   // MADRE children[1]
    var group = new THREE.Group(); group.add(meshSub); group.add(meshSrc);
    var originAxes = _replaceMakeOriginAxes(3.2); group.add(originAxes);
    group.position.copy(posV); group.quaternion.copy(qFinal);
    group.userData.isReplace = true; group.userData.replaceRole = 'marker-pending';
    scene.add(group);
    // 8.53.0: congela l'identità libreria (marca/modello/diametro della cascata) SULL'impianto
    // alla posa -> le etichette restano immutabili anche se l'utente cambia la cascata dopo.
    var _libMMD = replaceLibs.filter(function(L){ return L.id === replaceCurrentLibId; })[0] || replaceCurrentDetail || {};
    var p = {
      group: group, meshSub: meshSub, meshSrc: meshSrc, originAxes: originAxes,
      showSrc: true, showSub: true, showOrigin: true,
      seedMarkerPts: seedMarker, seedScanPts: seedScan,
      seedPos: posV.clone(), seedQuat: qFinal.clone(), seedAxis: N.clone(),   // 8.62.0: posa SEED 3-punti grezza (delta-clocking A/B + reset-to-seed)
      position: posV.clone(), axisDir: N.clone(),
      srcGeo: geoSrc,                               // 8.31.1: la Raffina resta sul SORGENTE (cap trimmato per il fit)
      srcGeoFull: geos[0],                          // 8.59.7: CAD MADRE INTERO (cache, mai accorciato) -> il "Taglia scansione" usa QUESTO, non il trim dell'anteprima
      srcMarkerSha: _tSrc.marker_sha256,
      libId: replaceCurrentLibId, typeOrd: _tSub.ord, markerSha: _tSub.marker_sha256,
      marca: (_libMMD.marca || null), modello: (_libMMD.modello || null), diametro: (_libMMD.diametro != null ? _libMMD.diametro : null),
      cutOffset: 0.5,   // 8.57.0 (scelta utente): offset di taglio di default +0.5mm (margine attorno alla silhouette del madre); regolabile dallo slider
      typeLabel: (_tSub.display || _tSub.keyword || ('type ' + _tSub.ord)),
      srcTypeLabel: (_tSrc.display || _tSrc.keyword || ('type ' + _tSrc.ord)),
      // 8.38.0: snapshot dei type della libreria (stessa connessione/origine) per il dropdown
      // "cambia FIGLIO" nell'albero -> richiami un altro IPD senza ri-accoppiare.
      libTypes: ((replaceCurrentDetail && replaceCurrentDetail.types) || []).map(function(_t){
        return { ord: _t.ord, sha: _t.marker_sha256, eng: !!_t.is_eng, label: (_t.display || _t.keyword || ('type ' + _t.ord)) };
      })
    };
    _replaceApplyView(p);
    // 8.37.0: mostra SUBITO la posa 3-punti (madre+figlio+origine), poi lancia la Raffina ICP in un
    // TICK SEPARATO con FEEDBACK (status "Raffino…" + cursor wait, che vengono dipinti grazie al
    // setTimeout(0) prima del calcolo sincrono). Fix audit: prima il freeze era senza alcun feedback.
    replacePending = p;
    replaceSeed.phase = 'pendingConfirm';
    replaceSeedUpdateUI();
    replaceShowStatus('Raffino la posa (ICP)…');
    try { if(typeof renderer !== 'undefined' && renderer && renderer.domElement) renderer.domElement.style.cursor = 'wait'; } catch(e){}
    setTimeout(function(){
      if(replacePending !== p){   // l'utente ha gia' Confermato/Ricominciato nel frattempo -> non toccare (8.37.0 review: ripristina anche il cursore, sennò resta 'wait')
        try { if(typeof renderer !== 'undefined' && renderer && renderer.domElement) renderer.domElement.style.cursor = 'default'; } catch(_e){}
        return;
      }
      // RAFFINA ICP AUTO *bounded* — la posa 3-punti e' gia' precisa, l'ICP la STRINGE soltanto. Riusa
      // _replaceDoRefine (campiona p.srcGeo = SORGENTE). SICUREZZA (fix audit): accetta SOLO se RMSD
      // valido E sotto soglia clinica (0.15mm) E drift contenuto (bound stretti 0.3mm/3°). Altrimenti
      // (ICP che scappa sulla gengiva o RMSD alto) -> TORNA alla posa 3-punti: niente flottante, mai
      // peggiorare una posa 3-punti gia' buona.
      var _seedPos = group.position.clone(), _seedQuat = group.quaternion.clone();
      var _seedPosP = p.position.clone(), _seedAxisP = p.axisDir.clone();
      var _refined = false;
      try {
        for(var _it = 0; _it < 3; _it++){
          var _pB = p.position.clone(), _aB = p.axisDir.clone();
          _replaceDoRefine(p);
          if(p.position.distanceTo(_pB) < 1e-3 && _aB.angleTo(p.axisDir) < 2e-4) break;
        }
        var _drift = group.position.distanceTo(_seedPos);
        var _rotDrift = _seedQuat.angleTo(group.quaternion) * 180 / Math.PI;
        _refined = (typeof p.rmsd === 'number' && isFinite(p.rmsd) && p.rmsd <= 0.15 && _drift <= 0.3 && _rotDrift <= 3);
        if(!_refined){   // raffina scartata -> ripristina la posa 3-punti
          group.position.copy(_seedPos); group.quaternion.copy(_seedQuat);
          p.position.copy(_seedPosP); p.axisDir.copy(_seedAxisP); p.rmsd = null;
        }
      } catch(e){
        console.warn('[replace 3pt refine]', e);
        group.position.copy(_seedPos); group.quaternion.copy(_seedQuat);
        p.position.copy(_seedPosP); p.axisDir.copy(_seedAxisP); p.rmsd = null;
      }
      try { if(typeof renderer !== 'undefined' && renderer && renderer.domElement) renderer.domElement.style.cursor = 'default'; } catch(e){}
      _replaceApplyView(p);
      replaceShowStatus('③ Posa a 3 punti pronta' + (_refined ? ((window.SYN && window.SYN.expert) ? (' + Raffina (RMSD ' + (Math.round(p.rmsd * 1000) / 1000) + 'mm)') : ' + Raffina') : ' (raffina non applicata: tenuta la posa 3-punti)') + ' — MADRE (grigio-blu) + FIGLIO + origine. Controlla, poi ✓ Conferma — o Ricomincia.');
    }, 0);
  }).catch(function(st){ replaceShowStatus('Marker: ' + _replaceFetchErrMsg(st), true); });
}


// 8.40.0: avvio del seeding a 3 punti (unico flusso di posa). Azzera seme/anteprima e passa a pickMarker.
function replaceStartThreePoint(){
  if(!replacePreviewRenderer){ replaceShowStatus('Scegli prima un type (anteprima).', true); return; }
  replaceSeedGen++;   // invalida eventuali fetch in volo
  if(replacePending){
    if(replacePending.group){ _replaceDisposeGroup(replacePending.group); scene.remove(replacePending.group); }   // 8.32.0
    replacePending = null;
  }
  (replaceSeed.markerDots || []).forEach(_replaceDisposeDot);
  (replaceSeed.scanDots || []).forEach(_replaceDisposeDot);
  replaceSeed.markerPts = []; replaceSeed.scanPts = []; replaceSeed.scanNormals = []; replaceSeed.markerDots = []; replaceSeed.scanDots = [];
  replaceSeed.phase = 'pickMarker';
  replacePlacementMode = true;
  renderer.domElement.style.cursor = 'crosshair';
  if(replacePreviewRenderer) replacePreviewRender();
  replaceSeedUpdateUI();
  replaceShowStatus('Allinea a 3 punti: SHIFT+CLIC su 3 punti di repere SUL MARKER nell\'anteprima (1·2·3). Trascina per ruotare.');
}

// Conferma la posa di anteprima: finalizza il marker (entra in replacePlaced).
function replaceConfirmSeed(){
  if(!replacePending) return;
  var P = replacePending;
  replaceCounter++;
  P.id = 'REPL_' + replaceCounter; P.num = replaceCounter;
  P.color = REPLACE_COLORS[replacePaletteIdx % REPLACE_COLORS.length]; replacePaletteIdx++;
  P.group.name = P.id; P.group.userData.replaceRole = 'marker';
  var mm = P.group.children[0];   // = meshSub (FIGLIO/SOSTITUTO) = marker finale colorato
  if(mm && mm.material){ mm.material.color.setHex(P.color); mm.material.opacity = 1.0; }
  // 8.33.0: confermato -> MADRE + FIGLIO entrambi visibili (madre grigio-blu translucida sopra),
  // origine OFF (sorgente/figlio/origine restano togglabili dall'albero scena).
  P.showSrc = true; P.showSub = true; P.showOrigin = false; _replaceApplyView(P);
  // 8.36.0: i 3 PUNTI di accoppiamento hanno esaurito il compito -> via dal 3D dopo la Conferma
  // (scelta utente: "i punti usati per l'accoppiamento non devono piu' essere visualizzati").
  (replaceSeed.scanDots || []).forEach(_replaceDisposeDot);
  replaceSeed.scanDots = [];
  P.dotMeshes = [];
  P.labelEl = null;
  if(P.toothLabel == null) P.toothLabel = '';   // 8.49.0: modello allineato al commento (nome dente, default vuoto)
  replacePlaced.push(P);
  replacePending = null;
  replaceSeedClear();          // azzera dot anteprima marker + stato seme
  replaceRebuildPlacedList();
  // 8.47.0 (richiesta utente): "Conferma" = conferma + RAFFINA (ICP auto-loop) e, a raffina
  // conclusa, ATTIVA il "taglia scansione" su questo impianto (albero scena).
  replaceActiveNum = P.num;   // 8.56.0: il marker appena confermato diventa l'attivo per la Raffina
  replaceShowStatus('Impianto #' + P.num + ' confermato — raffino la posa (ICP)…');
  replaceRefineAll(function(){
    var _m = replacePlaced.filter(function(m){ return m.num === P.num; })[0];   // 8.56.0: rilookup (P può essere stato eliminato durante la raffina)
    if(!_m){ try { replaceRebuildScanGeometry(); } catch(e){} replaceRebuildTree(); return; }
    _m.cutScan = true;
    _m.showSrc = false; try { _replaceApplyView(_m); } catch(e){}   // 8.57.0 (scelta utente): dopo Raffina nascondi la MADRE -> vista pulita del risultato (Figlio + taglio); ri-attivabile dall'albero
    try { replaceRebuildScanGeometry(); } catch(e){}
    replaceRebuildTree();
    replaceShowStatus('Impianto #' + _m.num + ' confermato, raffinato e scansione tagliata. + Nuovo impianto per il prossimo.' + ((typeof _m.rmsd === 'number' && window.SYN && window.SYN.expert) ? (' RMSD ' + (Math.round(_m.rmsd * 1000) / 1000) + 'mm.') : ''));
  }, P.num);   // 8.56.0: raffina SOLO l'impianto appena confermato
}

function replaceRebuildPlacedList(){
  try { replaceRebuildTree(); } catch(e){}   // 2b-3a: albero scena allineato a ogni cambio marker
  var wrap = document.getElementById('replacePlacedList');
  var items = document.getElementById('replacePlacedItems');
  var flow = document.getElementById('replaceFlow');
  if(!wrap || !items) return;
  var rfn = document.getElementById('replaceBtnRefine');
  var rfnS = document.getElementById('replaceBtnRefineSrv');   // 8.59.0: Raffina+ server
  var rfnR = document.getElementById('replaceBtnResetSeed');   // 8.62.0: reset alla posa seed (A/B)
  if(!replacePlaced.length){
    wrap.style.display = 'none'; items.innerHTML = '';
    if(flow) flow.style.display = 'none';
    if(rfn){ rfn.disabled = true; rfn.style.opacity = '0.5'; rfn.style.cursor = 'not-allowed'; }
    if(rfnS){ rfnS.disabled = true; rfnS.style.opacity = '0.5'; rfnS.style.cursor = 'not-allowed'; }
    if(rfnR){ rfnR.disabled = true; rfnR.style.opacity = '0.5'; rfnR.style.cursor = 'not-allowed'; }
    return;
  }
  wrap.style.display = '';
  if(flow) flow.style.display = 'flex';
  if(rfn){ rfn.disabled = false; rfn.style.opacity = '1'; rfn.style.cursor = 'pointer'; }  // 2b-2: Raffina attiva con >=1 marker
  if(rfnS){ rfnS.disabled = false; rfnS.style.opacity = '1'; rfnS.style.cursor = 'pointer'; }  // 8.59.0: idem Raffina+ server
  if(rfnR){ rfnR.disabled = false; rfnR.style.opacity = '1'; rfnR.style.cursor = 'pointer'; }  // 8.62.0: reset-to-seed attivo con >=1 impianto
  items.innerHTML = '';
  replacePlaced.forEach(function(p){
    var row = document.createElement('div');
    row.style.cssText = 'font-family:var(--mono);font-size:11px;color:var(--dark);padding:3px 6px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:6px';
    var sw = document.createElement('span');
    sw.style.cssText = 'display:inline-block;width:9px;height:9px;border-radius:2px;flex-shrink:0;background:#' + ('000000' + p.color.toString(16)).slice(-6);
    var lab = document.createElement('span');
    lab.style.flex = '1';
    var _lib = _replaceLibId(p);   // 8.53.0
    lab.textContent = '#' + p.num + '  ' + (_lib || (p.typeLabel || ('type ' + p.typeOrd))) + ((p.rmsd != null && window.SYN && window.SYN.expert) ? ('  · ' + (Math.round(p.rmsd * 1000) / 1000) + 'mm') : '');
    var del = document.createElement('button');
    del.textContent = '✕';
    del.title = 'Elimina questo scanbody';
    del.style.cssText = 'border:none;background:none;color:#D64545;cursor:pointer;font-size:13px;line-height:1;padding:0 2px;flex-shrink:0';
    (function(pid){ del.addEventListener('click', function(){ replaceDeletePlaced(pid); }); })(p.id);
    row.appendChild(sw); row.appendChild(lab); row.appendChild(del);
    items.appendChild(row);
  });
}

function replaceToggleScanVisibility(on){ if(replaceMesh) replaceMesh.visible = !!on; }
function replaceSetScanOpacity(pctStr){
  var v = Math.max(0.1, Math.min(1.0, parseFloat(pctStr) / 100));
  replaceScanUI.opacity = v;
  if(replaceMesh && replaceMesh.material){
    replaceMesh.material.transparent = v < 1.0;
    replaceMesh.material.opacity = v;
    replaceMesh.material.needsUpdate = true;
  }
  var lbl = document.getElementById('replaceOpLblScan'); if(lbl) lbl.textContent = Math.round(v * 100) + '%';
}
// 8.39.0: trasparenza PER-OGGETTO di MADRE (src) e FIGLIO (sub) di un impianto. Il materiale
// e' la sorgente di verita' (creato transparent:true, src 0.5 / sub 0.9); lo slider lo aggiorna.
function replaceSetMarkerOpacity(num, which, pctStr){
  var v = Math.max(0.1, Math.min(1.0, parseFloat(pctStr) / 100));
  for(var i = 0; i < replacePlaced.length; i++){
    if(replacePlaced[i].num === num){
      var mesh = (which === 'src') ? replacePlaced[i].meshSrc : replacePlaced[i].meshSub;
      if(mesh && mesh.material){
        mesh.material.transparent = v < 1.0;
        mesh.material.opacity = v;
        mesh.material.needsUpdate = true;
      }
      var lbl = document.getElementById('replaceOpLbl_' + which + '_' + num);
      if(lbl) lbl.textContent = Math.round(v * 100) + '%';
      break;
    }
  }
}
// 8.39.0: applica la modalita' di render globale (envSettings.renderMode = solid|wireframe|both)
// alle mesh di Replace-iT. Chiamata da applyRenderModeToScene (barra globale) e in coda a
// replaceRebuildTree, cosi' mesh nuove o ri-geometrizzate (load, conferma, swap figlio, taglio
// scansione) prendono subito la modalita' corrente senza un re-toggle manuale.
function replaceApplyRenderMode(){
  if(typeof applyRenderModeToMesh !== 'function') return;
  if(replaceMesh) applyRenderModeToMesh(replaceMesh);
  replacePlaced.forEach(function(p){
    if(p.meshSub) applyRenderModeToMesh(p.meshSub);
    if(p.meshSrc) applyRenderModeToMesh(p.meshSrc);
  });
  if(typeof replacePending !== 'undefined' && replacePending){
    if(replacePending.meshSub) applyRenderModeToMesh(replacePending.meshSub);
    if(replacePending.meshSrc) applyRenderModeToMesh(replacePending.meshSrc);
  }
}
// §WF-SOST: sostApplyRenderMode → /static/wf/sostituire.js (Fase 6d, caricato in testa)
function replaceTogglePlacedVisibility(num, on){
  for(var i = 0; i < replacePlaced.length; i++){
    if(replacePlaced[i].num === num){ if(replacePlaced[i].group) replacePlaced[i].group.visible = !!on; break; }
  }
}

function replaceToggleMarkersCollapse(){ replaceTreeUI.markersCollapsed = !replaceTreeUI.markersCollapsed; replaceRebuildTree(); }

// 8.45.0 (feedback utente: il taglio scansione tagliava troppo in orizzontale x/y): raggio del
// buco ADATTIVO = estensione radiale (90° percentile) del FIGLIO piazzato attorno all'asse, in
// MONDO, + piccolo margine -> taglia ~il footprint dello scanbody e poco altro, non un'ampia fascia
// di gengiva. Cap al vecchio fisso (mai PIU' largo di prima). Fallback fisso se geometria assente.
// 8.59.7: il "Taglia scansione" usa il CAD MADRE INTERO (p.srcGeoFull = sorgente piena dalla cache,
// MAI la versione accorciata dallo slider "taglio" dell'anteprima, che serve solo al fit del cap esposto).
// Stesso frame locale del trim (replaceTrimGeoAlongAxis rimuove solo triangoli, non ricentra) -> il
// transform p.group.matrixWorld vale identico. Fallback a meshSrc (impianti senza srcGeoFull / single-mesh).
function _replaceCutSourceGeo(p){
  if(p.srcGeoFull && p.srcGeoFull.attributes && p.srcGeoFull.attributes.position) return p.srcGeoFull;
  var mesh = (p.meshSrc) || (p.meshSub) || (p.group && p.group.children && p.group.children[0]);
  return (mesh && mesh.geometry) ? mesh.geometry : null;
}
function replaceEstimateMarkerRadius(p){
  // 8.54.0: il buco è GUIDATO DAL MADRE (meshSrc = scanbody scansionato, ciò che occupa davvero lo
  // spazio nella scansione) — non più dal figlio (meshSub). + offset utente dallo slider dell'albero.
  var _off = (p.cutOffset || 0);
  var geo = _replaceCutSourceGeo(p);   // 8.59.7: CAD madre INTERO, non il trim dell'anteprima
  if(!geo || !geo.attributes || !geo.attributes.position) return REPLACE_CUT_RADIUS + _off;
  try {
    p.group.updateMatrixWorld(true);
    var m = p.group.matrixWorld.elements;
    var ax = p.axisDir.clone().normalize();
    var pos = geo.attributes.position.array, n = pos.length / 3, rs = [];
    for(var i = 0; i < n; i++){
      var lx = pos[i*3], ly = pos[i*3+1], lz = pos[i*3+2];
      var wx = m[0]*lx + m[4]*ly + m[8]*lz  + m[12];
      var wy = m[1]*lx + m[5]*ly + m[9]*lz  + m[13];
      var wz = m[2]*lx + m[6]*ly + m[10]*lz + m[14];
      var dx = wx - p.position.x, dy = wy - p.position.y, dz = wz - p.position.z;
      var axial = dx*ax.x + dy*ax.y + dz*ax.z;
      var rx = dx - axial*ax.x, ry = dy - axial*ax.y, rz = dz - axial*ax.z;
      rs.push(Math.sqrt(rx*rx + ry*ry + rz*rz));
    }
    if(rs.length < 8) return REPLACE_CUT_RADIUS + _off;
    rs.sort(function(a, b){ return a - b; });
    var p90 = rs[Math.floor(rs.length * 0.90)];   // ~raggio scanbody MADRE (ignora outlier del cap)
    return Math.min(REPLACE_CUT_RADIUS, p90 + 0.3) + _off;   // footprint madre (cap 3mm) + offset utente
  } catch(e){ return REPLACE_CUT_RADIUS + _off; }
}
// 8.55.0: profilo radiale PER-ANGOLO del MADRE (la sua silhouette vista lungo l'asse) -> il
// "Taglia scansione" segue la FORMA reale dello scanbody che si accoppia alla scansione, non un
// cerchio capato a 3mm. Per ogni settore angolare prende l'85° percentile del raggio dei vertici
// del madre (in MONDO, ⊥ all'asse) -> ignora il flare del cap e gli outlier; i settori vuoti
// ereditano la mediana globale; guardia anti-runaway 8mm per madre con tessuto. null = fallback cerchio.
function _replaceMadreProfile(p){
  var geo = _replaceCutSourceGeo(p);   // 8.59.7: CAD madre INTERO, non il trim dell'anteprima
  if(!geo || !geo.attributes || !geo.attributes.position) return null;
  try {
    p.group.updateMatrixWorld(true);
    var m = p.group.matrixWorld.elements;
    var ax = p.axisDir.clone().normalize();
    var ref = (Math.abs(ax.z) < 0.9) ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);   // 8.55.0: convenzione asse del codebase
    var u = new THREE.Vector3().crossVectors(ax, ref).normalize();
    var w = new THREE.Vector3().crossVectors(ax, u).normalize();   // base ⊥ asse: (u, w)
    var NB = 48, bins = [];
    var axMin = Infinity, axMax = -Infinity;   // 8.59.6: bound assiale del taglio = estensione reale del madre (no piu' tubo passante)
    for(var b = 0; b < NB; b++) bins.push([]);
    var posA = geo.attributes.position.array, n = posA.length / 3;
    if(n < 16) return null;
    for(var i = 0; i < n; i++){
      var lx = posA[i*3], ly = posA[i*3+1], lz = posA[i*3+2];
      var wx = m[0]*lx + m[4]*ly + m[8]*lz  + m[12];
      var wy = m[1]*lx + m[5]*ly + m[9]*lz  + m[13];
      var wz = m[2]*lx + m[6]*ly + m[10]*lz + m[14];
      var dx = wx - p.position.x, dy = wy - p.position.y, dz = wz - p.position.z;
      var axial = dx*ax.x + dy*ax.y + dz*ax.z;
      if(axial < axMin) axMin = axial; if(axial > axMax) axMax = axial;   // 8.59.6: estensione assiale reale del madre
      var rx = dx - axial*ax.x, ry = dy - axial*ax.y, rz = dz - axial*ax.z;
      var r = Math.sqrt(rx*rx + ry*ry + rz*rz);
      var cu = rx*u.x + ry*u.y + rz*u.z, cw = rx*w.x + ry*w.y + rz*w.z;
      var bi = Math.floor((Math.atan2(cw, cu) + Math.PI) / (2*Math.PI) * NB);
      if(bi < 0) bi = 0; else if(bi >= NB) bi = NB - 1;
      bins[bi].push(r);
    }
    var prof = new Float32Array(NB), glob = [];
    for(var b2 = 0; b2 < NB; b2++){
      if(bins[b2].length){
        bins[b2].sort(function(a, c){ return a - c; });
        var rr = bins[b2][Math.floor(bins[b2].length * 0.85)];   // 85° per settore (un filo più stretto del fallback circolare 90°, voluto)
        if(rr > 8) rr = 8;   // guardia anti-runaway
        prof[b2] = rr; glob.push(rr);
      } else prof[b2] = -1;
    }
    if(!glob.length) return null;
    glob.sort(function(a, c){ return a - c; });
    var fb = glob[Math.floor(glob.length * 0.5)];   // mediana settori ≈ raggio del CORPO cilindrico
    var rcap = fb * REPLACE_PROFILE_CAP_K;           // 8.59.9: tetto robusto -> rigetta le feature non-round del madre (square engaging sub-gengivale, scan-flag) che over-cuttano la mucosa
    for(var b3 = 0; b3 < NB; b3++){
      if(prof[b3] < 0) prof[b3] = fb;                // settori vuoti -> mediana
      else if(prof[b3] > rcap) prof[b3] = rcap;      // clampa i settori anomali (silhouette non-round)
    }
    return { u: u, w: w, NB: NB, prof: prof, axMin: axMin, axMax: axMax };
  } catch(e){ return null; }
}

function _replaceRemoveCutIslands(kept, cyls){
  var T = kept.length / 9;
  if(T < 4 || !cyls || !cyls.length) return kept;
  // 1) saldatura vertici su griglia (1µm) -> id univoco per posizione
  var Q = 1000, vmap = new Map(), vid = new Int32Array(T * 3), nextId = 0;
  for(var t = 0; t < T; t++){
    var b = t * 9;
    for(var k = 0; k < 3; k++){
      var o = b + k * 3;
      var key = Math.round(kept[o] * Q) + ',' + Math.round(kept[o+1] * Q) + ',' + Math.round(kept[o+2] * Q);
      var id = vmap.get(key);
      if(id === undefined){ id = nextId++; vmap.set(key, id); }
      vid[t * 3 + k] = id;
    }
  }
  // 2) union-find sui vertici saldati (triangolo = unione dei suoi 3 vertici)
  var parent = new Int32Array(nextId);
  for(var p = 0; p < nextId; p++) parent[p] = p;
  function find(x){ while(parent[x] !== x){ parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
  function uni(a, c){ a = find(a); c = find(c); if(a !== c) parent[a] = c; }
  for(var t2 = 0; t2 < T; t2++){ uni(vid[t2*3], vid[t2*3+1]); uni(vid[t2*3+1], vid[t2*3+2]); }
  // 3) per triangolo: componente (root) + dimensione + frazione near-cut
  var compOf = new Int32Array(T), sizeMap = new Map(), nearMap = new Map();
  for(var t3 = 0; t3 < T; t3++){
    var root = find(vid[t3*3]); compOf[t3] = root;
    sizeMap.set(root, (sizeMap.get(root) || 0) + 1);
    var bb = t3 * 9;
    var ccx = (kept[bb]+kept[bb+3]+kept[bb+6])/3, ccy = (kept[bb+1]+kept[bb+4]+kept[bb+7])/3, ccz = (kept[bb+2]+kept[bb+5]+kept[bb+8])/3;
    var near = false;
    for(var c2 = 0; c2 < cyls.length && !near; c2++){
      var kk = cyls[c2];
      var dx = ccx-kk.cp.x, dy = ccy-kk.cp.y, dz = ccz-kk.cp.z;
      var axial = dx*kk.ax.x + dy*kk.ax.y + dz*kk.ax.z;
      if(kk.axLo != null){ if(axial < kk.axLo - REPLACE_ISLAND_MARGIN || axial > kk.axHi + REPLACE_ISLAND_MARGIN) continue; }   // 8.59.6: stesso bound assiale del taglio
      else if(Math.abs(axial) > kk.halfH + REPLACE_ISLAND_MARGIN) continue;
      var rx = dx-axial*kk.ax.x, ry = dy-axial*kk.ax.y, rz = dz-axial*kk.ax.z;
      var rad = (kk.profMax > 0 ? kk.profMax : kk.R) + kk.off + REPLACE_ISLAND_MARGIN;
      if(rx*rx+ry*ry+rz*rz <= rad*rad) near = true;
    }
    if(near) nearMap.set(root, (nearMap.get(root) || 0) + 1);
  }
  // 4) corpo principale = componente più grande (da preservare sempre)
  var biggest = -1, biggestSize = -1;
  sizeMap.forEach(function(sz, root){ if(sz > biggestSize){ biggestSize = sz; biggest = root; } });
  // 5) isole da rimuovere: non la più grande + piccola (<5% del totale) + in maggioranza near-cut
  var remove = new Set();
  sizeMap.forEach(function(sz, root){
    if(root === biggest) return;
    if(sz < T * 0.05 && (nearMap.get(root) || 0) / sz > 0.6) remove.add(root);
  });
  if(!remove.size) return kept;
  // 6) ricostruisci senza le isole
  var out = [];
  for(var t4 = 0; t4 < T; t4++){
    if(remove.has(compOf[t4])) continue;
    var bo = t4 * 9; for(var v = 0; v < 9; v++) out.push(kept[bo + v]);
  }
  return out;
}
function replaceRebuildScanGeometry(){
  if(!replaceOriginalGeo || !replaceMesh) return;
  var cyls = replacePlaced.filter(function(p){ return p.cutScan === true && p.position && p.axisDir; })
    .map(function(p){
      var prof = _replaceMadreProfile(p);            // 8.55.0: silhouette PER-ANGOLO del madre
      var _R = replaceEstimateMarkerRadius(p);       // fallback circolare (single-mesh / profilo assente; _R include l'offset)
      var _profMax = 0; if(prof && prof.prof){ for(var _pi = 0; _pi < prof.prof.length; _pi++){ if(prof.prof[_pi] > _profMax) _profMax = prof.prof[_pi]; } }
      var _off = (p.cutOffset || 0), _axLo = null, _axHi = null;   // 8.59.6: taglio = forma del madre + offset, non piu' ±30mm passante
      if(prof && isFinite(prof.axMin) && isFinite(prof.axMax)){
        _axLo = Math.max(prof.axMin - _off, -REPLACE_CUT_HALFH);   // clamp a ±30mm = mai PIU' largo di prima
        _axHi = Math.min(prof.axMax + _off,  REPLACE_CUT_HALFH);
      }
      return { cp: p.position, ax: p.axisDir.clone().normalize(), prof: prof, off: _off,
               R2: _R * _R, halfH: REPLACE_CUT_HALFH, profMax: _profMax, R: Math.sqrt(_R * _R), axLo: _axLo, axHi: _axHi };
    });
  if(!cyls.length){
    replaceMesh.geometry.dispose();
    replaceMesh.geometry = replaceOriginalGeo.clone();
    replaceMesh.geometry.computeVertexNormals();
    return;
  }
  var pos = replaceOriginalGeo.attributes.position.array, nTri = pos.length / 9, kept = [];
  for(var i = 0; i < nTri; i++){
    var ni = i * 9;
    var cx = (pos[ni] + pos[ni+3] + pos[ni+6]) / 3, cy = (pos[ni+1] + pos[ni+4] + pos[ni+7]) / 3, cz = (pos[ni+2] + pos[ni+5] + pos[ni+8]) / 3;
    var inside = false;
    for(var c = 0; c < cyls.length; c++){
      var k = cyls[c];
      var dx = cx - k.cp.x, dy = cy - k.cp.y, dz = cz - k.cp.z;
      var axial = dx*k.ax.x + dy*k.ax.y + dz*k.ax.z;
      if(k.axLo != null){ if(axial < k.axLo || axial > k.axHi) continue; }   // 8.59.6: solo la forma del madre (+offset), non ±30mm passante
      else if(Math.abs(axial) > k.halfH) continue;
      var rx = dx - axial*k.ax.x, ry = dy - axial*k.ax.y, rz = dz - axial*k.ax.z;
      var r2v = rx*rx + ry*ry + rz*rz;
      if(k.prof){   // 8.55.0: soglia PER-ANGOLO = raggio del madre nel settore + offset utente
        var cu = rx*k.prof.u.x + ry*k.prof.u.y + rz*k.prof.u.z, cw = rx*k.prof.w.x + ry*k.prof.w.y + rz*k.prof.w.z;
        var bi = Math.floor((Math.atan2(cw, cu) + Math.PI) / (2*Math.PI) * k.prof.NB);
        if(bi < 0) bi = 0; else if(bi >= k.prof.NB) bi = k.prof.NB - 1;
        var thr = k.prof.prof[bi] + k.off;
        if(r2v <= thr*thr){ inside = true; break; }
      } else if(r2v <= k.R2){ inside = true; break; }
    }
    if(!inside){ for(var v = 0; v < 9; v++) kept.push(pos[ni + v]); }
  }
  if(kept.length >= 36) kept = _replaceRemoveCutIslands(kept, cyls);   // 8.59.4: rimuovi le ISOLE sospese (frammenti staccati nella zona del taglio)
  replaceMesh.geometry.dispose();
  var ng = new THREE.BufferGeometry();
  ng.setAttribute('position', new THREE.Float32BufferAttribute(kept, 3));
  ng.computeVertexNormals();
  replaceMesh.geometry = ng;
}
function replaceToggleMarkerCut(num, on){
  if(_replaceCutRebuildTimer){ clearTimeout(_replaceCutRebuildTimer); _replaceCutRebuildTimer = null; }   // 8.54.0: annulla debounce pendente
  for(var i = 0; i < replacePlaced.length; i++){ if(replacePlaced[i].num === num){ replacePlaced[i].cutScan = !!on; break; } }
  replaceRebuildScanGeometry(); replaceRebuildTree();
}
function replaceToggleAllCuts(on){
  replacePlaced.forEach(function(p){ p.cutScan = !!on; });
  replaceRebuildScanGeometry(); replaceRebuildTree();
}

function replaceSetMarkerCutOffset(num, mmStr){
  var mm = Math.max(0, Math.min(5, parseFloat(mmStr) || 0));   // 8.54.0: step 0.1mm, max 5mm (zona utile)
  for(var i = 0; i < replacePlaced.length; i++){
    if(replacePlaced[i].num === num){
      replacePlaced[i].cutOffset = mm;
      var lbl = document.getElementById('replaceCutLbl_' + num);
      if(lbl) lbl.textContent = '+' + mm.toFixed(1) + 'mm';
      break;
    }
  }
  // 8.54.0 (review perf): la ricostruzione della geometria scansione (~240k triangoli) è pesante;
  // debounce ~120ms -> anteprima quasi-live durante il drag senza ricostruire a ogni tick.
  if(_replaceCutRebuildTimer) clearTimeout(_replaceCutRebuildTimer);
  _replaceCutRebuildTimer = setTimeout(function(){ _replaceCutRebuildTimer = null; replaceRebuildScanGeometry(); }, 120);
}

// ===== 8.46.0 (feedback utente "arriva il pulsante concludi e esporta file"): CONCLUDI / EXPORT STL =====
// Esporta i SOSTITUTI (figli, p.meshSub) di tutti gli impianti piazzati, trasformati in MONDO
// (group.matrixWorld), come unico STL binario (writeBinarySTL, gemello dell'export Sostituire).
// La MADRE (sorgente, riferimento di match) NON viene esportata: il deliverable e' il sostituto IPD.
function replaceExportSTL(){
  if(!replacePlaced.length){ replaceShowStatus('Niente da esportare: piazza e conferma almeno un impianto.', true); return; }
  var defaultBase = 'replace_sostituti';
  var slot = document.getElementById('replaceSlotScan');
  if(slot){ var fn = slot.querySelector('.fname'); if(fn) defaultBase = fn.textContent.replace(/\.stl$/i, '') + '_sostituti'; }
  var inp = document.getElementById('replaceExportName'); if(inp) inp.value = defaultBase;
  var dlg = document.getElementById('replaceExportDialog'); if(dlg) dlg.style.display = 'flex';
  if(inp){ inp.focus(); inp.select(); }
}

function _replaceDoExportSTL(base){
  var tris = [], V = new THREE.Vector3(), nmat = new THREE.Matrix3();
  replacePlaced.forEach(function(p){
    var mesh = p.meshSub; if(!mesh || !mesh.geometry || !mesh.geometry.attributes.position) return;
    p.group.updateMatrixWorld(true);
    var mw = p.group.matrixWorld; nmat.getNormalMatrix(mw);
    var pos = mesh.geometry.attributes.position.array;
    var nrm = mesh.geometry.attributes.normal ? mesh.geometry.attributes.normal.array : null;
    var nTri = pos.length / 9;
    for(var i = 0; i < nTri; i++){
      var o = i*9, vs = [];
      for(var v = 0; v < 3; v++){ V.set(pos[o+v*3], pos[o+v*3+1], pos[o+v*3+2]).applyMatrix4(mw); vs.push([V.x, V.y, V.z]); }
      var nx, ny, nz;
      if(nrm){
        var N = new THREE.Vector3((nrm[o]+nrm[o+3]+nrm[o+6])/3, (nrm[o+1]+nrm[o+4]+nrm[o+7])/3, (nrm[o+2]+nrm[o+5]+nrm[o+8])/3).applyMatrix3(nmat).normalize();
        nx = N.x; ny = N.y; nz = N.z;
      } else {
        var ax = vs[1][0]-vs[0][0], ay = vs[1][1]-vs[0][1], az = vs[1][2]-vs[0][2];
        var bx = vs[2][0]-vs[0][0], by = vs[2][1]-vs[0][1], bz = vs[2][2]-vs[0][2];
        var cx = ay*bz-az*by, cy = az*bx-ax*bz, cz = ax*by-ay*bx, L = Math.sqrt(cx*cx+cy*cy+cz*cz) || 1;
        nx = cx/L; ny = cy/L; nz = cz/L;
      }
      tris.push({ n: [nx, ny, nz], v: vs });
    }
  });
  if(!tris.length){ replaceShowStatus('Niente geometria da esportare.', true); return; }
  try {
    var blob = writeBinarySTL(tris, 'Syntesis-ICP Replace-iT export');
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href = url; a.download = base + '.stl';
    document.body.appendChild(a); a.click();
    setTimeout(function(){ document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
    replaceShowStatus('Esportati ' + replacePlaced.length + ' sostituto/i in ' + base + '.stl (' + Math.round(tris.length) + ' triangoli).');
  } catch(e){ replaceShowStatus('Errore export STL: ' + (e && e.message ? e.message : e), true); }
}
// 8.49.0 — focus camera su un impianto (doppio-clic sul nome nell'albero). Inquadra il
// FIGLIO piazzato (p.meshSub, fallback group) calcolandone la bbox IN MONDO; porta
// controls.target sul centro e avvicina la camera mantenendo la direzione di vista
// corrente (no salto di angolazione). Animazione ease-out ~280ms (pattern di installAltClickPivot).
function replaceFocusImplant(num){
  if(typeof controls === 'undefined' || !controls || typeof camera === 'undefined' || !camera) return;
  var p = null; for(var i = 0; i < replacePlaced.length; i++){ if(replacePlaced[i].num === num){ p = replacePlaced[i]; break; } }
  if(!p) return;
  // Inquadra direttamente il figlio (o la madre) — non il group, che include la terna
  // AxesHelper e gonfierebbe la bbox; la visibilità non conta (la posa è la stessa).
  var obj = p.meshSub || p.meshSrc || p.group;
  if(!obj) return;
  var box; try { box = new THREE.Box3().setFromObject(obj); } catch(e){ return; }
  if(!box || box.isEmpty()) return;
  var center = box.getCenter(new THREE.Vector3());
  var size = box.getSize(new THREE.Vector3());
  var rad = Math.max(size.length() * 0.5, 0.5);
  var dir = camera.position.clone().sub(controls.target);
  if(dir.lengthSq() < 1e-9) dir.set(1, 0.7, 1);
  dir.normalize();
  var fov = (camera.fov || 28) * Math.PI / 180;
  var dist = (rad / Math.tan(fov / 2)) * 1.7;
  var endPos = center.clone().add(dir.multiplyScalar(dist));
  var startTgt = controls.target.clone(), startPos = camera.position.clone();
  var t0 = performance.now(), DUR = 280;
  (function step(){
    var t = (performance.now() - t0) / DUR; if(t > 1) t = 1;
    var e = 1 - Math.pow(1 - t, 3);
    controls.target.copy(startTgt).lerp(center, e);
    camera.position.copy(startPos).lerp(endPos, e);
    controls.update();
    if(t < 1) requestAnimationFrame(step);
  })();
  replaceShowStatus('Inquadrato ' + (p.toothLabel ? ('dente ' + p.toothLabel) : ('impianto #' + num)) + '.');
}
// 8.49.0 — rinomina dentale dell'impianto (numero dente FDI, es. "26"). Vuoto = ripristina
// "#N impianto". Input libero (≤6 char) escapato in render via _escHtml. NB: non persistito
// (saveCase non salva ancora il workflow replace — item audit separato).
function replaceRenameImplant(num){
  var p = null; for(var i = 0; i < replacePlaced.length; i++){ if(replacePlaced[i].num === num){ p = replacePlaced[i]; break; } }
  if(!p) return;
  var v = window.prompt('Numero dente (notazione FDI, es. 26). Vuoto = "#' + num + ' impianto":', p.toothLabel || '');
  if(v === null) return;
  p.toothLabel = String(v).trim().slice(0, 6);
  replaceRebuildTree();
}
function replaceRebuildTree(){
  var layerTree = document.getElementById('layerTree');
  if(!layerTree) return;
  if(typeof analysisMode !== 'undefined' && analysisMode !== 'replace') return;   // albero condiviso: solo in replace
  var h = '';
  if(replaceMesh){
    var scanHex = (replaceMesh.material && replaceMesh.material.color) ? ('#' + replaceMesh.material.color.getHexString()) : '#c4a48c';
    h += '<div class="tree-group-header">FILE / SCANSIONI<span class="group-count">1</span></div>';
    h += '<div class="tree-node">' +
         '<span style="width:12px"></span>' +
         '<input type="checkbox" ' + (replaceMesh.visible ? 'checked' : '') + ' onchange="replaceToggleScanVisibility(this.checked)">' +
         '<input type="color" class="tree-color" value="' + scanHex + '" title="Colore scansione" onchange="setSceneObjectColor(\'replacescan\', this.value)" onclick="event.stopPropagation()">' +
         '<span class="lbl" style="flex:1">Scansione</span>' +
         '<span class="tree-opacity-value" id="replaceOpLblScan">' + Math.round(replaceScanUI.opacity * 100) + '%</span>' +
         '</div>';
    h += '<div class="tree-opacity-row">' +
         '<input type="range" class="tree-opacity-slider" min="10" max="100" step="1" value="' + Math.round(replaceScanUI.opacity * 100) + '"' +
         ' oninput="replaceSetScanOpacity(this.value)" style="accent-color:' + scanHex + '" title="Trasparenza scansione">' +
         '</div>';
  }
  if(replacePlaced.length){
    var anyCut = replacePlaced.some(function(p){ return p.cutScan === true; });
    var allCut = replacePlaced.every(function(p){ return p.cutScan === true; });
    var collapsed = replaceTreeUI.markersCollapsed;
    // header gruppo MARKER: pillola .tree-group-header (= Analizza), chevron per il collapse
    h += '<div class="tree-group-header" onclick="replaceToggleMarkersCollapse()" style="cursor:pointer" title="Mostra/nascondi i marker">' +
         '<span class="chevron">' + (collapsed ? '&#9656;' : '&#9662;') + '</span>MARKER' +
         '<span class="group-count">' + replacePlaced.length + '</span></div>';
    if(!collapsed){
      replacePlaced.forEach(function(p){
        var hex = '#' + ('000000' + p.color.toString(16)).slice(-6);
        var vis = p.group ? p.group.visible : true;
        // 8.49.0: nome impianto = "#N · <dente>" se rinominato (FDI), altrimenti "#N impianto".
        var _libNm = _replaceLibId(p);   // 8.53.0
        var implName = p.toothLabel ? ('#' + p.num + ' · ' + _escHtml(p.toothLabel)) : ('#' + p.num + (_libNm ? ' ' + _escHtml(_libNm) : ' impianto'));
        if(p.meshSrc){
          // 8.33.0: marker AUTO-POSA = coppia MADRE (sorgente) + FIGLIO (sostituto), legati
          // dall'origine condivisa. Header = on/off dell'impianto; due sotto-voci INDIPENDENTI
          // (visibilita'+colore) + origine x0/y0/z0. Entrambi compaiono nell'albero.
          var srcHex = (p.meshSrc.material && p.meshSrc.material.color) ? ('#' + p.meshSrc.material.color.getHexString()) : '#8090a8';
          h += '<div class="tree-node" style="padding-left:18px">' +
               '<input type="checkbox" ' + (vis ? 'checked' : '') + ' onchange="replaceTogglePlacedVisibility(' + p.num + ', this.checked)">' +
               '<span class="lbl" style="flex:1;font-weight:700;cursor:pointer' + (p.num === replaceActiveNum ? ';color:var(--blue)' : '') + '" onclick="replaceSetActiveImplant(' + p.num + ')" ondblclick="replaceFocusImplant(' + p.num + ')" title="Clic: attiva per la Raffina · doppio clic: inquadra l\'impianto">' + (p.num === replaceActiveNum ? '▸ ' : '') + implName + '</span>' +
               '<button class="del-btn" onclick="replaceRenameImplant(' + p.num + ')" title="Rinomina (numero dente)">✎</button>' +
               (p.rmsd != null ? '<span class="expert-only" style="font-family:var(--mono);font-size:10px;color:var(--gray);min-width:42px;text-align:right">' + (Math.round(p.rmsd * 1000) / 1000) + 'mm</span>' : '') +
               '<button class="del-btn" onclick="replaceDeletePlaced(\'' + p.id + '\')" title="Elimina impianto #' + p.num + '">✕</button>' +
               '</div>';
          h += '<div class="tree-node sub" style="padding-left:36px" title="CAD MADRE (sorgente) accoppiato alla scansione dall\'ICP">' +
               '<input type="checkbox" ' + ((p.showSrc !== false) ? 'checked' : '') + ' onchange="replaceSetMarkerMeshVis(' + p.num + ',\'src\',this.checked)">' +
               '<input type="color" class="tree-color" value="' + srcHex + '" title="Colore MADRE" onchange="setSceneObjectColor(\'replacesrc:' + p.num + '\', this.value)" onclick="event.stopPropagation()">' +
               '<span class="lbl">Madre · ' + (p.srcTypeLabel || 'sorgente') + '</span>' +
               '</div>';
          // 8.39.0: slider trasparenza Madre (per-oggetto)
          var _srcOp = (p.meshSrc.material && p.meshSrc.material.opacity != null) ? p.meshSrc.material.opacity : 0.5;
          h += '<div class="tree-opacity-row" style="padding-left:54px">' +
               '<input type="range" class="tree-opacity-slider" min="10" max="100" step="1" value="' + Math.round(_srcOp * 100) + '"' +
               ' oninput="replaceSetMarkerOpacity(' + p.num + ',\'src\',this.value)" onclick="event.stopPropagation()" style="accent-color:var(--ghost)" title="Trasparenza Madre">' +
               '<span id="replaceOpLbl_src_' + p.num + '" class="tree-opacity-value">' + Math.round(_srcOp * 100) + '%</span>' +
               '</div>';
          // 8.38.0: il FIGLIO e' un DROPDOWN -> richiami un altro IPD della stessa madre (swap geometria, stessa posa)
          var _figSel;
          if(p.libTypes && p.libTypes.length){
            var _opts = '';
            for(var _ti = 0; _ti < p.libTypes.length; _ti++){
              var _lt = p.libTypes[_ti];
              _opts += '<option value="' + _lt.ord + '"' + (_lt.ord === p.typeOrd ? ' selected' : '') + '>' + _lt.label + (_lt.eng ? ' ·ENG' : ' ·Non-ENG') + '</option>';
            }
            _figSel = '<select title="Cambia il figlio (sostituto IPD) — stessa posa, niente ri-accoppiamento" onchange="replaceSwapFiglio(' + p.num + ', parseInt(this.value,10))" onclick="event.stopPropagation()" style="flex:1;min-width:0;font-family:var(--mono);font-size:10px;padding:1px 2px;border:1px solid var(--border);border-radius:3px;background:var(--white);color:var(--dark)">' + _opts + '</select>';
          } else {
            _figSel = '<span class="lbl">' + (p.typeLabel || ('type ' + p.typeOrd)) + '</span>';
          }
          h += '<div class="tree-node sub" style="padding-left:36px" title="CAD FIGLIO (sostituto IPD) — cambialo dal menu, stessa posa">' +
               '<input type="checkbox" ' + ((p.showSub !== false) ? 'checked' : '') + ' onchange="replaceSetMarkerMeshVis(' + p.num + ',\'sub\',this.checked)">' +
               '<input type="color" class="tree-color" value="' + hex + '" title="Colore FIGLIO" onchange="setSceneObjectColor(\'replace:' + p.num + '\', this.value)" onclick="event.stopPropagation()">' +
               '<span class="lbl" style="flex:0 0 auto;color:var(--gray)">Figlio</span>' +
               _figSel +
               '</div>';
          // 8.39.0: slider trasparenza Figlio (per-oggetto)
          var _subOp = (p.meshSub.material && p.meshSub.material.opacity != null) ? p.meshSub.material.opacity : 0.9;
          h += '<div class="tree-opacity-row" style="padding-left:54px">' +
               '<input type="range" class="tree-opacity-slider" min="10" max="100" step="1" value="' + Math.round(_subOp * 100) + '"' +
               ' oninput="replaceSetMarkerOpacity(' + p.num + ',\'sub\',this.value)" onclick="event.stopPropagation()" style="accent-color:' + hex + '" title="Trasparenza Figlio">' +
               '<span id="replaceOpLbl_sub_' + p.num + '" class="tree-opacity-value">' + Math.round(_subOp * 100) + '%</span>' +
               '</div>';
          h += '<div class="tree-node sub" style="padding-left:36px">' +
               '<input type="checkbox" ' + (p.showOrigin ? 'checked' : '') + ' onchange="replaceToggleMarkerOrigin(' + p.num + ',this.checked)">' +
               '<span class="dot" style="background:var(--blue)"></span>' +
               '<span class="lbl">origine x0/y0/z0</span>' +
               '</div>';
        } else {
          // marker singola-mesh (ramo "Allinea a 3 punti") -> riga classica
          h += '<div class="tree-node" style="padding-left:18px">' +
               '<input type="checkbox" ' + (vis ? 'checked' : '') + ' onchange="replaceTogglePlacedVisibility(' + p.num + ', this.checked)">' +
               '<input type="color" class="tree-color" value="' + hex + '" title="Colore marker #' + p.num + '" onchange="setSceneObjectColor(\'replace:' + p.num + '\', this.value)" onclick="event.stopPropagation()">' +
               '<span class="lbl" style="flex:1;cursor:pointer' + (p.num === replaceActiveNum ? ';color:var(--blue);font-weight:700' : '') + '" onclick="replaceSetActiveImplant(' + p.num + ')" ondblclick="replaceFocusImplant(' + p.num + ')" title="Clic: attiva per la Raffina · doppio clic: inquadra l\'impianto">' + (p.num === replaceActiveNum ? '▸ ' : '') + (p.toothLabel ? ('#' + p.num + ' · ' + _escHtml(p.toothLabel)) : ('#' + p.num + ' ' + (_libNm ? _escHtml(_libNm) : (p.typeLabel || ('type ' + p.typeOrd))))) + '</span>' +
               '<button class="del-btn" onclick="replaceRenameImplant(' + p.num + ')" title="Rinomina (numero dente)">✎</button>' +
               (p.rmsd != null ? '<span class="expert-only" style="font-family:var(--mono);font-size:10px;color:var(--gray);min-width:42px;text-align:right">' + (Math.round(p.rmsd * 1000) / 1000) + 'mm</span>' : '') +
               '<button class="del-btn" onclick="replaceDeletePlaced(\'' + p.id + '\')" title="Elimina marker #' + p.num + '">✕</button>' +
               '</div>';
        }
        // sub-riga: Taglia scansione attorno a QUESTO marker (buco per vederlo seduto) — comune
        h += '<div class="tree-node sub" style="padding-left:36px">' +
             '<input type="checkbox" ' + (p.cutScan ? 'checked' : '') + ' onchange="replaceToggleMarkerCut(' + p.num + ', this.checked)">' +
             '<span class="dot" style="background:#889aad;border:1px dashed var(--dark)"></span>' +
             '<span class="lbl">Taglia scansione</span>' +
             // 8.54.0: slider offset di taglio (solo se attivo) -> allarga il buco attorno al MADRE
             (p.cutScan ? (
               '<input type="range" class="tree-opacity-slider" min="0" max="5" step="0.1" value="' + (p.cutOffset || 0) + '"' +
               ' oninput="replaceSetMarkerCutOffset(' + p.num + ', this.value)" onclick="event.stopPropagation()"' +
               ' style="accent-color:#889aad" title="Offset di taglio attorno al ' + (p.meshSrc ? 'madre' : 'marker') + ': allarga il buco nella scansione">' +
               '<span id="replaceCutLbl_' + p.num + '" class="tree-opacity-value" style="min-width:34px">+' + (p.cutOffset || 0).toFixed(1) + 'mm</span>'
             ) : '') +
             '</div>';
      });
    }
    // massivo: Taglia scansione (tutti) — gemello di toggleAllScanbodyCuts di Analizza
    h += '<div class="tree-node" style="margin-top:4px">' +
         '<span style="width:12px"></span>' +
         '<input type="checkbox" ' + ((anyCut && allCut) ? 'checked' : '') + ((anyCut && !allCut) ? ' data-indet="1"' : '') + ' onchange="replaceToggleAllCuts(this.checked)">' +
         '<span class="dot" style="background:#889aad;border:1px dashed var(--dark)"></span>' +
         '<span class="lbl">Taglia scansione (tutti)</span>' +
         '</div>';
  }
  if(!replaceMesh && !replacePlaced.length){
    h = '<div class="tree-node"><span class="lbl" style="color:var(--gray);font-size:12px">Nessun oggetto. Carica una scansione.</span></div>';
  }
  layerTree.innerHTML = h;
  layerTree.querySelectorAll('input[data-indet="1"]').forEach(function(cb){ cb.indeterminate = true; });
  // 8.39.0: dopo ogni ricostruzione (load/conferma/swap figlio/taglio scansione) riapplico
  // la modalita' di render globale alle mesh replace (mesh nuove o ri-geometrizzate incluse).
  try { replaceApplyRenderMode(); } catch(e){}
}

// Elimina un marker piazzato (group + i suoi 3 dot) dalla scena e dal record.
// Copre "cancellare uno scanbody / tornare indietro" (qualsiasi riga, anche l'ultima).
function replaceDeletePlaced(id){
  var i = -1;
  for(var k = 0; k < replacePlaced.length; k++){ if(replacePlaced[k].id === id){ i = k; break; } }
  if(i < 0) return;
  if(_replaceCutRebuildTimer){ clearTimeout(_replaceCutRebuildTimer); _replaceCutRebuildTimer = null; }   // 8.54.0: annulla debounce pendente (no rebuild tardivo dopo delete)
  var p = replacePlaced[i];
  if(replaceActiveNum === p.num) replaceActiveNum = null;   // 8.56.0: l'attivo eliminato -> torna all'ultimo (resolver)
  if(p.group){ _replaceDisposeGroup(p.group); scene.remove(p.group); }   // 8.32.0: mesh (cache) + sorgente + terna origine
  (p.dotMeshes || []).forEach(_replaceDisposeDot);
  if(p.labelEl && p.labelEl.parentNode) p.labelEl.parentNode.removeChild(p.labelEl);
  replacePlaced.splice(i, 1);
  try { replaceRebuildScanGeometry(); } catch(e){}   // 2b-3d: richiude il buco "Taglia scansione" del marker rimosso
  replaceRebuildPlacedList();
  replaceShowStatus('Scanbody rimosso.');
}

// "Avanti / nuovo": prepara il piazzamento del prossimo scanbody (azzera type,
// seme e anteprima); i marker gia' piazzati restano in scena.
function replaceNextScanbody(){
  // 8.36.0: "Avanti" = nuovo impianto -> riparte DIRETTO dai 3 punti (come "+ Nuovo impianto").
  replaceStartNewImplant();
}

// 8.48.0: motore ICP Replace (syntesis_replace_icp): 'p2point' (DEFAULT = produzione attuale, Kabsch senza rifiuto) | 'p2plane' (BETA: point-to-plane + rifiuto-normali). Toggle in Impostazioni > Algoritmo. Default OFF: validazione sintetica non conclusiva (cilindro liscio = test debole), serve A/B su scan reale.
function replaceICPRead(){ try { return localStorage.getItem('syntesis_replace_icp') === 'p2plane'; } catch(e){ return false; } }
// Solver lineare n x n (eliminazione di Gauss + pivot parziale). Ritorna x oppure null se singolare.
function _replaceSolveLin(A, b){
  var n = b.length, M = [];
  for(var i = 0; i < n; i++){ M.push(A[i].slice()); M[i].push(b[i]); }
  for(var col = 0; col < n; col++){
    var piv = col, mx = Math.abs(M[col][col]);
    for(var r = col + 1; r < n; r++){ var v = Math.abs(M[r][col]); if(v > mx){ mx = v; piv = r; } }
    if(mx < 1e-12) return null;
    if(piv !== col){ var tmp = M[piv]; M[piv] = M[col]; M[col] = tmp; }
    var d = M[col][col];
    for(var r2 = 0; r2 < n; r2++){ if(r2 === col) continue; var f = M[r2][col] / d; if(f === 0) continue; for(var c = col; c <= n; c++) M[r2][c] -= f * M[col][c]; }
  }
  var x = []; for(var i2 = 0; i2 < n; i2++) x.push(M[i2][n] / M[i2][i2]); return x;
}
// matrice di rotazione 3x3 da un vettore di rotazione omega (Rodrigues); th = |omega|.
function _replaceRotFromOmega(om, th){
  if(th < 1e-9) return [[1,0,0],[0,1,0],[0,0,1]];
  var kx = om[0]/th, ky = om[1]/th, kz = om[2]/th, c = Math.cos(th), s = Math.sin(th), v = 1 - c;
  return [
    [c + kx*kx*v,    kx*ky*v - kz*s, kx*kz*v + ky*s],
    [ky*kx*v + kz*s, c + ky*ky*v,    ky*kz*v - kx*s],
    [kz*kx*v - ky*s, kz*ky*v + kx*s, c + kz*kz*v]
  ];
}
function _replaceDoRefine(p){
  if(!replaceMesh || !p || !p.group) return null;
  var mesh = p.group.children && p.group.children[0];
  if(!mesh || !mesh.geometry) return null;
  var _useP2P = (typeof replaceICPRead === 'function') ? replaceICPRead() : false;   // 8.48.0: point-to-plane + rifiuto-normali solo se beta ON; default = produzione (Kabsch, no rifiuto)
  p.group.updateMatrixWorld(true);
  var m = p.group.matrixWorld.elements;
  var nmat = new THREE.Matrix3().getNormalMatrix(p.group.matrixWorld);
  // 2b-3f: l'ICP campiona la geometria SORGENTE (p.srcGeo, = brand scansionato) anche
  // quando il group MOSTRA il sostituto -> allineando il sorgente alla scansione, il
  // sostituto (stesso group/frame condiviso) si posiziona, rotazione inclusa.
  var geo = p.srcGeo || mesh.geometry;
  var cadPos = geo.attributes.position.array;
  var cadNorm = geo.attributes.normal ? geo.attributes.normal.array : null;
  var nCadTri = cadPos.length / 9;
  var axis = p.axisDir.clone().normalize();
  var axx = axis.x, axy = axis.y, axz = axis.z;

  // 1. campiona ~400 punti marker nel mondo + pesi
  var step = Math.max(1, Math.floor((nCadTri * 3) / 400));
  var tplWorld = [], tplW = [], tplN = [], cen = [0, 0, 0];
  for(var ti = 0; ti < nCadTri; ti++){
    for(var vi = 0; vi < 3; vi++){
      if(((ti * 3) + vi) % step !== 0) continue;
      var o = ti * 9 + vi * 3;
      var lx = cadPos[o], ly = cadPos[o+1], lz = cadPos[o+2];
      var wx = m[0]*lx + m[4]*ly + m[8]*lz  + m[12];
      var wy = m[1]*lx + m[5]*ly + m[9]*lz  + m[13];
      var wz = m[2]*lx + m[6]*ly + m[10]*lz + m[14];
      tplWorld.push([wx, wy, wz]); cen[0]+=wx; cen[1]+=wy; cen[2]+=wz;
      var w = 1.0, _tn = null;
      if(cadNorm){
        var wn = new THREE.Vector3(cadNorm[o], cadNorm[o+1], cadNorm[o+2]).applyMatrix3(nmat).normalize();
        if(Math.abs(wn.x*axx + wn.y*axy + wn.z*axz) > 0.8) w = 5.0; // faccia piatta -> planarita'
        _tn = [wn.x, wn.y, wn.z];
      }
      tplW.push(w); tplN.push(_tn);
    }
  }
  if(tplWorld.length < 50) return null;
  cen[0]/=tplWorld.length; cen[1]/=tplWorld.length; cen[2]/=tplWorld.length;

  // estensione marker lungo l'asse + radiale -> parametri del crop
  var zMin = Infinity, zMax = -Infinity, rMax = 0;
  for(var i = 0; i < tplWorld.length; i++){
    var dx = tplWorld[i][0]-cen[0], dy = tplWorld[i][1]-cen[1], dz = tplWorld[i][2]-cen[2];
    var zp = dx*axx + dy*axy + dz*axz; if(zp < zMin) zMin = zp; if(zp > zMax) zMax = zp;
    var rx = dx - zp*axx, ry = dy - zp*axy, rz = dz - zp*axz; var r = Math.sqrt(rx*rx + ry*ry + rz*rz); if(r > rMax) rMax = r;
  }
  var MARG = 1.5;
  var zLo = zMin - MARG, zHi = zMax + MARG, radLim2 = (rMax + MARG) * (rMax + MARG);

  // 2. crop cilindrico della scansione attorno al marker (geometria ORIGINALE,
  //    mai tagliata -> il "Taglia scansione" non svuota il crop della Raffina, 2b-3d)
  var scanPos = (replaceOriginalGeo || replaceMesh.geometry).attributes.position.array;
  var nScanTri = scanPos.length / 9;
  var scanPts = [], scanN = [];
  for(var i = 0; i < nScanTri; i++){
    var oi = i * 9;
    var px = (scanPos[oi]   + scanPos[oi+3] + scanPos[oi+6]) / 3;
    var py = (scanPos[oi+1] + scanPos[oi+4] + scanPos[oi+7]) / 3;
    var pz = (scanPos[oi+2] + scanPos[oi+5] + scanPos[oi+8]) / 3;
    var dx = px-cen[0], dy = py-cen[1], dz = pz-cen[2];
    var zp = dx*axx + dy*axy + dz*axz; if(zp < zLo || zp > zHi) continue;
    var rx = dx - zp*axx, ry = dy - zp*axy, rz = dz - zp*axz; if(rx*rx + ry*ry + rz*rz > radLim2) continue;
    var e1x = scanPos[oi+3]-scanPos[oi], e1y = scanPos[oi+4]-scanPos[oi+1], e1z = scanPos[oi+5]-scanPos[oi+2];
    var e2x = scanPos[oi+6]-scanPos[oi], e2y = scanPos[oi+7]-scanPos[oi+1], e2z = scanPos[oi+8]-scanPos[oi+2];
    var snx = e1y*e2z - e1z*e2y, sny = e1z*e2x - e1x*e2z, snz = e1x*e2y - e1y*e2x;
    var sl = Math.sqrt(snx*snx + sny*sny + snz*snz) || 1;
    scanPts.push([px, py, pz]); scanN.push([snx/sl, sny/sl, snz/sl]);
  }
  if(scanPts.length < 50) return null;
  if(scanPts.length > 1500){ var stride = Math.ceil(scanPts.length / 1500); var sub = [], subN = []; for(var k = 0; k < scanPts.length; k += stride){ sub.push(scanPts[k]); subN.push(scanN[k]); } scanPts = sub; scanN = subN; }

  // 3. ICP point-to-plane (8.48.0) + outlier + rifiuto-normali (fallback point-to-point Kabsch)
  var moving = tplWorld.map(function(pt){ return pt.slice(); });
  var Racc = [[1,0,0],[0,1,0],[0,0,1]], tAcc = [0,0,0], prevR = Infinity;
  for(var it = 0; it < 35; it++){
    var pairD = [], pairF = [], pairM = [], pairN = [], pairOK = [];
    for(var mi = 0; mi < moving.length; mi++){
      var bD = Infinity, bJ = -1, mp = moving[mi];
      for(var fj = 0; fj < scanPts.length; fj++){
        var fp = scanPts[fj]; var a = mp[0]-fp[0], b = mp[1]-fp[1], c = mp[2]-fp[2]; var d2 = a*a + b*b + c*c;
        if(d2 < bD){ bD = d2; bJ = fj; }
      }
      // rifiuto per incompatibilita' di NORMALI (sorgente<->scansione): |cos| basso => gengiva/back-face.
      var _ok = true;
      if(_useP2P && REPLACE_NORMAL_REJECT_COS >= 0 && tplN[mi] && bJ >= 0 && scanN[bJ]){
        var _dn = tplN[mi][0]*scanN[bJ][0] + tplN[mi][1]*scanN[bJ][1] + tplN[mi][2]*scanN[bJ][2];
        if(Math.abs(_dn) < REPLACE_NORMAL_REJECT_COS) _ok = false;
      }
      pairD.push(Math.sqrt(bD)); pairF.push(scanPts[bJ]); pairM.push(mp); pairN.push(bJ >= 0 ? scanN[bJ] : null); pairOK.push(_ok);
    }
    var sd = pairD.slice().sort(function(a,b){ return a-b; });
    var th = sd[Math.floor(sd.length/2)] * 2.5 + 0.05;
    var gM = [], gF = [], gW = [], gN = [];
    for(var pi = 0; pi < pairD.length; pi++){ if(pairD[pi] <= th && pairOK[pi]){ gM.push(pairM[pi]); gF.push(pairF[pi]); gW.push(tplW[pi]); gN.push(pairN[pi]); } }
    if(gM.length < 15) break;
    // SOLVE: point-to-plane (min sum_i w ((R p_i + t - q_i).n_i)^2, lineariz. -> 6x6) o fallback Kabsch.
    var Rstep = null, tStep = null;
    if(_useP2P){
      var ATA = [[0,0,0,0,0,0],[0,0,0,0,0,0],[0,0,0,0,0,0],[0,0,0,0,0,0],[0,0,0,0,0,0],[0,0,0,0,0,0]], ATb = [0,0,0,0,0,0], usable = true;
      for(var gi = 0; gi < gM.length; gi++){
        var P = gM[gi], Q = gF[gi], N = gN[gi], wv = gW[gi];
        if(!N){ usable = false; break; }
        var cx = P[1]*N[2]-P[2]*N[1], cy = P[2]*N[0]-P[0]*N[2], cz = P[0]*N[1]-P[1]*N[0];
        var aRow = [cx, cy, cz, N[0], N[1], N[2]];
        var e = -((P[0]-Q[0])*N[0] + (P[1]-Q[1])*N[1] + (P[2]-Q[2])*N[2]);
        for(var rr = 0; rr < 6; rr++){ var aw = wv*aRow[rr]; for(var cc = 0; cc < 6; cc++) ATA[rr][cc] += aw*aRow[cc]; ATb[rr] += aw*e; }
      }
      if(usable){
        var x = _replaceSolveLin(ATA, ATb);
        if(x && isFinite(x[0]+x[1]+x[2]+x[3]+x[4]+x[5])){
          var om = [x[0], x[1], x[2]], thw = Math.sqrt(om[0]*om[0]+om[1]*om[1]+om[2]*om[2]), tmag = Math.sqrt(x[3]*x[3]+x[4]*x[4]+x[5]*x[5]);
          if(thw < 0.5 && tmag < 2.0){   // guardia anti-passo-instabile per singolo step (rad/mm)
            Rstep = _replaceRotFromOmega(om, thw); tStep = [x[3], x[4], x[5]];
          }
        }
      }
    }
    if(!Rstep){ var kb = kabsch(gM, gF, gW); Rstep = kb.R; tStep = kb.t; }
    for(var mi2 = 0; mi2 < moving.length; mi2++){
      var pt = moving[mi2];
      moving[mi2] = [
        Rstep[0][0]*pt[0] + Rstep[0][1]*pt[1] + Rstep[0][2]*pt[2] + tStep[0],
        Rstep[1][0]*pt[0] + Rstep[1][1]*pt[1] + Rstep[1][2]*pt[2] + tStep[1],
        Rstep[2][0]*pt[0] + Rstep[2][1]*pt[1] + Rstep[2][2]*pt[2] + tStep[2]
      ];
    }
    Racc = matMul(Rstep, Racc);
    tAcc = [
      Rstep[0][0]*tAcc[0] + Rstep[0][1]*tAcc[1] + Rstep[0][2]*tAcc[2] + tStep[0],
      Rstep[1][0]*tAcc[0] + Rstep[1][1]*tAcc[1] + Rstep[1][2]*tAcc[2] + tStep[1],
      Rstep[2][0]*tAcc[0] + Rstep[2][1]*tAcc[1] + Rstep[2][2]*tAcc[2] + tStep[2]
    ];
    var s2 = 0; for(var gi3 = 0; gi3 < gM.length; gi3++){ var a = gM[gi3][0]-gF[gi3][0], b = gM[gi3][1]-gF[gi3][1], c = gM[gi3][2]-gF[gi3][2]; s2 += a*a + b*b + c*c; }
    var rmsd = Math.sqrt(s2 / Math.max(gM.length, 1));
    if(Math.abs(prevR - rmsd) < 1e-4){ prevR = rmsd; break; }
    prevR = rmsd;
  }

  // guard idempotenza: se il delta totale e' trascurabile, no-op (Raffina ripetibile)
  var R = Racc, t = tAcc;
  var trace = R[0][0] + R[1][1] + R[2][2];
  var rotDeg = Math.acos(Math.min(1, Math.max(-1, (trace - 1) / 2))) * 180 / Math.PI;
  var transMag = Math.hypot(t[0], t[1], t[2]);
  if(rotDeg < 0.01 && transMag < 0.001){ p.rmsd = (prevR === Infinity ? p.rmsd : prevR); return p.rmsd; }

  // 4. applica il delta rigido al group
  var Rm = new THREE.Matrix4().set(
    R[0][0], R[0][1], R[0][2], t[0],
    R[1][0], R[1][1], R[1][2], t[1],
    R[2][0], R[2][1], R[2][2], t[2],
    0, 0, 0, 1
  );
  p.group.updateMatrix();
  var newMat = new THREE.Matrix4().multiplyMatrices(Rm, p.group.matrix);
  newMat.decompose(p.group.position, p.group.quaternion, p.group.scale);
  p.group.updateMatrix();
  p.position.applyMatrix4(Rm);
  p.axisDir.applyMatrix4(new THREE.Matrix4().extractRotation(Rm)).normalize();
  p.rmsd = (prevR === Infinity ? null : prevR);
  return p.rmsd;
}

// 8.56.0 (richiesta utente: "Raffina non puo' interessare tutti gli oggetti ma solo quello che stiamo
// posizionando"): marker ATTIVO per la Raffina = di default l'ULTIMO piazzato; selezionabile cliccando
// il nome nell'albero. La Raffina agisce SOLO su questo -> non perturba gli impianti già confermati.
function _replaceRefineTargetNum(){
  if(replaceActiveNum != null && replacePlaced.some(function(p){ return p.num === replaceActiveNum; })) return replaceActiveNum;
  return replacePlaced.length ? replacePlaced[replacePlaced.length - 1].num : null;
}
function replaceSetActiveImplant(num){
  if(!replacePlaced.some(function(p){ return p.num === num; })) return;   // 8.56.0: ignora num inesistente
  replaceActiveNum = num;
  try { replaceRebuildTree(); } catch(e){}
  var _p = null; for(var _i = 0; _i < replacePlaced.length; _i++){ if(replacePlaced[_i].num === num){ _p = replacePlaced[_i]; break; } }
  replaceShowStatus('Impianto #' + num + (_p ? (' «' + (_replaceLibId(_p) || _p.typeLabel || ('type ' + _p.typeOrd)) + '»') : '') + ' attivo: la Raffina agirà su questo.');
}
function replaceRefineCurrent(){
  var tn = _replaceRefineTargetNum();
  if(tn == null){ replaceShowStatus('Nessun marker da raffinare.', true); return; }
  replaceActiveNum = tn;   // 8.56.0: l'attivo riflette il marker che verrà raffinato (highlight coerente)
  replaceRefineAll(null, tn);
}

// 8.62.0 (collaudo A/B Raffina+): estrazione madre full-res (mondo) + crop cilindrico scansione
// attorno al marker -> set di punti per il RIGHELLO COMUNE (point-to-point). NB: clona la logica
// crop INLINE di replaceRefineServer (~17613-17667), che resta INTATTA (path server hardenizzato
// 8.59.1). De-dup annotata come passo dedicato (CLAUDE.md §3.4).
function _replaceExtractRefineSets(p, maxSrc, maxTgt){
  if(!p || !p.group || !replaceMesh) return { ok: false };
  p.group.updateMatrixWorld(true);
  var m = p.group.matrixWorld.elements;
  var geo = p.srcGeo || (p.group.children && p.group.children[0] && p.group.children[0].geometry);
  if(!geo || !geo.attributes || !geo.attributes.position) return { ok: false };
  var cadPos = geo.attributes.position.array;
  var nCadV = cadPos.length / 3;
  var srcStep = Math.max(1, Math.ceil(nCadV / maxSrc));
  var axis = p.axisDir.clone().normalize(), axx = axis.x, axy = axis.y, axz = axis.z;
  var src = [], cen = [0, 0, 0];
  for(var vi = 0; vi < nCadV; vi += srcStep){
    var o = vi * 3, lx = cadPos[o], ly = cadPos[o+1], lz = cadPos[o+2];
    var wx = m[0]*lx + m[4]*ly + m[8]*lz  + m[12];
    var wy = m[1]*lx + m[5]*ly + m[9]*lz  + m[13];
    var wz = m[2]*lx + m[6]*ly + m[10]*lz + m[14];
    src.push([wx, wy, wz]); cen[0]+=wx; cen[1]+=wy; cen[2]+=wz;
  }
  if(src.length < 20) return { ok: false };
  cen[0]/=src.length; cen[1]/=src.length; cen[2]/=src.length;
  var zMin = Infinity, zMax = -Infinity, rMax = 0;
  for(var i2 = 0; i2 < src.length; i2++){
    var dx = src[i2][0]-cen[0], dy = src[i2][1]-cen[1], dz = src[i2][2]-cen[2];
    var zp = dx*axx + dy*axy + dz*axz; if(zp < zMin) zMin = zp; if(zp > zMax) zMax = zp;
    var rx = dx - zp*axx, ry = dy - zp*axy, rz = dz - zp*axz; var r = Math.sqrt(rx*rx + ry*ry + rz*rz); if(r > rMax) rMax = r;
  }
  var MARG = 1.5, zLo = zMin - MARG, zHi = zMax + MARG, radLim2 = (rMax + MARG) * (rMax + MARG);
  var scanPos = (replaceOriginalGeo || replaceMesh.geometry).attributes.position.array;
  var nScanTri = scanPos.length / 9, tgt = [];
  for(var si = 0; si < nScanTri; si++){
    var oi = si * 9;
    var px = (scanPos[oi]   + scanPos[oi+3] + scanPos[oi+6]) / 3;
    var py = (scanPos[oi+1] + scanPos[oi+4] + scanPos[oi+7]) / 3;
    var pz = (scanPos[oi+2] + scanPos[oi+5] + scanPos[oi+8]) / 3;
    var ddx = px-cen[0], ddy = py-cen[1], ddz = pz-cen[2];
    var zp2 = ddx*axx + ddy*axy + ddz*axz; if(zp2 < zLo || zp2 > zHi) continue;
    var rrx = ddx - zp2*axx, rry = ddy - zp2*axy, rrz = ddz - zp2*axz; if(rrx*rrx + rry*rry + rrz*rrz > radLim2) continue;
    tgt.push([px, py, pz]);
  }
  if(tgt.length < 20) return { ok: false };
  if(tgt.length > maxTgt){ var stp = Math.ceil(tgt.length / maxTgt), ta = []; for(var k = 0; k < tgt.length; k += stp){ ta.push(tgt[k]); } tgt = ta; }
  return { ok: true, src: src, tgt: tgt };
}

// 8.62.0: RIGHELLO COMUNE — RMSD point-to-point (µm) della posa CORRENTE di p, calcolato con la
// STESSA funzione per Raffina (client) e Raffina+ (server). Le metriche native (mm point-to-point
// vs µm point-to-plane, su campioni diversi) NON sono comparabili: questo le mette sullo stesso
// righello. Trim robusto a mediana×2.5 (allineato allo spirito del motore server).
function _replaceEvalFit(p){
  var ex = _replaceExtractRefineSets(p, REPLACE_EVAL_MAX_SRC, REPLACE_EVAL_MAX_TGT);
  if(!ex || !ex.ok) return null;
  var src = ex.src, tgt = ex.tgt, nT = tgt.length;
  if(src.length < 10 || nT < 10) return null;
  var d2 = new Array(src.length);
  for(var i = 0; i < src.length; i++){
    var sx = src[i][0], sy = src[i][1], sz = src[i][2], best = Infinity;
    for(var j = 0; j < nT; j++){
      var dx = sx - tgt[j][0], dy = sy - tgt[j][1], dz = sz - tgt[j][2];
      var dd = dx*dx + dy*dy + dz*dz; if(dd < best) best = dd;
    }
    d2[i] = best;
  }
  var sorted = d2.slice().sort(function(a, b){ return a - b; });
  var med = sorted[Math.floor(sorted.length / 2)] || 0;
  var lim = med > 0 ? med * 6.25 : Infinity;   // (2.5)^2 sulla distanza al quadrato
  var sum = 0, n = 0;
  for(var k = 0; k < d2.length; k++){ if(d2[k] <= lim){ sum += d2[k]; n++; } }
  if(!n) return null;
  return { rmsdUm: Math.round(Math.sqrt(sum / n) * 1000), nPairs: n };
}

// 8.62.0: clocking firmato (°) della posa corrente rispetto al seed 3-punti, via swing-twist
// attorno all'asse impianto (il DOF debole = vero oggetto del collaudo). null se manca il seed.
function _replaceTwistAngleDeg(qCur, qSeed, axisV){
  if(!qCur || !qSeed || !axisV) return null;
  var qRel = qCur.clone().multiply(qSeed.clone().invert());
  if(qRel.w < 0){ qRel.x = -qRel.x; qRel.y = -qRel.y; qRel.z = -qRel.z; qRel.w = -qRel.w; }
  var ax = axisV.clone().normalize();
  var d = qRel.x*ax.x + qRel.y*ax.y + qRel.z*ax.z;   // proiezione firmata della parte vettoriale sull'asse
  var deg = 2 * Math.atan2(d, qRel.w) * 180 / Math.PI;
  while(deg > 180) deg -= 360; while(deg < -180) deg += 360;
  return deg;
}

// 8.62.0: registra il risultato A/B (righello + clocking) del path indicato ('client'|'server')
// e mostra la riga-verdetto col confronto se entrambi i path sono stati eseguiti.
function _replaceRecordAB(p, which){
  if(!p) return;
  if(!(window.SYN && window.SYN.expert)) return;   // 8.72.0: righello A/B = solo area Expert
  var fit = null; try { fit = _replaceEvalFit(p); } catch(e){}
  var clk = (p.seedQuat && p.group) ? _replaceTwistAngleDeg(p.group.quaternion, p.seedQuat, (p.seedAxis || p.axisDir)) : null;
  var rec = { rmsdUm: (fit ? fit.rmsdUm : null), clockDeg: clk };
  if(which === 'server') p.abServer = rec; else p.abClient = rec;
  _replaceShowAB(p);
}
function _replaceShowAB(p){
  function fmt(r){
    if(!r) return '—';
    var u = (r.rmsdUm != null) ? (r.rmsdUm + 'µm') : 'n/d';
    var c = (r.clockDeg != null) ? ('clock ' + (r.clockDeg >= 0 ? '+' : '') + r.clockDeg.toFixed(1) + '°') : 'clock n/d';
    return u + ', ' + c;
  }
  var c = p.abClient, s = p.abServer;
  var line = 'A/B #' + p.num + ' (righello comune) — Raffina: ' + fmt(c) + '  ·  Raffina+: ' + fmt(s);
  if(c && s && c.rmsdUm != null && s.rmsdUm != null){
    var dF = s.rmsdUm - c.rmsdUm;
    line += '  →  Δfit ' + (dF > 0 ? '+' : '') + dF + 'µm';
    if(c.clockDeg != null && s.clockDeg != null) line += ', Δclock ' + Math.abs(s.clockDeg - c.clockDeg).toFixed(1) + '°';
  } else {
    line += '  (esegui anche l\'altra per il confronto)';
  }
  replaceShowStatus(line);
}

// 8.62.0: riporta l'impianto attivo alla POSA SEED (3-punti grezza, prima di ogni raffina) ->
// abilita l'A/B INDIPENDENTE (reset -> Raffina -> reset -> Raffina+, entrambe dallo stesso seed).
function replaceResetToSeed(){
  var tn = _replaceRefineTargetNum();
  if(tn == null){ replaceShowStatus('Nessun impianto attivo da riportare al seed.', true); return; }
  var p = null;
  for(var i = 0; i < replacePlaced.length; i++){ if(replacePlaced[i].num === tn){ p = replacePlaced[i]; break; } }
  if(!p || !p.group){ replaceShowStatus('Impianto non valido.', true); return; }
  if(!p.seedQuat || !p.seedPos){ replaceShowStatus('Posa seed non disponibile per questo impianto.', true); return; }
  p.group.position.copy(p.seedPos);
  p.group.quaternion.copy(p.seedQuat);
  p.group.updateMatrix(); p.group.updateMatrixWorld(true);
  p.position.copy(p.seedPos);
  if(p.seedAxis) p.axisDir.copy(p.seedAxis);
  p.rmsd = null;
  try { replaceRebuildScanGeometry(); } catch(e){}   // il taglio scansione segue la posa
  replaceRebuildPlacedList();
  replaceShowStatus('Impianto #' + tn + ' riportato alla posa seed (3-punti). Ora Raffina o Raffina+ per l\'A/B indipendente.');
}
function replaceRefineServer(){
  var tn = _replaceRefineTargetNum();
  if(tn == null){ replaceShowStatus('Nessun marker da raffinare.', true); return; }
  replaceActiveNum = tn;
  var p = null;
  for(var i = 0; i < replacePlaced.length; i++){ if(replacePlaced[i].num === tn){ p = replacePlaced[i]; break; } }
  if(!p || !p.group || !replaceMesh){ replaceShowStatus('Marker non valido per la raffina.', true); return; }
  var btn = document.getElementById('replaceBtnRefineSrv');
  var btnCli = document.getElementById('replaceBtnRefine');   // 8.59.1: blocca anche la Raffina client durante la chiamata (anti doppio-apply su pose diverse)
  if(btn){ btn.disabled = true; btn.style.opacity = '0.5'; btn.style.cursor = 'wait'; }
  if(btnCli){ btnCli.disabled = true; btnCli.style.opacity = '0.5'; btnCli.style.cursor = 'not-allowed'; }
  function _restore(){ if(btn){ btn.disabled = false; btn.style.opacity = '1'; btn.style.cursor = 'pointer'; } if(btnCli){ btnCli.disabled = false; btnCli.style.opacity = '1'; btnCli.style.cursor = 'pointer'; } }

  // 1. MADRE (sorgente) in MONDO, piena risoluzione (stride solo oltre il cap)
  p.group.updateMatrixWorld(true);
  var m = p.group.matrixWorld.elements;
  var _poseSnap = Array.prototype.slice.call(m);   // 8.59.1: snapshot posa -> scarta risposte stantie se la posa cambia durante la chiamata
  var nmat = new THREE.Matrix3().getNormalMatrix(p.group.matrixWorld);
  var mesh0 = p.group.children && p.group.children[0];
  var geo = p.srcGeo || (mesh0 && mesh0.geometry);
  if(!geo || !geo.attributes || !geo.attributes.position){ _restore(); replaceShowStatus('Geometria madre assente.', true); return; }
  var cadPos = geo.attributes.position.array;
  var cadNorm = geo.attributes.normal ? geo.attributes.normal.array : null;
  var nCadV = cadPos.length / 3;
  var srcStep = Math.max(1, Math.ceil(nCadV / REPLACE_SRV_MAX_SRC));
  var axis = p.axisDir.clone().normalize(); var axx = axis.x, axy = axis.y, axz = axis.z;
  var src = [], srcN = [], cen = [0, 0, 0];
  for(var vi = 0; vi < nCadV; vi += srcStep){
    var o = vi * 3;
    var lx = cadPos[o], ly = cadPos[o+1], lz = cadPos[o+2];
    var wx = m[0]*lx + m[4]*ly + m[8]*lz  + m[12];
    var wy = m[1]*lx + m[5]*ly + m[9]*lz  + m[13];
    var wz = m[2]*lx + m[6]*ly + m[10]*lz + m[14];
    src.push([wx, wy, wz]); cen[0]+=wx; cen[1]+=wy; cen[2]+=wz;
    if(cadNorm){ var wn = new THREE.Vector3(cadNorm[o], cadNorm[o+1], cadNorm[o+2]).applyMatrix3(nmat).normalize(); srcN.push([wn.x, wn.y, wn.z]); }
  }
  if(src.length < 20){ _restore(); replaceShowStatus('Madre: troppi pochi punti.', true); return; }
  cen[0]/=src.length; cen[1]/=src.length; cen[2]/=src.length;

  // estensione madre lungo asse + radiale -> parametri crop scansione
  var zMin = Infinity, zMax = -Infinity, rMax = 0;
  for(var i2 = 0; i2 < src.length; i2++){
    var dx = src[i2][0]-cen[0], dy = src[i2][1]-cen[1], dz = src[i2][2]-cen[2];
    var zp = dx*axx + dy*axy + dz*axz; if(zp < zMin) zMin = zp; if(zp > zMax) zMax = zp;
    var rx = dx - zp*axx, ry = dy - zp*axy, rz = dz - zp*axz; var r = Math.sqrt(rx*rx + ry*ry + rz*rz); if(r > rMax) rMax = r;
  }
  var MARG = 1.5, zLo = zMin - MARG, zHi = zMax + MARG, radLim2 = (rMax + MARG) * (rMax + MARG);

  // 2. crop cilindrico SCANSIONE (geometria ORIGINALE, mai tagliata) + normali di faccia
  var scanPos = (replaceOriginalGeo || replaceMesh.geometry).attributes.position.array;
  var nScanTri = scanPos.length / 9;
  var tgt = [], tgtN = [];
  for(var si = 0; si < nScanTri; si++){
    var oi = si * 9;
    var px = (scanPos[oi]   + scanPos[oi+3] + scanPos[oi+6]) / 3;
    var py = (scanPos[oi+1] + scanPos[oi+4] + scanPos[oi+7]) / 3;
    var pz = (scanPos[oi+2] + scanPos[oi+5] + scanPos[oi+8]) / 3;
    var ddx = px-cen[0], ddy = py-cen[1], ddz = pz-cen[2];
    var zp2 = ddx*axx + ddy*axy + ddz*axz; if(zp2 < zLo || zp2 > zHi) continue;
    var rrx = ddx - zp2*axx, rry = ddy - zp2*axy, rrz = ddz - zp2*axz; if(rrx*rrx + rry*rry + rrz*rrz > radLim2) continue;
    var e1x = scanPos[oi+3]-scanPos[oi], e1y = scanPos[oi+4]-scanPos[oi+1], e1z = scanPos[oi+5]-scanPos[oi+2];
    var e2x = scanPos[oi+6]-scanPos[oi], e2y = scanPos[oi+7]-scanPos[oi+1], e2z = scanPos[oi+8]-scanPos[oi+2];
    var snx = e1y*e2z - e1z*e2y, sny = e1z*e2x - e1x*e2z, snz = e1x*e2y - e1y*e2x;
    var sl = Math.sqrt(snx*snx + sny*sny + snz*snz) || 1;
    tgt.push([px, py, pz]); tgtN.push([snx/sl, sny/sl, snz/sl]);
  }
  if(tgt.length < 20){ _restore(); replaceShowStatus('Scansione: crop vuoto attorno al marker.', true); return; }
  if(tgt.length > REPLACE_SRV_MAX_TGT){ var stp = Math.ceil(tgt.length / REPLACE_SRV_MAX_TGT); var ta = [], tb = []; for(var k = 0; k < tgt.length; k += stp){ ta.push(tgt[k]); tb.push(tgtN[k]); } tgt = ta; tgtN = tb; }

  // 3. POST al server (auth Bearer) -> R,t,rmsd,iters
  replaceShowStatus('Raffina+ server: invio ' + src.length + ' madre / ' + tgt.length + ' scan…');
  var token = ''; try { token = localStorage.getItem('syntesis_token') || ''; } catch(e){}
  fetch('/api/rit/refine-icp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({ source: src, source_normals: (srcN.length === src.length ? srcN : null), target: tgt, target_normals: tgtN, axis: [axx, axy, axz], max_iter: 80, normal_reject_cos: 0.3 })
  }).then(function(resp){
    if(!resp.ok) return resp.text().then(function(t){ throw new Error('HTTP ' + resp.status + (t ? (' · ' + t.slice(0, 160)) : '')); });
    return resp.json();
  }).then(function(res){
    _restore();
    if(replacePlaced.indexOf(p) < 0){ replaceShowStatus('Marker eliminato durante la raffina.', true); return; }
    // 8.59.1: scarta risposta stantia se la posa è cambiata durante la chiamata (race con altre azioni)
    p.group.updateMatrixWorld(true);
    var _now = p.group.matrixWorld.elements, _moved = false;
    for(var _qi = 0; _qi < 16; _qi++){ if(Math.abs(_now[_qi] - _poseSnap[_qi]) > 1e-6){ _moved = true; break; } }
    if(_moved){ replaceShowStatus('Posa cambiata durante il calcolo: Raffina+ scartata, ripremi.', true); return; }
    var R = res.R, t = res.t;
    if(!R || !t){ replaceShowStatus('Server: risposta priva di trasformazione.', true); return; }
    // 8.59.1: guardia anti-delta-anomalo — una convergenza a posa sbagliata (init scadente, crop su
    // gengiva, minimo locale sul clocking) NON deve applicarsi in silenzio. Oltre soglia -> scarta.
    var _trace = R[0][0] + R[1][1] + R[2][2];
    var _rotDeg = Math.acos(Math.min(1, Math.max(-1, (_trace - 1) / 2))) * 180 / Math.PI;
    var _trMag = Math.sqrt(t[0]*t[0] + t[1]*t[1] + t[2]*t[2]);
    if(_rotDeg > 8 || _trMag > 1.5){
      replaceShowStatus('Raffina+ scartata: delta anomalo (' + _rotDeg.toFixed(1) + '° / ' + _trMag.toFixed(2) + 'mm) — posa invariata. Riposiziona o usa Raffina.', true);
      return;
    }
    // 4. applica lo stesso delta rigido del path client (matrice 4x4 sul group)
    var Rm = new THREE.Matrix4().set(
      R[0][0], R[0][1], R[0][2], t[0],
      R[1][0], R[1][1], R[1][2], t[1],
      R[2][0], R[2][1], R[2][2], t[2],
      0, 0, 0, 1
    );
    p.group.updateMatrix();
    var newMat = new THREE.Matrix4().multiplyMatrices(Rm, p.group.matrix);
    newMat.decompose(p.group.position, p.group.quaternion, p.group.scale);
    p.group.updateMatrix();
    p.position.applyMatrix4(Rm);
    p.axisDir.applyMatrix4(new THREE.Matrix4().extractRotation(Rm)).normalize();
    p.rmsd = (typeof res.rmsd === 'number') ? res.rmsd : p.rmsd;
    try { replaceRebuildScanGeometry(); } catch(e){}   // il taglio scansione segue la posa raffinata
    replaceRebuildPlacedList();
    var rmsUm = (typeof res.rmsd === 'number') ? Math.round(res.rmsd * 1000) : null;
    replaceShowStatus('Impianto #' + tn + ': Raffina+ SERVER — residuo fit ' + (rmsUm != null ? (rmsUm + ' µm') : 'n/d') + ' · ' + (res.n_pairs || '?') + ' coppie · ' + (res.iters || '?') + ' it · ' + (res.elapsed_ms || '?') + ' ms (piena ris.).');
    try { _replaceRecordAB(p, 'server'); } catch(e){}   // 8.62.0: righello A/B del path SERVER (sovrascrive con la riga-verdetto)
  }).catch(function(err){
    _restore();
    replaceShowStatus('Raffina+ server fallita: ' + (err && err.message ? err.message : err), true);
  });
}
function replaceRefineAll(onDone, targetNum){
  // 8.56.0: targetNum != null -> raffina SOLO quel marker (corrente), senza toccare gli altri; altrimenti tutti (legacy).
  var targets = (targetNum != null) ? replacePlaced.filter(function(p){ return p.num === targetNum; }) : replacePlaced.slice();
  if(!targets.length){ replaceShowStatus('Nessun marker da raffinare.', true); if(typeof onDone === 'function') onDone(); return; }
  var btn = document.getElementById('replaceBtnRefine');
  if(btn) btn.disabled = true;
  function finish(round, converged){
    if(btn) btn.disabled = false;
    try { replaceRebuildScanGeometry(); } catch(e){}   // 2b-3d: i buchi "Taglia scansione" seguono le pose raffinate
    replaceRebuildPlacedList();
    var sum = 0, cnt = 0;
    targets.forEach(function(p){ if(typeof p.rmsd === 'number'){ sum += p.rmsd; cnt++; } });
    var avg = cnt ? (Math.round(sum / cnt * 1000) / 1000) : null;
    var _w = (targetNum != null) ? ('Impianto #' + targetNum + ': raffina ') : ('Raffina ');
    var head = converged ? (_w + 'a convergenza in ' + round + ' round')
                         : (_w + 'fermata al limite di ' + round + ' round (non ancora ferma)');
    replaceShowStatus(head + (avg != null ? (' — RMSD medio ' + avg + ' mm') : '') + '.');
    // 8.62.0: righello A/B del path CLIENT. Solo single-target: al Conferma (auto-refine) la
    // onDone sovrascrive subito la riga -> nessuno spam; sul Raffina manuale resta la riga A/B.
    if(targetNum != null && targets.length){ try { _replaceRecordAB(targets[0], 'client'); } catch(e){} }
    if(typeof onDone === 'function') onDone();
  }
  function doRound(round){
    targets = targets.filter(function(p){ return replacePlaced.indexOf(p) >= 0; });   // 8.56.0: scarta marker eliminati durante la raffina (come il flusso swap async)
    if(!targets.length){ finish(round, true); return; }
    var maxMove = 0, maxAng = 0;
    targets.forEach(function(p){
      var posB = p.position.clone();
      var axB = p.axisDir ? p.axisDir.clone() : null;
      try { _replaceDoRefine(p); }
      catch(e){ console.warn('[replaceRefine]', e); return; }
      var d = p.position.distanceTo(posB);
      if(d > maxMove) maxMove = d;
      if(axB && p.axisDir){ var a = axB.angleTo(p.axisDir); if(a > maxAng) maxAng = a; }
    });
    replaceRebuildPlacedList();
    if(maxMove < REPLACE_REFINE_EPS_MM && maxAng < REPLACE_REFINE_EPS_RAD){ finish(round, true); return; }
    if(round >= REPLACE_REFINE_MAX_ROUNDS){ finish(round, false); return; }
    replaceShowStatus('Raffina ICP — round ' + (round + 1) + '… (spostamento ' + (Math.round(maxMove * 1000) / 1000) + ' mm)');
    setTimeout(function(){ doRound(round + 1); }, 0);
  }
  replaceShowStatus('Raffina ICP — round 1…');
  setTimeout(function(){ doRound(1); }, 10);
}

// --- LABEL 2D (clone di sostEnsureLabelElements/sostUpdateLabels) ---
function replaceEnsureLabelElements(){
  var layer = document.getElementById('labelLayer');
  if(!layer) return;
  replacePlaced.forEach(function(p){
    if(!p.labelEl){
      var el = document.createElement('div');
      el.className = 'divergence-label replace-label';
      el.style.display = 'none';
      layer.appendChild(el);
      p.labelEl = el;
    }
  });
  var activeEls = new Set(replacePlaced.map(function(p){ return p.labelEl; }).filter(Boolean));
  Array.from(layer.children).forEach(function(child){
    if(child.tagName !== 'DIV' || !child.classList || !child.classList.contains('replace-label')) return;
    if(!activeEls.has(child)) layer.removeChild(child);
  });
}

function replaceUpdateLabels(){
  if(!camera || !renderer) return;
  if(analysisMode !== 'replace') return;
  var vp = document.getElementById('viewport');
  if(!vp) return;
  // 8.59.8: la pillola è ancorata al CAP del FIGLIO (meshSub, estremo più lontano dalla connessione)
  // e sale VERSO L'ALTO DEL FIGLIO (lungo l'asse, verso il cap) a OFF_PX px fissi -> parte dal
  // sostituto, non dalla connessione (p.position = origine, bassa/coperta dalla gengiva). Fallback
  // all'alto-schermo se il cap punta verso la camera (asse proiettato collassato, robusto allo scorcio
  // come il 8.53.1). #labelLines è svuotato ogni frame da updateDivergenceLabels() (prima in animate()).
  var OFF_PX = 54;
  var zoomF = (typeof syntesisGetUiZoom === 'function') ? syntesisGetUiZoom() : 1.0;
  var rect = renderer.domElement.getBoundingClientRect();
  var vpRect = vp.getBoundingClientRect();
  var W = rect.width, H = rect.height;
  var offX = rect.left - vpRect.left, offY = rect.top - vpRect.top;
  var svg = document.getElementById('labelLines');
  function _toPx(v){ return { x: (offX + (v.x * 0.5 + 0.5) * W) / zoomF, y: (offY + (-v.y * 0.5 + 0.5) * H) / zoomF }; }
  replacePlaced.forEach(function(p){
    if(!p.labelEl) return;
    if(!p.position || !p.axisDir){ p.labelEl.style.display = 'none'; return; }
    // 8.59.8: ancora al CAP del FIGLIO (meshSub) e lift VERSO L'ALTO DEL FIGLIO (lungo l'asse, verso
    // il cap), non dalla connessione (p.position = origine, bassa e coperta dalla gengiva).
    var ax = p.axisDir.clone().normalize();
    var anchor3 = p.position.clone(), axUp3 = ax.clone();   // anchor = cap del figlio; axUp3 = verso il cap (su del figlio)
    if(p.meshSub){
      try {
        var _b = new THREE.Box3().setFromObject(p.meshSub);
        if(!_b.isEmpty()){
          var _c = _b.getCenter(new THREE.Vector3()), _s = _b.getSize(new THREE.Vector3());
          var _half = 0.5 * (Math.abs(_s.x*ax.x) + Math.abs(_s.y*ax.y) + Math.abs(_s.z*ax.z));
          var _cA = _c.clone().add(ax.clone().multiplyScalar(_half));
          var _cB = _c.clone().add(ax.clone().multiplyScalar(-_half));
          var _far = (_cA.distanceToSquared(p.position) >= _cB.distanceToSquared(p.position));   // cap = estremo più LONTANO dalla connessione
          anchor3 = _far ? _cA : _cB;
          axUp3   = _far ? ax.clone() : ax.clone().negate();
        }
      } catch(e){}
    }
    var va = anchor3.clone().project(camera);
    if(va.z > 1 || va.z < -1){ p.labelEl.style.display = 'none'; return; }
    var aPx = _toPx(va);
    // direzione "verso l'alto del figlio" (asse verso il cap) proiettata in schermo
    var tPx = _toPx(anchor3.clone().add(axUp3).project(camera));
    var sdx = tPx.x - aPx.x, sdy = tPx.y - aPx.y;
    var len = Math.sqrt(sdx * sdx + sdy * sdy);
    if(len < 0.5){ sdx = 0; sdy = -1; } else { sdx /= len; sdy /= len; }   // scorcio (cap verso camera) -> fallback alto-schermo
    var labelX = aPx.x + sdx * OFF_PX, labelY = aPx.y + sdy * OFF_PX;
    var hex = '#' + ('000000' + (p.color >>> 0).toString(16)).slice(-6);
    var _lib = _replaceLibId(p);
    p.labelEl.style.display = 'block';
    p.labelEl.style.left = labelX + 'px';
    p.labelEl.style.top = labelY + 'px';
    p.labelEl.style.background = hex;
    p.labelEl.textContent = '#' + p.num + (_lib ? ' ' + _lib : '');
    if(svg){
      var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', aPx.x); line.setAttribute('y1', aPx.y);
      line.setAttribute('x2', labelX); line.setAttribute('y2', labelY);
      line.setAttribute('stroke', hex);
      svg.appendChild(line);
      var dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('cx', aPx.x); dot.setAttribute('cy', aPx.y);
      dot.setAttribute('r', 3); dot.setAttribute('fill', hex); dot.setAttribute('opacity', '0.9');
      svg.appendChild(dot);
    }
  });
}
