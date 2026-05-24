import { NextResponse } from "next/server";
import { generateDocumentBodyWithGemini } from "@/lib/ai/document-body-generation";
import type { Client, Job, LineItem } from "@/types/database";

const MAX_JSON_CHARS = 180_000;

function readString(obj: unknown, key: string): string | undefined {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    return undefined;
  }
  const v = (obj as Record<string, unknown>)[key];
  return typeof v === "string" ? v : undefined;
}

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Server misconfiguration: GEMINI_API_KEY is not set." },
      { status: 500 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON body." }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const documentType = b.documentType === "quote" || b.documentType === "invoice" ? b.documentType : null;
  if (!documentType) {
    return NextResponse.json({ error: 'Missing or invalid "documentType" (quote | invoice).' }, { status: 400 });
  }

  const raw = JSON.stringify(body);
  if (raw.length > MAX_JSON_CHARS) {
    return NextResponse.json({ error: "Payload too large." }, { status: 400 });
  }

  const job = b.job as Job | undefined;
  const client = b.client as Client | undefined;
  const lineItems = b.lineItems as LineItem[] | undefined;
  if (!job || !client || !Array.isArray(lineItems) || lineItems.length === 0) {
    return NextResponse.json({ error: "Missing job, client, or lineItems." }, { status: 400 });
  }

  const subtotalCents = Number(b.subtotalCents);
  const markupCents = Number(b.markupCents);
  const taxCents = Number(b.taxCents);
  const totalCents = Number(b.totalCents);
  if (![subtotalCents, markupCents, taxCents, totalCents].every((n) => Number.isFinite(n))) {
    return NextResponse.json({ error: "Invalid totals." }, { status: 400 });
  }

  const invoiceSystemPrompt = readString(b, "invoiceSystemPrompt");
  const quoteSystemPrompt = readString(b, "quoteSystemPrompt");
  const customSystemPrompt = documentType === "invoice" ? invoiceSystemPrompt : quoteSystemPrompt;
  const chosenMarkupPercent =
    typeof b.chosenMarkupPercent === "number" && Number.isFinite(b.chosenMarkupPercent)
      ? Math.min(100, Math.max(0, Math.round(b.chosenMarkupPercent)))
      : undefined;

  try {
    const out = await generateDocumentBodyWithGemini({
      apiKey,
      documentType,
      customSystemPrompt,
      job,
      client,
      lineItems,
      subtotalCents,
      markupCents,
      taxCents,
      totalCents,
      chosenMarkupPercent,
    });
    return NextResponse.json({ documentType, body: out });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Gemini request failed.";
    console.error("[generate-document-body]", e);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
