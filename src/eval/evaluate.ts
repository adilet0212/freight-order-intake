import type { ExtractionResult } from '../orders/extraction.service.js';
import { normalizeOrder } from '../orders/normalize.js';
import type { InboundEmail } from '../orders/order.schema.js';
import { reviewGate } from '../orders/review-gate.js';
import { compareOrders, type CaseResult, type EvalCase } from './score.js';

export type Extract = (email: InboundEmail) => Promise<ExtractionResult>;

/**
 * Runs one labelled email through the same extract -> normalize -> gate steps the API
 * uses, then scores the result against the label. No database is involved.
 */
export async function evaluateCase(
  testCase: EvalCase,
  extract: Extract,
): Promise<CaseResult> {
  const result = await extract(testCase.email);
  const metrics = {
    latencyMs: result.latencyMs,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
  };

  if (!result.ok) {
    return {
      id: testCase.id,
      schemaValid: false,
      classifiedCorrectly: false,
      status: 'extraction_failed',
      fields: [],
      ...metrics,
    };
  }

  const normalized = normalizeOrder(result.extracted);
  const decision = reviewGate({
    isOrderRequest: result.extracted.isOrderRequest,
    order: normalized.order,
    normalizeIssues: normalized.issues,
    ambiguities: result.extracted.ambiguities,
  });
  const classifiedCorrectly =
    result.extracted.isOrderRequest === testCase.expected.isOrderRequest;

  return {
    id: testCase.id,
    schemaValid: true,
    classifiedCorrectly,
    status: decision.status,
    // Fields are scored only when the label and the model agree that this is an order.
    fields:
      classifiedCorrectly && testCase.expected.order
        ? compareOrders(testCase.expected.order, normalized.order)
        : [],
    ...metrics,
  };
}
