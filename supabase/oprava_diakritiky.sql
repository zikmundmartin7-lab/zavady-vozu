-- Závady vozů – oprava diakritiky
-- Při prvním spuštění schema.sql se kvůli chybnému kopírování poškodila čeština v názvech skupin
-- a v chybových hláškách. Tento skript je opraví. Nemění strukturu tabulek ani pravidla přístupu,
-- takže nemůže narazit na aplikaci, která zrovna běží.
-- Data (uživatelé, vozy, závady, fotky, komentáře) se NEMĚNÍ. Lze ho spustit i opakovaně.
-- Názvy pravidel přístupu (jen kosmetika v Supabase) opravuje oprava_nazvu_pravidel.sql.
-- Spuštění: Supabase → SQL Editor → New query → vložit → Run.

-- Pojistka: pokud se skript při kopírování poškodil (rozsypaná diakritika), nic se neprovede.
do $$ begin
  if 'č' <> U&'\010D' then
    raise exception 'SKRIPT JE POSKOZENY: diakritika se pri kopirovani rozsypala. Zkopirujte ho znovu z GitHubu (tlacitko Copy raw file).';
  end if;
end $$;

-- 1) Názvy skupin
update public.wagon_groups g set name = v.name, sort = v.sort
from (values
  (1, 'Chopry', 1),
  (2, 'SA', 2),
  (3, 'UA', 3),
  (4, 'Vapy/Fals', 4),
  (5, 'Trakce/Zetky', 5),
  (6, 'Plošiňáky/Res/Smmp', 6),
  (7, 'Ostatní', 7)
) as v(id, name, sort)
where g.id = v.id;

-- 2) Funkce s chybovými hláškami
create or replace function public.protect_profile() returns trigger
language plpgsql as $$
begin
  if new.role is distinct from old.role and not public.is_admin() then
    raise exception 'Roli může změnit jen správce.';
  end if;
  if new.id = auth.uid() and old.role = 'admin' and new.role <> 'admin' then
    raise exception 'Správce si nemůže odebrat vlastní roli.';
  end if;
  new.email := old.email;
  return new;
end $$;

create or replace function public.protect_defect() returns trigger
language plpgsql as $$
declare
  content_changed boolean;
  resolution_changed boolean;
begin
  content_changed := new.description is distinct from old.description
                     or new.severity is distinct from old.severity;
  resolution_changed := new.resolved_at is distinct from old.resolved_at
                        or new.resolution_note is distinct from old.resolution_note;
  if content_changed and not (old.created_by = auth.uid() or public.is_admin()) then
    raise exception 'Závadu může upravit jen ten, kdo ji vložil, nebo správce.';
  end if;
  if resolution_changed then
    if not (public.can_resolve() or old.created_by = auth.uid()) then
      raise exception 'Závadu může označit jako opravenou jen její autor, opravář nebo správce.';
    end if;
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

-- 3) Kontrola: v Results musí být správně „Plošiňáky/Res/Smmp“ a „Ostatní“
select id, name from public.wagon_groups order by sort;
