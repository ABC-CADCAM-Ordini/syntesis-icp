/*
 * syn-geom.js — estrattori geometrici PURI di Syntesis-ICP (Fase 4 modularizzazione, 8.85.0).
 *
 * CONTRATTO: zero stato applicativo; leggono SOLO gli argomenti (geometrie/mesh THREE).
 *   - b64toArrayBuffer(b64)                          decodifica asset embed
 *   - extractScanTopFaceNear(geo, clickPos, n, r)    flat/side attorno al click (ICP mirato)
 *   - extractTopFacePts(geometry)                    flat/side del cilindro superiore scanbody
 *   - getTransformedTriangles(mesh)                  triangoli world-space {n, v}
 *   - intersectPlaneTriangle / extractCutSegments    sezione piano-mesh (motore Taglio)
 *   - projectTo2D(pt, origin, u, w)                  proiezione su piano 2D
 *   - makeGradientTexture(c1, c2, deg)               delega a ds/syn-render.js (fonte unica)
 *
 * CARICAMENTO: <script src> classico NON-strict in testa; THREE/SynRender letti a
 * call-time. ESCLUSE dal modulo (stateful, vivono nel monolite): rebuildScanMeshGeometry,
 * extractScanbodyScanFor. GATE: scripts/gate/purelib/gate.mjs --from-ds --check
 */

function b64toArrayBuffer(b64){var bin=atob(b64),len=bin.length,bytes=new Uint8Array(len);for(var i=0;i<len;i++)bytes[i]=bin.charCodeAt(i);return bytes.buffer}

// Extract scan points on the flat face near click (for precise ICP targeting)
function extractScanTopFaceNear(scanGeo, clickPos, clickNormal, radiusMm){
  // Estrae cilindro corto dalla scansione, SEPARATO in flat (piano appoggio) e side (cilindro laterale)
  // Priorita' flat (normale allineata al click), side solo per centratura
  radiusMm = radiusMm || 3.0;
  var cylHeight = 3.0;
  var pos = scanGeo.attributes.position.array;
  var norm = scanGeo.attributes.normal.array;
  var nTri = pos.length / 9;
  var flat = [], side = [];
  var cnx = clickNormal.x, cny = clickNormal.y, cnz = clickNormal.z;
  var cpx = clickPos.x, cpy = clickPos.y, cpz = clickPos.z;
  var r2 = radiusMm * radiusMm;
  for(var i = 0; i < nTri; i++){
    var ni = i * 9;
    var cx = (pos[ni] + pos[ni+3] + pos[ni+6]) / 3;
    var cy = (pos[ni+1] + pos[ni+4] + pos[ni+7]) / 3;
    var cz = (pos[ni+2] + pos[ni+5] + pos[ni+8]) / 3;
    var dx = cx - cpx, dy = cy - cpy, dz = cz - cpz;
    var axialDist = dx*cnx + dy*cny + dz*cnz;
    if(axialDist > 0.5 || axialDist < -cylHeight) continue;
    var latX = dx - axialDist*cnx, latY = dy - axialDist*cny, latZ = dz - axialDist*cnz;
    var latDist2 = latX*latX + latY*latY + latZ*latZ;
    if(latDist2 > r2) continue;
    // Normale media triangolo
    var nx = (norm[ni] + norm[ni+3] + norm[ni+6]) / 3;
    var ny = (norm[ni+1] + norm[ni+4] + norm[ni+7]) / 3;
    var nz = (norm[ni+2] + norm[ni+5] + norm[ni+8]) / 3;
    var nLen = Math.sqrt(nx*nx + ny*ny + nz*nz);
    if(nLen < 0.01) continue;
    nx /= nLen; ny /= nLen; nz /= nLen;
    // Allineamento con la normale del click
    var alignDot = nx*cnx + ny*cny + nz*cnz;
    if(alignDot > 0.80) flat.push([cx, cy, cz]);
    else if(alignDot > -0.3) side.push([cx, cy, cz]);
    // Esclude normali opposte (interno dell impianto)
  }
  function subsample(arr,max){if(arr.length<=max)return arr;var step=Math.floor(arr.length/max),r=[];for(var k=0;k<arr.length;k+=step)r.push(arr[k]);return r}
  return{flat:subsample(flat,200),side:subsample(side,200)};
}

// ── EXTRACT TOP FACE ────────────────────────────────────────────
function extractTopFacePts(geometry){
  // Estrae punti del cilindro superiore dello scanbody MARCATI per priorita':
  //   - normale.z > 0.85 -> punto FLAT (peso alto, definisce piano)
  //   - altrimenti      -> punto SIDE (peso basso, solo centratura XY)
  var pos=geometry.attributes.position.array;
  var norm=geometry.attributes.normal.array;
  var nTri=pos.length/9,zMax=-Infinity;
  for(var i=0;i<pos.length;i+=3){if(pos[i+2]>zMax)zMax=pos[i+2]}
  var zThresh=zMax-3.0;
  var flat=[],side=[];
  for(var i=0;i<nTri;i++){
    var ni=i*9;
    var cx=(pos[ni]+pos[ni+3]+pos[ni+6])/3,cy=(pos[ni+1]+pos[ni+4]+pos[ni+7])/3,cz=(pos[ni+2]+pos[ni+5]+pos[ni+8])/3;
    if(cz<zThresh)continue;
    // Normale media del triangolo
    var avgNz=(norm[ni+2]+norm[ni+5]+norm[ni+8])/3;
    if(avgNz>0.85)flat.push([cx,cy,cz]);
    else side.push([cx,cy,cz])
  }
  // Subsampling bilanciato: max 150 flat + 150 side
  function subsample(arr,max){if(arr.length<=max)return arr;var step=Math.floor(arr.length/max),r=[];for(var k=0;k<arr.length;k+=step)r.push(arr[k]);return r}
  return{flat:subsample(flat,150),side:subsample(side,150)};
}

// Estrae i triangoli di una mesh applicando la trasformazione matrixWorld
// (posizione dal click, orientamento dalla normale, raffinamento ICP).
function getTransformedTriangles(mesh){
  if(!mesh || !mesh.geometry) return [];
  mesh.updateMatrixWorld(true);
  var m = mesh.matrixWorld;
  var pos = mesh.geometry.getAttribute('position');
  if(!pos) return [];
  var idx = mesh.geometry.getIndex();
  var out = [];
  var vA = new THREE.Vector3();
  var vB = new THREE.Vector3();
  var vC = new THREE.Vector3();
  var cb = new THREE.Vector3();
  var ab = new THREE.Vector3();
  var n  = new THREE.Vector3();

  function pushTri(ia, ib, ic){
    vA.fromBufferAttribute(pos, ia).applyMatrix4(m);
    vB.fromBufferAttribute(pos, ib).applyMatrix4(m);
    vC.fromBufferAttribute(pos, ic).applyMatrix4(m);
    cb.subVectors(vC, vB);
    ab.subVectors(vA, vB);
    n.crossVectors(cb, ab);
    var len = n.length();
    if(len > 0) n.divideScalar(len);
    out.push({
      n: [n.x, n.y, n.z],
      v: [[vA.x, vA.y, vA.z], [vB.x, vB.y, vB.z], [vC.x, vC.y, vC.z]]
    });
  }

  if(idx){
    for(var i = 0; i < idx.count; i += 3){
      pushTri(idx.getX(i), idx.getX(i+1), idx.getX(i+2));
    }
  } else {
    for(var j = 0; j < pos.count; j += 3){
      pushTri(j, j+1, j+2);
    }
  }
  return out;
}

// Intersezione piano-triangolo: ritorna 0 o 2 punti (un segmento)
function intersectPlaneTriangle(p, planePoint, planeNormal){
  // p = [[x,y,z],[x,y,z],[x,y,z]]
  // Distanza segno dei 3 vertici dal piano
  var d = [0,0,0];
  for(var i = 0; i < 3; i++){
    d[i] = (p[i][0] - planePoint[0]) * planeNormal[0]
         + (p[i][1] - planePoint[1]) * planeNormal[1]
         + (p[i][2] - planePoint[2]) * planeNormal[2];
  }
  var positives = 0, negatives = 0, zeros = 0;
  for(var i = 0; i < 3; i++){
    if(d[i] > 1e-6) positives++;
    else if(d[i] < -1e-6) negatives++;
    else zeros++;
  }
  // Se tutti dallo stesso lato: no intersezione
  if(positives === 3 || negatives === 3) return null;
  if(zeros === 3) return null; // triangolo nel piano, ignoro
  
  // Trovo le 2 edge che attraversano il piano
  var pts = [];
  for(var i = 0; i < 3; i++){
    var j = (i + 1) % 3;
    if(d[i] * d[j] < 0){
      // Edge attraversa il piano, interpolo
      var t = d[i] / (d[i] - d[j]);
      pts.push([
        p[i][0] + t * (p[j][0] - p[i][0]),
        p[i][1] + t * (p[j][1] - p[i][1]),
        p[i][2] + t * (p[j][2] - p[i][2])
      ]);
    } else if(d[i] === 0){
      pts.push([p[i][0], p[i][1], p[i][2]]);
    }
  }
  if(pts.length === 2) return pts;
  return null;
}

// Estrai tutti i segmenti di intersezione da una BufferGeometry trasformata
function extractCutSegments(geometry, matrixWorld, planePoint, planeNormal){
  var pos = geometry.attributes.position.array;
  var nTri = pos.length / 9;
  var segments = [];
  var v = new THREE.Vector3();
  for(var i = 0; i < nTri; i++){
    var ni = i * 9;
    var tri = [];
    for(var j = 0; j < 3; j++){
      v.set(pos[ni + j*3], pos[ni + j*3 + 1], pos[ni + j*3 + 2]);
      if(matrixWorld) v.applyMatrix4(matrixWorld);
      tri.push([v.x, v.y, v.z]);
    }
    var seg = intersectPlaneTriangle(tri, planePoint, planeNormal);
    if(seg) segments.push(seg);
  }
  return segments;
}

// Proietta punto 3D su piano 2D (assi u, w definiti dal piano)
function projectTo2D(pt3, origin, uAxis, wAxis){
  var dx = pt3[0] - origin[0], dy = pt3[1] - origin[1], dz = pt3[2] - origin[2];
  return [
    dx * uAxis[0] + dy * uAxis[1] + dz * uAxis[2],
    dx * wAxis[0] + dy * wAxis[1] + dz * wAxis[2]
  ];
}

// Crea una CanvasTexture lineare con due colori e angolo
function makeGradientTexture(c1, c2, angleDeg){
  // Delega alla fonte unica ds/syn-render.js (logica identica: canvas 2D sRGB, stesso angolo/colori).
  return SynRender.makeGradientTexture(THREE, c1, c2, angleDeg);
}
