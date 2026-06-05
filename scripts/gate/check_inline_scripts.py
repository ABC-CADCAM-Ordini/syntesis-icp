#!/usr/bin/env python3
# check_inline_scripts.py — estrae ogni blocco <script> classico INLINE (apertura
# riga "<script>" pura, esclude importmap/module/src) e lo passa a `node --check`.
# Valida la sintassi JS dopo edit chirurgici sul monolite (CLAUDE.md §11.5).
# Uso: python3 scripts/gate/check_inline_scripts.py <file.html>
import subprocess, sys, tempfile, os

path = sys.argv[1] if len(sys.argv) > 1 else 'backend/static/syntesis-analyzer-v3b.html'
src = open(path, encoding='utf-8').read().split('\n')
blocks, i = [], 0
while i < len(src):
    if src[i].strip() == '<script>':
        s = i + 1
        j = s
        while j < len(src) and src[j].strip() != '</script>':
            j += 1
        blocks.append((s + 1, j, '\n'.join(src[s:j])))
        i = j + 1
    else:
        i += 1

ok = True
for s, e, code in blocks:
    tf = tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf-8')
    tf.write(code)
    tf.close()
    r = subprocess.run(['node', '--check', tf.name], capture_output=True, text=True)
    os.unlink(tf.name)
    st = 'OK' if r.returncode == 0 else 'FAIL'
    if r.returncode != 0:
        ok = False
    msg = '' if r.returncode == 0 else '  -> ' + (r.stderr.strip().split('\n')[0] if r.stderr.strip() else '?')
    print(f'  righe {s}-{e}  ({e - s + 1} righe): {st}{msg}')

print('TUTTI OK' if ok else 'ERRORI DI SINTASSI')
sys.exit(0 if ok else 1)
