-- Závady vozů – úprava databáze: nové závady pro každého uživatele, export podle skupin vozů
-- • u každého uživatele se pamatuje, kdy naposledy otevřel který vůz (tabulka wagon_seen)
-- • u skupin a vozů je navíc počet nových závad (new_count): neopravené závady od ostatních
--   vložené od chvíle, kdy uživatel vůz naposledy otevřel
-- • závady vložené před spuštěním tohoto skriptu se počítají jako prohlédnuté (u nových uživatelů
--   všechno, co bylo vloženo před jejich registrací)
-- • pravidelný export na e-mail může obsahovat jen vybrané skupiny vozů (export_schedules.group_ids)
-- Data se nemažou. Skript lze bezpečně spustit i opakovaně.
--
-- DŮLEŽITÉ: spouštějte, když nikdo nemá aplikaci otevřenou (zavřete ji i v telefonu).
-- Pokud ji někdo používá, skript po 10 s skončí chybou „lock timeout“ nebo „deadlock“ a nic nezmění –
-- pak ho spusťte znovu.

-- Pojistka: pokud se skript při kopírování poškodil (rozsypaná diakritika), nic se neprovede.
do $$ begin
  if 'č' <> U&'\010D' then
    raise exception 'SKRIPT JE POSKOZENY: diakritika se pri kopirovani rozsypala. Zkopirujte ho znovu z GitHubu (tlacitko Copy raw file).';
  end if;
end $$;

set lock_timeout = '10s';

-- Všechno, co se mění, zamknout hned na začátku (pevné pořadí → žádný deadlock)
lock table public.profiles, public.export_schedules, public.group_overview, public.wagon_overview
  in access exclusive mode;

-- 1) Od kdy se uživateli počítají nové závady (stávajícím od teď, novým od registrace)
alter table public.profiles add column if not exists news_since timestamptz not null default now();

-- 2) Kdy uživatel naposledy otevřel který vůz
create table if not exists public.wagon_seen (
  user_id   uuid not null references public.profiles on delete cascade default auth.uid(),
  wagon_id  uuid not null references public.wagons on delete cascade,
  seen_at   timestamptz not null default now(),
  primary key (user_id, wagon_id)
);
alter table public.wagon_seen enable row level security;
drop policy if exists "prohlédnuté vozy: jen vlastní" on public.wagon_seen;
create policy "prohlédnuté vozy: jen vlastní" on public.wagon_seen
  for select to authenticated using (user_id = (select auth.uid()));

-- Otevření vozu: zapíše „prohlédnuto teď“ a vrátí předchozí čas (aplikace podle něj označí nové závady)
create or replace function public.mark_wagon_seen(p_wagon uuid) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare
  prev timestamptz;
begin
  if not public.is_member() then
    raise exception 'Nemáte oprávnění.';
  end if;
  select coalesce(
           (select s.seen_at from public.wagon_seen s where s.user_id = auth.uid() and s.wagon_id = p_wagon),
           (select p.news_since from public.profiles p where p.id = auth.uid()))
    into prev;
  insert into public.wagon_seen (user_id, wagon_id, seen_at) values (auth.uid(), p_wagon, now())
    on conflict (user_id, wagon_id) do update set seen_at = excluded.seen_at;
  return prev;
end $$;
revoke execute on function public.mark_wagon_seen(uuid) from public, anon;
grant execute on function public.mark_wagon_seen(uuid) to authenticated;

-- 3) Počty nových závad u skupin a vozů (nový sloupec new_count na konci, ostatní beze změny)
create or replace view public.group_overview with (security_invoker = true) as
select g.id, g.name, g.sort,
       count(d.id) filter (where d.resolved_at is null) as open_count,
       count(d.id) filter (where d.resolved_at is null
                             and d.created_by is distinct from me.id
                             and d.created_at > coalesce(ws.seen_at, me.news_since)) as new_count
from public.wagon_groups g
left join public.wagons w on w.group_id = g.id
left join public.defects d on d.wagon_id = w.id
left join public.wagon_seen ws on ws.wagon_id = w.id and ws.user_id = (select auth.uid())
left join public.profiles me on me.id = (select auth.uid())
group by g.id;

create or replace view public.wagon_overview with (security_invoker = true) as
select w.id, w.number, w.last4, w.group_id, w.note, w.created_at,
       g.name as group_name,
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
group by w.id, g.name;

-- 4) Pravidelný export jen pro vybrané skupiny vozů (prázdné = všechny skupiny)
alter table public.export_schedules add column if not exists group_ids smallint[];

reset lock_timeout;
notify pgrst, 'reload schema';

-- Kontrola: 4 nové sloupce a tabulka wagon_seen
select (select count(*) from information_schema.columns
         where table_schema = 'public'
           and ((table_name = 'profiles' and column_name = 'news_since')
             or (table_name = 'export_schedules' and column_name = 'group_ids')
             or (table_name in ('group_overview', 'wagon_overview') and column_name = 'new_count'))) as nove_sloupce,
       to_regclass('public.wagon_seen') is not null as tabulka_prohlednuti;
