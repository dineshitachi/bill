"use client";

import { useCallback, useEffect, useState } from "react";
import { RotateCcw, ShieldCheck } from "lucide-react";

type DiagnosticReport = {
  id: string;
  fingerprint: string;
  name: string;
  message: string;
  route: string;
  count: number;
  createdAt: string;
  resolvedBy: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
};
type DiagnosticsPayload = { reports: DiagnosticReport[] };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { ...(init?.body ? { "content-type": "application/json" } : {}), ...init?.headers } });
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body === "object" && body !== null && "error" in body && typeof body.error === "string" ? body.error : `Request failed (${response.status})`);
  return body as T;
}

export function AdminDiagnosticsView() {
  const [reports, setReports] = useState<DiagnosticReport[]>([]);
  const [health, setHealth] = useState("checking");
  const [showResolved, setShowResolved] = useState(false);
  const [selected, setSelected] = useState<DiagnosticReport | null>(null);
  const [resolutionNote, setResolutionNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    const [diagnostics, healthResult] = await Promise.allSettled([
      request<DiagnosticsPayload>("/api/admin/telemetry"),
      request<{ status: string }>("/api/health"),
    ]);
    if (diagnostics.status === "fulfilled") setReports(diagnostics.value.reports);
    else setError(diagnostics.reason instanceof Error ? diagnostics.reason.message : "Diagnostic reports could not be loaded");
    setHealth(healthResult.status === "fulfilled" ? healthResult.value.status : "unavailable");
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const visibleReports = reports.filter((report) => showResolved || !report.resolvedAt);
  const openCount = reports.filter((report) => !report.resolvedAt).length;

  async function resolveReport(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true); setError("");
    try {
      await request("/api/admin/telemetry", {
        method: "PATCH",
        body: JSON.stringify({ reportId: selected.id, resolutionNote }),
      });
      setSelected(null);
      setResolutionNote("");
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Resolution could not be saved"); }
    finally { setBusy(false); }
  }

  return <section className="space-y-5">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div><p className="eyebrow">Admin control</p><h2 className="mt-1 text-2xl font-bold">Runtime diagnostics</h2><p className="muted mt-1 max-w-3xl text-sm">Review reported errors, check service availability, and record audited remediation.</p></div>
      <button className="button button-primary" onClick={() => void load()} disabled={loading}><RotateCcw size={16} /> {loading ? "Checking..." : "Refresh diagnostics"}</button>
    </header>
    {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}
    <div className="metric-grid grid-cols-2">
      <div><p className="eyebrow">Application database</p><p className={`mt-1 text-xl font-bold ${health === "ok" ? "text-emerald-700" : "text-amber-700"}`}>{health === "ok" ? "Connected" : health === "checking" ? "Checking" : "Unavailable"}</p></div>
      <div><p className="eyebrow">Unresolved reports</p><p className="mt-1 text-xl font-bold">{openCount}</p></div>
    </div>
    <div className="flex items-center justify-between border-b border-[var(--line)] pb-3">
      <h3 className="font-bold">Client runtime reports</h3>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showResolved} onChange={(event) => setShowResolved(event.target.checked)} />Show resolved</label>
    </div>
    {visibleReports.length ? <div className="divide-y divide-[var(--line)]">
      {visibleReports.map((report) => <article key={report.id} className="grid gap-3 py-4 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h4 className="font-semibold">{report.name}</h4><span className={report.resolvedAt ? "tag tag-paid" : "tag tag-partial"}>{report.resolvedAt ? "Resolved" : "Open"}</span><span className="muted text-xs">{report.count} occurrence{report.count === 1 ? "" : "s"}</span></div>
          <p className="mt-1 break-words text-sm">{report.message}</p><p className="muted mt-1 text-xs">{report.route} · {new Intl.DateTimeFormat(document.documentElement.lang || "en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(report.createdAt))} · {report.fingerprint}</p>
          {report.resolutionNote && <p className="mt-2 border-l-2 border-emerald-600 pl-3 text-sm"><strong>Resolution:</strong> {report.resolutionNote}</p>}
        </div>
        {!report.resolvedAt && <button className="button button-soft self-start !px-3 !py-2 text-xs" onClick={() => { setSelected(report); setResolutionNote(""); }}><ShieldCheck size={14} /> Record resolution</button>}
      </article>)}
    </div> : <p className="muted py-10 text-center text-sm">{loading ? "Loading diagnostic reports..." : "No matching diagnostic reports."}</p>}

    {selected && <div className="modal-backdrop no-print" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setSelected(null)}>
      <section className="panel modal-card" role="dialog" aria-modal="true" aria-labelledby="resolve-report-title">
        <h3 id="resolve-report-title" className="text-lg font-bold">Record remediation</h3>
        <p className="muted mt-2 text-sm">This records the administrator’s remediation note and closes the report. It does not modify or deploy application code.</p>
        <form className="mt-4 space-y-3" onSubmit={(event) => void resolveReport(event)}>
          <label className="block"><span className="field-label">Resolution note</span><textarea className="field min-h-28" minLength={8} maxLength={1000} required value={resolutionNote} onChange={(event) => setResolutionNote(event.target.value)} placeholder="Describe the verified remediation or recovery action." /></label>
          <div className="flex justify-end gap-2"><button type="button" className="button button-quiet" onClick={() => setSelected(null)}>Cancel</button><button className="button button-primary" disabled={busy || resolutionNote.trim().length < 8}>{busy ? "Saving..." : "Save resolution"}</button></div>
        </form>
      </section>
    </div>}
  </section>;
}