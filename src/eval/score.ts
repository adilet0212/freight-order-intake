import type { NormalizedOrder, OrderStatus } from '../orders/order.schema.js';

/** One labelled test email. `expected.order` is null when the email is not an order. */
export interface EvalCase {
  id: string;
  description: string;
  email: { subject: string; body: string; receivedAt: string };
  expected: { isOrderRequest: boolean; order: NormalizedOrder | null };
  labelledBy: string;
}

export interface FieldResult {
  field: string;
  expected: unknown;
  actual: unknown;
  correct: boolean;
}

/** A converted weight may differ by one pound depending on where rounding happened. */
export const WEIGHT_TOLERANCE_LBS = 1;

type Compare = (expected: unknown, actual: unknown) => boolean;

const exact: Compare = (expected, actual) => expected === actual;

/** Names and places: case and extra spaces are not errors a dispatcher would care about. */
const looseText: Compare = (expected, actual) => {
  if (expected === null || actual === null) return expected === actual;
  const squash = (value: unknown) =>
    String(value).trim().replace(/\s+/g, ' ').toLowerCase();
  return squash(expected) === squash(actual);
};

const weight: Compare = (expected, actual) => {
  if (typeof expected !== 'number' || typeof actual !== 'number')
    return expected === actual;
  return Math.abs(expected - actual) <= WEIGHT_TOLERANCE_LBS;
};

const ORDER_FIELDS: Array<[keyof NormalizedOrder, Compare]> = [
  ['customerName', looseText],
  ['referenceNumber', looseText],
  ['equipmentType', exact],
  ['rateAmount', exact],
  ['rateCurrency', exact],
  // specialInstructions is free text with no single right answer, so it is not scored.
];

const STOP_FIELDS: Array<[keyof NormalizedOrder['stops'][number], Compare]> = [
  ['type', exact],
  ['companyName', looseText],
  ['street', looseText],
  ['city', looseText],
  ['region', exact],
  ['postalCode', looseText],
  ['windowStart', exact],
  ['windowEnd', exact],
];

const COMMODITY_FIELDS: Array<
  [keyof NormalizedOrder['commodities'][number], Compare]
> = [
  ['description', looseText],
  ['quantity', exact],
  ['commodityType', exact],
  ['weightLbs', weight],
];

/**
 * Compares an extracted order with its label, one field at a time.
 * Stops and commodities are matched by position. A stop the model missed counts every
 * one of its fields as wrong; a stop it invented counts once, on the list length.
 */
export function compareOrders(
  expected: NormalizedOrder,
  actual: NormalizedOrder,
): FieldResult[] {
  const results: FieldResult[] = [];
  const check = (
    field: string,
    compare: Compare,
    want: unknown,
    got: unknown,
  ) =>
    results.push({
      field,
      expected: want,
      actual: got,
      correct: compare(want, got),
    });

  for (const [field, compare] of ORDER_FIELDS)
    check(field, compare, expected[field], actual[field]);

  check('stops.length', exact, expected.stops.length, actual.stops.length);
  expected.stops.forEach((stop, index) => {
    for (const [field, compare] of STOP_FIELDS) {
      check(
        `stops[${index}].${field}`,
        compare,
        stop[field],
        actual.stops[index]?.[field],
      );
    }
  });

  check(
    'commodities.length',
    exact,
    expected.commodities.length,
    actual.commodities.length,
  );
  expected.commodities.forEach((commodity, index) => {
    for (const [field, compare] of COMMODITY_FIELDS) {
      const got = actual.commodities[index]?.[field];
      check(`commodities[${index}].${field}`, compare, commodity[field], got);
    }
  });

  return results;
}

export interface CaseResult {
  id: string;
  schemaValid: boolean;
  /** Did the model agree with the label on whether this email is an order at all? */
  classifiedCorrectly: boolean;
  status: OrderStatus;
  fields: FieldResult[];
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
}

export interface Summary {
  cases: number;
  schemaValidRate: number;
  classificationAccuracy: number;
  fieldsScored: number;
  fieldAccuracy: number;
  /** Orders where every scored field matched the label. */
  exactOrders: number;
  ordersScored: number;
  /** The number that matters most: wrong orders that nobody would have looked at. */
  silentFailures: string[];
  /** Wrong orders the gate held for a person. */
  caughtByGate: string[];
  /** Fully correct orders the gate held anyway: the price paid in reviewer time. */
  unneededReviews: string[];
  latencyP50Ms: number;
  latencyP95Ms: number;
  inputTokens: number;
  outputTokens: number;
}

/** Nearest-rank percentile: the smallest value with at least p% of values at or below it. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1];
}

export function summarize(results: CaseResult[]): Summary {
  const fields = results.flatMap((result) => result.fields);
  const scoredOrders = results.filter((result) => result.fields.length > 0);
  const isWrong = (result: CaseResult) =>
    !result.classifiedCorrectly ||
    result.fields.some((field) => !field.correct);
  const ids = (list: CaseResult[]) => list.map((result) => result.id);
  const ratio = (part: number, whole: number) =>
    whole === 0 ? 0 : part / whole;

  return {
    cases: results.length,
    schemaValidRate: ratio(
      results.filter((r) => r.schemaValid).length,
      results.length,
    ),
    classificationAccuracy: ratio(
      results.filter((r) => r.classifiedCorrectly).length,
      results.length,
    ),
    fieldsScored: fields.length,
    fieldAccuracy: ratio(
      fields.filter((field) => field.correct).length,
      fields.length,
    ),
    exactOrders: scoredOrders.filter((r) =>
      r.fields.every((field) => field.correct),
    ).length,
    ordersScored: scoredOrders.length,
    silentFailures: ids(
      results.filter((r) => isWrong(r) && r.status === 'auto_accepted'),
    ),
    caughtByGate: ids(
      results.filter((r) => isWrong(r) && r.status !== 'auto_accepted'),
    ),
    unneededReviews: ids(
      results.filter((r) => !isWrong(r) && r.status === 'needs_review'),
    ),
    latencyP50Ms: percentile(
      results.map((r) => r.latencyMs),
      50,
    ),
    latencyP95Ms: percentile(
      results.map((r) => r.latencyMs),
      95,
    ),
    inputTokens: results.reduce((sum, r) => sum + r.inputTokens, 0),
    outputTokens: results.reduce((sum, r) => sum + r.outputTokens, 0),
  };
}
