# Agent log

An honest record of how this project was built with a coding agent: what I asked for, what the
agent did, how I checked it, and what I changed. Agent entries are written by the agent. Entries
under "Adilet" are mine.

---

## Session 1: Saturday 14 Nov 2026, evening

**Agent:** Claude (cloud session). **Adilet:** away for about 40 minutes of it.

### What was asked

- Build something for Rose Rocket's Junior Software Engineer posting, which asks for a project
  where an agent wrote most of the code, and for how the work was planned, checked and changed.
- The idea (email in, validated order out, in their stack, with an eval) came out of an earlier
  planning conversation with Claude. Adilet chose to go with it.
- While away, Adilet sent one instruction: do not cut the review screen or WebSockets, and add
  anything that makes the project stronger.

### What the agent did

Wrote `SPEC.md`, `docs/TEST_PLAN.md`, `CLAUDE.md`, and backend v0: schema, normalize, review
gate, extraction service, repository, service, controller, migration, eval scoring and runner,
three sample eval cases, CI workflow, Docker Compose file.

### Decisions the agent made alone (all need Adilet's review)

- Used the stack the official NestJS 12 template and first-party packages give: Vitest, oxlint,
  `@nestjs/drizzle`, `@nestjs/ai`, Zod validation pipe.
- Relational tables plus one JSONB column for the raw model answer.
- Rule-based review gate instead of a model confidence score.
- Model returns value and unit; code converts kg to lbs.
- Local timestamps without a time zone for stop windows.
- Duplicate protection through a unique index on the message id.
- 45,000 lbs as the one-truckload limit. **Not verified against a source.**
- Label rules in `docs/TEST_PLAN.md` section 4.
- The seven open decisions in `SPEC.md` section 7.

### What the agent got wrong, and how it was caught

1. **Planned the wrong stack from memory.** The first plan was Jest, Prisma and the Vercel AI
   SDK directly. Generating the official template showed NestJS 12 ships Vitest and has
   first-party database and AI modules. Switched before writing code. Caught by: generating the
   template and reading it instead of trusting recall.
2. **`npm install` crashed** on npm 10 with an internal resolver error. Worked on npm 11.
   Recorded in `CLAUDE.md`, `package.json` engines and the CI workflow.
3. **Schema and database disagreed.** The Zod schema allowed any number for commodity quantity;
   the column is an integer. A model answer of 2.5 would have failed at insert with a 500.
   Caught by: reading the generated migration SQL. Fixed with a whole-number rule in
   `normalize.ts` and a test.
4. **Wrong expected values in the agent's own tests.** `score.spec.ts` expected 29 fields per
   order and 116 in total; the right numbers are 27 and 108. The tests failed. The agent
   recounted by hand (5 order fields + 1 + 2 stops x 8 + 1 + 4) rather than pasting in the
   numbers the code produced.
5. **A wrong comment** in the same file claimed a missed stop scores 7 wrong fields. It is 8.
6. **A lint warning** for sorting numbers without a compare function. Fixed.
7. **The app did not read `.env`.** The first version only worked when variables were exported
   in the shell, so the README's own instructions would have failed on a fresh clone. Caught by:
   following the README steps with a temporary `.env` instead of exported variables. Fixed with
   `ConfigModule.forRoot()` in the app and the eval runner, and `process.loadEnvFile` in
   `drizzle.config.ts`.

### What was verified

- `npm run typecheck`, `npm run lint`: clean.
- `npm test`: 41 unit tests pass.
- `npm run test:e2e`: 14 API tests pass against Postgres 16 with a fake model.
- `npm run build`, then the built server started against Postgres: `GET /orders` returned 200,
  an invalid body returned 400 with field-level messages.
- Three deliberate breaks (see `docs/TEST_PLAN.md` section 2) each failed exactly one test.

### What was NOT verified

- **No real model call has succeeded.** Extraction quality is unknown. There are no eval numbers.
- `npm run eval` has never run end to end. With an invalid key it loads the dataset and fails at
  the provider with an authentication error, which shows it reaches the model call and no more.
- The CI workflow has never run on GitHub.
- `docker compose up` was not run (the agent's machine had Postgres installed directly).
- The three eval labels were written by the agent and are unchecked.

### Found and left open

- With an invalid API key, `POST /emails` returned a bare 500 and stored nothing. That breaks
  the "never drop an email" rule for provider outages. Left for Adilet: SPEC decision 4.

### Adilet: review of session 1

_To fill in after reading every file. Be specific: file, line, what and why._

- What I checked and how:
- What I changed and why:
- What I disagreed with:
- SPEC decisions 1 to 7:

---

## Session 2: Sunday 15 Nov to Monday 16 Nov 2026, review console

**Agent:** Claude Code (desktop app, `frontend` worktree). Full record:
[docs/agent-session-2.md](https://github.com/adilet0212/freight-order-intake/blob/frontend/docs/agent-session-2.md)
on branch `frontend` (not merged into `main`, not pushed when this entry was written).

- Agent: built the review console in `web/` (queue, order screen with hold reasons and approve, paste-an-email form) and a WebSocket gateway that sends `order.created` and `order.approved`, in 11 commits plus the record. Backend changes limited to the gateway, CORS and their wiring.
- Agent: verified typecheck and lint clean, 213 unit tests (49 API project, 164 web), 23 API tests on `intake_test_web`, 18 deliberate breaks each failing a test, and the screens in Chromium at 1024, 1280 and 1440 px with seeded data.
- Agent: listed 17 mistakes. The main ones: guessed `.address()` in a test (caught by `tsc`); ran the API tests against a mangled `DATABASE_URL` and briefly read the failures as teeth checks (caught by the count, 22 of 23 failing); went on after one `pg_isready` "no response" without telling Adilet; three layout defects at 1024 px that no jsdom test could see (caught in the browser); three teeth-table rows written from memory and wrong (caught by checking against the recorded output).
- Agent: not verified: no real model call, so a pasted email becoming a 201 order was never seen in a browser; `order.created` reaching a second browser window (only the API test); the commands in `web/README.md` exactly as written; CI.
- Agent: left open: `approve` checks the status and updates in two steps, so two approvals at once can both succeed; the review endpoint does not validate date strings (500); `GET /orders` has no paging; the queue loads one request per order.

### My review

---

## Session 3: Monday 16 Nov 2026, pre-walkin

**Agent:** Claude Code (desktop app). The session reported Claude Fable 5.2 while planning and
Claude Opus 5.5 while implementing. Full record: [docs/agent-session-3.md](docs/agent-session-3.md).
Branch `pre-walkin`, cut from `c2b8643`.

- Agent: drafted unlabelled eval emails 031–035 in `eval/drafts/` (rate quote, billing dispute, "where is my truck", two weights for one freight, a reply that moves the pickup date without saying it replaces the first). Did not open `eval/dataset`.
- Agent: implemented SPEC decision 4, option (b): a provider failure after retries stores `extraction_failed` and returns 201; re-sending a failed email re-runs extraction and updates the same row through an `UPDATE … WHERE status = 'extraction_failed'`. 9 unit and 7 API tests added.
- Agent: changed CI to run on every push and added a `compose-smoke` job (compose up, migrate, build, `GET /orders` answers 200).
- Agent: verified 50 unit and 21 API tests on `intake_test_web` (Postgres 18.7), and three deliberate breaks each failing as expected.
- Agent: listed 7 mistakes, all caught by the agent itself, e.g. draft 035 first put a delivery on US Thanksgiving, and its later reply first hinted the new date replaced the old one, against the brief.
- Agent: not verified: the workflow has never run on GitHub; the compose job end to end; Postgres 16 and Node 22; a real provider outage (only `providerError(503)` from the fake model); `npm run eval`. Trade-offs noted: no cap on re-sends of a failed email, and the provider's error text is returned in `reviewReasons`.

### My review
