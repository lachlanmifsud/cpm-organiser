"use client";

import { AlertTriangle } from "lucide-react";
import type { JobDocumentRecord, LineItem } from "@/types/database";
import { getInvoiceLinkedHistory } from "@/lib/line-item-invoicing";
import { getQuoteLinkedHistory } from "@/lib/line-item-quoting";

type PreFlightWarningModalProps = {
  flaggedItems: LineItem[];
  documentsById: Map<string, JobDocumentRecord>;
  onReviewSelection: () => void;
  onProceedAnyway: () => void;
};

function historyLabel(
  flaggedItems: LineItem[],
  documentsById: Map<string, JobDocumentRecord>,
): string {
  const hasInvoice = flaggedItems.some(
    (item) => getInvoiceLinkedHistory(item, documentsById).length > 0,
  );
  const hasQuote = flaggedItems.some(
    (item) => getQuoteLinkedHistory(item, documentsById).length > 0,
  );

  if (hasInvoice && hasQuote) {
    return "invoices or quotes";
  }
  if (hasInvoice) {
    return "invoices";
  }
  return "quotes";
}

export function PreFlightWarningModal({
  flaggedItems,
  documentsById,
  onReviewSelection,
  onProceedAnyway,
}: PreFlightWarningModalProps) {
  const label = historyLabel(flaggedItems, documentsById);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#323338]/30 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pre-flight-warning-title"
        className="animate-monday-in w-full max-w-md rounded-lg border border-[#D0D4E4] bg-white p-6 shadow-monday-2"
      >
        <AlertTriangle className="mb-4 size-6 text-[#FDAB3D]" />
        <h2 id="pre-flight-warning-title" className="text-lg font-bold text-[#323338]">
          Previously Processed Items Detected
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-[#676879]">
          You are about to include {flaggedItems.length} item{flaggedItems.length === 1 ? "" : "s"}{" "}
          that have already been added to previous {label}.
        </p>

        <div className="mt-3 max-h-32 overflow-y-auto rounded-md border border-[#E6E9EF] bg-[#F5F6F8] p-2">
          <ul className="space-y-1">
            {flaggedItems.map((item) => (
              <li key={item.id} className="truncate text-sm text-[#323338]">
                {item.description}
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
          <button
            type="button"
            onClick={onReviewSelection}
            className="rounded-md border border-[#C3C6D4] px-4 py-2 text-[#323338] transition-colors duration-150 ease-in-out hover:bg-[#F5F6F8] active:scale-[0.97]"
          >
            Review Selection
          </button>
          <button
            type="button"
            onClick={onProceedAnyway}
            className="rounded-md bg-[#FDAB3D] px-4 py-2 font-semibold text-[#323338] transition-all duration-150 ease-in-out hover:bg-[#FDAB3D]/90 active:scale-[0.97]"
          >
            Proceed Anyway
          </button>
        </div>
      </div>
    </div>
  );
}
