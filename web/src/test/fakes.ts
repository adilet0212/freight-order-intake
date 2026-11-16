import type { Api } from '../api/client.js';
import type { Order, OrderRow } from '../api/types.js';
import type {
  ConnectionState,
  LiveConnection,
  OrderEvent,
} from '../live/connection.js';

let nextId = 1;

/** A complete, clean order. Override any field. */
export function makeOrder(overrides: Partial<Order> = {}): Order {
  const number = nextId;
  nextId += 1;
  return {
    id: `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`,
    status: 'auto_accepted',
    reviewReasons: [],
    messageId: `<message-${number}@example.test>`,
    emailSubject: 'Load tender PO-48213',
    emailBody:
      'Please pick up 18 skids in Brampton on Nov 17 and deliver to Chicago on Nov 18.',
    emailReceivedAt: '2026-11-16 14:05:00-05',
    customerName: 'Maple Ridge Foods',
    referenceNumber: 'PO-48213',
    equipmentType: 'dry_van',
    rateAmount: 1850,
    rateCurrency: 'USD',
    specialInstructions: null,
    createdAt: '2026-11-16 14:05:02.120000-05',
    reviewedAt: null,
    stops: [
      {
        type: 'pickup',
        companyName: 'Maple Ridge Foods',
        street: '120 Industrial Rd',
        city: 'Brampton',
        region: 'ON',
        postalCode: 'L6T 4X3',
        windowStart: '2026-11-17T08:00',
        windowEnd: '2026-11-17T12:00',
      },
      {
        type: 'delivery',
        companyName: 'Lakeshore Grocers DC',
        street: '4500 W 47th St',
        city: 'Chicago',
        region: 'IL',
        postalCode: '60632',
        windowStart: '2026-11-18T09:00',
        windowEnd: null,
      },
    ],
    commodities: [
      {
        description: 'Canned goods',
        quantity: 18,
        commodityType: 'skid',
        weightLbs: 21600,
      },
    ],
    ...overrides,
  };
}

/** What GET /orders returns for an order: the same fields without the two lists. */
export function rowOf(order: Order): OrderRow {
  const { stops: _stops, commodities: _commodities, ...row } = order;
  return row;
}

/** An Api whose every method is a mock that fails until a test gives it an answer. */
export function fakeApi() {
  const unexpected = (name: string) => () =>
    Promise.reject(new Error(`unexpected call to api.${name}`));
  return {
    listOrders: vi.fn<Api['listOrders']>(unexpected('listOrders')),
    getOrder: vi.fn<Api['getOrder']>(unexpected('getOrder')),
    approveOrder: vi.fn<Api['approveOrder']>(unexpected('approveOrder')),
    ingestEmail: vi.fn<Api['ingestEmail']>(unexpected('ingestEmail')),
  } satisfies Api;
}

/** An Api that serves the given orders the way the real one would. */
export function fakeApiWith(orders: Order[]) {
  const api = fakeApi();
  api.listOrders.mockImplementation(() => Promise.resolve(orders.map(rowOf)));
  api.getOrder.mockImplementation((id) => {
    const order = orders.find((candidate) => candidate.id === id);
    return order
      ? Promise.resolve(order)
      : Promise.reject(new Error(`no order ${id}`));
  });
  return api;
}

/** A LiveConnection a test drives by hand. */
export function fakeLive(initial: ConnectionState = 'live') {
  let state = initial;
  const stateListeners = new Set<() => void>();
  const eventListeners = new Set<(event: OrderEvent) => void>();
  const reconnectListeners = new Set<() => void>();
  const add = <T>(set: Set<T>, listener: T) => {
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  };
  return {
    getState: () => state,
    subscribeState: (listener: () => void) => add(stateListeners, listener),
    onOrderEvent: (listener: (event: OrderEvent) => void) =>
      add(eventListeners, listener),
    onReconnect: (listener: () => void) => add(reconnectListeners, listener),
    close: vi.fn(),
    /** Test controls. */
    setState(next: ConnectionState) {
      state = next;
      for (const listener of stateListeners) listener();
    },
    emit(event: OrderEvent) {
      for (const listener of eventListeners) listener(event);
    },
    reconnect() {
      for (const listener of reconnectListeners) listener();
    },
  } satisfies LiveConnection & Record<string, unknown>;
}

/** A promise a test settles when it chooses, to hold a request "in flight". */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
