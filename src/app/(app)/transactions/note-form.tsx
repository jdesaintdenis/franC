"use client";

import { Check } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { useToast } from "@/components/toast";
import { Label } from "@/components/ui/label";
import { createAutosave, type Autosave } from "@/lib/autosave";
import { networkErrorMessage } from "@/lib/offline";
import { MAX_NOTE_LENGTH } from "@/lib/tags/validate";

import { saveNote } from "./tags-actions";

/** The counter only appears once the limit is near, so a short note isn't nagged. */
const COUNTER_FROM = MAX_NOTE_LENGTH - 100;
/** How long typing must pause before the note is saved. */
export const NOTE_AUTOSAVE_MS = 1000;

interface Props {
  transactionId: string;
  initialNote: string | null;
  onSaved: (note: string | null) => void;
  /** Lets the sheet focus the field when it opens on "Note and tags". */
  textareaRef?: React.Ref<HTMLTextAreaElement>;
}

type SaveState = "idle" | "saving" | "saved";

/**
 * The user's own note on a transaction. It saves 1 s after typing stops and when the field
 * loses focus or the sheet closes; an empty note removes it. One toast with Undo per edit
 * (when the field is left), not one per pause.
 */
export function NoteForm({ transactionId, initialNote, onSaved, textareaRef }: Props) {
  const t = useTranslations("transactions.note");
  const tErrors = useTranslations("transactions.note.errors");
  const toast = useToast();
  const id = useId();
  const [value, setValue] = useState(initialNote ?? "");
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<SaveState>("idle");

  // Latest closures for the long-lived debouncer, written after each render.
  const latest = useRef({ onSaved, toast, t, tErrors, transactionId });
  useEffect(() => {
    latest.current = { onSaved, toast, t, tErrors, transactionId };
  });
  // The note as stored, and as it was before this series of edits (what Undo restores).
  const stored = useRef(initialNote ?? "");
  const editBase = useRef<string | null>(null);
  const savedSinceToast = useRef(false);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const autosave = useRef<Autosave<string> | null>(null);

  /** The "Note saved · Undo" toast: once per series of edits, never per pause. */
  const announce = useCallback(() => {
    if (!savedSinceToast.current) return;
    savedSinceToast.current = false;
    const { toast, t, onSaved, transactionId, tErrors } = latest.current;
    const previous = editBase.current ?? "";
    const current = stored.current;
    editBase.current = null;
    toast.show({
      message: current === "" ? t("removed") : t("saved"),
      undo: {
        onUndo: async () => {
          try {
            const result = await saveNote({ transactionId, note: previous });
            if (result.status === "error") {
              toast.show({ message: tErrors(result.error), variant: "error" });
              return;
            }
            stored.current = result.note ?? "";
            autosave.current?.setSaved(stored.current);
            setValue(stored.current);
            setState("idle");
            onSaved(result.note);
          } catch {
            toast.show({ message: networkErrorMessage(tErrors("saveFailed"), tErrors("offline")), variant: "error" });
          }
        },
      },
    });
  }, []);

  useEffect(() => {
    const doSave = (text: string) => {
      const run = async () => {
        const { onSaved, tErrors, transactionId } = latest.current;
        setError(null);
        setState("saving");
        try {
          const result = await saveNote({ transactionId, note: text });
          if (result.status === "error") {
            setError(tErrors(result.error));
            setState("idle");
            return;
          }
          stored.current = result.note ?? "";
          savedSinceToast.current = true;
          setState("saved");
          onSaved(result.note);
        } catch {
          setError(networkErrorMessage(tErrors("saveFailed"), tErrors("offline")));
          setState("idle");
        }
      };
      // One write at a time, so a slow earlier save cannot land after a newer one.
      queue.current = queue.current.then(run);
      return queue.current;
    };
    const instance = createAutosave<string>({
      delayMs: NOTE_AUTOSAVE_MS,
      save: doSave,
      equals: (a, b) => a.trim() === b.trim(),
    });
    instance.setSaved(stored.current);
    autosave.current = instance;
    // Leaving the sheet saves what is pending and says so once.
    return () => {
      void instance.flush().then(announce);
    };
  }, [announce]);

  async function leave() {
    const a = autosave.current;
    if (!a) return;
    await a.flush();
    announce();
  }

  function change(next: string) {
    if (editBase.current === null) editBase.current = stored.current;
    setValue(next);
    setState("idle");
    // A failed save must not make the same text look "already saved".
    autosave.current?.setSaved(stored.current);
    autosave.current?.schedule(next);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>{t("label")}</Label>
        <span role="status" className="text-muted-foreground flex min-h-5 items-center gap-1 text-xs">
          {state === "saving" && t("saving")}
          {state === "saved" && (
            <>
              <Check aria-hidden="true" className="size-3.5 text-positive" />
              {t("savedShort")}
            </>
          )}
        </span>
      </div>
      <textarea
        id={id}
        ref={textareaRef}
        value={value}
        onChange={(e) => change(e.target.value)}
        onBlur={() => void leave()}
        rows={3}
        maxLength={MAX_NOTE_LENGTH}
        placeholder={t("placeholder")}
        className="border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 w-full resize-y rounded-md border bg-transparent px-3 py-2 text-base shadow-xs outline-none focus-visible:ring-[3px] md:text-sm"
      />
      {value.length >= COUNTER_FROM && (
        <span className="text-muted-foreground ml-auto text-xs tabular-nums">
          {t("counter", { count: value.length, max: MAX_NOTE_LENGTH })}
        </span>
      )}
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
