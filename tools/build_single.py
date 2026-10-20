"""Собирает всю игру в один HTML-файл (dist/baai.html):
стили и скрипты вставляются внутрь. Такой файл можно открыть на телефоне
без интернета и опубликовать как артефакт.
Запуск: python3 tools/build_single.py [--fragment]
--fragment: без <html>/<head>/<body> (формат для артефакта Claude)."""
import re
import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
html = (root / 'index.html').read_text(encoding='utf-8')
css = (root / 'css/style.css').read_text(encoding='utf-8')
scripts = ''.join(
    f'<script>\n{(root / "js" / n).read_text(encoding="utf-8")}\n</script>\n'
    for n in ('data.js', 'engine.js', 'ui.js')
)
app = re.search(r'<!--APP-->(.*)<!--/APP-->', html, re.S).group(1)
fonts = re.search(r'<link rel="stylesheet" href="(https://fonts[^"]+)">', html).group(1)

head = f'''<title>Баай</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="{fonts}">
<style>
{css}
</style>
'''

out = root / 'dist'
out.mkdir(exist_ok=True)
if '--fragment' in sys.argv:
    page = head + app + scripts
    (out / 'baai-artifact.html').write_text(page, encoding='utf-8')
else:
    page = f'''<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
{head}</head>
<body>
{app}{scripts}</body>
</html>
'''
    (out / 'baai.html').write_text(page, encoding='utf-8')
print('ok')
