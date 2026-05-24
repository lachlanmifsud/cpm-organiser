"use client";

import NextImage from "next/image";
import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { compileDocumentPdfFromPayload } from "@/components/generated-document-pdf";
import { ProcessingOverlay } from "@/components/processing-overlay";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { MaterialMarkupStepper } from "@/components/material-markup-stepper";
import { updateClient } from "@/lib/firebase/repository";
import {
  computeDocumentTotals,
  getJobMaterialMarkupPercent,
  sumMaterialSubtotalCents,
} from "@/lib/material-markup";
import {
  buildFallbackInvoiceBody,
  buildFallbackQuoteBody,
  type InvoiceDocumentAiBody,
  type QuoteDocumentAiBody,
} from "@/lib/ai/document-body-shared";
import { fetchGeneratedDocumentBody } from "@/lib/ai/document-body-client";
import {
  buildDocumentRefinementPayload,
  type DocumentRefinementPayload,
} from "@/lib/document-refinement-payload";
import { Client, Job, JobDocumentRecord, LineItem, UserSettings } from "@/types/database";

export type DocumentWizardProps = {
  isOpen: boolean;
  onClose: () => void;
  job: Job;
  client: Client | null;
  lineItems: LineItem[];
  settings: UserSettings | null;
  documents: JobDocumentRecord[];
  selectedItemIds: string[];
  onClientUpdated: () => Promise<void> | void;
  onGenerateComplete: (payload: DocumentRefinementPayload) => void;
};

type WizardStep = 1 | 2 | 3 | 4 | 5;
type DocumentType = "quote" | "invoice";

function formatCurrency(valueCents: number) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
  }).format(valueCents / 100);
}

function hasCompleteAddress(address?: Client["billingAddress"]) {
  return Boolean(
    address?.line1?.trim() && address?.suburb?.trim() && address?.state?.trim() && address?.postcode?.trim(),
  );
}

function makeDocumentNumber(type: DocumentType, documents: JobDocumentRecord[]) {
  const prefix = type === "invoice" ? "INV" : "QUO";
  const count = documents.filter((document) => document.type === type).length + 1;
  const year = new Date().getFullYear();
  return `${prefix}-${year}-${String(count).padStart(3, "0")}`;
}

export function DocumentWizard({
  isOpen,
  onClose,
  job,
  client,
  lineItems,
  settings,
  documents,
  selectedItemIds,
  onClientUpdated,
  onGenerateComplete,
}: DocumentWizardProps) {
  const [step, setStep] = useState<WizardStep>(1);
  const [documentType, setDocumentType] = useState<DocumentType>("invoice");
  const [documentNumber, setDocumentNumber] = useState(makeDocumentNumber("invoice", documents));
  const [selectedTemplateId, setSelectedTemplateId] = useState(settings?.templates[0]?.id ?? "");
  const [clientDraft, setClientDraft] = useState<Client | null>(client);
  const [chosenMarkupPercent, setChosenMarkupPercent] = useState(() =>
    getJobMaterialMarkupPercent(job),
  );

  useEffect(() => {
    if (isOpen) {
      setStep(1);
      setChosenMarkupPercent(getJobMaterialMarkupPercent(job));
      setClientDraft(client);
      setDocumentType("invoice");
      setDocumentNumber(makeDocumentNumber("invoice", documents));
      setSelectedTemplateId(settings?.templates[0]?.id ?? "");
    }
  }, [isOpen, client, documents, job.id, job.materialMarkupPercent, settings?.templates]);

  const selectedItems = useMemo(() => {
    return lineItems.filter((item) => selectedItemIds.includes(item.id));
  }, [lineItems, selectedItemIds]);

  const selectedTemplate = useMemo(() => {
    return settings?.templates.find((template) => template.id === selectedTemplateId) ?? null;
  }, [selectedTemplateId, settings?.templates]);

  const totals = useMemo(() => {
    const subtotalCents = selectedItems.reduce((sum, item) => sum + item.subtotalCents, 0);
    const materialSubtotalCents = sumMaterialSubtotalCents(selectedItems);
    const computed = computeDocumentTotals(subtotalCents, materialSubtotalCents, chosenMarkupPercent);
    return {
      subtotalCents,
      materialSubtotalCents,
      markupCents: computed.markupCents,
      taxCents: computed.taxCents,
      totalCents: computed.totalCents,
      chosenMarkupPercent,
    };
  }, [selectedItems, chosenMarkupPercent]);

  const validation = useMemo(() => {
    return {
      hasBusinessAbn: Boolean(settings?.businessProfile.abnOrAcn?.trim()),
      hasTemplate: Boolean(selectedTemplate),
      hasClientAddress: hasCompleteAddress(clientDraft?.billingAddress),
      hasClientEmail: Boolean(clientDraft?.email?.trim()),
    };
  }, [clientDraft?.billingAddress, clientDraft?.email, selectedTemplate, settings?.businessProfile.abnOrAcn]);

  const canGenerate =
    validation.hasBusinessAbn &&
    validation.hasClientAddress &&
    validation.hasTemplate &&
    selectedItems.length > 0;

  const saveClientMutation = useMutation({
    mutationFn: async () => {
      if (!clientDraft?.id) {
        throw new Error("Client is missing for this job.");
      }
      return updateClient(clientDraft.id, {
        email: clientDraft.email,
        phone: clientDraft.phone,
        billingAddress: clientDraft.billingAddress,
      });
    },
    onSuccess: async () => {
      toast.success("Client Updated");
      await onClientUpdated();
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      if (!clientDraft) {
        throw new Error("Client details are missing.");
      }
      if (!settings) {
        throw new Error("Business settings are missing.");
      }
      if (!validation.hasBusinessAbn) {
        throw new Error("Add your ABN/ACN in Settings before generating a document.");
      }
      if (!validation.hasClientAddress) {
        throw new Error("Add the client billing address before generating a document.");
      }
      if (!selectedTemplate) {
        throw new Error("Select a document template first.");
      }

      let quoteBody: QuoteDocumentAiBody | undefined;
      let invoiceBody: InvoiceDocumentAiBody | undefined;

      try {
        const aiPayload = await fetchGeneratedDocumentBody({
          documentType,
          job,
          client: clientDraft,
          lineItems: selectedItems,
          subtotalCents: totals.subtotalCents,
          markupCents: totals.markupCents,
          taxCents: totals.taxCents,
          totalCents: totals.totalCents,
          chosenMarkupPercent: totals.chosenMarkupPercent,
          invoiceSystemPrompt: settings.invoiceSystemPrompt,
          quoteSystemPrompt: settings.quoteSystemPrompt,
        });
        if (documentType === "quote") {
          quoteBody = aiPayload as QuoteDocumentAiBody;
        } else {
          invoiceBody = aiPayload as InvoiceDocumentAiBody;
        }
      } catch (error) {
        console.error("[DocumentWizard] AI body generation failed", error);
        toast.warning("AI document wording failed — using standard layout.");
        if (documentType === "quote") {
          quoteBody = buildFallbackQuoteBody(selectedItems);
        } else {
          invoiceBody = buildFallbackInvoiceBody(selectedItems);
        }
      }

      const payload = buildDocumentRefinementPayload({
        documentType,
        documentNumber,
        job,
        client: clientDraft,
        settings,
        lineItems: selectedItems,
        template: selectedTemplate,
        subtotalCents: totals.subtotalCents,
        markupCents: totals.markupCents,
        markupPercent: totals.chosenMarkupPercent,
        taxCents: totals.taxCents,
        totalCents: totals.totalCents,
        quoteBody: quoteBody ?? null,
        invoiceBody: invoiceBody ?? null,
      });

      await compileDocumentPdfFromPayload(payload);
      return payload;
    },
    onSuccess: (payload) => {
      onGenerateComplete(payload);
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-zinc-950/40 p-4 backdrop-blur-sm sm:p-6"
      onClick={(event) => {
        if (event.target === event.currentTarget && !generateMutation.isPending) {
          onClose();
        }
      }}
    >
      <div
        className="relative flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <ProcessingOverlay
          active={generateMutation.isPending}
          title={
            documentType === "quote"
              ? "Compiling quote data panels..."
              : "Assembling your invoice layout blueprint..."
          }
        />

        {/* Header + step tracker */}
        <header className="shrink-0 border-b border-[#E6E9EF] bg-white p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm uppercase tracking-[0.2em] text-[#676879]">Document Wizard</p>
              <h2 className="mt-1 text-2xl font-semibold text-[#323338]">
                Review, validate, and lock the PDF
              </h2>
            </div>
            <Button variant="secondary" onClick={onClose} disabled={generateMutation.isPending}>
              Close
            </Button>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {([1, 2, 3, 4, 5] as const).map((value) => (
              <button
                key={value}
                type="button"
                disabled={generateMutation.isPending}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                  step === value
                    ? "border-[#0073EA] bg-[#0073EA]/10 text-[#0073EA]"
                    : "border-[#E6E9EF] bg-white text-[#676879] hover:bg-[#F5F6F8]",
                )}
                onClick={() => setStep(value)}
              >
                Step {value}
              </button>
            ))}
          </div>
        </header>

        {/* Body: main steps + summary sidebar */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div className="flex-1 overflow-y-auto bg-white p-8">
            {step === 1 ? (
              <div className="space-y-5">
                <div>
                  <h3 className="text-xl font-semibold text-[#323338]">1. The Scope</h3>
                  <p className="mt-1 text-sm text-[#676879]">
                    Selected line items remain the raw ledger. Markup and GST are applied here for
                    the client-facing document.
                  </p>
                </div>
                <div className="space-y-3">
                  {selectedItems.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-lg border border-[#E6E9EF] bg-[#F5F6F8] p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-[#323338]">{item.description}</p>
                          <p className="text-sm text-[#676879]">
                            {item.kind} · Qty {item.quantity}
                          </p>
                        </div>
                        <p className="font-semibold tabular-nums text-[#323338]">
                          {formatCurrency(item.subtotalCents)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {step === 2 ? (
              <div className="space-y-5">
                <div>
                  <h3 className="text-xl font-semibold text-[#323338]">2. The Template</h3>
                  <p className="mt-1 text-sm text-[#676879]">
                    Choose an AI-generated layout template and confirm the document identity.
                  </p>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-[#323338]">
                      Document type
                    </label>
                    <select
                      value={documentType}
                      onChange={(event) => {
                        const nextType = event.target.value as DocumentType;
                        setDocumentType(nextType);
                        setDocumentNumber(makeDocumentNumber(nextType, documents));
                      }}
                      className="h-11 w-full rounded-md border border-[#C3C6D4] bg-white px-3 text-sm text-[#323338]"
                    >
                      <option value="invoice">Invoice</option>
                      <option value="quote">Quote</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-[#323338]">
                      Document number
                    </label>
                    <Input
                      value={documentNumber}
                      onChange={(event) => setDocumentNumber(event.target.value)}
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-[#323338]">Template</label>
                  <select
                    value={selectedTemplateId}
                    onChange={(event) => setSelectedTemplateId(event.target.value)}
                    className="h-11 w-full rounded-md border border-[#C3C6D4] bg-white px-3 text-sm text-[#323338]"
                  >
                    <option value="">Select a template</option>
                    {(settings?.templates ?? []).map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ) : null}

            {step === 3 ? (
              <div className="space-y-5">
                <div>
                  <h3 className="text-xl font-semibold text-[#323338]">3. The Recipient</h3>
                  <p className="mt-1 text-sm text-[#676879]">
                    Fix missing client contact details before the document is locked.
                  </p>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-[#323338]">Client name</label>
                    <Input value={clientDraft?.displayName ?? ""} disabled />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-[#323338]">Email</label>
                    <Input
                      value={clientDraft?.email ?? ""}
                      onChange={(event) => {
                        setClientDraft((current) =>
                          current ? { ...current, email: event.target.value } : current,
                        );
                      }}
                      className={validation.hasClientEmail ? "" : "border-[#E2445C]/50"}
                    />
                  </div>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-[#323338]">Phone</label>
                    <Input
                      value={clientDraft?.phone ?? ""}
                      onChange={(event) => {
                        setClientDraft((current) =>
                          current ? { ...current, phone: event.target.value } : current,
                        );
                      }}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-[#323338]">
                      Address line 1
                    </label>
                    <Input
                      value={clientDraft?.billingAddress?.line1 ?? ""}
                      onChange={(event) => {
                        setClientDraft((current) =>
                          current
                            ? {
                                ...current,
                                billingAddress: {
                                  line1: event.target.value,
                                  line2: current.billingAddress?.line2,
                                  suburb: current.billingAddress?.suburb ?? "",
                                  state: current.billingAddress?.state ?? "",
                                  postcode: current.billingAddress?.postcode ?? "",
                                  country: current.billingAddress?.country ?? "Australia",
                                },
                              }
                            : current,
                        );
                      }}
                      className={validation.hasClientAddress ? "" : "border-[#E2445C]/50"}
                    />
                  </div>
                </div>
                <div className="grid gap-4 md:grid-cols-4">
                  <div className="md:col-span-2">
                    <label className="mb-1 block text-sm font-medium text-[#323338]">Suburb</label>
                    <Input
                      value={clientDraft?.billingAddress?.suburb ?? ""}
                      onChange={(event) => {
                        setClientDraft((current) =>
                          current
                            ? {
                                ...current,
                                billingAddress: {
                                  line1: current.billingAddress?.line1 ?? "",
                                  line2: current.billingAddress?.line2,
                                  suburb: event.target.value,
                                  state: current.billingAddress?.state ?? "",
                                  postcode: current.billingAddress?.postcode ?? "",
                                  country: current.billingAddress?.country ?? "Australia",
                                },
                              }
                            : current,
                        );
                      }}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-[#323338]">State</label>
                    <Input
                      value={clientDraft?.billingAddress?.state ?? ""}
                      onChange={(event) => {
                        setClientDraft((current) =>
                          current
                            ? {
                                ...current,
                                billingAddress: {
                                  line1: current.billingAddress?.line1 ?? "",
                                  line2: current.billingAddress?.line2,
                                  suburb: current.billingAddress?.suburb ?? "",
                                  state: event.target.value,
                                  postcode: current.billingAddress?.postcode ?? "",
                                  country: current.billingAddress?.country ?? "Australia",
                                },
                              }
                            : current,
                        );
                      }}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-[#323338]">Postcode</label>
                    <Input
                      value={clientDraft?.billingAddress?.postcode ?? ""}
                      onChange={(event) => {
                        setClientDraft((current) =>
                          current
                            ? {
                                ...current,
                                billingAddress: {
                                  line1: current.billingAddress?.line1 ?? "",
                                  line2: current.billingAddress?.line2,
                                  suburb: current.billingAddress?.suburb ?? "",
                                  state: current.billingAddress?.state ?? "",
                                  postcode: event.target.value,
                                  country: current.billingAddress?.country ?? "Australia",
                                },
                              }
                            : current,
                        );
                      }}
                    />
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button
                    variant="secondary"
                    onClick={() => saveClientMutation.mutate()}
                    disabled={saveClientMutation.isPending}
                  >
                    Save client details
                  </Button>
                </div>
              </div>
            ) : null}

            {step === 4 ? (
              <div className="space-y-5">
                <div>
                  <h3 className="text-xl font-semibold text-[#323338]">4. Review Financial Markup</h3>
                  <p className="mt-1 text-sm text-[#676879]">
                    Confirm the material markup for this document. Job default is{" "}
                    {getJobMaterialMarkupPercent(job)}% — adjust here for a one-off override.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-sm text-[#676879]">Markup rate</span>
                  <MaterialMarkupStepper value={chosenMarkupPercent} onChange={setChosenMarkupPercent} />
                </div>
                <div className="rounded-lg border border-[#0073EA]/20 bg-[#DDF4FF]/40 p-4 text-sm">
                  <p className="font-semibold text-[#0073EA]">Live cost impact</p>
                  <div className="mt-3 space-y-2 font-mono text-[#323338]">
                    <div className="flex justify-between gap-4">
                      <span className="text-[#676879]">Materials subtotal (selected)</span>
                      <span>{formatCurrency(totals.materialSubtotalCents)}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-[#676879]">Markup ({chosenMarkupPercent}%)</span>
                      <span>{formatCurrency(totals.markupCents)}</span>
                    </div>
                    <div className="flex justify-between gap-4 border-t border-[#E6E9EF] pt-2">
                      <span className="text-[#676879]">Document subtotal + markup</span>
                      <span>{formatCurrency(totals.subtotalCents + totals.markupCents)}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-[#676879]">GST (10%)</span>
                      <span>{formatCurrency(totals.taxCents)}</span>
                    </div>
                    <div className="flex justify-between gap-4 font-semibold">
                      <span>PDF total</span>
                      <span>{formatCurrency(totals.totalCents)}</span>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {step === 5 ? (
              <div className="space-y-5">
                <div>
                  <h3 className="text-xl font-semibold text-[#323338]">5. Finalization</h3>
                  <p className="mt-1 text-sm text-[#676879]">
                    Generate the draft PDF. You will refine wording and layout in the Document
                    Studio before saving to the job.
                  </p>
                </div>
                <div className="rounded-lg border border-[#E6E9EF] bg-[#F5F6F8] p-4 text-sm text-[#676879]">
                  <p>
                    Document number:{" "}
                    <span className="font-semibold text-[#323338]">{documentNumber}</span>
                  </p>
                  <p>
                    Items selected:{" "}
                    <span className="font-semibold text-[#323338]">{selectedItems.length}</span>
                  </p>
                  <p>
                    Template:{" "}
                    <span className="font-semibold text-[#323338]">
                      {selectedTemplate?.name ?? "Not selected"}
                    </span>
                  </p>
                  <p>
                    Material markup:{" "}
                    <span className="font-semibold text-[#323338]">{chosenMarkupPercent}%</span> (
                    {formatCurrency(totals.markupCents)})
                  </p>
                  <p>
                    Total:{" "}
                    <span className="font-semibold text-[#323338]">
                      {formatCurrency(totals.totalCents)}
                    </span>
                  </p>
                </div>
                {!canGenerate ? (
                  <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    Complete client address, select a template, and ensure your business ABN is set
                    in Settings before generating.
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* Summary sidebar */}
          <aside className="flex w-80 shrink-0 flex-col gap-4 overflow-y-auto border-l border-[#E6E9EF] bg-[#F5F6F8] p-6">
            <div className="rounded-lg border border-[#E6E9EF] bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3 border-b border-[#E6E9EF] pb-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[#676879]">
                    Live preview
                  </p>
                  <h3
                    className="mt-1 text-lg font-semibold"
                    style={{ color: selectedTemplate?.style.accentColor ?? "#323338" }}
                  >
                    {documentType === "invoice" ? "Invoice" : "Quote"}
                  </h3>
                  <p className="text-xs text-[#676879]">{documentNumber}</p>
                </div>
                {settings?.businessProfile.logoUrl ? (
                  <NextImage
                    src={settings.businessProfile.logoUrl}
                    alt="Company logo"
                    width={96}
                    height={40}
                    unoptimized
                    className="h-10 max-w-[96px] object-contain"
                  />
                ) : null}
              </div>
              <p className="mt-3 text-xs text-[#676879]">
                Sections:{" "}
                {(selectedTemplate?.style.sectionOrder ?? [
                  "header",
                  "client",
                  "lineItems",
                  "totals",
                  "payment",
                ]).join(" / ")}
              </p>
            </div>

            <div className="rounded-lg border border-[#E6E9EF] bg-white p-4 shadow-sm">
              <p className="text-sm font-semibold text-[#323338]">Client</p>
              <p className="mt-1 text-sm text-[#676879]">{clientDraft?.displayName ?? "Client"}</p>
              <p
                className={cn(
                  "mt-1 text-xs",
                  validation.hasClientAddress ? "text-[#676879]" : "text-[#E2445C]",
                )}
              >
                Billing address {validation.hasClientAddress ? "ready" : "missing"}
              </p>
            </div>

            <div className="rounded-lg border border-[#E6E9EF] bg-white p-4 shadow-sm">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-semibold text-[#323338]">Totals</p>
                {selectedTemplate?.style.showLargeTotal ? (
                  <span
                    className="text-base font-semibold tabular-nums"
                    style={{ color: selectedTemplate?.style.accentColor ?? "#323338" }}
                  >
                    {formatCurrency(totals.totalCents)}
                  </span>
                ) : null}
              </div>
              <div className="space-y-1 text-sm text-[#676879]">
                <div className="flex justify-between">
                  <span>Subtotal</span>
                  <span className="tabular-nums">{formatCurrency(totals.subtotalCents)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Markup ({chosenMarkupPercent}%)</span>
                  <span className="tabular-nums">{formatCurrency(totals.markupCents)}</span>
                </div>
                <div className="flex justify-between">
                  <span>GST</span>
                  <span className="tabular-nums">{formatCurrency(totals.taxCents)}</span>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-[#E6E9EF] bg-white p-4 text-sm text-[#676879] shadow-sm">
              <p className="font-semibold text-[#323338]">Template rules</p>
              <p className="mt-1">
                {selectedTemplate?.style.groupLaborAndMaterialsSeparately
                  ? "Labor and materials are grouped separately."
                  : "All selected items are shown in one table."}
              </p>
              <p className="mt-1">Spacing: {selectedTemplate?.style.spacing ?? "normal"}</p>
            </div>

            {!validation.hasBusinessAbn ? (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                Business ABN/ACN is missing in Settings. Finalization is blocked.
              </p>
            ) : null}
          </aside>
        </div>

        {/* Footer navigation */}
        <footer className="flex shrink-0 items-center justify-between border-t border-[#E6E9EF] bg-white p-4">
          <Button
            variant="secondary"
            disabled={step === 1 || generateMutation.isPending}
            onClick={() => setStep((current) => Math.max(1, current - 1) as WizardStep)}
          >
            Back
          </Button>
          {step < 5 ? (
            <Button
              disabled={generateMutation.isPending}
              onClick={() => setStep((current) => Math.min(5, current + 1) as WizardStep)}
            >
              Next
            </Button>
          ) : (
            <Button
              disabled={generateMutation.isPending || !canGenerate}
              onClick={() => generateMutation.mutate()}
            >
              {generateMutation.isPending ? "Generating…" : "Generate"}
            </Button>
          )}
        </footer>
      </div>
    </div>
  );
}
