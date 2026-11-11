"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  BadgeCheck, Banknote, BookOpenCheck, Brain, BriefcaseBusiness, CalendarClock, ChartNoAxesCombined,
  Check, CircleCheck, Code2, ConciergeBell, Headphones, Handshake, Magnet, Megaphone, MessageCircle,
  Plus, ReceiptText, Search, SearchCheck, Send, Sparkles, Target, Wallet, Workflow, Wrench, X,
} from "lucide-react";
import { agentTemplates, type AgentProfileRecord } from "@/agent-templates";

const icons = {
  ConciergeBell, Wrench, ReceiptText, Banknote, Magnet, Send, CalendarClock, Headphones, Handshake,
  ChartNoAxesCombined, CircleCheck, BadgeCheck, Code2, SearchCheck, Megaphone, Workflow,
  BriefcaseBusiness, Brain, BookOpenCheck, MessageCircle, Wallet, Target,
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { ...(init?.body ? { "content-type": "application/json" } : {}), ...init?.headers },
  });
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
      ? body.error
      : `Request failed (${response.status})`;
    throw new Error(message);
  }
  return body as T;
}

export function AgentGallery({ isAdmin }: { isAdmin: boolean }) {
  const [profiles, setProfiles] = useState<AgentProfileRecord[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All templates");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const categories = useMemo(() => ["All templates", ...new Set(agentTemplates.map((template) => template.category))], []);
  const filtered = agentTemplates.filter((template) =>
    (category === "All templates" || template.category === category) &&
    `${template.title} ${template.category} ${template.instructions}`.toLowerCase().includes(query.toLowerCase()),
  );
  const selected = agentTemplates.find((template) => template.id === selectedId);

  async function loadProfiles() {
    const result = await request<{ agents: AgentProfileRecord[] }>("/api/agents");
    setProfiles(result.agents);
  }

  useEffect(() => {
    void loadProfiles().catch((error: unknown) => setNotice(error instanceof Error ? error.message : "Could not load agents"));
  }, []);

  function openEditor(templateId: string | null) {
    const template = agentTemplates.find((item) => item.id === templateId);
    setSelectedId(templateId || "custom");
    setName(template?.title || "");
    setInstructions(template?.instructions || "");
    setNotice("");
  }

  async function saveAgent(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    try {
      await request<{ agent: AgentProfileRecord }>("/api/agents", {
        method: "POST",
        body: JSON.stringify({ templateId: selectedId || "custom", name, instructions }),
      });
      setSelectedId(null);
      setNotice("Agent profile created. Connect an execution provider before using it to act.");
      await loadProfiles();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not create agent profile");
    } finally {
      setBusy(false);
    }
  }

  return <section className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="eyebrow">Agent workspace</p><h2 className="mt-1 text-2xl font-bold">Build an AI agent</h2><p className="muted mt-1 max-w-2xl text-sm">Start from a role, tailor its instructions, and save the profile to this workspace.</p></div>
      <button type="button" className="button button-primary" onClick={() => openEditor(null)} disabled={!isAdmin}><Plus size={16} /> Create from scratch</button>
    </div>

    <section className="panel content-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] pb-4">
        <div><p className="eyebrow">Workspace agents</p><h3 className="mt-1 font-bold">Saved profiles <span className="muted font-normal">{profiles.length}</span></h3></div>
        <p className="muted text-xs">Profiles are saved, but agent execution is not connected.</p>
      </div>
      {profiles.length ? <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {profiles.map((profile) => <article key={profile.id} className="rounded-lg border border-[var(--line)] p-4">
          <div className="flex items-start justify-between gap-3"><h4 className="font-semibold">{profile.name}</h4><span className="tag">Profile</span></div>
          <p className="muted mt-2 text-xs">{agentTemplates.find((template) => template.id === profile.templateId)?.category || "Custom"} · Created by {profile.createdBy}</p>
          <p className="mt-3 line-clamp-3 whitespace-pre-wrap text-sm">{profile.instructions}</p>
        </article>)}
      </div> : <p className="muted py-7 text-center text-sm">No agent profiles yet.</p>}
    </section>

    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="eyebrow">Featured</p><h3 className="mt-1 text-lg font-bold">Choose a starting point</h3></div><label className="relative w-full sm:max-w-xs"><Search className="muted absolute left-3 top-1/2 -translate-y-1/2" size={16} /><input className="field pl-10" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search roles and instructions" /></label></div>
      <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Template categories">
        {categories.map((item) => <button key={item} type="button" role="tab" aria-selected={category === item} className={`button !shrink-0 !px-3 !py-2 text-xs ${category === item ? "button-primary" : "button-soft"}`} onClick={() => setCategory(item)}>{item}</button>)}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {filtered.map((template) => {
          const Icon = icons[template.icon as keyof typeof icons];
          return <article key={template.id} className="flex min-h-48 flex-col rounded-lg border border-[var(--line)] bg-white/70 p-4">
            <div className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]"><Icon size={20} /></span><div className="min-w-0"><p className="text-xs font-medium text-[var(--accent)]">{template.category}</p><h4 className="mt-1 font-bold leading-snug">{template.title}</h4></div></div>
            <p className="muted mt-3 line-clamp-3 text-sm">{template.instructions}</p>
            <button type="button" className="button button-soft mt-auto self-start !px-3 !py-2 text-xs" onClick={() => openEditor(template.id)} disabled={!isAdmin} title={isAdmin ? `Create ${template.title}` : "Administrator access required"}><Sparkles size={14} /> Create Agent</button>
          </article>;
        })}
        {!filtered.length && <p className="muted col-span-full py-8 text-center text-sm">No templates match this search.</p>}
      </div>
    </section>

    {notice && <p role="status" className="muted text-sm">{notice}</p>}
    {selectedId !== null && <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/40 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setSelectedId(null); }}>
      <form className="panel content-card my-auto w-full max-w-2xl space-y-4" onSubmit={saveAgent} role="dialog" aria-modal="true" aria-labelledby="agent-editor-title">
        <div className="flex items-start justify-between gap-3"><div><p className="eyebrow">{selected ? selected.category : "Custom agent"}</p><h3 id="agent-editor-title" className="mt-1 text-xl font-bold">Configure agent profile</h3></div><button type="button" className="button button-quiet !p-2" aria-label="Close" onClick={() => setSelectedId(null)} disabled={busy}><X size={18} /></button></div>
        <label className="block space-y-1.5 text-sm font-medium">Agent name<input className="field" required minLength={2} maxLength={80} value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label className="block space-y-1.5 text-sm font-medium">Instructions<textarea className="field min-h-48 resize-y" required minLength={10} maxLength={10_000} value={instructions} onChange={(event) => setInstructions(event.target.value)} /></label>
        <p className="muted text-xs">Saving stores an editable profile. No actions are run by this profile yet.</p>
        <div className="flex justify-end gap-2"><button type="button" className="button button-soft" onClick={() => setSelectedId(null)} disabled={busy}>Cancel</button><button className="button button-primary" disabled={busy || name.trim().length < 2 || instructions.trim().length < 10}><Check size={16} />{busy ? "Saving…" : "Save agent"}</button></div>
      </form>
    </div>}
  </section>;
}