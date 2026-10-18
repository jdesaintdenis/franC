import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { Loader2 } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-[color,background-color,box-shadow,transform] duration-150 ease-out active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:border-ring [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-xs hover:bg-primary/90",
        destructive:
          "bg-destructive text-white shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60",
        outline:
          "border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

/** The spinner replaces a leading icon element (a lucide icon passed as the first child). */
function stripLeadingIcon(children: React.ReactNode): React.ReactNode {
  const items = React.Children.toArray(children);
  const first = items[0];
  if (React.isValidElement<{ "aria-hidden"?: unknown }>(first) && typeof first.type !== "string" && first.props["aria-hidden"] !== undefined) {
    return items.slice(1);
  }
  return children;
}

function Button({
  className,
  variant,
  size,
  asChild = false,
  pending = false,
  children,
  disabled,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    /** Work in progress: a spinner replaces the leading icon, and the button is disabled and `aria-busy`. */
    pending?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";
  if (asChild) {
    return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props}>{children}</Comp>;
  }

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      {...props}
    >
      {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
      {pending ? stripLeadingIcon(children) : children}
    </Comp>
  );
}

export { Button, buttonVariants };
