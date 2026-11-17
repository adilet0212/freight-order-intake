import type { Api } from '../api/client.js';
import { ApiError } from '../api/client.js';
import type { Order, OrderRow, Stop } from '../api/types.js';
import type { LiveConnection } from '../live/connection.js';

/**
 * How many GET /orders/:id requests run at once while the queue fills in its stops.
 * Six is the number of connections a browser opens to one host over HTTP/1.1, so asking
 * for more would only queue them inside the browser.
 */
export const HYDRATE_CONCURRENCY = 6;

export interface QueueEntry {
  order: OrderRow;
  /** null until GET /orders/:id has answered: the list does not include stops. */
  stops: Stop[] | null;
  /** The request for this order's stops failed. It is tried again on the next reload. */
  stopsFailed: boolean;
  /** The order appeared through a live event, not through the first load. */
  arrivedLive: boolean;
}

export interface StoreSnapshot {
  /** loading: nothing to show yet. error: the first load failed. ready: there is a list. */
  phase: 'loading' | 'ready' | 'error';
  /** Why the first load failed, or why the most recent reload did. */
  error: string | null;
  refreshing: boolean;
  entries: QueueEntry[];
}

interface StoredEntry extends QueueEntry {
  /**
   * The store's clock value when the request that produced this entry was started.
   * Compared with the moment a list was requested, it says which of the two is newer.
   */
  detailAt: number;
}

/** Runs `task` over `items` with no more than `limit` in flight at any moment. */
export async function mapLimit<T>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await task(item);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
}

function errorMessage(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : 'Something went wrong while loading orders.';
}

/**
 * Whether a list row still matches the order this store has its stops for.
 *
 * An order's stops change in two ways. Approval changes the status and sets reviewedAt.
 * A re-send that re-extracts a failed order (order.reextracted) leaves reviewedAt alone,
 * but either changes the status or leaves the order extraction_failed, which is stored
 * with no stops before and after. So these two fields are enough. A new way of changing
 * an order's stops would need its own marker here, such as an updated_at column.
 */
function sameVersion(a: OrderRow, b: OrderRow): boolean {
  return a.status === b.status && a.reviewedAt === b.reviewedAt;
}

/**
 * The orders the web app knows about, kept current.
 *
 * The API is the source of truth and live events are only hints: an event names an order,
 * and the store then reads that order through GET /orders/:id. So a late or repeated
 * event can never put stale data on screen.
 *
 * GET /orders returns rows without stops, so each row's stops are fetched separately
 * (1 + N requests on the first load). That is the cost of leaving the API unchanged.
 */
export class OrderStore {
  private readonly entries = new Map<string, StoredEntry>();
  private readonly listeners = new Set<() => void>();
  /** The clock value of the newest request started per order, to drop older answers. */
  private readonly latestRequest = new Map<string, number>();
  private clock = 0;
  private loadGeneration = 0;
  private snapshot: StoreSnapshot = {
    phase: 'loading',
    error: null,
    refreshing: false,
    entries: [],
  };

  constructor(
    private readonly api: Api,
    private readonly live: LiveConnection,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): StoreSnapshot => this.snapshot;

  /**
   * Listens for events first and loads the list second, so an order created while the
   * list is on its way is not missed. Returns a function that stops listening.
   */
  start(): () => void {
    const stopEvents = this.live.onOrderEvent((event) => {
      void this.refreshOrder(event.id, { live: true });
    });
    const stopReconnect = this.live.onReconnect(() => {
      void this.load();
    });
    void this.load();
    return () => {
      stopEvents();
      stopReconnect();
    };
  }

  /** Loads the whole list, then fetches the stops of every order that needs them. */
  async load(): Promise<void> {
    this.loadGeneration += 1;
    const generation = this.loadGeneration;
    const startedAt = this.clock;
    this.publish({ refreshing: true });

    let rows: OrderRow[];
    try {
      rows = await this.api.listOrders();
    } catch (error) {
      if (generation !== this.loadGeneration) return;
      this.publish({
        // Keep showing what is already there; only an empty screen becomes an error.
        phase: this.snapshot.phase === 'ready' ? 'ready' : 'error',
        error: errorMessage(error),
        refreshing: false,
      });
      return;
    }
    // A newer load started while this one was waiting: let that one win.
    if (generation !== this.loadGeneration) return;

    const next = new Map<string, StoredEntry>();
    for (const row of rows) {
      const known = this.entries.get(row.id);
      if (known && known.detailAt > startedAt) {
        // Requested through GET /orders/:id after this list was, so it is the newer one.
        next.set(row.id, known);
      } else if (known?.stops && sameVersion(known.order, row)) {
        next.set(row.id, { ...known, order: { ...known.order, ...row } });
      } else {
        next.set(row.id, {
          order: row,
          stops: null,
          stopsFailed: false,
          arrivedLive: known?.arrivedLive ?? false,
          detailAt: 0,
        });
      }
    }
    // An order created after the list was requested is not in `rows`. Keep it.
    for (const [id, known] of this.entries) {
      if (!next.has(id) && known.detailAt > startedAt) next.set(id, known);
    }
    this.entries.clear();
    for (const [id, entry] of next) this.entries.set(id, entry);
    this.publish({ phase: 'ready', error: null });

    const needStops = [...this.entries.values()]
      .filter((entry) => entry.stops === null)
      .map((entry) => entry.order.id);
    await mapLimit(needStops, HYDRATE_CONCURRENCY, (id) =>
      this.refreshOrder(id),
    );
    if (generation === this.loadGeneration) this.publish({ refreshing: false });
  }

  /** Reads one order from the API and stores it. Never throws. */
  async refreshOrder(id: string, options?: { live: boolean }): Promise<void> {
    this.clock += 1;
    const requestedAt = this.clock;
    this.latestRequest.set(id, requestedAt);

    let order: Order;
    try {
      order = await this.api.getOrder(id);
    } catch {
      if (this.latestRequest.get(id) !== requestedAt) return;
      const known = this.entries.get(id);
      if (known && known.stops === null) {
        this.entries.set(id, { ...known, stopsFailed: true });
        this.publish({});
      }
      return;
    }
    // A newer request for the same order has started; its answer is the one to keep.
    if (this.latestRequest.get(id) !== requestedAt) return;
    const known = this.entries.get(id);
    this.store(
      order,
      known ? known.arrivedLive : options?.live === true,
      requestedAt,
    );
  }

  /** Stores an order a screen already has, such as the answer to an approve. */
  put(order: Order): void {
    // Outdates any request for this order that is still in flight.
    this.clock += 1;
    this.latestRequest.set(order.id, this.clock);
    this.store(
      order,
      this.entries.get(order.id)?.arrivedLive ?? false,
      this.clock,
    );
  }

  /** Forgets which orders arrived live, once the queue has shown them. */
  markSeen(): void {
    let changed = false;
    for (const [id, entry] of this.entries) {
      if (entry.arrivedLive) {
        this.entries.set(id, { ...entry, arrivedLive: false });
        changed = true;
      }
    }
    if (changed) this.publish({});
  }

  private store(order: Order, arrivedLive: boolean, detailAt: number): void {
    const { stops, commodities: _commodities, ...row } = order;
    this.entries.set(order.id, {
      order: row,
      stops,
      stopsFailed: false,
      arrivedLive,
      detailAt,
    });
    this.publish({});
  }

  private publish(change: Partial<Omit<StoreSnapshot, 'entries'>>): void {
    this.snapshot = {
      ...this.snapshot,
      ...change,
      entries: [...this.entries.values()].map(
        ({ detailAt: _detailAt, ...entry }) => entry,
      ),
    };
    for (const listener of this.listeners) listener();
  }
}
