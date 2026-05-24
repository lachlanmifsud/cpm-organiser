"use client";

import { useMemo, useRef, useState } from "react";
import Image from "next/image";
import { Download, Eye, FileText, History, ImagePlus, Trash2, UploadCloud, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DeleteDocumentConfirmModal } from "@/components/delete-document-confirm-modal";
import {
  formatDocumentEditedAgo,
  getDocumentVersionCount,
  isDocumentDeleteLocked,
  isDocumentEditLocked,
} from "@/lib/document-versions";
import { JobDocumentRecord, JobFileRecord, JobWorkflowStatus, LineItem } from "@/types/database";
import { ReceiptStash } from "@/components/receipt-stash";
import { cn } from "@/lib/utils";

export type JobFilesSection = "quotes" | "invoices" | "receipts" | "other-docs";

type JobFilesExplorerProps = {
  section: JobFilesSection;
  jobId: string;
  /** Material lines on this job — used by Receipt stash to highlight synced rows. */
  ledgerLineItems: LineItem[];
  documents: JobDocumentRecord[];
  files: JobFileRecord[];
  /** When set, the matching finalized invoice card flashes (Workbench deep-link). */
  highlightedDocumentId?: string | null;
  /** When set, the matching finalized quote card flashes (Workbench deep-link). */
  highlightedQuoteId?: string | null;
  onUploadReceipt: (file: File) => void;
  onUploadOther: (file: File) => void;
  onUploadSitePhoto: (file: File) => void;
  onOpenReceiptWorkbench: (file: JobFileRecord) => void;
  jobStatus?: JobWorkflowStatus;
  onEditDocument?: (document: JobDocumentRecord) => void;
  onDeleteDocument?: (document: JobDocumentRecord) => Promise<void>;
  deletingDocumentId?: string | null;
};

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(value);
}

function DocumentMetadataCluster({
  document,
  jobStatus,
  onDeleteRequest,
  isDeleting,
}: {
  document: JobDocumentRecord;
  jobStatus?: JobWorkflowStatus;
  onDeleteRequest?: (document: JobDocumentRecord) => void;
  isDeleting?: boolean;
}) {
  const versionCount = getDocumentVersionCount(document);
  const editedLabel = formatDocumentEditedAgo(document);
  const deleteLock = jobStatus ? isDocumentDeleteLocked(document, jobStatus) : { locked: false };

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-3 text-xs text-[#676879]">
        <span className="flex items-center gap-1 rounded-md border border-[#E6E9EF] bg-[#F5F6F8] px-2 py-1">
          <History className="size-3" aria-hidden />
          v{versionCount}
        </span>
        <span className="whitespace-nowrap">{editedLabel}</span>
      </div>
      {onDeleteRequest ? (
        <button
          type="button"
          disabled={deleteLock.locked || isDeleting}
          title={
            deleteLock.locked
              ? deleteLock.reason
              : isDeleting
                ? "Deleting…"
                : "Delete document"
          }
          onClick={() => {
            if (!deleteLock.locked && !isDeleting) {
              onDeleteRequest(document);
            }
          }}
          className={cn(
            "rounded-md p-1.5 text-[#C3C6D4] transition-colors",
            deleteLock.locked || isDeleting
              ? "cursor-not-allowed opacity-50"
              : "hover:bg-[#FCECEE] hover:text-[#E2445C]",
          )}
          aria-label="Delete document"
        >
          <Trash2 className="size-4" />
        </button>
      ) : null}
    </div>
  );
}

function FileActions({
  href,
  fileName,
  document,
  jobStatus,
  onEditDocument,
}: {
  href: string;
  fileName: string;
  document?: JobDocumentRecord;
  jobStatus?: JobWorkflowStatus;
  onEditDocument?: (document: JobDocumentRecord) => void;
}) {
  const lock = document && jobStatus ? isDocumentEditLocked(document, jobStatus) : { locked: false };

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {document && onEditDocument ? (
        <button
          type="button"
          disabled={lock.locked}
          title={lock.locked ? lock.reason : "Edit / Refine"}
          onClick={() => {
            if (!lock.locked) {
              onEditDocument(document);
            }
          }}
          className={cn(
            "inline-flex h-9 min-w-[8.5rem] flex-1 items-center justify-center gap-2 rounded-lg border border-[#D0D4E4] bg-white text-sm font-semibold transition",
            lock.locked
              ? "cursor-not-allowed text-[#C3C6D4] hover:border-[#D0D4E4]"
              : "text-[#0073EA] hover:border-[#0073EA] hover:bg-[#F5FAFF]",
          )}
        >
          <Wand2 className="size-4" />
          Edit / Refine
        </button>
      ) : null}
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-lg border border-[#D0D4E4] bg-white text-sm font-semibold text-[#323338] transition hover:border-[#0073EA]"
      >
        <Eye className="size-4" />
        View
      </a>
      <a
        href={href}
        download={fileName}
        className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-lg border border-[#D0D4E4] bg-white text-sm font-semibold text-[#323338] transition hover:border-[#0073EA]"
      >
        <Download className="size-4" />
        Download
      </a>
    </div>
  );
}

function formatCurrency(valueCents: number) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
  }).format(valueCents / 100);
}

function DocumentCards({
  documents,
  legacyPdfs,
  emptyLabel,
  highlightedDocumentId,
  highlightedQuoteId,
  jobStatus,
  onEditDocument,
  onDeleteDocument,
  deletingDocumentId,
}: {
  documents: JobDocumentRecord[];
  legacyPdfs: JobFileRecord[];
  emptyLabel: string;
  highlightedDocumentId?: string | null;
  highlightedQuoteId?: string | null;
  jobStatus?: JobWorkflowStatus;
  onEditDocument?: (document: JobDocumentRecord) => void;
  onDeleteDocument?: (document: JobDocumentRecord) => Promise<void>;
  deletingDocumentId?: string | null;
}) {
  const [pendingDelete, setPendingDelete] = useState<JobDocumentRecord | null>(null);

  if (documents.length === 0 && legacyPdfs.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[#D0D4E4] bg-white px-5 py-10 text-center text-[#676879]">
        {emptyLabel}
      </div>
    );
  }

  return (
    <>
      <div className="space-y-4">
        {documents.map((document) => (
          <div
            key={document.id}
            className={cn(
              "rounded-lg border border-[#D0D4E4] bg-white/70 p-4",
              highlightedDocumentId === document.id &&
                "animate-[pulse_1.5s_ease-in-out_2] border-l-4 border-l-[#0073EA] bg-[#0073EA]/20",
              highlightedQuoteId === document.id &&
                "animate-[pulse_1.5s_ease-in-out_2] border-l-4 border-l-blue-500 bg-blue-500/20",
            )}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[#323338]">
                  <FileText className="size-4 shrink-0 text-[#0073EA]" />
                  <p className="font-medium">{document.documentNumber}</p>
                </div>
                <p className="mt-1 text-sm text-[#676879]">
                  {document.type} · {formatCurrency(document.totalCents)} · {formatDate(document.createdAt)}
                </p>
                <p className="mt-1 text-sm text-[#676879]">{document.templateName ?? "Untitled template"}</p>
              </div>
              <DocumentMetadataCluster
                document={document}
                jobStatus={jobStatus}
                onDeleteRequest={onDeleteDocument ? setPendingDelete : undefined}
                isDeleting={deletingDocumentId === document.id}
              />
            </div>
            <FileActions
              href={document.downloadUrl}
              fileName={document.fileName}
              document={document}
              jobStatus={jobStatus}
              onEditDocument={onEditDocument}
            />
          </div>
        ))}
        {legacyPdfs.map((file) => (
          <div key={file.id} className="rounded-lg border border-[#D0D4E4] bg-white/70 p-4">
            <div className="flex items-center gap-2 text-[#323338]">
              <FileText className="size-4 text-[#676879]" />
              <p className="font-medium">{file.name}</p>
            </div>
            <p className="mt-1 text-sm text-[#676879]">Legacy generated document</p>
            <FileActions href={file.downloadUrl} fileName={file.name} />
          </div>
        ))}
      </div>

      {pendingDelete && onDeleteDocument ? (
        <DeleteDocumentConfirmModal
          isDeleting={deletingDocumentId === pendingDelete.id}
          onCancel={() => {
            if (deletingDocumentId !== pendingDelete.id) {
              setPendingDelete(null);
            }
          }}
          onConfirm={async () => {
            try {
              await onDeleteDocument(pendingDelete);
              setPendingDelete(null);
            } catch {
              // Parent surfaces the error toast; keep the modal open for retry.
            }
          }}
        />
      ) : null}
    </>
  );
}

export function JobFilesExplorer({
  section,
  jobId,
  ledgerLineItems,
  documents,
  files,
  highlightedDocumentId,
  highlightedQuoteId,
  onUploadReceipt,
  onUploadOther,
  onUploadSitePhoto,
  onOpenReceiptWorkbench,
  jobStatus,
  onEditDocument,
  onDeleteDocument,
  deletingDocumentId,
}: JobFilesExplorerProps) {
  const receiptInputRef = useRef<HTMLInputElement>(null);
  const otherInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const receiptFiles = useMemo(() => files.filter((file) => file.kind === "receipt"), [files]);
  const otherFiles = useMemo(
    () => files.filter((file) => ["document", "other", "site_photo"].includes(file.kind)),
    [files],
  );

  const quoteDocuments = useMemo(() => documents.filter((d) => d.type === "quote"), [documents]);
  const invoiceDocuments = useMemo(() => documents.filter((d) => d.type === "invoice"), [documents]);
  const legacyQuotePdfs = useMemo(() => files.filter((file) => file.kind === "quote_pdf"), [files]);
  const legacyInvoicePdfs = useMemo(() => files.filter((file) => file.kind === "invoice_pdf"), [files]);

  if (section === "quotes") {
    return (
      <DocumentCards
        documents={quoteDocuments}
        legacyPdfs={legacyQuotePdfs}
        emptyLabel="No finalized quote PDFs yet. Generate a quote from the Workbench tab."
        highlightedQuoteId={highlightedQuoteId}
        jobStatus={jobStatus}
        onEditDocument={onEditDocument}
        onDeleteDocument={onDeleteDocument}
        deletingDocumentId={deletingDocumentId}
      />
    );
  }

  if (section === "invoices") {
    return (
      <DocumentCards
        documents={invoiceDocuments}
        legacyPdfs={legacyInvoicePdfs}
        emptyLabel="No finalized invoice PDFs yet. Generate an invoice from the Workbench tab."
        highlightedDocumentId={highlightedDocumentId}
        jobStatus={jobStatus}
        onEditDocument={onEditDocument}
        onDeleteDocument={onDeleteDocument}
        deletingDocumentId={deletingDocumentId}
      />
    );
  }

  if (section === "receipts") {
    return (
      <div className="w-full min-w-0">
        <input
          ref={receiptInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];

            if (file) {
              onUploadReceipt(file);
            }

            event.target.value = "";
          }}
        />
        <ReceiptStash
          jobId={jobId}
          ledgerLineItems={ledgerLineItems}
          pendingReceiptFiles={receiptFiles.filter((f) => !f.isProcessed)}
          onUploadReceipt={onUploadReceipt}
          onRequestPickFile={() => receiptInputRef.current?.click()}
          onOpenReceiptWorkbench={onOpenReceiptWorkbench}
        />
      </div>
    );
  }

  /* other-docs */
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <input
          ref={otherInputRef}
          type="file"
          accept=".pdf,image/*"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];

            if (file) {
              onUploadOther(file);
            }

            event.target.value = "";
          }}
        />
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];

            if (file) {
              onUploadSitePhoto(file);
            }

            event.target.value = "";
          }}
        />
        <Button onClick={() => photoInputRef.current?.click()}>
          <ImagePlus className="size-4" />
          Upload Site Photo
        </Button>
        <Button variant="secondary" onClick={() => otherInputRef.current?.click()}>
          <UploadCloud className="size-4" />
          Upload Other File
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {otherFiles.length === 0 ? (
          <div className="col-span-full rounded-lg border border-dashed border-[#D0D4E4] bg-white px-5 py-10 text-center text-[#676879]">
            No site photos or general documents yet. Upload files above.
          </div>
        ) : null}
        {otherFiles.map((file) => (
          <div key={file.id} className="rounded-lg border border-[#D0D4E4] bg-white/70 p-4">
            {file.mimeType.startsWith("image/") ? (
              <Image
                src={file.downloadUrl}
                alt={file.name}
                width={320}
                height={180}
                unoptimized
                className="h-40 w-full rounded-lg object-cover"
              />
            ) : (
              <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-[#D0D4E4] text-[#676879]">
                <FileText className="size-6" />
              </div>
            )}
            <p className="mt-3 truncate font-semibold text-[#323338]">{file.name}</p>
            <p className="text-sm capitalize text-[#676879]">{file.kind.replace("_", " ")}</p>
            <FileActions href={file.downloadUrl} fileName={file.name} />
          </div>
        ))}
      </div>
    </div>
  );
}
