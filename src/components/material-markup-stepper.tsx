"use client";

import { Minus, Plus } from "lucide-react";
import {
  clampMaterialMarkupPercent,
  MATERIAL_MARKUP_STEP,
  MAX_MATERIAL_MARKUP_PERCENT,
  MIN_MATERIAL_MARKUP_PERCENT,
} from "@/lib/material-markup";
import { cn } from "@/lib/utils";

type MaterialMarkupStepperProps = {
  value: number;
  onChange: (next: number) => void;
  disabled?: boolean;
  className?: string;
  variant?: "default" | "compact" | "footer";
};

export function MaterialMarkupStepper({
  value,
  onChange,
  disabled = false,
  className,
  variant = "default",
}: MaterialMarkupStepperProps) {
  const pct = clampMaterialMarkupPercent(value);
  const atMin = pct <= MIN_MATERIAL_MARKUP_PERCENT;
  const atMax = pct >= MAX_MATERIAL_MARKUP_PERCENT;
  const isCompact = variant === "compact";
  const isFooter = variant === "footer";

  return (
    <span
      className={cn(
        "inline-flex items-center font-semibold tabular-nums",
        isFooter
          ? "mt-1 w-fit gap-2 rounded-md border border-[#D0D4E4] bg-white px-2 py-0.5 text-xs shadow-sm"
          : isCompact
            ? "gap-1 rounded-lg border border-[#E6E9EF]/80 bg-white px-1.5 py-0.5 font-mono text-[11px] font-bold text-[#0073EA]"
            : "gap-2 rounded-lg border border-[#E6E9EF] bg-white p-1 font-mono text-sm font-bold text-[#0073EA]",
        className,
      )}
    >
      <button
        type="button"
        disabled={disabled || atMin}
        aria-label="Decrease material markup by 5 percent"
        className={cn(
          "inline-flex items-center justify-center text-[#676879] transition-colors hover:text-[#0073EA] disabled:cursor-not-allowed disabled:opacity-40",
          isFooter
            ? "size-5 rounded hover:bg-[#F5F6F8]"
            : isCompact
              ? "size-4 rounded hover:bg-[#F5F6F8]"
              : "size-7 rounded-lg hover:bg-[#F5F6F8]",
        )}
        onClick={() => onChange(clampMaterialMarkupPercent(pct - MATERIAL_MARKUP_STEP))}
      >
        <Minus className={isFooter ? "size-3" : isCompact ? "size-2.5" : "size-3"} />
      </button>
      <span
        className={cn(
          "min-w-[2.5ch] text-center",
          isFooter && "font-bold text-[#FDAB3D]",
          !isFooter && "font-bold text-[#0073EA]",
        )}
      >
        {pct}%
      </span>
      <button
        type="button"
        disabled={disabled || atMax}
        aria-label="Increase material markup by 5 percent"
        className={cn(
          "inline-flex items-center justify-center text-[#676879] transition-colors hover:text-[#0073EA] disabled:cursor-not-allowed disabled:opacity-40",
          isFooter
            ? "size-5 rounded hover:bg-[#F5F6F8]"
            : isCompact
              ? "size-4 rounded hover:bg-[#F5F6F8]"
              : "size-7 rounded-lg hover:bg-[#F5F6F8]",
        )}
        onClick={() => onChange(clampMaterialMarkupPercent(pct + MATERIAL_MARKUP_STEP))}
      >
        <Plus className={isFooter ? "size-3" : isCompact ? "size-2.5" : "size-3"} />
      </button>
    </span>
  );
}
