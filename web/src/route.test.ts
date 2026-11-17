import { parseRoute, paths } from './route.js';

describe('parseRoute', () => {
  it('reads an empty hash, "#" and "#/" as the queue with no filter', () => {
    for (const hash of ['', '#', '#/']) {
      expect(parseRoute(hash)).toEqual({ name: 'queue', status: null });
    }
  });

  it('reads the status filter of the queue', () => {
    expect(parseRoute('#/?status=needs_review')).toEqual({
      name: 'queue',
      status: 'needs_review',
    });
  });

  it('reads an order id', () => {
    expect(parseRoute('#/orders/7c9e6679-7425-40de-944b-e07fc1f90ae7')).toEqual(
      { name: 'order', id: '7c9e6679-7425-40de-944b-e07fc1f90ae7' },
    );
  });

  it('reads the paste screen', () => {
    expect(parseRoute('#/paste')).toEqual({ name: 'paste' });
  });

  it('treats anything else as not found, including a broken escape', () => {
    expect(parseRoute('#/orders')).toEqual({ name: 'not-found' });
    expect(parseRoute('#/orders/a/b')).toEqual({ name: 'not-found' });
    expect(parseRoute('#/settings')).toEqual({ name: 'not-found' });
    expect(parseRoute('#/orders/%E0%A4%A')).toEqual({ name: 'not-found' });
  });
});

describe('paths', () => {
  it('builds hashes that parseRoute reads back', () => {
    expect(parseRoute(paths.queue())).toEqual({ name: 'queue', status: null });
    expect(parseRoute(paths.queue('approved'))).toEqual({
      name: 'queue',
      status: 'approved',
    });
    expect(parseRoute(paths.order('abc 1'))).toEqual({
      name: 'order',
      id: 'abc 1',
    });
    expect(parseRoute(paths.paste())).toEqual({ name: 'paste' });
  });
});
