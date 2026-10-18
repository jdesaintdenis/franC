import type { Locale } from "@/i18n/config";

import { formatShortDay, formatShortInstant, formatTimeAgo } from "../format-date";
import type { ConnectionHealth } from "./health";

type Translate = (key: string, values?: Record<string, string | number | Date>) => string;

/**
 * The one line saying how a bank connection is doing, in the words of `settings.bankConnection`.
 * Shared by the Comptes tab and the Bank connection page so the two never disagree.
 */
export function connectionStatusText(input: { health: ConnectionHealth; today: string; now: Date; locale: Locale; t: Translate }): string {
  const { health, today, now, locale, t } = input;
  switch (health.kind) {
    case "reconnect":
      return health.reason === "refused"
        ? t("status.reconnectRefused")
        : t(health.expired ? "status.reconnectExpired" : "status.reconnectExpiring", {
            date: formatShortDay(health.expiresOn, today, locale),
          });
    case "failing":
      return t("status.failing", { date: formatShortInstant(health.since, today, locale) });
    case "rateLimited":
      return t("sync.errors.rate_limited");
    case "ok":
      return t("status.synced", { when: formatTimeAgo(health.syncedAt, now, locale) });
    case "never":
      return t("status.never");
  }
}
