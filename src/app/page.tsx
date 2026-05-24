"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import {
  Activity,
  Archive,
  ArrowDown,
  ArrowUp,
  CheckCircle,
  ChevronDown,
  Filter,
  Search,
  X,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { CreateJobModal } from "@/components/create-job-modal";
import { ClientDetailSheet } from "@/components/client-detail-sheet";
import { StatusDropdown } from "@/components/status-dropdown";
import { ActionsMenu } from "@/components/actions-menu";
import { AppPageHeader } from "@/components/app-page-header";
import { DashboardJobsTableSkeleton } from "@/components/dashboard-jobs-table-skeleton";
import {
  getActiveJobsByUid,
  getArchivedJobsByUid,
  getCompletedJobsByUid,
  subscribeActiveJobs,
  subscribeArchivedJobs,
  subscribeCompletedJobs,
  updateJobStatus,
  getLineItemsByJobId,
  getClientById,
} from "@/lib/firebase/repository";
import { useAuth } from "@/providers/auth-provider";
import { mondayStatusClass } from "@/lib/monday-theme";
import { Job, JobWorkflowStatus, LineItem, Client } from "@/types/database";

type DashboardView = "active" | "completed" | "archived";

const statusLabel: Record<JobWorkflowStatus, string> = {
  new: "New",
  quoted: "Quoted",
  "in-progress": "In Progress",
  invoiced: "Invoiced",
  paid: "Paid",
};

function statusClass(status: string) {
  return mondayStatusClass(status);
}

function statusText(status: string) {
  if (status === "in_progress") {
    return "In Progress";
  }

  if (status === "partially_paid") {
    return "Invoiced";
  }

  if (status === "completed") {
    return "Paid";
  }

  return statusLabel[status as JobWorkflowStatus] ?? "Unknown";
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-AU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
}

function calculateDaysActive(createdAt: Date, isPaid: boolean): number | null {
  if (isPaid) return null;
  const now = new Date();
  const diffMs = now.getTime() - createdAt.getTime();
  return Math.floor(diffMs / 86400000);
}

function calculateTotal(lineItems: LineItem[]): number {
  const subtotal = lineItems.reduce((sum, item) => sum + item.subtotalCents, 0);
  const markup = Math.round(subtotal * 0.15);
  const subtotalWithMarkup = subtotal + markup;
  const gst = Math.round(subtotalWithMarkup * 0.1);
  return subtotalWithMarkup + gst;
}

type DashboardSortKey =
  | "jobTitle"
  | "client"
  | "status"
  | "createdAt"
  | "modifiedAt"
  | "daysActive"
  | "poNumber"
  | "total";

type DashboardSortDirection = "asc" | "desc" | null;

type DashboardSortConfig = {
  key: DashboardSortKey;
  direction: DashboardSortDirection;
};

function statusSortRank(status: string): number {
  const normalized =
    status === "in_progress"
      ? "in-progress"
      : status === "completed"
        ? "paid"
        : status === "partially_paid"
          ? "invoiced"
          : status;
  const order: Record<string, number> = {
    new: 0,
    quoted: 1,
    "in-progress": 2,
    invoiced: 3,
    paid: 4,
  };
  return order[normalized] ?? 99;
}

function compareDaysActiveColumn(a: JobWithExtra, b: JobWithExtra, asc: boolean): number {
  const da = calculateDaysActive(a.createdAt, a.status === "paid");
  const db = calculateDaysActive(b.createdAt, b.status === "paid");
  const aNull = da === null;
  const bNull = db === null;
  if (aNull && bNull) {
    return 0;
  }
  if (aNull) {
    return 1;
  }
  if (bNull) {
    return -1;
  }
  const cmp = da - db;
  return asc ? cmp : -cmp;
}

function defaultSortDirectionForKey(key: DashboardSortKey): "asc" | "desc" {
  switch (key) {
    case "createdAt":
    case "modifiedAt":
    case "total":
    case "daysActive":
      return "desc";
    default:
      return "asc";
  }
}

function compareJobsForSort(a: JobWithExtra, b: JobWithExtra, config: DashboardSortConfig): number {
  if (config.direction === null) {
    return 0;
  }
  const asc = config.direction === "asc";
  const dir = asc ? 1 : -1;

  switch (config.key) {
    case "jobTitle":
      return dir * a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
    case "client":
      return dir * (a.clientName ?? "").localeCompare(b.clientName ?? "", undefined, { sensitivity: "base" });
    case "status":
      return dir * (statusSortRank(a.status) - statusSortRank(b.status));
    case "createdAt":
      return dir * (a.createdAt.getTime() - b.createdAt.getTime());
    case "modifiedAt":
      return dir * (a.updatedAt.getTime() - b.updatedAt.getTime());
    case "daysActive":
      return compareDaysActiveColumn(a, b, asc);
    case "poNumber":
      return dir * (a.purchaseOrderNumber ?? "").localeCompare(b.purchaseOrderNumber ?? "", undefined, {
        numeric: true,
        sensitivity: "base",
      });
    case "total": {
      const ta = calculateTotal(a.lineItems ?? []);
      const tb = calculateTotal(b.lineItems ?? []);
      return dir * (ta - tb);
    }
    default:
      return 0;
  }
}

interface JobWithExtra extends Job {
  clientName?: string;
  lineItems?: LineItem[];
}

type DateRangeFilter = "all" | "this-month" | "last-30-days" | "custom";

interface FiltersState {
  clientIds: string[];
  statuses: JobWorkflowStatus[];
  dateRange: DateRangeFilter;
  customStartDate: string;
  customEndDate: string;
  minTotal: string;
  maxTotal: string;
  poSearch: string;
}

const INITIAL_FILTERS: FiltersState = {
  clientIds: [],
  statuses: [],
  dateRange: "all",
  customStartDate: "",
  customEndDate: "",
  minTotal: "",
  maxTotal: "",
  poSearch: "",
};

function isFilterActive(filters: FiltersState) {
  return (
    filters.clientIds.length > 0 ||
    filters.statuses.length > 0 ||
    filters.dateRange !== "all" ||
    Boolean(filters.customStartDate) ||
    Boolean(filters.customEndDate) ||
    Boolean(filters.minTotal) ||
    Boolean(filters.maxTotal) ||
    Boolean(filters.poSearch.trim())
  );
}

/** Query keys owned by the dashboard filter ↔ URL sync (order-independent compare). */
const DASHBOARD_URL_KEYS = [
  "client",
  "status",
  "dateRange",
  "start",
  "end",
  "minTotal",
  "maxTotal",
  "po",
] as const;

function normalizeDateRangeFromUrl(value: string | null): DateRangeFilter {
  if (value === "this-month" || value === "last-30-days" || value === "custom") {
    return value;
  }
  return "all";
}

function parseDashboardFiltersFromSearchParams(searchParams: URLSearchParams): FiltersState {
  return {
    clientIds: searchParams.get("client")?.split(",").filter(Boolean) ?? [],
    statuses: (searchParams.get("status")?.split(",").filter(Boolean) ?? []) as JobWorkflowStatus[],
    dateRange: normalizeDateRangeFromUrl(searchParams.get("dateRange")),
    customStartDate: searchParams.get("start") ?? "",
    customEndDate: searchParams.get("end") ?? "",
    minTotal: searchParams.get("minTotal") ?? "",
    maxTotal: searchParams.get("maxTotal") ?? "",
    poSearch: searchParams.get("po") ?? "",
  };
}

function areDashboardFiltersEqual(a: FiltersState, b: FiltersState): boolean {
  return (
    a.dateRange === b.dateRange &&
    a.customStartDate === b.customStartDate &&
    a.customEndDate === b.customEndDate &&
    a.minTotal === b.minTotal &&
    a.maxTotal === b.maxTotal &&
    a.poSearch === b.poSearch &&
    a.clientIds.length === b.clientIds.length &&
    a.clientIds.every((id, i) => id === b.clientIds[i]) &&
    a.statuses.length === b.statuses.length &&
    a.statuses.every((s, i) => s === b.statuses[i])
  );
}

function buildDashboardSearchParams(filters: FiltersState): URLSearchParams {
  const nextParams = new URLSearchParams();

  if (filters.clientIds.length > 0) {
    nextParams.set("client", filters.clientIds.join(","));
  }
  if (filters.statuses.length > 0) {
    nextParams.set("status", filters.statuses.join(","));
  }
  if (filters.dateRange !== "all") {
    nextParams.set("dateRange", filters.dateRange);
  }
  if (filters.customStartDate) {
    nextParams.set("start", filters.customStartDate);
  }
  if (filters.customEndDate) {
    nextParams.set("end", filters.customEndDate);
  }
  if (filters.minTotal) {
    nextParams.set("minTotal", filters.minTotal);
  }
  if (filters.maxTotal) {
    nextParams.set("maxTotal", filters.maxTotal);
  }
  if (filters.poSearch.trim()) {
    nextParams.set("po", filters.poSearch.trim());
  }

  return nextParams;
}

function dashboardSearchParamsMatch(current: URLSearchParams, desired: URLSearchParams): boolean {
  for (const key of DASHBOARD_URL_KEYS) {
    if ((current.get(key) ?? "") !== (desired.get(key) ?? "")) {
      return false;
    }
  }
  for (const key of current.keys()) {
    if (!DASHBOARD_URL_KEYS.includes(key as (typeof DASHBOARD_URL_KEYS)[number])) {
      return false;
    }
  }
  return true;
}

export default function Home() {
  const [showCreateJob, setShowCreateJob] = useState(false);
  const [currentView, setCurrentView] = useState<DashboardView>("active");
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [isClientSheetOpen, setIsClientSheetOpen] = useState(false);
  const [filters, setFilters] = useState<FiltersState>(INITIAL_FILTERS);
  const [clientSearch, setClientSearch] = useState("");
  const [isClientFilterOpen, setIsClientFilterOpen] = useState(false);
  const [isDateFilterOpen, setIsDateFilterOpen] = useState(false);
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const [sortConfig, setSortConfig] = useState<DashboardSortConfig>({
    key: "createdAt",
    direction: "desc",
  });
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { currentUser, isAuthLoading } = useAuth();
  const uid = currentUser?.uid;

  const { data: activeJobs = [], isLoading: isLoadingActiveJobs } = useQuery({
    queryKey: ["active-jobs", uid],
    queryFn: () => getActiveJobsByUid(uid ?? ""),
    enabled: Boolean(uid) && !isAuthLoading,
  });

  const { data: completedJobs = [], isLoading: isLoadingCompletedJobs } = useQuery({
    queryKey: ["completed-jobs", uid],
    queryFn: () => getCompletedJobsByUid(uid ?? ""),
    enabled: Boolean(uid) && !isAuthLoading,
  });

  const { data: archivedJobs = [], isLoading: isLoadingArchivedJobs } = useQuery({
    queryKey: ["archived-jobs", uid],
    queryFn: () => getArchivedJobsByUid(uid ?? ""),
    enabled: Boolean(uid) && !isAuthLoading,
  });

  // Enrich jobs with client names and line items
  const enrichedActiveJobs = useMemo(() => {
    return Promise.all(
      activeJobs.map(async (job) => {
        let clientName = "No Client";
        let lineItems: LineItem[] = [];

        if (job.clientId) {
          try {
            const client = await getClientById(job.clientId);
            if (client) clientName = client.displayName;
          } catch (e) {
            console.error("Failed to fetch client", e);
          }
        }

        try {
          lineItems = await getLineItemsByJobId(job.id, false);
        } catch (e) {
          console.error("Failed to fetch line items", e);
        }

        return { ...job, clientName, lineItems };
      })
    );
  }, [activeJobs]);

  const enrichedCompletedJobs = useMemo(() => {
    return Promise.all(
      completedJobs.map(async (job) => {
        let clientName = "No Client";
        let lineItems: LineItem[] = [];

        if (job.clientId) {
          try {
            const client = await getClientById(job.clientId);
            if (client) clientName = client.displayName;
          } catch (e) {
            console.error("Failed to fetch client", e);
          }
        }

        try {
          lineItems = await getLineItemsByJobId(job.id, false);
        } catch (e) {
          console.error("Failed to fetch line items", e);
        }

        return { ...job, clientName, lineItems };
      })
    );
  }, [completedJobs]);

  const enrichedArchivedJobs = useMemo(() => {
    return Promise.all(
      archivedJobs.map(async (job) => {
        let clientName = "No Client";
        let lineItems: LineItem[] = [];

        if (job.clientId) {
          try {
            const client = await getClientById(job.clientId);
            if (client) clientName = client.displayName;
          } catch (e) {
            console.error("Failed to fetch client", e);
          }
        }

        try {
          lineItems = await getLineItemsByJobId(job.id, false);
        } catch (e) {
          console.error("Failed to fetch line items", e);
        }

        return { ...job, clientName, lineItems };
      })
    );
  }, [archivedJobs]);

  const [displayedJobs, setDisplayedJobs] = useState<JobWithExtra[]>([]);

  useEffect(() => {
    setFilters((previous) => {
      const next = parseDashboardFiltersFromSearchParams(searchParams);
      return areDashboardFiltersEqual(previous, next) ? previous : next;
    });
  }, [searchParams]);

  useEffect(() => {
    const nextParams = buildDashboardSearchParams(filters);

    if (dashboardSearchParamsMatch(searchParams, nextParams)) {
      return;
    }

    const query = nextParams.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [filters, pathname, router, searchParams]);

  useEffect(() => {
    if (!isFiltersOpen) {
      setIsClientFilterOpen(false);
      setIsDateFilterOpen(false);
    }
  }, [isFiltersOpen]);

  useEffect(() => {
    if (currentView === "active") {
      enrichedActiveJobs.then(setDisplayedJobs);
    } else if (currentView === "completed") {
      enrichedCompletedJobs.then(setDisplayedJobs);
    } else {
      enrichedArchivedJobs.then(setDisplayedJobs);
    }
  }, [enrichedActiveJobs, enrichedCompletedJobs, enrichedArchivedJobs, currentView]);

  useEffect(() => {
    if (!uid) {
      return;
    }

    const unsubscribe = subscribeActiveJobs(
      uid,
      (jobs) => {
        queryClient.setQueryData(["active-jobs", uid], jobs);
      },
      () => {
        void queryClient.invalidateQueries({ queryKey: ["active-jobs", uid] });
      },
    );

    return unsubscribe;
  }, [queryClient, uid]);

  useEffect(() => {
    if (!uid) {
      return;
    }

    const unsubscribe = subscribeCompletedJobs(
      uid,
      (jobs) => {
        queryClient.setQueryData(["completed-jobs", uid], jobs);
      },
      () => {
        void queryClient.invalidateQueries({ queryKey: ["completed-jobs", uid] });
      },
    );

    return unsubscribe;
  }, [queryClient, uid]);

  useEffect(() => {
    if (!uid) {
      return;
    }

    const unsubscribe = subscribeArchivedJobs(
      uid,
      (jobs) => {
        queryClient.setQueryData(["archived-jobs", uid], jobs);
      },
      () => {
        void queryClient.invalidateQueries({ queryKey: ["archived-jobs", uid] });
      },
    );

    return unsubscribe;
  }, [queryClient, uid]);

  const updateStatusMutation = useMutation({
    mutationFn: ({ jobId, status }: { jobId: string; status: JobWorkflowStatus }) => {
      return updateJobStatus(jobId, status);
    },
    onSuccess: async (_, variables) => {
      toast.success(`Job status updated to ${statusLabel[variables.status]}`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["active-jobs", uid] }),
        queryClient.invalidateQueries({ queryKey: ["completed-jobs", uid] }),
        queryClient.invalidateQueries({ queryKey: ["archived-jobs", uid] }),
      ]);
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const jobCountByView: Record<DashboardView, number> = {
    active: activeJobs.length,
    completed: completedJobs.length,
    archived: archivedJobs.length,
  };

  const loadingByView: Record<DashboardView, boolean> = {
    active: isLoadingActiveJobs,
    completed: isLoadingCompletedJobs,
    archived: isLoadingArchivedJobs,
  };

  const tableTitleByView: Record<DashboardView, string> = {
    active: "Active Jobs",
    completed: "Paid Jobs",
    archived: "Archived Jobs",
  };

  const viewOptions: Array<{
    id: DashboardView;
    label: string;
    Icon: typeof Activity;
  }> = [
    {
      id: "active",
      label: "Active Jobs",
      Icon: Activity,
    },
    {
      id: "completed",
      label: "Paid Jobs",
      Icon: CheckCircle,
    },
    {
      id: "archived",
      label: "Archived",
      Icon: Archive,
    },
  ];

  const isCurrentViewLoading = loadingByView[currentView];

  const clientOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const job of displayedJobs) {
      if (job.clientId) {
        map.set(job.clientId, job.clientName ?? "Unknown Client");
      }
    }

    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [displayedJobs]);

  const filteredClientOptions = useMemo(() => {
    const query = clientSearch.trim().toLowerCase();
    if (!query) {
      return clientOptions;
    }

    return clientOptions.filter((client) =>
      client.name.toLowerCase().includes(query),
    );
  }, [clientOptions, clientSearch]);

  const filteredJobs = useMemo(() => {
    return displayedJobs.filter((job) => {
      const totalCents = calculateTotal(job.lineItems ?? []);
      const poText = (job.purchaseOrderNumber ?? "").toLowerCase();

      if (filters.clientIds.length > 0 && (!job.clientId || !filters.clientIds.includes(job.clientId))) {
        return false;
      }

      if (filters.statuses.length > 0 && !filters.statuses.includes(job.status)) {
        return false;
      }

      if (filters.poSearch.trim() && !poText.includes(filters.poSearch.trim().toLowerCase())) {
        return false;
      }

      if (filters.minTotal.trim()) {
        const minCents = Math.round(Number(filters.minTotal) * 100);
        if (!Number.isNaN(minCents) && totalCents < minCents) {
          return false;
        }
      }

      if (filters.maxTotal.trim()) {
        const maxCents = Math.round(Number(filters.maxTotal) * 100);
        if (!Number.isNaN(maxCents) && totalCents > maxCents) {
          return false;
        }
      }

      const createdAt = job.createdAt;
      const today = new Date();

      if (filters.dateRange === "this-month") {
        if (
          createdAt.getFullYear() !== today.getFullYear() ||
          createdAt.getMonth() !== today.getMonth()
        ) {
          return false;
        }
      }

      if (filters.dateRange === "last-30-days") {
        const thirtyDaysAgo = new Date(today);
        thirtyDaysAgo.setDate(today.getDate() - 30);
        if (createdAt < thirtyDaysAgo || createdAt > today) {
          return false;
        }
      }

      if (filters.dateRange === "custom") {
        if (filters.customStartDate) {
          const startDate = new Date(`${filters.customStartDate}T00:00:00`);
          if (createdAt < startDate) {
            return false;
          }
        }

        if (filters.customEndDate) {
          const endDate = new Date(`${filters.customEndDate}T23:59:59`);
          if (createdAt > endDate) {
            return false;
          }
        }
      }

      return true;
    });
  }, [displayedJobs, filters]);

  useEffect(() => {
    setSortConfig({ key: "createdAt", direction: "desc" });
  }, [currentView]);

  const sortedJobs = useMemo(() => {
    const rows = [...filteredJobs];
    if (sortConfig.direction === null) {
      return rows;
    }
    rows.sort((a, b) => {
      const primary = compareJobsForSort(a, b, sortConfig);
      if (primary !== 0) {
        return primary;
      }
      return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
    });
    return rows;
  }, [filteredJobs, sortConfig]);

  const handleSortHeader = (nextKey: DashboardSortKey) => {
    setSortConfig((prev) => {
      if (prev.key !== nextKey) {
        return { key: nextKey, direction: defaultSortDirectionForKey(nextKey) };
      }
      if (prev.direction === "asc") {
        return { key: nextKey, direction: "desc" };
      }
      if (prev.direction === "desc") {
        return { key: nextKey, direction: "asc" };
      }
      return { key: nextKey, direction: defaultSortDirectionForKey(nextKey) };
    });
  };

  return (
    <div className="flex min-h-screen flex-col bg-[#F5F6F8] text-[#323338]">
      {showCreateJob && (
        <CreateJobModal onClose={() => setShowCreateJob(false)} />
      )}

      <ClientDetailSheet
        isOpen={isClientSheetOpen}
        onClose={() => setIsClientSheetOpen(false)}
        clientId={selectedClientId}
      />

      <main className="mx-auto flex w-full max-w-[2000px] flex-1 flex-col px-6 py-10 lg:px-10">
        <AppPageHeader
          title="Dashboard"
          description="Track, bill, and manage active trade operations"
          action={
            <Button
              className="rounded-md border border-[#0073EA] bg-[#0073EA] px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#0060B9] active:scale-95"
              onClick={() => setShowCreateJob(true)}
            >
              New Job
            </Button>
          }
        />

        <div className="flex flex-col gap-8 pt-6">
        <section className="rounded-lg border border-[#E6E9EF] bg-white p-4 shadow-monday-1 ring-1 ring-[#E6E9EF]">
          <div className="grid gap-3 sm:grid-cols-3">
            {viewOptions.map((view) => {
              const Icon = view.Icon;
              const isSelected = currentView === view.id;

              return (
                <button
                  key={view.id}
                  type="button"
                  onClick={() => {
                    setCurrentView(view.id);
                  }}
                  className={`flex h-12 items-center justify-between rounded-lg border px-4 text-left transition ${isSelected
                    ? "border-[#0073EA] bg-[#0073EA] text-white"
                    : "border-[#D0D4E4] bg-white text-[#323338] hover:bg-white"}`}
                >
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    <Icon className="h-4 w-4" />
                    {view.label}
                  </span>
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${isSelected
                    ? "border-black/60 text-white"
                    : "border-[#D0D4E4] text-[#323338]"}`}
                  >
                    {jobCountByView[view.id]}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="overflow-visible rounded-lg bg-white shadow-monday-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-[#323338]">{tableTitleByView[currentView]}</h2>
              <p className="mt-1 text-sm text-[#676879]">
                {filteredJobs.length} shown · {jobCountByView[currentView]} total
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsFiltersOpen((o) => !o)}
              className={cn(
                "inline-flex h-10 shrink-0 items-center gap-2 rounded-lg px-4 text-sm font-medium transition-all duration-150",
                isFiltersOpen
                  ? "bg-[#F5F6F8] text-[#323338] ring-1 ring-[#E6E9EF]"
                  : "bg-white text-[#323338] hover:bg-[#F5F6F8]",
              )}
            >
              <Filter className="h-4 w-4 text-[#0073EA]" aria-hidden />
              Filters
              {isFilterActive(filters) ? (
                <span className="rounded-full bg-[#0073EA] px-2 py-0.5 text-[10px] font-semibold uppercase text-white">
                  On
                </span>
              ) : null}
              <ChevronDown
                className={cn("h-4 w-4 text-[#676879] transition-transform duration-300", isFiltersOpen && "rotate-180")}
                aria-hidden
              />
            </button>
          </div>

          <div
            className={cn(
              "transition-all duration-300 ease-out",
              isFiltersOpen
                ? "pointer-events-auto mt-4 max-h-[720px] opacity-100"
                : "pointer-events-none max-h-0 overflow-hidden opacity-0",
            )}
          >
            <div className="flex flex-wrap items-center gap-2 border-t border-[#E6E9EF] pt-4">
              <div className="relative">
                <Button
                  type="button"
                  variant="secondary"
                  className="h-9 rounded-lg bg-white text-[#323338] ring-1 ring-[#E6E9EF] hover:bg-[#F5F6F8]"
                  onClick={() => {
                    setIsClientFilterOpen((prev) => !prev);
                    setIsDateFilterOpen(false);
                  }}
                >
                  Client
                  {filters.clientIds.length > 0 && (
                    <span className="ml-2 rounded-full bg-[#0073EA] px-2 py-0.5 text-xs text-white">
                      {filters.clientIds.length}
                    </span>
                  )}
                  <ChevronDown className="ml-2 h-4 w-4" />
                </Button>

                {isClientFilterOpen && (
                  <div className="absolute left-0 top-11 z-40 w-80 rounded-lg bg-white p-3 shadow-monday-2 ring-1 ring-[#E6E9EF] backdrop-blur-md">
                    <div className="mb-2 flex items-center gap-2 rounded-lg bg-[#F5F6F8] px-2 ring-1 ring-[#E6E9EF]">
                      <Search className="h-4 w-4 text-[#676879]" />
                      <input
                        value={clientSearch}
                        onChange={(event) => {
                          setClientSearch(event.target.value);
                        }}
                        placeholder="Search clients..."
                        className="h-9 w-full bg-transparent text-sm text-[#323338] outline-none"
                      />
                    </div>

                    <div className="max-h-56 space-y-1 overflow-y-auto">
                      {filteredClientOptions.map((client) => {
                        const checked = filters.clientIds.includes(client.id);
                        return (
                          <label
                            key={client.id}
                            className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-[#F5F6F8]"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                setFilters((prev) => ({
                                  ...prev,
                                  clientIds: checked
                                    ? prev.clientIds.filter((id) => id !== client.id)
                                    : [...prev.clientIds, client.id],
                                }));
                              }}
                              className="h-4 w-4 accent-[#0073EA]"
                            />
                            <span className="text-sm text-[#323338]">{client.name}</span>
                          </label>
                        );
                      })}

                      {filteredClientOptions.length === 0 && (
                        <div className="px-2 py-3 text-sm text-[#676879]">No clients found</div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex h-9 flex-wrap items-center gap-0.5 rounded-lg bg-white px-1 py-0.5 ring-1 ring-[#E6E9EF]">
                {(["new", "quoted", "in-progress", "invoiced", "paid"] as JobWorkflowStatus[]).map((status) => {
                  const selected = filters.statuses.includes(status);
                  return (
                    <button
                      key={status}
                      type="button"
                      onClick={() => {
                        setFilters((prev) => ({
                          ...prev,
                          statuses: selected
                            ? prev.statuses.filter((value) => value !== status)
                            : [...prev.statuses, status],
                        }));
                      }}
                      className={`rounded-lg px-2 py-1 text-xs font-semibold transition ${selected
                        ? "bg-[#0073EA] text-white"
                        : "text-[#676879] hover:bg-white/[0.06]"}`}
                    >
                      {statusText(status)}
                    </button>
                  );
                })}
              </div>

              <div className="relative">
                <Button
                  type="button"
                  variant="secondary"
                  className="h-9 rounded-lg bg-white text-[#323338] ring-1 ring-[#E6E9EF] hover:bg-[#F5F6F8]"
                  onClick={() => {
                    setIsDateFilterOpen((prev) => !prev);
                    setIsClientFilterOpen(false);
                  }}
                >
                  Created Date
                  <ChevronDown className="ml-2 h-4 w-4" />
                </Button>

                {isDateFilterOpen && (
                  <div className="absolute left-0 top-11 z-40 w-72 rounded-lg bg-white p-3 shadow-monday-2 ring-1 ring-[#E6E9EF] backdrop-blur-md">
                    <select
                      value={filters.dateRange}
                      onChange={(event) => {
                        const value = event.target.value as DateRangeFilter;
                        setFilters((prev) => ({
                          ...prev,
                          dateRange: value,
                        }));
                      }}
                      className="h-9 w-full rounded-lg bg-[#F5F6F8] px-3 text-sm text-[#323338] outline-none ring-1 ring-[#E6E9EF]"
                    >
                      <option value="all">All Time</option>
                      <option value="this-month">This Month</option>
                      <option value="last-30-days">Last 30 Days</option>
                      <option value="custom">Custom Range</option>
                    </select>

                    {filters.dateRange === "custom" && (
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <input
                          type="date"
                          value={filters.customStartDate}
                          onChange={(event) => {
                            setFilters((prev) => ({
                              ...prev,
                              customStartDate: event.target.value,
                            }));
                          }}
                          className="h-9 rounded-lg bg-[#F5F6F8] px-2 text-sm text-[#323338] outline-none ring-1 ring-[#E6E9EF]"
                        />
                        <input
                          type="date"
                          value={filters.customEndDate}
                          onChange={(event) => {
                            setFilters((prev) => ({
                              ...prev,
                              customEndDate: event.target.value,
                            }));
                          }}
                          className="h-9 rounded-lg bg-[#F5F6F8] px-2 text-sm text-[#323338] outline-none ring-1 ring-[#E6E9EF]"
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>

              <Input
                value={filters.minTotal}
                onChange={(event) => {
                  setFilters((prev) => ({
                    ...prev,
                    minTotal: event.target.value,
                  }));
                }}
                type="number"
                min="0"
                placeholder="Min $"
                className="h-9 w-24 rounded-lg border-0 bg-white text-[#323338] ring-1 ring-[#E6E9EF] placeholder:text-[#676879]"
              />

              <Input
                value={filters.maxTotal}
                onChange={(event) => {
                  setFilters((prev) => ({
                    ...prev,
                    maxTotal: event.target.value,
                  }));
                }}
                type="number"
                min="0"
                placeholder="Max $"
                className="h-9 w-24 rounded-lg border-0 bg-white text-[#323338] ring-1 ring-[#E6E9EF] placeholder:text-[#676879]"
              />

              <div className="flex h-9 items-center gap-2 rounded-lg bg-white px-3 ring-1 ring-[#E6E9EF]">
                <Search className="h-4 w-4 text-[#676879]" />
                <input
                  value={filters.poSearch}
                  onChange={(event) => {
                    setFilters((prev) => ({
                      ...prev,
                      poSearch: event.target.value,
                    }));
                  }}
                  placeholder="PO Number"
                  className="w-36 min-w-0 bg-transparent text-sm text-[#323338] outline-none placeholder:text-[#676879] sm:w-40"
                />
              </div>

              {isFilterActive(filters) && (
                <Button
                  type="button"
                  variant="secondary"
                  className="h-9 rounded-lg border-0 bg-[#E2445C]/10 text-[#E2445C] ring-1 ring-[#E2445C]/25 hover:bg-[#E2445C]/15"
                  onClick={() => {
                    setFilters(INITIAL_FILTERS);
                    setClientSearch("");
                  }}
                >
                  <X className="mr-1 h-4 w-4" />
                  Clear All Filters
                </Button>
              )}
            </div>
          </div>

          <div className="mt-8 min-h-[220px] overflow-x-auto overflow-y-visible">
            <table className="w-full min-w-[960px] table-fixed border-separate border-spacing-0 text-left">
              <thead>
                <tr>
                  <th className="border-b border-[#E6E9EF] px-4 py-3 sm:px-5">
                    <button
                      type="button"
                      onClick={() => handleSortHeader("jobTitle")}
                      className={cn(
                        "group inline-flex w-full items-center gap-1.5 text-left text-xs font-semibold uppercase tracking-wider transition-colors",
                        sortConfig.key === "jobTitle" && sortConfig.direction !== null
                          ? "text-[#323338]"
                          : "text-[#676879] hover:text-[#676879]",
                      )}
                    >
                      Job title
                      {sortConfig.key === "jobTitle" && sortConfig.direction !== null ? (
                        sortConfig.direction === "asc" ? (
                          <ArrowUp className="h-3.5 w-3.5 shrink-0 text-[#0073EA]" aria-hidden />
                        ) : (
                          <ArrowDown className="h-3.5 w-3.5 shrink-0 text-[#0073EA]" aria-hidden />
                        )
                      ) : (
                        <span className="flex shrink-0 flex-col opacity-25 group-hover:opacity-50" aria-hidden>
                          <ArrowUp className="h-2 w-2 -mb-0.5" />
                          <ArrowDown className="h-2 w-2" />
                        </span>
                      )}
                    </button>
                  </th>
                  <th className="border-b border-[#E6E9EF] px-4 py-3 sm:px-5">
                    <button
                      type="button"
                      onClick={() => handleSortHeader("client")}
                      className={cn(
                        "group inline-flex w-full items-center gap-1.5 text-left text-xs font-semibold uppercase tracking-wider transition-colors",
                        sortConfig.key === "client" && sortConfig.direction !== null
                          ? "text-[#323338]"
                          : "text-[#676879] hover:text-[#676879]",
                      )}
                    >
                      Client
                      {sortConfig.key === "client" && sortConfig.direction !== null ? (
                        sortConfig.direction === "asc" ? (
                          <ArrowUp className="h-3.5 w-3.5 shrink-0 text-[#0073EA]" aria-hidden />
                        ) : (
                          <ArrowDown className="h-3.5 w-3.5 shrink-0 text-[#0073EA]" aria-hidden />
                        )
                      ) : (
                        <span className="flex shrink-0 flex-col opacity-25 group-hover:opacity-50" aria-hidden>
                          <ArrowUp className="h-2 w-2 -mb-0.5" />
                          <ArrowDown className="h-2 w-2" />
                        </span>
                      )}
                    </button>
                  </th>
                  <th className="border-b border-[#E6E9EF] px-4 py-3 sm:px-5">
                    <button
                      type="button"
                      onClick={() => handleSortHeader("status")}
                      className={cn(
                        "group inline-flex w-full items-center gap-1.5 text-left text-xs font-semibold uppercase tracking-wider transition-colors",
                        sortConfig.key === "status" && sortConfig.direction !== null
                          ? "text-[#323338]"
                          : "text-[#676879] hover:text-[#676879]",
                      )}
                    >
                      Status
                      {sortConfig.key === "status" && sortConfig.direction !== null ? (
                        sortConfig.direction === "asc" ? (
                          <ArrowUp className="h-3.5 w-3.5 shrink-0 text-[#0073EA]" aria-hidden />
                        ) : (
                          <ArrowDown className="h-3.5 w-3.5 shrink-0 text-[#0073EA]" aria-hidden />
                        )
                      ) : (
                        <span className="flex shrink-0 flex-col opacity-25 group-hover:opacity-50" aria-hidden>
                          <ArrowUp className="h-2 w-2 -mb-0.5" />
                          <ArrowDown className="h-2 w-2" />
                        </span>
                      )}
                    </button>
                  </th>
                  <th className="border-b border-[#E6E9EF] px-4 py-3 sm:px-5">
                    <button
                      type="button"
                      onClick={() => handleSortHeader("createdAt")}
                      className={cn(
                        "group inline-flex w-full items-center gap-1.5 text-left text-xs font-semibold uppercase tracking-wider transition-colors",
                        sortConfig.key === "createdAt" && sortConfig.direction !== null
                          ? "text-[#323338]"
                          : "text-[#676879] hover:text-[#676879]",
                      )}
                    >
                      Created
                      {sortConfig.key === "createdAt" && sortConfig.direction !== null ? (
                        sortConfig.direction === "asc" ? (
                          <ArrowUp className="h-3.5 w-3.5 shrink-0 text-[#0073EA]" aria-hidden />
                        ) : (
                          <ArrowDown className="h-3.5 w-3.5 shrink-0 text-[#0073EA]" aria-hidden />
                        )
                      ) : (
                        <span className="flex shrink-0 flex-col opacity-25 group-hover:opacity-50" aria-hidden>
                          <ArrowUp className="h-2 w-2 -mb-0.5" />
                          <ArrowDown className="h-2 w-2" />
                        </span>
                      )}
                    </button>
                  </th>
                  <th className="border-b border-[#E6E9EF] px-4 py-3 sm:px-5">
                    <button
                      type="button"
                      onClick={() => handleSortHeader("modifiedAt")}
                      className={cn(
                        "group inline-flex w-full items-center gap-1.5 text-left text-xs font-semibold uppercase tracking-wider transition-colors",
                        sortConfig.key === "modifiedAt" && sortConfig.direction !== null
                          ? "text-[#323338]"
                          : "text-[#676879] hover:text-[#676879]",
                      )}
                    >
                      Modified
                      {sortConfig.key === "modifiedAt" && sortConfig.direction !== null ? (
                        sortConfig.direction === "asc" ? (
                          <ArrowUp className="h-3.5 w-3.5 shrink-0 text-[#0073EA]" aria-hidden />
                        ) : (
                          <ArrowDown className="h-3.5 w-3.5 shrink-0 text-[#0073EA]" aria-hidden />
                        )
                      ) : (
                        <span className="flex shrink-0 flex-col opacity-25 group-hover:opacity-50" aria-hidden>
                          <ArrowUp className="h-2 w-2 -mb-0.5" />
                          <ArrowDown className="h-2 w-2" />
                        </span>
                      )}
                    </button>
                  </th>
                  <th className="border-b border-[#E6E9EF] px-4 py-3 sm:px-5">
                    <button
                      type="button"
                      onClick={() => handleSortHeader("daysActive")}
                      className={cn(
                        "group inline-flex w-full items-center gap-1.5 text-left text-xs font-semibold uppercase tracking-wider transition-colors",
                        sortConfig.key === "daysActive" && sortConfig.direction !== null
                          ? "text-[#323338]"
                          : "text-[#676879] hover:text-[#676879]",
                      )}
                    >
                      Days active
                      {sortConfig.key === "daysActive" && sortConfig.direction !== null ? (
                        sortConfig.direction === "asc" ? (
                          <ArrowUp className="h-3.5 w-3.5 shrink-0 text-[#0073EA]" aria-hidden />
                        ) : (
                          <ArrowDown className="h-3.5 w-3.5 shrink-0 text-[#0073EA]" aria-hidden />
                        )
                      ) : (
                        <span className="flex shrink-0 flex-col opacity-25 group-hover:opacity-50" aria-hidden>
                          <ArrowUp className="h-2 w-2 -mb-0.5" />
                          <ArrowDown className="h-2 w-2" />
                        </span>
                      )}
                    </button>
                  </th>
                  <th className="border-b border-[#E6E9EF] px-4 py-3 sm:px-5">
                    <button
                      type="button"
                      onClick={() => handleSortHeader("poNumber")}
                      className={cn(
                        "group inline-flex w-full items-center gap-1.5 text-left text-xs font-semibold uppercase tracking-wider transition-colors",
                        sortConfig.key === "poNumber" && sortConfig.direction !== null
                          ? "text-[#323338]"
                          : "text-[#676879] hover:text-[#676879]",
                      )}
                    >
                      PO number
                      {sortConfig.key === "poNumber" && sortConfig.direction !== null ? (
                        sortConfig.direction === "asc" ? (
                          <ArrowUp className="h-3.5 w-3.5 shrink-0 text-[#0073EA]" aria-hidden />
                        ) : (
                          <ArrowDown className="h-3.5 w-3.5 shrink-0 text-[#0073EA]" aria-hidden />
                        )
                      ) : (
                        <span className="flex shrink-0 flex-col opacity-25 group-hover:opacity-50" aria-hidden>
                          <ArrowUp className="h-2 w-2 -mb-0.5" />
                          <ArrowDown className="h-2 w-2" />
                        </span>
                      )}
                    </button>
                  </th>
                  <th className="border-b border-[#E6E9EF] px-4 py-3 sm:px-5">
                    <button
                      type="button"
                      onClick={() => handleSortHeader("total")}
                      className={cn(
                        "group inline-flex w-full items-center gap-1.5 text-left text-xs font-semibold uppercase tracking-wider transition-colors",
                        sortConfig.key === "total" && sortConfig.direction !== null
                          ? "text-[#323338]"
                          : "text-[#676879] hover:text-[#676879]",
                      )}
                    >
                      Total (inc GST)
                      {sortConfig.key === "total" && sortConfig.direction !== null ? (
                        sortConfig.direction === "asc" ? (
                          <ArrowUp className="h-3.5 w-3.5 shrink-0 text-[#0073EA]" aria-hidden />
                        ) : (
                          <ArrowDown className="h-3.5 w-3.5 shrink-0 text-[#0073EA]" aria-hidden />
                        )
                      ) : (
                        <span className="flex shrink-0 flex-col opacity-25 group-hover:opacity-50" aria-hidden>
                          <ArrowUp className="h-2 w-2 -mb-0.5" />
                          <ArrowDown className="h-2 w-2" />
                        </span>
                      )}
                    </button>
                  </th>
                  <th
                    scope="col"
                    className="border-b border-[#E6E9EF] px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-[#676879] sm:px-5"
                  >
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {(isAuthLoading || isCurrentViewLoading) && <DashboardJobsTableSkeleton />}

                {sortedJobs.map((job) => {
                  const daysActive = calculateDaysActive(job.createdAt, job.status === "paid");
                  const total = calculateTotal(job.lineItems || []);
                  const totalInDollars = (total / 100).toFixed(2);

                  return (
                    <tr
                      key={job.id}
                      className="border-b border-[#E6E9EF] bg-white transition-colors duration-150 ease-in-out hover:bg-[#F5F6F8]"
                    >
                      <td className="px-4 py-5 align-middle text-sm font-semibold text-[#323338] sm:px-5">
                        <Link href={`/jobs/${job.id}`} className="underline-offset-2 hover:underline">
                          {job.title}
                        </Link>
                      </td>
                      <td className="px-4 py-5 align-middle text-sm text-[#676879] sm:px-5">
                        <button
                          type="button"
                          onClick={() => {
                            if (job.clientId) {
                              setSelectedClientId(job.clientId);
                              setIsClientSheetOpen(true);
                            }
                          }}
                          className={
                            job.clientId
                              ? "cursor-pointer text-left text-[#0073EA] underline-offset-2 hover:underline"
                              : "text-left text-[#676879]"
                          }
                        >
                          {job.clientName || "No Client"}
                        </button>
                      </td>
                      <td className="overflow-visible px-4 py-5 align-middle sm:px-5">
                        <div className="max-w-[200px] overflow-visible">
                          <StatusDropdown
                            status={job.status}
                            onStatusChange={(newStatus) => {
                              updateStatusMutation.mutate({ jobId: job.id, status: newStatus });
                            }}
                            disabled={updateStatusMutation.isPending}
                          />
                        </div>
                      </td>
                      <td className="px-4 py-5 align-middle text-sm text-[#676879] sm:px-5">{formatDate(job.createdAt)}</td>
                      <td className="px-4 py-5 align-middle text-sm text-[#676879] sm:px-5">
                        {formatRelativeTime(job.updatedAt)}
                      </td>
                      <td className="px-4 py-5 align-middle text-sm text-[#676879] sm:px-5">
                        {daysActive !== null ? `${daysActive} days` : "—"}
                      </td>
                      <td className="px-4 py-5 align-middle text-sm text-[#676879] sm:px-5">
                        {job.purchaseOrderNumber || "—"}
                      </td>
                      <td className="px-4 py-5 align-middle text-sm font-semibold tabular-nums text-[#323338] sm:px-5">
                        ${totalInDollars}
                      </td>
                      <td className="px-4 py-5 align-middle sm:px-5">
                        <div className="flex justify-end">
                          <ActionsMenu
                            jobId={job.id}
                            isArchived={job.isArchived}
                            onArchiveChange={() => {
                              void queryClient.invalidateQueries({
                                queryKey: ["active-jobs", uid],
                              });
                              void queryClient.invalidateQueries({
                                queryKey: ["archived-jobs", uid],
                              });
                            }}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {!isAuthLoading && !isCurrentViewLoading && sortedJobs.length === 0 && (
                  <tr className="border-b border-[#E6E9EF]">
                    <td className="px-4 py-5 text-[#676879] sm:px-5" colSpan={9}>
                      {isFilterActive(filters) ? (
                        <div className="flex flex-wrap items-center justify-between gap-4">
                          <span>No jobs match your filters.</span>
                          <Button
                            type="button"
                            variant="secondary"
                            className="h-8 rounded-lg border-0 bg-white px-3 text-xs text-[#323338] ring-1 ring-[#E6E9EF] hover:bg-[#F5F6F8]"
                            onClick={() => {
                              setFilters(INITIAL_FILTERS);
                              setClientSearch("");
                            }}
                          >
                            Reset
                          </Button>
                        </div>
                      ) : (
                        <>
                          {currentView === "active" && "No active jobs found."}
                          {currentView === "completed" && "No paid jobs found."}
                          {currentView === "archived" && "No archived jobs found."}
                        </>
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
        </div>
      </main>
    </div>
  );
}
