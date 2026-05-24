"use strict";

const TEMPLATE_ARCHITECT_SYSTEM_INSTRUCTION = `You design clean construction quote and invoice layouts.
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

function stripCodeFences(rawText) {
  return rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

function normalizePdfTemplateStyle(style) {
  const s = style && typeof style === "object" ? style : {};
  const sectionOrder = Array.isArray(s.sectionOrder)
    ? s.sectionOrder.filter((x) => typeof x === "string" && x.trim())
    : null;
  const tableStyle = s.tableStyle;
  const spacing = s.spacing;
  return {
    tone: typeof s.tone === "string" && s.tone.trim() ? s.tone.trim() : "Professional",
    accentColor:
      typeof s.accentColor === "string" && s.accentColor.trim() ? s.accentColor.trim() : "#111111",
    fontFamily:
      typeof s.fontFamily === "string" && s.fontFamily.trim() ? s.fontFamily.trim() : "Helvetica",
    headingSize: Number.isFinite(Number(s.headingSize)) ? Number(s.headingSize) : 22,
    bodySize: Number.isFinite(Number(s.bodySize)) ? Number(s.bodySize) : 10,
    sectionOrder: sectionOrder && sectionOrder.length ? sectionOrder : ["header", "client", "lineItems", "totals", "payment"],
    groupLaborAndMaterialsSeparately: Boolean(s.groupLaborAndMaterialsSeparately),
    showLargeTotal: s.showLargeTotal !== undefined ? Boolean(s.showLargeTotal) : true,
    tableStyle:
      tableStyle === "compact" || tableStyle === "comfortable" || tableStyle === "minimal"
        ? tableStyle
        : "comfortable",
    spacing:
      spacing === "tight" || spacing === "normal" || spacing === "relaxed" ? spacing : "normal",
  };
}

function parseTemplateArchitectModelText(rawText) {
  const jsonText = stripCodeFences(rawText);
  const parsed = JSON.parse(jsonText);
  const name =
    parsed && typeof parsed.suggestedName === "string" && parsed.suggestedName.trim()
      ? parsed.suggestedName.trim()
      : "AI Template";
  return {
    suggestedName: name,
    style: normalizePdfTemplateStyle(parsed && parsed.style),
  };
}

module.exports = {
  TEMPLATE_ARCHITECT_SYSTEM_INSTRUCTION,
  parseTemplateArchitectModelText,
};
