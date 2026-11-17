# Label rules

Every label in eval/dataset is written by me (Adilet) from the email text alone.
A label is { isOrderRequest, order }: whether the email is an order, and the correct
normalized order (null if it is not an order). There is no expected status: the review gate
decides the status, and the eval checks whether a wrong order was auto-accepted.

Labels never invent and never reorder. Weights are written in pounds, because the scorer
compares normalized orders.

## Customer
- The customer is the company sending (tendering) the load. If a broker sends it, the broker
  is the customer. The shipper is the pickup stop, not the customer.
  (Changed on Nov 16 after talking to a former dispatcher: from a carrier's side, loads come
  from brokers.)
- Taken from the email itself: signature, body or company domain.
- Null when the email does not identify a company.

## Weight
- Weight in pounds. If the email gives kg, multiply by 2.20462 and round to a whole pound;
  the scorer allows +/- 1 lb for that rounding.
- No weight in the email -> null.

## Dates and times
- Format YYYY-MM-DDTHH:mm, local time at the stop. No time zone conversion.
- A day with no time: window start 00:00, window end 23:59 (the system's own convention).
- Only a start time: window end is null. "Before 14:00": start 00:00, end 14:00.
- "Tomorrow" is the received date plus one day; "Friday" is the next Friday on or after the
  received date. Whether these get held is the gate's decision.
- A vague time with no clock time ("morning"): treat as a day with no time, and add a note.

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
- If two values conflict with no explicit correction, the field is null.

## Reference number and enums
- Reference number: the number only, without labels like "PO" or "Ref".
- Enum fields use the exact schema value (dry_van, skid), not free text.