import type { InboundEmail, NormalizedOrder } from '../shared.js';
import type { Order, OrderRow } from './types.js';

/** Where the API is. Set VITE_API_URL in web/.env.local to point somewhere else. */
export const API_URL = (
  (import.meta.env.VITE_API_URL as string | undefined) ??
  'http://localhost:3000'
).replace(/\/+$/, '');

/** A request that did not succeed. `status` is the HTTP status, or 0 if no answer came. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export interface Api {
  listOrders(): Promise<OrderRow[]>;
  getOrder(id: string): Promise<Order>;
  approveOrder(id: string, corrected: NormalizedOrder): Promise<Order>;
  /** `created` is false when the API had already stored this email (it answers 200). */
  ingestEmail(email: InboundEmail): Promise<{ order: Order; created: boolean }>;
}

/**
 * Nest puts the reason in `message`: a string for 404 and 409, and a list such as
 * ["body: Invalid input: expected string, received undefined"] for a failed validation.
 */
export function messageFrom(body: unknown, status: number): string {
  if (typeof body === 'object' && body !== null && 'message' in body) {
    const { message } = body;
    if (typeof message === 'string' && message.length > 0) return message;
    if (Array.isArray(message) && message.length > 0) {
      return message.map((item) => String(item)).join('; ');
    }
  }
  return `The API answered with status ${status}.`;
}

export function createApi(baseUrl: string = API_URL): Api {
  async function call(
    path: string,
    init?: { method: string; body: unknown },
  ): Promise<{ status: number; body: unknown }> {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method: init?.method ?? 'GET',
        headers: init
          ? { Accept: 'application/json', 'Content-Type': 'application/json' }
          : { Accept: 'application/json' },
        body: init ? JSON.stringify(init.body) : undefined,
      });
    } catch {
      // fetch rejects only when no answer arrived: the API is down, or CORS refused it.
      throw new ApiError(
        0,
        `Could not reach the API at ${baseUrl}. Check that it is running.`,
      );
    }
    // An error page from a proxy is not JSON; that must not hide the status.
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new ApiError(response.status, messageFrom(body, response.status));
    }
    return { status: response.status, body };
  }

  return {
    async listOrders() {
      return (await call('/orders')).body as OrderRow[];
    },
    async getOrder(id) {
      return (await call(`/orders/${encodeURIComponent(id)}`)).body as Order;
    },
    async approveOrder(id, corrected) {
      const { body } = await call(`/orders/${encodeURIComponent(id)}/review`, {
        method: 'PATCH',
        body: corrected,
      });
      return body as Order;
    },
    async ingestEmail(email) {
      const { status, body } = await call('/emails', {
        method: 'POST',
        body: email,
      });
      return { order: body as Order, created: status === 201 };
    },
  };
}
