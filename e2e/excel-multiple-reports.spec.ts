import { expect as playwrightExpect, test, type Page } from "@playwright/test";
import ExcelJS from "exceljs";
import { readSheet } from "read-excel-file/node";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { today, waitForHydration } from "./helpers";
const expect = playwrightExpect.configure({ timeout: 15000 });
const PHOTO=resolve('e2e/fixtures/test-photo.jpg');
async function login(page:Page,email='admin@ops.test') {
 await page.goto('/login');await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Password',{exact:true}).fill('OpsDemo2026!');await page.getByRole('button',{name:'Masuk',exact:true}).click();await expect(page).toHaveURL(/\/$/);
}
async function xlsx(header: unknown[], rows: unknown[][], name: string) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Checklist");
  sheet.addRow(header);
  for (const row of rows) sheet.addRow(row);
  return { name, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(await workbook.xlsx.writeBuffer()) };
}

for (const width of [390, 1440]) {
 test(`Division template Excel lifecycle and project snapshot at ${width}px`, async ({ page }) => {
  test.setTimeout(120000);
  page.setDefaultTimeout(15000);
  await page.setViewportSize({ width, height: 950 });
  await login(page, "manager@ops.test");
  await page.goto("/master/templates");
  await page.getByRole("link", { name: "Upload Excel", exact: true }).click();
  await waitForHydration(page, 'input[type="file"]');

  const pendingDownload = page.waitForEvent("download");
  await page.getByRole("link", { name: "Unduh template Excel", exact: true }).click();
  const download = await pendingDownload;
  const blankPath = test.info().outputPath("downloaded-template.xlsx");
  await download.saveAs(blankPath);
  const [headers, sample] = await readSheet(await readFile(blankPath), "Checklist");
  expect(headers[7]).toBe("Jenis baris");
  expect(headers).not.toContain("Divisi");
  expect(sample[7]).toBe("CONTOH");
  const name = `Venue ${Date.now()} ${width}`;
  const opening = ["Opening", "Area Venue", "Periksa pintu masuk", "Pastikan signage terlihat", "Ya", "Ya", 1, "DATA"];
  const closing = ["Closing", "Area Venue", "Matikan lampu luar", "", "Ya", "Tidak", 2, "DATA"];
  await page.getByLabel("File Excel", { exact: true }).setInputFiles(await xlsx(headers, [sample, opening, closing], `${name}.xlsx`));
  await expect(page.getByLabel("Nama template")).toHaveValue(name);
  await page.getByRole("button", { name: "Pratinjau Excel" }).click();
  await expect(page.getByText("2 poin siap disimpan · 1 baris contoh dilewati")).toBeVisible();
  await page.getByRole("button", { name: "Buat template", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Template dibuat." })).toBeVisible();
  const templatePath = new URL(page.url()).pathname;
  const templateId = templatePath.split("/").at(-1)!;
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();

  await page.goto("/projects/new");
  await waitForHydration(page, 'ol[aria-label="Langkah wizard"]');
  const code = `TPL-${Date.now()}`;
  await page.getByLabel("Kode project", { exact: true }).fill(code);
  await page.getByLabel("Nama project", { exact: true }).fill(`Checklist ${name}`);
  await page.getByLabel("Venue", { exact: true }).fill("Lokasi uji");
  const next = page.getByRole("button", { name: "Lanjut →", exact: true });
  await next.click();
  await next.click();
  await page.getByLabel("Template untuk divisi owner").selectOption(templateId);
  await expect(page.getByRole("checkbox", { name: "Sertakan Periksa pintu masuk", exact: true })).toBeChecked();
  await next.click();
  await next.click();
  await page.getByRole("button", { name: "Simpan project", exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  const project = new URL(page.url()).pathname;

  await page.goto(templatePath);
  await expect(page.getByRole("button", { name: "Simpan template", exact: true })).toBeEnabled();
  await page.getByText("Periksa pintu masuk", { exact: true }).click();
  await page.getByLabel("Nama poin", { exact: true }).filter({ visible: true }).fill("Periksa signage venue");
  await page.getByRole("button", { name: "Simpan template", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Template tersimpan." })).toBeVisible();

  const exportEvent = page.waitForEvent("download");
  await page.getByRole("link", { name: "Unduh Excel", exact: true }).click();
  const exportedPath = test.info().outputPath("exported-template.xlsx");
  await (await exportEvent).saveAs(exportedPath);
  const exported = await readSheet(await readFile(exportedPath), "Checklist");
  expect(exported[1]).toContain("Periksa signage venue");
  expect(exported[1]).toContain("Pastikan signage terlihat");

  await page.getByText("Ganti isi dari Excel", { exact: true }).click();
  const replacement = ["Monitoring", "Area Venue", "Pantau area antrean", "", "Ya", "Tidak", 2, "DATA"];
  await page.getByLabel("File Excel", { exact: true }).setInputFiles(await xlsx(headers, [exported[1], replacement], "revisi.xlsx"));
  await page.getByRole("button", { name: "Pratinjau Excel", exact: true }).click();
  await expect(page.getByText("1 ditambah · 0 diubah · 1 dihapus · 1 tetap", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Ganti isi template", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Isi template berhasil diganti." })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe(templatePath);
  await expect(page.getByText("Pantau area antrean", { exact: true })).toBeVisible();
  await expect(page.getByText("Matikan lampu luar", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Arsipkan template", exact: true }).click();
  await expect(page.getByText("Template diarsipkan.", { exact: true })).toBeVisible();
  await page.goto("/master/templates");
  await expect(page.getByRole("link", { name: new RegExp(name) })).toBeHidden();
  await page.getByText(/^Arsip \(\d+\)$/).first().click();
  await page.getByRole("link", { name: new RegExp(name) }).click();
  await page.getByRole("button", { name: "Pulihkan template", exact: true }).click();
  await expect(page.getByText("Template dipulihkan.", { exact: true })).toBeVisible();

  await page.goto(`${project}?tab=checklist`);
  await expect(page.getByText("Periksa pintu masuk", { exact: true })).toBeVisible();
  await expect(page.getByText("Matikan lampu luar", { exact: true })).toBeVisible();
  await expect(page.getByText("Pantau area antrean", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
 });
 test(`Multiple phase reports, chosen times, photo modal and independent edits at ${width}px`,async({page})=>{
  test.setTimeout(120000);page.setDefaultTimeout(10000);await page.setViewportSize({width,height:950});await login(page,'manager@ops.test');await page.goto('/projects/new');await waitForHydration(page,'ol[aria-label="Langkah wizard"]');
  const code='EVT-2026-'+Date.now()+width;await page.getByLabel('Kode project',{exact:true}).fill(code);await page.getByLabel('Nama project',{exact:true}).fill('Multiple reports '+code);await page.getByLabel('Venue',{exact:true}).fill('Test venue');for(let i=0;i<4;i++)await page.getByRole('button',{name:'Lanjut →',exact:true}).click();await page.getByRole('button',{name:'Simpan project',exact:true}).click();await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);const project=page.url();const ids:string[]=[];
  for(const phase of ['opening','monitoring','closing']) {
   const label=phase[0].toUpperCase()+phase.slice(1);
   for(let i=1;i<=2;i++) {
    await page.goto(`${project}/days/${today()}/${phase}`);await page.getByLabel(/Jam kejadian/).fill(i===1?'09:15':'10:45');
    await page.locator('#notes').fill(`${phase} report ${i}`);if(phase!=='monitoring')await page.locator('#phaseNote').fill(`${phase} narrative ${i}`);
    await page.getByLabel('Pilih foto umum dari galeri',{exact:true}).setInputFiles(PHOTO);await expect(page.getByText('1 foto terlampir',{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Perbesar Foto laporan 1',exact:true}).click();const modal=page.getByRole('dialog');await expect(modal).toBeVisible();await expect(modal.locator('img')).toBeVisible();if(phase==='opening'&&i===1)await page.screenshot({path:test.info().outputPath('photo-modal.png')});await modal.getByRole('button',{name:'Tutup foto',exact:true}).click();await expect(modal).not.toBeVisible();
    await page.getByRole('button',{name:`Submit ${label}`,exact:true}).click();await expect(page).toHaveURL(/submitted=/);ids.push(new URL(page.url()).searchParams.get('submitted')!);
   }
   await page.goto(`${project}/days/${today()}/${phase}`);await expect(page.getByRole('heading',{name:`Laporan ${label} (2)`,exact:true})).toBeVisible();await expect(page.getByText(/10[.:]45/).first()).toBeVisible();
  }
  await page.screenshot({path:test.info().outputPath('multiple-report-history.png'),fullPage:true});
  await page.goto(`/reports/edit/${ids[1]}`);await page.getByLabel(/Jam kejadian/).fill('11:30');await page.getByLabel('Isi laporan opening',{exact:true}).fill('Changed second narrative');await page.getByLabel('Catatan umum',{exact:true}).fill('Changed second opening');await page.getByRole('button',{name:'Simpan perubahan',exact:true}).click();await expect(page.getByRole('status')).toHaveText('Perubahan tersimpan.');await expect(page.getByLabel(/Jam kejadian/)).toHaveValue('11:30');
  await page.goto(`/reports/edit/${ids[0]}`);await expect(page.getByLabel('Catatan umum',{exact:true})).toHaveValue('opening report 1');await expect(page.getByLabel(/Jam kejadian/)).toHaveValue('09:15');
  await page.goto(`${project}?tab=today`);const detailLink=page.locator('a[href^="/reports/day/"]').first();await expect(detailLink).toBeVisible();const dayId=(await detailLink.getAttribute('href'))!.split('/').pop()!;await detailLink.click();
  for(const id of ids){const block=page.locator(`#report-${id}`);await expect(block).toBeVisible();await expect(block.locator('img')).toHaveCount(1);await expect(block.getByRole('link',{name:'Lihat / Edit',exact:true})).toBeVisible();}
  await page.goto(`/print/day/${dayId}`);await expect(page.getByText('opening narrative 1',{exact:true})).toBeVisible();await expect(page.getByText('Changed second narrative',{exact:true})).toBeVisible();await expect(page.getByText('closing narrative 2',{exact:true})).toBeVisible();
  await page.goto(`/print/project/${project.split('/').pop()}`);await expect(page.locator('.print-root')).toContainText('opening narrative 1');await expect(page.locator('.print-root')).toContainText('Changed second narrative');
 });
}
