-- Run once after 004_final.sql.
-- 1) Admin roles (owner can promote/demote), 2) attendance marked by admin, 3) funny achievements + titles.

alter table profiles add column is_owner boolean not null default false;
alter table profiles add column title text;
update profiles set is_owner = true where is_admin;   -- whoever is admin right now becomes the owner

create function guard_admin_flags() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null then return new; end if;   -- SQL editor / service role
  if new.is_owner is distinct from old.is_owner then raise exception 'Owner cannot be changed here'; end if;
  if new.is_admin is distinct from old.is_admin and not coalesce((select is_owner from profiles where id=auth.uid()),false) then
    raise exception 'Only the owner can change admin roles'; end if;
  return new;
end $$;
create trigger guard_admin before update on profiles for each row execute function guard_admin_flags();

create function set_admin(p_id uuid, p_admin boolean) returns void language plpgsql security definer set search_path=public as $$
begin
  if not coalesce((select is_owner from profiles where id=auth.uid()),false) then raise exception 'Only the owner can change admin roles'; end if;
  if p_id = auth.uid() then raise exception 'You cannot change your own role'; end if;
  update profiles set is_admin = p_admin where id = p_id;
end $$;

-- Attendance: the bonus is paid only to members the admin marked present.
create table attendance(event_id uuid references events on delete cascade, member_id uuid references profiles on delete cascade, bonus_paid boolean not null default false, primary key(event_id, member_id));
alter table attendance enable row level security;
create policy "members read" on attendance for select to authenticated using (true);
create policy "admin write" on attendance for all to authenticated using ((select is_admin())) with check ((select is_admin()));
create or replace function award_attendance(p_event uuid, p_ht int) returns void language plpgsql security definer set search_path=public as $$
begin
  if not is_admin() then raise exception 'admin only'; end if;
  insert into transactions(member_id,amount,reason,created_by) select member_id,p_ht,'Attendance bonus',auth.uid() from attendance where event_id=p_event and not bonus_paid;
  update attendance set bonus_paid = true where event_id=p_event and not bonus_paid;
end $$;

-- Titles
create function set_title(p_ach uuid) returns void language plpgsql security definer set search_path=public as $$
begin
  update profiles set title = (select a.name from achievements a join member_achievements m on m.achievement_id=a.id where a.id=p_ach and m.member_id=auth.uid()) where id=auth.uid();
end $$;

-- Achievements
insert into achievements(code,name,description) values
('wooden-spoon','Wooden Spoon','Finish last at a table. Everyone gets one eventually.'),
('professional-victim','Professional Victim','Finish last five times. At this point it is a lifestyle.'),
('participation-trophy','Participation Trophy','Play 10 games without a single win. We are proud of you anyway.'),
('redemption-arc','Redemption Arc','Win right after finishing last. Cue the movie score.'),
('hat-trick','Hat Trick','Win three games in a row. Suspicious.'),
('regular','Regular','Play on 3 different nights. They know your name here.'),
('part-of-the-furniture','Part of the Furniture','Play on 10 different nights. Someone should dust you.'),
('flat-broke','Flat Broke','Hit zero House Tokens. Pride is not legal tender.'),
('moneybags','Moneybags','Hold 5,000 House Tokens. Please stop flexing.'),
('called-it','Called It','Win a side bet. Suspiciously confident.'),
('high-roller','High Roller','Put 500 or more on a single side bet.'),
('donates-to-the-club','Donates to the Club','Lose five side bets. Your generosity is noted.'),
('retail-therapy','Retail Therapy','Buy three things from the shop.'),
('early-bird','Early Bird','First to say "I am in" for a night. Eager much?'),
('democracy-enjoyer','Democracy Enjoyer','Vote for the next game.'),
('poker-face','Poker Face','Revealed nothing, won everything. (Awarded by the host)'),
('chief-bluffer','Chief Bluffer','Lied convincingly. Allegedly. (Awarded by the host)'),
('chaos-agent','Chaos Agent','Ruined everyone''s plan, kitten included. (Awarded by the host)'),
('rules-lawyer','Rules Lawyer','Quoted the rulebook mid-game. (Awarded by the host)'),
('sore-winner','Sore Winner','Won, and still complained. (Awarded by the host)'),
('fashionably-late','Fashionably Late','Arrived after the first shuffle. (Awarded by the host)'),
('snack-champion','Snack Champion','Brought snacks. The real MVP. (Awarded by the host)'),
('table-flipper','Table Flipper','Came very close to flipping the table. (Awarded by the host)'),
('lucky-charm','Lucky Charm','Won on pure luck and zero skill. (Awarded by the host)'),
('host-with-the-most','Host With the Most','Helped run the night. (Awarded by the host)')
on conflict (code) do nothing;

create function grant_ach(p_member uuid, p_code text) returns void language sql security definer set search_path=public as $$
  insert into member_achievements(member_id,achievement_id) select p_member,id from achievements where code=p_code on conflict do nothing $$;
revoke execute on function grant_ach(uuid,text) from public, anon, authenticated;

create view results_ranked with (security_invoker=true) as
select r.*, max(position) over (partition by event_game_id) last_pos, count(*) over (partition by event_game_id) field_size from results r;

create function award_for_table(p_eg uuid) returns void language plpgsql security definer set search_path=public as $$
declare r record; w int; g int; l int; n int; redeem boolean;
begin
  for r in select member_id, position from results where event_game_id=p_eg loop
    select count(*) filter (where position=1), count(*), count(*) filter (where position=last_pos and field_size>1) into w,g,l from results_ranked where member_id=r.member_id;
    select count(distinct eg.event_id) into n from results x join event_games eg on eg.id=x.event_game_id where x.member_id=r.member_id;
    redeem := r.position=1 and coalesce((select p.position=p.last_pos and p.field_size>1 from results_ranked p where p.member_id=r.member_id and p.event_game_id<>p_eg order by p.created_at desc limit 1), false);
    insert into member_achievements(member_id,achievement_id) select r.member_id,id from achievements where
      (code='first-victory' and w>=1) or (code='lucky-seven' and w>=7) or (code='card-shark' and w>=10)
      or (code='wooden-spoon' and l>=1) or (code='professional-victim' and l>=5)
      or (code='participation-trophy' and g>=10 and w=0)
      or (code='regular' and n>=3) or (code='part-of-the-furniture' and n>=10)
      or (code='redemption-arc' and redeem)
    on conflict do nothing;
  end loop;
end $$;
revoke execute on function award_for_table(uuid) from public, anon, authenticated;

create or replace function record_table(p_eg uuid, p_rows jsonb) returns void language plpgsql security definer set search_path=public as $$
declare e jsonb;
begin
  if not is_admin() then raise exception 'admin only'; end if;
  for e in select * from jsonb_array_elements(p_rows) loop
    perform record_result(p_eg,(e->>'member')::uuid,(e->>'pos')::int,(e->>'pts')::int); end loop;
  perform award_for_table(p_eg);
end $$;

create or replace function streak_bonus() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.position=1 and (select count(*) from (select position from results where member_id=new.member_id order by created_at desc limit 3) x where position=1)=3 then
    insert into transactions(member_id,amount,reason) values(new.member_id,50,'Win streak bonus');
    perform grant_ach(new.member_id,'hat-trick');
  end if;
  return null;
end $$;

create function balance_achievements() returns trigger language plpgsql security definer set search_path=public as $$
declare b int;
begin
  select coalesce(sum(amount),0) into b from transactions where member_id=new.member_id;
  if b<=0 then perform grant_ach(new.member_id,'flat-broke'); end if;
  if b>=5000 then perform grant_ach(new.member_id,'moneybags'); end if;
  return null;
end $$;
create trigger tx_achievements after insert on transactions for each row execute function balance_achievements();

create function fun_achievements() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_table_name='bets' then
    if tg_op='INSERT' and new.stake>=500 then perform grant_ach(new.member_id,'high-roller'); end if;
    if tg_op='UPDATE' and new.status='won' then perform grant_ach(new.member_id,'called-it'); end if;
    if tg_op='UPDATE' and new.status='lost' and (select count(*) from bets where member_id=new.member_id and status='lost')>=5 then perform grant_ach(new.member_id,'donates-to-the-club'); end if;
  elsif tg_table_name='purchases' then
    if (select count(*) from purchases where member_id=new.member_id)>=3 then perform grant_ach(new.member_id,'retail-therapy'); end if;
  elsif tg_table_name='rsvps' then
    if new.status='in' and not exists(select 1 from rsvps where event_id=new.event_id and status='in' and member_id<>new.member_id) then perform grant_ach(new.member_id,'early-bird'); end if;
  elsif tg_table_name='game_votes' then
    perform grant_ach(new.member_id,'democracy-enjoyer');
  end if;
  return null;
end $$;
create trigger fun_bets after insert or update on bets for each row execute function fun_achievements();
create trigger fun_purchases after insert on purchases for each row execute function fun_achievements();
create trigger fun_rsvps after insert or update on rsvps for each row execute function fun_achievements();
create trigger fun_votes after insert on game_votes for each row execute function fun_achievements();
