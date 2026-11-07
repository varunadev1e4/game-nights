import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { sb } from './supabase'
import { useData, fmt } from './App'

export function Rsvp({ e }) {
  const qc = useQueryClient()
  const uid = useData(() => sb.auth.getUser().then(r => ({ data: r.data.user.id })), 'uid')
  const r = useData(() => sb.from('rsvps').select('member_id,status,profiles(display_name)').eq('event_id', e.id), 'r' + e.id)
  if (!r || !uid) return null
  const going = r.filter(x => x.status === 'in'), mine = r.find(x => x.member_id === uid)?.status
  const set = async s => { await sb.rpc('set_rsvp', { p_event: e.id, p_status: s }); qc.invalidateQueries() }
  const wa = 'https://wa.me/?text=' + encodeURIComponent(`${e.name} on ${new Date(e.starts_at).toLocaleString()}${e.venue ? ' at ' + e.venue : ''}. RSVP on Secret Shuffle: ${location.origin}`)
  return <div className="rsvp"><div className="seg3">{[['in', "I'm in"], ['maybe', 'Maybe'], ['out', "Can't make it"]].map(([s, l]) => <button key={s} className={mine === s ? 'on' : ''} onClick={() => set(s)}>{l}</button>)}</div>
    <p className="muted">{going.length ? `${going.length} going: ${going.map(x => x.profiles.display_name).join(', ')}` : 'Nobody has said yes yet'}</p>
    <a className="share" href={wa} target="_blank" rel="noreferrer">Share on WhatsApp</a></div>
}

export function TableBets({ t }) {
  const qc = useQueryClient(), [pick, setPick] = useState(''), [stake, setStake] = useState(''), [msg, setMsg] = useState('')
  const b = useData(() => sb.from('bets').select('stake').eq('event_game_id', t.id), 'b' + t.id)
  if (!b || t.seats.length < 2) return null
  const go = async () => { const { error } = await sb.rpc('place_bet', { p_eg: t.id, p_pick: pick, p_stake: +stake }); setMsg(error ? error.message : 'Bet placed ✓'); qc.invalidateQueries() }
  return <div className="muted">Side bets: {b.length} · pool {b.reduce((a, x) => a + x.stake, 0)} HT
    <div style={{ display: 'flex', gap: 6 }}><select value={pick} onChange={e => setPick(e.target.value)}><option value="">Who wins?</option>{t.seats.map(s => <option key={s.member_id} value={s.member_id}>{s.profiles.display_name}</option>)}</select>
      <input type="number" placeholder="HT" style={{ width: 80 }} value={stake} onChange={e => setStake(e.target.value)} /><button disabled={!pick || !stake} onClick={go}>Bet</button></div>{msg}</div>
}

export function Shop() {
  const qc = useQueryClient(), [msg, setMsg] = useState('')
  const items = useData(() => sb.from('shop_items').select('*').eq('active', true).order('cost'), 'si')
  const games = useData(() => sb.from('games').select('id,name'), 'vg')
  const votes = useData(() => sb.from('game_votes').select('game_id'), 'gv')
  if (!items || !games || !votes) return <div className="sk" />
  const call = async (fn, args) => { const { error } = await sb.rpc(fn, args); setMsg(error ? error.message : 'Done ✓'); qc.invalidateQueries() }
  return <>{msg && <p className="note">{msg}</p>}
    <div className="card"><h3>Token shop</h3>{items.map(x => <div className="tx row" key={x.id}><span>{x.name}<br /><small className="muted">{x.description}</small></span><button onClick={() => call('buy_item', { p_item: x.id })}>{x.cost} HT</button></div>)}{!items.length && <p className="muted">Nothing for sale yet</p>}</div>
    <div className="card"><h3>Vote for the next game</h3>{games.map(g => <div className="tx row" key={g.id}><span>{g.name} · {votes.filter(v => v.game_id === g.id).length}</span><button onClick={() => call('vote_game', { p_game: g.id })}>Vote</button></div>)}</div></>
}

export function Rival({ me }) {
  const lb = useData(() => sb.from('lb_cache').select('member_id,display_name,avatar,balance'), 'rv')
  const h = useData(() => sb.from('h2h').select('*').eq('member_id', me.id), 'rh')
  if (!lb || !h || !me.rival_id) return null
  const r = lb.find(x => x.member_id === me.rival_id), x = h.find(y => y.opp_id === me.rival_id)
  return r ? <div className="card"><h3>Rival: {r.avatar} {r.display_name}</h3><p className="muted">Head to head {x ? `${x.won}–${x.played - x.won}` : 'no games yet'} · {fmt(r.balance)}</p></div> : null
}

export function TV() {
  const lb = useData(() => sb.from('lb_cache').select('*'), 'tl')
  const ev = useData(() => sb.from('events').select('name,event_games(id,table_label,games(name),seats(member_id,profiles(display_name)))').in('status', ['live', 'upcoming']).order('starts_at').limit(1), 'tn')
  const sc = useData(() => sb.from('scores').select('event_game_id,member_id,score'), 'ts')
  if (!lb || !ev || !sc) return <div className="sk" />
  const tot = (eg, m) => sc.filter(x => x.event_game_id === eg && x.member_id === m).reduce((a, x) => a + x.score, 0)
  return <div className="tv"><h1>Secret Shuffle{ev[0] ? ' · ' + ev[0].name : ''}</h1>
    <div className="tvgrid"><div className="card"><h2>Leaderboard</h2>{[...lb].sort((a, b) => b.season_points - a.season_points).slice(0, 8).map((m, i) =>
      <div className="tx row" key={m.member_id}><span>{i + 1}. {m.avatar} {m.display_name}</span><b>{m.season_points}</b></div>)}</div>
      <div>{ev[0]?.event_games.map(t => <div className="card" key={t.id}><h2>{t.games.name} · {t.table_label}</h2>{t.seats.map(s =>
        <div className="tx row" key={s.member_id}><span>{s.profiles.display_name}</span><b>{tot(t.id, s.member_id) || ''}</b></div>)}</div>)}</div></div></div>
}
