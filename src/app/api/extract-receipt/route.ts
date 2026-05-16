import { NextResponse } from "next/server";
import { GoogleGenerativeAI, HarmBlockThreshold, HarmCategory, SchemaType } from "@google/generative-ai";

const SYSTEM_INSTRUCTION = `You are an expert line-item extraction engine for an industrial trade invoicing application. Analyze the provided tax invoice or supplier receipt. Extract every single physical material/product line item purchased. Ignore company overhead, credit card processing fees, loyalty rewards adjustments, and store metadata. Extract exactly what was bought, the volume, the individual item unit price, and the total line item cost.`;
const MODEL_NAME = "gemini-2.5-flash";

const receiptSchema = {
  type: SchemaType.OBJECT,
  properties: {
    items: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          description: { type: SchemaType.STRING },
          quantity: { type: SchemaType.INTEGER, minimum: 1 },
          unitPriceCents: { type: SchemaType.INTEGER, minimum: 0 },
          subtotalCents: { type: SchemaType.INTEGER, minimum: 0 },
        },
        required: ["description", "quantity", "unitPriceCents", "subtotalCents"] as string[],
        additionalProperties: false,
      },
    },
  },
  required: ["items"] as string[],
  additionalProperties: false,
} as const;

async function bufferToBase64(buffer: ArrayBuffer) {
  return Buffer.from(buffer).toString("base64");
}

async function parseImagePayload(request: Request) {
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const body = await request.json();

    if (typeof body.imageBase64 === "string" && typeof body.mimeType === "string") {
      return {
        imageBase64: body.imageBase64,
        mimeType: body.mimeType,
      };
    }

    if (typeof body.imageUrl === "string" && typeof body.mimeType === "string") {
      const imageResponse = await fetch(body.imageUrl);
      if (!imageResponse.ok) {
        throw new Error("Unable to fetch image from imageUrl.");
      }
      const arrayBuffer = await imageResponse.arrayBuffer();
      return {
        imageBase64: await bufferToBase64(arrayBuffer),
        mimeType: body.mimeType,
      };
    }

    throw new Error("JSON request body must include imageBase64 and mimeType, or imageUrl and mimeType.");
  }

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const file = formData.get("image");

    if (file instanceof File) {
      const arrayBuffer = await file.arrayBuffer();
      return {
        imageBase64: await bufferToBase64(arrayBuffer),
        mimeType: file.type || "application/octet-stream",
      };
    }

    const imageBase64 = formData.get("imageBase64");
    const mimeType = formData.get("mimeType");

    if (typeof imageBase64 === "string" && typeof mimeType === "string") {
      return {
        imageBase64,
        mimeType,
      };
    }

    throw new Error("FormData request must include an image file or imageBase64 with mimeType.");
  }

  throw new Error("Unsupported content type. Send multipart/form-data or application/json.");
}

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "Server configuration error: GEMINI_API_KEY is not configured." },
      { status: 500 },
    );
  }

  let payload;

  try {
    payload = await parseImagePayload(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid request payload.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: MODEL_NAME,
    systemInstruction: SYSTEM_INSTRUCTION,
    safetySettings: [
      {
        category: HarmCategory.HARM_CATEGORY_HARASSMENT,
        threshold: HarmBlockThreshold.BLOCK_NONE,
      },
    ],
  });

  try {
    const result = await model.generateContent(
      {
        contents: [
          {
            role: "user",
            parts: [
              {
                inlineData: {
                  mimeType: payload.imageBase64 ? payload.mimeType : "application/octet-stream",
                  data: payload.imageBase64,
                },
              },
            ],
          },
          {
            role: "user",
            parts: [
              {
                text: "Extract the receipt line items and return only valid JSON using the provided schema.",
              },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: receiptSchema,
          temperature: 0,
          maxOutputTokens: 1200,
        },
      },
    );

    const rawResponse = result.response.text().trim();
    const parsed = JSON.parse(rawResponse);

    if (!Array.isArray(parsed?.items)) {
      throw new Error("AI response did not return a valid items array.");
    }

    return NextResponse.json(parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Receipt extraction failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
