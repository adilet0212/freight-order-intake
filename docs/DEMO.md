# Two-minute demo

A terminal and an editor, nothing else. Three emails from `demo/emails/`, sent to the running API
with the real model. The demo emails are not eval cases and are not labelled.

| File | Meant to end as | Why |
|---|---|---|
| `01-clean-order.json` | `auto_accepted` | Both stops with city, province or state and dates; delivery after pickup; 22 skids, 38,500 lbs; nothing unclear |
| `02-held-order.json` | `needs_review` | No pickup date ("to be confirmed"), and 21,000 kg is 46,297 lbs, over the 45,000 lb limit. No rate, which on its own is not a reason |
| `03-not-an-order.json` | `not_an_order` | A remittance advice for two paid invoices |

The expected gate results above were checked by running hand-written extractions of emails 01
and 02 through `normalizeOrder` and `reviewGate`. What the real model returns for them has not
been checked: that is the rehearsal below. Email 02 may also show one or more
"Model flagged: ..." reasons; that is fine.

## Before recording

Use a database of its own so the demo starts empty and can be reset without touching `intake`.
The model key comes from `.env` as usual.

```bash
createdb -h localhost -U postgres intake_demo
```

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/intake_demo npm run db:migrate
```

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/intake_demo npm run start:dev
```

In a second terminal, from the repository root, define a helper (zsh or bash):

```bash
send() { curl -s -w '\nHTTP %{http_code}' -X POST localhost:3000/emails -H 'content-type: application/json' -d @"$1" | node demo/show.mjs; }
```

Rehearse once: send all three emails and check each ends as the table says. If email 01 is held,
read the reason. It is a real result, so either record it and say so, or find out why before
recording. Do not reword the email until the model accepts it without writing that down.

Reset between takes (deletes every order in `intake_demo` only):

```bash
psql -h localhost -U postgres -d intake_demo -c 'TRUNCATE orders CASCADE'
```

Window setup: editor on the left with `README.md` open at the pipeline, terminal on the right,
font large enough to read at 1080p. Clear the terminal before each take.

## Shot list

| Time | On screen | Command or action |
|---|---|---|
| 0:00–0:15 | `README.md`, top: summary and the line about the agent | none |
| 0:15–0:30 | `README.md`, pipeline diagram, then `src/orders/review-gate.ts` scrolled to `MAX_PAYLOAD_LBS` | none |
| 0:30–0:50 | Terminal: email 01 sent, answer shows `HTTP 201`, `auto_accepted`, two stops, 38500 lbs | `send demo/emails/01-clean-order.json` |
| 0:50–1:00 | Same email again: `HTTP 200`, same id, no second model call | `send demo/emails/01-clean-order.json` |
| 1:00–1:25 | Email 02: `needs_review`, reasons "Pickup date missing" and "Total weight 46297 lbs is over one truckload" | `send demo/emails/02-held-order.json` |
| 1:25–1:35 | Email 03: `not_an_order` | `send demo/emails/03-not-an-order.json` |
| 1:35–1:45 | The review queue: one held order | `curl -s 'localhost:3000/orders?status=needs_review' \| node demo/show.mjs` |
| 1:45–2:00 | `README.md` at the headline metric and results, then `AGENT_LOG.md` | none |

The queue command written out, for copying (the table escapes the pipe):

```bash
curl -s 'localhost:3000/orders?status=needs_review' | node demo/show.mjs
```

## Draft narration

To be rewritten in your own words. About 280 words, which is roughly two minutes spoken.

> 0:00. This takes a shipment-request email and turns it into a truckload order. The hard part
> is not reading the email; it is knowing which orders are safe to accept without a person
> looking. Most of the code was written by Claude Code. The agent log has how I planned it,
> checked it, and what I changed.
>
> 0:15. The model only reads. Converting kilograms, checking dates, and deciding accept or
> hold are plain functions with unit tests. The 45,000 pound limit, for example, is one line
> of code with a comment saying why that number.
>
> 0:30. A clean tender from Hamilton to Detroit. 201, auto-accepted: both stops, both
> windows, 38,500 pounds. Nobody needs to look at this one.
>
> 0:50. The same email again. 200 and the same id. A unique index in Postgres decides that,
> so two copies arriving at once still make one order, and the second send costs no model
> call.
>
> 1:00. This one is held. The pickup date isn't known yet, and 21,000 kilograms is about
> 46,300 pounds, which is more than one truck. The model returned the kilograms as written;
> the code did the conversion and fired the rule. The reasons are in words a dispatcher can
> act on.
>
> 1:25. A remittance advice. Not an order, so no order is filled in, but the email is kept.
>
> 1:35. That leaves one order in the review queue.
>
> 1:45. The number I track is silent failures: orders that are wrong and still
> auto-accepted. A held mistake costs a minute; an accepted one sends a truck to the wrong
> place. Here is where that number stands, and the log of what the agent got wrong along the
> way.
