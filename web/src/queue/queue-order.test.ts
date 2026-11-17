import type { OrderRow } from '../api/types.js';
import { makeOrder, rowOf } from '../test/fakes.js';
import {
  compareQueue,
  countByStatus,
  filterQueue,
  isHeld,
  parseStatusFilter,
  sortQueue,
} from './queue-order.js';

function row(overrides: Partial<OrderRow>): OrderRow {
  return { ...rowOf(makeOrder()), ...overrides };
}

describe('isHeld', () => {
  it('is true for the two statuses the API accepts a review for, and no other', () => {
    expect(isHeld('needs_review')).toBe(true);
    expect(isHeld('extraction_failed')).toBe(true);
    expect(isHeld('auto_accepted')).toBe(false);
    expect(isHeld('approved')).toBe(false);
    expect(isHeld('not_an_order')).toBe(false);
  });
});

describe('sortQueue', () => {
  const heldOld = row({
    status: 'needs_review',
    createdAt: '2026-11-16 09:00:00-05',
  });
  const heldNew = row({
    status: 'extraction_failed',
    createdAt: '2026-11-16 11:00:00-05',
  });
  const doneOld = row({
    status: 'auto_accepted',
    createdAt: '2026-11-16 08:00:00-05',
  });
  const doneNew = row({
    status: 'approved',
    createdAt: '2026-11-16 12:00:00-05',
  });

  it('puts held orders first, even when a finished order is older or newer', () => {
    const sorted = sortQueue(
      [doneNew, heldNew, doneOld, heldOld].map((order) => ({ order })),
    ).map((entry) => entry.order);
    expect(sorted).toEqual([heldOld, heldNew, doneNew, doneOld]);
  });

  it('lists held orders oldest first and finished orders newest first', () => {
    expect(compareQueue(heldOld, heldNew)).toBeLessThan(0);
    expect(compareQueue(doneNew, doneOld)).toBeLessThan(0);
  });

  it('compares times, not text: an earlier clock time in another zone can be later', () => {
    // 09:30 at UTC-8 is 17:30 UTC, which is after 11:00 at UTC-5 (16:00 UTC).
    const west = row({
      status: 'needs_review',
      createdAt: '2026-11-16 09:30:00-08',
    });
    expect(compareQueue(heldNew, west)).toBeLessThan(0);
  });

  it('breaks an exact tie by id, so rows keep a fixed order', () => {
    const a = row({
      id: 'a',
      status: 'approved',
      createdAt: '2026-11-16 12:00:00-05',
    });
    const b = row({
      id: 'b',
      status: 'approved',
      createdAt: '2026-11-16 12:00:00-05',
    });
    expect(compareQueue(a, b)).toBeLessThan(0);
    expect(compareQueue(b, a)).toBeGreaterThan(0);
    expect(compareQueue(a, a)).toBe(0);
  });

  it('does not change the list it was given', () => {
    const entries = [{ order: doneNew }, { order: heldOld }];
    sortQueue(entries);
    expect(entries.map((entry) => entry.order)).toEqual([doneNew, heldOld]);
  });
});

describe('parseStatusFilter', () => {
  it('accepts each real status and reads anything else as no filter', () => {
    expect(parseStatusFilter('needs_review')).toBe('needs_review');
    expect(parseStatusFilter('approved')).toBe('approved');
    expect(parseStatusFilter(null)).toBeNull();
    expect(parseStatusFilter('')).toBeNull();
    expect(parseStatusFilter('shipped')).toBeNull();
  });
});

describe('filterQueue and countByStatus', () => {
  const entries = [
    { order: row({ status: 'needs_review' }) },
    { order: row({ status: 'needs_review' }) },
    { order: row({ status: 'approved' }) },
  ];

  it('keeps only the chosen status, or everything when none is chosen', () => {
    expect(filterQueue(entries, 'needs_review')).toHaveLength(2);
    expect(filterQueue(entries, 'not_an_order')).toHaveLength(0);
    expect(filterQueue(entries, null)).toHaveLength(3);
  });

  it('counts every status, including the ones with no orders', () => {
    expect(countByStatus(entries)).toEqual({
      needs_review: 2,
      extraction_failed: 0,
      auto_accepted: 0,
      approved: 1,
      not_an_order: 0,
    });
  });
});
