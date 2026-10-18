/**
 * Friendlier message than a generic failure when the device has no network.
 * Both texts come from the caller, already translated.
 */
export function networkErrorMessage(fallback: string, offlineMessage: string): string {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return offlineMessage;
  }
  return fallback;
}
