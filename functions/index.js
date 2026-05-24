const { onRequest } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2/options");
const { defineString } = require("firebase-functions/params");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const admin = require("firebase-admin");
const busboy = require("busboy");
const {
  TEMPLATE_ARCHITECT_SYSTEM_INSTRUCTION,
  parseTemplateArchitectModelText,
} = require("./template-architect");
const {
  quoteDocumentResponseSchema,
  invoiceDocumentResponseSchema,
  parseQuoteDocumentBody,
  parseInvoiceDocumentBody,
  buildDocumentBodyUserPayload,
  composeSystemInstruction,
} = require("./document-body");
const { refineDocumentPayloadWithGemini } = require("./document-refinement");

// Gen2 runs on Cloud Run; without public invoker, Hosting/browser rewrites get HTML 401
// before our handler. Firebase Auth is still enforced per-request via Bearer ID token.
setGlobalOptions({ maxInstances: 10, invoker: "public" });

if (!admin.apps.length) {
  admin.initializeApp();
}

const GEMINI_API_KEY = defineString("GEMINI_API_KEY");

const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

const RECEIPT_PROMPT = `You are parsing a retail / trade receipt image (trade / hardware store style).

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

function normalizeExtractedItems(items) {
  if (!Array.isArray(items)) {
    return null;
  }
  const out = [];
  for (const row of items) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const description = str(row.description);
    const rawDescription = str(row.rawDescription) || description;
    const title = description || rawDescription;
    if (!title) {
      continue;
    }
    const qty = num(row.quantity, 1);
    const unitPriceCents = Math.round(num(row.unitPriceCents, 0));
    const subtotalCents = Math.round(num(row.subtotalCents, 0));
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

function normalizeReceiptMeta(root) {
  if (!root || typeof root !== "object" || Array.isArray(root)) {
    return { vendorName: null, receiptDate: null, totalGstCents: null };
  }
  const vendorName = str(root.vendorName) || null;
  const receiptDate = str(root.receiptDate) || null;
  let totalGstCents = null;
  const g = root.totalGstCents;
  if (g !== null && g !== undefined && g !== "") {
    const n = Math.round(num(g, NaN));
    if (Number.isFinite(n)) {
      totalGstCents = n;
    }
  }
  return { vendorName, receiptDate, totalGstCents };
}

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const bb = busboy({
      headers: req.headers,
      limits: { fileSize: 12 * 1024 * 1024 },
    });

    let fileBuffer = null;
    let fileMime = "";
    let fieldMime = "";

    bb.on("field", (name, val) => {
      if (name === "mimeType" && typeof val === "string") {
        fieldMime = val;
      }
    });

    bb.on("file", (name, file, info) => {
      if (name !== "file") {
        file.resume();
        return;
      }
      const chunks = [];
      file.on("data", (d) => chunks.push(d));
      file.on("end", () => {
        fileBuffer = Buffer.concat(chunks);
        fileMime = info.mimeType || "";
      });
    });

    bb.on("error", reject);
    bb.on("finish", () => {
      resolve({ fileBuffer, fileMime, fieldMime });
    });

    // Gen2 / Express often buffers the body into `rawBody` and leaves `req` drained.
    // `req.pipe(busboy)` then sees no bytes → "Unexpected end of form" / parse errors.
    const raw = req.rawBody;
    if (Buffer.isBuffer(raw) && raw.length > 0) {
      try {
        bb.write(raw);
        bb.end();
      } catch (e) {
        reject(e);
      }
    } else {
      req.pipe(bb);
    }
  });
}

exports.extractReceiptHttp = onRequest(
  {
    cors: true,
    memory: "512MiB",
    timeoutSeconds: 120,
  },
  async (req, res) => {
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const authHeader = req.get("authorization") || "";
    const match = authHeader.match(/^Bearer (.+)$/i);
    if (!match || !match[1]) {
      res.status(401).json({ error: "Missing Authorization bearer token." });
      return;
    }

    try {
      await admin.auth().verifyIdToken(match[1]);
    } catch (e) {
      console.error("extractReceipt auth", e);
      res.status(401).json({ error: "Invalid or expired auth token." });
      return;
    }

    const contentType = req.get("content-type") || "";
    if (!contentType.includes("multipart/form-data")) {
      res.status(400).json({ error: "Expected multipart/form-data." });
      return;
    }

    let fileBuffer;
    let fileMime;
    let fieldMime;
    try {
      ({ fileBuffer, fileMime, fieldMime } = await parseMultipart(req));
    } catch (e) {
      const msg = e && e.message ? String(e.message) : String(e);
      console.error("extractReceipt multipart", msg, e);
      res.status(400).json({ error: "Failed to parse upload.", detail: msg });
      return;
    }

    if (!fileBuffer || fileBuffer.length === 0) {
      res.status(400).json({ error: 'Missing or empty "file" field.' });
      return;
    }

    const mime =
      (fileMime && ALLOWED_MIME.has(fileMime) ? fileMime : "") ||
      (fieldMime && ALLOWED_MIME.has(fieldMime) ? fieldMime : "");

    if (!mime) {
      res.status(400).json({ error: "Unsupported image type. Use JPEG, PNG, WebP, HEIC, or HEIF." });
      return;
    }

    try {
      const genAI = new GoogleGenerativeAI(GEMINI_API_KEY.value());
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

      const result = await model.generateContent([
        RECEIPT_PROMPT,
        {
          inlineData: {
            mimeType: mime,
            data: fileBuffer.toString("base64"),
          },
        },
      ]);

      const text = result.response.text().trim();
      let jsonText = text;
      if (jsonText.startsWith("```")) {
        jsonText = jsonText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
      }

      const parsed = JSON.parse(jsonText);
      const items = normalizeExtractedItems(parsed && parsed.items);
      if (!items) {
        res.status(502).json({ error: "Model returned an invalid JSON shape." });
        return;
      }

      const meta = normalizeReceiptMeta(parsed);
      res.status(200).json({ ...meta, items });
    } catch (error) {
      console.error("extractReceipt gemini", error);
      const message = error && error.message ? error.message : "Gemini request failed.";
      res.status(502).json({ error: message });
    }
  },
);

const MAX_TEMPLATE_PROMPT_CHARS = 12000;

exports.generateTemplateHttp = onRequest(
  {
    cors: true,
    memory: "512MiB",
    timeoutSeconds: 60,
  },
  async (req, res) => {
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const authHeader = req.get("authorization") || "";
    const match = authHeader.match(/^Bearer (.+)$/i);
    if (!match || !match[1]) {
      res.status(401).json({ error: "Missing Authorization bearer token." });
      return;
    }

    try {
      await admin.auth().verifyIdToken(match[1]);
    } catch (e) {
      console.error("generateTemplate auth", e);
      res.status(401).json({ error: "Invalid or expired auth token." });
      return;
    }

    let body;
    try {
      if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
        body = req.body;
      } else if (Buffer.isBuffer(req.rawBody) && req.rawBody.length > 0) {
        body = JSON.parse(req.rawBody.toString("utf8"));
      } else if (typeof req.body === "string" && req.body.trim()) {
        body = JSON.parse(req.body);
      } else {
        res.status(400).json({ error: "Expected JSON body with a prompt field." });
        return;
      }
    } catch {
      res.status(400).json({ error: "Invalid JSON body." });
      return;
    }

    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) {
      res.status(400).json({ error: 'Missing or empty "prompt" field.' });
      return;
    }
    if (prompt.length > MAX_TEMPLATE_PROMPT_CHARS) {
      res.status(400).json({ error: "Prompt is too long." });
      return;
    }

    try {
      const genAI = new GoogleGenerativeAI(GEMINI_API_KEY.value());
      const model = genAI.getGenerativeModel({
        model: "gemini-2.5-flash",
        systemInstruction: TEMPLATE_ARCHITECT_SYSTEM_INSTRUCTION,
      });

      const result = await model.generateContent([
        "Create a PDF style object for this construction document layout goal:",
        prompt,
      ]);

      const rawText = result.response.text().trim();
      const out = parseTemplateArchitectModelText(rawText);
      res.status(200).json(out);
    } catch (error) {
      console.error("generateTemplate gemini", error);
      const message = error && error.message ? String(error.message) : "Gemini request failed.";
      res.status(502).json({ error: message });
    }
  },
);

const MAX_DOCUMENT_BODY_JSON_CHARS = 180000;

exports.generateDocumentBodyHttp = onRequest(
  {
    cors: true,
    memory: "512MiB",
    timeoutSeconds: 120,
  },
  async (req, res) => {
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const authHeader = req.get("authorization") || "";
    const match = authHeader.match(/^Bearer (.+)$/i);
    if (!match || !match[1]) {
      res.status(401).json({ error: "Missing Authorization bearer token." });
      return;
    }

    let uid;
    try {
      const decoded = await admin.auth().verifyIdToken(match[1]);
      uid = decoded.uid;
    } catch (e) {
      console.error("generateDocumentBody auth", e);
      res.status(401).json({ error: "Invalid or expired auth token." });
      return;
    }

    let body;
    try {
      if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
        body = req.body;
      } else if (Buffer.isBuffer(req.rawBody) && req.rawBody.length > 0) {
        body = JSON.parse(req.rawBody.toString("utf8"));
      } else if (typeof req.body === "string" && req.body.trim()) {
        body = JSON.parse(req.body);
      } else {
        res.status(400).json({ error: "Expected JSON body." });
        return;
      }
    } catch {
      res.status(400).json({ error: "Invalid JSON body." });
      return;
    }

    const rawLen = JSON.stringify(body).length;
    if (rawLen > MAX_DOCUMENT_BODY_JSON_CHARS) {
      res.status(400).json({ error: "Payload too large." });
      return;
    }

    const documentType = body.documentType === "quote" || body.documentType === "invoice" ? body.documentType : null;
    if (!documentType) {
      res.status(400).json({ error: 'Missing or invalid "documentType".' });
      return;
    }

    const job = body.job;
    const client = body.client;
    const lineItems = body.lineItems;
    if (!job || typeof job !== "object" || !client || typeof client !== "object" || !Array.isArray(lineItems)) {
      res.status(400).json({ error: "Missing job, client, or lineItems." });
      return;
    }
    if (lineItems.length === 0) {
      res.status(400).json({ error: "lineItems must be non-empty." });
      return;
    }

    const subtotalCents = Number(body.subtotalCents);
    const markupCents = Number(body.markupCents);
    const taxCents = Number(body.taxCents);
    const totalCents = Number(body.totalCents);
    if (![subtotalCents, markupCents, taxCents, totalCents].every((n) => Number.isFinite(n))) {
      res.status(400).json({ error: "Invalid totals." });
      return;
    }

    let invoiceSystemPrompt = "";
    let quoteSystemPrompt = "";
    try {
      const settingsSnap = await admin.firestore().collection("userSettings").doc(uid).get();
      const data = settingsSnap.data() || {};
      if (typeof data.invoiceSystemPrompt === "string") {
        invoiceSystemPrompt = data.invoiceSystemPrompt.trim();
      }
      if (typeof data.quoteSystemPrompt === "string") {
        quoteSystemPrompt = data.quoteSystemPrompt.trim();
      }
    } catch (e) {
      console.error("generateDocumentBody settings", e);
    }

    const customPrompt = documentType === "invoice" ? invoiceSystemPrompt : quoteSystemPrompt;
    const systemInstruction = composeSystemInstruction(documentType, customPrompt);
    const responseSchema =
      documentType === "quote" ? quoteDocumentResponseSchema() : invoiceDocumentResponseSchema();

    const userText = buildDocumentBodyUserPayload({
      documentType,
      job,
      client,
      lineItems,
      subtotalCents,
      markupCents,
      taxCents,
      totalCents,
    });

    try {
      const genAI = new GoogleGenerativeAI(GEMINI_API_KEY.value());
      const model = genAI.getGenerativeModel({
        model: "gemini-2.5-flash",
        systemInstruction,
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema,
        },
      });

      const result = await model.generateContent([
        "Generate the document JSON body from this payload:",
        userText,
      ]);

      const rawText = result.response.text().trim();
      let parsed;
      try {
        parsed = JSON.parse(rawText);
      } catch (e) {
        console.error("generateDocumentBody json", e);
        parsed = null;
      }

      const out =
        documentType === "quote"
          ? parseQuoteDocumentBody(parsed, lineItems)
          : parseInvoiceDocumentBody(parsed, lineItems);

      res.status(200).json({ documentType, body: out });
    } catch (error) {
      console.error("generateDocumentBody gemini", error);
      const message = error && error.message ? String(error.message) : "Gemini request failed.";
      res.status(502).json({ error: message });
    }
  },
);

const MAX_REFINE_DOCUMENT_JSON_CHARS = 220000;

exports.refineDocumentPayloadHttp = onRequest(
  {
    cors: true,
    memory: "512MiB",
    timeoutSeconds: 120,
  },
  async (req, res) => {
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const authHeader = req.get("authorization") || "";
    const match = authHeader.match(/^Bearer (.+)$/i);
    if (!match || !match[1]) {
      res.status(401).json({ error: "Missing Authorization bearer token." });
      return;
    }

    try {
      await admin.auth().verifyIdToken(match[1]);
    } catch (e) {
      console.error("refineDocumentPayload auth", e);
      res.status(401).json({ error: "Invalid or expired auth token." });
      return;
    }

    let body;
    try {
      if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
        body = req.body;
      } else if (Buffer.isBuffer(req.rawBody) && req.rawBody.length > 0) {
        body = JSON.parse(req.rawBody.toString("utf8"));
      } else if (typeof req.body === "string" && req.body.trim()) {
        body = JSON.parse(req.body);
      } else {
        res.status(400).json({ error: "Expected JSON body." });
        return;
      }
    } catch {
      res.status(400).json({ error: "Invalid JSON body." });
      return;
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      res.status(400).json({ error: "Invalid JSON body." });
      return;
    }

    const rawLen = JSON.stringify(body).length;
    if (rawLen > MAX_REFINE_DOCUMENT_JSON_CHARS) {
      res.status(400).json({ error: "Payload too large." });
      return;
    }

    const payload = body.payload;
    const userMessage = typeof body.userMessage === "string" ? body.userMessage.trim() : "";

    if (!payload || typeof payload !== "object" || !payload.documentType || !Array.isArray(payload.lineItems)) {
      res.status(400).json({ error: "Missing or invalid document payload." });
      return;
    }
    if (payload.lineItems.length === 0) {
      res.status(400).json({ error: "Missing or invalid document payload." });
      return;
    }
    if (!userMessage) {
      res.status(400).json({ error: "userMessage is required." });
      return;
    }

    try {
      const delta = await refineDocumentPayloadWithGemini({
        apiKey: GEMINI_API_KEY.value(),
        payload,
        userMessage,
      });
      res.status(200).json({ delta });
    } catch (error) {
      console.error("refineDocumentPayload gemini", error);
      const message = error && error.message ? String(error.message) : "Gemini refinement failed.";
      res.status(502).json({ error: message });
    }
  },
);
