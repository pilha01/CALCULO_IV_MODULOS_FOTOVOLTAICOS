/* @jsx React.createElement */
/* @jsxFrag React.Fragment */
const { useMemo, useState, useEffect } = React;

// ===== Recharts (UMD global) =====
const RechartsGlobal = window.Recharts;
if (!RechartsGlobal) console.error("Recharts não carregou. Verifique a ordem dos <script> no index.html.");
const Recharts = RechartsGlobal || {};
const {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Legend, CartesianGrid, ReferenceLine, ReferenceDot
} = Recharts;

// ===== Constantes físicas =====
const q = 1.602176634e-19;
const k = 1.380649e-23;

// ===== Utils =====
const colorAt = (idx, total) => `hsl(${Math.round((idx / total) * 360)},70%,45%)`;
const Section = ({ title, children }) => (
  <div className="bg-white/70 backdrop-blur border border-emerald-100 rounded-2xl p-4 shadow-sm">
    <h2 className="text-emerald-700 font-semibold mb-3">{title}</h2>
    {children}
  </div>
);
const Label = ({ children }) => <label className="text-sm text-slate-600">{children}</label>;
const NumberInput = ({ value, onChange, min, max, step = 0.01, suffix, className = "" }) => (
  <div className={`flex items-center gap-2 ${className}`}>
    <input
      type="number"
      value={Number.isFinite(value) ? value : 0}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      min={min} max={max} step={step}
      className="w-full px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-300"
    />
    {suffix && <span className="text-slate-500 text-sm w-10">{suffix}</span>}
  </div>
);

// ===== App =====
function IVCalculator() {
  // STC / módulo
  const [vocRef, setVocRef] = useState(52.0);
  const [iscRef, setIscRef] = useState(14.31);
  const [vmppRef, setVmppRef] = useState(43.55);
  const [imppRef, setImppRef] = useState(13.55);
  const [area, setArea]   = useState(2.648);

  // Condições base
  const [irr, setIrr]     = useState(1000);
  const [tempC, setTempC] = useState(25);

  // Modelo
  const [n, setN]     = useState(1.3);
  const [rs, setRs]   = useState(0.2);
  const [rsh, setRsh] = useState(1000);
  const [cellsSeries, setCellsSeries] = useState(144);

  // Coefs e resolução
  const [alphaIscPct] = useState(0.046);
  const [betaVocPct]  = useState(-0.26);
  const [points, setPoints] = useState(140);

  const Gref = 1000, Tref = 25;
  const alphaIsc = alphaIscPct / 100;
  const betaVoc  = betaVocPct  / 100;

  // Ajustes Isc/Voc
  const adjIsc = (G, Tc) => iscRef * (G / Gref) * (1 + alphaIsc * (Tc - Tref));
  const adjVoc = (G, Tc) => {
    const dT = Tc - Tref;
    const thermal = vocRef * (1 + betaVoc * dT);
    const nvt = n * ((k * (Tc + 273.15)) / q) * Math.max(cellsSeries, 1);
    const logTerm = nvt * Math.log(Math.max(G, 1) / Gref);
    return Math.max(thermal + logTerm, 0.1);
  };

  // Curva I–V
  function computeCurve(G, Tc) {
    const Tkelvin = Tc + 273.15;
    const VtC = (k * Tkelvin) / q;
    const nvt = n * VtC * Math.max(cellsSeries, 1);
    const IL  = adjIsc(G, Tc);
    const VocG = adjVoc(G, Tc);

    const Io = (() => {
      const denom = Math.exp(Math.max(VocG, 0) / Math.max(nvt, 1e-9)) - 1;
      const numer = IL - VocG / Math.max(rsh, 1e-6);
      return Math.max(denom > 0 ? numer / denom : 0, 1e-12);
    })();

    function solveI(V, Istart) {
      let I = Math.min(Math.max(Istart, 0), Math.max(IL, 0));
      for (let iter = 0; iter < 80; iter++) {
        const arg = (V + I * rs) / Math.max(nvt, 1e-9);
        const expArg = Math.exp(Math.min(Math.max(arg, -50), 50));
        const F  = I - IL + Io * (expArg - 1) + (V + I * rs) / Math.max(rsh, 1e-9);
        const dF = 1 + Io * expArg * (rs / Math.max(nvt, 1e-9)) + rs / Math.max(rsh, 1e-9);
        const step = F / Math.max(dF, 1e-12);
        I -= step;
        if (!Number.isFinite(I)) { I = 0; break; }
        if (Math.abs(step) < 1e-8) break;
        if (I < -0.1) I = 0;
        if (I > IL * 1.2) I = IL * 1.2;
      }
      return Math.max(I, 0);
    }

    const Vmax = Math.max(VocG, vocRef) * 1.02;
    const dV   = Vmax / Math.max(points, 10);
    const pts  = [];
    let Iprev = IL;
    for (let i = 0; i <= points; i++) {
      const V = i * dV;
      const I = solveI(V, Iprev);
      pts.push({ V, I, P: V * I });
      Iprev = I;
    }
    return { pts, IL, VocG, Vmax };
  }

  // Curva base
  const baseCurve = useMemo(
    () => computeCurve(irr, tempC),
    [irr, tempC, rs, rsh, n, cellsSeries, points, iscRef, vocRef, alphaIsc, betaVoc]
  );
  const dataIV = baseCurve.pts;
  const mpp = useMemo(
    () => dataIV.reduce((b, p) => (p.P > b.P ? p : b), { V: 0, I: 0, P: 0 }), [dataIV]
  );
  const iscAdj = useMemo(() => adjIsc(irr, tempC), [irr, tempC]);
  const vocAdj = useMemo(() => adjVoc(irr, tempC), [irr, tempC]);
  const ff = useMemo(() => mpp.P / Math.max(vocAdj * iscAdj, 1e-9), [mpp, vocAdj, iscAdj]);
  const effNow = useMemo(() => (irr * area > 0 ? mpp.P / (irr * area) : 0), [irr, area, mpp]);

  // ========= Base de X para os gráficos comparativos (resolve o erro 'scale') =========
  function buildXBase(vmax, npts = 120) {
    const arr = [];
    const d = vmax / npts;
    for (let i = 0; i <= npts; i++) arr.push({ V: i * d });
    return arr;
  }

  // Séries por irradiância (25°C) e base X
  const irrOrder  = [1000, 800, 600, 400, 200];
  const irrSeries = useMemo(() => irrOrder.map(g => ({ g, curve: computeCurve(g, 25) })), [rs, rsh, n, cellsSeries, points, iscRef, vocRef]);
  const vmaxIrr   = useMemo(() => Math.max(...irrSeries.map(s => s.curve.Vmax)), [irrSeries]);
  const xBaseIrr  = useMemo(() => buildXBase(vmaxIrr), [vmaxIrr]);

  // Séries por temperatura (G=1000) e base X
  const tempOrder  = [75, 65, 55, 45, 35, 25];
  const tempSeries = useMemo(() => tempOrder.map(t => ({ t, curve: computeCurve(1000, t) })), [rs, rsh, n, cellsSeries, points, iscRef, vocRef]);
  const vmaxTemp   = useMemo(() => Math.max(...tempSeries.map(s => s.curve.Vmax)), [tempSeries]);
  const xBaseTemp  = useMemo(() => buildXBase(vmaxTemp), [vmaxTemp]);

  return (
    <div className="min-h-screen w-full bg-gradient-to-b from-emerald-50 via-teal-50 to-white text-slate-800">
      <header className="px-6 md:px-10 py-6">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-emerald-700">
          Simulador Curva I–V • ELGIN ELG590-M72HEP
        </h1>
        <p className="mt-1 text-sm text-slate-600">Ajuste os parâmetros e veja as curvas ao vivo.</p>
      </header>

      <main className="px-6 md:px-10 pb-16 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Painel */}
        <div className="lg:col-span-1 space-y-4">
          <Section title="Condições de operação">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Irradiância</Label><NumberInput value={irr} onChange={setIrr} min={1} max={1200} step={1} suffix="W/m²" /></div>
              <div><Label>Temperatura módulo</Label><NumberInput value={tempC} onChange={setTempC} min={-20} max={85} step={0.1} suffix="°C" /></div>
            </div>
          </Section>

          <Section title="Parâmetros do módulo (STC)">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Voc_ref</Label><NumberInput value={vocRef} onChange={setVocRef} min={0} max={100} step={0.01} suffix="V" /></div>
              <div><Label>Isc_ref</Label><NumberInput value={iscRef} onChange={setIscRef} min={0} max={30} step={0.001} suffix="A" /></div>
              <div><Label>Vmpp_ref</Label><NumberInput value={vmppRef} onChange={setVmppRef} min={0} max={100} step={0.01} suffix="V" /></div>
              <div><Label>Impp_ref</Label><NumberInput value={imppRef} onChange={setImppRef} min={0} max={30} step={0.001} suffix="A" /></div>
              <div className="col-span-2"><Label>Área</Label><NumberInput value={area} onChange={setArea} min={0.1} max={4} step={0.001} suffix="m²" /></div>
            </div>
          </Section>

          <Section title="Modelo elétrico (1 diodo)">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>n</Label><NumberInput value={n} onChange={setN} min={1} max={2} step={0.01} /></div>
              <div><Label>Rs</Label><NumberInput value={rs} onChange={setRs} min={0} max={1} step={0.001} suffix="Ω" /></div>
              <div><Label>Rsh</Label><NumberInput value={rsh} onChange={setRsh} min={1} max={50000} step={1} suffix="Ω" /></div>
              <div><Label>Ns</Label><NumberInput value={cellsSeries} onChange={setCellsSeries} min={36} max={200} step={1} /></div>
              <div><Label>Pontos</Label><NumberInput value={points} onChange={setPoints} min={50} max={400} step={1} /></div>
            </div>
          </Section>
        </div>

        {/* Gráficos */}
        <div className="lg:col-span-2 space-y-4">
          <Section title="Curva base: I–V e P–V (tempo real)">
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={dataIV} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="V" label={{ value: "Tensão (V)", position: "insideBottom", offset: -5 }} />
                    <YAxis yAxisId="left" label={{ value: "Corrente (A)", angle: -90, position: "insideLeft" }} />
                    <Tooltip />
                    <Line yAxisId="left" type="monotone" dataKey="I" stroke="#059669" dot={false} />
                    <ReferenceLine x={vocAdj} stroke="#0ea5e9" strokeDasharray="4 4" />
                    <ReferenceLine y={iscAdj} yAxisId="left" stroke="#10b981" strokeDasharray="4 4" />
                    <ReferenceDot x={mpp.V} y={mpp.I} yAxisId="left" r={5} fill="#111827" stroke="#fff" label="MPP" />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={dataIV} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="V" label={{ value: "Tensão (V)", position: "insideBottom", offset: -5 }} />
                    <YAxis label={{ value: "Potência (W)", angle: -90, position: "insideLeft" }} />
                    <Tooltip />
                    <Line type="monotone" dataKey="P" stroke="#0ea5e9" dot={false} />
                    <ReferenceDot x={mpp.V} y={mpp.P} r={5} fill="#111827" stroke="#fff" label="Pmax" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </Section>

          <Section title="I–V em diferentes irradiâncias (T=25°C)">
            <ResponsiveContainer width="100%" height={380}>
              {/* data=xBaseIrr garante a escala X estável */}
              <LineChart data={xBaseIrr} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="V" type="number" domain={[0, vmaxIrr]} label={{ value: "Tensão (V)", position: "insideBottom", offset: -5 }} />
                <YAxis label={{ value: "Corrente (A)", angle: -90, position: "insideLeft" }} />
                <Tooltip />
                {irrSeries.map((s, idx, arr) => (
                  <Line
                    key={s.g}
                    type="monotone"
                    dataKey="I"
                    data={s.curve.pts}
                    name={`${s.g} W/m²`}
                    stroke={colorAt(idx, arr.length)}
                    dot={false}
                    isAnimationActive={false}
                  />
                ))}
                <Legend />
              </LineChart>
            </ResponsiveContainer>
          </Section>

          <Section title="I–V em diferentes temperaturas (G=1000 W/m²)">
            <ResponsiveContainer width="100%" height={380}>
              {/* data=xBaseTemp garante a escala X estável */}
              <LineChart data={xBaseTemp} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="V" type="number" domain={[0, vmaxTemp]} label={{ value: "Tensão (V)", position: "insideBottom", offset: -5 }} />
                <YAxis label={{ value: "Corrente (A)", angle: -90, position: "insideLeft" }} />
                <Tooltip />
                {tempSeries.map((s, idx, arr) => (
                  <Line
                    key={s.t}
                    type="monotone"
                    dataKey="I"
                    data={s.curve.pts}
                    name={`Temp=${s.t}°C`}
                    stroke={colorAt(idx, arr.length)}
                    dot={false}
                    isAnimationActive={false}
                  />
                ))}
                <Legend />
              </LineChart>
            </ResponsiveContainer>
          </Section>

          <Section title="Indicadores (curva base)">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div className="bg-gradient-to-br from-emerald-50 to-white border border-emerald-100 rounded-2xl p-4">
                <div className="text-xs uppercase text-emerald-600">Ponto MPP</div>
                <div className="text-sm text-slate-600">Vmpp ≈ <span className="font-semibold text-slate-800">{mpp.V.toFixed(2)} V</span></div>
                <div className="text-sm text-slate-600">Impp ≈ <span className="font-semibold text-slate-800">{mpp.I.toFixed(2)} A</span></div>
                <div className="text-lg font-bold text-emerald-700">Pmax ≈ {mpp.P.toFixed(1)} W</div>
              </div>
              <div className="bg-gradient-to-br from-teal-50 to-white border border-teal-100 rounded-2xl p-4">
                <div className="text-xs uppercase text-teal-600">Limites</div>
                <div className="text-sm text-slate-600">Voc ≈ <span className="font-semibold text-slate-800">{vocAdj.toFixed(2)} V</span></div>
                <div className="text-sm text-slate-600">Isc ≈ <span className="font-semibold text-slate-800">{iscAdj.toFixed(2)} A</span></div>
                <div className="text-sm text-slate-600">FF ≈ <span className="font-semibold text-slate-800">{(ff * 100).toFixed(1)}%</span></div>
              </div>
              <div className="bg-gradient-to-br from-cyan-50 to-white border border-cyan-100 rounded-2xl p-4">
                <div className="text-xs uppercase text-cyan-600">Eficiência instantânea</div>
                <div className="text-2xl font-bold text-cyan-700">{(effNow * 100).toFixed(2)}%</div>
                <div className="text-xs text-slate-500">Base: Pin = {Math.round(irr * area)} W</div>
              </div>
            </div>
          </Section>
        </div>
      </main>

      <footer className="px-6 md:px-10 py-6 text-xs text-slate-500 text-center">
        React + Recharts • Tailwind • Projeto educacional — Gustavo Santos Silva (2025)
      </footer>
    </div>
  );
}

// Monta o app
const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<IVCalculator />);
