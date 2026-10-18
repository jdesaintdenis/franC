import crypto from "node:crypto";
import type { EnableBankingConfig } from "./config";

const b64url = (input: Buffer | string) => Buffer.from(input).toString("base64url");

/** RS256 JWT as Enable Banking requires; valid for one hour. */
export function signEnableBankingJwt(config: EnableBankingConfig, now: Date): string {
  const iat = Math.floor(now.getTime() / 1000);
  const header = { typ: "JWT", alg: "RS256", kid: config.appId };
  const body = { iss: "enablebanking.com", aud: "api.enablebanking.com", iat, exp: iat + 3600 };
  const data = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(body))}`;
  const signature = crypto.sign("sha256", Buffer.from(data), config.privateKey);
  return `${data}.${b64url(signature)}`;
}
