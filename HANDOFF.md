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
- `vitest run` → **376 tests passing, 15 files** (3 Nov registration follow-up)
- `next build` → **succeeds**
- Migrations: **4** (`0000`–`0003`) — all applied to the local dev DB
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

### 3.2 Desktop layout follow-up — 3 Nov 2026

Resumed the interrupted VS Code desktop work. The working tree now includes the
desktop sidebar, responsive card grids, report table, and sticky review/export
rail; these changes are still **uncommitted**.

Further fixes from browser inspection:
- Report columns were clipped at 1024px by `overflow-hidden`; the table now has
  a focusable horizontal scroll region and a minimum readable width.
- Desktop project/admin/master tabs use one row. Project tabs previously retained
  the mobile three-column grid and wrapped into two rows.
- Day summary uses three columns on smaller desktops and six on wider screens;
  dashboard stats similarly use three/six. Home/project cards stay single-column
  while the shell is still using its mobile width.
- `AppShell` accepts `contentWidth="form"` for project creation, issue creation,
  report editing, account, and global settings, limiting desktop form width.
- Wizard steps with the HTML `hidden` attribute were still displayed because
  their Tailwind `flex` class overrode it. Inactive steps now use the `hidden`
  utility while remaining mounted to preserve form values.

Verified after these fixes: TypeScript clean; 15 pages checked at 390, 768, 1024,
1280, and 1440px (75 page/viewport checks, zero failures); targeted project E2E
3/3 passing (creation plus step visibility/back navigation on mobile and desktop).
Two new wizard regression tests are in `e2e/projects.spec.ts`. Full E2E and
production build have not been rerun for this follow-up.

---

### 3.3 Preview data and loading improvements — 3 Nov 2026

- Local DB now has four visible projects: three labelled demo scenarios
  (Lengkap / Sebagian / Belum Diisi) plus the user's original **Project Apalah**.
  58 timestamp-named E2E projects were soft-deleted and audited; all their data
  and uploads remain. Pre-change SQLite backup:
  `data/backups/ops-before-demo-2026-11-03T04-59-05-184Z.db`.
- `scripts/prepare-demo.ts` is a local-only, dry-run-by-default preparation tool;
  apply with `node --import tsx scripts/prepare-demo.ts --apply`. Same-day runs
  skip existing demo project codes. It supplies 25 checklist snapshots per demo,
  members, report/checklist results, notes, handover, issue lifecycles/PICs,
  review/comments, and explicitly labelled demo evidence illustrations.
- Today: Lengkap has opening + two monitoring + closing, 100% OK, 16 photos,
  one closed issue, reviewed. Sebagian has opening (late) + one monitoring,
  83% OK, 13 photos, three non-closed issues, no closing/review. Belum Diisi
  has no submitted reports, one pending vendor issue and its evidence image.
- Home now batches days, reports, issues, and project facts rather than issuing
  a separate set of queries for every project. Visibility/permission helpers
  remain authoritative; no shared cache of authenticated data was added.
- Project/account navigation uses Next Link; a loading boundary gives immediate
  feedback. Report project-filter options now include only visible project IDs.
- Realistic fixtures exposed a pre-existing report aggregation bug: open issue
  counts/critical flags were shared across projects. Fixed and regression tested.
  Review-window tests now freeze Date.now so they remain valid after H+1 noon.
- Local browser measurements, including data reduction and code changes:
  home 167–394 ms before, 45–88 ms afterward. Production preview measurements
  across five pages: 36–120 ms, with TTFB 15–55 ms. These are local samples,
  not a network/deployment performance guarantee.
- Production preview runs at **http://localhost:3112**, independently of dev
  at :3111. Build with `NEXT_DIST_DIR=.next-preview ./node_modules/.bin/next build`;
  start with `NEXT_DIST_DIR=.next-preview ./node_modules/.bin/next start -p 3112`.
  Default production builds and Docker still use `.next`.
- Final validation: production build succeeds; TypeScript clean; **352/352**
  unit/integration tests; **50** browser checks across manager/crew/corporate
  covering fixture content, image delivery, project issue counts, permissions,
  and project navigation without a document reload. DB foreign keys and
  quick_check pass. Full E2E was not rerun because it repopulates the preview DB
  with test projects. All code changes remain uncommitted.

---

### 3.4 Windows disabled; report audit timestamps — 3 Nov 2026

User explicitly clarified that Ops is not an attendance app. Both global
`openingWindowEnabled` / `closingWindowEnabled` settings now default to false
and are persisted false in the local DB. Switches live in `/admin/settings` and
apply to all projects; no schema migration is needed (existing key/value table).
Disabled time fields need no input; previous clock values are retained for
optional re-enabling. Settings and their audit record save atomically.

Without a window, opening/closing submit never sets lateness, unfilled forms/home
show no overdue badge, wizard clock fields are hidden, project settings say
"Nonaktif — bebas jam", and report cells say "Terisi / Belum diisi". Home has
an explicit "Isi Closing" link for eligible crew so closing remains easy to
reach without a clock-based primary CTA. Historical `is_late` values remain in
the DB; lateness presentation is masked while the corresponding window is off.

Submission time remains server-generated, separate from device/observation time.
Report summary shows submitter plus seconds/timezone; crew read-only report,
day detail, report-edit/history, and daily/recap PDFs show full date/time/seconds
in the project timezone. Edit time/actor are separate for every phase, including
monitoring and PDFs; tests assert edits preserve original submitter/submission
time. The partial demo now includes an actual manager monitoring edit/revision
to demonstrate the distinction. PRD §4.2, §6.1, §7 and §13.2 reflect this decision.

Validation: production build and TypeScript pass, **360/360** unit/integration
tests, one targeted settings/wizard E2E, and **29** production-browser checks
including switches/save/reload, hidden wizard clock fields, Closing access,
submitter/timestamps on desktop/mobile, edit markers, and daily/recap print.
The browser also generated `/tmp/ops-demo-preview/report-no-window.pdf`.
Reviewer findings (Closing discoverability, summary submitter, edit metadata)
were addressed and checked. Production preview remains on :3112.

---

### 3.5 Photo modals, complete checklists, actionable Critical indicators — 3 Nov 2026

- `components/reports/PhotoGallery.tsx` is reused in report sections, daily
  galleries, report issue cards, issue detail, and issue update photos. Thumbnails
  stay lazy; the authenticated full-image endpoint is requested only when opened.
  Native dialog plus explicit Tab wrapping provides background inertness, focus
  return, Escape/close/backdrop dismissal, previous/next buttons and arrow keys.
- `ReportChecklist.tsx` shows every recorded answer initially, including OK,
  N/A, category and notes; NOT_OK comes first. Each report's native details can
  collapse the checklist. Monitoring no longer hides its OK answers. The day
  header links to the complete project checklist (including unanswered items)
  and the recorded report checklists.
- Critical is severity, separate from status. Severity cards link to unclosed
  issues for active projects; attention entries with an issue ID link directly
  to that issue. Report/home issue counts also link to their project issue list.
  Report issue cards show severity/status pills and a clear detail/action link.
- Issue list supports `open=1` (Open/In Progress/Resolved, excludes Closed) and
  `active=1` (matches dashboard's active-project scope). Existing role enforcement
  for changes/closing remains unchanged; selecting indicators only navigates.
  Status changes invalidate dashboard/report/project views as well as issue views.
- Mobile report cards use independent report and issue links (no nested anchors).
- Validation: **361** unit/integration tests pass; production build and TypeScript
  pass; the targeted report E2E covers full checklist visibility, original image,
  arrow navigation, Escape and focus return. **33** browser checks cover modal
  controls/Tab/backdrop/mobile, all 25 project items, Critical links, current
  issue status and manager/crew/corporate action visibility. Preview data remains
  four projects; the single project created by targeted E2E was soft-deleted by
  the demo cleanup tool after a new consistent SQLite backup.

---

### 3.6 Division catalog — 3 Nov 2026

- Actual DB and idempotent seed now contain the user's exact 19 divisions:
  Accounting, Creative, Event DeniHeidi, Event DesenDevy, Event Production,
  Event Sports, Finance, FutureVast, HR-GA, NTOP, Operation, Premium, Retail,
  Sacca Expo, Sacca Mall, Social Media, Starlight, Studios, Eats.
- Existing IDs and relations retained: Event Operations → Event Production,
  Site & Logistics → Operation, Creative & Production → Creative; unreferenced
  sample division renamed Accounting. Seed matches by id/code/name to reuse it.
- Backup: `data/backups/ops-before-divisions-2026-11-03T06-24-44-010Z.db`.
  Catalog update audited; foreign keys clean. Browser verified 19 choices in
  admin/project wizard, updated reports, and four visible preview projects.

### 3.7 Public registration and scoped activation — 3 Nov 2026

- Login links to `/register`. Server forces role=user, inactive, pending approval,
  one active primary division, no session; injected privileges are ignored.
  Login and every session lookup reject inactive OR pending accounts.
- Migration `0003_registration_approval.sql` adds `users.pending_approval` with
  false default, preserving existing accounts. Applied after consistent backup
  `data/backups/ops-before-registration-2026-11-03T06-32-55-684Z.db`.
- `/admin/users` plus sidebar/account links allow Admin or Manager. Admin retains
  full administration; Manager sees only crew whose primary division is in the
  Manager's current divisions, and can activate/deactivate/edit contacts only.
  Corporate, Manager and Admin targets, roles, memberships, resets and creation
  remain Admin-only. `canManageUsers` stays Admin-only to protect global settings.
- Approval clears pending and audits actor/time; deactivation revokes sessions.
  Manager writes re-read actor/target/memberships in synchronous transactions,
  so stale forms cannot act on a newly promoted Admin or with revoked privileges.
- Security review found spoofable forwarding headers and duplicate-email
  disclosure; both fixed. Only explicit `AUTH_CLIENT_IP_HEADER` is trusted;
  reverse proxy MUST overwrite it from connection IP and keep Next port private.
  Otherwise forwarded headers are ignored and registration uses a shared
  20/15min pool. Trusted IP limit 5/15min; global 100/15min before hashing;
  registration map bounded/expired. Duplicate signup has same public result and
  hashing cost as new signup, without changing an existing account.
- Validation: TypeScript and production build pass; **376/376** unit/integration
  tests pass. New browser spec `e2e/registration.spec.ts` passes on an isolated
  SQLite backup (:3113): mobile form/no overflow, 19 division options, no signup
  session, pending login denial, Manager scope, forged Admin target rejection,
  approval/contact edits via in-app navigation, Admin approval outside Manager
  scope, and revocation of a live crew session. Real sample accounts unchanged.
  Preview with the real DB remains :3112; test server stopped after verification.

---

### 3.8 Settings checkbox reset regression — 3 Nov 2026

- Reproduced the screenshot: load enabled windows, uncheck and save; database
  correctly stores false and the free-time description appears, but React 19's
  automatic action-form reset restores the original checked DOM state. A second
  save could then accidentally enable the windows again. Times/timezone could
  also revert to their initial DOM defaults.
- `SettingsForm` explicitly handles submit, snapshots FormData, and dispatches
  its action in `startTransition`. Preventing the submit's default action avoids
  React's automatic form reset while preserving pending/error/success behavior.
  Cancelling the reset event alone did not resolve the reproduced mismatch.
- `e2e/settings.spec.ts` failed on the original build and now passes on an
  isolated DB. Covers both switches, repeated save/reload, failed time validation,
  re-enabling, edited clocks/timezone, and restores the original settings.
  Production build/typecheck pass. Real DB retains both windows disabled; latest
  preview remains :3112.

---

### 3.9 Exactly five preview projects/users, isolated E2E and live search — 3 Nov 2026

- Preview had grown again because E2E defaults targeted the shared dev database:
  123 visible projects and 28 accounts were found. After user authorization,
  `prepare-demo.ts --apply` hides 120 non-curated projects, adds demos 4/5 and
  leaves **five visible projects: two complete, two partial, one unfilled**.
  Five users remain: **Bob, seed Admin, Manager, Corporate, Crew**, as explicitly
  selected by the user. Bob's credentials/sessions are retained. Removed seed
  multi-division crew references consolidate into crew; test memberships/sessions
  are removed, nullable audit references cleared, historical snapshots retained.
- Consistent backup before cleanup:
  `data/backups/ops-before-demo-2026-11-03T13-54-05-864Z.db`.
  All DB changes are transactional with exact count, role/activity, active-date,
  full/partial/empty phase distribution and FK assertions. Same-day runs preserve
  reports and fail if edited fixtures no longer match their promised scenario.
  Counts and idempotency were verified on a disposable trial backup before apply.
  Security/data integrity reviewer found no material blocker; scenario assertions
  address the one residual rerun concern.
- `playwright.config.ts` now starts `scripts/start-e2e.ts` on localhost :3113 by
  default: new temporary seeded DB/uploads, separate `.next-e2e`, cleanup on exit.
  All test fallback URLs updated to :3113. Explicit `E2E_BASE_URL` still overrides
  this and deliberately targets that server; use only isolated test servers.
- Shared `LiveSearchFilters.tsx` debounces URL query updates by 250ms, preserving
  other filters and typed text during responses. Project/Home search name, code,
  venue or client. Issues search title/code/description/project name/code before
  the result limit. Project filter options are permission-scoped and searchable;
  selection applies immediately, supports keyboard/Escape, and returns focus.
  SQL substring searches are parameterized/literal, including quotes/%/_ input.
- Validation: **377/377** unit/integration tests and production build/typecheck
  pass. Default isolated auth E2E **6/6** pass; new live search E2E passes (project
  name/code, missing/clear, Home rapid typing, issue search, project option search,
  project/status/severity/query preservation, SQL-like input, mobile overflow).

---

### 3.10 Navigation latency measured and fixed — 3 Nov 2026

- Local production HTML requests measured ~6–43ms. A DOM MutationObserver
  timed real menu content changes at **304–315ms**: the global `app/loading.tsx`
  immediately committed a skeleton and React's Suspense fallback throttle held
  ready content for ~300ms. Playwright URL/lifecycle waits initially reported
  ~800ms; use actual DOM timing when comparing perceived navigation latency.
- Removed that global loading boundary. `NavigationLink` (desktop/mobile menus)
  navigates in a transition, keeps the current screen visible, exposes a pending
  spinner/accessible status on slow requests, and disables speculative menu
  prefetch. Native modifier/target/download behavior is preserved. No cross-user
  server data cache was introduced; server permissions remain enforced.
- Post-fix production DOM measurements: Project **23/15ms**, Issues **32ms**
  (repeat cached navigation 3ms), Report **70ms**, without skeleton flashes.
- Browser also exposed service-worker registration failing because `/sw.js`
  redirected unauthenticated visitors to login. Only the public static worker
  and offline shell paths were added to the coarse middleware public list.
- Production build/typecheck pass; **9/9** scoped browser tests pass (auth,
  live search, desktop/mobile delayed navigation, keyboard and Back). Preview
  remains :3112, still five visible projects/five users. Dev :3111 was untouched.

---

### 3.11 Safe VPS deployment preparation — 3 Nov 2026

- User authorized `ssh cloudeka48` deployment, GitHub as code SOT and VPS as DB
  SOT after one local import. Correct domain confirmed: ops.provaliantgroup.com.
  User chose four distinct random demo passwords, with Bob unchanged. Imported
  local sessions are revoked and demo accounts must change password on login.
- Shared-host audit: native Nginx/systemd, Node22/pnpm12, no prior Ops service,
  new loopback4215 reserved. Dedicated ops user/paths plus full config/baseline
  backup at `/var/backups/ops-bootstrap/20261103T145236Z`. Existing services/PIDs
  and six HTTPS site statuses recorded before changes. No shared DB/port changes.
- Before internet exposure, patch Next15.5.28/React19.0.9, Drizzle0.45.2,
  Zod4.6.6 and PostCSS8.5.23. Zod optional text transforms retain previous
  omission semantics. Fix pnpm12 build policy and pin package manager12.8.1.
  Production dependency audit: zero advisories. Scope file tracing to the release.
- `deploy/` contains isolated unit/vhost/ACME templates, first-import initializer,
  compensating rollback and Linux-only mocked rollback harness. DB/uploads are
  persistent outside release; migrations explicit with backup, never ExecStart.
  Root-only password file/marker are exclusive; subsequent init is refused.
- PDF production origin fails closed to actual listener's http://127.0.0.1:PORT.
  Chromium blocks external subresources/redirects and forwards only ops_session
  on approved-origin requests; no global Cookie header or service workers.
- Validation before activation: **387** unit/integration tests, **11** scoped
  browser tests, production build/typecheck, production audit clean. Linux
  rollback simulation passes success, failed-health compensation and interrupted
  initial stop. Runtime loopback/TLS/photo/PDF/baseline checks follow GitHub push;
  live status is recorded on the VPS, not inferred from this preparation note.

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
- **Photo touch-swipe** — modal viewing with previous/next buttons and keyboard is implemented; swipe gestures remain optional.
- **Issue timeline inline** in day detail — issues link out to their own page.
- **Project checklist editor UI** — the Checklist tab is read-only; `syncProjectChecklist` supports editing.
- **Excel export**, watermark, full offline submit, issue analytics — phase 2.
- **M8**: Lighthouse ≥85, E2E in CI, disk-alert email (§10.1), backup runbook tested.

---

## 8. Verification commands

```bash
./node_modules/.bin/tsc --noEmit                  # must be clean
./node_modules/.bin/vitest run                    # currently 377 passing
./node_modules/.bin/next build                    # routes must build

# E2E starts a disposable seeded server on :3113 automatically
./node_modules/.bin/playwright test
./node_modules/.bin/playwright test e2e/pdf.spec.ts   # slow: launches Chromium
```

**Note:** Default E2E uses a disposable DB/uploads; it does not mutate preview.
An explicit `E2E_BASE_URL` opts out and mutates that server's data. Never point it
at the shared preview. The following destructive reset is only for a disposable
development database, not the curated preview:
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
