"""Vykreslí PNG ikony aplikace (stejný motiv jako icons/icon.svg).

Spuštění: python3 tools/ikony.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

MODRA = (31, 78, 140, 255)
BILA = (255, 255, 255, 255)
CERVENA = (229, 55, 43, 255)
CIL = Path(__file__).resolve().parent.parent / "icons"
S = 4  # převzorkování kvůli hladkým hranám


def motiv(d, k, dx=0, dy=0, barva_pozadi=MODRA, badge=True):
    """Vagon s odznakem; souřadnice v mřížce 512 × 512, k = měřítko."""
    def r(x0, y0, x1, y1):
        return [dx + x0 * k, dy + y0 * k, dx + x1 * k, dy + y1 * k]

    def kruh(cx, cy, rad, **kw):
        d.ellipse(r(cx - rad, cy - rad, cx + rad, cy + rad), **kw)

    d.rounded_rectangle(r(56, 398, 456, 410), radius=6 * k, fill=(255, 255, 255, 140))
    d.rounded_rectangle(r(96, 196, 416, 320), radius=14 * k, fill=BILA)
    d.rounded_rectangle(r(80, 318, 432, 340), radius=6 * k, fill=BILA)
    for x in (150, 210, 302, 362):
        kruh(x, 368, 27, fill=BILA)
        kruh(x, 368, 10, fill=barva_pozadi)
    for x in (136, 186, 236, 286):
        d.rounded_rectangle(r(x, 216, x + 14, 300), radius=4 * k, fill=(200, 211, 226, 255))
    if badge:
        kruh(392, 150, 80, fill=barva_pozadi)
        kruh(392, 150, 74, fill=CERVENA)
        d.rounded_rectangle(r(381, 104, 403, 168), radius=11 * k, fill=BILA)
        kruh(392, 192, 12, fill=BILA)


def ikona(velikost, maskable=False):
    n = 512 * S
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if maskable:
        # celoplošné pozadí, motiv zmenšený do bezpečné zóny (80 %)
        d.rectangle([0, 0, n, n], fill=MODRA)
        k = S * 0.78
        motiv(d, k, dx=(n - 512 * k) / 2, dy=(n - 512 * k) / 2)
    else:
        d.rounded_rectangle([0, 0, n - 1, n - 1], radius=112 * S, fill=MODRA)
        motiv(d, S)
    return img.resize((velikost, velikost), Image.LANCZOS)


def odznak(velikost=96):
    """Jednobarevná silueta pro stavový řádek Androidu (bílá na průhledné)."""
    n = 512 * S
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    motiv(d, S, dy=-40 * S, barva_pozadi=(0, 0, 0, 0), badge=False)
    return img.resize((velikost, velikost), Image.LANCZOS)


if __name__ == "__main__":
    ikona(192).save(CIL / "icon-192.png")
    ikona(512).save(CIL / "icon-512.png")
    ikona(512, maskable=True).save(CIL / "icon-maskable-512.png")
    odznak().save(CIL / "badge-96.png")
    print("Ikony uloženy do", CIL)
