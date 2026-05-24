import {
  FirestoreDataConverter,
  QueryDocumentSnapshot,
  SnapshotOptions,
  Timestamp,
  WithFieldValue,
} from "firebase/firestore";
import { Client, Invoice, Job, LineItem, Quote } from "@/types/database";
import { normalizeClientRecord } from "@/lib/client-addresses";

type SupportedDateValue = Date | Timestamp | string | number | null | undefined;

type ConverterOptions<T extends { id: string }> = {
  dateFields: Array<keyof T>;
  beforeWrite?: (data: T) => T;
  afterRead?: (data: T) => T;
};

function asDate(value: SupportedDateValue): Date | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (value instanceof Date) {
    return value;
  }

  if (value instanceof Timestamp) {
    return value.toDate();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function removeUndefined<T extends object>(value: T): T {
  const entries = Object.entries(value).filter(([, fieldValue]) => {
    return fieldValue !== undefined;
  });

  return Object.fromEntries(entries) as T;
}

function toTimestampMap<T extends { id: string }>(
  data: T,
  dateFields: Array<keyof T>,
): Omit<T, "id"> {
  const payload = { ...data } as Record<string, unknown>;
  delete payload.id;

  for (const dateField of dateFields) {
    const dateValue = asDate(payload[String(dateField)] as SupportedDateValue);

    if (dateValue) {
      payload[String(dateField)] = Timestamp.fromDate(dateValue);
    } else {
      delete payload[String(dateField)];
    }
  }

  return removeUndefined(payload) as Omit<T, "id">;
}

function makeConverter<T extends { id: string }>(
  options: ConverterOptions<T>,
): FirestoreDataConverter<T> {
  return {
    toFirestore(modelObject: WithFieldValue<T>) {
      const typedModel = modelObject as T;
      const prepared = options.beforeWrite
        ? options.beforeWrite(typedModel)
        : typedModel;

      return toTimestampMap(prepared, options.dateFields);
    },
    fromFirestore(
      snapshot: QueryDocumentSnapshot,
      snapshotOptions: SnapshotOptions,
    ) {
      const raw = snapshot.data(snapshotOptions) as Record<string, unknown>;

      for (const dateField of options.dateFields) {
        raw[String(dateField)] = asDate(
          raw[String(dateField)] as SupportedDateValue,
        );
      }

      const hydrated = {
        ...(raw as Omit<T, "id">),
        id: snapshot.id,
      } as T;

      return options.afterRead ? options.afterRead(hydrated) : hydrated;
    },
  };
}

function normalizeJob(value: Job) {
  const nextValue = { ...value };
  const rawStatus = nextValue.status as string;

  if (rawStatus === "in_progress") {
    nextValue.status = "in-progress";
  }

  if (rawStatus === "partially_paid") {
    nextValue.status = "invoiced";
  }

  if (rawStatus === "completed") {
    nextValue.status = "paid";
  }

  if (nextValue.purchaseOrderNumber) {
    nextValue.purchaseOrderNumber = nextValue.purchaseOrderNumber.trim();
  }

  if (typeof nextValue.materialMarkupPercent === "number" && Number.isFinite(nextValue.materialMarkupPercent)) {
    nextValue.materialMarkupPercent = Math.min(
      100,
      Math.max(0, Math.round(nextValue.materialMarkupPercent)),
    );
  }

  return nextValue;
}

function normalizeInvoice(value: Invoice) {
  const nextValue = { ...value };

  if (nextValue.purchaseOrderNumber) {
    nextValue.purchaseOrderNumber = nextValue.purchaseOrderNumber.trim();
  }

  return nextValue;
}

function normalizeLineItem(item: LineItem) {
  const nextItem = { ...item };

  nextItem.status = nextItem.status ?? "unbilled";

  if (nextItem.kind === "labor") {
    nextItem.laborRateType = nextItem.laborRateType ?? "builder";
  }

  if (nextItem.kind !== "labor") {
    delete nextItem.laborRateType;
    delete nextItem.laborRoleLabel;
  }

  return nextItem;
}

export const clientConverter = makeConverter<Client>({
  dateFields: ["createdAt", "updatedAt"],
  afterRead: normalizeClientRecord,
});

export const jobConverter = makeConverter<Job>({
  dateFields: ["createdAt", "updatedAt", "startDate", "dueDate"],
  beforeWrite: normalizeJob,
  afterRead: normalizeJob,
});

export const quoteConverter = makeConverter<Quote>({
  dateFields: ["createdAt", "updatedAt", "issueDate", "expiryDate"],
});

export const lineItemConverter = makeConverter<LineItem>({
  dateFields: ["createdAt", "updatedAt", "deletedAt"],
  beforeWrite: normalizeLineItem,
  afterRead: normalizeLineItem,
});

export const invoiceConverter = makeConverter<Invoice>({
  dateFields: ["createdAt", "updatedAt", "issueDate", "dueDate"],
  beforeWrite: normalizeInvoice,
  afterRead: (invoice) => {
    const normalized = normalizeInvoice(invoice);

    if (normalized.totalPaidCents > 0 && normalized.totalPaidCents < normalized.totalCents) {
      normalized.paymentStatus = "invoiced";
    }

    if (normalized.totalPaidCents >= normalized.totalCents && normalized.totalCents > 0) {
      normalized.paymentStatus = "paid";
    }

    return normalized;
  },
});
