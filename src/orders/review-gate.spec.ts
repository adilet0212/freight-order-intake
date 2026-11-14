import { cleanExtractedOrder } from '../../test/fixtures/extracted-order.js';
import { normalizeOrder } from './normalize.js';
import type { ExtractedOrder } from './order.schema.js';
import { MAX_PAYLOAD_LBS, reviewGate } from './review-gate.js';

/** Runs an extracted order through normalize and the gate, as the service does. */
function gate(extracted: ExtractedOrder) {
  const { order, issues } = normalizeOrder(extracted);
  return reviewGate({
    isOrderRequest: extracted.isOrderRequest,
    order,
    normalizeIssues: issues,
    ambiguities: extracted.ambiguities,
  });
}

describe('reviewGate', () => {
  it('accepts a complete, unambiguous order', () => {
    expect(gate(cleanExtractedOrder())).toEqual({
      status: 'auto_accepted',
      reasons: [],
    });
  });

  it('marks a non-order email and gives no reasons', () => {
    const decision = gate(
      cleanExtractedOrder({
        isOrderRequest: false,
        stops: [],
        commodities: [],
      }),
    );
    expect(decision).toEqual({ status: 'not_an_order', reasons: [] });
  });

  it('holds an order with no delivery stop', () => {
    const extracted = cleanExtractedOrder();
    extracted.stops = [extracted.stops[0]];
    expect(gate(extracted)).toEqual({
      status: 'needs_review',
      reasons: ['No delivery stop'],
    });
  });

  it('holds an order with no pickup stop', () => {
    const extracted = cleanExtractedOrder();
    extracted.stops = [extracted.stops[1]];
    expect(gate(extracted)).toEqual({
      status: 'needs_review',
      reasons: ['No pickup stop'],
    });
  });

  it('holds an order when a stop has no city', () => {
    const extracted = cleanExtractedOrder();
    extracted.stops[1].city = null;
    expect(gate(extracted).reasons).toEqual(['Stop 2: city or region missing']);
  });

  it('holds an order with no pickup date', () => {
    const extracted = cleanExtractedOrder();
    extracted.stops[0].windowStart = null;
    expect(gate(extracted).reasons).toEqual(['Pickup date missing']);
  });

  it('holds an order whose delivery is before its pickup', () => {
    const extracted = cleanExtractedOrder();
    extracted.stops[1].windowStart = '2026-11-16T09:00';
    expect(gate(extracted).reasons).toEqual(['Delivery is before pickup']);
  });

  it('accepts a delivery at the same minute as the pickup (boundary)', () => {
    const extracted = cleanExtractedOrder();
    extracted.stops[1].windowStart = extracted.stops[0].windowStart;
    expect(gate(extracted).status).toBe('auto_accepted');
  });

  it('holds an order with no commodities', () => {
    expect(gate(cleanExtractedOrder({ commodities: [] })).reasons).toEqual([
      'No commodities',
    ]);
  });

  it('holds an order when a weight is missing', () => {
    const extracted = cleanExtractedOrder();
    extracted.commodities[0].weightValue = null;
    extracted.commodities[0].weightUnit = null;
    expect(gate(extracted).reasons).toEqual(['Commodity weight missing']);
  });

  it('accepts exactly one truckload and holds one pound more (boundary)', () => {
    const atLimit = cleanExtractedOrder();
    atLimit.commodities[0].weightValue = MAX_PAYLOAD_LBS;
    expect(gate(atLimit).status).toBe('auto_accepted');

    const overLimit = cleanExtractedOrder();
    overLimit.commodities[0].weightValue = MAX_PAYLOAD_LBS + 1;
    expect(gate(overLimit).reasons).toEqual([
      'Total weight 45001 lbs is over one truckload (45000 lbs)',
    ]);
  });

  it('adds commodity weights together before checking the limit', () => {
    const extracted = cleanExtractedOrder();
    extracted.commodities = [
      { ...extracted.commodities[0], weightValue: 30000 },
      { ...extracted.commodities[0], weightValue: 30000 },
    ];
    expect(gate(extracted).status).toBe('needs_review');
  });

  it('holds an order the model itself called ambiguous', () => {
    const decision = gate(
      cleanExtractedOrder({ ambiguities: ['Two different PO numbers appear'] }),
    );
    expect(decision.reasons).toEqual([
      'Model flagged: Two different PO numbers appear',
    ]);
  });

  it('passes problems from normalize through as reasons', () => {
    const extracted = cleanExtractedOrder();
    extracted.stops[1].windowEnd = 'end of day';
    expect(gate(extracted).reasons).toEqual([
      'Stop 2: window end "end of day" is not a valid date',
    ]);
  });

  it('lists every reason when several rules fire', () => {
    const extracted = cleanExtractedOrder({ commodities: [] });
    extracted.stops = [extracted.stops[0]];
    expect(gate(extracted).reasons).toEqual([
      'No delivery stop',
      'No commodities',
    ]);
  });
});
