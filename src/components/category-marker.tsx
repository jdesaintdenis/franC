import { categoryDisplayColor } from "@/lib/category-color";
import { cn } from "@/lib/utils";

/**
 * A category's visual marker: its emoji when it has one, otherwise the colour dot.
 * Decorative (`aria-hidden`): the category name is always rendered next to it.
 * Emojis use the device's own emoji font, so no image set is bundled.
 */
export function CategoryMarker({
  icon,
  color,
  className,
  style,
}: {
  icon?: string | null;
  color: string | null | undefined;
  /** Size and shape overrides for the dot; the emoji is sized by font-size instead. */
  className?: string;
  style?: React.CSSProperties;
}) {
  if (icon) {
    return (
      <span aria-hidden="true" data-testid="category-icon" className="shrink-0 leading-none">
        {icon}
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      data-testid="category-dot"
      className={cn("size-3 shrink-0 rounded-full", className)}
      style={{ backgroundColor: categoryDisplayColor(color), ...style }}
    />
  );
}
