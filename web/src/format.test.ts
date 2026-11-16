import {
  formatInstant,
  formatLocalMinute,
  localInputToIso,
  parseTimestamp,
  toIsoWithOffset,
  toLocalInputValue,
} from './format.js';

describe('formatLocalMinute', () => {
  it('formats a stop time from its text, without shifting it by any time zone', () => {
    expect(formatLocalMinute('2026-11-17T08:00')).toBe('Nov 17, 2026, 08:00');
    expect(formatLocalMinute('2026-01-05T23:59')).toBe('Jan 5, 2026, 23:59');
  });

  it('gives an empty string for no value and returns unreadable text unchanged', () => {
    expect(formatLocalMinute(null)).toBe('');
    expect(formatLocalMinute('next Tuesday')).toBe('next Tuesday');
    expect(formatLocalMinute('2026-13-01T08:00')).toBe('2026-13-01T08:00');
  });
});

describe('parseTimestamp', () => {
  it('reads the form Postgres prints: a space and a two-digit offset', () => {
    // 14:05 at UTC-5 is 19:05 UTC.
    expect(parseTimestamp('2026-11-16 14:05:00-05')?.toISOString()).toBe(
      '2026-11-16T19:05:00.000Z',
    );
  });

  it('keeps milliseconds and drops the rest of a six-digit fraction', () => {
    expect(parseTimestamp('2026-11-15 19:24:59.610434-05')?.toISOString()).toBe(
      '2026-11-16T00:24:59.610Z',
    );
    expect(parseTimestamp('2026-11-15 19:24:59.6+00')?.toISOString()).toBe(
      '2026-11-15T19:24:59.600Z',
    );
  });

  it('reads offsets with minutes, with or without a colon', () => {
    // 10:00 at UTC+5:30 is 04:30 UTC.
    expect(parseTimestamp('2026-11-16 10:00:00+05:30')?.toISOString()).toBe(
      '2026-11-16T04:30:00.000Z',
    );
    expect(parseTimestamp('2026-11-16 10:00:00+0530')?.toISOString()).toBe(
      '2026-11-16T04:30:00.000Z',
    );
  });

  it('reads ISO strings, and reads a value with no offset as UTC', () => {
    expect(parseTimestamp('2026-11-16T19:05:00.000Z')?.toISOString()).toBe(
      '2026-11-16T19:05:00.000Z',
    );
    expect(parseTimestamp('2026-11-16T14:05:00-05:00')?.toISOString()).toBe(
      '2026-11-16T19:05:00.000Z',
    );
    expect(parseTimestamp('2026-11-16 19:05')?.toISOString()).toBe(
      '2026-11-16T19:05:00.000Z',
    );
  });

  it('gives null for nothing, for other text and for a date that does not exist', () => {
    expect(parseTimestamp(null)).toBeNull();
    expect(parseTimestamp(undefined)).toBeNull();
    expect(parseTimestamp('')).toBeNull();
    expect(parseTimestamp('yesterday')).toBeNull();
    expect(parseTimestamp('2026-13-40 25:00:00+00')).toBeNull();
  });
});

describe('formatInstant', () => {
  it("shows a point in time on the reader's clock", () => {
    const received = '2026-11-16 14:05:00-05';
    expect(formatInstant(received, 'America/Toronto')).toBe('Nov 16, 14:05');
    expect(formatInstant(received, 'UTC')).toBe('Nov 16, 19:05');
    // Late evening in Toronto is already the next day in UTC.
    expect(formatInstant('2026-11-16 22:30:00-05', 'UTC')).toBe(
      'Nov 17, 03:30',
    );
  });

  it('shows midnight as 00, not 24', () => {
    expect(formatInstant('2026-11-17 00:05:00+00', 'UTC')).toBe(
      'Nov 17, 00:05',
    );
  });

  it('gives an empty string when the value cannot be read', () => {
    expect(formatInstant(null)).toBe('');
    expect(formatInstant('soon')).toBe('');
  });
});

describe('toIsoWithOffset', () => {
  const instant = new Date('2026-11-17T03:30:00.000Z');

  it('writes the clock time at the offset, with the offset', () => {
    // 03:30 UTC is 22:30 the evening before at UTC-5: the day must not become the 17th.
    expect(toIsoWithOffset(instant, -300)).toBe('2026-11-16T22:30:00-05:00');
    expect(toIsoWithOffset(instant, 0)).toBe('2026-11-17T03:30:00+00:00');
    expect(toIsoWithOffset(instant, 330)).toBe('2026-11-17T09:00:00+05:30');
  });

  it('names the same moment whatever the offset', () => {
    for (const offset of [-720, -300, 0, 330, 840]) {
      expect(new Date(toIsoWithOffset(instant, offset)).getTime()).toBe(
        instant.getTime(),
      );
    }
  });
});

describe('datetime-local helpers', () => {
  it('gives the value a datetime-local input expects', () => {
    expect(toLocalInputValue(new Date('2026-11-17T03:30:00.000Z'), -300)).toBe(
      '2026-11-16T22:30',
    );
  });

  it('turns a typed local time back into the same wall-clock time with an offset', () => {
    const iso = localInputToIso('2026-11-16T22:30');
    // The offset depends on the machine running the test; the clock time must not.
    expect(iso).toMatch(/^2026-11-16T22:30:00[+-]\d{2}:\d{2}$/);
    expect(new Date(iso!).getTime()).toBe(
      new Date('2026-11-16T22:30').getTime(),
    );
  });

  it('gives null for a value that is not a date and time', () => {
    expect(localInputToIso('')).toBeNull();
    expect(localInputToIso('2026-11-16')).toBeNull();
    expect(localInputToIso('2026-13-40T99:99')).toBeNull();
  });
});
