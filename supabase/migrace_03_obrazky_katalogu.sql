-- Závady vozů – úprava databáze: úložiště pro obrázky z katalogu závad (příloha 9 VSP)
-- Vytvoří soukromé úložiště „katalog“. Obrázky v něm vidí jen přihlášení a schválení uživatelé,
-- nahrává je správce v aplikaci (Kódy závad → Obrázky katalogu). Data se nemění, lze spustit opakovaně.

-- Pojistka: pokud se skript při kopírování poškodil (rozsypaná diakritika), nic se neprovede.
do $$ begin
  if 'č' <> U&'\010D' then
    raise exception 'SKRIPT JE POSKOZENY: diakritika se pri kopirovani rozsypala. Zkopirujte ho znovu z GitHubu (tlacitko Copy raw file).';
  end if;
end $$;

set lock_timeout = '10s';

-- Obrázky z katalogu závad (příloha 9 VSP): soukromý bucket, název souboru = kód_pořadí.png.
-- Číst smí schválení uživatelé, nahrávat (i přepsat) a mazat správce.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('katalog', 'katalog', false, 5242880, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "katalog: čtení členové" on storage.objects;
create policy "katalog: čtení členové" on storage.objects
  for select to authenticated using (bucket_id = 'katalog' and public.is_member());
drop policy if exists "katalog: nahrání správce" on storage.objects;
create policy "katalog: nahrání správce" on storage.objects
  for insert to authenticated with check (bucket_id = 'katalog' and public.is_admin());
drop policy if exists "katalog: přepsání správce" on storage.objects;
create policy "katalog: přepsání správce" on storage.objects
  for update to authenticated using (bucket_id = 'katalog' and public.is_admin());
drop policy if exists "katalog: mazání správce" on storage.objects;
create policy "katalog: mazání správce" on storage.objects
  for delete to authenticated using (bucket_id = 'katalog' and public.is_admin());

reset lock_timeout;

select id, public, file_size_limit from storage.buckets where id = 'katalog';
