import { sumInvoicedAmountFromHistory } from "@/lib/line-item-invoicing";
import { sumQuotedAmountFromHistory } from "@/lib/line-item-quoting";
import type {
  GeneratedDocumentType,
  LineItem,
  LineItemBillingStatus,
  LineItemInvoicedHistoryEntry,
  LineItemQuotedHistoryEntry,
} from "@/types/database";

const CENTS_EPS = 1;

export function filterInvoicedHistoryForDocumentRemoval(
  history: LineItemInvoicedHistoryEntry[] | undefined,
  documentId: string,
): LineItemInvoicedHistoryEntry[] {
  return (history ?? []).filter((entry) => entry.invoiceId !== documentId);
}

export function filterQuotedHistoryForDocumentRemoval(
  history: LineItemQuotedHistoryEntry[] | undefined,
  documentId: string,
): LineItemQuotedHistoryEntry[] {
  return (history ?? []).filter((entry) => entry.quoteId !== documentId);
}

export function recomputeLineItemBillingStatus(
  item: LineItem,
  invoicedHistory: LineItemInvoicedHistoryEntry[],
  quotedHistory: LineItemQuotedHistoryEntry[],
): LineItemBillingStatus {
  const invSum = sumInvoicedAmountFromHistory(invoicedHistory, item.totalCents);
  const quoteSum = sumQuotedAmountFromHistory(quotedHistory, item.totalCents);

  if (invSum >= item.totalCents - CENTS_EPS) {
    return "invoiced";
  }
  if (quoteSum >= item.totalCents - CENTS_EPS) {
    return "quoted";
  }
  if (invSum === 0 && quoteSum === 0) {
    return "unbilled";
  }
  if (invSum > 0) {
    return quoteSum > 0 ? "quoted" : "unbilled";
  }
  return "quoted";
}

export function buildLineItemUpdatesAfterDocumentDelete(
  item: LineItem,
  documentId: string,
  documentType: GeneratedDocumentType,
): {
  invoicedHistory: LineItemInvoicedHistoryEntry[];
  quotedHistory: LineItemQuotedHistoryEntry[];
  status: LineItemBillingStatus;
  clearDocRef: boolean;
} | null {
  const hadInvoiceLink =
    item.invoicedHistory?.some((entry) => entry.invoiceId === documentId) ?? false;
  const hadQuoteLink = item.quotedHistory?.some((entry) => entry.quoteId === documentId) ?? false;
  const hadLegacyDocRef = item.docRef === documentId;

  if (!hadInvoiceLink && !hadQuoteLink && !hadLegacyDocRef) {
    return null;
  }

  const invoicedHistory =
    documentType === "invoice"
      ? filterInvoicedHistoryForDocumentRemoval(item.invoicedHistory, documentId)
      : [...(item.invoicedHistory ?? [])];
  const quotedHistory =
    documentType === "quote"
      ? filterQuotedHistoryForDocumentRemoval(item.quotedHistory, documentId)
      : [...(item.quotedHistory ?? [])];

  const status = recomputeLineItemBillingStatus(item, invoicedHistory, quotedHistory);

  return {
    invoicedHistory,
    quotedHistory,
    status,
    clearDocRef: hadLegacyDocRef,
  };
}
