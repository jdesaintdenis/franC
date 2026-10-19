"use client";

import { useTranslations } from "next-intl";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import type { BankDecision } from "@/lib/categorize/bank";
import { effectiveDecisions, planItems, withCreateDefaults } from "@/lib/categorize/bank-decisions";
import { toDraft, type CsvMapping } from "@/lib/import/mapping";

import { HomeSection } from "../home/home-section";
import { AccountPills } from "./account-pills";
import { ActionBar } from "./action-bar";
import { BankCategoriesStep } from "./bank-categories-step";
import { ColumnMapping } from "./column-mapping";
import { DropZone } from "./drop-zone";
import { ImportResult } from "./import-result";
import { ImportSummary } from "./import-summary";
import { OperationsSample } from "./operations-sample";
import { confirmImport, previewImport, type ConfirmState, type PreviewState } from "./actions";
import { SyncNow } from "../accounts/bank/sync-now";

/** franC account id → the bank account that feeds it, for the Sync now card. */
export type SyncLinks = Record<string, { linkId: string; bankName: string }>;

export function ImportFlow({
  accounts,
  defaultAccountId,
  syncLinks = {},
  initialFile = null,
}: {
  accounts: { id: string; name: string }[];
  defaultAccountId: string;
  syncLinks?: SyncLinks;
  /** A file handed in by code (e.g. a shared file): its preview starts as soon as the flow mounts. */
  initialFile?: File | null;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [accountId, setAccountId] = useState(defaultAccountId);
  // Bumped on reset to remount the uncontrolled file input and both actions' state.
  const [session, setSession] = useState(0);
  const t = useTranslations("import.flow");

  if (accounts.length === 0) {
    return <p className="text-muted-foreground">{t("noAccount")}</p>;
  }

  return (
    <ImportSteps
      key={session}
      // Only the first mount reads it: after Cancel or "Import another file" the zone shows again.
      initialFile={session === 0 ? initialFile : null}
      accounts={accounts}
      syncLinks={syncLinks}
      file={file}
      setFile={setFile}
      accountId={accountId}
      setAccountId={setAccountId}
      reset={() => {
        setFile(null);
        setSession((s) => s + 1);
      }}
    />
  );
}

/** The columns a mapping reads, on one line: "Date operation · Libelle operation · Debit / Credit". */
function mappingSummary(m: CsvMapping): string {
  const amount = m.amount.kind === "single" ? m.amount.column : `${m.amount.debit} / ${m.amount.credit}`;
  return [m.date, m.label, amount].join(" · ");
}

function ImportSteps({
  initialFile,
  accounts,
  syncLinks,
  file,
  setFile,
  accountId,
  setAccountId,
  reset,
}: {
  initialFile: File | null;
  accounts: { id: string; name: string }[];
  syncLinks: SyncLinks;
  file: File | null;
  setFile: (file: File | null) => void;
  accountId: string;
  setAccountId: (id: string) => void;
  reset: () => void;
}) {
  const t = useTranslations("import");
  const tActions = useTranslations("common.actions");
  const [preview, previewAction, previewPending] = useActionState<PreviewState, FormData>(
    previewImport,
    undefined,
  );
  const [confirmed, confirmAction] = useActionState<ConfirmState, FormData>(confirmImport, undefined);
  const [confirmPending, startConfirm] = useTransition();
  const [, startPreview] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Explicit choices over the plan's suggestions; null = deliberately undecided.
  const [overrides, setOverrides] = useState<Record<string, BankDecision | null>>({});
  // The preview being sent back to the Columns step ("Change"). Tied to that very state object, so
  // the next preview, which is a new object, ends the edit by itself.
  const [editingFor, setEditingFor] = useState<PreviewState>(undefined);

  /** Keeps the file (the confirm step re-sends it) and starts reading it: the Columns step first, the preview once a mapping comes with it. */
  function startPreviewFor(chosen: File, mapping?: CsvMapping, forAccountId = accountId) {
    setFile(chosen);
    const formData = new FormData();
    formData.set("file", chosen);
    formData.set("accountId", forAccountId);
    if (mapping) formData.set("mapping", JSON.stringify(mapping));
    startPreview(() => previewAction(formData));
  }

  // A file chosen before hydration finished (slow phone, cold start) fires its
  // change event with no handler attached, so pick it up from the input itself;
  // a file handed in as `initialFile` starts the same way.
  useEffect(() => {
    const input = fileInputRef.current;
    const chosen = input?.files?.[0] ?? initialFile;
    if (chosen && !file) {
      startPreviewFor(chosen);
      if (input) input.value = "";
    }
    // Mount-only: later changes go through the drop zone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (confirmed?.status === "done") {
    return <ImportResult done={confirmed} filename={file?.name ?? ""} reset={reset} />;
  }

  const editing = preview?.status === "preview" && editingFor === preview;
  if (preview?.status === "mapping" || (preview?.status === "preview" && editing)) {
    const first = preview.status === "mapping";
    return (
      <ColumnMapping
        key={first ? "first" : "edit"}
        filename={preview.filename}
        accountName={preview.accountName}
        columns={preview.columns}
        initial={first ? preview.draft : toDraft(preview.mapping)}
        remembered={first && preview.remembered}
        pending={previewPending}
        onContinue={(mapping) => file && startPreviewFor(file, mapping, preview.accountId)}
        onCancel={first ? reset : () => setEditingFor(undefined)}
      />
    );
  }

  if (preview?.status === "preview") {
    const { counts } = preview;
    const decisions = effectiveDecisions(preview.bankPlan, { ...withCreateDefaults(preview.bankPlan), ...overrides });
    const confirmNow = () => {
      if (!file) return;
      const formData = new FormData();
      formData.set("file", file);
      formData.set("accountId", preview.accountId);
      formData.set("mapping", JSON.stringify(preview.mapping));
      formData.set("bankDecisions", JSON.stringify(decisions));
      startConfirm(() => confirmAction(formData));
    };
    return (
      <section aria-label={t("preview.region")} className="flex flex-col gap-4">
        <ImportSummary
          filename={preview.filename}
          accountName={preview.accountName}
          counts={counts}
          dateRange={preview.dateRange}
          flows={preview.flows}
          errors={preview.errors}
          errorsOmitted={preview.errorsOmitted}
          onChangeColumns={() => setEditingFor(preview)}
          columnsSummary={mappingSummary(preview.mapping)}
        />

        {preview.bankPlan.groups.length > 0 && (
          <BankCategoriesStep
            plan={preview.bankPlan}
            options={preview.categoryOptions}
            decisions={decisions}
            disabled={confirmPending}
            onChange={(key, decision) => setOverrides((prev) => ({ ...prev, [key]: decision }))}
            onCreateAll={() =>
              setOverrides((prev) => {
                const next = { ...prev };
                for (const item of planItems(preview.bankPlan)) {
                  if (!decisions[item.key]) next[item.key] = { action: "create" };
                }
                return next;
              })
            }
          />
        )}

        {preview.sample.length > 0 && <OperationsSample sample={preview.sample} total={counts.new} />}

        {confirmed?.status === "error" && (
          <p role="alert" className="text-destructive text-sm">
            {t(`errors.${confirmed.error}`)}
          </p>
        )}

        <ActionBar>
          {counts.new > 0 ? (
            <Button
              type="button"
              className="h-12 w-full rounded-xl font-bold"
              pending={confirmPending}
              disabled={!file}
              onClick={confirmNow}
            >
              {confirmPending ? t("preview.importing") : t("preview.importCount", { count: counts.new })}
            </Button>
          ) : (
            <Button type="button" className="h-12 w-full rounded-xl font-bold" onClick={reset}>
              {t("preview.chooseAnother")}
            </Button>
          )}
          {counts.new > 0 ? (
            <button
              type="button"
              onClick={reset}
              disabled={confirmPending}
              className="text-muted-foreground min-h-10 text-[13px] font-semibold"
            >
              {tActions("cancel")}
            </button>
          ) : (
            counts.duplicate > 0 && (
              // Rows merged into hand-entered or synced ones, and bank categories to backfill, still need the commit.
              <button
                type="button"
                onClick={confirmNow}
                disabled={confirmPending || !file}
                className="text-muted-foreground min-h-10 text-[13px] font-semibold"
              >
                {t("preview.recordAnyway")}
              </button>
            )
          )}
        </ActionBar>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {accounts.length > 1 && (
        <HomeSection headingId="import-account-heading" title={t("flow.accountTitle")} bare>
          <AccountPills accounts={accounts} value={accountId} onChange={setAccountId} disabled={previewPending} />
        </HomeSection>
      )}
      {syncLinks[accountId] && (
        <section className="bg-card flex flex-col gap-3 rounded-[10px] border p-3.5" aria-labelledby="sync-card-title" data-testid="import-sync">
          <div className="flex flex-col gap-0.5">
            <h2 id="sync-card-title" className="font-semibold wrap-anywhere">
              {t("sync.title", { bank: syncLinks[accountId].bankName })}
            </h2>
            <p className="text-muted-foreground text-sm">{t("sync.body")}</p>
          </div>
          <SyncNow linkIds={[syncLinks[accountId].linkId]} />
        </section>
      )}
      <HomeSection headingId="import-file-heading" title={t("flow.fileTitle")} bare>
        <DropZone
          inputRef={fileInputRef}
          onFile={startPreviewFor}
          pendingFilename={previewPending ? (file?.name ?? "") : null}
          invalid={preview?.status === "error"}
          errorId={preview?.status === "error" ? "import-error" : undefined}
        />
      </HomeSection>
      {preview?.status === "error" && !previewPending && (
        <p id="import-error" role="alert" className="text-destructive text-sm">
          {t(`errors.${preview.error}`)}
        </p>
      )}
    </div>
  );
}
