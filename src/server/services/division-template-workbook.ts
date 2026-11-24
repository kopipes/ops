import { DIVISION_TEMPLATE_HEADERS, EXCEL_ROW_MARKER, type DivisionTemplateRow } from "@/lib/division-templates";
import { phaseLabel } from "@/lib/schemas";

export async function divisionTemplateWorkbook(rows?: DivisionTemplateRow[]) {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Checklist", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.addRow([...DIVISION_TEMPLATE_HEADERS, EXCEL_ROW_MARKER]);
  const widths = [16, 22, 42, 56, 13, 16, 10, 14];
  for (const [index, width] of widths.entries()) sheet.getColumn(index + 1).width = width;

  const header = sheet.getRow(1);
  header.height = 24;
  header.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF252653" } };
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.alignment = { vertical: "middle" };
  });
  if (rows) {
    rows.forEach((row, index) => sheet.addRow([
      phaseLabel[row.phase], row.categoryName, row.label, row.description,
      row.isRequired ? "Ya" : "Tidak", row.requiresPhoto ? "Ya" : "Tidak", index + 1, "DATA",
    ]));
  } else {
    const example = sheet.addRow(["Opening", "Kebersihan", "Periksa kebersihan area masuk",
      "Foto area masuk setelah dibersihkan", "Ya", "Ya", 1, "CONTOH"]);
    example.height = 28;
    example.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF0FF" } };
      cell.font = { italic: true, color: { argb: "FF454985" } };
    });
  }
  sheet.getColumn(3).alignment = { wrapText: true, vertical: "top" };
  sheet.getColumn(4).alignment = { wrapText: true, vertical: "top" };
  const bytes = await workbook.xlsx.writeBuffer();
  return new Uint8Array(bytes);
}
