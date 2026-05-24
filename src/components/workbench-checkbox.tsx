"use client";

import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

type WorkbenchCheckboxProps = {
  checked: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  ariaLabel: string;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  className?: string;
};

export function WorkbenchCheckbox({
  checked,
  indeterminate = false,
  disabled = false,
  ariaLabel,
  onClick,
  className,
}: WorkbenchCheckboxProps) {
  const isActive = checked || indeterminate;

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? "mixed" : checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex size-4 cursor-pointer items-center justify-center rounded-[3px] border border-[#c3c6d4] bg-white transition-all duration-150 ease-in-out",
        "hover:border-[#0073EA] focus:outline-none focus:ring-2 focus:ring-[#0073EA]/30 active:scale-90",
        isActive && "border-[#0073EA] bg-[#0073EA] hover:border-[#0073EA]",
        "group-hover:border-[#0073EA]",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
    >
      {indeterminate ? (
        <Minus className="size-3 text-white stroke-[3]" aria-hidden />
      ) : checked ? (
        <Check className="size-3 text-white stroke-[3]" aria-hidden />
      ) : null}
    </button>
  );
}
