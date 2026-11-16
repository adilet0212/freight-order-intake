# What the agent got wrong: draft for the handout

Draft by the agent, for Adilet to choose from and rewrite. Sources: `AGENT_LOG.md` (session 1),
`docs/agent-session-2.md` on branch `frontend` (session 2), `docs/agent-session-3.md`
(session 3). Every "caught by" below is taken from those records. None of them records a defect
caught by Adilet, so none below says so; if you caught any of these yourself, the records are
missing it and should say so first.

Ranked by what it would have cost if it had gone unnoticed, not by when it happened.

## 1. The app dropped an email when the model provider failed

- **What it did (session 1):** with a bad or refused API key, `POST /emails` returned a bare 500
  and stored nothing. That broke the project's own rule that an email is never dropped.
- **How it was caught:** the agent caught it itself, while running the API with an invalid key.
  It did not fix it; it left it as SPEC decision 4.
- **What changed:** Adilet chose option (b). In session 3 the agent implemented it: a provider
  failure after retries is stored as `extraction_failed` with 201, and re-sending the email
  re-runs extraction through an `UPDATE … WHERE status = 'extraction_failed'`, so two re-sends at
  once cannot both write (commit `7b9fc2d`, 9 unit and 7 API tests).

## 2. A schema mismatch that would have turned a model answer into a 500

- **What it did (session 1):** the Zod schema accepted any number for a commodity quantity, but
  the column is an integer. A model answer of 2.5 skids would have failed at insert.
- **How it was caught:** the agent caught it itself, by reading the generated migration SQL.
- **What changed:** a whole-number rule in `src/orders/normalize.ts`: a fractional quantity
  becomes null plus an issue, which holds the order for review. A unit test covers it.

## 3. Test results read from a broken setup

- **What it did (session 2):** passed `DATABASE_URL` with `env $VARS command` in zsh, which does
  not split words, so the API tests ran against a database that did not exist. 22 of 23 failed.
  Three deliberate-break checks ran in that state "failed" as well, which proved nothing, and
  the agent at first took them as proof that the tests had teeth.
- **How it was caught:** the agent caught it itself, from the count: removing one call cannot
  fail 22 tests.
- **What changed:** a wrapper script that exports the variables; the three checks were redone on
  a green suite.

## 4. Wrong claims in the test plan's "teeth" table

- **What it did (session 2):** wrote three rows of the deliberate-break table in
  `docs/TEST_PLAN.md` from memory. Two named the wrong failing test file, one missed a second
  file.
- **How it was caught:** the agent caught it itself, by checking every row against the recorded
  command output before committing.
- **What changed:** the rows were corrected. One row still says the output was cut short, so
  which other files failed is not known.

## 5. Planning on a stack remembered, not read

- **What it did (session 1):** the first plan used Jest, Prisma and the Vercel AI SDK directly.
  NestJS 12 ships Vitest and has first-party `@nestjs/drizzle` and `@nestjs/ai`.
- **How it was caught:** the agent caught it itself, by generating the official template and
  reading it. It switched before writing code.
- **What changed:** `CLAUDE.md`, written in the same session, says to check first-party NestJS
  packages first and to read the package's `.d.ts` before guessing an API. In session 2 the agent still guessed one
  (`.address()` in a gateway test); the type checker caught that.

## 6. Layout defects that every test passed

- **What it did (session 2):** three defects at 1024 px in the review console: a state label
  wrapping onto two lines, a "Postal code" label pushing its input down, and a message squeezed
  into a field about 60 px wide. All component tests passed, because jsdom does no layout.
- **How it was caught:** the agent caught it itself, by looking in a browser at 1024 px. Its first
  fix for the third defect did not work; it found that by measuring line counts in the browser.
- **What changed:** fixed in `15f435b` and `a8efb05`, with a test for how the message is tied to
  its field. No component test can catch this kind of defect here.

## 7. Its own tests expected wrong numbers

- **What it did (session 1):** `src/eval/score.spec.ts` expected 29 scored fields per order and
  116 in total. The right numbers are 27 and 108. A comment in the same file said a missed stop
  scores 7 wrong fields; it is 8.
- **How it was caught:** a test caught it: the tests failed.
- **What changed:** the agent recounted by hand (5 order fields + 1 + 2 stops × 8 + 1 + 4) instead
  of pasting in what the code produced, and fixed the comment. This is the rule in `CLAUDE.md`:
  never edit an expected value just to make it pass.

## 8. Broke a stop rule and did not say so

- **What it did (session 2):** the instruction was "if 5432 is down, stop and tell me".
  `pg_isready` said "no response" once at the start. A second check a moment later answered, and
  the agent went on without telling Adilet.
- **How it was caught:** the agent reported it itself, in the session record written at the end.
  Nobody caught it at the time.
- **What changed:** nothing in the code. It is recorded as a judgment call against a strict
  reading of the rule.

## Also considered

Left out of the eight, in case one fits better:

- **Session 1:** the app did not read `.env`, so the README's own steps would have failed on a
  fresh clone. The agent caught it itself by following the README with a temporary `.env`. Fixed
  in `08ea99c`.
- **Session 2:** `approve` checks the status and updates in two steps, so two approvals at once
  can both succeed. `CLAUDE.md` says such guarantees belong in the database. The agent found it
  and left it open, as instructed. Not fixed.
- **Session 2:** a commit message claimed a measurement ("wrapped to four or five lines") that was
  an estimate. The agent caught it itself on re-reading and amended the unpushed commit.
- **Session 3:** draft email 035 first put a delivery on US Thanksgiving, and its later reply
  first hinted that the new date replaced the old one, which the brief ruled out. The agent caught
  both itself before writing the file.
