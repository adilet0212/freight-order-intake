import { useId, type ReactNode } from 'react';
import {
  COMMODITY_TYPES,
  CURRENCIES,
  EQUIPMENT_TYPES,
  MAX_PAYLOAD_LBS,
} from '../shared.js';
import {
  emptyCommodity,
  emptyStop,
  type CommodityForm,
  type FieldError,
  type OrderForm as OrderFormState,
  type StopForm,
} from './order-form.js';

const EQUIPMENT_LABELS: Record<(typeof EQUIPMENT_TYPES)[number], string> = {
  dry_van: 'Dry van',
  reefer: 'Reefer',
  flatbed: 'Flatbed',
  other: 'Other',
};

function capitalised(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

interface Props {
  form: OrderFormState;
  onChange: (form: OrderFormState) => void;
  /** A held order is editable; every other order is shown with its inputs disabled. */
  editable: boolean;
  errors: FieldError[];
  totalWeightLbs: number;
}

export function OrderForm({
  form,
  onChange,
  editable,
  errors,
  totalWeightLbs,
}: Props) {
  const errorFor = (field: string) =>
    errors.find((error) => error.field === field)?.message;
  const formId = useId();

  const set = (change: Partial<OrderFormState>) =>
    onChange({ ...form, ...change });
  const setStop = (index: number, change: Partial<StopForm>) =>
    set({
      stops: form.stops.map((stop, at) =>
        at === index ? { ...stop, ...change } : stop,
      ),
    });
  const setCommodity = (index: number, change: Partial<CommodityForm>) =>
    set({
      commodities: form.commodities.map((commodity, at) =>
        at === index ? { ...commodity, ...change } : commodity,
      ),
    });

  return (
    <fieldset className="order-form" disabled={!editable}>
      <legend className="visually-hidden">Extracted order</legend>

      <section className="panel form-section">
        <h2>Order</h2>
        <div className="grid">
          <Field label="Customer" span={2}>
            {(id) => (
              <input
                id={id}
                value={form.customerName}
                onChange={(event) => set({ customerName: event.target.value })}
              />
            )}
          </Field>
          <Field label="Reference no.">
            {(id) => (
              <input
                id={id}
                value={form.referenceNumber}
                onChange={(event) =>
                  set({ referenceNumber: event.target.value })
                }
              />
            )}
          </Field>
          <Field label="Equipment">
            {(id) => (
              <select
                id={id}
                value={form.equipmentType}
                onChange={(event) => set({ equipmentType: event.target.value })}
              >
                <option value="">Not stated</option>
                {EQUIPMENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {EQUIPMENT_LABELS[type]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Rate" error={errorFor('rateAmount')}>
            {(id, describedBy) => (
              <input
                id={id}
                inputMode="decimal"
                value={form.rateAmount}
                aria-invalid={describedBy ? true : undefined}
                aria-describedby={describedBy}
                onChange={(event) => set({ rateAmount: event.target.value })}
              />
            )}
          </Field>
          <Field label="Currency">
            {(id) => (
              <select
                id={id}
                value={form.rateCurrency}
                onChange={(event) => set({ rateCurrency: event.target.value })}
              >
                <option value="">Not stated</option>
                {CURRENCIES.map((currency) => (
                  <option key={currency} value={currency}>
                    {currency}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Special instructions" span={4}>
            {(id) => (
              <textarea
                id={id}
                rows={2}
                value={form.specialInstructions}
                onChange={(event) =>
                  set({ specialInstructions: event.target.value })
                }
              />
            )}
          </Field>
        </div>
      </section>

      <section className="panel form-section">
        <h2>Stops</h2>
        {form.stops.length === 0 && <p className="muted">No stops.</p>}
        {form.stops.map((stop, index) => (
          <fieldset key={stop.key} className="row-group">
            <legend>Stop {index + 1}</legend>
            <div className="grid">
              <Field label="Type">
                {(id) => (
                  <select
                    id={id}
                    value={stop.type}
                    onChange={(event) =>
                      setStop(index, {
                        type: event.target.value as StopForm['type'],
                      })
                    }
                  >
                    <option value="pickup">Pickup</option>
                    <option value="delivery">Delivery</option>
                  </select>
                )}
              </Field>
              <Field label="Company" span={3}>
                {(id) => (
                  <input
                    id={id}
                    value={stop.companyName}
                    onChange={(event) =>
                      setStop(index, { companyName: event.target.value })
                    }
                  />
                )}
              </Field>
              <Field label="Street" span={2}>
                {(id) => (
                  <input
                    id={id}
                    value={stop.street}
                    onChange={(event) =>
                      setStop(index, { street: event.target.value })
                    }
                  />
                )}
              </Field>
              <Field label="City">
                {(id) => (
                  <input
                    id={id}
                    value={stop.city}
                    onChange={(event) =>
                      setStop(index, { city: event.target.value })
                    }
                  />
                )}
              </Field>
              <div className="pair">
                <Field label="State/Prov.">
                  {(id) => (
                    <input
                      id={id}
                      value={stop.region}
                      onChange={(event) =>
                        setStop(index, { region: event.target.value })
                      }
                    />
                  )}
                </Field>
                <Field label="Postal/ZIP">
                  {(id) => (
                    <input
                      id={id}
                      value={stop.postalCode}
                      onChange={(event) =>
                        setStop(index, { postalCode: event.target.value })
                      }
                    />
                  )}
                </Field>
              </div>
              <Field
                label="Window start"
                span={2}
                error={errorFor(`stops.${index}.windowStart`)}
              >
                {(id, describedBy) => (
                  <input
                    id={id}
                    type="datetime-local"
                    value={stop.windowStart}
                    aria-invalid={describedBy ? true : undefined}
                    aria-describedby={describedBy}
                    onChange={(event) =>
                      setStop(index, { windowStart: event.target.value })
                    }
                  />
                )}
              </Field>
              <Field
                label="Window end"
                span={2}
                error={errorFor(`stops.${index}.windowEnd`)}
              >
                {(id, describedBy) => (
                  <input
                    id={id}
                    type="datetime-local"
                    value={stop.windowEnd}
                    aria-invalid={describedBy ? true : undefined}
                    aria-describedby={describedBy}
                    onChange={(event) =>
                      setStop(index, { windowEnd: event.target.value })
                    }
                  />
                )}
              </Field>
            </div>
            {editable && (
              <button
                type="button"
                className="button quiet remove"
                onClick={() =>
                  set({ stops: form.stops.filter((_, at) => at !== index) })
                }
              >
                Remove stop {index + 1}
              </button>
            )}
          </fieldset>
        ))}
        {editable && (
          <div className="add-row">
            <button
              type="button"
              className="button"
              onClick={() =>
                set({ stops: [...form.stops, emptyStop('pickup')] })
              }
            >
              Add pickup
            </button>
            <button
              type="button"
              className="button"
              onClick={() =>
                set({ stops: [...form.stops, emptyStop('delivery')] })
              }
            >
              Add delivery
            </button>
          </div>
        )}
      </section>

      <section className="panel form-section">
        <h2>Freight</h2>
        {form.commodities.length === 0 && <p className="muted">No freight.</p>}
        {form.commodities.map((commodity, index) => (
          <fieldset key={commodity.key} className="row-group">
            <legend>Freight line {index + 1}</legend>
            <div className="grid">
              <Field label="Description" span={2}>
                {(id) => (
                  <input
                    id={id}
                    value={commodity.description}
                    onChange={(event) =>
                      setCommodity(index, { description: event.target.value })
                    }
                  />
                )}
              </Field>
              <div className="pair">
                <Field
                  label="Quantity"
                  error={errorFor(`commodities.${index}.quantity`)}
                  errorId={`${formId}-${commodity.key}-quantity`}
                >
                  {(id, describedBy) => (
                    <input
                      id={id}
                      inputMode="numeric"
                      value={commodity.quantity}
                      aria-invalid={describedBy ? true : undefined}
                      aria-describedby={describedBy}
                      onChange={(event) =>
                        setCommodity(index, { quantity: event.target.value })
                      }
                    />
                  )}
                </Field>
                <Field label="Unit type">
                  {(id) => (
                    <select
                      id={id}
                      value={commodity.commodityType}
                      onChange={(event) =>
                        setCommodity(index, {
                          commodityType: event.target.value,
                        })
                      }
                    >
                      <option value="">Not stated</option>
                      {COMMODITY_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {capitalised(type)}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
              </div>
              <Field
                label="Weight (lbs)"
                error={errorFor(`commodities.${index}.weightLbs`)}
                errorId={`${formId}-${commodity.key}-weight`}
              >
                {(id, describedBy) => (
                  <input
                    id={id}
                    inputMode="numeric"
                    value={commodity.weightLbs}
                    aria-invalid={describedBy ? true : undefined}
                    aria-describedby={describedBy}
                    onChange={(event) =>
                      setCommodity(index, { weightLbs: event.target.value })
                    }
                  />
                )}
              </Field>
            </div>
            {/* Quantity is too narrow a field to carry a sentence under it, so the
                messages for this line get the full width below it. */}
            <RowErrors
              messages={[
                {
                  id: `${formId}-${commodity.key}-quantity`,
                  text: errorFor(`commodities.${index}.quantity`),
                },
                {
                  id: `${formId}-${commodity.key}-weight`,
                  text: errorFor(`commodities.${index}.weightLbs`),
                },
              ]}
            />
            {editable && (
              <button
                type="button"
                className="button quiet remove"
                onClick={() =>
                  set({
                    commodities: form.commodities.filter(
                      (_, at) => at !== index,
                    ),
                  })
                }
              >
                Remove freight line {index + 1}
              </button>
            )}
          </fieldset>
        ))}
        <p className="total">
          Total weight: {totalWeightLbs.toLocaleString('en-US')} lbs
          <span className="muted">
            {' '}
            (one truckload is up to {MAX_PAYLOAD_LBS.toLocaleString(
              'en-US',
            )}{' '}
            lbs)
          </span>
        </p>
        {editable && (
          <div className="add-row">
            <button
              type="button"
              className="button"
              onClick={() =>
                set({ commodities: [...form.commodities, emptyCommodity()] })
              }
            >
              Add freight line
            </button>
          </div>
        )}
      </section>
    </fieldset>
  );
}

/**
 * A label, its control, and the control's error underneath when it has one.
 * With `errorId` the message is shown elsewhere (see RowErrors) under that id, and the
 * control is only tied to it.
 */
function Field({
  label,
  span = 1,
  error,
  errorId,
  children,
}: {
  label: string;
  span?: 1 | 2 | 3 | 4;
  error?: string;
  errorId?: string;
  children: (id: string, describedBy: string | undefined) => ReactNode;
}) {
  const id = useId();
  const describedBy = errorId ?? `${id}-error`;
  return (
    <div className={`field span-${span}${error ? ' invalid' : ''}`}>
      <label htmlFor={id}>{label}</label>
      {children(id, error ? describedBy : undefined)}
      {error && !errorId && (
        <span id={describedBy} className="field-error">
          {error}
        </span>
      )}
    </div>
  );
}

/** The messages for one row of fields, each on a line of its own under the row. */
function RowErrors({
  messages,
}: {
  messages: { id: string; text: string | undefined }[];
}) {
  const shown = messages.filter((message) => message.text !== undefined);
  if (shown.length === 0) {
    return null;
  }
  return (
    <div className="row-errors">
      {shown.map((message) => (
        <span key={message.id} id={message.id} className="field-error">
          {message.text}
        </span>
      ))}
    </div>
  );
}
