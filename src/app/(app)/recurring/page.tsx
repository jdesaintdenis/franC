import { Repeat } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { z } from "zod";

import { AccountLinks } from "@/components/account-links";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { db } from "@/db/client";
import { listAccounts } from "@/db/queries/accounts";
import { listBudgets } from "@/db/queries/budgets";
import { listCategoryOptions } from "@/db/queries/categories";
import { listOpenPriceAlerts } from "@/db/queries/price-alerts";
import { countTransactions } from "@/db/queries/transactions";
import { listRecurring, listRecurringHistory } from "@/db/queries/recurring";
import { requireUser } from "@/lib/auth/session";
import { parseAccountParam } from "@/lib/dashboard/account";
import { recurringEmptyAction } from "@/lib/empty-state/choice";
import { recurringBudgetLink } from "@/lib/recurring/budget-link";
import {
  parseRecurringView,
  recurringHref,
  usedCategoryIds,
} from "@/lib/recurring/list-view";

import { EmptyDetectButton } from "./empty-detect-button";
import { DetectNowButton } from "./detect-now-button";
import { RecurringScreen } from "./recurring-screen";
import type { RecurringViewItem } from "./view-item";

/** How many charges each item's sheet lists. */
const HISTORY_LIMIT = 12;

export default async function RecurringPage({
  searchParams,
}: PageProps<"/recurring">) {
  const t = await getTranslations("recurring");
  const nav = await getTranslations("common.nav");
  const user = await requireUser();
  const locale = await getLocale();
  const params = await searchParams;
  const [accounts, categoryOptions] = await Promise.all([
    listAccounts(user.id),
    listCategoryOptions(user.id, locale),
  ]);
  const accountId = parseAccountParam(
    params.account,
    accounts.map((a) => a.id),
  );
  const view = parseRecurringView(
    params,
    categoryOptions.map((c) => c.id),
  );
  const scope = { accountId: accountId ?? undefined };
  const [listed, alerts, budgets] = await Promise.all([
    listRecurring(db, user.id, {
      ...scope,
      includeEnded: true,
      includeDismissed: true,
    }),
    listOpenPriceAlerts(db, user.id, scope),
    listBudgets(db, user.id),
  ]);
  const budgetedIds = new Set(budgets.map((b) => b.categoryId));
  // Preloaded for every item so a sheet opens without a request (and works offline once loaded).
  const history = await listRecurringHistory(
    db,
    user.id,
    listed.map((i) => i.id),
    HISTORY_LIMIT,
  );
  // Only needed for the empty state: Detect when there is something to scan, Import otherwise.
  const transactionCount =
    listed.length === 0
      ? await countTransactions(db, user.id, { direction: "all" })
      : 0;
  const alertOf = new Map(alerts.map((a) => [a.recurringId, a]));
  const categoryById = new Map(categoryOptions.map((c) => [c.id, c]));
  const items: RecurringViewItem[] = listed.map((item) => {
    const category = item.categoryId
      ? categoryById.get(item.categoryId)
      : undefined;
    return {
      ...item,
      alert: alertOf.get(item.id) ?? null,
      history: history.get(item.id) ?? [],
      avatarCategory: category
        ? {
            color: category.color,
            icon: item.categoryIcon,
            parentName: category.parentName,
          }
        : null,
      budget: recurringBudgetLink(item, categoryOptions, budgetedIds),
    };
  });

  // `?item=` opens that item's sheet (Home's "Needs attention" links here); anything else is ignored.
  const itemParam = z.uuid().safeParse(params.item);
  const initialItemId =
    itemParam.success && items.some((i) => i.id === itemParam.data)
      ? itemParam.data
      : null;
  const used = usedCategoryIds(listed, categoryOptions);

  return (
    <div className="theme-50f bg-50f flex flex-1 flex-col">
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-3 px-4 pb-4 md:px-8">
        <PageHeader
          title={
            <span className="font-title text-[22px] font-bold tracking-[0.1em] uppercase">
              {t("title")}
            </span>
          }
          back={{ href: "/budget", label: nav("backToPlan") }}
          action={<DetectNowButton />}
        />
        {accounts.length > 1 && (
          <AccountLinks
            accounts={accounts.map((a) => ({ id: a.id, name: a.name }))}
            activeId={accountId}
            hrefFor={(id) => recurringHref(id, view)}
          />
        )}
        {items.length === 0 ? (
          <EmptyState
            icon={Repeat}
            title={t("empty.title")}
            body={t("empty.body")}
            action={
              recurringEmptyAction(transactionCount) === "detect" ? (
                <EmptyDetectButton label={t("empty.detect")} />
              ) : (
                <Link
                  href="/import"
                  className={buttonVariants({ className: "h-11" })}
                >
                  {t("empty.import")}
                </Link>
              )
            }
          />
        ) : (
          <RecurringScreen
            items={items}
            view={view}
            accountId={accountId}
            categoryParents={categoryOptions.map((c) => ({
              id: c.id,
              parentId: c.parentId,
            }))}
            chipCategories={categoryOptions
              .filter((c) => used.ids.has(c.id))
              .map((c) => ({ id: c.id, label: c.label }))}
            hasUncategorized={used.hasUncategorized}
            showAccount={accounts.length > 1}
            initialItemId={initialItemId}
          />
        )}
      </main>
    </div>
  );
}
