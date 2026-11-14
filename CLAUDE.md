# Working rules for coding agents in this repo

Read `SPEC.md` and `docs/TEST_PLAN.md` before changing anything.

## How we work

- One change per commit. Run `npm run typecheck && npm run lint && npm test` before every commit,
  and `npm run test:e2e` when anything under `src/orders` or `src/db` changed.
- Write or update the test in the same commit as the behaviour. A new gate rule needs a test for
  the rule and a test at its boundary.
- If a test fails, fix the code or prove the test wrong. Never edit an expected value just to make
  it pass. Recompute it by hand and say so in the commit message.
- Do not add a dependency without asking. Check the first-party NestJS packages first.
- Never write or change a label in `eval/dataset/`. You may draft email text; Adilet labels.
- Never tune the prompt against a specific eval case. Change the rule, then re-run everything.
- After each working session, append to `AGENT_LOG.md`: what you were asked, what you did, what
  you got wrong, what is unverified. Be specific and do not flatter the work.

## Design rules

- The model reads, the code computes. Unit conversion, date checks and every accept-or-hold
  decision are plain code in `normalize.ts` and `review-gate.ts`. Keep them pure functions.
- Every number in a rule has a comment saying why that number.
- An email is never dropped. A failure becomes a stored status, not a lost request.
- Guarantees that must survive two requests at once belong in the database (constraints,
  transactions), not in an if-statement.

## Stack notes

This project's NestJS (12) is newer than most training data. https://docs.nestjs.com/llms.txt
indexes the docs. Before guessing an API, read the package's `.d.ts` in `node_modules`.

- ESM only: relative imports end in `.js`; there is no `__dirname` (use `import.meta.dirname`).
- Tests are Vitest: `vi.fn()`, not `jest.fn()`.
- Validation: Zod through `StandardSchemaValidationPipe`, `@Body({ schema })`.
- Database: `@nestjs/drizzle` with Drizzle ORM on node-postgres. After editing
  `src/db/schema.ts`, run `npm run db:generate` and commit the migration.
- Model calls: `@nestjs/ai` (`AiService.generateObject`). In tests use `FakeModel` and
  `overrideModels` from `@nestjs/ai/testing`. Tests never call a real model.
- Install with npm 11 or newer. npm 10 crashes on this dependency tree.

## Commands

```
docker compose up -d        # Postgres on :5432 with intake and intake_test databases
npm run db:migrate          # apply migrations to DATABASE_URL
npm run start:dev           # API on :3000
npm test                    # unit tests
npm run test:e2e            # API tests (needs Postgres)
npm run eval                # labelled emails against the real model (needs a key, costs money)
```
