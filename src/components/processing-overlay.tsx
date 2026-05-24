"use client";

import { TradeLoader } from "@/components/trade-loader";

type ProcessingOverlayProps = {
  active: boolean;
  title: string;
  subtitle?: string;
};

export function ProcessingOverlay({
  active,
  title,
  subtitle = "Please hold on, this takes just a moment.",
}: ProcessingOverlayProps) {
  if (!active) {
    return null;
  }

  return (
    <div
      className="absolute inset-0 z-50 flex animate-fade-in flex-col items-center justify-center bg-white/70 p-6 text-center backdrop-blur-[1px]"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <TradeLoader />
      <p className="mt-4 text-sm font-semibold text-[#323338]">{title}</p>
      <p className="mt-1 text-xs text-[#676879]">{subtitle}</p>
    </div>
  );
}
