# Frontend branch walkthrough

A 15-minute study guide to the `frontend` branch: the live-update gateway and the review
console in `web/`. Part 1 is every file, one or two lines each. Part 2 is the eight questions an
interviewer is most likely to ask, with short, honest answers.

## The whole thing in five lines

1. An email comes in through `POST /emails`. The API extracts, checks and stores an order, as before.
2. After the database write, `OrdersService` tells `OrdersGateway`, which sends a Socket.IO event
   carrying only `{ id, status }`.
3. The browser's `OrderStore` hears the event and re-reads that one order from `GET /orders/:id`.
   Events are hints; REST is the truth.
4. The queue and the order screen render from the store. A reviewer corrects a held order and
   approves it with `PATCH /orders/:id/review`, which sends `order.approved` to every window.
5. The web app imports the API's own schema and review rules (`web/src/shared.ts`), so the two
   sides cannot disagree about what is valid.

## Part 1: every file

### Gateway and its wiring (backend)

| File | What it does, and why |
|---|---|
| `src/orders/order-events.ts` | Event names (`order.created`, `order.reextracted`, `order.approved`) and payload types. No framework imports, so the gateway, the API tests and the browser all import the same definitions. |
| `src/orders/orders.gateway.ts` | The Socket.IO gateway. Send only: no message handlers, so clients cannot push anything in. A failed send is logged and swallowed, because the order is already stored. |
| `src/orders/orders.service.ts` | Calls the gateway after the write: `order.created` for a new row (any status, including `extraction_failed` after an outage), `order.reextracted` only when `replaceFailed` really replaced a failed order, `order.approved` after an approval. |
| `src/orders/orders.module.ts` | Lists the gateway as a provider. Nest creates no gateway that no module lists. |
| `src/web-origin.ts` | Reads `WEB_ORIGIN` (default `http://localhost:5173`, comma-separated list allowed). One source for HTTP CORS and socket CORS. |
| `src/configure-app.ts` | Validation pipe plus `enableCors`. Shared by `main.ts` and the API tests, so the tests run the real wiring. |
| `src/orders/orders.gateway.spec.ts` | Unit: right event and payload, no email text on the socket, no throw without a server, a failing server is logged. |
| `src/orders/orders.service.spec.ts` | Main's outage tests, plus a block proving which event `ingest` sends in each case, and that it sends none when nothing was written. |
| `test/orders-gateway.e2e-spec.ts` | Real app on a free port, real Postgres, fake model, real `socket.io-client`. "Nothing was sent" is proved by the exact sequence received before a later sentinel event, not by waiting. |
| `test/cors.e2e-spec.ts` | Preflight for `PATCH` from the web origin is allowed; any other origin gets no allow header. |

### `web/src`, top level

| File | What it does, and why |
|---|---|
| `main.tsx` | Creates the three services (API client, socket, store), starts the store, renders `App` inside `ServicesContext`. The only place real network objects are built. |
| `App.tsx` | Header, navigation, connection indicator, and a switch from route to screen. `OrderScreen` gets `key={id}` so a different order is a fresh screen with no leftover state. |
| `App.test.tsx` | Shell: product name, navigation, `aria-current`, connection label, each route opens its screen, unknown route says "Page not found". |
| `route.ts` | Hash routes (`#/`, `#/?status=…`, `#/orders/:id`, `#/paste`) in about 50 lines. No router dependency for three screens; any static host serves hash routes. |
| `route.test.ts` | Parsing of each route, unknown paths and a broken escape, and that built links parse back. |
| `services.tsx` | The context that hands screens the API, socket and store, plus `useOrders` and `useConnectionState` (built on `useSyncExternalStore`). Context, not imports, so tests can pass stand-ins. |
| `shared.ts` | The only file that reaches into `../../src`. Re-exports the Zod schemas, `reviewGate`, `parseLocalDateTime` and the event names. Rule: nothing that imports Nest, Drizzle or Node. |
| `brand.ts` | `PRODUCT_NAME = 'Freight Order Intake'`, in one place. |
| `format.ts` | Dates. Stop windows are wall-clock text formatted without `Date`, so they never shift by the reader's zone. Postgres timestamps like `2026-11-16 14:05:00-05` are rewritten to ISO before parsing. `localInputToIso` adds the local offset for the paste form. |
| `format.test.ts` | Each of those, including the Postgres forms read from the real API and an offset other than the machine's. |
| `ConnectionIndicator.tsx` | Live / Connecting / Reconnecting / Offline in the header, and `useUpdatesPaused` for the stale-list warning. |
| `styles.css` | All styling. Design tokens at the top: one teal accent, a fixed colour per status, light theme. Plain CSS, no framework. |

### `web/src/api`

| File | What it does, and why |
|---|---|
| `client.ts` | `fetch` wrapper: `listOrders`, `getOrder`, `approveOrder`, `ingestEmail` (returns `created` from 201 vs 200). Turns Nest's error bodies (a string, or a list for 400) into one `ApiError` with the status; status 0 means no answer. |
| `client.test.ts` | URLs, methods, bodies, and the error shapes the real API returns. |
| `types.ts` | `OrderRow` (list item, no stops) and `Order` (full). Built on the API's `NormalizedOrder` type. |

### `web/src/live`

| File | What it does, and why |
|---|---|
| `connection.ts` | The only file that imports `socket.io-client`. Tracks the four connection states, checks every payload before acting on it (`parseOrderEvent`), tells listeners on reconnect so they can reload. Reconnection is Socket.IO's default backoff. |
| `connection.test.ts` | State changes, the server-closed reconnect case, valid events pass and invalid ones are dropped, including `order.reextracted`. |

### `web/src/orders`

| File | What it does, and why |
|---|---|
| `order-store.ts` | The client's one copy of the orders. Subscribes to events before loading the list so nothing falls in the gap. Loads `GET /orders`, then each order's stops six at a time. A per-order request clock drops a late answer that would overwrite a newer one. On reconnect it reloads the list and re-reads only orders whose status or `reviewedAt` changed. |
| `order-store.test.ts` | 17 tests: ordering of answers, an order created during the load, hydration limit, reconnect resync, failures that keep what is on screen. |
| `lane.ts` | First pickup to last delivery, "Brampton, ON → Chicago, IL", and the pickup date. Same definition as the review gate's date rule. |
| `lane.test.ts` | No pickup, no delivery, several of each, missing city or region. |

### `web/src/queue`

| File | What it does, and why |
|---|---|
| `QueueScreen.tsx` | The table: status chip, customer (or subject), lane, pickup date, received time, held reasons. Status filter with counts, in the URL. Loading, empty, error and stale states. Orders that arrive while the screen is open are marked "New". |
| `QueueScreen.test.tsx` | States, columns, sort, filter, and live events adding or updating a row without a reload, including a re-extracted failed order. |
| `queue-order.ts` | Pure rules: `isHeld` (exactly the two statuses the API will review), labels, filter order, sort (held first, oldest held on top; then finished, newest first; ties broken by id). |
| `queue-order.test.ts` | The sort and filter rules, including two time zones and exact ties. |
| `StatusChip.tsx` | A status as words with its colour. Colour never carries meaning alone. |

### `web/src/order`

| File | What it does, and why |
|---|---|
| `OrderScreen.tsx` | Loads one order; email on the left, form on the right, reasons on top. Approve sends the corrected order and handles 200, 409 (someone was first), 400 (shows the API's reason) and no answer. Reacts to events for this order: approved elsewhere → read-only; re-extracted → reload and say edits were dropped. |
| `OrderScreen.test.tsx` | 18 tests. The approve flow sends exactly one `PATCH` with the exact body; every failure path; a held order's warnings never block; events from other windows. |
| `OrderForm.tsx` | The editable fields, disabled through one `<fieldset disabled>` when the order is not held. Add and remove stops and freight lines. Freight-line messages sit on a full line under the row so narrow fields stay readable. |
| `order-form.ts` | Pure mapping between the order and the form's text values. Empty becomes null, region and postal code upper-cased (as `normalize.ts` does), numbers parsed with limits taken from the database column types, then the API's own Zod schema. |
| `order-form.test.ts` | Round trip, trimming, number boundaries (`0`, `-3`, `2.5`, `1e3`, `12 skids`), date checks. |
| `hold-reasons.ts` | Stored reason strings in plain words, plus state: open (a rule still fires on the edited order), fixed (it no longer does), check (only the email can settle it, like a model ambiguity or a provider failure). Uses the real `reviewGate` on every edit. |
| `hold-reasons.test.ts` | Feeds every reason `reviewGate` and `normalize.ts` can write through the explainer, so a new rule without wording fails a test. |
| `HoldReasons.tsx` | Renders those items, a summary line, and technical detail tucked away. `StatusNote` gives non-held orders one line on how they got their status. |
| `HoldReasons.test.tsx` | Wording, states, the failed-extraction case, unknown reasons shown as stored. |
| `EmailPane.tsx` | The email as received: subject, received time, body in a preformatted block. |

### `web/src/paste`

| File | What it does, and why |
|---|---|
| `PasteEmailScreen.tsx` | Demo form for `POST /emails`. Validates with the API's own `inboundEmailSchema` first, sends the received time with the local offset, sends Message-ID only when filled. Shows sending, created, already stored (neutral style), stored-but-not-extracted with how to retry, and failures. Puts the new order in the store at once. |
| `PasteEmailScreen.test.tsx` | Exact request body, the 20,000-character limit and one over, double-send prevention, 201, 200, outage then retry, 400, 500, no answer. |

### `web/src/ui` and `web/src/test`

| File | What it does, and why |
|---|---|
| `ui/states.tsx` | `LoadingBlock`, `EmptyBlock`, `ErrorBlock` (with optional retry). Every screen uses the same three. |
| `test/setup.ts` | Loads jest-dom matchers and unmounts after each test. |
| `test/fakes.ts` | `makeOrder`, `fakeApi`, `fakeApiWith` (serves orders like the real API), `fakeLive` (a socket a test drives by hand), `deferred` (hold a request in flight). |
| `test/render.tsx` | `renderWithServices`: renders a screen the way `main.tsx` does, with a real, started store and stand-in network. |

## Part 2: the eight likely questions

**1. Why WebSockets, and why does an event carry only an id and a status?**
The queue has to change when another window or the email pipeline changes an order; polling
would lag or waste requests. Socket.IO was chosen over plain `ws` for its built-in reconnection.
The payload is small on purpose: the client re-reads the order over HTTP, so a late, repeated or
out-of-order event cannot leave wrong data on screen, and no email text crosses the socket. Cost:
one extra request per event.
→ `src/orders/order-events.ts`, `web/src/orders/order-store.ts`

**2. What happens when a browser misses events?**
Socket.IO does not replay them. On every reconnect the store reloads `GET /orders` and re-reads
the orders that are new or whose status or `reviewedAt` changed. I watched this once by hand
(stopped the API, inserted an order, restarted). The reconnect path is unit-tested with a fake
connection, not with a real socket. One stale comment to own: `sameVersion` says content only
changes on review. Re-extraction now changes it too. The check still holds, because a re-extracted
order either changes status or stays failed with no stops.
→ `web/src/live/connection.ts`, `web/src/orders/order-store.ts`

**3. The queue makes one request per order. Does that scale?**
No. `GET /orders` has no stops, so the lane and pickup date need `GET /orders/:id` per row, six
at a time. That came from a decision not to change the backend for the console. With a few
hundred orders it is slow. The fix is a list endpoint that returns the lane and pickup date, plus
paging; `GET /orders` today also returns every email body.
→ `web/src/orders/order-store.ts` (`HYDRATE_CONCURRENCY`)

**4. How do you stop the frontend and backend rules from drifting apart?**
They are not copied. `web/src/shared.ts` imports the API's Zod schema, `reviewGate` and the
event names, so the form validates with the API's schema and the live checks are the gate's own
rules. A test sends every reason the backend can write through the plain-words explainer, so a
new rule without wording fails. Cost: a change in those API files can break the web build, and
they must stay free of Node and Nest imports.
→ `web/src/shared.ts`, `web/src/order/hold-reasons.test.ts`

**5. How did you test it, and how do you know the tests mean something?**
Four levels. Pure functions with unit tests. Screens in jsdom with Testing Library, using a fake
socket and a stand-in `fetch`, so tests assert on the exact request a browser would send. The
gateway in an API test with a real socket against real Postgres and a fake model. And a manual
browser check, because jsdom does no layout. That check found three layout bugs no test could
see. For teeth, I broke the code on purpose more than twenty times (dropped an event, flipped the
sort, dropped a field from the approve body, emitted when nothing was written), and each time a
test failed. 236 unit and component tests, 34 API tests.
→ `docs/TEST_PLAN.md` sections 1, 2 and 5

**6. What about two people, or two processes, touching the same order?**
Partly handled. Two re-sends of a failed email: the database decides, because the status check
is inside the `UPDATE`, and only the winner sends `order.reextracted`. An open order screen
reacts when its order is approved elsewhere (read-only) or re-extracted (reloads). Not handled:
two approvals at the same moment. The API checks the status and then updates in two steps, so
both succeed and both send `order.approved`. I found it and left it, as told. The fix belongs in
the database: a conditional `UPDATE`, like `replaceFailed`.
→ `src/orders/orders.repository.ts`, `src/orders/orders.service.ts`, `web/src/order/OrderScreen.tsx`

**7. How do you handle dates and time zones?**
Two kinds of time. Stop windows are wall-clock times at the dock with no zone. They stay text,
are formatted by hand and never go through `Date`, which would shift them. Received times are
real instants. Postgres prints them as `2026-11-16 14:05:00-05`, which browsers disagree on, so
they are rewritten to ISO before parsing. The paste form sends the received time with the local
offset, not UTC, so "tomorrow" in an evening email resolves to the right day.
→ `web/src/format.ts`

**8. What is not verified, and what would you do next?**
No real model call was made from the browser; Adilet does that check. No automated browser
tests: layout was checked by eye in Chromium only, at 1024, 1280 and 1440 px. No sign-in:
anyone who can reach the port can read orders and receive events, and CORS is not
authentication. One API process only; more would need a shared socket adapter. Next, in order:
fix the approve race in the database, add a list endpoint with paging, add sign-in before
anything leaves a laptop, then one Playwright test for paste, approve and the live update.
→ `docs/agent-session-2.md` ("What was NOT verified"), `docs/TEST_PLAN.md` section 6
