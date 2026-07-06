/*
 * wf/sostituire.js — workflow SOSTITUIRE di Synthesis-ICP (Fase 6d modularizzazione, 8.91.0).
 * Quarto file estratto in wf/ (dopo fresabilita, tree, report-analizza).
 *
 * CONTRATTO: 47 function declaration del dominio Sostituire — carica una scansione Multi-A, l'utente
 * clicca il marker, il sistema piazza il template scanbody con findScanbodyCenter (centro+asse
 * deterministici), motore robusto centro+asse (Kasa/wall/cap-plane/Method C), raffina, esporta STL,
 * albero scena dedicato, cutview. Nomi bare globali invariati.
 * Estrazione "functions-only" (pattern 6a/6b/6c): lo STATO resta nel monolite alla posizione
 * originale (§SOSTITUIRE: sostStl/sostMesh/sostActiveTemplate/sostTemplateBuffers/sostPlacementMode/
 * sostPlaced/sostScanUI/sostLabelsUI/sostOriginalGeo/sostGroupUI/sostCounter/sostSourceTemplate +
 * _sostInvLastReason/sostAlignInProgress/_sostExportPending/sostCutState) — letto anche da
 * wf/tree.js (rebuildTree legge sostMesh/sostPlaced) e da selectWorkflow. Il banner §SOSTITUIRE
 * resta nel monolite (check_anchors). SOSTITUIRE_TEMPLATES_B64 è già in assets/ (F1).
 * _sostFinishRefine/_sostRefineRound sono ANNIDATE dentro sostAlignAll (si muovono con lei).
 *
 * CARICAMENTO: <script src> classico NON-strict in testa (dopo wf/report-analizza.js), PRIMA del
 * MAIN. Le fn si limitano a essere DEFINITE a parse-time; leggono stato/THREE/scene/DOM/assets solo
 * a CALL-TIME. VINCOLO: molte fn sono handler inline (16) + call-site da selectWorkflow/tree/ds ->
 * bare-global. RMSD centroide 7,9µm (sintetico-su-sintetico) preservato per verbatim.
 * GATE: scripts/gate/sost/gate.mjs (47 md5-verbatim per fn + esposizione + residuo stato/banner +
 * wiring) + harness browser (smoke funzioni pure/UI dove stubbabile).
 */

// ── Decompressione template base64+gzip (cache Uint8Array) ──
function sostDecodeTemplate(name){
  if(sostTemplateBuffers[name]) return Promise.resolve(sostTemplateBuffers[name]);
  if(typeof SOSTITUIRE_TEMPLATES_B64 === 'undefined') return Promise.resolve(null);
  var b64 = SOSTITUIRE_TEMPLATES_B64[name];
  if(!b64) return Promise.resolve(null);
  var bin = atob(b64);
  var gz = new Uint8Array(bin.length);
  for(var i = 0; i < bin.length; i++) gz[i] = bin.charCodeAt(i);
  var stream = new Response(
    new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'))
  );
  return stream.arrayBuffer().then(function(ab){
    var stl = new Uint8Array(ab);
    sostTemplateBuffers[name] = stl;
    return stl;
  });
}

// ── Parsing STL binario -> THREE.BufferGeometry ──
function sostParseSTLToGeometry(buf){
  var view;
  if(buf instanceof ArrayBuffer) view = new DataView(buf);
  else if(ArrayBuffer.isView(buf)) view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  else return null;
  if(view.byteLength < 84) return null;
  var n = view.getUint32(80, true);
  if(84 + n * 50 !== view.byteLength) return null;
  var positions = new Float32Array(n * 9);
  for(var i = 0; i < n; i++){
    var off = 84 + i * 50;
    for(var k = 0; k < 3; k++){
      positions[i*9 + k*3]     = view.getFloat32(off + 12 + k*12, true);
      positions[i*9 + k*3 + 1] = view.getFloat32(off + 16 + k*12, true);
      positions[i*9 + k*3 + 2] = view.getFloat32(off + 20 + k*12, true);
    }
  }
  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return geo;
}

// ── Status banner ──
function sostShowStatus(msg, isError){
  var s = document.getElementById('sostStatus');
  if(!s) return;
  s.style.display = '';
  s.textContent = msg;
  s.style.color = isError ? '#EF4444' : 'var(--gray)';
}

// Scansione di partenza: marker presente nella Multi-A
function sostOnSourceChange(radio){
  sostSourceTemplate = radio.value;
  sostActiveTemplate = radio.value;   // segue automaticamente il source
  var labels = document.querySelectorAll('#sostSourceRadio label');
  labels.forEach(function(l){ l.classList.remove('active'); });
  radio.parentElement.classList.add('active');
}

// ── Caricamento Multi-A ──
function sostOnScanPicked(evt){
  var file = evt.target.files && evt.target.files[0];
  if(!file) return;
  var reader = new FileReader();
  reader.onload = function(e){
    sostStl = new Uint8Array(e.target.result);
    sostLoadScanToScene(file.name);
  };
  reader.readAsArrayBuffer(file);
}

function sostLoadScanToScene(filename){
  // 8.80.4: parse PRIMA di sostClearScene — su file invalido la scena (scansione
  // + marker gia' posizionati) resta intatta invece di venire distrutta.
  var geo = sostParseSTLToGeometry(sostStl);
  if(!geo){
    sostShowStatus('Errore: impossibile parsare il file STL. La scena non e\' stata toccata.', true);
    return;
  }
  sostClearScene();
  var mat = new THREE.MeshPhongMaterial({
    color: 0xc4a48c,
    side: THREE.DoubleSide,
    flatShading: false,
    transparent: true,
    opacity: sostScanUI.opacity,
    depthWrite: true
  });
  // Aggiorna flag transparent in base all'opacita' per evitare costi di
  // sorting quando e' piena (100% = opaco reale)
  mat.transparent = sostScanUI.opacity < 1.0;
  sostMesh = new THREE.Mesh(geo, mat);
  sostMesh.userData.isSostituire = true;
  sostMesh.userData.sostRole = 'scan';
  scene.add(sostMesh);
  // Salva la geometria originale per poter ricostruire dopo un taglio
  sostOriginalGeo = geo.clone();

  // Nascondi la scritta "Carica una scansione intraorale" (condivisa con Analizza)
  var emptyState = document.getElementById('emptyState');
  if(emptyState) emptyState.classList.add('hidden');

  // Camera fit
  geo.computeBoundingSphere();
  var bs = geo.boundingSphere;
  if(bs){
    controls.target.copy(bs.center);
    camera.position.set(bs.center.x + bs.radius*1.5, bs.center.y + bs.radius, bs.center.z + bs.radius*1.5);
    controls.update();
  }

  // Aggiorna UI file-slot (8.80.4: filename escapato — nome file utente in innerHTML)
  var slot = document.getElementById('sostSlotScan');
  if(slot){
    slot.classList.add('loaded');
    slot.innerHTML = '<div class="fname">' + ((typeof _escHtml==='function')?_escHtml(filename):filename) + '</div><div class="finfo">' +
      (geo.attributes.position.count / 3).toLocaleString() + ' triangoli</div>';
  }
  var ph = document.getElementById('sostScanPlaceholder');
  if(ph) ph.style.display = 'none';

  // Pre-load template di default
  sostDecodeTemplate(sostActiveTemplate);   // 8.81.1: guard 'custom' rimosso (sostActiveTemplate puo' essere solo 1T3/SR/OS)

  sostShowStatus('Scansione caricata. Clicca "+ Posiziona" poi sul marker.');
  try { rebuildTree(); } catch(e){}
}

// ── Placement: avvia modalità clic ──
function sostStartPlacement(){
  if(!sostMesh){
    try{ synLog('sost','posiziona rifiutato: nessuna scansione caricata'); }catch(_){}
    sostShowStatus('Carica prima una scansione.', true);
    return;
  }
  sostPlacementMode = true;
  renderer.domElement.style.cursor = 'crosshair';
  try{ synLog('sost','posiziona ON (attesa SHIFT+clic)', {src:sostSourceTemplate}); }catch(_){}
  sostShowStatus('SHIFT+CLIC su uno scanbody per posizionarvi il marker · trascina per ruotare.');
}

// ── Click handler (chiamato da onViewportClick esteso) ──
function sostOnViewportClick(event){
  if(!sostPlacementMode || !sostMesh) return false;
  // 8.58.0: posa solo con SHIFT+CLIC PULITO -> ruotare il modello non posa fuori posizione.
  if(Math.abs(event.clientX-replacePickDownX)>6||Math.abs(event.clientY-replacePickDownY)>6){ try{ synLog('sost','clic ignorato: trascinamento (>6px = rotazione)'); }catch(_){} return false; }   // trascinamento = rotazione
  if(!replacePickDownShift){ try{ synLog('sost','clic ignorato: Shift non premuto'); }catch(_){} sostShowStatus('Tieni premuto Shift e clicca per posare il marker · trascina (senza Shift) per ruotare.'); return false; }
  var rect = renderer.domElement.getBoundingClientRect();
  var mouse = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1
  );
  var raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(mouse, camera);
  var hits = raycaster.intersectObject(sostMesh, false);   // 8.95.2 FIX: NON ricorsivo (come Analizza r.1750). In modalita' render 'both' sostMesh ha un figlio LineSegments (_wireOverlay): intersectObject di default e' RICORSIVO -> colpiva l'overlay wireframe (senza .face, soglia linea) come hits[0] -> la guardia .face qui sotto respingeva la posa (bug "shift+clic non posa in vista reticolo"). false = solo le facce del mesh solido.
  try{ synLog('sost','clic viewport', {shift:!!replacePickDownShift, hits:hits.length, face:!!(hits[0]&&hits[0].face), rectW:+rect.width.toFixed(0), rectH:+rect.height.toFixed(0)}); }catch(_){}
  if(hits.length > 0 && hits[0].face){   // 8.58.0 (review): guardia .face come Analizza (un overlay wireframe figlio non ha .face -> niente TypeError)
    sostPlaceTemplate(hits[0].point, hits[0].face.normal);
    sostPlacementMode = false;
    renderer.domElement.style.cursor = 'default';
    return true;
  }
  return false;
}

// ── Posizionamento template (pipeline Analizza: findScanbodyCenter) ──
// Label numeriche 2D proiettate: stesso pattern di Analizza (div .divergence-label).
// Sostituire crea div nel #labelLayer (condiviso con Analizza) e li posiziona
// a ogni frame nel loop di animazione. Stilisticamente identiche alle label
// di Analizza ma senza divergenza (solo numero #N).
function sostEnsureLabelElements(){
  var layer = document.getElementById('labelLayer');
  if(!layer) return;
  sostPlaced.forEach(function(p){
    if(!p.labelEl){
      var el = document.createElement('div');
      el.className = 'divergence-label sost-label';
      el.style.display = 'none';
      el.style.background = '#0D1B2A';
      layer.appendChild(el);
      p.labelEl = el;
    }
  });
  // Rimuovi div per marker eliminati
  var activeEls = new Set(sostPlaced.map(function(p){ return p.labelEl; }).filter(Boolean));
  Array.from(layer.children).forEach(function(child){
    if(child.tagName !== 'DIV') return;
    if(!child.classList || !child.classList.contains('sost-label')) return;
    if(!activeEls.has(child)) layer.removeChild(child);
  });
}

function sostUpdateLabels(){
  if(!camera || !renderer) return;
  if(analysisMode !== 'sostituire') return;
  var vp = document.getElementById('viewport');
  if(!vp) return;
  if(!sostLabelsUI.visible){
    sostPlaced.forEach(function(p){
      if(p.labelEl) p.labelEl.style.display = 'none';
    });
    return;
  }
  var rect = renderer.domElement.getBoundingClientRect();
  var vpRect = vp.getBoundingClientRect();
  var W = rect.width, H = rect.height;
  var offX = rect.left - vpRect.left;
  var offY = rect.top - vpRect.top;
  sostPlaced.forEach(function(p){
    if(!p.labelEl) return;
    // Ancora: connessione implantare (p.position).
    // Label 10mm sopra lungo l'asse (sopra i dischi 1T3 max Z=8.5).
    var anchor = p.position.clone();
    var labelPos = p.position.clone().add(p.axisDir.clone().multiplyScalar(10));
    var vl = labelPos.clone().project(camera);
    if(vl.z > 1 || vl.z < -1){
      p.labelEl.style.display = 'none';
      return;
    }
    var labelX = offX + (vl.x * 0.5 + 0.5) * W;
    var labelY = offY + (-vl.y * 0.5 + 0.5) * H;
    p.labelEl.style.display = 'block';
    p.labelEl.style.left = labelX + 'px';
    p.labelEl.style.top = labelY + 'px';
    p.labelEl.textContent = '#' + p.num;
  });
}

// 8.71.3: applica la modalita' di render globale (envSettings.renderMode = solid|wireframe|both)
// alle mesh del workflow Sostituire (scansione Multi-A + template posizionati). Il vmBar globale
// chiama applyRenderModeToScene, che finora saltava sostMesh/sostPlaced -> la vista reticolo/both
// non mostrava alcun wireframe in Sostituire (restava solid). Chiamata anche in coda a
// sostRebuildTree cosi' i marker piazzati dopo la selezione della vista ereditano la modalita'.
function sostApplyRenderMode(){
  if(typeof applyRenderModeToMesh !== 'function') return;
  if(typeof sostMesh !== 'undefined' && sostMesh) applyRenderModeToMesh(sostMesh);
  if(typeof sostPlaced !== 'undefined' && Array.isArray(sostPlaced)){
    sostPlaced.forEach(function(p){
      if(!p || !p.groups) return;
      Object.keys(p.groups).forEach(function(k){
        var g = p.groups[k];
        if(!g || !g.traverse) return;
        // Solo le Mesh (scanbody) prendono wireframe/overlay; le Line (asse) restano intatte.
        g.traverse(function(o){ if(o && o.isMesh) applyRenderModeToMesh(o); });
      });
    });
  }
}

// Costruisce il THREE.Group di un singolo template (key) correttamente
// orientato e posizionato. L'origine locale del template (0,0,0) = connessione
// implantare. Questo punto e' condiviso da tutti i 3 template IPD, quindi
// basta farlo coincidere con `connectionWorld` e ogni template si colloca
// automaticamente alla propria quota intrinseca:
//   - 1T3: disco a Z=+8.5 locale -> +8.5 axis nel mondo (sopra la connessione)
//   - OS:  disco a Z=+6.0 locale -> +6.0 axis nel mondo
//   - SR:  disco a Z=-5.0 locale -> -5.0 axis nel mondo (sotto la connessione)
// Nessun flip SR: la convenzione STL ha gia' il verso corretto rispetto
// all'origine clinica condivisa.
function sostBuildTemplateGroup(key, geo, connectionWorld, axis, mirror){
  var info = SOSTITUIRE_TEMPLATE_INFO[key] || {label:'Custom', color: 0x888888};
  var color = info.color;
  var mat = new THREE.MeshPhongMaterial({
    color: color,
    specular: 0x222222,
    shininess: 40,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 1.0,
    depthWrite: true
  });
  var mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'template';
  var group = new THREE.Group();
  group.add(mesh);
  // Origine locale (0,0,0) = connessione implantare.
  group.position.copy(connectionWorld);
  // v7.3.9.101 - parametro mirror (default false):
  //   false = quaternion +Z locale -> +axis mondo (cap-up sopra la connessione)
  //   true  = quaternion +Z locale -> -axis mondo (cap-down sotto la connessione)
  // Usato per riflessione speculare dei sostituti attraverso il piano della
  // connessione clinica condivisa con il source (stessa connectionWorld).
  var refDir = mirror ? axis.clone().multiplyScalar(-1) : axis.clone();
  var up = new THREE.Vector3(0, 0, 1);
  group.quaternion.copy(new THREE.Quaternion().setFromUnitVectors(up, refDir));
  group.userData.isSostituire = true;
  group.userData.sostRole = 'template';
  group.userData.templateKey = key;
  group.userData.isMirrored = !!mirror;
  // Applica opacita' corrente del gruppo (se l'utente l'ha gia' regolata)
  var uiState = sostGroupUI[key];
  if(uiState && typeof uiState.opacity === 'number'){
    mat.opacity = uiState.opacity;
    mat.transparent = uiState.opacity < 1.0;
  }
  return group;
}

function sostRobustCenter(scanGeo, roughCenter, axis, R){
  if(!axis || !isFinite(axis.x) || !isFinite(axis.y) || !isFinite(axis.z)) return { applied:false, center:roughCenter, coverageDeg:0, nWall:0 };
  if(!scanGeo || !scanGeo.attributes || !scanGeo.attributes.normal) return { applied:false, center:roughCenter, coverageDeg:0, nWall:0 };
  var pos = scanGeo.attributes.position.array;
  var nrm = scanGeo.attributes.normal.array;
  var nTri = pos.length / 9;
  var ax0 = axis.x, ax1 = axis.y, ax2 = axis.z;
  var ref = (Math.abs(ax2) < 0.9) ? [0,0,1] : [1,0,0];
  var ux = ax1*ref[2]-ax2*ref[1], uy = ax2*ref[0]-ax0*ref[2], uz = ax0*ref[1]-ax1*ref[0];
  var ul = Math.sqrt(ux*ux+uy*uy+uz*uz); if(ul < 1e-9) return { applied:false, center:roughCenter, coverageDeg:0, nWall:0 };
  ux/=ul; uy/=ul; uz/=ul;
  var vx = ax1*uz-ax2*uy, vy = ax2*ux-ax0*uz, vz = ax0*uy-ax1*ux;
  var vl = Math.sqrt(vx*vx+vy*vy+vz*vz); if(vl < 1e-9) return { applied:false, center:roughCenter, coverageDeg:0, nWall:0 };
  vx/=vl; vy/=vl; vz/=vl;
  var cx = roughCenter.x, cy = roughCenter.y, cz = roughCenter.z;
  var Rlo = R-0.8, Rhi = R+0.6, coverageDeg = 0, nWall = 0;
  for(var pass = 0; pass < 2; pass++){
    var P2x=[], P2y=[];
    for(var i=0;i<nTri;i++){
      var ni=i*9;
      var tx=(pos[ni]+pos[ni+3]+pos[ni+6])/3, ty=(pos[ni+1]+pos[ni+4]+pos[ni+7])/3, tz=(pos[ni+2]+pos[ni+5]+pos[ni+8])/3;
      var nx=(nrm[ni]+nrm[ni+3]+nrm[ni+6])/3, ny=(nrm[ni+1]+nrm[ni+4]+nrm[ni+7])/3, nz=(nrm[ni+2]+nrm[ni+5]+nrm[ni+8])/3;
      var nl=Math.sqrt(nx*nx+ny*ny+nz*nz); if(nl<0.01) continue; nx/=nl;ny/=nl;nz/=nl;
      if(Math.abs(nx*ax0+ny*ax1+nz*ax2) >= 0.35) continue;       // solo parete laterale
      var dx=tx-cx, dy=ty-cy, dz=tz-cz;
      var axial=dx*ax0+dy*ax1+dz*ax2; if(Math.abs(axial) > 3.5) continue;   // banda assiale
      var px=dx-axial*ax0, py=dy-axial*ax1, pz=dz-axial*ax2;
      var rad=Math.sqrt(px*px+py*py+pz*pz); if(rad < Rlo || rad > Rhi) continue; // anello parete
      P2x.push(dx*ux+dy*uy+dz*uz); P2y.push(dx*vx+dy*vy+dz*vz);   // 2D nel piano ⊥ asse
    }
    nWall = P2x.length;
    if(nWall < 10) return { applied:false, center:roughCenter, coverageDeg:0, nWall:nWall };
    // copertura = 360 - max gap angolare (osservabilita' del centro XY)
    var ang=[]; for(var k=0;k<nWall;k++) ang.push(Math.atan2(P2y[k], P2x[k]));
    ang.sort(function(a,b){return a-b;});
    var maxgap = ang[0] + 2*Math.PI - ang[nWall-1];
    for(var kk=1;kk<nWall;kk++){ var gp=ang[kk]-ang[kk-1]; if(gp>maxgap) maxgap=gp; }
    coverageDeg = (2*Math.PI - maxgap) * 180/Math.PI;
    // fit cerchio algebrico (kasa, raggio libero) -> centro 2D rel ancora corrente
    var Sx=0,Sy=0,Sxx=0,Syy=0,Sxy=0,Sxz=0,Syz=0,Sz=0;
    for(var j=0;j<nWall;j++){ var x=P2x[j], y=P2y[j], z=x*x+y*y;
      Sx+=x;Sy+=y;Sxx+=x*x;Syy+=y*y;Sxy+=x*y;Sxz+=x*z;Syz+=y*z;Sz+=z; }
    var det = Sxx*(Syy*nWall - Sy*Sy) - Sxy*(Sxy*nWall - Sy*Sx) + Sx*(Sxy*Sy - Syy*Sx);
    if(Math.abs(det) < 1e-6) return { applied:false, center:roughCenter, coverageDeg:coverageDeg, nWall:nWall };
    var dA = Sxz*(Syy*nWall - Sy*Sy) - Sxy*(Syz*nWall - Sy*Sz) + Sx*(Syz*Sy - Syy*Sz);
    var dB = Sxx*(Syz*nWall - Sy*Sz) - Sxz*(Sxy*nWall - Sy*Sx) + Sx*(Sxy*Sz - Syz*Sx);
    var c2x = (dA/det)/2, c2y = (dB/det)/2;
    cx = cx + c2x*ux + c2y*vx; cy = cy + c2x*uy + c2y*vy; cz = cz + c2x*uz + c2y*vz;
  }
  if(coverageDeg < SOST_MIN_COVERAGE_DEG) return { applied:false, center:roughCenter, coverageDeg:coverageDeg, nWall:nWall };
  return { applied:true, center:new THREE.Vector3(cx,cy,cz), coverageDeg:coverageDeg, nWall:nWall };
}

function _sostCylFitInvariant(scanGeo, roughCenter, roughAxis, R){
  if(!scanGeo || !scanGeo.attributes || !scanGeo.attributes.normal){ _sostInvLastReason='no-vertex-normals'; return null; }
  var pos = scanGeo.attributes.position.array, nrm = scanGeo.attributes.normal.array;
  var nTri = pos.length / 9;
  var cx = roughCenter.x, cy = roughCenter.y, cz = roughCenter.z;
  var ax = roughAxis.x, ay = roughAxis.y, az = roughAxis.z;
  var _al = Math.sqrt(ax*ax+ay*ay+az*az); if(_al < 1e-9) return null; ax/=_al; ay/=_al; az/=_al;   // asse UNITARIO (le soglie dot lo assumono)
  var ax0 = ax, ay0 = ay, az0 = az;            // verso iniziale = verso il CAP/occlusale (findScanbodyCenter -> normale outward): pinna l'orientamento cosi' axMax e' SEMPRE il cap, mai il fondo
  var Rhi = R + 0.9, Rlo = R - 0.9;            // anello generoso: tutta la parete dello scanbody, no tessuto (oltre Rhi)
  for(var it = 0; it < 25; it++){
    var fa = [];                                // facce piatte: [axial, tx,ty,tz, area, nx,ny,nz]
    var S = [[0,0,0],[0,0,0],[0,0,0]], nWall = 0;
    for(var i = 0; i < nTri; i++){
      var ni = i*9;
      var tx=(pos[ni]+pos[ni+3]+pos[ni+6])/3, ty=(pos[ni+1]+pos[ni+4]+pos[ni+7])/3, tz=(pos[ni+2]+pos[ni+5]+pos[ni+8])/3;
      var dx=tx-cx, dy=ty-cy, dz=tz-cz;
      var axial = dx*ax+dy*ay+dz*az; if(Math.abs(axial) > 3.5) continue;
      var prx=dx-axial*ax, pry=dy-axial*ay, prz=dz-axial*az; var rad=Math.sqrt(prx*prx+pry*pry+prz*prz);
      if(rad > Rhi) continue;                   // tessuto fuori dal raggio
      var nx=(nrm[ni]+nrm[ni+3]+nrm[ni+6])/3, ny=(nrm[ni+1]+nrm[ni+4]+nrm[ni+7])/3, nz=(nrm[ni+2]+nrm[ni+5]+nrm[ni+8])/3;
      var nl=Math.sqrt(nx*nx+ny*ny+nz*nz); if(nl<0.01) continue; nx/=nl;ny/=nl;nz/=nl;
      var e1x=pos[ni+3]-pos[ni], e1y=pos[ni+4]-pos[ni+1], e1z=pos[ni+5]-pos[ni+2];
      var e2x=pos[ni+6]-pos[ni], e2y=pos[ni+7]-pos[ni+1], e2z=pos[ni+8]-pos[ni+2];
      var crx=e1y*e2z-e1z*e2y, cry=e1z*e2x-e1x*e2z, crz=e1x*e2y-e1y*e2x;
      var ar=0.5*Math.sqrt(crx*crx+cry*cry+crz*crz);
      var dotA = nx*ax+ny*ay+nz*az;
      if(Math.abs(dotA) > 0.75){ fa.push([axial, tx,ty,tz, ar, nx,ny,nz]); }   // faccia piatta (cap o fondo)
      else if(Math.abs(dotA) < 0.35 && rad >= Rlo){                            // parete nell'anello
        S[0][0]+=ar*nx*nx; S[0][1]+=ar*nx*ny; S[0][2]+=ar*nx*nz;
        S[1][0]+=ar*ny*nx; S[1][1]+=ar*ny*ny; S[1][2]+=ar*ny*nz;
        S[2][0]+=ar*nz*nx; S[2][1]+=ar*nz*ny; S[2][2]+=ar*nz*nz; nWall++;
      }
    }
    if(fa.length < 3){ _sostInvLastReason='cap<3 (facce piatte='+fa.length+')'; return null; }   // niente cap -> non e' uno scanbody qui
    // CAP = facce piatte all'estremo +asse (disco occlusale); scarta il fondo (connessione)
    var axMax = -Infinity; for(var k=0;k<fa.length;k++){ if(fa[k][0] > axMax) axMax = fa[k][0]; }
    var sx=0,sy=0,sz=0,sw=0, cnx=0,cny=0,cnz=0;
    for(var k2=0;k2<fa.length;k2++){
      if(fa[k2][0] < axMax - 0.6) continue;      // tieni solo il cap (top)
      var w=fa[k2][4]; sx+=w*fa[k2][1]; sy+=w*fa[k2][2]; sz+=w*fa[k2][3]; sw+=w;
      var sgn=(fa[k2][5]*ax+fa[k2][6]*ay+fa[k2][7]*az)>0?1:-1;
      cnx+=w*sgn*fa[k2][5]; cny+=w*sgn*fa[k2][6]; cnz+=w*sgn*fa[k2][7];
    }
    if(sw <= 0){ _sostInvLastReason='area-cap=0'; return null; }
    var ncx=sx/sw, ncy=sy/sw, ncz=sz/sw;         // centro = baricentro del CAP (click-invariante)
    var nax=ax, nay=ay, naz=az;
    if(nWall >= 12){                              // asse dalla parete (preferito)
      var ej=misICP_jacobi3(S); var mi=0; if(ej.vals[1]<ej.vals[mi])mi=1; if(ej.vals[2]<ej.vals[mi])mi=2;
      var wx=ej.vecs[0][mi], wy=ej.vecs[1][mi], wz=ej.vecs[2][mi]; var wl=Math.sqrt(wx*wx+wy*wy+wz*wz);
      if(wl>1e-9){ wx/=wl;wy/=wl;wz/=wl; if(wx*ax+wy*ay+wz*az<0){wx=-wx;wy=-wy;wz=-wz;} nax=wx;nay=wy;naz=wz; }
    } else {                                      // parete insufficiente -> normale media del cap
      var cl=Math.sqrt(cnx*cnx+cny*cny+cnz*cnz);
      if(cl>1e-9){ nax=cnx/cl; nay=cny/cl; naz=cnz/cl; }
    }
    if(nax*ax0+nay*ay0+naz*az0 < 0){ nax=-nax; nay=-nay; naz=-naz; }   // tieni l'asse verso il CAP (no inversione -> centro sempre sul disco occlusale)
    var dC=Math.sqrt((ncx-cx)*(ncx-cx)+(ncy-cy)*(ncy-cy)+(ncz-cz)*(ncz-cz));
    var dA=1-Math.abs(nax*ax+nay*ay+naz*az);
    cx=ncx;cy=ncy;cz=ncz; ax=nax;ay=nay;az=naz;
    if(dC < 1e-5 && dA < 1e-10) break;            // punto fisso (sub-µm, sub-millideg) -> click-invariante
  }
  _sostInvLastReason='ok (parete nWall='+nWall+', facce cap='+fa.length+')';
  return { center: new THREE.Vector3(cx,cy,cz), axis: new THREE.Vector3(ax,ay,az), applied: true };
}

// 8.66.3 (Tara/OS — asse pulito SEED-INDIPENDENTE). Diagnosi gate-validata su id 2770: tutti
// e 6 i marker di File B sono la mesh BIT-IDENTICA (firma triangoli=0.00µm) e gli estimatori
// d'asse sono PERFETTAMENTE equivarianti -> il wall-eigenvector GEOMETRIA-seeded ha errore
// 0.0801° UNIFORME su tutti e 6 (offline). Ma il piazzamento reale da' 0.3-1.0° NON-uniforme,
// correlato alla VERTICALITA' del marker (#4 dritto -> peggio, #6 inclinato -> meglio): il fit
// click-seeded di _sostCylFitInvariant trattiene il bias di findScanbodyCenter (asse iniziale
// = media normali del CLICK + ref mondo [0,0,1]) che per l'OS corto (asse mal condizionato)
// non viene del tutto rimosso. Qui ricalcolo l'asse OS in modo EQUIVARIANTE, indipendente dal
// click: (1) normale dominante del cluster (= disco, rough robusto); (2) min-eigenvector dello
// scatter area-pesato delle sole normali di PARETE (|n.rough|<0.35) = asse cilindro. Imposta
// SOLO la direzione (roll-free); centro/livello invariati. Guardia 5° -> fail-soft asse cap-fit.
function _sostGeomWallAxis(scanGeo, center, R, refAxis){
  if(!scanGeo || !scanGeo.attributes || !scanGeo.attributes.position) return null;
  var pos = scanGeo.attributes.position.array, nTri = pos.length/9;
  var cx=center.x, cy=center.y, cz=center.z, Rsph=R+0.8, Rsph2=Rsph*Rsph;
  var S=[[0,0,0],[0,0,0],[0,0,0]], tris=[];
  for(var i=0;i<nTri;i++){
    var o=i*9;
    var tx=(pos[o]+pos[o+3]+pos[o+6])/3, ty=(pos[o+1]+pos[o+4]+pos[o+7])/3, tz=(pos[o+2]+pos[o+5]+pos[o+8])/3;
    var dx=tx-cx, dy=ty-cy, dz=tz-cz; if(dx*dx+dy*dy+dz*dz > Rsph2) continue;
    var e1x=pos[o+3]-pos[o], e1y=pos[o+4]-pos[o+1], e1z=pos[o+5]-pos[o+2];
    var e2x=pos[o+6]-pos[o], e2y=pos[o+7]-pos[o+1], e2z=pos[o+8]-pos[o+2];
    var nx=e1y*e2z-e1z*e2y, ny=e1z*e2x-e1x*e2z, nz=e1x*e2y-e1y*e2x;
    var nl=Math.sqrt(nx*nx+ny*ny+nz*nz); if(nl<1e-9) continue;
    var area=0.5*nl; nx/=nl;ny/=nl;nz/=nl;
    S[0][0]+=area*nx*nx; S[0][1]+=area*nx*ny; S[0][2]+=area*nx*nz;
    S[1][0]+=area*ny*nx; S[1][1]+=area*ny*ny; S[1][2]+=area*ny*nz;
    S[2][0]+=area*nz*nx; S[2][1]+=area*nz*ny; S[2][2]+=area*nz*nz;
    tris.push([nx,ny,nz,area,dx,dy,dz]);   // 8.69.5: + centroide relativo per il filtro radiale
  }
  if(tris.length<20) return null;
  // 8.69.5: direzione asse/disco ROBUSTA AL TESSUTO. Sul GREZZO la sfera R+0.8 raccoglie la GENGIVA
  // attorno alla base -> le sue normali DOMINANO il MAX-autovettore (rough), che esce a ~90° dall'asse
  // vero -> la selezione parete |n.rough|<0.35 prende i triangoli sbagliati -> asse risultante >5° dal
  // seed -> guardia -> SKIP. Verificato gate-validato sul caso reale id2161 (CSV: tutti e 6
  // " (geomAxisSR skip)" sul grezzo; APP-esatto riprodotto offline = ~90° fuori -> skip). FIX: se
  // refAxis (= asse seed, gia' lungo l'asse del cilindro) e' fornito, usalo come direzione disco invece
  // del max-autovettore inquinato; + filtro RADIALE (distanza perp ~R) per escludere gengiva/cap dalla
  // sfera. Su dato pulito rough~=refAxis e niente tessuto -> NO-OP (nessuna regressione sul sintetico).
  var rx,ry,rz;
  if(refAxis){ var _rfl=Math.sqrt(refAxis.x*refAxis.x+refAxis.y*refAxis.y+refAxis.z*refAxis.z)||1; rx=refAxis.x/_rfl; ry=refAxis.y/_rfl; rz=refAxis.z/_rfl; }
  else {
    var ej=misICP_jacobi3(S), mx=0;
    if(ej.vals[1]>ej.vals[mx])mx=1; if(ej.vals[2]>ej.vals[mx])mx=2;   // MAX autovalore -> normale dominante (disco)
    rx=ej.vecs[0][mx]; ry=ej.vecs[1][mx]; rz=ej.vecs[2][mx];
    var rl=Math.sqrt(rx*rx+ry*ry+rz*rz); if(rl<1e-9) return null; rx/=rl;ry/=rl;rz/=rl;
  }
  var W=[[0,0,0],[0,0,0],[0,0,0]], nWall=0, _Rlo=R-0.8, _Rhi=R+0.8;
  for(var k=0;k<tris.length;k++){
    var t=tris[k]; if(Math.abs(t[0]*rx+t[1]*ry+t[2]*rz) >= 0.35) continue;   // solo PARETE (normale perp asse)
    var _ad=t[4]*rx+t[5]*ry+t[6]*rz, _px=t[4]-_ad*rx, _py=t[5]-_ad*ry, _pz=t[6]-_ad*rz;
    var _rad=Math.sqrt(_px*_px+_py*_py+_pz*_pz); if(_rad<_Rlo || _rad>_Rhi) continue;   // 8.69.5: anello parete -> esclude gengiva/cap
    var a=t[3];
    W[0][0]+=a*t[0]*t[0]; W[0][1]+=a*t[0]*t[1]; W[0][2]+=a*t[0]*t[2];
    W[1][0]+=a*t[1]*t[0]; W[1][1]+=a*t[1]*t[1]; W[1][2]+=a*t[1]*t[2];
    W[2][0]+=a*t[2]*t[0]; W[2][1]+=a*t[2]*t[1]; W[2][2]+=a*t[2]*t[2];
    nWall++;
  }
  if(nWall<12) return null;
  var ew=misICP_jacobi3(W), mi=0;
  if(ew.vals[1]<ew.vals[mi])mi=1; if(ew.vals[2]<ew.vals[mi])mi=2;   // MIN autovalore -> asse cilindro
  var ax=ew.vecs[0][mi], ay=ew.vecs[1][mi], az=ew.vecs[2][mi];
  var al=Math.sqrt(ax*ax+ay*ay+az*az); if(al<1e-9) return null; ax/=al;ay/=al;az/=al;
  if(refAxis){
    if(ax*refAxis.x+ay*refAxis.y+az*refAxis.z < 0){ ax=-ax;ay=-ay;az=-az; }   // verso il cap
    if(ax*refAxis.x+ay*refAxis.y+az*refAxis.z < Math.cos(5*Math.PI/180)) return null;   // guardia 5°
  }
  return new THREE.Vector3(ax,ay,az);
}

// 8.69.6: flag opt-in del candidato CAP-PLANE (default OFF -> 8.69.5 invariato).
function _sostCapPlaneOn(){ try { return localStorage.getItem('syntesis_sost_cap_plane')==='on'; } catch(e){ return false; } }

// 8.69.6: PIANO DEL CAP robusto (origine-only IRLS) per raffinare l'ASSE dello scanbody. Il cap occlusale
// e' la feature piu' PULITA -> la sua normale e' un asse meglio condizionato del solo wall-axis. Cross-validato
// (GPT + riproduzione locale identica): sul caso reale id2161 porta il gate funzionale (cap+5mm*asse) da 8.58
// a 3.07µm, con l'asse-cap che RAFFINA la parete di 0.05-0.2° (non un asse nuovo). NON sostituisce 8.69.5:
// e' un candidato gated (vedi _sostCapAnchoredPose). Selezione cap rispetto a (center,axis) = posa 8.69.5:
// |n.axis|>=0.65 (faccia ~perp asse), |assiale|<=0.18mm (banda stretta), radiale<=R+0.07. IRLS: orientamento
// da PCA AREA-pesata, origine aggiornata con Tukey (origine-only: l'IRLS pieno sull'orientamento PEGGIORA su
// cap arrotondato, 3.84 vs 3.07 - dettaglio intenzionale). sigma=max(1.4826*MAD,0.002mm), c=4.685, max 10 iter.
function _sostCapPlaneFit(scanGeo, center, axis, R){
  if(!scanGeo || !scanGeo.attributes || !scanGeo.attributes.position || !scanGeo.attributes.normal) return null;
  var pos=scanGeo.attributes.position.array, nTri=pos.length/9;
  var ax0=axis.x, ax1=axis.y, ax2=axis.z; var aL=Math.sqrt(ax0*ax0+ax1*ax1+ax2*ax2)||1; ax0/=aL;ax1/=aL;ax2/=aL;
  var ref=(Math.abs(ax0)<0.8)?[1,0,0]:[0,1,0];
  var ux=ax1*ref[2]-ax2*ref[1], uy=ax2*ref[0]-ax0*ref[2], uz=ax0*ref[1]-ax1*ref[0]; var ul=Math.sqrt(ux*ux+uy*uy+uz*uz)||1; ux/=ul;uy/=ul;uz/=ul;
  var vx=ax1*uz-ax2*uy, vy=ax2*ux-ax0*uz, vz=ax0*uy-ax1*ux;
  var cx=center.x, cy=center.y, cz=center.z;
  var Px=[],Py=[],Pz=[],Ar=[], R2=36.0;   // crop sfera 6mm (solo velocita')
  for(var i=0;i<nTri;i++){
    var o=i*9;
    var tx=(pos[o]+pos[o+3]+pos[o+6])/3, ty=(pos[o+1]+pos[o+4]+pos[o+7])/3, tz=(pos[o+2]+pos[o+5]+pos[o+8])/3;
    var dx=tx-cx, dy=ty-cy, dz=tz-cz; if(dx*dx+dy*dy+dz*dz>R2) continue;
    var e1x=pos[o+3]-pos[o], e1y=pos[o+4]-pos[o+1], e1z=pos[o+5]-pos[o+2];
    var e2x=pos[o+6]-pos[o], e2y=pos[o+7]-pos[o+1], e2z=pos[o+8]-pos[o+2];
    var nx=e1y*e2z-e1z*e2y, ny=e1z*e2x-e1x*e2z, nz=e1x*e2y-e1y*e2x; var nl=Math.sqrt(nx*nx+ny*ny+nz*nz); if(nl<1e-12) continue; var area=0.5*nl; nx/=nl;ny/=nl;nz/=nl;
    if(Math.abs(nx*ax0+ny*ax1+nz*ax2)<0.65) continue;                 // cap = faccia ~perp asse
    var s=dx*ax0+dy*ax1+dz*ax2; if(Math.abs(s)>0.18) continue;        // banda assiale stretta
    var qx=dx-s*ax0, qy=dy-s*ax1, qz=dz-s*ax2; var rad=Math.sqrt(qx*qx+qy*qy+qz*qz); if(rad>R+0.07) continue;
    Px.push(tx);Py.push(ty);Pz.push(tz);Ar.push(area);
  }
  var n=Px.length, k; if(n<100) return null;
  var ox=0,oy=0,oz=0,wsum=0; for(k=0;k<n;k++){ ox+=Ar[k]*Px[k]; oy+=Ar[k]*Py[k]; oz+=Ar[k]*Pz[k]; wsum+=Ar[k]; } ox/=wsum;oy/=wsum;oz/=wsum;
  var nax=[ax0,ax1,ax2], lam=[0,0,0];
  for(var it=0;it<10;it++){
    var M=[[0,0,0],[0,0,0],[0,0,0]], cw=0;
    for(k=0;k<n;k++){ var Qx=Px[k]-ox,Qy=Py[k]-oy,Qz=Pz[k]-oz,a=Ar[k];
      M[0][0]+=a*Qx*Qx;M[0][1]+=a*Qx*Qy;M[0][2]+=a*Qx*Qz;M[1][1]+=a*Qy*Qy;M[1][2]+=a*Qy*Qz;M[2][2]+=a*Qz*Qz;cw+=a; }
    M[1][0]=M[0][1];M[2][0]=M[0][2];M[2][1]=M[1][2];
    for(var r=0;r<3;r++)for(var c=0;c<3;c++)M[r][c]/=cw;
    var eg=misICP_jacobi3(M); var mi=0; if(eg.vals[1]<eg.vals[mi])mi=1; if(eg.vals[2]<eg.vals[mi])mi=2; lam=eg.vals.slice();
    var na=[eg.vecs[0][mi],eg.vecs[1][mi],eg.vecs[2][mi]]; var nl2=Math.sqrt(na[0]*na[0]+na[1]*na[1]+na[2]*na[2])||1; na=[na[0]/nl2,na[1]/nl2,na[2]/nl2];
    if(na[0]*ax0+na[1]*ax1+na[2]*ax2<0){ na=[-na[0],-na[1],-na[2]]; } nax=na;
    var res=new Array(n); for(k=0;k<n;k++) res[k]=(Px[k]-ox)*nax[0]+(Py[k]-oy)*nax[1]+(Pz[k]-oz)*nax[2];
    var sr=res.slice().sort(function(a,b){return a-b;}); var med=sr[Math.floor(n/2)];
    var ab=res.map(function(x){return Math.abs(x-med);}).sort(function(a,b){return a-b;}); var sig=Math.max(1.4826*ab[Math.floor(n/2)],0.002);
    var nox=0,noy=0,noz=0,nw=0;
    for(k=0;k<n;k++){ var z=(res[k]-med)/sig; var rob=(Math.abs(z)<4.685)?Math.pow(1-(z/4.685)*(z/4.685),2):0; var wk=Ar[k]*rob; nox+=wk*Px[k];noy+=wk*Py[k];noz+=wk*Pz[k];nw+=wk; }
    if(nw<=0) return null;
    var mv=Math.sqrt((nox/nw-ox)*(nox/nw-ox)+(noy/nw-oy)*(noy/nw-oy)+(noz/nw-oz)*(noz/nw-oz));
    ox=nox/nw;oy=noy/nw;oz=noz/nw; if(mv<1e-8) break;
  }
  var srr=0,sww=0; for(k=0;k<n;k++){ var rr=(Px[k]-ox)*nax[0]+(Py[k]-oy)*nax[1]+(Pz[k]-oz)*nax[2]; srr+=Ar[k]*rr*rr; sww+=Ar[k]; }
  var planeRMS=Math.sqrt(srr/sww)*1000;
  var ang=[]; for(k=0;k<n;k++){ var Dx=Px[k]-ox,Dy=Py[k]-oy,Dz=Pz[k]-oz; ang.push(Math.atan2(Dx*vx+Dy*vy+Dz*vz, Dx*ux+Dy*uy+Dz*uz)); }
  ang.sort(function(a,b){return a-b;}); var mg=ang[0]+2*Math.PI-ang[n-1]; for(k=1;k<n;k++){var g=ang[k]-ang[k-1]; if(g>mg)mg=g;}
  var coverageDeg=(2*Math.PI-mg)*180/Math.PI;
  var areaFrac=sww/(Math.PI*R*R); var sl=lam.slice().sort(function(a,b){return a-b;}); var lamRatio=(sl[2]>1e-12)?sl[1]/sl[2]:0;
  return { axis:new THREE.Vector3(nax[0],nax[1],nax[2]), origin:new THREE.Vector3(ox,oy,oz), n:n, planeRMS:planeRMS, coverageDeg:coverageDeg, areaFrac:areaFrac, lamRatio:lamRatio };
}

// 8.69.6/8.69.7: posa SR col candidato CAP-PLANE. (center0,axis0) = baseline 8.69.5 (sempre rete di protezione).
// Calcola il piano-cap; se passa i GATE INTRINSECI SEVERI (niente verita' exocad live) e l'asse-cap concorda
// con la parete: asse-cap + riancoraggio assiale al piano-cap + ri-Kasa nel nuovo piano (applied=true). Altrimenti
// applied=false col motivo del gate fallito. Soglie da GPT. Trust-region sul centro. Per-marker, no cross-marker.
// 8.69.7: ritorna SEMPRE l'oggetto diagnostico (mai null) cosi' la catena cap-plane si logga nel CSV anche
// quando il flag e' off (SHADOW). axis = asse-cap (settato appena disponibile, anche se un gate respinge);
// center = centro ri-Kasa (solo se la parete passa). reason: ok | no-cap-fit | cap-gate | wall-gate | trust-region.
function _sostCapAnchoredPose(scanGeo, center0, axis0, R){
  var D={ applied:false, reason:'', dAng:null, planeRMS:null, coverageDeg:null, areaFrac:null, lamRatio:null, n:null, nWall:null, wallCov:null, centerShift:null, axis:null, center:null };
  var cap=_sostCapPlaneFit(scanGeo, center0, axis0, R); if(!cap){ D.reason='no-cap-fit'; return D; }
  var capAx=cap.axis; if(capAx.dot(axis0)<0) capAx=capAx.clone().multiplyScalar(-1);
  var dAng=Math.acos(Math.max(-1,Math.min(1, capAx.dot(axis0))))*180/Math.PI;
  D.dAng=dAng; D.planeRMS=cap.planeRMS; D.coverageDeg=cap.coverageDeg; D.areaFrac=cap.areaFrac; D.lamRatio=cap.lamRatio; D.n=cap.n; D.axis=capAx.clone().normalize();
  if(cap.n<150 || cap.areaFrac<0.70 || cap.coverageDeg<300 || cap.planeRMS>35 || cap.lamRatio<0.55 || dAng>0.35){ D.reason='cap-gate'; return D; }  // gate cap forte + concordanza asse
  var t=cap.origin.clone().sub(center0).dot(capAx);
  var centerOnCap=center0.clone().add(capAx.clone().multiplyScalar(t));   // riancoraggio assiale
  var wf=sostRobustCenter(scanGeo, centerOnCap, capAx, R);                 // ri-Kasa nel piano del cap-axis
  D.nWall=(wf?wf.nWall:null); D.wallCov=(wf?wf.coverageDeg:null);
  if(!wf.applied || wf.nWall<600 || wf.coverageDeg<180){ D.reason='wall-gate'; return D; }   // gate parete
  var shift=wf.center.clone().sub(center0).length(); D.centerShift=shift; D.center=wf.center.clone();
  if(shift>0.035){ D.reason='trust-region'; return D; }                    // trust-region 35µm
  D.applied=true; D.reason='ok'; D.axis=capAx.clone().normalize(); D.center=wf.center.clone();
  return D;
}

// ═══ 8.69.8: METHOD C — semantic local fit 5-DOF (cap point-to-plane + wall radiale + coerenza normali) ═══
// Stima CONGIUNTA centro+asse per-marker (3 traslazioni + 2 tilt asse, roll congelato), IRLS Tukey, LM a mano.
// Port JS validato 1:1 vs prototipo Python (R_fit esatto, centro ~0.004µm, asse valle-piatta cost-equivalente).
// Offline (id2161 grezzo): held-out 2.62µm vs cap-plane 4.61µm; dimezza l'incertezza d'asse. Per-marker, NO cross-marker.
// Init = posa cap-plane (8.69.6). Opt-in 'syntesis_sost_method_c'='on'; DEFAULT OFF; shadow-loggato sempre nel CSV.
function _sostMCOn(){ try { return localStorage.getItem('syntesis_sost_method_c')==='on'; } catch(e){ return false; } }
// §PURELIB: _mcMedian, _mcTukey, _mcBasis, _mcSolveLin, _mcDot → /static/ds/syn-math.js (Fase 4, caricato in testa)
// fit_semantic: crop sfera 6mm attorno a cInit, bande cap/wall rel. (cInit,aInit), LM+IRLS. fitR=true -> 6° DOF (R).
function _sostMethodCFit(scanGeo, cInit, aInit, Rinit, wc, ww, wn, fitR){
  if(!scanGeo || !scanGeo.attributes || !scanGeo.attributes.position) return null;
  var pos=scanGeo.attributes.position.array, nTri=pos.length/9;
  var Bs=_mcBasis(aInit); var u0=Bs.u,v0=Bs.v,a0=Bs.a;
  var cx=cInit[0],cy=cInit[1],cz=cInit[2];
  var Pc=[],Ac=[],Pw=[],Nw=[],Aw=[];
  for(var ti=0;ti<nTri;ti++){
    var o=ti*9;
    var tx=(pos[o]+pos[o+3]+pos[o+6])/3, ty=(pos[o+1]+pos[o+4]+pos[o+7])/3, tz=(pos[o+2]+pos[o+5]+pos[o+8])/3;
    var dx=tx-cx, dy=ty-cy, dz=tz-cz; if(dx*dx+dy*dy+dz*dz>36.0) continue;   // crop 6mm
    var e1x=pos[o+3]-pos[o], e1y=pos[o+4]-pos[o+1], e1z=pos[o+5]-pos[o+2];
    var e2x=pos[o+6]-pos[o], e2y=pos[o+7]-pos[o+1], e2z=pos[o+8]-pos[o+2];
    var nx=e1y*e2z-e1z*e2y, ny=e1z*e2x-e1x*e2z, nz=e1x*e2y-e1y*e2x; var nl=Math.sqrt(nx*nx+ny*ny+nz*nz); if(nl<1e-12) continue;
    var area=0.5*nl; nx/=nl;ny/=nl;nz/=nl;
    var s=dx*a0[0]+dy*a0[1]+dz*a0[2];
    var px=dx*u0[0]+dy*u0[1]+dz*u0[2], py=dx*v0[0]+dy*v0[1]+dz*v0[2]; var rr=Math.hypot(px,py);
    var nd=Math.abs(nx*a0[0]+ny*a0[1]+nz*a0[2]);
    if(nd>=0.65 && Math.abs(s)<=0.18 && rr<=2.10){ Pc.push([tx,ty,tz]); Ac.push(area); }
    if(nd<0.35 && Math.abs(s)<=3.5 && rr>=Rinit-0.8 && rr<=Rinit+0.6){ Pw.push([tx,ty,tz]); Nw.push([nx,ny,nz]); Aw.push(area); }
  }
  var nc=Pc.length, nw=Pw.length; if(nc<50 || nw<50) return null;
  var swc=Ac.map(Math.sqrt), sww=Aw.map(Math.sqrt);
  var sqwc=Math.sqrt(wc), sqww=Math.sqrt(ww), sqwn=Math.sqrt(wn);
  function unpack(x){
    var c=[cx+x[0]*u0[0]+x[1]*v0[0]+x[2]*a0[0], cy+x[0]*u0[1]+x[1]*v0[1]+x[2]*a0[1], cz+x[0]*u0[2]+x[1]*v0[2]+x[2]*a0[2]];
    var av=[a0[0]+x[3]*u0[0]+x[4]*v0[0], a0[1]+x[3]*u0[1]+x[4]*v0[1], a0[2]+x[3]*u0[2]+x[4]*v0[2]];
    var aL=Math.hypot(av[0],av[1],av[2])||1; return {c:c, a:[av[0]/aL,av[1]/aL,av[2]/aL], Rv:(fitR?x[5]:Rinit)};
  }
  var st={rc:new Array(nc).fill(1), rwRad:new Array(nw).fill(1), rwN:new Array(nw).fill(1)};
  function resid(x){
    var P2=unpack(x); var c=P2.c,a=P2.a,Rv=P2.Rv; var r=new Float64Array(nc+2*nw); var k=0,i;
    for(i=0;i<nc;i++){ var ec=(Pc[i][0]-c[0])*a[0]+(Pc[i][1]-c[1])*a[1]+(Pc[i][2]-c[2])*a[2]; r[k++]=sqwc*swc[i]*st.rc[i]*ec; }
    for(i=0;i<nw;i++){ var dx=Pw[i][0]-c[0],dy=Pw[i][1]-c[1],dz=Pw[i][2]-c[2]; var sw=dx*a[0]+dy*a[1]+dz*a[2]; var qx=dx-sw*a[0],qy=dy-sw*a[1],qz=dz-sw*a[2]; var rad=Math.hypot(qx,qy,qz)-Rv; r[k++]=sqww*sww[i]*st.rwRad[i]*rad; }
    for(i=0;i<nw;i++){ var en=Nw[i][0]*a[0]+Nw[i][1]*a[1]+Nw[i][2]*a[2]; r[k++]=sqwn*sww[i]*st.rwN[i]*en; }
    return r;
  }
  function lm(x0){
    var x=x0.slice(), lambda=1e-3, r=resid(x), cost=_mcDot(r,r), n=x.length, m=r.length, i,j;
    for(var iter=0;iter<120;iter++){
      var cols=[];
      for(j=0;j<n;j++){ var eps=1e-6*(Math.abs(x[j])+1); var xp=x.slice(); xp[j]+=eps; var xm=x.slice(); xm[j]-=eps; var rp=resid(xp),rm=resid(xm); var col=new Float64Array(m); for(i=0;i<m;i++) col[i]=(rp[i]-rm[i])/(2*eps); cols.push(col); }
      var Am=[], g=new Float64Array(n), a2,b2;
      for(a2=0;a2<n;a2++){ Am[a2]=new Float64Array(n); for(b2=0;b2<n;b2++){ var s2=0; for(i=0;i<m;i++) s2+=cols[a2][i]*cols[b2][i]; Am[a2][b2]=s2; } var sg=0; for(i=0;i<m;i++) sg+=cols[a2][i]*r[i]; g[a2]=sg; }
      var improved=false;
      for(var tr=0;tr<10;tr++){
        var Aug=[]; for(a2=0;a2<n;a2++){ Aug[a2]=Array.from(Am[a2]); Aug[a2][a2]+=lambda*Am[a2][a2]; }
        var rhs=new Array(n); for(a2=0;a2<n;a2++) rhs[a2]=-g[a2];
        var dx=_mcSolveLin(Aug,rhs); if(!dx){ lambda*=10; continue; }
        var xn=x.map(function(v,idx){return v+dx[idx];}); var rn=resid(xn); var cn=_mcDot(rn,rn);
        if(cn<cost){ var rel=(cost-cn)/Math.max(cost,1e-30); x=xn; r=rn; cost=cn; lambda=Math.max(lambda/3,1e-13); improved=true; if(rel<1e-14) return x; break; }
        else { lambda*=10; if(lambda>1e13) return x; }
      }
      if(!improved) return x;
    }
    return x;
  }
  var x=[0,0,0,0,0]; if(fitR) x.push(Rinit);
  for(var it=0;it<4;it++){
    x=lm(x); var P2=unpack(x); var c=P2.c,a=P2.a,Rv=P2.Rv;
    var ec=new Array(nc), rad=new Array(nw), en=new Array(nw), i;
    for(i=0;i<nc;i++) ec[i]=(Pc[i][0]-c[0])*a[0]+(Pc[i][1]-c[1])*a[1]+(Pc[i][2]-c[2])*a[2];
    for(i=0;i<nw;i++){ var dx=Pw[i][0]-c[0],dy=Pw[i][1]-c[1],dz=Pw[i][2]-c[2]; var sw=dx*a[0]+dy*a[1]+dz*a[2]; var qx=dx-sw*a[0],qy=dy-sw*a[1],qz=dz-sw*a[2]; rad[i]=Math.hypot(qx,qy,qz)-Rv; en[i]=Nw[i][0]*a[0]+Nw[i][1]*a[1]+Nw[i][2]*a[2]; }
    var tc=_mcTukey(ec,4.685), trr=_mcTukey(rad,4.685), tn=_mcTukey(en,4.685);
    for(i=0;i<nc;i++) st.rc[i]=Math.sqrt(tc[i]);
    for(i=0;i<nw;i++){ st.rwRad[i]=Math.sqrt(trr[i]); st.rwN[i]=Math.sqrt(tn[i]); }
  }
  var RR=unpack(x); var c=RR.c, a=RR.a;
  if(a[0]*a0[0]+a[1]*a0[1]+a[2]*a0[2]<0){ a=[-a[0],-a[1],-a[2]]; }
  return { center:c, axis:a, R_fit:RR.Rv, ncap:nc, nwall:nw };
}
// orchestratore: 6-DOF -> R_fit, poi 5-DOF -> posa; gate + diag. Ritorna SEMPRE un oggetto (mai null) per lo shadow log.
function _sostMethodCPose(scanGeo, c0, a0, R){
  var D={ applied:false, reason:'', cenShift:null, axDeg:null, Rfit:null, ncap:null, nwall:null, center:null, axis:null };
  var c0a=[c0.x,c0.y,c0.z], a0a=[a0.x,a0.y,a0.z];
  var r6=_sostMethodCFit(scanGeo, c0a, a0a, R, 1, 0.5, 0.1, true);
  if(!r6){ D.reason='no-fit'; return D; }
  D.Rfit=r6.R_fit; D.ncap=r6.ncap; D.nwall=r6.nwall;
  if(r6.R_fit<R-0.15 || r6.R_fit>R+0.15){ D.reason='rfit-out'; return D; }   // R_fit plausibile (~2.03±0.15)
  var r5=_sostMethodCFit(scanGeo, c0a, a0a, r6.R_fit, 1, 0.5, 0.1, false);
  if(!r5){ D.reason='no-fit5'; return D; }
  D.ncap=r5.ncap; D.nwall=r5.nwall;
  var sh=Math.hypot(r5.center[0]-c0a[0], r5.center[1]-c0a[1], r5.center[2]-c0a[2]);
  var dotc=Math.max(-1,Math.min(1, r5.axis[0]*a0a[0]+r5.axis[1]*a0a[1]+r5.axis[2]*a0a[2]));
  var ad=Math.acos(Math.abs(dotc))*180/Math.PI;
  D.cenShift=sh; D.axDeg=ad; D.center=r5.center.slice(); D.axis=r5.axis.slice();
  if(r5.ncap<150 || r5.nwall<600){ D.reason='few-pts'; return D; }   // dati sufficienti
  if(sh>0.060){ D.reason='trust-center'; return D; }                 // trust-region centro 60µm
  if(ad>0.50){ D.reason='trust-axis'; return D; }                    // trust-region asse 0.5°
  if(!isFinite(sh) || !isFinite(ad)){ D.reason='nan'; return D; }
  D.applied=true; D.reason='ok';
  return D;
}

function sostPlaceTemplate(rawPoint, rawNormal){
  // Auto-centratura deterministica (stessa funzione di Analizza).
  // Passa il raggio del marker presente nella scansione di partenza
  // (1T3: 2.515, SR: 2.030, OS: 1.780) per fare il fit cilindro corretto.
  var sourceRadius = (SOSTITUIRE_TEMPLATE_INFO[sostSourceTemplate] || {}).radius;
  try{ synLog('sost','posa start', {src:sostSourceTemplate, radius:sourceRadius, pt:[+rawPoint.x.toFixed(3),+rawPoint.y.toFixed(3),+rawPoint.z.toFixed(3)], findScanbody:typeof findScanbodyCenter}); }catch(_){}
  var autoResult;
  try {
    autoResult = findScanbodyCenter(sostMesh.geometry, rawPoint, rawNormal,
      sourceRadius ? { radius: sourceRadius } : undefined);
  } catch(_fsc){
    try{ synLog('sost','posa FALLITA: findScanbodyCenter ha lanciato', {msg:(_fsc&&_fsc.message)||String(_fsc)}); }catch(_){}
    sostShowStatus('Errore nel rilevamento dello scanbody cliccato: '+((_fsc&&_fsc.message)||_fsc), true);
    throw _fsc;
  }
  var discWorld = autoResult.center;       // faccia del disco scansionato nel mondo
  var axis = autoResult.axis.clone().normalize();
  // Replace-iT: centraggio click-invariante (flag 'syntesis_sost_center'='robust').
  // 8.63.0: esteso da SR a tutti i tipi. 8.63.2: per 1T3/OS FIT CILINDRO CONGIUNTO click-invariante
  // (CENTRO + ASSE, iterato). Robustificare solo il centro NON bastava: l'asse cap-media residuo era
  // ancora click-dipendente (~0.5° run-to-run) e, col centroide del sostituto sfalsato lungo l'asse
  // (~1mm di leva), dava ~10µm di deriva = il residuo misurato "OS su OS" (file uguale dovrebbe -> 0).
  // Iterando asse(parete) <-> centro(kasa) attorno al centro robusto, ENTRAMBI diventano click-
  // invarianti -> posa deterministica -> stesso file su se' stesso -> verso 0. SR (8.68.2): robust-centro
  // + asse parete pulito pre-Kasa (mirror OS 8.66.7, vedi ramo else). beta opt-in (default 'legacy' INVARIATO); fail-soft a legacy.
  // [ROBUST-DIAG 8.64.3] gate: perché il robust (non) si applica
  var _scSet = synSostCenterRead();
  var _placeDiagCap = null;   // 8.66.9: catena centraggio catturata per il log CSV diagnostico
  if(_scSet === 'robust' && sourceRadius){
    try {
      var _cen = autoResult.center, _ax = axis, _ok = false, _cov = 0;
      _sostInvLastReason = '';
      var _capDiag = null;   // 8.69.7: diagnostica cap-plane catturata SEMPRE (shadow) per il log CSV
      var _mcDiag = null;    // 8.69.8: diagnostica Method C catturata SEMPRE (shadow) per il log CSV
      if(sostSourceTemplate !== 'SR'){
        // 8.63.4: detection CLICK-INVARIANTE (fit cap+parete a punto fisso) -> due click qualsiasi
        // sullo stesso scanbody -> stesso (centro,asse) -> posa identica -> ripetibilita' ~0. Il cap
        // sempre presente sostituisce il fail-soft del robust-Kasa su parete povera.
        var _fit = _sostCylFitInvariant(sostMesh.geometry, autoResult.center, axis, sourceRadius);
        if(_fit){
          _cen = _fit.center; _ax = _fit.axis; _ok = true;
          // 8.66.7 (Tara/OS): ORDINE corretto — PRIMA l'asse pulito, POI la Kasa che lo usa. Diagnosi
          // gate-validata (foglio Diagnostica): il residuo Tara e' il CENTRO (cap-baricentro ~= centroide
          // su tutti e 6, ~18.7µm su #4), NON l'asse. Offline TUTTE le candidate di centro (cap-disco,
          // Kasa) sono equivarianti/UNIFORMI -> la non-uniformita' live veniva dall'ORDINE: la Kasa
          // fitta il centro nel piano ⊥ asse usando l'asse cap-fit CONTAMINATO (tilt verticalita'-
          // dipendente) -> piano inclinato -> centro Kasa off ~18µm sul marker piu' DRITTO (#4). geomAxis
          // (8.66.3) sistemava l'asse DOPO la Kasa -> la Kasa aveva gia' girato col piano sbagliato (ecco
          // perche' non muoveva nulla). Fix: asse pulito PRIMA -> Kasa nel piano giusto -> centro pulito.
          // [1] asse pulito SEED-INDIPENDENTE per OS (rough=normale-disco dominante, NON il click; poi
          //     min-eigenvector parete -> 0.08° UNIFORME offline). Roll-free; guardia 5° -> fail-soft.
          if(sostSourceTemplate === 'OS'){
            try {
              var _gw = _sostGeomWallAxis(sostMesh.geometry, _fit.center, sourceRadius, _ax);
              if(_gw){ _ax = _gw; _sostInvLastReason += ' +geomAxis'; }
              else { _sostInvLastReason += ' (geomAxis skip)'; }
            } catch(_eg){ console.warn('[sostGeomAxis] errore, resta asse cap-fit:', _eg); }
          }
          // [2] Kasa: rifinisce il centro LATERALE (piano ⊥ asse) col fit cilindro della parete, usando
          //     l'asse ORA pulito (per OS); sposta solo nel piano ⊥ asse -> livello disco e asse
          //     invariati. Gate copertura ≥140° con fail-soft al cap-baricentro (no regressione).
          try {
            var _kc = sostRobustCenter(sostMesh.geometry, _fit.center, _ax, sourceRadius);
            if(_kc.applied){
              _cen = _kc.center;
              _sostInvLastReason += ' +kasaXY(cov='+_kc.coverageDeg.toFixed(0)+'°)';
            } else {
              _sostInvLastReason += ' (kasaXY skip cov='+(_kc.coverageDeg||0).toFixed(0)+'°)';
            }
          } catch(_ek){ console.warn('[sostKasaXY] errore, resta cap-baricentro:', _ek); }
          // 8.69.9: candidato METHOD C anche per OS/1T3 (SHADOW). Init = posa cap-fit (_cen,_ax = baricentro cap
          // + asse parete). La stima CONGIUNTA cap+parete+normali e' ideale per OS (parete corta 1.1mm, asse poco
          // osservabile). Calcolato SEMPRE, applicato solo col flag 'syntesis_sost_method_c'='on' (default OFF).
          // Gate+rollback. PENDING tuning OS via CSV live: il cap OS piccolo puo' influenzare l'asse; il trust
          // asse 0.5° (tarato SR) potrebbe essere stretto per OS -> l'axDeg e' comunque loggato per la taratura.
          if(_ok){
            try {
              _mcDiag = _sostMethodCPose(sostMesh.geometry, _cen.clone(), _ax.clone().normalize(), sourceRadius);
              if(_mcDiag.applied && _sostMCOn()){
                _cen = new THREE.Vector3(_mcDiag.center[0],_mcDiag.center[1],_mcDiag.center[2]);
                _ax = new THREE.Vector3(_mcDiag.axis[0],_mcDiag.axis[1],_mcDiag.axis[2]).normalize();
                _sostInvLastReason += ' +methodC(c'+(_mcDiag.cenShift*1000).toFixed(1)+'a'+_mcDiag.axDeg.toFixed(2)+')';
              } else if(_mcDiag.applied){
                _sostInvLastReason += ' [mcShadow c'+(_mcDiag.cenShift*1000).toFixed(1)+'a'+_mcDiag.axDeg.toFixed(2)+']';
              } else {
                _sostInvLastReason += ' (methodC '+_mcDiag.reason+')';
              }
            } catch(_emc){ console.warn('[sostMethodC OS] errore, resta posa precedente:', _emc); }
          }
        }
      } else {
        // 8.68.2 (Tara/SR): come l'OS in 8.66.7 — asse parete PULITO prima della Kasa. Parete SR 360°
        // piena -> _sostGeomWallAxis ben condizionato. Prima la Kasa usava l'asse cap-fit grezzo (tilt
        // ~0.05-0.08°) -> piano ⊥ inclinato -> centro off (Kasa ~450µm/°) = residuo Tara variabile 2-25µm.
        // Asse pulito -> Kasa nel piano giusto -> centro ~0. Click-invarianza gia' OK (parete 360°);
        // guardia 5° fail-soft all'asse cap-fit.
        var _axSR = axis;
        try {
          _gw = _sostGeomWallAxis(sostMesh.geometry, autoResult.center, sourceRadius, axis);
          if(_gw){ _axSR = _gw; _sostInvLastReason += ' +geomAxisSR'; }
          else { _sostInvLastReason += ' (geomAxisSR skip)'; }
        } catch(_egs){ console.warn('[sostGeomAxisSR] errore, resta asse cap-fit:', _egs); }
        var _rS = sostRobustCenter(sostMesh.geometry, autoResult.center, _axSR, sourceRadius);  // SR: centro Kasa con asse pulito
        if(_rS.applied){ _cen = _rS.center; _ax = _axSR.clone().normalize(); _ok = true; _cov = _rS.coverageDeg; }
        // 8.69.6/8.69.7: candidato CAP-PLANE. 8.69.5 (_cen,_ax) resta baseline/guardia. Raffina l'ASSE col piano
        // del cap (feature piu' pulita); gate severi. 8.69.7 SHADOW: calcolato SEMPRE e loggato nel CSV; APPLICATO
        // alla posa solo col flag 'syntesis_sost_cap_plane'='on'. reason: +capPlane=applicato, [capShadow]=calcolato
        // ma flag off, (capPlane <motivo>)=respinto dal gate. Per-marker, no cross-marker.
        if(_ok){
          try {
            _capDiag = _sostCapAnchoredPose(sostMesh.geometry, _cen.clone(), _ax.clone().normalize(), sourceRadius);
            if(_capDiag.applied && _sostCapPlaneOn()){
              _cen = _capDiag.center; _ax = _capDiag.axis.clone().normalize();
              _sostInvLastReason += ' +capPlane(d'+_capDiag.dAng.toFixed(2)+')';
            } else if(_capDiag.applied){
              _sostInvLastReason += ' [capShadow d'+_capDiag.dAng.toFixed(2)+']';
            } else {
              _sostInvLastReason += ' (capPlane '+_capDiag.reason+')';
            }
          } catch(_ecp){ console.warn('[sostCapPlane] errore, resta 8.69.5:', _ecp); }
        }
        // 8.69.8: candidato METHOD C (semantic local fit 5-DOF). Init = posa cap-plane (geometria, indip. dal flag
        // cap-plane). Calcolato SEMPRE per SR e loggato (shadow); APPLICATO solo col flag 'syntesis_sost_method_c'='on'
        // (DEFAULT OFF). Supera cap-plane (stima CONGIUNTA centro+asse). Gate intrinseci + rollback. Per-marker.
        if(_ok){
          try {
            var _mcC0 = (_capDiag && _capDiag.center) ? _capDiag.center : _cen;
            var _mcA0 = (_capDiag && _capDiag.axis) ? _capDiag.axis : _ax;
            _mcDiag = _sostMethodCPose(sostMesh.geometry, _mcC0.clone(), _mcA0.clone().normalize(), sourceRadius);
            if(_mcDiag.applied && _sostMCOn()){
              _cen = new THREE.Vector3(_mcDiag.center[0],_mcDiag.center[1],_mcDiag.center[2]);
              _ax = new THREE.Vector3(_mcDiag.axis[0],_mcDiag.axis[1],_mcDiag.axis[2]).normalize();
              _sostInvLastReason += ' +methodC(c'+(_mcDiag.cenShift*1000).toFixed(1)+'a'+_mcDiag.axDeg.toFixed(2)+')';
            } else if(_mcDiag.applied){
              _sostInvLastReason += ' [mcShadow c'+(_mcDiag.cenShift*1000).toFixed(1)+'a'+_mcDiag.axDeg.toFixed(2)+']';
            } else {
              _sostInvLastReason += ' (methodC '+_mcDiag.reason+')';
            }
          } catch(_emc){ console.warn('[sostMethodC] errore, resta posa precedente:', _emc); }
        }
      }
      if(_ok){ discWorld = _cen; axis = _ax.clone().normalize(); }
      console.log('[sostRobustCenter] type='+sostSourceTemplate+' applied='+_ok+' reason='+(_sostInvLastReason||'(SR/altro)')+' (gate setting='+_scSet+' radius='+sourceRadius+')');
      // 8.66.9: cattura l'INTERA catena di centraggio per il log CSV (seed -> cap-fit -> geomAxis -> Kasa -> finale)
      try {
        var _arr = function(o){ return o ? [(o.x!==undefined?o.x:o[0]), (o.y!==undefined?o.y:o[1]), (o.z!==undefined?o.z:o[2])] : null; };
        _placeDiagCap = {
          type: sostSourceTemplate, radius: sourceRadius, engine: _scSet, applied: _ok, reason: _sostInvLastReason,
          seedCen: _arr(autoResult.center), seedAx: _arr(autoResult.axis),
          fitCen: (typeof _fit!=='undefined' && _fit) ? _arr(_fit.center) : null,
          fitAx:  (typeof _fit!=='undefined' && _fit) ? _arr(_fit.axis)   : null,
          geomAx: (typeof _gw!=='undefined'  && _gw)  ? _arr(_gw)         : null,
          kasaCen:(typeof _kc!=='undefined'  && _kc && _kc.applied) ? _arr(_kc.center) : null,
          kasaCov:(typeof _kc!=='undefined'  && _kc)  ? _kc.coverageDeg   : null,
          finalCen: _arr(_cen), finalAx: _arr(_ax),
          // 8.69.7: catena CAP-PLANE (shadow) — sempre presente per SR quando _capDiag e' calcolato
          capApplied:(_capDiag?_capDiag.applied:null), capReason:(_capDiag?_capDiag.reason:null),
          capDAng:(_capDiag?_capDiag.dAng:null), capPlaneRMS:(_capDiag?_capDiag.planeRMS:null),
          capCov:(_capDiag?_capDiag.coverageDeg:null), capAreaFrac:(_capDiag?_capDiag.areaFrac:null),
          capLamRatio:(_capDiag?_capDiag.lamRatio:null), capN:(_capDiag?_capDiag.n:null),
          capNWall:(_capDiag?_capDiag.nWall:null), capCenShift:(_capDiag?_capDiag.centerShift:null),
          capAx:(_capDiag&&_capDiag.axis)?_arr(_capDiag.axis):null, capCen:(_capDiag&&_capDiag.center)?_arr(_capDiag.center):null,
          // 8.69.8: catena METHOD C (shadow)
          mcApplied:(_mcDiag?_mcDiag.applied:null), mcReason:(_mcDiag?_mcDiag.reason:null),
          mcCenShift:(_mcDiag?_mcDiag.cenShift:null), mcAxDeg:(_mcDiag?_mcDiag.axDeg:null), mcRfit:(_mcDiag?_mcDiag.Rfit:null),
          mcNcap:(_mcDiag?_mcDiag.ncap:null), mcNwall:(_mcDiag?_mcDiag.nwall:null),
          mcAx:(_mcDiag&&_mcDiag.axis)?_arr(_mcDiag.axis):null, mcCen:(_mcDiag&&_mcDiag.center)?_arr(_mcDiag.center):null
        };
      } catch(_edc){ console.warn('[sostPlaceDiag]', _edc); }
    } catch(e){ console.warn('[sostRobustCenter] errore, fallback legacy:', e); }
  } else {
    console.log('[sostRobustCenter] branch saltato: setting='+_scSet+' sourceRadius='+sourceRadius);
  }

  // Template da costruire per ogni marker: tutti e tre insieme cosi' l'utente
  // puo' scegliere dall'albero cosa visualizzare/esportare.
  var TPL_KEYS = ['1T3', 'SR', 'OS'];
  var activeKey = sostActiveTemplate;

  // Carica i buffer di tutti e tre
  var promises = TPL_KEYS.map(function(k){ return sostDecodeTemplate(k); });

  Promise.all(promises).then(function(bufs){
    // Parsa una volta sola
    var geos = {};
    for(var i = 0; i < TPL_KEYS.length; i++){
      if(!bufs[i]){
        try{ synLog('sost','posa FALLITA: template non caricato', {key:TPL_KEYS[i]}); }catch(_){}
        sostShowStatus('Impossibile caricare il template ' + TPL_KEYS[i], true);
        return;
      }
      geos[TPL_KEYS[i]] = sostParseSTLToGeometry(bufs[i]);
      if(!geos[TPL_KEYS[i]]){
        try{ synLog('sost','posa FALLITA: parse template', {key:TPL_KEYS[i]}); }catch(_){}
        sostShowStatus('Errore parsing template ' + TPL_KEYS[i], true);
        return;
      }
      // v7.3.6.004: hotfix flip SR.
      // Il CAD SR e` modellato con convenzione Z invertita (disco a Zmin,
      // piattaforma a Zmax) rispetto a 1T3/OS. Normalizziamo con rotazione
      // 180 gradi attorno a X cosi` tutti i template condividono la stessa
      // convenzione (disco = Zmax, piattaforma = Zmin).
      if(TPL_KEYS[i] === 'SR'){
        geos[TPL_KEYS[i]].applyMatrix4(
          new THREE.Matrix4().makeRotationX(Math.PI)
        );
        geos[TPL_KEYS[i]].computeBoundingBox();
      }
    }

    // CONNESSIONE IMPLANTARE = origine clinica condivisa da tutti i template.
    // Dal disco scannerizzato (sostSourceTemplate), risali lungo l'asse di
    // Z_disco_source fino alla connessione. Convenzione locale:
    //   - 1T3/OS: disco a Zmax (+8.5, +6.0) -> connessione = disco - zDisc*axis
    //   - SR:     disco a Zmin (-5.0)        -> connessione = disco - (-5)*axis = disco + 5*axis
    // In entrambi i casi: connessione = disco - zDisc_signed * axis, dove zDisc_signed
    // e' la coordinata Z locale del piano del disco (positiva per 1T3/OS, negativa per SR).
    var sourceGeo = geos[sostSourceTemplate];
    sourceGeo.computeBoundingBox();
    var srcBB = sourceGeo.boundingBox;
    var zDiscSource = srcBB.max.z;  // v7.3.6.004: SR ora normalizzato via flip, disco sempre a Zmax
    var connectionWorld = discWorld.clone().sub(axis.clone().multiplyScalar(zDiscSource));

    sostCounter++;
    var id = 'SOST_' + sostCounter;

    // v7.3.9.107 - TRIADE CANONICA via ROOT (specifica Francesco 2026-04-28).
    //
    // Cambio di approccio fondamentale: i 3 marker (1T3, OS, SR) costituiscono
    // una TRIADE CANONICA legata da un sistema ROOT condiviso. Le pose dei tre
    // marker nel ROOT sono FISSE e documentate (T_root_*).
    //
    // L'ICP locale del marker source serve SOLO a trovare T_world_anchor (la
    // posa del source nel mondo). Da li' si ricostruisce il ROOT:
    //   T_world_root = T_world_anchor * inverse(T_root_anchor)
    // E si richiama l'intera triade dal ROOT:
    //   T_world_k = T_world_root * T_root_k   per k in {1T3, OS, SR}
    //
    // I marker possono compenetrare la scansione e tra loro: questo non e'
    // errore. L'errore sarebbe rompere lo schema canonico applicando offset
    // empirici lungo axis derivati dalla compenetrazione visiva.
    //
    // SISTEMA DI RIFERIMENTO ROOT:
    //   origine     = piatto del 1T3
    //   asse Z_ROOT = verso il piatto del 1T3 (= +axis del mondo dopo ICP)
    //   piano XY    = piano del piatto del 1T3
    //
    // POSE CANONICHE (T_root_k = trasformazione 4x4 dal frame locale del CAD k
    // al frame ROOT):
    //
    // 1T3 (cap-up, piatto a Z_ROOT=0):
    //   il CAD ha frame locale con origine alla connessione clinica (Z=0) e
    //   piatto a Z_local=8.5 (bbox max). Per portare il piatto in Z_ROOT=0
    //   basta traslare di -8.5 lungo Z. Niente rotazione (cap-up gia' allineato).
    //   T_root_1T3 = traslazione(0, 0, -8.5)
    //
    // OS (cap-up co-orientato, piatto a Z_ROOT=-4):
    //   CAD: piatto a Z_local=6.0 (bbox max). Per portare il piatto a
    //   Z_ROOT=-4 traslo di -10. Niente rotazione.
    //   T_root_OS = traslazione(0, 0, -10)
    //
    // SR (cap-down riflesso, piatto a Z_ROOT=-15):
    //   CAD post-flip-v7.3.6.004: piatto a Z_local=5.0 (bbox max), cap-up
    //   come gli altri. Per renderlo cap-down nel ROOT: rotation 180 X
    //   (ribalta Z), poi traslazione che porta il piatto (post-rotation a
    //   Z_local'=-5) in Z_ROOT=-15, cioe' traslazione di -10.
    //   T_root_SR = traslazione(0,0,-10) * rotation_X(180)
    //
    // Distanze piatto-piatto risultanti nel ROOT:
    //   1T3 (Z=0)  <-> OS  (Z=-4)  = 4 mm  (sopra il piano di compressione)
    //   1T3 (Z=0)  <-> SR  (Z=-15) = 15 mm (sotto il piano, riflesso)
    //   OS  (Z=-4) <-> SR  (Z=-15) = 11 mm

    function _makeTRoot(translateZ, mirror){
      // Costruisce T_root_k = (translation lungo Z) [* rotation_X(180) se mirror].
      // Le matrici si compongono come M = translation * rotation, applicate ai
      // vertici come v' = M * v (Three.js usa colonne, premultiplicazione standard).
      var M = new THREE.Matrix4();
      M.makeTranslation(0, 0, translateZ);
      if(mirror){
        var R = new THREE.Matrix4().makeRotationX(Math.PI);
        M.multiply(R);
      }
      return M;
    }

    var TPL_MIRROR_CANONICAL = {  // intrinseca al template nel ROOT
      '1T3': false,
      'OS':  false,
      'SR':  true     // l'unico riflesso (cap-down nel ROOT)
    };
    var T_ROOT = {};
    var BBOX_LOCAL = {};
    TPL_KEYS.forEach(function(k){
      geos[k].computeBoundingBox();
      var bboxMaxZ = geos[k].boundingBox.max.z;
      BBOX_LOCAL[k] = bboxMaxZ;
      // T_root_k traslazione lungo Z = -bboxMaxZ - PLATE_OFFSET_IN_ROOT[k]
      // dove PLATE_OFFSET_IN_ROOT = {1T3:0, OS:-4, SR:-15}.
      // Per cap-up: piatto a Z_local=bboxMaxZ -> Z_ROOT=-translateZ-bboxMaxZ. NO,
      // semplifico: voglio piatto a Z_ROOT=plateOffset.
      //   senza mirror: piatto e' a Z_local=bboxMaxZ. Dopo translation_Z(t):
      //     piatto a Z_ROOT = bboxMaxZ + t, devo eguagliare a plateOffset
      //     -> t = plateOffset - bboxMaxZ
      //   con mirror (rotation_X 180): piatto a Z_local=bboxMaxZ post-rotation
      //     diventa Z_local'=-bboxMaxZ. Translation porta a Z_ROOT=-bboxMaxZ+t.
      //     Eguaglio a plateOffset -> t = plateOffset + bboxMaxZ
      var PLATE_OFFSET_IN_ROOT = {'1T3': 0, 'OS': -4, 'SR': -15};
      var plateOffset = PLATE_OFFSET_IN_ROOT[k];
      var mirror = TPL_MIRROR_CANONICAL[k];
      var translateZ = mirror ? (plateOffset + bboxMaxZ) : (plateOffset - bboxMaxZ);
      T_ROOT[k] = _makeTRoot(translateZ, mirror);
    });

    // Costruisco T_world_anchor: frame del source marker nel mondo.
    // Origine = discWorld (piatto del source). Z = +axis. X, Y ortogonali (auto).
    var T_world_anchor = new THREE.Matrix4();
    {
      // Quaternion che porta +Z mondo iniziale verso +axis
      var up = new THREE.Vector3(0, 0, 1);
      var q = new THREE.Quaternion().setFromUnitVectors(up, axis.clone().normalize());
      T_world_anchor.compose(discWorld, q, new THREE.Vector3(1,1,1));
    }

    // T_world_root = T_world_anchor * inverse(T_root_anchor)
    // T_root_anchor mappa CAD locale dell'anchor nel ROOT. La sua INVERSA
    // mappa ROOT nel locale dell'anchor. Componendo a sinistra con
    // T_world_anchor (locale -> mondo) ottengo ROOT -> mondo.
    // ATTENZIONE: il source e' visualizzato col suo PIATTO su discWorld.
    // T_world_anchor ha origine = discWorld = piatto del source. Quindi
    // T_world_anchor mappa l'origine LOCALE dell'anchor in discWorld.
    // Ma il piatto del CAD anchor non e' all'origine locale (e' a Z=bboxMaxZ).
    // Quindi T_world_anchor cosi' costruita e' il frame con origine al PIATTO
    // del source. T_root_anchor e' costruita per portare il CAD locale (origine
    // a connessione clinica) nel ROOT. Per essere coerenti, devo costruire
    // T_world_anchor come il frame con origine alla CONNESSIONE CLINICA del
    // source nel mondo (discWorld - bbox_anchor*axis), oppure ridefinire
    // T_root in modo che le origini siano omologhe.
    // Scelta: T_world_anchor con origine = discWorld - bbox_anchor*axis
    // (cioe' la connessione clinica del CAD source proiettata nel mondo).
    var bboxAnchor = BBOX_LOCAL[sostSourceTemplate];
    var connWorld_anchor = discWorld.clone().sub(axis.clone().multiplyScalar(bboxAnchor));
    var T_world_anchor_corrected = new THREE.Matrix4();
    {
      var up = new THREE.Vector3(0, 0, 1);
      var q = new THREE.Quaternion().setFromUnitVectors(up, axis.clone().normalize());
      T_world_anchor_corrected.compose(connWorld_anchor, q, new THREE.Vector3(1,1,1));
    }

    // T_world_root = T_world_anchor_corrected * inverse(T_root_anchor)
    var T_root_anchor_inv = new THREE.Matrix4().copy(T_ROOT[sostSourceTemplate]).invert();
    var T_world_root = new THREE.Matrix4()
      .multiplyMatrices(T_world_anchor_corrected, T_root_anchor_inv);

    // Per ogni marker k: T_world_k = T_world_root * T_root_k
    // Decompongo in posizione + quaternion + scale per applicarla alla mesh.
    var groups = {};
    TPL_KEYS.forEach(function(k){
      var T_world_k = new THREE.Matrix4().multiplyMatrices(T_world_root, T_ROOT[k]);

      // sostBuildTemplateGroup vuole (key, geo, position, axis, mirror).
      // Decompongo T_world_k.
      var pos = new THREE.Vector3();
      var quat = new THREE.Quaternion();
      var scl = new THREE.Vector3();
      T_world_k.decompose(pos, quat, scl);

      var info = SOSTITUIRE_TEMPLATE_INFO[k] || {label:'Custom', color: 0x888888};
      var color = info.color;
      var mat = new THREE.MeshPhongMaterial({
        color: color, specular: 0x222222, shininess: 40,
        side: THREE.DoubleSide, transparent: true, opacity: 1.0, depthWrite: true
      });
      var mesh = new THREE.Mesh(geos[k], mat);
      mesh.name = 'template';
      var group = new THREE.Group();
      group.add(mesh);
      group.position.copy(pos);
      group.quaternion.copy(quat);
      group.userData.isSostituire = true;
      group.userData.sostRole = 'template';
      group.userData.templateKey = k;
      group.userData.isMirrored = !!TPL_MIRROR_CANONICAL[k];
      var uiState = sostGroupUI[k];
      if(uiState && typeof uiState.opacity === 'number'){
        mat.opacity = uiState.opacity;
        mat.transparent = uiState.opacity < 1.0;
      }

      group.name = id + '_' + k;
      group.visible = (k === activeKey);
      scene.add(group);
      groups[k] = group;
    });

    // Verifica numerica delle distanze piatto-piatto risultanti
    if(typeof console !== 'undefined' && console.log){
      var p1T3 = new THREE.Vector3(0, 0, BBOX_LOCAL['1T3']).applyMatrix4(
        new THREE.Matrix4().multiplyMatrices(T_world_root, T_ROOT['1T3'])
      );
      var pOS  = new THREE.Vector3(0, 0, BBOX_LOCAL['OS']).applyMatrix4(
        new THREE.Matrix4().multiplyMatrices(T_world_root, T_ROOT['OS'])
      );
      var pSR  = new THREE.Vector3(0, 0, BBOX_LOCAL['SR']).applyMatrix4(
        new THREE.Matrix4().multiplyMatrices(T_world_root, T_ROOT['SR'])
      );
      console.log('[v107 triade canonica] source=' + sostSourceTemplate);
      console.log('  piatto 1T3 mondo:', p1T3.toArray().map(function(x){return x.toFixed(2);}));
      console.log('  piatto OS  mondo:', pOS.toArray().map(function(x){return x.toFixed(2);}));
      console.log('  piatto SR  mondo:', pSR.toArray().map(function(x){return x.toFixed(2);}));
      console.log('  d(1T3,OS) =', p1T3.distanceTo(pOS).toFixed(3), 'mm (atteso 4.0)');
      console.log('  d(1T3,SR) =', p1T3.distanceTo(pSR).toFixed(3), 'mm (atteso 15.0)');
      console.log('  d(OS, SR) =', pOS.distanceTo(pSR).toFixed(3), 'mm (atteso 11.0)');
    }

    // Linea asse (riferimento, non visibile di default)
    var axisDir = axis.clone().multiplyScalar(20);
    var axisGeo = new THREE.BufferGeometry().setFromPoints([connectionWorld, connectionWorld.clone().add(axisDir)]);
    var axisMat = new THREE.LineBasicMaterial({
      color: (SOSTITUIRE_TEMPLATE_INFO[activeKey] || {color:0x888888}).color,
      linewidth: 2
    });
    var axisLine = new THREE.Line(axisGeo, axisMat);
    axisLine.visible = false;
    axisLine.userData.isSostituire = true;
    scene.add(axisLine);

    // Label numerica: creata come div 2D proiettato (stesso pattern di
    // Analizza). Nessun oggetto 3D da gestire: sostEnsureLabelElements()
    // crea i div nel #labelLayer a partire da sostPlaced.

    sostPlaced.push({
      id: id,
      num: sostCounter,
      groups: groups,
      group: groups[activeKey],
      clickPoint: rawPoint.clone(),
      clickNormal: rawNormal.clone(),
      position: connectionWorld.clone(),   // connessione implantare (origine clinica)
      discWorld: discWorld.clone(),         // faccia del disco source scansionato
      axisDir: axis.clone(),
      templateKey: activeKey,
      color: (SOSTITUIRE_TEMPLATE_INFO[activeKey] || {color:0x888888}).color,
      rmsd: null,
      // 8.66.8: diagnostica posa (motivo robust: +geomAxis/skip, +kasaXY/skip, applied/reason)
      diagReason: (typeof _sostInvLastReason === 'string' ? _sostInvLastReason : ''),
      diag: _placeDiagCap,   // 8.66.9: catena centraggio completa per il log CSV
      axisLine: axisLine
    });

    // ── Diagnostica click grezzi (flag window.SYN_CLICKLOG === true) ──
    // point/normal nel frame NATIVO della mesh, pre-fit e pre-ICP.
    // Oggi sostMesh ha matrice identita' (nessun transform) -> mondo == locale,
    // si logga il raw direttamente. Se un domani sostMesh avesse un transform:
    //   - point arriva in coordinate MONDO -> applicare sostMesh.matrixWorld.clone().invert()
    //     (mondo -> locale);
    //   - normal (hits[].face.normal) e' SEMPRE in spazio LOCALE della mesh anche
    //     col transform -> NON trasformarla (sarebbe gia' locale: l'inverse-transpose
    //     la ritrasformerebbe due volte). A identita' entrambe le distinzioni sono inerti.
    // A flag spento: zero effetti. Lato = window.SYN_CLICKLOG_SIDE (default 'A').
    if(window.SYN_CLICKLOG === true){
      var __clkRec = {
        lato: (window.SYN_CLICKLOG_SIDE === 'B' ? 'B' : 'A'),
        idx: sostPlaced.length - 1,
        point: [rawPoint.x, rawPoint.y, rawPoint.z],
        normal: [rawNormal.x, rawNormal.y, rawNormal.z]
      };
      (window.SYN_CLICKS = window.SYN_CLICKS || []).push(__clkRec);
      console.log('[SYN_CLICKLOG]', JSON.stringify(__clkRec));
    }

    var activeInfo = SOSTITUIRE_TEMPLATE_INFO[activeKey] || {label: activeKey};
    sostRenderPlacedList();
    sostUpdateRefineButtonState();
    try{ synLog('sost','posa OK: marker piazzato', {num:sostCounter, idx:sostPlaced.length-1, tot:sostPlaced.length, reason:(typeof _sostInvLastReason==='string'?_sostInvLastReason:'')}); }catch(_){}
    sostShowStatus('Marker #' + sostCounter + ' posizionato (' + activeInfo.label + ').');
    try { rebuildTree(); } catch(e){}
    if(sostScanUI.cutOnMarkers) sostRebuildScanGeometry();
    var cutOverlay = document.getElementById('cutViewOverlay');
    if(cutOverlay){
      var isOpen = cutOverlay.style.display === 'flex';
      if(!isOpen){
        sostCutState.placedIdx = sostPlaced.length - 1;
        sostCutState.angle = 0;
        sostOpenCutView();
      } else {
        var sel = document.getElementById('cutMuaSelect');
        if(sel){
          var opt = document.createElement('option');
          opt.value = sostPlaced.length - 1;
          opt.textContent = '#' + sostCounter + ' ' + activeInfo.label;
          sel.appendChild(opt);
          sel.value = sostPlaced.length - 1;
          sostCutState.placedIdx = sostPlaced.length - 1;
          sostCutState.angle = 0;
        }
        sostRenderCutView();
      }
    }
  }).catch(function(err){
    try{ synLog('sost','posa FALLITA: eccezione (.catch)', {msg:(err&&err.message)||String(err), stack:(err&&err.stack?String(err.stack).split('\n').slice(0,3).join(' | '):null)}); }catch(_){}
    console.error('[Sostituire] errore:', err);
    sostShowStatus('Errore: ' + (err.message || err), true);
  });
}

function sostAlignAll(){
  if(!sostMesh || sostPlaced.length === 0){
    sostShowStatus('Nessun marker posizionato.', true);
    return;
  }
  if(sostAlignInProgress){ sostShowStatus('Raffina gia\' in corso…'); return; }
  sostAlignInProgress = true;
  sostShowStatus('Raffinamento ICP pesato (disco+cilindro)...');

  // v7.3.7.004: weighted ICP con outlier rejection (cap guida planarita`,
  // body guida centro XY). Peso 5x sui punti cap (normale locale |nz|>0.8)
  // per bilanciare l'area del cilindro laterale che altrimenti trascinerebbe
  // il fit in tilt. Francesco 2026-04-25: "la faccia piatta deve guidare la
  // planarita` dell'accoppiamento e il cilindro centrare gli assi".
  //
  // Per ciascun marker:
  //   1. Sample ~400 punti CAD del source template nel frame world corrente
  //   2. Crop cilindrico stretto (radius + 0.6mm, zMin-0.5, zMax+0.5) per
  //      ridurre l'influenza della gengiva attorno al marker
  //   3. ICP robusto: per ogni iterazione
  //        a. Nearest neighbor brute force (template -> scan)
  //        b. Calcolo mediana delle distanze di matching
  //        c. Scarta pairs con d > 2.5 * median (outlier rejection Tukey-like)
  //        d. Kabsch sulle pairs buone
  //        e. Controllo convergenza: break se |ΔRMSD| < 1e-4 mm
  //   4. Applica R, t alle matrici dei 3 gruppi (1T3/SR/OS)
  setTimeout(function(){
    var TPL_KEYS = ['1T3', 'SR', 'OS'];
    var promises = TPL_KEYS.map(function(k){ return sostDecodeTemplate(k); });
    Promise.all(promises).then(function(bufs){
      // 8.62.2: re-guard — durante il decode async (~30ms) la scena puo' cambiare (scansione
      // scaricata, workflow cambiato): senza questo il deref sostMesh.geometry piu' sotto crasha.
      if(!sostMesh || !sostMesh.geometry || !sostMesh.geometry.attributes || sostPlaced.length === 0){
        sostAlignInProgress = false;
        sostShowStatus('Raffina annullata: la scena e\' cambiata durante il calcolo.', true);
        return;
      }
      var geos = {};
      for(var i = 0; i < TPL_KEYS.length; i++){
        geos[TPL_KEYS[i]] = sostParseSTLToGeometry(bufs[i]);
        if(TPL_KEYS[i] === 'SR' && geos[TPL_KEYS[i]]){
          geos[TPL_KEYS[i]].applyMatrix4(
            new THREE.Matrix4().makeRotationX(Math.PI)
          );
          geos[TPL_KEYS[i]].computeBoundingBox();
        }
      }

      // 8.63.3 (richiesta utente "devo cliccare Raffina tante volte"): AUTO-LOOP fino a convergenza.
      // Un click -> la Raffina ri-croppa attorno alla posa corrente (coordinate descent) round dopo
      // round finche' nessun marker si muove oltre soglia (1µm) o si raggiunge il cap (12 round).
      // Come Replace-iT replaceRefineAll. setTimeout(0) tra i round -> UI reattiva + progresso live.
      var SOST_REFINE_MAX_ROUNDS = 12, SOST_REFINE_EPS_MM = 1e-3;
      function _sostFinishRefine(rounds){
        sostRenderPlacedList();
        sostShowStatus('Raffinamento completato (' + rounds + ' round, ' + sostPlaced.length + ' marker).');
        try { rebuildTree(); } catch(e){}
        if(sostScanUI.cutOnMarkers) sostRebuildScanGeometry();
        var _cv = document.getElementById('cutViewOverlay');
        if(_cv && _cv.style.display === 'flex') sostRenderCutView();
        sostAlignInProgress = false;
      }
      function _sostRefineRound(round){
       try {
        // re-guard PER ROUND (la scena puo' cambiare nel gap del setTimeout): scansione scaricata/
        // ricreata -> sostMesh nullo o scanPos stantio; marker eliminati -> sostPlaced piu' corto.
        if(!sostMesh || !sostMesh.geometry || !sostMesh.geometry.attributes || !sostPlaced.length){
          sostShowStatus('Raffina interrotta: la scena e\' cambiata.', true); sostAlignInProgress = false; return;
        }
        var scanPos = sostMesh.geometry.attributes.position.array, nScanTri = scanPos.length / 9, maxMove = 0;
        sostPlaced.forEach(function(p){
        if(!p || !p.position || !p.groups) return;
        var _posB = p.position.clone();
        var sourceKey = sostSourceTemplate;
        var cadGeo = geos[sourceKey];
        var sourceGroup = p.groups && p.groups[sourceKey];
        if(!cadGeo || !sourceGroup) return;

        // 1. Sample punti template nel frame world
        var cadPos = cadGeo.attributes.position.array;
        // v7.3.7.004: lettura normali locali per weighted ICP.
        // computeVertexNormals() e` chiamato in sostParseSTLToGeometry e il flip SR
        // (applyMatrix4) propaga la trasformazione alle normali.
        var cadNorm = cadGeo.attributes.normal ? cadGeo.attributes.normal.array : null;
        var nCadTri = cadPos.length / 9;
        var maxTplPts = 400;
        var stepCad = Math.max(1, Math.floor((nCadTri * 3) / maxTplPts));
        var m = sourceGroup.matrix.elements;
        var tplWorld = [];
        var tplWeights = [];  // v7.3.7.004: weighted ICP (cap dominante per planarita`)
        for(var ti = 0; ti < nCadTri; ti++){
          for(var vi = 0; vi < 3; vi++){
            if(((ti * 3) + vi) % stepCad !== 0) continue;
            var o = ti * 9 + vi * 3;
            var lx = cadPos[o], ly = cadPos[o+1], lz = cadPos[o+2];
            tplWorld.push([
              m[0]*lx + m[4]*ly + m[8]*lz  + m[12],
              m[1]*lx + m[5]*ly + m[9]*lz  + m[13],
              m[2]*lx + m[6]*ly + m[10]*lz + m[14]
            ]);
            // Peso in base alla feature locale:
            //   - cap (disco): normale locale circa +/-Z (asse cilindro) -> guida planarita`
            //   - body (cilindro): normale laterale                      -> guida centro XY
            // Dopo il flip SR (v7.3.6.004) tutti i template hanno convenzione coerente:
            // cap a Zmax, normali cap in direzione +Z locale.
            if(cadNorm){
              var nlz = cadNorm[o + 2];
              // Peso 5x sul cap: con ratio area_body/area_cap ~5:1 per OS, il peso 5x
              // porta il contributo del cap a pari livello del body (5x*1 cap = 5 body),
              // e oltre per 1T3/SR dove il cap ha area relativa maggiore.
              // Francesco 2026-04-25: "la faccia piatta guida la planarita`".
              tplWeights.push(Math.abs(nlz) > 0.8 ? 5.0 : 1.0);
            } else {
              tplWeights.push(1.0);
            }
          }
        }

        // 2. Crop cilindrico STRETTO (margine 0.6mm invece di 1.5mm)
        var cullInfo = SOSTITUIRE_CULL_CYL[sourceKey] || {radius: 3.0, zMin: -2, zMax: 8};
        var cx = p.position.x, cy = p.position.y, cz = p.position.z;
        var ax = p.axisDir.x, ay = p.axisDir.y, az = p.axisDir.z;
        var radLim = cullInfo.radius + 0.6;
        var radLim2 = radLim * radLim;
        var zLo = cullInfo.zMin - 0.5;
        var zHi = cullInfo.zMax + 0.5;
        var scanPts = [];
        // FIX asse (Opzione 2): accumulatore lateral-wall sui triangoli di PARETE
        // della scansione cadenti nel crop. M = somma area_i*(n_i outer n_i) sui
        // triangoli con normale circa perpendicolare all'asse (|n.asse| < 0.35).
        // Il minor eigenvector di M (via misICP_jacobi3) e' l'asse del cilindro.
        // Stesso estimatore validato che eguaglia Exocad. Normali ricavate dal
        // cross dei 3 vertici (niente attributo normal sulla scansione).
        var wallM = [[0,0,0],[0,0,0],[0,0,0]];
        var wallN = 0;
        var WALL_BAND = 0.35;
        for(var i = 0; i < nScanTri; i++){
          var oi = i * 9;
          var px = (scanPos[oi]   + scanPos[oi+3] + scanPos[oi+6]) / 3;
          var py = (scanPos[oi+1] + scanPos[oi+4] + scanPos[oi+7]) / 3;
          var pz = (scanPos[oi+2] + scanPos[oi+5] + scanPos[oi+8]) / 3;
          var dx = px - cx, dy = py - cy, dz = pz - cz;
          var zp = dx*ax + dy*ay + dz*az;
          if(zp < zLo || zp > zHi) continue;
          var rx = dx - zp*ax, ry = dy - zp*ay, rz = dz - zp*az;
          if(rx*rx + ry*ry + rz*rz > radLim2) continue;
          scanPts.push([px, py, pz]);
          // Normale (non normalizzata) = (v1-v0) x (v2-v0); |cross| = 2*area.
          var e1x = scanPos[oi+3]-scanPos[oi], e1y = scanPos[oi+4]-scanPos[oi+1], e1z = scanPos[oi+5]-scanPos[oi+2];
          var e2x = scanPos[oi+6]-scanPos[oi], e2y = scanPos[oi+7]-scanPos[oi+1], e2z = scanPos[oi+8]-scanPos[oi+2];
          var nxw = e1y*e2z - e1z*e2y;
          var nyw = e1z*e2x - e1x*e2z;
          var nzw = e1x*e2y - e1y*e2x;
          var nLen = Math.sqrt(nxw*nxw + nyw*nyw + nzw*nzw);
          if(nLen < 1e-9) continue;
          var area = 0.5 * nLen;
          var unx = nxw/nLen, uny = nyw/nLen, unz = nzw/nLen;
          if(Math.abs(unx*ax + uny*ay + unz*az) >= WALL_BAND) continue; // tieni solo parete
          wallM[0][0] += area*unx*unx; wallM[0][1] += area*unx*uny; wallM[0][2] += area*unx*unz;
          wallM[1][0] += area*uny*unx; wallM[1][1] += area*uny*uny; wallM[1][2] += area*uny*unz;
          wallM[2][0] += area*unz*unx; wallM[2][1] += area*unz*uny; wallM[2][2] += area*unz*unz;
          wallN++;
        }

        if(scanPts.length < 50 || tplWorld.length < 50) return;

        // Sub-sample scansione
        if(scanPts.length > 1500){
          var stride = Math.ceil(scanPts.length / 1500);
          var sub = [];
          for(var k = 0; k < scanPts.length; k += stride) sub.push(scanPts[k]);
          scanPts = sub;
        }

        // 3. ICP ROBUSTO con outlier rejection
        var moving = tplWorld.map(function(pt){ return pt.slice(); });
        var Racc = [[1,0,0],[0,1,0],[0,0,1]];
        var tAcc = [0,0,0];
        var prevRMSD = Infinity;
        var converged = false;
        var MAX_ITER = 35;
        var OUTLIER_RATIO = 2.5;

        for(var it = 0; it < MAX_ITER; it++){
          // Nearest neighbor brute force
          var pairD = [];
          var pairF = [];
          var pairM = [];
          for(var mi = 0; mi < moving.length; mi++){
            var bestD2 = Infinity, bestJ = -1;
            var mp = moving[mi];
            for(var fj = 0; fj < scanPts.length; fj++){
              var fp = scanPts[fj];
              var ddx = mp[0]-fp[0], ddy = mp[1]-fp[1], ddz = mp[2]-fp[2];
              var d2 = ddx*ddx + ddy*ddy + ddz*ddz;
              if(d2 < bestD2){ bestD2 = d2; bestJ = fj; }
            }
            pairD.push(Math.sqrt(bestD2));
            pairF.push(scanPts[bestJ]);
            pairM.push(mp);
          }

          // Median distance
          var sortedD = pairD.slice().sort(function(a,b){ return a-b; });
          var medD = sortedD[Math.floor(sortedD.length / 2)];
          var thresh = medD * OUTLIER_RATIO + 0.05;  // floor minimo 0.05mm

          // Filtra outlier, mantenendo i pesi template corrispondenti
          var goodM = [], goodF = [], goodW = [];
          for(var pi = 0; pi < pairD.length; pi++){
            if(pairD[pi] <= thresh){
              goodM.push(pairM[pi]);
              goodF.push(pairF[pi]);
              goodW.push(tplWeights[pi]);  // v7.3.7.004
            }
          }
          if(goodM.length < 15) break;  // troppo pochi inlier

          // Kabsch weighted: cap domina planarita`, body centra XY (v7.3.7.004)
          var kb = kabsch(goodM, goodF, goodW);

          // Applica R, t a TUTTI i moving (non solo inlier)
          for(var mi = 0; mi < moving.length; mi++){
            var pt = moving[mi];
            moving[mi] = [
              kb.R[0][0]*pt[0] + kb.R[0][1]*pt[1] + kb.R[0][2]*pt[2] + kb.t[0],
              kb.R[1][0]*pt[0] + kb.R[1][1]*pt[1] + kb.R[1][2]*pt[2] + kb.t[1],
              kb.R[2][0]*pt[0] + kb.R[2][1]*pt[1] + kb.R[2][2]*pt[2] + kb.t[2]
            ];
          }

          // Accumula Racc = kb.R * Racc; tAcc = kb.R * tAcc + kb.t
          Racc = matMul(kb.R, Racc);
          tAcc = [
            kb.R[0][0]*tAcc[0] + kb.R[0][1]*tAcc[1] + kb.R[0][2]*tAcc[2] + kb.t[0],
            kb.R[1][0]*tAcc[0] + kb.R[1][1]*tAcc[1] + kb.R[1][2]*tAcc[2] + kb.t[1],
            kb.R[2][0]*tAcc[0] + kb.R[2][1]*tAcc[1] + kb.R[2][2]*tAcc[2] + kb.t[2]
          ];

          // RMSD corrente (solo inlier per stabilita`)
          var sumD2 = 0;
          for(var gi = 0; gi < goodM.length; gi++){
            var mdx = goodM[gi][0] - goodF[gi][0];
            var mdy = goodM[gi][1] - goodF[gi][1];
            var mdz = goodM[gi][2] - goodF[gi][2];
            sumD2 += mdx*mdx + mdy*mdy + mdz*mdz;
          }
          var rmsd = Math.sqrt(sumD2 / Math.max(goodM.length, 1));

          // Convergenza
          if(Math.abs(prevRMSD - rmsd) < 1e-4){
            converged = true;
            prevRMSD = rmsd;
            break;
          }
          prevRMSD = rmsd;
        }

        var R = Racc, t = tAcc;

        // Guard di idempotenza (Strada A): se la trasformazione TOTALE accumulata
        // dall'ICP e' sotto soglia di rigidita', il marker e' gia' a convergenza.
        // Scarta la trasformazione (no-op) cosi' un Raffina ripetuto non muove il
        // marker. Soglie in unita' fisiche: rotazione < 0.01 deg, traslazione < 1 um.
        var IDEMP_ROT_DEG = 0.01;
        var IDEMP_TRANS_MM = 0.001; // 1 um
        var trace = R[0][0] + R[1][1] + R[2][2];
        var rotRad = Math.acos(Math.min(1, Math.max(-1, (trace - 1) / 2)));
        var rotDeg = rotRad * 180 / Math.PI;
        var transMag = Math.hypot(t[0], t[1], t[2]);
        if(rotDeg < IDEMP_ROT_DEG && transMag < IDEMP_TRANS_MM){
          // gia' convergente: non applicare nulla, lascia posa invariata
          return;
        }

        // 4. Matrice rigida
        var Rm = new THREE.Matrix4().set(
          R[0][0], R[0][1], R[0][2], t[0],
          R[1][0], R[1][1], R[1][2], t[1],
          R[2][0], R[2][1], R[2][2], t[2],
          0,       0,       0,       1
        );

        Object.keys(p.groups || {}).forEach(function(k){
          var g = p.groups[k];
          if(!g) return;
          var newMat = new THREE.Matrix4().multiplyMatrices(Rm, g.matrix);
          g.matrix.copy(newMat);
          g.matrixAutoUpdate = false;
        });

        var newPos = new THREE.Vector3(cx, cy, cz).applyMatrix4(Rm);
        p.position.copy(newPos);
        if(p.discWorld){ p.discWorld.applyMatrix4(Rm); }
        // Asse post-centraggio dal point-ICP (rotazione di Rm applicata al seed).
        // Resta il FALLBACK se la parete e' troppo povera (< 8 triangoli).
        var nAx = new THREE.Vector3(ax, ay, az);
        nAx.applyMatrix4(new THREE.Matrix4().extractRotation(Rm));
        nAx.normalize();

        // FIX asse (Opzione 2): se la parete della scansione e' sufficiente,
        // l'asse finale NON viene dalla rotazione del point-ICP (non-rigida, ~1 deg
        // di degrado) ma dal fit lateral-wall (minor eigenvector di wallM, robusto,
        // = Exocad). Poi ri-orientiamo il marker attorno a p.position con la delta
        // rotazione che porta nAx sull'asse parete, propagandola ai gruppi (export).
        // Motore asse: 'auto' (default) applica il fit lateral-wall solo a SR;
        // 'lateralwall' sempre (= 8.13.0); 'cap' mai. sourceKey e' il tipo template.
        var _useLateral = synAxisUseLateral(sourceKey === 'SR', 'auto');   // onThrow 'auto' = default-eccezione preservato (divergente, by design)
        if(wallN >= 8 && _useLateral){
          var ejW = misICP_jacobi3(wallM);
          var miW = 0;
          if(ejW.vals[1] < ejW.vals[miW]) miW = 1;
          if(ejW.vals[2] < ejW.vals[miW]) miW = 2;
          var wAx = new THREE.Vector3(ejW.vecs[0][miW], ejW.vecs[1][miW], ejW.vecs[2][miW]);
          if(wAx.lengthSq() > 1e-12){
            wAx.normalize();
            // Riorienta il segno concorde col seed (asse e' bidirezionale).
            if(wAx.dot(nAx) < 0) wAx.multiplyScalar(-1);
            // Delta rotazione che porta nAx -> wAx, applicata attorno a p.position.
            var qDelta = new THREE.Quaternion().setFromUnitVectors(nAx.clone().normalize(), wAx);
            var Rd = new THREE.Matrix4().makeRotationFromQuaternion(qDelta);
            var pPos = p.position;
            var Rorient = new THREE.Matrix4()
              .makeTranslation(pPos.x, pPos.y, pPos.z)
              .multiply(Rd)
              .multiply(new THREE.Matrix4().makeTranslation(-pPos.x, -pPos.y, -pPos.z));
            Object.keys(p.groups || {}).forEach(function(k){
              var g = p.groups[k];
              if(!g) return;
              var newMat = new THREE.Matrix4().multiplyMatrices(Rorient, g.matrix);
              g.matrix.copy(newMat);
              g.matrixAutoUpdate = false;
            });
            if(p.discWorld){ p.discWorld.applyMatrix4(Rorient); }
            nAx.copy(wAx);
          }
        }
        p.axisDir.copy(nAx);

        var endPt = p.position.clone().add(p.axisDir.clone().multiplyScalar(20));
        p.axisLine.geometry.setFromPoints([p.position, endPt]);
        p.axisLine.geometry.attributes.position.needsUpdate = true;

        p.rmsd = prevRMSD;
        var _mv = p.position.distanceTo(_posB);
        if(_mv > maxMove) maxMove = _mv;
        });
        sostRenderPlacedList();   // aggiornamento live ad ogni round
        if(maxMove < SOST_REFINE_EPS_MM || round >= SOST_REFINE_MAX_ROUNDS){ _sostFinishRefine(round); return; }
        sostShowStatus('Raffina ICP — round ' + (round + 1) + '… (spostamento ' + Math.round(maxMove * 1000) + 'µm)');
        setTimeout(function(){ _sostRefineRound(round + 1); }, 0);
       } catch(e){ console.error('[sostAlignAll round]', e); sostShowStatus('Errore Raffina: ' + (e && e.message ? e.message : e), true); sostAlignInProgress = false; }
      }
      _sostRefineRound(1);
    }).catch(function(_e){
      sostAlignInProgress = false;   // 8.62.2: rilascia il lock (errore) — niente eccezione async silenziosa
      try { console.warn('[sostAlignAll]', _e); } catch(e){}
      sostShowStatus('Raffina interrotta: ' + (_e && _e.message ? _e.message : 'errore durante il calcolo') + '.', true);
    });
  }, 30);
}

// ── Lista marker posizionati ──
function sostRenderPlacedList(){
  // Lista ridondante con l'albero a sinistra: sostituita da un semplice contatore
  var list = document.getElementById('sostPlacedList');
  var items = document.getElementById('sostPlacedItems');
  var btnExport = document.getElementById('sostBtnExport');
  var exportAs = document.getElementById('sostExportAs');
  if(!list || !items) return;
  if(sostPlaced.length === 0){
    list.style.display = 'none';
    if(btnExport) btnExport.style.display = 'none';
    if(exportAs) exportAs.style.display = 'none';
    return;
  }
  list.style.display = '';
  if(btnExport) btnExport.style.display = '';
  if(exportAs) exportAs.style.display = '';
  // 8.66.8: diagnostica posa per-marker a schermo (no console) — motivo robust + centro/asse reali.
  var _html = '<div style="font-family:var(--mono);font-size:12px;color:var(--dark);padding:4px 0">' +
              '<b>' + sostPlaced.length + '</b> marker posizionat' +
              (sostPlaced.length === 1 ? 'o' : 'i') + '.</div>';
  sostPlaced.forEach(function(p){
    var dw = p.discWorld, ax = p.axisDir;
    var c = (dw ? '('+dw.x.toFixed(3)+', '+dw.y.toFixed(3)+', '+dw.z.toFixed(3)+')' : '?');
    var a = (ax ? '('+ax.x.toFixed(3)+', '+ax.y.toFixed(3)+', '+ax.z.toFixed(3)+')' : '?');
    _html += '<div style="font-family:var(--mono);font-size:10px;color:var(--gray);padding:3px 0;border-top:1px solid #eee;line-height:1.4">'
           + '<b style="color:var(--dark)">#' + p.num + ' ' + (p.templateKey||'') + '</b> · ' + (p.diagReason || '(n/d)')
           + '<br>centro ' + c + ' · asse ' + a
           + '</div>';
  });
  // 8.66.9: pulsante download log CSV diagnostico (tutta la catena di centraggio per marker)
  _html += '<button class="expert-only" onclick="sostDownloadDiagLog()" style="margin-top:8px;width:100%;padding:7px 10px;border:1px solid var(--border);background:#fff;border-radius:5px;font-family:var(--mono);font-size:11px;font-weight:700;cursor:pointer;color:var(--dark)">⤓ Scarica log diagnostica (CSV)</button>';
  items.innerHTML = _html;
}

// 8.66.9: scarica un CSV con TUTTA la catena di centraggio per ogni marker piazzato
// (seed findScanbodyCenter -> cap-fit _sostCylFitInvariant -> geomAxis -> Kasa -> finale) +
// click + connessione + info di sistema. Cosi' la diagnosi non dipende dalla console: l'utente
// scarica il file e lo invia. Solo lettura di sostPlaced[].diag, zero effetto su posa/numeri.
function sostDownloadDiagLog(){
  if(!sostPlaced || !sostPlaced.length){ sostShowStatus('Nessun marker posizionato.', true); return; }
  var ver = window.ANALIZZA_BUILD || '?';
  var eng = '?', axeng = '?';
  try { if(typeof synSostCenterRead==='function') eng = synSostCenterRead(); } catch(e){}
  try { if(typeof synAxisEngineRead==='function') axeng = synAxisEngineRead('auto'); } catch(e){}
  function f(x){ return (x==null || isNaN(x)) ? '' : (+x).toFixed(4); }
  function v3(a){ return a ? (f(a[0])+','+f(a[1])+','+f(a[2])) : ',,'; }
  function vv(o){ return o ? (f(o.x)+','+f(o.y)+','+f(o.z)) : ',,'; }
  var lines = [];
  lines.push('# Syntesis-ICP - diagnostica posa Sostituire | versione=' + ver + ' | motore_centraggio=' + eng + ' | motore_asse=' + axeng + ' | n_marker=' + sostPlaced.length);
  lines.push('marker,tipo,raggio,engine,applied,reason,seedCenX,seedCenY,seedCenZ,seedAxX,seedAxY,seedAxZ,fitCenX,fitCenY,fitCenZ,fitAxX,fitAxY,fitAxZ,geomAxX,geomAxY,geomAxZ,kasaCenX,kasaCenY,kasaCenZ,kasaCov,finalCenX,finalCenY,finalCenZ,finalAxX,finalAxY,finalAxZ,clickX,clickY,clickZ,clickNX,clickNY,clickNZ,connX,connY,connZ,capApplied,capReason,capDAng,capPlaneRMSum,capCov,capAreaFrac,capLamRatio,capN,capNWall,capCenShiftUm,capAxX,capAxY,capAxZ,capCenX,capCenY,capCenZ,mcApplied,mcReason,mcCenShiftUm,mcAxDeg,mcRfit,mcNcap,mcNwall,mcAxX,mcAxY,mcAxZ,mcCenX,mcCenY,mcCenZ');
  sostPlaced.forEach(function(p){
    var d = p.diag || {};
    var row = [
      p.num, (p.templateKey||''), f(d.radius), (d.engine||''), (d.applied===true?'true':(d.applied===false?'false':'')),
      '"' + String(d.reason||'').replace(/"/g,'') + '"',
      v3(d.seedCen), v3(d.seedAx), v3(d.fitCen), v3(d.fitAx), v3(d.geomAx), v3(d.kasaCen),
      (d.kasaCov!=null && !isNaN(d.kasaCov) ? (+d.kasaCov).toFixed(1) : ''),
      v3(d.finalCen), v3(d.finalAx), vv(p.clickPoint), vv(p.clickNormal), vv(p.position),
      // 8.69.7: catena CAP-PLANE (shadow). capCenShift convertito in µm.
      (d.capApplied===true?'true':(d.capApplied===false?'false':'')),
      '"' + String(d.capReason||'').replace(/"/g,'') + '"',
      (d.capDAng!=null && !isNaN(d.capDAng) ? (+d.capDAng).toFixed(3) : ''),
      (d.capPlaneRMS!=null && !isNaN(d.capPlaneRMS) ? (+d.capPlaneRMS).toFixed(1) : ''),
      (d.capCov!=null && !isNaN(d.capCov) ? (+d.capCov).toFixed(0) : ''),
      (d.capAreaFrac!=null && !isNaN(d.capAreaFrac) ? (+d.capAreaFrac).toFixed(3) : ''),
      (d.capLamRatio!=null && !isNaN(d.capLamRatio) ? (+d.capLamRatio).toFixed(3) : ''),
      (d.capN!=null && !isNaN(d.capN) ? (''+d.capN) : ''),
      (d.capNWall!=null && !isNaN(d.capNWall) ? (''+d.capNWall) : ''),
      (d.capCenShift!=null && !isNaN(d.capCenShift) ? (+d.capCenShift*1000).toFixed(1) : ''),
      v3(d.capAx), v3(d.capCen),
      // 8.69.8: catena METHOD C (shadow). mcCenShift in µm.
      (d.mcApplied===true?'true':(d.mcApplied===false?'false':'')),
      '"' + String(d.mcReason||'').replace(/"/g,'') + '"',
      (d.mcCenShift!=null && !isNaN(d.mcCenShift) ? (+d.mcCenShift*1000).toFixed(1) : ''),
      (d.mcAxDeg!=null && !isNaN(d.mcAxDeg) ? (+d.mcAxDeg).toFixed(3) : ''),
      (d.mcRfit!=null && !isNaN(d.mcRfit) ? (+d.mcRfit).toFixed(4) : ''),
      (d.mcNcap!=null && !isNaN(d.mcNcap) ? (''+d.mcNcap) : ''),
      (d.mcNwall!=null && !isNaN(d.mcNwall) ? (''+d.mcNwall) : ''),
      v3(d.mcAx), v3(d.mcCen)
    ];
    lines.push(row.join(','));
  });
  try {
    var blob = new Blob(['﻿' + lines.join('\r\n')], {type:'text/csv;charset=utf-8'});
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href = url;
    a.download = 'SyntesisICP_PosaDiag_v' + ver + '_' + sostPlaced.length + 'marker.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function(){ URL.revokeObjectURL(url); }, 1500);
    sostShowStatus('Log diagnostica posa scaricato (' + sostPlaced.length + ' marker).');
  } catch(e){ sostShowStatus('Errore download log: ' + (e && e.message ? e.message : e), true); }
}

function sostExportSTL(){
  if(!sostMesh || sostPlaced.length === 0){
    sostShowStatus('Serve Multi-A caricata e almeno un marker posizionato.', true);
    return;
  }

  // Raccoglie l'insieme dei tipi di template attivi nell'albero:
  // un tipo e' "attivo" se almeno un p.groups[tipo] ha .visible===true
  var activeTypes = [];
  ['1T3', 'SR', 'OS'].forEach(function(k){
    var anyOn = sostPlaced.some(function(p){
      return p.groups && p.groups[k] && p.groups[k].visible;
    });
    if(anyOn) activeTypes.push(k);
  });

  if(activeTypes.length === 0 && !sostMesh.visible){
    sostShowStatus('Niente da esportare: accendi almeno un elemento nell\'albero.', true);
    return;
  }

  var includeScan = !!sostMesh.visible;

  // Nome file di default (come storicamente: base scan + componenti attivi)
  var defaultBase = 'sostituire_export';
  var slot = document.getElementById('sostSlotScan');
  if(slot){
    var fname = slot.querySelector('.fname');
    var base = fname ? fname.textContent.replace(/\.stl$/i, '') : 'sost';
    var parts = [];
    if(!includeScan) parts.push('scanbody');
    if(activeTypes.length > 0) parts.push(activeTypes.join('-'));
    defaultBase = base + (parts.length > 0 ? '_' + parts.join('_') : '_export');
  }

  _sostExportPending = { activeTypes: activeTypes, includeScan: includeScan, defaultBase: defaultBase };
  openSostExportNameDialog(defaultBase);
}

function _sostDoExport(chosenBase, activeTypes, includeScan){
  var btn = document.getElementById('sostBtnExport');
  if(btn){
    btn.disabled = true;
    btn.style.opacity = '0.6';
    btn.textContent = 'Generazione STL...';
  }

  // Pre-carica le geometrie di tutti i tipi attivi (cached)
  var loads = activeTypes.map(function(k){ return sostDecodeTemplate(k); });
  Promise.all(loads).then(function(bufs){
    var destGeos = {};
    for(var i = 0; i < activeTypes.length; i++){
      if(!bufs[i]){
        sostShowStatus('Impossibile caricare il template ' + activeTypes[i], true);
        if(btn){ btn.disabled = false; btn.style.opacity = '1'; btn.textContent = 'Esporta STL'; }
        return;
      }
      destGeos[activeTypes[i]] = sostParseSTLToGeometry(bufs[i]);
      // v7.3.6.004: flip SR anche in export per coerenza visuale
      if(activeTypes[i] === 'SR' && destGeos[activeTypes[i]]){
        destGeos[activeTypes[i]].applyMatrix4(
          new THREE.Matrix4().makeRotationX(Math.PI)
        );
        destGeos[activeTypes[i]].computeBoundingBox();
      }
    }
    setTimeout(function(){
      try {
        var startT = performance.now();
        var outTris = sostBuildExportTriangles(destGeos, activeTypes, includeScan);
        var nTris = outTris.length / 9;
        var stlBuffer = sostSerializeBinarySTL(outTris);
        var blob = new Blob([stlBuffer], {type: 'application/octet-stream'});
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = chosenBase + '.stl';
        document.body.appendChild(a);
        a.click();
        setTimeout(function(){
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }, 100);
        var dt = ((performance.now() - startT) / 1000).toFixed(1);
        var lbl = activeTypes.length > 0 ? activeTypes.join('+') : 'scansione';
        sostShowStatus('Export ' + lbl + ' completato: ' + nTris.toLocaleString() + ' triangoli in ' + dt + 's.');
      } catch(err) {
        console.error('[Sostituire export]', err);
        sostShowStatus('Errore export: ' + (err.message || err), true);
      } finally {
        if(btn){
          btn.disabled = false;
          btn.style.opacity = '1';
          btn.textContent = 'Esporta STL';
        }
      }
    }, 30);
  }).catch(function(err){
    // 8.81.0: cintura come i gemelli (decode template puo' teoricamente rigettare):
    // senza, il bottone restava per sempre disabled su 'Generazione STL...'.
    console.error('[Sostituire export] decode template fallito:', err);
    sostShowStatus('Errore export: template non decodificabile.', true);
    if(btn){ btn.disabled = false; btn.style.opacity = '1'; btn.textContent = 'Esporta STL'; }
  });
}

// Costruisce l'array Float32 di triangoli per l'export.
// destGeos: { '1T3': geo, 'SR': geo, 'OS': geo } (solo i tipi attivi)
// activeTypes: array con i tipi effettivamente visibili per almeno 1 marker
// includeScan: se true, la scansione Multi-A viene inclusa (filtrata dai cilindri)
function sostBuildExportTriangles(destGeos, activeTypes, includeScan){
  var scanPos = sostMesh.geometry.attributes.position.array;
  var nScanTris = scanPos.length / 9;

  // Cilindro di soppressione per ogni marker:
  // - srcCull = parametri del template di PARTENZA (gia' scansionato)
  // - dstCull = UNIONE (max/min) dei range Z di tutti i tipi attivi PRESENTI
  //   per quel marker (cioe' quelli effettivamente visibili nell'albero)
  var cullers = sostPlaced.map(function(p){
    var srcCull = SOSTITUIRE_CULL_CYL[p.templateKey];
    if(!srcCull){
      var anyG = p.groups && p.groups[p.templateKey];
      var tplMesh = anyG && anyG.getObjectByName('template');
      var bbox = null;
      if(tplMesh && tplMesh.geometry){
        tplMesh.geometry.computeBoundingBox();
        bbox = tplMesh.geometry.boundingBox;
      }
      srcCull = {
        radius: bbox ? Math.max(bbox.max.x - bbox.min.x, bbox.max.y - bbox.min.y) / 2 + 0.3 : 3.0,
        zMin: bbox ? bbox.min.z : -1,
        zMax: bbox ? bbox.max.z : 1
      };
    }
    // Unione dei cilindri dei tipi attivi VISIBILI su questo marker
    var zMin = srcCull.zMin, zMax = srcCull.zMax, maxR = srcCull.radius;
    activeTypes.forEach(function(k){
      var g = p.groups && p.groups[k];
      if(!g || !g.visible) return;
      var dc = SOSTITUIRE_CULL_CYL[k];
      if(!dc) return;
      if(dc.zMin < zMin) zMin = dc.zMin;
      if(dc.zMax > zMax) zMax = dc.zMax;
      if(dc.radius > maxR) maxR = dc.radius;
    });
    return {
      center: p.position,
      axis: p.axisDir.clone().normalize(),
      radius2: (maxR + 0.1) * (maxR + 0.1),
      zMin: zMin - 0.1,
      zMax: zMax + 0.1
    };
  });

  // Pass 1: filtro triangoli Multi-A (solo se includeScan)
  var keepBuffer = new Float32Array(includeScan ? scanPos.length : 0);
  var keepCount = 0;
  if(includeScan){
    for(var i = 0; i < nScanTris; i++){
      var o = i * 9;
      var cx = (scanPos[o] + scanPos[o+3] + scanPos[o+6]) / 3;
      var cy = (scanPos[o+1] + scanPos[o+4] + scanPos[o+7]) / 3;
      var cz = (scanPos[o+2] + scanPos[o+5] + scanPos[o+8]) / 3;
      var inCull = false;
      for(var c = 0; c < cullers.length; c++){
        var cu = cullers[c];
        var dx = cx - cu.center.x, dy = cy - cu.center.y, dz = cz - cu.center.z;
        var axial = dx * cu.axis.x + dy * cu.axis.y + dz * cu.axis.z;
        if(axial < cu.zMin || axial > cu.zMax) continue;
        var rx = dx - axial * cu.axis.x;
        var ry = dy - axial * cu.axis.y;
        var rz = dz - axial * cu.axis.z;
        if(rx*rx + ry*ry + rz*rz < cu.radius2){ inCull = true; break; }
      }
      if(!inCull){
        for(var j = 0; j < 9; j++) keepBuffer[keepCount * 9 + j] = scanPos[o + j];
        keepCount++;
      }
    }
  }

  // Pass 2: per ogni (marker, tipo) con .visible===true, applica R+t al template
  var tplArrays = [];
  var totalTplTris = 0;
  sostPlaced.forEach(function(p){
    activeTypes.forEach(function(k){
      var g = p.groups && p.groups[k];
      if(!g || !g.visible) return;
      var destGeo = destGeos[k];
      if(!destGeo) return;
      g.updateMatrixWorld(true);
      var m4 = g.matrixWorld;
      var destTplPos = destGeo.attributes.position.array;
      var nDestTplTris = destTplPos.length / 9;
      var out = new Float32Array(destTplPos.length);
      var v = new THREE.Vector3();
      for(var i = 0; i < nDestTplTris; i++){
        var o = i * 9;
        for(var kk = 0; kk < 3; kk++){
          v.set(destTplPos[o + kk*3], destTplPos[o + kk*3 + 1], destTplPos[o + kk*3 + 2]);
          v.applyMatrix4(m4);
          out[o + kk*3]     = v.x;
          out[o + kk*3 + 1] = v.y;
          out[o + kk*3 + 2] = v.z;
        }
      }
      tplArrays.push(out);
      totalTplTris += nDestTplTris;
    });
  });

  // Concatena
  var total = keepCount * 9 + totalTplTris * 9;
  var final = new Float32Array(total);
  if(includeScan) final.set(keepBuffer.subarray(0, keepCount * 9), 0);
  var offset = keepCount * 9;
  tplArrays.forEach(function(arr){
    final.set(arr, offset);
    offset += arr.length;
  });

  console.log('[Sostituire export] includeScan=' + includeScan,
              'types=' + activeTypes.join(','),
              'scan kept=' + keepCount,
              'tpl tris=' + totalTplTris);
  return final;
}

// Serializza un array di triangoli Float32 in STL binario
// Formato STL binario: header 80B + uint32 nTris + per triangolo (normal 3f + v0 3f + v1 3f + v2 3f + uint16 attr) = 50B
function sostSerializeBinarySTL(trisArr){
  var nTris = trisArr.length / 9;
  var size = 84 + nTris * 50;
  var buf = new ArrayBuffer(size);
  var view = new DataView(buf);
  // Header 80B (riempito con testo identificativo)
  var header = 'Syntesis-ICP Sostituire export v1.0';
  for(var i = 0; i < Math.min(header.length, 80); i++){
    view.setUint8(i, header.charCodeAt(i));
  }
  view.setUint32(80, nTris, true);
  var off = 84;
  for(var t = 0; t < nTris; t++){
    var o = t * 9;
    var ax = trisArr[o],   ay = trisArr[o+1], az = trisArr[o+2];
    var bx = trisArr[o+3], by = trisArr[o+4], bz = trisArr[o+5];
    var cx = trisArr[o+6], cy = trisArr[o+7], cz = trisArr[o+8];
    // Calcola normale del triangolo (cross product)
    var ux = bx - ax, uy = by - ay, uz = bz - az;
    var vx = cx - ax, vy = cy - ay, vz = cz - az;
    var nx = uy * vz - uz * vy;
    var ny = uz * vx - ux * vz;
    var nz = ux * vy - uy * vx;
    var nLen = Math.sqrt(nx*nx + ny*ny + nz*nz);
    if(nLen > 1e-10){ nx /= nLen; ny /= nLen; nz /= nLen; }
    view.setFloat32(off,    nx, true);
    view.setFloat32(off+4,  ny, true);
    view.setFloat32(off+8,  nz, true);
    view.setFloat32(off+12, ax, true);
    view.setFloat32(off+16, ay, true);
    view.setFloat32(off+20, az, true);
    view.setFloat32(off+24, bx, true);
    view.setFloat32(off+28, by, true);
    view.setFloat32(off+32, bz, true);
    view.setFloat32(off+36, cx, true);
    view.setFloat32(off+40, cy, true);
    view.setFloat32(off+44, cz, true);
    view.setUint16(off+48, 0, true);  // attr byte count (unused)
    off += 50;
  }
  return buf;
}

function sostRemovePlaced(num){
  var idx = sostPlaced.findIndex(function(p){ return p.num === num; });
  if(idx < 0) return;
  var p = sostPlaced[idx];
  // Rimuovi i 3 group variant (1T3/SR/OS)
  if(p.groups){
    Object.keys(p.groups).forEach(function(k){
      var g = p.groups[k];
      if(!g) return;
      scene.remove(g);
      g.traverse(function(obj){
        if(obj.geometry) obj.geometry.dispose();
        if(obj.material) obj.material.dispose();
      });
    });
  } else if(p.group){
    // fallback legacy (non dovrebbe piu' accadere)
    scene.remove(p.group);
    p.group.traverse(function(obj){
      if(obj.geometry) obj.geometry.dispose();
      if(obj.material) obj.material.dispose();
    });
  }
  if(p.axisLine) scene.remove(p.axisLine);
  // Label HTML viene rimossa automaticamente da sostEnsureLabelElements
  // al prossimo frame (rileva che il marker non e' piu' in sostPlaced).
  sostPlaced.splice(idx, 1);
  sostRenderPlacedList();
  sostUpdateRefineButtonState();
  sostShowStatus('Rimosso marker #' + num + '.');
  try { rebuildTree(); } catch(e){}
  if(sostScanUI.cutOnMarkers) sostRebuildScanGeometry();
  var cutOverlay = document.getElementById('cutViewOverlay');
  if(cutOverlay && cutOverlay.style.display === 'flex'){
    if(sostPlaced.length === 0){
      cutOverlay.style.display = 'none';
    } else {
      var sel = document.getElementById('cutMuaSelect');
      if(sel){
        sel.innerHTML = '';
        sostPlaced.forEach(function(p, i){
          var opt = document.createElement('option');
          opt.value = i;
          var info = SOSTITUIRE_TEMPLATE_INFO[p.templateKey] || {label: p.templateKey};
          opt.textContent = '#' + p.num + ' ' + info.label;
          sel.appendChild(opt);
        });
        sostCutState.placedIdx = 0;
        sel.value = 0;
      }
      sostRenderCutView();
    }
  }
}

function sostUpdateRefineButtonState(){
  var btn = document.getElementById('sostBtnRefine');
  if(!btn) return;
  var enabled = sostPlaced.length > 0;
  btn.disabled = !enabled;
  btn.style.opacity = enabled ? '1' : '0.5';
  btn.style.cursor = enabled ? 'pointer' : 'not-allowed';
}

// 8.62.2: dispose COMPLETO di un marker Sostituire (tutti i variant 1T3/SR/OS + axisLine).
// _hardResetSostituire e sostClearScene disponevano solo il group attivo -> leak GPU dei 2 variant
// inattivi e dell'axisLine a ogni cambio-workflow/reload. Stesso pattern (groups) di sostRemovePlaced.
function _sostDisposePlaced(p){
  if(!p || typeof scene === 'undefined') return;
  if(p.groups){
    Object.keys(p.groups).forEach(function(k){
      var g = p.groups[k]; if(!g) return;
      scene.remove(g);
      g.traverse(function(obj){ if(obj.geometry) obj.geometry.dispose(); if(obj.material) obj.material.dispose(); });
    });
  } else if(p.group){
    scene.remove(p.group);
    p.group.traverse(function(obj){ if(obj.geometry) obj.geometry.dispose(); if(obj.material) obj.material.dispose(); });
  }
  if(p.axisLine){
    scene.remove(p.axisLine);
    if(p.axisLine.geometry) p.axisLine.geometry.dispose();
    if(p.axisLine.material) p.axisLine.material.dispose();
  }
}

// ── Pulizia scena ──
function sostClearScene(){
  if(typeof scene === 'undefined') return;
  if(sostMesh){
    scene.remove(sostMesh);
    if(sostMesh.geometry) sostMesh.geometry.dispose();
    if(sostMesh.material) sostMesh.material.dispose();
    sostMesh = null;
  }
  sostPlaced.forEach(function(p){ _sostDisposePlaced(p); });   // 8.62.2: dispose completo (era solo p.group -> leak dei variant inattivi)
  sostPlaced = [];
  sostCounter = 0;
  // Rimuovi orfani residui (con dispose: prima era solo scene.remove -> leak GPU)
  var toRemove = [];
  scene.traverse(function(obj){
    if(obj.userData && obj.userData.isSostituire) toRemove.push(obj);
  });
  toRemove.forEach(function(o){
    scene.remove(o);
    if(o.geometry) o.geometry.dispose();
    if(o.material) o.material.dispose();
  });
  sostRenderPlacedList();
  sostUpdateRefineButtonState();
}

// ═══════════════════════════════════════════════════════════════════
// SOSTITUIRE: albero scena
// Renderizza dentro #layerTree (stesso container usato da Analizza)
// Chiamato da rebuildTree() quando analysisMode === 'sostituire'
// ═══════════════════════════════════════════════════════════════════
function sostRebuildTree(){
  var layerTree = document.getElementById('layerTree');
  if(!layerTree) return;
  var h = '';
  if(sostMesh){
    var scanHex = (sostMesh.material && sostMesh.material.color) ? ('#' + sostMesh.material.color.getHexString()) : '#c4a48c';
    h += '<div class="tree-group-header">FILE / SCANSIONI<span class="group-count">1</span></div>';
    h += '<div class="tree-node">' +
         '<span style="width:12px"></span>' +   // spacer per allineare alla freccia dei gruppi
         '<input type="checkbox" ' + (sostMesh.visible ? 'checked' : '') +
         ' onchange="sostToggleScanVisibility(this.checked)">' +
         '<input type="color" class="tree-color" value="' + scanHex + '" title="Colore scansione" onchange="setSceneObjectColor(\'sostscan\', this.value)" onclick="event.stopPropagation()">' +
         '<span class="lbl" style="flex:1">Scansione (Multi-A)</span>' +
         '<span class="tree-opacity-value" id="sostOpLblScan">' + Math.round(sostScanUI.opacity * 100) + '%</span>' +
         '</div>';
    h += '<div class="tree-opacity-row">' +
         '<input type="range" class="tree-opacity-slider" min="0" max="100" step="1" value="' + Math.round(sostScanUI.opacity * 100) + '"' +
         ' oninput="sostOnScanOpacityChange(this.value)"' +
         ' style="accent-color:' + scanHex + '" title="Trasparenza scansione">' +
         '</div>';
    // Taglia scansione sui marker (nasconde la porzione di scansione attorno ai marker)
    if(sostPlaced.length > 0){
      h += '<div class="tree-node" style="padding-left:18px">' +
           '<input type="checkbox" ' + (sostScanUI.cutOnMarkers ? 'checked' : '') +
           ' onchange="sostToggleScanCut(this.checked)">' +
           '<span class="dot" style="background:#889aad;border:1px dashed var(--dark)"></span>' +
           '<span class="lbl">Taglia scansione sui marker</span>' +
           '</div>';
    }
  }
  if(sostPlaced.length > 0){
    h += '<div class="tree-group-header">MARKER<span class="group-count">' + sostPlaced.length + '</span></div>';
    // Riga toggle per etichette numeriche 3D
    h += '<div class="tree-node">' +
         '<span style="width:12px"></span>' +
         '<input type="checkbox" ' + (sostLabelsUI.visible ? 'checked' : '') +
         ' onchange="sostToggleLabelsVisibility(this.checked)">' +
         '<span class="dot" style="background:var(--dark);border:2px solid #fff;box-sizing:border-box"></span>' +
         '<span class="lbl" style="flex:1">Etichette numeriche</span>' +
         '</div>';
    // A.5.2: derivato da SOSTITUIRE_TEMPLATE_INFO (single source of truth,
    // allineato a window.SYN). Conversione color int -> CSS hex string per
    // gli inline style della UI dell'albero.
    var TPL_ORDER = ['1T3', 'SR', 'OS'].map(function(k){
      var info = SOSTITUIRE_TEMPLATE_INFO[k] || {};
      var col = info.color || 0x888888;
      return {
        key: k,
        label: info.label || ('Marker ' + k),
        color: '#' + ('000000' + col.toString(16)).slice(-6).toUpperCase()
      };
    });
    TPL_ORDER.forEach(function(tpl){
      var ui = sostGroupUI[tpl.key] || { collapsed: false, opacity: 1.0 };
      var anyVisible = false, allVisible = true;
      var count = 0;
      sostPlaced.forEach(function(p){
        var g = p.groups && p.groups[tpl.key];
        if(!g) return;
        count++;
        if(g.visible) anyVisible = true;
        else allVisible = false;
      });
      if(count === 0) return;
      var masterChecked = anyVisible && allVisible;
      var masterIndeterminate = anyVisible && !allVisible;
      // Riga master: freccia di collapse + checkbox + pallino + label + pulsante opacita'
      var arrow = ui.collapsed ? '&#9656;' : '&#9662;';
      h += '<div class="tree-node" style="margin-top:4px">' +
           '<span class="chevron" onclick="sostToggleGroupCollapse(\'' + tpl.key + '\')">' + arrow + '</span>' +
           '<input type="checkbox" ' + (masterChecked ? 'checked' : '') +
           ' onchange="sostToggleGroupVisibility(\'' + tpl.key + '\', this.checked)"' +
           (masterIndeterminate ? ' data-indet="1"' : '') + '>' +
           '<input type="color" class="tree-color" value="' + tpl.color + '" title="Colore ' + tpl.label + '" onchange="setSceneObjectColor(\'sosttype:' + tpl.key + '\', this.value)" onclick="event.stopPropagation()">' +
           '<span class="lbl" style="font-weight:700;flex:1">' + tpl.label + '</span>' +
           '<span class="tree-opacity-value" id="sostOpLbl_' + tpl.key + '">' + Math.round(ui.opacity * 100) + '%</span>' +
           '</div>';
      // Slider opacita' (sempre visibile, anche se il gruppo e' collassato)
      h += '<div class="tree-opacity-row">' +
           '<input type="range" class="tree-opacity-slider" min="0" max="100" step="1" value="' + Math.round(ui.opacity * 100) + '"' +
           ' oninput="sostOnGroupOpacityChange(\'' + tpl.key + '\', this.value)"' +
           ' style="accent-color:' + tpl.color + '" title="Trasparenza ' + tpl.label + '">' +
           '</div>';
      // Figli (visibili solo se non collassato)
      if(!ui.collapsed){
        sostPlaced.forEach(function(p){
          var g = p.groups && p.groups[tpl.key];
          if(!g) return;
          var visible = g.visible;
          h += '<div class="tree-node" style="padding-left:34px">' +
               '<input type="checkbox" ' + (visible ? 'checked' : '') +
               ' onchange="sostTogglePlacedTplVisibility(' + p.num + ', \'' + tpl.key + '\', this.checked)">' +
               '<span class="dot" style="background:' + tpl.color + ';opacity:.6"></span>' +
               '<span class="lbl">#' + p.num + '</span>' +
               '<button class="del-btn" onclick="sostRemovePlaced(' + p.num + ')" title="Elimina marker #' + p.num + '">✕</button>' +
               '</div>';
        });
      }
    });
  }
  if(!sostMesh && sostPlaced.length === 0){
    h = '<div class="tree-node"><span class="lbl" style="color:var(--gray);font-size:12px">Nessun oggetto. Carica Multi-A.</span></div>';
  }
  layerTree.innerHTML = h;
  layerTree.querySelectorAll('input[data-indet="1"]').forEach(function(cb){
    cb.indeterminate = true;
  });
  // 8.71.3: mesh nuove o ri-geometrizzate (load, placement, swap tipo, taglio) ereditano
  // subito la modalita' di render corrente (solid|wireframe|both) senza un re-toggle manuale.
  if(typeof sostApplyRenderMode === 'function') sostApplyRenderMode();
}

// Toggle collapsed state di un gruppo
function sostToggleGroupCollapse(tplKey){
  if(!sostGroupUI[tplKey]) sostGroupUI[tplKey] = { collapsed: false, opacity: 1.0 };
  sostGroupUI[tplKey].collapsed = !sostGroupUI[tplKey].collapsed;
  sostRebuildTree();
}

// Cambia opacita' di tutti i marker di un tipo. pctStr e' stringa 0..100.
function sostOnGroupOpacityChange(tplKey, pctStr){
  var pct = parseInt(pctStr, 10);
  if(isNaN(pct)) return;
  var op = Math.max(0, Math.min(1, pct / 100));
  if(!sostGroupUI[tplKey]) sostGroupUI[tplKey] = { collapsed: false, opacity: 1.0 };
  sostGroupUI[tplKey].opacity = op;
  // Applica a ogni template del tipo
  sostPlaced.forEach(function(p){
    var g = p.groups && p.groups[tplKey];
    if(!g) return;
    g.traverse(function(obj){
      if(obj.material){
        obj.material.opacity = op;
        obj.material.transparent = op < 1.0;
        obj.material.needsUpdate = true;
      }
    });
  });
  // Aggiorna solo la label % senza rifare tutto il tree (evita jitter dello slider)
  var lbl = document.getElementById('sostOpLbl_' + tplKey);
  if(lbl) lbl.textContent = pct + '%';
}

function sostToggleScanVisibility(on){
  if(sostMesh) sostMesh.visible = on;
}

// Mostra/nasconde tutte le etichette numeriche (ora HTML, non piu' sprite 3D)
function sostToggleLabelsVisibility(on){
  sostLabelsUI.visible = on;
  sostPlaced.forEach(function(p){
    if(p.labelEl) p.labelEl.style.display = on ? 'block' : 'none';
  });
}

function sostToggleScanCut(on){
  sostScanUI.cutOnMarkers = on;
  sostRebuildScanGeometry();
}

function sostRebuildScanGeometry(){
  if(!sostOriginalGeo || !sostMesh) return;
  if(!sostScanUI.cutOnMarkers || sostPlaced.length === 0){
    sostMesh.geometry.dispose();
    sostMesh.geometry = sostOriginalGeo.clone();
    sostMesh.geometry.computeVertexNormals();
    return;
  }
  var cylinders = sostPlaced.map(function(p){
    return {
      cp: p.position,
      ax: p.axisDir.clone().normalize(),
      R2: SOST_CUT_RADIUS * SOST_CUT_RADIUS,
      halfH: SOST_CUT_HALF_H
    };
  });
  var pos = sostOriginalGeo.attributes.position.array;
  var nTri = pos.length / 9;
  var kept = [];
  for(var i = 0; i < nTri; i++){
    var ni = i * 9;
    var cx = (pos[ni] + pos[ni+3] + pos[ni+6]) / 3;
    var cy = (pos[ni+1] + pos[ni+4] + pos[ni+7]) / 3;
    var cz = (pos[ni+2] + pos[ni+5] + pos[ni+8]) / 3;
    var inside = false;
    for(var c = 0; c < cylinders.length; c++){
      var cyl = cylinders[c];
      var dx = cx - cyl.cp.x, dy = cy - cyl.cp.y, dz = cz - cyl.cp.z;
      var axial = dx*cyl.ax.x + dy*cyl.ax.y + dz*cyl.ax.z;
      if(Math.abs(axial) > cyl.halfH) continue;
      var px = dx - axial*cyl.ax.x;
      var py = dy - axial*cyl.ax.y;
      var pz = dz - axial*cyl.ax.z;
      if(px*px + py*py + pz*pz <= cyl.R2){ inside = true; break; }
    }
    if(!inside){
      for(var j = 0; j < 9; j++) kept.push(pos[ni + j]);
    }
  }
  var newGeo = new THREE.BufferGeometry();
  newGeo.setAttribute('position', new THREE.Float32BufferAttribute(kept, 3));
  newGeo.computeVertexNormals();
  sostMesh.geometry.dispose();
  sostMesh.geometry = newGeo;
}

// Cambia opacita' della scansione Multi-A (0..100)
function sostOnScanOpacityChange(pctStr){
  var pct = parseInt(pctStr, 10);
  if(isNaN(pct)) return;
  var op = Math.max(0, Math.min(1, pct / 100));
  sostScanUI.opacity = op;
  if(sostMesh && sostMesh.material){
    sostMesh.material.opacity = op;
    sostMesh.material.transparent = op < 1.0;
    sostMesh.material.needsUpdate = true;
  }
  var lbl = document.getElementById('sostOpLblScan');
  if(lbl) lbl.textContent = pct + '%';
}

// Toggle di un singolo template di uno specifico marker
function sostTogglePlacedTplVisibility(num, tplKey, on){
  var p = sostPlaced.find(function(x){ return x.num === num; });
  if(!p) return;
  var g = p.groups && p.groups[tplKey];
  if(g) g.visible = on;
  // Aggiorna master del gruppo senza ricostruire tutto l'albero
  sostRebuildTree();
}

// Toggle di tutti i marker di un tipo (es. tutti 1T3, tutti SR, tutti OS)
function sostToggleGroupVisibility(tplKey, on){
  sostPlaced.forEach(function(p){
    var g = p.groups && p.groups[tplKey];
    if(g) g.visible = on;
  });
  sostRebuildTree();
}

function sostOpenCutView(){
  if(sostPlaced.length === 0){
    sostShowStatus('Posiziona almeno un marker prima di aprire la sezione.', true);
    return;
  }
  // Popola il selettore (riuso #cutMuaSelect dell'overlay esistente)
  var sel = document.getElementById('cutMuaSelect');
  if(!sel){ sostShowStatus('UI sezione non disponibile.', true); return; }
  sel.innerHTML = '';
  sostPlaced.forEach(function(p, i){
    var opt = document.createElement('option');
    opt.value = i;
    var info = SOSTITUIRE_TEMPLATE_INFO[p.templateKey] || {label: p.templateKey};
    opt.textContent = '#' + p.num + ' ' + info.label;
    sel.appendChild(opt);
  });
  sel.value = 0;
  sostCutState.placedIdx = 0;
  sostCutState.angle = 0;
  sel.onchange = function(){ sostCutState.placedIdx = parseInt(sel.value); sostRenderCutView(); };
  // Drag handlers sul canvas
  var canvas = document.getElementById('cutCanvas');
  if(canvas){
    canvas.onmousedown = function(e){ sostCutState.dragging = true; sostCutState.lastX = e.clientX; canvas.style.cursor = 'grabbing'; };
    canvas.onmousemove = function(e){
      if(!sostCutState.dragging) return;
      var dx = e.clientX - sostCutState.lastX;
      sostCutState.angle = (sostCutState.angle + dx * 0.5) % 360;
      if(sostCutState.angle < 0) sostCutState.angle += 360;
      sostCutState.lastX = e.clientX;
      sostRenderCutView();
    };
    canvas.onmouseup = canvas.onmouseleave = function(){ sostCutState.dragging = false; canvas.style.cursor = 'grab'; };
  }
  document.getElementById('cutViewOverlay').style.display = 'flex';
  sostRenderCutView();
}

function sostRenderCutView(){
  var p = sostPlaced[sostCutState.placedIdx];
  if(!p || !sostMesh) return;
  var angDisp = document.getElementById('cutAngleDisplay');
  if(angDisp) angDisp.textContent = Math.round(sostCutState.angle) + '°';

  var canvas = document.getElementById('cutCanvas');
  if(!canvas) return;
  var ctx = canvas.getContext('2d');
  var W = canvas.width, H = canvas.height;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  // Piano di sezione: passa per p.position, contiene p.axisDir, normale ruota di angle°
  var axis = p.axisDir.clone().normalize();
  var ref = Math.abs(axis.z) < 0.9 ? new THREE.Vector3(0,0,1) : new THREE.Vector3(1,0,0);
  var baseU = new THREE.Vector3().crossVectors(axis, ref).normalize();
  var angRad = sostCutState.angle * Math.PI / 180;
  var q = new THREE.Quaternion().setFromAxisAngle(axis, angRad);
  var uAxis = baseU.clone().applyQuaternion(q);
  var wAxis = axis.clone();
  var normal = new THREE.Vector3().crossVectors(uAxis, wAxis).normalize();

  var planePoint = [p.position.x, p.position.y, p.position.z];
  var planeNormal = [normal.x, normal.y, normal.z];
  var uArr = [uAxis.x, uAxis.y, uAxis.z];
  var wArr = [wAxis.x, wAxis.y, wAxis.z];

  // Sezione scansione Multi-A (bianca)
  var scanSegs = extractCutSegments(sostMesh.geometry, null, planePoint, planeNormal);

  // Sezione template posizionato (colore del marker)
  // Il template e' dentro p.group; p.group ha matrix applicata; estraggo la mesh "template"
  var tplMesh = p.group.getObjectByName('template');
  var tplSegs = [];
  if(tplMesh && tplMesh.geometry){
    p.group.updateMatrixWorld(true);
    tplSegs = extractCutSegments(tplMesh.geometry, tplMesh.matrixWorld, planePoint, planeNormal);
  }

  // Calcola range 2D per centrare e scalare
  var allPts2D = [];
  function pushSegs(segs){
    segs.forEach(function(s){
      allPts2D.push(projectTo2D(s[0], planePoint, uArr, wArr));
      allPts2D.push(projectTo2D(s[1], planePoint, uArr, wArr));
    });
  }
  pushSegs(scanSegs);
  pushSegs(tplSegs);
  if(allPts2D.length === 0){
    ctx.fillStyle = '#555';
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Nessuna intersezione con il piano', W/2, H/2);
    return;
  }

  // Centra sul template (se presente) altrimenti su tutto
  var centerU = 0, centerW = 0;
  var refPts = tplSegs.length > 0 ? [] : allPts2D;
  if(tplSegs.length > 0){
    tplSegs.forEach(function(s){
      refPts.push(projectTo2D(s[0], planePoint, uArr, wArr));
      refPts.push(projectTo2D(s[1], planePoint, uArr, wArr));
    });
  }
  refPts.forEach(function(pt){ centerU += pt[0]; centerW += pt[1]; });
  centerU /= refPts.length; centerW /= refPts.length;

  // Zoom: riuso slider #cutZoom se esiste
  var zoomSlider = document.getElementById('cutZoom');
  var zoom = zoomSlider ? parseFloat(zoomSlider.value) : 15;
  var scale = Math.min(W, H) / (zoom * 2);

  function toCanvas(pt2d){
    return [
      W/2 + (pt2d[0] - centerU) * scale,
      H/2 - (pt2d[1] - centerW) * scale  // Y inverted
    ];
  }

  // Disegna scansione (bianco)
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.0;
  ctx.beginPath();
  scanSegs.forEach(function(s){
    var a = toCanvas(projectTo2D(s[0], planePoint, uArr, wArr));
    var b = toCanvas(projectTo2D(s[1], planePoint, uArr, wArr));
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
  });
  ctx.stroke();

  // Disegna template (colore del marker)
  var info = SOSTITUIRE_TEMPLATE_INFO[p.templateKey] || {color: 0xffaa44};
  var hex = '#' + info.color.toString(16).padStart(6, '0');
  ctx.strokeStyle = hex;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  tplSegs.forEach(function(s){
    var a = toCanvas(projectTo2D(s[0], planePoint, uArr, wArr));
    var b = toCanvas(projectTo2D(s[1], planePoint, uArr, wArr));
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
  });
  ctx.stroke();

  // Mirino centrale sul punto piazzamento (come Analizza)
  ctx.strokeStyle = '#444';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(W/2 - 8, H/2); ctx.lineTo(W/2 + 8, H/2);
  ctx.moveTo(W/2, H/2 - 8); ctx.lineTo(W/2, H/2 + 8);
  ctx.stroke();
}
