import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";
import type { ExtractedReceiptItem, ExtractedReceiptMeta } from "@/lib/ai/extract-receipt-client";

const allowedMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

const prompt = `You are parsing a retail / trade receipt image (trade / hardware store style).

Return ONLY valid JSON (no markdown) with this exact shape:
{"vendorName":"string","receiptDate":"YYYY-MM-DD","totalGstCents":number|null,"items":[{"description":"string","rawDescription":"string","quantity":number,"unitPriceCents":number,"subtotalCents":number}]}

Root fields (header / totals):
- vendorName: business or store name from the receipt header or letterhead. Use empty string if illegible.
- receiptDate: transaction date as YYYY-MM-DD when clearly visible; otherwise empty string.
- totalGstCents: total GST or tax amount for the sale in whole integer cents (AUD). Use the printed GST/tax total line (not the grand total inc-GST). Use null only when no separate GST/tax total exists on the receipt.

For every product line item in "items", output:
1) "description" — a short, professional, human-readable product title. Strip barcodes (EAN/UPC), internal SKU codes, and noisy tokens unless they are essential to identify the product. Expand common abbreviations (e.g. BLK → Black) only when obvious from context. Do not invent model numbers not visible on the line.
2) "rawDescription" — the exact literal line text as printed on the receipt for that row (include barcodes, codes, and abbreviations exactly as shown).

Also per line: quantity, unit price in cents (integer), line subtotal in cents (integer).

Rules:
- All money fields must be whole integers in cents (AUD).
- If quantity is missing on the receipt, use 1.
- If unit price is missing but line total and quantity exist, derive unitPriceCents = round(subtotalCents / quantity).
- Skip non-product rows (payment lines, totals-only, GST summary as a single tax line is not a product row, loyalty) unless they are clearly a purchasable SKU line.
- rawDescription must be non-empty whenever a line is included; copy it faithfully from the receipt image for that line.
`;

function num(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) {
    return v;
  }
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) {
    return Number(v);
  }
  return fallback;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function normalizeExtractedItems(items: unknown): ExtractedReceiptItem[] | null {
  if (!Array.isArray(items)) {
    return null;
  }
  const out: ExtractedReceiptItem[] = [];
  for (const row of items) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const r = row as Record<string, unknown>;
    const description = str(r.description);
    const rawDescription = str(r.rawDescription) || description;
    const title = description || rawDescription;
    if (!title) {
      continue;
    }
    const qty = num(r.quantity, 1);
    const unitPriceCents = Math.round(num(r.unitPriceCents, 0));
    const subtotalCents = Math.round(num(r.subtotalCents, 0));
    out.push({
      description: description || rawDescription,
      rawDescription: rawDescription || description,
      quantity: qty > 0 ? qty : 1,
      unitPriceCents,
      subtotalCents,
    });
  }
  return out;
}

function normalizeReceiptMeta(root: Record<string, unknown>): ExtractedReceiptMeta {
  if (!root || Array.isArray(root)) {
    return { vendorName: null, receiptDate: null, totalGstCents: null };
  }
  const vendorName = str(root.vendorName) || null;
  const receiptDate = str(root.receiptDate) || null;
  let totalGstCents: number | null = null;
  const g = root.totalGstCents;
  if (g !== null && g !== undefined && g !== "") {
    const n = Math.round(num(g as unknown, NaN));
    if (Number.isFinite(n)) {
      totalGstCents = n;
    }
  }
  return { vendorName, receiptDate, totalGstCents };
}

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Server misconfiguration: GEMINI_API_KEY is not set." },
      { status: 500 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data body." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof Blob) || file.size === 0) {
    return NextResponse.json({ error: 'Missing or empty "file" field.' }, { status: 400 });
  }

  const mimeFromField = form.get("mimeType");
  const declaredMime =
    typeof mimeFromField === "string" && allowedMimeTypes.has(mimeFromField) ? mimeFromField : "";

  const mimeType =
    file.type && allowedMimeTypes.has(file.type) ? file.type : declaredMime;
  if (!mimeType) {
    return NextResponse.json(
      { error: "Unsupported image type. Use JPEG, PNG, WebP, HEIC, or HEIF." },
      { status: 400 },
    );
  }

  const arrayBuffer = await file.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  try {
    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          mimeType,
          data: base64,
        },
      },
    ]);

    const text = result.response.text().trim();
    let jsonText = text;
    if (jsonText.startsWith("```")) {
      jsonText = jsonText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    }

    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    const items = normalizeExtractedItems(parsed.items);
    if (!items) {
      return NextResponse.json({ error: "Model returned an invalid JSON shape." }, { status: 502 });
    }

    const meta = normalizeReceiptMeta(parsed);
    return NextResponse.json({ ...meta, items });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Gemini request failed.";
    console.error("[extract-receipt]", e);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
