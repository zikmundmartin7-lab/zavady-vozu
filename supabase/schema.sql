-- Závady vozů – databáze pro Supabase
-- Spusťte celý soubor v Supabase: SQL Editor → New query → vložit → Run.
-- Skript je možné spustit jen jednou na prázdný projekt.

-- Pojistka: pokud se skript při kopírování poškodil (rozsypaná diakritika), nic se neprovede.
do $$ begin
  if 'č' <> U&'\010D' then
    raise exception 'SKRIPT JE POSKOZENY: diakritika se pri kopirovani rozsypala. Zkopirujte ho znovu z GitHubu (tlacitko Copy raw file).';
  end if;
end $$;

-- ───────────────────────── Uživatelé a role ─────────────────────────
-- pending  = čeká na schválení správcem (nevidí žádná data)
-- user     = vozmistr (zakládá závady, komentuje, své závady i označí jako opravené)
-- repairer = opravář (navíc označuje jako opravené i cizí závady)
-- admin    = správce (vše + úpravy cizích závad, správa uživatelů)

create table public.profiles (
  id          uuid primary key references auth.users on delete cascade,
  email       text,
  full_name   text not null default '',
  role        text not null default 'pending'
              check (role in ('pending', 'user', 'repairer', 'admin')),
  created_at  timestamptz not null default now(),
  news_since  timestamptz not null default now()   -- od kdy se uživateli počítají nové závady
);

create or replace function public.my_role() returns text
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_member() returns boolean
language sql stable as $$ select coalesce(public.my_role() in ('user', 'repairer', 'admin'), false) $$;

create or replace function public.is_admin() returns boolean
language sql stable as $$ select coalesce(public.my_role() = 'admin', false) $$;

create or replace function public.can_resolve() returns boolean
language sql stable as $$ select coalesce(public.my_role() in ('repairer', 'admin'), false) $$;

-- Nový účet: první registrovaný uživatel je správce, ostatní čekají na schválení.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    case when exists (select 1 from public.profiles) then 'pending' else 'admin' end
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Roli smí měnit jen správce (vlastní jméno si upraví každý sám).
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

create trigger profiles_protect
  before update on public.profiles
  for each row execute function public.protect_profile();

-- ───────────────────────── Skupiny, vozy, závady ─────────────────────────

-- name = odborný název (řady vozů), slang = jak se skupině říká; na jeden řádek „Faccpp – Choper“
create table public.wagon_groups (
  id    smallint primary key,
  name  text not null unique,
  sort  smallint not null,
  slang text
);

insert into public.wagon_groups (id, name, slang, sort) values
  (1, 'Faccpp', 'Choper', 1),
  (2, 'Faccs', 'Sa', 2),
  (3, 'Ua', null, 3),
  (4, 'Fals', 'Vap', 4),
  (5, 'Uk, Gbgs', 'Trakce', 5),
  (6, 'Res, Smmp', 'Plošinové', 6),
  (7, 'Ostatní', null, 7);

create table public.wagons (
  id          uuid primary key default gen_random_uuid(),
  number      text not null unique check (number ~ '^[0-9]{12}$'),  -- 12 číslic bez mezer
  last4       text generated always as (right(number, 4)) stored,  -- XXX-X (vč. kontrolní číslice)
  group_id    smallint not null references public.wagon_groups,
  note        text,
  created_by  uuid references public.profiles on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);
create index wagons_last4_idx on public.wagons (last4 text_pattern_ops);
create index wagons_group_idx on public.wagons (group_id);

-- severity: dřívější závažnost (1–3) – aplikace ji už nepoužívá, zůstává jen kvůli starším záznamům
-- defect_code: nepovinný kód závady podle přílohy 9 VSP (až 4 úrovně, např. 1.2.2.1 nebo 6.1.1.12)
create table public.defects (
  id               uuid primary key default gen_random_uuid(),
  wagon_id         uuid not null references public.wagons on delete cascade,
  severity         smallint check (severity between 1 and 3),
  defect_code      text check (defect_code ~ '^[0-9]{1,2}([.][0-9]{1,2}){0,3}$'),
  description      text not null check (length(trim(description)) > 0),
  found_at         timestamptz not null default now(),  -- datum a čas zjištění (lze zadat i zpětně)
  created_by       uuid references public.profiles on delete set null default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz,
  resolved_at      timestamptz,
  resolved_by      uuid references public.profiles on delete set null,
  resolution_note  text
);
create index defects_wagon_idx on public.defects (wagon_id);
create index defects_open_idx on public.defects (wagon_id) where resolved_at is null;

-- Kdo smí co měnit:
--   text, kód závady, datum zjištění → autor závady nebo správce; po opravě (zamčeno) jen správce
--   opraveno / vrátit               → autor závady, opravář nebo správce
-- Datum zjištění nesmí být v budoucnosti (rezerva 5 min na nepřesné hodiny v telefonu)
-- a u opravené závady nesmí být pozdější než oprava. Čas vložení a čas opravy určuje server.
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

drop trigger if exists defects_protect on public.defects;
create trigger defects_protect
  before update on public.defects
  for each row execute function public.protect_defect();

create table public.attachments (
  id          uuid primary key default gen_random_uuid(),
  defect_id   uuid not null references public.defects on delete cascade,
  path        text not null,          -- cesta v úložišti "attachments"
  kind        text not null check (kind in ('image', 'video')),
  created_by  uuid references public.profiles on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);
create index attachments_defect_idx on public.attachments (defect_id);

create table public.comments (
  id          uuid primary key default gen_random_uuid(),
  defect_id   uuid not null references public.defects on delete cascade,
  author_id   uuid references public.profiles on delete set null default auth.uid(),
  body        text not null check (length(trim(body)) > 0),
  created_at  timestamptz not null default now()
);
create index comments_defect_idx on public.comments (defect_id, created_at);

create table public.push_subscriptions (
  endpoint      text primary key,
  user_id       uuid not null references public.profiles on delete cascade default auth.uid(),
  subscription  jsonb not null,
  created_at    timestamptz not null default now()
);

-- ───────────────────────── Přehledy (počty pro odznaky) ─────────────────────────

-- Kdy uživatel naposledy otevřel který vůz (zapisuje funkce mark_wagon_seen)
create table public.wagon_seen (
  user_id   uuid not null references public.profiles on delete cascade default auth.uid(),
  wagon_id  uuid not null references public.wagons on delete cascade,
  seen_at   timestamptz not null default now(),
  primary key (user_id, wagon_id)
);

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

-- new_count = neopravené závady od ostatních vložené od chvíle, kdy uživatel vůz naposledy otevřel
create view public.group_overview with (security_invoker = true) as
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

create view public.wagon_overview with (security_invoker = true) as
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

create view public.defect_feed with (security_invoker = true) as
select d.*,
       pc.full_name as created_by_name,
       pr.full_name as resolved_by_name,
       (select count(*) from public.comments c where c.defect_id = d.id) as comment_count
from public.defects d
left join public.profiles pc on pc.id = d.created_by
left join public.profiles pr on pr.id = d.resolved_by;

create view public.comment_feed with (security_invoker = true) as
select c.*, p.full_name as author_name
from public.comments c
left join public.profiles p on p.id = c.author_id;

-- ───────────────────────── Katalog kódů závad a předpisy ─────────────────────────

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

-- ───────────────────────── Historie změn a koš ─────────────────────────
-- Každá změna (vložení, úprava, smazání, obnovení) se zapíše do audit_log i s původními a novými hodnotami.
-- Smazané záznamy zůstávají v audit_log navždy – to je „koš“; správce je může obnovit (restore_deleted).
-- Všechno smazané jednou akcí (např. vůz i s jeho závadami) má stejné číslo transakce (tx).

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

-- Obnovení smazaných záznamů z koše (jen správce): vrátí vše, co se smazalo jednou akcí (tx),
-- ve správném pořadí (vůz → závady → přílohy a komentáře). Soubory (fotky, PDF) se při mazání neodstraňují.
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

-- ───────────────────────── Pravidelné exporty na e-mail ─────────────────────────
-- Nastavuje správce v aplikaci, rozesílá server (server/zavady.py exports) každou hodinu.

create table if not exists public.export_schedules (
  id            uuid primary key default gen_random_uuid(),
  recipient     text not null check (recipient ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  report        text not null check (report in ('open', 'all')),
  frequency     text not null check (frequency in ('daily', 'weekly', 'monthly')),
  weekday       smallint check (weekday between 1 and 7),      -- 1 = pondělí (u týdenního)
  monthday      smallint check (monthday between 1 and 28),    -- den v měsíci (u měsíčního)
  hour          smallint not null default 7 check (hour between 0 and 23),
  group_ids     smallint[],                                    -- jen vybrané skupiny vozů (prázdné = všechny)
  active        boolean not null default true,
  last_sent_at  timestamptz,
  last_error    text,
  created_by    uuid references public.profiles on delete set null default auth.uid(),
  created_at    timestamptz not null default now()
);

-- ───────────────────────── Oprávnění (Row Level Security) ─────────────────────────

alter table public.profiles           enable row level security;
alter table public.wagon_groups       enable row level security;
alter table public.wagons             enable row level security;
alter table public.defects            enable row level security;
alter table public.attachments        enable row level security;
alter table public.comments           enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.defect_codes       enable row level security;
alter table public.regulations        enable row level security;
alter table public.audit_log          enable row level security;
alter table public.export_schedules   enable row level security;
alter table public.wagon_seen         enable row level security;

create policy "prohlédnuté vozy: jen vlastní" on public.wagon_seen
  for select to authenticated using (user_id = (select auth.uid()));

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
  for delete to authenticated using (public.is_admin() or (created_by = auth.uid() and resolved_at is null));

create policy "přílohy: čtení" on public.attachments
  for select to authenticated using (public.is_member());
create policy "přílohy: přidání autor závady nebo správce" on public.attachments
  for insert to authenticated with check (
    public.is_member() and created_by = auth.uid() and exists (
      select 1 from public.defects d
      where d.id = defect_id and (public.is_admin() or (d.created_by = auth.uid() and d.resolved_at is null))));
create policy "přílohy: mazání autor závady nebo správce" on public.attachments
  for delete to authenticated using (
    public.is_admin() or exists (
      select 1 from public.defects d where d.id = defect_id and d.created_by = auth.uid() and d.resolved_at is null));

create policy "komentáře: čtení" on public.comments
  for select to authenticated using (public.is_member());
create policy "komentáře: přidání" on public.comments
  for insert to authenticated with check (public.is_member() and author_id = auth.uid());
create policy "komentáře: mazání autor nebo správce" on public.comments
  for delete to authenticated using (author_id = auth.uid() or public.is_admin());

create policy "push: vlastní odběry" on public.push_subscriptions
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "kódy závad: čtení" on public.defect_codes;
create policy "kódy závad: čtení" on public.defect_codes
  for select to authenticated using (public.is_member());

drop policy if exists "historie: čtení" on public.audit_log;
create policy "historie: čtení" on public.audit_log
  for select to authenticated using (public.is_member());

drop policy if exists "exporty: správce" on public.export_schedules;
create policy "exporty: správce" on public.export_schedules
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

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

-- ───────────────────────── Úložiště fotek a videí ─────────────────────────
-- Soukromý bucket, max. 50 MB na soubor (limit bezplatného tarifu).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attachments', 'attachments', false, 52428800, array['image/*', 'video/*']);

create policy "soubory: čtení členové" on storage.objects
  for select to authenticated using (bucket_id = 'attachments' and public.is_member());
create policy "soubory: nahrání členové" on storage.objects
  for insert to authenticated with check (bucket_id = 'attachments' and public.is_member());
create policy "soubory: mazání vlastník nebo správce" on storage.objects
  for delete to authenticated using (
    bucket_id = 'attachments' and (owner = auth.uid() or public.is_admin()));

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

-- ───────────────────────── Živé aktualizace ─────────────────────────

alter publication supabase_realtime add table public.defects, public.comments;
