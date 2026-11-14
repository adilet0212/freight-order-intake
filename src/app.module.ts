import { Module } from '@nestjs/common';
import { AiModule } from '@nestjs/ai';
import { ConfigModule } from '@nestjs/config';
import { DrizzleModule } from '@nestjs/drizzle';
import { drizzle } from 'drizzle-orm/node-postgres';
import { modelFromEnv } from './llm.js';
import { OrdersModule } from './orders/orders.module.js';

@Module({
  imports: [
    // Loads .env into process.env before the factories below read it.
    ConfigModule.forRoot({ isGlobal: true }),
    DrizzleModule.forRootAsync({
      useFactory: () => {
        const connection = process.env.DATABASE_URL;
        if (!connection)
          throw new Error('DATABASE_URL is not set. See .env.example.');
        return { drizzle, connection };
      },
    }),
    AiModule.forRootAsync({
      isGlobal: true,
      useFactory: () => ({
        models: { default: modelFromEnv() },
        // One slow or rate-limited call should not fail an email outright.
        defaults: { timeout: '30s', retry: { attempts: 3 } },
      }),
    }),
    OrdersModule,
  ],
})
export class AppModule {}
