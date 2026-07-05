// Suite scenari F5 — identica per run-old e run-new; deterministica (zero Date/random).
// Copre il gate dello studio: tab, save, reset/cancel + snapshot localStorage e DOM.
// Ogni passo e' in try/catch: un errore diventa parte dello snapshot (e deve essere
// IDENTICO fra le varianti perche' il gate passi).
(function () {
  var snap = { steps: {}, errors: {} };
  function step(name, fn) {
    try { snap.steps[name] = fn(); }
    catch (e) { snap.errors[name] = String(e && e.message || e); }
  }
  function lsDump() {
    var o = {};
    for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); o[k] = localStorage.getItem(k); }
    return o;
  }
  function tabState() {
    return ["settingsTabEnv", "settingsTabMach", "settingsTabUi", "settingsTabAlgo"].map(function (id) {
      var el = document.getElementById(id);
      return id + ":" + (el ? el.style.display : "MISSING");
    }).join("|");
  }

  localStorage.clear();

  // 0. esposizione: tutte le API attese raggiungibili come globali (lezione 8.83.1)
  step("typeof", function () {
    var names = ["syncMuaColorsFromPalette","applyRenderModeToMesh","applyRenderModeToScene","envBgCss",
      "applyEnvToScene","onEnvBgPickerChange","onEnvBgChange","onEnvBgCustomOpen","onEnvCustomModeChange",
      "updateCustomModeUI","onEnvBgCustomPrimary","onEnvBgCustomSecondary","onEnvBgAngleChange",
      "updateCustomPreview","onEnvScanColorChange","onEnvPaletteChange","onEnvRenderModeChange",
      "updateRenderModeUI","updateEnvSwatchBorders","buildPaletteGrid","switchSettingsTab",
      "applyControlsSettings","onControlsSettingChange","resetControlsSettings","syncControlsSettingsUI",
      "syntesisGetUiZoom","applyUiZoom","loadUiZoom","refreshUiZoomButtons","openSettings","closeSettings",
      "cancelSettings","applyMillerPreset","updateMillerSettings","updateSettingsUIState","saveSettings",
      "setViewMode","updateViewModeBar","syntAuthRefreshUI","syntAuthClose","syntAuthSwitchTab","syntAuthDoLogin"];
    return names.map(function (n) { return n + ":" + typeof window[n]; }).join("|");
  });

  // 1. tab switch (env -> mach -> ui -> env)
  step("tab_mach", function () { switchSettingsTab("mach"); return tabState(); });
  step("tab_ui", function () { switchSettingsTab("ui"); return tabState(); });
  step("tab_env", function () { switchSettingsTab("env"); return tabState(); });

  // 2. ambiente: bg, palette, css, sync colori
  step("bg_change", function () { onEnvBgChange("blue"); return JSON.stringify(envSettings) + "|" + envBgCss(); });
  step("palette", function () { onEnvPaletteChange("vivid"); return JSON.stringify(MUA_COLORS); });
  step("scan_color", function () { onEnvScanColorChange("#aabbcc"); return envSettings.scanColor; });
  step("render_mode", function () { onEnvRenderModeChange("wireframe"); return envSettings.renderMode; });
  step("custom_bg", function () {
    onEnvBgCustomOpen(); onEnvBgCustomPrimary("#101010"); onEnvBgCustomSecondary("#efefef");
    onEnvBgAngleChange(90);
    return JSON.stringify(envSettings) + "|" + envBgCss();
  });

  // 3. dialog: open -> modifica -> cancel (ripristino) / open -> save (persistenza)
  step("open_cancel", function () {
    openSettings();
    var before = JSON.stringify(envSettings);
    onEnvBgChange("dark"); onEnvPaletteChange("pastel");
    cancelSettings();
    return (JSON.stringify(envSettings) === before) + "|" + JSON.stringify(envSettings);
  });
  step("open_save", function () {
    openSettings();
    onEnvBgChange("blue"); onEnvPaletteChange("monoblue");
    updateMillerSettings(); saveSettings();
    return JSON.stringify(envSettings);
  });

  // 4. fresatore: preset -> MAX_MILLING_ANGLE
  step("miller", function () {
    var sel = document.getElementById("millerPreset");
    if (sel) { sel.value = "generic4"; applyMillerPreset(); updateMillerSettings(); }
    return JSON.stringify(millerSettings) + "|MAX=" + MAX_MILLING_ANGLE;
  });

  // 5. controlli 3D: change + reset
  step("controls", function () {
    onControlsSettingChange("rotate", 1.8); onControlsSettingChange("zoom", 0.5);
    var mid = JSON.stringify(controlsSettings);
    resetControlsSettings();
    return mid + "|" + JSON.stringify(controlsSettings);
  });

  // 6. UI zoom
  step("zoom", function () {
    applyUiZoom(1.2, { persist: true });
    return document.body.style.zoom + "|" + syntesisGetUiZoom();
  });

  // 7. vmBar: setViewMode + stato barra
  step("vmbar", function () {
    setViewMode("wireframe");
    var bar = document.getElementById("vmBar");
    return (bar ? bar.parentNode === document.body : "nobar") + "|" +
      Array.prototype.map.call(bar ? bar.querySelectorAll("[data-vm]") : [], function (b) {
        return (b.getAttribute("data-vm") || "") + "=" + b.className;
      }).join(",");
  });

  // 8. auth UI: refresh senza token / switch tab
  step("auth", function () {
    syntAuthRefreshUI();
    var label = document.getElementById("fmAuthLabel").textContent;
    syntAuthSwitchTab("register");
    var reg = document.getElementById("syntAuthRegisterForm").style.display;
    var log = document.getElementById("syntAuthLoginForm").style.display;
    syntAuthClose();
    return label + "|reg:" + reg + "|login:" + log + "|ov:" + document.getElementById("syntAuthOverlay").style.display;
  });

  // 9. snapshot finale localStorage + chiamate alle fn stub del monolite
  step("localStorage", lsDump);
  step("stub_calls", function () { return (window.__calls || []).join("|"); });

  window.__SNAPSHOT = snap;
  if (window.parent !== window) window.parent.postMessage({ harness: true, snap: snap }, "*");
})();
