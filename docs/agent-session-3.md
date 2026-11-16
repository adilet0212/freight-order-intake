# Agent session 3: Monday 16 Nov 2026

**Agent:** Claude Code (desktop app, Code tab). The session reported Claude Fable 5.2 while
planning and Claude Opus 5.5 while implementing; the model changed between the two. **Branch:** `pre-walkin`,
cut from `main` at `c2b8643`. Nothing pushed, merged or rebased.

## What was asked

Plan first, then three tasks with one commit each, in order:

1. Five unlabelled draft eval emails, 031 to 035: a rate quote, a billing dispute, a "where is my
   truck", one email with two weights for the same freight, and a thread whose later reply gives a
   different pickup date without saying it replaces the first.
2. SPEC decision 4, option B: on a provider failure, store the email as `extraction_failed` and
   return 201. Re-sending a failed email re-runs extraction. Unit and API tests. Update SPEC.
3. CI: typecheck, lint, unit and API tests on a postgres:16 service, plus a job that starts the
   docker-compose stack, migrates, and proves the API starts against it.

Constraints: no Docker locally, only the `intake_test_web` database, never read `.env`, placeholder
model keys on the command line, no attribution in commits, no edits to README, AGENT_LOG,
`eval/dataset` or other files under `eval/`.

## Commits

| Commit | What |
|---|---|
| `b7c3ef6` | `eval/drafts/031`–`035`, email fields only |
| `7b9fc2d` | Outage option B: service, repository, 9 unit tests, 7 API tests, SPEC and TEST_PLAN |
| `6c7d792` | CI: runs on every push, new `compose-smoke` job |
| (this one) | This file |

## What was done

**Baseline on `main`, before any change:** typecheck and lint clean, 41 unit, 14 API tests green on
`intake_test_web` (Postgres.app 18.7, Node 24.22, npm 11.19). It matched the expected baseline.

**Task 1.** Five drafts, written by a scratchpad script with `JSON.stringify(…, null, 2)` so the
format matches 004–030 exactly (2-space indent, no trailing newline, keys `subject, body,
receivedAt`). A second scratchpad script checked all 32 drafts: each parses, has exactly that key
set and passes `inboundEmailSchema`. I did not open `eval/dataset` or any label file.

**Task 2.**
- `OrdersService.ingest` now catches `AiModelError`, the error `@nestjs/ai` throws when every
  attempt has failed (read in `node_modules/@nestjs/ai/dist/runtime/model-policy.js`), and stores
  `extraction_failed` with the reason `Model provider failed: <message>`, `rawExtraction` null and
  zero tokens. Any other error still throws.
- A re-send whose stored order is `extraction_failed` runs extraction again. If the model answers,
  `OrdersRepository.replaceFailed` updates the same row (id and `created_at` kept) and replaces its
  stops and commodities, all in one transaction. Its UPDATE has `status = 'extraction_failed'` in
  the WHERE clause, so a second concurrent re-send matches nothing. If the re-run hits another
  outage, nothing is written.
- The catch is in the service, not `ExtractionService`, because `src/eval/run.ts` calls
  `extract()` directly. Catching there would have made the eval score an outage as a bad model
  answer.
- Tests: `src/orders/orders.service.spec.ts` (9 unit, mocked repository and extraction) and 7 API
  tests in `test/orders.e2e-spec.ts`, using `providerError(503, { retryAfter: 0 })` three times.
  `retryAfter: 0` makes the module's backoff zero.
- SPEC §3 step 1 and §7 decision 4 now say what was decided. TEST_PLAN §2 has two new rows, §5 now
  says a real outage is untested.
- After: 50 unit, 21 API tests green.

**Task 3.** `.github/workflows/ci.yml`. The existing `test` job already did typecheck, lint, unit,
migrate, API tests and build on postgres:16. It is unchanged. The triggers were changed:
`push: [main]` + `pull_request` became every `push` + `workflow_dispatch`, with a per-branch
`concurrency` group, because before this change pushing `pre-walkin` would have run nothing. The new `compose-smoke` job
does `docker compose up -d --wait`, waits until Postgres answers on TCP, runs `db:migrate` on
`intake`, builds, starts `dist/main.js` with placeholder model variables, and requires
`GET /orders` to answer 200 with `[]` within 30 seconds. It prints the logs on failure and always
runs `docker compose down -v`.

## Did the tests have teeth

| Break (reverted afterwards) | Result |
|---|---|
| Removed `status = 'extraction_failed'` from the replace UPDATE | Both race tests failed (the HTTP one and the repository one), 5 runs of 5 |
| Re-send returned any stored order, failed or not | 1 unit and 4 API tests failed |
| Smoke script pointed at a database that does not exist | `GET /orders` answered 500, the check failed as it should |

## Mistakes I made and caught

1. **Two exploration commands failed in zsh:** a `grep --include=*.js` (unquoted glob) and a loop
   that echoed `===`. I re-ran both in a form that worked. No effect on the work.
2. **One exploration `cd` into `node_modules/@nestjs/ai/dist` stuck** for the next command. No
   effect, but a wrong relative path could have read or written the wrong place.
3. **The plan had a garbled line:** "eval/drafts holds 004–030 (not 029)". Your brief said 004–029;
   030 also exists. The numbering 031–035 is right either way.
4. **Draft 035, first version, put the delivery on Thursday 26 Nov, US Thanksgiving.** Caught on
   re-reading. Moved it to Friday 27 Nov.
5. **Draft 035's later reply first ended "Same everything else."** That hints the date replaces
   the earlier one, which the brief ruled out. Removed before writing the file.
6. **The draft check script first imported the schema through a long relative path from the
   scratchpad.** Changed to an absolute path before running it.
7. **The plan said the compose wait would use `psql -h localhost` inside the container** and listed
   its trust auth as a risk. While writing the job I switched to `pg_isready -h 127.0.0.1`. It
   only needs the TCP listener, not a login, so the auth question goes away.

## Where I went beyond or away from the plan

- **An extra API test** at repository level calls `replaceFailed` twice in a row. The plan's
  race test depends on timing to fail. This one fails deterministically if the database guard is
  removed.
- **A unit test the plan did not list:** `it.each` over all four non-failed statuses.
- **TEST_PLAN §2** gained two rows and "Three rules were broken" became "These rules were broken".
  The plan only mentioned §5.
- **The repository function was renamed:** `findIdByMessageId` became `findByMessageId` and
  returns `{ id, status }`. Its only callers were in the service.

## Fallbacks

- **YAML check:** there is no YAML parser in `node_modules` and PyYAML is not installed. I parsed
  the workflow with the system Ruby's built-in YAML library (`/usr/bin/ruby -ryaml`) and installed
  nothing. Ruby reads the key `on` as `true`, a YAML 1.1 quirk that GitHub does not share.
- **Local smoke run:** run on port 3999, not 3000, so it could not hit a dev server of yours. It ran
  against `intake_test_web` on Postgres 18, not the compose database. The server ran as a
  background child of one shell command and was stopped with `pkill -f "node dist/main.js"` in
  the same command.
- **One connection outside `intake_test_web`:** for the negative smoke check, the app was pointed
  at a database name that does not exist (`no_such_database_smoke`). Postgres refused it and
  nothing was created.
- **`npm run build` rewrote the local `dist/`.** It is gitignored.
- **About `.env`:** I never opened it, but the app's `ConfigModule.forRoot()` loads it in every
  process I started. I checked `@nestjs/config`'s `assignVariablesToProcess`: a variable already in
  the environment is never overwritten. Every run set `DATABASE_URL`, `LLM_PROVIDER`, `LLM_MODEL`,
  `ANTHROPIC_API_KEY` and `GOOGLE_GENERATIVE_AI_API_KEY` to placeholders first. Any other key in
  `.env` was still loaded into those processes.

## Trade-offs you should know about

- **Every re-send of a failed email costs a model call.** There is no cap on re-sends.
- **A refused key (401) is also stored as `extraction_failed`,** after one attempt, because it is
  not retryable. I got that by reading `model-policy.js`, not by running it.
- **The provider's error message is stored and returned by the API** in `reviewReasons`. For the
  providers in use I expect no secrets in it. Not checked against a real provider.
- **A re-run that fails schema validation again replaces the earlier raw answer** with the newer
  one. Only an outage leaves the stored order untouched.
- **A re-send of a failed order answers 200, also when it succeeds,** because no new order was
  created. A client cannot tell "retried and fixed" from "already stored" by the status code; it
  has to read `status` in the body.

## Unverified until you push

- The workflow has never run. That covers the bare `push:` trigger, `workflow_dispatch`, the
  concurrency cancel, and both jobs end to end.
- `npm ci` on Linux with Node 22. The lockfile is unchanged, and these tests ran on macOS with Node 24.
- The migration and all 21 API tests on Postgres 16, including the conditional UPDATE under
  concurrency. Here they ran on Postgres 18 only.
- The compose job:
  - that the runner's `docker compose` supports `--wait`
  - my reading that the postgres image runs `init.sql` on a temporary server with no TCP listener,
    which is what the wait step relies on
  - `pg_isready` inside the container
  - the build and server start on Linux with a placeholder key
  - the `GET /orders` check against the compose database
- A real provider outage: a timeout, a dropped connection, a 5xx from a live provider, a revoked
  key. Only `providerError(503)` from the fake model was tested.
- `npm run eval` was not run. `src/eval` is unchanged, so an outage there still throws, as before.
- How a model reads drafts 031–035. They are unlabelled; the labels are yours to write.

## For you to fold in (files I was told not to edit)

- `AGENT_LOG.md`: SPEC §7 asks for each decision to be recorded there. Decision 4 is now option B.
- `README.md` does not say that a provider failure is stored as `extraction_failed`, or that
  re-sending a failed email retries it. One line would cover it.
