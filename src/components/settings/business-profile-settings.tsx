"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getUserSettings, saveUserSettings, uploadBusinessLogo } from "@/lib/firebase/repository";
import { cn } from "@/lib/utils";
import { BusinessProfile } from "@/types/database";

const EMPTY_PROFILE: BusinessProfile = {
  businessName: "",
  abnOrAcn: "",
  bankName: "",
  bsb: "",
  accountNumber: "",
  paymentTerms: "Net 7 days",
  address: {
    line1: "",
    suburb: "",
    state: "",
    postcode: "",
    country: "Australia",
  },
};

const shellClass =
  "rounded-xl border border-[#E6E9EF] bg-white p-6 shadow-sm md:p-8";

const labelClass =
  "mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-[#676879]";

const inputClass =
  "w-full rounded-md border border-[#C3C6D4] bg-white px-3 py-2 text-sm text-[#323338] transition-all focus:border-[#0073EA] focus:ring-1 focus:ring-[#0073EA] focus:outline-none";

export function BusinessProfileSettings() {
  const queryClient = useQueryClient();
  const [draftProfile, setDraftProfile] = useState<BusinessProfile | null>(null);

  const { data: settings, isLoading } = useQuery({
    queryKey: ["user-settings"],
    queryFn: getUserSettings,
  });

  const profile = draftProfile ?? settings?.businessProfile ?? EMPTY_PROFILE;

  const saveSettingsMutation = useMutation({
    mutationFn: () =>
      saveUserSettings({
        businessProfile: profile,
        templates: settings?.templates,
        invoiceSystemPrompt: settings?.invoiceSystemPrompt,
        quoteSystemPrompt: settings?.quoteSystemPrompt,
      }),
    onSuccess: async () => {
      toast.success("Business profile saved");
      setDraftProfile(null);
      await queryClient.invalidateQueries({ queryKey: ["user-settings"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const uploadLogoMutation = useMutation({
    mutationFn: async (file: File) => {
      const logo = await uploadBusinessLogo(file);
      return saveUserSettings({
        businessProfile: {
          ...profile,
          logoUrl: logo.logoUrl,
          logoStoragePath: logo.logoStoragePath,
        },
        templates: settings?.templates,
        invoiceSystemPrompt: settings?.invoiceSystemPrompt,
        quoteSystemPrompt: settings?.quoteSystemPrompt,
      });
    },
    onSuccess: async () => {
      toast.success("Company logo saved");
      await queryClient.invalidateQueries({ queryKey: ["user-settings"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  if (isLoading && !settings) {
    return (
      <div className={shellClass}>
        <div className="h-6 w-48 animate-pulse rounded bg-[#F5F6F8]" />
        <div className="mt-6 space-y-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-10 animate-pulse rounded-lg bg-[#F5F6F8]" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={shellClass}>
      <h2 className="text-xl font-bold text-[#323338]">Business profile</h2>
      <p className="mb-6 text-sm text-[#676879]">
        Legal identity, banking, and logo used across quotes and invoices.
      </p>

      <div className="space-y-5">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className={labelClass}>Business name</label>
            <input
              className={inputClass}
              value={profile.businessName}
              onChange={(event) => {
                setDraftProfile({ ...profile, businessName: event.target.value });
              }}
            />
          </div>
          <div>
            <label className={labelClass}>ABN / ACN</label>
            <input
              className={inputClass}
              value={profile.abnOrAcn}
              onChange={(event) => {
                setDraftProfile({ ...profile, abnOrAcn: event.target.value });
              }}
            />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className={labelClass}>Address line 1</label>
            <input
              className={inputClass}
              value={profile.address?.line1 ?? ""}
              onChange={(event) => {
                setDraftProfile({
                  ...profile,
                  address: {
                    ...profile.address,
                    line1: event.target.value,
                    country: profile.address?.country ?? "Australia",
                    suburb: profile.address?.suburb ?? "",
                    state: profile.address?.state ?? "",
                    postcode: profile.address?.postcode ?? "",
                  },
                });
              }}
            />
          </div>
          <div>
            <label className={labelClass}>Address line 2</label>
            <input
              className={inputClass}
              value={profile.address?.line2 ?? ""}
              onChange={(event) => {
                setDraftProfile({
                  ...profile,
                  address: {
                    ...profile.address,
                    line2: event.target.value,
                    country: profile.address?.country ?? "Australia",
                    line1: profile.address?.line1 ?? "",
                    suburb: profile.address?.suburb ?? "",
                    state: profile.address?.state ?? "",
                    postcode: profile.address?.postcode ?? "",
                  },
                });
              }}
            />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <div className="md:col-span-2">
            <label className={labelClass}>Suburb</label>
            <input
              className={inputClass}
              value={profile.address?.suburb ?? ""}
              onChange={(event) => {
                setDraftProfile({
                  ...profile,
                  address: {
                    ...profile.address,
                    suburb: event.target.value,
                    country: profile.address?.country ?? "Australia",
                    line1: profile.address?.line1 ?? "",
                    state: profile.address?.state ?? "",
                    postcode: profile.address?.postcode ?? "",
                  },
                });
              }}
            />
          </div>
          <div>
            <label className={labelClass}>State</label>
            <input
              className={inputClass}
              value={profile.address?.state ?? ""}
              onChange={(event) => {
                setDraftProfile({
                  ...profile,
                  address: {
                    ...profile.address,
                    state: event.target.value,
                    country: profile.address?.country ?? "Australia",
                    line1: profile.address?.line1 ?? "",
                    suburb: profile.address?.suburb ?? "",
                    postcode: profile.address?.postcode ?? "",
                  },
                });
              }}
            />
          </div>
          <div>
            <label className={labelClass}>Postcode</label>
            <input
              className={inputClass}
              value={profile.address?.postcode ?? ""}
              onChange={(event) => {
                setDraftProfile({
                  ...profile,
                  address: {
                    ...profile.address,
                    postcode: event.target.value,
                    country: profile.address?.country ?? "Australia",
                    line1: profile.address?.line1 ?? "",
                    suburb: profile.address?.suburb ?? "",
                    state: profile.address?.state ?? "",
                  },
                });
              }}
            />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <div>
            <label className={labelClass}>Bank name</label>
            <input
              className={inputClass}
              value={profile.bankName}
              onChange={(event) => {
                setDraftProfile({ ...profile, bankName: event.target.value });
              }}
            />
          </div>
          <div>
            <label className={labelClass}>BSB</label>
            <input
              className={inputClass}
              value={profile.bsb}
              onChange={(event) => {
                setDraftProfile({ ...profile, bsb: event.target.value });
              }}
            />
          </div>
          <div>
            <label className={labelClass}>Account number</label>
            <input
              className={inputClass}
              value={profile.accountNumber}
              onChange={(event) => {
                setDraftProfile({ ...profile, accountNumber: event.target.value });
              }}
            />
          </div>
          <div>
            <label className={labelClass}>Payment terms</label>
            <input
              className={inputClass}
              value={profile.paymentTerms}
              onChange={(event) => {
                setDraftProfile({ ...profile, paymentTerms: event.target.value });
              }}
            />
          </div>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-dashed border-[#C3C6D4] bg-[#F5F6F8] p-6">
          <div>
            <p className="font-semibold text-[#323338]">Company logo</p>
            <p className="text-sm text-[#676879]">Uploaded once and reused in generated PDFs.</p>
            {profile.logoUrl ? (
              <a
                href={profile.logoUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-block text-sm text-[#0073EA] underline-offset-4 hover:underline"
              >
                View current logo
              </a>
            ) : null}
          </div>
          <label className="inline-flex shrink-0 cursor-pointer items-center rounded-md border border-[#C3C6D4] bg-white px-4 py-2 text-sm font-medium text-[#323338] transition-colors hover:bg-[#F5F6F8]">
            Upload logo
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  uploadLogoMutation.mutate(file);
                }
                event.target.value = "";
              }}
            />
          </label>
        </div>

        <button
          type="button"
          onClick={() => saveSettingsMutation.mutate()}
          disabled={saveSettingsMutation.isPending}
          className={cn(
            "mt-6 ml-auto block w-fit rounded-md bg-[#0073EA] px-5 py-2.5 font-medium text-white shadow-sm transition-all hover:bg-[#0060B9] active:scale-95 disabled:opacity-50",
          )}
        >
          Save business profile
        </button>
      </div>
    </div>
  );
}
