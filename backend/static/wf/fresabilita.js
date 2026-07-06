/*
 * wf/fresabilita.js — workflow FRESABILITA di Synthesis-ICP (Fase 6a modularizzazione, 8.88.0).
 * PRIMO file estratto in wf/ (un file per workflow).
 *
 * CONTRATTO: 34 function declaration del dominio fresabilita (analisi angolare fresatura
 * 5 assi: catalogo macchine, classificazione angoli, asse medio/minimax/custom, overlay
 * frecce 3D per-gruppo, pannello "Fresatura avanzata"). Nomi bare globali invariati.
 * Estrazione "functions-only" (pattern F5/syn-env): lo STATO resta nel monolite alla
 * posizione originale (§FRESABILITA: FRES_BUILTIN_MACHINES/FRES_STORAGE_KEY/FRES_PROXIMITY_DEG/
 * fresState/fresOverlayScene/fresOverlayLights) e il MONKEY-PATCH di calculateAngles pure
 * (vincolo d'ordine parse-time). Il cluster group-dialog (openGroupDialog...getMuaByGroup)
 * NON e' fres (gestione gruppi MUA) e resta nel monolite.
 *
 * CARICAMENTO: <script src> classico NON-strict in testa (dopo ds/syn-env.js), PRIMA del
 * MAIN. Le fn si limitano a essere DEFINITE a parse-time; leggono stato (fresState),
 * THREE/scene/muaObjects e altre globali del MAIN solo a CALL-TIME (post-interazione utente),
 * quando il MAIN ha gia' inizializzato tutto. VINCOLO HARD (syn-clip.js LIVE legge
 * window.fresState e chiama window.closeFresability): questi nomi devono restare bare-global.
 * GATE: scripts/gate/fres/gate.mjs (md5 verbatim per fn vs monolite pre-estrazione + probe
 * esposizione) + harness browser (pannello open/close/mode/machine).
 */

// ===== Persistenza =====
function fresLoadDB(){
  try {
    var raw = localStorage.getItem(FRES_STORAGE_KEY);
    if(!raw) return fresDefaultDB();
    var data = JSON.parse(raw);
    if(data.version !== 1) return fresDefaultDB();
    var customs = (data.machines || []).filter(function(m){ return !m.builtin; });
    return {
      version: 1,
      machines: FRES_BUILTIN_MACHINES.concat(customs),
      selectedId: data.selectedId || 'vhf_s5',
      lastCustomAxis: data.lastCustomAxis || null,
      lastMode: data.lastMode || 'mean'
    };
  } catch(e){
    console.warn('[Fresabilita] errore lettura storage', e);
    return fresDefaultDB();
  }
}
function fresDefaultDB(){
  return { version: 1, machines: FRES_BUILTIN_MACHINES.slice(), selectedId: 'vhf_s5', lastCustomAxis: null, lastMode: 'mean' };
}
function fresSaveDB(){
  try { localStorage.setItem(FRES_STORAGE_KEY, JSON.stringify(fresState.db)); } catch(e){ console.warn('[Fresabilita] errore scrittura storage', e); }
}

// ===== Math utility =====
function fresAngleAxesDeg(a, b){
  var c = Math.abs(a.x*b.x + a.y*b.y + a.z*b.z);
  return Math.acos(Math.min(c,1)) * 180/Math.PI;
}
function fresClassify(theta, alphaMax){
  if(theta <= 0.5*alphaMax) return { name: 'ottimo',        color: '#639922' };
  if(theta <= alphaMax)     return { name: 'accettabile',   color: '#D97706' };
  return                            { name: 'non-fresabile', color: '#EF4444' };
}

// ===== Asse medio (Modalità A) =====
function fresComputeMeanAxis(axes){
  if(!axes || axes.length === 0) return new THREE.Vector3(0,0,1);
  var ref = axes[0];
  var sx = 0, sy = 0, sz = 0;
  for(var i=0; i<axes.length; i++){
    var a = axes[i];
    var sign = (a.x*ref.x + a.y*ref.y + a.z*ref.z) >= 0 ? 1 : -1;
    sx += sign * a.x; sy += sign * a.y; sz += sign * a.z;
  }
  var v = new THREE.Vector3(sx, sy, sz);
  if(v.length() < 1e-9) return new THREE.Vector3(0,0,1);
  return v.normalize();
}

// ===== Asse minimax (Modalità B) - Nelder-Mead 2D in coordinate sferiche =====
function fresSphericalToVec(theta, phi){
  var st = Math.sin(theta);
  return new THREE.Vector3(st*Math.cos(phi), st*Math.sin(phi), Math.cos(theta));
}
function fresVecToSpherical(v){
  return [Math.acos(Math.max(-1, Math.min(1, v.z))), Math.atan2(v.y, v.x)];
}
function fresMaxDivergence(theta, phi, axes){
  var n = fresSphericalToVec(theta, phi);
  var maxD = 0;
  for(var i=0; i<axes.length; i++){
    var d = fresAngleAxesDeg(axes[i], n);
    if(d > maxD) maxD = d;
  }
  return maxD;
}
function fresComputeMinimaxAxis(axes){
  if(!axes || axes.length === 0) return new THREE.Vector3(0,0,1);
  var n0 = fresComputeMeanAxis(axes);
  var sph = fresVecToSpherical(n0);
  // Nelder-Mead 2D
  var step = 0.05, alpha=1, gamma=2, rho=0.5, sigma=0.5;
  var s = [
    { x:[sph[0],         sph[1]      ], v: fresMaxDivergence(sph[0],         sph[1],      axes) },
    { x:[sph[0]+step,    sph[1]      ], v: fresMaxDivergence(sph[0]+step,    sph[1],      axes) },
    { x:[sph[0],         sph[1]+step ], v: fresMaxDivergence(sph[0],         sph[1]+step, axes) }
  ];
  for(var iter=0; iter<200; iter++){
    s.sort(function(a,b){ return a.v - b.v; });
    var spread = Math.max(Math.abs(s[2].x[0]-s[0].x[0]), Math.abs(s[2].x[1]-s[0].x[1]));
    if(spread < 1e-5) break;
    var c = [(s[0].x[0]+s[1].x[0])/2, (s[0].x[1]+s[1].x[1])/2];
    var r = [c[0] + alpha*(c[0]-s[2].x[0]), c[1] + alpha*(c[1]-s[2].x[1])];
    var rv = fresMaxDivergence(r[0], r[1], axes);
    if(rv < s[0].v){
      var e = [c[0] + gamma*(r[0]-c[0]), c[1] + gamma*(r[1]-c[1])];
      var ev = fresMaxDivergence(e[0], e[1], axes);
      s[2] = (ev < rv) ? { x: e, v: ev } : { x: r, v: rv };
    } else if(rv < s[1].v){
      s[2] = { x: r, v: rv };
    } else {
      var cc = [c[0] + rho*(s[2].x[0]-c[0]), c[1] + rho*(s[2].x[1]-c[1])];
      var cv = fresMaxDivergence(cc[0], cc[1], axes);
      if(cv < s[2].v){
        s[2] = { x: cc, v: cv };
      } else {
        for(var i=1; i<3; i++){
          s[i].x[0] = s[0].x[0] + sigma*(s[i].x[0]-s[0].x[0]);
          s[i].x[1] = s[0].x[1] + sigma*(s[i].x[1]-s[0].x[1]);
          s[i].v = fresMaxDivergence(s[i].x[0], s[i].x[1], axes);
        }
      }
    }
  }
  s.sort(function(a,b){ return a.v - b.v; });
  return fresSphericalToVec(s[0].x[0], s[0].x[1]);
}

function fresInitOverlayScene(){
  if(fresOverlayScene) return;
  fresOverlayScene = new THREE.Scene();
  // v7.3.9.082: luci DIRECT nella overlay scene, NO camera.add
  // (il bug v.033/034: camera.add(light) -> luce condivisa con scene principale
  // -> arcata bruciata. Ora le luci vivono nella overlay scene e basta).
  var amb = new THREE.AmbientLight(0xffffff, 0.55);
  fresOverlayScene.add(amb);
  fresOverlayLights = {
    key: new THREE.DirectionalLight(0xffffff, 0.55),
    rim: new THREE.DirectionalLight(0xc8d8ff, 0.25)
  };
  fresOverlayScene.add(fresOverlayLights.key);
  fresOverlayScene.add(fresOverlayLights.rim);
}

function fresOverlayRender(){
  // v7.3.9.082: NO-OP. Le frecce sono tornate nella scena principale con
  // depthTest:false + renderOrder alto. fresOverlayScene non viene piu'
  // usata. Funzione mantenuta solo per compatibilita' con animate loop.
  return;
}

function fresBuildArrow(gid, origin){
  // v7.3.9.082: arrow nella scena PRINCIPALE con depthTest:false +
  // renderOrder alto. Niente piu' overlay scene (causava TypeError in alcuni
  // refresh). Questo approccio era quello originale di v.029 e funzionava.
  if(fresState.arrowsByGid[gid]){
    scene.remove(fresState.arrowsByGid[gid]);
    delete fresState.arrowsByGid[gid];
    delete fresState.pickersByGid[gid];
  }
  var grp = new THREE.Group();
  grp.name = 'FresabilitaArrow_g' + gid;

  var totalLen = 18;
  var coneLen  = 5.5;
  var coneR    = 1.6;
  var shaftR   = 0.7;
  var shaftLen = totalLen - coneLen;
  var liftOff  = 5;
  var pickerR  = 1.6;  // ridotto: prima era 2.4 (palla troppo grossa)

  var dir = new THREE.Vector3(0, 0, 1);
  var colorInt = getGroupArrowColorInt(gid);

  // === Materiale "plastica opaca Mario Bros" ===
  // MeshPhongMaterial con specular alto e shininess elevata = look giocattolo
  // saturato e leggibile, con highlight tondi e ombre morbide.
  function plasticMat(){
    return new THREE.MeshPhongMaterial({
      color: colorInt,
      specular: 0x444444,         // riflesso grigio medio (no bianco "lattiginoso")
      shininess: 80,              // spot lucido stretto
      depthTest: true,
      depthWrite: false,          // permette di vedere la freccia sopra la mesh
      transparent: true,
      opacity: 0.96,
      side: THREE.FrontSide
    });
  }

  // Materiale per il picker (la sfera in cima): leggermente piu' chiara
  // per fare da "punto di presa" senza essere invadente.
  function pickerMat(){
    var c = new THREE.Color(colorInt);
    // Schiarisco del 18% mantenendo saturazione (look caramella)
    var hsl = {}; c.getHSL(hsl);
    c.setHSL(hsl.h, hsl.s, Math.min(0.72, hsl.l + 0.12));
    return new THREE.MeshPhongMaterial({
      color: c,
      specular: 0x666666,
      shininess: 100,
      depthTest: true,
      depthWrite: false,
      transparent: true,
      opacity: 0.96
    });
  }

  // SHAFT: cilindro principale (corpo della freccia)
  var shaftGeo = new THREE.CylinderGeometry(shaftR, shaftR, shaftLen, 32);
  var shaft = new THREE.Mesh(shaftGeo, plasticMat());
  shaft.userData.isFresShaft = true;
  shaft.userData.gid = gid;
  shaft.renderOrder = 9998;

  // CONE: punta della freccia, leggermente piu' lunga e snella per look piu' aggraziato
  var coneGeo = new THREE.CylinderGeometry(0, coneR, coneLen, 32);
  var cone = new THREE.Mesh(coneGeo, plasticMat());
  cone.userData.isFresCone = true;
  cone.userData.gid = gid;
  cone.renderOrder = 9999;

  // PICKER: piccola sfera in cima per drag (ridotta e meno appariscente)
  var pickGeo = new THREE.SphereGeometry(pickerR, 24, 18);
  var picker = new THREE.Mesh(pickGeo, pickerMat());
  picker.userData.isFresPicker = true;
  picker.userData.gid = gid;
  picker.renderOrder = 10000;
  picker.position.copy(origin).addScaledVector(dir, liftOff + totalLen + 2);

  // HIGHLIGHT: piccolo riflesso bianco sulla sfera (look lucido)
  // Geometria piu' piccola, posizionato sul "polo" della sfera, opacita' bassa
  var highlightGeo = new THREE.SphereGeometry(pickerR * 0.45, 16, 10);
  var highlightMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.55,
    depthTest: false,
    depthWrite: false
  });
  var highlight = new THREE.Mesh(highlightGeo, highlightMat);
  highlight.renderOrder = 10001;
  // Offset il riflesso verso l'alto-sinistra (effetto "punto luce")
  highlight.position.copy(picker.position).add(new THREE.Vector3(-pickerR*0.35, pickerR*0.35, pickerR*0.4));

  grp.add(shaft);
  grp.add(cone);
  grp.add(picker);
  grp.add(highlight);

  grp.userData.shaft = shaft;
  grp.userData.cone = cone;
  grp.userData.picker = picker;
  grp.userData.highlight = highlight;
  grp.userData.shaftLen = shaftLen;
  grp.userData.coneLen = coneLen;
  grp.userData.totalLen = totalLen;
  grp.userData.liftOff = liftOff;
  grp.userData.pickerR = pickerR;
  grp.userData.origin = origin.clone();
  grp.userData.gid = gid;

  fresState.arrowsByGid[gid] = grp;
  fresState.pickersByGid[gid] = picker;

  // SCENA PRINCIPALE - non piu' overlay
  scene.add(grp);

  if(!fresState.arrowGroup){
    fresState.arrowGroup = grp;
    fresState.pickerSphere = picker;
  }
  return grp;
}

function fresClearAllArrows(){
  Object.keys(fresState.arrowsByGid).forEach(function(k){
    var g = fresState.arrowsByGid[k];
    if(g) scene.remove(g);
  });
  fresState.arrowsByGid = {};
  fresState.pickersByGid = {};
  fresState.arrowGroup = null;
  fresState.pickerSphere = null;
}

// v7.3.9.082: ricostruisce frecce per tutti i gruppi presenti
function fresBuildAllArrows(){
  fresClearAllArrows();
  var aligned = muaObjects.filter(function(m){ return m.aligned; });
  if(aligned.length < 2) return;
  // Raggruppa
  var groupsMap = {};
  aligned.forEach(function(m){
    var g = m.groupId || 0;
    if(!groupsMap[g]) groupsMap[g] = [];
    groupsMap[g].push(m);
  });
  // Costruisci una freccia per ogni gruppo con >=2 MUA
  Object.keys(groupsMap).forEach(function(gKey){
    var gid = parseInt(gKey, 10);
    var gr = groupsMap[gKey];
    if(gr.length < 2) return;
    var origin = new THREE.Vector3(0, 0, 0);
    gr.forEach(function(m){ origin.add(m.position); });
    origin.divideScalar(gr.length);
    fresBuildArrow(gid, origin);
  });
}
function fresUpdateArrow(gid){
  // v7.3.9.082: freccia parte da `origin + d*liftOff` (stacco dal MUA)
  var grp = fresState.arrowsByGid[gid];
  if(!grp) return;
  var axes = fresState.axesByGid[gid];
  if(!axes || !axes.setupAxis) return;

  var d = axes.setupAxis.clone().normalize();
  var origin = grp.userData.origin;
  var shaftLen = grp.userData.shaftLen;
  var coneLen = grp.userData.coneLen;
  var totalLen = grp.userData.totalLen;
  var liftOff = grp.userData.liftOff || 0;

  // Base della freccia "staccata" dal centroide MUA
  var base = origin.clone().addScaledVector(d, liftOff);

  var yAxis = new THREE.Vector3(0, 1, 0);
  var q = new THREE.Quaternion().setFromUnitVectors(yAxis, d);

  var shaft = grp.userData.shaft;
  if(shaft){
    var shaftMid = base.clone().addScaledVector(d, shaftLen * 0.5);
    shaft.position.copy(shaftMid);
    shaft.quaternion.copy(q);
  }
  var cone = grp.userData.cone;
  if(cone){
    var coneMid = base.clone().addScaledVector(d, shaftLen + coneLen * 0.5);
    cone.position.copy(coneMid);
    cone.quaternion.copy(q);
  }
  var picker = grp.userData.picker;
  var highlight = grp.userData.highlight;
  if(picker){
    picker.position.copy(base).addScaledVector(d, totalLen + 2);
  }
  if(highlight && picker){
    highlight.position.copy(picker.position);
    if(camera){
      highlight.lookAt(camera.position);
    }
  }
}

function fresUpdateAllArrows(){
  Object.keys(fresState.arrowsByGid).forEach(function(k){
    fresUpdateArrow(parseInt(k,10));
  });
}

// ===== Calcolo principale =====
function fresRecompute(){
  if(!fresState.isOpen) return;
  var aligned = muaObjects.filter(function(m){ return m.aligned; });
  var container = document.getElementById('fresGroupsContainer');
  if(!container){
    // Compat fallback: se manca il container nuovo, il vecchio HTML potrebbe
    // ancora avere fresMuaList/fresVerdict. Provo solo a settare un messaggio.
    var listEl = document.getElementById('fresMuaList');
    if(listEl) listEl.innerHTML = '<div style="font-family:var(--mono);font-size:12px;color:var(--gray);padding:6px">Container per-gruppo non inizializzato</div>';
    return;
  }
  if(aligned.length < 2){
    container.innerHTML = '<div style="font-family:var(--mono);font-size:12px;color:var(--gray);padding:8px">Servono almeno 2 MUA accoppiati</div>';
    fresClearAllArrows();
    return;
  }

  // Raggruppa
  var groupsMap = {};
  aligned.forEach(function(m){
    var g = m.groupId || 0;
    if(!groupsMap[g]) groupsMap[g] = [];
    groupsMap[g].push(m);
  });
  var groupIds = Object.keys(groupsMap).map(Number).sort(function(a,b){return a-b;});

  // Macchina selezionata (globale)
  var mach = fresState.db.machines.filter(function(x){ return x.id === fresState.db.selectedId; })[0];
  if(!mach) mach = fresState.db.machines[0];
  var alphaMax = mach.alphaMax;

  // (Re)build frecce se servono - se i gid presenti non corrispondono a quelli costruiti
  var existingGids = Object.keys(fresState.arrowsByGid).map(Number).sort();
  var neededGids = groupIds.filter(function(g){ return groupsMap[g].length >= 2; }).sort();
  var sameSet = (existingGids.length === neededGids.length) &&
                existingGids.every(function(v,i){ return v === neededGids[i]; });
  if(!sameSet){
    fresBuildAllArrows();
  }

  // Calcola assi e prepara HTML per ogni gruppo
  var html = '';
  var hasMulti = neededGids.length > 1;

  groupIds.forEach(function(gid){
    var gr = groupsMap[gid];
    if(gr.length < 2){
      // Gruppo con un solo MUA: messaggio breve
      html += renderFresGroupSingle(gid, gr, hasMulti);
      return;
    }
    var axes = gr.map(function(m){ return m.axisDir.clone().normalize(); });
    // Stato per-gruppo
    if(!fresState.axesByGid[gid]) fresState.axesByGid[gid] = {};
    var st = fresState.axesByGid[gid];
    st.meanAxis = fresComputeMeanAxis(axes);
    st.minimaxAxis = fresComputeMinimaxAxis(axes);
    if(!st.customAxis){
      // Recupera customAxis persistito per questo gid
      var saved = (fresState.db.lastCustomAxisByGid && fresState.db.lastCustomAxisByGid[gid])
                  ? fresState.db.lastCustomAxisByGid[gid]
                  : (gid === 0 ? fresState.db.lastCustomAxis : null);
      if(saved && saved.length === 3){
        st.customAxis = new THREE.Vector3().fromArray(saved);
      } else {
        st.customAxis = st.meanAxis.clone();
      }
    }
    if(fresState.mode === 'mean'){
      st.setupAxis = st.meanAxis.clone();
    } else if(fresState.mode === 'minimax'){
      st.setupAxis = st.minimaxAxis.clone();
    } else {
      st.setupAxis = st.customAxis.clone();
    }

    // Backward-compat fields (primo gruppo = 0 alimenta i ref globali)
    if(gid === 0 || gid === neededGids[0]){
      fresState.meanAxis = st.meanAxis;
      fresState.minimaxAxis = st.minimaxAxis;
      fresState.customAxis = st.customAxis;
      fresState.setupAxis = st.setupAxis;
    }

    // Aggiorna freccia
    fresUpdateArrow(gid);

    // Per-MUA divergenze e verdetto
    var maxTheta = 0, maxIdx = -1;
    var muaRows = '';
    axes.forEach(function(a, i){
      var theta = fresAngleAxesDeg(a, st.setupAxis);
      var cls = fresClassify(theta, alphaMax);
      if(theta > maxTheta){ maxTheta = theta; maxIdx = i; }
      muaRows += '<div style="display:grid;grid-template-columns:18px 1fr auto;gap:8px;align-items:center;padding:5px 8px;font-family:var(--mono);font-size:13px"><span style="width:10px;height:10px;border-radius:50%;background:' + cls.color + '"></span><span>MUA #' + gr[i].num + '</span><span style="font-weight:800;color:' + cls.color + '">' + theta.toFixed(1) + '\u00B0</span></div>';
    });

    // Coppie diagnostiche critiche dentro il gruppo
    var threshold = 2 * alphaMax;
    var critPairs = [];
    for(var i=0; i<axes.length; i++){
      for(var j=i+1; j<axes.length; j++){
        var t = fresAngleAxesDeg(axes[i], axes[j]);
        if(t > threshold){
          critPairs.push({ i: gr[i].num, j: gr[j].num, t: t });
        }
      }
    }

    // Custom info / proximita
    var customInfo = '';
    if(fresState.mode === 'custom' && st.customAxis){
      var dMean = fresAngleAxesDeg(st.customAxis, st.meanAxis);
      var dMmx  = fresAngleAxesDeg(st.customAxis, st.minimaxAxis);
      var hint = '';
      if(typeof FRES_PROXIMITY_DEG !== 'undefined'){
        if(dMean < FRES_PROXIMITY_DEG) hint = ' \u2190 vicino al medio';
        else if(dMmx < FRES_PROXIMITY_DEG) hint = ' \u2190 vicino al minimax';
      }
      customInfo = '\u0394 medio = ' + dMean.toFixed(1) + '\u00B0 \u00B7 \u0394 minimax = ' + dMmx.toFixed(1) + '\u00B0' + hint;
    }

    // Verdetto del gruppo
    var verdHtml;
    if(maxTheta <= alphaMax){
      verdHtml = '<div style="padding:10px;border-radius:6px;text-align:center;font-family:var(--mono);font-weight:800;font-size:13px;letter-spacing:.6px;background:#639922;color:#fff">FRESABILE<div style="font-size:10px;font-weight:400;margin-top:2px;opacity:0.95">su ' + mach.name + ' \u00B7 max ' + maxTheta.toFixed(1) + '\u00B0</div></div>';
    } else {
      verdHtml = '<div style="padding:10px;border-radius:6px;text-align:center;font-family:var(--mono);font-weight:800;font-size:13px;letter-spacing:.6px;background:#EF4444;color:#fff">NON FRESABILE<div style="font-size:10px;font-weight:400;margin-top:2px;opacity:0.95">MUA #' + gr[maxIdx].num + ' a ' + maxTheta.toFixed(1) + '\u00B0 supera \u03B1<sub>max</sub>=' + alphaMax + '\u00B0</div></div>';
    }

    // Diagnostica coppie critiche
    var diagHtml = '';
    if(critPairs.length > 0){
      diagHtml = '<div style="font-family:var(--mono);font-size:11px;color:#92400E;font-style:italic;padding:3px 0">Coppie critiche (>' + threshold + '\u00B0): ' + critPairs.slice(0,3).map(function(p){ return '#' + p.i + '-#' + p.j + ': ' + p.t.toFixed(1) + '\u00B0'; }).join(' \u00B7 ') + '</div>';
    }

    // Header gruppo (solo se multi-gruppo)
    var headerHtml = '';
    if(hasMulti){
      var arrowCol = getGroupArrowColor(gid);
      var label = (gid === 0) ? 'SENZA GRUPPO' : ('GRUPPO G' + gid);
      headerHtml = '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;padding-top:8px;border-top:1px solid #E2E8F0"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + arrowCol + ';box-shadow:0 0 0 2px ' + arrowCol + '33"></span><span style="font-family:var(--mono);font-size:12px;font-weight:800;letter-spacing:.05em;color:var(--dark)">' + label + '</span><span style="font-family:var(--mono);font-size:11px;color:var(--gray);margin-left:auto">' + gr.length + ' MUA</span></div>';
    }

    html += '<div style="margin-bottom:14px">' + headerHtml +
            '<div style="border:1px solid var(--border);border-radius:5px;padding:4px;background:var(--white);max-height:200px;overflow-y:auto">' + muaRows + '</div>' +
            (customInfo ? '<div style="font-family:var(--mono);font-size:11px;color:var(--gray);padding:0 5px;margin-top:4px">' + customInfo + '</div>' : '') +
            diagHtml +
            '<div style="margin-top:6px">' + verdHtml + '</div>' +
            '</div>';
  });

  container.innerHTML = html;
}

function renderFresGroupSingle(gid, gr, hasMulti){
  if(!hasMulti) return ''; // nascondi se siamo in single-group mode
  var arrowCol = getGroupArrowColor(gid);
  var label = (gid === 0) ? 'SENZA GRUPPO' : ('GRUPPO G' + gid);
  return '<div style="margin-bottom:10px">' +
    '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;padding-top:8px;border-top:1px solid #E2E8F0"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + arrowCol + '"></span><span style="font-family:var(--mono);font-size:12px;font-weight:800;color:var(--dark)">' + label + '</span></div>' +
    '<div style="font-family:var(--mono);font-size:12px;color:var(--gray);padding:4px 8px">Solo 1 MUA \u00b7 nessun calcolo angolare</div>' +
    '</div>';
}

// ===== UI binding =====
function fresRebuildMachineSelect(){
  var sel = document.getElementById('fresMachineSelect');
  if(!sel) return;
  sel.innerHTML = '';
  fresState.db.machines.forEach(function(m){
    var opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.name + (m.builtin ? '' : ' (custom)');
    sel.appendChild(opt);
  });
  sel.value = fresState.db.selectedId;
  var cur = fresState.db.machines.filter(function(x){ return x.id === fresState.db.selectedId; })[0];
  if(cur){
    document.getElementById('fresMachineName').textContent = cur.name;
    document.getElementById('fresMachineAlpha').textContent = cur.alphaMax + '\u00B0';
    // 8.80.4: #fresBtnRemove rimosso dal markup in v8.0.0-fase3e; il lookup senza guardia
    // lanciava TypeError e uccideva openFresability/fresOnMachineChange (pannello morto).
    var _fbr = document.getElementById('fresBtnRemove');
    if(_fbr) _fbr.style.display = cur.builtin ? 'none' : '';
  }
}
function fresOnMachineChange(){
  var sel = document.getElementById('fresMachineSelect');
  fresState.db.selectedId = sel.value;
  fresSaveDB();
  fresRebuildMachineSelect();
  fresRecompute();
}
function fresOnModeChange(mode){
  fresState.mode = mode;
  fresState.db.lastMode = mode;
  fresSaveDB();
  if(mode === 'custom' && !fresState.customAxis){
    if(fresState.db.lastCustomAxis){
      fresState.customAxis = new THREE.Vector3().fromArray(fresState.db.lastCustomAxis);
    } else if(fresState.meanAxis){
      fresState.customAxis = fresState.meanAxis.clone();
    }
  }
  fresRecompute();
}
function fresAddCustom(){
  var name = prompt('Nome macchina custom:');
  if(!name) return;
  var alphaStr = prompt('\u03B1max in gradi (5-60):', '30');
  var alpha = parseFloat(alphaStr);
  if(isNaN(alpha) || alpha < 5 || alpha > 60){ alert('\u03B1 non valido'); return; }
  var id, n = 1;
  do { id = 'custom_' + n++; } while(fresState.db.machines.some(function(m){ return m.id === id; }));
  fresState.db.machines.push({ id: id, name: name.trim(), alphaMax: alpha, builtin: false });
  fresState.db.selectedId = id;
  fresSaveDB();
  fresRebuildMachineSelect();
  fresRecompute();
}
function fresRemoveCustom(){
  var id = fresState.db.selectedId;
  var cur = fresState.db.machines.filter(function(x){ return x.id === id; })[0];
  if(!cur || cur.builtin) return;
  if(!confirm('Eliminare la macchina "' + cur.name + '"?')) return;
  fresState.db.machines = fresState.db.machines.filter(function(x){ return x.id !== id; });
  fresState.db.selectedId = 'vhf_s5';
  fresSaveDB();
  fresRebuildMachineSelect();
  fresRecompute();
}

// ===== Aggiornamento bottone "Fresatura avanzata" abilitato/disabilitato =====
function fresUpdateOpenButton(){
  var btn = document.getElementById('btnOpenFresability');
  if(!btn) return;
  var aligned = muaObjects.filter(function(m){ return m.aligned; });
  btn.disabled = (aligned.length < 2);
  btn.style.opacity = btn.disabled ? '0.4' : '1';
  btn.style.cursor = btn.disabled ? 'not-allowed' : 'pointer';
  // Blocco 6a: stessa logica per il bottone Report MUA PDF
  var btnR = document.getElementById('btnAnalReport');
  if(btnR){
    btnR.disabled = (aligned.length < 2);
    btnR.style.opacity = btnR.disabled ? '0.4' : '1';
    btnR.style.cursor = btnR.disabled ? 'not-allowed' : 'pointer';
  }
}

// ===== Apertura / chiusura pannello =====
function openFresability(){
  // Inizializza database se prima volta
  if(!fresState.db) fresState.db = fresLoadDB();

  // Nascondi pannelli Misura, mostra pannello Fresabilità
  var panMua  = document.getElementById('panelMuaList');
  var panAng  = document.getElementById('panelAngleList');
  var panAx   = document.getElementById('panelAxisInfo');
  var panFres = document.getElementById('panelFresabilita');
  if(panMua)  panMua.style.display  = 'none';
  if(panAng)  panAng.style.display  = 'none';
  if(panAx)   panAx.style.display   = 'none';
  if(panFres) panFres.style.display = '';

  analysisMode = 'fresabilita';
  fresState.isOpen = true;

  // Restora modalità da storage. 'custom' e' stata rimossa dalla UI in v8 → fallback su 'mean'.
  fresState.mode = fresState.db.lastMode || 'mean';
  if(fresState.mode === 'custom') fresState.mode = 'mean';
  var radio = document.querySelector('input[name="fresMode"][value="' + fresState.mode + '"]');
  if(radio) radio.checked = true;

  // Carica asse custom se persistito
  if(fresState.db.lastCustomAxis){
    fresState.customAxis = new THREE.Vector3().fromArray(fresState.db.lastCustomAxis);
  }

  fresRebuildMachineSelect();
  fresBuildArrow();
  fresAttachMouseHandlers();
  fresRecompute();

  showStatus('Fresatura avanzata: analisi compatibilita\u0301 macchina');
}

function closeFresability(){
  // Salva asse custom se presente
  if(fresState.customAxis){
    fresState.db.lastCustomAxis = fresState.customAxis.toArray();
    fresSaveDB();
  }

  // Rimuovi freccia di setup dalla scena
  if(fresState.arrowGroup){
    scene.remove(fresState.arrowGroup);
    fresState.arrowGroup = null;
    fresState.pickerSphere = null;
  }
  fresDetachMouseHandlers();

  // Ripristina pannelli Misura
  var panMua  = document.getElementById('panelMuaList');
  var panAng  = document.getElementById('panelAngleList');
  var panAx   = document.getElementById('panelAxisInfo');
  var panFres = document.getElementById('panelFresabilita');
  if(panMua)  panMua.style.display  = '';
  if(panAng)  panAng.style.display  = '';
  if(panAx)   panAx.style.display   = '';
  if(panFres) panFres.style.display = 'none';

  analysisMode = 'misura';
  fresState.isOpen = false;
  showStatus('Tornato a Misura');
}

// ===== Trackball virtuale (Shoemake arcball) =====
function fresScreenToSphere(x, y){
  var rect = renderer.domElement.getBoundingClientRect();
  var nx = ((x - rect.left) / rect.width)  * 2 - 1;
  var ny = -((y - rect.top)  / rect.height) * 2 + 1;
  var r2 = nx*nx + ny*ny;
  if(r2 <= 1){
    return new THREE.Vector3(nx, ny, Math.sqrt(1 - r2));
  }
  var r = Math.sqrt(r2);
  return new THREE.Vector3(nx/r, ny/r, 0);
}
function fresIsClickOnPicker(x, y){
  // v7.3.9.082: soglia 80px ULTRA generosa + log diagnostico esteso
  var pickers = Object.values(fresState.pickersByGid).filter(Boolean);
  if(pickers.length === 0){
    return null;
  }
  // Forzo aggiornamento matrixWorld (i picker vivono in fresOverlayScene)
  pickers.forEach(function(p){ p.updateMatrixWorld(true); });

  var rect = renderer.domElement.getBoundingClientRect();

  // Raycast (potrebbe non funzionare con scene overlay)
  var px = ((x - rect.left) / rect.width)  * 2 - 1;
  var py = -((y - rect.top)  / rect.height) * 2 + 1;
  var ray = new THREE.Raycaster();
  ray.setFromCamera({ x: px, y: py }, camera);
  var hits = ray.intersectObjects(pickers, false);
  if(hits.length > 0){
    var picked = hits[0].object;
    while(picked){
      if(picked.userData && typeof picked.userData.gid !== 'undefined'){
        return picked.userData.gid;
      }
      picked = picked.parent;
    }
  }

  // Fallback proximity 80px (enorme - circa due dita)
  var bestGid = null;
  var bestDist = 80;
  for(var i=0; i<pickers.length; i++){
    var pck = pickers[i];
    var ws = new THREE.Vector3();
    pck.getWorldPosition(ws);
    var ndc = ws.project(camera);
    if(ndc.z > 1 || ndc.z < -1){
      continue;
    }
    var sx = rect.left + (ndc.x * 0.5 + 0.5) * rect.width;
    var sy = rect.top  + (-ndc.y * 0.5 + 0.5) * rect.height;
    var dx = sx - x, dy = sy - y;
    var dist = Math.sqrt(dx*dx + dy*dy);
    var gid = (pck.userData && typeof pck.userData.gid !== 'undefined') ? pck.userData.gid : '??';
    if(dist < bestDist){
      bestDist = dist;
      bestGid = gid;
    }
  }
  if(bestGid !== null && bestGid !== '??'){
    return bestGid;
  }
  return null;
}

function fresOnMouseDown(e){
  // v7.3.9.082 super-diagnostic
  console.log('[fres-md] click! isOpen=' + fresState.isOpen + 
              ' pickersCount=' + Object.keys(fresState.pickersByGid).length +
              ' button=' + e.button +
              ' xy=(' + e.clientX + ',' + e.clientY + ')');
  if(!fresState.isOpen){
    console.log('[fres-md] EXIT: panel not open');
    return;
  }
  if(e.button !== 0){
    console.log('[fres-md] EXIT: button != 0');
    return;
  }
  var gid = fresIsClickOnPicker(e.clientX, e.clientY);
  if(gid === null || gid === undefined){
    console.log('[fres-md] EXIT: no picker hit');
    return;
  }

  // BLOCCO TOTALE evento - capture phase + immediate
  e.preventDefault();
  e.stopPropagation();
  if(typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();

  if(fresState.mode !== 'custom'){
    var radio = document.querySelector('input[name="fresMode"][value="custom"]');
    if(radio){ radio.checked = true; }
    if(typeof fresOnModeChange === 'function'){
      fresOnModeChange('custom');
    } else {
      fresState.mode = 'custom';
    }
  }
  if(!fresState.axesByGid) fresState.axesByGid = {};
  if(!fresState.axesByGid[gid]) fresState.axesByGid[gid] = {};
  var st = fresState.axesByGid[gid];
  if(!st.customAxis){
    if(st.meanAxis){
      st.customAxis = st.meanAxis.clone();
    } else if(fresState.meanAxis){
      st.customAxis = fresState.meanAxis.clone();
    } else {
      st.customAxis = new THREE.Vector3(0,0,1);
    }
    st.setupAxis = st.customAxis.clone();
  }
  fresState.activeGroupId = gid;
  fresState.dragging = true;
  fresState.dragLast = fresScreenToSphere(e.clientX, e.clientY);
  if(controls && typeof controls.enabled !== 'undefined') controls.enabled = false;
  console.log('[fres-md] DRAG START gid=' + gid + ' controlsDisabled=' + (controls ? !controls.enabled : 'N/A'));
}
function fresOnMouseMove(e){
  if(!fresState.dragging) return;
  var gid = fresState.activeGroupId;
  if(gid === null || gid === undefined) return;
  var axes = fresState.axesByGid[gid];
  if(!axes || !axes.customAxis) return;
  var cur = fresScreenToSphere(e.clientX, e.clientY);
  var last = fresState.dragLast;
  var axis = new THREE.Vector3().crossVectors(last, cur);
  var len = axis.length();
  if(len > 1e-6){
    var angle = Math.atan2(len, last.dot(cur));
    axis.normalize();
    var camQuat = camera.quaternion.clone();
    var worldAxis = axis.clone().applyQuaternion(camQuat);
    var q = new THREE.Quaternion().setFromAxisAngle(worldAxis, angle);
    axes.customAxis.applyQuaternion(q).normalize();
    axes.setupAxis = axes.customAxis.clone();
    fresUpdateArrow(gid);
    fresRecompute();
  }
  fresState.dragLast = cur;
  e.stopPropagation();
  e.preventDefault();
}
function fresOnMouseUp(e){
  if(fresState.dragging){
    fresState.dragging = false;
    if(controls && typeof controls.enabled !== 'undefined') controls.enabled = true;
    // Salva il customAxis del gruppo che era in drag
    var gid = fresState.activeGroupId;
    if(gid !== null && gid !== undefined){
      var axes = fresState.axesByGid[gid];
      if(axes && axes.customAxis){
        if(!fresState.db.lastCustomAxisByGid) fresState.db.lastCustomAxisByGid = {};
        fresState.db.lastCustomAxisByGid[gid] = axes.customAxis.toArray();
        // Backward-compat: il primo gid sovrascrive lastCustomAxis legacy
        if(gid === 0) fresState.db.lastCustomAxis = axes.customAxis.toArray();
        fresSaveDB();
      }
    }
    fresState.activeGroupId = null;
  }
}
function fresAttachMouseHandlers(){
  if(fresState.pendingMouseHandlers) return;
  var dom = renderer.domElement;
  fresState.pendingMouseHandlers = {
    md: fresOnMouseDown, mm: fresOnMouseMove, mu: fresOnMouseUp
  };
  // v7.3.9.082: triplo attach in capture phase per intercettare prima
  // di OrbitControls qualsiasi cosa accada
  dom.addEventListener('mousedown', fresOnMouseDown, true);
  window.addEventListener('mousedown', fresOnMouseDown, true);
  document.body.addEventListener('mousedown', fresOnMouseDown, true);
  window.addEventListener('mousemove', fresOnMouseMove, true);
  window.addEventListener('mouseup', fresOnMouseUp, true);
  console.log('[fres-attach] listeners attached on dom+window+body capture');
}
function fresDetachMouseHandlers(){
  if(!fresState.pendingMouseHandlers) return;
  var dom = renderer.domElement;
  dom.removeEventListener('mousedown', fresOnMouseDown, true);
  window.removeEventListener('mousedown', fresOnMouseDown, true);
  document.body.removeEventListener('mousedown', fresOnMouseDown, true);
  window.removeEventListener('mousemove', fresOnMouseMove, true);
  window.removeEventListener('mouseup', fresOnMouseUp, true);
  fresState.pendingMouseHandlers = null;
  console.log('[fres-detach] listeners removed');
}
