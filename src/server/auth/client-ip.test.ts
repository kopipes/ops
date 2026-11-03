import { afterEach, describe, expect, it } from "vitest";
import { clientIp } from "./client-ip";
import { _resetRateLimits, takeRegistrationAttempt, WINDOW_MS } from "./rate-limit";

afterEach(_resetRateLimits);

describe("public auth request throttling", () => {
  it("does not let untrusted forwarding headers choose registration budgets", () => {
    for (let i = 0; i < 20; i++) {
      const headers = new Headers({ "x-forwarded-for": `198.51.100.${i}`, "x-real-ip": `198.51.100.${i}` });
      expect(clientIp(headers, "")).toBe("unknown");
      expect(takeRegistrationAttempt(clientIp(headers, ""), 1000).allowed).toBe(true);
    }
    expect(takeRegistrationAttempt(clientIp(new Headers({ "x-forwarded-for": "203.0.113.1" }), ""), 1000).allowed).toBe(false);
  });

  it("accepts only a valid single IP from the explicitly configured proxy header", () => {
    expect(clientIp(new Headers({ "x-ops-client-ip": "203.0.113.1", "x-forwarded-for": "198.51.100.1" }), "x-ops-client-ip")).toBe("203.0.113.1");
    expect(clientIp(new Headers({ "x-ops-client-ip": "spoof, 203.0.113.1" }), "x-ops-client-ip")).toBe("unknown");
    expect(clientIp(new Headers(), "x-ops-client-ip")).toBe("unknown");
  });

  it("bounds signup work across keys and expires old budgets", () => {
    for (let i = 0; i < 100; i++) expect(takeRegistrationAttempt(`ip-${i}`, 1000).allowed).toBe(true);
    expect(takeRegistrationAttempt("ip-new", 1000).allowed).toBe(false);
    expect(takeRegistrationAttempt("ip-new", 1000 + WINDOW_MS + 1).allowed).toBe(true);
  });
});
