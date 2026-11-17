# Label rules

Every label in eval/dataset is written by me (Adilet) from the email text alone.
A label is the correct answer for one email, in two parts:
1. Expected fields: what the email actually says, in the same shape the model returns.
2. Expected status: what the review gate should decide.

Labels never invent, never convert and never optimize. Unit conversion is done by the code,
and the 1 lb weight tolerance is applied by the scorer, not by the label.

## Customer
- The customer is the company sending (tendering) the load. If a broker sends it, the broker
  is the customer. The shipper is the pickup stop, not the customer.
  (Changed on Nov 16 after talking to a former dispatcher: from a carrier's side, loads come
  from brokers.)
- Taken from the email itself: signature, body or company domain.
- Null when the email does not identify a company.

## Weight
- Value and unit exactly as written (18,000 kg -> 18000, kg).
- No weight in the email -> null, and the expected status is needs_review.

## Dates and times
- Local wall-clock time as written. No time zone conversion.
- No time given -> the date only, time null. Never invent 00:00-23:59.
- "Tomorrow" -> the received date plus one day. "Friday" -> the next Friday on or after the
  received date. Whether these get held is the gate's decision, not the label's.

## Stops
- In the order the email gives them. Never reordered for a better route.
- One stop = one distinct location with its own pickup or delivery.

## Not an order
- An order is a request to actually move specific freight.
- A rate quote request, a billing question, a status question or feedback is not an order,
  even if it mentions cities or a weight.

## Contradictions and threads
- In a thread, the latest message wins for any field it explicitly changes; earlier details
  stand otherwise.
- If two values conflict with no explicit correction, the field is null and the expected
  status is needs_review.
