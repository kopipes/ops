import type Database from "better-sqlite3";
import { existsSync, writeFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { hashPassword } from "../auth/password";

/** One-time import hardening. Never called by the application or later releases. */
export async function initializeAccounts(db: Database.Database, credentialsFile: string, markerFile: string, release: string) {
  if (existsSync(markerFile) || existsSync(credentialsFile)) throw new Error("Initialization already started/completed; inspect the backup and existing credential file before recovery");
  const users = db.prepare("SELECT id,name,email,role,password_hash,is_active,pending_approval FROM users").all() as { id: string; name: string; email: string; role: string; password_hash: string; is_active: number; pending_approval: number }[];
  const demoIds = ["usr-admin", "usr-mgr", "usr-corp", "usr-crew"];
  const bob = users.find(user => !demoIds.includes(user.id));
  if (users.length !== 5 || !bob || bob.name.toLowerCase() !== "bob" || bob.role !== "admin" || !bob.is_active || bob.pending_approval || demoIds.some(id => !users.some(user => user.id === id))) throw new Error("Expected the approved five-account local import with an active Bob administrator");
  if ((db.pragma("foreign_key_check") as unknown[]).length || db.pragma("integrity_check", { simple: true }) !== "ok") throw new Error("Imported database failed integrity validation");
  for (const [id, role] of [["usr-admin", "admin"], ["usr-mgr", "manager"], ["usr-corp", "corporate"], ["usr-crew", "user"]]) {
    if (users.find(user => user.id === id)?.role !== role) throw new Error("Imported demo account role differs from the approved snapshot");
  }

  const accounts: { id: string; email: string; password: string; passwordHash: string }[] = [];
  for (const id of demoIds) {
    const user = users.find(user => user.id === id)!;
    const password = `Ops-${randomBytes(24).toString("base64url")}`;
    accounts.push({ id, email: user.email, password, passwordHash: await hashPassword(password) });
  }
  // Write exclusively before committing: a crash cannot leave unknown passwords.
  // If DB changes fail, leave this root-only file for explicit operator recovery.
  writeFileSync(credentialsFile, [
    "Ops first-deployment passwords — private; each demo user must change on login.",
    `Bob account unchanged: ${bob.email}`,
    ...accounts.map(account => `${account.email}\t${account.password}`),
    "",
  ].join("\n"), { flag: "wx", mode: 0o600 });
  const now = Date.now();
  db.transaction(() => {
    for (const account of accounts) db.prepare("UPDATE users SET password_hash=?,must_change_password=1,is_active=1,pending_approval=0,updated_at=? WHERE id=?").run(account.passwordHash, now, account.id);
    // Local development sessions must never become usable production sessions.
    db.prepare("DELETE FROM sessions").run();
    db.prepare("INSERT INTO audit_logs (id,user_id,action,entity_type,entity_id,meta_json,created_at) VALUES (?,NULL,'deployment.initialized','deployment',?,?,?)").run(randomUUID(), release, JSON.stringify({ release, rotatedAccountIds: demoIds, bobPreserved: bob.id }), now);
  })();
  writeFileSync(markerFile, JSON.stringify({ release, initializedAt: now, databaseSource: "initial-local-snapshot", subsequentDatabaseSource: "VPS" }, null, 2) + "\n", { flag: "wx", mode: 0o400 });
  return { initialized: true, users: users.length, credentialsFile };
}
