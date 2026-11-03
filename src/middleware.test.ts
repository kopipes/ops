import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";

afterEach(() => vi.unstubAllEnvs());

describe("authentication redirects behind the production proxy", () => {
  it.each(["/", "/projects", "/me", "/reports?projectId=example"])('keeps unauthenticated %s on the public HTTPS origin', path => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_URL", "https://ops.provaliantgroup.com");
    const request = new NextRequest(`http://localhost:4215${path}`, { headers: { host: "ops.provaliantgroup.com", "x-forwarded-host": "attacker.invalid", "x-forwarded-proto": "https" } });
    const response = middleware(request);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://ops.provaliantgroup.com/login");
  });
  it("preserves the actual development server port", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("APP_URL", "http://localhost:3000");
    expect(middleware(new NextRequest("http://localhost:3113/projects")).headers.get("location")).toBe("http://localhost:3113/login");
  });
  it("keeps public health and login available without a session", () => {
    for (const path of ["/login", "/register", "/api/health"]) expect(middleware(new NextRequest(`http://localhost:4215${path}`)).headers.get("location")).toBeNull();
  });
  it("does not use the internal listener when production configuration is missing", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_URL", "");
    expect(middleware(new NextRequest("http://localhost:4215/" )).status).toBe(503);
  });
});
