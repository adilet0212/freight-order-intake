import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createApi } from '../api/client.js';
import { localInputToIso } from '../format.js';
import { deferred, makeOrder } from '../test/fakes.js';
import { renderWithServices } from '../test/render.js';
import { PasteEmailScreen } from './PasteEmailScreen.js';

const BASE = 'http://api.test';
const SUBJECT = 'Load tender PO-48213';
const BODY =
  'Please pick up 18 skids in Brampton on Nov 17.\nDeliver to Chicago.';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('PasteEmailScreen', () => {
  // The real API client runs against this stand-in for fetch.
  const fetchMock = vi.fn<typeof fetch>();

  /** Answers POST /emails with `onPost`. GET /orders (the store starting up) gets []. */
  function serve(onPost: () => Response | Promise<Response>) {
    fetchMock.mockImplementation(async (_url, init) =>
      init?.method === 'POST' ? onPost() : json(200, []),
    );
  }

  function posts() {
    return fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');
  }

  function sentBody(index = 0): Record<string, unknown> {
    return JSON.parse(posts()[index][1]?.body as string);
  }

  function renderScreen() {
    return renderWithServices(<PasteEmailScreen />, { api: createApi(BASE) });
  }

  async function fillIn(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText('Subject'), SUBJECT);
    // Typed in one step: the text has a line break, which typing would turn into Enter.
    fireEvent.change(screen.getByLabelText('Email text'), {
      target: { value: BODY },
    });
    fireEvent.change(screen.getByLabelText('Received'), {
      target: { value: '2026-11-16T22:30' },
    });
  }

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts with the received time set to now, in the form the input expects', () => {
    serve(() => json(500, {}));
    const before = Date.now();
    renderScreen();

    const value = (screen.getByLabelText('Received') as HTMLInputElement).value;
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    // Within a minute of the clock: the value is cut to the minute.
    expect(Math.abs(new Date(value).getTime() - before)).toBeLessThan(61_000);
  });

  it('posts the email and shows the new order with a link to it', async () => {
    const user = userEvent.setup();
    const order = makeOrder({ status: 'needs_review' });
    serve(() => json(201, order));
    const { store } = renderScreen();

    await fillIn(user);
    await user.click(screen.getByRole('button', { name: 'Extract order' }));

    const result = within(
      await screen.findByText('Order created.').then((el) => el.parentElement!),
    );
    expect(result.getByText('Needs review')).toBeInTheDocument();
    expect(
      result.getByRole('link', { name: 'Open the order' }),
    ).toHaveAttribute('href', `#/orders/${order.id}`);

    expect(posts()).toHaveLength(1);
    expect(posts()[0][0]).toBe(`${BASE}/emails`);
    expect(sentBody()).toEqual({
      subject: SUBJECT,
      // Sent as pasted, line break included.
      body: BODY,
      // The local time that was entered, with this machine's offset for that moment.
      receivedAt: localInputToIso('2026-11-16T22:30'),
    });
    expect(sentBody().receivedAt).toMatch(
      /^2026-11-16T22:30:00[+-]\d{2}:\d{2}$/,
    );
    // No Message-ID was entered, so the field is left out, not sent empty.
    expect(sentBody()).not.toHaveProperty('messageId');
    // The queue has the order without waiting for the live event.
    expect(
      store.getSnapshot().entries.map((entry) => entry.order.id),
    ).toContain(order.id);
  });

  it('sends the Message-ID when one is entered, without the spaces around it', async () => {
    const user = userEvent.setup();
    serve(() => json(201, makeOrder()));
    renderScreen();

    await fillIn(user);
    await user.type(
      screen.getByLabelText('Message-ID (optional)'),
      '  <CAF8x1@mail.mapleridge.example> ',
    );
    await user.click(screen.getByRole('button', { name: 'Extract order' }));

    await screen.findByText('Order created.');
    expect(sentBody().messageId).toBe('<CAF8x1@mail.mapleridge.example>');
  });

  it('says so when the API had already stored this email (200)', async () => {
    const user = userEvent.setup();
    const order = makeOrder();
    serve(() => json(200, order));
    renderScreen();

    await fillIn(user);
    await user.click(screen.getByRole('button', { name: 'Extract order' }));

    expect(
      await screen.findByText(
        'This email was already stored. No new order was created.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Order created.')).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Open the order' }),
    ).toHaveAttribute('href', `#/orders/${order.id}`);
  });

  it('sends nothing and names what is missing when the form is empty or blank', async () => {
    const user = userEvent.setup();
    serve(() => json(201, makeOrder()));
    renderScreen();

    await user.type(screen.getByLabelText('Subject'), '   ');
    await user.type(screen.getByLabelText('Email text'), '  ');
    await user.click(screen.getByRole('button', { name: 'Extract order' }));

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Nothing was sent.');
    expect(alert).toHaveTextContent('Subject is required.');
    expect(alert).toHaveTextContent('Email text is required.');
    expect(posts()).toHaveLength(0);
  });

  it('asks for the received time when it has been cleared', async () => {
    const user = userEvent.setup();
    serve(() => json(201, makeOrder()));
    renderScreen();

    await fillIn(user);
    fireEvent.change(screen.getByLabelText('Received'), {
      target: { value: '' },
    });
    await user.click(screen.getByRole('button', { name: 'Extract order' }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Received is required.',
    );
    expect(posts()).toHaveLength(0);
  });

  it('accepts an email of exactly the API’s limit and refuses one character more', async () => {
    const user = userEvent.setup();
    serve(() => json(201, makeOrder()));
    renderScreen();
    await fillIn(user);

    // The API's limit for the body is 20,000 characters (inboundEmailSchema).
    fireEvent.change(screen.getByLabelText('Email text'), {
      target: { value: 'x'.repeat(20_001) },
    });
    await user.click(screen.getByRole('button', { name: 'Extract order' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Email text is too long. The limit is 20,000 characters.',
    );
    expect(posts()).toHaveLength(0);

    fireEvent.change(screen.getByLabelText('Email text'), {
      target: { value: 'x'.repeat(20_000) },
    });
    await user.click(screen.getByRole('button', { name: 'Extract order' }));
    await screen.findByText('Order created.');
    expect(posts()).toHaveLength(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows that it is working and cannot be sent twice while the model is reading', async () => {
    const user = userEvent.setup();
    const answer = deferred<Response>();
    serve(() => answer.promise);
    renderScreen();

    await fillIn(user);
    await user.click(screen.getByRole('button', { name: 'Extract order' }));

    expect(screen.getByRole('status')).toHaveTextContent('Reading the email.');
    const button = screen.getByRole('button', { name: 'Extracting' });
    expect(button).toBeDisabled();
    expect(screen.getByLabelText('Email text')).toBeDisabled();
    await user.click(button);
    expect(posts()).toHaveLength(1);

    await act(async () => answer.resolve(json(201, makeOrder())));
    await screen.findByText('Order created.');
    expect(screen.queryByText(/Reading the email/)).not.toBeInTheDocument();
    expect(posts()).toHaveLength(1);
  });

  it('says the email was not stored when the API fails, keeps the text, and can be sent again', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    serve(() => {
      attempts += 1;
      return attempts === 1
        ? json(500, { message: 'Internal server error', statusCode: 500 })
        : json(201, makeOrder());
    });
    renderScreen();

    await fillIn(user);
    await user.click(screen.getByRole('button', { name: 'Extract order' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The email was not stored. Internal server error Nothing was saved, so it is safe to send it again.',
    );
    expect(screen.getByLabelText('Subject')).toHaveValue(SUBJECT);
    expect(screen.getByLabelText('Email text')).toHaveValue(BODY);

    await user.click(screen.getByRole('button', { name: 'Extract order' }));
    await screen.findByText('Order created.');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(posts()).toHaveLength(2);
    expect(sentBody(1)).toEqual(sentBody(0));
  });

  it('says the email was not stored when the API cannot be reached', async () => {
    const user = userEvent.setup();
    serve(() => {
      throw new TypeError('Failed to fetch');
    });
    renderScreen();

    await fillIn(user);
    await user.click(screen.getByRole('button', { name: 'Extract order' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      `The email was not stored. Could not reach the API at ${BASE}.`,
    );
  });

  it('shows the API’s reason when it refuses the email (400)', async () => {
    const user = userEvent.setup();
    serve(() =>
      json(400, {
        message: ['receivedAt: Invalid ISO datetime'],
        error: 'Bad Request',
        statusCode: 400,
      }),
    );
    renderScreen();

    await fillIn(user);
    await user.click(screen.getByRole('button', { name: 'Extract order' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'The API refused the email. receivedAt: Invalid ISO datetime',
    );
    expect(alert).not.toHaveTextContent('safe to send it again');
  });

  it('empties the form and the result with Clear', async () => {
    const user = userEvent.setup();
    serve(() => json(201, makeOrder()));
    renderScreen();

    await fillIn(user);
    await user.click(screen.getByRole('button', { name: 'Extract order' }));
    await screen.findByText('Order created.');

    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByLabelText('Subject')).toHaveValue('');
    expect(screen.getByLabelText('Email text')).toHaveValue('');
    expect(screen.queryByText('Order created.')).not.toBeInTheDocument();
  });
});
