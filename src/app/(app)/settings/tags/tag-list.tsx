"use client";

import { Pencil, Search, Tag, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import { ListRowTransition } from "@/components/list-row-transition";
import { EmptyState } from "@/components/empty-state";
import { ManageRow } from "@/components/manage/manage-row";
import type { RowMenuItem } from "@/components/manage/row-menu";
import { useSheetParam } from "@/components/manage/use-sheet-param";
import { useToast } from "@/components/toast";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import type { TagSnapshot, TagWithCount } from "@/db/queries/tags";
import { networkErrorMessage } from "@/lib/offline";
import { MAX_TAG_LENGTH } from "@/lib/tags/validate";

import { deleteTagAction, renameTagAction, restoreTagAction } from "./actions";

export function TagList({ tags }: { tags: TagWithCount[] }) {
  const t = useTranslations("settings.tags");
  const tErrors = useTranslations("settings.tags.errors");
  const tSettings = useTranslations("settings");
  const toast = useToast();
  const sheet = useSheetParam();
  const [, startTransition] = useTransition();
  const editing = sheet.editing ? (tags.find((tag) => tag.id === sheet.editing) ?? null) : null;

  const offline = (message: string) => networkErrorMessage(message, tErrors("offline"));

  async function undo(snapshot: TagSnapshot) {
    try {
      const result = await restoreTagAction(snapshot);
      if (result.status === "error") {
        // A tag with that name now exists: say so rather than a generic failure.
        toast.show({
          message: result.error === "conflict" ? tErrors("conflict") : tSettings("manage.undoFailed"),
          variant: "error",
        });
      } else {
        toast.show({ message: t("toast.restored", { name: snapshot.tag.name }) });
      }
    } catch {
      toast.show({ message: offline(tSettings("manage.undoFailed")), variant: "error" });
    }
  }

  function remove(tag: TagWithCount) {
    startTransition(async () => {
      try {
        const result = await deleteTagAction(tag.id);
        if (result.status === "error") {
          toast.show({ message: tSettings("manage.deleteFailed"), variant: "error" });
          return;
        }
        toast.show({
          message: t("toast.deleted", { name: tag.name }),
          undo: { onUndo: () => undo(result.snapshot) },
        });
      } catch {
        toast.show({ message: offline(tSettings("manage.deleteFailed")), variant: "error" });
      }
    });
  }

  function menuFor(tag: TagWithCount): RowMenuItem[] {
    return [
      { label: t("menu.rename"), icon: <Pencil className="size-4" aria-hidden="true" />, onSelect: () => sheet.openEdit(tag.id) },
      {
        label: tSettings("manage.seeTransactions"),
        icon: <Search className="size-4" aria-hidden="true" />,
        href: `/transactions?tag=${tag.id}`,
      },
      {
        label: tSettings("manage.delete"),
        icon: <Trash2 className="size-4" aria-hidden="true" />,
        destructive: true,
        onSelect: () => remove(tag),
      },
    ];
  }

  return (
    <>
      {tags.length === 0 ? (
        <EmptyState
          icon={Tag}
          title={t("empty.title")}
          body={t("empty.body")}
          action={
            <Link href="/transactions" className={buttonVariants({ className: "h-11" })}>
              {t("empty.action")}
            </Link>
          }
        />
      ) : (
        <ul aria-label={t("listLabel")} className="divide-y rounded-lg border py-1">
          {tags.map((tag) => (
            <ListRowTransition key={tag.id} scope="tag" id={tag.id}>
<li>
              <ManageRow
                testId="tag-row"
                name={tag.name}
                caption={t("transactionCount", { count: tag.transactionCount })}
                onOpen={() => sheet.openEdit(tag.id)}
                openLabel={t("row.rename", { name: tag.name })}
                menuLabel={tSettings("manage.options", { name: tag.name })}
                menu={menuFor(tag)}
              />
            </li>
</ListRowTransition>
          ))}
        </ul>
      )}

      <Sheet open={editing !== null} onOpenChange={(open) => !open && sheet.close()}>
        {editing && (
          <SheetContent className="theme-50f" title={t("sheet.renameTitle")}>
            <RenameForm
              key={editing.id}
              tag={editing}
              onSaved={() => {
                sheet.close();
                toast.show({ message: t("toast.saved") });
              }}
              onCancel={sheet.close}
            />
          </SheetContent>
        )}
      </Sheet>
    </>
  );
}

function RenameForm({ tag, onSaved, onCancel }: { tag: TagWithCount; onSaved: () => void; onCancel: () => void }) {
  const t = useTranslations("settings.tags");
  const tErrors = useTranslations("settings.tags.errors");
  const [name, setName] = useState(tag.name);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          try {
            const result = await renameTagAction({ tagId: tag.id, name });
            if (result.status === "error") {
              setError(tErrors(result.error, { length: MAX_TAG_LENGTH }));
              return;
            }
            onSaved();
          } catch {
            setError(networkErrorMessage(tErrors("saveFailed"), tErrors("offline")));
          }
        });
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`tag-rename-${tag.id}`}>{t("nameLabel")}</Label>
        <Input
          id={`tag-rename-${tag.id}`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={MAX_TAG_LENGTH * 2}
          autoComplete="off"
          required
          disabled={pending}
          className="h-11 text-base md:text-sm"
        />
      </div>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" pending={pending} className="h-11">
          {pending ? t("saving") : t("save")}
        </Button>
        <Button type="button" variant="outline" className="h-11" disabled={pending} onClick={onCancel}>
          {t("cancel")}
        </Button>
      </div>
    </form>
  );
}
