import { useState, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { sb } from './supabase'
import { useData, F } from './App'

export const dl = (name, rows) => {
  const h = Object.keys(rows[0] || {}), esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([[h.join(','), ...rows.map(r => h.map(k => esc(r[k])).join(','))].join('\n')], { type: 'text/csv' }))
  a.download = name + '.csv'; a.click()
}

function Timer() {
  const [left, setLeft] = useState(0), [min, setMin] = useState(10), [on, setOn] = useState(false)
  useEffect(() => { if (!on) return; const i = setInterval(() => setLeft(l => Math.max(l - 1, 0)), 1000); return () => clearInterval(i) }, [on])
  useEffect(() => { if (on && left === 0) setOn(false) }, [left, on])
  const f = n => String(n).padStart(2, '0')
  return <div className="tx"><b>{f(Math.floor(left / 60))}:{f(left % 60)}</b><span><input type="number" style={{ width: 70 }} value={min} onChange={e => setMin(e.target.value)} /> <button onClick={() => { setLeft(min * 60); setOn(true) }}>Start</button></span></div>
}

const useSeats = eg => useData(() => eg ? sb.from('seats').select('member_id,profiles(display_name)').eq('event_game_id', eg) : Promise.resolve({ data: [] }), 'ks' + eg)

export function Scorekeeper({ T, fixed }) {
  const qc = useQueryClient(), [eg, setEg] = useState(fixed || ''), [vals, setVals] = useState({}), [low, setLow] = useState(false), [msg, setMsg] = useState('')
  const seats = useSeats(eg)
  const sc = useData(() => eg ? sb.from('scores').select('*').eq('event_game_id', eg) : Promise.resolve({ data: [] }), 'kc' + eg)
  const ready = eg && seats && sc
  const tot = m => sc.filter(x => x.member_id === m).reduce((a, x) => a + x.score, 0), round = ready ? sc.reduce((a, x) => Math.max(a, x.round), 0) : 0
  const add = async () => {
    const rows = seats.filter(s => (vals[s.member_id] ?? '') !== '').map(s => ({ event_game_id: eg, member_id: s.member_id, round: round + 1, score: +vals[s.member_id] }))
    const { error } = await sb.from('scores').insert(rows); setMsg(error ? error.message : `Round ${round + 1} saved`); setVals({}); qc.invalidateQueries()
  }
  const finish = async () => {
    const order = [...seats].sort((a, b) => low ? tot(a.member_id) - tot(b.member_id) : tot(b.member_id) - tot(a.member_id))
    const { error } = await sb.rpc('record_table', { p_eg: eg, p_rows: order.map((s, i) => ({ member: s.member_id, pos: i + 1, pts: order.length - i })) })
    setMsg(error ? error.message : 'Results recorded ✓'); qc.invalidateQueries()
  }
  return <div className="card"><h3>Live scorekeeper</h3>
    {!fixed && <select value={eg} onChange={e => setEg(e.target.value)}><option value="">Table</option>{T.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>}
    {ready && <><Timer />
      {seats.map(s => <div className="tx row" key={s.member_id}><span>{s.profiles.display_name} · <b>{tot(s.member_id)}</b></span>
        <input type="number" style={{ width: 90 }} placeholder={`Round ${round + 1}`} value={vals[s.member_id] ?? ''} onChange={e => setVals({ ...vals, [s.member_id]: e.target.value })} /></div>)}
      <label className="muted"><input type="checkbox" checked={low} onChange={e => setLow(e.target.checked)} /> Lowest total wins</label>
      <div><button onClick={add}>Add round</button> <button onClick={finish}>Finish → record results</button></div></>}
    <span className="muted">{msg}</span></div>
}

export function QuickResults({ T, fixed }) {
  const qc = useQueryClient(), [eg, setEg] = useState(fixed || ''), [pos, setPos] = useState({}), [msg, setMsg] = useState('')
  const seats = useSeats(eg)
  const save = async () => {
    const rows = seats.map(s => ({ member: s.member_id, pos: +pos[s.member_id], pts: Math.max(seats.length - +pos[s.member_id] + 1, 0) }))
    const { error } = await sb.rpc('record_table', { p_eg: eg, p_rows: rows }); setMsg(error ? error.message : 'Saved ✓'); if (!error) setPos({}); qc.invalidateQueries()
  }
  return <div className="card"><h3>Record whole table</h3>
    {!fixed && <select value={eg} onChange={e => setEg(e.target.value)}><option value="">Table</option>{T.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>}
    {eg && seats && <>{seats.map(s => <div className="tx row" key={s.member_id}><span>{s.profiles.display_name}</span>
      <input type="number" style={{ width: 90 }} placeholder="Position" value={pos[s.member_id] ?? ''} onChange={e => setPos({ ...pos, [s.member_id]: e.target.value })} /></div>)}
      <button disabled={seats.some(s => !pos[s.member_id])} onClick={save}>Save results</button></>}
    <span className="muted">{msg}</span></div>
}

export function AdminLive({ M, E, T, run }) {
  const qc = useQueryClient()
  const log = useData(() => sb.from('audit_log').select('*').order('id', { ascending: false }).limit(30), 'au')
  const pur = useData(() => sb.from('purchases').select('id,profiles(display_name),shop_items(name)').eq('fulfilled', false), 'pu')
  if (!log || !pur) return null
  const name = id => M.find(x => x[0] === id)?.[1] || '—'
  const undo = async a => { await sb.from(a.tbl).delete().eq('id', a.detail.id); qc.invalidateQueries() }
  return <>
    <Scorekeeper T={T} /><QuickResults T={T} />
    <F title="Settle side bets" fields={[['eg', 'Table', 0, T], ['winner', 'Winner', 0, M]]} onSubmit={run(v => sb.rpc('settle_bets', { p_eg: v.eg, p_winner: v.winner }))} />
    <F title="Attendance bonus (RSVP 'in')" fields={[['event', 'Event', 0, E], ['ht', 'HT each', 'number']]} onSubmit={run(v => sb.rpc('award_attendance', { p_event: v.event, p_ht: +v.ht }))} />
    <F title="Add shop item" fields={[['name', 'Item'], ['description', 'Description'], ['cost', 'Cost HT', 'number']]} onSubmit={run(v => sb.from('shop_items').insert(v))} />
    <F title="Invite member" fields={[['display_name', 'Name'], ['email', 'Email', 'email'], ['password', 'Temp password', 'password']]}
      onSubmit={async v => { const { data } = await sb.auth.getSession(); const r = await fetch('/api/invite', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + data.session.access_token }, body: JSON.stringify(v) }); const j = await r.json(); qc.invalidateQueries(); return { error: r.ok ? null : { message: j.error } } }} />
    <div className="card"><h3>Shop orders</h3>{pur.map(p => <div className="tx row" key={p.id}><span>{p.profiles.display_name} · {p.shop_items.name}</span>
      <button onClick={async () => { await sb.from('purchases').update({ fulfilled: true }).eq('id', p.id); qc.invalidateQueries() }}>Done</button></div>)}{!pur.length && <p className="muted">No pending orders</p>}</div>
    <div className="card"><h3>Export</h3><div><button onClick={async () => dl('transactions', (await sb.from('transactions').select('*')).data)}>Transactions CSV</button> <button onClick={async () => dl('results', (await sb.from('results').select('*')).data)}>Results CSV</button></div></div>
    <div className="card"><h3>Audit log</h3>{log.map(a => <div className="tx row" key={a.id}><span className="muted">{a.op} {a.tbl} · {name(a.detail.member_id)} · {a.detail.amount ?? '#' + a.detail.position}</span>
      {a.op === 'INSERT' && (a.tbl === 'results' || !a.detail.result_id) && <button onClick={() => undo(a)}>Undo</button>}</div>)}</div>
  </>
}
