"""Závady vozů – služba na serveru: noční zálohy a pravidelné exporty na e-mail.

Použití (na serveru v /opt/zavady-server, spouští je systemd časovače):
  python3 zavady.py check              ověří spojení (Supabase, databáze, e-mail), nic neposílá
  python3 zavady.py backup             záloha databáze + všech souborů (fotky, PDF) do BACKUP_DIR
  python3 zavady.py exports            rozešle pravidelné exporty, které jsou právě na řadě
  python3 zavady.py send-test EMAIL [SKUPINY]
                                       pošle hned zkušební e-mail s exportem neopravených závad
                                       (SKUPINY = čísla skupin oddělená čárkou, např. 1,2; bez nich všechny)

Nastavení je v souboru .env vedle skriptu (viz .env.example). Kromě openpyxl a pg_dump
(balíčky python3-openpyxl a postgresql-client) potřebuje jen standardní knihovnu Pythonu.
"""
import gzip
import io
import json
import re
import shutil
import smtplib
import subprocess
import sys
import traceback
import unicodedata
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
TZ = ZoneInfo('Europe/Prague')
BUCKETS = ['attachments', 'predpisy', 'katalog']
KEEP_DAILY = 30             # posledních 30 záloh databáze + první záloha každého měsíce navždy


def load_env(path=ROOT / '.env'):
    values = {}
    if not path.exists():
        return values
    for raw in path.read_text(encoding='utf-8').splitlines():
        line = raw.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in '"\'':
            value = value[1:-1]
        values[key.strip()] = value
    return values


ENV = load_env()
URL = ENV.get('SUPABASE_URL', '').rstrip('/')
KEY = ENV.get('SUPABASE_SECRET_KEY', '')
BACKUP_DIR = Path(ENV.get('BACKUP_DIR', '/var/backups/zavady'))
APP_URL = ENV.get('APP_URL', 'https://zikmundmartin7-lab.github.io/zavady-vozu/')


# ───── Supabase (REST a úložiště) se serverovým klíčem ─────

def _headers(extra=None):
    h = {'apikey': KEY}
    if KEY.startswith('eyJ'):                  # starší klíč service_role (JWT) se posílá i jako Bearer
        h['Authorization'] = f'Bearer {KEY}'
    h.update(extra or {})
    return h


def http(method, url, body=None, headers=None, raw=False):
    data = json.dumps(body).encode() if body is not None else None
    req = Request(url, data=data, method=method, headers=_headers({'Content-Type': 'application/json', **(headers or {})}))
    try:
        with urlopen(req, timeout=120) as r:
            payload = r.read()
    except HTTPError as e:
        raise RuntimeError(f'{method} {url.split("?")[0]} → HTTP {e.code}: {e.read()[:300].decode(errors="replace")}') from None
    if raw:
        return payload
    return json.loads(payload) if payload else None


def rest(table, params=None, method='GET', body=None):
    q = f'?{urlencode(params)}' if params else ''
    return http(method, f'{URL}/rest/v1/{table}{q}', body, headers={'Prefer': 'return=minimal'} if method == 'PATCH' else None)


def rest_all(table, select, extra=None, order='id', page=1000):
    rows = []
    while True:
        part = rest(table, {'select': select, 'order': order, 'limit': page, 'offset': len(rows), **(extra or {})})
        rows += part
        if len(part) < page:
            return rows


def storage_list(bucket, prefix=''):
    """Všechny soubory v bucketu (rekurzivně): [(cesta, velikost)]."""
    out, offset = [], 0
    while True:
        items = http('POST', f'{URL}/storage/v1/object/list/{bucket}',
                     {'prefix': prefix, 'limit': 1000, 'offset': offset, 'sortBy': {'column': 'name', 'order': 'asc'}})
        for it in items:
            path = f'{prefix}{it["name"]}'
            if it.get('id') is None:           # složka
                out += storage_list(bucket, f'{path}/')
            else:
                out.append((path, (it.get('metadata') or {}).get('size')))
        if len(items) < 1000:
            return out
        offset += 1000


def storage_get(bucket, path):
    return http('GET', f'{URL}/storage/v1/object/{bucket}/{quote(path)}', raw=True)


# ───── E-mail ─────

def send_mail(to, subject, text, attachment=None):
    msg = EmailMessage()
    msg['From'] = f'{ENV.get("MAIL_FROM_NAME", "Závady vozů")} <{ENV["SMTP_USER"]}>'
    msg['To'] = to
    msg['Subject'] = subject
    msg.set_content(text)
    if attachment:
        name, data = attachment
        msg.add_attachment(data, maintype='application',
                           subtype='vnd.openxmlformats-officedocument.spreadsheetml.sheet', filename=name)
    with smtplib.SMTP(ENV.get('SMTP_HOST', 'smtp.gmail.com'), int(ENV.get('SMTP_PORT', '587')), timeout=60) as s:
        s.starttls()
        s.login(ENV['SMTP_USER'], ENV['SMTP_PASSWORD'])
        s.send_message(msg)


def alert(subject, text):
    """Upozornění správci, že se něco nepovedlo (když je nastavené ALERT_EMAIL)."""
    to = ENV.get('ALERT_EMAIL')
    if not to:
        return
    try:
        send_mail(to, f'Závady vozů – {subject}', text)
    except Exception as e:                    # noqa: BLE001 – upozornění nesmí shodit zbytek
        print('Nepodařilo se poslat upozornění:', e, file=sys.stderr)


# ───── Záloha ─────

def backup():
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    db_dir = BACKUP_DIR / 'db'
    db_dir.mkdir(exist_ok=True)
    stamp = datetime.now(TZ).strftime('%Y-%m-%d_%H%M')
    target = db_dir / f'zavady-{stamp}.sql.gz'
    tmp = target.with_suffix('.tmp')
    dump = subprocess.run(
        ['pg_dump', '--dbname', ENV['SUPABASE_DB_URL'], '--schema=public', '--no-owner', '--no-privileges'],
        capture_output=True, timeout=1800)
    if dump.returncode != 0:
        raise RuntimeError(f'pg_dump selhal: {dump.stderr.decode(errors="replace")[:500]}')
    with gzip.open(tmp, 'wb') as f:
        f.write(dump.stdout)
    tmp.rename(target)
    print(f'Databáze: {target.name} ({target.stat().st_size // 1024} kB)')

    # Uchovávání: posledních KEEP_DAILY záloh + první záloha každého měsíce
    dumps = sorted(db_dir.glob('zavady-*.sql.gz'))
    keep = set(dumps[-KEEP_DAILY:])
    first_of_month = {}
    for p in dumps:
        first_of_month.setdefault(p.name[7:14], p)
    keep |= set(first_of_month.values())
    for p in dumps:
        if p not in keep:
            p.unlink()

    # Soubory: stáhnout, co ještě v záloze není (nic se nemaže – smazané z aplikace zůstanou i tady)
    new = 0
    for bucket in BUCKETS:
        for path, size in storage_list(bucket):
            local = BACKUP_DIR / 'storage' / bucket / path
            if local.exists() and (size is None or local.stat().st_size == size):
                continue
            local.parent.mkdir(parents=True, exist_ok=True)
            part = local.with_name(local.name + '.part')
            part.write_bytes(storage_get(bucket, path))
            part.rename(local)
            new += 1
    total = sum(1 for _ in (BACKUP_DIR / 'storage').rglob('*') if _.is_file()) if (BACKUP_DIR / 'storage').exists() else 0
    print(f'Soubory: {new} nových, celkem {total}')
    free = shutil.disk_usage(BACKUP_DIR).free // 2**30
    if free < 2:
        alert('na serveru dochází místo', f'Na disku serveru zbývá jen {free} GB místa pro zálohy.')


# ───── Export do Excelu ─────

COLUMNS = [
    ('Číslo vozu', 18), ('Skupina', 16), ('Kód závady', 11), ('Konstrukční část (dle kódu)', 34),
    ('Popis závady', 50), ('Zjištěno', 16), ('Vložil(a)', 18), ('Vloženo', 16), ('Stav', 12),
    ('Opraveno', 16), ('Opravil(a)', 18), ('Poznámka k opravě', 30), ('Komentářů', 11), ('Fotek a videí', 13),
]


def fmt_number(n):
    n = n or ''
    return f'{n[:2]} {n[2:4]} {n[4:8]} {n[8:11]}-{n[11:]}' if len(n) == 12 else n


def local_dt(iso):
    if not iso:
        return None
    return datetime.fromisoformat(iso.replace('Z', '+00:00')).astimezone(TZ).replace(tzinfo=None)


def load_defects(report, group_ids=None):
    """Řádky exportu [(id skupiny, [hodnoty sloupců])] a seznam skupin; group_ids = jen tyto skupiny."""
    extra = {'resolved_at': 'is.null'} if report == 'open' else None
    defects = rest_all('defect_feed', 'id,wagon_id,description,defect_code,found_at,created_at,created_by_name,'
                       'resolved_at,resolved_by_name,resolution_note,comment_count', extra)
    wagons = {w['id']: w for w in rest_all('wagons', 'id,number,group_id')}
    groups = rest('wagon_groups', {'select': '*', 'order': 'sort'})
    for g in groups:  # odborný a slangový název na jeden řádek: „Faccpp – Choper“ (jako v aplikaci)
        g['name'] = ' – '.join(x for x in (g['name'], g.get('slang')) if x)
    names = {g['id']: g['name'] for g in groups}
    parts = {c['kod']: c['cesta'] for c in rest_all('defect_codes', 'kod,cesta', order='kod')}
    att = {}
    for a in rest_all('attachments', 'defect_id'):
        att[a['defect_id']] = att.get(a['defect_id'], 0) + 1
    rows = []
    for d in defects:
        w = wagons.get(d['wagon_id'], {})
        if group_ids and w.get('group_id') not in group_ids:
            continue
        rows.append((w.get('group_id'), [
            fmt_number(w.get('number')), names.get(w.get('group_id'), ''), d['defect_code'] or '',
            parts.get(d['defect_code'], '') if d['defect_code'] else '', d['description'],
            local_dt(d['found_at'] or d['created_at']), d['created_by_name'] or '', local_dt(d['created_at']),
            'Opraveno' if d['resolved_at'] else 'Neopravená', local_dt(d['resolved_at']), d['resolved_by_name'] or '',
            d['resolution_note'] or '', d['comment_count'] or 0, att.get(d['id'], 0),
        ]))
    rows.sort(key=lambda r: r[1][5] or datetime.min, reverse=True)
    return rows, groups


def sheet_title(name, used):
    """Název listu: max. 31 znaků, bez znaků [ ] : * ? / \\ a bez opakování."""
    base = re.sub(r'[\[\]:*?/\\]', '-', name).strip("' ")[:31] or 'List'
    title, i = base, 2
    while title.lower() in used:
        title = f'{base[:31 - len(str(i)) - 3]} ({i})'
        i += 1
    used.add(title.lower())
    return title


def fill_sheet(ws, rows):
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter
    ws.append([c for c, _ in COLUMNS])
    for cell in ws[1]:
        cell.font = Font(bold=True)
        cell.fill = PatternFill('solid', fgColor='E8EFF8')
    for r in rows:
        ws.append(r)
    for i, (_, width) in enumerate(COLUMNS, start=1):
        ws.column_dimensions[get_column_letter(i)].width = width
    for row in ws.iter_rows(min_row=2):
        for cell in row:
            if isinstance(cell.value, datetime):
                cell.number_format = 'd.m.yyyy h:mm'
            elif isinstance(cell.value, str):
                cell.alignment = Alignment(vertical='top', wrap_text=True)
    ws.freeze_panes = 'A2'
    ws.auto_filter.ref = f'A1:{get_column_letter(len(COLUMNS))}{max(len(rows) + 1, 1)}'


def build_xlsx(rows, groups, group_ids=None):
    """První list se všemi závadami, pak list pro každou skupinu (je-li jich v exportu víc).
    Vybrané skupiny mají list vždy (i prázdný), u exportu všech skupin jen ty, kde jsou závady."""
    from openpyxl import Workbook
    present = [g for g in groups if (g['id'] in group_ids if group_ids else any(gid == g['id'] for gid, _ in rows))]
    if len(present) == 1:
        sheets = [(present[0]['name'], [r for _, r in rows])]
    else:
        sheets = [('Všechny závady', [r for _, r in rows])]
        sheets += [(g['name'], [r for gid, r in rows if gid == g['id']]) for g in present]
    wb = Workbook()
    wb.remove(wb.active)
    used = set()
    for name, data in sheets:
        fill_sheet(wb.create_sheet(sheet_title(name, used)), data)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def slug(text):
    text = unicodedata.normalize('NFKD', text).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]+', '-', text).strip('-')


def send_export(to, report, group_ids=None):
    rows, groups = load_defects(report, group_ids)
    chosen = [g['name'] for g in groups if group_ids and g['id'] in group_ids]
    today = datetime.now(TZ)
    label = 'neopravené závady' if report == 'open' else 'všechny závady'
    which = f' ({", ".join(chosen)})' if chosen else ''
    parts = ['neopravene' if report == 'open' else 'vsechny']
    if chosen:
        parts.append(f'{len(chosen)}-skupin' if len(chosen) > 3 else '-'.join(slug(n) for n in chosen))
    name = f'zavady-{"-".join(parts)}-{today:%Y-%m-%d}.xlsx'
    open_count = sum(1 for _, r in rows if r[8] == 'Neopravená')
    text = (f'Dobrý den,\n\nv příloze je přehled: {label}{which} ke dni {today:%-d. %-m. %Y %-H:%M}.\n'
            f'Počet závad v přehledu: {len(rows)} (z toho neopravených: {open_count}).\n'
            'V souboru je list se všemi závadami a k tomu list pro každou skupinu vozů.\n\n'
            f'Aplikace: {APP_URL}\n\nTento e-mail posílá automaticky aplikace Závady vozů. '
            'Nastavení pravidelných exportů: Můj účet → Pravidelné exporty na e-mail.\n')
    send_mail(to, f'Závady vozů – {label}{which} ({today:%-d. %-m. %Y})', text, (name, build_xlsx(rows, groups, group_ids)))
    return len(rows)


# ───── Pravidelné exporty ─────

def last_slot(s, now):
    """Poslední okamžik, kdy měl export proběhnout (v čase Prahy)."""
    base = now.replace(hour=s['hour'], minute=0, second=0, microsecond=0)
    if s['frequency'] == 'daily':
        return base if base <= now else base - timedelta(days=1)
    if s['frequency'] == 'weekly':
        back = (now.weekday() - ((s.get('weekday') or 1) - 1)) % 7
        slot = base - timedelta(days=back)
        return slot if slot <= now else slot - timedelta(days=7)
    day = s.get('monthday') or 1
    slot = base.replace(day=day)
    if slot > now:
        prev = (slot.replace(day=1) - timedelta(days=1))
        slot = prev.replace(day=day, hour=s['hour'])
    return slot


def parse_ts(iso):
    return datetime.fromisoformat(iso.replace('Z', '+00:00')) if iso else None


def exports():
    now = datetime.now(TZ)
    failed = []
    for s in rest('export_schedules', {'select': '*', 'active': 'eq.true'}):
        slot = last_slot(s, now)
        since = max(filter(None, [parse_ts(s.get('last_sent_at')), parse_ts(s['created_at'])]))
        if slot <= since:
            continue
        try:
            n = send_export(s['recipient'], s['report'], s.get('group_ids'))
            rest('export_schedules', {'id': f'eq.{s["id"]}'}, 'PATCH',
                 {'last_sent_at': datetime.now(timezone.utc).isoformat(), 'last_error': None})
            print(f'Odesláno: {s["recipient"]} (počet závad: {n})')
        except Exception as e:                 # noqa: BLE001 – ostatní exporty mají proběhnout
            msg = str(e)[:300]
            rest('export_schedules', {'id': f'eq.{s["id"]}'}, 'PATCH', {'last_error': msg})
            failed.append(f'{s["recipient"]}: {msg}')
    if failed:
        alert('pravidelný export se nepovedl', '\n'.join(failed))


# ───── Kontrola ─────

def check():
    ok = True

    def step(name, fn):
        nonlocal ok
        try:
            print(f'✓ {name}: {fn()}')
        except Exception as e:                 # noqa: BLE001
            ok = False
            print(f'✗ {name}: {e}')

    missing = [k for k in ('SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'SUPABASE_DB_URL', 'SMTP_USER', 'SMTP_PASSWORD') if not ENV.get(k)]
    if missing:
        print('✗ V .env chybí:', ', '.join(missing))
        return False
    step('Supabase (data)', lambda: f'{len(rest("wagon_groups", {"select": "id"}))} skupin vozů')
    step('Supabase (soubory)', lambda: f'{len(storage_list("predpisy"))} předpisů v úložišti')
    def db():
        # bez check=True: chybová hláška by jinak obsahovala celý příkaz včetně hesla k databázi
        r = subprocess.run(['pg_dump', '--dbname', ENV['SUPABASE_DB_URL'], '--schema-only', '--table=public.wagon_groups'],
                           capture_output=True, timeout=120)
        if r.returncode != 0:
            raise RuntimeError(r.stderr.decode(errors='replace').strip()[:300])
        return 'spojení funguje'
    step('Databáze (pg_dump)', db)

    def smtp():
        with smtplib.SMTP(ENV.get('SMTP_HOST', 'smtp.gmail.com'), int(ENV.get('SMTP_PORT', '587')), timeout=30) as s:
            s.starttls()
            s.login(ENV['SMTP_USER'], ENV['SMTP_PASSWORD'])
        return f'přihlášení k {ENV["SMTP_USER"]} funguje'
    step('E-mail (SMTP)', smtp)
    return ok


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else ''
    try:
        if cmd == 'check':
            sys.exit(0 if check() else 1)
        elif cmd == 'backup':
            backup()
        elif cmd == 'exports':
            exports()
        elif cmd == 'send-test' and len(sys.argv) > 2:
            ids = [int(x) for x in sys.argv[3].split(',')] if len(sys.argv) > 3 else None
            print(f'Odesláno na {sys.argv[2]}, počet závad: {send_export(sys.argv[2], "open", ids)}')
        else:
            print(__doc__)
            sys.exit(2)
    except Exception:                          # noqa: BLE001
        err = traceback.format_exc()
        print(err, file=sys.stderr)
        if cmd in ('backup', 'exports'):
            alert('chyba na serveru' if cmd == 'exports' else 'noční záloha se nepovedla', err[-1500:])
        sys.exit(1)


if __name__ == '__main__':
    main()
