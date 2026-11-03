import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/register", "/sw.js", "/offline.html", "/api/health"];

/**
 * Coarse gate only: bounces obviously-unauthenticated requests to /login.
 * It intentionally does NOT try to validate the session — that requires the
 * database, which is not available in the edge runtime. Real enforcement
 * happens in `requireUser()` on every page/action (§9.3).
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = request.cookies.has("ops_session");

  if (!hasSession && !PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    // Behind the production proxy Next's request URL contains its internal
    // localhost listener. Redirect using the configured public application URL.
    const origin = process.env.NODE_ENV === "production" ? process.env.APP_URL : request.nextUrl.origin;
    if (!origin) return NextResponse.json({ error: "Application URL is not configured" }, { status: 503 });
    return NextResponse.redirect(new URL("/login", origin));
  }

  return NextResponse.next();
}

export const config = {
  // Skip static assets, the manifest, and the icon.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icon.svg).*)"],
};
