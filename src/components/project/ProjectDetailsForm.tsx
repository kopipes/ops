"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { updateProjectDetailsAction, type ProjectActionState } from "@/app/project-actions";

interface Props {
  projectId: string;
  updatedAt: number;
  datesLocked: boolean;
  canChangeOwnerDivision: boolean;
  divisionOptions: { id: string; name: string }[];
  initial: {
    code: string;
    name: string;
    client: string;
    venue: string;
    address: string;
    description: string;
    startDate: string;
    endDate: string;
    ownerDivisionId: string;
    additionalDivisionIds: string[];
  };
}

const field = "min-h-tap w-full min-w-0 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-base";
const initialState: ProjectActionState = {};
const textFields = [
  { name: "code", label: "Nomor project", max: 40, min: 3 },
  { name: "name", label: "Nama project", max: 120, min: 3 },
  { name: "venue", label: "Venue", max: 120, min: 2 },
  { name: "client", label: "Klien (opsional)", max: 120 },
  { name: "address", label: "Alamat (opsional)", max: 300 },
] as const;

export function ProjectDetailsForm({ projectId, updatedAt, datesLocked, canChangeOwnerDivision, divisionOptions, initial }: Props) {
  const [details, setDetails] = useState(initial);
  const [state, save, pending] = useActionState(updateProjectDetailsAction, initialState);
  const ownerName = divisionOptions.find((division) => division.id === details.ownerDivisionId)?.name;

  return (
    <form action={save} className="surface-card p-4 sm:p-5">
      <h2 className="section-title mb-4">Edit detail project</h2>
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="updatedAt" value={updatedAt} />
      <fieldset disabled={pending} className="grid gap-4 sm:grid-cols-2">
        {textFields.map(({ name, label, max, ...options }) => (
          <label key={name} className={`grid min-w-0 gap-1 text-sm ${name === "address" ? "sm:col-span-2" : ""}`}>
            {label}
            <input
              name={name}
              className={field}
              value={details[name]}
              onChange={(event) => setDetails({ ...details, [name]: event.target.value })}
              maxLength={max}
              minLength={"min" in options ? options.min : undefined}
              required={"min" in options}
              pattern={name === "code" ? "[A-Za-z0-9\\-]+" : undefined}
            />
          </label>
        ))}
        <label className="grid min-w-0 gap-1 text-sm sm:col-span-2">
          Deskripsi (opsional)
          <textarea name="description" className={field} rows={3} maxLength={1000} value={details.description}
            onChange={(event) => setDetails({ ...details, description: event.target.value })} />
        </label>
        <label className="grid min-w-0 gap-1 text-sm">
          Tanggal mulai
          <input type="date" name="startDate" className={field} required readOnly={datesLocked} value={details.startDate}
            onChange={(event) => setDetails({ ...details, startDate: event.target.value })} />
        </label>
        <label className="grid min-w-0 gap-1 text-sm">
          Tanggal selesai
          <input type="date" name="endDate" className={field} required readOnly={datesLocked} value={details.endDate}
            onChange={(event) => setDetails({ ...details, endDate: event.target.value })} />
        </label>
        {datesLocked ? <p className="text-sm text-[var(--muted)] sm:col-span-2">Aktifkan kembali project untuk mengubah tanggal.</p> : null}
        {canChangeOwnerDivision ? (
          <label className="grid min-w-0 gap-1 text-sm sm:col-span-2">
            Divisi penanggung jawab
            <select name="ownerDivisionId" className={field} value={details.ownerDivisionId} onChange={(event) => {
              const ownerDivisionId = event.target.value;
              setDetails({
                ...details, ownerDivisionId,
                additionalDivisionIds: details.additionalDivisionIds.filter((id) => id !== ownerDivisionId),
              });
            }}>
              {divisionOptions.map((division) => <option key={division.id} value={division.id}>{division.name}</option>)}
            </select>
          </label>
        ) : (
          <div className="text-sm sm:col-span-2">
            <input type="hidden" name="ownerDivisionId" value={details.ownerDivisionId} />
            <p className="text-[var(--muted)]">Divisi penanggung jawab</p>
            <p>{ownerName}</p>
          </div>
        )}
        <fieldset className="sm:col-span-2">
          <legend className="mb-1 text-sm font-medium">Divisi tambahan (opsional)</legend>
          <div className="grid max-h-44 grid-cols-1 gap-x-3 overflow-auto rounded-xl border border-[var(--border)] p-2 sm:grid-cols-2">
            {divisionOptions.filter((division) => division.id !== details.ownerDivisionId).map((division) => (
              <label key={division.id} className="flex min-h-10 min-w-0 items-center gap-2 px-2 text-sm">
                <input type="checkbox" name="additionalDivisionIds" value={division.id}
                  checked={details.additionalDivisionIds.includes(division.id)} onChange={(event) => {
                    const additionalDivisionIds = event.target.checked
                      ? [...details.additionalDivisionIds, division.id]
                      : details.additionalDivisionIds.filter((id) => id !== division.id);
                    setDetails({ ...details, additionalDivisionIds });
                  }} />
                <span className="break-words">{division.name}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {state.error ? <p role="alert" className="text-sm text-red-700 dark:text-red-300 sm:col-span-2">{state.error}</p> : null}
        <div className="flex flex-wrap justify-end gap-2 sm:col-span-2">
          {!pending ? <Link className="btn-secondary" href={`/projects/${projectId}?tab=settings`}>Batal</Link> : null}
          <button type="submit" className="btn-primary">{pending ? "Menyimpan…" : "Simpan perubahan"}</button>
        </div>
      </fieldset>
    </form>
  );
}
