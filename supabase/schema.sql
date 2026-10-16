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
  created_at  timestamptz not null default now()
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

create table public.wagon_groups (
  id    smallint primary key,
  name  text not null unique,
  sort  smallint not null
);

insert into public.wagon_groups (id, name, sort) values
  (1, 'Chopry', 1),
  (2, 'SA', 2),
  (3, 'UA', 3),
  (4, 'Vapy/Fals', 4),
  (5, 'Trakce/Zetky', 5),
  (6, 'Plošiňáky/Res/Smmp', 6),
  (7, 'Ostatní', 7);

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

-- severity: 1 = žlutá (nízká), 2 = oranžová (střední), 3 = červená (vysoká)
create table public.defects (
  id               uuid primary key default gen_random_uuid(),
  wagon_id         uuid not null references public.wagons on delete cascade,
  severity         smallint not null check (severity between 1 and 3),
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
--   text, závažnost, datum zjištění → autor závady nebo správce
--   opraveno / vrátit               → autor závady, opravář nebo správce
-- Datum zjištění nesmí být v budoucnosti (rezerva 5 min na nepřesné hodiny v telefonu)
-- a u opravené závady nesmí být pozdější než oprava. Čas vložení a čas opravy určuje server.
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

create view public.group_overview with (security_invoker = true) as
select g.id, g.name, g.sort,
       count(d.id) filter (where d.resolved_at is null) as open_count
from public.wagon_groups g
left join public.wagons w on w.group_id = g.id
left join public.defects d on d.wagon_id = w.id
group by g.id;

create view public.wagon_overview with (security_invoker = true) as
select w.id, w.number, w.last4, w.group_id, w.note, w.created_at,
       g.name as group_name,
       count(d.id) filter (where d.resolved_at is null)     as open_count,
       coalesce(max(d.severity) filter (where d.resolved_at is null), 0) as max_severity,
       count(d.id) filter (where d.resolved_at is not null) as resolved_count,
       max(d.created_at) as last_defect_at
from public.wagons w
join public.wagon_groups g on g.id = w.group_id
left join public.defects d on d.wagon_id = w.id
group by w.id, g.name;

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

-- ───────────────────────── Oprávnění (Row Level Security) ─────────────────────────

alter table public.profiles           enable row level security;
alter table public.wagon_groups       enable row level security;
alter table public.wagons             enable row level security;
alter table public.defects            enable row level security;
alter table public.attachments        enable row level security;
alter table public.comments           enable row level security;
alter table public.push_subscriptions enable row level security;

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

-- ───────────────────────── Živé aktualizace ─────────────────────────

alter publication supabase_realtime add table public.defects, public.comments;
