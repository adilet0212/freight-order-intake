import { ApiError } from '../api/client.js';
import type { Order, OrderRow } from '../api/types.js';
import {
  deferred,
  fakeApi,
  fakeApiWith,
  fakeLive,
  makeOrder,
  rowOf,
} from '../test/fakes.js';
import { HYDRATE_CONCURRENCY, mapLimit, OrderStore } from './order-store.js';

/** Lets every promise that is already settled run its callbacks. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function entryOf(store: OrderStore, id: string) {
  return store.getSnapshot().entries.find((entry) => entry.order.id === id);
}

function approved(order: Order): Order {
  return {
    ...order,
    status: 'approved',
    reviewedAt: '2026-11-16 15:00:00-05',
  };
}

describe('mapLimit', () => {
  it('runs every item and never more than the limit at once', async () => {
    let inFlight = 0;
    let most = 0;
    const done: number[] = [];
    await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async (item) => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await settle();
      inFlight -= 1;
      done.push(item);
    });
    expect(most).toBe(3);
    expect(done.sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('does nothing for an empty list', async () => {
    const task = vi.fn(() => Promise.resolve());
    await mapLimit([], 3, task);
    expect(task).not.toHaveBeenCalled();
  });
});

describe('OrderStore', () => {
  it('shows the rows as soon as the list answers, then fills in each order’s stops', async () => {
    const order = makeOrder();
    const api = fakeApi();
    const detail = deferred<Order>();
    api.listOrders.mockResolvedValue([rowOf(order)]);
    api.getOrder.mockReturnValue(detail.promise);
    const store = new OrderStore(api, fakeLive());

    expect(store.getSnapshot()).toEqual({
      phase: 'loading',
      error: null,
      refreshing: false,
      entries: [],
    });

    const loading = store.load();
    await settle();
    expect(store.getSnapshot().phase).toBe('ready');
    expect(store.getSnapshot().refreshing).toBe(true);
    expect(entryOf(store, order.id)).toEqual({
      order: rowOf(order),
      stops: null,
      stopsFailed: false,
      arrivedLive: false,
    });

    detail.resolve(order);
    await loading;
    expect(store.getSnapshot().refreshing).toBe(false);
    expect(entryOf(store, order.id)).toEqual({
      order: rowOf(order),
      stops: order.stops,
      stopsFailed: false,
      arrivedLive: false,
    });
    expect(api.listOrders).toHaveBeenCalledTimes(1);
    expect(api.getOrder).toHaveBeenCalledTimes(1);
    expect(api.getOrder).toHaveBeenCalledWith(order.id);
  });

  it(`asks for stops ${HYDRATE_CONCURRENCY} orders at a time, and for every order`, async () => {
    const orders = Array.from({ length: 15 }, () => makeOrder());
    const api = fakeApiWith(orders);
    let inFlight = 0;
    let most = 0;
    api.getOrder.mockImplementation(async (id) => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await settle();
      inFlight -= 1;
      return orders.find((order) => order.id === id)!;
    });
    const store = new OrderStore(api, fakeLive());

    await store.load();

    expect(HYDRATE_CONCURRENCY).toBe(6);
    expect(most).toBe(6);
    expect(api.getOrder).toHaveBeenCalledTimes(15);
    expect(
      store.getSnapshot().entries.every((entry) => entry.stops !== null),
    ).toBe(true);
  });

  it('reports why the first load failed, and recovers when a later load works', async () => {
    const order = makeOrder();
    const api = fakeApiWith([order]);
    api.listOrders.mockRejectedValueOnce(
      new ApiError(0, 'Could not reach the API at http://localhost:3000.'),
    );
    const store = new OrderStore(api, fakeLive());

    await store.load();
    expect(store.getSnapshot()).toEqual({
      phase: 'error',
      error: 'Could not reach the API at http://localhost:3000.',
      refreshing: false,
      entries: [],
    });

    await store.load();
    expect(store.getSnapshot().phase).toBe('ready');
    expect(store.getSnapshot().error).toBeNull();
    expect(store.getSnapshot().entries).toHaveLength(1);
  });

  it('keeps the list on screen when a later reload fails, and says the reload failed', async () => {
    const order = makeOrder();
    const api = fakeApiWith([order]);
    const store = new OrderStore(api, fakeLive());
    await store.load();

    api.listOrders.mockRejectedValueOnce(new ApiError(500, 'Server error'));
    await store.load();

    expect(store.getSnapshot().phase).toBe('ready');
    expect(store.getSnapshot().error).toBe('Server error');
    expect(store.getSnapshot().refreshing).toBe(false);
    expect(entryOf(store, order.id)?.stops).toEqual(order.stops);
  });

  it('marks an order whose stops could not be read, and tries again on the next load', async () => {
    const order = makeOrder();
    const api = fakeApiWith([order]);
    api.getOrder.mockRejectedValueOnce(new ApiError(500, 'Server error'));
    const store = new OrderStore(api, fakeLive());

    await store.load();
    expect(entryOf(store, order.id)).toMatchObject({
      stops: null,
      stopsFailed: true,
    });

    await store.load();
    expect(entryOf(store, order.id)).toMatchObject({
      stops: order.stops,
      stopsFailed: false,
    });
  });

  it('reads a newly created order when its event arrives, and marks it as arrived live', async () => {
    const existing = makeOrder();
    const orders = [existing];
    const api = fakeApiWith(orders);
    const live = fakeLive();
    const store = new OrderStore(api, live);
    store.start();
    await settle();

    const created = makeOrder({ status: 'needs_review' });
    orders.push(created);
    live.emit({
      type: 'order.created',
      id: created.id,
      status: 'needs_review',
    });
    await settle();

    expect(entryOf(store, created.id)).toEqual({
      order: rowOf(created),
      stops: created.stops,
      stopsFailed: false,
      arrivedLive: true,
    });
    // The order that was there from the first load is not marked.
    expect(entryOf(store, existing.id)?.arrivedLive).toBe(false);
    // One list request in total: an event reads one order, not the whole list.
    expect(api.listOrders).toHaveBeenCalledTimes(1);
  });

  it('re-reads an order when it is approved elsewhere', async () => {
    const held = makeOrder({
      status: 'needs_review',
      reviewReasons: ['No delivery stop'],
    });
    const orders = [held];
    const api = fakeApiWith(orders);
    const live = fakeLive();
    const store = new OrderStore(api, live);
    store.start();
    await settle();

    orders[0] = approved({ ...held, customerName: 'Maple Ridge Foods Ltd' });
    live.emit({ type: 'order.approved', id: held.id, status: 'approved' });
    await settle();

    expect(entryOf(store, held.id)?.order).toMatchObject({
      status: 'approved',
      customerName: 'Maple Ridge Foods Ltd',
      reviewedAt: '2026-11-16 15:00:00-05',
    });
    expect(entryOf(store, held.id)?.arrivedLive).toBe(false);
    expect(store.getSnapshot().entries).toHaveLength(1);
  });

  it('ignores an older answer that arrives after a newer one for the same order', async () => {
    const held = makeOrder({ status: 'needs_review' });
    const api = fakeApi();
    const first = deferred<Order>();
    const second = deferred<Order>();
    api.getOrder
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const store = new OrderStore(api, fakeLive());

    const older = store.refreshOrder(held.id);
    const newer = store.refreshOrder(held.id);
    second.resolve(approved(held));
    await newer;
    first.resolve(held);
    await older;

    expect(entryOf(store, held.id)?.order.status).toBe('approved');
  });

  it('does not lose an order that was created while the list was on its way', async () => {
    const api = fakeApi();
    const list = deferred<OrderRow[]>();
    api.listOrders.mockReturnValue(list.promise);
    const live = fakeLive();
    const store = new OrderStore(api, live);
    store.start();

    const created = makeOrder();
    api.getOrder.mockResolvedValue(created);
    live.emit({
      type: 'order.created',
      id: created.id,
      status: 'auto_accepted',
    });
    await settle();
    // The list was read before the order existed, so it does not contain it.
    list.resolve([]);
    await settle();

    expect(store.getSnapshot().phase).toBe('ready');
    expect(entryOf(store, created.id)?.stops).toEqual(created.stops);
  });

  it('prefers an order read after the list was requested over that list’s older row', async () => {
    const held = makeOrder({ status: 'needs_review' });
    const api = fakeApi();
    const list = deferred<OrderRow[]>();
    api.listOrders.mockReturnValue(list.promise);
    const live = fakeLive();
    const store = new OrderStore(api, live);
    store.start();

    api.getOrder.mockResolvedValue(approved(held));
    live.emit({ type: 'order.approved', id: held.id, status: 'approved' });
    await settle();
    // The list still shows the order as it was before the approval.
    list.resolve([rowOf(held)]);
    await settle();

    expect(entryOf(store, held.id)?.order.status).toBe('approved');
    expect(api.getOrder).toHaveBeenCalledTimes(1);
  });

  it('reloads after a reconnect, re-reading only orders that are new or have changed', async () => {
    const a = makeOrder({ status: 'needs_review' });
    const b = makeOrder();
    const c = makeOrder();
    const orders = [a, b, c];
    const api = fakeApiWith(orders);
    const live = fakeLive();
    const store = new OrderStore(api, live);
    store.start();
    await settle();
    expect(api.getOrder).toHaveBeenCalledTimes(3);

    // While disconnected: a was approved and d was created. Neither event was received.
    const d = makeOrder();
    orders[0] = approved(a);
    orders.push(d);
    api.getOrder.mockClear();
    live.reconnect();
    await settle();

    expect(api.listOrders).toHaveBeenCalledTimes(2);
    expect(api.getOrder.mock.calls.map(([id]) => id).sort()).toEqual(
      [a.id, d.id].sort(),
    );
    expect(entryOf(store, a.id)?.order.status).toBe('approved');
    expect(entryOf(store, d.id)?.stops).toEqual(d.stops);
    expect(entryOf(store, b.id)?.stops).toEqual(b.stops);
    expect(store.getSnapshot().entries).toHaveLength(4);
    // Found by reloading, not announced by an event.
    expect(entryOf(store, d.id)?.arrivedLive).toBe(false);
  });

  it('lets the newest of two overlapping loads decide the list', async () => {
    const stale = makeOrder();
    const fresh = makeOrder();
    const api = fakeApiWith([stale, fresh]);
    const slow = deferred<OrderRow[]>();
    api.listOrders
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce([rowOf(fresh)]);
    const store = new OrderStore(api, fakeLive());

    const firstLoad = store.load();
    await store.load();
    slow.resolve([rowOf(stale)]);
    await firstLoad;

    expect(store.getSnapshot().entries.map((entry) => entry.order.id)).toEqual([
      fresh.id,
    ]);
  });

  it('stores an order a screen hands it, and drops a request that was already in flight', async () => {
    const held = makeOrder({ status: 'needs_review' });
    const api = fakeApi();
    const inFlight = deferred<Order>();
    api.getOrder.mockReturnValue(inFlight.promise);
    const store = new OrderStore(api, fakeLive());
    const changed = vi.fn();
    store.subscribe(changed);

    const refreshing = store.refreshOrder(held.id);
    store.put(approved(held));
    expect(changed).toHaveBeenCalledTimes(1);
    inFlight.resolve(held);
    await refreshing;

    expect(entryOf(store, held.id)?.order.status).toBe('approved');
    expect(entryOf(store, held.id)?.stops).toEqual(held.stops);
  });

  it('forgets which orders arrived live once they have been seen', async () => {
    const created = makeOrder();
    const api = fakeApiWith([created]);
    const live = fakeLive();
    const store = new OrderStore(api, live);
    await store.refreshOrder(created.id, { live: true });
    expect(entryOf(store, created.id)?.arrivedLive).toBe(true);

    store.markSeen();
    expect(entryOf(store, created.id)?.arrivedLive).toBe(false);
  });

  it('stops reacting to events and reconnects once stopped', async () => {
    const api = fakeApiWith([]);
    const live = fakeLive();
    const store = new OrderStore(api, live);
    const stop = store.start();
    await settle();

    stop();
    live.emit({ type: 'order.created', id: 'x', status: 'auto_accepted' });
    live.reconnect();
    await settle();

    expect(api.getOrder).not.toHaveBeenCalled();
    expect(api.listOrders).toHaveBeenCalledTimes(1);
  });
});
