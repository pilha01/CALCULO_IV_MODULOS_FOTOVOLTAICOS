/* @jsx React.createElement */
/* @jsxFrag React.Fragment */
const { useMemo, useState, useEffect } = React;

// <<< ADIÇÃO IMPORTANTÍSSIMA >>>
const RechartsGlobal = window.Recharts;          // pega do global
if (!RechartsGlobal) {
  console.error("Recharts não carregou. Confira a ordem dos <script> no index.html.");
}
const Recharts = RechartsGlobal || {};           // fallback para evitar quebra na primeira linha

const {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Legend, CartesianGrid, ReferenceLine, ReferenceDot,
} = Recharts;

/**
 * Simulador Interativo Curva I–V (1 diodo + Rs + Rsh) – ELGIN ELG590-M72HEP
 *
 * Correções desta versão:
 * - Corrige ReferenceError: `diagnostics` não definido (agora definido via useMemo).
 * - Mantém os dois gráficos comparativos (irradiância decrescente; temperatura decrescente) com cores distintas.
 * - Adiciona testes adicionais (STC) quando a condição atual está próxima de 1000 W/m² e 25 °C.
 */

// ===== Constantes físicas =====
const q = 1.602176634e-19; // C
const k = 1.380649e-23; // J/K

// ===== Utilitários visuais =====
const colorAt = (idx, total) => `hsl(${Math.round((idx / total) * 360)},70%,45%)`;

const Section = ({ title, children }) => (
  <div className="bg-white/70 backdrop-blur border border-emerald-100 rounded-2xl p-4 shadow-sm">
    <h2 className="text-emerald-700 font-semibold mb-3">{title}</h2>
    {children}
  </div>
);

const Label = ({ children }) => (
  <label className="text-sm text-slate-600">{children}</label>
);

const NumberInput = ({
  value, onChange, min, max, step = 0.01, suffix, className = ""
}) => (
  <div className={`flex items-center gap-2 ${className}`}>
    <input
      type="number"
      value={Number.isFinite(value) ? value : 0}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      min={min}
      max={max}
      step={step}
      className="w-full px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-300"
    />
    {suffix && <span className="text-slate-500 text-sm w-10">{suffix}</span>}
  </div>
);

// ===== Legendas personalizadas para manter ordem exata (sem reflow centralizado) =====
function CustomLegendOrder(props) {
  const { payload = [] } = props;
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-2 justify-start items-center mt-1">
      {payload.map((item) => (
        <div key={item.id} className="flex items-center gap-2">
          <span className="inline-block w-3 h-3 rounded-full" style={{ background: item.color }} />
          <span className="text-sm text-slate-700 whitespace-nowrap">{item.value}</span>
        </div>
      ))}
    </div>
  );
}

function IVCalculator() {
  // ===== Parâmetros de placa (STC) =====
  const [vocRef, setVocRef] = useState(52.0);
  const [iscRef, setIscRef] = useState(14.31);
  const [vmppRef, setVmppRef] = useState(43.55);
  const [imppRef, setImppRef] = useState(13.55);
  const [area, setArea] = useState(2.648);

  // ===== Condições de operação (curva base) =====
  const [irr, setIrr] = useState(1000); // W/m²
  const [tempC, setTempC] = useState(25); // °C

  // ===== Parâmetros do modelo =====
  const [n, setN] = useState(1.3);
  const [rs, setRs] = useState(0.2);
  const [rsh, setRsh] = useState(1000);
  const [cellsSeries, setCellsSeries] = useState(144);

  // ===== Coeficientes térmicos (%/°C) =====
  const [alphaIscPct, setAlphaIscPct] = useState(0.046);
  const [betaVocPct, setBetaVocPct] = useState(-0.26);
  const [gammaPmpPct, setGammaPmpPct] = useState(-0.30);

  // ===== Resolução =====
  const [points, setPoints] = useState(140);

  // ===== Auxiliares =====
  const Gref = 1000;
  const Tref = 25;
  const alphaIsc = alphaIscPct / 100;
  const betaVoc = betaVocPct / 100;
  const T = useMemo(() => tempC + 273.15, [tempC]);
  const VtCell = useMemo(() => (k * T) / q, [T]);
  const nVtMod = useMemo(() => n * VtCell * Math.max(cellsSeries, 1), [n, VtCell, cellsSeries]); // pode ser útil em extensões

  // ===== Ajustes Isc/Voc por (G,T) =====
  const adjIsc = (G, Tc) => {
    const dT = Tc - Tref;
    return iscRef * (G / Gref) * (1 + alphaIsc * dT);
  };

  const adjVoc = (G, Tc) => {
    const dT = Tc - Tref;
    const thermal = vocRef * (1 + betaVoc * dT);
    const nvt = n * ((k * (Tc + 273.15)) / q) * Math.max(cellsSeries, 1);
    const logTerm = nvt * Math.log(Math.max(G, 1) / Gref);
    return Math.max(thermal + logTerm, 0.1);
  };

  // ===== Curva I–V por (G,T) =====
  function computeCurve(G, Tc) {
    const Tkelvin = Tc + 273.15;
    const VtC = (k * Tkelvin) / q;
    const nvt = n * VtC * Math.max(cellsSeries, 1);
    const IL = adjIsc(G, Tc);
    const VocG = adjVoc(G, Tc);

    const Io = (() => {
      const denom = Math.exp(Math.max(VocG, 0) / Math.max(nvt, 1e-9)) - 1;
      const numer = IL - VocG / Math.max(rsh, 1e-6);
      const raw = denom > 0 ? numer / denom : 0;
      return Math.max(raw, 1e-12);
    })();

    function solveI(V, Istart) {
      let I = Math.min(Math.max(Istart, 0), Math.max(IL, 0));
      for (let iter = 0; iter < 80; iter++) {
        const arg = (V + I * rs) / Math.max(nvt, 1e-9);
        const expArg = Math.exp(Math.min(Math.max(arg, -50), 50));
        const F = I - IL + Io * (expArg - 1) + (V + I * rs) / Math.max(rsh, 1e-9);
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
    const dV = Vmax / Math.max(points, 10);
    const pts = [];
    let Iprev = IL;
    for (let i = 0; i <= points; i++) {
      const V = i * dV;
      const I = solveI(V, Iprev);
      const P = V * I;
      pts.push({ V, I, P });
      Iprev = I;
    }
    return { pts, IL, VocG };
  }

  // ===== Curva base (G,T) =====
  const baseCurve = useMemo(
    () => computeCurve(irr, tempC),
    [irr, tempC, rs, rsh, n, cellsSeries, points, iscRef, vocRef, alphaIsc, betaVoc]
  );
  const dataIV = baseCurve.pts;
  const mpp = useMemo(
    () => dataIV.reduce((best, p) => (p.P > best.P ? p : best), { V: 0, I: 0, P: 0 }),
    [dataIV]
  );
  const iscAdj = useMemo(() => adjIsc(irr, tempC), [irr, tempC]);
  const vocAdj = useMemo(() => adjVoc(irr, tempC), [irr, tempC]);
  const ff = useMemo(() => mpp.P / Math.max(vocAdj * iscAdj, 1e-9), [mpp, vocAdj, iscAdj]);
  const effNow = useMemo(() => {
    const Pin = irr * area;
    return Pin > 0 ? mpp.P / Pin : 0;
  }, [irr, area, mpp]);

  // ===== Testes automáticos (sanidade) – agora DEFINIDOS =====
  const diagnostics = useMemo(() => {
    const msgs = [];
    if (!dataIV || dataIV.length === 0) return msgs;

    // 1) I(0) ≈ Isc
    const iscApprox = dataIV[0]?.I ?? 0; // assumindo V≈0 no primeiro ponto
    const okIsc = Math.abs(iscApprox - iscAdj) <= Math.max(0.5, 0.05 * Math.max(iscAdj, 1));
    msgs.push({ ok: okIsc, msg: `I(0)≈Isc (${iscApprox.toFixed(2)}A vs ${iscAdj.toFixed(2)}A)` });

    // 2) I(Voc) ≈ 0
    const last = dataIV[dataIV.length - 1];
    const iAtVoc = last?.I ?? 0;
    const vocApprox = last?.V ?? 0;
    const okVocI0 = Math.abs(iAtVoc) <= Math.max(0.3, 0.03 * Math.max(iscAdj, 1));
    msgs.push({ ok: okVocI0, msg: `I(Voc)≈0 (${iAtVoc.toFixed(2)}A em Voc≈${vocApprox.toFixed(2)}V)` });

    // 3) Monotonicidade (I não deve aumentar com V)
    let mono = true;
    for (let i = 1; i < dataIV.length; i++) {
      if (dataIV[i].I - dataIV[i - 1].I > 1e-3) { mono = false; break; }
    }
    msgs.push({ ok: mono, msg: "I(V) não aumenta com V" });

    // 4) MPP dentro de faixa (0<V<Voc, 0<I<Isc)
    const okMpp = mpp.V > 0 && mpp.V < vocAdj && mpp.I > 0 && mpp.I < iscAdj;
    msgs.push({ ok: okMpp, msg: `MPP válido (Vmpp=${mpp.V.toFixed(2)}V, Impp=${mpp.I.toFixed(2)}A)` });

    // 5) Testes extras quando próximo a STC (±2% em G e ±1 °C)
    const nearSTC = Math.abs(irr - 1000) <= 20 && Math.abs(tempC - 25) <= 1;
    if (nearSTC) {
      const okVmpp = Math.abs(mpp.V - vmppRef) <= 0.05 * Math.max(vmppRef, 1);
      const okImpp = Math.abs(mpp.I - imppRef) <= 0.05 * Math.max(imppRef, 1);
      msgs.push({ ok: okVmpp, msg: `Vmpp≈Vmpp_ref (${mpp.V.toFixed(2)}V vs ${vmppRef.toFixed(2)}V)` });
      msgs.push({ ok: okImpp, msg: `Impp≈Impp_ref (${mpp.I.toFixed(2)}A vs ${imppRef.toFixed(2)}A)` });
    }

    return msgs;
  }, [dataIV, iscAdj, vocAdj, mpp, irr, tempC, vmppRef, imppRef]);

  // ===== Auto-calibração leve para STC =====
  useEffect(() => {
    const nearSTC = Math.abs(irr - 1000) <= 20 && Math.abs(tempC - 25) <= 1;
    if (!nearSTC) return;

    const currentErr = Math.hypot(mpp.V - vmppRef, mpp.I - imppRef);

    // Passo 1 (grosseiro)
    const gridN1 = [1.1, 1.2, 1.3, 1.4, 1.5, 1.6];
    const gridRs1 = [0.02, 0.06, 0.1, 0.16, 0.22, 0.3, 0.4];
    const gridRsh1 = [200, 500, 1000, 3000, 6000, 12000, 20000];

    let best = { n, rs, rsh, score: currentErr };

    const evalTriplet = (nTry, rsTry, rshTry) => {
      const Tkel = 25 + 273.15;
      const VtC = (k * Tkel) / q;
      const nvt = nTry * VtC * Math.max(cellsSeries, 1);
      const IL = adjIsc(1000, 25);
      const VocG = adjVoc(1000, 25);
      const denom = Math.exp(Math.max(VocG, 0) / Math.max(nvt, 1e-9)) - 1;
      const numer = IL - VocG / Math.max(rshTry, 1e-6);
      const Io = Math.max(denom > 0 ? numer / denom : 0, 1e-12);

      const Vmax = Math.max(VocG, vocRef) * 1.02;
      const steps = 140; const dV = Vmax / steps;
      let Iprev = IL, bestP = -1, Vm = 0, Im = 0;
      for (let i = 0; i <= steps; i++) {
        const V = i * dV; let I = Iprev;
        for (let it = 0; it < 3; it++) {
          const arg = (V + I * rsTry) / Math.max(nvt, 1e-9);
          const expArg = Math.exp(Math.min(Math.max(arg, -50), 50));
          const F = I - IL + Io * (expArg - 1) + (V + I * rsTry) / Math.max(rshTry, 1e-9);
          const dF = 1 + Io * expArg * (rsTry / Math.max(nvt, 1e-9)) + rsTry / Math.max(rshTry, 1e-9);
          I -= F / Math.max(dF, 1e-12);
          if (!Number.isFinite(I)) { I = 0; break; }
        }
        const P = V * I; if (P > bestP) { bestP = P; Vm = V; Im = I; } Iprev = I;
      }
      const score = Math.hypot(Vm - vmppRef, Im - imppRef);
      if (score + 1e-3 < best.score) best = { n: nTry, rs: rsTry, rsh: rshTry, score };
    };

    for (const nTry of gridN1) {
      for (const rsTry of gridRs1) {
        for (const rshTry of gridRsh1) {
          evalTriplet(nTry, rsTry, rshTry);
        }
      }
    }

    // Passo 2 (fino)
    const n2 = [best.n - 0.05, best.n - 0.02, best.n, best.n + 0.02, best.n + 0.05].filter(v => v > 1.0 && v < 2.0);
    const rs2 = [best.rs * 0.7, best.rs * 0.85, best.rs, best.rs * 1.15, best.rs * 1.3].map(v => Math.max(0.005, Math.min(v, 1)));
    const rsh2 = [best.rsh * 0.5, best.rsh * 0.8, best.rsh, best.rsh * 1.25, best.rsh * 1.6].map(v => Math.max(50, Math.min(v, 100000)));

    for (const nTry of n2) {
      for (const rsTry of rs2) {
        for (const rshTry of rsh2) {
          evalTriplet(nTry, rsTry, rshTry);
        }
      }
    }

    if (best.score + 1e-3 < currentErr) { setN(best.n); setRs(best.rs); setRsh(best.rsh); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [irr, tempC, vmppRef, imppRef]);

  return (
    <div className="min-h-screen w-full bg-gradient-to-b from-emerald-50 via-teal-50 to-white text-slate-800">
      <div className="w-full bg-white/80 border-b border-emerald-100">
        <div className="px-6 md:px-10 py-2 text-[11px] md:text-xs text-center tracking-wide text-emerald-900 font-semibold">
          UNIVERSIDADE FEDERAL DE ALAGOAS / PROGRAMA DE PÓS-GRADUAÇÃO EM ENERGIAS RENOVÁVEIS / DICIPLINA DE ENERGIA SOLAR FOTOVOLTAICA
        </div>
      </div>
      <header className="px-6 md:px-10 py-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-emerald-700">Simulador Curva I–V • ELGIN ELG590-M72HEP</h1>
          <div className="hidden md:flex items-center gap-2 text-sm text-slate-500">
            <span className="inline-block h-3 w-3 rounded-full bg-emerald-400 animate-pulse" /> cálculo em tempo real
          </div>
        </div>
        <p className="mt-1 text-sm text-slate-600">Ajuste os parâmetros à esquerda. O gráfico e os indicadores respondem instantaneamente.</p>
      </header>

      <main className="px-6 md:px-10 pb-16 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Painel lateral */}
        <div className="lg:col-span-1 space-y-4">
          <Section title="Condições de operação (curva base)">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Irradiância</Label>
                <NumberInput value={irr} onChange={setIrr} min={1} max={1200} step={1} suffix="W/m²" />
              </div>
              <div>
                <Label>Temperatura módulo</Label>
                <NumberInput value={tempC} onChange={setTempC} min={-20} max={85} step={0.1} suffix="°C" />
              </div>
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
            <p className="text-xs text-slate-500 mt-2">αIsc = +0,046 %/°C • βVoc = −0,26 %/°C • γPmp = −0,30 %/°C • Ns=144</p>
          </Section>

          <Section title="Modelo elétrico (1 diodo)">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Idealidade do diodo (n)</Label><NumberInput value={n} onChange={setN} min={1} max={2} step={0.01} /></div>
              <div><Label>Resistência série (Rs)</Label><NumberInput value={rs} onChange={setRs} min={0} max={1} step={0.001} suffix="Ω" /></div>
              <div><Label>Resistência shunt (Rsh)</Label><NumberInput value={rsh} onChange={setRsh} min={1} max={50000} step={1} suffix="Ω" /></div>
              <div><Label>Células em série</Label><NumberInput value={cellsSeries} onChange={setCellsSeries} min={36} max={200} step={1} /></div>
              <div><Label>Pontos da curva</Label><NumberInput value={points} onChange={setPoints} min={50} max={400} step={1} /></div>
            </div>
            <p className="text-xs text-slate-500 mt-2">Aderência fina depende de Rs, Rsh e n — ajuste conforme medição.</p>
          </Section>

          <Section title="Testes automáticos (sanidade – curva base)">
            <ul className="space-y-2">
              {diagnostics.map((d, i) => (
                <li key={i} className={`text-sm ${d.ok ? "text-emerald-700" : "text-rose-700"}`}>
                  <span className={`inline-block w-2 h-2 rounded-full mr-2 ${d.ok ? "bg-emerald-500" : "bg-rose-500"}`} />
                  {d.msg}
                </li>
              ))}
            </ul>
          </Section>
        </div>

        {/* Coluna de gráficos */}
        <div className="lg:col-span-2 space-y-4">
          <Section title="Curva base: I–V e P–V (tempo real)">
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={dataIV} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="V" tickFormatter={(v) => `${v.toFixed(1)}`} label={{ value: "Tensão (V)", position: "insideBottom", offset: -5 }} />
                    <YAxis yAxisId="left" tickFormatter={(v) => `${v.toFixed(1)}`} label={{ value: "Corrente (A)", angle: -90, position: "insideLeft" }} />
                    <Tooltip formatter={(val, name) => [val.toFixed(3), name]} />
                    <Legend />
                    <Line yAxisId="left" type="monotone" dataKey="I" stroke="#059669" dot={false} name="I (A)" strokeWidth={2} />
                    <ReferenceLine y={iscAdj} yAxisId="left" stroke="#10b981" strokeDasharray="4 4" label={{ value: "Isc", position: "insideTopLeft", fill: "#065f46" }} />
                    <ReferenceLine x={vocAdj} stroke="#0ea5e9" strokeDasharray="4 4" label={{ value: "Voc", position: "insideTopRight", fill: "#075985" }} />
                    <ReferenceDot x={mpp.V} y={mpp.I} yAxisId="left" r={5} fill="#111827" stroke="#ffffff" label={{ value: "MPP", position: "top" }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={dataIV} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="V" tickFormatter={(v) => `${v.toFixed(1)}`} label={{ value: "Tensão (V)", position: "insideBottom", offset: -5 }} />
                    <YAxis tickFormatter={(v) => `${v.toFixed(0)}`} label={{ value: "Potência (W)", angle: -90, position: "insideLeft" }} />
                    <Tooltip formatter={(val, name) => [val.toFixed(1), name]} />
                    <Legend />
                    <Line type="monotone" dataKey="P" stroke="#0ea5e9" dot={false} name="P (W)" strokeWidth={2} />
                    <ReferenceDot x={mpp.V} y={mpp.P} r={5} fill="#111827" stroke="#ffffff" label={{ value: "Pmax", position: "top" }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </Section>

          {/* Gráfico 1: Irradiâncias (25°C) em ordem decrescente */}
          <Section title="I–V em diferentes irradiâncias (T=25°C)">
            {(() => {
              const order = [1000, 800, 600, 400, 200];
              const series = order.map((g, idx, arr) => ({ g, color: colorAt(idx, arr.length), curve: computeCurve(g, 25) }));
              return (
                <>
                  <div className="h-96">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="V" type="number" domain={[0, "dataMax"]} label={{ value: "Tensão (V)", position: "insideBottom", offset: -5 }} />
                        <YAxis tickFormatter={(v) => `${v.toFixed(0)}`} label={{ value: "Corrente (A)", angle: -90, position: "insideLeft" }} />
                        <Tooltip
                          formatter={(val, name) => [val.toFixed(2), name]}
                          itemSorter={(item) => {
                            const m = typeof item?.name === 'string' ? parseFloat(item.name) : 0;
                            return -m;
                          }}
                        />
                        {series.map(s => (
                          <Line key={s.g} type="monotone" dataKey="I" data={s.curve.pts} name={`${s.g} W/m²`} stroke={s.color} dot={false} strokeWidth={2} />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2 justify-start items-center">
                    {series.map(s => (
                      <div key={s.g} className="flex items-center gap-2">
                        <span className="inline-block w-3 h-3 rounded-full" style={{ background: s.color }} />
                        <span className="text-sm text-slate-700 whitespace-nowrap">{`${s.g} W/m²`}</span>
                      </div>
                    ))}
                  </div>
                </>
              );
            })()}
          </Section>

          {/* Gráfico 2: Temperaturas (1000 W/m²) em ordem decrescente */}
          <Section title="I–V em diferentes temperaturas (G=1000 W/m²)">
            <div className="h-96">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="V" type="number" domain={[0, "dataMax"]} label={{ value: "Tensão (V)", position: "insideBottom", offset: -5 }} />
                  <YAxis tickFormatter={(v) => `${v.toFixed(0)}`} label={{ value: "Corrente (A)", angle: -90, position: "insideLeft" }} />
                  <Tooltip formatter={(val, name) => [val.toFixed(2), name]} />
                  {(() => {
                    const order = [75, 65, 55, 45, 35, 25];
                    const series = order.map((t, idx, arr) => ({ t, color: colorAt(idx, arr.length), curve: computeCurve(1000, t) }));
                    const legendPayload = series.map(s => ({ value: `Cell Temp=${s.t}°C`, id: `${s.t}`, type: 'line', color: s.color }));
                    return (
                      <>
                        <Legend payload={legendPayload} content={(p) => <CustomLegendOrder {...p} />} />
                        {series.map(s => (
                          <Line key={s.t} type="monotone" dataKey="I" data={s.curve.pts} name={`Cell Temp=${s.t}°C`} stroke={s.color} dot={false} strokeWidth={2} />
                        ))}
                      </>
                    );
                  })()}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Section>

          <Section title="Indicadores (curva base)">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div className="bg-gradient-to-br from-emerald-50 to-white border border-emerald-100 rounded-2xl p-4">
                <div className="text-xs uppercase text-emerald-600">Ponto MPP</div>
                <div className="text-sm text-slate-600">
                  Vmpp ≈ <span className="font-semibold text-slate-800">{mpp.V.toFixed(2)} V</span>
                </div>
                <div className="text-sm text-slate-600">
                  Impp ≈ <span className="font-semibold text-slate-800">{mpp.I.toFixed(2)} A</span>
                </div>
                <div className="text-lg font-bold text-emerald-700">Pmax ≈ {mpp.P.toFixed(1)} W</div>
              </div>
              <div className="bg-gradient-to-br from-teal-50 to-white border border-teal-100 rounded-2xl p-4">
                <div className="text-xs uppercase text-teal-600">Limites</div>
                <div className="text-sm text-slate-600">
                  Voc ≈ <span className="font-semibold text-slate-800">{vocAdj.toFixed(2)} V</span>
                </div>
                <div className="text-sm text-slate-600">
                  Isc ≈ <span className="font-semibold text-slate-800">{iscAdj.toFixed(2)} A</span>
                </div>
                <div className="text-sm text-slate-600">
                  FF ≈ <span className="font-semibold text-slate-800">{(ff * 100).toFixed(1)}%</span>
                </div>
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

      <footer className="px-6 md:px-10 py-8 text-xs text-slate-500">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-2">
          <div>React + Recharts • Tailwind • 1-diodo (Newton) • Projeto educacional</div>
          <div className="text-slate-400">Pré-carregado: ELGIN ELG590-M72HEP • STC (1000 W/m², 25°C)</div>
        </div>
        <div className="mt-3 text-right text-slate-600">Gustavo Santos Silva — 2025</div>
      </footer>
    </div>
  );
}

// Monta o app
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<IVCalculator />);


