import { GoogleGenerativeAI } from "@google/generative-ai";
import type { Client, Job, LineItem } from "@/types/database";
import {
  buildDocumentBodyUserPayload,
  composeSystemInstruction,
  invoiceDocumentResponseSchema,
  parseInvoiceDocumentBody,
  parseQuoteDocumentBody,
  quoteDocumentResponseSchema,
  stripJsonFences,
  type InvoiceDocumentAiBody,
  type QuoteDocumentAiBody,
} from "@/lib/ai/document-body-shared";

export type GenerateDocumentBodyInput = {
  apiKey: string;
  documentType: "quote" | "invoice";
  /** Prefer Firestore-backed value in production; empty uses defaults inside composeSystemInstruction. */
  customSystemPrompt?: string | null;
  job: Job;
  client: Client;
  lineItems: LineItem[];
  subtotalCents: number;
  markupCents: number;
  taxCents: number;
  totalCents: number;
  chosenMarkupPercent?: number;
};

export async function generateDocumentBodyWithGemini(
  input: GenerateDocumentBodyInput,
): Promise<QuoteDocumentAiBody | InvoiceDocumentAiBody> {
  const genAI = new GoogleGenerativeAI(input.apiKey);
  const systemInstruction = composeSystemInstruction(input.documentType, input.customSystemPrompt);
  const schema =
    input.documentType === "quote" ? quoteDocumentResponseSchema() : invoiceDocumentResponseSchema();

  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: schema,
    },
  });

  const userText = buildDocumentBodyUserPayload({
    documentType: input.documentType,
    job: input.job,
    client: input.client,
    lineItems: input.lineItems,
    subtotalCents: input.subtotalCents,
    markupCents: input.markupCents,
    taxCents: input.taxCents,
    totalCents: input.totalCents,
    chosenMarkupPercent: input.chosenMarkupPercent,
  });

  const result = await model.generateContent([
    "Generate the document JSON body from this payload:",
    userText,
  ]);

  const rawText = stripJsonFences(result.response.text().trim());
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    parsed = null;
  }

  if (input.documentType === "quote") {
    return parseQuoteDocumentBody(parsed, input.lineItems);
  }
  return parseInvoiceDocumentBody(parsed, input.lineItems);
}
