/*
 * wf/misurare-viz.js — MISURARE viz 3D/albero di Synthesis-ICP (Fase 6f modularizzazione). 3/3 di Misurare.
 *
 * CONTRATTO: 23 function declaration del dominio §MISURARE-VIZ — label 3D HTML tracker (create/update/
 * destroy/start/stop), vista di taglio 2D (cutview: perpVectors/sliceByPlane/projectTo2D/drawCutview/
 * bindCutviewWheel), albero scena CATIA-style (show/hide/toggle/group/layer vis/op, badge, reset). Nomi bare globali invariati.
 * Estrazione "functions-only": lo STATO resta nel monolite (misICP_labels/labelsVisible, labelTrackerOn,
 * layerColors, cutZoom/cutCurrentPair/cutWheelBound) + banner §MISURARE-VIZ (check_anchors).
 * DIPENDENZE call-time: scene/camera/renderer/controls (var MAIN), misICP_result, THREE, syntesisGetUiZoom.
 * CARICAMENTO: <script src> classico NON-strict in testa (dopo wf/misurare-pdf.js), PRIMA del MAIN.
 * GATE: scripts/gate/mis-viz/gate.mjs (23 md5-verbatim + esposizione + residuo + wiring).
 */

function misICP_createLabels(){
  misICP_destroyLabels();
  if(!misICP_result || !misICP_result.pairs) return;
  var vp = document.getElementById('viewport');
  if(!vp) return;
  var pairs = misICP_result.pairs;
  pairs.forEach(function(p, idx){
    if(p.iB<0) { misICP_labels.push(null); return; }
    var el = document.createElement('div');
    el.className = 'mis-scb-label';
    var d3um = Math.round(p.d3um);
    el.textContent = '#'+(idx+1)+' · '+d3um+' \u00b5m';
    el.style.background = (p.level && p.level.col) ? p.level.col : '#639922';
    el.style.display = 'none'; // visibile solo quando proiettato
    el.setAttribute('data-idx', String(idx));
    el.onclick = (function(i){ return function(ev){
      ev.stopPropagation();
      misICP_highlightCylinder(i);
      misICP_openCutview(i);
    }; })(idx);
    vp.appendChild(el);
    misICP_labels.push(el);
  });
  // Aggancio l'updater al render loop esistente
  misICP_startLabelTracker();
}
function misICP_destroyLabels(){
  misICP_labels.forEach(function(el){ if(el && el.parentNode) el.parentNode.removeChild(el); });
  misICP_labels = [];
}

function misICP_startLabelTracker(){
  if(misICP_labelTrackerOn) return;
  misICP_labelTrackerOn = true;
  function tick(){
    if(!misICP_labelTrackerOn) return;
    misICP_updateLabels();
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
function misICP_stopLabelTracker(){
  misICP_labelTrackerOn = false;
}
function misICP_updateLabels(){
  if(!misICP_result || !misICP_result.pairs || !misICP_labels.length) return;
  if(currentWorkflow !== 'misurare') return;
  if(!renderer || !camera) return;
  var vp = document.getElementById('viewport');
  if(!vp) return;
  var rect = vp.getBoundingClientRect();
  var W = rect.width, H = rect.height;

  // FIX v7.3.9.082: compensa body.style.zoom (vedi updateDivergenceLabels)
  var zoomF = (typeof syntesisGetUiZoom === 'function') ? syntesisGetUiZoom() : 1.0;

  var svg = document.getElementById('labelLines');
  if(svg){
    while(svg.firstChild) svg.removeChild(svg.firstChild);
    svg.style.display = misICP_labelsVisible ? '' : 'none';
  }
  if(!misICP_labelsVisible) return;  // label+leader spente: niente linee/pallini
  var pairs = misICP_result.pairs;
  var LABEL_OFFSET_PX = 56;
  for(var i=0;i<pairs.length;i++){
    var el = misICP_labels[i];
    if(!el) continue;
    var p = pairs[i];
    if(p.iB<0){ el.style.display='none'; continue; }

    // Anchor: centro mesh visibile (boundingSphere) o fallback cA
    var anchor = null;
    var meshA = (misICP_meshesA && misICP_meshesA[i]) ? misICP_meshesA[i] : null;
    if(meshA && meshA.geometry && meshA.geometry.boundingSphere){
      anchor = meshA.geometry.boundingSphere.center.clone();
      meshA.localToWorld(anchor);
    } else if(p.cA){
      anchor = new THREE.Vector3(p.cA[0], p.cA[1], p.cA[2]);
    }
    if(!anchor){ el.style.display='none'; continue; }

    var va = anchor.clone().project(camera);
    if(va.z > 1 || va.z < -1){ el.style.display='none'; continue; }
    // Coord visive
    var anchorXv = (va.x * 0.5 + 0.5) * W;
    var anchorYv = (-va.y * 0.5 + 0.5) * H;
    // Coord logiche (compensano body.zoom)
    var anchorX = anchorXv / zoomF;
    var anchorY = anchorYv / zoomF;

    el.style.display = '';
    var labelW = el.offsetWidth || 60;
    var labelH = el.offsetHeight || 22;
    var labelCenterX = anchorX;
    var labelCenterY = anchorY - LABEL_OFFSET_PX;
    el.style.left = (labelCenterX - labelW/2) + 'px';
    el.style.top  = (labelCenterY - labelH/2) + 'px';

    if(svg){
      var color = (p.level && p.level.col) ? p.level.col : '#639922';
      var lineFromY = labelCenterY + labelH/2;
      var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', labelCenterX);
      line.setAttribute('y1', lineFromY);
      line.setAttribute('x2', anchorX);
      line.setAttribute('y2', anchorY);
      line.setAttribute('stroke', color);
      line.setAttribute('stroke-width', '1.5');
      line.setAttribute('opacity', '0.8');
      svg.appendChild(line);
      var dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('cx', anchorX);
      dot.setAttribute('cy', anchorY);
      dot.setAttribute('r', 3);
      dot.setAttribute('fill', color);
      dot.setAttribute('opacity', '0.95');
      svg.appendChild(dot);
    }
    if(misICP_selectedIdx === i) el.classList.add('sel');
    else                         el.classList.remove('sel');
  }
}

function misICP_openCutview(idx){
  if(!misICP_result || !misICP_result.pairs) return;
  var pairs = misICP_result.pairs;
  if(idx<0 || idx>=pairs.length) return;
  var p = pairs[idx];
  if(p.iB<0) return;
  var panel = document.getElementById('misCutPanel');
  if(!panel) return;
  panel.style.display = 'block';
  // Sincronizzo il select sul valore corrente (se presente)
  var sel = document.getElementById('misCutSelect');
  if(sel) sel.value = String(idx);
  document.getElementById('misCutSub').textContent = '#'+(idx+1)+'  -  '+Math.round(p.d3um)+' um  -  sezione assiale';
  var dotB = document.getElementById('misCutDotB');
  if(dotB) dotB.style.background = '#0065B3'; // coerente col colore dischi B
  var cv = document.getElementById('misCutCanvas');
  // Reset zoom ogni volta che cambio scanbody (framing auto)
  misICP_cutZoom = 1.0;
  misICP_cutCurrentPair = p;
  misICP_bindCutviewWheel();
  misICP_drawCutview(cv, p);
}
// Popola il <select> del pannello cutview con tutti gli scanbody matchati.
// Chiamata dopo ICP (da misICP_run) e dopo misICP_renderScanbodyList.
function misICP_populateCutSelect(){
  var sel = document.getElementById('misCutSelect');
  if(!sel || !misICP_result || !misICP_result.pairs) return;
  sel.innerHTML = '';
  misICP_result.pairs.forEach(function(p, i){
    if(p.iB<0) return;
    var opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = '#'+(i+1)+'  -  '+Math.round(p.d3um)+' um';
    sel.appendChild(opt);
  });
}
// Toggle dal pulsante toolbar: apri se chiusa, chiudi se aperta.
function misICP_toggleCutview(){
  var panel = document.getElementById('misCutPanel');
  if(!panel) return;
  if(panel.style.display === 'block'){
    misICP_closeCutview();
    return;
  }
  if(!misICP_result || !misICP_result.pairs){
    showStatus('Esegui prima allineamento ICP per vedere la sezione.');
    return;
  }
  // Apro sullo scanbody selezionato, oppure sul primo matchato
  var idx = misICP_selectedIdx;
  if(idx < 0){
    for(var i=0; i<misICP_result.pairs.length; i++){
      if(misICP_result.pairs[i].iB >= 0){ idx = i; break; }
    }
  }
  if(idx >= 0) misICP_openCutview(idx);
}

function misICP_showTree(){
  var t = document.getElementById('misTree');
  if(t) t.style.display = 'block';
}
function misICP_hideTree(){
  var t = document.getElementById('misTree');
  if(t) t.style.display = 'none';
}

function misICP_toggleTreeGroup(groupId){
  // groupId = 'grpA' | 'grpB' | 'grpOv'
  var caret = document.getElementById('caret'+groupId.charAt(0).toUpperCase()+groupId.slice(1));
  var child = document.getElementById('child'+groupId.charAt(0).toUpperCase()+groupId.slice(1));
  if(!child) return;
  if(child.classList.contains('open')){
    child.classList.remove('open');
    if(caret) caret.classList.remove('open');
  } else {
    child.classList.add('open');
    if(caret) caret.classList.add('open');
  }
}

// Ritorna l'array di mesh del gruppo richiesto
function misICP_groupMeshes(group){
  if(group === 'bgA')  return misICP_bgMeshA ? [misICP_bgMeshA] : [];
  if(group === 'bgB')  return misICP_bgMeshB ? [misICP_bgMeshB] : [];
  if(group === 'scbA') return misICP_meshesA.filter(function(m){return m;});
  if(group === 'scbB') return misICP_meshesB.filter(function(m){return m;});
  if(group === 'conn') return (typeof misICP_connMeshes!=='undefined') ? misICP_connMeshes.filter(function(m){return m;}) : [];
  return [];
}

function misICP_applyLayerVis(group, visible){
  if(group === 'labels'){
    misICP_labelsVisible = !!visible;
    // Label HTML
    misICP_labels.forEach(function(el){
      if(el) el.style.visibility = visible ? '' : 'hidden';
    });
    // Leader-line SVG (linea + pallino): fanno parte del label -> spegni insieme
    var svgL = document.getElementById('labelLines');
    if(svgL){ if(!visible){ while(svgL.firstChild) svgL.removeChild(svgL.firstChild); } svgL.style.display = visible ? '' : 'none'; }
    return;
  }
  var meshes = misICP_groupMeshes(group);
  meshes.forEach(function(m){ m.visible = !!visible; });
}

function misICP_applyLayerOp(group, opacity){
  var meshes = misICP_groupMeshes(group);
  meshes.forEach(function(m){
    if(!m || !m.material) return;   // 8.100.1: guardia — lo slider (oninput) puo' colpire oggetti senza .material (Group/Line/mesh svuotato) -> "Cannot set properties of undefined (setting 'opacity')" (39 hit nel log)
    m.material.opacity = opacity;
    m.material.transparent = (opacity < 1);
  });
  // Aggiorno anche il label %
  var map = { bgA:'layValBgA', bgB:'layValBgB', scbA:'layValScbA', scbB:'layValScbB', conn:'layValConn' };
  var lbl = document.getElementById(map[group]);
  if(lbl) lbl.textContent = Math.round(opacity*100) + '%';
  // Aggiorno i default globali, cosi' highlight/deselect non sovrascrivono le scelte dell'utente
  if(group === 'bgA')  MIS_OP_BG_A  = opacity;
  if(group === 'bgB')  MIS_OP_BG_B  = opacity;
  if(group === 'scbA') MIS_OP_SCB_A = opacity;
  if(group === 'scbB') MIS_OP_SCB_B = opacity;
}

// 8.64.2: colore della geometria matematica della connessione (i marker A/B restano
// arancio/blu; il picker agisce solo sulla geometria "connessione" = matematica).
function misICP_setConnColor(hex){
  misICP_connColor = hex;
  var col = parseInt(hex.replace('#',''),16);
  if(typeof misICP_connMeshes !== 'undefined'){
    misICP_connMeshes.forEach(function(o){
      if(o && o.traverse) o.traverse(function(c){ if(c.userData && c.userData.misConnMat && c.material) c.material.color.setHex(col); });
      else if(o && o.userData && o.userData.misConnMat && o.material) o.material.color.setHex(col);
    });
  }
}

// Aggiorna le badge numeriche degli header di gruppo (es. "5 dischi")
function misICP_updateTreeBadges(){
  var badgeA = document.getElementById('badgeGrpA');
  var badgeB = document.getElementById('badgeGrpB');
  if(!misICP_result || !misICP_result.pairs){
    if(badgeA) badgeA.textContent = '';
    if(badgeB) badgeB.textContent = '';
    return;
  }
  var nA = misICP_meshesA.filter(function(m){return m;}).length;
  var nB = misICP_meshesB.filter(function(m){return m;}).length;
  if(badgeA) badgeA.textContent = nA + ' dischi';
  if(badgeB) badgeB.textContent = nB + ' dischi';
}

// Resetta UI del tree ai default e riapplica ai materiali
function misICP_resetTreeDefaults(){
  var defaults = [
    ['layChkBgA', true],   ['laySldBgA', 100], ['layValBgA', '100%'],
    ['layChkScbA', true],  ['laySldScbA', 100],['layValScbA', '100%'],
    ['layChkBgB', true],   ['laySldBgB', 45],  ['layValBgB', '45%'],
    ['layChkScbB', true],  ['laySldScbB', 55], ['layValScbB', '55%'],
    ['layChkLabels', true]
  ];
  defaults.forEach(function(d){
    var el = document.getElementById(d[0]); if(!el) return;
    if(el.type === 'checkbox') el.checked = d[1];
    else if(el.type === 'range') el.value = d[1];
    else el.textContent = d[1];
  });
  MIS_OP_BG_A = 1.00; MIS_OP_BG_B = 0.45; MIS_OP_SCB_A = 1.00; MIS_OP_SCB_B = 0.55;
  // Riapplica ai materiali
  misICP_applyLayerVis('bgA', true);   misICP_applyLayerOp('bgA', MIS_OP_BG_A);
  misICP_applyLayerVis('scbA', true);  misICP_applyLayerOp('scbA', MIS_OP_SCB_A);
  misICP_applyLayerVis('bgB', true);   misICP_applyLayerOp('bgB', MIS_OP_BG_B);
  misICP_applyLayerVis('scbB', true);  misICP_applyLayerOp('scbB', MIS_OP_SCB_B);
  misICP_applyLayerVis('labels', true);
}
function misICP_closeCutview(){
  var panel = document.getElementById('misCutPanel');
  if(panel) panel.style.display = 'none';
  misICP_cutCurrentPair = null;
}

// Calcola 3 vettori ortonormali {u, n, w} dato l'asse del cilindro:
//   w = asse del cilindro (verticale nel canvas)
//   u = "orizzontale mondo" proiettato sul piano perpendicolare a w (orizzontale nel canvas)
//   n = w x u  (normale del piano di sezione, punta fuori dallo schermo)
function misICP_perpVectors(axis){
  if(!axis) return null;
  var la=Math.hypot(axis[0],axis[1],axis[2]);
  if(la<1e-9) return null;
  var w=[axis[0]/la, axis[1]/la, axis[2]/la];
  // Scelgo il vettore di riferimento "orizzontale": X mondo se l'asse non e' quasi X,
  // altrimenti Y mondo (evita degenerazione del cross)
  var ref=(Math.abs(w[0])<0.9) ? [1,0,0] : [0,1,0];
  var dot=ref[0]*w[0]+ref[1]*w[1]+ref[2]*w[2];
  var u=[ref[0]-dot*w[0], ref[1]-dot*w[1], ref[2]-dot*w[2]];
  var lu=Math.hypot(u[0],u[1],u[2]);
  if(lu<1e-9) return null;
  u=[u[0]/lu, u[1]/lu, u[2]/lu];
  var n=[ w[1]*u[2]-w[2]*u[1], w[2]*u[0]-w[0]*u[2], w[0]*u[1]-w[1]*u[0] ];
  return {u:u, n:n, w:w};
}

// Sezione di una mesh con piano (origin, normal). Ritorna segmenti 3D {p1,p2}.
function misICP_sliceByPlane(tris, origin, normal){
  if(!tris) return [];
  var segs=[];
  for(var i=0;i<tris.length;i++){
    var t=tris[i];
    var d0=(t[0][0]-origin[0])*normal[0]+(t[0][1]-origin[1])*normal[1]+(t[0][2]-origin[2])*normal[2];
    var d1=(t[1][0]-origin[0])*normal[0]+(t[1][1]-origin[1])*normal[1]+(t[1][2]-origin[2])*normal[2];
    var d2=(t[2][0]-origin[0])*normal[0]+(t[2][1]-origin[1])*normal[1]+(t[2][2]-origin[2])*normal[2];
    var ds=[d0,d1,d2];
    var above=[], below=[];
    for(var j=0;j<3;j++){ if(ds[j]>=0) above.push(j); else below.push(j); }
    if(above.length===0||below.length===0) continue;
    var lonely=(above.length===1)?above[0]:below[0];
    var pair=(above.length===1)?below:above;
    var iPts=[];
    for(var k=0;k<2;k++){
      var a=t[lonely], b=t[pair[k]], da=ds[lonely], db=ds[pair[k]];
      var dd=db-da;
      if(Math.abs(dd)<1e-9){ iPts.push([a[0],a[1],a[2]]); continue; }
      var tt=-da/dd;
      iPts.push([ a[0]+(b[0]-a[0])*tt, a[1]+(b[1]-a[1])*tt, a[2]+(b[2]-a[2])*tt ]);
    }
    segs.push({p1:iPts[0], p2:iPts[1]});
  }
  return segs;
}

// Proietta un punto 3D sul piano 2D (u,w) centrato in origin
function misICP_projectTo2D(pt3, origin, uAxis, wAxis){
  var dx=pt3[0]-origin[0], dy=pt3[1]-origin[1], dz=pt3[2]-origin[2];
  return [
    dx*uAxis[0]+dy*uAxis[1]+dz*uAxis[2],
    dx*wAxis[0]+dy*wAxis[1]+dz*wAxis[2]
  ];
}

function misICP_drawCutview(cv, p){
  if(!cv) return;
  var ctx=cv.getContext('2d'), W=cv.width, H=cv.height;
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle='#000'; ctx.fillRect(0,0,W,H);

  if(!p || !p.axA){
    ctx.fillStyle='#7b90a8'; ctx.font='11px monospace'; ctx.textAlign='center';
    ctx.fillText('Asse cilindro non disponibile', W/2, H/2);
    return;
  }

  var axes=misICP_perpVectors(p.axA);
  if(!axes){
    ctx.fillStyle='#7b90a8'; ctx.font='11px monospace'; ctx.textAlign='center';
    ctx.fillText('Impossibile calcolare il piano di sezione', W/2, H/2);
    return;
  }
  var origin=p.cA;
  // Sezione A su piano (origin, axes.n) contenente l'asse del cilindro A
  var segs3A=misICP_sliceByPlane(p.trisA,  origin, axes.n);
  // Sezione B su piano (origin, axes.n) - anche B sulla stessa "normale" di A
  // Il confronto longitudinale rende visibile lo scostamento.
  var segs3B=misICP_sliceByPlane(p.trisBt, origin, axes.n);

  // Proietto i segmenti in 2D: u orizzontale, w verticale (= asse, cosi' cilindro dritto)
  function proj(s){
    return {
      p1: misICP_projectTo2D(s.p1, origin, axes.u, axes.w),
      p2: misICP_projectTo2D(s.p2, origin, axes.u, axes.w)
    };
  }
  var segsA=segs3A.map(proj);
  var segsB=segs3B.map(proj);

  var all=segsA.concat(segsB);
  if(!all.length){
    ctx.fillStyle='#7b90a8'; ctx.font='11px monospace'; ctx.textAlign='center';
    ctx.fillText('Nessuna intersezione trovata', W/2, H/2);
    return;
  }

  // Framing: calcolo bbox in 2D
  var mnx=Infinity, mxx=-Infinity, mny=Infinity, mxy=-Infinity;
  all.forEach(function(s){
    [s.p1,s.p2].forEach(function(pt){
      if(pt[0]<mnx)mnx=pt[0]; if(pt[0]>mxx)mxx=pt[0];
      if(pt[1]<mny)mny=pt[1]; if(pt[1]>mxy)mxy=pt[1];
    });
  });
  var dx=mxx-mnx, dy=mxy-mny;
  var rg=Math.max(dx,dy,1), margin=rg*0.18;
  var autoScl=Math.min((W-20)/(rg+margin*2), (H-20)/(rg+margin*2));
  var scl=autoScl * misICP_cutZoom;
  var cxm=(mnx+mxx)/2, cym=(mny+mxy)/2;
  function toPx(pt){
    return [W/2 + (pt[0]-cxm)*scl, H/2 - (pt[1]-cym)*scl];
  }

  // Griglia 1 mm
  if(scl >= 14){
    ctx.strokeStyle='rgba(255,255,255,0.07)'; ctx.lineWidth=0.5;
    var gMin=Math.floor(cxm-(W/2-10)/scl)-1;
    var gMax=Math.ceil (cxm+(W/2-10)/scl)+1;
    for(var gx=gMin; gx<=gMax; gx++){
      var px=toPx([gx,0])[0];
      if(px<0||px>W) continue;
      ctx.beginPath(); ctx.moveTo(px,0); ctx.lineTo(px,H); ctx.stroke();
    }
    var gMinY=Math.floor(cym-(H/2-10)/scl)-1;
    var gMaxY=Math.ceil (cym+(H/2-10)/scl)+1;
    for(var gy=gMinY; gy<=gMaxY; gy++){
      var py=toPx([0,gy])[1];
      if(py<0||py>H) continue;
      ctx.beginPath(); ctx.moveTo(0,py); ctx.lineTo(W,py); ctx.stroke();
    }
  }

  // Cross centrale tratteggiata (riferimento)
  ctx.strokeStyle='rgba(255,255,255,0.18)'; ctx.lineWidth=0.8;
  ctx.setLineDash([3,4]);
  ctx.beginPath(); ctx.moveTo(W/2,4); ctx.lineTo(W/2,H-4); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(4,H/2); ctx.lineTo(W-4,H/2); ctx.stroke();
  ctx.setLineDash([]);

  // Segmenti A (arancio)
  ctx.strokeStyle='#F59E0B'; ctx.lineWidth=1.5; ctx.lineCap='round';
  segsA.forEach(function(s){
    var a=toPx(s.p1), b=toPx(s.p2);
    ctx.beginPath(); ctx.moveTo(a[0],a[1]); ctx.lineTo(b[0],b[1]); ctx.stroke();
  });
  // Segmenti B (blu)
  ctx.strokeStyle='#0065B3'; ctx.lineWidth=1.5; ctx.lineCap='round';
  segsB.forEach(function(s){
    var a=toPx(s.p1), b=toPx(s.p2);
    ctx.beginPath(); ctx.moveTo(a[0],a[1]); ctx.lineTo(b[0],b[1]); ctx.stroke();
  });

  // Scale bar 1mm in basso a destra
  if(scl>8){
    var sbLen=scl, sbX=W-sbLen-14, sbY=H-12;
    ctx.strokeStyle='rgba(255,255,255,0.7)'; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.moveTo(sbX,sbY); ctx.lineTo(sbX+sbLen,sbY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(sbX,sbY-3); ctx.lineTo(sbX,sbY+3); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(sbX+sbLen,sbY-3); ctx.lineTo(sbX+sbLen,sbY+3); ctx.stroke();
    ctx.fillStyle='rgba(255,255,255,0.7)'; ctx.font='9px monospace'; ctx.textAlign='right';
    ctx.fillText('1 mm', sbX+sbLen, sbY-6);
  }

  // Indicatore zoom in alto a sinistra
  if(Math.abs(misICP_cutZoom-1.0)>0.01){
    ctx.fillStyle='rgba(255,255,255,0.55)'; ctx.font='9px monospace'; ctx.textAlign='left';
    ctx.fillText('zoom '+misICP_cutZoom.toFixed(2)+'x', 8, 13);
  }

  // Orientamento: piccola freccia in alto che indica l'asse verticale
  ctx.strokeStyle='rgba(255,255,255,0.35)'; ctx.lineWidth=1;
  ctx.fillStyle='rgba(255,255,255,0.35)'; ctx.font='8.5px monospace'; ctx.textAlign='center';
  ctx.fillText('asse cilindro', W-32, 13);
  ctx.beginPath(); ctx.moveTo(W-32, 18); ctx.lineTo(W-32, 32); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(W-35, 22); ctx.lineTo(W-32, 18); ctx.lineTo(W-29, 22); ctx.stroke();
}

// Lega la rotella del canvas al fattore di zoom. Attaccato una volta sola.
function misICP_bindCutviewWheel(){
  if(misICP_cutWheelBound) return;
  var cv=document.getElementById('misCutCanvas');
  if(!cv) return;
  cv.addEventListener('wheel', function(e){
    e.preventDefault();
    var delta = e.deltaY>0 ? 1/1.12 : 1.12;
    misICP_cutZoom *= delta;
    if(misICP_cutZoom<0.2)  misICP_cutZoom=0.2;
    if(misICP_cutZoom>15)   misICP_cutZoom=15;
    if(misICP_cutCurrentPair) misICP_drawCutview(cv, misICP_cutCurrentPair);
  }, { passive:false });
  // Doppio click: reset zoom
  cv.addEventListener('dblclick', function(e){
    e.preventDefault();
    misICP_cutZoom = 1.0;
    if(misICP_cutCurrentPair) misICP_drawCutview(cv, misICP_cutCurrentPair);
  });
  misICP_cutWheelBound = true;
}
