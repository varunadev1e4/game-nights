import { useEffect, useState, lazy, Suspense } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { sb } from './supabase'
import { Leaderboard, Members, Profile, Achievements } from './more'
import { Shop, TV, Rsvp, TableBets, Rival, Noticeboard } from './live'
import { NextUp, Recap, Gallery, Brackets } from './extra'
const Admin = lazy(() => import('./admin'))

export const fmt = n => Number(n).toLocaleString() + ' HT'
export function useData(fn, key) {
  return useQuery({ queryKey: [key], queryFn: async () => (await fn()).data ?? [] }).data ?? null
}

function Login() {
  const [f, setF] = useState({ email: '', password: '' }), [err, setErr] = useState(''), [busy, setBusy] = useState(false)
  const go = async e => { e.preventDefault(); setBusy(true); const { error } = await sb.auth.signInWithPassword(f); setBusy(false); if (error) setErr('Wrong email or password. Check them and try again.') }
  return <div className="gate"><div className="mark"><span className="suits">♠ <span className="r">♥</span> ♣ <span className="r">♦</span></span><h1>Secret Shuffle</h1><p>A private card club. Sign in to see tonight's tables and your tokens.</p></div>
    <form className="card" onSubmit={go}>
      <label className="fld"><span>Email</span><input type="email" autoComplete="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></label>
      <label className="fld"><span>Password</span><input type="password" autoComplete="current-password" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} /></label>
      <button className="pri" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>{err && <p className="err">{err}</p>}
      <p className="muted">No account yet? Ask the host to add you.</p></form></div>
}

const hm = d => new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const STATUS = { upcoming: 'Coming up', live: 'Live now', completed: 'Finished', cancelled: 'Cancelled' }

function Ticket({ e, children }) {
  const d = new Date(e.starts_at), suit = '♠♥♣♦'[d.getDate() % 4]
  return <article className="ticket"><div className="stub"><b>{d.getDate()}</b><span>{d.toLocaleString([], { month: 'short' })}</span><i className={'suit' + (suit === '♥' || suit === '♦' ? ' red' : '')}>{suit}</i></div>
    <div className="tbody"><h2>{e.name}</h2>
      <p className="muted">{d.toLocaleDateString([], { weekday: 'long' })} at {hm(e.starts_at)}</p>{e.venue && <p className="muted">{e.venue}</p>}
      <span className={'pill ' + e.status}>{STATUS[e.status]}</span>{children}</div></article>
}

function Home({ me, go }) {
  const w = useData(() => sb.from('wallet').select('*').eq('member_id', me.id), 'w')
  const lb = useData(() => sb.from('lb_cache').select('member_id,season_points'), 'hl')
  const ev = useData(() => sb.from('events').select('*, event_games(*, games(name), seats(member_id))').in('status', ['upcoming', 'live']).order('starts_at').limit(1), 'n')
  if (!w || !ev || !lb) return <div className="sk" />
  const b = w[0], n = ev[0], mine = n ? n.event_games.filter(t => t.seats.some(s => s.member_id === me.id)) : []
  const rank = [...lb].sort((a, b) => b.season_points - a.season_points).findIndex(x => x.member_id === me.id) + 1
  const h = new Date().getHours(), part = h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'
  return <>
    <h1 className="title">Good {part}, {me.display_name.split(' ')[0]}</h1>
    {n ? <Ticket e={n}>{n.announcement && <p className="note">{n.announcement}</p>}<NextUp mine={mine} /><Rsvp e={n} />
      {mine.length > 0 && <p className="muted">You're playing {mine.map(t => `${t.games.name} (${t.table_label})`).join(', ')}</p>}</Ticket>
      : <div className="empty">No game night scheduled yet. The host will post the next one here.</div>}
    <div className="card wal" onClick={() => go('Wallet')}><span className="coin">HT</span>
      <div className="grow"><div className="num">{Number(b?.balance ?? 0).toLocaleString()}</div><span className="muted">House Tokens{rank ? `, ranked ${rank} this season` : ''}</span></div><span className="go">›</span></div>
    <Noticeboard isAdmin={me.is_admin} /><Rival me={me} /></>
}

function Events() {
  const [f, setF] = useState('up')
  const ev = useData(() => sb.from('events').select('*, event_games(*, games(name), seats(member_id, profiles(display_name)))').order('starts_at', { ascending: false }), 'ev')
  if (!ev) return <div className="sk" />
  const up = f === 'up', list = ev.filter(e => up ? ['upcoming', 'live'].includes(e.status) : ['completed', 'cancelled'].includes(e.status))
  if (up) list.reverse()
  return <>
    <div className="seg">{[['up', 'Coming up'], ['past', 'Past nights']].map(([k, l]) => <button key={k} className={f === k ? 'on' : ''} onClick={() => setF(k)}>{l}</button>)}</div>
    {list.map((e, i) => <Ticket key={e.id} e={e}>
      {e.announcement && <p className="note">{e.announcement}</p>}
      {up && <Rsvp e={e} />}
      <details className="tables" open={up && i === 0}><summary>Tables and players</summary>
        {e.event_games.map(t => <div key={t.id} className="row"><div className="tx"><b>{t.games.name}, {t.table_label}</b><span className="muted">{t.starts_at && hm(t.starts_at)}</span></div>
          <div className="chips">{t.seats.map(s => <span className="chip" key={s.member_id}>{s.profiles.display_name}</span>)}{!t.seats.length && <span className="muted">Nobody seated yet</span>}</div>
          {up && <TableBets t={t} />}</div>)}
        {!e.event_games.length && <p className="muted">The host hasn't set up tables yet.</p>}</details></Ticket>)}
    {!list.length && <div className="empty">{up ? 'No game nights scheduled. The host will post the next one here.' : 'Finished nights will show up here.'}</div>}</>
}

function Games() {
  const g = useData(() => sb.from('games').select('*').order('name'), 'g')
  if (!g) return <div className="sk" />
  return g.map(x => <div className="card" key={x.id}><h3>{x.name}</h3>
    <p className="muted">{x.min_players} to {x.max_players} players, about {x.duration_min} minutes</p><p style={{ margin: 0 }}>{x.description}</p></div>)
}

function Wallet({ me }) {
  const [n, setN] = useState(20)
  const w = useData(() => sb.from('wallet').select('*').eq('member_id', me.id), 'w')
  const t = useData(() => sb.from('transactions').select('*, event_games(games(name))').eq('member_id', me.id).order('created_at', { ascending: false }).limit(n), 'tx' + n)
  if (!t || !w) return <div className="sk" />
  const b = w[0]
  return <>
    <div className="card wal"><span className="coin">HT</span><div className="grow"><div className="num">{Number(b?.balance ?? 0).toLocaleString()}</div><span className="muted">House Tokens</span></div></div>
    <div className="card sums"><div><b className="pos">+{b?.earned ?? 0}</b><span>Earned</span></div><div><b className="neg">−{b?.spent ?? 0}</b><span>Spent</span></div></div>
    <h3 className="sub">History</h3>
    <div className="card list">{t.map(x => <div className="li" key={x.id}><div className="grow"><span className="nm">{x.reason}</span>
      <span className="muted">{x.event_games?.games?.name || 'Club'} on {new Date(x.created_at).toLocaleDateString([], { day: 'numeric', month: 'short' })}</span></div>
      <b className={x.amount >= 0 ? 'pos' : 'neg'}>{x.amount > 0 ? '+' : ''}{x.amount}</b></div>)}
      {!t.length && <p className="muted">No transactions yet. Tokens you win or spend will appear here.</p>}
      {t.length >= n && <button onClick={() => setN(n + 20)}>Show more</button>}</div></>
}

export function F({ title, fields, onSubmit, open }) {
  const [v, setV] = useState({}), [msg, setMsg] = useState(''), [busy, setBusy] = useState(false)
  const go = async e => { e.preventDefault(); setBusy(true); const { error } = await onSubmit(v); setBusy(false); setMsg(error ? error.message : 'Saved ✓'); if (!error) setV({}) }
  const set = k => e => setV({ ...v, [k]: e.target.value })
  return <details className="card acc" open={open}><summary>{title}</summary>
    <form onSubmit={go}>{fields.map(([k, label, type, opts]) => <label key={k} className="fld"><span>{label}</span>
      {opts ? <select required value={v[k] || ''} onChange={set(k)}><option value="">Choose…</option>{opts.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>
        : <input required={!/optional/i.test(label)} type={type || 'text'} value={v[k] || ''} onChange={set(k)} />}</label>)}
      <button className="pri" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>{msg && <span className={msg.includes('✓') ? 'pos' : 'err'}>{msg}</span>}</form></details>
}

const ICON = { Home: '♠', Events: '♥', Leaderboard: '♦', Wallet: '♣', Admin: '✦', More: '⋯' }
const MORE = [['Games', 'Rules, player counts and how long each takes'], ['Members', 'Profiles, records and recent activity'], ['Shop', 'Spend tokens and vote for the next game'], ['Recap', 'Highlights from each season'],
  ['Brackets', 'Tournament draws and results'], ['Gallery', 'Photos from game nights'], ['Achievements', 'Titles you can earn'], ['Wallet', 'Your tokens and transactions'], ['Profile', 'Your stats, avatar and name']]

export default function App() {
  const [session, setSession] = useState(undefined), [me, setMe] = useState(null), [tab, setTab] = useState('Home'), [pid, setPid] = useState(null)
  const qc = useQueryClient()
  useEffect(() => {
    sb.auth.getSession().then(r => setSession(r.data.session))
    const { data } = sb.auth.onAuthStateChange((_, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])
  useEffect(() => { if (session) sb.from('profiles').select('*').eq('id', session.user.id).single().then(r => setMe(r.data)); else setMe(null) }, [session])
  useEffect(() => {
    if (!session) { qc.clear(); return }
    const ch = sb.channel('live')
    ;['transactions', 'results', 'seats', 'events', 'event_games', 'rsvps', 'scores', 'bets', 'tournament_matches', 'photos'].forEach(t => ch.on('postgres_changes', { event: '*', schema: 'public', table: t }, () => qc.invalidateQueries()))
    ch.subscribe()
    return () => { sb.removeChannel(ch) }
  }, [session])
  if (session === undefined || (session && !me)) return <div className="splash">♠</div>
  if (!session) return <Login />
  if (location.hash === '#tv') return <TV />
  const go = t => { setTab(t); if (t === 'Profile') setPid(null); window.scrollTo(0, 0) }
  const nav = ['Home', 'Events', 'Leaderboard', me.is_admin ? 'Admin' : 'Wallet', 'More']
  const deep = !nav.includes(tab)
  const page = { Home: <Home me={me} go={go} />, Events: <Events />, Games: <Games />, Members: <Members open={id => { setPid(id); setTab('Profile') }} />, Wallet: <Wallet me={me} />, Shop: <Shop me={me} />,
    Leaderboard: <Leaderboard />, Recap: <Recap />, Brackets: <Brackets />, Gallery: <Gallery me={me} />, Achievements: <Achievements />, Profile: <Profile id={pid || me.id} me={me} />,
    Admin: <Suspense fallback={<div className="sk" />}><Admin /></Suspense>,
    More: <><div className="card list">{MORE.filter(([t]) => !nav.includes(t)).map(([t, d]) => <button key={t} className="link" onClick={() => go(t)}><span className="grow"><b>{t}</b><small>{d}</small></span><i>›</i></button>)}</div>
      <button className="ontable" onClick={() => sb.auth.signOut()}>Sign out</button></> }[tab]
  return <div className="app">
    <header><span className="wm"><i>♠</i>Secret Shuffle</span><button className="av" style={{ border: 0, padding: 0 }} onClick={() => go('Profile')} aria-label="Your profile">{me.avatar || me.display_name[0]}</button></header>
    {deep && tab !== 'More' && <button className="back" onClick={() => go('More')}>‹ More</button>}
    {!['Home', 'Profile'].includes(tab) && <h1 className="title">{tab}</h1>}
    <main key={tab}>{page}</main>
    <nav className="bar">{nav.map(t => <button key={t} className={tab === t || (t === 'More' && deep) ? 'on' : ''} onClick={() => go(t)}><span>{ICON[t]}</span>{t === 'Leaderboard' ? 'Ranks' : t}</button>)}</nav></div>
}
