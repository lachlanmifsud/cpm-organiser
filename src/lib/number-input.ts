import type { Dispatch, SetStateAction } from "react";

/** Controlled numeric input state that allows a cleared (empty) field. */
export type NumberInputValue = number | "";

export function formatNumberInputValue(value: NumberInputValue): string {
  return value === "" ? "" : String(value);
}

/** Coerce empty input to a numeric fallback before persistence or math. */
export function coerceNumberInputValue(value: NumberInputValue, fallback = 0): number {
  if (value === "") {
    return fallback;
  }
  return Number.isFinite(value) ? value : fallback;
}

/** Strip leading zeros unless immediately before a decimal (preserves `0.50`). */
export function sanitizeLeadingZeros(rawValue: string): string {
  if (rawValue === "") {
    return "";
  }

  if (rawValue.includes(".")) {
    const [intPart, ...rest] = rawValue.split(".");
    const decPart = rest.join(".");
    const strippedInt = intPart.replace(/^0+(?=\d)/, "");
    return `${strippedInt === "" ? "0" : strippedInt}.${decPart}`;
  }

  return rawValue.replace(/^0+(?=\d)/, "");
}

export function parseNumberInputChange(rawValue: string): NumberInputValue {
  if (rawValue === "") {
    return "";
  }

  const sanitized = sanitizeLeadingZeros(rawValue);
  if (sanitized === "" || sanitized === ".") {
    return "";
  }

  const parsed = Number(sanitized);
  return Number.isFinite(parsed) ? parsed : "";
}

export function handleControlledNumberInputChange(
  rawValue: string,
  setter: Dispatch<SetStateAction<NumberInputValue>>,
) {
  setter(parseNumberInputChange(rawValue));
}
