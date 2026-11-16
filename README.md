# freight-order-intake

Takes one shipment-request email, turns it into a truckload order, and decides whether that
order is safe to accept without a person checking it.

Most of the code was written by an AI coding agent (Claude Code). How I planned, checked and
changed its work is in [AGENT_LOG.md](AGENT_LOG.md).

<!-- ADILET: how I worked with the agent -->

## Summary

A dispatcher gets load tenders by email and retypes them into a TMS. This service does the
reading with a language model, but every conversion, date check and accept-or-hold decision is
plain code. An order is auto-accepted only when it passes every rule in a review gate; otherwise
it is held with the reasons in words. The number that matters is not field accuracy but how many
orders were wrong and still auto-accepted. NestJS 12, TypeScript, Zod, PostgreSQL with Drizzle
ORM, `@nestjs/ai` (Anthropic or Google), Vitest.

## Pipeline

```
email
  -> dedupe        Message-ID, or SHA-256 of the email; unique index in Postgres
  -> model         one call, answer must match a Zod schema; null for anything not stated
  -> normalize     code: kg -> lbs, upper-case codes, reject impossible dates   (normalize.ts)
  -> review gate   code: each rule that fires adds a reason                     (review-gate.ts)
  -> Postgres      order, stops, commodities in one transaction; raw model answer kept as JSONB
```

The gate rules and the reason for each are in [SPEC.md section 4](SPEC.md#4-review-gate-rules).
A missing rate is not a reason to hold: many tenders go against a contract rate.

## Statuses

| Status | Meaning |
|---|---|
| `auto_accepted` | Passed every gate rule. No person needs to look at it. |
| `needs_review` | At least one rule fired. `reviewReasons` says which, in words. |
| `not_an_order` | The model read the email as something else (tracking question, invoice). The email is kept; the order fields are empty. |
| `extraction_failed` | The model's answer did not match the schema, or the provider failed. The email is stored. |
| `approved` | A person reviewed a held order and saved it through `PATCH /orders/:id/review`. |

## Headline metric: silent failures

A silent failure is an order that is **wrong and was auto-accepted**. The target is zero.

Field accuracy alone does not tell a dispatcher anything useful: a 96%-accurate extractor is not
safe to trust if nobody knows which 4% is wrong. A wrong order that is held costs a reviewer a
minute. A wrong order that is accepted sends a truck to the wrong place. The eval also reports
"wrong but held" (the gate did its job) and "correct but held" (what the gate costs in reviewer
time), so tightening the gate has a visible price.

<!-- ADILET: results -->

## Endpoints

`POST /emails`: one email in, the stored order out. 201 for a new email, 200 when the same email
was already stored (no second model call). Body: `subject`, `body`, `receivedAt` (ISO 8601 with
offset), optional `messageId`.

```bash
curl -s -X POST localhost:3000/emails -H 'content-type: application/json' -d '{
  "messageId": "<tender-48213@example.com>",
  "subject": "Load tender PO-48213",
  "body": "Please pick up 18 skids (32,000 lbs) at Maple Ridge Foods, Brampton ON L6T 4X3, Nov 17 08:00-12:00, deliver to Chicago IL 60632 on Nov 18. Dry van. $1,850 USD.",
  "receivedAt": "2026-11-16T14:05:00-05:00"
}'
```

`GET /orders`: all orders, oldest first. `?status=needs_review` is the review queue. No paging yet.

```bash
curl -s 'localhost:3000/orders?status=needs_review'
```

`GET /orders/:id`: one order with its stops, commodities, reasons and raw model answer.

```bash
curl -s localhost:3000/orders/0b6c1d2e-5f3a-4b8c-9d7e-1a2b3c4d5e6f
```

`PATCH /orders/:id/review`: a reviewer saves the corrected order. Only `needs_review` and
`extraction_failed` orders can be reviewed (409 otherwise). The status becomes `approved`.

```bash
curl -s -X PATCH localhost:3000/orders/0b6c1d2e-5f3a-4b8c-9d7e-1a2b3c4d5e6f/review \
  -H 'content-type: application/json' -d '{
  "customerName": "Maple Ridge Foods", "referenceNumber": "48213", "equipmentType": "dry_van",
  "stops": [
    {"type": "pickup", "companyName": "Maple Ridge Foods", "street": null, "city": "Brampton",
     "region": "ON", "postalCode": "L6T 4X3", "windowStart": "2026-11-17T08:00", "windowEnd": "2026-11-17T12:00"},
    {"type": "delivery", "companyName": null, "street": null, "city": "Chicago",
     "region": "IL", "postalCode": "60632", "windowStart": "2026-11-18T00:00", "windowEnd": "2026-11-18T23:59"}
  ],
  "commodities": [{"description": null, "quantity": 18, "commodityType": "skid", "weightLbs": 32000}],
  "rateAmount": 1850, "rateCurrency": "USD", "specialInstructions": null
}'
```

Invalid bodies get a 400 with field-level messages. An unknown id gets a 404.

## Run it locally

Needs Node 22+ and npm 11+ (npm 10 crashes resolving this dependency tree). Both setups below
end with the API on port 3000.

### With Postgres.app (no Docker)

Postgres.app listens on 5432 and trusts local connections. With its command-line tools on your
`PATH`:

```bash
psql -h localhost -U postgres -c 'CREATE DATABASE intake'
```

```bash
psql -h localhost -U postgres -c 'CREATE DATABASE intake_test'
```

```bash
npm ci
cp .env.example .env          # set LLM_PROVIDER, LLM_MODEL and the matching API key
npm run db:migrate            # migrates the DATABASE_URL in .env (intake)
DATABASE_URL=postgres://postgres:postgres@localhost:5432/intake_test npm run db:migrate
npm run start:dev
```

A variable set on the command line wins over the same variable in `.env`, which is what the
second migrate relies on.

### With docker compose

`docker-compose.yml` runs Postgres 16 on 5432 and creates `intake` and `intake_test`.

```bash
npm ci
cp .env.example .env          # set LLM_PROVIDER, LLM_MODEL and the matching API key
docker compose up -d --wait
npm run db:migrate
DATABASE_URL=postgres://postgres:postgres@localhost:5432/intake_test npm run db:migrate
npm run start:dev
```

## Tests

```bash
npm run typecheck && npm run lint
npm test                      # unit tests, no services, no model
npm run test:e2e              # API tests against real Postgres, fake model
```

Last run on 16 Nov 2026 (Node 24.22, npm 11.19, Postgres.app 18.7): typecheck and lint clean,
**50 unit tests** and **21 API tests** pass.

- Unit tests cover every normalize and gate rule at its boundary (45,000 lbs accepted, 45,001
  held; delivery at the same minute as pickup accepted), the eval's scoring maths, and the
  outage paths in the service.
- API tests use a real database because the duplicate guarantee lives in a unique index, and a
  mocked repository cannot prove an index works. The model is `FakeModel` from
  `@nestjs/ai/testing`: no key, no network, no cost.
- Rules were broken on purpose to check that a test fails for each. The list is in
  [docs/TEST_PLAN.md section 2](docs/TEST_PLAN.md#2-do-the-tests-have-teeth).

CI (`.github/workflows/ci.yml`) runs the same checks on Postgres 16 on every push, plus a job
that starts `docker compose`, migrates and checks that the built API answers.

## Eval

```bash
npm run eval                  # real model, needs a key in .env, costs money
```

It runs every labelled email in `eval/dataset/` through extract, normalize and gate, compares
each field with the label, and writes a report to `eval/results/` with silent failures, field
accuracy, latency p50/p95 and cost per 1,000 emails (set `PRICE_INPUT_PER_MTOK` and
`PRICE_OUTPUT_PER_MTOK` for the cost line).

- Label rules: [docs/TEST_PLAN.md section 4](docs/TEST_PLAN.md#4-label-rules-proposed-see-spec-decision-2).
  For example: a pallet is a skid, a reference number is the code without "PO", not stated
  means null.
- Every label is written by hand by me. A model grading a test set that a model labelled
  measures agreement, not correctness.
- The agent may draft email text. Unlabelled drafts are in `eval/drafts/`.

## Provider outage

SPEC decision 4, option (b). If the provider still fails after the AI module's three attempts
(timeout, 5xx, network error, or a refused key), the email is stored as `extraction_failed` and
`POST /emails` returns 201 with that status. An email is never dropped.

Sending the same email again (same Message-ID or same content) re-runs extraction for an
`extraction_failed` order and updates that order in place: same id, 200. If the re-run hits
another outage, nothing is written. Any other stored order is returned unchanged with no model
call. Two re-sends at once are settled in the database: the update only matches while the status
is still `extraction_failed`.

## Out of scope, and next

Not built, on purpose:

- **Redis and a job queue.** One email is one request and one model call; nothing here needs
  them yet. A queue becomes worth it with a real mailbox feed and retries in the background.
- **PDF and spreadsheet attachments.** Many real tenders arrive as attachments. It is a separate
  parsing problem and the first thing to add.

Next, in roughly this order:

- **Cap on re-extraction.** Every re-send of a failed email costs a model call, with no limit.
- **Re-run the gate server-side on review.** `PATCH /orders/:id/review` saves what the reviewer
  sends as `approved` without checking it against the gate rules. The review screen runs the
  same rules in the browser as warnings, but the API does not.
- **Paging on `GET /orders`.** It returns every order, including email bodies and raw model
  answers.
- **The review screen.** A React review console and a WebSocket gateway for live queue updates
  are on the separate `frontend` branch, not merged here.

## Read next

- [SPEC.md](SPEC.md): the problem, the gate rules, the decisions.
- [docs/TEST_PLAN.md](docs/TEST_PLAN.md): how the code and the extractions are checked.
- [AGENT_LOG.md](AGENT_LOG.md): what the agent did, what it got wrong, and what I changed.
- [docs/DEMO.md](docs/DEMO.md): a two-minute demo with the emails in `demo/emails/`.
