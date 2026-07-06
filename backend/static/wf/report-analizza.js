/*
 * wf/report-analizza.js — REPORT PDF del workflow Analizza (Fase 6c modularizzazione, 8.90.0).
 * Terzo file estratto in wf/ (dopo fresabilita.js e tree.js).
 *
 * CONTRATTO: 4 function declaration del report MUA PDF 6 pagine (§REPORT-MUA-PDF): cattura viste 3D
 * multi-angolo, generazione PDF con jsPDF (copertina, analisi angolare, criticità, disegni tecnici,
 * firma), raccolta dati da muaObjects, raccomandazioni testuali. Nomi bare globali invariati.
 * Estrazione "functions-only" (pattern 6a/6b): nessuno stato proprio; leggono muaObjects/scanMesh/
 * renderer/scene/camera/window.SYN/costanti cliniche (MAX_COUPLE_DIVERGENCE/MAX_MILLING_ANGLE/
 * MUA_CONE_HALF_ANGLE) e window.jspdf.jsPDF SOLO a CALL-TIME (click su #btnAnalReport, post-analisi).
 *
 * RESTANO nel monolite (per scelta): il banner §REPORT-MUA-PDF (check_anchors), addCornerLogo
 * (annidata in altra fn), e l'INTERO report MISURARE (misICP_generateReport, §MISURARE-PDF /
 * §CERTIFICATO-TARATURA) + la §REPORT-PIPELINE condivisa — separati da mis, che è fase 6f.
 * addFooter/box/text/placeView sono ANNIDATE dentro analReport_generate e si muovono con lei.
 *
 * CARICAMENTO: <script src> classico NON-strict in testa (dopo wf/tree.js), PRIMA del MAIN. Le fn
 * si limitano a essere DEFINITE a parse-time. VINCOLO: analReport_generate è chiamata dall'handler
 * inline onclick="analReport_generate()" su #btnAnalReport -> deve restare bare-global.
 * GATE: scripts/gate/report/gate.mjs (md5 verbatim per fn + esposizione + residuo) + HARNESS
 * SHIM jsPDF (scripts/gate/report/harness.html): stubba window.jspdf.jsPDF con un proxy che REGISTRA
 * la sequenza di chiamate PDF, stubba captureViews + muaObjects, esegue analReport_generate e verifica
 * che la pipeline giri e produca una sequenza stabile (il PDF binario non è confrontabile; la
 * sequenza di API-call sì — essendo l'estrazione VERBATIM, old==new per costruzione).
 */

// Cattura snapshot del viewer Three.js da angolazioni multiple.
// Restituisce {occlusale, vestibolare, linguale, prospettica} in dataURL PNG.
// Salva e ripristina lo stato della camera.
function analReport_captureViews(){
  if(!scanMesh || !renderer || !scene || !camera){
    return null;
  }

  // Salva stato camera attuale
  var saved = {
    pos: camera.position.clone(),
    target: controls.target.clone(),
    up: camera.up.clone()
  };

  // Bounding sphere della scansione per centrare le viste
  var bs = scanMesh.geometry.boundingSphere;
  var c = bs.center, r = bs.radius;

  // Helper: imposta camera, renderizza, cattura PNG
  function snap(eye, tgt, upVec){
    camera.position.set(eye.x, eye.y, eye.z);
    controls.target.set(tgt.x, tgt.y, tgt.z);
    camera.up.set(upVec.x, upVec.y, upVec.z);
    camera.lookAt(tgt);
    controls.update();
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL('image/png');
  }

  var views = {};
  try {
    // Calcolo asse medio del gruppo principale (i MUA accoppiati).
    // Stesso algoritmo del calcMeanAxis: media vettoriale degli axisDir con segno coerente, normalizzato.
    var alignedMuasInit = muaObjects.filter(function(m){ return m.aligned; });
    var meanAxis = null, meanCenter = null;
    if(alignedMuasInit.length >= 2){
      // Allineo segni rispetto al primo
      var ref = alignedMuasInit[0].axisDir.clone();
      var sumAxis = new THREE.Vector3(0,0,0);
      var sumCenter = new THREE.Vector3(0,0,0);
      alignedMuasInit.forEach(function(m){
        var a = m.axisDir.clone();
        if(a.dot(ref) < 0) a.negate();
        sumAxis.add(a);
        sumCenter.add(m.position);
      });
      meanAxis = sumAxis.divideScalar(alignedMuasInit.length).normalize();
      meanCenter = sumCenter.divideScalar(alignedMuasInit.length);
    }
    
    // VISTA OCCLUSALE: camera POSIZIONATA LUNGO LASSE MEDIO, guarda PERPENDICOLARMENTE al piano dei MUA.
    // Camera = meanCenter + meanAxis * distanza, lookAt = meanCenter.
    // Up vector: scelgo un vettore perpendicolare allasse medio per orientare anteriore/posteriore.
    if(meanAxis && meanCenter){
      var camDist = r * 3.5;
      var camPos = {
        x: meanCenter.x + meanAxis.x * camDist,
        y: meanCenter.y + meanAxis.y * camDist,
        z: meanCenter.z + meanAxis.z * camDist
      };
      var target = {x: meanCenter.x, y: meanCenter.y, z: meanCenter.z};
      // Up: scelgo lasse globale piu perpendicolare allasse medio.
      // Se lasse medio e quasi parallelo a Y, uso Z. Altrimenti uso Y.
      var dotY = Math.abs(meanAxis.y);
      var upVec;
      if(dotY > 0.9){
        // Asse medio quasi verticale: up = -Z (anteriore in alto come prima)
        upVec = {x:0, y:0, z:-1};
      } else {
        // Asse medio inclinato: up = Y (standard)
        upVec = {x:0, y:1, z:0};
      }
      // Rendo up perpendicolare allasse medio (proietto): up_perp = up - (up . meanAxis) * meanAxis
      var upRaw = new THREE.Vector3(upVec.x, upVec.y, upVec.z);
      var dot = upRaw.dot(meanAxis);
      upRaw.sub(meanAxis.clone().multiplyScalar(dot)).normalize();
      upVec = {x: upRaw.x, y: upRaw.y, z: upRaw.z};
      
      views.occlusale = snap(camPos, target, upVec);
    } else {
      // Fallback: occlusale Y-up come prima
      views.occlusale = snap(
        {x: c.x, y: c.y + r*3.5, z: c.z},
        {x: c.x, y: c.y, z: c.z},
        {x: 0, y: 0, z: -1}
      );
    }

    // Calcolo proiezioni 2D dei MUA in vista occlusale (per overlay label vettoriali nel PDF).
    // Position.project(camera) restituisce coordinate normalizzate (-1..1) sul canvas.
    // Salviamo NDC + canvas-fraction per ogni MUA accoppiato.
    views.occlusalProjections = [];
    var alignedMuas = muaObjects.filter(function(m){ return m.aligned; });
    alignedMuas.forEach(function(m){
      // Position.project() richiede che la camera sia ancora in posizione occlusale.
      // Lo siamo, perche snap() lha appena impostata.
      var proj = m.position.clone().project(camera);
      // NDC -> canvas-fraction (0..1, top-left origin)
      var fx = (proj.x + 1) / 2;
      var fy = (-proj.y + 1) / 2;
      views.occlusalProjections.push({
        num: m.num,
        groupId: m.groupId || 0,
        divergence: m.divergence,
        rigorousOK: m.rigorousOK !== false,
        millingOK: m.millingOK !== false,
        fx: fx, // frazione X (0=sinistra, 1=destra)
        fy: fy  // frazione Y (0=alto, 1=basso)
      });
    });

    // VISTA VESTIBOLARE: camera davanti (Z positivo), guarda dietro
    // up = +Y standard
    views.vestibolare = snap(
      {x: c.x, y: c.y + r*0.3, z: c.z + r*3.0},
      {x: c.x, y: c.y, z: c.z},
      {x: 0, y: 1, z: 0}
    );

    // VISTA LINGUALE: camera dietro (Z negativo), guarda davanti
    views.linguale = snap(
      {x: c.x, y: c.y + r*0.3, z: c.z - r*3.0},
      {x: c.x, y: c.y, z: c.z},
      {x: 0, y: 1, z: 0}
    );

    // VISTA PROSPETTICA 3/4 (la stessa posizione di reset)
    views.prospettica = snap(
      {x: c.x + r*1.5, y: c.y + r, z: c.z + r*1.5},
      {x: c.x, y: c.y, z: c.z},
      {x: 0, y: 1, z: 0}
    );
  } catch(err){
    console.error('[analReport] cattura viste fallita:', err);
  } finally {
    // Ripristina sempre stato camera
    camera.position.copy(saved.pos);
    controls.target.copy(saved.target);
    camera.up.copy(saved.up);
    camera.lookAt(saved.target);
    controls.update();
    renderer.render(scene, camera);
  }

  return views;
}

function analReport_generate(){
  // Verifica jsPDF caricato
  if(!window.jspdf || !window.jspdf.jsPDF){
    alert('Errore: libreria PDF non caricata. Ricarica la pagina e riprova.');
    return;
  }
  // Verifica almeno 2 MUA accoppiati
  var aligned = muaObjects.filter(function(m){ return m.aligned; });
  if(aligned.length < 2){
    alert('Servono almeno 2 MUA accoppiati per generare il report.');
    return;
  }

  // Cattura snapshot 3D dal viewer Three.js prima di generare il PDF
  // (la cattura modifica temporaneamente la camera, poi la ripristina)
  showStatus('Cattura viste 3D in corso...');
  var views = analReport_captureViews();
  showStatus('Generazione PDF...');

  // Raccolta dati
  var data = analReport_collectData();

  // Crea PDF
  var jsPDF = window.jspdf.jsPDF;
  var doc = new jsPDF({unit:'mm', format:'a4', compress:true});

  // ── Costanti grafiche ───────────────────────────────────────────
  var BLUE = [0,101,179];           // var(--blue) #0065B3
  var DARK = [15,25,35];            // var(--dark)
  var GRAY = [122,144,164];         // var(--gray)
  var GREEN = [91,176,76];          // mario-green
  var RED = [209,58,53];            // mario-red
  var ORANGE = [232,144,66];        // mario-orange
  var GOLD = [245,158,11];          // gold
  var LIGHT = [240,245,250];        // pearl
  var BORDER = [214,228,240];       // border
  var WHITE = [255,255,255];

  var PAGE_W = 210, PAGE_H = 297;
  var MARGIN = 15;

  // Helper: rettangolo con bordo
  function box(x,y,w,h,fill,stroke){
    if(fill){doc.setFillColor.apply(doc,fill); doc.rect(x,y,w,h,'F');}
    if(stroke){doc.setDrawColor.apply(doc,stroke); doc.setLineWidth(0.3); doc.rect(x,y,w,h);}
  }
  function text(s,x,y,opt){
    opt = opt || {};
    doc.setFont(opt.font || 'helvetica', opt.style || 'normal');
    doc.setFontSize(opt.size || 10);
    doc.setTextColor.apply(doc, opt.color || DARK);
    doc.text(s, x, y, {align: opt.align || 'left'});
  }
  // Footer comune a tutte le pagine
  function addFooter(pageNum, totalPages){
    doc.setDrawColor.apply(doc, BORDER);
    doc.setLineWidth(0.2);
    doc.line(MARGIN, PAGE_H-12, PAGE_W-MARGIN, PAGE_H-12);
    text('Synthesis-ICP - Report Analizza MUA', MARGIN, PAGE_H-7, {size:8, color:GRAY, font:'helvetica'});
    text(data.caseCode + ' - ' + data.dateStr, PAGE_W/2, PAGE_H-7, {size:8, color:GRAY, align:'center'});
    text('Pag. '+pageNum+' / '+totalPages, PAGE_W-MARGIN, PAGE_H-7, {size:8, color:GRAY, align:'right'});
  }

  // ╔══════════════════════════════════════════════════════════════╗
  // ║ PAGINA 1: COPERTINA                                          ║
  // ╚══════════════════════════════════════════════════════════════╝
  // Banda blu in alto con titolo
  box(0, 0, PAGE_W, 50, BLUE);
  text('REPORT ANALIZZA MUA', PAGE_W/2, 25, {size:22, style:'bold', color:WHITE, align:'center'});
  text('Analisi angolare e fresabilita protesica', PAGE_W/2, 35, {size:11, color:WHITE, align:'center'});
  text('Synthesis-ICP', PAGE_W/2, 43, {size:9, color:WHITE, align:'center'});

  // Box info caso
  var y = 65;
  text('CASO', MARGIN, y, {size:9, color:GRAY, style:'bold'});
  text(data.caseCode, MARGIN, y+8, {size:18, style:'bold'});
  text('DATA', PAGE_W/2+10, y, {size:9, color:GRAY, style:'bold'});
  text(data.dateStr, PAGE_W/2+10, y+8, {size:14});
  y += 20;

  // Linea separatrice
  doc.setDrawColor.apply(doc, BORDER);
  doc.setLineWidth(0.4);
  doc.line(MARGIN, y, PAGE_W-MARGIN, y);
  y += 12;

  // Score grandi: Fresabilita + Possibilita protesica
  text('VALUTAZIONE COMPLESSIVA', MARGIN, y, {size:10, color:GRAY, style:'bold'});
  y += 8;

  // Box Fresabilita
  var bw = (PAGE_W - 2*MARGIN - 8) / 2;
  var bh = 55;
  box(MARGIN, y, bw, bh, LIGHT, BORDER);
  text('FRESABILITA', MARGIN+5, y+10, {size:10, style:'bold', color:GRAY});
  // Score: % di MUA che rispettano millingOK
  var fresValue = data.scores.fresabilita;
  var fresColor = fresValue >= 80 ? GREEN : fresValue >= 60 ? GOLD : RED;
  text(String(fresValue), MARGIN+bw/2, y+30, {size:32, style:'bold', color:fresColor, align:'center'});
  text('/ 100', MARGIN+bw/2+18, y+30, {size:11, color:GRAY, align:'left'});
  text(data.scores.fresabilitaLabel, MARGIN+bw/2, y+45, {size:9, color:fresColor, align:'center', style:'bold'});

  // Box Possibilita protesica
  box(MARGIN+bw+8, y, bw, bh, LIGHT, BORDER);
  text('POSSIBILITA PROTESICA', MARGIN+bw+13, y+10, {size:10, style:'bold', color:GRAY});
  var protValue = data.scores.protesica;
  var protColor = protValue >= 80 ? GREEN : protValue >= 60 ? GOLD : RED;
  text(String(protValue), MARGIN+bw+8+bw/2, y+30, {size:32, style:'bold', color:protColor, align:'center'});
  text('/ 100', MARGIN+bw+8+bw/2+18, y+30, {size:11, color:GRAY, align:'left'});
  text(data.scores.protesicaLabel, MARGIN+bw+8+bw/2, y+45, {size:9, color:protColor, align:'center', style:'bold'});

  y += bh + 12;

  // Riepilogo numerico
  text('RIEPILOGO NUMERICO', MARGIN, y, {size:10, color:GRAY, style:'bold'});
  y += 8;
  var summaryRows = [
    ['MUA totali', String(data.muaCount)],
    ['Gruppi', String(data.groupCount) + (data.groupCount > 1 ? ' (multipli)' : ' (singolo)')],
    ['Macchina selezionata', data.machineName || '--'],
    ['Max divergenza vs asse medio', data.maxDiv != null ? data.maxDiv.toFixed(1) + ' deg' : '--'],
    ['Media divergenza', data.avgDiv != null ? data.avgDiv.toFixed(1) + ' deg' : '--'],
    ['MUA fuori cono 20 deg', String(data.criticita.coneOutCount)],
    ['Coppie con sottosquadri', String(data.criticita.undercutPairs)],
    ['MUA non fresabili', String(data.criticita.millingOutCount)]
  ];
  summaryRows.forEach(function(r, i){
    var ry = y + i*7;
    if(i % 2 === 0){ box(MARGIN, ry-4, PAGE_W-2*MARGIN, 7, LIGHT); }
    text(r[0], MARGIN+3, ry, {size:10});
    text(r[1], PAGE_W-MARGIN-3, ry, {size:10, style:'bold', align:'right'});
  });
  y += summaryRows.length * 7 + 8;

  // Nota in fondo copertina
  text('Nota: questo report e la prima versione (Blocco 6a). Sezioni con dati', MARGIN, PAGE_H-25, {size:8, color:GRAY});
  text('parziali o placeholder verranno completate nelle iterazioni successive.', MARGIN, PAGE_H-21, {size:8, color:GRAY});

  addFooter(1, 7);

  // ╔══════════════════════════════════════════════════════════════╗
  // ║ PAGINA 2: ANALISI ANGOLARE (landscape)                       ║
  // ║ Tre zone: Cono di lavoro 20deg + Matrice coppie + Mappa XY   ║
  // ║ Tutti i dati sono dinamici dal caso reale.                   ║
  // ╚══════════════════════════════════════════════════════════════╝
  doc.addPage('a4', 'landscape');
  // Landscape: PAGE_W=297, PAGE_H=210
  var L_W = 297, L_H = 210, L_M = 10;

  // ── Header ──
  text('Synthesis-ICP', L_M, 11, {size:11, style:'bold', color:BLUE});
  text('REPORT ANALIZZA MUA  |  ' + data.caseCode, L_W/2, 11, {size:9, color:DARK, align:'center', style:'bold'});
  text(data.dateStr, L_W-L_M, 11, {size:9, color:GRAY, align:'right'});
  doc.setDrawColor.apply(doc, BORDER); doc.setLineWidth(0.3);
  doc.line(L_M, 14, L_W-L_M, 14);

  text('ANALISI ANGOLARE DEL CASO', L_M, 22, {size:14, style:'bold', color:DARK});
  text('Cono di lavoro, matrice coppie, mappa posizioni', L_M, 27, {size:9, color:GRAY});

  // ── ZONA 1 (sx-alto): CONO DI LAVORO 20° con tutti i MUA ──
  var z1X = L_M, z1Y = 32, z1W = 130, z1H = 95;
  doc.setDrawColor.apply(doc, BORDER); doc.setLineWidth(0.4);
  doc.setFillColor(252,253,254); doc.rect(z1X, z1Y, z1W, z1H, 'FD');
  
  // Numero cerchio + titolo
  doc.setFillColor.apply(doc, BLUE); doc.circle(z1X+5, z1Y+5, 3, 'F');
  doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.setFontSize(9);
  doc.text('1', z1X+5, z1Y+6.5, {align:'center'});
  text('CONO DI LAVORO 20° - DENTRO/FUORI', z1X+11, z1Y+7, {size:10, style:'bold', color:DARK});
  text('Asse medio del gruppo come riferimento', z1X+11, z1Y+11, {size:7, color:GRAY});

  // Cono di lavoro centrato (vertice in basso, apertura in alto)
  // Centro logico del cono
  var coneApexX = z1X + z1W/2;
  var coneApexY = z1Y + z1H - 18;
  var coneH = 60;
  var coneApertura = 20; // semiangolo gradi
  var coneTopHalfW = coneH * Math.tan(coneApertura * Math.PI/180);
  
  // Riempimento cono (azzurro chiaro semitrasparente simulato con colore tenue)
  doc.setFillColor(225, 238, 250);
  doc.lines([
    [coneTopHalfW, -coneH],
    [-2*coneTopHalfW, 0],
    [coneTopHalfW, coneH]
  ], coneApexX, coneApexY, [1,1], 'F');
  
  // Bordi cono (tratteggiati)
  doc.setDrawColor.apply(doc, BLUE); doc.setLineWidth(0.5);
  doc.setLineDashPattern([1.2,1.2], 0);
  doc.line(coneApexX, coneApexY, coneApexX - coneTopHalfW, coneApexY - coneH);
  doc.line(coneApexX, coneApexY, coneApexX + coneTopHalfW, coneApexY - coneH);
  // Arco di apertura in alto
  doc.line(coneApexX - coneTopHalfW, coneApexY - coneH, coneApexX + coneTopHalfW, coneApexY - coneH);
  doc.setLineDashPattern([], 0);
  
  // Asse medio (linea continua rossa al centro)
  doc.setDrawColor.apply(doc, RED); doc.setLineWidth(1.0);
  doc.setLineDashPattern([1.5,1.5], 0);
  doc.line(coneApexX, coneApexY, coneApexX, coneApexY - coneH - 5);
  doc.setLineDashPattern([], 0);
  // Freccia in cima asse medio
  doc.setFillColor.apply(doc, RED);
  doc.lines([[1.5, 3], [-3, 0], [1.5, -3]], coneApexX-1.5, coneApexY-coneH-5, [1,1], 'F');
  text('ASSE MEDIO', coneApexX+3, coneApexY-coneH-3, {size:7, color:RED, style:'bold'});
  
  // Etichette ai bordi del cono
  text('20°', coneApexX - coneTopHalfW - 7, coneApexY - coneH/2, {size:7, color:BLUE, style:'bold'});
  text('20°', coneApexX + coneTopHalfW + 2, coneApexY - coneH/2, {size:7, color:BLUE, style:'bold'});
  
  // Disegno ogni MUA come freccia inclinata, partendo dal vertice del cono
  // Spaziatura orizzontale per evitare sovrapposizioni: distribuisco i MUA
  var muasZ1 = data.muaTable.slice(0, 6); // max 6 MUA per leggibilita
  muasZ1.forEach(function(m, i){
    var divDeg = m.divMedio || 0;
    // Direzione: alterno sx/dx in base allindice per visibilita
    var direction = (i % 2 === 0) ? -1 : 1;
    // Pero, se MUA fuori cono (>20°), forzo il segno per uscire
    if(Math.abs(divDeg) > 20 && i < 2) direction = (i === 0 ? -1 : 1);
    
    // Lunghezza freccia MUA = stessa altezza cono
    var muaLen = coneH;
    var muaAngRad = divDeg * Math.PI / 180 * direction;
    var muaTopX = coneApexX + Math.sin(muaAngRad) * muaLen;
    var muaTopY = coneApexY - Math.cos(muaAngRad) * muaLen;
    
    // Colore in base a stato
    var muaCol = m.coneOK ? GREEN : RED;
    if(divDeg > 17 && divDeg <= 20) muaCol = GOLD; // borderline
    
    // Linea MUA
    doc.setDrawColor.apply(doc, muaCol); doc.setLineWidth(1.2);
    doc.line(coneApexX, coneApexY, muaTopX, muaTopY);
    // Cerchietto in cima
    doc.setFillColor.apply(doc, muaCol);
    doc.circle(muaTopX, muaTopY, 1.5, 'F');
    
    // Etichetta MUA con angolo
    var labelOffset = direction === -1 ? -2 : 2;
    var labelAlign = direction === -1 ? 'right' : 'left';
    text('#' + m.num, muaTopX + labelOffset, muaTopY - 1, {size:7, style:'bold', color:DARK, align:labelAlign});
    text(divDeg.toFixed(1) + '°', muaTopX + labelOffset, muaTopY + 3, {size:6, color:muaCol, style:'bold', align:labelAlign});
  });
  
  // Vertice cono (punto)
  doc.setFillColor.apply(doc, DARK); doc.circle(coneApexX, coneApexY, 1, 'F');
  
  // Legenda in basso
  var legZ1Y = z1Y + z1H - 8;
  doc.setFillColor.apply(doc, GREEN); doc.circle(z1X+8, legZ1Y, 1.5, 'F');
  text('DENTRO 20°', z1X+11, legZ1Y+1, {size:6, color:DARK});
  doc.setFillColor.apply(doc, GOLD); doc.circle(z1X+38, legZ1Y, 1.5, 'F');
  text('BORDERLINE 17-20°', z1X+41, legZ1Y+1, {size:6, color:DARK});
  doc.setFillColor.apply(doc, RED); doc.circle(z1X+82, legZ1Y, 1.5, 'F');
  text('FUORI > 20°', z1X+85, legZ1Y+1, {size:6, color:DARK});

  // ── ZONA 2 (dx-alto): MATRICE COPPIE MUA ──
  var z2X = L_M + z1W + 4, z2Y = 32, z2W = L_W - L_M - z2X, z2H = 95;
  doc.setDrawColor.apply(doc, BORDER); doc.setLineWidth(0.4);
  doc.setFillColor(252,253,254); doc.rect(z2X, z2Y, z2W, z2H, 'FD');
  
  // Numero + titolo
  doc.setFillColor.apply(doc, BLUE); doc.circle(z2X+5, z2Y+5, 3, 'F');
  doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.setFontSize(9);
  doc.text('2', z2X+5, z2Y+6.5, {align:'center'});
  text('MATRICE COPPIE MUA', z2X+11, z2Y+7, {size:10, style:'bold', color:DARK});
  text('Divergenza tra ogni coppia - rosso = sottosquadro reciproco', z2X+11, z2Y+11, {size:7, color:GRAY});

  // Costruisco matrice N×N
  var N = data.muaTable.length;
  if(N >= 2){
    // Calcolo divergenze coppia
    var coppieMatrix = [];
    for(var i=0; i<N; i++){
      coppieMatrix[i] = [];
      for(var j=0; j<N; j++){
        if(i === j){ coppieMatrix[i][j] = null; continue; }
        // Calcola angolo tra axisDir di m[i] e m[j]
        var ai = aligned[i].axisDir;
        var aj = aligned[j].axisDir;
        var dot = ai.x*aj.x + ai.y*aj.y + ai.z*aj.z;
        var ang = Math.acos(Math.min(1, Math.abs(dot))) * 180/Math.PI;
        coppieMatrix[i][j] = ang;
      }
    }
    
    // Cella matrice: cellSize varia in base a N
    var cellSize = Math.min(15, (z2H - 25) / (N+1));
    var cellW = Math.min(cellSize, (z2W - 25) / (N+1));
    var matX = z2X + (z2W - cellW*(N+1) - 8) / 2 + 8;
    var matY = z2Y + 18;
    
    // Header riga (in alto): MUA #1, #2, ...
    doc.setFillColor.apply(doc, BLUE);
    doc.rect(matX, matY, cellW, cellW, 'F');
    text('MUA', matX+cellW/2, matY+cellW/2+1, {size:6, color:WHITE, style:'bold', align:'center'});
    
    for(var j=0; j<N; j++){
      doc.setFillColor.apply(doc, BLUE);
      doc.rect(matX + cellW*(j+1), matY, cellW, cellW, 'F');
      text('#'+data.muaTable[j].num, matX + cellW*(j+1) + cellW/2, matY+cellW/2+1, {size:7, color:WHITE, style:'bold', align:'center'});
    }
    
    // Righe matrice
    for(var i=0; i<N; i++){
      // Header colonna sx
      doc.setFillColor.apply(doc, BLUE);
      doc.rect(matX, matY + cellW*(i+1), cellW, cellW, 'F');
      text('#'+data.muaTable[i].num, matX + cellW/2, matY + cellW*(i+1) + cellW/2 + 1, {size:7, color:WHITE, style:'bold', align:'center'});
      
      // Celle
      for(var j=0; j<N; j++){
        var cx = matX + cellW*(j+1);
        var cy = matY + cellW*(i+1);
        if(i === j){
          // Diagonale: nera
          doc.setFillColor.apply(doc, [60,60,60]);
          doc.rect(cx, cy, cellW, cellW, 'F');
          // Tratteggio diagonale
          doc.setDrawColor(255,255,255); doc.setLineWidth(0.3);
          doc.line(cx, cy, cx+cellW, cy+cellW);
        } else {
          var ang = coppieMatrix[i][j];
          var fillCol;
          var textCol;
          if(ang > MAX_COUPLE_DIVERGENCE){
            fillCol = [255, 220, 220]; textCol = RED;
          } else if(ang > MAX_COUPLE_DIVERGENCE * 0.75){
            fillCol = [255, 240, 220]; textCol = ORANGE;
          } else {
            fillCol = [232, 250, 225]; textCol = GREEN;
          }
          doc.setFillColor.apply(doc, fillCol);
          doc.setDrawColor.apply(doc, BORDER); doc.setLineWidth(0.2);
          doc.rect(cx, cy, cellW, cellW, 'FD');
          text(ang.toFixed(1), cx + cellW/2, cy + cellW/2 + 1, {size:Math.min(7, cellW*0.6), color:textCol, style:'bold', align:'center'});
        }
      }
    }
    
    // Legenda matrice in basso
    var legZ2Y = z2Y + z2H - 8;
    doc.setFillColor(232, 250, 225); doc.rect(z2X+8, legZ2Y-2, 4, 4, 'F');
    text('OK', z2X+13, legZ2Y+1, {size:6, color:DARK});
    doc.setFillColor(255, 240, 220); doc.rect(z2X+25, legZ2Y-2, 4, 4, 'F');
    text('borderline (>30°)', z2X+30, legZ2Y+1, {size:6, color:DARK});
    doc.setFillColor(255, 220, 220); doc.rect(z2X+68, legZ2Y-2, 4, 4, 'F');
    text('SOTTOSQUADRO (>'+MAX_COUPLE_DIVERGENCE+'°)', z2X+73, legZ2Y+1, {size:6, color:DARK, style:'bold'});
    
    // Conta coppie problematiche
    var probCount = 0;
    for(var i=0; i<N; i++){ for(var j=i+1; j<N; j++){
      if(coppieMatrix[i][j] > MAX_COUPLE_DIVERGENCE) probCount++;
    }}
    var statusMsg = probCount === 0 ? 'NESSUN sottosquadro reciproco rilevato' : probCount + ' coppia/e con sottosquadro reciproco';
    var statusCol = probCount === 0 ? GREEN : RED;
    text(statusMsg, z2X+z2W-3, legZ2Y+1, {size:7, color:statusCol, style:'bold', align:'right'});
  } else {
    text('Servono almeno 2 MUA accoppiati', z2X+z2W/2, z2Y+z2H/2, {size:9, color:GRAY, align:'center'});
  }

  // ── ZONA 3 (basso, full width): MAPPA OCCLUSALE 3D + OVERLAY LABEL ──
  // Cattura reale dal viewer Three.js + label divergenza ridisegnate vettoriali
  var z3X = L_M, z3Y = 132, z3W = L_W - 2*L_M, z3H = 65;
  doc.setDrawColor.apply(doc, BORDER); doc.setLineWidth(0.4);
  doc.setFillColor(252,253,254); doc.rect(z3X, z3Y, z3W, z3H, 'FD');
  
  // Numero + titolo
  doc.setFillColor.apply(doc, BLUE); doc.circle(z3X+5, z3Y+5, 3, 'F');
  doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.setFontSize(9);
  doc.text('3', z3X+5, z3Y+6.5, {align:'center'});
  text('MAPPA OCCLUSALE - VISTA REALE DEL CASO', z3X+11, z3Y+7, {size:10, style:'bold', color:DARK});
  text('Cattura del viewer 3D con asse medio e label divergenza vettoriali', z3X+11, z3Y+11, {size:7, color:GRAY});
  
  // Area mappa: lascio spazio a sx (titolo) e a dx (tabella riepilogo)
  // Mappa: dal margine sx (dopo titolo) a 70mm prima del bordo dx
  var mapBoxX = z3X + 4;
  var mapBoxY = z3Y + 15;
  var mapBoxW = z3W - 75; // lascio 70mm per tabella riepilogo
  var mapBoxH = z3H - 19;
  
  // Calcolo dimensione effettiva immagine preservando aspect ratio del canvas Three.js.
  // Senza questo correttivo limmagine viene schiacciata orizzontalmente in box landscape.
  var imgX = mapBoxX, imgY = mapBoxY, imgW = mapBoxW, imgH = mapBoxH;
  if(views && views.occlusale && renderer && renderer.domElement){
    var canvasW = renderer.domElement.width;
    var canvasH = renderer.domElement.height;
    var canvasRatio = canvasW / canvasH;
    var boxRatio = mapBoxW / mapBoxH;
    if(canvasRatio > boxRatio){
      // Canvas piu largo del box -> limito per larghezza, riduco altezza
      imgW = mapBoxW;
      imgH = mapBoxW / canvasRatio;
      imgX = mapBoxX;
      imgY = mapBoxY + (mapBoxH - imgH) / 2;
    } else {
      // Canvas piu alto del box -> limito per altezza, riduco larghezza, centro
      imgH = mapBoxH;
      imgW = mapBoxH * canvasRatio;
      imgY = mapBoxY;
      imgX = mapBoxX + (mapBoxW - imgW) / 2;
    }
  }
  
  // Sfondo grigio chiaro nel box vuoto (per visibilita ai lati)
  doc.setFillColor(248, 250, 253);
  doc.rect(mapBoxX, mapBoxY, mapBoxW, mapBoxH, 'F');
  
  // Inserisco la cattura 3D occlusale al centro del box, aspect ratio preservato
  if(views && views.occlusale){
    try {
      doc.addImage(views.occlusale, 'PNG', imgX, imgY, imgW, imgH, undefined, 'FAST');
      doc.setDrawColor.apply(doc, BORDER); doc.setLineWidth(0.3);
      doc.rect(imgX, imgY, imgW, imgH);
    } catch(e){
      console.error('[analReport] addImage occlusale fallito:', e);
      text('Cattura occlusale non riuscita', mapBoxX+mapBoxW/2, mapBoxY+mapBoxH/2, {size:9, color:GRAY, align:'center'});
    }
  } else {
    text('Vista occlusale non disponibile', mapBoxX+mapBoxW/2, mapBoxY+mapBoxH/2, {size:9, color:GRAY, align:'center'});
  }
  
  // Bordo esterno del box
  doc.setDrawColor.apply(doc, BORDER); doc.setLineWidth(0.3);
  doc.rect(mapBoxX, mapBoxY, mapBoxW, mapBoxH);
  
  // Overlay: label pillola vettoriali sopra la cattura, usando le proiezioni 2D.
  // Importante: le proiezioni sono fx/fy frazioni del CANVAS, quindi devono mappare sullarea EFFETTIVA dellimmagine (imgX/imgY/imgW/imgH), non sullintero box.
  if(views && views.occlusalProjections && views.occlusalProjections.length > 0){
    views.occlusalProjections.forEach(function(p){
      // Coordinate canvas-fraction (0..1) -> coordinate PDF (mm) sullimmagine effettiva
      var px = imgX + p.fx * imgW;
      var py = imgY + p.fy * imgH;
      
      // Color status semaforo
      var divDeg = p.divergence != null ? p.divergence : 0;
      var pillBg, pillBorder, pillText;
      if(!p.rigorousOK){
        // FUORI cono - rosso
        pillBg = [255, 220, 220]; pillBorder = RED; pillText = RED;
      } else if(divDeg > 17){
        // Borderline - oro
        pillBg = [255, 245, 215]; pillBorder = GOLD; pillText = [180, 100, 5];
      } else {
        // OK - verde
        pillBg = [225, 245, 220]; pillBorder = GREEN; pillText = [50, 110, 40];
      }
      
      // Testo pillola
      var labelText = '#' + p.num + ' ' + divDeg.toFixed(1) + '°';
      // Stima larghezza testo (approssimazione): 1.6mm per char + padding
      var pillW = labelText.length * 1.6 + 6;
      var pillH = 4.5;
      
      // Posiziono la pillola sopra-destra del punto MUA (offset per non coprire il MUA)
      var pillX = px + 1.5; // offset destra
      var pillY = py - pillH - 1.5; // offset sopra
      
      // Se troppo a destra esce dalla mappa, lo metto a sx
      if(pillX + pillW > mapBoxX + mapBoxW){
        pillX = px - pillW - 1.5;
      }
      // Se troppo in alto esce dalla mappa, lo metto sotto
      if(pillY < mapBoxY){
        pillY = py + 1.5;
      }
      
      // Linea di collegamento punto -> pillola
      doc.setDrawColor.apply(doc, pillBorder); doc.setLineWidth(0.3);
      doc.line(px, py, pillX + pillW/2, pillY + pillH/2);
      
      // Punto MUA (cerchietto)
      doc.setFillColor.apply(doc, pillBorder); doc.setDrawColor(255,255,255); doc.setLineWidth(0.4);
      doc.circle(px, py, 1.5, 'FD');
      
      // Pillola: rect arrotondato (jsPDF roundedRect)
      doc.setFillColor.apply(doc, pillBg); doc.setDrawColor.apply(doc, pillBorder); doc.setLineWidth(0.5);
      try {
        doc.roundedRect(pillX, pillY, pillW, pillH, 1.5, 1.5, 'FD');
      } catch(e){
        // fallback rect normale
        doc.rect(pillX, pillY, pillW, pillH, 'FD');
      }
      
      // Dot colorato a sx dentro la pillola
      doc.setFillColor.apply(doc, pillBorder);
      doc.circle(pillX + 2, pillY + pillH/2, 0.8, 'F');
      
      // Testo
      doc.setFont('helvetica', 'bold'); doc.setFontSize(6);
      doc.setTextColor.apply(doc, pillText);
      doc.text(labelText, pillX + 4, pillY + pillH/2 + 1);
    });
  }
  
  // Tabella riepilogo MUA a destra della mappa (resta uguale a prima)
  var tabZ3X = mapBoxX + mapBoxW + 5;
  var tabZ3Y = mapBoxY;
  text('RIEPILOGO MUA', tabZ3X, tabZ3Y+3, {size:8, style:'bold', color:DARK});
  var rowY = tabZ3Y + 8;
  // Header
  doc.setFillColor(248, 250, 253); doc.rect(tabZ3X, rowY-3, 65, 4, 'F');
  text('MUA', tabZ3X+2, rowY, {size:6, style:'bold', color:GRAY});
  text('div.', tabZ3X+18, rowY, {size:6, style:'bold', color:GRAY});
  text('cono', tabZ3X+33, rowY, {size:6, style:'bold', color:GRAY});
  text('fres.', tabZ3X+50, rowY, {size:6, style:'bold', color:GRAY});
  rowY += 4;
  data.muaTable.forEach(function(m){
    var grpCol2 = m.group === 0 ? BLUE : (m.group === 1 ? ORANGE : GREEN);
    doc.setFillColor.apply(doc, grpCol2); doc.circle(tabZ3X+3, rowY-1, 1.5, 'F');
    text('#'+m.num, tabZ3X+6, rowY, {size:6, style:'bold'});
    text((m.divMedio||0).toFixed(1)+'°', tabZ3X+18, rowY, {size:6});
    text(m.coneOK?'OK':'X', tabZ3X+33, rowY, {size:6, color: m.coneOK?GREEN:RED, style:'bold'});
    text(m.millingOK?'OK':'X', tabZ3X+50, rowY, {size:6, color: m.millingOK?GREEN:RED, style:'bold'});
    rowY += 4;
  });
  // Legenda colori semaforo sotto la tabella
  var legZ3Y = mapBoxY + mapBoxH - 14;
  text('LEGENDA STATO', tabZ3X, legZ3Y, {size:6, style:'bold', color:GRAY});
  doc.setFillColor.apply(doc, GREEN); doc.circle(tabZ3X+2, legZ3Y+4, 1, 'F');
  text('dentro cono', tabZ3X+5, legZ3Y+4.5, {size:5});
  doc.setFillColor.apply(doc, GOLD); doc.circle(tabZ3X+2, legZ3Y+8, 1, 'F');
  text('borderline (>17°)', tabZ3X+5, legZ3Y+8.5, {size:5});
  doc.setFillColor.apply(doc, RED); doc.circle(tabZ3X+2, legZ3Y+12, 1, 'F');
  text('fuori cono (>20°)', tabZ3X+5, legZ3Y+12.5, {size:5});

  // Footer pagina
  text('Synthesis-ICP - Report Analizza MUA ' + data.caseCode + ' - ' + data.dateStr, L_M, L_H-3, {size:7, color:GRAY});
  text('Pag. 2 / 7', L_W-L_M, L_H-3, {size:7, color:GRAY, align:'right'});

  // ╔══════════════════════════════════════════════════════════════╗
  // ║ PAGINA 3: SPIEGAZIONE - ASSE MEDIO E SOTTOSQUADRI            ║
  // ╚══════════════════════════════════════════════════════════════╝
  doc.addPage('a4', 'portrait');
  text('METODO DI ANALISI', MARGIN, 25, {size:16, style:'bold', color:BLUE});
  doc.setDrawColor.apply(doc, BLUE); doc.setLineWidth(0.8); doc.line(MARGIN, 28, MARGIN+50, 28);
  text('Come Synthesis-ICP calcola asse medio, sottosquadri e fresabilita', MARGIN, 34, {size:9, color:GRAY, style:'italic'});

  y = 44;

  // ── Sezione 1: ASSE MEDIO ──
  // Banda colorata + titolo
  box(MARGIN, y, PAGE_W-2*MARGIN, 8, [230,241,251]);
  text('1. ASSE MEDIO', MARGIN+3, y+5.5, {size:11, style:'bold', color:BLUE});
  y += 12;

  var p1a = 'Quando piu MUA devono ricevere una protesi unica (barra avvitata, ponte, full-arch), gli assi dei singoli ' +
            'pilastri non sono mai perfettamente paralleli: lanatomia ossea, la posizione degli impianti e leventuale uso ' +
            'di MUA angolati a 17 o 30 gradi producono sempre una certa divergenza tra gli assi.';
  var lines1a = doc.splitTextToSize(p1a, PAGE_W - 2*MARGIN);
  doc.setFont('helvetica','normal'); doc.setFontSize(9.5); doc.setTextColor.apply(doc, DARK);
  doc.text(lines1a, MARGIN, y);
  y += lines1a.length*4.5 + 3;

  var p1b = 'Lasse medio e il vettore unitario che minimizza la somma degli scarti angolari tra se stesso e tutti gli assi ' +
            'MUA del gruppo. E la "via di mezzo" geometrica lungo cui la protesi puo essere inserita ed estratta in modo ' +
            'rettilineo. Ogni MUA viene poi caratterizzato dalla sua divergenza, ovvero langolo formato tra il suo asse ' +
            'individuale e questo asse medio comune.';
  var lines1b = doc.splitTextToSize(p1b, PAGE_W - 2*MARGIN);
  doc.text(lines1b, MARGIN, y);
  y += lines1b.length*4.5 + 5;

  // Diagramma asse medio + box calcolo affiancato
  var diagY = y;
  var diagX = MARGIN + 25;
  var diagH = 50;
  // 3 MUA inclinati + asse medio
  doc.setDrawColor.apply(doc, GRAY); doc.setLineWidth(0.3);
  doc.line(diagX-25, diagY+diagH-5, diagX+30, diagY+diagH-5);  // gengiva
  doc.setLineWidth(0.7);
  doc.setDrawColor.apply(doc, [60,120,180]);
  doc.line(diagX-20, diagY+diagH-5, diagX-25, diagY+8);  // MUA 1 inclinato sx
  doc.line(diagX+5, diagY+diagH-5, diagX+3, diagY+5);    // MUA 2 quasi verticale
  doc.line(diagX+25, diagY+diagH-5, diagX+30, diagY+8);  // MUA 3 inclinato dx
  // Asse medio rosso tratteggiato verticale
  doc.setDrawColor.apply(doc, RED); doc.setLineWidth(0.9);
  doc.setLineDashPattern([1.5,1.5], 0);
  doc.line(diagX+3, diagY+diagH-5, diagX+3, diagY-2);
  doc.setLineDashPattern([], 0);
  // Etichette
  text('1', diagX-27, diagY+5, {size:7, color:[60,120,180], style:'bold'});
  text('2', diagX+5, diagY+2, {size:7, color:[60,120,180], style:'bold'});
  text('3', diagX+32, diagY+5, {size:7, color:[60,120,180], style:'bold'});
  text('asse medio', diagX+5, diagY-4, {size:8, color:RED, style:'bold'});
  text('gengiva', diagX+34, diagY+diagH-2, {size:7, color:GRAY});

  // Box "Calcolo" a destra del diagramma
  var calcBoxX = MARGIN+85;
  var calcBoxW = PAGE_W-MARGIN-calcBoxX;
  box(calcBoxX, diagY-2, calcBoxW, diagH+5, LIGHT, BORDER);
  text('CALCOLO', calcBoxX+3, diagY+3, {size:8, style:'bold', color:GRAY});
  text('1. Per ogni MUA accoppiato si estrae lasse', calcBoxX+3, diagY+9, {size:8});
  text('   normalizzato dalla sua geometria.', calcBoxX+3, diagY+13, {size:8});
  text('2. Si correggono i versi (segno coerente),', calcBoxX+3, diagY+18, {size:8});
  text('   poi si fa la media vettoriale.', calcBoxX+3, diagY+22, {size:8});
  text('3. Lasse medio e questa media normalizzata.', calcBoxX+3, diagY+27, {size:8});
  text('4. La divergenza di ogni MUA e arccos del', calcBoxX+3, diagY+32, {size:8});
  text('   prodotto scalare con lasse medio.', calcBoxX+3, diagY+36, {size:8});
  text('Se ci sono piu gruppi, ogni gruppo ha il suo.', calcBoxX+3, diagY+44, {size:8, color:BLUE, style:'italic'});

  y = diagY + diagH + 10;

  // ── Sezione 2: SOTTOSQUADRI ──
  box(MARGIN, y, PAGE_W-2*MARGIN, 8, [253,236,229]);
  text('2. SOTTOSQUADRI E DIREZIONE DI INSERIMENTO', MARGIN+3, y+5.5, {size:11, style:'bold', color:[170,80,40]});
  y += 12;

  var p2a = 'Un sottosquadro e una zona della protesi che impedisce linserimento o lestrazione lungo un asse comune. ' +
            'Per due MUA, il sottosquadro reciproco si verifica quando la differenza angolare tra i loro assi supera ' + MAX_COUPLE_DIVERGENCE + ' gradi: ' +
            'oltre questa soglia non esiste alcuna direzione lungo cui un manufatto unico possa scendere su entrambi i pilastri ' +
            'simultaneamente senza forzature.';
  var lines2a = doc.splitTextToSize(p2a, PAGE_W - 2*MARGIN);
  doc.text(lines2a, MARGIN, y);
  y += lines2a.length*4.5 + 4;

  var p2b = 'In questo report ogni coppia di MUA viene confrontata; le coppie problematiche sono elencate nella sezione ' +
            'criticita. Se anche una sola coppia supera la soglia, il gruppo non puo essere unito in protesi monolitica ' +
            'e va scisso in piu segmenti.';
  var lines2b = doc.splitTextToSize(p2b, PAGE_W - 2*MARGIN);
  doc.text(lines2b, MARGIN, y);
  y += lines2b.length*4.5 + 5;

  // Diagramma sottosquadro
  var diag2Y = y;
  var diag2X = MARGIN + 25;
  doc.setDrawColor.apply(doc, GRAY); doc.setLineWidth(0.3);
  doc.line(diag2X-25, diag2Y+diagH-5, diag2X+30, diag2Y+diagH-5);
  doc.setLineWidth(0.7);
  doc.setDrawColor.apply(doc, [60,120,180]);
  doc.line(diag2X-12, diag2Y+diagH-5, diag2X-25, diag2Y+5);   // MUA molto inclinato sx
  doc.line(diag2X+12, diag2Y+diagH-5, diag2X+25, diag2Y+5);   // MUA molto inclinato dx (divergenti)
  // Cerchio rosso "X" zona impossibile
  doc.setDrawColor.apply(doc, RED); doc.setLineWidth(0.7);
  doc.circle(diag2X, diag2Y+15, 6);
  doc.line(diag2X-4, diag2Y+11, diag2X+4, diag2Y+19);
  doc.line(diag2X+4, diag2Y+11, diag2X-4, diag2Y+19);
  text('NO', diag2X+10, diag2Y+17, {size:7, color:RED, style:'bold'});

  // Box soglie
  box(calcBoxX, diag2Y-2, calcBoxW, diagH+5, [253,247,235], BORDER);
  text('SOGLIE APPLICATE', calcBoxX+3, diag2Y+3, {size:8, style:'bold', color:[170,100,15]});
  text('Cono MUA IPD', calcBoxX+3, diag2Y+11, {size:8});
  text(MUA_CONE_HALF_ANGLE + ' deg', calcBoxX+calcBoxW-3, diag2Y+11, {size:8, style:'bold', align:'right'});
  text('Max coppia (sottosquadro)', calcBoxX+3, diag2Y+17, {size:8});
  text(MAX_COUPLE_DIVERGENCE + ' deg', calcBoxX+calcBoxW-3, diag2Y+17, {size:8, style:'bold', align:'right'});
  text('Max fresatura macchina', calcBoxX+3, diag2Y+23, {size:8});
  text(MAX_MILLING_ANGLE + ' deg', calcBoxX+calcBoxW-3, diag2Y+23, {size:8, style:'bold', align:'right'});
  text('Le soglie sono parametrizzabili dalla', calcBoxX+3, diag2Y+33, {size:7, color:GRAY, style:'italic'});
  text('macchina selezionata e dalle costanti', calcBoxX+3, diag2Y+37, {size:7, color:GRAY, style:'italic'});
  text('cliniche IPD.', calcBoxX+3, diag2Y+41, {size:7, color:GRAY, style:'italic'});

  // Riferimento a pagine successive
  y = diag2Y + diagH + 10;
  text('Le prossime pagine mostrano la tabella numerica (pag. 3), la macchina e la mappa occlusale (pag. 4),', MARGIN, y, {size:8, color:GRAY, style:'italic'});
  text('le viste 3D del caso (pag. 5) e le criticita rilevate con le raccomandazioni (pag. 6).', MARGIN, y+4, {size:8, color:GRAY, style:'italic'});

  addFooter(3, 7);

  // ╔══════════════════════════════════════════════════════════════╗
  // ║ PAGINA 3: TABELLA ANGOLI                                     ║
  // ╚══════════════════════════════════════════════════════════════╝
  doc.addPage();
  text('TABELLA ANGOLI', MARGIN, 25, {size:16, style:'bold', color:BLUE});
  doc.setDrawColor.apply(doc, BLUE); doc.setLineWidth(0.8); doc.line(MARGIN, 28, MARGIN+50, 28);

  text('Divergenza di ogni MUA rispetto allasse medio del proprio gruppo.', MARGIN, 36, {size:9, color:GRAY});

  y = 46;
  // Header tabella
  var colX = [MARGIN, MARGIN+22, MARGIN+45, MARGIN+85, MARGIN+115, MARGIN+145];
  box(MARGIN, y, PAGE_W-2*MARGIN, 8, BLUE);
  text('MUA', colX[0]+2, y+5.5, {size:9, color:WHITE, style:'bold'});
  text('Gruppo', colX[1]+2, y+5.5, {size:9, color:WHITE, style:'bold'});
  text('Asse medio', colX[2]+2, y+5.5, {size:9, color:WHITE, style:'bold'});
  text('Asse ottimizzato', colX[3]+2, y+5.5, {size:9, color:WHITE, style:'bold'});
  text('Cono 20deg', colX[4]+2, y+5.5, {size:9, color:WHITE, style:'bold'});
  text('Fres. 30deg', colX[5]+2, y+5.5, {size:9, color:WHITE, style:'bold'});
  y += 8;

  // Righe MUA
  data.muaTable.forEach(function(row, i){
    if(i % 2 === 0){ box(MARGIN, y, PAGE_W-2*MARGIN, 7, LIGHT); }
    text('#'+row.num, colX[0]+2, y+5, {size:9, style:'bold'});
    text('G'+row.group, colX[1]+2, y+5, {size:9});
    text(row.divMedio != null ? row.divMedio.toFixed(1)+' deg' : '--', colX[2]+2, y+5, {size:9});
    text('-- (v2)', colX[3]+2, y+5, {size:9, color:GRAY});  // placeholder
    text(row.coneOK ? 'OK' : 'FUORI', colX[4]+2, y+5, {size:9, color:row.coneOK?GREEN:RED, style:'bold'});
    text(row.millingOK ? 'OK' : 'FUORI', colX[5]+2, y+5, {size:9, color:row.millingOK?GREEN:RED, style:'bold'});
    y += 7;
  });

  y += 6;
  // Nota placeholder asse ottimizzato
  box(MARGIN, y, PAGE_W-2*MARGIN, 18, [255,248,235], BORDER);
  text('NOTA - Asse ottimizzato', MARGIN+3, y+6, {size:9, style:'bold', color:ORANGE});
  text('Lasse ottimizzato (calcolato come asse che minimizza il massimo angolo di tutti i MUA)', MARGIN+3, y+11, {size:8, color:DARK});
  text('verra introdotto nella prossima versione del report. Oggi vengono mostrati solo gli angoli vs asse medio.', MARGIN+3, y+15, {size:8, color:DARK});
  y += 22;

  addFooter(4, 7);

  // ╔══════════════════════════════════════════════════════════════╗
  // ║ PAGINA 4: MACCHINA + MAPPA POSIZIONE                         ║
  // ╚══════════════════════════════════════════════════════════════╝
  doc.addPage();
  text('CONFIGURAZIONE FRESATURA', MARGIN, 25, {size:16, style:'bold', color:BLUE});
  doc.setDrawColor.apply(doc, BLUE); doc.setLineWidth(0.8); doc.line(MARGIN, 28, MARGIN+50, 28);

  y = 40;
  // Box macchina
  box(MARGIN, y, PAGE_W-2*MARGIN, 30, LIGHT, BORDER);
  text('MACCHINA SELEZIONATA', MARGIN+5, y+8, {size:9, color:GRAY, style:'bold'});
  text(data.machineName || 'Non selezionata', MARGIN+5, y+18, {size:14, style:'bold'});
  text('Asse di lavoro: B (rotazione lato pezzo) - max ' + MAX_MILLING_ANGLE + ' deg', MARGIN+5, y+25, {size:9, color:GRAY});
  text('Tipo: 5 assi', PAGE_W-MARGIN-5, y+18, {size:11, align:'right', color:BLUE, style:'bold'});

  y += 38;

  // Mappa posizione MUA: vista occlusale reale dal viewer Three.js
  text('VISTA OCCLUSALE (dal viewer)', MARGIN, y, {size:11, style:'bold'});
  text('Snapshot della scena 3D dallalto - mostra le posizioni reali dei MUA sullarcata', MARGIN, y+5, {size:8, color:GRAY});
  y += 10;

  var mapX = MARGIN, mapY = y, mapW = PAGE_W-2*MARGIN, mapH = 110;
  if(views && views.occlusale){
    try {
      doc.addImage(views.occlusale, 'PNG', mapX, mapY, mapW, mapH, undefined, 'FAST');
      // Bordo intorno limmagine
      doc.setDrawColor.apply(doc, BORDER); doc.setLineWidth(0.3);
      doc.rect(mapX, mapY, mapW, mapH);
    } catch(e){
      console.error('[analReport] addImage occlusale fallito:', e);
      box(mapX, mapY, mapW, mapH, [248,250,253], BORDER);
      text('Cattura vista non riuscita', mapX+mapW/2, mapY+mapH/2, {size:11, color:GRAY, align:'center', style:'bold'});
    }
  } else {
    box(mapX, mapY, mapW, mapH, [248,250,253], BORDER);
    text('Vista occlusale non disponibile', mapX+mapW/2, mapY+mapH/2, {size:11, color:GRAY, align:'center', style:'bold'});
  }

  // Indicazione gruppi
  y = mapY + mapH + 8;
  if(data.groupCount === 1){
    box(MARGIN, y, PAGE_W-2*MARGIN, 12, [232,250,225], GREEN);
    text('GRUPPO SINGOLO', MARGIN+3, y+5, {size:10, style:'bold', color:GREEN});
    text(data.muaCount + ' MUA in un unico gruppo - protesi unica', MARGIN+3, y+10, {size:9});
  } else {
    box(MARGIN, y, PAGE_W-2*MARGIN, 12, [255,243,225], ORANGE);
    text('GRUPPI MULTIPLI', MARGIN+3, y+5, {size:10, style:'bold', color:ORANGE});
    text(data.groupCount + ' gruppi separati - ogni gruppo ha asse medio indipendente', MARGIN+3, y+10, {size:9});
  }

  addFooter(5, 7);

  // ╔══════════════════════════════════════════════════════════════╗
  // ║ PAGINA 5: VISTE 3D DAL VIEWER                                ║
  // ╚══════════════════════════════════════════════════════════════╝
  doc.addPage();
  text('VISTE 3D MUA E ARCATA', MARGIN, 25, {size:16, style:'bold', color:BLUE});
  doc.setDrawColor.apply(doc, BLUE); doc.setLineWidth(0.8); doc.line(MARGIN, 28, MARGIN+50, 28);

  text('Snapshot del viewer Three.js da angolazioni multiple per documentare il caso clinico.', MARGIN, 36, {size:9, color:GRAY});

  // Helper per inserire una vista con etichetta
  function placeView(viewKey, label, sub, sx, sy, sw, sh){
    if(views && views[viewKey]){
      try {
        doc.addImage(views[viewKey], 'PNG', sx, sy, sw, sh, undefined, 'FAST');
        doc.setDrawColor.apply(doc, BORDER); doc.setLineWidth(0.3);
        doc.rect(sx, sy, sw, sh);
      } catch(e){
        box(sx, sy, sw, sh, [248,250,253], BORDER);
        text('Cattura non riuscita', sx+sw/2, sy+sh/2, {size:9, color:GRAY, align:'center'});
      }
    } else {
      box(sx, sy, sw, sh, [248,250,253], BORDER);
      text(label, sx+sw/2, sy+sh/2-3, {size:10, style:'bold', color:GRAY, align:'center'});
      text('vista non disponibile', sx+sw/2, sy+sh/2+3, {size:8, color:GRAY, align:'center'});
    }
    // Etichetta sotto limmagine
    text(label, sx, sy+sh+5, {size:9, style:'bold', color:DARK});
    text(sub, sx, sy+sh+9, {size:7, color:GRAY});
  }

  // Vista prospettica grande in alto
  var pgY = 45;
  var bigW = PAGE_W - 2*MARGIN, bigH = 80;
  placeView('prospettica', 'Vista prospettica 3/4', 'Tutti i MUA accoppiati con assi visibili', MARGIN, pgY, bigW, bigH);

  // 3 viste piccole sotto in riga (occlusale, vestibolare, linguale)
  pgY += bigH + 18;
  var smallW = (PAGE_W - 2*MARGIN - 12) / 3, smallH = 55;
  placeView('occlusale', 'Vista occlusale', 'Dallalto, vista del piano impianti', MARGIN, pgY, smallW, smallH);
  placeView('vestibolare', 'Vista vestibolare', 'Profilo anteriore arcata', MARGIN+smallW+6, pgY, smallW, smallH);
  placeView('linguale', 'Vista linguale', 'Profilo posteriore arcata', MARGIN+2*(smallW+6), pgY, smallW, smallH);

  // Nota sezioni in arrivo
  y = pgY + smallH + 18;
  box(MARGIN, y, PAGE_W-2*MARGIN, 18, [255,248,235], BORDER);
  text('SEZIONI MUA-CONNESSIONE - in arrivo', MARGIN+3, y+6, {size:9, style:'bold', color:ORANGE});
  text('La sezione verticale per ogni gruppo (taglio sul piano dellasse medio) e la mappa', MARGIN+3, y+11, {size:8});
  text('dei sottosquadri come gradiente clinico verranno aggiunte nella prossima iterazione.', MARGIN+3, y+15, {size:8});

  addFooter(6, 7);

  // ╔══════════════════════════════════════════════════════════════╗
  // ║ PAGINA 6: CRITICITA                                          ║
  // ╚══════════════════════════════════════════════════════════════╝
  doc.addPage();
  text('CRITICITA RILEVATE', MARGIN, 25, {size:16, style:'bold', color:BLUE});
  doc.setDrawColor.apply(doc, BLUE); doc.setLineWidth(0.8); doc.line(MARGIN, 28, MARGIN+50, 28);

  y = 40;
  if(data.criticita.list.length === 0){
    box(MARGIN, y, PAGE_W-2*MARGIN, 20, [232,250,225], GREEN);
    text('NESSUNA CRITICITA RILEVATA', MARGIN+5, y+8, {size:12, style:'bold', color:GREEN});
    text('Tutti i MUA rispettano le soglie cliniche e di fresatura.', MARGIN+5, y+14, {size:9});
    y += 25;
  } else {
    data.criticita.list.forEach(function(c){
      box(MARGIN, y, PAGE_W-2*MARGIN, 18, [255,240,235], RED);
      text(c.title, MARGIN+5, y+7, {size:10, style:'bold', color:RED});
      text(c.detail, MARGIN+5, y+13, {size:8, color:DARK});
      y += 22;
      if(y > PAGE_H - 30){ doc.addPage(); y = 25; addFooter(8,7); }
    });
  }

  // Sezione "raccomandazioni" (placeholder testuale)
  y += 8;
  text('RACCOMANDAZIONI', MARGIN, y, {size:11, style:'bold'});
  y += 6;
  var recs = analReport_buildRecommendations(data);
  recs.forEach(function(r){
    text('- ' + r, MARGIN+3, y, {size:9});
    y += 6;
  });

  addFooter(7, 7);

  // Salva PDF
  var fname = 'Report-Analizza-' + data.caseCode + '-' + data.dateFile + '.pdf';
  doc.save(fname);
  console.log('[analReport] Report generato:', fname);
}

// Raccolta dati per il report (estrae tutto da muaObjects + globali)
function analReport_collectData(){
  var aligned = muaObjects.filter(function(m){ return m.aligned; });

  // Codice caso (placeholder per ora)
  var caseCode = 'CASE-' + Date.now().toString().slice(-6);
  var d = new Date();
  var dateStr = d.toLocaleDateString('it-IT', {day:'2-digit', month:'2-digit', year:'numeric'});
  var dateFile = d.toISOString().slice(0,10);

  // Macchina selezionata
  var machineName = '';
  try {
    var sel = document.getElementById('fresMachineName');
    if(sel) machineName = sel.textContent.trim();
  } catch(e){}

  // Tabella MUA
  var muaTable = aligned.map(function(m){
    return {
      num: m.num,
      group: m.groupId || 0,
      divMedio: m.divergence,
      coneOK: m.rigorousOK !== false,
      millingOK: m.millingOK !== false,
      undercutOK: m.undercutOK !== false,
      posXY: [m.position.x, m.position.z]  // proiezione orizzontale (Y e altezza)
    };
  });

  // Gruppi
  var groupSet = {};
  aligned.forEach(function(m){ groupSet[m.groupId || 0] = true; });
  var groupCount = Object.keys(groupSet).length;

  // Statistiche
  var divs = aligned.map(function(m){ return m.divergence; }).filter(function(v){ return v != null; });
  var maxDiv = divs.length > 0 ? Math.max.apply(null, divs) : null;
  var avgDiv = divs.length > 0 ? divs.reduce(function(a,b){return a+b;},0) / divs.length : null;

  // Criticita
  var coneOutCount = aligned.filter(function(m){ return m.rigorousOK === false; }).length;
  var millingOutCount = aligned.filter(function(m){ return m.millingOK === false; }).length;
  // Conta coppie sottosquadro
  var undercutPairs = 0;
  for(var i=0; i<aligned.length; i++){
    for(var j=i+1; j<aligned.length; j++){
      if((aligned[i].groupId||0) !== (aligned[j].groupId||0)) continue;
      var dot = aligned[i].axisDir.x*aligned[j].axisDir.x + aligned[i].axisDir.y*aligned[j].axisDir.y + aligned[i].axisDir.z*aligned[j].axisDir.z;
      var ang = Math.acos(Math.min(1, Math.abs(dot))) * 180/Math.PI;
      if(ang > MAX_COUPLE_DIVERGENCE) undercutPairs++;
    }
  }

  // Score: Fresabilita = % MUA con millingOK
  var fresabilita = aligned.length > 0 ? Math.round((aligned.length - millingOutCount) / aligned.length * 100) : 0;
  var fresabilitaLabel = fresabilita >= 80 ? 'Ottima' : fresabilita >= 60 ? 'Accettabile' : 'Critica';

  // Score: Possibilita protesica = % MUA con coneOK e nessuna coppia sottosquadro
  var protesica = aligned.length > 0 ? Math.round((aligned.length - coneOutCount) / aligned.length * 100) : 0;
  // penalizzazione per coppie sottosquadro
  protesica = Math.max(0, protesica - undercutPairs * 10);
  var protesicaLabel = protesica >= 80 ? 'Buona' : protesica >= 60 ? 'Limitata' : 'Compromessa';

  // Lista criticita testuale
  var critList = [];
  aligned.forEach(function(m){
    if(m.rigorousOK === false){
      critList.push({title: 'MUA #'+m.num+' fuori cono ' + MUA_CONE_HALF_ANGLE + ' deg', detail: 'Divergenza '+(m.divergence!=null?m.divergence.toFixed(1):'?')+' deg dal asse medio - oltre la soglia clinica.'});
    }
    if(m.millingOK === false){
      critList.push({title: 'MUA #'+m.num+' non fresabile', detail: 'Divergenza '+(m.divergence!=null?m.divergence.toFixed(1):'?')+' deg supera limite macchina ' + MAX_MILLING_ANGLE + ' deg.'});
    }
  });
  if(undercutPairs > 0){
    critList.push({title: undercutPairs + ' coppia/e con sottosquadri reciproci', detail: 'Divergenza tra MUA della stessa coppia oltre ' + MAX_COUPLE_DIVERGENCE + ' deg - nessun cammino di inserimento comune.'});
  }

  return {
    caseCode: caseCode,
    dateStr: dateStr,
    dateFile: dateFile,
    machineName: machineName,
    muaCount: aligned.length,
    groupCount: groupCount,
    maxDiv: maxDiv,
    avgDiv: avgDiv,
    muaTable: muaTable,
    criticita: {
      coneOutCount: coneOutCount,
      millingOutCount: millingOutCount,
      undercutPairs: undercutPairs,
      list: critList
    },
    scores: {
      fresabilita: fresabilita,
      fresabilitaLabel: fresabilitaLabel,
      protesica: protesica,
      protesicaLabel: protesicaLabel
    }
  };
}

// Costruzione raccomandazioni testuali (regole semplici)
function analReport_buildRecommendations(data){
  var recs = [];
  if(data.criticita.coneOutCount > 0){
    recs.push('Considerare il riposizionamento dei MUA fuori cono (semiangolo ' + MUA_CONE_HALF_ANGLE + ' deg) per rispettare le specifiche cliniche IPD.');
  }
  if(data.criticita.millingOutCount > 0){
    recs.push('Valutare luso di MUA angolati (17 deg o 30 deg) per recuperare la fresabilita sui MUA fuori soglia di ' + MAX_MILLING_ANGLE + ' deg.');
  }
  if(data.criticita.undercutPairs > 0){
    recs.push('Le coppie con sottosquadri non possono essere unite in protesi monolitica - separare in piu segmenti.');
  }
  if(data.groupCount > 1){
    recs.push('Gruppi multipli rilevati: ogni gruppo richiede progettazione e fresatura indipendenti.');
  }
  if(recs.length === 0){
    recs.push('Caso clinicamente e tecnicamente conforme - nessuna raccomandazione di modifica.');
  }
  return recs;
}
