import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { sb } from './supabase'
import { useData } from './App'

const sign = n => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toLocaleString()

function ResultForm({ ev, M, G, done }) {
  const [game, setGame] = useState(''), [label, setLabel] = useState('Round 1'), [rows, setRows] = useState([{ m: '', pos: '1', ht: '' }]), [err, setErr] = useState(''), [busy, setBusy] = useState(false)
  const upd = (i, k, v) => setRows(r => r.map((x, j) => (j === i ? { ...x, [k]: v } : x)))
  const save = async () => {
    const use = rows.filter(r => r.m)
    if (!game) return setErr('Choose the game.')
    if (!use.length) return setErr('Add at least one player.')
    if (new Set(use.map(r => r.m)).size !== use.length) return setErr('A player appears twice.')
    if (use.some(r => !(+r.pos >= 1))) return setErr('Every player needs a position of 1 or more.')
    setBusy(true); const gid = crypto.randomUUID()
    const { error } = await sb.from('night_drafts').insert(use.map(r => ({ event_id: ev, kind: 'result', group_id: gid, game_id: game, label: label.trim() || 'Round', member_id: r.m, position: +r.pos, ht: r.ht === '' ? null : +r.ht })))
    setBusy(false); if (error) return setErr(error.message)
    setRows([{ m: '', pos: '1', ht: '' }]); setLabel(l => l.replace(/\d+$/, n => String(+n + 1))); setErr(''); done('Game result saved')
  }
  return <div className="card"><h3>Add a game result</h3>
    <label className="fld"><span>Game</span><select value={game} onChange={e => setGame(e.target.value)}><option value="">Choose…</option>{G.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select></label>
    <label className="fld"><span>Round or table name</span><input value={label} onChange={e => setLabel(e.target.value)} /></label>
    <p className="muted">Position 1 is the winner. Tokens come from the game's rules. Type a token amount only if you want to replace the rule for that player.</p>
    {rows.map((r, i) => <div className="row" key={i} style={{ flexDirection: 'row', alignItems: 'center', border: 0, paddingTop: 0 }}>
      <select value={r.m} onChange={e => upd(i, 'm', e.target.value)}><option value="">Player…</option>{M.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>
      <input type="number" inputMode="numeric" style={{ width: 64 }} aria-label="Position" value={r.pos} onChange={e => upd(i, 'pos', e.target.value)} />
      <input type="number" inputMode="numeric" style={{ width: 84 }} placeholder="HT" aria-label="Token amount, optional" value={r.ht} onChange={e => upd(i, 'ht', e.target.value)} /></div>)}
    <div className="btns"><button onClick={() => setRows(r => [...r, { m: '', pos: String(r.length + 1), ht: '' }])}>Add a player</button>{rows.length > 1 && <button onClick={() => setRows(r => r.slice(0, -1))}>Remove last</button>}</div>
    <button className="pri" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save this result'}</button>{err && <p className="err">{err}</p>}</div>
}

function TxForm({ ev, M, done }) {
  const [m, setM] = useState(''), [dir, setDir] = useState('won'), [amt, setAmt] = useState(''), [why, setWhy] = useState(''), [err, setErr] = useState('')
  const save = async () => {
    if (!m || !(+amt > 0)) return setErr('Choose a player and type an amount above zero.')
    const { error } = await sb.from('night_drafts').insert({ event_id: ev, kind: 'tx', member_id: m, ht: (dir === 'won' ? 1 : -1) * Math.round(+amt), reason: why.trim() || null })
    if (error) return setErr(error.message)
    setAmt(''); setWhy(''); setErr(''); done('Token change saved')
  }
  return <div className="card"><h3>Add a token change</h3>
    <label className="fld"><span>Player</span><select value={m} onChange={e => setM(e.target.value)}><option value="">Choose…</option>{M.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select></label>
    <div className="seg" style={{ marginBottom: 0 }}>{[['won', 'Won'], ['lost', 'Lost']].map(([k, l]) => <button key={k} className={dir === k ? 'on' : ''} onClick={() => setDir(k)}>{l}</button>)}</div>
    <label className="fld"><span>Amount (HT)</span><input type="number" inputMode="numeric" value={amt} onChange={e => setAmt(e.target.value)} /></label>
    <label className="fld"><span>What for? (optional)</span><input value={why} placeholder="Side bet, challenge, bonus…" onChange={e => setWhy(e.target.value)} /></label>
    <button className="pri" onClick={save}>Save this change</button>{err && <p className="err">{err}</p>}</div>
}

function FinalForm({ ev, M, done }) {
  const [m, setM] = useState(''), [val, setVal] = useState(''), [err, setErr] = useState('')
  const w = useData(() => sb.from('wallet').select('member_id,balance'), 'wb')
  const cur = w?.find(x => x.member_id === m)?.balance
  const save = async () => {
    if (!m || val === '') return setErr('Choose a player and type their final balance.')
    await sb.from('night_drafts').delete().eq('event_id', ev).eq('kind', 'final').eq('member_id', m).is('applied_at', null)
    const { error } = await sb.from('night_drafts').insert({ event_id: ev, kind: 'final', member_id: m, ht: Math.round(+val) })
    if (error) return setErr(error.message)
    setVal(''); setErr(''); done('Final balance saved')
  }
  return <div className="card"><h3>Set a final balance</h3>
    <p className="muted">For when you wrote down how many tokens someone ended with. On apply, their wallet is topped up or trimmed to exactly this number, after everything else.</p>
    <label className="fld"><span>Player</span><select value={m} onChange={e => setM(e.target.value)}><option value="">Choose…</option>{M.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select></label>
    {m && cur != null && <p className="muted">Wallet right now: {Number(cur).toLocaleString()} HT</p>}
    <label className="fld"><span>Final balance (HT)</span><input type="number" inputMode="numeric" value={val} onChange={e => setVal(e.target.value)} /></label>
    <button className="pri" onClick={save}>Save final balance</button>{err && <p className="err">{err}</p>}</div>
}

export function AfterEvent({ ev, M, G }) {
  const qc = useQueryClient()
  const start = ev.find(e => e.status === 'live') || ev.find(e => e.status === 'completed') || ev[0]
  const [sel, setSel] = useState(start?.id || ''), [form, setForm] = useState('result'), [msg, setMsg] = useState(''), [confirm, setConfirm] = useState(false), [finish, setFinish] = useState(true), [busy, setBusy] = useState(false), [err, setErr] = useState('')
  const drafts = useData(() => sel ? sb.from('night_drafts').select('*, profiles(display_name), games(name)').eq('event_id', sel).is('applied_at', null).order('created_at') : Promise.resolve({ data: [] }), 'nd' + sel)
  const prev = useData(() => sel ? sb.rpc('night_preview', { p_event: sel }) : Promise.resolve({ data: [] }), 'np' + sel)
  if (!ev.length) return <div className="empty">Create an event first (Events tab).</div>
  if (!drafts || !prev) return <div className="sk" />
  const done = m => { setMsg(m); setErr(''); qc.invalidateQueries() }
  const groups = Object.values(drafts.filter(d => d.kind === 'result').reduce((a, d) => { (a[d.group_id] ||= { id: d.group_id, game: d.games?.name, label: d.label, rows: [] }).rows.push(d); return a }, {}))
  const txs = drafts.filter(d => d.kind === 'tx'), finals = drafts.filter(d => d.kind === 'final')
  const del = async (col, v) => { await sb.from('night_drafts').delete().eq(col, v); qc.invalidateQueries() }
  const apply = async () => {
    setBusy(true); setErr('')
    const { data, error } = await sb.rpc('night_apply', { p_event: sel, p_complete: finish })
    setBusy(false); setConfirm(false)
    if (error) return setErr(error.message)
    setMsg(`Applied: ${data.results} player results, ${data.transactions} token changes and ${data.adjustments} final-balance adjustments.`); qc.invalidateQueries()
  }
  return <>
    <div className="card"><p className="muted">Write down what happened at the party, then type it in here whenever you like. Nothing changes in anyone's wallet until you press Apply at the bottom.</p>
      <select value={sel} onChange={e => { setSel(e.target.value); setMsg(''); setConfirm(false) }}>{ev.map(x => <option key={x.id} value={x.id}>{x.name} ({x.status})</option>)}</select></div>
    <div className="seg">{[['result', 'Game result'], ['tx', 'Token change'], ['final', 'Final balance']].map(([k, l]) => <button key={k} className={form === k ? 'on' : ''} onClick={() => setForm(k)}>{l}</button>)}</div>
    {form === 'result' && <ResultForm ev={sel} M={M} G={G} done={done} />}
    {form === 'tx' && <TxForm ev={sel} M={M} done={done} />}
    {form === 'final' && <FinalForm ev={sel} M={M} done={done} />}
    {msg && <p className="note">{msg}</p>}
    <h3 className="sub">Saved, waiting to be applied</h3>
    <div className="card list">
      {groups.map(g => <div className="li" key={g.id}><span className="grow"><span className="nm">{g.game} ({g.label})</span>
        <span className="muted">{[...g.rows].sort((a, b) => a.position - b.position).map(r => `${r.position}. ${r.profiles?.display_name}${r.ht != null ? ` (${sign(r.ht)} HT)` : ''}`).join(', ')}</span></span>
        <button onClick={() => del('group_id', g.id)}>Delete</button></div>)}
      {txs.map(t => <div className="li" key={t.id}><span className="grow"><span className="nm">{t.profiles?.display_name} {sign(t.ht)} HT</span><span className="muted">{t.reason || 'No reason given'}</span></span><button onClick={() => del('id', t.id)}>Delete</button></div>)}
      {finals.map(t => <div className="li" key={t.id}><span className="grow"><span className="nm">{t.profiles?.display_name} ends on {Number(t.ht).toLocaleString()} HT</span><span className="muted">Final balance</span></span><button onClick={() => del('id', t.id)}>Delete</button></div>)}
      {!drafts.length && <p className="muted">Nothing saved for this event yet.</p>}</div>
    {prev.length > 0 && <><h3 className="sub">What wallets will look like</h3>
      <div className="card list">{prev.map(p => <div className="li" key={p.member}><span className="grow"><span className="nm">{p.name}</span>
        <span className="muted">now {p.now.toLocaleString()}, games {sign(p.results)}, other {sign(p.tx)}{p.final != null ? `, set to ${p.final.toLocaleString()} (${sign(p.adjust)})` : ''}</span></span>
        <b className="val">{(p.final ?? p.after).toLocaleString()}</b></div>)}</div>
      <p className="muted pad">Automatic bonuses, like a win streak, are added on top when you apply, unless a final balance is set.</p></>}
    <div className="card"><h3>Apply to House Tokens</h3>
      <label className="row" style={{ flexDirection: 'row', alignItems: 'center', border: 0, paddingTop: 0 }}><input type="checkbox" checked={finish} onChange={e => setFinish(e.target.checked)} style={{ flex: 'none' }} /><span>Also mark this event as finished</span></label>
      {!confirm ? <button className="pri" disabled={!drafts.length} onClick={() => setConfirm(true)}>Apply everything</button> : <>
        <p className="note">This adds {groups.length} game {groups.length === 1 ? 'result' : 'results'}, {txs.length} token {txs.length === 1 ? 'change' : 'changes'}{finals.length ? ` and ${finals.length} final ${finals.length === 1 ? 'balance' : 'balances'}` : ''}. Wallets update straight away. If one entry was wrong, undo it later under Data.</p>
        <div className="btns"><button onClick={() => setConfirm(false)}>Cancel</button><button className="pri" disabled={busy} onClick={apply}>{busy ? 'Applying…' : 'Yes, apply now'}</button></div></>}
      {err && <p className="err">{err}</p>}</div></>
}
