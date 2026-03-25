import { useState, useEffect, useRef } from "react";
import ForecastPage from "./Forecast.jsx";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from "recharts";

const SUPABASE_URL = "https://svrmgurokzxlaxditxpg.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN2cm1ndXJva3p4bGF4ZGl0eHBnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0MzUzMTMsImV4cCI6MjA5MDAxMTMxM30.s4HcUeau23rHV_zrhslTOdKN6jfLrRfHrnRZ9kokHJI";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const fmt    = (n, d = 0) => n == null ? "–" : Number(n).toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtPct = (n) => n == null ? "–" : `${Number(n).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`;
const fmtEur = (n) => n == null ? "–" : `${fmt(n, 2)} €`;
const fmtK   = (n) => n == null ? "–" : n >= 1000000 ? `${fmt(n/1000000,2)}M€` : n >= 1000 ? `${fmt(n/1000,1)}k` : fmt(n);

function parseCSV(text) {
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

function addMonths(ym, n) {
  let [y, m] = ym.split("-").map(Number);
  m += n;
  while (m > 12) { m -= 12; y++; }
  while (m < 1)  { m += 12; y--; }
  return `${y}-${String(m).padStart(2,"0")}`;
}

const S = {
  input: { display:"block", width:"100%", padding:"8px 12px", borderRadius:8, border:"1px solid #d1d5db", fontSize:13, background:"#fff", color:"#111827", boxSizing:"border-box" },
  label: { display:"block", fontSize:11, fontWeight:600, color:"#6b7280", marginBottom:6, textTransform:"uppercase", letterSpacing:".05em" },
  th: { padding:"10px 16px", textAlign:"left", fontSize:11, fontWeight:700, color:"#6b7280", textTransform:"uppercase", letterSpacing:".05em", whiteSpace:"nowrap" },
  td: { padding:"10px 16px", color:"#374151", whiteSpace:"nowrap" },
  pill: (p) => ({ padding:"2px 8px", borderRadius:20, fontSize:11, fontWeight:600, background:p==="mall"?"#ede9fe":p==="city"?"#d1fae5":"#f3f4f6", color:p==="mall"?"#5b21b6":p==="city"?"#065f46":"#374151" }),
  card: { background:"#fff", borderRadius:14, padding:"16px 20px", border:"1px solid #e5e7eb", boxShadow:"0 1px 4px rgba(0,0,0,.05)" },
};

// ─── KPI Card ─────────────────────────────────────────────────────────────────
function KPICard({ label, value, sub, delta, color }) {
  const d = delta;
  return (
    <div style={{ ...S.card, borderTop:`3px solid ${color}` }}>
      <div style={{ fontSize:11, color:"#9ca3af", fontWeight:600, textTransform:"uppercase", letterSpacing:".05em", marginBottom:6 }}>{label}</div>
      <div style={{ fontSize:28, fontWeight:800, color:"#111827", lineHeight:1, marginBottom:6 }}>{value}</div>
      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
        {d != null && (
          <span style={{ fontSize:12, fontWeight:600, padding:"2px 7px", borderRadius:20, background:d>=0?"#d1fae5":"#fee2e2", color:d>=0?"#065f46":"#991b1b" }}>
            {d>=0?"▲":"▼"} {Math.abs(d).toFixed(2)}%
          </span>
        )}
        <span style={{ fontSize:12, color:"#9ca3af" }}>{sub}</span>
      </div>
    </div>
  );
}

// ─── Upload Page ──────────────────────────────────────────────────────────────
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

// ─── Dashboard Page ───────────────────────────────────────────────────────────
function DashboardPage() {
  const [allData, setAllData]           = useState([]);
  const [stores, setStores]             = useState([]);
  const [periods, setPeriods]           = useState([]);
  const [selected, setSelected]         = useState("__all__");
  const [periodFrom, setPeriodFrom]     = useState(null);
  const [periodTo, setPeriodTo]         = useState(null);
  const [fcMonths, setFcMonths]         = useState(6);
  const [chartMetric, setChartMetric]   = useState("flux");
  const [collapsed, setCollapsed]       = useState({});
  const [loading, setLoading]           = useState(true);

  const loadData = async () => {
    const { data: s } = await supabase.from("retail_stores").select("*").order("name");
    let all = [], from = 0, batchSize = 500;
    while (true) {
      const { data: m } = await supabase
        .from("retail_monthly_data")
        .select("*, retail_stores(name,placement)")
        .order("period")
        .range(from, from + batchSize - 1);
      if (!m || m.length === 0) break;
      all = [...all, ...m];
      if (m.length < batchSize) break;
      from += batchSize;
    }
    setStores(s || []);
    setAllData(all);
    const ps = [...new Set(all.map(r => r.period.substring(0,7)))].sort();
    setPeriods(ps);
    if (!periodTo) setPeriodTo(ps[ps.length-1]);
    if (!periodFrom) setPeriodFrom(ps[Math.max(0, ps.length-12)]);
    setLoading(false);
  };

  useEffect(() => { loadData(); }, []);

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

  const storeRows = selected==="__all__" ? allData : allData.filter(r => r.retail_stores?.name===selected);
  const allSeries = periods.map(p => ({ period:p, ...agg(storeRows.filter(r => r.period.startsWith(p))) }));

  // Période sélectionnée pour les KPIs
  const pFrom = periodFrom || periods[0];
  const pTo   = periodTo   || periods[periods.length-1];
  const selectedPeriods = allSeries.filter(s => s.period >= pFrom && s.period <= pTo);

  // Agrégation sur la plage sélectionnée
  const sumFlux = selectedPeriods.reduce((s,r) => s+(r.flux||0), 0);
  const avgTT   = selectedPeriods.filter(r=>r.tt).length ? selectedPeriods.filter(r=>r.tt).reduce((s,r)=>s+r.tt,0)/selectedPeriods.filter(r=>r.tt).length : null;
  const avgPM   = selectedPeriods.filter(r=>r.pm).length ? selectedPeriods.filter(r=>r.pm).reduce((s,r)=>s+r.pm,0)/selectedPeriods.filter(r=>r.pm).length : null;
  const sumCA   = selectedPeriods.reduce((s,r) => s+(r.ca||0), 0);

  // Période précédente de même durée pour le delta
  const nbMonths = selectedPeriods.length;
  const prevFrom = addMonths(pFrom, -nbMonths);
  const prevTo   = addMonths(pTo,   -nbMonths);
  const prevPeriods = allSeries.filter(s => s.period >= prevFrom && s.period <= prevTo);
  const prevFlux = prevPeriods.reduce((s,r) => s+(r.flux||0), 0);
  const prevTT   = prevPeriods.filter(r=>r.tt).length ? prevPeriods.filter(r=>r.tt).reduce((s,r)=>s+r.tt,0)/prevPeriods.filter(r=>r.tt).length : null;
  const prevPM   = prevPeriods.filter(r=>r.pm).length ? prevPeriods.filter(r=>r.pm).reduce((s,r)=>s+r.pm,0)/prevPeriods.filter(r=>r.pm).length : null;
  const prevCA   = prevPeriods.reduce((s,r) => s+(r.ca||0), 0);

  const delta = (a,b) => (!a||!b||b===0) ? null : ((a-b)/Math.abs(b)*100);

  // Données graphique — 12 derniers mois réels + prévisionnel
  const last12 = allSeries.slice(-12);
  const fluxVals = allSeries.map(s => s.flux).filter(Boolean);
  const fc = forecastSARIMA(fluxVals, fcMonths);
  const lastPeriod = periods[periods.length-1];
  const fcData = fc.map((flux,i) => ({
    period: addMonths(lastPeriod, i+1),
    prevFlux: flux,
    prevBas: Math.round(flux*0.93),
    prevHaut: Math.round(flux*1.07),
  }));

  // Données chart selon métrique
  const metricKey = { flux:"flux", ca:"ca", tt:"tt", pm:"pm" }[chartMetric];
  const metricLabel = { flux:"Flux visiteurs", ca:"CA HT (€)", tt:"Taux transfo (%)", pm:"Panier moyen HT (€)" }[chartMetric];
  const chartHistData = last12.map(s => ({ period: s.period, valeur: s[metricKey] }));
  const chartFcData = fcData.map(s => ({ period: s.period, prevision: s.prevFlux }));
  const combinedChart = [
    ...chartHistData.map(d => ({ ...d, type:"hist" })),
    ...( chartMetric === "flux" ? chartFcData.map(d => ({ period:d.period, prevision:d.prevision, type:"fc" })) : [] )
  ];

  const toggleYear = (year) => setCollapsed(prev => ({ ...prev, [year]: !prev[year] }));

  const handleDelete = async (period) => {
    if (!confirm(`Supprimer toutes les données de ${period} ?`)) return;
    const ids = storeRows.filter(r => r.period.startsWith(period)).map(r => r.id);
    if (ids.length) {
      await supabase.from("retail_monthly_data").delete().in("id", ids);
      await loadData();
    }
  };

  const reversed = allSeries.slice().reverse();
  const histRows = [];
  let currentYear = null;
  reversed.forEach((s, i) => {
    const year = s.period.substring(0,4);
    if (year !== currentYear) { currentYear = year; histRows.push({ type:"year", year }); }
    histRows.push({ type:"row", s, i, year });
  });

  const btnMetric = (key, label) => (
    <button key={key} onClick={() => setChartMetric(key)}
      style={{ padding:"5px 14px", borderRadius:20, fontSize:12, fontWeight:600, border:"none", cursor:"pointer",
        background:chartMetric===key?"#4f46e5":"#f3f4f6", color:chartMetric===key?"#fff":"#6b7280" }}>
      {label}
    </button>
  );

  return (
    <div style={{ maxWidth:1200, margin:"0 auto", padding:"28px 24px" }}>

      {/* Contrôles */}
      <div style={{ display:"flex", alignItems:"flex-end", gap:12, marginBottom:28, flexWrap:"wrap" }}>
        <h2 style={{ fontSize:20, fontWeight:700, color:"#111827", flex:1, marginBottom:0 }}>
          {selected==="__all__" ? "Réseau complet" : selected}
        </h2>
        <div>
          <label style={S.label}>Du</label>
          <select value={pFrom} onChange={e=>setPeriodFrom(e.target.value)} style={{ ...S.input, width:"auto", minWidth:130 }}>
            {periods.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label style={S.label}>Au</label>
          <select value={pTo} onChange={e=>setPeriodTo(e.target.value)} style={{ ...S.input, width:"auto", minWidth:130 }}>
            {periods.slice().reverse().map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label style={S.label}>Magasin</label>
          <select value={selected} onChange={e=>setSelected(e.target.value)} style={{ ...S.input, width:"auto", minWidth:200 }}>
            <option value="__all__">— Réseau global —</option>
            {stores.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
          </select>
        </div>
      </div>

      {/* Bandeau période */}
      <div style={{ background:"#eef2ff", borderRadius:10, padding:"8px 16px", marginBottom:24, fontSize:13, color:"#4f46e5", fontWeight:600 }}>
        📅 {nbMonths} mois sélectionné{nbMonths>1?"s":""} · {pFrom} → {pTo}
        {nbMonths > 1 && <span style={{ fontWeight:400, color:"#6b7280", marginLeft:8 }}>comparé à la période précédente ({prevFrom} → {prevTo})</span>}
      </div>

      {/* KPI cards */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))", gap:16, marginBottom:32 }}>
        <KPICard label="Flux visiteurs"      value={fmt(sumFlux)}   sub={`moy. mensuelle : ${fmt(sumFlux/nbMonths)}`}   delta={delta(sumFlux,prevFlux)} color="#6366f1" />
        <KPICard label="Taux transformation" value={fmtPct(avgTT)}  sub={`période préc. : ${fmtPct(prevTT)}`}           delta={delta(avgTT,prevTT)}     color="#10b981" />
        <KPICard label="Panier moyen HT"     value={fmtEur(avgPM)}  sub={`période préc. : ${fmtEur(prevPM)}`}           delta={delta(avgPM,prevPM)}     color="#f59e0b" />
        <KPICard label="CA HT total"         value={fmtK(sumCA)}    sub={`moy. mensuelle : ${fmtEur(sumCA/nbMonths)}`}  delta={delta(sumCA,prevCA)}     color="#3b82f6" />
      </div>

      {/* Graphique évolution */}
      <div style={{ ...S.card, marginBottom:28 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16, flexWrap:"wrap", gap:8 }}>
          <span style={{ fontWeight:600, fontSize:14, color:"#374151" }}>Évolution {metricLabel}</span>
          <div style={{ display:"flex", gap:6 }}>
            {btnMetric("flux","Flux")}
            {btnMetric("ca","CA HT")}
            {btnMetric("tt","TT %")}
            {btnMetric("pm","PM HT")}
          </div>
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={combinedChart} margin={{ top:5, right:20, bottom:5, left:10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="period" tick={{ fontSize:11, fill:"#9ca3af" }} />
            <YAxis tick={{ fontSize:11, fill:"#9ca3af" }} tickFormatter={v => fmtK(v)} />
            <Tooltip
              formatter={(val, name) => {
                if (name==="Historique") return chartMetric==="ca"||chartMetric==="pm" ? fmtEur(val) : chartMetric==="tt" ? fmtPct(val) : fmt(val);
                if (name==="Prévision") return fmt(val);
                return val;
              }}
              contentStyle={{ borderRadius:8, fontSize:12, border:"1px solid #e5e7eb" }}
            />
            <Legend iconType="circle" wrapperStyle={{ fontSize:12 }} />
            {combinedChart.some(d => d.type==="hist") && (
              <Bar dataKey="valeur" name="Historique" fill="#6366f1" fillOpacity={0.85} radius={[4,4,0,0]} />
            )}
            {chartMetric==="flux" && combinedChart.some(d => d.type==="fc") && (
              <Line dataKey="prevision" name="Prévision" stroke="#f59e0b" strokeWidth={2.5} strokeDasharray="5 4" dot={{ r:4, fill:"#f59e0b" }} connectNulls />
            )}
            {combinedChart.some(d => d.type==="fc") && (
              <ReferenceLine x={lastPeriod} stroke="#e5e7eb" strokeDasharray="4 2" label={{ value:"aujourd'hui", fontSize:10, fill:"#9ca3af" }} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Historique */}
      <div style={{ ...S.card, padding:0, overflow:"hidden", marginBottom:28 }}>
        <div style={{ padding:"14px 20px", borderBottom:"1px solid #f3f4f6", fontWeight:600, fontSize:14, color:"#374151" }}>
          Historique mensuel complet
        </div>
        <div style={{ overflowX:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
            <thead>
              <tr style={{ background:"#f9fafb" }}>
                {["Période","Flux","TT %","PM HT €","CA HT €",""].map(h=><th key={h} style={S.th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {histRows.map((item) => {
                if (item.type === "year") {
                  const isOpen = !collapsed[item.year];
                  return (
                    <tr key={`year-${item.year}`} onClick={() => toggleYear(item.year)} style={{ cursor:"pointer", userSelect:"none" }}>
                      <td colSpan={6} style={{ padding:"8px 16px", fontSize:12, fontWeight:700, color:"#6b7280", textTransform:"uppercase", letterSpacing:".08em", background:"#f3f4f6", borderTop:"2px solid #e5e7eb" }}>
                        <span style={{ marginRight:8 }}>{isOpen ? "▾" : "▸"}</span>{item.year}
                      </td>
                    </tr>
                  );
                }
                if (collapsed[item.year]) return null;
                const { s } = item;
                const inRange = s.period >= pFrom && s.period <= pTo;
                return (
                  <tr key={s.period} style={{ borderTop:"1px solid #f3f4f6", background: inRange ? "#eef2ff" : "#fff" }}>
                    <td style={{ ...S.td, fontWeight:600, color: inRange ? "#4f46e5" : "#374151" }}>{s.period}</td>
                    <td style={{ ...S.td, textAlign:"right" }}>{fmt(s.flux)}</td>
                    <td style={{ ...S.td, textAlign:"right" }}>{fmtPct(s.tt)}</td>
                    <td style={{ ...S.td, textAlign:"right" }}>{fmtEur(s.pm)}</td>
                    <td style={{ ...S.td, textAlign:"right" }}>{fmtEur(s.ca)}</td>
                    <td style={{ ...S.td, textAlign:"center" }}>
                      <button onClick={() => handleDelete(s.period)}
                        style={{ background:"none", border:"1px solid #fca5a5", borderRadius:6, color:"#dc2626", fontSize:11, padding:"2px 8px", cursor:"pointer" }}>
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Prévisionnel flux */}
      <div style={{ ...S.card, padding:0, overflow:"hidden" }}>
        <div style={{ padding:"14px 20px", borderBottom:"1px solid #f3f4f6", display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:8 }}>
          <span style={{ fontWeight:600, fontSize:14, color:"#374151" }}>Prévisionnel flux</span>
          <div style={{ display:"flex", gap:6, alignItems:"center" }}>
            <span style={{ fontSize:12, color:"#9ca3af" }}>Horizon :</span>
            {[3,6,9,12,15,18].map(m => (
              <button key={m} onClick={() => setFcMonths(m)}
                style={{ padding:"4px 10px", borderRadius:20, fontSize:12, fontWeight:600, border:"none", cursor:"pointer",
                  background:fcMonths===m?"#f59e0b":"#f3f4f6", color:fcMonths===m?"#fff":"#6b7280" }}>
                {m}m
              </button>
            ))}
          </div>
        </div>

        {/* Mini graphique prévisionnel */}
        <div style={{ padding:"16px 20px 0" }}>
          <ResponsiveContainer width="100%" height={180}>
            <ComposedChart margin={{ top:5, right:20, bottom:5, left:10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="period" tick={{ fontSize:10, fill:"#9ca3af" }} />
              <YAxis tick={{ fontSize:10, fill:"#9ca3af" }} tickFormatter={v => fmtK(v)} />
              <Tooltip contentStyle={{ borderRadius:8, fontSize:12 }} formatter={(v) => fmt(v)} />
              <Legend iconType="circle" wrapperStyle={{ fontSize:11 }} />
              <Line
                data={last12.map(s=>({period:s.period, flux:s.flux}))}
                dataKey="flux" name="Réel" stroke="#6366f1" strokeWidth={2.5}
                dot={{ r:3, fill:"#6366f1" }}
              />
              <Line
                data={fcData}
                dataKey="prevFlux" name="Prévision" stroke="#f59e0b" strokeWidth={2.5}
                strokeDasharray="5 4" dot={{ r:3, fill:"#f59e0b" }}
              />
              <ReferenceLine x={lastPeriod} stroke="#e5e7eb" strokeDasharray="4 2" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div style={{ overflowX:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
            <thead>
              <tr style={{ background:"#fffbeb" }}>
                {["Période","Flux central","Bas −7%","Haut +7%","vs N−1"].map(h=><th key={h} style={S.th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {fcData.map((f,i)=>{
                const ref = fluxVals[fluxVals.length - fcMonths + i] || fluxVals[fluxVals.length-1];
                const evo = ref ? ((f.prevFlux-ref)/ref*100) : null;
                return (
                  <tr key={f.period} style={{ borderTop:"1px solid #f3f4f6", background:i%2?"#fffbeb":"#fff" }}>
                    <td style={{ ...S.td, fontWeight:600, color:"#d97706" }}>{f.period}</td>
                    <td style={{ ...S.td, textAlign:"right", fontWeight:700, color:"#d97706" }}>{fmt(f.prevFlux)}</td>
                    <td style={{ ...S.td, textAlign:"right", color:"#9ca3af" }}>{fmt(f.prevBas)}</td>
                    <td style={{ ...S.td, textAlign:"right", color:"#9ca3af" }}>{fmt(f.prevHaut)}</td>
                    <td style={{ ...S.td, textAlign:"right" }}>
                      {evo!=null && <span style={{ color:evo>=0?"#059669":"#dc2626", fontWeight:600 }}>{evo>0?"+":""}{evo.toFixed(2)}%</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── App Root ─────────────────────────────────────────────────────────────────
export default function App() {
  const [page, setPage] = useState("dashboard");
  const nav = (id, label) => (
    <button onClick={()=>setPage(id)} style={{ background:page===id?"#eef2ff":"transparent", border:"none", cursor:"pointer", padding:"8px 18px", fontSize:13, fontWeight:600, borderRadius:8, color:page===id?"#4f46e5":"#6b7280" }}>
      {label}
    </button>
  );
  return (
    <div style={{ minHeight:"100vh", background:"#f5f5f7", fontFamily:"system-ui,sans-serif" }}>
      <div style={{ background:"#fff", borderBottom:"1px solid #e5e7eb", padding:"0 24px", display:"flex", alignItems:"center", gap:8, height:52, position:"sticky", top:0, zIndex:10 }}>
        <span style={{ fontWeight:800, fontSize:15, color:"#111827", marginRight:16 }}>◈ Pilotage réseau</span>
        {nav("dashboard","Dashboard")}
        {nav("forecast","Forecast")}
        {nav("upload","Import CSV")}
      </div>
      {page==="dashboard" && <DashboardPage />}
      {page==="forecast"  && <ForecastPage />}
      {page==="upload"    && <UploadPage onDone={()=>setPage("dashboard")} />}
    </div>
  );
}
