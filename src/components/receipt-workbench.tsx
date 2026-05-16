"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { toast } from "sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getActiveJobs,
  syncReceiptToJobs,
  type SyncReceiptItem,
} from "@/lib/firebase/repository";
import { JobFileRecord } from "@/types/database";
import {
  extractReceiptClient,
  type ExtractedReceiptItem,
} from "@/lib/ai/extract-receipt-client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WorkbenchItem {
  tempId: string;
  description: string;
  quantity: number;
  unitPriceIncGst: number;
  targetJobId: string;
  excluded: boolean;
  isManual: boolean;
}

interface ReceiptWorkbenchProps {
  receipt: JobFileRecord;
  currentJobId: string;
  onClose: () => void;
  onSynced: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toDollars(cents: number) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
  }).format(cents / 100);
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
    quantity: item.quantity ?? 1,
    unitPriceIncGst: item.unitPriceCents / 100,
    targetJobId: currentJobId,
    excluded: false,
    isManual: false,
  }));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ReceiptWorkbench({
  receipt,
  currentJobId,
  onClose,
  onSynced,
}: ReceiptWorkbenchProps) {
  const queryClient = useQueryClient();
  const [scanState, setScanState] = useState<"idle" | "scanning" | "done" | "error">("idle");
  const [extractedMeta, setExtractedMeta] = useState<{
    vendorName: string | null;
    date: string | null;
    totalGst: number | null;
  } | null>(null);
  const [items, setItems] = useState<WorkbenchItem[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);

  const { data: activeJobs = [] } = useQuery({
    queryKey: ["active-jobs"],
    queryFn: getActiveJobs,
  });

  const syncMutation = useMutation({
    mutationFn: (syncItems: SyncReceiptItem[]) =>
      syncReceiptToJobs({
        items: syncItems,
        sourceReceiptFileId: receipt.id,
      }),
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
    setScanState("scanning");
    setScanError(null);

    try {
      const data = await extractReceiptClient({
        imageUrl: receipt.downloadUrl,
        mimeType: receipt.mimeType,
      });

      setExtractedMeta({
        vendorName: null,
        date: null,
        totalGst: null,
      });
      setItems(fromExtractionItems(data.items, currentJobId));
      setScanState("done");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not read receipt clearly. Please enter details manually.";
      setScanError(message);
      setScanState("error");
    }
  };

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
        quantity: 1,
        unitPriceIncGst: 0,
        targetJobId: currentJobId,
        excluded: false,
        isManual: true,
      },
    ]);
  };

  // ---------------------------------------------------------------------------
  // Sync
  // ---------------------------------------------------------------------------

  const includedItems = useMemo(() => items.filter((item) => !item.excluded), [items]);

  const handleSync = () => {
    const syncItems: SyncReceiptItem[] = items.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unitPriceIncGst: item.unitPriceIncGst,
      targetJobId: item.targetJobId,
      receiptFileId: receipt.id,
      excluded: item.excluded,
    }));
    syncMutation.mutate(syncItems);
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-end justify-end bg-black/60 sm:items-stretch"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Drawer panel */}
      <div className="flex h-full w-full flex-col overflow-hidden bg-zinc-900 sm:w-[92vw] lg:w-[80vw] xl:w-[70vw]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-700 px-5 py-4">
          <div>
            <h2 className="text-xl font-bold">Receipt Workbench</h2>
            <p className="text-sm text-zinc-400">{receipt.name}</p>
          </div>
          <button
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Body — two-column layout */}
        <div className="flex flex-1 flex-col overflow-hidden lg:flex-row">
          {/* Left — receipt image */}
          <div className="flex flex-col border-b border-zinc-700 bg-zinc-950 p-4 lg:w-[42%] lg:border-b-0 lg:border-r lg:overflow-y-auto">
            <p className="mb-3 text-sm font-medium uppercase tracking-widest text-zinc-400">
              Receipt Image
            </p>
            <div className="relative flex-1 overflow-hidden rounded-xl border border-zinc-700">
              <Image
                src={receipt.downloadUrl}
                alt={receipt.name}
                fill
                unoptimized
                className="object-contain"
              />
            </div>

            {scanState === "idle" && (
              <Button className="mt-4 h-12 w-full text-base" onClick={runExtraction}>
                Process with AI
              </Button>
            )}

            {scanState === "scanning" && (
              <div className="mt-4 space-y-2">
                <div className="h-10 w-full animate-pulse rounded-lg bg-zinc-700" />
                <div className="h-6 w-3/4 animate-pulse rounded-lg bg-zinc-800" />
                <p className="text-center text-sm text-zinc-400">Scanning receipt…</p>
              </div>
            )}

            {scanState === "error" && (
              <div className="mt-4 rounded-xl border border-red-700 bg-red-950/50 p-4">
                <p className="text-sm font-semibold text-red-300">Extraction Failed</p>
                <p className="mt-1 text-sm text-red-400">{scanError}</p>
                <Button
                  variant="secondary"
                  className="mt-3 h-10 w-full"
                  onClick={() => {
                    setScanState("idle");
                    setScanError(null);
                    addManualItem();
                  }}
                >
                  Enter Details Manually
                </Button>
              </div>
            )}
          </div>

          {/* Right — extracted data */}
          <div className="flex flex-1 flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {/* Meta summary */}
              {extractedMeta && (
                <div className="mb-4 grid grid-cols-3 gap-3 rounded-xl border border-zinc-700 bg-zinc-950 p-3 text-sm">
                  <div>
                    <p className="text-zinc-400">Vendor</p>
                    <p className="font-semibold text-zinc-100">
                      {extractedMeta.vendorName ?? "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-zinc-400">Date</p>
                    <p className="font-semibold text-zinc-100">{extractedMeta.date ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-zinc-400">Total GST</p>
                    <p className="font-semibold text-zinc-100">
                      {extractedMeta.totalGst != null
                        ? toDollars(Math.round(extractedMeta.totalGst * 100))
                        : "—"}
                    </p>
                  </div>
                </div>
              )}

              {/* Scanning skeletons */}
              {scanState === "scanning" && (
                <div className="space-y-3">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div
                      key={i}
                      className="h-20 w-full animate-pulse rounded-xl bg-zinc-800"
                    />
                  ))}
                </div>
              )}

              {/* Items list */}
              {(scanState === "done" || scanState === "error" || items.length > 0) && (
                <div className="space-y-3">
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
                <p className="py-8 text-center text-zinc-400">
                  No line items detected. Add them manually below.
                </p>
              )}

              {/* Idle state */}
              {scanState === "idle" && items.length === 0 && (
                <div className="flex h-full flex-col items-center justify-center gap-4 py-16 text-center">
                  <p className="text-zinc-400">
                    Click <strong>&quot;Process with AI&quot;</strong> to extract line items automatically,
                    or add items manually.
                  </p>
                  <Button variant="secondary" className="h-11 px-5" onClick={addManualItem}>
                    + Add Item Manually
                  </Button>
                </div>
              )}
            </div>

            {/* Footer actions */}
            {(scanState === "done" || items.length > 0) && (
              <div className="border-t border-zinc-700 bg-zinc-900 px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Button
                    variant="secondary"
                    className="h-11 px-5"
                    onClick={addManualItem}
                  >
                    + Add Item Manually
                  </Button>

                  <Button
                    className="h-12 px-6 text-base"
                    disabled={includedItems.length === 0 || syncMutation.isPending}
                    onClick={handleSync}
                  >
                    {syncMutation.isPending
                      ? "Syncing…"
                      : `Sync ${includedItems.length} Item${includedItems.length === 1 ? "" : "s"} to Jobs`}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

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
    <div
      className={`rounded-xl border p-4 transition ${
        item.excluded
          ? "border-zinc-800 bg-zinc-950/50 opacity-50"
          : "border-zinc-700 bg-zinc-800/50"
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Exclude checkbox */}
        <div className="mt-1 flex-shrink-0">
          <input
            type="checkbox"
            id={`exclude-${item.tempId}`}
            checked={item.excluded}
            onChange={(e) => onChange({ excluded: e.target.checked })}
            className="h-5 w-5 cursor-pointer rounded accent-zinc-400"
            title="Exclude from invoice"
          />
        </div>

        <div className="flex-1 space-y-3">
          {/* Description */}
          <Input
            value={item.description}
            placeholder="Item description"
            onChange={(e) => onChange({ description: e.target.value })}
            disabled={item.excluded}
            className="h-11 text-base"
          />

          <div className="grid grid-cols-2 gap-3">
            {/* Quantity */}
            <div>
              <label className="mb-1 block text-xs text-zinc-400">Qty</label>
              <Input
                type="number"
                inputMode="decimal"
                value={item.quantity}
                min={0}
                step="any"
                onChange={(e) => onChange({ quantity: Number(e.target.value || 1) })}
                disabled={item.excluded}
                className="h-12 text-base"
              />
            </div>

            {/* Unit price */}
            <div>
              <label className="mb-1 block text-xs text-zinc-400">Unit Price (inc. GST) $</label>
              <Input
                type="number"
                inputMode="decimal"
                value={item.unitPriceIncGst}
                min={0}
                step="0.01"
                onChange={(e) => onChange({ unitPriceIncGst: Number(e.target.value || 0) })}
                disabled={item.excluded}
                className="h-12 text-base"
              />
            </div>
          </div>

          {/* Job selector — large touch targets */}
          <div>
            <label className="mb-1 block text-xs text-zinc-400">Attribute to Job</label>
            <select
              value={item.targetJobId}
              onChange={(e) => onChange({ targetJobId: e.target.value })}
              disabled={item.excluded}
              className="h-12 w-full cursor-pointer rounded-lg border border-zinc-600 bg-zinc-900 px-3 text-base text-zinc-100 focus:border-zinc-400 focus:outline-none disabled:opacity-50"
            >
              {jobOptions.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.id === currentJobId && job.title !== "Current Job"
                    ? `${job.title} (Current)`
                    : job.title}
                </option>
              ))}
            </select>
          </div>

          {/* Exclude label */}
          <label
            htmlFor={`exclude-${item.tempId}`}
            className="flex cursor-pointer items-center gap-2 text-sm text-zinc-400"
          >
            <span className={item.excluded ? "line-through" : ""}>
              {item.excluded ? "Excluded from invoice" : "Exclude from invoice"}
            </span>
          </label>
        </div>

        {/* Remove button */}
        <button
          onClick={onRemove}
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-700 hover:text-zinc-200"
          aria-label="Remove item"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
