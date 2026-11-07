import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { sb } from './supabase'
import { useData, F, fmt } from './App'

const tabs = [['season_points', 'Points'], ['balance', 'Tokens'], ['wins', 'Wins'], ['win_rate', 'Win rate'], ['consistency', 'Steadiest', 1], ['games_played', 'Most games']]

export function Leaderboard() {
  const [k, setK] = useState('season_points'), [s, setS] = useState('')
  const uid = useData(() => sb.auth.getUser().then(r => ({ data: r.data.user.id })), 'uid')
  const d = useData(() => sb.from('lb_cache').select('*'), 'lb')
  const pt = useData(() => sb.from('profiles').select('id,title'), 'pt')
  const ss = useData(() => sb.from('seasons').select('*').order('starts_on', { ascending: false }), 'ss')
  const past = useData(() => s ? sb.from('season_board').select('*').eq('season_id', s) : Promise.resolve({ data: [] }), 'p' + s)
  if (!d || !ss || !past || !uid || !pt) return <div className="sk" />
  const asc = tabs.find(t => t[0] === k)[2]
  const rows = s ? [...past].sort((a, b) => b.points - a.points).map(x => ({ id: x.member_id, name: x.display_name, sub: 'Season points', val: x.points }))
    : [...d].sort((a, b) => asc ? (a[k] ?? 99) - (b[k] ?? 99) : b[k] - a[k]).map(x => ({ id: x.member_id, name: x.display_name, av: x.avatar, sub: [pt.find(p => p.id === x.member_id)?.title, `${x.wins} wins from ${x.games_played} games`].filter(Boolean).join(', '),
      val: k === 'balance' ? Number(x.balance).toLocaleString() : k === 'win_rate' ? x.win_rate + '%' : x[k] ?? '–' }))
  return <>
    <select value={s} onChange={e => setS(e.target.value)}><option value="">Current standings</option>{ss.map(x => <option key={x.id} value={x.id}>{x.name}{x.is_active ? ' (active)' : ''}</option>)}</select>
    {!s && <div className="seg">{tabs.map(([id, n]) => <button key={id} className={k === id ? 'on' : ''} onClick={() => setK(id)}>{n}</button>)}</div>}
    <div className="card list">{rows.map((r, i) => <div className={'rk' + (r.id === uid ? ' me' : '')} key={r.id}><b className="n">{i + 1}</b><span className="av">{r.av || r.name[0]}</span>
      <span className="grow"><span className="nm">{r.name}</span><span className="muted">{r.sub}</span></span><b className="val">{r.val}</b></div>)}
      {!rows.length && <p className="muted">Rankings appear after the first game is recorded.</p>}</div></>
}

export function Members({ open }) {
  const m = useData(() => sb.from('lb_cache').select('*').order('display_name'), 'mm')
  const a = useData(() => sb.from('transactions').select('amount,reason,created_at,profiles(display_name)').order('created_at', { ascending: false }).limit(8), 'act')
  if (!m || !a) return <div className="sk" />
  return <>
    <div className="card list">{m.map(x => <button className="link" key={x.member_id} onClick={() => open(x.member_id)}><span className="av">{x.avatar || x.display_name[0]}</span>
      <span className="grow"><b>{x.display_name}</b><small>{x.wins} wins, {x.win_rate}% win rate</small></span><b className="val">{Number(x.balance).toLocaleString()}</b></button>)}</div>
    <h3 className="sub">Recent activity</h3>
    <div className="card list">{a.map((x, i) => <div className="li" key={i}><span className="grow">{x.profiles.display_name}<span className="muted"> {x.reason}</span></span>
      <b className={x.amount >= 0 ? 'pos' : 'neg'}>{x.amount > 0 ? '+' : ''}{x.amount}</b></div>)}</div></>
}

export function Profile({ id, me }) {
  const qc = useQueryClient()
  const lb = useData(() => sb.from('lb_cache').select('*'), 'pl')
  const pr = useData(() => sb.from('profiles').select('id,display_name,avatar,title'), 'pf')
  const r = useData(() => sb.from('results').select('position,created_at,event_games(games(name),events(name,starts_at))').eq('member_id', id), 'pr' + id)
  const ac = useData(() => sb.from('member_achievements').select('achievement_id,achievements(name,icon,description)').eq('member_id', id), 'pa' + id)
  const h = useData(() => sb.from('h2h').select('*').eq('member_id', id), 'ph' + id)
  if (!lb || !pr || !r || !ac || !h) return <div className="sk" />
  const m = lb.find(x => x.member_id === id), p = pr.find(x => x.id === id), name = x => pr.find(y => y.id === x)?.display_name
  if (!m || !p) return <p>Member not found.</p>
  const rank = [...lb].sort((a, b) => b.season_points - a.season_points).findIndex(x => x.member_id === id) + 1
  const fav = {}; r.forEach(x => { const n = x.event_games.games.name; fav[n] = (fav[n] || 0) + 1 })
  const favs = Object.entries(fav).sort((a, b) => b[1] - a[1]).slice(0, 3)
  const streak = (() => { let n = 0; for (const x of [...r].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))) { if (x.position === 1) n++; else break } return n })()
  return <>
        <div className="card profile"><span className="av lg">{p.avatar || p.display_name[0]}</span><div className="grow"><h2>{p.display_name}</h2>{p.title && <p style={{ margin: '4px 0' }}><span className="pill upcoming">{p.title}</span></p>}
      <span className="muted">{rank ? `Number ${rank} this season` : 'Not ranked yet'}{streak > 1 ? `, ${streak} wins in a row` : ''}</span></div></div>
    <div className="card statrow">{[[Number(m.balance).toLocaleString(), 'Tokens'], [m.games_played, 'Games'], [m.wins, 'Wins'], [m.win_rate + '%', 'Win rate'], [m.events_attended, 'Nights']].map(([v, l]) => <div key={l}><b>{v}</b><span>{l}</span></div>)}</div>
    <p className="muted pad">Favourite games: {favs.map(f => `${f[0]} (${f[1]})`).join(', ') || 'none yet'}</p>
    {id !== me.id && <button className="ontable" onClick={async () => { await sb.rpc('set_rival', { p_id: id }); location.reload() }}>Make rival</button>}
    {id === me.id && <F title="Edit my profile" fields={[['avatar', 'Avatar (one emoji)'], ['display_name', 'Display name']]}
      onSubmit={async v => { const x = await sb.rpc('update_my_profile', { p_name: v.display_name, p_avatar: v.avatar }); if (!x.error) location.reload(); return x }} />}
    {id === me.id && ac.length > 0 && <div className="card"><label className="fld"><span>Your title, shown on your profile and the leaderboard</span>
      <select value={ac.find(x => x.achievements.name === p.title)?.achievement_id || ''} onChange={async e => { await sb.rpc('set_title', { p_ach: e.target.value || null }); qc.invalidateQueries() }}>
        <option value="">No title</option>{ac.map(x => <option key={x.achievement_id} value={x.achievement_id}>{x.achievements.name}</option>)}</select></label></div>}
    {id === me.id && <F title="Change password" fields={[['pw', 'New password', 'password'], ['pw2', 'Confirm new password', 'password']]}
      onSubmit={async v => { if (v.pw !== v.pw2) return { error: { message: 'The two passwords do not match.' } }; if (v.pw.length < 8) return { error: { message: 'Use at least 8 characters.' } }; const { error } = await sb.auth.updateUser({ password: v.pw }); return { error: error ? { message: error.message } : null } }} />}
    <div className="card"><h3>Achievements</h3>{ac.length ? ac.map((x, i) => <div className="row" key={i}><b>{x.achievements.name}</b> <span className="muted">{x.achievements.description}</span></div>) : <p className="muted">None yet</p>}</div>
    <div className="card"><h3>Head to head</h3>{h.map(x => <div className="tx row" key={x.opp_id}><span>vs {name(x.opp_id)}</span><b>{x.won}–{x.played - x.won}</b></div>)}{!h.length && <p className="muted">No shared games yet</p>}</div>
    <div className="card"><h3>History</h3>{[...r].sort((a, b) => new Date(b.event_games.events.starts_at) - new Date(a.event_games.events.starts_at)).map((x, i) =>
      <div className="tx row" key={i}><span>{x.event_games.games.name}<br /><small className="muted">{x.event_games.events.name}</small></span><b>#{x.position}</b></div>)}</div>
  </>
}

export function Achievements() {
  const a = useData(() => sb.from('achievements').select('*, member_achievements(profiles(display_name))').order('name'), 'ac')
  if (!a) return <div className="sk" />
  return a.map(x => <div className="card" key={x.id}><h3>{x.name}</h3><p className="muted">{x.description}</p>
    <p>{x.member_achievements.map(y => y.profiles.display_name).join(', ') || 'Not earned yet'}</p></div>)
}

export function AdminMore({ M, G, run, tick }) {
  const ss = useData(() => sb.from('seasons').select('id,name'), 's' + tick)
  const ac = useData(() => sb.from('achievements').select('id,name'), 'a')
  if (!ss || !ac) return null
  const S = ss.map(x => [x.id, x.name]), A = ac.map(x => [x.id, x.name])
  return <>
    <F title="Add game" fields={[['name', 'Name'], ['description', 'Description'], ['min_players', 'Min players', 'number'], ['max_players', 'Max players', 'number'], ['duration_min', 'Minutes', 'number']]} onSubmit={run(v => sb.from('games').insert(v))} />
    <F title="Game token rules (HT by position)" fields={[['id', 'Game', 0, G], ['win', '1st', 'number'], ['second', '2nd', 'number'], ['third', '3rd', 'number'], ['participation', 'Others', 'number']]}
      onSubmit={run(v => sb.from('games').update({ token_rules: { win: +v.win, second: +v.second, third: +v.third, participation: +v.participation } }).eq('id', v.id))} />
    <F title="New season" fields={[['name', 'Season name']]} onSubmit={run(v => sb.from('seasons').insert(v))} />
    <F title="Activate season (closes current)" fields={[['id', 'Season', 0, S]]} onSubmit={run(v => sb.rpc('set_active_season', { p_id: v.id }))} />
    <form className="card" onSubmit={e => { e.preventDefault(); run(() => sb.rpc('close_season'))() }}><h3>Close active season</h3><button>Close season</button></form>
    <F title="Award achievement" fields={[['member_id', 'Member', 0, M], ['achievement_id', 'Achievement', 0, A]]} onSubmit={run(v => sb.from('member_achievements').insert(v))} />
  </>
}
