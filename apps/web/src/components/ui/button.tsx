import { Children, forwardRef, isValidElement, type ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type Size = "sm" | "md" | "lg" | "icon";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-accent-contrast hover:brightness-110 active:brightness-95 shadow-sm",
  secondary: "bg-raised text-ink border border-line hover:border-line-strong",
  outline: "border border-line-strong text-ink hover:bg-raised",
  ghost: "text-muted hover:text-ink hover:bg-raised",
  danger: "bg-danger text-white hover:brightness-110",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-[0.8125rem] gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-12 px-6 text-[0.9375rem] gap-2",
  icon: "h-9 w-9 shrink-0",
};

/**
 * Buttons never let their label overflow.
 *
 * Only the text runs are wrapped in a truncating span. Wrapping everything in
 * one span would make an icon part of the same inline run, so a long label
 * would push the icon onto a second line and stretch the button. Icons stay
 * flex children; the text is the only thing that shortens.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "primary", size = "md", type = "button", children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex items-center justify-center rounded-[10px] font-medium",
        "transition-[filter,background-color,border-color,color] duration-150",
        "disabled:pointer-events-none disabled:opacity-50",
        "max-w-full whitespace-nowrap",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {Children.map(children, (child) =>
        isValidElement(child) ? child : <span className="min-w-0 truncate">{child}</span>,
      )}
    </button>
  );
});
