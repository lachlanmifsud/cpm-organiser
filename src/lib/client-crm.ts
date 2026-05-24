import type { Client, Invoice, Job, JobWorkflowStatus } from "@/types/database";

export type ClientDirectoryFilter =
  | "all"
  | "outstanding"
  | "active-leads"
  | "frequent-buyers";

const ACTIVE_LEAD_STATUSES: JobWorkflowStatus[] = ["new", "quoted"];

const BLOCKING_JOB_STATUSES: JobWorkflowStatus[] = [
  "new",
  "quoted",
  "in-progress",
  "invoiced",
];

export function formatClientCurrency(cents: number) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
  }).format(cents / 100);
}

export function isInvoiceUnpaid(invoice: Invoice) {
  return invoice.totalPaidCents < invoice.totalCents;
}

export function computeClientLifetimeBillingCents(
  clientId: string,
  invoices: Invoice[],
) {
  return invoices
    .filter((inv) => inv.clientId === clientId && inv.paymentStatus === "paid")
    .reduce((sum, inv) => sum + inv.totalCents, 0);
}

export function clientHasOutstandingBalance(clientId: string, invoices: Invoice[]) {
  return invoices.some((inv) => inv.clientId === clientId && isInvoiceUnpaid(inv));
}

export function clientHasActiveLeads(clientId: string, jobs: Job[]) {
  return jobs.some(
    (job) =>
      job.clientId === clientId &&
      !job.isArchived &&
      ACTIVE_LEAD_STATUSES.includes(job.status),
  );
}

export function countClientJobs(clientId: string, jobs: Job[]) {
  return jobs.filter((job) => job.clientId === clientId).length;
}

export function getJobOutstandingBalanceCents(jobId: string, invoices: Invoice[]) {
  return invoices
    .filter((inv) => inv.jobId === jobId)
    .reduce((sum, inv) => sum + Math.max(0, inv.totalCents - inv.totalPaidCents), 0);
}

export function countBlockingClientJobs(jobs: Job[]) {
  return jobs.filter(
    (job) => !job.isArchived && BLOCKING_JOB_STATUSES.includes(job.status),
  ).length;
}

export function jobStatusPillClass(status: JobWorkflowStatus) {
  switch (status) {
    case "new":
      return "border-blue-500/35 bg-blue-950/50 text-blue-100";
    case "quoted":
      return "border-cyan-500/35 bg-cyan-950/50 text-cyan-100";
    case "in-progress":
      return "border-amber-400/40 bg-amber-950/45 text-amber-100";
    case "invoiced":
      return "border-violet-500/35 bg-violet-950/50 text-violet-100";
    case "paid":
      return "border-emerald-500/35 bg-emerald-950/45 text-emerald-100";
    default:
      return "border-[#D0D4E4]/35 bg-[#F5F6F8] text-[#676879]";
  }
}

export function jobStatusLabel(status: JobWorkflowStatus) {
  switch (status) {
    case "in-progress":
      return "In Progress";
    default:
      return status.charAt(0).toUpperCase() + status.slice(1);
  }
}

export function formatClientJobDate(date: Date) {
  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function applyClientDirectoryFilter(
  clients: Client[],
  filter: ClientDirectoryFilter,
  jobs: Job[],
  invoices: Invoice[],
) {
  const visible = clients.filter((c) => !c.isArchived);

  switch (filter) {
    case "outstanding":
      return visible.filter((c) => clientHasOutstandingBalance(c.id, invoices));
    case "active-leads":
      return visible.filter((c) => clientHasActiveLeads(c.id, jobs));
    case "frequent-buyers":
      return visible.filter((c) => countClientJobs(c.id, jobs) >= 3);
    default:
      return visible;
  }
}

export const CLIENT_FILTER_OPTIONS: Array<{
  id: ClientDirectoryFilter;
  label: string;
}> = [
  { id: "all", label: "All Clients" },
  { id: "outstanding", label: "Outstanding Balance" },
  { id: "active-leads", label: "Active Leads" },
  { id: "frequent-buyers", label: "Frequent Buyers" },
];
