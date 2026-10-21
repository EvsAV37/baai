"""Собирает всю игру в один HTML-файл (dist/baai.html):
стили и скрипты вставляются внутрь. Такой файл можно открыть на телефоне
без интернета и опубликовать как артефакт.
Запуск: python3 tools/build_single.py [--fragment]
--fragment: без <html>/<head>/<body> (формат для артефакта Claude)."""
import base64
import re
import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
html = (root / 'index.html').read_text(encoding='utf-8')
css = (root / 'css/style.css').read_text(encoding='utf-8')
fragment = '--fragment' in sys.argv
own = ''.join(
    f'<script>\n{(root / "js" / n).read_text(encoding="utf-8")}\n</script>\n'
    for n in ('data.js', 'theme.js', 'engine.js', 'board.js')
) + f'<script>\n{(root / "vendor/qrcode.js").read_text(encoding="utf-8")}\n</script>\n' + ''.join(
    f'<script>\n{(root / "js" / n).read_text(encoding="utf-8")}\n</script>\n'
    for n in ('net.js', 'ui.js')
)
if fragment:
    phaser = '<script src="https://cdnjs.cloudflare.com/ajax/libs/phaser/3.80.1/phaser.min.js"></script>\n'
else:
    phaser = f'<script>\n{(root / "vendor/phaser.min.js").read_text(encoding="utf-8")}\n</script>\n'
scripts = phaser + own
app = re.search(r'<!--APP-->(.*)<!--/APP-->', html, re.S).group(1)
GOOGLE_FONTS = 'https://fonts.googleapis.com/css2?family=Alegreya+SC:wght@700;800&family=PT+Sans+Narrow:wght@400;700&display=swap'
if fragment:
    font_css = f'<link rel="stylesheet" href="{GOOGLE_FONTS}">'
else:
    # шрифты внутри файла — игра без интернета
    fc = (root / 'css/fonts.css').read_text(encoding='utf-8')
    fc = re.sub(r'url\(\.\./vendor/fonts/([^)]+)\)', lambda m: 'url(data:font/woff2;base64,' + base64.b64encode((root / 'vendor/fonts' / m.group(1)).read_bytes()).decode() + ')', fc)
    font_css = f'<style>\n{fc}</style>'

head = f'''<title>Баай</title>
<meta name="claude:viewport-fit-sides" content="cover">
{font_css}
<style>
{css}
</style>
'''

out = root / 'dist'
out.mkdir(exist_ok=True)
if fragment:
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
