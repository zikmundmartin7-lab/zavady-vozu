-- Závady vozů – úprava databáze: nové komentáře pro každého uživatele
-- • u každého uživatele se pamatuje, kdy naposledy otevřel komentáře které závady (tabulka comment_seen)
-- • nové komentáře = komentáře od ostatních u závad, které uživatel zapsal nebo komentoval, napsané od chvíle,
--   kdy komentáře té závady naposledy otevřel (pohled comment_inbox – odznak a seznam v aplikaci)
-- • komentáře napsané před spuštěním tohoto skriptu se počítají jako přečtené (profiles.comments_since)
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

-- 1) Od kdy se uživateli počítají nové komentáře (všem od teď)
alter table public.profiles add column if not exists comments_since timestamptz not null default now();

-- 2) Kdy uživatel naposledy otevřel komentáře které závady
create table if not exists public.comment_seen (
  user_id    uuid not null references public.profiles on delete cascade default auth.uid(),
  defect_id  uuid not null references public.defects on delete cascade,
  seen_at    timestamptz not null default now(),
  primary key (user_id, defect_id)
);
alter table public.comment_seen enable row level security;
drop policy if exists "přečtené komentáře: jen vlastní" on public.comment_seen;
create policy "přečtené komentáře: jen vlastní" on public.comment_seen
  for select to authenticated using (user_id = (select auth.uid()));

-- Otevření komentářů závady: zapíše „přečteno teď“
create or replace function public.mark_comments_seen(p_defect uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_member() then
    raise exception 'Nemáte oprávnění.';
  end if;
  insert into public.comment_seen (user_id, defect_id, seen_at) values (auth.uid(), p_defect, now())
    on conflict (user_id, defect_id) do update set seen_at = excluded.seen_at;
end $$;
revoke execute on function public.mark_comments_seen(uuid) from public, anon;
grant execute on function public.mark_comments_seen(uuid) to authenticated;

-- 3) Nové komentáře po závadách: počet, poslední komentář (text, autor, čas)
create or replace view public.comment_inbox with (security_invoker = true) as
select d.id as defect_id, d.wagon_id, w.number, d.description,
       count(c.id) as unread,
       max(c.created_at) as last_at,
       (array_agg(c.body order by c.created_at desc))[1] as last_body,
       (array_agg(p.full_name order by c.created_at desc))[1] as last_author
from public.profiles me
join public.comments c on c.author_id is distinct from me.id
join public.defects d on d.id = c.defect_id
join public.wagons w on w.id = d.wagon_id
left join public.profiles p on p.id = c.author_id
left join public.comment_seen s on s.defect_id = d.id and s.user_id = me.id
where me.id = (select auth.uid())
  and c.created_at > greatest(me.comments_since, s.seen_at)
  and (d.created_by = me.id
       or exists (select 1 from public.comments mine where mine.defect_id = d.id and mine.author_id = me.id))
group by d.id, w.number;

reset lock_timeout;
notify pgrst, 'reload schema';

-- Kontrola: nový sloupec, tabulka, funkce a pohled
select (select count(*) from information_schema.columns
         where table_schema = 'public' and table_name = 'profiles' and column_name = 'comments_since') as novy_sloupec,
       to_regclass('public.comment_seen') is not null as tabulka_prectenych,
       to_regprocedure('public.mark_comments_seen(uuid)') is not null as funkce,
       to_regclass('public.comment_inbox') is not null as pohled_novych_komentaru;
