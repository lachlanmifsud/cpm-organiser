"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Popover } from "@base-ui/react/popover";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  FileEdit,
  FileText,
  Hash,
  MapPin,
  Package,
  Pencil,
  PenLine,
  Plus,
  Receipt,
  Search,
  Trash2,
  Wrench,
} from "lucide-react";
import { PreFlightWarningModal } from "@/components/pre-flight-warning-modal";
import { WorkbenchCheckbox } from "@/components/workbench-checkbox";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DocumentGenerationWizard } from "@/components/document-generation-wizard";
import { DocumentRefinementStudio } from "@/components/document-refinement-studio";
import { JobFilesExplorer } from "@/components/job-files-explorer";
import { MaterialMarkupStepper } from "@/components/material-markup-stepper";
import { getInvoiceLinkedHistory } from "@/lib/line-item-invoicing";
import { getQuoteLinkedHistory } from "@/lib/line-item-quoting";
import { lineItemHistoryBadgeClasses } from "@/lib/monday-theme";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ReceiptWorkbench } from "@/components/receipt-workbench";
import { useAuth } from "@/providers/auth-provider";
import {
  addLineItem,
  commitJobDocumentVersion,
  deleteJobDocument,
  deleteLineItem,
  getClientById,
  getJob,
  getJobDocuments,
  getJobFiles,
  getLineItemsByJobId,
  getUserSettings,
  restoreLineItem,
  saveJobDocument,
  saveReceiptImage,
  saveSitePhoto,
  subscribeLineItemsByJobId,
  updateJobMaterialMarkup,
  updateJobSettings,
  updateJobStatus,
  updateLineItem,
} from "@/lib/firebase/repository";
import {
  computeMaterialMarkupCents,
  computeDocumentTotals,
  computeRemainingToBillTotalCents,
  getJobMaterialMarkupPercent,
  sumMaterialSubtotalCents,
} from "@/lib/material-markup";
import {
  isDocumentDeleteLocked,
  isDocumentEditLocked,
  reconstructPayloadFromDocument,
  resolveActiveDocumentPayload,
  resolveDocumentVersions,
  type DocumentVersion,
} from "@/lib/document-versions";
import type { DocumentRefinementPayload } from "@/lib/document-refinement-payload";
import { Job, JobDocumentRecord, JobWorkflowStatus, LineItem } from "@/types/database";
import {
  coerceNumberInputValue,
  formatNumberInputValue,
  handleControlledNumberInputChange,
  type NumberInputValue,
} from "@/lib/number-input";

function formatCurrency(valueCents: number) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
  }).format(valueCents / 100);
}

type WorkbenchSortKey = "item" | "kind" | "status" | "qty" | "rate" | "total";
type WorkbenchSortDir = "asc" | "desc";

function lineItemStatusBadgeClass(status: string) {
  switch (status) {
    case "unbilled":
      return "inline-block rounded-md border border-[#D0D4E4]/30 bg-[#F5F6F8] px-2 py-0.5 text-xs font-medium capitalize text-[#676879]";
    case "quoted":
      return "inline-block rounded-md border border-cyan-700/35 bg-cyan-950/60 px-2 py-0.5 text-xs font-medium capitalize text-cyan-100";
    case "invoiced":
      return "inline-block rounded-md border border-violet-700/35 bg-violet-950/60 px-2 py-0.5 text-xs font-medium capitalize text-violet-100";
    default:
      return "inline-block rounded-md border border-[#D0D4E4]/30 bg-[#F5F6F8] px-2 py-0.5 text-xs font-medium capitalize text-[#676879]";
  }
}

function WorkbenchSortGlyph({ active, dir }: { active: boolean; dir: WorkbenchSortDir }) {
  if (!active) {
    return (
      <ArrowUpDown
        className="size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-40"
        aria-hidden
      />
    );
  }
  return dir === "asc" ? (
    <ArrowUp className="size-3.5 shrink-0 text-[#0073EA]" aria-hidden />
  ) : (
    <ArrowDown className="size-3.5 shrink-0 text-[#0073EA]" aria-hidden />
  );
}

function resolveJobIdFromPathname(pathname: string) {
  const segment = pathname.split("/").filter(Boolean).pop() ?? "";
  return decodeURIComponent(segment).trim();
}

function isLikelyFirebaseDocId(value: string) {
  return /^[A-Za-z0-9_-]{16,}$/.test(value);
}

function formatDateInput(value?: Date) {
  if (!value) {
    return "";
  }

  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatLinkedInvoiceDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(d);
}

function isJobInvoiceOverdue(job: Job) {
  return job.status === "invoiced" && Boolean(job.dueDate && job.dueDate.getTime() < Date.now());
}

/** Translucent status trigger styling for the command center dropdown button. */
function getJobStatusButtonPresentation(job: Job) {
  if (isJobInvoiceOverdue(job)) {
    return {
      label: "Overdue",
      buttonClass:
        "border-red-500/40 bg-red-950/50 text-red-50 shadow-[inset_0_0_0_1px_rgba(248,113,113,0.18)]",
    };
  }

  switch (job.status) {
    case "paid":
      return {
        label: "Paid",
        buttonClass:
          "border-emerald-500/35 bg-emerald-950/45 text-emerald-50 shadow-[inset_0_0_0_1px_rgba(52,211,153,0.15)]",
      };
    case "invoiced":
      return {
        label: "Invoiced",
        buttonClass:
          "border-violet-500/40 bg-violet-950/50 text-violet-50 shadow-[inset_0_0_0_1px_rgba(167,139,250,0.2)]",
      };
    case "in-progress":
      return {
        label: "In Progress",
        buttonClass:
          "border-amber-400/45 bg-amber-950/40 text-amber-50 shadow-[inset_0_0_0_1px_rgba(251,191,36,0.22)]",
      };
    case "quoted":
      return {
        label: "Quoted",
        buttonClass:
          "border-cyan-500/40 bg-cyan-950/50 text-cyan-50 shadow-[inset_0_0_0_1px_rgba(34,211,238,0.18)]",
      };
    default:
      return {
        label: "New",
        buttonClass:
          "border-blue-500/40 bg-blue-950/50 text-blue-50 shadow-[inset_0_0_0_1px_rgba(96,165,250,0.18)]",
      };
  }
}

function formatSiteAddressLine(site?: Job["siteAddress"]): string {
  if (!site?.line1?.trim()) {
    return "";
  }
  const tail = [site.suburb, site.state, site.postcode].filter(Boolean).join(" ");
  const line2 = site.line2?.trim();
  return [site.line1.trim(), line2, tail].filter(Boolean).join(", ");
}

const STATUS_OPTIONS: Array<{ value: JobWorkflowStatus; label: string }> = [
  { value: "new", label: "New" },
  { value: "quoted", label: "Quoted" },
  { value: "in-progress", label: "In Progress" },
  { value: "invoiced", label: "Invoiced" },
  { value: "paid", label: "Paid" },
];

export default function JobDetailPage() {
  const params = useParams<{ id: string }>();
  const id = String(params.id ?? "");
  const jobId = useMemo(() => {
    const normalizedParamId = id.trim();

    if (normalizedParamId && normalizedParamId !== "placeholder") {
      return normalizedParamId;
    }

    if (typeof window === "undefined") {
      return "";
    }

    const fromPathname = resolveJobIdFromPathname(window.location.pathname);
    return fromPathname === "placeholder" ? "" : fromPathname;
  }, [id]);
  const hasValidJobId = useMemo(() => {
    return Boolean(jobId) && jobId !== "placeholder" && isLikelyFirebaseDocId(jobId);
  }, [jobId]);
  const queryClient = useQueryClient();
  const { currentUser, isAuthLoading } = useAuth();
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingDescription, setEditingDescription] = useState("");
  const [editingQuantity, setEditingQuantity] = useState<NumberInputValue>(1);
  const [editingUnitPrice, setEditingUnitPrice] = useState<NumberInputValue>(0);
  const [showAddItemModal, setShowAddItemModal] = useState(false);
  /** When set, add-item modal skips the labor/material switcher and locks the form. */
  const [addItemModalEntry, setAddItemModalEntry] = useState<"labor" | "material" | null>(null);
  const [newItemKind, setNewItemKind] = useState<"labor" | "material">("labor");
  const [showMaterialsMenu, setShowMaterialsMenu] = useState(false);
  const materialsMenuRef = useRef<HTMLDivElement>(null);
  const workbenchReceiptInputRef = useRef<HTMLInputElement>(null);
  const [newItemDescription, setNewItemDescription] = useState("");
  const [laborRateType, setLaborRateType] = useState<"builder" | "apprentice">("builder");
  const [laborHours, setLaborHours] = useState<NumberInputValue>(1);
  const [laborHourlyRate, setLaborHourlyRate] = useState<NumberInputValue>(95);
  const [materialQuantity, setMaterialQuantity] = useState<NumberInputValue>(1);
  const [materialUnitCostExGst, setMaterialUnitCostExGst] = useState<NumberInputValue>("");

  const [activeJobTab, setActiveJobTab] = useState("workbench");
  const [highlightedDocumentId, setHighlightedDocumentId] = useState<string | null>(null);
  const [highlightedQuoteId, setHighlightedQuoteId] = useState<string | null>(null);
  const [invoicePopoverLineId, setInvoicePopoverLineId] = useState<string | null>(null);
  const [quotePopoverLineId, setQuotePopoverLineId] = useState<string | null>(null);
  const [activeWorkbenchReceipt, setActiveWorkbenchReceipt] = useState<import("@/types/database").JobFileRecord | null>(null);
  const [receiptWorkbenchSourceFile, setReceiptWorkbenchSourceFile] = useState<File | null>(null);
  const receiptUploadFileRef = useRef<File | null>(null);
  const [receiptAutoProcess, setReceiptAutoProcess] = useState(false);
  const [selectedLineItemIds, setSelectedLineItemIds] = useState<string[]>([]);
  const [workbenchSearch, setWorkbenchSearch] = useState("");
  const [workbenchSort, setWorkbenchSort] = useState<{
    key: WorkbenchSortKey;
    dir: WorkbenchSortDir;
  }>({ key: "item", dir: "asc" });
  const lastSelectedWorkbenchIndex = useRef<number | null>(null);
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [editStudio, setEditStudio] = useState<{
    document: JobDocumentRecord;
    payload: DocumentRefinementPayload;
    versions: DocumentVersion[];
  } | null>(null);
  const [deletingDocumentId, setDeletingDocumentId] = useState<string | null>(null);
  const [showPreFlightWarning, setShowPreFlightWarning] = useState(false);
  const [preFlightFlaggedItems, setPreFlightFlaggedItems] = useState<LineItem[]>([]);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const statusMenuRef = useRef<HTMLDivElement>(null);
  const [statusGuard, setStatusGuard] = useState<{
    target: JobWorkflowStatus;
    documentType: "quote" | "invoice";
  } | null>(null);

  const [settingsDraft, setSettingsDraft] = useState<{
    purchaseOrderNumber: string;
    startDate: string;
    targetEndDate: string;
  } | null>(null);

  const { data: job, isLoading: isJobLoading } = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => getJob(jobId),
    enabled: hasValidJobId && Boolean(currentUser) && !isAuthLoading,
  });

  const { data: client } = useQuery({
    queryKey: ["client", job?.clientId],
    queryFn: () => getClientById(job?.clientId ?? ""),
    enabled: Boolean(job?.clientId),
  });

  const { data: lineItems = [] } = useQuery({
    queryKey: ["line-items", jobId],
    queryFn: () => getLineItemsByJobId(jobId),
    enabled: hasValidJobId && Boolean(currentUser) && !isAuthLoading,
  });

  useEffect(() => {
    const uid = currentUser?.uid;

    if (!uid || !hasValidJobId) {
      return;
    }

    const unsubscribe = subscribeLineItemsByJobId(
      uid,
      jobId,
      (items) => {
        queryClient.setQueryData(["line-items", jobId], items);
      },
      () => {
        void queryClient.invalidateQueries({ queryKey: ["line-items", jobId] });
      },
    );

    return unsubscribe;
  }, [currentUser?.uid, hasValidJobId, jobId, queryClient]);

  useEffect(() => {
    if (!showMaterialsMenu) {
      return;
    }
    const onPointerDown = (event: MouseEvent | PointerEvent) => {
      const el = materialsMenuRef.current;
      if (el && !el.contains(event.target as Node)) {
        setShowMaterialsMenu(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [showMaterialsMenu]);

  useEffect(() => {
    if (!statusMenuOpen) {
      return;
    }
    const onPointerDown = (event: MouseEvent | PointerEvent) => {
      const el = statusMenuRef.current;
      if (el && !el.contains(event.target as Node)) {
        setStatusMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [statusMenuOpen]);

  useEffect(() => {
    if (!highlightedDocumentId) {
      return;
    }
    const timer = window.setTimeout(() => {
      setHighlightedDocumentId(null);
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [highlightedDocumentId]);

  useEffect(() => {
    if (!highlightedQuoteId) {
      return;
    }
    const timer = window.setTimeout(() => {
      setHighlightedQuoteId(null);
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [highlightedQuoteId]);

  const { data: files = [] } = useQuery({
    queryKey: ["job-files", jobId],
    queryFn: () => getJobFiles(jobId),
    enabled: hasValidJobId && Boolean(currentUser) && !isAuthLoading,
  });

  const { data: documents = [] } = useQuery({
    queryKey: ["job-documents", jobId],
    queryFn: () => getJobDocuments(jobId),
    enabled: hasValidJobId && Boolean(currentUser) && !isAuthLoading,
  });

  const { data: userSettings } = useQuery({
    queryKey: ["user-settings"],
    queryFn: getUserSettings,
    enabled: Boolean(currentUser) && !isAuthLoading,
  });

  const settingsValues = useMemo(() => {
    if (settingsDraft) {
      return settingsDraft;
    }

    return {
      purchaseOrderNumber: job?.purchaseOrderNumber ?? "",
      startDate: formatDateInput(job?.startDate),
      targetEndDate: formatDateInput(job?.dueDate),
    };
  }, [job?.dueDate, job?.purchaseOrderNumber, job?.startDate, settingsDraft]);

  const visibleItems = useMemo(() => {
    return lineItems.filter((item) => !item.deletedAt);
  }, [lineItems]);

  const parentItems = useMemo(() => {
    return visibleItems.filter((item) => !item.variationForLineItemId);
  }, [visibleItems]);

  const documentsById = useMemo(() => {
    return new Map(documents.map((document) => [document.id, document]));
  }, [documents]);

  const parentItemIds = useMemo(() => new Set(parentItems.map((item) => item.id)), [parentItems]);

  const activeSelectedLineItemIds = useMemo(() => {
    return selectedLineItemIds.filter((itemId) => parentItemIds.has(itemId));
  }, [selectedLineItemIds, parentItemIds]);

  const handleGenerateDocumentClick = useCallback(() => {
    const selected = parentItems.filter((item) => activeSelectedLineItemIds.includes(item.id));
    const flagged = selected.filter((item) => {
      const hasInvoiceHistory = getInvoiceLinkedHistory(item, documentsById).length > 0;
      const hasQuoteHistory = getQuoteLinkedHistory(item, documentsById).length > 0;
      return hasInvoiceHistory || hasQuoteHistory;
    });

    if (flagged.length === 0) {
      setIsWizardOpen(true);
      return;
    }

    setPreFlightFlaggedItems(flagged);
    setShowPreFlightWarning(true);
  }, [activeSelectedLineItemIds, documentsById, parentItems]);

  const toggleWorkbenchSort = useCallback((key: WorkbenchSortKey) => {
    setWorkbenchSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" },
    );
  }, []);

  const visibleWorkbenchParents = useMemo(() => {
    const q = workbenchSearch.trim().toLowerCase();
    let rows = parentItems;
    if (q) {
      rows = rows.filter((item) => {
        const desc = (item.description ?? "").toLowerCase();
        const raw = (item.rawReceiptDescription ?? "").toLowerCase();
        return desc.includes(q) || raw.includes(q);
      });
    }
    return rows;
  }, [parentItems, workbenchSearch]);

  const sortedWorkbenchParents = useMemo(() => {
    const items = [...visibleWorkbenchParents];
    const { key, dir } = workbenchSort;
    const mult = dir === "asc" ? 1 : -1;
    items.sort((a, b) => {
      switch (key) {
        case "item":
          return mult * a.description.localeCompare(b.description, undefined, { sensitivity: "base" });
        case "kind":
          return mult * a.kind.localeCompare(b.kind);
        case "status":
          return mult * a.status.localeCompare(b.status);
        case "qty":
          return mult * (Number(a.quantity) - Number(b.quantity));
        case "rate":
          return mult * (a.unitPriceCents - b.unitPriceCents);
        case "total":
          return mult * (a.totalCents - b.totalCents);
        default:
          return 0;
      }
    });
    return items;
  }, [visibleWorkbenchParents, workbenchSort]);

  const workbenchVisibleSelectableIds = useMemo(
    () => sortedWorkbenchParents.map((item) => item.id),
    [sortedWorkbenchParents],
  );

  const allWorkbenchVisibleSelected =
    workbenchVisibleSelectableIds.length > 0 &&
    workbenchVisibleSelectableIds.every((id) => selectedLineItemIds.includes(id));

  const isWorkbenchSelectIndeterminate =
    workbenchVisibleSelectableIds.some((id) => selectedLineItemIds.includes(id)) &&
    !allWorkbenchVisibleSelected;

  const handleWorkbenchRowSelect = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>, index: number, itemId: string) => {
      event.preventDefault();

      if (event.shiftKey && lastSelectedWorkbenchIndex.current !== null) {
        setSelectedLineItemIds((current) => {
          const start = Math.min(lastSelectedWorkbenchIndex.current!, index);
          const end = Math.max(lastSelectedWorkbenchIndex.current!, index);
          const rangeIds = sortedWorkbenchParents.slice(start, end + 1).map((item) => item.id);
          return [...new Set([...current, ...rangeIds])];
        });
        return;
      }

      setSelectedLineItemIds((current) => {
        const isSelected = current.includes(itemId);
        return isSelected ? current.filter((id) => id !== itemId) : [...current, itemId];
      });
      lastSelectedWorkbenchIndex.current = index;
    },
    [sortedWorkbenchParents],
  );

  const variationsByParent = useMemo(() => {
    const grouped = new Map<string, LineItem[]>();

    for (const item of visibleItems) {
      if (!item.variationForLineItemId) {
        continue;
      }

      const existing = grouped.get(item.variationForLineItemId) ?? [];
      existing.push(item);
      grouped.set(item.variationForLineItemId, existing);
    }

    return grouped;
  }, [visibleItems]);

  const materialMarkupPercent = job ? getJobMaterialMarkupPercent(job) : 15;

  const markupMutation = useMutation({
    mutationFn: (nextPercent: number) => updateJobMaterialMarkup(jobId, nextPercent),
    onMutate: async (nextPercent) => {
      await queryClient.cancelQueries({ queryKey: ["job", jobId] });
      const previous = queryClient.getQueryData<Job>(["job", jobId]);
      if (previous) {
        queryClient.setQueryData<Job>(["job", jobId], {
          ...previous,
          materialMarkupPercent: nextPercent,
        });
      }
      return { previous };
    },
    onError: (error, _next, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["job", jobId], context.previous);
      }
      toast.error(error.message);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["job", jobId] });
    },
  });

  const totals = useMemo(() => {
    const subtotal = visibleItems.reduce((sum, item) => sum + item.subtotalCents, 0);
    const materialSubtotal = sumMaterialSubtotalCents(visibleItems);
    const computed = computeDocumentTotals(subtotal, materialSubtotal, materialMarkupPercent);

    return {
      subtotal,
      gst: computed.taxCents,
      total: computed.totalCents,
      markupPreview: computed.markupCents,
      materialSubtotal,
      remainingToBill: computeRemainingToBillTotalCents(visibleItems, materialMarkupPercent),
    };
  }, [visibleItems, materialMarkupPercent]);

  const materialPreview = useMemo(() => {
    const quantity = coerceNumberInputValue(materialQuantity, 0);
    const unitCostExGst = coerceNumberInputValue(materialUnitCostExGst, 0);
    const unitCostCents = Math.round(unitCostExGst * 100);
    const markupMultiplier = 1 + materialMarkupPercent / 100;
    const clientUnitPriceCents = Math.round(unitCostCents * markupMultiplier);
    const rawSubtotalCents = Math.round(quantity * unitCostCents);
    const markupCents = computeMaterialMarkupCents(rawSubtotalCents, materialMarkupPercent);
    const gstCents = Math.round((rawSubtotalCents + markupCents) * 0.1);
    const totalCents = rawSubtotalCents + markupCents + gstCents;

    return {
      clientUnitPriceCents,
      rawSubtotalCents,
      markupCents,
      gstCents,
      totalCents,
    };
  }, [materialQuantity, materialUnitCostExGst, materialMarkupPercent]);

  const refreshJobData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["job", jobId] }),
      queryClient.invalidateQueries({ queryKey: ["client", job?.clientId] }),
      queryClient.invalidateQueries({ queryKey: ["line-items", jobId] }),
      queryClient.invalidateQueries({ queryKey: ["job-files", jobId] }),
      queryClient.invalidateQueries({ queryKey: ["job-documents", jobId] }),
      queryClient.invalidateQueries({ queryKey: ["user-settings"] }),
      queryClient.invalidateQueries({ queryKey: ["active-jobs"] }),
      queryClient.invalidateQueries({ queryKey: ["completed-jobs"] }),
      queryClient.invalidateQueries({ queryKey: ["archived-jobs"] }),
    ]);
  };

  const handleEditDocument = useCallback(
    (document: JobDocumentRecord) => {
      if (!job || !client || !userSettings) {
        toast.error("Job data is still loading.");
        return;
      }

      const lock = isDocumentEditLocked(document, job.status);
      if (lock.locked) {
        toast.error(lock.reason ?? "This document is finalized.");
        return;
      }

      const docLineItems = parentItems.filter((item) => document.lineItemIds.includes(item.id));
      const fallback = reconstructPayloadFromDocument({
        document,
        job,
        client,
        settings: userSettings,
        lineItems: docLineItems.length > 0 ? docLineItems : parentItems,
      });
      const payload = resolveActiveDocumentPayload(document, fallback);
      const versions = resolveDocumentVersions(document, fallback);
      setEditStudio({ document, payload, versions });
    },
    [job, client, userSettings, parentItems],
  );

  const handleDeleteDocument = useCallback(
    async (document: JobDocumentRecord) => {
      if (!job) {
        toast.error("Job data is still loading.");
        return;
      }

      const lock = isDocumentDeleteLocked(document, job.status);
      if (lock.locked) {
        toast.error(lock.reason ?? "This document cannot be deleted.");
        return;
      }

      setDeletingDocumentId(document.id);
      try {
        await deleteJobDocument({
          jobId,
          documentId: document.id,
          jobStatus: job.status,
        });
        toast.success(`${document.documentNumber} deleted`);
        await refreshJobData();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to delete document");
        throw error;
      } finally {
        setDeletingDocumentId(null);
      }
    },
    [job, jobId, refreshJobData],
  );

  const updateStatusMutation = useMutation({
    mutationFn: (status: JobWorkflowStatus) => updateJobStatus(jobId, status),
    onSuccess: async () => {
      toast.success("Job status updated");
      await refreshJobData();
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const requestJobStatusChange = useCallback(
    (nextStatus: JobWorkflowStatus) => {
      if (!job) {
        return;
      }

      if (nextStatus === job.status) {
        setStatusMenuOpen(false);
        return;
      }

      const quoteCount = job.quoteIds?.length ?? 0;
      const invoiceCount = job.invoiceIds?.length ?? 0;

      if (nextStatus === "quoted" && quoteCount === 0) {
        setStatusGuard({ target: nextStatus, documentType: "quote" });
        setStatusMenuOpen(false);
        return;
      }

      if (nextStatus === "invoiced" && invoiceCount === 0) {
        setStatusGuard({ target: nextStatus, documentType: "invoice" });
        setStatusMenuOpen(false);
        return;
      }

      updateStatusMutation.mutate(nextStatus);
      setStatusMenuOpen(false);
    },
    [job, updateStatusMutation],
  );

  const updateItemMutation = useMutation({
    mutationFn: ({ itemId, quantity, unitPriceCents, description }: {
      itemId: string;
      quantity: number;
      unitPriceCents: number;
      description: string;
    }) => {
      return updateLineItem(itemId, {
        quantity,
        unitPriceCents,
        description,
      });
    },
    onSuccess: async () => {
      setEditingItemId(null);
      toast.success("Line item saved");
      await refreshJobData();
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const addItemMutation = useMutation({
    mutationFn: async () => {
      if (!job) {
        throw new Error("Job not found");
      }

      const parentType = job.invoiceIds[0] ? "invoice" as const : "quote" as const;
      const parentId = job.invoiceIds[0] ?? job.quoteIds[0] ?? job.id;

      if (!newItemDescription.trim()) {
        throw new Error("Description is required");
      }

      if (newItemKind === "labor") {
        const hours = coerceNumberInputValue(laborHours, 0);
        const hourlyRate = coerceNumberInputValue(laborHourlyRate, 0);
        return addLineItem(jobId, {
          clientId: job.clientId ?? "",
          parentType,
          parentId,
          kind: "labor",
          description: newItemDescription.trim(),
          quantity: Math.max(0, hours),
          unit: "hours",
          unitPriceCents: Math.max(0, Math.round(hourlyRate * 100)),
          laborRateType,
          laborRoleLabel: laborRateType === "builder" ? "Builder" : "Apprentice",
        });
      }

      const quantity = coerceNumberInputValue(materialQuantity, 0);
      const unitCostExGst = coerceNumberInputValue(materialUnitCostExGst, 0);
      return addLineItem(jobId, {
        clientId: job.clientId ?? "",
        parentType,
        parentId,
        kind: "material",
        description: newItemDescription.trim(),
        quantity: Math.max(0, quantity),
        unit: "item",
        unitPriceCents: Math.max(0, Math.round(unitCostExGst * 100)),
      });
    },
    onSuccess: async () => {
      toast.success("Line item added");
      setShowAddItemModal(false);
      setAddItemModalEntry(null);
      setNewItemDescription("");
      setLaborHours(1);
      setLaborHourlyRate(95);
      setMaterialQuantity(1);
      setMaterialUnitCostExGst("");
      await refreshJobData();
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const deleteItemMutation = useMutation({
    mutationFn: deleteLineItem,
    onSuccess: async (_, itemId) => {
      toast.warning("Line item deleted", {
        action: {
          label: "Undo",
          onClick: () => {
            restoreItemMutation.mutate(itemId);
          },
        },
      });

      await refreshJobData();
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const restoreItemMutation = useMutation({
    mutationFn: restoreLineItem,
    onSuccess: async () => {
      toast.success("Line item restored");
      await refreshJobData();
    },
  });

  const updateSettingsMutation = useMutation({
    mutationFn: () => {
      return updateJobSettings(jobId, {
        purchaseOrderNumber: settingsValues.purchaseOrderNumber,
        startDate: settingsValues.startDate ? new Date(settingsValues.startDate) : undefined,
        dueDate: settingsValues.targetEndDate ? new Date(settingsValues.targetEndDate) : undefined,
      });
    },
    onSuccess: async () => {
      setSettingsDraft(null);
      toast.success("Job settings saved");
      await refreshJobData();
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const uploadReceiptMutation = useMutation({
    mutationFn: (file: File) => {
      receiptUploadFileRef.current = file;
      return saveReceiptImage(jobId, file);
    },
    onSuccess: async (receiptFile) => {
      console.log("[Receipt Upload] Completed upload, opening workbench", receiptFile);
      toast.success("Receipt saved to job files");
      const localCopy = receiptUploadFileRef.current;
      receiptUploadFileRef.current = null;
      setReceiptWorkbenchSourceFile(localCopy);
      setActiveWorkbenchReceipt(receiptFile);
      setReceiptAutoProcess(true);
      await refreshJobData();
    },
    onError: (error) => {
      console.error("[Receipt Upload] Upload failed", error);
      toast.error(error.message);
    },
  });

  const uploadDocumentMutation = useMutation({
    mutationFn: (file: File) => saveJobDocument(jobId, file),
    onSuccess: async () => {
      toast.success("File uploaded");
      await refreshJobData();
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const uploadSitePhotoMutation = useMutation({
    mutationFn: (file: File) => saveSitePhoto(jobId, file),
    onSuccess: async () => {
      toast.success("Site photo uploaded");
      await refreshJobData();
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  if (isAuthLoading || isJobLoading) {
    return <div className="p-8 text-neutral-200">Loading job...</div>;
  }

  if (!currentUser) {
    return <div className="p-8 text-neutral-200">Checking session...</div>;
  }

  if (!job) {
    return <div className="p-8 text-red-300">Job not found.</div>;
  }

  const statusPresentation = getJobStatusButtonPresentation(job);
  const siteAddressLine = formatSiteAddressLine(job.siteAddress);

  const beginEdit = (item: LineItem) => {
    setEditingItemId(item.id);
    setEditingDescription(item.description);
    setEditingQuantity(item.quantity);
    setEditingUnitPrice(item.unitPriceCents);
  };

  return (
    <div className="min-h-screen bg-[#F5F6F8] text-[#323338]">
      {activeWorkbenchReceipt && (
        <ReceiptWorkbench
          receipt={activeWorkbenchReceipt}
          sourceImageFile={receiptWorkbenchSourceFile}
          currentJobId={jobId}
          autoStart={receiptAutoProcess}
          onClose={() => {
            setActiveWorkbenchReceipt(null);
            setReceiptWorkbenchSourceFile(null);
            setReceiptAutoProcess(false);
          }}
          onExtractionComplete={() => {
            setReceiptAutoProcess(false);
          }}
          onSynced={() => {
            setActiveWorkbenchReceipt(null);
            setReceiptWorkbenchSourceFile(null);
            setReceiptAutoProcess(false);
            void refreshJobData();
          }}
        />
      )}

      {statusGuard ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-white/70 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="status-guard-title"
          onClick={() => setStatusGuard(null)}
        >
          <div
            className="w-full max-w-md rounded-lg border border-[#E6E9EF] bg-white p-6 shadow-monday-2"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="status-guard-title" className="text-lg font-semibold text-[#323338]">
              Confirm status change
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-[#676879]">
              You haven&apos;t generated a {statusGuard.documentType === "quote" ? "Quote" : "Invoice"} for this job
              yet. Are you sure you want to manually advance the status to{" "}
              <span className="font-semibold text-[#323338]">
                {STATUS_OPTIONS.find((o) => o.value === statusGuard.target)?.label ?? statusGuard.target}
              </span>
              ?
            </p>
            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <Button
                type="button"
                variant="secondary"
                className="h-10"
                onClick={() => setStatusGuard(null)}
                disabled={updateStatusMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                type="button"
                className="h-10 bg-[#0073EA] font-semibold text-white hover:bg-[#0060B9]"
                disabled={updateStatusMutation.isPending}
                onClick={() => {
                  updateStatusMutation.mutate(statusGuard.target);
                  setStatusGuard(null);
                }}
              >
                {updateStatusMutation.isPending ? "Saving…" : "Yes, update status"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {receiptAutoProcess && (
        <div className="fixed top-0 left-0 right-0 z-40 flex items-center justify-center gap-3 bg-gradient-to-r from-[#0073EA] to-[#0060B9] px-4 py-3 text-white shadow-monday-1">
          <div className="size-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
          <span className="font-medium">Processing receipt with AI...</span>
        </div>
      )}

      {showPreFlightWarning ? (
        <PreFlightWarningModal
          flaggedItems={preFlightFlaggedItems}
          documentsById={documentsById}
          onReviewSelection={() => {
            setShowPreFlightWarning(false);
            setPreFlightFlaggedItems([]);
          }}
          onProceedAnyway={() => {
            setShowPreFlightWarning(false);
            setPreFlightFlaggedItems([]);
            setIsWizardOpen(true);
          }}
        />
      ) : null}

      {isWizardOpen ? (
        <DocumentGenerationWizard
          key={`${job.id}-${activeSelectedLineItemIds.join(",")}-${documents.length}`}
          isOpen={isWizardOpen}
          onClose={() => setIsWizardOpen(false)}
          job={job}
          client={client ?? null}
          lineItems={parentItems}
          settings={userSettings ?? null}
          documents={documents}
          selectedItemIds={activeSelectedLineItemIds}
          onGenerated={refreshJobData}
          onClientUpdated={refreshJobData}
        />
      ) : null}

      {editStudio ? (
        <DocumentRefinementStudio
          isOpen
          mode="edit"
          initialPayload={editStudio.payload}
          versions={editStudio.versions}
          onCancel={() => setEditStudio(null)}
          onFinalize={async (payload, pdfFile, meta) => {
            await commitJobDocumentVersion({
              jobId: job.id,
              documentId: editStudio.document.id,
              payload,
              commitMessage: meta.commitMessage,
              pdfFile,
            });
            toast.success("Document version saved");
            await refreshJobData();
            setEditStudio(null);
          }}
        />
      ) : null}
      <main className="mx-auto max-w-[1500px] px-6 py-8 lg:px-10">
        <div className="mb-4">
          <Link
            href="/"
            className="inline-flex h-10 items-center rounded-lg border border-[#D0D4E4] bg-[#F5F6F8] px-4 text-sm font-semibold text-[#323338] transition hover:bg-[#F5F6F8] active:scale-[0.98]"
          >
            ← Back to Dashboard
          </Link>
        </div>

        <header className="relative z-40 mb-6 overflow-visible rounded-lg border border-[#E6E9EF] bg-white p-5 shadow-monday-1 md:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <h1 className="flex flex-wrap items-baseline text-2xl font-bold tracking-tight text-[#323338] md:text-3xl lg:text-4xl">
                <span className="break-words">{job.title}</span>
                <span className="mx-1.5 text-2xl font-normal text-[#676879] md:text-3xl">for</span>
                <button
                  type="button"
                  onClick={() => setActiveJobTab("job-client")}
                  className="break-words text-left font-semibold text-[#0073EA] underline-offset-4 transition-all hover:underline"
                >
                  {client?.displayName ?? "Unassigned Client"}
                </button>
              </h1>
              <div className="mt-3 flex flex-wrap items-center gap-6 text-sm text-[#676879]">
                <span className="inline-flex min-w-0 max-w-full items-center">
                  <Hash className="mr-1.5 inline size-4 shrink-0 text-[#676879]" />
                  <span className="min-w-0 truncate text-[#676879]">
                    <span className="text-[#676879]">PO</span> {job.purchaseOrderNumber ?? "—"}
                  </span>
                </span>
                <span className="inline-flex min-w-0 max-w-full flex-1 items-start sm:flex-initial">
                  <MapPin className="mr-1.5 mt-0.5 inline size-4 shrink-0 text-[#676879]" />
                  <span className="min-w-0 break-words text-[#676879]">
                    {siteAddressLine ? (
                      siteAddressLine
                    ) : (
                      <span className="text-[#676879]">No site address set</span>
                    )}
                  </span>
                </span>
              </div>
            </div>

            <div ref={statusMenuRef} className="relative z-50 shrink-0">
              <button
                type="button"
                disabled={updateStatusMutation.isPending}
                onClick={() => setStatusMenuOpen((open) => !open)}
                className={cn(
                  "inline-flex items-center rounded-lg border px-4 py-2.5 text-sm font-semibold transition-all duration-150 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50",
                  statusPresentation.buttonClass,
                )}
                aria-expanded={statusMenuOpen}
                aria-haspopup="menu"
              >
                {statusPresentation.label}
                <ChevronDown className="ml-2 size-3.5 shrink-0 opacity-90" />
              </button>
              <div
                role="menu"
                aria-hidden={!statusMenuOpen}
                className={cn(
                  "absolute right-0 top-full z-50 mt-2 min-w-[12.5rem] origin-top-right overflow-hidden rounded-lg border border-[#D0D4E4] bg-white py-1 shadow-monday-2 animate-monday-in transition-all duration-150 ease-out",
                  statusMenuOpen
                    ? "pointer-events-auto visible scale-100 opacity-100"
                    : "pointer-events-none invisible scale-95 opacity-0",
                )}
              >
                {STATUS_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="menuitem"
                    disabled={updateStatusMutation.isPending}
                    onClick={() => requestJobStatusChange(option.value)}
                    className={cn(
                      "flex w-full items-center px-4 py-2.5 text-left text-sm font-medium transition-colors hover:bg-[#F5F6F8] disabled:opacity-50",
                      job.status === option.value ? "bg-[#F5F6F8] text-[#323338]" : "text-[#323338]",
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </header>

        <Tabs value={activeJobTab} onValueChange={setActiveJobTab} className="gap-4">
          <TabsList
            variant="line"
            className="h-auto min-h-10 w-full flex-wrap justify-start gap-x-2 gap-y-2 border-b border-[#D0D4E4] pb-1"
          >
            <TabsTrigger value="workbench">Workbench</TabsTrigger>
            <TabsTrigger value="quotes">Quotes</TabsTrigger>
            <TabsTrigger value="invoices">Invoices</TabsTrigger>
            <TabsTrigger value="receipts">Receipts</TabsTrigger>
            <TabsTrigger value="other-docs">Other Docs</TabsTrigger>
            <TabsTrigger value="job-client">Job &amp; client</TabsTrigger>
          </TabsList>

          <TabsContent value="workbench">
            <Card className="bg-white ring-[#E6E9EF]">
              <CardContent className="pt-6">
                <input
                  ref={workbenchReceiptInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      uploadReceiptMutation.mutate(file);
                    }
                    event.target.value = "";
                  }}
                />

                <div className="flex flex-col gap-4 pb-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
                    <div className="flex h-10 w-full items-center gap-2 rounded-lg border border-[#E6E9EF]/80 bg-white/40 px-3 text-sm transition-all focus-within:border-[#0073EA]/500/40 sm:w-64">
                      <Search className="size-4 shrink-0 text-[#676879]" aria-hidden />
                      <input
                        type="search"
                        value={workbenchSearch}
                        onChange={(e) => setWorkbenchSearch(e.target.value)}
                        placeholder="Search items…"
                        className="min-w-0 flex-1 bg-transparent text-sm leading-none text-[#323338] outline-none placeholder:text-[#676879]"
                        aria-label="Search line items"
                      />
                    </div>
                    <p className="shrink-0 text-xs leading-none text-[#676879]">
                      Showing {sortedWorkbenchParents.length}{" "}
                      {sortedWorkbenchParents.length === 1 ? "item" : "items"}
                    </p>
                  </div>

                  <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
                  <Button
                    type="button"
                    className="flex h-10 w-full items-center justify-center rounded-lg bg-[#0073EA] px-4 py-2.5 text-sm font-semibold text-white shadow-none transition-all duration-150 hover:bg-[#0060B9] sm:w-auto"
                    onClick={() => {
                      setAddItemModalEntry("labor");
                      setNewItemKind("labor");
                      setShowMaterialsMenu(false);
                      setShowAddItemModal(true);
                    }}
                  >
                    <Wrench className="mr-2 size-4 shrink-0" />
                    Add Labor
                  </Button>

                  <div ref={materialsMenuRef} className="relative">
                    <Button
                      type="button"
                      className="flex h-10 w-full items-center justify-center rounded-lg bg-[#0073EA] px-4 py-2.5 text-sm font-semibold text-white shadow-none transition-all duration-150 hover:bg-[#0060B9] sm:w-auto"
                      onClick={() => {
                        setShowMaterialsMenu((open) => !open);
                      }}
                    >
                      <Package className="mr-2 size-4 shrink-0" />
                      Add Materials
                      <ChevronDown className="ml-1.5 size-3.5 shrink-0 opacity-90" />
                    </Button>

                    {showMaterialsMenu ? (
                      <div
                        className="absolute right-0 z-50 mt-2 w-52 rounded-lg border border-[#E6E9EF] bg-white p-1 shadow-monday-2"
                        role="menu"
                      >
                        <button
                          type="button"
                          role="menuitem"
                          className="group flex w-full items-center rounded-lg p-2 text-left text-sm text-[#676879] transition-colors hover:bg-[#F5F6F8] hover:text-[#0073EA]"
                          onClick={() => {
                            setShowMaterialsMenu(false);
                            workbenchReceiptInputRef.current?.click();
                          }}
                        >
                          <Receipt className="mr-2 size-4 shrink-0 text-[#676879] group-hover:text-[#0073EA]" />
                          Upload Receipt
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="group flex w-full items-center rounded-lg p-2 text-left text-sm text-[#676879] transition-colors hover:bg-[#F5F6F8] hover:text-[#0073EA]"
                          onClick={() => {
                            setShowMaterialsMenu(false);
                            setAddItemModalEntry("material");
                            setNewItemKind("material");
                            setShowAddItemModal(true);
                          }}
                        >
                          <PenLine className="mr-2 size-4 shrink-0 text-[#676879] group-hover:text-[#0073EA]" />
                          Add Manually
                        </button>
                      </div>
                    ) : null}
                  </div>
                  </div>
                </div>

                <Table className="w-full border-collapse">
                  <TableHeader>
                    <TableRow className="border-b border-[#E6E9EF] hover:bg-transparent">
                      <TableHead className="w-12 py-3.5 text-left align-middle font-semibold text-[#323338]">
                        <div className="flex items-center justify-center">
                          <WorkbenchCheckbox
                            checked={allWorkbenchVisibleSelected}
                            indeterminate={isWorkbenchSelectIndeterminate}
                            disabled={workbenchVisibleSelectableIds.length === 0}
                            ariaLabel="Select all visible line items"
                            onClick={() => {
                              if (allWorkbenchVisibleSelected) {
                                setSelectedLineItemIds([]);
                              } else {
                                setSelectedLineItemIds((prev) => [
                                  ...new Set([...prev, ...workbenchVisibleSelectableIds]),
                                ]);
                              }
                              lastSelectedWorkbenchIndex.current = null;
                            }}
                          />
                        </div>
                      </TableHead>
                      <TableHead className="py-3.5 text-left align-middle text-xs font-semibold uppercase tracking-wider text-[#676879]">
                        <button
                          type="button"
                          className="group inline-flex items-center gap-1.5 rounded-md py-0.5 pr-1 text-left uppercase tracking-wider transition-colors hover:text-[#323338]"
                          onClick={() => toggleWorkbenchSort("item")}
                        >
                          Item
                          <WorkbenchSortGlyph
                            active={workbenchSort.key === "item"}
                            dir={workbenchSort.dir}
                          />
                        </button>
                      </TableHead>
                      <TableHead className="py-3.5 text-left align-middle text-xs font-semibold uppercase tracking-wider text-[#676879]">
                        <button
                          type="button"
                          className="group inline-flex items-center gap-1.5 rounded-md py-0.5 pr-1 text-left uppercase tracking-wider transition-colors hover:text-[#323338]"
                          onClick={() => toggleWorkbenchSort("kind")}
                        >
                          Kind
                          <WorkbenchSortGlyph
                            active={workbenchSort.key === "kind"}
                            dir={workbenchSort.dir}
                          />
                        </button>
                      </TableHead>
                      <TableHead className="py-3.5 text-left align-middle text-xs font-semibold uppercase tracking-wider text-[#676879]">
                        <button
                          type="button"
                          className="group inline-flex items-center gap-1.5 rounded-md py-0.5 pr-1 text-left uppercase tracking-wider transition-colors hover:text-[#323338]"
                          onClick={() => toggleWorkbenchSort("status")}
                        >
                          Status
                          <WorkbenchSortGlyph
                            active={workbenchSort.key === "status"}
                            dir={workbenchSort.dir}
                          />
                        </button>
                      </TableHead>
                      <TableHead className="py-3.5 text-right align-middle text-xs font-semibold uppercase tracking-wider text-[#676879]">
                        <button
                          type="button"
                          className="group inline-flex w-full items-center justify-end gap-1.5 rounded-md py-0.5 pl-1 text-right uppercase tracking-wider transition-colors hover:text-[#323338]"
                          onClick={() => toggleWorkbenchSort("qty")}
                        >
                          Qty
                          <WorkbenchSortGlyph
                            active={workbenchSort.key === "qty"}
                            dir={workbenchSort.dir}
                          />
                        </button>
                      </TableHead>
                      <TableHead className="py-3.5 text-right align-middle text-xs font-semibold uppercase tracking-wider text-[#676879]">
                        <button
                          type="button"
                          className="group inline-flex w-full items-center justify-end gap-1.5 rounded-md py-0.5 pl-1 text-right uppercase tracking-wider transition-colors hover:text-[#323338]"
                          onClick={() => toggleWorkbenchSort("rate")}
                        >
                          Rate
                          <WorkbenchSortGlyph
                            active={workbenchSort.key === "rate"}
                            dir={workbenchSort.dir}
                          />
                        </button>
                      </TableHead>
                      <TableHead className="py-3.5 text-right align-middle text-xs font-semibold uppercase tracking-wider text-[#676879]">
                        <button
                          type="button"
                          className="group inline-flex w-full items-center justify-end gap-1.5 rounded-md py-0.5 pl-1 text-right uppercase tracking-wider transition-colors hover:text-[#323338]"
                          onClick={() => toggleWorkbenchSort("total")}
                        >
                          Total
                          <WorkbenchSortGlyph
                            active={workbenchSort.key === "total"}
                            dir={workbenchSort.dir}
                          />
                        </button>
                      </TableHead>
                      <TableHead className="py-3.5 text-right align-middle text-xs font-semibold uppercase tracking-wider text-[#676879]">
                        Actions
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedWorkbenchParents.map((item, rowIndex) => {
                      const isEditing = editingItemId === item.id;
                      const variations = variationsByParent.get(item.id) ?? [];
                      const linkedInvoices = getInvoiceLinkedHistory(item, documentsById);
                      const linkedQuotes = getQuoteLinkedHistory(item, documentsById);
                      const invoiceHistoryBadge = lineItemHistoryBadgeClasses("invoice");
                      const quoteHistoryBadge = lineItemHistoryBadgeClasses("quote");
                      const isRowSelected = activeSelectedLineItemIds.includes(item.id);

                      return (
                        <Fragment key={item.id}>
                          <TableRow
                            className={cn(
                              "group border-b border-[#E6E9EF] border-l-4 transition-colors duration-200",
                              isRowSelected
                                ? "border-l-[#0073EA] bg-[#e5f4ff]"
                                : "border-l-transparent bg-white hover:bg-[#F5F6F8]",
                            )}
                          >
                            <TableCell className="py-3.5 align-middle text-[#323338]">
                              <div className="flex items-center justify-center">
                                <WorkbenchCheckbox
                                  checked={isRowSelected}
                                  ariaLabel={`Select ${item.description}`}
                                  onClick={(event) => handleWorkbenchRowSelect(event, rowIndex, item.id)}
                                />
                              </div>
                            </TableCell>
                            <TableCell className="py-3.5 align-middle text-[#323338]">
                              {isEditing ? (
                                <Textarea
                                  value={editingDescription}
                                  onChange={(event) => {
                                    setEditingDescription(event.target.value);
                                  }}
                                  className="min-h-16"
                                />
                              ) : (
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="min-w-0 break-words">{item.description}</span>
                                  {linkedInvoices.length > 0 ? (
                                    <Popover.Root
                                      open={invoicePopoverLineId === item.id}
                                      onOpenChange={(open) => {
                                        if (open) {
                                          setInvoicePopoverLineId(item.id);
                                          setQuotePopoverLineId(null);
                                        } else {
                                          setInvoicePopoverLineId((id) => (id === item.id ? null : id));
                                        }
                                      }}
                                    >
                                      <Popover.Trigger
                                        type="button"
                                        className={invoiceHistoryBadge.trigger}
                                      >
                                        <FileText className={invoiceHistoryBadge.icon} />
                                        {linkedInvoices.length}
                                      </Popover.Trigger>
                                      <Popover.Portal>
                                        <Popover.Positioner sideOffset={8} side="bottom" align="start">
                                          <Popover.Popup className="z-[100] min-w-[240px] rounded-lg border border-[#D0D4E4]/50 bg-white p-3 text-left shadow-xl outline-none">
                                            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#676879]">
                                              Linked Invoices
                                            </p>
                                            <div className="mt-2 flex flex-col gap-0.5">
                                              {linkedInvoices.map((entry) => (
                                                <button
                                                  key={`${entry.invoiceId}-${entry.date}`}
                                                  type="button"
                                                  className={invoiceHistoryBadge.popoverLink}
                                                  onClick={() => {
                                                    setActiveJobTab("invoices");
                                                    setHighlightedDocumentId(entry.invoiceId);
                                                    setInvoicePopoverLineId(null);
                                                  }}
                                                >
                                                  <span className="font-medium">{entry.invoiceNumber}</span>
                                                  <span className="shrink-0 pl-2 text-[#676879] group-hover:text-[#676879]">
                                                    {formatLinkedInvoiceDate(entry.date)}
                                                  </span>
                                                </button>
                                              ))}
                                            </div>
                                          </Popover.Popup>
                                        </Popover.Positioner>
                                      </Popover.Portal>
                                    </Popover.Root>
                                  ) : null}
                                  {linkedQuotes.length > 0 ? (
                                    <Popover.Root
                                      open={quotePopoverLineId === item.id}
                                      onOpenChange={(open) => {
                                        if (open) {
                                          setQuotePopoverLineId(item.id);
                                          setInvoicePopoverLineId(null);
                                        } else {
                                          setQuotePopoverLineId((id) => (id === item.id ? null : id));
                                        }
                                      }}
                                    >
                                      <Popover.Trigger
                                        type="button"
                                        className={quoteHistoryBadge.trigger}
                                      >
                                        <FileEdit className={quoteHistoryBadge.icon} />
                                        {linkedQuotes.length}
                                      </Popover.Trigger>
                                      <Popover.Portal>
                                        <Popover.Positioner sideOffset={8} side="bottom" align="start">
                                          <Popover.Popup className="z-[100] min-w-[240px] rounded-lg border border-[#D0D4E4]/50 bg-white p-3 text-left shadow-xl outline-none">
                                            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#676879]">
                                              Linked Quotes
                                            </p>
                                            <div className="mt-2 flex flex-col gap-0.5">
                                              {linkedQuotes.map((entry) => (
                                                <button
                                                  key={`${entry.quoteId}-${entry.date}`}
                                                  type="button"
                                                  className={quoteHistoryBadge.popoverLink}
                                                  onClick={() => {
                                                    setActiveJobTab("quotes");
                                                    setHighlightedQuoteId(entry.quoteId);
                                                    setQuotePopoverLineId(null);
                                                  }}
                                                >
                                                  <span className="font-medium">{entry.quoteNumber}</span>
                                                  <span className="shrink-0 pl-2 text-[#676879] group-hover:text-[#676879]">
                                                    {formatLinkedInvoiceDate(entry.date)}
                                                  </span>
                                                </button>
                                              ))}
                                            </div>
                                          </Popover.Popup>
                                        </Popover.Positioner>
                                      </Popover.Portal>
                                    </Popover.Root>
                                  ) : null}
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="py-3.5 align-middle capitalize text-[#323338]">{item.kind}</TableCell>
                            <TableCell className="py-3.5 align-middle text-[#323338]">
                              <span className={lineItemStatusBadgeClass(item.status)}>{item.status}</span>
                            </TableCell>
                            <TableCell className="py-3.5 align-middle text-right font-mono text-sm text-[#676879]">
                              {isEditing ? (
                                <Input
                                  type="number"
                                  inputMode="decimal"
                                  value={formatNumberInputValue(editingQuantity)}
                                  onChange={(event) => {
                                    handleControlledNumberInputChange(event.target.value, setEditingQuantity);
                                  }}
                                  className="font-mono text-right"
                                />
                              ) : (
                                item.quantity
                              )}
                            </TableCell>
                            <TableCell className="py-3.5 align-middle text-right font-mono text-sm text-[#676879]">
                              {isEditing ? (
                                <Input
                                  type="number"
                                  inputMode="decimal"
                                  value={formatNumberInputValue(editingUnitPrice)}
                                  onChange={(event) => {
                                    handleControlledNumberInputChange(event.target.value, setEditingUnitPrice);
                                  }}
                                  className="font-mono text-right"
                                />
                              ) : (
                                formatCurrency(item.unitPriceCents)
                              )}
                            </TableCell>
                            <TableCell className="py-3.5 align-middle text-right font-mono text-sm text-[#676879]">
                              {formatCurrency(item.totalCents)}
                            </TableCell>
                            <TableCell className="py-3.5 align-middle text-[#323338]">
                              <div className="flex justify-end gap-1">
                                {isEditing ? (
                                  <>
                                    <Button
                                      size="sm"
                                      onClick={() => {
                                        updateItemMutation.mutate({
                                          itemId: item.id,
                                          quantity: coerceNumberInputValue(editingQuantity, 0),
                                          unitPriceCents: coerceNumberInputValue(editingUnitPrice, 0),
                                          description: editingDescription,
                                        });
                                      }}
                                    >
                                      Save
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="secondary"
                                      onClick={() => {
                                        setEditingItemId(null);
                                      }}
                                    >
                                      Cancel
                                    </Button>
                                  </>
                                ) : (
                                  <div className="flex items-center justify-end gap-0.5">
                                    <button
                                      type="button"
                                      className="rounded-md p-2 text-[#676879] opacity-40 transition-all duration-150 group-hover:opacity-100 hover:text-[#0073EA]"
                                      aria-label="Edit line item"
                                      onClick={() => {
                                        beginEdit(item);
                                      }}
                                    >
                                      <Pencil className="size-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      className="rounded-md p-2 text-[#676879] opacity-40 transition-all duration-150 group-hover:opacity-100 hover:text-red-400"
                                      aria-label="Soft delete line item"
                                      onClick={() => {
                                        deleteItemMutation.mutate(item.id);
                                      }}
                                    >
                                      <Trash2 className="size-3.5" />
                                    </button>
                                  </div>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>

                          {variations.map((variation) => (
                            <TableRow
                              key={variation.id}
                              className={cn(
                                "group border-b border-[#E6E9EF] bg-white/40 transition-colors duration-150",
                                "hover:rounded-lg hover:bg-[#F5F6F8]",
                              )}
                            >
                              <TableCell className="py-3.5 align-middle text-center text-[#676879]">—</TableCell>
                              <TableCell className="py-3.5 align-middle pl-8 text-[#323338]">
                                <span className="text-[#676879]">Variation:</span> {variation.description}
                              </TableCell>
                              <TableCell className="py-3.5 align-middle capitalize text-[#323338]">{variation.kind}</TableCell>
                              <TableCell className="py-3.5 align-middle text-[#323338]">
                                <span className={lineItemStatusBadgeClass(variation.status)}>{variation.status}</span>
                              </TableCell>
                              <TableCell className="py-3.5 align-middle text-right font-mono text-sm text-[#676879]">
                                {variation.quantity}
                              </TableCell>
                              <TableCell className="py-3.5 align-middle text-right font-mono text-sm text-[#676879]">
                                {formatCurrency(variation.unitPriceCents)}
                              </TableCell>
                              <TableCell className="py-3.5 align-middle text-right font-mono text-sm text-[#676879]">
                                {formatCurrency(variation.totalCents)}
                              </TableCell>
                              <TableCell className="py-3.5 align-middle text-[#323338]">
                                <div className="flex justify-end">
                                  <button
                                    type="button"
                                    className="rounded-md p-2 text-[#676879] opacity-40 transition-all duration-150 group-hover:opacity-100 hover:text-red-400"
                                    aria-label="Soft delete variation"
                                    onClick={() => {
                                      deleteItemMutation.mutate(variation.id);
                                    }}
                                  >
                                    <Trash2 className="size-3.5" />
                                  </button>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </Fragment>
                      );
                    })}

                    {parentItems.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="py-10 text-center text-sm text-[#676879]">
                          No items added yet. Start by adding Labor or Materials below.
                        </TableCell>
                      </TableRow>
                    ) : sortedWorkbenchParents.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="py-10 text-center text-sm text-[#676879]">
                          No line items match your search.
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </TableBody>
                </Table>

                <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-[#E6E9EF] bg-white p-5">
                  <div className="flex min-w-0 flex-1 flex-wrap items-stretch gap-3">
                    <div className="flex min-w-[120px] flex-col justify-center rounded-lg border border-[#E6E9EF] bg-[#F5F6F8] px-4 py-2.5">
                      <p className="mb-0.5 text-[11px] font-bold uppercase tracking-wider text-[#676879]">
                        Subtotal
                      </p>
                      <p className="text-lg font-semibold tracking-tight text-[#323338]">
                        {formatCurrency(totals.subtotal)}
                      </p>
                    </div>
                    <div className="flex min-w-[160px] flex-col justify-center rounded-lg border border-[#FDAB3D]/30 bg-[#FDAB3D]/10 px-4 py-2.5">
                      <p className="mb-0.5 text-[11px] font-bold uppercase tracking-wider text-[#676879]">
                        Materials Markup
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-lg font-semibold tracking-tight text-[#323338]">
                          {formatCurrency(totals.markupPreview)}
                        </p>
                        <MaterialMarkupStepper
                          variant="footer"
                          value={materialMarkupPercent}
                          disabled={markupMutation.isPending}
                          onChange={(next) => markupMutation.mutate(next)}
                        />
                      </div>
                    </div>
                    <div className="flex min-w-[120px] flex-col justify-center rounded-lg border border-[#E6E9EF] bg-[#F5F6F8] px-4 py-2.5">
                      <p className="mb-0.5 text-[11px] font-bold uppercase tracking-wider text-[#676879]">
                        GST (10%)
                      </p>
                      <p className="text-lg font-semibold tracking-tight text-[#323338]">
                        {formatCurrency(totals.gst)}
                      </p>
                    </div>
                    <div className="flex min-w-[120px] flex-col justify-center rounded-lg border border-[#0073EA]/20 bg-[#E5F4FF] px-4 py-2.5">
                      <p className="mb-0.5 text-[11px] font-bold uppercase tracking-wider text-[#676879]">
                        Total
                      </p>
                      <p className="text-lg font-semibold tracking-tight text-[#0073EA]">
                        {formatCurrency(totals.total)}
                      </p>
                    </div>
                    <div className="flex min-w-[120px] flex-col justify-center rounded-lg border border-[#A25DDC]/30 bg-[#A25DDC]/10 px-4 py-2.5">
                      <p className="mb-0.5 text-[11px] font-bold uppercase tracking-wider text-[#676879]">
                        Remaining to Bill
                      </p>
                      <p className="text-lg font-semibold tracking-tight text-[#A25DDC]">
                        {formatCurrency(totals.remainingToBill)}
                      </p>
                    </div>
                  </div>

                  <Button
                    type="button"
                    disabled={activeSelectedLineItemIds.length === 0}
                    onClick={handleGenerateDocumentClick}
                    className="w-full shrink-0 whitespace-nowrap rounded-md bg-[#0073EA] px-6 py-2.5 font-medium text-white shadow-sm transition-all duration-150 hover:bg-[#0060B9] active:scale-95 disabled:opacity-50 sm:w-auto md:ml-auto"
                  >
                    Generate Document ({activeSelectedLineItemIds.length})
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="quotes">
            <Card className="bg-white ring-[#E6E9EF]">
              <CardHeader>
                <CardTitle>Quotes</CardTitle>
                <p className="text-sm text-[#676879]">Finalized quote PDFs generated for this job.</p>
              </CardHeader>
              <CardContent>
                <JobFilesExplorer
                  section="quotes"
                  jobId={jobId}
                  ledgerLineItems={visibleItems.filter((item) => item.kind === "material")}
                  documents={documents}
                  files={files}
                  highlightedQuoteId={highlightedQuoteId}
                  jobStatus={job.status}
                  onEditDocument={handleEditDocument}
                  onDeleteDocument={handleDeleteDocument}
                  deletingDocumentId={deletingDocumentId}
                  onUploadReceipt={(file) => uploadReceiptMutation.mutate(file)}
                  onUploadOther={(file) => uploadDocumentMutation.mutate(file)}
                  onUploadSitePhoto={(file) => uploadSitePhotoMutation.mutate(file)}
                  onOpenReceiptWorkbench={(file) => {
                    setReceiptWorkbenchSourceFile(null);
                    setActiveWorkbenchReceipt(file);
                    setReceiptAutoProcess(true);
                  }}
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="invoices">
            <Card className="bg-white ring-[#E6E9EF]">
              <CardHeader>
                <CardTitle>Invoices</CardTitle>
                <p className="text-sm text-[#676879]">Finalized invoice PDFs generated for this job.</p>
              </CardHeader>
              <CardContent>
                <JobFilesExplorer
                  section="invoices"
                  jobId={jobId}
                  ledgerLineItems={visibleItems.filter((item) => item.kind === "material")}
                  documents={documents}
                  files={files}
                  highlightedDocumentId={highlightedDocumentId}
                  jobStatus={job.status}
                  onEditDocument={handleEditDocument}
                  onDeleteDocument={handleDeleteDocument}
                  deletingDocumentId={deletingDocumentId}
                  onUploadReceipt={(file) => uploadReceiptMutation.mutate(file)}
                  onUploadOther={(file) => uploadDocumentMutation.mutate(file)}
                  onUploadSitePhoto={(file) => uploadSitePhotoMutation.mutate(file)}
                  onOpenReceiptWorkbench={(file) => {
                    setReceiptWorkbenchSourceFile(null);
                    setActiveWorkbenchReceipt(file);
                    setReceiptAutoProcess(true);
                  }}
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="receipts">
            <Card className="bg-white ring-[#E6E9EF]">
              <CardHeader>
                <CardTitle>Receipts</CardTitle>
                <p className="text-sm text-[#676879]">
                  Receipt stash and uploads. Drop images or process receipts with AI.
                </p>
              </CardHeader>
              <CardContent>
                <JobFilesExplorer
                  section="receipts"
                  jobId={jobId}
                  ledgerLineItems={visibleItems.filter((item) => item.kind === "material")}
                  documents={documents}
                  files={files}
                  onUploadReceipt={(file) => uploadReceiptMutation.mutate(file)}
                  onUploadOther={(file) => uploadDocumentMutation.mutate(file)}
                  onUploadSitePhoto={(file) => uploadSitePhotoMutation.mutate(file)}
                  onOpenReceiptWorkbench={(file) => {
                    console.log("[Receipt Explorer] Opening receipt workbench", file);
                    setReceiptWorkbenchSourceFile(null);
                    setActiveWorkbenchReceipt(file);
                    setReceiptAutoProcess(true);
                  }}
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="other-docs">
            <Card className="bg-white ring-[#E6E9EF]">
              <CardHeader>
                <CardTitle>Other Docs</CardTitle>
                <p className="text-sm text-[#676879]">Site photos, PDFs, and other files for this job.</p>
              </CardHeader>
              <CardContent>
                <JobFilesExplorer
                  section="other-docs"
                  jobId={jobId}
                  ledgerLineItems={visibleItems.filter((item) => item.kind === "material")}
                  documents={documents}
                  files={files}
                  onUploadReceipt={(file) => uploadReceiptMutation.mutate(file)}
                  onUploadOther={(file) => uploadDocumentMutation.mutate(file)}
                  onUploadSitePhoto={(file) => uploadSitePhotoMutation.mutate(file)}
                  onOpenReceiptWorkbench={(file) => {
                    setReceiptWorkbenchSourceFile(null);
                    setActiveWorkbenchReceipt(file);
                    setReceiptAutoProcess(true);
                  }}
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="job-client">
            <Card className="bg-white ring-[#E6E9EF]">
              <CardHeader>
                <CardTitle>Job &amp; client</CardTitle>
                <p className="text-sm text-[#676879]">
                  Job-specific dates and PO. For company, billing, and document templates, use{" "}
                  <a href="/settings" className="font-medium text-[#0073EA] underline-offset-4 hover:underline">
                    Settings
                  </a>
                  . To edit the linked customer record, open{" "}
                  <a href="/clients" className="font-medium text-[#0073EA] underline-offset-4 hover:underline">
                    Clients
                  </a>
                  .
                </p>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                  <div className="space-y-4">
                    <div>
                      <label className="mb-1 block text-sm font-semibold text-[#323338]">PO Number</label>
                      <Input
                        value={settingsValues.purchaseOrderNumber}
                        onChange={(event) => {
                          setSettingsDraft({
                            ...settingsValues,
                            purchaseOrderNumber: event.target.value,
                          });
                        }}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-semibold text-[#323338]">Start Date</label>
                      <Input
                        type="date"
                        value={settingsValues.startDate}
                        onChange={(event) => {
                          setSettingsDraft({
                            ...settingsValues,
                            startDate: event.target.value,
                          });
                        }}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-semibold text-[#323338]">Target End Date</label>
                      <Input
                        type="date"
                        value={settingsValues.targetEndDate}
                        onChange={(event) => {
                          setSettingsDraft({
                            ...settingsValues,
                            targetEndDate: event.target.value,
                          });
                        }}
                      />
                    </div>
                  </div>

                  <div className="rounded-lg border border-[#D0D4E4] bg-white p-4">
                    <h3 className="text-lg font-semibold">Client Contact</h3>
                    <p className="mt-1 text-[#676879]">{client?.displayName ?? "Unknown client"}</p>
                    <div className="mt-4 space-y-3">
                      <a
                        className="block rounded-lg border border-[#D0D4E4] p-3 text-[#323338] hover:border-[#0073EA]"
                        href={client?.phone ? `tel:${client.phone}` : "#"}
                      >
                        Call: {client?.phone ?? "No phone saved"}
                      </a>
                      <a
                        className="block rounded-lg border border-[#D0D4E4] p-3 text-[#323338] hover:border-[#0073EA]"
                        href={client?.email ? `mailto:${client.email}` : "#"}
                      >
                        Email: {client?.email ?? "No email saved"}
                      </a>
                    </div>
                  </div>
                </div>

                <div className="mt-6 flex justify-end">
                  <Button
                    className="h-11 px-6"
                    onClick={() => {
                      updateSettingsMutation.mutate();
                    }}
                  >
                    Save Settings
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {showAddItemModal && (
          <div
            className="fixed inset-0 z-40 flex items-center justify-center bg-white/75 p-4"
            onClick={(event) => {
              if (event.target === event.currentTarget) {
                setShowAddItemModal(false);
                setAddItemModalEntry(null);
              }
            }}
          >
            <div className="w-full max-w-2xl rounded-lg border border-[#D0D4E4] bg-white p-5">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h3 className="text-xl font-semibold text-[#323338]">
                    {addItemModalEntry === "labor"
                      ? "Add Labor"
                      : addItemModalEntry === "material"
                        ? "Add Material"
                        : "Add line item"}
                  </h3>
                </div>
                <Button
                  variant="secondary"
                  className="h-10 border border-[#C3C6D4] bg-white text-[#323338] hover:bg-white"
                  onClick={() => {
                    setShowAddItemModal(false);
                    setAddItemModalEntry(null);
                  }}
                >
                  Close
                </Button>
              </div>

              <div className="space-y-4 rounded-lg border border-[#D0D4E4] bg-white p-4">
                {addItemModalEntry === null ? (
                  <div className="grid grid-cols-2 gap-2 sm:max-w-sm">
                    <Button
                      variant={newItemKind === "labor" ? "default" : "secondary"}
                      className="h-11 w-full"
                      onClick={() => {
                        setNewItemKind("labor");
                      }}
                    >
                      Labor
                    </Button>
                    <Button
                      variant={newItemKind === "material" ? "default" : "secondary"}
                      className="h-11 w-full"
                      onClick={() => {
                        setNewItemKind("material");
                      }}
                    >
                      Material
                    </Button>
                  </div>
                ) : null}

                <div>
                  <label className="mb-1 block text-sm font-semibold text-[#323338]">Description</label>
                  <Input
                    value={newItemDescription}
                    onChange={(event) => {
                      setNewItemDescription(event.target.value);
                    }}
                    placeholder={
                      newItemKind === "labor"
                        ? "e.g. Plumbing Fix"
                        : "e.g. 90mm PVC Elbow"
                    }
                    className="h-11 border-[#C3C6D4]"
                  />
                </div>

                {newItemKind === "labor" ? (
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div>
                      <label className="mb-1 block text-sm font-semibold text-[#323338]">Rate Type</label>
                      <select
                        value={laborRateType}
                        onChange={(event) => {
                          const value = event.target.value as "builder" | "apprentice";
                          setLaborRateType(value);
                        }}
                        className="h-11 w-full rounded-lg border border-[#C3C6D4] bg-white px-3 text-base text-[#323338]"
                      >
                        <option value="builder">Builder</option>
                        <option value="apprentice">Apprentice</option>
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-semibold text-[#323338]">Hours</label>
                      <Input
                        type="number"
                        inputMode="decimal"
                        value={formatNumberInputValue(laborHours)}
                        onChange={(event) => {
                          handleControlledNumberInputChange(event.target.value, setLaborHours);
                        }}
                        className="h-11 border-[#C3C6D4]"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-semibold text-[#323338]">Hourly Rate ($)</label>
                      <Input
                        type="number"
                        inputMode="decimal"
                        value={formatNumberInputValue(laborHourlyRate)}
                        onChange={(event) => {
                          handleControlledNumberInputChange(event.target.value, setLaborHourlyRate);
                        }}
                        className="h-11 border-[#C3C6D4]"
                      />
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-sm font-semibold text-[#323338]">Cost ($)</label>
                        <Input
                          type="number"
                          inputMode="decimal"
                          value={formatNumberInputValue(materialUnitCostExGst)}
                          onChange={(event) => {
                            handleControlledNumberInputChange(event.target.value, setMaterialUnitCostExGst);
                          }}
                          className="h-11 border-[#C3C6D4]"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-sm font-semibold text-[#323338]">Quantity</label>
                        <Input
                          type="number"
                          inputMode="decimal"
                          value={formatNumberInputValue(materialQuantity)}
                          onChange={(event) => {
                            handleControlledNumberInputChange(event.target.value, setMaterialQuantity);
                          }}
                          className="h-11 border-[#C3C6D4]"
                        />
                      </div>
                    </div>

                    <div className="rounded-lg border border-[#0073EA]/50 bg-[#0073EA]/950/30 p-3">
                      <p className="text-sm font-semibold text-[#0073EA]">Document Preview</p>
                      <p className="mt-1 text-sm text-[#676879]">
                        Raw line subtotal: {formatCurrency(materialPreview.rawSubtotalCents)}
                      </p>
                      <p className="text-sm text-[#676879]">
                        Markup at generation (+{materialMarkupPercent}%):{" "}
                        {formatCurrency(materialPreview.markupCents)}
                      </p>
                      <p className="text-sm text-[#676879]">
                        GST (10%): {formatCurrency(materialPreview.gstCents)}
                      </p>
                      <p className="text-sm font-semibold text-[#323338]">
                        Estimated billed total: {formatCurrency(materialPreview.totalCents)}
                      </p>
                    </div>
                  </>
                )}

                <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <Button
                    variant="secondary"
                    className="h-11 w-full border border-[#C3C6D4] bg-white text-[#323338] hover:bg-white sm:w-auto"
                    onClick={() => {
                      setShowAddItemModal(false);
                      setAddItemModalEntry(null);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    className="h-11 w-full border border-[#0073EA] bg-[#0073EA] font-semibold text-white hover:bg-[#0060B9] sm:w-auto"
                    disabled={addItemMutation.isPending}
                    onClick={() => {
                      addItemMutation.mutate();
                    }}
                  >
                    {addItemMutation.isPending ? "Saving..." : "Save Item"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
