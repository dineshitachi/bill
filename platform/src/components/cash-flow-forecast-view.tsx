"use client";

import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";

type Forecast = {
  days: number;
  openingBalance: number;
  collectionDelayDays: number;
  collectionDelaySource: "historical" | "default";
  historicalPaymentCount: number;
  historicalMonthlyExpenses: number;
  outstandingReceivables: number;
  expectedReceipts: number;
  projectedExpenses: number;
  endingBalance: number;
  fundingGap: number;
  buckets: Array<{ start: string; end: string; expectedReceipts: number; projectedExpenses: number; netChange: number; endingBalance: number }>;
};

const formatMoney = (value: number) => new Intl.NumberFormat(document.documentElement.lang || "en-IN", {
  style: "currency", currency: "INR", maximumFractionDigits: 0,
}).format(value);

export function CashFlowForecastView() {
  const [days, setDays] = useState("30");
  const [openingCash, setOpeningCash] = useState("0");
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ days, openingBalance: openingCash || "0" });
    setLoading(true);
    setError("");
    fetch(`/api/reports/cash-flow-forecast?${params}`, { signal: controller.signal })
      .then(async (response) => {
        const body: unknown = await response.json().catch(() => ({}));
        if (!response.ok) {
          const message = typeof body === "object" && body !== null && "error" in body && typeof body.error === "string" ? body.error : "Forecast could not be loaded";
          throw new Error(message);
        }
        return body as Forecast;
      })
      .then(setForecast)
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Forecast could not be loaded");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [days, openingCash, refreshKey]);

  const maxFlow = Math.max(1, ...(forecast?.buckets.map((bucket) => Math.abs(bucket.netChange)) || []));

  return <section className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><p className="eyebrow">Module 41</p><h2 className="mt-1 text-2xl font-bold">Predictive cash flow</h2><p className="muted mt-1 max-w-3xl text-sm">Expected collections use historical payment delay; operating outflows use the previous 180-day expense run rate.</p></div>
      <button className="button button-primary" onClick={() => setRefreshKey((value) => value + 1)} disabled={loading} aria-label="Refresh forecast"><RotateCcw size={16} /> {loading ? "Updating..." : "Refresh forecast"}</button>
    </div>

    <div className="flex flex-wrap items-end gap-3 border-b border-[var(--line)] pb-4">
      <label className="block"><span className="field-label">Forecast horizon</span><select className="field" value={days} onChange={(event) => setDays(event.target.value)}><option value="30">30 days</option><option value="60">60 days</option><option value="90">90 days</option></select></label>
      <label className="block"><span className="field-label">Opening cash balance</span><input className="field" type="number" min="0" step="0.01" value={openingCash} onChange={(event) => setOpeningCash(event.target.value)} /></label>
      <p className="muted max-w-xl pb-2 text-xs">Opening cash is an estimate for this view only. Forecast excludes future sales, scheduled bills, and bank balances.</p>
    </div>

    {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}
    {forecast && <>
      <div className="metric-grid">
        <div><p className="eyebrow">Open receivables</p><p className="mt-1 text-xl font-bold">{formatMoney(forecast.outstandingReceivables)}</p></div>
        <div><p className="eyebrow">Expected receipts</p><p className="mt-1 text-xl font-bold">{formatMoney(forecast.expectedReceipts)}</p></div>
        <div><p className="eyebrow">Projected expense run rate</p><p className="mt-1 text-xl font-bold">{formatMoney(forecast.projectedExpenses)}</p></div>
        <div><p className="eyebrow">Funding gap</p><p className={`mt-1 text-xl font-bold ${forecast.fundingGap ? "text-red-700" : "text-emerald-700"}`}>{formatMoney(forecast.fundingGap)}</p></div>
      </div>

      <section className="panel content-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] p-4">
          <div><h3 className="font-bold">Weekly projection</h3><p className="muted mt-1 text-xs">Estimated collection delay: {forecast.collectionDelayDays.toFixed(1)} days ({forecast.collectionDelaySource === "historical" ? `${forecast.historicalPaymentCount} payment records` : "30-day fallback; no payment history"}).</p></div>
          <p className="text-sm font-semibold">Ending balance: {formatMoney(forecast.endingBalance)}</p>
        </div>
        {forecast.buckets.length ? <div className="table-wrap"><table className="simple-table"><thead><tr className="table-row"><th>Period</th><th>Receipts</th><th>Expenses</th><th>Net movement</th><th>Balance</th><th>Movement</th></tr></thead><tbody>
          {forecast.buckets.map((bucket) => <tr className="table-row" key={bucket.start}>
            <td>{new Intl.DateTimeFormat(document.documentElement.lang || "en-IN", { month: "short", day: "numeric" }).format(new Date(bucket.start))} – {new Intl.DateTimeFormat(document.documentElement.lang || "en-IN", { month: "short", day: "numeric" }).format(new Date(bucket.end))}</td>
            <td>{formatMoney(bucket.expectedReceipts)}</td><td>{formatMoney(bucket.projectedExpenses)}</td>
            <td className={bucket.netChange < 0 ? "font-semibold text-red-700" : "font-semibold text-emerald-700"}>{formatMoney(bucket.netChange)}</td>
            <td className={bucket.endingBalance < 0 ? "font-semibold text-red-700" : ""}>{formatMoney(bucket.endingBalance)}</td>
            <td><div className="h-2 w-28 overflow-hidden rounded bg-slate-100" aria-label={`${bucket.netChange < 0 ? "Outflow" : "Inflow"} ${formatMoney(Math.abs(bucket.netChange))}`}><div className={`h-full ${bucket.netChange < 0 ? "bg-red-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(100, Math.abs(bucket.netChange) / maxFlow * 100)}%` }} /></div></td>
          </tr>)}
        </tbody></table></div> : <p className="muted p-5 text-sm">No forecast periods available.</p>}
      </section>
    </>}
    {!forecast && loading && <p className="muted py-8 text-center text-sm" role="status">Building forecast from tenant financial history...</p>}
  </section>;
}