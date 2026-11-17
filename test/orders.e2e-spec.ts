import {
  StandardSchemaValidationPipe,
  type INestApplication,
} from '@nestjs/common';
import { FakeModel, overrideModels, providerError } from '@nestjs/ai/testing';
import { getDrizzleToken } from '@nestjs/drizzle';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { OrdersRepository } from '../src/orders/orders.repository.js';
import { cleanExtractedOrder } from './fixtures/extracted-order.js';

const email = {
  subject: 'Load tender PO-48213',
  body: 'Please pick up 18 skids in Brampton on Nov 17 and deliver to Chicago on Nov 18.',
  receivedAt: '2026-11-16T14:05:00-05:00',
};

describe('Orders API', () => {
  let app: INestApplication<App>;
  let model: FakeModel;

  beforeEach(async () => {
    model = new FakeModel([]);
    const moduleRef = await overrideModels(
      Test.createTestingModule({ imports: [AppModule] }),
      {
        default: model,
      },
    ).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new StandardSchemaValidationPipe());
    await app.init();
    const db = app.get<NodePgDatabase>(getDrizzleToken());
    await db.execute(sql`TRUNCATE orders CASCADE`);
  });

  afterEach(async () => {
    await app.close();
  });

  it('accepts a clean order, stores it normalized, and returns 201', async () => {
    model.reply({
      object: cleanExtractedOrder(),
      usage: { inputTokens: 412, outputTokens: 187 },
    });

    const response = await request(app.getHttpServer())
      .post('/emails')
      .send(email)
      .expect(201);

    expect(response.body).toMatchObject({
      status: 'auto_accepted',
      reviewReasons: [],
      customerName: 'Maple Ridge Foods',
      rateAmount: 1850,
      inputTokens: 412,
      outputTokens: 187,
      promptVersion: 'v1',
    });
    expect(response.body.stops).toEqual([
      expect.objectContaining({
        type: 'pickup',
        region: 'ON',
        postalCode: 'L6T 4X3',
        windowStart: '2026-11-17T08:00',
        windowEnd: '2026-11-17T12:00',
      }),
      expect.objectContaining({
        type: 'delivery',
        city: 'Chicago',
        windowEnd: null,
      }),
    ]);
    expect(response.body.commodities).toEqual([
      {
        description: 'Canned goods',
        quantity: 18,
        commodityType: 'skid',
        weightLbs: 21600,
      },
    ]);

    // What was stored is what was returned.
    const stored = await request(app.getHttpServer())
      .get(`/orders/${response.body.id}`)
      .expect(200);
    expect(stored.body).toEqual(response.body);
  });

  it('sends the email text and its received date to the model', async () => {
    model.reply({ object: cleanExtractedOrder() });
    await request(app.getHttpServer()).post('/emails').send(email).expect(201);

    expect(model.calls).toHaveLength(1);
    expect(model.lastCall?.lastUserMessage).toContain(email.body);
    expect(model.lastCall?.lastUserMessage).toContain(email.receivedAt);
  });

  it('converts kilograms to pounds before storing', async () => {
    const extracted = cleanExtractedOrder();
    extracted.commodities[0].weightValue = 9800;
    extracted.commodities[0].weightUnit = 'kg';
    model.reply({ object: extracted });

    const response = await request(app.getHttpServer())
      .post('/emails')
      .send(email)
      .expect(201);
    expect(response.body.commodities[0].weightLbs).toBe(21605);
  });

  it('holds an incomplete order for review and lists it in the review queue', async () => {
    const extracted = cleanExtractedOrder();
    extracted.stops = [extracted.stops[0]];
    model.reply({ object: extracted });

    const created = await request(app.getHttpServer())
      .post('/emails')
      .send(email)
      .expect(201);
    expect(created.body.status).toBe('needs_review');
    expect(created.body.reviewReasons).toEqual(['No delivery stop']);

    const queue = await request(app.getHttpServer())
      .get('/orders?status=needs_review')
      .expect(200);
    expect(queue.body.map((order: { id: string }) => order.id)).toEqual([
      created.body.id,
    ]);
    const accepted = await request(app.getHttpServer())
      .get('/orders?status=auto_accepted')
      .expect(200);
    expect(accepted.body).toEqual([]);
  });

  it('stores a non-order email without stops or commodities', async () => {
    model.reply({
      object: cleanExtractedOrder({
        isOrderRequest: false,
        stops: [],
        commodities: [],
      }),
    });

    const response = await request(app.getHttpServer())
      .post('/emails')
      .send(email)
      .expect(201);
    expect(response.body).toMatchObject({
      status: 'not_an_order',
      stops: [],
      commodities: [],
    });
  });

  it('keeps the email when the model answer does not match the schema', async () => {
    model.reply({ object: { isOrderRequest: 'maybe' } });

    const response = await request(app.getHttpServer())
      .post('/emails')
      .send(email)
      .expect(201);
    expect(response.body.status).toBe('extraction_failed');
    expect(response.body.emailBody).toBe(email.body);
    expect(response.body.reviewReasons[0]).toContain(
      'did not match the schema',
    );
  });

  it('does not create a second order or call the model again for a repeated email', async () => {
    model.reply({ object: cleanExtractedOrder() });
    const withId = { ...email, messageId: '<CAF8x1@mail.mapleridge.example>' };

    const first = await request(app.getHttpServer())
      .post('/emails')
      .send(withId)
      .expect(201);
    const second = await request(app.getHttpServer())
      .post('/emails')
      .send(withId)
      .expect(200);

    expect(second.body.id).toBe(first.body.id);
    expect(model.calls).toHaveLength(1);
    const all = await request(app.getHttpServer()).get('/orders').expect(200);
    expect(all.body).toHaveLength(1);
  });

  it('treats an identical email with no Message-ID as a repeat', async () => {
    model.reply({ object: cleanExtractedOrder() });

    const first = await request(app.getHttpServer())
      .post('/emails')
      .send(email)
      .expect(201);
    const second = await request(app.getHttpServer())
      .post('/emails')
      .send(email)
      .expect(200);
    expect(second.body.id).toBe(first.body.id);
  });

  it('creates one order when the same email arrives twice at the same moment', async () => {
    const answer = { object: cleanExtractedOrder(), delay: 50 };
    model.reply(answer, answer);

    const responses = await Promise.all([
      request(app.getHttpServer()).post('/emails').send(email),
      request(app.getHttpServer()).post('/emails').send(email),
    ]);

    expect(
      responses.map((response) => response.status).sort((a, b) => a - b),
    ).toEqual([200, 201]);
    expect(responses[0].body.id).toBe(responses[1].body.id);
    const all = await request(app.getHttpServer()).get('/orders').expect(200);
    expect(all.body).toHaveLength(1);
  });

  describe('provider outage (SPEC section 7, decision 4)', () => {
    /**
     * Three 503s: one per attempt of the AI module's retry (attempts: 3 in AppModule).
     * retryAfter 0 makes the backoff zero, so the test does not wait seconds between attempts.
     */
    const outage = () =>
      [1, 2, 3].map(() => providerError(503, { retryAfter: 0 }));
    const withId = {
      ...email,
      messageId: '<outage-1@mail.mapleridge.example>',
    };

    it('stores the email as extraction_failed and returns 201', async () => {
      model.reply(...outage());

      const response = await request(app.getHttpServer())
        .post('/emails')
        .send(withId)
        .expect(201);

      expect(model.calls).toHaveLength(3);
      expect(response.body).toMatchObject({
        status: 'extraction_failed',
        messageId: withId.messageId,
        emailBody: email.body,
        rawExtraction: null,
        stops: [],
        commodities: [],
      });
      expect(response.body.reviewReasons).toEqual([
        expect.stringContaining('Model provider failed'),
      ]);
      const failed = await request(app.getHttpServer())
        .get('/orders?status=extraction_failed')
        .expect(200);
      expect(failed.body.map((order: { id: string }) => order.id)).toEqual([
        response.body.id,
      ]);
    });

    it('re-runs extraction when the same email is sent again, and updates the order', async () => {
      model.reply(...outage());
      const failed = await request(app.getHttpServer())
        .post('/emails')
        .send(withId)
        .expect(201);

      model.reply({ object: cleanExtractedOrder() });
      const retried = await request(app.getHttpServer())
        .post('/emails')
        .send(withId)
        .expect(200);

      expect(model.calls).toHaveLength(4);
      expect(retried.body).toMatchObject({
        id: failed.body.id,
        createdAt: failed.body.createdAt,
        status: 'auto_accepted',
        reviewReasons: [],
        customerName: 'Maple Ridge Foods',
      });
      expect(retried.body.rawExtraction.stops).toHaveLength(2);
      expect(
        retried.body.stops.map((stop: { city: string }) => stop.city),
      ).toEqual(['Brampton', 'Chicago']);
      const stored = await request(app.getHttpServer())
        .get(`/orders/${failed.body.id}`)
        .expect(200);
      expect(stored.body).toEqual(retried.body);
      const all = await request(app.getHttpServer()).get('/orders').expect(200);
      expect(all.body).toHaveLength(1);
    });

    it('keeps the failed order unchanged when the re-send hits another outage', async () => {
      model.reply(...outage());
      const failed = await request(app.getHttpServer())
        .post('/emails')
        .send(withId)
        .expect(201);

      model.reply(...outage());
      const again = await request(app.getHttpServer())
        .post('/emails')
        .send(withId)
        .expect(200);

      expect(model.calls).toHaveLength(6);
      expect(again.body).toEqual(failed.body);
    });

    it('also re-runs an order whose model answer did not match the schema', async () => {
      model.reply({ object: { isOrderRequest: 'maybe' } });
      const failed = await request(app.getHttpServer())
        .post('/emails')
        .send(withId)
        .expect(201);
      expect(failed.body.status).toBe('extraction_failed');

      model.reply({ object: cleanExtractedOrder() });
      const retried = await request(app.getHttpServer())
        .post('/emails')
        .send(withId)
        .expect(200);
      expect(retried.body).toMatchObject({
        id: failed.body.id,
        status: 'auto_accepted',
      });
    });

    it('returns a re-sent order that did not fail unchanged, with no model call (200)', async () => {
      const extracted = cleanExtractedOrder();
      extracted.stops = [extracted.stops[0]];
      model.reply({ object: extracted });
      const held = await request(app.getHttpServer())
        .post('/emails')
        .send(withId)
        .expect(201);
      expect(held.body.status).toBe('needs_review');

      const again = await request(app.getHttpServer())
        .post('/emails')
        .send(withId)
        .expect(200);

      expect(again.body).toEqual(held.body);
      expect(model.calls).toHaveLength(1);
    });

    it('applies only one of two re-sends that arrive at the same moment', async () => {
      model.reply(...outage());
      const failed = await request(app.getHttpServer())
        .post('/emails')
        .send(withId)
        .expect(201);

      // Two different answers, so a double write would show.
      const held = cleanExtractedOrder();
      held.stops = [held.stops[0]];
      model.reply(
        { object: cleanExtractedOrder(), delay: 50 },
        { object: held, delay: 50 },
      );
      const responses = await Promise.all([
        request(app.getHttpServer()).post('/emails').send(withId),
        request(app.getHttpServer()).post('/emails').send(withId),
      ]);

      expect(responses.map((response) => response.status)).toEqual([200, 200]);
      const stored = await request(app.getHttpServer())
        .get(`/orders/${failed.body.id}`)
        .expect(200);
      expect(['auto_accepted', 'needs_review']).toContain(stored.body.status);
      expect(responses[0].body).toEqual(stored.body);
      expect(responses[1].body).toEqual(stored.body);
      const all = await request(app.getHttpServer()).get('/orders').expect(200);
      expect(all.body).toHaveLength(1);
    });

    it('replaces a failed order only once, even when asked twice (the database checks the status)', async () => {
      model.reply(...outage());
      const failed = await request(app.getHttpServer())
        .post('/emails')
        .send(withId)
        .expect(201);
      const repository = app.get(OrdersRepository);
      const replacement = (status: 'auto_accepted' | 'needs_review') => ({
        status,
        reviewReasons: [],
        messageId: withId.messageId,
        emailSubject: email.subject,
        emailBody: email.body,
        emailReceivedAt: email.receivedAt,
        order: null,
        rawExtraction: null,
        promptVersion: 'v1',
        latencyMs: 1,
        inputTokens: 1,
        outputTokens: 1,
      });

      expect(
        await repository.replaceFailed(
          failed.body.id,
          replacement('auto_accepted'),
        ),
      ).toBe(true);
      expect(
        await repository.replaceFailed(
          failed.body.id,
          replacement('needs_review'),
        ),
      ).toBe(false);

      const stored = await request(app.getHttpServer())
        .get(`/orders/${failed.body.id}`)
        .expect(200);
      expect(stored.body.status).toBe('auto_accepted');
    });
  });

  it('lets a reviewer correct a held order, replacing its stops', async () => {
    const extracted = cleanExtractedOrder();
    extracted.stops = [extracted.stops[0]];
    model.reply({ object: extracted });
    const held = await request(app.getHttpServer())
      .post('/emails')
      .send(email)
      .expect(201);

    const corrected = {
      customerName: held.body.customerName,
      referenceNumber: held.body.referenceNumber,
      equipmentType: held.body.equipmentType,
      rateAmount: held.body.rateAmount,
      rateCurrency: held.body.rateCurrency,
      specialInstructions: null,
      commodities: held.body.commodities,
      stops: [
        ...held.body.stops,
        {
          type: 'delivery',
          companyName: 'Lakeshore Grocers DC',
          street: null,
          city: 'Chicago',
          region: 'IL',
          postalCode: null,
          windowStart: '2026-11-18T09:00',
          windowEnd: null,
        },
      ],
    };
    const response = await request(app.getHttpServer())
      .patch(`/orders/${held.body.id}/review`)
      .send(corrected)
      .expect(200);

    expect(response.body.status).toBe('approved');
    expect(response.body.reviewedAt).not.toBeNull();
    expect(
      response.body.stops.map((stop: { city: string }) => stop.city),
    ).toEqual(['Brampton', 'Chicago']);
    // The model's original answer is kept for audit even after a person corrects the order.
    expect(response.body.rawExtraction.stops).toHaveLength(1);
  });

  it('refuses to review an order that was not held (409)', async () => {
    model.reply({ object: cleanExtractedOrder() });
    const accepted = await request(app.getHttpServer())
      .post('/emails')
      .send(email)
      .expect(201);

    const {
      stops,
      commodities,
      customerName,
      referenceNumber,
      equipmentType,
      rateAmount,
      rateCurrency,
    } = accepted.body;
    await request(app.getHttpServer())
      .patch(`/orders/${accepted.body.id}/review`)
      .send({
        stops,
        commodities,
        customerName,
        referenceNumber,
        equipmentType,
        rateAmount,
        rateCurrency,
        specialInstructions: null,
      })
      .expect(409);
  });

  it('rejects an email with no body (400) without calling the model', async () => {
    const response = await request(app.getHttpServer())
      .post('/emails')
      .send({ subject: 'Hi', receivedAt: email.receivedAt })
      .expect(400);
    expect(JSON.stringify(response.body.message)).toContain('body');
    expect(model.calls).toHaveLength(0);
  });

  it('returns 404 for an unknown order and 400 for a malformed id', async () => {
    await request(app.getHttpServer())
      .get('/orders/7c9e6679-7425-40de-944b-e07fc1f90ae7')
      .expect(404);
    await request(app.getHttpServer()).get('/orders/not-a-uuid').expect(400);
  });

  it('rejects an unknown status filter (400)', async () => {
    await request(app.getHttpServer())
      .get('/orders?status=shipped')
      .expect(400);
  });
});
