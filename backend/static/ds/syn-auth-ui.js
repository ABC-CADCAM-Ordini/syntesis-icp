/* syn-auth-ui.js — login/registrazione in-app (Fase 5, 8.86.0). Blocco IIFE §AUTH-LOGIN
 * rilocato VERBATIM dalla posizione originale (fine body, dopo il markup syntAuth*).
 * Espone window.syntAuthRefreshUI/syntAuthOpen/syntAuthClose/syntAuthSwitchTab/syntAuthDoLogin/...
 * Il banner §AUTH-LOGIN resta nel monolite (commento HTML alla posizione del blocco).
 * GATE: scripts/gate/env/gate.mjs (byte-verbatim vs HEAD + probe browser). */
// v7.3.9.082 - Sistema login/registrazione FastAPI backend
(function(){
  var SYNT_TOKEN_KEY = 'syntesis_token';
  var SYNT_USER_KEY = 'syntesis_user';

  function syntAuthGetToken(){
    try { return localStorage.getItem(SYNT_TOKEN_KEY) || ''; } catch(e){ return ''; }
  }
  function syntAuthGetUser(){
    try { return JSON.parse(localStorage.getItem(SYNT_USER_KEY) || 'null'); } catch(e){ return null; }
  }
  function syntAuthSetToken(token, user){
    try {
      localStorage.setItem(SYNT_TOKEN_KEY, token);
      localStorage.setItem(SYNT_USER_KEY, JSON.stringify(user));
    } catch(e){}
  }
  function syntAuthClearToken(){
    try {
      localStorage.removeItem(SYNT_TOKEN_KEY);
      localStorage.removeItem(SYNT_USER_KEY);
    } catch(e){}
  }

  // Refresh stato UI: aggiorna voce menu File
  window.syntAuthRefreshUI = function(){
    var token = syntAuthGetToken();
    var user = syntAuthGetUser();
    var label = document.getElementById('fmAuthLabel');
    var key = document.getElementById('fmAuthKey');
    var dash = document.getElementById('fmDashboardItem');
    if(!label) return;
    if(token && user){
      label.textContent = 'Esci (' + (user.name || user.email || 'utente') + ')';
      key.textContent = 'LOGOUT';
      if(dash) dash.style.display = 'flex';
    } else {
      label.textContent = 'Accedi';
      key.textContent = 'LOGIN';
      if(dash) dash.style.display = 'none';
    }
  };

  // Click sul menu Accedi/Esci
  window.syntAuthClick = function(){
    var token = syntAuthGetToken();
    if(token){
      // Logout
      if(!confirm('Disconnettersi dall\'area personale?')) return;
      syntAuthClearToken();
      window.syntAuthRefreshUI();
      try { showStatus && showStatus('Disconnesso.'); } catch(e){}
    } else {
      // Apri modal login
      window.syntAuthOpen('login');
    }
  };

  window.syntAuthOpen = function(tab){
    var ov = document.getElementById('syntAuthOverlay');
    if(!ov) return;
    ov.style.display = 'flex';
    syntAuthSwitchTab(tab || 'login');
    setTimeout(function(){
      var f = document.getElementById(tab === 'register' ? 'syntAuthRegEmail' : 'syntAuthLoginEmail');
      if(f) f.focus();
    }, 60);
  };
  window.syntAuthClose = function(){
    var ov = document.getElementById('syntAuthOverlay');
    if(ov) ov.style.display = 'none';
    // 8.80.4: guardie — #syntAuthRegErr fu rimosso col form di registrazione inline
    // (ora link a /accedi): il lookup nudo lanciava TypeError a ogni chiusura/ESC
    // e sopprimeva il toast post-login dentro il try di syntAuthDoLogin.
    var _le = document.getElementById('syntAuthLoginErr');
    if(_le) _le.textContent = '';
    var _re = document.getElementById('syntAuthRegErr');
    if(_re) _re.textContent = '';
  };
  window.syntAuthSwitchTab = function(tab){
    var loginForm = document.getElementById('syntAuthLoginForm');
    var regForm = document.getElementById('syntAuthRegisterForm');
    var loginTab = document.getElementById('syntAuthTabLogin');
    var regTab = document.getElementById('syntAuthTabRegister');
    if(tab === 'register'){
      loginForm.style.display = 'none';
      regForm.style.display = 'block';
      loginTab.style.background = 'transparent';
      loginTab.style.color = '#7A90A4';
      loginTab.style.boxShadow = 'none';
      regTab.style.background = '#fff';
      regTab.style.color = '#0065B3';
      regTab.style.boxShadow = '0 1px 4px rgba(0,50,100,.1)';
    } else {
      loginForm.style.display = 'block';
      regForm.style.display = 'none';
      loginTab.style.background = '#fff';
      loginTab.style.color = '#0065B3';
      loginTab.style.boxShadow = '0 1px 4px rgba(0,50,100,.1)';
      regTab.style.background = 'transparent';
      regTab.style.color = '#7A90A4';
      regTab.style.boxShadow = 'none';
    }
  };

  window.syntAuthDoLogin = async function(){
    var email = document.getElementById('syntAuthLoginEmail').value.trim();
    var pwd = document.getElementById('syntAuthLoginPwd').value;
    var errEl = document.getElementById('syntAuthLoginErr');
    var btn = document.getElementById('syntAuthLoginBtn');
    errEl.textContent = '';
    if(!email || !pwd){ errEl.textContent = 'Email e password sono richieste.'; return; }
    btn.disabled = true; btn.textContent = 'Accesso in corso...';
    try {
      var r = await fetch('/auth/login', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ email: email, password: pwd })
      });
      if(!r.ok){
        var j = await r.json().catch(function(){ return {detail:'errore HTTP '+r.status}; });
        errEl.textContent = j.detail || 'Credenziali non valide.';
        return;
      }
      var data = await r.json();
      syntAuthSetToken(data.access_token, data.user);
      window.syntAuthRefreshUI();
      window.syntAuthClose();
      try { showStatus && showStatus('Connesso come ' + (data.user.name || data.user.email)); } catch(e){}
    } catch(e){
      errEl.textContent = 'Errore: ' + e.message;
    } finally {
      btn.disabled = false; btn.textContent = 'Accedi';
    }
  };

  // 8.81.0 CLEANUP: rimossa syntAuthDoRegister (dead code dall'audit 8.80.4).
  // Il form di registrazione inline fu sostituito dal link a /accedi: la funzione
  // dereferenziava 6 id ormai inesistenti (syntAuthReg*) e non aveva alcun call-site.

  // Esc per chiudere
  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape'){ window.syntAuthClose(); }
  });
  // Refresh UI all'avvio
  document.addEventListener('DOMContentLoaded', function(){
    window.syntAuthRefreshUI();
  });
  // Subito (potrebbe essere caricato dopo DOMContentLoaded)
  if(document.readyState !== 'loading'){
    setTimeout(function(){ window.syntAuthRefreshUI && window.syntAuthRefreshUI(); }, 100);
  }
})();
