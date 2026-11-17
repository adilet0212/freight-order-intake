import { createHash } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AiModelError } from '@nestjs/ai';
import { PROMPT_VERSION } from './extraction.prompt.js';
import {
  ExtractionService,
  type ExtractionResult,
} from './extraction.service.js';
import { normalizeOrder } from './normalize.js';
import type {
  InboundEmail,
  NormalizedOrder,
  OrderStatus,
} from './order.schema.js';
import { OrdersGateway } from './orders.gateway.js';
import {
  OrdersRepository,
  type NewOrder,
  type OrderView,
} from './orders.repository.js';
import { reviewGate } from './review-gate.js';

export interface IngestResult {
  order: OrderView;
  /** false when this email was already ingested and the existing order is returned. */
  created: boolean;
}

/** What one extraction attempt stores: everything in an order except the email itself. */
type Outcome = Omit<
  NewOrder,
  'messageId' | 'emailSubject' | 'emailBody' | 'emailReceivedAt'
>;

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly extraction: ExtractionService,
    private readonly repository: OrdersRepository,
    private readonly gateway: OrdersGateway,
  ) {}

  /**
   * The whole pipeline for one email: dedupe, extract, normalize, gate, store.
   *
   * A repeated email returns the stored order without a model call, except when that order
   * is extraction_failed: then extraction runs again, so re-sending is how an email is
   * retried after a provider outage (SPEC section 7, decision 4).
   */
  async ingest(email: InboundEmail): Promise<IngestResult> {
    const messageId = email.messageId ?? fingerprint(email);

    // Cheap check first so a repeated email does not cost a model call. It only saves the
    // call; the database decides the races below.
    let stored = await this.repository.findByMessageId(messageId);
    if (stored && stored.status !== 'extraction_failed')
      return { order: await this.get(stored.id), created: false };

    const attempt = await this.attemptExtraction(email);
    const record: NewOrder = {
      messageId,
      emailSubject: email.subject,
      emailBody: email.body,
      emailReceivedAt: email.receivedAt,
      ...attempt.outcome,
    };

    if (!stored) {
      const id = await this.repository.create(record);
      if (id) {
        const order = await this.get(id);
        // Told to the web clients only now that the order is stored, and only for a new one,
        // whatever its status: an outage stores extraction_failed, and that row belongs in
        // the queue too.
        this.gateway.orderCreated(order);
        return { order, created: true };
      }
      // null means another request stored the same email between our check and our insert.
      // The unique index made the database, not this code, the judge of that race.
      stored = (await this.repository.findByMessageId(messageId))!;
    }

    // The stored order is a failed extraction (or the race winner's order). Replace it only if
    // the model answered: an outage on a re-send must not overwrite the earlier, kept answer.
    // replaceFailed itself checks the status, so an order that is no longer failed is untouched.
    const replaced =
      attempt.modelAnswered &&
      (await this.repository.replaceFailed(stored.id, record));
    const order = await this.get(stored.id);
    // Only when the row was written. No event for another outage, for an order that was
    // not failed, or for the loser of two re-sends: in each of those nothing changed.
    if (replaced) this.gateway.orderReextracted(order);
    return { order, created: false };
  }

  /**
   * One extraction, turned into what gets stored. A provider failure (timeout, 5xx, network
   * error, refused key) after the AI module's retries becomes extraction_failed instead of a
   * 500, because an email is never dropped. Anything else is a bug and still throws.
   */
  private async attemptExtraction(
    email: InboundEmail,
  ): Promise<{ modelAnswered: boolean; outcome: Outcome }> {
    const startedAt = performance.now();
    let result: ExtractionResult;
    try {
      result = await this.extraction.extract(email);
    } catch (error) {
      if (!(error instanceof AiModelError)) throw error;
      this.logger.warn(
        `Stored the email as extraction_failed: ${error.message}`,
      );
      return {
        modelAnswered: false,
        outcome: {
          status: 'extraction_failed',
          reviewReasons: [`Model provider failed: ${error.message}`],
          order: null,
          // There is no model answer to keep.
          rawExtraction: null,
          promptVersion: PROMPT_VERSION,
          latencyMs: Math.round(performance.now() - startedAt),
          inputTokens: 0,
          outputTokens: 0,
        },
      };
    }

    const metrics = {
      promptVersion: PROMPT_VERSION,
      latencyMs: result.latencyMs,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    };
    if (!result.ok) {
      // Never drop an email: a failed extraction is stored for a person to handle.
      return {
        modelAnswered: true,
        outcome: {
          ...metrics,
          status: 'extraction_failed',
          reviewReasons: [
            `Model output did not match the schema: ${result.error}`,
          ],
          order: null,
          rawExtraction: { rawText: result.rawText },
        },
      };
    }

    const normalized = normalizeOrder(result.extracted);
    const decision = reviewGate({
      isOrderRequest: result.extracted.isOrderRequest,
      order: normalized.order,
      normalizeIssues: normalized.issues,
      ambiguities: result.extracted.ambiguities,
    });
    return {
      modelAnswered: true,
      outcome: {
        ...metrics,
        status: decision.status,
        reviewReasons: decision.reasons,
        order: decision.status === 'not_an_order' ? null : normalized.order,
        rawExtraction: result.extracted,
      },
    };
  }

  async get(id: string): Promise<OrderView> {
    const order = await this.repository.findById(id);
    if (!order) throw new NotFoundException(`Order ${id} not found`);
    return order;
  }

  list(status?: OrderStatus) {
    return this.repository.list(status);
  }

  /** A reviewer confirms or corrects an order that the gate held back. */
  async approve(id: string, corrected: NormalizedOrder): Promise<OrderView> {
    const order = await this.get(id);
    if (
      order.status !== 'needs_review' &&
      order.status !== 'extraction_failed'
    ) {
      throw new ConflictException(
        `Order ${id} is ${order.status}; only held orders can be reviewed`,
      );
    }
    await this.repository.approve(id, corrected);
    const approved = await this.get(id);
    this.gateway.orderApproved(approved);
    return approved;
  }
}

/** Stand-in for the Message-ID header when the caller does not send one. */
export function fingerprint(email: InboundEmail): string {
  const hash = createHash('sha256')
    .update(`${email.receivedAt}\n${email.subject}\n${email.body}`)
    .digest('hex');
  return `sha256:${hash}`;
}
