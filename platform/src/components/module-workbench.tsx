"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RotateCcw } from "lucide-react";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { ...(init?.body ? { "content-type": "application/json" } : {}), ...init?.headers } });
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body === "object" && body !== null && "error" in body && typeof body.error === "string" ? body.error : `Request failed (${response.status})`);
  return body as T;
}

type AccessUser = { id: string; username: string; role: string };

function expenseDocument(record: unknown): { id: string; attachmentName: string } | null {
  if (typeof record !== "object" || record === null || !("id" in record) || !("attachmentName" in record)) return null;
  return typeof record.id === "string" && typeof record.attachmentName === "string" && record.attachmentName
    ? { id: record.id, attachmentName: record.attachmentName }
    : null;
}

export function ModuleWorkbenchView({ title, description, endpoint, actionLabel, actionEndpoint, canReadDocuments = false, canManageDocuments = false }: { title: string; description: string; endpoint: string; actionLabel: string; actionEndpoint?: string; canReadDocuments?: boolean; canManageDocuments?: boolean }) {
  const [payload, setPayload] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [access, setAccess] = useState<{ id: string; attachmentName: string; users: AccessUser[]; grantedUserIds: string[] } | null>(null);
  const load = useCallback(async () => {
    setBusy(true); setError("");
    try { setPayload(await request<unknown>(endpoint)); } catch (reason) { setError(reason instanceof Error ? reason.message : "Module data could not be loaded"); } finally { setBusy(false); }
  }, [endpoint]);
  useEffect(() => { void load(); }, [load]);
  const records = useMemo(() => {
    if (typeof payload !== "object" || payload === null) return [] as unknown[];
    const value = Object.values(payload as Record<string, unknown>).find((candidate) => Array.isArray(candidate));
    return Array.isArray(value) ? value : [];
  }, [payload]);
  async function runAction() {
    if (!actionEndpoint) return load();
    setBusy(true); setError("");
    try { await request(actionEndpoint, { method: "POST" }); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Module action failed"); setBusy(false); }
  }
  async function downloadReceipt(receipt: { id: string; attachmentName: string }) {
    setError("");
    try {
      const result = await request<{ attachmentName: string; attachmentData: string }>(`/api/expenses/${receipt.id}/attachment`);
      const link = document.createElement("a");
      link.href = result.attachmentData;
      link.download = result.attachmentName || receipt.attachmentName;
      link.click();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Receipt could not be opened"); }
  }
  async function manageAccess(receipt: { id: string; attachmentName: string }) {
    setError("");
    try {
      const result = await request<{ users: AccessUser[]; grantedUserIds: string[] }>(`/api/expenses/${receipt.id}/access`);
      setAccess({ ...result, id: receipt.id, attachmentName: receipt.attachmentName });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Access list could not be loaded"); }
  }
  async function saveAccess() {
    if (!access) return;
    setBusy(true); setError("");
    try {
      await request(`/api/expenses/${access.id}/access`, {
        method: "PUT",
        body: JSON.stringify({ grants: access.users.map((user) => ({ userId: user.id, canView: access.grantedUserIds.includes(user.id) })) }),
      });
      setAccess(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Access changes could not be saved"); } finally { setBusy(false); }
  }
  return <section className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="eyebrow">Module workspace</p><h2 className="mt-1 text-2xl font-bold">{title}</h2><p className="muted mt-1 max-w-3xl text-sm">{description}</p></div><button className="button button-primary" onClick={() => void runAction()} disabled={busy} data-resilient-action><RotateCcw size={16} /> {busy ? "Loading..." : actionLabel}</button></div>
    {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}
    <section className="panel content-card">{records.length ? <div className="table-wrap"><table className="simple-table"><thead><tr className="table-row"><th>Record</th><th>Details</th></tr></thead><tbody>{records.slice(0, 50).map((record, index) => {
      const receipt = expenseDocument(record);
      return <tr className="table-row" key={index}><td className="font-semibold">{typeof record === "object" && record !== null && "name" in record ? String(record.name) : `Record ${index + 1}`}</td><td className="max-w-[720px] text-xs"><code className="whitespace-pre-wrap break-words">{JSON.stringify(record, (_key, value: unknown) => typeof value === "bigint" ? value.toString() : value)}</code>{receipt && <div className="mt-2 flex gap-2">{canReadDocuments && <button className="button button-soft !px-3 !py-2 text-xs" onClick={() => void downloadReceipt(receipt)}>Download receipt</button>}{canManageDocuments && <button className="button button-quiet !px-3 !py-2 text-xs" onClick={() => void manageAccess(receipt)}>Manage access</button>}</div>}</td></tr>;
    })}</tbody></table></div> : <div className="py-10 text-center"><p className="muted text-sm">{payload ? "No records are available for this module yet." : "Loading module data..."}</p>{payload !== null && typeof payload === "object" ? <pre className="muted mx-auto mt-4 max-w-3xl overflow-auto rounded-xl bg-slate-50 p-4 text-left text-xs">{JSON.stringify(payload, null, 2)}</pre> : null}</div>}</section>
    {access && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setAccess(null); }}>
      <section className="panel w-full max-w-lg p-5" role="dialog" aria-modal="true" aria-labelledby="document-access-title">
        <h3 id="document-access-title" className="font-bold">Receipt access</h3><p className="muted mt-1 text-sm">{access.attachmentName}</p>
        <div className="mt-4 max-h-72 space-y-2 overflow-auto">{access.users.map((user) => <label key={user.id} className="flex items-center justify-between border-b border-[var(--line)] py-2 text-sm"><span>{user.username}</span><input type="checkbox" checked={access.grantedUserIds.includes(user.id)} onChange={(event) => setAccess((current) => current ? { ...current, grantedUserIds: event.target.checked ? [...current.grantedUserIds, user.id] : current.grantedUserIds.filter((id) => id !== user.id) } : current)} aria-label={`Allow ${user.username} to view this receipt`} /></label>)}{!access.users.length && <p className="muted py-3 text-sm">No active staff accounts are available.</p>}</div>
        <div className="mt-5 flex justify-end gap-2"><button className="button button-quiet" onClick={() => setAccess(null)}>Cancel</button><button className="button button-primary" onClick={() => void saveAccess()} disabled={busy}>{busy ? "Saving..." : "Save access"}</button></div>
      </section>
    </div>}
  </section>;
}
