import type { ExtractedOrder, NormalizedOrder } from './order.schema.js';

export const LBS_PER_KG = 2.20462;

const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export interface NormalizeResult {
  order: NormalizedOrder;
  /** Problems found while normalizing. Each one sends the order to review. */
  issues: string[];
}

/** Trims a string and turns empty strings into null. */
function clean(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Keeps a date only if it is a real calendar date in YYYY-MM-DDTHH:mm form. */
export function parseLocalDateTime(value: string | null): string | null {
  const text = clean(value);
  if (!text || !LOCAL_DATE_TIME.test(text)) return null;
  const asDate = new Date(`${text}:00Z`);
  // Date rolls 2026-02-30 over to March, so a round trip catches impossible dates.
  if (
    Number.isNaN(asDate.getTime()) ||
    asDate.toISOString().slice(0, 16) !== text
  )
    return null;
  return text;
}

export function toLbs(
  value: number | null,
  unit: 'lbs' | 'kg' | null,
): number | null {
  if (value === null || unit === null || value <= 0) return null;
  return Math.round(unit === 'kg' ? value * LBS_PER_KG : value);
}

/**
 * Turns the model's loose answer into the shape we store. Pure and deterministic:
 * the same input always gives the same output, so it can be unit-tested without a model.
 */
export function normalizeOrder(extracted: ExtractedOrder): NormalizeResult {
  const issues: string[] = [];

  const stops = extracted.stops.map((stop, index) => {
    const windowStart = parseLocalDateTime(stop.windowStart);
    const windowEnd = parseLocalDateTime(stop.windowEnd);
    if (clean(stop.windowStart) && !windowStart) {
      issues.push(
        `Stop ${index + 1}: window start "${stop.windowStart}" is not a valid date`,
      );
    }
    if (clean(stop.windowEnd) && !windowEnd) {
      issues.push(
        `Stop ${index + 1}: window end "${stop.windowEnd}" is not a valid date`,
      );
    }
    return {
      type: stop.type,
      companyName: clean(stop.companyName),
      street: clean(stop.street),
      city: clean(stop.city),
      region: clean(stop.region)?.toUpperCase() ?? null,
      postalCode: clean(stop.postalCode)?.toUpperCase() ?? null,
      windowStart,
      windowEnd,
    };
  });

  const commodities = extracted.commodities.map((commodity, index) => {
    const weightLbs = toLbs(commodity.weightValue, commodity.weightUnit);
    if (commodity.weightValue !== null && weightLbs === null) {
      issues.push(
        `Commodity ${index + 1}: weight ${commodity.weightValue} has no usable unit`,
      );
    }
    // A quantity is a count of handling units, so 2.5 skids is a misread, not a value.
    const quantity =
      commodity.quantity !== null &&
      Number.isInteger(commodity.quantity) &&
      commodity.quantity > 0
        ? commodity.quantity
        : null;
    if (commodity.quantity !== null && quantity === null) {
      issues.push(
        `Commodity ${index + 1}: quantity ${commodity.quantity} is not a whole number`,
      );
    }
    return {
      description: clean(commodity.description),
      quantity,
      commodityType: commodity.commodityType,
      weightLbs,
    };
  });

  return {
    order: {
      customerName: clean(extracted.customerName),
      referenceNumber: clean(extracted.referenceNumber),
      equipmentType: extracted.equipmentType,
      stops,
      commodities,
      rateAmount: extracted.rateAmount,
      rateCurrency: extracted.rateCurrency,
      specialInstructions: clean(extracted.specialInstructions),
    },
    issues,
  };
}
