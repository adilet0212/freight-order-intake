import {
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Why three tables and one JSON column:
 * - Orders, stops and commodities have a fixed shape and are queried by column
 *   (the review queue filters on status), so they are relational with foreign keys.
 * - raw_extraction is the model's answer exactly as returned. Its shape changes with
 *   the prompt version and it is only ever read whole, for audit, so it is JSONB.
 */
export const orders = pgTable(
  'orders',
  {
    id: uuid().primaryKey().defaultRandom(),
    status: text().notNull(),
    reviewReasons: text('review_reasons').array().notNull(),

    // The email's Message-ID header, or a hash of the email when there is none.
    messageId: text('message_id').notNull(),
    emailSubject: text('email_subject').notNull(),
    emailBody: text('email_body').notNull(),
    emailReceivedAt: timestamp('email_received_at', {
      withTimezone: true,
      mode: 'string',
    }).notNull(),

    customerName: text('customer_name'),
    referenceNumber: text('reference_number'),
    equipmentType: text('equipment_type'),
    rateAmount: numeric('rate_amount', {
      precision: 10,
      scale: 2,
      mode: 'number',
    }),
    rateCurrency: text('rate_currency'),
    specialInstructions: text('special_instructions'),

    rawExtraction: jsonb('raw_extraction'),
    promptVersion: text('prompt_version').notNull(),
    latencyMs: integer('latency_ms').notNull(),
    inputTokens: integer('input_tokens').notNull(),
    outputTokens: integer('output_tokens').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    reviewedAt: timestamp('reviewed_at', {
      withTimezone: true,
      mode: 'string',
    }),
  },
  (table) => [
    // The review queue reads "status = needs_review, oldest first".
    index('orders_status_created_at_idx').on(table.status, table.createdAt),
    // The same email must never become two orders, even if two requests race.
    // Only the database can guarantee that, so it is a unique index, not an if-statement.
    uniqueIndex('orders_message_id_key').on(table.messageId),
  ],
);

export const stops = pgTable(
  'stops',
  {
    id: uuid().primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    sequence: integer().notNull(),
    type: text().notNull(),
    companyName: text('company_name'),
    street: text(),
    city: text(),
    region: text(),
    postalCode: text('postal_code'),
    // Wall-clock time at the dock. The email does not say the time zone, so this is
    // "timestamp without time zone" on purpose: storing a zone would be inventing one.
    windowStart: timestamp('window_start', {
      withTimezone: false,
      mode: 'string',
    }),
    windowEnd: timestamp('window_end', { withTimezone: false, mode: 'string' }),
  },
  (table) => [index('stops_order_id_idx').on(table.orderId)],
);

export const commodities = pgTable(
  'commodities',
  {
    id: uuid().primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    sequence: integer().notNull(),
    description: text(),
    quantity: integer(),
    commodityType: text('commodity_type'),
    weightLbs: integer('weight_lbs'),
  },
  (table) => [index('commodities_order_id_idx').on(table.orderId)],
);

export type OrderRow = typeof orders.$inferSelect;
export type StopRow = typeof stops.$inferSelect;
export type CommodityRow = typeof commodities.$inferSelect;
