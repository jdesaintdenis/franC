import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import type { EnableBankingConfig } from "./config";
import { signEnableBankingJwt } from "./jwt";

const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const config: EnableBankingConfig = { appId: "app-1", privateKey, apiOrigin: "https://x.test" };

describe("signEnableBankingJwt", () => {
  const now = new Date("2026-10-02T10:00:00Z");
  const jwt = signEnableBankingJwt(config, now);
  const [h, b, s] = jwt.split(".");

  it("has a verifiable RS256 signature", () => {
    expect(crypto.verify("sha256", Buffer.from(`${h}.${b}`), publicKey, Buffer.from(s, "base64url"))).toBe(true);
  });

  it("has the expected header and claims", () => {
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ typ: "JWT", alg: "RS256", kid: "app-1" });
    const iat = Math.floor(now.getTime() / 1000);
    expect(JSON.parse(Buffer.from(b, "base64url").toString())).toEqual({
      iss: "enablebanking.com",
      aud: "api.enablebanking.com",
      iat,
      exp: iat + 3600,
    });
  });
});
