import { getIdToken } from "firebase/auth";
import { auth } from "@/lib/firebase/client";

export interface ExtractedReceiptItem {
  /** Human-readable product title (no barcodes / internal codes). */
  description: string;
  /** Verbatim line text from the receipt (SKU, barcodes, store codes preserved). */
  rawDescription: string;
  quantity: number;
  unitPriceCents: number;
  subtotalCents: number;
}

/** Header-level fields returned with line items. */
export interface ExtractedReceiptMeta {
  vendorName: string | null;
  /** Prefer YYYY-MM-DD when visible on the receipt. */
  receiptDate: string | null;
  /** Total GST / tax for the sale, whole cents (AUD). */
  totalGstCents: number | null;
}

export interface ExtractedReceipt extends ExtractedReceiptMeta {
  items: ExtractedReceiptItem[];
}

const allowedMimeTypes = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

function resolveMimeType(file: File | Blob, fallbackMime?: string) {
  const fromBlob = file.type && allowedMimeTypes.includes(file.type) ? file.type : "";
  if (fromBlob) {
    return fromBlob;
  }
  if (fallbackMime && allowedMimeTypes.includes(fallbackMime)) {
    return fallbackMime;
  }
  return "";
}

export async function extractReceiptClient(params: {
  file: File | Blob;
  /** When the Blob has an empty `type` (common after fetch), pass Firestore `mimeType`. */
  mimeTypeFallback?: string;
}) {
  const mimeType = resolveMimeType(params.file, params.mimeTypeFallback);
  if (!mimeType) {
    throw new Error("Unsupported image type. Please upload a JPEG, PNG, WebP, HEIC, or HEIF image.");
  }

  const formData = new FormData();
  formData.append("file", params.file);
  if (!params.file.type && params.mimeTypeFallback) {
    formData.append("mimeType", mimeType);
  }

  const headers = new Headers();
  const user = auth?.currentUser;
  if (!user) {
    throw new Error("You must be signed in to extract receipt line items.");
  }
  const idToken = await getIdToken(user);
  headers.set("Authorization", `Bearer ${idToken}`);

  const apiResponse = await fetch("/api/extract-receipt", {
    method: "POST",
    headers,
    body: formData,
  });

  const responseText = await apiResponse.text();

  if (!apiResponse.ok) {
    let detail = responseText.slice(0, 500);
    try {
      const errJson = JSON.parse(responseText) as { error?: string; detail?: string };
      if (errJson?.error) {
        detail = errJson.detail ? `${errJson.error} (${errJson.detail})` : errJson.error;
      }
    } catch {
      // use raw detail
    }
    throw new Error(`Receipt extraction failed with status ${apiResponse.status}: ${detail}`);
  }

  let extracted: ExtractedReceipt;
  try {
    extracted = JSON.parse(responseText) as ExtractedReceipt;
  } catch (parseError) {
    throw new Error(
      `Failed to parse extraction response: ${parseError instanceof Error ? parseError.message : "Unknown error"}`,
    );
  }

  if (!Array.isArray(extracted.items)) {
    throw new Error("Receipt extraction returned an invalid payload.");
  }

  const root = extracted as unknown as Record<string, unknown>;

  const vendorName =
    typeof root.vendorName === "string" && root.vendorName.trim() !== ""
      ? root.vendorName.trim()
      : null;
  const receiptDate =
    typeof root.receiptDate === "string" && root.receiptDate.trim() !== ""
      ? root.receiptDate.trim()
      : null;

  let totalGstCents: number | null = null;
  const g = root.totalGstCents;
  if (g !== null && g !== undefined && g !== "") {
    const n = typeof g === "number" ? g : Number(g);
    if (Number.isFinite(n)) {
      totalGstCents = Math.round(n);
    }
  }

  extracted.items = extracted.items.map((it) => {
    const desc = typeof it.description === "string" ? it.description.trim() : "";
    const raw =
      typeof it.rawDescription === "string" && it.rawDescription.trim() !== ""
        ? it.rawDescription.trim()
        : desc;
    return {
      description: desc || raw,
      rawDescription: raw || desc,
      quantity: typeof it.quantity === "number" && Number.isFinite(it.quantity) ? it.quantity : 1,
      unitPriceCents: typeof it.unitPriceCents === "number" ? it.unitPriceCents : 0,
      subtotalCents: typeof it.subtotalCents === "number" ? it.subtotalCents : 0,
    };
  });

  extracted.vendorName = vendorName;
  extracted.receiptDate = receiptDate;
  extracted.totalGstCents = totalGstCents;

  return extracted;
}
