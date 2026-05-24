import { getIdToken } from "firebase/auth";
import type { Client, Job, LineItem } from "@/types/database";
import type { InvoiceDocumentAiBody, QuoteDocumentAiBody } from "@/lib/ai/document-body-shared";
import { auth } from "@/lib/firebase/client";

export type FetchDocumentBodyInput = {
  documentType: "quote" | "invoice";
  job: Job;
  client: Client;
  lineItems: LineItem[];
  subtotalCents: number;
  markupCents: number;
  taxCents: number;
  totalCents: number;
  chosenMarkupPercent?: number;
  /** Passed for local Next dev; production Cloud Function reads Firestore instead. */
  invoiceSystemPrompt?: string | null;
  quoteSystemPrompt?: string | null;
};

export async function fetchGeneratedDocumentBody(
  input: FetchDocumentBodyInput,
): Promise<QuoteDocumentAiBody | InvoiceDocumentAiBody> {
  const user = auth?.currentUser;
  if (!user) {
    throw new Error("You must be signed in to generate a document.");
  }
  const idToken = await getIdToken(user);

  const headers = new Headers();
  headers.set("Authorization", `Bearer ${idToken}`);
  headers.set("Content-Type", "application/json");

  const apiResponse = await fetch("/api/generate-document-body", {
    method: "POST",
    headers,
    body: JSON.stringify({
      documentType: input.documentType,
      job: input.job,
      client: input.client,
      lineItems: input.lineItems,
      subtotalCents: input.subtotalCents,
      markupCents: input.markupCents,
      taxCents: input.taxCents,
      totalCents: input.totalCents,
      chosenMarkupPercent: input.chosenMarkupPercent,
      invoiceSystemPrompt: input.invoiceSystemPrompt ?? "",
      quoteSystemPrompt: input.quoteSystemPrompt ?? "",
    }),
  });

  const responseText = await apiResponse.text();

  if (!apiResponse.ok) {
    let detail = responseText.slice(0, 500);
    try {
      const errJson = JSON.parse(responseText) as { error?: string };
      if (errJson?.error) {
        detail = errJson.error;
      }
    } catch {
      // use raw
    }
    throw new Error(`Document AI failed (${apiResponse.status}): ${detail}`);
  }

  let parsed: { documentType?: string; body?: unknown };
  try {
    parsed = JSON.parse(responseText) as typeof parsed;
  } catch {
    throw new Error("Failed to parse document AI response.");
  }

  if (!parsed.body || typeof parsed.body !== "object") {
    throw new Error("Document AI returned an invalid payload.");
  }

  return parsed.body as QuoteDocumentAiBody | InvoiceDocumentAiBody;
}
