/** Fixed loopback origin on a VPS avoids forwarding session cookies to client-supplied hosts. */
export function pdfOrigin(headers: Pick<Headers, "get">, configured = process.env.PDF_RENDER_ORIGIN, port = process.env.PORT ?? "4215", production = process.env.NODE_ENV === "production"): string {
  if (configured) {
    const url = new URL(configured);
    if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535 || url.origin !== `http://127.0.0.1:${Number(port)}` || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("PDF_RENDER_ORIGIN must match this application's loopback port");
    return url.origin;
  }
  if (production) throw new Error("PDF_RENDER_ORIGIN is required in production");
  const host = headers.get("x-forwarded-host") ?? headers.get("host") ?? "localhost:3000";
  const proto = headers.get("x-forwarded-proto") ?? (process.env.NODE_ENV === "production" ? "https" : "http");
  return `${proto}://${host}`;
}
