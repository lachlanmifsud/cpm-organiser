/**
 * Derive a 3-letter PO prefix from the client display name (letters only, uppercase).
 * Pads with "X" when fewer than three letters are available.
 */
export function poPrefixFromDisplayName(displayName: string): string {
  const letters = displayName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z]/g, "")
    .toUpperCase();

  return letters.slice(0, 3).padEnd(3, "X");
}

/** Format `PREFIX-01`, `PREFIX-04`, `PREFIX-100` (minimum 2-digit width). */
export function formatSequentialPoNumber(prefix: string, nextSequence: number): string {
  const seq = Math.max(1, Math.floor(nextSequence));
  const width = Math.max(2, String(seq).length);
  return `${prefix}-${String(seq).padStart(width, "0")}`;
}
