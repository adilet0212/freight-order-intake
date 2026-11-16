import { AiModelError } from '@nestjs/ai';
import { cleanExtractedOrder } from '../../test/fixtures/extracted-order.js';
import type {
  ExtractionResult,
  ExtractionService,
} from './extraction.service.js';
import type { InboundEmail, OrderStatus } from './order.schema.js';
import type {
  NewOrder,
  OrdersRepository,
  OrderView,
} from './orders.repository.js';
import { OrdersService } from './orders.service.js';

const email: InboundEmail = {
  messageId: '<outage-1@mail.example>',
  subject: 'Load tender PO-48213',
  body: 'Please pick up 18 skids in Brampton on Nov 17 and deliver to Chicago on Nov 18.',
  receivedAt: '2026-11-16T14:05:00-05:00',
};

const STORED_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

/** What the AI module throws when every attempt failed: here, three 503s. */
function outage(): AiModelError {
  const model = { name: 'default', provider: 'fake', modelId: 'fake' };
  return new AiModelError(
    [1, 2, 3].map((attempt) => ({
      model,
      attempt,
      error: new Error('The provider answered 503'),
    })),
  );
}

function answered(): ExtractionResult {
  return {
    ok: true,
    extracted: cleanExtractedOrder(),
    latencyMs: 900,
    inputTokens: 412,
    outputTokens: 187,
  };
}

function setup(stored?: { id: string; status: OrderStatus }) {
  const extract = vi.fn<(email: InboundEmail) => Promise<ExtractionResult>>();
  const repository = {
    findByMessageId: vi.fn().mockResolvedValue(stored),
    create: vi.fn<(input: NewOrder) => Promise<string | null>>(),
    replaceFailed: vi
      .fn<(id: string, input: NewOrder) => Promise<boolean>>()
      .mockResolvedValue(true),
    findById: vi
      .fn()
      .mockImplementation((id: string) => Promise.resolve({ id } as OrderView)),
  };
  const service = new OrdersService(
    { extract } as unknown as ExtractionService,
    repository as unknown as OrdersRepository,
  );
  return { service, extract, repository };
}

describe('OrdersService.ingest on a provider failure', () => {
  it('stores a new email as extraction_failed instead of throwing', async () => {
    const { service, extract, repository } = setup();
    extract.mockRejectedValue(outage());
    repository.create.mockResolvedValue(STORED_ID);

    const result = await service.ingest(email);

    expect(result).toEqual({ order: { id: STORED_ID }, created: true });
    const stored = repository.create.mock.calls[0][0];
    expect(stored).toMatchObject({
      messageId: email.messageId,
      emailBody: email.body,
      status: 'extraction_failed',
      order: null,
      rawExtraction: null,
      inputTokens: 0,
      outputTokens: 0,
    });
    expect(stored.reviewReasons).toEqual([
      expect.stringContaining('Model provider failed'),
    ]);
    expect(stored.reviewReasons[0]).toContain('3 attempt(s)');
    expect(repository.replaceFailed).not.toHaveBeenCalled();
  });

  it('still throws an error that is not a provider failure, and stores nothing', async () => {
    const { service, extract, repository } = setup();
    extract.mockRejectedValue(new TypeError('a bug'));

    await expect(service.ingest(email)).rejects.toThrow('a bug');
    expect(repository.create).not.toHaveBeenCalled();
    expect(repository.replaceFailed).not.toHaveBeenCalled();
  });
});

describe('OrdersService.ingest of an email already stored', () => {
  it('re-runs extraction for an extraction_failed order and replaces it', async () => {
    const { service, extract, repository } = setup({
      id: STORED_ID,
      status: 'extraction_failed',
    });
    extract.mockResolvedValue(answered());

    const result = await service.ingest(email);

    expect(result).toEqual({ order: { id: STORED_ID }, created: false });
    expect(extract).toHaveBeenCalledTimes(1);
    expect(repository.create).not.toHaveBeenCalled();
    expect(repository.replaceFailed).toHaveBeenCalledWith(
      STORED_ID,
      expect.objectContaining({ status: 'auto_accepted', inputTokens: 412 }),
    );
  });

  it('writes nothing when the re-run hits another outage', async () => {
    const { service, extract, repository } = setup({
      id: STORED_ID,
      status: 'extraction_failed',
    });
    extract.mockRejectedValue(outage());

    const result = await service.ingest(email);

    expect(result).toEqual({ order: { id: STORED_ID }, created: false });
    expect(repository.create).not.toHaveBeenCalled();
    expect(repository.replaceFailed).not.toHaveBeenCalled();
  });

  it.each<OrderStatus>([
    'auto_accepted',
    'needs_review',
    'not_an_order',
    'approved',
  ])(
    'returns a %s order unchanged without calling the model',
    async (status) => {
      const { service, extract, repository } = setup({ id: STORED_ID, status });

      const result = await service.ingest(email);

      expect(result).toEqual({ order: { id: STORED_ID }, created: false });
      expect(extract).not.toHaveBeenCalled();
      expect(repository.create).not.toHaveBeenCalled();
      expect(repository.replaceFailed).not.toHaveBeenCalled();
    },
  );

  it('replaces a failed order that won the insert race, when the model answered', async () => {
    const { service, extract, repository } = setup();
    extract.mockResolvedValue(answered());
    // Not there at the first look, stored by another request before our insert.
    repository.findByMessageId
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ id: STORED_ID, status: 'extraction_failed' });
    repository.create.mockResolvedValue(null);

    const result = await service.ingest(email);

    expect(result).toEqual({ order: { id: STORED_ID }, created: false });
    expect(repository.replaceFailed).toHaveBeenCalledWith(
      STORED_ID,
      expect.objectContaining({ status: 'auto_accepted' }),
    );
  });
});
