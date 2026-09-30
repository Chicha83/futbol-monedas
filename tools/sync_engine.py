#!/usr/bin/env python3
"""Copia server/game.js (motor de la partida + IA) dentro de index.html, entre los marcadores ENGINE_START/ENGINE_END.
Hay que ejecutarlo cada vez que cambie server/game.js:   python3 tools/sync_engine.py"""
import re, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
g = (root / 'server' / 'game.js').read_text(encoding='utf8')
g = re.sub(r'^export ', '', g, flags=re.M)
block = "/*ENGINE_START*/\nconst Engine=(()=>{\n" + g + "\nreturn {createGame,plan};\n})();\n/*ENGINE_END*/"
p = root / 'index.html'
s = p.read_text(encoding='utf8')
if '/*ENGINE_START*/' in s:
    s = re.sub(r'/\*ENGINE_START\*/.*?/\*ENGINE_END\*/', lambda m: block, s, flags=re.S)
else:
    marker = '/* ---------- online: el servidor calcula'
    assert marker in s
    s = s.replace(marker, block + '\n' + marker, 1)
p.write_text(s, encoding='utf8')
print('motor sincronizado:', len(block), 'caracteres')
