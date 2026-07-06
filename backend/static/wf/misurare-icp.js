/*
 * wf/misurare-icp.js — MISURARE motore ICP di Synthesis-ICP (Fase 6f modularizzazione, core clinico).
 * Sesto file estratto in wf/ (dopo fresabilita, tree, report-analizza, sostituire, replace); 1/3 di Misurare.
 *
 * CONTRATTO: 59 function declaration del dominio §MISURARE-ICP — parsing STL bin/ascii, componenti
 * connessi, partizione scanbody/arcata, clustering, Kabsch+SVD3(Jacobi)+ICP nearest-neighbor,
 * brute-force pre-align (permutazioni n<=8), asse cilindro cap-based, tipo scanbody, connessione
 * clinica datum, seeding click-to-seed, orchestratore misICP_run, mount/render viewport. Nomi bare globali invariati.
 * Estrazione "functions-only" (pattern 6a-6e): lo STATO resta nel monolite (misICP_stlA/B, trisA/B,
 * meshA/B, result, seed*, meshesA/B, connMeshes, viewportMounted, savedState) + costanti MIS_* (MIS_CLIN,
 * MIS_CLIN_AX, MIS_SEED_RADIUS, MIS_ORIGIN_OFFSET, MIS_COL_* e MIS_OP_*) e i banner §MISURARE-ICP/
 * §ASSE-CILINDRO-CONN (check_anchors). Le fn le leggono/mutano via scope globale a call-time.
 *
 * DIPENDENZE a call-time (tutte hoisted/head-loaded PRIMA del MAIN, verificate dall'audit 6f):
 *  synLog, findScanbodyCenter, showStatus, synAxisEngineRead/synAxisUseLateral (MAIN, hoisted);
 *  parseSTL (ds/syn-math.js), applyRenderModeToScene/syntesisGetUiZoom (ds/syn-env.js, guardate);
 *  scene/camera/renderer/controls/scanMesh/currentWorkflow (var MAIN); THREE (ES-module deferred),
 *  window.SYN. NESSUN accesso a parse-time (0 statement top-level fuori dalle 59 function-decl).
 * CARICAMENTO: <script src> classico NON-strict in testa (dopo wf/replace.js), PRIMA del MAIN.
 * GATE: scripts/gate/mis-icp/gate.mjs (59 md5-verbatim + esposizione + residuo + wiring) +
 *       scripts/gate/mis-icp/gate-golden.mjs (spina numerica ICP headless sulle fixtures).
 */

// --- PARSING STL (binary + ASCII) ---
function misICP_pBin(dv,n){
  var t=[],o=84;
  for(var i=0;i<n;i++){
    t.push([
      [dv.getFloat32(o+12,true),dv.getFloat32(o+16,true),dv.getFloat32(o+20,true)],
      [dv.getFloat32(o+24,true),dv.getFloat32(o+28,true),dv.getFloat32(o+32,true)],
      [dv.getFloat32(o+36,true),dv.getFloat32(o+40,true),dv.getFloat32(o+44,true)]
    ]);
    o+=50;
  }
  return t;
}
function misICP_pAsc(s){
  var t=[],re=/vertex\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)/g,m,v=[];
  while((m=re.exec(s))!==null){
    v.push([+m[1],+m[2],+m[3]]);
    if(v.length===3){ t.push(v.slice()); v=[]; }
  }
  return t;
}
function misICP_pSTL(b){
  var dv=new DataView(b),n=dv.getUint32(80,true);
  return (84+n*50===b.byteLength && n>0) ? misICP_pBin(dv,n) : misICP_pAsc(new TextDecoder().decode(new Uint8Array(b)));
}

// --- COMPONENTI CONNESSI + CENTROIDI ---
function misICP_comps(T){
  var vm={},p=T.map(function(_,i){return i;});
  T.forEach(function(t,i){
    t.forEach(function(v){
      var k=v[0].toFixed(3)+','+v[1].toFixed(3)+','+v[2].toFixed(3);
      if(!vm[k])vm[k]=[];
      vm[k].push(i);
    });
  });
  function find(x){ return p[x]===x ? x : (p[x]=find(p[x])); }
  Object.keys(vm).forEach(function(k){
    var ts=vm[k];
    for(var i=1;i<ts.length;i++){
      var ra=find(ts[0]),rb=find(ts[i]);
      if(ra!==rb)p[ra]=rb;
    }
  });
  var g={};
  T.forEach(function(_,i){
    var r=find(i);
    if(!g[r])g[r]=[];
    g[r].push(i);
  });
  return Object.keys(g).map(function(k){return g[k];}).filter(function(c){return c.length>=4;});
}
function misICP_cen(T,idx){
  var x=0,y=0,z=0,n=0;
  idx.forEach(function(i){ T[i].forEach(function(v){x+=v[0];y+=v[1];z+=v[2];n++;}); });
  return [x/n,y/n,z/n];
}
// Bounding box di una componente (max - min in X/Y/Z)
function misICP_compBbox(T,idx){
  var mnx=Infinity,mny=Infinity,mnz=Infinity,mxx=-Infinity,mxy=-Infinity,mxz=-Infinity;
  idx.forEach(function(i){
    T[i].forEach(function(v){
      if(v[0]<mnx)mnx=v[0]; if(v[0]>mxx)mxx=v[0];
      if(v[1]<mny)mny=v[1]; if(v[1]>mxy)mxy=v[1];
      if(v[2]<mnz)mnz=v[2]; if(v[2]>mxz)mxz=v[2];
    });
  });
  return { dx:mxx-mnx, dy:mxy-mny, dz:mxz-mnz, max:Math.max(mxx-mnx, mxy-mny, mxz-mnz) };
}
// Euristica scanbody: componente FISICAMENTE piccola (< 15mm dim max). Il bbox e' il
// discriminatore VERO (scanbody ~4-5mm vs arcata > 30mm); il cap triangoli e' solo una
// guardia generosa. 8.68.1: alzato 5000 -> 40000 perche' i template/scan HD hanno corpi
// con > 5000 tris (es. SR HD = 11130 tris/marker) che venivano scartati come "arcata" ->
// in Misurare restava solo il disco-cap piatto -> asse degenere (~74deg), conteggio e
// collasso visivo. L'arcata resta esclusa: > 40000 tris E comunque bbox > 15mm.
function misICP_isScanbody(T,idx){
  if(idx.length > 40000) return false;
  var bb=misICP_compBbox(T,idx);
  return bb.max < 15;
}
// Partiziona le componenti in due set: gli indici degli scanbody e degli altri
// (arcata/gengiva/background). Base per ICP preciso e rendering differenziato.
function misICP_partition(T, comps){
  var scan=[], bg=[];
  comps.forEach(function(c,i){
    if(misICP_isScanbody(T,c)) scan.push(i);
    else                        bg.push(i);
  });
  return { scan:scan, bg:bg };
}
// --- CLUSTERING SPAZIALE ---
// Uno scanbody reale (es. 1T3) puo' essere triangolato come piu' componenti
// connesse separate (cilindro + disco di flangia). Devono essere raggruppate.
// Usiamo la stessa strategia del Comparator v7: autoThresh calcola una soglia
// di distanza "furba" (cerca il gap nella distribuzione dei nearest-neighbor);
// clusterComps esegue union-find sulla distanza euclidea tra centroidi.

function misICP_autoThresh(cents){
  if(cents.length <= 1) return 999;
  // 8.71.1: CAP FISICO della soglia di clustering. I componenti di UNO scanbody (cilindro+flangia/disco)
  // stanno entro la sua larghezza (IPD <=5mm); scanbody DISTINTI sono piu' lontani (impianti clinici >=6mm).
  // Senza cap, su scanbody mono-componente (es. OS: solo il cap) spread*0.25 (~13mm) e nn[0]*1.1 (~9mm)
  // fondevano OS adiacenti distanti 8-11mm -> 6 OS diventavano 3 cluster -> allineamento Misurare degenere
  // (nA=3 vs nB=6, asse 80°). Diagnosi gate-validata dal session log + riproduzione offline su scanbody_OS.
  var MAX_CLUSTER_MM = 5.5;
  var nn = cents.map(function(c,i){
    var md = Infinity;
    cents.forEach(function(d,j){
      if(i === j) return;
      var dist = Math.hypot(c[0]-d[0], c[1]-d[1], c[2]-d[2]);
      if(dist < md) md = dist;
    });
    return md;
  });
  nn.sort(function(a,b){return a-b;});
  var bestRatio = 1, bestT = nn[nn.length-1]*2;
  for(var i=1; i<nn.length; i++){
    var ratio = nn[i] / (nn[i-1] || 0.001);
    if(ratio > bestRatio){ bestRatio = ratio; bestT = (nn[i-1]+nn[i])/2; }
  }
  if(bestRatio < 1.5) bestT = nn[nn.length-1]*2;
  var xs = cents.map(function(c){return c[0];});
  var ys = cents.map(function(c){return c[1];});
  var zs = cents.map(function(c){return c[2];});
  var spread = Math.hypot(
    Math.max.apply(null,xs)-Math.min.apply(null,xs),
    Math.max.apply(null,ys)-Math.min.apply(null,ys),
    Math.max.apply(null,zs)-Math.min.apply(null,zs)
  );
  var result = Math.min(bestT, spread*0.25, MAX_CLUSTER_MM);
  return Math.min(Math.max(result, nn[0]*1.1), MAX_CLUSTER_MM);   // 8.71.1: il floor nn[0]*1.1 non deve sforare il cap fisico
}

function misICP_clusterComps(cents, thresh){
  var n = cents.length;
  var par = cents.map(function(_,i){return i;});
  function find(x){ return par[x]===x ? x : (par[x]=find(par[x])); }
  function unite(a,b){ par[find(a)] = find(b); }
  for(var i=0; i<n; i++){
    for(var j=i+1; j<n; j++){
      var d = Math.hypot(cents[i][0]-cents[j][0], cents[i][1]-cents[j][1], cents[i][2]-cents[j][2]);
      if(d <= thresh*1.02) unite(i,j);
    }
  }
  var g = {};
  cents.forEach(function(_,i){
    var r = find(i);
    if(!g[r]) g[r]=[];
    g[r].push(i);
  });
  return Object.keys(g).map(function(k){return g[k];});
}

// Calcola centroide di un cluster (insieme di componenti unite)
// scanIdxs = indici in part.scan, compList = comps completa, T = triangoli
function misICP_clusterCentroid(T, comps, partScan, scanIdxsInCluster){
  // 8.62.1: centroide AREA-PESATO (centroide di superficie) invece della media non pesata dei
  // vertici. La media non pesata pesa per DENSITA' di triangolazione: confrontando due mesh a
  // densita' diversa (es. exocad denso 31k tri vs export Synthesis decimato 12k tri) il centroide
  // si sposta -> deviazione SPURIA (riprodotta 74.5um, scende a 17.3um reale su id 2770). L'area-peso
  // rende la metrica indipendente dalla densita'. UNICO punto: alimenta sia l'allineamento
  // (scanCentsA/B -> misICP_runICP) sia la deviazione (matchPairs) -> li corregge entrambi. Allinea
  // il client al backend, che usa gia' un riferimento robusto (icp_engine.cap_centroid).
  var sx=0, sy=0, sz=0, W=0;
  scanIdxsInCluster.forEach(function(ri){
    var compIdx = partScan[ri];
    comps[compIdx].forEach(function(ti){
      var tr=T[ti], a=tr[0], b=tr[1], c=tr[2];
      var ux=b[0]-a[0], uy=b[1]-a[1], uz=b[2]-a[2];
      var vx=c[0]-a[0], vy=c[1]-a[1], vz=c[2]-a[2];
      var nx=uy*vz-uz*vy, ny=uz*vx-ux*vz, nz=ux*vy-uy*vx;
      var ar=0.5*Math.sqrt(nx*nx + ny*ny + nz*nz);     // area del triangolo
      sx += ar*(a[0]+b[0]+c[0])/3; sy += ar*(a[1]+b[1]+c[1])/3; sz += ar*(a[2]+b[2]+c[2])/3; W += ar;
    });
  });
  if(W>0) return [sx/W, sy/W, sz/W];
  // fallback difensivo (cluster di soli triangoli degeneri, area~0): media non pesata storica
  var x=0, y=0, z=0, n=0;
  scanIdxsInCluster.forEach(function(ri){ comps[partScan[ri]].forEach(function(ti){ T[ti].forEach(function(v){ x+=v[0]; y+=v[1]; z+=v[2]; n++; }); }); });
  return n ? [x/n, y/n, z/n] : [0,0,0];
}

// Estrae tutti i triangoli di un cluster come array unico
function misICP_clusterTris(T, comps, partScan, scanIdxsInCluster){
  var out=[];
  scanIdxsInCluster.forEach(function(ri){
    var compIdx = partScan[ri];
    comps[compIdx].forEach(function(ti){ out.push(T[ti]); });
  });
  return out;
}

// --- PRIMITIVE MATRICIALI 3x3 ---
function misICP_eye3(){ return [[1,0,0],[0,1,0],[0,0,1]]; }
function misICP_mul3(A,B){
  var C=[[0,0,0],[0,0,0],[0,0,0]];
  for(var i=0;i<3;i++)for(var j=0;j<3;j++)for(var k=0;k<3;k++)C[i][j]+=A[i][k]*B[k][j];
  return C;
}
function misICP_tr3(A){ return [[A[0][0],A[1][0],A[2][0]],[A[0][1],A[1][1],A[2][1]],[A[0][2],A[1][2],A[2][2]]]; }
function misICP_det3(A){
  return A[0][0]*(A[1][1]*A[2][2]-A[1][2]*A[2][1])
       - A[0][1]*(A[1][0]*A[2][2]-A[1][2]*A[2][0])
       + A[0][2]*(A[1][0]*A[2][1]-A[1][1]*A[2][0]);
}
function misICP_mv3(M,v){
  return [
    M[0][0]*v[0]+M[0][1]*v[1]+M[0][2]*v[2],
    M[1][0]*v[0]+M[1][1]*v[1]+M[1][2]*v[2],
    M[2][0]*v[0]+M[2][1]*v[1]+M[2][2]*v[2]
  ];
}
function misICP_jacobi3(A){
  var a=[[A[0][0],A[0][1],A[0][2]],[A[1][0],A[1][1],A[1][2]],[A[2][0],A[2][1],A[2][2]]];
  var V=misICP_eye3();
  for(var it=0;it<200;it++){
    var p=0,q=1,mx=Math.abs(a[0][1]);
    if(Math.abs(a[0][2])>mx){p=0;q=2;mx=Math.abs(a[0][2]);}
    if(Math.abs(a[1][2])>mx){p=1;q=2;}
    if(Math.abs(a[p][q])<1e-14)break;
    var th=(a[q][q]-a[p][p])/(2*a[p][q]);
    var t=(th>=0?1:-1)/(Math.abs(th)+Math.sqrt(th*th+1));
    var c=1/Math.sqrt(t*t+1), s=t*c, apq=a[p][q];
    a[p][p]-=t*apq; a[q][q]+=t*apq;
    a[p][q]=0; a[q][p]=0;
    for(var r=0;r<3;r++){
      if(r!==p && r!==q){
        var ar=a[p][r], br=a[q][r];
        a[p][r]=c*ar-s*br; a[r][p]=a[p][r];
        a[q][r]=s*ar+c*br; a[r][q]=a[q][r];
      }
    }
    for(var r=0;r<3;r++){
      var vp=V[r][p], vq=V[r][q];
      V[r][p]=c*vp-s*vq;
      V[r][q]=s*vp+c*vq;
    }
  }
  return { vals:[a[0][0],a[1][1],a[2][2]], vecs:V };
}
function misICP_svd3(M){
  var MtM=misICP_mul3(misICP_tr3(M),M), ej=misICP_jacobi3(MtM);
  var ord=[0,1,2].sort(function(a,b){return ej.vals[b]-ej.vals[a];});
  var Vc=ord.map(function(oi){return [ej.vecs[0][oi],ej.vecs[1][oi],ej.vecs[2][oi]];});
  var Vm=[
    [Vc[0][0],Vc[1][0],Vc[2][0]],
    [Vc[0][1],Vc[1][1],Vc[2][1]],
    [Vc[0][2],Vc[1][2],Vc[2][2]]
  ];
  var MV=misICP_mul3(M,Vm), Um=[[0,0,0],[0,0,0],[0,0,0]];
  for(var j=0;j<3;j++){
    var col=[MV[0][j],MV[1][j],MV[2][j]];
    var nm=Math.sqrt(col[0]*col[0]+col[1]*col[1]+col[2]*col[2]);
    if(nm>1e-10){ Um[0][j]=col[0]/nm; Um[1][j]=col[1]/nm; Um[2][j]=col[2]/nm; }
  }
  return { U:Um, V:Vm };
}
function misICP_kabsch(A,B){
  var n=A.length, cA=[0,0,0], cB=[0,0,0];
  for(var i=0;i<n;i++){
    cA[0]+=A[i][0]; cA[1]+=A[i][1]; cA[2]+=A[i][2];
    cB[0]+=B[i][0]; cB[1]+=B[i][1]; cB[2]+=B[i][2];
  }
  cA=cA.map(function(v){return v/n;});
  cB=cB.map(function(v){return v/n;});
  var Ac=A.map(function(p){return [p[0]-cA[0],p[1]-cA[1],p[2]-cA[2]];});
  var Bc=B.map(function(p){return [p[0]-cB[0],p[1]-cB[1],p[2]-cB[2]];});
  var HH=[[0,0,0],[0,0,0],[0,0,0]];
  for(var i=0;i<n;i++)for(var r=0;r<3;r++)for(var cc=0;cc<3;cc++)HH[r][cc]+=Ac[i][r]*Bc[i][cc];
  var sv=misICP_svd3(HH), R=misICP_mul3(sv.V,misICP_tr3(sv.U));
  if(misICP_det3(R)<0){
    var Vc2=sv.V.map(function(r){return r.slice();});
    for(var r=0;r<3;r++) Vc2[r][2]*=-1;
    R=misICP_mul3(Vc2,misICP_tr3(sv.U));
  }
  var RcA=misICP_mv3(R,cA);
  var t=[cB[0]-RcA[0], cB[1]-RcA[1], cB[2]-RcA[2]];
  return { R:R, t:t };
}
function misICP_runICP(fixed,moving,maxIter){
  maxIter=maxIter||60;
  var Bt=moving.map(function(p){return p.slice();});
  var Racc=misICP_eye3(), tacc=[0,0,0], prev=Infinity;
  for(var it=0;it<maxIter;it++){
    var idx=Bt.map(function(b){
      var mi=-1, md=Infinity;
      fixed.forEach(function(a,i){
        var d=Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
        if(d<md){md=d;mi=i;}
      });
      return mi;
    });
    var mF=idx.map(function(i){return fixed[i];});
    var kb=misICP_kabsch(Bt,mF);
    Bt=Bt.map(function(p){
      var rp=misICP_mv3(kb.R,p);
      return [rp[0]+kb.t[0], rp[1]+kb.t[1], rp[2]+kb.t[2]];
    });
    Racc=misICP_mul3(kb.R,Racc);
    var Rt=misICP_mv3(kb.R,tacc);
    tacc=[Rt[0]+kb.t[0], Rt[1]+kb.t[1], Rt[2]+kb.t[2]];
    var rmsd=0;
    Bt.forEach(function(b,i){
      var f=mF[i];
      rmsd+=(b[0]-f[0])*(b[0]-f[0])+(b[1]-f[1])*(b[1]-f[1])+(b[2]-f[2])*(b[2]-f[2]);
    });
    rmsd=Math.sqrt(rmsd/Bt.length);
    if(Math.abs(prev-rmsd)<1e-9)break;
    prev=rmsd;
  }
  var trace=Racc[0][0]+Racc[1][1]+Racc[2][2];
  var angle=Math.acos(Math.min(1,Math.max(-1,(trace-1)/2)))*180/Math.PI;
  return { R:Racc, t:tacc, aligned:Bt, rmsd:prev, angle:angle };
}
// v7.3.9.093 - PATCH G in JavaScript: brute-force permutation safety net.
// Risolve la rotational ambiguity quando A e B hanno la stessa configurazione
// geometrica ma sono ruotate fra loro >60 gradi (caso tipico di scanbody SR/RS
// dove i 6 cilindri sono praticamente intercambiabili a meno di una rotazione
// circolare). In quel caso l'ICP nearest-neighbor sbaglia il matching iniziale
// e converge a un local minimum molto distante dall'allineamento reale.
//
// Logica: per n<=8 scanbody, prova tutte le n! permutazioni di matching B->A,
// calcola Kabsch e RMSD post-allineamento per ognuna, tiene la migliore. Per
// n=6 sono 720 prove, per n=7 sono 5040, per n=8 sono 40320: tutte sotto 100ms
// in JavaScript moderno con Kabsch su nuvole da pochi punti.
//
// Equivalente alla logica gia' validata server-side in icp_engine.robust_pre_align
// (v7.3.7.004 backend). Ritorna {R, t, applied} dove applied=true significa che
// e' stata trovata una permutazione migliore dell'identita' di almeno 1um.
function misICP_bruteForcePreAlign(centsA, centsB){
  var n = centsA.length;
  if(n !== centsB.length || n < 3 || n > 8){
    return { R: misICP_eye3(), t: [0,0,0], rmsd: Infinity, applied: false };
  }
  function _evalPerm(perm){
    var Bp = perm.map(function(idx){ return centsB[idx]; });
    var kb = misICP_kabsch(Bp, centsA); // R*Bp + t -> centsA
    var sumSq = 0;
    for(var i=0; i<n; i++){
      var rp = misICP_mv3(kb.R, Bp[i]);
      var dx = (rp[0] + kb.t[0]) - centsA[i][0];
      var dy = (rp[1] + kb.t[1]) - centsA[i][1];
      var dz = (rp[2] + kb.t[2]) - centsA[i][2];
      sumSq += dx*dx + dy*dy + dz*dz;
    }
    return { R: kb.R, t: kb.t, rmsd: Math.sqrt(sumSq / n) };
  }
  var idIdx = [];
  for(var k=0; k<n; k++) idIdx.push(k);
  var bestRes = _evalPerm(idIdx);
  var baselineRmsd = bestRes.rmsd;
  var bestPerm = idIdx.slice();
  // Heap's algorithm: genera tutte le n! permutazioni in-place
  function _heapPermute(arr, k){
    if(k === 1){
      var res = _evalPerm(arr);
      if(res.rmsd < bestRes.rmsd){
        bestRes = res;
        bestPerm = arr.slice();
      }
      return;
    }
    _heapPermute(arr, k-1);
    for(var i=0; i<k-1; i++){
      var swapAt = (k % 2 === 0) ? i : 0;
      var tmp = arr[swapAt]; arr[swapAt] = arr[k-1]; arr[k-1] = tmp;
      _heapPermute(arr, k-1);
    }
  }
  _heapPermute(idIdx.slice(), n);
  // Tolerance: applichiamo solo se ha migliorato di almeno 1um (1e-3 mm)
  // per evitare di perturbare casi gia' allineati con micro-rumore numerico.
  var improved = (bestRes.rmsd < baselineRmsd - 1e-3);
  return {
    R: bestRes.R,
    t: bestRes.t,
    rmsd: bestRes.rmsd,
    rmsdBaseline: baselineRmsd,
    perm: bestPerm,
    applied: improved,
    n: n
  };
}
function misICP_applyTform(tris,R,t){
  return tris.map(function(tri){
    return tri.map(function(v){
      var rv=misICP_mv3(R,v);
      return [rv[0]+t[0], rv[1]+t[1], rv[2]+t[2]];
    });
  });
}

function misICP_cylAxis(tris){
  if(!tris || tris.length<3) return [0,0,1];
  // Step 0: raccolgo tutti i vertici (con duplicati: la PCA e' invariante)
  var pts=[];
  tris.forEach(function(t){ t.forEach(function(v){ pts.push(v); }); });
  var n=pts.length;
  if(n<9) return [0,0,1];
  // Step 1: centroide
  var cx=0, cy=0, cz=0;
  pts.forEach(function(v){ cx+=v[0]/n; cy+=v[1]/n; cz+=v[2]/n; });
  var ptsc=pts.map(function(v){ return [v[0]-cx, v[1]-cy, v[2]-cz]; });
  // Step 2: PCA sui punti per asse approssimativo
  var cov=[[0,0,0],[0,0,0],[0,0,0]];
  ptsc.forEach(function(v){
    for(var i=0;i<3;i++) for(var j=0;j<3;j++) cov[i][j]+=v[i]*v[j]/n;
  });
  var eig=misICP_jacobi3(cov);
  var ord=[0,1,2].sort(function(a,b){ return eig.vals[b]-eig.vals[a]; });
  var ev0=eig.vals[ord[0]], ev1=eig.vals[ord[1]];
  // Se i due autovalori maggiori sono simili (ev1/ev0 > 0.6) il cilindro e'
  // tozzo: l'asse coincide col 3o autovettore (varianza minima).
  // Altrimenti il cilindro e' lungo: asse = 1o autovettore (varianza massima).
  var axIdx=(ev0>0 && ev1/ev0>0.6) ? ord[2] : ord[0];
  var axPCA=[eig.vecs[0][axIdx], eig.vecs[1][axIdx], eig.vecs[2][axIdx]];
  // Step 3: proietto i punti sull'asse PCA, prendo i due cap estremi
  var proj=ptsc.map(function(v){ return v[0]*axPCA[0]+v[1]*axPCA[1]+v[2]*axPCA[2]; });
  var pmin=proj.reduce(function(a,b){ return a<b?a:b; });
  var pmax=proj.reduce(function(a,b){ return a>b?a:b; });
  var H=pmax-pmin, thresh=H*0.18;
  var capTop=[], capBot=[];
  ptsc.forEach(function(v,i){
    if(proj[i]>pmax-thresh) capTop.push(v);
    else if(proj[i]<pmin+thresh) capBot.push(v);
  });
  // Step 4: PCA su ogni cap, normale = autovettore con varianza minima
  function capNormal(cap){
    if(cap.length<6) return null;
    var cc=[0,0,0];
    cap.forEach(function(v){ cc[0]+=v[0]/cap.length; cc[1]+=v[1]/cap.length; cc[2]+=v[2]/cap.length; });
    var cv=[[0,0,0],[0,0,0],[0,0,0]];
    cap.forEach(function(v){
      var d=[v[0]-cc[0], v[1]-cc[1], v[2]-cc[2]];
      for(var i=0;i<3;i++) for(var j=0;j<3;j++) cv[i][j]+=d[i]*d[j]/cap.length;
    });
    var eg=misICP_jacobi3(cv);
    var od=[0,1,2].sort(function(a,b){ return eg.vals[b]-eg.vals[a]; });
    return [eg.vecs[0][od[2]], eg.vecs[1][od[2]], eg.vecs[2][od[2]]];
  }
  var nTop=capNormal(capTop);
  var nBot=capNormal(capBot);
  if(!nTop && !nBot) return axPCA; // fallback
  if(!nTop) nTop=nBot;
  if(!nBot) nBot=nTop;
  // Allineo i due versori coerentemente con l'asse PCA
  if(nTop[0]*axPCA[0]+nTop[1]*axPCA[1]+nTop[2]*axPCA[2]<0){ nTop=[-nTop[0],-nTop[1],-nTop[2]]; }
  if(nBot[0]*axPCA[0]+nBot[1]*axPCA[1]+nBot[2]*axPCA[2]<0){ nBot=[-nBot[0],-nBot[1],-nBot[2]]; }
  // ── Asse cilindro cap-media (SEED): media normalizzata delle due normali cap ──
  var ax=[nTop[0]+nBot[0], nTop[1]+nBot[1], nTop[2]+nBot[2]];
  var len=Math.sqrt(ax[0]*ax[0]+ax[1]*ax[1]+ax[2]*ax[2])||1;
  ax=[ax[0]/len, ax[1]/len, ax[2]/len];   // seed cap-based normalizzato
  // ─── MOTORE ASSE ALTERNATIVO "lateral-wall" (setting syntesis_axis_engine) ───
  // Default 'cap': ritorna il seed cap-media (sopra), invariato. Con 'lateralwall'
  // il seed cap-media viene RAFFINATO dalla parete laterale del cilindro — piu'
  // stabile per scanbody con un solo cap pieno + parete (base aperta):
  //   1. per ogni triangolo: normale = cross(v1-v0,v2-v0), area = 0.5*|cross|
  //   2. tieni i laterali con |n_unit . seed| < 0.35 (scarta cap/disco)
  //   3. asse = minor eigenvector di M = Σ area_i (n_i n_iᵀ)  [= normali pesate
  //      √area in senso SVD], via misICP_jacobi3 (eigensolver 3x3, nessuna dep)
  //   4. riorienta concorde col seed. Fallback al seed se < 8 laterali validi.
  // 'auto' (default): lateral-wall solo per cilindro ALTO (H = altezza lungo l'asse
  // PCA, calcolata sopra come pmax-pmin). SR ~3.0mm -> H>2.4 -> lateral; 1T3 ~1.9 /
  // OS ~1.1 -> cap-media. 'lateralwall'/'cap' espliciti = invariati (8.13.0).
  var _useLateral = synAxisUseLateral(H > 2.4, 'cap');   // onThrow 'cap' = default-eccezione preservato
  if(_useLateral){
    var _M=[[0,0,0],[0,0,0],[0,0,0]], _usedLat=0;
    for(var _ti=0; _ti<tris.length; _ti++){
      var _t=tris[_ti], _v0=_t[0], _v1=_t[1], _v2=_t[2];
      // bordi e cross product -> normale (non normalizzata) + area
      var _e1x=_v1[0]-_v0[0], _e1y=_v1[1]-_v0[1], _e1z=_v1[2]-_v0[2];
      var _e2x=_v2[0]-_v0[0], _e2y=_v2[1]-_v0[1], _e2z=_v2[2]-_v0[2];
      var _crx=_e1y*_e2z-_e1z*_e2y, _cry=_e1z*_e2x-_e1x*_e2z, _crz=_e1x*_e2y-_e1y*_e2x;
      var _clen=Math.sqrt(_crx*_crx+_cry*_cry+_crz*_crz);
      if(_clen < 1e-12) continue;              // triangolo degenere
      var _area=0.5*_clen;
      var _nx=_crx/_clen, _ny=_cry/_clen, _nz=_crz/_clen;  // normale unitaria
      // banda assiale: scarta cap/disco (normale quasi parallela al seed)
      if(Math.abs(_nx*ax[0] + _ny*ax[1] + _nz*ax[2]) >= 0.35) continue;
      var _w=_area;   // peso area (covarianza Σ area·nnᵀ = √area-pesata in senso SVD; = POC findScanbodyCenter)
      _M[0][0]+=_w*_nx*_nx; _M[0][1]+=_w*_nx*_ny; _M[0][2]+=_w*_nx*_nz;
      _M[1][1]+=_w*_ny*_ny; _M[1][2]+=_w*_ny*_nz; _M[2][2]+=_w*_nz*_nz;
      _usedLat++;
    }
    if(_usedLat >= 8){
      _M[1][0]=_M[0][1]; _M[2][0]=_M[0][2]; _M[2][1]=_M[1][2];   // simmetria
      var _eig=misICP_jacobi3(_M);
      var _mi=0;
      if(_eig.vals[1] < _eig.vals[_mi]) _mi=1;
      if(_eig.vals[2] < _eig.vals[_mi]) _mi=2;
      var _la=[_eig.vecs[0][_mi], _eig.vecs[1][_mi], _eig.vecs[2][_mi]];  // minor eigenvector
      var _ll=Math.sqrt(_la[0]*_la[0]+_la[1]*_la[1]+_la[2]*_la[2]);
      if(_ll > 1e-6){
        _la[0]/=_ll; _la[1]/=_ll; _la[2]/=_ll;
        if(_la[0]*ax[0]+_la[1]*ax[1]+_la[2]*ax[2] < 0){ _la=[-_la[0],-_la[1],-_la[2]]; }
        ax=_la;   // asse raffinato dalla parete laterale
      }
    }
    // _usedLat < 8 (o eigenvector degenere): ax resta = seed cap-media
  }
  return ax;
}
function misICP_axisAngleDeg(a,b){
  if(!a || !b) return 0;
  var d=a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  if(d<0) d=-d;
  d=Math.min(1,Math.max(-1,d));
  return Math.acos(d)*180/Math.PI;
}

// === Connessione clinica (Misurare, beta 8.64.x) ============================
// La connessione clinica e' a capZ sotto il cap occlusale, lungo l'asse del
// cilindro (schema canonico Replace-iT: cap al click, connessione a click-capZ;
// vedi placeMUA ~3013). Misurare non posa MUA: qui auto-rileviamo il tipo dal
// raggio e calcoliamo il punto = centroide - (capZ - delta)*asse_capward.
// ORIENTAMENTO (beta): "capward = estremo con MENO area di facce piatte", cioe'
// lontano dal disco/base (faccia piatta dominante negli export Sostituire).
// Validato su OS (id 2770, tutti e 6). 1T3/SR: da verificare live (il cap
// occlusale ampio puo' competere col disco -> eventuale flip).
function misICP_detectSbType(tris){
  if(!tris || tris.length<3) return null;
  var ax = misICP_cylAxis(tris);
  var cx=0,cy=0,cz=0,n=0;
  tris.forEach(function(t){ t.forEach(function(v){ cx+=v[0];cy+=v[1];cz+=v[2];n++; }); });
  cx/=n; cy/=n; cz/=n;
  var rs=[];
  tris.forEach(function(t){ t.forEach(function(v){
    var dx=v[0]-cx,dy=v[1]-cy,dz=v[2]-cz, pr=dx*ax[0]+dy*ax[1]+dz*ax[2];
    var ex=dx-pr*ax[0], ey=dy-pr*ax[1], ez=dz-pr*ax[2];
    rs.push(Math.sqrt(ex*ex+ey*ey+ez*ez));
  }); });
  rs.sort(function(a,b){return a-b;});
  var radius = rs[Math.floor(rs.length/2)];          // raggio = mediana dist. dall'asse
  var SB = (window.SYN && window.SYN.scanbody) || null;
  var best=null;
  ['1T3','OS','SR'].forEach(function(k){
    var t = SB && SB[k]; if(!t) return;
    var err = Math.abs(radius - t.radius_mm)/t.radius_mm;
    if(best===null || err<best.err) best={type:k, err:err, capZ:t.cap_z_mm, radius:t.radius_mm};
  });
  return best;                                         // {type, capZ, radius, err}
}
// Orienta l'asse verso il CAP occlusale = estremo con PIU' area di facce piatte
// (il cap occlusale e' la faccia piatta che lo scanner legge / il disco del template;
//  la base/connessione e' l'estremo OPPOSTO). La connessione = capZ sotto il cap,
//  quindi opposta al top. [8.64.1: corretto da "MENO" a "PIU'" — la regola precedente
//  orientava la connessione dalla parte sbagliata, verso il top invece che verso
//  l'impianto; segnalato dall'utente con screenshot del workflow Misurare.]
function misICP_orientCapward(tris, centroid, axis){
  var aPos=0, aNeg=0, cen=centroid;
  tris.forEach(function(t){
    var ux=t[1][0]-t[0][0],uy=t[1][1]-t[0][1],uz=t[1][2]-t[0][2];
    var vx=t[2][0]-t[0][0],vy=t[2][1]-t[0][1],vz=t[2][2]-t[0][2];
    var nx=uy*vz-uz*vy, ny=uz*vx-ux*vz, nz=ux*vy-uy*vx;
    var L=Math.sqrt(nx*nx+ny*ny+nz*nz); if(L<1e-12) return;
    if(Math.abs((nx*axis[0]+ny*axis[1]+nz*axis[2])/L) < 0.85) return;  // solo facce piatte
    var mx=(t[0][0]+t[1][0]+t[2][0])/3-cen[0];
    var my=(t[0][1]+t[1][1]+t[2][1])/3-cen[1];
    var mz=(t[0][2]+t[1][2]+t[2][2])/3-cen[2];
    if((mx*axis[0]+my*axis[1]+mz*axis[2])>=0) aPos+=0.5*L; else aNeg+=0.5*L;
  });
  return (aPos>=aNeg) ? [axis[0],axis[1],axis[2]] : [-axis[0],-axis[1],-axis[2]];
}
// [SR] Orienta capward verso il cap occlusale = disco PIENO (rmin~0). I due dischi dell'SR
// sostituito hanno AREA uguale (gemelli) -> orientCapward per-area tira a indovinare (ribaltava
// 3 marker su 6). Discriminante affidabile: cap occlusale pieno (template SR rmin 0.09; export
// 0.025) vs base/connessione con sede-vite (rmin 0.146) -> 5.8x, netto su tutti e 6. Gate
// validato: SR+OS+1T3 sullo stesso impianto -> connessioni coincidenti <1µm. Fallback: se un
// solo estremo ha facce piatte (scan reale, base aperta) -> quello e' il cap.
function misICP_orientCapwardSolid(tris, centroid, axis){
  // 8.69.4: rilevamento cap ROBUSTO. Il cap e' l'ESTREMO con piu' AREA di superficie VICINO
  // all'asse (= disco PIENO); la base e' aperta (anello) -> nessuna superficie centrale.
  // Indipendente dal flat-face: il vecchio gate |normale.asse|>0.85 falliva sul cap SCANSIONATO
  // (lo scanner intraorale arrotonda il disco -> normali sparse -> nessuna faccia "piatta" ->
  // ramo 'no-disco' -> verso CASUALE del PCA). Era la radice del flip/posizione errata della
  // connessione (verificato sui file: template -> connA cadeva a -7.572 invece che a 0; 6/6
  // scanbody reali col cap orientati a caso). Misuro le bande dei DUE ESTREMI assiali (non dal
  // centroide: il disco-cap pesante sposta il centroide verso il cap, escludendo le sue facce).
  var aL=Math.sqrt(axis[0]*axis[0]+axis[1]*axis[1]+axis[2]*axis[2])||1;
  var ax=[axis[0]/aL,axis[1]/aL,axis[2]/aL];
  var i, t, axL=[], radL=[], arL=[], hi=-1e9, lo=1e9;
  for(i=0;i<tris.length;i++){
    t=tris[i];
    var ux=t[1][0]-t[0][0],uy=t[1][1]-t[0][1],uz=t[1][2]-t[0][2];
    var vx=t[2][0]-t[0][0],vy=t[2][1]-t[0][1],vz=t[2][2]-t[0][2];
    var nx=uy*vz-uz*vy, ny=uz*vx-ux*vz, nz=ux*vy-uy*vx;
    var area=0.5*Math.sqrt(nx*nx+ny*ny+nz*nz); if(area<1e-12) continue;
    var mx=(t[0][0]+t[1][0]+t[2][0])/3-centroid[0];
    var my=(t[0][1]+t[1][1]+t[2][1])/3-centroid[1];
    var mz=(t[0][2]+t[1][2]+t[2][2])/3-centroid[2];
    var axial=mx*ax[0]+my*ax[1]+mz*ax[2];
    var rx=mx-axial*ax[0], ry=my-axial*ax[1], rz=mz-axial*ax[2];
    var rad=Math.sqrt(rx*rx+ry*ry+rz*rz);
    axL.push(axial); radL.push(rad); arL.push(area);
    if(axial>hi) hi=axial; if(axial<lo) lo=axial;
  }
  var NEAR=1.0, BAND=0.7, topA=0, botA=0;   // mm: vicino-asse (cilindro R~2.0) e banda all'estremo
  for(i=0;i<axL.length;i++){
    if(radL[i]>=NEAR) continue;
    if(axL[i]>hi-BAND) topA+=arL[i];
    else if(axL[i]<lo+BAND) botA+=arL[i];
  }
  if(topA<0.05 && botA<0.05) return [ax[0],ax[1],ax[2]];   // tubo/ambiguo: deterministico (verso PCA)
  return (topA>botA) ? [ax[0],ax[1],ax[2]] : [-ax[0],-ax[1],-ax[2]];  // cap = estremo col disco pieno
}
// 8.68.3: delta cap (centroide -> piano cap occlusale) = 98° percentile della proiezione dei
// vertici sull'asse capward. Estratto in helper: la connessione deve usare UN SOLO delta (quello
// del RIFERIMENTO A) per A e B, altrimenti geometrie diverse danno connessioni divergenti.
function misICP_capDelta(tris, centroid, axisCapward){
  var proj=[];
  tris.forEach(function(t){ t.forEach(function(v){
    proj.push((v[0]-centroid[0])*axisCapward[0]+(v[1]-centroid[1])*axisCapward[1]+(v[2]-centroid[2])*axisCapward[2]);
  }); });
  proj.sort(function(a,b){return a-b;});
  return proj[Math.floor(proj.length*0.98)];           // centroide -> piano cap
}

// Punto di connessione lungo l'asse, capZ sotto il piano del cap occlusale. delta = cap->centroide
// (passato dal chiamante: stesso valore per A e B -> connessione consistente, vedi misICP run).
function misICP_connectionPoint(centroid, axisCapward, capZ, delta){
  var L = capZ - delta;                                // centroide -> connessione
  return [centroid[0]-L*axisCapward[0], centroid[1]-L*axisCapward[1], centroid[2]-L*axisCapward[2]];
}

// --- UI: CARICAMENTO FILE STL ---
function misICP_onDrop(e,side){
  e.preventDefault();
  e.stopPropagation();   // 8.80.4: senza, il drop bolliva fino al listener document-level che ricaricava il file una SECONDA volta come scanMesh di Analizza nella scena condivisa
  // 8.80.4 (review): lo stopPropagation impedisce anche al listener document di
  // togliere 'active' a #dropOverlay -> va rimossa QUI, altrimenti l'overlay blu
  // full-screen resta sovraimpresso dopo ogni drop sugli slot A/B.
  var _ov=document.getElementById('dropOverlay');
  if(_ov) _ov.classList.remove('active');
  var dz=document.getElementById('misDz'+side);
  if(dz) dz.classList.remove('ov');
  var f=e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if(f && /\.stl$/i.test(f.name)) misICP_setFile(side,f);
}
function misICP_onPick(e,side){
  var f=e.target && e.target.files && e.target.files[0];
  if(f) misICP_setFile(side,f);
}
function misICP_setFile(side,f){
  var r=new FileReader();
  r.onload=function(ev){
    if(side==='A'){ misICP_stlA=ev.target.result; misICP_nameA=f.name; }
    else          { misICP_stlB=ev.target.result; misICP_nameB=f.name; }
    synLog('misurare','file caricato', {slot:side, name:f.name, MB:+(ev.target.result.byteLength/1048576).toFixed(2)});
    var dz=document.getElementById('misDz'+side);
    var hint=document.getElementById('misDz'+side+'Hint');
    var meta=document.getElementById('misDz'+side+'Meta');
    if(dz)   dz.classList.add('ok');
    if(hint) hint.textContent=f.name;
    if(meta) meta.textContent=(ev.target.result.byteLength/1024/1024).toFixed(2)+' MB';
    misICP_updateRunBtn();
    misICP_clearError();
  };
  r.onerror=function(){ misICP_showError('Errore lettura file: '+f.name); };
  r.readAsArrayBuffer(f);
}
function misICP_updateRunBtn(){
  var b=document.getElementById('misBtnRun');
  if(!b) return;
  if(misICP_stlA && misICP_stlB){ b.classList.add('on'); b.disabled=false; }
  else                          { b.classList.remove('on'); b.disabled=true; }
}
function misICP_showError(msg){
  var el=document.getElementById('misErr');
  if(el){ el.textContent=msg; el.style.display=''; }
}
function misICP_clearError(){
  var el=document.getElementById('misErr');
  if(el){ el.textContent=''; el.style.display='none'; }
}

function misICP_clinLevel(um){
  for(var i=0;i<MIS_CLIN.length;i++){ if(um<MIS_CLIN[i].max) return MIS_CLIN[i]; }
  return MIS_CLIN[MIS_CLIN.length-1];
}

function misICP_clinAx(deg){
  for(var i=0;i<MIS_CLIN_AX.length;i++){ if(deg<MIS_CLIN_AX[i].max) return MIS_CLIN_AX[i]; }
  return MIS_CLIN_AX[MIS_CLIN_AX.length-1];
}

// --- MATCHING A-B nearest-neighbor greedy (come mPairs del Comparator) ---
function misICP_matchPairs(centsA, centsB){
  var used={};
  return centsA.map(function(a,iA){
    var iB=-1, bd=Infinity;
    for(var j=0;j<centsB.length;j++){
      if(used[j]) continue;
      var b=centsB[j];
      var d=Math.hypot(a[0]-b[0], a[1]-b[1], a[2]-b[2]);
      if(d<bd){ bd=d; iB=j; }
    }
    if(iB>=0) used[iB]=1;
    if(iB<0) return { iA:iA, iB:-1, cA:a, cB:null, dx:null, dy:null, dz:null, dxy:null, d3:null };
    var b=centsB[iB];
    var dx=b[0]-a[0], dy=b[1]-a[1], dz=b[2]-a[2];
    return { iA:iA, iB:iB, cA:a, cB:b, dx:dx, dy:dy, dz:dz, dxy:Math.hypot(dx,dy), d3:Math.hypot(dx,dy,dz) };
  });
}

function misICP_run(){
  if(!misICP_stlA || !misICP_stlB) return;
  var btn=document.getElementById('misBtnRun');
  if(btn){ btn.classList.add('busy'); btn.textContent='Parsing e allineamento in corso...'; }
  misICP_clearError();
  // Async per non bloccare UI durante parsing/ICP (che possono durare qualche secondo)
  setTimeout(function(){
    try {
      // 8.70.1: click-to-seed (redesign DIRETTO). Se l'utente ha cliccato gli scanbody su un file
      // (scansione con tessuti), misICP_clickSeeds = {file, centers, axes} dai click (findScanbodyCenter).
      // Li uso DIRETTAMENTE come centroidi+assi di quel file, bypassando il rilevamento auto (che non
      // isola scanbody saldati alla gengiva). Consumato 1-volta. (8.70.0 crop-and-clean perdeva punti -> rimosso.)
      var _seeds=misICP_clickSeeds; misICP_clickSeeds=null;
      // 1. Parsing STL
      var triA=misICP_pSTL(misICP_stlA);
      var triB=misICP_pSTL(misICP_stlB);
      if(!triA.length) throw new Error('File A: nessun triangolo rilevato');
      if(!triB.length) throw new Error('File B: nessun triangolo rilevato');

      // 2. Componenti connessi (ogni scanbody e/o l'arcata gengivale sono componenti)
      var compsA=misICP_comps(triA);
      var compsB=misICP_comps(triB);
      if(compsA.length===0) throw new Error('File A: nessun componente connesso (servono scanbody)');
      if(compsB.length===0) throw new Error('File B: nessun componente connesso (servono scanbody)');

      // 3. Partiziono: scanbody (piccoli, < 15mm bbox) vs background (arcata/gengiva)
      var partA=misICP_partition(triA, compsA);
      var partB=misICP_partition(triB, compsB);
      if(partA.scan.length===0) throw new Error('File A: nessuno scanbody rilevato (componenti troppo grandi)');
      if(!(_seeds&&_seeds.file==='B') && partB.scan.length===0) throw new Error('File B: nessuno scanbody rilevato (componenti troppo grandi). Se la scansione ha tessuti, usa "Clicca gli scanbody".');

      // 4. CLUSTERING: uno scanbody reale puo' essere composto da piu' componenti
      //    (cilindro + disco di flangia). Raggruppo le componenti vicine.
      var rawCentsA = partA.scan.map(function(ci){return misICP_cen(triA, compsA[ci]);});
      var rawCentsB = partB.scan.map(function(ci){return misICP_cen(triB, compsB[ci]);});
      var threshA = misICP_autoThresh(rawCentsA);
      var threshB = misICP_autoThresh(rawCentsB);
      // Uso la soglia comune (la piu' conservativa) per essere coerenti tra A e B
      var thresh = Math.max(threshA, threshB);
      var clustersA = misICP_clusterComps(rawCentsA, thresh); // array di array di indici in partA.scan
      var clustersB = misICP_clusterComps(rawCentsB, thresh);

      // 4b. Centroidi dei CLUSTER (= centroidi degli scanbody reali, fusi)
      // 8.70.1: seed diretto — se il file e' stato cliccato, centroidi+assi vengono dai click (non dal clustering)
      var _seedAxA=null, _seedAxB=null;
      var scanCentsA = (_seeds&&_seeds.file==='A') ? _seeds.centers.map(function(c){return c.slice();}) : clustersA.map(function(cl){ return misICP_clusterCentroid(triA, compsA, partA.scan, cl); });
      var scanCentsB = (_seeds&&_seeds.file==='B') ? _seeds.centers.map(function(c){return c.slice();}) : clustersB.map(function(cl){ return misICP_clusterCentroid(triB, compsB, partB.scan, cl); });
      if(_seeds&&_seeds.file==='A') _seedAxA=_seeds.axes;
      if(_seeds&&_seeds.file==='B') _seedAxB=_seeds.axes;
      try { synLog('misICP','RUN start', {fileA:misICP_nameA, fileB:misICP_nameB, seed:!!_seeds, seedFile:(_seeds?_seeds.file:null), nA:scanCentsA.length, nB:scanCentsB.length, autoCompA:compsA.length, autoCompB:compsB.length, autoScanA:partA.scan.length, autoScanB:partB.scan.length}); } catch(_e){}
      if(scanCentsA.length===0) throw new Error('File A: nessuno scanbody rilevato dopo clustering.');
      if(scanCentsB.length===0) throw new Error('File B: nessuno scanbody rilevato dopo clustering.');

      // 5. PRE-ALIGN brute-force (v7.3.9.093, PATCH G in JS): risolve la
      //    rotational ambiguity per scanbody simmetrici (SR/RS) ruotati >60
      //    gradi tra A e B. Per n<=8, prova tutte le n! permutazioni di
      //    matching e tiene la migliore. Costo: <100ms anche per n=8 (40320
      //    Kabsch su 8 punti). Se nessuna permutazione migliora rispetto
      //    all'identita', applied=false e l'ICP riceve i centroidi originali.
      var preAlign = misICP_bruteForcePreAlign(scanCentsA, scanCentsB);
      // 8.67.2 FIX: applica SEMPRE il miglior fit rigido del brute-force come stato
      // iniziale dell'ICP, non solo quando una permutazione batte l'identita'
      // (vecchio preAlign.applied). Se l'identita' E' gia' la perm corretta ma i due
      // frame (scanner diversi) sono ruotati, bestRes e' comunque il fit globale giusto
      // (~30um): scartarlo faceva ripartire l'ICP nearest-neighbor dai centroidi GREZZI
      // -> minimo locale (RMSD scala-mm, rotazione XY). preUsable = il brute-force ha
      // prodotto un fit valido (n in [3..8]); fail-soft ai grezzi solo se non utilizzabile.
      var preUsable = (preAlign.n >= 3 && preAlign.n <= 8 && isFinite(preAlign.rmsd));
      var scanCentsBpre;
      if(preUsable){
        scanCentsBpre = scanCentsB.map(function(p){
          var rp = misICP_mv3(preAlign.R, p);
          return [rp[0]+preAlign.t[0], rp[1]+preAlign.t[1], rp[2]+preAlign.t[2]];
        });
        try {
          console.log('[Misurare pre-align] n=' + preAlign.n + ' baseline=' +
                      (preAlign.rmsdBaseline*1000).toFixed(1) + 'um -> best=' +
                      (preAlign.rmsd*1000).toFixed(1) + 'um perm=' + JSON.stringify(preAlign.perm) +
                      ' (applicato sempre; migliora-identita=' + preAlign.applied + ')');
        } catch(_){}
      } else {
        scanCentsBpre = scanCentsB;
        try {
          var _na = scanCentsA.length, _nb = scanCentsB.length;
          var _reason = (_na !== _nb || _na < 3 || _na > 8)
            ? 'count-mismatch (n fuori 3..8 o A!=B)'
            : 'rmsd-non-finito (fit degenere)';
          console.warn('[Misurare pre-align] NON applicato (' + _reason +
            '): scanCentsA.length=' + _na + ', scanCentsB.length=' + _nb +
            ', n=' + (preAlign.n != null ? preAlign.n : 'n/a') +
            ', rmsd=' + (isFinite(preAlign.rmsd) ? (preAlign.rmsd*1000).toFixed(1) + 'um' : 'Inf'));
        } catch(_){}
      }

      // 5b. ICP tra i centroidi dei CLUSTER (gia' pre-allineati dal brute-force)
      var icpRes = misICP_runICP(scanCentsA, scanCentsBpre, 60);
      // 8.67.2 guard: se l'ICP nearest-neighbor PEGGIORA il pre-align (puo' divergere su
      // cluster quasi-simmetrici), scarta l'ICP e tieni il pre-align gia' ottimo.
      if(preUsable && icpRes.rmsd > preAlign.rmsd){
        icpRes = { R: misICP_eye3(), t: [0,0,0], aligned: scanCentsBpre, rmsd: preAlign.rmsd, angle: 0 };
      }

      // 5c. Compongo la trasformazione TOTALE: T_total = T_icp * T_pre.
      //     R_total = R_icp * R_pre,    t_total = R_icp * t_pre + t_icp
      //     L'angolo va ricalcolato dalla R combinata.
      if(preUsable){
        var Rcomb = misICP_mul3(icpRes.R, preAlign.R);
        var Rt_pre = misICP_mv3(icpRes.R, preAlign.t);
        var tcomb = [Rt_pre[0]+icpRes.t[0], Rt_pre[1]+icpRes.t[1], Rt_pre[2]+icpRes.t[2]];
        var trCombined = Rcomb[0][0]+Rcomb[1][1]+Rcomb[2][2];
        var angleComb = Math.acos(Math.min(1,Math.max(-1,(trCombined-1)/2)))*180/Math.PI;
        icpRes = { R: Rcomb, t: tcomb, aligned: icpRes.aligned, rmsd: icpRes.rmsd, angle: angleComb };
      }

      // 6. Trasformo TUTTI i triangoli di B (scanbody + arcata) con la matrice ICP
      var triBt=misICP_applyTform(triB, icpRes.R, icpRes.t);
      var scanCentsBt=scanCentsB.map(function(p){
        var rp=misICP_mv3(icpRes.R,p);
        return [rp[0]+icpRes.t[0], rp[1]+icpRes.t[1], rp[2]+icpRes.t[2]];
      });

      // 7. Matching scanbody A <-> B sui centroidi post-ICP
      var pairs=misICP_matchPairs(scanCentsA, scanCentsBt);

      // 8. Per ogni pair calcolo asse scanbody A e B post-ICP, angolo, livello clinico.
      //    trisA e trisBt sono i triangoli dell'INTERO cluster (cilindro+disco uniti).
      pairs.forEach(function(p, localIdx){
        if(_seedAxA){ p.axA = _seedAxA[p.iA].slice(); p.trisA = null; }   // 8.70.1: asse cliccato (A non trasformato)
        else { var trisOfA = misICP_clusterTris(triA, compsA, partA.scan, clustersA[p.iA]); p.trisA = trisOfA; p.axA = misICP_cylAxis(trisOfA); }
        if(p.iB >= 0){
          if(_seedAxB){
            // 8.70.1: asse cliccato (findScanbodyCenter) trasformato dall'ICP — NIENTE PCA su crop sporco di gengiva (era il bug dei 34deg)
            var _ra=misICP_mv3(icpRes.R, _seedAxB[p.iB]); var _ral=Math.hypot(_ra[0],_ra[1],_ra[2])||1;
            p.axBt=[_ra[0]/_ral,_ra[1]/_ral,_ra[2]/_ral]; p.trisBt=null;
          } else {
          // Per B uso compsB con i triangoli gia' trasformati (triBt)
          var trisOfBt = misICP_clusterTris(triBt, compsB, partB.scan, clustersB[p.iB]);
          p.trisBt = trisOfBt;
          p.axBt = misICP_cylAxis(trisOfBt);
          }
          p.axAngleDeg = (p.axA && p.axBt) ? misICP_axisAngleDeg(p.axA, p.axBt) : 0;
          p.d3um  = p.d3  * 1000;
          p.dxyum = p.dxy * 1000;
          p.dxum  = p.dx  * 1000;
          p.dyum  = p.dy  * 1000;
          p.dzum  = p.dz  * 1000;
          p.level = misICP_clinLevel(Math.round(p.d3um));
          p.axLevel = misICP_clinAx(p.axAngleDeg);
          // --- Connessione clinica (beta): capZ sotto il cap, lungo l'asse ---
          var _sb = misICP_detectSbType(trisOfA);
          if(_sb){
            var _cenA = scanCentsA[p.iA], _cenB = scanCentsBt[p.iB];
            var _solid = (_sb.type === 'SR');   // [SR] dischi gemelli per area -> orienta sul disco PIENO
            var _axAc = _solid ? misICP_orientCapwardSolid(trisOfA,  _cenA, p.axA) : misICP_orientCapward(trisOfA,  _cenA, p.axA);
            // 8.70.3: nel click-seed trisOfBt e' undefined (niente triangoli di B segmentati) -> orientCapward
            // esplodeva (tris.forEach su undefined). L'asse cliccato (findScanbodyCenter, gia' capward) e' il fallback.
            var _axBc = trisOfBt ? (_solid ? misICP_orientCapwardSolid(trisOfBt, _cenB, p.axBt) : misICP_orientCapward(trisOfBt, _cenB, p.axBt)) : p.axBt.slice();
            if(_axBc[0]*_axAc[0]+_axBc[1]*_axAc[1]+_axBc[2]*_axAc[2] < 0) _axBc=[-_axBc[0],-_axBc[1],-_axBc[2]];
            p.sbType = _sb.type;
            p.connCapZ = _sb.capZ; p.connAxA = _axAc; p.connAxB = _axBc;  // per il render (Inc-2)
            // 8.69.0 (DATUM = ORIGINE): la connessione/origine = (0,0,0) del CAD IPD = piattaforma
            // implantare = il punto dove l'utente misura la deriva. origine = centroide - L*asseCapward,
            // L per-tipo dal CAD (MIS_ORIGIN_OFFSET), UGUALE per A e B -> niente ghost geometria-dipendente
            // (supera l'interim 8.68.3 delta-da-A, che ancorava al cap rilevato). Fallback al cap-fit se
            // tipo ignoto. Verificato offline id2161: origine-dev == centroide-dev +-1µm (asse ~0.02°).
            var _L = (MIS_ORIGIN_OFFSET[_sb.type]!=null) ? MIS_ORIGIN_OFFSET[_sb.type]
                       : (_sb.capZ - misICP_capDelta(trisOfA, _cenA, _axAc));
            p.connOriginL = _L;
            p.connA = [_cenA[0]-_L*_axAc[0], _cenA[1]-_L*_axAc[1], _cenA[2]-_L*_axAc[2]];
            p.connB = [_cenB[0]-_L*_axBc[0], _cenB[1]-_L*_axBc[1], _cenB[2]-_L*_axBc[2]];
            var _cdx=(p.connB[0]-p.connA[0])*1000, _cdy=(p.connB[1]-p.connA[1])*1000, _cdz=(p.connB[2]-p.connA[2])*1000;
            p.connDxum=_cdx; p.connDyum=_cdy; p.connDzum=_cdz;
            p.connDxyum=Math.sqrt(_cdx*_cdx+_cdy*_cdy);
            p.connD3um =Math.sqrt(_cdx*_cdx+_cdy*_cdy+_cdz*_cdz);
            p.connLevel=misICP_clinLevel(Math.round(p.connD3um));
            // 8.69.0: la MISURA per-marker (|D| report/scena/PDF) ora e' all'ORIGINE (datum), non al
            // centroide. deriva = origine_B - origine_A. L'allineamento globale resta sui centroidi
            // (offline id2161: origine-dev == centroide-dev +-1µm). Override di p.d* e p.d*um.
            p.dx=_cdx/1000; p.dy=_cdy/1000; p.dz=_cdz/1000; p.dxy=p.connDxyum/1000; p.d3=p.connD3um/1000;
            p.dxum=_cdx; p.dyum=_cdy; p.dzum=_cdz; p.dxyum=p.connDxyum; p.d3um=p.connD3um;
            p.level=misICP_clinLevel(Math.round(p.d3um));
            // [8.66.4 DIAG centro-vs-asse] decompone il residuo: il cap-baricentro (= centro di
            // posa, leva ~0) e' l'errore di CENTRO; il centroide (leva ~0.43mm) e la connessione
            // (leva ~capZ) aggiungono il tilt d'asse. Se cap-dev ~ centroide-dev -> e' il CENTRO;
            // se cap-dev ~0 ma centroide grande -> e' l'ASSE. Solo console.log, zero comportamento.
          } else {
            p.sbType=null; p.connA=null; p.connB=null;
            p.connD3um=null; p.connDxum=null; p.connDyum=null; p.connDzum=null; p.connDxyum=null; p.connLevel=null;
          }
        } else {
          p.axBt=null; p.trisBt=null; p.axAngleDeg=0;
          p.d3um=null; p.dxyum=null; p.dxum=null; p.dyum=null; p.dzum=null;
          p.level=null; p.axLevel=null;
          p.sbType=null; p.connA=null; p.connB=null;
          p.connD3um=null; p.connDxum=null; p.connDyum=null; p.connDzum=null; p.connDxyum=null; p.connLevel=null;
        }
      });

      // 8b. Triangoli dell'arcata/background di A (tutte le componenti non-scanbody)
      var bgTrisA=[];
      partA.bg.forEach(function(ci){ compsA[ci].forEach(function(i){bgTrisA.push(triA[i]);}); });
      // 8c. Triangoli dell'arcata/background di B post-ICP (uso triBt gia' trasformato)
      var bgTrisB=[];
      if(_seedAxB){ bgTrisB=triBt; }   // 8.70.1: seed B -> mostra l'INTERA scansione trasformata (nessuna segmentazione di B)
      else { partB.bg.forEach(function(ci){ compsB[ci].forEach(function(i){bgTrisB.push(triBt[i]);}); }); }

      // 8. Metriche aggregate
      var nMatch=pairs.filter(function(p){return p.iB>=0;}).length;
      var angleSum=0, angleCount=0;
      pairs.forEach(function(p){
        if(p.axAngleDeg!=null && p.iB>=0){ angleSum+=p.axAngleDeg; angleCount++; }
      });
      var avgAngle = angleCount ? (angleSum/angleCount) : 0;
      var rmsdUm = icpRes.rmsd * 1000;
      var penRmsd = Math.min(50, rmsdUm/10);
      var penAngle = Math.min(30, avgAngle*10);
      // v7.3.9.082: SCORE PRELIMINARE rapido durante ICP, NON e' il punteggio canonico.
      // Il valore canonico viene calcolato da misICP_score() (Syntesis Score v1.0)
      // a fine pipeline e SOSTITUISCE questo. Vedi L5256 per la formula canonica.
      var score = Math.max(0, 100 - penRmsd - penAngle);
      var scoreLabel = score>=90 ? 'Eccellente' : score>=75 ? 'Buono' : score>=55 ? 'Accettabile' : score>=35 ? 'Verifica' : 'Critico';

      // 9. Salva stato
      misICP_trisA=triA;
      misICP_trisB=triBt;
      misICP_result={
        rmsd: icpRes.rmsd, rmsdUm: rmsdUm,
        R: icpRes.R, t: icpRes.t,
        nCyl: nMatch,
        avgAngle: avgAngle,
        score: score, scoreLabel: scoreLabel,
        pairs: pairs,
        compsA: compsA, compsB: compsB,
        partA: partA, partB: partB,
        bgTrisA: bgTrisA,
        bgTrisB: bgTrisB,
        scanCentsA: scanCentsA, scanCentsBt: scanCentsBt,
        fileA: misICP_nameA, fileB: misICP_nameB
      };

      // 10. Render mesh per-cilindro + arcate A/B
      //     (arcata A solida, arcata B trasparente; dischi A arancio, dischi B blu)
      misICP_renderPerCylinder(pairs, bgTrisA, bgTrisB);

      // 10b. Sincronizzo il tree Scena (CATIA-style) con i default e lo mostro
      misICP_resetTreeDefaults();
      misICP_updateTreeBadges();
      misICP_showTree();

      // 11. Riepilogo header
      document.getElementById('misSumN').textContent=String(nMatch);
      document.getElementById('misSumRmsd').textContent=rmsdUm.toFixed(1)+' um';
      document.getElementById('misSumAng').textContent=avgAngle.toFixed(2)+' gradi';
      document.getElementById('misSumScore').textContent=score.toFixed(1);
      document.getElementById('misSumLabel').textContent=scoreLabel;
      document.getElementById('misSummary').style.display='';

      // 12. Elenco scanbody nel pannello destro
      misICP_renderScanbodyList(pairs);
      document.getElementById('misScbListWrap').style.display='';

      // 12b. Label 3D sopra ogni scanbody nel viewport
      misICP_createLabels();

      // 12c. Popolo il selettore del pannello cutview
      misICP_populateCutSelect();

      // 13. Nasconde stage placeholder
      var stage=document.getElementById('misurareStage');
      if(stage) stage.classList.add('hidden');

      try { synLog('misICP','ALLINEAMENTO completato', { seed:!!_seeds, seedFile:(_seeds?_seeds.file:null), nCyl:nMatch, rmsdUm:+rmsdUm.toFixed(1), avgAngleDeg:+avgAngle.toFixed(2), score:+score.toFixed(1), nA:scanCentsA.length, nB:scanCentsB.length, perMarker:pairs.map(function(p){return {iA:p.iA,iB:p.iB,d3um:(p.d3um!=null?Math.round(p.d3um):null),axDeg:(p.axAngleDeg!=null?+p.axAngleDeg.toFixed(2):null)};}) }); } catch(_e){}
      showStatus((window.SYN && window.SYN.expert) ? ('ICP completato. RMSD '+rmsdUm.toFixed(1)+' um, '+nMatch+' cilindri.') : ('Allineamento completato: '+nMatch+' scanbody accoppiati.'));
    }
    catch(err){
      try { synLog('misICP','ALLINEAMENTO ERRORE', { err:(err && err.message ? err.message : String(err)), stack:(err && err.stack ? String(err.stack).split('\n').slice(0,3).join(' | ') : null) }); } catch(_e){}
      console.error('[Misurare] ICP fallito:', err);
      misICP_showError(err.message || 'Errore durante allineamento ICP.');
    }
    finally {
      var btn=document.getElementById('misBtnRun');
      if(btn){ btn.classList.remove('busy'); btn.textContent='Esegui allineamento ICP'; }
    }
  }, 40);
}

// --- MESH THREE.JS PER MISURARE (A blu, B arancione) ---
function misICP_buildMesh(tris,colorHex){
  // Costruisce BufferGeometry da array di triangoli [[[x,y,z],[x,y,z],[x,y,z]], ...]
  var n=tris.length;
  var pos=new Float32Array(n*9);
  for(var i=0;i<n;i++){
    var t=tris[i];
    pos[i*9+0]=t[0][0]; pos[i*9+1]=t[0][1]; pos[i*9+2]=t[0][2];
    pos[i*9+3]=t[1][0]; pos[i*9+4]=t[1][1]; pos[i*9+5]=t[1][2];
    pos[i*9+6]=t[2][0]; pos[i*9+7]=t[2][1]; pos[i*9+8]=t[2][2];
  }
  var geo=new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos,3));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  var mat=new THREE.MeshPhongMaterial({
    color: colorHex,
    specular: 0x222222,
    shininess: 30,
    transparent: true,
    opacity: 0.72,
    side: THREE.DoubleSide
  });
  return new THREE.Mesh(geo,mat);
}
function misICP_renderMeshes(){
  // Retrocompatibilita': se qualche chiamata residua usa il nome vecchio, deleghiamo.
  if(misICP_result && misICP_result.pairs) misICP_renderPerCylinder(misICP_result.pairs);
}

function misICP_seedToggle(){
  var p=document.getElementById('misSeedPanel'); if(!p) return;
  if(misICP_seedMode){ misICP_seedExit(false); }
  else { misICP_seedEnter(); }
}
function misICP_seedSetType(t){ misICP_seedType=t; var s=document.getElementById('misSeedType'); if(s) s.value=t; }
function misICP_seedEnter(){
  var stl=(misICP_seedTarget==='A')?misICP_stlA:misICP_stlB;
  if(!stl){ misICP_showError('Carica prima il file '+misICP_seedTarget+'.'); return; }
  var tri=misICP_pSTL(stl);
  if(!tri.length){ misICP_showError('File '+misICP_seedTarget+': nessun triangolo.'); return; }
  misICP_seedExit(true);
  misICP_seedMode=true; misICP_seedRawTri=tri; misICP_seedCenters=[]; misICP_seedAxes=[]; misICP_seedMarkers=[];
  misICP_seedRawMesh=misICP_buildMesh(tri, 0x9aa7b0);
  misICP_seedRawMesh.material.opacity=0.95;
  scene.add(misICP_seedRawMesh);
  var _st=document.getElementById('misurareStage'); if(_st) _st.classList.add('hidden');   // 8.70.2: nascondi la card istruzioni che copre visivamente la mesh
  var bs=misICP_seedRawMesh.geometry.boundingSphere;
  if(bs){ var c=bs.center, r=bs.radius; if(typeof controls!=='undefined'&&controls){ controls.target.set(c.x,c.y,c.z); } camera.position.set(c.x+r*1.6, c.y+r*1.2, c.z+r*1.6); if(typeof controls!=='undefined'&&controls&&controls.update) controls.update(); }
  renderer.domElement.addEventListener('pointerdown', misICP_seedPick);
  synLog('seed','ENTRA in modalita click', {target:misICP_seedTarget, type:misICP_seedType, fileTris:tri.length});
  var p=document.getElementById('misSeedPanel'); if(p) p.style.display='block';
  var b=document.getElementById('misBtnSeed'); if(b) b.textContent='Esci dalla modalità click';
  misICP_seedUpdatePanel();
}
function misICP_seedPick(ev){
  if(!misICP_seedMode || !misICP_seedRawMesh) return;
  if(ev.button!==0) return;   // solo click sinistro
  synLog('seed','pointerdown', {shift:!!ev.shiftKey, alt:!!ev.altKey, x:Math.round(ev.clientX), y:Math.round(ev.clientY)});
  if(!ev.shiftKey && !ev.altKey){ synLog('seed','ignorato: nessun Shift/Alt (drag = ruota camera)'); return; }   // 8.70.4: Shift+clic (la "freccia") o Alt
  var rect=renderer.domElement.getBoundingClientRect();
  var ndc=new THREE.Vector2(((ev.clientX-rect.left)/rect.width)*2-1, -((ev.clientY-rect.top)/rect.height)*2+1);
  var ray=new THREE.Raycaster(); ray.setFromCamera(ndc, camera);
  var hits=ray.intersectObject(misICP_seedRawMesh, false);
  if(!hits.length){ synLog('seed','RAYCAST nessun hit (raggio fuori dalla mesh)', {ndc:[+ndc.x.toFixed(3),+ndc.y.toFixed(3)]}); return; }
  ev.preventDefault();
  var pt=hits[0].point, nrm=hits[0].face?hits[0].face.normal.clone():new THREE.Vector3(0,0,1);
  var R=MIS_SEED_RADIUS[misICP_seedType]||1.78, res;
  try { res=findScanbodyCenter(misICP_seedRawMesh.geometry, pt, nrm, {radius:R}); }
  catch(e){ synLog('seed','findScanbodyCenter ECCEZIONE', {err:String(e), pt:[+pt.x.toFixed(3),+pt.y.toFixed(3),+pt.z.toFixed(3)]}); console.warn('[misSeed] findScanbodyCenter errore', e); misICP_showError('Click non agganciato (errore fit): clicca al centro del cap.'); return; }
  if(!res||!res.center){ synLog('seed','findScanbodyCenter NULL (nessun fit)', {pt:[+pt.x.toFixed(3),+pt.y.toFixed(3),+pt.z.toFixed(3)], R:R, type:misICP_seedType}); misICP_showError('Click non agganciato: clicca piu\' al centro del cap dello scanbody.'); return; }
  misICP_clearError();
  misICP_seedCenters.push([res.center.x,res.center.y,res.center.z]);
  misICP_seedAxes.push([res.axis.x,res.axis.y,res.axis.z]);
  synLog('seed','OK click #'+misICP_seedCenters.length, {center:[+res.center.x.toFixed(3),+res.center.y.toFixed(3),+res.center.z.toFixed(3)], axis:[+res.axis.x.toFixed(3),+res.axis.y.toFixed(3),+res.axis.z.toFixed(3)], R:R, type:misICP_seedType});
  var mk=new THREE.Mesh(new THREE.SphereGeometry(0.55,16,16), new THREE.MeshBasicMaterial({color:0x8B5CF6}));
  mk.position.set(res.center.x,res.center.y,res.center.z); scene.add(mk); misICP_seedMarkers.push(mk);
  misICP_seedUpdatePanel();
}
function misICP_seedUndo(){
  if(!misICP_seedCenters.length) return;
  misICP_seedCenters.pop(); misICP_seedAxes.pop();
  var mk=misICP_seedMarkers.pop(); if(mk){ scene.remove(mk); try{mk.geometry.dispose();mk.material.dispose();}catch(e){} }
  misICP_seedUpdatePanel();
}
function misICP_seedUpdatePanel(){
  var c=document.getElementById('misSeedCount'); if(c) c.textContent=misICP_seedCenters.length+' scanbody cliccati';
}
function misICP_seedExit(keepState, keepStageHidden){
  misICP_seedMode=false;
  try { renderer.domElement.removeEventListener('pointerdown', misICP_seedPick); } catch(e){}
  if(misICP_seedRawMesh){ scene.remove(misICP_seedRawMesh); try{misICP_seedRawMesh.geometry.dispose();misICP_seedRawMesh.material.dispose();}catch(e){} misICP_seedRawMesh=null; }
  misICP_seedMarkers.forEach(function(mk){ scene.remove(mk); try{mk.geometry.dispose();mk.material.dispose();}catch(e){} });
  misICP_seedMarkers=[]; misICP_seedRawTri=null;
  if(!keepState){ var p=document.getElementById('misSeedPanel'); if(p) p.style.display='none'; var b=document.getElementById('misBtnSeed'); if(b) b.textContent='Clicca gli scanbody (scansioni con tessuti)';
    // 8.70.2: se annulli la modalità click e non c'è un risultato, ripristina la card istruzioni (empty-state)
    var st=document.getElementById('misurareStage'); if(st && !keepStageHidden && !misICP_result) st.classList.remove('hidden'); }
}
function misICP_seedAlign(){
  if(misICP_seedCenters.length<4){ misICP_showError('Servono almeno 4 scanbody cliccati per un allineamento stabile ('+misICP_seedCenters.length+' finora; con 3 punti il risultato e\' degenere — RMSD sempre 0 ma falso).'); return; }
  // 8.70.1: uso DIRETTO i centri+assi cliccati (findScanbodyCenter) come scanbody del file target.
  // Niente crop/ri-rilevamento (l'8.70.0 crop-and-clean perdeva punti e sporcava gli assi con la gengiva:
  // 6 click -> 3 sopravvissuti, asse PCA su crop contaminato -> 34deg). Ogni click = 1 punto garantito.
  synLog('seed','ALLINEA coi punti cliccati', {file:misICP_seedTarget, nClick:misICP_seedCenters.length, centers:misICP_seedCenters.map(function(c){return [+c[0].toFixed(2),+c[1].toFixed(2),+c[2].toFixed(2)];})});
  misICP_clickSeeds={ file:misICP_seedTarget, centers:misICP_seedCenters.map(function(c){return c.slice();}), axes:misICP_seedAxes.map(function(a){return a.slice();}) };
  misICP_seedExit(false, true);   // 8.70.2: stage resta nascosto (misICP_run mostra il risultato)
  misICP_run();
}

function _misLoadConnGeo(){
  if(_misConnGeo || _misConnGeoLoading) return;
  _misConnGeoLoading = true;
  fetch('/static/conn/IPD.AB-SR-01-ZI.stl').then(function(r){ if(!r.ok) throw new Error('HTTP '+r.status); return r.arrayBuffer(); })
    .then(function(ab){ _misConnGeo = parseSTL(ab).geometry; _misConnGeoLoading = false;
      if(_misConnLastPairs) misICP_renderConnections(_misConnLastPairs); })   // re-render quando pronta
    .catch(function(e){ _misConnGeoLoading = false; if(window.console) console.warn('[misConn] load fail:', e && e.message); });
}
// 8.80.4: dispose RICORSIVO di un oggetto connessione. Il cleanup shallow
// (o.geometry/o.material top-level) non scendeva nei THREE.Group: il
// MeshPhongMaterial della mesh figlia (creato a ogni render) non veniva mai
// disposto -> leak di un material per coppia a ogni Esegui/ricolorazione.
// La geometry condivisa _misConnGeo (asset STL cache) NON va disposta.
function _misDisposeConnObj(o){
  if(!o) return;
  scene.remove(o);
  var kill = function(n){
    if(n.geometry && n.geometry !== _misConnGeo) n.geometry.dispose();
    if(n.material){ if(Array.isArray(n.material)) n.material.forEach(function(m){ m.dispose(); }); else n.material.dispose(); }
  };
  if(o.traverse) o.traverse(kill); else kill(o);
}
function misICP_renderConnections(pairs){
  if(typeof scene==='undefined' || !scene) return;
  misICP_connMeshes.forEach(_misDisposeConnObj);
  misICP_connMeshes = [];
  if(!pairs) return;
  _misConnLastPairs = pairs; if(!_misConnGeo) _misLoadConnGeo();   // 8.69.4: carica l'asset STL reale, re-render quando pronto
  var rMk = 0.25;  // mm
  pairs.forEach(function(p){
    if(!p.connA || !p.connB) return;
    [{c:p.connA, col:MIS_COL_SCB_A},{c:p.connB, col:MIS_COL_SCB_B}].forEach(function(o){
      var s=new THREE.Mesh(new THREE.SphereGeometry(rMk,16,12),
        new THREE.MeshPhongMaterial({color:o.col, emissive:o.col, emissiveIntensity:0.35, specular:0x222222, shininess:40}));
      s.position.set(o.c[0],o.c[1],o.c[2]); s.renderOrder=10; s.userData.misConn=true;
      scene.add(s); misICP_connMeshes.push(s);
    });
    if(p.connAxA && p.connCapZ!=null){
      var capPt=new THREE.Vector3(p.connA[0]+p.connCapZ*p.connAxA[0], p.connA[1]+p.connCapZ*p.connAxA[1], p.connA[2]+p.connCapZ*p.connAxA[2]);
      var ln=new THREE.Line(new THREE.BufferGeometry().setFromPoints([capPt, new THREE.Vector3(p.connA[0],p.connA[1],p.connA[2])]),
        new THREE.LineBasicMaterial({color:MIS_COL_SCB_A}));
      ln.userData.misConn=true; scene.add(ln); misICP_connMeshes.push(ln);
      // 8.69.4: geometria REALE connessione IPD (asset statico) all'ORIGINE (connA = (0,0,0) del CAD =
      // piattaforma). L'STL ha origine a Z=0 = piattaforma, +Z = post (lato OPPOSTO al cap dello scanbody).
      // Mappo il +Z del CAD su -connAxA (connAxA punta al cap, ora rilevato in modo ROBUSTO): la base resta
      // a connA, il post va dal lato opposto al disco -> overlay nativo dei file = Vedere. Niente flip casuale.
      try{
        if(_misConnGeo){
          var grp=new THREE.Group();
          grp.position.set(p.connA[0], p.connA[1], p.connA[2]);
          // 8.71.2: l'orientamento della connessione e' OPPOSTO tra SR e OS/1T3. L'STL IPD.AB-SR-01-ZI
          // (CAD SR, flip X 180°/Z invertita, CLAUDE.md §8) mappa +Z su -connAxA per SR; OS/1T3 (CAD NON
          // flippato) hanno la meccanica OPPOSTA -> +connAxA. (Segnalato dall'utente: "OS opposta a SR".)
          var _connSign = (p.sbType==='SR') ? -1 : 1;
          grp.quaternion.copy(new THREE.Quaternion().setFromUnitVectors(
            new THREE.Vector3(0,0,1), new THREE.Vector3(_connSign*p.connAxA[0],_connSign*p.connAxA[1],_connSign*p.connAxA[2]).normalize()));
          var _mcol=parseInt(misICP_connColor.replace('#',''),16);
          var mesh=new THREE.Mesh(_misConnGeo, new THREE.MeshPhongMaterial({color:_mcol, specular:0x222222, shininess:50, transparent:true, opacity:0.5, side:THREE.DoubleSide}));
          mesh.userData.misConn=true; mesh.userData.misConnMat=true; grp.add(mesh); grp.userData.misConn=true;
          scene.add(grp); misICP_connMeshes.push(grp);
        }
      }catch(e){ if(window.console) console.warn('[misConn] geom skip:', e && e.message); }
    }
  });
}

function misICP_renderPerCylinder(pairs, bgTrisA, bgTrisB){
  if(!scene) return;
  if(typeof misICP_connMeshes!=='undefined'){ misICP_connMeshes.forEach(_misDisposeConnObj); misICP_connMeshes=[]; }   // 8.80.4: dispose ricorsivo (i Group non hanno material top-level)
  // Cleanup mesh precedenti
  if(misICP_meshA){ scene.remove(misICP_meshA); if(misICP_meshA.geometry) misICP_meshA.geometry.dispose(); if(misICP_meshA.material) misICP_meshA.material.dispose(); misICP_meshA=null; }
  if(misICP_meshB){ scene.remove(misICP_meshB); if(misICP_meshB.geometry) misICP_meshB.geometry.dispose(); if(misICP_meshB.material) misICP_meshB.material.dispose(); misICP_meshB=null; }
  if(misICP_bgMeshA){ scene.remove(misICP_bgMeshA); if(misICP_bgMeshA.geometry) misICP_bgMeshA.geometry.dispose(); if(misICP_bgMeshA.material) misICP_bgMeshA.material.dispose(); misICP_bgMeshA=null; }
  if(misICP_bgMeshB){ scene.remove(misICP_bgMeshB); if(misICP_bgMeshB.geometry) misICP_bgMeshB.geometry.dispose(); if(misICP_bgMeshB.material) misICP_bgMeshB.material.dispose(); misICP_bgMeshB=null; }
  misICP_meshesA.forEach(function(m){ if(m){ scene.remove(m); if(m.geometry) m.geometry.dispose(); if(m.material) m.material.dispose(); } });
  misICP_meshesB.forEach(function(m){ if(m){ scene.remove(m); if(m.geometry) m.geometry.dispose(); if(m.material) m.material.dispose(); } });
  misICP_meshesA=[]; misICP_meshesB=[];
  misICP_selectedIdx=-1;
  // 8.80.2: pulizia residui click-to-seed. La mesh grezza (misICP_seedRawMesh, 0x9aa7b0) e i
  // marker restavano orfani in scena (nessuna voce nell'albero) se l'analisi partiva senza
  // passare da misICP_seedExit; qui garantiamo che ogni render del risultato li rimuova.
  if(misICP_seedRawMesh){ scene.remove(misICP_seedRawMesh); try{misICP_seedRawMesh.geometry.dispose();misICP_seedRawMesh.material.dispose();}catch(e){} misICP_seedRawMesh=null; }
  if(misICP_seedMarkers && misICP_seedMarkers.length){ misICP_seedMarkers.forEach(function(mk){ if(mk){ scene.remove(mk); try{mk.geometry.dispose();mk.material.dispose();}catch(e){} } }); misICP_seedMarkers=[]; }

  // Bounding sphere globale per framing camera
  var boundingCentroids=[];

  var scanCol = (window.envSettings && envSettings.scanColor) ? envSettings.scanColor : '#b8a090';
  var scanColInt = parseInt(scanCol.replace('#',''),16);

  // Arcata A (riferimento): colore scanColor, OPACITA' PIENA 100%
  if(bgTrisA && bgTrisA.length){
    misICP_bgMeshA = misICP_buildMesh(bgTrisA, scanColInt);
    misICP_bgMeshA.material.opacity = MIS_OP_BG_A;
    misICP_bgMeshA.material.transparent = (MIS_OP_BG_A < 1);
    scene.add(misICP_bgMeshA);
    if(misICP_bgMeshA.geometry.boundingSphere) boundingCentroids.push(misICP_bgMeshA.geometry.boundingSphere);
  }
  // Arcata B (confronto, post-ICP): colore scanColor, OPACITA' TRASPARENTE
  if(bgTrisB && bgTrisB.length){
    misICP_bgMeshB = misICP_buildMesh(bgTrisB, scanColInt);
    misICP_bgMeshB.material.opacity = MIS_OP_BG_B;
    misICP_bgMeshB.material.transparent = true;
    scene.add(misICP_bgMeshB);
    if(misICP_bgMeshB.geometry.boundingSphere) boundingCentroids.push(misICP_bgMeshB.geometry.boundingSphere);
  }

  pairs.forEach(function(p,idx){
    // Mesh A (scanbody riferimento, ARANCIO, opacita' piena)
    if(p.trisA && p.trisA.length){
      var mA=misICP_buildMesh(p.trisA, MIS_COL_SCB_A);
      mA.material.opacity = MIS_OP_SCB_A;
      mA.material.transparent = (MIS_OP_SCB_A < 1);
      scene.add(mA);
      misICP_meshesA.push(mA);
      if(mA.geometry.boundingSphere) boundingCentroids.push(mA.geometry.boundingSphere);
    } else { misICP_meshesA.push(null); }
    // Mesh B (scanbody misurato post-ICP, BLU, opacita' ridotta)
    if(p.trisBt && p.trisBt.length){
      var mB=misICP_buildMesh(p.trisBt, MIS_COL_SCB_B);
      mB.material.opacity = MIS_OP_SCB_B;
      mB.material.transparent = true;
      scene.add(mB);
      misICP_meshesB.push(mB);
      if(mB.geometry.boundingSphere) boundingCentroids.push(mB.geometry.boundingSphere);
    } else { misICP_meshesB.push(null); }
  });

  // Inc-2: disegno connessione + origine (gruppo albero 'conn'). Additivo: un
  // fallimento qui NON deve rompere il display dell'analisi (centroidi/dischi).
  try { misICP_renderConnections(pairs); } catch(e){ if(window.console) console.warn('[misConn] render skip:', e && e.message); }

  // Framing: centro medio di tutti i bounding sphere; raggio = distanza massima dal centro
  if(boundingCentroids.length){
    var cx=0, cy=0, cz=0;
    boundingCentroids.forEach(function(s){ cx+=s.center.x; cy+=s.center.y; cz+=s.center.z; });
    cx/=boundingCentroids.length; cy/=boundingCentroids.length; cz/=boundingCentroids.length;
    var rad=0;
    boundingCentroids.forEach(function(s){
      var d=Math.hypot(s.center.x-cx, s.center.y-cy, s.center.z-cz) + s.radius;
      if(d>rad) rad=d;
    });
    controls.target.set(cx,cy,cz);
    camera.position.set(cx+rad*1.6, cy+rad*1.2, cz+rad*1.6);
    controls.update && controls.update();
  }

  // FIX v7.3.9.082: applico la modalita\' di rendering corrente
  // alle nuove mesh (recupero da localStorage o envSettings.renderMode)
  try {
    var savedMode = null;
    try { savedMode = localStorage.getItem('syntesis_viewMode'); } catch(e){}
    if(savedMode && (savedMode === 'solid' || savedMode === 'wireframe' || savedMode === 'both')){
      if(typeof envSettings !== 'undefined') envSettings.renderMode = savedMode;
    }
    if(typeof applyRenderModeToScene === 'function') applyRenderModeToScene();
  } catch(e){ console.warn('[Misurare] render mode apply failed:', e); }
}

// --- RENDER ELENCO CARD SCANBODY NEL PANNELLO DESTRO ---
function misICP_renderScanbodyList(pairs){
  var host=document.getElementById('misScbList');
  if(!host) return;
  host.innerHTML='';
  pairs.forEach(function(p,idx){
    var el=document.createElement('div');
    if(p.iB<0){
      el.className='mis-scb-orphan';
      el.textContent='Scanbody A #'+(idx+1)+': nessuna corrispondenza in B.';
      host.appendChild(el);
      return;
    }
    el.className='mis-scb-item';
    el.setAttribute('data-idx', String(idx));
    el.onclick=(function(i){ return function(){ misICP_highlightCylinder(i); misICP_openCutview(i); }; })(idx);

    var head=document.createElement('div'); head.className='mis-scb-head';
    var num=document.createElement('div'); num.className='mis-scb-num'; num.textContent='#'+(idx+1);
    var badge=document.createElement('div'); badge.className='mis-scb-badge';
    badge.textContent=p.level.label;
    badge.style.background=p.level.bg; badge.style.color=p.level.fg;
    var d3=document.createElement('div'); d3.className='mis-scb-d3';
    d3.textContent=Math.round(p.d3um)+' um'; d3.style.color=p.level.col;
    head.appendChild(num); head.appendChild(badge); head.appendChild(d3);

    var metrics=document.createElement('div'); metrics.className='mis-scb-metrics';
    function row(lbl,val,cls){
      var r=document.createElement('div'); r.className='mis-scb-row';
      var l=document.createElement('span'); l.className='mis-scb-lbl'; l.textContent=lbl;
      var v=document.createElement('span'); v.className='mis-scb-val'+(cls?' '+cls:''); v.textContent=val;
      r.appendChild(l); r.appendChild(v); return r;
    }
    function fmt(um){ return (um>=0?'+':'')+Math.round(um)+' um'; }
    metrics.appendChild(row('XY',       Math.round(p.dxyum)+' um'));
    metrics.appendChild(row('Asse',     p.axAngleDeg.toFixed(2)+' deg'));
    metrics.appendChild(row('X',        fmt(p.dxum), p.dxum>=0?'pos':'neg'));
    metrics.appendChild(row('Y',        fmt(p.dyum), p.dyum>=0?'pos':'neg'));
    metrics.appendChild(row('Z',        fmt(p.dzum), p.dzum>=0?'pos':'neg'));
    metrics.appendChild(row('|D|',      Math.round(p.d3um)+' um'));

    el.appendChild(head); el.appendChild(metrics);
    host.appendChild(el);
  });
}

// --- HIGHLIGHT: evidenzia un cilindro nel viewport e nella lista ---
function misICP_highlightCylinder(idx){
  if(!misICP_result || !misICP_result.pairs) return;
  var pairs=misICP_result.pairs;
  if(idx<0 || idx>=pairs.length) return;
  var toggle = (misICP_selectedIdx===idx);
  misICP_selectedIdx = toggle ? -1 : idx;

  // UI: card selezionata
  var items=document.querySelectorAll('#misScbList .mis-scb-item');
  for(var i=0;i<items.length;i++){
    var di=parseInt(items[i].getAttribute('data-idx'),10);
    items[i].classList.toggle('selected', !toggle && di===idx);
  }

  // Mesh: se toggle off, tutto torna ai default; se on, solo (idx) resta brillante, le altre si offuscano
  for(var i=0;i<pairs.length;i++){
    var mA=misICP_meshesA[i], mB=misICP_meshesB[i];
    var isSel = (!toggle && i===idx);
    var anySel = !toggle;
    if(mA){
      mA.material.opacity = anySel ? (isSel ? 1.00 : 0.10) : MIS_OP_SCB_A;
      mA.material.transparent = (mA.material.opacity < 1);
    }
    if(mB){
      mB.material.opacity = anySel ? (isSel ? 0.95 : 0.10) : MIS_OP_SCB_B;
      mB.material.transparent = true;
    }
  }
  // Arcate: quando un cilindro e' selezionato si abbassano per non distrarre
  if(misICP_bgMeshA){
    misICP_bgMeshA.material.opacity = toggle ? MIS_OP_BG_A : Math.min(MIS_OP_BG_A, 0.25);
    misICP_bgMeshA.material.transparent = (misICP_bgMeshA.material.opacity < 1);
  }
  if(misICP_bgMeshB){
    misICP_bgMeshB.material.opacity = toggle ? MIS_OP_BG_B : Math.min(MIS_OP_BG_B, 0.12);
    misICP_bgMeshB.material.transparent = true;
  }

  // Framing: se selezionato, zoom sul cilindro; altrimenti framing globale
  if(!toggle){
    var p=pairs[idx];
    if(p.cA){
      var bs = (misICP_meshesB[idx] && misICP_meshesB[idx].geometry.boundingSphere) || null;
      var rad = bs ? bs.radius*4 : 5;
      controls.target.set(p.cA[0], p.cA[1], p.cA[2]);
      camera.position.set(p.cA[0]+rad*1.4, p.cA[1]+rad*0.9, p.cA[2]+rad*1.4);
      controls.update && controls.update();
    }
    showStatus('Scanbody #'+(idx+1)+' evidenziato. '+Math.round(p.d3um)+' um '+p.level.label+'.');
  } else {
    // Riapplico il framing globale come in renderPerCylinder
    var all=misICP_meshesB.filter(function(m){return m && m.geometry.boundingSphere;}).map(function(m){return m.geometry.boundingSphere;});
    if(all.length){
      var cx=0,cy=0,cz=0;
      all.forEach(function(s){ cx+=s.center.x; cy+=s.center.y; cz+=s.center.z; });
      cx/=all.length; cy/=all.length; cz/=all.length;
      var rad=0;
      all.forEach(function(s){ var d=Math.hypot(s.center.x-cx,s.center.y-cy,s.center.z-cz)+s.radius; if(d>rad)rad=d; });
      controls.target.set(cx,cy,cz);
      camera.position.set(cx+rad*1.6, cy+rad*1.2, cz+rad*1.6);
      controls.update && controls.update();
    }
  }
}

function misICP_mountViewport(){
  if(misICP_viewportMounted) return;
  misICP_viewportMounted=true;
  // Salvo stato corrente (per ripristino in unmount)
  misICP_savedState={
    scanMeshVisible: scanMesh ? scanMesh.visible : null,
    cameraPos: camera ? camera.position.clone() : null,
    controlsTarget: controls ? controls.target.clone() : null
  };
  // Nascondo TUTTO cio' che appartiene ad Analizza (scansione, MUA, label, spline...)
  _setAnalyzaArtifactsVisible(false);
  // Nascondo overlay DOM che non c'entrano con Misurare
  var emptyState=document.getElementById('emptyState');
  if(emptyState) emptyState.classList.add('hidden');
  var undercutLegend=document.getElementById('undercutLegend');
  if(undercutLegend) undercutLegend.style.display='none';
  var clinicalBanner=document.getElementById('clinicalBanner');
  if(clinicalBanner) clinicalBanner.style.display='none';
  var layersPanel=document.getElementById('layersPanel');
  if(layersPanel) layersPanel.style.display='none';
  // Se ho gia' mesh ICP calcolate in un'entrata precedente, le ri-aggiungo alla scena
  if(misICP_meshA && scene.children.indexOf(misICP_meshA) < 0) scene.add(misICP_meshA);
  if(misICP_meshB && scene.children.indexOf(misICP_meshB) < 0) scene.add(misICP_meshB);
  if(misICP_bgMeshA && scene.children.indexOf(misICP_bgMeshA) < 0) scene.add(misICP_bgMeshA);
  if(misICP_bgMeshB && scene.children.indexOf(misICP_bgMeshB) < 0) scene.add(misICP_bgMeshB);
  misICP_meshesA.forEach(function(m){ if(m && scene.children.indexOf(m) < 0) scene.add(m); });
  misICP_meshesB.forEach(function(m){ if(m && scene.children.indexOf(m) < 0) scene.add(m); });
}
function misICP_unmountViewport(){
  if(!misICP_viewportMounted) return;
  misICP_viewportMounted=false;
  // Rimuovo (ma non distruggo) le mesh ICP dalla scena, cosi' se rientri in Misurare le ritrovi
  if(misICP_meshA) scene.remove(misICP_meshA);
  if(misICP_meshB) scene.remove(misICP_meshB);
  if(misICP_bgMeshA) scene.remove(misICP_bgMeshA);
  if(misICP_bgMeshB) scene.remove(misICP_bgMeshB);
  misICP_meshesA.forEach(function(m){ if(m) scene.remove(m); });
  misICP_meshesB.forEach(function(m){ if(m) scene.remove(m); });
  // Nascondo label, cutview e tree (senza distruggere i dati)
  misICP_labels.forEach(function(el){ if(el) el.style.display='none'; });
  misICP_closeCutview();
  misICP_hideTree();
  // Ripristino artefatti Analizza (visibilita' individuali preservate dai flag interni)
  _setAnalyzaArtifactsVisible(true);
  // Ripristino stato camera/controls
  if(misICP_savedState){
    if(camera && misICP_savedState.cameraPos) camera.position.copy(misICP_savedState.cameraPos);
    if(controls && misICP_savedState.controlsTarget) controls.target.copy(misICP_savedState.controlsTarget);
    if(controls) controls.update && controls.update();
  }
  // Ripristina empty state se non c'e' scansione caricata
  if(!scanMesh){
    var emptyState=document.getElementById('emptyState');
    if(emptyState) emptyState.classList.remove('hidden');
  }
}

// --- RESET: azzera tutti gli STL/mesh di Misurare ---
function misICP_reset(){
  misICP_stlA=null; misICP_stlB=null;
  misICP_nameA=''; misICP_nameB='';
  misICP_trisA=null; misICP_trisB=null;
  misICP_result=null;
  misICP_selectedIdx=-1;
  // Dispose mesh totali legacy (se ancora presenti da una vecchia run)
  if(misICP_meshA){ scene.remove(misICP_meshA); if(misICP_meshA.geometry) misICP_meshA.geometry.dispose(); if(misICP_meshA.material) misICP_meshA.material.dispose(); misICP_meshA=null; }
  if(misICP_meshB){ scene.remove(misICP_meshB); if(misICP_meshB.geometry) misICP_meshB.geometry.dispose(); if(misICP_meshB.material) misICP_meshB.material.dispose(); misICP_meshB=null; }
  // Dispose mesh per-cilindro
  misICP_meshesA.forEach(function(m){ if(m){ scene.remove(m); if(m.geometry) m.geometry.dispose(); if(m.material) m.material.dispose(); } });
  misICP_meshesB.forEach(function(m){ if(m){ scene.remove(m); if(m.geometry) m.geometry.dispose(); if(m.material) m.material.dispose(); } });
  misICP_meshesA=[]; misICP_meshesB=[];
  // Dispose marker/geometrie connessione (Inc-2)
  if(typeof misICP_connMeshes!=='undefined'){ misICP_connMeshes.forEach(_misDisposeConnObj); misICP_connMeshes=[]; }   // 8.80.4: dispose ricorsivo (i Group non hanno material top-level)
  // Dispose arcate A e B
  if(misICP_bgMeshA){ scene.remove(misICP_bgMeshA); if(misICP_bgMeshA.geometry) misICP_bgMeshA.geometry.dispose(); if(misICP_bgMeshA.material) misICP_bgMeshA.material.dispose(); misICP_bgMeshA=null; }
  if(misICP_bgMeshB){ scene.remove(misICP_bgMeshB); if(misICP_bgMeshB.geometry) misICP_bgMeshB.geometry.dispose(); if(misICP_bgMeshB.material) misICP_bgMeshB.material.dispose(); misICP_bgMeshB=null; }
  // Reset UI dropzone
  ['A','B'].forEach(function(side){
    var dz=document.getElementById('misDz'+side);
    var hint=document.getElementById('misDz'+side+'Hint');
    var meta=document.getElementById('misDz'+side+'Meta');
    var input=document.getElementById('misInput'+side);
    if(dz)    dz.classList.remove('ok');
    if(hint)  hint.textContent='trascina .stl qui oppure clicca';
    if(meta)  meta.textContent='';
    if(input) input.value='';
  });
  // Nascondo summary e lista scanbody
  var sum=document.getElementById('misSummary');
  if(sum) sum.style.display='none';
  var lw=document.getElementById('misScbListWrap');
  if(lw) lw.style.display='none';
  var lst=document.getElementById('misScbList');
  if(lst) lst.innerHTML='';
  // Rimuovo label 3D, chiudo cutview e nascondo il tree
  misICP_destroyLabels();
  misICP_closeCutview();
  misICP_hideTree();
  misICP_updateRunBtn();
  misICP_clearError();
  // Riporta lo stage placeholder
  var stage=document.getElementById('misurareStage');
  if(stage) stage.classList.remove('hidden');
  showStatus('Misurare: pronto per un nuovo confronto.');
}
