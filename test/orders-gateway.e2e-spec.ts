import type { INestApplication } from '@nestjs/common';
import { FakeModel, overrideModels } from '@nestjs/ai/testing';
import { getDrizzleToken } from '@nestjs/drizzle';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { cleanExtractedOrder } from './fixtures/extracted-order.js';

// Not the default, so a pass proves the socket reads the origin from WEB_ORIGIN.
const WEB_ORIGIN = 'http://console.test:5173';

const email = {
  subject: 'Load tender PO-48213',
  body: 'Please pick up 18 skids in Brampton on Nov 17 and deliver to Chicago on Nov 18.',
  receivedAt: '2026-11-16T14:05:00-05:00',
};

type Received = [event: string, payload: unknown];

describe('Orders gateway', () => {
  let app: INestApplication<App>;
  let model: FakeModel;
  let port: number;
  let previousOrigin: string | undefined;
  const sockets: Socket[] = [];

  /** Connects a real Socket.IO client and records every event it is sent, in order. */
  async function connect(): Promise<Received[]> {
    const received: Received[] = [];
    const socket = io(`http://127.0.0.1:${port}`, {
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
    });
    sockets.push(socket);
    socket.onAny((event: string, payload: unknown) => {
      received.push([event, payload]);
    });
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', reject);
    });
    return received;
  }

  /** A held order: the fixture with its delivery stop removed. */
  function heldOrderAnswer() {
    const extracted = cleanExtractedOrder();
    extracted.stops = [extracted.stops[0]];
    return { object: extracted };
  }

  /** The body a reviewer would send to approve `held` after adding the missing delivery. */
  function correctedFrom(held: Record<string, unknown>) {
    return {
      customerName: held.customerName,
      referenceNumber: held.referenceNumber,
      equipmentType: held.equipmentType,
      rateAmount: held.rateAmount,
      rateCurrency: held.rateCurrency,
      specialInstructions: null,
      commodities: held.commodities,
      stops: [
        ...(held.stops as unknown[]),
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
  }

  beforeEach(async () => {
    previousOrigin = process.env.WEB_ORIGIN;
    process.env.WEB_ORIGIN = WEB_ORIGIN;
    model = new FakeModel([]);
    const moduleRef = await overrideModels(
      Test.createTestingModule({ imports: [AppModule] }),
      { default: model },
    ).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    // Port 0 asks the system for any free port, so this never collides with a running API.
    await app.listen(0);
    port = Number(new URL(await app.getUrl()).port);
    const db = app.get<NodePgDatabase>(getDrizzleToken());
    await db.execute(sql`TRUNCATE orders CASCADE`);
  });

  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.close();
    await app.close();
    if (previousOrigin === undefined) delete process.env.WEB_ORIGIN;
    else process.env.WEB_ORIGIN = previousOrigin;
  });

  it('sends order.created with the id and status when a new email is stored', async () => {
    const received = await connect();
    model.reply({ object: cleanExtractedOrder() });

    const created = await request(app.getHttpServer())
      .post('/emails')
      .send(email)
      .expect(201);

    await vi.waitFor(() => expect(received).toHaveLength(1));
    // Exactly these two fields: no email text and no order content on the socket.
    expect(received).toEqual([
      ['order.created', { id: created.body.id, status: 'auto_accepted' }],
    ]);
  });

  it('sends order.created for an email whose extraction failed, so it still reaches the queue', async () => {
    const received = await connect();
    model.reply({ object: { isOrderRequest: 'maybe' } });

    const created = await request(app.getHttpServer())
      .post('/emails')
      .send(email)
      .expect(201);

    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(received).toEqual([
      ['order.created', { id: created.body.id, status: 'extraction_failed' }],
    ]);
  });

  it('sends order.approved when a reviewer approves a held order', async () => {
    const received = await connect();
    model.reply(heldOrderAnswer());
    const held = await request(app.getHttpServer())
      .post('/emails')
      .send(email)
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/orders/${held.body.id}/review`)
      .send(correctedFrom(held.body))
      .expect(200);

    await vi.waitFor(() => expect(received).toHaveLength(2));
    expect(received).toEqual([
      ['order.created', { id: held.body.id, status: 'needs_review' }],
      ['order.approved', { id: held.body.id, status: 'approved' }],
    ]);
  });

  it('sends nothing for a repeated email or a refused review', async () => {
    const received = await connect();
    model.reply(heldOrderAnswer(), { object: cleanExtractedOrder() });

    const first = await request(app.getHttpServer())
      .post('/emails')
      .send(email)
      .expect(201);
    // The same email again: 200, the existing order, no event.
    await request(app.getHttpServer()).post('/emails').send(email).expect(200);
    await request(app.getHttpServer())
      .patch(`/orders/${first.body.id}/review`)
      .send(correctedFrom(first.body))
      .expect(200);
    // Already approved: 409, no event.
    await request(app.getHttpServer())
      .patch(`/orders/${first.body.id}/review`)
      .send(correctedFrom(first.body))
      .expect(409);
    // A last, different email. Events arrive in the order they were sent, so once this
    // one is here, anything the two refused requests had sent would be here before it.
    const last = await request(app.getHttpServer())
      .post('/emails')
      .send({ ...email, subject: 'Load tender PO-48214' })
      .expect(201);

    await vi.waitFor(() =>
      expect(received.at(-1)).toEqual([
        'order.created',
        { id: last.body.id, status: 'auto_accepted' },
      ]),
    );
    expect(received).toEqual([
      ['order.created', { id: first.body.id, status: 'needs_review' }],
      ['order.approved', { id: first.body.id, status: 'approved' }],
      ['order.created', { id: last.body.id, status: 'auto_accepted' }],
    ]);
  });

  it('sends each event to every connected client', async () => {
    const [one, two] = await Promise.all([connect(), connect()]);
    model.reply({ object: cleanExtractedOrder() });

    const created = await request(app.getHttpServer())
      .post('/emails')
      .send(email)
      .expect(201);

    const expected = [
      ['order.created', { id: created.body.id, status: 'auto_accepted' }],
    ];
    await vi.waitFor(() => {
      expect(one).toEqual(expected);
      expect(two).toEqual(expected);
    });
  });

  it('lets the web origin, and no other, open the socket from a browser', async () => {
    // A browser starts Socket.IO with an HTTP request, and that request is subject to CORS.
    const handshake = '/socket.io/?EIO=4&transport=polling';

    const allowed = await request(app.getHttpServer())
      .get(handshake)
      .set('Origin', WEB_ORIGIN)
      .expect(200);
    expect(allowed.headers['access-control-allow-origin']).toBe(WEB_ORIGIN);

    const refused = await request(app.getHttpServer())
      .get(handshake)
      .set('Origin', 'http://elsewhere.test');
    expect(refused.headers['access-control-allow-origin']).toBeUndefined();
  });
});
