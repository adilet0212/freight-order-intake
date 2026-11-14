import { cleanExtractedOrder } from '../../test/fixtures/extracted-order.js';
import { normalizeOrder, parseLocalDateTime, toLbs } from './normalize.js';

describe('toLbs', () => {
  it('keeps pounds as they are', () => {
    expect(toLbs(21600, 'lbs')).toBe(21600);
  });

  it('converts kilograms and rounds to the nearest pound', () => {
    expect(toLbs(1000, 'kg')).toBe(2205); // 2204.62
    expect(toLbs(9800, 'kg')).toBe(21605); // 21605.28
  });

  it('returns null when the unit or the value is missing', () => {
    expect(toLbs(500, null)).toBeNull();
    expect(toLbs(null, 'kg')).toBeNull();
  });

  it('returns null for zero and negative weights', () => {
    expect(toLbs(0, 'lbs')).toBeNull();
    expect(toLbs(-40, 'kg')).toBeNull();
  });
});

describe('parseLocalDateTime', () => {
  it('accepts YYYY-MM-DDTHH:mm', () => {
    expect(parseLocalDateTime('2026-11-17T08:00')).toBe('2026-11-17T08:00');
  });

  it.each([
    'Nov 17 8am',
    '2026-11-17',
    '2026-11-17T08:00:00Z',
    '17/11/2026 08:00',
    '',
  ])('rejects %j', (value) => {
    expect(parseLocalDateTime(value)).toBeNull();
  });

  it('rejects dates that do not exist', () => {
    expect(parseLocalDateTime('2026-02-30T08:00')).toBeNull();
    expect(parseLocalDateTime('2026-11-17T25:00')).toBeNull();
  });
});

describe('normalizeOrder', () => {
  it('upper-cases region and postal codes and trims text', () => {
    const { order, issues } = normalizeOrder(
      cleanExtractedOrder({ customerName: '  Maple Ridge Foods  ' }),
    );
    expect(order.customerName).toBe('Maple Ridge Foods');
    expect(order.stops[0].region).toBe('ON');
    expect(order.stops[0].postalCode).toBe('L6T 4X3');
    expect(issues).toEqual([]);
  });

  it('turns empty strings into null instead of storing blanks', () => {
    const { order } = normalizeOrder(
      cleanExtractedOrder({ referenceNumber: '   ' }),
    );
    expect(order.referenceNumber).toBeNull();
  });

  it('reports a date it cannot parse and stores null, not the bad text', () => {
    const extracted = cleanExtractedOrder();
    extracted.stops[0].windowStart = 'Tuesday morning';
    const { order, issues } = normalizeOrder(extracted);
    expect(order.stops[0].windowStart).toBeNull();
    expect(issues).toEqual([
      'Stop 1: window start "Tuesday morning" is not a valid date',
    ]);
  });

  it('reports a weight that has a number but no unit', () => {
    const extracted = cleanExtractedOrder();
    extracted.commodities[0].weightUnit = null;
    const { order, issues } = normalizeOrder(extracted);
    expect(order.commodities[0].weightLbs).toBeNull();
    expect(issues).toEqual(['Commodity 1: weight 21600 has no usable unit']);
  });

  it('reports a quantity that is not a whole number', () => {
    const extracted = cleanExtractedOrder();
    extracted.commodities[0].quantity = 2.5;
    const { order, issues } = normalizeOrder(extracted);
    expect(order.commodities[0].quantity).toBeNull();
    expect(issues).toEqual(['Commodity 1: quantity 2.5 is not a whole number']);
  });
});
