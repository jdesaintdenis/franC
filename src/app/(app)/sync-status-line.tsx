"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTransition } from "react";

import { useToast } from "@/components/toast";
import { networkErrorMessage } from "@/lib/offline";

import { syncNowAction } from "./accounts/bank/sync-action";

/**
 * Home's one-line sync status under the header: when the bank was last read, or what's wrong, with
 * Sync now (every imported link) and a quiet toast for the result. Reconnect states link to the
 * Bank connection page instead, where Reconnect lives: Sync now can't work there.
 */
export function SyncStatusLine({
  kind,
  text,
  linkIds,
}: {
  kind: "synced" | "never" | "failing" | "rateLimited" | "reconnect";
  /** The sentence, translated on the server. */
  text: string;
  linkIds: string[];
}) {
  const t = useTranslations("dashboard.syncLine");
  const tSync = useTranslations("settings.bankConnection.sync");
  const tConnection = useTranslations("settings.bankConnection");
  const toast = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const action = "text-primary inline-flex min-h-11 items-center font-medium underline underline-offset-2";

  const run = () =>
    startTransition(async () => {
      try {
        const state = await syncNowAction(linkIds);
        if (state.status === "error") toast.show({ message: state.error, variant: "error" });
        else {
          toast.show({
            message: tSync("result", { count: state.inserted }),
            action: state.inserted > 0 ? { label: tSync("review"), onAction: () => router.push("/review") } : undefined,
          });
        }
      } catch {
        toast.show({ message: networkErrorMessage(tSync("errors.failed"), tConnection("offline")), variant: "error" });
      }
      router.refresh();
    });

  return (
    <p className="text-muted-foreground -mt-2 flex flex-wrap items-center gap-x-2 px-1 text-sm" data-testid="sync-line">
      <span>{text}</span>
      <span aria-hidden="true">·</span>
      {kind === "reconnect" ? (
        <Link href="/accounts/bank" className={action}>
          {t("openConnection")}
        </Link>
      ) : (
        <button type="button" className={action} disabled={pending} onClick={run}>
          {pending ? t("syncing") : t("syncNow")}
        </button>
      )}
    </p>
  );
}
