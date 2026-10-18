import { describe, expect, it } from "vitest";

import { buildContentSecurityPolicy, securityHeaders } from "./headers";

describe("security headers", () => {
  it("has a strict production CSP without eval", () => {
    const csp = buildContentSecurityPolicy(false);
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toContain("ws:");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
  });

  it("relaxes only eval and websockets in dev", () => {
    const csp = buildContentSecurityPolicy(true);
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain("ws:");
  });

  it("includes every expected header", () => {
    const keys = securityHeaders(false).map((h) => h.key);
    expect(keys).toEqual([
      "Strict-Transport-Security",
      "X-Content-Type-Options",
      "Referrer-Policy",
      "Permissions-Policy",
      "X-Frame-Options",
      "Content-Security-Policy",
    ]);
  });
});
