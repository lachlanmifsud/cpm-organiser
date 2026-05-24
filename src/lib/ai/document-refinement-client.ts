import { getIdToken } from "firebase/auth";
import { extractAndParseJSON } from "@/lib/ai/parse-ai-json";
import type { DocumentRefinementAiDelta, DocumentRefinementPayload } from "@/lib/document-refinement-payload";
import { auth } from "@/lib/firebase/client";

export async function fetchRefineDocumentPayload(input: {
  payload: DocumentRefinementPayload;
  userMessage: string;
}): Promise<DocumentRefinementAiDelta> {
  const user = auth?.currentUser;
  if (!user) {
    throw new Error("You must be signed in to refine a document.");
  }

  const idToken = await getIdToken(user);
  const response = await fetch("/api/refine-document-payload", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      payload: input.payload,
      userMessage: input.userMessage,
    }),
  });

  if (!response.ok) {
    const isHtml = response.headers.get("content-type")?.includes("text/html");
    if (isHtml) {
      throw new Error(
        `API Route Error (${response.status}): Endpoint not found or returned an HTML error page.`,
      );
    }
    const errorText = await response.text();
    console.error("Document refinement backend error:", response.status, errorText);
    let detail = errorText.slice(0, 500);
    try {
      const errJson = JSON.parse(errorText) as { error?: string };
      if (errJson?.error) {
        detail = errJson.error;
      }
    } catch {
      // use raw text
    }
    throw new Error(`Document refinement failed (${response.status}): ${detail}`);
  }

  const rawResponse = await response.text();
  const parsed = extractAndParseJSON<{ delta?: DocumentRefinementAiDelta }>(
    rawResponse,
    "Failed to parse refinement response.",
  );

  if (!parsed.delta || typeof parsed.delta !== "object") {
    throw new Error("Refinement response was missing delta payload.");
  }

  return parsed.delta;
}
