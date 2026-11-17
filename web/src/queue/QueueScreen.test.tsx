import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../api/client.js';
import type { Order, OrderRow } from '../api/types.js';
import { formatInstant } from '../format.js';
import {
  deferred,
  fakeApi,
  fakeApiWith,
  fakeLive,
  makeOrder,
} from '../test/fakes.js';
import { renderWithServices } from '../test/render.js';
import { QueueScreen } from './QueueScreen.js';

/** The body rows of the queue table, in the order they are shown. */
function rows(): HTMLElement[] {
  return screen.getAllByRole('row').slice(1);
}

function rowFor(text: string): HTMLElement {
  return screen.getByText(text).closest('tr')!;
}

describe('QueueScreen', () => {
  it('says it is loading until the list answers', async () => {
    const api = fakeApi();
    const list = deferred<OrderRow[]>();
    api.listOrders.mockReturnValue(list.promise);
    renderWithServices(<QueueScreen status={null} />, { api });

    expect(screen.getByRole('status')).toHaveTextContent('Loading orders');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    await act(async () => list.resolve([]));
    expect(screen.queryByText('Loading orders')).not.toBeInTheDocument();
  });

  it('says so when there are no orders, and points to the paste form', async () => {
    renderWithServices(<QueueScreen status={null} />);

    expect(
      await screen.findByRole('heading', { name: 'No orders yet' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Paste an email' }),
    ).toHaveAttribute('href', '#/paste');
    expect(screen.getByText('0 held, 0 in total')).toBeInTheDocument();
  });

  it('shows why the queue could not load, and loads it when asked to try again', async () => {
    const order = makeOrder();
    const api = fakeApiWith([order]);
    api.listOrders.mockRejectedValueOnce(
      new ApiError(0, 'Could not reach the API at http://localhost:3000.'),
    );
    renderWithServices(<QueueScreen status={null} />, { api });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not load the queue');
    expect(alert).toHaveTextContent(
      'Could not reach the API at http://localhost:3000.',
    );

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Maple Ridge Foods')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows status, customer, lane, pickup date and received time for an order', async () => {
    const order = makeOrder({
      status: 'needs_review',
      reviewReasons: ['Pickup date missing', 'Model flagged: two POs'],
    });
    renderWithServices(<QueueScreen status={null} />, {
      api: fakeApiWith([order]),
    });

    const row = within(await screen.findByRole('row', { name: /Maple Ridge/ }));
    expect(row.getByText('Needs review')).toBeInTheDocument();
    expect(
      row.getByRole('link', { name: 'Maple Ridge Foods' }),
    ).toHaveAttribute('href', `#/orders/${order.id}`);
    expect(row.getByText('PO-48213')).toBeInTheDocument();
    expect(
      await row.findByText('Brampton, ON → Chicago, IL'),
    ).toBeInTheDocument();
    expect(row.getByText('Nov 17, 2026, 08:00')).toBeInTheDocument();
    expect(
      row.getByText(formatInstant('2026-11-16 14:05:00-05')),
    ).toBeInTheDocument();
    expect(row.getByText('Pickup date missing')).toBeInTheDocument();
    expect(row.getByText('+1 more')).toBeInTheDocument();
  });

  it('shows the email subject for an order that has no customer', async () => {
    const order = makeOrder({
      status: 'not_an_order',
      customerName: null,
      referenceNumber: null,
      emailSubject: 'Where is my truck?',
      stops: [],
      commodities: [],
    });
    renderWithServices(<QueueScreen status={null} />, {
      api: fakeApiWith([order]),
    });

    expect(
      await screen.findByRole('link', { name: 'Where is my truck?' }),
    ).toHaveAttribute('href', `#/orders/${order.id}`);
    expect(
      within(rowFor('Where is my truck?')).getByText('Not an order'),
    ).toBeInTheDocument();
  });

  it('lists held orders first: oldest held at the top, then finished orders newest first', async () => {
    const orders = [
      makeOrder({
        customerName: 'Done, older',
        status: 'auto_accepted',
        createdAt: '2026-11-16 08:00:00-05',
      }),
      makeOrder({
        customerName: 'Held, newer',
        status: 'extraction_failed',
        createdAt: '2026-11-16 11:00:00-05',
      }),
      makeOrder({
        customerName: 'Done, newer',
        status: 'approved',
        createdAt: '2026-11-16 12:00:00-05',
      }),
      makeOrder({
        customerName: 'Held, older',
        status: 'needs_review',
        createdAt: '2026-11-16 09:00:00-05',
      }),
    ];
    renderWithServices(<QueueScreen status={null} />, {
      api: fakeApiWith(orders),
    });
    await screen.findByText('Held, older');

    expect(
      rows().map((row) => within(row).getByRole('link').textContent),
    ).toEqual(['Held, older', 'Held, newer', 'Done, newer', 'Done, older']);
    expect(screen.getByText('2 held, 4 in total')).toBeInTheDocument();
  });

  it('filters by the status in the address and shows a count for every status', async () => {
    const orders = [
      makeOrder({ customerName: 'Held Co', status: 'needs_review' }),
      makeOrder({ customerName: 'Clean Co', status: 'auto_accepted' }),
      makeOrder({ customerName: 'Other Clean Co', status: 'auto_accepted' }),
    ];
    renderWithServices(<QueueScreen status="auto_accepted" />, {
      api: fakeApiWith(orders),
    });
    await screen.findByText('Clean Co');

    expect(screen.queryByText('Held Co')).not.toBeInTheDocument();
    expect(rows()).toHaveLength(2);

    const filter = within(
      screen.getByRole('navigation', { name: 'Filter by status' }),
    );
    expect(filter.getByRole('link', { name: 'All 3' })).toHaveAttribute(
      'href',
      '#/',
    );
    expect(
      filter.getByRole('link', { name: 'Needs review 1' }),
    ).toHaveAttribute('href', '#/?status=needs_review');
    expect(
      filter.getByRole('link', { name: 'Auto-accepted 2' }),
    ).toHaveAttribute('aria-current', 'true');
    expect(
      filter.getByRole('link', { name: 'Approved 0' }),
    ).not.toHaveAttribute('aria-current');
    expect(
      filter.getByRole('link', { name: 'Extraction failed 0' }),
    ).toBeInTheDocument();
    expect(
      filter.getByRole('link', { name: 'Not an order 0' }),
    ).toBeInTheDocument();
  });

  it('shows everything when the address names a status that does not exist', async () => {
    renderWithServices(<QueueScreen status="shipped" />, {
      api: fakeApiWith([makeOrder()]),
    });
    expect(await screen.findByText('Maple Ridge Foods')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'All 1' })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  it('says so when no order has the chosen status, and offers all orders', async () => {
    renderWithServices(<QueueScreen status="approved" />, {
      api: fakeApiWith([makeOrder({ status: 'needs_review' })]),
    });

    expect(
      await screen.findByRole('heading', {
        name: 'No orders with the status "Approved"',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Show all orders' }),
    ).toHaveAttribute('href', '#/');
  });

  it('adds a new order when its event arrives, without reloading the list', async () => {
    const orders = [makeOrder({ customerName: 'Already Here Ltd' })];
    const api = fakeApiWith(orders);
    const live = fakeLive();
    renderWithServices(<QueueScreen status={null} />, { api, live });
    await screen.findByText('Already Here Ltd');

    const created = makeOrder({
      customerName: 'Just Arrived Inc',
      status: 'needs_review',
      reviewReasons: ['No delivery stop'],
    });
    orders.push(created);
    act(() => {
      live.emit({
        type: 'order.created',
        id: created.id,
        status: 'needs_review',
      });
    });

    const row = within(
      (await screen.findByText('Just Arrived Inc')).closest('tr')!,
    );
    expect(row.getByText('New')).toBeInTheDocument();
    expect(row.getByText('Needs review')).toBeInTheDocument();
    // Held, so it is listed above the finished order that was already there.
    expect(rows()[0]).toHaveTextContent('Just Arrived Inc');
    expect(
      within(rowFor('Already Here Ltd')).queryByText('New'),
    ).not.toBeInTheDocument();
    expect(screen.getByText('1 held, 2 in total')).toBeInTheDocument();
    expect(api.listOrders).toHaveBeenCalledTimes(1);
  });

  it('updates an order in place when it is approved somewhere else', async () => {
    const held = makeOrder({
      status: 'needs_review',
      reviewReasons: ['No delivery stop'],
    });
    const orders: Order[] = [held];
    const live = fakeLive();
    renderWithServices(<QueueScreen status={null} />, {
      api: fakeApiWith(orders),
      live,
    });
    await screen.findByText('Maple Ridge Foods');
    expect(
      within(rowFor('Maple Ridge Foods')).getByText('Needs review'),
    ).toBeInTheDocument();

    orders[0] = {
      ...held,
      status: 'approved',
      reviewedAt: '2026-11-16 15:00:00-05',
    };
    act(() => {
      live.emit({ type: 'order.approved', id: held.id, status: 'approved' });
    });

    const row = within(await screen.findByRole('row', { name: /Maple Ridge/ }));
    await waitFor(() => expect(row.getByText('Approved')).toBeInTheDocument());
    expect(row.queryByText('Needs review')).not.toBeInTheDocument();
    // The reason it was held for is history now, so the queue stops showing it.
    expect(row.queryByText('No delivery stop')).not.toBeInTheDocument();
    expect(rows()).toHaveLength(1);
    expect(screen.getByText('0 held, 1 in total')).toBeInTheDocument();
  });

  it('updates a failed order in place when a re-send extracts it again', async () => {
    const failed = makeOrder({
      status: 'extraction_failed',
      customerName: null,
      emailSubject: 'Load tender PO-48213',
      reviewReasons: ['Model provider failed: The provider answered 503'],
      stops: [],
      commodities: [],
    });
    const orders: Order[] = [failed];
    const live = fakeLive();
    renderWithServices(<QueueScreen status={null} />, {
      api: fakeApiWith(orders),
      live,
    });
    await screen.findByText('Load tender PO-48213');

    orders[0] = makeOrder({ id: failed.id, status: 'auto_accepted' });
    act(() => {
      live.emit({
        type: 'order.reextracted',
        id: failed.id,
        status: 'auto_accepted',
      });
    });

    const row = within(await screen.findByRole('row', { name: /Maple Ridge/ }));
    expect(row.getByText('Auto-accepted')).toBeInTheDocument();
    expect(row.queryByText('Extraction failed')).not.toBeInTheDocument();
    expect(rows()).toHaveLength(1);
  });

  it('shows a placeholder for the lane until the stops arrive, and says so if they cannot be read', async () => {
    const waiting = makeOrder({ customerName: 'Waiting Co' });
    const broken = makeOrder({ customerName: 'Broken Co' });
    const api = fakeApiWith([waiting, broken]);
    const stops = deferred<Order>();
    api.getOrder.mockImplementation((id) =>
      id === waiting.id
        ? stops.promise
        : Promise.reject(new ApiError(500, 'Server error')),
    );
    renderWithServices(<QueueScreen status={null} />, { api });

    await screen.findByText('Waiting Co');
    expect(
      within(rowFor('Waiting Co')).getByText('Loading stops'),
    ).toBeInTheDocument();
    expect(
      await within(rowFor('Broken Co')).findByText('Could not load stops'),
    ).toBeInTheDocument();

    await act(async () => stops.resolve(waiting));
    expect(
      within(rowFor('Waiting Co')).getByText('Brampton, ON → Chicago, IL'),
    ).toBeInTheDocument();
  });

  it('warns that the list may be stale while the connection is down, and stops when it is back', async () => {
    const live = fakeLive('live');
    renderWithServices(<QueueScreen status={null} />, {
      api: fakeApiWith([makeOrder()]),
      live,
    });
    await screen.findByText('Maple Ridge Foods');
    expect(
      screen.queryByText(/Live updates are paused/),
    ).not.toBeInTheDocument();

    act(() => live.setState('reconnecting'));
    expect(screen.getByText(/Live updates are paused/)).toBeInTheDocument();

    act(() => live.setState('live'));
    expect(
      screen.queryByText(/Live updates are paused/),
    ).not.toBeInTheDocument();
  });

  it('reloads the list from the Refresh button, and keeps the list if the reload fails', async () => {
    const orders = [makeOrder({ customerName: 'First Co' })];
    const api = fakeApiWith(orders);
    renderWithServices(<QueueScreen status={null} />, { api });
    await screen.findByText('First Co');

    orders.push(makeOrder({ customerName: 'Second Co' }));
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText('Second Co')).toBeInTheDocument();
    expect(api.listOrders).toHaveBeenCalledTimes(2);

    api.listOrders.mockRejectedValueOnce(new ApiError(500, 'Server error'));
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not refresh the list. Server error',
    );
    expect(screen.getByText('First Co')).toBeInTheDocument();
    expect(screen.getByText('Second Co')).toBeInTheDocument();
  });
});
