import Database from "better-sqlite3";
import { initializeAccounts } from "../src/server/deploy/initialize-accounts";

if (process.getuid?.() !== 0) throw new Error("Run the first-import initializer as root; credentials must remain root-only");
if (!/^[a-f0-9]{40}$/.test(process.env.OPS_RELEASE_SHA ?? "")) throw new Error("Set OPS_RELEASE_SHA to the verified GitHub commit");
const db = new Database("/var/lib/ops/data/ops.db", { fileMustExist: true });
db.pragma("foreign_keys = ON");
try {
  console.log(await initializeAccounts(db, "/etc/ops/initial-passwords.txt", "/var/lib/ops/.initialized", process.env.OPS_RELEASE_SHA!));
} finally {
  db.close();
}
