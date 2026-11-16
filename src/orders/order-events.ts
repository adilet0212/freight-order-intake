import type { OrderStatus } from './order.schema.js';

/**
 * The events the API pushes to connected web clients.
 *
 * This file imports no framework code, so the gateway, the API tests and the web app can all
 * import the same names and shapes.
 *
 * A payload is only an id and a status, on purpose. An event is a hint that an order
 * changed; the client then reads that order through GET /orders/:id. REST stays the one
 * source of truth, a late or repeated event cannot leave stale data on screen, and email
 * text never travels over the socket.
 */
export const ORDER_CREATED = 'order.created';
export const ORDER_APPROVED = 'order.approved';

/** A new email was stored as an order. Not sent for a repeated email. */
export interface OrderCreatedEvent {
  id: string;
  status: OrderStatus;
}

/** A reviewer saved a held order. */
export interface OrderApprovedEvent {
  id: string;
  status: 'approved';
}

export interface OrderEvents {
  [ORDER_CREATED]: OrderCreatedEvent;
  [ORDER_APPROVED]: OrderApprovedEvent;
}
