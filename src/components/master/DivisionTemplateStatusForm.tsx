"use client";

import { useActionState } from "react";
import { setDivisionTemplateActiveAction } from "@/app/division-template-actions";

export function DivisionTemplateStatusForm({ id, version, active }: { id: string; version: number; active: boolean }) {
  const [state, action, pending] = useActionState(setDivisionTemplateActiveAction, {});
  return (
    <form action={action}>
      <input type="hidden" name="templateId" value={id} />
      <input type="hidden" name="version" value={version} />
      <input type="hidden" name="restore" value={active ? "0" : "1"} />
      <button type="submit" className="btn-secondary" disabled={pending}>
        {pending ? "Menyimpan…" : active ? "Arsipkan template" : "Pulihkan template"}
      </button>
      {state.error ? <p role="alert" className="mt-2 text-sm text-red-700">{state.error}</p> : null}
    </form>
  );
}
