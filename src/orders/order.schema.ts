import { z } from 'zod';

// Commodity types mirror the enum on Rose Rocket's public Commodity object
// (roserocket.readme.io/docs/commodities) so an extracted order maps onto a real TMS shape.
export const COMMODITY_TYPES = [
  'bundle',
  'carton',
  'skid',
  'package',
  'container',
] as const;

export const EQUIPMENT_TYPES = [
  'dry_van',
  'reefer',
  'flatbed',
  'other',
] as const;
export const STOP_TYPES = ['pickup', 'delivery'] as const;
export const CURRENCIES = ['USD', 'CAD'] as const;

export const ORDER_STATUSES = [
  'auto_accepted', // passed every rule in the review gate
  'needs_review', // at least one rule fired; a person must confirm or correct
  'not_an_order', // the email is not a shipment request
  'extraction_failed', // the model's answer did not match the schema
  'approved', // a person reviewed and saved it
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * What the model must return. Deliberately loose: every field the email might not
 * state is nullable, and nothing is converted here. The model reads; code computes.
 * Strict checks (date format, unit conversion) live in normalize.ts where they are
 * deterministic and unit-tested.
 */
export const extractedOrderSchema = z.object({
  isOrderRequest: z
    .boolean()
    .describe(
      'true only if the email asks to move freight (a new shipment or load tender)',
    ),
  customerName: z
    .string()
    .nullable()
    .describe('The company asking for the shipment'),
  referenceNumber: z
    .string()
    .nullable()
    .describe(
      'PO, load or reference number: the code only, without its label ("PO", "Ref", "#")',
    ),
  equipmentType: z.enum(EQUIPMENT_TYPES).nullable(),
  stops: z.array(
    z.object({
      type: z.enum(STOP_TYPES),
      companyName: z.string().nullable(),
      street: z.string().nullable(),
      city: z.string().nullable(),
      region: z
        .string()
        .nullable()
        .describe('2-letter state or province code, e.g. TX, ON'),
      postalCode: z.string().nullable(),
      windowStart: z
        .string()
        .nullable()
        .describe(
          'Start of the appointment window, local time at the stop, as YYYY-MM-DDTHH:mm',
        ),
      windowEnd: z
        .string()
        .nullable()
        .describe(
          'End of the window, same format. null if a single time was given',
        ),
    }),
  ),
  commodities: z.array(
    z.object({
      description: z.string().nullable(),
      quantity: z.number().nullable(),
      commodityType: z.enum(COMMODITY_TYPES).nullable(),
      weightValue: z
        .number()
        .nullable()
        .describe('The number as written. Do not convert units'),
      weightUnit: z.enum(['lbs', 'kg']).nullable(),
    }),
  ),
  rateAmount: z.number().nullable(),
  rateCurrency: z.enum(CURRENCIES).nullable(),
  specialInstructions: z.string().nullable(),
  ambiguities: z
    .array(z.string())
    .describe(
      'One short sentence per detail the email leaves unclear or contradictory. Empty if none',
    ),
});
export type ExtractedOrder = z.infer<typeof extractedOrderSchema>;

/** The order after normalize.ts: weights in lbs, codes upper-cased, dates checked. */
export const normalizedOrderSchema = z.object({
  customerName: z.string().nullable(),
  referenceNumber: z.string().nullable(),
  equipmentType: z.enum(EQUIPMENT_TYPES).nullable(),
  stops: z.array(
    z.object({
      type: z.enum(STOP_TYPES),
      companyName: z.string().nullable(),
      street: z.string().nullable(),
      city: z.string().nullable(),
      region: z.string().nullable(),
      postalCode: z.string().nullable(),
      windowStart: z.string().nullable(),
      windowEnd: z.string().nullable(),
    }),
  ),
  commodities: z.array(
    z.object({
      description: z.string().nullable(),
      quantity: z.number().int().positive().nullable(),
      commodityType: z.enum(COMMODITY_TYPES).nullable(),
      weightLbs: z.number().int().positive().nullable(),
    }),
  ),
  rateAmount: z.number().nullable(),
  rateCurrency: z.enum(CURRENCIES).nullable(),
  specialInstructions: z.string().nullable(),
});
export type NormalizedOrder = z.infer<typeof normalizedOrderSchema>;

/** POST /emails body. */
export const inboundEmailSchema = z.object({
  /** The Message-ID header. Optional: without it the email's content is hashed instead. */
  messageId: z.string().min(1).max(998).optional(),
  subject: z.string().min(1).max(500),
  body: z.string().min(1).max(20_000),
  receivedAt: z.iso.datetime({ offset: true }),
});
export type InboundEmail = z.infer<typeof inboundEmailSchema>;
