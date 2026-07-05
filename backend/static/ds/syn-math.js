/*
 * syn-math.js — libreria numerica PURA di Syntesis-ICP (Fase 4 modularizzazione, 8.85.0).
 *
 * CONTRATTO: zero stato, zero DOM, zero window.*; input -> output deterministico.
 *   - parseSTL(buffer)                  STL binario/ASCII -> {geometry(THREE), triangles}
 *   - centroid / kabsch / matMul / transpose / det3 / svd3x3   algebra allineamento (Kabsch+SVD Jacobi)
 *   - samplePoints(geometry, count)     campionamento baricentri triangoli
 *   - runICP(fixed, moving, maxIter, w) ICP point-to-point con pesi -> {R, t, rmsd}
 *   - _mcMedian/_mcTukey/_mcBasis/_mcSolveLin/_mcDot   helper IRLS/LM del Method C
 *
 * CARICAMENTO: <script src> classico NON-strict in testa (prima del MAIN), nomi bare
 * globali come nel monolite. THREE e' letto SOLO a call-time (mai a parse-time) ->
 * sicuro col loader r169 (importmap ESM + bridge window.THREE).
 * GATE: golden-master numerico a precisione piena (Object.is) su fixtures reali +
 * casi degeneri -> node scripts/gate/purelib/gate.mjs --from-ds --check
 * NON aggiungere qui funzioni che leggono stato applicativo: e' il confine del modulo.
 */

// STL Parser
function parseSTL(buffer){var dv=new DataView(buffer),n=dv.getUint32(80,true);if(84+n*50===buffer.byteLength&&n>0){var geo=new THREE.BufferGeometry(),verts=new Float32Array(n*9),norms=new Float32Array(n*9);for(var i=0;i<n;i++){var off=84+i*50,nx=dv.getFloat32(off,true),ny=dv.getFloat32(off+4,true),nz=dv.getFloat32(off+8,true);for(var j=0;j<3;j++){var vi=off+12+j*12;verts[i*9+j*3]=dv.getFloat32(vi,true);verts[i*9+j*3+1]=dv.getFloat32(vi+4,true);verts[i*9+j*3+2]=dv.getFloat32(vi+8,true);norms[i*9+j*3]=nx;norms[i*9+j*3+1]=ny;norms[i*9+j*3+2]=nz}}geo.setAttribute('position',new THREE.BufferAttribute(verts,3));geo.setAttribute('normal',new THREE.BufferAttribute(norms,3));return{geometry:geo,triangles:n}}var text=new TextDecoder().decode(buffer),positions=[],normals=[],fn=[0,0,0];text.split('\n').forEach(function(line){line=line.trim();if(line.startsWith('facet normal')){var p=line.split(/\s+/);fn=[parseFloat(p[2]),parseFloat(p[3]),parseFloat(p[4])]}else if(line.startsWith('vertex')){var p=line.split(/\s+/);positions.push(parseFloat(p[1]),parseFloat(p[2]),parseFloat(p[3]));normals.push(fn[0],fn[1],fn[2])}});var geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(positions),3));geo.setAttribute('normal',new THREE.BufferAttribute(new Float32Array(normals),3));return{geometry:geo,triangles:positions.length/9}}

// ICP
function centroid(pts){var n=pts.length,c=[0,0,0];for(var i=0;i<n;i++){c[0]+=pts[i][0];c[1]+=pts[i][1];c[2]+=pts[i][2]}return[c[0]/n,c[1]/n,c[2]/n]}

function kabsch(A,B,W){var n=A.length;if(n<3)return{R:[[1,0,0],[0,1,0],[0,0,1]],t:[0,0,0]};var w=W||A.map(function(){return 1}),sW=0;for(var i=0;i<n;i++)sW+=w[i];var cA=[0,0,0],cB=[0,0,0];for(var i=0;i<n;i++){cA[0]+=A[i][0]*w[i];cA[1]+=A[i][1]*w[i];cA[2]+=A[i][2]*w[i];cB[0]+=B[i][0]*w[i];cB[1]+=B[i][1]*w[i];cB[2]+=B[i][2]*w[i]}cA[0]/=sW;cA[1]/=sW;cA[2]/=sW;cB[0]/=sW;cB[1]/=sW;cB[2]/=sW;var Ac=A.map(function(p){return[p[0]-cA[0],p[1]-cA[1],p[2]-cA[2]]});var Bc=B.map(function(p){return[p[0]-cB[0],p[1]-cB[1],p[2]-cB[2]]});var H=[[0,0,0],[0,0,0],[0,0,0]];for(var i=0;i<n;i++)for(var j=0;j<3;j++)for(var k=0;k<3;k++)H[j][k]+=w[i]*Ac[i][j]*Bc[i][k];var sv=svd3x3(H);var R=matMul(sv.V,transpose(sv.U));if(det3(R)<0){sv.V[0][2]*=-1;sv.V[1][2]*=-1;sv.V[2][2]*=-1;R=matMul(sv.V,transpose(sv.U))}var t=[cB[0]-(R[0][0]*cA[0]+R[0][1]*cA[1]+R[0][2]*cA[2]),cB[1]-(R[1][0]*cA[0]+R[1][1]*cA[1]+R[1][2]*cA[2]),cB[2]-(R[2][0]*cA[0]+R[2][1]*cA[1]+R[2][2]*cA[2])];return{R:R,t:t}}

function matMul(A,B){var R=[[0,0,0],[0,0,0],[0,0,0]];for(var i=0;i<3;i++)for(var j=0;j<3;j++)for(var k=0;k<3;k++)R[i][j]+=A[i][k]*B[k][j];return R}

function transpose(M){return[[M[0][0],M[1][0],M[2][0]],[M[0][1],M[1][1],M[2][1]],[M[0][2],M[1][2],M[2][2]]]}

function det3(M){return M[0][0]*(M[1][1]*M[2][2]-M[1][2]*M[2][1])-M[0][1]*(M[1][0]*M[2][2]-M[1][2]*M[2][0])+M[0][2]*(M[1][0]*M[2][1]-M[1][1]*M[2][0])}

function svd3x3(H){var ATA=matMul(transpose(H),H);var V=[[1,0,0],[0,1,0],[0,0,1]],S=[[ATA[0][0],ATA[0][1],ATA[0][2]],[ATA[1][0],ATA[1][1],ATA[1][2]],[ATA[2][0],ATA[2][1],ATA[2][2]]];for(var iter=0;iter<50;iter++){for(var p=0;p<3;p++)for(var q=p+1;q<3;q++){if(Math.abs(S[p][q])<1e-10)continue;var tau=(S[q][q]-S[p][p])/(2*S[p][q]);var t=((tau>=0)?1:-1)/(Math.abs(tau)+Math.sqrt(1+tau*tau));var c=1/Math.sqrt(1+t*t),s=t*c;var G=[[1,0,0],[0,1,0],[0,0,1]];G[p][p]=c;G[q][q]=c;G[p][q]=s;G[q][p]=-s;S=matMul(matMul(transpose(G),S),G);V=matMul(V,G)}}var sigma=[Math.sqrt(Math.max(0,S[0][0])),Math.sqrt(Math.max(0,S[1][1])),Math.sqrt(Math.max(0,S[2][2]))];var U=[[0,0,0],[0,0,0],[0,0,0]];for(var i=0;i<3;i++){if(sigma[i]>1e-10){for(var j=0;j<3;j++){U[j][i]=0;for(var k=0;k<3;k++)U[j][i]+=H[j][k]*V[k][i];U[j][i]/=sigma[i]}}else{U[0][i]=(i===0)?1:0;U[1][i]=(i===1)?1:0;U[2][i]=(i===2)?1:0}}return{U:U,S:sigma,V:V}}

function samplePoints(geometry,count){var pos=geometry.attributes.position.array,nTri=pos.length/9,pts=[],step=Math.max(1,Math.floor(nTri/count));for(var i=0;i<nTri&&pts.length<count;i+=step){var idx=i*9;pts.push([(pos[idx]+pos[idx+3]+pos[idx+6])/3,(pos[idx+1]+pos[idx+4]+pos[idx+7])/3,(pos[idx+2]+pos[idx+5]+pos[idx+8])/3])}return pts}

function runICP(fixedPts,movingPts,maxIter,mW){maxIter=maxIter||40;var moving=movingPts.map(function(p){return p.slice()});var W=mW||movingPts.map(function(){return 1});var Racc=[[1,0,0],[0,1,0],[0,0,1]],tacc=[0,0,0];for(var it=0;it<maxIter;it++){var pf=[],pm=[],pw=[];for(var i=0;i<moving.length;i++){var minD=Infinity,minJ=-1;for(var j=0;j<fixedPts.length;j++){var dx=moving[i][0]-fixedPts[j][0],dy=moving[i][1]-fixedPts[j][1],dz=moving[i][2]-fixedPts[j][2],d=dx*dx+dy*dy+dz*dz;if(d<minD){minD=d;minJ=j}}pf.push(fixedPts[minJ]);pm.push(moving[i]);pw.push(W[i])}var kb=kabsch(pm,pf,pw);for(var i=0;i<moving.length;i++){var p=moving[i],np=[0,0,0];for(var j=0;j<3;j++)np[j]=kb.R[j][0]*p[0]+kb.R[j][1]*p[1]+kb.R[j][2]*p[2]+kb.t[j];moving[i]=np}Racc=matMul(kb.R,Racc);tacc=[kb.R[0][0]*tacc[0]+kb.R[0][1]*tacc[1]+kb.R[0][2]*tacc[2]+kb.t[0],kb.R[1][0]*tacc[0]+kb.R[1][1]*tacc[1]+kb.R[1][2]*tacc[2]+kb.t[1],kb.R[2][0]*tacc[0]+kb.R[2][1]*tacc[1]+kb.R[2][2]*tacc[2]+kb.t[2]]}var rmsd=0;for(var i=0;i<moving.length;i++){var minD=Infinity;for(var j=0;j<fixedPts.length;j++){var dx=moving[i][0]-fixedPts[j][0],dy=moving[i][1]-fixedPts[j][1],dz=moving[i][2]-fixedPts[j][2];minD=Math.min(minD,dx*dx+dy*dy+dz*dz)}rmsd+=minD}rmsd=Math.sqrt(rmsd/moving.length);return{R:Racc,t:tacc,rmsd:rmsd}}

function _mcMedian(arr){ var s=arr.slice().sort(function(a,b){return a-b;}); var n=s.length,m=n>>1; return (n%2===0)?(s[m-1]+s[m])/2:s[m]; }

function _mcTukey(res,c){
  var med=_mcMedian(res); var ad=new Array(res.length),i;
  for(i=0;i<res.length;i++) ad[i]=Math.abs(res[i]-med);
  var s=Math.max(1.4826*_mcMedian(ad),1e-6); var w=new Array(res.length);
  for(i=0;i<res.length;i++){ var z=(res[i]-med)/s, az=Math.abs(z); w[i]=(az>=c)?0:Math.pow(1-(z/c)*(z/c),2); }
  return w;
}

function _mcBasis(ax){
  var aL=Math.hypot(ax[0],ax[1],ax[2])||1; var a=[ax[0]/aL,ax[1]/aL,ax[2]/aL];
  var ref=(Math.abs(a[0])<0.8)?[1,0,0]:[0,1,0];
  var u=[a[1]*ref[2]-a[2]*ref[1], a[2]*ref[0]-a[0]*ref[2], a[0]*ref[1]-a[1]*ref[0]];
  var uL=Math.hypot(u[0],u[1],u[2])||1; u=[u[0]/uL,u[1]/uL,u[2]/uL];
  var v=[a[1]*u[2]-a[2]*u[1], a[2]*u[0]-a[0]*u[2], a[0]*u[1]-a[1]*u[0]];
  return {u:u,v:v,a:a};
}

function _mcSolveLin(A,b){
  var n=b.length,i,r,c; var M=[]; for(i=0;i<n;i++){ M[i]=A[i].slice(); M[i].push(b[i]); }
  for(i=0;i<n;i++){
    var p=i; for(r=i+1;r<n;r++) if(Math.abs(M[r][i])>Math.abs(M[p][i])) p=r;
    if(Math.abs(M[p][i])<1e-20) return null;
    var t=M[i]; M[i]=M[p]; M[p]=t;
    for(r=i+1;r<n;r++){ var f=M[r][i]/M[i][i]; for(c=i;c<=n;c++) M[r][c]-=f*M[i][c]; }
  }
  var x=new Array(n);
  for(i=n-1;i>=0;i--){ var s=M[i][n]; for(c=i+1;c<n;c++) s-=M[i][c]*x[c]; x[i]=s/M[i][i]; }
  return x;
}

function _mcDot(a,b){ var s=0; for(var i=0;i<a.length;i++) s+=a[i]*b[i]; return s; }
