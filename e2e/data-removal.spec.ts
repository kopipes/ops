import { expect, test, type Page, type Locator } from "@playwright/test";
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3113";
const PASSWORD = "OpsDemo2026!";
async function login(page: Page, email="admin@ops.test", password=PASSWORD) {
  await page.goto(`${BASE}/login`);await page.getByLabel("Email",{exact:true}).fill(email);await page.getByLabel("Password",{exact:true}).fill(password);await page.getByRole("button",{name:"Masuk",exact:true}).click();
}
async function remove(page: Page, row: Locator, name: string, mode: "delete" | "archive" = "delete") {
  await row.getByRole("button",{name:"Hapus",exact:true}).click();
  const modal=page.getByRole("dialog");
  await expect(modal.getByRole("heading",{name:mode==="delete"?"Hapus permanen?":"Arsipkan data?",exact:true})).toBeVisible();
  await modal.getByLabel("Alasan",{exact:true}).fill("Pembersihan data E2E");
  await modal.getByLabel(/^Ketik/).fill(name);
  await modal.getByRole("button",{name:mode==="delete"?"Ya, hapus permanen":"Ya, arsipkan",exact:true}).click();
  await expect(modal).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText(mode==="delete"?"berhasil dihapus permanen":"diarsipkan");
  await expect(row).toHaveCount(0);
}
for(const width of [390,1440]) {
 test(`Admin removes unused divisions, users, and issue categories with confirmation at ${width}px`,async({browser})=>{
  test.setTimeout(120000);
  const context=await browser.newContext({viewport:{width,height:950}});const page=await context.newPage();const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  const suffix=Date.now()+"-"+width;
  try {
   await login(page);await expect(page).toHaveURL(`${BASE}/`);
   // Division: cancelling via Escape must preserve the data.
   await page.goto(`${BASE}/admin/divisions`);await page.getByRole("button",{name:"+ Divisi",exact:true}).click();
   const division=`Delete division ${suffix}`;
   await page.getByLabel(/Kode/).fill(`X${Date.now().toString().slice(-6)}`);await page.getByLabel("Nama divisi",{exact:true}).fill(division);await page.getByRole("button",{name:"Buat divisi",exact:true}).click();
   let row=page.locator("li").filter({hasText:division});await row.getByRole("button",{name:"Hapus",exact:true}).click();await expect(page.getByRole("dialog").getByRole("heading",{name:"Hapus permanen?",exact:true})).toBeVisible();
   await page.screenshot({path:test.info().outputPath(`removal-dialog-${width}.png`)});
   await page.keyboard.press("Escape");await expect(page.getByRole("dialog")).toHaveCount(0);await expect(row).toBeVisible();
   await remove(page,row,division);
   // User: exact confirmation required; own account has no delete control.
   await page.goto(`${BASE}/admin/users`);await expect(page.locator("li").filter({hasText:"admin@ops.test"}).getByRole("button",{name:"Hapus",exact:true})).toHaveCount(0);
   const user=`Delete user ${suffix}`,email=`delete-${suffix}@example.test`;
   await page.getByRole("button",{name:"+ User",exact:true}).click();await page.getByLabel("Nama",{exact:true}).fill(user);await page.getByLabel("Email",{exact:true}).fill(email);await page.getByLabel("Password awal (min. 8 karakter)").fill("Temporary2026!");await page.getByRole("button",{name:"Buat user",exact:true}).click();
   row=page.locator("li").filter({hasText:email});await row.getByRole("button",{name:"Hapus",exact:true}).click();const modal=page.getByRole("dialog");await expect(modal.getByRole("heading",{name:"Hapus permanen?",exact:true})).toBeVisible();await modal.getByLabel("Alasan",{exact:true}).fill("Pembersihan data");await modal.getByLabel(/^Ketik/).fill("wrong name");await modal.getByRole("button",{name:"Ya, hapus permanen",exact:true}).click();await expect(modal.getByRole("alert")).toContainText("Nama konfirmasi tidak sesuai");await modal.getByRole("button",{name:"Batal",exact:true}).click();
   await remove(page,row,user);
   await page.goto(`${BASE}/master/issue-categories`);
   const category = `Delete issue category ${suffix}`;
   await page.getByLabel("Nama", { exact: true }).fill(category);
   await page.getByRole("button", { name: "Tambah kategori", exact: true }).click();
   await remove(page, page.locator("li").filter({ hasText: category }), category);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
  } finally {await context.close();}
 });
}

test("used user is archived, hidden by default, and loses their session; Manager cannot remove",async({browser})=>{
 test.setTimeout(90000);
 const context=await browser.newContext({viewport:{width:390,height:900}});const crewContext=await browser.newContext();const managerContext=await browser.newContext();
 try {
  const page=await context.newPage();const crew=await crewContext.newPage();const manager=await managerContext.newPage();
  await login(page);await expect(page).toHaveURL(`${BASE}/`);await page.goto(`${BASE}/admin/users`);
  const suffix=Date.now(),name=`Archive user ${suffix}`,email=`archive-${suffix}@example.test`;
  await page.getByRole("button",{name:"+ User",exact:true}).click();await page.getByLabel("Nama",{exact:true}).fill(name);await page.getByLabel("Email",{exact:true}).fill(email);await page.getByLabel("Password awal (min. 8 karakter)").fill("Temporary2026!");await page.getByRole("button",{name:"Buat user",exact:true}).click();
  await login(crew,email,"Temporary2026!");await expect(crew).toHaveURL(/\/me\/password/);
  const row=page.locator("li").filter({hasText:email});await remove(page,row,name,"archive");await page.getByLabel("Tampilkan user nonaktif").check();await expect(row.getByText("Nonaktif",{exact:true})).toBeVisible();
  await crew.goto(`${BASE}/`);await expect(crew).toHaveURL(/\/login/);
  await page.goto(`${BASE}/admin/audit`);await expect(page.getByText("user.archived",{exact:true}).first()).toBeVisible();
  await login(manager,"manager@ops.test");await expect(manager).toHaveURL(`${BASE}/`);
  for(const path of ["/admin/users","/master/checklist-items","/master/templates"]) {
   await manager.goto(`${BASE}${path}`);await expect(manager.locator('main')).toBeVisible();await expect(manager.getByRole("button",{name:"Hapus",exact:true})).toHaveCount(0);
  }
 } finally {await Promise.all([context.close(),crewContext.close(),managerContext.close()]);}
});


test("Admin restores archived issue categories from the inactive list", async ({ page }) => {
  await login(page);
  await expect(page).toHaveURL(`${BASE}/`);
  await page.goto(`${BASE}/master/issue-categories`);
  const name = `Restore issue category ${Date.now()}`;
  await page.getByLabel("Nama", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Tambah kategori", exact: true }).click();
  const row = page.locator("li").filter({ hasText: name });
  await row.getByRole("button", { name: "Nonaktifkan", exact: true }).click();
  await expect(row).toHaveCount(0);
  await page.getByLabel("Tampilkan yang nonaktif", { exact: true }).check();
  await expect(row.getByText("Nonaktif", { exact: true })).toBeVisible();
  await row.getByRole("button", { name: "Aktifkan", exact: true }).click();
  await expect(row.getByText("Nonaktif", { exact: true })).toHaveCount(0);
  await page.getByLabel("Tampilkan yang nonaktif", { exact: true }).uncheck();
  await expect(row).toBeVisible();
});
