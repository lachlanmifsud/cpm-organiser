import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  parseInvoiceDocumentBody,
  parseQuoteDocumentBody,
} from "@/lib/ai/document-body-shared";
import { extractAndParseJSON } from "@/lib/ai/parse-ai-json";
import type { Client } from "@/types/database";
import {
  parseThemeOverrides,
  type DocumentRefinementAiDelta,
  type DocumentRefinementPayload,
} from "@/lib/document-refinement-payload";

const REFINEMENT_JSON_RULES = `
CRITICAL INSTRUCTION: You are a programmatic data processor. You must return ONLY a raw, valid JSON object.
DO NOT wrap the output in Markdown formatting or code blocks. DO NOT include any conversational text, greetings, or explanations.
Start your response with { and end with }.`;

const REFINEMENT_PERMISSIONS = `You have full control over the JSON payload. If the user asks to change the client's name or address, update the client object. If the user asks to change the visual look (e.g., 'make the text pink' or 'use blue accents'), update the themeOverrides.primaryTextColor or themeOverrides.accentColor fields with valid CSS color strings. Apply ALL requested changes, no matter how unusual, as long as they fit the JSON structure.`;

export type RefineDocumentInput = {
  apiKey: string;
  payload: DocumentRefinementPayload;
  userMessage: string;
};

function parseRefinementDelta(
  raw: unknown,
  payload: DocumentRefinementPayload,
): DocumentRefinementAiDelta {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }

  let source = raw as Record<string, unknown>;
  if (
    source.delta &&
    typeof source.delta === "object" &&
    !Array.isArray(source.delta) &&
    source.subtotalCents === undefined &&
    source.totalCents === undefined &&
    source.quoteBody === undefined &&
    source.invoiceBody === undefined &&
    source.client === undefined &&
    source.themeOverrides === undefined
  ) {
    source = source.delta as Record<string, unknown>;
  }

  const o = source;
  const delta: DocumentRefinementAiDelta = {};

  if (typeof o.subtotalCents === "number") {
    delta.subtotalCents = o.subtotalCents;
  }
  if (typeof o.markupCents === "number") {
    delta.markupCents = o.markupCents;
  }
  if (typeof o.markupPercent === "number") {
    delta.markupPercent = o.markupPercent;
  }
  if (typeof o.taxCents === "number") {
    delta.taxCents = o.taxCents;
  }
  if (typeof o.totalCents === "number") {
    delta.totalCents = o.totalCents;
  }

  if (o.client && typeof o.client === "object" && !Array.isArray(o.client)) {
    delta.client = o.client as Partial<Client>;
  }

  const themeOverrides = parseThemeOverrides(o.themeOverrides);
  if (themeOverrides) {
    delta.themeOverrides = themeOverrides;
  }
  if (typeof o.accentColor === "string" && o.accentColor.trim()) {
    delta.accentColor = o.accentColor.trim();
  }

  if (payload.documentType === "quote" && o.quoteBody) {
    delta.quoteBody = parseQuoteDocumentBody(o.quoteBody, payload.lineItems);
  }
  if (payload.documentType === "invoice" && o.invoiceBody) {
    delta.invoiceBody = parseInvoiceDocumentBody(o.invoiceBody, payload.lineItems);
  }

  return delta;
}

export async function refineDocumentPayloadWithGemini(
  input: RefineDocumentInput,
): Promise<DocumentRefinementAiDelta> {
  const genAI = new GoogleGenerativeAI(input.apiKey);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction: `You refine Australian construction ${input.payload.documentType} document JSON payloads.
Apply the user's instruction precisely. Return JSON only with optional fields you change:
subtotalCents, markupCents, markupPercent, taxCents, totalCents, client, themeOverrides (primaryTextColor, accentColor), accentColor, and either quoteBody or invoiceBody depending on document type.
Money is whole AUD cents. When applying discounts, adjust totals consistently and update narrative copy in the AI body sections.
Do not invent line items that are not supported by the payload context.
${REFINEMENT_PERMISSIONS}
${REFINEMENT_JSON_RULES}`,
    generationConfig: {
      responseMimeType: "application/json",
    },
  });

  const context = {
    documentType: input.payload.documentType,
    documentNumber: input.payload.documentNumber,
    client: input.payload.client,
    themeOverrides: input.payload.themeOverrides,
    accentColor: input.payload.accentColor,
    totals: {
      subtotalCents: input.payload.subtotalCents,
      markupCents: input.payload.markupCents,
      markupPercent: input.payload.markupPercent,
      taxCents: input.payload.taxCents,
      totalCents: input.payload.totalCents,
    },
    lineItems: input.payload.lineItems.map((item) => ({
      id: item.id,
      kind: item.kind,
      description: item.description,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      subtotalCents: item.subtotalCents,
    })),
    quoteBody: input.payload.quoteBody,
    invoiceBody: input.payload.invoiceBody,
  };

  const result = await model.generateContent([
    "Current document payload:",
    JSON.stringify(context, null, 2),
    "",
    "User refinement request:",
    input.userMessage.trim(),
    "",
    "Return a JSON object with only the fields you changed. Include client when name or address changes. Include themeOverrides when colors or visual styling changes. Include quoteBody for quotes or invoiceBody for invoices when copy or line presentation must change.",
  ]);

  const rawText = result.response.text().trim();
  const parsed = extractAndParseJSON<unknown>(
    rawText,
    "AI returned invalid JSON for document refinement.",
  );

  return parseRefinementDelta(parsed, input.payload);
}
