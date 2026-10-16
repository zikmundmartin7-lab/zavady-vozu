"""QR kód s odkazem na návod k instalaci (icons/qr-navod.svg) – na vyvěšení nebo poslání.

Spuštění: python3 tools/qr.py   (potřebuje: pip install --user segno)
"""
from pathlib import Path

import segno

URL = "https://zikmundmartin7-lab.github.io/zavady-vozu/navod.html"
CIL = Path(__file__).resolve().parent.parent / "icons" / "qr-navod.svg"

segno.make(URL, error="m").save(CIL, scale=8, border=2, dark="#1f4e8c", xmldecl=False, svgns=True)
print("Uloženo", CIL)
