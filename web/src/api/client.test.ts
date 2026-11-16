import { makeOrder, rowOf } from '../test/fakes.js';
import { ApiError, createApi, messageFrom } from './client.js';

const BASE = 'http://api.test';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('API client', () => {
  const fetchMock = vi.fn<typeof fetch>();
  const api = createApi(BASE);

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists orders with a GET and no body', async () => {
    const order = makeOrder();
    fetchMock.mockResolvedValue(jsonResponse(200, [rowOf(order)]));

    await expect(api.listOrders()).resolves.toEqual([rowOf(order)]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/orders`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      body: undefined,
    });
  });

  it('reads one order by id, escaping the id in the path', async () => {
    const order = makeOrder();
    fetchMock.mockResolvedValue(jsonResponse(200, order));

    await expect(api.getOrder('a/b')).resolves.toEqual(order);
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/orders/a%2Fb`);
  });

  it('approves with a PATCH to the review path, sending the corrected order as JSON', async () => {
    const order = makeOrder({ status: 'approved' });
    fetchMock.mockResolvedValue(jsonResponse(200, order));
    const corrected = {
      customerName: 'Maple Ridge Foods',
      referenceNumber: null,
      equipmentType: null,
      stops: [],
      commodities: [],
      rateAmount: null,
      rateCurrency: null,
      specialInstructions: null,
    };

    await expect(api.approveOrder(order.id, corrected)).resolves.toEqual(order);
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE}/orders/${order.id}/review`,
      {
        method: 'PATCH',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(corrected),
      },
    );
  });

  it('posts an email and tells a new order (201) from one already stored (200)', async () => {
    const order = makeOrder();
    const email = {
      subject: 'Load tender',
      body: 'Please pick up 18 skids',
      receivedAt: '2026-11-16T14:05:00-05:00',
    };

    fetchMock.mockResolvedValueOnce(jsonResponse(201, order));
    await expect(api.ingestEmail(email)).resolves.toEqual({
      order,
      created: true,
    });
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/emails`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(email),
    });

    fetchMock.mockResolvedValueOnce(jsonResponse(200, order));
    await expect(api.ingestEmail(email)).resolves.toEqual({
      order,
      created: false,
    });
  });

  it('turns a refusal into an ApiError carrying the status and the reason', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(409, {
        message: 'Order 1 is approved; only held orders can be reviewed',
        error: 'Conflict',
        statusCode: 409,
      }),
    );

    const error = await api.getOrder('1').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(409);
    expect((error as ApiError).message).toBe(
      'Order 1 is approved; only held orders can be reviewed',
    );
  });

  it('joins the list of problems a failed validation returns', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, {
        message: [
          'equipmentType: Invalid option',
          'commodities.0.quantity: Invalid input: expected int, received number',
        ],
        error: 'Bad Request',
        statusCode: 400,
      }),
    );

    const error = await api.listOrders().catch((caught: unknown) => caught);
    expect((error as ApiError).status).toBe(400);
    expect((error as ApiError).message).toBe(
      'equipmentType: Invalid option; commodities.0.quantity: Invalid input: expected int, received number',
    );
  });

  it('keeps the status when an error answer is not JSON', async () => {
    fetchMock.mockResolvedValue(
      new Response('<html>Bad Gateway</html>', { status: 502 }),
    );

    const error = await api.listOrders().catch((caught: unknown) => caught);
    expect((error as ApiError).status).toBe(502);
    expect((error as ApiError).message).toBe(
      'The API answered with status 502.',
    );
  });

  it('reports status 0 and where it tried when no answer arrives at all', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    const error = await api.listOrders().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(0);
    expect((error as ApiError).message).toContain(BASE);
  });
});

describe('messageFrom', () => {
  it('falls back to the status when the body has no usable message', () => {
    expect(messageFrom(null, 500)).toBe('The API answered with status 500.');
    expect(messageFrom({ message: '' }, 500)).toBe(
      'The API answered with status 500.',
    );
    expect(messageFrom({ message: [] }, 400)).toBe(
      'The API answered with status 400.',
    );
    expect(messageFrom('nope', 404)).toBe('The API answered with status 404.');
  });
});
