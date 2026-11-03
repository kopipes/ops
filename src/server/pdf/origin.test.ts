import { describe, expect, it } from "vitest";
import { pdfOrigin } from "./origin";

describe("PDF render origin", () => {
  it("uses the fixed internal origin even when a caller spoofs forwarding headers", () => {
    const headers = new Headers({ host: "ops.example.test", "x-forwarded-host": "attacker.example.test", "x-forwarded-proto": "https" });
    expect(pdfOrigin(headers, "http://127.0.0.1:4215", "4215", true)).toBe("http://127.0.0.1:4215");
  });
  it("rejects non-origins in server configuration", () => {
    for (const value of ["file:///etc/passwd", "http://user:pass@localhost", "http://localhost/path", "https://localhost/?secret=x", "https://localhost/#fragment", "https://attacker.example.test", "http://10.0.0.1:4215", "http://127.0.0.1:3300", "https://127.0.0.1:4215"]) {
      expect(() => pdfOrigin(new Headers(), value, "4215", true)).toThrow();
    }
    expect(() => pdfOrigin(new Headers({ host: "attacker.example.test" }), "", "4215", true)).toThrow("required in production");
  });
  it("keeps development previews on the incoming origin when no override is configured", () => {
    expect(pdfOrigin(new Headers({ host: "localhost:3112", "x-forwarded-proto": "http" }), "", "3112", false)).toBe("http://localhost:3112");
  });
});
