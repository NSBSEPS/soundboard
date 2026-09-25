import React, { useState } from "react";
import { Wrench, Calendar, Users, Repeat, Mail, MapPin, CheckCircle2, Clock3, Plus, X, ChevronRight, Music2 } from "lucide-react";

const SEED_CLIENTS = [
  {
    id: "c1",
    name: "Marguerite Voss",
    email: "marguerite.voss@example.com",
    address: "Lake Oswego, OR",
    pianos: [
      { id: "p1", make: "Steinway", model: "Model B", serial: "487213", lastService: "2026-02-14", notes: "Regulation holding well." },
    ],
    proposedWork: [
      { id: "w1", pianoId: "p1", description: "Routine tuning + hammer voicing check", status: "proposed", proposedWindow: "Week of Sep 21" },
    ],
    buySell: null,
  },
  {
    id: "c2",
    name: "Dennis Okafor",
    email: "d.okafor@example.com",
    address: "Silverton, OR",
    pianos: [
      { id: "p2", make: "Yamaha", model: "U1", serial: "5510982", lastService: "2025-11-02", notes: "Due for full regulation." },
    ],
    proposedWork: [
      { id: "w2", pianoId: "p2", description: "Full action regulation", status: "scheduled", scheduledDate: "2026-09-19" },
    ],
    buySell: { role: "sell", details: "Upgrading to a grand, selling the U1." },
  },
  {
    id: "c3",
    name: "Priya Ramachandran",
    email: "priya.r@example.com",
    address: "Salem, OR",
    pianos: [
      { id: "p3", make: "Baldwin", model: "M", serial: "302118", lastService: "2026-03-30", notes: "" },
    ],
    proposedWork: [],
    buySell: { role: "buy", details: "Looking for an upright for a beginner student." },
  },
  {
    id: "c4",
    name: "Theo Grant",
    email: "theo.grant@example.com",
    address: "Woodburn, OR",
    pianos: [
      { id: "p4", make: "Mason & Hamlin", model: "Model A", serial: "77410", lastService: "2026-06-05", notes: "Rebuild candidate, discussed at last visit." },
    ],
    proposedWork: [
      { id: "w3", pianoId: "p4", description: "Evaluation for full rebuild", status: "proposed", proposedWindow: "Early October" },
    ],
    buySell: null,
  },
];

const OPEN_SLOTS = ["Tue Sep 23, 10:00 AM", "Thu Sep 25, 1:30 PM", "Mon Sep 29, 9:00 AM"];

export default function SoundboardPrototype() {
  const [clients, setClients] = useState(SEED_CLIENTS);
  const [view, setView] = useState("owner");
  const [activeClientId, setActiveClientId] = useState(SEED_CLIENTS[0].id);
  const [ownerTab, setOwnerTab] = useState("dashboard");
  const [schedulingWorkId, setSchedulingWorkId] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2400);
  };

  const scheduleWork = (clientId, workId, slot) => {
    setClients((prev) =>
      prev.map((c) =>
        c.id !== clientId
          ? c
          : {
              ...c,
              proposedWork: c.proposedWork.map((w) =>
                w.id === workId ? { ...w, status: "scheduled", scheduledDate: slot } : w
              ),
            }
      )
    );
    setSchedulingWorkId(null);
    showToast("Appointment scheduled");
  };

  const activeClient = clients.find((c) => c.id === activeClientId);
  const dueSoon = clients.filter((c) => c.proposedWork.some((w) => w.status === "proposed"));
  const buyers = clients.filter((c) => c.buySell?.role === "buy");
  const sellers = clients.filter((c) => c.buySell?.role === "sell");

  return (
    <div className="wrap">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Inter:wght@400;500;600&display=swap');
        * { box-sizing: border-box; }
        .wrap {
          --ink: #241a12;
          --wood: #3d2b1c;
          --wood-deep: #241a12;
          --ivory: #f2ead9;
          --ivory-panel: #faf6ec;
          --brass: #a3773a;
          --brass-light: #c99a55;
          --line: #ded2b8;
          --due: #a24b3b;
          --ok: #4b5d45;
          font-family: 'Inter', sans-serif;
          background: var(--ivory);
          color: var(--ink);
          min-height: 640px;
          display: flex;
          flex-direction: column;
          border: 1px solid var(--line);
        }
        .topbar {
          background: var(--wood-deep);
          color: var(--ivory);
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 14px 22px;
          border-bottom: 3px solid var(--brass);
        }
        .brand {
          display: flex;
          align-items: center;
          gap: 10px;
          font-family: 'Fraunces', serif;
          font-size: 20px;
          letter-spacing: 0.2px;
        }
        .brand .keys {
          display: flex;
          gap: 2px;
        }
        .brand .keys span {
          width: 4px;
          height: 16px;
          background: var(--brass-light);
          display: inline-block;
        }
        .brand .keys span:nth-child(2n) { height: 10px; margin-top: 3px; opacity: 0.6; }
        .switcher {
          display: flex;
          gap: 6px;
          background: rgba(255,255,255,0.08);
          padding: 3px;
          border-radius: 3px;
        }
        .switcher button {
          background: transparent;
          border: none;
          color: var(--ivory);
          font-family: 'Inter', sans-serif;
          font-size: 13px;
          padding: 6px 14px;
          cursor: pointer;
          border-radius: 2px;
        }
        .switcher button.active {
          background: var(--brass);
          color: var(--wood-deep);
          font-weight: 600;
        }
        .body { display: flex; flex: 1; min-height: 560px; }
        .nav {
          width: 190px;
          background: var(--wood);
          color: var(--ivory);
          padding: 18px 0;
          flex-shrink: 0;
        }
        .nav button {
          width: 100%;
          text-align: left;
          background: transparent;
          border: none;
          color: var(--ivory);
          opacity: 0.75;
          font-family: 'Inter', sans-serif;
          font-size: 14px;
          padding: 11px 20px;
          display: flex;
          align-items: center;
          gap: 10px;
          cursor: pointer;
          border-left: 3px solid transparent;
        }
        .nav button.active {
          opacity: 1;
          border-left: 3px solid var(--brass-light);
          background: rgba(255,255,255,0.05);
        }
        .main { flex: 1; padding: 26px 30px; overflow-y: auto; }
        h1.page-title {
          font-family: 'Fraunces', serif;
          font-size: 26px;
          font-weight: 500;
          margin: 0 0 4px 0;
        }
        .subtitle { color: #6b5b48; font-size: 13.5px; margin-bottom: 22px; }
        .stat-row { display: flex; gap: 14px; margin-bottom: 26px; }
        .stat {
          background: var(--ivory-panel);
          border: 1px solid var(--line);
          border-top: 3px solid var(--brass);
          padding: 14px 18px;
          flex: 1;
        }
        .stat .num { font-family: 'Fraunces', serif; font-size: 28px; }
        .stat .label { font-size: 12.5px; color: #6b5b48; margin-top: 2px; }
        .section-title {
          font-family: 'Fraunces', serif;
          font-size: 16px;
          margin: 26px 0 10px 0;
          border-bottom: 1px solid var(--line);
          padding-bottom: 6px;
        }
        .row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 14px;
          border-bottom: 1px solid var(--line);
          background: var(--ivory-panel);
        }
        .row:first-child { border-top: 1px solid var(--line); }
        .row .name { font-weight: 600; font-size: 14.5px; }
        .row .meta { font-size: 12.5px; color: #6b5b48; margin-top: 2px; }
        .badge {
          font-size: 11.5px;
          padding: 3px 9px;
          border-radius: 2px;
          font-weight: 600;
        }
        .badge.due { background: #f2ded8; color: var(--due); }
        .badge.scheduled { background: #e2e8dd; color: var(--ok); }
        .badge.buy { background: #e4ecf2; color: #33566e; }
        .badge.sell { background: #f2ecd8; color: #7a5f22; }
        .client-card {
          border: 1px solid var(--line);
          background: var(--ivory-panel);
          margin-bottom: 12px;
        }
        .client-card .head {
          padding: 12px 16px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          cursor: pointer;
        }
        .client-card .piano-line {
          padding: 10px 16px;
          border-top: 1px solid var(--line);
          font-size: 13.5px;
          display: flex;
          justify-content: space-between;
        }
        button.action {
          background: var(--brass);
          color: var(--wood-deep);
          border: none;
          padding: 7px 14px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
        }
        button.action.ghost {
          background: transparent;
          border: 1px solid var(--brass);
          color: var(--brass);
        }
        .slot-modal {
          position: fixed;
          inset: 0;
          background: rgba(36,26,18,0.55);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 10;
        }
        .slot-card {
          background: var(--ivory-panel);
          padding: 22px 24px;
          width: 320px;
          border-top: 4px solid var(--brass);
        }
        .slot-card h3 { font-family: 'Fraunces', serif; margin: 0 0 14px 0; font-size: 17px; }
        .slot-opt {
          display: block;
          width: 100%;
          text-align: left;
          padding: 10px 12px;
          margin-bottom: 8px;
          background: var(--ivory);
          border: 1px solid var(--line);
          cursor: pointer;
          font-size: 13.5px;
        }
        .slot-opt:hover { border-color: var(--brass); }
        .toast {
          position: fixed;
          bottom: 18px;
          left: 50%;
          transform: translateX(-50%);
          background: var(--wood-deep);
          color: var(--ivory);
          padding: 10px 18px;
          font-size: 13.5px;
          border-left: 3px solid var(--brass-light);
        }
        .client-select {
          font-family: 'Inter', sans-serif;
          background: var(--wood-deep);
          color: var(--ivory);
          border: 1px solid var(--brass);
          padding: 5px 10px;
          font-size: 13px;
        }
        .empty { color: #8a7a63; font-size: 13.5px; padding: 14px 0; }
      `}</style>

      <div className="topbar">
        <div className="brand">
          <div className="keys">
            <span /><span /><span /><span /><span /><span /><span />
          </div>
          Soundboard
        </div>
        <div className="switcher">
          <button className={view === "owner" ? "active" : ""} onClick={() => setView("owner")}>Owner portal</button>
          <button className={view === "client" ? "active" : ""} onClick={() => setView("client")}>Client portal</button>
        </div>
      </div>

      {view === "owner" ? (
        <div className="body">
          <div className="nav">
            {[
              ["dashboard", "Dashboard", Wrench],
              ["clients", "Clients", Users],
              ["schedule", "Schedule", Calendar],
              ["buysell", "Buy / Sell list", Repeat],
            ].map(([key, label, Icon]) => (
              <button key={key} className={ownerTab === key ? "active" : ""} onClick={() => setOwnerTab(key)}>
                <Icon size={15} /> {label}
              </button>
            ))}
          </div>

          <div className="main">
            {ownerTab === "dashboard" && (
              <>
                <h1 className="page-title">Dashboard</h1>
                <p className="subtitle">Where things stand across all 800 clients today.</p>
                <div className="stat-row">
                  <div className="stat"><div className="num">{clients.length}</div><div className="label">Clients (demo set)</div></div>
                  <div className="stat"><div className="num">{dueSoon.length}</div><div className="label">Awaiting client scheduling</div></div>
                  <div className="stat"><div className="num">{buyers.length + sellers.length}</div><div className="label">Active buy/sell entries</div></div>
                </div>
                <div className="section-title">Proposed work awaiting response</div>
                {dueSoon.map((c) => (
                  <div className="row" key={c.id}>
                    <div>
                      <div className="name">{c.name}</div>
                      <div className="meta">{c.proposedWork.find(w => w.status === "proposed")?.description}</div>
                    </div>
                    <span className="badge due">Awaiting client</span>
                  </div>
                ))}
              </>
            )}

            {ownerTab === "clients" && (
              <>
                <h1 className="page-title">Clients</h1>
                <p className="subtitle">Every piano and its service record lives here — this is the single source of truth that replaces the scattered spreadsheets.</p>
                {clients.map((c) => (
                  <div className="client-card" key={c.id}>
                    <div className="head">
                      <div>
                        <div className="name">{c.name}</div>
                        <div className="meta"><MapPin size={11} style={{display:"inline", marginRight:4}}/>{c.address} · <Mail size={11} style={{display:"inline", marginRight:4}}/>{c.email}</div>
                      </div>
                      {c.buySell && <span className={`badge ${c.buySell.role}`}>{c.buySell.role === "buy" ? "Looking to acquire" : "Looking to sell"}</span>}
                    </div>
                    {c.pianos.map((p) => (
                      <div className="piano-line" key={p.id}>
                        <span><Music2 size={13} style={{display:"inline", marginRight:6, verticalAlign:"-2px"}}/>{p.make} {p.model} · SN {p.serial} · last service {p.lastService}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </>
            )}

            {ownerTab === "schedule" && (
              <>
                <h1 className="page-title">Schedule</h1>
                <p className="subtitle">Proposed and confirmed work across all clients.</p>
                {clients.flatMap(c => c.proposedWork.map(w => ({...w, clientName: c.name}))).map(w => (
                  <div className="row" key={w.id}>
                    <div>
                      <div className="name">{w.clientName}</div>
                      <div className="meta">{w.description}</div>
                    </div>
                    {w.status === "proposed" ? (
                      <span className="badge due"><Clock3 size={11} style={{display:"inline", marginRight:4, verticalAlign:"-1px"}}/>Proposed · {w.proposedWindow}</span>
                    ) : (
                      <span className="badge scheduled"><CheckCircle2 size={11} style={{display:"inline", marginRight:4, verticalAlign:"-1px"}}/>{w.scheduledDate}</span>
                    )}
                  </div>
                ))}
              </>
            )}

            {ownerTab === "buysell" && (
              <>
                <h1 className="page-title">Buy / sell list</h1>
                <p className="subtitle">Clients who've opted in to acquire or let go of an instrument.</p>
                <div className="section-title">Looking to acquire</div>
                {buyers.length ? buyers.map(c => (
                  <div className="row" key={c.id}><div><div className="name">{c.name}</div><div className="meta">{c.buySell.details}</div></div><span className="badge buy">Buyer</span></div>
                )) : <div className="empty">No active buyers right now.</div>}
                <div className="section-title">Looking to sell</div>
                {sellers.length ? sellers.map(c => (
                  <div className="row" key={c.id}><div><div className="name">{c.name}</div><div className="meta">{c.buySell.details} — {c.pianos[0].make} {c.pianos[0].model}</div></div><span className="badge sell">Seller</span></div>
                )) : <div className="empty">No active sellers right now.</div>}
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="body">
          <div className="main" style={{width: "100%"}}>
            <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom: 18}}>
              <div>
                <h1 className="page-title" style={{marginBottom:0}}>Welcome, {activeClient.name.split(" ")[0]}</h1>
                <p className="subtitle" style={{marginBottom:0}}>Your piano, service history, and anything proposed by your technician.</p>
              </div>
              <select className="client-select" value={activeClientId} onChange={(e) => setActiveClientId(e.target.value)}>
                {clients.map(c => <option key={c.id} value={c.id}>View as: {c.name}</option>)}
              </select>
            </div>

            <div className="section-title">Your piano{activeClient.pianos.length > 1 ? "s" : ""}</div>
            {activeClient.pianos.map(p => (
              <div className="client-card" key={p.id}>
                <div className="head" style={{cursor:"default"}}>
                  <div>
                    <div className="name">{p.make} {p.model}</div>
                    <div className="meta">Serial {p.serial} · Last service {p.lastService}</div>
                  </div>
                </div>
                {p.notes && <div className="piano-line"><span>{p.notes}</span></div>}
              </div>
            ))}

            <div className="section-title">Proposed &amp; scheduled work</div>
            {activeClient.proposedWork.length ? activeClient.proposedWork.map(w => (
              <div className="row" key={w.id}>
                <div>
                  <div className="name">{w.description}</div>
                  <div className="meta">{w.status === "proposed" ? `Suggested window: ${w.proposedWindow}` : `Confirmed for ${w.scheduledDate}`}</div>
                </div>
                {w.status === "proposed" ? (
                  <button className="action" onClick={() => setSchedulingWorkId(w.id)}>Self-schedule</button>
                ) : (
                  <span className="badge scheduled"><CheckCircle2 size={11} style={{display:"inline", marginRight:4, verticalAlign:"-1px"}}/>Confirmed</span>
                )}
              </div>
            )) : <div className="empty">Nothing proposed right now — you're all caught up.</div>}
          </div>
        </div>
      )}

      {schedulingWorkId && (
        <div className="slot-modal" onClick={() => setSchedulingWorkId(null)}>
          <div className="slot-card" onClick={(e) => e.stopPropagation()}>
            <h3>Pick a time</h3>
            {OPEN_SLOTS.map(slot => (
              <button key={slot} className="slot-opt" onClick={() => scheduleWork(activeClientId, schedulingWorkId, slot)}>{slot}</button>
            ))}
            <button className="action ghost" style={{marginTop: 6, width: "100%"}} onClick={() => setSchedulingWorkId(null)}><X size={12} style={{display:"inline", marginRight:4, verticalAlign:"-1px"}}/>Cancel</button>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
