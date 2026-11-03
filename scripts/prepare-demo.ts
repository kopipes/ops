/** Local preview fixtures. Dry-run by default; --apply backs up before changing data. */
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { getRawDb, resolveDbPath } from "../src/server/db";
import { addDays, computeIsLate, toLocalDate, zonedToUtc } from "../src/lib/datetime";

if (process.env.NODE_ENV === "production" || resolveDbPath() !== resolve("data/ops.db")) {
  throw new Error("Demo preparation is limited to this checkout's local data/ops.db.");
}
const raw = getRawDb();
const today = toLocalDate(Date.now(), "Asia/Jakarta");
const yesterday = addDays(today, -1);
const tomorrow = addDays(today, 1);
const now = Date.now();
const at = (date: string, time: string) => zonedToUtc(date, time, "Asia/Jakarta");
const existing = raw.prepare("SELECT id, code, name FROM projects WHERE deleted_at IS NULL").all() as { id: string; code: string; name: string }[];
const allUsers = raw.prepare("SELECT id, name, role, is_active FROM users").all() as { id: string; name: string; role: string; is_active: number }[];
const bob = process.argv.includes("--demo-users-only") ? undefined : allUsers.find(user => user.name.toLowerCase() === "bob" && user.role === "admin" && user.is_active === 1);
const keepUserIds = ["usr-admin", "usr-corp", "usr-mgr", "usr-crew", bob?.id ?? "usr-multi"];
const removedUsers = allUsers.filter(user => !keepUserIds.includes(user.id));
const secondaryCrew = keepUserIds.includes("usr-multi") ? "usr-multi" : "usr-crew";
const demos = [
  { key: 1, scenario: "complete", name: "01 · Summit Jakarta — Lengkap", client: "PT Cakrawala Digital", venue: "Ballroom JCC Senayan", description: "DATA DEMO · Semua fase terisi, 100% checklist OK, issue ditutup, dan sudah direview. Sesi pagi selesai pukul 11.00 WIB.", closingStart: "10:30", closingEnd: "11:30" },
  { key: 2, scenario: "partial", name: "02 · Festival Senayan — Sebagian", client: "PT Ruang Kreasi Nusantara", venue: "Plaza Timur GBK", description: "DATA DEMO · Opening dan monitoring sudah masuk, closing belum diisi. Ada checklist Tidak OK dan issue yang masih ditangani.", closingStart: "17:00", closingEnd: "23:00" },
  { key: 3, scenario: "empty", name: "03 · Expo Nusantara — Belum Diisi", client: "PT Mitra Pameran Indonesia", venue: "Hall B Jakarta Convention Center", description: "DATA DEMO · Informasi project, anggota, dan checklist sudah siap. Seluruh laporan hari ini belum diisi; konfirmasi vendor masih terbuka.", closingStart: "17:00", closingEnd: "23:00" },
  { key: 4, scenario: "complete", name: "04 · Retail Showcase — Lengkap", client: "PT Niaga Sentosa", venue: "Atrium Sacca Mall", description: "DATA DEMO · Seluruh fase dan dokumentasi selesai, checklist lengkap, temuan ditutup dan sudah direview.", closingStart: "10:30", closingEnd: "11:30" },
  { key: 5, scenario: "partial", name: "05 · Sports Arena — Sebagian", client: "PT Arena Prestasi", venue: "Lapangan Basket Senayan", description: "DATA DEMO · Opening dan monitoring sudah diisi, closing masih kosong; beberapa temuan menunggu tindak lanjut.", closingStart: "17:00", closingEnd: "23:00" },
].map(d => ({ ...d, code: `DEMO-${today.replaceAll("-", "")}-${d.key}` }));
const demoCodes = new Set(demos.map(project => project.code));
const hiddenProjects = existing.filter(project => !demoCodes.has(project.code));
console.log(JSON.stringify({ date: today, hideProjects: hiddenProjects.length, keepUsers: allUsers.filter(user => keepUserIds.includes(user.id)).map(user => ({ name: user.name, role: user.role })), removeUsers: removedUsers.length, demoProjects: demos.map(project => project.name), apply: process.argv.includes("--apply") }, null, 2));
if (!process.argv.includes("--apply")) process.exit(0);

for (const id of keepUserIds) {
  if (!raw.prepare("SELECT id FROM users WHERE id = ? AND is_active = 1").get(id)) throw new Error(`Missing active seed user: ${id}`);
}
const master = raw.prepare("SELECT i.*, c.name AS category_name FROM checklist_items i JOIN checklist_categories c ON c.id = i.category_id WHERE i.id GLOB 'item-[0-9][0-9]' AND i.is_active = 1 ORDER BY i.sort_order").all() as { id: string; label: string; phase: string; category_name: string; is_required: number; requires_photo: number; sort_order: number }[];
if (master.length !== 25) throw new Error("Expected the 25 baseline checklist items; run the baseline seed first.");
const backupPath = resolve(`data/backups/ops-before-demo-${new Date().toISOString().replaceAll(/[:.]/g, "-")}.db`);
await mkdir(resolve("data/backups"), { recursive: true });
await raw.backup(backupPath);

// Deliberately labelled illustrations: these are demo evidence, not real event photos.
const assets = [
  { label: "VENUE & REGISTRASI", color: "#1d4ed8", detail: "Area bersih, signage dan meja registrasi siap" },
  { label: "PANGGUNG & AUDIO", color: "#7c3aed", detail: "Pemeriksaan mikrofon, lighting dan panel audio" },
  { label: "JALUR EVAKUASI", color: "#059669", detail: "Pemeriksaan akses keluar dan perlengkapan safety" },
  { label: "AREA BOOTH & LOGISTIK", color: "#ea580c", detail: "Pemeriksaan booth, vendor dan area publik" },
];
await mkdir(resolve("uploads/demo"), { recursive: true });
const assetMeta: { path: string; thumb: string; bytes: number }[] = [];
for (const [i, asset] of assets.entries()) {
  const escape = (text: string) => text.replaceAll("&", "&amp;");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#e2e8f0"/><rect width="1200" height="380" fill="${asset.color}"/><path d="M0 800L340 380H860L1200 800" fill="#cbd5e1"/><rect x="320" y="160" width="560" height="260" rx="18" fill="#0f172a"/><rect x="360" y="200" width="480" height="180" fill="${asset.color}"/><text x="600" y="280" font-family="sans-serif" font-size="30" fill="white" text-anchor="middle">OPS · EVENT PREVIEW</text><path d="M210 460V240H280V460M920 460V240H990V460" fill="#334155"/><g fill="white"><rect x="110" y="500" width="240" height="110" rx="8"/><rect x="480" y="500" width="240" height="110" rx="8"/><rect x="850" y="500" width="240" height="110" rx="8"/></g><rect y="650" width="1200" height="150" fill="white"/><text x="50" y="700" font-family="sans-serif" font-weight="bold" font-size="30" fill="#0f172a">${escape(asset.label)}</text><text x="50" y="745" font-family="sans-serif" font-size="24" fill="#475569">${escape(asset.detail)}</text><rect x="910" y="30" width="260" height="50" rx="8" fill="white"/><text x="1040" y="63" font-family="sans-serif" font-weight="bold" font-size="22" fill="${asset.color}" text-anchor="middle">ILUSTRASI DEMO</text></svg>`;
  const main = await sharp(Buffer.from(svg)).webp({ quality: 82 }).toBuffer();
  const path = `demo/evidence-${i}.webp`;
  const thumb = `demo/evidence-${i}-thumb.webp`;
  await sharp(main).toFile(resolve("uploads", path));
  await sharp(main).resize(400).toFile(resolve("uploads", thumb));
  assetMeta.push({ path, thumb, bytes: main.length });
}

type Value = string | number | null;
function insert(table: string, values: Record<string, Value>) {
  const keys = Object.keys(values);
  if (![table, ...keys].every(k => /^[a-z_]+$/.test(k))) throw new Error("Invalid fixture identifier");
  raw.prepare(`INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...Object.values(values));
}
function photo(projectId: string, dayId: string, ownerType: string, ownerId: string, time: number, asset = 0, uploadedBy = "usr-crew") {
  const id = randomUUID();
  const a = assetMeta[asset % assetMeta.length];
  insert("photos", { id, project_id: projectId, project_day_id: dayId, owner_type: ownerType, owner_id: ownerId, path: a.path, thumb_path: a.thumb, mime: "image/webp", width: 1200, height: 800, size_bytes: a.bytes, source: "gallery", uploaded_by: uploadedBy, taken_at: time, created_at: time });
  return id;
}
const created: string[] = [];
raw.transaction(() => {
  // The local preview retains five accounts. Remove authentication/membership
  // rows first; preserve audit events and snapshot identities in historical data.
  for (const user of removedUsers) {
    for (const table of ["sessions", "user_divisions", "project_members"]) {
      raw.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(user.id);
    }
    const tables = raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
    for (const { name: table } of tables) {
      if (!/^[a-z_]+$/.test(table)) continue;
      const references = raw.prepare(`PRAGMA foreign_key_list(${table})`).all() as { table: string; from: string }[];
      const columns = raw.prepare(`PRAGMA table_info(${table})`).all() as { name: string; notnull: number }[];
      for (const reference of references.filter(reference => reference.table === "users")) {
        if (!/^[a-z_]+$/.test(reference.from)) throw new Error("Invalid reference identifier");
        const count = raw.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${reference.from} = ?`).get(user.id) as { n: number };
        if (!count.n) continue;
        // The removed demo cross-division crew is consolidated into the kept crew.
        const replacement = user.id === "usr-multi" ? "usr-crew" : null;
        if (replacement === null && columns.find(column => column.name === reference.from)?.notnull) {
          throw new Error(`Cannot safely remove ${user.name}: referenced by ${table}.${reference.from}`);
        }
        raw.prepare(`UPDATE ${table} SET ${reference.from} = ? WHERE ${reference.from} = ?`).run(replacement, user.id);
      }
    }
    raw.prepare("DELETE FROM users WHERE id = ?").run(user.id);
  }
  insert("audit_logs", { id: randomUUID(), user_id: "usr-admin", action: "preview.accounts_pruned", entity_type: "user", entity_id: "preview", meta_json: JSON.stringify({ kept: keepUserIds, removed: removedUsers.map(({ id, name, role }) => ({ id, name, role })), backupPath }), created_at: now });
  for (const p of hiddenProjects) {
    raw.prepare("UPDATE projects SET deleted_at = ?, updated_at = ? WHERE id = ?").run(now, now, p.id);
    insert("audit_logs", { id: randomUUID(), user_id: "usr-admin", action: "project.demo_cleanup", entity_type: "project", entity_id: p.id, meta_json: JSON.stringify({ reason: "Menyisakan tepat lima project preview; data dan foto lain tetap tersimpan dalam soft delete", originalName: p.name, backupPath }), created_at: now });
  }
  for (const d of demos) {
    const prior = raw.prepare("SELECT id, deleted_at FROM projects WHERE code = ?").get(d.code) as { id: string; deleted_at: number | null } | undefined;
    if (prior) {
      if (prior.deleted_at !== null) raw.prepare("UPDATE projects SET deleted_at = NULL, status = 'active', updated_at = ? WHERE id = ?").run(now, prior.id);
      continue;
    }
    const projectId = randomUUID();
    created.push(d.name);
    insert("projects", { id: projectId, code: d.code, name: d.name, client: d.client, venue: d.venue, address: "Jl. Jenderal Gatot Subroto, Gelora, Tanah Abang, Jakarta Pusat", description: d.description, start_date: yesterday, end_date: tomorrow, timezone: "Asia/Jakarta", owner_division_id: "div-evt", status: "active", opening_window_start: "06:30", opening_window_end: "09:00", closing_window_start: d.closingStart, closing_window_end: d.closingEnd, created_by: "usr-admin", created_at: at(yesterday, "06:00"), updated_at: now });
    insert("project_divisions", { project_id: projectId, division_id: d.scenario === "partial" ? "div-cre" : "div-ops" });
    for (const [user, role] of [["usr-mgr", "lead"], ["usr-crew", "lead"], ...(secondaryCrew !== "usr-crew" ? [[secondaryCrew, "crew"]] : [])]) insert("project_members", { project_id: projectId, user_id: user, role_in_project: role, is_active: 1, added_by: "usr-admin", created_at: at(yesterday, "06:00") });
    const checklist = master.map(item => ({ ...item, snapshotId: randomUUID() }));
    for (const item of checklist) insert("project_checklist_items", { id: item.snapshotId, project_id: projectId, source_item_id: item.id, phase: item.phase, category_name: item.category_name, label: item.label, is_required: item.is_required, requires_photo: item.requires_photo, is_active: 1, sort_order: item.sort_order, created_at: at(yesterday, "06:00"), updated_at: now });
    for (const date of [yesterday, today, tomorrow]) {
      const dayId = randomUUID();
      const complete = d.scenario === "complete" && date <= today;
      const partial = d.scenario === "partial" && date === today;
      insert("project_days", { id: dayId, project_id: projectId, date, day_type: "event", assigned_user_id: "usr-crew", handover_note: complete ? "Seluruh peralatan sudah diinventarisasi. Kunci venue diserahkan ke security; tim berikutnya cek ulang signage sebelum opening." : null, reviewed_by: complete ? "usr-mgr" : null, reviewed_at: complete ? at(date, "11:15") : null, created_at: at(yesterday, "06:00"), updated_at: now });
      const notOkResults = new Map<string, { reportId: string; resultId: string }>();
      const phases = complete ? [["opening", "07:30"], ["monitoring", "09:00"], ["monitoring", "10:00"], ["closing", "11:00"]] : partial ? [["opening", "09:10"], ["monitoring", "10:15"]] : [];
      for (const [index, [phase, time]] of phases.entries()) {
        const reportId = randomUUID();
        const timestamp = at(date, time);
        const end = phase === "opening" ? "09:00" : d.closingEnd;
        insert("reports", { id: reportId, project_id: projectId, project_day_id: dayId, phase, submitted_by: index === 2 ? secondaryCrew : "usr-crew", client_submission_id: randomUUID(), status: "submitted", notes: phase === "closing" ? "214 peserta tercatat hadir. Tidak ada barang tertinggal dan seluruh inventory telah dihitung." : partial ? "Tim vendor sedang menangani temuan; dokumentasi dan PIC sudah dilampirkan." : "Crew lengkap 12 orang. Registrasi, akses venue, dan perlengkapan operasional telah diperiksa.", phase_note: phase === "opening" ? (partial ? "Opening selesai setelah penyesuaian jalur evakuasi dan pengecekan audio. Monitoring lanjutan wajib sebelum sesi utama." : "Briefing safety selesai pukul 07.15. Area registrasi dan panggung siap, listrik cadangan siaga, seluruh crew sudah menempati pos.") : phase === "closing" ? "Acara selesai sesuai rundown. Area publik bersih, peralatan dimatikan, barang dikembalikan ke storage, dan security menerima serah terima." : null, observed_at: timestamp, submitted_at: timestamp, is_late: phase === "monitoring" ? 0 : Number(computeIsLate(timestamp, date, end, "Asia/Jakarta")), latitude: "-6.2146", longitude: "106.8070", location_accuracy_m: 15, created_at: timestamp, updated_at: timestamp });
        for (const item of checklist.filter(item => item.phase === phase)) {
          const resultId = randomUUID();
          const notOk = partial && ["item-04", "item-06", "item-15"].includes(item.id);
          const note = notOk ? (item.id === "item-04" ? "Flight case vendor menghalangi akses evakuasi timur. Area diberi pembatas sambil menunggu relokasi." : "Mikrofon kanal 2 terputus sesekali; vendor audio sedang mengganti receiver dan baterai.") : phase === "closing" ? "Sudah dicek bersama security dan koordinator venue." : "Sesuai standar operasional; pemeriksaan lapangan selesai.";
          insert("report_check_results", { id: resultId, report_id: reportId, project_checklist_item_id: item.snapshotId, result: notOk ? "not_ok" : "ok", note, created_at: timestamp });
          if (notOk) notOkResults.set(item.id, { reportId, resultId });
          if (item.requires_photo || notOk) photo(projectId, dayId, "check_result", resultId, timestamp, item.category_name === "Keselamatan" ? 2 : item.category_name === "Audio & Visual" ? 1 : index, index === 2 ? secondaryCrew : "usr-crew");
        }
        photo(projectId, dayId, "report", reportId, timestamp, phase === "monitoring" ? 3 : 0, index === 2 ? secondaryCrew : "usr-crew");
      }
      if (complete || partial) insert("day_comments", { id: randomUUID(), project_day_id: dayId, user_id: "usr-mgr", body: complete ? "Laporan lengkap, dokumentasi sesuai checklist, dan temuan signage sudah ditutup. Terima kasih tim; hari ini sudah direview." : "Prioritaskan jalur evakuasi sebelum sesi utama. Tolong unggah bukti perbaikan audio dan lengkapi closing setelah acara selesai.", created_at: at(date, complete ? "11:10" : "10:30") });
      if (date !== today) continue;
      const cases = d.scenario === "complete" ? [{ title: "Posisi signage registrasi sudah diperbaiki", severity: "low", status: "closed", category: "icat-vendor", item: "", action: "Signage dipindahkan ke titik masuk utama dan sudah diverifikasi koordinator." }] : d.scenario === "partial" ? [
        { title: "Jalur evakuasi timur terhalang flight case", severity: "critical", status: "open", category: "icat-keamanan", item: "item-04", action: "Relokasi flight case ke loading dock, buka akses minimal 1,2 meter, lalu kirim bukti foto. PIC: Crew Lapangan." },
        { title: "Mikrofon panggung kanal 2 terputus", severity: "high", status: "in_progress", category: "icat-teknis", item: "item-15", action: "Ganti receiver dan baterai, lakukan tes audio 15 menit sebelum sesi berikutnya." },
        { title: "Sampah kemasan di area booth sudah dibersihkan", severity: "medium", status: "resolved", category: "icat-kebersihan", item: "", action: "Koordinator menunggu pemeriksaan akhir kebersihan sebelum menutup issue." },
      ] : [{ title: "Denah booth final belum dikonfirmasi vendor", severity: "medium", status: "open", category: "icat-vendor", item: "", action: "Hubungi vendor produksi untuk denah final dan posisi listrik. Setelah konfirmasi, lakukan opening bersama Head Crew." }];
      for (const [i, issue] of cases.entries()) {
        const id = randomUUID();
        const linked = notOkResults.get(issue.item);
        const opened = at(date, "09:20");
        insert("issues", { id, code: `${d.code}-I-${String(i + 1).padStart(3, "0")}`, project_id: projectId, project_day_id: dayId, phase: issue.item === "item-15" ? "monitoring" : "opening", report_id: linked?.reportId ?? null, check_result_id: linked?.resultId ?? null, title: issue.title, description: "DATA DEMO · Temuan pemeriksaan lapangan untuk memperlihatkan alur tindak lanjut, PIC, dokumentasi, dan timeline status.", category_id: issue.category, severity: issue.severity, status: issue.status, next_step: issue.action, pic_user_id: secondaryCrew, due_at: at(date, issue.severity === "critical" ? "10:00" : "15:00"), created_by: "usr-crew", author_name: "Crew Lapangan", author_role: "user", author_division: "Event Production", resolved_by: ["resolved", "closed"].includes(issue.status) ? secondaryCrew : null, resolved_at: ["resolved", "closed"].includes(issue.status) ? at(date, "10:30") : null, closed_by: issue.status === "closed" ? "usr-mgr" : null, closed_at: issue.status === "closed" ? at(date, "10:45") : null, created_at: opened, updated_at: at(date, "10:45") });
        const timeline = (action: string, statusFrom: Value, statusTo: Value, note: string, time: string) => insert("issue_updates", { id: randomUUID(), issue_id: id, user_id: action === "created" ? "usr-crew" : "usr-mgr", author_name: action === "created" ? "Crew Lapangan" : "Manager Event", author_role: action === "created" ? "user" : "manager", author_division: "Event Production", action, note, status_from: statusFrom, status_to: statusTo, changes_json: statusTo ? JSON.stringify({ status: [statusFrom, statusTo] }) : null, created_at: at(date, time) });
        timeline("created", null, "open", "Temuan lapangan didokumentasikan dan diteruskan ke PIC.", "09:20");
        if (issue.status !== "open") timeline("status_changed", "open", "in_progress", "PIC menerima penugasan dan mulai penanganan.", "09:40");
        if (["resolved", "closed"].includes(issue.status)) timeline("status_changed", "in_progress", "resolved", "Perbaikan selesai; menunggu verifikasi koordinator.", "10:30");
        if (issue.status === "closed") timeline("status_changed", "resolved", "closed", "Hasil perbaikan sudah diverifikasi dan dinyatakan selesai.", "10:45");
        timeline("comment", null, null, issue.action, "10:50");
        photo(projectId, dayId, "issue", id, opened, issue.severity === "critical" ? 2 : i + 1);
      }
    }
    insert("audit_logs", { id: randomUUID(), user_id: "usr-admin", action: "project.demo_prepared", entity_type: "project", entity_id: projectId, meta_json: JSON.stringify({ scenario: d.description, date: today }), created_at: now });
  }
  for (const key of ["openingWindowEnabled", "closingWindowEnabled"]) {
    raw.prepare("INSERT INTO app_settings (key,value_json,updated_at) VALUES (?,'false',?) ON CONFLICT(key) DO UPDATE SET value_json='false',updated_at=excluded.updated_at").run(key, now);
  }
  // Older issue tests chose the first existing demo instead of their new project.
  const issueFixtures = raw.prepare("SELECT i.id,i.title FROM issues i JOIN projects p ON p.id=i.project_id WHERE i.deleted_at IS NULL AND p.deleted_at IS NULL").all() as { id: string; title: string }[];
  for (const issue of issueFixtures.filter(issue => /^(?:Lampu mati|Issue lifecycle|Issue close|Issue comment|Issue diff|Filterable) \d{13}$/.test(issue.title))) {
    raw.prepare("UPDATE issues SET deleted_at=?,deleted_by='usr-admin',delete_reason='Cleanup issue hasil E2E untuk preview',updated_at=? WHERE id=?").run(now, now, issue.id);
    insert("audit_logs", { id: randomUUID(), user_id: "usr-admin", action: "issue.demo_hidden", entity_type: "issue", entity_id: issue.id, meta_json: JSON.stringify({ title: issue.title, backupPath }), created_at: now });
  }
  // Old shared E2E runs also left synthetic division choices. Hide only their
  // exact fixture names, and only when no retained user/visible project uses them.
  const divisionFixtures = raw.prepare("SELECT id,code,name FROM divisions WHERE is_active=1").all() as { id: string; code: string; name: string }[];
  for (const division of divisionFixtures.filter(division => /^D\d{4}$/.test(division.code) && division.name === `Divisi ${division.code}`)) {
    const used = raw.prepare("SELECT 1 FROM users WHERE primary_division_id=? UNION ALL SELECT 1 FROM user_divisions WHERE division_id=? UNION ALL SELECT 1 FROM projects WHERE owner_division_id=? AND deleted_at IS NULL UNION ALL SELECT 1 FROM project_divisions pd JOIN projects p ON p.id=pd.project_id WHERE pd.division_id=? AND p.deleted_at IS NULL LIMIT 1").get(division.id, division.id, division.id, division.id);
    if (used) continue;
    raw.prepare("UPDATE divisions SET is_active=0,updated_at=? WHERE id=?").run(now, division.id);
    insert("audit_logs", { id: randomUUID(), user_id: "usr-admin", action: "division.demo_hidden", entity_type: "division", entity_id: division.id, meta_json: JSON.stringify({ name: division.name, backupPath }), created_at: now });
  }
  const projectCount = raw.prepare("SELECT count(*) AS n FROM projects WHERE deleted_at IS NULL").get() as { n: number };
  const userCount = raw.prepare("SELECT count(*) AS n FROM users").get() as { n: number };
  if (projectCount.n !== 5 || userCount.n !== 5) throw new Error("Preview must contain exactly five visible projects and five users; changes rolled back.");
  for (const demo of demos) {
    const project = raw.prepare("SELECT id,status,start_date,end_date FROM projects WHERE code = ? AND deleted_at IS NULL").get(demo.code) as { id: string; status: string; start_date: string; end_date: string } | undefined;
    if (!project || project.status !== "active" || project.start_date > today || project.end_date < today) throw new Error(`Preview project is not active today: ${demo.name}`);
    const phases = raw.prepare("SELECT r.phase,count(*) AS n FROM reports r JOIN project_days d ON d.id=r.project_day_id WHERE r.project_id=? AND d.date=? AND r.status='submitted' AND r.deleted_at IS NULL GROUP BY r.phase").all(project.id, today) as { phase: string; n: number }[];
    const counts = new Map(phases.map(row => [row.phase, row.n]));
    const opening = counts.get("opening") ?? 0;
    const closing = counts.get("closing") ?? 0;
    const monitoring = counts.get("monitoring") ?? 0;
    const valid = demo.scenario === "complete" ? opening === 1 && closing === 1 && monitoring >= 1 : demo.scenario === "partial" ? opening === 1 && closing === 0 && monitoring >= 1 : opening + closing + monitoring === 0;
    if (!valid) throw new Error(`Existing demo no longer matches its ${demo.scenario} scenario: ${demo.name}; changes rolled back.`);
  }
  for (const id of keepUserIds) {
    const user = raw.prepare("SELECT role,is_active,pending_approval FROM users WHERE id=?").get(id) as { role: string; is_active: number; pending_approval: number };
    const expectedRole = id === "usr-mgr" ? "manager" : id === "usr-corp" ? "corporate" : id === "usr-crew" || id === "usr-multi" ? "user" : "admin";
    if (user.role !== expectedRole || !user.is_active || user.pending_approval) throw new Error(`Kept account is not ready: ${id}`);
  }
  if ((raw.pragma("foreign_key_check") as unknown[]).length) throw new Error("Foreign key integrity check failed; demo changes rolled back.");
})();
console.log(JSON.stringify({ backupPath, hiddenProjects: hiddenProjects.length, users: raw.prepare("SELECT name,role FROM users ORDER BY name").all(), created, visibleProjects: raw.prepare("SELECT code, name FROM projects WHERE deleted_at IS NULL ORDER BY name").all() }, null, 2));
raw.close();
