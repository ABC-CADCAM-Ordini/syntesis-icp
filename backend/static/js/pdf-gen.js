// ─────────────────────────────────────────────────────────────
// Syntesis-ICP — Precision Scanner
// Copyright (C) Francesco Biaggini. Tutti i diritti riservati.
// Proprieta' esclusiva di Francesco Biaggini.
// Software concesso in licenza a Biaggini Medical Devices S.r.l.
// Riproduzione o distribuzione non autorizzata e' vietata.
// ─────────────────────────────────────────────────────────────

// ══════════════════════════════════════════════════════════════════════════
//  PDF v7 — Copertina + una pagina per cilindro
// ══════════════════════════════════════════════════════════════════════════
function pdf(){
  if(!window._LR||!window.jspdf){
    alert('jsPDF non caricato. Riprova tra un momento.');return;
  }
  var p=window._LR;
  var score=calcScore(p.pairs,p.cylAxes);
  var lv=scoreLabel(score);
  var scaleUm=getScaleUm(p.pairs);

  var doc=new window.jspdf.jsPDF({unit:'mm',format:'a4',compress:true});
  var W=210,H=297,ml=14,mr=14,cw=W-ml-mr;

  // ── helpers ────────────────────────────────────────────────────────
  function hexRGB(h){
    return[parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)];
  }
  function setFill(hex){var c=hexRGB(hex);doc.setFillColor(c[0],c[1],c[2]);}
  function setDraw(hex){var c=hexRGB(hex);doc.setDrawColor(c[0],c[1],c[2]);}
  function setTxt(hex){var c=hexRGB(hex);doc.setTextColor(c[0],c[1],c[2]);}

  // Canvas → base64 PNG (off-screen)
  function cvPng(w,h,drawFn){
    var cv=document.createElement('canvas');
    cv.width=w;cv.height=h;
    drawFn(cv);
    return cv.toDataURL('image/png');
  }

  // ── pdfArc helper (line segments) ──────────────────────────────────
  function pdfArc(cx,cy,r,startDeg,endDeg,lw,rgb){
    var steps=Math.max(8,Math.ceil(Math.abs(endDeg-startDeg)/3));
    doc.setDrawColor(rgb[0],rgb[1],rgb[2]);doc.setLineWidth(lw);
    var prev=null;
    for(var i=0;i<=steps;i++){
      var a=(startDeg+(endDeg-startDeg)*i/steps)*Math.PI/180;
      var px=cx+r*Math.cos(a),py=cy+r*Math.sin(a);
      if(prev)doc.line(prev[0],prev[1],px,py);
      prev=[px,py];
    }
  }

  // ══════════════════════════════════════════════════════════════════
  //  PAGE 1 - COPERTINA
  // ══════════════════════════════════════════════════════════════════
  var lvRGB=hexRGB(lv.col);
  var lvBgRGB=hexRGB(lv.bg);
  var lvFgRGB=hexRGB(lv.fg);

  // ── Full-page dark navy background (matches badge style) ──────────
  doc.setFillColor(13,27,42);doc.rect(0,0,W,H,'F');

  // Gold radial glow top-right (decorative)
  // (jsPDF doesn't support radial gradients natively - simulate with circles)
  for(var gi=0;gi<5;gi++){
    var ga=0.04-gi*0.007;
    var gr2=60+gi*18;
    doc.setFillColor(245,158,11);
    doc.setGState(new doc.GState({opacity:ga}));
    doc.circle(W-10,10,gr2,'F');
  }
  doc.setGState(new doc.GState({opacity:1}));

  // Top gold bar
  var goldBar=doc.setFillColor(255,215,0);doc.rect(0,0,W,3,'F');
  doc.setFillColor(245,158,11);doc.rect(0,3,W,1.5,'F');

  // ── LOGO (top-left) ────────────────────────────────────────────────
  try{
    // Use LOGO_DATA directly (jsPDF supports base64 PNG)
    if(LOGO_DATA&&LOGO_DATA.length>100){
      // Logo dimensions: estimate height from natural PNG aspect ratio
      // PNG is landscape ~2.75:1 ratio approx
      var logoW=72,logoH=20;
      doc.addImage(LOGO_DATA,'PNG',ml,8,logoW,logoH);
    }
  }catch(e){}

  // ── BADGE IMAGE - render score card directly onto offscreen canvas ─
  // Replica exacta di drawShareCard ma sincrona, senza DOM share-canvas
  var badgePng='';
  try{
    var _bcv=document.createElement('canvas');
    _bcv.width=1080;_bcv.height=1080;
    var _bctx=_bcv.getContext('2d');
    var _bW=1080,_bH=1080,_bCX=540,_bCY=360;
    // Background gradient
    var _bg=_bctx.createLinearGradient(0,0,_bW,_bH);
    _bg.addColorStop(0,'#0d1b2a');_bg.addColorStop(.5,'#12253d');_bg.addColorStop(1,'#0d1b2a');
    _bctx.fillStyle=_bg;_bctx.fillRect(0,0,_bW,_bH);
    // Glow effects
    function _glow(x,y,r,c){var g=_bctx.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,c);g.addColorStop(1,'transparent');_bctx.fillStyle=g;_bctx.beginPath();_bctx.arc(x,y,r,0,Math.PI*2);_bctx.fill();}
    _glow(_bW*.85,_bH*.08,380,'rgba(245,158,11,.18)');
    _glow(_bW*.15,_bH*.92,300,'rgba(245,158,11,.12)');
    _glow(_bCX,_bCY*.95,260,'rgba('+lvRGB.join(',')+',.08)');
    // Gold top bar
    var _topGrad=_bctx.createLinearGradient(0,0,_bW,0);
    _topGrad.addColorStop(0,'transparent');_topGrad.addColorStop(.3,'rgba(245,158,11,.7)');
    _topGrad.addColorStop(.5,'rgba(255,215,0,.9)');_topGrad.addColorStop(.7,'rgba(245,158,11,.7)');_topGrad.addColorStop(1,'transparent');
    _bctx.fillStyle=_topGrad;_bctx.fillRect(0,0,_bW,5);
    // Score ring
    var _r=208,_lw=28,_sa=-Math.PI/2;
    _bctx.beginPath();_bctx.arc(_bCX,_bCY,_r,0,Math.PI*2);
    _bctx.strokeStyle='rgba(255,255,255,.06)';_bctx.lineWidth=_lw;_bctx.stroke();
    var _ag=_bctx.createLinearGradient(_bCX-_r,_bCY-_r,_bCX+_r,_bCY+_r);
    _ag.addColorStop(0,'#FFD700');_ag.addColorStop(.5,lv.col);_ag.addColorStop(1,'#F59E0B');
    _bctx.shadowColor='rgba(245,158,11,.6)';_bctx.shadowBlur=32;
    _bctx.beginPath();_bctx.arc(_bCX,_bCY,_r,_sa,_sa+(score/100)*Math.PI*2);
    _bctx.strokeStyle=_ag;_bctx.lineWidth=_lw;_bctx.lineCap='round';_bctx.stroke();
    _bctx.shadowBlur=0;
    // Score number
    _bctx.shadowColor='rgba(245,158,11,.4)';_bctx.shadowBlur=20;
    _bctx.fillStyle='#fff';_bctx.font='900 172px sans-serif';
    _bctx.textAlign='center';_bctx.textBaseline='middle';
    _bctx.fillText(score.toFixed(2),_bCX,_bCY-16);_bctx.shadowBlur=0;
    _bctx.fillStyle='rgba(255,215,0,.55)';_bctx.font='600 40px sans-serif';
    _bctx.fillText('/100',_bCX,_bCY+76);
    // Cross-browser rounded rect helper
    function _bRR(x,y,w,h,r){_bctx.beginPath();_bctx.moveTo(x+r,y);_bctx.lineTo(x+w-r,y);_bctx.quadraticCurveTo(x+w,y,x+w,y+r);_bctx.lineTo(x+w,y+h-r);_bctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);_bctx.lineTo(x+r,y+h);_bctx.quadraticCurveTo(x,y+h,x,y+h-r);_bctx.lineTo(x,y+r);_bctx.quadraticCurveTo(x,y,x+r,y);_bctx.closePath();}
    // Score label pill
    var _py=_bCY+_r+42,_pw=340,_ph=62;
    var _pg=_bctx.createLinearGradient(_bCX-_pw/2,_py,_bCX+_pw/2,_py+_ph);
    _pg.addColorStop(0,'rgba(245,158,11,.22)');_pg.addColorStop(1,'rgba(255,215,0,.12)');
    _bctx.fillStyle=_pg;
    _bRR(_bCX-_pw/2,_py,_pw,_ph,31);_bctx.fill();
    var _pb=_bctx.createLinearGradient(_bCX-_pw/2,_py,_bCX+_pw/2,_py);
    _pb.addColorStop(0,'rgba(245,158,11,.2)');_pb.addColorStop(.5,'rgba(255,215,0,.8)');_pb.addColorStop(1,'rgba(245,158,11,.2)');
    _bctx.strokeStyle=_pb;_bctx.lineWidth=1.5;
    _bRR(_bCX-_pw/2,_py,_pw,_ph,31);_bctx.stroke();
    _bctx.shadowColor='rgba(245,158,11,.5)';_bctx.shadowBlur=12;
    _bctx.fillStyle='#FFD700';_bctx.font='800 30px sans-serif';_bctx.textBaseline='middle';
    _bctx.fillText(lv.label.toUpperCase(),_bCX,_py+_ph/2);_bctx.shadowBlur=0;
    // Divider line
    var _dy=_py+_ph+52;
    var _dg=_bctx.createLinearGradient(80,_dy,_bW-80,_dy);
    _dg.addColorStop(0,'transparent');_dg.addColorStop(.3,'rgba(245,158,11,.5)');
    _dg.addColorStop(.5,'rgba(255,215,0,.8)');_dg.addColorStop(.7,'rgba(245,158,11,.5)');_dg.addColorStop(1,'transparent');
    _bctx.strokeStyle=_dg;_bctx.lineWidth=1;
    _bctx.beginPath();_bctx.moveTo(120,_dy);_bctx.lineTo(_bW-120,_dy);_bctx.stroke();
    // File names row
    var _ny=_dy+72;
    _bctx.fillStyle='#fff';_bctx.font='700 48px sans-serif';_bctx.textBaseline='middle';
    var _nA=(p.nA||'').replace(/\.stl$/i,'').slice(0,22);
    var _nB=(p.nB||'').replace(/\.stl$/i,'').slice(0,22);
    _bctx.fillText(_nA,_bCX,_ny);
    _bctx.fillStyle='rgba(255,215,0,.6)';_bctx.font='500 28px sans-serif';
    _bctx.fillText(_nA+' → '+_nB,_bCX,_ny+62);
    // Bottom bar + footer
    _bctx.fillStyle=_topGrad;_bctx.fillRect(0,_bH-5,_bW,5);
    _bctx.fillStyle='rgba(255,255,255,.18)';_bctx.font='500 22px sans-serif';_bctx.textBaseline='middle';
    _bctx.fillText('syntesis-icp.com · Precision Scanner',_bCX,1045);
    // Logo bianco (preload sincrono da data URI)
    try{
      var _li=new Image();_li.src=LOGO_DATA;
      if(_li.complete&&_li.naturalWidth>0){
        var _lh=90,_lw2=_lh*(_li.naturalWidth/_li.naturalHeight);
        _bctx.fillStyle='rgba(255,255,255,.07)';
        _bRR(_bCX-_lw2/2-20,_ny+110,_lw2+40,_lh+28,16);_bctx.fill();
        _bctx.globalAlpha=.92;_bctx.drawImage(_li,_bCX-_lw2/2,_ny+124,_lw2,_lh);_bctx.globalAlpha=1;
      }
    }catch(_le){}
    badgePng=_bcv.toDataURL('image/png');
  }catch(_be){badgePng='';}

  // Badge position: centered, filling upper half of page
  var badgeSize=110; // mm - grande, occupa bene la copertina
  var badgeX=(W-badgeSize)/2;
  var badgeY=28; // below the logo

  if(badgePng){
    doc.addImage(badgePng,'PNG',badgeX,badgeY,badgeSize,badgeSize);
  } else {
    // Last-resort fallback: simple ring
    var cx2=W/2,cy2=badgeY+badgeSize/2,r2=36,lw2=6;
    doc.setDrawColor(20,35,55);doc.setLineWidth(lw2+2);doc.circle(cx2,cy2,r2,'S');
    var startA=-90,endA=startA+(score/100*360);
    pdfArc(cx2,cy2,r2,startA,endA,lw2,lvRGB);
    doc.setFont('helvetica','bold');doc.setFontSize(26);setTxt(lv.col);
    doc.text(score.toFixed(2),cx2,cy2+4,{align:'center'});
    doc.setFontSize(9);doc.setFont('helvetica','normal');doc.setTextColor(120,144,164);
    doc.text('/100',cx2,cy2+12,{align:'center'});
  }

  // ── Info row (directly after badge - pill already in badge card) ───
  var iy2=badgeY+badgeSize+6;
  // Divider line (gold)
  doc.setDrawColor(245,158,11);doc.setLineWidth(0.4);
  doc.line(ml+10,iy2-3,W-mr-10,iy2-3);

  // Tronca i nomi file in modo intelligente (max 28 chars + ellipsis)
  function truncate(s,n){return s.length>n?s.slice(0,n-1)+'…':s;}

  var infos=[
    ['File A - Riferimento', truncate(p.nA,30)],
    ['File B - Confronto',   truncate(p.nB,30)],
    ['N deg cilindri',          p.cA+''],
    ['RMSD ICP',             p.icpRmsd.toFixed(4)+' mm'],
    ['Data analisi',         new Date().toLocaleDateString('it-IT')]
  ];

  // Layout su 2 righe: [0,1,2] poi [3,4] - 3 colonne / 2 colonne
  [[0,1,2],[3,4]].forEach(function(row,ri){
    var nCols=row.length;
    row.forEach(function(ii,ci){
      if(ii>=infos.length)return;
      var colW2=cw/nCols;
      var ix=ml+ci*colW2+colW2/2;
      var rowY=iy2+ri*14;
      // Label
      doc.setFont('helvetica','normal');doc.setFontSize(6.5);
      doc.setTextColor(120,144,164);
      doc.text(infos[ii][0],ix,rowY,{align:'center'});
      // Value - check overflow and reduce size if needed
      doc.setFont('helvetica','bold');doc.setFontSize(8);
      doc.setTextColor(240,247,255);
      var val=infos[ii][1];
      var valW=doc.getTextWidth(val);
      if(valW>colW2-4){
        // Scale font down to fit
        doc.setFontSize(Math.max(5.5, 8*(colW2-4)/valW));
      }
      doc.text(val,ix,rowY+6,{align:'center'});
      doc.setFontSize(8); // reset
    });
  });

  // ── Colorimetric map ────────────────────────────────────────────────
  var mapY2=iy2+32; // info rows + margin
  // Assicura che non vada fuori pagina
  if(mapY2>195) mapY2=195;
  // Section label
  doc.setFont('helvetica','bold');doc.setFontSize(7.5);
  doc.setTextColor(255,215,0);
  doc.text('MAPPA COLORIMETRICA - POSIZIONI SCANBODY',ml,mapY2);

  // Calcola altezza mappa in modo che non sbordi dalla pagina
  var availH=H-16-(mapY2+4)-12; // spazio disponibile fino al footer
  var mapH2=Math.min(cw*400/900, availH);
  var mapPng2=cvPng(900,400,function(cv){drawColorMap(cv,p.pairs);});
  doc.addImage(mapPng2,'PNG',ml,mapY2+4,cw,mapH2);

  // ── Clinical scale legend ───────────────────────────────────────────
  var legY2=mapY2+4+mapH2+4;
  var clin2=[
    {c:'#639922',label:'0-50 um  Ottimo'},
    {c:'#D97706',label:'50-100  Accett.'},
    {c:'#F97316',label:'100-150  Risch.'},
    {c:'#EF4444',label:'150-250  Tens.'},
    {c:'#A855F7',label:'>250 um  Fuori'}
  ];
  var lw3=cw/clin2.length;
  // Disegna legenda solo se c'è spazio
  if(legY2+12<H-10){
    clin2.forEach(function(cl,i){
      var lx=ml+i*lw3;
      var cRGB2=hexRGB(cl.c);
      doc.setFillColor(cRGB2[0],cRGB2[1],cRGB2[2]);
      doc.rect(lx,legY2,lw3-1,3,'F');
      doc.setFont('helvetica','normal');doc.setFontSize(6);
      doc.setTextColor(180,190,200);
      doc.text(cl.label,lx+1,legY2+7);
    });
  }

  // ── Bottom bar (gold) + footer ──────────────────────────────────────
  doc.setFillColor(255,215,0);doc.rect(0,H-3,W,3,'F');
  doc.setFillColor(245,158,11);doc.rect(0,H-4.5,W,1.5,'F');
  doc.setFont('helvetica','bold');doc.setFontSize(7);
  doc.setTextColor(120,144,164);
  doc.text('Syntesis-ICP · STL Cylinder Comparator v7 · Biaggini Medical Devices S.r.l.',W/2,H-6,{align:'center'});

  // ══════════════════════════════════════════════════════════════════
  //  ONE PAGE PER CYLINDER
  // ══════════════════════════════════════════════════════════════════
  p.pairs.forEach(function(pp,ci){
    doc.addPage();
    var y=0;

    var d3um=pp.d3!==null?Math.round(pp.d3*1000):0;
    var dxum=pp.dx!==null?Math.round(pp.dx*1000):0;
    var dyum=pp.dy!==null?Math.round(pp.dy*1000):0;
    var dzum=pp.dz!==null?Math.round(pp.dz*1000):0;
    var dxyum=pp.dxy!==null?Math.round(pp.dxy*1000):0;
    var clv=clinLevel(d3um);
    var clRGB=hexRGB(clv.col);
    var clBgRGB=hexRGB(clv.bg);
    var clFgRGB=hexRGB(clv.fg);
    var axInfo=p.cylAxes&&p.cylAxes[ci]&&p.cylAxes[ci].angleDeg!==null?p.cylAxes[ci]:null;
    var axRGB=axInfo?hexRGB(clinAxis(axInfo.angleDeg).col):[100,100,100];

    // ── Header bar ─────────────────────────────────────────────────
    doc.setFillColor(clBgRGB[0],clBgRGB[1],clBgRGB[2]);
    doc.rect(0,0,W,16,'F');
    doc.setFillColor(clRGB[0],clRGB[1],clRGB[2]);doc.rect(0,0,5,16,'F');
    doc.setFont('helvetica','bold');doc.setFontSize(14);
    doc.setTextColor(clFgRGB[0],clFgRGB[1],clFgRGB[2]);
    doc.text('Cilindro #'+(ci+1),ml+2,10.5);
    doc.setFontSize(9);
    var cylHdr=clv.label+' - '+d3um+' um  |D3D|';
    doc.setFontSize(Math.min(9, 9*60/Math.max(60,doc.getTextWidth(cylHdr)*1.2)));
    doc.text(cylHdr,ml+2,15);
    doc.setFontSize(9);
    // Score on right
    var sc2=score; // global score already computed
    doc.setFont('helvetica','bold');doc.setFontSize(11);
    doc.text('Voto globale: '+score.toFixed(2)+'/100',W-mr,10.5,{align:'right'});
    doc.setFontSize(8);doc.setFont('helvetica','normal');
    doc.text(p.nA+' vs '+p.nB,W-mr,15,{align:'right'});

    y=20;

    // ── 3 views (XY / XZ / YZ) - filled triangles ─────────────────
    doc.setFont('helvetica','bold');doc.setFontSize(8);setTxt('#0065B3');
    doc.text('VISUALIZZAZIONE MESH 3D',ml,y);
    y+=3;

    // Find which triangles belong to this cylinder
    // Use sortA[ci] indices to get A tris, match B tris by proximity
    var viewW=60,viewH=56,gap=3;
    var views=[
      {label:'Vista XY (dall\'alto)',ax1:0,ax2:1,axD:2},
      {label:'Vista XZ (frontale)', ax1:0,ax2:2,axD:1},
      {label:'Vista YZ (laterale)', ax1:1,ax2:2,axD:0}
    ];

    // Get tris for this specific cylinder from global mesh
    // We render the full mesh but highlight this cylinder
    views.forEach(function(v,vi){
      var vx=ml+vi*(viewW+gap);
      var cylA=p.cylTrisA&&p.cylTrisA[ci]?p.cylTrisA[ci]:[];
      var cylB=p.cylTrisB&&p.cylTrisB[ci]?p.cylTrisB[ci]:[];
      var png=cvPng(viewW*5,viewH*5,function(cv){
        paintViewCyl(cv,cylA,cylB,v.ax1,v.ax2,v.axD,v.label,ci);
      });
      doc.addImage(png,'PNG',vx,y,viewW,viewH);
      // Label
      doc.setFont('helvetica','normal');doc.setFontSize(6);setTxt('#7A90A4');
      doc.text(v.label,vx+viewW/2,y+viewH+3,{align:'center'});
    });

    y+=viewH+8;

    // ── Deviation card (gauge + compass + bars) ────────────────────
    doc.setFont('helvetica','bold');doc.setFontSize(8);setTxt('#0065B3');
    doc.text('ANALISI DEVIAZIONE',ml,y);y+=3;

    var cardW=cw,cardH=52;
    var devPng=cvPng(720,200,function(cv){
      drawCard(cv,dxum,dyum,dzum,d3um,scaleUm,axInfo?axInfo.angleDeg:null);
    });
    doc.addImage(devPng,'PNG',ml,y,cardW,cardH);
    y+=cardH+6;

    // ── Measurements table ─────────────────────────────────────────
    doc.setFont('helvetica','bold');doc.setFontSize(8);setTxt('#0065B3');
    doc.text('TABELLA MISURAZIONI',ml,y);y+=2;

    var rows=[
      ['|D| 3D totale', d3um+'um', clv.label, ''],
      ['Deviazione XY (piano)', dxyum+'um', dxyum<50?'Ottimo':dxyum<100?'Accettabile':dxyum<150?'Rischioso':dxyum<250?'Tensione':'Fuori', ''],
      ['Deviazione X', (dxum>=0?'+':'')+dxum+'um', '', ''],
      ['Deviazione Y', (dyum>=0?'+':'')+dyum+'um', '', ''],
      ['Deviazione Z (verticale)', (dzum>=0?'+':'')+dzum+'um', '', ''],
    ];
    if(axInfo){
      var axLv=clinAxis(axInfo.angleDeg);
      rows.push(['Angolo asse cilindro', axInfo.angleDeg.toFixed(3)+' deg', axLv.label, '']);
    }
    rows.push(['Centroide A (X,Y,Z)', pp.a[0].toFixed(3)+', '+pp.a[1].toFixed(3)+', '+pp.a[2].toFixed(3)+' mm', '', '']);
    if(pp.b) rows.push(['Centroide B allineato', pp.b[0].toFixed(3)+', '+pp.b[1].toFixed(3)+', '+pp.b[2].toFixed(3)+' mm', '', '']);

    doc.autoTable({
      startY:y,
      margin:{left:ml,right:mr},
      head:[['Parametro','Valore','Valutazione','']],
      body:rows,
      styles:{font:'helvetica',fontSize:8,cellPadding:2,lineColor:[214,228,240],lineWidth:.2,valign:'middle'},
      headStyles:{fillColor:[0,101,179],textColor:255,fontStyle:'bold',fontSize:7,halign:'left'},
      columnStyles:{
        0:{cellWidth:72,fontStyle:'bold',textColor:[15,25,35]},
        1:{cellWidth:44,halign:'center',font:'courier',fontStyle:'bold',textColor:clRGB},
        2:{cellWidth:40,halign:'center',textColor:[100,100,100]},
        3:{cellWidth:16}
      },
      alternateRowStyles:{fillColor:[245,250,255]},
      didParseCell:function(data){
        if(data.column.index===1&&data.section==='body'){
          // Color value cell by clinical level
          var val=parseInt(data.cell.raw);
          if(!isNaN(val)&&data.row.index===0){
            var rgb=hexRGB(clv.col);
            data.cell.styles.textColor=rgb;
          }
        }
      }
    });

    var tableBottom=doc.lastAutoTable.finalY+6;

    // ── Direction compass (bigger, standalone) ──────────────────────
    if(tableBottom < H-50){
      var compY=tableBottom;
      doc.setFont('helvetica','bold');doc.setFontSize(8);setTxt('#0065B3');
      doc.text('DIREZIONE SCOSTAMENTO XY',ml,compY);compY+=3;

      var compPng=cvPng(300,300,function(cv){
        var ctx=cv.getContext('2d'),W2=300,H2=300;
        ctx.clearRect(0,0,W2,H2);
        ctx.fillStyle='#f8fafc';ctx.fillRect(0,0,W2,H2);
        var ccx=W2/2,ccy=H2/2,cr=100;
        // Rings
        ctx.beginPath();ctx.arc(ccx,ccy,cr,0,Math.PI*2);
        ctx.strokeStyle='#e2eaf3';ctx.lineWidth=1.5;ctx.stroke();
        ctx.beginPath();ctx.arc(ccx,ccy,cr*0.5,0,Math.PI*2);
        ctx.strokeStyle='#eef3f8';ctx.lineWidth=0.8;ctx.stroke();
        // Crosshair
        ctx.strokeStyle='#e8eff7';ctx.lineWidth=0.6;ctx.setLineDash([4,6]);
        ctx.beginPath();ctx.moveTo(ccx,ccy-cr+5);ctx.lineTo(ccx,ccy+cr-5);ctx.stroke();
        ctx.beginPath();ctx.moveTo(ccx-cr+5,ccy);ctx.lineTo(ccx+cr-5,ccy);ctx.stroke();
        ctx.setLineDash([]);
        // Cardinals
        ctx.fillStyle='#94a3b8';ctx.font='bold 14px sans-serif';ctx.textAlign='center';
        ctx.fillText('N',ccx,ccy-cr-6);ctx.fillText('S',ccx,ccy+cr+16);
        ctx.textAlign='left';ctx.fillText('E',ccx+cr+6,ccy+5);
        ctx.textAlign='right';ctx.fillText('O',ccx-cr-6,ccy+5);
        // Arrow
        var bearing=Math.atan2(dxum,-dyum);
        var arLen=cr*0.72;
        var bx=ccx+arLen*Math.sin(bearing),by=ccy-arLen*Math.cos(bearing);
        var col2=clv.col;
        ctx.strokeStyle=col2;ctx.lineWidth=3;
        ctx.beginPath();ctx.moveTo(ccx,ccy);ctx.lineTo(bx,by);ctx.stroke();
        var ah=cr*0.18,aa=Math.atan2(by-ccy,bx-ccx);
        ctx.fillStyle=col2;ctx.beginPath();
        ctx.moveTo(bx,by);
        ctx.lineTo(bx-ah*Math.cos(aa-0.42),by-ah*Math.sin(aa-0.42));
        ctx.lineTo(bx-ah*Math.cos(aa+0.42),by-ah*Math.sin(aa+0.42));
        ctx.closePath();ctx.fill();
        // Center dot A
        ctx.beginPath();ctx.arc(ccx,ccy,6,0,Math.PI*2);
        ctx.fillStyle='#0065B3';ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();
        // B dot
        var dxy2=Math.sqrt(dxum*dxum+dyum*dyum);
        if(dxy2>1){
          ctx.beginPath();ctx.arc(bx,by,6,0,Math.PI*2);
          ctx.fillStyle=col2;ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();
          // XY label
          ctx.fillStyle=col2;ctx.font='bold 13px monospace';ctx.textAlign='center';
          ctx.fillText(Math.round(dxy2)+'um',ccx+(bx-ccx)*0.55+14,ccy-(by-ccy)*0.55);
        }
        // Z badge
        if(Math.abs(dzum)>2){
          var zbg=dzum>0?'rgba(254,226,226,0.92)':'rgba(219,234,254,0.92)';
          var zcl=dzum>0?'#ef4444':'#2563eb';
          ctx.fillStyle=zbg;ctx.beginPath();ctx.arc(W2-28,24,18,0,Math.PI*2);ctx.fill();
          ctx.strokeStyle=zcl;ctx.lineWidth=1.5;ctx.stroke();
          ctx.fillStyle=zcl;ctx.font='bold 11px monospace';ctx.textAlign='center';
          ctx.fillText(dzum>0?'↑':'↓',W2-28,21);
          ctx.font='10px monospace';ctx.fillText(Math.abs(dzum),W2-28,33);
        }
      });
      doc.addImage(compPng,'PNG',ml,compY,40,40);

      // Compass legend
      doc.setFont('helvetica','normal');doc.setFontSize(7);setTxt('#0F1923');
      doc.text('A = centroide riferimento',ml+44,compY+8);
      doc.setTextColor(clRGB[0],clRGB[1],clRGB[2]);
      doc.text('B = centroide misurato (post-ICP)',ml+44,compY+14);
      setTxt('#0F1923');
      var vectStr='XY: '+dxyum+' um  dX:'+(dxum>=0?'+':'')+dxum+'  dY:'+(dyum>=0?'+':'')+dyum;
      doc.text(vectStr,ml+44,compY+20);
      doc.text('Deviazione Z: '+(dzum>=0?'+':'')+dzum+'um',ml+44,compY+26);
      if(axInfo){
        doc.setTextColor(axRGB[0],axRGB[1],axRGB[2]);
        var axStr='Asse: '+axInfo.angleDeg.toFixed(2)+'deg  '+clinAxis(axInfo.angleDeg).label;
        doc.text(axStr,ml+44,compY+32);
      }
    }

    // Footer
    doc.setFont('helvetica','normal');doc.setFontSize(7);setTxt('#7A90A4');
    doc.line(ml,H-8,W-mr,H-8);
    doc.text('Syntesis-ICP · Cilindro #'+(ci+1)+' di '+p.pairs.length,ml,H-4);
    doc.text('Pag. '+(ci+2)+' / '+(p.pairs.length+1),W-mr,H-4,{align:'right'});
  });

  // ── Pagine Distanze Inter-Centroide (una pagina per coppia) ──────────
  if(p.pairs && p.pairs.length >= 2){

    var ctA2 = p.pairs.map(function(pp){return pp.a;});
    var ctB2 = p.pairs.map(function(pp){return pp.b;});

    function dist3pdf(a,b){
      if(!a||!b)return null;
      return Math.sqrt((a[0]-b[0])*(a[0]-b[0])+(a[1]-b[1])*(a[1]-b[1])+(a[2]-b[2])*(a[2]-b[2]));
    }
    function allPairsPdf(n){
      var out=[];
      for(var i=0;i<n;i++)for(var j=i+1;j<n;j++)out.push([i,j]);
      return out;
    }
    function diffColorPdf(diff_um){
      var a=Math.abs(diff_um);
      if(a<50)  return{col:'#3a7d08',bg:'#EAF3DE',border:'#a3d26a'};
      if(a<100) return{col:'#D97706',bg:'#FEFCE8',border:'#f5d06a'};
      if(a<200) return{col:'#ea5a00',bg:'#FFF3E0',border:'#f9b97a'};
      return    {col:'#c91a1a',bg:'#FEE2E2',border:'#f9a0a0'};
    }

    var pairsD=allPairsPdf(ctA2.length);
    var nTotal=pairsD.length;

    // ── Pre-calcola proiezione PCA globale (stessa scala per tutte le mappe) ──
    var n2=ctA2.length;
    var cmx=0,cmy=0,cmz=0;
    ctA2.forEach(function(pt){cmx+=pt[0]/n2;cmy+=pt[1]/n2;cmz+=pt[2]/n2;});
    var cov2=[[0,0,0],[0,0,0],[0,0,0]];
    ctA2.forEach(function(pt){
      var d=[pt[0]-cmx,pt[1]-cmy,pt[2]-cmz];
      for(var ii=0;ii<3;ii++)for(var jj=0;jj<3;jj++)cov2[ii][jj]+=d[ii]*d[jj]/n2;
    });
    var eig2=jacobi3(cov2);
    var ord2=[0,1,2].sort(function(a,b){return eig2.vals[b]-eig2.vals[a];});
    var u1g=[eig2.vecs[0][ord2[0]],eig2.vecs[1][ord2[0]],eig2.vecs[2][ord2[0]]];
    var u2g=[eig2.vecs[0][ord2[1]],eig2.vecs[1][ord2[1]],eig2.vecs[2][ord2[1]]];
    function projG(pt){
      var dx=pt[0]-cmx,dy=pt[1]-cmy,dz=pt[2]-cmz;
      return[dx*u1g[0]+dy*u1g[1]+dz*u1g[2],dx*u2g[0]+dy*u2g[1]+dz*u2g[2]];
    }
    var projA2=ctA2.map(projG);
    var projB2=ctB2.map(function(pt){return pt?projG(pt):null;});

    // Bounds globali (tutti i punti A e B)
    var allPts2=[];
    projA2.forEach(function(pt){allPts2.push(pt);});
    projB2.forEach(function(pt){if(pt)allPts2.push(pt);});
    var p1s2=allPts2.map(function(pt){return pt[0];}),p2s2=allPts2.map(function(pt){return pt[1];});
    var mn1g=Math.min.apply(null,p1s2),mx1g=Math.max.apply(null,p1s2);
    var mn2g=Math.min.apply(null,p2s2),mx2g=Math.max.apply(null,p2s2);
    var rg2=Math.max(mx1g-mn1g,mx2g-mn2g,0.001),mg2=rg2*0.35;
    var c1g=(mn1g+mx1g)/2,c2g=(mn2g+mx2g)/2,ts2=rg2+mg2*2;

    // Funzione di proiezione canvas - usata da tutti i mini-canvas PDF
    function toCanvasPdf(pt2d, CW, CH, pad){
      return[
        pad+(pt2d[0]-(c1g-ts2/2))/ts2*(CW-pad*2),
        CH-pad-(pt2d[1]-(c2g-ts2/2))/ts2*(CH-pad*2)
      ];
    }

    // ── Per ogni coppia: pagina dedicata ─────────────────────────────
    pairsD.forEach(function(ij, pageIdx){
      var hi=ij[0], hj=ij[1];
      var dA=dist3pdf(ctA2[hi],ctA2[hj]);
      var dB=(ctB2[hi]&&ctB2[hj])?dist3pdf(ctB2[hi],ctB2[hj]):null;
      var diff=dB!==null?(dB-dA)*1000:null;
      var lv2=diff!==null?diffColorPdf(diff):{col:'#6b7280',bg:'#f3f4f6',border:'#e5e7eb'};
      var lvRGB2=hexRGB(lv2.bg);
      var lvFG=hexRGB(lv2.col);
      var diffStr=diff!==null?(diff>=0?'+':'')+diff.toFixed(1)+'um':'N/A';
      var label=diff===null?'Non abbinato':Math.abs(diff)<50?'Ottimo':Math.abs(diff)<100?'Buono':Math.abs(diff)<200?'Accettabile':'Da verificare';

      doc.addPage();

      // ── Header pagina ────────────────────────────────────────────
      setFill('#0F1923');doc.rect(0,0,W,22,'F');
      setFill('#1a5f9e');doc.rect(0,22,W,2,'F');
      doc.setFont('helvetica','bold');doc.setFontSize(13);setTxt('#FFFFFF');
      doc.text('Distanza Inter-Centroide #'+(hi+1)+'-#'+(hj+1),ml,14);
      doc.setFontSize(8);doc.setFont('helvetica','normal');setTxt('#7A90A4');
      var coppiaStr='Coppia '+(pageIdx+1)+'/'+nTotal+'  A (rif.) vs B (post-ICP)';
      doc.text(coppiaStr,ml,19);

      // Badge Δ in header a destra
      if(diff!==null){
        doc.setFillColor(lvRGB2[0],lvRGB2[1],lvRGB2[2]);
        doc.rect(W-mr-40,5,40,12,'F');
        doc.setTextColor(lvFG[0],lvFG[1],lvFG[2]);
        doc.setFont('helvetica','bold');doc.setFontSize(9);
        var _ds2=diff!==null?(diff>=0?'+':'')+diff.toFixed(1)+'um':'N/A';
        doc.text(_ds2,W-mr-20,10,{align:'center'});
        doc.setFontSize(7);doc.setFont('helvetica','normal');
        doc.text(label,W-mr-20,16,{align:'center'});
      }

      var curY2=28;

      // ── Mappa dedicata per questa coppia ──────────────────────────
      // Usa stessa logica di drawPairMap, ma off-screen per jsPDF
      var mapW2=500, mapH2=320;
      var mapPng2=cvPng(mapW2,mapH2,function(cv){
        var ctx=cv.getContext('2d'),CW=cv.width,CH=cv.height;
        var pad=38;
        ctx.fillStyle='#fafafa';ctx.fillRect(0,0,CW,CH);

        function sc(pt2d){return toCanvasPdf(pt2d,CW,CH,pad);}

        // Linee sfondo (grigio per le coppie non attive)
        pairsD.forEach(function(ij2){
          if(ij2[0]===hi&&ij2[1]===hj)return;
          var pa=sc(projA2[ij2[0]]),pb=sc(projA2[ij2[1]]);
          ctx.beginPath();ctx.moveTo(pa[0],pa[1]);ctx.lineTo(pb[0],pb[1]);
          ctx.strokeStyle='rgba(200,215,235,0.55)';ctx.lineWidth=1;ctx.stroke();
          if(projB2[ij2[0]]&&projB2[ij2[1]]){
            var qb=sc(projB2[ij2[0]]),rb=sc(projB2[ij2[1]]);
            ctx.beginPath();ctx.moveTo(qb[0],qb[1]);ctx.lineTo(rb[0],rb[1]);
            ctx.strokeStyle='rgba(220,195,150,0.35)';ctx.lineWidth=0.8;
            ctx.setLineDash([3,3]);ctx.stroke();ctx.setLineDash([]);
          }
        });

        // Linea A evidenziata (blu solido con glow)
        var pA=sc(projA2[hi]),qA=sc(projA2[hj]);
        ctx.beginPath();ctx.moveTo(pA[0],pA[1]);ctx.lineTo(qA[0],qA[1]);
        ctx.strokeStyle='rgba(26,95,158,0.1)';ctx.lineWidth=12;ctx.stroke();
        ctx.beginPath();ctx.moveTo(pA[0],pA[1]);ctx.lineTo(qA[0],qA[1]);
        ctx.strokeStyle='#1a5f9e';ctx.lineWidth=2.5;ctx.stroke();
        // Label A al centro ruotata lungo il segmento
        var mxA=(pA[0]+qA[0])/2,myA=(pA[1]+qA[1])/2;
        var angA=Math.atan2(qA[1]-pA[1],qA[0]-pA[0]);
        ctx.save();ctx.translate(mxA,myA);ctx.rotate(angA);
        ctx.fillStyle='rgba(255,255,255,0.9)';ctx.fillRect(-30,-14,60,14);
        ctx.fillStyle='#1a5f9e';ctx.font='bold 11px monospace';ctx.textAlign='center';ctx.textBaseline='middle';
        ctx.fillText((dA*1000).toFixed(1)+'um',0,-7);
        ctx.restore();

        // Linea B evidenziata (arancio tratteggiato)
        if(projB2[hi]&&projB2[hj]&&dB!==null){
          var pB=sc(projB2[hi]),qB=sc(projB2[hj]);
          ctx.beginPath();ctx.moveTo(pB[0],pB[1]);ctx.lineTo(qB[0],qB[1]);
          ctx.strokeStyle='rgba(186,117,23,0.15)';ctx.lineWidth=8;ctx.stroke();
          ctx.beginPath();ctx.moveTo(pB[0],pB[1]);ctx.lineTo(qB[0],qB[1]);
          ctx.strokeStyle='#ba7517';ctx.lineWidth=2;ctx.setLineDash([6,4]);ctx.stroke();
          ctx.setLineDash([]);
          var mxB=(pB[0]+qB[0])/2,myB=(pB[1]+qB[1])/2;
          var angB=Math.atan2(qB[1]-pB[1],qB[0]-pB[0]);
          ctx.save();ctx.translate(mxB,myB);ctx.rotate(angB);
          ctx.fillStyle='rgba(255,248,238,0.9)';ctx.fillRect(-30,2,60,14);
          ctx.fillStyle='#ba7517';ctx.font='bold 11px monospace';ctx.textAlign='center';ctx.textBaseline='middle';
          ctx.fillText((dB*1000).toFixed(1)+'um',0,9);
          ctx.restore();
        }

        // Nodi A di sfondo (grigio)
        projA2.forEach(function(pa2,i){
          if(i===hi||i===hj)return;
          var pa=sc(pa2);
          ctx.beginPath();ctx.arc(pa[0],pa[1],7,0,Math.PI*2);
          ctx.fillStyle='rgba(200,215,235,0.7)';ctx.fill();
          ctx.strokeStyle='#b0c4de';ctx.lineWidth=1;ctx.stroke();
          ctx.fillStyle='#9ba8b8';ctx.font='bold 9px monospace';ctx.textAlign='center';ctx.textBaseline='middle';
          ctx.fillText(''+(i+1),pa[0],pa[1]);ctx.textBaseline='alphabetic';
        });
        // Nodi B di sfondo (grigio arancio)
        projB2.forEach(function(pb2,i){
          if(!pb2||i===hi||i===hj)return;
          var pb=sc(pb2);
          ctx.beginPath();ctx.arc(pb[0],pb[1],6,0,Math.PI*2);
          ctx.fillStyle='rgba(235,215,185,0.6)';ctx.fill();
          ctx.strokeStyle='#d4b47a';ctx.lineWidth=1;ctx.stroke();
        });

        // Nodi A attivi (blu grandi)
        [hi,hj].forEach(function(idx){
          var pa=sc(projA2[idx]);
          ctx.beginPath();ctx.arc(pa[0],pa[1],15,0,Math.PI*2);
          ctx.fillStyle='rgba(26,95,158,0.07)';ctx.fill();
          ctx.beginPath();ctx.arc(pa[0],pa[1],10,0,Math.PI*2);
          ctx.fillStyle='rgba(26,95,158,0.14)';ctx.fill();
          ctx.strokeStyle='#1a5f9e';ctx.lineWidth=2;ctx.stroke();
          ctx.fillStyle='#1a5f9e';ctx.font='bold 11px monospace';ctx.textAlign='center';ctx.textBaseline='middle';
          ctx.fillText(''+(idx+1),pa[0],pa[1]);ctx.textBaseline='alphabetic';
          ctx.font='bold 9px monospace';ctx.textAlign='center';ctx.fillStyle='#1a5f9e';
          ctx.fillText('A'+(idx+1),pa[0],pa[1]-20);
        });

        // Nodi B attivi (arancio)
        [hi,hj].forEach(function(idx){
          if(!projB2[idx])return;
          var pb=sc(projB2[idx]);
          ctx.beginPath();ctx.arc(pb[0],pb[1],9,0,Math.PI*2);
          ctx.fillStyle='#ba7517';ctx.fill();
          ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();
          ctx.fillStyle='#fff';ctx.font='bold 11px monospace';ctx.textAlign='center';ctx.textBaseline='middle';
          ctx.fillText(''+(idx+1),pb[0],pb[1]);ctx.textBaseline='alphabetic';
          ctx.fillStyle='#ba7517';ctx.font='bold 9px monospace';ctx.textAlign='center';
          ctx.fillText('B'+(idx+1),pb[0],pb[1]+19);
        });

        // Badge Δ in alto a destra del canvas
        if(diff!==null){
          var badge2=(diff>=0?'+':'')+diff.toFixed(1)+'um';
          ctx.font='bold 12px monospace';
          var bw2=ctx.measureText(badge2).width+22;
          var bx2=CW-bw2-8,by2=8;
          ctx.fillStyle=lv2.bg;
          if(ctx.roundRect){ctx.beginPath();ctx.roundRect(bx2,by2,bw2,20,4);ctx.fill();}
          else{ctx.fillRect(bx2,by2,bw2,20);}
          ctx.strokeStyle=lv2.border;ctx.lineWidth=1;ctx.strokeRect(bx2,by2,bw2,20);
          ctx.fillStyle=lv2.col;ctx.textAlign='center';ctx.textBaseline='middle';
          ctx.fillText(badge2,bx2+bw2/2,by2+10);ctx.textBaseline='alphabetic';
        }

        // Legenda
        ctx.beginPath();ctx.arc(pad,CH-12,5,0,Math.PI*2);
        ctx.strokeStyle='#1a5f9e';ctx.lineWidth=1.5;ctx.fillStyle='rgba(26,95,158,0.12)';ctx.fill();ctx.stroke();
        ctx.fillStyle='#374151';ctx.font='9px monospace';ctx.textAlign='left';
        ctx.fillText('Centroide A (riferimento)',pad+9,CH-8);
        ctx.beginPath();ctx.arc(pad+145,CH-12,5,0,Math.PI*2);
        ctx.fillStyle='#ba7517';ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=1.5;ctx.stroke();
        ctx.fillStyle='#374151';ctx.fillText('Centroide B (post-ICP)',pad+154,CH-8);
        ctx.beginPath();ctx.moveTo(pad+290,CH-12);ctx.lineTo(pad+310,CH-12);
        ctx.strokeStyle='rgba(26,95,158,0.8)';ctx.lineWidth=2;ctx.stroke();
        ctx.fillStyle='#374151';ctx.fillText('Dist A',pad+314,CH-8);
        ctx.beginPath();ctx.moveTo(pad+355,CH-12);ctx.lineTo(pad+375,CH-12);
        ctx.strokeStyle='rgba(186,117,23,0.8)';ctx.lineWidth=2;ctx.setLineDash([5,3]);ctx.stroke();ctx.setLineDash([]);
        ctx.fillStyle='#374151';ctx.fillText('Dist B',pad+379,CH-8);
      });

      // Inserisce mappa nel PDF (larghezza full, altezza proporzionale)
      var pdfMapW=cw;
      var pdfMapH=Math.round(mapH2/mapW2*pdfMapW);
      doc.addImage(mapPng2,'PNG',ml,curY2,pdfMapW,pdfMapH);
      curY2+=pdfMapH+8;

      // ── Scheda dati numerici ─────────────────────────────────────
      // Box sfondo colorato
      doc.setFillColor(lvRGB2[0],lvRGB2[1],lvRGB2[2]);
      doc.rect(ml,curY2,cw,36,'F');
      var bdrRGB=hexRGB(lv2.border);
      doc.setDrawColor(bdrRGB[0],bdrRGB[1],bdrRGB[2]);
      doc.setLineWidth(0.5);
      doc.rect(ml,curY2,cw,36,'D');

      // Colonne dati
      var dcol=[ml+4, ml+46, ml+92, ml+138];
      var dcw=42;

      doc.setFont('helvetica','bold');doc.setFontSize(7);setTxt('#374151');
      doc.text('DISTANZA A',dcol[0],curY2+6);
      doc.text('DISTANZA B',dcol[1],curY2+6);
      doc.text('DIFFERENZA',dcol[2],curY2+6);
      doc.text('VALUTAZIONE',dcol[3],curY2+6);

      doc.setFontSize(11);doc.setFont('helvetica','bold');
      setTxt('#1a5f9e');
      doc.text((dA*1000).toFixed(1)+'um',dcol[0],curY2+17);
      doc.setFontSize(8);doc.setFont('helvetica','normal');setTxt('#374151');
      doc.text((dA).toFixed(4)+' mm',dcol[0],curY2+23);

      if(dB!==null){
        doc.setFontSize(11);doc.setFont('helvetica','bold');setTxt('#ba7517');
        doc.text((dB*1000).toFixed(1)+'um',dcol[1],curY2+17);
        doc.setFontSize(8);doc.setFont('helvetica','normal');setTxt('#374151');
        doc.text((dB).toFixed(4)+' mm',dcol[1],curY2+23);

        doc.setFontSize(12);doc.setFont('helvetica','bold');
        doc.setTextColor(lvFG[0],lvFG[1],lvFG[2]);
        doc.text(diffStr,dcol[2],curY2+17);

        // Draw evaluation colored box — spaziatura compatta
        var _evBg=hexRGB(lv2.bg), _evFg=hexRGB(lv2.col);
        doc.setFillColor(_evBg[0],_evBg[1],_evBg[2]);
        doc.rect(dcol[3]-1,curY2+7,W-mr-dcol[3]+1,26,'F');
        // Label valutazione (bold, grande)
        doc.setFontSize(8);doc.setFont('helvetica','bold');
        doc.setTextColor(_evFg[0],_evFg[1],_evFg[2]);
        doc.text(label,dcol[3]+1,curY2+13);
        // Direzione
        doc.setFont('helvetica','normal');doc.setFontSize(6);
        doc.setTextColor(55,65,81);
        var _dir=diff>=0?'B distante da A':'B vicino ad A';
        doc.text(_dir,dcol[3]+1,curY2+19);
        // Soglie su 2 righe ravvicinate
        doc.setFontSize(5.5);
        doc.text('0-50um Ottimo   50-100um Buono',dcol[3]+1,curY2+24);
        doc.text('100-200um Accettabile   >200um Verifica',dcol[3]+1,curY2+29);
      } else {
        doc.setFontSize(9);doc.setFont('helvetica','normal');setTxt('#9ca3af');
        doc.text('Non abbinato',dcol[1],curY2+17);
        doc.text('-',dcol[2],curY2+17);
        doc.text('Centroide B assente',dcol[3],curY2+17);
      }

      curY2+=44;

      // ── Tutte le altre coppie a confronto (mini-tabella riassuntiva) ──
      if(pairsD.length>1){
        doc.setFont('helvetica','bold');doc.setFontSize(7);setTxt('#374151');
        doc.text('Confronto con le altre coppie:',ml,curY2+4);
        curY2+=7;

        // Mini header
        setFill('#e2e8f0');doc.rect(ml,curY2,cw,5,'F');
        doc.setFont('helvetica','bold');doc.setFontSize(6);setTxt('#374151');
        doc.text('Coppia',ml+1,curY2+3.5);
        doc.text('A (um)',ml+28,curY2+3.5);
        doc.text('B (um)',ml+58,curY2+3.5);
        doc.text('Delta',ml+88,curY2+3.5);
        doc.text('Note',ml+118,curY2+3.5);
        curY2+=5;

        pairsD.forEach(function(ij2,k2){
          var isActive=ij2[0]===hi&&ij2[1]===hj;
          var dA2=dist3pdf(ctA2[ij2[0]],ctA2[ij2[1]]);
          var dB2=(ctB2[ij2[0]]&&ctB2[ij2[1]])?dist3pdf(ctB2[ij2[0]],ctB2[ij2[1]]):null;
          var diff2=dB2!==null?(dB2-dA2)*1000:null;
          var lv3=diff2!==null?diffColorPdf(diff2):{col:'#9ca3af',bg:'#f3f4f6',border:'#e5e7eb'};

          if(isActive){
            setFill('#dbeafe');doc.rect(ml,curY2,cw,5,'F');
          } else if(k2%2===0){
            setFill('#f8fafc');doc.rect(ml,curY2,cw,5,'F');
          }
          doc.setDrawColor(220,230,240);doc.setLineWidth(0.15);
          doc.line(ml,curY2+5,ml+cw,curY2+5);

          if(isActive){
            doc.setFont('helvetica','bold');doc.setFontSize(6);setTxt('#1a5f9e');
            doc.text('> #'+(ij2[0]+1)+'-#'+(ij2[1]+1)+' (questa)',ml+1,curY2+3.5);
          } else {
            doc.setFont('helvetica','normal');doc.setFontSize(6);setTxt('#374151');
            doc.text('#'+(ij2[0]+1)+'-#'+(ij2[1]+1),ml+1,curY2+3.5);
          }

          setTxt('#1a5f9e');doc.setFont('helvetica',isActive?'bold':'normal');
          doc.text((dA2*1000).toFixed(1),ml+28,curY2+3.5);

          if(dB2!==null){
            setTxt('#ba7517');
            doc.text((dB2*1000).toFixed(1),ml+58,curY2+3.5);
            var lv3RGB=hexRGB(lv3.bg),lv3FG=hexRGB(lv3.col);
            doc.setFillColor(lv3RGB[0],lv3RGB[1],lv3RGB[2]);
            doc.rect(ml+82,curY2+0.5,22,4,'F');
            doc.setTextColor(lv3FG[0],lv3FG[1],lv3FG[2]);
            doc.setFont('helvetica','bold');
            doc.text((diff2>=0?'+':'')+diff2.toFixed(1),ml+83,curY2+3.5);
            setTxt('#374151');doc.setFont('helvetica','normal');
            var lb2=Math.abs(diff2)<50?'Ottimo':Math.abs(diff2)<100?'Buono':Math.abs(diff2)<200?'Accept.':'Verifica';
            doc.text(lb2,ml+118,curY2+3.5);
          } else {
            setTxt('#9ca3af');doc.text('-',ml+58,curY2+3.5);doc.text('-',ml+88,curY2+3.5);doc.text('N/A',ml+118,curY2+3.5);
          }
          curY2+=5;
        });
      }

      // ── Footer pagina ────────────────────────────────────────────
      doc.setFont('helvetica','normal');doc.setFontSize(7);setTxt('#7A90A4');
      doc.line(ml,H-8,W-mr,H-8);
      doc.text('Syntesis-ICP · Distanza inter-centroide #'+(hi+1)+'-#'+(hj+1),ml,H-4);
      var totPages=p.pairs.length+1+nTotal;
      doc.text('Pag. '+(p.pairs.length+1+pageIdx+1)+' / '+totPages,W-mr,H-4,{align:'right'});
    });
  }

  // ── Save ────────────────────────────────────────────────────────────
  var fname='PrecisionReport_v7_'+new Date().toISOString().slice(0,10)+'.pdf';
  doc.save(fname);
}


// ── paintViewCylShaded - renders ONE cylinder, shaded with lighting ──────
function paintViewCyl(cv, triA_cyl, triB_cyl, ax1, ax2, axD, title, cylIdx){
  if(!cv)return;
  var ctx=cv.getContext('2d'), W=cv.width, H=cv.height;
  var pd=8, th=22;
  var vw=W-pd*2, vh=H-pd*2-th;

  // Background
  ctx.clearRect(0,0,W,H);
  var bg=ctx.createLinearGradient(0,0,0,H);
  bg.addColorStop(0,'#f0f5fa'); bg.addColorStop(1,'#e8eff8');
  ctx.fillStyle=bg; ctx.fillRect(0,0,W,H);

  // Viewport
  ctx.fillStyle='#ffffff'; ctx.fillRect(pd,pd,vw,vh);
  ctx.strokeStyle='#c8d8e8'; ctx.lineWidth=1.5; ctx.strokeRect(pd,pd,vw,vh);

  var allT=(triA_cyl||[]).concat(triB_cyl||[]);
  if(!allT.length){
    ctx.fillStyle='rgba(0,50,100,0.7)'; ctx.fillRect(pd,pd+vh,vw,th);
    ctx.fillStyle='#fff'; ctx.font='bold 12px sans-serif';
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(title, W/2, pd+vh+th/2); return;
  }

  // Compute tight bounds from THIS cylinder only
  var mn1=Infinity,mx1=-Infinity,mn2=Infinity,mx2=-Infinity;
  allT.forEach(function(t){t.forEach(function(v){
    if(v[ax1]<mn1)mn1=v[ax1]; if(v[ax1]>mx1)mx1=v[ax1];
    if(v[ax2]<mn2)mn2=v[ax2]; if(v[ax2]>mx2)mx2=v[ax2];
  });});
  var rg=Math.max(mx1-mn1,mx2-mn2)||1;
  var margin=rg*0.15; // tight zoom
  var c1=(mn1+mx1)/2, c2=(mn2+mx2)/2;
  var scale=Math.min(vw,vh)/(rg+margin*2);

  function px(v){
    return [
      pd+(v[ax1]-(c1-rg/2-margin))*scale + (vw-(rg+margin*2)*scale)/2,
      pd+vh-(v[ax2]-(c2-rg/2-margin))*scale - (vh-(rg+margin*2)*scale)/2
    ];
  }

  // Lighting: define a light direction for pseudo-3D shading
  // Light from top-left-front: normalized vector
  var lightDir=[0.4,0.6,0.7]; // in 3D space
  var lLen=Math.sqrt(lightDir[0]*lightDir[0]+lightDir[1]*lightDir[1]+lightDir[2]*lightDir[2]);
  lightDir=[lightDir[0]/lLen,lightDir[1]/lLen,lightDir[2]/lLen];

  function faceNormal(t){
    // Cross product of two edges
    var ax=t[1][0]-t[0][0], ay=t[1][1]-t[0][1], az=t[1][2]-t[0][2];
    var bx=t[2][0]-t[0][0], by=t[2][1]-t[0][1], bz=t[2][2]-t[0][2];
    var nx=ay*bz-az*by, ny=az*bx-ax*bz, nz=ax*by-ay*bx;
    var len=Math.sqrt(nx*nx+ny*ny+nz*nz)||1;
    return[nx/len,ny/len,nz/len];
  }

  function shade(t, baseR, baseG, baseB){
    var n=faceNormal(t);
    var diff=Math.max(0, n[0]*lightDir[0]+n[1]*lightDir[1]+n[2]*lightDir[2]);
    var ambient=0.35, diffuse=0.65;
    var intensity=ambient+diffuse*diff;
    // Fresnel-like: darker edges
    var r=Math.min(255,Math.round(baseR*intensity));
    var g=Math.min(255,Math.round(baseG*intensity));
    var b=Math.min(255,Math.round(baseB*intensity));
    return 'rgb('+r+','+g+','+b+')';
  }

  // Depth sort all triangles together (painter's algorithm)
  function prepareTris(tris, br, bg2, bb){
    return tris.map(function(t){
      var d=(t[0][axD]+t[1][axD]+t[2][axD])/3;
      return {t:t, d:d, r:br, g:bg2, b:bb};
    });
  }

  var allItems=[];
  if(triA_cyl&&triA_cyl.length)
    allItems=allItems.concat(prepareTris(triA_cyl,  38,120,200));  // blue - reference
  if(triB_cyl&&triB_cyl.length)
    allItems=allItems.concat(prepareTris(triB_cyl, 220,130, 30));  // amber - measured

  // Sort back-to-front
  allItems.sort(function(a,b){return a.d-b.d;});

  // Draw shaded triangles
  allItems.forEach(function(item){
    var t=item.t;
    var p0=px(t[0]),p1=px(t[1]),p2=px(t[2]);
    var col=shade(t, item.r, item.g, item.b);
    ctx.beginPath();
    ctx.moveTo(p0[0],p0[1]);ctx.lineTo(p1[0],p1[1]);ctx.lineTo(p2[0],p2[1]);
    ctx.closePath();
    ctx.fillStyle=col;
    ctx.fill();
    // Very subtle edge (only for definition, not wireframe look)
    ctx.strokeStyle='rgba(0,0,0,0.04)';
    ctx.lineWidth=0.2;
    ctx.stroke();
  });

  // Centroid markers
  var pair=window._LR&&window._LR.pairs[cylIdx];
  if(pair&&pair.a){
    var pa=px(pair.a);
    ctx.beginPath();ctx.arc(pa[0],pa[1],9,0,Math.PI*2);
    ctx.fillStyle='rgba(0,101,179,0.2)';ctx.fill();
    ctx.beginPath();ctx.arc(pa[0],pa[1],5,0,Math.PI*2);
    ctx.fillStyle='#0065B3';ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();
    ctx.fillStyle='#fff';ctx.font='bold 10px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText('A',pa[0],pa[1]);ctx.textBaseline='alphabetic';
  }
  if(pair&&pair.b){
    var pb=px(pair.b);
    var d3um=pair.d3!==null?Math.round(pair.d3*1000):0;
    var col2=clinLevel(d3um).col;
    ctx.beginPath();ctx.arc(pb[0],pb[1],9,0,Math.PI*2);
    ctx.fillStyle=col2+'33';ctx.fill();
    ctx.beginPath();ctx.arc(pb[0],pb[1],5,0,Math.PI*2);
    ctx.fillStyle=col2;ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();
    ctx.fillStyle='#fff';ctx.font='bold 10px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText('B',pb[0],pb[1]);ctx.textBaseline='alphabetic';
    // Deviation line A→B
    if(pair.a){
      var pa2=px(pair.a);
      ctx.beginPath();ctx.moveTo(pa2[0],pa2[1]);ctx.lineTo(pb[0],pb[1]);
      ctx.strokeStyle=col2;ctx.lineWidth=1.5;ctx.setLineDash([3,3]);ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // Legend dots
  ctx.fillStyle='rgba(38,120,200,0.9)';ctx.beginPath();ctx.arc(pd+8,pd+vh-12,4,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#1a3a5c';ctx.font='bold 9px sans-serif';ctx.textAlign='left';
  ctx.fillText('A - Riferimento',pd+16,pd+vh-9);
  ctx.fillStyle='rgba(220,130,30,0.9)';ctx.beginPath();ctx.arc(pd+8,pd+vh-3,4,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#5c3010';ctx.fillText('B - Misurato',pd+16,pd+vh);

  // Title bar
  ctx.fillStyle='rgba(0,50,100,0.82)'; ctx.fillRect(pd,pd+vh,vw,th);
  ctx.fillStyle='#fff'; ctx.font='bold 12px sans-serif';
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(title, W/2, pd+vh+th/2); ctx.textBaseline='alphabetic';
}

window.C_pdf = pdf;
