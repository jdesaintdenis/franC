import { getLocale, getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/page-header";
import { db } from "@/db/client";
import { getHomeAccountId, listAccounts } from "@/db/queries/accounts";
import { listGoals } from "@/db/queries/goals";
import { savingsAccountChoices } from "@/lib/goals/savings-options";
import { listCategoryOptions } from "@/db/queries/categories";
import { manualVersion } from "@/db/queries/manual-transactions";
import { listMerchants } from "@/db/queries/merchants";
import { countToReview } from "@/db/queries/review";
import { countMovedRows } from "@/db/queries/savings";
import { listTags } from "@/db/queries/tags";
import { countTransactions, listTransactions, sumTransactions, sumTransactionsByDay } from "@/db/queries/transactions";
import { formatCents, formatSignedCents } from "@/lib/money";
import { requireUser } from "@/lib/auth/session";
import { splitCategoryFilter } from "@/lib/splits/editor";
import { countActiveFilters } from "@/lib/transactions/active-filters";
import { encodeCursor, filtersToSearchParams, parseTransactionFilters, withParams } from "@/lib/transactions/filters";

import { AddTransactionSheet } from "./add-transaction-sheet";
import { FilterChips } from "./filter-chips";
import { FiltersSheet, type FilterValues } from "./filters-sheet";
import { PageMenu } from "./page-menu";
import { ReviewAttentionRow } from "./review-attention-row";
import { SelectionProvider } from "./selection-context";
import { TransactionSearch } from "./transaction-filters";
import { TransactionList } from "./transaction-list";

export default async function TransactionsPage({ searchParams }: PageProps<"/transactions">) {
  const user = await requireUser();
  const t = await getTranslations("transactions");
  const locale = await getLocale();
  // Invalid params are dropped by the parser, so a bad URL still renders the list.
  const filters = parseTransactionFilters(await searchParams);
  const canonical = filtersToSearchParams(filters);
  const params = canonical.toString();

  const hasFilters = params.length > 0;

  const [page, total, categories, accounts, merchants, toReview, tags, totals, movedRows, goals, manual, homeAccountId] = await Promise.all([
    listTransactions(db, user.id, filters, null),
    countTransactions(db, user.id, filters),
    listCategoryOptions(user.id, locale),
    listAccounts(user.id),
    listMerchants(db, user.id),
    countToReview(db, user.id),
    listTags(db, user.id),
    // The sum only means something for a narrowed set; the unfiltered list shows just the count.
    hasFilters ? sumTransactions(db, user.id, filters) : null,
    countMovedRows(db, user.id),
    listGoals(db, user.id),
    manualVersion(db, user.id),
    getHomeAccountId(user.id),
  ]);
  // Net per day for the rows of this page, from the server so a day cut across two pages is whole.
  const dayTotals = await sumTransactionsByDay(db, user.id, filters, [...new Set(page.items.map((i) => i.date))]);
  // Changes whenever a merchant is added, renamed or re-matched, so the list swaps its loaded rows for fresh ones.
  // A move to savings adds or removes rows franC created, so their count is part of it too; so is a row added by hand.
  const merchantVersion = `${merchants.map((m) => `${m.id}:${m.name}:${m.transactionCount}`).join("|")}#${movedRows}#${manual}`;
  const currentAccounts = accounts.filter((a) => !a.savings).map((a) => ({ id: a.id, name: a.name }));
  const defaultAccountId = currentAccounts.find((a) => a.id === homeAccountId)?.id ?? currentAccounts[0]?.id ?? "";
  const merchantFilter = filters.merchant ? merchants.find((m) => m.id === filters.merchant) : undefined;
  const tagFilter = filters.tag ? tags.find((tag) => tag.id === filters.tag) : undefined;
  const tagNames = tags.map((tag) => tag.name);
  const categoryChip = filters.category && filters.category !== "none" ? categories.find((c) => c.id === filters.category) : undefined;
  const accountFilter = filters.account ? accounts.find((a) => a.id === filters.account) : undefined;
  const showTotals = totals !== null && total > 0;

  const values: FilterValues = {
    q: canonical.get("q") ?? "",
    from: canonical.get("from") ?? "",
    to: canonical.get("to") ?? "",
    category: canonical.get("category") ?? "",
    account: canonical.get("account") ?? "",
    min: canonical.get("min") ?? "",
    max: canonical.get("max") ?? "",
    direction: filters.direction,
    transfers: filters.transfers ?? "",
    ignored: filters.ignored ?? "",
    merchant: canonical.get("merchant") ?? "",
    tag: canonical.get("tag") ?? "",
    review: filters.review ?? "",
  };
  const withoutQ = new URLSearchParams(canonical);
  withoutQ.delete("q");

  return (
    <SelectionProvider>
      <div className="theme-50f bg-50f flex flex-1 flex-col">
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-3 px-4 pb-4 md:px-8">
        <PageHeader
          engraved
          title={t("title")}
          action={
            <div className="flex items-center gap-1">
              <AddTransactionSheet accounts={currentAccounts} defaultAccountId={defaultAccountId} categories={categories} />
              <PageMenu canSelect={total > 0} exportHref={total > 0 ? `/api/export/transactions?${params}` : null} showReviewScreen={toReview > 0} />
            </div>
          }
        />
        <TransactionSearch q={values.q} otherParams={withoutQ.toString()}>
          <FiltersSheet
            values={values}
            categories={categories.map((c) => ({ id: c.id, label: c.label }))}
            accounts={accounts.length > 1 ? accounts.map((a) => ({ id: a.id, name: a.name })) : []}
            tags={tags.map((tag) => ({ id: tag.id, name: tag.name }))}
            activeCount={countActiveFilters(values)}
          />
        </TransactionSearch>
        {toReview > 0 && !filters.review && (
          <ReviewAttentionRow count={toReview} href={`/transactions${withParams(canonical, { review: "todo" })}`} />
        )}
        <FilterChips
          values={values}
          params={params}
          names={{
            category: categoryChip?.label ?? null,
            account: accountFilter?.name ?? null,
            tag: tagFilter?.name ?? null,
            merchant: merchantFilter?.name ?? null,
          }}
        />
        {/* No count when empty: the list below already explains the empty state. */}
        <div className="flex flex-col gap-0.5">
          <p className="text-muted-foreground text-sm" aria-live="polite">
            {total > 0 && <span>{t("count", { total })}</span>}
            {/* Separate span: the count keeps its own text node. */}
            {showTotals && <span> · {formatSignedCents(totals.outCents + totals.inCents, locale)}</span>}
          </p>
          {showTotals && totals.outCents < 0 && totals.inCents > 0 && (
            <p className="text-muted-foreground text-xs">
              {t("spentReceived", { spent: formatCents(-totals.outCents, locale), received: formatCents(totals.inCents, locale) })}
            </p>
          )}
        </div>
        <TransactionList
          key={params}
          initialItems={page.items}
          initialCursor={page.nextCursor ? encodeCursor(page.nextCursor) : null}
          initialDayTotals={dayTotals}
          params={params}
          hasFilters={hasFilters}
          categories={categories}
          merchantNames={merchants.map((m) => m.name)}
          tagNames={tagNames}
          dataVersion={merchantVersion}
          showAccount={accounts.length > 1}
          savingsAccounts={savingsAccountChoices(accounts, goals)}
          categoryFilter={splitCategoryFilter(filters.category, categories)}
        />
      </main>
      </div>
    </SelectionProvider>
  );
}
