import type { InvoiceDocumentAiBody, QuoteDocumentAiBody } from "@/lib/ai/document-body-shared";
import type { Client, DocumentTemplate, Job, LineItem, PostalAddress, UserSettings } from "@/types/database";

export type DocumentThemeOverrides = {
  primaryTextColor?: string;
  accentColor?: string;
};

export type DocumentRefinementPayload = {
  documentType: "quote" | "invoice";
  documentNumber: string;
  job: Job;
  client: Client;
  settings: UserSettings;
  lineItems: LineItem[];
  templateId: string;
  templateName: string;
  subtotalCents: number;
  markupCents: number;
  markupPercent: number;
  taxCents: number;
  totalCents: number;
  groupLaborAndMaterialsSeparately: boolean;
  accentColor: string;
  bodySize: number;
  headingSize: number;
  showLargeTotal: boolean;
  quoteBody: QuoteDocumentAiBody | null;
  invoiceBody: InvoiceDocumentAiBody | null;
  themeOverrides?: DocumentThemeOverrides;
};

export type DocumentRefinementAiDelta = {
  subtotalCents?: number;
  markupCents?: number;
  markupPercent?: number;
  taxCents?: number;
  totalCents?: number;
  client?: Partial<Client>;
  themeOverrides?: DocumentThemeOverrides;
  accentColor?: string;
  quoteBody?: QuoteDocumentAiBody;
  invoiceBody?: InvoiceDocumentAiBody;
};

function mergePostalAddress(
  base: PostalAddress | undefined,
  patch: unknown,
): PostalAddress | undefined {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    return base;
  }
  const p = patch as Partial<PostalAddress>;
  if (!base) {
    if (typeof p.line1 !== "string" || !p.line1.trim()) {
      return undefined;
    }
    return {
      line1: p.line1.trim(),
      line2: typeof p.line2 === "string" ? p.line2.trim() || undefined : undefined,
      suburb: typeof p.suburb === "string" ? p.suburb.trim() : "",
      state: typeof p.state === "string" ? p.state.trim() : "",
      postcode: typeof p.postcode === "string" ? p.postcode.trim() : "",
      country: typeof p.country === "string" ? p.country.trim() : "Australia",
    };
  }
  return {
    line1: typeof p.line1 === "string" && p.line1.trim() ? p.line1.trim() : base.line1,
    line2: typeof p.line2 === "string" ? p.line2.trim() || undefined : base.line2,
    suburb: typeof p.suburb === "string" && p.suburb.trim() ? p.suburb.trim() : base.suburb,
    state: typeof p.state === "string" && p.state.trim() ? p.state.trim() : base.state,
    postcode: typeof p.postcode === "string" && p.postcode.trim() ? p.postcode.trim() : base.postcode,
    country: typeof p.country === "string" && p.country.trim() ? p.country.trim() : base.country,
  };
}

export function mergeClientPatch(base: Client, patch: Partial<Client> | undefined): Client {
  if (!patch || typeof patch !== "object") {
    return base;
  }

  const next: Client = { ...base };

  if (typeof patch.displayName === "string" && patch.displayName.trim()) {
    next.displayName = patch.displayName.trim();
  }
  if (typeof patch.legalName === "string") {
    next.legalName = patch.legalName.trim() || undefined;
  }
  if (typeof patch.email === "string") {
    next.email = patch.email.trim() || undefined;
  }
  if (typeof patch.phone === "string") {
    next.phone = patch.phone.trim() || undefined;
  }
  if (typeof patch.notes === "string") {
    next.notes = patch.notes.trim() || undefined;
  }
  if (patch.billingAddress !== undefined) {
    next.billingAddress = mergePostalAddress(base.billingAddress, patch.billingAddress);
  }
  if (patch.siteAddress !== undefined) {
    next.siteAddress = mergePostalAddress(base.siteAddress, patch.siteAddress);
  }
  if (typeof patch.defaultPurchaseOrderNumber === "string") {
    next.defaultPurchaseOrderNumber = patch.defaultPurchaseOrderNumber.trim() || undefined;
  }

  return next;
}

export function parseThemeOverrides(raw: unknown): DocumentThemeOverrides | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }
  const o = raw as Record<string, unknown>;
  const out: DocumentThemeOverrides = {};
  if (typeof o.primaryTextColor === "string" && o.primaryTextColor.trim()) {
    out.primaryTextColor = o.primaryTextColor.trim();
  }
  if (typeof o.accentColor === "string" && o.accentColor.trim()) {
    out.accentColor = o.accentColor.trim();
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function mergeThemeOverrides(
  base: DocumentThemeOverrides | undefined,
  patch: DocumentThemeOverrides | undefined,
): DocumentThemeOverrides | undefined {
  if (!patch) {
    return base;
  }
  return { ...base, ...patch };
}

export function refinementDeltaHasChanges(delta: DocumentRefinementAiDelta): boolean {
  return Object.keys(delta).length > 0;
}

export function buildDocumentRefinementPayload(input: {
  documentType: "quote" | "invoice";
  documentNumber: string;
  job: Job;
  client: Client;
  settings: UserSettings;
  lineItems: LineItem[];
  template: DocumentTemplate;
  subtotalCents: number;
  markupCents: number;
  markupPercent: number;
  taxCents: number;
  totalCents: number;
  quoteBody: QuoteDocumentAiBody | null;
  invoiceBody: InvoiceDocumentAiBody | null;
}): DocumentRefinementPayload {
  const style = input.template.style;
  return {
    documentType: input.documentType,
    documentNumber: input.documentNumber,
    job: input.job,
    client: input.client,
    settings: input.settings,
    lineItems: input.lineItems,
    templateId: input.template.id,
    templateName: input.template.name,
    subtotalCents: input.subtotalCents,
    markupCents: input.markupCents,
    markupPercent: input.markupPercent,
    taxCents: input.taxCents,
    totalCents: input.totalCents,
    groupLaborAndMaterialsSeparately: style.groupLaborAndMaterialsSeparately,
    accentColor: style.accentColor,
    bodySize: style.bodySize,
    headingSize: style.headingSize,
    showLargeTotal: style.showLargeTotal,
    quoteBody: input.quoteBody,
    invoiceBody: input.invoiceBody,
  };
}

function finiteCents(value: unknown, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.round(value));
}

export function applyRefinementDelta(
  base: DocumentRefinementPayload,
  delta: DocumentRefinementAiDelta,
): DocumentRefinementPayload {
  const next: DocumentRefinementPayload = {
    ...base,
    subtotalCents: delta.subtotalCents != null ? finiteCents(delta.subtotalCents, base.subtotalCents) : base.subtotalCents,
    markupCents: delta.markupCents != null ? finiteCents(delta.markupCents, base.markupCents) : base.markupCents,
    markupPercent:
      delta.markupPercent != null && Number.isFinite(delta.markupPercent)
        ? Math.min(100, Math.max(0, Math.round(delta.markupPercent)))
        : base.markupPercent,
    taxCents: delta.taxCents != null ? finiteCents(delta.taxCents, base.taxCents) : base.taxCents,
    totalCents: delta.totalCents != null ? finiteCents(delta.totalCents, base.totalCents) : base.totalCents,
  };

  if (delta.client) {
    next.client = mergeClientPatch(base.client, delta.client);
  }

  const themePatch = parseThemeOverrides(delta.themeOverrides) ?? parseThemeOverrides(
    delta.accentColor ? { accentColor: delta.accentColor } : undefined,
  );
  if (themePatch) {
    next.themeOverrides = mergeThemeOverrides(base.themeOverrides, themePatch);
    if (themePatch.accentColor) {
      next.accentColor = themePatch.accentColor;
    }
  } else if (typeof delta.accentColor === "string" && delta.accentColor.trim()) {
    next.accentColor = delta.accentColor.trim();
    next.themeOverrides = mergeThemeOverrides(base.themeOverrides, { accentColor: next.accentColor });
  }

  if (base.documentType === "quote" && delta.quoteBody) {
    next.quoteBody = delta.quoteBody;
    next.invoiceBody = null;
  } else if (base.documentType === "invoice" && delta.invoiceBody) {
    next.invoiceBody = delta.invoiceBody;
    next.quoteBody = null;
  }

  return next;
}
