-- Závady vozů – úprava databáze: historie změn, koš, zamčení opravené závady, pravidelné exporty
-- • každá změna vozů, závad, příloh, komentářů, předpisů a uživatelů se zapíše do historie (audit_log)
-- • smazané záznamy zůstávají navždy v koši (audit_log) a správce je může obnovit
-- • opravená závada je zamčená: text, kód, datum, fotky a smazání jen správce
-- • tabulka pro pravidelné exporty na e-mail (nastavuje správce, rozesílá server)
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

-- 1) Nové tabulky (historie a koš, pravidelné exporty)
create table if not exists public.audit_log (
  id           bigint generated always as identity primary key,
  tx           bigint not null default txid_current(),
  at           timestamptz not null default now(),
  actor        uuid default auth.uid(),
  actor_name   text,
  tbl          text not null,
  row_id       text not null,
  action       text not null check (action in ('insert', 'update', 'delete', 'restore')),
  old_row      jsonb,
  new_row      jsonb,
  wagon_id     uuid,
  defect_id    uuid,
  restored_at  timestamptz,
  restored_by  uuid
);
create index if not exists audit_log_defect_idx on public.audit_log (defect_id, at);
create index if not exists audit_log_wagon_idx on public.audit_log (wagon_id, at);
create index if not exists audit_log_trash_idx on public.audit_log (at desc) where action = 'delete';

create table if not exists public.export_schedules (
  id            uuid primary key default gen_random_uuid(),
  recipient     text not null check (recipient ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  report        text not null check (report in ('open', 'all')),
  frequency     text not null check (frequency in ('daily', 'weekly', 'monthly')),
  weekday       smallint check (weekday between 1 and 7),      -- 1 = pondělí (u týdenního)
  monthday      smallint check (monthday between 1 and 28),    -- den v měsíci (u měsíčního)
  hour          smallint not null default 7 check (hour between 0 and 23),
  active        boolean not null default true,
  last_sent_at  timestamptz,
  last_error    text,
  created_by    uuid references public.profiles on delete set null default auth.uid(),
  created_at    timestamptz not null default now()
);

alter table public.audit_log        enable row level security;
alter table public.export_schedules enable row level security;

drop policy if exists "historie: čtení" on public.audit_log;
create policy "historie: čtení" on public.audit_log
  for select to authenticated using (public.is_member());

drop policy if exists "exporty: správce" on public.export_schedules;
create policy "exporty: správce" on public.export_schedules
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- 2) Obnovení z koše
create or replace function public.restore_deleted(p_tx bigint) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  cols text;
  n integer := 0;
begin
  if not public.is_admin() then
    raise exception 'Obnovit smazané záznamy může jen správce.';
  end if;
  perform set_config('app.restoring', '1', true);
  for r in
    select * from public.audit_log
    where tx = p_tx and action = 'delete' and restored_at is null
    order by case tbl when 'wagons' then 1 when 'defects' then 2 when 'regulations' then 3 else 4 end, id
  loop
    select string_agg(quote_ident(attname), ', ' order by attnum) into cols
    from pg_attribute
    where attrelid = format('public.%I', r.tbl)::regclass and attnum > 0 and not attisdropped and attgenerated = '';
    begin
      execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1) on conflict (id) do nothing',
                     r.tbl, cols, cols, r.tbl) using r.old_row;
    exception when foreign_key_violation then
      raise exception 'Nelze obnovit: nadřazený záznam (vůz nebo závada) je také smazaný. Obnovte nejdřív ten.';
    end;
    update public.audit_log set restored_at = now(), restored_by = auth.uid() where id = r.id;
    n := n + 1;
  end loop;
  perform set_config('app.restoring', '', true);
  return n;
end $$;

-- 3) Zamknout přehledy a tabulky (nejdřív přehledy – stejné pořadí jako čtení z aplikace)
lock table public.defect_feed, public.comment_feed, public.wagon_overview, public.attachments, public.regulations
  in access exclusive mode;

-- 4) Zápis změn do historie
create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  o jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  n jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  r jsonb := coalesce(n, o);
  v_action text := lower(tg_op);
  v_defect uuid;
  v_wagon uuid;
begin
  if tg_op = 'UPDATE' and o = n then return null; end if;          -- nic se nezměnilo
  if tg_op = 'INSERT' and current_setting('app.restoring', true) = '1' then v_action := 'restore'; end if;
  if tg_table_name = 'defects' then
    v_defect := (r ->> 'id')::uuid;
    v_wagon := (r ->> 'wagon_id')::uuid;
  elsif tg_table_name in ('comments', 'attachments') then
    v_defect := (r ->> 'defect_id')::uuid;
    select d.wagon_id into v_wagon from public.defects d where d.id = v_defect;
  elsif tg_table_name = 'wagons' then
    v_wagon := (r ->> 'id')::uuid;
  end if;
  insert into public.audit_log (actor, actor_name, tbl, row_id, action, old_row, new_row, wagon_id, defect_id)
  values (auth.uid(), (select p.full_name from public.profiles p where p.id = auth.uid()),
          tg_table_name, r ->> 'id', v_action, o, n, v_wagon, v_defect);
  return null;
end $$;

drop trigger if exists wagons_audit on public.wagons;
create trigger wagons_audit after insert or update or delete on public.wagons
  for each row execute function public.audit_row();
drop trigger if exists defects_audit on public.defects;
create trigger defects_audit after insert or update or delete on public.defects
  for each row execute function public.audit_row();
drop trigger if exists attachments_audit on public.attachments;
create trigger attachments_audit after insert or update or delete on public.attachments
  for each row execute function public.audit_row();
drop trigger if exists comments_audit on public.comments;
create trigger comments_audit after insert or update or delete on public.comments
  for each row execute function public.audit_row();
drop trigger if exists regulations_audit on public.regulations;
create trigger regulations_audit after insert or update or delete on public.regulations
  for each row execute function public.audit_row();
drop trigger if exists profiles_audit on public.profiles;
create trigger profiles_audit after insert or update or delete on public.profiles
  for each row execute function public.audit_row();

-- 5) Zamčení opravené závady a zachování původních časů při obnově z koše
create or replace function public.prepare_defect() returns trigger
language plpgsql as $$
begin
  -- obnova z koše (restore_deleted) vrací záznam beze změny, i s původními časy
  if current_setting('app.restoring', true) = '1' then return new; end if;
  new.created_at := now();
  new.found_at := coalesce(new.found_at, now());
  if new.found_at > now() + interval '5 minutes' then
    raise exception 'Datum zjištění nemůže být v budoucnosti.';
  end if;
  return new;
end $$;

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
  -- Opravená závada je zamčená: měnit ji smí jen správce (nebo ji nejdřív vrátit mezi neopravené)
  if content_changed and old.resolved_at is not null and not public.is_admin() then
    raise exception 'Opravená závada je zamčená. Upravit ji může jen správce, nebo ji nejdřív vraťte mezi neopravené.';
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

-- Pravidla mazání závad a příloh: odstranit stávající (bez ohledu na název) a vytvořit nová
do $$
declare p record;
begin
  for p in
    select policyname, tablename from pg_policies
    where schemaname = 'public'
      and ((tablename = 'defects' and cmd = 'DELETE') or (tablename = 'attachments' and cmd in ('INSERT', 'DELETE')))
  loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

create policy "závady: mazání autor nebo správce" on public.defects
  for delete to authenticated using (public.is_admin() or (created_by = auth.uid() and resolved_at is null));
create policy "přílohy: přidání autor závady nebo správce" on public.attachments
  for insert to authenticated with check (
    public.is_member() and created_by = auth.uid() and exists (
      select 1 from public.defects d
      where d.id = defect_id and (public.is_admin() or (d.created_by = auth.uid() and d.resolved_at is null))));
create policy "přílohy: mazání autor závady nebo správce" on public.attachments
  for delete to authenticated using (
    public.is_admin() or exists (
      select 1 from public.defects d where d.id = defect_id and d.created_by = auth.uid() and d.resolved_at is null));

reset lock_timeout;

-- Kontrola: 6 tabulek s historií (wagons, defects, attachments, comments, regulations, profiles)
select count(*) as tabulek_s_historii from pg_trigger where tgname like '%\_audit' escape '\' and not tgisinternal;
