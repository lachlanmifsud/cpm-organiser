export interface ExtractedReceiptItem {
  description: string;
  quantity: number;
  unitPriceCents: number;
  subtotalCents: number;
}

export interface ExtractedReceipt {
  items: ExtractedReceiptItem[];
}

const allowedMimeTypes = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

export async function extractReceiptClient(params: {
  imageUrl: string;
  mimeType: string;
}) {
  if (!allowedMimeTypes.includes(params.mimeType)) {
    throw new Error("Unsupported image type. Please upload a JPEG, PNG, WebP, HEIC, or HEIF image.");
  }

  const response = await fetch(params.imageUrl);

  if (!response.ok) {
    throw new Error("Unable to fetch receipt image from storage.");
  }

  const blob = await response.blob();
  const fileExtension = params.mimeType.split("/").pop() ?? "jpg";
  const formData = new FormData();
  formData.append("image", blob, `receipt.${fileExtension}`);
  formData.append("mimeType", params.mimeType);

  const apiResponse = await fetch("/api/extract-receipt", {
    method: "POST",
    body: formData,
  });

  if (!apiResponse.ok) {
    const errorText = await apiResponse.text();
    throw new Error(`Receipt extraction failed: ${errorText}`);
  }

  const extracted = (await apiResponse.json()) as ExtractedReceipt;

  if (!Array.isArray(extracted.items)) {
    throw new Error("Receipt extraction returned an invalid payload.");
  }

  return extracted;
}
