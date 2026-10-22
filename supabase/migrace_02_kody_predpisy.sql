-- Závady vozů – úprava databáze: kód závady dle přílohy 9 VSP, katalog kódů, předpisy
-- • u závady přibude nepovinný „kód závady“ (až 4 úrovně, např. 1.2.2.1), upravit ho smí autor nebo správce
-- • závažnost (žlutá/oranžová/červená) už není povinná – aplikace ji nepoužívá, stará data zůstanou
-- • tabulka katalogu kódů (plní se zvlášť) a předpisy v soukromém úložišti (vidí jen schválení uživatelé)
-- Data se nemažou. Skript lze bezpečně spustit i opakovaně.
--
-- DŮLEŽITÉ: spouštějte, když nikdo nemá aplikaci otevřenou (zavřete ji i v telefonu).
-- Pokud ji někdo používá, skript po 10 s skončí chybou „lock timeout“ a nic nezmění – pak ho spusťte znovu.

-- Pojistka: pokud se skript při kopírování poškodil (rozsypaná diakritika), nic se neprovede.
do $$ begin
  if 'č' <> U&'\010D' then
    raise exception 'SKRIPT JE POSKOZENY: diakritika se pri kopirovani rozsypala. Zkopirujte ho znovu z GitHubu (tlacitko Copy raw file).';
  end if;
end $$;

set lock_timeout = '10s';

-- 1) Úložiště pro předpisy (jako první, aby se nezaseklo o právě načítanou fotku)
-- Předpisy: soukromý bucket jen pro PDF; číst smí schválení uživatelé, nahrávat a mazat správce.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('predpisy', 'predpisy', false, 52428800, array['application/pdf'])
on conflict (id) do nothing;

drop policy if exists "předpisy: čtení členové" on storage.objects;
create policy "předpisy: čtení členové" on storage.objects
  for select to authenticated using (bucket_id = 'predpisy' and public.is_member());
drop policy if exists "předpisy: nahrání správce" on storage.objects;
create policy "předpisy: nahrání správce" on storage.objects
  for insert to authenticated with check (bucket_id = 'predpisy' and public.is_admin());
drop policy if exists "předpisy: mazání správce" on storage.objects;
create policy "předpisy: mazání správce" on storage.objects
  for delete to authenticated using (bucket_id = 'predpisy' and public.is_admin());

-- 2) Katalog kódů a předpisy
-- Katalog závad a poškození (Dodatek 1 přílohy 9 VSP). Plní se zvlášť skriptem z tools/katalog_vsp9.py,
-- text katalogu není veřejný – vidí ho jen přihlášení a schválení uživatelé.
create table if not exists public.defect_codes (
  kod        text primary key,
  poradi     integer not null,
  cast_vozu  text,          -- konstrukční část (vlastní název u kódu)
  cesta      text,          -- konstrukční část včetně nadřazených, např. „Pojezd › Nalisované obruče kol“
  kontext    text,          -- nadpis z nadřazeného kódu, když je u kódu jen kritérium
  popis      text,          -- závady a poškození / kritéria / upozornění
  poznamka   text,
  opatreni   text,
  trida      text,          -- třída závady
  strana     smallint       -- strana v PDF přílohy 9
);

-- Předpisy (PDF v soukromém úložišti „predpisy“)
create table if not exists public.regulations (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (length(trim(title)) > 0),
  path        text not null unique,
  size_bytes  bigint,
  created_by  uuid references public.profiles on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);

alter table public.defect_codes enable row level security;
alter table public.regulations  enable row level security;

drop policy if exists "kódy závad: čtení" on public.defect_codes;
create policy "kódy závad: čtení" on public.defect_codes
  for select to authenticated using (public.is_member());

drop policy if exists "předpisy: čtení" on public.regulations;
create policy "předpisy: čtení" on public.regulations
  for select to authenticated using (public.is_member());
drop policy if exists "předpisy: přidání správce" on public.regulations;
create policy "předpisy: přidání správce" on public.regulations
  for insert to authenticated with check (public.is_admin());
drop policy if exists "předpisy: úprava správce" on public.regulations;
create policy "předpisy: úprava správce" on public.regulations
  for update to authenticated using (public.is_admin());
drop policy if exists "předpisy: mazání správce" on public.regulations;
create policy "předpisy: mazání správce" on public.regulations
  for delete to authenticated using (public.is_admin());

-- 3) Závady: kód závady, závažnost už nepovinná (nejdřív zamknout přehled, pak tabulku – žádný deadlock)
lock table public.defect_feed, public.defects in access exclusive mode;

alter table public.defects alter column severity drop not null;
alter table public.defects add column if not exists defect_code text
  check (defect_code ~ '^[0-9]{1,2}([.][0-9]{1,2}){0,3}$');

create or replace function public.protect_defect() returns trigger
language plpgsql as $$
declare
  content_changed boolean;
  resolution_changed boolean;
begin
  content_changed := new.description is distinct from old.description
                     or new.severity is distinct from old.severity
                     or new.defect_code is distinct from old.defect_code
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

create or replace view public.defect_feed with (security_invoker = true) as
select d.id, d.wagon_id, d.severity, d.description, d.created_by, d.created_at, d.updated_at,
       d.resolved_at, d.resolved_by, d.resolution_note,
       pc.full_name as created_by_name,
       pr.full_name as resolved_by_name,
       (select count(*) from public.comments c where c.defect_id = d.id) as comment_count,
       d.found_at,
       d.defect_code
from public.defects d
left join public.profiles pc on pc.id = d.created_by
left join public.profiles pr on pr.id = d.resolved_by;

reset lock_timeout;
