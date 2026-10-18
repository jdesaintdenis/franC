/**
 * Shared styling for native <select>s. Same focus-visible ring as ui/input.tsx
 * so keyboard focus is visible; callers add their own height (h-10 / h-11).
 */
export const NATIVE_SELECT_CLASS =
  "border-input bg-background w-full rounded-md border px-3 text-base shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 disabled:opacity-50 md:text-sm";

/** Native checkbox: outline ring on keyboard focus, matching the other controls. */
export const NATIVE_CHECKBOX_CLASS =
  "accent-primary focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none rounded-sm";
