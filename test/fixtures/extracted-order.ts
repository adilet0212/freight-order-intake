import type { ExtractedOrder } from '../../src/orders/order.schema.js';

/** A complete, unambiguous order: the gate should accept it as-is. */
export function cleanExtractedOrder(
  overrides: Partial<ExtractedOrder> = {},
): ExtractedOrder {
  return {
    isOrderRequest: true,
    customerName: 'Maple Ridge Foods',
    referenceNumber: 'PO-48213',
    equipmentType: 'dry_van',
    stops: [
      {
        type: 'pickup',
        companyName: 'Maple Ridge Foods',
        street: '120 Industrial Rd',
        city: 'Brampton',
        region: 'on',
        postalCode: 'l6t 4x3',
        windowStart: '2026-11-17T08:00',
        windowEnd: '2026-11-17T12:00',
      },
      {
        type: 'delivery',
        companyName: 'Lakeshore Grocers DC',
        street: '4500 W 47th St',
        city: 'Chicago',
        region: 'IL',
        postalCode: '60632',
        windowStart: '2026-11-18T09:00',
        windowEnd: null,
      },
    ],
    commodities: [
      {
        description: 'Canned goods',
        quantity: 18,
        commodityType: 'skid',
        weightValue: 21600,
        weightUnit: 'lbs',
      },
    ],
    rateAmount: 1850,
    rateCurrency: 'USD',
    specialInstructions: null,
    ambiguities: [],
    ...overrides,
  };
}
