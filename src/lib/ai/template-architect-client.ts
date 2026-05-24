import { getIdToken } from "firebase/auth";
import type { PdfTemplateStyle } from "@/types/database";
import { auth } from "@/lib/firebase/client";

export async function generateTemplateFromPrompt(prompt: string): Promise<{
  suggestedName: string;
  style: PdfTemplateStyle;
}> {
  const trimmed = prompt.trim();
  if (!trimmed) {
    throw new Error("Describe the layout you want first.");
  }

  const user = auth?.currentUser;
  if (!user) {
    throw new Error("You must be signed in to generate a template.");
  }
  const idToken = await getIdToken(user);

  const headers = new Headers();
  headers.set("Authorization", `Bearer ${idToken}`);
  headers.set("Content-Type", "application/json");

  const apiResponse = await fetch("/api/generate-template", {
    method: "POST",
    headers,
    body: JSON.stringify({ prompt: trimmed }),
  });

  const responseText = await apiResponse.text();

  if (!apiResponse.ok) {
    let detail = responseText.slice(0, 500);
    try {
      const errJson = JSON.parse(responseText) as { error?: string };
      if (errJson?.error) {
        detail = errJson.error;
      }
    } catch {
      // use raw detail
    }
    throw new Error(`Template generation failed (${apiResponse.status}): ${detail}`);
  }

  let parsed: { suggestedName?: string; style?: PdfTemplateStyle };
  try {
    parsed = JSON.parse(responseText) as typeof parsed;
  } catch {
    throw new Error("Failed to parse template generation response.");
  }

  if (!parsed.style || typeof parsed.style !== "object" || Array.isArray(parsed.style)) {
    throw new Error("Template generation returned an invalid payload.");
  }

  return {
    suggestedName:
      typeof parsed.suggestedName === "string" && parsed.suggestedName.trim()
        ? parsed.suggestedName.trim()
        : "AI Template",
    style: parsed.style,
  };
}
