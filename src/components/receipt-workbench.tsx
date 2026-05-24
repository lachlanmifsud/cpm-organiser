"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { toast } from "sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ProcessingOverlay } from "@/components/processing-overlay";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getActiveJobs,
  syncReceiptToJobs,
  type SyncReceiptInput,
  type SyncReceiptItem,
} from "@/lib/firebase/repository";
import { JobFileRecord } from "@/types/database";
import {
  extractReceiptClient,
  type ExtractedReceiptItem,
} from "@/lib/ai/extract-receipt-client";
import {
  coerceNumberInputValue,
  formatNumberInputValue,
  parseNumberInputChange,
  type NumberInputValue,
} from "@/lib/number-input";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WorkbenchItem {
  tempId: string;
  description: string;
  rawDescription: string;
  quantity: NumberInputValue;
  unitPriceIncGst: NumberInputValue;
  targetJobId: string;
  isManual: boolean;
}

interface ReceiptWorkbenchProps {
  receipt: JobFileRecord;
  /** Local file from the uploader — preferred for AI extraction (bytes never go through Storage fetch). */
  sourceImageFile?: File | null;
  currentJobId: string;
  onClose: () => void;
  onSynced: () => void;
  autoStart?: boolean;
  onExtractionComplete?: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type HeaderDraft = {
  vendorName: string;
  receiptDate: string;
  totalGstDollars: string;
  totalAmountDollars: string;
};

function emptyHeaderDraft(): HeaderDraft {
  return {
    vendorName: "",
    receiptDate: "",
    totalGstDollars: "",
    totalAmountDollars: "",
  };
}

/** Parse AUD currency text to whole cents; empty → null. */
function parseAudToCents(value: string): number | null {
  const t = value.trim().replace(/\$/g, "").replace(/,/g, "");
  if (t === "") {
    return null;
  }
  const n = Number.parseFloat(t);
  if (!Number.isFinite(n) || n < 0) {
    return null;
  }
  return Math.round(n * 100);
}

function sumExtractedItemsCents(items: ExtractedReceiptItem[]): number {
  return items.reduce((sum, row) => {
    const sub = row.subtotalCents ?? Math.round(row.quantity * row.unitPriceCents);
    return sum + sub;
  }, 0);
}

let tempIdCounter = 0;

function makeTempId() {
  return `tmp-${++tempIdCounter}`;
}

function fromExtractionItems(
  items: ExtractedReceiptItem[],
  currentJobId: string,
): WorkbenchItem[] {
  return items.map((item) => ({
    tempId: makeTempId(),
    description: item.description,
    rawDescription: item.rawDescription || item.description,
    quantity: item.quantity ?? 1,
    unitPriceIncGst: item.unitPriceCents / 100,
    targetJobId: currentJobId,
    isManual: false,
  }));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

async function resolveReceiptImageForExtraction(
  receipt: JobFileRecord,
  sourceImageFile?: File | null,
): Promise<{ file: File | Blob; mimeTypeFallback?: string }> {
  if (sourceImageFile && sourceImageFile.size > 0) {
    return { file: sourceImageFile, mimeTypeFallback: receipt.mimeType };
  }

  const res = await fetch(receipt.downloadUrl, { mode: "cors" });
  if (!res.ok) {
    throw new Error(
      "Could not load the receipt image. Try uploading the receipt again, or open it from a fresh upload.",
    );
  }
  const blob = await res.blob();
  return { file: blob, mimeTypeFallback: receipt.mimeType };
}

export function ReceiptWorkbench({
  receipt,
  sourceImageFile = null,
  currentJobId,
  onClose,
  onSynced,
  autoStart = false,
  onExtractionComplete,
}: ReceiptWorkbenchProps) {
  const queryClient = useQueryClient();
  const [scanState, setScanState] = useState<"idle" | "scanning" | "done" | "error">("idle");
  const [headerDraft, setHeaderDraft] = useState<HeaderDraft>(emptyHeaderDraft);
  const [items, setItems] = useState<WorkbenchItem[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);

  const { data: activeJobs = [] } = useQuery({
    queryKey: ["active-jobs"],
    queryFn: getActiveJobs,
  });

  const syncMutation = useMutation({
    mutationFn: (input: SyncReceiptInput) => syncReceiptToJobs(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["line-items"] });
      await queryClient.invalidateQueries({ queryKey: ["job-files"] });
      toast.success("Items synced to jobs successfully");
      onSynced();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Sync failed");
    },
  });

  // ---------------------------------------------------------------------------
  // AI Extraction
  // ---------------------------------------------------------------------------

  const runExtraction = async () => {
    console.log("[ReceiptWorkbench] AI extraction started for receipt:", receipt.name, receipt.id);
    setScanState("scanning");
    setScanError(null);
    setHeaderDraft(emptyHeaderDraft());

    try {
      const { file, mimeTypeFallback } = await resolveReceiptImageForExtraction(receipt, sourceImageFile);
      const data = await extractReceiptClient({
        file,
        mimeTypeFallback,
      });

      console.log("[ReceiptWorkbench] AI extraction completed", data);
      const sumCents = sumExtractedItemsCents(data.items);
      const isoDate =
        data.receiptDate && /^\d{4}-\d{2}-\d{2}$/.test(data.receiptDate) ? data.receiptDate : "";
      setHeaderDraft({
        vendorName: (data.vendorName ?? "").trim(),
        receiptDate: isoDate,
        totalGstDollars:
          data.totalGstCents != null && Number.isFinite(data.totalGstCents)
            ? (data.totalGstCents / 100).toFixed(2)
            : "",
        totalAmountDollars: (sumCents / 100).toFixed(2),
      });
      setItems(fromExtractionItems(data.items, currentJobId));
      setScanState("done");
      onExtractionComplete?.();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not read receipt clearly. Please enter details manually.";
      console.error("[ReceiptWorkbench] AI extraction failed", err);
      setScanError(message);
      setScanState("error");
    }
  };

  useEffect(() => {
    if (autoStart && scanState === "idle") {
      runExtraction();
    }
  }, [autoStart, scanState]);

  // ---------------------------------------------------------------------------
  // Item Mutations
  // ---------------------------------------------------------------------------

  const updateItem = (tempId: string, patch: Partial<WorkbenchItem>) => {
    setItems((prev) =>
      prev.map((item) => (item.tempId === tempId ? { ...item, ...patch } : item)),
    );
  };

  const removeItem = (tempId: string) => {
    setItems((prev) => prev.filter((item) => item.tempId !== tempId));
  };

  const addManualItem = () => {
    setItems((prev) => [
      ...prev,
      {
        tempId: makeTempId(),
        description: "",
        rawDescription: "",
        quantity: 1,
        unitPriceIncGst: "",
        targetJobId: currentJobId,
        isManual: true,
      },
    ]);
  };

  // ---------------------------------------------------------------------------
  // Sync
  // ---------------------------------------------------------------------------

  const handleSync = () => {
    const lineSnapshots = items.map((item) => {
      const quantity = coerceNumberInputValue(item.quantity, 0);
      const unitPriceIncGst = coerceNumberInputValue(item.unitPriceIncGst, 0);
      const unitPriceCents = Math.round(unitPriceIncGst * 100);
      const subtotalCents = Math.round(quantity * unitPriceCents);
      return {
        description: item.description,
        rawDescription: item.rawDescription.trim() || item.description,
        quantity,
        unitPriceCents,
        subtotalCents,
      };
    });
    const lineSumCents = lineSnapshots.reduce((sum, row) => sum + row.subtotalCents, 0);

    let totalGstCents: number | null = null;
    if (headerDraft.totalGstDollars.trim() !== "") {
      const g = parseAudToCents(headerDraft.totalGstDollars);
      if (g === null) {
        toast.error("GST is not a valid amount. Use dollars, e.g. 12.50");
        return;
      }
      totalGstCents = g;
    }

    let totalAmountCents = lineSumCents;
    if (headerDraft.totalAmountDollars.trim() !== "") {
      const t = parseAudToCents(headerDraft.totalAmountDollars);
      if (t === null) {
        toast.error("Total is not a valid amount. Use dollars, e.g. 145.00");
        return;
      }
      totalAmountCents = t;
    }

    const syncItems: SyncReceiptItem[] = items.map((item) => ({
      description: item.description,
      rawDescription: item.rawDescription.trim() || undefined,
      quantity: coerceNumberInputValue(item.quantity, 0),
      unitPriceIncGst: coerceNumberInputValue(item.unitPriceIncGst, 0),
      targetJobId: item.targetJobId,
      receiptFileId: receipt.id,
    }));

    const payload: SyncReceiptInput = {
      items: syncItems,
      sourceReceiptFileId: receipt.id,
      receiptStashMeta: {
        vendorName: headerDraft.vendorName.trim() || null,
        receiptDate: headerDraft.receiptDate.trim() || null,
        totalGstCents,
        totalAmountCents,
        lineSnapshots,
      },
    };
    syncMutation.mutate(payload);
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-end justify-end bg-[#323338]/60 backdrop-blur-sm sm:items-stretch"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="relative z-[9999] flex h-full max-h-[100dvh] w-full flex-col overflow-hidden border-l border-[#E6E9EF] bg-white shadow-[0_8px_30px_rgb(0,0,0,0.12)] sm:max-h-[min(100dvh,900px)] sm:rounded-t-lg lg:ml-auto lg:max-w-6xl lg:rounded-l-lg lg:rounded-tr-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-[#E6E9EF] bg-[#F5F6F8] px-4 py-3">
          <div className="min-w-0 pr-2">
            <h2 className="truncate text-lg font-semibold text-[#323338]">Receipt Workbench</h2>
            <p className="truncate text-sm text-[#676879]">{receipt.name}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-[#676879] transition-colors duration-150 hover:bg-[#E6E9EF] hover:text-[#323338]"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-rows-[auto_1fr] overflow-hidden lg:grid-cols-[minmax(200px,260px)_1fr] lg:grid-rows-1">
          <div className="flex shrink-0 flex-col gap-3 border-b border-[#E6E9EF] bg-[#F0F4F8] p-4 lg:border-b-0 lg:border-r lg:border-[#E6E9EF]">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#676879]">Receipt</p>
            <div className="relative mx-auto aspect-[3/4] w-full max-w-[200px] overflow-hidden rounded-md border border-[#D0D4E4] bg-white p-1 shadow-sm sm:max-w-[220px] lg:max-w-none">
              <Image
                src={receipt.downloadUrl}
                alt={receipt.name}
                fill
                unoptimized
                sizes="(max-width: 1024px) 220px, 260px"
                className="rounded object-contain"
              />
            </div>

            {scanState === "idle" && (
              <Button
                className="h-9 w-full text-sm transition-all duration-300 ease-out active:scale-[0.97] hover:shadow-monday-1"
                onClick={runExtraction}
              >
                Process with AI
              </Button>
            )}

            {scanState === "error" && (
              <div className="rounded-lg border border-[#E2445C]/30 bg-[#FCECEE] p-3">
                <p className="text-xs font-semibold text-[#E2445C]">Extraction failed</p>
                <p className="mt-1 line-clamp-4 text-[11px] text-[#676879]">{scanError}</p>
                <Button
                  variant="secondary"
                  className="mt-2 h-8 w-full text-xs"
                  onClick={() => {
                    setScanState("idle");
                    setScanError(null);
                    addManualItem();
                  }}
                >
                  Enter manually
                </Button>
              </div>
            )}
          </div>

          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden border-l border-[#E6E9EF] bg-white">
            <ProcessingOverlay
              active={scanState === "scanning"}
              title="Analyzing receipt lines with AI..."
            />
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              {scanState !== "scanning" &&
              (scanState === "done" || scanState === "error" || items.length > 0) ? (
                <div className="mb-4 rounded-lg border border-[#E6E9EF] bg-white p-4">
                  <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[#676879]">
                    Receipt summary
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <label className={WORKBENCH_LABEL_CLASS}>Vendor</label>
                      <Input
                        value={headerDraft.vendorName}
                        onChange={(e) =>
                          setHeaderDraft((h) => ({ ...h, vendorName: e.target.value }))
                        }
                        placeholder="Supplier name"
                        className={WORKBENCH_INPUT_CLASS}
                      />
                    </div>
                    <div>
                      <label className={WORKBENCH_LABEL_CLASS}>Invoice date</label>
                      <Input
                        type="date"
                        value={headerDraft.receiptDate}
                        onChange={(e) =>
                          setHeaderDraft((h) => ({ ...h, receiptDate: e.target.value }))
                        }
                        className={WORKBENCH_INPUT_CLASS}
                      />
                    </div>
                    <div>
                      <label className={WORKBENCH_LABEL_CLASS}>Total (AUD inc GST)</label>
                      <Input
                        inputMode="decimal"
                        value={headerDraft.totalAmountDollars}
                        onChange={(e) =>
                          setHeaderDraft((h) => ({ ...h, totalAmountDollars: e.target.value }))
                        }
                        placeholder="e.g. 145.00"
                        className={`${WORKBENCH_INPUT_CLASS} tabular-nums`}
                      />
                      <p className="mt-1 text-[11px] text-[#676879]">
                        Leave blank to use the sum of line items below.
                      </p>
                    </div>
                    <div className="sm:col-span-2">
                      <label className={WORKBENCH_LABEL_CLASS}>Total GST (AUD)</label>
                      <Input
                        inputMode="decimal"
                        value={headerDraft.totalGstDollars}
                        onChange={(e) =>
                          setHeaderDraft((h) => ({ ...h, totalGstDollars: e.target.value }))
                        }
                        placeholder="e.g. 12.50"
                        className={`${WORKBENCH_INPUT_CLASS} tabular-nums`}
                      />
                    </div>
                  </div>
                </div>
              ) : null}

              {/* Scanning skeletons */}
              {scanState === "scanning" && (
                <div className="space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="h-14 w-full animate-pulse rounded-lg bg-[#F5F6F8]" />
                  ))}
                </div>
              )}

              {/* Items list */}
              {(scanState === "done" || scanState === "error" || items.length > 0) && (
                <div>
                  {items.map((item) => (
                    <WorkbenchItemRow
                      key={item.tempId}
                      item={item}
                      currentJobId={currentJobId}
                      activeJobs={activeJobs.map((j) => ({
                        id: j.id,
                        title: j.title,
                      }))}
                      onChange={(patch) => updateItem(item.tempId, patch)}
                      onRemove={() => removeItem(item.tempId)}
                    />
                  ))}
                </div>
              )}

              {/* Empty state after scan */}
              {scanState === "done" && items.length === 0 && (
                <p className="py-6 text-center text-sm text-[#676879]">
                  No line items detected. Add them manually below.
                </p>
              )}

              {/* Idle state */}
              {scanState === "idle" && items.length === 0 && (
                <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
                  <p className="max-w-sm text-sm text-[#676879]">
                    Use <strong>Process with AI</strong> on the receipt, or add items manually.
                  </p>
                  <Button variant="secondary" className="h-9 px-4 text-sm" onClick={addManualItem}>
                    + Add item
                  </Button>
                </div>
              )}
            </div>

            {/* Footer actions */}
            {(scanState === "done" || items.length > 0) && (
              <div className="flex shrink-0 items-center justify-between border-t border-[#E6E9EF] bg-white p-4">
                <button
                  type="button"
                  onClick={addManualItem}
                  className="rounded-md border border-[#C3C6D4] bg-white px-4 py-2 font-medium text-[#323338] transition-colors duration-150 hover:bg-[#F5F6F8]"
                >
                  + Add item
                </button>

                <button
                  type="button"
                  disabled={items.length === 0 || syncMutation.isPending}
                  onClick={handleSync}
                  className="rounded-md bg-[#0073EA] px-5 py-2 font-medium text-white shadow-sm transition-all duration-150 hover:bg-[#0060B9] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {syncMutation.isPending
                    ? "Syncing…"
                    : `Sync ${items.length} item${items.length === 1 ? "" : "s"}`}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Presentation tokens
// ---------------------------------------------------------------------------

const WORKBENCH_LABEL_CLASS =
  "mb-1 block text-[11px] font-semibold uppercase tracking-wider text-[#676879]";

const WORKBENCH_INPUT_CLASS =
  "h-8 border border-[#C3C6D4] bg-white text-sm text-[#323338] focus:border-[#0073EA] focus:ring-1 focus:ring-[#0073EA] focus:outline-none transition-all";

// ---------------------------------------------------------------------------
// WorkbenchItemRow
// ---------------------------------------------------------------------------

interface WorkbenchItemRowProps {
  item: WorkbenchItem;
  currentJobId: string;
  activeJobs: Array<{ id: string; title: string }>;
  onChange: (patch: Partial<WorkbenchItem>) => void;
  onRemove: () => void;
}

function WorkbenchItemRow({
  item,
  currentJobId,
  activeJobs,
  onChange,
  onRemove,
}: WorkbenchItemRowProps) {
  const jobOptions = useMemo(() => {
    const has = activeJobs.some((j) => j.id === currentJobId);
    if (!has) {
      return [{ id: currentJobId, title: "Current Job" }, ...activeJobs];
    }
    return activeJobs;
  }, [activeJobs, currentJobId]);

  return (
    <div className="mb-3 rounded-lg border border-[#E6E9EF] bg-white p-4 transition-all duration-200 hover:border-[#C3C6D4] hover:shadow-sm">
      <div className="flex gap-2">
        <div className="min-w-0 flex-1 space-y-2">
          {!item.isManual && item.rawDescription.trim() !== "" && (
            <p
              className="line-clamp-2 max-h-10 overflow-hidden font-mono text-xs uppercase leading-snug text-[#676879]"
              title={item.rawDescription}
            >
              {item.rawDescription}
            </p>
          )}

          <Input
            value={item.description}
            placeholder="Item title"
            onChange={(e) => onChange({ description: e.target.value })}
            className={WORKBENCH_INPUT_CLASS}
          />

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-[4.5rem_5.5rem_1fr] sm:items-end">
            <div>
              <label className={WORKBENCH_LABEL_CLASS}>Qty</label>
              <Input
                type="number"
                inputMode="decimal"
                value={formatNumberInputValue(item.quantity)}
                min={0}
                step="any"
                onChange={(e) => onChange({ quantity: parseNumberInputChange(e.target.value) })}
                className={WORKBENCH_INPUT_CLASS}
              />
            </div>
            <div>
              <label className={WORKBENCH_LABEL_CLASS}>$ inc GST</label>
              <Input
                type="number"
                inputMode="decimal"
                value={formatNumberInputValue(item.unitPriceIncGst)}
                min={0}
                step="0.01"
                onChange={(e) => onChange({ unitPriceIncGst: parseNumberInputChange(e.target.value) })}
                className={WORKBENCH_INPUT_CLASS}
              />
            </div>
            <div className="col-span-2 sm:col-span-1">
              <label className={WORKBENCH_LABEL_CLASS}>Job</label>
              <select
                value={item.targetJobId}
                onChange={(e) => onChange({ targetJobId: e.target.value })}
                className="h-8 w-full cursor-pointer rounded-md border border-[#C3C6D4] bg-white px-2 text-xs text-[#323338] transition-all focus:border-[#0073EA] focus:ring-1 focus:ring-[#0073EA] focus:outline-none"
              >
                {jobOptions.map((job) => (
                  <option key={job.id} value={job.id}>
                    {job.id === currentJobId && job.title !== "Current Job"
                      ? `${job.title} (current)`
                      : job.title}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onRemove}
          className="mt-5 flex shrink-0 items-center justify-center self-start rounded-md p-1.5 text-[#C3C6D4] transition-colors duration-150 hover:bg-[#FCECEE] hover:text-[#E2445C] sm:mt-6"
          aria-label="Remove item"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
