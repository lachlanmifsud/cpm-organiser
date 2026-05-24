import type { Client, Job, LineItem } from "@/types/database";
import { SchemaType, type ResponseSchema } from "@google/generative-ai";

export type QuotePhaseLineAi = {
  description: string;
  quantity: number;
  unitPriceCents: number;
  subtotalCents: number;
};

export type QuotePhaseAi = {
  phaseName: string;
  lineItems: QuotePhaseLineAi[];
};

export type QuoteDocumentAiBody = {
  introduction: string;
  phases: QuotePhaseAi[];
  closingStatement: string;
};

export type InvoiceLaborLineAi = {
  description: string;
  hours: number;
  hourlyRateCents: number;
  subtotalCents: number;
};

export type InvoiceMaterialLineAi = {
  description: string;
  quantity: number;
  unitPriceCents: number;
  subtotalCents: number;
};

export type InvoiceDocumentAiBody = {
  billingIntroduction: string;
  categorizedLineItems: {
    labor: InvoiceLaborLineAi[];
    materials: InvoiceMaterialLineAi[];
  };
  gstSummaryStatement: string;
};

export const DEFAULT_QUOTE_SYSTEM_INSTRUCTION = `You are an Australian construction quoting assistant.
Write warm, professional copy and organise the supplied ledger line items into logical work phases for the client-facing quote.
Respect the JSON schema exactly; all money fields are whole cents (AUD).`;

export const DEFAULT_INVOICE_SYSTEM_INSTRUCTION = `You are an Australian construction invoicing assistant.
Produce crisp accounting-style copy and split the supplied ledger into labour vs materials for presentation.
Labour descriptions must follow: "Professional Service: [task]".
Respect the JSON schema exactly; all money fields are whole cents (AUD).`;

export function quoteDocumentResponseSchema(): ResponseSchema {
  const lineItemSchema: ResponseSchema = {
    type: SchemaType.OBJECT,
    properties: {
      description: { type: SchemaType.STRING },
      quantity: { type: SchemaType.NUMBER },
      unitPriceCents: { type: SchemaType.INTEGER },
      subtotalCents: { type: SchemaType.INTEGER },
    },
    required: ["description", "quantity", "unitPriceCents", "subtotalCents"],
  };

  const phaseSchema: ResponseSchema = {
    type: SchemaType.OBJECT,
    properties: {
      phaseName: { type: SchemaType.STRING },
      lineItems: { type: SchemaType.ARRAY, items: lineItemSchema },
    },
    required: ["phaseName", "lineItems"],
  };

  return {
    type: SchemaType.OBJECT,
    properties: {
      introduction: { type: SchemaType.STRING },
      phases: { type: SchemaType.ARRAY, items: phaseSchema },
      closingStatement: { type: SchemaType.STRING },
    },
    required: ["introduction", "phases", "closingStatement"],
  };
}

export function invoiceDocumentResponseSchema(): ResponseSchema {
  const laborRow: ResponseSchema = {
    type: SchemaType.OBJECT,
    properties: {
      description: { type: SchemaType.STRING },
      hours: { type: SchemaType.NUMBER },
      hourlyRateCents: { type: SchemaType.INTEGER },
      subtotalCents: { type: SchemaType.INTEGER },
    },
    required: ["description", "hours", "hourlyRateCents", "subtotalCents"],
  };

  const materialRow: ResponseSchema = {
    type: SchemaType.OBJECT,
    properties: {
      description: { type: SchemaType.STRING },
      quantity: { type: SchemaType.NUMBER },
      unitPriceCents: { type: SchemaType.INTEGER },
      subtotalCents: { type: SchemaType.INTEGER },
    },
    required: ["description", "quantity", "unitPriceCents", "subtotalCents"],
  };

  const categorized: ResponseSchema = {
    type: SchemaType.OBJECT,
    properties: {
      labor: { type: SchemaType.ARRAY, items: laborRow },
      materials: { type: SchemaType.ARRAY, items: materialRow },
    },
    required: ["labor", "materials"],
  };

  return {
    type: SchemaType.OBJECT,
    properties: {
      billingIntroduction: { type: SchemaType.STRING },
      categorizedLineItems: categorized,
      gstSummaryStatement: { type: SchemaType.STRING },
    },
    required: ["billingIntroduction", "categorizedLineItems", "gstSummaryStatement"],
  };
}

export function stripJsonFences(raw: string): string {
  return raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

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

function intCents(v: unknown): number {
  return Math.round(num(v, 0));
}

export function buildFallbackQuoteBody(lineItems: LineItem[]): QuoteDocumentAiBody {
  return {
    introduction:
      "Thank you for the opportunity to quote this scope of work. The schedule below summarises the line items for your review.",
    phases: [
      {
        phaseName: "Schedule of work",
        lineItems: lineItems.map((item) => ({
          description: item.description,
          quantity: item.quantity > 0 ? item.quantity : 1,
          unitPriceCents: item.unitPriceCents,
          subtotalCents: item.subtotalCents,
        })),
      },
    ],
    closingStatement:
      "This quotation is valid for 30 days from the issue date. Site access, variations, and client-supplied materials may affect the final account.",
  };
}

export function buildFallbackInvoiceBody(lineItems: LineItem[]): InvoiceDocumentAiBody {
  const labor = lineItems.filter((i) => i.kind === "labor");
  const materials = lineItems.filter((i) => i.kind !== "labor");

  return {
    billingIntroduction:
      "This invoice reflects work completed and/or materials supplied in line with the agreed scope and your purchase order where applicable.",
    categorizedLineItems: {
      labor: labor.map((item) => ({
        description: `Professional Service: ${item.description}`,
        hours: item.quantity > 0 ? item.quantity : 1,
        hourlyRateCents: item.unitPriceCents,
        subtotalCents: item.subtotalCents,
      })),
      materials: materials.map((item) => ({
        description: item.description,
        quantity: item.quantity > 0 ? item.quantity : 1,
        unitPriceCents: item.unitPriceCents,
        subtotalCents: item.subtotalCents,
      })),
    },
    gstSummaryStatement:
      "Australian GST (10%) is shown on taxable supplies and reconciles to the GST line in the totals panel.",
  };
}

export function parseQuoteDocumentBody(raw: unknown, lineItems: LineItem[]): QuoteDocumentAiBody {
  const fallback = buildFallbackQuoteBody(lineItems);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return fallback;
  }
  const o = raw as Record<string, unknown>;
  const introduction = str(o.introduction) || fallback.introduction;
  const closingStatement = str(o.closingStatement) || fallback.closingStatement;
  const phasesIn = o.phases;
  if (!Array.isArray(phasesIn) || phasesIn.length === 0) {
    return { ...fallback, introduction, closingStatement };
  }

  const phases: QuotePhaseAi[] = [];
  for (const p of phasesIn) {
    if (!p || typeof p !== "object" || Array.isArray(p)) {
      continue;
    }
    const pr = p as Record<string, unknown>;
    const phaseName = str(pr.phaseName) || "Phase";
    const linesIn = pr.lineItems;
    const lineItemsOut: QuotePhaseLineAi[] = [];
    if (Array.isArray(linesIn)) {
      for (const row of linesIn) {
        if (!row || typeof row !== "object") {
          continue;
        }
        const r = row as Record<string, unknown>;
        const description = str(r.description);
        if (!description) {
          continue;
        }
        lineItemsOut.push({
          description,
          quantity: Math.max(num(r.quantity, 1), 0.0001),
          unitPriceCents: intCents(r.unitPriceCents),
          subtotalCents: intCents(r.subtotalCents),
        });
      }
    }
    if (lineItemsOut.length > 0) {
      phases.push({ phaseName, lineItems: lineItemsOut });
    }
  }

  if (phases.length === 0) {
    return { ...fallback, introduction, closingStatement };
  }

  return { introduction, phases, closingStatement };
}

export function parseInvoiceDocumentBody(raw: unknown, lineItems: LineItem[]): InvoiceDocumentAiBody {
  const fallback = buildFallbackInvoiceBody(lineItems);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return fallback;
  }
  const o = raw as Record<string, unknown>;
  const billingIntroduction = str(o.billingIntroduction) || fallback.billingIntroduction;
  const gstSummaryStatement = str(o.gstSummaryStatement) || fallback.gstSummaryStatement;
  const cat = o.categorizedLineItems;
  if (!cat || typeof cat !== "object" || Array.isArray(cat)) {
    return { ...fallback, billingIntroduction, gstSummaryStatement };
  }
  const c = cat as Record<string, unknown>;
  const laborOut: InvoiceLaborLineAi[] = [];
  const materialsOut: InvoiceMaterialLineAi[] = [];

  if (Array.isArray(c.labor)) {
    for (const row of c.labor) {
      if (!row || typeof row !== "object") {
        continue;
      }
      const r = row as Record<string, unknown>;
      const description = str(r.description);
      if (!description) {
        continue;
      }
      laborOut.push({
        description,
        hours: Math.max(num(r.hours, 1), 0.0001),
        hourlyRateCents: intCents(r.hourlyRateCents),
        subtotalCents: intCents(r.subtotalCents),
      });
    }
  }
  if (Array.isArray(c.materials)) {
    for (const row of c.materials) {
      if (!row || typeof row !== "object") {
        continue;
      }
      const r = row as Record<string, unknown>;
      const description = str(r.description);
      if (!description) {
        continue;
      }
      materialsOut.push({
        description,
        quantity: Math.max(num(r.quantity, 1), 0.0001),
        unitPriceCents: intCents(r.unitPriceCents),
        subtotalCents: intCents(r.subtotalCents),
      });
    }
  }

  if (laborOut.length === 0 && materialsOut.length === 0) {
    return { ...fallback, billingIntroduction, gstSummaryStatement };
  }

  return {
    billingIntroduction,
    categorizedLineItems: {
      labor: laborOut.length > 0 ? laborOut : fallback.categorizedLineItems.labor,
      materials: materialsOut.length > 0 ? materialsOut : fallback.categorizedLineItems.materials,
    },
    gstSummaryStatement,
  };
}

export function buildDocumentBodyUserPayload(input: {
  documentType: "quote" | "invoice";
  job: Job;
  client: Client;
  lineItems: LineItem[];
  subtotalCents: number;
  markupCents: number;
  taxCents: number;
  totalCents: number;
  chosenMarkupPercent?: number;
}): string {
  const slimLines = input.lineItems.map((item) => ({
    id: item.id,
    kind: item.kind,
    description: item.description,
    quantity: item.quantity,
    unit: item.unit,
    unitPriceCents: item.unitPriceCents,
    subtotalCents: item.subtotalCents,
    totalCents: item.totalCents,
  }));

  return JSON.stringify(
    {
      documentType: input.documentType,
      job: {
        title: input.job.title,
        description: input.job.description ?? "",
      },
      client: {
        displayName: input.client.displayName,
      },
      lineItems: slimLines,
      totals: {
        subtotalCents: input.subtotalCents,
        materialsMarkupCents: input.markupCents,
        materialsMarkupPercent: input.chosenMarkupPercent ?? 15,
        gstCents: input.taxCents,
        totalCents: input.totalCents,
      },
      instructions:
        input.documentType === "quote"
          ? "Group every input line item into one or more phases with clear phaseName values. Preserve all line items — do not drop rows. Use subtotalCents/unitPriceCents exactly as given for each line unless you intentionally consolidate (prefer keeping one row per input id)."
          : "Split every input line item into labor (kind=labor) vs materials (all other kinds). Labour rows must use hours from quantity when unit is hours, else still use quantity as hours for display. Use Professional Service: prefix on labor descriptions. Preserve all line items.",
    },
    null,
    2,
  );
}

export function composeSystemInstruction(
  documentType: "quote" | "invoice",
  userPromptFromFirestore: string | undefined | null,
): string {
  const trimmed = typeof userPromptFromFirestore === "string" ? userPromptFromFirestore.trim() : "";
  const base =
    documentType === "quote"
      ? trimmed || DEFAULT_QUOTE_SYSTEM_INSTRUCTION
      : trimmed || DEFAULT_INVOICE_SYSTEM_INSTRUCTION;

  return `${base}

Output rules:
- Respond with JSON only (no markdown fences) matching the configured response schema.
- Australian business context; GST is 10%.
- Use only facts supported by the payload; you may rephrase descriptions for clarity.`;
}
