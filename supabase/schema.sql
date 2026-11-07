-- Run in Supabase SQL editor. Then: Auth > Providers > Email > turn OFF "Allow new users to sign up".
-- Create members in Auth > Users (Add user). Make yourself admin:
--   update profiles set is_admin = true where id = (select id from auth.users where email = 'you@example.com');
create table profiles(id uuid primary key references auth.users on delete cascade, display_name text not null, avatar text, is_admin boolean not null default false);
create table games(id uuid primary key default gen_random_uuid(), name text unique not null, description text, min_players int, max_players int, duration_min int);
create table seasons(id uuid primary key default gen_random_uuid(), name text not null, starts_on date not null default current_date, is_active boolean not null default false);
create table events(id uuid primary key default gen_random_uuid(), name text not null, description text, venue text, starts_at timestamptz not null, announcement text,
  status text not null default 'upcoming' check (status in ('upcoming','live','completed','cancelled')));
create table event_games(id uuid primary key default gen_random_uuid(), event_id uuid not null references events on delete cascade, game_id uuid not null references games, table_label text not null default 'T1', starts_at timestamptz);
create table seats(event_game_id uuid references event_games on delete cascade, member_id uuid references profiles on delete cascade, primary key(event_game_id, member_id));
create table results(id uuid primary key default gen_random_uuid(), event_game_id uuid not null references event_games on delete cascade, member_id uuid not null references profiles, position int, points int not null default 0, ht_delta int not null default 0);
create table transactions(id uuid primary key default gen_random_uuid(), member_id uuid not null references profiles on delete cascade, amount int not null, reason text not null, event_game_id uuid references event_games on delete set null, created_by uuid, created_at timestamptz not null default now());

create function is_admin() returns boolean language sql security definer stable set search_path=public as $$ select coalesce((select is_admin from profiles where id=auth.uid()),false) $$;

create function handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into profiles(id,display_name) values(new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email,'@',1)));
  insert into transactions(member_id,amount,reason) values(new.id,1000,'Welcome bonus');
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();

create function record_result(p_eg uuid,p_member uuid,p_pos int,p_points int,p_ht int) returns void language plpgsql security definer set search_path=public as $$
begin
  if not is_admin() then raise exception 'admin only'; end if;
  insert into results(event_game_id,member_id,position,points,ht_delta) values(p_eg,p_member,p_pos,p_points,p_ht);
  if p_ht <> 0 then insert into transactions(member_id,amount,reason,event_game_id,created_by) values(p_member,p_ht,'Game result',p_eg,auth.uid()); end if;
end $$;

-- Balance is always computed from the ledger and never reset (seasons only affect points).
create view wallet with (security_invoker=true) as
select p.id member_id, p.display_name, coalesce(sum(t.amount),0) balance,
  coalesce(sum(t.amount) filter (where t.amount>0),0) earned, coalesce(-sum(t.amount) filter (where t.amount<0),0) spent
from profiles p left join transactions t on t.member_id=p.id group by p.id;

create view leaderboard with (security_invoker=true) as
select w.member_id, w.display_name, w.balance, count(r.id) games_played, count(r.id) filter (where r.position=1) wins,
  coalesce(sum(r.points) filter (where e.starts_at >= (select starts_on from seasons where is_active limit 1)),0) season_points
from wallet w left join results r on r.member_id=w.member_id
left join event_games eg on eg.id=r.event_game_id left join events e on e.id=eg.event_id
group by w.member_id, w.display_name, w.balance;

do $$ declare t text; begin
  foreach t in array array['profiles','games','seasons','events','event_games','seats','results','transactions'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy "members read" on %I for select to authenticated using (true)', t);
    execute format('create policy "admin write" on %I for all to authenticated using (is_admin()) with check (is_admin())', t);
  end loop; end $$;

insert into seasons(name,is_active) values('Season 1',true);
insert into games(name,description,min_players,max_players,duration_min) values
('Flip 7','Push your luck: flip cards, never repeat a number, reach 200.',3,18,30),
('Exploding Kittens','Draw cards, avoid the kitten, last player standing wins.',2,5,15),
('Blackjack','Beat the dealer to 21 without busting.',2,7,45),
('In Between','Bet whether the next card falls between two others.',3,8,30),
('Least Count','Shed cards and finish with the lowest hand total.',2,8,40),
('5 Alive','Lose lives each round; last player alive wins.',2,8,30);
