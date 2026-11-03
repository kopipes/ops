import type { Route } from "playwright-core";
import { describe, expect, it, vi } from "vitest";
import { pdfRequestHandler } from "./requests";

function fixture(url: string, location?: string) {
  const response = { headers: () => location ? { location } : {}, status: () => location ? 302 : 200 };
  const route = { request: () => ({ url: () => url, headers: () => ({ cookie: "unrelated=original", accept: "text/html" }) }), fetch: vi.fn(async () => response), fulfill: vi.fn(async () => {}), abort: vi.fn(async () => {}) };
  return { route, response, typed: route as unknown as Route };
}
describe("PDF cookie boundary", () => {
  it("forwards only Ops' session to the approved origin with no automatic redirects", async () => {
    const { route, response, typed } = fixture("http://127.0.0.1:4215/print/day/x");
    await pdfRequestHandler("http://127.0.0.1:4215", "analytics=private; ops_session=secret-token; another=private")(typed);
    expect(route.fetch).toHaveBeenCalledWith({ headers: { accept: "text/html", cookie: "ops_session=secret-token" }, maxRedirects: 0, timeout: 120_000 });
    expect(route.fulfill).toHaveBeenCalledWith({ response });
  });
  it("blocks external subresources and different local application ports before sending any request", async () => {
    for (const url of ["https://external.example.test/photo.jpg", "http://127.0.0.1:3300/private"]) {
      const { route, typed } = fixture(url);
      await pdfRequestHandler("http://127.0.0.1:4215", "ops_session=secret-token")(typed);
      expect(route.fetch).not.toHaveBeenCalled();
      expect(route.abort).toHaveBeenCalledWith("blockedbyclient");
    }
  });
  it("blocks redirects outside the approved origin without forwarding the session", async () => {
    const { route, typed } = fixture("http://127.0.0.1:4215/photo", "https://external.example.test/capture");
    await pdfRequestHandler("http://127.0.0.1:4215", "ops_session=secret-token")(typed);
    expect(route.fetch).toHaveBeenCalledWith(expect.objectContaining({ maxRedirects: 0 }));
    expect(route.abort).toHaveBeenCalledWith("blockedbyclient");
    expect(route.fulfill).not.toHaveBeenCalled();
  });
});
