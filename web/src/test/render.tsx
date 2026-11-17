import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import type { Api } from '../api/client.js';
import { OrderStore } from '../orders/order-store.js';
import { ServicesContext } from '../services.js';
import { fakeApiWith, fakeLive } from './fakes.js';

/**
 * Renders a screen the way main.tsx does, with stand-ins for the API and the socket.
 * The store is real and started, so what a test sees is the real loading sequence.
 */
export function renderWithServices(
  ui: ReactElement,
  options: { api?: Api; live?: ReturnType<typeof fakeLive> } = {},
) {
  const api = options.api ?? fakeApiWith([]);
  const live = options.live ?? fakeLive();
  const store = new OrderStore(api, live);
  store.start();
  const view = render(
    <ServicesContext value={{ api, live, store }}>{ui}</ServicesContext>,
  );
  return { ...view, api, live, store };
}
