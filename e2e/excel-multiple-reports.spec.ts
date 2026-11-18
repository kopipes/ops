import { expect, test, type Page } from "@playwright/test";
import ExcelJS from "exceljs";
import { readSheet } from "read-excel-file/node";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { today, waitForHydration } from "./helpers";
const PHOTO=resolve('e2e/fixtures/test-photo.jpg');
async function login(page:Page,email='admin@ops.test') {
 await page.goto('/login');await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Password',{exact:true}).fill('OpsDemo2026!');await page.getByRole('button',{name:'Masuk',exact:true}).click();await expect(page).toHaveURL(/\/$/);
}
for(const width of [390,1440]) {
 test(`Excel download, sample skip, preview and import at ${width}px`,async({page})=>{
  test.setTimeout(90000);await page.setViewportSize({width,height:950});await login(page);await page.goto('/master/checklist-items');await waitForHydration(page,'button');
  const downloadEvent=page.waitForEvent('download');await page.getByRole('link',{name:'Unduh template Excel',exact:true}).click();const download=await downloadEvent;await download.saveAs(test.info().outputPath('downloaded-template.xlsx'));const actual=await readSheet(await readFile(test.info().outputPath('downloaded-template.xlsx')),'Checklist');expect(actual[0][8]).toBe('Jenis baris');expect(actual[1][8]).toBe('CONTOH');
  const unique=Date.now()+'-'+width,template='Excel checklist '+unique;
  const wb=new ExcelJS.Workbook(),sheet=wb.addWorksheet('Checklist');sheet.addRow(actual[0]);sheet.addRow(actual[1]);
  for(const phase of ['Opening','Monitoring','Closing'])sheet.addRow([phase,'Venue & Area',`Excel ${phase} ${unique}`,'Petunjuk','','Ya','Tidak',1,'DATA']);
  await page.getByRole('button',{name:'Upload Excel',exact:true}).click();await page.getByLabel('Nama template (opsional)',{exact:true}).fill(template);await page.getByLabel('File checklist (.xlsx)',{exact:true}).setInputFiles({name:'checklist.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(await wb.xlsx.writeBuffer())});
  await page.getByRole('button',{name:'Periksa file',exact:true}).click();await expect(page.getByText('3 baru · 0 duplikat · 0 bermasalah · 1 contoh dilewati',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Impor 3 item',exact:true}).click();await expect(page.getByRole('status')).toContainText('3 item ditambahkan');
  await page.getByLabel('Cari item checklist').fill(unique);const list=width>=1024?page.locator('table').last():page.locator('ul');await expect(list.getByText(`Excel Opening ${unique}`,{exact:true})).toBeVisible();await expect(list.getByText(/CONTOH:/)).toHaveCount(0);
  await page.goto('/master/templates');await expect(page.getByText(template,{exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
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
