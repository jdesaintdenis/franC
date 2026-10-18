const DAY_MS = 24 * 60 * 60 * 1000;

/** Consent end: 180 days, capped by the bank's own maximum when it states one. */
export function consentValidUntil(now: Date, aspspMaxSeconds?: number): Date {
  const standard = now.getTime() + 180 * DAY_MS;
  if (aspspMaxSeconds === undefined || !(aspspMaxSeconds > 0)) return new Date(standard);
  return new Date(Math.min(standard, now.getTime() + aspspMaxSeconds * 1000));
}
