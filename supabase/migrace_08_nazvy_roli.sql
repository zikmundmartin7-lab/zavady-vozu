-- Závady vozů – úprava databáze: nové názvy rolí v chybových hláškách
-- Role v databázi zůstávají (user / repairer / admin), mění se jen to, jak se jmenují v aplikaci:
--   user = Vozmistr (beze změny), repairer = Správce (dřív Opravář), admin = Administrátor (dřív Správce)
-- Skript přepíše jen texty hlášek ve třech funkcích (úprava závady, změna role, obnova z koše) – vezme
-- jejich současnou podobu přímo z databáze a nahradí v ní jen tyto věty. Data ani oprávnění se nemění,
-- tabulky se nezamykají. Lze spustit i opakovaně.

-- Pojistka: pokud se skript při kopírování poškodil (rozsypaná diakritika), nic se neprovede.
do $$ begin
  if 'č' <> U&'\010D' or 'š' <> U&'\0161' or 'á' <> U&'\00E1' or 'ř' <> U&'\0159' then
    raise exception 'SKRIPT JE POSKOZENY: diakritika se pri kopirovani rozsypala. Zkopirujte ho znovu.';
  end if;
end $$;

set lock_timeout = '10s';

do $$
declare
  fn text;
  src text;
  before text;
  r record;
begin
  foreach fn in array array['public.protect_defect()', 'public.protect_profile()', 'public.restore_deleted(bigint)'] loop
    src := pg_get_functiondef(fn::regprocedure);
    before := src;
    -- nejdřív „opravář nebo správce“, ať se „správce“ nepřejmenuje dvakrát
    for r in select * from (values
      ('jen její autor, opravář nebo správce.', 'jen její autor, správce nebo administrátor.'),
      ('kdo ji vložil, nebo správce.',          'kdo ji vložil, nebo administrátor.'),
      ('Upravit ji může jen správce,',          'Upravit ji může jen administrátor,'),
      ('měnit ji smí jen správce',              'měnit ji smí jen administrátor'),
      ('Roli může změnit jen správce.',         'Roli může změnit jen administrátor.'),
      ('Správce si nemůže odebrat vlastní roli.', 'Administrátor si nemůže odebrat vlastní roli.'),
      ('Obnovit smazané záznamy může jen správce.', 'Obnovit smazané záznamy může jen administrátor.')
    ) as t(old_text, new_text) loop
      src := replace(src, r.old_text, r.new_text);
    end loop;
    if src <> before then execute src; end if;
  end loop;
end $$;

reset lock_timeout;

-- Kontrola: v Results musí být 3 řádky a ve všech sloupcích true
select p.proname as funkce,
       pg_get_functiondef(p.oid) like '%administrátor%' as nove_nazvy,
       pg_get_functiondef(p.oid) not like '%opravář%'
         and pg_get_functiondef(p.oid) not like '%jen správce%'
         and pg_get_functiondef(p.oid) not like '%nebo správce.%' as bez_starych
from pg_proc p
where p.oid in ('public.protect_defect()'::regprocedure,
                'public.protect_profile()'::regprocedure,
                'public.restore_deleted(bigint)'::regprocedure)
order by 1;
