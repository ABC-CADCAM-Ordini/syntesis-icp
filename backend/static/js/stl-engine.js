// ─────────────────────────────────────────────────────────────
// Syntesis-ICP — stl-engine.js
// Estratto da index.html (script #3)
// Copyright (C) Francesco Biaggini. Tutti i diritti riservati.
// ─────────────────────────────────────────────────────────────

// ── STL engine + canvas (from v6) ────────────────────────────────────────
// STL engine globals
var LR=null;


// ── Clinical thresholds ────────────────────────────────────────────────────
var CLIN=[
  {max:50,  label:'Ottimo',          bg:'#EAF3DE',fg:'#3B6D11',col:'#639922'},
  {max:100, label:'Accettabile',     bg:'#FEFCE8',fg:'#854D0E',col:'#D97706'},
  {max:150, label:'Rischioso',       bg:'#FFF3E0',fg:'#9A3412',col:'#F97316'},
  {max:250, label:'Tensione',        bg:'#FEE2E2',fg:'#991B1B',col:'#EF4444'},
  {max:9999,label:'Fuori posizione', bg:'#F3E0F7',fg:'#6B21A8',col:'#A855F7'}
];

// ── Canvas drawing helpers ────────────────────────────────────────────────
function hexRGB(h){return[parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)];}

function getScaleUm(pairs){
  var maxD3=pairs.reduce(function(m,pp){return pp.d3!==null?Math.max(m,pp.d3):m;},0)*1000;
  return maxD3<50?50:(maxD3<100?100:(maxD3<150?150:(maxD3<250?250:500)));
}

// ── Draw full card on canvas ──────────────────────────────────────────────
function drawCard(cv,dxum,dyum,dzum,d3um,scaleUm,axDeg){
  if(!cv)return;
  var ctx=cv.getContext('2d'),W=cv.width,H=cv.height;
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle='#ffffff';ctx.fillRect(0,0,W,H);
  var lv=clinLevel(d3um);

  // ── Fixed layout: three columns, no overlap ───────────────────────
  // Col A: gauge    x=0      w=210
  // Col B: compass  x=220    w=200
  // Col C: bars     x=430    w=W-430-10
  var colAx=0,colAw=210;
  var colBx=220,colBw=200;
  var colCx=430,colCw=W-440;

  // ── GAUGE (col A) ─────────────────────────────────────────────────
  // Semicircle sits in top half, value text in bottom half — no overlap
  var gcx=colAx+colAw/2;
  var gr=Math.min(colAw/2-18, H*0.40); // radius fits in upper 40% of height
  var gcy=gr+20; // center of semicircle = radius + top padding

  // Background arc
  ctx.beginPath();ctx.arc(gcx,gcy,gr,Math.PI,0);
  ctx.strokeStyle='#eeeeee';ctx.lineWidth=gr*0.22;ctx.stroke();
  // Zone bands
  var zc=['#63992244','#D9770644','#F9731644','#EF444444','#A855F744'];
  var zb=[0,0.2,0.4,0.6,0.8,1.0];
  zb.forEach(function(from,zi){
    if(zi>=5)return;
    ctx.beginPath();ctx.arc(gcx,gcy,gr,Math.PI*(1-from),Math.PI*(1-zb[zi+1]),true);
    ctx.strokeStyle=zc[zi];ctx.lineWidth=gr*0.22;ctx.stroke();
  });
  // Fill arc
  var frac=Math.min(1,d3um/scaleUm);
  if(frac>0.005){
    ctx.beginPath();ctx.arc(gcx,gcy,gr,Math.PI,Math.PI*(1-frac),true);
    ctx.strokeStyle=lv.col;ctx.lineWidth=gr*0.22;ctx.stroke();
  }
  // Needle dot
  var na=Math.PI*(1-frac);
  var nx=gcx+gr*Math.cos(na),ny=gcy+gr*Math.sin(na);
  ctx.beginPath();ctx.arc(nx,ny,gr*0.10,0,Math.PI*2);
  ctx.fillStyle=lv.col;ctx.fill();
  ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();
  // Scale endpoints (at arc tips — outside the arc, well separated from value)
  ctx.fillStyle='#c0c5ce';ctx.font='8px monospace';ctx.textAlign='center';
  ctx.fillText('0', gcx-gr-8, gcy+6);
  ctx.fillText(''+scaleUm, gcx+gr+8, gcy+6);
  // Value block — positioned BELOW the semicircle bottom line
  var valY = gcy + 18; // below center point of semicircle
  ctx.fillStyle=lv.col;
  ctx.font='bold '+Math.min(38,Math.round(gr*0.55))+'px monospace';
  ctx.textAlign='center';
  ctx.fillText(''+d3um, gcx, valY);
  ctx.fillStyle='#9ca3af';ctx.font='10px monospace';ctx.textAlign='center';
  ctx.fillText('\u03bcm  /  '+scaleUm, gcx, valY+16);

  // ── COMPASS (col B) ───────────────────────────────────────────────
  var ccx=colBx+colBw/2, ccy=H/2;
  var cr=Math.min(colBw/2-12, H/2-14);
  // Rings
  ctx.beginPath();ctx.arc(ccx,ccy,cr,0,Math.PI*2);
  ctx.strokeStyle='#e5e7eb';ctx.lineWidth=1.5;ctx.stroke();
  ctx.beginPath();ctx.arc(ccx,ccy,cr*0.45,0,Math.PI*2);
  ctx.strokeStyle='#f0f0f0';ctx.lineWidth=0.8;ctx.stroke();
  // Crosshair
  ctx.strokeStyle='#f0f0f0';ctx.lineWidth=0.7;ctx.setLineDash([2,4]);
  ctx.beginPath();ctx.moveTo(ccx,ccy-cr+4);ctx.lineTo(ccx,ccy+cr-4);ctx.stroke();
  ctx.beginPath();ctx.moveTo(ccx-cr+4,ccy);ctx.lineTo(ccx+cr-4,ccy);ctx.stroke();
  ctx.setLineDash([]);
  // Cardinals
  ctx.fillStyle='#c0c5ce';ctx.font='bold 8px monospace';ctx.textAlign='center';
  ctx.fillText('N',ccx,ccy-cr-4);ctx.fillText('S',ccx,ccy+cr+10);
  ctx.textAlign='left';ctx.fillText('E',ccx+cr+4,ccy+3);
  ctx.textAlign='right';ctx.fillText('O',ccx-cr-4,ccy+3);
  // Arrow
  var bearing=Math.atan2(dxum,-dyum);
  var arrowLen=cr*0.76;
  var bx=ccx+arrowLen*Math.sin(bearing),by=ccy-arrowLen*Math.cos(bearing);
  ctx.strokeStyle=lv.col;ctx.lineWidth=2.5;
  ctx.beginPath();ctx.moveTo(ccx,ccy);ctx.lineTo(bx,by);ctx.stroke();
  var ah=cr*0.17,aa=Math.atan2(by-ccy,bx-ccx);
  ctx.fillStyle=lv.col;ctx.beginPath();
  ctx.moveTo(bx,by);
  ctx.lineTo(bx-ah*Math.cos(aa-0.42),by-ah*Math.sin(aa-0.42));
  ctx.lineTo(bx-ah*Math.cos(aa+0.42),by-ah*Math.sin(aa+0.42));
  ctx.closePath();ctx.fill();
  // XY label beside arrow midpoint
  var dxy=Math.sqrt(dxum*dxum+dyum*dyum);
  if(dxy>1){
    var mx=ccx+arrowLen*0.52*Math.sin(bearing)+11*Math.cos(aa+Math.PI/2);
    var my=ccy-arrowLen*0.52*Math.cos(bearing)+11*Math.sin(aa+Math.PI/2);
    ctx.fillStyle=lv.col;ctx.font='bold 9px monospace';ctx.textAlign='center';
    ctx.fillText(Math.round(dxy)+'\u03bcm',mx,my);
  }
  // A dot
  ctx.beginPath();ctx.arc(ccx,ccy,4,0,Math.PI*2);
  ctx.fillStyle='#1a5f9e';ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=1.5;ctx.stroke();
  // B dot
  if(dxy>1){
    ctx.beginPath();ctx.arc(bx,by,4,0,Math.PI*2);
    ctx.fillStyle=lv.col;ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=1.5;ctx.stroke();
  }
  // Z badge — top-right corner of compass box, outside the circle
  if(Math.abs(dzum)>2){
    var zcol=dzum>0?'#EF4444':'#378ADD';
    var zbg=dzum>0?'rgba(254,226,226,0.9)':'rgba(230,241,251,0.9)';
    var zbx=colBx+colBw-14,zby=10;
    ctx.beginPath();ctx.arc(zbx,zby,11,0,Math.PI*2);
    ctx.fillStyle=zbg;ctx.fill();ctx.strokeStyle=zcol;ctx.lineWidth=1;ctx.stroke();
    ctx.fillStyle=zcol;ctx.font='bold 7px monospace';ctx.textAlign='center';
    ctx.fillText(dzum>0?'\u2191':'\u2193',zbx,zby+2.5);
    ctx.font='6px monospace';ctx.fillText(Math.abs(dzum),zbx,zby+11);
  }

  // ── COMPONENT BARS (col C) ────────────────────────────────────────
  var rx=colCx+4, ry=10;
  var valLblW=52; // fixed px for value labels at right edge
  var barX=rx+24, barW2=W-barX-valLblW-4, barH2=8;
  var rowH=22;
  var comps=[['dX',dxum,'#378ADD'],['dY',dyum,'#1D9E75'],['dZ',dzum,'#EF4444']];
  comps.forEach(function(c,ci){
    var cy2=ry+ci*rowH;
    // Row label
    ctx.fillStyle='#6b7280';ctx.font='bold 9px monospace';ctx.textAlign='left';
    ctx.fillText(c[0],rx,cy2+barH2);
    // Bar background
    ctx.fillStyle='#f0f0f0';ctx.fillRect(barX,cy2,barW2,barH2);
    // Center tick
    ctx.strokeStyle='#d1d5db';ctx.lineWidth=0.8;
    ctx.beginPath();ctx.moveTo(barX+barW2/2,cy2);ctx.lineTo(barX+barW2/2,cy2+barH2);ctx.stroke();
    // Value bar
    var vf=Math.min(1,Math.abs(c[1])/Math.max(1,scaleUm));
    var vw2=vf*barW2/2;if(vw2<1)vw2=1;
    var vx=c[1]>=0?barX+barW2/2:barX+barW2/2-vw2;
    ctx.fillStyle=c[2];ctx.fillRect(vx,cy2+1,vw2,barH2-2);
    // Value text — always at fixed right edge of canvas
    ctx.fillStyle=c[2];ctx.font='bold 9px monospace';ctx.textAlign='right';
    ctx.fillText((c[1]>=0?'+':'')+c[1]+'\u03bcm',W-4,cy2+barH2);
  });
  // |D| 3D — below bars with clear spacing
  var d3y=ry+3*rowH+6;
  ctx.fillStyle=lv.col;ctx.font='bold 15px monospace';ctx.textAlign='left';
  ctx.fillText('|D| '+d3um+' \u03bcm',rx,d3y);
  ctx.fillStyle='#9ca3af';ctx.font='9px monospace';
  ctx.fillText('scala 0-'+scaleUm+' \u03bcm',rx,d3y+14);
  // Axis — below |D|, clear separation
  if(axDeg!==null&&axDeg!==undefined){
    var lax=clinAxis(axDeg);
    var axy=d3y+32;
    ctx.strokeStyle=lax.col;ctx.lineWidth=1.5;
    ctx.beginPath();ctx.moveTo(rx,axy);ctx.lineTo(rx+8,axy-5);ctx.stroke();
    ctx.beginPath();ctx.moveTo(rx+3,axy+1);ctx.lineTo(rx+11,axy-4);ctx.stroke();
    ctx.fillStyle=lax.col;ctx.font='bold 10px monospace';ctx.textAlign='left';
    ctx.fillText('Asse '+axDeg.toFixed(2)+'\u00b0  \u2014  '+lax.label,rx+14,axy);
  }
}

// ── Colorimetric map — PCA best-fit plane ────────────────────────────────────
function drawColorMap(cv,pairs){
  if(!cv||!pairs||!pairs.length)return;
  var ctx=cv.getContext('2d'),W=cv.width,H=cv.height;
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle='#f9fafb';ctx.fillRect(0,0,W,H);
  ctx.fillStyle='#ffffff';ctx.fillRect(2,2,W-4,H-4);
  ctx.strokeStyle='#e5e7eb';ctx.lineWidth=1;ctx.strokeRect(2,2,W-4,H-4);

  var padL=52,padR=40,padT=36,padB=60;
  var vw=W-padL-padR,vh=H-padT-padB;

  // ── PCA: best-fit plane ────────────────────────────────────────────
  var n=pairs.length;
  var cmx=0,cmy=0,cmz=0;
  pairs.forEach(function(pp){cmx+=pp.a[0]/n;cmy+=pp.a[1]/n;cmz+=pp.a[2]/n;});
  var cov=[[0,0,0],[0,0,0],[0,0,0]];
  pairs.forEach(function(pp){
    var d=[pp.a[0]-cmx,pp.a[1]-cmy,pp.a[2]-cmz];
    for(var i=0;i<3;i++)for(var j=0;j<3;j++)cov[i][j]+=d[i]*d[j]/n;
  });
  var eig=jacobi3(cov);
  var ord=[0,1,2].sort(function(a,b){return eig.vals[b]-eig.vals[a];});
  var u1=[eig.vecs[0][ord[0]],eig.vecs[1][ord[0]],eig.vecs[2][ord[0]]];
  var u2=[eig.vecs[0][ord[1]],eig.vecs[1][ord[1]],eig.vecs[2][ord[1]]];
  var u3=[eig.vecs[0][ord[2]],eig.vecs[1][ord[2]],eig.vecs[2][ord[2]]];

  function pcaProj(x,y,z){
    var dx=x-cmx,dy=y-cmy,dz=z-cmz;
    return[dx*u1[0]+dy*u1[1]+dz*u1[2],dx*u2[0]+dy*u2[1]+dz*u2[2]];
  }

  // Screen bounds from all A+B positions
  var allP2=[];
  pairs.forEach(function(pp){
    allP2.push(pcaProj(pp.a[0],pp.a[1],pp.a[2]));
    if(pp.b)allP2.push(pcaProj(pp.b[0],pp.b[1],pp.b[2]));
  });
  var p1s=allP2.map(function(p){return p[0];}),p2s=allP2.map(function(p){return p[1];});
  var mn1=Math.min.apply(null,p1s),mx1=Math.max.apply(null,p1s);
  var mn2=Math.min.apply(null,p2s),mx2=Math.max.apply(null,p2s);
  var rg=Math.max(mx1-mn1,mx2-mn2)||10,margin=rg*0.22;
  var scl=Math.min(vw/(rg+margin*2),vh/(rg+margin*2));
  var c1=(mn1+mx1)/2,c2=(mn2+mx2)/2;
  function sc(p1,p2){
    return[padL+(p1-(c1-rg/2-margin))*scl, padT+vh-(p2-(c2-rg/2-margin))*scl];
  }

  // ── Grid (mm) ────────────────────────────────────────────────────
  var gs=5;
  ctx.strokeStyle='rgba(220,228,235,0.55)';ctx.lineWidth=0.5;ctx.setLineDash([3,4]);
  for(var g1=Math.floor((mn1-margin)/gs)*gs;g1<=(mx1+margin);g1+=gs){
    var gpx=sc(g1,0)[0];if(gpx<padL-1||gpx>padL+vw+1)continue;
    ctx.beginPath();ctx.moveTo(gpx,padT);ctx.lineTo(gpx,padT+vh);ctx.stroke();
    ctx.fillStyle='rgba(150,160,170,0.55)';ctx.font='7px monospace';ctx.textAlign='center';
    ctx.fillText(g1.toFixed(0),gpx,padT+vh+12);
  }
  for(var g2=Math.floor((mn2-margin)/gs)*gs;g2<=(mx2+margin);g2+=gs){
    var gpy=sc(0,g2)[1];if(gpy<padT-1||gpy>padT+vh+1)continue;
    ctx.beginPath();ctx.moveTo(padL,gpy);ctx.lineTo(padL+vw,gpy);ctx.stroke();
    ctx.fillStyle='rgba(150,160,170,0.55)';ctx.font='7px monospace';ctx.textAlign='right';
    ctx.fillText(g2.toFixed(0),padL-4,gpy+3);
  }
  ctx.setLineDash([]);

  // ── Axis labels ───────────────────────────────────────────────────
  ctx.fillStyle='#9ca3af';ctx.font='8px monospace';ctx.textAlign='center';
  ctx.fillText('asse arcata (mm)',padL+vw/2,padT+vh+24);
  ctx.save();ctx.translate(14,padT+vh/2);ctx.rotate(-Math.PI/2);
  ctx.fillText('trasversale (mm)',0,0);ctx.restore();

  // ── Arch curve ────────────────────────────────────────────────────
  var archS=pairs.slice().sort(function(a,b){
    var pa=pcaProj(a.a[0],a.a[1],a.a[2]),pb=pcaProj(b.a[0],b.a[1],b.a[2]);
    return pa[0]-pb[0];
  });
  var ap=archS.map(function(pp){var p=pcaProj(pp.a[0],pp.a[1],pp.a[2]);return sc(p[0],p[1]);});
  if(ap.length>=2){
    ctx.lineCap='round';ctx.lineJoin='round';
    [20,12,5].forEach(function(lw,li){
      ctx.beginPath();ap.forEach(function(pt,i){if(i===0)ctx.moveTo(pt[0],pt[1]);else ctx.lineTo(pt[0],pt[1]);});
      ctx.strokeStyle='rgba(180,200,215,'+(0.10+li*0.06)+')';ctx.lineWidth=lw;ctx.stroke();
    });
  }

  // ── Heatmap (capped size) ─────────────────────────────────────────
  pairs.forEach(function(pp){
    if(!pp.b)return;
    var d3um=Math.round(pp.d3*1000),lv=clinLevel(d3um);
    var pb=pcaProj(pp.b[0],pp.b[1],pp.b[2]),spb=sc(pb[0],pb[1]);
    var hr=Math.min(32,Math.max(16,d3um/20+16)); // capped: max 32px
    var g=ctx.createRadialGradient(spb[0],spb[1],0,spb[0],spb[1],hr);
    g.addColorStop(0,lv.col+'44');g.addColorStop(0.6,lv.col+'18');g.addColorStop(1,'transparent');
    ctx.fillStyle=g;ctx.beginPath();ctx.arc(spb[0],spb[1],hr,0,Math.PI*2);ctx.fill();
  });

  // ── Deviation vectors ─────────────────────────────────────────────
  pairs.forEach(function(pp){
    if(!pp.b)return;
    var d3um=Math.round(pp.d3*1000),lv=clinLevel(d3um);
    var pa=pcaProj(pp.a[0],pp.a[1],pp.a[2]),spa=sc(pa[0],pa[1]);
    var pb=pcaProj(pp.b[0],pp.b[1],pp.b[2]),spb=sc(pb[0],pb[1]);
    var dx=spb[0]-spa[0],dy=spb[1]-spa[1],dist=Math.sqrt(dx*dx+dy*dy);
    if(dist<2)return; // skip if A and B are essentially same pixel
    ctx.beginPath();ctx.moveTo(spa[0],spa[1]);ctx.lineTo(spb[0],spb[1]);
    ctx.strokeStyle=lv.col+'cc';ctx.lineWidth=2;ctx.stroke();
    var ang=Math.atan2(dy,dx),ah=7;
    ctx.fillStyle=lv.col;ctx.beginPath();
    ctx.moveTo(spb[0],spb[1]);
    ctx.lineTo(spb[0]-ah*Math.cos(ang-0.4),spb[1]-ah*Math.sin(ang-0.4));
    ctx.lineTo(spb[0]-ah*Math.cos(ang+0.4),spb[1]-ah*Math.sin(ang+0.4));
    ctx.closePath();ctx.fill();
  });

  // ── A positions ───────────────────────────────────────────────────
  pairs.forEach(function(pp,i){
    var pa=pcaProj(pp.a[0],pp.a[1],pp.a[2]),spa=sc(pa[0],pa[1]);
    ctx.beginPath();ctx.arc(spa[0],spa[1],12,0,Math.PI*2);
    ctx.strokeStyle='rgba(26,95,158,0.22)';ctx.lineWidth=3;ctx.stroke();
    ctx.beginPath();ctx.arc(spa[0],spa[1],7,0,Math.PI*2);
    ctx.fillStyle='rgba(26,95,158,0.07)';ctx.fill();
    ctx.strokeStyle='#1a5f9e';ctx.lineWidth=1.5;ctx.stroke();
    ctx.fillStyle='#1a5f9e';ctx.font='bold 8px monospace';
    ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText(''+(i+1),spa[0],spa[1]);ctx.textBaseline='alphabetic';
  });

  // ── B positions + labels ──────────────────────────────────────────
  pairs.forEach(function(pp,i){
    if(!pp.b)return;
    var d3um=Math.round(pp.d3*1000),lv=clinLevel(d3um);
    var pb=pcaProj(pp.b[0],pp.b[1],pp.b[2]),spb=sc(pb[0],pb[1]);
    // Outer glow
    ctx.beginPath();ctx.arc(spb[0],spb[1],10,0,Math.PI*2);
    ctx.fillStyle=lv.col+'28';ctx.fill();
    // Main dot
    ctx.beginPath();ctx.arc(spb[0],spb[1],6,0,Math.PI*2);
    ctx.fillStyle=lv.col;ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();
    // Number
    ctx.fillStyle='#fff';ctx.font='bold 8px monospace';
    ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText(''+(i+1),spb[0],spb[1]);ctx.textBaseline='alphabetic';
    // Deviation label — offset to avoid overlapping with dot
    ctx.fillStyle=lv.col;ctx.font='bold 9px monospace';ctx.textAlign='center';
    ctx.fillText(d3um+'μm',spb[0],spb[1]-16);
  });

  // ── Scale bar ─────────────────────────────────────────────────────
  var sbLen=10*scl,sbX=padL+vw-sbLen-4,sbY=padT+vh+36;
  ctx.strokeStyle='#374151';ctx.lineWidth=2;ctx.lineCap='square';
  ctx.beginPath();ctx.moveTo(sbX,sbY);ctx.lineTo(sbX+sbLen,sbY);ctx.stroke();
  ctx.beginPath();ctx.moveTo(sbX,sbY-3);ctx.lineTo(sbX,sbY+3);ctx.stroke();
  ctx.beginPath();ctx.moveTo(sbX+sbLen,sbY-3);ctx.lineTo(sbX+sbLen,sbY+3);ctx.stroke();
  ctx.fillStyle='#374151';ctx.font='8px monospace';ctx.textAlign='center';
  ctx.fillText('10 mm',sbX+sbLen/2,sbY+11);

  // ── Color scale bar (right) ───────────────────────────────────────
  var csX=padL+vw+8,csH=vh,csW=10;
  var cg=ctx.createLinearGradient(0,padT,0,padT+csH);
  cg.addColorStop(0,'#A855F7');cg.addColorStop(0.3,'#EF4444');
  cg.addColorStop(0.5,'#F97316');cg.addColorStop(0.7,'#D97706');
  cg.addColorStop(1,'#639922');
  ctx.fillStyle=cg;ctx.fillRect(csX,padT,csW,csH);
  ctx.strokeStyle='#e5e7eb';ctx.lineWidth=0.5;ctx.strokeRect(csX,padT,csW,csH);
  [[0,'0'],[50,'50'],[100,'100'],[150,'150'],[250,'250'],[500,'500']].forEach(function(t){
    var ty=padT+csH-(t[0]/500)*csH;
    ctx.strokeStyle='#fff';ctx.lineWidth=0.8;ctx.beginPath();ctx.moveTo(csX,ty);ctx.lineTo(csX+csW,ty);ctx.stroke();
    ctx.fillStyle='#6b7280';ctx.font='7px monospace';ctx.textAlign='left';
    ctx.fillText(t[1],csX+csW+3,ty+3);
  });
  ctx.fillStyle='#9ca3af';ctx.font='7px monospace';ctx.textAlign='center';
  ctx.fillText('μm',csX+csW/2,padT+csH+10);

  // ── Legend (clean, separate line, no overlap) ─────────────────────
  var lgY=padT+vh+46;
  // A symbol
  ctx.beginPath();ctx.arc(padL+6,lgY,5,0,Math.PI*2);
  ctx.strokeStyle='#1a5f9e';ctx.lineWidth=1.5;ctx.fillStyle='rgba(26,95,158,0.08)';ctx.fill();ctx.stroke();
  ctx.fillStyle='#374151';ctx.font='8px monospace';ctx.textAlign='left';
  ctx.fillText('A = riferimento',padL+14,lgY+3);
  // B symbol
  ctx.beginPath();ctx.arc(padL+115,lgY,5,0,Math.PI*2);
  ctx.fillStyle='#EF4444';ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=1.5;ctx.stroke();
  ctx.fillStyle='#374151';ctx.fillText('B = misurato (ICP)',padL+123,lgY+3);
  // Plane info (right side, small, gray)
  var planeAngle=Math.acos(Math.min(1,Math.abs(u3[2])))*180/Math.PI;
  ctx.fillStyle='#9ca3af';ctx.font='7px monospace';ctx.textAlign='right';
  ctx.fillText('Piano best-fit ⊥ Z: '+planeAngle.toFixed(1)+'°',padL+vw,lgY+3);
}

// ── Global preview canvas ──────────────────────────────────────────────────
function paintView(cv,triA,triB,trisBg,ax1,ax2,axD,title){
  if(!cv)return;
  var ctx=cv.getContext('2d'),W=cv.width,H=cv.height,pd=4,th=14;
  var vw=W-pd*2,vh=H-pd*2-th;
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle='#f8f9fa';ctx.fillRect(0,0,W,H);
  ctx.fillStyle='#fff';ctx.fillRect(pd,pd,vw,vh);
  ctx.strokeStyle='#dee2e6';ctx.lineWidth=1;ctx.strokeRect(pd,pd,vw,vh);
  var allT=(triA||[]).concat(triB||[]).concat(trisBg||[]);
  if(!allT.length){
    ctx.fillStyle='rgba(31,41,55,0.7)';ctx.fillRect(pd,pd+vh,vw,th);
    ctx.fillStyle='#fff';ctx.font='bold 9px monospace';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText(title,W/2,pd+vh+th/2);return;
  }
  var mn1=Infinity,mx1=-Infinity,mn2=Infinity,mx2=-Infinity;
  allT.forEach(function(t){t.forEach(function(v){if(v[ax1]<mn1)mn1=v[ax1];if(v[ax1]>mx1)mx1=v[ax1];if(v[ax2]<mn2)mn2=v[ax2];if(v[ax2]>mx2)mx2=v[ax2];});});
  var rg=Math.max(mx1-mn1,mx2-mn2)||1,c1=(mn1+mx1)/2,c2=(mn2+mx2)/2,mg=rg*0.08;
  function px(v){return[pd+((v[ax1]-(c1-rg/2-mg))/(rg+mg*2))*vw,pd+vh-((v[ax2]-(c2-rg/2-mg))/(rg+mg*2))*vh];}
  function drawTris(tris,fill,stroke,max){
    if(!tris||!tris.length)return;
    var step=Math.max(1,Math.ceil(tris.length/max));
    var items=[];for(var i=0;i<tris.length;i+=step){var t=tris[i];items.push({t:t,d:(t[0][axD]+t[1][axD]+t[2][axD])/3});}
    items.sort(function(a,b){return a.d-b.d;});
    ctx.save();ctx.fillStyle=fill;ctx.strokeStyle=stroke;ctx.lineWidth=0.3;
    items.forEach(function(item){var t=item.t,p0=px(t[0]),p1=px(t[1]),p2=px(t[2]);ctx.beginPath();ctx.moveTo(p0[0],p0[1]);ctx.lineTo(p1[0],p1[1]);ctx.lineTo(p2[0],p2[1]);ctx.closePath();ctx.fill();ctx.stroke();});
    ctx.restore();
  }
  drawTris(trisBg,'rgba(180,185,195,0.22)','rgba(160,165,175,0.18)',6000);
  drawTris(triA,'rgba(26,95,158,0.5)','rgba(14,61,102,0.6)',10000);
  drawTris(triB,'rgba(186,117,23,0.5)','rgba(133,79,11,0.6)',10000);
  ctx.fillStyle='rgba(31,41,55,0.7)';ctx.fillRect(pd,pd+vh,vw,th);
  ctx.fillStyle='#fff';ctx.font='bold 9px monospace';ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillText(title,W/2,pd+vh+th/2);ctx.textBaseline='alphabetic';
}

// ── STL parsing + analysis ─────────────────────────────────────────────────
function pBin(dv,n){var t=[],o=84;for(var i=0;i<n;i++){t.push([[dv.getFloat32(o+12,1),dv.getFloat32(o+16,1),dv.getFloat32(o+20,1)],[dv.getFloat32(o+24,1),dv.getFloat32(o+28,1),dv.getFloat32(o+32,1)],[dv.getFloat32(o+36,1),dv.getFloat32(o+40,1),dv.getFloat32(o+44,1)]]);o+=50;}return t;}
function pAsc(s){var t=[],re=/vertex\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)/g,m,v=[];while((m=re.exec(s))!==null){v.push([+m[1],+m[2],+m[3]]);if(v.length===3){t.push(v.slice());v=[];}}return t;}
function pSTL(b){var dv=new DataView(b),n=dv.getUint32(80,true);return(84+n*50===b.byteLength&&n>0)?pBin(dv,n):pAsc(new TextDecoder().decode(new Uint8Array(b)));}
function comps(T){var vm={},p=T.map(function(_,i){return i;});T.forEach(function(t,i){t.forEach(function(v){var k=v[0].toFixed(3)+','+v[1].toFixed(3)+','+v[2].toFixed(3);if(!vm[k])vm[k]=[];vm[k].push(i);});});function find(x){return p[x]===x?x:(p[x]=find(p[x]));}Object.keys(vm).forEach(function(k){var ts=vm[k];for(var i=1;i<ts.length;i++){var ra=find(ts[0]),rb=find(ts[i]);if(ra!==rb)p[ra]=rb;}});var g={};T.forEach(function(_,i){var r=find(i);if(!g[r])g[r]=[];g[r].push(i);});return Object.keys(g).map(function(k){return g[k];}).filter(function(c){return c.length>=4;});}
function cen(T,idx){var x=0,y=0,z=0,n=0;idx.forEach(function(i){T[i].forEach(function(v){x+=v[0];y+=v[1];z+=v[2];n++;});});return[x/n,y/n,z/n];}
function gcen(T){var x=0,y=0,z=0,n=0;T.forEach(function(t){t.forEach(function(v){x+=v[0];y+=v[1];z+=v[2];n++;});});return[x/n,y/n,z/n];}
function mPairs(A,B){var used={};return A.map(function(a){var bi=-1,bd=Infinity;B.forEach(function(b,i){if(used[i])return;var d=Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);if(d<bd){bd=d;bi=i;}});if(bi>=0)used[bi]=1;var b=bi>=0?B[bi]:null;if(!b)return{a:a,b:null,dx:null,dy:null,dz:null,dxy:null,d3:null};var dx=b[0]-a[0],dy=b[1]-a[1],dz=b[2]-a[2];return{a:a,b:b,dx:dx,dy:dy,dz:dz,dxy:Math.hypot(dx,dy),d3:Math.hypot(dx,dy,dz)};});}
function rbuf(f){return new Promise(function(res,rej){var r=new FileReader();r.onload=function(e){res(e.target.result);};r.onerror=rej;r.readAsArrayBuffer(f);});}
// 3x3 math
function eye3(){return[[1,0,0],[0,1,0],[0,0,1]];}
function mul3(A,B){var C=[[0,0,0],[0,0,0],[0,0,0]];for(var i=0;i<3;i++)for(var j=0;j<3;j++)for(var k=0;k<3;k++)C[i][j]+=A[i][k]*B[k][j];return C;}
function tr3(A){return[[A[0][0],A[1][0],A[2][0]],[A[0][1],A[1][1],A[2][1]],[A[0][2],A[1][2],A[2][2]]];}
function det3(A){return A[0][0]*(A[1][1]*A[2][2]-A[1][2]*A[2][1])-A[0][1]*(A[1][0]*A[2][2]-A[1][2]*A[2][0])+A[0][2]*(A[1][0]*A[2][1]-A[1][1]*A[2][0]);}
function mv3(M,v){return[M[0][0]*v[0]+M[0][1]*v[1]+M[0][2]*v[2],M[1][0]*v[0]+M[1][1]*v[1]+M[1][2]*v[2],M[2][0]*v[0]+M[2][1]*v[1]+M[2][2]*v[2]];}
function jacobi3(A){var a=[[A[0][0],A[0][1],A[0][2]],[A[1][0],A[1][1],A[1][2]],[A[2][0],A[2][1],A[2][2]]];var V=eye3();for(var it=0;it<200;it++){var p=0,q=1,mx=Math.abs(a[0][1]);if(Math.abs(a[0][2])>mx){p=0;q=2;mx=Math.abs(a[0][2]);}if(Math.abs(a[1][2])>mx){p=1;q=2;}if(Math.abs(a[p][q])<1e-14)break;var th=(a[q][q]-a[p][p])/(2*a[p][q]),t=(th>=0?1:-1)/(Math.abs(th)+Math.sqrt(th*th+1)),c=1/Math.sqrt(t*t+1),s=t*c,apq=a[p][q];a[p][p]-=t*apq;a[q][q]+=t*apq;a[p][q]=0;a[q][p]=0;for(var r=0;r<3;r++){if(r!==p&&r!==q){var ar=a[p][r],br=a[q][r];a[p][r]=c*ar-s*br;a[r][p]=a[p][r];a[q][r]=s*ar+c*br;a[r][q]=a[q][r];}}for(var r=0;r<3;r++){var vp=V[r][p],vq=V[r][q];V[r][p]=c*vp-s*vq;V[r][q]=s*vp+c*vq;}}return{vals:[a[0][0],a[1][1],a[2][2]],vecs:V};}
function svd3(M){var MtM=mul3(tr3(M),M),ej=jacobi3(MtM);var ord=[0,1,2].sort(function(a,b){return ej.vals[b]-ej.vals[a];});var Vc=ord.map(function(oi){return[ej.vecs[0][oi],ej.vecs[1][oi],ej.vecs[2][oi]];});var Vm=[[Vc[0][0],Vc[1][0],Vc[2][0]],[Vc[0][1],Vc[1][1],Vc[2][1]],[Vc[0][2],Vc[1][2],Vc[2][2]]];var MV=mul3(M,Vm),Um=[[0,0,0],[0,0,0],[0,0,0]];for(var j=0;j<3;j++){var col=[MV[0][j],MV[1][j],MV[2][j]],nm=Math.sqrt(col[0]*col[0]+col[1]*col[1]+col[2]*col[2]);if(nm>1e-10){Um[0][j]=col[0]/nm;Um[1][j]=col[1]/nm;Um[2][j]=col[2]/nm;}}return{U:Um,V:Vm};}
function kabsch(A,B){var n=A.length,cA=[0,0,0],cB=[0,0,0];for(var i=0;i<n;i++){cA[0]+=A[i][0];cA[1]+=A[i][1];cA[2]+=A[i][2];cB[0]+=B[i][0];cB[1]+=B[i][1];cB[2]+=B[i][2];}cA=cA.map(function(v){return v/n;});cB=cB.map(function(v){return v/n;});var Ac=A.map(function(p){return[p[0]-cA[0],p[1]-cA[1],p[2]-cA[2]];});var Bc=B.map(function(p){return[p[0]-cB[0],p[1]-cB[1],p[2]-cB[2]];});var HH=[[0,0,0],[0,0,0],[0,0,0]];for(var i=0;i<n;i++)for(var r=0;r<3;r++)for(var cc=0;cc<3;cc++)HH[r][cc]+=Ac[i][r]*Bc[i][cc];var sv=svd3(HH),R=mul3(sv.V,tr3(sv.U));if(det3(R)<0){var Vc2=sv.V.map(function(r){return r.slice();});for(var r=0;r<3;r++)Vc2[r][2]*=-1;R=mul3(Vc2,tr3(sv.U));}var RcA=mv3(R,cA),t=[cB[0]-RcA[0],cB[1]-RcA[1],cB[2]-RcA[2]];return{R:R,t:t};}
function runICP(fixed,moving,maxIter){maxIter=maxIter||60;var Bt=moving.map(function(p){return p.slice();}),Racc=eye3(),tacc=[0,0,0],prev=Infinity;for(var it=0;it<maxIter;it++){var idx=Bt.map(function(b){var mi=-1,md=Infinity;fixed.forEach(function(a,i){var d=Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);if(d<md){md=d;mi=i;}});return mi;});var mF=idx.map(function(i){return fixed[i];});var kb=kabsch(Bt,mF);Bt=Bt.map(function(p){var rp=mv3(kb.R,p);return[rp[0]+kb.t[0],rp[1]+kb.t[1],rp[2]+kb.t[2]];});Racc=mul3(kb.R,Racc);var Rt=mv3(kb.R,tacc);tacc=[Rt[0]+kb.t[0],Rt[1]+kb.t[1],Rt[2]+kb.t[2]];var rmsd=0;Bt.forEach(function(b,i){var f=mF[i];rmsd+=(b[0]-f[0])*(b[0]-f[0])+(b[1]-f[1])*(b[1]-f[1])+(b[2]-f[2])*(b[2]-f[2]);});rmsd=Math.sqrt(rmsd/Bt.length);if(Math.abs(prev-rmsd)<1e-9)break;prev=rmsd;}var trace=Racc[0][0]+Racc[1][1]+Racc[2][2];return{R:Racc,t:tacc,aligned:Bt,rmsd:prev,angle:Math.acos(Math.min(1,Math.max(-1,(trace-1)/2)))*180/Math.PI};}
function applyTform(tris,R,t){return tris.map(function(tri){return tri.map(function(v){var rv=mv3(R,v);return[rv[0]+t[0],rv[1]+t[1],rv[2]+t[2]];});});}
// ── Distance-signature pre-alignment (rotation+translation invariant) ─────
// Computes sorted inter-point distances for each centroid → invariant to rigid motion
function distSig(pts, i){
  var d=[];
  for(var j=0;j<pts.length;j++){
    if(j===i)continue;
    d.push(Math.hypot(pts[i][0]-pts[j][0],pts[i][1]-pts[j][1],pts[i][2]-pts[j][2]));
  }
  return d.sort(function(a,b){return a-b;});
}
function sigDiff(sa,sb){
  var s=0;
  for(var k=0;k<Math.min(sa.length,sb.length);k++) s+=(sa[k]-sb[k])*(sa[k]-sb[k]);
  return s/(Math.min(sa.length,sb.length)||1);
}

// Kabsch that maps moving→fixed space: R*moving+t ≈ fixed
function kabschBtoA(fixed,moving){
  var n=fixed.length;
  var cF=[0,0,0],cM=[0,0,0];
  for(var i=0;i<n;i++){cF[0]+=fixed[i][0]/n;cF[1]+=fixed[i][1]/n;cF[2]+=fixed[i][2]/n;cM[0]+=moving[i][0]/n;cM[1]+=moving[i][1]/n;cM[2]+=moving[i][2]/n;}
  var Mc=moving.map(function(p){return[p[0]-cM[0],p[1]-cM[1],p[2]-cM[2]];});
  var Fc=fixed.map(function(p){return[p[0]-cF[0],p[1]-cF[1],p[2]-cF[2]];});
  // H = Mc^T * Fc
  var H=[[0,0,0],[0,0,0],[0,0,0]];
  for(var i=0;i<n;i++)for(var r=0;r<3;r++)for(var c=0;c<3;c++)H[r][c]+=Mc[i][r]*Fc[i][c];
  var sv=svd3(H),R=mul3(sv.V,tr3(sv.U));
  if(det3(R)<0){var V2=sv.V.map(function(r){return r.slice();});for(var r=0;r<3;r++)V2[r][2]*=-1;R=mul3(V2,tr3(sv.U));}
  var RcM=mv3(R,cM);
  var t=[cF[0]-RcM[0],cF[1]-RcM[1],cF[2]-RcM[2]];
  return{R:R,t:t};
}

// Robust pre-alignment: match centroids by distance signature, then Kabsch
// Returns B centroids pre-aligned into A space
function robustPreAlign(ctA,ctB){
  var nA=ctA.length,nB=ctB.length;
  var sigA=ctA.map(function(_,i){return distSig(ctA,i);});
  var sigB=ctB.map(function(_,i){return distSig(ctB,i);});
  // For each A point find best matching B point
  var corrAB=ctA.map(function(_,i){
    return sigB.reduce(function(bestJ,sb,j){
      return sigDiff(sigA[i],sb)<sigDiff(sigA[i],sigB[bestJ])?j:bestJ;
    },0);
  });
  // Check if mapping is 1-to-1 (no duplicates)
  var used={};
  var valid=corrAB.every(function(j){
    if(used[j])return false;
    used[j]=true;return true;
  });
  if(!valid){
    // Fall back to simple centroid translation if matching is ambiguous
    var gcA=[0,0,0],gcB=[0,0,0];
    ctA.forEach(function(p){gcA[0]+=p[0]/nA;gcA[1]+=p[1]/nA;gcA[2]+=p[2]/nA;});
    ctB.forEach(function(p){gcB[0]+=p[0]/nB;gcB[1]+=p[1]/nB;gcB[2]+=p[2]/nB;});
    var off=[gcA[0]-gcB[0],gcA[1]-gcB[1],gcA[2]-gcB[2]];
    return{aligned:ctB.map(function(b){return[b[0]+off[0],b[1]+off[1],b[2]+off[2]];}),corrAB:ctB.map(function(_,i){return i;}),method:'centroid'};
  }
  // Build matched arrays
  var Amatched=ctA;
  var Bmatched=corrAB.map(function(j){return ctB[j];});
  // Kabsch B→A
  var kb=kabschBtoA(Amatched,Bmatched);
  // Apply transform to ALL B centroids
  var aligned=ctB.map(function(b){var rb=mv3(kb.R,b);return[rb[0]+kb.t[0],rb[1]+kb.t[1],rb[2]+kb.t[2]];});
  return{aligned:aligned,corrAB:corrAB,R:kb.R,t:kb.t,method:'signature'};
}

// ── Cylinder axis via face-normal method ──────────────────────────────────
// Strategy: find the two flat circular faces, fit a plane to each,
// use the average normal as the cylinder axis.
// This is ~100× more precise than PCA on the full volume.
function cylAxis(tris){
  if(!tris||tris.length<3)return[0,0,1];
  // Collect all vertices
  var pts=[];
  tris.forEach(function(t){t.forEach(function(v){pts.push(v);});});
  var n=pts.length;
  if(n<9)return[0,0,1];
  // Step 1: centroid
  var cx=0,cy=0,cz=0;
  pts.forEach(function(v){cx+=v[0]/n;cy+=v[1]/n;cz+=v[2]/n;});
  var ptsc=pts.map(function(v){return[v[0]-cx,v[1]-cy,v[2]-cz];});
  // Step 2: PCA to find approximate axis (used only to project points)
  var cov=[[0,0,0],[0,0,0],[0,0,0]];
  ptsc.forEach(function(v){for(var i=0;i<3;i++)for(var j=0;j<3;j++)cov[i][j]+=v[i]*v[j]/n;});
  var eig=jacobi3(cov);
  var ord=[0,1,2].sort(function(a,b){return eig.vals[b]-eig.vals[a];});
  var ev0=eig.vals[ord[0]],ev1=eig.vals[ord[1]];
  var axIdx=(ev0>0&&ev1/ev0>0.6)?ord[2]:ord[0];
  var axPCA=[eig.vecs[0][axIdx],eig.vecs[1][axIdx],eig.vecs[2][axIdx]];
  // Step 3: project all points onto PCA axis, find two extreme caps
  var proj=ptsc.map(function(v){return v[0]*axPCA[0]+v[1]*axPCA[1]+v[2]*axPCA[2];});
  var pmin=proj.reduce(function(a,b){return a<b?a:b;});
  var pmax=proj.reduce(function(a,b){return a>b?a:b;});
  var H=pmax-pmin, thresh=H*0.18;
  var capTop=[],capBot=[];
  ptsc.forEach(function(v,i){
    if(proj[i]>pmax-thresh)capTop.push(v);
    else if(proj[i]<pmin+thresh)capBot.push(v);
  });
  // Step 4: fit plane to each cap via PCA (min variance = normal)
  function capNormal(cap){
    if(cap.length<6)return null;
    var cc=[0,0,0];
    cap.forEach(function(v){cc[0]+=v[0]/cap.length;cc[1]+=v[1]/cap.length;cc[2]+=v[2]/cap.length;});
    var cv=[[0,0,0],[0,0,0],[0,0,0]];
    cap.forEach(function(v){
      var d=[v[0]-cc[0],v[1]-cc[1],v[2]-cc[2]];
      for(var i=0;i<3;i++)for(var j=0;j<3;j++)cv[i][j]+=d[i]*d[j]/cap.length;
    });
    var eg=jacobi3(cv);
    var od=[0,1,2].sort(function(a,b){return eg.vals[b]-eg.vals[a];});
    // Normal = min variance direction of a flat plane
    var ni=[eg.vecs[0][od[2]],eg.vecs[1][od[2]],eg.vecs[2][od[2]]];
    return ni;
  }
  var nTop=capNormal(capTop);
  var nBot=capNormal(capBot);
  if(!nTop&&!nBot)return axPCA; // fallback
  if(!nTop)nTop=nBot;
  if(!nBot)nBot=nTop;
  // Ensure both normals point in same hemisphere as PCA axis
  if(nTop[0]*axPCA[0]+nTop[1]*axPCA[1]+nTop[2]*axPCA[2]<0){nTop=[-nTop[0],-nTop[1],-nTop[2]];}
  if(nBot[0]*axPCA[0]+nBot[1]*axPCA[1]+nBot[2]*axPCA[2]<0){nBot=[-nBot[0],-nBot[1],-nBot[2]];}
  // Average the two face normals for best estimate
  var ax=[nTop[0]+nBot[0],nTop[1]+nBot[1],nTop[2]+nBot[2]];
  var len=Math.sqrt(ax[0]*ax[0]+ax[1]*ax[1]+ax[2]*ax[2])||1;
  return[ax[0]/len,ax[1]/len,ax[2]/len];
}

// Angle between two axes (0-90°, direction-agnostic)
function axisAngleDeg(a,b){
  var dot=Math.abs(a[0]*b[0]+a[1]*b[1]+a[2]*b[2]);
  return Math.acos(Math.min(1,dot))*180/Math.PI;
}

// Clinical level for axis deviation (degrees)
// Axis deviation thresholds (face-normal method, precision ±0.05°)
var CLIN_AX=[
  {max:0.5, label:'Ottimo',          bg:'#EAF3DE',fg:'#3B6D11',col:'#639922'},
  {max:1.5, label:'Accettabile',     bg:'#FEFCE8',fg:'#854D0E',col:'#D97706'},
  {max:3.0, label:'Rischioso',       bg:'#FFF3E0',fg:'#9A3412',col:'#F97316'},
  {max:6.0, label:'Tensione',        bg:'#FEE2E2',fg:'#991B1B',col:'#EF4444'},
  {max:9999,label:'Fuori posizione', bg:'#F3E0F7',fg:'#6B21A8',col:'#A855F7'}
];
function clinAxis(deg){for(var i=0;i<CLIN_AX.length;i++)if(deg<CLIN_AX[i].max)return CLIN_AX[i];return CLIN_AX[4];}

// ── Multi-brand scanbody signature library ────────────────────────────────
var SCANBODY_PROFILES = [
  {
    name: 'ScanLogiQ',
    color: '#1D9E75',
    parts: [
      {name:'anello', min:450,  max:650,  role:'ring'},
      {name:'corpo',  min:1250, max:1550, role:'body'}
    ]
  },
  {
    name: 'IPD ProCam',
    color: '#378ADD',
    parts: [
      {name:'disco',  min:2128, max:3547, role:'ring'},
      {name:'corpo',  min:3240, max:5400, role:'body'}
    ]
  },
  {
    name: 'Shining',
    color: '#EF9F27',
    parts: [
      {name:'disco',  min:3200, max:4700,  role:'ring'},
      {name:'corpo',  min:20000,max:30000, role:'body'}
    ]
  }
];

// Check if a triangle count matches any scanbody sub-part across all profiles
function isScanSub(count){
  return SCANBODY_PROFILES.some(function(prof){
    return prof.parts.some(function(p){return count>=p.min&&count<=p.max;});
  });
}

// Detect which profile a component belongs to
function detectProfile(count){
  for(var pi=0;pi<SCANBODY_PROFILES.length;pi++){
    var prof=SCANBODY_PROFILES[pi];
    for(var ki=0;ki<prof.parts.length;ki++){
      if(count>=prof.parts[ki].min&&count<=prof.parts[ki].max)
        return{profile:prof,part:prof.parts[ki]};
    }
  }
  return null;
}

// Detect which profile is dominant in a set of components
function dominantProfile(comps){
  var votes={};
  comps.forEach(function(c){
    var d=detectProfile(c.length);
    if(d){var k=d.profile.name;votes[k]=(votes[k]||0)+1;}
  });
  var best=null,bestV=0;
  Object.keys(votes).forEach(function(k){if(votes[k]>bestV){bestV=votes[k];best=k;}});
  if(!best)return null;
  return SCANBODY_PROFILES.filter(function(p){return p.name===best;})[0]||null;
}

// Detect which brand a set of component triangle counts belongs to
function detectBrand(counts){
  for(var bi=0;bi<SCANBODY_PROFILES.length;bi++){
    var prof=SCANBODY_PROFILES[bi];
    var allMatch=prof.parts.every(function(sig){
      return counts.some(function(cnt){return cnt>=sig.min&&cnt<=sig.max;});
    });
    if(allMatch)return prof;
  }
  return{name:'Generico',color:'#6b7280',parts:[]};
}

function partitionComps(cs){
  var scan=[],bg=[];
  cs.forEach(function(c,i){if(isScanSub(c.length))scan.push(i);else bg.push(i);});
  return{scan:scan,bg:bg};
}
// Clustering
function autoThresh(cents){if(cents.length<=1)return 999;var nn=cents.map(function(c,i){var md=Infinity;cents.forEach(function(d,j){if(i===j)return;var dist=Math.hypot(c[0]-d[0],c[1]-d[1],c[2]-d[2]);if(dist<md)md=dist;});return md;});nn.sort(function(a,b){return a-b;});var bestRatio=1,bestT=nn[nn.length-1]*2;for(var i=1;i<nn.length;i++){var ratio=nn[i]/(nn[i-1]||0.001);if(ratio>bestRatio){bestRatio=ratio;bestT=(nn[i-1]+nn[i])/2;}}if(bestRatio<1.5)bestT=nn[nn.length-1]*2;var spread=Math.hypot(Math.max.apply(null,cents.map(function(c){return c[0];}))-Math.min.apply(null,cents.map(function(c){return c[0];})),Math.max.apply(null,cents.map(function(c){return c[1];}))-Math.min.apply(null,cents.map(function(c){return c[1];})),Math.max.apply(null,cents.map(function(c){return c[2];}))-Math.min.apply(null,cents.map(function(c){return c[2];})));var result=Math.min(bestT,spread*0.25);return Math.max(result,nn[0]*1.1);}
function clusterComps(cents,thresh){var n=cents.length,par=cents.map(function(_,i){return i;});function find(x){return par[x]===x?x:(par[x]=find(par[x]));}function unite(a,b){par[find(a)]=find(b);}for(var i=0;i<n;i++)for(var j=i+1;j<n;j++){var d=Math.hypot(cents[i][0]-cents[j][0],cents[i][1]-cents[j][1],cents[i][2]-cents[j][2]);if(d<=thresh*1.02)unite(i,j);}var g={};cents.forEach(function(_,i){var r=find(i);if(!g[r])g[r]=[];g[r].push(i);});return Object.keys(g).map(function(k){return g[k];});}
function mergedCen(T,compList){var x=0,y=0,z=0,n=0;compList.forEach(function(c){c.forEach(function(i){T[i].forEach(function(v){x+=v[0];y+=v[1];z+=v[2];n++;});});});return[x/n,y/n,z/n];}
