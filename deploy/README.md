# Ops on cloudeka48

The verified public hostname is **ops.provaliantgroup.com**. The SSH alias is
`cloudeka48`. This app uses only `127.0.0.1:4215`, a dedicated `ops` Unix user,
`ops.service`, and the Nginx vhost `sites-available/ops` + `sites-enabled/ops`.
Other services, ports, databases and vhost files must remain unchanged.

## Sources of truth and persistent paths

- Code: `https://github.com/kopipes/ops.git`, fetched into
  `/opt/ops/repository.git`; releases are exact commits under
  `/opt/ops/releases/<40-character-SHA>`, with `.release-sha` provenance.
- Active code: atomic symlink `/opt/ops/current`.
- Database: `/var/lib/ops/data/ops.db` (**VPS is authoritative after first import**).
- Photos: `/var/lib/ops/uploads`; never serve this directory without app auth.
- Runtime cache: `/var/cache/ops`; browser binaries: `/opt/ops/browsers`.
- Service environment: `/etc/ops/ops.env`, root-only, never committed.
- Initial demo passwords: `/etc/ops/initial-passwords.txt`, root-only.
- Backups: `/var/backups/ops`; initial host-config backup:
  `/var/backups/ops-bootstrap/20261103T145236Z`.

The service runs one process, because SQLite writes, auth limits and PDF queue
assume one instance. It cannot write application code or other apps' directories,
and has explicit memory/CPU limits. Keep migrations out of `ExecStart`.

## First import only

Create a consistent local SQLite `.backup` (not a copy of a live DB/WAL). Include
uploads, check DB integrity/FKs and all referenced file paths, and record SHA256
checksums. Transfer into `/opt/ops/incoming`; verify checksums before installing
into persistent paths. Refuse import if `/var/lib/ops/.initialized` already exists
or the destination DB already exists. Retain the incoming snapshot as a backup.

After applying migrations explicitly, run `deploy/initialize-data.ts` as root
with `OPS_RELEASE_SHA` set to the verified GitHub commit. It preserves Bob,
rotates the four demo account passwords independently, requires password change,
revokes copied local sessions, writes root-only credentials, and creates the
one-time marker. Never run seed/demo cleanup against production. Initialization
is fail-closed: if it fails after writing credentials, inspect the backup and
credential file before explicitly recovering; do not blindly rerun.

Example environment (generate the session secret privately):

```dotenv
NODE_ENV=production
PORT=4215
NEXT_TELEMETRY_DISABLED=1
APP_URL=https://ops.provaliantgroup.com
DATABASE_PATH=/var/lib/ops/data/ops.db
UPLOADS_DIR=/var/lib/ops/uploads
PLAYWRIGHT_BROWSERS_PATH=/opt/ops/browsers
AUTH_CLIENT_IP_HEADER=x-ops-client-ip
PDF_RENDER_ORIGIN=http://127.0.0.1:4215
SESSION_SECRET=<random secret generated on VPS>
```

## Release procedure

1. Check free disk/memory/4215 and record existing app health, service PIDs,
   listening ports and Nginx file checksums. Back up relevant configs first.
2. Fetch GitHub; verify the requested commit is the intended remote revision.
   Create a new detached worktree/release. Install with pinned pnpm and
   `--frozen-lockfile`, using an Ops-specific store. Build as the deploy user,
   under a resource-limited transient systemd unit, never as root. Install and
   test the matching Playwright Chromium; avoid upgrading shared host packages.
3. Before later releases, stage on a **copy of the VPS database/uploads**, not
   local data. Use only the separate loopback port 4216 while staging.
4. For the live cutover, stop **only Ops**; make a consistent DB backup plus an
   uploads backup tied to the release SHA, apply migrations as `ops`, atomically
   switch `current`, and start Ops. Preserve the old release and DB snapshot.
5. Check loopback JSON health, auth, photos, PDF export, and restart persistence.
   Only then activate the isolated vhost. On first deployment use the ACME-only
   vhost until the certificate is issued with `certbot certonly --webroot`.
   Always `nginx -t` before `systemctl reload nginx`; never restart Nginx or use
   the certbot nginx plugin to rewrite existing sites.
6. Verify public HTTPS/login, secure cookies, protected APIs and PDF export;
   compare existing app health/PIDs/config checksums with the baseline.

No future release may import local DB/uploads or rerun initial-password setup.
Keep data backups private; they contain user information and password hashes.

## Rollback

For first-deploy rollback:

```bash
sudo bash /opt/ops/current/deploy/rollback.sh --first-deploy
```

This removes only the managed Ops vhost link, validates/reloads Nginx, and disables
Ops. Persistent data, secrets, browser files, releases and backups remain available.

For a later code rollback, use a previously deployed commit. Restore a matching DB
backup only if that release requires it (restoring DB loses writes after backup):

```bash
sudo bash /opt/ops/current/deploy/rollback.sh PREVIOUS_40_CHARACTER_SHA
sudo bash /opt/ops/current/deploy/rollback.sh PREVIOUS_40_CHARACTER_SHA /var/backups/ops/MATCHING_BACKUP/ops.db
```

The script backs up the current DB first. It stops/restarts only Ops; it does not
restart databases, change shared ports, or restore whole-host config snapshots.
If the requested rollback fails its health check or is interrupted during stop,
it compensates by restoring the previous code/data and restarting Ops. The Linux
simulation `python3 deploy/test-rollback.py` covers success, failed health, and
interrupted stop with all services mocked and paths remapped to temporary files.
