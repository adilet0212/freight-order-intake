import type { Stop } from '../api/types.js';

/** "Brampton, ON". Falls back to whichever half is known; null when neither is. */
export function placeName(stop: Pick<Stop, 'city' | 'region'>): string | null {
  if (stop.city && stop.region) return `${stop.city}, ${stop.region}`;
  return stop.city ?? stop.region ?? null;
}

export interface Lane {
  origin: string | null;
  destination: string | null;
}

/**
 * Where the load starts and ends: the first pickup and the last delivery. This is the
 * same definition the review gate uses for its date rule (src/orders/review-gate.ts).
 * Stops in between are not part of the lane.
 */
export function laneOf(stops: Stop[]): Lane {
  const firstPickup = stops.find((stop) => stop.type === 'pickup');
  const lastDelivery = stops.findLast((stop) => stop.type === 'delivery');
  return {
    origin: firstPickup ? placeName(firstPickup) : null,
    destination: lastDelivery ? placeName(lastDelivery) : null,
  };
}

/** "Brampton, ON → Chicago, IL". A missing end shows as "?". Empty when both are. */
export function formatLane(lane: Lane): string {
  if (!lane.origin && !lane.destination) return '';
  return `${lane.origin ?? '?'} → ${lane.destination ?? '?'}`;
}

/** The start of the first pickup's window, which is the order's pickup date. */
export function firstPickupStart(stops: Stop[]): string | null {
  return stops.find((stop) => stop.type === 'pickup')?.windowStart ?? null;
}
