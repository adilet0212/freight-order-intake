# Test plan

The question this plan answers: **how do I know the agent's code is right, and how do I know the
model's extractions are right?** They are different questions with different tools.

## 1. Code correctness

| Level | What | Where | Needs |
|---|---|---|---|
| Unit | Every normalize rule and every gate rule, with boundary cases | `src/**/*.spec.ts` | nothing |
| Unit | The eval's own scoring maths | `src/eval/score.spec.ts` | nothing |
| API | Each endpoint through HTTP, including 400, 404, 409 and duplicates | `test/*.e2e-spec.ts` | Postgres |

API tests use the real database and a `FakeModel` from `@nestjs/ai/testing`. The database is real
because the duplicate-email guarantee lives in a unique index, and a mocked repository cannot
prove an index works. The model is fake because tests must be free, fast and repeatable.

Boundaries tested on purpose:
- Weight: exactly 45,000 lbs is accepted, 45,001 is held.
- Dates: delivery at the same minute as pickup is accepted, one day earlier is held.
- Scoring: 1 lb weight difference passes, 2 lb fails.

## 2. Do the tests have teeth?

A test that cannot fail proves nothing. Three rules were broken on purpose and the suite re-run:

| Change | Result |
|---|---|
| Removed `onConflictDoNothing` from the insert | The concurrent-duplicate test failed |
| Payload rule `>` changed to `>=` | The truckload boundary test failed |
| Date rule `<` changed to `<=` | The same-minute boundary test failed |

Adilet: repeat at least two of these yourself, plus one of your own, and log it.

## 3. Extraction quality (the eval)

`npm run eval` runs every labelled email in `eval/dataset/` through extract, normalize and gate,
and compares the result with the label field by field.

| Metric | Meaning |
|---|---|
| Schema-valid answers | The model returned JSON matching the schema |
| Order / not-an-order | It agreed with the label on whether the email is a shipment request |
| Field accuracy | Correct fields over all scored fields |
| **Silent failures** | Wrong **and** auto-accepted. The target is zero. |
| Wrong but held | The gate did its job |
| Correct but held | What the gate costs in reviewer time |
| Latency p50 / p95, cost per 1,000 | Is it practical |

Why silent failures and not accuracy is the headline: a 96%-accurate extractor is useless if
nobody knows which 4% is wrong. The gate turns "sometimes wrong" into "wrong, and flagged".

Scoring rules, each a choice to be able to defend:
- Names, streets and cities ignore case and extra spaces. Codes, dates and numbers are exact.
- Weight allows 1 lb, because a kg conversion can round either way.
- `specialInstructions` is not scored: free text has no single right answer.
- Stops are matched by position. A missed stop counts all 8 of its fields wrong.

## 4. Label rules (proposed, see SPEC decision 2)

1. Label what the email says, not what is probably true.
2. Reference number: the code only, without "PO", "Ref" or "#".
3. A pallet is a skid.
4. Dates are local time at the stop, `YYYY-MM-DDTHH:mm`. A day with no time is 00:00 to 23:59.
   A start time with no stated end has a null end. "Before 14:00" is 00:00 to 14:00.
5. In a thread, the newest message wins.
6. Weight is the order total in pounds, converted at 2.20462 lbs per kg and rounded.
7. Not stated means null. Never fill in a likely value.

**The agent may draft email text. Only Adilet writes labels.** A model grading a test set that a
model labelled measures agreement, not correctness. The three cases in `eval/dataset/` now are
agent drafts to show the format, and each says so in `labelledBy` until it is verified by hand.

## 5. Not tested yet

- Any call to a real model. Nothing in this repo has been run against a live provider.
- `src/eval/run.ts` end to end (its scoring functions are tested, the runner is not).
- A provider outage (SPEC decision 4).
- Load, or more than two concurrent requests.
- Emails longer than the 20,000 character limit, HTML email, attachments.
