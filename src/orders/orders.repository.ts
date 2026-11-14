import { Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { asc, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { commodities, orders, stops, type OrderRow } from '../db/schema.js';
import type { NormalizedOrder, OrderStatus } from './order.schema.js';

export interface NewOrder {
  status: OrderStatus;
  reviewReasons: string[];
  messageId: string;
  emailSubject: string;
  emailBody: string;
  emailReceivedAt: string;
  order: NormalizedOrder | null;
  rawExtraction: unknown;
  promptVersion: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
}

export interface OrderView extends OrderRow {
  stops: NormalizedOrder['stops'];
  commodities: NormalizedOrder['commodities'];
}

type Db = NodePgDatabase;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

@Injectable()
export class OrdersRepository {
  constructor(@InjectDrizzle() private readonly db: Db) {}

  /**
   * Inserts the order with its stops and commodities in one transaction, so a crash
   * half-way never leaves an order without its stops.
   * Returns null if an order for this messageId already exists (see the unique index).
   */
  async create(input: NewOrder): Promise<string | null> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(orders)
        .values({
          status: input.status,
          reviewReasons: input.reviewReasons,
          messageId: input.messageId,
          emailSubject: input.emailSubject,
          emailBody: input.emailBody,
          emailReceivedAt: input.emailReceivedAt,
          ...orderColumns(input.order),
          rawExtraction: input.rawExtraction,
          promptVersion: input.promptVersion,
          latencyMs: input.latencyMs,
          inputTokens: input.inputTokens,
          outputTokens: input.outputTokens,
        })
        .onConflictDoNothing({ target: orders.messageId })
        .returning({ id: orders.id });
      if (!row) return null;
      if (input.order) await insertChildren(tx, row.id, input.order);
      return row.id;
    });
  }

  async findIdByMessageId(messageId: string): Promise<string | undefined> {
    const [row] = await this.db
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.messageId, messageId));
    return row?.id;
  }

  async findById(id: string): Promise<OrderView | undefined> {
    const [order] = await this.db
      .select()
      .from(orders)
      .where(eq(orders.id, id));
    if (!order) return undefined;
    const [stopRows, commodityRows] = await Promise.all([
      this.db
        .select()
        .from(stops)
        .where(eq(stops.orderId, id))
        .orderBy(asc(stops.sequence)),
      this.db
        .select()
        .from(commodities)
        .where(eq(commodities.orderId, id))
        .orderBy(asc(commodities.sequence)),
    ]);
    return {
      ...order,
      stops: stopRows.map((stop) => ({
        type: stop.type as 'pickup' | 'delivery',
        companyName: stop.companyName,
        street: stop.street,
        city: stop.city,
        region: stop.region,
        postalCode: stop.postalCode,
        windowStart: toLocalMinute(stop.windowStart),
        windowEnd: toLocalMinute(stop.windowEnd),
      })),
      commodities: commodityRows.map((commodity) => ({
        description: commodity.description,
        quantity: commodity.quantity,
        commodityType:
          commodity.commodityType as NormalizedOrder['commodities'][number]['commodityType'],
        weightLbs: commodity.weightLbs,
      })),
    };
  }

  /** The review queue: oldest first, served by the (status, created_at) index. */
  list(status?: OrderStatus): Promise<OrderRow[]> {
    const query = this.db.select().from(orders);
    return (status ? query.where(eq(orders.status, status)) : query).orderBy(
      asc(orders.createdAt),
    );
  }

  /** Replaces the order's content with the reviewer's corrected version. */
  async approve(id: string, corrected: NormalizedOrder): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(orders)
        .set({
          status: 'approved',
          reviewedAt: new Date().toISOString(),
          ...orderColumns(corrected),
        })
        .where(eq(orders.id, id));
      await tx.delete(stops).where(eq(stops.orderId, id));
      await tx.delete(commodities).where(eq(commodities.orderId, id));
      await insertChildren(tx, id, corrected);
    });
  }
}

function orderColumns(order: NormalizedOrder | null) {
  return {
    customerName: order?.customerName ?? null,
    referenceNumber: order?.referenceNumber ?? null,
    equipmentType: order?.equipmentType ?? null,
    rateAmount: order?.rateAmount ?? null,
    rateCurrency: order?.rateCurrency ?? null,
    specialInstructions: order?.specialInstructions ?? null,
  };
}

async function insertChildren(
  tx: Tx,
  orderId: string,
  order: NormalizedOrder,
): Promise<void> {
  if (order.stops.length > 0) {
    await tx
      .insert(stops)
      .values(
        order.stops.map((stop, sequence) => ({ ...stop, orderId, sequence })),
      );
  }
  if (order.commodities.length > 0) {
    await tx
      .insert(commodities)
      .values(
        order.commodities.map((commodity, sequence) => ({
          ...commodity,
          orderId,
          sequence,
        })),
      );
  }
}

/** Postgres returns "2026-11-17 08:00:00"; the API speaks "2026-11-17T08:00". */
function toLocalMinute(value: string | null): string | null {
  return value ? value.replace(' ', 'T').slice(0, 16) : null;
}
