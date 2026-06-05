// gate.mjs — Equivalence gate harness per l'estrazione del Clip Engine.
//
// Confronto A/B: stesso harness, stesso scenario deterministico; cambia SOLO la
// sorgente del motore (blocco verbatim clip-old.js  vs  modulo ds/syn-clip.js).
// Qualunque caratteristica dell'ambiente (shim DOM, THREE) si cancella tra i due
// run -> resta provata l'equivalenza pura del comportamento.
//
// Uso:  node gate.mjs old > clip-golden.json
//       node gate.mjs new > clip-after.json
//
// Il motore clip NON richiede rendering WebGL per G1/G2 (calcola piani/stencil/
// stato senza renderer.render()), quindi gira headless con THREE puro in Node.
// Template riusabile per le estrazioni future (backbone numerico/strutturale).

import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as THREE from './vendor/three.module.min.js';

const which = process.argv[2];
if (which !== 'old' && which !== 'new') {
  console.error('uso: node gate.mjs <old|new>');
  process.exit(2);
}

const W = globalThis;

// ── Bridge THREE come l'app (importmap + window.THREE = Object.assign copy, CM ON) ──
W.window = W;
W.THREE = Object.assign({}, THREE);
W.THREE.ColorManagement.enabled = true;

// ── Shim DOM minimale (deterministico, identico per old e new) ──
function makeClassList(initial) {
  const s = new Set(initial || []);
  return {
    add: (...c) => c.forEach(x => s.add(x)),
    remove: (...c) => c.forEach(x => s.delete(x)),
    contains: (c) => s.has(c),
    toggle: (c, force) => {
      if (force === undefined) { if (s.has(c)) { s.delete(c); return false; } s.add(c); return true; }
      if (force) { s.add(c); return true; } s.delete(c); return false;
    }
  };
}
const els = {};
function reg(id, e) { e.id = id; els[id] = e; return e; }
reg('panelMuaList', { style: { display: '' } });
reg('panelAngleList', { style: { display: '' } });
reg('panelAxisInfo', { style: { display: '' } });
reg('panelFresabilita', { style: { display: '' } });
reg('panelTaglio', { style: { display: 'none' } });
reg('btnOpenTaglio', { disabled: true, classList: makeClassList() });
reg('tagToggle', { checked: false });
reg('tagFlip', { checked: false });
reg('tagPos', { min: '-50', max: '50', value: '0' });
reg('tagPosVal', { textContent: '0' });

// radio asse (markup reale: #tagAxisRadio input[name=sezAxis], default Y checked+label.active)
const radios = ['x', 'y', 'z'].map((v) => {
  const lab = { classList: makeClassList(v === 'y' ? ['active'] : []) };
  return { value: v, name: 'sezAxis', checked: (v === 'y'), _label: lab, closest: (sel) => (sel === 'label' ? lab : null) };
});

W.document = {
  getElementById: (id) => els[id] || null,
  querySelectorAll: (sel) => (sel.includes('sezAxis') ? radios.slice() : [])
};

// ── Carica il motore (old verbatim / new modulo) ──
let code;
if (which === 'old') {
  code = readFileSync(new URL('./clip-old.js', import.meta.url), 'utf8');
  // Epilog: solleva esplicitamente dichiarazioni a globalThis (robusto comunque
  // si comporti runInThisContext). Eseguito nello stesso scope del blocco.
  const fns = ['synClipArr', 'synMakeStencilGroup', 'synPositionCap', 'synUpdateClipPlane',
    'synRebuildClip', 'openTaglio', 'closeTaglio', 'tagSyncUI', 'tagOnToggle', 'tagOnAxis',
    'tagOnPos', 'tagOnFlip', 'tagForceScanOpaque'];
  const vars = ['synClipPlane', 'synClipEnabled', 'synClipAxis', 'synClipPos', 'synClipFlip',
    'synStencilGroup', 'synCapMesh', 'synClipCenter', 'synClipDiag', 'tagState'];
  code += '\n' + fns.concat(vars).map((n) => `globalThis.${n}=${n};`).join('');
} else {
  code = readFileSync(new URL('../../../backend/static/ds/syn-clip.js', import.meta.url), 'utf8');
}
vm.runInThisContext(code);

// ── Capture helpers (precisione PIENA: nessun arrotondamento -> coglie scostamenti minimi) ──
const vec = (v) => ({ x: v.x, y: v.y, z: v.z });
const quat = (q) => ({ x: q.x, y: q.y, z: q.z, w: q.w });

function g1() {
  const sg = W.synStencilGroup, cap = W.synCapMesh, p = W.synClipPlane;
  return {
    plane: p ? { nx: p.normal.x, ny: p.normal.y, nz: p.normal.z, constant: p.constant } : null,
    center: W.synClipCenter ? vec(W.synClipCenter) : null,
    diag: W.synClipDiag,
    clipArrLen: W.synClipArr().length,
    scanRenderOrder: W.scanMesh.renderOrder,
    scanClipPlanesLen: (W.scanMesh.material.clippingPlanes || []).length,
    stencilGroup: sg ? {
      visible: sg.visible,
      childCount: sg.children.length,
      children: sg.children.map((m) => ({
        side: m.material.side, renderOrder: m.renderOrder,
        depthWrite: m.material.depthWrite, depthTest: m.material.depthTest, colorWrite: m.material.colorWrite,
        stencilWrite: m.material.stencilWrite, stencilFunc: m.material.stencilFunc,
        stencilFail: m.material.stencilFail, stencilZFail: m.material.stencilZFail, stencilZPass: m.material.stencilZPass,
        clipPlanesLen: (m.material.clippingPlanes || []).length
      }))
    } : null,
    cap: cap ? {
      visible: cap.visible, renderOrder: cap.renderOrder,
      pos: vec(cap.position), quat: quat(cap.quaternion),
      geoW: cap.geometry.parameters.width, geoH: cap.geometry.parameters.height,
      matColor: cap.material.color.getHex(), matSpecular: cap.material.specular.getHex(),
      matShininess: cap.material.shininess, matSide: cap.material.side,
      stencilRef: cap.material.stencilRef, stencilFunc: cap.material.stencilFunc,
      stencilFail: cap.material.stencilFail, stencilZFail: cap.material.stencilZFail,
      stencilZPass: cap.material.stencilZPass, stencilWrite: cap.material.stencilWrite
    } : null
  };
}
function g2dom() {
  const e = (id) => W.document.getElementById(id);
  return {
    panelTaglio: e('panelTaglio').style.display, panelMuaList: e('panelMuaList').style.display,
    panelAngleList: e('panelAngleList').style.display, panelAxisInfo: e('panelAxisInfo').style.display,
    panelFresabilita: e('panelFresabilita').style.display,
    btnDisabled: e('btnOpenTaglio').disabled, btnActive: e('btnOpenTaglio').classList.contains('active'),
    tagToggle: e('tagToggle').checked, tagFlip: e('tagFlip').checked,
    tagPosVal: e('tagPosVal').textContent, tagPosValue: e('tagPos').value,
    tagPosMin: e('tagPos').min, tagPosMax: e('tagPos').max,
    radios: W.document.querySelectorAll('#tagAxisRadio input[name="sezAxis"]')
      .map((r) => ({ value: r.value, checked: r.checked, labelActive: r.closest('label').classList.contains('active') }))
  };
}

// ── Scenario deterministico (scanMesh sintetica: box asimmetrico, no dati paziente) ──
function run() {
  const T = W.THREE;
  W.scene = new T.Scene();
  W.envSettings = { scanColor: '#cfd8dc' };
  const geo = new T.BoxGeometry(10, 6, 4); geo.translate(2, -1, 3);
  const mat = new T.MeshPhongMaterial({ color: new T.Color(W.envSettings.scanColor), side: T.DoubleSide, transparent: true, opacity: 0.5 });
  W.scanMesh = new T.Mesh(geo, mat);
  W.scene.add(W.scanMesh);

  const g1steps = {};
  W.synRebuildClip();                 // default: axis y, pos 0, flip false, enabled false
  g1steps.afterRebuild = g1();
  W.synClipAxis = 'x'; W.synClipPos = 1.5; W.synClipFlip = true; W.synClipEnabled = true;
  W.synUpdateClipPlane();
  g1steps.afterUpdate = g1();
  W.synPositionCap();
  g1steps.afterPositionCap = { capPos: vec(W.synCapMesh.position), capQuat: quat(W.synCapMesh.quaternion) };

  const g2 = {};
  W.tagSyncUI(); g2.afterSync = g2dom();
  W.openTaglio(); g2.afterOpen = g2dom();
  W.closeTaglio(); g2.afterClose = g2dom();
  W.tagOnPos('3.5'); g2.afterPos = { synClipPos: W.synClipPos, tagPosVal: W.document.getElementById('tagPosVal').textContent };
  W.tagOnAxis('z'); g2.afterAxis = { synClipAxis: W.synClipAxis, dom: g2dom() };
  W.tagOnFlip(false); g2.afterFlip = { synClipFlip: W.synClipFlip };
  W.tagOnToggle(false); g2.afterToggleOff = { synClipEnabled: W.synClipEnabled };
  W.tagOnToggle(true); g2.afterToggleOn = { synClipEnabled: W.synClipEnabled, scanOpacity: W.scanMesh.material.opacity, scanTransparent: W.scanMesh.material.transparent };

  return { engine: which, g1: g1steps, g2 };
}

try {
  process.stdout.write(JSON.stringify(run(), null, 2) + '\n');
} catch (err) {
  console.error('GATE ERROR (' + which + '):', err && err.stack ? err.stack : err);
  process.exit(1);
}
