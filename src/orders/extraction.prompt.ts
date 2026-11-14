import type { InboundEmail } from './order.schema.js';

/** Bump this when the instructions change, so eval results can be tied to a prompt version. */
export const PROMPT_VERSION = 'v1';

export const EXTRACTION_INSTRUCTIONS = `You read emails sent to a trucking company's dispatch inbox and extract shipment orders.

Rules:
- Extract only what the email states. If a detail is not in the email, return null. Never guess.
- Copy numbers exactly as written. Do not convert units or currencies.
- List stops in the order the truck will visit them.
- Dates: resolve relative dates ("tomorrow", "next Tuesday") against the email's received date. Write each as YYYY-MM-DDTHH:mm in local time at the stop. If a day is given with no time at all, use 00:00 for the window start and 23:59 for the window end. If only a start time is given, the window end is null. "Before 14:00" means start 00:00, end 14:00.
- A pallet is a skid.
- In a forwarded or replied thread, the newest message wins when two messages disagree.
- If anything needed to book the load is unclear or contradictory, add one short sentence to "ambiguities".
- If the email is not a request to move freight (a tracking question, an invoice, marketing), set isOrderRequest to false and return empty stops and commodities.`;

export function buildPrompt(email: InboundEmail): string {
  return `Received: ${email.receivedAt}\nSubject: ${email.subject}\n\n${email.body}`;
}
