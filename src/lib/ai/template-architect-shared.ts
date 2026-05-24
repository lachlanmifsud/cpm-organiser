import type { PdfTemplateStyle } from "@/types/database";

export const TEMPLATE_ARCHITECT_SYSTEM_INSTRUCTION = `You design clean construction quote and invoice layouts.
Return ONLY valid JSON with this exact shape:
{
  "suggestedName": string,
  "style": {
    "tone": string,
    "accentColor": string,
    "fontFamily": string,
    "headingSize": number,
    "bodySize": number,
    "sectionOrder": string[],
    "groupLaborAndMaterialsSeparately": boolean,
    "showLargeTotal": boolean,
    "tableStyle": "compact" | "comfortable" | "minimal",
    "spacing": "tight" | "normal" | "relaxed"
  }
}
The layout must be professional, black-on-white, readable in print, and suitable for Australian building clients.`;

function stripCodeFences(rawText: string) {
  return rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

export function normalizePdfTemplateStyle(style: Partial<PdfTemplateStyle> | undefined): PdfTemplateStyle {
  return {
    tone: style?.tone?.trim() || "Professional",
    accentColor: style?.accentColor?.trim() || "#111111",
    fontFamily: style?.fontFamily?.trim() || "Helvetica",
    headingSize: Number(style?.headingSize ?? 22),
    bodySize: Number(style?.bodySize ?? 10),
    sectionOrder:
      style?.sectionOrder?.filter((section): section is string => Boolean(section?.trim())) ?? [
        "header",
        "client",
        "lineItems",
        "totals",
        "payment",
      ],
    groupLaborAndMaterialsSeparately: Boolean(style?.groupLaborAndMaterialsSeparately),
    showLargeTotal: style?.showLargeTotal ?? true,
    tableStyle:
      style?.tableStyle === "compact" ||
      style?.tableStyle === "comfortable" ||
      style?.tableStyle === "minimal"
        ? style.tableStyle
        : "comfortable",
    spacing:
      style?.spacing === "tight" || style?.spacing === "normal" || style?.spacing === "relaxed"
        ? style.spacing
        : "normal",
  };
}

export function parseTemplateArchitectModelText(rawText: string): {
  suggestedName: string;
  style: PdfTemplateStyle;
} {
  const jsonText = stripCodeFences(rawText);
  const parsed = JSON.parse(jsonText) as {
    suggestedName?: string;
    style?: Partial<PdfTemplateStyle>;
  };

  return {
    suggestedName: parsed.suggestedName?.trim() || "AI Template",
    style: normalizePdfTemplateStyle(parsed.style),
  };
}
