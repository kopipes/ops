"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Icon } from "@/components/ui/WorkspaceUI";

export interface ProjectSearchOption { id: string; code: string; name: string }

/** Debounced URL filters; results remain server-scoped to the current user. */
export function LiveSearchFilters({ placeholder, projects }: { placeholder: string; projects?: ProjectSearchOption[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const currentQuery = params.get("q") ?? "";
  const [query, setQuery] = useState(currentQuery);
  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [projectSearch, setProjectSearch] = useState("");
  const pickerButton = useRef<HTMLButtonElement>(null);
  const picker = useRef<HTMLDivElement>(null);
  const projectInput = useRef<HTMLInputElement>(null);
  const selected = projects?.find(project => project.id === params.get("projectId"));

  useEffect(() => {
    // A response must not overwrite newer text while the user is still typing.
    if (document.activeElement !== input.current) setQuery(currentQuery);
  }, [currentQuery]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => { if (pickerOpen) projectInput.current?.focus(); }, [pickerOpen]);
  useEffect(() => {
    if (!pickerOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !picker.current?.contains(event.target)) setPickerOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [pickerOpen]);

  function navigate(value: string, projectId?: string) {
    if (timer.current) clearTimeout(timer.current);
    const next = new URLSearchParams(window.location.search);
    if (value.trim()) next.set("q", value.trim()); else next.delete("q");
    if (projectId !== undefined) {
      if (projectId) next.set("projectId", projectId); else next.delete("projectId");
    }
    const suffix = next.toString();
    startTransition(() => router.replace(`${pathname}${suffix ? `?${suffix}` : ""}`, { scroll: false }));
  }

  function selectProject(id: string) {
    navigate(query, id);
    setPickerOpen(false);
    setProjectSearch("");
    pickerButton.current?.focus();
  }

  const matches = projects?.filter(project => `${project.name} ${project.code}`.toLocaleLowerCase("id-ID").includes(projectSearch.trim().toLocaleLowerCase("id-ID")));

  return <div className="search-toolbar" aria-busy={pending}>
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
    <label className="relative block min-w-0 flex-1 text-sm">
      <span className="sr-only">{placeholder}</span>
      <span className="pointer-events-none absolute left-4 top-[15px] text-[var(--muted)]"><Icon name="search" size={18} /></span>
      <input ref={input} type="search" value={query} maxLength={120} placeholder={placeholder} onChange={event => {
        const value = event.target.value;
        setQuery(value);
        if (timer.current) clearTimeout(timer.current);
        if (!value) navigate(""); else timer.current = setTimeout(() => navigate(value), 250);
      }} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); navigate(query); } }} className="search-input !text-base sm:!text-sm" />
    </label>
    {projects ? <div ref={picker} className="relative sm:w-64 sm:shrink-0" onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPickerOpen(false);
    }} onKeyDown={event => {
      if (event.key === "Escape") { setPickerOpen(false); pickerButton.current?.focus(); }
    }}>
      <button ref={pickerButton} type="button" aria-expanded={pickerOpen} aria-controls="project-search-options" onClick={() => setPickerOpen(value => !value)} className="flex min-h-[48px] w-full items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-xs" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
        <Icon name="folder" size={16} /><span className="min-w-0 flex-1 truncate">Filter project: {selected?.name ?? "Semua project"}</span><span aria-hidden="true">▾</span>
      </button>
      {pickerOpen ? <div id="project-search-options" className="surface-card absolute right-0 top-full z-20 mt-2 w-full min-w-[256px] p-2 shadow-xl">
        <input ref={projectInput} type="search" aria-label="Cari pilihan project" placeholder="Cari nama atau kode project…" value={projectSearch} onChange={event => setProjectSearch(event.target.value)} className="mb-2 min-h-tap w-full rounded-lg border px-3 text-base" style={{ borderColor: "var(--border)", background: "var(--bg)" }} />
        <div className="flex max-h-64 flex-col gap-1 overflow-y-auto" role="group" aria-label="Pilihan project">
          <button type="button" onClick={() => selectProject("")} aria-pressed={!params.get("projectId")} className="min-h-tap rounded-md px-3 py-2 text-left text-sm">Semua project</button>
          {matches?.map(project => <button key={project.id} type="button" aria-pressed={selected?.id === project.id} onClick={() => selectProject(project.id)} className="min-h-tap rounded-md border px-3 py-2 text-left text-sm" style={{ borderColor: selected?.id === project.id ? "var(--accent)" : "var(--border)" }}><span className="block">{project.name}</span><span className="text-xs" style={{ color: "var(--muted)" }}>{project.code}</span></button>)}
          {!matches?.length ? <p className="px-3 py-2 text-sm" style={{ color: "var(--muted)" }}>Project tidak ditemukan.</p> : null}
        </div>
      </div> : null}
    </div> : null}
    </div>
    <p role="status" className="mt-2 min-h-4 text-[10px]" style={{ color: "var(--muted)" }}>{pending || query.trim() !== currentQuery ? "Mencari…" : "Hasil diperbarui otomatis saat mengetik."}</p>
  </div>;
}
