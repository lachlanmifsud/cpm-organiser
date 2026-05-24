import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";
import {
  parseTemplateArchitectModelText,
  TEMPLATE_ARCHITECT_SYSTEM_INSTRUCTION,
} from "@/lib/ai/template-architect-shared";

const MAX_PROMPT_CHARS = 12_000;

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

  const prompt =
    body &&
    typeof body === "object" &&
    typeof (body as { prompt?: unknown }).prompt === "string"
      ? (body as { prompt: string }).prompt.trim()
      : "";

  if (!prompt) {
    return NextResponse.json({ error: 'Missing or empty "prompt" field.' }, { status: 400 });
  }
  if (prompt.length > MAX_PROMPT_CHARS) {
    return NextResponse.json({ error: "Prompt is too long." }, { status: 400 });
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction: TEMPLATE_ARCHITECT_SYSTEM_INSTRUCTION,
  });

  try {
    const result = await model.generateContent([
      "Create a PDF style object for this construction document layout goal:",
      prompt,
    ]);

    const rawText = result.response.text().trim();
    const out = parseTemplateArchitectModelText(rawText);
    return NextResponse.json(out);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Gemini request failed.";
    console.error("[generate-template]", e);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
