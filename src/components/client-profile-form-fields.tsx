"use client";

import { Trash2 } from "lucide-react";
import {
  AU_STATES,
  CLIENT_FIELD_INPUT,
  CLIENT_FIELD_LABEL,
  CLIENT_SECTION_TITLE,
  createEmptySiteAddress,
  type ClientFormState,
} from "@/lib/client-addresses";
import type { SiteAddress } from "@/types/database";
import { cn } from "@/lib/utils";

type ClientProfileFormFieldsProps = {
  value: ClientFormState;
  onChange?: (next: ClientFormState) => void;
  mode: "edit" | "view";
  showSchoolFields?: boolean;
  className?: string;
};

function ReadOnlyValue({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-[#323338]">{children || "—"}</p>;
}

function updateSiteAtIndex(
  sites: SiteAddress[],
  index: number,
  patch: Partial<SiteAddress>,
): SiteAddress[] {
  const updated = [...sites];
  updated[index] = { ...updated[index], ...patch };
  return updated;
}

export function ClientProfileFormFields({
  value,
  onChange,
  mode,
  showSchoolFields = false,
  className,
}: ClientProfileFormFieldsProps) {
  const isEdit = mode === "edit" && onChange;

  const setField = <K extends keyof ClientFormState>(key: K, fieldValue: ClientFormState[K]) => {
    onChange?.({ ...value, [key]: fieldValue });
  };

  const addSite = () => {
    onChange?.({
      ...value,
      siteAddresses: [...value.siteAddresses, createEmptySiteAddress()],
    });
  };

  const removeSite = (index: number) => {
    onChange?.({
      ...value,
      siteAddresses: value.siteAddresses.filter((_, i) => i !== index),
    });
  };

  const updateSite = (index: number, patch: Partial<SiteAddress>) => {
    onChange?.({
      ...value,
      siteAddresses: updateSiteAtIndex(value.siteAddresses, index, patch),
    });
  };

  return (
    <div className={cn("space-y-6", className)}>
      <section className="rounded-xl border border-[#E6E9EF] bg-white p-4">
        <h3 className={CLIENT_SECTION_TITLE}>General Details</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={CLIENT_FIELD_LABEL}>Full Name *</label>
            {isEdit ? (
              <input
                type="text"
                value={value.displayName}
                onChange={(e) => setField("displayName", e.target.value)}
                className={CLIENT_FIELD_INPUT}
                required
              />
            ) : (
              <ReadOnlyValue>{value.displayName}</ReadOnlyValue>
            )}
          </div>

          <div>
            <label className={CLIENT_FIELD_LABEL}>Company</label>
            {isEdit ? (
              <input
                type="text"
                value={value.legalName}
                onChange={(e) => setField("legalName", e.target.value)}
                className={CLIENT_FIELD_INPUT}
              />
            ) : (
              <ReadOnlyValue>{value.legalName}</ReadOnlyValue>
            )}
          </div>

          <div>
            <label className={CLIENT_FIELD_LABEL}>Phone</label>
            {isEdit ? (
              <input
                type="tel"
                value={value.phone}
                onChange={(e) => setField("phone", e.target.value)}
                className={CLIENT_FIELD_INPUT}
              />
            ) : (
              <ReadOnlyValue>{value.phone}</ReadOnlyValue>
            )}
          </div>

          <div className="sm:col-span-2">
            <label className={CLIENT_FIELD_LABEL}>Email</label>
            {isEdit ? (
              <input
                type="email"
                value={value.email}
                onChange={(e) => setField("email", e.target.value)}
                className={CLIENT_FIELD_INPUT}
              />
            ) : (
              <ReadOnlyValue>{value.email}</ReadOnlyValue>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-[#E6E9EF] bg-white p-4">
        <label className={CLIENT_SECTION_TITLE}>Notes</label>
        {isEdit ? (
          <textarea
            value={value.notes}
            onChange={(e) => setField("notes", e.target.value)}
            className={cn(CLIENT_FIELD_INPUT, "min-h-[100px] resize-y p-3")}
            placeholder="Internal notes about this client…"
          />
        ) : (
          <ReadOnlyValue>{value.notes}</ReadOnlyValue>
        )}
      </section>

      <section className="rounded-xl border border-[#E6E9EF] bg-white p-4">
        <h3 className={CLIENT_SECTION_TITLE}>Billing Address</h3>
        <div className="space-y-4">
          <div>
            <label className={CLIENT_FIELD_LABEL}>Street Address</label>
            {isEdit ? (
              <input
                type="text"
                value={value.billingLine1}
                onChange={(e) => setField("billingLine1", e.target.value)}
                className={CLIENT_FIELD_INPUT}
              />
            ) : (
              <ReadOnlyValue>{value.billingLine1}</ReadOnlyValue>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className={CLIENT_FIELD_LABEL}>Suburb</label>
              {isEdit ? (
                <input
                  type="text"
                  value={value.billingSuburb}
                  onChange={(e) => setField("billingSuburb", e.target.value)}
                  className={CLIENT_FIELD_INPUT}
                />
              ) : (
                <ReadOnlyValue>{value.billingSuburb}</ReadOnlyValue>
              )}
            </div>
            <div>
              <label className={CLIENT_FIELD_LABEL}>State</label>
              {isEdit ? (
                <select
                  value={value.billingState}
                  onChange={(e) => setField("billingState", e.target.value)}
                  className={CLIENT_FIELD_INPUT}
                >
                  {AU_STATES.map((state) => (
                    <option key={state} value={state}>
                      {state}
                    </option>
                  ))}
                </select>
              ) : (
                <ReadOnlyValue>{value.billingState}</ReadOnlyValue>
              )}
            </div>
            <div>
              <label className={CLIENT_FIELD_LABEL}>Postcode</label>
              {isEdit ? (
                <input
                  type="text"
                  value={value.billingPostcode}
                  onChange={(e) => setField("billingPostcode", e.target.value)}
                  className={CLIENT_FIELD_INPUT}
                  maxLength={4}
                />
              ) : (
                <ReadOnlyValue>{value.billingPostcode}</ReadOnlyValue>
              )}
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className={cn(CLIENT_SECTION_TITLE, "mb-0")}>Site Locations</h3>
          {isEdit ? (
            <button
              type="button"
              onClick={addSite}
              className="rounded px-2 py-1 text-xs font-semibold text-[#0073EA] transition-colors hover:bg-[#F5F6F8]"
            >
              + Add Location
            </button>
          ) : null}
        </div>

        {value.siteAddresses.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[#E6E9EF] bg-[#FAFBFC] p-4 text-sm text-[#676879]">
            No site locations yet.
            {isEdit ? " Use Add Location for campuses or job sites." : ""}
          </p>
        ) : (
          value.siteAddresses.map((site, index) => (
            <div
              key={site.id}
              className="group relative mb-3 rounded-xl border border-[#E6E9EF] bg-[#F5F6F8]/40 p-4 transition-all hover:border-[#C3C6D4]"
            >
              {isEdit ? (
                <button
                  type="button"
                  onClick={() => removeSite(index)}
                  className="absolute top-3 right-3 rounded-md p-1.5 text-[#C3C6D4] transition-colors hover:bg-[#FCECEE] hover:text-[#E2445C]"
                  aria-label={`Remove ${site.label || "site"}`}
                >
                  <Trash2 className="size-4" aria-hidden />
                </button>
              ) : null}

              <div className="mb-3 pr-10">
                <label className={CLIENT_FIELD_LABEL}>Location Label</label>
                {isEdit ? (
                  <input
                    type="text"
                    value={site.label}
                    onChange={(e) => updateSite(index, { label: e.target.value })}
                    placeholder="Label: e.g., North Campus"
                    className={CLIENT_FIELD_INPUT}
                  />
                ) : (
                  <ReadOnlyValue>{site.label}</ReadOnlyValue>
                )}
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className={CLIENT_FIELD_LABEL}>Street Address</label>
                  {isEdit ? (
                    <input
                      type="text"
                      value={site.street}
                      onChange={(e) => updateSite(index, { street: e.target.value })}
                      className={CLIENT_FIELD_INPUT}
                    />
                  ) : (
                    <ReadOnlyValue>{site.street}</ReadOnlyValue>
                  )}
                </div>

                <div>
                  <label className={CLIENT_FIELD_LABEL}>Suburb</label>
                  {isEdit ? (
                    <input
                      type="text"
                      value={site.suburb}
                      onChange={(e) => updateSite(index, { suburb: e.target.value })}
                      className={CLIENT_FIELD_INPUT}
                    />
                  ) : (
                    <ReadOnlyValue>{site.suburb}</ReadOnlyValue>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={CLIENT_FIELD_LABEL}>State</label>
                    {isEdit ? (
                      <select
                        value={site.state}
                        onChange={(e) => updateSite(index, { state: e.target.value })}
                        className={CLIENT_FIELD_INPUT}
                      >
                        {AU_STATES.map((state) => (
                          <option key={state} value={state}>
                            {state}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <ReadOnlyValue>{site.state}</ReadOnlyValue>
                    )}
                  </div>
                  <div>
                    <label className={CLIENT_FIELD_LABEL}>Postcode</label>
                    {isEdit ? (
                      <input
                        type="text"
                        value={site.postcode}
                        onChange={(e) => updateSite(index, { postcode: e.target.value })}
                        className={CLIENT_FIELD_INPUT}
                        maxLength={4}
                      />
                    ) : (
                      <ReadOnlyValue>{site.postcode}</ReadOnlyValue>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </section>

      {showSchoolFields ? (
        <section className="rounded-xl border border-[#E6E9EF] bg-white p-4">
          <label className="flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              checked={value.isSchoolClient}
              disabled={!isEdit}
              onChange={(e) => setField("isSchoolClient", e.target.checked)}
              className="h-4 w-4 rounded accent-[#0073EA]"
            />
            <span className="text-sm text-[#676879]">School / Government client</span>
          </label>
          {value.isSchoolClient ? (
            <div className="mt-4">
              <label className={CLIENT_FIELD_LABEL}>Default PO Number</label>
              {isEdit ? (
                <input
                  type="text"
                  value={value.defaultPurchaseOrderNumber}
                  onChange={(e) => setField("defaultPurchaseOrderNumber", e.target.value)}
                  className={CLIENT_FIELD_INPUT}
                />
              ) : (
                <ReadOnlyValue>{value.defaultPurchaseOrderNumber}</ReadOnlyValue>
              )}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
