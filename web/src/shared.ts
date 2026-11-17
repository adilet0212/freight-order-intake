/**
 * The only file in web/ that reaches into the API's source.
 *
 * Everything re-exported here is pure: these files import nothing but zod and each other's
 * types, so they run in a browser unchanged. Importing them, instead of copying them,
 * means the web app validates with the same schema the API validates with, runs the same
 * review-gate rules, and uses the same event names. A change to a rule changes both sides.
 *
 * Do not add anything here that imports Nest, Drizzle or Node.
 */
export {
  COMMODITY_TYPES,
  CURRENCIES,
  EQUIPMENT_TYPES,
  inboundEmailSchema,
  normalizedOrderSchema,
  ORDER_STATUSES,
  STOP_TYPES,
  type InboundEmail,
  type NormalizedOrder,
  type OrderStatus,
} from '../../src/orders/order.schema.js';
export {
  ORDER_APPROVED,
  ORDER_CREATED,
  ORDER_REEXTRACTED,
  type OrderApprovedEvent,
  type OrderCreatedEvent,
  type OrderReextractedEvent,
} from '../../src/orders/order-events.js';
export { MAX_PAYLOAD_LBS, reviewGate } from '../../src/orders/review-gate.js';
export { parseLocalDateTime } from '../../src/orders/normalize.js';
