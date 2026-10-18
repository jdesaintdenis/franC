import { CategoryMarker } from "@/components/category-marker";
import { categoryDisplayColor } from "@/lib/category-color";

/** The 32px tinted tile that carries a category's marker in 50 F rows. Decorative: the name sits beside it. */
export function CategoryTile({ icon, color }: { icon: string | null; color: string | null | undefined }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-8 shrink-0 items-center justify-center rounded-[10px] text-lg"
      style={{ backgroundColor: `color-mix(in srgb, ${categoryDisplayColor(color)} 18%, transparent)` }}
    >
      <CategoryMarker icon={icon} color={color} />
    </span>
  );
}
