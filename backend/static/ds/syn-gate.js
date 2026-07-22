/*
 * syn-gate.js — gate di accesso alle pagine private di Syntesis-ICP.
 *
 * Inclusione: come primo <script> nel <head> delle pagine riservate
 * (/vedere, /analizzare, /dashboard). Non includerlo su /accedi (pagina
 * di login pubblica) ne' /gestione (gia' protetto da controllo admin in pagina).
 *
 * Comportamento (sessione 2026-05-29, vedi STATO_SISTEMA.md sospeso #4):
 *  - anti-flash: nasconde <html> subito; rivela solo a verdetto positivo
 *  - token mancante o /auth/me KO -> redirect a /accedi
 *  - utente pending (active!==true || !license_key) -> redirect a /accedi
 *  - utente authorized o admin -> visibility ripristinata, boot prosegue
 *  - deep link: prima del redirect salva pathname+search in
 *    sessionStorage.syn_after_login (cosi' /accedi puo' tornare al link
 *    originale dopo login, es. /vedere?file_id=...)
 *
 * Sicurezza: il gate JS e' solo UX. La sicurezza vera resta server-side
 * in auth.py:require_authorized (403 ai pending sulle API).
 */
(function(){
  "use strict";

  // ── anti-flash: nasconde il documento prima di qualsiasi rendering ──
  // Lo script e' sync in <head>, documentElement esiste gia'; <body>
  // potrebbe non essere ancora stato parsato. Nascondendo <html>
  // copriamo tutto. Backup raccomandato nel file HTML in caso il JS
  // non si scarichi: <style>html{visibility:hidden}</style> inline.
  try { document.documentElement.style.visibility = "hidden"; } catch(e){}

  var TOKEN_KEY       = "syntesis_token";
  var USER_KEY        = "syntesis_user";
  var AFTER_LOGIN_KEY = "syn_after_login";
  var LOGIN_PAGE      = "/accedi";

  function reveal(){
    // Inline "visible" (non stringa vuota): batte per specificity il backup
    // CSS <style>html{visibility:hidden}</style> presente nelle pagine
    // protette. Con valore vuoto l'inline si annulla e la rule CSS torna a
    // vincere -> pagina resta hidden anche per utenti authorized (bug 8.4.2,
    // fix 8.4.3).
    try { document.documentElement.style.visibility = "visible"; } catch(e){}
  }

  function rememberDeepLink(){
    // Salva pathname+search per ripristinarlo dopo il login.
    // Niente hash: puo' contenere fragment sensibili e nessuna pagina
    // protetta lo usa oggi per routing.
    try {
      var here = (location.pathname || "/") + (location.search || "");
      if (here.indexOf(LOGIN_PAGE) !== 0) {
        sessionStorage.setItem(AFTER_LOGIN_KEY, here);
      }
    } catch(e){}
  }

  function clearSession(){
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    } catch(e){}
  }

  function hardRedirect(){
    rememberDeepLink();
    clearSession();
    // replace() evita che la pagina riservata resti nello stack di
    // navigazione (back button non ci riporta).
    try { location.replace(LOGIN_PAGE); }
    catch(e){ location.href = LOGIN_PAGE; }
  }

  // 8.112.0: ACCESSO OSPITE — solo su /vedere e solo se il link porta un token
  // firmato nel FRAGMENT (#g=...). Il fragment non arriva mai al server (niente
  // token nei log/Referer). La verifica è server-side (/auth/guest/verify); il
  // gate JS è solo UX. Le altre pagine (/analizzare,/dashboard) → guestVedereToken
  // null → redirect normale.
  function guestVedereToken(){
    if ((location.pathname || "") !== "/vedere") return null;
    var m = (location.hash || "").match(/(?:^#|&)g=([^&]+)/);
    return m ? m[1] : null;
  }
  function tryGuestReveal(tk){
    fetch("/auth/guest/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ g: tk })
    }).then(function(res){
      return res.ok ? res.json() : null;
    }).then(function(d){
      if (d && d.ok) {
        // url e label AUTOREVOLI dal payload firmato (non da ?url grezzo)
        try { window.SYN_GUEST = { url: d.url, label: d.label, exp: d.exp }; } catch(e){}
        reveal();
        // segnala alla pagina (Vedere) che è in modalità ospite → blocca gli altri workflow
        try { window.dispatchEvent(new Event("syn-guest-ready")); } catch(e){}
      } else {
        hardRedirect();
      }
    }).catch(hardRedirect);
  }
  // Ogni ramo di "accesso negato" tenta prima l'accesso ospite (solo su /vedere#g=),
  // così un syntesis_token scaduto in localStorage NON blocca un link ospite valido.
  function denyAndRedirect(){
    var tk = guestVedereToken();
    if (tk) { tryGuestReveal(tk); return; }
    hardRedirect();
  }

  function isAuthorized(user){
    if (!user) return false;
    if (user.role === "admin") return true;
    var hasKey = !!(user.license_key && String(user.license_key).trim());
    var active = user.active === true;
    return hasKey && active;
  }

  // ── 1) token presente? ──
  var token = null;
  try { token = localStorage.getItem(TOKEN_KEY) || null; } catch(e){}
  if (!token) { denyAndRedirect(); return; }

  // ── 2) verifica stato utente lato server ──
  // /auth/me (auth.py:222-242) rilegge active+license_key dal DB.
  // Se il backend non risponde o risponde male preferiamo "chiuso":
  // ogni ramo non-OK redirige a /accedi.
  fetch("/auth/me", {
    method: "GET",
    headers: { "Authorization": "Bearer " + token }
  }).then(function(res){
    if (res.status === 401 || res.status === 403 || !res.ok) {
      denyAndRedirect();
      return null;
    }
    return res.json();
  }).then(function(data){
    if (!data) return; // gia' redirezionato
    var user = (data && data.user) ? data.user : data;
    if (!isAuthorized(user)) { denyAndRedirect(); return; }

    // Aggiorna la copia locale dello user (license_key potrebbe essere
    // appena stata emessa via autorizzazione admin) e rivela la pagina.
    try { localStorage.setItem(USER_KEY, JSON.stringify(user)); } catch(e){}
    reveal();
  }).catch(function(){
    // rete giu', CORS, JSON parse error -> chiuso
    denyAndRedirect();
  });

})();
