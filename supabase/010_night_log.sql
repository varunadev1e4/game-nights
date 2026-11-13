-- Night log: write results and token changes down after the event, then apply everything with one click.
-- Run once after 007_join.sql (and 009 if you ran it). Needs 005_updates.sql to have been run already.

create table night_drafts(
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events on delete cascade,
  kind text not null check (kind in ('result','tx','final')),
  group_id uuid,                                   -- ties the rows of one game result together
  game_id uuid references games,
  label text,                                      -- table or round name, like "Round 1"
  member_id uuid not null references profiles on delete cascade,
  position int check (position >= 1),
  points int,                                      -- blank = automatic (more points for a better position)
  ht int,                                          -- result: optional HT override. tx: signed amount. final: the balance the member should end on
  reason text,
  created_at timestamptz not null default now(),
  applied_at timestamptz
);
create index on night_drafts(event_id);
alter table night_drafts enable row level security;
create policy "admin only" on night_drafts for all to authenticated using ((select is_admin())) with check ((select is_admin()));

-- What every member's balance will look like after applying (nothing is written).
create function night_preview(p_event uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
  if not is_admin() then raise exception 'admin only'; end if;
  return coalesce((select jsonb_agg(x order by x->>'name') from (
    select jsonb_build_object('member', m.id, 'name', m.display_name, 'now', b.bal, 'results', coalesce(r.s, 0), 'tx', coalesce(t.s, 0),
      'after', b.bal + coalesce(r.s, 0) + coalesce(t.s, 0), 'final', f.ht,
      'adjust', case when f.ht is null then 0 else f.ht - (b.bal + coalesce(r.s, 0) + coalesce(t.s, 0)) end) x
    from profiles m
    join (select member_id from night_drafts where event_id = p_event and applied_at is null group by member_id) d on d.member_id = m.id
    cross join lateral (select coalesce(sum(amount), 0)::int bal from transactions where member_id = m.id) b
    left join lateral (select sum(coalesce(n.ht, case n.position when 1 then (g.token_rules->>'win')::int when 2 then (g.token_rules->>'second')::int when 3 then (g.token_rules->>'third')::int else (g.token_rules->>'participation')::int end))::int s
      from night_drafts n join games g on g.id = n.game_id where n.event_id = p_event and n.kind = 'result' and n.applied_at is null and n.member_id = m.id) r on true
    left join lateral (select sum(ht)::int s from night_drafts where event_id = p_event and kind = 'tx' and applied_at is null and member_id = m.id) t on true
    left join lateral (select ht from night_drafts where event_id = p_event and kind = 'final' and applied_at is null and member_id = m.id order by created_at desc limit 1) f on true
  ) q), '[]');
end $$;

-- Applies every saved entry in one go. All or nothing: if anything fails, nothing is written.
create function night_apply(p_event uuid, p_complete boolean default false) returns jsonb language plpgsql security definer set search_path=public as $$
declare g record; r record; eg uuid; n int; bal int; cr int := 0; ct int := 0; cf int := 0;
begin
  if not is_admin() then raise exception 'admin only'; end if;
  if not exists (select 1 from night_drafts where event_id = p_event and applied_at is null) then raise exception 'There is nothing to apply'; end if;
  -- 1. game results: one table per saved result, with the HT from each game's rules unless you typed an amount
  for g in select group_id, game_id, label, min(created_at) c from night_drafts where event_id = p_event and kind = 'result' and applied_at is null group by group_id, game_id, label order by c loop
    insert into event_games(event_id, game_id, table_label) values (p_event, g.game_id, coalesce(g.label, 'Round')) returning id into eg;
    select count(*) into n from night_drafts where group_id = g.group_id and applied_at is null;
    for r in select * from night_drafts where group_id = g.group_id and applied_at is null order by position, created_at loop
      insert into seats(event_game_id, member_id) values (eg, r.member_id) on conflict do nothing;
      perform record_result(eg, r.member_id, r.position, coalesce(r.points, greatest(n - r.position + 1, 0)), r.ht);
      cr := cr + 1;
    end loop;
    perform award_for_table(eg);
  end loop;
  -- 2. token transactions
  for r in select * from night_drafts where event_id = p_event and kind = 'tx' and applied_at is null order by created_at loop
    insert into transactions(member_id, amount, reason, created_by) values (r.member_id, r.ht, coalesce(nullif(trim(r.reason), ''), 'Event adjustment'), auth.uid());
    ct := ct + 1;
  end loop;
  -- 3. final balances: top up or trim so the member lands exactly on the number you wrote down
  for r in select distinct on (member_id) * from night_drafts where event_id = p_event and kind = 'final' and applied_at is null order by member_id, created_at desc loop
    select coalesce(sum(amount), 0) into bal from transactions where member_id = r.member_id;
    if bal <> r.ht then insert into transactions(member_id, amount, reason, created_by) values (r.member_id, r.ht - bal, 'Final balance after the event', auth.uid()); cf := cf + 1; end if;
  end loop;
  update night_drafts set applied_at = now() where event_id = p_event and applied_at is null;
  if p_complete then update events set status = 'completed' where id = p_event; end if;
  return jsonb_build_object('results', cr, 'transactions', ct, 'adjustments', cf);
end $$;

revoke all on function night_preview(uuid), night_apply(uuid, boolean) from public, anon;
grant execute on function night_preview(uuid), night_apply(uuid, boolean) to authenticated;
