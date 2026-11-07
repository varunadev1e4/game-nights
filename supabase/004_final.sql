-- Run after 003_upgrade.sql. Streak bonus, tournaments, photo gallery, cached leaderboard.
alter table results add column created_at timestamptz not null default clock_timestamp();
create function streak_bonus() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.position=1 and (select count(*) from (select position from results where member_id=new.member_id order by created_at desc limit 3) x where position=1)=3
  then insert into transactions(member_id,amount,reason) values(new.member_id,50,'Win streak bonus'); end if;
  return null; end $$;
create trigger results_streak after insert on results for each row execute function streak_bonus();

create table tournaments(id uuid primary key default gen_random_uuid(), event_id uuid references events on delete set null, name text not null, created_at timestamptz default now());
create table tournament_matches(id uuid primary key, tournament_id uuid references tournaments on delete cascade, round int not null, slot int not null,
  p1 uuid references profiles, p2 uuid references profiles, winner uuid references profiles, next_id uuid, next_slot text);
do $$ declare t text; begin
  foreach t in array array['tournaments','tournament_matches'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy "members read" on %I for select to authenticated using (true)', t);
    execute format('create policy "admin write" on %I for all to authenticated using ((select is_admin())) with check ((select is_admin()))', t);
  end loop; end $$;

create table photos(id uuid primary key default gen_random_uuid(), event_id uuid references events on delete cascade, member_id uuid not null default auth.uid() references profiles, path text not null, caption text, created_at timestamptz default now());
alter table photos enable row level security;
create policy "read" on photos for select to authenticated using (true);
create policy "own insert" on photos for insert to authenticated with check (member_id = auth.uid());
create policy "own or admin delete" on photos for delete to authenticated using (member_id = auth.uid() or (select is_admin()));
insert into storage.buckets(id,name,public) values('photos','photos',true) on conflict do nothing;
create policy "photo upload" on storage.objects for insert to authenticated with check (bucket_id='photos');
create policy "photo delete" on storage.objects for delete to authenticated using (bucket_id='photos' and (owner = auth.uid() or (select is_admin())));

-- Cached leaderboard: refreshed whenever results, transactions, seasons or profiles change.
create materialized view lb_cache as select * from leaderboard;
create unique index on lb_cache(member_id);
revoke all on lb_cache from anon; grant select on lb_cache to authenticated;
create function refresh_lb() returns trigger language plpgsql security definer set search_path=public as $$
begin refresh materialized view lb_cache; return null; end $$;
create trigger lb_r1 after insert or update or delete on results for each statement execute function refresh_lb();
create trigger lb_r2 after insert or update or delete on transactions for each statement execute function refresh_lb();
create trigger lb_r3 after insert or update or delete on seasons for each statement execute function refresh_lb();
create trigger lb_r4 after insert or update or delete on profiles for each statement execute function refresh_lb();

alter publication supabase_realtime add table tournament_matches, photos;
