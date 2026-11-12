-- THE HOUSE: casino night bank and tables, linked to House Tokens (1 PB = 1 HT). Run once after 007_join.sql.
-- Casino players are club members: every casino win or loss is mirrored into their HT wallet (transactions table).
-- This file replaces any earlier version: it drops old house_ objects first (casino data only).

do $$ declare r record; begin
  for r in select p.oid::regprocedure sig from pg_proc p where p.proname like 'house\_%' and p.pronamespace = 'public'::regnamespace loop execute format('drop function if exists %s cascade', r.sig); end loop;
  for r in select tablename from pg_tables where schemaname = 'public' and tablename like 'house\_%' loop execute format('drop table if exists %I cascade', r.tablename); end loop;
end $$;
alter table transactions add column if not exists house_tx uuid;   -- links a wallet row to the casino ledger entry that caused it

create table house_config(
  id int primary key default 1 check (id = 1),
  name text not null default 'THE HOUSE',
  status text not null default 'setup' check (status in ('setup','ready','open','closing','closed')),
  bank_float int not null default 5000 check (bank_float >= 0),
  promo_budget int not null default 1000 check (promo_budget >= 0),
  loan_max int not null default 100 check (loan_max >= 0),
  loan_interest int not null default 0 check (loan_interest >= 0),
  rank_by text not null default 'change' check (rank_by in ('change','net')),
  bank_balance int not null default 0 constraint house_bank_afford check (bank_balance >= 0),
  promo_left int not null default 0 constraint house_promo_left check (promo_left >= 0),
  winner_id uuid, tiebreak_note text,
  constraint house_promo_reserved check (bank_balance >= promo_left)
);
insert into house_config default values;

create table house_players(
  id uuid primary key default gen_random_uuid(), member_id uuid not null unique references profiles(id) on delete cascade, code text unique not null,
  loan int not null default 0 constraint house_loan_nonneg check (loan >= 0), tiebreak int not null default 0, active boolean not null default true, created_at timestamptz not null default now()
);
create table house_pins(player_id uuid primary key references house_players on delete cascade, hash text not null, fails int not null default 0, locked_until timestamptz);
create table house_games(
  id uuid primary key default gen_random_uuid(), name text unique not null, kind text not null default 'house' check (kind in ('house','pvp','pot','reward')),
  odds_num int not null default 1 check (odds_num > 0), odds_den int not null default 1 check (odds_den > 0), min_bet int not null default 0, max_bet int, entry_fee int not null default 0,
  status text not null default 'pending' check (status in ('pending','active','completed')), sort int not null default 0
);
create table house_staff(user_id uuid primary key references auth.users on delete cascade, name text not null);
create table house_tx(
  id uuid primary key default gen_random_uuid(), seq bigint generated always as identity unique,
  kind text not null check (kind in ('start','pvp','bet','pot','reward','loan_issue','loan_repay','settle','reversal')),
  game_id uuid references house_games, note text, detail jsonb not null default '{}', manager uuid not null, manager_name text not null,
  idem text unique, reverses uuid unique references house_tx, created_at timestamptz not null default now()
);
create table house_lines(
  id bigint generated always as identity primary key, tx_id uuid not null references house_tx, account text not null check (account in ('player','bank','promo')),
  player_id uuid references house_players, cash_delta int not null default 0, loan_delta int not null default 0
);
create table house_results(id uuid primary key default gen_random_uuid(), game_id uuid not null references house_games, winners uuid[] not null default '{}', note text, manager_name text not null, created_at timestamptz not null default now());
create table house_cash_counts(id bigint generated always as identity primary key, counted int not null, note text, manager_name text not null, created_at timestamptz not null default now());
create table house_archive(id uuid primary key default gen_random_uuid(), mode text not null, created_by text, created_at timestamptz not null default now(), data jsonb not null);
create index on house_lines(tx_id); create index on house_lines(player_id); create index on house_tx(game_id); create index on transactions(house_tx);

create function house_immutable() returns trigger language plpgsql as $$
begin
  if current_setting('house.reset', true) = '1' then if tg_op = 'DELETE' then return old; else return new; end if; end if;
  raise exception 'Ledger entries cannot be changed or deleted. Use a reversal.';
end $$;
create trigger imm_tx before update or delete on house_tx for each row execute function house_immutable();
create trigger imm_lines before update or delete on house_lines for each row execute function house_immutable();
create trigger imm_results before update or delete on house_results for each row execute function house_immutable();
create trigger imm_counts before update or delete on house_cash_counts for each row execute function house_immutable();

create function house_role() returns text language sql stable security definer set search_path=public as $$
  select case when coalesce((select is_owner from profiles where id = auth.uid()), false) then 'super' when exists (select 1 from house_staff where user_id = auth.uid()) then 'manager' end $$;
create function house_need(p_super boolean default false) returns text language plpgsql stable security definer set search_path=public as $$
declare r text := house_role();
begin if r is null or (p_super and r <> 'super') then raise exception 'You do not have permission to do that'; end if; return r; end $$;
create function house_actor() returns text language sql stable security definer set search_path=public as $$ select coalesce((select display_name from profiles where id = auth.uid()), 'Unknown') $$;
create function house_hash(p_code text, p_pin text) returns text language sql immutable as $$ select encode(sha256(convert_to(upper(p_code) || ':' || p_pin, 'utf8')), 'hex') $$;
create function house_dup(p_idem text) returns uuid language sql stable security definer set search_path=public as $$ select id from house_tx where idem = p_idem $$;
create function house_ref(p_id uuid) returns jsonb language sql stable security definer set search_path=public as $$ select jsonb_build_object('id', id, 'seq', seq) from house_tx where id = p_id $$;
create function house_cash(p_member uuid) returns int language sql stable security definer set search_path=public as $$ select coalesce(sum(amount), 0)::int from transactions where member_id = p_member $$;

-- The only place balances change. Player money moves in the HT wallet; the bank and promo pool are the house's own accounts.
create function house_post(p_kind text, p_game uuid, p_note text, p_detail jsonb, p_idem text, p_lines jsonb, p_reverses uuid default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare st text; tid uuid; l jsonb; ids uuid[]; bd int := 0; pd int := 0; cname text; gname text; label text; pid uuid; mem uuid; amt int;
begin
  perform house_need();
  select status into st from house_config;
  if st in ('closing','closed') and coalesce(current_setting('house.settle', true), '') <> '1' then raise exception 'The casino is % - no new transactions', st; end if;
  insert into house_tx(kind, game_id, note, detail, manager, manager_name, idem, reverses)
    values (p_kind, p_game, nullif(trim(coalesce(p_note, '')), ''), coalesce(p_detail, '{}'), auth.uid(), house_actor(), p_idem, p_reverses) returning id into tid;
  select name into gname from house_games where id = p_game;
  label := case when p_kind = 'reversal' then 'Casino reversal' else 'Casino: ' || case p_kind when 'pvp' then 'player vs player' when 'bet' then 'house bet' when 'pot' then 'game pot'
    when 'reward' then 'house reward' when 'loan_issue' then 'emergency loan' when 'loan_repay' then 'loan repayment' when 'settle' then 'loan settlement' else p_kind end end || coalesce(' (' || gname || ')', '');
  select array_agg(distinct (x->>'player')::uuid) into ids from jsonb_array_elements(p_lines) x where nullif(x->>'player', '') is not null;
  if ids is not null then
    perform 1 from house_players where id = any(ids) order by id for update;
    perform 1 from profiles where id in (select member_id from house_players where id = any(ids)) order by id for update;
  end if;
  for l in select * from jsonb_array_elements(p_lines) loop
    insert into house_lines(tx_id, account, player_id, cash_delta, loan_delta)
      values (tid, l->>'account', nullif(l->>'player', '')::uuid, coalesce((l->>'cash')::int, 0), coalesce((l->>'loan')::int, 0));
    if l->>'account' = 'player' then
      pid := (l->>'player')::uuid; amt := coalesce((l->>'cash')::int, 0);
      update house_players set loan = loan + coalesce((l->>'loan')::int, 0) where id = pid;
      if amt <> 0 then
        select member_id into mem from house_players where id = pid;
        insert into transactions(member_id, amount, reason, created_by, house_tx) values (mem, amt, label, auth.uid(), tid);
        if amt < 0 and house_cash(mem) < 0 then raise exception 'A player does not have enough House Tokens for this'; end if;
      end if;
    elsif l->>'account' = 'bank' then bd := bd + coalesce((l->>'cash')::int, 0);
    else pd := pd + coalesce((l->>'cash')::int, 0); end if;
  end loop;
  if bd <> 0 or pd <> 0 then update house_config set bank_balance = bank_balance + bd + pd, promo_left = promo_left + pd; end if;
  return tid;
exception when check_violation then
  get stacked diagnostics cname = constraint_name;
  raise exception '%', case cname
    when 'house_bank_afford' then 'The bank cannot afford this payout'
    when 'house_promo_left' then 'Not enough promotional budget left'
    when 'house_promo_reserved' then 'The bank cannot afford this payout (the promotional reserve is kept aside)'
    when 'house_loan_nonneg' then 'That repayment is more than the outstanding loan'
    else 'Transaction not allowed' end;
end $$;

-- Typed transactions ----------------------------------------------------------------------------
create function house_pvp(p_payer uuid, p_receiver uuid, p_amount int, p_game uuid default null, p_note text default null, p_idem text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare t uuid;
begin
  perform house_need(); t := house_dup(p_idem); if t is not null then return house_ref(t); end if;
  if p_amount <= 0 then raise exception 'Amount must be more than zero'; end if;
  if p_payer = p_receiver then raise exception 'Pick two different players'; end if;
  if (select count(*) from house_players where id in (p_payer, p_receiver) and active) < 2 then raise exception 'Unknown player'; end if;
  t := house_post('pvp', p_game, p_note, jsonb_build_object('amount', p_amount), p_idem, jsonb_build_array(
    jsonb_build_object('account','player','player',p_payer,'cash',-p_amount), jsonb_build_object('account','player','player',p_receiver,'cash',p_amount)));
  return house_ref(t);
end $$;

create function house_bet(p_player uuid, p_game uuid, p_stake int, p_outcome text, p_note text default null, p_idem text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare t uuid; g house_games%rowtype; profit int; pc int; lines jsonb; payout int; mem uuid;
begin
  perform house_need(); t := house_dup(p_idem); if t is not null then return house_ref(t); end if;
  select * into g from house_games where id = p_game; if not found then raise exception 'Pick a game'; end if;
  if p_stake <= 0 then raise exception 'Stake must be more than zero'; end if;
  if g.min_bet > 0 and p_stake < g.min_bet then raise exception 'Minimum bet for % is % HT', g.name, g.min_bet; end if;
  if g.max_bet is not null and p_stake > g.max_bet then raise exception 'Maximum bet for % is % HT', g.name, g.max_bet; end if;
  select member_id into mem from house_players where id = p_player and active; if not found then raise exception 'Unknown player'; end if;
  pc := house_cash(mem); if pc < p_stake then raise exception 'The player only has % HT', pc; end if;
  profit := (p_stake * g.odds_num) / g.odds_den;
  if p_outcome = 'win' then
    lines := jsonb_build_array(jsonb_build_object('account','player','player',p_player,'cash',profit), jsonb_build_object('account','bank','cash',-profit)); payout := p_stake + profit;
  elsif p_outcome = 'loss' then
    lines := jsonb_build_array(jsonb_build_object('account','player','player',p_player,'cash',-p_stake), jsonb_build_object('account','bank','cash',p_stake)); payout := 0;
  elsif p_outcome = 'push' then
    lines := jsonb_build_array(jsonb_build_object('account','player','player',p_player,'cash',0)); payout := p_stake;
  else raise exception 'Outcome must be win, loss or push'; end if;
  t := house_post('bet', p_game, p_note, jsonb_build_object('stake', p_stake, 'outcome', p_outcome, 'payout', payout), p_idem, lines);
  return house_ref(t);
end $$;

create function house_pot(p_game uuid, p_entries jsonb, p_payouts jsonb, p_note text default null, p_idem text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare t uuid; pot int; paid int; lines jsonb;
begin
  perform house_need(); t := house_dup(p_idem); if t is not null then return house_ref(t); end if;
  if coalesce(jsonb_array_length(p_entries), 0) = 0 then raise exception 'Add at least one player to the pot'; end if;
  if exists (select 1 from jsonb_array_elements(p_entries) x where (x->>'fee')::int < 0) or exists (select 1 from jsonb_array_elements(coalesce(p_payouts, '[]')) x where (x->>'amount')::int < 0)
    then raise exception 'Amounts cannot be negative'; end if;
  select coalesce(sum((x->>'fee')::int), 0) into pot from jsonb_array_elements(p_entries) x;
  select coalesce(sum((x->>'amount')::int), 0) into paid from jsonb_array_elements(coalesce(p_payouts, '[]')) x;
  if pot <= 0 then raise exception 'The pot is empty'; end if;
  if paid > pot then raise exception 'Payouts (% HT) cannot be more than the pot (% HT)', paid, pot; end if;
  with n as (
    select player, sum(d) cash from (
      select (x->>'player')::uuid player, -(x->>'fee')::int d from jsonb_array_elements(p_entries) x
      union all select (x->>'player')::uuid, (x->>'amount')::int from jsonb_array_elements(coalesce(p_payouts, '[]')) x) s group by player)
  select jsonb_agg(jsonb_build_object('account','player','player',player,'cash',cash)) into lines from n;
  if pot - paid > 0 then lines := lines || jsonb_build_array(jsonb_build_object('account','bank','cash',pot - paid)); end if;
  t := house_post('pot', p_game, p_note, jsonb_build_object('pot', pot, 'paid', paid, 'kept', pot - paid), p_idem, lines);
  return house_ref(t);
end $$;

create function house_reward(p_player uuid, p_amount int, p_game uuid default null, p_note text default null, p_idem text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare t uuid;
begin
  perform house_need(); t := house_dup(p_idem); if t is not null then return house_ref(t); end if;
  if p_amount <= 0 then raise exception 'Amount must be more than zero'; end if;
  if not exists (select 1 from house_players where id = p_player and active) then raise exception 'Unknown player'; end if;
  t := house_post('reward', p_game, p_note, jsonb_build_object('amount', p_amount), p_idem, jsonb_build_array(
    jsonb_build_object('account','player','player',p_player,'cash',p_amount), jsonb_build_object('account','promo','cash',-p_amount)));
  return house_ref(t);
end $$;

create function house_loan_issue(p_player uuid, p_amount int, p_note text default null, p_idem text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare t uuid; mx int; pct int; owed int;
begin
  perform house_need(); t := house_dup(p_idem); if t is not null then return house_ref(t); end if;
  select loan_max, loan_interest into mx, pct from house_config;
  if p_amount <= 0 or p_amount > mx then raise exception 'Loans are between 1 and % HT', mx; end if;
  if not exists (select 1 from house_players where id = p_player and active) then raise exception 'Unknown player'; end if;
  if exists (select 1 from house_tx x join house_lines l on l.tx_id = x.id where x.kind = 'loan_issue' and l.player_id = p_player and not exists (select 1 from house_tx r where r.reverses = x.id))
    then raise exception 'This player has already taken their emergency loan'; end if;
  owed := p_amount + ceil(p_amount * pct / 100.0)::int;
  t := house_post('loan_issue', null, p_note, jsonb_build_object('amount', p_amount, 'owed', owed), p_idem, jsonb_build_array(
    jsonb_build_object('account','player','player',p_player,'cash',p_amount,'loan',owed), jsonb_build_object('account','bank','cash',-p_amount)));
  return house_ref(t);
end $$;

create function house_loan_repay(p_player uuid, p_amount int, p_note text default null, p_idem text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare t uuid; ln int;
begin
  perform house_need(); t := house_dup(p_idem); if t is not null then return house_ref(t); end if;
  if p_amount <= 0 then raise exception 'Amount must be more than zero'; end if;
  select loan into ln from house_players where id = p_player and active; if not found then raise exception 'Unknown player'; end if;
  if p_amount > ln then raise exception 'The outstanding loan is only % HT', ln; end if;
  t := house_post('loan_repay', null, p_note, jsonb_build_object('amount', p_amount), p_idem, jsonb_build_array(
    jsonb_build_object('account','player','player',p_player,'cash',-p_amount,'loan',-p_amount), jsonb_build_object('account','bank','cash',p_amount)));
  return house_ref(t);
end $$;

create function house_reverse(p_tx uuid, p_note text default null, p_idem text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare t uuid; o house_tx%rowtype; lines jsonb;
begin
  perform house_need(true); t := house_dup(p_idem); if t is not null then return house_ref(t); end if;
  select * into o from house_tx where id = p_tx; if not found then raise exception 'Transaction not found'; end if;
  if o.kind in ('reversal','start') then raise exception 'This entry cannot be reversed'; end if;
  if exists (select 1 from house_tx where reverses = p_tx) then raise exception 'This transaction was already reversed'; end if;
  select jsonb_agg(jsonb_build_object('account', account, 'player', player_id, 'cash', -cash_delta, 'loan', -loan_delta) order by id) into lines from house_lines where tx_id = p_tx;
  t := house_post('reversal', o.game_id, coalesce(nullif(trim(p_note), ''), 'Reversal of #' || o.seq), jsonb_build_object('reverses', p_tx, 'orig_kind', o.kind), p_idem, lines, p_tx);
  return house_ref(t);
end $$;

-- Games -----------------------------------------------------------------------------------------
create function house_default_games() returns void language sql security definer set search_path=public as $$
  insert into house_games(name, kind, odds_num, odds_den, min_bet, max_bet, entry_fee, sort) values
  ('Flip 7','pot',1,1,0,null,50,1), ('Blackjack','house',1,1,10,200,0,2), ('Least Count','pot',1,1,0,null,50,3), ('Exploding Kittens','pot',1,1,0,null,50,4),
  ('Fishbowl','reward',1,1,0,null,0,5), ('Telephone Pictionary','reward',1,1,0,null,0,6), ('Who Am I?','reward',1,1,0,null,0,7), ('Would You Rather?','reward',1,1,0,null,0,8),
  ('Lucky Draw','pot',1,1,0,null,20,9), ('Double or Nothing','house',1,1,10,100,0,10), ('Custom Game','house',1,1,0,null,0,11) on conflict (name) do nothing $$;
select house_default_games();

create function house_game_status(p_game uuid, p_status text) returns void language plpgsql security definer set search_path=public as $$
begin perform house_need(); if p_status not in ('pending','active','completed') then raise exception 'Bad status'; end if; update house_games set status = p_status where id = p_game; end $$;
create function house_game_set(p_game uuid, p_odds_num int, p_odds_den int, p_min int, p_max int, p_fee int, p_name text default null) returns void language plpgsql security definer set search_path=public as $$
begin perform house_need(true);
  update house_games set odds_num = p_odds_num, odds_den = p_odds_den, min_bet = coalesce(p_min, 0), max_bet = p_max, entry_fee = coalesce(p_fee, 0), name = coalesce(nullif(trim(p_name), ''), name) where id = p_game; end $$;
create function house_game_add(p_name text, p_kind text) returns void language plpgsql security definer set search_path=public as $$
begin perform house_need(true); insert into house_games(name, kind, sort) values (trim(p_name), p_kind, (select coalesce(max(sort), 0) + 1 from house_games)); end $$;
create function house_result(p_game uuid, p_winners uuid[], p_note text default null) returns void language plpgsql security definer set search_path=public as $$
declare st text;
begin perform house_need(); select status into st from house_config;
  if st in ('closing','closed') then raise exception 'The casino is % - no new results', st; end if;
  insert into house_results(game_id, winners, note, manager_name) values (p_game, coalesce(p_winners, '{}'), nullif(trim(coalesce(p_note, '')), ''), house_actor());
  update house_games set status = 'completed' where id = p_game; end $$;

-- Players (club members) ------------------------------------------------------------------------
create function house_start_bank() returns void language plpgsql security definer set search_path=public as $$
declare f int; p int; t uuid;
begin select bank_float, promo_budget into f, p from house_config;
  if f > 0 then t := house_post('start', null, 'Opening bank float', jsonb_build_object('float', f, 'promo', p), null, jsonb_build_array(
    jsonb_build_object('account','bank','cash', f - least(p, f)), jsonb_build_object('account','promo','cash', least(p, f)))); end if; end $$;

create function house_add_members(p_members uuid[]) returns jsonb language plpgsql security definer set search_path=public as $$
declare m uuid; base int; c text; pin text; pid uuid; nm text; out jsonb := '[]';
begin
  perform house_need(true);
  select coalesce(max(substring(code from 2)::int), 0) into base from house_players;
  foreach m in array coalesce(p_members, '{}') loop
    if exists (select 1 from house_players where member_id = m) then continue; end if;
    select display_name into nm from profiles where id = m; if not found then continue; end if;
    base := base + 1; c := 'P' || lpad(base::text, 2, '0'); pin := lpad(floor(random() * 10000)::int::text, 4, '0');
    insert into house_players(member_id, code) values (m, c) returning id into pid;
    insert into house_pins(player_id, hash) values (pid, house_hash(c, pin));
    out := out || jsonb_build_object('code', c, 'name', nm, 'pin', pin);
  end loop;
  if not exists (select 1 from house_lines where account = 'bank') then perform house_start_bank(); end if;
  return out;
end $$;
create function house_edit_player(p_player uuid, p_active boolean) returns void language plpgsql security definer set search_path=public as $$
begin perform house_need(true); update house_players set active = coalesce(p_active, active) where id = p_player; end $$;
create function house_new_pin(p_player uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare c text; pin text; nm text;
begin perform house_need(true);
  select hp.code, pr.display_name into c, nm from house_players hp join profiles pr on pr.id = hp.member_id where hp.id = p_player; if not found then raise exception 'Unknown player'; end if;
  pin := lpad(floor(random() * 10000)::int::text, 4, '0');
  update house_pins set hash = house_hash(c, pin), fails = 0, locked_until = null where player_id = p_player;
  return jsonb_build_array(jsonb_build_object('code', c, 'name', nm, 'pin', pin)); end $$;
create function house_set_manager(p_user uuid, p_on boolean) returns void language plpgsql security definer set search_path=public as $$
begin perform house_need(true);
  if p_on then
    if (select count(*) from house_staff where user_id <> p_user) >= 2 then raise exception 'Only two bank managers are allowed'; end if;
    insert into house_staff(user_id, name) select id, display_name from profiles where id = p_user on conflict (user_id) do nothing;
  else delete from house_staff where user_id = p_user; end if; end $$;

-- Standings, public board, dashboard ------------------------------------------------------------
create function house_standings() returns table(player_id uuid, member_id uuid, code text, name text, cash int, loan int, net int, change int, tiebreak int, won int, lost int, games int, comeback int, rank int, pos int)
language sql stable security definer set search_path=public as $$
  with eff as (select t.id, t.kind from house_tx t where t.kind in ('pvp','bet','pot','reward') and not exists (select 1 from house_tx r where r.reverses = t.id)),
  per as (select l.player_id, e.kind, sum(l.cash_delta) c from house_lines l join eff e on e.id = l.tx_id where l.account = 'player' group by l.player_id, l.tx_id, e.kind),
  st as (select player_id, coalesce(sum(c) filter (where c > 0), 0)::int won, coalesce(-sum(c) filter (where c < 0), 0)::int lost, (count(*) filter (where kind <> 'reward'))::int games from per group by player_id),
  run as (select l.player_id, sum(l.cash_delta - l.loan_delta) over (partition by l.player_id order by t.seq, l.id) r from house_lines l join house_tx t on t.id = l.tx_id where l.account = 'player'),
  mn as (select player_id, min(r) m from run group by player_id),
  chg as (select player_id, sum(cash_delta - loan_delta)::int c from house_lines where account = 'player' group by player_id),
  base as (select p.id pid, p.member_id mid, p.code cd, pr.display_name nm, house_cash(p.member_id) cash, p.loan loan, p.tiebreak tb from house_players p join profiles pr on pr.id = p.member_id where p.active),
  calc as (select b.*, b.cash - b.loan net, coalesce(chg.c, 0) change, coalesce(st.won, 0) won, coalesce(st.lost, 0) lost, coalesce(st.games, 0) games,
      greatest(coalesce(chg.c, 0) - least(0, coalesce(mn.m, 0)), 0) comeback,
      case when (select rank_by from house_config) = 'net' then b.cash - b.loan else coalesce(chg.c, 0) end score
    from base b left join st on st.player_id = b.pid left join chg on chg.player_id = b.pid left join mn on mn.player_id = b.pid)
  select pid, mid, cd, nm, cash, loan, net, change, tb, won, lost, games, comeback,
    (rank() over (order by score desc, tb desc))::int, (row_number() over (order by score desc, tb desc, won desc, nm))::int from calc $$;

create function house_public() returns jsonb language sql stable security definer set search_path=public as $$
  with s as (select * from house_standings())
  select jsonb_build_object('name', c.name, 'status', c.status, 'rank_by', c.rank_by,
    'board', coalesce((select jsonb_agg(jsonb_build_object('id', player_id, 'rank', rank, 'pos', pos, 'name', name, 'net', net, 'change', change, 'cash', cash, 'loan', loan, 'won', won) order by pos) from s), '[]'),
    'awards', jsonb_build_object('boss', (select name from s where pos = 1), 'silver', (select name from s where pos = 2), 'bronze', (select name from s where pos = 3),
      'disaster', (select name from s where pos = (select max(pos) from s) and (select count(*) from s) > 3),
      'comeback', (select name from s where comeback > 0 order by comeback desc, pos limit 1)),
    'current', coalesce((select jsonb_agg(name order by sort) from house_games where status = 'active'), '[]'),
    'recent', coalesce((select jsonb_agg(x order by x->>'at' desc) from (
        select jsonb_build_object('at', r.created_at, 'game', g.name, 'note', r.note, 'winners', (select string_agg(pr.display_name, ', ') from house_players hp join profiles pr on pr.id = hp.member_id where hp.id = any(r.winners))) x
        from house_results r join house_games g on g.id = r.game_id order by r.created_at desc limit 8) q), '[]'))
  from house_config c $$;

create function house_lookup(p_code text, p_pin text) returns jsonb language plpgsql security definer set search_path=public as $$
declare p house_players%rowtype; pn house_pins%rowtype; s record; nm text; cash int;
begin
  select * into p from house_players where upper(code) = upper(trim(p_code)) and active;
  if not found then return jsonb_build_object('error', 'Player ID or PIN is not right'); end if;
  select * into pn from house_pins where player_id = p.id for update;
  if pn.locked_until is not null and pn.locked_until > now() then return jsonb_build_object('error', 'Too many tries. Wait a minute and try again.'); end if;
  if pn.hash <> house_hash(p.code, trim(p_pin)) then
    update house_pins set fails = case when fails + 1 >= 5 then 0 else fails + 1 end, locked_until = case when fails + 1 >= 5 then now() + interval '1 minute' end where player_id = p.id;
    return jsonb_build_object('error', 'Player ID or PIN is not right');
  end if;
  update house_pins set fails = 0, locked_until = null where player_id = p.id;
  select * into s from house_standings() where player_id = p.id;
  select display_name into nm from profiles where id = p.member_id; cash := house_cash(p.member_id);
  return jsonb_build_object('name', nm, 'code', p.code, 'cash', cash, 'loan', p.loan, 'net', cash - p.loan, 'change', s.change, 'rank', s.rank, 'won', s.won, 'lost', s.lost, 'games', s.games,
    'history', coalesce((select jsonb_agg(jsonb_build_object('seq', t.seq, 'at', t.created_at, 'kind', t.kind, 'game', g.name, 'cash', l.cash_delta, 'loan', l.loan_delta, 'note', t.note) order by t.seq desc)
      from house_lines l join house_tx t on t.id = l.tx_id left join house_games g on g.id = t.game_id where l.player_id = p.id and l.account = 'player'), '[]'));
end $$;

create function house_players_staff() returns jsonb language plpgsql stable security definer set search_path=public as $$
begin perform house_need();
  return coalesce((select jsonb_agg(to_jsonb(s) || jsonb_build_object('loan_taken', exists (select 1 from house_tx t join house_lines l on l.tx_id = t.id where t.kind = 'loan_issue' and l.player_id = s.player_id and not exists (select 1 from house_tx r where r.reverses = t.id))) order by s.pos) from house_standings() s), '[]'); end $$;

create function house_dashboard() returns jsonb language plpgsql stable security definer set search_path=public as $$
declare c house_config%rowtype; r jsonb;
begin
  perform house_need(); select * into c from house_config;
  select jsonb_build_object('name', c.name, 'status', c.status, 'bank', c.bank_balance, 'promo', c.promo_left, 'float', c.bank_float, 'rank_by', c.rank_by,
    'players', (select count(*) from house_players where active), 'circulation', (select coalesce(sum(cash), 0) from house_standings()),
    'loans', (select coalesce(sum(loan), 0) from house_players where active),
    'bets', (select coalesce(sum((t.detail->>'stake')::int), 0) from house_tx t where t.kind = 'bet' and not exists (select 1 from house_tx x where x.reverses = t.id)),
    'payouts', (select coalesce(sum(case t.kind when 'bet' then (t.detail->>'payout')::int when 'pot' then (t.detail->>'paid')::int else (t.detail->>'amount')::int end), 0)
                from house_tx t where t.kind in ('bet','pot','reward') and not exists (select 1 from house_tx x where x.reverses = t.id)),
    'games_done', (select count(*) from house_games where status = 'completed'),
    'richest', (select jsonb_build_object('name', name, 'net', net) from house_standings() order by net desc limit 1),
    'poorest', (select jsonb_build_object('name', name, 'net', net) from house_standings() order by net asc limit 1),
    'profit', c.bank_balance + (select coalesce(sum(loan), 0) from house_players where active) - c.bank_float,
    'count', (select jsonb_build_object('counted', counted, 'at', created_at, 'by', manager_name) from house_cash_counts order by id desc limit 1),
    'winner', (select pr.display_name from house_players hp join profiles pr on pr.id = hp.member_id where hp.id = c.winner_id)) into r;
  return r;
end $$;

create function house_count_cash(p_counted int, p_note text default null) returns void language plpgsql security definer set search_path=public as $$
begin perform house_need(); insert into house_cash_counts(counted, note, manager_name) values (p_counted, nullif(trim(coalesce(p_note, '')), ''), house_actor()); end $$;

create function house_history(p_player uuid default null, p_game uuid default null, p_kind text default null, p_from timestamptz default null, p_to timestamptz default null, p_mgr text default null, p_limit int default 300)
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin perform house_need();
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.seq desc) from (
    select t.seq, t.id, t.created_at, t.kind, t.note, t.manager_name, g.name game, t.detail,
      exists (select 1 from house_tx r where r.reverses = t.id) reversed, (t.reverses is not null) is_reversal,
      (select jsonb_agg(jsonb_build_object('account', l.account, 'name', pr.display_name, 'cash', l.cash_delta, 'loan', l.loan_delta) order by l.id)
         from house_lines l left join house_players hp on hp.id = l.player_id left join profiles pr on pr.id = hp.member_id where l.tx_id = t.id) lines
    from house_tx t left join house_games g on g.id = t.game_id
    where (p_game is null or t.game_id = p_game) and (p_kind is null or t.kind = p_kind) and (p_from is null or t.created_at >= p_from) and (p_to is null or t.created_at <= p_to)
      and (p_mgr is null or t.manager_name = p_mgr) and (p_player is null or exists (select 1 from house_lines l where l.tx_id = t.id and l.player_id = p_player))
    order by t.seq desc limit p_limit) x), '[]');
end $$;

-- Lifecycle, settings, backup, reset ------------------------------------------------------------
create function house_status(p_to text) returns void language plpgsql security definer set search_path=public as $$
declare cur text; w uuid; r record; pay int;
begin
  perform house_need(true); select status into cur from house_config;
  if not ((cur = 'setup' and p_to = 'ready') or (cur = 'ready' and p_to in ('open','setup')) or (cur = 'open' and p_to = 'closing') or (cur = 'closing' and p_to in ('open','closed')))
    then raise exception 'Cannot go from % to %', cur, p_to; end if;
  if p_to = 'open' and (select count(*) from house_players where active) = 0 then raise exception 'Add players first'; end if;
  if p_to = 'closed' then
    -- Outstanding loans are paid from wallets as far as possible, so final cash and net worth are exact.
    perform set_config('house.settle', '1', true);
    for r in select hp.id, hp.member_id, hp.loan from house_players hp where hp.active and hp.loan > 0 loop
      pay := least(house_cash(r.member_id), r.loan);
      if pay > 0 then perform house_post('settle', null, 'Loan settlement at close', jsonb_build_object('paid', pay, 'owed', r.loan), null, jsonb_build_array(
        jsonb_build_object('account','player','player',r.id,'cash',-pay,'loan',-pay), jsonb_build_object('account','bank','cash',pay))); end if;
    end loop;
    perform set_config('house.settle', '0', true);
    select player_id into w from house_standings() order by pos limit 1; update house_config set winner_id = w;
  end if;
  update house_config set status = p_to;
end $$;
create function house_tiebreak(p_player uuid, p_value int, p_note text default null) returns void language plpgsql security definer set search_path=public as $$
begin perform house_need(true);
  if (select status from house_config) <> 'closing' then raise exception 'Tie-breakers can be recorded while the casino is closing'; end if;
  update house_players set tiebreak = p_value where id = p_player;
  update house_config set tiebreak_note = coalesce(nullif(trim(p_note), ''), tiebreak_note); end $$;
create function house_config_set(p_name text, p_float int, p_promo int, p_loan int, p_interest int, p_rank_by text) returns void language plpgsql security definer set search_path=public as $$
begin perform house_need(true);
  if (select status from house_config) not in ('setup','ready') then raise exception 'Settings can only be changed before the casino opens'; end if;
  if p_promo > p_float then raise exception 'The promotional budget must fit inside the bank float'; end if;
  update house_config set name = coalesce(nullif(trim(p_name), ''), name), bank_float = p_float, promo_budget = p_promo, loan_max = p_loan, loan_interest = p_interest, rank_by = p_rank_by;
end $$;

create function house_backup() returns jsonb language plpgsql stable security definer set search_path=public as $$
begin perform house_need(true);
  return jsonb_build_object('created_at', now(), 'config', (select to_jsonb(c) from house_config c),
    'players', (select coalesce(jsonb_agg(to_jsonb(p) || jsonb_build_object('name', (select display_name from profiles where id = p.member_id), 'wallet_balance', house_cash(p.member_id))), '[]') from house_players p),
    'games', (select coalesce(jsonb_agg(to_jsonb(g)), '[]') from house_games g),
    'transactions', (select coalesce(jsonb_agg(to_jsonb(t) order by t.seq), '[]') from house_tx t), 'lines', (select coalesce(jsonb_agg(to_jsonb(l) order by l.id), '[]') from house_lines l),
    'results', (select coalesce(jsonb_agg(to_jsonb(r)), '[]') from house_results r), 'cash_counts', (select coalesce(jsonb_agg(to_jsonb(k)), '[]') from house_cash_counts k));
end $$;

-- If the casino was never closed (rehearsal), the HT it moved is returned to wallets. A closed night keeps its results in wallets.
create function house_reset(p_mode text, p_confirm text, p_override boolean default false) returns void language plpgsql security definer set search_path=public as $$
declare st text; r record; final_status text;
begin
  perform house_need(true);
  if p_confirm is distinct from 'RESET' then raise exception 'Type RESET to confirm'; end if;
  if p_mode not in ('prep','demo','full') then raise exception 'Unknown reset mode'; end if;
  select status into st from house_config;
  if st in ('open','closing') and not coalesce(p_override, false) then raise exception 'The casino is running. Tick the override box to reset anyway.'; end if;
  insert into house_archive(mode, created_by, data) values (p_mode, house_actor(), house_backup());
  final_status := case p_mode when 'full' then 'setup' when 'prep' then 'ready' else st end;
  if st <> 'closed' then
    for r in select hp.member_id, sum(l.cash_delta)::int s from house_lines l join house_players hp on hp.id = l.player_id where l.account = 'player' group by hp.member_id having sum(l.cash_delta) <> 0 loop
      insert into transactions(member_id, amount, reason, created_by) values (r.member_id, -r.s, 'Casino reset: casino tokens returned', auth.uid());
    end loop;
  end if;
  perform set_config('house.reset', '1', true);
  delete from house_lines; delete from house_results; delete from house_cash_counts; delete from house_tx;
  perform set_config('house.reset', '0', true);
  if p_mode = 'full' then
    delete from house_pins; delete from house_players; delete from house_games;
    update house_config set name = 'THE HOUSE', bank_float = 5000, promo_budget = 1000, loan_max = 100, loan_interest = 0, rank_by = 'change';
    perform house_default_games();
  else update house_games set status = 'pending'; update house_players set tiebreak = 0; end if;
  update house_players set loan = 0;
  update house_config set bank_balance = 0, promo_left = 0, winner_id = null, tiebreak_note = null, status = 'setup';
  perform house_start_bank();
  update house_config set status = final_status;
end $$;

create function house_demo() returns void language plpgsql security definer set search_path=public as $$
declare p uuid[]; bj uuid; fl uuid; fb uuid;
begin
  perform house_need(true);
  select array_agg(id order by code) into p from (select id, code from house_players where active order by code limit 6) x;
  if coalesce(array_length(p, 1), 0) < 4 then raise exception 'Add at least 4 players first'; end if;
  select id into bj from house_games where name = 'Blackjack'; select id into fl from house_games where name = 'Flip 7'; select id into fb from house_games where name = 'Fishbowl';
  perform house_bet(p[1], bj, 50, 'win', 'Demo'); perform house_bet(p[2], bj, 100, 'loss', 'Demo'); perform house_bet(p[3], bj, 20, 'push', 'Demo');
  perform house_pvp(p[1], p[2], 30, null, 'Demo side bet');
  perform house_pot(fl, jsonb_build_array(jsonb_build_object('player', p[1], 'fee', 50), jsonb_build_object('player', p[2], 'fee', 50), jsonb_build_object('player', p[3], 'fee', 50), jsonb_build_object('player', p[4], 'fee', 50)),
    jsonb_build_array(jsonb_build_object('player', p[4], 'amount', 200)), 'Demo pot');
  perform house_reward(p[2], 50, fb, 'Demo reward');
  perform house_loan_issue(p[3], 100, 'Demo loan'); perform house_loan_repay(p[3], 40, 'Demo repayment');
  perform house_result(fl, array[p[4]], 'Demo round'); update house_games set status = 'active' where name = 'Blackjack';
end $$;

create function house_verify() returns jsonb language plpgsql stable security definer set search_path=public as $$
begin perform house_need();
  return (select jsonb_build_object(
    'wallet_ok', not exists (select 1 from (select hp.member_id, sum(l.cash_delta) s from house_lines l join house_players hp on hp.id = l.player_id where l.account = 'player' group by hp.member_id) a
        full join (select t.member_id, sum(t.amount) s from transactions t join house_tx x on x.id = t.house_tx group by t.member_id) b using (member_id) where coalesce(a.s, 0) <> coalesce(b.s, 0)),
    'loan_ok', (select coalesce(sum(loan), 0) from house_players) = (select coalesce(sum(loan_delta), 0) from house_lines where account = 'player'),
    'bank_ok', c.bank_balance = (select coalesce(sum(cash_delta), 0) from house_lines where account in ('bank','promo')),
    'promo_ok', c.promo_left = (select coalesce(sum(cash_delta), 0) from house_lines where account = 'promo')) from house_config c);
end $$;

do $$ declare t text; begin
  foreach t in array array['house_config','house_players','house_games','house_staff','house_tx','house_lines','house_results','house_cash_counts'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy "staff read" on %I for select to authenticated using (house_role() is not null)', t);
  end loop;
  foreach t in array array['house_pins','house_archive'] loop execute format('alter table %I enable row level security', t); end loop;
end $$;
create policy "super read" on house_archive for select to authenticated using (house_role() = 'super');

do $$ declare f record; begin
  for f in select p.oid::regprocedure sig, p.proname from pg_proc p where p.proname like 'house\_%' and p.pronamespace = 'public'::regnamespace loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    if f.proname not in ('house_post','house_dup','house_ref','house_hash','house_actor','house_need','house_standings','house_default_games','house_immutable','house_start_bank','house_cash') then
      execute format('grant execute on function %s to authenticated', f.sig); end if;
    if f.proname in ('house_public','house_lookup') then execute format('grant execute on function %s to anon', f.sig); end if;
  end loop;
end $$;
