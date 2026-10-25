-- Závady vozů – úprava databáze: odborné a slangové názvy skupin vozů
-- • skupina má odborný název (řady vozů, např. Faccpp) a vedle něj slangový (např. Choper)
-- • aplikace ukazuje odborný název nahoře a slangový pod ním; kde je místo jen na jeden řádek
--   (upozornění, export, sdílení do WhatsAppu), píšou se oba za sebou: „Faccpp – Choper“
-- Data se nemažou, vozy zůstávají ve svých skupinách. Skript lze bezpečně spustit i opakovaně.
--
-- DŮLEŽITÉ: spouštějte, když nikdo nemá aplikaci otevřenou (zavřete ji i v telefonu).
-- Pokud ji někdo používá, skript po 10 s skončí chybou „lock timeout“ nebo „deadlock“ a nic nezmění –
-- pak ho spusťte znovu.

-- Pojistka: pokud se skript při kopírování poškodil (rozsypaná diakritika), nic se neprovede.
do $$ begin
  if 'č' <> U&'\010D' or 'š' <> U&'\0161' or '–' <> U&'\2013' then
    raise exception 'SKRIPT JE POSKOZENY: diakritika se pri kopirovani rozsypala. Zkopirujte ho znovu.';
  end if;
end $$;

set lock_timeout = '10s';

-- Všechno, co se mění, zamknout hned na začátku (pevné pořadí → žádný deadlock)
lock table public.wagon_groups, public.group_overview, public.wagon_overview
  in access exclusive mode;

-- 1) Slangový název vedle odborného (u UA a Ostatní není)
alter table public.wagon_groups add column if not exists slang text;

update public.wagon_groups as g set name = v.name, slang = v.slang
from (values
  (1, 'Faccpp',    'Choper'),
  (2, 'Faccs',     'Sa'),
  (3, 'Ua',        null),
  (4, 'Fals',      'Vap'),
  (5, 'Uk, Gbgs',  'Trakce'),
  (6, 'Res, Smmp', 'Plošinové')
) as v(id, name, slang)
where g.id = v.id;

-- 2) Přehled skupin: nový sloupec slang na konci, ostatní beze změny
create or replace view public.group_overview with (security_invoker = true) as
select g.id, g.name, g.sort,
       count(d.id) filter (where d.resolved_at is null) as open_count,
       count(d.id) filter (where d.resolved_at is null
                             and d.created_by is distinct from me.id
                             and d.created_at > coalesce(ws.seen_at, me.news_since)) as new_count,
       g.slang
from public.wagon_groups g
left join public.wagons w on w.group_id = g.id
left join public.defects d on d.wagon_id = w.id
left join public.wagon_seen ws on ws.wagon_id = w.id and ws.user_id = (select auth.uid())
left join public.profiles me on me.id = (select auth.uid())
group by g.id;

-- 3) Přehled vozů: group_name = oba názvy na jednom řádku („Faccpp – Choper“, u UA jen „Ua“)
create or replace view public.wagon_overview with (security_invoker = true) as
select w.id, w.number, w.last4, w.group_id, w.note, w.created_at,
       concat_ws(' – ', g.name, g.slang) as group_name,
       count(d.id) filter (where d.resolved_at is null)     as open_count,
       coalesce(max(d.severity) filter (where d.resolved_at is null), 0) as max_severity,
       count(d.id) filter (where d.resolved_at is not null) as resolved_count,
       max(d.created_at) as last_defect_at,
       count(d.id) filter (where d.resolved_at is null
                             and d.created_by is distinct from me.id
                             and d.created_at > coalesce(ws.seen_at, me.news_since)) as new_count
from public.wagons w
join public.wagon_groups g on g.id = w.group_id
left join public.defects d on d.wagon_id = w.id
left join public.wagon_seen ws on ws.wagon_id = w.id and ws.user_id = (select auth.uid())
left join public.profiles me on me.id = (select auth.uid())
group by w.id, g.id;

reset lock_timeout;
notify pgrst, 'reload schema';

-- Kontrola: v Results musí být 7 skupin, správně „Plošinové“ a „Faccpp – Choper“
select g.id, g.name, g.slang, concat_ws(' – ', g.name, g.slang) as na_jednom_radku
from public.wagon_groups g order by g.sort;
