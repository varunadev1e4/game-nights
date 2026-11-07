import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { sb } from './supabase'
import { useData } from './App'

const hm = d => new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

export function NextUp({ mine }) {
  const t = mine.filter(x => x.starts_at && new Date(x.starts_at) > new Date()).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))[0]
  return t ? <p className="note">Next up: {t.games.name} · {t.table_label} at {hm(t.starts_at)}</p> : null
}

export function Recap() {
  const [s, setS] = useState('')
  const ss = useData(() => sb.from('seasons').select('*').order('starts_on', { ascending: false }), 'ss')
  const r = useData(() => sb.from('results').select('member_id,position,points,event_games(games(name),events(starts_at)),profiles(display_name)'), 'rr')
  const tx = useData(() => sb.from('transactions').select('amount,created_at,profiles(display_name)').gt('amount', 0), 'rt')
  if (!ss || !r || !tx) return <div className="sk" />
  const season = ss.find(x => x.id === (s || ss.find(y => y.is_active)?.id || ss[0]?.id))
  if (!season) return <p>No seasons yet.</p>
  const inS = d => { const t = new Date(d).toISOString().slice(0, 10); return t >= season.starts_on && (!season.ends_on || t <= season.ends_on) }
  const rs = r.filter(x => inS(x.event_games.events.starts_at))
  const top = (rows, val) => { const m = {}; rows.forEach(x => { const n = x.profiles.display_name; m[n] = (m[n] || 0) + val(x) }); const e = Object.entries(m).sort((a, b) => b[1] - a[1])[0]; return e ? `${e[0]} (${e[1]})` : '—' }
  const g = {}; rs.forEach(x => { const n = x.event_games.games.name; g[n] = (g[n] || 0) + 1 }); const fav = Object.entries(g).sort((a, b) => b[1] - a[1])[0]
  const rows = [['Champion', top(rs, x => x.points)], ['Most wins', top(rs.filter(x => x.position === 1), () => 1)],
    ['Top earner', top(tx.filter(x => inS(x.created_at)), x => x.amount)], ['Most played', fav ? `${fav[0]} (${fav[1]})` : '—'], ['Games played', rs.length]]
  return <div className="card"><h3>Season recap</h3>
    <select value={season.id} onChange={e => setS(e.target.value)}>{ss.map(x => <option key={x.id} value={x.id}>{x.name}{x.is_active ? ' (active)' : ''}</option>)}</select>
    {rows.map(([k, v]) => <div className="tx row" key={k}><span>{k}</span><b>{v}</b></div>)}</div>
}

export function Gallery({ me }) {
  const qc = useQueryClient(), [ev, setEv] = useState(''), [msg, setMsg] = useState('')
  const events = useData(() => sb.from('events').select('id,name').order('starts_at', { ascending: false }), 'ge')
  const ph = useData(() => sb.from('photos').select('*, profiles(display_name)').order('created_at', { ascending: false }), 'gp')
  if (!events || !ph) return <div className="sk" />
  const url = p => sb.storage.from('photos').getPublicUrl(p).data.publicUrl
  const up = async e => {
    const f = e.target.files[0]
    if (!f || !ev) return setMsg('Pick an event first')
    if (f.size > 5e6) return setMsg('Max 5 MB')
    const path = `${ev}/${crypto.randomUUID()}-${f.name.replace(/[^\w.]/g, '_')}`
    const u = await sb.storage.from('photos').upload(path, f)
    if (u.error) return setMsg(u.error.message)
    const { error } = await sb.from('photos').insert({ event_id: ev, path }); setMsg(error ? error.message : 'Uploaded ✓'); qc.invalidateQueries()
  }
  const del = async p => { await sb.storage.from('photos').remove([p.path]); await sb.from('photos').delete().eq('id', p.id); qc.invalidateQueries() }
  return <div className="card"><h3>Gallery</h3>
    <select value={ev} onChange={e => setEv(e.target.value)}><option value="">All events</option>{events.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
    <input type="file" accept="image/*" onChange={up} /><span className="muted">{msg}</span>
    <div className="gal">{ph.filter(p => !ev || p.event_id === ev).map(p => <figure key={p.id}><img loading="lazy" src={url(p.path)} alt="" />
      <figcaption className="muted">{p.profiles.display_name} {(p.member_id === me.id || me.is_admin) && <button onClick={() => del(p)}>✕</button>}</figcaption></figure>)}</div></div>
}

export function Brackets() {
  const t = useData(() => sb.from('tournaments').select('*').order('created_at', { ascending: false }), 'tt')
  const m = useData(() => sb.from('tournament_matches').select('*'), 'tm')
  const p = useData(() => sb.from('profiles').select('id,display_name'), 'tp')
  if (!t || !m || !p) return <div className="sk" />
  const nm = (id, r) => p.find(x => x.id === id)?.display_name || (r === 1 ? 'Bye' : 'TBD')
  if (!t.length) return <div className="card">No tournaments yet.</div>
  return t.map(x => {
    const ms = m.filter(y => y.tournament_id === x.id), rounds = Math.max(0, ...ms.map(y => y.round)), fin = ms.find(y => y.round === rounds)
    return <div className="card" key={x.id}><h3>{x.name}{fin?.winner && ` · ${nm(fin.winner)}`}</h3>
      {Array.from({ length: rounds }, (_, i) => i + 1).map(r => <div className="row" key={r}><b>{r === rounds ? 'Final' : 'Round ' + r}</b>
        {ms.filter(y => y.round === r).sort((a, b) => a.slot - b.slot).map(y => <div className="tx" key={y.id}><span>{nm(y.p1, r)} vs {nm(y.p2, r)}</span><b>{y.winner ? '→ ' + nm(y.winner, r) : ''}</b></div>)}</div>)}</div>
  })
}
