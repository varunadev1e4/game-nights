import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { sb } from "./supabase";
import "./house.css";

const pb = (n) => Number(n ?? 0).toLocaleString() + " HT";
const sgn = (n) =>
  (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n).toLocaleString();
const when = (d) =>
  new Date(d).toLocaleString([], {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
const rpc = async (fn, args) => {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
};
const tbl = async (q) => {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data;
};
const useH = (key, fn, ms = 4000) =>
  useQuery({
    queryKey: ["h", ...[].concat(key)],
    queryFn: fn,
    refetchInterval: ms,
    retry: 1,
  });
const STATUS = {
  setup: "Setup",
  ready: "Ready",
  open: "Open",
  closing: "Closing",
  closed: "Closed",
};
const KIND = {
  start: "Starting balance",
  pvp: "Player vs Player",
  bet: "House bet",
  pot: "Game pot",
  reward: "House reward",
  loan_issue: "Loan issued",
  loan_repay: "Loan repayment",
  reversal: "Reversal",
};
const TITLES = ["The House Boss", "Silver Spoon", "Bronze Tycoon"];

const save = (name, text, type) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
};
const csv = (name, rows) => {
  if (!rows.length) return;
  const h = Object.keys(rows[0]),
    esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  save(
    name + ".csv",
    [h.join(","), ...rows.map((r) => h.map((k) => esc(r[k])).join(","))].join(
      "\n",
    ),
    "text/csv",
  );
};
const summary = (t) =>
  (t.lines || [])
    .filter((l) => l.account === "player")
    .map(
      (l) =>
        `${l.name} ${sgn(l.cash)}${l.loan ? ` (loan ${sgn(l.loan)})` : ""}`,
    )
    .join(", ") || "No balance change";

export default function House({ hash, session }) {
  const r = hash.replace("#", "");
  if (r === "house-tv") return <TV />;
  if (r === "house-board") return <Board />;
  if (r === "house-me") return <Lookup />;
  return <Staff session={session} />;
}

/* ---------- Public: TV, leaderboard, player lookup ---------- */
function TV() {
  const d = useH("pub", () => rpc("house_public"), 4000).data;
  if (!d)
    return (
      <div className="hs tv">
        <h1>Loading…</h1>
      </div>
    );
  const top = d.board.slice(0, 3),
    rest = d.board.slice(3),
    order = [1, 0, 2].filter((i) => top[i]);
  return (
    <div className="hs tv">
      <div className="tvhd">
        <h1>{d.name}</h1>
        <span className={"st st-" + d.status}>{STATUS[d.status]}</span>
      </div>
      <div className="tvmain">
        <div>
          <div className="podium">
            {order.map((i) => (
              <div key={top[i].id} className={"pod p" + (i + 1)}>
                <span className="t">{TITLES[i]}</span>
                <span className="n">{top[i].name}</span>
                <span className="v">{pb(top[i].net)}</span>
                <span className="t">night {sgn(top[i].change)} HT</span>
              </div>
            ))}
          </div>
          <div
            className="list"
            style={{ height: `calc(${rest.length} * var(--rh))` }}
          >
            {rest.map((p) => (
              <div
                key={p.id}
                className="tvrow"
                style={{ top: `calc(${p.pos - 4} * var(--rh))` }}
              >
                <span className="rk">{p.rank}</span>
                <span className="nm">{p.name}</span>
                <span className="mu">
                  night {sgn(p.change)}
                  {p.loan ? `, loan ${p.loan}` : ""}
                </span>
                <b>{pb(p.net)}</b>
              </div>
            ))}
          </div>
        </div>
        <aside>
          <div className="card">
            <h3>Now playing</h3>
            {d.current.length ? (
              d.current.map((n) => <b key={n}>{n}</b>)
            ) : (
              <span className="mu">Waiting for the next game</span>
            )}
          </div>
          <div className="card">
            <h3>Recent winners</h3>
            {d.recent.slice(0, 5).map((x, i) => (
              <div key={i}>
                <b>{x.winners || "No winner"}</b>
                <span className="mu"> won {x.game}</span>
              </div>
            ))}
            {!d.recent.length && <span className="mu">No results yet</span>}
          </div>
          <div className="card">
            <h3>Awards</h3>
            {d.awards.comeback && (
              <div>
                <span className="mu">Biggest Comeback </span>
                <b>{d.awards.comeback}</b>
              </div>
            )}
            {d.awards.disaster && (
              <div>
                <span className="mu">Financial Disaster </span>
                <b>{d.awards.disaster}</b>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function Board() {
  const [by0, setBy] = useState(null);
  const d = useH("pub", () => rpc("house_public"), 5000).data;
  if (!d)
    return (
      <div className="hs">
        <p className="mu pad">Loading…</p>
      </div>
    );
  const by = by0 || d.rank_by,
    rows = [...d.board].sort((a, b) => b[by] - a[by]);
  return (
    <div className="hs">
      <div className="wrap">
        <div className="hd">
          <h1>{d.name}</h1>
          <span className={"st st-" + d.status}>{STATUS[d.status]}</span>
        </div>
        <div className="seg">
          {[
            ["change", "Night result"],
            ["net", "Net worth"],
            ["cash", "Cash"],
            ["won", "Winnings"],
          ].map(([k, l]) => (
            <button
              key={k}
              className={by === k ? "on" : ""}
              onClick={() => setBy(k)}
            >
              {l}
            </button>
          ))}
        </div>
        <div className="card">
          {rows.map((p, i) => (
            <div className="li" key={p.id}>
              <div>
                <b>
                  {i + 1}. {p.name}
                </b>
                {by === d.rank_by && i < 3 && (
                  <span className="badge" style={{ marginLeft: 8 }}>
                    {TITLES[i]}
                  </span>
                )}
                <p className="mu">
                  net {pb(p.net)}, night {sgn(p.change)}
                  {p.loan ? `, loan ${pb(p.loan)}` : ""}
                </p>
              </div>
              <b>{by === "change" ? sgn(p.change) + " HT" : pb(p[by])}</b>
            </div>
          ))}
        </div>
        {(d.awards.comeback || d.awards.disaster) && (
          <div className="card">
            <h3>Awards</h3>
            {d.awards.comeback && (
              <p className="mu">
                Biggest Comeback: <b>{d.awards.comeback}</b>
              </p>
            )}
            {d.awards.disaster && (
              <p className="mu">
                Financial Disaster: <b>{d.awards.disaster}</b>
              </p>
            )}
          </div>
        )}
        <h3 style={{ margin: "16px 0 8px" }}>Completed games</h3>
        <div className="card">
          {d.recent.map((x, i) => (
            <div className="li" key={i}>
              <div>
                <b>{x.game}</b>
                <p className="mu">{x.note}</p>
              </div>
              <span>{x.winners || "-"}</span>
            </div>
          ))}
          {!d.recent.length && <p className="mu">No results yet</p>}
        </div>
        <a className="btnlink" href="#house-me">
          Check my balance
        </a>
      </div>
    </div>
  );
}

function Lookup() {
  const [f, setF] = useState({ code: "", pin: "" }),
    [res, setRes] = useState(null),
    [busy, setBusy] = useState(false);
  const go = async (e) => {
    e.preventDefault();
    setBusy(true);
    const { data, error } = await sb.rpc("house_lookup", {
      p_code: f.code,
      p_pin: f.pin,
    });
    setBusy(false);
    setRes(error ? { error: error.message } : data);
  };
  return (
    <div className="hs">
      <div className="wrap">
        <div className="hd">
          <h1>My balance</h1>
          <a className="btnlink" href="#house-board">
            Leaderboard
          </a>
        </div>
        {!res || res.error ? (
          <form className="card" onSubmit={go}>
            <label className="fld">
              <span>Player ID (like P07)</span>
              <input
                autoCapitalize="characters"
                value={f.code}
                onChange={(e) => setF({ ...f, code: e.target.value })}
              />
            </label>
            <label className="fld">
              <span>Your PIN</span>
              <input
                type="password"
                inputMode="numeric"
                value={f.pin}
                onChange={(e) => setF({ ...f, pin: e.target.value })}
              />
            </label>
            <button className="pri big" disabled={busy || !f.code || !f.pin}>
              {busy ? "Checking…" : "Show my statement"}
            </button>
            {res?.error && <p className="err">{res.error}</p>}
          </form>
        ) : (
          <>
            <div className="card">
              <h2>{res.name}</h2>
              <p className="mu">
                {res.code}, ranked #{res.rank}
              </p>
            </div>
            <div className="grid">
              <div className="stat">
                <b>{pb(res.cash)}</b>
                <span>Cash</span>
              </div>
              <div className="stat">
                <b>{pb(res.loan)}</b>
                <span>Outstanding loan</span>
              </div>
              <div className="stat">
                <b>{pb(res.net)}</b>
                <span>Net worth</span>
              </div>
              <div className="stat">
                <b>{sgn(res.change)} HT</b>
                <span>Casino night result</span>
              </div>
              <div className="stat">
                <b>{res.games}</b>
                <span>Games played</span>
              </div>
            </div>
            <div className="card">
              <h3>Statement</h3>
              {res.history.map((h) => (
                <div className="li" key={h.seq}>
                  <div>
                    <b>{KIND[h.kind]}</b>
                    <p className="mu">
                      {h.game ? h.game + ", " : ""}
                      {when(h.at)}
                      {h.note ? ", " + h.note : ""}
                    </p>
                  </div>
                  <b className={h.cash >= 0 ? "pos" : "neg"}>{sgn(h.cash)}</b>
                </div>
              ))}
            </div>
            <button
              onClick={() => {
                setRes(null);
                setF({ code: "", pin: "" });
              }}
            >
              Done
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------- Staff app ---------- */
function StaffLogin() {
  const [f, setF] = useState({ email: "", password: "" }),
    [err, setErr] = useState("");
  const go = async (e) => {
    e.preventDefault();
    const { error } = await sb.auth.signInWithPassword(f);
    if (error) setErr("Wrong email or password.");
  };
  return (
    <div className="hs">
      <form className="gate" onSubmit={go}>
        <h1>Casino control</h1>
        <p className="mu">Sign in with your club account.</p>
        <input
          type="email"
          placeholder="Email"
          value={f.email}
          onChange={(e) => setF({ ...f, email: e.target.value })}
        />
        <input
          type="password"
          placeholder="Password"
          value={f.password}
          onChange={(e) => setF({ ...f, password: e.target.value })}
        />
        <button className="pri big">Sign in</button>
        {err && <p className="err">{err}</p>}
      </form>
    </div>
  );
}

function Staff({ session }) {
  const qc = useQueryClient();
  const role = useH("role", () => rpc("house_role"), false);
  useEffect(() => {
    qc.invalidateQueries({ queryKey: ["h"] });
  }, [session?.user?.id]);
  if (session === undefined || (session && role.isLoading))
    return (
      <div className="hs">
        <p className="mu pad">Loading…</p>
      </div>
    );
  if (!session) return <StaffLogin />;
  if (!role.data)
    return (
      <div className="hs">
        <div className="gate">
          <h1>No access</h1>
          <p className="mu">
            Only the host and the two bank managers can open casino control. Ask
            the host to appoint you.
          </p>
          <a className="btnlink" href="/#">
            Back to the club
          </a>
        </div>
      </div>
    );
  return <StaffApp role={role.data} />;
}

function Sheet({
  title,
  lines,
  onConfirm,
  onClose,
  label = "Confirm",
  danger,
}) {
  const [busy, setBusy] = useState(false),
    [err, setErr] = useState("");
  const go = async () => {
    setBusy(true);
    setErr("");
    try {
      await onConfirm();
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  };
  return (
    <div className="sheet" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {lines.map((l, i) => (
          <p key={i} style={{ margin: 0 }}>
            {l}
          </p>
        ))}
        {err && <p className="err">{err}</p>}
        <div className="row">
          <button onClick={onClose}>Cancel</button>
          <button
            className={danger ? "danger" : "pri"}
            disabled={busy}
            onClick={go}
          >
            {busy ? "Saving…" : label}
          </button>
        </div>
      </div>
    </div>
  );
}

function PinSheet({ list, onClose }) {
  const text = list.map((p) => `${p.code}\t${p.name}\t${p.pin}`).join("\n");
  return (
    <div className="sheet" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}>
        <h2>Player PINs</h2>
        <p className="mu">
          These are shown once. Print or copy them now. Players use their ID and
          PIN on the balance page.
        </p>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>PIN</th>
            </tr>
          </thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.code}>
                <td>{p.code}</td>
                <td>{p.name}</td>
                <td className="pin">{p.pin}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row noprint">
          <button onClick={() => navigator.clipboard.writeText(text)}>
            Copy
          </button>
          <button onClick={() => window.print()}>Print</button>
          <button className="pri" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function Pick({ label, value, onChange, players, filter }) {
  return (
    <label className="fld">
      <span>{label}</span>
      <select value={value || ""} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose a player</option>
        {players.filter(filter || (() => true)).map((p) => (
          <option key={p.player_id} value={p.player_id}>
            {p.name} ({p.code}) - {pb(p.cash)}
            {p.loan ? `, owes ${p.loan}` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
function Amount({ label = "Amount", value, onChange, quick = [] }) {
  return (
    <div className="fld">
      <span>{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min="1"
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
      />
      {quick.length > 0 && (
        <div className="chips">
          {quick.map((q) => (
            <button key={q} onClick={() => onChange(String(q))}>
              {q}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
function GameSel({ games, value, onChange, optional }) {
  return (
    <label className="fld">
      <span>Game{optional ? " (optional)" : ""}</span>
      <select value={value || ""} onChange={(e) => onChange(e.target.value)}>
        <option value="">{optional ? "No game" : "Choose a game"}</option>
        {games.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function StaffApp({ role }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState("Home"),
    [preset, setPreset] = useState("bet"),
    [toast, setToast] = useState("");
  const cfg = useH("cfg", () =>
    tbl(sb.from("house_config").select("*").single()),
  );
  const players = useH("players", () => rpc("house_players_staff"));
  const games = useH("games", () =>
    tbl(sb.from("house_games").select("*").order("sort")),
  );
  const dash = useH("dash", () => rpc("house_dashboard"));
  const bad = [cfg, players, games, dash].find((q) => q.isError);
  if (bad)
    return (
      <div className="hs">
        <div className="gate">
          <h1>Something went wrong</h1>
          <p className="err">{bad.error?.message}</p>
          <p className="mu">
            If this is the first time, run supabase/008_house.sql in Supabase.
          </p>
        </div>
      </div>
    );
  if (!cfg.data || !players.data || !games.data || !dash.data)
    return (
      <div className="hs">
        <p className="mu pad">Loading…</p>
      </div>
    );
  const ctx = {
    cfg: cfg.data,
    players: players.data,
    games: games.data,
    dash: dash.data,
    role,
    refresh: () => qc.invalidateQueries({ queryKey: ["h"] }),
    flash: (m) => {
      setToast(m);
      setTimeout(() => setToast(""), 2500);
    },
  };
  const tabs = [
    "Home",
    "New",
    "Players",
    "History",
    "Games",
    ...(role === "super" ? ["Admin"] : []),
  ];
  return (
    <div className="hs">
      <div className="wrap">
        <div className="hd">
          <div>
            <h1>{cfg.data.name}</h1>
            <p className="mu">
              {role === "super" ? "Super Admin" : "Bank Manager"}
            </p>
          </div>
          <div className="row" style={{ flex: "none" }}>
            <span className={"st st-" + cfg.data.status}>
              {STATUS[cfg.data.status]}
            </span>
            <a className="btnlink" href="/#" style={{ minHeight: 36 }}>
              Club
            </a>
          </div>
        </div>
        {tab === "Home" && (
          <Home
            ctx={ctx}
            start={(t) => {
              setPreset(t);
              setTab("New");
            }}
            go={setTab}
          />
        )}
        {tab === "New" && <NewTx key={preset} ctx={ctx} preset={preset} />}
        {tab === "Players" && <PlayersTab ctx={ctx} />}
        {tab === "History" && <History ctx={ctx} />}
        {tab === "Games" && <GamesTab ctx={ctx} />}
        {tab === "Admin" && <AdminTab ctx={ctx} />}
      </div>
      {toast && <div className="toast">{toast}</div>}
      <nav className="tabs">
        {tabs.map((t) => (
          <button
            key={t}
            className={tab === t ? "on" : ""}
            onClick={() => {
              if (t === "New") setPreset("bet");
              setTab(t);
            }}
          >
            {t}
          </button>
        ))}
      </nav>
    </div>
  );
}

function Home({ ctx, start, go }) {
  const { dash: d, players, cfg, flash, refresh } = ctx,
    [cnt, setCnt] = useState("");
  const cards = [
    ["Players", d.players],
    ["In circulation", pb(d.circulation)],
    ["Bank balance", pb(d.bank)],
    ["Promo budget left", pb(d.promo)],
    ["Total bets", pb(d.bets)],
    ["Total payouts", pb(d.payouts)],
    ["Loans outstanding", pb(d.loans)],
    ["Games completed", d.games_done],
    ["Bank profit or loss", sgn(d.profit) + " HT"],
  ];
  return (
    <>
      {cfg.status === "closed" && (
        <div className="card">
          <h2>Casino closed</h2>
          <p>
            Winner: <b>{d.winner || "none"}</b>
          </p>
          <p className="mu">Full settlement is under History, then Reports.</p>
        </div>
      )}
      <div className="grid">
        {cards.map(([l, v]) => (
          <div className="stat" key={l}>
            <b>{v}</b>
            <span>{l}</span>
          </div>
        ))}
        <div className="stat">
          <b>{d.richest?.name || "-"}</b>
          <span>Richest ({pb(d.richest?.net)})</span>
        </div>
        <div className="stat">
          <b>{d.poorest?.name || "-"}</b>
          <span>Poorest ({pb(d.poorest?.net)})</span>
        </div>
      </div>
      <h3 style={{ margin: "4px 0 8px" }}>Quick actions</h3>
      <div className="rowx" style={{ marginBottom: 12 }}>
        <button className="pri" onClick={() => start("bet")}>
          New transaction
        </button>
        <button onClick={() => start("pvp")}>Player vs Player</button>
        <button onClick={() => start("bet")}>House bet</button>
        <button onClick={() => start("pot")}>Game pot</button>
        <button onClick={() => start("loan")}>Issue loan</button>
        <button onClick={() => go("Games")}>Record game result</button>
        <a
          className="btnlink"
          href="#house-board"
          target="_blank"
          rel="noreferrer"
        >
          Leaderboard
        </a>
        <a
          className="btnlink"
          href="/#house-tv"
          target="_blank"
          rel="noreferrer"
        >
          TV mode
        </a>
      </div>
      <div className="card">
        <h3>Top players</h3>
        {players.slice(0, 5).map((p) => (
          <div className="li" key={p.player_id}>
            <b>
              {p.rank}. {p.name}
            </b>
            <span>
              {cfg.rank_by === "change" ? sgn(p.change) + " HT" : pb(p.net)}
            </span>
          </div>
        ))}
      </div>
      <div className="card">
        <h3>Physical cash check</h3>
        <p className="mu">
          Bank ledger says {pb(d.bank)}.
          {d.count
            ? ` Last count: ${pb(d.count.counted)} by ${d.count.by}, difference ${sgn(d.count.counted - d.bank)} HT.`
            : " No count recorded yet."}
        </p>
        <div className="row">
          <input
            type="number"
            inputMode="numeric"
            placeholder="Cash in the box"
            value={cnt}
            onChange={(e) => setCnt(e.target.value)}
          />
          <button
            disabled={!cnt}
            onClick={async () => {
              try {
                await rpc("house_count_cash", { p_counted: +cnt });
                setCnt("");
                refresh();
                flash("Count saved");
              } catch (e) {
                flash(e.message);
              }
            }}
          >
            Save count
          </button>
        </div>
      </div>
    </>
  );
}

function NewTx({ ctx, preset }) {
  const { players, games, cfg, dash, flash, refresh } = ctx;
  const [type, setType] = useState(preset),
    [f, setF] = useState({}),
    [pending, setPending] = useState(null);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const nm = (id) => players.find((p) => p.player_id === id)?.name || "?";
  const gm = (id) => games.find((g) => g.id === id);
  const open = (title, lines, call) =>
    setPending({ title, lines, call, idem: crypto.randomUUID() });
  const confirm = async () => {
    const r = await pending.call(pending.idem);
    refresh();
    flash(`Recorded #${r.seq}`);
    setPending(null);
    setF((x) => ({ game: x.game }));
  };
  const note = f.note || null;
  const TYPES = [
    ["bet", "House bet"],
    ["pvp", "Player vs Player"],
    ["pot", "Game pot"],
    ["reward", "Reward"],
    ["loan", "Loan"],
    ["repay", "Repay"],
  ];

  const bet = (o) => {
    const g = gm(f.game),
      stake = +f.stake,
      profit = Math.floor((stake * g.odds_num) / g.odds_den);
    const eff =
      o === "win"
        ? `${nm(f.p)} wins ${pb(profit)} profit (gets stake back too). Bank pays ${pb(profit)}.`
        : o === "loss"
          ? `${nm(f.p)} loses ${pb(stake)} to the bank.`
          : "Push: stake returned, no balance change.";
    open(
      "Confirm house bet",
      [
        `${nm(f.p)} bets ${pb(stake)} on ${g.name}`,
        `Outcome: ${o.toUpperCase()}`,
        eff,
      ],
      (idem) =>
        rpc("house_bet", {
          p_player: f.p,
          p_game: f.game,
          p_stake: stake,
          p_outcome: o,
          p_note: note,
          p_idem: idem,
        }),
    );
  };
  const inn = f.in || [],
    win = f.win || [],
    fee = +f.fee || 0,
    pot = fee * inn.length,
    amt = f.amt || {};
  const paid = win.reduce((a, id) => a + (+amt[id] || 0), 0);
  const toggle = (k, id) =>
    setF((x) => ({
      ...x,
      [k]: (x[k] || []).includes(id)
        ? x[k].filter((y) => y !== id)
        : [...(x[k] || []), id],
    }));
  const split = () =>
    setF((x) => ({
      ...x,
      amt: Object.fromEntries(
        win.map((id) => [id, win.length ? Math.floor(pot / win.length) : 0]),
      ),
    }));

  return (
    <>
      <div className="seg">
        {TYPES.map(([k, l]) => (
          <button
            key={k}
            className={type === k ? "on" : ""}
            onClick={() => {
              setType(k);
              setF({ game: f.game });
            }}
          >
            {l}
          </button>
        ))}
      </div>
      <div className="card">
        {type === "bet" && (
          <>
            <Pick
              label="Player"
              value={f.p}
              onChange={set("p")}
              players={players}
            />
            <GameSel games={games} value={f.game} onChange={set("game")} />
            <Amount
              label="Stake"
              value={f.stake}
              onChange={set("stake")}
              quick={[10, 20, 50, 100]}
            />
            <div className="row">
              {[
                ["win", "Win", "win"],
                ["push", "Push", ""],
                ["loss", "Loss", "loss"],
              ].map(([o, l, c]) => (
                <button
                  key={o}
                  className={"big " + c}
                  disabled={!f.p || !f.game || !(+f.stake > 0)}
                  onClick={() => bet(o)}
                >
                  {l}
                </button>
              ))}
            </div>
          </>
        )}
        {type === "pvp" && (
          <>
            <Pick
              label="Payer (loses money)"
              value={f.a}
              onChange={set("a")}
              players={players}
            />
            <Pick
              label="Receiver (gets money)"
              value={f.b}
              onChange={set("b")}
              players={players}
            />
            <Amount
              value={f.amount}
              onChange={set("amount")}
              quick={[10, 20, 50, 100]}
            />
            <GameSel
              games={games}
              value={f.game}
              onChange={set("game")}
              optional
            />
            <button
              className="pri big"
              disabled={!f.a || !f.b || !(+f.amount > 0)}
              onClick={() =>
                open(
                  "Confirm player vs player",
                  [
                    `${nm(f.a)} pays ${nm(f.b)} ${pb(+f.amount)}`,
                    gm(f.game)
                      ? `Game: ${gm(f.game).name}`
                      : "No game selected",
                  ],
                  (idem) =>
                    rpc("house_pvp", {
                      p_payer: f.a,
                      p_receiver: f.b,
                      p_amount: +f.amount,
                      p_game: f.game || null,
                      p_note: note,
                      p_idem: idem,
                    }),
                )
              }
            >
              Review
            </button>
          </>
        )}
        {type === "pot" && (
          <>
            <GameSel
              games={games}
              value={f.game}
              onChange={(v) =>
                setF((x) => ({
                  ...x,
                  game: v,
                  fee: x.fee || gm(v)?.entry_fee || "",
                }))
              }
            />
            <Amount
              label="Entry fee per player"
              value={f.fee}
              onChange={set("fee")}
              quick={[20, 50, 100]}
            />
            <div className="fld">
              <span>Players in the pot ({inn.length})</span>
              <div className="chips">
                {players.map((p) => (
                  <button
                    key={p.player_id}
                    className={inn.includes(p.player_id) ? "on" : ""}
                    onClick={() => toggle("in", p.player_id)}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
            <p className="mu">
              Pot: <b>{pb(pot)}</b>
            </p>
            <div className="fld">
              <span>Winners</span>
              <div className="chips">
                {players
                  .filter((p) => inn.includes(p.player_id))
                  .map((p) => (
                    <button
                      key={p.player_id}
                      className={win.includes(p.player_id) ? "on" : ""}
                      onClick={() => toggle("win", p.player_id)}
                    >
                      {p.name}
                    </button>
                  ))}
              </div>
            </div>
            {win.length > 0 && (
              <>
                {win.map((id) => (
                  <div className="row" key={id}>
                    <span>{nm(id)}</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      value={amt[id] ?? ""}
                      onChange={(e) =>
                        setF((x) => ({
                          ...x,
                          amt: { ...(x.amt || {}), [id]: e.target.value },
                        }))
                      }
                    />
                  </div>
                ))}
                <button onClick={split}>Split the pot equally</button>
                <p className={paid > pot ? "err" : "mu"}>
                  Paid out {pb(paid)} of {pb(pot)}
                  {pot - paid > 0
                    ? `, ${pb(pot - paid)} stays with the bank`
                    : ""}
                </p>
              </>
            )}
            <button
              className="pri big"
              disabled={!f.game || !inn.length || pot <= 0 || paid > pot}
              onClick={() =>
                open(
                  "Confirm game pot",
                  [
                    `${gm(f.game).name}: ${inn.length} players, ${pb(fee)} each, pot ${pb(pot)}`,
                    win.length
                      ? `Winners: ${win.map((id) => `${nm(id)} ${pb(+amt[id] || 0)}`).join(", ")}`
                      : "No winners, the bank keeps the pot",
                  ],
                  (idem) =>
                    rpc("house_pot", {
                      p_game: f.game,
                      p_entries: inn.map((id) => ({ player: id, fee })),
                      p_payouts: win.map((id) => ({
                        player: id,
                        amount: +amt[id] || 0,
                      })),
                      p_note: note,
                      p_idem: idem,
                    }),
                )
              }
            >
              Review
            </button>
          </>
        )}
        {type === "reward" && (
          <>
            <Pick
              label="Player"
              value={f.p}
              onChange={set("p")}
              players={players}
            />
            <Amount
              value={f.amount}
              onChange={set("amount")}
              quick={[25, 50, 100]}
            />
            <GameSel
              games={games}
              value={f.game}
              onChange={set("game")}
              optional
            />
            <label className="fld">
              <span>Reason (optional)</span>
              <input
                value={f.note || ""}
                onChange={(e) => set("note")(e.target.value)}
              />
            </label>
            <p className="mu">Promotional budget left: {pb(dash.promo)}</p>
            <button
              className="pri big"
              disabled={!f.p || !(+f.amount > 0)}
              onClick={() =>
                open(
                  "Confirm reward",
                  [
                    `${nm(f.p)} receives ${pb(+f.amount)} from the promotional budget`,
                    note || "No reason given",
                  ],
                  (idem) =>
                    rpc("house_reward", {
                      p_player: f.p,
                      p_amount: +f.amount,
                      p_game: f.game || null,
                      p_note: note,
                      p_idem: idem,
                    }),
                )
              }
            >
              Review
            </button>
          </>
        )}
        {type === "loan" && (
          <>
            <Pick
              label="Player (one loan each)"
              value={f.p}
              onChange={set("p")}
              players={players}
              filter={(p) => !p.loan_taken}
            />
            <Amount
              label={`Amount (max ${cfg.loan_max})`}
              value={f.amount ?? String(cfg.loan_max)}
              onChange={set("amount")}
              quick={[cfg.loan_max]}
            />
            <button
              className="pri big"
              disabled={!f.p || !(+(f.amount ?? cfg.loan_max) > 0)}
              onClick={() => {
                const a = +(f.amount ?? cfg.loan_max);
                open(
                  "Confirm emergency loan",
                  [
                    `${nm(f.p)} borrows ${pb(a)}`,
                    cfg.loan_interest
                      ? `Interest ${cfg.loan_interest}%`
                      : "No interest",
                    "Counted against their final net worth",
                  ],
                  (idem) =>
                    rpc("house_loan_issue", {
                      p_player: f.p,
                      p_amount: a,
                      p_note: note,
                      p_idem: idem,
                    }),
                );
              }}
            >
              Review
            </button>
          </>
        )}
        {type === "repay" && (
          <>
            <Pick
              label="Player with a loan"
              value={f.p}
              onChange={(v) =>
                setF((x) => ({
                  ...x,
                  p: v,
                  amount: String(
                    players.find((p) => p.player_id === v)?.loan || "",
                  ),
                }))
              }
              players={players}
              filter={(p) => p.loan > 0}
            />
            <Amount
              label="Repayment"
              value={f.amount}
              onChange={set("amount")}
            />
            <button
              className="pri big"
              disabled={!f.p || !(+f.amount > 0)}
              onClick={() =>
                open(
                  "Confirm repayment",
                  [`${nm(f.p)} repays ${pb(+f.amount)}`],
                  (idem) =>
                    rpc("house_loan_repay", {
                      p_player: f.p,
                      p_amount: +f.amount,
                      p_note: note,
                      p_idem: idem,
                    }),
                )
              }
            >
              Review
            </button>
          </>
        )}
      </div>
      {pending && (
        <Sheet
          title={pending.title}
          lines={pending.lines}
          onClose={() => setPending(null)}
          onConfirm={confirm}
          label="Confirm and record"
        />
      )}
    </>
  );
}

function PlayersTab({ ctx }) {
  const { players, role, refresh, flash } = ctx,
    [sel, setSel] = useState(null),
    [pins, setPins] = useState(null),
    [name, setName] = useState("");
  const p = players.find((x) => x.player_id === sel);
  const hist = useH(
    ["hist", "p", sel || ""],
    () => rpc("house_history", { p_player: sel, p_limit: 100 }),
    5000,
  );
  return (
    <>
      <div className="card">
        {players.map((x) => (
          <div
            className="li tap"
            key={x.player_id}
            onClick={() => {
              setSel(x.player_id === sel ? null : x.player_id);
              setName(x.name);
            }}
          >
            <div>
              <b>
                {x.rank}. {x.name}
              </b>{" "}
              <span className="badge">{x.code}</span>
              <p className="mu">
                cash {pb(x.cash)}
                {x.loan ? `, loan ${pb(x.loan)}` : ""}
              </p>
            </div>
            <b>{pb(x.net)}</b>
          </div>
        ))}
      </div>
      {p && (
        <div className="card">
          <h3>{p.name}</h3>
          <div className="grid" style={{ margin: 0 }}>
            {[
              ["Net worth", pb(p.net)],
              ["Night result", sgn(p.change) + " HT"],
              ["Cash", pb(p.cash)],
              ["Loan", pb(p.loan)],
              ["Won / lost", `${p.won} / ${p.lost}`],
              ["Games played", p.games],
            ].map(([l, v]) => (
              <div className="stat" key={l}>
                <b>{v}</b>
                <span>{l}</span>
              </div>
            ))}
          </div>
          {role === "super" && (
            <>
              <div className="row">
                <button
                  onClick={async () => {
                    try {
                      setPins(
                        await rpc("house_new_pin", { p_player: p.player_id }),
                      );
                    } catch (e) {
                      flash(e.message);
                    }
                  }}
                >
                  New PIN
                </button>
                <button
                  className="danger"
                  onClick={async () => {
                    if (
                      confirm(
                        `Remove ${p.name} from the casino? Their history is kept.`,
                      )
                    ) {
                      try {
                        await rpc("house_edit_player", {
                          p_player: p.player_id,
                          p_active: false,
                        });
                        setSel(null);
                        refresh();
                      } catch (e) {
                        flash(e.message);
                      }
                    }
                  }}
                >
                  Remove
                </button>
              </div>
            </>
          )}
          <h3>Statement</h3>
          {(hist.data || []).map((t) => (
            <div className="li" key={t.id}>
              <div>
                <b>{KIND[t.kind]}</b>
                {t.reversed && (
                  <span className="badge" style={{ marginLeft: 6 }}>
                    reversed
                  </span>
                )}
                <p className="mu">
                  {t.game ? t.game + ", " : ""}
                  {when(t.created_at)}, #{t.seq}
                </p>
              </div>
              <b
                className={
                  (t.lines.find((l) => l.name === p.name)?.cash ?? 0) >= 0
                    ? "pos"
                    : "neg"
                }
              >
                {sgn(t.lines.find((l) => l.name === p.name)?.cash ?? 0)}
              </b>
            </div>
          ))}
        </div>
      )}
      {pins && <PinSheet list={pins} onClose={() => setPins(null)} />}
    </>
  );
}

function TxRow({ t, role, onReverse }) {
  return (
    <div className="li" style={{ alignItems: "flex-start" }}>
      <div>
        <b>
          #{t.seq} {KIND[t.kind]}
        </b>
        {t.reversed && (
          <span className="badge" style={{ marginLeft: 6 }}>
            reversed
          </span>
        )}
        {t.is_reversal && (
          <span className="badge" style={{ marginLeft: 6 }}>
            reversal
          </span>
        )}
        <p className="mu">
          {t.game ? t.game + ", " : ""}
          {when(t.created_at)}, by {t.manager_name}
        </p>
        <p style={{ margin: 0, fontSize: 14 }}>{summary(t)}</p>
        {t.note && <p className="mu">{t.note}</p>}
      </div>
      {role === "super" &&
        !t.reversed &&
        !t.is_reversal &&
        t.kind !== "start" && (
          <button style={{ minHeight: 38 }} onClick={() => onReverse(t)}>
            Reverse
          </button>
        )}
    </div>
  );
}

function History({ ctx }) {
  const { players, games, role, refresh, flash } = ctx;
  const [view, setView] = useState("tx"),
    [f, setF] = useState({}),
    [rev, setRev] = useState(null);
  const args = {
    p_player: f.p || null,
    p_game: f.g || null,
    p_kind: f.k || null,
    p_from: f.from ? new Date(f.from).toISOString() : null,
    p_to: f.to ? new Date(f.to + "T23:59:59").toISOString() : null,
    p_mgr: f.m || null,
    p_limit: view === "tx" ? 300 : 5000,
  };
  const h = useH(
    ["hist", view, JSON.stringify(args)],
    () => rpc("house_history", args),
    6000,
  );
  const rows = h.data || [],
    set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const mgrs = [...new Set(rows.map((t) => t.manager_name))];
  return (
    <>
      <div className="seg">
        {[
          ["tx", "Transactions"],
          ["rep", "Reports"],
        ].map(([k, l]) => (
          <button
            key={k}
            className={view === k ? "on" : ""}
            onClick={() => setView(k)}
          >
            {l}
          </button>
        ))}
      </div>
      {view === "tx" && (
        <>
          <div className="card">
            <div className="rowx">
              <select value={f.p || ""} onChange={set("p")}>
                <option value="">All players</option>
                {players.map((p) => (
                  <option key={p.player_id} value={p.player_id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <select value={f.g || ""} onChange={set("g")}>
                <option value="">All games</option>
                {games.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
              <select value={f.k || ""} onChange={set("k")}>
                <option value="">All types</option>
                {Object.entries(KIND).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
              <select value={f.m || ""} onChange={set("m")}>
                <option value="">All managers</option>
                {mgrs.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
              <input type="date" value={f.from || ""} onChange={set("from")} />
              <input type="date" value={f.to || ""} onChange={set("to")} />
            </div>
            <button
              onClick={() =>
                csv(
                  "transactions",
                  rows.map((t) => ({
                    number: t.seq,
                    time: t.created_at,
                    type: KIND[t.kind],
                    game: t.game,
                    manager: t.manager_name,
                    changes: summary(t),
                    note: t.note,
                    reversed: t.reversed ? "yes" : "",
                  })),
                )
              }
            >
              Export CSV
            </button>
          </div>
          <div className="card">
            {rows.map((t) => (
              <TxRow key={t.id} t={t} role={role} onReverse={setRev} />
            ))}
            {!rows.length && <p className="mu">No transactions match.</p>}
          </div>
        </>
      )}
      {view === "rep" && <Reports ctx={ctx} rows={rows} />}
      {rev && (
        <Sheet
          title={`Reverse #${rev.seq}?`}
          lines={[
            summary(rev),
            "A reversing entry is added. The original stays in the history.",
          ]}
          danger
          label="Reverse it"
          onClose={() => setRev(null)}
          onConfirm={async () => {
            await rpc("house_reverse", {
              p_tx: rev.id,
              p_idem: crypto.randomUUID(),
            });
            setRev(null);
            refresh();
            flash("Reversed");
          }}
        />
      )}
    </>
  );
}

function Reports({ ctx, rows }) {
  const { players, dash, cfg } = ctx;
  const live = rows.filter(
    (t) => !t.reversed && !t.is_reversal && t.kind !== "start",
  );
  const bankOf = (t) =>
    (t.lines || [])
      .filter((l) => l.account !== "player")
      .reduce((a, l) => a + l.cash, 0);
  const byKind = Object.entries(
    live.reduce(
      (m, t) => ({ ...m, [t.kind]: (m[t.kind] || 0) + bankOf(t) }),
      {},
    ),
  ).map(([k, v]) => ({ type: KIND[k], bank_net: v }));
  const byGame = Object.values(
    live.reduce((m, t) => {
      const k = t.game || "No game";
      const r = m[k] || {
        game: k,
        transactions: 0,
        staked: 0,
        paid_out: 0,
        bank_net: 0,
      };
      r.transactions++;
      if (t.kind === "bet") r.staked += t.detail.stake;
      r.paid_out +=
        t.kind === "bet"
          ? t.detail.payout
          : t.kind === "pot"
            ? t.detail.paid
            : t.kind === "reward"
              ? t.detail.amount
              : 0;
      r.bank_net += bankOf(t);
      m[k] = r;
      return m;
    }, {}),
  );
  const loans = players
    .filter((p) => p.loan_taken || p.loan > 0)
    .map((p) => ({
      player: p.name,
      loan_taken: p.loan_taken ? "yes" : "no",
      outstanding: p.loan,
    }));
  const settle = players.map((p) => ({
    rank: p.rank,
    player: p.name,
    cash: p.cash,
    loan: p.loan,
    net_worth: p.net,
    won: p.won,
    lost: p.lost,
    games: p.games,
  }));
  const Tbl = ({ title, data, file }) => (
    <div className="card">
      <div className="tx row" style={{ alignItems: "center" }}>
        <h3>{title}</h3>
        <button
          style={{ minHeight: 36, flex: "none" }}
          onClick={() => csv(file, data)}
        >
          CSV
        </button>
      </div>
      {data.length ? (
        <table>
          <thead>
            <tr>
              {Object.keys(data[0]).map((k) => (
                <th key={k}>{k.replace("_", " ")}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((r, i) => (
              <tr key={i}>
                {Object.values(r).map((v, j) => (
                  <td key={j}>{v}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="mu">Nothing yet.</p>
      )}
    </div>
  );
  return (
    <>
      <div className="card">
        <h3>Bank profit or loss</h3>
        <p className="mu">
          Opening float {pb(dash.float)}, bank now {pb(dash.bank)}, loans out{" "}
          {pb(dash.loans)}
        </p>
        <b
          className={dash.profit >= 0 ? "pos" : "neg"}
          style={{ fontSize: 22 }}
        >
          {sgn(dash.profit)} HT
        </b>
      </div>
      <Tbl title="Bank result by type" data={byKind} file="bank-by-type" />
      <Tbl title="Game-wise report" data={byGame} file="games" />
      <Tbl title="Loan report" data={loans} file="loans" />
      <Tbl
        title={
          cfg.status === "closed" ? "Final settlement" : "Settlement so far"
        }
        data={settle}
        file="settlement"
      />
      {cfg.status === "closed" && (
        <p className="mu">
          Winner: <b>{dash.winner}</b>
          {cfg.tiebreak_note ? `. Tie-breaker: ${cfg.tiebreak_note}` : ""}
        </p>
      )}
    </>
  );
}

function GamesTab({ ctx }) {
  const { games, players, role, refresh, flash } = ctx,
    [res, setRes] = useState(null),
    [win, setWin] = useState([]),
    [note, setNote] = useState(""),
    [edit, setEdit] = useState(null),
    [add, setAdd] = useState("");
  const setStatus = async (g, s) => {
    try {
      await rpc("house_game_status", { p_game: g.id, p_status: s });
      refresh();
    } catch (e) {
      flash(e.message);
    }
  };
  const rules = (g) =>
    g.kind === "house"
      ? `House bets, ${g.odds_num}:${g.odds_den}, ${g.min_bet}${g.max_bet ? ` to ${g.max_bet}` : "+"} HT`
      : g.kind === "pot"
        ? `Game pot, entry ${g.entry_fee} HT`
        : g.kind === "reward"
          ? "House-funded rewards"
          : "Player vs player";
  return (
    <>
      {games.map((g) => (
        <div className="card" key={g.id}>
          <div className="tx row" style={{ alignItems: "center" }}>
            <div>
              <b>{g.name}</b>
              <p className="mu">{rules(g)}</p>
            </div>
            <span className="badge">{g.status}</span>
          </div>
          <div className="row">
            {g.status !== "active" && (
              <button onClick={() => setStatus(g, "active")}>Start</button>
            )}
            {g.status === "active" && (
              <button onClick={() => setStatus(g, "pending")}>Stop</button>
            )}
            <button
              className="pri"
              onClick={() => {
                setRes(g);
                setWin([]);
                setNote("");
              }}
            >
              Record result
            </button>
            {role === "super" && (
              <button
                onClick={() => setEdit(edit?.id === g.id ? null : { ...g })}
              >
                Rules
              </button>
            )}
          </div>
          {edit?.id === g.id && (
            <>
              <div className="rowx">
                {[
                  ["odds_num", "Odds for"],
                  ["odds_den", "Odds per"],
                  ["min_bet", "Min bet"],
                  ["max_bet", "Max bet"],
                  ["entry_fee", "Entry fee"],
                ].map(([k, l]) => (
                  <label className="fld" key={k}>
                    <span>{l}</span>
                    <input
                      type="number"
                      value={edit[k] ?? ""}
                      onChange={(e) =>
                        setEdit({
                          ...edit,
                          [k]: e.target.value === "" ? null : +e.target.value,
                        })
                      }
                    />
                  </label>
                ))}
              </div>
              <button
                className="pri"
                onClick={async () => {
                  try {
                    await rpc("house_game_set", {
                      p_game: g.id,
                      p_odds_num: edit.odds_num,
                      p_odds_den: edit.odds_den,
                      p_min: edit.min_bet,
                      p_max: edit.max_bet,
                      p_fee: edit.entry_fee,
                    });
                    setEdit(null);
                    refresh();
                    flash("Rules saved");
                  } catch (e) {
                    flash(e.message);
                  }
                }}
              >
                Save rules
              </button>
            </>
          )}
        </div>
      ))}
      {role === "super" && (
        <div className="card">
          <h3>Add a game</h3>
          <div className="row">
            <input
              placeholder="Game name"
              value={add}
              onChange={(e) => setAdd(e.target.value)}
            />
            <button
              disabled={!add}
              onClick={async () => {
                try {
                  await rpc("house_game_add", { p_name: add, p_kind: "house" });
                  setAdd("");
                  refresh();
                } catch (e) {
                  flash(e.message);
                }
              }}
            >
              Add
            </button>
          </div>
        </div>
      )}
      {res && (
        <div className="sheet" onClick={() => setRes(null)}>
          <div onClick={(e) => e.stopPropagation()}>
            <h2>{res.name} result</h2>
            <p className="mu">Who won? (leave empty if nobody)</p>
            <div className="chips">
              {players.map((p) => (
                <button
                  key={p.player_id}
                  className={win.includes(p.player_id) ? "on" : ""}
                  onClick={() =>
                    setWin((w) =>
                      w.includes(p.player_id)
                        ? w.filter((x) => x !== p.player_id)
                        : [...w, p.player_id],
                    )
                  }
                >
                  {p.name}
                </button>
              ))}
            </div>
            <input
              placeholder="Note (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="row">
              <button onClick={() => setRes(null)}>Cancel</button>
              <button
                className="pri"
                onClick={async () => {
                  try {
                    await rpc("house_result", {
                      p_game: res.id,
                      p_winners: win,
                      p_note: note || null,
                    });
                    setRes(null);
                    refresh();
                    flash("Result recorded");
                  } catch (e) {
                    flash(e.message);
                  }
                }}
              >
                Save result
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const NEXT = {
  setup: [["ready", "Mark casino ready"]],
  ready: [
    ["open", "Open the casino"],
    ["setup", "Back to setup"],
  ],
  open: [["closing", "Start closing"]],
  closing: [
    ["closed", "Close and declare the winner"],
    ["open", "Reopen"],
  ],
  closed: [],
};
const RESET_TEXT = {
  prep: "Clears every casino transaction and result, restores the bank float and promo budget, keeps players and PINs, and sets the casino to Ready. If the casino was not closed, any HT it moved is returned to member wallets. If it was closed, the final results stay in wallets.",
  demo: "Clears demo transactions and results. HT moved by the demo is returned to member wallets. The casino status stays as it is.",
  full: "Deletes all casino players, transactions and results and restores default settings and games. Wallet results stay only if the casino was closed; otherwise the HT it moved is returned.",
};

function AdminTab({ ctx }) {
  const { cfg, players, refresh, flash } = ctx,
    [sheet, setSheet] = useState(null),
    [pins, setPins] = useState(null);
  const [pick, setPick] = useState([]),
    [s, setS] = useState({
      name: cfg.name,
      fl: cfg.bank_float,
      promo: cfg.promo_budget,
      loan: cfg.loan_max,
      int: cfg.loan_interest,
      rank: cfg.rank_by,
    });
  const [mode, setMode] = useState("prep"),
    [typed, setTyped] = useState(""),
    [over, setOver] = useState(false),
    [tb, setTb] = useState({ p: "", v: "", note: "" });
  const members = useH(
    "members",
    async () =>
      (
        await sb
          .from("profiles")
          .select("id,display_name")
          .order("display_name")
      ).data,
    false,
  );
  const staff = useH(
    "staff",
    async () => (await sb.from("house_staff").select("*")).data,
    5000,
  );
  const archives = useH(
    "arch",
    async () =>
      (
        await sb
          .from("house_archive")
          .select("id,mode,created_by,created_at")
          .order("created_at", { ascending: false })
      ).data,
    false,
  );
  const inactive = useH(
    "inactive",
    () =>
      tbl(
        sb
          .from("house_players")
          .select("id,code,member_id,profiles(display_name)")
          .eq("active", false),
      ),
    8000,
  );
  const run = async (fn, ok) => {
    try {
      const r = await fn();
      refresh();
      if (ok) flash(ok);
      return r;
    } catch (e) {
      flash(e.message);
    }
  };
  const running = cfg.status === "open" || cfg.status === "closing";
  const doReset = async () => {
    try {
      save(
        `casino-backup-${Date.now()}.json`,
        JSON.stringify(await rpc("house_backup"), null, 1),
        "application/json",
      );
    } catch (e) {
      return flash("Backup failed: " + e.message);
    }
    await rpc("house_reset", {
      p_mode: mode,
      p_confirm: typed,
      p_override: over,
    });
    setTyped("");
    setOver(false);
    refresh();
    flash("Reset complete. A backup was downloaded and archived.");
  };
  return (
    <>
      <div className="card">
        <h3>Casino status: {STATUS[cfg.status]}</h3>
        {NEXT[cfg.status].map(([to, l]) => (
          <button
            key={to}
            className={to === "open" || to === "closed" ? "pri" : ""}
            onClick={() =>
              setSheet({
                title: l,
                lines: ["Change the casino status?"],
                run: async () => {
                  await rpc("house_status", { p_to: to });
                  refresh();
                },
              })
            }
          >
            {l}
          </button>
        ))}
        {cfg.status === "closing" && (
          <>
            <h3>Record a tie-breaker</h3>
            <div className="rowx">
              <select
                value={tb.p}
                onChange={(e) => setTb({ ...tb, p: e.target.value })}
              >
                <option value="">Player</option>
                {players.map((p) => (
                  <option key={p.player_id} value={p.player_id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <input
                type="number"
                placeholder="Tie-break points"
                value={tb.v}
                onChange={(e) => setTb({ ...tb, v: e.target.value })}
              />
              <input
                placeholder="How was it decided?"
                value={tb.note}
                onChange={(e) => setTb({ ...tb, note: e.target.value })}
              />
            </div>
            <button
              disabled={!tb.p || tb.v === ""}
              onClick={() =>
                run(
                  () =>
                    rpc("house_tiebreak", {
                      p_player: tb.p,
                      p_value: +tb.v,
                      p_note: tb.note,
                    }),
                  "Tie-breaker saved",
                )
              }
            >
              Save tie-breaker
            </button>
          </>
        )}
      </div>
      <div className="card">
        <h3>Players</h3>
        <p className="mu">
          {players.length} playing. Players are club members, so every win or
          loss moves their House Tokens wallet. Each gets a private PIN for the
          balance page.
        </p>
        <div className="chips">
          {(members.data || [])
            .filter(
              (m) =>
                !players.some((x) => x.member_id === m.id) &&
                !(inactive.data || []).some((x) => x.member_id === m.id),
            )
            .map((m) => (
              <button
                key={m.id}
                className={pick.includes(m.id) ? "on" : ""}
                onClick={() =>
                  setPick((p) =>
                    p.includes(m.id)
                      ? p.filter((x) => x !== m.id)
                      : [...p, m.id],
                  )
                }
              >
                {m.display_name}
              </button>
            ))}
        </div>
        <button
          className="pri"
          disabled={!pick.length}
          onClick={async () => {
            const r = await run(() =>
              rpc("house_add_members", { p_members: pick }),
            );
            if (r) {
              setPins(r);
              setPick([]);
            }
          }}
        >
          Add {pick.length || ""} selected as players
        </button>
        <p className="mu">
          Friends without an account can join through the club join link first.
        </p>
        {(inactive.data || []).map((p) => (
          <div className="li" key={p.id}>
            <span>
              {p.profiles?.display_name} ({p.code}) is removed
            </span>
            <button
              onClick={() =>
                run(
                  () =>
                    rpc("house_edit_player", {
                      p_player: p.id,
                      p_active: true,
                    }),
                  "Restored",
                )
              }
            >
              Restore
            </button>
          </div>
        ))}
      </div>
      <div className="card">
        <h3>Bank managers (max two)</h3>
        <p className="mu">
          Managers sign in with their club account and open /#house.
        </p>
        {(members.data || []).map((m) => {
          const on = (staff.data || []).some((x) => x.user_id === m.id);
          return (
            <div className="li" key={m.id}>
              <span>{m.display_name}</span>
              <button
                className={on ? "on" : ""}
                onClick={() =>
                  run(
                    () => rpc("house_set_manager", { p_user: m.id, p_on: !on }),
                    on ? "Removed" : "Appointed",
                  )
                }
              >
                {on ? "Manager" : "Appoint"}
              </button>
            </div>
          );
        })}
      </div>
      <div className="card">
        <h3>Settings</h3>
        {cfg.status === "setup" || cfg.status === "ready" ? (
          <>
            <div className="rowx">
              {[
                ["name", "Casino name", "text"],
                ["fl", "Bank float (HT)", "number"],
                ["promo", "Promo budget (inside float)", "number"],
                ["loan", "Max loan", "number"],
                ["int", "Loan interest %", "number"],
              ].map(([k, l, t]) => (
                <label className="fld" key={k}>
                  <span>{l}</span>
                  <input
                    type={t}
                    value={s[k]}
                    onChange={(e) =>
                      setS({
                        ...s,
                        [k]: t === "number" ? +e.target.value : e.target.value,
                      })
                    }
                  />
                </label>
              ))}
              <label className="fld">
                <span>Winner is decided by</span>
                <select
                  value={s.rank}
                  onChange={(e) => setS({ ...s, rank: e.target.value })}
                >
                  <option value="change">
                    Night result (gain or loss at the casino)
                  </option>
                  <option value="net">
                    Net worth (whole HT wallet minus loans)
                  </option>
                </select>
              </label>
            </div>
            <button
              className="pri"
              onClick={() =>
                run(
                  () =>
                    rpc("house_config_set", {
                      p_name: s.name,
                      p_float: s.fl,
                      p_promo: s.promo,
                      p_loan: s.loan,
                      p_interest: s.int,
                      p_rank_by: s.rank,
                    }),
                  "Saved. Run a Preparation reset to apply the bank float.",
                )
              }
            >
              Save settings
            </button>
            <p className="mu">
              A new bank float applies after a Preparation reset.
            </p>
          </>
        ) : (
          <p className="mu">Settings are locked once the casino opens.</p>
        )}
      </div>
      <div className="card">
        <h3>Reset and backup</h3>
        <div className="seg">
          {[
            ["prep", "Preparation reset"],
            ["demo", "Reset demo data"],
            ["full", "Full reset"],
          ].map(([k, l]) => (
            <button
              key={k}
              className={mode === k ? "on" : ""}
              onClick={() => setMode(k)}
            >
              {l}
            </button>
          ))}
        </div>
        <p className="mu">
          {RESET_TEXT[mode]} A backup file downloads first and a copy is
          archived.
        </p>
        {running && (
          <label className="row">
            <input
              type="checkbox"
              checked={over}
              onChange={(e) => setOver(e.target.checked)}
              style={{ flex: "none" }}
            />
            <span className="err">
              The casino is running. I understand and want to reset anyway.
            </span>
          </label>
        )}
        <input
          placeholder="Type RESET to confirm"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
        />
        <button
          className="danger"
          disabled={typed !== "RESET" || (running && !over)}
          onClick={() =>
            setSheet({
              title: "Reset the casino?",
              danger: true,
              label: "Reset now",
              lines: [
                RESET_TEXT[mode],
                "This cannot be undone, but a backup is saved first.",
              ],
              run: doReset,
            })
          }
        >
          Download backup and reset
        </button>
        <button
          onClick={() => run(() => rpc("house_demo"), "Demo data loaded")}
        >
          Load demo data
        </button>
        <p className="mu">
          Demo data moves real wallets until you press Reset demo data, so clear
          it before opening.
        </p>
      </div>
      <div className="card">
        <h3>Archived sessions</h3>
        <button onClick={() => archives.refetch()}>Show archives</button>
        {(archives.data || []).map((a) => (
          <div className="li" key={a.id}>
            <div>
              <b>{a.mode} reset</b>
              <p className="mu">
                {when(a.created_at)} by {a.created_by}
              </p>
            </div>
            <button
              onClick={async () => {
                const { data } = await sb
                  .from("house_archive")
                  .select("data")
                  .eq("id", a.id)
                  .single();
                save(
                  `casino-archive-${a.id.slice(0, 6)}.json`,
                  JSON.stringify(data.data, null, 1),
                  "application/json",
                );
              }}
            >
              Download
            </button>
          </div>
        ))}
      </div>
      {sheet && (
        <Sheet
          title={sheet.title}
          lines={sheet.lines}
          danger={sheet.danger}
          label={sheet.label}
          onClose={() => setSheet(null)}
          onConfirm={async () => {
            await sheet.run();
            setSheet(null);
          }}
        />
      )}
      {pins && <PinSheet list={pins} onClose={() => setPins(null)} />}
    </>
  );
}
