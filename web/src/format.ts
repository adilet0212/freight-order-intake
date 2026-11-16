const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * Formats a stop's appointment time, "2026-11-17T08:00", as "Nov 17, 2026, 08:00".
 *
 * These are wall-clock times at the dock and carry no time zone (see src/db/schema.ts).
 * They are formatted from the text alone and never passed through Date, which would
 * shift them by the reader's own time zone.
 */
export function formatLocalMinute(value: string | null): string {
  if (!value) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  const month = match ? MONTHS[Number(match[2]) - 1] : undefined;
  if (!match || !month) return value;
  return `${month} ${Number(match[3])}, ${match[1]}, ${match[4]}:${match[5]}`;
}

/**
 * Reads a point in time as the API sends it.
 *
 * The API returns these the way Postgres prints them, for example
 * "2026-11-16 14:05:00-05" or "2026-11-15 19:24:59.610434-05". That is not ISO 8601
 * (a space, a two-digit offset, six fraction digits), and browsers disagree on whether
 * Date can parse it. So it is rewritten into strict ISO first. ISO strings pass through.
 * A value with no offset is read as UTC. Returns null for anything else.
 */
export function parseTimestamp(value: string | null | undefined): Date | null {
  if (!value) return null;
  const match =
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(:\d{2})?(\.\d+)?(Z|[+-]\d{2}(?::?\d{2})?)?$/.exec(
      value.trim(),
    );
  if (!match) return null;
  const [, date, minutes, seconds = ':00', fraction = '', zone = 'Z'] = match;
  // Date keeps milliseconds only: ".610434" becomes ".610", ".6" becomes ".600".
  const millis = fraction ? `${fraction}00`.slice(0, 4) : '';
  const offset =
    zone === 'Z'
      ? 'Z'
      : zone.length === 3
        ? `${zone}:00`
        : zone.includes(':')
          ? zone
          : `${zone.slice(0, 3)}:${zone.slice(3)}`;
  const parsed = new Date(`${date}T${minutes}${seconds}${millis}${offset}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Formats a point in time, such as when an email was received, on the reader's clock:
 * "Nov 16, 14:05". `timeZone` is for tests; leave it out to use the browser's zone.
 */
export function formatInstant(
  value: string | null | undefined,
  timeZone?: string,
): string {
  const date = parseTimestamp(value);
  if (!date) return '';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).format(date);
}

function two(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * "2026-11-16T14:05:00-05:00": the clock time at the given UTC offset, with that offset.
 *
 * The API gives an email's received time to the model so it can resolve words like
 * "tomorrow". A UTC string would name the wrong day for anything sent late in the
 * evening, so the offset has to travel with the time. `offsetMinutes` defaults to the
 * browser's offset at that moment, which accounts for daylight saving.
 */
export function toIsoWithOffset(
  date: Date,
  offsetMinutes: number = -date.getTimezoneOffset(),
): string {
  const shifted = new Date(date.getTime() + offsetMinutes * 60_000);
  const sign = offsetMinutes < 0 ? '-' : '+';
  const absolute = Math.abs(offsetMinutes);
  return `${shifted.toISOString().slice(0, 19)}${sign}${two(Math.floor(absolute / 60))}:${two(absolute % 60)}`;
}

/** The value a `datetime-local` input wants for this moment: "2026-11-16T14:05". */
export function toLocalInputValue(
  date: Date,
  offsetMinutes: number = -date.getTimezoneOffset(),
): string {
  return toIsoWithOffset(date, offsetMinutes).slice(0, 16);
}

/**
 * Turns a `datetime-local` value back into a time with the reader's offset.
 * Returns null if the value is not a date and time.
 */
export function localInputToIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return null;
  // A date-time string without an offset is read as local time, which is what was typed.
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : toIsoWithOffset(date);
}
