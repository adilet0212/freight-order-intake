import { createHash } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PROMPT_VERSION } from './extraction.prompt.js';
import { ExtractionService } from './extraction.service.js';
import { normalizeOrder } from './normalize.js';
import type {
  InboundEmail,
  NormalizedOrder,
  OrderStatus,
} from './order.schema.js';
import { OrdersGateway } from './orders.gateway.js';
import { OrdersRepository, type OrderView } from './orders.repository.js';
import { reviewGate } from './review-gate.js';

export interface IngestResult {
  order: OrderView;
  /** false when this email was already ingested and the existing order is returned. */
  created: boolean;
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly extraction: ExtractionService,
    private readonly repository: OrdersRepository,
    private readonly gateway: OrdersGateway,
  ) {}

  /** The whole pipeline for one email: dedupe, extract, normalize, gate, store. */
  async ingest(email: InboundEmail): Promise<IngestResult> {
    const messageId = email.messageId ?? fingerprint(email);

    // Cheap check first so a repeated email does not cost a model call.
    const existingId = await this.repository.findIdByMessageId(messageId);
    if (existingId)
      return { order: await this.get(existingId), created: false };

    const result = await this.extraction.extract(email);
    const metrics = {
      promptVersion: PROMPT_VERSION,
      latencyMs: result.latencyMs,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    };
    const emailColumns = {
      messageId,
      emailSubject: email.subject,
      emailBody: email.body,
      emailReceivedAt: email.receivedAt,
    };

    let id: string | null;
    if (!result.ok) {
      // Never drop an email: a failed extraction is stored for a person to handle.
      id = await this.repository.create({
        ...emailColumns,
        ...metrics,
        status: 'extraction_failed',
        reviewReasons: [
          `Model output did not match the schema: ${result.error}`,
        ],
        order: null,
        rawExtraction: { rawText: result.rawText },
      });
    } else {
      const normalized = normalizeOrder(result.extracted);
      const decision = reviewGate({
        isOrderRequest: result.extracted.isOrderRequest,
        order: normalized.order,
        normalizeIssues: normalized.issues,
        ambiguities: result.extracted.ambiguities,
      });
      id = await this.repository.create({
        ...emailColumns,
        ...metrics,
        status: decision.status,
        reviewReasons: decision.reasons,
        order: decision.status === 'not_an_order' ? null : normalized.order,
        rawExtraction: result.extracted,
      });
    }

    // null means another request stored the same email between our check and our insert.
    // The unique index made the database, not this code, the judge of that race.
    if (id === null) {
      const winnerId = await this.repository.findIdByMessageId(messageId);
      return { order: await this.get(winnerId!), created: false };
    }
    const order = await this.get(id);
    // Told to the web clients only now that the order is stored, and only for a new one:
    // a repeated email returned above and changed nothing.
    this.gateway.orderCreated(order);
    return { order, created: true };
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
