import type { DocumentRefinementPayload } from "@/lib/document-refinement-payload";
import type {
  Client,
  Job,
  JobDocumentRecord,
  JobWorkflowStatus,
  LineItem,
  StoredDocumentVersion,
  UserSettings,
} from "@/types/database";

export type DocumentVersion = {
  versionId: string;
  timestamp: number;
  commitMessage: string;
  payload: DocumentRefinementPayload;
};

const DATE_FIELD_KEYS = new Set([
  "createdAt",
  "updatedAt",
  "startDate",
  "dueDate",
  "deletedAt",
  "paidAt",
  "issueDate",
  "expiryDate",
]);

function reviveDates(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(reviveDates);
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (DATE_FIELD_KEYS.has(key) && typeof nested === "string") {
      const parsed = new Date(nested);
      out[key] = Number.isNaN(parsed.getTime()) ? nested : parsed;
    } else {
      out[key] = reviveDates(nested);
    }
  }
  return out;
}

export function serializeRefinementPayload(
  payload: DocumentRefinementPayload,
): Record<string, unknown> {
  return JSON.parse(
    JSON.stringify(payload, (_key, value) => {
      if (value instanceof Date) {
        return value.toISOString();
      }
      return value;
    }),
  ) as Record<string, unknown>;
}

export function deserializeRefinementPayload(raw: unknown): DocumentRefinementPayload | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  try {
    return reviveDates(raw) as DocumentRefinementPayload;
  } catch {
    return null;
  }
}

export function createDocumentVersion(
  payload: DocumentRefinementPayload,
  commitMessage: string,
): DocumentVersion {
  return {
    versionId: crypto.randomUUID(),
    timestamp: Date.now(),
    commitMessage: commitMessage.trim() || "Document updated",
    payload: structuredClone(payload),
  };
}

function mapStoredVersion(raw: unknown): DocumentVersion | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const row = raw as Record<string, unknown>;
  const payload = deserializeRefinementPayload(row.payload);
  if (!payload) {
    return null;
  }
  return {
    versionId: typeof row.versionId === "string" ? row.versionId : crypto.randomUUID(),
    timestamp: typeof row.timestamp === "number" ? row.timestamp : Date.now(),
    commitMessage: typeof row.commitMessage === "string" ? row.commitMessage : "Document version",
    payload,
  };
}

export function resolveDocumentVersions(
  document: JobDocumentRecord,
  fallbackPayload: DocumentRefinementPayload,
): DocumentVersion[] {
  if (document.versions?.length) {
    return document.versions
      .map(mapStoredVersion)
      .filter((version): version is DocumentVersion => version !== null)
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  const stored = document.refinementPayload
    ? deserializeRefinementPayload(document.refinementPayload)
    : null;

  return [
    createDocumentVersion(stored ?? fallbackPayload, "Legacy Document"),
  ];
}

export function resolveActiveDocumentPayload(
  document: JobDocumentRecord,
  fallbackPayload: DocumentRefinementPayload,
): DocumentRefinementPayload {
  const stored = document.refinementPayload
    ? deserializeRefinementPayload(document.refinementPayload)
    : null;
  if (stored) {
    return stored;
  }

  const versions = resolveDocumentVersions(document, fallbackPayload);
  return versions[0]?.payload ?? fallbackPayload;
}

export function reconstructPayloadFromDocument(input: {
  document: JobDocumentRecord;
  job: Job;
  client: Client;
  settings: UserSettings;
  lineItems: LineItem[];
}): DocumentRefinementPayload {
  const { document, job, client, settings, lineItems } = input;
  const template =
    settings.templates.find((entry) => entry.id === document.templateId) ??
    settings.templates[0];
  const style = template?.style;
  const docLineItems = lineItems.filter((item) => document.lineItemIds.includes(item.id));
  const subtotalCents = document.subtotalCents;
  const markupCents = document.markupCents;
  const markupPercent =
    subtotalCents > 0
      ? Math.min(100, Math.max(0, Math.round((markupCents / subtotalCents) * 100)))
      : (job.materialMarkupPercent ?? 15);

  return {
    documentType: document.type,
    documentNumber: document.documentNumber,
    job,
    client,
    settings,
    lineItems: docLineItems.length > 0 ? docLineItems : lineItems,
    templateId: document.templateId ?? template?.id ?? "default",
    templateName: document.templateName ?? template?.name ?? "Default template",
    subtotalCents,
    markupCents,
    markupPercent,
    taxCents: document.taxCents,
    totalCents: document.totalCents,
    groupLaborAndMaterialsSeparately: style?.groupLaborAndMaterialsSeparately ?? true,
    accentColor: style?.accentColor ?? "#0073EA",
    bodySize: style?.bodySize ?? 10,
    headingSize: style?.headingSize ?? 16,
    showLargeTotal: style?.showLargeTotal ?? true,
    quoteBody: null,
    invoiceBody: null,
  };
}

function isDocumentFinanciallyLocked(
  document: JobDocumentRecord,
  jobStatus: JobWorkflowStatus,
): boolean {
  if (document.type === "invoice") {
    return document.status === "paid" || jobStatus === "paid";
  }
  return document.type === "quote" && document.status === "accepted";
}

export function isDocumentEditLocked(
  document: JobDocumentRecord,
  jobStatus: JobWorkflowStatus,
): { locked: boolean; reason?: string } {
  if (isDocumentFinanciallyLocked(document, jobStatus)) {
    return {
      locked: true,
      reason: "This document is finalized. Create a revision to edit.",
    };
  }

  return { locked: false };
}

export function isDocumentDeleteLocked(
  document: JobDocumentRecord,
  jobStatus: JobWorkflowStatus,
): { locked: boolean; reason?: string } {
  if (isDocumentFinanciallyLocked(document, jobStatus)) {
    return {
      locked: true,
      reason: "Cannot delete a finalized/paid document. Please change status to Draft to delete.",
    };
  }

  return { locked: false };
}

export function getDocumentVersionCount(document: JobDocumentRecord): number {
  return document.versions?.length || 1;
}

export function getDocumentLastModifiedMs(document: JobDocumentRecord): number {
  if (document.versions?.length) {
    return Math.max(...document.versions.map((version) => version.timestamp));
  }

  const updatedAt = document.updatedAt;
  if (updatedAt instanceof Date) {
    return updatedAt.getTime();
  }

  return new Date(String(updatedAt ?? Date.now())).getTime();
}

export function formatDocumentEditedAgo(document: JobDocumentRecord): string {
  const ms = getDocumentLastModifiedMs(document);
  const diffMs = Date.now() - ms;
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMins < 1) {
    return "Edited just now";
  }
  if (diffMins < 60) {
    return `Edited ${diffMins} min${diffMins === 1 ? "" : "s"} ago`;
  }
  if (diffHours < 24) {
    return `Edited ${diffHours} hr${diffHours === 1 ? "" : "s"} ago`;
  }
  if (diffDays < 7) {
    return `Edited ${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
  }

  return `Edited ${new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
  }).format(new Date(ms))}`;
}

export function formatVersionTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

export function serializeDocumentVersion(version: DocumentVersion): StoredDocumentVersion {
  return {
    versionId: version.versionId,
    timestamp: version.timestamp,
    commitMessage: version.commitMessage,
    payload: serializeRefinementPayload(version.payload),
  };
}
