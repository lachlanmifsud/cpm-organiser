/**
 * Document body AI — mirrors src/lib/ai/document-body-shared.ts for Cloud Functions.
 * Keep schemas / defaults aligned when changing either file.
 */

const SchemaType = {
  STRING: "string",
  NUMBER: "number",
  INTEGER: "integer",
  ARRAY: "array",
  OBJECT: "object",
};

const DEFAULT_QUOTE_SYSTEM_INSTRUCTION = `You are an Australian construction quoting assistant.
Write warm, professional copy and organise the supplied ledger line items into logical work phases for the client-facing quote.
Respect the JSON schema exactly; all money fields are whole cents (AUD).`;

const DEFAULT_INVOICE_SYSTEM_INSTRUCTION = `You are an Australian construction invoicing assistant.
Produce crisp accounting-style copy and split the supplied ledger into labour vs materials for presentation.
Labour descriptions must follow: "Professional Service: [task]".
Respect the JSON schema exactly; all money fields are whole cents (AUD).`;

function quoteLineItemSchema() {
  return {
    type: SchemaType.OBJECT,
    properties: {
      description: { type: SchemaType.STRING },
      quantity: { type: SchemaType.NUMBER },
      unitPriceCents: { type: SchemaType.INTEGER },
      subtotalCents: { type: SchemaType.INTEGER },
    },
    required: ["description", "quantity", "unitPriceCents", "subtotalCents"],
  };
}

function quotePhaseSchema() {
  return {
    type: SchemaType.OBJECT,
    properties: {
      phaseName: { type: SchemaType.STRING },
      lineItems: { type: SchemaType.ARRAY, items: quoteLineItemSchema() },
    },
    required: ["phaseName", "lineItems"],
  };
}

function quoteDocumentResponseSchema() {
  return {
    type: SchemaType.OBJECT,
    properties: {
      introduction: { type: SchemaType.STRING },
      phases: { type: SchemaType.ARRAY, items: quotePhaseSchema() },
      closingStatement: { type: SchemaType.STRING },
    },
    required: ["introduction", "phases", "closingStatement"],
  };
}

function invoiceLaborRow() {
  return {
    type: SchemaType.OBJECT,
    properties: {
      description: { type: SchemaType.STRING },
      hours: { type: SchemaType.NUMBER },
      hourlyRateCents: { type: SchemaType.INTEGER },
      subtotalCents: { type: SchemaType.INTEGER },
    },
    required: ["description", "hours", "hourlyRateCents", "subtotalCents"],
  };
}

function invoiceMaterialRow() {
  return {
    type: SchemaType.OBJECT,
    properties: {
      description: { type: SchemaType.STRING },
      quantity: { type: SchemaType.NUMBER },
      unitPriceCents: { type: SchemaType.INTEGER },
      subtotalCents: { type: SchemaType.INTEGER },
    },
    required: ["description", "quantity", "unitPriceCents", "subtotalCents"],
  };
}

function invoiceDocumentResponseSchema() {
  return {
    type: SchemaType.OBJECT,
    properties: {
      billingIntroduction: { type: SchemaType.STRING },
      categorizedLineItems: {
        type: SchemaType.OBJECT,
        properties: {
          labor: { type: SchemaType.ARRAY, items: invoiceLaborRow() },
          materials: { type: SchemaType.ARRAY, items: invoiceMaterialRow() },
        },
        required: ["labor", "materials"],
      },
      gstSummaryStatement: { type: SchemaType.STRING },
    },
    required: ["billingIntroduction", "categorizedLineItems", "gstSummaryStatement"],
  };
}

function num(v, fallback) {
  if (typeof v === "number" && Number.isFinite(v)) {
    return v;
  }
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) {
    return Number(v);
  }
  return fallback;
}

function str(v) {
  return typeof v === "string" ? v.trim() : "";
}

function intCents(v) {
  return Math.round(num(v, 0));
}

function buildFallbackQuoteBody(lineItems) {
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

function buildFallbackInvoiceBody(lineItems) {
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

function parseQuoteDocumentBody(raw, lineItems) {
  const fallback = buildFallbackQuoteBody(lineItems);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return fallback;
  }
  const introduction = str(raw.introduction) || fallback.introduction;
  const closingStatement = str(raw.closingStatement) || fallback.closingStatement;
  const phasesIn = raw.phases;
  if (!Array.isArray(phasesIn) || phasesIn.length === 0) {
    return { ...fallback, introduction, closingStatement };
  }
  const phases = [];
  for (const p of phasesIn) {
    if (!p || typeof p !== "object" || Array.isArray(p)) {
      continue;
    }
    const phaseName = str(p.phaseName) || "Phase";
    const linesIn = p.lineItems;
    const lineItemsOut = [];
    if (Array.isArray(linesIn)) {
      for (const row of linesIn) {
        if (!row || typeof row !== "object") {
          continue;
        }
        const description = str(row.description);
        if (!description) {
          continue;
        }
        lineItemsOut.push({
          description,
          quantity: Math.max(num(row.quantity, 1), 0.0001),
          unitPriceCents: intCents(row.unitPriceCents),
          subtotalCents: intCents(row.subtotalCents),
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

function parseInvoiceDocumentBody(raw, lineItems) {
  const fallback = buildFallbackInvoiceBody(lineItems);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return fallback;
  }
  const billingIntroduction = str(raw.billingIntroduction) || fallback.billingIntroduction;
  const gstSummaryStatement = str(raw.gstSummaryStatement) || fallback.gstSummaryStatement;
  const cat = raw.categorizedLineItems;
  if (!cat || typeof cat !== "object" || Array.isArray(cat)) {
    return { ...fallback, billingIntroduction, gstSummaryStatement };
  }
  const laborOut = [];
  const materialsOut = [];
  if (Array.isArray(cat.labor)) {
    for (const row of cat.labor) {
      if (!row || typeof row !== "object") {
        continue;
      }
      const description = str(row.description);
      if (!description) {
        continue;
      }
      laborOut.push({
        description,
        hours: Math.max(num(row.hours, 1), 0.0001),
        hourlyRateCents: intCents(row.hourlyRateCents),
        subtotalCents: intCents(row.subtotalCents),
      });
    }
  }
  if (Array.isArray(cat.materials)) {
    for (const row of cat.materials) {
      if (!row || typeof row !== "object") {
        continue;
      }
      const description = str(row.description);
      if (!description) {
        continue;
      }
      materialsOut.push({
        description,
        quantity: Math.max(num(row.quantity, 1), 0.0001),
        unitPriceCents: intCents(row.unitPriceCents),
        subtotalCents: intCents(row.subtotalCents),
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

function buildDocumentBodyUserPayload(input) {
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
        gstCents: input.taxCents,
        totalCents: input.totalCents,
      },
      instructions:
        input.documentType === "quote"
          ? "Group every input line item into one or more phases with clear phaseName values. Preserve all line items — do not drop rows."
          : "Split every input line item into labor (kind=labor) vs materials (all other kinds). Labour rows must use hours from quantity when unit is hours, else still use quantity as hours for display. Use Professional Service: prefix on labor descriptions.",
    },
    null,
    2,
  );
}

function composeSystemInstruction(documentType, userPromptFromFirestore) {
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

module.exports = {
  quoteDocumentResponseSchema,
  invoiceDocumentResponseSchema,
  parseQuoteDocumentBody,
  parseInvoiceDocumentBody,
  buildDocumentBodyUserPayload,
  composeSystemInstruction,
  buildFallbackQuoteBody,
  buildFallbackInvoiceBody,
};
