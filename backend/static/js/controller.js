// ─────────────────────────────────────────────────────────────
// Syntesis-ICP — controller.js
// Estratto da index.html (script #4)
// Copyright (C) Francesco Biaggini. Tutti i diritti riservati.
// ─────────────────────────────────────────────────────────────

// ── v7 main controller (wraps v6 C) ──────────────────────────────────────
var C = (function(){
  var F = {A:null, B:null};
  window._LR = null;

  function rbuf(f){ return new Promise(function(res,rej){ var r=new FileReader(); r.onload=function(e){res(e.target.result);}; r.onerror=rej; r.readAsArrayBuffer(f); }); }

  return {
    go: function() {
      var btn = document.getElementById('run');
      btn.disabled = true; btn.textContent = T('btnAnalyzing');
      document.getElementById('err').style.display = 'none';
      document.getElementById('res').style.display = 'none';
      var fA = (window.FILES && window.FILES.A) || FILES.A, fB = (window.FILES && window.FILES.B) || FILES.B;
      if(!fA || !fB) { btn.disabled=false; btn.classList.add('on'); btn.textContent=T('btnAnalyze'); return; }
      Promise.all([rbuf(fA), rbuf(fB)]).then(function(bufs){
        var tA=pSTL(bufs[0]), tB=pSTL(bufs[1]);
        var cA=comps(tA), cB=comps(tB);
        if(!cA.length||!cB.length) throw new Error('Nessun componente trovato.');
        var partA=partitionComps(cA), partB=partitionComps(cB);
        var scanA=partA.scan.map(function(i){return cA[i];}), scanB=partB.scan.map(function(i){return cB[i];});
        var bgTriA=[];partA.bg.forEach(function(i){cA[i].forEach(function(ti){bgTriA.push(tA[ti]);});});
        var rawCentA=scanA.map(function(c){return cen(tA,c);}), rawCentB=scanB.map(function(c){return cen(tB,c);});
        var gA=gcen(tA), gB=gcen(tB), off=[gA[0]-gB[0],gA[1]-gB[1],gA[2]-gB[2]];
        var rawCentB_shifted=rawCentB.map(function(b){return[b[0]+off[0],b[1]+off[1],b[2]+off[2]];});
        var preAlign=robustPreAlign(rawCentA, rawCentB_shifted);
        var thresh=Math.min(autoThresh(rawCentA),autoThresh(rawCentB));
        var clustA=clusterComps(rawCentA,thresh), clustB=clusterComps(rawCentB,thresh);
        var cAmerged=clustA.map(function(cl){var out=[];cl.forEach(function(ci){scanA[ci].forEach(function(ti){out.push(ti);});});return out;});
        var cBmerged=clustB.map(function(cl){var out=[];cl.forEach(function(ci){scanB[ci].forEach(function(ti){out.push(ti);});});return out;});
        var sortA=cAmerged.slice().sort(function(a,b){var ca=mergedCen(tA,[a]),cb=mergedCen(tA,[b]);return ca[0]-cb[0]||ca[1]-cb[1];});
        var sortB=cBmerged.slice().sort(function(a,b){var ca=mergedCen(tB,[a]),cb=mergedCen(tB,[b]);return ca[0]-cb[0]||ca[1]-cb[1];});
        var ctA=sortA.map(function(c){return mergedCen(tA,[c]);}), ctBraw=sortB.map(function(c){return mergedCen(tB,[c]);});
        var ctBt=ctBraw.map(function(b){var bs=[b[0]+off[0],b[1]+off[1],b[2]+off[2]];if(preAlign.R){var rb=mv3(preAlign.R,bs);bs=[rb[0]+preAlign.t[0],rb[1]+preAlign.t[1],rb[2]+preAlign.t[2]];}return bs;});
        var icp=runICP(ctA,ctBt,80);
        var pairs=mPairs(ctA,icp.aligned);
        var tBoff=tB.map(function(tri){return tri.map(function(v){return[v[0]+off[0],v[1]+off[1],v[2]+off[2]];});});
        var tBpre=preAlign.R?applyTform(tBoff,preAlign.R,preAlign.t):tBoff;
        var tBall=applyTform(tBpre,icp.R,icp.t);
        var cylAxes=pairs.map(function(pp,pi){
          var triA2=sortA[pi].map(function(idx){return tA[idx];});
          var axA=cylAxis(triA2);
          if(!pp.b)return{axA:axA,axB:null,angleDeg:null};
          var bestBi=-1,bestD=Infinity;
          sortB.forEach(function(bc,bi){
            var bcRaw=mergedCen(tB,[bc]);
            var bs=[bcRaw[0]+off[0],bcRaw[1]+off[1],bcRaw[2]+off[2]];
            if(preAlign.R){var rb=mv3(preAlign.R,bs);bs=[rb[0]+preAlign.t[0],rb[1]+preAlign.t[1],rb[2]+preAlign.t[2]];}
            var bcR=mv3(icp.R,bs);var bcAl=[bcR[0]+icp.t[0],bcR[1]+icp.t[1],bcR[2]+icp.t[2]];
            var d=Math.hypot(pp.b[0]-bcAl[0],pp.b[1]-bcAl[1],pp.b[2]-bcAl[2]);
            if(d<bestD){bestD=d;bestBi=bi;}
          });
          if(bestBi<0)return{axA:axA,axB:null,angleDeg:null};
          var triB2=sortB[bestBi].map(function(idx){return tBall[idx];});
          var axB=cylAxis(triB2);
          var Rt=tr3(icp.R);var axBc=mv3(Rt,axB);
          return{axA:axA,axB:axB,angleDeg:axisAngleDeg(axA,axBc)};
        });
        var detectedProfile=dominantProfile(scanA.concat(scanB));
        // Build per-cylinder triangle arrays for PDF rendering
        var cylTrisA=sortA.map(function(c){return c.map(function(idx){return tA[idx];});});
        // For B: find matching cylinder by centroid proximity
        var cylTrisB=pairs.map(function(pp,pi){
          if(!pp.b)return[];
          var bestBi=-1,bestD=Infinity;
          sortB.forEach(function(bc,bi){
            var bcRaw=mergedCen(tB,[bc]);
            var bs=[bcRaw[0]+off[0],bcRaw[1]+off[1],bcRaw[2]+off[2]];
            if(preAlign.R){var rb=mv3(preAlign.R,bs);bs=[rb[0]+preAlign.t[0],rb[1]+preAlign.t[1],rb[2]+preAlign.t[2]];}
            var bcR=mv3(icp.R,bs);var bcAl=[bcR[0]+icp.t[0],bcR[1]+icp.t[1],bcR[2]+icp.t[2]];
            var d=Math.hypot(pp.b[0]-bcAl[0],pp.b[1]-bcAl[1],pp.b[2]-bcAl[2]);
            if(d<bestD){bestD=d;bestBi=bi;}
          });
          if(bestBi<0)return[];
          return sortB[bestBi].map(function(idx){return tBall[idx];});
        });
        window._LR={pairs:pairs,off:off,nA:fA.name,nB:fB.name,
          cA:sortA.length,cB:sortB.length,detectedProfile:detectedProfile,
          icpAngle:icp.angle,icpRmsd:icp.rmsd,trisA:tA,trisB_all:tBall,bgA:bgTriA,
          excludedA:partA.bg.length,excludedB:partB.bg.length,cylAxes:cylAxes,
          cylTrisA:cylTrisA,cylTrisB:cylTrisB,ctA:ctA,ctBfinal:icp.aligned};
        C.render();
        renderDistances();
      }).catch(function(e){
        var d=document.getElementById('err');d.textContent=e.message;d.style.display='block';
      }).then(function(){
        btn.disabled=false;btn.classList.add('on');btn.textContent=T('btnAgain');
      });
    },

    render: function() {
      var p=window._LR; if(!p)return;
      var score=calcScore(p.pairs,p.cylAxes);
      var lv=scoreLabel(score);
      var scaleUm=getScaleUm(p.pairs);
      var rows='',rows2='';
      p.pairs.forEach(function(pp,i){
        var bg=i%2===0?'#f9fafb':'#fff';
        rows+='<tr style="background:'+bg+'"><td>#'+(i+1)+'</td>'
          +'<td>'+(pp.dx!==null?(pp.dx>=0?'+':'')+pp.dx.toFixed(4)+'<br><span style="color:#9ca3af">'+(pp.dx*1000).toFixed(1)+' μm</span>':'--')+'</td>'
          +'<td>'+(pp.dy!==null?(pp.dy>=0?'+':'')+pp.dy.toFixed(4)+'<br><span style="color:#9ca3af">'+(pp.dy*1000).toFixed(1)+' μm</span>':'--')+'</td>'
          +'<td>'+(pp.dz!==null?(pp.dz>=0?'+':'')+pp.dz.toFixed(4)+'<br><span style="color:#9ca3af">'+(pp.dz*1000).toFixed(1)+' μm</span>':'--')+'</td>'
          +'<td>'+(pp.dxy!==null?pp.dxy.toFixed(4)+'<br><span style="color:#9ca3af">'+Math.round(pp.dxy*1000)+' μm</span>':'--')+'</td>'
          +'<td style="font-weight:600">'+(pp.d3!==null?pp.d3.toFixed(4)+'<br><span style="color:#9ca3af">'+Math.round(pp.d3*1000)+' μm</span>':'--')+'</td>'
          +'</tr>';
        rows2+='<tr style="background:'+bg+'"><td>#'+(i+1)+'</td>'
          +'<td>'+pp.a[0].toFixed(4)+'</td><td>'+pp.a[1].toFixed(4)+'</td><td>'+pp.a[2].toFixed(4)+'</td>'
          +'<td>'+(pp.b?pp.b[0].toFixed(4):'--')+'</td><td>'+(pp.b?pp.b[1].toFixed(4):'--')+'</td><td>'+(pp.b?pp.b[2].toFixed(4):'--')+'</td>'
          +'</tr>';
      });
      // Cyl cards
      var cylCards='';
      p.pairs.forEach(function(pp,i){
        var d3um=pp.d3!==null?Math.round(pp.d3*1000):0;
        var dxum=pp.dx!==null?Math.round(pp.dx*1000):0;
        var dyum=pp.dy!==null?Math.round(pp.dy*1000):0;
        var dzum=pp.dz!==null?Math.round(pp.dz*1000):0;
        var lv2=clinLevel(d3um);
        cylCards+='<div class="cyl-card">'
          +'<div class="cyl-hdr" style="background:'+lv2.bg+'">'
          +'<span class="cyl-num" style="color:'+lv2.fg+'">#'+(i+1)+'</span>'
          +'<div class="cyl-vals" style="color:'+lv2.fg+'"><span>dX:'+(pp.dx!==null?(pp.dx>=0?'+':'')+pp.dx.toFixed(4):'--')+'</span><span>dY:'+(pp.dy!==null?(pp.dy>=0?'+':'')+pp.dy.toFixed(4):'--')+'</span><span>dZ:'+(pp.dz!==null?(pp.dz>=0?'+':'')+pp.dz.toFixed(4):'--')+'</span></div>'
          +'<span class="cyl-d3" style="color:'+lv2.col+'">'+lv2.label+' — '+d3um+' μm'
          +(p.cylAxes&&p.cylAxes[i]&&p.cylAxes[i].angleDeg!==null?' | Asse '+p.cylAxes[i].angleDeg.toFixed(2)+'°':'')
          +'</span></div>'
          +'<div style="padding:10px 12px 8px">'
          +'<canvas id="cc_'+i+'" width="720" height="200" style="width:100%;display:block"></canvas>'
          +'</div></div>';
      });

      // Score block
      var circumference=2*Math.PI*40;
      var offset=circumference*(1-score/100);
      var scoreHtml='<div class="score-block">'
        +'<div class="score-ring-wrap"><svg width="90" height="90" viewBox="0 0 90 90">'
        +'<circle cx="45" cy="45" r="40" fill="none" stroke="#e5e7eb" stroke-width="8"/>'
        +'<circle cx="45" cy="45" r="40" fill="none" stroke="'+lv.col+'" stroke-width="8"'
        +' stroke-dasharray="'+circumference.toFixed(1)+'" stroke-dashoffset="'+offset.toFixed(1)+'" stroke-linecap="round"/>'
        +'</svg><div class="score-num"><div class="score-val" style="color:'+lv.col+'">'+score+'</div><div class="score-max">/100</div></div></div>'
        +'<div class="score-info"><div class="score-title" style="color:'+lv.col+'">'+lv.label+'</div>'
        +'<div class="score-desc">'+T('scoreTitle')+'</div></div></div>';

      var o=p.off;
      var h='<div class="sr">'
        +'<div class="sc"><div class="sl2">'+T('scanA')+'</div><div class="sv" style="color:var(--blue)">'+p.cA+'</div></div>'
        +'<div class="sc"><div class="sl2">'+T('scanB')+'</div><div class="sv" style="color:var(--blue-mid)">'+p.cB+'</div></div>'
        +'<div class="sc"><div class="sl2">'+T('pairs')+'</div><div class="sv">'+p.pairs.length+'</div></div>'
        +'<div class="sc"><div class="sl2">'+T('rmsd')+'</div><div class="sv" style="font-size:15px;color:#0f6e56">'+p.icpRmsd.toFixed(4)+'<span style="font-size:10px;color:var(--gray)"> mm</span></div></div>'
        +'</div>';

      if(!USER.registered){
        // Show locked score + gate
        h+='<div class="score-locked"><div class="lock-inner">'
          +'<div class="lock-icon-wrap">🔒</div>'
          +'<div><div class="lock-title">'+T('lockTitle')+'</div>'
          +'<div class="lock-sub">'+T('lockSub')+'</div></div>'
          +'</div></div>';
        h+=buildGate(score);
      } else {
        h+=scoreHtml;
        h+=buildSavePanel(score);
      }

      // Map
      h+='<div class="sl" style="margin-top:16px">Mappa colorimetrica</div>'
        +'<canvas id="cv_map" width="860" height="420" style="width:100%;display:block;border:1px solid var(--border);border-radius:10px"></canvas>'
        +'<div style="font-size:10px;color:var(--gray);font-family:var(--mono);margin:6px 0 14px">○ A (riferimento) · ● B (misurato)</div>';

      // Previews
      h+='<div class="sl">Anteprima mesh</div>'
        +'<div class="prev-row">'
        +'<div class="prev-box"><div class="prev-lbl">XY</div><canvas id="cv_gxy" width="240" height="210"></canvas></div>'
        +'<div class="prev-box"><div class="prev-lbl">XZ</div><canvas id="cv_gxz" width="240" height="210"></canvas></div>'
        +'<div class="prev-box"><div class="prev-lbl">YZ</div><canvas id="cv_gyz" width="240" height="210"></canvas></div>'
        +'</div>'
        +'<div class="leg"><span><span class="led" style="background:var(--blue)"></span>File A</span><span><span class="led" style="background:#ba7517"></span>File B (ICP)</span></div>';

      // Cyl cards
      h+='<div class="dv"></div><div class="sl">Report per cilindro</div>'+cylCards;

      // Tables
      h+='<div class="dv"></div><div class="sl">Deviazioni</div>'
        +'<div style="overflow-x:auto"><table><thead><tr>'
        +'<th style="text-align:left">#</th><th>dX</th><th>dY</th><th>dZ</th><th>dXY</th><th>|D| 3D</th>'
        +'</tr></thead><tbody>'+rows+'</tbody></table></div>';

      h+='<div class="dv"></div>'
        +'<div style="display:flex;gap:8px;margin-top:12px">'
        +'<button class="btn-outline" style="flex:1" onclick="C.pdf()">'
        +'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>'
        +'PDF</button>'
        +'<button class="btn-outline" style="flex:1" onclick="window.print()">🖨 Stampa</button>'
        +'</div>';

      document.getElementById('res').innerHTML=h;
      document.getElementById('res').style.display='block';

      // Draw canvases
      setTimeout(function(){
        drawColorMap(document.getElementById('cv_map'), p.pairs.map(function(pp,i){
          var ax=p.cylAxes&&p.cylAxes[i]?p.cylAxes[i]:{};
          return Object.assign({},pp,{axA:ax.axA,axB:ax.axB,angleDeg:ax.angleDeg});
        }));
        paintView(document.getElementById('cv_gxy'),p.trisA,p.trisB_all,p.bgA,0,1,2,'Piano XY');
        paintView(document.getElementById('cv_gxz'),p.trisA,p.trisB_all,p.bgA,0,2,1,'Piano XZ');
        paintView(document.getElementById('cv_gyz'),p.trisA,p.trisB_all,p.bgA,1,2,0,'Piano YZ');
        p.pairs.forEach(function(pp,i){
          drawCard(document.getElementById('cc_'+i),
            pp.dx!==null?Math.round(pp.dx*1000):0,
            pp.dy!==null?Math.round(pp.dy*1000):0,
            pp.dz!==null?Math.round(pp.dz*1000):0,
            pp.d3!==null?Math.round(pp.d3*1000):0,
            scaleUm, p.cylAxes&&p.cylAxes[i]?p.cylAxes[i].angleDeg:null);
        });
        if(USER.registered) setTimeout(function(){drawShareCard(null);},200);
      },120);
    },

    pdf: function(){ if(window.C_pdf) window.C_pdf(); }
  };
})();

// ── DISTANZE INTER-CENTROIDE ───────────────────────────────────────────────
function renderDistances(){
  var p = window._LR;
  var el = document.getElementById('dist-content');
  var empty = document.getElementById('dist-empty');
  if(!p || !p.pairs || !p.pairs.length){ if(el) el.style.display='none'; if(empty) empty.style.display='block'; return; }

  if(empty) empty.style.display='none';
  if(el) el.style.display='block';

  var ctA = p.pairs.map(function(pp){ return pp.a; });
  var ctB = p.pairs.map(function(pp){ return pp.b; });

  function dist3(a,b){
    if(!a||!b) return null;
    return Math.sqrt((a[0]-b[0])*(a[0]-b[0])+(a[1]-b[1])*(a[1]-b[1])+(a[2]-b[2])*(a[2]-b[2]));
  }
  function diffColor(diff_um){
    var a=Math.abs(diff_um);
    if(a<50) return{col:'#3a7d08',bg:'#EAF3DE',border:'#a3d26a'};
    if(a<100) return{col:'#D97706',bg:'#FEFCE8',border:'#f5d06a'};
    if(a<200) return{col:'#ea5a00',bg:'#FFF3E0',border:'#f9b97a'};
    return{col:'#c91a1a',bg:'#FEE2E2',border:'#f9a0a0'};
  }
  function allPairs(n){
    var out=[];
    for(var i=0;i<n;i++) for(var j=i+1;j<n;j++) out.push([i,j]);
    return out;
  }

  var n = ctA.length;
  var pairs = allPairs(n);

  // ── Calcola proiezione PCA globale (usata da tutti i mini-canvas)
  var cmx=0,cmy=0,cmz=0;
  ctA.forEach(function(pt){cmx+=pt[0]/n;cmy+=pt[1]/n;cmz+=pt[2]/n;});
  var cov=[[0,0,0],[0,0,0],[0,0,0]];
  ctA.forEach(function(pt){
    var d=[pt[0]-cmx,pt[1]-cmy,pt[2]-cmz];
    for(var ii=0;ii<3;ii++)for(var jj=0;jj<3;jj++)cov[ii][jj]+=d[ii]*d[jj]/n;
  });
  var eig=jacobi3(cov);
  var ord=[0,1,2].sort(function(a,b){return eig.vals[b]-eig.vals[a];});
  var u1=[eig.vecs[0][ord[0]],eig.vecs[1][ord[0]],eig.vecs[2][ord[0]]];
  var u2=[eig.vecs[0][ord[1]],eig.vecs[1][ord[1]],eig.vecs[2][ord[1]]];

  function proj(pt){
    var dx=pt[0]-cmx,dy=pt[1]-cmy,dz=pt[2]-cmz;
    return[dx*u1[0]+dy*u1[1]+dz*u1[2], dx*u2[0]+dy*u2[1]+dz*u2[2]];
  }

  // Calcola tutti i punti proiettati
  var projA = ctA.map(proj);
  var projB = ctB.map(function(pt){ return pt ? proj(pt) : null; });

  // Bounds globali (usati da tutti i mini-canvas per la stessa scala)
  var allP=[];
  projA.forEach(function(pt){allP.push(pt);});
  projB.forEach(function(pt){if(pt)allP.push(pt);});
  var p1s=allP.map(function(pt){return pt[0];}), p2s=allP.map(function(pt){return pt[1];});
  var mn1=Math.min.apply(null,p1s), mx1=Math.max.apply(null,p1s);
  var mn2=Math.min.apply(null,p2s), mx2=Math.max.apply(null,p2s);
  var rg=Math.max(mx1-mn1,mx2-mn2,0.001), margin=rg*0.35;
  var c1=(mn1+mx1)/2, c2=(mn2+mx2)/2;
  var totalSpan=rg+margin*2;
  // Funzione di proiezione su canvas con padding
  function toCanvas(pt2d, W, H, pad){
    return[
      pad+(pt2d[0]-(c1-totalSpan/2))/totalSpan*(W-pad*2),
      H-pad-(pt2d[1]-(c2-totalSpan/2))/totalSpan*(H-pad*2)
    ];
  }

  // ── Info header
  var h = '';
  h += '<div class="sr" style="margin-bottom:18px">'
    + '<div class="sc"><div class="sl2">Oggetti A</div><div class="sv" style="color:var(--blue)">'+n+'</div></div>'
    + '<div class="sc"><div class="sl2">Oggetti B</div><div class="sv" style="color:#ba7517">'+ctB.filter(Boolean).length+'</div></div>'
    + '<div class="sc"><div class="sl2">Combinazioni</div><div class="sv">'+pairs.length+'</div></div>'
    + '<div class="sc"><div class="sl2">File A</div><div class="sv" style="font-size:11px;color:var(--gray);font-family:var(--mono)">'+p.nA+'</div></div>'
    + '</div>';

  // ── Griglia mini-mappe per coppia
  h += '<div class="sl" style="margin-bottom:12px">Mappa distanze per coppia di centroidi</div>';
  h += '<div style="font-size:10px;color:var(--gray);margin-bottom:14px;font-family:var(--mono)">'
    + '⬤ = centroide A (riferimento) &nbsp;◆ = centroide B (post-ICP) &nbsp;— = distanza A &nbsp;┄ = distanza B'
    + '</div>';
  h += '<div id="dist-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px;margin-bottom:24px"></div>';

  // ── Tabella confronto principale
  var rowsCmp = '';
  pairs.forEach(function(ij){
    var i=ij[0], j=ij[1];
    var dA = dist3(ctA[i], ctA[j]);
    var dB = (ctB[i] && ctB[j]) ? dist3(ctB[i], ctB[j]) : null;
    var diff = dB !== null ? (dB - dA) * 1000 : null;
    var lv = diff !== null ? diffColor(diff) : {col:'#9ca3af',bg:'transparent',border:'transparent'};
    rowsCmp += '<tr>'
      + '<td style="font-weight:700;color:var(--dark)">#'+(i+1)+' ↔ #'+(j+1)+'</td>'
      + '<td style="color:#1a5f9e;font-family:var(--mono)">'+(dA*1000).toFixed(1)+' μm</td>'
      + (dB!==null
          ? '<td style="color:#ba7517;font-family:var(--mono)">'+(dB*1000).toFixed(1)+' μm</td>'
            + '<td><span style="font-weight:700;color:'+lv.col+';background:'+lv.bg+';border:1px solid '+lv.border+';border-radius:6px;padding:3px 10px;font-family:var(--mono);font-size:12px">'
            + (diff>=0?'+':'')+diff.toFixed(1)+' μm</span></td>'
          : '<td style="color:var(--gray)">—</td><td style="color:var(--gray)">—</td>')
      + '</tr>';
  });

  h += '<div class="sl" style="margin-bottom:8px">Riepilogo numerico</div>';
  h += '<div class="info-amber" style="margin-bottom:12px">Δ = dist<sub>B</sub> − dist<sub>A</sub>. Valori positivi = centroidi più distanti in B rispetto ad A.</div>';
  h += '<div style="overflow-x:auto"><table><thead><tr>'
    + '<th style="text-align:left">Coppia</th>'
    + '<th>Dist A</th>'
    + '<th>Dist B</th>'
    + '<th>Δ</th>'
    + '</tr></thead><tbody>'+rowsCmp+'</tbody></table></div>';

  el.innerHTML = h;

  // ── Disegna le mini-mappe per ogni coppia
  setTimeout(function(){
    var grid = document.getElementById('dist-grid');
    if(!grid) return;

    pairs.forEach(function(ij, k){
      var i=ij[0], j=ij[1];
      var dA = dist3(ctA[i], ctA[j]);
      var dB = (ctB[i]&&ctB[j]) ? dist3(ctB[i], ctB[j]) : null;
      var diff = dB!==null ? (dB-dA)*1000 : null;
      var lv = diff!==null ? diffColor(diff) : {col:'#6b7280',bg:'#f3f4f6',border:'#e5e7eb'};

      // Card wrapper
      var card = document.createElement('div');
      card.style.cssText = 'background:#fff;border:1.5px solid '+lv.border+';border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.06)';

      // Card header
      var hdr = document.createElement('div');
      hdr.style.cssText = 'background:'+lv.bg+';padding:10px 14px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid '+lv.border;
      hdr.innerHTML = '<span style="font-weight:700;color:'+lv.col+';font-size:13px;font-family:var(--mono)">#'+(i+1)+' ↔ #'+(j+1)+'</span>'
        + '<span style="font-size:11px;font-family:var(--mono);color:#6b7280">'
        + '<span style="color:#1a5f9e">A:'+(dA*1000).toFixed(1)+'μ</span>'
        + (dB!==null ? ' &nbsp;<span style="color:#ba7517">B:'+(dB*1000).toFixed(1)+'μ</span>' : '')
        + (diff!==null ? ' &nbsp;<strong style="color:'+lv.col+'">'+(diff>=0?'+':'')+diff.toFixed(1)+'μ</strong>' : '')
        + '</span>';

      // Canvas
      var cv = document.createElement('canvas');
      cv.width = 320; cv.height = 200;
      cv.style.cssText = 'width:100%;display:block';

      card.appendChild(hdr);
      card.appendChild(cv);
      grid.appendChild(card);

      // Disegna mini-mappa
      drawPairMap(cv, projA, projB, i, j, dA, dB, diff, lv, toCanvas);
    });
  }, 60);
}

// ── Disegna una mini-mappa per una singola coppia ─────────────────────────
function drawPairMap(cv, projA, projB, hi, hj, dA, dB, diff, lv, toCanvas){
  var ctx = cv.getContext('2d');
  var W=cv.width, H=cv.height;
  var pad=28;
  var n=projA.length;

  ctx.clearRect(0,0,W,H);
  ctx.fillStyle='#fafafa'; ctx.fillRect(0,0,W,H);

  function sc(pt2d){ return toCanvas(pt2d,W,H,pad); }

  // ── STEP 1: Disegna TUTTE le linee di sfondo (grigio leggero)
  for(var i=0;i<n;i++){
    for(var j=i+1;j<n;j++){
      if(i===hi&&j===hj) continue; // la coppia evidenziata la disegno dopo
      var pA=sc(projA[i]), qA=sc(projA[j]);
      ctx.beginPath(); ctx.moveTo(pA[0],pA[1]); ctx.lineTo(qA[0],qA[1]);
      ctx.strokeStyle='rgba(200,210,225,0.6)'; ctx.lineWidth=1; ctx.stroke();
      // linea B di sfondo
      if(projB[i]&&projB[j]){
        var pB=sc(projB[i]), qB=sc(projB[j]);
        ctx.beginPath(); ctx.moveTo(pB[0],pB[1]); ctx.lineTo(qB[0],qB[1]);
        ctx.strokeStyle='rgba(220,195,150,0.4)'; ctx.lineWidth=1;
        ctx.setLineDash([3,3]); ctx.stroke(); ctx.setLineDash([]);
      }
    }
  }

  // ── STEP 2: Linea evidenziata A (blu solido)
  var pA=sc(projA[hi]), qA=sc(projA[hj]);
  // Alone / glow
  ctx.beginPath(); ctx.moveTo(pA[0],pA[1]); ctx.lineTo(qA[0],qA[1]);
  ctx.strokeStyle='rgba(26,95,158,0.12)'; ctx.lineWidth=10; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(pA[0],pA[1]); ctx.lineTo(qA[0],qA[1]);
  ctx.strokeStyle='#1a5f9e'; ctx.lineWidth=2.5; ctx.stroke();
  // Label distanza A al centro
  var mxA=(pA[0]+qA[0])/2, myA=(pA[1]+qA[1])/2;
  var ang=Math.atan2(qA[1]-pA[1],qA[0]-pA[0]);
  ctx.save();
  ctx.translate(mxA,myA); ctx.rotate(ang);
  ctx.fillStyle='#fff';
  ctx.fillRect(-28,-13,56,14);
  ctx.fillStyle='#1a5f9e'; ctx.font='bold 9px monospace'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText((dA*1000).toFixed(1)+' μm',0,-6);
  ctx.restore();

  // ── STEP 3: Linea evidenziata B (arancione tratteggiata)
  if(projB[hi]&&projB[hj]&&dB!==null){
    var pB=sc(projB[hi]), qB=sc(projB[hj]);
    ctx.beginPath(); ctx.moveTo(pB[0],pB[1]); ctx.lineTo(qB[0],qB[1]);
    ctx.strokeStyle='rgba(186,117,23,0.15)'; ctx.lineWidth=8; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(pB[0],pB[1]); ctx.lineTo(qB[0],qB[1]);
    ctx.strokeStyle='#ba7517'; ctx.lineWidth=2; ctx.setLineDash([5,3]); ctx.stroke();
    ctx.setLineDash([]);
    var mxB=(pB[0]+qB[0])/2, myB=(pB[1]+qB[1])/2;
    var angB=Math.atan2(qB[1]-pB[1],qB[0]-pB[0]);
    ctx.save();
    ctx.translate(mxB,myB); ctx.rotate(angB);
    ctx.fillStyle='#fff8ee';
    ctx.fillRect(-28,0,56,14);
    ctx.fillStyle='#ba7517'; ctx.font='bold 9px monospace'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText((dB*1000).toFixed(1)+' μm',0,7);
    ctx.restore();
  }

  // ── STEP 4: Tutti i nodi A grigio sfondo
  for(var i=0;i<n;i++){
    if(i===hi||i===hj) continue;
    var pa=sc(projA[i]);
    ctx.beginPath(); ctx.arc(pa[0],pa[1],6,0,Math.PI*2);
    ctx.fillStyle='rgba(200,215,235,0.7)'; ctx.fill();
    ctx.strokeStyle='#b0c4de'; ctx.lineWidth=1; ctx.stroke();
    ctx.fillStyle='#9ba8b8'; ctx.font='bold 8px monospace'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(''+(i+1),pa[0],pa[1]);
    ctx.textBaseline='alphabetic';
  }

  // ── STEP 5: Tutti i nodi B grigio sfondo
  for(var i=0;i<n;i++){
    if(i===hi||i===hj) continue;
    if(!projB[i]) continue;
    var pb=sc(projB[i]);
    ctx.beginPath(); ctx.arc(pb[0],pb[1],5,0,Math.PI*2);
    ctx.fillStyle='rgba(235,215,185,0.6)'; ctx.fill();
    ctx.strokeStyle='#d4b47a'; ctx.lineWidth=1; ctx.stroke();
  }

  // ── STEP 6: Nodi A evidenziati (hi, hj)
  [hi,hj].forEach(function(idx){
    var pa=sc(projA[idx]);
    // alone
    ctx.beginPath(); ctx.arc(pa[0],pa[1],13,0,Math.PI*2);
    ctx.fillStyle='rgba(26,95,158,0.08)'; ctx.fill();
    ctx.beginPath(); ctx.arc(pa[0],pa[1],8,0,Math.PI*2);
    ctx.fillStyle='rgba(26,95,158,0.12)'; ctx.fill();
    ctx.strokeStyle='#1a5f9e'; ctx.lineWidth=2; ctx.stroke();
    ctx.fillStyle='#1a5f9e'; ctx.font='bold 9px monospace'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(''+(idx+1),pa[0],pa[1]);
    ctx.textBaseline='alphabetic';
    // label fuori
    var lbx=pa[0], lby=pa[1]-18;
    ctx.fillStyle='#1a5f9e'; ctx.font='bold 8px monospace'; ctx.textAlign='center';
    ctx.fillText('A'+(idx+1),lbx,lby);
  });

  // ── STEP 7: Nodi B evidenziati (hi, hj)
  [hi,hj].forEach(function(idx){
    if(!projB[idx]) return;
    var pb=sc(projB[idx]);
    ctx.beginPath(); ctx.arc(pb[0],pb[1],7,0,Math.PI*2);
    ctx.fillStyle='#ba7517'; ctx.fill();
    ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.stroke();
    // diamond indicator
    ctx.fillStyle='#fff'; ctx.font='bold 9px monospace'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(''+(idx+1),pb[0],pb[1]);
    ctx.textBaseline='alphabetic';
    ctx.fillStyle='#ba7517'; ctx.font='bold 8px monospace'; ctx.textAlign='center';
    ctx.fillText('B'+(idx+1),pb[0],pb[1]+16);
  });

  // ── STEP 8: Badge Δ in alto a destra del canvas
  if(diff!==null){
    var badge=(diff>=0?'+':'')+diff.toFixed(1)+' μm';
    ctx.font='bold 10px monospace';
    var bw=ctx.measureText(badge).width+20;
    var bx=W-bw-6, by=6;
    ctx.fillStyle=lv.bg;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(bx,by,bw,18,4) : ctx.rect(bx,by,bw,18);
    ctx.fill();
    ctx.strokeStyle=lv.border; ctx.lineWidth=1; ctx.stroke();
    ctx.fillStyle=lv.col; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(badge,bx+bw/2,by+9);
    ctx.textBaseline='alphabetic';
  }

  // ── STEP 9: Label fisso in basso (scala PCA)
  ctx.fillStyle='rgba(156,163,175,0.8)'; ctx.font='7px monospace'; ctx.textAlign='left'; ctx.textBaseline='alphabetic';
  ctx.fillText('PCA projection',pad,H-4);
}

// Wire up FILES global
window._FILES = FILES;
window.FILES = FILES;

// ── Reset app ──────────────────────────────────────────────────────────────
function resetApp(){
  // Clear file inputs
  FILES.A = null; FILES.B = null;
  window._FILES = FILES;
  var iA=document.getElementById('iA'), iB=document.getElementById('iB');
  if(iA) iA.value='';
  if(iB) iB.value='';

  // Reset dropzones
  ['A','B'].forEach(function(s){
    var z=document.getElementById('z'+s);
    var h=document.getElementById('h'+s);
    if(z){ z.classList.remove('ok','ov'); }
    if(h){ h.innerHTML=T('dropHint'); }
    var lbl=document.getElementById('lbl-file'+s);
    if(lbl) lbl.textContent=T('drop'+s);
  });

  // Reset run button
  var btn=document.getElementById('run');
  if(btn){ btn.disabled=true; btn.classList.remove('on'); btn.textContent=T('btnRun'); }

  // Clear results
  var res=document.getElementById('res');
  if(res){ res.innerHTML=''; res.style.display='none'; }
  var err=document.getElementById('err');
  if(err){ err.style.display='none'; }

  // Clear LR
  window._LR = null;

  // Switch to analisi tab
  switchTab('analisi');
  document.querySelectorAll('.nav-tab').forEach(function(b){ b.classList.remove('active'); });
  var t=document.getElementById('tab-analisi');
  if(t) t.classList.add('active');

  // Scroll to top
  window.scrollTo(0,0);
}
