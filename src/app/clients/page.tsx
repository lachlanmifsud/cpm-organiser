"use client";

import { useMemo, useState } from "react";
import { Mail, Phone, Search, User } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { AppHeaderBackLink, AppPageHeader } from "@/components/app-page-header";
import { ClientsDirectorySkeleton } from "@/components/clients-directory-skeleton";
import { ClientDetailSheet } from "@/components/client-detail-sheet";
import { Input } from "@/components/ui/input";
import {
  applyClientDirectoryFilter,
  CLIENT_FILTER_OPTIONS,
  clientHasOutstandingBalance,
  countClientJobs,
  type ClientDirectoryFilter,
} from "@/lib/client-crm";
import { getAllJobsByUid, getClients, getInvoicesByUid } from "@/lib/firebase/repository";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/auth-provider";
import type { Client } from "@/types/database";

export default function ClientsPage() {
  const { currentUser, isAuthLoading } = useAuth();
  const uid = currentUser?.uid;
  const [search, setSearch] = useState("");
  const [directoryFilter, setDirectoryFilter] = useState<ClientDirectoryFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const { data: clients = [], isLoading: clientsLoading } = useQuery({
    queryKey: ["clients", uid],
    queryFn: getClients,
    enabled: Boolean(uid) && !isAuthLoading,
  });

  const { data: jobs = [], isLoading: jobsLoading } = useQuery({
    queryKey: ["crm-jobs", uid],
    queryFn: () => getAllJobsByUid(uid ?? ""),
    enabled: Boolean(uid) && !isAuthLoading,
  });

  const { data: invoices = [], isLoading: invoicesLoading } = useQuery({
    queryKey: ["crm-invoices", uid],
    queryFn: () => getInvoicesByUid(uid ?? ""),
    enabled: Boolean(uid) && !isAuthLoading,
  });

  const isLoading = clientsLoading || jobsLoading || invoicesLoading;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = applyClientDirectoryFilter(clients, directoryFilter, jobs, invoices);

    if (q) {
      rows = rows.filter((c: Client) => {
        const hay = [c.displayName, c.legalName, c.email, c.phone, c.notes, c.defaultPurchaseOrderNumber]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
    }

    return rows;
  }, [clients, directoryFilter, jobs, invoices, search]);

  return (
    <div className="flex min-h-screen flex-col bg-[#F5F6F8] text-[#323338]">
      <ClientDetailSheet
        isOpen={sheetOpen}
        onClose={() => {
          setSheetOpen(false);
          setSelectedId(null);
        }}
        clientId={selectedId}
      />

      <main className="mx-auto flex w-full max-w-[2000px] flex-1 flex-col px-6 py-10 lg:px-10">
        <AppPageHeader
          title="Clients"
          description="CRM directory with job history, billing intelligence, and safe archival guardrails."
          action={<AppHeaderBackLink />}
        />

        <div className="flex flex-col gap-6 pt-6">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#676879]" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, company, phone, or email…"
            className="h-11 border-[#E6E9EF]/80 bg-white/40 pl-10 text-white placeholder:text-[#676879] focus-visible:border-[#0073EA]/500/40"
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          {CLIENT_FILTER_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setDirectoryFilter(option.id)}
              className={cn(
                "rounded-lg px-3 py-1.5 font-medium transition-colors",
                directoryFilter === option.id
                  ? "bg-[#0073EA]/15 text-[#0073EA]"
                  : "text-[#676879] hover:bg-white hover:text-[#676879]",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        {isLoading || isAuthLoading ? (
          <ClientsDirectorySkeleton />
        ) : filtered.length === 0 ? (
          <p className="py-12 text-center text-sm text-[#676879]">
            {clients.length === 0
              ? "No clients yet. Create a job with a client to get started."
              : "No clients match this search or filter."}
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {filtered.map((client: Client) => {
              const jobCount = countClientJobs(client.id, jobs);
              const hasOutstanding = clientHasOutstandingBalance(client.id, invoices);

              return (
                <li key={client.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedId(client.id);
                      setSheetOpen(true);
                    }}
                    className="group flex h-full w-full flex-col rounded-lg bg-[#F5F6F8]0 p-4 text-left transition-all duration-150 hover:scale-[1.005] hover:bg-white hover:shadow-monday-1 hover:shadow-black/20"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[#0073EA]/15 text-[#0073EA]">
                        <User className="size-5" aria-hidden />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold text-[#323338]">{client.displayName}</p>
                        {client.legalName ? (
                          <p className="truncate text-xs text-[#676879]">{client.legalName}</p>
                        ) : null}
                      </div>
                      {hasOutstanding ? (
                        <span className="shrink-0 rounded-md border border-amber-500/30 bg-amber-950/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-200">
                          Due
                        </span>
                      ) : null}
                    </div>

                    <div className="mt-3 space-y-1.5 text-sm text-[#676879]">
                      {client.phone ? (
                        <p className="flex items-center gap-2 truncate">
                          <Phone className="size-3.5 shrink-0 text-[#676879]" />
                          {client.phone}
                        </p>
                      ) : null}
                      {client.email ? (
                        <p className="flex items-center gap-2 truncate">
                          <Mail className="size-3.5 shrink-0 text-[#676879]" />
                          {client.email}
                        </p>
                      ) : null}
                      {!client.phone && !client.email ? (
                        <p className="text-xs text-zinc-600">Tap to open profile</p>
                      ) : null}
                    </div>

                    <p className="mt-3 font-mono text-xs text-[#676879]">
                      {jobCount} {jobCount === 1 ? "job" : "jobs"}
                      {jobCount >= 3 ? (
                        <span className="ml-2 text-[#0073EA]">· Frequent</span>
                      ) : null}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        </div>
      </main>
    </div>
  );
}
