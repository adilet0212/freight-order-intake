import { Injectable } from '@nestjs/common';
import { AiOutputError, AiService } from '@nestjs/ai';
import { buildPrompt, EXTRACTION_INSTRUCTIONS } from './extraction.prompt.js';
import {
  extractedOrderSchema,
  type ExtractedOrder,
  type InboundEmail,
} from './order.schema.js';

export interface ExtractionMetrics {
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
}

export type ExtractionResult =
  | ({ ok: true; extracted: ExtractedOrder } & ExtractionMetrics)
  | ({ ok: false; error: string; rawText: string } & ExtractionMetrics);

@Injectable()
export class ExtractionService {
  constructor(private readonly ai: AiService) {}

  /**
   * One model call per email. The framework validates the answer against the Zod
   * schema; an answer that does not match comes back as ok:false instead of throwing,
   * so the caller can store the email for a person to handle rather than lose it.
   * Provider errors (timeouts, rate limits) still throw after the module's retries.
   */
  async extract(email: InboundEmail): Promise<ExtractionResult> {
    const startedAt = performance.now();
    try {
      const { object, usage } = await this.ai.generateObject({
        label: 'order-extraction',
        schema: extractedOrderSchema,
        instructions: EXTRACTION_INSTRUCTIONS,
        prompt: buildPrompt(email),
      });
      return {
        ok: true,
        extracted: object,
        latencyMs: Math.round(performance.now() - startedAt),
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
      };
    } catch (error) {
      if (!(error instanceof AiOutputError)) throw error;
      return {
        ok: false,
        error: error.message,
        rawText: error.text ?? '',
        latencyMs: Math.round(performance.now() - startedAt),
        inputTokens: 0,
        outputTokens: 0,
      };
    }
  }
}
