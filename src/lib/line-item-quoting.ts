import type { JobDocumentRecord, LineItem, LineItemQuotedHistoryEntry } from "@/types/database";

const CENTS_EPS = 1;

/** Sum of `amountAllocated` from quote history; missing amount counts as full line `totalCents` once per entry. */
export function sumQuotedAmountFromHistory(
  history: LineItemQuotedHistoryEntry[] | undefined,
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
 * Quote links for UI: persisted `quotedHistory`, plus a synthetic entry when legacy `docRef`
 * points at a quote document and history is still empty.
 */
export function getQuoteLinkedHistory(
  item: LineItem,
  documentsById: Map<string, JobDocumentRecord>,
): LineItemQuotedHistoryEntry[] {
  const fromArray = [...(item.quotedHistory ?? [])].filter((e) => e && typeof e.quoteId === "string");

  if (fromArray.length > 0) {
    return fromArray;
  }

  if (!item.docRef) {
    return [];
  }

  const doc = documentsById.get(item.docRef);
  if (!doc || doc.type !== "quote") {
    return [];
  }

  return [
    {
      quoteId: item.docRef,
      quoteNumber: doc.documentNumber,
      date: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : String(doc.createdAt),
      amountAllocated: item.totalCents,
    },
  ];
}

/** Sum cents already attributed to quotes (persisted history + legacy single-quote heuristic). */
export function priorQuoteAllocatedSumFromFirestore(item: LineItem): number {
  const rawSum = sumQuotedAmountFromHistory(item.quotedHistory, item.totalCents);
  if (rawSum > 0) {
    return rawSum;
  }
  if (item.docRef && (!item.quotedHistory || item.quotedHistory.length === 0) && item.status === "quoted") {
    return item.totalCents;
  }
  return 0;
}
