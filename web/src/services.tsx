import { createContext, useContext, useSyncExternalStore } from 'react';
import type { Api } from './api/client.js';
import type { ConnectionState, LiveConnection } from './live/connection.js';
import type { OrderStore, StoreSnapshot } from './orders/order-store.js';

/**
 * The three things every screen talks to. They are handed down through context, not
 * imported, so a test can render a screen with stand-ins and no network.
 */
export interface Services {
  api: Api;
  live: LiveConnection;
  store: OrderStore;
}

export const ServicesContext = createContext<Services | null>(null);

export function useServices(): Services {
  const services = useContext(ServicesContext);
  if (!services) throw new Error('ServicesContext has no value');
  return services;
}

export function useOrders(): StoreSnapshot {
  const { store } = useServices();
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

export function useConnectionState(): ConnectionState {
  const { live } = useServices();
  return useSyncExternalStore(live.subscribeState, live.getState);
}
