# Závady vozů

Aplikace pro evidenci závad železničních vozů. Běží v prohlížeči na počítači a na Androidu se instaluje jako aplikace s ikonou na ploše. Používá se stejná adresa a stejný účet.

## Co umí

- **Úvodní obrazovka:** skupiny vozů – odborný název nahoře, slangový pod ním (Faccpp/Choper, Faccs/Sa, Ua, Fals/Vap, Uk, Gbgs/Trakce, Res, Smmp/Plošinové, Ostatní; v databázi `wagon_groups.name` a `slang`, na jeden řádek „Faccpp – Choper“). Červený odznak ukazuje počet otevřených závad ve skupině.
- **Hledání podle posledního čtyřčíslí**: napíšou se jen 4 číslice, pomlčka před kontrolní číslicí je předvyplněná (`017-4`). Funguje na úvodní obrazovce i uvnitř skupiny a výsledky se ukazují už během psaní. Vložené celé číslo vozu se zkrátí na poslední 4 číslice.
- **Detail vozu:** aktivní závady (oranžově) s kódem, datem, textem, fotkami a videi. Opravené závady jsou zelené a skryté pod tlačítkem **Historie oprav**.
- **Nová závada:** číslo vozu ve formátu `XX XX XXXX XXX-X` s kontrolou kontrolní číslice (UIC, Luhnův algoritmus). Nový vůz se založí automaticky, stačí vybrat skupinu. Fotky lze vyfotit, video natočit nebo obojí vybrat z galerie. Fotky se před nahráním zmenší.
- **Kód závady podle přílohy 9 VSP** (nepovinný): 4 políčka pro úrovně kódu (např. 1.2.2.1, 6.1.1.12), tečky se doplňují samy. Pod polem se nabízí odpovídající kódy z katalogu a hledání podle konstrukční části i popisu závady (popis hledacího pole se v telefonu zalomí, je vidět celý). Tlačítkem **Vybrat z katalogu závad** jde katalog procházet po částech a úrovních a kód vybrat klepnutím; tlačítko Zpět v telefonu vrací o úroveň výš a rozepsaný formulář zůstane.
- **Obrázky z katalogu** (náčrtky z přílohy 9 VSP) se ukazují u kódů při hledání i ve formuláři; klepnutím se zvětší. Nahrává je správce v záložce Kódy závad (soubory `kód_pořadí.png` z `tools/katalog_vsp9.py`).
- **Záložky na hlavní obrazovce:** **Vozy**, **Kódy závad** (hledání v katalogu jedním polem – konstrukční část i závada najednou, i skloněné tvary slov) a **Předpisy** (PDF, nahrává správce, vidí jen schválení uživatelé).
- **Datum a čas zjištění:** předvyplní se aktuální čas, ale jde zadat i zpětně (ne do budoucna). Měnit ho smí autor závady nebo správce. U zpětně zapsané závady karta ukazuje i skutečný čas zápisu.
- **Komentáře** k závadě ve stylu WhatsAppu, s živými aktualizacemi.
- **Upozornění na novou závadu** přijde všem ostatním uživatelům jako push notifikace v telefonu i při zavřené aplikaci. Kdo má aplikaci otevřenou, uvidí upozornění přímo v ní.
- **Nové závady:** u skupin a vozů je modrý odznak „2 nové“ = neopravené závady od ostatních, které uživatel ještě neviděl. Za prohlédnuté se počítají otevřením detailu vozu; tam mají ještě štítek **Nová**. Celkový počet ukazuje modrý odznak u záložky **Přehled** a v přehledu jsou tyto závady tučně s modrou tečkou; po otevření vozu se změní na běžný vzhled. Každý uživatel má vlastní stav (tabulka `wagon_seen`).
- **Sdílení do WhatsAppu:** zelené tlačítko **WhatsApp** u každé závady rovnou otevře nabídku sdílení telefonu s textem (vůz, skupina, kód i s popisem z katalogu, popis, kdy a kdo, odkaz do aplikace) a fotkami. Když to telefon hned nedovolí, otevře se okno s jedním tlačítkem; na počítači se otevře WhatsApp s textem. Po uložení nové závady se poslání nabídne samo.
- **Slabý signál:** po spuštění (a po návratu do aplikace, nejvýš jednou za 15 minut) se na pozadí stáhnou všechny skupiny, vozy, závady, komentáře k neopraveným závadám a fotky neopravených závad (`js/offline.js`). Obrazovky pak naskočí hned z paměti telefonu a ze sítě se jen obnoví. Fotky ukládá service worker (`zavady-foto`), při odhlášení se mažou.
- **Obnovení stažením dolů:** na začátku stránky stáhnout prstem dolů – odešlou se čekající závady, stáhne se vše znovu a zkontroluje se nová verze aplikace.
- **Upozornění na nového uživatele:** po registraci přijde správcům „Nový uživatel čeká na schválení“, klepnutí otevře Správu uživatelů.
- **Základní heslo 123456** (`DEFAULT_PASSWORD` v `js/model.js`): předvyplněné při registraci i při založení účtu správcem, jde přepsat. Změna hesla je nepovinná: po prvním přihlášení se základním heslem se jednou nabídne, v Můj účet → **Změnit heslo** ji má každý (příznak `temp_password` v user_metadata).
- **Účet založený správcem:** Správa uživatelů → **Založit účet** (jméno, e-mail, role, heslo). Účet je hned potvrzený i schválený, přihlašovací údaje se pošlou tlačítkem WhatsApp (Edge Function `create-user`).
- **Oprávnění** hlídá přímo databáze:

| Role | Co smí |
|---|---|
| Čeká na schválení | nic, jen vidí, že čeká (takto lze účet i zablokovat) |
| Vozmistr | zakládá vozy a závady, komentuje, **svoje** závady upravuje, maže a označuje jako opravené |
| Opravář | navíc označuje jako opravené (zeleně) i **cizí** závady a vrací je zpět |
| Správce | vše, včetně úprav a mazání cizích závad, změny skupiny vozu, mazání vozů a schvalování uživatelů |

První registrovaný uživatel se automaticky stane správcem. Další čekají na jeho schválení (Můj účet → Správa uživatelů).

## Vyzkoušení (ukázkový režim)

Dokud v `js/config.js` není vyplněné Supabase, aplikace běží v **ukázkovém režimu** s vymyšlenými daty uloženými jen v prohlížeči. Ukázkový režim se dá kdykoli zapnout i přidáním `?demo` k adrese (např. `…/zavady-vozu/?demo`), na ostrá data to nesahá. Spuštění:

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
5. Stejně nasaďte funkci pro zakládání účtů správcem (obsah `supabase/functions/create-user/index.ts`, kontrola JWT vypnutá). V tomto projektu běží pod názvem **`clever-task`** – při jiném názvu upravte `createUser` v `js/api/supabase.js`.
6. Po přihlášení aplikace na úvodní obrazovce sama nabídne **Zapnout** (karta `PushOffer` v `js/ui.js`); po povolení hned přijde zkušební upozornění. Odmítnutou nabídku jde dohnat v Můj účet → **Zapnout upozornění**. Když telefon upozornění už dřív povolil (nové přihlášení, přeinstalace), zapnou se samy bez ptaní – kromě ručně vypnutých v Můj účet. Na iPhonu v Safari karta místo zapnutí odkáže na přidání na plochu.

## Instalace na Android

Návod pro kolegy pro Android i iPhone (stránka s QR kódem): <https://zikmundmartin7-lab.github.io/zavady-vozu/navod.html>. Odkaz je i na přihlašovací obrazovce.

**iPhone / iPad (iOS 16.4+):** Safari → Sdílet → Přidat na plochu. Upozornění fungují jen v aplikaci spuštěné z ikony na ploše.

1. Otevřete adresu aplikace v **Chrome**.
2. Menu ⋮ → **Přidat na plochu** (nebo **Instalovat aplikaci**).
3. Aplikace se pak spouští z ikony, bez lišty prohlížeče, a umí přijímat upozornění.

Později lze ze stejné aplikace vytvořit i instalační soubor APK nebo ji dát na Google Play (např. přes [PWABuilder](https://www.pwabuilder.com)). Kód se přitom nemění.

## Historie, koš, exporty a zálohy

- **Historie změn:** každá změna závady, vozu, fotky, komentáře, předpisu i role uživatele se zapisuje do tabulky `audit_log` (kdo, kdy, co bylo předtím a potom). U závady: **Historie změn**, pro správce celkový přehled v **Můj účet → Historie změn**.
- **Koš:** smazané záznamy zůstávají navždy v historii a správce je obnoví v **Můj účet → Koš** (obnoví se celá akce, např. vůz i se závadami). Soubory se při mazání neodstraňují.
- **Zamčení:** opravenou závadu může měnit nebo smazat jen správce; ostatní ji nejdřív musí vrátit mezi neopravené. Komentovat jde dál.
- **Přehled a export:** záložka **Přehled** (všechny závady s filtry, i více skupin najednou) a tlačítko **Export do Excelu**. V Excelu je list se všemi závadami a k tomu list pro každou skupinu. Pravidelný export na e-mail jde omezit na vybrané skupiny.
- **Zápis bez signálu:** závada uložená bez připojení čeká v telefonu a odešle se sama.
- **Server** (`server/`, běží na stejném serveru jako chatbot): každou noc ve 2:30 záloha databáze (`pg_dump`) a všech souborů do `/var/backups/zavady`, každou hodinu rozeslání pravidelných exportů (nastavuje správce v **Můj účet → Pravidelné exporty**). E-maily jdou přes Gmail (heslo pro aplikace). Nahrání: vyplnit `server/.env` podle `server/.env.example` a spustit `server/deploy.sh root@2.31.44.49`.

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
supabase/functions/create-user/           správce zakládá účty s heslem (bez potvrzovacího e-mailu)
supabase/oprava_*.sql, migrace_*.sql      jednorázové opravy a úpravy databáze
server/                                   noční zálohy a pravidelné exporty na e-mail (služba na serveru)
tools/katalog_vsp9.py                     převod katalogu závad z PDF přílohy 9 VSP (výstup do private/, mimo GitHub)
navod.html                                návod k instalaci, Android i iPhone (QR: tools/qr.py)
tools/ikony.py, tools/vapid.html          ikony aplikace, generátor klíčů
.github/workflows/keep-alive.yml          udržení projektu Supabase vzhůru
```
