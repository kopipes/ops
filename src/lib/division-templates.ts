import { z } from "zod";
import { projectChecklistEditSchema } from "./schemas";

export const divisionTemplateRowSchema = projectChecklistEditSchema.shape.rows.element.omit({ id: true });
export const divisionTemplateRowsSchema = z.array(divisionTemplateRowSchema)
  .min(1, "Template harus memiliki minimal satu poin.")
  .max(1000, "Maksimal 1.000 poin per template.");
export const divisionTemplateNameSchema = z.string().trim().min(3, "Nama template minimal 3 karakter.").max(100);
export type DivisionTemplateRow = z.infer<typeof divisionTemplateRowSchema>;

export const DIVISION_TEMPLATE_HEADERS = ["Fase", "Kategori", "Item", "Petunjuk", "Wajib", "Foto wajib", "Urutan"] as const;
export const EXCEL_ROW_MARKER = "Jenis baris";

export interface DivisionTemplatePreview {
  hash: string;
  added: number;
  changed: number;
  removed: number;
  unchanged: number;
  samples: number;
  total: number;
  rows: { number: number; label: string; phase: string; category: string; error?: string }[];
}
