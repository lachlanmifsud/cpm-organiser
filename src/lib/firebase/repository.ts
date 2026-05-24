import {
  addDoc,
  arrayUnion,
  collection,
  deleteField,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes, deleteObject } from "firebase/storage";
import { COLLECTIONS } from "@/lib/firebase/collections";
import {
  clientConverter,
  invoiceConverter,
  jobConverter,
  lineItemConverter,
  quoteConverter,
} from "@/lib/firebase/converters";
import { auth, db, storage } from "@/lib/firebase/client";
import {
  getBusinessProfileCompletionIssues,
  sanitizeBusinessProfileForFirestore,
} from "@/lib/settings/business-profile-completion";
import { priorInvoiceAllocatedSumFromFirestore } from "@/lib/line-item-invoicing";
import { priorQuoteAllocatedSumFromFirestore } from "@/lib/line-item-quoting";
import type { DocumentRefinementPayload } from "@/lib/document-refinement-payload";
import {
  createDocumentVersion,
  isDocumentDeleteLocked,
  serializeDocumentVersion,
  serializeRefinementPayload,
} from "@/lib/document-versions";
import { buildLineItemUpdatesAfterDocumentDelete } from "@/lib/line-item-document-cascade";
import {
  Client,
  CurrencyCents,
  DocumentTemplate,
  GeneratedDocumentType,
  Invoice,
  Job,
  JobDocumentRecord,
  JobFileRecord,
  JobWorkflowStatus,
  LineItem,
  PdfTemplateStyle,
  UserSettings,
} from "@/types/database";

const ACTIVE_JOB_STATUSES: JobWorkflowStatus[] = [
  "new",
  "quoted",
  "in-progress",
  "invoiced",
];
const COMPLETED_JOB_STATUSES: JobWorkflowStatus[] = ["paid"];
const LEGACY_ACTIVE_JOB_STATUSES = ["in_progress", "partially_paid"];
const LEGACY_COMPLETED_JOB_STATUSES = ["completed"];

function getClientsRef() {
  return db
    ? collection(db, COLLECTIONS.clients).withConverter(clientConverter)
    : null;
}

function getJobsRef() {
  return db ? collection(db, COLLECTIONS.jobs).withConverter(jobConverter) : null;
}

function getQuotesRef() {
  return db ? collection(db, COLLECTIONS.quotes).withConverter(quoteConverter) : null;
}

function getInvoicesRef() {
  return db
    ? collection(db, COLLECTIONS.invoices).withConverter(invoiceConverter)
    : null;
}

function getLineItemsRef() {
  return db
    ? collection(db, COLLECTIONS.lineItems).withConverter(lineItemConverter)
    : null;
}

function getFilesRef() {
  return db ? collection(db, COLLECTIONS.receipts) : null;
}

function getUserSettingsRef() {
  return db ? collection(db, COLLECTIONS.userSettings) : null;
}

function getJobDocumentsRef(jobId: string) {
  const jobsRef = getJobsRef();

  if (!jobsRef) {
    return null;
  }

  return collection(doc(jobsRef, jobId), "documents");
}

function getCurrentUidOrThrow() {
  const uid = auth?.currentUser?.uid;

  if (!uid) {
    throw new Error("You must be logged in to perform this action");
  }

  return uid;
}

function mapOptionalString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

/** Firestore rejects `undefined`; strip it recursively from plain objects and arrays. */
function deepOmitUndefined<T>(input: T): T {
  if (input === undefined || input === null) {
    return input;
  }
  if (typeof input !== "object") {
    return input;
  }
  if (input instanceof Timestamp) {
    return input;
  }
  if (input instanceof Date) {
    return input;
  }
  if (Array.isArray(input)) {
    return input.map((item) => deepOmitUndefined(item)) as T;
  }
  const obj = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) {
      continue;
    }
    out[key] = deepOmitUndefined(value);
  }
  return out as T;
}

function mapPostalAddress(raw: unknown) {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }

  const value = raw as Record<string, unknown>;
  const line2 = mapOptionalString(value.line2);

  return {
    line1: String(value.line1 ?? ""),
    ...(line2 !== undefined ? { line2 } : {}),
    suburb: String(value.suburb ?? ""),
    state: String(value.state ?? ""),
    postcode: String(value.postcode ?? ""),
    country: String(value.country ?? "Australia"),
  };
}

function mapTemplateRecord(raw: unknown): DocumentTemplate | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const value = raw as Record<string, unknown>;
  const createdAtRaw = value.createdAt;
  const updatedAtRaw = value.updatedAt;

  return {
    id: String(value.id ?? ""),
    name: String(value.name ?? "Untitled template"),
    prompt: String(value.prompt ?? ""),
    style: value.style as PdfTemplateStyle,
    createdAt:
      createdAtRaw instanceof Timestamp ? createdAtRaw.toDate() : new Date(String(createdAtRaw ?? Date.now())),
    updatedAt:
      updatedAtRaw instanceof Timestamp ? updatedAtRaw.toDate() : new Date(String(updatedAtRaw ?? Date.now())),
    createdByUid: String(value.createdByUid ?? ""),
  };
}

function mapUserSettingsRecord(uid: string, raw: Record<string, unknown>): UserSettings {
  const createdAtRaw = raw.createdAt;
  const updatedAtRaw = raw.updatedAt;
  const businessProfileRaw = (raw.businessProfile ?? {}) as Record<string, unknown>;

  return {
    id: uid,
    createdByUid: String(raw.createdByUid ?? uid),
    createdAt:
      createdAtRaw instanceof Timestamp ? createdAtRaw.toDate() : new Date(String(createdAtRaw ?? Date.now())),
    updatedAt:
      updatedAtRaw instanceof Timestamp ? updatedAtRaw.toDate() : new Date(String(updatedAtRaw ?? Date.now())),
    businessProfile: {
      businessName: String(businessProfileRaw.businessName ?? ""),
      abnOrAcn: String(businessProfileRaw.abnOrAcn ?? ""),
      address: mapPostalAddress(businessProfileRaw.address),
      bankName: String(businessProfileRaw.bankName ?? ""),
      bsb: String(businessProfileRaw.bsb ?? ""),
      accountNumber: String(businessProfileRaw.accountNumber ?? ""),
      paymentTerms: String(businessProfileRaw.paymentTerms ?? "Net 7 days"),
      logoUrl: mapOptionalString(businessProfileRaw.logoUrl),
      logoStoragePath: mapOptionalString(businessProfileRaw.logoStoragePath),
    },
    templates: Array.isArray(raw.templates)
      ? raw.templates.map(mapTemplateRecord).filter((template): template is DocumentTemplate => Boolean(template))
      : [],
    invoiceSystemPrompt:
      typeof raw.invoiceSystemPrompt === "string" ? raw.invoiceSystemPrompt : undefined,
    quoteSystemPrompt: typeof raw.quoteSystemPrompt === "string" ? raw.quoteSystemPrompt : undefined,
  };
}

function mapJobDocumentRecord(
  id: string,
  raw: Record<string, unknown>,
): JobDocumentRecord {
  const createdAtRaw = raw.createdAt;
  const updatedAtRaw = raw.updatedAt;

  return {
    id,
    jobId: String(raw.jobId ?? ""),
    clientId: String(raw.clientId ?? ""),
    type: (raw.type as GeneratedDocumentType) ?? "invoice",
    documentNumber: String(raw.documentNumber ?? ""),
    templateId: mapOptionalString(raw.templateId),
    templateName: mapOptionalString(raw.templateName),
    fileName: String(raw.fileName ?? "document.pdf"),
    storagePath: String(raw.storagePath ?? ""),
    downloadUrl: String(raw.downloadUrl ?? ""),
    subtotalCents: Number(raw.subtotalCents ?? 0),
    markupCents: Number(raw.markupCents ?? 0),
    taxCents: Number(raw.taxCents ?? 0),
    totalCents: Number(raw.totalCents ?? 0),
    lineItemIds: Array.isArray(raw.lineItemIds) ? raw.lineItemIds.map((item) => String(item)) : [],
    status: typeof raw.status === "string" ? (raw.status as JobDocumentRecord["status"]) : undefined,
    refinementPayload:
      raw.refinementPayload && typeof raw.refinementPayload === "object"
        ? (raw.refinementPayload as Record<string, unknown>)
        : undefined,
    versions: Array.isArray(raw.versions)
      ? (raw.versions as JobDocumentRecord["versions"])
      : undefined,
    createdByUid: String(raw.createdByUid ?? ""),
    createdAt:
      createdAtRaw instanceof Timestamp ? createdAtRaw.toDate() : new Date(String(createdAtRaw ?? Date.now())),
    updatedAt:
      updatedAtRaw instanceof Timestamp ? updatedAtRaw.toDate() : new Date(String(updatedAtRaw ?? Date.now())),
  };
}

export async function getClients() {
  const clientsRef = getClientsRef();

  if (!clientsRef) {
    return [];
  }

  const uid = auth?.currentUser?.uid;

  if (!uid) {
    return [];
  }

  const clientsSnapshot = await getDocs(
    query(clientsRef, where("createdByUid", "==", uid)),
  );

  return clientsSnapshot.docs
    .map((snapshot) => snapshot.data())
    .filter((client) => !client.isArchived)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export async function getClientById(clientId: string): Promise<Client | null> {
  const clientsRef = getClientsRef();

  if (!clientsRef) {
    return null;
  }

  const uid = auth?.currentUser?.uid;

  if (!uid) {
    return null;
  }

  const snapshot = await getDoc(doc(clientsRef, clientId));

  if (!snapshot.exists()) {
    return null;
  }

  const client = snapshot.data();
  return client.createdByUid === uid ? client : null;
}

export async function getUserSettings(): Promise<UserSettings | null> {
  const settingsRef = getUserSettingsRef();

  if (!settingsRef) {
    return null;
  }

  const uid = getCurrentUidOrThrow();
  const snapshot = await getDoc(doc(settingsRef, uid));

  if (!snapshot.exists()) {
    return null;
  }

  return mapUserSettingsRecord(uid, snapshot.data() as Record<string, unknown>);
}

type SaveUserSettingsInput = {
  businessProfile: UserSettings["businessProfile"];
  templates?: DocumentTemplate[];
  invoiceSystemPrompt?: string;
  quoteSystemPrompt?: string;
};

function defaultBusinessProfile(): UserSettings["businessProfile"] {
  return {
    businessName: "",
    abnOrAcn: "",
    bankName: "",
    bsb: "",
    accountNumber: "",
    paymentTerms: "Net 7 days",
  };
}

/** Skip `undefined` from `incoming` so optional fields do not wipe Firestore / merged state. */
function mergeBusinessProfileForSave(
  existing: UserSettings["businessProfile"] | null | undefined,
  incoming: UserSettings["businessProfile"],
): UserSettings["businessProfile"] {
  const base: Record<string, unknown> = {
    ...defaultBusinessProfile(),
    ...(existing ? (deepOmitUndefined(existing) as unknown as Record<string, unknown>) : {}),
  };
  for (const [key, value] of Object.entries(incoming)) {
    if (value !== undefined) {
      base[key] = value;
    }
  }
  return deepOmitUndefined(base) as unknown as UserSettings["businessProfile"];
}

export type SaveUserSettingsOptions = {
  /** When true, rejects if merged profile is missing required fields (prompts / templates). */
  enforceCompleteBusinessProfile?: boolean;
};

export async function saveUserSettings(
  input: SaveUserSettingsInput,
  options?: SaveUserSettingsOptions,
): Promise<UserSettings> {
  const settingsRef = getUserSettingsRef();

  if (!settingsRef) {
    throw new Error("Firebase is not configured");
  }

  const uid = getCurrentUidOrThrow();
  const settingsDocRef = doc(settingsRef, uid);
  const existingSnapshot = await getDoc(settingsDocRef);
  const now = new Date();
  const existing = existingSnapshot.exists()
    ? mapUserSettingsRecord(uid, existingSnapshot.data() as Record<string, unknown>)
    : null;

  const templates = input.templates ?? existing?.templates ?? [];
  const invoiceSystemPrompt =
    input.invoiceSystemPrompt !== undefined
      ? input.invoiceSystemPrompt
      : (existing?.invoiceSystemPrompt ?? "");
  const quoteSystemPrompt =
    input.quoteSystemPrompt !== undefined ? input.quoteSystemPrompt : (existing?.quoteSystemPrompt ?? "");

  const businessProfile = mergeBusinessProfileForSave(existing?.businessProfile, input.businessProfile);

  if (options?.enforceCompleteBusinessProfile) {
    const issues = getBusinessProfileCompletionIssues(businessProfile);
    if (issues.length > 0) {
      throw new Error(
        [
          "Complete your business profile before saving document prompts or templates.",
          "Open Business information in Settings and fill in every required field.",
          ...issues.map((line) => `• ${line}`),
        ].join("\n"),
      );
    }
  }

  const payload = deepOmitUndefined({
    id: uid,
    createdByUid: uid,
    businessProfile: sanitizeBusinessProfileForFirestore(businessProfile),
    templates,
    invoiceSystemPrompt,
    quoteSystemPrompt,
    createdAt: Timestamp.fromDate(existing?.createdAt ?? now),
    updatedAt: Timestamp.fromDate(now),
  });

  await setDoc(settingsDocRef, payload, { merge: true });

  return {
    id: uid,
    createdByUid: uid,
    businessProfile,
    templates,
    invoiceSystemPrompt,
    quoteSystemPrompt,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

type SaveDocumentTemplateInput = {
  name: string;
  prompt: string;
  style: PdfTemplateStyle;
};

export async function saveDocumentTemplate(
  input: SaveDocumentTemplateInput,
): Promise<DocumentTemplate> {
  const uid = getCurrentUidOrThrow();
  const settings = await getUserSettings();
  const now = new Date();
  const template: DocumentTemplate = {
    id: `tpl-${Date.now()}`,
    name: input.name.trim(),
    prompt: input.prompt.trim(),
    style: input.style,
    createdAt: now,
    updatedAt: now,
    createdByUid: uid,
  };

  await saveUserSettings(
    {
      businessProfile: settings?.businessProfile ?? {
        businessName: "",
        abnOrAcn: "",
        bankName: "",
        bsb: "",
        accountNumber: "",
        paymentTerms: "Net 7 days",
      },
      templates: [...(settings?.templates ?? []), template],
    },
    { enforceCompleteBusinessProfile: true },
  );

  return template;
}

export async function uploadBusinessLogo(file: File): Promise<{
  logoUrl: string;
  logoStoragePath: string;
}> {
  if (!storage) {
    throw new Error("Firebase is not configured");
  }

  const uid = getCurrentUidOrThrow();
  const safeFileName = file.name.replace(/\s+/g, "-").toLowerCase();
  const fileRef = ref(storage, `users/${uid}/settings/logo/${Date.now()}-${safeFileName}`);

  await uploadBytes(fileRef, file, {
    contentType: file.type,
  });

  return {
    logoStoragePath: fileRef.fullPath,
    logoUrl: await getDownloadURL(fileRef),
  };
}

async function getActiveJobsForUid(uid: string) {
  const jobsRef = getJobsRef();

  if (!jobsRef) {
    return [];
  }

  const jobsSnapshot = await getDocs(getActiveJobsQuery(jobsRef, uid));

  return jobsSnapshot.docs
    .map((snapshot) => snapshot.data())
    .filter((job) => isActiveJobStatus(job.status))
    .sort(sortJobsByCreatedAt);
}

function sortJobsByCreatedAt(a: Job, b: Job) {
  return a.createdAt.getTime() - b.createdAt.getTime();
}

function isActiveJobStatus(status: string) {
  return (
    ACTIVE_JOB_STATUSES.includes(status as JobWorkflowStatus) ||
    LEGACY_ACTIVE_JOB_STATUSES.includes(status)
  );
}

function getActiveJobsQuery(jobsRef: ReturnType<typeof getJobsRef>, uid: string) {
  if (!jobsRef) {
    throw new Error("Firebase is not configured");
  }

  return query(
    jobsRef,
    where("createdByUid", "==", uid),
    where("isArchived", "==", false),
    where("status", "in", [...ACTIVE_JOB_STATUSES, ...LEGACY_ACTIVE_JOB_STATUSES]),
    orderBy("createdAt", "asc"),
  );
}

function getCompletedJobsQuery(jobsRef: ReturnType<typeof getJobsRef>, uid: string) {
  if (!jobsRef) {
    throw new Error("Firebase is not configured");
  }

  return query(
    jobsRef,
    where("createdByUid", "==", uid),
    where("isArchived", "==", false),
    where("status", "in", [...COMPLETED_JOB_STATUSES, ...LEGACY_COMPLETED_JOB_STATUSES]),
    orderBy("createdAt", "asc"),
  );
}

function getArchivedJobsQuery(jobsRef: ReturnType<typeof getJobsRef>, uid: string) {
  if (!jobsRef) {
    throw new Error("Firebase is not configured");
  }

  return query(
    jobsRef,
    where("createdByUid", "==", uid),
    where("isArchived", "==", true),
    orderBy("createdAt", "asc"),
  );
}

export async function getActiveJobs() {
  const uid = auth?.currentUser?.uid;

  if (!uid) {
    return [];
  }

  return getActiveJobsForUid(uid);
}

export async function getActiveJobsByUid(uid: string) {
  if (!uid) {
    return [];
  }

  return getActiveJobsForUid(uid);
}

export async function getCompletedJobsByUid(uid: string) {
  if (!uid) {
    return [];
  }

  const jobsRef = getJobsRef();

  if (!jobsRef) {
    return [];
  }

  const jobsSnapshot = await getDocs(getCompletedJobsQuery(jobsRef, uid));

  return jobsSnapshot.docs
    .map((snapshot) => snapshot.data())
    .sort(sortJobsByCreatedAt);
}

export async function getArchivedJobsByUid(uid: string) {
  if (!uid) {
    return [];
  }

  const jobsRef = getJobsRef();

  if (!jobsRef) {
    return [];
  }

  const jobsSnapshot = await getDocs(getArchivedJobsQuery(jobsRef, uid));

  return jobsSnapshot.docs
    .map((snapshot) => snapshot.data())
    .sort(sortJobsByCreatedAt);
}

export function subscribeActiveJobs(
  uid: string,
  onJobs: (jobs: Job[]) => void,
  onError?: (error: Error) => void,
) {
  const jobsRef = getJobsRef();

  if (!jobsRef || !uid) {
    onJobs([]);
    return () => undefined;
  }

  const jobsQuery = getActiveJobsQuery(jobsRef, uid);

  return onSnapshot(
    jobsQuery,
    (snapshot) => {
      const jobs = snapshot.docs
        .map((docSnapshot) => docSnapshot.data())
        .filter((job) => isActiveJobStatus(job.status))
        .sort(sortJobsByCreatedAt);

      onJobs(jobs);
    },
    (error) => {
      console.error("FIRESTORE SUBSCRIPTION ERROR:", error.code, error.message);
      onError?.(error);
    },
  );
}

export function subscribeCompletedJobs(
  uid: string,
  onJobs: (jobs: Job[]) => void,
  onError?: (error: Error) => void,
) {
  const jobsRef = getJobsRef();

  if (!jobsRef || !uid) {
    onJobs([]);
    return () => undefined;
  }

  const jobsQuery = getCompletedJobsQuery(jobsRef, uid);

  return onSnapshot(
    jobsQuery,
    (snapshot) => {
      const jobs = snapshot.docs
        .map((docSnapshot) => docSnapshot.data())
        .sort(sortJobsByCreatedAt);

      onJobs(jobs);
    },
    (error) => {
      console.error("FIRESTORE SUBSCRIPTION ERROR:", error.code, error.message);
      onError?.(error);
    },
  );
}

export function subscribeArchivedJobs(
  uid: string,
  onJobs: (jobs: Job[]) => void,
  onError?: (error: Error) => void,
) {
  const jobsRef = getJobsRef();

  if (!jobsRef || !uid) {
    onJobs([]);
    return () => undefined;
  }

  const jobsQuery = getArchivedJobsQuery(jobsRef, uid);

  return onSnapshot(
    jobsQuery,
    (snapshot) => {
      const jobs = snapshot.docs
        .map((docSnapshot) => docSnapshot.data())
        .sort(sortJobsByCreatedAt);

      onJobs(jobs);
    },
    (error) => {
      console.error("FIRESTORE SUBSCRIPTION ERROR:", error.code, error.message);
      onError?.(error);
    },
  );
}

type QuoteToInvoiceResult = {
  invoiceId: string;
  invoice: Invoice;
};

export async function createJobFromQuote(quoteId: string): Promise<QuoteToInvoiceResult> {
  if (!db) {
    throw new Error("Firebase is not configured");
  }

  const quotesRef = getQuotesRef();
  const invoicesRef = getInvoicesRef();
  const jobsRef = getJobsRef();

  if (!quotesRef || !invoicesRef || !jobsRef) {
    throw new Error("Firebase is not configured");
  }

  const quoteDocRef = doc(quotesRef, quoteId);
  const invoiceDocRef = doc(invoicesRef);

  const invoice = await runTransaction(db, async (transaction) => {
    const quoteSnapshot = await transaction.get(quoteDocRef);

    if (!quoteSnapshot.exists()) {
      throw new Error("Quote not found");
    }

    const quote = quoteSnapshot.data();
    const now = new Date();

    const invoiceFromQuote: Invoice = {
      id: invoiceDocRef.id,
      createdAt: now,
      updatedAt: now,
      createdByUid: quote.createdByUid,
      clientId: quote.clientId,
      jobId: quote.jobId,
      invoiceNumber: `INV-${quote.quoteNumber}`,
      sourceQuoteId: quote.id,
      issueDate: now,
      dueDate: quote.expiryDate,
      lineItemIds: quote.lineItemIds,
      subtotalCents: quote.subtotalCents,
      taxCents: quote.taxCents,
      totalCents: quote.totalCents,
      totalPaidCents: 0,
      paymentStatus: "invoiced",
      paymentIds: [],
    };

    transaction.set(invoiceDocRef, invoiceFromQuote);
    transaction.update(quoteDocRef, {
      convertedToInvoiceId: invoiceDocRef.id,
      updatedAt: now,
    });

    transaction.update(doc(jobsRef, quote.jobId), {
      status: "invoiced",
      invoiceIds: arrayUnion(invoiceDocRef.id),
      updatedAt: now,
    });

    return invoiceFromQuote;
  });

  return {
    invoiceId: invoiceDocRef.id,
    invoice,
  };
}

type AddLineItemInput = {
  clientId: string;
  parentType: "quote" | "invoice";
  parentId: string;
  kind: "labor" | "material";
  description: string;
  quantity: number;
  unit: LineItem["unit"];
  unitPriceCents: CurrencyCents;
  taxRatePercent?: number;
  laborRateType?: LineItem["laborRateType"];
  laborRoleLabel?: string;
  applyMaterialMarkup?: boolean;
};

function calculateTaxCents(subtotalCents: number, taxRatePercent = 10) {
  return Math.round((subtotalCents * taxRatePercent) / 100);
}

export async function addLineItem(jobId: string, item: AddLineItemInput) {
  const lineItemsRef = getLineItemsRef();
  const jobsRef = getJobsRef();

  if (!lineItemsRef || !jobsRef) {
    throw new Error("Firebase is not configured");
  }

  const uid = getCurrentUidOrThrow();

  const now = new Date();
  const normalizedUnitPrice = item.unitPriceCents;
  const subtotalCents = Math.round(item.quantity * normalizedUnitPrice);
  const taxRatePercent = item.taxRatePercent ?? 10;
  const taxCents = calculateTaxCents(subtotalCents, taxRatePercent);

  const lineItem: LineItem = {
    id: "",
    createdAt: now,
    updatedAt: now,
    createdByUid: uid,
    clientId: item.clientId,
    jobId,
    parentType: item.parentType,
    parentId: item.parentId,
    status: "unbilled",
    kind: item.kind,
    description: item.description,
    quantity: item.quantity,
    unit: item.unit,
    unitPriceCents: normalizedUnitPrice,
    subtotalCents,
    taxRatePercent,
    taxCents,
    totalCents: subtotalCents + taxCents,
    laborRateType: item.laborRateType,
    laborRoleLabel: item.laborRoleLabel,
  };

  const docRef = await addDoc(lineItemsRef, lineItem);
  await updateDoc(doc(lineItemsRef, docRef.id), { id: docRef.id, updatedAt: now });

  const jobRef = doc(jobsRef, jobId);
  const jobSnapshot = await getDoc(jobRef);

  if (jobSnapshot.exists()) {
    const job = jobSnapshot.data();

    if (job.status === "new") {
      const nextStatus: JobWorkflowStatus =
        item.parentType === "quote" ? "quoted" : "in-progress";

      await updateDoc(jobRef, {
        status: nextStatus,
        updatedAt: now,
      });
    }
  }

  return {
    ...lineItem,
    id: docRef.id,
  };
}

export async function deleteLineItem(itemId: string) {
  const lineItemsRef = getLineItemsRef();

  if (!lineItemsRef) {
    throw new Error("Firebase is not configured");
  }

  const itemRef = doc(lineItemsRef, itemId);
  const now = new Date();

  await updateDoc(itemRef, {
    deletedAt: now,
    updatedAt: now,
  });
}

export async function restoreLineItem(itemId: string) {
  const lineItemsRef = getLineItemsRef();

  if (!lineItemsRef) {
    throw new Error("Firebase is not configured");
  }

  await updateDoc(doc(lineItemsRef, itemId), {
    deletedAt: null,
    updatedAt: new Date(),
  });
}

type AddVariationInput = Omit<AddLineItemInput, "kind">;

export async function addVariation(
  jobId: string,
  originalItemId: string,
  newItem: AddVariationInput,
) {
  const lineItemsRef = getLineItemsRef();

  if (!lineItemsRef) {
    throw new Error("Firebase is not configured");
  }

  const variation = await addLineItem(jobId, {
    ...newItem,
    kind: "material",
    applyMaterialMarkup: false,
  });

  const variationRef = doc(lineItemsRef, variation.id);
  await updateDoc(variationRef, {
    kind: "variation",
    variationForLineItemId: originalItemId,
    updatedAt: new Date(),
  });

  return {
    ...variation,
    kind: "variation" as const,
    variationForLineItemId: originalItemId,
  };
}

type LineItemUpdateInput = {
  description?: string;
  quantity?: number;
  unitPriceCents?: CurrencyCents;
  taxRatePercent?: number;
};

export async function updateLineItem(itemId: string, patch: LineItemUpdateInput) {
  const lineItemsRef = getLineItemsRef();

  if (!lineItemsRef) {
    throw new Error("Firebase is not configured");
  }

  const itemRef = doc(lineItemsRef, itemId);
  const snapshot = await getDoc(itemRef);

  if (!snapshot.exists()) {
    throw new Error("Line item not found");
  }

  const current = snapshot.data();
  const quantity = patch.quantity ?? current.quantity;
  const unitPriceCents = patch.unitPriceCents ?? current.unitPriceCents;
  const taxRatePercent = patch.taxRatePercent ?? current.taxRatePercent ?? 10;
  const subtotalCents = Math.round(quantity * unitPriceCents);
  const taxCents = calculateTaxCents(subtotalCents, taxRatePercent);

  await updateDoc(itemRef, {
    ...patch,
    quantity,
    unitPriceCents,
    taxRatePercent,
    subtotalCents,
    taxCents,
    totalCents: subtotalCents + taxCents,
    updatedAt: new Date(),
  });
}

type StoredFileInput = {
  kind: JobFileRecord["kind"];
  storageFolder: string;
};

type StoredFileOutput = {
  storagePath: string;
  downloadUrl: string;
};

async function uploadJobFile(
  jobId: string,
  file: File,
  options: StoredFileInput,
): Promise<StoredFileOutput> {
  if (!storage) {
    throw new Error("Firebase is not configured");
  }

  const uid = getCurrentUidOrThrow();
  const safeFileName = file.name.replace(/\s+/g, "-").toLowerCase();
  const storagePath = `users/${uid}/jobs/${jobId}/${options.storageFolder}/${Date.now()}-${safeFileName}`;
  const fileRef = ref(storage, storagePath);

  await uploadBytes(fileRef, file, {
    contentType: file.type,
  });

  const downloadUrl = await getDownloadURL(fileRef);

  return {
    storagePath: fileRef.fullPath,
    downloadUrl,
  };
}

async function createFileRecord(
  jobId: string,
  file: File,
  kind: JobFileRecord["kind"],
  upload: StoredFileOutput,
) {
  const filesRef = getFilesRef();

  if (!filesRef) {
    throw new Error("Firebase is not configured");
  }

  const uid = getCurrentUidOrThrow();

  const now = new Date();
  const payload = {
    jobId,
    createdByUid: uid,
    name: file.name,
    kind,
    mimeType: file.type || "application/octet-stream",
    storagePath: upload.storagePath,
    downloadUrl: upload.downloadUrl,
    createdAt: Timestamp.fromDate(now),
  };

  const recordRef = await addDoc(filesRef, payload);

  return {
    id: recordRef.id,
    ...payload,
    createdAt: now,
  } as JobFileRecord;
}

export async function saveReceiptImage(jobId: string, file: File): Promise<JobFileRecord> {
  const upload = await uploadJobFile(jobId, file, {
    kind: "receipt",
    storageFolder: "receipts",
  });

  return createFileRecord(jobId, file, "receipt", upload);
}

export async function saveJobDocument(jobId: string, file: File): Promise<JobFileRecord> {
  const upload = await uploadJobFile(jobId, file, {
    kind: "other",
    storageFolder: "other",
  });

  return createFileRecord(jobId, file, "other", upload);
}

export async function saveGeneratedInvoicePdf(jobId: string, file: File): Promise<JobFileRecord> {
  const upload = await uploadJobFile(jobId, file, {
    kind: "invoice_pdf",
    storageFolder: "invoices",
  });

  return createFileRecord(jobId, file, "invoice_pdf", upload);
}

export async function saveSitePhoto(jobId: string, file: File): Promise<JobFileRecord> {
  const upload = await uploadJobFile(jobId, file, {
    kind: "site_photo",
    storageFolder: "photos",
  });

  return createFileRecord(jobId, file, "site_photo", upload);
}

export async function getLineItem(itemId: string) {
  const lineItemsRef = getLineItemsRef();

  if (!lineItemsRef) {
    return null;
  }

  const uid = auth?.currentUser?.uid;

  if (!uid) {
    return null;
  }

  const snapshot = await getDoc(doc(lineItemsRef, itemId));

  if (!snapshot.exists()) {
    return null;
  }

  const item = snapshot.data();
  return item.createdByUid === uid ? item : null;
}

export async function getLineItemsByJobId(jobId: string, includeDeleted = false) {
  const lineItemsRef = getLineItemsRef();

  if (!lineItemsRef) {
    return [];
  }

  const uid = auth?.currentUser?.uid;

  if (!uid) {
    return [];
  }

  const snapshot = await getDocs(
    query(
      lineItemsRef,
      where("createdByUid", "==", uid),
      where("jobId", "==", jobId),
      orderBy("createdAt", "asc"),
    ),
  );

  console.log("[getLineItemsByJobId] currentJobId:", jobId);
  console.log("RAW LINE ITEMS FROM FIRESTORE:", snapshot.docs.map((d) => d.data()));

  const items = snapshot.docs.map((item) => item.data());
  return includeDeleted ? items : items.filter((item) => !item.deletedAt);
}

export function subscribeLineItemsByJobId(
  uid: string,
  jobId: string,
  onItems: (items: LineItem[]) => void,
  onError?: (error: Error) => void,
  includeDeleted = false,
) {
  const lineItemsRef = getLineItemsRef();

  if (!lineItemsRef || !uid || !jobId) {
    onItems([]);
    return () => undefined;
  }

  const lineItemsQuery = query(
    lineItemsRef,
    where("createdByUid", "==", uid),
    where("jobId", "==", jobId),
    orderBy("createdAt", "asc"),
  );

  return onSnapshot(
    lineItemsQuery,
    (snapshot) => {
      console.log("[subscribeLineItemsByJobId] currentJobId:", jobId);
      console.log("RAW LINE ITEMS FROM FIRESTORE:", snapshot.docs.map((d) => d.data()));
      const items = snapshot.docs.map((docSnapshot) => docSnapshot.data());
      onItems(includeDeleted ? items : items.filter((item) => !item.deletedAt));
    },
    (error) => {
      onError?.(error);
    },
  );
}

/** Processed receipts for this job (real-time). */
export function subscribeJobReceiptStash(
  jobId: string,
  onFiles: (files: JobFileRecord[]) => void,
  onError?: (error: Error) => void,
) {
  const filesRef = getFilesRef();
  const uid = auth?.currentUser?.uid;

  if (!filesRef || !uid || !jobId) {
    onFiles([]);
    return () => undefined;
  }

  const stashQuery = query(
    filesRef,
    where("createdByUid", "==", uid),
    where("jobId", "==", jobId),
    where("kind", "==", "receipt"),
    orderBy("createdAt", "desc"),
  );

  return onSnapshot(
    stashQuery,
    (snapshot) => {
      const rows = snapshot.docs.map((docSnap) =>
        mapFileRecord(docSnap.id, docSnap.data() as Record<string, unknown>),
      );
      onFiles(rows.filter((f) => f.isProcessed));
    },
    (error) => {
      onError?.(error);
    },
  );
}

function mapFileRecord(
  id: string,
  raw: Record<string, unknown>,
): JobFileRecord {
  const createdAtRaw = raw.createdAt;
  const createdAt =
    createdAtRaw instanceof Timestamp
      ? createdAtRaw.toDate()
      : createdAtRaw instanceof Date
        ? createdAtRaw
        : new Date();

  const vendorRaw = raw.vendorName;
  const vendorName =
    vendorRaw === null || vendorRaw === undefined
      ? undefined
      : String(vendorRaw).trim() || null;

  const dateRaw = raw.receiptDate;
  const receiptDate =
    dateRaw === null || dateRaw === undefined
      ? undefined
      : String(dateRaw).trim() || null;

  const gstRaw = raw.totalGstCents;
  let totalGstCents: number | null | undefined;
  if (gstRaw === null) {
    totalGstCents = null;
  } else if (typeof gstRaw === "number" && Number.isFinite(gstRaw)) {
    totalGstCents = Math.round(gstRaw);
  }

  const totalAmtRaw = raw.totalAmountCents;
  let totalAmountCents: number | null | undefined;
  if (totalAmtRaw === null) {
    totalAmountCents = null;
  } else if (typeof totalAmtRaw === "number" && Number.isFinite(totalAmtRaw)) {
    totalAmountCents = Math.round(totalAmtRaw);
  }

  let stashLineItems: JobFileRecord["stashLineItems"];
  const sl = raw.stashLineItems;
  if (Array.isArray(sl)) {
    stashLineItems = sl
      .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
      .map((row) => ({
        description: String(row.description ?? ""),
        rawDescription: String(row.rawDescription ?? ""),
        quantity: typeof row.quantity === "number" && Number.isFinite(row.quantity) ? row.quantity : 1,
        unitPriceCents: Math.round(Number(row.unitPriceCents) || 0),
        subtotalCents: Math.round(Number(row.subtotalCents) || 0),
      }));
  }

  return {
    id,
    jobId: String(raw.jobId ?? ""),
    name: String(raw.name ?? "Untitled"),
    kind: (raw.kind as JobFileRecord["kind"]) ?? "document",
    mimeType: String(raw.mimeType ?? "application/octet-stream"),
    storagePath: String(raw.storagePath ?? ""),
    downloadUrl: String(raw.downloadUrl ?? ""),
    createdAt,
    isProcessed: Boolean(raw.isProcessed),
    vendorName,
    receiptDate,
    totalGstCents,
    totalAmountCents,
    stashLineItems,
  };
}

export async function getJobFiles(jobId: string): Promise<JobFileRecord[]> {
  const filesRef = getFilesRef();

  if (!filesRef) {
    return [];
  }

  const uid = auth?.currentUser?.uid;

  if (!uid) {
    return [];
  }

  const snapshot = await getDocs(
    query(
      filesRef,
      where("createdByUid", "==", uid),
      where("jobId", "==", jobId),
      orderBy("createdAt", "desc"),
    ),
  );

  return snapshot.docs.map((item) => {
    return mapFileRecord(item.id, item.data() as Record<string, unknown>);
  });
}

export async function getJobDocuments(jobId: string): Promise<JobDocumentRecord[]> {
  const documentsRef = getJobDocumentsRef(jobId);

  if (!documentsRef) {
    return [];
  }

  const uid = getCurrentUidOrThrow();
  const snapshot = await getDocs(
    query(
      documentsRef,
      where("createdByUid", "==", uid),
      orderBy("createdAt", "desc"),
    ),
  );

  return snapshot.docs.map((item) => {
    return mapJobDocumentRecord(item.id, item.data() as Record<string, unknown>);
  });
}

export async function getJob(jobId: string): Promise<Job | null> {
  console.log("[getJob] requested id:", jobId);
  const jobsRef = getJobsRef();

  if (!jobsRef) {
    console.log("[getJob] Firebase not configured");
    return null;
  }

  const uid = auth?.currentUser?.uid;

  if (!uid) {
    console.log("[getJob] Missing auth.currentUser uid");
    return null;
  }

  const snapshot = await getDoc(doc(jobsRef, jobId));

  if (!snapshot.exists()) {
    console.log("[getJob] No document exists for id:", jobId);
    return null;
  }

  const job = snapshot.data();
  const allowed = job.createdByUid === uid;
  console.log("[getJob] Document found", {
    id: job.id,
    createdByUid: job.createdByUid,
    currentUid: uid,
    allowed,
  });
  return allowed ? job : null;
}

type JobSettingsInput = {
  purchaseOrderNumber?: string;
  startDate?: Date;
  dueDate?: Date;
  materialMarkupPercent?: number;
};

export async function updateJobSettings(jobId: string, patch: JobSettingsInput) {
  const jobsRef = getJobsRef();

  if (!jobsRef) {
    throw new Error("Firebase is not configured");
  }

  await updateDoc(doc(jobsRef, jobId), {
    ...patch,
    updatedAt: new Date(),
  });
}

export async function updateJobMaterialMarkup(jobId: string, materialMarkupPercent: number) {
  const clamped = Math.min(100, Math.max(0, Math.round(materialMarkupPercent)));
  await updateJobSettings(jobId, { materialMarkupPercent: clamped });
}

type FinalizeJobDocumentInput = {
  jobId: string;
  clientId: string;
  documentType: GeneratedDocumentType;
  documentNumber: string;
  templateId?: string;
  templateName?: string;
  lineItemIds: string[];
  /** Per-line totals as shown on this PDF (quote/invoice commits use for history `amountAllocated`). */
  lineItemSnapshots?: Array<{ id: string; totalCents: number; quantity: number }>;
  subtotalCents: number;
  markupCents: number;
  taxCents: number;
  totalCents: number;
  refinementPayload: DocumentRefinementPayload;
  pdfFile: File;
};

export async function finalizeJobDocument(
  input: FinalizeJobDocumentInput,
): Promise<JobDocumentRecord> {
  if (!db || !storage) {
    throw new Error("Firebase is not configured");
  }

  const uid = getCurrentUidOrThrow();
  const lineItemsRef = getLineItemsRef();
  const jobsRef = getJobsRef();
  const documentsRef = getJobDocumentsRef(input.jobId);

  if (!lineItemsRef || !jobsRef || !documentsRef) {
    throw new Error("Firebase is not configured");
  }

  const safeFileName = input.pdfFile.name.replace(/\s+/g, "-").toLowerCase();
  const storagePath = `users/${uid}/jobs/${input.jobId}/documents/${Date.now()}-${safeFileName}`;
  const fileRef = ref(storage, storagePath);

  await uploadBytes(fileRef, input.pdfFile, {
    contentType: input.pdfFile.type,
  });

  const downloadUrl = await getDownloadURL(fileRef);
  const now = new Date();
  const documentRef = doc(documentsRef);
  const batch = writeBatch(db);

  const snapById = new Map((input.lineItemSnapshots ?? []).map((s) => [s.id, s] as const));
  const initialVersion = createDocumentVersion(input.refinementPayload, "Initial Generation");
  const serializedPayload = serializeRefinementPayload(input.refinementPayload);

  const linePrevById = new Map<string, LineItem>();
  if (input.documentType === "invoice" || input.documentType === "quote") {
    for (const lineItemId of input.lineItemIds) {
      const li = await getLineItem(lineItemId);
      if (li) {
        linePrevById.set(lineItemId, li);
      }
    }
  }

  batch.set(documentRef, {
    id: documentRef.id,
    jobId: input.jobId,
    clientId: input.clientId,
    type: input.documentType,
    documentNumber: input.documentNumber,
    templateId: input.templateId,
    templateName: input.templateName,
    fileName: input.pdfFile.name,
    storagePath: fileRef.fullPath,
    downloadUrl,
    subtotalCents: input.subtotalCents,
    markupCents: input.markupCents,
    taxCents: input.taxCents,
    totalCents: input.totalCents,
    lineItemIds: input.lineItemIds,
    status: "sent",
    refinementPayload: serializedPayload,
    versions: [serializeDocumentVersion(initialVersion)],
    createdByUid: uid,
    createdAt: Timestamp.fromDate(now),
    updatedAt: Timestamp.fromDate(now),
  });

  for (const lineItemId of input.lineItemIds) {
    if (input.documentType === "quote") {
      const prev = linePrevById.get(lineItemId);
      const snap = snapById.get(lineItemId);
      const amountAllocated = snap?.totalCents ?? prev?.totalCents ?? 0;
      const priorQuote = prev ? priorQuoteAllocatedSumFromFirestore(prev) : 0;
      const newQuoteSum = priorQuote + amountAllocated;
      const fullyQuotedAfter = prev ? newQuoteSum >= prev.totalCents - 1 : true;
      const invSum = prev ? priorInvoiceAllocatedSumFromFirestore(prev) : 0;
      const fullyInvoicedAlready = prev ? invSum >= prev.totalCents - 1 : false;

      const historyEntry = {
        quoteId: documentRef.id,
        quoteNumber: input.documentNumber,
        date: now.toISOString(),
        amountAllocated,
      };

      const nextStatus = fullyInvoicedAlready
        ? "invoiced"
        : fullyQuotedAfter
          ? "quoted"
          : (prev?.status ?? "unbilled");

      batch.update(doc(lineItemsRef, lineItemId), {
        quotedHistory: arrayUnion(historyEntry),
        docRef: deleteField(),
        status: nextStatus,
        updatedAt: now,
      });
      continue;
    }

    const prev = linePrevById.get(lineItemId);
    const snap = snapById.get(lineItemId);
    const amountAllocated = snap?.totalCents ?? prev?.totalCents ?? 0;
    const priorSum = prev ? priorInvoiceAllocatedSumFromFirestore(prev) : 0;
    const newSum = priorSum + amountAllocated;
    const fullyInvoiced = prev ? newSum >= prev.totalCents - 1 : true;

    const historyEntry = {
      invoiceId: documentRef.id,
      invoiceNumber: input.documentNumber,
      date: now.toISOString(),
      amountAllocated,
    };

    batch.update(doc(lineItemsRef, lineItemId), {
      invoicedHistory: arrayUnion(historyEntry),
      docRef: deleteField(),
      status: fullyInvoiced ? "invoiced" : prev?.status ?? "unbilled",
      updatedAt: now,
    });
  }

  batch.update(doc(jobsRef, input.jobId), {
    status: input.documentType === "invoice" ? "invoiced" : "quoted",
    updatedAt: now,
  });

  await batch.commit();

  return {
    id: documentRef.id,
    jobId: input.jobId,
    clientId: input.clientId,
    type: input.documentType,
    documentNumber: input.documentNumber,
    templateId: input.templateId,
    templateName: input.templateName,
    fileName: input.pdfFile.name,
    storagePath: fileRef.fullPath,
    downloadUrl,
    subtotalCents: input.subtotalCents,
    markupCents: input.markupCents,
    taxCents: input.taxCents,
    totalCents: input.totalCents,
    lineItemIds: input.lineItemIds,
    status: "sent",
    refinementPayload: serializedPayload,
    versions: [serializeDocumentVersion(initialVersion)],
    createdAt: now,
    updatedAt: now,
    createdByUid: uid,
  };
}

export type CommitJobDocumentVersionInput = {
  jobId: string;
  documentId: string;
  payload: DocumentRefinementPayload;
  commitMessage: string;
  pdfFile: File;
};

/** Append a version and replace the stored PDF for an existing job document. */
export async function commitJobDocumentVersion(
  input: CommitJobDocumentVersionInput,
): Promise<JobDocumentRecord> {
  if (!db || !storage) {
    throw new Error("Firebase is not configured");
  }

  const uid = getCurrentUidOrThrow();
  const documentsRef = getJobDocumentsRef(input.jobId);
  if (!documentsRef) {
    throw new Error("Firebase is not configured");
  }

  const documentSnap = await getDoc(doc(documentsRef, input.documentId));
  if (!documentSnap.exists()) {
    throw new Error("Document not found");
  }

  const existing = mapJobDocumentRecord(input.documentId, documentSnap.data() as Record<string, unknown>);
  const safeFileName = input.pdfFile.name.replace(/\s+/g, "-").toLowerCase();
  const storagePath = `users/${uid}/jobs/${input.jobId}/documents/${Date.now()}-${safeFileName}`;
  const fileRef = ref(storage, storagePath);

  await uploadBytes(fileRef, input.pdfFile, {
    contentType: input.pdfFile.type,
  });

  const downloadUrl = await getDownloadURL(fileRef);
  const now = new Date();
  const nextVersion = createDocumentVersion(input.payload, input.commitMessage);
  const serializedPayload = serializeRefinementPayload(input.payload);
  const priorVersions = Array.isArray(existing.versions) ? existing.versions : [];

  await updateDoc(doc(documentsRef, input.documentId), {
    fileName: input.pdfFile.name,
    storagePath: fileRef.fullPath,
    downloadUrl,
    subtotalCents: input.payload.subtotalCents,
    markupCents: input.payload.markupCents,
    taxCents: input.payload.taxCents,
    totalCents: input.payload.totalCents,
    refinementPayload: serializedPayload,
    versions: [...priorVersions, serializeDocumentVersion(nextVersion)],
    updatedAt: Timestamp.fromDate(now),
  });

  return {
    ...existing,
    fileName: input.pdfFile.name,
    storagePath: fileRef.fullPath,
    downloadUrl,
    subtotalCents: input.payload.subtotalCents,
    markupCents: input.payload.markupCents,
    taxCents: input.payload.taxCents,
    totalCents: input.payload.totalCents,
    refinementPayload: serializedPayload,
    versions: [...priorVersions, serializeDocumentVersion(nextVersion)],
    updatedAt: now,
  };
}

export type DeleteJobDocumentInput = {
  jobId: string;
  documentId: string;
  jobStatus: JobWorkflowStatus;
};

/** Delete a job document, release linked workbench line items, and remove the stored PDF. */
export async function deleteJobDocument(input: DeleteJobDocumentInput): Promise<void> {
  if (!db || !storage) {
    throw new Error("Firebase is not configured");
  }

  const documentsRef = getJobDocumentsRef(input.jobId);
  const lineItemsRef = getLineItemsRef();
  if (!documentsRef || !lineItemsRef) {
    throw new Error("Firebase is not configured");
  }

  const documentSnap = await getDoc(doc(documentsRef, input.documentId));
  if (!documentSnap.exists()) {
    throw new Error("Document not found");
  }

  const document = mapJobDocumentRecord(
    input.documentId,
    documentSnap.data() as Record<string, unknown>,
  );
  const lock = isDocumentDeleteLocked(document, input.jobStatus);
  if (lock.locked) {
    throw new Error(lock.reason ?? "This document cannot be deleted");
  }

  const lineItems = await getLineItemsByJobId(input.jobId, false);
  const now = new Date();
  const batch = writeBatch(db);

  batch.delete(doc(documentsRef, input.documentId));

  for (const item of lineItems) {
    const updates = buildLineItemUpdatesAfterDocumentDelete(
      item,
      input.documentId,
      document.type,
    );
    if (!updates) {
      continue;
    }

    const patch: Record<string, unknown> = {
      status: updates.status,
      updatedAt: now,
    };

    if (document.type === "invoice") {
      patch.invoicedHistory = updates.invoicedHistory;
    }
    if (document.type === "quote") {
      patch.quotedHistory = updates.quotedHistory;
    }
    if (updates.clearDocRef) {
      patch.docRef = deleteField();
    }

    batch.update(doc(lineItemsRef, item.id), patch);
  }

  await batch.commit();

  if (document.storagePath) {
    try {
      await deleteObject(ref(storage, document.storagePath));
    } catch (error) {
      console.warn("[deleteJobDocument] Failed to delete storage file", document.storagePath, error);
    }
  }
}

export async function markJobAsPaid(jobId: string) {
  await updateJobStatus(jobId, "paid");

  const documentsRef = getJobDocumentsRef(jobId);
  if (!documentsRef || !db) {
    return;
  }

  const snapshot = await getDocs(documentsRef);
  const batch = writeBatch(db);
  const now = new Date();

  for (const docSnap of snapshot.docs) {
    const raw = docSnap.data() as Record<string, unknown>;
    if (raw.type === "invoice") {
      batch.update(docSnap.ref, {
        status: "paid",
        updatedAt: Timestamp.fromDate(now),
      });
    }
  }

  await batch.commit();
}

export async function updateJobStatus(jobId: string, status: JobWorkflowStatus) {
  const jobsRef = getJobsRef();

  if (!jobsRef) {
    throw new Error("Firebase is not configured");
  }

  await updateDoc(doc(jobsRef, jobId), {
    status,
    updatedAt: new Date(),
  });
}

export async function setJobArchived(jobId: string, isArchived: boolean) {
  const jobsRef = getJobsRef();

  if (!jobsRef) {
    throw new Error("Firebase is not configured");
  }

  await updateDoc(doc(jobsRef, jobId), {
    isArchived,
    updatedAt: new Date(),
  });
}

export type SyncReceiptItem = {
  description: string;
  /** Verbatim receipt line (stored on line item for stash reconciliation). */
  rawDescription?: string;
  quantity: number;
  /** Unit price inc GST in dollars (dollars, not cents) */
  unitPriceIncGst: number;
  targetJobId: string;
  /** Firestore receipt file record ID for traceability */
  receiptFileId: string;
};

export type ReceiptStashWriteMeta = {
  vendorName: string | null;
  receiptDate: string | null;
  totalGstCents: number | null;
  totalAmountCents: number;
  lineSnapshots: Array<{
    description: string;
    rawDescription: string;
    quantity: number;
    unitPriceCents: number;
    subtotalCents: number;
  }>;
};

export type SyncReceiptInput = {
  items: SyncReceiptItem[];
  sourceReceiptFileId: string;
  receiptStashMeta: ReceiptStashWriteMeta;
};

export async function syncReceiptToJobs(input: SyncReceiptInput): Promise<void> {
  if (!db) {
    throw new Error("Firebase is not configured");
  }

  const lineItemsRef = getLineItemsRef();
  const filesRef = getFilesRef();

  if (!lineItemsRef || !filesRef) {
    throw new Error("Firebase is not configured");
  }

  const uid = getCurrentUidOrThrow();

  const now = new Date();
  const activeItems = input.items;

  // Group by jobId so we can do one job lookup per job
  const byJob = new Map<string, SyncReceiptItem[]>();

  for (const item of activeItems) {
    const existing = byJob.get(item.targetJobId) ?? [];
    existing.push(item);
    byJob.set(item.targetJobId, existing);
  }

  const jobsRef = getJobsRef();

  if (!jobsRef) {
    throw new Error("Firebase is not configured");
  }

  for (const [targetJobId, items] of byJob) {
    const jobSnapshot = await getDoc(doc(jobsRef, targetJobId));

    if (!jobSnapshot.exists()) {
      continue;
    }

    const job = jobSnapshot.data();
    const parentId = job.invoiceIds?.[0] ?? job.quoteIds?.[0] ?? "";
    const parentType: "invoice" | "quote" = job.invoiceIds?.[0] ? "invoice" : "quote";

    for (const item of items) {
        // Convert dollars to cents. Markup is applied only during document generation.
      const rawCents = Math.round(item.unitPriceIncGst * 100);
        const subtotalCents = Math.round(item.quantity * rawCents);
      const taxRatePercent = 10;
      const taxCents = Math.round((subtotalCents * taxRatePercent) / 100);
      const totalCents = subtotalCents + taxCents;

      const lineItem: Omit<LineItem, "id"> = {
        createdAt: now,
        updatedAt: now,
        createdByUid: uid,
        clientId: job.clientId ?? "",
        jobId: targetJobId,
        parentType,
        parentId,
        status: "unbilled",
        kind: "material",
        description: item.description,
        quantity: item.quantity,
        unit: "item",
        unitPriceCents: rawCents,
        subtotalCents,
        taxRatePercent,
        taxCents,
        totalCents,
        receiptImageStoragePath: item.receiptFileId,
        receiptFileId: item.receiptFileId,
        rawReceiptDescription: item.rawDescription?.trim() || undefined,
      };

      const docRef = await addDoc(lineItemsRef, lineItem);
      await updateDoc(doc(lineItemsRef, docRef.id), { id: docRef.id, updatedAt: now });
    }

    if (job.status === "new") {
      const nextStatus: JobWorkflowStatus =
        parentType === "quote" ? "quoted" : "in-progress";

      await updateDoc(doc(jobsRef, targetJobId), {
        status: nextStatus,
        updatedAt: now,
      });
    }
  }

  // Mark receipt file as processed + stash audit fields
  const meta = input.receiptStashMeta;
  await updateDoc(doc(filesRef, input.sourceReceiptFileId), {
    isProcessed: true,
    vendorName: meta.vendorName ?? "",
    receiptDate: meta.receiptDate ?? "",
    totalGstCents: meta.totalGstCents ?? null,
    totalAmountCents: meta.totalAmountCents,
    stashLineItems: meta.lineSnapshots,
    updatedAt: now,
  });
}

// ---------------------------------------------------------------------------
// Client creation
// ---------------------------------------------------------------------------

export type CreateClientInput = {
  displayName: string;
  legalName?: string;
  email?: string;
  phone?: string;
  notes?: string;
  isSchoolClient: boolean;
  defaultPurchaseOrderNumber?: string;
  billingAddress?: Client["billingAddress"];
  siteAddress?: Client["siteAddress"];
  siteAddresses?: Client["siteAddresses"];
};

export async function createClient(input: CreateClientInput): Promise<Client> {
  const clientsRef = getClientsRef();

  if (!clientsRef) {
    throw new Error("Firebase is not configured");
  }

  const uid = getCurrentUidOrThrow();

  const now = new Date();

  const payload: Omit<Client, "id"> = {
    displayName: input.displayName.trim(),
    legalName: input.legalName?.trim(),
    email: input.email?.trim(),
    phone: input.phone?.trim(),
    notes: input.notes?.trim(),
    isSchoolClient: input.isSchoolClient,
    defaultPurchaseOrderNumber: input.defaultPurchaseOrderNumber?.trim(),
    billingAddress: input.billingAddress,
    siteAddress: input.siteAddress,
    siteAddresses: input.siteAddresses ?? [],
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    createdByUid: uid,
  };

  const docRef = await addDoc(clientsRef, payload);
  await updateDoc(doc(clientsRef, docRef.id), { id: docRef.id, updatedAt: now });

  return { id: docRef.id, ...payload };
}

/** All jobs for the current user linked to a client (any status). */
export async function getJobsByClientId(clientId: string): Promise<Job[]> {
  const jobsRef = getJobsRef();
  if (!jobsRef) {
    return [];
  }
  const uid = getCurrentUidOrThrow();
  const snapshot = await getDocs(
    query(jobsRef, where("createdByUid", "==", uid), where("clientId", "==", clientId)),
  );
  return snapshot.docs
    .map((docSnap) => docSnap.data())
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/** All jobs owned by the user (for CRM directory filters). */
export async function getAllJobsByUid(uid: string): Promise<Job[]> {
  const jobsRef = getJobsRef();
  if (!jobsRef || !uid) {
    return [];
  }
  const snapshot = await getDocs(query(jobsRef, where("createdByUid", "==", uid)));
  return snapshot.docs
    .map((docSnap) => docSnap.data())
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/** All invoices owned by the user (for CRM billing intelligence). */
export async function getInvoicesByUid(uid: string): Promise<Invoice[]> {
  const invoicesRef = getInvoicesRef();
  if (!invoicesRef || !uid) {
    return [];
  }
  const snapshot = await getDocs(query(invoicesRef, where("createdByUid", "==", uid)));
  return snapshot.docs.map((docSnap) => docSnap.data());
}

const CLIENT_DELETE_BLOCKING_STATUSES: JobWorkflowStatus[] = [
  "new",
  "quoted",
  "in-progress",
  "invoiced",
];

export type ClientArchiveGuardResult =
  | { ok: true }
  | { ok: false; activeJobCount: number };

/** Validates whether a client can be soft-archived (never hard-deletes). */
export async function evaluateClientArchiveGuard(
  clientId: string,
): Promise<ClientArchiveGuardResult> {
  const jobs = await getJobsByClientId(clientId);
  const activeCount = jobs.filter(
    (job) => !job.isArchived && CLIENT_DELETE_BLOCKING_STATUSES.includes(job.status),
  ).length;
  if (activeCount > 0) {
    return { ok: false, activeJobCount: activeCount };
  }
  return { ok: true };
}

/** Soft-archive client after guard passes (preserves historical invoices). */
export async function archiveClient(clientId: string): Promise<void> {
  const guard = await evaluateClientArchiveGuard(clientId);
  if (!guard.ok) {
    throw new Error(
      `Cannot Delete Client: This client has ${guard.activeJobCount} active jobs in progress. You must reassign or archive these jobs before this client record can be removed from the system.`,
    );
  }
  const clientsRef = getClientsRef();
  if (!clientsRef) {
    throw new Error("Firebase is not configured");
  }
  await updateDoc(doc(clientsRef, clientId), {
    isArchived: true,
    updatedAt: new Date(),
  });
}

// ---------------------------------------------------------------------------
// Job creation
// ---------------------------------------------------------------------------

/** Count all jobs for a client (any status / archive) owned by the current user. */
export async function countJobsByClientId(clientId: string): Promise<number> {
  const jobsRef = getJobsRef();
  if (!jobsRef) {
    throw new Error("Firebase is not configured");
  }
  const uid = getCurrentUidOrThrow();
  const snapshot = await getDocs(
    query(jobsRef, where("createdByUid", "==", uid), where("clientId", "==", clientId)),
  );
  return snapshot.size;
}

export type CreateJobInput = {
  title: string;
  clientId: string;
  purchaseOrderNumber?: string;
  startDate?: Date | null;
  /** Target / milestone end date (maps to Job.dueDate). */
  dueDate?: Date | null;
  siteAddress?: Job["siteAddress"];
  siteAddressId?: Job["siteAddressId"];
  billingAddress?: Job["billingAddress"];
};

export async function createJob(input: CreateJobInput): Promise<Job> {
  const jobsRef = getJobsRef();

  if (!jobsRef) {
    throw new Error("Firebase is not configured");
  }

  const uid = getCurrentUidOrThrow();

  const now = new Date();

  const payload: Omit<Job, "id"> = {
    clientId: input.clientId,
    title: input.title.trim(),
    status: "new",
    purchaseOrderNumber: input.purchaseOrderNumber?.trim(),
    startDate: input.startDate ?? undefined,
    dueDate: input.dueDate ?? undefined,
    siteAddress: input.siteAddress,
    siteAddressId: input.siteAddressId,
    billingAddress: input.billingAddress,
    quoteIds: [],
    invoiceIds: [],
    fileIds: [],
    isArchived: false,
    materialMarkupPercent: 15,
    createdAt: now,
    updatedAt: now,
    createdByUid: uid,
  };

  const docRef = await addDoc(jobsRef, payload);
  await updateDoc(doc(jobsRef, docRef.id), { id: docRef.id, updatedAt: now });

  return { id: docRef.id, ...payload };
}

export async function deleteJob(jobId: string): Promise<void> {
  const jobsRef = getJobsRef();

  if (!jobsRef) {
    throw new Error("Firebase is not configured");
  }

  await deleteDoc(doc(jobsRef, jobId));
}

export async function duplicateJob(jobId: string): Promise<Job> {
  const jobsRef = getJobsRef();
  const lineItemsRef = getLineItemsRef();

  if (!jobsRef || !lineItemsRef) {
    throw new Error("Firebase is not configured");
  }

  const sourceJob = await getJob(jobId);
  if (!sourceJob) {
    throw new Error("Job not found");
  }

  const uid = getCurrentUidOrThrow();
  const now = new Date();

  // Create new job
  const newJobPayload: Omit<Job, "id"> = {
    clientId: sourceJob.clientId,
    title: `${sourceJob.title} (Copy)`,
    description: sourceJob.description,
    status: "new",
    purchaseOrderNumber: sourceJob.purchaseOrderNumber,
    siteAddress: sourceJob.siteAddress,
    billingAddress: sourceJob.billingAddress,
    quoteIds: [],
    invoiceIds: [],
    fileIds: [],
    duplicateSourceJobId: jobId,
    startDate: sourceJob.startDate,
    dueDate: sourceJob.dueDate,
    isArchived: false,
    materialMarkupPercent:
      typeof sourceJob.materialMarkupPercent === "number"
        ? sourceJob.materialMarkupPercent
        : 15,
    createdAt: now,
    updatedAt: now,
    createdByUid: uid,
  };

  const newJobRef = await addDoc(jobsRef, newJobPayload);
  const newJobId = newJobRef.id;
  await updateDoc(doc(jobsRef, newJobId), { id: newJobId, updatedAt: now });

  // Copy line items from source job if they exist
  const sourceLineItems = await getLineItemsByJobId(jobId, false);
  for (const sourceItem of sourceLineItems) {
    const newItemPayload: Omit<LineItem, "id"> = {
      clientId: sourceItem.clientId,
      jobId: newJobId,
      parentType: sourceItem.parentType,
      parentId: sourceItem.parentId,
      status: "unbilled",
      docRef: undefined,
      kind: sourceItem.kind,
      description: sourceItem.description,
      quantity: sourceItem.quantity,
      unit: sourceItem.unit,
      unitPriceCents: sourceItem.unitPriceCents,
      subtotalCents: sourceItem.subtotalCents,
      taxRatePercent: sourceItem.taxRatePercent,
      taxCents: sourceItem.taxCents,
      totalCents: sourceItem.totalCents,
      laborRateType: sourceItem.laborRateType,
      laborRoleLabel: sourceItem.laborRoleLabel,
      createdAt: now,
      updatedAt: now,
      createdByUid: uid,
    };

    await addDoc(lineItemsRef, newItemPayload);
  }

  return { id: newJobId, ...newJobPayload };
}

export type UpdateClientInput = Partial<
  Pick<
    Client,
    | "displayName"
    | "legalName"
    | "email"
    | "phone"
    | "notes"
    | "billingAddress"
    | "siteAddress"
    | "siteAddresses"
  >
>;

export async function updateClient(clientId: string, patch: UpdateClientInput): Promise<void> {
  const clientsRef = getClientsRef();

  if (!clientsRef) {
    throw new Error("Firebase is not configured");
  }

  await updateDoc(doc(clientsRef, clientId), {
    ...patch,
    updatedAt: new Date(),
  });
}

/**
 * Updates the client document, then batch-updates all jobs for this user with the same
 * `clientId` so job billing/site mirrors the client record (invoice/ledger views stay aligned).
 */
export async function updateClientWithPropagation(
  clientId: string,
  patch: UpdateClientInput,
): Promise<void> {
  await updateClient(clientId, patch);
  const client = await getClientById(clientId);
  if (!client || !db) {
    return;
  }

  const firestore = db;

  const jobsRef = getJobsRef();
  if (!jobsRef) {
    return;
  }

  const uid = getCurrentUidOrThrow();
  const jobsSnap = await getDocs(
    query(jobsRef, where("createdByUid", "==", uid), where("clientId", "==", clientId)),
  );

  const now = new Date();
  let batch = writeBatch(firestore);
  let ops = 0;

  const flush = async () => {
    if (ops === 0) {
      return;
    }
    await batch.commit();
    batch = writeBatch(firestore);
    ops = 0;
  };

  for (const snap of jobsSnap.docs) {
    batch.update(snap.ref, {
      billingAddress: client.billingAddress ?? null,
      updatedAt: now,
    });
    ops++;
    if (ops >= 400) {
      await flush();
    }
  }

  await flush();
}
