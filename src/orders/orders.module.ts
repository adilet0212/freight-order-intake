import { Module } from '@nestjs/common';
import { ExtractionService } from './extraction.service.js';
import { OrdersController } from './orders.controller.js';
import { OrdersGateway } from './orders.gateway.js';
import { OrdersRepository } from './orders.repository.js';
import { OrdersService } from './orders.service.js';

@Module({
  controllers: [OrdersController],
  providers: [
    ExtractionService,
    OrdersGateway,
    OrdersRepository,
    OrdersService,
  ],
})
export class OrdersModule {}
