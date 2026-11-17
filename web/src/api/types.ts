import type { NormalizedOrder, OrderStatus } from '../shared.js';

export type Stop = NormalizedOrder['stops'][number];
export type Commodity = NormalizedOrder['commodities'][number];

/**
 * One item of GET /orders: the order's own columns, without stops or commodities.
 * Timestamps are strings in the form Postgres prints them; see parseTimestamp in format.ts.
 */
export interface OrderRow {
  id: string;
  status: OrderStatus;
  reviewReasons: string[];
  messageId: string;
  emailSubject: string;
  emailBody: string;
  emailReceivedAt: string;
  customerName: string | null;
  referenceNumber: string | null;
  equipmentType: NormalizedOrder['equipmentType'];
  rateAmount: number | null;
  rateCurrency: NormalizedOrder['rateCurrency'];
  specialInstructions: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

/** GET /orders/:id, and the answer to POST /emails and PATCH /orders/:id/review. */
export interface Order extends OrderRow {
  stops: Stop[];
  commodities: Commodity[];
}
