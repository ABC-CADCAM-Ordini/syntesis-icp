// compare.mjs — deep-diff esatto golden vs after (esclude il campo 'engine').
// Object.is => coglie anche -0 vs 0 e NaN (scostamenti "anche minimi").
import { readFileSync } from 'node:fs';
const a = JSON.parse(readFileSync(new URL('./clip-golden.json', import.meta.url)));
const b = JSON.parse(readFileSync(new URL('./clip-after.json', import.meta.url)));
delete a.engine; delete b.engine;

const diffs = [];
function walk(x, y, path) {
  const tx = typeof x, ty = typeof y;
  if (tx !== ty) { diffs.push([path, x, y]); return; }
  if (x && tx === 'object') {
    const keys = new Set([...Object.keys(x), ...Object.keys(y || {})]);
    for (const k of keys) walk(x ? x[k] : undefined, y ? y[k] : undefined, path ? path + '.' + k : k);
  } else if (!Object.is(x, y)) {
    diffs.push([path, x, y]);
  }
}
walk(a, b, '');

if (diffs.length === 0) {
  console.log('GATE: IDENTICAL — golden ≡ after (0 scostamenti, precisione piena)');
} else {
  console.log('GATE: ' + diffs.length + ' SCOSTAMENTI');
  for (const [p, x, y] of diffs) console.log('  ' + p + '  golden=' + JSON.stringify(x) + '  after=' + JSON.stringify(y));
  process.exit(1);
}
