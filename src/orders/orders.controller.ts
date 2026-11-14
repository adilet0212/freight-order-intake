import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import {
  inboundEmailSchema,
  normalizedOrderSchema,
  ORDER_STATUSES,
  type InboundEmail,
  type NormalizedOrder,
  type OrderStatus,
} from './order.schema.js';
import { OrdersService } from './orders.service.js';

const idSchema = z.uuid();
const statusSchema = z.enum(ORDER_STATUSES).optional();

@Controller()
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  /** 201 for a new order, 200 when this email was already ingested. */
  @Post('emails')
  async ingest(
    @Body({ schema: inboundEmailSchema }) email: InboundEmail,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { order, created } = await this.ordersService.ingest(email);
    response.status(created ? 201 : 200);
    return order;
  }

  @Get('orders')
  list(@Query('status', { schema: statusSchema }) status?: OrderStatus) {
    return this.ordersService.list(status);
  }

  @Get('orders/:id')
  get(@Param('id', { schema: idSchema }) id: string) {
    return this.ordersService.get(id);
  }

  @Patch('orders/:id/review')
  approve(
    @Param('id', { schema: idSchema }) id: string,
    @Body({ schema: normalizedOrderSchema }) corrected: NormalizedOrder,
  ) {
    return this.ordersService.approve(id, corrected);
  }
}
