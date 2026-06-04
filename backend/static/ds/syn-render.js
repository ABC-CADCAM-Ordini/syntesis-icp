/*
 * syn-render.js — fonte unica MINIMALE del setup di rendering 3D condiviso
 * fra le superfici Three.js r169 di Syntesis-ICP (/analizzare, /vedere, /dashboard).
 *
 * CONFINE (deciso in F1, sessione allineamento motori r169): SOLO colore/luci/pipeline.
 *   - applyRendererPipeline(THREE, renderer)  -> ColorManagement/outputColorSpace/toneMapping/clipping
 *   - addCameraLightRig(THREE, scene, camera) -> rig 3 luci (ambient + key + fill) sulla camera
 *   - makeGradientTexture(THREE, c1, c2, angleDeg) -> CanvasTexture gradiente marcata sRGB
 * Il clip/stencil resta PER-FILE (vedere ha il PiP con struttura diversa da analizzare;
 * tenere il core piccolo protegge il retrofit di /analizzare a comportamento invariato).
 * NON allargare questo nucleo oltre colore/luci/pipeline.
 *
 * CARICAMENTO: <script src="/static/ds/syn-render.js"> classico (NON module),
 * come ds/syn-gate.js. NON tocca THREE a parse-time (riceve THREE per parametro)
 * -> sicuro col loader r169 (importmap ESM + bridge window.THREE): invocare gli
 * helper SOLO dopo l'evento 'three-ready' (quando window.THREE e' pronto).
 *
 * VALORI CANONICI (validati in produzione su /analizzare 8.8.1):
 *   - THREE.ColorManagement.enabled = true (8.8.1): pipeline colore coerente
 *     (decode sRGB->lineare in input, encode in output) -> "scelto ~= visto".
 *   - renderer.outputColorSpace = SRGBColorSpace (8.7.2): resa calda, non cruda lineare.
 *   - renderer.toneMapping = NoToneMapping: nessun tone mapping (default THREE; reso esplicito).
 *   - renderer.localClippingEnabled = true: abilita i clipping plane (motore Taglio/cutview).
 *   - Luci: rapporto r128 0.4:0.6:0.25 scalato x3 = Ambient 1.2 / key 1.8 / fill bluastra 0.75.
 *     CM ON scurisce l'input -> il x3 compensa; rapporto direzionale:ambient 1.5 = chiaroscuro r128.
 *     Direzionali parentate alla camera (ruotano col punto di vista).
 *   - Gradiente sfondo: canvas 2D (sRGB) marcato SRGBColorSpace, altrimenti con CM ON
 *     verrebbe letto come lineare e lo sfondo si schiarirebbe/brucerebbe.
 */
(function (root) {
  "use strict";

  // Applica la pipeline colore/clipping canonica a un renderer r169.
  // ColorManagement e' un flag GLOBALE di THREE (non per-renderer): lo forziamo ON
  // (su /analizzare e' gia' settato nel bridge del loader -> qui e' idempotente;
  // su /vedere e /dashboard questa e' l'unica accensione).
  function applyRendererPipeline(THREE, renderer) {
    THREE.ColorManagement.enabled = true;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.localClippingEnabled = true;
    return renderer;
  }

  // Aggiunge il rig di 3 luci canonico: ambient nella scena, key + fill parentate
  // alla camera (cosi' ruotano col punto di vista). Aggiunge anche la camera alla
  // scena (necessario perche' le luci figlie della camera contribuiscano).
  function addCameraLightRig(THREE, scene, camera) {
    var ambient = new THREE.AmbientLight(0xffffff, 1.2);
    scene.add(ambient);
    var key = new THREE.DirectionalLight(0xffffff, 1.8);
    key.position.set(1, 1, 1);
    camera.add(key);
    var fill = new THREE.DirectionalLight(0x6688aa, 0.75);
    fill.position.set(-1, -0.5, -1);
    camera.add(fill);
    scene.add(camera);
    return { ambient: ambient, key: key, fill: fill };
  }

  // Crea una CanvasTexture gradiente fra due colori a un dato angolo
  // (0=top, 90=right, 180=bottom, 270=left). Marcata sRGB per coerenza con CM ON.
  function makeGradientTexture(THREE, c1, c2, angleDeg) {
    var size = 256;
    var cnv = document.createElement('canvas');
    cnv.width = size; cnv.height = size;
    var ctx = cnv.getContext('2d');
    var rad = angleDeg * Math.PI / 180;
    var cx = size / 2, cy = size / 2;
    var dx = Math.sin(rad) * size / 2;
    var dy = -Math.cos(rad) * size / 2;
    var x1 = cx - dx, y1 = cy - dy;
    var x2 = cx + dx, y2 = cy + dy;
    var grd = ctx.createLinearGradient(x1, y1, x2, y2);
    grd.addColorStop(0, c1);
    grd.addColorStop(1, c2);
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, size, size);
    var tex = new THREE.CanvasTexture(cnv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }

  root.SynRender = {
    applyRendererPipeline: applyRendererPipeline,
    addCameraLightRig: addCameraLightRig,
    makeGradientTexture: makeGradientTexture
  };
})(window);
