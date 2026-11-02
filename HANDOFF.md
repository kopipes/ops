# Handoff — Ops (Next.js event-monitoring PWA)

**Written:** 2 Nov 2026 (updated 3 Nov 2026 — E2E suite fully green, 4 app bugs fixed; see §3.1).
**Purpose:** resume work cleanly in a new session without re-deriving context.

Read this first, then `docs/PRD-Ops.md` (the source of truth for product rules) and `README.md` (run/deploy instructions).

---

## 1. What this project is

**Ops** — a mobile-first PWA for monitoring daily event execution by field crews.
Per event day there are three phases: **Opening** → **Monitoring** (repeatable) → **Closing**.
Managers/Corporate review days via a Report page and dashboard.

Stack: Next.js 15 (App Router) · TypeScript · Tailwind · SQLite (`better-sqlite3`) + Drizzle · Zod · headless Chromium for PDF.

### Milestone status

| Milestone | Status |
|---|---|
| M1 Foundation (schema, auth, permissions, seed, shell) | ✅ done |
| M2 Master data (checklist items, categories, templates) | ✅ done |
| M3 Project (wizard, members, snapshot, days) | ✅ done |
| M4 Crew flow (opening/monitoring/closing, photos, drafts, GPS) | ✅ done |
| M5 Issues (CRUD + append-only timeline) | ✅ done |
| M6 Report & Review (daily list, day detail, dashboard, review) | ✅ done |
| M7 Export PDF (daily + recap, client mode) | ✅ done |
| **Post-M7 scope (current work)** | **⚠️ in progress — see §3** |
| M8 Hardening (Lighthouse, CI, disk alert) | ⬜ not started |
| Archive + purge VPS (§10.2) | ⬜ deferred by user's decision |

---

## 2. Current verified state

Last confirmed before handoff:

- `tsc --noEmit` → **clean**
- `vitest run` → **351 tests passing, 13 files**
- `next build` → **succeeds**
- Migrations: **3** (`0000`, `0001`, `0002`) — all applied to the local dev DB
- Routes: 29 pages (see §5)
- E2E: **9 spec files, 66 tests — 66/66 green, verified twice back-to-back.**

### Local run

```bash
cp .env.example .env          # then set SESSION_SECRET
pnpm install                  # if node_modules missing
./node_modules/.bin/tsx src/server/db/migrate.ts   # apply migrations
./node_modules/.bin/tsx src/server/db/seed.ts      # demo data
./node_modules/.bin/next dev -p 3111
```

Demo logins (password `OpsDemo2026!` for all):
`admin@ops.test`, `corporate@ops.test`, `manager@ops.test`, `crew@ops.test`, `multi@ops.test` (multi-division).

**Environment gotchas (this machine):**
- `pnpm run <script>` fails due to an ignored-build-scripts gate → invoke binaries directly: `./node_modules/.bin/vitest`, `next`, `playwright`, `tsc`, `tsx`.
- `better-sqlite3` was compiled with explicit SDK flags. If it breaks, rebuild with:
  `SDK=$(xcrun --show-sdk-path) CXXFLAGS="-isysroot $SDK -I$SDK/usr/include/c++/v1" CFLAGS="-isysroot $SDK" pnpm dlx node-gyp@10 rebuild` inside the package dir.
- Playwright browsers are installed at `~/Library/Caches/ms-playwright`.
- **Migrations do not auto-apply in dev** — after `drizzle-kit generate`, run `migrate.ts` or you get `no such column` errors.

---

## 3. Where the session stopped

The user asked to build several groups at once:

**Group A (launch blockers) — all implemented:**
- ✅ A1 `/admin/users` — CRUD, roles, divisions, reset password, deactivate (`src/server/services/admin.ts` + `src/app/admin/users/page.tsx`)
- ✅ A2 `/admin/divisions` — CRUD (`/admin/divisions`)
- ✅ A3 Report edit UI + revisions — `src/server/services/report-edits.ts`, `/reports/edit/[id]`, writes `report_revisions`, shows "Diedit oleh…" and version history
- ✅ A4 Chromium deploy — `Dockerfile` (installs ONLY chromium + its libs), `src/app/api/health/route.ts`

**Small PRD promises:**
- ✅ #6 Camera vs gallery — two buttons, `capture="environment"` for camera, `source` recorded
- ✅ #5 PWA — `public/sw.js` + `public/offline.html` + `src/components/PwaRegister.tsx` (registered in root layout, production only)

**Deferred items the user chose to BUILD anyway:**
- ✅ D1 Upload retry queue — `src/lib/upload-queue.ts` (IndexedDB-persisted, exponential backoff, idempotent via `client_upload_id`)
- ✅ D2 `/admin/audit` — filters by user/entity/action/date (`src/server/services/audit.ts`)
- ✅ D3 `/admin/settings` — global default windows + timezone, feeds the project wizard (`src/server/services/app-settings.ts`)

**Also added this session (late request):** `reports.phase_note` — a narrative shown *after* the checklist for opening and closing ("Laporan Awal Hari" / "Laporan Akhir Hari"), kept separate from `notes` and from `project_days.handover_note`.

### 3.1 RESOLVED — the previously-failing E2E suite

The prior session left 3 red tests in `e2e/admin-edit.spec.ts`. They are fixed, and the
investigation uncovered **four real application bugs** plus several test-side defects.
Full details and root causes are in §9. Summary of what was actually wrong (the earlier
guesses in this file were incomplete):

1. **Saving a report edit returned HTTP 500 for real users.** `EditReportForm` used
   `useActionState`; when the edit page was reached by an in-app link, the action ran
   without a request scope and `cookies()` (via `requireUser`) threw
   `cookies was called outside a request scope`. Reachable only via client-side
   navigation, which is exactly the normal user path. Fixed by calling the action
   directly and navigating with `window.location` (the pattern `ReportForm` already used).
2. **§13.1 review lock was bypassable.** `canEditReport` returned `true` for
   manager/admin *before* checking `dayReviewedAt`, so a reviewed day stayed editable —
   contradicting "satu kali review menutup edit untuk semua laporan". Now the review lock
   is checked first; un-review still reopens editing. Regression tests added.
3. **"Today" was computed in UTC, not project time.** The wizard's date default, the
   `/reports` date filter, and the dashboard's "today" query all used
   `new Date().toISOString()`. For a WIB (UTC+7) team this is wrong every day between
   17:00–24:00 UTC: the wizard pre-filled yesterday, `/reports` showed an empty list, and
   the dashboard missed the current day. All three now use the project/default timezone.
4. **`applyReportEdit` matched photos across reports.** The `requires_photo` check looked
   up `report_check_results` by `project_checklist_item_id` alone, so it could read
   another day's row (and its photos). Latent — no collisions in the current DB — but it
   would silently pass validation as data grows. Now scoped by `report_id`.

Test-side defects fixed (these were *not* app bugs, keep them in mind):
- **Hydration race** — clicking client-component buttons before React attached was a
  silent no-op. Added `waitForHydration()` in `e2e/helpers.ts`; used before the first
  click on a client-rendered form.
- **UTC vs project-date in specs** — `today()` was `toISOString()`; moved to
  `e2e/helpers.ts` and now resolves in `Asia/Jakarta` to match the app.
- **Over-loose `input[type="file"]`** — each card has two pickers (camera + gallery);
  three specs needed `.first()`.
- **Ambiguous `/Catatan /` selector** — also matched "Catatan umum"; now targets the
  per-item `aria-label`.
- **Second `login()` in the same cookie jar** — `/login` redirects to `/` while the
  admin session is live; use a fresh context.
- **Cross-file settings pollution** — `admin-edit.spec.ts` set the global opening window
  to 05:30 and never restored it, so `projects.spec.ts` (which asserts 06:00) failed by
  order. The test now restores 06:00.

**Verification:** `tsc` clean, `vitest` 351/351, `next build` OK, E2E **66/66 twice in a
row**.

---

## 4. Architectural rules — do not violate

These were established deliberately and are enforced by tests. Breaking them re-introduces bugs already fixed.

1. **All access rules live in `src/server/permissions.ts`.** Never re-implement a visibility check inline. Pages call `requireUser()`; actions re-check.
2. **Project visibility has ONE implementation:** `src/server/visibility.ts` (`visibleProjectIds`). It uses `EXISTS` subqueries — the original draft used a `JOIN` that fanned out duplicate rows. A regression test guards this.
3. **`better-sqlite3` transactions are SYNCHRONOUS.** `db.transaction(async …)` silently commits outside the transaction. Multi-statement writes use `raw.transaction(() => { … })` with **no `await` inside**. Used in: report submit, report edit, issue timeline.
4. **One opening + one closing per project per day** is enforced by a partial unique index in the schema (not just app logic):
   `UNIQUE(project_day_id, phase) WHERE phase IN ('opening','closing') AND deleted_at IS NULL AND status='submitted'`
5. **Editing a project's checklist must never alter submitted reports.** `syncProjectChecklist` deactivates (never deletes) and **freezes** rows referenced by `report_check_results`.
6. **`issue_updates` and `report_revisions` are append-only.** No update/delete API exists; a test asserts the module does not export one.
7. **Identity is snapshotted** onto issues and timeline rows (`author_name`, `author_role`, `author_division`) so renames/deactivations don't rewrite history.
8. **`is_late` is computed once at submit** from the window in force then, in the project's timezone, and stored permanently.
9. **Photos are unlimited** (§8.1). Only a 15 MB per-file cap. Never add a count quota.
10. **There are no hard deletes** for reports/issues/photos/comments — soft delete + reason + audit log.
11. **PDF rendering is single-job** (`src/server/pdf/render.ts`): concurrency 1, 120 s timeout, browser closed in `finally`. Print routes are normally authenticated and receive the caller's cookie.

---

## 5. Codebase map

```
src/
  app/
    page.tsx                  Home "Hari Ini" cards (§4.2)
    login/, me/, me/password/
    projects/                 list, new (wizard), [id] (tabs), [id]/days/[date]/{opening,monitoring,closing}
    issues/                   list, new, [id] (timeline)
    reports/                  list (§7.1), day/[id] (drill-down + review), edit/[id]
    dashboard/                §7.3
    master/                   checklist-items, checklist-categories, templates (+new, [id]), issue-categories
    admin/                    users, divisions, settings, audit
    print/                    day/[id], project/[id]   ← rendered into PDFs
    api/photos/route.ts       upload (magic-byte validated, sharp re-encode, EXIF stripped)
    api/photos/[id]/route.ts  authenticated serving with project-visibility check
    api/health/route.ts
    *-actions.ts              server actions (auth, project, report, issue, review, pdf, admin, settings, edit)
  components/                 AppShell, BottomNav, AuthForm, PwaRegister,
                              crew/, project/, issues/, review/, pdf/, master/, admin/
  server/
    permissions.ts            ← every access rule
    visibility.ts             ← the only project-visibility query
    db/{schema.ts,index.ts,migrate.ts,seed.ts,migrations/}
    auth/{index,password,session,rate-limit,current-user}.ts
    services/                 admin, app-settings, audit, categories, checklist-items,
                              day-context, issues, members, photos, project-checklist,
                              projects, report-edits, reports, reports-review, templates
    pdf/render.ts             Chromium + queue
  lib/                        datetime, schemas (all Zod), drafts, image-compression,
                              upload-queue, print/shared
e2e/                          auth, master-data, projects, crew, issues, reports, pdf, admin-edit
```

---

## 6. Deviations from the PRD (intentional, documented in README)

| Area | PRD says | We do | Why |
|---|---|---|---|
| Password hashing | argon2id or bcrypt 12 | **scrypt** (N=2^16) | No native build needed; params stored per-hash so it auto-upgrades |
| Rate limiting | 5 / 15 min | In-memory map | Single-process deployment; **must move to DB if scaling out** |
| Checklist categories | Manager ✅ divisinya | **Admin only** | Categories aren't division-scoped; keeps global items consistent |
| Templates | Manager ✅ | Manager may only create **division-scoped**; global = Admin | Avoid publishing assets to all divisions |
| Report edit window | §13.1 | Reviewed-day OR H+1 12:00, server-computed | Implemented in `permissions.canEditReport` |

---

## 7. Known gaps (not bugs — scoped out)

- **`/projects/[id]/days/[date]`** page from §12 doesn't exist as such; day detail lives at `/reports/day/[id]`.
- **Issue-edit UI** missing. `updateIssueFields` is implemented + tested, but no form to edit title/severity/PIC after creation.
- **Photo lightbox / swipe** in day detail — thumbnails only.
- **Issue timeline inline** in day detail — issues link out to their own page.
- **Project checklist editor UI** — the Checklist tab is read-only; `syncProjectChecklist` supports editing.
- **Excel export**, watermark, full offline submit, issue analytics — phase 2.
- **M8**: Lighthouse ≥85, E2E in CI, disk-alert email (§10.1), backup runbook tested.

---

## 8. Verification commands

```bash
./node_modules/.bin/tsc --noEmit                  # must be clean
./node_modules/.bin/vitest run                    # currently 351 passing
./node_modules/.bin/next build                    # routes must build

# E2E (needs dev server on :3111 AND a seeded DB)
./node_modules/.bin/next dev -p 3111
./node_modules/.bin/playwright test               # full suite: 66 tests
./node_modules/.bin/playwright test e2e/pdf.spec.ts   # slow: launches Chromium
```

**Note:** E2E mutates the dev DB and grows it (project codes are timestamp-derived to avoid unique clashes). If tests get slow or odd, reset:
```bash
rm -f data/ops.db* && ./node_modules/.bin/tsx src/server/db/migrate.ts && ./node_modules/.bin/tsx src/server/db/seed.ts
```
(`pnpm db:reset` points at `src/server/db/reset.ts`, which does **not** exist — use the two commands above.)

**Timing gotcha:** the suite is timezone-sensitive on purpose. `e2e/helpers.ts`'s `today()`
resolves in `Asia/Jakarta`; the app does the same. If you change either side, change both.

---

## 9. Session log of notable bugs found (avoid re-introducing)

| Bug | Impact | Guarded by |
|---|---|---|
| Visibility query used JOIN → duplicate project rows | Wrong/fanned results | `visibility.test.ts` |
| `db.transaction(async …)` doesn't work with better-sqlite3 | Non-atomic writes | atomicity test with a forced trigger failure |
| Print pages returned nested `<html>` | React hydration error on every PDF page | print layout approach (content-only pages) |
| **Project checklist doubled on creation** (`combined = [...rows, ...customRows]` from the same fields) | Every project had 2× items since M3 | 3 regression tests in `projects.test.ts` |
| `syncProjectChecklist` only matched `bySource[key][0]` | Duplicates could never be collapsed | duplicate-collapse pass + tests |
| Severity sorted alphabetically | `medium, low, high, critical` | explicit CASE rank in carry-over query |
| PIC validation required exactly one value | Issue creation failed when PIC empty | `issueInputSchema` refine |
| Issue categories never seeded | Issue form unusable on fresh install | `seed.ts` |
| `applyReportEdit` re-validated `requires_photo` | Editing a photo-bearing item was impossible | existing-photo lookup in `report-edits.ts` |
| E2E random 4-digit project codes collided | Flaky CI | `uniqueCode()` helper in specs |
| Double `login()` in one cookie jar | Flaky timeouts | separate browser contexts |
| **`useActionState` + client-side nav → `cookies()` outside request scope** | Editing a report 500'd for real users reaching the page via an in-app link | `EditReportForm` calls the action directly; `window.location` navigates |
| **`canEditReport` returned `true` for manager/admin before the review check** | A reviewed day stayed editable, violating §13.1 | 2 regression tests in `permissions.test.ts` |
| **"Today" computed with `toISOString()` (UTC) in wizard / `/reports` / dashboard** | Wrong date for non-UTC teams between 17:00–24:00 UTC | `toLocalDate` in all three; `e2e/helpers.ts` matches |
| `applyReportEdit` photo lookup keyed on item id only (no `report_id`) | Latent cross-report photo match could satisfy `requires_photo` | scoped by `report_id` |
| E2E clicked client components before hydration | Silent no-op → confusing timeouts | `waitForHydration()` in `e2e/helpers.ts` |
| E2E `input[type="file"]` matched both camera + gallery pickers | `strict mode violation` | `.first()` in crew/pdf/reports specs |
| `admin-edit.spec.ts` left the global opening window at 05:30 | `projects.spec.ts` failed by execution order | test restores 06:00 |

---

## 10. Suggested next steps

1. ~~Finish `e2e/admin-edit.spec.ts`, then run the FULL E2E suite twice~~ — **done**. 66/66 green on two consecutive runs (§3.1).
2. Decide on the remaining gaps in §7 — particularly the **issue-edit UI** (small, high value) and the **project checklist editor** (already supported server-side).
3. **M8 Hardening**: CI workflow running typecheck + vitest + playwright; Lighthouse check; disk-usage alert (`scripts/disk-check.ts` already exists — needs a cron + mail relay).
4. Update `README.md` + this handoff as decisions land. Keep `docs/PRD-Ops.md` honest: if something is deliberately not built, amend the PRD rather than leaving a false promise.
5. **PRD consistency (§13.1):** the bullet list says both "review menutup edit untuk semua" *and* "Manager/Admin bisa edit kapan saja (tercatat)". They conflict. The code currently treats review as absolute (un-review is the explicit reopen path). Amend the PRD to say so, or change the rule deliberately.
6. **`pnpm db:reset` is broken** — the script points at `src/server/db/reset.ts`, which does not exist. Either add the file or drop the script.
