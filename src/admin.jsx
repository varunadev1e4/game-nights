import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { sb } from './supabase'
import { useData, F, fmt } from './App'
import { Seating, Tournaments } from './adminy'
import { Scorekeeper, QuickResults, dl } from './adminx'

const hm = d => new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const clean = v => Object.fromEntries(Object.entries(v).filter(([, x]) => x))
const SECS = ['Run event', 'Events', 'Members', 'Games', 'Seasons', 'Data']

function TableCard({ t, M }) {
  const qc = useQueryClient(), [open, setOpen] = useState(''), [w, setW] = useState('')
  const free = M.filter(([id]) => !t.seats.some(s => s.member_id === id))
  const seat = async id => { await sb.from('seats').insert({ event_game_id: t.id, member_id: id }); qc.invalidateQueries() }
  const unseat = async id => { await sb.from('seats').delete().match({ event_game_id: t.id, member_id: id }); qc.invalidateQueries() }
  const settle = async () => { await sb.rpc('settle_bets', { p_eg: t.id, p_winner: w }); setOpen(''); qc.invalidateQueries() }
  return <div className="card"><div className="tx"><h3>{t.games.name} · {t.table_label}</h3><span className="muted">{t.starts_at ? hm(t.starts_at) : ''}</span></div>
    <div className="chips">{t.seats.map(s => <span className="chip" key={s.member_id}>{s.profiles.display_name}<button onClick={() => unseat(s.member_id)}>✕</button></span>)}{!t.seats.length && <span className="muted">No players yet</span>}</div>
    <select value="" onChange={e => e.target.value && seat(e.target.value)}><option value="">＋ Add player…</option>{free.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>
    <div className="btns">{[['score', 'Scores'], ['res', 'Results'], ['bet', 'Settle bets']].map(([k, l]) => <button key={k} className={open === k ? 'on' : ''} onClick={() => setOpen(open === k ? '' : k)}>{l}</button>)}</div>
    {open === 'score' && <Scorekeeper fixed={t.id} T={[]} />}
    {open === 'res' && <QuickResults fixed={t.id} T={[]} />}
    {open === 'bet' && <div className="tx"><select value={w} onChange={e => setW(e.target.value)}><option value="">Winner…</option>{t.seats.map(s => <option key={s.member_id} value={s.member_id}>{s.profiles.display_name}</option>)}</select><button className="pri" disabled={!w} onClick={settle}>Pay out</button></div>}
  </div>
}

const RS = { in: 'Said yes', maybe: 'Maybe', out: "Can't make it" }
const RS_ORDER = { in: 0, maybe: 1, none: 2, out: 3 }

function Attendance({ eventId, M, rs, att }) {
  const qc = useQueryClient(), [ht, setHt] = useState(''), [msg, setMsg] = useState('')
  const present = new Set(att.map(a => a.member_id)), unpaid = att.filter(a => !a.bonus_paid).length
  const status = id => rs.find(r => r.member_id === id)?.status
  const list = [...M].sort((a, b) => RS_ORDER[status(a[0]) ?? 'none'] - RS_ORDER[status(b[0]) ?? 'none'])
  const done = () => qc.invalidateQueries()
  const toggle = async id => { if (present.has(id)) await sb.from('attendance').delete().match({ event_id: eventId, member_id: id }); else await sb.from('attendance').insert({ event_id: eventId, member_id: id }); done() }
  const markYes = async () => { const rows = rs.filter(r => r.status === 'in' && !present.has(r.member_id)).map(r => ({ event_id: eventId, member_id: r.member_id })); if (rows.length) await sb.from('attendance').insert(rows); done() }
  const pay = async () => { const { error } = await sb.rpc('award_attendance', { p_event: eventId, p_ht: +ht }); setMsg(error ? error.message : `Paid ${ht} HT to ${unpaid} ${unpaid === 1 ? 'member' : 'members'}`); setHt(''); done() }
  return <div className="card"><div className="tx"><h3>Who's here</h3><span className="muted">{att.length} present, {rs.filter(r => r.status === 'in').length} said yes</span></div>
    <button onClick={markYes}>Mark everyone who said yes as present</button>
    {list.map(([id, n]) => <div className="tx row" key={id}><span><b>{n}</b><span className="muted"> {RS[status(id)] || 'No reply'}</span></span>
      <button className={present.has(id) ? 'on' : ''} onClick={() => toggle(id)}>{present.has(id) ? 'Present' : 'Mark present'}</button></div>)}
    <div className="row"><label className="fld"><span>Attendance bonus in HT, paid only to members marked present</span><input type="number" value={ht} onChange={e => setHt(e.target.value)} /></label>
      <button className="pri" disabled={!ht || !unpaid} onClick={pay}>Pay bonus to {unpaid} present {unpaid === 1 ? 'member' : 'members'}</button>{msg && <span className="pos">{msg}</span>}</div></div>
}

function RunEvent({ ev, G, M, run }) {
  const qc = useQueryClient()
  const first = ev.find(e => e.status === 'live') || [...ev].reverse().find(e => e.status === 'upcoming') || ev[0]
  const [sel, setSel] = useState(first?.id || ''), [ann, setAnn] = useState('')
  const e = ev.find(x => x.id === sel)
  const tabs = useData(() => sel ? sb.from('event_games').select('id,table_label,starts_at,games(name),seats(member_id,profiles(display_name))').eq('event_id', sel).order('starts_at') : Promise.resolve({ data: [] }), 'rt' + sel)
  const rs = useData(() => sel ? sb.from('rsvps').select('member_id,status').eq('event_id', sel) : Promise.resolve({ data: [] }), 'rc' + sel)
  const att = useData(() => sel ? sb.from('attendance').select('member_id,bonus_paid').eq('event_id', sel) : Promise.resolve({ data: [] }), 'at' + sel)
  if (!ev.length) return <div className="empty">Create an event first (Events tab)</div>
  if (!tabs || !rs || !att || !e) return <div className="sk" />
  const upd = async patch => { await sb.from('events').update(patch).eq('id', sel); qc.invalidateQueries() }
  return <>
    <div className="card"><select value={sel} onChange={x => setSel(x.target.value)}>{ev.map(x => <option key={x.id} value={x.id}>{x.name} · {x.status}</option>)}</select>
      <div className="tx"><span className="muted">{rs.filter(r => r.status === 'in').length} going · {rs.filter(r => r.status === 'maybe').length} maybe</span><span className={'pill ' + e.status}>{e.status}</span></div>
      <div className="btns">{e.status !== 'live' && e.status !== 'completed' && <button className="pri" onClick={() => upd({ status: 'live' })}>Start night</button>}
        {e.status === 'live' && <button className="pri" onClick={() => upd({ status: 'completed' })}>End night</button>}</div>
      <div className="tx"><input placeholder="Post an announcement…" value={ann} onChange={x => setAnn(x.target.value)} /><button disabled={!ann} onClick={async () => { await upd({ announcement: ann }); setAnn('') }}>Post</button></div></div>
    {tabs.map(t => <TableCard key={t.id} t={t} M={M} />)}
    {!tabs.length && <div className="empty">No tables yet. Add one below.</div>}
    <F title="＋ Add table" fields={[['game_id', 'Game', 0, G], ['table_label', 'Table name (e.g. T1)'], ['starts_at', 'Start time (optional)', 'datetime-local']]} onSubmit={run(v => sb.from('event_games').insert({ ...clean(v), event_id: sel }))} />
    <Seating key={sel} E={[]} fixed={sel} />
    <Attendance eventId={sel} M={M} rs={rs} att={att} />
  </>
}

function EventsAdmin({ ev, run }) {
  const qc = useQueryClient()
  const set = async (id, status) => { await sb.from('events').update({ status }).eq('id', id); qc.invalidateQueries() }
  return <>
    <F open title="＋ New event" fields={[['name', 'Event name'], ['venue', 'Venue'], ['starts_at', 'Date & time', 'datetime-local']]} onSubmit={run(v => sb.from('events').insert(v))} />
    {ev.map(e => <div className="card" key={e.id}><div className="tx"><div><b>{e.name}</b><p className="muted">{new Date(e.starts_at).toLocaleString()}</p></div>
      <select style={{ width: 130 }} value={e.status} onChange={x => set(e.id, x.target.value)}>{['upcoming', 'live', 'completed', 'cancelled'].map(s => <option key={s}>{s}</option>)}</select></div></div>)}</>
}

function MemberRow({ x, role, owner, self }) {
  const qc = useQueryClient(), [open, setOpen] = useState(false), [amt, setAmt] = useState(''), [why, setWhy] = useState('')
  const go = async s => {
    const { data } = await sb.auth.getUser()
    await sb.from('transactions').insert({ member_id: x.member_id, amount: s * Math.abs(+amt), reason: why || (s > 0 ? 'Admin bonus' : 'Admin deduction'), created_by: data.user.id })
    setAmt(''); setWhy(''); setOpen(false); qc.invalidateQueries()
  }
  return <div className="card"><div className="tx tap" onClick={() => setOpen(!open)}><b>{x.avatar || ''} {x.display_name}</b>{role?.is_admin && <span className="pill upcoming">{role.is_owner ? 'Owner' : 'Admin'}</span>}<span>{fmt(x.balance)} ▾</span></div>
    {open && <><input type="number" placeholder="Amount" value={amt} onChange={e => setAmt(e.target.value)} /><input placeholder="Reason (optional)" value={why} onChange={e => setWhy(e.target.value)} />
      <div className="btns"><button className="pri" disabled={!amt} onClick={() => go(1)}>＋ Add</button><button disabled={!amt} onClick={() => go(-1)}>− Deduct</button></div>
      <button onClick={async () => { await sb.from('profiles').update({ title: null, frame: null }).eq('id', x.member_id); qc.invalidateQueries() }}>Reset title and frame</button>
      {owner && !self && <><button onClick={async () => { const { error } = await sb.rpc('set_admin', { p_id: x.member_id, p_admin: !role?.is_admin }); if (error) alert(error.message); qc.invalidateQueries() }}>{role?.is_admin ? 'Remove admin rights' : 'Make admin'}</button>
        <p className="muted">Admins can run events, record results and edit tokens. They see the Admin tab after they refresh.</p></>}</>}</div>
}

function JoinCard() {
  const qc = useQueryClient(), [copied, setCopied] = useState(false)
  const s = useData(() => sb.from('club_settings').select('key,value'), 'cs')
  if (!s) return <div className="sk" />
  const get = k => s.find(x => x.key === k)?.value, code = get('join_code'), open = get('join_open') === 'true'
  const link = `${location.origin}/?join=${code}`
  const set = async (k, v) => { await sb.from('club_settings').upsert({ key: k, value: v }); qc.invalidateQueries() }
  return <div className="card"><h3>Invite friends</h3>
    <p className="muted">Share this link in your group chat. Friends create their own account in under a minute.</p>
    <input readOnly value={link} onFocus={e => e.target.select()} />
    <div className="btns"><button className="pri" onClick={async () => { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500) }}>{copied ? 'Copied' : 'Copy link'}</button>
      <a href={'https://wa.me/?text=' + encodeURIComponent(`Join our Secret Shuffle card club: ${link} (club code: ${code})`)} target="_blank" rel="noreferrer"><button>Share on WhatsApp</button></a></div>
    <div className="tx row"><span>Club code: <b>{code}</b></span><button onClick={() => set('join_code', crypto.randomUUID().slice(0, 8))}>New code</button></div>
    <div className="tx row"><span>{open ? 'Joining is open' : 'Joining is closed'}</span><button onClick={() => set('join_open', open ? 'false' : 'true')}>{open ? 'Close joining' : 'Open joining'}</button></div>
    <p className="muted">A new code stops the old link from working. Existing members keep their accounts.</p></div>
}

function MembersAdmin({ m, M, run }) {
  const qc = useQueryClient()
  const ac = useData(() => sb.from('achievements').select('id,name'), 'aa')
  const roles = useData(() => sb.from('profiles').select('id,is_admin,is_owner'), 'ar')
  const uid = useData(() => sb.auth.getUser().then(r => ({ data: r.data.user.id })), 'uid')
  if (!ac || !roles || !uid) return <div className="sk" />
  return <>
    <JoinCard />
    <F title="＋ Add a member yourself" fields={[['display_name', 'Name'], ['email', 'Email', 'email'], ['password', 'Temporary password', 'password']]}
      onSubmit={async v => { const { data } = await sb.auth.getSession(); const r = await fetch('/api/invite', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + data.session.access_token }, body: JSON.stringify(v) }); let j = {}; try { j = await r.json() } catch { /* empty body */ } qc.invalidateQueries(); return { error: r.ok ? null : { message: j.error || `Invite failed (${r.status}). Check SUPABASE_SERVICE_ROLE_KEY in .env, then restart the dev server.` } } }} />
    <F title="Award achievement" fields={[['member_id', 'Member', 0, M], ['achievement_id', 'Achievement', 0, ac.map(a => [a.id, a.name])]]} onSubmit={run(v => sb.from('member_achievements').insert(v))} />
    <p className="muted" style={{ margin: '4px 0 8px' }}>Tap a member to add or deduct tokens</p>{m.map(x => <MemberRow key={x.member_id} x={x} role={roles.find(r => r.id === x.member_id)} owner={roles.find(r => r.id === uid)?.is_owner} self={x.member_id === uid} />)}</>
}

function GameRow({ g }) {
  const qc = useQueryClient(), r = g.token_rules, [open, setOpen] = useState(false), [v, setV] = useState({ win: r.win, second: r.second, third: r.third, participation: r.participation })
  const save = async () => { await sb.from('games').update({ token_rules: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, +x])) }).eq('id', g.id); setOpen(false); qc.invalidateQueries() }
  return <div className="card"><div className="tx tap" onClick={() => setOpen(!open)}><div><b>{g.name}</b><p className="muted">{g.min_players}–{g.max_players} players · {r.win} {r.second} {r.third} · others {r.participation}</p></div><span>▾</span></div>
    {open && <><div className="stats" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>{[['win', '1st'], ['second', '2nd'], ['third', '3rd'], ['participation', 'Others']].map(([k, l]) =>
      <label className="fld" key={k}><span>{l}</span><input type="number" value={v[k]} onChange={e => setV({ ...v, [k]: e.target.value })} /></label>)}</div>
      <button className="pri" onClick={save}>Save HT rules</button></>}</div>
}

const KINDS = [['perk', 'Perk the host fulfils'], ['title', 'Custom player title'], ['announcement', 'Noticeboard post'], ['challenge', 'Player challenge'], ['frame', 'Profile frame'], ['mystery', 'Mystery box']]

function ShopItems({ run }) {
  const qc = useQueryClient()
  const it = useData(() => sb.from('shop_items').select('*').order('cost'), 'sa')
  if (!it) return null
  const toggle = async x => { await sb.from('shop_items').update({ active: !x.active }).eq('id', x.id); qc.invalidateQueries() }
  return <>
    <F title="＋ Add shop item" fields={[['name', 'Item'], ['description', 'Description (optional)'], ['cost', 'Cost (HT)', 'number'], ['kind', 'Type', 0, KINDS], ['asks', 'Question for the buyer (optional)'],
      ['stock', 'Stock, blank for unlimited (optional)', 'number'], ['black_market', 'Show in the Black Market?', 0, [['false', 'No'], ['true', 'Yes, limited time']]], ['ends_at', 'Ends at (optional)', 'datetime-local']]}
      onSubmit={run(v => sb.from('shop_items').insert({ ...clean(v), cost: +v.cost, stock: v.stock ? +v.stock : null, black_market: v.black_market === 'true', ends_at: v.ends_at ? new Date(v.ends_at).toISOString() : null }))} />
    <div className="card list">{it.map(x => <div className="li" key={x.id}><span className="grow"><span className="nm">{x.name}</span>
      <span className="muted">{x.cost} HT{x.black_market ? ', Black Market' : ''}{x.stock != null ? `, ${x.stock} left` : ''}{x.ends_at ? `, ends ${new Date(x.ends_at).toLocaleDateString()}` : ''}</span></span>
      <button onClick={() => toggle(x)}>{x.active ? 'Hide' : 'Show'}</button></div>)}</div></>
}

function GamesAdmin({ g, run }) {
  const qc = useQueryClient()
  const pur = useData(() => sb.from('purchases').select('id,note,profiles(display_name),shop_items(name)').eq('fulfilled', false), 'pu')
  if (!pur) return <div className="sk" />
  return <>
    <F title="＋ Add game" fields={[['name', 'Name'], ['description', 'Short description'], ['min_players', 'Min players', 'number'], ['max_players', 'Max players', 'number'], ['duration_min', 'Minutes', 'number']]} onSubmit={run(v => sb.from('games').insert(v))} />
    {g.map(x => <GameRow key={x.id} g={x} />)}
    <h3 style={{ margin: '16px 0 8px' }}>Shop</h3>
    <ShopItems run={run} />
    <div className="card"><h3>Pending orders</h3>{pur.map(p => <div className="tx row" key={p.id}><span>{p.profiles.display_name} bought {p.shop_items.name}{p.note && <><br /><span className="muted">{p.note}</span></>}</span>
      <button onClick={async () => { await sb.from('purchases').update({ fulfilled: true }).eq('id', p.id); qc.invalidateQueries() }}>Done</button></div>)}{!pur.length && <p className="muted">No pending orders</p>}</div></>
}

function SeasonsAdmin({ E, M, run }) {
  const qc = useQueryClient()
  const ss = useData(() => sb.from('seasons').select('*').order('starts_on', { ascending: false }), 'ss')
  if (!ss) return <div className="sk" />
  const call = async (fn, a) => { await sb.rpc(fn, a); qc.invalidateQueries() }
  return <>
    <F title="＋ New season" fields={[['name', 'Season name']]} onSubmit={run(v => sb.from('seasons').insert(v))} />
    {ss.map(s => <div className="card" key={s.id}><div className="tx"><div><b>{s.name} {s.is_active && <span className="pill live">active</span>}</b><p className="muted">from {s.starts_on}{s.ends_on ? ' to ' + s.ends_on : ''}</p></div>
      {s.is_active ? <button onClick={() => call('close_season')}>Close</button> : <button onClick={() => call('set_active_season', { p_id: s.id })}>Activate</button>}</div></div>)}
    <h3 style={{ margin: '16px 0 8px' }}>Tournaments</h3><Tournaments E={E} M={M} /></>
}

function DataAdmin({ M }) {
  const qc = useQueryClient()
  const log = useData(() => sb.from('audit_log').select('*').order('id', { ascending: false }).limit(30), 'au')
  if (!log) return <div className="sk" />
  const name = id => M.find(x => x[0] === id)?.[1] || '—'
  const undo = async a => { await sb.from(a.tbl).delete().eq('id', a.detail.id); qc.invalidateQueries() }
  return <><div className="card"><h3>Export</h3><div className="btns"><button onClick={async () => dl('transactions', (await sb.from('transactions').select('*')).data)}>Transactions CSV</button>
    <button onClick={async () => dl('results', (await sb.from('results').select('*')).data)}>Results CSV</button></div></div>
    <div className="card"><h3>Recent changes</h3>{log.map(a => <div className="tx row" key={a.id}><span className="muted">{a.op === 'INSERT' ? '' : ''} {a.tbl} · {name(a.detail.member_id)} · {a.detail.amount ?? '#' + a.detail.position}</span>
      {a.op === 'INSERT' && (a.tbl === 'results' || !a.detail.result_id) && <button onClick={() => undo(a)}>Undo</button>}</div>)}</div></>
}

export default function Admin() {
  const [sec, setSec] = useState('Run event'), qc = useQueryClient()
  const ev = useData(() => sb.from('events').select('id,name,status,starts_at,announcement').order('starts_at', { ascending: false }), 'ae')
  const m = useData(() => sb.from('lb_cache').select('member_id,display_name,avatar,balance').order('display_name'), 'am')
  const g = useData(() => sb.from('games').select('*').order('name'), 'ag')
  if (!ev || !m || !g) return <div className="sk" />
  const run = fn => async v => { const r = await fn(v); qc.invalidateQueries(); return r }
  const E = ev.map(x => [x.id, x.name]), M = m.map(x => [x.member_id, x.display_name]), G = g.map(x => [x.id, x.name])
  const body = { 'Run event': <RunEvent ev={ev} G={G} M={M} run={run} />, Events: <EventsAdmin ev={ev} run={run} />, Members: <MembersAdmin m={m} M={M} run={run} />,
    Games: <GamesAdmin g={g} run={run} />, Seasons: <SeasonsAdmin E={E} M={M} run={run} />, Data: <DataAdmin M={M} /> }[sec]
  return <><div className="seg">{SECS.map(s => <button key={s} className={sec === s ? 'on' : ''} onClick={() => setSec(s)}>{s}</button>)}</div>{body}</>
}
