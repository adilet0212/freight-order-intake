import type { Stop } from '../api/types.js';
import { firstPickupStart, formatLane, laneOf, placeName } from './lane.js';

function stop(overrides: Partial<Stop>): Stop {
  return {
    type: 'pickup',
    companyName: null,
    street: null,
    city: null,
    region: null,
    postalCode: null,
    windowStart: null,
    windowEnd: null,
    ...overrides,
  };
}

const brampton = stop({
  type: 'pickup',
  city: 'Brampton',
  region: 'ON',
  windowStart: '2026-11-17T08:00',
});
const chicago = stop({ type: 'delivery', city: 'Chicago', region: 'IL' });

describe('placeName', () => {
  it('joins city and region, and falls back to whichever is known', () => {
    expect(placeName({ city: 'Brampton', region: 'ON' })).toBe('Brampton, ON');
    expect(placeName({ city: 'Brampton', region: null })).toBe('Brampton');
    expect(placeName({ city: null, region: 'ON' })).toBe('ON');
    expect(placeName({ city: null, region: null })).toBeNull();
  });
});

describe('laneOf', () => {
  it('runs from the pickup to the delivery', () => {
    expect(laneOf([brampton, chicago])).toEqual({
      origin: 'Brampton, ON',
      destination: 'Chicago, IL',
    });
  });

  it('uses the first pickup and the last delivery when there are several', () => {
    const lane = laneOf([
      brampton,
      stop({ type: 'pickup', city: 'Mississauga', region: 'ON' }),
      stop({ type: 'delivery', city: 'Detroit', region: 'MI' }),
      chicago,
    ]);
    expect(lane).toEqual({
      origin: 'Brampton, ON',
      destination: 'Chicago, IL',
    });
  });

  it('goes by stop type, not by position', () => {
    // A delivery listed first is still the destination.
    expect(laneOf([chicago, brampton])).toEqual({
      origin: 'Brampton, ON',
      destination: 'Chicago, IL',
    });
  });

  it('leaves an end empty when there is no pickup, no delivery, or no stops', () => {
    expect(laneOf([chicago])).toEqual({
      origin: null,
      destination: 'Chicago, IL',
    });
    expect(laneOf([brampton])).toEqual({
      origin: 'Brampton, ON',
      destination: null,
    });
    expect(laneOf([])).toEqual({ origin: null, destination: null });
  });

  it('leaves an end empty when that stop has no city and no region', () => {
    expect(laneOf([stop({ type: 'pickup' }), chicago])).toEqual({
      origin: null,
      destination: 'Chicago, IL',
    });
  });
});

describe('formatLane', () => {
  it('writes both ends, a question mark for a missing end, and nothing for neither', () => {
    expect(
      formatLane({ origin: 'Brampton, ON', destination: 'Chicago, IL' }),
    ).toBe('Brampton, ON → Chicago, IL');
    expect(formatLane({ origin: 'Brampton, ON', destination: null })).toBe(
      'Brampton, ON → ?',
    );
    expect(formatLane({ origin: null, destination: 'Chicago, IL' })).toBe(
      '? → Chicago, IL',
    );
    expect(formatLane({ origin: null, destination: null })).toBe('');
  });
});

describe('firstPickupStart', () => {
  it('is the window start of the first pickup, wherever it is in the list', () => {
    expect(firstPickupStart([chicago, brampton])).toBe('2026-11-17T08:00');
  });

  it('is null with no pickup, or when the first pickup has no date', () => {
    expect(firstPickupStart([chicago])).toBeNull();
    expect(firstPickupStart([stop({ type: 'pickup' }), brampton])).toBeNull();
  });
});
