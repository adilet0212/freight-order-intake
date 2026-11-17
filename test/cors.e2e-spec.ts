import type { INestApplication } from '@nestjs/common';
import { FakeModel, overrideModels } from '@nestjs/ai/testing';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';

// Not the default, so a pass proves the origin is read from WEB_ORIGIN.
const WEB_ORIGIN = 'http://console.test:5173';
const REVIEW_PATH = '/orders/7c9e6679-7425-40de-944b-e07fc1f90ae7/review';

describe('CORS for the web app', () => {
  let app: INestApplication<App>;
  let previousOrigin: string | undefined;

  beforeEach(async () => {
    previousOrigin = process.env.WEB_ORIGIN;
    process.env.WEB_ORIGIN = WEB_ORIGIN;
    const moduleRef = await overrideModels(
      Test.createTestingModule({ imports: [AppModule] }),
      { default: new FakeModel([]) },
    ).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    if (previousOrigin === undefined) delete process.env.WEB_ORIGIN;
    else process.env.WEB_ORIGIN = previousOrigin;
  });

  it('answers the preflight for an approve (PATCH with a JSON body) from the web origin', async () => {
    const response = await request(app.getHttpServer())
      .options(REVIEW_PATH)
      .set('Origin', WEB_ORIGIN)
      .set('Access-Control-Request-Method', 'PATCH')
      .set('Access-Control-Request-Headers', 'content-type')
      .expect(204);

    expect(response.headers['access-control-allow-origin']).toBe(WEB_ORIGIN);
    expect(response.headers['access-control-allow-methods']).toContain('PATCH');
    expect(response.headers['access-control-allow-headers']).toBe(
      'content-type',
    );
  });

  it('names the web origin on an ordinary response so the browser lets the page read it', async () => {
    const response = await request(app.getHttpServer())
      .get('/orders')
      .set('Origin', WEB_ORIGIN)
      .expect(200);
    expect(response.headers['access-control-allow-origin']).toBe(WEB_ORIGIN);
  });

  it('gives any other origin no allow header, on a preflight or a normal request', async () => {
    const preflight = await request(app.getHttpServer())
      .options(REVIEW_PATH)
      .set('Origin', 'http://elsewhere.test')
      .set('Access-Control-Request-Method', 'PATCH');
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined();

    const normal = await request(app.getHttpServer())
      .get('/orders')
      .set('Origin', 'http://elsewhere.test')
      .expect(200);
    expect(normal.headers['access-control-allow-origin']).toBeUndefined();
  });
});
