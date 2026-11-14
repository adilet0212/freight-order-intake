import { cleanExtractedOrder } from '../../test/fixtures/extracted-order.js';
import { normalizeOrder } from '../orders/normalize.js';
import { evaluateCase } from './evaluate.js';
import {
  compareOrders,
  percentile,
  summarize,
  type CaseResult,
  type EvalCase,
} from './score.js';

const label = () => normalizeOrder(cleanExtractedOrder()).order;
const wrongFields = (results: ReturnType<typeof compareOrders>) =>
  results.filter((result) => !result.correct).map((result) => result.field);

describe('compareOrders', () => {
  it('scores an identical order as fully correct', () => {
    const results = compareOrders(label(), label());
    expect(results).toHaveLength(27); // 5 order + 1 length + 2x8 stop + 1 length + 4 commodity
    expect(wrongFields(results)).toEqual([]);
  });

  it('ignores case and spacing in names but not in codes', () => {
    const actual = label();
    actual.customerName = 'maple  ridge FOODS';
    actual.stops[0].region = 'on';
    expect(wrongFields(compareOrders(label(), actual))).toEqual([
      'stops[0].region',
    ]);
  });

  it('allows a one-pound rounding difference in weight, and no more', () => {
    const offByOne = label();
    offByOne.commodities[0].weightLbs = 21601;
    expect(wrongFields(compareOrders(label(), offByOne))).toEqual([]);

    const offByTwo = label();
    offByTwo.commodities[0].weightLbs = 21602;
    expect(wrongFields(compareOrders(label(), offByTwo))).toEqual([
      'commodities[0].weightLbs',
    ]);
  });

  it('counts a value the model invented as wrong when the label is null', () => {
    const actual = label();
    actual.stops[1].windowEnd = '2026-11-18T17:00';
    expect(wrongFields(compareOrders(label(), actual))).toEqual([
      'stops[1].windowEnd',
    ]);
  });

  it('counts every field of a missed stop as wrong', () => {
    const actual = label();
    actual.stops = [actual.stops[0]];
    const wrong = wrongFields(compareOrders(label(), actual));
    expect(wrong).toContain('stops.length');
    expect(wrong).toContain('stops[1].city');
    // All 8 fields, including windowEnd, whose label is null: a stop that is not there
    // must not earn credit for "correctly" having no end time.
    expect(wrong.filter((field) => field.startsWith('stops[1].'))).toHaveLength(
      8,
    );
  });

  it('counts an invented extra stop once, on the list length', () => {
    const actual = label();
    actual.stops = [...actual.stops, actual.stops[1]];
    expect(wrongFields(compareOrders(label(), actual))).toEqual([
      'stops.length',
    ]);
  });
});

describe('percentile', () => {
  it('uses the nearest-rank method', () => {
    const values = [900, 100, 500, 300, 700];
    expect(percentile(values, 50)).toBe(500);
    expect(percentile(values, 95)).toBe(900);
    expect(percentile([42], 95)).toBe(42);
    expect(percentile([], 50)).toBe(0);
  });
});

describe('evaluateCase and summarize', () => {
  const testCase = (id: string): EvalCase => ({
    id,
    description: 'clean order',
    email: { subject: 's', body: 'b', receivedAt: '2026-11-16T14:05:00-05:00' },
    expected: { isOrderRequest: true, order: label() },
    labelledBy: 'test',
  });
  const answer =
    (extracted: ReturnType<typeof cleanExtractedOrder>, latencyMs: number) =>
    async () => ({
      ok: true as const,
      extracted,
      latencyMs,
      inputTokens: 400,
      outputTokens: 200,
    });

  it('separates silent failures from failures the gate caught', async () => {
    const wrongCity = cleanExtractedOrder();
    wrongCity.stops[1].city = 'Detroit'; // wrong, but nothing for a rule to notice
    const missingStop = cleanExtractedOrder();
    missingStop.stops = [missingStop.stops[0]]; // wrong, and the gate holds it
    const flaggedButRight = cleanExtractedOrder({
      ambiguities: ['Is the PO number final?'],
    });

    const results: CaseResult[] = [
      await evaluateCase(
        testCase('correct'),
        answer(cleanExtractedOrder(), 1000),
      ),
      await evaluateCase(testCase('wrong-city'), answer(wrongCity, 2000)),
      await evaluateCase(testCase('missing-stop'), answer(missingStop, 3000)),
      await evaluateCase(
        testCase('flagged-but-right'),
        answer(flaggedButRight, 4000),
      ),
    ];
    const summary = summarize(results);

    expect(summary.silentFailures).toEqual(['wrong-city']);
    expect(summary.caughtByGate).toEqual(['missing-stop']);
    expect(summary.unneededReviews).toEqual(['flagged-but-right']);
    expect(summary.exactOrders).toBe(2);
    expect(summary.schemaValidRate).toBe(1);
    expect(summary.fieldsScored).toBe(108); // 4 orders x 27 fields
    expect(summary.fieldAccuracy).toBeCloseTo(98 / 108); // 1 wrong city + 9 from the missed stop
    expect(summary.latencyP50Ms).toBe(2000);
    expect(summary.latencyP95Ms).toBe(4000);
    expect(summary.inputTokens).toBe(1600);
  });

  it('records a schema failure without scoring any fields', async () => {
    const failed = async () => ({
      ok: false as const,
      error: 'bad json',
      rawText: '{',
      latencyMs: 800,
      inputTokens: 0,
      outputTokens: 0,
    });
    const result = await evaluateCase(testCase('broken'), failed);
    expect(result).toMatchObject({
      schemaValid: false,
      status: 'extraction_failed',
      fields: [],
    });
    expect(summarize([result]).schemaValidRate).toBe(0);
  });

  it('counts calling an order "not an order" as a silent failure', async () => {
    const notAnOrder = cleanExtractedOrder({
      isOrderRequest: false,
      stops: [],
      commodities: [],
    });
    const result = await evaluateCase(
      testCase('misclassified'),
      answer(notAnOrder, 500),
    );
    const summary = summarize([result]);
    expect(summary.classificationAccuracy).toBe(0);
    // Dropped as not_an_order: nobody reviews it, so it is caught only in the sense that it
    // was not auto-accepted. It is reported separately through classificationAccuracy.
    expect(summary.caughtByGate).toEqual(['misclassified']);
  });
});
