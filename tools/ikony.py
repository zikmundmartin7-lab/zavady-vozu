"""Vykreslí ikony aplikace: rozlomený vagon (klikatá trhlina uprostřed, obě poloviny se prohýbají dolů).

Zapíše icons/icon.svg a PNG (192, 512, maskable 512, jednobarevný odznak 96 pro upozornění).
Spuštění: python3 tools/ikony.py [cílová složka]

Po změně ikony zvyšte číslo ?v=… ve všech odkazech na ikony (index.html, navod.html, manifest.webmanifest,
sw.js, js/app.js, js/views/account.js) – jinak telefony a prohlížeče dál ukazují starou ikonu z paměti.
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

MODRA = (31, 78, 140, 255)
BILA = (255, 255, 255, 255)
ZEBRA = (200, 211, 226, 255)  # svislá žebra na skříni (v SVG modrá s průhledností)
CIL = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "icons"
S = 4  # převzorkování kvůli hladkým hranám

# Motiv v mřížce 512 × 512
POSUN = -44                      # celý vagon výš, ať je ve čtverci uprostřed
KOLEJ = (56, 398, 456, 410)
SKRIN = (96, 196, 416, 320)      # skříň vozu, zaoblení 14
RAM = (80, 318, 432, 340)        # spodek, zaoblení 6
ZEBRA_X = (128, 172, 216, 282, 326, 370)
ZEBRA_Y = (216, 300)
KOLA_X = (150, 210, 302, 362)
KOLA_Y = 368
TRHLINA = [(262, 188), (248, 222), (268, 252), (246, 284), (266, 314), (254, 348)]
MEZERA = 9                       # polovina šířky trhliny
NAKLON = 4                       # o kolik stupňů se každá polovina skloní ke trhlině
OSA_L = (150, 330)               # kolem čeho se polovina otáčí (nad podvozkem)
OSA_P = (362, 330)


def polovina(strana):
    """Mnohoúhelník poloviny vozu u trhliny (strana -1 = levá, 1 = pravá)."""
    okraj = -50 if strana < 0 else 562
    hrana = [(x + strana * MEZERA, y) for x, y in TRHLINA]
    return [(okraj, TRHLINA[0][1]), *hrana, (okraj, TRHLINA[-1][1])]


def motiv(img, k, dx=0, dy=0, pozadi=MODRA):
    """Nakreslí motiv do obrázku; k = měřítko, dx/dy = posun v pixelech."""
    dy += POSUN * k

    def bod(x, y):
        return (dx + x * k, dy + y * k)

    def obdelnik(x0, y0, x1, y1):
        return [*bod(x0, y0), *bod(x1, y1)]

    def kruh(d, cx, cy, r, barva):
        d.ellipse(obdelnik(cx - r, cy - r, cx + r, cy + r), fill=barva)

    d = ImageDraw.Draw(img)
    d.rounded_rectangle(obdelnik(*KOLEJ), radius=6 * k, fill=(255, 255, 255, 140))

    # Skříň a spodek na zvláštní vrstvě → rozříznout podél trhliny, každou polovinu naklonit
    vrstva = Image.new("RGBA", img.size, (0, 0, 0, 0))
    dv = ImageDraw.Draw(vrstva)
    dv.rounded_rectangle(obdelnik(*SKRIN), radius=14 * k, fill=BILA)
    dv.rounded_rectangle(obdelnik(*RAM), radius=6 * k, fill=BILA)
    for x in ZEBRA_X:
        dv.rounded_rectangle(obdelnik(x, ZEBRA_Y[0], x + 14, ZEBRA_Y[1]), radius=4 * k, fill=ZEBRA)
    for strana, osa in ((-1, OSA_L), (1, OSA_P)):
        maska = Image.new("L", img.size, 0)
        ImageDraw.Draw(maska).polygon([bod(*p) for p in polovina(strana)], fill=255)
        kus = Image.new("RGBA", img.size, (0, 0, 0, 0))
        kus.paste(vrstva, (0, 0), maska)
        # PIL otáčí proti směru hodinek: levá polovina po směru (konec u trhliny klesne), pravá proti
        img.alpha_composite(kus.rotate(strana * NAKLON, resample=Image.BICUBIC, center=bod(*osa)))

    d = ImageDraw.Draw(img)
    for x in KOLA_X:
        kruh(d, x, KOLA_Y, 27, BILA)
        kruh(d, x, KOLA_Y, 10, pozadi)


def ikona(velikost, maskable=False):
    n = 512 * S
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if maskable:
        # celoplošné pozadí, motiv zmenšený do bezpečné zóny
        d.rectangle([0, 0, n, n], fill=MODRA)
        k = S * 0.8
        motiv(img, k, dx=(n - 512 * k) / 2, dy=(n - 512 * k) / 2)
    else:
        d.rounded_rectangle([0, 0, n - 1, n - 1], radius=112 * S, fill=MODRA)
        motiv(img, S)
    return img.resize((velikost, velikost), Image.LANCZOS)


def odznak(velikost=96):
    """Jednobarevná silueta pro stavový řádek Androidu (bílá na průhledné)."""
    n = 512 * S
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    motiv(img, S, pozadi=(0, 0, 0, 0))
    return img.resize((velikost, velikost), Image.LANCZOS)


def svg():
    """Stejný motiv jako SVG (ikona v prohlížeči a logo na přihlášení)."""
    def body(pts):
        return " ".join(f"{x},{y}" for x, y in pts)

    zebra = "".join(f'<rect x="{x}" y="{ZEBRA_Y[0]}" width="14" height="{ZEBRA_Y[1] - ZEBRA_Y[0]}" rx="4"/>'
                    for x in ZEBRA_X)
    vuz = (f'<rect x="{SKRIN[0]}" y="{SKRIN[1]}" width="{SKRIN[2] - SKRIN[0]}" height="{SKRIN[3] - SKRIN[1]}" rx="14" fill="#fff"/>'
           f'<rect x="{RAM[0]}" y="{RAM[1]}" width="{RAM[2] - RAM[0]}" height="{RAM[3] - RAM[1]}" rx="6" fill="#fff"/>'
           f'<g fill="#1f4e8c" opacity=".25">{zebra}</g>')
    kola = "".join(f'<circle cx="{x}" cy="{KOLA_Y}" r="27"/>' for x in KOLA_X)
    naby = "".join(f'<circle cx="{x}" cy="{KOLA_Y}" r="10"/>' for x in KOLA_X)
    # SVG otáčí po směru hodinek: levá polovina +, pravá −
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <clipPath id="l"><polygon points="{body(polovina(-1))}"/></clipPath>
    <clipPath id="p"><polygon points="{body(polovina(1))}"/></clipPath>
  </defs>
  <rect width="512" height="512" rx="112" fill="#1f4e8c"/>
  <g transform="translate(0 {POSUN})">
    <rect x="{KOLEJ[0]}" y="{KOLEJ[1]}" width="{KOLEJ[2] - KOLEJ[0]}" height="{KOLEJ[3] - KOLEJ[1]}" rx="6" fill="#fff" opacity=".55"/>
    <g transform="rotate({NAKLON} {OSA_L[0]} {OSA_L[1]})"><g clip-path="url(#l)">{vuz}</g></g>
    <g transform="rotate({-NAKLON} {OSA_P[0]} {OSA_P[1]})"><g clip-path="url(#p)">{vuz}</g></g>
    <g fill="#fff">{kola}</g>
    <g fill="#1f4e8c">{naby}</g>
  </g>
</svg>
"""


if __name__ == "__main__":
    CIL.mkdir(parents=True, exist_ok=True)
    (CIL / "icon.svg").write_text(svg(), encoding="utf-8")
    ikona(192).save(CIL / "icon-192.png")
    ikona(512).save(CIL / "icon-512.png")
    ikona(512, maskable=True).save(CIL / "icon-maskable-512.png")
    odznak().save(CIL / "badge-96.png")
    print("Ikony uloženy do", CIL)
