"use client";

import { useState } from "react";
import { toast } from "sonner";
import { DocumentRefinementStudio } from "@/components/document-refinement-studio";
import { DocumentWizard } from "@/components/document-wizard";
import { finalizeJobDocument } from "@/lib/firebase/repository";
import type { DocumentRefinementPayload } from "@/lib/document-refinement-payload";
import { Client, Job, JobDocumentRecord, LineItem, UserSettings } from "@/types/database";

type DocumentGenerationWizardProps = {
  isOpen: boolean;
  onClose: () => void;
  job: Job;
  client: Client | null;
  lineItems: LineItem[];
  settings: UserSettings | null;
  documents: JobDocumentRecord[];
  selectedItemIds: string[];
  onGenerated: () => Promise<void> | void;
  onClientUpdated: () => Promise<void> | void;
};

/**
 * Orchestrates the pre-generation DocumentWizard and post-generation DocumentRefinementStudio.
 * Only one surface is mounted at a time.
 */
export function DocumentGenerationWizard({
  isOpen,
  onClose,
  job,
  client,
  lineItems,
  settings,
  documents,
  selectedItemIds,
  onGenerated,
  onClientUpdated,
}: DocumentGenerationWizardProps) {
  const [studioPayload, setStudioPayload] = useState<DocumentRefinementPayload | null>(null);

  const handleStudioFinalize = async (
    payload: DocumentRefinementPayload,
    pdfFile: File,
    meta: { commitMessage: string },
  ) => {
    await finalizeJobDocument({
      jobId: job.id,
      clientId: payload.client.id,
      documentType: payload.documentType,
      documentNumber: payload.documentNumber,
      templateId: payload.templateId,
      templateName: payload.templateName,
      lineItemIds: payload.lineItems.map((item) => item.id),
      lineItemSnapshots: payload.lineItems.map((item) => ({
        id: item.id,
        totalCents: item.totalCents,
        quantity: item.quantity,
      })),
      subtotalCents: payload.subtotalCents,
      markupCents: payload.markupCents,
      taxCents: payload.taxCents,
      totalCents: payload.totalCents,
      refinementPayload: payload,
      pdfFile,
    });
    toast.success(
      meta.commitMessage === "Initial Generation"
        ? "PDF saved successfully"
        : "Document saved successfully",
    );
    await onGenerated();
    setStudioPayload(null);
    onClose();
  };

  const handleStudioCancel = () => {
    setStudioPayload(null);
    onClose();
  };

  const handleGenerateComplete = (payload: DocumentRefinementPayload) => {
    setStudioPayload(payload);
  };

  if (studioPayload) {
    return (
      <DocumentRefinementStudio
        isOpen
        mode="create"
        initialPayload={studioPayload}
        onCancel={handleStudioCancel}
        onFinalize={handleStudioFinalize}
      />
    );
  }

  return (
    <DocumentWizard
      isOpen={isOpen}
      onClose={onClose}
      job={job}
      client={client}
      lineItems={lineItems}
      settings={settings}
      documents={documents}
      selectedItemIds={selectedItemIds}
      onClientUpdated={onClientUpdated}
      onGenerateComplete={handleGenerateComplete}
    />
  );
}
