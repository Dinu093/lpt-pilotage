import { useState, useEffect } from "react";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://svrmgurokzxlaxditxpg.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN2cm1ndXJva3p4bGF4ZGl0eHBnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0MzUzMTMsImV4cCI6MjA5MDAxMTMxM30.s4HcUeau23rHV_zrhslTOdKN6jfLrRfHrnRZ9kokHJI";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const fmt    = (n, d = 0) => n == null ? "–" : Number(n).toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtPct = (n) => n == null ? "–" : `${Number(n).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`;
const fmtEur = (n) => n == null ? "–" : `${fmt(n, 2)} €`;

function parseCSV(text) {
  // Gère tous les formats de retour à la ligne : \r\n, \r, \n
  text = text.replace(/^\uFEFF/, "");
  const lines = text.split(/\r\n|\r|\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const sep = lines[0].includes(";") ? ";" : ",";
  const headers = lines[0].split(sep).map(h => h.trim());
  const hmap = {};
  headers.forEach((h, i) => { hmap[h.toLowerCase()] = i; });
  const g = (...keys) => { for (const k of keys) if (hmap[k] !== undefined) return hmap[k]; return -1; };
  const iName    = g("item", "_id");
  const iPlace   = g("placement");
  const iFlux    = g("flux");
  const iConv    = g("conversion");
  const iPM      = g("avgpriceht");
  const iCA      = g("amountht");
  const iBaskets = g("realbaskets");
  const results = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(sep);
    if (c.length < 5) continue;
    const name = iName >= 0 ? c[iName]?.trim() : c[0]?.trim();
    if (!name || name.includes("[object") || name.toLowerCase().includes("web")) continue;
    const raw = {};
    headers.forEach((h, idx) => { raw[h] = c[idx]?.trim() || null; });
    results.push({
      name,
      placement:    iPlace   >= 0 ? c[iPlace]?.trim()         : null,
      flux:         iFlux    >= 0 ? parseInt(c[iFlux])    || null : null,
      conversion:   iConv    >= 0 ? parseFloat(c[iConv])  || null : null,
      avg_price_ht: iPM      >= 0 ? parseFloat(c[iPM])    || null : null,
      amount_ht:    iCA      >= 0 ? parseFloat(c[iCA])    || null : null,
      real_baskets: iBaskets >= 0 ? parseInt(c[iBaskets]) || null : null,
      raw_data: raw,
    });
  }
  return results;
}

function forecastSARIMA(values, months = 6) {
  const n = values.length;
  if (n < 3) return [];
  let sx = 0, sy = 0, sxy = 0, sx2 = 0;
  for (let i = 0; i < n; i++) { sx += i; sy += values[i]; sxy += i * values[i]; sx2 += i * i; }
  const slope = (n * sxy - sx * sy) / (n * sx2 - sx * sx);
  const intercept = (sy - slope * sx) / n;
  const s = Math.min(12, n);
  const seas = new Array(s).fill(0), cnt = new Array(s).fill(0);
  for (let i = 0; i < n; i++) { seas[i % s] += values[i] - (intercept + slope * i); cnt[i % s]++; }
  for (let i = 0; i < s; i++) seas[i] = cnt[i] ? seas[i] / cnt[i] : 0;
  const last = values.slice(-Math.min(12, n));
  return Array.from({ length: months }, (_, i) => {
    const fi = n + i;
    const ar = last[i % last.length] != null ? (last[i % last.length] - (intercept + slope * (n - last.length + i % last.length))) * 0.45 : 0;
    return Math.max(0, Math.round(intercept + slope * fi + seas[i % s] + ar));
  });
}

const S = {
  input: { display:"block", width:"100%", padding:"8px 12px", borderRadius:8, border:"1px solid #d1d5db", fontSize:13, background:"#fff", color:"#111827", boxSizing:"border-box" },
  label: { display:"block", fontSize:11, fontWeight:600, color:"#6b7280", marginBottom:6, textTransform:"uppercase", letterSpacing:".05em" },
  th: { padding:"10px 16px", textAlign:"left", fontSize:11, fontWeight:700, color:"#6b7280", textTransform:"uppercase", letterSpacing:".05em", whiteSpace:"nowrap" },
  td: { padding:"10px 16px", color:"#374151", whiteSpace:"nowrap" },
  pill: (p) => ({ padding:"2px 8px", borderRadius:20, fontSize:11, fontWeight:600, background:p==="mall"?"#ede9fe":p==="city"?"#d1fae5":"#f3f4f6", color:p==="mall"?"#5b21b6":p==="city"?"#065f46":"#374151" }),
  card: { background:"#fff", borderRadius:14, padding:"16px 20px", border:"1px solid #e5e7eb", boxShadow:"0 1px 4px rgba(0,0,0,.05)" },
};

function UploadPage({ onDone }) {
  const [file, setFile]       = useState(null);
  const [period, setPeriod]   = useState("");
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg]         = useState(null);

  const handleFile = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    setFile(f);
    const reader = new FileReader();
    reader.onload = (ev) => setPreview(parseCSV(ev.target.result));
    reader.readAsText(f, "utf-8");
  };

  const handleConfirm = async () => {
    if (!preview || !period) return;
    setLoading(true);
    setMsg(null);
    try {
      for (const row of preview) {
        const { data: store, error: sErr } = await supabase
          .from("retail_stores")
          .upsert({ name: row.name, placement: row.placement }, { onConflict: "name" })
          .select("id").single();
        if (sErr) throw sErr;
        const { error: dErr } = await supabase.from("retail_monthly_data").upsert({
          store_id: store.id, period: period + "-01",
          flux: row.flux, conversion: row.conversion,
          avg_price_ht: row.avg_price_ht, amount_ht: row.amount_ht,
          real_baskets: row.real_baskets, raw_data: row.raw_data,
        }, { onConflict: "store_id,period" });
        if (dErr) throw dErr;
      }
      await supabase.from("retail_csv_imports").insert({ period: period + "-01", filename: file.name, row_count: preview.length });
      setMsg({ ok: true, text: `✓ ${preview.length} magasins importés` });
      setTimeout(onDone, 1500);
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    }
    setLoading(false);
  };

  return (
    <div style={{ maxWidth:960, margin:"0 auto", padding:"32px 24px" }}>
      <h2 style={{ fontSize:20, fontWeight:700, marginBottom:24 }}>Import données mensuelles</h2>
      <div style={{ display:"flex", gap:16, marginBottom:24, alignItems:"flex-end" }}>
        <div style={{ flex:1 }}>
          <label style={S.label}>Fichier CSV</label>
          <input type="file" accept=".csv" onChange={handleFile} style={{ ...S.input, cursor:"pointer" }} />
        </div>
        <div>
          <label style={S.label}>Période</label>
          <input type="month" value={period} onChange={e => setPeriod(e.target.value)} style={S.input} />
        </div>
      </div>
      {preview && (
        <>
          <div style={{ marginBottom:12 }}>
            <span style={{ fontSize:13, fontWeight:600, color:"#111827" }}>{preview.length} magasins détectés</span>
            {preview.length === 0 && <span style={{ fontSize:12, color:"#dc2626", marginLeft:8 }}>⚠ Fichier non reconnu</span>}
          </div>
          {preview.length > 0 && (
            <>
              <div style={{ overflowX:"auto", borderRadius:12, border:"1px solid #e5e7eb", marginBottom:20 }}>
                <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
                  <thead>
                    <tr style={{ background:"#f9fafb" }}>
                      {["Magasin","Type","Flux","TT %","PM HT €","CA HT €"].map(h => <th key={h} style={S.th}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((r, i) => (
                      <tr key={i} style={{ borderTop:"1px solid #f3f4f6", background:i%2?"#fafafa":"#fff" }}>
                        <td style={S.td}>{r.name}</td>
                        <td style={S.td}><span style={S.pill(r.placement)}>{r.placement||"–"}</span></td>
                        <td style={{ ...S.td, textAlign:"right" }}>{fmt(r.flux)}</td>
                        <td style={{ ...S.td, textAlign:"right" }}>{fmtPct(r.conversion)}</td>
                        <td style={{ ...S.td, textAlign:"right" }}>{fmtEur(r.avg_price_ht)}</td>
                        <td style={{ ...S.td, textAlign:"right" }}>{fmtEur(r.amount_ht)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {msg && <div style={{ padding:"10px 16px", borderRadius:8, marginBottom:16, fontSize:13, background:msg.ok?"#d1fae5":"#fee2e2", color:msg.ok?"#065f46":"#991b1b" }}>{msg.text}</div>}
              <button onClick={handleConfirm} disabled={!period||loading}
                style={{ padding:"10px 24px", borderRadius:10, background:"#4f46e5", color:"#fff", fontWeight:600, fontSize:14, border:"none", cursor:"pointer", opacity:(!period||loading)?.5:1 }}>
                {loading ? "Enregistrement…" : "✓ Valider et enregistrer"}
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}

function DashboardPage() {
  const [allData, setAllData]   = useState([]);
  const [stores, setStores]     = useState([]);
  const [periods, setPeriods]   = useState([]);
  const [selected, setSelected] = useState("__all__");
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    (async () => {
      const { data: s } = await supabase.from("retail_stores").select("*").order("name");
      const { data: m } = await supabase.from("retail_monthly_data").select("*, retail_stores(name,placement)").order("period");
      setStores(s || []);
      setAllData(m || []);
      setPeriods([...new Set((m||[]).map(r => r.period.substring(0,7)))].sort());
      setLoading(false);
    })();
  }, []);

  if (loading) return <div style={{ padding:40, textAlign:"center", color:"#9ca3af" }}>Chargement…</div>;
  if (!allData.length) return <div style={{ padding:40, textAlign:"center", color:"#6b7280" }}>Aucune donnée — importez un CSV.</div>;

  const agg = (rows) => {
    const ttR = rows.filter(r => r.conversion);
    const pmR = rows.filter(r => r.avg_price_ht);
    return {
      flux: rows.reduce((s,r) => s+(r.flux||0), 0),
      tt:   ttR.length ? ttR.reduce((s,r) => s+r.conversion, 0)/ttR.length : null,
      pm:   pmR.length ? pmR.reduce((s,r) => s+r.avg_price_ht, 0)/pmR.length : null,
      ca:   rows.reduce((s,r) => s+(r.amount_ht||0), 0),
    };
  };

  const net = agg(allData.filter(r => r.period.startsWith(periods[periods.length-1])));
  const storeRows = selected==="__all__" ? allData : allData.filter(r => r.retail_stores?.name===selected);
  const series = periods.map(p => ({ period:p, ...agg(storeRows.filter(r => r.period.startsWith(p))) }));
  const last = series[series.length-1];
  const prev = series[series.length-2];
  const fluxVals = series.map(s => s.flux).filter(Boolean);
  const fc = forecastSARIMA(fluxVals);
  const [fy, fm] = (periods[periods.length-1]||"2026-01").split("-").map(Number);
  const fcPeriods = fc.map((flux,i) => {
    let nm=fm+i+1, ny=fy;
    if(nm>12){nm-=12;ny++;}
    return { period:`${ny}-${String(nm).padStart(2,"0")}`, flux };
  });
  const delta = (a,b) => (!a||!b) ? null : ((a-b)/Math.abs(b)*100);
  const badge = (d) => d==null ? null : (
    <span style={{ fontSize:11, fontWeight:600, padding:"2px 6px", borderRadius:20, background:d>=0?"#d1fae5":"#fee2e2", color:d>=0?"#065f46":"#991b1b" }}>
      {d>=0?"▲":"▼"} {Math.abs(d).toFixed(2)}%
    </span>
  );

  const KPI = ({ label, value, sub, d }) => (
    <div style={S.card}>
      <div style={{ fontSize:11, color:"#9ca3af", fontWeight:600, textTransform:"uppercase", letterSpacing:".05em", marginBottom:4 }}>{label}</div>
      <div style={{ display:"flex", alignItems:"baseline", gap:8, marginBottom:4 }}>
        <span style={{ fontSize:24, fontWeight:700, color:"#111827" }}>{value}</span>
        {badge(d)}
      </div>
      <div style={{ fontSize:12, color:"#6b7280" }}>{sub}</div>
    </div>
  );

  return (
    <div style={{ maxWidth:1100, margin:"0 auto", padding:"32px 24px" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:28 }}>
        <h2 style={{ fontSize:20, fontWeight:700, color:"#111827" }}>{selected==="__all__"?"Réseau complet":selected}</h2>
        <select value={selected} onChange={e=>setSelected(e.target.value)} style={{ ...S.input, width:"auto", minWidth:220 }}>
          <option value="__all__">— Réseau global —</option>
          {stores.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
        </select>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))", gap:14, marginBottom:32 }}>
        <KPI label="Flux"               value={fmt(last?.flux)}    sub={`Réseau : ${fmt(net?.flux)}`}    d={delta(last?.flux, prev?.flux)} />
        <KPI label="Taux transformation" value={fmtPct(last?.tt)}  sub={`Réseau : ${fmtPct(net?.tt)}`}  d={delta(last?.tt,   prev?.tt)}   />
        <KPI label="Panier moyen HT"    value={fmtEur(last?.pm)}   sub={`Réseau : ${fmtEur(net?.pm)}`}  d={delta(last?.pm,   prev?.pm)}   />
        <KPI label="CA HT"              value={fmtEur(last?.ca)}   sub={`Réseau : ${fmtEur(net?.ca)}`}  d={delta(last?.ca,   prev?.ca)}   />
      </div>

      <div style={{ ...S.card, padding:0, overflow:"hidden", marginBottom:28 }}>
        <div style={{ padding:"14px 20px", borderBottom:"1px solid #f3f4f6", fontWeight:600, fontSize:14, color:"#374151" }}>Historique mensuel</div>
        <div style={{ overflowX:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
            <thead><tr style={{ background:"#f9fafb" }}>{["Période","Flux","TT %","PM HT €","CA HT €"].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {series.slice().reverse().map((s,i)=>(
                <tr key={s.period} style={{ borderTop:"1px solid #f3f4f6", background:i%2?"#fafafa":"#fff" }}>
                  <td style={{ ...S.td, fontWeight:600 }}>{s.period}</td>
                  <td style={{ ...S.td, textAlign:"right" }}>{fmt(s.flux)}</td>
                  <td style={{ ...S.td, textAlign:"right" }}>{fmtPct(s.tt)}</td>
                  <td style={{ ...S.td, textAlign:"right" }}>{fmtEur(s.pm)}</td>
                  <td style={{ ...S.td, textAlign:"right" }}>{fmtEur(s.ca)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {fcPeriods.length > 0 && (
        <div style={{ ...S.card, padding:0, overflow:"hidden" }}>
          <div style={{ padding:"14px 20px", borderBottom:"1px solid #f3f4f6", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <span style={{ fontWeight:600, fontSize:14, color:"#374151" }}>Prévisionnel flux — 6 mois</span>
            <span style={{ fontSize:11, color:"#9ca3af" }}>SARIMA · ±7%</span>
          </div>
          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
              <thead><tr style={{ background:"#f9fafb" }}>{["Période","Central","Bas −7%","Haut +7%","vs N−1"].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
              <tbody>
                {fcPeriods.map((f,i)=>{
                  const ref=fluxVals[fluxVals.length-6+i];
                  const evo=ref?((f.flux-ref)/ref*100):null;
                  return (
                    <tr key={f.period} style={{ borderTop:"1px solid #f3f4f6", background:i%2?"#eef2ff":"#f0f4ff" }}>
                      <td style={{ ...S.td, fontWeight:600, color:"#4f46e5" }}>{f.period}</td>
                      <td style={{ ...S.td, textAlign:"right", fontWeight:700, color:"#4f46e5" }}>{fmt(f.flux)}</td>
                      <td style={{ ...S.td, textAlign:"right", color:"#6b7280" }}>{fmt(Math.round(f.flux*.93))}</td>
                      <td style={{ ...S.td, textAlign:"right", color:"#6b7280" }}>{fmt(Math.round(f.flux*1.07))}</td>
                      <td style={{ ...S.td, textAlign:"right" }}>{evo!=null&&<span style={{ color:evo>=0?"#059669":"#dc2626", fontWeight:600 }}>{evo>0?"+":""}{evo.toFixed(2)}%</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [page, setPage] = useState("dashboard");
  const nav = (id, label) => (
    <button onClick={()=>setPage(id)} style={{ background:page===id?"#eef2ff":"transparent", border:"none", cursor:"pointer", padding:"8px 18px", fontSize:13, fontWeight:600, borderRadius:8, color:page===id?"#4f46e5":"#6b7280" }}>
      {label}
    </button>
  );
  return (
    <div style={{ minHeight:"100vh", background:"#f9fafb", fontFamily:"system-ui,sans-serif" }}>
      <div style={{ background:"#fff", borderBottom:"1px solid #e5e7eb", padding:"0 24px", display:"flex", alignItems:"center", gap:8, height:52 }}>
        <span style={{ fontWeight:800, fontSize:15, color:"#111827", marginRight:16 }}>◈ Pilotage réseau</span>
        {nav("dashboard","Dashboard")}
        {nav("upload","Import CSV")}
      </div>
      {page==="dashboard" && <DashboardPage />}
      {page==="upload"    && <UploadPage onDone={()=>setPage("dashboard")} />}
    </div>
  );
}
