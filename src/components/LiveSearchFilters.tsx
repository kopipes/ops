"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

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
  const projectInput = useRef<HTMLInputElement>(null);
  const selected = projects?.find(project => project.id === params.get("projectId"));

  useEffect(() => {
    // A response must not overwrite newer text while the user is still typing.
    if (document.activeElement !== input.current) setQuery(currentQuery);
  }, [currentQuery]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => { if (pickerOpen) projectInput.current?.focus(); }, [pickerOpen]);

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

  return <div className="mb-4 flex flex-col gap-2" aria-busy={pending}>
    <label className="flex flex-col gap-1 text-sm">
      <span style={{ color: "var(--muted)" }}>{placeholder}</span>
      <input ref={input} type="search" value={query} maxLength={120} placeholder={placeholder} onChange={event => {
        const value = event.target.value;
        setQuery(value);
        if (timer.current) clearTimeout(timer.current);
        if (!value) navigate(""); else timer.current = setTimeout(() => navigate(value), 250);
      }} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); navigate(query); } }} className="min-h-tap w-full rounded-lg border px-3 py-2 text-base" style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--fg)" }} />
    </label>
    {projects ? <div>
      <button ref={pickerButton} type="button" aria-expanded={pickerOpen} aria-controls="project-search-options" onClick={() => setPickerOpen(value => !value)} className="flex min-h-tap w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm sm:max-w-lg" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
        <span>Filter project: {selected?.name ?? "Semua project"}</span><span aria-hidden="true">▾</span>
      </button>
      {pickerOpen ? <div id="project-search-options" className="mt-2 rounded-lg border p-2 sm:max-w-lg" style={{ background: "var(--surface)", borderColor: "var(--border)" }} onKeyDown={event => { if (event.key === "Escape") { setPickerOpen(false); pickerButton.current?.focus(); } }}>
        <input ref={projectInput} type="search" aria-label="Cari pilihan project" placeholder="Cari nama atau kode project…" value={projectSearch} onChange={event => setProjectSearch(event.target.value)} className="mb-2 min-h-tap w-full rounded-lg border px-3 text-base" style={{ borderColor: "var(--border)", background: "var(--bg)" }} />
        <div className="flex max-h-64 flex-col gap-1 overflow-y-auto" role="group" aria-label="Pilihan project">
          <button type="button" onClick={() => selectProject("")} aria-pressed={!params.get("projectId")} className="min-h-tap rounded-md px-3 py-2 text-left text-sm">Semua project</button>
          {matches?.map(project => <button key={project.id} type="button" aria-pressed={selected?.id === project.id} onClick={() => selectProject(project.id)} className="min-h-tap rounded-md border px-3 py-2 text-left text-sm" style={{ borderColor: selected?.id === project.id ? "var(--accent)" : "var(--border)" }}><span className="block">{project.name}</span><span className="text-xs" style={{ color: "var(--muted)" }}>{project.code}</span></button>)}
          {!matches?.length ? <p className="px-3 py-2 text-sm" style={{ color: "var(--muted)" }}>Project tidak ditemukan.</p> : null}
        </div>
      </div> : null}
    </div> : null}
    <p role="status" className="min-h-4 text-xs" style={{ color: "var(--muted)" }}>{pending || query.trim() !== currentQuery ? "Mencari…" : "Hasil diperbarui otomatis saat mengetik."}</p>
  </div>;
}
