import { relations, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import type { CsvMapping } from "../lib/import/mapping";

/**
 * Better Auth tables (email + password, wired up in a later slice).
 *
 * Better Auth's default Drizzle adapter table names are `user`, `session`,
 * `account`, `verification`. We rename them to `users`, `sessions`,
 * `auth_accounts`, `verifications` via Better Auth's `modelName` option
 * because our own bank table is already called `accounts` — Better Auth's
 * "account" (a user's login method, e.g. email+password or an OAuth
 * connection) is a different concept from a *bank account* in this app.
 * Field shapes below were verified by running
 * `@better-auth/cli generate` against the installed better-auth@1.7.6
 * with the drizzle adapter and email/password enabled (see task report).
 */
export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").default(false).notNull(),
    image: text("image"),
    // UI language ('en' | 'fr'); null follows the browser's Accept-Language.
    locale: text("locale"),
    // Colour theme ('system' | 'light' | 'dark'); null = never chosen, same as 'system'.
    theme: text("theme"),
    // Remind me to import after this many days without new data; null = reminder off.
    importReminderDays: integer("import_reminder_days").default(14),
    // Paris date of the last import-reminder push, so one goes out at most once a week.
    importReminderNotifiedOn: date("import_reminder_notified_on", { mode: "string" }),
    // Last "reconnect your bank" / "sync failing" push (Slice 49), so it goes out at most weekly.
    bankHealthNotifiedOn: date("bank_health_notified_on", { mode: "string" }),
    // When the Home welcome checklist was finished or hidden; set once, so it never comes back.
    welcomeCompletedAt: timestamp("welcome_completed_at"),
    // Account Home opens on when the URL names none (Slice 50); null = all accounts. Cleared if the account is deleted.
    // DEPRECATED (Slice 76): replaced by `recurring.keeps_for_next_month`; nothing reads or writes it any more.
    // Left in place so the previous deployment keeps working while migrations run; dropped by a later cleanup migration.
    incomeMonth: text("income_month").notNull().default("next"),
    homeAccountId: uuid("home_account_id").references((): AnyPgColumn => accounts.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    check("users_locale_check", sql`${t.locale} IN ('en', 'fr')`),
    check("users_theme_check", sql`${t.theme} IN ('system', 'light', 'dark')`),
    check("users_import_reminder_days_check", sql`${t.importReminderDays} BETWEEN 1 AND 365`),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

export const authAccounts = pgTable(
  "auth_accounts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [index("auth_accounts_user_id_idx").on(t.userId)],
);

export const verifications = pgTable(
  "verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [index("verifications_identifier_idx").on(t.identifier)],
);

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  authAccounts: many(authAccounts),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id],
  }),
}));

export const authAccountsRelations = relations(authAccounts, ({ one }) => ({
  user: one(users, {
    fields: [authAccounts.userId],
    references: [users.id],
  }),
}));

/**
 * Domain schema (SPEC.md §5). Every table carries a `userId` FK to
 * Better Auth's `users.id` and every query touching these tables must
 * filter on it (see CLAUDE.md).
 */

export const ruleMatchType = pgEnum("rule_match_type", [
  "contains",
  "equals",
  "regex",
]);

export const merchantMatchType = pgEnum("merchant_match_type", ["contains", "starts_with", "equals"]);

export const recurringInterval = pgEnum("recurring_interval", [
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
]);

export const recurringStatus = pgEnum("recurring_status", [
  "detected",
  "confirmed",
  "dismissed",
  // Cancelled by the user: out of every projection, but kept (and revived by a newer charge).
  "ended",
]);

export const recurringSource = pgEnum("recurring_source", ["detected", "manual"]);

export const transferStatus = pgEnum("transfer_status", ["detected", "confirmed"]);

export const categorySource = pgEnum("category_source", ["manual", "rule", "bank", "guess"]);

// Where a transaction (or an import run) came from: a CSV upload or a bank sync (Slice 46).
// "franc": created by franC when money is moved to a Savings account (Slice 52); one hidden import per
// Savings account holds those rows.
// "manual": added by hand (Slice 56); stored in the account's hidden "franc" import.
export const transactionSource = pgEnum("transaction_source", ["csv", "sync", "franc", "manual"]);
export const importKind = pgEnum("import_kind", ["csv", "sync", "franc"]);
// Where a balance checkpoint came from: typed by the user or read from the bank (Slice 48).
export const balanceSource = pgEnum("balance_source", ["manual", "bank"]);

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    // DEPRECATED (Slice 48): replaced by the `manual` row of `balance_checkpoints`; nothing reads or
    // writes these any more. Left in place so the previous deployment keeps working while migrations
    // run at build time; dropped by a later cleanup migration.
    // Balance at the START of `startingBalanceDate`, before that day's transactions. Both null until set.
    startingBalanceCents: integer("starting_balance_cents"),
    startingBalanceDate: date("starting_balance_date", { mode: "string" }),
    // Warn when the projected balance goes below this. 0 = warn on overdraft.
    lowBalanceThresholdCents: integer("low_balance_threshold_cents").notNull().default(0),
    // Whether the account's money counts toward "safe to spend" (off for e.g. a savings account).
    inSafeToSpend: boolean("in_safe_to_spend").notNull().default(true),
    // Whether the import reminder watches this account (off for one you only import now and then).
    importReminder: boolean("import_reminder").notNull().default(true),
    // A Savings account (Slice 52): no import or sync; franC creates its rows when money is moved to savings.
    savings: boolean("savings").notNull().default(false),
    // The last CSV column mapping used for this account (Slice 74); prefills the next import. Re-validated on read.
    csvMapping: jsonb("csv_mapping").$type<CsvMapping>(),
    csvMappingSavedAt: timestamp("csv_mapping_saved_at", { withTimezone: true }),
  },
  (t) => [
    check(
      "accounts_starting_balance_pair_check",
      sql`(${t.startingBalanceCents} IS NULL) = (${t.startingBalanceDate} IS NULL)`,
    ),
    check("accounts_starting_balance_bound_check", sql`abs(${t.startingBalanceCents}) <= 1000000000`),
    check("accounts_low_balance_threshold_bound_check", sql`abs(${t.lowBalanceThresholdCents}) <= 1000000000`),
    index("accounts_user_id_idx").on(t.userId),
    // Target of the composite FK from `recurring`, so the DB guarantees an item's account is the user's.
    unique("accounts_id_user_id_unique").on(t.id, t.userId),
    // Names are unique per user, ignoring case ("Joint" and "joint" clash).
    uniqueIndex("accounts_user_id_lower_name_unique").on(t.userId, sql`lower(${t.name})`),
  ],
);

export const imports = pgTable(
  "imports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    // The file's name, or the bank's name for a sync run.
    filename: text("filename").notNull(),
    kind: importKind("kind").notNull().default("csv"),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    rowsTotal: integer("rows_total").notNull().default(0),
    rowsInserted: integer("rows_inserted").notNull().default(0),
    rowsDuplicate: integer("rows_duplicate").notNull().default(0),
    rowsError: integer("rows_error").notNull().default(0),
  },
  (t) => [index("imports_user_id_idx").on(t.userId)],
);

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull(),
    icon: text("icon"),
    // Null = top-level. Two levels max, enforced in the app (lib/categorize/hierarchy).
    parentId: uuid("parent_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("categories_user_id_idx").on(t.userId),
    index("categories_parent_id_idx").on(t.parentId),
    // Target of the composite FK below: lets the DB guarantee a parent belongs to the same user.
    unique("categories_id_user_id_unique").on(t.id, t.userId),
    // Names are unique per parent; NULLS NOT DISTINCT keeps top-level names unique too.
    unique("categories_user_id_parent_id_name_unique").on(t.userId, t.parentId, t.name).nullsNotDistinct(),
    // RESTRICT: deletes go through the app, which decides what happens to children.
    foreignKey({
      name: "categories_parent_fk",
      columns: [t.parentId, t.userId],
      foreignColumns: [t.id, t.userId],
    }).onDelete("restrict"),
    check("categories_parent_not_self_check", sql`${t.parentId} <> ${t.id}`),
  ],
);

export const categoryRules = pgTable(
  "category_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    matchType: ruleMatchType("match_type").notNull(),
    pattern: text("pattern").notNull(),
    priority: integer("priority").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("category_rules_user_id_priority_idx").on(t.userId, t.priority),
  ],
);

/**
 * How a bank category (or one of its subcategories, when `bankSubcategory` is set)
 * maps to a user category. Null `categoryId` = Ignored. The composite FK cascades so
 * deleting a category forgets its mappings and the next import asks again.
 */
export const bankCategoryMappings = pgTable(
  "bank_category_mappings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    bankCategory: text("bank_category").notNull(),
    bankSubcategory: text("bank_subcategory"),
    categoryId: uuid("category_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("bank_category_mappings_user_id_idx").on(t.userId),
    unique("bank_category_mappings_user_bank_unique")
      .on(t.userId, t.bankCategory, t.bankSubcategory)
      .nullsNotDistinct(),
    foreignKey({
      name: "bank_category_mappings_category_fk",
      columns: [t.categoryId, t.userId],
      foreignColumns: [categories.id, categories.userId],
    }).onDelete("cascade"),
  ],
);

/**
 * "Not now" on a suggested rule (Slice 27): remembers the suggestion so it does not come back.
 * The composite FK cascades, so deleting a category forgets its dismissals.
 */
export const ruleSuggestionDismissals = pgTable(
  "rule_suggestion_dismissals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    matchType: ruleMatchType("match_type").notNull(),
    pattern: text("pattern").notNull(),
    categoryId: uuid("category_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique("rule_suggestion_dismissals_unique").on(t.userId, t.matchType, t.pattern, t.categoryId),
    foreignKey({
      name: "rule_suggestion_dismissals_category_fk",
      columns: [t.categoryId, t.userId],
      foreignColumns: [categories.id, categories.userId],
    }).onDelete("cascade"),
  ],
);

/**
 * Monthly budget per category (one amount for every month). PK on category_id: at most one
 * budget per category. The composite FK cascades, so deleting a category drops its budget.
 */
export const categoryBudgets = pgTable(
  "category_budgets",
  {
    categoryId: uuid("category_id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    amountCents: integer("amount_cents").notNull(),
    // Slice 29: what is left (or overspent) each month carries into the next one.
    rollover: boolean("rollover").notNull().default(false),
    // First day of the month the carry counts from; null while rollover is off.
    rolloverStart: date("rollover_start"),
    // Carry built before rolloverStart, snapshotted when the amount changes (budgets keep no history).
    rolloverBaseCents: bigint("rollover_base_cents", { mode: "number" }).notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("category_budgets_user_id_idx").on(t.userId),
    check("category_budgets_amount_positive_check", sql`${t.amountCents} > 0`),
    check(
      "category_budgets_rollover_start_check",
      sql`${t.rollover} = false OR (${t.rolloverStart} IS NOT NULL AND extract(day from ${t.rolloverStart}) = 1)`,
    ),
    foreignKey({
      name: "category_budgets_category_fk",
      columns: [t.categoryId, t.userId],
      foreignColumns: [categories.id, categories.userId],
    }).onDelete("cascade"),
  ],
);

/**
 * A merchant name (Slice 25): shown instead of the bank's label wherever a label is read.
 * Names are unique per user, ignoring case. Patterns decide which transactions get the name.
 */
export const merchants = pgTable(
  "merchants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("merchants_user_id_idx").on(t.userId),
    // Target of the composite FK from `merchant_patterns`.
    unique("merchants_id_user_id_unique").on(t.id, t.userId),
    uniqueIndex("merchants_user_id_lower_name_unique").on(t.userId, sql`lower(${t.name})`),
  ],
);

/** One way to recognise a merchant in a label. Deleting the merchant deletes its patterns. */
export const merchantPatterns = pgTable(
  "merchant_patterns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    merchantId: uuid("merchant_id").notNull(),
    matchType: merchantMatchType("match_type").notNull(),
    pattern: text("pattern").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("merchant_patterns_user_id_idx").on(t.userId),
    index("merchant_patterns_merchant_id_idx").on(t.merchantId),
    check("merchant_patterns_pattern_length_check", sql`char_length(${t.pattern}) BETWEEN 1 AND 200`),
    foreignKey({
      name: "merchant_patterns_merchant_fk",
      columns: [t.merchantId, t.userId],
      foreignColumns: [merchants.id, merchants.userId],
    }).onDelete("cascade"),
  ],
);

export const recurring = pgTable(
  "recurring",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").notNull(),
    merchantKey: text("merchant_key").notNull(),
    typicalAmountCents: integer("typical_amount_cents").notNull(),
    interval: recurringInterval("interval").notNull(),
    lastSeenDate: date("last_seen_date", { mode: "string" }).notNull(),
    nextExpectedDate: date("next_expected_date", { mode: "string" }),
    status: recurringStatus("status").notNull().default("detected"),
    /** `manual` = tracked by the user (Slice 53): detection never reshapes or deletes it; amount = median of its last 6 payments. */
    source: recurringSource("source").notNull().default("detected"),
    /** Day the user marked the item ended; null unless status is `ended`. */
    endedAt: date("ended_at", { mode: "string" }),
    /**
     * Account's latest transaction date when the user answered "Still active" to the
     * "Cancelled?" flag; the flag stays hidden until another cycle is missed after it.
     */
    stillActiveAt: date("still_active_at", { mode: "string" }),
    /** A regular income whose charges are kept for next month in Reste à vivre (Slice 76); off by default. */
    keepsForNextMonth: boolean("keeps_for_next_month").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("recurring_user_id_idx").on(t.userId),
    index("recurring_account_id_idx").on(t.accountId),
    // Target of the composite FK from `recurring_price_alerts`.
    unique("recurring_id_user_id_unique").on(t.id, t.userId),
    unique("recurring_user_id_account_id_merchant_key_unique").on(t.userId, t.accountId, t.merchantKey),
    // Deleting an account removes its recurring items.
    foreignKey({
      name: "recurring_account_fk",
      columns: [t.accountId, t.userId],
      foreignColumns: [accounts.id, accounts.userId],
    }).onDelete("cascade"),
  ],
);

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    // Cascade so undoing an import (Slice 5) is a single delete of the
    // import row, without a separate step to remove its transactions.
    importId: uuid("import_id")
      .notNull()
      .references(() => imports.id, { onDelete: "cascade" }),
    date: date("date", { mode: "string" }).notNull(),
    // The bank's booking date (CSV "Date de comptabilisation" or the API's booking_date); null on
    // rows from before Slice 48, which fall back to `date`. The bank's balance covers booked rows,
    // so balance checks compare on this, never on the operation date. Not part of the dedupe hash.
    bookedOn: date("booked_on", { mode: "string" }),
    amountCents: integer("amount_cents").notNull(),
    labelRaw: text("label_raw"),
    // The user's own free-text note (Slice 32). Never part of the dedupe hash.
    note: text("note"),
    labelNormalized: text("label_normalized"),
    // Human-facing label, freely editable later. Deliberately separate from
    // labelRaw/labelNormalized so edits never affect the dedupe hash.
    labelDisplay: text("label_display"),
    categoryId: uuid("category_id").references(() => categories.id, {
      onDelete: "set null",
    }),
    // Null until a rule, the bank mapping or the user sets a category. "manual" marks a
    // user override so rule (re)application never clobbers it; "bank" rows are replaced by rules.
    categorySource: categorySource("category_source"),
    // The bank's own (cleaned) categories from the CSV; never part of the dedupe hash.
    bankCategory: text("bank_category"),
    bankSubcategory: text("bank_subcategory"),
    recurringId: uuid("recurring_id").references(() => recurring.id, {
      onDelete: "set null",
    }),
    // Stored result of merchant matching (recomputed in JS, like the category); never part of the dedupe hash.
    // Single-column FK: a composite one could not null just this column. Ownership is kept by app code.
    merchantId: uuid("merchant_id").references(() => merchants.id, { onDelete: "set null" }),
    dedupeHash: text("dedupe_hash").notNull(),
    occurrenceIndex: integer("occurrence_index").notNull(),
    source: transactionSource("source").notNull().default("csv"),
    // Set on rows franC created (source "franc"): the row it mirrors. Cascade so undoing that row's
    // import or deleting its account removes the created row (and the pair) too.
    createdFromId: uuid("created_from_id"),
    // The bank's id for a synced row (`entry_reference`); null for CSV rows and unreliable ids.
    externalId: text("external_id"),
    // Null = still "to review" (Slice 26). The default marks every other insert path as reviewed;
    // only commitImport inserts null explicitly.
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }).defaultNow(),
    // Set when the user ignores the row: kept (so dedupe and matching still see it) but left out of totals.
    ignoredAt: timestamp("ignored_at", { withTimezone: true }),
    // Added by hand on an account a bank link or imports feed: waits for the bank row that will take it over (Slice 56).
    awaitingBank: boolean("awaiting_bank").notNull().default(false),
    // Slice 79: an expense paid with the income kept for next month; Reste à vivre counts it next month.
    paidFromNextMonth: boolean("paid_from_next_month").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("transactions_to_review_idx").on(t.userId, t.importId).where(sql`${t.reviewedAt} IS NULL`),
    index("transactions_user_id_date_idx").on(t.userId, t.date),
    index("transactions_user_id_merchant_id_idx").on(t.userId, t.merchantId),
    index("transactions_created_from_id_idx").on(t.createdFromId),
    index("transactions_awaiting_bank_idx").on(t.userId, t.accountId).where(sql`${t.awaitingBank}`),
    foreignKey({
      name: "transactions_created_from_fk",
      columns: [t.createdFromId, t.userId],
      foreignColumns: [t.id, t.userId],
    }).onDelete("cascade"),
    // Target of the composite FKs from `transfers`, so the DB guarantees a pair's rows are the user's.
    unique("transactions_id_user_id_unique").on(t.id, t.userId),
    unique("transactions_dedupe_unique").on(
      t.accountId,
      t.dedupeHash,
      t.occurrenceIndex,
    ),
    // A bank row synced twice (overlapping windows, concurrent taps) is inserted once.
    uniqueIndex("transactions_account_external_id_unique")
      .on(t.accountId, t.externalId)
      .where(sql`${t.externalId} IS NOT NULL`),
  ],
);

/**
 * An identity (bank id, or CSV hash + occurrence) merged into a kept transaction because the CSV
 * and the bank sync both brought the same purchase. The exact-match passes read this table too, so a
 * merged row never comes back on a re-sync or a re-import. `import_id` is the import that brought the
 * duplicate: undoing a CSV import forgets its merges. Deleting the kept row forgets them as well.
 */
export const transactionMatches = pgTable(
  "transaction_matches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    transactionId: uuid("transaction_id").notNull(),
    importId: uuid("import_id")
      .notNull()
      .references(() => imports.id, { onDelete: "cascade" }),
    source: transactionSource("source").notNull(),
    dedupeHash: text("dedupe_hash").notNull(),
    occurrenceIndex: integer("occurrence_index").notNull(),
    externalId: text("external_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("transaction_matches_transaction_id_idx").on(t.transactionId),
    unique("transaction_matches_dedupe_unique").on(t.accountId, t.dedupeHash, t.occurrenceIndex),
    uniqueIndex("transaction_matches_account_external_id_unique")
      .on(t.accountId, t.externalId)
      .where(sql`${t.externalId} IS NOT NULL`),
    foreignKey({
      name: "transaction_matches_transaction_fk",
      columns: [t.transactionId, t.userId],
      foreignColumns: [transactions.id, transactions.userId],
    }).onDelete("cascade"),
  ],
);

/**
 * Rows the matcher could not place with certainty: a new row and the existing ones it may duplicate.
 * Review resolves them. Deleting either transaction drops the link.
 */
export const duplicateCandidates = pgTable(
  "duplicate_candidates",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    transactionId: uuid("transaction_id").notNull(),
    candidateId: uuid("candidate_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    primaryKey({ name: "duplicate_candidates_pk", columns: [t.transactionId, t.candidateId] }),
    index("duplicate_candidates_user_id_idx").on(t.userId),
    foreignKey({
      name: "duplicate_candidates_transaction_fk",
      columns: [t.transactionId, t.userId],
      foreignColumns: [transactions.id, transactions.userId],
    }).onDelete("cascade"),
    foreignKey({
      name: "duplicate_candidates_candidate_fk",
      columns: [t.candidateId, t.userId],
      foreignColumns: [transactions.id, transactions.userId],
    }).onDelete("cascade"),
  ],
);

/**
 * An internal transfer is always a pair: an outflow on one account and the matching
 * inflow on another. Each transaction is in at most one pair (UNIQUE). Deleting either
 * transaction (undo import, delete account) cascades to the pair row, which frees the
 * other side. Cross-row invariants (signs, amounts, accounts) are checked in app code.
 */
export const transfers = pgTable(
  "transfers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    outTransactionId: uuid("out_transaction_id").notNull(),
    inTransactionId: uuid("in_transaction_id").notNull(),
    status: transferStatus("status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("transfers_user_id_idx").on(t.userId),
    unique("transfers_out_transaction_id_unique").on(t.outTransactionId),
    unique("transfers_in_transaction_id_unique").on(t.inTransactionId),
    foreignKey({
      name: "transfers_out_transaction_fk",
      columns: [t.outTransactionId, t.userId],
      foreignColumns: [transactions.id, transactions.userId],
    }).onDelete("cascade"),
    foreignKey({
      name: "transfers_in_transaction_fk",
      columns: [t.inTransactionId, t.userId],
      foreignColumns: [transactions.id, transactions.userId],
    }).onDelete("cascade"),
  ],
);

/** User-defined labels (Slice 32). Names are unique per user, case-insensitively. */
export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // Target of the composite FK from `transaction_tags`.
    unique("tags_id_user_id_unique").on(t.id, t.userId),
    uniqueIndex("tags_user_id_lower_name_unique").on(t.userId, sql`lower(${t.name})`),
  ],
);

/**
 * Tag links on whole transactions. Composite FKs guarantee a link never crosses users; both
 * sides cascade, so deleting a tag or a transaction (e.g. undoing an import) drops the links.
 */
export const transactionTags = pgTable(
  "transaction_tags",
  {
    transactionId: uuid("transaction_id").notNull(),
    tagId: uuid("tag_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ name: "transaction_tags_pk", columns: [t.transactionId, t.tagId] }),
    index("transaction_tags_user_id_tag_id_idx").on(t.userId, t.tagId),
    foreignKey({
      name: "transaction_tags_transaction_fk",
      columns: [t.transactionId, t.userId],
      foreignColumns: [transactions.id, transactions.userId],
    }).onDelete("cascade"),
    foreignKey({
      name: "transaction_tags_tag_fk",
      columns: [t.tagId, t.userId],
      foreignColumns: [tags.id, tags.userId],
    }).onDelete("cascade"),
  ],
);

export const priceAlertStatus = pgEnum("price_alert_status", ["open", "accepted", "dismissed"]);

/**
 * A recurring item's latest charge cost clearly more than its usual amount. One row per
 * charge (UNIQUE), so an accepted or dismissed charge is never raised again; at most one
 * alert per item is open. Deleting the item or the charge's transaction cascades.
 */
export const recurringPriceAlerts = pgTable(
  "recurring_price_alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    recurringId: uuid("recurring_id").notNull(),
    transactionId: uuid("transaction_id").notNull(),
    oldAmountCents: integer("old_amount_cents").notNull(),
    newAmountCents: integer("new_amount_cents").notNull(),
    chargedOn: date("charged_on", { mode: "string" }).notNull(),
    status: priceAlertStatus("status").notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    index("recurring_price_alerts_user_id_idx").on(t.userId),
    unique("recurring_price_alerts_recurring_id_transaction_id_unique").on(t.recurringId, t.transactionId),
    uniqueIndex("recurring_price_alerts_one_open_idx").on(t.recurringId).where(sql`${t.status} = 'open'`),
    foreignKey({
      name: "recurring_price_alerts_recurring_fk",
      columns: [t.recurringId, t.userId],
      foreignColumns: [recurring.id, recurring.userId],
    }).onDelete("cascade"),
    foreignKey({
      name: "recurring_price_alerts_transaction_fk",
      columns: [t.transactionId, t.userId],
      foreignColumns: [transactions.id, transactions.userId],
    }).onDelete("cascade"),
  ],
);

/** Pairs the user unlinked: detection never suggests them again. */
export const transferRejections = pgTable(
  "transfer_rejections",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    outTransactionId: uuid("out_transaction_id").notNull(),
    inTransactionId: uuid("in_transaction_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    primaryKey({ name: "transfer_rejections_pk", columns: [t.outTransactionId, t.inTransactionId] }),
    index("transfer_rejections_user_id_idx").on(t.userId),
    foreignKey({
      name: "transfer_rejections_out_transaction_fk",
      columns: [t.outTransactionId, t.userId],
      foreignColumns: [transactions.id, transactions.userId],
    }).onDelete("cascade"),
    foreignKey({
      name: "transfer_rejections_in_transaction_fk",
      columns: [t.inTransactionId, t.userId],
      foreignColumns: [transactions.id, transactions.userId],
    }).onDelete("cascade"),
  ],
);

/**
 * The parts of a split transaction (Slice 18). A transaction is split exactly when it has
 * parts; the row itself keeps its amount, labels and own category untouched. Parts share
 * the transaction's sign and sum to its amount (checked in app code, lib/splits/validate).
 * Deleting the transaction (undo import, delete account) cascades to its parts. The category
 * FK sets null on category delete, like `transactions.category_id`; ownership is checked in
 * app code because a composite FK cannot null just one column.
 */
export const transactionSplits = pgTable(
  "transaction_splits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    transactionId: uuid("transaction_id").notNull(),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    amountCents: integer("amount_cents").notNull(),
    position: smallint("position").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("transaction_splits_transaction_id_idx").on(t.transactionId),
    index("transaction_splits_user_id_idx").on(t.userId),
    check("transaction_splits_amount_nonzero_check", sql`${t.amountCents} <> 0`),
    foreignKey({
      name: "transaction_splits_transaction_fk",
      columns: [t.transactionId, t.userId],
      foreignColumns: [transactions.id, transactions.userId],
    }).onDelete("cascade"),
  ],
);

/**
 * A savings goal (Slice 30): a target amount, optionally by a date. What it holds is the sum of its
 * entries (`savings_goal_contributions`). `account_id` = the account its money lives in (several goals
 * can share one; the balance minus what they hold is "Not assigned"); null = money tracked by hand.
 */
export const savingsGoals = pgTable(
  "savings_goals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    targetCents: integer("target_cents").notNull(),
    targetDate: date("target_date", { mode: "string" }),
    icon: text("icon"),
    // Deleting the account turns the goal into a manual one. Ownership is checked by the queries.
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
    // What was saved when the plan (re)started: the on-track line runs from here to the target.
    startCents: integer("start_cents").notNull(),
    startDate: date("start_date", { mode: "string" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("savings_goals_user_id_idx").on(t.userId),
    check("savings_goals_target_check", sql`${t.targetCents} > 0 AND ${t.targetCents} <= 1000000000`),
    check("savings_goals_name_length_check", sql`char_length(${t.name}) BETWEEN 1 AND 60`),
    // Target of the composite FK from `savings_goal_contributions`.
    unique("savings_goals_id_user_id_unique").on(t.id, t.userId),
    uniqueIndex("savings_goals_user_id_lower_name_unique").on(t.userId, sql`lower(${t.name})`),
  ],
);

/**
 * An entry of a goal: money added (+) or taken out (−). On an account goal it is an assignment from
 * "Not assigned" (`transaction_id` null) or a moved row (`transaction_id`).
 */
export const savingsGoalContributions = pgTable(
  "savings_goal_contributions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    goalId: uuid("goal_id").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    amountCents: integer("amount_cents").notNull(),
    // The row on the goal's account this entry follows (Move to savings). Cascade: undoing the move removes the entry.
    transactionId: uuid("transaction_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("savings_goal_contributions_goal_id_idx").on(t.goalId),
    index("savings_goal_contributions_transaction_id_idx").on(t.transactionId),
    // A row belongs to one goal.
    uniqueIndex("savings_goal_contributions_transaction_id_unique").on(t.transactionId).where(sql`${t.transactionId} IS NOT NULL`),
    foreignKey({
      name: "savings_goal_contributions_transaction_fk",
      columns: [t.transactionId, t.userId],
      foreignColumns: [transactions.id, transactions.userId],
    }).onDelete("cascade"),
    check("savings_goal_contributions_amount_check", sql`${t.amountCents} <> 0 AND abs(${t.amountCents}) <= 1000000000`),
    foreignKey({
      name: "savings_goal_contributions_goal_fk",
      columns: [t.goalId, t.userId],
      foreignColumns: [savingsGoals.id, savingsGoals.userId],
    }).onDelete("cascade"),
  ],
);

export type SavingsGoal = typeof savingsGoals.$inferSelect;
export type SavingsGoalContribution = typeof savingsGoalContributions.$inferSelect;

export type Merchant = typeof merchants.$inferSelect;
export type MerchantPattern = typeof merchantPatterns.$inferSelect;
export type MerchantMatchType = (typeof merchantMatchType.enumValues)[number];

// One Web Push subscription per device that turned on import-reminder notifications.
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull().unique(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("push_subscriptions_user_id_idx").on(t.userId)],
);

export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;

export type Transfer = typeof transfers.$inferSelect;

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;

export type Import = typeof imports.$inferSelect;
export type NewImport = typeof imports.$inferInsert;

export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;

export type CategoryRule = typeof categoryRules.$inferSelect;
export type NewCategoryRule = typeof categoryRules.$inferInsert;

export type BankCategoryMapping = typeof bankCategoryMappings.$inferSelect;
export type NewBankCategoryMapping = typeof bankCategoryMappings.$inferInsert;

export type CategoryBudget = typeof categoryBudgets.$inferSelect;

export type RecurringPriceAlert = typeof recurringPriceAlerts.$inferSelect;
export type PriceAlertStatus = (typeof priceAlertStatus.enumValues)[number];

export type Recurring = typeof recurring.$inferSelect;
export type NewRecurring = typeof recurring.$inferInsert;

export type TransactionSplit = typeof transactionSplits.$inferSelect;

export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;

// Slice 45: a consent given at the bank through Enable Banking. `pending` while the user is on the
// bank's page; `active` once the callback created a session. Sync (Slice 46+) reads active ones.
export const bankConnectionStatus = pgEnum("bank_connection_status", ["pending", "active", "expired", "failed"]);

export const bankConnections = pgTable(
  "bank_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    aspspName: text("aspsp_name").notNull(),
    aspspCountry: text("aspsp_country").notNull(),
    // Random value sent to the bank and checked on the callback (CSRF guard); cleared once used.
    authState: text("auth_state").unique(),
    // Enable Banking's session id: useless without the app's private key, so stored as is.
    sessionId: text("session_id"),
    status: bankConnectionStatus("status").notNull().default("pending"),
    validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    connectedAt: timestamp("connected_at", { withTimezone: true }),
    // Set on the pending row a Reconnect creates: the connection this one takes over from.
    replacesConnectionId: uuid("replaces_connection_id").references((): AnyPgColumn => bankConnections.id, {
      onDelete: "set null",
    }),
  },
  (t) => [index("bank_connections_user_id_idx").on(t.userId)],
);

// One row per bank account the user approved at the bank. `accountId` null means "don't import";
// `linkedAt` null means the link step hasn't been saved yet.
export const bankAccountLinks = pgTable(
  "bank_account_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => bankConnections.id, { onDelete: "cascade" }),
    bankAccountUid: text("bank_account_uid").notNull(),
    displayName: text("display_name").notNull(),
    // Only the last 4 IBAN digits, enough to tell accounts apart on screen.
    ibanLast4: text("iban_last4"),
    currency: text("currency"),
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
    linkedAt: timestamp("linked_at", { withTimezone: true }),
    // First day Sync now brings in (Slice 46): chosen in the link step, null until then.
    syncFrom: date("sync_from", { mode: "string" }),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    // Slice 49 health: the last try (cron or Sync now), its error code, and the start of the current run of failures.
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    lastError: text("last_error"),
    failingSince: timestamp("failing_since", { withTimezone: true }),
    // Enable Banking's stable account fingerprint, so Reconnect can find the same account again.
    identificationHash: text("identification_hash"),
  },
  (t) => [
    index("bank_account_links_user_id_idx").on(t.userId),
    unique("bank_account_links_connection_uid_unique").on(t.connectionId, t.bankAccountUid),
    // A franC account is fed by at most one bank account.
    uniqueIndex("bank_account_links_account_id_unique").on(t.accountId).where(sql`${t.accountId} IS NOT NULL`),
  ],
);

/**
 * "The balance was X at the END of day D" (Slice 48). One `manual` per account (the user's starting
 * balance) and one `bank` per account and day (read at each sync). `acceptedGapCents` records a
 * difference with the bank the user accepted, so it stops being reported; it is not a transaction.
 */
export const balanceCheckpoints = pgTable(
  "balance_checkpoints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    amountCents: integer("amount_cents").notNull(),
    source: balanceSource("source").notNull(),
    bankName: text("bank_name"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }),
    // The bank's code (CLBD, ...), kept to diagnose which balance a bank sends.
    balanceType: text("balance_type"),
    acceptedGapCents: integer("accepted_gap_cents").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check("balance_checkpoints_amount_bound_check", sql`abs(${t.amountCents}) <= 1000000000`),
    index("balance_checkpoints_user_id_idx").on(t.userId),
    index("balance_checkpoints_account_id_date_idx").on(t.accountId, t.date),
    uniqueIndex("balance_checkpoints_manual_unique").on(t.accountId).where(sql`${t.source} = 'manual'`),
    uniqueIndex("balance_checkpoints_bank_day_unique").on(t.accountId, t.date).where(sql`${t.source} = 'bank'`),
    foreignKey({
      name: "balance_checkpoints_account_fk",
      columns: [t.accountId, t.userId],
      foreignColumns: [accounts.id, accounts.userId],
    }).onDelete("cascade"),
  ],
);

/** "Move past and future payments like this to savings" (Slice 52): label pattern → Savings account. */
export const savingsRules = pgTable(
  "savings_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").notNull(),
    // Goal the moved money goes to (money in only). Single-column FK so deleting the goal only clears it;
    // ownership is checked by app code.
    goalId: uuid("goal_id").references(() => savingsGoals.id, { onDelete: "set null" }),
    matchType: ruleMatchType("match_type").notNull().default("contains"),
    pattern: text("pattern").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("savings_rules_user_id_idx").on(t.userId),
    uniqueIndex("savings_rules_account_lower_pattern_unique").on(t.accountId, sql`lower(${t.pattern})`),
    foreignKey({
      name: "savings_rules_account_fk",
      columns: [t.accountId, t.userId],
      foreignColumns: [accounts.id, accounts.userId],
    }).onDelete("cascade"),
  ],
);

export type SavingsRule = typeof savingsRules.$inferSelect;

export type BalanceCheckpoint = typeof balanceCheckpoints.$inferSelect;

export type BankConnection = typeof bankConnections.$inferSelect;
export type BankConnectionStatus = (typeof bankConnectionStatus.enumValues)[number];
export type BankAccountLink = typeof bankAccountLinks.$inferSelect;

/**
 * A loan (Slice 67): shown on Comptes like an account, but its own table so imports, sync, budgets and the
 * transactions list never see it. Nothing is written to `transactions`: the loan's movements are computed from
 * its checkpoints plus the bank rows linked to `recurring_id` (`src/lib/loans/ledger.ts`).
 */
export const loans = pgTable(
  "loans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    borrowedCents: integer("borrowed_cents").notNull(),
    // Yearly rate in thousandths of a percent: 1,500 % → 1500.
    rateThousandths: integer("rate_thousandths").notNull(),
    // Insurance is a fixed amount per month OR a yearly rate on the capital owed; exactly one is set.
    insuranceCents: integer("insurance_cents"),
    insuranceRateThousandths: integer("insurance_rate_thousandths"),
    lastPaymentOn: date("last_payment_on", { mode: "string" }).notNull(),
    // Optional: until this date the monthly payment stays what it is now (deferral, or phase 1 of a smoothed
    // loan); after it a constant payment runs to `last_payment_on`.
    currentPaymentUntil: date("current_payment_until", { mode: "string" }),
    // Optional history (Slice 68): the day the loan was paid out, and the first payment that repays capital
    // (before it the capital stays `borrowed_cents`: a deferral). Both null = no history before the first checkpoint.
    startedOn: date("started_on", { mode: "string" }),
    amortizationFrom: date("amortization_from", { mode: "string" }),
    // The confirmed regular payment that pays the loan. Single-column FK like `transactions.recurring_id`
    // (deleting the item only clears it); ownership is kept by app code.
    recurringId: uuid("recurring_id").references(() => recurring.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("loans_user_id_idx").on(t.userId),
    unique("loans_id_user_id_unique").on(t.id, t.userId),
    uniqueIndex("loans_user_id_lower_name_unique").on(t.userId, sql`lower(${t.name})`),
    check("loans_borrowed_check", sql`${t.borrowedCents} between 1 and 1000000000`),
    check("loans_rate_check", sql`${t.rateThousandths} between 0 and 30000`),
    check("loans_insurance_one_check", sql`(${t.insuranceCents} IS NULL) <> (${t.insuranceRateThousandths} IS NULL)`),
    check("loans_insurance_amount_check", sql`${t.insuranceCents} between 0 and 10000000`),
    check("loans_insurance_rate_check", sql`${t.insuranceRateThousandths} between 0 and 5000`),
    check("loans_started_on_check", sql`${t.startedOn} IS NULL OR ${t.startedOn} <= ${t.lastPaymentOn}`),
    check(
      "loans_amortization_from_check",
      sql`${t.amortizationFrom} IS NULL OR (${t.startedOn} IS NOT NULL AND ${t.startedOn} < ${t.amortizationFrom} AND ${t.amortizationFrom} <= ${t.lastPaymentOn})`,
    ),
  ],
);

/** "Capital owed at the START of `date`": the first one is the loan's start, later ones are corrections. */
export const loanCheckpoints = pgTable(
  "loan_checkpoints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    loanId: uuid("loan_id").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    owedCents: integer("owed_cents").notNull(),
  },
  (t) => [
    foreignKey({
      name: "loan_checkpoints_loan_fk",
      columns: [t.loanId, t.userId],
      foreignColumns: [loans.id, loans.userId],
    }).onDelete("cascade"),
    uniqueIndex("loan_checkpoints_loan_date_unique").on(t.loanId, t.date),
    index("loan_checkpoints_user_id_idx").on(t.userId),
    check("loan_checkpoints_owed_check", sql`${t.owedCents} between 0 and 1000000000`),
  ],
);

/** The user's own interest and insurance for one payment (the bank's total stays the real row's amount). */
export const loanPaymentSplits = pgTable(
  "loan_payment_splits",
  {
    userId: text("user_id").notNull(),
    loanId: uuid("loan_id").notNull(),
    transactionId: uuid("transaction_id").notNull(),
    interestCents: integer("interest_cents").notNull(),
    insuranceCents: integer("insurance_cents").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.loanId, t.transactionId] }),
    foreignKey({
      name: "loan_payment_splits_loan_fk",
      columns: [t.loanId, t.userId],
      foreignColumns: [loans.id, loans.userId],
    }).onDelete("cascade"),
    foreignKey({
      name: "loan_payment_splits_transaction_fk",
      columns: [t.transactionId, t.userId],
      foreignColumns: [transactions.id, transactions.userId],
    }).onDelete("cascade"),
    index("loan_payment_splits_user_id_idx").on(t.userId),
    check("loan_payment_splits_interest_check", sql`${t.interestCents} between 0 and 100000000`),
    check("loan_payment_splits_insurance_check", sql`${t.insuranceCents} between 0 and 100000000`),
  ],
);

export type Loan = typeof loans.$inferSelect;
export type LoanCheckpoint = typeof loanCheckpoints.$inferSelect;
export type LoanPaymentSplit = typeof loanPaymentSplits.$inferSelect;

// Result of the nightly backup, one row for the whole deployment (not user data), for the Home notice.
export const backupStatus = pgTable(
  "backup_status",
  {
    id: smallint("id").primaryKey().default(1),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }).notNull(),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    // A step name ("dump", "encrypt", "upload"), never a message: those can quote data.
    lastError: text("last_error"),
    failingSince: timestamp("failing_since", { withTimezone: true }),
    lastPathname: text("last_pathname"),
    lastSizeBytes: integer("last_size_bytes"),
  },
  (t) => [check("backup_status_single_row", sql`${t.id} = 1`)],
);
