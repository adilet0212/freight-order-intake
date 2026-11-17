import { Logger } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { allowedWebOrigins } from '../web-origin.js';
import {
  ORDER_APPROVED,
  ORDER_CREATED,
  ORDER_REEXTRACTED,
  type OrderEvents,
} from './order-events.js';
import type { OrderStatus } from './order.schema.js';

/** All this gateway needs from the Socket.IO server: send one event to every client. */
export interface Broadcaster {
  emit(event: string, payload: unknown): unknown;
}

/**
 * Tells connected web clients that an order was created, re-extracted or approved, so the
 * review queue updates without a refresh. It only sends: there are no message handlers, so clients
 * cannot push anything into the API through the socket.
 */
@WebSocketGateway({
  cors: {
    // A function, not a value: this decorator runs when the file is imported, which is
    // before ConfigModule has loaded .env. The function is called per connection instead.
    origin: (_requestOrigin, callback) => callback(null, allowedWebOrigins()),
  },
})
export class OrdersGateway {
  private readonly logger = new Logger(OrdersGateway.name);

  /** Assigned by Nest once the socket server exists. Absent where there is none. */
  @WebSocketServer()
  server?: Broadcaster;

  orderCreated(order: { id: string; status: string }): void {
    this.broadcast(ORDER_CREATED, {
      id: order.id,
      // The column is text, but the repository only ever writes an OrderStatus into it.
      status: order.status as OrderStatus,
    });
  }

  orderReextracted(order: { id: string; status: string }): void {
    this.broadcast(ORDER_REEXTRACTED, {
      id: order.id,
      status: order.status as OrderStatus,
    });
  }

  orderApproved(order: { id: string }): void {
    this.broadcast(ORDER_APPROVED, { id: order.id, status: 'approved' });
  }

  /**
   * By the time this runs the order is already stored, so a failure here must never fail
   * the request: the caller would see an error for an email that was in fact saved.
   */
  private broadcast<E extends keyof OrderEvents>(
    event: E,
    payload: OrderEvents[E],
  ): void {
    try {
      this.server?.emit(event, payload);
    } catch (error) {
      this.logger.error(
        `Could not send ${event} for order ${payload.id}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
