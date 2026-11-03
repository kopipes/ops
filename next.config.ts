import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Separate preview builds from the running dev server's compiled files.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // better-sqlite3 is a native module: keep it external so Next does not try to bundle it.
  serverExternalPackages: ["better-sqlite3"],
  poweredByHeader: false,
};

export default nextConfig;
