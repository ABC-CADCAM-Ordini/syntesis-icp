// Estrattore di funzioni top-level `function NAME(...){...}` da un sorgente JS/HTML.
// Brace-matching con scanner consapevole di stringhe ('...', "...", `...`) e commenti
// (// e /* */); i regex literal delle 27 funzioni della purelib non contengono graffe,
// quindi non serve un parser completo. Usato dal gate F4 (golden-master libreria pura).
export function extractFunction(src, name) {
  const re = new RegExp('(^|[\\n;])\\s*function\\s+' + name + '\\s*\\(', 'g');
  const m = re.exec(src);
  if (!m) throw new Error(`funzione ${name} non trovata`);
  const fStart = src.indexOf('function', m.index); // inizio esatto = keyword 'function'
  let i = src.indexOf('{', fStart);
  if (i < 0) throw new Error(`graffa di apertura assente per ${name}`);
  let depth = 0, inStr = null, inLC = false, inBC = false, inRe = false, inReClass = false;
  let lastSig = ''; // ultimo char significativo (fuori da stringhe/commenti/regex/spazi)
  for (; i < src.length; i++) {
    const c = src[i], p = src[i - 1];
    if (inLC) { if (c === '\n') inLC = false; continue; }
    if (inBC) { if (c === '/' && p === '*') inBC = false; continue; }
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (inRe) {
      if (c === '\\') { i++; continue; }
      if (c === '[') inReClass = true;
      else if (c === ']') inReClass = false;
      else if (c === '/' && !inReClass) inRe = false;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { inStr = c; lastSig = c; continue; }
    if (c === '/' && src[i + 1] === '/') { inLC = true; continue; }
    if (c === '/' && src[i + 1] === '*') { inBC = true; continue; }
    if (c === '/') {
      // regex literal se in posizione di espressione (euristica standard sul precedente)
      if (lastSig === '' || '(,=:[!&|?{};+-*%<>~^'.includes(lastSig)) { inRe = true; inReClass = false; continue; }
      lastSig = c; continue;
    }
    if (!/\s/.test(c)) lastSig = c;
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return src.slice(fStart, i + 1);
    }
  }
  throw new Error(`graffa di chiusura non trovata per ${name}`);
}

export function extractAll(src, names) {
  const out = {};
  for (const n of names) out[n] = extractFunction(src, n);
  return out;
}
