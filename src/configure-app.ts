import {
  StandardSchemaValidationPipe,
  type INestApplication,
} from '@nestjs/common';
import { allowedWebOrigins } from './web-origin.js';

/**
 * Everything the app needs set before it starts listening. main.ts calls this, and so do
 * the API tests, so the tests run the same wiring as the real server.
 */
export function configureApp(app: INestApplication): void {
  // Validates only parameters that declare a Zod schema, so binding it globally is safe.
  app.useGlobalPipes(new StandardSchemaValidationPipe());
  // The web app is served from another origin (the Vite dev server), so a browser will
  // refuse its calls unless the API names that origin. Any other origin gets no header.
  app.enableCors({ origin: allowedWebOrigins() });
}
