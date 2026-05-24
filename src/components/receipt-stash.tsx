"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { Download, Loader2, Search, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { subscribeJobReceiptStash } from "@/lib/firebase/repository";
import type { JobFileRecord, LineItem, ReceiptStashLineSnapshot } from "@/types/database";
import { Button } from "@/components/ui/button";

type SortMode = "recent" | "oldest" | "expensive" | "cheapest" | "vendor_az";

type StashRow = {
  file: JobFileRecord;
  isPending: boolean;
};

function formatAuDate(d: Date) {
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(d);
}

function vendorDownloadFilename(vendorName: string, mimeType: string) {
  const safe =
    vendorName
      .trim()
      .replace(/[^a-z0-9-_]+/gi, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "receipt";
  const ext = mimeType.includes("png")
    ? "png"
    : mimeType.includes("webp")
      ? "webp"
      : mimeType.includes("pdf")
        ? "pdf"
        : "jpg";
  return `receipt-${safe}.${ext}`;
}

async function downloadReceiptImage(imageUrl: string, vendorName: string, mimeType: string) {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error("Download failed");
  }
  const blob = await response.blob();
  const objectUrl = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = vendorDownloadFilename(vendorName, mimeType);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(objectUrl);
}

function formatMoneyCents(cents: number | null | undefined) {
  if (cents == null || !Number.isFinite(cents)) {
    return "—";
  }
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
  }).format(cents / 100);
}

function norm(s: string) {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function amountSortKey(cents: number | null | undefined): number {
  if (cents == null || !Number.isFinite(cents)) {
    return Number.NaN;
  }
  return cents;
}

function vendorSortKey(file: JobFileRecord): string {
  return (file.vendorName?.trim() || file.name || "").toLowerCase();
}

function isStashLineOnLedger(
  receiptId: string,
  row: ReceiptStashLineSnapshot,
  ledgerMaterials: LineItem[],
): boolean {
  const rd = norm(row.description);
  const rr = norm(row.rawDescription);
  return ledgerMaterials.some((L) => {
    if (L.kind !== "material" || L.deletedAt) {
      return false;
    }
    const rid = L.receiptFileId ?? L.receiptImageStoragePath;
    if (rid !== receiptId) {
      return false;
    }
    const ld = norm(L.description);
    const lr = norm(L.rawReceiptDescription ?? "");
    if (rd && ld === rd) {
      return true;
    }
    if (rr && lr && lr === rr) {
      return true;
    }
    if (rr && ld === rr) {
      return true;
    }
    if (lr && ld === lr) {
      return true;
    }
    return false;
  });
}

function stashSearchHaystack(file: JobFileRecord): string {
  const vendor = file.vendorName ?? "";
  const lines = (file.stashLineItems ?? [])
    .map((l) => `${l.description} ${l.rawDescription}`)
    .join(" ");
  return `${vendor} ${file.name} ${lines}`.toLowerCase();
}

function rowHaystack(entry: StashRow): string {
  if (entry.isPending) {
    return `${entry.file.name}`.toLowerCase();
  }
  return stashSearchHaystack(entry.file);
}

const LIGHTBOX_ZOOM = 2.5;

type ReceiptPreviewLightboxProps = {
  file: JobFileRecord;
  onClose: () => void;
};

function ReceiptPreviewLightbox({ file, onClose }: ReceiptPreviewLightboxProps) {
  const url = file.downloadUrl;
  const title = file.vendorName?.trim() || file.name;
  const [hoverZoom, setHoverZoom] = useState(false);
  const [posPct, setPosPct] = useState({ x: 50, y: 50 });

  const updatePan = useCallback((clientX: number, clientY: number, rect: DOMRect) => {
    const x = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    const y = Math.max(0, Math.min(100, ((clientY - rect.top) / rect.height) * 100));
    setPosPct({ x, y });
  }, []);

  const onPaneMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    updatePan(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-[10000] h-screen w-screen" role="presentation">
      <div
        className="absolute inset-0 bg-white backdrop-blur-md"
        aria-hidden
        onClick={onClose}
      />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6 md:p-8">
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Receipt preview"
          className="pointer-events-auto relative mx-auto w-fit max-h-[calc(100vh-4rem)] max-w-[min(28rem,calc(100vw-3rem))] overflow-y-auto rounded-lg border border-[#E6E9EF] bg-white px-3 pb-3 pt-3 shadow-monday-2 md:px-4 md:pb-4"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="absolute top-3 right-3 z-50 flex size-8 items-center justify-center rounded-full border border-[#D0D4E4] bg-[#F5F6F8] text-sm text-[#323338] shadow-monday-1 transition hover:bg-[#E6E9EF] md:top-4 md:right-4"
            onClick={onClose}
            aria-label="Close preview"
          >
            ✕
          </button>

          <p className="mb-2 truncate pr-10 pt-0.5 text-center text-sm font-medium text-[#323338]">{title}</p>

          <div className="w-fit max-w-full overflow-hidden rounded-lg border border-[#E6E9EF]/80 bg-[#323338]/30 p-1">
            <div
              className="relative inline-block max-h-[min(75vh,calc(100vh-10rem))] max-w-full select-none"
              onMouseEnter={() => setHoverZoom(true)}
              onMouseLeave={() => {
                setHoverZoom(false);
                setPosPct({ x: 50, y: 50 });
              }}
              onMouseMove={onPaneMouseMove}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- remote receipt URL + CSS pan zoom */}
              <img
                src={url}
                alt={file.name}
                className="mx-auto block max-h-[min(75vh,calc(100vh-10rem))] w-auto max-w-full rounded-lg object-contain shadow-monday-2 transition-opacity duration-300 ease-out"
                style={{ opacity: hoverZoom ? 0 : 1 }}
                draggable={false}
              />
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 rounded-lg bg-no-repeat shadow-monday-2 will-change-[background-position] [transition:background-position_90ms_linear,opacity_300ms_ease-out]"
                style={{
                  opacity: hoverZoom ? 1 : 0,
                  backgroundImage: `url(${JSON.stringify(url)})`,
                  backgroundSize: `${LIGHTBOX_ZOOM * 100}% ${LIGHTBOX_ZOOM * 100}%`,
                  backgroundPosition: `${posPct.x}% ${posPct.y}%`,
                }}
              />
            </div>
          </div>

          <p className="mt-2 text-center text-[11px] text-[#676879]">
            Hover to magnify · move pointer to pan · Esc or backdrop to close
          </p>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export interface ReceiptStashProps {
  jobId: string;
  /** Material (and other) line items for the current job — used to highlight synced rows. */
  ledgerLineItems: LineItem[];
  /** Uploaded receipt files not yet processed — shown in the unified feed with a scan action. */
  pendingReceiptFiles?: JobFileRecord[];
  onUploadReceipt?: (file: File) => void;
  onRequestPickFile?: () => void;
  onOpenReceiptWorkbench?: (file: JobFileRecord) => void;
}

export function ReceiptStash({
  jobId,
  ledgerLineItems,
  pendingReceiptFiles = [],
  onUploadReceipt,
  onRequestPickFile,
  onOpenReceiptWorkbench,
}: ReceiptStashProps) {
  const [stash, setStash] = useState<JobFileRecord[]>([]);
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("recent");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<JobFileRecord | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!jobId) {
      setStash([]);
      return;
    }
    return subscribeJobReceiptStash(jobId, setStash);
  }, [jobId]);

  const materials = useMemo(
    () => ledgerLineItems.filter((i) => i.kind === "material" && !i.deletedAt),
    [ledgerLineItems],
  );

  const mergedRows = useMemo((): StashRow[] => {
    const pending = pendingReceiptFiles.map((file) => ({ file, isPending: true as const }));
    const done = stash.map((file) => ({ file, isPending: false as const }));
    return [...pending, ...done];
  }, [stash, pendingReceiptFiles]);

  const filteredSorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = mergedRows;
    if (q) {
      rows = rows.filter((entry) => rowHaystack(entry).includes(q));
    }
    const out = [...rows];
    out.sort((a, b) => {
      const fa = a.file;
      const fb = b.file;
      if (sortMode === "recent" || sortMode === "oldest") {
        const mult = sortMode === "recent" ? -1 : 1;
        return mult * (fa.createdAt.getTime() - fb.createdAt.getTime());
      }
      if (sortMode === "expensive" || sortMode === "cheapest") {
        const ka = amountSortKey(fa.totalAmountCents ?? null);
        const kb = amountSortKey(fb.totalAmountCents ?? null);
        const aMissing = Number.isNaN(ka);
        const bMissing = Number.isNaN(kb);
        if (aMissing && bMissing) {
          return 0;
        }
        if (aMissing) {
          return 1;
        }
        if (bMissing) {
          return -1;
        }
        return sortMode === "expensive" ? kb - ka : ka - kb;
      }
      return vendorSortKey(fa).localeCompare(vendorSortKey(fb), "en-AU");
    });
    return out;
  }, [mergedRows, search, sortMode]);

  const selected = selectedId ? stash.find((f) => f.id === selectedId) : null;

  const handleDownload = useCallback(
    async (e: React.MouseEvent, file: JobFileRecord) => {
      e.stopPropagation();
      e.preventDefault();
      if (!file.downloadUrl || downloadingId) {
        return;
      }

      setDownloadingId(file.id);
      try {
        const label = file.vendorName?.trim() || file.name.replace(/\.[^.]+$/, "") || "receipt";
        await downloadReceiptImage(file.downloadUrl, label, file.mimeType);
      } catch {
        toast.error("Could not download receipt");
      } finally {
        setDownloadingId(null);
      }
    },
    [downloadingId],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file && onUploadReceipt) {
        onUploadReceipt(file);
      }
    },
    [onUploadReceipt],
  );

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) {
      return;
    }
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    const next = e.relatedTarget as Node | null;
    if (next && rootRef.current?.contains(next)) {
      return;
    }
    setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("Files")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  }, []);

  useEffect(() => {
    if (!isDragging) {
      return;
    }
    const onDragEnd = () => setIsDragging(false);
    window.addEventListener("dragend", onDragEnd);
    return () => window.removeEventListener("dragend", onDragEnd);
  }, [isDragging]);

  return (
    <div
      ref={rootRef}
      className="relative flex w-full min-w-0 flex-col"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {isDragging ? (
        <div
          className="animate-fade-in absolute inset-0 z-50 flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-[#0073EA]/500/40 bg-white/70 backdrop-blur-md"
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (e.dataTransfer.types.includes("Files")) {
              e.dataTransfer.dropEffect = "copy";
            }
          }}
          onDrop={handleDrop}
        >
          <UploadCloud className="mb-3 size-10 animate-bounce text-[#0073EA]" aria-hidden />
          <p className="max-w-xs px-4 text-center text-sm font-medium text-[#323338]">
            Drop receipt anywhere to instantly extract with AI
          </p>
        </div>
      ) : null}

      <div className="flex flex-col gap-4 border-b border-[#E6E9EF] pb-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex w-full items-center gap-2 rounded-lg border border-[#E6E9EF]/40 bg-[#F5F6F8] px-3 py-2 transition-all focus-within:border-[#0073EA]/50 sm:w-72">
          <Search className="size-4 shrink-0 text-[#676879]" aria-hidden />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search vendor or item…"
            className="min-w-0 flex-1 bg-transparent text-sm text-[#323338] outline-none placeholder:text-[#676879]"
            aria-label="Search receipts"
          />
        </div>

        <div className="flex w-full flex-wrap items-center justify-end gap-3 sm:w-auto">
          <label htmlFor="stash-sort" className="sr-only">
            Sort receipts
          </label>
          <select
            id="stash-sort"
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as SortMode)}
            className="h-10 min-w-[10.5rem] rounded-lg border border-[#E6E9EF]/50 bg-white px-3 text-xs font-medium text-[#323338] transition-all duration-150 ease-out hover:border-[#D0D4E4]/80"
          >
            <option value="recent">Most recent</option>
            <option value="oldest">Least recent</option>
            <option value="expensive">Most expensive</option>
            <option value="cheapest">Least expensive</option>
            <option value="vendor_az">Vendor (A–Z)</option>
          </select>

          <Button
            type="button"
            className="h-10 bg-[#0073EA] px-4 font-semibold text-white shadow-none transition-all duration-150 ease-out hover:bg-[#0060B9]"
            onClick={() => onRequestPickFile?.()}
          >
            + Scan New Receipt
          </Button>
        </div>
      </div>

      <div className="mt-6 space-y-2.5">
        {filteredSorted.length === 0 ? (
          <p className="py-8 text-center text-sm text-[#676879]">
            {mergedRows.length === 0
              ? "Drop a receipt image here or tap Scan New Receipt to upload — then process with AI from the workbench."
              : "No matches."}
          </p>
        ) : (
          filteredSorted.map(({ file, isPending }) => (
            <div
              key={file.id}
              className="group flex cursor-pointer items-center justify-between rounded-lg border border-[#E6E9EF] bg-white p-3.5 transition-all duration-300 ease-out hover:-translate-y-px hover:border-[#E6E9EF]/80 hover:bg-white"
              role="button"
              tabIndex={0}
              onClick={() => {
                if (isPending) {
                  onOpenReceiptWorkbench?.(file);
                } else {
                  setSelectedId(file.id);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  if (isPending) {
                    onOpenReceiptWorkbench?.(file);
                  } else {
                    setSelectedId(file.id);
                  }
                }
              }}
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <button
                  type="button"
                  aria-label={`Quick preview: ${file.vendorName?.trim() || file.name}`}
                  className="group/thumb relative size-11 shrink-0 overflow-hidden rounded-lg border border-[#E6E9EF]/50 bg-[#F5F6F8] transition-all duration-150 ease-out hover:border-[#0073EA]/500/40"
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    if (file.mimeType.startsWith("image/")) {
                      setPreviewFile(file);
                    }
                  }}
                >
                  {file.mimeType.startsWith("image/") ? (
                    <>
                      <Image
                        src={file.downloadUrl}
                        alt=""
                        fill
                        unoptimized
                        className="object-cover transition-transform duration-150 ease-out group-hover/thumb:scale-105"
                        sizes="44px"
                      />
                      <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-[#F5F6F8] opacity-0 transition-opacity duration-150 group-hover/thumb:opacity-100">
                        <Search className="size-4 text-white drop-shadow-md" strokeWidth={2.25} aria-hidden />
                      </div>
                    </>
                  ) : (
                    <div className="flex size-full items-center justify-center text-[10px] text-zinc-600">—</div>
                  )}
                </button>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-[#323338] transition-colors duration-150 ease-out group-hover:text-[#0073EA]">
                    {isPending ? file.name : file.vendorName?.trim() || "Receipt"}
                  </p>
                  <p className="mt-0.5 font-mono text-xs tracking-normal text-[#676879]">
                    {isPending ? "Awaiting AI extraction" : formatAuDate(file.createdAt)}
                  </p>
                  {isPending ? (
                    <p className="mt-0.5 text-[11px] text-[#0073EA]">Tap row to open workbench</p>
                  ) : null}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-3 pl-2">
                <span className="inline-block rounded-lg border border-[#0073EA]/500/[0.08] bg-[#0073EA]/[0.03] px-2.5 py-1 font-mono text-sm font-semibold text-[#0073EA] tabular-nums transition-all duration-150 ease-out">
                  {isPending ? "—" : formatMoneyCents(file.totalAmountCents ?? null)}
                </span>
                {file.mimeType.startsWith("image/") ? (
                  <button
                    type="button"
                    title="Download receipt"
                    aria-label="Download receipt"
                    disabled={downloadingId === file.id}
                    className="rounded-md p-2 text-[#676879] transition-colors duration-150 hover:bg-[#F5F6F8] hover:text-[#0073EA] disabled:opacity-50"
                    onClick={(e) => void handleDownload(e, file)}
                  >
                    {downloadingId === file.id ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : (
                      <Download className="size-4" aria-hidden />
                    )}
                  </button>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>

      {previewFile && previewFile.mimeType.startsWith("image/") ? (
        <ReceiptPreviewLightbox file={previewFile} onClose={() => setPreviewFile(null)} />
      ) : null}

      {selected ? (
        <div
          className="fixed inset-0 z-[60] flex justify-end bg-[#323338]/30 p-3 backdrop-blur-[1px] sm:p-6"
          role="presentation"
          onClick={() => setSelectedId(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="receipt-details-title"
            className="flex h-full max-h-[min(92dvh,720px)] w-full max-w-md flex-col overflow-hidden rounded-lg border border-[#E6E9EF] bg-white shadow-[0_8px_30px_rgb(0,0,0,0.12)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-[#E6E9EF] px-5 py-4">
              <div className="min-w-0 pr-3">
                <p id="receipt-details-title" className="truncate text-xl font-bold text-[#323338]">
                  {selected.vendorName?.trim() || "Receipt"}
                </p>
                <p className="mt-1 text-sm text-[#676879]">
                  {selected.receiptDate ? `Invoice ${selected.receiptDate}` : null}
                  {selected.receiptDate ? " · " : null}
                  Added {formatAuDate(selected.createdAt)}
                </p>
              </div>
              <button
                type="button"
                className="shrink-0 rounded-md p-2 text-[#676879] transition-colors duration-150 hover:bg-[#F5F6F8] hover:text-[#323338]"
                onClick={() => setSelectedId(null)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4 border-b border-[#E6E9EF] px-5 pb-4 pt-4">
              <div>
                <p className="text-sm text-[#676879]">Total (synced)</p>
                <p className="text-lg font-bold text-[#323338]">
                  {formatMoneyCents(selected.totalAmountCents ?? null)}
                </p>
              </div>
              <div>
                <p className="text-sm text-[#676879]">GST</p>
                <p className="text-lg font-bold text-[#323338]">
                  {formatMoneyCents(selected.totalGstCents ?? null)}
                </p>
              </div>
            </div>

            <div className="min-h-0 max-h-[50vh] flex-1 overflow-y-auto px-2">
              <p className="px-3 pb-2 pt-4 text-xs font-semibold uppercase tracking-wider text-[#676879]">
                Line items
              </p>
              <ul>
                {(selected.stashLineItems ?? []).map((row, idx) => {
                  const synced = isStashLineOnLedger(selected.id, row, materials);
                  return (
                    <li
                      key={`${selected.id}-${idx}`}
                      className="border-b border-[#E6E9EF] bg-white px-2 py-4 transition-colors duration-150 hover:bg-[#F5F6F8]"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="text-sm font-semibold text-[#323338]">{row.description}</p>
                        {synced ? (
                          <span className="shrink-0 rounded-full bg-[#00C875] px-2.5 py-0.5 text-[11px] font-bold tracking-wide text-white">
                            Synced to Job
                          </span>
                        ) : null}
                      </div>
                      {row.rawDescription.trim() !== "" && row.rawDescription !== row.description ? (
                        <p className="mt-1 font-mono text-xs uppercase leading-snug text-[#676879]">
                          {row.rawDescription}
                        </p>
                      ) : null}
                      <p className="mt-1 text-sm text-[#323338]">
                        {row.quantity} × {formatMoneyCents(row.unitPriceCents)} ·{" "}
                        {formatMoneyCents(row.subtotalCents)}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="shrink-0 rounded-b-lg border-t border-[#E6E9EF] bg-[#F5F6F8] p-4">
              <button
                type="button"
                aria-label="Open receipt image preview"
                className="mx-auto flex cursor-pointer justify-center"
                onClick={() => {
                  if (selected.mimeType.startsWith("image/")) {
                    setPreviewFile(selected);
                  }
                }}
              >
                <div className="relative aspect-[3/4] w-32 overflow-hidden rounded-md border border-[#D0D4E4] bg-white p-1 shadow-sm transition-shadow duration-150 hover:shadow-md">
                  {selected.mimeType.startsWith("image/") ? (
                    <Image
                      src={selected.downloadUrl}
                      alt={selected.name}
                      fill
                      unoptimized
                      className="rounded object-contain"
                      sizes="128px"
                    />
                  ) : (
                    <div className="flex size-full items-center justify-center text-xs text-[#676879]">
                      No preview
                    </div>
                  )}
                </div>
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
