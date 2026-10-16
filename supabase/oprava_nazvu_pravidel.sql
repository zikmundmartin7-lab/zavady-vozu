-- Závady vozů – oprava názvů pravidel přístupu (jen kosmetika)
-- Názvy pravidel (Authentication → Policies) mají po prvním spuštění schema.sql rozsypanou diakritiku.
-- Na funkci aplikace to nemá vliv. Tento skript pravidla odstraní a vytvoří znovu se stejným obsahem.
--
-- DŮLEŽITÉ: spouštějte, když nikdo nemá aplikaci otevřenou (zavřete ji i v telefonu).
-- Změna pravidel potřebuje tabulky na okamžik jen pro sebe. Pokud je někdo zrovna používá,
-- skript po 10 s skončí chybou „lock timeout“ a nic nezmění – pak ho stačí spustit znovu.
-- Vše běží jako jeden celek: při jakékoli chybě se nezmění nic.
-- Spuštění: Supabase → SQL Editor → New query → vložit → Run.

-- Pojistka: pokud se skript při kopírování poškodil (rozsypaná diakritika), nic se neprovede.
do $$ begin
  if 'č' <> U&'\010D' then
    raise exception 'SKRIPT JE POSKOZENY: diakritika se pri kopirovani rozsypala. Zkopirujte ho znovu z GitHubu (tlacitko Copy raw file).';
  end if;
end $$;

set lock_timeout = '10s';

-- 1) Úložiště fotek (zvlášť a jako první, aby se nezaseklo o právě načítanou fotku)
do $$
declare p record;
begin
  for p in
    select policyname from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and (coalesce(qual, '') like '%attachments%' or coalesce(with_check, '') like '%attachments%')
  loop
    execute format('drop policy %I on storage.objects', p.policyname);
  end loop;
end $$;

create policy "soubory: čtení členové" on storage.objects
  for select to authenticated using (bucket_id = 'attachments' and public.is_member());
create policy "soubory: nahrání členové" on storage.objects
  for insert to authenticated with check (bucket_id = 'attachments' and public.is_member());
create policy "soubory: mazání vlastník nebo správce" on storage.objects
  for delete to authenticated using (
    bucket_id = 'attachments' and (owner = auth.uid() or public.is_admin()));

-- 2) Tabulky aplikace: zamknout všechny najednou, profily až nakonec (čte je každé pravidlo)
lock table public.wagon_groups, public.wagons, public.defects, public.attachments,
           public.comments, public.push_subscriptions, public.profiles
  in access exclusive mode;

do $$
declare p record;
begin
  for p in
    select policyname, tablename from pg_policies
    where schemaname = 'public' and tablename in
      ('profiles', 'wagon_groups', 'wagons', 'defects', 'attachments', 'comments', 'push_subscriptions')
  loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
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

reset lock_timeout;

-- Kontrola: názvy pravidel se správnou diakritikou (21 řádků)
select schemaname, tablename, policyname from pg_policies
where (schemaname = 'public' and tablename in
        ('profiles', 'wagon_groups', 'wagons', 'defects', 'attachments', 'comments', 'push_subscriptions'))
   or (schemaname = 'storage' and policyname like 'soubory:%')
order by schemaname, tablename, policyname;
