import { io } from 'socket.io-client';
import { API_URL } from '../api/client.js';
import {
  ORDER_APPROVED,
  ORDER_CREATED,
  ORDER_STATUSES,
  type OrderApprovedEvent,
  type OrderCreatedEvent,
  type OrderStatus,
} from '../shared.js';

/**
 * connecting:   the first attempt is still under way.
 * live:         connected; events arrive.
 * reconnecting: it was connected and the connection dropped; retrying.
 * offline:      it has never connected and an attempt failed (the API is probably not
 *               running); still retrying.
 */
export type ConnectionState =
  'connecting' | 'live' | 'reconnecting' | 'offline';

export type OrderEvent =
  | ({ type: typeof ORDER_CREATED } & OrderCreatedEvent)
  | ({ type: typeof ORDER_APPROVED } & OrderApprovedEvent);

export interface LiveConnection {
  getState: () => ConnectionState;
  subscribeState: (listener: () => void) => () => void;
  onOrderEvent: (listener: (event: OrderEvent) => void) => () => void;
  /**
   * Called each time the connection comes back after a drop. The server does not replay
   * what it sent in between, so whoever listens here should reload from the API.
   */
  onReconnect: (listener: () => void) => () => void;
  close: () => void;
}

/** The part of a Socket.IO client this module uses, so tests can pass a stand-in. */
export interface SocketLike {
  on(event: string, listener: (...args: any[]) => void): unknown;
  connect(): unknown;
  close(): unknown;
}

/**
 * Checks what came off the socket before anything acts on it. An event leads to a
 * request for `/orders/<id>`, so a payload of the wrong shape is dropped here.
 */
export function parseOrderEvent(
  type: string,
  payload: unknown,
): OrderEvent | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const { id, status } = payload as { id?: unknown; status?: unknown };
  if (typeof id !== 'string' || id.length === 0) return null;
  if (type === ORDER_APPROVED) {
    return status === 'approved' ? { type, id, status } : null;
  }
  if (type === ORDER_CREATED) {
    return ORDER_STATUSES.includes(status as OrderStatus)
      ? { type, id, status: status as OrderStatus }
      : null;
  }
  return null;
}

export function createLiveConnection(socket: SocketLike): LiveConnection {
  let state: ConnectionState = 'connecting';
  let hasConnected = false;
  const stateListeners = new Set<() => void>();
  const eventListeners = new Set<(event: OrderEvent) => void>();
  const reconnectListeners = new Set<() => void>();

  function setState(next: ConnectionState): void {
    if (next === state) return;
    state = next;
    for (const listener of stateListeners) listener();
  }

  socket.on('connect', () => {
    const cameBack = hasConnected;
    hasConnected = true;
    setState('live');
    if (cameBack) for (const listener of reconnectListeners) listener();
  });
  socket.on('disconnect', (reason: string) => {
    setState('reconnecting');
    // Socket.IO retries by itself after a network drop, but not when the server closed
    // the connection on purpose (for example while it restarts). Then it must be asked.
    if (reason === 'io server disconnect') socket.connect();
  });
  socket.on('connect_error', () => {
    setState(hasConnected ? 'reconnecting' : 'offline');
  });
  for (const type of [ORDER_CREATED, ORDER_APPROVED]) {
    socket.on(type, (payload: unknown) => {
      const event = parseOrderEvent(type, payload);
      if (event) for (const listener of eventListeners) listener(event);
    });
  }

  function add<T>(listeners: Set<T>, listener: T): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  return {
    getState: () => state,
    subscribeState: (listener) => add(stateListeners, listener),
    onOrderEvent: (listener) => add(eventListeners, listener),
    onReconnect: (listener) => add(reconnectListeners, listener),
    close: () => {
      socket.close();
    },
  };
}

/**
 * Opens the socket to the API. Reconnection is left at the Socket.IO client's defaults:
 * it retries for ever, waiting 1 s at first and doubling up to 5 s, with random jitter so
 * that many open tabs do not all retry at the same instant after the API restarts.
 */
export function connectLive(url: string = API_URL): LiveConnection {
  return createLiveConnection(io(url));
}
