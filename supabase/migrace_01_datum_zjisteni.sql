-- Závady vozů – úprava databáze: datum a čas zjištění závady
-- Přidá k závadám „datum zjištění“ (lze zadat i zpětně). Stávajícím závadám se nastaví na čas jejich vložení.
-- Kdo smí datum měnit a jaké má mít hodnoty, hlídají pravidla níže (stejně jako v schema.sql).
-- Data se nemažou. Skript lze bezpečně spustit i opakovaně.
--
-- DŮLEŽITÉ: spouštějte, když nikdo nemá aplikaci otevřenou (zavřete ji i v telefonu).
-- Pokud ji někdo používá, skript po 10 s skončí chybou „lock timeout“ a nic nezmění – pak ho spusťte znovu.
-- Spuštění: Supabase → SQL Editor → New query → vložit → Run.

-- Pojistka: pokud se skript při kopírování poškodil (rozsypaná diakritika), nic se neprovede.
do $$ begin
  if 'č' <> U&'\010D' then
    raise exception 'SKRIPT JE POSKOZENY: diakritika se pri kopirovani rozsypala. Zkopirujte ho znovu z GitHubu (tlacitko Copy raw file).';
  end if;
end $$;

set lock_timeout = '10s';

-- Zamknout nejdřív přehled závad, pak tabulky (stejné pořadí jako čtení z aplikace → žádný deadlock)
lock table public.defect_feed, public.defects in access exclusive mode;

-- 1) Nový sloupec; stávající závady dostanou datum zjištění = čas vložení
alter table public.defects add column if not exists found_at timestamptz;
update public.defects set found_at = created_at where found_at is null;
alter table public.defects
  alter column found_at set default now(),
  alter column found_at set not null;

-- 2) Pravidla: kdo smí datum měnit a jaké může mít hodnoty
create or replace function public.prepare_defect() returns trigger
language plpgsql as $$
begin
  new.created_at := now();
  new.found_at := coalesce(new.found_at, now());
  if new.found_at > now() + interval '5 minutes' then
    raise exception 'Datum zjištění nemůže být v budoucnosti.';
  end if;
  return new;
end $$;

drop trigger if exists defects_prepare on public.defects;
create trigger defects_prepare
  before insert on public.defects
  for each row execute function public.prepare_defect();

create or replace function public.protect_defect() returns trigger
language plpgsql as $$
declare
  content_changed boolean;
  resolution_changed boolean;
begin
  content_changed := new.description is distinct from old.description
                     or new.severity is distinct from old.severity
                     or new.found_at is distinct from old.found_at;
  resolution_changed := new.resolved_at is distinct from old.resolved_at
                        or new.resolution_note is distinct from old.resolution_note;
  if content_changed and not (old.created_by = auth.uid() or public.is_admin()) then
    raise exception 'Závadu může upravit jen ten, kdo ji vložil, nebo správce.';
  end if;
  if new.found_at is distinct from old.found_at then
    if new.found_at > now() + interval '5 minutes' then
      raise exception 'Datum zjištění nemůže být v budoucnosti.';
    end if;
    if old.resolved_at is not null and new.found_at > old.resolved_at then
      raise exception 'Datum zjištění nemůže být pozdější než oprava závady.';
    end if;
  end if;
  if resolution_changed then
    if not (public.can_resolve() or old.created_by = auth.uid()) then
      raise exception 'Závadu může označit jako opravenou jen její autor, opravář nebo správce.';
    end if;
    if old.resolved_at is null and new.resolved_at is not null then new.resolved_at := now(); end if;
    new.resolved_by := case when new.resolved_at is null then null else auth.uid() end;
    if new.resolved_at is null then new.resolution_note := null; end if;
  else
    new.resolved_by := old.resolved_by;
  end if;
  if content_changed then new.updated_at := now(); end if;
  new.wagon_id   := old.wagon_id;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  return new;
end $$;

drop trigger if exists defects_protect on public.defects;
create trigger defects_protect
  before update on public.defects
  for each row execute function public.protect_defect();

-- 3) Přehled závad pro aplikaci – nový sloupec na konec
create or replace view public.defect_feed with (security_invoker = true) as
select d.id, d.wagon_id, d.severity, d.description, d.created_by, d.created_at, d.updated_at,
       d.resolved_at, d.resolved_by, d.resolution_note,
       pc.full_name as created_by_name,
       pr.full_name as resolved_by_name,
       (select count(*) from public.comments c where c.defect_id = d.id) as comment_count,
       d.found_at
from public.defects d
left join public.profiles pc on pc.id = d.created_by
left join public.profiles pr on pr.id = d.resolved_by;

reset lock_timeout;

-- Kontrola: obě čísla musí být stejná
select count(*) as zavad_celkem, count(found_at) as s_datem_zjisteni from public.defects;
