# Review console (web)

The screen a dispatcher uses to work the queue: a table of orders, one order next to the email
it came from, and a form to paste an email for the demo. It is a Vite + React + TypeScript app
that talks to the API in this repository. It has no backend of its own.

It shares the root `package.json` and lockfile. There is nothing to install inside `web/`.

## Run the API and the web app together

Needs Node 22.22.2 or newer (24 works; jsdom needs at least 22.22.2), npm 11 or newer, and
Postgres on port 5432. These steps use Postgres.app, not Docker.

**Once:**

1. Open Postgres.app and start the server. Check it answers:

   ```bash
   pg_isready -h localhost -p 5432
   ```

   If `pg_isready` and `psql` are not found, they are in
   `/Applications/Postgres.app/Contents/Versions/latest/bin`.

2. Create the two databases the project uses. Docker Compose would have made them from
   `docker/init.sql`; with Postgres.app you make them yourself:

   ```bash
   psql -h localhost -U postgres -c "CREATE DATABASE intake"
   ```

   ```bash
   psql -h localhost -U postgres -c "CREATE DATABASE intake_test"
   ```

3. Install, configure and migrate, from the repository root:

   ```bash
   npm ci
   ```

   ```bash
   cp .env.example .env
   ```

   Set `LLM_PROVIDER`, `LLM_MODEL` and the matching key in `.env`, then:

   ```bash
   npm run db:migrate
   ```

**Every time**, in two terminals, both from the repository root:

```bash
npm run start:dev
```

```bash
npm run web:dev
```

The API listens on http://localhost:3000 and the console on http://localhost:5173. Open the
console. The header shows **Live** when the socket to the API is connected.

## Try it

1. Open the console in two browser windows side by side.
2. In one, go to **Paste an email**, paste a shipment request and press **Extract order**. This
   makes one real model call and can take up to about 90 seconds if the provider is slow.
3. The new order appears in the queue in the other window without a refresh.
4. Open a held order. The reasons it was held are listed at the top in plain words. Correct the
   fields and press **Approve order**. Each reason is marked Fixed as the edit clears it; an
   open reason is a warning and does not block approval.
5. The other window shows the order as Approved without a refresh.

## Settings

| Variable | Where | Default | What it is |
|---|---|---|---|
| `WEB_ORIGIN` | API, in `.env` | `http://localhost:5173` | The browser origin the API allows, for HTTP and for the socket. Several origins are separated by commas. |
| `VITE_API_URL` | web, on the command line | `http://localhost:3000` | Where the console finds the API and the socket. |
| `PORT` | API | `3000` | The API's port. |

For example, with the API on port 3100:

```bash
PORT=3100 npm run start:dev
```

```bash
VITE_API_URL=http://localhost:3100 npm run web:dev
```

The web app never reads the repository's `.env`. Vite's root is `web/`, so the model key cannot
end up in the browser bundle. To keep `VITE_API_URL` set, put it in `web/.env.local`, which
Vite reads and `.gitignore` keeps out of git.

## When it does not work

- **`Port 5173 is already in use`.** The dev server refuses to move to another port on purpose:
  the API allows exactly one origin by default, and a console on 5174 would be blocked by CORS.
  Free the port, or run the console elsewhere and set `WEB_ORIGIN` to match.
- **The header says Reconnecting or Offline, and the queue shows an error.** The API is not
  running, or `VITE_API_URL` points at the wrong port. The console keeps retrying and reloads
  the queue by itself when the API is back.
- **Requests hang and the API log says Postgres.app could not verify "trust" authentication.**
  Postgres.app asks, once per app, whether that app may connect. Answer the dialog for your
  terminal. A process started detached from the terminal is refused without a dialog.
- **A pasted email comes back as Extraction failed, "The model could not be reached".** The
  provider failed or timed out after every retry. The email is stored (SPEC decision 4). Press
  **Extract order** again: re-sending the same email extracts it again, and the open queue and
  order screen update by themselves (`order.reextracted`).
- **A pasted email returns "The email was not stored".** The API failed for a reason other than
  the provider. Nothing was saved, so it is safe to send it again.

## Tests

```bash
npm test                      # 236 tests: 67 unit (API code) and 169 unit and component (web)
npm run test:e2e              # 34 API tests, needs Postgres, uses a fake model
npm run web:build             # production build of the console into web/dist
```

`npm test` needs no services. The web tests run in jsdom with a stand-in for `fetch` and for
the socket. Only the API tests use a real socket: `test/orders-gateway.e2e-spec.ts` starts the
app on a free port and connects a real Socket.IO client to it.

`npm run test:e2e` uses the `intake_test` database unless `DATABASE_URL` is set, and empties
its tables. `npm run typecheck` and `npm run lint` cover `web/` as well as `src/` and `test/`.

For the root README: the unit count there (41) is now 236 with the web tests, and the API count
(14) is now 34.

## How it is put together

| Folder | What |
|---|---|
| `src/api` | The `fetch` wrapper and the order types. |
| `src/live` | The socket. The only file that imports `socket.io-client`. |
| `src/orders` | The order store: loads the list, fills in each row, applies live events. |
| `src/queue` | The queue screen, its sort order and its status filter. |
| `src/order` | The order screen: email, form, hold reasons, approve. |
| `src/paste` | The paste-an-email form. |
| `src/shared.ts` | The only file that imports from the API's source. |

Three things worth knowing before changing it:

- **Events are hints, the API is the truth.** A socket event carries an order's id and status
  and nothing else. The console then reads that order from `GET /orders/:id`. A late or
  repeated event cannot leave wrong data on screen.
- **The queue makes one request per order.** `GET /orders` has no stops, so the lane and the
  pickup date come from `GET /orders/:id`, six at a time. That was chosen to avoid a backend
  change. It will not hold up for a long queue.
- **The rules are not copied.** The live checks on the order screen run the API's own
  `reviewGate` and Zod schema, imported through `src/shared.ts`. A new gate rule needs wording
  in `src/order/hold-reasons.ts`; a test fails until it has it.

## Limits

- No sign-in. Anyone who can reach the API's port can read orders and receive events.
- One API process. A second one would need a shared socket adapter.
- Checked in Chromium only, at 1024, 1280 and 1440 px wide. At 1000 px and below the order
  screen stacks into one column; it is not designed for phones.
