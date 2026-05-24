"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Trash2 } from "lucide-react";
import { ClientProfileFormFields } from "@/components/client-profile-form-fields";
import {
  archiveClient,
  getClientById,
  getInvoicesByUid,
  getJobsByClientId,
  updateClientWithPropagation,
} from "@/lib/firebase/repository";
import {
  clientFormToUpdateInput,
  clientToFormState,
  type ClientFormState,
} from "@/lib/client-addresses";
import {
  computeClientLifetimeBillingCents,
  formatClientCurrency,
  formatClientJobDate,
  getJobOutstandingBalanceCents,
  jobStatusLabel,
  jobStatusPillClass,
} from "@/lib/client-crm";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/auth-provider";

type ProfileTab = "profile" | "jobs";

interface ClientDetailSheetProps {
  isOpen: boolean;
  onClose: () => void;
  clientId: string | null;
}

export function ClientDetailSheet({
  isOpen,
  onClose,
  clientId,
}: ClientDetailSheetProps) {
  const { currentUser } = useAuth();
  const uid = currentUser?.uid;
  const queryClient = useQueryClient();
  const [profileTab, setProfileTab] = useState<ProfileTab>("profile");
  const [isEditMode, setIsEditMode] = useState(false);
  const [formData, setFormData] = useState<ClientFormState | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setProfileTab("profile");
      setIsEditMode(false);
      setFormData(null);
      setDeleteError(null);
      setShowDeleteConfirm(false);
    }
  }, [isOpen, clientId]);

  const { data: client, isLoading: clientLoading } = useQuery({
    queryKey: ["client", clientId],
    queryFn: () => getClientById(clientId ?? ""),
    enabled: Boolean(clientId) && isOpen,
  });

  const { data: clientJobs = [] } = useQuery({
    queryKey: ["client-jobs", clientId],
    queryFn: () => getJobsByClientId(clientId ?? ""),
    enabled: Boolean(clientId) && isOpen,
  });

  const { data: allInvoices = [] } = useQuery({
    queryKey: ["crm-invoices", uid],
    queryFn: () => getInvoicesByUid(uid ?? ""),
    enabled: Boolean(uid) && isOpen,
  });

  const clientInvoices = useMemo(
    () => allInvoices.filter((inv) => inv.clientId === clientId),
    [allInvoices, clientId],
  );

  const lifetimeBillingCents = useMemo(
    () => (clientId ? computeClientLifetimeBillingCents(clientId, allInvoices) : 0),
    [clientId, allInvoices],
  );

  const updateClientMutation = useMutation({
    mutationFn: async (updates: Parameters<typeof updateClientWithPropagation>[1]) => {
      if (!clientId) {
        throw new Error("No client ID");
      }
      return updateClientWithPropagation(clientId, updates);
    },
    onSuccess: async () => {
      toast.success("Client updated");
      setIsEditMode(false);
      await queryClient.invalidateQueries({ queryKey: ["client", clientId] });
      await queryClient.invalidateQueries({ queryKey: ["clients"] });
      await queryClient.invalidateQueries({ queryKey: ["active-jobs"] });
      await queryClient.invalidateQueries({ queryKey: ["completed-jobs"] });
      await queryClient.invalidateQueries({ queryKey: ["archived-jobs"] });
      await queryClient.invalidateQueries({ queryKey: ["job"] });
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const archiveClientMutation = useMutation({
    mutationFn: async () => {
      if (!clientId) {
        throw new Error("No client ID");
      }
      await archiveClient(clientId);
    },
    onSuccess: async () => {
      toast.success("Client archived from directory");
      setDeleteError(null);
      setShowDeleteConfirm(false);
      await queryClient.invalidateQueries({ queryKey: ["clients"] });
      onClose();
    },
    onError: (error) => {
      setDeleteError(error.message);
      setShowDeleteConfirm(false);
    },
  });

  const handleEdit = () => {
    if (client) {
      setFormData(clientToFormState(client));
    }
    setIsEditMode(true);
  };

  const handleSave = async () => {
    if (!formData) {
      return;
    }
    if (!formData.displayName.trim()) {
      toast.error("Full name is required");
      return;
    }
    await updateClientMutation.mutateAsync(clientFormToUpdateInput(formData));
  };

  const handleDeleteRequest = () => {
    setDeleteError(null);
    setShowDeleteConfirm(true);
  };

  const viewFormState = client ? clientToFormState(client) : null;

  return (
    <Sheet
      isOpen={isOpen}
      onClose={onClose}
      panelClassName="max-w-2xl border-l border-[#E6E9EF] bg-white shadow-monday-2"
      contentClassName="flex h-full flex-col px-0 py-0"
    >
      {clientLoading || !client || !viewFormState ? (
        <p className="px-6 py-6 text-sm text-[#676879]">Loading client profile…</p>
      ) : (
        <>
          <div className="shrink-0 border-b border-[#E6E9EF] px-6 py-5">
            <h2 className="text-2xl font-bold tracking-tight text-[#323338]">{client.displayName}</h2>
            <p className="mt-1 font-mono text-sm text-[#676879]">
              Lifetime Billing:{" "}
              <span className="text-[#323338]">{formatClientCurrency(lifetimeBillingCents)}</span>
            </p>

            <div className="mt-4 flex gap-1 rounded-lg bg-[#F5F6F8] p-1">
              {(
                [
                  { id: "profile" as const, label: "Profile Info" },
                  { id: "jobs" as const, label: "Job History" },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setProfileTab(tab.id)}
                  className={cn(
                    "flex-1 rounded-md px-3 py-2 text-xs font-semibold transition-colors",
                    profileTab === tab.id
                      ? "bg-white text-[#323338] shadow-sm"
                      : "text-[#676879] hover:text-[#323338]",
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {profileTab === "profile" ? (
            <>
              <div className="min-h-0 flex-1 overflow-y-auto p-6">
                <ClientProfileFormFields
                  value={isEditMode && formData ? formData : viewFormState}
                  onChange={isEditMode ? setFormData : undefined}
                  mode={isEditMode ? "edit" : "view"}
                  showSchoolFields={isEditMode || client.isSchoolClient}
                />
              </div>

              <div className="shrink-0 space-y-4 border-t border-[#E6E9EF] px-6 py-4">
                <div className="flex gap-2">
                  {!isEditMode ? (
                    <Button
                      type="button"
                      onClick={handleEdit}
                      className="flex-1 border border-[#0073EA] bg-[#0073EA] text-white hover:bg-[#0060B9]"
                    >
                      Edit profile
                    </Button>
                  ) : (
                    <>
                      <Button
                        type="button"
                        onClick={() => void handleSave()}
                        disabled={updateClientMutation.isPending}
                        className="flex-1 bg-emerald-600 text-white hover:bg-emerald-700"
                      >
                        {updateClientMutation.isPending ? "Saving…" : "Save"}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => {
                          setIsEditMode(false);
                          setFormData(null);
                        }}
                        className="flex-1"
                      >
                        Cancel
                      </Button>
                    </>
                  )}
                </div>

                {deleteError ? (
                  <div
                    role="alert"
                    className="flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
                  >
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                    <p>{deleteError}</p>
                  </div>
                ) : null}

                {showDeleteConfirm ? (
                  <div className="space-y-3 rounded-lg border border-[#D0D4E4] bg-white p-3">
                    <p className="text-sm text-[#676879]">
                      Archive this client from the directory? Historical invoices and paid jobs stay
                      in the ledger. This cannot be undone from the UI.
                    </p>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        className="flex-1"
                        onClick={() => setShowDeleteConfirm(false)}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        className="flex-1"
                        disabled={archiveClientMutation.isPending}
                        onClick={() => archiveClientMutation.mutate()}
                      >
                        {archiveClientMutation.isPending ? "Archiving…" : "Confirm archive"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="destructive"
                    className="w-full gap-2"
                    onClick={handleDeleteRequest}
                    disabled={archiveClientMutation.isPending || isEditMode}
                  >
                    <Trash2 className="size-4" />
                    Delete client
                  </Button>
                )}
              </div>
            </>
          ) : (
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-6">
              {clientJobs.length === 0 ? (
                <p className="text-sm text-[#676879]">No jobs linked to this client yet.</p>
              ) : (
                clientJobs.map((job) => {
                  const balanceCents = getJobOutstandingBalanceCents(job.id, clientInvoices);
                  return (
                    <Link
                      key={job.id}
                      href={`/jobs/${job.id}`}
                      onClick={onClose}
                      className="block rounded-lg border border-[#E6E9EF]/80 bg-white p-4 transition-all hover:border-[#0073EA]/30 hover:bg-[#FAFBFC]"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-[#323338]">{job.title}</p>
                          <p className="mt-1 text-xs text-[#676879]">
                            Created {formatClientJobDate(job.createdAt)}
                          </p>
                        </div>
                        <span
                          className={cn(
                            "shrink-0 rounded-md border px-2 py-0.5 text-xs font-medium capitalize",
                            jobStatusPillClass(job.status),
                          )}
                        >
                          {jobStatusLabel(job.status)}
                        </span>
                      </div>
                      <p className="mt-3 text-right font-mono text-sm text-[#676879]">
                        Balance: {formatClientCurrency(balanceCents)}
                      </p>
                    </Link>
                  );
                })
              )}
            </div>
          )}
        </>
      )}
    </Sheet>
  );
}
