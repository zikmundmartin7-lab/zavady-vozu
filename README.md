# Závady vozů

Aplikace pro evidenci závad železničních vozů. Běží v prohlížeči na počítači a na Androidu se instaluje jako aplikace s ikonou na ploše. Používá se stejná adresa a stejný účet.

## Co umí

- **Úvodní obrazovka:** skupiny vozů – odborný název nahoře, slangový pod ním (Faccpp/Choper, Faccs/Sa, Ua, Fals/Vap, Uk, Gbgs/Trakce, Res, Smmp/Plošinové, Ostatní; v databázi `wagon_groups.name` a `slang`, na jeden řádek „Faccpp – Choper“). Modrý odznak ukazuje počet otevřených závad ve skupině.
- **Hledání podle posledního čtyřčíslí**: napíšou se jen 4 číslice, pomlčka před kontrolní číslicí je předvyplněná (`017-4`). Funguje na úvodní obrazovce i uvnitř skupiny a výsledky se ukazují už během psaní. Vložené celé číslo vozu se zkrátí na poslední 4 číslice.
- **Detail vozu:** aktivní závady (oranžově) s kódem, datem, textem, fotkami a videi. Opravené závady jsou zelené a skryté pod tlačítkem **Historie oprav**.
- **Nová závada:** číslo vozu ve formátu `XX XX XXXX XXX-X` s kontrolou kontrolní číslice (UIC, Luhnův algoritmus). Nový vůz se založí automaticky, stačí vybrat skupinu. Fotky lze vyfotit, video natočit nebo obojí vybrat z galerie. Fotky se před nahráním zmenší.
- **Číslo vozu kamerou:** modré tlačítko s fotoaparátem vedle čísla otevře skener převzatý z aplikace Výkaz vozů (`js/views/scanner.js`, `js/ocr.js`, `numberCandidates` v `js/model.js`). Neuronová síť PaddleOCR (PP-OCRv5 mobile, ONNX Runtime Web) čte číslo přímo v telefonu bez internetu; kamera běží v nejvyšším rozlišení, které telefon webu dá (až 4K), a text se čte z výřezu v plném rozlišení. Číslo se přijme samo, jen když ho síť přečte ve dvou snímcích po sobě a sedí kontrolní číslice, kód státu i rozdělení 2-2-4-3-1; jinak ho jen nabídne k ťuknutí. Přijaté číslo se ukáže s výřezem snímku k porovnání s vozem. Svítilna, jas obrazu (korekce expozice nebo softwarově) a záloha fotkou. Sítě a runtime (asi 25 MB) se kvůli terénu bez signálu stahují **hned s novou verzí aplikace** (instalace service workeru, jen poprvé) do vlastní zásoby `zavady-ocr-v1`, která přežívá další verze; když se to nepovede, dotáhne je aplikace při dalším spuštění se signálem (`prefetchOcr` v `js/offline.js`). V **Můj účet** pod číslem verze je vidět, jestli je skener stažený a funguje bez signálu.
- **Kód závady podle přílohy 9 VSP** (nepovinný): 4 políčka pro úrovně kódu (např. 1.2.2.1, 6.1.1.12), tečky se doplňují samy. Pod polem se nabízí odpovídající kódy z katalogu a hledání podle konstrukční části i popisu závady (popis hledacího pole se v telefonu zalomí, je vidět celý). Tlačítkem **Vybrat z katalogu závad** jde katalog procházet po částech a úrovních a kód vybrat klepnutím; tlačítko Zpět v telefonu vrací o úroveň výš a rozepsaný formulář zůstane.
- **Obrázky z katalogu** (náčrtky z přílohy 9 VSP) se ukazují u kódů při hledání i ve formuláři; klepnutím se zvětší. Nahrává je administrátor v záložce Kódy závad (soubory `kód_pořadí.png` z `tools/katalog_vsp9.py`).
- **Záložky na hlavní obrazovce:** **Vozy**, **Kódy závad** (hledání v katalogu jedním polem – konstrukční část i závada najednou, i skloněné tvary slov) a **Předpisy** (PDF, nahrává administrátor, vidí jen schválení uživatelé).
- **Datum a čas zjištění:** předvyplní se aktuální čas, ale jde zadat i zpětně (ne do budoucna). Měnit ho smí autor závady nebo administrátor. U zpětně zapsané závady karta ukazuje i skutečný čas zápisu.
- **Komentáře** k závadě ve stylu WhatsAppu, s živými aktualizacemi. Na nový komentář přijde upozornění autorovi závady a všem, kdo už ji komentovali (kromě pisatele); klepnutí otevře komentáře. Kdo má aplikaci otevřenou, uvidí ho přímo v ní (ne na právě otevřené závadě). Push posílá Edge Function `notify-new-defect` (`{ comment_id }`) – po její změně ji v Supabase znovu nasaďte. Nepřečtené komentáře ukazuje **kulaté tlačítko s bublinou a červeným číslem** nad tlačítkem Nová závada (úvodní obrazovka a skupina); klepnutí otevře seznam **Nové komentáře** (závada, počet, poslední komentář) a u závady je u komentářů štítek „2 nové“. Přečtené = otevřený detail závady, platí na všech zařízeních (tabulka `comment_seen`, pohled `comment_inbox`, skript `supabase/migrace_07_nove_komentare.sql`).
- **Upozornění na novou závadu** přijde všem ostatním uživatelům jako push notifikace v telefonu i při zavřené aplikaci. Kdo má aplikaci otevřenou, uvidí upozornění přímo v ní. Na iPhonu a v Safari se upozornění z telefonu ukáže vždy (Safari vyžaduje, aby se každé push upozornění zobrazilo, jinak odběr zruší). Upozornění se posílají jako naléhavá (`urgency: high`), aby je Android doručil hned i zamčenému telefonu v úsporném režimu.
- **Nové závady:** u skupin a vozů je červený odznak „2 nové“ = neopravené závady od ostatních, které uživatel ještě neviděl. Za prohlédnuté se počítají otevřením detailu vozu; tam mají ještě štítek **Nová**. Celkový počet ukazuje červený odznak u záložky **Přehled** (jako u aplikací v telefonu) a v přehledu jsou tyto závady tučně s červenou tečkou; po otevření vozu se změní na běžný vzhled. Každý uživatel má vlastní stav (tabulka `wagon_seen`).
- **Sdílení do WhatsAppu:** zelené tlačítko **WhatsApp** u každé závady rovnou otevře nabídku sdílení telefonu s textem a fotkami. Text je jen **číslo vozu (tučně) a popis závady** (`defectShareText` v `js/ui.js`, přání uživatele 29. 10.) – bez skupiny, kódu, data, autora a odkazu; videa se do WhatsAppu neposílají. Když to telefon hned nedovolí, otevře se okno s jedním tlačítkem; na počítači se otevře WhatsApp s textem. Po uložení nové závady se poslání nabídne samo. Na iPhonu odejdou fotky jednotlivě a text pod nimi jedním sdílením. Na Androidu s víc fotkami otevře tlačítko okno se **dvěma kroky** (`twoSteps` v `js/ui.js`): **1. Poslat fotky** (bez textu, ve WhatsAppu album; text se při tom zkopíruje, takže ho uživatel může ve WhatsAppu rovnou vložit pod fotky) a po návratu do aplikace **2. Poslat text** do stejné skupiny – WhatsApp v Androidu jinak připíše celý text ke každé fotce. Pod **Jiné možnosti** je na Androidu i **jeden obrázek s fotkami pod sebou** i s textem (s čísly fotek, `collageFile`, skládá se až po klepnutí; WhatsApp ho zmenší podle delší strany, takže čím víc fotek, tím je každá užší). Po uložení se sdílí zmenšené kopie fotek z formuláře (originály z fotoaparátu Chrome v Androidu do sdílení nepředal). Když telefon nabídku sdílení vůbec neotevře, okno to ukáže a nabídne WhatsApp jen s textem.
- **Fotky bez účtu (dobíhá):** zprávy do verze 45 obsahovaly odkaz „Fotky v plné kvalitě ke stažení“ na veřejnou stránku `fotky.html?z=<id závady>` (fotky a videa jedné závady, **Stáhnout vše**). Data dává Edge Function `fotky` (`supabase/functions/fotky`, v Supabase pojmenovaná `smooth-endpoint`, název je přímo ve `fotky.html`; Verify JWT vypnuté, service role, odkazy na soubory platí hodinu); klíčem je náhodné ID závady. Nové zprávy odkaz nemají – až staré odkazy nebudou potřeba, funkci v Supabase smazat (stránka pak ukáže chybu). V aplikaci má prohlížeč fotek závady tlačítka **Stáhnout** a **Vše** (u obrázků z důvěrného katalogu ne).
- **Sdílení fotek do aplikace (Android):** v Galerii **Sdílet → Závady vozů** otevře novou závadu s vybranými fotkami a videi (`share_target` v manifestu, `sw.js` je uloží do mezipaměti `zavady-sdilene`, formulář si je vyzvedne). Funguje v aplikaci přidané na plochu; po změně manifestu ji Chrome v telefonu aktualizuje zhruba do dne.
- **Rozepsaná závada se průběžně ukládá** (`js/draft.js`: údaje v localStorage, fotky a videa v IndexedDB, zvlášť pro každý vůz). Když Android při focení nebo natáčení aplikaci zavře, po návratu se formulář obnoví; koncept se smaže po uložení závady nebo tlačítkem **Zahodit**, po 12 hodinách sám.
- **Tlačítko Zpět:** šipka v aplikaci vrací krokem zpět v historii, přepínání záložek se nehromadí a otevřená fotka i okno sdílení se zavřou gestem Zpět v telefonu (`goBack`, `useBackClose` v `js/ui.js`).
- **Slabý signál:** po spuštění (a po návratu do aplikace, nejvýš jednou za 15 minut) se na pozadí stáhnou všechny skupiny, vozy, závady, komentáře k neopraveným závadám a fotky neopravených závad (`js/offline.js`). Obrazovky pak naskočí hned z paměti telefonu a ze sítě se jen obnoví. Fotky ukládá service worker (`zavady-foto`), při odhlášení se mažou.
- **Aplikace na plochu:** na přihlašovací obrazovce, při čekání na schválení a na úvodní obrazovce karta (`InstallOffer` v `js/ui.js`): v Chrome na Androidu tlačítko **Instalovat** (systémové okno, stačí potvrdit), v jiném prohlížeči nebo uvnitř WhatsAppu **Otevřít v Chrome**, na iPhonu postup Sdílet → Přidat na plochu. Sama se aplikace nainstalovat nemůže – prohlížeče to nedovolí. „Teď ne“ skryje kartu na tomto zařízení na týden; v nainstalované aplikaci se neukazuje. Na úvodní obrazovce se nabídky (instalace → upozornění → fotoaparát) ukazují postupně, vždy jen jedna (`.offers` v `css/app.css`).
- **Nová verze aplikace:** po sloučení do `main` ji GitHub Pages do minuty zveřejní. Aplikace se na ni ptá při spuštění, při návratu do aplikace (nejvýš jednou za 10 minut) a při stažení dolů; nová verze se stáhne na pozadí a nabídne se „Je k dispozici nová verze“. Ručně: **Můj účet → Aktualizovat** (stáhne a načte bez zavírání aplikace). Číslo verze je v `js/version.js` a v `sw.js` (`CACHE`) – zvyšují se spolu. Soubory nové verze service worker stahuje přímo z webu (mimo mezipaměť prohlížeče a GitHubu) a až do další verze je vydává jen z paměti telefonu; bez zvýšení čísla se tedy změna k uživatelům nedostane. Skripty a styly načítá `index.html` s razítkem v adrese (`?r=…`), které se mění při znovunačtení po aktualizaci (`reloadApp`) – iPhone by jinak v běžící aplikaci spustil znovu staré skripty ze své paměti. Nový modul je proto potřeba přidat do seznamu v `index.html` i do `SHELL` v `sw.js`.
- **Obnovení stažením dolů:** na začátku stránky stáhnout prstem dolů – odešlou se čekající závady, stáhne se vše znovu a zkontroluje se nová verze aplikace.
- **Upozornění na nového uživatele:** po registraci přijde administrátorům „Nový uživatel čeká na schválení“, klepnutí otevře Správu uživatelů.
- **Základní heslo 123456** (`DEFAULT_PASSWORD` v `js/model.js`): předvyplněné při registraci i při založení účtu administrátorem, jde přepsat. Změna hesla je nepovinná: po prvním přihlášení se základním heslem se jednou nabídne, v Můj účet → **Změnit heslo** ji má každý (příznak `temp_password` v user_metadata).
- **Účet založený administrátorem:** Správa uživatelů → **Založit účet** (jméno, e-mail, role, heslo). Účet je hned potvrzený i schválený, přihlašovací údaje se pošlou tlačítkem WhatsApp (Edge Function `create-user`).
- **Oprávnění** hlídá přímo databáze:

| Role | Co smí |
|---|---|
| Čeká na schválení | nic, jen vidí, že čeká (takto lze účet i zablokovat) |
| Vozmistr | zakládá vozy a závady, komentuje, **svoje** závady upravuje, maže a označuje jako opravené |
| Správce | navíc označuje jako opravené (zeleně) i **cizí** závady a vrací je zpět |
| Administrátor | vše, včetně úprav a mazání cizích závad, změny skupiny vozu, mazání vozů a schvalování uživatelů |

První registrovaný uživatel se automaticky stane administrátorem. Další čekají na jeho schválení (Můj účet → Správa uživatelů).

## Vyzkoušení (ukázkový režim)

Dokud v `js/config.js` není vyplněné Supabase, aplikace běží v **ukázkovém režimu** s vymyšlenými daty uloženými jen v prohlížeči. Ukázkový režim se dá kdykoli zapnout i přidáním `?demo` k adrese (např. `…/zavady-vozu/?demo`), na ostrá data to nesahá. Spuštění:

```bash
python3 -m http.server 8765
```

Pak otevřete <http://localhost:8765>. Na přihlašovací obrazovce lze vybrat roli (administrátor, správce, vozmistr, čekající). Pokud otevřete aplikaci ve dvou kartách jako dva různí uživatelé, uvidíte i upozornění na novou závadu.

## Ostrý provoz: krok za krokem

Data se ukládají v [Supabase](https://supabase.com): databázi, přihlašování, úložišti fotek a živých změnách. Pro začátek stačí bezplatný tarif.

1. **Založte projekt** na supabase.com: New project, region **Central EU (Frankfurt)**, aby data zůstala v EU.
2. **Vytvořte databázi:** SQL Editor → New query → vložte celý obsah `supabase/schema.sql` → **Run**.
3. **Propojte aplikaci:** Project Settings → API zkopírujte *Project URL* a *anon public* klíč do `js/config.js`. Anon klíč je veřejný a smí být v aplikaci, data chrání pravidla v databázi.
4. **Zveřejněte aplikaci** na adrese s HTTPS (bez HTTPS nejde instalace ani upozornění). Zdarma to jde třeba přes Netlify (přetáhnout složku na app.netlify.com/drop), Cloudflare Pages nebo GitHub Pages. Nahrává se celá složka, nic se nesestavuje.
5. **Nastavte adresu v Supabase:** Authentication → URL Configuration → *Site URL* = adresa aplikace. Odkazy v e-mailech (potvrzení účtu, zapomenuté heslo) pak vedou správně.
6. **Zaregistrujte se jako první.** Stanete se administrátorem.

### Push upozornění na telefon

1. Otevřete `tools/vapid.html` na adrese aplikace (nebo lokálně <http://localhost:8765/tools/vapid.html>) → **Vygenerovat klíče**.
2. Veřejný klíč vložte do `js/config.js` (`VAPID_PUBLIC_KEY`).
3. V Supabase: Edge Functions → Secrets → přidejte `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` a `VAPID_SUBJECT` (`mailto:` + váš e-mail).
4. Edge Functions → Deploy a new function → Via Editor → název **`notify-new-defect`** → vložte obsah `supabase/functions/notify-new-defect/index.ts` → Deploy. V nastavení funkce vypněte kontrolu JWT (funkce si přihlášení ověřuje sama).
5. Stejně nasaďte funkci pro zakládání účtů administrátorem (obsah `supabase/functions/create-user/index.ts`, kontrola JWT vypnutá). V tomto projektu běží pod názvem **`clever-task`** – při jiném názvu upravte `createUser` v `js/api/supabase.js`.
6. Po přihlášení aplikace na úvodní obrazovce sama nabídne **Zapnout** (karta `PushOffer` v `js/ui.js`); po povolení hned přijde zkušební upozornění. Odmítnutou nabídku jde dohnat v Můj účet → **Zapnout upozornění**. Když telefon upozornění už dřív povolil (nové přihlášení, přeinstalace), zapnou se samy bez ptaní – kromě ručně vypnutých v Můj účet. Na iPhonu v Safari upozornění nejdou – tam místo toho radí karta **Aplikace na plochu**.

## Instalace na Android

Návod pro kolegy pro Android i iPhone (stránka s QR kódem): <https://zikmundmartin7-lab.github.io/zavady-vozu/navod.html>. Odkaz je i na přihlašovací obrazovce. Na Androidu návod pozná, že je otevřený mimo Chrome (WhatsApp, Messenger, Samsung Internet…), a nabídne tlačítko **Otevřít v Chrome** (odkaz `intent://`); v Chrome rovnou ukáže **Instalovat aplikaci**. Na Androidu je nad kroky i **videonávod** (45 s, bez zvuku: odkaz ve WhatsAppu → Chrome → instalace → registrace → upozornění) – `video/navod-android.mp4` s náhledem `video/navod-android.jpg`. Service worker videa neukládá (přehrávají se po částech přímo ze sítě). Nové video: převést na H.264 bez zvuku s `-movflags +faststart` a v `navod.html` zvýšit `?v=` u videa i náhledu.

**iPhone / iPad (iOS 16.4+):** Safari → Sdílet → Přidat na plochu. Upozornění fungují jen v aplikaci spuštěné z ikony na ploše.

1. Otevřete adresu aplikace v **Chrome**.
2. Menu ⋮ → **Přidat na plochu** (nebo **Instalovat aplikaci**).
3. Aplikace se pak spouští z ikony, bez lišty prohlížeče, a umí přijímat upozornění.

Později lze ze stejné aplikace vytvořit i instalační soubor APK nebo ji dát na Google Play (např. přes [PWABuilder](https://www.pwabuilder.com)). Kód se přitom nemění.

## Historie, koš, exporty a zálohy

- **Historie změn:** každá změna závady, vozu, fotky, komentáře, předpisu i role uživatele se zapisuje do tabulky `audit_log` (kdo, kdy, co bylo předtím a potom). U závady: **Historie změn**, pro administrátora celkový přehled v **Můj účet → Historie změn**.
- **Koš:** smazané záznamy zůstávají navždy v historii a administrátor je obnoví v **Můj účet → Koš** (obnoví se celá akce, např. vůz i se závadami). Soubory se při mazání neodstraňují.
- **Zamčení:** opravenou závadu může měnit nebo smazat jen administrátor; ostatní ji nejdřív musí vrátit mezi neopravené. Komentovat jde dál.
- **Přehled a export:** záložka **Přehled** (všechny závady s filtry, i více skupin najednou) a tlačítko **Export do Excelu**. V Excelu je list se všemi závadami a k tomu list pro každou skupinu. Pravidelný export na e-mail jde omezit na vybrané skupiny.
- **Zápis bez signálu:** závada uložená bez připojení čeká v telefonu a odešle se sama.
- **Server** (`server/`, běží na stejném serveru jako chatbot): každou noc ve 2:30 záloha databáze (`pg_dump`) a všech souborů do `/var/backups/zavady`, každou hodinu rozeslání pravidelných exportů (nastavuje administrátor v **Můj účet → Pravidelné exporty**). E-maily jdou přes Gmail (heslo pro aplikace). Nahrání: vyplnit `server/.env` podle `server/.env.example` a spustit `server/deploy.sh root@2.31.44.49`.

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
js/version.js                             číslo verze aplikace (zvyšuje se spolu s CACHE v sw.js)
js/api/supabase.js | demo.js              ostrá data | ukázková data v prohlížeči
js/ui.js, js/views/*.js                   obrazovky (Preact + htm, bez sestavování)
supabase/schema.sql                       tabulky, oprávnění (RLS), úložiště
supabase/functions/notify-new-defect/     rozesílání push upozornění
supabase/functions/create-user/           administrátor zakládá účty s heslem (bez potvrzovacího e-mailu)
supabase/oprava_*.sql, migrace_*.sql      jednorázové opravy a úpravy databáze
server/                                   noční zálohy a pravidelné exporty na e-mail (služba na serveru)
tools/katalog_vsp9.py                     převod katalogu závad z PDF přílohy 9 VSP (výstup do private/, mimo GitHub)
navod.html                                návod k instalaci, Android i iPhone (QR: tools/qr.py)
tools/ikony.py, tools/vapid.html          ikony aplikace, generátor klíčů
.github/workflows/keep-alive.yml          udržení projektu Supabase vzhůru
```
