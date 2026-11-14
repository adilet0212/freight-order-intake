import type { NormalizedOrder, OrderStatus } from './order.schema.js';

/**
 * Above this total weight the order goes to review instead of being rejected,
 * because a heavy order can be legitimate (several trucks, or a typo to fix).
 * 45,000 lbs is roughly the most a 53-ft dry van carries under the US 80,000 lb
 * gross vehicle limit. DECISION-3 in SPEC.md: Adilet to confirm the number.
 */
export const MAX_PAYLOAD_LBS = 45_000;

export interface GateInput {
  isOrderRequest: boolean;
  order: NormalizedOrder;
  /** Problems normalize.ts found (bad dates, weights with no unit). */
  normalizeIssues: string[];
  /** Details the model itself said were unclear. */
  ambiguities: string[];
}

export interface GateDecision {
  status: Extract<
    OrderStatus,
    'auto_accepted' | 'needs_review' | 'not_an_order'
  >;
  reasons: string[];
}

/**
 * Decides whether an extracted order is safe to accept without a person looking at it.
 * Every rule is plain code, not a model score: a model's confidence in its own answer
 * is not calibrated, but "there is no delivery stop" is checkable.
 */
export function reviewGate(input: GateInput): GateDecision {
  if (!input.isOrderRequest) return { status: 'not_an_order', reasons: [] };

  const { order } = input;
  const reasons = [...input.normalizeIssues];

  const pickups = order.stops.filter((stop) => stop.type === 'pickup');
  const deliveries = order.stops.filter((stop) => stop.type === 'delivery');
  if (pickups.length === 0) reasons.push('No pickup stop');
  if (deliveries.length === 0) reasons.push('No delivery stop');

  order.stops.forEach((stop, index) => {
    if (!stop.city || !stop.region)
      reasons.push(`Stop ${index + 1}: city or region missing`);
  });

  const firstPickup = pickups[0];
  if (firstPickup && !firstPickup.windowStart)
    reasons.push('Pickup date missing');

  // Both values are YYYY-MM-DDTHH:mm, so comparing the strings compares the times.
  // They are local times, so a same-day run across a time zone can trip this rule.
  // That costs one review, which is the safe side to err on.
  const lastDelivery = deliveries.at(-1);
  if (
    firstPickup?.windowStart &&
    lastDelivery?.windowStart &&
    lastDelivery.windowStart < firstPickup.windowStart
  ) {
    reasons.push('Delivery is before pickup');
  }

  if (order.commodities.length === 0) {
    reasons.push('No commodities');
  } else if (
    order.commodities.some((commodity) => commodity.weightLbs === null)
  ) {
    reasons.push('Commodity weight missing');
  } else {
    const totalLbs = order.commodities.reduce(
      (sum, c) => sum + (c.weightLbs ?? 0),
      0,
    );
    if (totalLbs > MAX_PAYLOAD_LBS) {
      reasons.push(
        `Total weight ${totalLbs} lbs is over one truckload (${MAX_PAYLOAD_LBS} lbs)`,
      );
    }
  }

  for (const ambiguity of input.ambiguities)
    reasons.push(`Model flagged: ${ambiguity}`);

  return {
    status: reasons.length === 0 ? 'auto_accepted' : 'needs_review',
    reasons,
  };
}
