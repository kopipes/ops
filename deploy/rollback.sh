#!/usr/bin/env bash
set -Eeuo pipefail
if [[ $EUID -ne 0 ]]; then echo "Run with sudo." >&2; exit 1; fi
exec 9>/run/lock/ops-deploy.lock
flock -n 9 || { echo "Another Ops maintenance operation is running." >&2; exit 1; }
unit=$(systemctl show ops.service -p FragmentPath --value)
[[ $unit == /etc/systemd/system/ops.service ]]
grep -q '^# managed-by-ops:' "$unit"
if [[ ${1:-} == --first-deploy && $# == 1 ]]; then
  site=/etc/nginx/sites-enabled/ops
  if [[ -e $site || -L $site ]]; then
    [[ $(readlink -f "$site") == /etc/nginx/sites-available/ops ]]
    grep -q '^# managed-by-ops:' /etc/nginx/sites-available/ops
    rm -- "$site"
    if ! nginx -t; then
      ln -s /etc/nginx/sites-available/ops "$site"
      echo "Nginx validation failed; vhost link restored, running Nginx untouched." >&2
      exit 1
    fi
    if ! systemctl reload nginx; then
      ln -s /etc/nginx/sites-available/ops "$site"
      echo "Nginx reload failed; Ops link restored and Ops service left untouched." >&2
      exit 1
    fi
  fi
  systemctl disable --now ops.service
  echo "Only Ops was disabled; its database, uploads, secrets and backups remain intact."
  exit 0
fi
if [[ $# -lt 1 || $# -gt 2 || ! $1 =~ ^[a-f0-9]{40}$ ]]; then
  echo "Usage: sudo bash rollback.sh --first-deploy | COMMIT_SHA [MATCHING_DB_BACKUP]" >&2
  exit 2
fi
target="/opt/ops/releases/$1"
[[ -d $target && -f $target/.release-sha && $(cat "$target/.release-sha") == "$1" ]]
[[ -L /opt/ops/current ]]
snapshot=${2:-}
if [[ -n $snapshot ]]; then
  snapshot=$(realpath -e "$snapshot")
  [[ $snapshot == /var/backups/ops/* && -f $snapshot ]]
  [[ $(sqlite3 "$snapshot" 'PRAGMA integrity_check;') == ok ]]
fi
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup="/var/backups/ops/pre-rollback-$stamp"
install -d -m 0700 "$backup"
previous=$(readlink -f /opt/ops/current)
[[ $previous == /opt/ops/releases/* && -d $previous ]]
printf '%s\n' "$previous" > "$backup/previous-release.txt"
replaced_db=0
stopped=0
switch_release() {
  local switch
  switch=$(mktemp -d /opt/ops/.rollback.XXXXXX) || return 1
  [[ $switch == /opt/ops/.rollback.* && -d $switch ]] || return 1
  ln -s "$1" "$switch/current" || return 1
  mv -Tf -- "$switch/current" /opt/ops/current || return 1
  rmdir "$switch"
}
restore_db() {
  cp -- "$1" /var/lib/ops/data/ops.db.restore || return 1
  chown ops:ops /var/lib/ops/data/ops.db.restore || return 1
  chmod 0640 /var/lib/ops/data/ops.db.restore || return 1
  rm -f -- /var/lib/ops/data/ops.db-wal /var/lib/ops/data/ops.db-shm || return 1
  mv -f -- /var/lib/ops/data/ops.db.restore /var/lib/ops/data/ops.db
}
health() {
  curl --fail --silent --show-error --max-time 5 --retry 10 --retry-connrefused --retry-delay 1 http://127.0.0.1:4215/api/health |
    python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin).get("ok") is True else 1)'
}
recover() {
  local status=$1 recovered=1
  trap - ERR INT TERM
  set +e
  if [[ $stopped == 1 ]]; then
    if ! systemctl stop ops.service; then
      echo "Ops could not be stopped safely; no recovery DB replacement attempted. Inspect $backup." >&2
      exit "$status"
    fi
    if [[ $replaced_db == 1 ]]; then restore_db "$backup/ops.db" || recovered=0; fi
    switch_release "$previous" || recovered=0
    systemctl reset-failed ops.service
    systemctl start ops.service || recovered=0
    health || recovered=0
    if [[ $recovered == 1 ]]; then
      echo "Requested rollback failed; previous code/data and healthy Ops service restored." >&2
    else
      echo "Automatic recovery failed; inspect $backup. Other services were not modified." >&2
    fi
  fi
  exit "$status"
}
trap 'recover $?' ERR
trap 'recover 130' INT
trap 'recover 143' TERM
stopped=1
systemctl stop ops.service
sqlite3 /var/lib/ops/data/ops.db ".backup '$backup/ops.db'"
if [[ -n $snapshot ]]; then
  replaced_db=1
  restore_db "$snapshot"
fi
switch_release "$target"
systemctl reset-failed ops.service
systemctl start ops.service
health
trap - ERR INT TERM
echo "Ops rollback complete; forensic backup: $backup"
