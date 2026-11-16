import { makeOrder } from '../test/fakes.js';
import {
  draftFrom,
  emptyCommodity,
  emptyStop,
  orderContent,
  toForm,
  totalWeightLbs,
  type OrderForm,
} from './order-form.js';

function formOf(change: (form: OrderForm) => void): OrderForm {
  const form = toForm(makeOrder());
  change(form);
  return form;
}

describe('toForm', () => {
  it('turns every value into the text an input shows, and null into an empty input', () => {
    const form = toForm(
      makeOrder({
        referenceNumber: null,
        equipmentType: null,
        rateAmount: 1850.5,
        rateCurrency: null,
        specialInstructions: null,
      }),
    );

    expect(form).toMatchObject({
      customerName: 'Maple Ridge Foods',
      referenceNumber: '',
      equipmentType: '',
      rateAmount: '1850.5',
      rateCurrency: '',
      specialInstructions: '',
    });
    expect(form.stops[1]).toMatchObject({
      type: 'delivery',
      city: 'Chicago',
      windowStart: '2026-11-18T09:00',
      windowEnd: '',
    });
    expect(form.commodities[0]).toMatchObject({
      description: 'Canned goods',
      quantity: '18',
      commodityType: 'skid',
      weightLbs: '21600',
    });
  });

  it('gives every row its own key', () => {
    const form = toForm(makeOrder());
    const keys = [...form.stops, ...form.commodities].map((row) => row.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('draftFrom', () => {
  it('reads an untouched form back into exactly the order it came from', () => {
    const order = makeOrder();
    expect(draftFrom(toForm(order))).toEqual({
      order: orderContent(order),
      errors: [],
    });
  });

  it('trims text and turns an empty or blank input into null', () => {
    const draft = draftFrom(
      formOf((form) => {
        form.customerName = '  Maple Ridge Foods  ';
        form.referenceNumber = '   ';
        form.specialInstructions = '';
        form.equipmentType = '';
        form.rateCurrency = '';
        form.stops[0].street = '';
        form.commodities[0].commodityType = '';
      }),
    );

    expect(draft.errors).toEqual([]);
    expect(draft.order).toMatchObject({
      customerName: 'Maple Ridge Foods',
      referenceNumber: null,
      specialInstructions: null,
      equipmentType: null,
      rateCurrency: null,
    });
    expect(draft.order.stops[0].street).toBeNull();
    expect(draft.order.commodities[0].commodityType).toBeNull();
  });

  it('writes region and postal code in capitals, as normalize.ts does at intake', () => {
    const draft = draftFrom(
      formOf((form) => {
        form.stops[0].region = ' on ';
        form.stops[0].postalCode = 'l6t 4x3';
        form.stops[0].city = 'brampton';
      }),
    );

    expect(draft.order.stops[0]).toMatchObject({
      region: 'ON',
      postalCode: 'L6T 4X3',
      // Only codes are capitalised; a city is kept as typed.
      city: 'brampton',
    });
  });

  it('reads quantity and weight as whole numbers above 0', () => {
    const draft = draftFrom(
      formOf((form) => {
        form.commodities[0].quantity = ' 18 ';
        form.commodities[0].weightLbs = '1';
      }),
    );
    expect(draft.errors).toEqual([]);
    expect(draft.order.commodities[0]).toMatchObject({
      quantity: 18,
      weightLbs: 1,
    });
  });

  it.each(['2.5', '0', '-3', '1e3', '12 skids', '1,000'])(
    'reports a quantity of "%s" on its field and reads it as empty',
    (typed) => {
      const draft = draftFrom(
        formOf((form) => {
          form.commodities[0].quantity = typed;
        }),
      );
      expect(draft.errors).toEqual([
        {
          field: 'commodities.0.quantity',
          message: 'Quantity must be a whole number above 0',
        },
      ]);
      expect(draft.order.commodities[0].quantity).toBeNull();
    },
  );

  it('accepts the largest whole number the database column holds, and rejects one more', () => {
    const atLimit = draftFrom(
      formOf((form) => {
        form.commodities[0].weightLbs = '2147483647';
      }),
    );
    expect(atLimit.errors).toEqual([]);
    expect(atLimit.order.commodities[0].weightLbs).toBe(2147483647);

    const over = draftFrom(
      formOf((form) => {
        form.commodities[0].weightLbs = '2147483648';
      }),
    );
    expect(over.errors).toEqual([
      {
        field: 'commodities.0.weightLbs',
        message: 'Weight must be a whole number above 0',
      },
    ]);
  });

  it('reads a rate with up to two decimals, and reports anything else', () => {
    const rate = (typed: string) =>
      draftFrom(
        formOf((form) => {
          form.rateAmount = typed;
        }),
      );

    expect(rate('1850').order.rateAmount).toBe(1850);
    expect(rate('1850.5').order.rateAmount).toBe(1850.5);
    expect(rate('0').order.rateAmount).toBe(0);
    expect(rate('').order.rateAmount).toBeNull();
    expect(rate('').errors).toEqual([]);
    // The column is numeric(10,2): 99,999,999.99 fits, the next cent up does not.
    expect(rate('99999999.99').errors).toEqual([]);
    expect(rate('100000000').errors).toHaveLength(1);

    for (const typed of ['1850.555', '$1850', '1,850', '-5', 'tbd']) {
      expect(rate(typed).errors).toEqual([
        {
          field: 'rateAmount',
          message: 'Rate must be an amount such as 1850 or 1850.50',
        },
      ]);
      expect(rate(typed).order.rateAmount).toBeNull();
    }
  });

  it('keeps a real date and time, drops seconds, and reports a date that does not exist', () => {
    const draft = draftFrom(
      formOf((form) => {
        form.stops[0].windowStart = '2026-11-17T08:00:00';
        form.stops[0].windowEnd = '2026-02-30T08:00';
        form.stops[1].windowStart = '';
      }),
    );

    expect(draft.order.stops[0].windowStart).toBe('2026-11-17T08:00');
    expect(draft.order.stops[0].windowEnd).toBeNull();
    expect(draft.order.stops[1].windowStart).toBeNull();
    expect(draft.errors).toEqual([
      {
        field: 'stops.0.windowEnd',
        message: 'Window end is not a valid date and time',
      },
    ]);
  });

  it('reads added rows, and an order with no rows at all', () => {
    const added = draftFrom(
      formOf((form) => {
        form.stops.push({ ...emptyStop('delivery'), city: 'Detroit' });
        form.commodities.push(emptyCommodity());
      }),
    );
    expect(added.errors).toEqual([]);
    expect(added.order.stops).toHaveLength(3);
    expect(added.order.stops[2]).toEqual({
      type: 'delivery',
      companyName: null,
      street: null,
      city: 'Detroit',
      region: null,
      postalCode: null,
      windowStart: null,
      windowEnd: null,
    });
    expect(added.order.commodities[1]).toEqual({
      description: null,
      quantity: null,
      commodityType: null,
      weightLbs: null,
    });

    const none = draftFrom(
      formOf((form) => {
        form.stops = [];
        form.commodities = [];
      }),
    );
    expect(none.errors).toEqual([]);
    expect(none.order.stops).toEqual([]);
    expect(none.order.commodities).toEqual([]);
  });

  it('reports a select value the API would refuse, using the shared schema', () => {
    const draft = draftFrom(
      formOf((form) => {
        form.equipmentType = 'boat';
      }),
    );
    expect(draft.errors).toHaveLength(1);
    expect(draft.errors[0].field).toBe('equipmentType');
  });
});

describe('totalWeightLbs', () => {
  it('adds the weights that are known and counts an unknown weight as nothing', () => {
    const order = orderContent(
      makeOrder({
        commodities: [
          {
            description: null,
            quantity: 1,
            commodityType: null,
            weightLbs: 21600,
          },
          {
            description: null,
            quantity: 1,
            commodityType: null,
            weightLbs: null,
          },
          {
            description: null,
            quantity: 1,
            commodityType: null,
            weightLbs: 400,
          },
        ],
      }),
    );
    // 21,600 + 400 = 22,000.
    expect(totalWeightLbs(order)).toBe(22000);
    expect(totalWeightLbs({ ...order, commodities: [] })).toBe(0);
  });
});
