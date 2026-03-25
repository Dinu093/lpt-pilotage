import { useState, useEffect } from "react";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine, ScatterChart, Scatter } from "recharts";

const SUPABASE_URL = "https://svrmgurokzxlaxditxpg.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN2cm1ndXJva3p4bGF4ZGl0eHBnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0MzUzMTMsImV4cCI6MjA5MDAxMTMxM30.s4HcUeau23rHV_zrhslTOdKN6jfLrRfHrnRZ9kokHJI";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const fmt    = (n, d = 0) => n == null ? "–" : Number(n).toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtPct = (n) => n == null ? "–" : `${Number(n).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`;
const fmtEur = (n) => n == null ? "–" : `${fmt(n, 2)} €`;

// ─── Modèles statistiques ────────────────────────────────────────────────────

function forecastSARIMA(values, months) {
  const n = values.length;
  if (n < 3) return [];
  let sx=0, sy=0, sxy=0, sx2=0;
  for (let i=0; i<n; i++) { sx+=i; sy+=values[i]; sxy+=i*values[i]; sx2+=i*i; }
  const slope = (n*sxy-sx*sy)/(n*sx2-sx*sx);
  const intercept = (sy-slope*sx)/n;
  const s = Math.min(12,n);
  const seas = new Array(s).fill(0), cnt = new Array(s).fill(0);
  for (let i=0; i<n; i++) { seas[i%s]+=values[i]-(intercept+slope*i); cnt[i%s]++; }
  for (let i=0; i<s; i++) seas[i]=cnt[i]?seas[i]/cnt[i]:0;
  const last = values.slice(-Math.min(12,n));
  return Array.from({length:months},(_,i)=>{
    const fi=n+i;
    const ar=last[i%last.length]!=null?(last[i%last.length]-(intercept+slope*(n-last.length+i%last.length)))*0.45:0;
    return Math.max(0, Math.round(intercept+slope*fi+seas[i%s]+ar));
  });
}

// Régression log-linéaire TT = a*ln(flux) + b + saisonnalité[mois]
function fitTTModel(series) {
  const valid = series.filter(s => s.flux > 0 && s.tt != null && s.tt > 0);
  if (valid.length < 6) return null;
  const n = valid.length;
  const x = valid.map(s => Math.log(s.flux));
  const y = valid.map(s => s.tt);
  let sx=0, sy=0, sxy=0, sx2=0;
  for (let i=0; i<n; i++) { sx+=x[i]; sy+=y[i]; sxy+=x[i]*y[i]; sx2+=x[i]*x[i]; }
  const slope = (n*sxy-sx*sy)/(n*sx2-sx*sx);
  const intercept = (sy-slope*sx)/n;
  // Résidus par mois → saisonnalité
  const seasSum = {}, seasCnt = {};
  valid.forEach((s,i) => {
    const m = parseInt(s.period.split("-")[1]);
    const res = s.tt - (slope*x[i]+intercept);
    seasSum[m] = (seasSum[m]||0) + res;
    seasCnt[m] = (seasCnt[m]||0) + 1;
  });
  const seasonal = {};
  for (let m=1; m<=12; m++) seasonal[m] = seasCnt[m] ? seasSum[m]/seasCnt[m] : 0;
  // R²
  const yMean = sy/n;
  const ssTot = y.reduce((s,v)=>s+(v-yMean)**2, 0);
  const ssRes = valid.reduce((s,v,i)=>s+(v.tt-(slope*x[i]+intercept))**2, 0);
  const r2 = 1 - ssRes/ssTot;
  return { slope, intercept, seasonal, r2, n };
}

function predictTT(model, flux, month) {
  if (!model || flux <= 0) return null;
  const raw = model.slope * Math.log(flux) + model.intercept + (model.seasonal[month]||0);
  return Math.max(0, Math.min(100, raw));
}

// Régression PM = tendance linéaire + saisonnalité
function fitPMModel(series) {
  const valid = series.filter(s => s.pm != null && s.pm > 0);
  if (valid.length < 3) return null;
  // Baseline = moyenne des 3 derniers mois
  const recent = valid.slice(-3);
  const baseline = recent.reduce((s,r) => s+r.pm, 0) / recent.length;
  // Indice saisonnier = écart % de chaque mois par rapport à la moyenne annuelle
  const globalAvg = valid.reduce((s,r) => s+r.pm, 0) / valid.length;
  const seasSum = {}, seasCnt = {};
  valid.forEach(s => {
    const m = parseInt(s.period.split("-")[1]);
    seasSum[m] = (seasSum[m]||0) + (s.pm / globalAvg);
    seasCnt[m] = (seasCnt[m]||0) + 1;
  });
  const seasonal = {};
  for (let m=1; m<=12; m++) seasonal[m] = seasCnt[m] ? seasSum[m]/seasCnt[m] : 1.0;
  return { baseline, seasonal, globalAvg, n: valid.length };
}

function predictPM(model, futureIndex, month) {
  if (!model) return null;
  return model.baseline * (model.seasonal[month] || 1.0);
}

function addMonths(ym, n) {
  let [y,m] = ym.split("-").map(Number);
  m+=n; while(m>12){m-=12;y++;} while(m<1){m+=12;y--;}
  return `${y}-${String(m).padStart(2,"0")}`;
}

const S = {
  input: { display:"block", width:"100%", padding:"8px 12px", borderRadius:8, border:"1px solid #d1d5db", fontSize:13, background:"#fff", color:"#111827", boxSizing:"border-box" },
  label: { display:"block", fontSize:11, fontWeight:600, color:"#6b7280", marginBottom:6, textTransform:"uppercase", letterSpacing:".05em" },
  th: { padding:"10px 16px", textAlign:"left", fontSize:11, fontWeight:700, color:"#6b7280", textTransform:"uppercase", letterSpacing:".05em", whiteSpace:"nowrap" },
  td: { padding:"10px 16px", color:"#374151", whiteSpace:"nowrap" },
  card: { background:"#fff", borderRadius:14, padding:"16px 20px", border:"1px solid #e5e7eb", boxShadow:"0 1px 4px rgba(0,0,0,.05)" },
};

const MONTH_NAMES = ["","Jan","Fév","Mar","Avr","Mai","Jun","Jul","Août","Sep","Oct","Nov","Déc"];

export default function ForecastPage() {
  const [allData, setAllData]       = useState([]);
  const [stores, setStores]         = useState([]);
  const [periods, setPeriods]       = useState([]);
  const [selected, setSelected]     = useState("__all__");
  const [fcMonths, setFcMonths]     = useState(6);
  const [manualFlux, setManualFlux] = useState("");
  const [manualMonth, setManualMonth] = useState(new Date().getMonth()+1);
  const [loading, setLoading]       = useState(true);

  useEffect(() => {
    (async () => {
      const { data: s } = await supabase.from("retail_stores").select("*").order("name");
      let all=[], from=0;
      while(true){
        const { data:m } = await supabase.from("retail_monthly_data")
          .select("store_id, period, flux, conversion, avg_price_ht, retail_stores(name)")
          .order("period").range(from, from+499);
        if(!m||!m.length) break;
        all=[...all,...m];
        if(m.length<500) break;
        from+=500;
      }
      setStores(s||[]);
      setAllData(all);
      setPeriods([...new Set(all.map(r=>r.period.substring(0,7)))].sort());
      setLoading(false);
    })();
  }, []);

  if (loading) return <div style={{padding:40,textAlign:"center",color:"#9ca3af"}}>Chargement…</div>;
  if (!allData.length) return <div style={{padding:40,textAlign:"center",color:"#6b7280"}}>Aucune donnée.</div>;

  // Série agrégée par période pour le magasin/réseau sélectionné
  const rows = selected==="__all__" ? allData : allData.filter(r=>r.retail_stores?.name===selected);
  const agg = (p) => {
    const r = rows.filter(x=>x.period.startsWith(p));
    const ttR=r.filter(x=>x.conversion), pmR=r.filter(x=>x.avg_price_ht);
    return {
      period: p,
      flux: r.reduce((s,x)=>s+(x.flux||0),0),
      tt:   ttR.length ? ttR.reduce((s,x)=>s+x.conversion,0)/ttR.length : null,
      pm:   pmR.length ? pmR.reduce((s,x)=>s+x.avg_price_ht,0)/pmR.length : null,
    };
  };
  const series = periods.map(agg);

  // Modèles
  const ttModel = fitTTModel(series);
  const pmModel = fitPMModel(series.filter(s => s.period >= "2023-08"));

  // Prévision flux SARIMA
  const fluxVals = series.map(s=>s.flux).filter(Boolean);
  const fcFlux = forecastSARIMA(fluxVals, fcMonths);
  const lastPeriod = periods[periods.length-1];

  // Table forecast combinée
  const forecastRows = fcFlux.map((flux,i) => {
    const period = addMonths(lastPeriod, i+1);
    const month = parseInt(period.split("-")[1]);
    const tt = predictTT(ttModel, flux, month);
    const pm = predictPM(pmModel, series.length+i, month);
    const ca = (flux && tt && pm) ? flux * (tt/100) * pm : null;
    return { period, flux, fluxBas:Math.round(flux*.93), fluxHaut:Math.round(flux*1.07), tt, pm, ca };
  });

  // Scatter plot flux vs TT (pour visualiser la corrélation)
  const scatterData = series.filter(s=>s.flux>0&&s.tt!=null).map(s=>({ flux:s.flux, tt:parseFloat(s.tt.toFixed(2)), period:s.period }));

  // Courbe de régression pour le scatter
  if (scatterData.length > 0) {
    const minF = Math.min(...scatterData.map(d=>d.flux));
    const maxF = Math.max(...scatterData.map(d=>d.flux));
  }

  // Prédiction manuelle
  const manualFluxNum = parseFloat(manualFlux);
  const manualTT = (!isNaN(manualFluxNum) && manualFluxNum>0) ? predictTT(ttModel, manualFluxNum, manualMonth) : null;
  const manualPM = pmModel ? predictPM(pmModel, series.length, manualMonth) : null;
  const manualCA = (manualTT && manualPM && manualFluxNum) ? manualFluxNum*(manualTT/100)*manualPM : null;

  // Données graphique flux + prévision
  const chartData = [
    ...series.slice(-12).map(s=>({ period:s.period, flux:s.flux, type:"hist" })),
    ...forecastRows.map(r=>({ period:r.period, prevFlux:r.flux, type:"fc" }))
  ];

  // Données PM historique + prévision
  const pmChartData = [
    ...series.slice(-12).map(s=>({ period:s.period, pm:s.pm ? parseFloat(s.pm.toFixed(2)) : null })),
    ...forecastRows.map(r=>({ period:r.period, pmPrev: r.pm ? parseFloat(r.pm.toFixed(2)) : null }))
  ];

  return (
    <div style={{maxWidth:1200,margin:"0 auto",padding:"28px 24px"}}>

      {/* Header */}
      <div style={{display:"flex",alignItems:"flex-end",gap:12,marginBottom:28,flexWrap:"wrap"}}>
        <div style={{flex:1}}>
          <h2 style={{fontSize:20,fontWeight:700,color:"#111827",marginBottom:4}}>Forecast</h2>
          <p style={{fontSize:13,color:"#6b7280",margin:0}}>Prévisionnel flux · TT · PM · CA par magasin</p>
        </div>
        <div>
          <label style={S.label}>Magasin</label>
          <select value={selected} onChange={e=>setSelected(e.target.value)} style={{...S.input,width:"auto",minWidth:220}}>
            <option value="__all__">— Réseau global —</option>
            {stores.map(s=><option key={s.id} value={s.name}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label style={S.label}>Horizon</label>
          <div style={{display:"flex",gap:4}}>
            {[3,6,9,12,15,18].map(m=>(
              <button key={m} onClick={()=>setFcMonths(m)}
                style={{padding:"8px 12px",borderRadius:8,fontSize:13,fontWeight:600,border:"none",cursor:"pointer",
                  background:fcMonths===m?"#4f46e5":"#f3f4f6",color:fcMonths===m?"#fff":"#6b7280"}}>
                {m}m
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Qualité des modèles */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))",gap:12,marginBottom:28}}>
        <div style={{...S.card,borderLeft:"3px solid #6366f1"}}>
          <div style={{fontSize:11,color:"#9ca3af",fontWeight:600,textTransform:"uppercase",letterSpacing:".05em",marginBottom:4}}>Modèle TT</div>
          <div style={{fontSize:14,fontWeight:700,color:"#111827",marginBottom:4}}>Régression log-linéaire + saisonnalité</div>
          {ttModel ? (
            <div style={{fontSize:12,color:"#6b7280"}}>
              R² = <strong style={{color:ttModel.r2>.7?"#059669":ttModel.r2>.4?"#d97706":"#dc2626"}}>{(ttModel.r2*100).toFixed(1)}%</strong>
              <span style={{marginLeft:8}}>{ttModel.n} obs. · coeff. dilution : {ttModel.slope.toFixed(4)}</span>
            </div>
          ) : <div style={{fontSize:12,color:"#9ca3af"}}>Données insuffisantes</div>}
        </div>
        <div style={{...S.card,borderLeft:"3px solid #f59e0b"}}>
          <div style={{fontSize:11,color:"#9ca3af",fontWeight:600,textTransform:"uppercase",letterSpacing:".05em",marginBottom:4}}>Modèle PM</div>
          <div style={{fontSize:14,fontWeight:700,color:"#111827",marginBottom:4}}>Tendance linéaire + saisonnalité</div>
          {pmModel ? (
            <div style={{fontSize:12,color:"#6b7280"}}>
              Tendance : <strong>{pmModel.slope>0?"▲":"▼"} {Math.abs(pmModel.slope).toFixed(3)} €/mois</strong>
              <span style={{marginLeft:8}}>{pmModel.n} obs.</span>
            </div>
          ) : <div style={{fontSize:12,color:"#9ca3af"}}>Données insuffisantes</div>}
        </div>
        <div style={{...S.card,borderLeft:"3px solid #10b981"}}>
          <div style={{fontSize:11,color:"#9ca3af",fontWeight:600,textTransform:"uppercase",letterSpacing:".05em",marginBottom:4}}>Modèle Flux</div>
          <div style={{fontSize:14,fontWeight:700,color:"#111827",marginBottom:4}}>SARIMA (trend + saisonnalité + AR)</div>
          <div style={{fontSize:12,color:"#6b7280"}}>{fluxVals.length} mois d'historique · fourchette ±7%</div>
        </div>
      </div>

      {/* Simulateur manuel */}
      <div style={{...S.card,marginBottom:28,borderTop:"3px solid #8b5cf6"}}>
        <div style={{fontWeight:600,fontSize:14,color:"#374151",marginBottom:16}}>🔮 Simulateur — flux → TT · PM · CA</div>
        <div style={{display:"flex",gap:16,alignItems:"flex-end",flexWrap:"wrap",marginBottom:16}}>
          <div>
            <label style={S.label}>Flux prévu</label>
            <input type="number" value={manualFlux} onChange={e=>setManualFlux(e.target.value)}
              placeholder="ex: 15 000" style={{...S.input,width:160}} />
          </div>
          <div>
            <label style={S.label}>Mois cible</label>
            <select value={manualMonth} onChange={e=>setManualMonth(parseInt(e.target.value))} style={{...S.input,width:"auto"}}>
              {Array.from({length:12},(_,i)=>i+1).map(m=><option key={m} value={m}>{MONTH_NAMES[m]}</option>)}
            </select>
          </div>
        </div>
        {manualTT != null && (
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:12}}>
            <div style={{background:"#f0fdf4",borderRadius:10,padding:"12px 16px"}}>
              <div style={{fontSize:11,color:"#6b7280",fontWeight:600,textTransform:"uppercase",marginBottom:4}}>TT attendu</div>
              <div style={{fontSize:24,fontWeight:800,color:"#059669"}}>{fmtPct(manualTT)}</div>
            </div>
            <div style={{background:"#fffbeb",borderRadius:10,padding:"12px 16px"}}>
              <div style={{fontSize:11,color:"#6b7280",fontWeight:600,textTransform:"uppercase",marginBottom:4}}>PM attendu HT</div>
              <div style={{fontSize:24,fontWeight:800,color:"#d97706"}}>{fmtEur(manualPM)}</div>
            </div>
            <div style={{background:"#eff6ff",borderRadius:10,padding:"12px 16px"}}>
              <div style={{fontSize:11,color:"#6b7280",fontWeight:600,textTransform:"uppercase",marginBottom:4}}>CA attendu HT</div>
              <div style={{fontSize:24,fontWeight:800,color:"#3b82f6"}}>{fmtEur(manualCA)}</div>
            </div>
            <div style={{background:"#f5f3ff",borderRadius:10,padding:"12px 16px"}}>
              <div style={{fontSize:11,color:"#6b7280",fontWeight:600,textTransform:"uppercase",marginBottom:4}}>Transactions</div>
              <div style={{fontSize:24,fontWeight:800,color:"#7c3aed"}}>{fmt(manualFluxNum*(manualTT/100))}</div>
            </div>
          </div>
        )}
        {manualFlux && isNaN(manualFluxNum) && (
          <div style={{fontSize:12,color:"#dc2626"}}>Entrez un nombre valide</div>
        )}
      </div>

      {/* Graphique flux réel + prévision */}
      <div style={{...S.card,marginBottom:28}}>
        <div style={{fontWeight:600,fontSize:14,color:"#374151",marginBottom:16}}>Évolution flux — historique & prévision</div>
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart data={chartData} margin={{top:5,right:20,bottom:5,left:10}}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="period" tick={{fontSize:11,fill:"#9ca3af"}} />
            <YAxis tick={{fontSize:11,fill:"#9ca3af"}} tickFormatter={v=>v>=1000?`${Math.round(v/1000)}k`:v} />
            <Tooltip contentStyle={{borderRadius:8,fontSize:12}} formatter={v=>fmt(v)} />
            <Legend iconType="circle" wrapperStyle={{fontSize:12}} />
            <Bar dataKey="flux" name="Flux réel" fill="#6366f1" fillOpacity={0.85} radius={[4,4,0,0]} />
            <Line dataKey="prevFlux" name="Prévision" stroke="#f59e0b" strokeWidth={2.5} strokeDasharray="5 4" dot={{r:4,fill:"#f59e0b"}} connectNulls />
            <ReferenceLine x={lastPeriod} stroke="#e5e7eb" strokeDasharray="4 2" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Graphique PM */}
      <div style={{...S.card,marginBottom:28}}>
        <div style={{fontWeight:600,fontSize:14,color:"#374151",marginBottom:16}}>Évolution panier moyen HT — historique & prévision</div>
        <ResponsiveContainer width="100%" height={200}>
          <ComposedChart data={pmChartData} margin={{top:5,right:20,bottom:5,left:10}}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="period" tick={{fontSize:11,fill:"#9ca3af"}} />
            <YAxis tick={{fontSize:11,fill:"#9ca3af"}} tickFormatter={v=>`${v}€`} domain={["auto","auto"]} />
            <Tooltip contentStyle={{borderRadius:8,fontSize:12}} formatter={v=>fmtEur(v)} />
            <Legend iconType="circle" wrapperStyle={{fontSize:12}} />
            <Line dataKey="pm" name="PM réel" stroke="#f59e0b" strokeWidth={2.5} dot={{r:3,fill:"#f59e0b"}} />
            <Line dataKey="pmPrev" name="PM prévision" stroke="#10b981" strokeWidth={2.5} strokeDasharray="5 4" dot={{r:3,fill:"#10b981"}} connectNulls />
            <ReferenceLine x={lastPeriod} stroke="#e5e7eb" strokeDasharray="4 2" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Scatter flux vs TT */}
      {scatterData.length > 3 && (
        <div style={{...S.card,marginBottom:28}}>
          <div style={{fontWeight:600,fontSize:14,color:"#374151",marginBottom:4}}>Corrélation flux / TT</div>
          <div style={{fontSize:12,color:"#6b7280",marginBottom:12}}>
            Chaque point = 1 mois. Plus le flux est élevé, plus le TT tend à baisser (effet dilution).
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <ScatterChart margin={{top:5,right:20,bottom:20,left:10}}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="flux" name="Flux" type="number" tick={{fontSize:11,fill:"#9ca3af"}} tickFormatter={v=>`${Math.round(v/1000)}k`} label={{value:"Flux",position:"insideBottom",offset:-10,fontSize:11,fill:"#9ca3af"}} />
              <YAxis dataKey="tt" name="TT" type="number" tick={{fontSize:11,fill:"#9ca3af"}} tickFormatter={v=>`${v}%`} label={{value:"TT %",angle:-90,position:"insideLeft",fontSize:11,fill:"#9ca3af"}} />
              <Tooltip cursor={{strokeDasharray:"3 3"}} contentStyle={{borderRadius:8,fontSize:12}}
                formatter={(v,n)=>n==="TT"?fmtPct(v):fmt(v)} />
              <Scatter name="Mois" data={scatterData} fill="#6366f1" fillOpacity={0.7} r={4} />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Tableau prévisionnel combiné */}
      <div style={{...S.card,padding:0,overflow:"hidden"}}>
        <div style={{padding:"14px 20px",borderBottom:"1px solid #f3f4f6",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span style={{fontWeight:600,fontSize:14,color:"#374151"}}>Prévisionnel détaillé — {fcMonths} mois</span>
          <span style={{fontSize:11,color:"#9ca3af"}}>Flux SARIMA · TT régression log · PM tendance</span>
        </div>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
            <thead>
              <tr style={{background:"#f9fafb"}}>
                {["Période","Flux central","Bas −7%","Haut +7%","TT prévu","PM prévu HT","CA prévu HT","Transactions"].map(h=>(
                  <th key={h} style={S.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {forecastRows.map((r,i)=>(
                <tr key={r.period} style={{borderTop:"1px solid #f3f4f6",background:i%2?"#f9fafb":"#fff"}}>
                  <td style={{...S.td,fontWeight:700,color:"#4f46e5"}}>{r.period}</td>
                  <td style={{...S.td,textAlign:"right",fontWeight:700,color:"#4f46e5"}}>{fmt(r.flux)}</td>
                  <td style={{...S.td,textAlign:"right",color:"#9ca3af"}}>{fmt(r.fluxBas)}</td>
                  <td style={{...S.td,textAlign:"right",color:"#9ca3af"}}>{fmt(r.fluxHaut)}</td>
                  <td style={{...S.td,textAlign:"right",color:"#059669",fontWeight:600}}>{fmtPct(r.tt)}</td>
                  <td style={{...S.td,textAlign:"right",color:"#d97706",fontWeight:600}}>{fmtEur(r.pm)}</td>
                  <td style={{...S.td,textAlign:"right",fontWeight:700,color:"#3b82f6"}}>{fmtEur(r.ca)}</td>
                  <td style={{...S.td,textAlign:"right",color:"#7c3aed"}}>{r.flux&&r.tt?fmt(Math.round(r.flux*(r.tt/100))):"–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
