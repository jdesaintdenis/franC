import { createTranslator } from "next-intl";

import { asLocale } from "@/i18n/config";
import { loadMessages } from "@/i18n/messages";
import { formatShortInstant } from "@/lib/format-date";

export interface ReminderPayload {
  title: string;
  body: string;
  /** Same-origin path opened when the notification is tapped. */
  url: string;
}

/**
 * Generic, localized notification text. It only carries the age of the oldest stale account:
 * never account names, amounts or labels, since it passes through third-party push services.
 */
export async function buildReminderPayload(input: { locale: string | null; ageDays: number }): Promise<ReminderPayload> {
  const locale = asLocale(input.locale ?? "en");
  const messages = await loadMessages(locale);
  const t = createTranslator({ locale, messages, namespace: "common.importReminderPush" });
  return { title: t("title"), body: t("body", { days: input.ageDays }), url: "/import" };
}

/**
 * Generic bank health text: no bank or account names, only (for a failing sync) the day it started.
 * `since` is only read for `failing`.
 */
export async function buildBankHealthPayload(input: {
  locale: string | null;
  kind: "reconnect" | "failing";
  since: Date;
  today: string;
}): Promise<ReminderPayload> {
  const locale = asLocale(input.locale ?? "en");
  const messages = await loadMessages(locale);
  const t = createTranslator({ locale, messages, namespace: "common.bankHealthPush" });
  const url = "/accounts/bank";
  if (input.kind === "reconnect") return { title: t("reconnectTitle"), body: t("reconnectBody"), url };
  return {
    title: t("failingTitle"),
    body: t("failingBody", { date: formatShortInstant(input.since, input.today, locale) }),
    url,
  };
}
