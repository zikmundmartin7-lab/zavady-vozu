"""Převede Katalog závad a poškození (Dodatek 1 přílohy 9 VSP) z PDF do dat pro aplikaci.

Výstup (do složky private/, která se NEnahrává na GitHub – text katalogu není náš):
  private/katalog_vsp9.json   – kontrolní výpis
  private/katalog_vsp9.sql    – vložení do tabulky defect_codes v Supabase (spustit v SQL Editoru)
  private/katalog_obrazky/    – obrázky z katalogu, název = kód_pořadí.png (např. 1.3.3_1.png);
                                nahrávají se v aplikaci (Kódy závad → Obrázky katalogu, jen správce)

Spuštění:  python3 tools/katalog_vsp9.py "cesta/k/VSP Příloha 9.pdf"
Potřebuje: pip install --user pdfplumber

Jak to funguje: tabulka má sloupce konstrukční část | kód | závady a poškození | opatření | třída.
Mřížka řádků v PDF není, proto se řádky párují podle svislé polohy: každý kód začíná řádek,
který trvá do dalšího kódu. Názvy konstrukčních částí přes víc řádků se skládají do bloků,
poznámky pod čarou na konci stránek se vynechávají.
"""
import json
import re
import sys
from pathlib import Path

import pdfplumber

FIRST_PAGE, LAST_PAGE = 7, 59
CODE = re.compile(r'^\d{1,2}(?:\.\d{1,2}){0,3}\*?$')
FOOTNOTE = re.compile(r'^(\*+|\d\))')
NAME_START = re.compile(r'^[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ*]')
BULLET = re.compile(r'^\s*[-–●•]')
OUT = Path(__file__).resolve().parent.parent / 'private'


def group_lines(words, tol=2.5):
    rows = []
    for w in sorted(words, key=lambda w: (round(w['top'], 1), w['x0'])):
        if rows and abs(rows[-1]['top'] - w['top']) <= tol:
            rows[-1]['words'].append(w)
        else:
            rows.append({'top': w['top'], 'words': [w]})
    for r in rows:
        r['words'].sort(key=lambda x: x['x0'])
        r['text'] = ' '.join(x['text'] for x in r['words'])
    return rows


IMG_DIR = OUT / 'katalog_obrazky'
HEADER_BOTTOM = 60      # logo v záhlaví každé stránky se vynechává


def extract(pdf_path):
    entries, last = [], None
    images = []             # (kód-záznam, page, bbox)
    with pdfplumber.open(pdf_path) as pdf:
        for pno in range(FIRST_PAGE, LAST_PAGE + 1):
            page = pdf.pages[pno - 1]
            table = page.find_tables()[0]
            xs = [c[0] for c in table.rows[0].cells if c] + [table.bbox[2]]
            assert len(xs) == 6, (pno, xs)
            head_bottom = table.rows[0].bbox[3]
            words = [w for w in page.extract_words() if w['top'] > head_bottom + 1]

            def col_of(w):
                cx = (w['x0'] + w['x1']) / 2
                for i in range(5):
                    if xs[i] - 1 <= cx < xs[i + 1] + 1:
                        return i
                return None

            # Poznámky pod čarou (vše od nich níž): oddělovací čára „____“, nebo řádek začínající
            # v 1. sloupci znakem * či „1)“, který pokračuje přes sloupec s kódy (text přes celou šířku).
            # Poznámky s hvězdičkou jen uvnitř 1. sloupce jsou součástí názvu konstrukční části.
            cut = None
            for line in group_lines(words):
                first = line['words'][0]
                if col_of(first) != 0:
                    continue
                spans_codes = any(col_of(w) == 1 and not CODE.match(w['text']) for w in line['words'])
                if first['text'].startswith('___') or (FOOTNOTE.match(first['text']) and spans_codes):
                    cut = line['top'] - 1
                    break
            if cut is not None:
                words = [w for w in words if w['top'] < cut]

            cols = [[] for _ in range(5)]
            for w in words:
                c = col_of(w)
                if c is not None:
                    cols[c].append(w)
            lines = [group_lines(c) for c in cols]
            codes = [l for l in lines[1] if CODE.match(l['text'].replace(' ', ''))]
            tops = [l['top'] for l in codes]

            def owner(top):
                idx = -1
                for i, t in enumerate(tops):
                    if top >= t - 3:
                        idx = i
                return idx

            page_entries = [{'kod': l['text'].replace(' ', ''), 'strana': pno,
                             'cast': [], 'popis': [], 'opatreni': [], 'trida': []} for l in codes]

            def target(top):
                i = owner(top)
                return page_entries[i] if i >= 0 else last

            # Konstrukční část: souvislé bloky řádků patří kódu, u kterého blok začíná.
            # Nový blok začne i bez mezery, když na řádku s jiným kódem začíná nový název (velké písmeno).
            block, prev_top = None, None
            for l in lines[0]:
                on_code_row = any(abs(l['top'] - t) <= 3 for t in tops)
                new_name = on_code_row and NAME_START.match(l['text']) and target(l['top']) is not block
                if block is None or l['top'] - prev_top > 13 or new_name:
                    block = target(l['top'])
                if block is not None:
                    block['cast'].append(l['text'])
                prev_top = l['top']
            for ci, key in [(2, 'popis'), (3, 'opatreni'), (4, 'trida')]:
                for l in lines[ci]:
                    t = target(l['top'])
                    if t is not None:
                        t[key].append(l['text'])
            # Obrázky: patří kódu, v jehož řádku začínají (podle horní hrany)
            for im in page.images:
                if im['top'] < HEADER_BOTTOM or (cut is not None and im['top'] >= cut):
                    continue
                owner_entry = target(im['top'] + 2)
                if owner_entry is not None:
                    images.append((owner_entry, page, (im['x0'], im['top'], im['x1'], im['bottom'])))
            entries.extend(page_entries)
            if page_entries:
                last = page_entries[-1]
        save_images(images)
    return entries


def save_images(images):
    """Vykreslí oblast každého obrázku (i s případnými popisky přes něj) do PNG."""
    IMG_DIR.mkdir(parents=True, exist_ok=True)
    for old in IMG_DIR.glob('*'):
        old.unlink()
    counter = {}
    for entry, page, (x0, top, x1, bottom) in images:
        kod = entry['kod'].rstrip('*')
        counter[kod] = counter.get(kod, 0) + 1
        name = f"{kod}_{counter[kod]}.png"
        box = (max(0, x0 - 2), max(0, top - 2), min(page.width, x1 + 2), min(page.height, bottom + 2))
        img = page.crop(box).to_image(resolution=200).original.convert('RGB')
        img = img.quantize(colors=128).convert('RGB') if img.width * img.height > 0 else img
        img.save(IMG_DIR / name, optimize=True)
        entry.setdefault('obrazky', []).append(name)


def tidy_text(lines):
    """Spojí zalomené řádky; nový řádek jen před odrážkou (– kritérium, ● upozornění)."""
    out = []
    for raw in lines:
        s = re.sub(r'[.…]{4,}', ' … ', raw.strip())
        s = re.sub(r'^\s*-\s+', '– ', s)
        s = re.sub(r'\s{2,}', ' ', s)
        if not s:
            continue
        if out and not BULLET.match(s):
            out[-1] += ' ' + s
        else:
            out.append(s)
    return '\n'.join(out)


def build(entries):
    by_code = {}
    result = []
    for n, e in enumerate(entries):
        kod = e['kod'].rstrip('*')
        cast = ' '.join(' '.join(e['cast']).split())
        # Text začínající hvězdičkou v 1. sloupci je poznámka, ne název konstrukční části
        note = ''
        if cast.startswith('*'):
            note, cast = cast.lstrip('*) ').strip(), ''
        item = {
            'kod': kod,
            'poradi': n + 1,
            'cast': cast,
            'poznamka': note,
            'popis': tidy_text(e['popis']),
            'opatreni': ' '.join(' '.join(e['opatreni']).split()),
            'trida': ' / '.join(t.strip() for t in e['trida'] if t.strip()),
            'strana': e['strana'],
            'obrazky': e.get('obrazky', []),
        }
        by_code[kod] = item
        result.append(item)
    for item in result:
        parts = item['kod'].split('.')
        ancestors = [by_code.get('.'.join(parts[:i])) for i in range(1, len(parts))]
        ancestors = [a for a in ancestors if a]
        # Cesta konstrukčních částí: Pojezd › Nalisované obruče kol
        names = [a['cast'] for a in ancestors if a['cast']] + ([item['cast']] if item['cast'] else [])
        item['cesta'] = ' › '.join(names)
        # Kontext popisu: když je u kódu jen kritérium (– …), doplní se nadpis z nadřazeného kódu
        context = ''
        if not item['popis'] or BULLET.match(item['popis']):
            for a in reversed(ancestors):
                head = a['popis'].split('\n')[0] if a['popis'] else ''
                if head and not BULLET.match(head):
                    context = head
                    break
        item['kontext'] = context
    return result


def sql_literal(s):
    return "'" + s.replace("'", "''") + "'" if s else 'null'


def main(pdf_path):
    items = build(extract(pdf_path))
    OUT.mkdir(exist_ok=True)
    (OUT / 'katalog_vsp9.json').write_text(json.dumps(items, ensure_ascii=False, indent=1), encoding='utf-8')
    rows = ',\n'.join(
        f"({sql_literal(i['kod'])}, {i['poradi']}, {sql_literal(i['cast'])}, {sql_literal(i['cesta'])}, "
        f"{sql_literal(i['kontext'])}, {sql_literal(i['popis'])}, {sql_literal(i['poznamka'])}, "
        f"{sql_literal(i['opatreni'])}, {sql_literal(i['trida'])}, {i['strana']})" for i in items)
    guard = (
        "do $$ begin\n"
        "  if 'č' <> U&'\\010D' then\n"
        "    raise exception 'SKRIPT JE POSKOZENY: diakritika se pri kopirovani rozsypala.';\n"
        "  end if;\n"
        "end $$;\n")
    sql = (
        "-- Závady vozů – Katalog závad a poškození (Dodatek 1 přílohy 9 VSP, vydání k 1. 1. 2026)\n"
        f"-- {len(items)} kódů. Vygenerováno skriptem tools/katalog_vsp9.py. Lze spustit opakovaně (přepíše katalog).\n"
        "-- Text katalogu patří vydavateli VSP – soubor se nenahrává na GitHub.\n\n"
        + guard + "\n"
        "delete from public.defect_codes;\n"
        "insert into public.defect_codes (kod, poradi, cast_vozu, cesta, kontext, popis, poznamka, opatreni, trida, strana) values\n"
        + rows + ";\n\n"
        "select count(*) as kodu_v_katalogu from public.defect_codes;\n")
    (OUT / 'katalog_vsp9.sql').write_text(sql, encoding='utf-8')
    print(f'{len(items)} kódů → {OUT}')


if __name__ == '__main__':
    main(sys.argv[1])
