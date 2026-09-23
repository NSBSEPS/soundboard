import React, { useState } from "react";
import { Wrench, Users, Repeat, Calendar, Mail, MapPin, CheckCircle2, Clock3, X, Music2, Inbox, FileText, DollarSign, Folder } from "lucide-react";

const SEED = {
  clients: [
    { id: "c1", name: "Marguerite Voss", email: "marguerite.voss@example.com", phone: "503-555-0142", pianos: [{ id: "p1", make: "Steinway", model: "Model B", serial: "487213", type: "grand", lastService: "2026-02-14" }] },
    { id: "c2", name: "Dennis Okafor", email: "d.okafor@example.com", phone: "503-555-0198", pianos: [{ id: "p2", make: "Yamaha", model: "U1", serial: "5510982", type: "upright", lastService: "2023-11-02" }] },
    { id: "c3", name: "Priya Ramachandran", email: "priya.r@example.com", phone: "503-555-0177", pianos: [{ id: "p3", make: "Baldwin", model: "M", serial: "302118", type: "upright", lastService: "2026-03-30" }] },
    { id: "c4", name: "Theo Grant", email: "theo.grant@example.com", phone: "503-555-0133", pianos: [{ id: "p4", make: "Mason & Hamlin", model: "Model A", serial: "77410", type: "grand", lastService: "2026-06-05" }] },
  ],
  leads: [
    { id: "l1", name: "Sarah Kim", zip: "97301", piano_type: "upright", service_needed: "tuning", status: "new", utm_source: "facebook", utm_campaign: "fall_push", created: "2 days ago" },
    { id: "l2", name: "Marcus Webb", zip: "97205", piano_type: "grand", service_needed: "evaluation", status: "new", utm_source: null, utm_campaign: null, created: "5 days ago" },
    { id: "l3", name: "Elena Ruiz", zip: "97223", piano_type: "unsure", service_needed: "repair", status: "contacted", utm_source: "google", utm_campaign: "search_organic", created: "1 week ago" },
  ],
  buyers: [
    { id: "b1", clientName: "Priya Ramachandran", wants: "upright", details: "Beginner student, budget flexible" },
  ],
  sellers: [
    { id: "s1", clientName: "Dennis Okafor", piano: "Yamaha U1", type: "upright", details: "Upgrading to a grand" },
  ],
  slots: [
    { id: "sl1", time: "Tue Sep 23, 10:00 AM", type: "in_home", booked: false },
    { id: "sl2", time: "Thu Sep 25, 1:30 PM", type: "in_home", booked: false },
    { id: "sl3", time: "Mon Sep 29, 9:00 AM", type: "in_shop", booked: false },
    { id: "sl4", time: "Wed Oct 1, 2:00 PM", type: "in_shop", booked: false },
  ],
};

const ESTIMATES = [
  { id: "e1", clientName: "Dennis Okafor", status: "sent", total: 150, items: [{ desc: "Routine tuning", amount: 150, type: "in_home" }] },
  { id: "e2", clientName: "Theo Grant", status: "draft", total: 850, items: [{ desc: "Evaluation for full rebuild", amount: 150, type: "in_home" }, { desc: "Action rebuild (bench work)", amount: 700, type: "in_shop" }] },
];

const INITIAL_JOBS = [
  { id: "j1", clientName: "Marguerite Voss", piano: "Steinway Model B", desc: "Routine tuning", type: "in_home", scheduled: "Sep 23, 10:00 AM", done: false },
  { id: "j2", clientName: "Priya Ramachandran", piano: "Baldwin M", desc: "Regulation", type: "in_home", scheduled: "Sep 25, 1:30 PM", done: false },
];

const INITIAL_INVOICES = [
  { id: "inv1", clientName: "Dennis Okafor", total: 150, status: "paid" },
  { id: "inv2", clientName: "Theo Grant", total: 700, status: "sent" },
];

const DOCUMENTS = [
  { id: "d1", title: "2024 service invoice (from Gazelle)", source: "gazelle_import", client: "Marguerite Voss", tags: ["invoice", "historical"] },
  { id: "d2", title: "Photo of damaged hammer felt", source: "photo", client: "Theo Grant", tags: ["rebuild", "before"] },
  { id: "d3", title: "Voice memo — client called about buzzing sound", source: "voice_memo", client: "Priya Ramachandran", tags: ["repair"] },
];

// Real sample rows from the actual Edens Piano Service price list (derived
// from the "G" Piano Works Repair Labor Guide) — not invented for the demo.
const INITIAL_SERVICES = [
  { id: "sv1", category: "Dampers", name: "Damper Felt: Replace, each", prices: { grand: 9.75, upright: 7.5, drop_action: 9.75, square_grand: 19.5, birdcage: 15.0 } },
  { id: "sv2", category: "Hammers", name: "Boring: Set", prices: { grand: 90.5, upright: 90.5, drop_action: 90.5, square_grand: 220.0, birdcage: 90.5 } },
  { id: "sv3", category: "Strings & Tuning Pins", name: "Bass strings: New, set (excludes tuning pins)", prices: { grand: 290.0, upright: 290.0, drop_action: 290.0, square_grand: 290.0, birdcage: 290.0 } },
  { id: "sv4", category: "Wippens", name: "Backcheck block/felt: Replace, set", prices: { upright: 182.5, drop_action: 182.5, birdcage: 290.0 } },
];

export default function SoundboardDemo() {
  const [view, setView] = useState("owner");
  const [ownerTab, setOwnerTab] = useState("dashboard");
  const [slots, setSlots] = useState(SEED.slots);
  const [activeClientId, setActiveClientId] = useState("c2");
  const [schedulingSlotFor, setSchedulingSlotFor] = useState(null);
  const [toast, setToast] = useState(null);
  const [leads, setLeads] = useState(SEED.leads);
  const [jobs, setJobs] = useState(INITIAL_JOBS);
  const [invoices, setInvoices] = useState(INITIAL_INVOICES);
  const [quickAdd, setQuickAdd] = useState(null);
  const [services, setServices] = useState(INITIAL_SERVICES);
  const [bulkPercent, setBulkPercent] = useState("50");

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2200); };
  const activeClient = SEED.clients.find((c) => c.id === activeClientId);

  const dueClients = SEED.clients.filter((c) => {
    const months = (new Date() - new Date(c.pianos[0].lastService)) / (1000 * 60 * 60 * 24 * 30);
    return months >= 6;
  });

  function bookSlot(slotId) {
    setSlots((prev) => prev.map((s) => (s.id === slotId ? { ...s, booked: true } : s)));
    setSchedulingSlotFor(null);
    showToast("Appointment scheduled");
  }

  function markLeadStatus(id, status) {
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, status } : l)));
    showToast(`Lead marked ${status}`);
  }

  function markJobDone(id) {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, done: true } : j)));
    showToast("Job completed — piano's service date updated");
  }

  function createInvoice(job) {
    setInvoices((prev) => [...prev, { id: `inv${prev.length + 1}`, clientName: job.clientName, total: 150, status: "draft" }]);
    showToast("Draft invoice created");
  }

  function sendInvoice(id) {
    setInvoices((prev) => prev.map((i) => (i.id === id ? { ...i, status: "sent" } : i)));
    showToast("Payment link sent via Square");
  }

  function payInvoice(id) {
    setInvoices((prev) => prev.map((i) => (i.id === id ? { ...i, status: "paid" } : i)));
    showToast("Payment received");
  }

  function quickAddSubmit(e) {
    e.preventDefault();
    showToast(quickAdd === "client" ? "Client created (demo)" : "Piano created (demo)");
    setQuickAdd(null);
  }

  function applyBulkAdjust() {
    const pct = Number(bulkPercent);
    if (Number.isNaN(pct)) return;
    const mult = 1 + pct / 100;
    setServices(prev => prev.map(s => ({
      ...s,
      prices: Object.fromEntries(Object.entries(s.prices).map(([type, price]) => [type, Math.round(price * mult * 100) / 100]))
    })));
    showToast(`Applied ${pct > 0 ? "+" : ""}${pct}% to every price`);
  }

  return (
    <div className="wrap">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Inter:wght@400;500;600&display=swap');
        * { box-sizing: border-box; }
        .wrap {
          --ink:#241a12; --wood:#3d2b1c; --wood-deep:#241a12; --ivory:#f2ead9; --panel:#faf6ec;
          --brass:#a3773a; --brass-light:#c99a55; --line:#ded2b8; --due:#a24b3b; --ok:#4b5d45;
          font-family:'Inter',sans-serif; background:var(--ivory); color:var(--ink);
          min-height:640px; display:flex; flex-direction:column; border:1px solid var(--line);
        }
        .topbar { background:var(--wood-deep); color:var(--ivory); display:flex; align-items:center; justify-content:space-between; padding:14px 22px; border-bottom:3px solid var(--brass); }
        .brand { display:flex; align-items:center; gap:10px; font-family:'Fraunces',serif; font-size:20px; }
        .brand .keys { display:flex; gap:2px; }
        .brand .keys span { width:4px; height:16px; background:var(--brass-light); display:inline-block; }
        .brand .keys span:nth-child(2n) { height:10px; margin-top:3px; opacity:.6; }
        .switcher { display:flex; gap:6px; background:rgba(255,255,255,.08); padding:3px; border-radius:3px; }
        .switcher button { background:transparent; border:none; color:var(--ivory); font-size:13px; padding:6px 14px; cursor:pointer; border-radius:2px; }
        .switcher button.active { background:var(--brass); color:var(--wood-deep); font-weight:600; }
        .body { display:flex; flex:1; min-height:560px; }
        .nav { width:170px; background:var(--wood); color:var(--ivory); padding:18px 0; flex-shrink:0; }
        .nav button { width:100%; text-align:left; background:transparent; border:none; color:var(--ivory); opacity:.75; font-size:13.5px; padding:10px 18px; display:flex; align-items:center; gap:9px; cursor:pointer; border-left:3px solid transparent; }
        .nav button.active { opacity:1; border-left:3px solid var(--brass-light); background:rgba(255,255,255,.05); }
        .main { flex:1; padding:22px 26px; overflow-y:auto; }
        h1.pt { font-family:'Fraunces',serif; font-size:23px; font-weight:500; margin:0 0 4px 0; }
        .sub { color:#6b5b48; font-size:13px; margin-bottom:18px; }
        .stat-row { display:flex; gap:12px; margin-bottom:22px; }
        .stat { background:var(--panel); border:1px solid var(--line); border-top:3px solid var(--brass); padding:12px 16px; flex:1; }
        .stat .num { font-family:'Fraunces',serif; font-size:24px; }
        .stat .label { font-size:11.5px; color:#6b5b48; margin-top:2px; }
        .sec { font-family:'Fraunces',serif; font-size:15px; margin:20px 0 8px 0; border-bottom:1px solid var(--line); padding-bottom:5px; }
        .row { display:flex; align-items:center; justify-content:space-between; padding:10px 12px; border-bottom:1px solid var(--line); background:var(--panel); }
        .row:first-of-type { border-top:1px solid var(--line); }
        .row .name { font-weight:600; font-size:13.5px; }
        .row .meta { font-size:11.5px; color:#6b5b48; margin-top:2px; }
        .badge { font-size:10.5px; padding:3px 8px; border-radius:2px; font-weight:600; white-space:nowrap; }
        .badge.due{background:#f2ded8;color:var(--due)} .badge.scheduled{background:#e2e8dd;color:var(--ok)}
        .badge.buy{background:#e4ecf2;color:#33566e} .badge.sell{background:#f2ecd8;color:#7a5f22}
        .badge.new{background:#e4ecf2;color:#33566e} .badge.contacted{background:#f2ecd8;color:#7a5f22}
        .card { border:1px solid var(--line); background:var(--panel); padding:12px 14px; margin-bottom:10px; }
        .tabs { display:flex; gap:6px; margin-bottom:14px; flex-wrap:wrap; }
        .tabs button { padding:5px 12px; font-size:12px; border:1px solid var(--line); background:var(--panel); cursor:pointer; }
        .tabs button.active { background:var(--wood); color:var(--ivory); border-color:var(--wood); }
        button.action { background:var(--brass); color:var(--wood-deep); border:none; padding:6px 13px; font-size:12.5px; font-weight:600; cursor:pointer; }
        button.ghost { background:transparent; border:1px solid var(--line); padding:5px 10px; font-size:11.5px; cursor:pointer; }
        .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:18px; }
        .slot-modal { position:fixed; inset:0; background:rgba(36,26,18,.55); display:flex; align-items:center; justify-content:center; z-index:10; }
        .slot-card { background:var(--panel); padding:20px 22px; width:300px; border-top:4px solid var(--brass); }
        .slot-card h3 { font-family:'Fraunces',serif; margin:0 0 12px 0; font-size:16px; }
        .slot-opt { display:block; width:100%; text-align:left; padding:9px 11px; margin-bottom:7px; background:var(--ivory); border:1px solid var(--line); cursor:pointer; font-size:13px; }
        .slot-opt:hover { border-color:var(--brass); }
        .toast { position:fixed; bottom:16px; left:50%; transform:translateX(-50%); background:var(--wood-deep); color:var(--ivory); padding:9px 16px; font-size:13px; border-left:3px solid var(--brass-light); z-index:20; }
        .client-select { background:var(--wood-deep); color:var(--ivory); border:1px solid var(--brass); padding:5px 9px; font-size:12.5px; }
        .empty { color:#8a7a63; font-size:13px; padding:10px 0; }
        .uc { font-size:10px; text-transform:uppercase; color:#999; }
      `}</style>

      <div className="topbar">
        <div className="brand"><div className="keys"><span/><span/><span/><span/><span/><span/><span/></div>Soundboard <span style={{fontSize:11,opacity:.6,fontFamily:'Inter'}}>· demo</span></div>
        <div style={{display:"flex",gap:10,alignItems:"center"}}>
          {view==="owner" && (
            <div style={{display:"flex",gap:6}}>
              <button className="ghost" style={{color:"var(--ivory)",borderColor:"rgba(255,255,255,.3)"}} onClick={()=>setQuickAdd("client")}>+ New client</button>
              <button className="ghost" style={{color:"var(--ivory)",borderColor:"rgba(255,255,255,.3)"}} onClick={()=>setQuickAdd("piano")}>+ New piano</button>
            </div>
          )}
          <div className="switcher">
            <button className={view==="owner"?"active":""} onClick={()=>setView("owner")}>Owner portal</button>
            <button className={view==="client"?"active":""} onClick={()=>setView("client")}>Client portal</button>
          </div>
        </div>
      </div>

      {view === "owner" ? (
        <div className="body">
          <div className="nav">
            {[["dashboard","Dashboard",Wrench],["clients","Clients",Users],["pianos","Pianos",Music2],["leads","Leads",Inbox],["estimates","Estimates",Mail],["services","Services",FileText],["jobs","Jobs",Clock3],["invoices","Invoices",DollarSign],["availability","Availability",Calendar],["buysell","Buy/Sell",Repeat],["documents","Documents",Folder]].map(([k,l,Icon])=>(
              <button key={k} className={ownerTab===k?"active":""} onClick={()=>setOwnerTab(k)}><Icon size={14}/> {l}</button>
            ))}
          </div>
          <div className="main">
            {ownerTab==="dashboard" && (<>
              <h1 className="pt">Dashboard</h1>
              <p className="sub">Snapshot across your client base.</p>
              <div className="stat-row">
                <div className="stat"><div className="num">{SEED.clients.length}</div><div className="label">Clients (demo set)</div></div>
                <div className="stat"><div className="num">{dueClients.length}</div><div className="label">Due for service</div></div>
                <div className="stat"><div className="num">{leads.filter(l=>l.status==="new").length}</div><div className="label">New leads</div></div>
              </div>
              <div className="sec">Due for service</div>
              {dueClients.map(c=>(
                <div className="row" key={c.id}><div><div className="name">{c.name}</div><div className="meta">{c.pianos[0].make} {c.pianos[0].model} · last serviced {c.pianos[0].lastService}</div></div><span className="badge due">Reminder due</span></div>
              ))}
            </>)}

            {ownerTab==="clients" && (<>
              <h1 className="pt">Clients</h1>
              <p className="sub">Single source of truth for every client and piano.</p>
              {SEED.clients.map(c=>(
                <div className="card" key={c.id}>
                  <div className="name">{c.name}</div>
                  <div className="meta"><Mail size={11} style={{display:"inline",marginRight:4}}/>{c.email} · {c.phone}</div>
                  {c.pianos.map(p=>(<div key={p.id} style={{fontSize:12.5,marginTop:6}}><Music2 size={12} style={{display:"inline",marginRight:5,verticalAlign:"-2px"}}/>{p.make} {p.model} · SN {p.serial} · {p.type} · last service {p.lastService}</div>))}
                </div>
              ))}
            </>)}

            {ownerTab==="pianos" && (<>
              <h1 className="pt">Pianos</h1>
              <p className="sub">Every piano across every client, sorted by what's actually due next.</p>
              {SEED.clients.flatMap(c=>c.pianos.map(p=>({...p,clientName:c.name})))
                .sort((a,b)=>new Date(a.lastService)-new Date(b.lastService))
                .map(p=>(
                  <div className="row" key={p.id}>
                    <div><div className="name">{p.make} {p.model}</div><div className="meta">SN {p.serial} · {p.type} · {p.clientName}</div></div>
                    <span className="uc">last tuned {p.lastService}</span>
                  </div>
              ))}
            </>)}

            {ownerTab==="leads" && (<>
              <h1 className="pt">Leads</h1>
              <p className="sub">From the website and ad landing page — utm fields show which channel worked.</p>
              {leads.map(l=>(
                <div className="card" key={l.id}>
                  <div style={{display:"flex",justifyContent:"space-between"}}><strong style={{fontSize:13.5}}>{l.name}</strong><span className={`badge ${l.status}`}>{l.status}</span></div>
                  <div className="meta" style={{marginTop:4}}>zip {l.zip} · {l.piano_type} piano · wants {l.service_needed} · {l.created}</div>
                  <div className="uc" style={{marginTop:6}}>source: {l.utm_source ? `${l.utm_source} / ${l.utm_campaign}` : "organic / direct"}</div>
                  <div style={{display:"flex",gap:6,marginTop:8}}>
                    {["new","contacted","quoted"].filter(s=>s!==l.status).map(s=>(
                      <button key={s} className="ghost" onClick={()=>markLeadStatus(l.id,s)}>Mark {s}</button>
                    ))}
                  </div>
                </div>
              ))}
            </>)}

            {ownerTab==="estimates" && (<>
              <h1 className="pt">Estimates</h1>
              <p className="sub">Where proposed work originates — accepting generates the client's portal items.</p>
              {ESTIMATES.map(e=>(
                <div className="card" key={e.id}>
                  <div style={{display:"flex",justifyContent:"space-between"}}><strong style={{fontSize:13.5}}>{e.clientName}</strong><span className="badge scheduled">{e.status}</span></div>
                  {e.items.map((it,i)=>(
                    <div key={i} className="meta" style={{marginTop:4}}>{it.desc} <span className="uc">· {it.type==="in_shop"?"shop":"in-home"}</span> — ${it.amount}</div>
                  ))}
                  <div style={{fontWeight:600,fontSize:13,marginTop:6}}>Total: ${e.total}</div>
                </div>
              ))}
            </>)}

            {ownerTab==="jobs" && (<>
              <h1 className="pt">Jobs</h1>
              <p className="sub">Scheduled work waiting to happen — completing one updates the piano's service history.</p>
              {jobs.filter(j=>!j.done).length===0 && <p className="empty">Nothing scheduled right now.</p>}
              {jobs.filter(j=>!j.done).map(j=>(
                <div className="card" key={j.id}>
                  <div style={{display:"flex",justifyContent:"space-between"}}><strong style={{fontSize:13.5}}>{j.clientName}</strong><span className="uc">{j.type==="in_shop"?"shop":"in-home"}</span></div>
                  <div className="meta">{j.piano} · {j.desc}</div>
                  <div className="meta">Scheduled: {j.scheduled}</div>
                  <button className="action" style={{marginTop:8}} onClick={()=>markJobDone(j.id)}>Mark completed (today)</button>
                </div>
              ))}
              {jobs.filter(j=>j.done).length>0 && <>
                <div className="sec">Completed</div>
                {jobs.filter(j=>j.done).map(j=>(
                  <div className="row" key={j.id}>
                    <div><div className="name">{j.clientName}</div><div className="meta">{j.piano} · {j.desc}</div></div>
                    <button className="ghost" onClick={()=>createInvoice(j)}>Create invoice</button>
                  </div>
                ))}
              </>}
            </>)}

            {ownerTab==="invoices" && (<>
              <h1 className="pt">Invoices</h1>
              <p className="sub">Sent via Square — flips to "paid" automatically once payment clears.</p>
              {invoices.map(inv=>(
                <div className="card" key={inv.id}>
                  <div style={{display:"flex",justifyContent:"space-between"}}><strong style={{fontSize:13.5}}>{inv.clientName}</strong><span className={`badge ${inv.status==="paid"?"scheduled":"due"}`}>{inv.status}</span></div>
                  <div className="meta" style={{marginTop:4}}>${inv.total.toFixed(2)}</div>
                  {inv.status==="draft" && <button className="ghost" style={{marginTop:8}} onClick={()=>sendInvoice(inv.id)}>Send for payment</button>}
                  {inv.status==="sent" && <button className="action" style={{marginTop:8}} onClick={()=>payInvoice(inv.id)}>Simulate client paying</button>}
                </div>
              ))}
            </>)}

            {ownerTab==="documents" && (<>
              <h1 className="pt">Documents</h1>
              <p className="sub">Consolidated records — old invoices, photos, voice memo notes, whatever's worth keeping.</p>
              {DOCUMENTS.map(d=>(
                <div className="card" key={d.id}>
                  <div style={{display:"flex",justifyContent:"space-between"}}><strong style={{fontSize:13.5}}>{d.title}</strong><span className="uc">{d.source.replace("_"," ")}</span></div>
                  <div className="meta" style={{marginTop:4}}>{d.client}</div>
                  <div style={{display:"flex",gap:5,marginTop:6}}>{d.tags.map(t=><span key={t} className="uc" style={{background:"#eee",padding:"2px 7px"}}>{t}</span>)}</div>
                </div>
              ))}
            </>)}

            {ownerTab==="services" && (<>
              <h1 className="pt">Master Service List</h1>
              <p className="sub">Real sample rows from your actual price list. Prices are per piano type — try the bulk adjuster below.</p>
              <div className="card" style={{border:"1px solid var(--due)"}}>
                <strong style={{fontSize:13}}>Bulk adjust every price</strong>
                <div style={{display:"flex",gap:8,alignItems:"center",marginTop:8}}>
                  <input type="number" value={bulkPercent} onChange={e=>setBulkPercent(e.target.value)} style={{width:70,padding:6,border:"1px solid var(--line)"}} />
                  <span>%</span>
                  <button className="action" onClick={applyBulkAdjust}>Apply to every price</button>
                </div>
                <div className="meta" style={{marginTop:6}}>Your real numbers are ~10 years old and priced under market — this brings everything up in one action instead of editing hundreds of cells.</div>
              </div>
              {services.map(s=>(
                <div className="card" key={s.id}>
                  <div style={{display:"flex",justifyContent:"space-between"}}><strong style={{fontSize:13.5}}>{s.name}</strong><span className="uc">{s.category}</span></div>
                  <div style={{display:"flex",gap:14,flexWrap:"wrap",marginTop:6}}>
                    {Object.entries(s.prices).map(([type,price])=>(
                      <div key={type} style={{fontSize:12}}>
                        <span className="uc" style={{color:"#999"}}>{type.replace("_"," ")}</span>{" "}
                        <strong>${price.toFixed(2)}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </>)}

            {ownerTab==="availability" && (<>
              <h1 className="pt">Availability</h1>
              <p className="sub">Home-visit and shop slots — clients only ever see the type matching their proposed work.</p>
              <div className="sec">Home-visit slots</div>
              {slots.filter(s=>s.type==="in_home").map(s=>(<div className="row" key={s.id}><span>{s.time}</span>{s.booked ? <span className="badge scheduled">Booked</span> : <span className="uc">Open</span>}</div>))}
              <div className="sec">Shop slots</div>
              {slots.filter(s=>s.type==="in_shop").map(s=>(<div className="row" key={s.id}><span>{s.time}</span>{s.booked ? <span className="badge scheduled">Booked</span> : <span className="uc">Open</span>}</div>))}
            </>)}

            {ownerTab==="buysell" && (<>
              <h1 className="pt">Buy / Sell list</h1>
              <p className="sub">Simple, honest matching by piano type.</p>
              <div className="grid2">
                <div>
                  <div className="sec">Looking to acquire</div>
                  {SEED.buyers.map(b=>(
                    <div className="card" key={b.id}>
                      <strong style={{fontSize:13}}>{b.clientName}</strong>
                      <div className="meta">Wants: {b.wants} — {b.details}</div>
                      <div style={{fontSize:11.5,marginTop:6,background:"#e2e8dd",padding:6}}><strong>Possible match:</strong> {SEED.sellers.find(s=>s.type===b.wants)?.clientName ?? "none yet"}</div>
                    </div>
                  ))}
                </div>
                <div>
                  <div className="sec">Looking to sell</div>
                  {SEED.sellers.map(s=>(
                    <div className="card" key={s.id}><strong style={{fontSize:13}}>{s.clientName}</strong><div className="meta">{s.piano} ({s.type}) — {s.details}</div></div>
                  ))}
                </div>
              </div>
            </>)}
          </div>
        </div>
      ) : (
        <div className="body">
          <div className="main" style={{width:"100%"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <div><h1 className="pt" style={{marginBottom:0}}>Welcome, {activeClient.name.split(" ")[0]}</h1><p className="sub" style={{marginBottom:0}}>Your piano and any proposed work.</p></div>
              <select className="client-select" value={activeClientId} onChange={e=>setActiveClientId(e.target.value)}>
                {SEED.clients.map(c=><option key={c.id} value={c.id}>View as: {c.name}</option>)}
              </select>
            </div>

            <div className="sec">Your piano</div>
            <div className="card">
              <strong style={{fontSize:13.5}}>{activeClient.pianos[0].make} {activeClient.pianos[0].model}</strong>
              <div className="meta">Serial {activeClient.pianos[0].serial} · Last service {activeClient.pianos[0].lastService}</div>
            </div>

            <div className="sec">Proposed &amp; scheduled work</div>
            {[
              { id:"w1", desc:"Routine tuning", type:"in_home" },
              ...(activeClient.id==="c4" ? [{ id:"w2", desc:"Evaluation for full rebuild", type:"in_home" }, { id:"w3", desc:"Action rebuild (bench work)", type:"in_shop" }] : []),
            ].map(w=>{
              const matchType = slots.filter(s=>s.type===w.type && !s.booked);
              const bookedForThis = slots.find(s=>s.type===w.type && s.booked);
              return (
                <div className="card" key={w.id}>
                  <div>{w.desc} <span className="uc">· {w.type==="in_shop"?"shop visit":"in-home visit"}</span></div>
                  {bookedForThis ? (
                    <div className="meta" style={{marginTop:6}}><CheckCircle2 size={11} style={{display:"inline",marginRight:4,verticalAlign:"-1px"}}/>Confirmed: {bookedForThis.time}</div>
                  ) : (
                    <button className="action" style={{marginTop:8}} onClick={()=>setSchedulingSlotFor(w)}>Self-schedule</button>
                  )}
                </div>
              );
            })}

            {invoices.filter(i=>i.clientName===activeClient.name).length>0 && <>
              <div className="sec">Invoices</div>
              {invoices.filter(i=>i.clientName===activeClient.name).map(inv=>(
                <div className="card" key={inv.id}>
                  <div>${inv.total.toFixed(2)} — <span className="uc">{inv.status}</span></div>
                  {inv.status==="sent" && <button className="action" style={{marginTop:6}} onClick={()=>payInvoice(inv.id)}>Pay now</button>}
                  {inv.status==="paid" && <div className="meta" style={{color:"var(--ok)"}}>Paid — thank you!</div>}
                </div>
              ))}
            </>}
          </div>
        </div>
      )}

      {schedulingSlotFor && (
        <div className="slot-modal" onClick={()=>setSchedulingSlotFor(null)}>
          <div className="slot-card" onClick={e=>e.stopPropagation()}>
            <h3>Pick a time ({schedulingSlotFor.type==="in_shop"?"shop":"in-home"})</h3>
            {slots.filter(s=>s.type===schedulingSlotFor.type && !s.booked).map(s=>(
              <button key={s.id} className="slot-opt" onClick={()=>bookSlot(s.id)}>{s.time}</button>
            ))}
            <button className="ghost" style={{marginTop:6,width:"100%"}} onClick={()=>setSchedulingSlotFor(null)}><X size={11} style={{display:"inline",marginRight:4,verticalAlign:"-1px"}}/>Cancel</button>
          </div>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}

      {quickAdd && (
        <div className="slot-modal" onClick={()=>setQuickAdd(null)}>
          <div className="slot-card" onClick={e=>e.stopPropagation()}>
            <h3>{quickAdd==="client" ? "New client" : "New piano"}</h3>
            <form onSubmit={quickAddSubmit} style={{display:"flex",flexDirection:"column",gap:8}}>
              {quickAdd==="client" ? (
                <>
                  <input placeholder="Name" style={{padding:8,border:"1px solid var(--line)"}} />
                  <input placeholder="Email" style={{padding:8,border:"1px solid var(--line)"}} />
                  <input placeholder="Phone" style={{padding:8,border:"1px solid var(--line)"}} />
                </>
              ) : (
                <>
                  <select style={{padding:8,border:"1px solid var(--line)"}}>
                    {SEED.clients.map(c=><option key={c.id}>{c.name}</option>)}
                  </select>
                  <input placeholder="Make (e.g. Yamaha)" style={{padding:8,border:"1px solid var(--line)"}} />
                  <input placeholder="Model" style={{padding:8,border:"1px solid var(--line)"}} />
                </>
              )}
              <div style={{display:"flex",gap:8,marginTop:4}}>
                <button type="submit" className="action">{quickAdd==="client" ? "Create client" : "Create piano"}</button>
                <button type="button" className="ghost" onClick={()=>setQuickAdd(null)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
