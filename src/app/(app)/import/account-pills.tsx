"use client";

import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

/** The account an import goes into, as pills. Hidden by the caller when there is only one account. */
export function AccountPills({
  accounts,
  value,
  onChange,
  disabled,
}: {
  accounts: { id: string; name: string }[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("import.flow");
  return (
    <div role="radiogroup" aria-label={t("accountTitle")} className="flex flex-wrap gap-2">
      {accounts.map((a) => {
        const on = a.id === value;
        return (
          <button
            key={a.id}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onChange(a.id)}
            className={cn(
              "focus-visible:ring-ring/50 min-h-10 rounded-full px-4 text-[13px] font-semibold break-all outline-none focus-visible:ring-[3px] disabled:opacity-50",
              on ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground",
            )}
          >
            {a.name}
          </button>
        );
      })}
    </div>
  );
}
