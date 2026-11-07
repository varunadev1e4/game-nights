-- Run after 002_full.sql. Indexes, faster RLS, realtime, audit/undo, RSVP, bets, shop, votes, rivals, scores.
create index on results(member_id); create index on results(event_game_id);
create index on transactions(member_id, created_at desc); create index on seats(member_id); create index on events(starts_at);
alter table transactions add column result_id uuid references results on delete cascade;
alter table profiles add column rival_id uuid references profiles on delete set null;

do $$ declare t text; begin
  foreach t in array array['profiles','games','seasons','events','event_games','seats','results','transactions','achievements','member_achievements'] loop
    execute format('drop policy "admin write" on %I', t);
    execute format('create policy "admin write" on %I for all to authenticated using ((select is_admin())) with check ((select is_admin()))', t);
  end loop; end $$;

create table rsvps(event_id uuid references events on delete cascade, member_id uuid references profiles on delete cascade, status text check (status in ('in','out','maybe')), primary key(event_id, member_id));
create table scores(id uuid primary key default gen_random_uuid(), event_game_id uuid references event_games on delete cascade, member_id uuid references profiles on delete cascade, round int not null, score int not null);
create table bets(id uuid primary key default gen_random_uuid(), event_game_id uuid references event_games on delete cascade, member_id uuid references profiles on delete cascade, pick_id uuid references profiles, stake int not null check (stake>0), status text not null default 'open', payout int default 0, created_at timestamptz default now());
create table shop_items(id uuid primary key default gen_random_uuid(), name text not null, description text, cost int not null check (cost>0), active boolean default true);
create table purchases(id uuid primary key default gen_random_uuid(), member_id uuid references profiles on delete cascade, item_id uuid references shop_items, created_at timestamptz default now(), fulfilled boolean default false);
create table game_votes(member_id uuid primary key references profiles on delete cascade, game_id uuid references games on delete cascade);
create table audit_log(id bigserial primary key, actor uuid default auth.uid(), tbl text, op text, detail jsonb, created_at timestamptz default now());
do $$ declare t text; begin
  foreach t in array array['rsvps','scores','bets','shop_items','purchases','game_votes'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy "members read" on %I for select to authenticated using (true)', t);
    execute format('create policy "admin write" on %I for all to authenticated using ((select is_admin())) with check ((select is_admin()))', t);
  end loop; end $$;
alter table audit_log enable row level security;
create policy "admin only" on audit_log for all to authenticated using ((select is_admin())) with check ((select is_admin()));

create function log_change() returns trigger language plpgsql security definer set search_path=public as $$
begin insert into audit_log(tbl,op,detail) values(tg_table_name,tg_op,to_jsonb(coalesce(new,old))); return null; end $$;
create trigger audit_tx after insert or delete on transactions for each row execute function log_change();
create trigger audit_res after insert or delete on results for each row execute function log_change();

create or replace function record_result(p_eg uuid,p_member uuid,p_pos int,p_points int,p_ht int default null) returns void language plpgsql security definer set search_path=public as $$
declare r jsonb; ht int; w int; rid uuid;
begin
  if not is_admin() then raise exception 'admin only'; end if;
  select g.token_rules into r from event_games eg join games g on g.id=eg.game_id where eg.id=p_eg;
  ht := coalesce(p_ht, case p_pos when 1 then (r->>'win')::int when 2 then (r->>'second')::int when 3 then (r->>'third')::int else (r->>'participation')::int end);
  insert into results(event_game_id,member_id,position,points,ht_delta) values(p_eg,p_member,p_pos,p_points,ht) returning id into rid;
  if ht <> 0 then insert into transactions(member_id,amount,reason,event_game_id,created_by,result_id) values(p_member,ht,'Game result',p_eg,auth.uid(),rid); end if;
  select count(*) into w from results where member_id=p_member and position=1;
  insert into member_achievements(member_id,achievement_id) select p_member,id from achievements
    where (code='first-victory' and w>=1) or (code='lucky-seven' and w>=7) or (code='card-shark' and w>=10) on conflict do nothing;
end $$;

create function record_table(p_eg uuid, p_rows jsonb) returns void language plpgsql security definer set search_path=public as $$
declare e jsonb;
begin for e in select * from jsonb_array_elements(p_rows) loop
  perform record_result(p_eg,(e->>'member')::uuid,(e->>'pos')::int,(e->>'pts')::int); end loop; end $$;

create function place_bet(p_eg uuid,p_pick uuid,p_stake int) returns void language plpgsql security definer set search_path=public as $$
declare bal int;
begin
  if p_stake<=0 then raise exception 'Bad stake'; end if;
  if exists(select 1 from results where event_game_id=p_eg) then raise exception 'Table already finished'; end if;
  select coalesce(sum(amount),0) into bal from transactions where member_id=auth.uid();
  if bal<p_stake then raise exception 'Not enough HT'; end if;
  insert into bets(event_game_id,member_id,pick_id,stake) values(p_eg,auth.uid(),p_pick,p_stake);
  insert into transactions(member_id,amount,reason,event_game_id) values(auth.uid(),-p_stake,'Side bet',p_eg);
end $$;

create function settle_bets(p_eg uuid,p_winner uuid) returns void language plpgsql security definer set search_path=public as $$
declare pool int; wpool int;
begin
  if not is_admin() then raise exception 'admin only'; end if;
  select coalesce(sum(stake),0), coalesce(sum(stake) filter (where pick_id=p_winner),0) into pool,wpool from bets where event_game_id=p_eg and status='open';
  if wpool=0 then
    insert into transactions(member_id,amount,reason,event_game_id,created_by) select member_id,stake,'Bet refund',p_eg,auth.uid() from bets where event_game_id=p_eg and status='open';
    update bets set status='void', payout=stake where event_game_id=p_eg and status='open';
  else
    insert into transactions(member_id,amount,reason,event_game_id,created_by) select member_id,stake*pool/wpool,'Bet won',p_eg,auth.uid() from bets where event_game_id=p_eg and status='open' and pick_id=p_winner;
    update bets set payout=case when pick_id=p_winner then stake*pool/wpool else 0 end, status=case when pick_id=p_winner then 'won' else 'lost' end where event_game_id=p_eg and status='open';
  end if;
end $$;

create function buy_item(p_item uuid) returns void language plpgsql security definer set search_path=public as $$
declare bal int; c int; n text;
begin
  select cost,name into c,n from shop_items where id=p_item and active;
  if c is null then raise exception 'Item unavailable'; end if;
  select coalesce(sum(amount),0) into bal from transactions where member_id=auth.uid();
  if bal<c then raise exception 'Not enough HT'; end if;
  insert into purchases(member_id,item_id) values(auth.uid(),p_item);
  insert into transactions(member_id,amount,reason) values(auth.uid(),-c,'Shop: '||n);
end $$;

create function set_rsvp(p_event uuid,p_status text) returns void language sql security definer set search_path=public as $$
  insert into rsvps values(p_event,auth.uid(),p_status) on conflict (event_id,member_id) do update set status=excluded.status $$;
create function vote_game(p_game uuid) returns void language sql security definer set search_path=public as $$
  insert into game_votes values(auth.uid(),p_game) on conflict (member_id) do update set game_id=excluded.game_id $$;
create function set_rival(p_id uuid) returns void language sql security definer set search_path=public as $$
  update profiles set rival_id=p_id where id=auth.uid() and p_id<>auth.uid() $$;
create function award_attendance(p_event uuid,p_ht int) returns void language plpgsql security definer set search_path=public as $$
begin if not is_admin() then raise exception 'admin only'; end if;
  insert into transactions(member_id,amount,reason,created_by) select member_id,p_ht,'Attendance bonus',auth.uid() from rsvps where event_id=p_event and status='in'; end $$;

alter publication supabase_realtime add table transactions, results, seats, events, event_games, rsvps, scores, bets;
