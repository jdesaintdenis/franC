import { getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/page-header";
import { PageTitle } from "@/components/page-title";
import { db } from "@/db/client";
import { getLastUsedAccountId, listAccounts } from "@/db/queries/accounts";
import { syncLinkByAccount } from "@/db/queries/bank-connections";
import { listImports } from "@/db/queries/imports";
import { pickDefaultAccountId } from "@/lib/accounts/default";
import { requireUser } from "@/lib/auth/session";
import { isBankSyncAllowed } from "@/lib/bank-sync/server";
import { parseAccountParam } from "@/lib/dashboard/account";
import { SHARED_PARAM } from "@/lib/import/shared-file";

import { ImportFlow } from "./import-flow";
import { ImportHistory } from "./import-history";
import { SharedImportFlow } from "./shared-import-flow";

export default async function ImportPage({ searchParams }: PageProps<"/import">) {
  const user = await requireUser();
  const t = await getTranslations("import");
  const nav = await getTranslations("common.nav");
  const params = await searchParams;
  const [allAccounts, imports, lastUsedId, syncLinks] = await Promise.all([
    listAccounts(user.id),
    listImports(db, user.id),
    getLastUsedAccountId(db, user.id),
    // Only for users who have bank sync: a link left from before BANK_SYNC_EMAILS changed shows nothing.
    isBankSyncAllowed(user.email) ? syncLinkByAccount(db, user.id) : Promise.resolve(new Map<string, { linkId: string; bankName: string }>()),
  ]);

  // Savings accounts take no imports (Slice 52): they are filled by Move to savings.
  const accounts = allAccounts.filter((a) => !a.savings);

  // Opened from the share sheet (src/app/sw.ts): the flow first picks up the shared file.
  const Flow = params[SHARED_PARAM] === "1" ? SharedImportFlow : ImportFlow;

  return (
    <div className="theme-50f bg-50f flex flex-1 flex-col">
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-4 md:p-8">
      <PageHeader
        title={<PageTitle>{t("title")}</PageTitle>}
        back={{ href: "/accounts", label: nav("backToAccounts") }}
        className="pt-0 md:pt-0"
      />
      <Flow
        accounts={accounts.map((a) => ({ id: a.id, name: a.name }))}
        syncLinks={Object.fromEntries(syncLinks)}
        // `?account=` (from the import reminder) beats the last-used default when it is one of the user's.
        defaultAccountId={
          parseAccountParam(
            params.account,
            accounts.map((a) => a.id),
          ) ?? pickDefaultAccountId(accounts, lastUsedId)
        }
      />
      <ImportHistory imports={imports} showAccount={allAccounts.length > 1} />
    </main>
    </div>
  );
}
