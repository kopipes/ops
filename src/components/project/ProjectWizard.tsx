"use client";

import { useActionState, useMemo, useState } from "react";
import type { ProjectActionState } from "@/app/project-actions";
import { PHASES, phaseLabel } from "@/lib/schemas";

export interface WizardOption {
  id: string;
  name: string;
}

export interface WizardTemplate {
  id: string;
  name: string;
  itemCount: number;
  divisionName: string | null;
}

export interface WizardProjectOption {
  id: string;
  code: string;
  name: string;
}

export interface WizardMember {
  userId: string;
  name: string;
  email: string;
  role: string;
  divisionNames: string[];
  inProjectDivision: boolean;
}

export interface ChecklistRow {
  key: string;
  sourceItemId: string | null;
  phase: (typeof PHASES)[number];
  categoryName: string;
  label: string;
  isRequired: boolean;
  requiresPhoto: boolean;
}

interface Props {
  action: (prev: ProjectActionState, formData: FormData) => Promise<ProjectActionState>;
  divisions: WizardOption[];
  templates: WizardTemplate[];
  projects: WizardProjectOption[];
  members: WizardMember[];
  /** Pre-rendered checklist rows per template, so the client can build the preview. */
  templateRows: Record<string, ChecklistRow[]>;
  projectRows: Record<string, ChecklistRow[]>;
  currentUserId: string;
  defaultDivisionId: string;
  defaultCode: string;
  isAdmin: boolean;
  todayIso: string;
  errorFromQuery?: string;
  /** Global defaults from /admin/settings (§12). */
  defaults?: {
    openingWindowEnabled: boolean;
    closingWindowEnabled: boolean;
    openingWindowStart: string;
    openingWindowEnd: string;
    closingWindowStart: string;
    closingWindowEnd: string;
    timezone: string;
  };
}

const STEPS = ["Info dasar", "Divisi", "Checklist", "Member", "Jadwal & Simpan"] as const;

const inputCls = "min-h-tap w-full rounded-lg border px-3 py-2 text-base outline-none";
const inputStyle = {
  background: "var(--surface)",
  borderColor: "var(--border)",
  color: "var(--fg)",
} as const;

function Label({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="text-sm" style={{ color: "var(--muted)" }}>
      {children}
    </label>
  );
}

export function ProjectWizard({
  action,
  divisions,
  templates,
  projects,
  members,
  templateRows,
  projectRows,
  currentUserId,
  defaultDivisionId,
  defaultCode,
  todayIso,
  errorFromQuery,
  defaults,
}: Props) {
  const [state, formAction, pending] = useActionState(action, {} as ProjectActionState);

  const [step, setStep] = useState(0);
  const [ownerDivisionId, setOwnerDivisionId] = useState(defaultDivisionId);
  const [additional, setAdditional] = useState<string[]>([]);
  const [source, setSource] = useState<"template" | "project" | "empty">("template");
  const [templateIds, setTemplateIds] = useState<string[]>([]);
  const [sourceProjectId, setSourceProjectId] = useState("");
  const [removed, setRemoved] = useState<string[]>([]);
  const [customRows, setCustomRows] = useState<ChecklistRow[]>([]);
  const [customLabel, setCustomLabel] = useState("");
  const [customPhase, setCustomPhase] = useState<(typeof PHASES)[number]>("opening");
  const [selectedMembers, setSelectedMembers] = useState<Record<string, "lead" | "crew">>({});
  const [memberSearch, setMemberSearch] = useState("");
  const [startDate, setStartDate] = useState(todayIso);
  const [endDate, setEndDate] = useState(todayIso);

  // Preview rows for the chosen source, minus anything unchecked.
  const previewRows: ChecklistRow[] = useMemo(() => {
    let base: ChecklistRow[] = [];
    if (source === "template") {
      const seen = new Set<string>();
      for (const tid of templateIds) {
        for (const row of templateRows[tid] ?? []) {
          const key = row.sourceItemId ?? `${row.phase}::${row.label}`;
          if (seen.has(key)) continue;
          seen.add(key);
          base.push({ ...row, key });
        }
      }
    } else if (source === "project" && sourceProjectId) {
      base = (projectRows[sourceProjectId] ?? []).slice();
    }
    return [...base.filter((r) => !removed.includes(r.key)), ...customRows];
  }, [source, templateIds, templateRows, sourceProjectId, projectRows, removed, customRows]);

  const filteredMembers = members.filter((m) => {
    if (!memberSearch.trim()) return true;
    const q = memberSearch.toLowerCase();
    return m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q);
  });

  const canNext = (() => {
    if (step === 0) return true; // validated on submit
    if (step === 1) return Boolean(ownerDivisionId);
    return true;
  })();

  const addCustom = () => {
    const label = customLabel.trim();
    if (!label) return;
    setCustomRows((prev) => [
      ...prev,
      {
        key: `custom-${Date.now()}-${prev.length}`,
        sourceItemId: null,
        phase: customPhase,
        categoryName: "Umum",
        label,
        isRequired: true,
        requiresPhoto: false,
      },
    ]);
    setCustomLabel("");
  };

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {/* Hidden fields carrying wizard state into the server action. */}
      <input type="hidden" name="ownerDivisionId" value={ownerDivisionId} />
      {additional.map((d) => (
        <input key={d} type="hidden" name="additionalDivisionIds" value={d} />
      ))}
      <input type="hidden" name="checklistSource" value={source} />
      {templateIds.map((t) => (
        <input key={t} type="hidden" name="templateIds" value={t} />
      ))}
      <input type="hidden" name="sourceProjectId" value={source === "project" ? sourceProjectId : ""} />
      {removed.map((k) => (
        <input key={k} type="hidden" name="cl_removed" value={k} />
      ))}
      {previewRows.map((r) => (
        <div key={r.key}>
          <input type="hidden" name="cl_label" value={r.label} />
          <input type="hidden" name="cl_phase" value={r.phase} />
          <input type="hidden" name="cl_category" value={r.categoryName} />
          <input type="hidden" name="cl_source" value={r.sourceItemId ?? ""} />
          <input type="hidden" name="cl_required" value={r.isRequired ? "1" : "0"} />
          <input type="hidden" name="cl_photo" value={r.requiresPhoto ? "1" : "0"} />
          <input type="hidden" name="cl_savemaster" value={r.sourceItemId ? "0" : "1"} />
        </div>
      ))}
      {Object.entries(selectedMembers).map(([userId, role]) => (
        <div key={userId}>
          <input type="hidden" name="memberIds" value={userId} />
          <input type="hidden" name={`role_${userId}`} value={role} />
        </div>
      ))}

      {/* Step indicator */}
      <ol className="flex gap-1" aria-label="Langkah wizard">
        {STEPS.map((s, i) => (
          <li
            key={s}
            className="flex-1 rounded-full px-1 py-1 text-center text-[10px] leading-4"
            style={{
              background: i === step ? "var(--accent-solid)" : i < step ? "#dcfce7" : "var(--surface)",
              color: i === step ? "#fff" : i < step ? "#166534" : "var(--muted)",
              border: "1px solid var(--border)",
            }}
            aria-current={i === step ? "step" : undefined}
          >
            {i + 1}. {s}
          </li>
        ))}
      </ol>

      {errorFromQuery ? (
        <p role="alert" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "#dc2626", color: "#dc2626" }}>
          {errorFromQuery}
        </p>
      ) : null}

      {/* ---------------- Step 1: basic info ---------------- */}
      <section hidden={step !== 0} className={step === 0 ? "flex flex-col gap-3" : "hidden"}>
        <div className="flex flex-col gap-1">
          <Label htmlFor="code">Kode project</Label>
          <input
            id="code"
            name="code"
            required
            defaultValue={defaultCode}
            className={inputCls}
            style={inputStyle}
          />
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            Saran otomatis (mis. EVT-2026-0012), bisa diubah.
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="name">Nama project</Label>
          <input id="name" name="name" required minLength={3} className={inputCls} style={inputStyle} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="client">Klien (opsional)</Label>
            <input id="client" name="client" className={inputCls} style={inputStyle} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="venue">Venue</Label>
            <input id="venue" name="venue" required className={inputCls} style={inputStyle} />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="address">Alamat (opsional)</Label>
          <input id="address" name="address" className={inputCls} style={inputStyle} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="startDate">Tanggal mulai</Label>
            <input
              id="startDate"
              name="startDate"
              type="date"
              required
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                if (e.target.value > endDate) setEndDate(e.target.value);
              }}
              className={inputCls}
              style={inputStyle}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="endDate">Tanggal selesai</Label>
            <input
              id="endDate"
              name="endDate"
              type="date"
              required
              min={startDate}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className={inputCls}
              style={inputStyle}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="description">Deskripsi (opsional)</Label>
          <textarea
            id="description"
            name="description"
            rows={2}
            className="w-full rounded-lg border px-3 py-2 text-base outline-none"
            style={inputStyle}
          />
        </div>
      </section>

      {/* ---------------- Step 2: divisions ---------------- */}
      <section hidden={step !== 1} className={step === 1 ? "flex flex-col gap-3" : "hidden"}>
        <div className="flex flex-col gap-1">
          <span className="text-sm" style={{ color: "var(--muted)" }}>
            Divisi owner (wajib)
          </span>
          <select
            aria-label="Divisi owner"
            value={ownerDivisionId}
            onChange={(e) => setOwnerDivisionId(e.target.value)}
            className={inputCls}
            style={inputStyle}
          >
            {divisions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            Default divisi utama pembuat. Hanya Admin yang bisa mengubahnya setelah project dibuat.
          </p>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm" style={{ color: "var(--muted)" }}>
            Divisi tambahan (opsional, untuk cross-division visibility)
          </legend>
          {divisions
            .filter((d) => d.id !== ownerDivisionId)
            .map((d) => (
              <label key={d.id} className="flex min-h-tap items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-5 w-5"
                  checked={additional.includes(d.id)}
                  onChange={(e) =>
                    setAdditional((prev) =>
                      e.target.checked ? [...prev, d.id] : prev.filter((x) => x !== d.id),
                    )
                  }
                />
                {d.name}
              </label>
            ))}
        </fieldset>
      </section>

      {/* ---------------- Step 3: checklist ---------------- */}
      <section hidden={step !== 2} className={step === 2 ? "flex flex-col gap-3" : "hidden"}>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm" style={{ color: "var(--muted)" }}>
            Sumber checklist
          </legend>
          {(
            [
              ["template", "Template (bisa pilih lebih dari satu)"],
              ["project", "Copy dari project sebelumnya"],
              ["empty", "Kosong"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex min-h-tap items-center gap-2 text-sm">
              <input
                type="radio"
                name="wizardSource"
                value={value}
                checked={source === value}
                onChange={() => {
                  setSource(value);
                  setRemoved([]);
                }}
                className="h-5 w-5"
              />
              {label}
            </label>
          ))}
        </fieldset>

        {source === "template" ? (
          <fieldset className="flex flex-col gap-2 rounded-lg border p-3" style={{ borderColor: "var(--border)" }}>
            <legend className="px-1 text-xs" style={{ color: "var(--muted)" }}>
              Pilih template
            </legend>
            {templates.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--muted)" }}>
                Belum ada template.
              </p>
            ) : (
              templates.map((t) => (
                <label key={t.id} className="flex min-h-[40px] items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-5 w-5"
                    checked={templateIds.includes(t.id)}
                    onChange={(e) => {
                      setRemoved([]);
                      setTemplateIds((prev) =>
                        e.target.checked ? [...prev, t.id] : prev.filter((x) => x !== t.id),
                      );
                    }}
                  />
                  <span className="min-w-0">
                    <span className="block truncate">{t.name}</span>
                    <span className="block text-xs" style={{ color: "var(--muted)" }}>
                      {t.itemCount} item · {t.divisionName ?? "Global"}
                    </span>
                  </span>
                </label>
              ))
            )}
            {templateIds.length > 1 ? (
              <p className="text-xs" style={{ color: "var(--muted)" }}>
                Template digabung dan duplikat dihilangkan otomatis.
              </p>
            ) : null}
          </fieldset>
        ) : null}

        {source === "project" ? (
          <select
            aria-label="Project sumber"
            value={sourceProjectId}
            onChange={(e) => {
              setSourceProjectId(e.target.value);
              setRemoved([]);
            }}
            className={inputCls}
            style={inputStyle}
          >
            <option value="">Pilih project…</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} — {p.name}
              </option>
            ))}
          </select>
        ) : null}

        <div>
          <p className="mb-2 text-sm font-medium" style={{ color: "var(--muted)" }}>
            Item checklist ({previewRows.length})
          </p>
          {previewRows.length === 0 ? (
            <p
              className="rounded-lg border px-3 py-4 text-center text-sm"
              style={{ borderColor: "var(--border)", color: "var(--muted)" }}
            >
              Belum ada item.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {PHASES.map((phase) => {
                const rows = previewRows.filter((r) => r.phase === phase);
                if (rows.length === 0) return null;
                return (
                  <li key={phase}>
                    <p className="mt-2 text-xs font-medium" style={{ color: "var(--muted)" }}>
                      {phaseLabel[phase]} ({rows.length})
                    </p>
                    <ul className="mt-1 flex flex-col gap-1">
                      {rows.map((r) => (
                        <li
                          key={r.key}
                          className="flex min-h-[40px] items-center gap-2 rounded-lg border px-3 py-1.5 text-sm"
                          style={{ borderColor: "var(--border)", background: "var(--surface)" }}
                        >
                          <input
                            type="checkbox"
                            className="h-5 w-5"
                            defaultChecked
                            aria-label={`Sertakan ${r.label}`}
                            onChange={(e) => {
                              if (e.target.checked) setRemoved((p) => p.filter((k) => k !== r.key));
                              else setRemoved((p) => [...p, r.key]);
                            }}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate">{r.label}</span>
                            <span className="block text-xs" style={{ color: "var(--muted)" }}>
                              {r.categoryName}
                              {r.sourceItemId ? "" : " · custom"}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="rounded-lg border p-3" style={{ borderColor: "var(--border)" }}>
          <p className="mb-2 text-sm font-medium" style={{ color: "var(--muted)" }}>
            Tambah item custom (hanya project ini)
          </p>
          <div className="flex gap-2">
            <select
              aria-label="Fase item custom"
              value={customPhase}
              onChange={(e) => setCustomPhase(e.target.value as (typeof PHASES)[number])}
              className="min-h-tap rounded-lg border px-2 text-sm"
              style={inputStyle}
            >
              {PHASES.map((p) => (
                <option key={p} value={p}>
                  {phaseLabel[p]}
                </option>
              ))}
            </select>
            <input
              aria-label="Label item custom"
              value={customLabel}
              onChange={(e) => setCustomLabel(e.target.value)}
              placeholder="Label item…"
              className={inputCls}
              style={inputStyle}
            />
            <button
              type="button"
              onClick={addCustom}
              className="min-h-tap shrink-0 rounded-lg px-3 text-sm text-white"
              style={{ background: "var(--accent-solid)" }}
            >
              +
            </button>
          </div>
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input type="checkbox" name="saveCustomToMaster" className="h-4 w-4" />
            Simpan juga ke master
          </label>
        </div>
      </section>

      {/* ---------------- Step 4: members ---------------- */}
      <section hidden={step !== 3} className={step === 3 ? "flex flex-col gap-3" : "hidden"}>
        <input
          type="search"
          aria-label="Cari member"
          value={memberSearch}
          onChange={(e) => setMemberSearch(e.target.value)}
          placeholder="Cari nama atau email…"
          className={inputCls}
          style={inputStyle}
        />

        {filteredMembers.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Tidak ada user yang cocok.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {filteredMembers.map((m) => {
              const selected = selectedMembers[m.userId];
              return (
                <li
                  key={m.userId}
                  className="rounded-lg border px-3 py-2"
                  style={{
                    borderColor: selected ? "var(--accent)" : "var(--border)",
                    background: "var(--surface)",
                  }}
                >
                  <label className="flex min-h-[40px] items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-1 h-5 w-5"
                      checked={Boolean(selected)}
                      onChange={(e) =>
                        setSelectedMembers((prev) => {
                          const next = { ...prev };
                          if (e.target.checked) next[m.userId] = "crew";
                          else delete next[m.userId];
                          return next;
                        })
                      }
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">
                        {m.name}
                        {m.userId === currentUserId ? " (kamu)" : ""}
                      </span>
                      <span className="block text-xs" style={{ color: "var(--muted)" }}>
                        {m.email} · {m.role}
                        {m.inProjectDivision ? "" : " · divisi lain"}
                      </span>
                    </span>
                  </label>

                  {selected ? (
                    <div className="mt-1 flex gap-2 pl-7">
                      <select
                        aria-label={`Peran ${m.name}`}
                        value={selected}
                        onChange={(e) =>
                          setSelectedMembers((prev) => ({
                            ...prev,
                            [m.userId]: e.target.value as "lead" | "crew",
                          }))
                        }
                        className="min-h-[36px] rounded-md border px-2 text-sm"
                        style={inputStyle}
                      >
                        <option value="crew">Crew</option>
                        <option value="lead">Head Crew (lead)</option>
                      </select>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ---------------- Step 5: schedule & save ---------------- */}
      <section hidden={step !== 4} className={step === 4 ? "flex flex-col gap-3" : "hidden"}>
        {!defaults?.openingWindowEnabled && !defaults?.closingWindowEnabled ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>Tanpa window opening/closing. Waktu pengisian laporan tetap dicatat otomatis.</p>
        ) : null}
        <div className="grid grid-cols-2 gap-3">
          <div className={defaults?.openingWindowEnabled ? "flex flex-col gap-1" : "hidden"}>
            <Label htmlFor="openingWindowStart">Opening mulai</Label>
            <input id="openingWindowStart" name="openingWindowStart" type="time" defaultValue={defaults?.openingWindowStart ?? "06:00"} className={inputCls} style={inputStyle} />
          </div>
          <div className={defaults?.openingWindowEnabled ? "flex flex-col gap-1" : "hidden"}>
            <Label htmlFor="openingWindowEnd">Opening selesai</Label>
            <input id="openingWindowEnd" name="openingWindowEnd" type="time" defaultValue={defaults?.openingWindowEnd ?? "11:00"} className={inputCls} style={inputStyle} />
          </div>
          <div className={defaults?.closingWindowEnabled ? "flex flex-col gap-1" : "hidden"}>
            <Label htmlFor="closingWindowStart">Closing mulai</Label>
            <input id="closingWindowStart" name="closingWindowStart" type="time" defaultValue={defaults?.closingWindowStart ?? "17:00"} className={inputCls} style={inputStyle} />
          </div>
          <div className={defaults?.closingWindowEnabled ? "flex flex-col gap-1" : "hidden"}>
            <Label htmlFor="closingWindowEnd">Closing selesai</Label>
            <input id="closingWindowEnd" name="closingWindowEnd" type="time" defaultValue={defaults?.closingWindowEnd ?? "23:59"} className={inputCls} style={inputStyle} />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="timezone">Timezone</Label>
          <select id="timezone" name="timezone" defaultValue={defaults?.timezone ?? "Asia/Jakarta"} className={inputCls} style={inputStyle}>
            <option value="Asia/Jakarta">WIB — Asia/Jakarta</option>
            <option value="Asia/Makassar">WITA — Asia/Makassar</option>
            <option value="Asia/Jayapura">WIT — Asia/Jayapura</option>
          </select>
        </div>

        <label className="flex min-h-tap items-center gap-2 text-sm">
          <input type="checkbox" name="saveAsDraft" className="h-5 w-5" />
          Simpan sebagai draft (belum aktif)
        </label>

        <dl className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
          <div className="flex justify-between py-0.5">
            <dt style={{ color: "var(--muted)" }}>Checklist</dt>
            <dd>{previewRows.length} item</dd>
          </div>
          <div className="flex justify-between py-0.5">
            <dt style={{ color: "var(--muted)" }}>Member</dt>
            <dd>{Object.keys(selectedMembers).length} orang</dd>
          </div>
          <div className="flex justify-between py-0.5">
            <dt style={{ color: "var(--muted)" }}>Rentang</dt>
            <dd>
              {startDate} → {endDate}
            </dd>
          </div>
        </dl>

        {state.error ? (
          <p role="alert" className="text-sm" style={{ color: "#dc2626" }}>
            {state.error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          className="min-h-tap rounded-lg px-4 py-3 text-base font-medium text-white disabled:opacity-60"
          style={{ background: "var(--accent-solid)" }}
        >
          {pending ? "Menyimpan…" : "Simpan project"}
        </button>
      </section>

      {/* Navigation */}
      <div className="flex gap-2">
        {step > 0 ? (
          <button
            type="button"
            onClick={() => setStep((s) => s - 1)}
            className="min-h-tap flex-1 rounded-lg border px-4 py-3 text-sm"
            style={{ borderColor: "var(--border)", color: "var(--muted)" }}
          >
            ← Kembali
          </button>
        ) : null}
        {step < STEPS.length - 1 ? (
          <button
            type="button"
            onClick={() => canNext && setStep((s) => s + 1)}
            disabled={!canNext}
            className="min-h-tap flex-1 rounded-lg px-4 py-3 text-base font-medium text-white disabled:opacity-60"
            style={{ background: "var(--accent-solid)" }}
          >
            Lanjut →
          </button>
        ) : null}
      </div>
    </form>
  );
}
