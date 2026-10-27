import { getLocale } from "next-intl/server";

import { db } from "@/db/client";
import { hasKeptIncome } from "@/db/queries/recurring";
import { listAccounts } from "@/db/queries/accounts";
import { listGoals } from "@/db/queries/goals";
import { savingsAccountChoices } from "@/lib/goals/savings-options";
import { listCategoryOptions } from "@/db/queries/categories";
import { listNotFound, manualVersion } from "@/db/queries/manual-transactions";
import { listMerchants } from "@/db/queries/merchants";
import { listTags } from "@/db/queries/tags";
import { listReviewQueue } from "@/db/queries/review";
import { requireUser } from "@/lib/auth/session";
import { currentDate } from "@/lib/dashboard/month";

import { NotFoundList } from "./not-found-list";
import { ReviewQueue } from "./review-queue";

export default async function ReviewPage() {
  const user = await requireUser();
  const locale = await getLocale();

  const [queue, categories, accounts, merchants, tags, goals, notFound, manual, keepsIncome] = await Promise.all([
    listReviewQueue(db, user.id),
    listCategoryOptions(user.id, locale),
    listAccounts(user.id),
    listMerchants(db, user.id),
    listTags(db, user.id),
    listGoals(db, user.id),
    listNotFound(db, user.id, currentDate(new Date())),
    manualVersion(db, user.id),
    hasKeptIncome(db, user.id),
  ]);
  // Changes whenever a merchant is added, renamed or re-matched, so the queue swaps its rows for fresh ones.
  // A row added by hand that gets linked marks its bank row reviewed, so that fingerprint is part of it.
  const merchantVersion = `${merchants.map((m) => `${m.id}:${m.name}:${m.transactionCount}`).join("|")}#${manual}`;

  return (
    <div className="theme-50f bg-50f flex flex-1 flex-col">
      <ReviewQueue
        initialItems={queue.items}
        initialTotal={queue.total}
        categories={categories}
        merchantNames={merchants.map((m) => m.name)}
        tagNames={tags.map((tag) => tag.name)}
        showAccount={accounts.length > 1}
        savingsAccounts={savingsAccountChoices(accounts, goals)}
        dataVersion={merchantVersion}
        notFound={<NotFoundList items={notFound} showAccount={accounts.length > 1} />}
        keepsIncome={keepsIncome}
      />
    </div>
  );
}
