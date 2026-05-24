import type { Job, LineItem } from "@/types/database";

export const DEFAULT_MATERIAL_MARKUP_PERCENT = 15;
export const MATERIAL_MARKUP_STEP = 5;
export const MIN_MATERIAL_MARKUP_PERCENT = 0;
export const MAX_MATERIAL_MARKUP_PERCENT = 100;

export function clampMaterialMarkupPercent(value: number) {
  return Math.min(
    MAX_MATERIAL_MARKUP_PERCENT,
    Math.max(MIN_MATERIAL_MARKUP_PERCENT, Math.round(value)),
  );
}

export function getJobMaterialMarkupPercent(job?: Pick<Job, "materialMarkupPercent"> | null) {
  if (typeof job?.materialMarkupPercent === "number" && Number.isFinite(job.materialMarkupPercent)) {
    return clampMaterialMarkupPercent(job.materialMarkupPercent);
  }
  return DEFAULT_MATERIAL_MARKUP_PERCENT;
}

export function sumUnbilledMaterialSubtotalCents(items: LineItem[]) {
  return items
    .filter((item) => item.kind === "material" && item.status === "unbilled" && !item.deletedAt)
    .reduce((sum, item) => sum + item.subtotalCents, 0);
}

export function sumMaterialSubtotalCents(items: LineItem[]) {
  return items
    .filter((item) => item.kind === "material")
    .reduce((sum, item) => sum + item.subtotalCents, 0);
}

export function computeMaterialMarkupCents(materialSubtotalCents: number, markupPercent: number) {
  const pct = clampMaterialMarkupPercent(markupPercent);
  return Math.round(materialSubtotalCents * (pct / 100));
}

export function computeDocumentTotals(
  subtotalCents: number,
  materialSubtotalCents: number,
  markupPercent: number,
) {
  const markupCents = computeMaterialMarkupCents(materialSubtotalCents, markupPercent);
  const preTaxTotalCents = subtotalCents + markupCents;
  const taxCents = Math.round(preTaxTotalCents * 0.1);
  const totalCents = preTaxTotalCents + taxCents;

  return {
    markupCents,
    taxCents,
    totalCents,
    materialSubtotalCents,
    preTaxTotalCents,
  };
}

/** Retail total (subtotal + materials markup + GST) for items not yet invoiced. */
export function computeRemainingToBillTotalCents(items: LineItem[], markupPercent: number) {
  const remainingItems = items.filter((item) => !item.deletedAt && item.status !== "invoiced");
  const subtotalCents = remainingItems.reduce((sum, item) => sum + item.subtotalCents, 0);
  const materialSubtotalCents = sumMaterialSubtotalCents(remainingItems);
  return computeDocumentTotals(subtotalCents, materialSubtotalCents, markupPercent).totalCents;
}
