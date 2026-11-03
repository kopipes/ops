"""Exercise rollback/recovery in a private Linux namespace of files + fake services.

No real systemctl/nginx/chown is invoked. Run: python3 deploy/test-rollback.py
"""
from pathlib import Path
import os
import shutil
import sqlite3
import subprocess
import tempfile


def exercise(reject_target, interrupt_stop=False):
    with tempfile.TemporaryDirectory(prefix="ops-rollback-test-") as directory:
        root = Path(directory)
        source = Path(__file__).with_name("rollback.sh").read_text()
        # The production script remains untouched. Only this temporary test copy
        # uses fake service commands and remapped paths, without a root requirement.
        source = source.replace('if [[ $EUID -ne 0 ]]; then echo "Run with sudo." >&2; exit 1; fi', "# isolated non-root test")
        for prefix in ["/opt/ops", "/var/backups/ops", "/var/lib/ops", "/run/lock", "/etc/systemd/system", "/etc/nginx"]:
            source = source.replace(prefix, str(root) + prefix)
        script = root / "rollback.sh"
        script.write_text(source)
        for relative in ["opt/ops/releases", "var/backups/ops", "var/lib/ops/data", "run/lock", "etc/systemd/system", "bin"]:
            (root / relative).mkdir(parents=True, exist_ok=True)
        previous, target = "b" * 40, "a" * 40
        for sha in [previous, target]:
            release = root / "opt/ops/releases" / sha
            release.mkdir()
            (release / ".release-sha").write_text(sha)
        current = root / "opt/ops/current"
        current.symlink_to(root / "opt/ops/releases" / previous)
        unit = root / "etc/systemd/system/ops.service"
        unit.write_text("# managed-by-ops: test\n")
        live = root / "var/lib/ops/data/ops.db"
        snapshot = root / "var/backups/ops/snapshot.db"
        for database, value in [(live, "live-vps-data"), (snapshot, "prior-backup-data")]:
            with sqlite3.connect(database) as connection:
                connection.execute("CREATE TABLE state(value TEXT)")
                connection.execute("INSERT INTO state VALUES(?)", (value,))
        commands = {
            "systemctl": f'''#!/bin/bash
set -eu
printf '%s\\n' "$*" >> '{root}/service-calls.txt'
case "$1" in
show) printf '%s\\n' '{unit}' ;;
stop) [[ "$2" == ops.service ]]; echo stopped > '{root}/service-state'
  if [[ "${{OPS_TEST_INTERRUPT_STOP:-0}}" == 1 && ! -e '{root}/stop-interrupted' ]]; then
    touch '{root}/stop-interrupted'
    kill -TERM "$PPID"
    sleep 0.05
  fi
  ;;
start) [[ "$2" == ops.service ]]; echo active > '{root}/service-state' ;;
reset-failed) [[ "$2" == ops.service ]] ;;
*) exit 91 ;;
esac
''',
            "curl": f'''#!/bin/bash
set -eu
if [[ "${{OPS_TEST_REJECT:-0}}" == 1 && $(basename "$(readlink -f '{current}')") == '{target}' ]]; then exit 22; fi
printf '%s\\n' '{{"ok":true}}'
''',
            "chown": "#!/bin/bash\nexit 0\n",
            "nginx": "#!/bin/bash\nexit 92\n",
        }
        for name, contents in commands.items():
            file = root / "bin" / name
            file.write_text(contents)
            file.chmod(0o755)
        env = {**os.environ, "PATH": str(root / "bin") + ":" + os.environ["PATH"], "OPS_TEST_REJECT": "1" if reject_target else "0", "OPS_TEST_INTERRUPT_STOP": "1" if interrupt_stop else "0"}
        result = subprocess.run(["bash", str(script), target, str(snapshot)], env=env, text=True, capture_output=True, timeout=30)
        failed = reject_target or interrupt_stop
        expected_sha = previous if failed else target
        expected_value = "live-vps-data" if failed else "prior-backup-data"
        assert (result.returncode != 0) == failed, result.stdout + result.stderr
        assert current.resolve().name == expected_sha, result.stdout + result.stderr
        with sqlite3.connect(live) as connection:
            assert connection.execute("SELECT value FROM state").fetchone()[0] == expected_value
        assert (root / "service-state").read_text().strip() == "active"
        calls = (root / "service-calls.txt").read_text()
        assert "nginx" not in calls and "mysql" not in calls and "notiv" not in calls
        assert list((root / "var/backups/ops").glob("pre-rollback-*/previous-release.txt"))
        if not interrupt_stop:
            assert list((root / "var/backups/ops").glob("pre-rollback-*/ops.db"))
        print("PASS: interrupted stop restores healthy previous service" if interrupt_stop else "PASS: failed rollback restores healthy previous code+DB" if reject_target else "PASS: successful rollback restores requested code+DB")


if not shutil.which("flock"):
    raise SystemExit("Run on Linux with flock/sqlite3; all service operations are mocked.")
exercise(False)
exercise(True)

exercise(False, True)
