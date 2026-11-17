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
export const ORDER_REEXTRACTED = 'order.reextracted';

/** A new email was stored as an order. Not sent for a repeated email. */
export interface OrderCreatedEvent {
  id: string;
  status: OrderStatus;
}

/**
 * A re-sent email was extracted again and replaced an extraction_failed order. Same id, new
 * content and usually a new status (it can still be extraction_failed, if the model's answer
 * again did not match the schema). Not sent when the re-send changed nothing: another
 * outage, an order that was not failed, or the second of two re-sends at the same moment.
 */
export interface OrderReextractedEvent {
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
  [ORDER_REEXTRACTED]: OrderReextractedEvent;
}
