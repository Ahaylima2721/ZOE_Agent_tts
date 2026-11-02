"""Copia o zoe-fx.js para dentro do zoe-preview.html.

A demo precisa funcionar aberta sozinha (sem o zoe-fx.js na mesma pasta),
então o código das animações fica embutido entre os marcadores abaixo.
Rode depois de editar o zoe-fx.js:  python3 sincronizar_preview.py
"""
import pathlib, re

raiz = pathlib.Path(__file__).parent
fx = (raiz / "zoe-fx.js").read_text(encoding="utf-8")
html_path = raiz / "zoe-preview.html"
html = html_path.read_text(encoding="utf-8")

bloco = ("<!-- zoe-fx:inicio (cópia gerada de zoe-fx.js; não edite aqui) -->\n"
         "<script>\n" + fx.replace("</script", "<\\/script") + "\n</script>\n"
         "<!-- zoe-fx:fim -->")

if "<!-- zoe-fx:inicio" in html:
    html = re.sub(r"<!-- zoe-fx:inicio.*?<!-- zoe-fx:fim -->", lambda m: bloco, html, flags=re.S)
else:
    html = html.replace('<script src="zoe-fx.js"></script>', bloco, 1)

html_path.write_text(html, encoding="utf-8")
print("zoe-preview.html atualizado com o zoe-fx.js")
