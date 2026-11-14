# Spec: freight-order-intake

Status: **draft v0, written by the agent. Not approved until Adilet has answered the decisions in section 7.**

## 1. Problem

A dispatcher at a trucking company gets shipment requests by email and retypes each one into the
transportation management system (TMS): customer, stops, appointment windows, freight, rate.
It is slow, and a wrong stop or date costs a truck.

This service takes one email and produces a validated order. The hard part is not the extraction.
It is knowing **which extractions are safe to accept without a person looking**.

Rose Rocket already ships this as a product feature (TED). This repo is not a copy of it. It is a
small version of the same problem, used to show how I plan, check and correct agent-written code.

## 2. Scope

In:
- `POST /emails`: one plain-text email in, one stored order out.
- Extraction with a language model into a Zod schema.
- Deterministic normalization (units, codes, date format).
- A rule-based review gate: `auto_accepted`, `needs_review`, `not_an_order`, `extraction_failed`.
- A review queue API: list held orders, submit a corrected order.
- Duplicate protection: the same email never becomes two orders.
- An eval harness with hand-labelled emails and a report.
- Phase 2: a React review screen. Phase 3: live queue updates over WebSockets.

Out (and why):
- PDF and spreadsheet attachments. Real, but a separate parsing problem. First item in "next".
- Reading a real mailbox. The API takes the email as JSON; an IMAP or webhook adapter is plumbing.
- Sign-in and multiple companies.
- Geocoding and time zones. Times are stored as local wall-clock time at the stop.
- Redis, queues, Kubernetes. Nothing here needs them yet, and adding them would be decoration.

## 3. Pipeline

```
email -> dedupe by message id -> model (schema-constrained) -> normalize -> review gate -> Postgres
```

1. **Dedupe.** Look up the email's Message-ID (or a SHA-256 of the email when there is none).
   If it exists, return the existing order with 200 and make no model call.
2. **Extract.** One model call through `@nestjs/ai` with `extractedOrderSchema`. The model is told
   to return null for anything the email does not state, and to copy numbers without converting.
3. **Normalize.** Pure code: kg to lbs, upper-case region and postal codes, reject dates that are
   not `YYYY-MM-DDTHH:mm` or do not exist. Anything it cannot use becomes null plus an issue.
4. **Gate.** Pure code. Any rule that fires sends the order to review with the reason in words.
5. **Store.** Order, stops and commodities in one transaction. The model's raw answer is kept.

Principle: **the model reads, the code computes.** Anything that can be done deterministically is
done in code, where it can be unit-tested without a model.

## 4. Review gate rules

An order is held for review when any of these is true:

| Rule | Why |
|---|---|
| No pickup stop, or no delivery stop | Cannot be dispatched |
| A stop has no city or no region | Cannot be routed |
| First pickup has no date | Cannot be scheduled |
| Last delivery starts before first pickup | Almost always a misread date |
| No commodities, or a commodity has no weight | Cannot be rated or checked against capacity |
| Total weight over 45,000 lbs | More than one truckload: typo, or needs splitting |
| Normalize found a bad date, a weight with no unit, or a fractional quantity | The model returned something unusable |
| The model listed an ambiguity | The email itself is unclear |

A missing rate is **not** a reason: many tenders are sent against a contract rate.

## 5. Data model

Three relational tables (`orders`, `stops`, `commodities`) and one JSONB column
(`orders.raw_extraction`). Reasons are in `src/db/schema.ts`. Two indexes carry weight:
- `(status, created_at)` serves the review queue.
- unique `(message_id)` is what actually prevents duplicate orders when two requests race.

Commodity types use the enum from Rose Rocket's public Commodity object
(bundle, carton, skid, package, container).

Known simplification: commodities belong to the order. In Rose Rocket's public model they belong
to a task at a stop, which is what lets "5 pallets at drop 1, 7 at drop 2" be represented. See
decision 5.

## 6. How it is checked

See `docs/TEST_PLAN.md`. In short:
- Unit tests for every normalize and gate rule, including boundaries.
- API tests against a real Postgres with a fake model: no network, no key.
- An eval on hand-labelled emails that reports field accuracy and, above all,
  **silent failures**: orders that are wrong and were auto-accepted.

## 7. Decisions for Adilet

Each one is a real choice. Answer in a line, and record it in `AGENT_LOG.md`.

1. **Model and provider.** Anthropic or Google? A small fast model is the right class for this.
   Record the model id and its price.
2. **Label rules.** `docs/TEST_PLAN.md` section 4 proposes rules for labelling (PO without its
   prefix, "pallet" means skid, window end is null unless stated). Agree or change before
   labelling anything, because changing them later means relabelling everything.
3. **The 45,000 lb limit.** Verify the number against a source you can cite, or change it.
4. **Provider outage.** Today a provider error after three retries returns 500 and the email is
   not stored. Options: (a) return 503 and rely on the sender retrying, which is safe because
   ingestion is idempotent; (b) store the email as `extraction_failed` straight away.
5. **Commodities per stop.** Keep order-level commodities (simple, slightly wrong for multi-drop)
   or move them onto stops (matches the real model, more schema and more to label)?
6. **Dataset size and mix.** Proposal: 30 emails. About 10 clean, 12 messy (forwarded threads,
   kg, relative dates, multi-stop, missing fields), 4 contradictory, 4 not orders.
7. **Project name.** `freight-order-intake` is a placeholder.
