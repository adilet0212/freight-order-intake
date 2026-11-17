import { Logger } from '@nestjs/common';
import {
  ORDER_APPROVED,
  ORDER_CREATED,
  ORDER_REEXTRACTED,
} from './order-events.js';
import { OrdersGateway } from './orders.gateway.js';

const ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

describe('OrdersGateway', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends order.created with the id and status, and nothing else from the order', () => {
    const gateway = new OrdersGateway();
    const emit = vi.fn();
    gateway.server = { emit };

    gateway.orderCreated({
      id: ID,
      status: 'needs_review',
      // A stored order carries the email; none of it may reach the socket.
      emailBody: 'Please pick up 18 skids in Brampton',
    } as { id: string; status: string });

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(ORDER_CREATED, {
      id: ID,
      status: 'needs_review',
    });
    expect(ORDER_CREATED).toBe('order.created');
  });

  it('sends order.approved with the id and the approved status', () => {
    const gateway = new OrdersGateway();
    const emit = vi.fn();
    gateway.server = { emit };

    gateway.orderApproved({ id: ID });

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(ORDER_APPROVED, {
      id: ID,
      status: 'approved',
    });
    expect(ORDER_APPROVED).toBe('order.approved');
  });

  it('sends order.reextracted with the id and the new status, and nothing else', () => {
    const gateway = new OrdersGateway();
    const emit = vi.fn();
    gateway.server = { emit };

    gateway.orderReextracted({
      id: ID,
      status: 'auto_accepted',
      emailBody: 'Please pick up 18 skids in Brampton',
    } as { id: string; status: string });

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(ORDER_REEXTRACTED, {
      id: ID,
      status: 'auto_accepted',
    });
    expect(ORDER_REEXTRACTED).toBe('order.reextracted');
  });

  it('does nothing, and does not throw, when there is no socket server', () => {
    const gateway = new OrdersGateway();
    expect(() =>
      gateway.orderCreated({ id: ID, status: 'auto_accepted' }),
    ).not.toThrow();
    expect(() => gateway.orderApproved({ id: ID })).not.toThrow();
  });

  it('logs a failed send instead of throwing, because the order is already stored', () => {
    const logged = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const gateway = new OrdersGateway();
    gateway.server = {
      emit: () => {
        throw new Error('socket server is closing');
      },
    };

    expect(() =>
      gateway.orderCreated({ id: ID, status: 'auto_accepted' }),
    ).not.toThrow();
    expect(logged).toHaveBeenCalledTimes(1);
    expect(logged.mock.calls[0][0]).toContain('order.created');
    expect(logged.mock.calls[0][0]).toContain(ID);
  });
});
