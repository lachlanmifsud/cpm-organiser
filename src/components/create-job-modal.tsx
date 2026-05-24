"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClientProfileFormFields } from "@/components/client-profile-form-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  countJobsByClientId,
  createClient,
  createJob,
  getClients,
  type CreateClientInput,
  type CreateJobInput,
} from "@/lib/firebase/repository";
import {
  CLIENT_FIELD_INPUT,
  clientFormToCreateInput,
  createEmptyClientFormState,
  formatSiteAddressOption,
  resolveClientSiteAddresses,
  siteAddressToPostal,
  type ClientFormState,
} from "@/lib/client-addresses";
import { formatSequentialPoNumber, poPrefixFromDisplayName } from "@/lib/jobs/auto-po";
import { cn } from "@/lib/utils";
import type { Client } from "@/types/database";

type ModalStep = "job" | "new-client";

function FieldRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm text-[#676879]">{label}</label>
      {children}
    </div>
  );
}

function formatLocalYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseYmdLocal(ymd: string): Date | undefined {
  const trimmed = ymd.trim();
  if (!trimmed) {
    return undefined;
  }
  const parts = trimmed.split("-").map((p) => Number.parseInt(p, 10));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) {
    return undefined;
  }
  const [year, month, day] = parts;
  const parsed = new Date(year, month - 1, day);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return undefined;
  }
  return parsed;
}

interface CreateJobModalProps {
  onClose: () => void;
}

export function CreateJobModal({ onClose }: CreateJobModalProps) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<ModalStep>("job");
  const [title, setTitle] = useState("");
  const [clientId, setClientId] = useState("");
  const [isSchoolJob, setIsSchoolJob] = useState(false);
  const [purchaseOrderNumber, setPurchaseOrderNumber] = useState("");
  const [startDateStr, setStartDateStr] = useState(() => formatLocalYmd(new Date()));
  const [targetEndDateStr, setTargetEndDateStr] = useState("");
  const [selectedSiteId, setSelectedSiteId] = useState("");
  const [clientForm, setClientForm] = useState<ClientFormState>(createEmptyClientFormState);

  const { data: clients = [] } = useQuery({
    queryKey: ["clients"],
    queryFn: getClients,
  });

  const selectedClient = useMemo(
    () => clients.find((c) => c.id === clientId),
    [clients, clientId],
  );

  const clientSites = useMemo(
    () => (selectedClient ? resolveClientSiteAddresses(selectedClient) : []),
    [selectedClient],
  );

  useEffect(() => {
    if (clientSites.length > 0) {
      setSelectedSiteId(clientSites[0].id);
    } else {
      setSelectedSiteId("");
    }
  }, [clientId, clientSites]);

  const {
    data: clientJobCount,
    isLoading: isClientJobCountLoading,
    isError: isClientJobCountError,
  } = useQuery({
    queryKey: ["job-count-by-client", clientId],
    queryFn: () => countJobsByClientId(clientId),
    enabled: Boolean(clientId),
    staleTime: 60_000,
  });

  const automatedPoNumber = useMemo(() => {
    if (!selectedClient || typeof clientJobCount !== "number") {
      return "";
    }
    const prefix = poPrefixFromDisplayName(selectedClient.displayName);
    return formatSequentialPoNumber(prefix, clientJobCount + 1);
  }, [selectedClient, clientJobCount]);

  const createClientMutation = useMutation({
    mutationFn: (input: CreateClientInput) => createClient(input),
    onSuccess: async (newClient) => {
      queryClient.setQueryData<Client[]>(["clients"], (previous) => {
        const current = previous ?? [];
        if (current.some((client) => client.id === newClient.id)) {
          return previous;
        }
        return [...current, newClient].sort((a, b) =>
          a.displayName.localeCompare(b.displayName),
        );
      });
      await queryClient.invalidateQueries({ queryKey: ["clients"] });
      setClientId(newClient.id);
      setIsSchoolJob(false);
      setPurchaseOrderNumber("");
      setClientForm(createEmptyClientFormState());
      toast.success(`Client "${newClient.displayName}" created`);
      setStep("job");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to create client");
    },
  });

  const createJobMutation = useMutation({
    mutationFn: (input: CreateJobInput) => createJob(input),
    onSuccess: async (newJob) => {
      await queryClient.invalidateQueries({ queryKey: ["active-jobs"] });
      await queryClient.invalidateQueries({
        queryKey: ["job-count-by-client", newJob.clientId],
      });
      toast.success("Job created — opening workbench…");
      onClose();
      router.push(`/jobs/${newJob.id}`);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to create job");
    },
  });

  const handleCreateClient = () => {
    if (!clientForm.displayName.trim()) {
      toast.error("Client name is required");
      return;
    }
    createClientMutation.mutate(clientFormToCreateInput(clientForm) as CreateClientInput);
  };

  const handleCreateJob = () => {
    if (!title.trim()) {
      toast.error("Job title is required");
      return;
    }

    if (!clientId) {
      toast.error("Please select or create a client");
      return;
    }

    if (!isSchoolJob) {
      if (isClientJobCountLoading || isClientJobCountError) {
        toast.error(
          isClientJobCountError
            ? "Could not verify PO sequence — try again"
            : "Still loading client job history…",
        );
        return;
      }
      if (!automatedPoNumber) {
        toast.error("Could not compute PO number");
        return;
      }
    }

    const startDate = parseYmdLocal(startDateStr);
    const targetEndDate = parseYmdLocal(targetEndDateStr);
    if (!startDate) {
      toast.error("Choose a valid start date");
      return;
    }

    if (isSchoolJob && !purchaseOrderNumber.trim()) {
      toast.error("Enter the government or school PO reference");
      return;
    }

    const selectedSite =
      clientSites.find((site) => site.id === selectedSiteId) ?? clientSites[0] ?? null;

    createJobMutation.mutate({
      title,
      clientId,
      purchaseOrderNumber: isSchoolJob ? purchaseOrderNumber.trim() : automatedPoNumber,
      startDate,
      dueDate: targetEndDate ?? undefined,
      billingAddress: selectedClient?.billingAddress,
      siteAddress: selectedSite ? siteAddressToPostal(selectedSite) : selectedClient?.siteAddress,
      siteAddressId: selectedSite?.id,
    });
  };

  const renderJobForm = () => (
    <div className="space-y-4">
      <FieldRow label="Job Title *">
        <Input
          placeholder="e.g. Kitchen Renovation – Smith Residence"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="h-12 text-base"
          autoFocus
        />
      </FieldRow>

      <FieldRow label="Client *">
        <div className="flex gap-2">
          <select
            value={clientId}
            onChange={(e) => {
              setClientId(e.target.value);
              setIsSchoolJob(false);
              setPurchaseOrderNumber("");
            }}
            className="h-12 flex-1 rounded-lg border border-[#C3C6D4] bg-white px-3 text-base text-[#323338] focus:border-[#0073EA] focus:outline-none"
          >
            <option value="">— Select a client —</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.displayName}
                {client.isSchoolClient ? " (School)" : ""}
              </option>
            ))}
          </select>
          <Button
            type="button"
            variant="secondary"
            className="h-12 whitespace-nowrap px-4"
            onClick={() => setStep("new-client")}
          >
            + New Client
          </Button>
        </div>
      </FieldRow>

      {clientSites.length > 1 ? (
        <FieldRow label="Target Site Location">
          <select
            value={selectedSiteId}
            onChange={(e) => setSelectedSiteId(e.target.value)}
            className={CLIENT_FIELD_INPUT}
          >
            {clientSites.map((site) => (
              <option key={site.id} value={site.id}>
                {formatSiteAddressOption(site)}
              </option>
            ))}
          </select>
        </FieldRow>
      ) : null}

      <FieldRow label="Purchase Order (PO Number)">
        <div className="space-y-1">
          {isSchoolJob ? (
            <Input
              value={purchaseOrderNumber}
              onChange={(e) => setPurchaseOrderNumber(e.target.value)}
              placeholder="Paste government-issued PO reference"
              className="h-12 text-base"
            />
          ) : !clientId ? (
            <div className="flex h-12 items-center rounded-lg border border-[#C3C6D4] bg-white px-3 text-base text-[#676879]">
              Select a client
            </div>
          ) : isClientJobCountLoading ? (
            <div className="flex h-12 items-center rounded-lg border border-[#C3C6D4] bg-white px-3 text-base text-[#676879]">
              Computing sequence…
            </div>
          ) : isClientJobCountError ? (
            <div className="flex h-12 items-center rounded-lg border border-red-200 bg-white px-3 text-base text-red-600">
              Could not load job count
            </div>
          ) : (
            <Input
              readOnly
              value={automatedPoNumber}
              className="h-12 cursor-default border-[#C3C6D4] bg-[#FAFBFC] text-base text-[#676879] focus-visible:ring-0"
              aria-readonly
            />
          )}
          <p className="text-xs text-[#676879]">
            {isSchoolJob
              ? "Manual PO — paste the reference from the school or agency."
              : isClientJobCountError
                ? "Could not load existing jobs for this client."
                : "Auto-generated from client name and job count for this client."}
          </p>
        </div>
      </FieldRow>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FieldRow label="Start Date">
          <Input
            type="date"
            value={startDateStr}
            onChange={(e) => setStartDateStr(e.target.value)}
            className="h-12 text-base"
          />
        </FieldRow>
        <FieldRow label="Target End Date">
          <Input
            type="date"
            value={targetEndDateStr}
            onChange={(e) => setTargetEndDateStr(e.target.value)}
            className="h-12 text-base"
          />
        </FieldRow>
      </div>

      <FieldRow label="">
        <label className="flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={isSchoolJob}
            onChange={(e) => {
              const checked = e.target.checked;
              setIsSchoolJob(checked);
              if (!checked) {
                setPurchaseOrderNumber("");
              } else {
                const selected = clients.find((c) => c.id === clientId);
                if (selected?.defaultPurchaseOrderNumber) {
                  setPurchaseOrderNumber(selected.defaultPurchaseOrderNumber);
                }
              }
            }}
            className="h-5 w-5 rounded accent-[#0073EA]"
          />
          <span className="text-sm text-[#676879]">This is a School / Government job (requires PO)</span>
        </label>
      </FieldRow>

      <div className="flex justify-end gap-3 pt-2">
        <Button type="button" variant="secondary" className="h-11 px-5" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          className="h-11 px-6"
          disabled={
            createJobMutation.isPending ||
            (Boolean(clientId) &&
              !isSchoolJob &&
              (isClientJobCountLoading || isClientJobCountError || !automatedPoNumber))
          }
          onClick={handleCreateJob}
        >
          {createJobMutation.isPending ? "Creating…" : "Create Job"}
        </Button>
      </div>
    </div>
  );

  const renderNewClientForm = () => (
    <div className="space-y-4">
      <div className="max-h-[calc(100vh-220px)] overflow-y-auto pr-1">
        <ClientProfileFormFields
          value={clientForm}
          onChange={setClientForm}
          mode="edit"
          showSchoolFields
        />
      </div>

      <div className="flex justify-end gap-3 border-t border-[#E6E9EF] pt-4">
        <Button
          type="button"
          variant="secondary"
          className="h-11 px-5"
          onClick={() => setStep("job")}
        >
          Back
        </Button>
        <Button
          type="button"
          className="h-11 px-6"
          disabled={createClientMutation.isPending}
          onClick={handleCreateClient}
        >
          {createClientMutation.isPending ? "Saving…" : "Save Client"}
        </Button>
      </div>
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={cn(
          "flex max-h-[90vh] w-full flex-col overflow-hidden rounded-lg border border-[#D0D4E4] bg-white shadow-monday-2",
          step === "new-client" ? "max-w-2xl" : "max-w-xl",
        )}
      >
        <div className="flex items-center justify-between border-b border-[#D0D4E4] px-6 py-4">
          <h2 className="text-xl font-bold text-[#323338]">
            {step === "job" ? "New Job" : "Add New Client"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-[#676879] hover:bg-[#F5F6F8] hover:text-[#323338]"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {step === "job" ? renderJobForm() : renderNewClientForm()}
        </div>
      </div>
    </div>
  );
}
