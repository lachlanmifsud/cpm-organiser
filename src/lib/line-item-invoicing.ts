import type { JobDocumentRecord, LineItem, LineItemInvoicedHistoryEntry } from "@/types/database";

const CENTS_EPS = 1;

/** Sum of `amountAllocated` from history; missing amount counts as full line `totalCents` once per entry. */
export function sumInvoicedAmountFromHistory(
  history: LineItemInvoicedHistoryEntry[] | undefined,
  lineTotalCents: number,
): number {
  if (!history?.length) {
    return 0;
  }
  return history.reduce((sum, entry) => {
    const allocated =
      typeof entry.amountAllocated === "number" && Number.isFinite(entry.amountAllocated)
        ? entry.amountAllocated
        : lineTotalCents;
    return sum + allocated;
  }, 0);
}

/**
 * Invoice links for UI: persisted `invoicedHistory`, plus a synthetic entry when legacy `docRef`
 * points at an invoice document and history is still empty.
 */
export function getInvoiceLinkedHistory(
  item: LineItem,
  documentsById: Map<string, JobDocumentRecord>,
): LineItemInvoicedHistoryEntry[] {
  const fromArray = [...(item.invoicedHistory ?? [])].filter((e) => e && typeof e.invoiceId === "string");

  if (fromArray.length > 0) {
    return fromArray;
  }

  if (!item.docRef) {
    return [];
  }

  const doc = documentsById.get(item.docRef);
  if (!doc || doc.type !== "invoice") {
    return [];
  }

  return [
    {
      invoiceId: item.docRef,
      invoiceNumber: doc.documentNumber,
      date: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : String(doc.createdAt),
      amountAllocated: item.totalCents,
    },
  ];
}

/** True when this line can no longer be placed on another invoice (fully allocated in cents). */
export function isLineItemFullyInvoiced(item: LineItem, documentsById: Map<string, JobDocumentRecord>): boolean {
  const history = getInvoiceLinkedHistory(item, documentsById);
  const allocated = sumInvoicedAmountFromHistory(history, item.totalCents);
  return allocated >= item.totalCents - CENTS_EPS;
}

/** Sum cents already attributed to invoices (persisted history + legacy single-invoice heuristic). */
export function priorInvoiceAllocatedSumFromFirestore(item: LineItem): number {
  const rawSum = sumInvoicedAmountFromHistory(item.invoicedHistory, item.totalCents);
  if (rawSum > 0) {
    return rawSum;
  }
  if (item.docRef && (!item.invoicedHistory || item.invoicedHistory.length === 0) && item.status === "invoiced") {
    return item.totalCents;
  }
  return 0;
}
