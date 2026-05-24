"use client";

import { cn } from "@/lib/utils";

type TradeLoaderProps = {
  className?: string;
  /** Accessible label for screen readers */
  label?: string;
};

export function TradeLoader({ className, label = "Processing" }: TradeLoaderProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={label}
      className={cn("size-16 shrink-0", className)}
    >
      <title>{label}</title>
      {/* Surface baseline */}
      <line
        x1="10"
        y1="50"
        x2="54"
        y2="50"
        stroke="#323338"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {/* Impact burst ring */}
      <circle
        className="trade-loader-ring"
        cx="32"
        cy="34"
        r="7"
        stroke="#0073EA"
        strokeWidth="1.5"
        fill="none"
      />
      {/* Nail */}
      <g className="trade-loader-nail">
        <line
          x1="32"
          y1="22"
          x2="32"
          y2="46"
          stroke="#0073EA"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <rect x="29" y="18" width="6" height="4" rx="1" fill="#0073EA" />
      </g>
      {/* Hammer (pivot near handle end) */}
      <g className="trade-loader-hammer">
        <line
          x1="44"
          y1="14"
          x2="22"
          y2="32"
          stroke="#323338"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <path
          d="M14 28 L22 32 L18 40 L10 36 Z"
          fill="#0073EA"
          stroke="#323338"
          strokeWidth="1"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}
