// Test-only imports from the API's source: the real rule functions, used to produce
// every reason they can write, so this file fails when a rule has no wording.
import { normalizeOrder } from '../../../src/orders/normalize.js';
import type { ExtractedOrder } from '../../../src/orders/order.schema.js';
import { MAX_PAYLOAD_LBS, type NormalizedOrder } from '../shared.js';
import { makeOrder } from '../test/fakes.js';
import { explainReason, gateReasons, reasonItems } from './hold-reasons.js';
import { orderContent } from './order-form.js';

const clean = orderContent(makeOrder());

function withChange(change: (order: NormalizedOrder) => void): NormalizedOrder {
  const order = structuredClone(clean);
  change(order);
  return order;
}

const noDelivery = withChange((order) => {
  order.stops = [order.stops[0]];
});

describe('explainReason', () => {
  it('has plain wording for every reason the review gate can write', () => {
    const broken = [
      withChange((order) => {
        order.stops = [];
        order.commodities = [];
      }),
      withChange((order) => {
        order.stops[0].city = null;
        order.stops[0].windowStart = null;
        order.commodities[0].weightLbs = null;
      }),
      withChange((order) => {
        order.stops[1].windowStart = '2026-11-16T09:00';
        order.commodities[0].weightLbs = MAX_PAYLOAD_LBS + 1;
      }),
    ];
    const reasons = [...new Set(broken.flatMap(gateReasons))];

    // The gate has eight rules of its own. If this count changes, a rule was added or
    // removed in review-gate.ts and the wording in hold-reasons.ts must be revisited.
    expect(reasons).toEqual([
      'No pickup stop',
      'No delivery stop',
      'No commodities',
      'Stop 1: city or region missing',
      'Pickup date missing',
      'Commodity weight missing',
      'Delivery is before pickup',
      'Total weight 45001 lbs is over one truckload (45000 lbs)',
    ]);
    for (const reason of reasons) {
      const { text } = explainReason(reason);
      expect(text, reason).not.toBe(reason);
      expect(text.length, reason).toBeGreaterThan(reason.length);
    }
  });

  it('has plain wording for every problem normalize.ts can report', () => {
    const extracted: ExtractedOrder = {
      isOrderRequest: true,
      customerName: 'Maple Ridge Foods',
      referenceNumber: null,
      equipmentType: null,
      stops: [
        {
          type: 'pickup',
          companyName: null,
          street: null,
          city: 'Brampton',
          region: 'ON',
          postalCode: null,
          windowStart: 'next Tuesday',
          windowEnd: '2026-02-30T08:00',
        },
      ],
      commodities: [
        {
          description: null,
          quantity: 2.5,
          commodityType: null,
          weightValue: 500,
          weightUnit: null,
        },
      ],
      rateAmount: null,
      rateCurrency: null,
      specialInstructions: null,
      ambiguities: [],
    };
    const { issues } = normalizeOrder(extracted);

    expect(issues).toEqual([
      'Stop 1: window start "next Tuesday" is not a valid date',
      'Stop 1: window end "2026-02-30T08:00" is not a valid date',
      'Commodity 1: weight 500 has no usable unit',
      'Commodity 1: quantity 2.5 is not a whole number',
    ]);
    for (const issue of issues) {
      expect(explainReason(issue).text, issue).not.toBe(issue);
    }
    expect(explainReason(issues[0]).text).toContain('"next Tuesday"');
    expect(explainReason(issues[2]).text).toContain('Freight line 1');
  });

  it('words a model ambiguity as an unclear email and keeps what the model said', () => {
    expect(explainReason('Model flagged: Two PO numbers are given.').text).toBe(
      'The email is unclear: Two PO numbers are given.',
    );
  });

  it('explains a failed extraction and keeps the technical message as detail', () => {
    const explained = explainReason(
      'Model output did not match the schema: isOrderRequest: expected boolean',
    );
    expect(explained.text).toContain('could not be read');
    expect(explained.detail).toBe('isOrderRequest: expected boolean');
  });

  it('writes the weights with thousands separators', () => {
    expect(
      explainReason('Total weight 48000 lbs is over one truckload (45000 lbs)')
        .text,
    ).toContain('48,000 lbs, more than one truckload (45,000 lbs)');
  });

  it('shows a reason it does not know exactly as it is', () => {
    expect(explainReason('Hazmat class missing')).toEqual({
      text: 'Hazmat class missing',
      detail: null,
    });
  });
});

describe('reasonItems', () => {
  it('marks a gate rule open while it still fires and fixed once the edit resolves it', () => {
    const stored = ['No delivery stop'];

    expect(reasonItems(stored, noDelivery, noDelivery)).toEqual([
      {
        key: 'No delivery stop',
        text: 'There is no delivery stop. Add where the freight is going.',
        detail: null,
        state: 'open',
      },
    ]);
    expect(
      reasonItems(stored, noDelivery, clean).map((item) => item.state),
    ).toEqual(['fixed']);
  });

  it('marks what only a person can settle as "check", whatever is edited', () => {
    const stored = [
      'Stop 1: window start "next Tuesday" is not a valid date',
      'Model flagged: Two PO numbers are given.',
    ];
    for (const draft of [clean, noDelivery]) {
      expect(
        reasonItems(stored, clean, draft)
          .filter((item) => stored.includes(item.key))
          .map((item) => item.state),
      ).toEqual(['check', 'check']);
    }
  });

  it('adds a rule the edit itself has broken, as open', () => {
    const items = reasonItems(
      ['Model flagged: Two PO numbers are given.'],
      clean,
      noDelivery,
    );
    expect(items.map((item) => [item.key, item.state])).toEqual([
      ['Model flagged: Two PO numbers are given.', 'check'],
      ['No delivery stop', 'open'],
    ]);
  });

  it('keeps the total-weight reason as one item and shows the current weight', () => {
    const heavy = (weightLbs: number) =>
      withChange((order) => {
        order.commodities[0].weightLbs = weightLbs;
      });
    const stored = ['Total weight 48000 lbs is over one truckload (45000 lbs)'];

    const stillOver = reasonItems(stored, heavy(48000), heavy(46000));
    expect(stillOver).toHaveLength(1);
    expect(stillOver[0].state).toBe('open');
    expect(stillOver[0].text).toContain('46,000 lbs');

    // Exactly one truckload is allowed by the gate, so the reason is fixed at 45,000.
    const atLimit = reasonItems(stored, heavy(48000), heavy(MAX_PAYLOAD_LBS));
    expect(atLimit).toHaveLength(1);
    expect(atLimit[0].state).toBe('fixed');
    expect(atLimit[0].text).toContain('48,000 lbs');
  });

  it('lists what an order with a failed extraction still needs', () => {
    const empty: NormalizedOrder = {
      ...clean,
      customerName: null,
      stops: [],
      commodities: [],
    };
    const items = reasonItems(
      ['Model output did not match the schema: expected boolean'],
      empty,
      empty,
    );
    expect(items.map((item) => [item.key, item.state])).toEqual([
      ['Model output did not match the schema: expected boolean', 'check'],
      ['No pickup stop', 'open'],
      ['No delivery stop', 'open'],
      ['No commodities', 'open'],
    ]);
  });
});
