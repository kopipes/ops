import type { Route } from "playwright-core";

/** Inject only Ops' session, only into same-origin fetches with redirects disabled. */
export function pdfRequestHandler(origin: string, cookie?: string) {
  const session = cookie?.split(";").map(part => part.trim()).find(part => /^ops_session=[A-Za-z0-9_-]{1,256}$/.test(part));
  return async (route: Route) => {
    const request = route.request();
    if (new URL(request.url()).origin !== origin) { await route.abort("blockedbyclient"); return; }
    const headers = { ...request.headers() };
    delete headers.cookie;
    if (session) headers.cookie = session;
    try {
      const response = await route.fetch({ headers, maxRedirects: 0, timeout: 120_000 });
      const location = response.headers().location;
      if (location && response.status() >= 300 && response.status() < 400 && new URL(location, request.url()).origin !== origin) {
        await route.abort("blockedbyclient");
        return;
      }
      await route.fulfill({ response });
    } catch {
      await route.abort().catch(() => {});
    }
  };
}
