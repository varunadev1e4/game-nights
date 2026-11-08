-- Run once after 006_shop_v2.sql. Lets friends create their own account with a club code.
create table club_settings(key text primary key, value text not null);
alter table club_settings enable row level security;
create policy "admin only" on club_settings for all to authenticated using ((select is_admin())) with check ((select is_admin()));
insert into club_settings(key, value) values ('join_code', substring(md5(random()::text) from 1 for 8)), ('join_open', 'true') on conflict do nothing;
