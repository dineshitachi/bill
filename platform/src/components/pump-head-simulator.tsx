"use client";

import { useState, type FormEvent } from "react";
import { Activity, Calculator } from "lucide-react";
import { parsePumpCurve, parseVoltageCurve, simulatePumpOperatingPoint, type PumpSimulationResult } from "@/pump-hydraulics";

const numberFormat = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 });

export function PumpHeadSimulator() {
  const [values, setValues] = useState({ staticHeadM: "30", pipeLengthM: "100", pipeInnerDiameterMm: "50", hazenWilliamsC: "150", ratedVoltage: "230", measuredVoltage: "230", stageCount: "1" });
  const [pumpCurveText, setPumpCurveText] = useState("");
  const [voltageCurveText, setVoltageCurveText] = useState("");
  const [result, setResult] = useState<PumpSimulationResult | null>(null);
  const [error, setError] = useState("");

  function calculate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setResult(null);
    try {
      const pumpCurve = parsePumpCurve(pumpCurveText);
      const voltageCurve = voltageCurveText.trim() ? parseVoltageCurve(voltageCurveText) : undefined;
      const nextResult = simulatePumpOperatingPoint({
        staticHeadM: Number(values.staticHeadM),
        pipeLengthM: Number(values.pipeLengthM),
        pipeInnerDiameterMm: Number(values.pipeInnerDiameterMm),
        hazenWilliamsC: Number(values.hazenWilliamsC),
        ratedVoltage: Number(values.ratedVoltage),
        measuredVoltage: Number(values.measuredVoltage),
        stageCount: Number(values.stageCount),
        pumpCurve,
        voltageCurve,
      });
      setResult(nextResult);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Pump operating point could not be calculated");
    }
  }

  function updateValue(key: keyof typeof values, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  return <section className="space-y-5">
    <div><p className="eyebrow">Modules 201 & 301 · Engineering estimate</p><h2 className="mt-1 text-2xl font-bold">Pump head, discharge & stages</h2><p className="muted mt-1 max-w-3xl text-sm">Find the pump/system-curve intersection using entered manufacturer test data and UPVC pipe friction.</p></div>
    <form className="space-y-5" onSubmit={calculate}>
      <div className="grid gap-5 xl:grid-cols-2">
        <section className="panel content-card">
          <div className="flex items-center gap-2"><Activity size={17} /><h3 className="font-bold">System conditions</h3></div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block"><span className="field-label">Static lift / delivery head (m)</span><input className="field" type="number" min="0" step="0.1" required value={values.staticHeadM} onChange={(event) => updateValue("staticHeadM", event.target.value)} /></label>
            <label className="block"><span className="field-label">Pipe run length (m)</span><input className="field" type="number" min="0" step="0.1" required value={values.pipeLengthM} onChange={(event) => updateValue("pipeLengthM", event.target.value)} /></label>
            <label className="block"><span className="field-label">Pipe internal diameter (mm)</span><input className="field" type="number" min="1" step="0.1" required value={values.pipeInnerDiameterMm} onChange={(event) => updateValue("pipeInnerDiameterMm", event.target.value)} /></label>
            <label className="block"><span className="field-label">Hazen–Williams C</span><input className="field" type="number" min="1" step="1" required value={values.hazenWilliamsC} onChange={(event) => updateValue("hazenWilliamsC", event.target.value)} /><span className="muted mt-1 block text-xs">Use the pipe/manufacturer value; 150 is a common new-UPVC assumption.</span></label>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block"><span className="field-label">Motor rated voltage (V)</span><input className="field" type="number" min="1" step="1" required value={values.ratedVoltage} onChange={(event) => updateValue("ratedVoltage", event.target.value)} /></label>
            <label className="block"><span className="field-label">Measured supply voltage (V)</span><input className="field" type="number" min="1" step="1" required value={values.measuredVoltage} onChange={(event) => updateValue("measuredVoltage", event.target.value)} /></label>
            <label className="block"><span className="field-label">Pump stages</span><input className="field" type="number" min="1" max="100" step="1" required value={values.stageCount} onChange={(event) => updateValue("stageCount", event.target.value)} /></label>
          </div>
        </section>

        <section className="panel content-card">
          <h3 className="font-bold">Manufacturer test curves</h3>
          <label className="mt-4 block"><span className="field-label">Per-stage pump curve · flow L/min, head m</span><textarea className="field min-h-32 font-mono text-sm" required value={pumpCurveText} onChange={(event) => setPumpCurveText(event.target.value)} placeholder={"0, head at zero flow\nflow L/min, per-stage head m\n..."} /></label>
          <p className="muted mt-1 text-xs">Enter at least two manufacturer points in ascending flow order. The model assumes identical stages and sums head at a shared flow.</p>
          <label className="mt-4 block"><span className="field-label">Optional voltage correction · voltage %, flow factor, head factor</span><textarea className="field min-h-24 font-mono text-sm" value={voltageCurveText} onChange={(event) => setVoltageCurveText(event.target.value)} placeholder={"90, flow factor, head factor\n100, 1, 1"} /></label>
          <p className="muted mt-1 text-xs">Only enter correction factors from the motor/pump manufacturer. No generic voltage derating is assumed.</p>
        </section>
      </div>
      <button className="button button-primary" type="submit"><Calculator size={16} /> Calculate operating point</button>
    </form>

    {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}
    {result && <section className="panel content-card" aria-live="polite">
      <div><p className="eyebrow">Estimated operating point</p><div className="mt-2 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div><p className="muted text-xs">Discharge</p><p className="mt-1 text-2xl font-bold">{numberFormat.format(result.flowLpm)} <span className="text-sm font-medium">L/min</span></p><p className="muted text-xs">{numberFormat.format(result.flowLpm * 0.264172)} US GPM</p></div>
        <div><p className="muted text-xs">Total dynamic head</p><p className="mt-1 text-2xl font-bold">{numberFormat.format(result.totalDynamicHeadM)} m</p></div>
        <div><p className="muted text-xs">Pipe friction loss</p><p className="mt-1 text-2xl font-bold">{numberFormat.format(result.frictionLossM)} m</p></div>
        <div><p className="muted text-xs">Measured voltage</p><p className="mt-1 text-2xl font-bold">{numberFormat.format(result.voltagePercent)}%</p></div>
      </div></div>
      <div className="mt-5 border-t border-[var(--line)] pt-4"><h3 className="font-bold">Stage-by-stage head allocation</h3><p className="muted mt-1 text-xs">Static and friction values are evenly allocated for comparison; pipe friction physically accumulates along the full column.</p><div className="table-wrap mt-2"><table className="simple-table"><thead><tr className="table-row"><th>Stage</th><th>Pump head share</th><th>Static head share</th><th>Average friction allocation</th><th>Total system head share</th></tr></thead><tbody>{Array.from({ length: result.stageCount }, (_, index) => <tr className="table-row" key={index}><td className="font-semibold">{index + 1}</td><td>{numberFormat.format(result.perStagePumpHeadM)} m</td><td>{numberFormat.format(result.perStageStaticHeadM)} m</td><td>{numberFormat.format(result.perStageFrictionLossM)} m</td><td>{numberFormat.format(result.totalDynamicHeadM / result.stageCount)} m</td></tr>)}</tbody></table></div></div>
      {!result.voltageAdjusted && <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">No manufacturer voltage-correction curve was supplied. Discharge is the rated pump-curve estimate; actual low-voltage motor performance may differ.</p>}
      <p className="muted mt-3 text-xs">Planning estimate only. Actual discharge depends on installation, pipe fittings, water level, pump condition, and measured manufacturer data.</p>
    </section>}
  </section>;
}