-- Run once after schema.sql. Adds token rules, seasons history, achievements, head-to-head, profile editing.
alter table games add column token_rules jsonb not null default '{"win":100,"second":50,"third":25,"participation":10}';
alter table seasons add column ends_on date;
create table achievements(id uuid primary key default gen_random_uuid(), code text unique not null, name text not null, icon text, description text);
create table member_achievements(member_id uuid references profiles on delete cascade, achievement_id uuid references achievements on delete cascade, awarded_at timestamptz default now(), primary key(member_id, achievement_id));
do $$ declare t text; begin
  foreach t in array array['achievements','member_achievements'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy "members read" on %I for select to authenticated using (true)', t);
    execute format('create policy "admin write" on %I for all to authenticated using (is_admin()) with check (is_admin())', t);
  end loop; end $$;
insert into achievements(code,name,icon,description) values
('first-victory','First Victory','🥇','Win your first game'),('lucky-seven','Lucky Seven','🍀','Win 7 games'),
('card-shark','Card Shark','🦈','Win 10 games'),('comeback-king','Comeback King','👑','Win after being last (admin awarded)'),
('blackjack-specialist','Blackjack Specialist','🃏','Dominate the Blackjack table (admin awarded)'),
('most-unlucky','Most Unlucky Player','🌧️','Season of rotten luck (admin awarded)'),('most-active','Most Active Member','🔥','Never misses a night (admin awarded)');

drop function record_result(uuid,uuid,int,int,int);
create function record_result(p_eg uuid,p_member uuid,p_pos int,p_points int,p_ht int default null) returns void language plpgsql security definer set search_path=public as $$
declare r jsonb; ht int; w int;
begin
  if not is_admin() then raise exception 'admin only'; end if;
  select g.token_rules into r from event_games eg join games g on g.id=eg.game_id where eg.id=p_eg;
  ht := coalesce(p_ht, case p_pos when 1 then (r->>'win')::int when 2 then (r->>'second')::int when 3 then (r->>'third')::int else (r->>'participation')::int end);
  insert into results(event_game_id,member_id,position,points,ht_delta) values(p_eg,p_member,p_pos,p_points,ht);
  if ht <> 0 then insert into transactions(member_id,amount,reason,event_game_id,created_by) values(p_member,ht,'Game result',p_eg,auth.uid()); end if;
  select count(*) into w from results where member_id=p_member and position=1;
  insert into member_achievements(member_id,achievement_id) select p_member,id from achievements
    where (code='first-victory' and w>=1) or (code='lucky-seven' and w>=7) or (code='card-shark' and w>=10) on conflict do nothing;
end $$;

create function update_my_profile(p_name text,p_avatar text) returns void language sql security definer set search_path=public as $$
  update profiles set display_name=p_name, avatar=p_avatar where id=auth.uid() $$;
create function set_active_season(p_id uuid) returns void language plpgsql security definer set search_path=public as $$
begin if not is_admin() then raise exception 'admin only'; end if;
  update seasons set is_active=false, ends_on=current_date where is_active and id<>p_id;
  update seasons set is_active=true, starts_on=current_date, ends_on=null where id=p_id; end $$;
create function close_season() returns void language plpgsql security definer set search_path=public as $$
begin if not is_admin() then raise exception 'admin only'; end if;
  update seasons set is_active=false, ends_on=current_date where is_active; end $$;

drop view leaderboard;
create view leaderboard with (security_invoker=true) as
select w.member_id, w.display_name, p.avatar, w.balance, count(r.id) games_played, count(r.id) filter (where r.position=1) wins,
  case when count(r.id)=0 then 0 else round(100.0*count(r.id) filter (where r.position=1)/count(r.id)) end win_rate,
  round(stddev_pop(r.position),2) consistency, count(distinct eg.event_id) events_attended,
  coalesce(sum(r.points) filter (where e.starts_at::date >= (select starts_on from seasons where is_active limit 1)),0) season_points
from wallet w join profiles p on p.id=w.member_id left join results r on r.member_id=w.member_id
left join event_games eg on eg.id=r.event_game_id left join events e on e.id=eg.event_id
group by w.member_id, w.display_name, p.avatar, w.balance;

create view season_board with (security_invoker=true) as
select s.id season_id, s.name season_name, p.id member_id, p.display_name, coalesce(sum(r.points),0) points
from seasons s cross join profiles p
left join results r on r.member_id=p.id and exists(select 1 from event_games eg join events e on e.id=eg.event_id
  where eg.id=r.event_game_id and e.starts_at::date>=s.starts_on and (s.ends_on is null or e.starts_at::date<=s.ends_on))
group by s.id, s.name, p.id, p.display_name;

create view h2h with (security_invoker=true) as
select a.member_id, b.member_id opp_id, count(*) played, count(*) filter (where a.position < b.position) won
from results a join results b on a.event_game_id=b.event_game_id and a.member_id<>b.member_id group by 1,2;
