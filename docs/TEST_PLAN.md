# Test plan

The question this plan answers: **how do I know the agent's code is right, and how do I know the
model's extractions are right?** They are different questions with different tools.

## 1. Code correctness

| Level | What | Where | Needs |
|---|---|---|---|
| Unit | Every normalize rule and every gate rule, with boundary cases | `src/**/*.spec.ts` | nothing |
| Unit | The eval's own scoring maths | `src/eval/score.spec.ts` | nothing |
| API | Each endpoint through HTTP, including 400, 404, 409 and duplicates | `test/*.e2e-spec.ts` | Postgres |
| Unit | The gateway with a fake socket server; the allowed web origin | `src/orders/orders.gateway.spec.ts`, `src/web-origin.spec.ts` | nothing |
| API | Live events: a real Socket.IO client connected to the running app | `test/orders-gateway.e2e-spec.ts` | Postgres |
| API | CORS for the web origin, on HTTP and on the socket handshake | `test/cors.e2e-spec.ts`, `test/orders-gateway.e2e-spec.ts` | Postgres |
| Unit (web) | Pure functions: lane, queue sort and filter, form mapping, dates, the order store, the socket wrapper, the API client | `web/src/**/*.test.ts` | nothing |
| Component (web) | Each screen in jsdom: queue, order with hold reasons and approve, paste form | `web/src/**/*.test.tsx` | nothing |

`npm test` runs two Vitest projects: `api` (Node, 67 tests) and `web` (jsdom, 169 tests).
`npm run test:e2e` runs 34 API tests.

API tests use the real database and a `FakeModel` from `@nestjs/ai/testing`. The database is real
because the duplicate-email guarantee lives in a unique index, and a mocked repository cannot
prove an index works. The model is fake because tests must be free, fast and repeatable.

The gateway API test uses a real socket for the same reason the database is real: the claim is
"a browser receives the event", and a mocked server cannot prove a frame crossed the wire. The
app listens on a free port and a `socket.io-client` connects to it. "Nothing was sent" is proved
by the exact sequence the client received by the time a later event arrives, not by waiting and
seeing nothing.

Component tests go the other way. The socket is a fake object the test drives, and `fetch` is a
stand-in, so the tests say exactly which requests a screen made and with which body. Where a
test is about the request itself (approve, paste), the real API client runs against the
stand-in `fetch`, so the URL, method and body are the ones a browser would send.

Two tests exist to keep the web and the API from drifting apart:
- `web/src/order/hold-reasons.test.ts` feeds every reason `reviewGate` and `normalize.ts` can
  write through the plain-words explainer. A new rule without wording fails it.
- The live checks on the order screen call the API's own `reviewGate`, imported, not copied.

Boundaries tested on purpose:
- Weight: exactly 45,000 lbs is accepted, 45,001 is held.
- Dates: delivery at the same minute as pickup is accepted, one day earlier is held.
- Scoring: 1 lb weight difference passes, 2 lb fails.
- Paste form: an email body of exactly 20,000 characters is sent, 20,001 is refused before any
  request.
- Queue order: two orders received at the same instant are ordered by id, so rows do not swap.
- Order form: a weight of `1` is accepted; a quantity of `0`, `-3`, `2.5`, `1e3` or `12 skids`
  is refused.

## 2. Do the tests have teeth?

A test that cannot fail proves nothing. These rules were broken on purpose and the suite re-run:

| Change | Result |
|---|---|
| Removed `onConflictDoNothing` from the insert | The concurrent-duplicate test failed |
| Payload rule `>` changed to `>=` | The truckload boundary test failed |
| Date rule `<` changed to `<=` | The same-minute boundary test failed |
| Removed `status = 'extraction_failed'` from the replace UPDATE | Both re-send race tests failed, 5 runs of 5 |
| Re-send returned any stored order, failed or not | 1 unit and 4 API outage tests failed |

Adilet: repeat at least two of these yourself, plus one of your own, and log it.

Session 2 (gateway and review console). Each change was made, the suite run, the failure read,
and the file restored. Every one failed at least one test in the file named.

| Change | Failed in |
|---|---|
| CORS allows every origin | `test/cors.e2e-spec.ts` |
| Removed the `orderCreated` call from `ingest` | `test/orders-gateway.e2e-spec.ts` |
| Removed the `orderApproved` call from `approve` | `test/orders-gateway.e2e-spec.ts` |
| Emit `order.created` for a repeated email too | `test/orders-gateway.e2e-spec.ts` |
| Store: removed the guard against a stale answer overwriting a newer one | `web/src/orders/order-store.test.ts` |
| Store: dropped an order created while the list was loading | `web/src/orders/order-store.test.ts` |
| Store: re-read every order on reconnect, not only new and changed ones | `web/src/orders/order-store.test.ts` |
| Queue: finished orders before held ones | `web/src/queue/queue-order.test.ts`, `QueueScreen.test.tsx` |
| Queue: newest held order first | `web/src/queue/queue-order.test.ts`, `QueueScreen.test.tsx` |
| Approve: left `referenceNumber` out of the body | `web/src/order/order-form.test.ts` (see note) |
| Approve: stopped upper-casing the state or province | `web/src/order/order-form.test.ts`, `OrderScreen.test.tsx` |
| Approve: sent the order despite a field error | `web/src/order/OrderScreen.test.tsx` |
| Order screen: treated the event for its own approval as someone else's | `web/src/order/OrderScreen.test.tsx` |
| Order screen: blocked Approve while a check is open | `web/src/order/OrderScreen.test.tsx` |
| Paste: sent the received time in UTC instead of with the local offset | `web/src/paste/PasteEmailScreen.test.tsx` |
| Paste: always sent `messageId`, empty or not | `web/src/paste/PasteEmailScreen.test.tsx` |
| Paste: skipped validation before sending | `web/src/paste/PasteEmailScreen.test.tsx` |
| Order form: tied the Weight field to Quantity's message | `web/src/order/OrderScreen.test.tsx` |
| Merge with the outage work: no `order.reextracted` after a re-send replaced a failed order | `src/orders/orders.service.spec.ts`, `test/orders-gateway.e2e-spec.ts` |
| Merge: `order.reextracted` whenever the model answered, written or not | `orders.service.spec.ts` (refused replace), `orders-gateway.e2e-spec.ts` (two re-sends at once) |
| Merge: no `order.created` for an email stored as extraction_failed | `test/orders-gateway.e2e-spec.ts` only; the unit spec's fake order has no status, so it cannot see this |
| Web: no socket listener for `order.reextracted` | `web/src/live/connection.test.ts` |
| Web: order screen ignores `order.reextracted` for the open order | `web/src/order/OrderScreen.test.tsx` |

Note on the `referenceNumber` row: the output was cut to its first eight lines, all from
`order-form.test.ts`. Whether the approve test in `OrderScreen.test.tsx` failed as well was not
recorded. It compares the whole body, so it should have; that is a belief, not a result.

Two of these breaks were blunt: blocking Approve while a check is open, and always sending
`messageId`, each failed six or more tests. That shows the behaviour is covered, not that one
test pins it.

The first attempt at the three gateway checks proved nothing: the API tests were pointed at a
database that did not exist (a shell quoting mistake), so every test failed whatever the code
did. They were redone after the run was fixed. A teeth check only counts if the suite was green
immediately before the change.

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

## 5. Manual browser check (review console)

Done once by the agent in Chromium at 1024, 1280 and 1440 px, against the API on a separate
database (`intake_test_web`) seeded with orders in all five statuses. No model call was made.

| Checked | Result |
|---|---|
| Queue renders, sorts held first, filters by status with counts | As expected |
| Order screen: email left, fields right, reasons on top; live checks while editing | As expected |
| Approve through the UI | `PATCH` 200 after a 204 preflight; screen became read-only |
| A second window while the first approves | Row changed without a reload, one extra `GET /orders/:id` |
| API stopped, then started | Header went to Reconnecting with a stale warning, then Live; an order inserted meanwhile appeared after `GET /orders` and one `GET /orders/:id` |
| Paste form: empty form, and an email already stored (200) | Nothing sent; "already stored" shown |
| Laptop width (1024 px) | Two defects found and fixed: a wrapped status label, and a message squeezed under a narrow field |

A manual check is not a test: nothing re-runs it. It is here so the claim "it works in a
browser" has a date and a scope.

## 6. Not tested yet

- Any call to a real model. Nothing in this repo has been run against a live provider.
- `src/eval/run.ts` end to end (its scoring functions are tested, the runner is not).
- A real provider outage. The tests fake one with `providerError(503)` from `@nestjs/ai/testing`;
  a real timeout, a dropped connection and a revoked key have not been tried.
- Load, or more than two concurrent requests.
- Emails longer than the 20,000 character limit, HTML email, attachments.

Review console and gateway:
- A pasted email becoming a new order in a browser (201), and `order.created` reaching a second
  window. Both are covered by the API test with a fake model, not by a browser with a real one.
- The slow and failed provider states of the paste form against a real provider.
- Any automated browser test. Layout and colour are checked by eye only.
- Safari and Firefox. Screens narrower than 1000 px beyond "it stacks".
- A real socket inside a component test, and reconnection in any automated test. The reconnect
  path of the store is tested with a fake connection; the real one was watched once by hand.
- Two approvals of the same order at the same moment. The API checks the status and then
  updates in two steps, so both can succeed and both send `order.approved`.
- `PATCH /orders/:id/review` with a `windowStart` that is not a date. The web form cannot send
  one; the API accepts it and fails at the database with a 500.
- A long queue. The console makes one request per order on first load.
- More than one API process, and any sign-in.
- Accessibility beyond the roles and labels the tests query by. No screen reader was used.
