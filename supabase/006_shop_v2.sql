-- Run once after 005_updates.sql. Shop v2: typed items, mystery box, Black Market, noticeboard, frames.
alter table shop_items add column kind text not null default 'perk' check (kind in ('perk','title','frame','announcement','challenge','mystery','badge'));
alter table shop_items add column asks text, add column stock int, add column black_market boolean not null default false,
  add column starts_at timestamptz, add column ends_at timestamptz, add column badge_code text, add column pool text;
alter table purchases add column note text;
alter table profiles add column frame text;

create table member_frames(member_id uuid references profiles on delete cascade, frame text, primary key(member_id, frame));
create table notices(id uuid primary key default gen_random_uuid(), author_id uuid not null default auth.uid() references profiles on delete cascade,
  kind text not null default 'announcement', body text not null check (char_length(body) between 1 and 140), target_id uuid references profiles on delete set null, created_at timestamptz default now());
create table mystery_rewards(id uuid primary key default gen_random_uuid(), pool text not null default 'standard', label text not null,
  kind text not null check (kind in ('ht','title','frame')), amount int, code text, weight int not null check (weight>0));
do $$ declare t text; begin
  foreach t in array array['member_frames','notices','mystery_rewards'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy "members read" on %I for select to authenticated using (true)', t);
    execute format('create policy "admin write" on %I for all to authenticated using ((select is_admin())) with check ((select is_admin()))', t);
  end loop; end $$;

insert into achievements(code,name,description) values
('founding-member','Founding Member','Limited edition badge. Only 20 exist.'),
('title-menace','The Menace','Pulled from a mystery box. A menace, frankly.'),
('title-lucky-devil','The Lucky Devil','Pulled from a mystery box. Pure luck.'),
('title-card-whisperer','Card Whisperer','Pulled from a mystery box. The cards listen.'),
('title-unbeatable','The Unbeatable','Pulled from a mystery box. Legendary.')
on conflict (code) do nothing;

insert into mystery_rewards(label,kind,amount,code,weight) values
('50 HT back','ht',50,null,30),('100 HT back','ht',100,null,20),('A lucky 200 HT','ht',200,null,6),
('Title: The Menace','title',null,'title-menace',12),('Title: The Lucky Devil','title',null,'title-lucky-devil',10),('Title: Card Whisperer','title',null,'title-card-whisperer',8),
('Neon profile frame','frame',null,'neon',8),('Title: The Unbeatable','title',null,'title-unbeatable',4),('Aurora profile frame (animated)','frame',null,'aurora',2);

insert into shop_items(name,description,cost,kind,asks,stock,badge_code) values
('Custom player title','Pick your own title (up to 24 characters). It shows on your profile and the leaderboard.',150,'title','Your title',null,null),
('Profile frame','A coloured ring around your avatar.',250,'frame',null,null,null),
('Noticeboard announcement','Post a short, friendly message for the whole club to see.',100,'announcement','Your announcement',null,null),
('Choose the opening game','You pick the first game of the next night.',200,'perk','Which game?',null,null),
('Friendly player challenge','Challenge another member in public. Keep it friendly.',100,'challenge','What are you challenging them to?',null,null),
('Mystery reward box','A random title, frame or some tokens back. Odds are listed below.',250,'mystery',null,null,null),
('Event VIP pass','Priority spot at a limited-seat event.',500,'perk','Which event?',null,null),
('Table naming rights','Name one table at the next night.',150,'perk','What should it be called?',null,null),
('Founding Member badge','Limited edition. Only 20 will ever exist.',300,'badge',null,20,'founding-member'),
('Golden Seat','The best seat in the house for one night.',400,'perk','Which event?',null,null);
insert into shop_items(name,description,cost,kind,asks,stock,black_market,ends_at) values
('Wildcard Pass','One special game privilege during a night, agreed with the host.',350,'perk','What privilege?',3,true,now() + interval '7 days');

create or replace function set_frame(p_frame text) returns void language plpgsql security definer set search_path=public as $$
begin
  if p_frame is null then update profiles set frame=null where id=auth.uid(); return; end if;
  if exists(select 1 from member_frames where member_id=auth.uid() and frame=p_frame) then update profiles set frame=p_frame where id=auth.uid(); end if;
end $$;

drop function buy_item(uuid);
create function buy_item(p_item uuid, p_note text default null, p_target uuid default null) returns text language plpgsql security definer set search_path=public as $$
declare it shop_items%rowtype; r mystery_rewards%rowtype; bal int; msg text; pid uuid; tot int; pick int; acc int := 0; t text := trim(coalesce(p_note,''));
begin
  select * into it from shop_items where id=p_item and active and (starts_at is null or starts_at<=now()) and (ends_at is null or ends_at>now()) for update;
  if not found then raise exception 'This item is not available right now'; end if;
  if it.stock is not null and it.stock<=0 then raise exception 'Sold out'; end if;
  select coalesce(sum(amount),0) into bal from transactions where member_id=auth.uid();
  if bal<it.cost then raise exception 'Not enough House Tokens'; end if;
  if it.kind in ('title','announcement','challenge') and t='' then raise exception 'Please write something first'; end if;
  if it.kind='title' and char_length(t)>24 then raise exception 'Titles can be up to 24 characters'; end if;
  if it.kind in ('announcement','challenge') and char_length(t)>140 then raise exception 'Keep it under 140 characters'; end if;
  if it.kind='challenge' and (p_target is null or p_target=auth.uid()) then raise exception 'Pick another member to challenge'; end if;
  if it.kind='frame' and t not in ('gold','ruby','emerald','sapphire','violet') then raise exception 'Pick a frame'; end if;

  insert into purchases(member_id,item_id,note) values(auth.uid(),it.id,nullif(t,'')) returning id into pid;
  insert into transactions(member_id,amount,reason) values(auth.uid(),-it.cost,'Shop: '||it.name);
  if it.stock is not null then update shop_items set stock=stock-1 where id=it.id; end if;

  if it.kind='title' then update profiles set title=t where id=auth.uid(); msg := 'Your title is now '||t;
  elsif it.kind='frame' then insert into member_frames values(auth.uid(),t) on conflict do nothing; update profiles set frame=t where id=auth.uid(); msg := 'Frame equipped';
  elsif it.kind in ('announcement','challenge') then insert into notices(kind,body,target_id) values(it.kind,t,p_target); msg := 'Posted on the noticeboard';
  elsif it.kind='badge' then perform grant_ach(auth.uid(), it.badge_code); msg := 'Badge added to your profile';
  elsif it.kind='mystery' then
    select coalesce(sum(weight),0) into tot from mystery_rewards where pool=coalesce(it.pool,'standard');
    pick := floor(random()*tot)::int;
    for r in select * from mystery_rewards where pool=coalesce(it.pool,'standard') order by id loop
      acc := acc + r.weight; exit when pick < acc;
    end loop;
    if r.kind='ht' then insert into transactions(member_id,amount,reason) values(auth.uid(),r.amount,'Mystery box: '||r.label);
    elsif r.kind='title' then perform grant_ach(auth.uid(), r.code);
    elsif r.kind='frame' then insert into member_frames values(auth.uid(), r.code) on conflict do nothing; end if;
    msg := 'You opened: '||r.label;
  else msg := 'Order placed. The host will sort it out.';
  end if;
  update purchases set fulfilled = (it.kind <> 'perk') where id = pid;
  return msg;
end $$;
