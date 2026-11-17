# freight-order-intake

Takes a shipment request email, turns it into a truckload order, and decides if that order is
safe to accept without a person checking it.

Most of the code was written by an AI coding agent (Claude Code). How I planned, checked and
changed its work is below and in [AGENT_LOG.md](AGENT_LOG.md).

## How I worked with the agent

I wrote the label rules and every eval label, and I made the open decisions in SPEC.md as they
came up. Claude Code wrote most of the code. Before it wrote anything, I reviewed its plan and
often changed it. For example, I kept the backend frozen while I was still learning it, made the
agent use a separate test database and fake API keys, and chose how a provider outage is handled.
I checked its work with the tests, by breaking the code on purpose to make sure a test fails, and
with the eval below. AGENT_LOG.md lists what the agent got wrong, who caught it, and what changed.

## Summary

A dispatcher gets load tenders by email and types them into a TMS by hand. This service uses a
language model to read the email, but every conversion, date check and accept-or-hold decision is
plain code. An order is auto-accepted only when it passes every rule in a review gate. If any rule
fires, the order is held with the reasons written out. The number that matters is not field
accuracy. It is how many orders were wrong and still got auto-accepted.

Stack: NestJS 12, TypeScript, Zod, PostgreSQL with Drizzle ORM, `@nestjs/ai` (Anthropic or
Google), Vitest, GitHub Actions.

## Pipeline

```
email
  -> dedupe        Message-ID, or SHA-256 of the email; unique index in Postgres
  -> model         one call, answer must match a Zod schema; null for anything not stated
  -> normalize     code: kg -> lbs, upper-case codes, reject impossible dates   (normalize.ts)
  -> review gate   code: each rule that fires adds a reason                     (review-gate.ts)
  -> Postgres      order, stops, commodities in one transaction; raw model answer kept as JSONB
```

The gate rules and the reason for each one are in [SPEC.md section 4](SPEC.md#4-review-gate-rules).
A missing rate does not hold an order, because many tenders run on a contract rate.

## Statuses

| Status | Meaning |
|---|---|
| `auto_accepted` | Passed every gate rule. Nobody needs to look at it. |
| `needs_review` | At least one rule fired. `reviewReasons` says which ones, in words. |
| `not_an_order` | The model read the email as something else, like a rate quote or a tracking question. The email is kept and the order fields are empty. |
| `extraction_failed` | The model's answer didn't match the schema, or the provider failed. The email is still stored. |
| `approved` | A person reviewed a held order and saved it through `PATCH /orders/:id/review`. |

## Headline metric: silent failures

A silent failure is an order that is **wrong and was auto-accepted**. The target is zero.

Field accuracy alone doesn't help a dispatcher. A 96% accurate extractor still can't be trusted if
nobody knows which 4% is wrong. A wrong order that gets held costs a reviewer a minute. A wrong
order that gets accepted sends a truck to the wrong place or on the wrong day. The eval also
reports "wrong but held" (the gate did its job) and "correct but held" (what the gate costs in
reviewer time), so making the gate stricter has a visible price.

## Results (first run, Nov 17)

Five emails, all labelled by hand by me. Model: google/gemini-3.5-flash-lite, prompt v1.

| Metric | Result |
|---|---|
| Order / not-an-order correct | 5 of 5 |
| Field accuracy | 91.0% (89 fields) |
| Silent failures (wrong and auto-accepted) | 1 |
| Wrong but held by the gate | 1 |
| Correct but held anyway | 0 |
| Cost per 1,000 emails | $0.90 |

The silent failure: a forwarded email received on a Monday said "must deliver Wednesday before
14:00". The model put the delivery on Thursday, made up a date for a second drop that had no date
at all, and the gate auto-accepted the order. The email with two different weights was also wrong,
but the gate held it, which is what it's for.

Five emails is too few to claim an accuracy number. This run shows how I measure, not a final
result.

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

`GET /orders/:id`: one order with its stops, commodities, reasons and the raw model answer.

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

A bad body gets a 400 with a message for each field. An unknown id gets a 404.

## Run it locally

Needs Node 22+ and npm 11+ (npm 10 crashes on this dependency tree). Both setups below end with
the API on port 3000.

### With Postgres.app (no Docker)

I work on an Intel Mac with macOS Ventura, where Docker Desktop isn't supported, so this is the
setup I use. Postgres.app listens on 5432 and trusts local connections. With its command-line
tools on your `PATH`:

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

A variable set on the command line wins over the same variable in `.env`. The second migrate
depends on that.

### With docker compose

`docker-compose.yml` runs Postgres 16 on 5432 and creates `intake` and `intake_test`. I can't run
Docker on my Mac, so CI runs this path for me (see Tests).

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

Last run on Nov 17, 2026 (Node 24.22, npm 11, Postgres.app 18): typecheck and lint clean,
**236 unit and component tests** (67 for the API, 169 for the web app) and **34 API tests** pass.

- Unit tests check the normalize and gate rules at their boundaries, for example 45,000 lbs is
  accepted and 45,001 is held, and a delivery at the same minute as the pickup is accepted. They
  also cover the eval's scoring and the outage paths in the service.
- API tests use a real database, because the duplicate guarantee lives in a unique index, and a
  mocked repository can't prove an index works. The model is `FakeModel` from
  `@nestjs/ai/testing`: no key, no network, no cost.
- Rules were broken on purpose to check that a test fails for each one. The list is in
  [docs/TEST_PLAN.md section 2](docs/TEST_PLAN.md#2-do-the-tests-have-teeth).

CI (`.github/workflows/ci.yml`) runs the same checks on Postgres 16 on every push, plus a job that
starts `docker compose`, migrates, and checks that the built API answers.

## Eval

```bash
npm run eval                  # real model, needs a key in .env, costs money
```

It runs every labelled email in `eval/dataset/` through extract, normalize and gate, compares each
field with my label, and writes a report to `eval/results/` with silent failures, field accuracy,
latency p50/p95 and cost per 1,000 emails (set `PRICE_INPUT_PER_MTOK` and `PRICE_OUTPUT_PER_MTOK`
for the cost line).

- Label rules: [eval/LABEL_RULES.md](eval/LABEL_RULES.md). For example: the customer is the
  company tendering the load (usually the broker), weights are in pounds, and anything the email
  doesn't say is null.
- Every label is written by hand by me. If a model labels the test set and a model is graded on
  it, you measure agreement, not correctness.
- The agent may draft email text, but never labels. Unlabelled drafts are in `eval/drafts/`.

## Provider outage

SPEC decision 4, option B. If the provider still fails after the AI module's three attempts
(timeout, 5xx, network error, or a refused key), the email is stored as `extraction_failed` and
`POST /emails` returns 201 with that status. An email is never dropped.

Sending the same email again (same Message-ID or same content) re-runs extraction for an
`extraction_failed` order and updates that order in place: same id, 200. If the re-run hits
another outage, nothing is written. Any other stored order comes back unchanged with no model
call. Two re-sends at the same time are settled in the database: the update only matches while
the status is still `extraction_failed`.

## Review screen

A React review console in `web/` (Vite) shows the queue with held orders first, the email next to
the extracted fields, the gate's reasons in plain words, and an Approve button. A NestJS
WebSocket gateway pushes new and approved orders to open screens, so the queue updates without a
refresh. How to run it: [web/README.md](web/README.md).

The agent built this layer. I set the main decisions in its plan: no backend changes for the
first version (each queue row loads its own details, which is fine at demo size), one package
instead of a separate web app, live gate checks shown as warnings that never block a reviewer,
and a separate test database. It's covered by component tests and a browser check done by the
agent. I haven't reviewed every line of it yet.

## Out of scope, and next

Not built, on purpose:

- **Redis and a job queue.** One email is one request and one model call, so nothing needs them
  yet. A queue makes sense once there's a real mailbox feed and retries in the background.
- **PDF and spreadsheet attachments.** A lot of real loads come as attachments, like rate
  confirmations. It's a separate parsing problem and the first thing I'd add.

Next, in about this order:

- **Resolve relative dates in code.** This is what the first eval run found. Instead of asking
  the model to turn "Wednesday" into a date, have it return the words and resolve them in code
  against the received date, the same "model reads, code computes" rule I use for weights. Then
  check the fix on emails it wasn't developed against.
- **Label more emails.** Five is a start, not a test set.
- **Cap re-extraction.** Every re-send of a failed email costs a model call, with no limit.
- **Re-run the gate on review.** `PATCH /orders/:id/review` saves what the reviewer sends as
  `approved` without checking it against the gate rules.
- **Paging on `GET /orders`.** It returns every order, including email bodies and raw model
  answers.

## Read next

- [SPEC.md](SPEC.md): the problem, the gate rules, the decisions.
- [docs/TEST_PLAN.md](docs/TEST_PLAN.md): how the code and the extractions are checked.
- [AGENT_LOG.md](AGENT_LOG.md): what the agent did, what it got wrong, and what I changed.
- [docs/DEMO.md](docs/DEMO.md): a two-minute demo using the emails in `demo/emails/`.