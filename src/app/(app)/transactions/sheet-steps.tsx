"use client";

import { ChevronLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NATIVE_SELECT_CLASS } from "@/components/ui/native-select";

/** A step replaces the main view: back button, a heading that takes focus, then the content. */
export function StepFrame({ title, onBack, children }: { title: string; onBack: () => void; children: ReactNode }) {
  const t = useTranslations("transactions.sheet");
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus();
  }, []);

  return (
    <section aria-labelledby={headingId} data-testid="sheet-step" className="flex flex-col gap-4">
      <div className="-ml-2 flex items-center gap-1">
        <button
          type="button"
          onClick={onBack}
          aria-label={t("back")}
          className="hover:bg-accent focus-visible:ring-ring/50 flex size-11 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-[3px]"
        >
          <ChevronLeft aria-hidden="true" className="size-5" />
        </button>
        <h2 id={headingId} ref={heading} tabIndex={-1} className="min-w-0 text-base font-semibold outline-none">
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}

export interface RuleDraft {
  matchType: string;
  pattern: string;
}

/** The "Adjust" step: match type and pattern prefilled from the proposal, one Create rule button. */
export function RuleForm({
  initial,
  categoryName,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  initial: RuleDraft;
  categoryName: string;
  pending: boolean;
  error: string | null;
  onSubmit: (draft: RuleDraft) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("transactions.categorize");
  const tRule = useTranslations("transactions.sheet.rule");
  const tActions = useTranslations("common.actions");
  const [matchType, setMatchType] = useState(initial.matchType);
  const [pattern, setPattern] = useState(initial.pattern);

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ matchType, pattern });
      }}
    >
      <p className="text-muted-foreground text-sm">{tRule("stepIntro", { category: categoryName })}</p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="rule-type">{t("matchType")}</Label>
        <select
          id="rule-type"
          value={matchType}
          onChange={(e) => setMatchType(e.target.value)}
          disabled={pending}
          className={`${NATIVE_SELECT_CLASS} h-11`}
        >
          <option value="contains">{t("contains")}</option>
          <option value="equals">{t("equals")}</option>
          <option value="regex">{t("regex")}</option>
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="rule-pattern">{t("pattern")}</Label>
        <Input
          id="rule-pattern"
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          maxLength={200}
          disabled={pending}
          className="h-11 w-full text-base md:text-sm"
        />
      </div>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="button" variant="outline" className="h-11 flex-1" disabled={pending} onClick={onCancel}>
          {tActions("cancel")}
        </Button>
        <Button type="submit" className="h-11 flex-1" disabled={pending}>
          {pending ? tRule("creating") : tRule("create")}
        </Button>
      </div>
    </form>
  );
}
