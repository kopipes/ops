/** Playwright's default server: disposable fixtures, never the preview database. */
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const root = await mkdtemp(join(tmpdir(), "ops-e2e-"));
process.env.DATABASE_PATH = join(root, "ops.db");
process.env.UPLOADS_DIR = join(root, "uploads");
process.env.NEXT_DIST_DIR = ".next-e2e";
Object.assign(process.env, { NODE_ENV: "development" });
await mkdir(process.env.UPLOADS_DIR, { recursive: true });

try {
  const { seed } = await import("../src/server/db/seed");
  await seed();
  const { getRawDb } = await import("../src/server/db");
  getRawDb().close();
  console.log("[e2e] Disposable database and uploads prepared; preview data is isolated.");
  const child = spawn(process.execPath, [resolve("node_modules/next/dist/bin/next"), "dev", "-H", "localhost", "-p", "3113"], { stdio: "inherit", env: process.env });
  let stopping = false;
  const stop = () => { stopping = true; child.kill("SIGTERM"); };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  const code = await new Promise<number>((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", code => resolveExit(code ?? (stopping ? 0 : 1)));
  });
  process.off("SIGTERM", stop);
  process.off("SIGINT", stop);
  process.exitCode = code;
} finally {
  await rm(root, { recursive: true, force: true });
}
