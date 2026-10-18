import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { isBankSyncAllowedFor, isBankSyncEnabled, parseEnableBankingConfig } from "./config";

const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

const base = { ENABLE_BANKING_APP_ID: "app-1" };

describe("parseEnableBankingConfig", () => {
  it("accepts the PEM itself", () => {
    const cfg = parseEnableBankingConfig({ ...base, ENABLE_BANKING_PRIVATE_KEY: pem });
    expect(cfg?.appId).toBe("app-1");
    expect(cfg?.privateKey.type).toBe("private");
    expect(cfg?.apiOrigin).toBe("https://api.enablebanking.com");
  });

  it("accepts the PEM with literal backslash-n", () => {
    const escaped = pem.trim().replace(/\n/g, "\\n");
    expect(parseEnableBankingConfig({ ...base, ENABLE_BANKING_PRIVATE_KEY: escaped })).not.toBeNull();
  });

  it("accepts base64 of the PEM", () => {
    const b64 = Buffer.from(pem).toString("base64");
    expect(parseEnableBankingConfig({ ...base, ENABLE_BANKING_PRIVATE_KEY: b64 })).not.toBeNull();
  });

  it("returns null when values are missing", () => {
    expect(parseEnableBankingConfig({})).toBeNull();
    expect(parseEnableBankingConfig({ ENABLE_BANKING_PRIVATE_KEY: pem })).toBeNull();
    expect(parseEnableBankingConfig(base)).toBeNull();
    expect(isBankSyncEnabled({})).toBe(false);
  });

  it("returns null for a garbage key", () => {
    expect(parseEnableBankingConfig({ ...base, ENABLE_BANKING_PRIVATE_KEY: "not a key" })).toBeNull();
    expect(
      parseEnableBankingConfig({ ...base, ENABLE_BANKING_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----" }),
    ).toBeNull();
  });

  it("normalizes a custom origin and rejects bad ones", () => {
    const env = { ...base, ENABLE_BANKING_PRIVATE_KEY: pem };
    expect(parseEnableBankingConfig({ ...env, ENABLE_BANKING_API_ORIGIN: "http://localhost:3100/" })?.apiOrigin).toBe(
      "http://localhost:3100",
    );
    expect(parseEnableBankingConfig({ ...env, ENABLE_BANKING_API_ORIGIN: "ftp://x.test" })).toBeNull();
    expect(parseEnableBankingConfig({ ...env, ENABLE_BANKING_API_ORIGIN: "nonsense" })).toBeNull();
    expect(isBankSyncEnabled(env)).toBe(true);
  });
});

describe("isBankSyncAllowedFor", () => {
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const env = { ENABLE_BANKING_APP_ID: "app", ENABLE_BANKING_PRIVATE_KEY: pem, BANK_SYNC_EMAILS: " Owner@Example.com ,other@example.com" };

  it("allows only the listed emails, ignoring case and spaces", () => {
    expect(isBankSyncAllowedFor(env, "owner@example.com")).toBe(true);
    expect(isBankSyncAllowedFor(env, "friend@example.com")).toBe(false);
  });

  it("allows nobody when the list is unset or Enable Banking isn't configured", () => {
    expect(isBankSyncAllowedFor({ ...env, BANK_SYNC_EMAILS: undefined }, "owner@example.com")).toBe(false);
    expect(isBankSyncAllowedFor({ ...env, ENABLE_BANKING_PRIVATE_KEY: undefined }, "owner@example.com")).toBe(false);
  });
});
