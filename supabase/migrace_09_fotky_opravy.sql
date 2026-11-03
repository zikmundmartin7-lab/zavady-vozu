-- Závady vozů – úprava databáze: fotky a videa k opravě závady
-- • přílohy mají nový sloupec repair: true = fotka/video z opravy (ukazuje se u „Opraveno …“), jinak příloha závady
-- • funkce resolve_defect: označí závadu jako opravenou i s poznámkou a přílohami opravy najednou
--   (buď se uloží všechno, nebo nic); soubory nahrává aplikace do úložiště předem
-- • fotky k opravě přidá jen ten, kdo závadu označil jako opravenou (a administrátor)
-- • vrácení závady mezi neopravené smaže i fotky k opravě (jako poznámku k opravě; jdou do koše)
-- Data se nemažou. Skript lze bezpečně spustit i opakovaně.
--
-- DŮLEŽITÉ: spouštějte, když nikdo nemá aplikaci otevřenou (zavřete ji i v telefonu).
-- Pokud ji někdo používá, skript po 10 s skončí chybou „lock timeout“ nebo „deadlock“ a nic nezmění –
-- pak ho spusťte znovu.

-- Pojistka: pokud se skript při kopírování poškodil (rozsypaná diakritika), nic se neprovede.
do $$ begin
  if 'č' <> U&'\010D' or 'š' <> U&'\0161' or 'á' <> U&'\00E1' or 'ř' <> U&'\0159' then
    raise exception 'SKRIPT JE POSKOZENY: diakritika se pri kopirovani rozsypala. Zkopirujte ho znovu.';
  end if;
end $$;

set lock_timeout = '10s';

-- Zamknout předem (přílohy kvůli novému sloupci, závady kvůli novému triggeru)
lock table public.attachments in access exclusive mode;
lock table public.defects in share row exclusive mode;

-- 1) Příloha opravy. Bez „not null“: obnova z koše (restore_deleted) vkládá i záznamy smazané před tímto
--    skriptem, které sloupec nemají → null = příloha závady.
alter table public.attachments add column if not exists repair boolean default false;

-- 2) Přidání příloh: autor neopravené závady (jako dosud), administrátor, a nově fotky k opravě ten,
--    kdo závadu označil jako opravenou
do $$
declare p record;
begin
  for p in select policyname from pg_policies
           where schemaname = 'public' and tablename = 'attachments' and cmd = 'INSERT'
  loop
    execute format('drop policy %I on public.attachments', p.policyname);
  end loop;
end $$;
create policy "přílohy: přidání autor závady, kdo ji opravil, nebo správce" on public.attachments
  for insert to authenticated with check (
    public.is_member() and created_by = auth.uid() and exists (
      select 1 from public.defects d
      where d.id = defect_id and (public.is_admin()
        or (d.created_by = auth.uid() and d.resolved_at is null)
        or (repair and d.resolved_at is not null and d.resolved_by = auth.uid()))));

-- 3) Označit jako opravené i s přílohami opravy. Práva hlídá jako dosud pravidlo „závady: úprava“ a trigger
--    protect_defect (funkce běží s právy přihlášeného uživatele).
create or replace function public.resolve_defect(p_defect uuid, p_note text, p_files jsonb default '[]')
returns void
language plpgsql set search_path = '' as $$
declare
  v_resolved timestamptz;
begin
  select d.resolved_at into v_resolved from public.defects d where d.id = p_defect;
  if not found then
    raise exception 'Závada neexistuje (možná byla smazána).';
  end if;
  if v_resolved is not null then
    raise exception 'Závada už je označená jako opravená.';
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_files, '[]'::jsonb)) f
             where (f ->> 'path') not like p_defect::text || '/%'
                or (f ->> 'kind') is null or (f ->> 'kind') not in ('image', 'video')) then
    raise exception 'Neplatná příloha opravy.';
  end if;
  update public.defects set resolved_at = now(), resolution_note = nullif(btrim(p_note), '')
  where id = p_defect and resolved_at is null;
  if not found then
    raise exception 'Závadu může označit jako opravenou jen její autor, správce nebo administrátor.';
  end if;
  -- clock_timestamp: každá příloha vlastní čas, ať zůstane pořadí, v jakém je vozmistr přidal
  insert into public.attachments (defect_id, path, kind, repair, created_at)
  select p_defect, t.f ->> 'path', t.f ->> 'kind', true, clock_timestamp()
  from jsonb_array_elements(coalesce(p_files, '[]'::jsonb)) with ordinality as t(f, n)
  order by t.n;
end $$;
revoke execute on function public.resolve_defect(uuid, text, jsonb) from public, anon;
grant execute on function public.resolve_defect(uuid, text, jsonb) to authenticated;

-- 4) Vrácení mezi neopravené: smazat i přílohy opravy (záznam jde do historie a koše)
create or replace function public.drop_repair_attachments() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.attachments a where a.defect_id = new.id and a.repair;
  return null;
end $$;
drop trigger if exists defects_reopen on public.defects;
create trigger defects_reopen after update of resolved_at on public.defects
  for each row when (old.resolved_at is not null and new.resolved_at is null)
  execute function public.drop_repair_attachments();

reset lock_timeout;
notify pgrst, 'reload schema';

-- Kontrola: v Results musí být jeden řádek a ve všech sloupcích true
select exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'attachments' and column_name = 'repair') as sloupec_repair,
       to_regprocedure('public.resolve_defect(uuid, text, jsonb)') is not null as funkce_oprava,
       exists (select 1 from pg_trigger where tgname = 'defects_reopen' and not tgisinternal) as vraceni_maze_fotky,
       exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'attachments'
               and cmd = 'INSERT' and with_check like '%repair%') as pravidlo_pridani;
