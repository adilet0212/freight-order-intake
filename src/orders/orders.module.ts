import { Module } from '@nestjs/common';
import { ExtractionService } from './extraction.service.js';
import { OrdersController } from './orders.controller.js';
import { OrdersRepository } from './orders.repository.js';
import { OrdersService } from './orders.service.js';

@Module({
  controllers: [OrdersController],
  providers: [ExtractionService, OrdersRepository, OrdersService],
})
export class OrdersModule {}
