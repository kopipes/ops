"use client";

import { PROJECT_ROLES, projectRoleOptionLabel, type ProjectRole } from "@/lib/project-roles";

import { useActionState, useRef, useState } from "react";
import { previewProjectChecklistAction, type ProjectActionState } from "@/app/project-actions";
import { PHASES, phaseLabel } from "@/lib/schemas";

export interface WizardOption {
  id: string;
  name: string;
}

export interface WizardTemplate {
  id: string;
  name: string;
  itemCount: number;
  divisionId: string;
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
  ownerDivisions: WizardOption[];
  templates: WizardTemplate[];
  projects: WizardProjectOption[];
  members: WizardMember[];
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
  ownerDivisions,
  templates,
  projects,
  members,
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
  const [templateId, setTemplateId] = useState("");
  const [templateVersion, setTemplateVersion] = useState(0);
  const [selectedRows, setSelectedRows] = useState<ChecklistRow[]>([]);
  const [loadingChecklist, setLoadingChecklist] = useState(false);
  const [checklistError, setChecklistError] = useState("");
  const checklistRequest = useRef(0);
  const [sourceProjectId, setSourceProjectId] = useState("");
  const [removed, setRemoved] = useState<string[]>([]);
  const [customRows, setCustomRows] = useState<ChecklistRow[]>([]);
  const [customLabel, setCustomLabel] = useState("");
  const [customPhase, setCustomPhase] = useState<(typeof PHASES)[number]>("opening");
  const [selectedMembers, setSelectedMembers] = useState<Record<string, ProjectRole>>({});
  const [memberSearch, setMemberSearch] = useState("");
  const [startDate, setStartDate] = useState(todayIso);
  const [endDate, setEndDate] = useState(todayIso);

  const previewRows = [...selectedRows, ...customRows];
  const divisionTemplates = templates.filter((template) => template.divisionId === ownerDivisionId);

  async function selectChecklist(kind: "template" | "project", id: string, divisionId = ownerDivisionId) {
    const request = ++checklistRequest.current;
    setTemplateId(kind === "template" ? id : "");
    setSourceProjectId(kind === "project" ? id : "");
    setTemplateVersion(0);
    setSelectedRows([]);
    setRemoved([]);
    setChecklistError("");
    setLoadingChecklist(Boolean(id));
    if (!id) return;
    try {
      const result = await previewProjectChecklistAction(kind, id, divisionId);
      if (request !== checklistRequest.current) return;
      if ("rows" in result && result.rows) {
        setSelectedRows(result.rows);
        setTemplateVersion(result.version);
      } else {
        setChecklistError(("error" in result ? result.error : undefined) ?? "Checklist tidak dapat dimuat.");
      }
    } catch {
      if (request === checklistRequest.current) setChecklistError("Checklist tidak dapat dimuat.");
    } finally {
      if (request === checklistRequest.current) setLoadingChecklist(false);
    }
  }

  const filteredMembers = members.filter((m) => {
    if (!memberSearch.trim()) return true;
    const q = memberSearch.toLowerCase();
    return m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q);
  });

  const canNext = (() => {
    if (step === 0) return true; // validated on submit
    if (step === 1) return Boolean(ownerDivisionId);
    return !loadingChecklist && !checklistError;
  })();

  const addCustom = () => {
    const label = customLabel.trim();
    if (label.length < 2) return;
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
      <input type="hidden" name="templateIds" value={source === "template" ? templateId : ""} />
      <input type="hidden" name="templateVersion" value={templateVersion} />
      <input type="hidden" name="sourceProjectId" value={source === "project" ? sourceProjectId : ""} />
      {removed.map((k) => (
        <input key={k} type="hidden" name="cl_removed" value={k} />
      ))}
      {customRows.filter((row) => !removed.includes(row.key)).map((r) => (
        <div key={r.key}>
          <input type="hidden" name="cl_label" value={r.label} />
          <input type="hidden" name="cl_phase" value={r.phase} />
          <input type="hidden" name="cl_category" value={r.categoryName} />
          <input type="hidden" name="cl_required" value={r.isRequired ? "1" : "0"} />
          <input type="hidden" name="cl_photo" value={r.requiresPhoto ? "1" : "0"} />
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
            onChange={(e) => {
              setOwnerDivisionId(e.target.value);
              setAdditional((current) => current.filter((id) => id !== e.target.value));
              if (source === "template") void selectChecklist("template", "");
            }}
            className={inputCls}
            style={inputStyle}
          >
            {ownerDivisions.map((d) => (
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
              ["template", "Template divisi"],
              ["project", "Salin dari project sebelumnya"],
              ["empty", "Tanpa template"],
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
                  void selectChecklist("template", "");
                }}
                className="h-5 w-5"
              />
              {label}
            </label>
          ))}
        </fieldset>

        {source === "template" ? (
          <div className="grid gap-1">
            <Label htmlFor="wizard-template">Template untuk divisi owner</Label>
            <select id="wizard-template" value={templateId}
              onChange={(event) => void selectChecklist("template", event.target.value)}
              className={inputCls} style={inputStyle}>
              <option value="">{divisionTemplates.length ? "Pilih template…" : "Belum ada template di divisi ini"}</option>
              {divisionTemplates.map((template) => (
                <option key={template.id} value={template.id}>{template.name} · {template.itemCount} poin</option>
              ))}
            </select>
          </div>
        ) : null}

        {source === "project" ? (
          <select
            aria-label="Project sumber"
            value={sourceProjectId}
            onChange={(event) => void selectChecklist("project", event.target.value)}
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

        {loadingChecklist ? <p role="status" className="text-sm">Memuat checklist…</p> : null}
        {checklistError ? <p role="alert" className="text-sm text-red-700">{checklistError}</p> : null}

        <div>
          <p className="mb-2 text-sm font-medium" style={{ color: "var(--muted)" }}>
            Item checklist ({previewRows.filter((row) => !removed.includes(row.key)).length})
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
                            checked={!removed.includes(r.key)}
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
              maxLength={200}
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
                            [m.userId]: e.target.value as ProjectRole,
                          }))
                        }
                        className="min-h-[36px] rounded-md border px-2 text-sm"
                        style={inputStyle}
                      >
                        {PROJECT_ROLES.map((role) => <option key={role} value={role}>{projectRoleOptionLabel[role]}</option>)}
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
