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

const FRAMES = [['gold', 'Gold'], ['ruby', 'Ruby'], ['emerald', 'Emerald'], ['sapphire', 'Sapphire'], ['violet', 'Violet']]
const timeLeft = d => { const h = Math.floor((new Date(d) - Date.now()) / 36e5); return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h left` : `${Math.max(h, 0)}h left` }

function Item({ it, members, bal, done }) {
  const [open, setOpen] = useState(false), [note, setNote] = useState(''), [target, setTarget] = useState(''), [busy, setBusy] = useState(false), [err, setErr] = useState('')
  const ask = it.kind === 'frame' ? 'frame' : it.kind === 'challenge' ? 'challenge' : (it.asks || ['title', 'announcement'].includes(it.kind)) ? 'text' : null
  const short = bal < it.cost, out = it.stock != null && it.stock <= 0
  const buy = async () => {
    setBusy(true); setErr('')
    const { data, error } = await sb.rpc('buy_item', { p_item: it.id, p_note: note || null, p_target: target || null })
    setBusy(false)
    if (error) return setErr(error.message)
    setOpen(false); setNote(''); setTarget(''); done(data)
  }
  return <div className="li shopi"><div className="tx"><span className="grow"><span className="nm">{it.name}</span>
    <span className="muted">{it.description}{it.stock != null ? (out ? ' Sold out.' : ` Only ${it.stock} left.`) : ''}{it.ends_at ? ` ${timeLeft(it.ends_at)}.` : ''}</span></span>
    <button disabled={out} onClick={() => setOpen(!open)}>{it.cost} HT</button></div>
    {open && <div className="buy">
      {ask === 'frame' && <select value={note} onChange={e => setNote(e.target.value)}><option value="">Choose a frame</option>{FRAMES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}
      {ask === 'challenge' && <select value={target} onChange={e => setTarget(e.target.value)}><option value="">Who are you challenging?</option>{members.map(m => <option key={m.id} value={m.id}>{m.display_name}</option>)}</select>}
      {(ask === 'text' || ask === 'challenge') && <input maxLength={140} placeholder={it.asks || 'Write it here'} value={note} onChange={e => setNote(e.target.value)} />}
      {short && <p className="muted">You need {it.cost - bal} more HT.</p>}
      <button className="pri" disabled={busy || short} onClick={buy}>{busy ? 'Buying…' : `Buy for ${it.cost} HT`}</button>{err && <p className="err">{err}</p>}</div>}</div>
}

export function Shop({ me }) {
  const qc = useQueryClient(), [msg, setMsg] = useState('')
  const w = useData(() => sb.from('wallet').select('balance').eq('member_id', me.id), 'sw')
  const items = useData(() => sb.from('shop_items').select('*').eq('active', true).order('cost'), 'si')
  const members = useData(() => sb.from('profiles').select('id,display_name').order('display_name'), 'sm')
  const odds = useData(() => sb.from('mystery_rewards').select('label,weight').order('weight', { ascending: false }), 'so')
  const games = useData(() => sb.from('games').select('id,name'), 'vg')
  const votes = useData(() => sb.from('game_votes').select('game_id'), 'gv')
  if (!w || !items || !members || !odds || !games || !votes) return <div className="sk" />
  const now = Date.now(), live = items.filter(x => (!x.starts_at || new Date(x.starts_at) <= now) && (!x.ends_at || new Date(x.ends_at) > now))
  const main = live.filter(x => !x.black_market), bm = live.filter(x => x.black_market), bal = Number(w[0]?.balance ?? 0), tot = odds.reduce((a, x) => a + x.weight, 0)
  const done = m => { setMsg(m); qc.invalidateQueries() }
  return <>
    <div className="card wal"><span className="coin">HT</span><div className="grow"><div className="num">{bal.toLocaleString()}</div><span className="muted">House Tokens to spend</span></div></div>
    {msg && <p className="note">{msg}</p>}
    <h3 className="sub">Club shop</h3>
    <div className="card list">{main.map(it => <Item key={it.id} it={it} members={members} bal={bal} done={done} />)}{!main.length && <p className="muted">Nothing for sale yet. Check back soon.</p>}</div>
    {bm.length > 0 && <><h3 className="sub">Black Market</h3><p className="muted pad">Rare items that vanish when the timer runs out.</p>
      <div className="card list bm">{bm.map(it => <Item key={it.id} it={it} members={members} bal={bal} done={done} />)}</div></>}
    {odds.length > 0 && <details className="card acc"><summary>Mystery box odds</summary>
      {odds.map(x => <div className="tx" key={x.label}><span>{x.label}</span><b>{Math.round(100 * x.weight / tot)}%</b></div>)}
      <p className="muted">Rewards are cosmetic or small refunds. Nothing here changes your leaderboard points.</p></details>}
    <h3 className="sub">Vote for the next game</h3>
    <div className="card list">{games.map(g => <div className="li" key={g.id}><span className="grow nm">{g.name}</span><span className="muted">{votes.filter(v => v.game_id === g.id).length} votes</span>
      <button onClick={async () => { await sb.rpc('vote_game', { p_game: g.id }); qc.invalidateQueries() }}>Vote</button></div>)}</div></>
}

export function Noticeboard({ isAdmin }) {
  const qc = useQueryClient()
  const n = useData(() => sb.from('notices').select('id,kind,body,created_at,author:profiles!notices_author_id_fkey(display_name),target:profiles!notices_target_id_fkey(display_name)').order('created_at', { ascending: false }).limit(5), 'nb')
  if (!n || !n.length) return null
  return <><h3 className="sub">Noticeboard</h3><div className="card list">{n.map(x => <div className="li" key={x.id}><span className="grow">
    {x.kind === 'challenge' ? <><span className="nm">{x.author.display_name} challenges {x.target?.display_name || 'the club'}</span><span className="muted">{x.body}</span></>
      : <><span className="nm">“{x.body}”</span><span className="muted">{x.author.display_name}</span></>}</span>
    {isAdmin && <button onClick={async () => { await sb.from('notices').delete().eq('id', x.id); qc.invalidateQueries() }}>Remove</button>}</div>)}</div></>
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
