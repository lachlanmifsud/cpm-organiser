/** Gold-standard trade defaults for Settings → Invoice & quote templates (onboarding / blank canvas). */

export const DEFAULT_ARCHITECT_TEMPLATE =
  "Clean, modern, high-contrast industrial layout. Use a dark zinc or slate gray accent for main header blocks. Position the company logo in the top right and client billing information in a neat left-aligned block. Material and labor line items must display in an elegant structured table with alternating very light gray rows for maximum scanning legibility. Highlight the Subtotal, GST, and Balance Due fields in a distinct, padded bottom-right summary box. Place payment terms and direct deposit bank details centered in a muted footer block.";

export const DEFAULT_INVOICE_PROMPT =
  "Act as an expert trade service accountant. Read the raw job completion summaries, active hours, and parsed material receipts. Convert them into an explicit, itemized billing array. Format labor lines strictly as 'Professional Service: [Task Description]' and explicitly break out material rows. Maintain a formal, crisp, and unambiguous billing tone. Ensure Australian GST (10%) calculations are perfectly isolated from the net totals and displayed explicitly.";

export const DEFAULT_QUOTE_PROMPT =
  "Act as an approachable, highly professional contracting estimation specialist. When building project quotes from rough site notes, write a warm, confident introduction thanking the client for the opportunity. Group raw materials and upcoming steps into logical 'Phases of Work' sections so the pricing isn't overwhelming to read. Maintain a reassuring, expert tone. Append a clean closing statement outlining that the estimation accounts for standard site variables and holds a 30-day price guarantee.";
