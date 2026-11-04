# Pulse

Aplikasi web mobile-first (PWA) untuk memantau jalannya event harian: **Opening → Monitoring → Closing**.

Spesifikasi lengkap ada di [`docs/PRD-Ops.md`](docs/PRD-Ops.md). Dokumen itu adalah sumber kebenaran; README ini hanya panduan operasional.

> **Melanjutkan pekerjaan?** Baca [`HANDOFF.md`](HANDOFF.md) — status milestone, aturan arsitektur yang tidak boleh dilanggar, dan langkah berikutnya.

**Status: M1–M7 selesai + scope pasca-M7.** Yang sudah ada: skema + migrasi, permission terpusat, auth, seed, app shell PWA, master data, wizard project, crew flow (foto + draft + antrean upload), issues, report & review, export PDF harian & rekap, **admin (user/divisi/setelan/audit)**, **edit laporan + riwayat versi**. Lihat [`HANDOFF.md`](HANDOFF.md) untuk detail dan sisa pekerjaan.

---

## Stack

| Lapisan | Pilihan |
|---|---|
| Framework | Next.js 15 (App Router) + TypeScript |
| DB | SQLite (`better-sqlite3`) + Drizzle ORM |
| Styling | Tailwind CSS (mobile-first, dark mode ikut sistem) |
| Test | Vitest (unit/integration), Playwright (E2E) |

## Menjalankan lokal

```bash
# 1. Install dependencies
pnpm install

# 2. Siapkan environment
cp .env.example .env
#    isi SESSION_SECRET dengan: openssl rand -hex 32

# 3. Migrasi + seed data demo
pnpm db:migrate
pnpm db:seed

# 4. Jalankan
pnpm dev            # http://localhost:3000
```

### Akun demo

Untuk preview yang lebih ringan, gunakan build produksi lokal terpisah dari dev:

```bash
NEXT_DIST_DIR=.next-preview ./node_modules/.bin/next build
APP_URL=http://localhost:3112 PDF_RENDER_ORIGIN=http://127.0.0.1:3112 NEXT_DIST_DIR=.next-preview ./node_modules/.bin/next start -p 3112
# http://localhost:3112 — tidak menunggu kompilasi halaman seperti next dev.
```

Data preview dapat dirapikan dengan `node --import tsx scripts/prepare-demo.ts`
(dry-run), lalu tambahkan `--apply` untuk menerapkan. Script hanya menerima DB
lokal `data/ops.db` dan membuat backup di `data/backups/`. Sesuai keputusan
pengguna, preview dibatasi menjadi **5 project**: **2 Lengkap, 2 Sebagian,
1 Belum Diisi**. Project lain disembunyikan dengan soft delete. Setiap demo
memiliki anggota, 25 checklist, serta laporan/issue/review sesuai skenarionya;
gambar berlabel **ILUSTRASI DEMO**. Rerun memvalidasi skenario dan tidak
menggandakan atau menimpa laporan existing.

Preview lokal menyimpan **5 user: Bob, Admin demo, Manager, Corporate, Crew**.
Akun pengujian dibuang; crew lintas divisi digabungkan ke Crew dengan relasi
tetap valid. Akun Bob beserta kredensial dan sesinya dipertahankan.

Seed dasar untuk database baru/pengujian menyediakan lima akun berikut
(password `OpsDemo2026!`). Preview lokal memakai Bob sebagai pengganti akun
multi-divisi; password Bob tidak diubah.

| Role | Email |
|---|---|
| admin | `admin@ops.test` |
| corporate | `corporate@ops.test` |
| manager | `manager@ops.test` |
| user (crew) | `crew@ops.test` |
| user (multi-divisi) | `multi@ops.test` |

Login menyediakan tautan **Daftar** (`/register`). Pendaftar memilih satu dari
19 divisi dan selalu menjadi **User (Crew), nonaktif, menunggu aktivasi**.
Admin dapat mengaktifkan semua akun melalui **User & aktivasi**; Manager hanya
dapat mengaktifkan/nonaktifkan dan mengedit nama, email, serta telepon crew yang
divisi utamanya dikelola Manager tersebut. Manager tidak dapat mengedit Admin,
Corporate, Manager, role, divisi, atau password. Akun pending tidak mendapat
sesi dan tidak dapat login; penonaktifan mencabut sesi yang sudah ada.

## Environment variables

| Variabel | Wajib | Default | Catatan |
|---|:-:|---|---|
| `DATABASE_PATH` | – | `./data/ops.db` | Di produksi: di luar repo |
| `UPLOADS_DIR` | – | `./uploads` | §10.1: pakai volume terpisah di produksi |
| `SESSION_SECRET` | ✅ | – | `openssl rand -hex 32` |
| `AUTH_CLIENT_IP_HEADER` | – | tidak dipercaya | Header IP tunggal yang ditimpa reverse proxy; port Next harus privat. Contoh `x-ops-client-ip` diisi proxy dari alamat koneksi, bukan header klien. Header forwarding lain diabaikan. |
| `APP_URL` | – | `http://localhost:3000` | Untuk link absolut (PDF) |

## Perintah

```bash
pnpm dev            # dev server
pnpm build && pnpm start   # produksi
pnpm typecheck      # tsc --noEmit
pnpm test           # Vitest (377 test)
npx playwright test # otomatis menjalankan server/DB/uploads sementara di :3113

pnpm db:generate    # buat migrasi baru setelah mengubah schema
pnpm db:migrate     # terapkan migrasi
pnpm db:seed        # seed data demo (idempotent)
pnpm disk:check     # pemakaian disk & jumlah foto (§10.1)
```

Playwright default memakai seed baru pada folder sementara dan `.next-e2e`,
sehingga project/user hasil tes tidak masuk lagi ke database preview. Server
dan folder sementara dibersihkan setelah selesai. `E2E_BASE_URL` adalah override
eksplisit untuk server yang sudah berjalan; tes akan mengubah database server
yang ditunjuk, jadi gunakan hanya server uji terpisah.

Halaman **Project**, **Hari Ini**, dan **Issues** mencari otomatis saat mengetik
(jeda 250 ms), tanpa tombol Submit. Issues juga mempunyai pilihan project yang
bisa dicari berdasarkan nama/kode. Pencarian mempertahankan filter status dan
severity, serta tetap dibatasi oleh hak akses server.

## Struktur

```
src/
  app/                 # routes (Next.js App Router)
    master/            # /master/checklist-items, /master/templates, kategori
    projects/          # list, wizard (/projects/new), detail (tab)
  components/          # UI (AppShell, BottomNav, AuthForm, master/*)
  server/
    db/schema.ts       # Drizzle schema — sumber kebenaran §11
    db/migrations/     # SQL migrasi
    permissions.ts     # SEMUA aturan akses §2 — satu tempat
    visibility.ts      # query visibilitas §11.7 (satu implementasi)
    auth/              # password, session, rate limit, service
    services/          # checklist-items, templates, categories, projects,
                       # project-checklist, members, reports, photos,
                       # day-context, issues, reports-review
  lib/
    datetime.ts        # util timezone & deadline (pure, teruji)
    drafts.ts          # draft IndexedDB (§4.3 no.8)
    image-compression.ts  # kompresi foto di client (§8.2)
  app/api/photos/      # upload + serve foto terautentikasi
  app/print/           # halaman print khusus PDF (day, project)
  server/pdf/render.ts # Chromium + queue 1 job (§7.5)
e2e/                   # Playwright
```

## Keputusan implementasi yang menyimpang dari PRD

| Hal | PRD | Implementasi | Alasan |
|---|---|---|---|
| Hashing password | argon2id atau bcrypt cost 12 | **scrypt** (N=2^16, r=8, p=1) | Modul argon2 butuh native build di setiap target deploy. scrypt memory-hard & built-in Node. Format hash menyimpan parameter, jadi bisa di-upgrade otomatis saat login. |
| Kategori checklist | "Kelola master ... & kategori" (manager ✅ divisinya) | **Admin only** | Kategori dipakai lintas divisi; item global pun hanya Admin yang boleh membuat. Konsisten dengan aturan item. |
| Template & divisi | Manager ✅ | Manager hanya bisa membuat template untuk divisinya; template **global** hanya Admin | Mencegah manager membuat aset yang terlihat semua divisi. |
| Rate limit login | 5x / 15 menit | In-memory Map | Satu proses server tunggal (§10). **Harus pindah ke DB/Redis jika scale-out.** |
| Transaksi | Semua write dalam transaction | Dipakai, tapi **sinkron** | `better-sqlite3` tidak mendukung transaksi async; `db.transaction(async …)` akan gagal. |

## Backup & restore (§9.2)

Backup wajib karena semua data (termasuk foto) menetap di VPS sampai fitur arsip dikerjakan (§10.2 ditunda).

```bash
# DB: SQLite backup konsisten (aman saat aplikasi berjalan)
sqlite3 data/ops.db ".backup '/backup/ops-$(date +%F).db'"

# Foto: sync harian
rsync -a uploads/ /backup/uploads/

# Restore
systemctl stop ops
cp /backup/ops-2026-11-02.db data/ops.db
rsync -a /backup/uploads/ uploads/
systemctl start ops
```

Di produksi, gunakan **Litestream** untuk replikasi kontinu ke S3-compatible storage.

## Deploy (ringkas)

Panduan VPS yang dipakai: [`deploy/README.md`](deploy/README.md). Deployment
native memakai service systemd khusus Ops, port loopback `4215`, dan vhost Nginx
terpisah untuk `pulse.provaliantgroup.com`. Kode diambil dari commit GitHub;
setelah import pertama, database/uploads pada VPS menjadi sumber utama dan
tidak boleh ditimpa data lokal saat update. Backup dan rollback tersedia.

Runtime produksi dipatch ke Next.js 15.5.28 / React 19.0.9, Drizzle 0.45.2,
Zod 4.6.6, dan PostCSS 8.5.23; dependency produksi lolos audit tanpa advisori
pada persiapan deployment. `pnpm` dipin 12.8.1 dengan izin build native eksplisit.

1. **Penting:** mount `uploads/` sebagai volume terpisah (§10.1) agar disk bisa di-upgrade tanpa migrasi.
2. Jalankan `pnpm db:migrate` sebagai langkah rilis sebelum aplikasi start.
3. Set `NODE_ENV=production` — cookie menjadi `Secure` (butuh HTTPS, disediakan Caddy).
4. **Jangan** jalankan `db:seed` di produksi (membuat akun demo dengan password publik).
5. Pantau disk: alert > 70% dan > 85% (§10.1). Pada volume default, VPS penuh ~2 bulan.

Endpoint `/api/health` tersedia tanpa login dan memeriksa koneksi database.
Untuk PDF produksi, set `PDF_RENDER_ORIGIN` ke origin loopback port aplikasi;
request PDF hanya mengirim cookie sesi Ops ke origin tersebut, dan menolak
subresource/redirect ke origin lain.

## Master data (M2)

| Route | Role | Isi |
|---|---|---|
| `/master/checklist-items` | admin, manager | CRUD item checklist per fase & kategori |
| `/master/checklist-categories` | admin | Kategori checklist |
| `/master/templates` | admin, manager | Template: manual, duplikat, dari project |
| `/master/issue-categories` | admin | Kategori issue |

Aturan penting yang sudah ditegakkan di server:
- Item **tidak pernah dihapus permanen** — hanya dinonaktifkan (§5.1). Menonaktifkan item master tidak mengubah checklist project yang sudah ada.
- Manager hanya bisa mengelola item/template **divisinya**; item & template global hanya Admin.
- Memindahkan item antar divisi hanya Admin.
- Template tidak boleh merujuk item dari divisi yang tidak bisa dilihat user.

## Project (M3)

| Route | Role | Isi |
|---|---|---|
| `/projects` | semua (terfilter §2.2) | List project |
| `/projects/new` | admin, manager | Wizard 5 langkah |
| `/projects/[id]` | terlihat | Tab: Hari ini · Hari · Checklist · Member · Settings |

Aturan yang ditegakkan di server:
- **Kode project** otomatis (`EVT-2026-0012`), unik, bisa diedit.
- **Project days** dibuat dari rentang tanggal. Saat tanggal diedit: rentang melebar → hanya INSERT hari baru; rentang menyempit → hari **tanpa data** dihapus, hari **yang sudah punya laporan/issue/foto/review dipertahankan** dan ditandai `is_out_of_range`. Tanggal tidak bisa diubah saat project `completed`/`archived`.
- **Snapshot checklist** disalin ke `project_checklist_items`; item master diubah setelahnya tidak memengaruhi project.
- **Mengubah checklist project tidak mengubah laporan yang sudah submit.** Baris yang sudah punya `report_check_results` di-*freeze* (tetap aktif), bukan dihapus.
- **Member** dihapus secara soft (`is_active=0`) agar laporan lama tetap punya penulis. `lead` = Head Crew yang boleh submit opening/closing (§4.6).
- Status `completed`/`archived` read-only; membuka kembali wajib alasan.

## Crew flow (M4)

| Route | Role | Isi |
|---|---|---|
| `/` | semua | Card project hari ini: status fase, badge terlambat, issue terbuka (§4.2) |
| `/projects/[id]/days/[date]/opening` | Head Crew / petugas / manager / admin | Form opening |
| `/projects/[id]/days/[date]/monitoring` | semua member | Form monitoring (berulang) |
| `/projects/[id]/days/[date]/closing` | Head Crew / petugas / manager / admin | Form closing + handover |

Aturan yang ditegakkan **di server**:
- **1 opening & 1 closing per project per hari** — dijaga oleh partial unique index di database, bukan hanya di UI.
- **Idempotensi**: setiap submit membawa `client_submission_id`; double tap / retry jaringan tidak membuat laporan ganda.
- **Submit atomik**: laporan + hasil checklist + link foto ditulis dalam satu transaksi sinkron (`better-sqlite3` tidak mendukung transaksi async). Diuji dengan trigger yang memaksa gagal di akhir transaksi.
- **Validasi**: item wajib harus dijawab; "Tidak OK" wajib catatan; item `requires_photo` wajib ≥ 1 foto.
- **`is_late`** dihitung sekali saat submit memakai zona waktu project, lalu disimpan permanen (§13.2).
- **Foto**: MIME dicek dari magic bytes (bukan header), maks 15 MB per file, **tanpa batas jumlah foto**, di-re-encode ke WebP oleh `sharp` dan **seluruh EXIF/GPS dibuang**. Serving lewat `/api/photos/[id]` dengan cek visibilitas project.
- **GPS opsional** (§8.5): timeout 5 detik, tidak pernah menghalangi submit.
- **Draft** tersimpan di IndexedDB tiap perubahan dan dipulihkan saat form dibuka lagi.

## Issues (M5)

| Route | Role | Isi |
|---|---|---|
| `/issues` | semua (terfilter §2.2) | List + filter status & severity |
| `/issues/new` | member / manager / admin | Form issue (+ prefill dari item "Tidak OK") |
| `/issues/[id]` | terlihat | Detail + **timeline append-only** + ubah status + komentar |

Aturan yang ditegakkan **di server**:
- **Kode unik** per project: `EVT-2026-0012-I-007` (§9.5 no.8).
- **Snapshot identitas**: nama, role, dan divisi disimpan saat posting, sehingga riwayat tetap benar walau user berganti nama/role/divisi atau dinonaktifkan (§9.5 no.2). Ada test khusus untuk ini.
- **Timeline append-only**: `issue_updates` hanya di-INSERT. Tidak ada API update/delete untuk tabel ini — ada test yang memastikan modul tidak mengekspor helper semacam itu.
- **Diff field**: setiap perubahan menyimpan `{field: [lama, baru]}`, tampil di UI sebagai "Severity: — → high".
- **Status**: crew hanya bisa maju ke *In Progress* / *Resolved*; **hanya Manager/Admin yang bisa Closed dan Reopen** (§2.3). Reopen dari `closed` hanya Manager/Admin.
- **Foto wajib ≥ 1** saat membuat issue (§4.7); foto harus milik pengunggah dan dari project yang sama.
- **Soft delete** hanya Manager/Admin, alasan wajib, tercatat di audit log dan tampil sebagai "Dihapus — alasan" (§9.5 no.6).
- **Carry-over**: issue yang belum Closed tampil di form fase hari berikutnya, diurutkan berdasarkan severity (critical dulu).

## Report & Review (M6)

| Route | Role | Isi |
|---|---|---|
| `/reports` | manager, corporate, admin | Tabel project × tanggal: opening, monitoring, closing, checklist %, issue, review (§7.1) |
| `/reports/day/[id]` | terlihat | Timeline 1 hari + panel review (§7.2) |
| `/dashboard` | manager, corporate, admin | Angka hari ini + "Butuh perhatian" (§7.3) |

Aturan yang ditegakkan **di server**:
- **Mark as Reviewed** hanya Manager divisi, Corporate, atau Admin. **Un-review** boleh oleh pihak yang sama tetapi **wajib alasan** dan tercatat di audit log (§13.1, Q14).
- **Review mengunci edit laporan.** Setelah `reviewed_at` terisi, form crew menjadi read-only dengan penjelasan. Ada E2E yang membuktikan ini lintas role.
- **Checklist %** dihitung dari hasil yang benar-benar dijawab hari itu, bukan dari checklist project saat ini — jadi persentase historis tidak berubah saat checklist diedit kemudian (§5.3 no.5).
- **Seluruh jawaban checklist tampil per laporan** (opening, setiap monitoring, closing), termasuk kategori dan catatan; NOT_OK paling atas dan disorot merah. Klik judul checklist untuk meringkas; tautan "Lihat seluruh checklist project" membuka daftar semua fase, termasuk item yang belum dijawab.
- Klik thumbnail pada report, galeri, atau detail issue untuk membuka foto penuh di modal. Gunakan panah sebelumnya/berikutnya, keyboard ←/→, dan tutup lewat ×/Escape/backdrop. Gambar penuh baru dimuat saat modal dibuka.
- Kartu severity dashboard dan hitungan issue terbuka dapat diklik. Critical adalah severity; Open → In Progress → Resolved → Closed adalah status penanganan. Status diperbarui di detail issue sesuai hak akses, dan dashboard/report ikut diperbarui.
- **Komentar reviewer terlihat oleh crew** (bukan komentar internal — itu untuk mode klien di PDF, §7.5).
- Filter `belum lengkap` / `ada issue High-Critical` / `belum direview` dihitung di server.

## Export PDF (M7)

Tombol **Export PDF** ada di Detail Hari (laporan harian) dan tab Settings project (rekap).

Isi PDF: header (nama project, klien, venue, tanggal, kode), ringkasan angka, checklist opening & closing (**NOT_OK disorot, diurutkan paling atas**), monitoring, issue (kode, severity, status, next step, PIC, pembuat), foto grid 3 kolom dengan caption, serta status review + nama reviewer.

Opsi: **sertakan foto** (ya/tidak) dan **mode klien** (menyembunyikan komentar internal & catatan audit).

Batas sumber daya yang ditegakkan (penting untuk VPS 4 GB):
- **1 job PDF pada satu waktu** — request berikutnya menunggu, bukan error. Diuji: 4 job paralel → maksimum 1 Chromium hidup, 4 launch, 4 dispose.
- **Timeout 120 detik**; browser **selalu** ditutup di `finally`, termasuk saat timeout atau error, agar proses Chromium tidak menumpuk.
- `--no-sandbox --disable-dev-shm-usage` (kontainer biasanya memberi /dev/shm hanya 64 MB).
- **Maks 31 hari** per PDF rekap; di luar itu ditolak dengan pesan jelas.
- PDF dikirim sebagai data URL lalu disimpan browser — tidak ada file PDF yang menetap di disk VPS (§10.1).

Halaman `/print/*` adalah route **terautentikasi biasa**: Chromium meneruskan cookie pemanggil, sehingga otorisasi identik dengan aksi yang meminta export. Crew mendapat 404 pada route print dan tidak melihat tombol export.

## Catatan keamanan

- Semua checkbox akses ditegakkan di server via `server/permissions.ts` dan `requireUser()` — bukan hanya disembunyikan di UI (§9.3).
- Cookie sesi hanya menyimpan **hash** token, sehingga bocornya database tidak menghasilkan sesi yang bisa dipakai.
- Reset password oleh Admin & penonaktifan user **langsung** membatalkan semua sesi aktif.
- Pesan gagal login bersifat generik agar tidak membocorkan keberadaan email.
- Registrasi email duplikat mendapat hasil publik yang sama, tanpa mengubah akun lama.
- Rate limit registrasi: 5/15 menit per IP proxy terpercaya; tanpa konfigurasi
  proxy, gunakan pool bersama 20/15 menit. Batas seluruh proses 100/15 menit,
  dihitung sebelum hashing; cache dibatasi dan kedaluwarsa. Seperti login,
  limiter in-memory harus dipindah ke penyimpanan bersama jika memakai beberapa proses.
