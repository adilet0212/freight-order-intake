import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createApi } from '../api/client.js';
import type { Order } from '../api/types.js';
import { deferred, fakeLive, makeOrder } from '../test/fakes.js';
import { renderWithServices } from '../test/render.js';
import { OrderScreen } from './OrderScreen.js';

const BASE = 'http://api.test';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** A held order: the fixture without its delivery stop, as the review gate would hold it. */
function heldOrder(overrides: Partial<Order> = {}): Order {
  const order = makeOrder({
    status: 'needs_review',
    reviewReasons: ['No delivery stop'],
  });
  return { ...order, stops: [order.stops[0]], ...overrides };
}

describe('OrderScreen', () => {
  // The real API client runs against this stand-in for fetch, so these tests check the
  // exact request that would go over the network.
  const fetchMock = vi.fn<typeof fetch>();

  /** The JSON body of a request this app made. The client always sends a string. */
  function sentBody(init: RequestInit | undefined): any {
    return JSON.parse(init?.body as string);
  }

  /**
   * Serves GET /orders/:id from `current`, and answers PATCH with `onPatch`.
   * GET /orders answers with an empty list: the order store behind every screen asks
   * for it when it starts, and that is not what these tests are about.
   */
  function serve(
    current: { order: Order },
    onPatch?: (body: unknown) => Response | Promise<Response>,
  ) {
    fetchMock.mockImplementation(async (url, init) => {
      const path = (url as string).replace(BASE, '');
      if (init?.method === 'PATCH' && onPatch) return onPatch(sentBody(init));
      if (path === '/orders') return json(200, []);
      if (path === `/orders/${current.order.id}`) {
        return json(200, current.order);
      }
      return json(404, { message: `Order not found`, statusCode: 404 });
    });
  }

  function patchCalls() {
    return fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH');
  }

  function renderOrder(id: string, live = fakeLive()) {
    return renderWithServices(<OrderScreen id={id} />, {
      api: createApi(BASE),
      live,
    });
  }

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the email on the left, the extracted order on the right and the reasons on top', async () => {
    const order = heldOrder();
    serve({ order });
    renderOrder(order.id);

    const email = within(
      await screen.findByRole('region', { name: 'Original email' }),
    );
    expect(email.getByText('Load tender PO-48213')).toBeInTheDocument();
    expect(email.getByText(order.emailBody)).toBeInTheDocument();

    expect(
      screen.getByRole('heading', { level: 1, name: 'Maple Ridge Foods' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Customer')).toHaveValue('Maple Ridge Foods');
    expect(screen.getByLabelText('Reference no.')).toHaveValue('PO-48213');
    expect(screen.getByLabelText('Equipment')).toHaveValue('dry_van');
    expect(screen.getByLabelText('Rate')).toHaveValue('1850');
    const stop = within(screen.getByRole('group', { name: 'Stop 1' }));
    expect(stop.getByLabelText('City')).toHaveValue('Brampton');
    expect(stop.getByLabelText('Window start')).toHaveValue('2026-11-17T08:00');
    const line = within(screen.getByRole('group', { name: 'Freight line 1' }));
    expect(line.getByLabelText('Weight (lbs)')).toHaveValue('21600');
    expect(screen.getByText('Total weight: 21,600 lbs')).toBeInTheDocument();

    const reasons = within(
      screen.getByRole('region', { name: 'Held for review' }),
    );
    expect(
      reasons.getByText(
        'There is no delivery stop. Add where the freight is going.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Customer')).toBeEnabled();
  });

  it('approves a corrected order with one PATCH carrying exactly the edited order', async () => {
    const user = userEvent.setup();
    const order = heldOrder();
    const current = { order };
    serve(current, (body) => {
      current.order = {
        ...order,
        ...(body as object),
        status: 'approved',
        reviewedAt: '2026-11-16 15:00:00-05',
      } as Order;
      return json(200, current.order);
    });
    renderOrder(order.id);
    await screen.findByLabelText('Customer');

    await user.click(screen.getByRole('button', { name: 'Add delivery' }));
    const delivery = within(screen.getByRole('group', { name: 'Stop 2' }));
    await user.type(delivery.getByLabelText('Company'), 'Lakeshore Grocers DC');
    await user.type(delivery.getByLabelText('City'), ' Chicago ');
    await user.type(delivery.getByLabelText('State/Prov.'), 'il');
    fireEvent.change(delivery.getByLabelText('Window start'), {
      target: { value: '2026-11-18T09:00' },
    });
    await user.clear(screen.getByLabelText('Reference no.'));
    await user.click(screen.getByRole('button', { name: 'Approve order' }));

    await screen.findByText('Approved. The order is saved as shown.');
    expect(patchCalls()).toHaveLength(1);
    const [url, init] = patchCalls()[0];
    expect(url).toBe(`${BASE}/orders/${order.id}/review`);
    expect(init?.headers).toEqual({
      Accept: 'application/json',
      'Content-Type': 'application/json',
    });
    expect(sentBody(init)).toEqual({
      customerName: 'Maple Ridge Foods',
      // Cleared in the form, so it is sent as null, not as an empty string.
      referenceNumber: null,
      equipmentType: 'dry_van',
      stops: [
        order.stops[0],
        {
          type: 'delivery',
          companyName: 'Lakeshore Grocers DC',
          street: null,
          // Trimmed.
          city: 'Chicago',
          // Typed in lower case, sent in capitals.
          region: 'IL',
          postalCode: null,
          windowStart: '2026-11-18T09:00',
          windowEnd: null,
        },
      ],
      commodities: order.commodities,
      rateAmount: 1850,
      rateCurrency: 'USD',
      specialInstructions: null,
    });

    // The screen now shows the approved order and can no longer be edited.
    const head = within(
      screen.getByRole('heading', { level: 1 }).parentElement!,
    );
    expect(head.getByText('Approved')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Approve order' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Add delivery' }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText('Customer')).toBeDisabled();
    expect(
      screen.getByRole('region', { name: 'Approved by a reviewer' }),
    ).toBeInTheDocument();
  });

  it('marks a reason fixed as soon as the edit resolves it, before anything is sent', async () => {
    const user = userEvent.setup();
    const order = heldOrder();
    serve({ order });
    renderOrder(order.id);
    const reasons = within(
      await screen.findByRole('region', { name: 'Held for review' }),
    );
    expect(reasons.getByRole('listitem')).toHaveTextContent('Open');
    expect(
      screen.getByText(
        '1 check is still open. Approving saves the order as it is.',
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add delivery' }));
    // The new stop has no city yet, which is a different rule now open.
    expect(reasons.getAllByRole('listitem')[0]).toHaveTextContent('Fixed');
    expect(reasons.getAllByRole('listitem')[1]).toHaveTextContent(
      'Stop 2 has no city or no state/province',
    );

    const delivery = within(screen.getByRole('group', { name: 'Stop 2' }));
    await user.type(delivery.getByLabelText('City'), 'Chicago');
    await user.type(delivery.getByLabelText('State/Prov.'), 'IL');

    expect(reasons.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByText('No check is open.')).toBeInTheDocument();
    expect(patchCalls()).toHaveLength(0);
  });

  it('lets a reviewer approve while a check is still open: the warning does not block', async () => {
    const user = userEvent.setup();
    const order = heldOrder();
    const current = { order };
    serve(current, () => {
      current.order = { ...order, status: 'approved' };
      return json(200, current.order);
    });
    renderOrder(order.id);

    await user.click(
      await screen.findByRole('button', { name: 'Approve order' }),
    );

    await screen.findByText('Approved. The order is saved as shown.');
    expect(patchCalls()).toHaveLength(1);
    expect(sentBody(patchCalls()[0][1]).stops).toEqual([order.stops[0]]);
  });

  it('sends nothing while a field holds a value that cannot be saved, and says which', async () => {
    const user = userEvent.setup();
    const order = heldOrder();
    serve({ order });
    renderOrder(order.id);
    const line = within(
      await screen.findByRole('group', { name: 'Freight line 1' }),
    );

    const quantity = line.getByLabelText('Quantity');
    await user.clear(quantity);
    await user.type(quantity, '2.5');
    expect(quantity).toBeInvalid();
    expect(quantity).toHaveAccessibleDescription(
      'Quantity must be a whole number above 0',
    );

    await user.click(screen.getByRole('button', { name: 'Approve order' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'One field has a value that cannot be saved. Correct what is marked above. Nothing was sent.',
    );
    expect(patchCalls()).toHaveLength(0);

    // Once corrected, the same button sends it.
    await user.clear(quantity);
    await user.type(quantity, '3');
    expect(quantity).toBeValid();
    await user.click(screen.getByRole('button', { name: 'Approve order' }));
    await waitFor(() => expect(patchCalls()).toHaveLength(1));
    expect(sentBody(patchCalls()[0][1]).commodities[0].quantity).toBe(3);
  });

  it('shows each freight message once, in its own freight line, tied to its own field', async () => {
    const user = userEvent.setup();
    const order = heldOrder();
    serve({ order });
    renderOrder(order.id);
    const line = within(
      await screen.findByRole('group', { name: 'Freight line 1' }),
    );
    const quantityMessage = 'Quantity must be a whole number above 0';
    const weightMessage = 'Weight must be a whole number above 0';

    const quantity = line.getByLabelText('Quantity');
    const weight = line.getByLabelText('Weight (lbs)');
    await user.clear(quantity);
    await user.type(quantity, '2.5');
    await user.clear(weight);
    await user.type(weight, 'abc');

    // The messages sit under the row, not under the narrow fields, so each field
    // has to stay tied to its own one.
    expect(quantity).toHaveAccessibleDescription(quantityMessage);
    expect(weight).toHaveAccessibleDescription(weightMessage);
    expect(line.getAllByText(quantityMessage)).toHaveLength(1);
    expect(line.getAllByText(weightMessage)).toHaveLength(1);
    expect(line.getByLabelText('Description')).toBeValid();
    expect(
      line.getByLabelText('Description'),
    ).not.toHaveAccessibleDescription();

    // Correcting one field removes its message and leaves the other.
    await user.clear(weight);
    await user.type(weight, '48000');
    expect(weight).toBeValid();
    expect(weight).not.toHaveAccessibleDescription();
    expect(screen.queryByText(weightMessage)).not.toBeInTheDocument();
    expect(quantity).toHaveAccessibleDescription(quantityMessage);
  });

  it('disables the button while the approval is on its way, so it cannot be sent twice', async () => {
    const user = userEvent.setup();
    const order = heldOrder();
    const answer = deferred<Response>();
    serve({ order }, () => answer.promise);
    renderOrder(order.id);

    await user.click(
      await screen.findByRole('button', { name: 'Approve order' }),
    );
    const button = screen.getByRole('button', { name: 'Approving' });
    expect(button).toBeDisabled();
    expect(screen.getByLabelText('Customer')).toBeDisabled();
    await user.click(button);
    expect(patchCalls()).toHaveLength(1);

    await act(async () =>
      answer.resolve(json(200, { ...order, status: 'approved' })),
    );
    expect(patchCalls()).toHaveLength(1);
    await screen.findByText('Approved. The order is saved as shown.');
  });

  it('says so and shows the current order when someone else reviewed it first (409)', async () => {
    const user = userEvent.setup();
    const order = heldOrder();
    const current = { order };
    serve(current, () => {
      // By the time this request arrives, another reviewer has approved the order.
      current.order = {
        ...order,
        customerName: 'Maple Ridge Foods Ltd',
        status: 'approved',
      };
      return json(409, {
        message: `Order ${order.id} is approved; only held orders can be reviewed`,
        statusCode: 409,
      });
    });
    renderOrder(order.id);

    await user.click(
      await screen.findByRole('button', { name: 'Approve order' }),
    );

    expect(
      await screen.findByText(/had already been reviewed/),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText('Customer')).toHaveValue(
        'Maple Ridge Foods Ltd',
      ),
    );
    expect(screen.getByLabelText('Customer')).toBeDisabled();
    expect(
      screen.queryByRole('button', { name: 'Approve order' }),
    ).not.toBeInTheDocument();
  });

  it('shows the API’s reason when it refuses the order (400), and keeps the edits', async () => {
    const user = userEvent.setup();
    const order = heldOrder();
    serve({ order }, () =>
      json(400, {
        message: ['stops.0.type: Invalid option'],
        error: 'Bad Request',
        statusCode: 400,
      }),
    );
    renderOrder(order.id);

    const customer = await screen.findByLabelText('Customer');
    await user.clear(customer);
    await user.type(customer, 'Edited Name');
    await user.click(screen.getByRole('button', { name: 'Approve order' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not approve the order. stops.0.type: Invalid option',
    );
    expect(customer).toHaveValue('Edited Name');
    expect(customer).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Approve order' })).toBeEnabled();
  });

  it('says the API could not be reached, and approves when tried again', async () => {
    const user = userEvent.setup();
    const order = heldOrder();
    const current = { order };
    let attempts = 0;
    serve(current, () => {
      attempts += 1;
      if (attempts === 1) throw new TypeError('Failed to fetch');
      current.order = { ...order, status: 'approved' };
      return json(200, current.order);
    });
    renderOrder(order.id);

    await user.click(
      await screen.findByRole('button', { name: 'Approve order' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      `Could not approve the order. Could not reach the API at ${BASE}.`,
    );

    await user.click(screen.getByRole('button', { name: 'Approve order' }));
    await screen.findByText('Approved. The order is saved as shown.');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(patchCalls()).toHaveLength(2);
  });

  it('shows an order that is not held read-only, with no way to approve it', async () => {
    const order = makeOrder({ status: 'auto_accepted' });
    serve({ order });
    renderOrder(order.id);

    expect(
      await screen.findByText(
        'Accepted automatically. It passed every check at intake.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Customer')).toBeDisabled();
    expect(
      within(screen.getByRole('group', { name: 'Stop 2' })).getByLabelText(
        'City',
      ),
    ).toBeDisabled();
    expect(
      screen.queryByRole('button', { name: 'Approve order' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Remove stop/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: 'Held for review' }),
    ).not.toBeInTheDocument();
  });

  it('gives an empty, editable form for an email whose extraction failed', async () => {
    const order = makeOrder({
      status: 'extraction_failed',
      reviewReasons: [
        'Model output did not match the schema: expected boolean',
      ],
      customerName: null,
      referenceNumber: null,
      equipmentType: null,
      rateAmount: null,
      rateCurrency: null,
      stops: [],
      commodities: [],
    });
    serve({ order });
    renderOrder(order.id);

    // With no customer, the email's subject is the title.
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Load tender PO-48213',
      }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Customer')).toHaveValue('');
    expect(screen.getByLabelText('Customer')).toBeEnabled();
    expect(screen.getByText('No stops.')).toBeInTheDocument();
    expect(screen.getByText('No freight.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve order' })).toBeEnabled();
    expect(
      screen.getByText(/The model’s answer could not be read/),
    ).toBeInTheDocument();
  });

  it('switches to read-only when the order is approved in another window', async () => {
    const user = userEvent.setup();
    const order = heldOrder();
    const current = { order };
    serve(current);
    const live = fakeLive();
    renderOrder(order.id, live);

    const customer = await screen.findByLabelText('Customer');
    await user.type(customer, ' (my edit)');

    current.order = { ...order, status: 'approved' };
    act(() => {
      live.emit({ type: 'order.approved', id: order.id, status: 'approved' });
    });

    expect(
      await screen.findByText(/approved in another window/),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText('Customer')).toBeDisabled(),
    );
    expect(screen.getByLabelText('Customer')).toHaveValue('Maple Ridge Foods');
    expect(
      screen.queryByRole('button', { name: 'Approve order' }),
    ).not.toBeInTheDocument();
  });

  it('does not mistake the event for its own approval for someone else’s', async () => {
    const user = userEvent.setup();
    const order = heldOrder();
    const current = { order };
    const live = fakeLive();
    serve(current, () => {
      current.order = { ...order, status: 'approved' };
      // The API sends the event before it answers the request that caused it.
      live.emit({ type: 'order.approved', id: order.id, status: 'approved' });
      return json(200, current.order);
    });
    renderOrder(order.id, live);

    await user.click(
      await screen.findByRole('button', { name: 'Approve order' }),
    );
    await screen.findByText('Approved. The order is saved as shown.');
    // And once more after the answer, as a second window's listener would see it.
    await act(async () => {
      live.emit({ type: 'order.approved', id: order.id, status: 'approved' });
    });

    expect(
      screen.getByText('Approved. The order is saved as shown.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/approved in another window/),
    ).not.toBeInTheDocument();
  });

  it('leaves the form alone for events that are not an approval of this order', async () => {
    const user = userEvent.setup();
    const order = heldOrder();
    serve({ order });
    const live = fakeLive();
    renderOrder(order.id, live);
    const customer = await screen.findByLabelText('Customer');
    await user.type(customer, ' (my edit)');

    await act(async () => {
      live.emit({
        type: 'order.approved',
        id: 'another-id',
        status: 'approved',
      });
      live.emit({
        type: 'order.created',
        id: order.id,
        status: 'needs_review',
      });
    });

    expect(customer).toHaveValue('Maple Ridge Foods (my edit)');
    expect(customer).toBeEnabled();
    expect(
      screen.queryByText(/approved in another window/),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve order' })).toBeEnabled();
  });

  it('says the order was not found for an unknown id, and for an id that is not one', async () => {
    fetchMock.mockImplementation(async (url) => {
      const path = (url as string).replace(BASE, '');
      if (path === '/orders') return json(200, []);
      return path === '/orders/not-a-uuid'
        ? json(400, { message: ['Invalid UUID'], statusCode: 400 })
        : json(404, { message: 'Order not found', statusCode: 404 });
    });

    const first = renderOrder('7c9e6679-7425-40de-944b-e07fc1f90ae7');
    expect(
      await screen.findByRole('heading', { name: 'Order not found' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Go to the queue' }),
    ).toHaveAttribute('href', '#/');
    first.unmount();

    renderOrder('not-a-uuid');
    expect(
      await screen.findByRole('heading', { name: 'Order not found' }),
    ).toBeInTheDocument();
  });

  it('shows why the order could not load, and loads it when asked to try again', async () => {
    const user = userEvent.setup();
    const order = heldOrder();
    fetchMock.mockImplementation(async (url) => {
      if ((url as string).endsWith('/orders')) return json(200, []);
      throw new TypeError('Failed to fetch');
    });
    renderOrder(order.id);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not load the order');
    expect(alert).toHaveTextContent(`Could not reach the API at ${BASE}.`);

    serve({ order });
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByLabelText('Customer')).toHaveValue(
      'Maple Ridge Foods',
    );
  });
});
