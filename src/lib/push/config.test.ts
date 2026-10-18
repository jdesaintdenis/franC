import { describe, expect, it } from "vitest";

import { parseVapidConfig } from "./config";

const env = { VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv", VAPID_SUBJECT: "mailto:a@example.com" };

describe("parseVapidConfig", () => {
  it("parses a complete config", () => {
    expect(parseVapidConfig(env)).toEqual({ publicKey: "pub", privateKey: "priv", subject: "mailto:a@example.com" });
    expect(parseVapidConfig({ ...env, VAPID_SUBJECT: "https://franc.example" })).not.toBeNull();
  });

  it("returns null when anything is missing, empty or malformed", () => {
    expect(parseVapidConfig({})).toBeNull();
    expect(parseVapidConfig({ ...env, VAPID_PUBLIC_KEY: undefined })).toBeNull();
    expect(parseVapidConfig({ ...env, VAPID_PRIVATE_KEY: "" })).toBeNull();
    expect(parseVapidConfig({ ...env, VAPID_SUBJECT: "http://franc.example" })).toBeNull();
    expect(parseVapidConfig({ ...env, VAPID_SUBJECT: "owner" })).toBeNull();
  });
});
