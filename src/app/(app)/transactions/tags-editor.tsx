"use client";

import { X } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import { useToast } from "@/components/toast";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { TagRef } from "@/db/queries/tags";
import { networkErrorMessage } from "@/lib/offline";
import { MAX_TAG_LENGTH, MAX_TAGS_PER_TRANSACTION } from "@/lib/tags/validate";

import { addTags, removeTag } from "./tags-actions";

interface Props {
  transactionId: string;
  initialTags: TagRef[];
  /** The user's tag names, suggested while typing. */
  tagNames: string[];
  /** The transaction's tags changed; `tags` is the full new list. */
  onChanged: (tags: TagRef[]) => void;
}

/**
 * Chips for the transaction's tags plus an input that creates or reuses tags by name.
 * Enter, a comma or picking a suggestion adds at once (no Add button); the chip's ✕ removes.
 * Every change shows a toast with Undo.
 */
export function TagsEditor({ transactionId, initialTags, tagNames, onChanged }: Props) {
  const t = useTranslations("transactions.tags");
  const tErrors = useTranslations("transactions.tags.errors");
  const toast = useToast();
  const inputId = useId();
  const listId = useId();
  const [tags, setTags] = useState(initialTags);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const attached = new Set(tags.map((tag) => tag.name.toLowerCase()));
  const suggestions = tagNames.filter((n) => !attached.has(n.toLowerCase()));

  function update(next: TagRef[]) {
    setTags(next);
    onChanged(next);
  }

  function errorText(code: Parameters<typeof tErrors>[0]): string {
    return tErrors(code, { max: MAX_TAGS_PER_TRANSACTION, length: MAX_TAG_LENGTH });
  }

  /** Removes tags by id; used by the chip ✕ and by Undo of an add. */
  async function removeMany(removed: TagRef[], base: TagRef[]): Promise<TagRef[] | null> {
    for (const tag of removed) {
      const result = await removeTag({ transactionId, tagId: tag.id });
      if (result.status === "error") {
        setError(errorText(result.error));
        return null;
      }
    }
    const ids = new Set(removed.map((r) => r.id));
    return base.filter((x) => !ids.has(x.id));
  }

  function add(text: string) {
    const cleaned = text.replace(/^[\s,]+|[\s,]+$/g, "");
    if (cleaned === "") {
      setInput("");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const result = await addTags({ transactionId, input: cleaned });
        if (result.status === "error") {
          setError(errorText(result.error));
          return;
        }
        const before = new Set(tags.map((x) => x.id));
        const added = result.tags.filter((x) => !before.has(x.id));
        setInput("");
        update(result.tags);
        if (added.length === 0) return;
        toast.show({
          message: t("added", { count: added.length, name: added[0].name }),
          undo: {
            onUndo: async () => {
              try {
                const next = await removeMany(added, result.tags);
                if (next) update(next);
              } catch {
                toast.show({ message: networkErrorMessage(tErrors("saveFailed"), tErrors("offline")), variant: "error" });
              }
            },
          },
        });
      } catch {
        setError(networkErrorMessage(tErrors("saveFailed"), tErrors("offline")));
      }
    });
  }

  function remove(tag: TagRef) {
    setError(null);
    startTransition(async () => {
      try {
        const next = await removeMany([tag], tags);
        if (!next) return;
        update(next);
        toast.show({
          message: t("removed", { name: tag.name }),
          undo: {
            onUndo: async () => {
              try {
                const result = await addTags({ transactionId, input: tag.name });
                if (result.status === "error") {
                  toast.show({ message: errorText(result.error), variant: "error" });
                  return;
                }
                update(result.tags);
              } catch {
                toast.show({ message: networkErrorMessage(tErrors("saveFailed"), tErrors("offline")), variant: "error" });
              }
            },
          },
        });
      } catch {
        setError(networkErrorMessage(tErrors("saveFailed"), tErrors("offline")));
      }
    });
  }

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    // A comma ends the tag(s) typed so far.
    if (value.includes(",")) {
      add(value);
      return;
    }
    // Picking from the datalist fires `input` as a replacement (or without an input type) with a whole name.
    const inputType = (e.nativeEvent as InputEvent).inputType;
    const picked = inputType === undefined || inputType === "insertReplacementText";
    if (picked && suggestions.some((n) => n.toLowerCase() === value.trim().toLowerCase())) {
      add(value);
      return;
    }
    setInput(value);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={inputId}>{t("label")}</Label>
      {tags.length > 0 && (
        <ul aria-label={t("listLabel")} className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <li key={tag.id} className="bg-muted inline-flex max-w-full items-center rounded-full pl-3 text-sm">
              <span className="truncate">{tag.name}</span>
              <button
                type="button"
                aria-label={t("remove", { name: tag.name })}
                disabled={isPending}
                onClick={() => remove(tag)}
                className="hover:bg-accent focus-visible:ring-ring/50 flex size-11 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-[3px] disabled:opacity-50"
              >
                <X aria-hidden="true" className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          add(input);
        }}
      >
        <Input
          id={inputId}
          value={input}
          onChange={onChange}
          list={listId}
          placeholder={t("placeholder")}
          autoComplete="off"
          enterKeyHint="done"
          maxLength={200}
          className="h-11 w-full text-base md:text-sm"
        />
        <datalist id={listId}>
          {suggestions.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
      </form>
      <p className="text-muted-foreground text-xs">{t("hint")}</p>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
