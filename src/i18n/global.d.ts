import type { Locale } from "./config";
import type common from "../../messages/en/common.json";
import type auth from "../../messages/en/auth.json";
import type dashboard from "../../messages/en/dashboard.json";
import type importMessages from "../../messages/en/import.json";
import type transactions from "../../messages/en/transactions.json";
import type recurring from "../../messages/en/recurring.json";
import type settings from "../../messages/en/settings.json";
import type exportMessages from "../../messages/en/export.json";
import type year from "../../messages/en/year.json";
import type plan from "../../messages/en/plan.json";

declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: {
      common: typeof common;
      auth: typeof auth;
      dashboard: typeof dashboard;
      import: typeof importMessages;
      transactions: typeof transactions;
      recurring: typeof recurring;
      settings: typeof settings;
      export: typeof exportMessages;
      year: typeof year;
      plan: typeof plan;
    };
  }
}
