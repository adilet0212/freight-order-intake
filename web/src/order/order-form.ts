import type { Commodity, Order, Stop } from '../api/types.js';
import {
  normalizedOrderSchema,
  parseLocalDateTime,
  type NormalizedOrder,
} from '../shared.js';

/**
 * The order as the form holds it: every input's value as text, exactly as typed.
 * `key` identifies a row for React while rows are added and removed.
 */
export interface StopForm {
  key: string;
  type: Stop['type'];
  companyName: string;
  street: string;
  city: string;
  region: string;
  postalCode: string;
  windowStart: string;
  windowEnd: string;
}

export interface CommodityForm {
  key: string;
  description: string;
  quantity: string;
  commodityType: string;
  weightLbs: string;
}

export interface OrderForm {
  customerName: string;
  referenceNumber: string;
  equipmentType: string;
  rateAmount: string;
  rateCurrency: string;
  specialInstructions: string;
  stops: StopForm[];
  commodities: CommodityForm[];
}

/** `field` is a path such as "stops.0.windowStart", the form the API uses in its errors. */
export interface FieldError {
  field: string;
  message: string;
}

export interface Draft {
  /** Always a well-formed order: a value that could not be read is null here. */
  order: NormalizedOrder;
  /** One entry per value that could not be read. Empty means the order can be sent. */
  errors: FieldError[];
}

/** The largest value a Postgres `integer` column holds (quantity and weight are both). */
const MAX_INTEGER = 2_147_483_647;
/** `rate_amount` is numeric(10,2): eight digits before the point, two after. */
const MAX_RATE = 99_999_999.99;

let lastKey = 0;
function newKey(): string {
  lastKey += 1;
  return `row-${lastKey}`;
}

export function emptyStop(type: Stop['type']): StopForm {
  return {
    key: newKey(),
    type,
    companyName: '',
    street: '',
    city: '',
    region: '',
    postalCode: '',
    windowStart: '',
    windowEnd: '',
  };
}

export function emptyCommodity(): CommodityForm {
  return {
    key: newKey(),
    description: '',
    quantity: '',
    commodityType: '',
    weightLbs: '',
  };
}

export function orderContent(order: Order): NormalizedOrder {
  return {
    customerName: order.customerName,
    referenceNumber: order.referenceNumber,
    equipmentType: order.equipmentType,
    stops: order.stops,
    commodities: order.commodities,
    rateAmount: order.rateAmount,
    rateCurrency: order.rateCurrency,
    specialInstructions: order.specialInstructions,
  };
}

export function toForm(order: Order): OrderForm {
  return {
    customerName: order.customerName ?? '',
    referenceNumber: order.referenceNumber ?? '',
    equipmentType: order.equipmentType ?? '',
    rateAmount: order.rateAmount === null ? '' : String(order.rateAmount),
    rateCurrency: order.rateCurrency ?? '',
    specialInstructions: order.specialInstructions ?? '',
    stops: order.stops.map((stop) => ({
      key: newKey(),
      type: stop.type,
      companyName: stop.companyName ?? '',
      street: stop.street ?? '',
      city: stop.city ?? '',
      region: stop.region ?? '',
      postalCode: stop.postalCode ?? '',
      windowStart: stop.windowStart ?? '',
      windowEnd: stop.windowEnd ?? '',
    })),
    commodities: order.commodities.map((commodity) => ({
      key: newKey(),
      description: commodity.description ?? '',
      quantity: commodity.quantity === null ? '' : String(commodity.quantity),
      commodityType: commodity.commodityType ?? '',
      weightLbs:
        commodity.weightLbs === null ? '' : String(commodity.weightLbs),
    })),
  };
}

/** Trimmed text, or null when nothing is left. The same rule as `clean` in normalize.ts. */
function text(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Reads the form into an order.
 *
 * The review endpoint stores what it is sent: unlike intake, it does not run
 * normalize.ts. So the tidying normalize.ts does at intake is repeated here (trim,
 * empty to null, region and postal code in capitals), and anything the database would
 * reject (a fraction, a number too large for its column, a date that does not exist) is
 * caught here and reported per field instead of coming back as a server error.
 */
export function draftFrom(form: OrderForm): Draft {
  const errors: FieldError[] = [];

  function whole(value: string, field: string, name: string): number | null {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const number = Number(trimmed);
    if (/^\d+$/.test(trimmed) && number > 0 && number <= MAX_INTEGER) {
      return number;
    }
    errors.push({ field, message: `${name} must be a whole number above 0` });
    return null;
  }

  function dateTime(value: string, field: string, name: string): string | null {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    // Some browsers add seconds to a datetime-local value; the API stores minutes.
    const parsed = parseLocalDateTime(trimmed.slice(0, 16));
    if (parsed === null) {
      errors.push({ field, message: `${name} is not a valid date and time` });
    }
    return parsed;
  }

  let rateAmount: number | null = null;
  const rateText = form.rateAmount.trim();
  if (rateText !== '') {
    if (/^\d+(\.\d{1,2})?$/.test(rateText) && Number(rateText) <= MAX_RATE) {
      rateAmount = Number(rateText);
    } else {
      errors.push({
        field: 'rateAmount',
        message: 'Rate must be an amount such as 1850 or 1850.50',
      });
    }
  }

  const stops: Stop[] = form.stops.map((stop, index) => ({
    type: stop.type,
    companyName: text(stop.companyName),
    street: text(stop.street),
    city: text(stop.city),
    region: text(stop.region)?.toUpperCase() ?? null,
    postalCode: text(stop.postalCode)?.toUpperCase() ?? null,
    windowStart: dateTime(
      stop.windowStart,
      `stops.${index}.windowStart`,
      'Window start',
    ),
    windowEnd: dateTime(
      stop.windowEnd,
      `stops.${index}.windowEnd`,
      'Window end',
    ),
  }));

  const commodities: Commodity[] = form.commodities.map((commodity, index) => ({
    description: text(commodity.description),
    quantity: whole(
      commodity.quantity,
      `commodities.${index}.quantity`,
      'Quantity',
    ),
    commodityType: (text(commodity.commodityType) ??
      null) as Commodity['commodityType'],
    weightLbs: whole(
      commodity.weightLbs,
      `commodities.${index}.weightLbs`,
      'Weight',
    ),
  }));

  const order: NormalizedOrder = {
    customerName: text(form.customerName),
    referenceNumber: text(form.referenceNumber),
    equipmentType: (text(form.equipmentType) ??
      null) as NormalizedOrder['equipmentType'],
    stops,
    commodities,
    rateAmount,
    rateCurrency: (text(form.rateCurrency) ??
      null) as NormalizedOrder['rateCurrency'],
    specialInstructions: text(form.specialInstructions),
  };

  // The API validates with this same schema. Checking here as well means a value the
  // selects could not normally produce is reported on the form, not by a 400.
  const checked = normalizedOrderSchema.safeParse(order);
  if (!checked.success) {
    for (const issue of checked.error.issues) {
      errors.push({ field: issue.path.join('.'), message: issue.message });
    }
  }

  return { order, errors };
}

/** The sum of the weights that could be read, for the total shown under the freight. */
export function totalWeightLbs(order: NormalizedOrder): number {
  return order.commodities.reduce(
    (sum, commodity) => sum + (commodity.weightLbs ?? 0),
    0,
  );
}
