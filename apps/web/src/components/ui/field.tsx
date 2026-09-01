import {
  forwardRef,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

import { cn } from "@/lib/utils";

/**
 * Focus is left to the global :focus-visible outline rather than being replaced.
 *
 * These fields used to clear the outline on plain focus and draw a quarter
 * opacity ring instead. Two things were wrong with it. Plain focus fires on a
 * mouse click as well as a keyboard, and clearing the outline left keyboard
 * users with only the ring. And the opacity modifier never applied: Tailwind
 * cannot compute one against an oklch() custom property, so it silently shipped
 * a full strength ring, which is not what the design said.
 *
 * The utility names are spelled out nowhere above on purpose: Tailwind scans
 * raw source text, so writing one in a comment regenerates the rule.
 *
 * `focus-visible:` keeps the ring for keyboard use, on top of the 2px outline in
 * index.css rather than instead of it.
 */
const BASE =
  "w-full max-w-full rounded-[10px] border border-line bg-sunken px-3 text-sm text-ink " +
  "placeholder:text-faint transition-colors " +
  "focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent " +
  "disabled:cursor-not-allowed disabled:opacity-60";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(BASE, "h-10", className)} {...props} />;
  },
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea ref={ref} className={cn(BASE, "py-2.5 leading-relaxed", className)} {...props} />
  );
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <select ref={ref} className={cn(BASE, "h-10 cursor-pointer pr-8", className)} {...props}>
        {children}
      </select>
    );
  },
);

export function Label({
  className,
  children,
  htmlFor,
}: {
  className?: string;
  children: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <label htmlFor={htmlFor} className={cn("text-[0.8125rem] font-medium text-muted", className)}>
      {children}
    </label>
  );
}
