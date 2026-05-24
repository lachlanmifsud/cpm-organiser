import { NextResponse } from "next/server";
import { refineDocumentPayloadWithGemini } from "@/lib/ai/document-refinement";
import type { DocumentRefinementPayload } from "@/lib/document-refinement-payload";

const MAX_JSON_CHARS = 220_000;

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
  const payload = b.payload as DocumentRefinementPayload | undefined;
  const userMessage = typeof b.userMessage === "string" ? b.userMessage.trim() : "";

  if (!payload?.documentType || !payload.lineItems?.length) {
    return NextResponse.json({ error: "Missing or invalid document payload." }, { status: 400 });
  }

  if (!userMessage) {
    return NextResponse.json({ error: "userMessage is required." }, { status: 400 });
  }

  if (JSON.stringify(body).length > MAX_JSON_CHARS) {
    return NextResponse.json({ error: "Payload too large." }, { status: 400 });
  }

  try {
    const delta = await refineDocumentPayloadWithGemini({
      apiKey,
      payload,
      userMessage,
    });
    return NextResponse.json({ delta });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Gemini refinement failed.";
    console.error("[refine-document-payload]", e);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
