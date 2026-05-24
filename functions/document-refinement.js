/**
 * Document refinement AI — mirrors src/lib/ai/document-refinement.ts for Cloud Functions.
 */

const { GoogleGenerativeAI } = require("@google/generative-ai");
const {
  parseQuoteDocumentBody,
  parseInvoiceDocumentBody,
} = require("./document-body");

const REFINEMENT_JSON_RULES = `
CRITICAL INSTRUCTION: You are a programmatic data processor. You must return ONLY a raw, valid JSON object.
DO NOT wrap the output in Markdown formatting or code blocks. DO NOT include any conversational text, greetings, or explanations.
Start your response with { and end with }.`;

const REFINEMENT_PERMISSIONS = `You have full control over the JSON payload. If the user asks to change the client's name or address, update the client object. If the user asks to change the visual look (e.g., 'make the text pink' or 'use blue accents'), update the themeOverrides.primaryTextColor or themeOverrides.accentColor fields with valid CSS color strings. Apply ALL requested changes, no matter how unusual, as long as they fit the JSON structure.`;

function stripJsonFences(raw) {
  return raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

function extractAndParseJSON(rawResponse, errorMessage) {
  const withoutFences = stripJsonFences(String(rawResponse || "").trim());
  if (!withoutFences) {
    throw new Error(errorMessage);
  }

  try {
    return JSON.parse(withoutFences);
  } catch {
    // fall through
  }

  const startIndex = withoutFences.indexOf("{");
  const endIndex = withoutFences.lastIndexOf("}");

  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    throw new Error(errorMessage);
  }

  const cleanString = withoutFences.substring(startIndex, endIndex + 1);
  try {
    return JSON.parse(cleanString);
  } catch {
    throw new Error(errorMessage);
  }
}

function parseThemeOverrides(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }
  const o = raw;
  const out = {};
  if (typeof o.primaryTextColor === "string" && o.primaryTextColor.trim()) {
    out.primaryTextColor = o.primaryTextColor.trim();
  }
  if (typeof o.accentColor === "string" && o.accentColor.trim()) {
    out.accentColor = o.accentColor.trim();
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseRefinementDelta(raw, payload) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }

  let source = raw;
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
    source = source.delta;
  }

  const delta = {};

  if (typeof source.subtotalCents === "number") {
    delta.subtotalCents = source.subtotalCents;
  }
  if (typeof source.markupCents === "number") {
    delta.markupCents = source.markupCents;
  }
  if (typeof source.markupPercent === "number") {
    delta.markupPercent = source.markupPercent;
  }
  if (typeof source.taxCents === "number") {
    delta.taxCents = source.taxCents;
  }
  if (typeof source.totalCents === "number") {
    delta.totalCents = source.totalCents;
  }

  if (source.client && typeof source.client === "object" && !Array.isArray(source.client)) {
    delta.client = source.client;
  }

  const themeOverrides = parseThemeOverrides(source.themeOverrides);
  if (themeOverrides) {
    delta.themeOverrides = themeOverrides;
  }
  if (typeof source.accentColor === "string" && source.accentColor.trim()) {
    delta.accentColor = source.accentColor.trim();
  }

  if (payload.documentType === "quote" && source.quoteBody) {
    delta.quoteBody = parseQuoteDocumentBody(source.quoteBody, payload.lineItems);
  }
  if (payload.documentType === "invoice" && source.invoiceBody) {
    delta.invoiceBody = parseInvoiceDocumentBody(source.invoiceBody, payload.lineItems);
  }

  return delta;
}

async function refineDocumentPayloadWithGemini({ apiKey, payload, userMessage }) {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction: `You refine Australian construction ${payload.documentType} document JSON payloads.
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
    documentType: payload.documentType,
    documentNumber: payload.documentNumber,
    client: payload.client,
    themeOverrides: payload.themeOverrides,
    accentColor: payload.accentColor,
    totals: {
      subtotalCents: payload.subtotalCents,
      markupCents: payload.markupCents,
      markupPercent: payload.markupPercent,
      taxCents: payload.taxCents,
      totalCents: payload.totalCents,
    },
    lineItems: payload.lineItems.map((item) => ({
      id: item.id,
      kind: item.kind,
      description: item.description,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      subtotalCents: item.subtotalCents,
    })),
    quoteBody: payload.quoteBody,
    invoiceBody: payload.invoiceBody,
  };

  const result = await model.generateContent([
    "Current document payload:",
    JSON.stringify(context, null, 2),
    "",
    "User refinement request:",
    String(userMessage || "").trim(),
    "",
    "Return a JSON object with only the fields you changed. Include client when name or address changes. Include themeOverrides when colors or visual styling changes. Include quoteBody for quotes or invoiceBody for invoices when copy or line presentation must change.",
  ]);

  const rawText = result.response.text().trim();
  const parsed = extractAndParseJSON(rawText, "AI returned invalid JSON for document refinement.");
  return parseRefinementDelta(parsed, payload);
}

module.exports = {
  refineDocumentPayloadWithGemini,
};
