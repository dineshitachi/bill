"use client";

import { useEffect, useRef, useState } from "react";
import { moduleStatusLabels, type ModuleDefinition } from "@/module-catalog";

const rowHeight = 112;
const overscan = 4;

export function getVirtualRowWindow(totalRows: number, scrollTop: number, viewportHeight: number) {
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const last = Math.min(totalRows, Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan);
  return { first, last };
}

export function ModuleGridEngine({ modules, selectedId, onSelect }: {
  modules: ModuleDefinition[];
  selectedId: number;
  onSelect: (id: number) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(560);
  const [viewportWidth, setViewportWidth] = useState(0);
  const columns = viewportWidth >= 1200 ? 3 : viewportWidth >= 560 ? 2 : 1;
  const totalRows = Math.ceil(modules.length / columns);
  const { first, last } = getVirtualRowWindow(totalRows, scrollTop, viewportHeight);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const resizeObserver = new ResizeObserver(([entry]) => {
      setViewportHeight(entry.contentRect.height);
      setViewportWidth(entry.contentRect.width);
    });
    resizeObserver.observe(viewport);
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    if (viewportRef.current) viewportRef.current.scrollTop = 0;
    setScrollTop(0);
  }, [modules]);

  return <div
    ref={viewportRef}
    className="mt-3 h-[min(64vh,640px)] min-h-72 overflow-y-auto overscroll-contain pr-1"
    aria-label="Module buttons"
    onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
  >
    {modules.length === 0 ? <p className="muted py-10 text-center text-sm">No modules match these filters.</p> : <div style={{ height: totalRows * rowHeight, position: "relative" }}>
      {Array.from({ length: last - first }, (_, offset) => {
        const row = first + offset;
        const rowModules = modules.slice(row * columns, (row + 1) * columns);
        return <div
          key={row}
          className="grid gap-2"
          style={{ position: "absolute", insetInline: 0, top: row * rowHeight, height: rowHeight, gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {rowModules.map((module) => <button
            key={module.id}
            type="button"
            className="panel h-[104px] overflow-hidden border p-3 text-left transition-colors hover:border-[var(--accent)]"
            data-active={selectedId === module.id}
            aria-pressed={selectedId === module.id}
            onClick={() => onSelect(module.id)}
          >
            <span className="flex items-center justify-between gap-2"><span className="eyebrow">Module {module.id}</span><span className="truncate text-xs">{moduleStatusLabels[module.status]}</span></span>
            <span className="mt-2 line-clamp-2 block text-sm font-semibold leading-snug">{module.title}</span>
            <span className="muted mt-1 block truncate text-xs">{module.domain}</span>
          </button>)}
        </div>;
      })}
    </div>}
  </div>;
}