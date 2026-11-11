"use client";

import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { moduleCatalog, moduleDomains, moduleStatusLabels, resolveSelectedModule, type ModuleStatus } from "@/module-catalog";
import { ModuleGridEngine } from "@/components/module-grid-engine";

const statusOrder: ModuleStatus[] = ["implemented", "partial", "provider", "missing", "needs-spec"];
const statusStyles: Record<ModuleStatus, string> = {
  implemented: "tag-paid",
  partial: "tag",
  provider: "tag tag-partial",
  missing: "tag tag-unpaid",
  "needs-spec": "tag",
};

export function ModulePortfolioView() {
  const [query, setQuery] = useState("");
  const [domain, setDomain] = useState("All domains");
  const [status, setStatus] = useState<ModuleStatus | "ALL">("ALL");
  const [selectedId, setSelectedId] = useState(1);

  const statusCounts = useMemo(() => Object.fromEntries(statusOrder.map((value) => [
    value,
    moduleCatalog.filter((module) => module.status === value).length,
  ])) as Record<ModuleStatus, number>, []);
  const domainCounts = useMemo(() => Object.fromEntries(moduleDomains.map((value) => [
    value,
    moduleCatalog.filter((module) => module.domain === value).length,
  ])) as Record<string, number>, []);

  const filteredModules = useMemo(() => {
    const search = query.trim().toLowerCase();
    return moduleCatalog.filter((module) =>
      (domain === "All domains" || module.domain === domain)
      && (status === "ALL" || module.status === status)
      && (!search || `${module.id} ${module.title} ${module.domain} ${module.summary}`.toLowerCase().includes(search)),
    );
  }, [domain, query, status]);

  const selectedModule = resolveSelectedModule(filteredModules, selectedId);

  useEffect(() => {
    if (!filteredModules.some((module) => module.id === selectedId) && filteredModules[0]) setSelectedId(filteredModules[0].id);
  }, [filteredModules, selectedId]);

  return <section className="space-y-5">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="eyebrow">Module portfolio · 1–1400</p>
        <h2 className="mt-1 text-2xl font-bold">Operational module registry</h2>
        <p className="muted mt-1 max-w-3xl text-sm">Each entry separates its stated behavior from repository evidence. Unmapped requirements remain explicitly unverified.</p>
      </div>
      <div className="text-right"><p className="eyebrow">Catalog entries</p><p className="text-2xl font-bold">{moduleCatalog.length.toLocaleString()}</p></div>
    </header>

    <div className="metric-grid grid-cols-2 xl:grid-cols-5">
      {statusOrder.map((value) => <div key={value}>
        <p className="eyebrow">{moduleStatusLabels[value]}</p>
        <p className="mt-1 text-xl font-bold">{statusCounts[value].toLocaleString()}</p>
      </div>)}
    </div>

    <nav className="flex gap-2 overflow-x-auto border-b border-[var(--line)] pb-2" aria-label="Filter modules by domain" role="tablist">
      {["All domains", ...moduleDomains].map((value) => <button key={value} role="tab" aria-selected={domain === value} className="sidebar-link shrink-0 !px-3 !py-2 text-sm" data-active={domain === value} onClick={() => setDomain(value)}>{value}<span className="muted ml-1 text-xs">{(value === "All domains" ? moduleCatalog.length : domainCounts[value]).toLocaleString()}</span></button>)}
    </nav>

    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,0.8fr)]">
      <section aria-label="Module list">
        <div className="flex flex-wrap items-end gap-3 border-b border-[var(--line)] pb-4">
          <label className="block min-w-56 flex-1"><span className="field-label">Search catalog</span><span className="relative block"><Search size={16} className="muted absolute left-3 top-1/2 -translate-y-1/2" /><input className="field pl-10" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ID, name, or feature" /></span></label>
          <label className="block"><span className="field-label">Implementation status</span><select className="field" value={status} onChange={(event) => setStatus(event.target.value as ModuleStatus | "ALL")}><option value="ALL">All statuses</option>{statusOrder.map((value) => <option value={value} key={value}>{moduleStatusLabels[value]}</option>)}</select></label>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="muted text-xs">{filteredModules.length.toLocaleString()} matching modules · virtualized</p>
        </div>
        <ModuleGridEngine modules={filteredModules} selectedId={selectedId} onSelect={setSelectedId} />
      </section>

      <aside className="border-t border-[var(--line)] pt-5 xl:sticky xl:top-4 xl:border-l xl:border-t-0 xl:pl-5 xl:pt-0" aria-live="polite" aria-label="Selected module details">
        {!selectedModule ? <div className="py-8 text-center xl:py-12"><p className="font-semibold">No module selected</p><p className="muted mt-2 text-sm">No modules match the current filters. Adjust the domain, status, or search.</p></div> : <>
        <p className="eyebrow">Selected module · {selectedModule.id}</p>
        <h3 className="mt-1 text-xl font-bold">{selectedModule.title}</h3>
        <div className="mt-3 flex flex-wrap items-center gap-2"><span className={statusStyles[selectedModule.status]}>{moduleStatusLabels[selectedModule.status]}</span><span className="tag">{selectedModule.domain}</span></div>
        <section className="mt-5 border-t border-[var(--line)] pt-4"><h4 className="eyebrow">Operational feature</h4><p className="mt-2 text-sm leading-relaxed">{selectedModule.summary}</p></section>
        <section className="mt-5 border-t border-[var(--line)] pt-4"><h4 className="eyebrow">Repository evidence</h4><p className="muted mt-2 text-sm leading-relaxed">{selectedModule.evidence}</p></section>
        <section className="mt-5 border-t border-[var(--line)] pt-4"><h4 className="eyebrow">Required next validation</h4><p className="mt-2 text-sm leading-relaxed">{selectedModule.nextValidation}</p></section>
        <p className="muted mt-5 border-t border-[var(--line)] pt-4 text-xs">“Code present · unverified” means implementation evidence exists; it does not claim successful runtime or production validation.</p>
        </>}
      </aside>
    </div>
  </section>;
}