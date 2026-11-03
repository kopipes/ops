import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { mkdtempSync, readFileSync, rmSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initializeAccounts } from "./initialize-accounts";
import { verifyPassword } from "../auth/password";

let db: Database.Database;
let root: string;
let credentials: string;
let marker: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ops-initialization-test-"));
  credentials = join(root, "passwords.txt");
  marker = join(root, "initialized");
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  migrate(drizzle(db), { migrationsFolder: resolve("src/server/db/migrations") });
  for (const [id, name, role] of [["bob", "Bob", "admin"], ["usr-admin", "Admin", "admin"], ["usr-mgr", "Manager", "manager"], ["usr-corp", "Corporate", "corporate"], ["usr-crew", "Crew", "user"]]) {
    db.prepare("INSERT INTO users(id,name,email,password_hash,role,is_active,pending_approval,created_at,updated_at) VALUES(?,?,?,'original-hash',?,1,0,1,1)").run(id, name, `${id}@example.test`, role);
  }
  db.prepare("INSERT INTO sessions(id,user_id,expires_at,created_at) VALUES('old-session','bob',9999999999999,1)").run();
});
afterEach(() => { db.close(); rmSync(root, { recursive: true, force: true }); });

describe("first deployment account initialization", () => {
  it("preserves Bob, rotates four unique demo passwords, requires changes and revokes local sessions", async () => {
    await initializeAccounts(db, credentials, marker, "a".repeat(40));
    const entries = readFileSync(credentials, "utf8").split("\n").filter(line => line.includes("\t")).map(line => line.split("\t"));
    expect(entries).toHaveLength(4);
    expect(new Set(entries.map(([, password]) => password)).size).toBe(4);
    for (const [email, password] of entries) {
      const user = db.prepare("SELECT password_hash,must_change_password,is_active,pending_approval FROM users WHERE email=?").get(email) as { password_hash: string; must_change_password: number; is_active: number; pending_approval: number };
      expect(await verifyPassword(password, user.password_hash)).toBe(true);
      expect(user).toMatchObject({ must_change_password: 1, is_active: 1, pending_approval: 0 });
      expect(JSON.stringify(db.prepare("SELECT meta_json FROM audit_logs").all())).not.toContain(password);
    }
    expect(db.prepare("SELECT password_hash FROM users WHERE id='bob'").get()).toEqual({ password_hash: "original-hash" });
    expect(db.prepare("SELECT count(*) n FROM sessions").get()).toEqual({ n: 0 });
    expect(statSync(credentials).mode & 0o777).toBe(0o600);
    expect(statSync(marker).mode & 0o777).toBe(0o400);
  });
  it("refuses a second initialization instead of overwriting VPS credentials", async () => {
    await initializeAccounts(db, credentials, marker, "a".repeat(40));
    const before = readFileSync(credentials, "utf8");
    await expect(initializeAccounts(db, credentials, marker, "b".repeat(40))).rejects.toThrow("already started/completed");
    expect(readFileSync(credentials, "utf8")).toBe(before);
  });
  it("rolls DB updates back and leaves no success marker on failure", async () => {
    db.exec("CREATE TRIGGER fail_update BEFORE UPDATE ON users WHEN NEW.id='usr-mgr' BEGIN SELECT RAISE(ABORT,'forced failure'); END");
    await expect(initializeAccounts(db, credentials, marker, "a".repeat(40))).rejects.toThrow("forced failure");
    expect(db.prepare("SELECT count(*) n FROM users WHERE password_hash='original-hash'").get()).toEqual({ n: 5 });
    expect(db.prepare("SELECT count(*) n FROM sessions").get()).toEqual({ n: 1 });
    expect(existsSync(marker)).toBe(false);
    expect(existsSync(credentials)).toBe(true);
  });
  it("refuses unexpected imported accounts before writing secrets", async () => {
    db.prepare("UPDATE users SET name='Unexpected' WHERE id='bob'").run();
    await expect(initializeAccounts(db, credentials, marker, "a".repeat(40))).rejects.toThrow("approved five-account");
    expect(existsSync(credentials)).toBe(false);
  });
});
