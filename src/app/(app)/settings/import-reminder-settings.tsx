"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useTranslations } from "next-intl";

import { useToast } from "@/components/toast";
import { DEFAULT_REMINDER_DAYS, MAX_REMINDER_DAYS, MIN_REMINDER_DAYS } from "@/lib/import-reminder/staleness";

import { setImportReminderDaysAction } from "./import-reminder-actions";

function parseDays(text: string): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const n = Number(text);
  return n >= MIN_REMINDER_DAYS && n <= MAX_REMINDER_DAYS ? n : null;
}

/** `days` null = reminder off. `push` is the optional notification toggle, rendered under the fields. */
export function ImportReminderSettings({ days, push }: { days: number | null; push?: ReactNode }) {
  const t = useTranslations("settings.importReminder");
  const tToast = useTranslations("common.toast");
  const toast = useToast();
  const [enabled, setEnabled] = useState(days !== null);
  const [text, setText] = useState(String(days ?? DEFAULT_REMINDER_DAYS));
  const [saved, setSaved] = useState(days ?? DEFAULT_REMINDER_DAYS);
  // Only the field's own validation message lives here; a failed save is a toast.
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save(next: number | null, rollback: () => void, redo: () => void) {
    setError(null);
    startTransition(async () => {
      const failed = () => {
        rollback();
        toast.show({
          message: t("error"),
          variant: "error",
          action: { label: tToast("retry"), onAction: redo },
        });
      };
      try {
        const result = await setImportReminderDaysAction(next);
        if (result.status === "error") {
          failed();
          return;
        }
        if (next !== null) setSaved(next);
      } catch {
        failed();
      }
    });
  }

  function toggle(on: boolean) {
    const days = on ? (parseDays(text) ?? saved) : null;
    setEnabled(on);
    if (on) setText(String(days));
    save(
      days,
      () => setEnabled(!on),
      () => toggle(on),
    );
  }

  function commit() {
    const parsed = parseDays(text);
    if (parsed === null) {
      setError(t("invalid", { min: MIN_REMINDER_DAYS, max: MAX_REMINDER_DAYS }));
      return;
    }
    if (parsed === saved) {
      setError(null);
      return;
    }
    const previous = saved;
    save(
      parsed,
      () => setText(String(previous)),
      () => {
        setText(String(parsed));
        commit();
      },
    );
  }

  return (
    <div aria-busy={pending} className="flex flex-col">
      <div className="flex flex-col gap-1 px-3.5 py-1">
        <label className="flex min-h-[52px] cursor-pointer items-center justify-between gap-3 font-semibold">
          {t("toggle")}
          {/* A native checkbox drawn as a switch: keeps keyboard and test semantics. */}
          <input
            type="checkbox"
            role="switch"
            className="bg-gauge-off checked:bg-primary after:bg-foreground relative h-6 w-10 shrink-0 cursor-pointer appearance-none rounded-full transition-colors after:absolute after:top-0.5 after:left-0.5 after:size-5 after:rounded-full after:transition-transform checked:after:translate-x-4"
            checked={enabled}
            disabled={pending}
            onChange={(e) => toggle(e.target.checked)}
          />
        </label>
        {enabled && (
          <div className="flex min-h-12 flex-wrap items-center gap-2 pb-2 text-sm">
            <label htmlFor="import-reminder-days">{t("daysBefore")}</label>
            <input
              id="import-reminder-days"
              type="number"
              inputMode="numeric"
              min={MIN_REMINDER_DAYS}
              max={MAX_REMINDER_DAYS}
              step={1}
              value={text}
              disabled={pending}
              aria-invalid={error !== null}
              onChange={(e) => setText(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit();
              }}
              className="border-input bg-background h-10 w-20 rounded-md border px-2 text-base"
            />
            <span>{t("daysAfter", { count: Number.parseInt(text, 10) || 0 })}</span>
          </div>
        )}
        {enabled && push}
      </div>
      {error && (
        <p role="alert" className="text-destructive px-3.5 pb-2 text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
