export type DocId = string;
export type ISODate = Date;
export type CurrencyCents = number;

export type JobWorkflowStatus =
  | "new"
  | "quoted"
  | "in-progress"
  | "invoiced"
  | "paid";

export type AddressType = "billing" | "site";

export type LineItemBillingStatus = "unbilled" | "quoted" | "invoiced";

export type GeneratedDocumentType = "quote" | "invoice";

export type LineItemInvoicedHistoryEntry = {
  invoiceId: DocId;
  invoiceNumber: string;
  /** ISO timestamp string when the line was committed to the invoice. */
  date: string;
  /** Portion of this line’s total (cents, AUD) attributed to this invoice. */
  amountAllocated?: number;
  quantityAllocated?: number;
};

export type LineItemQuotedHistoryEntry = {
  quoteId: DocId;
  quoteNumber: string;
  /** ISO timestamp string when the line was committed to the quote. */
  date: string;
  /** Portion of this line’s total (cents, AUD) attributed to this quote. */
  amountAllocated?: number;
};

export type LineItemKind =
  | "labor"
  | "material"
  | "variation"
  | "credit"
  | "return";

export type LaborRateType = "builder" | "apprentice" | "custom";

export interface AuditFields {
  createdAt: ISODate;
  updatedAt: ISODate;
  createdByUid: string;
}

export interface PostalAddress {
  line1: string;
  line2?: string;
  suburb: string;
  state: string;
  postcode: string;
  country: string;
}

/** Physical job site location linked to a client (supports multi-site clients). */
export interface SiteAddress {
  id: string;
  label: string;
  street: string;
  suburb: string;
  state: string;
  postcode: string;
}

export interface BusinessProfile {
  businessName: string;
  abnOrAcn: string;
  address?: PostalAddress;
  bankName: string;
  bsb: string;
  accountNumber: string;
  paymentTerms: string;
  logoUrl?: string;
  logoStoragePath?: string;
}

export interface PdfTemplateStyle {
  tone: string;
  accentColor: string;
  fontFamily: string;
  headingSize: number;
  bodySize: number;
  sectionOrder: string[];
  groupLaborAndMaterialsSeparately: boolean;
  showLargeTotal: boolean;
  tableStyle: "compact" | "comfortable" | "minimal";
  spacing: "tight" | "normal" | "relaxed";
}

export interface DocumentTemplate extends AuditFields {
  id: DocId;
  name: string;
  prompt: string;
  style: PdfTemplateStyle;
}

export interface UserSettings extends AuditFields {
  id: DocId;
  businessProfile: BusinessProfile;
  templates: DocumentTemplate[];
  /** Global voice / rules injected when generating invoices (AI + PDF context). */
  invoiceSystemPrompt?: string;
  /** Global voice / rules injected when generating quotes (AI + PDF context). */
  quoteSystemPrompt?: string;
}

export interface Client extends AuditFields {
  id: DocId;
  displayName: string;
  legalName?: string;
  email?: string;
  phone?: string;
  notes?: string;
  billingAddress?: PostalAddress;
  /** @deprecated Legacy single site — prefer siteAddresses. Kept for backward compatibility. */
  siteAddress?: PostalAddress;
  siteAddresses?: SiteAddress[];
  isSchoolClient: boolean;
  defaultPurchaseOrderNumber?: string;
  isArchived: boolean;
}

export interface Job extends AuditFields {
  id: DocId;
  clientId: DocId | null;
  title: string;
  description?: string;
  status: JobWorkflowStatus;
  billingAddress?: PostalAddress;
  siteAddress?: PostalAddress;
  /** Which client siteAddresses entry this job targets. */
  siteAddressId?: DocId;
  purchaseOrderNumber?: string;
  quoteIds: DocId[];
  invoiceIds: DocId[];
  fileIds: DocId[];
  duplicateSourceJobId?: DocId;
  startDate?: ISODate;
  dueDate?: ISODate;
  isArchived: boolean;
  /** Material markup applied on quotes/invoices; defaults to 15 when unset. */
  materialMarkupPercent?: number;
}

export interface InvoicePayment {
  id: DocId;
  amountCents: CurrencyCents;
  paidAt: ISODate;
  method: "cash" | "bank_transfer" | "card" | "other";
  note?: string;
}

export interface Quote extends AuditFields {
  id: DocId;
  clientId: DocId;
  jobId: DocId;
  quoteNumber: string;
  issueDate: ISODate;
  expiryDate?: ISODate;
  lineItemIds: DocId[];
  subtotalCents: CurrencyCents;
  taxCents: CurrencyCents;
  totalCents: CurrencyCents;
  convertedToInvoiceId?: DocId;
  variationItemIds: DocId[];
  status: "draft" | "sent" | "accepted" | "expired";
}

export interface Invoice extends AuditFields {
  id: DocId;
  clientId: DocId;
  jobId: DocId;
  invoiceNumber: string;
  sourceQuoteId?: DocId;
  issueDate: ISODate;
  dueDate?: ISODate;
  lineItemIds: DocId[];
  subtotalCents: CurrencyCents;
  taxCents: CurrencyCents;
  totalCents: CurrencyCents;
  totalPaidCents: CurrencyCents;
  paymentStatus: JobWorkflowStatus;
  purchaseOrderNumber?: string;
  billingAddress?: PostalAddress;
  siteAddress?: PostalAddress;
  paymentIds: DocId[];
  pdfStoragePath?: string;
}

export interface ReceiptExtractionItem {
  id: DocId;
  description: string;
  quantity: number;
  unitPriceCents: CurrencyCents;
  totalPriceCents: CurrencyCents;
  splitAllocations: Array<{
    jobId: DocId;
    amountCents: CurrencyCents;
  }>;
}

/** Snapshot of lines stored when a receipt is synced (audit / stash panel). */
export interface ReceiptStashLineSnapshot {
  description: string;
  rawDescription: string;
  quantity: number;
  unitPriceCents: CurrencyCents;
  subtotalCents: CurrencyCents;
}

export interface JobFileRecord {
  id: DocId;
  jobId: DocId;
  name: string;
  kind: "receipt" | "document" | "invoice_pdf" | "quote_pdf" | "site_photo" | "other";
  mimeType: string;
  storagePath: string;
  downloadUrl: string;
  createdAt: ISODate;
  isProcessed?: boolean;
  /** Populated after successful sync from receipt workbench. */
  vendorName?: string | null;
  /** YYYY-MM-DD from extraction when available. */
  receiptDate?: string | null;
  totalGstCents?: number | null;
  /** Sum of synced line subtotals, cents (inc GST). */
  totalAmountCents?: number | null;
  stashLineItems?: ReceiptStashLineSnapshot[];
}

export type JobDocumentWorkflowStatus =
  | "draft"
  | "sent"
  | "accepted"
  | "expired"
  | "paid";

export type StoredDocumentVersion = {
  versionId: string;
  timestamp: number;
  commitMessage: string;
  payload: Record<string, unknown>;
};

export interface JobDocumentRecord extends AuditFields {
  id: DocId;
  jobId: DocId;
  clientId: DocId;
  type: GeneratedDocumentType;
  documentNumber: string;
  templateId?: DocId;
  templateName?: string;
  fileName: string;
  storagePath: string;
  downloadUrl: string;
  subtotalCents: CurrencyCents;
  markupCents: CurrencyCents;
  taxCents: CurrencyCents;
  totalCents: CurrencyCents;
  lineItemIds: DocId[];
  /** Workflow lock for edit guardrails (quote accepted / invoice paid). */
  status?: JobDocumentWorkflowStatus;
  /** Latest editable JSON blueprint for PDF re-generation. */
  refinementPayload?: Record<string, unknown>;
  /** Linear version history (newest appended on each Save & Finalize). */
  versions?: StoredDocumentVersion[];
}

export interface LineItem extends AuditFields {
  id: DocId;
  clientId: DocId;
  jobId: DocId;
  parentType: "quote" | "invoice";
  parentId: DocId;
  status: LineItemBillingStatus;
  docRef?: DocId;
  /** Ledger of invoice placements (multi-invoice / partial billing). */
  invoicedHistory?: LineItemInvoicedHistoryEntry[];
  /** Ledger of quote placements (multi-quote / partial). Independent of `invoicedHistory`. */
  quotedHistory?: LineItemQuotedHistoryEntry[];
  kind: LineItemKind;
  description: string;
  quantity: number;
  unit: "hours" | "item" | "m2" | "m3" | "day" | "week" | "month";
  unitPriceCents: CurrencyCents;
  subtotalCents: CurrencyCents;
  taxRatePercent?: number;
  taxCents: CurrencyCents;
  totalCents: CurrencyCents;
  laborRateType?: LaborRateType;
  laborRoleLabel?: string;
  receiptImageStoragePath?: string;
  /** Firestore receipt file id (same as receipt file record id when from stash sync). */
  receiptFileId?: DocId;
  /** Verbatim receipt line text for reconciliation with stash. */
  rawReceiptDescription?: string;
  receiptExtractionItemId?: DocId;
  variationForLineItemId?: DocId;
  creditForLineItemId?: DocId;
  returnForLineItemId?: DocId;
  deletedAt?: ISODate;
}
