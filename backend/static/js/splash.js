// ─────────────────────────────────────────────────────────────
// Syntesis-ICP — splash.js
// Estratto da index.html (script #1)
// Copyright (C) Francesco Biaggini. Tutti i diritti riservati.
// ─────────────────────────────────────────────────────────────

// ── Splash Screen ──────────────────────────────────────────────────────────
var REPLACER_URL = '/replacer';
function chooseSplash(choice) {
  if (choice === 'replace') { window.open(REPLACER_URL, '_blank'); return; }
  var splash = document.getElementById('splash');
  var mainApp = document.getElementById('main-app');
  if (splash) { splash.style.transition='opacity .25s'; splash.style.opacity='0'; setTimeout(function(){splash.style.display='none';},260); }
  if (mainApp) { setTimeout(function(){ mainApp.style.display='block'; mainApp.style.opacity='0'; mainApp.style.transition='opacity .3s'; requestAnimationFrame(function(){mainApp.style.opacity='1';}); },200); }
}

// ── i18n ──────────────────────────────────────────────────────────────────
var LANGS = ['it','en','es','fr','de'];
var LANG_FLAGS = {it:'🇮🇹',en:'🇬🇧',es:'🇪🇸',fr:'🇫🇷',de:'🇩🇪'};
var STRINGS = {
  it:{
    tab1:'Analisi STL',tab2:'Classifica',tab3:'Come funziona',tab4:'Distanze',
    dropA:'File A — Riferimento',dropB:'File B — Confronto',dropHint:'trascina .stl qui oppure clicca',
    btnRun:'seleziona entrambi i file per avviare',btnAnalyze:'avvia analisi ICP',
    btnAnalyzing:'analisi in corso…',btnAgain:'analizza di nuovo',
    scanA:'Scanbody A',scanB:'Scanbody B',pairs:'Coppie',rmsd:'RMSD ICP',
    scoreTitle:'Voto precisione',
    lockTitle:'Registrati per vedere il voto',
    lockSub:'Le misure tecniche sono sempre visibili · Il <strong style="color:var(--blue)">voto 0–100</strong> richiede consenso classifica',
    gateTitle:'Sblocca il voto · Entra in classifica',
    gateTitleEdit:'Modifica i tuoi dati',
    gateSub:'Inserisci i tuoi dati e accetta il consenso',
    gateSubEdit:'Aggiorna le informazioni del tuo profilo',
    fName:'NOME / STUDIO',fPhone:'TELEFONO',fCity:'CITTÀ',
    fProv:'PROVINCIA',fCountry:'NAZIONE',fTipo:'TIPO STRUTTURA',
    fOptional:'(opzionale)',
    consentTxt:'Acconsento alla pubblicazione del mio risultato nella <strong>classifica pubblica</strong> (solo città, nazione, tipo e voto — mai dati personali).',
    btnRegister:'Sblocca il voto →',
    lab:'Laboratorio odontotecnico',clinic:'Clinica / Studio dentistico',
    univ:'Università / Centro ricerca',other:'Altro',
    savePanelTitle:'Salva in classifica pubblica',
    saveDesc:'Ogni misurazione è una entry separata.',
    btnSave:'Salva in classifica →',btnPdf:'📄 PDF',editBtn:'Modifica dati',
    shareTitle:'Condividi il tuo risultato',
    btnShare:'📲 Condividi immagine',btnDownload:'Scarica PNG',
    shareMobile:'📱 <strong>Su mobile</strong>: apre il pannello nativo — scegli Instagram, Facebook, WhatsApp, TikTok…',
    shareDesktop:'💻 <strong>Su desktop</strong>: scarica il PNG e caricalo sui social.',
    sExcellent:'Eccellente',sGood:'Buono',sSuff:'Sufficiente',sPoor:'Scarso',sCrit:'Critico',
    lbEmpty:'Nessun risultato per i filtri selezionati.',lbLoading:'Caricamento…',
    allF:'Tutte',allM:'Tutti',now:'Adesso',
    rankProv:'in provincia',rankGlobal:'globale',of:'su',saved:'Salvato!'
  },
  en:{
    tab1:'STL Analysis',tab2:'Leaderboard',tab3:'How it works',tab4:'Distances',
    dropA:'File A — Reference',dropB:'File B — Comparison',dropHint:'drag .stl here or click',
    btnRun:'select both files to start',btnAnalyze:'start ICP analysis',
    btnAnalyzing:'analyzing…',btnAgain:'analyze again',
    scanA:'Scanbody A',scanB:'Scanbody B',pairs:'Pairs',rmsd:'ICP RMSD',
    scoreTitle:'Precision score',
    lockTitle:'Register to see your score',
    lockSub:'Technical measurements always visible · The <strong style="color:var(--blue)">0–100 score</strong> requires leaderboard consent',
    gateTitle:'Unlock score · Join leaderboard',
    gateTitleEdit:'Edit your profile',
    gateSub:'Enter your details and accept consent',
    gateSubEdit:'Update your profile information',
    fName:'NAME / STUDIO',fPhone:'PHONE',fCity:'CITY',
    fProv:'PROVINCE',fCountry:'COUNTRY',fTipo:'STRUCTURE TYPE',
    fOptional:'(optional)',
    consentTxt:'I consent to the publication of my result in the <strong>public leaderboard</strong> (only city, country, type and score — never personal data).',
    btnRegister:'Unlock score →',
    lab:'Dental laboratory',clinic:'Clinic / Dental practice',
    univ:'University / Research centre',other:'Other',
    savePanelTitle:'Save to public leaderboard',
    saveDesc:'Each measurement is a separate entry.',
    btnSave:'Save to leaderboard →',btnPdf:'📄 PDF',editBtn:'Edit profile',
    shareTitle:'Share your result',
    btnShare:'📲 Share image',btnDownload:'Download PNG',
    shareMobile:'📱 <strong>On mobile</strong>: opens native share sheet — choose Instagram, Facebook, WhatsApp, TikTok…',
    shareDesktop:'💻 <strong>On desktop</strong>: download the PNG and upload it to social media.',
    sExcellent:'Excellent',sGood:'Good',sSuff:'Sufficient',sPoor:'Poor',sCrit:'Critical',
    lbEmpty:'No results for selected filters.',lbLoading:'Loading…',
    allF:'All',allM:'All',now:'Just now',
    rankProv:'in province',rankGlobal:'global',of:'of',saved:'Saved!'
  },
  es:{
    tab1:'Análisis STL',tab2:'Clasificación',tab3:'Cómo funciona',tab4:'Distancias',
    dropA:'Archivo A — Referencia',dropB:'Archivo B — Comparación',dropHint:'arrastra .stl aquí o haz clic',
    btnRun:'selecciona ambos archivos para comenzar',btnAnalyze:'iniciar análisis ICP',
    btnAnalyzing:'analizando…',btnAgain:'analizar de nuevo',
    scanA:'Scanbody A',scanB:'Scanbody B',pairs:'Pares',rmsd:'RMSD ICP',
    scoreTitle:'Puntuación de precisión',
    lockTitle:'Regístrate para ver tu puntuación',
    lockSub:'Las medidas técnicas siempre son visibles · La <strong style="color:var(--blue)">puntuación 0–100</strong> requiere consentimiento',
    gateTitle:'Desbloquear puntuación · Clasificación',
    gateTitleEdit:'Editar perfil',
    gateSub:'Ingresa tus datos y acepta el consentimiento',
    gateSubEdit:'Actualiza la información de tu perfil',
    fName:'NOMBRE / ESTUDIO',fPhone:'TELÉFONO',fCity:'CIUDAD',
    fProv:'PROVINCIA',fCountry:'PAÍS',fTipo:'TIPO DE ESTRUCTURA',
    fOptional:'(opcional)',
    consentTxt:'Consiento la publicación de mi resultado en la <strong>clasificación pública</strong> (solo ciudad, país, tipo y puntuación — nunca datos personales).',
    btnRegister:'Desbloquear puntuación →',
    lab:'Laboratorio dental',clinic:'Clínica / Consultorio dental',
    univ:'Universidad / Centro de investigación',other:'Otro',
    savePanelTitle:'Guardar en clasificación pública',
    saveDesc:'Cada medición es una entrada separada.',
    btnSave:'Guardar →',btnPdf:'📄 PDF',editBtn:'Editar datos',
    shareTitle:'Comparte tu resultado',
    btnShare:'📲 Compartir imagen',btnDownload:'Descargar PNG',
    shareMobile:'📱 <strong>En móvil</strong>: abre el panel nativo — elige Instagram, Facebook, WhatsApp, TikTok…',
    shareDesktop:'💻 <strong>En escritorio</strong>: descarga el PNG y súbelo a redes sociales.',
    sExcellent:'Excelente',sGood:'Bueno',sSuff:'Suficiente',sPoor:'Escaso',sCrit:'Crítico',
    lbEmpty:'Sin resultados para los filtros seleccionados.',lbLoading:'Cargando…',
    allF:'Todas',allM:'Todos',now:'Ahora',
    rankProv:'en provincia',rankGlobal:'global',of:'de',saved:'Guardado!'
  },
  fr:{
    tab1:'Analyse STL',tab2:'Classement',tab3:'Comment ça marche',tab4:'Distances',
    dropA:'Fichier A — Référence',dropB:'Fichier B — Comparaison',dropHint:'glissez le .stl ici ou cliquez',
    btnRun:"sélectionnez les deux fichiers pour commencer",btnAnalyze:"démarrer l'analyse ICP",
    btnAnalyzing:'analyse en cours…',btnAgain:'analyser à nouveau',
    scanA:'Scanbody A',scanB:'Scanbody B',pairs:'Paires',rmsd:'RMSD ICP',
    scoreTitle:'Score de précision',
    lockTitle:'Inscrivez-vous pour voir votre score',
    lockSub:'Les mesures techniques toujours visibles · Le <strong style="color:var(--blue)">score 0–100</strong> nécessite un consentement',
    gateTitle:'Déverrouiller le score · Classement',
    gateTitleEdit:'Modifier votre profil',
    gateSub:'Entrez vos données et acceptez le consentement',
    gateSubEdit:"Mettez à jour les informations de votre profil",
    fName:'NOM / CABINET',fPhone:'TÉLÉPHONE',fCity:'VILLE',
    fProv:'PROVINCE',fCountry:'PAYS',fTipo:'TYPE DE STRUCTURE',
    fOptional:'(facultatif)',
    consentTxt:'Je consens à la publication de mon résultat dans le <strong>classement public</strong> (uniquement ville, pays, type et score — jamais de données personnelles).',
    btnRegister:'Déverrouiller →',
    lab:'Laboratoire dentaire',clinic:'Clinique / Cabinet dentaire',
    univ:'Université / Centre de recherche',other:'Autre',
    savePanelTitle:'Enregistrer dans le classement public',
    saveDesc:'Chaque mesure est une entrée séparée.',
    btnSave:'Enregistrer →',btnPdf:'📄 PDF',editBtn:'Modifier les données',
    shareTitle:'Partagez votre résultat',
    btnShare:"📲 Partager l'image",btnDownload:'Télécharger PNG',
    shareMobile:"📱 <strong>Sur mobile</strong> : ouvre le panneau natif — choisissez Instagram, Facebook, WhatsApp, TikTok…",
    shareDesktop:'💻 <strong>Sur ordinateur</strong> : téléchargez le PNG et publiez-le sur les réseaux sociaux.',
    sExcellent:'Excellent',sGood:'Bon',sSuff:'Suffisant',sPoor:'Faible',sCrit:'Critique',
    lbEmpty:'Aucun résultat pour les filtres sélectionnés.',lbLoading:'Chargement…',
    allF:'Toutes',allM:'Tous',now:'Maintenant',
    rankProv:'dans la province',rankGlobal:'mondial',of:'sur',saved:'Enregistré!'
  },
  de:{
    tab1:'STL-Analyse',tab2:'Rangliste',tab3:'Wie es funktioniert',tab4:'Abstände',
    dropA:'Datei A — Referenz',dropB:'Datei B — Vergleich',dropHint:'.stl hier ablegen oder klicken',
    btnRun:'beide Dateien auswählen um zu starten',btnAnalyze:'ICP-Analyse starten',
    btnAnalyzing:'Analyse läuft…',btnAgain:'erneut analysieren',
    scanA:'Scanbody A',scanB:'Scanbody B',pairs:'Paare',rmsd:'ICP RMSD',
    scoreTitle:'Präzisionsbewertung',
    lockTitle:'Registrieren um Bewertung zu sehen',
    lockSub:'Technische Messungen immer sichtbar · Die <strong style="color:var(--blue)">0–100 Bewertung</strong> erfordert Zustimmung',
    gateTitle:'Bewertung freischalten · Rangliste',
    gateTitleEdit:'Profil bearbeiten',
    gateSub:'Daten eingeben und Zustimmung akzeptieren',
    gateSubEdit:'Profilinformationen aktualisieren',
    fName:'NAME / LABOR',fPhone:'TELEFON',fCity:'STADT',
    fProv:'PROVINZ',fCountry:'LAND',fTipo:'STRUKTURTYP',
    fOptional:'(optional)',
    consentTxt:'Ich stimme der Veröffentlichung meines Ergebnisses in der <strong>öffentlichen Rangliste</strong> zu (nur Stadt, Land, Typ und Bewertung — nie persönliche Daten).',
    btnRegister:'Freischalten →',
    lab:'Dentallabor',clinic:'Klinik / Zahnarztpraxis',
    univ:'Universität / Forschungszentrum',other:'Sonstiges',
    savePanelTitle:'In öffentlicher Rangliste speichern',
    saveDesc:'Jede Messung ist ein separater Eintrag.',
    btnSave:'Speichern →',btnPdf:'📄 PDF',editBtn:'Daten bearbeiten',
    shareTitle:'Ergebnis teilen',
    btnShare:'📲 Bild teilen',btnDownload:'PNG herunterladen',
    shareMobile:'📱 <strong>Auf Mobilgeräten</strong>: öffnet das native Menü — wählen Sie Instagram, Facebook, WhatsApp, TikTok…',
    shareDesktop:'💻 <strong>Am Desktop</strong>: PNG herunterladen und in sozialen Medien posten.',
    sExcellent:'Ausgezeichnet',sGood:'Gut',sSuff:'Ausreichend',sPoor:'Schlecht',sCrit:'Kritisch',
    lbEmpty:'Keine Ergebnisse für die gewählten Filter.',lbLoading:'Wird geladen…',
    allF:'Alle',allM:'Alle',now:'Jetzt',
    rankProv:'in Provinz',rankGlobal:'global',of:'von',saved:'Gespeichert!'
  }
};

var _lang = (function(){
  var s=sessionStorage.getItem('psv7_lang');
  if(s&&STRINGS[s])return s;
  var n=(navigator.language||'it').slice(0,2).toLowerCase();
  return STRINGS[n]?n:'it';
})();

function T(k){return(STRINGS[_lang]&&STRINGS[_lang][k])||STRINGS.it[k]||k;}

function setLang(l){
  if(!STRINGS[l])return;
  _lang=l;
  sessionStorage.setItem('psv7_lang',l);
  var sel=document.querySelector('.lang-select');if(sel)sel.value=l;
  applyLangToDOM();
  if(window._LR)window.C.render();
}

function applyLangToDOM(){
  // Tabs
  var t=document.getElementById('tab-analisi'); if(t)t.textContent=T('tab1');
  t=document.getElementById('tab-distanze'); if(t)t.textContent=T('tab4');
  t=document.getElementById('tab-classifica'); if(t)t.textContent=T('tab2');
  t=document.getElementById('tab-howto'); if(t)t.textContent=T('tab3');
  // Dropzones
  t=document.getElementById('lbl-fileA'); if(t)t.textContent=T('dropA');
  t=document.getElementById('lbl-fileB'); if(t)t.textContent=T('dropB');
  var hA=document.getElementById('hA'); if(hA&&!hA.querySelector('.dn'))hA.textContent=T('dropHint');
  var hB=document.getElementById('hB'); if(hB&&!hB.querySelector('.dn'))hB.textContent=T('dropHint');
  // Run button (only if not yet run)
  var btn=document.getElementById('run');
  if(btn&&!window._LR){
    btn.textContent=btn.disabled?T('btnRun'):T('btnAnalyze');
  }
  // Footer
  t=document.getElementById('footer-sub'); if(t)t.textContent='STL Cylinder Comparator v7 · Biaggini Medical Devices S.r.l.';
  // LB headers
  t=document.getElementById('lbl-lb-loc'); if(t)t.textContent=T('scanA')==='Scanbody A'?'Posizione':'Location'; // quick check
}

function buildLangSel(){
  var h='<select class="lang-select" onchange="setLang(this.value)" aria-label="Language">';
  LANGS.forEach(function(l){
    h+='<option value="'+l+'"'+(l===_lang?' selected':'')+'>'+LANG_FLAGS[l]+' '+l.toUpperCase()+'</option>';
  });
  h+='</select>';
  return h;
}

// Init lang selector
(function(){
  var wrap=document.getElementById('lang-sel');
  if(wrap)wrap.innerHTML=buildLangSel();
  applyLangToDOM();
})();
