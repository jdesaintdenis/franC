import { ArrowLeftRight, Split } from "lucide-react";

import { categoryDisplayColor, categoryTint } from "@/lib/category-color";
import { cn } from "@/lib/utils";

interface AvatarCategory {
  color: string;
  icon: string | null;
  parentName: string | null;
}

/** The first letter of a name, upper-cased; "?" when there is none. */
function initialOf(name: string): string {
  const first = Array.from(name.trim())[0];
  return first ? first.toLocaleUpperCase() : "?";
}

/**
 * The 36 px circle at the start of a transaction row. Decorative (`aria-hidden`): the name and the
 * category are always written next to it. A top-level category with an emoji shows the emoji;
 * anything else shows the first letter of the name in the category colour (muted when there is
 * no category). Splits and internal transfers get their own icon.
 */
export function TransactionAvatar({
  name,
  category,
  split = false,
  transfer = false,
  className,
}: {
  /** The name shown on the row, for the initial. */
  name: string;
  category: AvatarCategory | null;
  split?: boolean;
  transfer?: boolean;
  className?: string;
}) {
  const base = "flex size-9 shrink-0 items-center justify-center rounded-full text-base leading-none font-semibold";
  if (transfer) {
    return (
      <span aria-hidden="true" data-testid="avatar-transfer" className={cn(base, "bg-muted text-muted-foreground", className)}>
        <ArrowLeftRight className="size-4" />
      </span>
    );
  }
  if (split) {
    return (
      <span aria-hidden="true" data-testid="avatar-split" className={cn(base, "bg-brand-soft text-brand", className)}>
        <Split className="size-4" />
      </span>
    );
  }
  if (!category) {
    return (
      <span aria-hidden="true" className={cn(base, "bg-muted text-muted-foreground", className)}>
        {initialOf(name)}
      </span>
    );
  }
  const color = categoryDisplayColor(category.color);
  // 15 % of the category colour over transparent reads as a soft tint on both the light and the dark card.
  const style = { color, backgroundColor: categoryTint(category.color) };
  if (category.icon) {
    return (
      <span aria-hidden="true" data-testid="category-icon" className={cn(base, "text-xl", className)} style={{ backgroundColor: style.backgroundColor }}>
        {category.icon}
      </span>
    );
  }
  return (
    <span aria-hidden="true" data-testid="category-dot" className={cn(base, className)} style={style}>
      {initialOf(name)}
    </span>
  );
}
