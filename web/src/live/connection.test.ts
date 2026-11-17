import {
  createLiveConnection,
  parseOrderEvent,
  type OrderEvent,
  type SocketLike,
} from './connection.js';

const ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

/** Stands in for the Socket.IO client: records handlers and lets a test fire them. */
function fakeSocket() {
  const handlers = new Map<string, Array<(...args: unknown[]) => void>>();
  return {
    on(event: string, listener: (...args: unknown[]) => void) {
      handlers.set(event, [...(handlers.get(event) ?? []), listener]);
    },
    connect: vi.fn(),
    close: vi.fn(),
    fire(event: string, ...args: unknown[]) {
      for (const listener of handlers.get(event) ?? []) listener(...args);
    },
  } satisfies SocketLike & Record<string, unknown>;
}

describe('parseOrderEvent', () => {
  it('accepts order.created with any order status', () => {
    expect(
      parseOrderEvent('order.created', { id: ID, status: 'needs_review' }),
    ).toEqual({ type: 'order.created', id: ID, status: 'needs_review' });
    expect(
      parseOrderEvent('order.created', { id: ID, status: 'extraction_failed' }),
    ).toEqual({ type: 'order.created', id: ID, status: 'extraction_failed' });
  });

  it('accepts order.approved only with the approved status', () => {
    expect(
      parseOrderEvent('order.approved', { id: ID, status: 'approved' }),
    ).toEqual({ type: 'order.approved', id: ID, status: 'approved' });
    expect(
      parseOrderEvent('order.approved', { id: ID, status: 'needs_review' }),
    ).toBeNull();
  });

  it('accepts order.reextracted with any order status', () => {
    expect(
      parseOrderEvent('order.reextracted', { id: ID, status: 'auto_accepted' }),
    ).toEqual({ type: 'order.reextracted', id: ID, status: 'auto_accepted' });
    expect(
      parseOrderEvent('order.reextracted', { id: ID, status: 'shipped' }),
    ).toBeNull();
  });

  it('drops anything of the wrong shape', () => {
    expect(parseOrderEvent('order.created', null)).toBeNull();
    expect(parseOrderEvent('order.created', 'text')).toBeNull();
    expect(parseOrderEvent('order.created', { status: 'approved' })).toBeNull();
    expect(
      parseOrderEvent('order.created', { id: '', status: 'approved' }),
    ).toBeNull();
    expect(
      parseOrderEvent('order.created', { id: 7, status: 'approved' }),
    ).toBeNull();
    expect(
      parseOrderEvent('order.created', { id: ID, status: 'shipped' }),
    ).toBeNull();
    expect(
      parseOrderEvent('order.deleted', { id: ID, status: 'approved' }),
    ).toBeNull();
  });
});

describe('createLiveConnection', () => {
  it('starts as connecting and becomes live on connect', () => {
    const socket = fakeSocket();
    const live = createLiveConnection(socket);
    const changed = vi.fn();
    live.subscribeState(changed);

    expect(live.getState()).toBe('connecting');
    socket.fire('connect');
    expect(live.getState()).toBe('live');
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('is offline when it has never connected and an attempt fails', () => {
    const socket = fakeSocket();
    const live = createLiveConnection(socket);

    socket.fire('connect_error', new Error('refused'));
    expect(live.getState()).toBe('offline');
    // Socket.IO keeps retrying; when one attempt works, it is live.
    socket.fire('connect');
    expect(live.getState()).toBe('live');
  });

  it('is reconnecting after a drop, and stays so while retries fail', () => {
    const socket = fakeSocket();
    const live = createLiveConnection(socket);
    socket.fire('connect');

    socket.fire('disconnect', 'transport close');
    expect(live.getState()).toBe('reconnecting');
    socket.fire('connect_error', new Error('refused'));
    expect(live.getState()).toBe('reconnecting');
    // A network drop is retried by Socket.IO itself.
    expect(socket.connect).not.toHaveBeenCalled();
  });

  it('asks to connect again when the server closed the connection on purpose', () => {
    const socket = fakeSocket();
    createLiveConnection(socket);
    socket.fire('connect');

    socket.fire('disconnect', 'io server disconnect');
    expect(socket.connect).toHaveBeenCalledTimes(1);
  });

  it('tells reconnect listeners when the connection comes back, but not on the first connect', () => {
    const socket = fakeSocket();
    const live = createLiveConnection(socket);
    const reconnected = vi.fn();
    live.onReconnect(reconnected);

    socket.fire('connect');
    expect(reconnected).not.toHaveBeenCalled();

    socket.fire('disconnect', 'transport close');
    socket.fire('connect');
    expect(reconnected).toHaveBeenCalledTimes(1);
    expect(live.getState()).toBe('live');
  });

  it('passes valid order events on and drops invalid ones', () => {
    const socket = fakeSocket();
    const live = createLiveConnection(socket);
    const events: OrderEvent[] = [];
    live.onOrderEvent((event) => events.push(event));

    socket.fire('order.created', { id: ID, status: 'needs_review' });
    socket.fire('order.created', { id: ID, status: 'shipped' });
    socket.fire('order.approved', { id: ID, status: 'approved' });
    socket.fire('order.approved', undefined);
    socket.fire('order.reextracted', { id: ID, status: 'auto_accepted' });

    expect(events).toEqual([
      { type: 'order.created', id: ID, status: 'needs_review' },
      { type: 'order.approved', id: ID, status: 'approved' },
      { type: 'order.reextracted', id: ID, status: 'auto_accepted' },
    ]);
  });

  it('stops calling a listener once it has unsubscribed', () => {
    const socket = fakeSocket();
    const live = createLiveConnection(socket);
    const listener = vi.fn();
    const unsubscribe = live.onOrderEvent(listener);

    unsubscribe();
    socket.fire('order.created', { id: ID, status: 'needs_review' });
    expect(listener).not.toHaveBeenCalled();
  });

  it('closes the socket', () => {
    const socket = fakeSocket();
    createLiveConnection(socket).close();
    expect(socket.close).toHaveBeenCalledTimes(1);
  });
});
