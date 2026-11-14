# freight-order-intake

Turns a shipment-request email into a validated truckload order, and decides whether that order
is safe to accept without a person checking it.

> Work in progress. No eval results yet: nothing here has been run against a real model.
> This README is a placeholder until there are measured numbers to put in it.

## What it does

```
email -> dedupe -> model (schema-constrained) -> normalize -> review gate -> Postgres
```

- `POST /emails` takes `{ subject, body, receivedAt, messageId? }` and returns the stored order.
- The order's `status` is `auto_accepted`, `needs_review` (with reasons in words),
  `not_an_order` or `extraction_failed`.
- `GET /orders?status=needs_review` is the review queue.
- `PATCH /orders/:id/review` saves a reviewer's corrected order.
- Sending the same email twice returns the first order and makes no second model call.

## Run it

Needs Node 22+, npm 11+ and Docker.

```bash
npm ci
cp .env.example .env          # set LLM_PROVIDER, LLM_MODEL and the matching API key
docker compose up -d
npm run db:migrate
npm run start:dev
```

```bash
npm test                      # 41 unit tests, no services needed
npm run test:e2e              # 14 API tests, needs Postgres, uses a fake model
npm run eval                  # labelled emails against the real model
```

## Read next

- `SPEC.md`: the problem, the rules, and the open decisions.
- `docs/TEST_PLAN.md`: how the code and the extractions are checked.
- `AGENT_LOG.md`: what the agent did, what it got wrong, and what I changed.

## Stack

NestJS 12, TypeScript, Zod, PostgreSQL with Drizzle ORM, `@nestjs/ai`, Vitest.
