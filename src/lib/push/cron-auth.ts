import { timingSafeEqual } from "node:crypto";

/** Whether the request carries `Authorization: Bearer <secret>`, compared in constant time. */
export function isAuthorizedCron(authorization: string | null, secret: string): boolean {
  if (!authorization?.startsWith("Bearer ")) return false;
  const given = Buffer.from(authorization.slice("Bearer ".length));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
