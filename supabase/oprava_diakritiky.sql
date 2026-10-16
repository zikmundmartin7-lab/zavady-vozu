-- Závady vozů – oprava diakritiky
-- Při prvním spuštění schema.sql se kvůli chybnému kopírování poškodila čeština v názvech skupin,
-- v chybových hláškách a v názvech pravidel přístupu. Tento skript je opraví.
-- Data (uživatelé, vozy, závady, fotky, komentáře) se NEMĚNÍ. Lze ho spustit i opakovaně.
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

-- 3) Pravidla přístupu: odstranit staré (s poškozenými názvy) a vytvořit znovu – vše v jedné transakci
do $$
declare p record;
begin
  for p in
    select policyname, schemaname, tablename from pg_policies
    where (schemaname = 'public' and tablename in
            ('profiles', 'wagon_groups', 'wagons', 'defects', 'attachments', 'comments', 'push_subscriptions'))
       or (schemaname = 'storage' and tablename = 'objects'
           and (coalesce(qual, '') like '%attachments%' or coalesce(with_check, '') like '%attachments%'))
  loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

create policy "profil: vlastní nebo člen vidí" on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_member());
create policy "profil: úprava vlastního nebo správce" on public.profiles
  for update to authenticated using (id = auth.uid() or public.is_admin());
create policy "skupiny: čtení" on public.wagon_groups
  for select to authenticated using (public.is_member());
create policy "vozy: čtení" on public.wagons
  for select to authenticated using (public.is_member());
create policy "vozy: přidání" on public.wagons
  for insert to authenticated with check (public.is_member() and created_by = auth.uid());
create policy "vozy: úprava správce" on public.wagons
  for update to authenticated using (public.is_admin());
create policy "vozy: mazání správce" on public.wagons
  for delete to authenticated using (public.is_admin());
create policy "závady: čtení" on public.defects
  for select to authenticated using (public.is_member());
create policy "závady: přidání" on public.defects
  for insert to authenticated with check (
    public.is_member() and created_by = auth.uid()
    and resolved_at is null and resolved_by is null);
create policy "závady: úprava" on public.defects
  for update to authenticated
  using (public.is_member() and (created_by = auth.uid() or public.can_resolve()));
create policy "závady: mazání autor nebo správce" on public.defects
  for delete to authenticated using (created_by = auth.uid() or public.is_admin());
create policy "přílohy: čtení" on public.attachments
  for select to authenticated using (public.is_member());
create policy "přílohy: přidání autor závady nebo správce" on public.attachments
  for insert to authenticated with check (
    public.is_member() and created_by = auth.uid() and exists (
      select 1 from public.defects d
      where d.id = defect_id and (d.created_by = auth.uid() or public.is_admin())));
create policy "přílohy: mazání autor závady nebo správce" on public.attachments
  for delete to authenticated using (
    public.is_admin() or exists (
      select 1 from public.defects d where d.id = defect_id and d.created_by = auth.uid()));
create policy "komentáře: čtení" on public.comments
  for select to authenticated using (public.is_member());
create policy "komentáře: přidání" on public.comments
  for insert to authenticated with check (public.is_member() and author_id = auth.uid());
create policy "komentáře: mazání autor nebo správce" on public.comments
  for delete to authenticated using (author_id = auth.uid() or public.is_admin());
create policy "push: vlastní odběry" on public.push_subscriptions
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "soubory: čtení členové" on storage.objects
  for select to authenticated using (bucket_id = 'attachments' and public.is_member());
create policy "soubory: nahrání členové" on storage.objects
  for insert to authenticated with check (bucket_id = 'attachments' and public.is_member());
create policy "soubory: mazání vlastník nebo správce" on storage.objects
  for delete to authenticated using (
    bucket_id = 'attachments' and (owner = auth.uid() or public.is_admin()));

-- 4) Kontrola: v Results musí být správně „Plošiňáky/Res/Smmp“ a „Ostatní“
select id, name from public.wagon_groups order by sort;
