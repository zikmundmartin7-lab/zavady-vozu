# Závady vozů

Aplikace pro evidenci závad železničních vozů. Běží v prohlížeči na počítači a na Androidu se instaluje jako aplikace s ikonou na ploše. Používá se stejná adresa a stejný účet.

## Co umí

- **Úvodní obrazovka:** skupiny vozů (Chopry, SA, UA, Vapy/Fals, Trakce/Zetky, Plošiňáky/Res/Smmp, Ostatní). Červený odznak ukazuje počet otevřených závad ve skupině.
- **Hledání podle posledního čtyřčíslí**: napíšou se jen 4 číslice, pomlčka před kontrolní číslicí je předvyplněná (`017-4`). Funguje na úvodní obrazovce i uvnitř skupiny a výsledky se ukazují už během psaní. Vložené celé číslo vozu se zkrátí na poslední 4 číslice.
- **Detail vozu:** aktivní závady barevně podle závažnosti (žlutá, oranžová, červená), s datem, textem, fotkami a videi. Opravené závady jsou zelené a skryté pod tlačítkem **Historie oprav**.
- **Nová závada:** číslo vozu ve formátu `XX XX XXXX XXX-X` s kontrolou kontrolní číslice (UIC, Luhnův algoritmus). Nový vůz se založí automaticky, stačí vybrat skupinu. Fotky lze vyfotit, video natočit nebo obojí vybrat z galerie. Fotky se před nahráním zmenší.
- **Komentáře** k závadě ve stylu WhatsAppu, s živými aktualizacemi.
- **Upozornění na novou závadu** přijde všem ostatním uživatelům jako push notifikace v telefonu i při zavřené aplikaci. Kdo má aplikaci otevřenou, uvidí upozornění přímo v ní.
- **Oprávnění** hlídá přímo databáze:

| Role | Co smí |
|---|---|
| Čeká na schválení | nic, jen vidí, že čeká (takto lze účet i zablokovat) |
| Vozmistr | zakládá vozy a závady, komentuje, **svoje** závady upravuje, maže a označuje jako opravené |
| Opravář | navíc označuje jako opravené (zeleně) i **cizí** závady a vrací je zpět |
| Správce | vše, včetně úprav a mazání cizích závad, změny skupiny vozu, mazání vozů a schvalování uživatelů |

První registrovaný uživatel se automaticky stane správcem. Další čekají na jeho schválení (Můj účet → Správa uživatelů).

## Vyzkoušení (ukázkový režim)

Dokud v `js/config.js` není vyplněné Supabase, aplikace běží v **ukázkovém režimu** s vymyšlenými daty uloženými jen v prohlížeči. Spuštění:

```bash
python3 -m http.server 8765
```

Pak otevřete <http://localhost:8765>. Na přihlašovací obrazovce lze vybrat roli (správce, opravář, uživatel, čekající). Pokud otevřete aplikaci ve dvou kartách jako dva různí uživatelé, uvidíte i upozornění na novou závadu.

## Ostrý provoz: krok za krokem

Data se ukládají v [Supabase](https://supabase.com): databázi, přihlašování, úložišti fotek a živých změnách. Pro začátek stačí bezplatný tarif.

1. **Založte projekt** na supabase.com: New project, region **Central EU (Frankfurt)**, aby data zůstala v EU.
2. **Vytvořte databázi:** SQL Editor → New query → vložte celý obsah `supabase/schema.sql` → **Run**.
3. **Propojte aplikaci:** Project Settings → API zkopírujte *Project URL* a *anon public* klíč do `js/config.js`. Anon klíč je veřejný a smí být v aplikaci, data chrání pravidla v databázi.
4. **Zveřejněte aplikaci** na adrese s HTTPS (bez HTTPS nejde instalace ani upozornění). Zdarma to jde třeba přes Netlify (přetáhnout složku na app.netlify.com/drop), Cloudflare Pages nebo GitHub Pages. Nahrává se celá složka, nic se nesestavuje.
5. **Nastavte adresu v Supabase:** Authentication → URL Configuration → *Site URL* = adresa aplikace. Odkazy v e-mailech (potvrzení účtu, zapomenuté heslo) pak vedou správně.
6. **Zaregistrujte se jako první.** Stanete se správcem.

### Push upozornění na telefon

1. Otevřete `tools/vapid.html` na adrese aplikace (nebo lokálně <http://localhost:8765/tools/vapid.html>) → **Vygenerovat klíče**.
2. Veřejný klíč vložte do `js/config.js` (`VAPID_PUBLIC_KEY`).
3. V Supabase: Edge Functions → Secrets → přidejte `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` a `VAPID_SUBJECT` (`mailto:` + váš e-mail).
4. Edge Functions → Deploy a new function → Via Editor → název **`notify-new-defect`** → vložte obsah `supabase/functions/notify-new-defect/index.ts` → Deploy. V nastavení funkce vypněte kontrolu JWT (funkce si přihlášení ověřuje sama).
5. Každý uživatel si upozornění zapne v aplikaci: Můj účet → **Zapnout upozornění**. Tlačítkem **Poslat zkušební** si ověří, že chodí.

## Instalace na Android

1. Otevřete adresu aplikace v **Chrome**.
2. Menu ⋮ → **Přidat na plochu** (nebo **Instalovat aplikaci**).
3. Aplikace se pak spouští z ikony, bez lišty prohlížeče, a umí přijímat upozornění.

Později lze ze stejné aplikace vytvořit i instalační soubor APK nebo ji dát na Google Play (např. přes [PWABuilder](https://www.pwabuilder.com)). Kód se přitom nemění.

## Limity a náklady

Bezplatný tarif Supabase (ověřte aktuální stav na supabase.com/pricing):

- 1 GB na fotky a videa, max. 50 MB na jeden soubor. Fotka po zmenšení má zhruba 0,3–0,5 MB, takže se vejdou tisíce fotek. Videa místo zaberou rychle.
- 500 MB databáze, což na texty závad a komentáře stačí na roky.
- Projekt se **uspí po týdnu bez používání**. Brání tomu naplánovaná úloha na GitHubu (`.github/workflows/keep-alive.yml`): v pondělí a ve čtvrtek pošle databázi jeden dotaz. Když selže, GitHub pošle e-mail. Uspaný projekt se probudí v Supabase tlačítkem **Restore project**.
- Placený tarif Pro stojí 25 USD měsíčně a má 100 GB na soubory a žádné uspávání.

## Struktura

```
index.html, manifest.webmanifest, sw.js   stránka, instalace na plochu, offline a push
css/app.css                               vzhled
js/config.js                              připojení k Supabase (prázdné = ukázkový režim)
js/model.js                               čísla vozů, kontrolní číslice, hledání, role
js/api/supabase.js | demo.js              ostrá data | ukázková data v prohlížeči
js/ui.js, js/views/*.js                   obrazovky (Preact + htm, bez sestavování)
supabase/schema.sql                       tabulky, oprávnění (RLS), úložiště
supabase/functions/notify-new-defect/     rozesílání push upozornění
supabase/oprava_*.sql                     jednorázové opravy diakritiky (už provedené)
tools/ikony.py, tools/vapid.html          ikony aplikace, generátor klíčů
.github/workflows/keep-alive.yml          udržení projektu Supabase vzhůru
```
