import { stripJsonFences } from "@/lib/ai/document-body-shared";

/**
 * Extracts the outermost JSON object/array from a model response that may include
 * markdown fences, preamble, or trailing commentary.
 */
export function extractAndParseJSON<T = unknown>(
  rawResponse: string,
  errorMessage = "Failed to parse AI response.",
): T {
  const withoutFences = stripJsonFences(rawResponse.trim());
  if (!withoutFences) {
    console.error("Raw failed response (empty):", rawResponse);
    throw new Error(errorMessage);
  }

  try {
    return JSON.parse(withoutFences) as T;
  } catch {
    // fall through to brace extraction
  }

  const startIndex = withoutFences.indexOf("{");
  const endIndex = withoutFences.lastIndexOf("}");

  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    console.error("Raw failed response:", rawResponse);
    throw new Error(errorMessage);
  }

  const cleanString = withoutFences.substring(startIndex, endIndex + 1);

  try {
    return JSON.parse(cleanString) as T;
  } catch (error) {
    console.error("Raw failed response:", rawResponse);
    console.error("Extracted JSON substring:", cleanString);
    console.error(error);
    throw new Error(errorMessage);
  }
}
