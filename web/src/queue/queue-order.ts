import type { OrderRow } from '../api/types.js';
import { parseTimestamp } from '../format.js';
import { ORDER_STATUSES, type OrderStatus } from '../shared.js';

/**
 * The statuses a person still has to act on. These are exactly the two the API accepts a
 * review for (OrdersService.approve); every other status is finished.
 */
export function isHeld(status: OrderStatus): boolean {
  return status === 'needs_review' || status === 'extraction_failed';
}

export const STATUS_LABELS: Record<OrderStatus, string> = {
  needs_review: 'Needs review',
  extraction_failed: 'Extraction failed',
  auto_accepted: 'Auto-accepted',
  approved: 'Approved',
  not_an_order: 'Not an order',
};

/** The order the filter shows statuses in: what needs work first. */
export const FILTER_ORDER: readonly OrderStatus[] = [
  'needs_review',
  'extraction_failed',
  'auto_accepted',
  'approved',
  'not_an_order',
];

/** The status named in the address, or null (meaning "all") for none or an unknown one. */
export function parseStatusFilter(value: string | null): OrderStatus | null {
  return ORDER_STATUSES.includes(value as OrderStatus)
    ? (value as OrderStatus)
    : null;
}

function createdMillis(order: OrderRow): number {
  return parseTimestamp(order.createdAt)?.getTime() ?? 0;
}

/**
 * Held orders come first, the one that has waited longest at the top, so the queue is
 * worked oldest first (the same order GET /orders?status=needs_review uses). Finished
 * orders follow, newest first, because there the recent ones are the ones looked for.
 */
export function compareQueue(a: OrderRow, b: OrderRow): number {
  const aHeld = isHeld(a.status);
  const bHeld = isHeld(b.status);
  if (aHeld !== bHeld) return aHeld ? -1 : 1;
  const byAge = createdMillis(a) - createdMillis(b);
  if (byAge !== 0) return aHeld ? byAge : -byAge;
  // Two orders stored in the same microsecond: any fixed order, so rows do not jump.
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function sortQueue<T extends { order: OrderRow }>(entries: T[]): T[] {
  return [...entries].sort((a, b) => compareQueue(a.order, b.order));
}

export function filterQueue<T extends { order: OrderRow }>(
  entries: T[],
  status: OrderStatus | null,
): T[] {
  return status
    ? entries.filter((entry) => entry.order.status === status)
    : entries;
}

export function countByStatus(
  entries: Array<{ order: OrderRow }>,
): Record<OrderStatus, number> {
  const counts: Record<OrderStatus, number> = {
    needs_review: 0,
    extraction_failed: 0,
    auto_accepted: 0,
    approved: 0,
    not_an_order: 0,
  };
  for (const entry of entries) counts[entry.order.status] += 1;
  return counts;
}
