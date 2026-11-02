# PRD — **Ops** (Event Monitoring App)

> Versi: 1.5 (draft) · Tanggal: 2 Nov 2026 · Owner: Provaliant Group
> Changelog 1.1: opening/closing 1x per hari oleh Head Crew/petugas, foto kamera+galeri, GPS opsional, login email+password, tanpa notifikasi, Export PDF masuk MVP, manager bisa input issue, traceability penuh.
> Changelog 1.2: Corporate read-only + review; hosting di VPS.
> Changelog 1.3: nama aplikasi ditetapkan **Ops**.
> Changelog 1.4: perbaikan konsistensi skema & aturan — query visibilitas §11.7 (EXISTS, hapus fan-out), soft delete pada `reports`, partial unique index diperjelas (draft dikecualikan), `users.must_change_password`, aturan regenerasi `project_days` saat tanggal project diedit, aturan edit/review §13.1 + `is_late` §13.2, batas 1 job PDF (§7.5), penomoran Q diperbaiki (Q10a/Q14), **tanpa batas jumlah foto** (§8.1).
> Changelog 1.5: **anggaran storage §10.1** (alert disk 70%/85%, volume `uploads/` terpisah) masuk MVP. **Arsip project + purge VPS (§10.2) DITUNDA** ke fase berikutnya — skema, route, dan aksi terkait dilepas dari MVP. Q13 kembali "tanpa batas" selama arsip belum ada.
> Dokumen ini ditulis agar bisa langsung dieksekusi oleh developer / AI coding agent. Bagian bertanda **[ASUMSI]** adalah keputusan default yang boleh diubah; bagian **Open Questions** (§17) perlu dijawab sebelum/selama development.

---

## 1. Ringkasan

**Ops** adalah aplikasi web mobile-first (PWA) untuk memantau jalannya event harian oleh crew di lapangan. Setiap hari event terdiri dari 3 fase:

| Fase | Kapan | Isi |
|---|---|---|
| **Opening** | Pagi, saat event dibuka | Checklist opening + issues + foto |
| **Monitoring** | Kapan saja sepanjang hari (bisa berkali-kali) | Laporan pemantauan, checklist opsional, issues + foto |
| **Closing** | Malam, saat event ditutup | Checklist closing + issues + foto |

Manager/Corporate dapat mereview kegiatan harian dengan cepat lewat halaman Report: ringkasan per hari → drill-down ke detail crew, checklist, foto, dan issues.

### 1.1 Tujuan
1. Standarisasi pengecekan opening & closing event di semua project/divisi.
2. Semua temuan (issues) tercatat lengkap: foto, next step, PIC, status sampai selesai.
3. Review harian oleh atasan bisa dilakukan **< 2 menit per project per hari**.
4. Aplikasi cepat & ringan di HP dengan sinyal venue yang sering buruk.

### 1.2 Non-Goals (MVP)
- Bukan aplikasi ticketing / manajemen tamu event.
- Bukan project management penuh (Gantt, budgeting).
- Tidak ada native app (iOS/Android) — cukup PWA yang bisa di-"Add to Home Screen".
- Tidak ada notifikasi (email/WhatsApp/push) — status cukup terlihat di dalam app (badge terlambat, issue critical, dashboard "Butuh perhatian").

---

## 2. Persona & Role

| Role | Siapa | Ringkas hak akses |
|---|---|---|
| **Admin** | IT / Super admin | Semua: user, divisi, master data, semua project |
| **Corporate** | Manajemen pusat / direksi | **Read-only semua project & report** di semua divisi, bisa comment & mark reviewed **[KEPUTUSAN]** |
| **Manager** | Kepala divisi / PM | Kelola project & checklist template di divisinya, assign member, review report, update issues |
| **User (Crew)** | Crew lapangan | Isi opening/monitoring/closing, buat & update issues, upload foto pada project yang ia jadi member |

### 2.1 Divisi user
- Setiap user punya **1 divisi utama** (wajib) dan **0..n divisi tambahan** (cross-division).
- Divisi menentukan project mana yang bisa **dilihat**.
- Keanggotaan project (member) menentukan project mana yang bisa **diisi laporannya**.

### 2.2 Aturan visibilitas project
User dapat **melihat** project jika salah satu benar:
1. Role = Admin atau Corporate, atau
2. User adalah member project, atau
3. Salah satu divisi user (utama/tambahan) ∈ divisi project (owner division + additional divisions project).

User dapat **mengisi laporan (submit)** jika:
- **Monitoring & issue**: member project aktif, **atau** Manager dari divisi project, **atau** Admin.
- **Opening & closing**: petugas hari itu / Head Crew (`lead`), **atau** Manager dari divisi project, **atau** Admin (§4.6).

User dapat **mengelola project** (edit, member, checklist) jika:
- Admin, atau Manager yang salah satu divisinya = owner division project.

### 2.3 Permission Matrix

| Aksi | Admin | Corporate | Manager | User |
|---|:-:|:-:|:-:|:-:|
| Kelola user & divisi | ✅ | ❌ | ❌ | ❌ |
| Kelola master checklist item & kategori | ✅ | ❌ | ✅ (divisinya) | ❌ |
| Kelola checklist template | ✅ | ❌ | ✅ | ❌ |
| Buat / edit project | ✅ | ❌ | ✅ (divisinya) | ❌ |
| Assign member | ✅ | ❌ | ✅ (divisinya) | ❌ |
| Lihat project | Semua | Semua | Divisinya + member | Divisinya + member |
| Submit opening & closing (1x per hari) | ✅ | ❌ | ✅ | ✅ hanya Head Crew / petugas hari itu |
| Submit monitoring | ✅ | ❌ | ✅ | ✅ (member) |
| Buat issue | ✅ | ❌ | ✅ | ✅ (member) |
| Update status issue / tambah follow-up | ✅ | ❌ | ✅ | ✅ (member, termasuk PIC) |
| Close issue | ✅ | ❌ | ✅ | ❌ **[ASUMSI]** crew hanya bisa set "Resolved", manager yang "Closed" |
| Lihat report harian | Semua | Semua | Divisinya | Project-nya sendiri |
| Mark day as Reviewed + comment | ✅ | ✅ | ✅ | ❌ |
| Export PDF report | ✅ | ✅ | ✅ | ❌ |

---

## 3. Konsep Data Utama (Glossary)

- **Division** — unit organisasi.
- **Project** — satu event (contoh: "Pameran X di JCC, 10–14 Des"). Punya tanggal mulai–selesai, venue, divisi, member.
- **Event Day** — satu tanggal di dalam rentang project. Di-generate otomatis dari start–end date.
- **Phase** — `opening` | `monitoring` | `closing`.
- **Checklist Item (master)** — item library, misal "Lampu booth menyala semua". Punya fase, kategori, wajib/tidak, wajib foto/tidak.
- **Checklist Template** — kumpulan item master yang siap dipakai (misal "Template Pameran Standar").
- **Project Checklist** — salinan (snapshot) item yang dipilih untuk sebuah project. Perubahan master **tidak** mengubah histori project.
- **Report (Submission)** — satu laporan fase oleh satu user pada satu event day.
- **Check Result** — jawaban per item checklist: `OK` | `NOT_OK` | `NA` + catatan + foto opsional.
- **Issue** — temuan masalah, punya severity, next step, PIC, status, foto, riwayat follow-up. Issue terbuka **terbawa ke hari berikutnya** sampai ditutup.

---

## 4. User Flow

### 4.1 Login
- Login dengan **email + password** **[KEPUTUSAN]**; session cookie berlaku 30 hari (crew tidak perlu login ulang tiap hari, cukup buka app).
- "Lupa password" → reset oleh Admin (Admin set password sementara, user wajib ganti saat login berikutnya).
- Setelah login, landing ke **Home "Hari Ini"**.

### 4.2 Home "Hari Ini" (Crew)
Menampilkan project aktif hari ini milik user, masing-masing sebagai card:

```
┌──────────────────────────────────────┐
│ Pameran Otomotif — JCC Hall A        │
│ Hari ke-3 dari 5 · Senin, 2 Nov      │
│                                      │
│ ✅ Opening    08:12 oleh Budi        │
│ 🟡 Monitoring 2 laporan              │
│ ⚪ Closing    belum                  │
│ 🔴 3 issue terbuka (1 High)          │
│                                      │
│ [ + Laporan Monitoring ]             │
└──────────────────────────────────────┘
```
- Tombol utama berubah sesuai waktu: pagi → "Isi Opening", siang → "+ Monitoring", malam → "Isi Closing". Semua fase tetap bisa diakses kapan saja.
- Jika window opening sudah lewat dan belum diisi → badge merah "Terlambat".

### 4.3 Opening (pagi)
1. Crew tap "Isi Opening".
2. Tampil daftar checklist fase opening, dikelompokkan per kategori.
3. Tiap item: tombol besar **OK / Tidak OK / N/A** (tap target ≥ 44px).
   - Jika **Tidak OK** → wajib isi catatan singkat; muncul tombol **"Jadikan Issue"** (prefill issue dari item ini) **[ASUMSI: opsional, bukan otomatis]**.
   - Jika item `requires_photo = true` → wajib upload minimal 1 foto.
4. Bagian bawah: catatan umum + foto umum (opsional, bisa multi foto).
5. Bagian Issues: daftar issue terbuka dari hari sebelumnya (carry-over, bisa langsung di-update) + tombol "+ Issue Baru".
6. Progress bar di atas: "12/15 item".
7. **Submit** → validasi item wajib → tersimpan dengan timestamp server & waktu lokal device.
8. Draft tersimpan otomatis (local) setiap perubahan, jadi kalau app tertutup / sinyal hilang tidak hilang.

### 4.4 Monitoring (siang, kapan saja, berulang)
1. Tap "+ Laporan Monitoring".
2. Form: waktu (default sekarang), observasi/catatan (wajib singkat), foto (multi), checklist monitoring (hanya muncul jika project punya item fase monitoring), issues.
3. Bisa submit berkali-kali per hari; tiap submit = 1 entry di timeline.

### 4.5 Closing (malam)
Sama seperti Opening dengan checklist fase closing. Tambahan:
- Ringkasan otomatis: issue yang dibuat hari ini, yang masih terbuka.
- Field "Catatan untuk besok" (handover) **[ASUMSI]** → tampil di Opening hari berikutnya.

### 4.6 Siapa yang mengisi Opening/Closing? **[KEPUTUSAN]**
- Opening & Closing: **tepat 1 laporan per project per hari**, diisi oleh **Head Crew** (member dengan role `lead`) atau orang yang **ditugaskan** untuk hari tersebut.
- Penugasan per hari: di tab Kalender project, Manager/Head Crew bisa memilih **petugas hari itu** (`project_days.assigned_user_id`). Jika kosong → semua Head Crew project berhak mengisi.
- Yang berhak submit opening/closing: petugas hari itu, Head Crew, Manager divisi project, Admin. Crew biasa melihat form ini dalam mode baca.
- Jika laporan opening/closing hari itu sudah ada, tombol berubah menjadi "Lihat / Edit" (tidak bisa membuat laporan kedua). Server menegakkan `UNIQUE(project_day_id, phase)` untuk opening & closing.
- Monitoring & issue tetap bisa ditambahkan oleh **semua member** dan Manager, berkali-kali.

### 4.7 Issue
Field issue:
| Field | Tipe | Wajib |
|---|---|---|
| Judul | text (max 120) | ✅ |
| Deskripsi | textarea | ❌ |
| Kategori | pilihan master (Teknis, Kebersihan, Keamanan, Vendor, Tamu, Lainnya) | ✅ |
| Severity | Low / Medium / High / Critical | ✅ (default Medium) |
| Next step / action plan | textarea | ✅ |
| PIC | user (member project) atau teks bebas (vendor luar) | ❌ |
| Target selesai | datetime | ❌ |
| Foto | multi, min 1 **[ASUMSI: wajib minimal 1 foto]** | ✅ |
| Fase & laporan asal | otomatis | — |
| Item checklist asal | otomatis jika dibuat dari "Tidak OK" | — |

**Siapa yang bisa membuat issue:** Crew (member), **Manager**, dan Admin — di fase mana pun (opening, monitoring, closing) maupun langsung dari halaman Issues / Detail Hari tanpa harus membuat laporan dulu. Manager yang sedang mereview juga bisa langsung menambah issue dari halaman Detail Hari.

**Identitas pembuat selalu terlihat** di setiap issue (card & detail): avatar/inisial, nama, role, divisi, dan waktu posting — contoh: *"Diposting oleh Rina S. · Manager · Divisi Event · Sen 2 Nov, 13:47"*. Lihat §9.5 untuk aturan trace lengkap.

Status lifecycle:
```
OPEN → IN_PROGRESS → RESOLVED → CLOSED
  ↑______________________________|  (reopen oleh manager)
```
- Setiap perubahan status / follow-up = 1 **issue update** (catatan + foto opsional + user + waktu) → membentuk timeline issue.
- Issue yang belum CLOSED tampil di semua fase hari berikutnya ("Issue terbawa").

### 4.8 Report & Review (Manager / Corporate)
Lihat §7.

---

## 5. Master Data & Checklist Template

### 5.1 Master Checklist Item
- Field: label, deskripsi/petunjuk (opsional), fase (`opening`/`monitoring`/`closing`), kategori, `is_required`, `requires_photo`, divisi (null = global), aktif/nonaktif, urutan.
- Item **tidak dihapus permanen** jika pernah dipakai — hanya dinonaktifkan (soft delete).
- Kategori checklist juga master (misal: Listrik & Lighting, Kebersihan, Keamanan, Booth, AV/Sound, Signage, F&B).

### 5.2 Checklist Template
- Template = nama + deskripsi + daftar item (per fase) + urutan + override required/photo.
- Cara membuat template:
  1. **Manual**: pilih item dari master.
  2. **Dari project lama**: tombol "Simpan checklist project ini sebagai template" → semua project checklist item dicopy jadi template (item custom project ikut dibuatkan master item baru, ditandai asal project).
- Template bisa diduplikasi & diedit.

### 5.3 Memilih Checklist saat membuat Project (wizard)
Langkah 3 pada wizard project (lihat §6.1):
1. Pilih sumber: **Template** (dropdown, bisa pilih >1 → di-merge, duplikat dihilangkan) / **Copy dari project sebelumnya** (search project) / **Kosong**.
2. Tampil daftar item hasil sumber, tab per fase (Opening | Monitoring | Closing), semua tercentang default.
3. Manager bisa: uncheck item, drag untuk urutan, tambah item dari master (search), atau **tambah item custom** (hanya untuk project ini; opsi "simpan juga ke master").
4. Saat disimpan → disalin ke `project_checklist_items` (snapshot).
5. Checklist project masih bisa diedit selama project berjalan; perubahan berlaku untuk laporan **berikutnya**, laporan yang sudah submit tidak berubah.

---

## 6. Project Management

### 6.1 Wizard Buat Project (Admin/Manager)
1. **Info dasar**: kode project (auto, misal `EVT-2026-0012`, bisa diedit), nama, klien, venue, alamat, tanggal mulai–selesai, deskripsi.
2. **Divisi**: owner division (wajib, default divisi utama pembuat) + additional divisions (opsional, untuk cross-division visibility).
3. **Checklist**: lihat §5.3.
4. **Member**: pilih user (search by nama/email, filter divisi). Default filter: user dari divisi project; bisa juga pilih user dari divisi lain (cross division). Role dalam project: `lead` / `crew`.
5. **Pengaturan jadwal** (opsional, default dari settings global):
   - Window opening (default 06:00–11:00)
   - Window closing (default 17:00–23:59)
   - Tipe hari: `loading_in` / `event` / `loading_out` per tanggal **[ASUMSI: opsional]**
6. Review & Simpan → status `active` (atau `draft` jika disimpan sebagai draft).

### 6.2 Status Project
`draft` → `active` → `completed` → `archived`
- `completed` otomatis H+1 setelah end date (bisa manual). Project completed: read-only kecuali update issue yang masih terbuka.

### 6.3 Halaman Project Detail
Tab: **Hari ini** · **Kalender/Hari** · **Issues** · **Galeri Foto** · **Checklist** · **Member** · **Settings**.

---

## 7. Report & Review

### 7.1 Halaman Report (list harian)
Filter: rentang tanggal (default hari ini), divisi, project, status (belum lengkap / ada issue critical / belum direview).

Tampilan tabel/card per **project × tanggal**:

| Project | Tanggal | Opening | Monitoring | Closing | Checklist OK | Issue (baru/terbuka) | Review |
|---|---|---|---|---|---|---|---|
| Pameran Otomotif | 2 Nov | ✅ 08:12 | 3 | ✅ 22:05 | 96% | 2 / 3 🔴 | ⏳ |

Indikator warna:
- Opening/closing: ✅ tepat waktu · 🟠 terlambat · ❌ tidak diisi.
- Issue Critical/High terbuka → row ditandai merah.

### 7.2 Halaman Detail Hari (drill-down)
Satu halaman scroll vertikal, urut waktu (**timeline**):
1. Header: project, tanggal, ringkasan angka (checklist %, jumlah foto, issue baru/terbuka/selesai), handover catatan hari sebelumnya.
2. **Opening**: siapa, jam submit, checklist (item NOT_OK ditampilkan paling atas & berwarna merah, item OK bisa di-collapse), foto (grid thumbnail, tap → lightbox swipe).
3. **Monitoring entries** berurutan waktu.
4. **Closing**.
5. **Issues hari ini**: card per issue dengan foto, next step, PIC, status, timeline update.
6. **Galeri semua foto hari itu** (filter per fase).
7. Panel review: tombol **"Mark as Reviewed"** + kolom komentar (komentar terlihat oleh crew).

Tujuan desain: reviewer cukup scroll sekali, fokus ke anomali (NOT_OK, terlambat, issue High/Critical).

### 7.3 Dashboard (Manager/Corporate)
- Kartu angka hari ini: project aktif, opening terisi/total, closing terisi/total, issue terbuka (per severity), hari belum direview.
- List "Butuh perhatian": project yang opening terlambat/belum, issue Critical terbuka, issue lewat target.

### 7.4 Halaman Issues (global)
- List semua issue yang bisa dilihat user, filter status/severity/project/divisi/PIC/tanggal, sort by severity & umur.

### 7.5 Export PDF (MVP) **[KEPUTUSAN]**
- **PDF laporan harian** per project — tombol "Export PDF" di Detail Hari.
- **PDF rekap project** (semua hari dalam rentang tanggal yang dipilih) — tombol di halaman project.
- Isi PDF: header (logo Provaliant, nama project, klien, venue, tanggal, petugas), ringkasan angka, checklist opening & closing (NOT_OK disorot), monitoring entries, daftar issue (kode, severity, status, next step, PIC, pembuat), foto dalam grid 2–3 kolom dengan caption (fase, waktu, pengunggah), status review + nama reviewer.
- Opsi saat export: **sertakan foto** (ya/tidak), **mode klien** (sembunyikan komentar internal & catatan audit).
- Implementasi: render halaman HTML khusus print → PDF via **Playwright/Chromium headless** di server (hasil konsisten, mendukung font & gambar). Foto pakai versi 1280px agar ukuran PDF wajar.
- **Batas sumber daya [ASUMSI]**: hanya **1 job PDF pada satu waktu** per instance (in-memory queue / semaphore). Request berikutnya menunggu dengan status "menyiapkan…" di UI (bukan error). Chromium dijalankan dengan `--no-sandbox --disable-dev-shm-usage` dan context yang di-dispose setelah dipakai. Timeout job 120 detik → gagal dengan pesan jelas, bukan menggantung.
- Batas isi: maks 1 hari per PDF harian, maks 31 hari per PDF rekap; di luar itu → tawarkan rentang lebih kecil.
- Excel (daftar issue & rekap checklist) → fase berikutnya.

---

## 8. Foto — Upload & Kompresi

### 8.1 Pengambilan foto
- **Kamera langsung dan galeri sama-sama diizinkan [KEPUTUSAN].** UI menampilkan dua tombol: "📷 Ambil Foto" (`capture="environment"`) dan "🖼️ Dari Galeri" (`multiple`). Sumber foto (`camera`/`gallery`) dicatat, dan `taken_at` dari EXIF ditampilkan supaya reviewer tahu kapan foto diambil.
- **Tidak ada batas jumlah foto [KEPUTUSAN]** — tidak per item, tidak per laporan, tidak per hari. Crew boleh melampirkan sebanyak yang dibutuhkan.
- Implikasi teknis yang wajib diimplementasikan (karena tanpa cap):
  - Upload bersifat **streaming per foto** (§8.4), bukan menunggu semua terpilih; UI tidak boleh memblokir saat 40+ foto dipilih.
  - Batas yang berlaku hanya **per file**: tolak > 15 MB per file (§8.3) dan validasi magic bytes.
  - Grid/galeri **wajib lazy-load thumbnail** (`loading="lazy"`, virtualized list untuk galeri hari) — jangan render semua foto ke DOM.
  - Counter foto di UI bersifat informatif ("24 foto"), **bukan** validasi.
  - PDF export (`includePhotos`) memakai thumbnail/1280px + paginasi bertahap; bila hasil melebihi batas aman, tawarkan mode "tanpa foto" atau filter per fase (§7.5).
  - Pantau kuota disk (§10.1) — lihat Q9 dan Q13 untuk sizing/retensi.

### 8.2 Kompresi di client (sebelum upload)
- Library: `browser-image-compression` (Web Worker, tidak membekukan UI).
- Aturan:
  - Perbaiki orientasi EXIF terlebih dahulu.
  - Resize sisi terpanjang **maks 1920 px** (cukup tajam untuk zoom di layar & PDF).
  - Format output **WebP quality 0.82**; fallback **JPEG quality 0.85** jika browser tidak mendukung encode WebP.
  - Jika file asli sudah ≤ 1920px dan ≤ 400 KB → tidak di-recompress.
  - Target rata-rata **250–600 KB/foto** (dari 3–8 MB asli) tanpa artefak terlihat.
- Simpan `taken_at` dari EXIF (DateTimeOriginal) sebelum metadata dibuang; jika tidak ada, pakai waktu pilih.

### 8.3 Proses di server
- Validasi MIME (magic bytes), tolak > 15 MB.
- Re-encode dengan `sharp` (strip semua metadata EXIF/GPS — privasi), simpan:
  - `original` (hasil kompres, maks 1920px)
  - `thumb` 400px WebP q 0.7 (~20–40 KB) untuk list & grid
- Penamaan: `/uploads/{yyyy}/{mm}/{uuid}.webp` dan `{uuid}_thumb.webp`.
- Serve dengan header `Cache-Control: public, max-age=31536000, immutable`, tapi tetap lewat auth check (signed URL berumur pendek atau route terproteksi session) **[ASUMSI: route terproteksi]**.
- Watermark: tidak di MVP (bisa ditambah nanti).

### 8.4 Upload robust
- Upload foto **langsung setelah dipilih** (background), bukan menunggu submit → submit jadi cepat.
- Antrian upload di IndexedDB dengan retry otomatis (exponential backoff) saat sinyal hilang.
- Indikator per foto: menunggu / mengupload % / berhasil / gagal (tap untuk retry).
- Submit laporan ditahan sampai semua foto terupload, dengan pesan jelas.

### 8.5 Lokasi (GPS) — opsional, tidak wajib **[KEPUTUSAN]**
- Saat membuka form laporan, app meminta izin lokasi **sekali** (`navigator.geolocation`, timeout 5 detik, tidak memblokir form).
- Jika diizinkan & tersedia → simpan lat/lng + akurasi di laporan; tampil di detail hari sebagai "📍 terekam (±25 m)" dengan link ke Google Maps.
- Jika ditolak / tidak tersedia / timeout → laporan tetap bisa submit normal, tampil "📍 lokasi tidak tersedia". **Tidak pernah** menghalangi submit.
- GPS dari EXIF foto tidak dipakai (metadata dibuang demi privasi & ukuran).

---

## 9. Kebutuhan Non-Fungsional

### 9.1 Performa
- First load di HP mid-range 4G: **< 2.5 s**; navigasi antar halaman **< 300 ms** (client-side routing + data cache).
- Bundle JS halaman crew < 200 KB gzip.
- List & report hanya memuat thumbnail; full image lazy-load saat lightbox.
- Pagination / infinite scroll untuk list > 50 item.
- Query report harian < 200 ms untuk 100 project × 30 hari (indexed).

### 9.2 Robustness
- Draft form auto-save ke IndexedDB setiap perubahan; dipulihkan saat app dibuka lagi.
- Setiap submit membawa **idempotency key (UUID dari client)** → submit ganda karena retry tidak membuat data dobel.
- SQLite mode **WAL**, `busy_timeout = 5000`, `foreign_keys = ON`, semua write dalam transaction.
- Backup: **Litestream** replikasi kontinu ke S3-compatible storage (atau minimal `sqlite3 .backup` tiap jam + harian ke storage terpisah). Folder `uploads/` di-sync harian.
- Error tracking (Sentry atau log file terstruktur) + endpoint `/healthz`.
- Audit log untuk aksi penting (login, create/edit project, ubah status issue, review, hapus).

### 9.3 Keamanan
- Password hash **argon2id** (atau bcrypt cost 12).
- Session cookie `HttpOnly`, `Secure`, `SameSite=Lax`; CSRF protection pada form mutation.
- Rate limit login (5x gagal / 15 menit per email+IP).
- Semua akses data dicek di server berdasarkan aturan §2.2 (jangan hanya sembunyikan di UI).

### 9.4 UX / UI
- Mobile-first, satu tangan: tombol aksi utama di bawah (sticky bottom bar), tap target ≥ 44px.
- Gaya modern & simple: banyak whitespace, kartu, warna status konsisten (hijau OK, oranye terlambat/medium, merah NOT_OK/high/critical, abu belum).
- Dark mode mengikuti sistem.
- Bahasa UI: **Bahasa Indonesia** (string dipusatkan di file i18n agar mudah ditambah English).
- Zona waktu: **Asia/Jakarta** default; disimpan UTC di DB, ditampilkan lokal; setting timezone per project (untuk event di WITA/WIT) **[ASUMSI]**.
- PWA: nama aplikasi **"Ops"** (name & short_name di manifest, judul tab, splash), installable, icon, offline shell (app tetap terbuka saat sinyal hilang).
- Aksesibilitas dasar: kontras cukup, label pada input, tidak bergantung warna saja (pakai ikon + teks).

### 9.5 Traceability & Audit Trail (wajib jelas)
Prinsip: **setiap data bisa dijawab "siapa, kapan, apa yang berubah, dari mana"** — dan jawabannya terlihat di UI, bukan hanya di database.

1. **Pembuat & waktu di semua entitas** — report, check result, issue, issue update, foto, komentar, review menyimpan `created_by` + `created_at` (waktu server) dan ditampilkan di UI dengan nama, role, divisi, serta jam.
2. **Snapshot identitas** — saat posting, simpan juga `author_name`, `author_role`, `author_division` (snapshot), supaya trace tetap benar walau user kemudian pindah divisi/berganti role/dinonaktifkan.
3. **Riwayat issue append-only** — setiap aksi pada issue (dibuat, edit field, ganti status, ganti PIC/severity/target, tambah foto, komentar) menjadi satu baris di `issue_updates` yang **tidak bisa diedit/dihapus**. Untuk perubahan field disimpan diff `{field: [nilai_lama, nilai_baru]}`. Tampilan timeline di detail issue, contoh:
   - *13:47 · Rina S. (Manager, Event) membuat issue · Severity High · PIC: Budi*
   - *14:10 · Budi (Crew, Production) ubah status Open → In Progress · "Teknisi vendor sudah dihubungi" · 2 foto*
   - *16:32 · Budi ubah status → Resolved*
   - *19:05 · Rina S. ubah status → Closed*
4. **Riwayat edit laporan** — jika laporan opening/monitoring/closing diedit setelah submit, tampil label "Diedit oleh X, jam Y" dan tombol "Lihat riwayat" (versi sebelumnya + diff per item).
5. **Foto** — tiap foto menampilkan pengunggah, waktu upload, dan `taken_at`; foto yang sudah melekat pada laporan yang tersubmit/issue tidak bisa dihapus, hanya bisa ditandai "disembunyikan" oleh manager (tercatat).
6. **Tidak ada hard delete** untuk report, issue, foto, komentar — hanya soft delete oleh Admin/Manager dengan alasan wajib, tercatat di audit log & terlihat sebagai "Dihapus oleh X — alasan".
7. **Audit log global** (`audit_logs`) untuk aksi sistem: login/logout/gagal login, CRUD user/divisi/project/member/template, review, export. Halaman `/admin/audit` dengan filter user, entitas, tanggal.
8. **Kode unik** untuk issue (misal `EVT-2026-0012-I-007`) agar mudah dirujuk di chat/WA/meeting.
9. Waktu yang dipakai sebagai acuan adalah **waktu server**; waktu device disimpan terpisah sebagai info (untuk mendeteksi jam HP yang salah).

---

## 10. Tech Stack (rekomendasi)

| Lapisan | Pilihan | Alasan |
|---|---|---|
| Framework | **Next.js 15 (App Router) + TypeScript** | Satu codebase FE+BE, SSR cepat, ekosistem besar |
| UI | **Tailwind CSS + shadcn/ui** + lucide icons | Modern, ringan, konsisten |
| DB | **SQLite** via **better-sqlite3** | Sesuai permintaan, cepat, zero-ops |
| ORM / migrasi | **Drizzle ORM + drizzle-kit** | Type-safe, ringan, migrasi SQL jelas |
| Auth | Session table sendiri (cookie) atau **Better Auth** | Sederhana, cocok SQLite |
| Validasi | **Zod** (shared FE/BE) | |
| Data fetching | Server Actions + **TanStack Query** di client | Cache & optimistic UI |
| Offline/draft | **IndexedDB (idb-keyval / Dexie)** + Service Worker (Serwist) | Draft & antrian upload |
| Gambar | `browser-image-compression` (client), `sharp` (server) | §8 |
| Testing | Vitest (unit), Playwright (E2E mobile viewport) | |
| Deploy | **VPS [KEPUTUSAN]** (min. 2 vCPU / 4 GB RAM / 80 GB SSD) + Docker Compose + Caddy (HTTPS otomatis) + Litestream | Simpel & murah; RAM 4 GB perlu untuk Chromium (Export PDF) |

> Catatan: SQLite cocok untuk skala ini (puluhan–ratusan user aktif, satu server). Jika suatu saat butuh multi-server, migrasi ke Postgres relatif mudah karena memakai Drizzle.

### 10.1 Anggaran storage (80 GB SSD) **[ASUMSI — lihat Q9]**

Karena **tidak ada batas jumlah foto** (§8.1), disk adalah sumber daya yang paling cepat habis. Hitungan konservatif:

| Komponen | Perkiraan |
|---|---|
| Foto setelah kompresi 1920px WebP | 250–600 KB (pakai **500 KB** untuk sizing) |
| Thumbnail 400px | ~30 KB |
| Total per foto (foto + thumb) | **~0,53 MB** |
| Foto/hari (default Q9: 2.000) | **~1,06 GB/hari** |
| Skenario padat (4.000 foto/hari) | ~2,1 GB/hari |

Sisa ruang efektif = 80 GB − OS/Docker (~10 GB) − DB + WAL + Litestream (~2 GB) − PDF sementara (~2 GB) ≈ **66 GB untuk uploads**.

| Beban | Habis dalam (66 GB) |
|---|---|
| 1.000 foto/hari | ~4 bulan |
| 2.000 foto/hari (default) | **~2 bulan** |
| 4.000 foto/hari | ~1 bulan |

**Yang masuk MVP (murah, mencegah kejadian tak terduga):**
- Alert disk saat terpakai **> 70%** (email ke Admin) dan **> 85%** (banner di dashboard).
- Job harian menulis pemakaian disk + jumlah foto ke log/`app_settings` untuk melihat tren.
- `uploads/` diletakkan di **volume terpisah** (mis. `/var/ops/uploads`) agar disk bisa di-upgrade tanpa migrasi.

**Yang DITUNDA (lihat §10.2):** arsip project + purge. Tanpa itu, foto dari project yang sudah selesai **tetap menetap di VPS**. Kalau volume sesuai Q9, VPS mulai penuh sekitar **2 bulan** setelah pemakaian intensif. Alert di atas adalah jaring pengamannya sampai fitur arsip dikerjakan.

### 10.2 Arsip & purge VPS — **DITUNDA** (fase berikutnya) **[KEPUTUSAN]**

Kebutuhan produknya jelas dan sudah disepakati, tetapi **tidak dikerjakan di MVP**:

> Setelah project selesai → export **PDF rekap project** untuk pelaporan → **backup** paket arsip (data + foto + PDF) ke object storage di luar VPS → **bersihkan VPS**.

Ringkas rancangan saat nanti dikerjakan (agar tidak hilang):
- Project `completed` menjadi read-only; hanya Admin bisa `reopen` dengan alasan.
- Paket arsip `.zip`: `data.json`, `photos/` (1920px saja), `exports/`, `manifest.json` (SHA-256 per file), `README.txt`. Ukuran bisa ~30 GB untuk 30 hari × 2.000 foto → **streaming ke object storage**, jangan ke disk VPS.
- Checksum diverifikasi sebelum arsip dianggap sah.
- Purge foto hanya boleh setelah ada arsip **terverifikasi** (2 konfirmasi: nama project + checkbox backup).
- Foto = hard delete file; data transaksional = soft delete (§9.5). Yang tersisa: identitas project, pointer arsip, dan audit log.
- Butuh tabel `project_archives`, route `/admin/storage` + `/admin/projects/[id]/archive`, aksi `archive.exportBundle` / `archive.verify` / `projects.purge`.

**Konsekuensi selama ditunda:** retensi foto mengikuti Q13 (tanpa batas) dan disk VPS akan terpakai terus. Sampai fitur ini ada, backup rutin (§9.2: Litestream + sync `uploads/` harian) tetap wajib agar data project lama tidak hilang.

---

## 11. Data Model (SQLite)

Konvensi: `id` = TEXT (UUIDv7/ULID) agar bisa dibuat di client (offline-friendly); timestamp = INTEGER (unix ms, UTC); `created_at`, `updated_at` di semua tabel; soft delete via `deleted_at` / `is_active`.

### 11.1 Organisasi & User
```sql
divisions(
  id, code UNIQUE, name, is_active, created_at, updated_at)

users(
  id, name, email UNIQUE, phone NULL, password_hash,
  role CHECK(role IN ('admin','corporate','manager','user')),
  primary_division_id → divisions.id,
  must_change_password BOOLEAN DEFAULT 0,      -- reset oleh Admin (§4.1)
  is_active, last_login_at, created_at, updated_at)

user_divisions(               -- termasuk divisi utama, agar query visibilitas cukup 1 join
  user_id → users.id, division_id → divisions.id,
  is_primary BOOLEAN,
  PRIMARY KEY(user_id, division_id))

sessions(id, user_id, expires_at, user_agent, ip, created_at)
```

### 11.2 Master Checklist & Template
```sql
checklist_categories(id, name, sort_order, is_active)

checklist_items(
  id, label, description NULL,
  phase CHECK(phase IN ('opening','monitoring','closing')),
  category_id, division_id NULL,        -- NULL = global
  is_required, requires_photo,
  source_project_id NULL,               -- jika dibuat dari item custom project
  is_active, sort_order, created_by, created_at, updated_at)

checklist_templates(
  id, name, description, division_id NULL,
  source_project_id NULL, created_by, is_active, created_at, updated_at)

checklist_template_items(
  template_id, checklist_item_id, sort_order,
  is_required_override NULL, requires_photo_override NULL,
  PRIMARY KEY(template_id, checklist_item_id))
```

### 11.3 Project
```sql
projects(
  id, code UNIQUE, name, client NULL, venue, address NULL, description NULL,
  start_date TEXT(YYYY-MM-DD), end_date TEXT,
  timezone DEFAULT 'Asia/Jakarta',
  owner_division_id,
  status CHECK(status IN ('draft','active','completed','archived')),
  opening_window_start TEXT('06:00'), opening_window_end TEXT('11:00'),
  closing_window_start TEXT('17:00'), closing_window_end TEXT('23:59'),
  created_by, created_at, updated_at)

project_divisions(project_id, division_id, PRIMARY KEY(...))   -- additional divisions

project_members(
  project_id, user_id, role_in_project CHECK IN ('lead','crew'),
  is_active, added_by, created_at, PRIMARY KEY(project_id, user_id))

project_days(
  id, project_id, date TEXT, day_type CHECK IN ('loading_in','event','loading_out') DEFAULT 'event',
  assigned_user_id NULL,                       -- petugas opening/closing hari itu (§4.6)
  handover_note NULL,
  reviewed_by NULL, reviewed_at NULL,
  UNIQUE(project_id, date))
-- project_days dibuat otomatis dari projects.start_date..end_date saat project disimpan (§11.3)
-- Aturan saat tanggal project DIEDIT (sumber bug paling umum, wajib diimplementasikan):
--   1) Perpanjang end_date / majukan start_date  → INSERT hari baru saja (idempotent, ON CONFLICT DO NOTHING).
--   2) Persempit tanggal → hari yang keluar rentang:
--        - jika hari itu BELUM punya laporan (semua status) & belum reviewed → boleh HARD DELETE.
--        - jika SUDAH punya laporan/issue/foto/review → TIDAK dihapus; tandai
--          is_out_of_range = 1 (tetap tampil di Report dengan badge "di luar rentang").
--   3) Penghapusan hari yang punya laporan hanya oleh Admin, tercatat di audit log.
--   4) Perubahan tanggal pada project berstatus 'completed'/'archived' ditolak; harus di-reopen dulu.
-- Tambahan kolom: is_out_of_range BOOLEAN DEFAULT 0

project_checklist_items(          -- SNAPSHOT
  id, project_id, source_item_id NULL,
  phase, category_name, label, description NULL,
  is_required, requires_photo, sort_order, is_active,
  created_at, updated_at)
```

### 11.4 Laporan
```sql
reports(
  id, project_id, project_day_id, phase,
  submitted_by, client_submission_id UNIQUE,   -- idempotency
  status CHECK IN ('draft','submitted'),
  notes NULL, observed_at,                     -- waktu kejadian (monitoring)
  submitted_at NULL, is_late BOOLEAN,
  device_time_offset_ms NULL,
  latitude NULL, longitude NULL, location_accuracy_m NULL,  -- opsional (§8.5)
  deleted_at NULL, deleted_by NULL, delete_reason NULL,     -- soft delete (§9.5 #6)
  created_at, updated_at)
-- index: (project_day_id, phase), (submitted_by, submitted_at)
-- partial unique: UNIQUE(project_day_id, phase)
--   WHERE phase IN ('opening','closing') AND deleted_at IS NULL AND status = 'submitted'
-- catatan: draft tidak ikut unik, agar draft monitoring/opening yang ditinggal tidak memblokir
-- catatan: observed_at = waktu yang DILAPORKAN user (bisa diedit, client time);
--           created_at/submitted_at = waktu server (sumber kebenaran traceability §9.5)

report_check_results(
  id, report_id, project_checklist_item_id,
  result CHECK IN ('ok','not_ok','na'),
  note NULL, created_at,
  UNIQUE(report_id, project_checklist_item_id))
```

### 11.5 Issues
```sql
issue_categories(id, name, sort_order, is_active)

issues(
  id, code,                                  -- misal EVT-2026-0012-I-007
  project_id, project_day_id, phase,
  report_id NULL, check_result_id NULL,
  title, description NULL, category_id,
  severity CHECK IN ('low','medium','high','critical'),
  status CHECK IN ('open','in_progress','resolved','closed'),
  next_step, pic_user_id NULL, pic_external NULL, due_at NULL,
  created_by, author_name, author_role, author_division,   -- snapshot identitas (§9.5)
  resolved_by NULL, resolved_at NULL,
  closed_by NULL, closed_at NULL,
  deleted_at NULL, deleted_by NULL, delete_reason NULL,
  created_at, updated_at)
-- index: (project_id, status), (status, severity), (created_by)

issue_updates(                                -- APPEND-ONLY, tidak ada UPDATE/DELETE
  id, issue_id, user_id,
  author_name, author_role, author_division,  -- snapshot
  action CHECK IN ('created','edited','status_changed','comment','photo_added','reassigned','reopened'),
  note NULL,
  status_from NULL, status_to NULL,
  changes_json NULL,                          -- {"severity":["medium","high"], "pic_user_id":[..,..]}
  created_at)

report_revisions(                             -- riwayat edit laporan setelah submit
  id, report_id, edited_by, snapshot_json, changes_json, created_at)
```

### 11.6 Foto, Review, Audit
```sql
photos(
  id,
  owner_type CHECK IN ('report','check_result','issue','issue_update'),
  owner_id,
  project_id, project_day_id,                -- denormalisasi untuk galeri cepat
  path, thumb_path, mime, width, height, size_bytes,
  source CHECK IN ('camera','gallery'), taken_at NULL,   -- §8.1
  uploaded_by, deleted_at NULL, deleted_by NULL, created_at)
-- index: (owner_type, owner_id), (project_day_id), (project_id, created_at)
-- catatan: tidak ada kolom urutan/batas — jumlah foto tak dibatasi (§8.1).
-- catatan: owner_id polimorfik → tidak bisa FK; integritas ditegakkan di application layer
--   (hapus owner ⇒ soft-delete foto; ada job rekonsiliasi orphan mingguan).

day_comments(id, project_day_id, user_id, body, created_at)

audit_logs(id, user_id, action, entity_type, entity_id, meta_json, ip, created_at)

app_settings(key PRIMARY KEY, value_json)    -- default window jam, dll (tanpa limit foto — §8.1)
```

### 11.7 Query visibilitas (contoh)
```sql
-- project yang bisa dilihat user :uid (non admin/corporate)
-- Pakai EXISTS (bukan JOIN) agar tidak terjadi row fan-out / duplikasi.
SELECT p.* FROM projects p
WHERE p.status != 'archived'
  AND (
    -- 1) member project
    EXISTS (SELECT 1 FROM project_members pm
            WHERE pm.project_id = p.id AND pm.user_id = :uid AND pm.is_active = 1)
    -- 2) divisi owner project
    OR p.owner_division_id IN (
         SELECT ud.division_id FROM user_divisions ud WHERE ud.user_id = :uid)
    -- 3) divisi tambahan project
    OR EXISTS (SELECT 1 FROM project_divisions pd
               JOIN user_divisions ud ON ud.division_id = pd.division_id
               WHERE pd.project_id = p.id AND ud.user_id = :uid)
  );
```
Implementasikan sebagai satu helper `getVisibleProjectIds(user)` di server dan pakai di **semua** query.

Aturan role (lihat §2):
- `admin` → tanpa filter (semua project).
- `corporate` → tanpa filter (read-only semua divisi, §2.3).
- `manager` / `user` → helper di atas.
- `archived`: admin/manager-divisi masih bisa melihat lewat filter eksplisit; default list menyembunyikan.

---

## 12. Halaman / Routes

| Route | Role | Isi |
|---|---|---|
| `/login` | semua | Login |
| `/` | semua | Home "Hari Ini" (crew) / Dashboard (manager, corporate, admin) |
| `/projects` | semua | List project yang terlihat, filter status/divisi |
| `/projects/new` | admin, manager | Wizard project |
| `/projects/[id]` | terlihat | Detail project (tab) |
| `/projects/[id]/days/[date]` | terlihat | Detail hari (timeline report) |
| `/projects/[id]/days/[date]/opening` | member | Form opening |
| `/projects/[id]/days/[date]/monitoring/new` | member | Form monitoring |
| `/projects/[id]/days/[date]/closing` | member | Form closing |
| `/issues` | semua | List issue global |
| `/issues/[id]` | terlihat | Detail & timeline issue |
| `/reports` | manager, corporate, admin | Report harian (§7.1) |
| `/master/checklist-items` | admin, manager | CRUD item & kategori |
| `/master/templates` | admin, manager | CRUD template |
| `/master/issue-categories` | admin | CRUD kategori issue |
| `/admin/users` | admin | CRUD user, reset password, divisi |
| `/admin/divisions` | admin | CRUD divisi |
| `/admin/settings` | admin | Default window opening/closing, timezone, dll (tanpa limit foto) |
| `/admin/audit` | admin | Audit log global, filter user/entitas/tanggal |
| `/me` | semua | Profil, ganti password, logout |

Navigasi mobile: **bottom tab bar** — Hari Ini · Project · Issues · Report (jika berhak) · Akun.

---

## 13. API / Server Actions (ringkas)

Semua mutation memvalidasi input dengan Zod + cek permission di server.

- `auth.login`, `auth.logout`, `auth.changePassword`
- `users.list/create/update/deactivate/resetPassword`
- `divisions.list/create/update`
- `checklistItems.list/create/update/deactivate/reorder`
- `templates.list/get/create/update/duplicate/createFromProject`
- `projects.list/get/create/update/setStatus`
- `projects.members.add/remove/updateRole`
- `projects.checklist.list/update` (snapshot)
- `days.get(projectId, date)` → semua data timeline 1 hari (1 query besar terstruktur)
- `reports.saveDraft`, `reports.submit({clientSubmissionId, ...})`, `reports.update` (lihat aturan edit)
- `photos.upload` (multipart, returns id + thumb url), `photos.delete` (hanya sebelum submit)
- `issues.create/update/addUpdate/changeStatus/list/get`
- `reviews.markReviewed`, `reviews.comment`
- `reports.dailySummary({from,to,divisionId?,projectId?})`
- `export.dailyPdf({projectId, date, includePhotos, clientMode})`, `export.projectPdf({projectId, from, to, includePhotos, clientMode})`

### 13.1 Aturan edit laporan **[ASUMSI — lihat Q4]**
- Pembuat laporan bisa edit laporan yang sudah submit **sampai hari tersebut direview** atau maks **H+1 jam 12:00** (zona waktu project), mana yang lebih dulu.
- "Direview" = `project_days.reviewed_at IS NOT NULL`, di-set oleh **siapa pun yang berhak review** (Manager divisi project, Corporate, Admin — §2.3). Satu kali review menutup edit untuk **semua** laporan pada `project_day` tersebut.
- Reviewer boleh **membatalkan review** (un-review) → `reviewed_at` di-NULL-kan lagi; edit kembali terbuka sesuai batas H+1 12:00. Aksi un-review tercatat di audit log beserta alasannya.
- Komentar review **tidak** membuka kembali edit (hanya `reviewed_at` yang menentukan).
- Setelah review atau lewat H+1 12:00, form menjadi read-only; perubahan hanya bisa oleh Manager/Admin (tercatat).
- Setiap edit dicatat di audit log (siapa, kapan, field apa).
- Manager/Admin bisa edit kapan saja (tercatat).
- Perhitungan batas waktu di server memakai `project_days.date` + `projects.timezone`, bukan jam client.

### 13.2 Status "terlambat" (is_late) **[ASUMSI]**
- `is_late` dihitung **saat submit** berdasarkan `opening_window_end` / closing window pada `projects` saat itu (jam server, zona waktu project), lalu **disimpan permanen** (tidak dihitung ulang saat render).
- Alasan: status historis tidak boleh berubah bila window project diedit belakangan. Kolom `is_late` ikut tercatat di audit log saat submit.
- Perubahan window berlaku hanya untuk laporan yang di-submit **setelah** perubahan disimpan. `project_days`/laporan lama tidak dihitung ulang; halaman Report menampilkan badge dari nilai tersimpan.
- Draft yang baru di-submit memakai window pada saat submit, bukan saat draft dibuat.

---

## 14. Acceptance Criteria (MVP)

**Auth & User**
- [ ] Admin bisa membuat user dengan role, email, divisi utama, dan ≥0 divisi tambahan.
- [ ] User nonaktif tidak bisa login; session lama langsung invalid.

**Master & Template**
- [ ] Admin/Manager bisa CRUD item checklist per fase & kategori.
- [ ] Bisa membuat template dari item master dan dari project yang sudah ada.
- [ ] Menonaktifkan item master tidak mengubah checklist project yang sudah ada.

**Project**
- [ ] Wizard 5 langkah bisa membuat project lengkap < 2 menit memakai template.
- [ ] Memilih 2 template sekaligus menghasilkan daftar gabungan tanpa duplikat.
- [ ] Project days ter-generate otomatis sesuai rentang tanggal.
- [ ] User divisi lain yang bukan member tidak bisa melihat project (dicek via API langsung, bukan hanya UI).
- [ ] User dengan divisi tambahan yang cocok bisa melihat project tsb.

**Crew flow**
- [ ] Crew bisa mengisi opening dengan ≤ 3 tap per item (buka → pilih → lanjut).
- [ ] Item NOT_OK wajib catatan; item `requires_photo` wajib foto.
- [ ] Draft tidak hilang saat app ditutup paksa lalu dibuka kembali.
- [ ] Hanya ada 1 laporan opening dan 1 laporan closing per project per hari; percobaan membuat yang kedua ditolak server.
- [ ] Hanya petugas hari itu / Head Crew / Manager / Admin yang bisa submit opening & closing; crew biasa hanya bisa melihat.
- [ ] Monitoring bisa disubmit berkali-kali per hari oleh semua member.
- [ ] Foto bisa diambil dari kamera maupun galeri.
- [ ] Lokasi terekam jika izin diberikan; jika ditolak, submit tetap berjalan tanpa hambatan.
- [ ] Opening setelah window berakhir ditandai "terlambat".
- [ ] Submit ganda (double tap / retry jaringan) tidak membuat laporan dobel.

**Foto**
- [ ] Foto 12 MP (~5 MB) terkompres menjadi ≤ 700 KB dengan sisi terpanjang 1920px dan tidak terlihat pecah pada zoom 100% di layar HP.
- [ ] Upload otomatis retry saat sinyal kembali; status per foto terlihat.
- [ ] Grid hanya memuat thumbnail (< 50 KB).
- [ ] **Tidak ada batas jumlah foto**: memilih 40+ foto dalam satu laporan berhasil tanpa error, tanpa memblokir UI, dan galeri tetap responsif (lazy-load/virtualized).
- [ ] File > 15 MB ditolak dengan pesan jelas; file valid berapa pun jumlahnya tidak pernah ditolak karena "kuota".

**Issue**
- [ ] Issue punya foto, next step, severity, PIC, status, timeline update.
- [ ] Issue terbuka muncul di form fase hari berikutnya.
- [ ] Crew bisa set Resolved; hanya manager/admin bisa Closed/Reopen.
- [ ] Manager bisa membuat issue dari form fase mana pun, dari halaman Issues, dan dari Detail Hari saat review.
- [ ] Setiap issue menampilkan nama, role, divisi pembuat dan waktu posting.
- [ ] Detail issue menampilkan timeline lengkap: siapa mengubah apa (nilai lama → baru), kapan, beserta foto/catatan.
- [ ] Riwayat issue tidak bisa diedit/dihapus oleh siapa pun lewat UI maupun API.
- [ ] Laporan yang diedit setelah submit menampilkan label "Diedit oleh…" dan riwayat versinya.
- [ ] Nama pembuat lama tetap tampil benar walau user sudah dinonaktifkan / pindah divisi.

**Report**
- [ ] Report list menampilkan status opening/monitoring/closing, % checklist, issue, review per project per hari.
- [ ] Detail hari menampilkan seluruh aktivitas dalam satu timeline, NOT_OK & issue High/Critical di-highlight.
- [ ] Manager bisa Mark as Reviewed + komentar; crew melihat komentar tersebut.
- [ ] Export PDF laporan harian & rekap project berhasil, foto tampil jelas, mode klien menyembunyikan komentar internal; PDF harian dengan ~30 foto < 15 MB, dan tetap selesai (mode foto diperkecil / paginasi) bila jumlah foto jauh lebih banyak.

**Non-fungsional**
- [ ] Lighthouse mobile Performance ≥ 85, PWA installable.
- [ ] Backup DB berjalan & sudah diuji restore.

---

## 15. Roadmap

| Fase | Isi | Estimasi kasar* |
|---|---|---|
| **M1 Foundation** | Setup project, DB schema & migrasi, auth, user, divisi, layout mobile, seed data | 1 minggu |
| **M2 Master data** | Kategori, checklist item, template (manual + dari project) | 0.5–1 minggu |
| **M3 Project** | Wizard, member, snapshot checklist, project days, visibilitas | 1 minggu |
| **M4 Crew flow** | Opening/Monitoring/Closing, draft, foto (kompres + upload queue) | 1.5 minggu |
| **M5 Issues** | CRUD issue, update timeline, carry-over | 0.5–1 minggu |
| **M6 Report & Review** | Report list, detail hari, dashboard, review & komentar | 1 minggu |
| **M7 Export PDF** | Template print, PDF harian & rekap project, mode klien | 0.5–1 minggu |
| **M8 Hardening** | PWA, offline shell, audit log, rate limit, backup, **alert disk (§10.1)**, E2E test | 0.5–1 minggu |
| **Berikutnya (opsional)** | **Arsip project + purge VPS (§10.2)**, Export Excel, watermark foto, full offline submit, analitik tren issue | — |

*Estimasi untuk 1 developer full-time / dibantu AI coding agent.

---

## 16. Instruksi untuk Implementer (Developer / AI Agent)

1. Kerjakan berurutan per milestone; setiap milestone selesai dengan migrasi, seed, dan test lulus.
2. Struktur folder yang disarankan:
   ```
   src/
     app/                # routes (Next.js App Router)
     components/ui/      # shadcn
     components/         # komponen domain (ChecklistItemRow, PhotoUploader, IssueCard, DayTimeline)
     server/
       db/schema.ts      # Drizzle schema (sumber kebenaran §11)
       db/migrations/
       auth/
       permissions.ts    # SEMUA aturan §2 di sini, satu tempat
       services/         # projects.ts, reports.ts, issues.ts, photos.ts ...
     lib/                # zod schemas, date/timezone utils, image compression
     i18n/id.ts
   uploads/              # di luar repo / volume Docker
   ```
3. **Semua** pengecekan akses lewat `server/permissions.ts`; buat unit test untuk tiap aturan visibilitas.
4. Seed data demo: 3 divisi, 1 user tiap role (+1 user multi-divisi), 25 item checklist contoh, 2 template, 1 project aktif dengan laporan 2 hari dan beberapa issue berfoto.
5. Gunakan transaksi untuk submit laporan (report + check results + link foto + issues) agar atomik.
6. Jangan simpan blob foto di SQLite; simpan di disk, path di DB.
7. Semua tanggal "hari event" dihitung dengan timezone project, bukan timezone server.
8. Sertakan `README.md` berisi cara run lokal, env vars, backup/restore, dan deploy.

---

## 17. Open Questions (perlu konfirmasi)

### 17.1 Sudah diputuskan
| # | Topik | Keputusan |
|---|---|---|
| Q1 | Pengisi opening/closing | 1 laporan per project per hari, oleh Head Crew atau petugas yang ditugaskan (§4.6) |
| Q3 | Login | Email + password, reset oleh Admin |
| Q5 | Sumber foto | Kamera & galeri boleh |
| Q6 | GPS / watermark | GPS opsional (direkam jika ada, tidak wajib); watermark tidak di MVP |
| Q7 | Notifikasi | Tidak diperlukan |
| Q8 | Export PDF | Masuk MVP (§7.5) |
| Q2 | Role Corporate | Read-only semua divisi + review & komentar; tidak bisa membuat/mengubah project |
| Q10 | Hosting | VPS (Docker + Caddy + Litestream), lihat §10. Domain → **Q10a** (§17.2) |

### 17.2 Masih terbuka (default sementara dipakai)
| # | Pertanyaan | Default sementara |
|---|---|---|
| Q4 | Batas waktu boleh edit laporan setelah submit? | Sampai direview atau H+1 12:00 (§13.1) |
| Q9 | Perkiraan skala: jumlah user, project aktif bersamaan, foto per hari? (untuk sizing server & storage) | ≤ 200 user, ≤ 30 project aktif, ≤ 2.000 foto/hari |
| Q10a | Domain/subdomain yang dipakai (misal `ops.provaliantgroup.com`)? | Ditentukan saat deploy |
| Q11 | Apakah setiap item checklist perlu **jawaban selain OK/Tidak OK** (angka, teks, misal "suhu ruangan 22°C")? | Hanya OK / Tidak OK / N/A + catatan |
| Q12 | Kategori & severity issue sudah sesuai, atau ada standar internal (SLA per severity)? | Default di §4.7, tanpa SLA |
| Q13 | Retensi data/foto: berapa lama disimpan setelah project selesai? | **Tanpa batas** — semua data tetap di VPS. Arsip + purge (§10.2) **ditunda**, jadi disk terus terpakai; pantau lewat alert §10.1. Backup rutin §9.2 wajib |
| Q14 | Apakah laporan yang sudah direview boleh di-un-review oleh reviewer, dan siapa yang berhak? | Boleh; Manager divisi, Corporate, Admin. Alternatif: kunci permanen (§13.1) |
