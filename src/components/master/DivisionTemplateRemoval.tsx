"use client";

import { RemoveDataButton, useDataRemoval } from "@/components/admin/DataRemoval";

export function DivisionTemplateRemoval({ id }: { id: string }) {
  const { requestRemoval, removalDialog, removalNotice } = useDataRemoval();
  return (
    <>
      <RemoveDataButton label="Hapus template" onClick={() => requestRemoval("division_template", id)} />
      {removalNotice}
      {removalDialog}
    </>
  );
}
