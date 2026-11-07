import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { sb } from './supabase'
import { useData } from './App'

const shuffle = a => [...a].sort(() => Math.random() - 0.5)
const pow2 = n => { let s = 2; while (s < n) s *= 2; return s }

export function Seating({ E, fixed }) {
  const qc = useQueryClient(), [ev, setEv] = useState(fixed || ''), [plan, setPlan] = useState(null), [msg, setMsg] = useState('')
  const tabs = useData(() => ev ? sb.from('event_games').select('id,table_label,games(name,max_players)').eq('event_id', ev) : Promise.resolve({ data: [] }), 'sg' + ev)
  const rs = useData(() => ev ? sb.from('rsvps').select('member_id,profiles(display_name)').eq('event_id', ev).eq('status', 'in') : Promise.resolve({ data: [] }), 'sr' + ev)
  const suggest = () => {
    const seats = tabs.map(t => ({ ...t, ps: [] })), left = []
    shuffle(rs).forEach(p => { const t = seats.filter(s => s.ps.length < (s.games.max_players || 99)).sort((a, b) => a.ps.length - b.ps.length)[0]; t ? t.ps.push(p) : left.push(p) })
    setPlan({ seats, left })
  }
  const apply = async () => {
    const rows = plan.seats.flatMap(t => t.ps.map(p => ({ event_game_id: t.id, member_id: p.member_id })))
    const { error } = await sb.from('seats').upsert(rows, { onConflict: 'event_game_id,member_id', ignoreDuplicates: true })
    setMsg(error ? error.message : 'Seated ✓'); setPlan(null); qc.invalidateQueries()
  }
  return <div className="card"><h3>Auto-suggest seating (from RSVPs)</h3>
    {!fixed && <select value={ev} onChange={e => { setEv(e.target.value); setPlan(null) }}><option value="">Event</option>{E.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>}
    {ev && tabs && rs && <button disabled={!tabs.length || !rs.length} onClick={suggest}>Suggest ({rs.length} going, {tabs.length} tables)</button>}
    {plan && <>{plan.seats.map(t => <p className="muted" key={t.id}><b>{t.games.name} {t.table_label}</b>: {t.ps.map(p => p.profiles.display_name).join(', ') || '—'}</p>)}
      {plan.left.length > 0 && <p className="err">No room for: {plan.left.map(p => p.profiles.display_name).join(', ')}</p>}
      <div><button onClick={suggest}>Reshuffle</button> <button onClick={apply}>Apply</button></div></>}
    <span className="muted">{msg}</span></div>
}

export function Tournaments({ E, M }) {
  const qc = useQueryClient(), [name, setName] = useState(''), [ev, setEv] = useState(''), [pick, setPick] = useState([]), [msg, setMsg] = useState('')
  const ts = useData(() => sb.from('tournaments').select('id,name'), 'ta')
  const ms = useData(() => sb.from('tournament_matches').select('*'), 'tm')
  if (!ts || !ms) return null
  const nm = id => M.find(x => x[0] === id)?.[1] || 'TBD'
  const create = async () => {
    const ps = shuffle(pick), size = pow2(ps.length), rounds = Math.log2(size), tid = crypto.randomUUID(), all = []
    for (let r = 1; r <= rounds; r++) for (let s = 0; s < size / 2 ** r; s++) all.push({ id: crypto.randomUUID(), tournament_id: tid, round: r, slot: s, p1: null, p2: null, winner: null, next_id: null, next_slot: null })
    const at = (r, s) => all.find(x => x.round === r && x.slot === s)
    all.forEach(x => { if (x.round < rounds) { x.next_id = at(x.round + 1, x.slot >> 1).id; x.next_slot = x.slot % 2 ? 'p2' : 'p1' } })
    for (let s = 0; s < size / 2; s++) { const m = at(1, s); m.p1 = ps[s] ?? null; m.p2 = ps[size - 1 - s] ?? null }
    all.filter(m => m.round === 1 && (!m.p1 || !m.p2)).forEach(m => { m.winner = m.p1 || m.p2; if (m.next_id) all.find(x => x.id === m.next_id)[m.next_slot] = m.winner })
    const a = await sb.from('tournaments').insert({ id: tid, name, event_id: ev || null })
    const b = a.error ? a : await sb.from('tournament_matches').insert(all)
    setMsg(b.error ? b.error.message : 'Bracket created ✓'); if (!b.error) { setPick([]); setName('') }; qc.invalidateQueries()
  }
  const win = async (m, w) => {
    await sb.from('tournament_matches').update({ winner: w }).eq('id', m.id)
    if (m.next_id) await sb.from('tournament_matches').update({ [m.next_slot]: w }).eq('id', m.next_id)
    qc.invalidateQueries()
  }
  const open = ms.filter(m => m.p1 && m.p2 && !m.winner)
  return <div className="card"><h3>Tournament bracket</h3>
    <input placeholder="Tournament name" value={name} onChange={e => setName(e.target.value)} />
    <select value={ev} onChange={e => setEv(e.target.value)}><option value="">Event (optional)</option>{E.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>
    <div className="muted" style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>{M.map(([id, n]) => <label key={id}><input type="checkbox" checked={pick.includes(id)} onChange={e => setPick(e.target.checked ? [...pick, id] : pick.filter(x => x !== id))} /> {n}</label>)}</div>
    <button disabled={pick.length < 2 || !name} onClick={create}>Create single-elimination bracket</button><span className="muted">{msg}</span>
    {ts.map(t => open.filter(m => m.tournament_id === t.id).map(m => <div className="tx row" key={m.id}><span>{t.name} · R{m.round}</span>
      <span><button onClick={() => win(m, m.p1)}>{nm(m.p1)}</button> <button onClick={() => win(m, m.p2)}>{nm(m.p2)}</button></span></div>))}</div>
}

export function AdminExtra({ E, M }) { return <><Seating E={E} /><Tournaments E={E} M={M} /></> }
