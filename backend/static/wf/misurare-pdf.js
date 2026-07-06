/*
 * wf/misurare-pdf.js — MISURARE report PDF/Excel di Synthesis-ICP (Fase 6f modularizzazione). 2/3 di Misurare.
 *
 * CONTRATTO: 41 function declaration del dominio §MISURARE-PDF/§REPORT-PIPELINE/§CERTIFICATO-TARATURA —
 * report clinico PDF 6 pagine (jsPDF), disegni tecnici (cilindro/freccia/centroide), grafico centroidi,
 * metodologia/glossario, certificato di taratura (modal + pagine + firme), export Excel (XLSX). Nomi bare globali invariati.
 * Estrazione "functions-only": lo STATO e le costanti restano nel monolite; RESIDUO CRITICO che RESTA:
 * il blocco preload immagine _synScaricoConoImg=new Image(); .src=... (statement parse-time, NON una fn,
 * escluso dall'estrazione) e i banner §MISURARE-PDF/§REPORT-PIPELINE/§CERTIFICATO-TARATURA (check_anchors).
 * DIPENDENZE call-time: window.jspdf (CDN head), XLSX (CDN head), synLog, window.SYN, misICP_result (stato).
 * CARICAMENTO: <script src> classico NON-strict in testa (dopo wf/misurare-icp.js), PRIMA del MAIN.
 * GATE: scripts/gate/mis-pdf/gate.mjs (41 md5-verbatim + esposizione + residuo + wiring).
 */

function misICP_hexRGB(h){ return [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)]; }

function misICP_getScaleUm(pairs){
  var maxD3=pairs.reduce(function(m,pp){return pp.d3!==null ? Math.max(m,pp.d3) : m;},0)*1000;
  return maxD3<50?50:(maxD3<100?100:(maxD3<150?150:(maxD3<250?250:500)));
}

// Score globale: L6-norm combinata di XY, Z, angolo asse con decay iperbolico.
// (dalla funzione calcScore del Comparator v7)
function misICP_calcScore(pairs, cylAxes){
  if(!pairs || !pairs.length) return 0;
  var valid=pairs.filter(function(p){return p.d3!==null;});
  if(!valid.length) return 0;
  var n=valid.length;
  var L6xy=Math.pow(valid.reduce(function(s,p){return s+Math.pow(Math.abs(p.dxy*1000),6);},0)/n, 1/6);
  var L6z =Math.pow(valid.reduce(function(s,p){return s+Math.pow(Math.abs(p.dz*1000),6);},0)/n, 1/6);
  var L6ax=0;
  if(cylAxes && cylAxes.length){
    var axVals=cylAxes.filter(function(a){return a && a.angleDeg!==null;});
    if(axVals.length){
      L6ax=Math.pow(axVals.reduce(function(s,a){return s+Math.pow(a.angleDeg*30,6);},0)/axVals.length, 1/6);
    }
  }
  var eff=Math.sqrt(L6xy*L6xy*0.55 + L6z*L6z*0.30 + L6ax*L6ax*0.15);
  // v7.3.9.082 SCORE MODEL CANONICO (Syntesis Score v1.0)
  // Sincronizzato con backend/icp_engine.calc_score()
  // Curva iperbole: inflection 110um, steepness 1.5
  var score=100/(1+Math.pow(eff/110,1.5));
  return Math.max(0, Math.min(100, Math.round(score*100)/100));
}
function misICP_scoreLabel(s){
  // v7.3.9.082 SCORE MODEL CANONICO - soglie sincronizzate con backend
  // backend/icp_engine.score_label(): >=85 Eccellente, >=70 Buono, >=50 Sufficiente, >=33 Scarso, <33 Critico
  if(s>=85) return {label:'Eccellente',  col:'#639922', bg:'#EAF3DE', fg:'#3B6D11'};
  if(s>=70) return {label:'Buono',       col:'#D97706', bg:'#FEFCE8', fg:'#854D0E'};
  if(s>=50) return {label:'Sufficiente', col:'#F97316', bg:'#FFF3E0', fg:'#9A3412'};
  if(s>=33) return {label:'Insufficiente',col:'#EF4444', bg:'#FEE2E2', fg:'#991B1B'};
  return           {label:'Critico',     col:'#A855F7', bg:'#F3E0F7', fg:'#6B21A8'};
}

// Card di analisi deviazione: anello gauge + bussola + barre dX/dY/dZ (Comparator)
function misICP_drawCard(cv,dxum,dyum,dzum,d3um,scaleUm,axDeg){
  if(!cv) return;
  var ctx=cv.getContext('2d'), W=cv.width, H=cv.height;
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle='#ffffff'; ctx.fillRect(0,0,W,H);
  var lv=misICP_clinLevel(d3um);
  var colAx=0,colAw=210, colBx=220,colBw=200, colCx=430,colCw=W-440;

  // GAUGE
  var gcx=colAx+colAw/2, gr=Math.min(colAw/2-18, H*0.40), gcy=gr+20;
  ctx.beginPath(); ctx.arc(gcx,gcy,gr,Math.PI,0);
  ctx.strokeStyle='#eeeeee'; ctx.lineWidth=gr*0.22; ctx.stroke();
  var zc=['#63992244','#D9770644','#F9731644','#EF444444','#A855F744'];
  var zb=[0,0.2,0.4,0.6,0.8,1.0];
  zb.forEach(function(from,zi){
    if(zi>=5) return;
    ctx.beginPath(); ctx.arc(gcx,gcy,gr,Math.PI*(1-from),Math.PI*(1-zb[zi+1]),true);
    ctx.strokeStyle=zc[zi]; ctx.lineWidth=gr*0.22; ctx.stroke();
  });
  var frac=Math.min(1, d3um/scaleUm);
  if(frac>0.005){
    ctx.beginPath(); ctx.arc(gcx,gcy,gr,Math.PI,Math.PI*(1-frac),true);
    ctx.strokeStyle=lv.col; ctx.lineWidth=gr*0.22; ctx.stroke();
  }
  var na=Math.PI*(1-frac);
  var nx=gcx+gr*Math.cos(na), ny=gcy+gr*Math.sin(na);
  ctx.beginPath(); ctx.arc(nx,ny,gr*0.10,0,Math.PI*2);
  ctx.fillStyle=lv.col; ctx.fill();
  ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.stroke();
  ctx.fillStyle='#c0c5ce'; ctx.font='8px monospace'; ctx.textAlign='center';
  ctx.fillText('0', gcx-gr-8, gcy+6);
  ctx.fillText(''+scaleUm, gcx+gr+8, gcy+6);
  var valY = gcy + 18;
  ctx.fillStyle=lv.col;
  ctx.font='bold '+Math.min(38,Math.round(gr*0.55))+'px monospace';
  ctx.textAlign='center'; ctx.fillText(''+d3um, gcx, valY);
  ctx.fillStyle='#9ca3af'; ctx.font='10px monospace'; ctx.textAlign='center';
  ctx.fillText('\u00b5m  /  '+scaleUm, gcx, valY+16);

  // COMPASS
  var ccx=colBx+colBw/2, ccy=H/2, cr=Math.min(colBw/2-12, H/2-14);
  ctx.beginPath(); ctx.arc(ccx,ccy,cr,0,Math.PI*2);
  ctx.strokeStyle='#e5e7eb'; ctx.lineWidth=1.5; ctx.stroke();
  ctx.beginPath(); ctx.arc(ccx,ccy,cr*0.45,0,Math.PI*2);
  ctx.strokeStyle='#f0f0f0'; ctx.lineWidth=0.8; ctx.stroke();
  ctx.strokeStyle='#f0f0f0'; ctx.lineWidth=0.7; ctx.setLineDash([2,4]);
  ctx.beginPath(); ctx.moveTo(ccx,ccy-cr+4); ctx.lineTo(ccx,ccy+cr-4); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(ccx-cr+4,ccy); ctx.lineTo(ccx+cr-4,ccy); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle='#c0c5ce'; ctx.font='bold 8px monospace'; ctx.textAlign='center';
  ctx.fillText('N',ccx,ccy-cr-4); ctx.fillText('S',ccx,ccy+cr+10);
  ctx.textAlign='left'; ctx.fillText('E',ccx+cr+4,ccy+3);
  ctx.textAlign='right'; ctx.fillText('O',ccx-cr-4,ccy+3);
  var bearing=Math.atan2(dxum,-dyum), arrowLen=cr*0.76;
  var bx=ccx+arrowLen*Math.sin(bearing), by=ccy-arrowLen*Math.cos(bearing);
  ctx.strokeStyle=lv.col; ctx.lineWidth=2.5;
  ctx.beginPath(); ctx.moveTo(ccx,ccy); ctx.lineTo(bx,by); ctx.stroke();
  var ah=cr*0.17, aa=Math.atan2(by-ccy,bx-ccx);
  ctx.fillStyle=lv.col; ctx.beginPath();
  ctx.moveTo(bx,by);
  ctx.lineTo(bx-ah*Math.cos(aa-0.42),by-ah*Math.sin(aa-0.42));
  ctx.lineTo(bx-ah*Math.cos(aa+0.42),by-ah*Math.sin(aa+0.42));
  ctx.closePath(); ctx.fill();
  var dxy=Math.sqrt(dxum*dxum+dyum*dyum);
  if(dxy>1){
    var mx=ccx+arrowLen*0.52*Math.sin(bearing)+11*Math.cos(aa+Math.PI/2);
    var my=ccy-arrowLen*0.52*Math.cos(bearing)+11*Math.sin(aa+Math.PI/2);
    ctx.fillStyle=lv.col; ctx.font='bold 9px monospace'; ctx.textAlign='center';
    ctx.fillText(Math.round(dxy)+'\u00b5m',mx,my);
  }
  ctx.beginPath(); ctx.arc(ccx,ccy,4,0,Math.PI*2);
  ctx.fillStyle='#1a5f9e'; ctx.fill(); ctx.strokeStyle='#fff'; ctx.lineWidth=1.5; ctx.stroke();
  if(dxy>1){
    ctx.beginPath(); ctx.arc(bx,by,4,0,Math.PI*2);
    ctx.fillStyle=lv.col; ctx.fill(); ctx.strokeStyle='#fff'; ctx.lineWidth=1.5; ctx.stroke();
  }
  if(Math.abs(dzum)>2){
    var zcol=dzum>0?'#EF4444':'#378ADD';
    var zbg=dzum>0?'rgba(254,226,226,0.9)':'rgba(230,241,251,0.9)';
    var zbx=colBx+colBw-14, zby=10;
    ctx.beginPath(); ctx.arc(zbx,zby,11,0,Math.PI*2);
    ctx.fillStyle=zbg; ctx.fill(); ctx.strokeStyle=zcol; ctx.lineWidth=1; ctx.stroke();
    ctx.fillStyle=zcol; ctx.font='bold 7px monospace'; ctx.textAlign='center';
    ctx.fillText(dzum>0?'\u2191':'\u2193',zbx,zby+2.5);
    ctx.font='6px monospace'; ctx.fillText(Math.abs(dzum),zbx,zby+11);
  }

  // BARS
  var rx=colCx+4, ry=10, valLblW=52, barX=rx+24, barW2=W-barX-valLblW-4, barH2=8, rowH=22;
  var comps=[['dX',dxum,'#378ADD'],['dY',dyum,'#1D9E75'],['dZ',dzum,'#EF4444']];
  comps.forEach(function(c,ci){
    var cy2=ry+ci*rowH;
    ctx.fillStyle='#6b7280'; ctx.font='bold 9px monospace'; ctx.textAlign='left';
    ctx.fillText(c[0],rx,cy2+barH2);
    ctx.fillStyle='#f0f0f0'; ctx.fillRect(barX,cy2,barW2,barH2);
    ctx.strokeStyle='#d1d5db'; ctx.lineWidth=0.8;
    ctx.beginPath(); ctx.moveTo(barX+barW2/2,cy2); ctx.lineTo(barX+barW2/2,cy2+barH2); ctx.stroke();
    var vf=Math.min(1, Math.abs(c[1])/Math.max(1,scaleUm));
    var vw2=vf*barW2/2; if(vw2<1) vw2=1;
    var vx=c[1]>=0 ? barX+barW2/2 : barX+barW2/2-vw2;
    ctx.fillStyle=c[2]; ctx.fillRect(vx,cy2+1,vw2,barH2-2);
    ctx.fillStyle=c[2]; ctx.font='bold 9px monospace'; ctx.textAlign='right';
    ctx.fillText((c[1]>=0?'+':'')+c[1]+'\u00b5m',W-4,cy2+barH2);
  });
  var d3y=ry+3*rowH+6;
  ctx.fillStyle=lv.col; ctx.font='bold 15px monospace'; ctx.textAlign='left';
  ctx.fillText('|D| '+d3um+' \u00b5m',rx,d3y);
  ctx.fillStyle='#9ca3af'; ctx.font='9px monospace';
  ctx.fillText('scala 0-'+scaleUm+' \u00b5m',rx,d3y+14);
  if(axDeg!==null && axDeg!==undefined){
    var lax=misICP_clinAx(axDeg);
    var axy=d3y+32;
    ctx.strokeStyle=lax.col; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.moveTo(rx,axy); ctx.lineTo(rx+8,axy-5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(rx+3,axy+1); ctx.lineTo(rx+11,axy-4); ctx.stroke();
    ctx.fillStyle=lax.col; ctx.font='bold 10px monospace'; ctx.textAlign='left';
    ctx.fillText('Asse '+axDeg.toFixed(2)+'\u00b0  -  '+lax.label, rx+14, axy);
  }
}

// Mappa colorimetrica 2D con PCA best-fit plane (Comparator)
function misICP_drawColorMap(cv, pairs, opts){
  if(!cv || !pairs || !pairs.length) return;
  opts = opts || {};
  // opts.compact = true     -> riduce padT/padB per layout pagina coppie
  // opts.highlightPair      -> { iA, iB, distA_um, distB_um, lv } sovrappone
  //                            il segmento della coppia corrente con le sue
  //                            distanze A e B come label ruotata.
  var ctx=cv.getContext('2d'), W=cv.width, H=cv.height;
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle='#f9fafb'; ctx.fillRect(0,0,W,H);
  ctx.fillStyle='#ffffff'; ctx.fillRect(2,2,W-4,H-4);
  ctx.strokeStyle='#e5e7eb'; ctx.lineWidth=1; ctx.strokeRect(2,2,W-4,H-4);
  var padL=52, padR=40;
  var padT = opts.compact ? 14 : 36;
  var padB = opts.compact ? 50 : 60;
  var vw=W-padL-padR, vh=H-padT-padB;
  var n=pairs.length;
  var cmx=0, cmy=0, cmz=0;
  pairs.forEach(function(pp){ cmx+=pp.a[0]/n; cmy+=pp.a[1]/n; cmz+=pp.a[2]/n; });
  var cov=[[0,0,0],[0,0,0],[0,0,0]];
  pairs.forEach(function(pp){
    var d=[pp.a[0]-cmx, pp.a[1]-cmy, pp.a[2]-cmz];
    for(var i=0;i<3;i++) for(var j=0;j<3;j++) cov[i][j]+=d[i]*d[j]/n;
  });
  var eig=misICP_jacobi3(cov);
  var ord=[0,1,2].sort(function(a,b){return eig.vals[b]-eig.vals[a];});
  var u1=[eig.vecs[0][ord[0]],eig.vecs[1][ord[0]],eig.vecs[2][ord[0]]];
  var u2=[eig.vecs[0][ord[1]],eig.vecs[1][ord[1]],eig.vecs[2][ord[1]]];
  var u3=[eig.vecs[0][ord[2]],eig.vecs[1][ord[2]],eig.vecs[2][ord[2]]];
  function pcaProj(x,y,z){
    var dx=x-cmx, dy=y-cmy, dz=z-cmz;
    return [dx*u1[0]+dy*u1[1]+dz*u1[2], dx*u2[0]+dy*u2[1]+dz*u2[2]];
  }
  var allP2=[];
  pairs.forEach(function(pp){
    allP2.push(pcaProj(pp.a[0],pp.a[1],pp.a[2]));
    if(pp.b) allP2.push(pcaProj(pp.b[0],pp.b[1],pp.b[2]));
  });
  var p1s=allP2.map(function(p){return p[0];}), p2s=allP2.map(function(p){return p[1];});
  var mn1=Math.min.apply(null,p1s), mx1=Math.max.apply(null,p1s);
  var mn2=Math.min.apply(null,p2s), mx2=Math.max.apply(null,p2s);
  var rg=Math.max(mx1-mn1, mx2-mn2) || 10, margin=rg*0.22;
  var scl=Math.min(vw/(rg+margin*2), vh/(rg+margin*2));
  var c1=(mn1+mx1)/2, c2=(mn2+mx2)/2;
  function sc(p1,p2){ return [padL+(p1-(c1-rg/2-margin))*scl, padT+vh-(p2-(c2-rg/2-margin))*scl]; }

  var gs=5;
  ctx.strokeStyle='rgba(220,228,235,0.55)'; ctx.lineWidth=0.5; ctx.setLineDash([3,4]);
  for(var g1=Math.floor((mn1-margin)/gs)*gs; g1<=(mx1+margin); g1+=gs){
    var gpx=sc(g1,0)[0]; if(gpx<padL-1 || gpx>padL+vw+1) continue;
    ctx.beginPath(); ctx.moveTo(gpx,padT); ctx.lineTo(gpx,padT+vh); ctx.stroke();
    ctx.fillStyle='rgba(150,160,170,0.85)'; ctx.font='7px monospace'; ctx.textAlign='center';
    ctx.fillText(g1.toFixed(0),gpx,padT+vh+12);
  }
  for(var g2=Math.floor((mn2-margin)/gs)*gs; g2<=(mx2+margin); g2+=gs){
    var gpy=sc(0,g2)[1]; if(gpy<padT-1 || gpy>padT+vh+1) continue;
    ctx.beginPath(); ctx.moveTo(padL,gpy); ctx.lineTo(padL+vw,gpy); ctx.stroke();
    ctx.fillStyle='rgba(150,160,170,0.85)'; ctx.font='7px monospace'; ctx.textAlign='right';
    ctx.fillText(g2.toFixed(0),padL-4,gpy+3);
  }
  ctx.setLineDash([]);
  ctx.fillStyle='#6b7280'; ctx.font='8px monospace'; ctx.textAlign='center';
  ctx.fillText('asse arcata (mm)', padL+vw/2, padT+vh+24);
  ctx.save(); ctx.translate(14, padT+vh/2); ctx.rotate(-Math.PI/2);
  ctx.fillText('trasversale (mm)',0,0); ctx.restore();

  // Curva arcata
  var archS=pairs.slice().sort(function(a,b){
    var pa=pcaProj(a.a[0],a.a[1],a.a[2]), pb=pcaProj(b.a[0],b.a[1],b.a[2]);
    return pa[0]-pb[0];
  });
  var ap=archS.map(function(pp){ var p=pcaProj(pp.a[0],pp.a[1],pp.a[2]); return sc(p[0],p[1]); });
  if(ap.length>=2){
    ctx.lineCap='round'; ctx.lineJoin='round';
    [20,12,5].forEach(function(lw,li){
      ctx.beginPath(); ap.forEach(function(pt,i){ if(i===0) ctx.moveTo(pt[0],pt[1]); else ctx.lineTo(pt[0],pt[1]); });
      ctx.strokeStyle='rgba(180,200,215,'+(0.10+li*0.06)+')'; ctx.lineWidth=lw; ctx.stroke();
    });
  }

  // Heatmap (bg chiaro: alpha leggermente piu' bassa per non saturare)
  pairs.forEach(function(pp){
    if(!pp.b) return;
    var d3um=Math.round(pp.d3*1000), lv=misICP_clinLevel(d3um);
    var pb=pcaProj(pp.b[0],pp.b[1],pp.b[2]), spb=sc(pb[0],pb[1]);
    var hr=Math.min(32, Math.max(16, d3um/20+16));
    var g=ctx.createRadialGradient(spb[0],spb[1],0,spb[0],spb[1],hr);
    g.addColorStop(0, lv.col+'44'); g.addColorStop(0.6, lv.col+'18'); g.addColorStop(1,'transparent');
    ctx.fillStyle=g; ctx.beginPath(); ctx.arc(spb[0],spb[1],hr,0,Math.PI*2); ctx.fill();
  });

  // Vettori A->B
  pairs.forEach(function(pp){
    if(!pp.b) return;
    var d3um=Math.round(pp.d3*1000), lv=misICP_clinLevel(d3um);
    var pa=pcaProj(pp.a[0],pp.a[1],pp.a[2]), spa=sc(pa[0],pa[1]);
    var pb=pcaProj(pp.b[0],pp.b[1],pp.b[2]), spb=sc(pb[0],pb[1]);
    var dx=spb[0]-spa[0], dy=spb[1]-spa[1], dist=Math.sqrt(dx*dx+dy*dy);
    if(dist<2) return;
    ctx.beginPath(); ctx.moveTo(spa[0],spa[1]); ctx.lineTo(spb[0],spb[1]);
    ctx.strokeStyle=lv.col+'cc'; ctx.lineWidth=2; ctx.stroke();
    var ang=Math.atan2(dy,dx), ah=7;
    ctx.fillStyle=lv.col; ctx.beginPath();
    ctx.moveTo(spb[0],spb[1]);
    ctx.lineTo(spb[0]-ah*Math.cos(ang-0.4), spb[1]-ah*Math.sin(ang-0.4));
    ctx.lineTo(spb[0]-ah*Math.cos(ang+0.4), spb[1]-ah*Math.sin(ang+0.4));
    ctx.closePath(); ctx.fill();
  });

  // EVIDENZIAZIONE COPPIA CORRENTE (solo se opts.highlightPair)
  // Disegno qui (dopo i vettori A->B, prima dei nodi A) cosi' il segmento blu
  // della distanza inter-centroide passa SOTTO i nodi (che lo coprono in
  // corrispondenza degli endpoint) ma SOPRA la heatmap. La label delle due
  // distanze e' ruotata lungo il segmento, con sfondo bianco per leggibilita'.
  if(opts.highlightPair){
    var hp = opts.highlightPair;
    var pi = pairs[hp.iA], pj = pairs[hp.iB];
    if(pi && pj){
      var paI=pcaProj(pi.a[0],pi.a[1],pi.a[2]), spaI=sc(paI[0],paI[1]);
      var paJ=pcaProj(pj.a[0],pj.a[1],pj.a[2]), spaJ=sc(paJ[0],paJ[1]);
      // Segmento blu solido A_i-A_j (= distanza A inter-centroide)
      ctx.strokeStyle='#0065B3'; ctx.lineWidth=4; ctx.lineCap='round';
      ctx.beginPath(); ctx.moveTo(spaI[0],spaI[1]); ctx.lineTo(spaJ[0],spaJ[1]); ctx.stroke();
      ctx.lineCap='butt';
      // Label ruotata con le due distanze A (blu) e B (arancione).
      // La differenza A vs B (qualche um su decine di mm) NON e' visibile a
      // scala reale; il valore informativo e' nei numeri delle label.
      var ang2=Math.atan2(spaJ[1]-spaI[1], spaJ[0]-spaI[0]);
      if(ang2 > Math.PI/2)  ang2 -= Math.PI;
      if(ang2 < -Math.PI/2) ang2 += Math.PI;
      var mxL=(spaI[0]+spaJ[0])/2, myL=(spaI[1]+spaJ[1])/2;
      ctx.save();
      ctx.translate(mxL, myL);
      ctx.rotate(ang2);
      ctx.font='bold 10px monospace';
      ctx.textAlign='center'; ctx.textBaseline='middle';
      var labA=hp.distA_um.toFixed(1)+'\u00b5m';
      var labB=hp.distB_um.toFixed(1)+'\u00b5m';
      var wA=ctx.measureText(labA).width, wB=ctx.measureText(labB).width;
      var maxWl=Math.max(wA,wB)+12;
      ctx.fillStyle='rgba(255,255,255,0.95)';
      ctx.strokeStyle='rgba(0,0,0,0.10)'; ctx.lineWidth=0.6;
      ctx.fillRect(-maxWl/2, -16, maxWl, 30);
      ctx.strokeRect(-maxWl/2, -16, maxWl, 30);
      ctx.fillStyle='#0065B3'; ctx.fillText(labA, 0, -5);
      ctx.fillStyle='#D97706'; ctx.fillText(labB, 0, 8);
      ctx.restore();
    }
  }

  // Posizioni A (cerchi blu su sfondo chiaro)
  // Se opts.highlightPair attivo, i due nodi della coppia corrente vengono
  // disegnati con stile evidenziato (riempimento blu pieno, numero bianco).
  pairs.forEach(function(pp,i){
    var pa=pcaProj(pp.a[0],pp.a[1],pp.a[2]), spa=sc(pa[0],pa[1]);
    var inPair = !!(opts.highlightPair && (i===opts.highlightPair.iA || i===opts.highlightPair.iB));
    if(inPair){
      ctx.beginPath(); ctx.arc(spa[0],spa[1],13,0,Math.PI*2);
      ctx.strokeStyle='rgba(26,95,158,0.35)'; ctx.lineWidth=3; ctx.stroke();
      ctx.beginPath(); ctx.arc(spa[0],spa[1],8,0,Math.PI*2);
      ctx.fillStyle='#0065B3'; ctx.fill();
      ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.stroke();
      ctx.fillStyle='#fff'; ctx.font='bold 9px monospace';
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(''+(i+1),spa[0],spa[1]); ctx.textBaseline='alphabetic';
    } else {
      ctx.beginPath(); ctx.arc(spa[0],spa[1],12,0,Math.PI*2);
      ctx.strokeStyle='rgba(26,95,158,0.22)'; ctx.lineWidth=3; ctx.stroke();
      ctx.beginPath(); ctx.arc(spa[0],spa[1],7,0,Math.PI*2);
      ctx.fillStyle='rgba(26,95,158,0.07)'; ctx.fill();
      ctx.strokeStyle='#1a5f9e'; ctx.lineWidth=1.5; ctx.stroke();
      ctx.fillStyle='#1a5f9e'; ctx.font='bold 8px monospace';
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(''+(i+1),spa[0],spa[1]); ctx.textBaseline='alphabetic';
    }
  });

  // Posizioni B + label
  pairs.forEach(function(pp,i){
    if(!pp.b) return;
    var d3um=Math.round(pp.d3*1000), lv=misICP_clinLevel(d3um);
    var pb=pcaProj(pp.b[0],pp.b[1],pp.b[2]), spb=sc(pb[0],pb[1]);
    ctx.beginPath(); ctx.arc(spb[0],spb[1],10,0,Math.PI*2);
    ctx.fillStyle=lv.col+'28'; ctx.fill();
    ctx.beginPath(); ctx.arc(spb[0],spb[1],6,0,Math.PI*2);
    ctx.fillStyle=lv.col; ctx.fill(); ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.stroke();
    ctx.fillStyle='#fff'; ctx.font='bold 8px monospace';
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(''+(i+1),spb[0],spb[1]); ctx.textBaseline='alphabetic';
    ctx.fillStyle=lv.col; ctx.font='bold 9px monospace'; ctx.textAlign='center';
    ctx.fillText(d3um+'\u00b5m',spb[0],spb[1]-16);
  });

  // Scale bar 10 mm
  var sbLen=10*scl, sbX=padL+vw-sbLen-4, sbY=padT+vh+36;
  ctx.strokeStyle='#374151'; ctx.lineWidth=2; ctx.lineCap='square';
  ctx.beginPath(); ctx.moveTo(sbX,sbY); ctx.lineTo(sbX+sbLen,sbY); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(sbX,sbY-3); ctx.lineTo(sbX,sbY+3); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(sbX+sbLen,sbY-3); ctx.lineTo(sbX+sbLen,sbY+3); ctx.stroke();
  ctx.fillStyle='#374151'; ctx.font='8px monospace'; ctx.textAlign='center';
  ctx.fillText('10 mm', sbX+sbLen/2, sbY+11);

  // Color scale bar destra
  var csX=padL+vw+8, csH=vh, csW=10;
  var cg=ctx.createLinearGradient(0,padT,0,padT+csH);
  cg.addColorStop(0,'#A855F7'); cg.addColorStop(0.3,'#EF4444');
  cg.addColorStop(0.5,'#F97316'); cg.addColorStop(0.7,'#D97706');
  cg.addColorStop(1,'#639922');
  ctx.fillStyle=cg; ctx.fillRect(csX,padT,csW,csH);
  ctx.strokeStyle='#e5e7eb'; ctx.lineWidth=0.5; ctx.strokeRect(csX,padT,csW,csH);
  [[0,'0'],[50,'50'],[100,'100'],[150,'150'],[250,'250'],[500,'500']].forEach(function(t){
    var ty=padT+csH-(t[0]/500)*csH;
    ctx.strokeStyle='#fff'; ctx.lineWidth=0.8; ctx.beginPath(); ctx.moveTo(csX,ty); ctx.lineTo(csX+csW,ty); ctx.stroke();
    ctx.fillStyle='#6b7280'; ctx.font='7px monospace'; ctx.textAlign='left';
    ctx.fillText(t[1], csX+csW+3, ty+3);
  });
  ctx.fillStyle='#9ca3af'; ctx.font='7px monospace'; ctx.textAlign='center';
  ctx.fillText('\u00b5m', csX+csW/2, padT+csH+10);

  // Legenda (chiara come nel report del 22/04)
  var lgY=padT+vh+46;
  ctx.beginPath(); ctx.arc(padL+6,lgY,5,0,Math.PI*2);
  ctx.strokeStyle='#1a5f9e'; ctx.lineWidth=1.5; ctx.fillStyle='rgba(26,95,158,0.08)'; ctx.fill(); ctx.stroke();
  ctx.fillStyle='#374151'; ctx.font='8px monospace'; ctx.textAlign='left';
  ctx.fillText('A = riferimento', padL+14, lgY+3);
  ctx.beginPath(); ctx.arc(padL+115,lgY,5,0,Math.PI*2);
  ctx.fillStyle='#EF4444'; ctx.fill(); ctx.strokeStyle='#fff'; ctx.lineWidth=1.5; ctx.stroke();
  ctx.fillStyle='#374151'; ctx.fillText('B = misurato (ICP)', padL+123, lgY+3);
  var planeAngle=Math.acos(Math.min(1,Math.abs(u3[2])))*180/Math.PI;
  ctx.fillStyle='#9ca3af'; ctx.font='7px monospace'; ctx.textAlign='right';
  ctx.fillText('Piano best-fit perp. Z: '+planeAngle.toFixed(1)+'\u00b0', padL+vw, lgY+3);
}

// Vista 3D ortogonale di un cilindro: mesh A blu + mesh B arancione sovrapposte
// con scale UNIFORME per non distorcere la geometria. Senza scale uniforme,
// stesso millimetro su X e Y produce pixel diversi (vw=232 vs vh=168) e i
// cilindri risultano ovalizzati anziche' circolari.
function misICP_paintView(cv, triA, triB, trisBg, ax1, ax2, axD, title){
  if(!cv) return;
  var ctx=cv.getContext('2d'), W=cv.width, H=cv.height, pd=4, th=14;
  var vw=W-pd*2, vh=H-pd*2-th;
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle='#f8f9fa'; ctx.fillRect(0,0,W,H);
  ctx.fillStyle='#fff'; ctx.fillRect(pd,pd,vw,vh);
  ctx.strokeStyle='#dee2e6'; ctx.lineWidth=1; ctx.strokeRect(pd,pd,vw,vh);
  var allT=(triA||[]).concat(triB||[]).concat(trisBg||[]);
  if(!allT.length){
    ctx.fillStyle='rgba(31,41,55,0.7)'; ctx.fillRect(pd,pd+vh,vw,th);
    ctx.fillStyle='#fff'; ctx.font='bold 9px monospace'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(title, W/2, pd+vh+th/2); return;
  }
  var mn1=Infinity, mx1=-Infinity, mn2=Infinity, mx2=-Infinity;
  allT.forEach(function(t){
    t.forEach(function(v){
      if(v[ax1]<mn1) mn1=v[ax1]; if(v[ax1]>mx1) mx1=v[ax1];
      if(v[ax2]<mn2) mn2=v[ax2]; if(v[ax2]>mx2) mx2=v[ax2];
    });
  });
  var rg=Math.max(mx1-mn1, mx2-mn2)||1, c1=(mn1+mx1)/2, c2=(mn2+mx2)/2, mg=rg*0.08;
  // SCALE UNIFORME: stesso fattore mm->px su entrambi gli assi -> niente
  // ovalizzazione. Centro il bounding-box nel viewport.
  var scl=Math.min(vw/(rg+mg*2), vh/(rg+mg*2));
  function px(v){
    return [pd+vw/2+(v[ax1]-c1)*scl, pd+vh/2-(v[ax2]-c2)*scl];
  }
  // Lista mista BG + A + B, ordinata per profondita' lungo axD (painter's
  // algorithm). Cosi' triangoli vicini coprono quelli lontani -> mesh dense
  // 100%, niente trasparenza.
  function pickItems(tris, max, color){
    if(!tris || !tris.length) return [];
    var step=Math.max(1, Math.ceil(tris.length/max));
    var out=[];
    for(var i=0;i<tris.length;i+=step){
      var t=tris[i];
      out.push({ t:t, d:(t[0][axD]+t[1][axD]+t[2][axD])/3, c:color });
    }
    return out;
  }
  // Background tenue (alpha bassa) cosi' la dentatura si intuisce senza
  // disturbare la lettura della mesh A/B.
  var COL_BG = { f:'rgba(180,185,195,0.22)', s:'rgba(160,165,175,0.18)' };
  // A e B 100% OPACHI: niente trasparenza, le mesh sono dense come richiesto.
  // Il painter's algorithm garantisce che i triangoli davanti coprano quelli
  // dietro in modo ordinato.
  var COL_A  = { f:'rgb(26,95,158)',  s:'rgb(14,61,102)' };
  var COL_B  = { f:'rgb(217,119,6)',  s:'rgb(133,79,11)' };
  var allItems = pickItems(trisBg, 6000, COL_BG)
    .concat(pickItems(triA, 8000, COL_A))
    .concat(pickItems(triB, 8000, COL_B));
  allItems.sort(function(a,b){ return a.d - b.d; });
  ctx.save(); ctx.lineWidth=0.3;
  allItems.forEach(function(item){
    var t=item.t, p0=px(t[0]), p1=px(t[1]), p2=px(t[2]);
    ctx.fillStyle=item.c.f; ctx.strokeStyle=item.c.s;
    ctx.beginPath(); ctx.moveTo(p0[0],p0[1]); ctx.lineTo(p1[0],p1[1]); ctx.lineTo(p2[0],p2[1]);
    ctx.closePath(); ctx.fill(); ctx.stroke();
  });
  ctx.restore();
  // Legenda A/B in alto a sinistra dentro il viewport
  var lpd=6, lh=18, lw=72;
  ctx.save();
  ctx.fillStyle='rgba(255,255,255,0.95)';
  ctx.fillRect(pd+lpd, pd+lpd, lw, lh);
  ctx.strokeStyle='rgba(0,0,0,0.12)'; ctx.lineWidth=0.5;
  ctx.strokeRect(pd+lpd, pd+lpd, lw, lh);
  // dot A
  ctx.fillStyle='#1A5F9E'; ctx.beginPath();
  ctx.arc(pd+lpd+5, pd+lpd+5.5, 2.4, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle='#0F1923'; ctx.font='bold 7px monospace'; ctx.textAlign='left'; ctx.textBaseline='middle';
  ctx.fillText('A Riferimento', pd+lpd+11, pd+lpd+5.5);
  // dot B
  ctx.fillStyle='#D97706'; ctx.beginPath();
  ctx.arc(pd+lpd+5, pd+lpd+lh-5.5, 2.4, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle='#0F1923';
  ctx.fillText('B Misurato', pd+lpd+11, pd+lpd+lh-5.5);
  ctx.restore();
  // Footer scuro col titolo della vista
  ctx.fillStyle='rgba(31,41,55,0.7)'; ctx.fillRect(pd,pd+vh,vw,th);
  ctx.fillStyle='#fff'; ctx.font='bold 9px monospace'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(title, W/2, pd+vh+th/2); ctx.textBaseline='alphabetic';
}

function misICP_buildReportData(){
  if(!misICP_result || !misICP_result.pairs || !misICP_result.pairs.length){
    throw new Error('Nessun allineamento ICP disponibile. Esegui prima l\'ICP.');
  }
  var pairs = misICP_result.pairs;
  // Ricostruisco gli oggetti pdfPairs come prima
  var pdfPairs = pairs.map(function(pp){
    return {
      a: pp.cA, b: pp.cB,
      dx: pp.dx, dy: pp.dy, dz: pp.dz,
      dxy: pp.dxy, d3: pp.d3,
      trisA: pp.trisA, trisB: pp.trisBt,
      iA: pp.iA, iB: pp.iB,
      axAngleDeg: pp.axAngleDeg,
      axA: pp.axA, axBt: pp.axBt,
      // Connessione clinica (beta 8.64.x)
      sbType: pp.sbType, connA: pp.connA, connB: pp.connB,
      connD3um: pp.connD3um, connDxum: pp.connDxum, connDyum: pp.connDyum,
      connDzum: pp.connDzum, connDxyum: pp.connDxyum, connLevel: pp.connLevel,
      // 8.66.6: campi vettore connessione (per il foglio Diagnostica centro-vs-asse)
      connCapZ: pp.connCapZ, connAxA: pp.connAxA, connAxB: pp.connAxB
    };
  }).filter(function(pp){return pp.b !== null;});
  if(!pdfPairs.length) throw new Error('Nessuna coppia valida per il report.');

  var cylAxes = pairs.filter(function(pp){return pp.iB>=0;}).map(function(pp){
    return { angleDeg: pp.axAngleDeg };
  });

  var score = misICP_calcScore(pdfPairs, cylAxes);
  var lv = misICP_scoreLabel(score);
  var scaleUm = misICP_getScaleUm(pdfPairs);

  // Coppie inter-centroide A vs B (10 coppie se 5 cilindri, NxN/2 in generale)
  var interCentroidPairs = [];
  for(var i=0; i<pdfPairs.length; i++){
    for(var j=i+1; j<pdfPairs.length; j++){
      var pi = pdfPairs[i], pj = pdfPairs[j];
      var dxA=pj.a[0]-pi.a[0], dyA=pj.a[1]-pi.a[1], dzA=pj.a[2]-pi.a[2];
      var dxB=pj.b[0]-pi.b[0], dyB=pj.b[1]-pi.b[1], dzB=pj.b[2]-pi.b[2];
      var distA_um = Math.sqrt(dxA*dxA+dyA*dyA+dzA*dzA)*1000;
      var distB_um = Math.sqrt(dxB*dxB+dyB*dyB+dzB*dzB)*1000;
      var delta_um = distB_um - distA_um;
      var lvCpl;
      var absD = Math.abs(delta_um);
      if(absD < 50)        lvCpl = {label:'Ottimo',      col:'#639922'};
      else if(absD < 100)  lvCpl = {label:'Buono',       col:'#84B025'};
      else if(absD < 200)  lvCpl = {label:'Accettabile', col:'#D97706'};
      else                 lvCpl = {label:'Verifica',    col:'#EF4444'};
      interCentroidPairs.push({i:i+1, j:j+1, distA_um:distA_um, distB_um:distB_um, delta_um:delta_um, lv:lvCpl});
    }
  }

  return {
    pairs: pdfPairs,
    cylAxes: cylAxes,
    score: score,
    lv: lv,
    scaleUm: scaleUm,
    interCentroidPairs: interCentroidPairs,
    fileA: (misICP_result.fileA||'A').replace(/\.stl$/i,'').slice(0,40),
    fileB: (misICP_result.fileB||'B').replace(/\.stl$/i,'').slice(0,40),
    fileAfull: misICP_result.fileA || '',
    fileBfull: misICP_result.fileB || '',
    rmsdUm: misICP_result.rmsdUm,
    avgAngle: (misICP_result.avgAngle != null) ? misICP_result.avgAngle : 0,
    icpR: misICP_result.R || [[1,0,0],[0,1,0],[0,0,1]],
    icpT: misICP_result.t || [0,0,0],
    nCyl: pdfPairs.length,
    timestamp: new Date(),
    // v7.3.9.082: tracciabilita' modello voto e algoritmo (Misurare = server weighted ICP)
    score_model_version: (misICP_result.score_model_version || 'Syntesis Score v1.0'),
    algorithm: (misICP_result.algorithm || 'server_weighted_icp_v1')
  };
}

/**
 * Helper: formattazione data e ora.
 */
function misICP_fmtDateTime(d){
  var dd = String(d.getDate()).padStart(2,'0');
  var mm = String(d.getMonth()+1).padStart(2,'0');
  var yy = d.getFullYear();
  var hh = String(d.getHours()).padStart(2,'0');
  var mi = String(d.getMinutes()).padStart(2,'0');
  return dd+'/'+mm+'/'+yy+' '+hh+':'+mi;
}
function misICP_fmtDate(d){
  var dd = String(d.getDate()).padStart(2,'0');
  var mm = String(d.getMonth()+1).padStart(2,'0');
  var yy = d.getFullYear();
  return dd+'/'+mm+'/'+yy;
}

/**
 * Helper: footer comune di pagina (testo + bordi oro).
 * @param {jsPDF} doc
 * @param {string} title - es. "Report Clinico"
 * @param {string} pageInfo - es. "Pag. 2 / 16"
 * @param {boolean} darkBg - vero solo per la cover
 */
function misICP_pdfFooter(doc, title, pageInfo, darkBg){
  var W=210, H=297, ml=14, mr=14;
  if(darkBg){
    doc.setFillColor(255,215,0); doc.rect(0,H-3,W,3,'F');
    doc.setFillColor(245,158,11); doc.rect(0,H-4.5,W,1.5,'F');
    doc.setFont('helvetica','bold'); doc.setFontSize(7);
    doc.setTextColor(255,204,85);
    doc.text(title+'  -  Biaggini Medical Devices S.r.l.', W/2, H-6, {align:'center'});
  } else {
    doc.setFont('helvetica','normal'); doc.setFontSize(7);
    doc.setTextColor(122,144,164);
    doc.text(title, ml, H-4);
    // Brand al centro per coerenza con la cover
    doc.setFont('helvetica','italic'); doc.setFontSize(6.5);
    doc.text('Biaggini Medical Devices S.r.l.', W/2, H-4, {align:'center'});
    if(pageInfo){
      doc.setFont('helvetica','normal'); doc.setFontSize(7);
      doc.text(pageInfo, W-mr, H-4, {align:'right'});
    }
  }
}

/**
 * Disegna la copertina comune (sfondo scuro, anello, badge, info, mappa).
 */

// Helper v7.3.9.082: schiarisce/scurisce un hex color di una percentuale
function misICP_shadeHex(hex, pct){
  hex = hex.replace('#','');
  var r = parseInt(hex.substr(0,2), 16);
  var g = parseInt(hex.substr(2,2), 16);
  var b = parseInt(hex.substr(4,2), 16);
  if(pct > 0){
    r = Math.round(r + (255-r) * pct);
    g = Math.round(g + (255-g) * pct);
    b = Math.round(b + (255-b) * pct);
  } else {
    r = Math.round(r * (1+pct));
    g = Math.round(g * (1+pct));
    b = Math.round(b * (1+pct));
  }
  r = Math.max(0, Math.min(255, r));
  g = Math.max(0, Math.min(255, g));
  b = Math.max(0, Math.min(255, b));
  return '#' + ('0'+r.toString(16)).slice(-2) + ('0'+g.toString(16)).slice(-2) + ('0'+b.toString(16)).slice(-2);
}

function misICP_pdfDrawCover(doc, data, reportTitle){
  // COVER CLINICO v7.3.9.082: anello smooth con gradient sottile (no doppio glow)
  var W=210, H=297, ml=14, mr=14, cw=W-ml-mr;
  function setFill(hex){ var c=misICP_hexRGB(hex); doc.setFillColor(c[0],c[1],c[2]); }
  function setTxt (hex){ var c=misICP_hexRGB(hex); doc.setTextColor(c[0],c[1],c[2]); }
  function setDraw(hex){ var c=misICP_hexRGB(hex); doc.setDrawColor(c[0],c[1],c[2]); }

  doc.setFillColor(13,27,42); doc.rect(0,0,W,H,'F');
  doc.setFillColor(255,215,0); doc.rect(0,0,W,3,'F');
  doc.setFillColor(245,158,11); doc.rect(0,3,W,1.5,'F');

  // Logo Synthesis bianco grande
  var whiteLogoSrc = (function(){
    try {
      var imgEl = document.querySelector('img.logo-img');
      if(!imgEl || !imgEl.complete || !imgEl.naturalWidth) return null;
      var c = document.createElement('canvas');
      c.width = imgEl.naturalWidth; c.height = imgEl.naturalHeight;
      var ctx = c.getContext('2d');
      ctx.drawImage(imgEl, 0, 0);
      var imgData = ctx.getImageData(0, 0, c.width, c.height);
      var d = imgData.data;
      for(var i=0; i<d.length; i+=4){
        if(d[i+3] > 0){ d[i]=255; d[i+1]=255; d[i+2]=255; }
      }
      ctx.putImageData(imgData, 0, 0);
      return c.toDataURL('image/png');
    } catch(e){ return null; }
  })();
  if(whiteLogoSrc){
    try { doc.addImage(whiteLogoSrc, 'PNG', (W-65)/2, 13, 65, 19); } catch(e){}
  }

  doc.setFont('helvetica','bold'); doc.setFontSize(20); setTxt('#FFFFFF');
  doc.text('Synthesis-ICP', W/2, 40, {align:'center'});
  doc.setFont('helvetica','normal'); doc.setFontSize(9); setTxt('#B0B8C1');
  doc.text(reportTitle, W/2, 46, {align:'center'});

  // Anello smooth - gradient SOTTILE nel colore base (no giallo/arancio carichi, no doppio stroke)
  var scoreRingSrc = (function(){
    var sizePx = 700;
    var c = document.createElement('canvas');
    c.width = sizePx; c.height = sizePx;
    var ctx = c.getContext('2d');
    var cx = sizePx/2, cy = sizePx/2;
    var lineW = sizePx * 0.08;
    var ringR = (sizePx - lineW)/2 - 8;

    // Anello base scuro (full circle)
    ctx.lineCap = 'butt';
    ctx.lineWidth = lineW;
    ctx.strokeStyle = '#28323F';
    ctx.beginPath();
    ctx.arc(cx, cy, ringR, 0, 2*Math.PI);
    ctx.stroke();

    var pct = Math.max(0, Math.min(1, (data.score||0)/100));
    if(pct > 0){
      var baseCol = (data.lv && data.lv.col) ? data.lv.col : '#0D9E6E';
      var lightCol = misICP_shadeHex(baseCol, 0.25);
      var darkCol  = misICP_shadeHex(baseCol, -0.15);
      var stroke;
      if(typeof ctx.createConicGradient === 'function'){
        var grad = ctx.createConicGradient(-Math.PI/2, cx, cy);
        // Gradient SOTTILE: chiaro -> base -> scuro lungo l'arco percorso
        grad.addColorStop(0,         lightCol);
        grad.addColorStop(pct*0.5,   baseCol);
        grad.addColorStop(pct,       darkCol);
        grad.addColorStop(1,         darkCol);
        stroke = grad;
      } else {
        stroke = baseCol;
      }
      ctx.strokeStyle = stroke;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(cx, cy, ringR, -Math.PI/2, -Math.PI/2 + pct * 2*Math.PI);
      ctx.stroke();
    }
    return c.toDataURL('image/png');
  })();
  var ringSize = 50, ringX = (W - ringSize)/2, ringY = 53;
  if(scoreRingSrc){
    try { doc.addImage(scoreRingSrc, 'PNG', ringX, ringY, ringSize, ringSize); } catch(e){}
  }
  setTxt('#FFFFFF'); doc.setFont('helvetica','bold'); doc.setFontSize(22);
  doc.text((data.score||0).toFixed(2), W/2, ringY + ringSize/2 + 1, {align:'center'});
  setTxt('#7A90A4'); doc.setFont('helvetica','normal'); doc.setFontSize(7);
  doc.text('/100', W/2, ringY + ringSize/2 + 6, {align:'center'});

  // Badge giudizio
  var pillY = ringY + ringSize + 6, pillH = 11, pillW = 78, pillX = (W-pillW)/2;
  var bgRGB = misICP_hexRGB(data.lv.bg);
  doc.setFillColor(bgRGB[0],bgRGB[1],bgRGB[2]);
  doc.roundedRect(pillX, pillY, pillW, pillH, 4, 4, 'F');
  doc.setFont('helvetica','bold'); doc.setFontSize(10); setTxt(data.lv.fg);
  doc.text(data.lv.label.toUpperCase(), W/2, pillY+7.5, {align:'center'});

  // Info box
  var infoY = pillY + pillH + 8;
  var infos = [
    ['File A (riferimento)', data.fileA],
    ['File B (confronto)',   data.fileB],
    ['N scanbody',           String(data.nCyl)],
    ['RMSD ICP',             (data.rmsdUm).toFixed(1)+' \u00b5m'],
    ['Data analisi',         misICP_fmtDateTime(data.timestamp)]
  ];
  infos.forEach(function(row,ii){
    var rowY = infoY + ii*8;
    setTxt('#7A90A4'); doc.setFont('helvetica','normal'); doc.setFontSize(7);
    doc.text(row[0], ml+4, rowY);
    setTxt('#FFFFFF'); doc.setFont('helvetica','bold'); doc.setFontSize(9);
    doc.text(String(row[1]), W-mr-4, rowY, {align:'right'});
    doc.setDrawColor(40,50,65); doc.setLineWidth(0.15);
    doc.line(ml+4, rowY+1.5, W-mr-4, rowY+1.5);
  });

  // Mappa colorimetrica
  doc.setFont('helvetica','bold'); doc.setFontSize(8); setTxt('#FFCC55');
  var mapY = infoY + 5*8 + 6;
  doc.text('MAPPA COLORIMETRICA - POSIZIONI SCANBODY', ml, mapY);
  var mapCanvas=document.createElement('canvas');
  mapCanvas.width=880; mapCanvas.height=480;
  misICP_drawColorMap(mapCanvas, data.pairs);
  var mapH = 60;
  doc.addImage(mapCanvas.toDataURL('image/png'), 'PNG', ml, mapY+3, cw, mapH);

  var legY = mapY + 3 + mapH + 4;
  var levels=[
    {c:'#639922', lbl:'0-50 Ottimo'},
    {c:'#D97706', lbl:'50-100 Accett.'},
    {c:'#F97316', lbl:'100-150 Risch.'},
    {c:'#EF4444', lbl:'150-250 Tens.'},
    {c:'#A855F7', lbl:'>250 Fuori'}
  ];
  var segW=cw/levels.length;
  levels.forEach(function(l,li){
    var lx=ml+li*segW;
    var cRGB=misICP_hexRGB(l.c);
    doc.setFillColor(cRGB[0],cRGB[1],cRGB[2]);
    doc.rect(lx, legY, segW-1, 3, 'F');
    doc.setFont('helvetica','normal'); doc.setFontSize(6); setTxt('#B0B8C1');
    doc.text(l.lbl, lx+1, legY+7);
  });
}

function misICP_drawTechCylinder(ctx, cx, cy, r, h, tilt, color){
  tilt = tilt || 0;
  var ca = Math.cos(tilt), sa = Math.sin(tilt);
  // Vettore assiale (dall'asse del cilindro)
  var ax = sa * h/2, ay = -ca * h/2;
  // Top center e bottom center
  var tx_ = cx + ax, ty_ = cy + ay;
  var bx_ = cx - ax, by_ = cy - ay;
  // Ellisse: assi proiettati. Asse maggiore perpendicolare al tilt.
  var rx = r * ca + r * 0.3 * Math.abs(sa);
  var ry = r * 0.3 * Math.abs(ca) + r * Math.abs(sa);
  var ellAng = tilt; // rotazione dell'ellisse
  ctx.save();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = color.stroke;
  // Bottom cap (visibile)
  ctx.fillStyle = color.fill;
  ctx.beginPath();
  ctx.ellipse(bx_, by_, r, r*0.3, ellAng, 0, Math.PI*2);
  ctx.fill(); ctx.stroke();
  // Corpo laterale: 4 vertici delle ellissi top e bottom collegati
  // I due "punti laterali" delle ellissi nel piano della carta
  var perp_x = ca, perp_y = sa; // versore perpendicolare al tilt
  var p1 = [tx_ + perp_x * r, ty_ + perp_y * r];
  var p2 = [bx_ + perp_x * r, by_ + perp_y * r];
  var p3 = [bx_ - perp_x * r, by_ - perp_y * r];
  var p4 = [tx_ - perp_x * r, ty_ - perp_y * r];
  // Riempimento corpo con gradiente lineare perpendicolare al tilt
  var grad = ctx.createLinearGradient(p4[0], p4[1], p1[0], p1[1]);
  grad.addColorStop(0, color.fill);
  grad.addColorStop(0.5, color.fillLight || color.fill);
  grad.addColorStop(1, color.fill);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(p1[0], p1[1]);
  ctx.lineTo(p2[0], p2[1]);
  ctx.lineTo(p3[0], p3[1]);
  ctx.lineTo(p4[0], p4[1]);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  // Top cap (sempre sopra)
  ctx.fillStyle = color.fillLight || color.fill;
  ctx.beginPath();
  ctx.ellipse(tx_, ty_, r, r*0.3, ellAng, 0, Math.PI*2);
  ctx.fill(); ctx.stroke();
  ctx.restore();
  return { tx:tx_, ty:ty_, bx:bx_, by:by_, cx:cx, cy:cy };
}

/**
 * Disegna una freccia con label sopra.
 */
function misICP_drawTechArrow(ctx, x1, y1, x2, y2, label, color){
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  // Frecce alle estremita'
  var ang = Math.atan2(y2-y1, x2-x1);
  var ah = 6;
  function arrowHead(px, py, angIn){
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px - ah*Math.cos(angIn-0.4), py - ah*Math.sin(angIn-0.4));
    ctx.lineTo(px - ah*Math.cos(angIn+0.4), py - ah*Math.sin(angIn+0.4));
    ctx.closePath();
    ctx.fill();
  }
  arrowHead(x2, y2, ang);
  arrowHead(x1, y1, ang + Math.PI);
  if(label){
    var mx = (x1+x2)/2, my = (y1+y2)/2;
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var tw = ctx.measureText(label).width + 8;
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.strokeStyle = 'rgba(0,0,0,0.10)';
    ctx.lineWidth = 0.5;
    ctx.fillRect(mx - tw/2, my - 8, tw, 16);
    ctx.strokeRect(mx - tw/2, my - 8, tw, 16);
    ctx.fillStyle = color;
    ctx.fillText(label, mx, my);
    ctx.textBaseline = 'alphabetic';
  }
  ctx.restore();
}

/**
 * Disegna un punto centrato (centroide) con label.
 */
function misICP_drawTechCentroidDot(ctx, cx, cy, label, color){
  ctx.save();
  // Cerchio piccolo
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, 3.5, 0, Math.PI*2);
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // Cross hair (mirino)
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - 8, cy); ctx.lineTo(cx - 5, cy);
  ctx.moveTo(cx + 5, cy); ctx.lineTo(cx + 8, cy);
  ctx.moveTo(cx, cy - 8); ctx.lineTo(cx, cy - 5);
  ctx.moveTo(cx, cy + 5); ctx.lineTo(cx, cy + 8);
  ctx.stroke();
  if(label){
    ctx.fillStyle = color;
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(label, cx + 10, cy - 10);
  }
  ctx.restore();
}

function misICP_pdfDrawMethodologyPage(doc){
  var W=210, H=297, ml=14, mr=14, cw=W-ml-mr;
  function setTxt(hex){ var c=misICP_hexRGB(hex); doc.setTextColor(c[0],c[1],c[2]); }

  // Header
  doc.setFillColor(247,249,252); doc.rect(0,0,W,16,'F');
  doc.setFillColor(0,101,179);   doc.rect(0,0,5,16,'F');
  doc.setFont('helvetica','bold'); doc.setFontSize(13); setTxt('#0F1923');
  doc.text('Note metodologiche', ml+2, 9);
  doc.setFont('helvetica','normal'); doc.setFontSize(8); setTxt('#7A90A4');
  doc.text('Cosa misura il report e come', ml+2, 14);

  // SEZIONE 1: PIPELINE DI ANALISI
  var y = 24;
  doc.setFont('helvetica','bold'); doc.setFontSize(9); setTxt('#0065B3');
  doc.text('PIPELINE DI ANALISI', ml, y);
  y += 5;
  doc.setFont('helvetica','normal'); doc.setFontSize(8.5); setTxt('#0F1923');
  var pipelineText = 'Il report confronta due scansioni STL della stessa arcata: A (riferimento, master) e B (misurato, scansione corrente). L\'algoritmo ICP (Iterative Closest Point) roto-trasla rigidamente B su A minimizzando la somma dei quadrati delle distanze fra i centroidi degli scanbody. Le mesh non vengono deformate: vengono solo allineate nello spazio. Tutte le misure di scostamento vengono calcolate dopo l\'allineamento.';
  var lines = doc.splitTextToSize(pipelineText, cw);
  doc.text(lines, ml, y);
  y += lines.length * 4 + 4;

  // Pipeline schematica orizzontale
  var pipeY = y;
  var pipeH = 16;
  var stages = [
    { lbl: 'File A\n(riferimento)', col: '#0065B3' },
    { lbl: 'File B\n(misurato)',    col: '#D97706' },
    { lbl: 'ICP\nallineamento',     col: '#7A90A4' },
    { lbl: 'Misure\nscostamenti',   col: '#639922' }
  ];
  var sw = (cw - 24) / stages.length;
  stages.forEach(function(st, i){
    var sx = ml + i*(sw+8);
    var rgb = misICP_hexRGB(st.col);
    doc.setFillColor(rgb[0], rgb[1], rgb[2]);
    doc.roundedRect(sx, pipeY, sw, pipeH, 2, 2, 'F');
    doc.setFont('helvetica','bold'); doc.setFontSize(7.5); doc.setTextColor(255,255,255);
    var l = st.lbl.split('\n');
    doc.text(l[0], sx+sw/2, pipeY+6, {align:'center'});
    doc.text(l[1], sx+sw/2, pipeY+11, {align:'center'});
    if(i < stages.length-1){
      doc.setDrawColor(122,144,164); doc.setLineWidth(0.6);
      doc.line(sx+sw+1, pipeY+pipeH/2, sx+sw+7, pipeY+pipeH/2);
      // freccia
      doc.line(sx+sw+5, pipeY+pipeH/2-1.5, sx+sw+7, pipeY+pipeH/2);
      doc.line(sx+sw+5, pipeY+pipeH/2+1.5, sx+sw+7, pipeY+pipeH/2);
    }
  });
  y = pipeY + pipeH + 8;

  // SEZIONE 2: MISURE PER OGNI CILINDRO (3 diagrammi affiancati)
  doc.setFont('helvetica','bold'); doc.setFontSize(9); setTxt('#0065B3');
  doc.text('MISURE PER OGNI CILINDRO', ml, y);
  y += 4;

  var diagW = (cw - 8) / 3;
  var diagH_ = 50;

  // Tre canvas affiancati: centroide / |D| 3D / angolo asse
  var dx = ml;
  ['centroide', 'd3d', 'angle'].forEach(function(kind, idx){
    var cv = document.createElement('canvas');
    cv.width = Math.round(diagW*4); cv.height = Math.round(diagH_*4);
    var ctx = cv.getContext('2d');
    var W2 = cv.width, H2 = cv.height;
    ctx.fillStyle = '#fafbfc'; ctx.fillRect(0,0,W2,H2);
    ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 1; ctx.strokeRect(0.5,0.5,W2-1,H2-1);

    var COL_A = { fill:'#1A5F9E', fillLight:'#4D89C0', stroke:'#0F3D66' };
    var COL_B = { fill:'#D97706', fillLight:'#F09238', stroke:'#854B0B' };

    if(kind === 'centroide'){
      // Un solo cilindro con punto centroide
      var ginfo = misICP_drawTechCylinder(ctx, W2/2, H2/2, 30, 90, 0, COL_A);
      misICP_drawTechCentroidDot(ctx, W2/2, H2/2, 'centroide', '#EF4444');
      // Titolo
      ctx.fillStyle = '#0F1923'; ctx.font = 'bold 13px monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText('Centroide', W2/2, 8);
    } else if(kind === 'd3d'){
      // Due cilindri sfalsati con freccia |D|
      misICP_drawTechCylinder(ctx, W2/2 - 22, H2/2 + 8, 26, 80, 0, COL_A);
      misICP_drawTechCylinder(ctx, W2/2 + 22, H2/2 - 8, 26, 80, 0, COL_B);
      // Frecce ai centri
      misICP_drawTechCentroidDot(ctx, W2/2 - 22, H2/2 + 8, 'A', '#0F3D66');
      misICP_drawTechCentroidDot(ctx, W2/2 + 22, H2/2 - 8, 'B', '#854B0B');
      misICP_drawTechArrow(ctx, W2/2 - 22, H2/2 + 8, W2/2 + 22, H2/2 - 8, '|D|', '#EF4444');
      ctx.fillStyle = '#0F1923'; ctx.font = 'bold 13px monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText('|D| 3D', W2/2, 8);
    } else if(kind === 'angle'){
      // Due cilindri inclinati di angoli diversi
      misICP_drawTechCylinder(ctx, W2/2 - 32, H2/2, 22, 90, -0.05, COL_A);
      misICP_drawTechCylinder(ctx, W2/2 + 32, H2/2, 22, 90, 0.30, COL_B);
      // Assi proiettati lungo l'altezza
      ctx.save();
      ctx.strokeStyle = '#0F3D66'; ctx.lineWidth = 1.5; ctx.setLineDash([4,3]);
      ctx.beginPath();
      ctx.moveTo(W2/2 - 32 - Math.sin(-0.05)*60, H2/2 + Math.cos(-0.05)*60);
      ctx.lineTo(W2/2 - 32 + Math.sin(-0.05)*60, H2/2 - Math.cos(-0.05)*60);
      ctx.stroke();
      ctx.strokeStyle = '#854B0B';
      ctx.beginPath();
      ctx.moveTo(W2/2 + 32 - Math.sin(0.30)*60, H2/2 + Math.cos(0.30)*60);
      ctx.lineTo(W2/2 + 32 + Math.sin(0.30)*60, H2/2 - Math.cos(0.30)*60);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      // Arco theta tra gli assi (in alto al centro)
      ctx.strokeStyle = '#EF4444'; ctx.lineWidth = 2; ctx.fillStyle = '#EF4444';
      ctx.beginPath();
      ctx.arc(W2/2, H2/2 - 50, 22, -Math.PI/2 - 0.05, -Math.PI/2 + 0.30);
      ctx.stroke();
      ctx.font = 'bold 14px monospace'; ctx.textAlign = 'center';
      ctx.fillText('\u03b8', W2/2, H2/2 - 26);
      ctx.fillStyle = '#0F1923'; ctx.font = 'bold 13px monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText('Angolo asse', W2/2, 8);
    }
    doc.addImage(cv.toDataURL('image/png'), 'PNG', dx, y, diagW, diagH_);
    dx += diagW + 4;
  });
  y += diagH_ + 3;

  // Caption sotto i 3 diagrammi
  doc.setFont('helvetica','normal'); doc.setFontSize(8); setTxt('#374151');
  var capCyl = [
    { l:'Centroide:',     t:' baricentro di superficie (area-pesato) dello scanbody, indipendente dalla densita\' di mesh: e\' il punto su cui l\'ICP allinea A e B.' },
    { l:'|D| 3D:',        t:' deviazione di posa al datum/piattaforma implantare (origine CAD lungo l\'asse), non fra i centroidi: leva-dipendente, amplifica il tilt d\'asse. Componenti X, Y, Z (assi globali post-ICP) e proiezione XY.' },
    { l:'Angolo asse:',   t:' scostamento angolare fra gli assi A e B: PCA cap-based per 1T3/OS, raffinamento lateral-wall per gli SR (cilindri alti).' }
  ];
  capCyl.forEach(function(c){
    doc.setFont('helvetica','bold'); doc.setFontSize(8); setTxt('#0065B3');
    doc.text(c.l, ml, y);
    var lblW = doc.getTextWidth(c.l);
    doc.setFont('helvetica','normal'); setTxt('#374151');
    var capLines = doc.splitTextToSize(c.t, cw - lblW);
    doc.text(capLines, ml + lblW, y);
    y += capLines.length * 3.6 + 1.5;
  });
  y += 2;

  // SEZIONE 3: MISURE INTER-CENTROIDE
  doc.setFont('helvetica','bold'); doc.setFontSize(9); setTxt('#0065B3');
  doc.text('MISURE INTER-CENTROIDE', ml, y);
  y += 4;

  // Diagramma centrale: 4 cilindri (A1, A2, B1, B2) e due segmenti
  var cv2 = document.createElement('canvas');
  var dW = cw, dH = 56;
  cv2.width = Math.round(dW*4); cv2.height = Math.round(dH*4);
  var ctx2 = cv2.getContext('2d');
  var Wd = cv2.width, Hd = cv2.height;
  ctx2.fillStyle = '#fafbfc'; ctx2.fillRect(0,0,Wd,Hd);
  ctx2.strokeStyle = '#e5e7eb'; ctx2.lineWidth = 1; ctx2.strokeRect(0.5,0.5,Wd-1,Hd-1);
  var COL_A = { fill:'#1A5F9E', fillLight:'#4D89C0', stroke:'#0F3D66' };
  var COL_B = { fill:'#D97706', fillLight:'#F09238', stroke:'#854B0B' };
  // Posizioni: A1 left, A2 right, con B leggermente sfalsati
  var cyA = Hd/2 + 18;
  var x1 = Wd*0.18, x2 = Wd*0.82;
  // B sfalsati
  var bx1 = x1 + 14, by1 = cyA + 6;
  var bx2 = x2 - 8,  by2 = cyA - 4;
  // Disegna B prima (sotto)
  misICP_drawTechCylinder(ctx2, bx1, by1, 22, 70, 0, COL_B);
  misICP_drawTechCylinder(ctx2, bx2, by2, 22, 70, 0, COL_B);
  // Disegna A sopra
  misICP_drawTechCylinder(ctx2, x1, cyA, 22, 70, 0, COL_A);
  misICP_drawTechCylinder(ctx2, x2, cyA, 22, 70, 0, COL_A);
  // Punti centro
  misICP_drawTechCentroidDot(ctx2, x1, cyA, 'A1', '#0F3D66');
  misICP_drawTechCentroidDot(ctx2, x2, cyA, 'A2', '#0F3D66');
  misICP_drawTechCentroidDot(ctx2, bx1, by1, 'B1', '#854B0B');
  misICP_drawTechCentroidDot(ctx2, bx2, by2, 'B2', '#854B0B');
  // Segmento Distanza A (blu solido) tra A1 e A2
  ctx2.save();
  ctx2.strokeStyle = '#0065B3'; ctx2.lineWidth = 3; ctx2.lineCap = 'round';
  ctx2.beginPath(); ctx2.moveTo(x1, cyA); ctx2.lineTo(x2, cyA); ctx2.stroke();
  ctx2.restore();
  // Segmento Distanza B (arancione tratteggiato) tra B1 e B2
  ctx2.save();
  ctx2.strokeStyle = '#D97706'; ctx2.lineWidth = 2; ctx2.setLineDash([8,5]);
  ctx2.beginPath(); ctx2.moveTo(bx1, by1); ctx2.lineTo(bx2, by2); ctx2.stroke();
  ctx2.restore();
  // Label "Distanza A" sopra il segmento blu
  ctx2.font = 'bold 12px monospace'; ctx2.textAlign = 'center'; ctx2.textBaseline = 'middle';
  ctx2.fillStyle = 'rgba(255,255,255,0.95)';
  ctx2.fillRect((x1+x2)/2 - 50, cyA - 18, 100, 14);
  ctx2.strokeStyle = 'rgba(0,0,0,0.10)';
  ctx2.strokeRect((x1+x2)/2 - 50, cyA - 18, 100, 14);
  ctx2.fillStyle = '#0065B3';
  ctx2.fillText('Distanza A', (x1+x2)/2, cyA - 11);
  // Label "Distanza B" sotto il segmento arancione
  ctx2.fillStyle = 'rgba(255,255,255,0.95)';
  ctx2.fillRect((bx1+bx2)/2 - 50, (by1+by2)/2 + 6, 100, 14);
  ctx2.strokeStyle = 'rgba(0,0,0,0.10)';
  ctx2.strokeRect((bx1+bx2)/2 - 50, (by1+by2)/2 + 6, 100, 14);
  ctx2.fillStyle = '#D97706';
  ctx2.fillText('Distanza B', (bx1+bx2)/2, (by1+by2)/2 + 13);
  // Titolo
  ctx2.fillStyle = '#0F1923'; ctx2.font = 'bold 13px monospace';
  ctx2.textAlign = 'center'; ctx2.textBaseline = 'top';
  ctx2.fillText('Distanza inter-centroide', Wd/2, 8);
  doc.addImage(cv2.toDataURL('image/png'), 'PNG', ml, y, dW, dH);
  y += dH + 3;

  // Caption inter-centroide
  doc.setFont('helvetica','bold'); doc.setFontSize(8); setTxt('#0065B3');
  doc.text('Distanza A:', ml, y);
  doc.setFont('helvetica','normal'); setTxt('#374151');
  var ic1 = doc.splitTextToSize(' distanza euclidea tra il centroide A_i e il centroide A_j (riferimento, master).', cw - 22);
  doc.text(ic1, ml + 22, y); y += ic1.length * 3.6 + 1.5;
  doc.setFont('helvetica','bold'); setTxt('#D97706');
  doc.text('Distanza B:', ml, y);
  doc.setFont('helvetica','normal'); setTxt('#374151');
  var ic2 = doc.splitTextToSize(' distanza euclidea tra il centroide B_i e il centroide B_j post-ICP (dopo allineamento). La differenza (B - A) rivela errori di stitching e drift di scansione che l\'ICP non puo\' correggere perche\' sono interni alla scansione B.', cw - 22);
  doc.text(ic2, ml + 22, y); y += ic2.length * 3.6 + 1.5;
  doc.setFont('helvetica','bold'); setTxt('#0F1923');
  doc.text('Significato clinico:', ml, y);
  doc.setFont('helvetica','normal'); setTxt('#374151');
  var ic3 = doc.splitTextToSize(' la passive fit di una struttura su impianti dipende dalla coerenza delle distanze relative tra scanbody, non solo dalla posizione assoluta dei singoli. Errori inter-centroide oltre 200\u00b5m su distanze tra scanbody adiacenti sono il primo segnale di scansioni inaffidabili per protesi avvitate.', cw - 32);   // 8.80.4: 100->200 \u00b5m, allineato alla classificazione del glossario (100-200 = Accettabile)
  doc.text(ic3, ml + 32, y);
}

function misICP_pdfDrawValuesGuidePage(doc){
  var W=210, H=297, ml=14, mr=14, cw=W-ml-mr;
  function setTxt(hex){ var c=misICP_hexRGB(hex); doc.setTextColor(c[0],c[1],c[2]); }

  // Header (band gray + 5mm accent blu, identico a Methodology/Glossary)
  doc.setFillColor(247,249,252); doc.rect(0,0,W,16,'F');
  doc.setFillColor(0,101,179);   doc.rect(0,0,5,16,'F');
  doc.setFont('helvetica','bold'); doc.setFontSize(13); setTxt('#0F1923');
  doc.text('Lettura dei valori', ml+2, 9);
  doc.setFont('helvetica','normal'); doc.setFontSize(8); setTxt('#7A90A4');
  doc.text('Significato diagnostico delle componenti di scostamento', ml+2, 14);

  var y = 24;

  // Paragrafo introduttivo
  doc.setFont('helvetica','normal'); doc.setFontSize(8.5); setTxt('#0F1923');
  var para1 = 'Il report restituisce per ogni componente quattro famiglie di scostamento: i decentramenti nel piano (X, Y), lo scivolamento assiale (Z) e l\'errore di orientamento (valori angolari). Non hanno tutti lo stesso peso diagnostico.';
  var l1 = doc.splitTextToSize(para1, cw);
  doc.text(l1, ml, y);
  y += l1.length * 4 + 6;

  // Sotto-sezione: Piano XY
  doc.setFont('helvetica','bold'); doc.setFontSize(9); setTxt('#0065B3');
  doc.text('Piano XY', ml, y);
  y += 5;
  doc.setFont('helvetica','normal'); doc.setFontSize(8.5); setTxt('#0F1923');
  var paraXY = 'Gli scostamenti laterali misurano il decentramento del componente rispetto all\'asse di riferimento. Sono valori rilevanti, ma ammettono una quota interpretativa: lo scarico del cono interno alla struttura fresata, cioe\' la tolleranza geometrica dell\'accoppiamento conico, contribuisce fisiologicamente al gioco laterale. Uno scarico eccessivo, o una sua deriva in fase produttiva, amplifica gli incrementi misurati in X e Y senza che questo costituisca di per se\' un errore di fresatura.';
  var lXY = doc.splitTextToSize(paraXY, cw);
  doc.text(lXY, ml, y);
  y += lXY.length * 4 + 6;

  // Sotto-sezione: Asse Z e valori angolari
  doc.setFont('helvetica','bold'); doc.setFontSize(9); setTxt('#0065B3');
  doc.text('Asse Z e valori angolari', ml, y);
  y += 5;
  doc.setFont('helvetica','normal'); doc.setFontSize(8.5); setTxt('#0F1923');
  var paraZ = 'Lo stop assiale del cono e l\'orientamento del suo asse sono vincolati dalla geometria stessa dell\'accoppiamento e non risentono del gioco di interfaccia. Variazioni in Z o in angolo derivano quasi esclusivamente da errori o incertezze di produzione. Sono pertanto i parametri di riferimento per giudicare la qualita\' del manufatto fresato.';
  var lZ = doc.splitTextToSize(paraZ, cw);
  doc.text(lZ, ml, y);
  y += lZ.length * 4 + 8;

  // Schema illustrativo (PNG pre-rasterizzato dall'SVG, ratio 680:500)
  // Larghezza 75% del frame utile, centrato in pagina.
  var imgW = cw * 0.75;             // 136.5 mm
  var imgH = imgW * (500/680);      // ~100.4 mm
  var imgX = (W - imgW) / 2;        // ~36.75 mm
  var imgY = y;
  try {
    if(_synScaricoConoImg && _synScaricoConoImg.complete && _synScaricoConoImg.naturalWidth > 0){
      doc.addImage(_synScaricoConoImg, 'PNG', imgX, imgY, imgW, imgH);
    } else {
      doc.setDrawColor(203,213,225); doc.setLineWidth(0.3);
      doc.rect(imgX, imgY, imgW, imgH, 'D');
      doc.setFont('helvetica','italic'); doc.setFontSize(8); setTxt('#94A3B8');
      doc.text('[schema in caricamento]', W/2, imgY + imgH/2, {align:'center'});
    }
  } catch(e){ /* schema opzionale, il testo resta */ }
  y += imgH + 5;

  // Caption sotto lo schema (italic 10pt, grigio, centrato)
  doc.setFont('helvetica','italic'); doc.setFontSize(10); setTxt('#7A90A4');
  var cap = 'Sezione dell\'accoppiamento cono MUA-struttura fresata. Il gioco XY e\' ammesso dallo scarico del cono interno; lo stop Z e l\'asse comune sono vincoli geometrici rigidi.';
  var lc = doc.splitTextToSize(cap, cw * 0.85);
  lc.forEach(function(line, i){
    doc.text(line, W/2, y + i*4.2, {align:'center'});
  });
}

function misICP_pdfDrawGlossaryPage(doc){
  var W=210, H=297, ml=14, mr=14, cw=W-ml-mr;
  function setTxt(hex){ var c=misICP_hexRGB(hex); doc.setTextColor(c[0],c[1],c[2]); }

  // Header
  doc.setFillColor(247,249,252); doc.rect(0,0,W,16,'F');
  doc.setFillColor(0,101,179);   doc.rect(0,0,5,16,'F');
  doc.setFont('helvetica','bold'); doc.setFontSize(13); setTxt('#0F1923');
  doc.text('Glossario e soglie cliniche', ml+2, 9);
  doc.setFont('helvetica','normal'); doc.setFontSize(8); setTxt('#7A90A4');
  doc.text('Definizioni dei termini tecnici e criteri di lettura', ml+2, 14);

  // SEZIONE 1: SOGLIE CLINICHE
  var y = 24;
  doc.setFont('helvetica','bold'); doc.setFontSize(9); setTxt('#0065B3');
  doc.text('SOGLIE CLINICHE PER |D| 3D', ml, y);
  y += 4;

  doc.autoTable({
    startY: y,
    margin: { left:ml, right:mr },
    head: [['Range', 'Etichetta', 'Interpretazione clinica']],
    body: [
      ['0 - 50 \u00b5m',     'Ottimo',      'Scostamento entro la tolleranza di scansione. Idoneo per protesi avvitate ad alta precisione.'],
      ['50 - 100 \u00b5m',   'Accettabile', 'Scostamento clinicamente compatibile con la maggior parte delle protesi avvitate.'],
      ['100 - 150 \u00b5m',  'Rischioso',   'Scostamento al limite. Verificare con prova clinica e considerare ri-scansione.'],
      ['150 - 250 \u00b5m',  'Tensione',    'Scostamento incompatibile con passive fit. Tensione attesa sui pilastri.'],
      ['> 250 \u00b5m',      'Fuori posizione', 'Scansione non utilizzabile. Ripetere acquisizione e verificare protocolli.']
    ],
    theme: 'grid',
    styles: { font:'helvetica', fontSize:8, cellPadding:1.8, textColor:[33,37,41], lineColor:[214,228,240], lineWidth:0.2 },
    headStyles: { fillColor:[247,249,252], textColor:[122,144,164], fontStyle:'bold', fontSize:7.5 },
    columnStyles: {
      0: { cellWidth:30, halign:'center', font:'courier' },
      1: { cellWidth:28, halign:'center', fontStyle:'bold' },
      2: { halign:'left' }
    },
    didParseCell: function(d){
      if(d.section === 'body' && d.column.index === 1){
        var colors = ['#639922','#D97706','#F97316','#EF4444','#A855F7'];
        var rgb = misICP_hexRGB(colors[d.row.index]);
        d.cell.styles.textColor = rgb;
      }
    }
  });
  y = doc.lastAutoTable.finalY + 6;

  // SEZIONE 2: SOGLIE INTER-CENTROIDE
  doc.setFont('helvetica','bold'); doc.setFontSize(9); setTxt('#0065B3');
  doc.text('SOGLIE PER DIFFERENZA INTER-CENTROIDE (B - A)', ml, y);
  y += 4;
  doc.autoTable({
    startY: y,
    margin: { left:ml, right:mr },
    head: [['|B-A|', 'Etichetta', 'Interpretazione']],
    body: [
      ['< 50 \u00b5m',        'Ottimo',      'Distanza B coincide con A entro la tolleranza dello scanner.'],
      ['50 - 100 \u00b5m',    'Buono',       'Differenza ridotta, scansione coerente.'],
      ['100 - 200 \u00b5m',   'Accettabile', 'Differenza apprezzabile ma compatibile con protesi avvitate semplici.'],
      ['> 200 \u00b5m',       'Verifica',    'Differenza non trascurabile. Possibile drift di scansione, valutare ri-acquisizione.']
    ],
    theme: 'grid',
    styles: { font:'helvetica', fontSize:8, cellPadding:1.8, textColor:[33,37,41], lineColor:[214,228,240], lineWidth:0.2 },
    headStyles: { fillColor:[247,249,252], textColor:[122,144,164], fontStyle:'bold', fontSize:7.5 },
    columnStyles: {
      0: { cellWidth:30, halign:'center', font:'courier' },
      1: { cellWidth:28, halign:'center', fontStyle:'bold' },
      2: { halign:'left' }
    }
  });
  y = doc.lastAutoTable.finalY + 6;

  // SEZIONE 3: GLOSSARIO
  doc.setFont('helvetica','bold'); doc.setFontSize(9); setTxt('#0065B3');
  doc.text('GLOSSARIO', ml, y);
  y += 4;

  var glossary = [
    ['Scanbody',          'Cilindro di scansione avvitato sull\'impianto (o sul moncone su modello fisico). Geometria nota e calibrata, serve allo scanner per calcolare la posizione spaziale dell\'impianto sottostante.'],
    ['Mesh STL',          'Rappresentazione discreta della superficie scansionata, costituita da una lista di triangoli (vertici + facce). Formato standard per ogni scanner intraorale e da banco.'],
    ['Centroide',         'Centro di massa geometrico di un cluster di triangoli (cilindro+disco di uno scanbody). Punto di riferimento univoco per misure di scostamento.'],
    ['ICP',               'Iterative Closest Point. Algoritmo di allineamento rigido fra due nuvole di punti: trova rotazione + traslazione che minimizzano la somma dei quadrati delle distanze fra punti corrispondenti. Non deforma le mesh.'],
    ['RMSD',              'Root Mean Square Deviation. Radice della media dei quadrati delle distanze residue dopo allineamento ICP. Indica la qualita\' globale del match A-B.'],
    ['Asse cilindro',     'Direzione assiale dello scanbody, perpendicolare al disco di base. Calcolato col metodo cap-based PCA: si individuano le due basi del cilindro (top cap e bottom cap), si calcola la normale di ognuna via PCA, si media. Insensibile alla mescolanza di triangoli del disco col corpo del cilindro.'],
    ['Passive fit',       'Aderenza senza tensioni meccaniche di una protesi multi-impianto sui pilastri. Richiede coerenza submillimetrica delle distanze inter-impianto fra modello virtuale e situazione reale.'],
    ['Stitching',         'Fusione di pi\u00f9 acquisizioni parziali in una mesh unica. Errori di stitching producono distorsioni cumulative che ICP non puo\' correggere: si rivelano nelle distanze inter-centroide.'],
    ['Drift',             'Deriva progressiva dell\'allineamento durante l\'acquisizione di una scansione lunga. Tipico delle scansioni full-arch eseguite senza marker di riferimento intermedi.']
  ];

  doc.setFontSize(8);
  glossary.forEach(function(g){
    doc.setFont('helvetica','bold'); setTxt('#0F1923');
    doc.text(g[0], ml, y);
    var lblW = 26;
    doc.setFont('helvetica','normal'); setTxt('#374151');
    var gl = doc.splitTextToSize(g[1], cw - lblW);
    doc.text(gl, ml + lblW, y);
    y += gl.length * 3.5 + 1.5;
  });

  // SEZIONE 4: COME LEGGERE IL REPORT
  y += 3;
  if(y < H - 35){
    doc.setFont('helvetica','bold'); doc.setFontSize(9); setTxt('#0065B3');
    doc.text('COME LEGGERE IL REPORT', ml, y);
    y += 4;
    var howTo = 'La cover sintetizza il voto globale e la mappa colorimetrica dell\'arcata. Le pagine cilindro mostrano per ogni scanbody le viste 3D mesh, le componenti dello scostamento e l\'angolo asse. Le pagine inter-centroide confrontano la lunghezza A-B di ogni coppia di scanbody: la differenza rivela la coerenza dimensionale globale della scansione, indipendentemente dalle posizioni assolute. Per protesi avvitate multi-impianto, le pagine inter-centroide sono il criterio piu\' rilevante.';
    doc.setFont('helvetica','normal'); doc.setFontSize(8); setTxt('#374151');
    var ht = doc.splitTextToSize(howTo, cw);
    doc.text(ht, ml, y);
  }
}

/**
 * Disegna la pagina dettaglio di un singolo cilindro (3 viste mesh + tabella).
 * Usato dal Clinico e dall'Analisi.
 */
function misICP_pdfDrawCylinderPage(doc, data, ci){
  var W=210, H=297, ml=14, mr=14, cw=W-ml-mr;
  function setTxt(hex){ var c=misICP_hexRGB(hex); doc.setTextColor(c[0],c[1],c[2]); }

  var p = data.pairs[ci];
  var d3um = Math.round(p.d3*1000);
  var dxum = Math.round(p.dx*1000);
  var dyum = Math.round(p.dy*1000);
  var dzum = Math.round(p.dz*1000);
  var dxyum= Math.round(p.dxy*1000);
  var clv = misICP_clinLevel(d3um);

  // Header colorato
  var clBgRGB = misICP_hexRGB(clv.bg);
  doc.setFillColor(clBgRGB[0], clBgRGB[1], clBgRGB[2]);
  doc.rect(0,0,W,16,'F');
  var clRGB = misICP_hexRGB(clv.col);
  doc.setFillColor(clRGB[0], clRGB[1], clRGB[2]);
  doc.rect(0,0,5,16,'F');
  doc.setFont('helvetica','bold'); doc.setFontSize(14); setTxt(clv.fg);
  doc.text('Cilindro #'+(ci+1), ml+2, 10.5);
  doc.setFontSize(9);
  doc.text(clv.label+'  -  '+d3um+' \u00b5m  |D3D|', ml+2, 15);
  setTxt('#0F1923');
  doc.setFont('helvetica','bold'); doc.setFontSize(11);
  doc.text('Voto globale: '+data.score.toFixed(2)+'/100', W-mr, 10.5, {align:'right'});
  doc.setFontSize(8); doc.setFont('helvetica','normal');
  doc.text(data.fileA+' vs '+data.fileB, W-mr, 15, {align:'right'});

  // VISUALIZZAZIONE MESH 3D
  var y = 22;
  doc.setFont('helvetica','bold'); doc.setFontSize(8); setTxt('#0065B3');
  doc.text('VISUALIZZAZIONE MESH 3D', ml, y); y+=3;
  var viewW=(cw-8)/3, viewH=42;
  var views=[
    {ax1:0, ax2:1, axD:2, label:'Vista XY (dall\'alto)'},
    {ax1:0, ax2:2, axD:1, label:'Vista XZ (frontale)'},
    {ax1:1, ax2:2, axD:0, label:'Vista YZ (laterale)'}
  ];
  views.forEach(function(v,vi){
    var vx = ml + vi*(viewW+4);
    var cvV=document.createElement('canvas');
    cvV.width=Math.round(viewW*4); cvV.height=Math.round(viewH*4);
    misICP_paintView(cvV, p.trisA, p.trisB, null, v.ax1, v.ax2, v.axD, v.label);
    doc.addImage(cvV.toDataURL('image/png'), 'PNG', vx, y, viewW, viewH);
    doc.setFont('helvetica','normal'); doc.setFontSize(6); setTxt('#7A90A4');
    doc.text(v.label, vx+viewW/2, y+viewH+3, {align:'center'});
  });
  y += viewH + 8;

  // ANALISI DEVIAZIONE (card)
  doc.setFont('helvetica','bold'); doc.setFontSize(8); setTxt('#0065B3');
  doc.text('ANALISI DEVIAZIONE', ml, y); y+=3;
  var cardW=cw, cardH=40;
  var cvCard=document.createElement('canvas');
  cvCard.width=Math.round(cardW*4); cvCard.height=Math.round(cardH*4);
  misICP_drawCard(cvCard, dxum, dyum, dzum, d3um, data.scaleUm, p.trisB ? (data.cylAxes[ci] && data.cylAxes[ci].angleDeg) : null);
  doc.addImage(cvCard.toDataURL('image/png'), 'PNG', ml, y, cardW, cardH);
  y += cardH + 6;

  // TABELLA MISURAZIONI
  doc.setFont('helvetica','bold'); doc.setFontSize(8); setTxt('#0065B3');
  doc.text('TABELLA MISURAZIONI', ml, y); y+=2;
  var axDeg = data.cylAxes[ci] ? data.cylAxes[ci].angleDeg : 0;
  var axLvl = misICP_clinAx(axDeg);
  var tbRows = [
    ['|D| 3D totale',          d3um+' \u00b5m',                           clv.label],
    ['Deviazione XY (piano)',  dxyum+' \u00b5m',                          misICP_clinLevel(dxyum).label],
    ['Deviazione X',           (dxum>=0?'+':'')+dxum+' \u00b5m',          ''],
    ['Deviazione Y',           (dyum>=0?'+':'')+dyum+' \u00b5m',          ''],
    ['Deviazione Z (verticale)', (dzum>=0?'+':'')+dzum+' \u00b5m',        ''],
    ['Angolo asse cilindro',   axDeg.toFixed(3)+' deg',                   axLvl.label],
    ['Centroide A (X,Y,Z)',    p.a[0].toFixed(3)+', '+p.a[1].toFixed(3)+', '+p.a[2].toFixed(3)+' mm', ''],
    ['Centroide B allineato',  p.b[0].toFixed(3)+', '+p.b[1].toFixed(3)+', '+p.b[2].toFixed(3)+' mm', '']
  ];
  // Connessione clinica (beta 8.64.x): metriche al punto di connessione, accanto al centroide
  if(p.connD3um != null && p.connA && p.connB){
    var _cd3=Math.round(p.connD3um), _cxy=Math.round(p.connDxyum);
    var _cx=Math.round(p.connDxum), _cy=Math.round(p.connDyum), _cz=Math.round(p.connDzum);
    var _clv=p.connLevel||misICP_clinLevel(_cd3);
    tbRows.push(
      ['CONNESSIONE'+(p.sbType?' ('+p.sbType+')':''), '— datum, L mm sotto il centroide —', ''],
      ['|D| 3D connessione',      _cd3+' µm',                          _clv.label],
      ['Dev. XY connessione',     _cxy+' µm',                          misICP_clinLevel(_cxy).label],
      ['Dev. X connessione',      (_cx>=0?'+':'')+_cx+' µm',           ''],
      ['Dev. Y connessione',      (_cy>=0?'+':'')+_cy+' µm',           ''],
      ['Dev. Z connessione',      (_cz>=0?'+':'')+_cz+' µm',           ''],
      ['Connessione A (X,Y,Z)',   p.connA[0].toFixed(3)+', '+p.connA[1].toFixed(3)+', '+p.connA[2].toFixed(3)+' mm', ''],
      ['Connessione B allineata', p.connB[0].toFixed(3)+', '+p.connB[1].toFixed(3)+', '+p.connB[2].toFixed(3)+' mm', '']
    );
  }
  doc.autoTable({
    startY: y,
    margin: {left:ml, right:mr},
    head: [['Parametro','Valore','Valutazione']],
    body: tbRows,
    theme: 'grid',
    styles: {font:'helvetica', fontSize:8, cellPadding:2, textColor:[33,37,41], lineColor:[214,228,240], lineWidth:0.2},
    headStyles: {fillColor:[247,249,252], textColor:[122,144,164], fontStyle:'bold', fontSize:7},
    columnStyles: {0:{cellWidth:60}, 1:{halign:'right', font:'courier'}, 2:{halign:'right', fontSize:7}}
  });
}

/**
 * Disegna una pagina di distanza inter-centroide (dato indice della coppia).
 * Usato dal Clinico (10 pagine se 5 cilindri) e dall'Analisi.
 */
function misICP_pdfDrawInterCentroidPage(doc, data, pi){
  var W=210, H=297, ml=14, mr=14, cw=W-ml-mr;
  function setTxt(hex){ var c=misICP_hexRGB(hex); doc.setTextColor(c[0],c[1],c[2]); }

  var ic = data.interCentroidPairs[pi];

  // Header
  doc.setFillColor(247,249,252);
  doc.rect(0,0,W,16,'F');
  doc.setFillColor(0,101,179);
  doc.rect(0,0,5,16,'F');
  doc.setFont('helvetica','bold'); doc.setFontSize(13); setTxt('#0F1923');
  doc.text('Distanza Inter-Centroide #'+ic.i+'-#'+ic.j, ml+2, 9);
  doc.setFont('helvetica','normal'); doc.setFontSize(8); setTxt('#7A90A4');
  doc.text('Coppia '+(pi+1)+'/'+data.interCentroidPairs.length+'   A (rif.) vs B (post-ICP)', ml+2, 14);
  // Badge Delta a destra: box piu' alto e con tinta piu' chiara per leggibilita',
  // niente alpha fill (non funziona in modo uniforme su jsPDF), uso un mix manuale.
  var dRGB = misICP_hexRGB(ic.lv.col);
  // Mix con bianco al 85% (manualmente, niente alpha): col_bg = 0.15*col + 0.85*255
  var bgR = Math.round(dRGB[0]*0.15 + 255*0.85);
  var bgG = Math.round(dRGB[1]*0.15 + 255*0.85);
  var bgB = Math.round(dRGB[2]*0.15 + 255*0.85);
  var badgeX = W-mr-44, badgeY = 3, badgeW = 44, badgeH = 12;
  doc.setFillColor(bgR, bgG, bgB);
  doc.setDrawColor(dRGB[0], dRGB[1], dRGB[2]);
  doc.setLineWidth(0.3);
  doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 2, 2, 'FD');
  doc.setFont('helvetica','bold'); doc.setFontSize(10);
  doc.setTextColor(dRGB[0],dRGB[1],dRGB[2]);
  doc.text((ic.delta_um>=0?'+':'')+ic.delta_um.toFixed(1)+'\u00b5m', badgeX+badgeW/2, badgeY+5.4, {align:'center'});
  doc.setFontSize(7); doc.setFont('helvetica','normal');
  doc.text(ic.lv.label, badgeX+badgeW/2, badgeY+9.8, {align:'center'});

  // Diagramma topologico: stile mappa cover (arcata + heatmap + color bar)
  // con la coppia corrente evidenziata in blu spesso. Altezza 115mm scelta
  // per dare alla mappa proporzioni simili a quelle della cover (~130mm)
  // mantenendo spazio per box riassuntivo + tabella sotto.
  var diagY = 22;
  var diagH = 115;
  var cvDiag = document.createElement('canvas');
  cvDiag.width = Math.round(cw*4); cvDiag.height = Math.round(diagH*4);
  misICP_drawCentroidGraph(cvDiag, data, pi);
  doc.addImage(cvDiag.toDataURL('image/png'), 'PNG', ml, diagY, cw, diagH);

  // Box riassuntivo distanze
  var bxY = diagY + diagH + 6;
  doc.setFillColor(255,255,255);
  doc.setDrawColor(214,228,240); doc.setLineWidth(0.3);
  doc.roundedRect(ml, bxY, cw, 30, 2, 2, 'FD');

  var colW = cw/4;
  var labels = ['DISTANZA A', 'DISTANZA B', 'DIFFERENZA', 'VALUTAZIONE'];
  var values = [
    ic.distA_um.toFixed(1)+'\u00b5m',
    ic.distB_um.toFixed(1)+'\u00b5m',
    (ic.delta_um>=0?'+':'')+ic.delta_um.toFixed(1)+'\u00b5m',
    ic.lv.label
  ];
  var _cplNote = (ic.lv && (ic.lv.label==='Ottimo' || ic.lv.label==='Buono'))
    ? 'B coerente con A'
    : (ic.lv && ic.lv.label==='Accettabile') ? 'scostamento da verificare'
    : 'oltre soglia: verificare';
  var subValues = [
    (ic.distA_um/1000).toFixed(4)+' mm',
    (ic.distB_um/1000).toFixed(4)+' mm',
    '',
    _cplNote
  ];
  for(var c=0; c<4; c++){
    var cx = ml + c*colW + colW/2;
    setTxt('#7A90A4');
    doc.setFont('helvetica','normal'); doc.setFontSize(7);
    doc.text(labels[c], cx, bxY+5, {align:'center'});
    if(c===2){
      var dRGB2 = misICP_hexRGB(ic.lv.col);
      doc.setTextColor(dRGB2[0],dRGB2[1],dRGB2[2]);
    } else if(c===3){
      var dRGB3 = misICP_hexRGB(ic.lv.col);
      doc.setTextColor(dRGB3[0],dRGB3[1],dRGB3[2]);
    } else {
      setTxt('#0F1923');
    }
    doc.setFont('helvetica','bold'); doc.setFontSize(11);
    doc.text(values[c], cx, bxY+14, {align:'center'});
    if(subValues[c]){
      setTxt('#7A90A4');
      doc.setFont('helvetica','normal'); doc.setFontSize(7);
      doc.text(subValues[c], cx, bxY+22, {align:'center'});
    }
  }
  // Soglie
  setTxt('#7A90A4');
  doc.setFont('helvetica','normal'); doc.setFontSize(6);
  doc.text('0-50\u00b5m Ottimo  50-100\u00b5m Buono  100-200\u00b5m Accettabile  >200\u00b5m Verifica', ml+cw/2, bxY+28, {align:'center'});

  // Tabella confronto con le altre coppie
  var tbY = bxY + 36;
  doc.setFont('helvetica','bold'); doc.setFontSize(8); setTxt('#0065B3');
  doc.text('Confronto con le altre coppie:', ml, tbY); tbY+=2;
  var rows = data.interCentroidPairs.map(function(c, ci){
    var isCurrent = (ci === pi);
    return [
      (isCurrent?'> ':'')+'#'+c.i+'-#'+c.j+(isCurrent?' (questa)':''),
      c.distA_um.toFixed(1),
      c.distB_um.toFixed(1),
      (c.delta_um>=0?'+':'')+c.delta_um.toFixed(1),
      c.lv.label
    ];
  });
  doc.autoTable({
    startY: tbY,
    margin: {left:ml, right:mr},
    head: [['Coppia','A (\u00b5m)','B (\u00b5m)','Delta','Note']],
    body: rows,
    theme: 'grid',
    styles: {font:'helvetica', fontSize:8, cellPadding:1.5, textColor:[33,37,41], lineColor:[214,228,240], lineWidth:0.15},
    headStyles: {fillColor:[247,249,252], textColor:[122,144,164], fontStyle:'bold', fontSize:7},
    columnStyles: {
      0:{cellWidth:32},
      1:{halign:'right', font:'courier', cellWidth:24},
      2:{halign:'right', font:'courier', cellWidth:24},
      3:{halign:'right', font:'courier', cellWidth:22},
      4:{halign:'left', fontSize:7}
    },
    didParseCell: function(d){
      if(d.row.index === pi && d.section === 'body'){
        d.cell.styles.fillColor = [241, 245, 249];
        d.cell.styles.fontStyle = 'bold';
      }
    }
  });
}

/**
 * Wrapper: la mappa nelle pagine "Distanza Inter-Centroide" e' identica alla
 * mappa colorimetrica della cover (griglia, arcata, vettori A->B, heatmap,
 * color bar, scale bar 10mm) ma con la coppia corrente sovrapposta:
 *   - segmento blu spesso A_i-A_j  (= distanza A inter-centroide)
 *   - label ruotata coi due valori delle distanze A e B
 *   - i due nodi A coinvolti vengono ridisegnati con stile evidenziato
 *
 * La differenza fra distanza A e distanza B (qualche micron su decine di mm)
 * non e' visualmente rappresentabile a scala reale: il valore informativo e'
 * nei numeri delle label e nella heatmap colorata sui nodi B.
 */
function misICP_drawCentroidGraph(cv, data, currentPi){
  var ic = data.interCentroidPairs[currentPi];
  if(!ic){ misICP_drawColorMap(cv, data.pairs, { compact: true }); return; }
  misICP_drawColorMap(cv, data.pairs, {
    compact: true,
    highlightPair: {
      iA: ic.i - 1,
      iB: ic.j - 1,
      distA_um: ic.distA_um,
      distB_um: ic.distB_um,
      lv: ic.lv
    }
  });
}


// ────────────────────────────────────────────────────────────────────
// REPORT CLINICO (PDF) — cover + cilindri + coppie inter-centroide
// ────────────────────────────────────────────────────────────────────
function misICP_renderClinicalPDF(data){
  var doc = new window.jspdf.jsPDF({unit:'mm', format:'a4', compress:true});
  var W=210, H=297;
  // 1 cover + 3 pagine documentazione (metodologia, lettura valori, glossario)
  // + N cilindri + M coppie inter-centroide
  var docPages = 3;
  var totPages = 1 + docPages + data.nCyl + data.interCentroidPairs.length;

  misICP_pdfDrawCover(doc, data, 'Precision Scanner Report - Clinico');
  misICP_pdfFooter(doc, 'Synthesis-ICP - Report Clinico (Analizza v' + window.ANALIZZA_BUILD + ')', null, true);

  // Pagina 2: Note metodologiche (statica, identica per ogni report)
  doc.addPage();
  misICP_pdfDrawMethodologyPage(doc);
  misICP_pdfFooter(doc,
    'Synthesis-ICP - Note metodologiche',
    'Pag. 2 / '+totPages,
    false);

  // Pagina 3: Lettura dei valori (statica, identica per ogni report)
  doc.addPage();
  misICP_pdfDrawValuesGuidePage(doc);
  misICP_pdfFooter(doc,
    'Synthesis-ICP - Lettura dei valori',
    'Pag. 3 / '+totPages,
    false);

  // Pagina 4: Glossario e soglie cliniche (statica, identica per ogni report)
  doc.addPage();
  misICP_pdfDrawGlossaryPage(doc);
  misICP_pdfFooter(doc,
    'Synthesis-ICP - Glossario e soglie',
    'Pag. 4 / '+totPages,
    false);

  // Pagine cilindri
  data.pairs.forEach(function(p, ci){
    doc.addPage();
    misICP_pdfDrawCylinderPage(doc, data, ci);
    misICP_pdfFooter(doc,
      'Synthesis-ICP - Cilindro #'+(ci+1)+' di '+data.nCyl,
      'Pag. '+(1+docPages+ci+1)+' / '+totPages,
      false);
  });

  // Pagine coppie inter-centroide
  data.interCentroidPairs.forEach(function(ic, pi){
    doc.addPage();
    misICP_pdfDrawInterCentroidPage(doc, data, pi);
    misICP_pdfFooter(doc,
      'Synthesis-ICP - Distanza inter-centroide #'+ic.i+'-#'+ic.j,
      'Pag. '+(1+docPages+data.nCyl+pi+1)+' / '+totPages,
      false);
  });

  return doc;
}

function misICP_calibClassifyUm(value){
  if(value <= 50)       return {key:'PASS',     label:'PASS',     col:'#0D9E6E', bg:[230,247,239], txt:[13,158,110]};
  else if(value <= 100) return {key:'VERIFICA', label:'VERIFICA', col:'#D97706', bg:[255,247,230], txt:[217,119,6]};
  else                  return {key:'FAIL',     label:'FAIL',     col:'#DC2626', bg:[254,239,239], txt:[220,38,38]};
}
function misICP_calibClassifyDeg(value){
  if(value <= 0.5)      return {key:'PASS',     label:'PASS',     col:'#0D9E6E', bg:[230,247,239], txt:[13,158,110]};
  else if(value <= 1.0) return {key:'VERIFICA', label:'VERIFICA', col:'#D97706', bg:[255,247,230], txt:[217,119,6]};
  else                  return {key:'FAIL',     label:'FAIL',     col:'#DC2626', bg:[254,239,239], txt:[220,38,38]};
}
function misICP_calibWorst(classes){
  var ord = {PASS:0, VERIFICA:1, FAIL:2};
  var max = -1, picked = null;
  classes.forEach(function(c){ if(ord[c.key] > max){ max = ord[c.key]; picked = c; } });
  return picked || {key:'PASS', label:'PASS', col:'#0D9E6E', bg:[230,247,239], txt:[13,158,110]};
}

function misICP_openCalibrationModal(){
  if(!misICP_result || !misICP_result.pairs || misICP_result.pairs.length === 0){
    if(typeof showStatus === 'function') showStatus('Esegui prima un allineamento ICP per generare il certificato.');
    return;
  }
  ['calMachType','calMachMaker','calMachModel','calMachSN','calClient','calSite','calTech','calNotes'].forEach(function(id){
    var el = document.getElementById(id); if(el) el.value = '';
  });
  document.getElementById('calibrationModal').classList.add('show');
  setTimeout(function(){
    var f = document.getElementById('calMachType'); if(f) f.focus();
  }, 80);
}

function misICP_closeCalibrationModal(){
  document.getElementById('calibrationModal').classList.remove('show');
}

function misICP_submitCalibration(){
  function val(id){ var el = document.getElementById(id); return el ? el.value.trim() : ''; }
  var calibMeta = {
    type:    val('calMachType')   || '\u2014',
    maker:   val('calMachMaker')  || '\u2014',
    model:   val('calMachModel')  || '\u2014',
    sn:      val('calMachSN')     || '\u2014',
    client:  val('calClient')     || '\u2014',
    site:    val('calSite')       || '\u2014',
    tech:    val('calTech')       || '\u2014',
    notes:   val('calNotes')      || ''
  };
  var now = new Date();
  function pad(n){ return String(n).padStart(2,'0'); }
  var dateSlug = now.getFullYear() + pad(now.getMonth()+1) + pad(now.getDate());
  var rand4 = Math.random().toString(36).substring(2,6).toUpperCase();
  calibMeta.certId  = 'SYN-CAL-' + dateSlug + '-' + rand4;
  calibMeta.timeStr = pad(now.getHours()) + ':' + pad(now.getMinutes());
  calibMeta.dateStr = pad(now.getDate()) + '/' + pad(now.getMonth()+1) + '/' + now.getFullYear();

  try {
    var data = misICP_buildReportData();
    var doc = misICP_renderCalibrationPDF(data, calibMeta);
    var fileName = 'SyntesisICP_Certificato_' + dateSlug + '_' + rand4 + '.pdf';
    doc.save(fileName);
    misICP_closeCalibrationModal();
    if(typeof showStatus === 'function') showStatus('Certificato di Taratura ' + calibMeta.certId + ' salvato.');
  } catch(err){
    console.error('[Taratura] errore generazione PDF:', err);
    alert('Errore generazione certificato: ' + (err.message||err));
  }
}


function misICP_renderCalibrationPDF(data, calibMeta){
  // CERTIFICATO DI TARATURA v7.3.9.082
  // Cover con anello gradient conico + logo Syntesis bianco watermark in pagine interne
  if(!calibMeta){
    calibMeta = { type:'\u2014', maker:'\u2014', model:'\u2014', sn:'\u2014',
      client:'\u2014', site:'\u2014', tech:'\u2014', notes:'',
      certId:'SYN-CAL-NOMETA', dateStr:'\u2014', timeStr:'\u2014' };
  }
  var doc = new window.jspdf.jsPDF({unit:'mm', format:'a4', compress:true});
  var W=210, H=297, ml=14, mr=14;

  // Pre-genero le versioni del logo (sincronicamente: img \u00e8 inline data URI)
  var darkLogoSrc = (function(){
    try {
      var imgEl = document.querySelector('img.logo-img');
      return (imgEl && imgEl.src && imgEl.src.indexOf('data:') === 0) ? imgEl.src : null;
    } catch(e){ return null; }
  })();
  var whiteLogoSrc = (function(){
    try {
      var imgEl = document.querySelector('img.logo-img');
      if(!imgEl || !imgEl.complete || !imgEl.naturalWidth) return null;
      var c = document.createElement('canvas');
      c.width = imgEl.naturalWidth; c.height = imgEl.naturalHeight;
      var ctx = c.getContext('2d');
      ctx.drawImage(imgEl, 0, 0);
      var imgData = ctx.getImageData(0, 0, c.width, c.height);
      var d = imgData.data;
      for(var i=0; i<d.length; i+=4){
        if(d[i+3] > 0){ d[i]=255; d[i+1]=255; d[i+2]=255; }
      }
      ctx.putImageData(imgData, 0, 0);
      return c.toDataURL('image/png');
    } catch(e){ return null; }
  })();

  // Helper: aggiunge il logo nell'angolo alto destro della pagina corrente
  // useWhite=true per pagine con header scuro/colorato, false per chiaro
  function addCornerLogo(useWhite){
    var src = useWhite ? whiteLogoSrc : darkLogoSrc;
    if(!src) return;
    try { doc.addImage(src, 'PNG', W-mr-26, 4, 26, 7.8); } catch(e){}
  }

  var idPages  = 1, docPages = 2, sigPages = 1;
  var totPages = 1 + idPages + docPages + data.nCyl + data.interCentroidPairs.length + sigPages;

  // ── PAGINA 1: COVER (ha gi\u00e0 il logo grande, niente corner) ──
  misICP_pdfDrawCalibrationCover(doc, data, calibMeta, whiteLogoSrc);
  misICP_pdfFooter(doc, 'Synthesis-ICP - Certificato di Taratura ' + calibMeta.certId, null, true);

  // ── PAGINA 2: ID Macchina (header blu scuro \u2192 logo bianco) ──
  doc.addPage();
  misICP_pdfDrawCalibrationIdPage(doc, calibMeta, data);
  addCornerLogo(true);
  misICP_pdfFooter(doc, 'Synthesis-ICP - Identificazione', 'Pag. 2 / ' + totPages, false);

  // ── PAGINA 3: Note metodologiche (header chiaro \u2192 logo scuro) ──
  doc.addPage();
  misICP_pdfDrawMethodologyPage(doc);
  addCornerLogo(false);
  misICP_pdfFooter(doc, 'Synthesis-ICP - Note metodologiche', 'Pag. 3 / ' + totPages, false);

  // ── PAGINA 4: Glossario (header chiaro \u2192 logo scuro) ──
  doc.addPage();
  misICP_pdfDrawGlossaryPage(doc);
  addCornerLogo(false);
  misICP_pdfFooter(doc, 'Synthesis-ICP - Glossario e soglie', 'Pag. 4 / ' + totPages, false);

  // ── PAGINE 5..(4+N): Cilindri (header colorato \u2192 logo bianco) ──
  data.pairs.forEach(function(p, ci){
    doc.addPage();
    misICP_pdfDrawCylinderPage(doc, data, ci);
    addCornerLogo(true);
    misICP_pdfFooter(doc, 'Synthesis-ICP - Cilindro #'+(ci+1)+' di '+data.nCyl,
      'Pag. '+(4+ci+1)+' / '+totPages, false);
  });

  // ── PAGINE (5+N)..(4+N+M): Coppie inter-centroide (header colorato \u2192 logo bianco) ──
  data.interCentroidPairs.forEach(function(ic, pi){
    doc.addPage();
    misICP_pdfDrawInterCentroidPage(doc, data, pi);
    addCornerLogo(true);
    misICP_pdfFooter(doc, 'Synthesis-ICP - Distanza inter-centroide #'+ic.i+'-#'+ic.j,
      'Pag. '+(4+data.nCyl+pi+1)+' / '+totPages, false);
  });

  // ── ULTIMA PAGINA: Firme (header blu scuro \u2192 logo bianco) ──
  doc.addPage();
  misICP_pdfDrawCalibrationSignaturesPage(doc, calibMeta, data);
  addCornerLogo(true);
  misICP_pdfFooter(doc, 'Synthesis-ICP - Validazione e firme',
    'Pag. ' + totPages + ' / ' + totPages, false);

  return doc;
}

// ============================================================
// COVER TARATURA con anello GRADIENT CONICO sfumato
// ============================================================

// ============================================================
// COVER TARATURA con anello GRADIENT CONICO sfumato
// ============================================================

// Cover Taratura: stile Clinico con logo bianco, anello smooth, ID cert al posto del giudizio
function misICP_pdfDrawCalibrationCover(doc, data, calibMeta){
  var W=210, H=297, ml=14, mr=14, cw=W-ml-mr;
  function setFill(hex){ var c=misICP_hexRGB(hex); doc.setFillColor(c[0],c[1],c[2]); }
  function setTxt (hex){ var c=misICP_hexRGB(hex); doc.setTextColor(c[0],c[1],c[2]); }
  function setDraw(hex){ var c=misICP_hexRGB(hex); doc.setDrawColor(c[0],c[1],c[2]); }

  doc.setFillColor(13,27,42); doc.rect(0,0,W,H,'F');
  doc.setFillColor(255,215,0); doc.rect(0,0,W,3,'F');
  doc.setFillColor(245,158,11); doc.rect(0,3,W,1.5,'F');

  // Logo bianco (canvas pixel inversion del logo nero)
  var whiteLogoSrc = (function(){
    try {
      var imgEl = document.querySelector('img.logo-img');
      if(!imgEl || !imgEl.complete || !imgEl.naturalWidth) return null;
      var c = document.createElement('canvas');
      c.width = imgEl.naturalWidth; c.height = imgEl.naturalHeight;
      var ctx = c.getContext('2d');
      ctx.drawImage(imgEl, 0, 0);
      var imgData = ctx.getImageData(0, 0, c.width, c.height);
      var d = imgData.data;
      for(var i=0; i<d.length; i+=4){
        if(d[i+3] > 0){ d[i]=255; d[i+1]=255; d[i+2]=255; }
      }
      ctx.putImageData(imgData, 0, 0);
      return c.toDataURL('image/png');
    } catch(e){ return null; }
  })();
  if(whiteLogoSrc){
    try { doc.addImage(whiteLogoSrc, 'PNG', (W-65)/2, 13, 65, 19); } catch(e){}
  }

  doc.setFont('helvetica','bold'); doc.setFontSize(20); setTxt('#FFFFFF');
  doc.text('Synthesis-ICP', W/2, 40, {align:'center'});
  doc.setFont('helvetica','normal'); doc.setFontSize(9); setTxt('#B0B8C1');
  doc.text('Precision Scanner Report - Taratura', W/2, 46, {align:'center'});

  // Anello smooth - gradient SOTTILE nel colore base (v7.3.9.082)
  var scoreRingSrc = (function(){
    var sizePx = 700;
    var c = document.createElement('canvas');
    c.width = sizePx; c.height = sizePx;
    var ctx = c.getContext('2d');
    var cx = sizePx/2, cy = sizePx/2;
    var lineW = sizePx * 0.08;
    var ringR = (sizePx - lineW)/2 - 8;
    ctx.lineCap = 'butt';
    ctx.lineWidth = lineW;
    ctx.strokeStyle = '#28323F';
    ctx.beginPath();
    ctx.arc(cx, cy, ringR, 0, 2*Math.PI);
    ctx.stroke();
    var pct = Math.max(0, Math.min(1, (data.score||0)/100));
    if(pct > 0){
      var baseCol = (data.lv && data.lv.col) ? data.lv.col : '#0D9E6E';
      var lightCol = misICP_shadeHex(baseCol, 0.25);
      var darkCol  = misICP_shadeHex(baseCol, -0.15);
      var stroke;
      if(typeof ctx.createConicGradient === 'function'){
        var grad = ctx.createConicGradient(-Math.PI/2, cx, cy);
        grad.addColorStop(0,         lightCol);
        grad.addColorStop(pct*0.5,   baseCol);
        grad.addColorStop(pct,       darkCol);
        grad.addColorStop(1,         darkCol);
        stroke = grad;
      } else {
        stroke = baseCol;
      }
      ctx.strokeStyle = stroke;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(cx, cy, ringR, -Math.PI/2, -Math.PI/2 + pct * 2*Math.PI);
      ctx.stroke();
    }
    return c.toDataURL('image/png');
  })();
  var ringSize = 50, ringX = (W - ringSize)/2, ringY = 53;
  if(scoreRingSrc){
    try { doc.addImage(scoreRingSrc, 'PNG', ringX, ringY, ringSize, ringSize); } catch(e){}
  }
  setTxt('#FFFFFF'); doc.setFont('helvetica','bold'); doc.setFontSize(22);
  doc.text((data.score||0).toFixed(2), W/2, ringY + ringSize/2 + 1, {align:'center'});
  setTxt('#7A90A4'); doc.setFont('helvetica','normal'); doc.setFontSize(7);
  doc.text('/100', W/2, ringY + ringSize/2 + 6, {align:'center'});

  // Pillola ID Cert al posto del badge giudizio
  var pillY = ringY + ringSize + 6, pillH = 11, pillW = 78, pillX = (W-pillW)/2;
  setFill('#1A2C3F'); doc.roundedRect(pillX, pillY, pillW, pillH, 4, 4, 'F');
  setDraw('#FFD700'); doc.setLineWidth(0.4);
  doc.roundedRect(pillX, pillY, pillW, pillH, 4, 4, 'S');
  setTxt('#FFD700'); doc.setFont('helvetica','bold'); doc.setFontSize(10);
  doc.text(calibMeta.certId, W/2, pillY+7.5, {align:'center'});

  // Info box stile Clinico
  var infoY = pillY + pillH + 8;
  var infos = [
    ['File A (riferimento)', data.fileA],
    ['File B (confronto)',   data.fileB],
    ['N scanbody',           String(data.nCyl)],
    ['RMSD ICP',             (data.rmsdUm).toFixed(1)+' \u00b5m'],
    ['Data emissione',       calibMeta.dateStr + ' \u2022 ' + calibMeta.timeStr]
  ];
  infos.forEach(function(row,ii){
    var rowY = infoY + ii*8;
    setTxt('#7A90A4'); doc.setFont('helvetica','normal'); doc.setFontSize(7);
    doc.text(row[0], ml+4, rowY);
    setTxt('#FFFFFF'); doc.setFont('helvetica','bold'); doc.setFontSize(9);
    doc.text(String(row[1]), W-mr-4, rowY, {align:'right'});
    doc.setDrawColor(40,50,65); doc.setLineWidth(0.15);
    doc.line(ml+4, rowY+1.5, W-mr-4, rowY+1.5);
  });

  // Mappa colorimetrica (come Clinico)
  doc.setFont('helvetica','bold'); doc.setFontSize(8); setTxt('#FFCC55');
  var mapY = infoY + 5*8 + 6;
  doc.text('MAPPA COLORIMETRICA - POSIZIONI SCANBODY', ml, mapY);
  var mapCanvas = document.createElement('canvas');
  mapCanvas.width=880; mapCanvas.height=480;
  misICP_drawColorMap(mapCanvas, data.pairs);
  var mapH = 60;
  doc.addImage(mapCanvas.toDataURL('image/png'), 'PNG', ml, mapY+3, cw, mapH);

  // Legenda
  var legY = mapY + 3 + mapH + 4;
  var levels=[
    {c:'#639922', lbl:'0-50 \u00b5m'}, {c:'#D97706', lbl:'50-100 \u00b5m'},
    {c:'#F97316', lbl:'100-150 \u00b5m'}, {c:'#EF4444', lbl:'150-250 \u00b5m'},
    {c:'#A855F7', lbl:'>250 \u00b5m'}
  ];
  var segW=cw/levels.length;
  levels.forEach(function(l,li){
    var lx=ml+li*segW;
    var cRGB=misICP_hexRGB(l.c);
    doc.setFillColor(cRGB[0],cRGB[1],cRGB[2]);
    doc.rect(lx, legY, segW-1, 3, 'F');
    doc.setFont('helvetica','normal'); doc.setFontSize(6); setTxt('#B0B8C1');
    doc.text(l.lbl, lx+1, legY+7);
  });
}

function misICP_pdfDrawCalibrationIdPage(doc, calibMeta, data){
  var W=210, H=297, ml=14, mr=14, cw=W-ml-mr;
  function setFill(hex){ var c=misICP_hexRGB(hex); doc.setFillColor(c[0],c[1],c[2]); }
  function setTxt (hex){ var c=misICP_hexRGB(hex); doc.setTextColor(c[0],c[1],c[2]); }
  function setDraw(hex){ var c=misICP_hexRGB(hex); doc.setDrawColor(c[0],c[1],c[2]); }

  setFill('#0065B3'); doc.rect(0, 0, W, 14, 'F');
  setTxt('#FFFFFF'); doc.setFont('helvetica','bold'); doc.setFontSize(10);
  doc.text('SYNTESIS-ICP \u00b7 IDENTIFICAZIONE', ml, 9);
  doc.setFont('helvetica','normal'); doc.setFontSize(8);
  doc.text(calibMeta.certId, W-mr, 9, {align:'right'});

  function drawInfoBox(x, y, width, title, rows){
    var rowH=6.5, headH=8, totH=headH+rows.length*rowH+3;
    setDraw('#D6E4F0'); doc.setLineWidth(0.3);
    doc.rect(x, y, width, totH);
    setFill('#F0F5FA'); doc.rect(x, y, width, headH, 'F');
    setDraw('#D6E4F0'); doc.line(x, y+headH, x+width, y+headH);
    setTxt('#0065B3'); doc.setFont('helvetica','bold'); doc.setFontSize(8);
    doc.text(title, x+3, y+headH-2.5);
    for(var i=0;i<rows.length;i++){
      var ry = y + headH + (i+1)*rowH - 1.5;
      setTxt('#7A90A4'); doc.setFont('helvetica','normal'); doc.setFontSize(8);
      doc.text(rows[i][0], x+3, ry);
      setTxt('#0F1923'); doc.setFont('helvetica','bold'); doc.setFontSize(9);
      var v = String(rows[i][1] || '\u2014');
      if(v.length > 60) v = v.substring(0,57) + '...';
      doc.text(v, x+50, ry);
    }
    return totH;
  }

  var y = 25;
  setTxt('#0F1923'); doc.setFont('helvetica','bold'); doc.setFontSize(15);
  doc.text('Dati identificativi del certificato', ml, y); y += 5;
  setTxt('#7A90A4'); doc.setFont('helvetica','italic'); doc.setFontSize(9);
  doc.text('Identificazione di macchina sotto verifica, sito di installazione, operazione e file di riferimento.', ml, y);
  y += 10;

  var h = drawInfoBox(ml, y, cw, 'MACCHINA SOTTO VERIFICA', [
    ['Tipologia',         calibMeta.type],
    ['Produttore',        calibMeta.maker],
    ['Modello',           calibMeta.model],
    ['Numero di serie',   calibMeta.sn]
  ]); y += h + 6;
  h = drawInfoBox(ml, y, cw, 'INSTALLAZIONE', [
    ['Cliente',             calibMeta.client],
    ['Sede installazione',  calibMeta.site],
    ['Tecnico installatore', calibMeta.tech]
  ]); y += h + 6;
  h = drawInfoBox(ml, y, cw, 'OPERAZIONE', [
    ['Data taratura', calibMeta.dateStr + '  alle  ' + calibMeta.timeStr],
    ['Procedura',     'Allineamento Kabsch + SVD + ICP iterativo'],
    ['Software',      'Synthesis-ICP - Misurare (Analizza v' + window.ANALIZZA_BUILD + ')']
  ]); y += h + 6;
  h = drawInfoBox(ml, y, cw, 'FILE DI RIFERIMENTO', [
    ['Master STL',      data.fileAfull || data.fileA || '\u2014'],
    ['Output macchina', data.fileBfull || data.fileB || '\u2014'],
    ['N. scanbody',     String(data.nCyl || data.pairs.length)]
  ]);
}

function misICP_pdfDrawCalibrationSignaturesPage(doc, calibMeta, data){
  var W=210, H=297, ml=14, mr=14, cw=W-ml-mr;
  function setFill(hex){ var c=misICP_hexRGB(hex); doc.setFillColor(c[0],c[1],c[2]); }
  function setTxt (hex){ var c=misICP_hexRGB(hex); doc.setTextColor(c[0],c[1],c[2]); }
  function setDraw(hex){ var c=misICP_hexRGB(hex); doc.setDrawColor(c[0],c[1],c[2]); }

  setFill('#0065B3'); doc.rect(0, 0, W, 14, 'F');
  setTxt('#FFFFFF'); doc.setFont('helvetica','bold'); doc.setFontSize(10);
  doc.text('SYNTESIS-ICP \u00b7 VALIDAZIONE E FIRME', ml, 9);
  doc.setFont('helvetica','normal'); doc.setFontSize(8);
  doc.text(calibMeta.certId, W-mr, 9, {align:'right'});

  var y = 25;
  setTxt('#0F1923'); doc.setFont('helvetica','bold'); doc.setFontSize(13);
  doc.text('Validazione del certificato di taratura', ml, y); y += 6;
  setTxt('#7A90A4'); doc.setFont('helvetica','italic'); doc.setFontSize(9);
  doc.text('Conferma di consegna e accettazione del documento da parte di tecnico installatore e cliente.', ml, y);
  y += 10;

  setTxt('#0F1923'); doc.setFont('helvetica','bold'); doc.setFontSize(11);
  doc.text('Note operative', ml, y); y += 5;
  var noteText = calibMeta.notes && calibMeta.notes.length > 0
    ? calibMeta.notes : '(nessuna nota operativa registrata)';
  var noteLines = doc.splitTextToSize(noteText, cw - 6);
  var noteH = Math.max(16, noteLines.length * 4.5 + 4);
  setDraw('#D6E4F0'); doc.setLineWidth(0.3);
  doc.rect(ml, y, cw, noteH);
  setTxt('#0F1923'); doc.setFont('helvetica','normal'); doc.setFontSize(9);
  doc.text(noteLines, ml+3, y+5);
  y += noteH + 12;

  setTxt('#0F1923'); doc.setFont('helvetica','bold'); doc.setFontSize(12);
  doc.text('Consegna del rapporto', ml, y); y += 5;
  setTxt('#7A90A4'); doc.setFont('helvetica','normal'); doc.setFontSize(9);
  var consText = 'Il sottoscritto ' + calibMeta.tech + ' (tecnico installatore) attesta di aver eseguito le procedure di taratura iniziale del sistema sotto verifica e di consegnare al cliente il presente certificato.';
  var consLines = doc.splitTextToSize(consText, cw);
  doc.text(consLines, ml, y);
  y += consLines.length * 4.2 + 8;
  setTxt('#7A90A4'); doc.setFont('helvetica','bold'); doc.setFontSize(8);
  doc.text('DATA', ml, y);
  doc.text('FIRMA TECNICO INSTALLATORE', ml + 70, y);
  setDraw('#0F1923'); doc.setLineWidth(0.4);
  doc.line(ml, y+10, ml+55, y+10);
  doc.line(ml+70, y+10, W-mr, y+10);
  y += 18;

  setTxt('#0F1923'); doc.setFont('helvetica','bold'); doc.setFontSize(12);
  doc.text('Accettazione del rapporto', ml, y); y += 5;
  setTxt('#7A90A4'); doc.setFont('helvetica','normal'); doc.setFontSize(9);
  var accText = 'Il sottoscritto ' + calibMeta.client + ' (cliente) dichiara di aver ricevuto il presente certificato di taratura e di aver preso visione delle misure metrologiche riportate nel documento.';
  var accLines = doc.splitTextToSize(accText, cw);
  doc.text(accLines, ml, y);
  y += accLines.length * 4.2 + 8;
  setTxt('#7A90A4'); doc.setFont('helvetica','bold'); doc.setFontSize(8);
  doc.text('DATA', ml, y);
  doc.text('FIRMA CLIENTE / RESPONSABILE', ml + 70, y);
  setDraw('#0F1923'); doc.setLineWidth(0.4);
  doc.line(ml, y+10, ml+55, y+10);
  doc.line(ml+70, y+10, W-mr, y+10);

  setTxt('#7A90A4'); doc.setFont('helvetica','italic'); doc.setFontSize(7);
  var legalText = 'Questo certificato \u00e8 generato automaticamente da Syntesis-ICP a partire dal confronto metrologico dei file STL forniti. Il documento riporta le misure rilevate nel sistema di riferimento Kabsch+SVD+ICP. L\'interpretazione clinica o industriale dei valori \u00e8 a carico del tecnico e del cliente. Non sostituisce procedure di qualifica metrologica accreditate ISO 17025.';
  var legalLines = doc.splitTextToSize(legalText, cw);
  doc.text(legalLines, ml, H-26);
}

// ────────────────────────────────────────────────────────────────────
// REPORT ANALISI (PDF) — Clinico esteso con matrici e raw data
// ────────────────────────────────────────────────────────────────────
function misICP_renderAnalysisPDF(data){
  // Riusa la pipeline Clinico, poi appende pagine extra
  var doc = misICP_renderClinicalPDF(data);
  var W=210, H=297, ml=14, mr=14, cw=W-ml-mr;
  function setTxt(hex){ var c=misICP_hexRGB(hex); doc.setTextColor(c[0],c[1],c[2]); }

  // ── APPENDICE A: matrice distanze inter-centroide A vs B ─────────
  doc.addPage();
  setTxt('#0F1923');
  doc.setFont('helvetica','bold'); doc.setFontSize(16);
  doc.text('Appendice A - Matrice distanze A vs B', ml, 25);
  doc.setFont('helvetica','normal'); doc.setFontSize(9); setTxt('#7A90A4');
  doc.text('Distanze inter-centroide misurate: A (riferimento) sopra la diagonale, B (post-ICP) sotto.', ml, 32, {maxWidth:cw});

  var n = data.nCyl;
  // Costruisce la matrice
  function distAB(i, j, useB){
    if(i===j) return 0;
    var pi = data.pairs[i], pj = data.pairs[j];
    var ai = useB ? pi.b : pi.a;
    var aj = useB ? pj.b : pj.a;
    var dx=aj[0]-ai[0], dy=aj[1]-ai[1], dz=aj[2]-ai[2];
    return Math.sqrt(dx*dx+dy*dy+dz*dz)*1000;
  }
  var head = [''].concat(data.pairs.map(function(p,i){return '#'+(i+1);}));
  var body = [];
  for(var i=0; i<n; i++){
    var row = ['#'+(i+1)];
    for(var j=0; j<n; j++){
      if(i===j) row.push('—');
      else if(j>i) row.push(distAB(i,j,false).toFixed(1)); // A sopra
      else row.push(distAB(i,j,true).toFixed(1));            // B sotto
    }
    body.push(row);
  }
  doc.autoTable({
    startY: 42,
    margin: {left:ml, right:mr},
    head: [head],
    body: body,
    theme: 'grid',
    styles: {font:'courier', fontSize:8, cellPadding:1.5, halign:'right', textColor:[33,37,41], lineColor:[214,228,240], lineWidth:0.15},
    headStyles: {fillColor:[247,249,252], textColor:[122,144,164], fontStyle:'bold', fontSize:7, halign:'center'},
    columnStyles: {0:{fontStyle:'bold', textColor:[122,144,164], halign:'left'}}
  });
  var afterY = doc.lastAutoTable.finalY + 8;
  doc.setFont('helvetica','italic'); doc.setFontSize(7); setTxt('#7A90A4');
  doc.text('Valori in micrometri. La matrice è simmetrica per costruzione: A[i][j] = A[j][i] e B[i][j] = B[j][i]. La triangolare superiore mostra le distanze nel riferimento (file A); quella inferiore mostra le stesse coppie misurate dopo allineamento ICP del file B.', ml, afterY, {maxWidth:cw});

  misICP_pdfFooter(doc, 'Synthesis-ICP - Matrice distanze', 'Appendice A', false);

  // ── APPENDICE B: raw data ─────────────────────────────────────────
  doc.addPage();
  setTxt('#0F1923');
  doc.setFont('helvetica','bold'); doc.setFontSize(16);
  doc.text('Appendice B - Dati grezzi', ml, 25);
  doc.setFont('helvetica','normal'); doc.setFontSize(9); setTxt('#7A90A4');
  doc.text('Tutte le metriche numeriche per cilindro, in formato esportabile.', ml, 32);

  var rawRows = data.pairs.map(function(p, i){
    var ax = data.cylAxes[i];
    return [
      '#'+(i+1),
      p.a[0].toFixed(3),
      p.a[1].toFixed(3),
      p.a[2].toFixed(3),
      p.b[0].toFixed(3),
      p.b[1].toFixed(3),
      p.b[2].toFixed(3),
      Math.round(p.dx*1000),
      Math.round(p.dy*1000),
      Math.round(p.dz*1000),
      Math.round(p.d3*1000),
      ax ? ax.angleDeg.toFixed(3) : 'n/d'
    ];
  });
  doc.autoTable({
    startY: 42,
    margin: {left:ml, right:mr},
    head: [['#','Ax','Ay','Az','Bx','By','Bz','dX','dY','dZ','|D|','Asse°']],
    body: rawRows,
    theme: 'grid',
    styles: {font:'courier', fontSize:6.5, cellPadding:1, halign:'right', textColor:[33,37,41], lineColor:[214,228,240], lineWidth:0.15},
    headStyles: {fillColor:[247,249,252], textColor:[122,144,164], fontStyle:'bold', fontSize:6, halign:'center'},
    columnStyles: {0:{fontStyle:'bold', textColor:[122,144,164], halign:'center'}}
  });

  misICP_pdfFooter(doc, 'Synthesis-ICP - Dati grezzi', 'Appendice B', false);

  return doc;
}

// ────────────────────────────────────────────────────────────────────
// EXPORT EXCEL — 4 fogli (Cilindri / Coppie / Parametri / Metadati)
// ────────────────────────────────────────────────────────────────────
function misICP_renderExcel(data){
  if(!window.XLSX){
    throw new Error('SheetJS non caricato. Ricarica la pagina e riprova.');
  }
  var wb = XLSX.utils.book_new();

  var fileAfull = data.fileAfull || data.fileA || 'A';
  var fileBfull = data.fileBfull || data.fileB || 'B';
  var dtStr = misICP_fmtDateTime(data.timestamp);
  var dtIso = data.timestamp ? data.timestamp.toISOString() : '';
  var avgAngle = (data.avgAngle != null) ? data.avgAngle : 0;
  var lvLabel = (data.lv && data.lv.label) ? data.lv.label : 'n/d';

  // Header di tracciabilità ripetuto su ogni foglio operativo
  function buildHeader(sheetTitle){
    return [
      ['SYNTESIS-ICP - ' + sheetTitle],
      ['File A (riferimento)',  fileAfull],
      ['File B (confronto)',    fileBfull],
      ['Data analisi',          dtStr],
      ['N. scanbody analizzati', data.nCyl],
      ['RMSD ICP globale (µm)',  Number((data.rmsdUm||0).toFixed(2))],
      ['Voto globale',           Number((data.score||0).toFixed(2)) + ' / 100  (' + lvLabel + ')'],
      []
    ];
  }

  // ─────────────────────────────────────────────────────
  // FOGLIO 1: SOMMARIO
  // ─────────────────────────────────────────────────────
  var summary = [
    ['SYNTESIS-ICP — REPORT MISURE'],
    [],
    ['IDENTIFICAZIONE'],
    ['File A (riferimento)',   fileAfull],
    ['File B (confronto)',     fileBfull],
    ['Data analisi (locale)',  dtStr],
    ['Data analisi (ISO 8601)', dtIso],
    [],
    ['RISULTATI GLOBALI'],
    ['N. scanbody analizzati',  data.nCyl,                            ''],
    ['RMSD ICP globale',        Number((data.rmsdUm||0).toFixed(2)),  'µm'],
    ['Angolo asse medio',       Number(avgAngle.toFixed(3)),          'deg'],
    ['Voto globale',            Number((data.score||0).toFixed(2)),   '/100'],
    ['Classificazione',         lvLabel,                              ''],
    ['Scala mappa colorimetrica', data.scaleUm,                       'µm'],
    [],
    ['SOFTWARE'],
    ['Applicativo',  'Synthesis-ICP - Misurare (Analizza v' + window.ANALIZZA_BUILD + ')'],
    ['Produttore',   'Biaggini Medical Devices S.r.l.'],
    ['Sito',         'https://synthesis-icp.com'],
    [],
    ['NOTE METODOLOGICHE'],
    ['Algoritmo allineamento', 'Kabsch + SVD + ICP iterativo'],
    ['Riferimento misure',     'Centroidi e assi degli scanbody (cap-based PCA)'],
    ['Unità centroidi',        'mm'],
    ['Unità deviazioni',       'µm (1/1000 mm)'],
    ['Unità angoli',           'gradi sessagesimali']
  ];
  var wsS = XLSX.utils.aoa_to_sheet(summary);
  wsS['!cols'] = [{wch:32},{wch:46},{wch:10}];
  wsS['!merges'] = [{s:{r:0,c:0},e:{r:0,c:2}}];
  XLSX.utils.book_append_sheet(wb, wsS, 'Sommario');

  // ─────────────────────────────────────────────────────
  // FOGLIO 2: CILINDRI (esteso con indici, assi, triangoli)
  // ─────────────────────────────────────────────────────
  var cilHeader = [
    '#', 'Idx A', 'Idx B',
    'Centroide A X (mm)', 'Centroide A Y (mm)', 'Centroide A Z (mm)',
    'Centroide B X (mm)', 'Centroide B Y (mm)', 'Centroide B Z (mm)',
    'Asse A dir X', 'Asse A dir Y', 'Asse A dir Z',
    'Asse B dir X', 'Asse B dir Y', 'Asse B dir Z',
    'Deviazione X (µm)', 'Deviazione Y (µm)', 'Deviazione Z (µm)',
    '|D| 3D (µm)', '|D| XY (µm)',
    'Angolo asse A-B (deg)',
    'Triangoli A', 'Triangoli B',
    'Classe |D| 3D', 'Classe asse'
  ];
  var cilData = data.pairs.map(function(p, i){
    var ax = data.cylAxes[i];
    var d3um = Math.round(p.d3*1000);
    var clv = misICP_clinLevel(d3um);
    var axLvl = ax ? misICP_clinAx(ax.angleDeg).label : 'n/d';
    var axA = p.axA || [null,null,null];
    var axB = p.axBt || [null,null,null];
    var nA = (p.trisA && p.trisA.length) || 0;
    var nB = (p.trisB && p.trisB.length) || 0;
    return [
      i+1,
      (p.iA != null ? p.iA : ''),
      (p.iB != null ? p.iB : ''),
      Number(p.a[0].toFixed(4)), Number(p.a[1].toFixed(4)), Number(p.a[2].toFixed(4)),
      Number(p.b[0].toFixed(4)), Number(p.b[1].toFixed(4)), Number(p.b[2].toFixed(4)),
      (axA[0]!=null) ? Number(axA[0].toFixed(6)) : '',
      (axA[1]!=null) ? Number(axA[1].toFixed(6)) : '',
      (axA[2]!=null) ? Number(axA[2].toFixed(6)) : '',
      (axB[0]!=null) ? Number(axB[0].toFixed(6)) : '',
      (axB[1]!=null) ? Number(axB[1].toFixed(6)) : '',
      (axB[2]!=null) ? Number(axB[2].toFixed(6)) : '',
      Math.round(p.dx*1000), Math.round(p.dy*1000), Math.round(p.dz*1000),
      d3um, Math.round(p.dxy*1000),
      ax ? Number(ax.angleDeg.toFixed(3)) : '',
      nA, nB,
      clv.label, axLvl
    ];
  });
  var cilSheet = buildHeader('Cilindri (centroidi, assi, deviazioni)').concat([cilHeader]).concat(cilData);
  var ws1 = XLSX.utils.aoa_to_sheet(cilSheet);
  ws1['!cols'] = cilHeader.map(function(h){
    if(h === '#') return {wch:5};
    if(/^Idx/.test(h)) return {wch:6};
    if(/Triangoli/.test(h)) return {wch:11};
    if(/Classe/.test(h)) return {wch:14};
    return {wch:14};
  });
  XLSX.utils.book_append_sheet(wb, ws1, 'Cilindri');

  // ─────────────────────────────────────────────────────
  // FOGLIO: DIAGNOSTICA (8.66.5) — decomposizione CENTRO-vs-ASSE + sistema/processo.
  // Tutte le info utili per la diagnosi, sempre nel report (niente copia-incolla da console).
  // Cap-baricentro = connessione + capZ·asse (= centro di posa, leva ~0). Se Cap-baric ≈
  // Centroide -> domina il CENTRO (centraggio); se Cap-baric ≈ 0 -> domina l'ASSE (tilt×leva).
  // ─────────────────────────────────────────────────────
  var _sostEng = 'n/d', _axEng = 'n/d';
  try { if(typeof synSostCenterRead==='function') _sostEng = synSostCenterRead(); } catch(e){}
  try { if(typeof synAxisEngineRead==='function') _axEng = synAxisEngineRead('auto'); } catch(e){}
  var diagSys = [
    ['SISTEMA / PROCESSO'],
    ['Versione (ANALIZZA_BUILD)',     window.ANALIZZA_BUILD],
    ['Motore centraggio Sostituire',  _sostEng],
    ['Motore asse cilindro',          _axEng],
    ['Algoritmo allineamento',        'Kabsch + SVD + ICP iterativo'],
    ['Riferimento asse',              'cap-based PCA'],
    ['RMSD ICP globale (µm)',         Number((data.rmsdUm||0).toFixed(2))],
    ['Angolo asse medio (deg)',       Number(avgAngle.toFixed(3))],
    ['Voto globale',                  Number((data.score||0).toFixed(2)) + ' / 100 (' + lvLabel + ')'],
    [],
    ['DECOMPOSIZIONE CENTRO-vs-ASSE (per cilindro)'],
    ['Cap-baricentro = connessione + capZ·asse (= centro di posa, leva ~0). Se Cap-baric ≈ Centroide -> domina il CENTRO; se Cap-baric ≈ 0 ma Centroide grande -> domina l\'ASSE (tilt x leva).'],
    []
  ];
  var diagHeader = [
    '#', 'Tipo', 'capZ (mm)',
    'Centroide |D| (µm)', 'Cen dX', 'Cen dY', 'Cen dZ',
    'Cap-baric A X (mm)', 'Cap-baric A Y', 'Cap-baric A Z',
    'Cap-baric B X (mm)', 'Cap-baric B Y', 'Cap-baric B Z',
    'Cap-baric |D| (µm)', 'Cap dX', 'Cap dY', 'Cap dZ',
    'Connessione |D| (µm)', 'Angolo asse (deg)', 'Verdetto centro/asse'
  ];
  var diagData = data.pairs.map(function(p, i){
    var d3um = Math.round(p.d3*1000);
    if(p.iB < 0 || !p.connA || !p.connB || p.connCapZ==null || !p.connAxA || !p.connAxB){
      return [i+1, (p.sbType||'?'), '', d3um, Math.round(p.dx*1000), Math.round(p.dy*1000), Math.round(p.dz*1000),
        '','','', '','','', '','','','',
        (p.connD3um!=null?Number(p.connD3um.toFixed(1)):''),
        (p.axAngleDeg!=null?Number(p.axAngleDeg.toFixed(3)):''), 'n/d (no connessione)'];
    }
    var cZ=p.connCapZ, aA=p.connAxA, aB=p.connAxB;
    var capA=[p.connA[0]+cZ*aA[0], p.connA[1]+cZ*aA[1], p.connA[2]+cZ*aA[2]];
    var capB=[p.connB[0]+cZ*aB[0], p.connB[1]+cZ*aB[1], p.connB[2]+cZ*aB[2]];
    var kdx=(capB[0]-capA[0])*1000, kdy=(capB[1]-capA[1])*1000, kdz=(capB[2]-capA[2])*1000;
    var kD=Math.sqrt(kdx*kdx+kdy*kdy+kdz*kdz);
    var verdict = (d3um>0.5) ? (kD>=0.7*d3um ? 'CENTRO domina' : (kD<=0.3*d3um ? 'ASSE domina' : 'misto')) : 'trascurabile';
    return [
      i+1, (p.sbType||'?'), Number(cZ.toFixed(2)),
      d3um, Math.round(p.dx*1000), Math.round(p.dy*1000), Math.round(p.dz*1000),
      Number(capA[0].toFixed(4)), Number(capA[1].toFixed(4)), Number(capA[2].toFixed(4)),
      Number(capB[0].toFixed(4)), Number(capB[1].toFixed(4)), Number(capB[2].toFixed(4)),
      Number(kD.toFixed(1)), Math.round(kdx), Math.round(kdy), Math.round(kdz),
      (p.connD3um!=null?Number(p.connD3um.toFixed(1)):''),
      (p.axAngleDeg!=null?Number(p.axAngleDeg.toFixed(3)):''),
      verdict
    ];
  });
  var diagSheet = buildHeader('Diagnostica centro-vs-asse + sistema').concat(diagSys).concat([diagHeader]).concat(diagData);
  var wsD = XLSX.utils.aoa_to_sheet(diagSheet);
  wsD['!cols'] = diagHeader.map(function(h){
    if(h==='#') return {wch:5};
    if(h==='Tipo') return {wch:7};
    if(/Verdetto/.test(h)) return {wch:18};
    return {wch:14};
  });
  XLSX.utils.book_append_sheet(wb, wsD, 'Diagnostica');

  // ─────────────────────────────────────────────────────
  // FOGLIO 3: COPPIE INTER-CENTROIDE (con vettori completi)
  // ─────────────────────────────────────────────────────
  var cpHeader = [
    'Coppia', 'Cilindro i', 'Cilindro j',
    'A: dx (mm)', 'A: dy (mm)', 'A: dz (mm)', 'Distanza A (µm)',
    'B: dx (mm)', 'B: dy (mm)', 'B: dz (mm)', 'Distanza B (µm)',
    'Δ (µm)', '|Δ| (µm)',
    'Vett. B-A: dx (µm)', 'Vett. B-A: dy (µm)', 'Vett. B-A: dz (µm)',
    'Valutazione'
  ];
  var cpData = [];
  for(var ii=0; ii<data.pairs.length; ii++){
    for(var jj=ii+1; jj<data.pairs.length; jj++){
      var pi = data.pairs[ii], pj = data.pairs[jj];
      var dxA = pj.a[0]-pi.a[0], dyA = pj.a[1]-pi.a[1], dzA = pj.a[2]-pi.a[2];
      var dxB = pj.b[0]-pi.b[0], dyB = pj.b[1]-pi.b[1], dzB = pj.b[2]-pi.b[2];
      var distA_um = Math.sqrt(dxA*dxA+dyA*dyA+dzA*dzA)*1000;
      var distB_um = Math.sqrt(dxB*dxB+dyB*dyB+dzB*dzB)*1000;
      var delta_um = distB_um - distA_um;
      var diffX_um = (dxB - dxA) * 1000;
      var diffY_um = (dyB - dyA) * 1000;
      var diffZ_um = (dzB - dzA) * 1000;
      // Recupera la valutazione clinica già calcolata (matcha per indici 1-based)
      var lvCp = '';
      for(var kk=0; kk<data.interCentroidPairs.length; kk++){
        var c = data.interCentroidPairs[kk];
        if(c.i === ii+1 && c.j === jj+1){ lvCp = c.lv.label; break; }
      }
      cpData.push([
        '#'+(ii+1)+'-#'+(jj+1),
        ii+1, jj+1,
        Number(dxA.toFixed(4)), Number(dyA.toFixed(4)), Number(dzA.toFixed(4)),
        Number(distA_um.toFixed(1)),
        Number(dxB.toFixed(4)), Number(dyB.toFixed(4)), Number(dzB.toFixed(4)),
        Number(distB_um.toFixed(1)),
        Number(delta_um.toFixed(1)),
        Number(Math.abs(delta_um).toFixed(1)),
        Number(diffX_um.toFixed(1)),
        Number(diffY_um.toFixed(1)),
        Number(diffZ_um.toFixed(1)),
        lvCp
      ]);
    }
  }
  var cpSheet = buildHeader('Coppie inter-centroide (passive fit)').concat([cpHeader]).concat(cpData);
  var ws2 = XLSX.utils.aoa_to_sheet(cpSheet);
  ws2['!cols'] = cpHeader.map(function(h){
    if(/^Coppia$/.test(h)) return {wch:11};
    if(/^Cilindro/.test(h)) return {wch:9};
    if(/Valutazione/.test(h)) return {wch:14};
    return {wch:15};
  });
  XLSX.utils.book_append_sheet(wb, ws2, 'Coppie');

  // ─────────────────────────────────────────────────────
  // FOGLIO 4: TRASFORMAZIONE ICP (R, t, rotazione equivalente)
  // ─────────────────────────────────────────────────────
  var R = data.icpR || [[1,0,0],[0,1,0],[0,0,1]];
  var t = data.icpT || [0,0,0];
  var tNorm = Math.sqrt(t[0]*t[0] + t[1]*t[1] + t[2]*t[2]);
  // Angolo rotazione totale dalla traccia: cos(θ) = (trace(R) - 1) / 2
  var trR = R[0][0] + R[1][1] + R[2][2];
  var cosT = (trR - 1) / 2;
  if(cosT > 1)  cosT = 1;
  if(cosT < -1) cosT = -1;
  var rotAngleDeg = Math.acos(cosT) * 180 / Math.PI;
  var icpData = [
    ['Trasformazione rigida applicata a B per allinearlo ad A:  B\' = R · B + t'],
    [],
    ['MATRICE ROTAZIONE R (3x3)'],
    ['', 'colonna 0', 'colonna 1', 'colonna 2'],
    ['riga 0', Number(R[0][0].toFixed(8)), Number(R[0][1].toFixed(8)), Number(R[0][2].toFixed(8))],
    ['riga 1', Number(R[1][0].toFixed(8)), Number(R[1][1].toFixed(8)), Number(R[1][2].toFixed(8))],
    ['riga 2', Number(R[2][0].toFixed(8)), Number(R[2][1].toFixed(8)), Number(R[2][2].toFixed(8))],
    [],
    ['VETTORE TRASLAZIONE t'],
    ['tx (mm)',  Number(t[0].toFixed(6))],
    ['ty (mm)',  Number(t[1].toFixed(6))],
    ['tz (mm)',  Number(t[2].toFixed(6))],
    ['|t| (mm)', Number(tNorm.toFixed(6))],
    [],
    ['ROTAZIONE EQUIVALENTE'],
    ['Angolo rotazione totale (deg)', Number(rotAngleDeg.toFixed(4))],
    ['Traccia(R)',                    Number(trR.toFixed(8))],
    [],
    ['CONVERGENZA ICP'],
    ['RMSD finale (mm)', Number(((data.rmsdUm||0)/1000).toFixed(6))],
    ['RMSD finale (µm)', Number((data.rmsdUm||0).toFixed(2))]
  ];
  var icpSheet = buildHeader('Trasformazione ICP').concat(icpData);
  var ws3 = XLSX.utils.aoa_to_sheet(icpSheet);
  ws3['!cols'] = [{wch:32},{wch:18},{wch:18},{wch:18}];
  XLSX.utils.book_append_sheet(wb, ws3, 'Trasformazione ICP');

  // ─────────────────────────────────────────────────────
  // FOGLIO 5: PARAMETRI E SOGLIE CLINICHE
  // ─────────────────────────────────────────────────────
  var paramData = [
    ['Parametro', 'Valore', 'Unità'],
    ['RMSD ICP globale',          Number((data.rmsdUm||0).toFixed(2)),    'µm'],
    ['Angolo asse medio',         Number(avgAngle.toFixed(3)),            'deg'],
    ['N. scanbody analizzati',    data.nCyl,                              ''],
    ['Voto globale',              Number((data.score||0).toFixed(2)),     '/100'],
    ['Classificazione',           lvLabel,                                ''],
    ['Scala mappa colorimetrica', data.scaleUm,                           'µm'],
    [],
    ['SOGLIE CLINICHE |D| 3D'],
    ['Ottimo (<)',         50,  'µm'],
    ['Accettabile (<)',   100,  'µm'],
    ['Rischioso (<)',     150,  'µm'],
    ['Tensione (<)',      250,  'µm'],
    ['Fuori (>=)',        250,  'µm'],
    [],
    ['SOGLIE CLINICHE ANGOLO ASSE']
  ].concat(
    // 8.80.4: derivate dal canonico MIS_CLIN_AX (window.SYN.thresholds.angular_deg,
    // 5 classi 0.5/1.5/3/6). Erano hardcodate 0.5/1.0/2.0 su 4 classi, in DRIFT col
    // foglio 'Cilindri' dello stesso workbook che classifica via misICP_clinAx.
    MIS_CLIN_AX.map(function(t, i){
      var last = (i === MIS_CLIN_AX.length - 1);
      return [t.label + (last ? ' (>=)' : ' (<)'), last ? MIS_CLIN_AX[i-1].max : t.max, 'deg'];
    })
  ).concat([
    [],
    ['SOGLIE INTER-CENTROIDE |Δ|'],
    ['Ottimo (<)',         50,  'µm'],
    ['Buono (<)',         100,  'µm'],
    ['Accettabile (<)',   200,  'µm'],
    ['Verifica (>=)',     200,  'µm']
  ]);
  var paramSheet = buildHeader('Parametri e soglie cliniche').concat(paramData);
  var ws4 = XLSX.utils.aoa_to_sheet(paramSheet);
  ws4['!cols'] = [{wch:32},{wch:18},{wch:10}];
  XLSX.utils.book_append_sheet(wb, ws4, 'Parametri');

  // ─────────────────────────────────────────────────────
  // FOGLIO 6: METADATI (tracciabilità completa)
  // ─────────────────────────────────────────────────────
  var ua = (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : '';
  var slugA = misICP_slugifyFilename(fileAfull);
  var slugB = misICP_slugifyFilename(fileBfull);
  var metaData = [
    ['Campo', 'Valore'],
    ['File A originale (nome completo)', fileAfull],
    ['File A slug filesystem',           slugA],
    ['File B originale (nome completo)', fileBfull],
    ['File B slug filesystem',           slugB],
    ['Data analisi (locale)',            dtStr],
    ['Data analisi (ISO 8601)',          dtIso],
    ['Software',                         'Synthesis-ICP - Misurare (Analizza v' + window.ANALIZZA_BUILD + ')'],
    ['Produttore',                       'Biaggini Medical Devices S.r.l.'],
    ['Sito',                             'https://synthesis-icp.com'],
    ['User-Agent browser',               ua]
  ];
  var ws5 = XLSX.utils.aoa_to_sheet(metaData);
  ws5['!cols'] = [{wch:34},{wch:60}];
  XLSX.utils.book_append_sheet(wb, ws5, 'Metadati');

  return wb;
}

// ────────────────────────────────────────────────────────────────────
// HELPER: slugify nome file e timestamp completo (data + ora)
// ────────────────────────────────────────────────────────────────────
function misICP_slugifyFilename(s){
  if(!s) return 'file';
  var slug = String(s).replace(/\.stl$/i, '')
                       .replace(/[^A-Za-z0-9_\-]+/g, '_')
                       .replace(/_+/g, '_')
                       .replace(/^_+|_+$/g, '');
  return slug.slice(0, 40) || 'file';
}
function misICP_dateTimeSlug(d){
  d = d || new Date();
  var pad = function(n){ return String(n).padStart(2,'0'); };
  return d.getFullYear() + pad(d.getMonth()+1) + pad(d.getDate())
         + '-' + pad(d.getHours()) + pad(d.getMinutes());
}

// ────────────────────────────────────────────────────────────────────
// DISPATCHER + UI helpers
// ────────────────────────────────────────────────────────────────────

/**
 * Toggle del menu drop-down "Scarica report".
 */
function misICP_toggleReportMenu(e){
  if(e) e.stopPropagation();
  var d = document.getElementById('misReportDrop');
  if(!d) return;
  var isOpen = d.style.display === 'block';
  d.style.display = isOpen ? 'none' : 'block';
  if(!isOpen){
    setTimeout(function(){
      document.addEventListener('click', misICP_closeReportMenu, {once:true});
    }, 0);
  }
}
function misICP_closeReportMenu(){
  var d = document.getElementById('misReportDrop');
  if(d) d.style.display = 'none';
}

/**
 * Punto di ingresso unico per i 4 tipi di report.
 */
function misICP_generateReport(kind){
  misICP_closeReportMenu();
  if(!misICP_result || !misICP_result.pairs || !misICP_result.pairs.length){
    misICP_showError('Nessun allineamento ICP disponibile. Esegui prima l\'ICP.');
    return;
  }
  if(kind !== 'excel' && !window.jspdf){
    misICP_showError('jsPDF non caricato. Attendi qualche secondo e riprova.');
    return;
  }
  if(kind === 'excel' && !window.XLSX){
    misICP_showError('Libreria Excel non caricata. Ricarica la pagina e riprova.');
    return;
  }
  var btn=document.getElementById('misBtnReport');
  if(btn){ btn.classList.add('busy'); btn.innerHTML='<span>Generazione in corso...</span>'; }
  misICP_clearError();

  // FIX v7.3.9.082: per Taratura apri modal di raccolta metadati invece di generare subito
  if(kind === 'taratura'){
    var btn0 = document.getElementById('misBtnReport');
    if(btn0){ btn0.classList.remove('busy'); btn0.innerHTML = '<span>Scarica report</span><span style="font-size:13px;opacity:0.8">&#9662;</span>'; }
    misICP_openCalibrationModal();
    return;
  }

  setTimeout(function(){
    try {
      var data = misICP_buildReportData();
      var dateSlug = new Date().toISOString().slice(0,10).replace(/-/g,'');

      if(kind === 'clinico'){
        var doc = misICP_renderClinicalPDF(data);
        doc.save('SyntesisICP_Clinico_'+dateSlug+'.pdf');
        showStatus('Report Clinico salvato.');
      } else if(kind === 'taratura'){
        var doc2 = misICP_renderCalibrationPDF(data);
        doc2.save('SyntesisICP_Taratura_'+dateSlug+'.pdf');
        showStatus('Report Taratura salvato.');
      } else if(kind === 'analisi'){
        var doc3 = misICP_renderAnalysisPDF(data);
        doc3.save('SyntesisICP_Analisi_'+dateSlug+'.pdf');
        showStatus('Report Analisi salvato.');
      } else if(kind === 'excel'){
        var wb = misICP_renderExcel(data);
        var slugA = misICP_slugifyFilename(misICP_result.fileA || data.fileAfull || data.fileA || 'A');
        var slugB = misICP_slugifyFilename(misICP_result.fileB || data.fileBfull || data.fileB || 'B');
        var dtSlug = misICP_dateTimeSlug(data.timestamp);
        var xlsxName = 'SyntesisICP_Misure_' + slugA + '__vs__' + slugB + '_' + dtSlug + '.xlsx';
        XLSX.writeFile(wb, xlsxName);
        showStatus('Tabella Excel salvata: ' + xlsxName);
      } else {
        throw new Error('Tipo report sconosciuto: '+kind);
      }
    }
    catch(err){
      console.error('[Report] Generazione fallita:', err);
      misICP_showError('Errore generazione report: '+(err.message||err));
    }
    finally {
      var btn=document.getElementById('misBtnReport');
      if(btn){ btn.classList.remove('busy'); btn.innerHTML='<span>Scarica report</span><span style="font-size:13px;opacity:0.8">&#9662;</span>'; }
    }
  }, 40);
}

/**
 * Alias di retrocompatibilità: vecchio bottone PDF -> Clinico.
 */
function misICP_generatePDF(){
  return misICP_generateReport('clinico');
}
